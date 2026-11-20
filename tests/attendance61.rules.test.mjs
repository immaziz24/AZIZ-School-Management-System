// Firestore rules tests for the school QR code, selfies, shifts and attendance disputes (features 128, 129, 132, 133, 158). Synthetic records only.
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

const place = (extra = {}) => ({ lat: LAT, lng: LNG, radiusM: 30, maxAccuracyM: 50, tzMinutes: 330, setBy: 'super', ...extra });
const saveLocation = (who, school, data, timeField = 'setOn') => writeWithTime(who, `${school}/settings/location`, data, timeField);
const checkinPath = (uid, kind, day = TODAY, school = A) => `${school}/staffCheckins/${day}_${uid}_${kind}`;
const verified = (uid, kind, extra = {}) => ({ staffUid: uid, date: TODAY, kind, lat: north(5), lng: LNG, accuracy: 12, status: 'verified', ...extra });
const send = (who, uid, kind, data, day = TODAY, school = A) => writeWithTime(who, checkinPath(uid, kind, day, school), data, 'at');
const postCode = (who, code, school = A) => writeWithTime(who, `${school}/settings/qrCode`, { code }, 'at');
const selfiePath = (uid, kind, day = TODAY) => `${A}/staffSelfies/${day}_${uid}_${kind}`;
const selfie = (uid, kind, extra = {}) => ({ staffUid: uid, date: TODAY, kind, photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD', ...extra });
const sendSelfie = (who, uid, kind, data) => writeWithTime(who, selfiePath(uid, kind), data, 'at');
const shift = (extra = {}) => ({ start: '09:00', end: '17:00', graceMin: 10, breakMin: 30, ...extra });
const dispute = (uid, extra = {}) => ({ staffUid: uid, date: istDay(-1), reason: 'My phone battery was dead', inTime: '09:05', outTime: '16:50', status: 'open', ...extra });
const disputePath = (uid, day = istDay(-1)) => `${A}/attendanceDisputes/${day}_${uid}`;
const sendDispute = (who, uid, data, path = disputePath(uid)) => writeWithTime(who, path, data, 'createdAt');
// A decision keeps every field of the saved dispute, as the app does, and changes only what the owner decides.
const decide = async (who, uid, status, extra = {}) => {
  const current = await (await fetch(`${base}/${disputePath(uid)}`, { headers: headers(ADMIN) })).json();
  const next = { ...current.fields, status: encode(status), reviewedBy: encode(who) };
  for (const [key, value] of Object.entries(extra)) next[key] = encode(value);
  const response = await fetch(`${base}/${disputePath(uid)}`, { method: 'PATCH', headers: headers(who), body: JSON.stringify({ fields: next }) });
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
    [`${A}/members/t2`, { role: 'teacher', active: true }],
    [`${A}/members/t3`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`platformAdmins/super`, { email: 'super@example.test' }],
    [`${A}/settings/location`, { lat: LAT, lng: LNG, radiusM: 30, maxAccuracyM: 50, tzMinutes: 330, setBy: 'super', setOn: '2026-01-01T00:00:00Z' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('location: the platform administrator can switch QR and selfie on, and only with true or false', async () => {
  await allowed(saveLocation('super', B, place({ qrRequired: true, selfieRequired: true })), 'both on');
  await allowed(saveLocation('super', B, place({ qrRequired: false })), 'qr off');
  await denied(saveLocation('super', B, place({ qrRequired: 'yes' })), 'qr text');
  await denied(saveLocation('super', B, place({ selfieRequired: 1 })), 'selfie number');
  await denied(saveLocation('owner-a', A, place({ qrRequired: true, setBy: 'owner-a' })), 'owner cannot switch it');
});

test('qr code: the owner and principal post and read it, nobody else can', async () => {
  await allowed(postCode('owner-a', 'K7M2PQ4X'), 'owner posts');
  await allowed(postCode('prin', 'AB23CD45'), 'principal posts');
  for (const who of ['owner-a', 'prin']) await allowed(get(who, `${A}/settings/qrCode`), 'read by ' + who);
  for (const who of ['t1', 'parent-1', 'owner-b', null]) await denied(get(who, `${A}/settings/qrCode`), 'read by ' + who);
  for (const who of ['t1', 'parent-1', 'owner-b']) await denied(postCode(who, 'K7M2PQ4X'), 'post by ' + who);
  for (const bad of ['k7m2pq4x', 'K7M2PQ4', 'K7M2PQ4XX', 'K7M2PQ0X', 'K7M2PQIX', 'K7M2PQ1O']) await denied(postCode('owner-a', bad), 'bad code ' + bad);
  await denied(writeWithTime('owner-a', `${A}/settings/qrCode`, { code: 'K7M2PQ4X' }, null), 'no server time');
  await denied(remove('owner-a', `${A}/settings/qrCode`), 'delete');
});

test('qr check-in: when the school requires it, only the current code works', async () => {
  await allowed(saveLocation('super', A, place({ qrRequired: true })), 'require qr');
  await allowed(postCode('owner-a', 'K7M2PQ4X'), 'code posted');
  await denied(send('t1', 't1', 'in', verified('t1', 'in')), 'no code');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'WRONGCODE' })), 'wrong code');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { qr: 12345678 })), 'code is not text');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'K7M2PQ4X', lat: north(40) })), 'right code but outside the distance');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'K7M2PQ4X' })), 'right code');
  await allowed(postCode('owner-a', 'MN7PQRST'), 'code changes');
  await denied(send('t1', 't1', 'out', verified('t1', 'out', { qr: 'K7M2PQ4X' })), 'old code after it changed');
  await allowed(send('t1', 't1', 'out', verified('t1', 'out', { qr: 'MN7PQRST' })), 'new code');
});

