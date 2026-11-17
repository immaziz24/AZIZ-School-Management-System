// Firestore rules tests for siblings.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/siblings.rules.test.mjs"
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
const TODAY = day(0);
const student = (name, no) => ({ admissionNo: no, name, guardianName: 'Parent', guardianPhone: '', status: 'active' });
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const OUTSIDERS = ['parent-1', 'owner-b', null];

const Y = 'y1';
const note = (over = {}) => ({ title: 'Hello', body: 'Notice text', audience: 'class', classId: 'class-9', createdAt: TODAY, createdBy: 'owner-a', ...over });
beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/pupil-1`, { role: 'student', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/s1`, student('Asha', 'A1')],
    [`${A}/students/s2`, student('Ravi', 'A2')],
    [`${A}/students/s3`, student('Tara', 'A3')],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-9`, { name: 'Class 9', order: 9 }],
    [`${A}/classes/class-10`, { name: 'Class 10', order: 10 }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'sec-8a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { yearId: Y, studentId: 's2', classId: 'class-9', sectionId: 'sec-9a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s3`, { yearId: Y, studentId: 's3', classId: 'class-10', sectionId: 'sec-10a', rollNo: 1 }],
    // parent-1 has two children: s1 (main) and s2. parent-2 has one child, s3, and no extras.
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true, extraStudentIds: ['s2'], extraClassIds: ['class-9'] }],
    [`${A}/familyAccess/parent-2`, { studentId: 's3', relation: 'parent', active: true }],
    [P('payments', 'R-1'), { studentId: 's1', yearId: Y, amount: 100, date: TODAY, method: 'cash', receiptNo: 'R-1', receivedBy: 'owner-a' }],
    [P('payments', 'R-2'), { studentId: 's2', yearId: Y, amount: 200, date: TODAY, method: 'cash', receiptNo: 'R-2', receivedBy: 'owner-a' }],
    [P('payments', 'R-3'), { studentId: 's3', yearId: Y, amount: 300, date: TODAY, method: 'cash', receiptNo: 'R-3', receivedBy: 'owner-a' }],
    [P('notices', 'n-8'), note({ classId: 'class-8' })],
    [P('notices', 'n-9'), note({ classId: 'class-9' })],
    [P('notices', 'n-10'), note({ classId: 'class-10' })],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('a parent with two children reads both, and nobody else', async () => {
  for (const id of ['s1', 's2']) await allowed(get('parent-1', P('students', id)), 'student ' + id);
  await denied(get('parent-1', P('students', 's3')), 'unlinked student');
  await allowed(get('parent-1', P('payments', 'R-1')), 'first child payment');
  await allowed(get('parent-1', P('payments', 'R-2')), 'second child payment');
  await denied(get('parent-1', P('payments', 'R-3')), 'someone elses payment');
  await allowed(query('parent-1', A, 'payments', [['studentId', 's2']]), 'list second child');
  await denied(query('parent-1', A, 'payments', [['studentId', 's3']]), 'list unlinked child');
  await allowed(query('parent-1', A, 'enrollments', [['studentId', 's2']]), 'second child placement');
  await denied(query('parent-1', A, 'enrollments', [['studentId', 's3']]), 'unlinked placement');
  await denied(get('parent-2', P('students', 's1')), 'single child parent cannot read s1');
  await denied(get('parent-2', P('students', 's2')), 'single child parent cannot read s2');
  await allowed(get('parent-2', P('students', 's3')), 'own child');
  await denied(get('owner-b', P('students', 's2')), 'other school');
  await denied(get(null, P('students', 's2')), 'anonymous');
});

test('class notices reach every child class, and only those', async () => {
  await allowed(get('parent-1', P('notices', 'n-8')), 'first child class');
  await allowed(get('parent-1', P('notices', 'n-9')), 'second child class');
  await denied(get('parent-1', P('notices', 'n-10')), 'other class');
  await allowed(get('parent-2', P('notices', 'n-10')), 'single child class');
  await denied(get('parent-2', P('notices', 'n-9')), 'single child other class');
  await allowed(query('parent-1', A, 'notices', [['audience', 'class'], ['classId', 'class-9']]), 'list second class');
  await denied(query('parent-1', A, 'notices', [['audience', 'class'], ['classId', 'class-10']]), 'list other class');
});

test('only the owner links children, and the data is checked', async () => {
  const link = (over = {}) => ({ studentId: 's1', relation: 'parent', active: true, extraStudentIds: ['s2'], extraClassIds: ['class-9'], ...over });
  await allowed(set('owner-a', P('familyAccess', 'parent-2'), link({ studentId: 's3', extraStudentIds: ['s1', 's2'], extraClassIds: ['class-8', 'class-9'] })), 'three children');
  await allowed(set('owner-a', P('familyAccess', 'parent-2'), { studentId: 's3', relation: 'parent', active: true }), 'back to one child');
  await denied(set('owner-a', P('familyAccess', 'parent-2'), link({ extraStudentIds: ['a', 'b', 'c', 'd', 'e'] })), 'too many children');
  await denied(set('owner-a', P('familyAccess', 'parent-2'), link({ relation: 'student' })), 'a student login cannot have extra children');
  await denied(set('owner-a', P('familyAccess', 'parent-2'), { studentId: 's1', relation: 'parent', active: true, extraClassIds: ['class-9'] }), 'classes without children');
  await denied(set('owner-a', P('familyAccess', 'parent-2'), { ...link(), extra: 'x' }), 'extra field');
  for (const who of ['parent-1', 'parent-2', 'owner-b', null]) {
    await denied(set(who, P('familyAccess', 'parent-1'), link({ extraStudentIds: ['s3'], extraClassIds: ['class-10'] })), 'self link by ' + who);
  }
  // A switched off parent loses every child.
  await set('owner-a', P('familyAccess', 'parent-1'), link({ active: false }));
  await denied(get('parent-1', P('students', 's1')), 'off: first child');
  await denied(get('parent-1', P('students', 's2')), 'off: second child');
});
