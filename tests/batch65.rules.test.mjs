// Firestore rules tests for batch 65: online test progress (one question at a time, pause and resume, time left).
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
    [`${A}/onlineTests/OT-1`, { status: 'open', durationMin: 30 }],
    [`${A}/onlineTests/OT-2`, { status: 'closed', durationMin: 30 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});


const progress = (extra = {}) => ({ testId: 'OT-1', studentId: 's1', by: 'parent-1', answers: 'x,x,x,x,x', index: 0, remainingSec: 1800, pauses: 0, state: 'running', ...extra });
const save = (who, data, id = 'OT-1_s1') => writeWithTime(who, `${A}/onlineProgress/${id}`, data, 'at');

test('test progress: a family starts its own student test once, with full time and no pauses used', async () => {
  await allowed(save('parent-1', progress()), 'family starts');
  await denied(save('parent-2', progress()), "another family's student");
  await denied(save('parent-1', progress({ by: 'parent-2' })), 'by must be the signed-in user');
  await denied(save('parent-1', progress({ remainingSec: 1801 })), 'more time than the test allows');
  await denied(save('parent-1', progress({ pauses: 1 })), 'a new start has no pauses used');
  await denied(save('parent-1', progress({ state: 'paused' })), 'a new start is running');
  await denied(save('parent-1', progress({ answers: 'x,9' })), 'bad answers');
  await denied(save('parent-1', progress({ index: 60 })), 'place out of range');
  await denied(save('parent-1', progress({ extra: 1 })), 'unknown field');
  await denied(save('parent-1', progress({ testId: 'OT-2' }), 'OT-2_s1'), 'a closed test');
  await denied(set('parent-1', `${A}/onlineProgress/OT-1_s1`, progress({ at: new Date() })), 'client time not accepted');
  await denied(save('parent-1', progress(), 'wrong-id'), 'document id must be testId_studentId');
  for (const who of ['owner-a', 'prin', 't1', null]) await denied(save(who, progress({ by: who ?? 'x' })), 'write by ' + who);
});

test('test progress: answers and place can be saved, time only goes down, one pause per step, seven at most', async () => {
  await allowed(save('parent-1', progress()), 'start');
  await allowed(save('parent-1', progress({ answers: '1,x,x,x,x', index: 1, remainingSec: 1700 })), 'save and next');
  await denied(save('parent-1', progress({ answers: '1,x,x,x,x', index: 1, remainingSec: 1750 })), 'time cannot go back up');
  await denied(save('parent-1', progress({ remainingSec: 1600, pauses: 1 })), 'pause count rises only with a pause');
  await allowed(save('parent-1', progress({ remainingSec: 1650, pauses: 1, state: 'paused' })), 'pause');
  await denied(save('parent-1', progress({ remainingSec: 1650, pauses: 3, state: 'paused' })), 'cannot jump several pauses');
  await allowed(save('parent-1', progress({ remainingSec: 1650, pauses: 1, state: 'running' })), 'resume');
  await denied(save('parent-1', progress({ remainingSec: 1640, pauses: 1, state: 'paused' })), 'pausing must add a pause');
  for (let pause = 2; pause <= 7; pause += 1) {
    await allowed(save('parent-1', progress({ remainingSec: 1600, pauses: pause, state: 'paused' })), 'pause ' + pause);
    await allowed(save('parent-1', progress({ remainingSec: 1600, pauses: pause, state: 'running' })), 'resume ' + pause);
  }
  await denied(save('parent-1', progress({ remainingSec: 1600, pauses: 8, state: 'paused' })), 'an eighth pause');
  await denied(save('parent-2', progress()), 'another family cannot overwrite');
  await set(ADMIN, `${A}/onlineTests/OT-1`, { status: 'closed', durationMin: 30 });
  await denied(save('parent-1', progress({ remainingSec: 1500, pauses: 7 })), 'no saving after the test closes');
});

test('test progress: reading and deleting', async () => {
  await set(ADMIN, `${A}/onlineProgress/OT-1_s1`, progress({ at: new Date() }));
  await set(ADMIN, `${A}/onlineProgress/OT-1_s2`, progress({ studentId: 's2', by: 'parent-2', at: new Date() }));
  await allowed(get('parent-1', `${A}/onlineProgress/OT-1_s1`), 'family reads its own');
  await denied(get('parent-1', `${A}/onlineProgress/OT-1_s2`), "another family's");
  await allowed(query('parent-1', A, 'onlineProgress', [['by', 'parent-1']]), 'family lists its own');
  await denied(query('parent-1', A, 'onlineProgress', [['by', 'parent-2']]), "family lists another's");
  await allowed(get('owner-a', `${A}/onlineProgress/OT-1_s2`), 'owner reads');
  await allowed(get('prin', `${A}/onlineProgress/OT-1_s2`), 'principal reads');
  await denied(get('t1', `${A}/onlineProgress/OT-1_s1`), 'teacher');
  await denied(get('owner-b', `${A}/onlineProgress/OT-1_s1`), 'other school');
  await denied(remove('parent-1', `${A}/onlineProgress/OT-1_s1`), 'family deletes');
  await denied(remove('owner-a', `${A}/onlineProgress/OT-1_s1`), 'owner deletes');
});
