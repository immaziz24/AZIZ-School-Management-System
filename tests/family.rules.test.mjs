// Firestore rules tests for student and parent access to published results (feature 048).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/family.rules.test.mjs"
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const docName = (path) => `projects/${project}/databases/(default)/documents/${path}`;

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
// Atomic multi-document write. A null body deletes the document.
const batch = async (who, writes) => {
  const response = await fetch(base + ':commit', {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ writes: writes.map(([path, data]) => (data === null
      ? { delete: docName(path) }
      : { update: { name: docName(path), fields: fields(data) } })) }),
  });
  await response.arrayBuffer();
  return response.status;
};
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
const PUB = `${Y}_class-8_maths_midterm`;
const DRAFT = `${Y}_class-8_science_midterm`;
const mark = (examId, student, subjectId, score = 40) => ({
  examId, yearId: Y, classId: 'class-8', subjectId, studentId: student, score, maxMarks: 50, enteredBy: 'teacher-a',
});
const exam = (subjectId, over = {}) => ({
  yearId: Y, classId: 'class-8', subjectId, examKey: 'midterm', name: 'Mid-term', maxMarks: 50, status: 'locked', ...over,
});
const published = { status: 'approved', approvedBy: 'owner-a', published: true };
const access = (studentId, over = {}) => ({ studentId, relation: 'parent', active: true, ...over });
const student = (n) => ({ admissionNo: n, name: 'Test Student ' + n, guardianName: 'Test Guardian', guardianPhone: '', status: 'active' });

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/student-1`, { role: 'student', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/stranger`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/academicYears/${Y}`, { label: Y, startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/subjects/maths`, { name: 'Maths', code: 'MAT' }],
    [`${A}/subjects/science`, { name: 'Science', code: 'SCI' }],
    [`${A}/students/s1`, student('s1')],
    [`${A}/students/s2`, student('s2')],
    [`${A}/exams/${PUB}`, exam('maths', published)],
    [`${A}/exams/${DRAFT}`, exam('science')],
    [`${A}/marks/${PUB}_s1`, mark(PUB, 's1', 'maths', 41)],
    [`${A}/marks/${PUB}_s2`, mark(PUB, 's2', 'maths', 42)],
    [`${A}/marks/${DRAFT}_s1`, mark(DRAFT, 's1', 'science', 43)],
    [`${A}/familyAccess/parent-1`, access('s1')],
    [`${A}/familyAccess/student-1`, access('s1', { relation: 'student' })],
    [`${A}/familyAccess/parent-2`, access('s2')],
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200, path);
});

test('only the owner links a student or parent account to a student', async () => {
  await allowed(set('owner-a', `${A}/familyAccess/stranger`, access('s1')), 'owner links a parent');
  await allowed(set('owner-a', `${A}/familyAccess/stranger`, access('s2', { relation: 'student', active: false })), 'owner changes and switches off');
  await denied(set('teacher-a', `${A}/familyAccess/stranger`, access('s1')), 'teacher cannot link');
  await denied(set('parent-1', `${A}/familyAccess/parent-1`, access('s2')), 'parent cannot change their own link');
  await denied(set('parent-1', `${A}/familyAccess/stranger`, access('s1')), 'parent cannot link someone else');
  await denied(set('owner-b', `${A}/familyAccess/stranger`, access('s1')), 'owner of another school');
  await denied(set('owner-a', `${A}/familyAccess/nobody`, access('s1')), 'account with no membership');
  await denied(set('owner-a', `${A}/familyAccess/teacher-a`, access('s1')), 'teacher account cannot be linked as family');
  await denied(set('owner-a', `${A}/familyAccess/stranger`, access('missing')), 'student must exist');
  await denied(set('owner-a', `${A}/familyAccess/stranger`, access('s1', { relation: 'cousin' })), 'relation must be student or parent');
  await denied(set('owner-a', `${A}/familyAccess/stranger`, { ...access('s1'), role: 'owner' }), 'extra field');
  await denied(set('owner-a', `${A}/familyAccess/stranger`, { studentId: 's1', relation: 'parent' }), 'active is required');
  await allowed(get('parent-1', `${A}/familyAccess/parent-1`), 'parent reads their own link');
  await denied(get('parent-1', `${A}/familyAccess/parent-2`), 'parent cannot read another link');
  await allowed(get('owner-a', `${A}/familyAccess/parent-2`), 'owner reads a link');
  await allowed(get('owner-a', `${A}/familyAccess`), 'owner lists links');
  await denied(get('parent-1', `${A}/familyAccess`), 'parent cannot list links');
});

