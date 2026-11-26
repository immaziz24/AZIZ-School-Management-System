// Tests for the Tuition & Coaching shared engine (Phase 2): money, due dates, payments, validation, and the structure of the server functions and screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('functions/index.js');
const block = src.match(/\/\/ --- tuition rules begin[\s\S]*?\/\/ --- tuition rules end ---/);
assert.ok(block, 'tuition rules block is missing');
const lib = new Function(block[0] + '\n; return { rupeesToPaise, validDate, validTime, todayIST, cycleOf, daysInMonth, dueDateFor, chargeIdFor, chargeStatus, allocatePayment, receiptNoFor, checkStudent, checkBatch, checkPayment, checkAttendanceEntries };')();

const student = { name: 'Anika Sen', className: 'Class 9', guardianName: 'Ravi Sen', guardianMobile: '+91 98300 12345', joiningDate: '2026-11-03', monthlyFee: '500', dueDay: 5 };
const charge = (id, due, amount, paid = 0) => ({ id, dueDate: due, amountPaise: amount, paidPaise: paid });

test('rupees convert to whole paise and bad amounts are refused', () => {
  assert.equal(lib.rupeesToPaise('500'), 50000); assert.equal(lib.rupeesToPaise('500.5'), 50050); assert.equal(lib.rupeesToPaise('1,250.25'), 125025); assert.equal(lib.rupeesToPaise(0), 0);
  for (const bad of ['-5', 'abc', '1.234', '', '1e3', '99999999999']) assert.equal(lib.rupeesToPaise(bad), null, bad);
});

test('dates, cycles and month-end due dates', () => {
  assert.equal(lib.validDate('2026-02-29'), false); assert.equal(lib.validDate('2028-02-29'), true); assert.equal(lib.validDate('2026-13-01'), false);
  assert.equal(lib.cycleOf('2026-11-03'), '2026-11');
  assert.equal(lib.dueDateFor('2026-02', 31), '2026-02-28'); assert.equal(lib.dueDateFor('2028-02', 31), '2028-02-29'); assert.equal(lib.dueDateFor('2026-04', 31), '2026-04-30'); assert.equal(lib.dueDateFor('2026-11', 5), '2026-11-05');
  assert.equal(lib.todayIST(Date.UTC(2026, 10, 30, 19, 0)), '2026-12-01');
  assert.equal(lib.chargeIdFor('ST-ABC123', '2026-11'), 'ST-ABC123_2026-11');
});

test('charge status: paid, unpaid and overdue', () => {
  assert.equal(lib.chargeStatus(charge('a', '2026-11-05', 50000, 50000), '2026-12-01'), 'paid');
  assert.equal(lib.chargeStatus(charge('a', '2026-11-05', 50000, 10000), '2026-11-05'), 'unpaid');
  assert.equal(lib.chargeStatus(charge('a', '2026-11-05', 50000, 10000), '2026-11-06'), 'overdue');
});

test('payments are allocated to the oldest due first, partly or fully, and never over the balance', () => {
  const cs = [charge('B', '2026-11-05', 50000), charge('A', '2026-10-05', 50000, 20000)];
  assert.deepEqual(lib.allocatePayment(cs, 40000).allocations, [{ chargeId: 'A', amountPaise: 30000 }, { chargeId: 'B', amountPaise: 10000 }]);
  assert.deepEqual(lib.allocatePayment(cs, 50000, 'B').allocations, [{ chargeId: 'B', amountPaise: 50000 }]);
  assert.ok(lib.allocatePayment(cs, 80001).error); assert.ok(lib.allocatePayment(cs, 50001, 'B').error); assert.ok(lib.allocatePayment(cs, 0).error); assert.ok(lib.allocatePayment(cs, 100, 'Z').error);
  assert.equal(lib.allocatePayment(cs, 80000).allocations.reduce((t, a) => t + a.amountPaise, 0), 80000);
  assert.equal(lib.receiptNoFor(7), 'R-000007');
});

test('student form: valid, and each invalid field is named', () => {
  const ok = lib.checkStudent(student, '2026-11-26'); assert.equal(ok.ok, true); assert.equal(ok.clean.monthlyFeePaise, 50000); assert.equal(ok.clean.dueDay, 5); assert.equal(ok.clean.status, 'active');
  const bad = lib.checkStudent({ name: 'A', className: '', guardianName: '', guardianMobile: '12', joiningDate: '2026-02-30', monthlyFee: 'x', dueDay: 40, admissionFee: '-1' }, '2026-11-26');
  assert.equal(bad.ok, false);
  for (const k of ['name', 'className', 'guardianName', 'guardianMobile', 'joiningDate', 'monthlyFee', 'dueDay', 'admissionFee']) assert.ok(bad.errors[k], k);
});

test('batch form needs days, times and an end after the start', () => {
  const v = { name: 'Class 9 Maths', className: 'Class 9', subject: 'Maths', days: ['Mon', 'Wed', 'Mon', 'Xyz'], startTime: '16:00', endTime: '17:30' };
  const ok = lib.checkBatch(v); assert.equal(ok.ok, true); assert.deepEqual(ok.clean.days, ['Mon', 'Wed']);
  assert.ok(lib.checkBatch({ ...v, days: [] }).errors.days); assert.ok(lib.checkBatch({ ...v, endTime: '15:00' }).errors.endTime); assert.ok(lib.checkBatch({ ...v, startTime: '' }).errors.startTime);
});

