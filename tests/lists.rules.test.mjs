// Firestore rules tests for expenses, certificates and tickets. Synthetic records only.
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
const expense = { date: D, category: 'Electricity', amount: 4500 };
const cert = { type: 'Bonafide', studentId: 's1', studentName: 'Asha', issuedOn: D };
const ticket = { title: 'Fan broken', priority: 'normal', status: 'open', createdOn: D };
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
    [P('expenses', 'EX-1'), expense],
    [P('certificates', 'BO-1'), cert],
    [P('tickets', 'TK-1'), ticket],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('expenses: owner writes valid, others cannot, principal reads', async () => {
  await allowed(set('owner-a', P('expenses', 'EX-2'), { ...expense, note: 'Bill' }), 'create');
  await allowed(set('owner-a', P('expenses', 'EX-1'), { ...expense, amount: 5000 }), 'update');
  await allowed(get('prin', P('expenses', 'EX-1')), 'principal reads');
  await allowed(remove('owner-a', P('expenses', 'EX-1')), 'delete');
  for (const bad of [{ ...expense, amount: 0 }, { ...expense, amount: 1.5 }, { ...expense, date: 'today' },
    { ...expense, category: '  ' }, { ...expense, extra: 'x' }, { date: D, category: 'x' }]) {
    await denied(set('owner-a', P('expenses', 'EX-3'), bad), 'invalid ' + JSON.stringify(bad));
  }
  for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) {
    await denied(set(who, P('expenses', 'EX-4'), expense), 'write by ' + who);
    await denied(remove(who, P('expenses', 'EX-1')), 'delete by ' + who);
  }
  for (const who of ['t1', 'parent-1', 'owner-b', null]) await denied(get(who, P('expenses', 'EX-1')), 'read by ' + who);
});

test('certificates: owner creates once, no edits', async () => {
  await allowed(set('owner-a', P('certificates', 'TR-1'), { ...cert, type: 'Transfer', purpose: 'Moving' }), 'create');
  await denied(set('owner-a', P('certificates', 'BO-1'), { ...cert, purpose: 'edit' }), 'edit');
  await denied(set('owner-a', P('certificates', 'TR-2'), { ...cert, studentId: 'nobody' }), 'unknown student');
  await denied(set('owner-a', P('certificates', 'TR-3'), { ...cert, type: 'Fake' }), 'bad type');
  await denied(set('owner-a', P('certificates', 'TR-4'), { ...cert, issuedOn: 'x' }), 'bad date');
  await allowed(get('prin', P('certificates', 'BO-1')), 'principal reads');
  for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) {
    await denied(set(who, P('certificates', 'TR-5'), cert), 'write by ' + who);
    await denied(remove(who, P('certificates', 'BO-1')), 'delete by ' + who);
    if (who !== 'prin') await denied(get(who, P('certificates', 'BO-1')), 'read by ' + who);
  }
  await allowed(remove('owner-a', P('certificates', 'BO-1')), 'owner removes');
});

test('tickets: owner writes and marks done, others cannot', async () => {
  await allowed(set('owner-a', P('tickets', 'TK-2'), { ...ticket, place: 'Room 4', priority: 'high' }), 'create');
  await allowed(set('owner-a', P('tickets', 'TK-1'), { ...ticket, status: 'done' }), 'mark done');
  await denied(set('owner-a', P('tickets', 'TK-3'), { ...ticket, status: 'closed' }), 'bad status');
  await denied(set('owner-a', P('tickets', 'TK-3'), { ...ticket, priority: 'urgent' }), 'bad priority');
  await denied(set('owner-a', P('tickets', 'TK-3'), { ...ticket, title: '' }), 'empty title');
  await allowed(get('prin', P('tickets', 'TK-1')), 'principal reads');
  for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) {
    await denied(set(who, P('tickets', 'TK-6'), ticket), 'write by ' + who);
    await denied(remove(who, P('tickets', 'TK-1')), 'delete by ' + who);
  }
  await allowed(remove('owner-a', P('tickets', 'TK-1')), 'owner deletes');
});
