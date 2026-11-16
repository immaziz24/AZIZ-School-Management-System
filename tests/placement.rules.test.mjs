// Firestore rules tests for student placement and roll numbers (feature 028).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/placement.rules.test.mjs"
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

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const Y = '2026-27';

// Builders for the pair of documents the app always writes together.
const enrollment = (student, section, classId, rollNo, year = Y) => (
  { yearId: year, studentId: student, classId, sectionId: section, rollNo });
const rollKey = (student, section, rollNo, year = Y) => (
  { yearId: year, sectionId: section, rollNo, studentId: student });
const place = (school, student, section, classId, rollNo, year = Y) => [
  [`${school}/enrollments/${year}_${student}`, enrollment(student, section, classId, rollNo, year)],
  [`${school}/rollKeys/${year}_${section}_${rollNo}`, rollKey(student, section, rollNo, year)],
];

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const student = (n, status = 'active') => ({
    admissionNo: n, name: 'Test Student ' + n, guardianName: 'Test Guardian', guardianPhone: '', status });
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/inactive-owner-a`, { role: 'owner', active: false }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/academicYears/${Y}`, { label: Y, startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [`${A}/academicYears/2027-28`, { label: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31', status: 'draft' }],
    [`${A}/academicYears/2025-26`, { label: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', status: 'closed' }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-7`, { name: 'Class 7', order: 7 }],
    [`${A}/sections/class-8-a`, { classId: 'class-8', name: 'A' }],
    [`${A}/sections/class-8-b`, { classId: 'class-8', name: 'B' }],
    [`${A}/sections/class-7-a`, { classId: 'class-7', name: 'A' }],
    [`${A}/students/s1`, student('s1')],
    [`${A}/students/s2`, student('s2')],
    [`${A}/students/s3`, student('s3')],
    [`${A}/students/gone`, student('gone', 'inactive')],
    [`${B}/students/s1`, student('s1')],
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200, path);
});

test('owner can place a student and read the records', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 1)), 'place');
  await allowed(get('owner-a', `${A}/enrollments/${Y}_s1`), 'read enrollment');
  await allowed(get('owner-a', `${A}/rollKeys/${Y}_class-8-a_1`), 'read roll key');
  await allowed(get('owner-a', `${A}/enrollments`), 'list enrollments');
  await allowed(get('owner-a', `${A}/rollKeys`), 'list roll keys');
  await allowed(batch('owner-a', place(A, 's2', 'class-8-a', 'class-8', 2)), 'second student, next roll');
  await allowed(batch('owner-a', place(A, 's3', 'class-8-b', 'class-8', 1)), 'same roll in another section');
  await allowed(batch('owner-a', place(A, 's1', 'class-7-a', 'class-7', 1, '2027-28')), 'same student in a draft year');
});

test('an enrollment and its roll key must be written together', async () => {
  const [enroll, key] = place(A, 's1', 'class-8-a', 'class-8', 1);
  await denied(batch('owner-a', [enroll]), 'enrollment without roll key');
  await denied(batch('owner-a', [key]), 'roll key without enrollment');
  await denied(batch('owner-a', [enroll, [key[0], { ...key[1], studentId: 's2' }]]), 'roll key names another student');
  await denied(batch('owner-a', [enroll, [key[0], { ...key[1], rollNo: 2 }]]), 'roll key has a different roll');
  await denied(batch('owner-a', [enroll, [`${A}/rollKeys/${Y}_class-8-a_2`, rollKey('s1', 'class-8-a', 2)]]), 'roll key ID for another roll');
  await denied(batch('owner-a', [enroll, [key[0], { ...key[1], sectionId: 'class-8-b' }]]), 'roll key in another section');
  await denied(set('owner-a', enroll[0], enroll[1]), 'single write of enrollment');
  await denied(set('owner-a', key[0], key[1]), 'single write of roll key');
});

test('a roll number belongs to one student per section per year', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 5)), 'first student');
  await denied(batch('owner-a', place(A, 's2', 'class-8-a', 'class-8', 5)), 'second student, same roll, same section');
  await denied(batch('owner-a', [
    [`${A}/enrollments/${Y}_s2`, enrollment('s2', 'class-8-a', 'class-8', 5)],
    [`${A}/rollKeys/${Y}_class-8-a_5`, null],
  ]), 'try to free the roll by deleting its key');
  await allowed(batch('owner-a', place(A, 's2', 'class-8-b', 'class-8', 5)), 'same roll, other section');
  await allowed(batch('owner-a', place(A, 's3', 'class-8-a', 'class-8', 6)), 'different roll');
});

test('a student can be moved and the old roll number is released', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 5)), 'place');
  const oldKey = `${A}/rollKeys/${Y}_class-8-a_5`;
  await denied(batch('owner-a', [[oldKey, null]]), 'delete key while the student still holds it');
  await denied(batch('owner-a', [place(A, 's1', 'class-8-b', 'class-8', 7)[0]]), 'move without the new roll key');
  await allowed(batch('owner-a', [...place(A, 's1', 'class-8-b', 'class-8', 7), [oldKey, null]]), 'move to another section');
  await allowed(batch('owner-a', place(A, 's2', 'class-8-a', 'class-8', 5)), 'old roll can be reused');
  await allowed(batch('owner-a', [
    ...place(A, 's1', 'class-8-b', 'class-8', 8),
    [`${A}/rollKeys/${Y}_class-8-b_7`, null],
  ]), 'change roll within the section');
});

