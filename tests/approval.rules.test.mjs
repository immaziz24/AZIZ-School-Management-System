// Firestore rules tests for principal exam approval. Synthetic records only.
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

const Y = 'y1';
const EX = P('exams', 'y1_class-8_sub-1_t1');
const exam = (status, extra = {}) => ({ yearId: Y, classId: 'class-8', subjectId: 'sub-1', examKey: 't1', name: 'Term 1', maxMarks: 100, status, ...extra });
beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/prin-off`, { role: 'principal', active: false }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${B}/members/prin-b`, { role: 'principal', active: true }],
    [`${A}/academicYears/${Y}`, { label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [EX, exam('locked')],
    [P('exams', 'y1_class-8_sub-1_t2'), { ...exam('open'), examKey: 't2' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('principal approves a locked exam', async () => {
  await allowed(set('prin', EX, exam('approved', { approvedBy: 'prin' })), 'approve');
});
test('principal cannot do anything else to exams', async () => {
  await denied(set('prin', EX, exam('open')), 'unlock');
  await denied(set('prin', EX, exam('approved', { approvedBy: 'owner-a' })), 'approvedBy must be self');
  await denied(set('prin', EX, exam('approved', { approvedBy: 'prin', published: true })), 'publish');
  await denied(set('prin', EX, { ...exam('approved', { approvedBy: 'prin' }), maxMarks: 50 }), 'change marks');
  await denied(set('prin', P('exams', 'y1_class-8_sub-1_t2'), { ...exam('approved', { approvedBy: 'prin' }), examKey: 't2' }), 'approve open exam');
  await denied(set('prin', P('exams', 'y1_class-8_sub-1_t3'), { ...exam('open'), examKey: 't3' }), 'create');
  await denied(remove('prin', EX), 'delete');
});
test('others cannot approve like a principal', async () => {
  for (const who of ['prin-off', 'prin-b', 't1', null]) {
    await denied(set(who, EX, exam('approved', { approvedBy: who || 'x' })), 'approve by ' + who);
  }
});
test('owner approval still works', async () => {
  await allowed(set('owner-a', EX, exam('approved', { approvedBy: 'owner-a' })), 'owner approve');
});