test('qr check-in: a code older than 150 seconds is refused', async () => {
  await allowed(saveLocation('super', A, place({ qrRequired: true })), 'require qr');
  assert.equal(await set(ADMIN, `${A}/settings/qrCode`, { code: 'K7M2PQ4X', at: new Date(Date.now() - 10 * 60000) }), 200, 'seed old code');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'K7M2PQ4X' })), 'ten minute old code');
  assert.equal(await set(ADMIN, `${A}/settings/qrCode`, { code: 'K7M2PQ4X', at: new Date(Date.now() - 60000) }), 200, 'seed fresh code');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'K7M2PQ4X' })), 'one minute old code');
});

test('qr check-in: the code before the current one still works for a minute', async () => {
  await allowed(saveLocation('super', A, place({ qrRequired: true })), 'require qr');
  await allowed(writeWithTime('owner-a', `${A}/settings/qrCode`, { code: 'MN7PQRST', prev: 'K7M2PQ4X' }, 'at'), 'new code with the old one kept');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'K7M2PQ4X' })), 'previous code just after the change');
  await allowed(send('t2', 't2', 'in', verified('t2', 'in', { qr: 'MN7PQRST' })), 'current code');
  assert.equal(await set(ADMIN, `${A}/settings/qrCode`, { code: 'MN7PQRST', prev: 'K7M2PQ4X', at: new Date(Date.now() - 90000) }), 200, 'seed 90 seconds old');
  await denied(send('t3', 't3', 'in', verified('t3', 'in', { qr: 'K7M2PQ4X' })), 'previous code after a minute and a half');
  await denied(writeWithTime('owner-a', `${A}/settings/qrCode`, { code: 'MN7PQRST', prev: 'bad' }, 'at'), 'bad prev code');
});

test('qr check-in: an empty or short code never matches', async () => {
  await allowed(saveLocation('super', A, place({ qrRequired: true })), 'require qr');
  await allowed(postCode('owner-a', 'K7M2PQ4X'), 'code posted');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { qr: '' })), 'empty code');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { qr: 'K7M2' })), 'short code');
});

test('qr check-in: when the school does not require it, a code is optional but must be right if sent', async () => {
  await allowed(postCode('owner-a', 'K7M2PQ4X'), 'code posted');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in')), 'no code needed');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', { qr: 'WRONGCODE' })), 'wrong code sent anyway');
  await allowed(send('t2', 't2', 'in', verified('t2', 'in', { qr: 'K7M2PQ4X' })), 'right code sent');
});

