// Firestore rules tests for plan limits, grace period and domain status. Synthetic records only.
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

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [A, { name: 'ABCD School', contactEmail: 'a@s.in', phone: '98300 00000', address: 'Town' }],
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [B, { name: 'Second', contactEmail: 'b@s.in', phone: '98300 00001', address: 'Town' }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const student = (n) => ({ admissionNo: 'A-' + n, name: 'Student ' + n, guardianName: 'Guardian', guardianPhone: '98300 00000', status: 'active' });
const billing = (over) => set(ADMIN, P('billing', 'main'), { plan: 'trial', status: 'trial', ...over });

test('grace period: a trial that ended is read-only once its grace days run out', async () => {
  assert.equal(await set(ADMIN, 'platformAdmins/pa', { createdAt: 'x' }), 200);
  await billing({ trialEnds: { ts: iso(5) } });
  await allowed(set('owner-a', P('students', 'a-1'), student(1)), 'trial running');
  await billing({ trialEnds: { ts: iso(-1) }, graceDays: 7 });
  await allowed(set('owner-a', P('students', 'a-2'), student(2)), 'inside grace');
  await billing({ trialEnds: { ts: iso(-10) }, graceDays: 7 });
  await denied(set('owner-a', P('students', 'a-3'), student(3)), 'grace used up');
  await allowed(get('owner-a', P('students', 'a-1')), 'owner still reads');
  await billing({ trialEnds: { ts: iso(-1) } });
  await denied(set('owner-a', P('students', 'a-3'), student(3)), 'no grace set');
  await allowed(set('pa', P('billing', 'main'), { plan: 'standard', status: 'active' }), 'platform admin reactivates');
  await allowed(set('owner-a', P('students', 'a-3'), student(3)), 'writes work again');
  await billing({ status: 'active' });
  await allowed(set('owner-a', P('students', 'a-4'), student(4)), 'paid plan is not a trial');
  await billing({ status: 'suspended' });
  await denied(set('owner-a', P('students', 'a-5'), student(5)), 'suspended');
});

test('student limit: no new student once the counted students reach the plan limit', async () => {
  await billing({ trialEnds: { ts: iso(20) }, studentLimit: 2 });
  await allowed(set('owner-a', P('students', 'a-1'), student(1)), 'no count yet');
  await set(ADMIN, P('usage', 'main'), { students: 1, staff: 0, updatedAt: { ts: iso(0) } });
  await allowed(set('owner-a', P('students', 'a-2'), student(2)), 'below limit');
  await set(ADMIN, P('usage', 'main'), { students: 2, staff: 0, updatedAt: { ts: iso(0) } });
  await denied(set('owner-a', P('students', 'a-3'), student(3)), 'at limit');
  await allowed(set('owner-a', P('students', 'a-1'), { ...student(1), name: 'Renamed' }), 'edits still work');
  await billing({ trialEnds: { ts: iso(20) } });
  await allowed(set('owner-a', P('students', 'a-3'), student(3)), 'no limit set');
  await set(ADMIN, P('billing', 'main'), { plan: 'trial', status: 'trial', trialEnds: { ts: iso(20) }, studentLimit: 2 });
  await set(ADMIN, P('usage', 'main'), { students: 1, staff: 0, updatedAt: { ts: iso(0) } });
  await denied(set('owner-a', P('students', 'A-9'), student(9)), 'bad id still denied');
});

test('staff limit: staff records and invitations stop at the plan limit', async () => {
  const staff = { name: 'Teacher One', position: 'Teacher', email: 't@s.in' };
  const invite = { schoolId: 'abcd-school', email: 'new@example.com', role: 'teacher', status: 'pending', createdBy: 'owner-a' };
  await billing({ trialEnds: { ts: iso(20) }, staffLimit: 1 });
  await set(ADMIN, P('usage', 'main'), { students: 0, staff: 0, updatedAt: { ts: iso(0) } });
  await allowed(set('owner-a', P('staff', 'st-1'), staff), 'below limit');
  await allowed(set('owner-a', 'invites/INV-1', invite), 'invite below limit');
  await set(ADMIN, P('usage', 'main'), { students: 0, staff: 1, updatedAt: { ts: iso(0) } });
  await denied(set('owner-a', P('staff', 'st-2'), staff), 'staff at limit');
  await denied(set('owner-a', 'invites/INV-2', { ...invite, email: 'other@example.com' }), 'invite at limit');
  await allowed(set('owner-a', P('staff', 'st-1'), { ...staff, position: 'Senior Teacher' }), 'edit still works');
  await allowed(set('owner-b', 'invites/INV-3', { ...invite, schoolId: 'second-demo-school', createdBy: 'owner-b' }), 'other school unaffected');
});

test('domain status: only the platform administrator sets DNS target, check date and SSL', async () => {
  assert.equal(await set(ADMIN, 'platformAdmins/pa', { createdAt: 'x' }), 200);
  const domain = { domain: 'school.example.in', status: 'requested', createdOn: '2026-11-18' };
  await allowed(set('owner-a', P('domainRequests', 'DM-1'), domain), 'owner requests');
  await denied(set('owner-a', P('domainRequests', 'DM-2'), { ...domain, dnsTarget: 'x.example.com' }), 'owner cannot set target');
  await denied(set('owner-a', P('domainRequests', 'DM-2'), { ...domain, ssl: 'active' }), 'owner cannot set ssl');
  const next = { ...domain, status: 'dns-pending', dnsTarget: 'CNAME to azizschoolmanagement.plateria.in', checkedOn: '2026-11-19', ssl: 'pending' };
  await allowed(set('pa', P('domainRequests', 'DM-1'), next), 'admin sets dns step');
  await allowed(get('owner-a', P('domainRequests', 'DM-1')), 'owner reads instructions');
  await allowed(set('pa', P('domainRequests', 'DM-1'), { ...next, status: 'verified', ssl: 'active' }), 'admin verifies');
  await denied(set('pa', P('domainRequests', 'DM-1'), { ...next, ssl: 'maybe' }), 'bad ssl');
  await denied(set('pa', P('domainRequests', 'DM-1'), { ...next, checkedOn: 'today' }), 'bad date');
  await denied(set('pa', P('domainRequests', 'DM-1'), { ...next, dnsTarget: 'x'.repeat(101) }), 'long target');
  await denied(set('pa', P('domainRequests', 'DM-1'), { ...next, domain: 'other.example.in' }), 'domain cannot change');
});
