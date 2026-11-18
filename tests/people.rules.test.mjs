// Firestore rules tests for photos, logo and student history. Synthetic records only.
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

const jpeg = (n = 100) => 'data:image/jpeg;base64,' + 'A'.repeat(n);
const student = { admissionNo: 'S1', name: 'Asha', guardianName: 'Ravi', guardianPhone: '98300 00000', status: 'active' };

async function seedStudent() {
  assert.equal(await set(ADMIN, P('students', 's1'), student), 200);
  assert.equal(await set(ADMIN, P('students', 's2'), { ...student, admissionNo: 'S2' }), 200);
  assert.equal(await set(ADMIN, P('familyAccess', 'fam1'), { active: true, studentId: 's1' }), 200);
}

test('student photos: owner writes, the owner, principal and own family read', async () => {
  await seedStudent();
  await allowed(set('owner-a', P('studentPhotos', 's1'), { photo: jpeg() }), 'owner saves');
  await allowed(set('owner-a', P('studentPhotos', 's1'), { photo: jpeg(39000) }), 'larger photo');
  await allowed(get('owner-a', P('studentPhotos', 's1')), 'owner reads');
  await allowed(get('prin', P('studentPhotos', 's1')), 'principal reads');
  await allowed(get('fam1', P('studentPhotos', 's1')), 'own family reads');
  await allowed(query('owner-a', A, 'studentPhotos', []), 'owner lists');
  await allowed(set('owner-a', P('studentPhotos', 's2'), { photo: jpeg() }), 'second student');
  await denied(get('fam1', P('studentPhotos', 's2')), 'other child');
  await denied(get('t1', P('studentPhotos', 's1')), 'teacher');
  await denied(get('owner-b', P('studentPhotos', 's1')), 'other school');
  await denied(get(null, P('studentPhotos', 's1')), 'public');
  await denied(query('fam1', A, 'studentPhotos', []), 'family cannot list');
  for (const bad of [{ photo: 'data:image/png;base64,AAAA' }, { photo: 'http://x.example/a.jpg' }, { photo: jpeg(40000) }, { photo: 'data:image/jpeg;base64,' },
    { photo: jpeg(), extra: 'x' }, { photo: 5 }, { photo: 'data:image/jpeg;base64,<script>' }]) {
    await denied(set('owner-a', P('studentPhotos', 's1'), bad), JSON.stringify(bad).slice(0, 50));
  }
  await denied(set('owner-a', P('studentPhotos', 'nobody'), { photo: jpeg() }), 'student must exist');
  for (const who of ['prin', 't1', 'fam1', null]) await denied(set(who, P('studentPhotos', 's1'), { photo: jpeg() }), 'write by ' + who);
  await allowed(remove('owner-a', P('studentPhotos', 's1')), 'owner removes');
});

test('school logo: owner writes; staff and families read', async () => {
  await seedStudent();
  const path = P('settings', 'branding');
  await allowed(set('owner-a', path, { logo: jpeg() }), 'owner saves');
  for (const who of ['owner-a', 'prin', 't1', 'fam1']) await allowed(get(who, path), 'read by ' + who);
  await denied(get('owner-b', path), 'other school owner');
  await denied(get(null, path), 'public');
  await denied(set('owner-a', path, { logo: 'data:image/gif;base64,AAAA' }), 'not a jpeg');
  await denied(set('owner-a', path, { logo: jpeg(40000) }), 'too large');
  await denied(set('owner-a', path, {}), 'empty');
  for (const who of ['prin', 't1', 'fam1', 'owner-b']) await denied(set(who, path, { logo: jpeg() }), 'write by ' + who);
});

test('student history: the owner adds entries; nobody edits or removes them', async () => {
  const entry = { studentId: 's1', at: '2026-11-18T08:30:00.000Z', by: 'owner-a', summary: 'guardianPhone: 98300 00000 -> 98300 11111' };
  await allowed(set('owner-a', P('studentHistory', 'SH-1'), entry), 'owner adds');
  await allowed(get('owner-a', P('studentHistory', 'SH-1')), 'owner reads');
  await allowed(get('prin', P('studentHistory', 'SH-1')), 'principal reads');
  await allowed(query('owner-a', A, 'studentHistory', [['studentId', 's1']]), 'owner queries one student');
  await denied(get('t1', P('studentHistory', 'SH-1')), 'teacher');
  await denied(get(null, P('studentHistory', 'SH-1')), 'public');
  await denied(set('owner-a', P('studentHistory', 'SH-1'), { ...entry, summary: 'changed' }), 'cannot edit');
  await denied(remove('owner-a', P('studentHistory', 'SH-1')), 'cannot remove');
  await denied(set('owner-a', P('studentHistory', 'SH-2'), { ...entry, by: 'someone-else' }), 'by must be the writer');
  for (const bad of [{ ...entry, summary: '' }, { ...entry, summary: 'x'.repeat(501) }, { ...entry, at: 'yesterday' }, { ...entry, studentId: 'BAD ID' }, { ...entry, extra: 1 }]) {
    await denied(set('owner-a', P('studentHistory', 'SH-3'), bad), JSON.stringify(bad).slice(0, 50));
  }
  await denied(set('owner-a', P('studentHistory', 'bad'), entry), 'bad id');
  await denied(set('prin', P('studentHistory', 'SH-4'), { ...entry, by: 'prin' }), 'principal cannot write');
});
