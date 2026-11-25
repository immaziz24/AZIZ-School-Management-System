// Firestore rules tests for Batch 98 (Registration Mark 1): onboarding drafts and the registration record. Synthetic records only.
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
    email: uid + '@example.com', email_verified: true,
    firebase: { sign_in_provider: 'password', identities: {} },
  }) + '.';
};
const ADMIN = 'owner'; // Emulator-only token that bypasses rules, used for seeding.

const encode = (value) => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value && typeof value === 'object' && value.ts) return { timestampValue: value.ts };
  if (value && typeof value === 'object' && !Array.isArray(value)) return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, x]) => [k, encode(x)])) } };
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
  const where = filters.length === 0 ? undefined : filters.length === 1 ? fieldFilter(filters[0])
    : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
  const response = await fetch(`${base}${parent ? '/' + parent : ''}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}) } }),
  });
  await response.arrayBuffer();
  return response.status;
};

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const TODAY = iso(0).slice(0, 10);
const docName = (path) => `projects/${project}/databases/(default)/documents/${path}`;
// A batched write, so that getAfter rules see the whole batch. times lists fields set to the server time.
const commit = async (who, writes) => {
  const body = { writes: writes.map((w) => ({
    update: { name: docName(w.path), fields: fields(w.data) },
    ...(w.times ? { updateTransforms: w.times.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
    ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
  })) };
  const response = await fetch(`${base}:commit`, { method: 'POST', headers: headers(who), body: JSON.stringify(body) });
  await response.arrayBuffer();
  return response.status;
};


const profile = { name: 'New School', contactEmail: 'n@s.in', phone: '98300 00000', address: 'Town' };

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    ['platformAdmins/padmin', { createdBy: 'seed' }],
    [A, { ...profile, name: 'ABCD School' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/par`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [P('billing', 'main'), { plan: 'standard', status: 'active', monthlyPrice: 500 }],
    [P('registration', 'main'), { name: 'ABCD School', ownerEmail: 'o@a.in', schemaVersion: 1 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

// Drafts, registration records and ID reservations are written and read by server functions only. No browser, not even a platform administrator, may touch them.
const SERVER_ONLY = ['onboardingDrafts/OB-TEST0001', 'schoolReservations/green-valley', P('registration', 'main')];

test('no browser can read or write onboarding drafts, reservations or registration records', async () => {
  for (const path of SERVER_ONLY) {
    for (const who of ['padmin', 'owner-a', 't1', 'par', 'owner-b', null]) {
      await denied(get(who, path), (who || 'signed out') + ' read ' + path);
      await denied(set(who, path, { status: 'draft', name: 'x' }), (who || 'signed out') + ' write ' + path);
    }
  }
});

test('an unfinished draft cannot be deleted from a browser', async () => {
  await set(ADMIN, 'onboardingDrafts/OB-TEST0001', { status: 'draft', revision: 1 });
  await denied(remove('padmin', 'onboardingDrafts/OB-TEST0001'), 'admin delete');
  await denied(remove('owner-a', 'onboardingDrafts/OB-TEST0001'), 'owner delete');
});

test('a school owner can still edit the four profile fields of a school registered through the wizard', async () => {
  await allowed(set(ADMIN, A, { ...profile, name: 'ABCD School', schemaVersion: 2, registeredVia: 'onboarding', createdBy: 'padmin' }), 'seed new-style school');
  const status = await commit('owner-a', [{ path: A, data: { name: 'ABCD School Renamed', contactEmail: 'n@s.in', phone: '1', address: 'x' }, mask: ['name', 'contactEmail', 'phone', 'address'] }]);
  assert.equal(status, 200);
});

test('an owner still cannot change the registration flags on the school record', async () => {
  await allowed(set(ADMIN, A, { ...profile, name: 'ABCD School', schemaVersion: 2, registeredVia: 'onboarding', createdBy: 'padmin' }), 'seed');
  assert.equal(await commit('owner-a', [{ path: A, data: { schemaVersion: 9 }, mask: ['schemaVersion'] }]), 403);
});
