// Firestore rules tests for notices.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/notices.rules.test.mjs"
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
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

const note = (over = {}) => ({ title: 'Holiday', body: 'School is closed on Friday.', audience: 'all', createdAt: TODAY, createdBy: 'owner-a', ...over });
const classNote = (over = {}) => note({ audience: 'class', classId: 'class-8', ...over });
const path = (id = 'n-1', school = A) => `${school}/notices/${id}`;

// Structured query with IN support, so the filters the app uses are tested as written.
const queryWhere = async (who, parent, filters) => {
  const value = (v) => (Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } : encode(v));
  const one = ([field, op, v]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: value(v) } });
  const where = filters.length === 1 ? one(filters[0]) : { compositeFilter: { op: 'AND', filters: filters.map(one) } };
  const response = await fetch(`${base}/${parent}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'notices' }], where } }),
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
    [`${A}/members/other-t`, { role: 'teacher', active: true }],
    [`${A}/members/t-off`, { role: 'teacher', active: false }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/unlinked`, { role: 'parent', active: true }],
    [`${A}/members/pupil-off`, { role: 'student', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-7`, { name: 'Class 7', order: 7 }],
    [`${A}/classTeachers/class-8`, { teacherUid: 'ct-a' }],
    [`${A}/teacherAssignments/subj-a`, { className: 'Class 8', subject: 'Maths', classId: 'class-8', subjectId: 'maths' }],
    [`${A}/settings/academic`, { activeYearId: Y }],
    [`${A}/enrollments/${Y}_s1`, { yearId: Y, studentId: 's1', classId: 'class-8', sectionId: 'class-8-a', rollNo: 1 }],
    [`${A}/enrollments/${Y}_s2`, { yearId: Y, studentId: 's2', classId: 'class-7', sectionId: 'class-7-a', rollNo: 1 }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [`${A}/familyAccess/pupil-off`, { studentId: 's1', relation: 'student', active: false }],
    [path('n-all'), note()],
    [path('n-teachers'), note({ audience: 'teachers', title: 'Staff meeting' })],
    [path('n-families'), note({ audience: 'families', title: 'Fee reminder' })],
    [path('n-c8'), classNote({ title: 'Class 8 trip' })],
    [path('n-c7'), classNote({ classId: 'class-7', title: 'Class 7 test' })],
    [path('n-other', B), note({ createdBy: 'owner-b' })],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('owner can post a notice for each audience and remove it', async () => {
  await allowed(set('owner-a', path('n-new1'), note()), 'all');
  await allowed(set('owner-a', path('n-new2'), note({ audience: 'teachers' })), 'teachers');
  await allowed(set('owner-a', path('n-new3'), note({ audience: 'families' })), 'families');
  await allowed(set('owner-a', path('n-new4'), classNote()), 'class');
  await allowed(set('owner-a', path('n-new5'), note({ createdAt: day(1) })), 'tomorrow (time zone slack)');
  await allowed(remove('owner-a', path('n-new1')), 'remove');
});

test('malformed notices are rejected', async () => {
  await denied(set('owner-a', path('n-new'), note({ title: '  ' })), 'blank title');
  await denied(set('owner-a', path('n-new'), note({ title: 'x'.repeat(101) })), 'title too long');
  await denied(set('owner-a', path('n-new'), note({ body: '' })), 'empty body');
  await denied(set('owner-a', path('n-new'), note({ body: 'x'.repeat(2001) })), 'body too long');
  await denied(set('owner-a', path('n-new'), note({ audience: 'everyone' })), 'bad audience');
  await denied(set('owner-a', path('n-new'), note({ audience: 'class' })), 'class audience without a class');
  await denied(set('owner-a', path('n-new'), note({ classId: 'class-8' })), 'class with a non-class audience');
  await denied(set('owner-a', path('n-new'), classNote({ classId: 'class-9' })), 'unknown class');
  await denied(set('owner-a', path('n-new'), note({ createdBy: 'ct-a' })), 'createdBy is not the signed-in owner');
  await denied(set('owner-a', path('n-new'), note({ createdAt: day(2) })), 'future date');
  await denied(set('owner-a', path('n-new'), note({ createdAt: '2019-12-31' })), 'before 2020');
  await denied(set('owner-a', path('n-new'), { ...note(), extra: 'x' }), 'extra field');
  await denied(set('owner-a', path('bad id!'), note()), 'bad id');
});

test('only the owner can write, and a notice is never edited', async () => {
  await denied(set('ct-a', path('n-new'), note({ createdBy: 'ct-a' })), 'class teacher posts');
  await denied(set('other-t', path('n-new'), note({ createdBy: 'other-t' })), 'teacher posts');
  await denied(set('parent-1', path('n-new'), note({ createdBy: 'parent-1' })), 'parent posts');
  await denied(set('owner-b', path('n-new'), note({ createdBy: 'owner-b' })), 'owner of another school');
  await denied(set(null, path('n-new'), note()), 'signed out');
  await denied(set('owner-a', path('n-all'), note({ body: 'Changed' })), 'owner edits');
  await denied(remove('ct-a', path('n-all')), 'teacher removes');
  await denied(remove('parent-1', path('n-all')), 'parent removes');
  await denied(remove('owner-b', path('n-all')), 'owner of another school removes');
});

test('the owner reads every notice of their school', async () => {
  for (const id of ['n-all', 'n-teachers', 'n-families', 'n-c8', 'n-c7']) await allowed(get('owner-a', path(id)), id);
  await denied(get('owner-a', path('n-other', B)), 'another school');
});

test('teachers read notices for all, for teachers, and for their own classes', async () => {
  await allowed(get('other-t', path('n-all')), 'all');
  await allowed(get('other-t', path('n-teachers')), 'teachers');
  await denied(get('other-t', path('n-families')), 'families only');
  await denied(get('other-t', path('n-c8')), 'class notice, teacher of no class');
  await allowed(get('ct-a', path('n-c8')), 'class teacher reads own class');
  await denied(get('ct-a', path('n-c7')), 'class teacher reads another class');
  await allowed(get('subj-a', path('n-c8')), 'subject teacher reads their class');
  await denied(get('subj-a', path('n-c7')), 'subject teacher reads another class');
  await denied(get('t-off', path('n-all')), 'inactive teacher');
});

test('students and parents read notices for all, for families, and for their own class', async () => {
  await allowed(get('parent-1', path('n-all')), 'all');
  await allowed(get('parent-1', path('n-families')), 'families');
  await denied(get('parent-1', path('n-teachers')), 'teachers only');
  await allowed(get('parent-1', path('n-c8')), 'own class');
  await denied(get('parent-1', path('n-c7')), 'another class');
  await allowed(get('parent-2', path('n-c7')), 'second family, own class');
  await denied(get('parent-2', path('n-c8')), 'second family, other class');
  await denied(get('pupil-off', path('n-all')), 'switched-off student');
  await denied(get('unlinked', path('n-all')), 'parent with no link');
});

test('strangers and other schools read nothing', async () => {
  await denied(get('owner-b', path('n-all')), 'owner of another school');
  await denied(get(null, path('n-all')), 'signed out');
});

test('the list filters the app uses are allowed, and wider ones are not', async () => {
  await allowed(queryWhere('owner-a', A, [['audience', 'EQUAL', 'all']]), 'owner by audience');
  await allowed(queryWhere('other-t', A, [['audience', 'IN', ['all', 'teachers']]]), 'teacher general notices');
  await denied(queryWhere('other-t', A, [['audience', 'IN', ['all', 'families']]]), 'teacher asks for family notices');
  await allowed(queryWhere('ct-a', A, [['audience', 'EQUAL', 'class'], ['classId', 'EQUAL', 'class-8']]), 'class teacher class notices');
  await denied(queryWhere('ct-a', A, [['audience', 'EQUAL', 'class'], ['classId', 'EQUAL', 'class-7']]), 'class teacher, other class');
  await allowed(queryWhere('parent-1', A, [['audience', 'IN', ['all', 'families']]]), 'family general notices');
  await denied(queryWhere('parent-1', A, [['audience', 'IN', ['all', 'teachers']]]), 'family asks for teacher notices');
  await allowed(queryWhere('parent-1', A, [['audience', 'EQUAL', 'class'], ['classId', 'EQUAL', 'class-8']]), 'family own class notices');
  await denied(queryWhere('parent-1', A, [['audience', 'EQUAL', 'class'], ['classId', 'EQUAL', 'class-7']]), 'family other class notices');
  await denied(queryWhere('parent-1', A, [['audience', 'EQUAL', 'class']]), 'family all class notices');
  await denied(queryWhere('unlinked', A, [['audience', 'IN', ['all', 'families']]]), 'unlinked parent');
});
