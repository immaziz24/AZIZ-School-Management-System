// Firestore rules tests for batch 68: automatic fee reminder settings, security alerts and server job results.
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

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    ['platformAdmins/padmin', { active: true }],
    [`${A}/securityAlerts/A-1`, { at: '2026-11-23T10:00:00.000Z', level: 'high', title: 'A payment was voided', detail: 'payments P-1 (Rs 500)', actor: 'owner-a', seen: false }],
    [`${A}/settings/autoRemindersLog`, { date: '2026-11-23', sent: 3, skipped: 1 }],
    ['platformJobs/health', { ok: true, firestoreMs: 40, storageMs: 80, schools: 1 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const R = `${A}/settings/autoReminders`;
const setting = (extra = {}) => ({ on: true, min: 500, everyDays: 7, ...extra });

test('automatic fee reminders: only the owner saves valid settings; owner and principal read', async () => {
  await allowed(set('owner-a', R, setting({ message: 'Please pay this week.' })), 'owner saves');
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, R, setting()), 'save by ' + who);
  await denied(set('owner-a', R, setting({ min: 0 })), 'minimum below 1');
  await denied(set('owner-a', R, setting({ everyDays: 0 })), 'days below 1');
  await denied(set('owner-a', R, setting({ everyDays: 61 })), 'days above 60');
  await denied(set('owner-a', R, setting({ on: 'yes' })), 'on must be true or false');
  await denied(set('owner-a', R, setting({ extra: 'x' })), 'unknown field');
  await denied(set('owner-a', R, { on: true }), 'missing fields');
  await allowed(get('owner-a', R), 'owner reads');
  await allowed(get('prin', R), 'principal reads');
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, R), 'read by ' + who);
});

test('automatic fee reminders: the run note is read-only for everyone', async () => {
  const log = `${A}/settings/autoRemindersLog`;
  await allowed(get('owner-a', log), 'owner reads');
  await allowed(get('prin', log), 'principal reads');
  for (const who of ['owner-a', 'prin']) await denied(set(who, log, { date: '2026-11-24', sent: 9, skipped: 0 }), 'write by ' + who);
  await denied(remove('owner-a', log), 'delete');
});

test('security alerts: school staff read, nobody creates, the owner only marks seen or deletes', async () => {
  const alert = `${A}/securityAlerts/A-1`;
  for (const who of ['owner-a', 'prin']) await allowed(get(who, alert), 'read by ' + who);
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, alert), 'read by ' + who);
  for (const who of ['owner-a', 'prin', 't1']) await denied(set(who, `${A}/securityAlerts/A-2`, { at: '2026-11-23T10:00:00.000Z', level: 'low', title: 'x', detail: 'y', actor: 'z', seen: false }), 'create by ' + who);
  const base = { at: '2026-11-23T10:00:00.000Z', level: 'high', title: 'A payment was voided', detail: 'payments P-1 (Rs 500)', actor: 'owner-a' };
  await allowed(set('owner-a', alert, { ...base, seen: true }), 'owner marks seen');
  await denied(set('prin', alert, { ...base, seen: true }), 'principal cannot change');
  await denied(set('owner-a', alert, { ...base, seen: true, title: 'Edited' }), 'owner cannot edit the text');
  await denied(set('owner-a', alert, { ...base, level: 'low', seen: true }), 'owner cannot lower the level');
  await denied(remove('prin', alert), 'principal cannot delete');
  await denied(remove('owner-b', alert), 'other school owner cannot delete');
  await allowed(remove('owner-a', alert), 'owner deletes');
});

test('server job results: only the platform administrator reads, nobody writes', async () => {
  await allowed(get('padmin', 'platformJobs/health'), 'admin reads');
  for (const who of ['owner-a', 'prin', 't1', null]) await denied(get(who, 'platformJobs/health'), 'read by ' + who);
  for (const who of ['padmin', 'owner-a']) await denied(set(who, 'platformJobs/health', { ok: false }), 'write by ' + who);
  await denied(remove('padmin', 'platformJobs/health'), 'delete');
});
