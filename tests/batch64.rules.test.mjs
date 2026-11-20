// Firestore rules tests for batch 64: fee reminders, phone notification tokens, automatic backup result (features 148, 150, 086).
// Synthetic records only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (uid) => {
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid,
    iat: now, auth_time: now, exp: now + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
  }) + '.';
};
const ADMIN = 'owner'; // Emulator-only token that bypasses rules, used for seeding.

const encode = (value) => {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  throw new Error('Unsupported value');
};
const fields = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => [key, encode(value)]));
const headers = (who) => ({
  'Content-Type': 'application/json',
  ...(who ? { Authorization: 'Bearer ' + (who === ADMIN ? ADMIN : tokenFor(who)) } : {}),
});
const call = async (method, who, path, data) => {
  const response = await fetch(base + '/' + path, {
    method, headers: headers(who), ...(data ? { body: JSON.stringify({ fields: fields(data) }) } : {}),
  });
  await response.arrayBuffer();
  return response.status;
};
const set = (who, path, data) => call('PATCH', who, path, data);
const get = (who, path) => call('GET', who, path);
const remove = (who, path) => call('DELETE', who, path);
const allowed = async (promise, label) => assert.equal(await promise, 200, label);
const denied = async (promise, label) => assert.equal(await promise, 403, label);

