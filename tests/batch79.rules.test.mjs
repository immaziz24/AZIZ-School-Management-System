// Firestore rules tests for batch 79 (Mark 4): internal staff, support, incidents, infrastructure, error reports and backups.
// Synthetic records only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// Emails for the people in these tests. Everyone but 'unverified' has a verified email address.
const EMAIL = { newbie: 'newbie@example.com', other: 'other@example.com', unverified: 'newbie@example.com', 'staff-support': 'sam@example.com', 'staff-finance': 'fiona@example.com', 'staff-audit': 'adam@example.com', 'staff-ops': 'olga@example.com', 'staff-revoked': 'rita@example.com' };
const tokenFor = (uid) => {
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid,
    iat: now, auth_time: now, exp: now + 3600,
    ...(EMAIL[uid] ? { email: EMAIL[uid], email_verified: uid !== 'unverified' } : {}),
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
const PERMS = (p = {}) => ({ support: false, finance: false, audit: false, ops: false, ...p });
const auditEntry = (id, action = 'staff-invite', actor = 'padmin') => W(`platformAudit/${id}`, { actor, actorEmail: 'x@example.com', action, reason: 'Testing the staff flow now' }, ['at']);
const inviteDoc = (email, role = 'support', perms = PERMS({ support: true }), auditId = 'A-INV1', status = 'invited') =>
  W(`staffInvites/${email}`, { email, role, perms, status, by: 'padmin', auditId }, ['at']);
const staffDoc = (uid, email, role, perms, auditId = 'A-JOIN1') => W(`platformStaff/${uid}`, { email, role, perms, status: 'active', auditId }, ['joinedAt']);
const seedStaff = async (uid, email, role, perms, status = 'active') =>
  assert.equal(await set(ADMIN, `platformStaff/${uid}`, { email, role, perms, status, joinedAt: new Date(), auditId: 'A-SEED1' }), 200, 'seed ' + uid);

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [A, { name: 'Green Valley' }],
    [`${A}/members/owner-g`, { role: 'owner', active: true }],
    [`${A}/billing/main`, { status: 'active', storageMb: 500 }],
    [`${A}/invoices/INV-1`, { period: '2026-11', amount: 4999, dueOn: '2026-11-30', status: 'due' }],
    ['supportTickets/T1', { schoolId: 'green-valley', subject: 'Fee report question', body: 'Please help with the report', status: 'open', createdBy: 'owner-g', createdOn: '2026-11-20' }],
    ['platformAudit/A-OLD1', { actor: 'padmin', action: 'edit-school', at: new Date() }],
    ['loginHistory/staff-support_8000000000000', { uid: 'staff-support', at: new Date() }],
    ['platformJobs/backup-2026-11-23', { done: 2, schools: 2 }],
    ['platformInfra/2026-11', { reads: 1, writes: 1, deletes: 0, storageMb: 1, bandwidthMb: 1, authActive: 1, costInr: 1, by: 'padmin', at: new Date() }],
    ['platformAdmins/padmin', { active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
  await seedStaff('staff-support', EMAIL['staff-support'], 'support', PERMS({ support: true }));
  await seedStaff('staff-finance', EMAIL['staff-finance'], 'finance', PERMS({ finance: true }));
  await seedStaff('staff-audit', EMAIL['staff-audit'], 'auditor', PERMS({ audit: true }));
  await seedStaff('staff-ops', EMAIL['staff-ops'], 'operations', PERMS({ ops: true, support: true }));
  await seedStaff('staff-revoked', EMAIL['staff-revoked'], 'support', PERMS({ support: true }), 'revoked');
});

test('staff invitation: only the super admin creates one, with its audit entry', async () => {
  await allowed(commit('padmin', [auditEntry('A-INV1'), inviteDoc('newbie@example.com')]), 'invite');
  await denied(commit('owner-g', [auditEntry('A-INV2', 'staff-invite', 'owner-g'), inviteDoc('other@example.com', 'support', PERMS({ support: true }), 'A-INV2')]), 'an owner cannot invite');
  await denied(commit('staff-support', [auditEntry('A-INV3', 'staff-invite', 'staff-support'), inviteDoc('other@example.com', 'support', PERMS({ support: true }), 'A-INV3')]), 'staff cannot invite');
  await denied(commit('padmin', [inviteDoc('other@example.com', 'support', PERMS({ support: true }), 'A-MISSING')]), 'no audit entry');
  await denied(commit('padmin', [auditEntry('A-INV4'), inviteDoc('other@example.com', 'boss', PERMS(), 'A-INV4')]), 'unknown role');
  await denied(commit('padmin', [auditEntry('A-INV5'), inviteDoc('other@example.com', 'support', { ...PERMS(), root: true }, 'A-INV5')]), 'unknown permission');
  await denied(commit('padmin', [auditEntry('A-INV6'), inviteDoc('Other@Example.com', 'support', PERMS(), 'A-INV6')]), 'email must be lower case');
});

test('staff invitation: only the invited, verified person reads it', async () => {
  await allowed(commit('padmin', [auditEntry('A-INV1'), inviteDoc('newbie@example.com')]), 'invite');
  await allowed(get('newbie', 'staffInvites/newbie@example.com'), 'invited person reads');
  await allowed(get('padmin', 'staffInvites/newbie@example.com'), 'super admin reads');
  await denied(get('other', 'staffInvites/newbie@example.com'), 'someone else');
  await denied(get('unverified', 'staffInvites/newbie@example.com'), 'unverified email');
  await denied(get(null, 'staffInvites/newbie@example.com'), 'signed out');
});

test('accepting an invitation creates the staff record with exactly the invited role and permissions', async () => {
  await allowed(commit('padmin', [auditEntry('A-INV1'), inviteDoc('newbie@example.com')]), 'invite');
  const accept = (extra = {}) => [
    W('platformAudit/A-JOIN1', { actor: 'newbie', actorEmail: 'newbie@example.com', action: 'staff-joined' }, ['at']),
    staffDoc('newbie', 'newbie@example.com', 'support', PERMS({ support: true })),
    W('staffInvites/newbie@example.com', { status: 'accepted' }, ['acceptedAt'], ['status']),
  ].map((w, i) => (i === 1 && extra.staff ? extra.staff : w));
  await denied(commit('newbie', accept({ staff: staffDoc('newbie', 'newbie@example.com', 'support', PERMS({ support: true, finance: true })) })), 'more permissions than invited');
  await denied(commit('newbie', accept({ staff: staffDoc('newbie', 'newbie@example.com', 'operations', PERMS({ support: true })) })), 'different role');
  await denied(commit('newbie', accept({ staff: staffDoc('newbie', 'other@example.com', 'support', PERMS({ support: true })) })), 'different email');
  await denied(commit('unverified', [staffDoc('unverified', 'newbie@example.com', 'support', PERMS({ support: true })), W('staffInvites/newbie@example.com', { status: 'accepted' }, ['acceptedAt'], ['status']), auditEntry('A-JOIN1', 'staff-joined', 'unverified')]), 'unverified email');
  await denied(commit('newbie', [staffDoc('newbie', 'newbie@example.com', 'support', PERMS({ support: true })), W('staffInvites/newbie@example.com', { status: 'accepted' }, ['acceptedAt'], ['status'])]), 'no audit entry');
  await denied(commit('newbie', [auditEntry('A-JOIN1', 'staff-joined', 'newbie'), staffDoc('newbie', 'newbie@example.com', 'support', PERMS({ support: true }))]), 'invitation not marked accepted');
  await denied(commit('other', [auditEntry('A-JOIN2', 'staff-joined', 'other'), staffDoc('other', 'other@example.com', 'support', PERMS({ support: true })), W('staffInvites/other@example.com', { status: 'accepted' }, ['acceptedAt'], ['status'])]), 'no invitation for this person');
  await allowed(commit('newbie', accept()), 'accept');
  await denied(commit('newbie', accept()), 'cannot accept twice');
  await allowed(get('newbie', 'platformStaff/newbie'), 'reads own staff record');
});

test('a cancelled invitation cannot be accepted', async () => {
  await allowed(commit('padmin', [auditEntry('A-INV1'), inviteDoc('newbie@example.com')]), 'invite');
  await allowed(commit('padmin', [auditEntry('A-CAN1', 'staff-invite-cancel'), W('staffInvites/newbie@example.com', { status: 'cancelled', by: 'padmin', auditId: 'A-CAN1' }, ['at'], ['status', 'by', 'auditId'])]), 'cancel');
  await denied(commit('newbie', [auditEntry('A-JOIN1', 'staff-joined', 'newbie'), staffDoc('newbie', 'newbie@example.com', 'support', PERMS({ support: true })), W('staffInvites/newbie@example.com', { status: 'accepted' }, ['acceptedAt'], ['status'])]), 'accept after cancel');
});

test('changing and revoking staff: super admin only, with an audit entry, nothing deleted', async () => {
  const change = (who, id, status, role = 'support', perms = PERMS({ support: true }), target = 'staff-support') =>
    commit(who, [auditEntry('A-' + id, 'staff-change', who), W(`platformStaff/${target}`, { role, perms, status, auditId: 'A-' + id }, ['changedAt'], ['role', 'perms', 'status', 'auditId'])]);
  await allowed(change('padmin', 'CHG1', 'active', 'operations', PERMS({ ops: true })), 'change role');
  await allowed(get('staff-support', 'platformStaff/staff-support'), 'staff reads own record');
  await denied(change('staff-support', 'CHG2', 'active', 'operations', PERMS({ ops: true, finance: true })), 'staff cannot change their own permissions');
  await denied(commit('padmin', [W('platformStaff/staff-support', { role: 'support', perms: PERMS(), status: 'active', auditId: 'A-NONE' }, ['changedAt'], ['role', 'perms', 'status', 'auditId'])]), 'no audit entry');
  await denied(change('padmin', 'CHG3', 'suspended'), 'unknown status');
  await denied(change('padmin', 'CHG4', 'active', 'boss'), 'unknown role');
  await allowed(get('staff-ops', 'platformInfra/2026-11'), 'operations staff work before the revoke');
  await allowed(commit('padmin', [auditEntry('A-REV1', 'staff-revoke'), W('platformStaff/staff-ops', { status: 'revoked', auditId: 'A-REV1' }, ['changedAt', 'revokedAt'], ['status', 'auditId'])]), 'revoke');
  await denied(get('staff-ops', 'platformInfra/2026-11'), 'revoked staff lose their access');
  await denied(get('staff-ops', 'supportTickets/T1'), 'including the ticket access they had');
  await allowed(commit('padmin', [auditEntry('A-RES1', 'staff-restore'), W('platformStaff/staff-ops', { status: 'active', auditId: 'A-RES1' }, ['changedAt'], ['status', 'auditId'])]), 'restore');
  await allowed(get('staff-ops', 'platformInfra/2026-11'), 'access is back');
  await denied(remove('padmin', 'platformStaff/staff-support'), 'nobody deletes staff records');
  await denied(get('staff-finance', 'platformStaff/staff-support'), 'staff cannot read each other');
  await allowed(get('padmin', 'platformStaff/staff-support'), 'super admin reads any');
});

test('support staff: tickets only', async () => {
  await allowed(get('staff-support', 'supportTickets/T1'), 'reads tickets');
  await allowed(get('staff-support', `${A}`), 'reads school name');
  await allowed(set('staff-support', 'supportTickets/T1', { schoolId: 'green-valley', subject: 'Fee report question', body: 'Please help with the report', status: 'answered', createdBy: 'owner-g', createdOn: '2026-11-20', reply: 'Done', priority: 'high', dueOn: '2026-12-01', assignedTo: 'staff-support', assignedEmail: 'sam@example.com' }), 'answers and sets priority');
  await denied(set('staff-support', 'supportTickets/T1', { schoolId: 'green-valley', subject: 'Changed subject', body: 'Please help with the report', status: 'open', createdBy: 'owner-g', createdOn: '2026-11-20' }), 'cannot rewrite the school\'s words');
  await denied(set('staff-support', 'supportTickets/T1', { schoolId: 'green-valley', subject: 'Fee report question', body: 'Please help with the report', status: 'open', createdBy: 'owner-g', createdOn: '2026-11-20', priority: 'panic' }), 'unknown priority');
  await denied(get('staff-support', `${A}/invoices/INV-1`), 'no invoices');
  await denied(get('staff-support', `${A}/billing/main`), 'no billing');
  await denied(get('staff-support', 'platformAudit/A-OLD1'), 'no audit log');
  await denied(get('staff-support', 'platformInfra/2026-11'), 'no infrastructure');
  await denied(get('staff-support', `${A}/students/S1`), 'no school records');
});

test('support ticket fields: priority, deadline and assignment', async () => {
  const ticket = (extra) => ({ schoolId: 'green-valley', subject: 'Fee report question', body: 'Please help with the report', status: 'open', createdBy: 'owner-g', createdOn: '2026-11-20', ...extra });
  await allowed(set('padmin', 'supportTickets/T1', ticket({ priority: 'urgent', dueOn: '2026-12-05', assignedTo: 'staff-support', assignedEmail: 'sam@example.com' })), 'super admin sets them');
  await denied(set('padmin', 'supportTickets/T1', ticket({ dueOn: 'tomorrow' })), 'bad deadline');
  await denied(set('padmin', 'supportTickets/T1', ticket({ extra: 'x' })), 'unknown field');
  await denied(set('padmin', 'supportTickets/T1', { ...ticket({}), body: 'Changed' }), 'body cannot change');
  await allowed(set('owner-g', 'supportTickets/T2', ticket({})), 'the school still raises a plain ticket');
  await denied(set('owner-g', 'supportTickets/T3', ticket({ priority: 'urgent' })), 'the school cannot set a priority');
  await denied(set('owner-g', 'supportTickets/T4', ticket({ assignedTo: 'staff-support' })), 'the school cannot assign');
  await denied(set('owner-g', 'supportTickets/T1', ticket({ status: 'closed' })), 'the school cannot change an existing ticket');
});

test('finance staff: read-only access to billing and invoices', async () => {
  await allowed(get('staff-finance', `${A}`), 'school name');
  await allowed(get('staff-finance', `${A}/billing/main`), 'billing');
  await allowed(get('staff-finance', `${A}/invoices/INV-1`), 'invoice');
  await denied(set('staff-finance', `${A}/invoices/INV-1`, { period: '2026-11', amount: 1, dueOn: '2026-11-30', status: 'paid' }), 'cannot change an invoice');
  await denied(set('staff-finance', `${A}/billing/main`, { status: 'active', storageMb: 999999 }), 'cannot change billing');
  await denied(get('staff-finance', 'supportTickets/T1'), 'no tickets');
  await denied(get('staff-finance', `${A}/students/S1`), 'no student records');
});

test('auditor staff: audit log, sign-ins and incidents, nothing else', async () => {
  await allowed(get('staff-audit', 'platformAudit/A-OLD1'), 'audit log');
  await allowed(get('staff-audit', 'loginHistory/staff-support_8000000000000'), 'sign-in history');
  await denied(get('staff-audit', 'supportTickets/T1'), 'no tickets');
  await denied(get('staff-audit', `${A}/invoices/INV-1`), 'no invoices');
  await denied(set('staff-audit', 'platformAudit/A-OLD1', { actor: 'staff-audit', action: 'edit-school', at: new Date() }), 'audit entries are never changed');
  await allowed(commit('staff-audit', [auditEntry('A-OWN1', 'incident-open', 'staff-audit')]), 'staff write their own audit entries');
  await denied(commit('staff-audit', [auditEntry('A-FAKE1', 'incident-open', 'padmin')]), 'but not in somebody else\'s name');
  await denied(commit('staff-revoked', [auditEntry('A-REV2', 'incident-open', 'staff-revoked')]), 'revoked staff write nothing');
});

test('incidents: super admin and audit staff, with an audit entry', async () => {
  const incident = (id, who, extra = {}, data = {}) => commit(who, [auditEntry('A-' + id, 'incident-open', who),
    W(`platformIncidents/I-${id}`, { title: 'Suspicious night access', severity: 'high', status: 'open', openedBy: who, auditId: 'A-' + id, ...data }, ['openedAt', 'updatedAt', ...(extra.serverFields || [])])]);
  await allowed(incident('ONE1', 'padmin'), 'super admin opens');
  await allowed(incident('TWO2', 'staff-audit'), 'audit staff opens');
  await denied(incident('TRE3', 'staff-support'), 'support staff cannot');
  await denied(incident('FOR4', 'padmin', {}, { severity: 'huge' }), 'bad severity');
  await denied(incident('FIV5', 'padmin', {}, { status: 'resolved' }), 'cannot open as resolved');
  await denied(commit('padmin', [W('platformIncidents/I-NOAUD', { title: 'No audit entry', severity: 'low', status: 'open', openedBy: 'padmin', auditId: 'A-NOAUD' }, ['openedAt', 'updatedAt'])]), 'no audit entry');
  const update = (who, data, serverFields, auditId) => commit(who, [auditEntry(auditId, 'incident-update', who), W('platformIncidents/I-ONE1', { status: 'investigating', auditId, ...data }, serverFields, [...new Set(['status', 'auditId', ...Object.keys(data)])])]);
  await allowed(update('padmin', {}, ['updatedAt'], 'A-UPD1'), 'investigating');
  await denied(update('padmin', { status: 'resolved' }, ['updatedAt'], 'A-UPD2'), 'resolved needs a resolved time');
  await allowed(update('padmin', { status: 'resolved' }, ['updatedAt', 'resolvedAt'], 'A-UPD3'), 'resolve');
  await denied(update('staff-support', {}, ['updatedAt'], 'A-UPD4'), 'support staff cannot update');
  await denied(remove('padmin', 'platformIncidents/I-ONE1'), 'incidents are never deleted');
  await allowed(get('staff-audit', 'platformIncidents/I-ONE1'), 'audit staff read');
  await denied(get('staff-finance', 'platformIncidents/I-ONE1'), 'finance staff cannot');
});

test('infrastructure readings and limits: super admin and operations staff', async () => {
  const month = (id, who, data = {}) => commit(who, [W(`platformInfra/${id}`, { reads: 1000, writes: 400, deletes: 10, storageMb: 800, bandwidthMb: 2000, authActive: 120, costInr: 350, by: who, ...data }, ['at'])]);
  await allowed(month('2026-12', 'padmin'), 'super admin');
  await allowed(month('2026-12', 'staff-ops'), 'operations staff');
  await denied(month('2026-12', 'staff-support'), 'support staff');
  await denied(month('2026-13', 'padmin'), 'bad month');
  await denied(month('2026-12', 'padmin', { reads: -1 }), 'negative reading');
  await denied(month('2026-12', 'padmin', { costInr: 1.5 }), 'cost must be a whole number');
  await denied(month('2026-12', 'padmin', { extra: 1 }), 'extra field');
  await denied(month('2026-12', 'padmin', { by: 'someone' }), 'wrong author');
  await allowed(get('staff-ops', 'platformInfra/2026-11'), 'operations read');
  await denied(get('owner-g', 'platformInfra/2026-11'), 'owner cannot');
  const limits = { readsPerDay: 50000, writesPerDay: 20000, storageGb: 5, bandwidthGb: 100, authMau: 50000, budgetInr: 2000, alertPct: 80 };
  await allowed(set('padmin', 'platformConfig/infraLimits', limits), 'limits');
  await denied(set('padmin', 'platformConfig/infraLimits', { ...limits, alertPct: 5 }), 'warning percent too low');
  await denied(set('staff-ops', 'platformConfig/infraLimits', limits), 'operations staff cannot change limits');
  await allowed(get('staff-ops', 'platformConfig/infraLimits'), 'operations staff read limits');
  await denied(get('staff-support', 'platformConfig/infraLimits'), 'support staff cannot');
});

test('server job results are readable by operations staff only', async () => {
  await allowed(get('staff-ops', 'platformJobs/backup-2026-11-23'), 'operations');
  await denied(get('staff-support', 'platformJobs/backup-2026-11-23'), 'support');
  await denied(set('staff-ops', 'platformJobs/backup-2026-11-24', { done: 1, schools: 1 }), 'nobody writes jobs from the app');
});

test('error reports: any signed-in user reports, only the platform reads', async () => {
  const report = (who, data = {}, id = 'E-ABCD1') => commit(who, [W(`errorReports/${id}`, { uid: who, message: 'TypeError: x is undefined @ sign-in.mjs:10', page: '/app', agent: 'Test browser', ...data }, ['at'])]);
  await allowed(report('owner-g'), 'an owner reports');
  await denied(report('owner-g', { uid: 'someone-else' }, 'E-ABCD2'), 'not in somebody else\'s name');
  await denied(report('owner-g', { message: 'x'.repeat(301) }, 'E-ABCD3'), 'message too long');
  await denied(report('owner-g', { message: '' }, 'E-ABCD4'), 'empty message');
  await denied(report('owner-g', { extra: 1 }, 'E-ABCD5'), 'extra field');
  await denied(report('owner-g', {}, 'bad-id'), 'bad id');
  await denied(commit(null, [W('errorReports/E-ABCD6', { uid: 'x', message: 'anon' }, ['at'])]), 'signed out');
  await allowed(get('padmin', 'errorReports/E-ABCD1'), 'super admin reads');
  await allowed(get('staff-ops', 'errorReports/E-ABCD1'), 'operations staff reads');
  await denied(get('owner-g', 'errorReports/E-ABCD1'), 'the reporter cannot read');
  await denied(get('staff-support', 'errorReports/E-ABCD1'), 'support staff cannot');
  await denied(set('padmin', 'errorReports/E-ABCD1', { uid: 'padmin', message: 'edited' }), 'never edited');
  await allowed(remove('padmin', 'errorReports/E-ABCD1'), 'super admin clears');
  await denied(remove('staff-ops', 'errorReports/E-ABCD1'), 'staff cannot clear');
});

test('blocked access attempts: a signed-in person records their own', async () => {
  const attempt = (who, id, data = {}) => commit(who, [W(`accessAttempts/${id}`, { uid: who, email: 'x@example.com', agent: 'Test browser', ...data }, ['at'])]);
  await allowed(attempt('owner-g', 'owner-g_8000000000001'), 'own attempt');
  await denied(attempt('owner-g', 'someone_8000000000001'), 'id must start with own uid');
  await denied(attempt('owner-g', 'owner-g_8000000000002', { uid: 'someone' }), 'uid must be own');
  await denied(attempt('owner-g', 'owner-g_80000', {}), 'id needs 13 digits');
  await denied(attempt('owner-g', 'owner-g_8000000000003', { extra: 1 }), 'extra field');
  await denied(commit(null, [W('accessAttempts/x_8000000000004', { uid: 'x' }, ['at'])]), 'signed out');
  await allowed(get('padmin', 'accessAttempts/owner-g_8000000000001'), 'super admin reads');
  await allowed(get('staff-audit', 'accessAttempts/owner-g_8000000000001'), 'audit staff reads');
  await denied(get('owner-g', 'accessAttempts/owner-g_8000000000001'), 'the person cannot read it back');
  await denied(set('padmin', 'accessAttempts/owner-g_8000000000001', { uid: 'owner-g' }), 'never edited');
});

test('backup policy: super admin writes, operations staff read', async () => {
  const policy = { keepDays: 30, frequency: 'daily', alertAfterHours: 36 };
  await allowed(set('padmin', 'platformConfig/backupPolicy', policy), 'policy');
  await allowed(set('padmin', 'platformConfig/backupPolicy', { ...policy, notifyEmail: 'ops@example.com' }), 'with an alert email');
  await denied(set('padmin', 'platformConfig/backupPolicy', { ...policy, keepDays: 3 }), 'keep at least 7 days');
  await denied(set('padmin', 'platformConfig/backupPolicy', { ...policy, frequency: 'hourly' }), 'unknown frequency');
  await denied(set('padmin', 'platformConfig/backupPolicy', { ...policy, alertAfterHours: 1 }), 'alert window too short');
  await denied(set('padmin', 'platformConfig/backupPolicy', { ...policy, extra: 1 }), 'extra field');
  await denied(set('staff-ops', 'platformConfig/backupPolicy', policy), 'operations staff cannot change it');
  await allowed(get('staff-ops', 'platformConfig/backupPolicy'), 'operations staff read');
  await denied(get('owner-g', 'platformConfig/backupPolicy'), 'owner cannot read');
});

test('sign-in history records whether the account had a second factor', async () => {
  const login = (who, id, data = {}) => commit(who, [W(`loginHistory/${id}`, { uid: who, email: 'x@example.com', agent: 'Test browser', ...data }, ['at'])]);
  await allowed(login('owner-g', 'owner-g_8000000000010', { mfa: true }), 'with mfa true');
  await allowed(login('owner-g', 'owner-g_8000000000011', { mfa: false }), 'with mfa false');
  await allowed(login('owner-g', 'owner-g_8000000000012'), 'without the field');
  await denied(login('owner-g', 'owner-g_8000000000013', { mfa: 'yes' }), 'mfa must be true or false');
  await denied(login('owner-g', 'owner-g_8000000000014', { extra: 1 }), 'extra field');
});
