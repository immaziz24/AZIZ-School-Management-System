// Firestore rules tests for batch 62: complaints desk, appraisals and training, expense approval, scholarships, parent consent forms,
// staff self-service (features 142, 143, 147, 149, 151, 152). Synthetic records only.
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

const complaint = (extra = {}) => ({ title: 'Broken fan in room 4', raisedBy: 'Parent of Asha', date: TODAY, status: 'open', ...extra });
const appraisal = (extra = {}) => ({ staffName: 'Ravi Kumar', date: TODAY, rating: 4, ...extra });
const training = (extra = {}) => ({ staffName: 'Ravi Kumar', course: 'First aid', date: TODAY, hours: 6, ...extra });
const expense = (extra = {}) => ({ date: TODAY, category: 'Electricity', amount: 4200, ...extra });
const scheme = (extra = {}) => ({ name: 'Merit scholarship', amount: 6000, seats: 2, minPercent: 80, active: true, ...extra });
const app = (extra = {}) => ({ schemeId: 'SC-1', schemeName: 'Merit scholarship', studentId: 's1', studentName: 'Asha Rao', percent: 91, status: 'applied', appliedOn: TODAY, ...extra });
const form = (extra = {}) => ({ title: 'School picnic', text: 'Please allow your child to join the picnic on Saturday.', kind: 'trip', status: 'open', createdOn: TODAY, ...extra });
const answer = (who, formId, studentId, decision = 'yes', by = who) =>
  writeWithTime(who, `${A}/consentResponses/${formId}_${studentId}`, { formId, studentId, decision, by }, 'at');
const profile = (extra = {}) => ({ phone: '98765 43210', address: '12 School Road', emergencyName: 'Meena', emergencyPhone: '99999 11111', updatedOn: TODAY, ...extra });

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  const seed = [
    [`${A}/members/owner-a`, { role: 'owner', active: true }],
    [`${A}/members/prin`, { role: 'principal', active: true }],
    [`${A}/members/t1`, { role: 'teacher', active: true }],
    [`${A}/members/t2`, { role: 'teacher', active: true }],
    [`${A}/members/parent-1`, { role: 'parent', active: true }],
    [`${A}/members/parent-2`, { role: 'parent', active: true }],
    [`${B}/members/owner-b`, { role: 'owner', active: true }],
    [`${A}/familyAccess/parent-1`, { active: true, studentId: 's1' }],
    [`${A}/familyAccess/parent-2`, { active: true, studentId: 's2' }],
    [`${A}/students/s1`, { name: 'Asha Rao' }],
    [`${A}/students/s2`, { name: 'Bimal Das' }],
    [`${A}/scholarships/SC-1`, scheme()],
    [`${A}/payroll/t1_2026-10`, { staffUid: 't1', month: '2026-10', basic: 30000, allowances: 2000, deductions: 3000 }],
    [`${A}/payroll/t2_2026-10`, { staffUid: 't2', month: '2026-10', basic: 28000, allowances: 1000, deductions: 2000 }],
  ];
  for (const [seedPath, data] of seed) assert.equal(await set(ADMIN, seedPath, data), 200, seedPath);
});

