// Firestore rules tests for platform administration, signup, plans, suspension, invites. Synthetic records only.
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
const signup = (uid, slug, over = {}) => [
  { path: `schools/${slug}`, data: { ...profile, createdBy: uid, ...(over.school ?? {}) } },
  { path: `schools/${slug}/members/${uid}`, data: { role: 'owner', active: true, ...(over.member ?? {}) } },
  { path: `schools/${slug}/billing/main`, data: { plan: 'trial', status: 'trial', trialEnds: { ts: iso(30) }, studentLimit: 50, staffLimit: 10, ...(over.billing ?? {}) } },
];
const billing = (status, over = {}) => ({ plan: 'standard', status, ...over });

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    ['platformAdmins/padmin', { ok: true }],
    [A, { ...profile, name: 'ABCD School' }],
    [B, { ...profile, name: 'Second School' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [P('billing', 'main'), billing('active', { monthlyPrice: 500 })],
    [P('payroll', 't1_2026-11'), { staffUid: 't1', month: '2026-11', basic: 30000, allowances: 0, deductions: 0 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const item = { name: 'Chalk', quantity: 5, minQuantity: 1 };

test('platform administrator sees every school and manages billing only', async () => {
  await allowed(get('padmin', A), 'school');
  await allowed(get('padmin', B), 'other school');
  await allowed(get('padmin', P('billing', 'main')), 'billing');
  await allowed(set('padmin', P('billing', 'main'), billing('suspended', { note: 'unpaid' })), 'suspend');
  await allowed(set('padmin', P('billing', 'main', B), { plan: 'basic', status: 'active', studentLimit: 300, monthlyPrice: 999, renewsOn: TODAY }), 'create billing');
  await denied(set('padmin', P('billing', 'main'), billing('weird')), 'bad status');
  await denied(set('padmin', P('billing', 'main'), billing('active', { monthlyPrice: -1 })), 'bad price');
  await denied(set('padmin', P('billing', 'main'), { ...billing('active'), extra: 1 }), 'extra field');
  // Batch 75: the platform administrator may now LOOK at school records (404 = allowed, the record does not exist), but never write them.
  assert.equal(await get('padmin', P('students', 's1')), 404, 'student data is readable by the super admin');
  await denied(set('padmin', P('inventory', 'IV-1'), item), 'school records');
  await allowed(query('padmin', '', 'schools', []), 'list schools');
});

test('only the platform administrator manages billing; school people read it', async () => {
  for (const who of ['owner-a', 'prin', 't1', 'owner-b', null]) {
    await denied(set(who, P('billing', 'main'), billing('active')), 'billing write by ' + who);
  }
  await allowed(get('owner-a', P('billing', 'main')), 'owner reads');
  await allowed(get('prin', P('billing', 'main')), 'principal reads');
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, P('billing', 'main')), 'billing read by ' + who);
  await denied(get('owner-a', 'platformAdmins/padmin'), 'owner reads admin doc');
  await allowed(get('padmin', 'platformAdmins/padmin'), 'admin reads own doc');
  await denied(set('owner-a', 'platformAdmins/owner-a', { ok: true }), 'cannot add self as admin');
  await denied(query('owner-a', '', 'schools', []), 'owner lists schools');
});

test('a suspended school is read-only for the owner', async () => {
  await allowed(set('owner-a', P('inventory', 'IV-1'), item), 'write while active');
  await set('padmin', P('billing', 'main'), billing('suspended'));
  await denied(set('owner-a', P('inventory', 'IV-2'), item), 'write while suspended');
  await denied(set('owner-a', A, { ...profile, name: 'ABCD School', phone: '98300 11111' }), 'profile while suspended');
  await allowed(get('owner-a', P('inventory', 'IV-1')), 'owner still reads');
  await allowed(get('prin', P('inventory', 'IV-1')), 'principal still reads');
  await allowed(get('owner-a', P('payroll', 't1_2026-11')), 'owner still reads payroll');
  await set('padmin', P('billing', 'main'), billing('cancelled'));
  await denied(set('owner-a', P('inventory', 'IV-2'), item), 'write while cancelled');
  await set('padmin', P('billing', 'main'), billing('active'));
  await allowed(set('owner-a', P('inventory', 'IV-2'), item), 'write after reactivation');
});

test('a school without a billing record still works', async () => {
  await remove(ADMIN, P('billing', 'main'));
  await allowed(set('owner-a', P('inventory', 'IV-3'), item), 'write without billing');
});

test('signup: a signed-in user creates a school, becomes owner and gets a trial', async () => {
  await allowed(commit('newbie', signup('newbie', 'green-valley')), 'signup');
  await allowed(get('newbie', 'schools/green-valley/billing/main'), 'owner reads trial');
  await allowed(set('newbie', 'schools/green-valley/inventory/IV-1', item), 'new owner can write');
  await denied(commit('other', signup('other', 'green-valley')), 'slug cannot be reused');
  await denied(commit('other', signup('other', 'abcd-school')), 'existing school id');
});

test('signup rules refuse bad slugs, borrowed identities and richer plans', async () => {
  for (const slug of ['ab', 'Green', 'green valley', '1green', 'www', 'admin', 'api', 'platform', 'a'.repeat(31)]) {
    await denied(commit('newbie', signup('newbie', slug)), 'slug ' + slug);
  }
  await denied(commit('newbie', signup('newbie', 'good-one', { school: { createdBy: 'someone-else' } })), 'createdBy other');
  await denied(commit('newbie', signup('newbie', 'good-two', { member: { role: 'teacher' } })), 'member not owner');
  await denied(commit('newbie', signup('newbie', 'good-three', { billing: { plan: 'premium' } })), 'plan premium');
  await denied(commit('newbie', signup('newbie', 'good-four', { billing: { status: 'active' } })), 'status active');
  await denied(commit('newbie', signup('newbie', 'good-five', { billing: { studentLimit: 5000 } })), 'big limit');
  await denied(commit('newbie', signup('newbie', 'good-six', { billing: { trialEnds: { ts: iso(400) } } })), 'long trial');
  await denied(commit('newbie', signup('newbie', 'good-seven', { school: { name: '  ' } })), 'blank name');
  await denied(commit('newbie', signup('newbie', 'good-eight', { school: { extra: 'x' } })), 'extra school field');
  await denied(commit(null, signup('anon', 'good-nine')), 'anonymous');
  // Joining an existing school as its owner is not possible.
  await denied(set('newbie', `${A}/members/newbie`, { role: 'owner', active: true }), 'self-add to an existing school');
  await denied(commit('newbie', [{ path: `${A}/members/newbie`, data: { role: 'owner', active: true } }]), 'batch self-add');
});

test('support tickets: owner raises, platform administrator answers', async () => {
  const ticket = { schoolId: 'abcd-school', subject: 'Help', body: 'We need help', status: 'open', createdBy: 'owner-a', createdOn: TODAY };
  await allowed(set('owner-a', 'supportTickets/ST-1', ticket), 'raise');
  await denied(set('owner-a', 'supportTickets/ST-2', { ...ticket, status: 'answered' }), 'cannot start answered');
  await denied(set('owner-a', 'supportTickets/ST-2', { ...ticket, reply: 'self' }), 'cannot reply');
  await denied(set('owner-a', 'supportTickets/ST-2', { ...ticket, createdBy: 'owner-b' }), 'wrong creator');
  await denied(set('owner-b', 'supportTickets/ST-2', ticket), 'other school owner');
  await denied(set('prin', 'supportTickets/ST-2', { ...ticket, createdBy: 'prin' }), 'principal cannot raise');
  await allowed(set('padmin', 'supportTickets/ST-1', { ...ticket, status: 'answered', reply: 'Done' }), 'answer');
  await denied(set('padmin', 'supportTickets/ST-1', { ...ticket, schoolId: 'second-demo-school' }), 'cannot move');
  await denied(set('owner-a', 'supportTickets/ST-1', { ...ticket, status: 'closed' }), 'owner cannot update');
  await allowed(get('owner-a', 'supportTickets/ST-1'), 'owner reads own');
  await allowed(get('prin', 'supportTickets/ST-1'), 'principal reads own');
  await allowed(get('padmin', 'supportTickets/ST-1'), 'admin reads');
  await denied(get('owner-b', 'supportTickets/ST-1'), 'other school reads');
  await denied(get('t1', 'supportTickets/ST-1'), 'teacher reads');
  await allowed(query('owner-a', '', 'supportTickets', [['schoolId', 'abcd-school']]), 'own list');
  await allowed(query('padmin', '', 'supportTickets', [['status', 'open']]), 'admin list');
});

test('invites: the invited person accepts and becomes a member', async () => {
  const invite = { schoolId: 'abcd-school', email: 'invitee@example.com', role: 'teacher', status: 'pending', createdBy: 'owner-a' };
  await allowed(set('owner-a', 'invites/IN-1', invite), 'owner invites');
  await denied(set('owner-b', 'invites/IN-2', invite), 'other owner invites');
  await denied(set('t1', 'invites/IN-2', { ...invite, createdBy: 't1' }), 'teacher invites');
  await denied(set('owner-a', 'invites/IN-2', { ...invite, role: 'parent' }), 'parent role');
  await denied(set('owner-a', 'invites/IN-2', { ...invite, status: 'accepted' }), 'born accepted');
  await denied(set('owner-a', 'invites/IN-2', { ...invite, email: 'Mixed@Example.com' }), 'capital letters in email');
  await allowed(get('invitee', 'invites/IN-1'), 'invitee reads');
  await allowed(query('invitee', '', 'invites', [['email', 'invitee@example.com']]), 'invitee finds invites');
  await denied(get('stranger', 'invites/IN-1'), 'stranger reads');
  // The wrong person cannot accept.
  const accept = (uid, role = 'teacher', status = 'accepted') => [
    { path: 'invites/IN-1', data: { ...invite, status } },
    { path: `${A}/members/${uid}`, data: { role, active: true, inviteId: 'IN-1' } },
  ];
  await denied(commit('stranger', accept('stranger')), 'stranger accepts');
  await denied(commit('invitee', accept('invitee', 'owner')), 'accepts a bigger role');
  await denied(commit('invitee', [{ path: `${A}/members/invitee`, data: { role: 'teacher', active: true, inviteId: 'IN-1' } }]), 'member without accepting');
  await allowed(commit('invitee', accept('invitee')), 'accepts');
  await allowed(get('invitee', `${A}/members/invitee`), 'now a member');
  await denied(commit('invitee', accept('invitee')), 'cannot accept twice');
});

test('invites: the owner can revoke, and a revoked invite cannot be accepted', async () => {
  const invite = { schoolId: 'abcd-school', email: 'invitee@example.com', role: 'principal', status: 'pending', createdBy: 'owner-a' };
  await set(ADMIN, 'invites/IN-1', invite);
  await allowed(set('owner-a', 'invites/IN-1', { ...invite, status: 'revoked' }), 'revoke');
  await denied(commit('invitee', [{ path: 'invites/IN-1', data: { ...invite, status: 'accepted' } },
    { path: `${A}/members/invitee`, data: { role: 'principal', active: true, inviteId: 'IN-1' } }]), 'accept revoked');
});

test('owner can switch members on and off but not change roles', async () => {
  await allowed(set('owner-a', `${A}/members/t1`, { role: 'teacher', active: false }), 'deactivate teacher');
  await allowed(set('owner-a', `${A}/members/t1`, { role: 'teacher', active: true }), 'reactivate');
  await denied(set('owner-a', `${A}/members/t1`, { role: 'owner', active: true }), 'promote');
  await denied(set('owner-a', `${A}/members/owner-a`, { role: 'owner', active: false }), 'switch self off');
  await denied(set('owner-b', `${A}/members/t1`, { role: 'teacher', active: false }), 'other school owner');
  await denied(set('t1', `${A}/members/prin`, { role: 'principal', active: false }), 'teacher');
  await denied(set('prin', `${A}/members/t1`, { role: 'teacher', active: false }), 'principal');
});

test('invoices, domain and data requests, drills and flags', async () => {
  const invoice = { period: '2026-11', amount: 500, dueOn: TODAY, status: 'due' };
  await allowed(set('padmin', P('invoices', 'INV-1'), invoice), 'admin writes invoice');
  await allowed(set('padmin', P('invoices', 'INV-1'), { ...invoice, status: 'paid', paidOn: TODAY }), 'mark paid');
  await denied(set('padmin', P('invoices', 'INV-2'), { ...invoice, status: 'lost' }), 'bad invoice status');
  await denied(set('padmin', P('invoices', 'INV-2'), { ...invoice, amount: -5 }), 'negative amount');
  for (const who of ['owner-a', 't1', null]) await denied(set(who, P('invoices', 'INV-3'), invoice), 'invoice by ' + who);
  await allowed(get('owner-a', P('invoices', 'INV-1')), 'owner reads invoice');
  await allowed(get('prin', P('invoices', 'INV-1')), 'principal reads invoice');
  await denied(get('owner-b', P('invoices', 'INV-1')), 'other school reads invoice');

  const domain = { domain: 'school.example.com', status: 'requested', createdOn: TODAY };
  await allowed(set('owner-a', P('domainRequests', 'DM-1'), domain), 'owner requests domain');
  await denied(set('owner-a', P('domainRequests', 'DM-2'), { ...domain, status: 'verified' }), 'owner verifies');
  await denied(set('owner-a', P('domainRequests', 'DM-2'), { ...domain, domain: 'not a domain' }), 'bad domain');
  await denied(set('owner-a', P('domainRequests', 'DM-1'), { ...domain, status: 'verified' }), 'owner updates');
  await allowed(set('padmin', P('domainRequests', 'DM-1'), { ...domain, status: 'verified' }), 'admin verifies');
  await denied(set('padmin', P('domainRequests', 'DM-1'), { ...domain, domain: 'other.example.com' }), 'admin changes domain');

  const data = { kind: 'export', status: 'requested', createdOn: TODAY };
  await allowed(set('owner-a', P('dataRequests', 'DR-1'), data), 'owner requests export');
  await denied(set('owner-a', P('dataRequests', 'DR-2'), { ...data, status: 'completed' }), 'owner completes');
  await denied(set('owner-a', P('dataRequests', 'DR-2'), { ...data, kind: 'wipe' }), 'bad kind');
  await allowed(set('padmin', P('dataRequests', 'DR-1'), { ...data, status: 'held', note: 'legal hold' }), 'admin holds');
  await denied(set('padmin', P('dataRequests', 'DR-1'), { ...data, kind: 'deletion' }), 'admin changes kind');

  const drill = { date: TODAY, what: 'Restore from backup', result: 'Worked', minutes: 30 };
  await allowed(set('padmin', 'platformDrills/DL-1', drill), 'admin logs drill');
  await denied(set('padmin', 'platformDrills/DL-2', { ...drill, what: ' ' }), 'blank drill');
  for (const who of ['owner-a', null]) {
    await denied(set(who, 'platformDrills/DL-3', drill), 'drill write by ' + who);
    await denied(get(who, 'platformDrills/DL-1'), 'drill read by ' + who);
  }

  await allowed(set('padmin', 'platformConfig/flags', { website: true, finance: false }), 'admin sets flags');
  await allowed(get('owner-a', 'platformConfig/flags'), 'owner reads flags');
  await denied(set('owner-a', 'platformConfig/flags', { website: false }), 'owner sets flags');
  await denied(set('padmin', 'platformConfig/other', { x: 1 }), 'other config doc');
  await denied(get(null, 'platformConfig/flags'), 'anonymous reads flags');
});

test('consent and usage use the server time', async () => {
  await allowed(commit('t1', [{ path: P('consents', 't1'), data: { policyVersion: '2026-1' }, times: ['acceptedAt'] }]), 'member consents');
  await allowed(get('t1', P('consents', 't1')), 'reads own');
  await allowed(get('prin', P('consents', 't1')), 'principal reads');
  await denied(get('owner-b', P('consents', 't1')), 'other school reads');
  await denied(set('t1', P('consents', 't1'), { policyVersion: '2026-1', acceptedAt: { ts: iso(-5) } }), 'back-dated');
  await denied(commit('t1', [{ path: P('consents', 'prin'), data: { policyVersion: '2026-1' }, times: ['acceptedAt'] }]), 'consent for someone else');
  await denied(commit('stranger', [{ path: P('consents', 'stranger'), data: { policyVersion: '2026-1' }, times: ['acceptedAt'] }]), 'non-member consents');
  await denied(commit('t1', [{ path: P('consents', 't1'), data: { policyVersion: 'x y' }, times: ['acceptedAt'] }]), 'bad version');

  await allowed(commit('owner-a', [{ path: P('usage', 'main'), data: { students: 120, staff: 9, classes: 12 }, times: ['updatedAt'] }]), 'owner records usage');
  await allowed(get('padmin', P('usage', 'main')), 'admin reads usage');
  await allowed(get('prin', P('usage', 'main')), 'principal reads usage');
  await denied(commit('owner-a', [{ path: P('usage', 'main'), data: { students: -1, staff: 9 }, times: ['updatedAt'] }]), 'negative usage');
  await denied(set('owner-a', P('usage', 'main'), { students: 1, staff: 1, updatedAt: { ts: iso(-3) } }), 'back-dated usage');
  for (const who of ['t1', 'prin', 'owner-b', null]) {
    await denied(commit(who, [{ path: P('usage', 'main'), data: { students: 1, staff: 1 }, times: ['updatedAt'] }]), 'usage by ' + who);
  }
});
