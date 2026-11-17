// Firestore rules tests for leave requests.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/leave.rules.test.mjs"
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
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  throw new Error('Unsupported value');
};
const fields = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
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
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const FROM = day(3);
const TO = day(5);

const req = (over = {}) => ({ staffUid: 't1', fromDate: FROM, toDate: TO, reason: 'Family function', status: 'pending', ...over });
const path = (r = req(), school = A) => `${school}/leaveRequests/${r.staffUid}_${r.fromDate}`;
const decided = (over = {}) => req({ status: 'approved', decidedBy: 'owner-a', ...over });

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/t2`, { role: 'teacher', active: true }],
    [`${A}/members/t-off`, { role: 'teacher', active: false }],
    [`${A}/members/parent-a`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/tb`, { role: 'teacher', active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('an active teacher can request leave for themselves', async () => {
  await allowed(set('t1', path(), req()), 'create');
  await allowed(set('t1', path(req({ fromDate: day(10), toDate: day(10) })), req({ fromDate: day(10), toDate: day(10) })), 'one-day leave');
  await allowed(set('t2', path(req({ staffUid: 't2' })), req({ staffUid: 't2' })), 'another teacher');
});

test('only an active teacher can request, and only for themselves', async () => {
  await denied(set('t1', path(req({ staffUid: 't2' })), req({ staffUid: 't2' })), 'for another teacher');
  await denied(set('t-off', path(req({ staffUid: 't-off' })), req({ staffUid: 't-off' })), 'inactive teacher');
  await denied(set('parent-a', path(req({ staffUid: 'parent-a' })), req({ staffUid: 'parent-a' })), 'parent');
  await denied(set('owner-a', path(req({ staffUid: 'owner-a' })), req({ staffUid: 'owner-a' })), 'owner is not a teacher');
  await denied(set('tb', path(req({ staffUid: 'tb' })), req({ staffUid: 'tb' })), 'teacher of another school');
  await denied(set(null, path(), req()), 'signed out');
});

test('a request must start pending and be well formed', async () => {
  await denied(set('t1', path(), req({ status: 'approved' })), 'self approve');
  await denied(set('t1', path(), req({ status: 'approved', decidedBy: 't1' })), 'self approve with decidedBy');
  await denied(set('t1', path(), req({ decidedBy: 'owner-a' })), 'pending with decidedBy');
  await denied(set('t1', path(), req({ toDate: day(2) })), 'ends before it starts');
  await denied(set('t1', path(req({ fromDate: '2019-12-31' })), req({ fromDate: '2019-12-31', toDate: '2020-01-02' })), 'before 2020');
  await denied(set('t1', path(), req({ fromDate: '3-12-2026' })), 'bad date');
  await denied(set('t1', path(), req({ reason: '   ' })), 'blank reason');
  await denied(set('t1', path(), req({ reason: 'x'.repeat(201) })), 'reason too long');
  await denied(set('t1', path(), { ...req(), extra: 'x' }), 'extra field');
  await denied(set('t1', `${A}/leaveRequests/random`, req()), 'wrong ID');
});

test('a teacher cannot change or re-submit a request', async () => {
  await allowed(set('t1', path(), req()), 'create');
  await denied(set('t1', path(), req({ reason: 'Changed' })), 'edit reason');
  await denied(set('t1', path(), req({ status: 'approved', decidedBy: 't1' })), 'self approve');
  await denied(set('t1', path(), req({ toDate: day(9) })), 'extend');
});

test('the owner approves or rejects a pending request, once', async () => {
  await allowed(set('t1', path(), req()), 'create');
  await allowed(set('owner-a', path(), decided()), 'approve');
  await denied(set('owner-a', path(), decided({ status: 'rejected' })), 'cannot change a decision');
  await allowed(set('t2', path(req({ staffUid: 't2' })), req({ staffUid: 't2' })), 'second request');
  await allowed(set('owner-a', path(req({ staffUid: 't2' })), decided({ staffUid: 't2', status: 'rejected' })), 'reject');
});

test('the owner can decide only the status, and decidedBy must be the owner', async () => {
  await allowed(set('t1', path(), req()), 'create');
  await denied(set('owner-a', path(), decided({ decidedBy: 't1' })), 'decidedBy is someone else');
  await denied(set('owner-a', path(), req({ status: 'approved' })), 'no decidedBy');
  await denied(set('owner-a', path(), decided({ reason: 'Changed by owner' })), 'owner edits reason');
  await denied(set('owner-a', path(), decided({ toDate: day(8) })), 'owner edits dates');
  await denied(set('owner-a', path(), decided({ status: 'pending' })), 'back to pending');
  await denied(set('owner-b', path(), decided({ decidedBy: 'owner-b' })), 'owner of another school');
  await denied(set('t2', path(), decided({ decidedBy: 't2' })), 'other teacher');
  await denied(set('parent-a', path(), decided({ decidedBy: 'parent-a' })), 'parent');
});

test('the owner reads all requests; a teacher reads only their own', async () => {
  await allowed(set('t1', path(), req()), 'seed t1');
  await allowed(set('t2', path(req({ staffUid: 't2' })), req({ staffUid: 't2' })), 'seed t2');
  await allowed(get('owner-a', path()), 'owner get');
  await allowed(get('t1', path()), 'teacher own');
  await denied(get('t1', path(req({ staffUid: 't2' }))), 'teacher other');
  await denied(get('parent-a', path()), 'parent');
  await denied(get('owner-b', path()), 'owner of another school');
  await denied(get(null, path()), 'signed out');
  await allowed(query('owner-a', A, 'leaveRequests', [['status', 'pending']]), 'owner lists pending');
  await allowed(query('t1', A, 'leaveRequests', [['staffUid', 't1']]), 'teacher lists own');
  await denied(query('t1', A, 'leaveRequests', [['staffUid', 't2']]), 'teacher lists other');
  await denied(query('t1', A, 'leaveRequests', [['status', 'pending']]), 'teacher lists all pending');
});

test('leave requests cannot be deleted', async () => {
  await allowed(set('t1', path(), req()), 'create');
  await denied(remove('t1', path()), 'teacher delete');
  await denied(remove('owner-a', path()), 'owner delete');
  await denied(remove('t2', path()), 'other teacher delete');
});
