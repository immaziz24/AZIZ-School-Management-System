// Firestore rules tests for Batch 96: a teacher teaching many classes and subjects. Synthetic records only.
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
    [P('classes', 'c5'), { name: 'Class 5', order: 5 }],
    [P('classes', 'c6'), { name: 'Class 6', order: 6 }],
    [P('subjects', 'bengali'), { name: 'Bengali', code: 'BEN' }],
    [P('subjects', 'maths'), { name: 'Maths', code: 'MAT' }],
    [P('classSubjects', 'c5_bengali'), { classId: 'c5', subjectId: 'bengali' }],
    [P('classSubjects', 'c6_bengali'), { classId: 'c6', subjectId: 'bengali' }],
    [P('classSubjects', 'c5_maths'), { classId: 'c5', subjectId: 'maths' }],
    [P('sections', 'c5-a'), { classId: 'c5', name: 'A' }],
    [P('sections', 'c6-a'), { classId: 'c6', name: 'A' }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/tb`, { role: 'teacher', active: true }],
    [P('billing', 'main'), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
    [P('billing', 'main', B), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const slot = (classId, className, subjectId, subject) => ({ uid: 't1', classId, subjectId, className, subject });

test('the owner adds many class-and-subject entries for one teacher', async () => {
  await allowed(set('owner-a', P('teacherSlots', 't1_c5_bengali'), slot('c5', 'Class 5', 'bengali', 'Bengali')), 'class 5 Bengali');
  await allowed(set('owner-a', P('teacherSlots', 't1_c6_bengali'), slot('c6', 'Class 6', 'bengali', 'Bengali')), 'class 6 Bengali');
  await allowed(set('owner-a', P('teacherSlots', 't1_c5_maths'), slot('c5', 'Class 5', 'maths', 'Maths')), 'class 5 Maths');
  await allowed(set('owner-a', P('teacherClasses', 't1_c5'), { uid: 't1', classId: 'c5' }), 'class link');
  await denied(set('owner-a', P('teacherSlots', 't1_c6_maths'), slot('c6', 'Class 6', 'maths', 'Maths')), 'subject not taught in that class');
  await denied(set('owner-a', P('teacherSlots', 't1_c5_bengali'), slot('c5', 'Class Five', 'bengali', 'Bengali')), 'class name must match');
  await denied(set('owner-a', P('teacherSlots', 'wrong-id'), slot('c5', 'Class 5', 'bengali', 'Bengali')), 'id must match');
  await denied(set('owner-a', P('teacherSlots', 't2_c5_bengali'), { ...slot('c5', 'Class 5', 'bengali', 'Bengali'), uid: 't2' }), 'switched-off teacher');
  await denied(set('owner-a', P('teacherSlots', 'prin_c5_bengali'), { ...slot('c5', 'Class 5', 'bengali', 'Bengali'), uid: 'prin' }), 'principal is not a teacher');
  await denied(set('prin', P('teacherSlots', 't1_c5_bengali'), slot('c5', 'Class 5', 'bengali', 'Bengali')), 'principal cannot assign');
  await denied(set('t1', P('teacherSlots', 't1_c5_bengali'), slot('c5', 'Class 5', 'bengali', 'Bengali')), 'teacher cannot assign themself');
  await denied(set('owner-a', P('teacherClasses', 't1_c9'), { uid: 't1', classId: 'c9' }), 'class must exist');
  await allowed(remove('owner-a', P('teacherSlots', 't1_c5_maths')), 'owner removes an entry');
  await denied(remove('t1', P('teacherSlots', 't1_c5_bengali')), 'teacher cannot remove');
});

test('a teacher reads their own entries only, and a slot opens that class', async () => {
  await set(ADMIN, P('teacherSlots', 't1_c6_bengali'), slot('c6', 'Class 6', 'bengali', 'Bengali'));
  await set(ADMIN, P('teacherClasses', 't1_c6'), { uid: 't1', classId: 'c6' });
  await allowed(get('t1', P('teacherSlots', 't1_c6_bengali')), 'reads own entry');
  await allowed(query('t1', A, 'teacherSlots', [['uid', 't1']]), 'lists own entries');
  await denied(get('tb', P('teacherSlots', 't1_c6_bengali')), 'other school teacher');
  await allowed(get('t1', P('sections', 'c6-a')), 'sees a section of a class they teach');
  await denied(get('t1', P('sections', 'c5-a')), 'does not see a class they do not teach');
  await allowed(get('owner-a', P('teacherSlots', 't1_c6_bengali')), 'owner reads');
});

test('a teacher entry for a different school or a suspended school is refused', async () => {
  await set(ADMIN, P('billing', 'main'), { plan: 'standard', status: 'suspended', monthlyPrice: 500 });
  await denied(set('owner-a', P('teacherSlots', 't1_c5_bengali'), slot('c5', 'Class 5', 'bengali', 'Bengali')), 'suspended school');
});

test('the single older assignment can be removed by the owner only', async () => {
  await set(ADMIN, P('teacherAssignments', 't1'), { className: 'Class 5', subject: 'Bengali', classId: 'c5', subjectId: 'bengali' });
  await denied(remove('t1', P('teacherAssignments', 't1')), 'teacher cannot');
  await allowed(remove('owner-a', P('teacherAssignments', 't1')), 'owner can');
});
