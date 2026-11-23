// Firestore rules tests for batch 72: theme marketplace.
// Synthetic records only.
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
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  throw new Error('Unsupported value');
};
const fields = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => [key, encode(value)]));
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

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    ['platformAdmins/padmin', { active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('theme marketplace: only the platform administrator publishes, at most twelve; anyone may read', async () => {
  await allowed(set('padmin', 'platformConfig/marketplace', { items: ['a', 'b'] }), 'admin publishes');
  await denied(set('owner-a', 'platformConfig/marketplace', { items: [] }), 'owner cannot publish');
  await denied(set(null, 'platformConfig/marketplace', { items: [] }), 'anonymous cannot publish');
  await denied(set('padmin', 'platformConfig/marketplace', { items: Array.from({ length: 13 }, (_, i) => 'x' + i) }), 'more than twelve');
  await denied(set('padmin', 'platformConfig/marketplace', { items: [], extra: 'x' }), 'unknown field');
  for (const who of ['owner-a', 'padmin', null]) await allowed(get(who, 'platformConfig/marketplace'), 'read by ' + who);
});

test('theme marketplace: an owner may choose a marketplace theme for the school page, but not an invented one', async () => {
  await allowed(set('owner-a', `${A}/site/extras`, { theme: 'mk-abc123' }), 'marketplace theme');
  await allowed(set('owner-a', `${A}/site/extras`, { theme: 'classic' }), 'fixed theme');
  await denied(set('owner-a', `${A}/site/extras`, { theme: 'mk-ab' }), 'key too short');
  await denied(set('owner-a', `${A}/site/extras`, { theme: 'MK-abc123' }), 'wrong case');
  await denied(set('owner-a', `${A}/site/extras`, { theme: '<script>' }), 'not a theme');
});
