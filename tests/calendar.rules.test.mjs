// Firestore rules tests for calendar.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/calendar.rules.test.mjs"
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
const ev = (over = {}) => ({ title: 'Diwali holiday', date: '2026-11-08', kind: 'holiday', ...over });
const path = (id = 'E-1', school = A) => `${school}/calendar/${id}`;

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${A}/members/teacher-off`, { role: 'teacher', active: false }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-off`, { role: 'parent', active: true }],
    [`${A}/members/unlinked`, { role: 'parent', active: true }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-off`, { studentId: 's1', relation: 'parent', active: false }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [path(), ev()],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('owner can add, change and remove events of every kind', async () => {
  for (const kind of ['holiday', 'exam', 'event', 'meeting']) await allowed(set('owner-a', path('E-' + kind), ev({ kind })), kind);
  await allowed(set('owner-a', path('E-1'), ev({ title: 'Changed', note: 'School closed' })), 'change with note');
  await allowed(remove('owner-a', path('E-1')), 'remove');
});

test('malformed events are rejected', async () => {
  await denied(set('owner-a', path('E-new'), ev({ title: '  ' })), 'blank title');
  await denied(set('owner-a', path('E-new'), ev({ title: 'x'.repeat(101) })), 'title too long');
  await denied(set('owner-a', path('E-new'), ev({ date: 'tomorrow' })), 'bad date');
  await denied(set('owner-a', path('E-new'), ev({ date: '2019-12-31' })), 'before 2020');
  await denied(set('owner-a', path('E-new'), ev({ kind: 'party' })), 'unknown kind');
  await denied(set('owner-a', path('E-new'), ev({ note: 'x'.repeat(301) })), 'note too long');
  await denied(set('owner-a', path('E-new'), { ...ev(), extra: 1 }), 'extra field');
  await denied(set('owner-a', path('bad id!'), ev()), 'bad id');
});

test('only the owner writes the calendar', async () => {
  await denied(set('teacher-a', path('E-new'), ev()), 'teacher');
  await denied(set('parent-1', path('E-new'), ev()), 'parent');
  await denied(set('owner-b', path('E-new'), ev()), 'owner of another school');
  await denied(set(null, path('E-new'), ev()), 'signed out');
  await denied(remove('teacher-a', path()), 'teacher removes');
  await denied(remove('parent-1', path()), 'parent removes');
});

test('owner, active teachers and linked families read it', async () => {
  await allowed(get('owner-a', path()), 'owner');
  await allowed(get('teacher-a', path()), 'teacher');
  await allowed(get('parent-1', path()), 'linked family');
  await denied(get('teacher-off', path()), 'inactive teacher');
  await denied(get('parent-off', path()), 'switched-off family');
  await denied(get('unlinked', path()), 'unlinked parent');
  await denied(get('owner-b', path()), 'owner of another school');
  await denied(get(null, path()), 'signed out');
});
