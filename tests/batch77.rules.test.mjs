// Firestore rules tests for batch 77: invoices, part payments, failed payments, refunds, start dates, and messages to schools.
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
    [`${A}/invoices/INV-1`, { period: '2026-11', amount: 1000, dueOn: '2026-12-01', status: 'due' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});


const INV = `${A}/invoices/INV-1`;
const payment = (id, auditId, extra = {}) => W(`${INV}/payments/${id}`, { kind: 'payment', amount: 400, method: 'upi', status: 'verified', reference: 'UTR123', by: 'padmin', auditId, ...extra }, ['at']);
const inbox = (extra = {}) => W(`${A}/platformInbox/M-ONE1`, { kind: 'announcement', title: 'Hello schools', body: 'A short note.', ...extra }, ['at']);

test('the super admin creates setup and subscription invoices; nobody else does', async () => {
  await allowed(commit('padmin', [W(`${A}/invoices/INV-2`, { period: '2026-12', amount: 5000, dueOn: '2026-12-10', status: 'due', kind: 'setup' })]), 'setup invoice');
  await denied(commit('padmin', [W(`${A}/invoices/INV-3`, { period: '2026-12', amount: 5000, dueOn: '2026-12-10', status: 'due', kind: 'bonus' })]), 'unknown type');
  await denied(commit('padmin', [W(`${A}/invoices/INV-4`, { period: '2026-12', amount: 100, dueOn: '2026-12-10', status: 'due', amountPaid: 500 })]), 'paid more than the amount');
  await denied(commit('owner-g', [W(`${A}/invoices/INV-5`, { period: '2026-12', amount: 100, dueOn: '2026-12-10', status: 'due' })]), 'owner cannot invoice itself');
});

test('part payment, then the rest: each payment needs its audit entry and is never edited', async () => {
  await denied(commit('padmin', [payment('PAY-ONE1', 'A-NOAUD1'), W(INV, { amountPaid: 400 }, [], ['amountPaid'])]), 'payment without audit entry');
  await allowed(commit('padmin', [auditDoc('A-P1111', 'record-payment'), payment('PAY-ONE1', 'A-P1111'), W(INV, { amountPaid: 400 }, [], ['amountPaid'])]), 'part payment');
  await allowed(commit('padmin', [auditDoc('A-P2222', 'record-payment'), payment('PAY-TWO2', 'A-P2222', { amount: 600, reference: 'UTR456' }), W(INV, { amountPaid: 1000, status: 'paid', paidOn: '2026-11-23' }, [], ['amountPaid', 'status', 'paidOn'])]), 'rest of the payment');
  await denied(commit('padmin', [W(INV, { amountPaid: 1500 }, [], ['amountPaid'])]), 'cannot receive more than the amount');
  await denied(commit('padmin', [auditDoc('A-P3333', 'record-payment'), payment('PAY-ONE1', 'A-P3333')]), 'a payment cannot be rewritten');
  await denied(commit('padmin', [{ path: `${INV}/payments/PAY-ONE1`, delete: true }]), 'a payment cannot be deleted');
  await denied(commit('padmin', [auditDoc('A-P4444', 'record-payment'), payment('PAY-BAD1', 'A-P4444', { method: 'bitcoin' })]), 'unknown method');
  await denied(commit('padmin', [auditDoc('A-P5555', 'record-payment'), payment('PAY-BAD2', 'A-P5555', { amount: 0 })]), 'zero amount');
});

test('failed payments are recorded but refunds cannot be "failed"', async () => {
  await allowed(commit('padmin', [auditDoc('A-F1111', 'failed-payment'), payment('PAY-FAIL1', 'A-F1111', { status: 'failed', reference: 'Bank declined' })]), 'failed payment');
  await denied(commit('padmin', [auditDoc('A-F2222', 'failed-payment'), payment('PAY-FAIL2', 'A-F2222', { kind: 'refund', status: 'failed' })]), 'failed refund');
});

