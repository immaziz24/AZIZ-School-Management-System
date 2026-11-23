// Firestore rules tests for batch 65: online test progress (one question at a time, pause and resume, time left).
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

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/familyAccess/parent-1`, { active: true, studentId: 's1' }],
    [`${A}/familyAccess/parent-2`, { active: true, studentId: 's2' }],
    [`${A}/students/s1`, { name: 'Asha Rao' }],
    [`${A}/students/s2`, { name: 'Bimal Das' }],
    [`${A}/notices/N-1`, { audience: 'all', title: 'Holiday', body: 'Closed Monday', createdAt: '2026-11-20', createdBy: 'owner-a' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const book = (extra = {}) => ({ title: 'Wings of Fire', fileName: 'wings.pdf', sizeKb: 4000, uploadedOn: '2026-11-23', by: 'owner-a', ...extra });
const E = (id = 'EB-1') => `${A}/eBooks/${id}`;
const ack = (extra = {}) => ({ noticeId: 'N-1', studentId: 's1', studentName: 'Asha Rao', by: 'parent-1', on: '2026-11-23', ...extra });
const K = (id = 'N-1_s1') => `${A}/noticeAcks/${id}`;

test('e-library: only the owner adds, with valid details', async () => {
  await allowed(set('owner-a', E(), book({ author: 'A. P. J. Abdul Kalam', subject: 'Biography' })), 'owner adds');
  for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) await denied(set(who, E('EB-2'), book()), 'add by ' + who);
  await denied(set('owner-a', E('bad id'), book()), 'bad id');
  await denied(set('owner-a', E('EB-3'), book({ sizeKb: 20481 })), 'over 20 MB');
  await denied(set('owner-a', E('EB-3'), book({ sizeKb: 0 })), 'empty');
  await denied(set('owner-a', E('EB-3'), book({ title: '' })), 'no title');
  await denied(set('owner-a', E('EB-3'), book({ extra: 'x' })), 'unknown field');
});

test('e-library: owner, principal, teachers and families read; strangers do not; owner edits text and deletes', async () => {
  await allowed(set('owner-a', E(), book()), 'add');
  for (const who of ['owner-a', 'prin', 't1', 'parent-1', 'parent-2']) await allowed(get(who, E()), 'read by ' + who);
  for (const who of ['owner-b', null]) await denied(get(who, E()), 'read by ' + who);
  await allowed(set('owner-a', E(), book({ title: 'Wings of Fire (2nd copy)' })), 'owner edits title');
  await denied(set('owner-a', E(), book({ sizeKb: 5 })), 'size is fixed');
  await denied(remove('parent-1', E()), 'family cannot delete');
  await allowed(remove('owner-a', E()), 'owner deletes');
});

test('e-library: new uploads are refused when the plan storage is full', async () => {
  await allowed(set(ADMIN, `${A}/billing/main`, { status: 'active', storageMb: 10 }), 'plan');
  await allowed(set(ADMIN, `${A}/usage/main`, { storageMb: 10 }), 'usage full');
  await denied(set('owner-a', E('EB-9'), book()), 'full');
});

test('notice acknowledgements: a family confirms for its own student once; the school reads them', async () => {
  await allowed(set('parent-1', K(), ack()), 'family confirms');
  await denied(set('parent-1', K(), ack({ studentName: 'Changed' })), 'cannot change a confirmation');
  await denied(set('parent-2', K('N-1_s1'), ack({ by: 'parent-2' })), "another family's student");
  await denied(set('parent-1', K('N-1_s2'), ack({ studentId: 's2' })), 'not own student');
  await denied(set('parent-1', K('N-1_s1x'), ack()), 'document id must be notice_student');
  await denied(set('parent-1', K('N-9_s1'), ack({ noticeId: 'N-9' })), 'notice must exist');
  await denied(set('parent-1', K('N-1_s1'), ack({ by: 'parent-2' })), 'by must be the signed-in user');
  for (const who of ['owner-a', 't1', null]) await denied(set(who, K('N-1_s1'), ack({ by: who ?? 'x' })), 'write by ' + who);
  await allowed(get('owner-a', K()), 'owner reads');
  await allowed(get('prin', K()), 'principal reads');
  await allowed(get('parent-1', K()), 'family reads own');
  await denied(get('parent-2', K()), "another family's confirmation");
  await denied(remove('parent-1', K()), 'no delete');
});
