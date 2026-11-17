// Firestore rules tests for fees.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/fees.rules.test.mjs"
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
const Y = '2026-27';
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

const fee = (over = {}) => ({ yearId: Y, classId: 'class-8', head: 'tuition', name: 'Tuition fee', amount: 500, ...over });
const feePath = (f = fee(), school = A) => `${school}/feeStructures/${f.yearId}_${f.classId}_${f.head}`;
const pay = (over = {}) => ({
  studentId: 's1', yearId: Y, amount: 300, date: TODAY, method: 'cash', receiptNo: 'R-0001', receivedBy: 'owner-a', ...over,
});
const payPath = (p = pay(), school = A) => `${school}/payments/${p.receiptNo}`;

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/pupil-off`, { role: 'student', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [`${A}/familyAccess/pupil-off`, { studentId: 's1', relation: 'student', active: false }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { yearId: Y, studentId: 's2', classId: 'class-8', sectionId: 'class-8-a', rollNo: 2 }],
    [`${A}/academicYears/${Y}`, { label: Y, startDate: day(-100), endDate: day(200), status: 'active' }],
    ...['s1', 's2'].map((id) => [`${A}/students/${id}`,
      { admissionNo: id, name: 'Test Student ' + id, guardianName: 'Test Guardian', guardianPhone: '', status: 'active' }]),
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('owner can set, change and remove a fee structure', async () => {
  await allowed(set('owner-a', feePath(), fee()), 'create');
  await allowed(set('owner-a', feePath(), fee({ amount: 600 })), 'change amount');
  await allowed(set('owner-a', feePath(fee({ head: 'exam' })), fee({ head: 'exam', name: 'Exam fee', amount: 0 })), 'zero amount');
  await allowed(remove('owner-a', feePath()), 'remove');
});

test('fee structures reject bad input and non-owners', async () => {
  await denied(set('t1', feePath(), fee()), 'teacher');
  await denied(set('parent-1', feePath(), fee()), 'parent');
  await denied(set('owner-b', feePath(), fee()), 'owner of another school');
  await denied(set(null, feePath(), fee()), 'signed out');
  await denied(set('owner-a', feePath(), fee({ amount: -1 })), 'negative');
  await denied(set('owner-a', feePath(), fee({ amount: 10000001 })), 'too large');
  await denied(set('owner-a', feePath(), fee({ name: '  ' })), 'blank name');
  await denied(set('owner-a', feePath(), { ...fee(), extra: 'x' }), 'extra field');
  await denied(set('owner-a', feePath(fee({ yearId: 'no-year' })), fee({ yearId: 'no-year' })), 'unknown year');
  await denied(set('owner-a', feePath(fee({ classId: 'class-9' })), fee({ classId: 'class-9' })), 'unknown class');
  await denied(set('owner-a', `${A}/feeStructures/random`, fee()), 'wrong ID');
  await allowed(set('owner-a', feePath(), fee()), 'seed');
  await denied(remove('t1', feePath()), 'teacher remove');
  await denied(remove('parent-1', feePath()), 'parent remove');
});

test('the owner and active family accounts read fee structures; teachers and strangers cannot', async () => {
  await allowed(set('owner-a', feePath(), fee()), 'seed');
  await allowed(get('owner-a', feePath()), 'owner');
  await allowed(get('parent-1', feePath()), 'parent');
  await allowed(get('parent-2', feePath()), 'other parent (class fee list is not private)');
  await denied(get('pupil-off', feePath()), 'switched-off student');
  await denied(get('t1', feePath()), 'teacher');
  await denied(get('owner-b', feePath()), 'owner of another school');
  await denied(get(null, feePath()), 'signed out');
});

test('owner can record payments with a receipt number', async () => {
  await allowed(set('owner-a', payPath(), pay()), 'cash');
  await allowed(set('owner-a', payPath(pay({ receiptNo: 'R-0002' })), pay({ receiptNo: 'R-0002', method: 'upi', amount: 1 })), 'upi');
  await allowed(set('owner-a', payPath(pay({ receiptNo: 'R-0003' })), pay({ receiptNo: 'R-0003', method: 'bank', date: day(-30) })), 'bank, earlier date');
  await allowed(set('owner-a', payPath(pay({ receiptNo: 'R-0004' })), pay({ receiptNo: 'R-0004', method: 'cheque', date: day(1) })), 'cheque, tomorrow');
});

test('only the owner can record payments, and the record must be valid', async () => {
  await denied(set('t1', payPath(), pay({ receivedBy: 't1' })), 'teacher');
  await denied(set('parent-1', payPath(), pay({ receivedBy: 'parent-1' })), 'parent pays themselves');
  await denied(set('owner-b', payPath(), pay({ receivedBy: 'owner-b' })), 'owner of another school');
  await denied(set(null, payPath(), pay()), 'signed out');
  await denied(set('owner-a', payPath(), pay({ receivedBy: 't1' })), 'receivedBy is not the signed-in owner');
  await denied(set('owner-a', payPath(), pay({ amount: 0 })), 'zero');
  await denied(set('owner-a', payPath(), pay({ amount: -50 })), 'negative');
  await denied(set('owner-a', payPath(), pay({ amount: 10000001 })), 'too large');
  await denied(set('owner-a', payPath(), pay({ method: 'barter' })), 'bad method');
  await denied(set('owner-a', payPath(), pay({ date: day(2) })), 'future date');
  await denied(set('owner-a', payPath(), pay({ date: '2019-12-31' })), 'before 2020');
  await denied(set('owner-a', payPath(), pay({ studentId: 'ghost' })), 'unknown student');
  await denied(set('owner-a', payPath(), pay({ yearId: 'no-year' })), 'unknown year');
  await denied(set('owner-a', payPath(), { ...pay(), voided: true }), 'created already voided');
  await denied(set('owner-a', payPath(), { ...pay(), extra: 'x' }), 'extra field');
  await denied(set('owner-a', `${A}/payments/other`, pay()), 'ID is not the receipt number');
  await denied(set('owner-a', payPath(pay({ receiptNo: 'bad receipt' })), pay({ receiptNo: 'bad receipt' })), 'bad receipt number');
});

test('a payment cannot be edited or deleted, and a duplicate receipt cannot overwrite it', async () => {
  await allowed(set('owner-a', payPath(), pay()), 'create');
  await denied(set('owner-a', payPath(), pay({ amount: 999 })), 'change amount');
  await denied(set('owner-a', payPath(), pay()), 'same receipt number again');
  await denied(set('owner-a', payPath(), pay({ studentId: 's2' })), 'change student');
  await denied(remove('owner-a', payPath()), 'owner delete');
  await denied(remove('t1', payPath()), 'teacher delete');
  await denied(remove('parent-1', payPath()), 'parent delete');
});

test('the owner can void a payment once, and nothing else changes', async () => {
  await allowed(set('owner-a', payPath(), pay()), 'create');
  await allowed(set('owner-a', payPath(), pay({ voided: true })), 'void');
  await denied(set('owner-a', payPath(), pay({ voided: true, amount: 5 })), 'edit a voided payment');
  await denied(set('owner-a', payPath(), pay({ voided: false })), 'unvoid');
  await allowed(set('owner-a', payPath(pay({ receiptNo: 'R-0002' })), pay({ receiptNo: 'R-0002' })), 'second payment');
  await denied(set('owner-a', payPath(pay({ receiptNo: 'R-0002' })), pay({ receiptNo: 'R-0002', voided: true, amount: 1 })), 'void and edit together');
  await denied(set('t1', payPath(pay({ receiptNo: 'R-0002' })), pay({ receiptNo: 'R-0002', voided: true })), 'teacher voids');
  await denied(set('parent-1', payPath(pay({ receiptNo: 'R-0002' })), pay({ receiptNo: 'R-0002', voided: true })), 'parent voids');
});

test('a family account reads only its own student\'s payments', async () => {
  await allowed(set('owner-a', payPath(), pay()), 'seed s1');
  await allowed(set('owner-a', payPath(pay({ receiptNo: 'R-0002', studentId: 's2' })), pay({ receiptNo: 'R-0002', studentId: 's2' })), 'seed s2');
  await allowed(get('owner-a', payPath()), 'owner');
  await allowed(get('parent-1', payPath()), 'own child');
  await denied(get('parent-1', payPath(pay({ receiptNo: 'R-0002' }))), 'another child');
  await denied(get('parent-2', payPath()), 'other parent');
  await denied(get('pupil-off', payPath()), 'switched-off student');
  await denied(get('t1', payPath()), 'teacher');
  await denied(get('owner-b', payPath()), 'owner of another school');
  await denied(get(null, payPath()), 'signed out');
  await allowed(query('parent-1', A, 'payments', [['studentId', 's1']]), 'parent query for own child');
  await denied(query('parent-1', A, 'payments', [['studentId', 's2']]), 'parent query for another child');
  await denied(query('t1', A, 'payments', [['studentId', 's1']]), 'teacher query');
  await allowed(query('owner-a', A, 'payments', [['yearId', Y]]), 'owner query');
});

test('family accounts cannot write fees or payments', async () => {
  await denied(set('parent-1', feePath(), fee()), 'parent writes a fee');
  await denied(set('parent-1', payPath(), pay({ receivedBy: 'parent-1' })), 'parent writes a payment');
});

test('schools are separate', async () => {
  await allowed(set('owner-a', payPath(), pay()), 'seed');
  await denied(get('owner-b', payPath()), 'owner B reads A payment');
  await denied(set('owner-b', payPath(pay({ receivedBy: 'owner-b' }), A), pay({ receivedBy: 'owner-b' })), 'owner B writes A payment');
});

test('a family account reads only its own student\'s placement, and cannot change it', async () => {
  await allowed(get('parent-1', `${A}/enrollments/${Y}_s1`), 'own child placement');
  await denied(get('parent-1', `${A}/enrollments/${Y}_s2`), 'another child placement');
  await denied(get('parent-2', `${A}/enrollments/${Y}_s1`), 'other parent');
  await denied(get('pupil-off', `${A}/enrollments/${Y}_s1`), 'switched-off student');
  await allowed(query('parent-1', A, 'enrollments', [['studentId', 's1']]), 'parent query for own child');
  await denied(query('parent-1', A, 'enrollments', [['studentId', 's2']]), 'parent query for another child');
  await allowed(get('owner-a', `${A}/enrollments/${Y}_s1`), 'owner');
  await denied(set('parent-1', `${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 9 }), 'parent edits placement');
});
