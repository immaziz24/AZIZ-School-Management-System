// Firestore rules tests for batch 76: access passes, audit log, sensitive lock, owner invitations, school registration, plans and login history.
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

test('without an access pass the super admin sees the school list but no school records', async () => {
  await allowed(get('padmin', A), 'school record');
  await allowed(get('padmin', `${A}/billing/main`), 'billing');
  await denied(get('padmin', `${A}/students/S1`), 'students need a pass');
  await denied(get('padmin', `${A}/healthRecords/S1`), 'health needs a sensitive pass');
});

test('an access pass needs its audit entry, a reason and a short life', async () => {
  await denied(commit('padmin', [grantDoc('standard', 50, 'A-NOAUDIT1')]), 'pass without audit entry');
  await denied(commit('padmin', [auditDoc('A-ONE1'), grantDoc('standard', 50, 'A-ONE1', 'green-valley', 'short')]), 'reason too short');
  await denied(commit('padmin', [auditDoc('A-ONE1'), grantDoc('standard', 120, 'A-ONE1')]), 'two hours is too long');
  await allowed(commit('padmin', [auditDoc('A-ONE1'), grantDoc('standard', 50, 'A-ONE1')]), 'valid standard pass');
  await denied(commit('owner-g', [auditDoc('A-TWO2'), grantDoc('standard', 50, 'A-TWO2')]), 'only the super admin');
});

test('a standard pass opens ordinary records of that school only, never sensitive ones', async () => {
  await allowed(commit('padmin', [auditDoc('A-ONE1'), grantDoc('standard', 50, 'A-ONE1')]), 'pass');
  await allowed(get('padmin', `${A}/students/S1`), 'ordinary record');
  await denied(get('padmin', `${A}/healthRecords/S1`), 'sensitive record');
  await denied(get('padmin', `${B}/students/S9`), 'another school');
  await denied(set('padmin', `${A}/students/S2`, { name: 'X', admissionNo: 'S2' }), 'cannot write');
});

test('a sensitive pass is short and opens sensitive records of that school only', async () => {
  await denied(commit('padmin', [auditDoc('A-ONE1', 'open-school-sensitive'), grantDoc('sensitive', 30, 'A-ONE1')]), '30 minutes is too long');
  await allowed(commit('padmin', [auditDoc('A-ONE1', 'open-school-sensitive'), grantDoc('sensitive', 12, 'A-ONE1')]), 'valid sensitive pass');
  await allowed(get('padmin', `${A}/healthRecords/S1`), 'sensitive record');
  await denied(get('padmin', `${B}/students/S9`), 'another school');
});

test('an expired pass opens nothing', async () => {
  assert.equal(await set(ADMIN, 'platformGrants/padmin_green-valley_standard', {
    schoolId: 'green-valley', tier: 'standard', reason: REASON, createdBy: 'padmin', expiresAt: minutes(-5), auditId: 'A-OLD1' }), 200);
  await denied(get('padmin', `${A}/students/S1`), 'expired pass');
});

test('MFA switch: sensitive passes are refused without a second factor once it is on', async () => {
  assert.equal(await set(ADMIN, 'platformConfig/security', { requireMfa: true }), 200);
  await denied(commit('padmin', [auditDoc('A-ONE1', 'open-school-sensitive'), grantDoc('sensitive', 12, 'A-ONE1')]), 'no second factor');
  await allowed(commit('padmin', [auditDoc('A-TWO2'), grantDoc('standard', 50, 'A-TWO2')]), 'standard pass does not need it');
});

test('the audit log can be added to but never changed or deleted', async () => {
  await allowed(commit('padmin', [auditDoc('A-ONE1', 'edit-school')]), 'create');
  await denied(commit('padmin', [W('platformAudit/A-ONE1', { actor: 'padmin', action: 'tampered' }, ['at'])]), 'update');
  await denied(commit('padmin', [{ path: 'platformAudit/A-ONE1', delete: true }]), 'delete');
  await denied(commit('padmin', [W('platformAudit/A-FAKE1', { actor: 'someone-else', action: 'edit-school' }, ['at'])]), 'wrong actor');
  await denied(commit('owner-g', [auditDoc('A-OWN1')]), 'owner cannot write');
  await denied(get('owner-g', 'platformAudit/A-ONE1'), 'owner cannot read');
  await allowed(get('padmin', 'platformAudit/A-ONE1'), 'admin reads');
});