// Structured query over REST, so list rules can be tested with the filters the app uses.
const query = async (who, parent, collectionId, filters) => {
  const fieldFilter = ([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) } });
  const where = filters.length === 1 ? fieldFilter(filters[0])
    : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
  const response = await fetch(`${base}/${parent}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where } }),
  });
  await response.arrayBuffer();
  return response.status;
};

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const LAT = 26.7271;
const LNG = 88.3953;
const COS = Math.cos(LAT * Math.PI / 180);
const north = (metres) => LAT + metres / 111320;
const east = (metres) => LNG + metres / (111320 * COS);
const istDay = (offsetDays = 0) => new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
const TODAY = istDay();
const projectPath = `projects/${project}/databases/(default)/documents`;

// A write with the server time stamped into `at` (or setOn) the way the app's serverTimestamp() does.
const writeWithTime = async (who, path, data, timeField) => {
  const timeFields = [].concat(timeField ?? []);
  const response = await fetch(`http://${host}/v1/${projectPath}:commit`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ writes: [{
      update: { name: `${projectPath}/${path}`, fields: fields(data) },
      ...(timeFields.length ? { updateTransforms: timeFields.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
    }] }),
  });
  await response.arrayBuffer();
  return response.status;
};

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/familyAccess/parent-1`, { active: true, studentId: 's1' }],
    [`${A}/familyAccess/parent-2`, { active: true, studentId: 's2' }],
    [`${A}/students/s1`, { name: 'Asha Rao' }],
    [`${A}/students/s2`, { name: 'Bimal Das' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const reminder = (extra = {}) => ({ studentId: 's1', studentName: 'Asha Rao', amount: 4500, createdOn: TODAY, message: 'Please pay this week', by: 'owner-a', ...extra });
const tokenDoc = (extra = {}) => ({ token: 'fcm-token-' + 'x'.repeat(60), studentId: 's1', classId: 'c1', updatedOn: TODAY, ...extra });

test('fee reminders: owner sends, school reads, a family reads only its own student', async () => {
  await allowed(set('owner-a', `${A}/feeReminders/FR-1`, reminder()), 'owner sends');
  await allowed(set('owner-a', `${A}/feeReminders/FR-2`, reminder({ message: undefined })), 'without a message');
  await set(ADMIN, `${A}/feeReminders/FR-3`, reminder({ studentId: 's2', studentName: 'Bimal Das' }));
  for (const bad of [reminder({ amount: 0 }), reminder({ studentId: 'ghost' }), reminder({ by: 'someone-else' }), reminder({ createdOn: 'today' }),
    reminder({ message: 'x'.repeat(201) }), reminder({ extra: 1 }), reminder({ studentName: '' })]) {
    await denied(set('owner-a', `${A}/feeReminders/FR-9`, bad), JSON.stringify(bad).slice(0, 70));
  }
  await denied(set('owner-a', `${A}/feeReminders/bad-id`, reminder()), 'ID must start with FR-');
  await denied(set('owner-a', `${A}/feeReminders/FR-1`, reminder({ amount: 1 })), 'a sent reminder is never edited');
  for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) await denied(set(who, `${A}/feeReminders/FR-8`, reminder({ by: who ?? 'x' })), 'write by ' + who);
  await allowed(get('prin', `${A}/feeReminders/FR-1`), 'principal reads');
  await allowed(get('parent-1', `${A}/feeReminders/FR-1`), 'family reads its own');
  await denied(get('parent-1', `${A}/feeReminders/FR-3`), "another family's reminder");
  await allowed(query('parent-1', A, 'feeReminders', [['studentId', 's1']]), 'family lists its own student');
  await denied(query('parent-1', A, 'feeReminders', [['studentId', 's2']]), "family lists another student's");
  await denied(get('t1', `${A}/feeReminders/FR-1`), 'teacher');
  await allowed(remove('owner-a', `${A}/feeReminders/FR-1`), 'owner removes');
});

test('push tokens: a family keeps only its own, nobody can list them', async () => {
  await allowed(set('parent-1', `${A}/pushTokens/parent-1`, tokenDoc()), 'family registers');
  await allowed(set('parent-1', `${A}/pushTokens/parent-1`, tokenDoc({ token: 'fcm-token-' + 'y'.repeat(60) })), 'token refreshed');
  await allowed(get('parent-1', `${A}/pushTokens/parent-1`), 'family reads its own');
  await denied(set('parent-1', `${A}/pushTokens/parent-2`, tokenDoc()), 'cannot write under another uid');
  await denied(set('parent-2', `${A}/pushTokens/parent-1`, tokenDoc({ studentId: 's2' })), 'cannot write under another uid (2)');
  await denied(set('parent-1', `${A}/pushTokens/parent-1`, tokenDoc({ studentId: 's2' })), "another family's student");
  for (const bad of [tokenDoc({ token: 'short' }), tokenDoc({ token: 'z'.repeat(601) }), tokenDoc({ updatedOn: 'now' }), tokenDoc({ classId: 'bad class!' }), tokenDoc({ extra: 1 })]) {
    await denied(set('parent-1', `${A}/pushTokens/parent-1`, bad), JSON.stringify(bad).slice(0, 60));
  }
  await denied(get('parent-2', `${A}/pushTokens/parent-1`), 'other family reads');
  await denied(get('owner-a', `${A}/pushTokens/parent-1`), 'owner cannot read tokens');
  await denied(query('owner-a', A, 'pushTokens', [['studentId', 's1']]), 'nobody lists');
  await denied(set('t1', `${A}/pushTokens/t1`, tokenDoc()), 'teacher is not a family');
  await denied(set('owner-a', `${A}/pushTokens/owner-a`, tokenDoc()), 'owner is not a family');
  await denied(remove('parent-2', `${A}/pushTokens/parent-1`), 'other family removes');
  await allowed(remove('parent-1', `${A}/pushTokens/parent-1`), 'family turns notifications off');
});

test('automatic backup result: the school reads it, only the server writes it', async () => {
  const result = { date: TODAY, docs: 120, bytes: 40000, ok: true, path: 'backups/abcd-school/' + TODAY + '.json', verified: true };
  await set(ADMIN, `${A}/settings/autoBackup`, result);
  await allowed(get('owner-a', `${A}/settings/autoBackup`), 'owner reads');
  await allowed(get('prin', `${A}/settings/autoBackup`), 'principal reads');
  for (const who of ['t1', 'parent-1', 'owner-b', null]) await denied(get(who, `${A}/settings/autoBackup`), 'read by ' + who);
  for (const who of ['owner-a', 'prin']) {
    await denied(set(who, `${A}/settings/autoBackup`, result), 'write by ' + who);
    await denied(remove(who, `${A}/settings/autoBackup`), 'remove by ' + who);
  }
});
