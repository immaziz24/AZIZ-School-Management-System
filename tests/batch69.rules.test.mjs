// Firestore rules tests for batch 69: approval requests from teachers and the principal.
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
    [`${A}/members/t2`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const R = (id = 'AR-1') => `${A}/approvalRequests/${id}`;
const req = (by, extra = {}) => ({ kind: 'purchase', title: '20 whiteboard markers', amount: 500, requestedBy: by, requestedByName: 'Teacher One', createdOn: '2026-11-23', status: 'pending', ...extra });

test('approval requests: a teacher or the principal asks as pending, for themselves only', async () => {
  await allowed(set('t1', R('AR-1'), req('t1', { note: 'For class 5' })), 'teacher asks');
  await allowed(set('prin', R('AR-2'), req('prin', { requestedByName: 'Principal', kind: 'repair' })), 'principal asks');
  await denied(set('t1', R('AR-3'), req('t2')), 'for someone else');
  await denied(set('t1', R('AR-3'), req('t1', { status: 'approved' })), 'cannot self-approve');
  await denied(set('t1', R('AR-3'), req('t1', { decidedBy: 't1' })), 'no decision fields');
  for (const who of ['owner-a', 'parent-1', 'owner-b', null]) await denied(set(who, R('AR-4'), req(who ?? 'x')), 'create by ' + who);
  await denied(set('t1', R('bad id'), req('t1')), 'bad id');
  await denied(set('t1', R('AR-5'), req('t1', { title: '' })), 'no title');
  await denied(set('t1', R('AR-5'), req('t1', { kind: 'gift' })), 'unknown kind');
  await denied(set('t1', R('AR-5'), req('t1', { amount: -5 })), 'negative amount');
  await denied(set('t1', R('AR-5'), req('t1', { extra: 'x' })), 'unknown field');
});

test('approval requests: owner and principal read all, a teacher reads only their own', async () => {
  await allowed(set('t1', R(), req('t1')), 'ask');
  for (const who of ['owner-a', 'prin', 't1']) await allowed(get(who, R()), 'read by ' + who);
  for (const who of ['t2', 'parent-1', 'owner-b', null]) await denied(get(who, R()), 'read by ' + who);
});

test('approval requests: only the owner decides, once, changing nothing else', async () => {
  await allowed(set('t1', R(), req('t1')), 'ask');
  const decided = (extra = {}) => req('t1', { status: 'approved', decidedBy: 'owner-a', decidedOn: '2026-11-24', ...extra });
  for (const who of ['prin', 't1', 't2', 'owner-b']) await denied(set(who, R(), decided({ decidedBy: who })), 'decide by ' + who);
  await denied(set('owner-a', R(), decided({ decidedBy: 'prin' })), 'decidedBy must be the owner');
  await denied(set('owner-a', R(), decided({ title: 'Changed' })), 'cannot edit the request');
  await denied(set('owner-a', R(), decided({ amount: 9000 })), 'cannot edit the amount');
  await allowed(set('owner-a', R(), decided({ decisionNote: 'Buy from the local shop' })), 'owner approves');
  await denied(set('owner-a', R(), decided({ status: 'rejected' })), 'decided only once');
});

test('approval requests: withdraw while pending, owner may delete', async () => {
  await allowed(set('t1', R('AR-1'), req('t1')), 'ask 1');
  await allowed(set('t1', R('AR-2'), req('t1')), 'ask 2');
  await denied(remove('t2', R('AR-1')), 'other teacher');
  await allowed(remove('t1', R('AR-1')), 'withdraw own pending');
  await allowed(set('owner-a', R('AR-2'), req('t1', { status: 'rejected', decidedBy: 'owner-a', decidedOn: '2026-11-24' })), 'owner rejects');
  await denied(remove('t1', R('AR-2')), 'cannot withdraw a decided request');
  await allowed(remove('owner-a', R('AR-2')), 'owner deletes');
});