test('registering a school creates the school, billing, owner invitation and audit entry together', async () => {
  const school = W('schools/new-school', { name: 'New School', contactEmail: '', phone: '', address: '', createdBy: 'padmin' });
  const billing = W('schools/new-school/billing/main', { plan: 'trial', status: 'trial', trialEnds: minutes(30 * 1440), studentLimit: 50, staffLimit: 10 });
  const invite = W('invites/OW-NEW1', { schoolId: 'new-school', email: 'owner@example.com', role: 'owner', status: 'pending', createdBy: 'padmin' });
  await allowed(commit('padmin', [school, billing, invite, auditDoc('A-REG1', 'register-school', 'new-school')]), 'register');
  await denied(commit('padmin', [W('schools/admin', { name: 'X', contactEmail: '', phone: '', address: '', createdBy: 'padmin' })]), 'reserved name');
  await denied(commit('padmin', [W('invites/OW-LONE', { schoolId: 'ghost-school', email: 'x@example.com', role: 'owner', status: 'pending', createdBy: 'padmin' })]), 'invite for a school that does not exist');
  await allowed(get('padmin', 'invites/OW-NEW1'), 'admin reads owner invite');
  await denied(commit('owner-g', [W('invites/OW-BAD1', { schoolId: 'green-valley', email: 'x@example.com', role: 'owner', status: 'pending', createdBy: 'owner-g' })]), 'an owner cannot use the OW- ids');
});

test('the super admin edits and archives a school but cannot touch other fields', async () => {
  await allowed(commit('padmin', [W(A, { name: 'Green Valley High', contactEmail: '', phone: '', address: '', createdBy: 'x' }, [], ['name', 'contactEmail', 'phone', 'address'])]), 'edit profile');
  await allowed(commit('padmin', [W(A, { archived: true, archivedOn: '2026-11-23' }, [], ['archived', 'archivedOn'])]), 'archive');
  await denied(commit('padmin', [W(A, { createdBy: 'padmin' }, [], ['createdBy'])]), 'other field');
  await denied(commit('owner-g', [W(A, { archived: true, archivedOn: '2026-12-01' }, [], ['archived', 'archivedOn'])]), 'owner cannot archive itself');
});

test('owner records: the super admin lists owners and switches them, not other members', async () => {
  await allowed(query('padmin', A, 'members', [['role', 'owner']]), 'list owners');
  await denied(query('padmin', A, 'members', [['role', 'principal']]), 'list principals');
  await allowed(commit('padmin', [W(`${A}/members/owner-g`, { active: false }, [], ['active'])]), 'deactivate owner');
  await denied(commit('padmin', [W(`${A}/members/owner-g`, { role: 'teacher' }, [], ['role'])]), 'change role');
  await denied(commit('padmin', [W(`${A}/members/principal-g`, { active: false }, [], ['active'])]), 'principal is not an owner record');
});

test('plans: every change needs a price-history entry and history cannot be edited', async () => {
  const plan = (historyId) => W('plans/standard', { name: 'Standard', monthlyPrice: 999, yearlyPrice: 9990, setupFee: 0, studentLimit: 500, staffLimit: 50, storageMb: 2048, features: ['fees'], active: true, historyId });
  const history = W('planHistory/H-ONE1', { planId: 'standard', by: 'padmin', monthlyPrice: 999, yearlyPrice: 9990, setupFee: 0 }, ['at']);
  await denied(commit('padmin', [plan('H-ONE1')]), 'plan without history');
  await allowed(commit('padmin', [history, plan('H-ONE1')]), 'plan with history');
  await allowed(get('owner-g', 'plans/standard'), 'signed-in users read plans');
  await denied(commit('owner-g', [history, plan('H-ONE1')]), 'owner cannot write plans');
  await denied(commit('padmin', [W('planHistory/H-ONE1', { planId: 'standard', by: 'padmin', monthlyPrice: 1, yearlyPrice: 1, setupFee: 0 }, ['at'])]), 'history is immutable');
  await denied(remove('padmin', 'plans/standard'), 'plans are not deleted');
});

test('login history: users write their own entry, only the super admin reads', async () => {
  const id = (uid, n = '8000000000001') => `loginHistory/${uid}_${n}`;
  await allowed(commit('owner-g', [W(id('owner-g'), { uid: 'owner-g', email: 'owner@example.com' }, ['at'])]), 'own entry');
  await denied(commit('owner-g', [W(id('principal-g'), { uid: 'principal-g' }, ['at'])]), 'entry for someone else');
  await denied(commit('owner-g', [W(id('owner-g', '8000000000001'), { uid: 'owner-g', email: 'changed@example.com' }, ['at'])]), 'edit own entry');
  await allowed(get('padmin', id('owner-g')), 'admin reads');
  await denied(get('owner-g', id('owner-g')), 'owner cannot read back');
});

test('platform security switch is for the super admin only', async () => {
  await allowed(set('padmin', 'platformConfig/security', { requireMfa: false }), 'admin sets it');
  await denied(set('owner-g', 'platformConfig/security', { requireMfa: false }), 'owner cannot');
  await denied(get('owner-g', 'platformConfig/security'), 'owner cannot read');
});

test('two demo schools stay separate, even for their own owners', async () => {
  await allowed(get('owner-g', `${A}/students/S1`), 'owner A reads A');
  await denied(get('owner-g', `${B}/students/S9`), 'owner A cannot read B');
  await denied(get('owner-b', `${A}/students/S1`), 'owner B cannot read A');
  await denied(get('owner-g', `${A}/platformGrants/x`), 'no grant path inside a school');
});
