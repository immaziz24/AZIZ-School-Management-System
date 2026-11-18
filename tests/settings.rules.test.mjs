// Firestore rules tests for website look, admission form, school settings, launch checklist. Synthetic records only.
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

test('website look and admission form: the owner writes, anyone reads', async () => {
  const extras = P('site', 'extras');
  await allowed(set('owner-a', extras, { theme: 'royal', f1: 'Previous school|text|0', f2: 'Blood group|select|1|A+;B+;O+;AB+', f3: 'Date of birth|date|1' }), 'owner saves');
  await allowed(get(null, extras), 'public reads');
  await allowed(get('t1', extras), 'teacher reads');
  await allowed(set('owner-a', extras, { theme: 'emerald' }), 'theme only');
  for (const bad of [{ theme: 'neon' }, { theme: 'royal', f1: 'No type' }, { f1: 'Name|image|1' }, { f1: 'Name|text|2' }, { f1: '|text|1' },
    { f1: 'A|text|1|' + 'x'.repeat(200) }, { f7: 'Name|text|1' }, { theme: 'royal', extra: 1 }, { f1: 5 }]) {
    await denied(set('owner-a', extras, bad), JSON.stringify(bad).slice(0, 40));
  }
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, extras, { theme: 'royal' }), 'write by ' + who);
  await denied(get(null, P('site', 'other')), 'other site doc is private');
  await allowed(set('owner-a', P('site', 'main'), { name: 'ABCD School' }), 'main still works');
  await denied(set('owner-a', P('site', 'main'), { name: 'ABCD School', theme: 'royal' }), 'theme does not belong in main');
});

test('admission enquiries carry the custom answers and the longer pipeline', async () => {
  const enquiry = { studentName: 'Asha', classApplying: 'Class 5', guardianName: 'Ravi', phone: '98300 12345', createdAt: '2026-11-18', status: 'new' };
  await allowed(set(null, P('enquiries', 'EQ-1'), { ...enquiry, a1: 'Green Valley School', a2: 'O+' }), 'public sends answers');
  await denied(set(null, P('enquiries', 'EQ-2'), { ...enquiry, a7: 'x' }), 'a7 does not exist');
  await denied(set(null, P('enquiries', 'EQ-3'), { ...enquiry, a1: 'x'.repeat(201) }), 'long answer');
  await denied(set(null, P('enquiries', 'EQ-4'), { ...enquiry, a1: 5 }), 'answer must be text');
  await denied(set(null, P('enquiries', 'EQ-5'), { ...enquiry, status: 'interview' }), 'cannot start past new');
  for (const status of ['contacted', 'interview', 'offered', 'admitted', 'rejected']) {
    await allowed(set('owner-a', P('enquiries', 'EQ-1'), { ...enquiry, a1: 'Green Valley School', a2: 'O+', status }), 'move to ' + status);
  }
  await denied(set('owner-a', P('enquiries', 'EQ-1'), { ...enquiry, a1: 'Changed', a2: 'O+', status: 'admitted' }), 'owner cannot change answers');
  await denied(set('owner-a', P('enquiries', 'EQ-1'), { ...enquiry, a1: 'Green Valley School', a2: 'O+', status: 'waiting' }), 'bad status');
  await allowed(get('owner-a', P('enquiries', 'EQ-1')), 'owner reads');
  await denied(get(null, P('enquiries', 'EQ-1')), 'public cannot read');
});

const prefs = { workingDays: '123456', startTime: '08:30', endTime: '14:30', lowAttendance: 75 };

test('school settings: the owner sets them, staff read them', async () => {
  const path = P('settings', 'preferences');
  await allowed(set('owner-a', path, prefs), 'owner saves');
  await allowed(set('owner-a', path, { ...prefs, terms: 'Term 1, Term 2, Term 3' }), 'with terms');
  await allowed(get('prin', path), 'principal reads');
  await allowed(get('t1', path), 'teacher reads');
  await denied(get('owner-b', path), 'other school reads');
  await denied(get(null, path), 'public reads');
  for (const bad of [{ ...prefs, workingDays: '8' }, { ...prefs, workingDays: '' }, { ...prefs, workingDays: '12345678' }, { ...prefs, startTime: '8:30' },
    { ...prefs, endTime: '25:00' }, { ...prefs, startTime: '15:00' }, { ...prefs, lowAttendance: 0 }, { ...prefs, lowAttendance: 101 },
    { ...prefs, lowAttendance: 75.5 }, { ...prefs, extra: 1 }, { workingDays: '12345', startTime: '08:00', endTime: '14:00' }]) {
    await denied(set('owner-a', path, bad), JSON.stringify(bad).slice(0, 50));
  }
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, path, prefs), 'write by ' + who);
});

test('launch checklist ticks are kept by the owner', async () => {
  const path = P('settings', 'launch');
  await allowed(set('owner-a', path, { m1: true, m2: false, m8: true }), 'owner ticks');
  await allowed(get('owner-a', path), 'owner reads');
  await allowed(get('prin', path), 'principal reads');
  await denied(get('t1', path), 'teacher reads');
  await denied(set('owner-a', path, { m9: true }), 'unknown tick');
  await denied(set('owner-a', path, { m1: 'yes' }), 'not a boolean');
  for (const who of ['prin', 't1', 'owner-b', null]) await denied(set(who, path, { m1: true }), 'write by ' + who);
});
