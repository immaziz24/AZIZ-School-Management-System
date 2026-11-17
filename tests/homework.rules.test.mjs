// Firestore rules tests for homework.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/homework.rules.test.mjs"
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

const work = (over = {}) => ({ classId: 'class-8', subjectId: 'maths', subject: 'Maths', title: 'Chapter 4', details: 'Do exercises 1 to 5.', dueDate: day(3), createdAt: TODAY, createdBy: 'subj-a', ...over });
const path = (id = 'H-1', school = A) => `${school}/homework/${id}`;

// Structured query with IN support, so the filters the app uses are tested as written.
const queryWhere = async (who, parent, filters) => {
  const value = (v) => (Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } : encode(v));
  const one = ([field, op, v]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: value(v) } });
  const where = filters.length === 1 ? one(filters[0]) : { compositeFilter: { op: 'AND', filters: filters.map(one) } };
  const response = await fetch(`${base}/${parent}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'homework' }], where } }),
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
    [path('H-8'), work()],
    [path('H-7'), work({ classId: 'class-7', subjectId: 'english', subject: 'English', createdBy: 'subj-b' })],
    [path('H-8', B), work()],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('the subject teacher posts homework for their own class and subject', async () => {
  await allowed(set('subj-a', path('H-new'), work()), 'own class and subject');
  await allowed(set('subj-a', path('H-new2'), work({ dueDate: TODAY })), 'due today');
  await denied(set('subj-a', path('H-new'), work({ classId: 'class-7' })), 'another class');
  await denied(set('subj-a', path('H-new'), work({ subjectId: 'science', subject: 'Science' })), 'another subject');
  await denied(set('ct-a', path('H-new'), work({ createdBy: 'ct-a' })), 'class teacher who is not the subject teacher');
  await denied(set('other-t', path('H-new'), work({ createdBy: 'other-t' })), 'teacher with no assignment');
  await denied(set('t-off', path('H-new'), work({ createdBy: 't-off' })), 'inactive teacher');
  await denied(set('parent-1', path('H-new'), work({ createdBy: 'parent-1' })), 'parent');
  await denied(set('owner-b', path('H-new'), work({ createdBy: 'owner-b' })), 'owner of another school');
  await denied(set(null, path('H-new'), work()), 'signed out');
});

test('the owner can post homework for any class', async () => {
  await allowed(set('owner-a', path('H-own'), work({ classId: 'class-7', subjectId: 'science', subject: 'Science', createdBy: 'owner-a' })), 'owner');
  await denied(set('owner-a', path('H-own2'), work({ classId: 'class-9', createdBy: 'owner-a' })), 'unknown class');
});

test('malformed homework is rejected', async () => {
  await denied(set('subj-a', path('H-new'), work({ title: '  ' })), 'blank title');
  await denied(set('subj-a', path('H-new'), work({ title: 'x'.repeat(101) })), 'title too long');
  await denied(set('subj-a', path('H-new'), work({ details: '' })), 'empty details');
  await denied(set('subj-a', path('H-new'), work({ details: 'x'.repeat(2001) })), 'details too long');
  await denied(set('subj-a', path('H-new'), work({ dueDate: day(-1) })), 'due before it was set');
  await denied(set('subj-a', path('H-new'), work({ dueDate: 'soon' })), 'bad due date');
  await denied(set('subj-a', path('H-new'), work({ createdAt: day(2), dueDate: day(5) })), 'future created date');
  await denied(set('subj-a', path('H-new'), work({ createdBy: 'owner-a' })), 'createdBy is someone else');
  await denied(set('subj-a', path('H-new'), { ...work(), extra: 1 }), 'extra field');
  await denied(set('subj-a', path('bad id!'), work()), 'bad id');
});

test('homework is never edited; only the owner or its author removes it', async () => {
  await denied(set('subj-a', path('H-8'), work({ title: 'Changed' })), 'author edits');
  await denied(set('owner-a', path('H-8'), work({ title: 'Changed' })), 'owner edits');
  await allowed(remove('subj-a', path('H-8')), 'author removes');
  await denied(remove('subj-a', path('H-7')), 'removes another teacher\'s');
  await allowed(remove('owner-a', path('H-7')), 'owner removes');
  await denied(remove('parent-1', path('H-8')), 'parent removes');
  await denied(remove('owner-b', path('H-8')), 'owner of another school');
});

test('who reads homework', async () => {
  await allowed(get('owner-a', path('H-8')), 'owner');
  await allowed(get('subj-a', path('H-8')), 'subject teacher');
  await allowed(get('ct-a', path('H-8')), 'class teacher');
  await denied(get('subj-a', path('H-7')), 'teacher of another class');
  await denied(get('other-t', path('H-8')), 'unassigned teacher');
  await denied(get('t-off', path('H-8')), 'inactive teacher');
  await allowed(get('parent-1', path('H-8')), 'family, own class');
  await denied(get('parent-1', path('H-7')), 'family, other class');
  await allowed(get('parent-2', path('H-7')), 'second family');
  await denied(get('unlinked', path('H-8')), 'unlinked parent');
  await denied(get('owner-b', path('H-8')), 'owner of another school');
  await denied(get(null, path('H-8')), 'signed out');
});

test('the list filters the app uses', async () => {
  await allowed(queryWhere('owner-a', A, [['classId', 'EQUAL', 'class-8']]), 'owner by class');
  await allowed(queryWhere('subj-a', A, [['classId', 'EQUAL', 'class-8']]), 'subject teacher own class');
  await denied(queryWhere('subj-a', A, [['classId', 'EQUAL', 'class-7']]), 'subject teacher other class');
  await allowed(queryWhere('ct-a', A, [['classId', 'EQUAL', 'class-8']]), 'class teacher');
  await allowed(queryWhere('parent-1', A, [['classId', 'EQUAL', 'class-8']]), 'family own class');
  await denied(queryWhere('parent-1', A, [['classId', 'EQUAL', 'class-7']]), 'family other class');
});
