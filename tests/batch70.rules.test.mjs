// Firestore rules tests for batch 70: extra storage requests.
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
    [`${A}/billing/main`, { plan: 'basic', status: 'active', storageMb: 1000 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const Q = (id = 'SR-1') => `storageRequests/${id}`;
const ask = (extra = {}) => ({ schoolId: 'abcd-school', mb: 1000, status: 'pending', createdBy: 'owner-a', createdOn: '2026-11-23', ...extra });

test('storage requests: only the school owner asks, as pending, for their own school', async () => {
  await allowed(set('owner-a', Q(), ask({ note: 'More photos this year' })), 'owner asks');
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, Q('SR-2'), ask({ createdBy: who ?? 'x' })), 'ask by ' + who);
  await denied(set('owner-b', Q('SR-3'), ask({ createdBy: 'owner-b' })), 'other school owner for this school');
  await denied(set('owner-a', Q('SR-3'), ask({ status: 'approved' })), 'cannot self-approve');
  await denied(set('owner-a', Q('SR-3'), ask({ mb: 50 })), 'too small');
  await denied(set('owner-a', Q('SR-3'), ask({ mb: 100001 })), 'too large');
  await denied(set('owner-a', Q('SR-3'), ask({ reply: 'ok' })), 'no reply on create');
  await denied(set('owner-a', Q('SR-3'), ask({ createdBy: 'prin' })), 'createdBy must be the signed-in user');
  await denied(set('owner-a', Q('bad id'), ask()), 'bad id');
});

test('storage requests: the school and the platform administrator read; others do not', async () => {
  await allowed(set('owner-a', Q(), ask()), 'ask');
  for (const who of ['owner-a', 'prin', 'padmin']) await allowed(get(who, Q()), 'read by ' + who);
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, Q()), 'read by ' + who);
});

test('storage requests: only the platform administrator decides, once, and may raise the limit', async () => {
  await allowed(set('owner-a', Q(), ask()), 'ask');
  const decided = (extra = {}) => ask({ status: 'approved', decidedOn: '2026-11-24', ...extra });
  for (const who of ['owner-a', 'prin', 'owner-b']) await denied(set(who, Q(), decided()), 'decide by ' + who);
  await denied(set('padmin', Q(), decided({ mb: 5000 })), 'cannot change the size');
  await allowed(set('padmin', Q(), decided({ reply: 'Approved' })), 'admin approves');
  await denied(set('padmin', Q(), decided({ status: 'rejected' })), 'decided only once');
  await denied(remove('padmin', Q()), 'no delete');
  await allowed(set('padmin', `${A}/billing/main`, { plan: 'basic', status: 'active', storageMb: 2000 }), 'admin raises limit');
  await denied(set('owner-a', `${A}/billing/main`, { plan: 'basic', status: 'active', storageMb: 99999 }), 'owner cannot raise the limit');
});