test('selfie: when the school requires it, the photo must be saved first', async () => {
  await allowed(saveLocation('super', A, place({ selfieRequired: true })), 'require selfie');
  await denied(send('t1', 't1', 'in', verified('t1', 'in')), 'no selfie yet');
  await allowed(sendSelfie('t1', 't1', 'in', selfie('t1', 'in')), 'selfie saved');
  await allowed(sendSelfie('t1', 't1', 'in', selfie('t1', 'in', { photo: 'data:image/jpeg;base64,/9j/AAAA' })), 'retake before check-in');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in')), 'check-in with selfie');
  await denied(sendSelfie('t1', 't1', 'in', selfie('t1', 'in')), 'selfie cannot change after check-in');
  await denied(send('t1', 't1', 'out', verified('t1', 'out')), 'out needs its own selfie');
  await allowed(sendSelfie('t1', 't1', 'out', selfie('t1', 'out')), 'out selfie');
  await allowed(send('t1', 't1', 'out', verified('t1', 'out')), 'check-out with selfie');
  await denied(send('t2', 't2', 'in', verified('t2', 'in')), 'another teacher cannot use it');
});

test('selfie: size, type, owner and date are checked', async () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(40001);
  const okSize = 'data:image/jpeg;base64,' + 'A'.repeat(39000);
  await allowed(sendSelfie('t1', 't1', 'in', selfie('t1', 'in', { photo: okSize })), 'about 39 thousand characters');
  await denied(sendSelfie('t2', 't2', 'in', selfie('t2', 'in', { photo: big })), 'too big');
  await denied(sendSelfie('t2', 't2', 'in', selfie('t2', 'in', { photo: 'data:image/png;base64,AAAA' })), 'not a jpeg');
  await denied(sendSelfie('t2', 't2', 'in', selfie('t2', 'in', { photo: 'https://example.test/me.jpg' })), 'a link, not a photo');
  await denied(sendSelfie('t2', 't1', 'in', selfie('t1', 'in')), 'for another teacher');
  await denied(sendSelfie('t2', 't2', 'in', selfie('t2', 'in', { date: istDay(-1) })), 'yesterday');
  await denied(sendSelfie('t2', 't2', 'in', selfie('t2', 'in', { kind: 'both' })), 'bad kind');
  await denied(sendSelfie('t2', 't2', 'in', { ...selfie('t2', 'in'), extra: 1 }), 'extra field');
  await denied(writeWithTime('t2', selfiePath('t2', 'in'), selfie('t2', 'in'), null), 'no server time');
  await denied(sendSelfie('parent-1', 'parent-1', 'in', selfie('parent-1', 'in')), 'a parent');
});

test('selfie: only the owner and principal read it, and nobody deletes it', async () => {
  await allowed(sendSelfie('t1', 't1', 'in', selfie('t1', 'in')), 'selfie saved');
  for (const who of ['owner-a', 'prin']) await allowed(get(who, selfiePath('t1', 'in')), 'read by ' + who);
  for (const who of ['t1', 't2', 'parent-1', 'owner-b', null]) await denied(get(who, selfiePath('t1', 'in')), 'read by ' + who);
  for (const who of ['t1', 'owner-a']) await denied(remove(who, selfiePath('t1', 'in')), 'delete by ' + who);
});

test('shift: the owner sets it, staff read it, values are checked', async () => {
  const path = `${A}/settings/shift`;
  await allowed(set('owner-a', path, shift()), 'owner saves');
  await allowed(set('owner-a', path, shift({ start: '08:30', end: '15:45', graceMin: 0, breakMin: 0 })), 'owner changes it');
  for (const who of ['owner-a', 'prin', 't1']) await allowed(get(who, path), 'read by ' + who);
  for (const who of ['parent-1', 'owner-b', null]) await denied(get(who, path), 'read by ' + who);
  for (const who of ['prin', 't1', 'parent-1', 'owner-b']) await denied(set(who, path, shift()), 'write by ' + who);
  for (const bad of [shift({ start: '9:00' }), shift({ end: '24:00' }), shift({ start: '17:00', end: '09:00' }), shift({ start: '09:00', end: '09:00' }),
    shift({ graceMin: 121 }), shift({ graceMin: -1 }), shift({ breakMin: 241 }), shift({ breakMin: 1.5 }), shift({ extra: 1 })]) {
    await denied(set('owner-a', path, bad), JSON.stringify(bad));
  }
  await denied(set('owner-a', path, { start: '09:00', end: '17:00' }), 'missing fields');
  await denied(remove('owner-a', path), 'delete');
});

