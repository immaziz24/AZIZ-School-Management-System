// Firestore rules tests for the school location and teacher check-in (features 128, 130, 158). Synthetic records only.
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
  const response = await fetch(`http://${host}/v1/${projectPath}:commit`, {
    method: 'POST', headers: headers(who),
    body: JSON.stringify({ writes: [{
      update: { name: `${projectPath}/${path}`, fields: fields(data) },
      ...(timeField ? { updateTransforms: [{ fieldPath: timeField, setToServerValue: 'REQUEST_TIME' }] } : {}),
    }] }),
  });
  await response.arrayBuffer();
  return response.status;
};
const place = (extra = {}) => ({ lat: LAT, lng: LNG, radiusM: 30, maxAccuracyM: 50, tzMinutes: 330, setBy: 'super', ...extra });
const saveLocation = (who, school, data, timeField = 'setOn') => writeWithTime(who, `${school}/settings/location`, data, timeField);
const checkinPath = (uid, kind, day = TODAY, school = A) => `${school}/staffCheckins/${day}_${uid}_${kind}`;
const verified = (uid, kind, where = {}, extra = {}) => ({
  staffUid: uid, date: TODAY, kind, lat: north(5), lng: LNG, accuracy: 12, status: 'verified', ...where, ...extra,
});
const send = (who, uid, kind, data, day = TODAY, school = A) => writeWithTime(who, checkinPath(uid, kind, day, school), data, 'at');

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
    [`${B}/members/t-b`, { role: 'teacher', active: true }],
    [`platformAdmins/super`, { email: 'super@example.test' }],
    [`${A}/settings/location`, { lat: LAT, lng: LNG, radiusM: 30, maxAccuracyM: 50, tzMinutes: 330, setBy: 'super', setOn: '2026-01-01T00:00:00Z' }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('location: only the platform administrator saves it, with sane values', async () => {
  await allowed(saveLocation('super', B, place()), 'platform admin saves');
  await allowed(saveLocation('super', B, place({ radiusM: 120, maxAccuracyM: 80 })), 'larger radius');
  for (const bad of [place({ radiusM: 29 }), place({ radiusM: 501 }), place({ maxAccuracyM: 9 }), place({ maxAccuracyM: 101 }),
    place({ tzMinutes: 841 }), place({ tzMinutes: -60 }), place({ lat: 70 }), place({ lat: 'north' }), place({ lng: 181 }),
    place({ setBy: 'someone-else' }), place({ extra: 1 })]) {
    await denied(saveLocation('super', B, bad), JSON.stringify(bad).slice(0, 80));
  }
  await denied(saveLocation('super', B, place(), null), 'no server time');
  for (const who of ['owner-a', 'prin', 't1', 'parent-1', 'owner-b', null]) await denied(saveLocation(who, A, place({ setBy: who ?? 'x' })), 'write by ' + who);
});

test('location: readable by the school and the platform administrator, never deleted', async () => {
  for (const who of ['owner-a', 'prin', 't1', 'super']) await allowed(get(who, `${A}/settings/location`), 'read by ' + who);
  for (const who of ['parent-1', 'owner-b', null]) await denied(get(who, `${A}/settings/location`), 'read by ' + who);
  for (const who of ['super', 'owner-a']) await denied(remove(who, `${A}/settings/location`), 'delete by ' + who);
});

test('check-in: a teacher inside the distance is accepted once', async () => {
  await allowed(send('t1', 't1', 'in', verified('t1', 'in', { lat: north(25) })), 'inside 25 m');
  await denied(send('t1', 't1', 'in', verified('t1', 'in')), 'a second check-in the same day');
  await allowed(send('t2', 't2', 'in', verified('t2', 'in', { lat: LAT, lng: east(29) })), 'east, 29 m');
});

test('check-in: outside the distance is refused, in every direction', async () => {
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { lat: north(31) })), '31 m north');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { lat: LAT, lng: east(31) })), '31 m east');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { lat: LAT - 35 / 111320, lng: LNG })), '35 m south');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { lat: north(500), lng: LNG })), '500 m away');
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { lat: 0, lng: 0 })), 'far away');
});

