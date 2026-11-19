// Firestore rules tests for the fuller staff profile (feature 030). Synthetic records only.
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
const path = (id) => `${A}/staffDirectory/${id}`;
const FULL = {
  name: 'Ravi Das', role: 'Maths teacher', phone: '98300 12345', employeeId: 'E-104', department: 'Senior school',
  subjects: 'Maths, Physics', employmentType: 'permanent', dateOfBirth: '1988-04-12', gender: 'male', bloodGroup: 'O+', leftOn: '2026-03-31',
};
const BAD = [
  { ...FULL, employmentType: 'slave' }, { ...FULL, gender: 'x' }, { ...FULL, bloodGroup: 'Z+' },
  { ...FULL, dateOfBirth: 'long ago' }, { ...FULL, leftOn: 'soon' }, { ...FULL, employeeId: 'E'.repeat(21) },
  { ...FULL, department: 'D'.repeat(41) }, { ...FULL, subjects: 'S'.repeat(101) }, { ...FULL, salary: 1 },
];
beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('staff profile: owner saves the full profile and a plain one; principal reads', async () => {
  await allowed(set('owner-a', path('SD-1'), FULL), 'full');
  await allowed(set('owner-a', path('SD-2'), { name: 'Mina', role: 'Clerk' }), 'plain');
  await allowed(get('prin', path('SD-1')), 'principal reads');
});
test('staff profile: bad values are refused', async () => {
  for (const bad of BAD) await denied(set('owner-a', path('SD-3'), bad), JSON.stringify(bad).slice(0, 70));
});
test('staff profile: nobody else writes or reads', async () => {
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, path('SD-4'), FULL), 'write by ' + who);
  await set(ADMIN, path('SD-1'), FULL);
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, path('SD-1')), 'read by ' + who);
});
