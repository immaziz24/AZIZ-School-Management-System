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

const DRAFT = 'onboardingDrafts/OB-TEST0001';
const draftData = (extra = {}) => ({ schemaVersion: 1, createdBy: 'padmin', revision: 1, status: 'draft', step: 0, values: { name: 'Green Valley School', town: 'Kolkata' }, ...extra });
const createDraft = (who, data = draftData(), path = DRAFT) => commit(who, [{ path, data, times: ['createdAt', 'updatedAt'] }]);
const saveDraft = (who, data, path = DRAFT) => commit(who, [{ path, data, mask: Object.keys(data), times: ['updatedAt'] }]);

test('a platform administrator creates a draft', async () => {
  await allowed(createDraft('padmin'), 'create');
  await allowed(get('padmin', DRAFT), 'read back');
});

test('nobody else can create or read a draft', async () => {
  for (const who of ['owner-a', 't1', 'par', 'owner-b']) await denied(createDraft(who), who + ' create');
  await createDraft('padmin');
  for (const who of ['owner-a', 't1', 'par', 'owner-b']) await denied(get(who, DRAFT), who + ' read');
  await denied(get(null, DRAFT), 'signed out read');
});

test('a draft must start at revision 1, as draft, without a school ID, and be written by its creator', async () => {
  await denied(createDraft('padmin', draftData({ revision: 2 })), 'revision 2');
  await denied(createDraft('padmin', draftData({ status: 'registered' })), 'registered');
  await denied(createDraft('padmin', draftData({ schoolId: 'green-valley' })), 'school id');
  await denied(createDraft('padmin', draftData({ createdBy: 'someone-else' })), 'other creator');
  await denied(createDraft('padmin', draftData(), 'onboardingDrafts/bad id'), 'bad id');
});

test('a draft rejects unknown keys and unknown field names', async () => {
  await denied(createDraft('padmin', draftData({ secret: 'x' })), 'unknown top key');
  await denied(createDraft('padmin', draftData({ values: { name: 'X', password: 'y' } })), 'unknown value key');
  await denied(createDraft('padmin', draftData({ step: 20 })), 'step too high');
});

test('each save raises the revision by one; a stale or repeated revision is refused', async () => {
  await createDraft('padmin');
  await allowed(saveDraft('padmin', { values: { name: 'Green Valley School', town: 'Howrah' }, step: 1, revision: 2 }), 'revision 2');
  await denied(saveDraft('padmin', { values: { name: 'Other' }, step: 1, revision: 2 }), 'same revision again (another tab)');
  await denied(saveDraft('padmin', { values: { name: 'Other' }, step: 1, revision: 5 }), 'skipped revision');
  await allowed(saveDraft('padmin', { values: { name: 'Other' }, step: 2, revision: 3 }), 'revision 3');
});

test('the browser cannot set the school ID or mark a draft registered', async () => {
  await createDraft('padmin');
  await denied(saveDraft('padmin', { values: { name: 'X' }, step: 0, revision: 2, schoolId: 'sneaky' }), 'school id');
  await denied(saveDraft('padmin', { values: { name: 'X' }, step: 0, revision: 2, status: 'registered' }), 'registered');
});

test('a registered draft is closed to the browser', async () => {
  await set(ADMIN, DRAFT, { ...draftData({ status: 'registered', schoolId: 'green-valley' }), createdAt: { ts: '2026-01-01T00:00:00Z' }, updatedAt: { ts: '2026-01-01T00:00:00Z' } });
  await denied(saveDraft('padmin', { values: { name: 'X' }, step: 0, revision: 2 }), 'edit registered');
  await denied(remove('padmin', DRAFT), 'delete registered');
});

test('an open draft can be deleted by a platform administrator only', async () => {
  await createDraft('padmin');
  await denied(remove('owner-a', DRAFT), 'owner delete');
  await allowed(remove('padmin', DRAFT), 'admin delete');
});

test('the registration record is readable by a platform administrator only and never writable', async () => {
  await allowed(get('padmin', P('registration', 'main')), 'admin read');
  for (const who of ['owner-a', 't1', 'par']) await denied(get(who, P('registration', 'main')), who + ' read');
  await denied(get('owner-b', P('registration', 'main')), 'other school owner read');
  await denied(set('padmin', P('registration', 'main'), { name: 'x' }), 'admin write');
  await denied(set('owner-a', P('registration', 'main'), { name: 'x' }), 'owner write');
});

test('reservations are not readable or writable from a browser', async () => {
  await set(ADMIN, 'schoolReservations/green-valley', { draftId: 'OB-TEST0001', status: 'reserved' });
  await denied(get('padmin', 'schoolReservations/green-valley'), 'admin read');
  await denied(set('padmin', 'schoolReservations/other', { status: 'reserved' }), 'admin write');
});

test('a school owner can still edit the four profile fields after registration (existing behaviour)', async () => {
  await allowed(set(ADMIN, A, { ...profile, name: 'ABCD School', schemaVersion: 2, registeredVia: 'onboarding', createdBy: 'padmin' }), 'seed new-style school');
  const status = await commit('owner-a', [{ path: A, data: { name: 'ABCD School Renamed', contactEmail: 'n@s.in', phone: '1', address: 'x' }, mask: ['name', 'contactEmail', 'phone', 'address'] }]);
  assert.equal(status, 200);
});
