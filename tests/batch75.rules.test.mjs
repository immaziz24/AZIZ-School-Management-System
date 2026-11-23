// Firestore rules tests for batch 75: super administrator can read every school but change nothing.
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

const A = 'schools/green-valley';

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [A, { name: 'Green Valley' }],
    [`${A}/members/owner-g`, { role: 'owner', active: true }],
    [`${A}/members/principal-g`, { role: 'principal', active: true }],
    [`${A}/students/S1`, { name: 'Test Student', admissionNo: 'S1' }],
    [`${A}/billing/main`, { status: 'active', storageMb: 500 }],
    ['platformAdmins/padmin', { active: true }],
    // Batch 76: ordinary records need a live access pass, so the seed holds one.
    ['platformGrants/padmin_green-valley_standard', { schoolId: 'green-valley', tier: 'standard', expiresAt: new Date(Date.now() + 3600000) }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('super admin reads a school it is not a member of', async () => {
  await allowed(get('padmin', `${A}/students/S1`), 'student record');
  await allowed(get('padmin', A), 'school record');
  await allowed(get('padmin', `${A}/members/owner-g`), 'member record');
});

test('super admin cannot change a school it is not a member of', async () => {
  await denied(set('padmin', `${A}/students/S2`, { name: 'X', admissionNo: 'S2' }), 'cannot add a student');
  await denied(set('padmin', `${A}/students/S1`, { name: 'Changed', admissionNo: 'S1' }), 'cannot edit a student');
  await denied(remove('padmin', `${A}/students/S1`), 'cannot delete a student');
  await denied(set('padmin', `${A}/settings/qrCode`, { code: 'ABCDEFGH', at: new Date() }), 'cannot post the school QR code');
});

test('someone with no place in the school still cannot read it', async () => {
  await denied(get('stranger', `${A}/students/S1`), 'stranger reads students');
  await denied(get('stranger', `${A}/members/owner-g`), 'stranger reads members');
});

test('owner and principal keep their access', async () => {
  await allowed(get('owner-g', `${A}/students/S1`), 'owner reads');
  await allowed(get('principal-g', `${A}/students/S1`), 'principal reads');
  await denied(set('principal-g', `${A}/students/S3`, { name: 'X', admissionNo: 'S3' }), 'principal still cannot write students');
});
