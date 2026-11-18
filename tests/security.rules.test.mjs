// Firestore rules tests for the backup log. Synthetic records only.
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

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  for (const [p, data] of [[`${A}/members/owner-a`, { role: 'owner', active: true }], [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }]]) assert.equal(await set(ADMIN, p, data), 200, p);
});

test('backup log: the owner records the last backup; others read at most', async () => {
  await allowed(set('owner-a', `${A}/settings/backupLog`, { lastAt: day(0), kind: 'full' }), 'owner records');
  await allowed(set('owner-a', `${A}/settings/backupLog`, { lastAt: day(0), kind: 'zip' }), 'owner records again');
  await allowed(get('owner-a', `${A}/settings/backupLog`), 'owner reads');
  await allowed(get('prin', `${A}/settings/backupLog`), 'principal reads');
  await denied(set('owner-a', `${A}/settings/backupLog`, { lastAt: 'yesterday', kind: 'full' }), 'bad date');
  await denied(set('owner-a', `${A}/settings/backupLog`, { lastAt: day(0), kind: 'cloud' }), 'bad kind');
  await denied(set('owner-a', `${A}/settings/backupLog`, { lastAt: day(0), kind: 'full', extra: 1 }), 'extra field');
  await denied(set('owner-a', `${A}/settings/backupLog`, { lastAt: day(0) }), 'missing kind');
  await denied(set('prin', `${A}/settings/backupLog`, { lastAt: day(0), kind: 'full' }), 'principal cannot write');
  await denied(set('t1', `${A}/settings/backupLog`, { lastAt: day(0), kind: 'full' }), 'teacher cannot write');
  await denied(get('t1', `${A}/settings/backupLog`), 'teacher cannot read');
  await denied(get(null, `${A}/settings/backupLog`), 'anonymous cannot read');
});

test('storage quota: a new storage record is refused once the plan storage is used up', async () => {
  const rec = (over = {}) => ({ name: 'Photos', kind: 'photo', sizeKb: 500, date: day(0), ...over });
  await set(ADMIN, `${A}/billing/main`, { plan: 'basic', status: 'active', storageMb: 100 });
  await set(ADMIN, `${A}/usage/main`, { students: 1, staff: 1, storageMb: 40 });
  await allowed(set('owner-a', `${A}/storageRecords/ST-1`, rec()), 'under the limit');
  await set(ADMIN, `${A}/usage/main`, { students: 1, staff: 1, storageMb: 100 });
  await denied(set('owner-a', `${A}/storageRecords/ST-2`, rec()), 'at the limit');
  await allowed(set('owner-a', `${A}/storageRecords/ST-1`, rec({ sizeKb: 400 })), 'editing an existing record is still allowed');
  await allowed(remove('owner-a', `${A}/storageRecords/ST-1`), 'removing frees space');
  await set(ADMIN, `${A}/billing/main`, { plan: 'basic', status: 'active' });
  await allowed(set('owner-a', `${A}/storageRecords/ST-3`, rec()), 'no storage limit set');
});

test('concessions: a family reads only its own student\'s concessions', async () => {
  const con = (id) => ({ studentId: id, studentName: 'Test ' + id, kind: 'Scholarship', amount: 500, givenOn: day(0) });
  await set(ADMIN, `${A}/members/parent-1`, { role: 'parent', active: true });
  await set(ADMIN, `${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true });
  await set(ADMIN, `${A}/concessions/c1`, con('s1'));
  await set(ADMIN, `${A}/concessions/c2`, con('s2'));
  await allowed(get('parent-1', `${A}/concessions/c1`), 'own child');
  await denied(get('parent-1', `${A}/concessions/c2`), 'another child');
  await allowed(query('parent-1', A, 'concessions', [['studentId', 's1']]), 'own list');
  await denied(query('parent-1', A, 'concessions', [['studentId', 's2']]), 'other list');
  await denied(query('parent-1', A, 'concessions', []), 'unfiltered list');
  await denied(set('parent-1', `${A}/concessions/c9`, con('s1')), 'family cannot write');
  await allowed(get('owner-a', `${A}/concessions/c2`), 'owner reads all');
});
