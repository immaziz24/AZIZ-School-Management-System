// Firestore rules tests for concessions, achievements, complaints, assets. Synthetic records only.
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
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
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
  const where = filters.length === 1 ? fieldFilter(filters[0])
    : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
  const response = await fetch(`${base}/${parent}:runQuery`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where } }),
  });
  await response.arrayBuffer();
  return response.status;
};

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const student = (name, no) => ({ admissionNo: no, name, guardianName: 'Parent', guardianPhone: '', status: 'active' });
const P = (collection, id, school = A) => `${school}/${collection}/${id}`;
const OUTSIDERS = ['parent-1', 'owner-b', null];

const D = '2026-11-17';
const GOOD = {
  concessions: { studentId: 's1', studentName: 'Asha', kind: 'Scholarship', amount: 5000, givenOn: D },
  achievements: { studentId: 's1', studentName: 'Asha', title: 'Won quiz', level: 'District', date: D },
  complaints: { title: 'Noisy bus', raisedBy: 'A parent', date: D, status: 'open' },
  assets: { name: 'Projector', place: 'Room 4', cost: 40000, condition: 'Good' },
};
const BAD = {
  concessions: [{ ...GOOD.concessions, amount: 0 }, { ...GOOD.concessions, kind: 'Free' }, { ...GOOD.concessions, studentId: 'nobody' },
    { ...GOOD.concessions, givenOn: 'x' }, { ...GOOD.concessions, extra: 1 }],
  achievements: [{ ...GOOD.achievements, level: 'Galaxy' }, { ...GOOD.achievements, title: ' ' }, { ...GOOD.achievements, studentId: 'nobody' },
    { ...GOOD.achievements, date: 'x' }],
  complaints: [{ ...GOOD.complaints, status: 'closed' }, { ...GOOD.complaints, title: '' }, { ...GOOD.complaints, raisedBy: '' },
    { ...GOOD.complaints, date: 'x' }],
  assets: [{ ...GOOD.assets, cost: -1 }, { ...GOOD.assets, condition: 'Awful' }, { ...GOOD.assets, place: '' }, { ...GOOD.assets, boughtOn: 'x' }],
};
beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/s1`, { admissionNo: 'A1', name: 'Asha', guardianName: 'P', guardianPhone: '', status: 'active' }],
    ...Object.entries(GOOD).map(([collection, data]) => [P(collection, 'S-1'), data]),
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

for (const [collection, good] of Object.entries(GOOD)) {
  test(collection + ': owner writes valid records only; principal reads; others locked out', async () => {
    await allowed(set('owner-a', P(collection, 'S-2'), good), 'create');
    await allowed(set('owner-a', P(collection, 'S-1'), good), 'update');
    await allowed(get('prin', P(collection, 'S-1')), 'principal reads');
    for (const bad of BAD[collection]) await denied(set('owner-a', P(collection, 'S-3'), bad), 'invalid ' + JSON.stringify(bad).slice(0, 70));
    await denied(set('owner-a', P(collection, 'bad.id'), good), 'bad id');
    for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) {
      await denied(set(who, P(collection, 'S-4'), good), 'write by ' + who);
      await denied(remove(who, P(collection, 'S-1')), 'delete by ' + who);
    }
    for (const who of ['t1', 'parent-1', 'owner-b', null]) await denied(get(who, P(collection, 'S-1')), 'read by ' + who);
    await allowed(remove('owner-a', P(collection, 'S-1')), 'owner deletes');
  });
}
