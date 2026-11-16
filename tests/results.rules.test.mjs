// Firestore rules tests for exam marks and ID-based teacher assignments (features 042, 043).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/results.rules.test.mjs"
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
const EXAM = `${Y}_class-8_maths_midterm`;
const SCIENCE = `${Y}_class-8_science_midterm`;
const CLOSED = '2025-26_class-8_maths_final';

const mark = (student, score = 40, over = {}) => ({
  examId: EXAM, yearId: Y, classId: 'class-8', subjectId: 'maths', studentId: student,
  score, maxMarks: 50, enteredBy: 'teacher-a', ...over,
});
const markPath = (student, school = A, examId = EXAM) => `${school}/marks/${examId}_${student}`;

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const student = (n) => ({ admissionNo: n, name: 'Test Student ' + n, guardianName: 'Test Guardian', guardianPhone: '', status: 'active' });
  const enroll = (id, section, classId, rollNo, year = Y) => [`${A}/enrollments/${year}_${id}`,
    { yearId: year, studentId: id, classId, sectionId: section, rollNo }];
  const assignment = (classId, subjectId, className, subject) => ({ className, subject, classId, subjectId });
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${A}/members/teacher-b`, { role: 'teacher', active: true }],
    [`${A}/members/teacher-legacy`, { role: 'teacher', active: true }],
    [`${A}/members/teacher-inactive`, { role: 'teacher', active: false }],
    [`${A}/members/teacher-unassigned`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/teacherAssignments/teacher-a`, assignment('class-8', 'maths', 'Class 8', 'Maths')],
    [`${A}/teacherAssignments/teacher-b`, assignment('class-7', 'science', 'Class 7', 'Science')],
    [`${A}/teacherAssignments/teacher-inactive`, assignment('class-8', 'maths', 'Class 8', 'Maths')],
    [`${A}/teacherAssignments/teacher-legacy`, { className: 'Class 8', subject: 'Maths' }],
    [`${A}/academicYears/${Y}`, { label: Y, startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [`${A}/academicYears/2025-26`, { label: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', status: 'closed' }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-7`, { name: 'Class 7', order: 7 }],
    [`${A}/sections/class-8-a`, { classId: 'class-8', name: 'A' }],
    [`${A}/sections/class-7-a`, { classId: 'class-7', name: 'A' }],
    [`${A}/subjects/maths`, { name: 'Maths', code: 'MAT' }],
    [`${A}/subjects/science`, { name: 'Science', code: 'SCI' }],
    [`${A}/classSubjects/class-8_maths`, { classId: 'class-8', subjectId: 'maths' }],
    [`${A}/classSubjects/class-8_science`, { classId: 'class-8', subjectId: 'science' }],
    [`${A}/classSubjects/class-7_science`, { classId: 'class-7', subjectId: 'science' }],
    [`${A}/exams/${EXAM}`, { yearId: Y, classId: 'class-8', subjectId: 'maths', examKey: 'midterm', name: 'Mid-term', maxMarks: 50, status: 'open' }],
    [`${A}/exams/${SCIENCE}`, { yearId: Y, classId: 'class-8', subjectId: 'science', examKey: 'midterm', name: 'Mid-term', maxMarks: 50, status: 'open' }],
    [`${A}/exams/${CLOSED}`, { yearId: '2025-26', classId: 'class-8', subjectId: 'maths', examKey: 'final', name: 'Final', maxMarks: 100, status: 'open' }],
    [`${A}/exams/${Y}_class-7_science_midterm`, { yearId: Y, classId: 'class-7', subjectId: 'science', examKey: 'midterm', name: 'Mid-term', maxMarks: 20, status: 'open' }],
    ...Array.from({ length: 12 }, (_, i) => [`${A}/students/s${i + 1}`, student('s' + (i + 1))]),
    [`${A}/students/out`, student('out')],
    [`${A}/students/other-class`, student('other-class')],
    ...Array.from({ length: 12 }, (_, i) => enroll('s' + (i + 1), 'class-8-a', 'class-8', i + 1)),
    enroll('other-class', 'class-7-a', 'class-7', 1),
    enroll('s1', 'class-8-a', 'class-8', 1, '2025-26'),
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200, path);
});

test('the assigned teacher can save, read and correct marks for a placed student', async () => {
  await allowed(set('teacher-a', markPath('s1'), mark('s1')), 'save');
  await allowed(get('teacher-a', markPath('s1')), 'read own mark');
  await allowed(get('owner-a', markPath('s1')), 'owner reads');
  await allowed(set('teacher-a', markPath('s1'), mark('s1', 45)), 'correct the score');
  await allowed(set('teacher-a', markPath('s1'), mark('s1', 0)), 'zero is a valid score');
  await allowed(set('teacher-a', markPath('s1'), mark('s1', 50)), 'full marks is a valid score');
  await allowed(query('teacher-a', A, 'marks', [['examId', EXAM], ['enteredBy', 'teacher-a']]), 'teacher lists own marks for an exam');
  await allowed(query('owner-a', A, 'marks', [['examId', EXAM]]), 'owner lists marks for an exam');
});

test('a whole page of marks can be saved in one batch', async () => {
  const writes = Array.from({ length: 10 }, (_, i) => [markPath('s' + (i + 1)), mark('s' + (i + 1), 10 + i)]);
  await allowed(batch('teacher-a', writes), 'ten marks in one batch');
  await allowed(get('teacher-a', markPath('s10')), 'last mark saved');
  await denied(batch('teacher-a', [...writes.slice(0, 2), [markPath('s3'), mark('s3', 99)]]), 'one bad mark rejects the whole batch');
});

test('mark values are validated against the exam', async () => {
  const bad = (over, label) => denied(set('teacher-a', markPath('s1'), mark('s1', 40, over)), label);
  await bad({ score: 51 }, 'score above the exam maximum');
  await bad({ score: -1 }, 'negative score');
  await bad({ score: 40.5 }, 'fractional score');
  await bad({ score: '40' }, 'text score');
  await bad({ maxMarks: 100 }, 'maximum different from the exam');
  await bad({ maxMarks: 20, score: 10 }, 'lower maximum than the exam');
  await bad({ classId: 'class-7' }, 'class different from the exam');
  await bad({ subjectId: 'science' }, 'subject different from the exam');
  await bad({ yearId: '2025-26' }, 'year different from the exam');
  await bad({ enteredBy: 'teacher-b' }, 'entered by someone else');
  await denied(set('teacher-a', markPath('s1'), { ...mark('s1'), extra: 'x' }), 'extra field');
  const { score, ...missing } = mark('s1');
  await denied(set('teacher-a', markPath('s1'), missing), 'missing field');
  await denied(set('teacher-a', `${A}/marks/${EXAM}_s2`, mark('s1')), 'ID names another student');
  await denied(set('teacher-a', `${A}/marks/anything`, mark('s1')), 'arbitrary ID');
});

test('marks need a student placed in the exam class', async () => {
  await denied(set('teacher-a', markPath('out'), mark('out')), 'student with no placement');
  await denied(set('teacher-a', markPath('other-class'), mark('other-class')), 'student placed in another class');
  await denied(set('teacher-a', markPath('nobody'), mark('nobody')), 'student that does not exist');
});

test('only the teacher assigned to the exam class and subject can save marks', async () => {
  await denied(set('teacher-b', markPath('s1'), mark('s1', 40, { enteredBy: 'teacher-b' })), 'teacher of another class');
  await denied(set('teacher-legacy', markPath('s1'), mark('s1', 40, { enteredBy: 'teacher-legacy' })), 'teacher with a text-only assignment');
  await denied(set('teacher-inactive', markPath('s1'), mark('s1', 40, { enteredBy: 'teacher-inactive' })), 'inactive teacher');
  await denied(set('teacher-unassigned', markPath('s1'), mark('s1', 40, { enteredBy: 'teacher-unassigned' })), 'teacher with no assignment');
  await denied(set('owner-a', markPath('s1'), mark('s1', 40, { enteredBy: 'owner-a' })), 'owner is not a teacher');
  await denied(set('owner-b', markPath('s1'), mark('s1', 40, { enteredBy: 'owner-b' })), 'owner of another school');
  await denied(set(null, markPath('s1'), mark('s1')), 'signed out');
  const science = mark('s1', 40, { examId: SCIENCE, subjectId: 'science' });
  await denied(set('teacher-a', markPath('s1', A, SCIENCE), science), 'exam of a subject they do not teach');
});

test('a locked exam or a closed year stops mark entry', async () => {
  await allowed(set('teacher-a', markPath('s1'), mark('s1')), 'save while open');
  await allowed(set(ADMIN, `${A}/exams/${EXAM}`, { yearId: Y, classId: 'class-8', subjectId: 'maths', examKey: 'midterm', name: 'Mid-term', maxMarks: 50, status: 'locked' }), 'owner locks the exam');
  await denied(set('teacher-a', markPath('s1'), mark('s1', 41)), 'correct while locked');
  await denied(set('teacher-a', markPath('s2'), mark('s2')), 'new mark while locked');
  await allowed(get('teacher-a', markPath('s1')), 'marks stay readable while locked');
  await allowed(set(ADMIN, `${A}/exams/${EXAM}`, { yearId: Y, classId: 'class-8', subjectId: 'maths', examKey: 'midterm', name: 'Mid-term', maxMarks: 50, status: 'open' }), 'owner reopens the exam');
  await allowed(set('teacher-a', markPath('s1'), mark('s1', 41)), 'correct after reopening');
  const closed = mark('s1', 40, { examId: CLOSED, yearId: '2025-26', maxMarks: 100 });
  await denied(set('teacher-a', markPath('s1', A, CLOSED), closed), 'exam in a closed year');
});

test('a mark keeps its exam and student and belongs to the teacher who entered it', async () => {
  await allowed(set('teacher-a', markPath('s1'), mark('s1')), 'save');
  await denied(set('teacher-a', markPath('s1'), mark('s2')), 'change the student');
  await denied(set('teacher-a', markPath('s1'), mark('s1', 40, { examId: SCIENCE })), 'change the exam');
  await denied(set('teacher-a', markPath('s1'), mark('s1', 40, { enteredBy: 'teacher-b' })), 'hand it to another teacher');
  await denied(set('teacher-b', markPath('s1'), mark('s1', 40, { enteredBy: 'teacher-b' })), 'another teacher overwrites it');
  await denied(get('teacher-b', markPath('s1')), 'another teacher reads it');
  await denied(call('DELETE', 'teacher-a', markPath('s1')), 'teacher delete');
  await denied(call('DELETE', 'owner-a', markPath('s1')), 'owner delete');
});

test('teachers read only the exams, sections and placements of their own class', async () => {
  await allowed(get('teacher-a', `${A}/exams/${EXAM}`), 'own exam');
  await denied(get('teacher-a', `${A}/exams/${SCIENCE}`), 'exam of a subject they do not teach');
  await denied(get('teacher-a', `${A}/exams/${Y}_class-7_science_midterm`), 'exam of another class');
  await denied(get('teacher-legacy', `${A}/exams/${EXAM}`), 'text-only assignment');
  await denied(get('teacher-unassigned', `${A}/exams/${EXAM}`), 'no assignment');
  await allowed(query('teacher-a', A, 'exams', [['classId', 'class-8'], ['subjectId', 'maths']]), 'list own exams');
  await denied(query('teacher-a', A, 'exams', [['classId', 'class-7'], ['subjectId', 'science']]), 'list another class exams');
  await allowed(query('teacher-a', A, 'enrollments', [['yearId', Y], ['classId', 'class-8']]), 'list own class placements');
  await denied(query('teacher-a', A, 'enrollments', [['yearId', Y], ['classId', 'class-7']]), 'list another class placements');
  await allowed(query('teacher-a', A, 'sections', [['classId', 'class-8']]), 'list own class sections');
  await denied(query('teacher-a', A, 'sections', [['classId', 'class-7']]), 'list another class sections');
  await denied(get('teacher-a', `${A}/students/s1`), 'student records stay owner only');
  await denied(get('teacher-a', `${A}/rollKeys/${Y}_class-8-a_1`), 'roll keys stay owner only');
  await denied(get('teacher-inactive', `${A}/enrollments/${Y}_s1`), 'inactive teacher');
  await denied(get('owner-b', `${A}/enrollments/${Y}_s1`), 'owner of another school');
  await allowed(get('owner-a', `${A}/enrollments/${Y}_s1`), 'owner still reads placements');
  await allowed(get('owner-a', `${A}/sections/class-8-a`), 'owner still reads sections');
  await denied(set('teacher-a', `${A}/sections/class-8-z`, { classId: 'class-8', name: 'Z' }), 'teacher cannot write sections');
  await denied(set('teacher-a', `${A}/exams/${EXAM}`, { yearId: Y, classId: 'class-8', subjectId: 'maths', examKey: 'midterm', name: 'Mid-term', maxMarks: 99, status: 'open' }), 'teacher cannot change an exam');
});

test('the owner assigns teachers by class and subject IDs', async () => {
  const id = (over = {}) => ({ className: 'Class 8', subject: 'Science', classId: 'class-8', subjectId: 'science', ...over });
  await allowed(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, id()), 'ID-based assignment');
  await allowed(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, { className: 'Class 8', subject: 'Whatever' }), 'text-only assignment still allowed');
  await denied(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, id({ className: 'Class 9' })), 'class name does not match the record');
  await denied(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, id({ subject: 'Physics' })), 'subject name does not match the record');
  await denied(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, id({ classId: 'class-7', className: 'Class 7' })), 'subject not taught in that class');
  await denied(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, id({ classId: 'class-99' })), 'class does not exist');
  await denied(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, { className: 'Class 8', subject: 'Science', classId: 'class-8' }), 'only one of the two IDs');
  await denied(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, { ...id(), extra: 'x' }), 'extra field');
  await denied(set('teacher-a', `${A}/teacherAssignments/teacher-a`, id()), 'teacher cannot assign themselves');
  await allowed(set('owner-a', `${A}/teacherAssignments/teacher-unassigned`, id()), 'assign again');
  await allowed(set('teacher-unassigned', markPath('s1', A, SCIENCE), mark('s1', 40, { examId: SCIENCE, subjectId: 'science', enteredBy: 'teacher-unassigned' })), 'the new assignment takes effect immediately');
});
