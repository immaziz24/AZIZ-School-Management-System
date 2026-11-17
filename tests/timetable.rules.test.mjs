// Firestore rules tests for timetable.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/timetable.rules.test.mjs"
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

const slot = (over = {}) => ({ classId: 'class-8', className: 'Class 8', day: 1, period: 1, subject: 'Maths', start: '09:00', end: '09:45', ...over });
const path = (id = 'class-8_1_1', school = A) => `${school}/timetable/${id}`;

// Structured query with IN support, so the filters the app uses are tested as written.
const queryWhere = async (who, parent, filters) => {
  const value = (v) => (Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } : encode(v));
  const one = ([field, op, v]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: value(v) } });
  const where = filters.length === 1 ? one(filters[0]) : { compositeFilter: { op: 'AND', filters: filters.map(one) } };
  const response = await fetch(`${base}/${parent}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'timetable' }], where } }),
  });
  await response.arrayBuffer();
  return response.status;
};

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/ct-a`, { role: 'teacher', active: true }],
    [`${A}/members/subj-a`, { role: 'teacher', active: true }],
    [`${A}/members/subj-b`, { role: 'teacher', active: true }],
    [`${A}/members/other-t`, { role: 'teacher', active: true }],
    [`${A}/members/t-off`, { role: 'teacher', active: false }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/unlinked`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-7`, { name: 'Class 7', order: 7 }],
    [`${A}/classTeachers/class-8`, { teacherUid: 'ct-a' }],
    [`${A}/teacherAssignments/subj-a`, { className: 'Class 8', subject: 'Maths', classId: 'class-8', subjectId: 'maths' }],
    [`${A}/teacherAssignments/subj-b`, { className: 'Class 7', subject: 'English', classId: 'class-7', subjectId: 'english' }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { yearId: Y, studentId: 's2', classId: 'class-7', sectionId: 'class-7-a', rollNo: 1 }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [path(), slot()],
    [path('class-7_1_1'), slot({ classId: 'class-7', className: 'Class 7', subject: 'English' })],
    [path('class-8_1_1', B), slot()],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('owner can add, change and remove timetable slots', async () => {
  await allowed(set('owner-a', path('class-8_2_3'), slot({ day: 2, period: 3 })), 'add');
  await allowed(set('owner-a', path('class-8_2_3'), slot({ day: 2, period: 3, subject: 'Science', teacher: 'Mr Roy' })), 'change');
  await allowed(set('owner-a', path('class-8_7_12'), slot({ day: 7, period: 12 })), 'limits');
  await allowed(remove('owner-a', path()), 'remove');
});

test('malformed slots are rejected', async () => {
  await denied(set('owner-a', path('class-8_1_2'), slot({ period: 1 })), 'id does not match day and period');
  await denied(set('owner-a', path('class-8_0_1'), slot({ day: 0 })), 'day 0');
  await denied(set('owner-a', path('class-8_8_1'), slot({ day: 8 })), 'day 8');
  await denied(set('owner-a', path('class-8_1_13'), slot({ period: 13 })), 'period 13');
  await denied(set('owner-a', path('class-8_1_2'), slot({ period: 2, start: '9:00' })), 'bad time');
  await denied(set('owner-a', path('class-8_1_2'), slot({ period: 2, start: '25:00' })), 'impossible time');
  await denied(set('owner-a', path('class-8_1_2'), slot({ period: 2, end: '09:00' })), 'ends when it starts');
  await denied(set('owner-a', path('class-8_1_2'), slot({ period: 2, subject: '' })), 'empty subject');
  await denied(set('owner-a', path('class-8_1_2'), slot({ period: 2, teacher: 'x'.repeat(61) })), 'teacher too long');
  await denied(set('owner-a', path('class-9_1_1'), slot({ classId: 'class-9' })), 'unknown class');
  await denied(set('owner-a', path('class-8_1_2'), { ...slot({ period: 2 }), extra: 1 }), 'extra field');
});

test('only the owner writes the timetable', async () => {
  await denied(set('ct-a', path('class-8_2_3'), slot({ day: 2, period: 3 })), 'class teacher');
  await denied(set('subj-a', path('class-8_2_3'), slot({ day: 2, period: 3 })), 'subject teacher');
  await denied(set('parent-1', path('class-8_2_3'), slot({ day: 2, period: 3 })), 'parent');
  await denied(set('owner-b', path('class-8_2_3'), slot({ day: 2, period: 3 })), 'owner of another school');
  await denied(set(null, path('class-8_2_3'), slot({ day: 2, period: 3 })), 'signed out');
  await denied(remove('ct-a', path()), 'teacher removes');
  await denied(remove('parent-1', path()), 'parent removes');
});

test('owner and every active teacher read; families read only their own class', async () => {
  await allowed(get('owner-a', path()), 'owner');
  await allowed(get('ct-a', path()), 'class teacher');
  await allowed(get('other-t', path()), 'any active teacher');
  await allowed(get('other-t', path('class-7_1_1')), 'teacher, other class');
  await denied(get('t-off', path()), 'inactive teacher');
  await allowed(get('parent-1', path()), 'family, own class');
  await denied(get('parent-1', path('class-7_1_1')), 'family, other class');
  await denied(get('unlinked', path()), 'unlinked parent');
  await denied(get('owner-b', path()), 'owner of another school');
  await denied(get(null, path()), 'signed out');
});

test('the list filters the app uses', async () => {
  await allowed(queryWhere('owner-a', A, [['classId', 'EQUAL', 'class-8']]), 'owner by class');
  await allowed(queryWhere('other-t', A, [['classId', 'EQUAL', 'class-7']]), 'teacher by class');
  await allowed(queryWhere('parent-1', A, [['classId', 'EQUAL', 'class-8']]), 'family own class');
  await denied(queryWhere('parent-1', A, [['classId', 'EQUAL', 'class-7']]), 'family other class');
  await denied(queryWhere('unlinked', A, [['classId', 'EQUAL', 'class-8']]), 'unlinked parent');
});
