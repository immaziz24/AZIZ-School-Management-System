// Firestore rules tests for batch 80 (Mark 5): platform settings (branding, language, email, payment, maintenance, legal). Synthetic records only.
// Reports and insights read data the earlier batches already protect, so they need no new rules.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// Emails for the people in these tests. Everyone but 'unverified' has a verified email address.
const EMAIL = { padmin: 'boss@example.com', newbie: 'newbie@example.com', other: 'other@example.com', unverified: 'newbie@example.com', 'staff-support': 'sam@example.com', 'staff-finance': 'fiona@example.com', 'staff-audit': 'adam@example.com', 'staff-ops': 'olga@example.com', 'staff-revoked': 'rita@example.com' };
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
const minutes = (n) => new Date(Date.now() + n * 60000);

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal(await set(ADMIN, 'platformAdmins/padmin', { active: true }), 200, 'seed admin');
  assert.equal(await set(ADMIN, 'schools/green-valley/members/owner-g', { role: 'owner', active: true }), 200, 'seed owner');
  for (const [id, data] of [['branding', { productName: 'AZIZ School' }], ['maintenance', { on: false }], ['legal', { termsVersion: '1' }], ['locale', { timezone: 'Asia/Kolkata' }],
    ['email', { senderName: 'AZIZ' }], ['payment', { currency: 'INR' }]]) assert.equal(await set(ADMIN, `platformConfig/${id}`, data), 200, 'seed ' + id);
});

test('branding, maintenance and legal are public; locale needs a sign-in; email and payment are for the platform administrator only', async () => {
  for (const id of ['branding', 'maintenance', 'legal']) {
    await allowed(get(null, `platformConfig/${id}`), id + ' public');
    await allowed(get('owner-g', `platformConfig/${id}`), id + ' owner');
  }
  await denied(get(null, 'platformConfig/locale'), 'locale signed out');
  await allowed(get('owner-g', 'platformConfig/locale'), 'locale signed in');
  for (const id of ['email', 'payment']) {
    await denied(get(null, `platformConfig/${id}`), id + ' signed out');
    await denied(get('owner-g', `platformConfig/${id}`), id + ' owner');
    await allowed(get('padmin', `platformConfig/${id}`), id + ' admin');
  }
});

test('only the platform administrator writes the settings, and only the six named documents', async () => {
  for (const id of ['branding', 'locale', 'email', 'payment', 'maintenance', 'legal']) {
    await allowed(set('padmin', `platformConfig/${id}`, { note: 'ok' }), 'admin writes ' + id);
    await denied(set('owner-g', `platformConfig/${id}`, { note: 'no' }), 'owner cannot write ' + id);
    await denied(set(null, `platformConfig/${id}`, { note: 'no' }), 'signed out cannot write ' + id);
  }
  await denied(set('padmin', 'platformConfig/surprise', { note: 'no' }), 'unknown document');
  await denied(get('owner-g', 'platformConfig/surprise'), 'unknown document read');
  await denied(set('padmin', 'platformConfig/branding', Object.fromEntries(Array.from({ length: 13 }, (_, k) => ['f' + k, 'x']))), 'too many fields');
  await allowed(set('padmin', 'platformConfig/branding', Object.fromEntries(Array.from({ length: 12 }, (_, k) => ['f' + k, 'x']))), 'twelve fields');
});

test('the earlier platform settings still work and stay private', async () => {
  await allowed(set('padmin', 'platformConfig/security', { requireMfa: false }), 'security write');
  await denied(get('owner-g', 'platformConfig/security'), 'owner cannot read security');
  await allowed(set('padmin', 'platformConfig/infraLimits', { readsPerDay: 50000, writesPerDay: 20000, storageGb: 5, bandwidthGb: 10, authMau: 10000, budgetInr: 1000, alertPct: 80 }), 'infra limits still valid');
  await denied(get('owner-g', 'platformConfig/infraLimits'), 'owner cannot read infra limits');
});

