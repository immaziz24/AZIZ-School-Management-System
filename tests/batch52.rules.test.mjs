// Firestore rules tests for batch 52: principal switches, transport months, admission documents.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/batch52.rules.test.mjs"
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
const TODAY = new Date().toISOString().slice(0, 10);
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const student = (over = {}) => ({ admissionNo: 'A1', name: 'Asha', guardianName: 'Parent', guardianPhone: '', status: 'active', ...over });
const rider = (over = {}) => ({ studentId: 's1', routeId: 'r-1', ...over });
const enquiry = () => ({ studentName: 'Kiran', classApplying: 'Class 5', guardianName: 'Mr Sen', phone: '98300 11111', createdAt: TODAY, status: 'new' });
const ACCESS = P('settings', 'principalAccess');
const access = (over = {}) => ({ payroll: false, fees: true, admissions: true, ...over });

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}`, { name: 'ABCD School', contactEmail: 'a@b.in', phone: '98300 00000', address: 'Town' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/prin-off`, { role: 'principal', active: false }],
    [`${A}/members/acc`, { role: 'accountant', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/prin-b`, { role: 'principal', active: true }],
    [P('students', 's1'), student()],
    [P('routes', 'r-1'), { name: 'North route', monthlyFee: 800 }],
    [P('transportRiders', 's1'), rider()],
    [P('familyAccess', 'parent-1'), { studentId: 's1', relation: 'parent', active: true }],
    [P('payroll', 't1_2026-11'), { staffUid: 't1', month: '2026-11', basic: 30000, allowances: 0, deductions: 0 }],
    [P('enquiries', 'EQ-1'), enquiry()],
    [P('feeStructures', 'y1_class-8_tuition'), { yearId: 'y1', classId: 'class-8', head: 'tuition', name: 'Tuition', amount: 1000 }],
    [P('payments', 'R-1'), { studentId: 's1', yearId: 'y1', amount: 100, date: TODAY, method: 'cash', receiptNo: 'R-1', receivedBy: 'owner-a' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('principal switches: only the owner saves them, three true/false values and nothing else', async () => {
  await allowed(set('owner-a', ACCESS, access()), 'owner saves');
  await allowed(set('owner-a', ACCESS, access({ payroll: true, fees: false })), 'owner changes');
  await denied(set('owner-a', ACCESS, { payroll: true, fees: true }), 'a switch missing');
  await denied(set('owner-a', ACCESS, { ...access(), extra: true }), 'an extra field');
  await denied(set('owner-a', ACCESS, access({ payroll: 'yes' })), 'text instead of true/false');
  await denied(set('prin', ACCESS, access({ payroll: true })), 'principal cannot give itself access');
  await denied(set('acc', ACCESS, access()), 'accountant');
  await denied(set('t1', ACCESS, access()), 'teacher');
  await denied(set('owner-b', ACCESS, access()), 'owner of another school');
  await denied(set(null, ACCESS, access()), 'signed out');
});

test('principal switches: the owner and principal read them; nobody else does', async () => {
  await allowed(set(ADMIN, ACCESS, access({ payroll: true })), 'seed');
  await allowed(get('owner-a', ACCESS), 'owner');
  await allowed(get('prin', ACCESS), 'principal');
  for (const who of ['t1', 'acc', 'parent-1', 'prin-b', 'owner-b', null]) await denied(get(who, ACCESS), 'read by ' + who);
});

test('payroll: closed to the principal until the owner switches it on', async () => {
  const payroll = P('payroll', 't1_2026-11');
  await denied(get('prin', payroll), 'no switch record yet');
  await set(ADMIN, ACCESS, access({ payroll: false }));
  await denied(get('prin', payroll), 'switched off');
  await set(ADMIN, ACCESS, access({ payroll: true }));
  await allowed(get('prin', payroll), 'switched on');
  await allowed(query('prin', A, 'payroll', []), 'list when switched on');
  await denied(set('prin', P('payroll', 't1_2026-12'), { staffUid: 't1', month: '2026-12', basic: 1, allowances: 0, deductions: 0 }), 'still cannot write payroll');
  await denied(remove('prin', payroll), 'still cannot delete payroll');
  // A teacher reads only their own salary records (batch 62, feature 143); tests/batch62.rules.test.mjs covers that.
  for (const who of ['prin-off', 'prin-b', 'acc', 'parent-1', null]) await denied(get(who, payroll), 'payroll by ' + who);
  await allowed(get('owner-a', payroll), 'owner always reads payroll');
});

test('admissions: open to the principal by default, closed when switched off', async () => {
  const doc = P('enquiries', 'EQ-1');
  await allowed(get('prin', doc), 'default is on');
  await set(ADMIN, ACCESS, access({ admissions: false }));
  await denied(get('prin', doc), 'switched off');
  await denied(query('prin', A, 'enquiries', []), 'list when switched off');
  await allowed(get('owner-a', doc), 'owner unaffected');
  await set(ADMIN, ACCESS, access({ admissions: true }));
  await allowed(get('prin', doc), 'switched back on');
  await allowed(set(null, P('enquiries', 'EQ-new'), enquiry()), 'the public form still works');
  for (const who of ['prin-off', 'prin-b', 't1', 'acc', null]) await denied(get(who, doc), 'enquiry by ' + who);
});

test('fees: open to the principal by default, closed when switched off, others unaffected', async () => {
  const fee = P('feeStructures', 'y1_class-8_tuition');
  const payment = P('payments', 'R-1');
  await allowed(get('prin', fee), 'fee amounts, default');
  await allowed(get('prin', payment), 'payment, default');
  await set(ADMIN, ACCESS, access({ fees: false }));
  await denied(get('prin', fee), 'fee amounts, off');
  await denied(get('prin', payment), 'payment, off');
  await denied(query('prin', A, 'payments', [['studentId', 's1']]), 'payment list, off');
  await allowed(get('owner-a', payment), 'owner');
  await allowed(get('acc', payment), 'fee office');
  await allowed(get('acc', fee), 'fee office reads fee amounts');
  await allowed(get('parent-1', payment), 'the family reads its own payment');
  await allowed(get('parent-1', fee), 'the family reads fee amounts');
  await denied(set('prin', P('payments', 'R-9'), { studentId: 's1', yearId: 'y1', amount: 5, date: TODAY, method: 'cash', receiptNo: 'R-9', receivedBy: 'prin' }), 'principal cannot take payments');
  await denied(get('prin-b', payment), 'principal of another school');
});

test('transport: months charged is a whole number from 0 to 12 and only the owner sets it', async () => {
  await allowed(set('owner-a', P('transportRiders', 's1'), rider({ months: 4 })), '4 months');
  await allowed(set('owner-a', P('transportRiders', 's1'), rider({ months: 0 })), '0 months');
  await allowed(set('owner-a', P('transportRiders', 's1'), rider({ months: 12 })), '12 months');
  await denied(set('owner-a', P('transportRiders', 's1'), rider({ months: 13 })), 'more than 12');
  await denied(set('owner-a', P('transportRiders', 's1'), rider({ months: -1 })), 'negative');
  await denied(set('owner-a', P('transportRiders', 's1'), rider({ months: '4' })), 'text');
  await denied(set('owner-a', P('transportRiders', 's1'), rider({ months: 2.5 })), 'a fraction');
  await denied(set('prin', P('transportRiders', 's1'), rider({ months: 4 })), 'principal');
  await denied(set('parent-1', P('transportRiders', 's1'), rider({ months: 1 })), 'the family cannot lower its own charge');
  await denied(set('acc', P('transportRiders', 's1'), rider({ months: 1 })), 'fee office cannot change it');
});

test('transport: the family and the fee office can read what the fee balance needs', async () => {
  await set(ADMIN, P('transportRiders', 's1'), rider({ months: 4 }));
  await allowed(get('parent-1', P('transportRiders', 's1')), 'family reads its own rider');
  await allowed(get('parent-1', P('routes', 'r-1')), 'family reads the route fee');
  await allowed(get('acc', P('transportRiders', 's1')), 'fee office reads riders');
  await allowed(get('acc', P('routes', 'r-1')), 'fee office reads routes');
  await allowed(query('acc', A, 'transportRiders', []), 'fee office lists riders');
  await denied(set('acc', P('routes', 'r-2'), { name: 'South' }), 'fee office cannot write routes');
  await denied(remove('acc', P('transportRiders', 's1')), 'fee office cannot remove a rider');
  await denied(get('t1', P('transportRiders', 's1')), 'teacher');
  await denied(get('prin-b', P('transportRiders', 's1')), 'principal of another school');
  await denied(get(null, P('routes', 'r-1')), 'signed out');
});

test('admission: transfer certificate number and documents received are checked', async () => {
  await allowed(set('owner-a', P('students', 's1'), student({ tcNo: 'TC/2026/118', docsReceived: ['birth', 'tc', 'photos'] })), 'valid');
  await allowed(set('owner-a', P('students', 's1'), student({ docsReceived: [] })), 'empty list');
  await allowed(set('owner-a', P('students', 's1'), student()), 'neither field');
  await denied(set('owner-a', P('students', 's1'), student({ docsReceived: ['birth', 'passport'] })), 'unknown document');
  await denied(set('owner-a', P('students', 's1'), student({ docsReceived: 'birth' })), 'not a list');
  await denied(set('owner-a', P('students', 's1'), student({ docsReceived: ['birth', 'tc', 'marksheet', 'aadhaar', 'photos', 'address', 'medical', 'other', 'birth'] })), 'nine entries');
  await denied(set('owner-a', P('students', 's1'), student({ tcNo: 'x'.repeat(41) })), 'long TC number');
  await denied(set('owner-a', P('students', 's1'), student({ tcNo: 12345 })), 'number instead of text');
  await denied(set('prin', P('students', 's1'), student({ tcNo: 'TC1' })), 'principal');
  await denied(set('prin-b', P('students', 's1'), student({ tcNo: 'TC1' })), 'principal of another school');
});
