// Firestore rules tests for message moderation. Synthetic records only.
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

const msg = (over = {}) => ({ studentId: 's1', subject: 'Question', body: 'When is the fee due?', createdAt: '2026-11-18', createdBy: 'fam1', ...over });
const path = (id = 'MSG-1') => `${A}/messages/${id}`;

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/fam1`, { role: 'parent', active: true }],
    [`${A}/students/s1`, { admissionNo: 's1', name: 'Test Student', guardianName: 'G', guardianPhone: '', status: 'active' }],
    [`${A}/familyAccess/fam1`, { active: true, studentId: 's1' }],
  ];
  for (const [p, data] of seed) assert.equal(await set(ADMIN, p, data), 200, p);
});

test('moderation: the owner can flag or hide a message and restore it', async () => {
  await allowed(set('fam1', path(), msg()), 'parent sends');
  await allowed(set('owner-a', path(), msg({ mod: 'flagged', modNote: 'Rude language' })), 'owner flags an unanswered message');
  await allowed(set('owner-a', path(), msg({ mod: 'hidden', modNote: 'Rude language' })), 'owner hides');
  await allowed(set('owner-a', path(), msg({ mod: 'hidden', modNote: 'Rude language', reply: 'Please be polite.', repliedAt: '2026-11-18' })), 'reply and moderation together');
  await allowed(set('owner-a', path(), msg({ reply: 'Please be polite.', repliedAt: '2026-11-18' })), 'owner restores (mod removed)');
  await allowed(set('owner-a', path(), msg({ reply: 'Please be polite.', repliedAt: '2026-11-19' })), 'plain reply still works');
});

test('moderation: only the owner moderates, and nothing else about the message can change', async () => {
  await allowed(set('fam1', path(), msg()), 'parent sends');
  await denied(set('fam1', path(), msg({ mod: 'hidden' })), 'parent cannot moderate');
  await denied(set('prin', path(), msg({ mod: 'hidden' })), 'principal cannot moderate');
  await denied(set('owner-a', path(), msg({ mod: 'deleted' })), 'unknown status');
  await denied(set('owner-a', path(), msg({ mod: 'hidden', modNote: 'x'.repeat(201) })), 'long note');
  await denied(set('owner-a', path(), msg({ mod: 'hidden', body: 'Edited text' })), 'cannot edit the parent\'s words');
  await denied(set('owner-a', path(), msg({ mod: 'hidden', subject: 'Changed' })), 'cannot edit the subject');
  await denied(set('fam1', path('MSG-2'), msg({ mod: 'flagged' })), 'parent cannot create a flagged message');
  await denied(set('fam1', path('MSG-3'), msg({ modNote: 'self' })), 'parent cannot add a note');
  await allowed(get('fam1', path()), 'parent reads own message');
});
