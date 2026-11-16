// Firestore rules tests for Students (features 025, 026, 027, 029).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/students.rules.test.mjs"
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
const allowed = async (promise, label) => assert.equal(await promise, 200, label);
const denied = async (promise, label) => assert.equal(await promise, 403, label);

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const student = { admissionNo: 'A-101', name: 'Test Student One', guardianName: 'Test Guardian', guardianPhone: '+91 90000 00001', status: 'active' };
const path = `${A}/students/a-101`;

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
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200);
});

test('owner can create, read, list, edit and deactivate a student', async () => {
  await allowed(set('owner-a', path, student), 'create');
  await allowed(get('owner-a', path), 'read');
  await allowed(get('owner-a', `${A}/students`), 'list');
  await allowed(set('owner-a', path, { ...student, name: 'Test Student Renamed', guardianPhone: '' }), 'edit, empty phone');
  await allowed(set('owner-a', path, { ...student, status: 'inactive' }), 'deactivate');
  await allowed(set('owner-a', path, student), 'reactivate');
  await allowed(set('owner-a', `${A}/students/9`, { ...student, admissionNo: '9' }), 'numeric admission number');
});

test('teacher, inactive owner, anonymous and strangers cannot read or write students', async () => {
  await set(ADMIN, path, student);
  for (const who of ['teacher-a', 'inactive-owner-a', null, 'stranger']) {
    await denied(get(who, path), `${who} reads`);
    await denied(get(who, `${A}/students`), `${who} lists`);
    await denied(set(who, path, { ...student, name: 'Changed' }), `${who} updates`);
    await denied(set(who, `${A}/students/a-102`, { ...student, admissionNo: 'A-102' }), `${who} creates`);
  }
});

test('cross-school access is rejected in both directions', async () => {
  await set(ADMIN, path, student);
  await denied(get('owner-b', path), 'B reads A');
  await denied(get('owner-b', `${A}/students`), 'B lists A');
  await denied(set('owner-b', path, { ...student, name: 'Changed' }), 'B updates A');
  await denied(set('owner-b', `${A}/students/a-102`, { ...student, admissionNo: 'A-102' }), 'B creates in A');
  await denied(set('owner-a', `${B}/students/a-102`, { ...student, admissionNo: 'A-102' }), 'A creates in B');
  await allowed(set('owner-b', `${B}/students/a-101`, student), 'B creates in B with the same number');
});

test('admission number is the document ID and cannot be changed or duplicated', async () => {
  await allowed(set('owner-a', path, student), 'create');
  await denied(set('owner-a', path, { ...student, admissionNo: 'A-101X' }), 'change admission number');
  await denied(set('owner-a', path, { ...student, admissionNo: 'a-101' }), 'same number, different case overwrites');
  await denied(set('owner-a', `${A}/students/a-102`, student), 'ID does not match admission number');
  await denied(set('owner-a', `${A}/students/A-103`, { ...student, admissionNo: 'A-103' }), 'uppercase ID');
  await denied(set('owner-a', `${A}/students/a_104`, { ...student, admissionNo: 'a_104' }), 'underscore');
  await denied(set('owner-a', `${A}/students/${'a'.repeat(21)}`, { ...student, admissionNo: 'a'.repeat(21) }), 'long number');
});

test('student fields are validated', async () => {
  const cases = {
    'empty name': { name: '  ' }, 'long name': { name: 'x'.repeat(121) }, 'numeric name': { name: 5 },
    'empty guardian': { guardianName: ' ' }, 'long guardian': { guardianName: 'x'.repeat(121) },
    'letters in phone': { guardianPhone: 'call me' }, 'long phone': { guardianPhone: '1'.repeat(21) },
    'unknown status': { status: 'left' }, 'created inactive': { status: 'inactive' },
    'space in admission number': { admissionNo: 'A 101' },
  };
  for (const [label, change] of Object.entries(cases)) {
    await denied(set('owner-a', path, { ...student, ...change }), label);
  }
  await denied(set('owner-a', path, { ...student, grade: '8' }), 'extra field');
  for (const field of Object.keys(student)) {
    const { [field]: _, ...rest } = student;
    await denied(set('owner-a', path, rest), 'missing ' + field);
  }
});

test('delete is rejected', async () => {
  await set(ADMIN, path, student);
  await denied(call('DELETE', 'owner-a', path), 'owner delete');
  await denied(call('DELETE', 'teacher-a', path), 'teacher delete');
});
