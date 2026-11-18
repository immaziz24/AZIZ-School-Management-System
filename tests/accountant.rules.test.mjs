// Firestore rules tests for the fee office (accountant) login. Synthetic records only.
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

const Y = '2026-27';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pay = (over = {}) => ({ studentId: 's1', yearId: Y, amount: 500, date: day(0), method: 'cash', receiptNo: 'R-1', receivedBy: 'acc', ...over });

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}`, { name: 'Test School', createdBy: 'owner-a' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/acc`, { role: 'accountant', active: true }],
    [`${A}/members/acc-off`, { role: 'accountant', active: false }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/academicYears/${Y}`, { label: Y, startDate: day(-100), endDate: day(200), status: 'active' }],
    [`${A}/students/s1`, { admissionNo: 's1', name: 'Test Student', guardianName: 'G', guardianPhone: '', status: 'active' }],
    [`${A}/feeStructures/${Y}_class-8_tuition`, { yearId: Y, classId: 'class-8', head: 'tuition', name: 'Tuition', amount: 5000 }],
    [`${A}/payments/R-0`, pay({ receiptNo: 'R-0', receivedBy: 'owner-a' })],
    [`${A}/staffDirectory/st1`, { name: 'Staff', role: 'Clerk' }],
    [`${A}/notices/n1`, { title: 'T', body: 'B', audience: 'all', createdAt: day(0), createdBy: 'owner-a' }],
  ];
  for (const [p, data] of seed) assert.equal(await set(ADMIN, p, data), 200, p);
});

test('accountant: reads the fee office records and records a payment', async () => {
  await allowed(get('acc', `${A}`), 'school');
  await allowed(get('acc', `${A}/students/s1`), 'student');
  await allowed(query('acc', A, 'students', []), 'student list');
  await allowed(query('acc', A, 'classes', []), 'classes');
  await allowed(query('acc', A, 'academicYears', []), 'years');
  await allowed(query('acc', A, 'feeStructures', []), 'fees');
  await allowed(query('acc', A, 'payments', []), 'payments');
  await allowed(set('acc', `${A}/payments/R-1`, pay()), 'records a payment');
});

test('accountant: nothing beyond fees can be read or changed', async () => {
  await denied(set('acc', `${A}/payments/R-2`, pay({ receiptNo: 'R-2', receivedBy: 'owner-a' })), 'payment in someone elses name');
  await denied(set('acc', `${A}/payments/R-0`, pay({ receiptNo: 'R-0', receivedBy: 'owner-a', voided: true })), 'cannot void');
  await denied(set('acc', `${A}/feeStructures/${Y}_class-8_tuition`, { yearId: Y, classId: 'class-8', head: 'tuition', name: 'Tuition', amount: 1 }), 'cannot change fees');
  await denied(set('acc', `${A}/students/s2`, { admissionNo: 's2', name: 'New', guardianName: 'G', guardianPhone: '', status: 'active' }), 'cannot add students');
  await denied(set('acc', `${A}/classes/class-9`, { name: 'Class 9', order: 9 }), 'cannot add classes');
  await denied(get('acc', `${A}/staffDirectory/st1`), 'staff directory');
  await denied(get('acc', `${A}/notices/n1`), 'notices');
  await denied(query('acc', A, 'members', []), 'member list');
  await denied(set('acc', `${A}/members/acc`, { role: 'owner', active: true }), 'cannot make itself owner');
});

test('accountant: other schools, switched-off accounts and other roles are kept out', async () => {
  await denied(get('acc', `${B}/students/s1`), 'other school');
  await denied(get('acc-off', `${A}/students/s1`), 'switched off');
  await denied(set('acc-off', `${A}/payments/R-3`, pay({ receiptNo: 'R-3', receivedBy: 'acc-off' })), 'switched off payment');
  await denied(set('t1', `${A}/payments/R-4`, pay({ receiptNo: 'R-4', receivedBy: 't1' })), 'teacher payment');
  await denied(set(null, `${A}/payments/R-5`, pay({ receiptNo: 'R-5' })), 'anonymous payment');
});

test('invites: the owner may invite an accountant, nobody else may', async () => {
  const invite = (over = {}) => ({ schoolId: 'abcd-school', email: 'fees@example.com', role: 'accountant', status: 'pending', createdBy: 'owner-a', ...over });
  await allowed(set('owner-a', 'invites/INV-1', invite()), 'owner invites accountant');
  await denied(set('owner-a', 'invites/INV-2', invite({ role: 'cashier' })), 'unknown role');
  await denied(set('acc', 'invites/INV-3', invite({ createdBy: 'acc' })), 'accountant cannot invite');
});

test('health records: checkup dates and vaccinations are optional and validated', async () => {
  const rec = (over = {}) => ({ studentId: 's1', bloodGroup: 'O+', vaccinations: 'MMR, Polio', lastCheckup: day(-30), nextCheckup: day(300), ...over });
  await allowed(set('owner-a', `${A}/healthRecords/s1`, rec()), 'owner saves');
  await allowed(set('owner-a', `${A}/healthRecords/s1`, { studentId: 's1', bloodGroup: '' }), 'plain record still works');
  await denied(set('owner-a', `${A}/healthRecords/s1`, rec({ nextCheckup: 'soon' })), 'bad date');
  await denied(set('owner-a', `${A}/healthRecords/s1`, rec({ vaccinations: 'x'.repeat(201) })), 'long text');
  await denied(set('acc', `${A}/healthRecords/s1`, rec()), 'accountant cannot write');
  await denied(get('acc', `${A}/healthRecords/s1`), 'accountant cannot read');
});
