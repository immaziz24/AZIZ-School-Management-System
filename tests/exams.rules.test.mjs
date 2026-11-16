// Firestore rules tests for exam configuration (features 040, 041).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/exams.rules.test.mjs"
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

const exam = (over = {}) => ({
  yearId: Y, classId: 'class-8', subjectId: 'maths', examKey: 'midterm',
  name: 'Mid-term', maxMarks: 50, status: 'open', ...over,
});
const examPath = (school, e = exam()) => `${school}/exams/${e.yearId}_${e.classId}_${e.subjectId}_${e.examKey}`;

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
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
    [`${A}/subjects/maths`, { name: 'Maths', code: 'MAT' }],
    [`${A}/subjects/science`, { name: 'Science', code: 'SCI' }],
    [`${A}/classSubjects/class-8_maths`, { classId: 'class-8', subjectId: 'maths' }],
    [`${A}/classSubjects/class-7_maths`, { classId: 'class-7', subjectId: 'maths' }],
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200, path);
});

test('owner can create, read, list and rename an open exam', async () => {
  await allowed(set('owner-a', examPath(A), exam()), 'create');
  await allowed(get('owner-a', examPath(A)), 'read');
  await allowed(get('owner-a', `${A}/exams`), 'list');
  await allowed(set('owner-a', examPath(A), exam({ name: 'Mid-term test', maxMarks: 100 })), 'rename and change maximum');
  await allowed(set('owner-a', examPath(A, exam({ examKey: 'final' })), exam({ examKey: 'final', name: 'Final' })), 'second exam, same subject');
  await allowed(set('owner-a', examPath(A, exam({ yearId: '2027-28' })), exam({ yearId: '2027-28' })), 'exam in a draft year');
});

test('teachers, inactive owners, other schools and signed-out users are refused', async () => {
  await denied(set('teacher-a', examPath(A), exam()), 'teacher create');
  await denied(set('inactive-owner-a', examPath(A), exam()), 'inactive owner create');
  await denied(set('owner-b', examPath(A), exam()), 'other school owner create');
  await denied(set(null, examPath(A), exam()), 'signed out create');
  await allowed(set(ADMIN, examPath(A), exam()), 'seed one exam');
  await denied(get('teacher-a', examPath(A)), 'teacher read');
  await denied(get('owner-b', examPath(A)), 'other school read');
  await denied(get(null, examPath(A)), 'signed out read');
  await denied(set('teacher-a', examPath(A), exam({ name: 'Hacked' })), 'teacher update');
});

test('an exam needs a real class-subject link and an open year', async () => {
  await denied(set('owner-a', examPath(A, exam({ subjectId: 'science' })), exam({ subjectId: 'science' })), 'subject not linked to the class');
  await denied(set('owner-a', examPath(A, exam({ classId: 'class-9' })), exam({ classId: 'class-9' })), 'class does not exist');
  await denied(set('owner-a', examPath(A, exam({ yearId: '2025-26' })), exam({ yearId: '2025-26' })), 'closed year');
  await denied(set('owner-a', examPath(A, exam({ yearId: '2030-31' })), exam({ yearId: '2030-31' })), 'year does not exist');
});

test('the document ID must match the fields', async () => {
  await denied(set('owner-a', `${A}/exams/anything`, exam()), 'arbitrary ID');
  await denied(set('owner-a', `${A}/exams/${Y}_class-8_maths_final`, exam()), 'ID names another exam key');
  await denied(set('owner-a', `${A}/exams/${Y}_class-7_maths_midterm`, exam()), 'ID names another class');
});

test('exam fields are validated', async () => {
  const bad = (over, label) => denied(set('owner-a', examPath(A), exam(over)), label);
  await bad({ name: '' }, 'empty name');
  await bad({ name: '   ' }, 'blank name');
  await bad({ name: 'x'.repeat(61) }, 'name too long');
  await bad({ maxMarks: 0 }, 'maximum zero');
  await bad({ maxMarks: -5 }, 'negative maximum');
  await bad({ maxMarks: 1001 }, 'maximum too large');
  await bad({ maxMarks: 50.5 }, 'fractional maximum');
  await bad({ maxMarks: '50' }, 'text maximum');
  await bad({ status: 'locked' }, 'created locked');
  await bad({ status: 'draft' }, 'unknown status');
  await bad({ examKey: 'Mid Term' }, 'bad exam key');
  await denied(set('owner-a', examPath(A), { ...exam(), extra: 'x' }), 'extra field');
  const { maxMarks, ...missing } = exam();
  await denied(set('owner-a', examPath(A), missing), 'missing field');
});

test('identity fields cannot change after creation', async () => {
  await allowed(set(ADMIN, examPath(A), exam()), 'seed');
  await denied(set('owner-a', examPath(A), exam({ examKey: 'final' })), 'change exam key');
  await denied(set('owner-a', examPath(A), exam({ classId: 'class-7' })), 'change class');
  await denied(set('owner-a', examPath(A), exam({ subjectId: 'science' })), 'change subject');
  await denied(set('owner-a', examPath(A), exam({ yearId: '2027-28' })), 'change year');
});

