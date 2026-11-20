// Firestore rules tests for batch 63: online tests and question bank, pickup, library reservations and renewals, hostel, canteen,
// approval rules (features 139, 146, 137, 144, 145, 156). Synthetic records only.
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
const LAT = 26.7271;
const LNG = 88.3953;
const COS = Math.cos(LAT * Math.PI / 180);
const north = (metres) => LAT + metres / 111320;
const east = (metres) => LNG + metres / (111320 * COS);
const istDay = (offsetDays = 0) => new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
const TODAY = istDay();
const projectPath = `projects/${project}/databases/(default)/documents`;

// A write with the server time stamped into `at` (or setOn) the way the app's serverTimestamp() does.
const writeWithTime = async (who, path, data, timeField) => {
  const timeFields = [].concat(timeField ?? []);
  const response = await fetch(`http://${host}/v1/${projectPath}:commit`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ writes: [{
      update: { name: `${projectPath}/${path}`, fields: fields(data) },
      ...(timeFields.length ? { updateTransforms: timeFields.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
    }] }),
  });
  await response.arrayBuffer();
  return response.status;
};

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
    [`${A}/books/b1`, { title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', copies: 1 }],
    [`${A}/hostelRooms/HR-1`, { name: 'Room 101', beds: 4 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

const question = (extra = {}) => ({ classId: 'c1', subjectName: 'Science', text: 'Which planet is the Red Planet?', options: ['Venus', 'Mars', 'Jupiter'], correct: 1, marks: 2, ...extra });
const paper = JSON.stringify([{ q: 'Red planet?', o: ['Venus', 'Mars'], m: 2 }]);
const test63 = (extra = {}) => ({ title: 'Science quiz', classId: 'c1', className: 'Class 5', durationMin: 20, status: 'draft', paper, count: 1, totalMarks: 2, createdOn: TODAY, ...extra });
const attempt = (who, testId, studentId, answers = '1', by = who) =>
  writeWithTime(who, `${A}/onlineAttempts/${testId}_${studentId}`, { testId, studentId, answers, by }, 'at');
const person = (extra = {}) => ({ studentId: 's1', name: 'Uncle Raj', relation: 'Uncle', phone: '98765 43210', code: '482913', active: true, createdBy: 'parent-1', ...extra });

test('question bank: owner only, 2 to 4 options, the right answer must be one of them', async () => {
  await allowed(set('owner-a', `${A}/questionBank/QB-1`, question()), 'create');
  await allowed(set('owner-a', `${A}/questionBank/QB-1`, question({ options: ['A', 'B', 'C', 'D'], correct: 3 })), 'four options');
  for (const bad of [question({ options: ['only one'], correct: 0 }), question({ correct: 3 }), question({ correct: -1 }), question({ options: ['A', 'B', 'C', 'D', 'E'] }),
    question({ marks: 0 }), question({ marks: 21 }), question({ text: '' }), question({ options: ['A', ''], correct: 0 }), question({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/questionBank/QB-2`, bad), JSON.stringify(bad).slice(0, 70));
  }
  for (const who of ['prin', 't1', 'parent-1', 'owner-b', null]) {
    await denied(get(who, `${A}/questionBank/QB-1`), 'read by ' + who);
    await denied(set(who, `${A}/questionBank/QB-3`, question()), 'write by ' + who);
  }
  await allowed(remove('owner-a', `${A}/questionBank/QB-1`), 'owner removes');
});

test('online tests: the paper has no answers; answers are in a key only the owner reads', async () => {
  await allowed(set('owner-a', `${A}/onlineTests/OT-1`, test63()), 'draft');
  await denied(get('parent-1', `${A}/onlineTests/OT-1`), 'a draft is hidden from families');
  await allowed(set('owner-a', `${A}/onlineTests/OT-1`, test63({ title: 'Science quiz 2' })), 'a draft can be edited');
  await allowed(set('owner-a', `${A}/onlineTestKeys/OT-1`, { key: '1', marks: '2' }), 'key');
  await denied(set('owner-a', `${A}/onlineTestKeys/OT-9`, { key: '1', marks: '2' }), 'key without a test');
  await denied(set('owner-a', `${A}/onlineTestKeys/OT-1`, { key: '4', marks: '2' }), 'bad key');
  await allowed(set('owner-a', `${A}/onlineTests/OT-1`, test63({ status: 'open' })), 'open');
  await allowed(get('parent-1', `${A}/onlineTests/OT-1`), 'family reads an open test');
  await allowed(query('parent-1', A, 'onlineTests', [['status', 'open']]), 'family lists open tests');
  await denied(query('parent-1', A, 'onlineTests', [['classId', 'c1']]), 'family cannot list without the open filter');
  await denied(set('owner-a', `${A}/onlineTests/OT-1`, test63({ status: 'open', title: 'Changed after opening' })), 'paper locked once open');
  await allowed(set('owner-a', `${A}/onlineTests/OT-1`, test63({ status: 'closed' })), 'close');
  await allowed(get('parent-1', `${A}/onlineTests/OT-1`), 'a closed test stays readable so a family can see its result');
  await allowed(query('parent-1', A, 'onlineTests', [['status', 'closed']]), 'family lists closed tests');
  for (const who of ['parent-1', 'prin', 't1', 'owner-b', null]) await denied(get(who, `${A}/onlineTestKeys/OT-1`), 'key read by ' + who);
  for (const bad of [test63({ durationMin: 2 }), test63({ status: 'live' }), test63({ count: 0 }), test63({ paper: 'x'.repeat(30001) }), test63({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/onlineTests/OT-2`, bad), JSON.stringify(bad).slice(0, 60));
  }
  await denied(set('t1', `${A}/onlineTests/OT-3`, test63()), 'teacher cannot create');
});

test('online attempts: a family answers once for its own student while the test is open; the owner grades', async () => {
  await set(ADMIN, `${A}/onlineTests/OT-1`, test63({ status: 'open' }));
  await set(ADMIN, `${A}/onlineTests/OT-2`, test63({ status: 'closed' }));
  assert.equal(await attempt('parent-1', 'OT-1', 's1'), 200, 'own student');
  assert.equal(await attempt('parent-1', 'OT-1', 's2'), 403, "another family's student");
  assert.equal(await attempt('parent-2', 'OT-1', 's1'), 403, 'wrong family');
  assert.equal(await attempt('parent-1', 'OT-2', 's1'), 403, 'closed test');
  assert.equal(await attempt('parent-1', 'OT-1', 's1', '9'), 403, 'bad answers');
  assert.equal(await attempt('parent-1', 'OT-1', 's1', '0'), 403, 'a second sheet for the same student is refused');
  assert.equal(await attempt('parent-2', 'OT-1', 's2', '1,x,2'), 200, 'x means not answered');
  assert.equal(await writeWithTime('parent-1', `${A}/onlineAttempts/OT-1_s1`, { testId: 'OT-1', studentId: 's1', answers: '1', by: 'parent-1', score: 99, gradedOn: TODAY }, 'at'), 403, 'a family cannot grade itself');
  await denied(set('parent-1', `${A}/onlineAttempts/OT-1_s1`, { testId: 'OT-1', studentId: 's1', answers: '0', by: 'parent-1', at: new Date() }), 'family cannot change a sheet with a client time');
  await allowed(get('parent-1', `${A}/onlineAttempts/OT-1_s1`), 'family reads own sheet');
  await denied(get('parent-2', `${A}/onlineAttempts/OT-1_s1`), 'other family');
  await allowed(query('parent-1', A, 'onlineAttempts', [['by', 'parent-1']]), 'family lists own');
  await denied(query('parent-1', A, 'onlineAttempts', [['testId', 'OT-1']]), 'family cannot list everyone');
  await allowed(query('prin', A, 'onlineAttempts', [['testId', 'OT-1']]), 'principal lists a test');
  // The app writes the whole sheet back with the same time it read; here a field mask changes only what is named.
  const patch = async (who, data) => {
    const response = await fetch(`http://${host}/v1/${projectPath}:commit`, {
      method: 'POST', headers: headers(who),
      body: JSON.stringify({ writes: [{ update: { name: `${projectPath}/${A}/onlineAttempts/OT-1_s1`, fields: fields(data) },
        updateMask: { fieldPaths: Object.keys(data) }, currentDocument: { exists: true } }] }),
    });
    await response.arrayBuffer();
    return response.status;
  };
  assert.equal(await patch('owner-a', { score: 2, gradedOn: TODAY }), 200, 'owner grades');
  assert.equal(await patch('owner-a', { answers: '0', score: 2, gradedOn: TODAY }), 403, 'owner cannot change the answers');
  assert.equal(await patch('owner-a', { score: 5000, gradedOn: TODAY }), 403, 'score out of range');
  assert.equal(await patch('parent-1', { score: 2, gradedOn: TODAY }), 403, 'a family cannot grade');
  await denied(remove('owner-a', `${A}/onlineAttempts/OT-1_s1`), 'never deleted');
});

test('pickup: a family manages its own student people; the school logs each hand-over', async () => {
  await allowed(set('parent-1', `${A}/pickupPeople/PK-1`, person()), 'family adds');
  await denied(set('parent-1', `${A}/pickupPeople/PK-2`, person({ studentId: 's2' })), "another family's student");
  await denied(set('parent-1', `${A}/pickupPeople/PK-3`, person({ createdBy: 'parent-2' })), 'created by someone else');
  for (const bad of [person({ code: '12345' }), person({ code: 'abcdef' }), person({ name: '' }), person({ phone: 'call me' }), person({ extra: 1 })]) {
    await denied(set('parent-1', `${A}/pickupPeople/PK-4`, bad), JSON.stringify(bad).slice(0, 60));
  }
  await allowed(set('parent-1', `${A}/pickupPeople/PK-1`, person({ active: false })), 'family switches one off');
  await denied(set('parent-1', `${A}/pickupPeople/PK-1`, person({ studentId: 's2' })), 'cannot move to another student');
  await denied(set('parent-2', `${A}/pickupPeople/PK-1`, person()), 'other family cannot change it');
  await allowed(query('parent-1', A, 'pickupPeople', [['createdBy', 'parent-1']]), 'family lists own');
  await denied(query('parent-2', A, 'pickupPeople', [['createdBy', 'parent-1']]), 'other family lists');
  await allowed(get('prin', `${A}/pickupPeople/PK-1`), 'principal reads');
  await allowed(query('prin', A, 'pickupPeople', [['studentId', 's1']]), 'principal lists');
  await allowed(set('owner-a', `${A}/pickupPeople/PK-5`, person({ createdBy: 'owner-a' })), 'owner adds');
  await denied(remove('parent-2', `${A}/pickupPeople/PK-1`), 'other family cannot remove');
  await allowed(remove('parent-1', `${A}/pickupPeople/PK-1`), 'family removes own');
  const log = { studentId: 's1', studentName: 'Asha Rao', personName: 'Uncle Raj', relation: 'Uncle', by: 'prin' };
  assert.equal(await writeWithTime('prin', `${A}/pickupLogs/PL-1`, log, 'at'), 200, 'principal logs');
  assert.equal(await writeWithTime('owner-a', `${A}/pickupLogs/PL-2`, { ...log, by: 'owner-a' }, 'at'), 200, 'owner logs');
  assert.equal(await writeWithTime('prin', `${A}/pickupLogs/PL-3`, { ...log, by: 'owner-a' }, 'at'), 403, 'by must be the signed-in person');
  assert.equal(await writeWithTime('prin', `${A}/pickupLogs/PL-4`, log), 403, 'needs the server time');
  assert.equal(await writeWithTime('parent-1', `${A}/pickupLogs/PL-5`, { ...log, by: 'parent-1' }, 'at'), 403, 'a family cannot log');
  assert.equal(await writeWithTime('t1', `${A}/pickupLogs/PL-6`, { ...log, by: 't1' }, 'at'), 403, 'a teacher cannot log');
  await allowed(get('prin', `${A}/pickupLogs/PL-1`), 'principal reads the log');
  await denied(set('owner-a', `${A}/pickupLogs/PL-1`, { ...log, at: new Date() }), 'never edited');
  await denied(remove('owner-a', `${A}/pickupLogs/PL-1`), 'never deleted');
  await denied(get('parent-1', `${A}/pickupLogs/PL-1`), 'family cannot read the log');
});

test('library: reservations and renewals', async () => {
  const res = (extra = {}) => ({ bookId: 'b1', bookTitle: 'Wings of Fire', studentId: 's1', studentName: 'Asha Rao', createdOn: TODAY, status: 'waiting', ...extra });
  await allowed(set('owner-a', `${A}/bookReservations/BR-1`, res()), 'reserve');
  await allowed(set('owner-a', `${A}/bookReservations/BR-1`, res({ status: 'ready' })), 'ready');
  for (const bad of [res({ status: 'lost' }), res({ bookId: 'nobook' }), res({ studentId: 'ghost' }), res({ createdOn: 'today' }), res({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/bookReservations/BR-2`, bad), JSON.stringify(bad).slice(0, 60));
  }
  await denied(set('t1', `${A}/bookReservations/BR-3`, res()), 'teacher');
  await allowed(get('prin', `${A}/bookReservations/BR-1`), 'principal reads');
  const loan = { bookId: 'b1', studentId: 's1', issuedOn: TODAY, dueOn: istDay(14), issuedBy: 'owner-a' };
  await set(ADMIN, `${A}/loans/LN-1`, loan);
  await allowed(set('owner-a', `${A}/loans/LN-1`, { ...loan, dueOn: istDay(28), renewals: 1 }), 'first renewal');
  await set(ADMIN, `${A}/loans/LN-1`, { ...loan, dueOn: istDay(28), renewals: 1 });
  await denied(set('owner-a', `${A}/loans/LN-1`, { ...loan, dueOn: istDay(42), renewals: 3 }), 'renewals must go up one at a time');
  await denied(set('owner-a', `${A}/loans/LN-1`, { ...loan, dueOn: istDay(10), renewals: 2 }), 'due date cannot move earlier');
  await set(ADMIN, `${A}/loans/LN-1`, { ...loan, dueOn: istDay(42), renewals: 3 });
  await denied(set('owner-a', `${A}/loans/LN-1`, { ...loan, dueOn: istDay(56), renewals: 4 }), 'at most 3 renewals');
  await denied(set('owner-a', `${A}/loans/LN-1`, { ...loan, dueOn: istDay(14), renewals: 3, issuedOn: istDay(-5) }), 'other fields locked');
  await set(ADMIN, `${A}/loans/LN-2`, { ...loan, returnedOn: TODAY });
  await denied(set('owner-a', `${A}/loans/LN-2`, { ...loan, dueOn: istDay(28), renewals: 1, returnedOn: TODAY }), 'cannot renew a returned book');
  await allowed(set('owner-a', `${A}/loans/LN-3`, loan), 'a new loan still works');
});

test('hostel and canteen: owner writes, principal reads', async () => {
  const stay = (extra = {}) => ({ studentId: 's1', studentName: 'Asha Rao', roomId: 'HR-1', roomName: 'Room 101', from: TODAY, status: 'staying', ...extra });
  await allowed(set('owner-a', `${A}/hostelRooms/HR-2`, { name: 'Room 102', beds: 2, block: 'A', monthlyFee: 3500 }), 'room');
  await denied(set('owner-a', `${A}/hostelRooms/HR-3`, { name: 'Room 103', beds: 0 }), 'no beds');
  await denied(set('owner-a', `${A}/hostelRooms/HR-3`, { name: 'Room 103', beds: 2, extra: 1 }), 'extra field');
  await allowed(set('owner-a', `${A}/hostelStays/HS-1`, stay()), 'stay');
  await allowed(set('owner-a', `${A}/hostelStays/HS-1`, stay({ status: 'left', leftOn: TODAY })), 'left');
  await denied(set('owner-a', `${A}/hostelStays/HS-2`, stay({ roomId: 'HR-404' })), 'room must exist');
  await denied(set('owner-a', `${A}/hostelStays/HS-2`, stay({ status: 'gone' })), 'bad status');
  const menu = (extra = {}) => ({ day: 'Monday', meal: 'Lunch', items: 'Rice, dal, sabzi', price: 40, ...extra });
  await allowed(set('owner-a', `${A}/canteenMenu/CM-1`, menu()), 'menu');
  await denied(set('owner-a', `${A}/canteenMenu/CM-2`, menu({ day: 'Funday' })), 'bad day');
  await denied(set('owner-a', `${A}/canteenMenu/CM-2`, menu({ meal: 'Brunch' })), 'bad meal');
  const plan = (extra = {}) => ({ studentId: 's1', studentName: 'Asha Rao', plan: 'Veg lunch', monthlyFee: 900, from: TODAY, active: true, ...extra });
  await allowed(set('owner-a', `${A}/canteenPlans/CP-1`, plan()), 'plan');
  await denied(set('owner-a', `${A}/canteenPlans/CP-2`, plan({ studentId: 'ghost' })), 'student must exist');
  await denied(set('owner-a', `${A}/canteenPlans/CP-2`, plan({ monthlyFee: -1 })), 'negative fee');
  for (const path of ['hostelRooms/HR-1', 'hostelStays/HS-1', 'canteenMenu/CM-1', 'canteenPlans/CP-1']) {
    await allowed(get('prin', `${A}/${path}`), 'principal reads ' + path);
    for (const who of ['t1', 'parent-1', 'owner-b', null]) await denied(get(who, `${A}/${path}`), who + ' reads ' + path);
    await denied(set('prin', `${A}/${path}`, {}), 'principal writes ' + path);
  }
});

test('approval rules: owner only, expense kind, amount from 1', async () => {
  const rule = (extra = {}) => ({ name: 'Large expense', over: 10000, kind: 'expense', ...extra });
  await allowed(set('owner-a', `${A}/workflowRules/WR-1`, rule()), 'create');
  for (const bad of [rule({ over: 0 }), rule({ kind: 'leave' }), rule({ name: '' }), rule({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/workflowRules/WR-2`, bad), JSON.stringify(bad).slice(0, 60));
  }
  await allowed(get('prin', `${A}/workflowRules/WR-1`), 'principal reads');
  await denied(set('prin', `${A}/workflowRules/WR-3`, rule()), 'principal cannot write');
  await denied(get('parent-1', `${A}/workflowRules/WR-1`), 'parent');
  await allowed(remove('owner-a', `${A}/workflowRules/WR-1`), 'owner removes');
});
