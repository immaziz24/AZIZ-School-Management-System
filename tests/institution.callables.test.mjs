// Server-function tests (Phase 5), run against the Firestore emulator with the REAL function code. They prove: cross-account denial, role escalation denial,
// teacher assigned/unassigned batches, the quota boundary under concurrent requests, payment retries, attendance repeats, marks range, suspension and admin audit.
// Run through firebase emulators:exec (see run-tests.cmd). Synthetic records only.
import { test, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz'; if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
process.env.GCLOUD_PROJECT = project;
const require = createRequire(fileURLToPath(new URL('../functions/index.js', import.meta.url)));
let fn; let db; let Timestamp;
before(async () => { const fs = require('firebase-admin/firestore'); fn = require('./index.js'); db = fs.getFirestore(); Timestamp = fs.Timestamp; });

const A = 'ins-aaaaaaaaaaaaaaaaaaaa'; const B = 'ins-bbbbbbbbbbbbbbbbbbbb'; const C = 'ins-cccccccccccccccccccc';
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@example.com', email_verified: true } } : undefined, data });
const run = (name, uid, data) => fn[name].run(req(uid, data));
const code = async (promise) => { try { await promise; return 'ok'; } catch (e) { return e.code || String(e.message); } };
const today = new Date().toISOString().slice(0, 10);
const student = (n) => ({ name: 'Student ' + n, className: 'Class 9', guardianName: 'Guardian ' + n, guardianMobile: '9830012345', joiningDate: today, monthlyFee: '500', dueDay: 5, subjects: ['English'] });
const batchValues = (n) => ({ name: 'Batch ' + n, className: 'Class 9', subjects: ['English'], days: ['Mon'], startTime: '16:00', endTime: '17:00' });
const inst = (type, over = {}) => ({ type, name: 'Test ' + type, status: 'active', ownerUid: 'owner-' + type, ownerEmail: 'o@example.com', planId: type + '_free', entitlementVersion: 1, createdAt: Timestamp.now(),
  limits: { activeStudents: 250, owners: 1, extraTeachers: 5, batches: 20, storageBytes: 50 * 1048576 }, usage: { activeStudents: 0, batches: 0, extraTeachers: 0, storageBytes: 0 }, profile: {}, ...over });
const member = (uid, tenantId, role, extra = {}) => db.doc('memberships/' + uid + '_' + tenantId).set({ uid, tenantId, role, status: 'active', ...extra });

async function wipe() { await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' }); }
beforeEach(async () => {
  await wipe();
  await db.doc('institutions/' + A).set(inst('tuition')); await member('owner-a', A, 'owner');
  await db.doc('institutions/' + B).set(inst('tuition', { ownerUid: 'owner-b' })); await member('owner-b', B, 'owner');
  await db.doc('institutions/' + C).set(inst('coaching', { ownerUid: 'owner-c' })); await member('owner-c', C, 'owner'); await member('teach-c', C, 'teacher', { teacherId: 'TC-TEACH0001' });
  await db.doc('institutions/' + C + '/teachers/TC-TEACH0001').set({ name: 'T One', email: 't@example.com', status: 'active', uid: 'teach-c', subjects: [] });
  await db.doc('institutions/' + C + '/batches/BT-ASSIGNED01').set({ name: 'Mine', className: 'Class 9', subjects: ['English'], days: ['Mon'], startTime: '16:00', endTime: '17:00', status: 'active', teacherIds: ['TC-TEACH0001'], feePaise: 150000 });
  await db.doc('institutions/' + C + '/batches/BT-OTHER00001').set({ name: 'Not mine', className: 'Class 9', subjects: ['English'], days: ['Mon'], startTime: '16:00', endTime: '17:00', status: 'active', teacherIds: [], feePaise: 150000 });
  await db.doc('platformAdmins/root-admin').set({ active: true });
});

test('cross-account: an owner cannot read or write another institution, and a visitor cannot call anything', async () => {
  assert.equal(await code(run('tuitionStudentList', 'owner-a', { tenantId: B })), 'permission-denied');
  assert.equal(await code(run('tuitionStudentSave', 'owner-a', { tenantId: B, values: student(1) })), 'permission-denied');
  assert.equal((await db.collection('institutions/' + B + '/students').get()).size, 0);
  assert.equal(await code(run('tuitionStudentList', null, { tenantId: A })), 'unauthenticated');
  assert.equal(await code(run('tuitionStudentList', 'owner-a', { tenantId: 'ins-zzzz' })), 'invalid-argument');
});

test('role escalation: a teacher cannot use owner-only functions, and a client-sent role changes nothing', async () => {
  for (const [name, data] of [['tuitionStudentSave', { values: student(1) }], ['tuitionPaymentRecord', {}], ['coachingTeacherSave', { values: { name: 'X Y', email: 'x@y.in' } }], ['coachingAssign', { batchId: 'BT-ASSIGNED01', teacherIds: [] }], ['institutionProfileSave', { values: {} }], ['coachingFeesByBatch', {}]])
    assert.equal(await code(run(name, 'teach-c', { tenantId: C, ...data })), 'permission-denied', name);
  assert.equal(await code(run('tuitionStudentList', 'owner-a', { tenantId: A, role: 'owner', uid: 'owner-b' })), 'ok');
  for (const name of ['adminInstitutionList', 'adminInstitutionSetStatus', 'adminInstitutionPrivateAccess', 'adminInstitutionSetLimits']) assert.equal(await code(run(name, 'owner-a', { tenantId: A })), 'permission-denied', name);
});

test('teacher: sees and marks only assigned batches, and never sees fees', async () => {
  const list = await run('tuitionBatchList', 'teach-c', { tenantId: C }); assert.deepEqual(list.items.map((b) => b.id), ['BT-ASSIGNED01']); assert.equal(list.items[0].feePaise, undefined);
  assert.equal(await code(run('tuitionAttendanceGet', 'teach-c', { tenantId: C, batchId: 'BT-ASSIGNED01', date: today })), 'ok');
  assert.equal(await code(run('tuitionAttendanceGet', 'teach-c', { tenantId: C, batchId: 'BT-OTHER00001', date: today })), 'permission-denied');
  assert.equal(await code(run('tuitionAttendanceMark', 'teach-c', { tenantId: C, batchId: 'BT-OTHER00001', date: today, entries: [{ studentId: 'ST-ABC123', status: 'present' }] })), 'permission-denied');
  assert.equal(await code(run('tuitionAttendanceHistory', 'teach-c', { tenantId: C, batchId: 'BT-OTHER00001', from: today, to: today })), 'permission-denied');
  assert.equal(await code(run('coachingExamSave', 'teach-c', { tenantId: C, values: { name: 'Test', batchId: 'BT-OTHER00001', date: today, maxMarks: 50 } })), 'permission-denied');
  assert.equal(await code(run('tuitionBatchList', 'owner-c', { tenantId: C })), 'ok'); assert.equal((await run('tuitionBatchList', 'owner-c', { tenantId: C })).items.length, 2);
});

test('a teacher of a tuition account is refused (teachers exist only in coaching)', async () => {
  await member('teach-a', A, 'teacher', { teacherId: 'TC-X0000001' });
  assert.equal(await code(run('tuitionBatchList', 'teach-a', { tenantId: A })), 'permission-denied');
});

test('quota boundary under concurrent requests: with room for one more student, exactly one of two simultaneous saves wins', async () => {
  await db.doc('institutions/' + A).update({ limits: { activeStudents: 3, owners: 1, extraTeachers: 0, batches: 10, storageBytes: 10485760 }, 'usage.activeStudents': 2 });
  const r = await Promise.allSettled([run('tuitionStudentSave', 'owner-a', { tenantId: A, values: student(1) }), run('tuitionStudentSave', 'owner-a', { tenantId: A, values: student(2) })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1, JSON.stringify(r.map((x) => x.status)));
  assert.equal(r.find((x) => x.status === 'rejected').reason.code, 'resource-exhausted');
  assert.equal((await db.doc('institutions/' + A).get()).data().usage.activeStudents, 3); assert.equal((await db.collection('institutions/' + A + '/students').get()).size, 1);
});

test('batch quota boundary under concurrent requests', async () => {
  await db.doc('institutions/' + A).update({ 'limits.batches': 1 });
  const r = await Promise.allSettled([run('tuitionBatchSave', 'owner-a', { tenantId: A, values: batchValues(1) }), run('tuitionBatchSave', 'owner-a', { tenantId: A, values: batchValues(2) })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1); assert.equal((await db.doc('institutions/' + A).get()).data().usage.batches, 1);
});

test('payments: a retried request with the same key records one payment and one receipt', async () => {
  const s = await run('tuitionStudentSave', 'owner-a', { tenantId: A, values: student(1) });
  const pay = { tenantId: A, studentId: s.studentId, amount: '200', method: 'cash', paidOn: today, idempotencyKey: 'retry-key-0001' };
  const [x, y] = await Promise.all([run('tuitionPaymentRecord', 'owner-a', pay), run('tuitionPaymentRecord', 'owner-a', pay)]);
  assert.equal(x.receiptNo, y.receiptNo); assert.equal((await run('tuitionPaymentRecord', 'owner-a', pay)).duplicate, true);
  assert.equal((await db.collection('institutions/' + A + '/payments').get()).size, 1); assert.equal((await db.collection('institutions/' + A + '/receipts').get()).size, 1);
  const charge = (await db.collection('institutions/' + A + '/feeCharges').get()).docs[0].data(); assert.equal(charge.paidPaise, 20000); assert.equal(charge.balancePaise, 30000);
  assert.equal(await code(run('tuitionPaymentRecord', 'owner-a', { ...pay, idempotencyKey: 'new-key-00002', amount: '-5' })), 'invalid-argument');
});

test('attendance: marking the same day twice keeps one record per student and logs a correction', async () => {
  await db.doc('institutions/' + A + '/batches/BT-ATT000001').set({ ...batchValues(1), status: 'active', teacherIds: [] });
  const s = await run('tuitionStudentSave', 'owner-a', { tenantId: A, values: { ...student(1), batchId: 'BT-ATT000001' } });
  const mark = (status) => run('tuitionAttendanceMark', 'owner-a', { tenantId: A, batchId: 'BT-ATT000001', date: today, entries: [{ studentId: s.studentId, status }] });
  await mark('present'); const second = await mark('absent'); assert.equal(second.corrected, 1);
  assert.equal((await db.collection('institutions/' + A + '/attendance').get()).size, 1);
  assert.equal(await code(run('tuitionAttendanceMark', 'owner-a', { tenantId: A, batchId: 'BT-ATT000001', date: '2999-01-01', entries: [{ studentId: s.studentId, status: 'present' }] })), 'invalid-argument');
});

test('marks: out-of-range marks are refused, absent is kept, and the maximum cannot change afterwards', async () => {
  await db.doc('institutions/' + C + '/students/ST-ONE000001').set({ name: 'One', status: 'active', batchId: 'BT-ASSIGNED01', guardianName: 'G', guardianMobile: '9830012345', className: 'Class 9' });
  await db.doc('institutions/' + C + '/students/ST-TWO000001').set({ name: 'Two', status: 'active', batchId: 'BT-ASSIGNED01', guardianName: 'G', guardianMobile: '9830012345', className: 'Class 9' });
  const e = await run('coachingExamSave', 'teach-c', { tenantId: C, values: { name: 'Unit test', batchId: 'BT-ASSIGNED01', date: today, maxMarks: 50 } });
  const save = (entries) => run('coachingMarksSave', 'teach-c', { tenantId: C, examId: e.examId, entries });
  assert.equal(await code(save([{ studentId: 'ST-ONE000001', marks: '51' }])), 'invalid-argument'); assert.equal(await code(save([{ studentId: 'ST-ONE000001', marks: '-1' }])), 'invalid-argument');
  assert.equal(await code(save([{ studentId: 'ST-NOPE00001', marks: '10' }])), 'invalid-argument');
  assert.equal((await save([{ studentId: 'ST-ONE000001', marks: '42.5' }, { studentId: 'ST-TWO000001', marks: '' }])).saved, 2);
  const got = await run('coachingMarksGet', 'teach-c', { tenantId: C, examId: e.examId }); assert.equal(got.summary.absent, 1); assert.equal(got.summary.highest, 42.5);
  assert.equal(await code(run('coachingExamSave', 'teach-c', { tenantId: C, examId: e.examId, values: { name: 'Unit test', batchId: 'BT-ASSIGNED01', date: today, maxMarks: 100 } })), 'failed-precondition');
});

test('a switched-off feature is refused, and suspension stops every action', async () => {
  await db.doc('institutions/' + C).update({ 'features.exams': false });
  assert.equal(await code(run('coachingExamList', 'owner-c', { tenantId: C })), 'failed-precondition'); assert.equal(await code(run('coachingNoticeList', 'owner-c', { tenantId: C })), 'ok');
  await db.doc('institutions/' + A).update({ status: 'suspended' });
  for (const name of ['tuitionDashboard', 'tuitionStudentList', 'tuitionBatchList']) assert.equal(await code(run(name, 'owner-a', { tenantId: A })), 'failed-precondition', name);
  assert.equal(await code(run('tuitionStudentSave', 'owner-a', { tenantId: A, values: student(1) })), 'failed-precondition');
  await db.doc('institutions/' + A).update({ status: 'active' }); assert.equal(await code(run('tuitionStudentList', 'owner-a', { tenantId: A })), 'ok');
});

test('an inactive teacher membership is refused', async () => {
  await db.doc('memberships/teach-c_' + C).update({ status: 'inactive' });
  assert.equal(await code(run('tuitionBatchList', 'teach-c', { tenantId: C })), 'permission-denied');
});

test('admin: suspension needs a reason, is audited, and private access is audited before data is returned', async () => {
  assert.equal(await code(run('adminInstitutionPrivateAccess', 'root-admin', { tenantId: A, kind: 'students', reason: '' })), 'invalid-argument');
  assert.equal((await db.collection('platformAudit').get()).size, 0);
  await run('adminInstitutionSetStatus', 'root-admin', { tenantId: A, status: 'suspended', reason: 'Payment dispute' });
  const a = (await db.collection('platformAudit').where('tenantId', '==', A).get()).docs.map((d) => d.data()); assert.equal(a.length, 1); assert.equal(a[0].action, 'institution-suspended'); assert.equal(a[0].reason, 'Payment dispute'); assert.equal(a[0].actor, 'root-admin');
  assert.equal((await db.doc('institutions/' + A).get()).data().status, 'suspended');
  assert.equal(await code(run('adminInstitutionPrivateAccess', 'root-admin', { tenantId: A, kind: 'students', reason: '' })), 'invalid-argument');
  assert.equal((await db.collection('platformAudit').where('action', '==', 'private-access-students').get()).size, 0);
  const r = await run('adminInstitutionPrivateAccess', 'root-admin', { tenantId: A, kind: 'students', reason: 'Support ticket 1234' }); assert.equal(r.logged, true);
  assert.equal((await db.collection('platformAudit').where('action', '==', 'private-access-students').get()).size, 1);
});

test('admin quotas: bad numbers refused, good ones saved with a new version and history; new accounts use the saved free plan', async () => {
  assert.equal(await code(run('adminInstitutionSetLimits', 'root-admin', { tenantId: A, reason: 'Pilot', limits: { activeStudents: -5, extraTeachers: 0, batches: 10, storageMB: 10 } })), 'invalid-argument');
  const r = await run('adminInstitutionSetLimits', 'root-admin', { tenantId: A, reason: 'Pilot extension', limits: { activeStudents: 150, extraTeachers: 0, batches: 12, storageMB: 20 } });
  assert.equal(r.version, 2); const d = (await db.doc('institutions/' + A).get()).data(); assert.equal(d.limits.activeStudents, 150); assert.equal(d.limits.storageBytes, 20 * 1048576); assert.equal(d.limitsCustom, true);
  assert.equal((await db.collection('institutions/' + A + '/entitlementHistory').get()).size, 1);
  const p = await run('adminInstitutionPlanSave', 'root-admin', { type: 'tuition', reason: 'New plan', limits: { activeStudents: 120, extraTeachers: 0, batches: 10, storageMB: 10 }, features: { attendance: true, reports: false } });
  assert.equal(p.version, 2); const planned = await run('adminInstitutionPlanGet', 'root-admin', {}); assert.equal(planned.tuition.limits.activeStudents, 120); assert.equal(planned.tuition.features.reports, false);
});

test('admin list totals keep tuition and coaching apart', async () => {
  const l = await run('adminInstitutionList', 'root-admin', {}); assert.equal(l.totals.tuition.accounts, 2); assert.equal(l.totals.coaching.accounts, 1); assert.equal(l.items.length, 3);
});
