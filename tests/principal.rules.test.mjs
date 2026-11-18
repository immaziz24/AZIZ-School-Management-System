// Firestore rules tests for principal.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/principal.rules.test.mjs"
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
beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}`, { name: 'ABCD School', contactEmail: 'a@b.in', phone: '98300 00000', address: 'Town' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/prin-off`, { role: 'principal', active: false }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/prin-b`, { role: 'principal', active: true }],
    [`${A}/students/s1`, student('Asha', 'A1')],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    [`${A}/academicYears/${Y}`, { label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'sec-8a', rollNo: 1 }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [P('payments', 'R-1'), { studentId: 's1', yearId: Y, amount: 100, date: TODAY, method: 'cash', receiptNo: 'R-1', receivedBy: 'owner-a' }],
    [P('notices', 'n-1'), { title: 'Hello', body: 'Text', audience: 'all', createdAt: TODAY, createdBy: 'owner-a' }],
    [P('payroll', 't1_2026-11'), { staffUid: 't1', month: '2026-11', basic: 30000, allowances: 0, deductions: 0 }],
    [P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'O+' }],
    [P('messages', 'm-1'), { studentId: 's1', subject: 'Hi', body: 'Hello', createdAt: TODAY, createdBy: 'parent-1' }],
    [P('auditLog', 'L-1'), { actor: 'owner-a', action: 'save', target: 'notices', docId: 'n-1', at: new Date().toISOString() }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('principal reads school records of the own school', async () => {
  await allowed(get('prin', A), 'school profile');
  for (const [collection, id] of [['students', 's1'], ['classes', 'class-8'], ['payments', 'R-1'], ['notices', 'n-1'],
    ['enrollments', Y + '_s1'], ['healthRecords', 's1'], ['messages', 'm-1'], ['familyAccess', 'parent-1'], ['members', 't1'],
    ['auditLog', 'L-1'], ['academicYears', Y]]) {
    await allowed(get('prin', P(collection, id)), 'principal reads ' + collection);
  }
  await allowed(get('prin', `${A}/settings/academic`), 'active year pointer');
  await allowed(query('prin', A, 'payments', [['studentId', 's1']]), 'list payments');
});

test('principal sees no salaries and changes nothing', async () => {
  await denied(get('prin', P('payroll', 't1_2026-11')), 'payroll');
  await allowed(get('owner-a', P('payroll', 't1_2026-11')), 'owner still reads payroll');
  await denied(set('prin', P('students', 's9'), { ...student('New', 'A9') }), 'add a student');
  await denied(set('prin', P('students', 's1'), { ...student('Changed', 'A1') }), 'change a student');
  await denied(remove('prin', P('students', 's1')), 'remove a student');
  await denied(set('prin', P('payments', 'R-9'), { studentId: 's1', yearId: Y, amount: 5, date: TODAY, method: 'cash', receiptNo: 'R-9', receivedBy: 'prin' }), 'take a payment');
  await denied(set('prin', P('payroll', 't1_2026-12'), { staffUid: 't1', month: '2026-12', basic: 1, allowances: 0, deductions: 0 }), 'write payroll');
  await denied(set('prin', P('familyAccess', 'parent-1'), { studentId: 's1', relation: 'parent', active: false }), 'switch off a parent');
  await denied(set('prin', P('members', 'prin'), { role: 'owner', active: true }), 'promote self');
  await denied(set('prin', P('auditLog', 'L-2'), { actor: 'owner-a', action: 'save', target: 'x', docId: 'y', at: new Date().toISOString() }), 'write the log in the owner\'s name');
  await denied(remove('prin', P('auditLog', 'L-1')), 'delete the log');
});

test('other schools, inactive principals and others get nothing', async () => {
  for (const who of ['prin-off', 'prin-b', 'owner-b', 'parent-1', null]) {
    if (who !== 'parent-1') await denied(get(who, P('students', 's1')), 'students by ' + who); // a parent may read their own child
    await denied(get(who, P('auditLog', 'L-1')), 'log by ' + who);
    await denied(get(who, P('payroll', 't1_2026-11')), 'payroll by ' + who);
  }
  await denied(get('prin-off', A), 'inactive principal school');
  await denied(get('t1', P('auditLog', 'L-1')), 'teacher log');
  await denied(get('t1', P('payments', 'R-1')), 'teacher payment');
});