test('dispute: a teacher sends one for a past day, with server time', async () => {
  await allowed(sendDispute('t1', 't1', dispute('t1')), 'yesterday, both times');
  await allowed(sendDispute('t1', 't1', dispute('t1', { date: TODAY, outTime: undefined }), disputePath('t1', TODAY)), 'today, in time only');
  await denied(sendDispute('t1', 't1', dispute('t1')), 'second one for the same day');
});

test('dispute: wrong people, dates and values are refused', async () => {
  await denied(sendDispute('t1', 't2', dispute('t2')), 'for another teacher');
  await denied(sendDispute('parent-1', 'parent-1', dispute('parent-1')), 'a parent');
  await denied(sendDispute('t1', 't1', dispute('t1', { date: istDay(2) }), disputePath('t1', istDay(2))), 'a future day');
  await denied(sendDispute('t1', 't1', dispute('t1', { date: istDay(-3) })), 'id does not match the date');
  await denied(sendDispute('t1', 't1', dispute('t1', { inTime: undefined, outTime: undefined })), 'no times');
  await denied(sendDispute('t1', 't1', dispute('t1', { inTime: '9:5' })), 'bad time');
  await denied(sendDispute('t1', 't1', dispute('t1', { outTime: '25:00' })), 'time past 24');
  await denied(sendDispute('t1', 't1', dispute('t1', { reason: 'no' })), 'reason too short');
  await denied(sendDispute('t1', 't1', dispute('t1', { reason: 'x'.repeat(301) })), 'reason too long');
  await denied(sendDispute('t1', 't1', dispute('t1', { status: 'approved' })), 'already approved');
  await denied(sendDispute('t1', 't1', { ...dispute('t1'), extra: 1 }), 'extra field');
  await denied(writeWithTime('t1', disputePath('t1'), dispute('t1'), null), 'no server time');
});

test('dispute: only the owner decides, once', async () => {
  await allowed(sendDispute('t1', 't1', dispute('t1')), 'sent');
  await denied(decide('prin', 't1', 'approved'), 'principal cannot decide');
  await denied(decide('t1', 't1', 'approved', { reviewedBy: 't1' }), 'teacher cannot approve own');
  await denied(decide('owner-a', 't1', 'approved', { reviewedBy: 'someone-else' }), 'wrong reviewer');
  await denied(decide('owner-a', 't1', 'open'), 'cannot set it back to open');
  await denied(decide('owner-a', 't1', 'approved', { reason: 'I changed the reason' }), 'cannot change the reason');
  await allowed(decide('owner-a', 't1', 'approved', { reviewNote: 'Checked with the gate register' }), 'owner approves');
  await denied(decide('owner-a', 't1', 'rejected'), 'a decided dispute cannot be decided again');
  await denied(remove('owner-a', disputePath('t1')), 'delete');
});

test('dispute: who can read what', async () => {
  await allowed(sendDispute('t1', 't1', dispute('t1')), 't1 sent');
  await allowed(sendDispute('t2', 't2', dispute('t2')), 't2 sent');
  for (const who of ['owner-a', 'prin', 't1']) await allowed(get(who, disputePath('t1')), 'get by ' + who);
  for (const who of ['t2', 'parent-1', 'owner-b', null]) await denied(get(who, disputePath('t1')), 'get by ' + who);
  await allowed(query('t1', A, 'attendanceDisputes', [['staffUid', 't1']]), 'teacher lists own');
  await denied(query('t1', A, 'attendanceDisputes', [['staffUid', 't2']]), 'teacher lists another');
  await denied(query('t1', A, 'attendanceDisputes', [['status', 'open']]), 'teacher lists everyone');
  await allowed(query('owner-a', A, 'attendanceDisputes', [['status', 'open']]), 'owner lists open');
  await allowed(query('prin', A, 'attendanceDisputes', [['status', 'open']]), 'principal lists open');
  await denied(query('parent-1', A, 'attendanceDisputes', [['status', 'open']]), 'parent lists');
});

test('check-in list: the owner can read a month with a date range', async () => {
  await allowed(send('t1', 't1', 'in', verified('t1', 'in')), 'check-in');
  const response = await fetch(`${base}/${A}:runQuery`, {
    method: 'POST', headers: headers('owner-a'),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'staffCheckins' }], where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: encode(TODAY.slice(0, 7) + '-01') } },
      { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL', value: encode(TODAY.slice(0, 7) + '-31') } }] } } } }),
  });
  await response.arrayBuffer();
  assert.equal(response.status, 200, 'owner month range');
});
