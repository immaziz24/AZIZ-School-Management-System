// Firestore rules tests for batch 78: domains, themes, feature access, storage and retention.
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
  if (value && typeof value === 'object' && !Array.isArray(value)) return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
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


// Several writes in one atomic commit. serverFields are set to the request time, like serverTimestamp() in the app.
const commit = async (who, writes) => {
  const name = (path) => `projects/${project}/databases/(default)/documents/${path}`;
  const response = await fetch(`${base.replace('/documents', '')}/documents:commit`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ writes: writes.map((w) => (w.delete
      ? { delete: name(w.path) }
      : { update: { name: name(w.path), fields: fields(w.data) },
          ...(w.serverFields?.length ? { updateTransforms: w.serverFields.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) } : {}),
          ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}) })) }),
  });
  await response.arrayBuffer();
  return response.status;
};
const W = (path, data, serverFields, mask) => ({ path, data, serverFields, mask });
const minutes = (n) => new Date(Date.now() + n * 60000);
const A = 'schools/green-valley';
const B = 'schools/second-demo-school';
const REASON = 'Support ticket 4411, checking the fee report';
const auditDoc = (id, action = 'open-school-standard', schoolId = 'green-valley') =>
  W(`platformAudit/${id}`, { actor: 'padmin', actorEmail: 'admin@example.com', action, schoolId, reason: REASON }, ['at']);
