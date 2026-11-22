// Firestore rules tests for batch 65: online test progress (one question at a time, pause and resume, time left).
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
const B = 'schools/second-demo-school';

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

const doc = (extra = {}) => ({ staffId: 'ST-1', staffName: 'Meera Sen', kind: 'contract', title: 'Employment contract', fileName: 'contract.pdf',
  contentType: 'application/pdf', sizeKb: 240, uploadedOn: '2026-11-22', by: 'owner-a', ...extra });
const P = (id = 'SD-20261122-AAAAA') => `${A}/staffDocuments/${id}`;

test('staff vault: only the owner adds, with valid details', async () => {
  await allowed(set('owner-a', P(), doc()), 'owner adds');
  await allowed(set('owner-a', P('SD-2'), doc({ expiryOn: '2027-03-31', note: 'Renew in March' })), 'with expiry and note');
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, P('SD-3'), doc()), 'add by ' + who);
  await denied(set('owner-a', P('bad id'), doc()), 'bad id');
  await denied(set('owner-a', P('SD-4'), doc({ kind: 'secret' })), 'unknown type');
  await denied(set('owner-a', P('SD-4'), doc({ contentType: 'text/html' })), 'wrong file type');
  await denied(set('owner-a', P('SD-4'), doc({ sizeKb: 5121 })), 'over 5 MB');
  await denied(set('owner-a', P('SD-4'), doc({ sizeKb: 0 })), 'empty');
  await denied(set('owner-a', P('SD-4'), doc({ title: '' })), 'no title');
  await denied(set('owner-a', P('SD-4'), doc({ expiryOn: 'tomorrow' })), 'bad date');
  await denied(set('owner-a', P('SD-4'), doc({ extra: 'x' })), 'unknown field');
});

test('staff vault: owner and principal read, others do not', async () => {
  await allowed(set('owner-a', P(), doc()), 'add');
  await allowed(get('owner-a', P()), 'owner reads');
  await allowed(get('prin', P()), 'principal reads');
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, P()), 'read by ' + who);
});

test('staff vault: owner changes only type, title, expiry, note, and deletes', async () => {
  await allowed(set('owner-a', P(), doc()), 'add');
  await allowed(set('owner-a', P(), doc({ expiryOn: '2028-01-01', title: 'Contract 2028' })), 'edit expiry and title');
  await denied(set('owner-a', P(), doc({ sizeKb: 10 })), 'size is fixed');
  await denied(set('owner-a', P(), doc({ fileName: 'other.pdf' })), 'file name is fixed');
  await denied(set('prin', P(), doc({ title: 'x' })), 'principal cannot edit');
  await denied(remove('prin', P()), 'principal cannot delete');
  await allowed(remove('owner-a', P()), 'owner deletes');
});

test('staff vault: new uploads are refused when the plan storage is full', async () => {
  await allowed(set(ADMIN, `${A}/billing/main`, { status: 'active', storageMb: 10 }), 'plan');
  await allowed(set(ADMIN, `${A}/usage/main`, { storageMb: 9 }), 'usage below');
  await allowed(set('owner-a', P(), doc()), 'room left');
  await allowed(set(ADMIN, `${A}/usage/main`, { storageMb: 10 }), 'usage full');
  await denied(set('owner-a', P('SD-9'), doc()), 'full');
  await allowed(set('owner-a', P(), doc({ title: 'Renamed' })), 'editing still works when full');
  await allowed(remove('owner-a', P()), 'deleting still works when full');
});
