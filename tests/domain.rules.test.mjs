// Firestore rules tests for custom domains (067): the domainMap lookup.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/domain.rules.test.mjs"
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
const TODAY = new Date().toISOString().slice(0, 10);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const MAP = (host) => `domainMap/${host}`;
const link = (over = {}) => ({ schoolId: 'abcd-school', verifiedOn: TODAY, ...over });

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    ['platformAdmins/padmin', { createdOn: TODAY }],
    [`${A}`, { name: 'ABCD School', contactEmail: 'a@b.in', phone: '98300 00000', address: 'Town' }],
    [`${B}`, { name: 'Second School', contactEmail: 'b@b.in', phone: '98300 00001', address: 'City' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [MAP('school.example.com'), link()],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('domain lookup: anyone can look up one address, nobody can list them', async () => {
  for (const who of [null, 'owner-a', 'owner-b', 'prin', 'padmin']) await allowed(get(who, MAP('school.example.com')), 'lookup by ' + who);
  for (const who of [null, 'owner-a', 'prin', 'padmin']) {
    const response = await fetch(`${base}/domainMap`, { headers: headers(who) });
    await response.arrayBuffer();
    assert.equal(response.status, 403, 'list by ' + who);
  }
});

test('domain lookup: only the platform administrator links, changes or unlinks an address', async () => {
  await allowed(set('padmin', MAP('www.example.org'), link({ schoolId: 'second-demo-school' })), 'admin links a new address');
  await allowed(set('padmin', MAP('school.example.com'), link({ verifiedOn: day(1) })), 'admin refreshes the same school');
  await allowed(remove('padmin', MAP('school.example.com')), 'admin unlinks');
  for (const who of ['owner-a', 'owner-b', 'prin', 'parent-1', null]) {
    await denied(set(who, MAP('new.example.net'), link()), 'link by ' + who);
    await denied(set(who, MAP('school.example.com'), link({ verifiedOn: day(1) })), 'change by ' + who);
    await denied(remove(who, MAP('school.example.com')), 'unlink by ' + who);
  }
});

test('domain lookup: an address cannot be taken over by another school, and the data is checked', async () => {
  await denied(set('padmin', MAP('school.example.com'), link({ schoolId: 'second-demo-school' })), 'move an address to another school');
  await denied(set('padmin', MAP('ghost.example.com'), link({ schoolId: 'no-such-school' })), 'school that does not exist');
  await denied(set('padmin', MAP('new.example.com'), { schoolId: 'abcd-school' }), 'date missing');
  await denied(set('padmin', MAP('new.example.com'), link({ verifiedOn: 'yesterday' })), 'date not a date');
  await denied(set('padmin', MAP('new.example.com'), { ...link(), extra: 'x' }), 'extra field');
  await denied(set('padmin', MAP('new.example.com'), link({ schoolId: 'Bad ID' })), 'bad school id');
  await denied(set('padmin', MAP('localhost'), link()), 'not a real address');
  await denied(set('padmin', MAP('UPPER.example.com'), link()), 'capital letters');
});

test('domain requests: the school owner asks, only the platform administrator moves them along', async () => {
  const req = (over = {}) => ({ domain: 'school.example.com', status: 'requested', createdOn: TODAY, ...over });
  await allowed(set('owner-a', `${A}/domainRequests/DM-1`, req()), 'owner asks');
  await denied(set('owner-a', `${A}/domainRequests/DM-2`, req({ status: 'verified' })), 'owner cannot self-verify');
  await denied(set('owner-a', `${A}/domainRequests/DM-3`, req({ ssl: 'active' })), 'owner cannot set the certificate');
  await allowed(set('padmin', `${A}/domainRequests/DM-1`, req({ status: 'dns-pending', dnsTarget: 'CNAME to azizschoolmanagement.plateria.in', ssl: 'pending', checkedOn: TODAY })), 'admin sets DNS target');
  await allowed(set('padmin', `${A}/domainRequests/DM-1`, req({ status: 'verified', ssl: 'active', checkedOn: TODAY })), 'admin verifies');
  await denied(set('owner-a', `${A}/domainRequests/DM-1`, req({ status: 'verified', ssl: 'active' })), 'owner cannot change it afterwards');
});
