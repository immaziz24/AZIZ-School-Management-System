// Firestore rules tests for student leave requests: who may apply, who decides, who reads. Synthetic records only.
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
const Y = 'y1';
const leave = (over = {}) => ({ studentId: 's1', studentName: 'Asha', classId: 'class-8', fromDate: day(2), toDate: day(3),
  reason: 'Fever', status: 'pending', requestedBy: 'parent-1', ...over });
const LP = (id = 's1_' + day(2), school = A) => `${school}/studentLeaves/${id}`;

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/ct-a`, { role: 'teacher', active: true }],
    [`${A}/members/peer-a`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/pupil-1`, { role: 'student', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    [`${A}/students/s1`, { admissionNo: 'S1', name: 'Asha', guardianName: 'P', guardianPhone: '', status: 'active' }],
    [`${A}/students/s2`, { admissionNo: 'S2', name: 'Ravi', guardianName: 'P', guardianPhone: '', status: 'active' }],
    [`${A}/enrollments/${Y}_s1`, { studentId: 's1', yearId: Y, classId: 'class-8', section: 'A' }],
    [`${A}/enrollments/${Y}_s2`, { studentId: 's2', yearId: Y, classId: 'class-7', section: 'A' }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [`${A}/familyAccess/pupil-1`, { studentId: 's1', relation: 'student', active: true }],
    [`${A}/classTeachers/class-8`, { teacherUid: 'ct-a' }],
    [`${A}/classTeachers/class-7`, { teacherUid: 'peer-a' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('a parent or the student applies for their own student only, as pending', async () => {
  await allowed(set('parent-1', LP(), leave()), 'parent applies');
  await allowed(set('pupil-1', LP('s1_' + day(5)), leave({ fromDate: day(5), toDate: day(5), requestedBy: 'pupil-1' })), 'student applies');
  await denied(set('parent-2', LP('s1_' + day(6)), leave({ fromDate: day(6), requestedBy: 'parent-2' })), 'other family cannot apply');
  await denied(set('ct-a', LP('s1_' + day(7)), leave({ fromDate: day(7), requestedBy: 'ct-a' })), 'teacher cannot apply');
  await denied(set(null, LP('s1_' + day(8)), leave({ fromDate: day(8) })), 'signed out');
});

test('a request must be pending, honest and well formed', async () => {
  await denied(set('parent-1', LP(), leave({ status: 'approved' })), 'cannot approve own');
  await denied(set('parent-1', LP(), leave({ decidedBy: 'parent-1' })), 'cannot pre-decide');
  await denied(set('parent-1', LP(), leave({ requestedBy: 'someone-else' })), 'requestedBy must be me');
  await denied(set('parent-1', LP(), leave({ classId: 'class-7' })), 'class must match placement');
  await denied(set('parent-1', LP('s1_wrong'), leave()), 'id must match student and date');
  await denied(set('parent-1', LP(), leave({ toDate: day(1) })), 'end before start');
  await denied(set('parent-1', LP(), leave({ reason: '   ' })), 'blank reason');
  await denied(set('parent-1', LP(), leave({ reason: 'x'.repeat(301) })), 'long reason');
  await denied(set('parent-1', LP(), leave({ extra: 1 })), 'extra field');
  await denied(set('parent-1', LP(), leave({ fromDate: 'soon' })), 'bad date');
});

test('the class teacher decides once; others cannot', async () => {
  await allowed(set(ADMIN, LP(), leave()), 'seed');
  const decided = (who, status = 'approved') => leave({ status, decidedBy: who, decisionNote: 'Get well soon' });
  await denied(set('peer-a', LP(), decided('peer-a')), 'another class teacher');
  await denied(set('parent-1', LP(), decided('parent-1')), 'family');
  await denied(set('ct-a', LP(), decided('someone-else')), 'decidedBy must be me');
  await denied(set('ct-a', LP(), leave({ status: 'approved', decidedBy: 'ct-a', reason: 'changed' })), 'cannot edit reason');
  await allowed(set('ct-a', LP(), decided('ct-a')), 'class teacher approves');
  await denied(set('ct-a', LP(), decided('ct-a', 'rejected')), 'only once');
  await denied(set('owner-a', LP(), decided('owner-a', 'rejected')), 'even owner cannot re-decide');
});

test('owner and principal can also decide', async () => {
  await allowed(set(ADMIN, LP(), leave()), 'seed');
  await allowed(set(ADMIN, LP('s1_' + day(9)), leave({ fromDate: day(9), toDate: day(9) })), 'seed 2');
  await allowed(set('owner-a', LP(), leave({ status: 'rejected', decidedBy: 'owner-a', decisionNote: 'Exam week' })), 'owner');
  await allowed(set('prin', LP('s1_' + day(9)), leave({ fromDate: day(9), toDate: day(9), status: 'approved', decidedBy: 'prin' })), 'principal');
});

test('who reads: own family, class teacher, owner, principal; nobody else; never deleted', async () => {
  await allowed(set(ADMIN, LP(), leave()), 'seed');
  await allowed(get('parent-1', LP()), 'parent reads');
  await allowed(get('pupil-1', LP()), 'student reads');
  await allowed(get('ct-a', LP()), 'class teacher reads');
  await allowed(get('owner-a', LP()), 'owner reads');
  await allowed(get('prin', LP()), 'principal reads');
  await denied(get('parent-2', LP()), 'other family');
  await denied(get('peer-a', LP()), 'other class teacher');
  await denied(get('owner-b', LP()), 'other school owner');
  await allowed(query('parent-1', A, 'studentLeaves', [['studentId', 's1']]), 'family query by student');
  await allowed(query('ct-a', A, 'studentLeaves', [['classId', 'class-8']]), 'teacher query by class');
  await denied(query('parent-2', A, 'studentLeaves', [['studentId', 's1']]), 'other family query');
  for (const who of ['parent-1', 'ct-a', 'owner-a', 'prin']) await denied(remove(who, LP()), 'delete by ' + who);
});
