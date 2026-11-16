// Firestore rules tests for Teacher Marks Entry (features 042, 043).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/marks.rules.test.mjs"
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const root = `http://${host}/v1/projects/${project}/databases/(default)/documents`;

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
const body = (data) => JSON.stringify({
  fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])),
});
const headers = (who) => ({
  'Content-Type': 'application/json',
  ...(who ? { Authorization: 'Bearer ' + (who === ADMIN ? ADMIN : tokenFor(who)) } : {}),
});
const call = async (method, who, path, data) => {
  const response = await fetch(root + '/' + path, {
    method, headers: headers(who), ...(data ? { body: body(data) } : {}),
  });
  await response.arrayBuffer();
  return response.status;
};
const set = (who, path, data) => call('PATCH', who, path, data);
const get = (who, path) => call('GET', who, path);
const allowed = async (promise, label) => assert.equal(await promise, 200, label);
const denied = async (promise, label) => assert.equal(await promise, 403, label);

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const marks = (school, uid, id) => `${school}/teacherAssignments/${uid}/marks/${id}`;
const good = { className: 'Class 8', subject: 'English', exam: 'midterm', roll: '12', score: 45, maximum: 50 };
const key = 'midterm_12';

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${A}/members/peer-a`, { role: 'teacher', active: true }],
    [`${A}/members/inactive-a`, { role: 'teacher', active: false }],
    [`${A}/members/unassigned-a`, { role: 'teacher', active: true }],
    [`${B}/members/teacher-b`, { role: 'teacher', active: true }],
    [`${A}/teacherAssignments/teacher-a`, { className: 'Class 8', subject: 'English' }],
    [`${A}/teacherAssignments/peer-a`, { className: 'Class 7', subject: 'Science' }],
    [`${A}/teacherAssignments/inactive-a`, { className: 'Class 8', subject: 'English' }],
    [`${B}/teacherAssignments/teacher-b`, { className: 'Class 8', subject: 'English' }],
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200);
});

test('assigned teacher can create, read, update and re-save a mark', async () => {
  const path = marks(A, 'teacher-a', key);
  await allowed(set('teacher-a', path, good), 'create');
  await allowed(get('teacher-a', path), 'read');
  await allowed(set('teacher-a', path, { ...good, score: 48 }), 'update');
  await allowed(set('teacher-a', path, { ...good, score: 48 }), 'identical repeat save');
  await allowed(set('teacher-a', marks(A, 'teacher-a', 'midterm_13'), { ...good, roll: '13', score: 0 }), 'zero score');
  await allowed(set('teacher-a', marks(A, 'teacher-a', 'final_12'), { ...good, exam: 'final', score: 50 }), 'full score');
});

test('anonymous requests are rejected', async () => {
  await set(ADMIN, marks(A, 'teacher-a', key), good);
  await denied(set(null, marks(A, 'teacher-a', key), good), 'write');
  await denied(get(null, marks(A, 'teacher-a', key)), 'read');
});

test('peer teacher cannot read or write another teacher\'s marks', async () => {
  await set(ADMIN, marks(A, 'teacher-a', key), good);
  await denied(get('peer-a', marks(A, 'teacher-a', key)), 'read');
  await denied(set('peer-a', marks(A, 'teacher-a', key), { ...good, score: 1 }), 'overwrite');
  await denied(set('peer-a', marks(A, 'teacher-a', 'midterm_99'), { ...good, roll: '99' }), 'create');
  await denied(set('peer-a', marks(A, 'peer-a', key), good), 'own path, other teacher\'s class and subject');
});

test('owner cannot read or write marks through the teacher path', async () => {
  await set(ADMIN, marks(A, 'teacher-a', key), good);
  await denied(get('owner-a', marks(A, 'teacher-a', key)), 'read');
  await denied(set('owner-a', marks(A, 'teacher-a', key), good), 'write');
});

test('inactive teacher is rejected', async () => {
  await set(ADMIN, marks(A, 'inactive-a', key), good);
  await denied(set('inactive-a', marks(A, 'inactive-a', key), good), 'write');
  await denied(get('inactive-a', marks(A, 'inactive-a', key)), 'read');
});

test('teacher without an assignment or membership is rejected', async () => {
  await denied(set('unassigned-a', marks(A, 'unassigned-a', key), good), 'no assignment');
  await denied(set('stranger', marks(A, 'stranger', key), good), 'no membership');
});

test('cross-school access is rejected in both directions', async () => {
  await set(ADMIN, marks(A, 'teacher-a', key), good);
  await set(ADMIN, marks(B, 'teacher-b', key), good);
  await denied(get('teacher-b', marks(A, 'teacher-a', key)), 'B reads A');
  await denied(set('teacher-b', marks(A, 'teacher-a', key), good), 'B writes A teacher path');
  await denied(set('teacher-b', marks(A, 'teacher-b', key), good), 'B writes own uid under A');
  await denied(get('teacher-a', marks(B, 'teacher-b', key)), 'A reads B');
  await denied(set('teacher-a', marks(B, 'teacher-a', key), good), 'A writes own uid under B');
  await allowed(set('teacher-b', marks(B, 'teacher-b', key), good), 'B writes B');
});

test('wrong class or subject is rejected', async () => {
  const path = marks(A, 'teacher-a', key);
  await denied(set('teacher-a', path, { ...good, className: 'Class 9' }), 'class');
  await denied(set('teacher-a', path, { ...good, subject: 'Science' }), 'subject');
  await denied(set('teacher-a', path, { ...good, className: 'Class 7', subject: 'Science' }), 'peer pair');
});

test('invalid scores are rejected', async () => {
  const path = marks(A, 'teacher-a', key);
  const cases = {
    negative: { score: -1 }, 'above maximum': { score: 51 }, decimal: { score: 45.5 },
    'string score': { score: '45' }, 'zero maximum': { score: 0, maximum: 0 },
    'maximum above 1000': { maximum: 1001 }, 'decimal maximum': { maximum: 50.5 },
    'string maximum': { maximum: '50' }, 'boolean score': { score: true },
  };
  for (const [label, change] of Object.entries(cases)) {
    await denied(set('teacher-a', path, { ...good, ...change }), label);
  }
  await set(ADMIN, path, good);
  await denied(set('teacher-a', path, { ...good, score: 51 }), 'update above maximum');
});

test('extra, missing and malformed fields are rejected', async () => {
  const path = marks(A, 'teacher-a', key);
  await denied(set('teacher-a', path, { ...good, approved: true }), 'extra field');
  for (const field of Object.keys(good)) {
    const { [field]: _, ...rest } = good;
    await denied(set('teacher-a', path, rest), 'missing ' + field);
  }
  await denied(set('teacher-a', marks(A, 'teacher-a', 'midterm_13'), good), 'document ID does not match roll');
  await denied(set('teacher-a', marks(A, 'teacher-a', 'final_12'), good), 'document ID does not match exam');
  await denied(set('teacher-a', marks(A, 'teacher-a', 'Midterm_12'), { ...good, exam: 'Midterm' }), 'uppercase exam');
  await denied(set('teacher-a', marks(A, 'teacher-a', 'mid term_12'), { ...good, exam: 'mid term' }), 'space in exam');
  await denied(set('teacher-a', marks(A, 'teacher-a', 'midterm_1_2'), { ...good, roll: '1_2' }), 'underscore in roll');
  const longExam = 'e'.repeat(41);
  await denied(set('teacher-a', marks(A, 'teacher-a', longExam + '_12'), { ...good, exam: longExam }), 'long exam');
  const longRoll = '1'.repeat(25);
  await denied(set('teacher-a', marks(A, 'teacher-a', 'midterm_' + longRoll), { ...good, roll: longRoll }), 'long roll');
});

test('list and delete are rejected', async () => {
  await set(ADMIN, marks(A, 'teacher-a', key), good);
  await denied(get('teacher-a', `${A}/teacherAssignments/teacher-a/marks`), 'list');
  await denied(call('DELETE', 'teacher-a', marks(A, 'teacher-a', key)), 'delete');
});

// Known limitation: the key has no academic year, class or subject, so a reassigned
// teacher's new marks collide with the old ones. The rules fail closed.
test('after reassignment old marks are locked and colliding keys are refused', async () => {
  const path = marks(A, 'teacher-a', key);
  await allowed(set('teacher-a', path, good), 'create under Class 8 English');
  await set(ADMIN, `${A}/teacherAssignments/teacher-a`, { className: 'Class 9', subject: 'Maths' });
  const next = { ...good, className: 'Class 9', subject: 'Maths' };
  await denied(get('teacher-a', path), 'read old mark');
  await denied(set('teacher-a', path, good), 'write with old pair');
  await denied(set('teacher-a', path, next), 'overwrite old mark with new pair (collision)');
  await allowed(set('teacher-a', marks(A, 'teacher-a', 'midterm_77'), { ...next, roll: '77' }), 'new key under new pair');
});
