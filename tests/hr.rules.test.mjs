// Firestore rules tests for vehicles, appraisals, richer student and staff profiles, and what a principal may now do. Synthetic records only.
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
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const D = '2026-11-17';
const student = (over = {}) => ({ admissionNo: 'A1', name: 'Asha', guardianName: 'P', guardianPhone: '', status: 'active', ...over });
const staff = (over = {}) => ({ name: 'Ravi', role: 'Maths teacher', ...over });
const leave = (over = {}) => ({ staffUid: 't1', fromDate: day(3), toDate: day(5), reason: 'Family function', status: 'pending', ...over });

const GOOD = {
  vehicles: { regNo: 'WB-01-1234', capacity: 40, model: 'Bus', insuranceExpiry: '2027-03-31', fitnessExpiry: '2027-01-15', licenseExpiry: '2028-06-30', routeId: 'RT-1' },
  appraisals: { staffName: 'Ravi', date: D, rating: 4, remarks: 'Well prepared lessons.' },
};
const BAD = {
  vehicles: [{ ...GOOD.vehicles, capacity: 0 }, { ...GOOD.vehicles, capacity: 201 }, { ...GOOD.vehicles, capacity: 1.5 }, { ...GOOD.vehicles, regNo: ' ' },
    { ...GOOD.vehicles, insuranceExpiry: 'soon' }, { ...GOOD.vehicles, extra: 1 }, { model: 'x' }, { ...GOOD.vehicles, regNo: 'x'.repeat(21) }],
  appraisals: [{ ...GOOD.appraisals, rating: 0 }, { ...GOOD.appraisals, rating: 6 }, { ...GOOD.appraisals, rating: 2.5 }, { ...GOOD.appraisals, staffName: '' },
    { ...GOOD.appraisals, date: 'x' }, { ...GOOD.appraisals, remarks: 'y'.repeat(301) }, { ...GOOD.appraisals, extra: 1 }],
};
const ID = { vehicles: 'VH', appraisals: 'AP' };

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/prin-off`, { role: 'principal', active: false }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/prin-b`, { role: 'principal', active: true }],
    [`${A}/students/s1`, student()],
    ...Object.entries(GOOD).map(([collection, data]) => [P(collection, ID[collection] + '-1'), data]),
    [P('leaveRequests', 't1_' + day(3)), leave()],
    [P('auditLog', 'L-1'), { actor: 'owner-a', action: 'save', target: 'notices', docId: 'n-1', at: new Date().toISOString() }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

for (const [collection, good] of Object.entries(GOOD)) {
  const id = (n) => ID[collection] + '-' + n;
  test(collection + ': owner writes valid records only; principal reads; others locked out', async () => {
    await allowed(set('owner-a', P(collection, id(2)), good), 'create');
    await allowed(set('owner-a', P(collection, id(1)), good), 'update');
    await allowed(get('prin', P(collection, id(1))), 'principal reads');
    for (const bad of BAD[collection]) await denied(set('owner-a', P(collection, id(3)), bad), 'invalid ' + JSON.stringify(bad).slice(0, 70));
    await denied(set('owner-a', P(collection, 'bad.id'), good), 'bad id');
    await denied(set('owner-a', P(collection, 'XX-1'), good), 'wrong prefix');
    for (const who of ['prin', 'prin-off', 't1', 'parent-1', 'owner-b', null]) {
      await denied(set(who, P(collection, id(4)), good), 'write by ' + who);
      await denied(remove(who, P(collection, id(1))), 'delete by ' + who);
    }
    for (const who of ['prin-off', 't1', 'parent-1', 'owner-b', 'prin-b', null]) await denied(get(who, P(collection, id(1))), 'read by ' + who);
    await allowed(remove('owner-a', P(collection, id(1))), 'owner deletes');
  });
}

test('student profile: new optional fields are accepted and checked', async () => {
  const path = P('students', 'a2');
  await allowed(set('owner-a', path, student({ admissionNo: 'A2', gender: 'female', motherName: 'Mina', previousSchool: 'Town School', emergencyPhone: '98300 11111', guardianEmail: 'p@x.in' })), 'full profile');
  for (const bad of [{ gender: 'x' }, { emergencyPhone: 'call me' }, { motherName: 'm'.repeat(121) }, { previousSchool: 's'.repeat(121) }, { guardianEmail: 'e'.repeat(101) }, { bloodGroup: 'O+' }]) {
    await denied(set('owner-a', path, student({ admissionNo: 'A2', ...bad })), 'bad ' + JSON.stringify(bad));
  }
  await denied(set('prin', path, student({ admissionNo: 'A2', gender: 'male' })), 'principal cannot write');
  await denied(set('t1', path, student({ admissionNo: 'A2', gender: 'male' })), 'teacher cannot write');
});

test('staff profile: qualification, experience, emergency phone and address are checked', async () => {
  const path = P('staffDirectory', 'SD-9');
  await allowed(set('owner-a', path, staff({ qualification: 'M.Sc. B.Ed.', experienceYears: 12, emergencyPhone: '98300 22222', address: 'Town', phone: '98300 33333', joinedOn: D })), 'full profile');
  for (const bad of [{ experienceYears: -1 }, { experienceYears: 61 }, { experienceYears: 2.5 }, { emergencyPhone: 'x' }, { qualification: 'q'.repeat(101) }, { address: 'a'.repeat(201) }, { salary: 5 }]) {
    await denied(set('owner-a', path, staff(bad)), 'bad ' + JSON.stringify(bad));
  }
  await denied(set('prin', path, staff()), 'principal cannot write');
  await allowed(get('prin', path), 'principal reads');
});

test('principal can decide leave, post notices and write the log; nothing else', async () => {
  const leavePath = P('leaveRequests', 't1_' + day(3));
  await denied(set('prin', leavePath, leave({ status: 'approved', decidedBy: 'owner-a' })), 'principal using another decidedBy');
  await allowed(set('prin', leavePath, leave({ status: 'approved', decidedBy: 'prin' })), 'principal approves');
  await denied(set('prin', leavePath, leave({ status: 'rejected', decidedBy: 'prin' })), 'cannot change a decided request');
  await denied(set('prin-off', leavePath, leave({ status: 'rejected', decidedBy: 'prin-off' })), 'inactive principal');
  await denied(set('prin-b', leavePath, leave({ status: 'rejected', decidedBy: 'prin-b' })), 'principal of another school');
  const notice = { title: 'Holiday', body: 'School is closed on Monday.', audience: 'all', createdAt: TODAY, createdBy: 'prin' };
  await allowed(set('prin', P('notices', 'n-9'), notice), 'principal posts a notice');
  await denied(set('prin', P('notices', 'n-10'), { ...notice, createdBy: 'owner-a' }), 'notice in someone else\'s name');
  await denied(set('prin-off', P('notices', 'n-11'), { ...notice, createdBy: 'prin-off' }), 'inactive principal notice');
  await denied(set('prin-b', P('notices', 'n-12'), { ...notice, createdBy: 'prin-b' }), 'other school notice');
  await denied(set('t1', P('notices', 'n-13'), { ...notice, createdBy: 't1' }), 'teacher notice');
  await denied(remove('prin', P('notices', 'n-9')), 'principal cannot delete a notice');
  await allowed(set('prin', P('auditLog', 'L-5'), { actor: 'prin', action: 'save', target: 'notices', docId: 'n-9', at: new Date().toISOString() }), 'principal writes the log');
  await denied(set('prin', P('auditLog', 'L-6'), { actor: 'owner-a', action: 'save', target: 'notices', docId: 'n-9', at: new Date().toISOString() }), 'log in another name');
  await denied(remove('prin', P('auditLog', 'L-1')), 'cannot delete the log');
  await denied(set('prin', P('payroll', 't1_2026-12'), { staffUid: 't1', month: '2026-12', basic: 1, allowances: 0, deductions: 0 }), 'payroll');
  await denied(set('prin', P('students', 'a9'), student({ admissionNo: 'A9' })), 'students');
  await denied(set('prin', P('members', 'prin'), { role: 'owner', active: true }), 'promote self');
});