test('check-in: a distance of 60 metres is allowed only where the school sets it', async () => {
  await denied(send('t1', 't1', 'in', verified('t1', 'in', { lat: north(60) })), '60 m with 30 m rule');
  await allowed(saveLocation('super', A, place({ radiusM: 100 })), 'school allows 100 m');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in', { lat: north(60) })), '60 m with 100 m rule');
});

test('check-in: the distance is also right far from the equator', async () => {
  await allowed(saveLocation('super', B, place({ lat: 60, lng: 10 })), 'school at 60 degrees north');
  const at = (metres) => ({ staffUid: 't-b', date: TODAY, kind: 'in', lat: 60, lng: 10 + metres / (111320 * 0.5), accuracy: 10, status: 'verified' });
  await allowed(send('t-b', 't-b', 'in', at(25), TODAY, B), '25 m east at 60 degrees');
  await set(ADMIN, `${B}/members/t-b2`, { role: 'teacher', active: true });
  await denied(send('t-b2', 't-b2', 'in', { ...at(35), staffUid: 't-b2' }, TODAY, B), '35 m east at 60 degrees');
});

test('check-in: weak GPS, wrong day, wrong id and extra fields are refused', async () => {
  await denied(send('t1', 't1', 'in', verified('t1', 'in', {}, { accuracy: 60 })), 'accuracy 60 m');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in', {}, { accuracy: 50 })), 'accuracy exactly 50 m');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', { date: istDay(-1) }), istDay(-1)), 'yesterday');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', { date: istDay(1) }), istDay(1)), 'tomorrow');
  await denied(send('t2', 't2', 'in', verified('t2', 'in'), istDay(-2)), 'id date differs from the record date');
  await denied(send('t2', 't2', 'in', verified('t2', 'out'), TODAY), 'record says out but id says in');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', { staffUid: 't1' })), 'someone else as the teacher');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', {}, { note: 'hi' })), 'extra field');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', {}, { status: 'approved' })), 'approved by the teacher');
  await denied(writeWithTime('t2', checkinPath('t2', 'in'), verified('t2', 'in', {}, { at: '2020-01-01T00:00:00Z' }), undefined), 'no server time at all');
  await denied(send('t2', 't2', 'in', verified('t2', 'in', {}, { lat: 'here' })), 'text for position');
});

test('check-out: needs a check-in first, then is accepted once', async () => {
  await denied(send('t1', 't1', 'out', verified('t1', 'out')), 'out before in');
  await allowed(send('t1', 't1', 'in', verified('t1', 'in')), 'in');
  await allowed(send('t1', 't1', 'out', verified('t1', 'out')), 'out');
  await denied(send('t1', 't1', 'out', verified('t1', 'out')), 'out twice');
  await denied(send('t1', 't1', 'out', verified('t1', 'out', { lat: north(100) })), 'out too far (still refused)');
});

test('check-in: only an active teacher of that school, with a saved school location', async () => {
  for (const who of ['owner-a', 'prin', 'parent-1', 'owner-b', null]) await denied(send(who, who ?? 'x', 'in', verified(who ?? 'x', 'in')), 'check-in by ' + who);
  await denied(send('t-b', 't-b', 'in', { staffUid: 't-b', date: TODAY, kind: 'in', lat: LAT, lng: LNG, accuracy: 10, status: 'verified' }, TODAY, B), 'school with no location');
  await set(ADMIN, `${A}/members/t1`, { role: 'teacher', active: false });
  await denied(send('t1', 't1', 'in', verified('t1', 'in')), 'switched-off teacher');
});