test('a locked exam is frozen, and only the owner can reopen it', async () => {
  await allowed(set('owner-a', examPath(A), exam()), 'create');
  await allowed(set('owner-a', examPath(A), exam({ status: 'locked' })), 'lock');
  await denied(set('owner-a', examPath(A), exam({ status: 'locked', maxMarks: 80 })), 'change maximum while locked');
  await denied(set('owner-a', examPath(A), exam({ status: 'locked', name: 'Renamed' })), 'rename while locked');
  await denied(set('owner-a', examPath(A), exam({ status: 'open', maxMarks: 80 })), 'reopen and change maximum in one write');
  await denied(set('owner-a', examPath(A), exam({ status: 'open', name: 'Renamed' })), 'reopen and rename in one write');
  await denied(set('teacher-a', examPath(A), exam({ status: 'open' })), 'teacher reopen');
  await denied(set('inactive-owner-a', examPath(A), exam({ status: 'open' })), 'inactive owner reopen');
  await denied(set('owner-b', examPath(A), exam({ status: 'open' })), 'other school owner reopen');
  await allowed(set('owner-a', examPath(A), exam({ status: 'open' })), 'owner reopens');
  await allowed(set('owner-a', examPath(A), exam({ maxMarks: 80 })), 'edit after reopening');
  await allowed(set('owner-a', examPath(A), exam({ maxMarks: 80, status: 'locked' })), 'lock again');
});

test('exams in a closed year are frozen', async () => {
  await allowed(set(ADMIN, examPath(A, exam({ yearId: '2025-26' })), exam({ yearId: '2025-26' })), 'seed in closed year');
  await denied(set('owner-a', examPath(A, exam({ yearId: '2025-26' })), exam({ yearId: '2025-26', name: 'Edited' })), 'edit in closed year');
  await denied(set('owner-a', examPath(A, exam({ yearId: '2025-26' })), exam({ yearId: '2025-26', status: 'locked' })), 'lock in closed year');
  await allowed(set(ADMIN, examPath(A, exam({ yearId: '2025-26', examKey: 'final' })), exam({ yearId: '2025-26', examKey: 'final', status: 'locked' })), 'seed locked exam in closed year');
  await denied(set('owner-a', examPath(A, exam({ yearId: '2025-26', examKey: 'final' })), exam({ yearId: '2025-26', examKey: 'final', status: 'open' })), 'reopen in closed year');
});

test('exams cannot be deleted from the client and schools are isolated', async () => {
  await allowed(set('owner-a', examPath(A), exam()), 'create');
  await denied(call('DELETE', 'owner-a', examPath(A)), 'owner delete');
  await denied(call('DELETE', 'teacher-a', examPath(A)), 'teacher delete');
  await denied(set('owner-a', examPath(B), exam()), 'owner of A writing into school B');
  await denied(get('owner-a', `${B}/exams`), 'owner of A listing school B');
});

test('the owner approves a locked exam, and only the owner can withdraw approval', async () => {
  const approved = (over = {}) => exam({ status: 'approved', approvedBy: 'owner-a', ...over });
  await allowed(set('owner-a', examPath(A), exam()), 'create');
  await denied(set('owner-a', examPath(A), approved()), 'open exam cannot be approved directly');
  await allowed(set('owner-a', examPath(A), exam({ status: 'locked' })), 'lock');
  await denied(set('teacher-a', examPath(A), approved({ approvedBy: 'teacher-a' })), 'teacher cannot approve');
  await denied(set('owner-a', examPath(A), exam({ status: 'approved' })), 'approval must name who approved');
  await denied(set('owner-a', examPath(A), approved({ approvedBy: 'someone-else' })), 'approval must name the approving owner');
  await denied(set('owner-a', examPath(A), approved({ maxMarks: 80 })), 'approve and change the maximum in one write');
  await denied(set('owner-a', examPath(A), approved({ name: 'Renamed' })), 'approve and rename in one write');
  await denied(set('owner-a', examPath(A), exam({ status: 'locked', approvedBy: 'owner-a' })), 'approvedBy on a locked exam');
  await allowed(set('owner-a', examPath(A), approved()), 'owner approves');
  await allowed(get('owner-a', examPath(A)), 'approved exam stays readable');
  await denied(set('owner-a', examPath(A), approved({ name: 'Renamed' })), 'edit while approved');
  await denied(set('owner-a', examPath(A), approved({ maxMarks: 80 })), 'change maximum while approved');
  await denied(set('owner-a', examPath(A), exam({ status: 'open' })), 'approved exam cannot jump to open');
  await denied(set('teacher-a', examPath(A), exam({ status: 'locked' })), 'teacher cannot withdraw approval');
  await denied(set('owner-b', examPath(A), exam({ status: 'locked' })), 'other school cannot withdraw approval');
  await allowed(set('owner-a', examPath(A), exam({ status: 'locked' })), 'owner withdraws approval');
  await allowed(set('owner-a', examPath(A), exam({ status: 'open' })), 'owner reopens');
  await allowed(set('owner-a', examPath(A), exam({ status: 'locked' })), 'lock again');
  await allowed(set('owner-a', examPath(A), approved()), 'approve again');
});

test('an approved exam in a closed year stays frozen', async () => {
  const closed = (status, extra = {}) => exam({ yearId: '2025-26', status, ...extra });
  await allowed(set(ADMIN, examPath(A, closed('approved')), closed('approved', { approvedBy: 'owner-a' })), 'seed');
  await denied(set('owner-a', examPath(A, closed('approved')), closed('locked')), 'withdraw approval in a closed year');
});
