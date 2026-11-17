// Firestore rules tests for website.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/website.rules.test.mjs"
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

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/unlinked`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/s1`, student('Asha', 'A1')],
    [`${A}/students/s2`, student('Ravi', 'A2')],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [P('calendar', 'ev-1'), { title: 'Sports Day', date: day(10), kind: 'event' }],
    [P('site', 'main'), { name: 'ABCD School', tagline: 'Learn and grow' }],
    [P('site', 'other'), { name: 'Hidden' }],
    [P('enquiries', 'EQ-1'), { studentName: 'Kiran', classApplying: 'Class 5', guardianName: 'Mr Sen', phone: '98300 11111', createdAt: TODAY, status: 'new' }],
    [P('eventRegistrations', 'ev-1_s1'), { eventId: 'ev-1', eventTitle: 'Sports Day', studentId: 's1', registeredOn: TODAY, createdBy: 'parent-1' }],
    [P('eventRegistrations', 'ev-1_s2'), { eventId: 'ev-1', eventTitle: 'Sports Day', studentId: 's2', registeredOn: TODAY, createdBy: 'parent-2' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('public website text: anyone reads main, only the owner edits', async () => {
  const site = (over = {}) => ({ name: 'ABCD School', tagline: 'Learn and grow', about: 'A school.', phone: '98300 00000', ...over });
  for (const who of [null, 'parent-1', 't1', 'owner-b']) await allowed(get(who, P('site', 'main')), 'public read ' + who);
  await denied(get(null, P('site', 'other')), 'only main is public');
  await denied(query(null, A, 'site', [['name', 'ABCD School']]), 'no public listing');
  await allowed(set('owner-a', P('site', 'main'), site()), 'owner saves');
  await allowed(set('owner-a', P('site', 'main'), site({ mapUrl: 'https://www.google.com/maps/embed?pb=!1m18' })), 'map embed');
  await allowed(set('owner-a', P('site', 'main'), site({ mapUrl: '' })), 'no map');
  await denied(set('owner-a', P('site', 'main'), site({ mapUrl: 'https://evil.example/maps/embed?x' })), 'other map host');
  await denied(set('owner-a', P('site', 'main'), site({ mapUrl: 'javascript:alert(1)' })), 'script url');
  await denied(set('owner-a', P('site', 'main'), site({ name: '' })), 'blank name');
  await denied(set('owner-a', P('site', 'main'), site({ about: 'x'.repeat(2001) })), 'too long');
  await denied(set('owner-a', P('site', 'main'), { ...site(), secret: 'x' }), 'extra field');
  await denied(set('owner-a', P('site', 'page2'), site()), 'only main');
  for (const who of [null, 'parent-1', 't1', 'owner-b']) {
    await denied(set(who, P('site', 'main'), site()), 'write by ' + who);
    await denied(remove(who, P('site', 'main')), 'remove by ' + who);
  }
});

test('enquiries: anyone sends, only the owner reads and moves them along', async () => {
  const enquiry = (over = {}) => ({ studentName: 'Mina', classApplying: 'Class 3', guardianName: 'Mrs Das', phone: '+91 98300 22222', createdAt: TODAY, status: 'new', ...over });
  await allowed(set(null, P('enquiries', 'EQ-new'), enquiry()), 'public send');
  await allowed(set(null, P('enquiries', 'EQ-new2'), enquiry({ email: 'a@b.in', message: 'Seat available?' })), 'with details');
  await allowed(set('parent-1', P('enquiries', 'EQ-new3'), enquiry()), 'signed in sender');
  await denied(set(null, P('enquiries', 'EQ-b1'), enquiry({ status: 'admitted' })), 'cannot pick status');
  await denied(set(null, P('enquiries', 'EQ-b2'), enquiry({ note: 'hello' })), 'cannot add note');
  await denied(set(null, P('enquiries', 'EQ-b3'), enquiry({ phone: 'abc' })), 'bad phone');
  await denied(set(null, P('enquiries', 'EQ-b4'), enquiry({ studentName: '  ' })), 'blank name');
  await denied(set(null, P('enquiries', 'EQ-b5'), enquiry({ message: 'x'.repeat(501) })), 'long message');
  await denied(set(null, P('enquiries', 'EQ-b6'), { ...enquiry(), extra: 'x' }), 'extra field');
  await denied(set(null, P('enquiries', 'bad id'), enquiry()), 'bad id');
  await denied(set(null, P('enquiries', 'x-1'), enquiry()), 'id must start EQ-');
  await denied(set(null, P('enquiries', 'EQ-1'), enquiry({ status: 'contacted' })), 'public cannot change');
  await denied(remove(null, P('enquiries', 'EQ-1')), 'public cannot remove');
  for (const who of [null, 'parent-1', 't1', 'owner-b']) await denied(get(who, P('enquiries', 'EQ-1')), 'read by ' + who);
  await denied(query(null, A, 'enquiries', [['status', 'new']]), 'public list');
  const old = { studentName: 'Kiran', classApplying: 'Class 5', guardianName: 'Mr Sen', phone: '98300 11111', createdAt: TODAY };
  await allowed(get('owner-a', P('enquiries', 'EQ-1')), 'owner reads');
  await allowed(set('owner-a', P('enquiries', 'EQ-1'), { ...old, status: 'contacted' }), 'contacted');
  await allowed(set('owner-a', P('enquiries', 'EQ-1'), { ...old, status: 'admitted', note: 'Fees paid' }), 'admitted with note');
  await denied(set('owner-a', P('enquiries', 'EQ-1'), { ...old, status: 'maybe' }), 'bad status');
  await denied(set('owner-a', P('enquiries', 'EQ-1'), { ...old, studentName: 'Changed', status: 'contacted' }), 'owner rewrites details');
  await allowed(remove('owner-a', P('enquiries', 'EQ-1')), 'owner removes');
});

test('event registration: a family registers its own student only', async () => {
  const reg = (over = {}) => ({ eventId: 'ev-1', eventTitle: 'Sports Day', studentId: 's1', registeredOn: TODAY, createdBy: 'parent-1', ...over });
  await remove('owner-a', P('eventRegistrations', 'ev-1_s1'));
  await allowed(set('parent-1', P('eventRegistrations', 'ev-1_s1'), reg()), 'register');
  await denied(set('parent-1', P('eventRegistrations', 'ev-1_s2'), reg({ studentId: 's2' })), 'other student');
  await denied(set('parent-1', P('eventRegistrations', 'wrong-id'), reg()), 'id must match');
  await denied(set('parent-1', P('eventRegistrations', 'ev-9_s1'), reg({ eventId: 'ev-9' })), 'no such event');
  await denied(set('parent-1', P('eventRegistrations', 'ev-1_s1'), reg({ createdBy: 'parent-2' })), 'wrong creator');
  await denied(set('parent-1', P('eventRegistrations', 'ev-1_s1'), { ...reg(), extra: 'x' }), 'extra field');
  for (const who of ['unlinked', 't1', 'owner-b', null]) await denied(set(who, P('eventRegistrations', 'ev-1_s1'), reg({ createdBy: who ?? 'x' })), 'write by ' + who);
  await allowed(get('parent-1', P('eventRegistrations', 'ev-1_s1')), 'own');
  await denied(get('parent-1', P('eventRegistrations', 'ev-1_s2')), 'other family');
  await denied(get('t1', P('eventRegistrations', 'ev-1_s1')), 'teacher');
  await denied(get(null, P('eventRegistrations', 'ev-1_s1')), 'anonymous');
  await allowed(query('parent-1', A, 'eventRegistrations', [['studentId', 's1']]), 'own list');
  await denied(query('parent-1', A, 'eventRegistrations', [['studentId', 's2']]), 'other list');
  await allowed(get('owner-a', P('eventRegistrations', 'ev-1_s2')), 'owner reads all');
  await denied(remove('parent-1', P('eventRegistrations', 'ev-1_s2')), 'cancel for another family');
  await allowed(remove('parent-1', P('eventRegistrations', 'ev-1_s1')), 'cancel own');
  await allowed(remove('owner-a', P('eventRegistrations', 'ev-1_s2')), 'owner removes');
});