test('check-in: a teacher whose GPS failed can send one for review', async () => {
  const review = (uid, kind, extra = {}) => ({ staffUid: uid, date: TODAY, kind, status: 'review', reason: 'gps-weak', ...extra });
  await allowed(send('t3', 't3', 'in', review('t3', 'in', { lat: north(10), lng: LNG, accuracy: 120, note: 'Basement office' })), 'weak GPS');
  await allowed(send('t2', 't2', 'in', review('t2', 'in', { reason: 'gps-denied' })), 'GPS denied');
  await denied(send('t1', 't1', 'in', review('t1', 'in', { reason: 'tired' })), 'made-up reason');
  await denied(send('t1', 't1', 'in', review('t1', 'in', { note: 'n'.repeat(201) })), 'long note');
  await denied(send('t1', 't1', 'in', review('t1', 'in', { lat: 120, lng: LNG })), 'impossible latitude');
  await denied(send('t1', 't1', 'in', review('t1', 'in', { status: 'approved' })), 'approved by the teacher');
  await denied(send('t1', 't1', 'in', review('t1', 'in', { extra: 1 })), 'extra field');
  await denied(send('t3', 't3', 'in', review('t3', 'in')), 'second review for the same check-in');
  await denied(send('t1', 't1', 'out', review('t1', 'out')), 'review check-out without a check-in');
});

test('check-in: who can read the records', async () => {
  await send('t1', 't1', 'in', verified('t1', 'in'));
  await send('t2', 't2', 'in', verified('t2', 'in'));
  await allowed(get('t1', checkinPath('t1', 'in')), 'teacher reads own');
  assert.equal(await get('t1', checkinPath('t1', 'out')), 404, 'teacher may ask for own check-out that does not exist yet');
  await denied(get('t1', checkinPath('t2', 'in')), 'teacher reads a colleague');
  await allowed(get('owner-a', checkinPath('t2', 'in')), 'owner reads');
  await allowed(get('prin', checkinPath('t2', 'in')), 'principal reads');
  await allowed(query('owner-a', A, 'staffCheckins', [['date', TODAY]]), 'owner lists a day');
  await allowed(query('prin', A, 'staffCheckins', [['date', TODAY]]), 'principal lists a day');
  for (const who of ['t1', 'parent-1', 'owner-b', null]) await denied(query(who, A, 'staffCheckins', [['date', TODAY]]), 'list by ' + who);
  for (const who of ['parent-1', 'owner-b', null]) await denied(get(who, checkinPath('t1', 'in')), 'read by ' + who);
});

test('check-in: the owner decides a review once; nothing else can change; nothing is deleted', async () => {
  const review = { staffUid: 't3', date: TODAY, kind: 'in', status: 'review', reason: 'gps-weak', lat: north(10), lng: LNG, accuracy: 120 };
  await allowed(send('t3', 't3', 'in', review), 'review sent');
  await send('t1', 't1', 'in', verified('t1', 'in'));
  const path = checkinPath('t3', 'in');
  const stored = async () => ({ ...review, at: '2026-01-01T00:00:00Z' });
  for (const who of ['t3', 'prin', 'parent-1', 'owner-b', null]) await denied(set(who, path, { ...(await stored()), status: 'approved', reviewedBy: who ?? 'x' }), 'decision by ' + who);
  // The owner's write replaces the whole record, so the app sends the stored record back with the new status.
  await set(ADMIN, path, { ...review, at: '2026-01-01T00:00:00Z' });
  await denied(set('owner-a', path, { ...(await stored()), status: 'approved', reviewedBy: 'someone-else' }), 'reviewer is not the owner');
  await denied(set('owner-a', path, { ...(await stored()), status: 'verified', reviewedBy: 'owner-a' }), 'owner cannot mark verified');
  await denied(set('owner-a', path, { ...(await stored()), status: 'approved', reviewedBy: 'owner-a', lat: LAT }), 'owner cannot change the position');
  await denied(set('owner-a', path, { ...(await stored()), status: 'approved', reviewedBy: 'owner-a', reviewNote: 'n'.repeat(201) }), 'long note');
  await allowed(set('owner-a', path, { ...(await stored()), status: 'approved', reviewedBy: 'owner-a', reviewNote: 'Seen in the staff room' }), 'owner approves');
  await denied(set('owner-a', path, { ...(await stored()), status: 'rejected', reviewedBy: 'owner-a' }), 'an approved record is final');
  await denied(set('owner-a', checkinPath('t1', 'in'), { ...verified('t1', 'in'), at: '2026-01-01T00:00:00Z', status: 'rejected', reviewedBy: 'owner-a' }), 'owner cannot reject a verified record');
  for (const who of ['owner-a', 'super', 't3', 'prin']) await denied(remove(who, path), 'delete by ' + who);
});
