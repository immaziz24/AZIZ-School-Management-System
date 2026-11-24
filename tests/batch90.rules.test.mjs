// Firestore rules tests for Batch 90: the non-teaching staff role and departments with heads of department. Synthetic records only.
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
    email: uid + '@example.com', email_verified: true,
    firebase: { sign_in_provider: 'password', identities: {} },
  }) + '.';
};
const ADMIN = 'owner'; // Emulator-only token that bypasses rules, used for seeding.

const encode = (value) => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value && typeof value === 'object' && value.ts) return { timestampValue: value.ts };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
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
  const where = filters.length === 0 ? undefined : filters.length === 1 ? fieldFilter(filters[0])
    : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
  const response = await fetch(`${base}${parent ? '/' + parent : ''}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}) } }),
  });
  await response.arrayBuffer();
  return response.status;
};

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const TODAY = iso(0).slice(0, 10);
const docName = (path) => `projects/${project}/databases/(default)/documents/${path}`;
// A batched write, so that getAfter rules see the whole batch. times lists fields set to the server time.
const commit = async (who, writes) => {
  const body = { writes: writes.map((w) => ({
    update: { name: docName(w.path), fields: fields(w.data) },
    ...(w.times ? { updateTransforms: w.times.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
    ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
  })) };
  const response = await fetch(`${base}:commit`, { method: 'POST', headers: headers(who), body: JSON.stringify(body) });
  await response.arrayBuffer();
  return response.status;
};

const profile = { name: 'New School', contactEmail: 'n@s.in', phone: '98300 00000', address: 'Town' };

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [A, { ...profile, name: 'ABCD School' }],
    [B, { ...profile, name: 'Second School' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/t2`, { role: 'teacher', active: false }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/tb`, { role: 'teacher', active: true }],
    [P('billing', 'main'), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
    [P('billing', 'main', B), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const staffInvite = { schoolId: 'abcd-school', email: 'clerk@example.com', role: 'staff', status: 'pending', createdBy: 'owner-a' };

test('the owner can invite non-teaching staff, and only known roles', async () => {
  await allowed(set('owner-a', 'invites/IN-1', staffInvite), 'owner invites staff');
  await denied(set('owner-a', 'invites/IN-2', { ...staffInvite, role: 'janitor' }), 'unknown role');
  await denied(set('prin', 'invites/IN-3', staffInvite), 'principal cannot invite');
  await denied(set('t1', 'invites/IN-4', staffInvite), 'teacher cannot invite');
});

test('an invited clerk accepts and becomes staff, with no access to school records', async () => {
  await set(ADMIN, 'invites/IN-1', staffInvite);
  const accept = (uid, role = 'staff') => [
    { path: 'invites/IN-1', data: { ...staffInvite, status: 'accepted' } },
    { path: `${A}/members/${uid}`, data: { role, active: true, inviteId: 'IN-1' } },
  ];
  await denied(commit('stranger', accept('stranger')), 'stranger cannot accept');
  await denied(commit('clerk', accept('clerk', 'teacher')), 'cannot take a bigger role');
  // The invitation email must match the signed-in email, which the test token builds from the uid.
  await set(ADMIN, 'invites/IN-1', { ...staffInvite, email: 'clerk@example.com' });
  await allowed(commit('clerk', accept('clerk')), 'accepts as staff');
  await allowed(get('clerk', `${A}/members/clerk`), 'reads own member record');
  await denied(get('clerk', P('students', 's1')), 'no student records');
  await denied(get('clerk', P('departments', 'science')), 'no department list');
  await denied(get('clerk', `${A}/members/t1`), 'no other member records');
  await denied(set('clerk', P('classTeachers', 'c1'), { teacherUid: 't1' }), 'no class teacher change');
});

const dept = { name: 'Science', hodUid: 't1' };

test('departments: the owner sets a head of department who must be an active teacher', async () => {
  await allowed(set('owner-a', P('departments', 'science'), dept), 'owner creates');
  await allowed(set('owner-a', P('departments', 'science'), { ...dept, hodUid: 't1' }), 'owner updates');
  await denied(set('owner-a', P('departments', 'maths'), { name: 'Maths', hodUid: 'prin' }), 'principal is not a teacher');
  await denied(set('owner-a', P('departments', 'maths'), { name: 'Maths', hodUid: 't2' }), 'switched-off teacher');
  await denied(set('owner-a', P('departments', 'maths'), { name: 'Maths', hodUid: 'tb' }), 'teacher of another school');
  await denied(set('owner-a', P('departments', 'maths'), { name: 'Maths', hodUid: 'nobody' }), 'not a member');
  await denied(set('owner-a', P('departments', 'maths'), { name: '   ', hodUid: 't1' }), 'blank name');
  await denied(set('owner-a', P('departments', 'maths'), { name: 'x'.repeat(61), hodUid: 't1' }), 'name too long');
  await denied(set('owner-a', P('departments', 'maths'), { name: 'Maths', hodUid: 't1', extra: 'x' }), 'extra field');
  await denied(set('owner-a', P('departments', 'BadId'), dept), 'bad id');
  await denied(set('owner-a', P('departments', 'a'.repeat(31)), dept), 'id too long');
});

test('departments: only the owner writes; the principal and teachers read; other schools cannot', async () => {
  await set(ADMIN, P('departments', 'science'), dept);
  for (const who of ['prin', 't1', 'owner-b', 'tb', 'stranger', null]) {
    await denied(set(who, P('departments', 'maths'), { name: 'Maths', hodUid: 't1' }), 'write by ' + who);
    await denied(remove(who, P('departments', 'science')), 'delete by ' + who);
  }
  await allowed(get('owner-a', P('departments', 'science')), 'owner reads');
  await allowed(get('prin', P('departments', 'science')), 'principal reads');
  await allowed(get('t1', P('departments', 'science')), 'teacher reads');
  for (const who of ['owner-b', 'tb', 'stranger', null]) await denied(get(who, P('departments', 'science')), 'read by ' + who);
  await allowed(query('prin', A, 'departments', []), 'principal lists');
  await denied(query('owner-b', A, 'departments', []), 'other school lists');
  await allowed(remove('owner-a', P('departments', 'science')), 'owner deletes');
});

test('a suspended school cannot change its departments', async () => {
  await set(ADMIN, P('billing', 'main'), { plan: 'standard', status: 'suspended', monthlyPrice: 500 });
  await denied(set('owner-a', P('departments', 'science'), dept), 'suspended owner writes');
});