test('refunds: only up to what was paid', async () => {
  await allowed(commit('padmin', [auditDoc('A-P1111', 'record-payment'), payment('PAY-ONE1', 'A-P1111', { amount: 1000 }), W(INV, { amountPaid: 1000, status: 'paid', paidOn: '2026-11-23' }, [], ['amountPaid', 'status', 'paidOn'])]), 'paid in full');
  await allowed(commit('padmin', [auditDoc('A-R1111', 'refund-invoice'), payment('PAY-REF1', 'A-R1111', { kind: 'refund', amount: 300 }), W(INV, { refunded: 300 }, [], ['refunded'])]), 'refund');
  await denied(commit('padmin', [W(INV, { refunded: 1500 }, [], ['refunded'])]), 'refund more than was paid');
});

test('who may read payments', async () => {
  await allowed(commit('padmin', [auditDoc('A-P1111', 'record-payment'), payment('PAY-ONE1', 'A-P1111')]), 'payment');
  await allowed(get('padmin', `${INV}/payments/PAY-ONE1`), 'super admin reads');
  await allowed(get('owner-g', `${INV}/payments/PAY-ONE1`), 'owner reads own receipts');
  await denied(get('owner-b', `${INV}/payments/PAY-ONE1`), 'another school\'s owner');
  await denied(commit('owner-g', [auditDoc('A-X1111'), payment('PAY-OWN1', 'A-X1111', { by: 'owner-g' })]), 'owner cannot record a payment');
});

test('a paid plan start date is a date', async () => {
  const billing = (extra) => W(`${A}/billing/main`, { plan: 'standard', status: 'active', ...extra });
  await allowed(commit('padmin', [billing({ startedOn: '2026-11-23' })]), 'start date');
  await denied(commit('padmin', [billing({ startedOn: 'yesterday' })]), 'not a date');
});

test('messages to schools: sent by the super admin, read-marked by the owner, nothing else', async () => {
  await allowed(commit('padmin', [inbox()]), 'send');
  await denied(commit('padmin', [W(`${A}/platformInbox/M-BAD11`, { kind: 'spam', title: 'Bad kind', body: 'x' }, ['at'])]), 'unknown kind');
  await denied(commit('owner-g', [W(`${A}/platformInbox/M-OWN11`, { kind: 'announcement', title: 'Fake note', body: 'x' }, ['at'])]), 'owner cannot send');
  await allowed(get('owner-g', `${A}/platformInbox/M-ONE1`), 'owner reads');
  await denied(get('principal-g', `${A}/platformInbox/M-ONE1`), 'principal does not');
  await denied(get('owner-b', `${A}/platformInbox/M-ONE1`), 'another school');
  await denied(commit('owner-g', [W(`${A}/platformInbox/M-ONE1`, { title: 'Changed' }, [], ['title'])]), 'owner cannot rewrite');
  await allowed(commit('owner-g', [W(`${A}/platformInbox/M-ONE1`, {}, ['readAt'], [])]), 'owner marks it read');
  await denied(commit('owner-g', [W(`${A}/platformInbox/M-ONE1`, {}, ['readAt'], [])]), 'read time is set once');
  await allowed(get('padmin', `${A}/platformInbox/M-ONE1`), 'super admin sees delivery');
});

test('the message log is written once, with its audit entry, for the super admin only', async () => {
  const log = (auditId, extra = {}) => W('platformMessages/M-ONE1', { kind: 'announcement', title: 'Hello schools', body: 'A short note.', audience: 'All schools', recipients: ['green-valley'], by: 'padmin', auditId, ...extra }, ['at']);
  await denied(commit('padmin', [log('A-NOAUD2')]), 'no audit entry');
  await allowed(commit('padmin', [auditDoc('A-M1111', 'send-message', ''), log('A-M1111')]), 'with audit entry');
  await denied(commit('padmin', [auditDoc('A-M2222', 'send-message', ''), log('A-M2222', { title: 'Rewritten' })]), 'cannot be rewritten');
  await denied(get('owner-g', 'platformMessages/M-ONE1'), 'owner cannot read the log');
  await allowed(get('padmin', 'platformMessages/M-ONE1'), 'super admin reads');
});
