// Firestore rules tests for transport fees and website fields. Synthetic records only.
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

const route = (over = {}) => ({ name: 'Route 1', vehicle: 'WB-01', monthlyFee: 800, ...over });
const site = (over = {}) => ({ name: 'Test School', seoTitle: 'Test School - Admissions', seoDesc: 'A school.', gallery: 'https://example.com/a.jpg | Annual day', ...over });

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  for (const [p, data] of [[`${A}/members/owner-a`, { role: 'owner', active: true }], [`${A}/members/prin`, { role: 'principal', active: true }]]) {
    assert.equal(await set(ADMIN, p, data), 200, p);
  }
});

test('transport: a route may carry a whole-rupee monthly fee', async () => {
  await allowed(set('owner-a', `${A}/routes/RT-1`, route()), 'with fee');
  await allowed(set('owner-a', `${A}/routes/RT-2`, { name: 'Route 2' }), 'without fee');
  await denied(set('owner-a', `${A}/routes/RT-3`, route({ monthlyFee: -1 })), 'negative');
  await denied(set('owner-a', `${A}/routes/RT-4`, route({ monthlyFee: 100001 })), 'too large');
  await denied(set('owner-a', `${A}/routes/RT-5`, route({ monthlyFee: '800' })), 'text not number');
  await denied(set('prin', `${A}/routes/RT-6`, route()), 'principal cannot edit');
});

test('website: search title, description and gallery are owner-only and size limited', async () => {
  await allowed(set('owner-a', `${A}/site/main`, site()), 'owner saves');
  await allowed(get(null, `${A}/site/main`), 'public reads');
  await denied(set('owner-a', `${A}/site/main`, site({ seoTitle: 'x'.repeat(71) })), 'long title');
  await denied(set('owner-a', `${A}/site/main`, site({ seoDesc: 'x'.repeat(161) })), 'long description');
  await denied(set('owner-a', `${A}/site/main`, site({ gallery: 'x'.repeat(1501) })), 'long gallery');
  await denied(set('owner-a', `${A}/site/main`, site({ extra: 'no' })), 'unknown field');
  await denied(set('prin', `${A}/site/main`, site()), 'principal cannot edit');
  await denied(set(null, `${A}/site/main`, site()), 'anonymous cannot edit');
});
