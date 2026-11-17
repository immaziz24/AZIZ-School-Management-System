// Firestore rules tests for office.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/office.rules.test.mjs"
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

const note = (over = {}) => ({ studentId: 's1', date: TODAY, kind: 'concern', note: 'Late to class three times.', recordedBy: 'owner-a', ...over });
const visit = (over = {}) => ({ name: 'Mr Sen', purpose: 'Meet the principal', whom: 'Principal', phone: '+91 98765 43210', date: TODAY, timeIn: '10:15', recordedBy: 'owner-a', ...over });
const npath = (id = 'BH-1', school = A) => `${school}/behaviour/${id}`;
const vpath = (id = 'V-1', school = A) => `${school}/visitors/${id}`;

beforeEach(async () => {
  await reset();
  await seedAll([[npath(), note()], [vpath(), visit()], [npath('BH-1', B), note()]]);
});

test('owner records and removes behaviour notes', async () => {
  await allowed(set('owner-a', npath('BH-2'), note({ kind: 'positive', note: 'Helped a classmate.' })), 'positive');
  await allowed(set('owner-a', npath('BH-3'), note()), 'concern');
  await allowed(remove('owner-a', npath('BH-2')), 'remove');
  await denied(set('owner-a', npath('BH-4'), note({ studentId: 'zz' })), 'unknown student');
  await denied(set('owner-a', npath('BH-4'), note({ kind: 'other' })), 'unknown kind');
  await denied(set('owner-a', npath('BH-4'), note({ note: '  ' })), 'blank note');
  await denied(set('owner-a', npath('BH-4'), note({ note: 'x'.repeat(501) })), 'note too long');
  await denied(set('owner-a', npath('BH-4'), note({ date: day(2) })), 'future date');
  await denied(set('owner-a', npath('BH-4'), note({ recordedBy: 'teacher-a' })), 'recordedBy is someone else');
  await denied(set('owner-a', npath('BH-1'), note({ note: 'Changed' })), 'edit');
  await denied(set('owner-a', npath('BH-4'), { ...note(), extra: 1 }), 'extra field');
});

test('behaviour notes are private to the owner', async () => {
  for (const who of ['teacher-a', 'parent-1', 'owner-b', null]) {
    await denied(get(who, npath()), 'read ' + who);
    await denied(set(who, npath('BH-9'), note({ recordedBy: who ?? 'x' })), 'write ' + who);
    await denied(remove(who, npath()), 'remove ' + who);
  }
  await allowed(get('owner-a', npath()), 'owner reads');
});

test('owner signs visitors in and out', async () => {
  await allowed(set('owner-a', vpath('V-2'), { name: 'Mr Sen', purpose: 'Delivery', date: TODAY, timeIn: '10:15', recordedBy: 'owner-a' }), 'minimal entry');
  await allowed(set('owner-a', vpath('V-3'), visit()), 'full entry');
  await allowed(set('owner-a', vpath('V-1'), visit({ timeOut: '11:00' })), 'sign out');
  await denied(set('owner-a', vpath('V-1'), visit({ timeOut: '12:00' })), 'sign out twice');
  await denied(remove('owner-a', vpath()), 'delete');
});

test('malformed visitor entries are rejected', async () => {
  await denied(set('owner-a', vpath('V-4'), visit({ name: ' ' })), 'blank name');
  await denied(set('owner-a', vpath('V-4'), visit({ purpose: '' })), 'blank purpose');
  await denied(set('owner-a', vpath('V-4'), visit({ phone: 'call me' })), 'bad phone');
  await denied(set('owner-a', vpath('V-4'), visit({ timeIn: '25:00' })), 'bad time');
  await denied(set('owner-a', vpath('V-4'), visit({ date: day(2) })), 'future date');
  await denied(set('owner-a', vpath('V-4'), visit({ recordedBy: 'teacher-a' })), 'recordedBy is someone else');
  await denied(set('owner-a', vpath('V-4'), visit({ timeOut: '11:00' })), 'already signed out on creation');
  await denied(set('owner-a', vpath('V-1'), visit({ timeOut: '09:00' })), 'leaves before arriving');
  await denied(set('owner-a', vpath('V-1'), visit({ name: 'Someone else', timeOut: '11:00' })), 'changes the name too');
  await denied(set('owner-a', vpath('V-4'), { ...visit(), extra: 1 }), 'extra field');
});

test('the visitor log is private to the owner', async () => {
  for (const who of ['teacher-a', 'parent-1', 'owner-b', null]) {
    await denied(get(who, vpath()), 'read ' + who);
    await denied(set(who, vpath('V-9'), visit({ recordedBy: who ?? 'x' })), 'write ' + who);
  }
  await allowed(get('owner-a', vpath()), 'owner reads');
});