test('a parent or student reads only their own student\'s published marks', async () => {
  await allowed(get('parent-1', `${A}/marks/${PUB}_s1`), 'parent reads published mark');
  await allowed(get('student-1', `${A}/marks/${PUB}_s1`), 'student reads published mark');
  await denied(get('parent-1', `${A}/marks/${DRAFT}_s1`), 'unpublished mark');
  await denied(get('parent-1', `${A}/marks/${PUB}_s2`), 'another student\'s mark');
  await denied(get('parent-2', `${A}/marks/${PUB}_s1`), 'a parent of another student');
  await denied(get('parent-1', `${A}/marks/${PUB}_missing`), 'a mark that does not exist');
  await denied(query('parent-1', A, 'marks', [['studentId', 's1']]), 'parent cannot list marks');
  await denied(get('stranger', `${A}/marks/${PUB}_s1`), 'account with no link');
  await denied(get(null, `${A}/marks/${PUB}_s1`), 'signed out');
  await denied(set('parent-1', `${A}/marks/${PUB}_s1`, mark(PUB, 's1', 'maths', 50)), 'parent cannot change marks');
  await denied(set('parent-1', `${A}/marks/${PUB}_s2`, mark(PUB, 's2', 'maths', 50)), 'parent cannot write any marks');
});

test('a parent or student sees their student record and published exams only', async () => {
  await allowed(get('parent-1', `${A}/students/s1`), 'own student');
  await denied(get('parent-1', `${A}/students/s2`), 'another student');
  await denied(query('parent-1', A, 'students', [['status', 'active']]), 'student list');
  await allowed(get('parent-1', `${A}/subjects/maths`), 'subject names');
  await denied(set('parent-1', `${A}/subjects/maths`, { name: 'Changed', code: 'MAT' }), 'parent cannot change subjects');
  await denied(get('stranger', `${A}/subjects/maths`), 'account with no link cannot read subjects');
  await allowed(get('parent-1', `${A}/exams/${PUB}`), 'published exam');
  await denied(get('parent-1', `${A}/exams/${DRAFT}`), 'unpublished exam');
  await allowed(query('parent-1', A, 'exams', [['published', true]]), 'published exams list');
  await denied(query('parent-1', A, 'exams', [['classId', 'class-8']]), 'list without the published filter');
  await denied(set('parent-1', `${A}/exams/${PUB}`, exam('maths', { status: 'locked' })), 'parent cannot change exams');
  await denied(get('parent-1', `${A}/familyAccess/parent-2`), 'other links stay private');
});

test('switching access off or unpublishing hides the results at once', async () => {
  await allowed(get('parent-1', `${A}/marks/${PUB}_s1`), 'readable before');
  await allowed(set('owner-a', `${A}/familyAccess/parent-1`, access('s1', { active: false })), 'owner switches access off');
  await denied(get('parent-1', `${A}/marks/${PUB}_s1`), 'mark hidden when access is off');
  await denied(get('parent-1', `${A}/students/s1`), 'student record hidden when access is off');
  await denied(query('parent-1', A, 'exams', [['published', true]]), 'exams hidden when access is off');
  await allowed(set('owner-a', `${A}/familyAccess/parent-1`, access('s1')), 'owner switches access on');
  await allowed(get('parent-1', `${A}/marks/${PUB}_s1`), 'readable again');
  await allowed(set('owner-a', `${A}/exams/${PUB}`, exam('maths', { status: 'approved', approvedBy: 'owner-a' })), 'owner unpublishes');
  await denied(get('parent-1', `${A}/marks/${PUB}_s1`), 'mark hidden after unpublishing');
});
