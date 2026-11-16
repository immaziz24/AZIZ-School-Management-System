// Firestore rules tests for Academic Setup (features 018, 019, 020).
// Synthetic records only. Runs against the Firestore Emulator with no npm dependencies:
//   firebase emulators:exec --only firestore --project demo-aziz "node --test tests/academic.rules.test.mjs"
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const docName = (path) => `projects/${project}/databases/(default)/documents/${path}`;

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
// Atomic multi-document write, so the rules see the same batch the app sends.
const batch = async (who, writes) => {
  const response = await fetch(base + ':commit', {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ writes: writes.map(([path, data]) => ({ update: { name: docName(path), fields: fields(data) } })) }),
  });
  await response.arrayBuffer();
  return response.status;
};
const allowed = async (promise, label) => assert.equal(await promise, 200, label);
const denied = async (promise, label) => assert.equal(await promise, 403, label);

const A = 'schools/abcd-school';
const B = 'schools/second-demo-school';
const year = { label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', status: 'draft' };
const activeYear = { ...year, status: 'active' };
const closedYear = { ...year, status: 'closed' };
const pointer = (id) => ({ activeYearId: id });

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' },
  );
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/inactive-owner-a`, { role: 'owner', active: false }],
    [`${A}/members/teacher-a`, { role: 'teacher', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
  ];
  for (const [path, data] of seed) assert.equal(await set(ADMIN, path, data), 200);
});

const seedClassAndSubject = async () => {
  assert.equal(await set(ADMIN, `${A}/classes/class-8`, { name: 'Class 8', order: 8 }), 200);
  assert.equal(await set(ADMIN, `${A}/subjects/english`, { name: 'English', code: 'ENG' }), 200);
};

test('owner can create, read, list and update setup records', async () => {
  await allowed(set('owner-a', `${A}/academicYears/2026-27`, year), 'create year');
  await allowed(get('owner-a', `${A}/academicYears/2026-27`), 'read year');
  await allowed(get('owner-a', `${A}/academicYears`), 'list years');
  await allowed(set('owner-a', `${A}/academicYears/2026-27`, { ...year, endDate: '2027-04-15' }), 'edit draft dates');
  await allowed(set('owner-a', `${A}/classes/class-8`, { name: 'Class 8', order: 8 }), 'create class');
  await allowed(set('owner-a', `${A}/classes/class-8`, { name: 'Class Eight', order: 8 }), 'rename class');
  await allowed(set('owner-a', `${A}/sections/class-8-a`, { classId: 'class-8', name: 'A' }), 'create section');
  await allowed(set('owner-a', `${A}/sections/class-8-a`, { classId: 'class-8', name: 'A1' }), 'rename section');
  await allowed(set('owner-a', `${A}/subjects/english`, { name: 'English', code: 'ENG' }), 'create subject');
  await allowed(set('owner-a', `${A}/subjects/art`, { name: 'Art', code: '' }), 'subject with empty code');
  await allowed(set('owner-a', `${A}/classSubjects/class-8_english`, { classId: 'class-8', subjectId: 'english' }), 'map');
  await allowed(get('owner-a', `${A}/classes`), 'list classes');
  await allowed(get('owner-a', `${A}/sections`), 'list sections');
  await allowed(get('owner-a', `${A}/subjects`), 'list subjects');
  await allowed(get('owner-a', `${A}/classSubjects`), 'list mappings');
});

test('teacher, inactive owner and anonymous cannot read or write setup', async () => {
  await seedClassAndSubject();
  await set(ADMIN, `${A}/academicYears/2026-27`, year);
  const paths = {
    year: [`${A}/academicYears/2026-27`, year], class: [`${A}/classes/class-8`, { name: 'X', order: 8 }],
    subject: [`${A}/subjects/english`, { name: 'English', code: 'ENG' }],
    new_class: [`${A}/classes/class-9`, { name: 'Class 9', order: 9 }],
  };
  for (const who of ['teacher-a', 'inactive-owner-a', null, 'stranger']) {
    for (const [label, [path, data]] of Object.entries(paths)) {
      await denied(get(who, path), `${who} reads ${label}`);
      await denied(set(who, path, data), `${who} writes ${label}`);
    }
    await denied(get(who, `${A}/classes`), `${who} lists classes`);
  }
});

test('cross-school access is rejected in both directions', async () => {
  await seedClassAndSubject();
  await denied(get('owner-b', `${A}/classes/class-8`), 'B reads A');
  await denied(get('owner-b', `${A}/classes`), 'B lists A');
  await denied(set('owner-b', `${A}/classes/class-9`, { name: 'Class 9', order: 9 }), 'B writes A');
  await denied(set('owner-b', `${A}/academicYears/2026-27`, year), 'B creates year in A');
  await denied(get('owner-a', `${B}/classes/class-8`), 'A reads B');
  await denied(set('owner-a', `${B}/classes/class-9`, { name: 'Class 9', order: 9 }), 'A writes B');
  await allowed(set('owner-b', `${B}/classes/class-9`, { name: 'Class 9', order: 9 }), 'B writes B');
  // A class in A must not satisfy the existence check for a section in B.
  await denied(set('owner-b', `${B}/sections/class-8-a`, { classId: 'class-8', name: 'A' }), 'section in B for A class');
});

test('academic year fields are validated', async () => {
  const path = `${A}/academicYears/2026-27`;
  const cases = {
    'empty label': { label: '   ' }, 'long label': { label: 'x'.repeat(21) }, 'numeric label': { label: 2026 },
    'bad start': { startDate: '1 April 2026' }, 'bad end': { endDate: '2027/03/31' },
    'end equals start': { endDate: '2026-04-01' }, 'end before start': { endDate: '2026-03-31' },
    'created active': { status: 'active' }, 'created closed': { status: 'closed' }, 'unknown status': { status: 'open' },
  };
  for (const [label, change] of Object.entries(cases)) {
    await denied(set('owner-a', path, { ...year, ...change }), label);
  }
  await denied(set('owner-a', path, { ...year, approved: true }), 'extra field');
  for (const field of Object.keys(year)) {
    const { [field]: _, ...rest } = year;
    await denied(set('owner-a', path, rest), 'missing ' + field);
  }
  await denied(set('owner-a', `${A}/academicYears/2026_27`, year), 'underscore in ID');
  await denied(set('owner-a', `${A}/academicYears/Year-1`, year), 'uppercase ID');
  await denied(set('owner-a', `${A}/academicYears/${'y'.repeat(21)}`, year), 'long ID');
});

test('a year is activated only together with the active-year pointer', async () => {
  const y = `${A}/academicYears/2026-27`;
  const p = `${A}/settings/academic`;
  await set(ADMIN, y, year);
  await denied(set('owner-a', y, activeYear), 'activate without pointer');
  await denied(set('owner-a', p, pointer('2026-27')), 'pointer to a draft year');
  await denied(batch('teacher-a', [[y, activeYear], [p, pointer('2026-27')]]), 'teacher batch');
  await denied(batch('owner-b', [[y, activeYear], [p, pointer('2026-27')]]), 'other school owner batch');
  await denied(batch('owner-a', [[y, activeYear], [p, { activeYearId: '2026-27', extra: 'x' }]]), 'extra pointer field');
  await denied(batch('owner-a', [[y, activeYear], [p, pointer('2025-26')]]), 'pointer names a different year');
  await allowed(batch('owner-a', [[y, activeYear], [p, pointer('2026-27')]]), 'activate with pointer');
  await allowed(get('owner-a', p), 'read pointer');
  await denied(get('teacher-a', p), 'teacher reads pointer');
});

test('only one year can be active and closed years are final', async () => {
  const y1 = `${A}/academicYears/2026-27`;
  const y2 = `${A}/academicYears/2027-28`;
  const p = `${A}/settings/academic`;
  const next = { label: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31', status: 'draft' };
  await set(ADMIN, y1, year);
  await set(ADMIN, y2, next);
  await allowed(batch('owner-a', [[y1, activeYear], [p, pointer('2026-27')]]), 'activate first');
  await denied(batch('owner-a', [[y2, { ...next, status: 'active' }], [p, pointer('2027-28')]]), 'second active while first is open');
  await denied(set('owner-a', y2, { ...next, status: 'active' }), 'second active without pointer');
  await denied(set('owner-a', y1, { ...activeYear, label: '2026-2027' }), 'rename active year');
  await denied(set('owner-a', y1, { ...activeYear, endDate: '2027-04-30' }), 'change dates of active year');
  await denied(set('owner-a', y1, year), 'active back to draft');
  await denied(set('owner-a', y1, { ...closedYear, endDate: '2027-04-30' }), 'close and change dates');
  await allowed(set('owner-a', y1, closedYear), 'close first');
  await allowed(batch('owner-a', [[y2, { ...next, status: 'active' }], [p, pointer('2027-28')]]), 'activate second after closing first');
  await denied(set('owner-a', y1, year), 'closed back to draft');
  await denied(set('owner-a', y1, activeYear), 'closed back to active');
  await denied(batch('owner-a', [[y1, activeYear], [p, pointer('2026-27')]]), 'reopen closed year');
  await denied(set('owner-a', y1, { ...closedYear, label: 'changed' }), 'edit closed year');
});

test('closing and activating in one batch is allowed', async () => {
  const y1 = `${A}/academicYears/2026-27`;
  const y2 = `${A}/academicYears/2027-28`;
  const p = `${A}/settings/academic`;
  const next = { label: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31', status: 'draft' };
  await set(ADMIN, y1, activeYear);
  await set(ADMIN, y2, next);
  await set(ADMIN, p, pointer('2026-27'));
  await allowed(batch('owner-a', [[y1, closedYear], [y2, { ...next, status: 'active' }], [p, pointer('2027-28')]]), 'rollover batch');
});

test('class fields are validated', async () => {
  const good = { name: 'Class 8', order: 8 };
  const cases = {
    'empty name': { name: ' ' }, 'long name': { name: 'x'.repeat(41) }, 'zero order': { order: 0 },
    'order above 100': { order: 101 }, 'decimal order': { order: 8.5 }, 'string order': { order: '8' },
  };
  for (const [label, change] of Object.entries(cases)) {
    await denied(set('owner-a', `${A}/classes/class-8`, { ...good, ...change }), label);
  }
  await denied(set('owner-a', `${A}/classes/class-8`, { ...good, extra: 1 }), 'extra field');
  await denied(set('owner-a', `${A}/classes/class-8`, { name: 'Class 8' }), 'missing order');
  await denied(set('owner-a', `${A}/classes/Class-8`, good), 'uppercase ID');
  await denied(set('owner-a', `${A}/classes/class_8`, good), 'underscore in ID');
  await denied(set('owner-a', `${A}/classes/${'c'.repeat(21)}`, good), 'long ID');
  await denied(call('DELETE', 'owner-a', `${A}/classes/class-8`), 'delete');
});

test('sections need an existing class and cannot move between classes', async () => {
  await denied(set('owner-a', `${A}/sections/class-8-a`, { classId: 'class-8', name: 'A' }), 'class does not exist');
  await seedClassAndSubject();
  assert.equal(await set(ADMIN, `${A}/classes/class-9`, { name: 'Class 9', order: 9 }), 200);
  await allowed(set('owner-a', `${A}/sections/class-8-a`, { classId: 'class-8', name: 'A' }), 'create');
  await denied(set('owner-a', `${A}/sections/class-8-a`, { classId: 'class-9', name: 'A' }), 'move to another class');
  await denied(set('owner-a', `${A}/sections/class-8-b`, { classId: 'class-8', name: ' ' }), 'empty name');
  await denied(set('owner-a', `${A}/sections/class-8-b`, { classId: 'class-8', name: 'x'.repeat(11) }), 'long name');
  await denied(set('owner-a', `${A}/sections/class-8-b`, { classId: 'class-8', name: 'B', extra: 1 }), 'extra field');
  await denied(set('owner-a', `${A}/sections/class-8-b`, { classId: 'Class 8', name: 'B' }), 'malformed classId');
  await denied(set('owner-a', `${A}/sections/Class-8-B`, { classId: 'class-8', name: 'B' }), 'uppercase ID');
  await denied(call('DELETE', 'owner-a', `${A}/sections/class-8-a`), 'delete');
});

test('subjects are validated', async () => {
  const good = { name: 'English', code: 'ENG' };
  await allowed(set('owner-a', `${A}/subjects/english`, good), 'create');
  await denied(set('owner-a', `${A}/subjects/english`, { ...good, name: ' ' }), 'empty name');
  await denied(set('owner-a', `${A}/subjects/english`, { ...good, name: 'x'.repeat(81) }), 'long name');
  await denied(set('owner-a', `${A}/subjects/english`, { ...good, code: 'x'.repeat(13) }), 'long code');
  await denied(set('owner-a', `${A}/subjects/english`, { name: 'English' }), 'missing code');
  await denied(set('owner-a', `${A}/subjects/english`, { ...good, extra: true }), 'extra field');
  await denied(set('owner-a', `${A}/subjects/English`, good), 'uppercase ID');
  await denied(call('DELETE', 'owner-a', `${A}/subjects/english`), 'delete');
});

test('class-subject mappings need real records and a matching ID', async () => {
  const path = `${A}/classSubjects/class-8_english`;
  const good = { classId: 'class-8', subjectId: 'english' };
  await denied(set('owner-a', path, good), 'neither record exists');
  assert.equal(await set(ADMIN, `${A}/classes/class-8`, { name: 'Class 8', order: 8 }), 200);
  await denied(set('owner-a', path, good), 'subject missing');
  assert.equal(await set(ADMIN, `${A}/subjects/english`, { name: 'English', code: 'ENG' }), 200);
  await denied(set('owner-a', `${A}/classSubjects/other-id`, good), 'ID does not match');
  await denied(set('owner-a', `${A}/classSubjects/class-9_english`, { classId: 'class-9', subjectId: 'english' }), 'class missing');
  await denied(set('owner-a', `${A}/classSubjects/class-8_maths`, { classId: 'class-8', subjectId: 'maths' }), 'subject missing by ID');
  await denied(set('owner-a', path, { ...good, extra: 'x' }), 'extra field');
  await allowed(set('owner-a', path, good), 'valid mapping');
  await denied(set('owner-a', path, good), 'update existing mapping');
  await denied(call('DELETE', 'owner-a', path), 'delete');
  await denied(set('teacher-a', path, good), 'teacher write');
  // A class from school B must not satisfy the check in school A.
  assert.equal(await set(ADMIN, `${B}/classes/class-7`, { name: 'Class 7', order: 7 }), 200);
  await denied(set('owner-a', `${A}/classSubjects/class-7_english`, { classId: 'class-7', subjectId: 'english' }), 'class from other school');
});
