// Firestore rules tests for audit log.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/audit.rules.test.mjs"
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
const now = () => new Date().toISOString();
const entry = (over = {}) => ({ actor: 'owner-a', action: 'save', target: 'notices', docId: 'N-1', at: now(), ...over });
const path = (id = 'L-1', school = A) => `${school}/auditLog/${id}`;

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
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [path('L-seed'), entry()],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('owner can write an entry for each kind of action', async () => {
  for (const action of ['save', 'remove', 'void', 'decide-leave', 'activate-year', 'close-year', 'bulk', 'marks', 'attendance']) {
    await allowed(set('owner-a', path('L-' + action), entry({ action })), action);
  }
  await allowed(set('owner-a', path('L-detail'), entry({ detail: 'Rs 500' })), 'with detail');
});

test('malformed entries are rejected', async () => {
  await denied(set('owner-a', path('L-new'), entry({ action: 'hack' })), 'unknown action');
  await denied(set('owner-a', path('L-new'), entry({ actor: 'teacher-a' })), 'actor is not the signed-in owner');
  await denied(set('owner-a', path('L-new'), entry({ target: '' })), 'empty target');
  await denied(set('owner-a', path('L-new'), entry({ docId: 'x'.repeat(101) })), 'docId too long');
  await denied(set('owner-a', path('L-new'), entry({ at: '2026-11-17' })), 'time missing');
  await denied(set('owner-a', path('L-new'), entry({ at: '2019-01-01T00:00:00.000Z' })), 'before 2020');
  await denied(set('owner-a', path('L-new'), entry({ at: '2099-01-01T00:00:00.000Z' })), 'far future');
  await denied(set('owner-a', path('L-new'), entry({ detail: 'x'.repeat(201) })), 'detail too long');
  await denied(set('owner-a', path('L-new'), { ...entry(), extra: 'x' }), 'extra field');
  await denied(set('owner-a', path('bad id!'), entry()), 'bad id');
});

test('entries are never edited or deleted, even by the owner', async () => {
  await denied(set('owner-a', path('L-seed'), entry({ action: 'remove' })), 'edit');
  await denied(remove('owner-a', path('L-seed')), 'delete');
});

test('only the owner writes or reads the log', async () => {
  await denied(set('teacher-a', path('L-new'), entry({ actor: 'teacher-a' })), 'teacher writes');
  await denied(set('parent-1', path('L-new'), entry({ actor: 'parent-1' })), 'parent writes');
  await denied(set('owner-b', path('L-new'), entry({ actor: 'owner-b' })), 'owner of another school writes');
  await denied(set(null, path('L-new'), entry()), 'signed out writes');
  await allowed(get('owner-a', path('L-seed')), 'owner reads');
  await denied(get('teacher-a', path('L-seed')), 'teacher reads');
  await denied(get('parent-1', path('L-seed')), 'parent reads');
  await denied(get('owner-b', path('L-seed')), 'owner of another school reads');
  await denied(get(null, path('L-seed')), 'signed out reads');
  await allowed(query('owner-a', A, 'auditLog', [['action', 'save']]), 'owner lists');
  await denied(query('teacher-a', A, 'auditLog', [['action', 'save']]), 'teacher lists');
});

test('teachers can log only their own marks and attendance', async () => {
  await allowed(set('teacher-a', path('L-t1'), entry({ actor: 'teacher-a', action: 'marks', target: 'marks', docId: 'exam-1', detail: '12 marks' })), 'marks');
  await allowed(set('teacher-a', path('L-t2'), entry({ actor: 'teacher-a', action: 'attendance', target: 'attendance', docId: '2026-11-17_class-8' })), 'attendance');
  await denied(set('teacher-a', path('L-t3'), entry({ actor: 'teacher-a', action: 'save' })), 'owner action');
  await denied(set('teacher-a', path('L-t4'), entry({ actor: 'teacher-a', action: 'remove' })), 'remove action');
  await denied(set('teacher-a', path('L-t5'), entry({ actor: 'owner-a', action: 'marks' })), 'someone else as actor');
  await denied(set('teacher-off', path('L-t6'), entry({ actor: 'teacher-off', action: 'marks' })), 'inactive teacher');
  await denied(set('parent-1', path('L-t7'), entry({ actor: 'parent-1', action: 'marks' })), 'parent');
  await denied(set('teacher-a', path('L-seed'), entry({ actor: 'teacher-a', action: 'marks' })), 'overwrite an entry');
  await denied(remove('teacher-a', path('L-seed')), 'delete');
  await denied(get('teacher-a', path('L-seed')), 'teacher still cannot read the log');
});