test('complaints desk: assignment, priority, due date, response and the four statuses', async () => {
  const path = `${A}/complaints/CP-1`;
  await allowed(set('owner-a', path, complaint()), 'old shape still works');
  await allowed(set('owner-a', path, complaint({ status: 'in-progress', assignedTo: 'Ravi Kumar', priority: 'high', dueOn: istDay(3) })), 'assigned');
  await allowed(set('owner-a', path, complaint({ status: 'escalated', assignedTo: 'Ravi Kumar', priority: 'high', dueOn: istDay(-1) })), 'escalated');
  await allowed(set('owner-a', path, complaint({ status: 'resolved', response: 'Fan repaired', respondedOn: TODAY })), 'resolved with a response');
  for (const bad of [complaint({ status: 'closed' }), complaint({ priority: 'urgent' }), complaint({ dueOn: 'tomorrow' }), complaint({ assignedTo: 'x'.repeat(81) }),
    complaint({ response: 'x'.repeat(501) }), complaint({ respondedOn: 5 }), complaint({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/complaints/CP-2`, bad), JSON.stringify(bad).slice(0, 70));
  }
  for (const who of ['prin', 't1', 'parent-1', 'owner-b']) await denied(set(who, `${A}/complaints/CP-3`, complaint()), 'write by ' + who);
  await allowed(get('prin', path), 'principal reads');
});

test('appraisals and training: cycle, goals, status', async () => {
  await allowed(set('owner-a', `${A}/appraisals/AP-1`, appraisal()), 'old shape');
  await allowed(set('owner-a', `${A}/appraisals/AP-1`, appraisal({ cycle: '2026-27 Term 1', goals: 'Improve science lab practicals', status: 'submitted' })), 'new fields');
  await allowed(set('owner-a', `${A}/appraisals/AP-1`, appraisal({ status: 'approved' })), 'approved');
  for (const bad of [appraisal({ status: 'done' }), appraisal({ cycle: 'x'.repeat(41) }), appraisal({ goals: 'x'.repeat(301) }), appraisal({ rating: 6 })]) {
    await denied(set('owner-a', `${A}/appraisals/AP-2`, bad), JSON.stringify(bad).slice(0, 70));
  }
  await allowed(set('owner-a', `${A}/trainings/TR-1`, training()), 'training old shape');
  await allowed(set('owner-a', `${A}/trainings/TR-1`, training({ status: 'planned' })), 'planned');
  await denied(set('owner-a', `${A}/trainings/TR-2`, training({ status: 'cancelled' })), 'bad training status');
  await denied(set('prin', `${A}/appraisals/AP-3`, appraisal()), 'principal cannot write');
});

test('expenses: approval status, payment mode and vendor', async () => {
  await allowed(set('owner-a', `${A}/expenses/EX-1`, expense()), 'old shape');
  await allowed(set('owner-a', `${A}/expenses/EX-1`, expense({ status: 'pending', payMode: 'bank', vendor: 'City Power' })), 'pending');
  await allowed(set('owner-a', `${A}/expenses/EX-1`, expense({ status: 'approved', payMode: 'bank', vendor: 'City Power', decidedOn: TODAY })), 'approved');
  await allowed(set('owner-a', `${A}/expenses/EX-1`, expense({ status: 'rejected', decidedOn: TODAY })), 'rejected');
  for (const bad of [expense({ status: 'paid' }), expense({ payMode: 'card' }), expense({ vendor: 'x'.repeat(81) }), expense({ decidedOn: 'now' })]) {
    await denied(set('owner-a', `${A}/expenses/EX-2`, bad), JSON.stringify(bad).slice(0, 70));
  }
});

test('scholarship schemes: owner writes, principal reads, values checked', async () => {
  await allowed(set('owner-a', `${A}/scholarships/SC-2`, scheme({ criteria: 'Top ten percent of the class' })), 'owner saves');
  await allowed(get('prin', `${A}/scholarships/SC-2`), 'principal reads');
  for (const who of ['t1', 'parent-1', 'owner-b']) await denied(get(who, `${A}/scholarships/SC-2`), 'read by ' + who);
  for (const who of ['prin', 't1', 'parent-1', 'owner-b']) await denied(set(who, `${A}/scholarships/SC-3`, scheme()), 'write by ' + who);
  for (const bad of [scheme({ amount: 0 }), scheme({ seats: 0 }), scheme({ seats: 10001 }), scheme({ minPercent: 101 }), scheme({ minPercent: -1 }),
    scheme({ active: 'yes' }), scheme({ name: '   ' }), scheme({ criteria: 'x'.repeat(301) }), scheme({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/scholarships/SC-4`, bad), JSON.stringify(bad).slice(0, 70));
  }
  await denied(set('owner-a', `${A}/scholarships/bad id`, scheme()), 'bad id');
});

test('scholarship applications: need a real student and scheme, and a date when decided', async () => {
  await allowed(set('owner-a', `${A}/scholarshipApps/SA-1`, app()), 'application');
  await allowed(set('owner-a', `${A}/scholarshipApps/SA-1`, app({ status: 'approved', decidedOn: TODAY, note: 'Top of class' })), 'approved');
  await allowed(set('owner-a', `${A}/scholarshipApps/SA-2`, app({ status: 'rejected', decidedOn: TODAY, studentId: 's2', studentName: 'Bimal Das' })), 'rejected');
  await denied(set('owner-a', `${A}/scholarshipApps/SA-3`, app({ status: 'approved' })), 'approved without a date');
  await denied(set('owner-a', `${A}/scholarshipApps/SA-3`, app({ studentId: 'nobody' })), 'student does not exist');
  await denied(set('owner-a', `${A}/scholarshipApps/SA-3`, app({ schemeId: 'SC-99' })), 'scheme does not exist');
  for (const bad of [app({ percent: 101 }), app({ status: 'maybe' }), app({ studentName: '' }), app({ note: 'x'.repeat(201) }), app({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/scholarshipApps/SA-4`, bad), JSON.stringify(bad).slice(0, 70));
  }
  for (const who of ['prin', 't1', 'parent-1']) await denied(set(who, `${A}/scholarshipApps/SA-5`, app()), 'write by ' + who);
  await allowed(get('prin', `${A}/scholarshipApps/SA-1`), 'principal reads');
  await denied(get('t1', `${A}/scholarshipApps/SA-1`), 'teacher cannot read');
});

test('scholarship approval: the application and the fee concession can be saved together', async () => {
  const response = await fetch(`http://${host}/v1/${projectPath}:commit`, {
    method: 'POST', headers: headers('owner-a'),
    body: JSON.stringify({ writes: [
      { update: { name: `${projectPath}/${A}/scholarshipApps/SA-1`, fields: fields(app({ status: 'approved', decidedOn: TODAY })) } },
      { update: { name: `${projectPath}/${A}/concessions/CN-SA-1`, fields: fields({ studentId: 's1', studentName: 'Asha Rao', kind: 'Scholarship', amount: 6000, givenOn: TODAY, note: 'Merit scholarship' }) } },
    ] }),
  });
  await response.arrayBuffer();
  assert.equal(response.status, 200, 'batch of two writes');
});

test('consent forms: the owner writes, linked families and the principal read', async () => {
  await allowed(set('owner-a', `${A}/consentForms/CF-1`, form()), 'owner creates');
  await allowed(set('owner-a', `${A}/consentForms/CF-2`, form({ kind: 'photo', dueOn: istDay(5) })), 'with a due date');
  for (const who of ['owner-a', 'prin', 'parent-1', 'parent-2']) await allowed(get(who, `${A}/consentForms/CF-1`), 'read by ' + who);
  for (const who of ['t1', 'owner-b', null]) await denied(get(who, `${A}/consentForms/CF-1`), 'read by ' + who);
  for (const who of ['prin', 't1', 'parent-1', 'owner-b']) await denied(set(who, `${A}/consentForms/CF-3`, form()), 'write by ' + who);
  for (const bad of [form({ kind: 'party' }), form({ status: 'draft' }), form({ title: '' }), form({ text: '   ' }), form({ text: 'x'.repeat(1001) }),
    form({ dueOn: 'soon' }), form({ extra: 1 })]) {
    await denied(set('owner-a', `${A}/consentForms/CF-4`, bad), JSON.stringify(bad).slice(0, 70));
  }
  await denied(set('owner-a', `${A}/consentForms/form-5`, form()), 'bad id');
});

test('consent answers: a parent answers for their own child, once open, and can change it', async () => {
  await allowed(set('owner-a', `${A}/consentForms/CF-1`, form()), 'form');
  await allowed(answer('parent-1', 'CF-1', 's1', 'yes'), 'own child');
  await allowed(answer('parent-1', 'CF-1', 's1', 'no'), 'changes the answer');
  await denied(answer('parent-1', 'CF-1', 's2', 'yes'), "another parent's child");
  await denied(answer('parent-2', 'CF-1', 's1', 'yes'), "another parent's child, the other way");
  await denied(answer('parent-1', 'CF-1', 's1', 'maybe'), 'bad decision');
  await denied(answer('parent-1', 'CF-1', 's1', 'yes', 'someone-else'), 'answer in another name');
  await denied(answer('t1', 'CF-1', 's1', 'yes'), 'a teacher');
  await denied(answer('parent-1', 'CF-9', 's1', 'yes'), 'a form that does not exist');
  await denied(writeWithTime('parent-1', `${A}/consentResponses/CF-1_s1`, { formId: 'CF-1', studentId: 's1', decision: 'yes', by: 'parent-1' }, null), 'no server time');
  await denied(set('parent-1', `${A}/consentResponses/CF-1_s1`, { formId: 'CF-1', studentId: 's1', decision: 'yes', by: 'parent-1', extra: 1 }), 'extra field');
  await denied(remove('parent-1', `${A}/consentResponses/CF-1_s1`), 'delete');
  await denied(remove('owner-a', `${A}/consentResponses/CF-1_s1`), 'owner delete');
});

test('consent answers: a closed form takes no new or changed answers', async () => {
  await allowed(set('owner-a', `${A}/consentForms/CF-1`, form()), 'form');
  await allowed(answer('parent-1', 'CF-1', 's1', 'yes'), 'answer while open');
  await allowed(set('owner-a', `${A}/consentForms/CF-1`, form({ status: 'closed' })), 'owner closes it');
  await denied(answer('parent-1', 'CF-1', 's1', 'no'), 'change after closing');
  await denied(answer('parent-2', 'CF-1', 's2', 'yes'), 'new answer after closing');
  await allowed(set('owner-a', `${A}/consentForms/CF-1`, form({ status: 'open' })), 'owner reopens it');
  await allowed(answer('parent-2', 'CF-1', 's2', 'yes'), 'new answer after reopening');
});

test('consent answers: who can read them', async () => {
  await allowed(set('owner-a', `${A}/consentForms/CF-1`, form()), 'form');
  await allowed(answer('parent-1', 'CF-1', 's1', 'yes'), 'p1 answers');
  await allowed(answer('parent-2', 'CF-1', 's2', 'no'), 'p2 answers');
  for (const who of ['owner-a', 'prin', 'parent-1']) await allowed(get(who, `${A}/consentResponses/CF-1_s1`), 'get by ' + who);
  for (const who of ['parent-2', 't1', 'owner-b', null]) await denied(get(who, `${A}/consentResponses/CF-1_s1`), 'get by ' + who);
  await allowed(query('owner-a', A, 'consentResponses', [['formId', 'CF-1']]), 'owner lists a form');
  await allowed(query('prin', A, 'consentResponses', [['formId', 'CF-1']]), 'principal lists a form');
  await allowed(query('parent-1', A, 'consentResponses', [['by', 'parent-1']]), 'parent lists own');
  await denied(query('parent-1', A, 'consentResponses', [['by', 'parent-2']]), 'parent lists another');
  await denied(query('parent-1', A, 'consentResponses', [['formId', 'CF-1']]), 'parent lists every answer');
  await denied(query('t1', A, 'consentResponses', [['formId', 'CF-1']]), 'teacher lists');
});

test('staff profile: a teacher keeps their own, the owner and principal read all', async () => {
  const path = (uid) => `${A}/staffProfiles/${uid}`;
  await allowed(set('t1', path('t1'), profile()), 'teacher saves own');
  await allowed(set('t1', path('t1'), profile({ phone: '+91 98765 43210' })), 'teacher changes own');
  await allowed(set('t2', path('t2'), { updatedOn: TODAY }), 'only the date');
  await denied(set('t1', path('t2'), profile()), "another teacher's");
  await denied(set('parent-1', path('parent-1'), profile()), 'a parent');
  await denied(set('owner-a', path('t1'), profile()), 'owner writes it for them');
  for (const bad of [profile({ phone: 'call me' }), profile({ emergencyPhone: 'abc' }), profile({ address: 'x'.repeat(201) }),
    profile({ emergencyName: 'x'.repeat(81) }), profile({ updatedOn: 'today' }), profile({ extra: 1 })]) {
    await denied(set('t1', path('t1'), bad), JSON.stringify(bad).slice(0, 70));
  }
  await denied(set('t1', path('t1'), { phone: '12345' }), 'no date');
  for (const who of ['owner-a', 'prin', 't1']) await allowed(get(who, path('t1')), 'get by ' + who);
  for (const who of ['t2', 'parent-1', 'owner-b', null]) await denied(get(who, path('t1')), 'get by ' + who);
  const list = (who) => fetch(`${base}/${A}/staffProfiles`, { headers: headers(who) }).then(async (r) => { await r.arrayBuffer(); return r.status; });
  await allowed(list('owner-a'), 'owner lists');
  await allowed(list('prin'), 'principal lists');
  await denied(list('t1'), 'teacher lists');
  await denied(remove('t1', path('t1')), 'delete');
});

test('payroll: a teacher reads only their own salary records', async () => {
  await allowed(get('t1', `${A}/payroll/t1_2026-10`), 'own record');
  await denied(get('t1', `${A}/payroll/t2_2026-10`), "another teacher's record");
  await allowed(query('t1', A, 'payroll', [['staffUid', 't1']]), 'lists own');
  await denied(query('t1', A, 'payroll', [['staffUid', 't2']]), "lists another's");
  await denied(query('t1', A, 'payroll', [['month', '2026-10']]), 'lists the whole month');
  await denied(get('parent-1', `${A}/payroll/t1_2026-10`), 'parent');
  await allowed(get('owner-a', `${A}/payroll/t1_2026-10`), 'owner');
  await denied(get('prin', `${A}/payroll/t1_2026-10`), 'principal while the switch is off');
  await denied(set('t1', `${A}/payroll/t1_2026-11`, { staffUid: 't1', month: '2026-11', basic: 99999, allowances: 0, deductions: 0 }), 'teacher cannot write payroll');
});
