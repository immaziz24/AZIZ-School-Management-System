// Firestore rules tests for library.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/library.rules.test.mjs"
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
const student = (name) => ({ admissionNo: 'A1', name, guardianName: 'Parent', guardianPhone: '', status: 'active' });

const reset = async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
};
const seedAll = async (seed) => {
  for (const [seedPath, data] of [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/s1`, student('Asha')],
    ...seed,
  ]) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
};

const book = (over = {}) => ({ title: 'Wings of Fire', author: 'A P J Abdul Kalam', copies: 2, ...over });
const loan = (over = {}) => ({ bookId: 'bk-1', studentId: 's1', issuedOn: TODAY, dueOn: day(14), issuedBy: 'owner-a', ...over });
const bpath = (id = 'bk-1', school = A) => `${school}/books/${id}`;
const lpath = (id = 'LN-1', school = A) => `${school}/loans/${id}`;

beforeEach(async () => {
  await reset();
  await seedAll([[bpath(), book()], [lpath(), loan()], [bpath('bk-1', B), book()]]);
});

test('owner manages books', async () => {
  await allowed(set('owner-a', bpath('bk-2'), book({ copies: 1000 })), 'add');
  await allowed(set('owner-a', bpath('bk-1'), book({ copies: 5 })), 'change copies');
  await allowed(remove('owner-a', bpath('bk-2')), 'remove');
  await denied(set('owner-a', bpath('bk-3'), book({ title: ' ' })), 'blank title');
  await denied(set('owner-a', bpath('bk-3'), book({ title: 'x'.repeat(121) })), 'title too long');
  await denied(set('owner-a', bpath('bk-3'), book({ copies: 0 })), 'no copies');
  await denied(set('owner-a', bpath('bk-3'), book({ copies: 1001 })), 'too many copies');
  await denied(set('owner-a', bpath('bk-3'), { ...book(), extra: 1 }), 'extra field');
  await denied(set('owner-a', bpath('Bad Id'), book()), 'bad id');
});

test('owner issues a loan for a real book and student', async () => {
  await allowed(set('owner-a', lpath('LN-2'), loan()), 'issue');
  await allowed(set('owner-a', lpath('LN-3'), loan({ dueOn: TODAY })), 'due the same day');
  await denied(set('owner-a', lpath('LN-4'), loan({ bookId: 'bk-9' })), 'unknown book');
  await denied(set('owner-a', lpath('LN-4'), loan({ studentId: 'zz' })), 'unknown student');
  await denied(set('owner-a', lpath('LN-4'), loan({ dueOn: day(-1) })), 'due before issue');
  await denied(set('owner-a', lpath('LN-4'), loan({ issuedOn: day(2), dueOn: day(16) })), 'future issue date');
  await denied(set('owner-a', lpath('LN-4'), loan({ issuedBy: 'teacher-a' })), 'issuedBy is someone else');
  await denied(set('owner-a', lpath('LN-4'), loan({ returnedOn: TODAY })), 'already returned on creation');
  await denied(set('owner-a', lpath('bad id!'), loan()), 'bad id');
});

test('a return is the only change, made once, and loans are never deleted', async () => {
  await allowed(set('owner-a', lpath(), loan({ returnedOn: TODAY })), 'return');
  await denied(set('owner-a', lpath(), loan({ returnedOn: day(1) })), 'return a second time');
  await denied(remove('owner-a', lpath()), 'delete');
});

test('a return must be sensible', async () => {
  await denied(set('owner-a', lpath(), loan({ returnedOn: day(-1) })), 'returned before it was issued');
  await denied(set('owner-a', lpath(), loan({ returnedOn: day(3) })), 'returned in the future');
  await denied(set('owner-a', lpath(), loan({ dueOn: day(30), returnedOn: TODAY })), 'changes the due date too');
  await denied(set('owner-a', lpath(), loan({ studentId: 'other', returnedOn: TODAY })), 'changes the student too');
});

test('only the owner reads or writes library records', async () => {
  for (const who of ['teacher-a', 'parent-1', 'owner-b', null]) {
    await denied(get(who, bpath()), 'read book ' + who);
    await denied(get(who, lpath()), 'read loan ' + who);
    await denied(set(who, bpath('bk-5'), book()), 'write book ' + who);
    await denied(set(who, lpath('LN-5'), loan({ issuedBy: who ?? 'x' })), 'write loan ' + who);
  }
  await allowed(get('owner-a', bpath()), 'owner reads book');
  await allowed(get('owner-a', lpath()), 'owner reads loan');
  await denied(get('owner-a', bpath('bk-1', B)), 'owner reads another school');
});