test('a student cannot take a roll number already held by another student when moving', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 5)), 's1');
  await allowed(batch('owner-a', place(A, 's2', 'class-8-b', 'class-8', 5)), 's2');
  await denied(batch('owner-a', [
    [`${A}/enrollments/${Y}_s2`, enrollment('s2', 'class-8-a', 'class-8', 5)],
    [`${A}/rollKeys/${Y}_class-8-a_5`, rollKey('s2', 'class-8-a', 5)],
    [`${A}/rollKeys/${Y}_class-8-b_5`, null],
  ]), 'move onto an occupied roll');
});

test('enrollment fields are validated', async () => {
  const bad = async (label, change, keyChange = {}) => {
    const e = { ...enrollment('s1', 'class-8-a', 'class-8', 1), ...change };
    const k = { ...rollKey('s1', 'class-8-a', 1), ...keyChange };
    const id = `${A}/rollKeys/${k.yearId}_${k.sectionId}_${k.rollNo}`;
    await denied(batch('owner-a', [[`${A}/enrollments/${e.yearId}_${e.studentId}`, e], [id, k]]), label);
  };
  await bad('roll 0', { rollNo: 0 }, { rollNo: 0 });
  await bad('roll 1000', { rollNo: 1000 }, { rollNo: 1000 });
  await bad('roll as string', { rollNo: '1' }, { rollNo: '1' });
  await bad('roll with decimals', { rollNo: 1.5 }, { rollNo: 1.5 });
  await bad('class does not own the section', { classId: 'class-7' });
  await bad('unknown section', { sectionId: 'class-8-z' }, { sectionId: 'class-8-z' });
  await bad('unknown student', { studentId: 'nobody' }, { studentId: 'nobody' });
  await bad('inactive student', { studentId: 'gone' }, { studentId: 'gone' });
  await bad('unknown year', { yearId: '2030-31' }, { yearId: '2030-31' });
  await bad('closed year', { yearId: '2025-26' }, { yearId: '2025-26' });
  await bad('extra field', { grade: 'A' });
  const [enroll, key] = place(A, 's1', 'class-8-a', 'class-8', 1);
  await denied(batch('owner-a', [[`${A}/enrollments/${Y}_wrong`, enroll[1]], key]), 'ID does not match year and student');
  await denied(batch('owner-a', [enroll, [key[0], { ...key[1], extra: 1 }]]), 'extra field on roll key');
  for (const field of Object.keys(enroll[1])) {
    const { [field]: _, ...rest } = enroll[1];
    await denied(batch('owner-a', [[enroll[0], rest], key]), 'missing ' + field);
  }
});

test('closed years are frozen', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 1)), 'place while active');
  await set(ADMIN, `${A}/academicYears/${Y}`, { label: Y, startDate: '2026-04-01', endDate: '2027-03-31', status: 'closed' });
  await denied(batch('owner-a', place(A, 's2', 'class-8-a', 'class-8', 2)), 'new placement in closed year');
  await denied(batch('owner-a', [...place(A, 's1', 'class-8-b', 'class-8', 3), [`${A}/rollKeys/${Y}_class-8-a_1`, null]]), 'move in closed year');
});

test('a deactivated student cannot be moved', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 1)), 'place');
  await set(ADMIN, `${A}/students/s1`, { admissionNo: 's1', name: 'Test Student s1', guardianName: 'Test Guardian', guardianPhone: '', status: 'inactive' });
  await denied(batch('owner-a', [...place(A, 's1', 'class-8-b', 'class-8', 2), [`${A}/rollKeys/${Y}_class-8-a_1`, null]]), 'move inactive student');
});

test('teacher, inactive owner, anonymous and other schools cannot place or read', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 1)), 'place');
  for (const who of ['teacher-a', 'inactive-owner-a', null, 'stranger', 'owner-b']) {
    await denied(batch(who, place(A, 's2', 'class-8-a', 'class-8', 2)), `${who} places`);
    await denied(get(who, `${A}/enrollments/${Y}_s1`), `${who} reads enrollment`);
    await denied(get(who, `${A}/rollKeys/${Y}_class-8-a_1`), `${who} reads roll key`);
    await denied(get(who, `${A}/enrollments`), `${who} lists enrollments`);
  }
  await denied(batch('owner-a', place(B, 's1', 'class-8-a', 'class-8', 1)), 'A owner places in B');
  await denied(batch('owner-b', place(B, 's1', 'class-8-a', 'class-8', 1)), 'B owner, but B has no year or sections');
});

test('enrollments and roll keys cannot be deleted directly', async () => {
  await allowed(batch('owner-a', place(A, 's1', 'class-8-a', 'class-8', 1)), 'place');
  await denied(call('DELETE', 'owner-a', `${A}/enrollments/${Y}_s1`), 'delete enrollment');
  await denied(call('DELETE', 'owner-a', `${A}/rollKeys/${Y}_class-8-a_1`), 'delete roll key');
  await denied(call('DELETE', 'teacher-a', `${A}/enrollments/${Y}_s1`), 'teacher delete');
});
