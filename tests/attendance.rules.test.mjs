// Firestore rules tests for daily attendance and class teachers.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/attendance.rules.test.mjs"
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
// Dates are worked out from today (UTC, the same clock the rules use), so the tests do not go stale.
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

const rec = (over = {}) => ({
  yearId: Y, classId: 'class-8', studentId: 's1', date: TODAY, status: 'present', markedBy: 'ct-a', ...over,
});
const path = (r = rec(), school = A) => `${school}/attendance/${r.date}_${r.classId}_${r.studentId}`;

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const year = (label, start, end, status) => ({ label, startDate: day(start), endDate: day(end), status });
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/ct-a`, { role: 'teacher', active: true }],
    [`${A}/members/peer-a`, { role: 'teacher', active: true }],
    [`${A}/members/subject-a`, { role: 'teacher', active: true }],
    [`${A}/members/inactive-a`, { role: 'teacher', active: false }],
    [`${A}/members/parent-a`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/ct-b`, { role: 'teacher', active: true }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-7`, { name: 'Class 7', order: 7 }],
    [`${A}/sections/class-8-a`, { classId: 'class-8', name: 'A' }],
    [`${A}/sections/class-7-a`, { classId: 'class-7', name: 'A' }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/pupil-off`, { role: 'student', active: true }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [`${A}/familyAccess/pupil-off`, { studentId: 's1', relation: 'student', active: false }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    ...['s1', 's2', 's3', 's4'].map((id) => [`${A}/students/${id}`,
      { admissionNo: id, name: 'Test Student ' + id, guardianName: 'Test Guardian', guardianPhone: '', status: 'active' }]),
    [`${A}/enrollments/past-year_s4`, { yearId: 'past-year', studentId: 's4', classId: 'class-8', sectionId: 'class-8-a', rollNo: 4 }],
    [`${A}/classTeachers/class-8`, { teacherUid: 'ct-a' }],
    [`${A}/classTeachers/class-7`, { teacherUid: 'peer-a' }],
    [`${B}/classTeachers/class-8`, { teacherUid: 'ct-b' }],
    // subject-a teaches a subject in class 8 but is not its class teacher.
    [`${A}/teacherAssignments/subject-a`, { className: 'Class 8', subject: 'Maths' }],
    [`${A}/academicYears/${Y}`, year(Y, -100, 100, 'active')],
    [`${A}/academicYears/overlap-year`, year('Overlap', -50, 50, 'draft')],
    [`${A}/academicYears/past-year`, year('Past', -300, -200, 'draft')],
    [`${A}/academicYears/closed-year`, year('Closed', -500, -400, 'closed')],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { yearId: Y, studentId: 's2', classId: 'class-8', sectionId: 'class-8-a', rollNo: 2 }],
    [`${A}/enrollments/${Y}_s3`, { yearId: Y, studentId: 's3', classId: 'class-7', sectionId: 'class-7-a', rollNo: 1 }],
    [`${A}/enrollments/overlap-year_s1`, { yearId: 'overlap-year', studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
    [`${A}/enrollments/past-year_s1`, { yearId: 'past-year', studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
    [`${A}/enrollments/closed-year_s1`, { yearId: 'closed-year', studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('class teacher can mark, correct and re-save attendance for their class', async () => {
  await allowed(set('ct-a', path(), rec()), 'create present');
  await allowed(set('ct-a', path(), rec({ status: 'absent' })), 'correct to absent');
  await allowed(set('ct-a', path(), rec({ status: 'late' })), 'correct to late');
  await allowed(set('ct-a', path(), rec({ status: 'late' })), 'identical repeat save');
  await allowed(set('ct-a', path(rec({ studentId: 's2' })), rec({ studentId: 's2', status: 'absent' })), 'second student');
  await allowed(set('ct-a', path(rec({ date: day(-1) })), rec({ date: day(-1) })), 'yesterday');
  await allowed(set('ct-a', path(rec({ date: day(-60) })), rec({ date: day(-60) })), 'an earlier day this year');
  await allowed(set('ct-a', path(rec({ date: day(1) })), rec({ date: day(1) })), 'tomorrow (time zone slack)');
});

test('class teacher and owner can read; the query shapes the app uses are allowed', async () => {
  await set(ADMIN, path(), rec());
  await allowed(get('ct-a', path()), 'class teacher get');
  await allowed(get('owner-a', path()), 'owner get');
  await allowed(query('ct-a', A, 'attendance', [['classId', 'class-8'], ['date', TODAY]]), 'class teacher list one day');
  await allowed(query('ct-a', A, 'attendance', [['classId', 'class-8']]), 'class teacher list whole class');
  await allowed(query('owner-a', A, 'attendance', [['date', TODAY]]), 'owner list one day');
  await allowed(query('owner-a', A, 'attendance', [['studentId', 's1']]), 'owner list one student');
  await denied(query('ct-a', A, 'attendance', [['date', TODAY]]), 'class teacher list without a class filter');
  await denied(query('ct-a', A, 'attendance', [['classId', 'class-7'], ['date', TODAY]]), 'class teacher list another class');
});

test('only the class teacher can write; owner, other teachers and strangers cannot', async () => {
  await denied(set('owner-a', path(), rec({ markedBy: 'owner-a' })), 'owner create');
  await denied(set('peer-a', path(), rec({ markedBy: 'peer-a' })), 'class teacher of another class');
  await denied(set('subject-a', path(), rec({ markedBy: 'subject-a' })), 'subject teacher, not class teacher');
  await denied(set('inactive-a', path(), rec({ markedBy: 'inactive-a' })), 'inactive teacher');
  await denied(set('parent-a', path(), rec({ markedBy: 'parent-a' })), 'parent');
  await denied(set('stranger', path(), rec({ markedBy: 'stranger' })), 'no membership');
  await denied(set(null, path(), rec()), 'signed out');
  await set(ADMIN, path(), rec());
  await denied(set('owner-a', path(), rec({ status: 'absent', markedBy: 'owner-a' })), 'owner update');
  await denied(set('peer-a', path(), rec({ status: 'absent', markedBy: 'peer-a' })), 'other class teacher update');
  await denied(set('subject-a', path(), rec({ status: 'absent', markedBy: 'subject-a' })), 'subject teacher update');
});

test('only the class teacher and owner can read; others cannot', async () => {
  await set(ADMIN, path(), rec());
  await denied(get('peer-a', path()), 'class teacher of another class');
  await denied(get('subject-a', path()), 'subject teacher');
  await denied(get('inactive-a', path()), 'inactive teacher');
  await denied(get('parent-a', path()), 'parent');
  await denied(get('stranger', path()), 'stranger');
  await denied(get(null, path()), 'signed out');
  await denied(query('subject-a', A, 'attendance', [['classId', 'class-8'], ['date', TODAY]]), 'subject teacher list');
});

test('a class teacher is not a teacher in another school, and schools are separate', async () => {
  await set(ADMIN, path(rec(), A), rec());
  await set(ADMIN, path(rec({ markedBy: 'ct-b' }), B), rec({ markedBy: 'ct-b' }));
  await denied(get('ct-b', path(rec(), A)), 'B teacher reads A');
  await denied(set('ct-b', path(rec(), A), rec({ markedBy: 'ct-b' })), 'B teacher writes A');
  await denied(get('ct-a', path(rec(), B)), 'A teacher reads B');
  await denied(set('ct-a', path(rec(), B), rec()), 'A teacher writes B');
  await denied(get('owner-b', path(rec(), A)), 'B owner reads A');
  await denied(get('owner-a', path(rec(), B)), 'A owner reads B');
});

test('the student must be placed in the class for that year', async () => {
  await denied(set('ct-a', path(rec({ studentId: 's3' })), rec({ studentId: 's3' })), 'student placed in another class');
  await denied(set('ct-a', path(rec({ studentId: 's9' })), rec({ studentId: 's9' })), 'student with no placement');
  await denied(set('ct-a', path(rec({ classId: 'class-7' })), rec({ classId: 'class-7' })), 'class they are not class teacher of');
});

test('dates must fall inside an open academic year and not be in the future', async () => {
  await denied(set('ct-a', path(rec({ date: day(3) })), rec({ date: day(3) })), 'three days ahead');
  await denied(set('ct-a', path(rec({ date: day(90) })), rec({ date: day(90) })), 'far ahead, inside the year');
  await denied(set('ct-a', path(rec({ date: day(-150) })), rec({ date: day(-150) })), 'before the year starts');
  // A draft year is open; its dates are checked against its own start and end.
  const past = (date) => rec({ yearId: 'past-year', date });
  await allowed(set('ct-a', path(past(day(-250))), past(day(-250))), 'inside a draft year');
  await denied(set('ct-a', path(past(day(-199))), past(day(-199))), 'after that year ends');
  await denied(set('ct-a', path(past(day(-301))), past(day(-301))), 'before that year starts');
  // A closed year is frozen.
  const closed = (date, status = 'present') => rec({ yearId: 'closed-year', date, status });
  await denied(set('ct-a', path(closed(day(-450))), closed(day(-450))), 'create in a closed year');
  await set(ADMIN, path(closed(day(-450))), closed(day(-450)));
  await denied(set('ct-a', path(closed(day(-450))), closed(day(-450), 'absent')), 'update in a closed year');
  await denied(set('ct-a', path(rec({ yearId: 'missing-year' })), rec({ yearId: 'missing-year' })), 'year that does not exist');
});

test('malformed attendance records are rejected', async () => {
  const cases = {
    'unknown status': rec({ status: 'sick' }),
    'status in capitals': rec({ status: 'Present' }),
    'boolean status': rec({ status: true }),
    'marked by someone else': rec({ markedBy: 'peer-a' }),
    'bad date text': rec({ date: 'today' }),
    'date without zero padding': rec({ date: '2026-1-5' }),
    'extra field': { ...rec(), note: 'late bus' },
    'bad class id': rec({ classId: 'Class 8' }),
    'bad student id': rec({ studentId: 'S 1' }),
  };
  for (const [label, data] of Object.entries(cases)) {
    // Each record goes to its own matching ID, so only the field being tested can cause the refusal.
    await denied(set('ct-a', path(data), data), label);
  }
  const missing = rec();
  delete missing.status;
  await denied(set('ct-a', path(rec()), missing), 'missing status');
  const noMarker = rec();
  delete noMarker.markedBy;
  await denied(set('ct-a', path(rec()), noMarker), 'missing markedBy');
});

test('the document ID must match the record, on create and on update', async () => {
  await denied(set('ct-a', `${A}/attendance/${TODAY}_class-8_s2`, rec()), 'create under another student\'s ID');
  await denied(set('ct-a', `${A}/attendance/random-id`, rec()), 'create under a random ID');
  await set(ADMIN, path(), rec());
  await denied(set('ct-a', path(), rec({ studentId: 's2' })), 'update that swaps the student');
  await denied(set('ct-a', path(), rec({ date: day(-1) })), 'update that moves the date');
  await denied(set('ct-a', path(), rec({ yearId: 'overlap-year' })), 'update that changes the year');
});

test('attendance records cannot be deleted', async () => {
  await set(ADMIN, path(), rec());
  await denied(remove('ct-a', path()), 'class teacher delete');
  await denied(remove('owner-a', path()), 'owner delete');
});

test('owner can assign, change and read a class teacher', async () => {
  await allowed(set('owner-a', `${A}/classTeachers/class-8`, { teacherUid: 'subject-a' }), 'change class teacher');
  await allowed(get('owner-a', `${A}/classTeachers/class-8`), 'owner read');
  await allowed(set('owner-a', `${A}/classTeachers/class-8`, { teacherUid: 'ct-a' }), 'change back');
  await allowed(query('owner-a', A, 'classTeachers', [['teacherUid', 'ct-a']]), 'owner list');
});

test('class teacher assignments reject bad input and non-owners', async () => {
  const target = `${A}/classTeachers/class-8`;
  await denied(set('owner-a', target, { teacherUid: 'owner-a' }), 'uid is an owner, not a teacher');
  await denied(set('owner-a', target, { teacherUid: 'inactive-a' }), 'inactive teacher');
  await denied(set('owner-a', target, { teacherUid: 'parent-a' }), 'parent account');
  await denied(set('owner-a', target, { teacherUid: 'nobody' }), 'uid with no membership');
  await denied(set('owner-a', target, { teacherUid: 'ct-b' }), 'teacher of another school');
  await denied(set('owner-a', target, { teacherUid: '' }), 'empty uid');
  await denied(set('owner-a', target, { teacherUid: 'ct-a', note: 'x' }), 'extra field');
  await denied(set('owner-a', `${A}/classTeachers/class-12`, { teacherUid: 'ct-a' }), 'class that does not exist');
  await denied(set('ct-a', target, { teacherUid: 'ct-a' }), 'teacher assigns themselves');
  await denied(set('peer-a', `${A}/classTeachers/class-9`, { teacherUid: 'peer-a' }), 'another teacher');
  await denied(set('owner-b', target, { teacherUid: 'ct-a' }), 'owner of another school');
  await denied(set(null, target, { teacherUid: 'ct-a' }), 'signed out');
  await denied(remove('owner-a', target), 'delete');
});

test('a class teacher can read only their own assignment', async () => {
  await allowed(get('ct-a', `${A}/classTeachers/class-8`), 'own class');
  await allowed(query('ct-a', A, 'classTeachers', [['teacherUid', 'ct-a']]), 'find own class by uid');
  await denied(get('ct-a', `${A}/classTeachers/class-7`), 'another class');
  await denied(query('ct-a', A, 'classTeachers', [['teacherUid', 'peer-a']]), 'list another teacher\'s class');
  await denied(get('subject-a', `${A}/classTeachers/class-8`), 'subject teacher');
  await denied(get('parent-a', `${A}/classTeachers/class-8`), 'parent');
  await denied(get(null, `${A}/classTeachers/class-8`), 'signed out');
});

test('a class teacher can read their class placements and sections, and teachers can read years', async () => {
  await allowed(query('ct-a', A, 'enrollments', [['yearId', Y], ['classId', 'class-8']]), 'own class placements');
  await allowed(query('ct-a', A, 'sections', [['classId', 'class-8']]), 'own class sections');
  await denied(query('ct-a', A, 'enrollments', [['yearId', Y], ['classId', 'class-7']]), 'another class placements');
  await denied(query('ct-a', A, 'sections', [['classId', 'class-7']]), 'another class sections');
  await denied(query('peer-a', A, 'enrollments', [['yearId', Y], ['classId', 'class-8']]), 'other class teacher, class 8 placements');
  await allowed(get('ct-a', `${A}/academicYears/${Y}`), 'teacher reads a year');
  await allowed(get('subject-a', `${A}/academicYears/${Y}`), 'subject teacher reads a year');
  await denied(get('inactive-a', `${A}/academicYears/${Y}`), 'inactive teacher reads a year');
  await denied(get('parent-a', `${A}/academicYears/${Y}`), 'parent reads a year');
  await denied(get(null, `${A}/academicYears/${Y}`), 'signed out reads a year');
  await denied(set('ct-a', `${A}/academicYears/${Y}`, { label: Y, startDate: day(-100), endDate: day(100), status: 'closed' }), 'teacher cannot change a year');
  // The subject teacher keeps the placement access they already had.
  await allowed(set(ADMIN, `${A}/teacherAssignments/subject-a`, { className: 'Class 8', subject: 'Maths', classId: 'class-8', subjectId: 'maths' }), 'seed id-based assignment');
  await allowed(query('subject-a', A, 'enrollments', [['yearId', Y], ['classId', 'class-8']]), 'subject teacher placements, unchanged');
});

test('a class teacher can read the students placed in their class this year, and nobody else\'s', async () => {
  await allowed(get('ct-a', `${A}/students/s1`), 'own class student');
  await allowed(get('ct-a', `${A}/students/s2`), 'own class second student');
  await denied(get('ct-a', `${A}/students/s3`), 'student in another class');
  await denied(get('ct-a', `${A}/students/s4`), 'student placed only in an earlier year');
  await allowed(get('peer-a', `${A}/students/s3`), 'other class teacher reads their own student');
  await denied(get('peer-a', `${A}/students/s1`), 'other class teacher reads class 8 student');
  await allowed(get('owner-a', `${A}/students/s1`), 'owner still reads');
  await denied(get('subject-a', `${A}/students/s1`), 'subject teacher, not class teacher');
  await denied(get('inactive-a', `${A}/students/s1`), 'inactive teacher');
  await denied(get('parent-a', `${A}/students/s1`), 'parent with no link');
  await denied(get('stranger', `${A}/students/s1`), 'stranger');
  await denied(get('ct-b', `${A}/students/s1`), 'teacher of another school');
  await denied(get(null, `${A}/students/s1`), 'signed out');
});

test('a class teacher cannot list or change students', async () => {
  await denied(get('ct-a', `${A}/students`), 'list students');
  await denied(set('ct-a', `${A}/students/s1`, { admissionNo: 's1', name: 'Changed', guardianName: 'Test Guardian', guardianPhone: '', status: 'active' }), 'edit student');
  await denied(set('ct-a', `${A}/students/s5`, { admissionNo: 's5', name: 'New', guardianName: 'Test Guardian', guardianPhone: '', status: 'active' }), 'create student');
  await denied(remove('ct-a', `${A}/students/s1`), 'delete student');
});

test('without an active year set, a class teacher reads no students', async () => {
  await remove(ADMIN, `${A}/settings/academic`);
  await denied(get('ct-a', `${A}/students/s1`), 'no active year pointer');
  await allowed(get('owner-a', `${A}/students/s1`), 'owner unaffected');
});

test('a class teacher can read only their own class record', async () => {
  await allowed(get('ct-a', `${A}/classes/class-8`), 'own class');
  await denied(get('ct-a', `${A}/classes/class-7`), 'another class');
  await allowed(get('peer-a', `${A}/classes/class-7`), 'other class teacher reads their own class');
  await denied(get('subject-a', `${A}/classes/class-8`), 'subject teacher');
  await denied(get('inactive-a', `${A}/classes/class-8`), 'inactive teacher');
  await denied(get('ct-b', `${A}/classes/class-8`), 'teacher of another school');
  await denied(get(null, `${A}/classes/class-8`), 'signed out');
  await denied(get('ct-a', `${A}/classes`), 'list classes');
  await denied(set('ct-a', `${A}/classes/class-8`, { name: 'Renamed', order: 8 }), 'edit class');
  await allowed(get('owner-a', `${A}/classes/class-8`), 'owner still reads');
});

test('a linked parent or student reads only their own student\'s attendance', async () => {
  await set(ADMIN, path(rec()), rec());
  await set(ADMIN, path(rec({ studentId: 's2' })), rec({ studentId: 's2' }));
  await allowed(get('parent-1', path(rec())), 'parent reads own student');
  await denied(get('parent-1', path(rec({ studentId: 's2' }))), 'parent reads another student');
  await allowed(get('parent-2', path(rec({ studentId: 's2' }))), 'other parent reads their student');
  await denied(get('parent-2', path(rec())), 'other parent reads s1');
  await allowed(query('parent-1', A, 'attendance', [['studentId', 's1']]), 'parent lists own student');
  await denied(query('parent-1', A, 'attendance', [['studentId', 's2']]), 'parent lists another student');
  await denied(query('parent-1', A, 'attendance', [['date', TODAY]]), 'parent lists a whole day');
  await denied(query('parent-1', A, 'attendance', [['classId', 'class-8']]), 'parent lists a whole class');
});

test('family attendance access can be switched off, and is read only', async () => {
  await set(ADMIN, path(rec()), rec());
  await denied(get('pupil-off', path(rec())), 'switched-off account');
  await denied(query('pupil-off', A, 'attendance', [['studentId', 's1']]), 'switched-off account lists');
  await denied(get('parent-a', path(rec())), 'parent account with no link');
  await denied(get('stranger', path(rec())), 'stranger');
  await denied(get(null, path(rec())), 'signed out');
  await denied(set('parent-1', path(rec()), rec({ status: 'absent', markedBy: 'parent-1' })), 'parent update');
  await denied(set('parent-1', path(rec({ studentId: 's2' })), rec({ studentId: 's2', markedBy: 'parent-1' })), 'parent create');
  await denied(remove('parent-1', path(rec())), 'parent delete');
});
