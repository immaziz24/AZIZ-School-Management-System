// Firestore rules tests for Batch 91: admission/office staff role, enquiries, and the first-password flag. Synthetic records only.
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
    [`${A}/members/off`, { role: 'office', active: true }],
    [`${A}/members/off2`, { role: 'office', active: false }],
    [`${A}/members/par`, { role: 'parent', active: true, mustChange: true }],
    [`${A}/members/par2`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/tb`, { role: 'teacher', active: true }],
    [P('billing', 'main'), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
    [P('billing', 'main', B), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const officeInvite = { schoolId: 'abcd-school', email: 'desk@example.com', role: 'office', status: 'pending', createdBy: 'owner-a' };
const enquiry = { studentName: 'Asha Rao', classApplying: 'Class 6', guardianName: 'S Rao', phone: '9830000000', createdAt: TODAY, status: 'new' };

test('the owner can invite admission staff, who accept as the office role', async () => {
  await allowed(set('owner-a', 'invites/IN-1', officeInvite), 'owner invites office staff');
  await denied(set('prin', 'invites/IN-2', officeInvite), 'principal cannot invite');
  await set(ADMIN, 'invites/IN-1', { ...officeInvite, email: 'desk@example.com' });
  const accept = (role) => [
    { path: 'invites/IN-1', data: { ...officeInvite, status: 'accepted' } },
    { path: `${A}/members/desk`, data: { role, active: true, inviteId: 'IN-1' } },
  ];
  await allowed(commit('desk', accept('office')), 'accepts as office');
  await denied(commit('desk', accept('owner')), 'cannot take a bigger role');
});

test('office staff read and move enquiries but see nothing else', async () => {
  await set(ADMIN, P('enquiries', 'EQ-1'), enquiry);
  await set(ADMIN, P('students', 's1'), { admissionNo: 'S1', name: 'X', guardianName: 'Y', guardianPhone: '1', status: 'active' });
  await allowed(get('off', P('enquiries', 'EQ-1')), 'office reads enquiry');
  await allowed(query('off', A, 'enquiries', []), 'office lists enquiries');
  await allowed(set('off', P('enquiries', 'EQ-1'), { ...enquiry, status: 'contacted', note: 'called' }), 'office moves the stage');
  await denied(set('off', P('enquiries', 'EQ-1'), { ...enquiry, studentName: 'Changed' }), 'office cannot change the details');
  await denied(get('off', P('students', 's1')), 'no student records');
  await denied(get('off', P('payments', 'p1')), 'no payments');
  await denied(set('off', P('students', 's2'), { admissionNo: 'S2', name: 'X', guardianName: 'Y', guardianPhone: '1', status: 'active' }), 'no direct student writes');
  await denied(get('off2', P('enquiries', 'EQ-1')), 'switched-off office');
  await denied(get('t1', P('enquiries', 'EQ-1')), 'teacher cannot read');
  await denied(get('tb', P('enquiries', 'EQ-1')), 'other school teacher');
});

test('office staff of a suspended school are read-only', async () => {
  await set(ADMIN, P('enquiries', 'EQ-1'), enquiry);
  await set(ADMIN, P('billing', 'main'), { plan: 'standard', status: 'suspended', monthlyPrice: 500 });
  await denied(get('off', P('enquiries', 'EQ-1')), 'suspended school');
});

test('a new family login clears its own first-password flag and nothing else', async () => {
  await allowed(set('par', `${A}/members/par`, { role: 'parent', active: true, mustChange: false }), 'clears own flag');
  await denied(set('par2', `${A}/members/par2`, { role: 'parent', active: true, mustChange: false }), 'no flag to clear');
  await denied(set('par', `${A}/members/par`, { role: 'owner', active: true, mustChange: false }), 'cannot change the role');
  await denied(set('par', `${A}/members/par`, { role: 'parent', active: true, mustChange: true }), 'cannot set it again');
  await denied(set('par2', `${A}/members/par`, { role: 'parent', active: true, mustChange: false }), 'another person cannot clear it');
});