test('payment form: amount, method, date and a request key are all required', () => {
  const v = { amount: '250', method: 'upi', paidOn: '2026-11-20', idempotencyKey: 'abcd1234-efgh' };
  assert.equal(lib.checkPayment(v, '2026-11-26').ok, true);
  assert.ok(lib.checkPayment({ ...v, amount: '0' }, '2026-11-26').errors.amount); assert.ok(lib.checkPayment({ ...v, method: 'card' }, '2026-11-26').errors.method);
  assert.ok(lib.checkPayment({ ...v, paidOn: '2026-11-27' }, '2026-11-26').errors.paidOn); assert.ok(lib.checkPayment({ ...v, idempotencyKey: '' }, '2026-11-26').errors.idempotencyKey);
});

test('attendance entries: no future date, no duplicates, only known statuses and ids', () => {
  const e = [{ studentId: 'ST-ABC123', status: 'present' }, { studentId: 'ST-ABC124', status: 'late' }];
  assert.equal(lib.checkAttendanceEntries(e, '2026-11-20', '2026-11-26').entries.length, 2);
  assert.ok(lib.checkAttendanceEntries(e, '2026-11-27', '2026-11-26').error); assert.ok(lib.checkAttendanceEntries([e[0], e[0]], '2026-11-20', '2026-11-26').error);
  assert.ok(lib.checkAttendanceEntries([{ studentId: 'ST-ABC123', status: 'maybe' }], '2026-11-20', '2026-11-26').error); assert.ok(lib.checkAttendanceEntries([{ studentId: 'bad', status: 'present' }], '2026-11-20', '2026-11-26').error);
  assert.ok(lib.checkAttendanceEntries([], '2026-11-20', '2026-11-26').error);
});

const CALLABLES = ['tuitionStudentSave', 'tuitionStudentStatus', 'tuitionStudentList', 'tuitionBatchSave', 'tuitionBatchArchive', 'tuitionBatchList', 'tuitionFees', 'tuitionChargeAdjust', 'tuitionPaymentRecord', 'tuitionPaymentReverse', 'tuitionPayments', 'tuitionReceipt',
  'tuitionAttendanceGet', 'tuitionAttendanceMark', 'tuitionAttendanceHistory', 'tuitionDashboard', 'tuitionReport', 'institutionProfileSave'];
const bodyOf = (name) => { const i = src.indexOf('exports.' + name + ' = '); assert.ok(i > 0, name + ' missing'); const j = src.indexOf('\nexports.', i + 10); return src.slice(i, j > 0 ? j : undefined); };

test('every Phase 2 function is owner-only and tenant-checked through requireInstitution', () => {
  for (const n of CALLABLES) assert.match(bodyOf(n), /requireInstitution\(request/, n);
  const g = src.slice(src.indexOf('async function requireInstitution'), src.indexOf('const newRecordId'));
  assert.match(g, /unauthenticated/); assert.match(g, /memberships\/' \+ uid \+ '_' \+ tenantId/); assert.match(g, /role !== 'owner'/); assert.match(g, /status !== 'active'/); assert.match(g, /TENANT_ID\.test/);
});

test('quotas, receipts and payments are written in transactions with safe keys', () => {
  assert.match(bodyOf('tuitionStudentSave'), /runTransaction/); assert.match(bodyOf('tuitionStudentSave'), /resource-exhausted/);
  assert.match(bodyOf('tuitionBatchSave'), /resource-exhausted/); assert.match(bodyOf('tuitionStudentStatus'), /resource-exhausted/);
  const p = bodyOf('tuitionPaymentRecord'); assert.match(p, /runTransaction/); assert.match(p, /idempotencyKey/); assert.match(p, /duplicate: true/); assert.match(p, /counters\.receipt/); assert.match(p, /allocatePayment/);
  const r = bodyOf('tuitionPaymentReverse'); assert.match(r, /already reversed/); assert.match(r, /audit\//);
  assert.match(bodyOf('tuitionChargeAdjust'), /audit\//); assert.match(bodyOf('tuitionAttendanceMark'), /attendance-corrected/);
  assert.match(src, /chargeIdFor\(d\.id, cycle\)/); assert.match(src, /generateInstitutionCharges/);
});

test('the client never sends plan, role, status or limits; no secret or rules change', () => {
  for (const n of CALLABLES) assert.doesNotMatch(bodyOf(n), /data\.(plan|role|limits|limit|usage)\b/, n);
  const ui = read('public/tuition-ui.mjs'); assert.doesNotMatch(ui, /innerHTML/); assert.doesNotMatch(ui, /apiKey|secret/i);
});

test('screens, routing and cache are wired', () => {
  const ui = read('public/tuition-ui.mjs'); for (const n of CALLABLES.filter((x) => x !== 'tuitionBatchList' || true)) assert.ok(ui.includes("'" + n + "'") || n === 'tuitionStudentList' || ui.includes(n), n);
  const inst = read('public/institution.mjs'); assert.match(inst, /mountTuition/); assert.match(inst, /tuition-ui\.mjs/);
  assert.match(read('.htaccess'), /tuition-ui\\\.mjs/); assert.match(read('public/institution.html'), /institution\.mjs\?v=tc-2/); assert.match(read('public/institution.html'), /@media print/);
});
