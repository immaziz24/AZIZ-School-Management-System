// Firestore rules tests for study materials: who posts, who reads, who removes. Synthetic records only.
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
const TODAY = day(0);
const mat = (over = {}) => ({ classId: 'class-8', subject: 'English', title: 'Chapter 3 notes', link: 'https://example.com/notes.pdf',
  createdAt: TODAY, createdBy: 'sub-a', ...over });
const MP = (id = 'M-1', school = A) => `${school}/materials/${id}`;

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/sub-a`, { role: 'teacher', active: true }],
    [`${A}/members/other-a`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/settings/academic`, { activeYearId: Y, lastAttendanceDate: TODAY }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-7`, { name: 'Class 7', order: 7 }],
    [`${A}/enrollments/${Y}_s1`, { studentId: 's1', yearId: Y, classId: 'class-8', sectionId: 'a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { studentId: 's2', yearId: Y, classId: 'class-7', sectionId: 'a', rollNo: 1 }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [`${A}/teacherAssignments/sub-a`, { classId: 'class-8', subjectId: 'english' }],
    [`${A}/teacherAssignments/other-a`, { classId: 'class-7', subjectId: 'maths' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('the class teacher and the owner post materials; others cannot', async () => {
  await allowed(set('sub-a', MP(), mat()), 'teacher of the class posts');
  await allowed(set('owner-a', MP('M-2'), mat({ createdBy: 'owner-a' })), 'owner posts');
  await denied(set('other-a', MP('M-3'), mat({ createdBy: 'other-a' })), 'teacher of another class');
  await denied(set('parent-1', MP('M-4'), mat({ createdBy: 'parent-1' })), 'family');
  await denied(set('sub-a', MP('M-5'), mat({ createdBy: 'other-a' })), 'createdBy must be me');
  await denied(set('sub-a', MP('M-6', B), mat()), 'other school');
});

test('a material must be well formed', async () => {
  for (const bad of [mat({ link: 'http://example.com/a' }), mat({ link: 'javascript:alert(1)' }), mat({ link: 'https://a b' }), mat({ title: '  ' }),
    mat({ title: 'x'.repeat(101) }), mat({ subject: '' }), mat({ extra: 1 }), mat({ classId: 'nope' }), mat({ createdAt: day(5) })]) {
    await denied(set('sub-a', MP('M-9'), bad), 'invalid ' + JSON.stringify(bad).slice(0, 80));
  }
});

test('who reads and removes materials', async () => {
  await allowed(set(ADMIN, MP(), mat()), 'seed');
  await allowed(get('parent-1', MP()), 'own class family reads');
  await allowed(get('sub-a', MP()), 'teacher reads');
  await allowed(get('owner-a', MP()), 'owner reads');
  await allowed(get('prin', MP()), 'principal reads');
  await denied(get('parent-2', MP()), 'other class family');
  await denied(get('other-a', MP()), 'other class teacher');
  await denied(get('owner-b', MP()), 'other school');
  await allowed(query('parent-1', A, 'materials', [['classId', 'class-8']]), 'family list own class');
  await denied(query('parent-2', A, 'materials', [['classId', 'class-8']]), 'family list other class');
  await denied(remove('parent-1', MP()), 'family cannot remove');
  await denied(remove('other-a', MP()), 'other teacher cannot remove');
  await allowed(remove('sub-a', MP()), 'poster removes');
  await allowed(set(ADMIN, MP('M-7'), mat()), 'seed again');
  await allowed(remove('owner-a', MP('M-7')), 'owner removes');
});
