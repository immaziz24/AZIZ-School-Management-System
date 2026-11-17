// Firestore rules tests for staff attendance.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/staffattendance.rules.test.mjs"
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

const rec = (over = {}) => ({ staffUid: 't1', date: TODAY, status: 'present', markedBy: 'owner-a', ...over });
const path = (r = rec(), school = A) => `${school}/staffAttendance/${r.date}_${r.staffUid}`;

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
    [`${A}/members/parent-a`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${B}/members/tb`, { role: 'teacher', active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('owner can mark, correct and re-save staff attendance', async () => {
  await allowed(set('owner-a', path(), rec()), 'create present');
  await allowed(set('owner-a', path(), rec({ status: 'leave' })), 'correct to leave');
  await allowed(set('owner-a', path(), rec({ status: 'late' })), 'correct to late');
  await allowed(set('owner-a', path(), rec({ status: 'absent' })), 'correct to absent');
  await allowed(set('owner-a', path(), rec({ status: 'absent' })), 'identical repeat save');
  await allowed(set('owner-a', path(rec({ staffUid: 't2' })), rec({ staffUid: 't2' })), 'second teacher');
  await allowed(set('owner-a', path(rec({ date: day(-1) })), rec({ date: day(-1) })), 'yesterday');
  await allowed(set('owner-a', path(rec({ date: day(-90) })), rec({ date: day(-90) })), 'an earlier day');
  await allowed(set('owner-a', path(rec({ date: day(1) })), rec({ date: day(1) })), 'tomorrow (time zone slack)');
});

test('only the owner can write; teachers, parents and strangers cannot', async () => {
  await denied(set('t1', path(), rec({ markedBy: 't1' })), 'teacher marks self');
  await denied(set('t2', path(), rec({ markedBy: 't2' })), 'other teacher');
  await denied(set('parent-a', path(), rec({ markedBy: 'parent-a' })), 'parent');
  await denied(set('owner-b', path(), rec({ markedBy: 'owner-b' })), 'owner of another school');
  await denied(set(null, path(), rec()), 'signed out');
  await allowed(set('owner-a', path(), rec()), 'seed a record');
  await denied(set('t1', path(), rec({ status: 'present', markedBy: 't1' })), 'teacher edits own record');
});

test('owner reads everything; a teacher reads only their own marks', async () => {
  await allowed(set('owner-a', path(), rec()), 'seed t1');
  await allowed(set('owner-a', path(rec({ staffUid: 't2' })), rec({ staffUid: 't2' })), 'seed t2');
  await allowed(get('owner-a', path()), 'owner get');
  await allowed(get('t1', path()), 'teacher reads own');
  await denied(get('t1', path(rec({ staffUid: 't2' }))), 'teacher reads another');
  await denied(get('t2', path()), 'other teacher');
  await denied(get('parent-a', path()), 'parent');
  await denied(get('owner-b', path()), 'owner of another school');
  await denied(get(null, path()), 'signed out');
});

test('list queries: owner by date, teacher by their own staffUid', async () => {
  await allowed(set('owner-a', path(), rec()), 'seed');
  await allowed(query('owner-a', A, 'staffAttendance', [['date', TODAY]]), 'owner by date');
  await allowed(query('t1', A, 'staffAttendance', [['staffUid', 't1']]), 'teacher own');
  await denied(query('t1', A, 'staffAttendance', [['staffUid', 't2']]), 'teacher other');
  await denied(query('t1', A, 'staffAttendance', [['date', TODAY]]), 'teacher by date only');
  await denied(query('parent-a', A, 'staffAttendance', [['staffUid', 't1']]), 'parent');
});

test('a deactivated teacher cannot read their marks or be marked', async () => {
  await denied(set('owner-a', path(rec({ staffUid: 't-off' })), rec({ staffUid: 't-off' })), 'mark inactive');
  await allowed(set(ADMIN, path(rec({ staffUid: 't-off' })), rec({ staffUid: 't-off' })), 'seed');
  await denied(get('t-off', path(rec({ staffUid: 't-off' }))), 'inactive reads own');
});

test('only active teachers of this school can be marked', async () => {
  await denied(set('owner-a', path(rec({ staffUid: 'parent-a' })), rec({ staffUid: 'parent-a' })), 'a parent');
  await denied(set('owner-a', path(rec({ staffUid: 'owner-a' })), rec({ staffUid: 'owner-a' })), 'the owner');
  await denied(set('owner-a', path(rec({ staffUid: 'tb' })), rec({ staffUid: 'tb' })), 'teacher of another school');
  await denied(set('owner-a', path(rec({ staffUid: 'nobody' })), rec({ staffUid: 'nobody' })), 'unknown uid');
});

test('dates cannot be in the future or before 2020', async () => {
  await denied(set('owner-a', path(rec({ date: day(2) })), rec({ date: day(2) })), 'two days ahead');
  await denied(set('owner-a', path(rec({ date: day(30) })), rec({ date: day(30) })), 'a month ahead');
  await denied(set('owner-a', path(rec({ date: '2019-12-31' })), rec({ date: '2019-12-31' })), 'before 2020');
});

test('malformed staff attendance records are rejected', async () => {
  await denied(set('owner-a', path(), rec({ status: 'holiday' })), 'bad status');
  await denied(set('owner-a', path(), rec({ status: 'PRESENT' })), 'status case');
  await denied(set('owner-a', path(), rec({ date: '17-11-2026' })), 'bad date format');
  await denied(set('owner-a', path(), rec({ markedBy: 't1' })), 'markedBy is not the signed-in owner');
  await denied(set('owner-a', path(), { ...rec(), extra: 'x' }), 'extra field');
  const { status, ...missing } = rec();
  await denied(set('owner-a', path(), missing), 'missing status');
  await denied(set('owner-a', path(), rec({ staffUid: 5 })), 'staffUid not a string');
});

test('the document ID must match the record, on create and on update', async () => {
  await denied(set('owner-a', `${A}/staffAttendance/${TODAY}_t2`, rec()), 'wrong staff in ID');
  await denied(set('owner-a', `${A}/staffAttendance/${day(-1)}_t1`, rec()), 'wrong date in ID');
  await denied(set('owner-a', `${A}/staffAttendance/random`, rec()), 'random ID');
  await allowed(set('owner-a', path(), rec()), 'valid create');
  await denied(set('owner-a', path(), rec({ staffUid: 't2' })), 'cannot change teacher on update');
});

test('staff attendance records cannot be deleted', async () => {
  await allowed(set('owner-a', path(), rec()), 'create');
  await denied(remove('owner-a', path()), 'owner delete');
  await denied(remove('t1', path()), 'teacher delete');
  await denied(remove('parent-a', path()), 'parent delete');
});

test('schools are separate', async () => {
  await allowed(set('owner-b', path(rec({ staffUid: 'tb', markedBy: 'owner-b' }), B), rec({ staffUid: 'tb', markedBy: 'owner-b' })), 'school B own');
  await denied(get('owner-a', path(rec({ staffUid: 'tb' }), B)), 'owner A reads B');
  await denied(get('tb', path(rec({ staffUid: 'tb' }), A)), 'B teacher reads A');
});

test('the owner can list and read member accounts of their school; no one else can', async () => {
  await allowed(get('owner-a', `${A}/members/t1`), 'owner reads a teacher member');
  await allowed(get('t1', `${A}/members/t1`), 'teacher reads own member');
  await denied(get('t1', `${A}/members/t2`), 'teacher reads another member');
  await denied(get('parent-a', `${A}/members/t1`), 'parent reads a member');
  await denied(get('owner-b', `${A}/members/t1`), 'owner of another school');
  await allowed(query('owner-a', A, 'members', [['role', 'teacher']]), 'owner lists teachers');
  await denied(query('t1', A, 'members', [['role', 'teacher']]), 'teacher lists members');
  await denied(query('parent-a', A, 'members', [['role', 'teacher']]), 'parent lists members');
  await denied(query('owner-b', A, 'members', [['role', 'teacher']]), 'owner of another school lists');
  await denied(set('owner-a', `${A}/members/t3`, { role: 'teacher', active: true }), 'owner cannot write members');
});
