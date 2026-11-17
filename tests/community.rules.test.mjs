// Firestore rules tests for community.
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/community.rules.test.mjs"
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
    [`${A}/members/t-off`, { role: 'teacher', active: false }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${A}/members/unlinked`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/students/s1`, student('Asha', 'A1')],
    [`${A}/students/s2`, student('Ravi', 'A2')],
    [`${A}/classes/class-8`, { name: 'Class 8', order: 8 }],
    [`${A}/classes/class-9`, { name: 'Class 9', order: 9 }],
    [`${A}/settings/academic`, { activeYearId: 'y1', lastAttendanceDate: TODAY }],
    [`${A}/academicYears/y1`, { label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', status: 'active' }],
    [`${A}/enrollments/y1_s1`, { yearId: 'y1', studentId: 's1', classId: 'class-8', sectionId: 'sec-8a', rollNo: 1 }],
    [`${A}/enrollments/y1_s2`, { yearId: 'y1', studentId: 's2', classId: 'class-9', sectionId: 'sec-9a', rollNo: 1 }],
    [`${A}/familyAccess/parent-1`, { studentId: 's1', relation: 'parent', active: true }],
    [`${A}/familyAccess/parent-2`, { studentId: 's2', relation: 'parent', active: true }],
    [P('ptmSlots', 'p-8'), { classId: 'class-8', date: day(5), time: '10:30' }],
    [P('ptmSlots', 'p-9'), { classId: 'class-9', date: day(5), time: '11:00' }],
    [P('payroll', 't1_2026-11'), { staffUid: 't1', month: '2026-11', basic: 30000, allowances: 2000, deductions: 500 }],
    [P('messages', 'm-1'), { studentId: 's1', subject: 'Fees', body: 'Question about fees.', createdAt: TODAY, createdBy: 'parent-1' }],
    [P('messages', 'm-2'), { studentId: 's2', subject: 'Bus', body: 'Bus timing?', createdAt: TODAY, createdBy: 'parent-2' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('parent-teacher meetings: owner schedules, teachers and the right class read', async () => {
  const slot = (over = {}) => ({ classId: 'class-8', date: day(7), time: '09:15', ...over });
  await allowed(set('owner-a', P('ptmSlots', 'p-new'), slot()), 'schedule');
  await allowed(set('owner-a', P('ptmSlots', 'p-new2'), slot({ teacher: 'Mr Roy', place: 'Room 4', note: 'Bring report card' })), 'details');
  await allowed(set('owner-a', P('ptmSlots', 'p-new'), slot({ time: '10:00' })), 'change');
  await denied(set('owner-a', P('ptmSlots', 'p-bad1'), slot({ time: '25:00' })), 'bad time');
  await denied(set('owner-a', P('ptmSlots', 'p-bad2'), slot({ date: 'tomorrow' })), 'bad date');
  await denied(set('owner-a', P('ptmSlots', 'p-bad3'), slot({ classId: 'class-99' })), 'unknown class');
  await denied(set('owner-a', P('ptmSlots', 'p-bad4'), { ...slot(), extra: 'x' }), 'extra field');
  await denied(set('owner-a', P('ptmSlots', 'bad id!'), slot()), 'bad id');
  for (const who of ['t1', 'parent-1', 'unlinked', 't-off', 'owner-b', null]) {
    await denied(set(who, P('ptmSlots', 'p-x'), slot()), 'write by ' + who);
    await denied(remove(who, P('ptmSlots', 'p-8')), 'remove by ' + who);
  }
  await allowed(get('owner-a', P('ptmSlots', 'p-8')), 'owner reads');
  await allowed(get('t1', P('ptmSlots', 'p-8')), 'teacher reads');
  await allowed(get('parent-1', P('ptmSlots', 'p-8')), 'own class');
  await denied(get('parent-1', P('ptmSlots', 'p-9')), 'other class');
  await denied(get('unlinked', P('ptmSlots', 'p-8')), 'unlinked');
  await denied(get('t-off', P('ptmSlots', 'p-8')), 'inactive teacher');
  await denied(get('owner-b', P('ptmSlots', 'p-8')), 'other school');
  await denied(get(null, P('ptmSlots', 'p-8')), 'anonymous');
  await allowed(query('parent-1', A, 'ptmSlots', [['classId', 'class-8']]), 'portal list');
  await denied(query('parent-1', A, 'ptmSlots', [['classId', 'class-9']]), 'portal list other class');
  await allowed(remove('owner-a', P('ptmSlots', 'p-8')), 'owner removes');
});

test('payroll: owner only, one record per person per month', async () => {
  const pay = (over = {}) => ({ staffUid: 't1', month: '2026-12', basic: 30000, allowances: 1000, deductions: 200, ...over });
  await allowed(set('owner-a', P('payroll', 't1_2026-12'), pay()), 'create');
  await allowed(set('owner-a', P('payroll', 't1_2026-12'), pay({ paidOn: TODAY, note: 'Paid by bank' })), 'mark paid');
  await denied(set('owner-a', P('payroll', 'wrong-id'), pay()), 'id must match');
  await denied(set('owner-a', P('payroll', 't1_2026-13'), pay({ month: '2026-13' })), 'bad month');
  await denied(set('owner-a', P('payroll', 't1_2026-12'), pay({ basic: -5 })), 'negative');
  await denied(set('owner-a', P('payroll', 't1_2026-12'), pay({ deductions: 99999 })), 'deductions above pay');
  await denied(set('owner-a', P('payroll', 'ghost_2026-12'), pay({ staffUid: 'ghost' })), 'not a member');
  await denied(set('owner-a', P('payroll', 't1_2026-12'), { ...pay(), extra: 1 }), 'extra field');
  for (const who of ['t1', 'parent-1', 't-off', 'owner-b', null]) {
    await denied(get(who, P('payroll', 't1_2026-11')), 'read by ' + who);
    await denied(set(who, P('payroll', 't1_2027-01'), pay({ month: '2027-01' })), 'write by ' + who);
    await denied(remove(who, P('payroll', 't1_2026-11')), 'remove by ' + who);
  }
  await allowed(get('owner-a', P('payroll', 't1_2026-11')), 'owner reads');
  await allowed(remove('owner-a', P('payroll', 't1_2026-11')), 'owner removes');
});

test('messages: a family writes for its own student; the owner replies', async () => {
  const msg = (over = {}) => ({ studentId: 's1', subject: 'Leave', body: 'My child will be absent Monday.', createdAt: TODAY, createdBy: 'parent-1', ...over });
  await allowed(set('parent-1', P('messages', 'm-new'), msg()), 'send');
  await denied(set('parent-1', P('messages', 'm-b1'), msg({ studentId: 's2' })), 'other student');
  await denied(set('parent-1', P('messages', 'm-b2'), msg({ createdBy: 'parent-2' })), 'someone elses name');
  await denied(set('parent-1', P('messages', 'm-b3'), msg({ reply: 'self reply', repliedAt: TODAY })), 'own reply');
  await denied(set('parent-1', P('messages', 'm-b4'), msg({ body: '   ' })), 'blank');
  await denied(set('parent-1', P('messages', 'm-b5'), msg({ subject: 'x'.repeat(101) })), 'long subject');
  await denied(set('parent-1', P('messages', 'm-b6'), { ...msg(), extra: 'x' }), 'extra field');
  await denied(set('parent-1', P('messages', 'bad id!'), msg()), 'bad id');
  await denied(set('unlinked', P('messages', 'm-b7'), msg({ createdBy: 'unlinked' })), 'unlinked');
  await denied(set('t1', P('messages', 'm-b8'), msg({ createdBy: 't1' })), 'teacher');
  await denied(set(null, P('messages', 'm-b9'), msg()), 'anonymous');
  await denied(set('parent-1', P('messages', 'm-1'), msg({ subject: 'Changed' })), 'family edit');
  await denied(remove('parent-1', P('messages', 'm-1')), 'family remove');
  const original = { studentId: 's1', subject: 'Fees', body: 'Question about fees.', createdAt: TODAY, createdBy: 'parent-1' };
  await allowed(set('owner-a', P('messages', 'm-1'), { ...original, reply: 'Please see the fees page.', repliedAt: TODAY }), 'reply');
  await denied(set('owner-a', P('messages', 'm-1'), { ...original, body: 'Rewritten', reply: 'x', repliedAt: TODAY }), 'owner rewrites');
  await denied(set('owner-a', P('messages', 'm-2'), { studentId: 's2', subject: 'Bus', body: 'Bus timing?', createdAt: TODAY, createdBy: 'parent-2' }), 'update without reply');
  await allowed(get('parent-1', P('messages', 'm-1')), 'own message');
  await denied(get('parent-1', P('messages', 'm-2')), 'other family message');
  await denied(get('t1', P('messages', 'm-1')), 'teacher read');
  await denied(get('owner-b', P('messages', 'm-1')), 'other school');
  await denied(get(null, P('messages', 'm-1')), 'anonymous read');
  await allowed(query('parent-1', A, 'messages', [['createdBy', 'parent-1']]), 'own list');
  await denied(query('parent-1', A, 'messages', [['createdBy', 'parent-2']]), 'list of another family');
  await allowed(get('owner-a', P('messages', 'm-2')), 'owner reads all');
  await allowed(remove('owner-a', P('messages', 'm-2')), 'owner removes');
});