const grantDoc = (tier, mins, auditId, school = 'green-valley', reason = REASON) =>
  W(`platformGrants/padmin_${school}_${tier}`, { schoolId: school, tier, reason, createdBy: 'padmin', expiresAt: minutes(mins), auditId }, ['createdAt']);

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [A, { name: 'Green Valley' }], [B, { name: 'Second Demo School' }],
    [`${A}/members/owner-g`, { role: 'owner', active: true }],
    [`${A}/members/principal-g`, { role: 'principal', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/S1`, { name: 'Test Student', admissionNo: 'S1' }],
    [`${B}/students/S9`, { name: 'Other Student', admissionNo: 'S9' }],
    [`${A}/healthRecords/S1`, { note: 'synthetic' }],
    [`${A}/billing/main`, { status: 'active', storageMb: 500 }],
    ['platformAdmins/padmin', { active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});



const FEATURE = { label: 'Library', description: 'Books and lending', state: 'live', rollout: 100, plans: ['standard'], roles: ['owner', 'teacher'] };

test('feature catalogue: the super admin writes it, any signed-in user reads it', async () => {
  await allowed(set('padmin', 'featureCatalogue/library', FEATURE), 'create');
  await denied(set('padmin', 'featureCatalogue/library', { ...FEATURE, state: 'maybe' }), 'unknown state');
  await denied(set('padmin', 'featureCatalogue/library', { ...FEATURE, rollout: 101 }), 'rollout above 100');
  await denied(set('padmin', 'featureCatalogue/Bad_Key', FEATURE), 'bad key');
  await denied(set('owner-g', 'featureCatalogue/library', FEATURE), 'owner cannot write');
  await allowed(get('owner-g', 'featureCatalogue/library'), 'owner reads');
  await denied(get(null, 'featureCatalogue/library'), 'signed-out cannot read');
  await allowed(remove('padmin', 'featureCatalogue/library'), 'delete');
});

test('per-school overrides: the super admin sets them, members of that school read them', async () => {
  await allowed(set('padmin', `${A}/featureOverrides/library`, { mode: 'on' }), 'on');
  await denied(set('padmin', `${A}/featureOverrides/library`, { mode: 'maybe' }), 'unknown mode');
  await denied(set('padmin', `${A}/featureOverrides/library`, { mode: 'on', extra: 'x' }), 'extra field');
  await denied(set('owner-g', `${A}/featureOverrides/library`, { mode: 'off' }), 'owner cannot change it');
  await allowed(get('owner-g', `${A}/featureOverrides/library`), 'owner reads');
  await allowed(get('principal-g', `${A}/featureOverrides/library`), 'principal reads');
  await denied(get('owner-b', `${A}/featureOverrides/library`), 'another school');
  await denied(get('stranger', `${A}/featureOverrides/library`), 'stranger');
});

test('entitlements: computed by the super admin, read by the school', async () => {
  const ent = (extra = {}) => W(`${A}/entitlements/main`, { off: ['library'], beta: [], roles: { finance: ['owner'] }, ...extra }, ['at']);
  await allowed(commit('padmin', [ent()]), 'write');
  await denied(commit('padmin', [ent({ extra: 1 })]), 'extra field');
  await denied(commit('padmin', [ent({ roles: ['owner'] })]), 'roles must be a map');
  await denied(commit('owner-g', [ent()]), 'owner cannot write');
  await allowed(get('owner-g', `${A}/entitlements/main`), 'owner reads');
  await allowed(get('principal-g', `${A}/entitlements/main`), 'principal reads');
  await denied(get('owner-b', `${A}/entitlements/main`), 'another school');
});

test('theme history is written once by the super admin', async () => {
  const theme = (extra = {}) => W('themeHistory/T-ONE11', { themeKey: 'mk-abc123', label: 'Sunrise', navy: '#0b1f3a', ivory: '#f6efdc', gold: '#c9a24b', premium: false, version: 1, by: 'padmin', ...extra }, ['at']);
  await allowed(commit('padmin', [theme()]), 'create');
  await denied(commit('padmin', [theme({ navy: 'blue' })]), 'colour must be hex');
  await denied(commit('padmin', [theme()]), 'cannot be rewritten');
  await denied(commit('owner-g', [W('themeHistory/T-TWO22', { themeKey: 'mk-abc123', label: 'X', navy: '#000000', ivory: '#ffffff', gold: '#999999', premium: false, version: 1, by: 'owner-g' }, ['at'])]), 'owner cannot write');
  await denied(get('owner-g', 'themeHistory/T-ONE11'), 'owner cannot read');
  await allowed(get('padmin', 'themeHistory/T-ONE11'), 'admin reads');
});

test('publish control: only the super admin can take a school website offline', async () => {
  const profile = { name: 'Green Valley', contactEmail: '', phone: '', address: '' };
  await allowed(commit('padmin', [W(A, { ...profile, siteHold: true }, [], ['name', 'contactEmail', 'phone', 'address', 'siteHold'])]), 'offline');
  await denied(commit('padmin', [W(A, { siteHold: 'yes' }, [], ['siteHold'])]), 'must be true or false');
  await denied(commit('owner-g', [W(A, { siteHold: false }, [], ['siteHold'])]), 'owner cannot put it back online');
});

test('site hold: public can see whether a school website is held, only the super admin changes it', async () => {
  await allowed(set('padmin', 'siteHolds/green-valley', { held: true }), 'hold');
  await denied(set('padmin', 'siteHolds/green-valley', { held: false }), 'held must be true');
  await denied(set('owner-g', 'siteHolds/green-valley', { held: true }), 'owner cannot');
  await allowed(get(null, 'siteHolds/green-valley'), 'public check');
  await allowed(remove('padmin', 'siteHolds/green-valley'), 'release');
  await denied(remove('owner-g', 'siteHolds/green-valley'), 'owner cannot release');
});

test('subdomains: assigned by the super admin on the platform address only', async () => {
  const sub = (extra = {}) => W(`${A}/domainRequests/SD-ONE11`, { domain: 'green-valley.azizschoolmanagement.plateria.in', status: 'verified', createdOn: '2026-11-24', ssl: 'pending', dnsTarget: 'Wildcard record', note: 'subdomain', ...extra });
  await allowed(commit('padmin', [sub(), W('domainMap/green-valley.azizschoolmanagement.plateria.in', { schoolId: 'green-valley', verifiedOn: '2026-11-24' })]), 'assign');
  await denied(commit('padmin', [W(`${A}/domainRequests/SD-TWO22`, { domain: 'someone-else.example.com', status: 'verified', createdOn: '2026-11-24' })]), 'another domain');
  await denied(commit('padmin', [W(`${A}/domainRequests/SD-THR33`, { domain: 'green-valley.azizschoolmanagement.plateria.in', status: 'requested', createdOn: '2026-11-24' })]), 'must already be verified');
  await denied(commit('owner-g', [W(`${A}/domainRequests/SD-OWN44`, { domain: 'green-valley.azizschoolmanagement.plateria.in', status: 'verified', createdOn: '2026-11-24' })]), 'owner cannot assign');
  await allowed(commit('padmin', [W(`${A}/domainRequests/SD-ONE11`, { ssl: 'active', checkedOn: '2026-11-25' }, [], ['ssl', 'checkedOn'])]), 'SSL check recorded');
});

test('retention policy: readable by signed-in users, written by the super admin', async () => {
  const policy = { selfieDays: 365, visitorDays: 365, messageDays: 730, archivedSchoolDays: 365 };
  await allowed(set('padmin', 'platformConfig/retention', policy), 'set');
  await denied(set('padmin', 'platformConfig/retention', { ...policy, selfieDays: 0 }), 'zero days');
  await denied(set('padmin', 'platformConfig/retention', { ...policy, archivedSchoolDays: 10 }), 'archived under 30 days');
  await denied(set('owner-g', 'platformConfig/retention', policy), 'owner cannot write');
  await allowed(get('owner-g', 'platformConfig/retention'), 'owner reads');
});

test('measured storage is saved on the billing record', async () => {
  const billing = (extra) => W(`${A}/billing/main`, { plan: 'standard', status: 'active', storageMb: 500, ...extra });
  await allowed(commit('padmin', [billing({ storageCheckedMb: 120, storageCheckedOn: '2026-11-24' })]), 'measured');
  await denied(commit('padmin', [billing({ storageCheckedMb: -1 })]), 'negative');
  await denied(commit('padmin', [billing({ storageCheckedOn: 'today' })]), 'not a date');
});
