// Firestore rules tests for schoollife.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/schoollife.rules.test.mjs"
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
const TODAY = day(0);
const student = (name, no) => ({ admissionNo: no, name, guardianName: 'Parent', guardianPhone: '', status: 'active' });
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const OUTSIDERS = ['parent-1', 'owner-b', null];

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
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/unlinked`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/s1`, student('Asha', 'A1')],
    [`${A}/students/s2`, student('Ravi', 'A2')],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/teacherAssignments/t1`, { className: 'Class 8', subject: 'Maths', classId: 'class-8', subjectId: 'maths' }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [P('routes', 'r-1'), { name: 'North route', vehicle: 'WB 01 1234', driver: 'Mr Das', driverPhone: '98300 00000', stops: 'A, B, C' }],
    [P('transportRiders', 's1'), { studentId: 's1', routeId: 'r-1', stop: 'B' }],
    [P('transportRiders', 's2'), { studentId: 's2', routeId: 'r-1' }],
    [P('activities', 'ac-1'), { name: 'Cricket', teacher: 'Mr Roy', schedule: 'Fri 3pm' }],
    [P('activityMembers', 'ac-1_s1'), { activityId: 'ac-1', studentId: 's1', joinedOn: TODAY }],
    [P('activityMembers', 'ac-1_s2'), { activityId: 'ac-1', studentId: 's2', joinedOn: TODAY }],
    [P('inventory', 'i-1'), { name: 'Chalk', quantity: 50, minQuantity: 10 }],
    [P('alumni', 'al-1'), { name: 'Meera', passoutYear: 2015 }],
    [P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'O+', allergies: 'Peanuts' }],
    [P('healthRecords', 's2'), { studentId: 's2', bloodGroup: 'A+' }],
    [P('substitutions', 'SB-1'), { date: TODAY, classId: 'class-8', className: 'Class 8', period: 2, substituteUid: 't2', createdBy: 'owner-a' }],
    [P('lessonPlans', 'LP-1'), { classId: 'class-8', subjectId: 'maths', subject: 'Maths', date: TODAY, topic: 'Fractions', objectives: 'Add fractions.', createdAt: TODAY, createdBy: 't1' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('substitute cover: the owner arranges it and the substitute reads it', async () => {
  const sub = (over = {}) => ({ date: day(1), classId: 'class-8', className: 'Class 8', period: 3, substituteUid: 't2', createdBy: 'owner-a', ...over });
  await allowed(set('owner-a', P('substitutions', 'SB-2'), sub()), 'arrange');
  await allowed(set('owner-a', P('substitutions', 'SB-3'), sub({ absentTeacher: 'Mr Roy', note: 'Revise chapter 4' })), 'with details');
  await denied(set('owner-a', P('substitutions', 'SB-4'), sub({ substituteUid: 't-off' })), 'inactive substitute');
  await denied(set('owner-a', P('substitutions', 'SB-4'), sub({ substituteUid: 'parent-1' })), 'substitute is not a teacher');
  await denied(set('owner-a', P('substitutions', 'SB-4'), sub({ classId: 'class-9' })), 'unknown class');
  await denied(set('owner-a', P('substitutions', 'SB-4'), sub({ period: 13 })), 'period 13');
  await denied(set('owner-a', P('substitutions', 'SB-4'), sub({ createdBy: 't1' })), 'createdBy is someone else');
  await denied(set('owner-a', P('substitutions', 'SB-4'), sub({ note: 'x'.repeat(201) })), 'note too long');
  await denied(set('t1', P('substitutions', 'SB-4'), sub({ createdBy: 't1' })), 'teacher arranges');
  await denied(set('owner-a', P('substitutions', 'SB-1'), sub({ note: 'edit' })), 'edit');
  await allowed(get('t2', P('substitutions', 'SB-1')), 'substitute reads');
  await allowed(get('owner-a', P('substitutions', 'SB-1')), 'owner reads');
  await denied(get('t1', P('substitutions', 'SB-1')), 'another teacher');
  await denied(get('t-off', P('substitutions', 'SB-1')), 'inactive teacher');
  await denied(get('parent-1', P('substitutions', 'SB-1')), 'parent');
  await allowed(query('t2', A, 'substitutions', [['substituteUid', 't2']]), 'substitute lists own');
  await denied(query('t1', A, 'substitutions', [['substituteUid', 't2']]), 'another teacher lists');
  await denied(remove('t2', P('substitutions', 'SB-1')), 'substitute removes');
  await allowed(remove('owner-a', P('substitutions', 'SB-1')), 'owner removes');
});

test('transport: the owner manages routes and riders; families read their own', async () => {
  await allowed(set('owner-a', P('routes', 'r-2'), { name: 'South route' }), 'add route');
  await allowed(set('owner-a', P('routes', 'r-1'), { name: 'North route', driverPhone: '+91 98300 00000' }), 'change route');
  await denied(set('owner-a', P('routes', 'r-3'), { name: ' ' }), 'blank name');
  await denied(set('owner-a', P('routes', 'r-3'), { name: 'X', driverPhone: 'call' }), 'bad phone');
  await denied(set('owner-a', P('routes', 'r-3'), { name: 'X', stops: 'x'.repeat(301) }), 'stops too long');
  await allowed(set('owner-a', P('transportRiders', 's1'), { studentId: 's1', routeId: 'r-1', stop: 'C' }), 'change rider');
  await denied(set('owner-a', P('transportRiders', 's3'), { studentId: 's3', routeId: 'r-1' }), 'unknown student');
  await denied(set('owner-a', P('transportRiders', 's1'), { studentId: 's1', routeId: 'r-9' }), 'unknown route');
  await denied(set('owner-a', P('transportRiders', 's2'), { studentId: 's1', routeId: 'r-1' }), 'id does not match student');
  await allowed(get('parent-1', P('transportRiders', 's1')), 'own rider record');
  await denied(get('parent-1', P('transportRiders', 's2')), 'another student');
  await denied(get('unlinked', P('transportRiders', 's1')), 'unlinked');
  await allowed(get('parent-1', P('routes', 'r-1')), 'family reads route');
  await denied(get('t1', P('routes', 'r-1')), 'teacher reads route');
  await allowed(query('parent-1', A, 'transportRiders', [['studentId', 's1']]), 'family lists own');
  await denied(query('parent-1', A, 'transportRiders', [['studentId', 's2']]), 'family lists another');
  for (const who of ['t1', 'parent-1', 'owner-b', null]) {
    await denied(set(who, P('routes', 'r-9'), { name: 'X' }), 'write route ' + who);
    await denied(remove(who, P('transportRiders', 's1')), 'remove rider ' + who);
  }
  await allowed(remove('owner-a', P('transportRiders', 's1')), 'owner removes rider');
});

test('activities and memberships', async () => {
  await allowed(set('owner-a', P('activities', 'ac-2'), { name: 'Music' }), 'add activity');
  await denied(set('owner-a', P('activities', 'ac-3'), { name: ' ' }), 'blank name');
  await denied(set('owner-a', P('activities', 'ac-3'), { name: 'X', schedule: 'x'.repeat(101) }), 'schedule too long');
  await denied(set('owner-a', P('activityMembers', 'ac-1_s1'), { activityId: 'ac-1', studentId: 's1', joinedOn: TODAY }), 'membership edited');
  await allowed(set('owner-a', P('activityMembers', 'ac-2_s1'), { activityId: 'ac-2', studentId: 's1', joinedOn: TODAY }), 'second activity');
  await denied(set('owner-a', P('activityMembers', 'ac-9_s1'), { activityId: 'ac-9', studentId: 's1', joinedOn: TODAY }), 'unknown activity');
  await denied(set('owner-a', P('activityMembers', 'ac-1_s9'), { activityId: 'ac-1', studentId: 's9', joinedOn: TODAY }), 'unknown student');
  await denied(set('owner-a', P('activityMembers', 'ac-1_s2x'), { activityId: 'ac-1', studentId: 's2', joinedOn: TODAY }), 'id mismatch');
  await denied(set('owner-a', P('activityMembers', 'ac-2_s2'), { activityId: 'ac-2', studentId: 's2', joinedOn: day(3) }), 'future date');
  await allowed(get('t1', P('activities', 'ac-1')), 'teacher reads activity');
  await allowed(get('parent-1', P('activities', 'ac-1')), 'family reads activity');
  await denied(get('t-off', P('activities', 'ac-1')), 'inactive teacher');
  await denied(get('owner-b', P('activities', 'ac-1')), 'other school');
  await allowed(get('parent-1', P('activityMembers', 'ac-1_s1')), 'family reads own membership');
  await denied(get('parent-1', P('activityMembers', 'ac-1_s2')), 'family reads another');
  await denied(get('t1', P('activityMembers', 'ac-1_s1')), 'teacher reads membership');
  await allowed(query('parent-1', A, 'activityMembers', [['studentId', 's1']]), 'family lists own');
  await denied(query('parent-1', A, 'activityMembers', [['studentId', 's2']]), 'family lists another');
  await denied(set('t1', P('activities', 'ac-9'), { name: 'X' }), 'teacher writes');
  await denied(remove('parent-1', P('activityMembers', 'ac-1_s1')), 'family removes');
  await allowed(remove('owner-a', P('activityMembers', 'ac-1_s1')), 'owner removes');
});

test('inventory and alumni are owner only', async () => {
  await allowed(set('owner-a', P('inventory', 'i-2'), { name: 'Markers', category: 'Stationery', unit: 'box', quantity: 0, minQuantity: 5 }), 'add item');
  await allowed(set('owner-a', P('inventory', 'i-1'), { name: 'Chalk', quantity: 40, minQuantity: 10 }), 'change quantity');
  await denied(set('owner-a', P('inventory', 'i-3'), { name: 'X', quantity: -1, minQuantity: 0 }), 'negative quantity');
  await denied(set('owner-a', P('inventory', 'i-3'), { name: 'X', quantity: 1.5, minQuantity: 0 }), 'fractional quantity');
  await denied(set('owner-a', P('inventory', 'i-3'), { name: ' ', quantity: 1, minQuantity: 0 }), 'blank name');
  await denied(set('owner-a', P('inventory', 'i-3'), { name: 'X', quantity: 1 }), 'missing minimum');
  await allowed(set('owner-a', P('alumni', 'al-2'), { name: 'Karan', passoutYear: 2020, contact: 'k@example.com', occupation: 'Engineer', note: 'Batch rep' }), 'add alumnus');
  await denied(set('owner-a', P('alumni', 'al-3'), { name: 'X', passoutYear: 1949 }), 'year too early');
  await denied(set('owner-a', P('alumni', 'al-3'), { name: 'X', passoutYear: 2101 }), 'year too late');
  await denied(set('owner-a', P('alumni', 'al-3'), { name: ' ', passoutYear: 2020 }), 'blank name');
  for (const who of ['t1', 'parent-1', 'owner-b', null]) {
    await denied(get(who, P('inventory', 'i-1')), 'read inventory ' + who);
    await denied(set(who, P('inventory', 'i-9'), { name: 'X', quantity: 1, minQuantity: 0 }), 'write inventory ' + who);
    await denied(get(who, P('alumni', 'al-1')), 'read alumni ' + who);
    await denied(remove(who, P('alumni', 'al-1')), 'remove alumni ' + who);
  }
  await allowed(remove('owner-a', P('inventory', 'i-1')), 'owner removes item');
});

test('health records: the owner writes; the owner and own family read', async () => {
  await allowed(set('owner-a', P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'B+', allergies: 'Dust', conditions: 'Asthma', emergencyContact: 'Uncle 98300 11111', notes: 'Inhaler in bag' }), 'update');
  await allowed(set('owner-a', P('healthRecords', 's2'), { studentId: 's2', bloodGroup: '' }), 'blank blood group');
  await denied(set('owner-a', P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'Z+' }), 'bad blood group');
  await denied(set('owner-a', P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'O+', allergies: 'x'.repeat(201) }), 'allergies too long');
  await denied(set('owner-a', P('healthRecords', 's9'), { studentId: 's9', bloodGroup: 'O+' }), 'unknown student');
  await denied(set('owner-a', P('healthRecords', 's2'), { studentId: 's1', bloodGroup: 'O+' }), 'id mismatch');
  await allowed(get('owner-a', P('healthRecords', 's1')), 'owner reads');
  await allowed(get('parent-1', P('healthRecords', 's1')), 'own family reads');
  await denied(get('parent-1', P('healthRecords', 's2')), 'another family');
  await denied(get('unlinked', P('healthRecords', 's1')), 'unlinked');
  await denied(get('t1', P('healthRecords', 's1')), 'teacher');
  await denied(get('owner-b', P('healthRecords', 's1')), 'other school');
  await denied(set('parent-1', P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'A+' }), 'family writes');
  await denied(set('t1', P('healthRecords', 's1'), { studentId: 's1', bloodGroup: 'A+' }), 'teacher writes');
  await denied(query('parent-1', A, 'healthRecords', [['studentId', 's2']]), 'family lists another');
});

test('lesson plans: the subject teacher writes; the author and owner read', async () => {
  const plan = (over = {}) => ({ classId: 'class-8', subjectId: 'maths', subject: 'Maths', date: day(2), topic: 'Decimals', objectives: 'Round to 2 places.', createdAt: TODAY, createdBy: 't1', ...over });
  await allowed(set('t1', P('lessonPlans', 'LP-2'), plan()), 'own class and subject');
  await denied(set('t1', P('lessonPlans', 'LP-3'), plan({ classId: 'class-7' })), 'another class');
  await denied(set('t1', P('lessonPlans', 'LP-3'), plan({ subjectId: 'science', subject: 'Science' })), 'another subject');
  await denied(set('t2', P('lessonPlans', 'LP-3'), plan({ createdBy: 't2' })), 'teacher with no assignment');
  await denied(set('t-off', P('lessonPlans', 'LP-3'), plan({ createdBy: 't-off' })), 'inactive teacher');
  await denied(set('t1', P('lessonPlans', 'LP-3'), plan({ createdBy: 'owner-a' })), 'createdBy is someone else');
  await denied(set('t1', P('lessonPlans', 'LP-3'), plan({ topic: ' ' })), 'blank topic');
  await denied(set('t1', P('lessonPlans', 'LP-3'), plan({ objectives: 'x'.repeat(1001) })), 'objectives too long');
  await denied(set('t1', P('lessonPlans', 'LP-3'), plan({ createdAt: day(2) })), 'future created date');
  await denied(set('t1', P('lessonPlans', 'LP-1'), plan({ topic: 'Edited' })), 'edit');
  await allowed(set('owner-a', P('lessonPlans', 'LP-4'), plan({ classId: 'class-8', subjectId: 'science', subject: 'Science', createdBy: 'owner-a' })), 'owner writes');
  await allowed(get('t1', P('lessonPlans', 'LP-1')), 'author reads');
  await allowed(get('owner-a', P('lessonPlans', 'LP-1')), 'owner reads');
  await denied(get('t2', P('lessonPlans', 'LP-1')), 'another teacher');
  await denied(get('parent-1', P('lessonPlans', 'LP-1')), 'parent');
  await allowed(query('t1', A, 'lessonPlans', [['createdBy', 't1']]), 'author lists own');
  await denied(query('t2', A, 'lessonPlans', [['createdBy', 't1']]), 'another teacher lists');
  await denied(remove('t2', P('lessonPlans', 'LP-1')), 'another teacher removes');
  await allowed(remove('t1', P('lessonPlans', 'LP-1')), 'author removes');
  await allowed(remove('owner-a', P('lessonPlans', 'LP-4')), 'owner removes');
});
