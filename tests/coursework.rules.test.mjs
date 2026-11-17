// Firestore rules tests for coursework.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/coursework.rules.test.mjs"
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

const Y = 'y1';
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
    [`${A}/students/s3`, student('Tara', 'A3')],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-9`, { name: 'Class 9', order: 9 }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'sec-8a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { yearId: Y, studentId: 's2', classId: 'class-9', sectionId: 'sec-9a', rollNo: 1 }],
    [`${A}/teacherAssignments/t1`, { className: 'Class 8', subject: 'Maths', classId: 'class-8', subjectId: 'maths' }],
    [`${A}/teacherAssignments/t2`, { className: 'Class 9', subject: 'Science', classId: 'class-9', subjectId: 'science' }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [P('homework', 'HW-8'), { classId: 'class-8', subjectId: 'maths', subject: 'Maths', title: 'Fractions', details: 'Do page 4.', dueDate: day(3), createdAt: TODAY, createdBy: 't1' }],
    [P('homework', 'HW-9'), { classId: 'class-9', subjectId: 'science', subject: 'Science', title: 'Plants', details: 'Draw a leaf.', dueDate: day(3), createdAt: TODAY, createdBy: 't2' }],
    [P('submissions', 'HW-8_s1'), { homeworkId: 'HW-8', homeworkTitle: 'Fractions', studentId: 's1', studentName: 'Asha', classId: 'class-8', answer: 'Done.', submittedOn: TODAY, createdBy: 'parent-1' }],
    [P('assessments', 'AS-8'), { classId: 'class-8', subjectId: 'maths', subject: 'Maths', title: 'Quiz 1', date: TODAY, maxMarks: 20, createdBy: 't1' }],
    [P('assessments', 'AS-9'), { classId: 'class-9', subjectId: 'science', subject: 'Science', title: 'Quiz A', date: TODAY, maxMarks: 10, createdBy: 't2' }],
    [P('assessmentScores', 'AS-8_s1'), { assessmentId: 'AS-8', assessmentTitle: 'Quiz 1', subject: 'Maths', subjectId: 'maths', date: TODAY, studentId: 's1', classId: 'class-8', yearId: Y, score: 15, maxMarks: 20, createdBy: 't1' }],
    [P('assessmentScores', 'AS-9_s2'), { assessmentId: 'AS-9', assessmentTitle: 'Quiz A', subject: 'Science', subjectId: 'science', date: TODAY, studentId: 's2', classId: 'class-9', yearId: Y, score: 7, maxMarks: 10, createdBy: 't2' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const sub = (over = {}) => ({ homeworkId: 'HW-8', homeworkTitle: 'Fractions', studentId: 's1', studentName: 'Asha', classId: 'class-8', answer: 'My answer.', submittedOn: TODAY, createdBy: 'parent-1', ...over });

test('submissions: a family submits once for its own class homework', async () => {
  await remove('owner-a', P('submissions', 'HW-8_s1'));
  await allowed(set('parent-1', P('submissions', 'HW-8_s1'), sub()), 'submit');
  await denied(set('parent-1', P('submissions', 'HW-9_s1'), sub({ homeworkId: 'HW-9', homeworkTitle: 'Plants' })), 'homework of another class');
  await denied(set('parent-2', P('submissions', 'HW-8_s2'), sub({ studentId: 's2', studentName: 'Ravi', createdBy: 'parent-2' })), 'student not in that class');
  await denied(set('parent-1', P('submissions', 'HW-8_s2'), sub({ studentId: 's2', studentName: 'Ravi' })), 'other family student');
  await denied(set('parent-1', P('submissions', 'wrong'), sub()), 'id must match');
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), sub({ createdBy: 'parent-2' })), 'wrong creator');
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), sub({ answer: '  ' })), 'blank');
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), sub({ answer: 'x'.repeat(2001) })), 'too long');
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), sub({ feedback: 'self' })), 'self feedback');
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), { ...sub(), extra: 'x' }), 'extra field');
  for (const who of ['unlinked', 't1', 'owner-b', null]) {
    await denied(set(who, P('submissions', 'HW-8_s1'), sub({ createdBy: who ?? 'x' })), 'write by ' + who);
  }
});

test('submissions: resubmit, feedback and who can read', async () => {
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), sub({ answer: 'Changed' })), 'family cannot change a submission');
  const original = { homeworkId: 'HW-8', homeworkTitle: 'Fractions', studentId: 's1', studentName: 'Asha', classId: 'class-8', answer: 'Done.', submittedOn: TODAY, createdBy: 'parent-1' };
  await allowed(set('t1', P('submissions', 'HW-8_s1'), { ...original, feedback: 'Good work', feedbackAt: TODAY }), 'teacher feedback');
  await denied(set('t1', P('submissions', 'HW-8_s1'), { ...original, answer: 'Rewritten', feedback: 'x', feedbackAt: TODAY }), 'teacher rewrites answer');
  await denied(set('t2', P('submissions', 'HW-8_s1'), { ...original, feedback: 'x', feedbackAt: TODAY }), 'teacher of another class');
  await denied(set('parent-1', P('submissions', 'HW-8_s1'), { ...original, feedback: 'x', feedbackAt: TODAY }), 'family feedback');
  await allowed(get('owner-a', P('submissions', 'HW-8_s1')), 'owner reads');
  await allowed(get('t1', P('submissions', 'HW-8_s1')), 'class teacher reads');
  await allowed(get('parent-1', P('submissions', 'HW-8_s1')), 'own');
  for (const who of ['t2', 'parent-2', 'unlinked', 't-off', 'owner-b', null]) await denied(get(who, P('submissions', 'HW-8_s1')), 'read by ' + who);
  await allowed(query('t1', A, 'submissions', [['classId', 'class-8']]), 'teacher list');
  await denied(query('t1', A, 'submissions', [['classId', 'class-9']]), 'teacher list other class');
  await allowed(query('parent-1', A, 'submissions', [['studentId', 's1']]), 'family list');
  await denied(query('parent-1', A, 'submissions', [['studentId', 's2']]), 'family list other');
  await denied(remove('t1', P('submissions', 'HW-8_s1')), 'teacher remove');
  await denied(remove('parent-1', P('submissions', 'HW-8_s1')), 'family remove');
  await allowed(remove('owner-a', P('submissions', 'HW-8_s1')), 'owner removes');
});

test('assessments: the subject teacher creates, others cannot', async () => {
  const as = (over = {}) => ({ classId: 'class-8', subjectId: 'maths', subject: 'Maths', title: 'Quiz 2', date: TODAY, maxMarks: 25, createdBy: 't1', ...over });
  await allowed(set('t1', P('assessments', 'AS-new'), as()), 'teacher creates');
  await allowed(set('owner-a', P('assessments', 'AS-own'), as({ createdBy: 'owner-a' })), 'owner creates');
  await denied(set('t2', P('assessments', 'AS-x1'), as({ createdBy: 't2' })), 'other class teacher');
  await denied(set('t1', P('assessments', 'AS-x2'), as({ subjectId: 'science' })), 'other subject');
  await denied(set('t1', P('assessments', 'AS-x3'), as({ createdBy: 't2' })), 'wrong creator');
  await denied(set('t1', P('assessments', 'AS-x4'), as({ maxMarks: 0 })), 'zero marks');
  await denied(set('t1', P('assessments', 'AS-x5'), as({ title: ' ' })), 'blank title');
  await denied(set('t1', P('assessments', 'AS-x6'), as({ classId: 'class-99' })), 'unknown class');
  await denied(set('t1', P('assessments', 'bad id'), as()), 'bad id');
  for (const who of ['parent-1', 't-off', 'owner-b', null]) await denied(set(who, P('assessments', 'AS-x7'), as({ createdBy: who ?? 'x' })), 'write by ' + who);
  await allowed(get('t1', P('assessments', 'AS-8')), 'teacher reads own class');
  await denied(get('t1', P('assessments', 'AS-9')), 'teacher reads other class');
  await denied(get('parent-1', P('assessments', 'AS-8')), 'family');
  await denied(remove('t2', P('assessments', 'AS-8')), 'other teacher removes');
  await allowed(remove('t1', P('assessments', 'AS-8')), 'author removes');
});

test('assessment scores: written by the subject teacher, read by the family', async () => {
  const score = (over = {}) => ({ assessmentId: 'AS-8', assessmentTitle: 'Quiz 1', subject: 'Maths', subjectId: 'maths', date: TODAY, studentId: 's1', classId: 'class-8', yearId: Y, score: 18, maxMarks: 20, createdBy: 't1', ...over });
  await allowed(set('t1', P('assessmentScores', 'AS-8_s1'), score()), 'change a score');
  await denied(set('t1', P('assessmentScores', 'AS-8_s1'), score({ score: 21 })), 'above max');
  await denied(set('t1', P('assessmentScores', 'AS-8_s1'), score({ score: -1 })), 'negative');
  await denied(set('t1', P('assessmentScores', 'AS-8_s1'), score({ maxMarks: 30 })), 'max differs');
  await denied(set('t1', P('assessmentScores', 'AS-8_s1'), score({ assessmentTitle: 'Other' })), 'title differs');
  await denied(set('t1', P('assessmentScores', 'AS-8_s2'), score({ studentId: 's2' })), 'student of another class');
  await denied(set('t1', P('assessmentScores', 'wrong'), score()), 'id must match');
  await denied(set('t1', P('assessmentScores', 'AS-8_s1'), score({ createdBy: 't2' })), 'wrong creator');
  await denied(set('t1', P('assessmentScores', 'AS-8_s1'), { ...score(), extra: 'x' }), 'extra field');
  await denied(set('t2', P('assessmentScores', 'AS-8_s1'), score({ createdBy: 't2' })), 'other class teacher');
  for (const who of ['parent-1', 't-off', 'owner-b', null]) await denied(set(who, P('assessmentScores', 'AS-8_s1'), score({ createdBy: who ?? 'x' })), 'write by ' + who);
  await allowed(get('t1', P('assessmentScores', 'AS-8_s1')), 'teacher reads');
  await allowed(get('owner-a', P('assessmentScores', 'AS-8_s1')), 'owner reads');
  await allowed(get('parent-1', P('assessmentScores', 'AS-8_s1')), 'own');
  for (const who of ['parent-2', 't2', 'unlinked', 'owner-b', null]) await denied(get(who, P('assessmentScores', 'AS-8_s1')), 'read by ' + who);
  await allowed(query('parent-1', A, 'assessmentScores', [['studentId', 's1']]), 'family list');
  await denied(query('parent-1', A, 'assessmentScores', [['studentId', 's2']]), 'other family list');
  await allowed(query('t1', A, 'assessmentScores', [['assessmentId', 'AS-8'], ['classId', 'class-8']]), 'teacher list');
  await denied(remove('parent-1', P('assessmentScores', 'AS-8_s1')), 'family remove');
  await allowed(remove('t1', P('assessmentScores', 'AS-8_s1')), 'author removes');
});
