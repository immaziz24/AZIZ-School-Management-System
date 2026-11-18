// Firestore rules tests for pass marks, draft marks and fee due dates. Synthetic records only.
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
const EXAM = `${Y}_class-8_maths_midterm`;
const exam = (over = {}) => ({ yearId: Y, classId: 'class-8', subjectId: 'maths', examKey: 'midterm', name: 'Mid-term', maxMarks: 50, status: 'open', ...over });
const mark = (student, score = 40, over = {}) => ({ examId: EXAM, yearId: Y, classId: 'class-8', subjectId: 'maths', studentId: student, score, maxMarks: 50, enteredBy: 't1', ...over });
const markPath = (student) => `${A}/marks/${EXAM}_${student}`;

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/teacherAssignments/t1`, { className: 'Class 8', subject: 'Maths', classId: 'class-8', subjectId: 'maths' }],
    [`${A}/academicYears/${Y}`, { label: Y, startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/subjects/maths`, { name: 'Maths', code: 'MAT' }],
    [`${A}/classSubjects/class-8_maths`, { classId: 'class-8', subjectId: 'maths' }],
    [`${A}/students/s1`, { admissionNo: 's1', name: 'Test Student', guardianName: 'G', guardianPhone: '', status: 'active' }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200, path);
});

test('pass marks per exam: between 0 and the maximum, fixed once approved', async () => {
  const path = `${A}/exams/${EXAM}`;
  await allowed(set('owner-a', path, exam({ passMarks: 17 })), 'create with pass marks');
  await allowed(set('owner-a', path, exam({ passMarks: 0 })), 'zero is allowed');
  await allowed(set('owner-a', path, exam({ passMarks: 50 })), 'equal to maximum');
  await allowed(set('owner-a', path, exam()), 'pass marks are optional');
  for (const bad of [{ passMarks: 51 }, { passMarks: -1 }, { passMarks: 17.5 }, { passMarks: '17' }]) {
    await denied(set('owner-a', path, exam(bad)), JSON.stringify(bad));
  }
  await set(ADMIN, path, exam({ passMarks: 17, status: 'locked' }));
  await denied(set('prin', path, exam({ passMarks: 20, status: 'approved', approvedBy: 'prin' })), 'principal cannot change pass marks');
  await denied(set('prin', path, exam({ status: 'approved', approvedBy: 'prin' })), 'principal cannot drop pass marks');
  await allowed(set('prin', path, exam({ passMarks: 17, status: 'approved', approvedBy: 'prin' })), 'principal approves unchanged');
});

test('draft marks: a teacher saves drafts, then submits them', async () => {
  await set(ADMIN, `${A}/exams/${EXAM}`, exam());
  await allowed(set('t1', markPath('s1'), mark('s1', 30, { draft: true })), 'save as draft');
  await allowed(set('t1', markPath('s1'), mark('s1', 33, { draft: true })), 'change the draft');
  await allowed(set('t1', markPath('s1'), mark('s1', 33)), 'submit (draft removed)');
  await allowed(set('t1', markPath('s1'), mark('s1', 34, { draft: true })), 'back to draft while open');
  await denied(set('t1', markPath('s1'), mark('s1', 33, { draft: false })), 'draft can only be true');
  await denied(set('t1', markPath('s1'), mark('s1', 33, { draft: 'yes' })), 'draft must be a boolean');
  await set(ADMIN, `${A}/exams/${EXAM}`, exam({ status: 'locked' }));
  await denied(set('t1', markPath('s1'), mark('s1', 35)), 'locked exam still blocks marks');
});

test('fee due dates: optional date on each fee amount', async () => {
  const fee = (over = {}) => ({ yearId: Y, classId: 'class-8', head: 'tuition', name: 'Tuition', amount: 12000, ...over });
  const path = `${A}/feeStructures/${Y}_class-8_tuition`;
  await allowed(set('owner-a', path, fee()), 'no due date');
  await allowed(set('owner-a', path, fee({ dueOn: '2026-07-10' })), 'with due date');
  for (const bad of [{ dueOn: '10-07-2026' }, { dueOn: 'soon' }, { dueOn: 5 }, { dueOn: '1999-01-01' }]) {
    await denied(set('owner-a', path, fee(bad)), JSON.stringify(bad));
  }
  await denied(set('prin', path, fee({ dueOn: '2026-07-10' })), 'principal cannot');
});
