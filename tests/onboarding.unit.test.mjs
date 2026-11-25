// Unit tests for the registration field registry (Registration Marks 1 and 2, Batches 98 and 99): required rules, conditional fields, formats and progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/onboarding.mjs', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { FIELDS, CATEGORIES, fieldProblem, stepProblems, stepDone, progressOf, CLASS_LADDER, WEEK_DAYS, ATTENDANCE_METHODS, EXAM_SYSTEMS, GRADING_SYSTEMS, PAYMENT_METHODS, CURRENCIES } = mod;

const good = {
  name: 'Green Valley School', schoolType: 'Private unaided', schoolLevel: 'Secondary', genderComposition: 'Co-educational', medium: 'English',
  board: 'state', country: 'India', state: 'West Bengal', district: 'Howrah', town: 'Howrah', street: '12 Main Road', pin: '711101',
  schoolPhone: '9830012345', schoolEmail: 'office@gv.in', ownerName: 'A Owner', ownerDesignation: 'Chairman', ownerEmail: 'owner@gv.in', ownerMobile: '+91 98300 12345',
  sessionLabel: '2026-27', lowestClass: 'Class 1', highestClass: 'Class 10', studentCount: '420', teacherCount: '24',
};
const field = (key) => FIELDS.find((f) => f.key === key);

test('the registry covers the 71 stored fields of categories A to I with no duplicates', () => {
  assert.equal(FIELDS.length, 71);
  assert.equal(new Set(FIELDS.map((f) => f.key)).size, 71);
  assert.equal(new Set(FIELDS.map((f) => f.id)).size, 71);
  assert.deepEqual([...new Set(FIELDS.map((f) => f.cat))], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  assert.equal(CATEGORIES.length, 15);
});

test('required fields are reported when empty and pass when filled', () => {
  assert.match(fieldProblem(field('name'), {}), /required/);
  assert.equal(fieldProblem(field('name'), good), '');
  assert.equal(fieldProblem(field('motto'), {}), '');
});

test('the affiliation number is hidden and unchecked for no board or the state board, and required for CBSE', () => {
  assert.equal(fieldProblem(field('affiliationNo'), { ...good, board: 'state' }), '');
  assert.equal(fieldProblem(field('affiliationNo'), { ...good, board: 'none' }), '');
  assert.match(fieldProblem(field('affiliationNo'), { ...good, board: 'CBSE' }), /required/);
  assert.equal(fieldProblem(field('affiliationNo'), { ...good, board: 'CBSE', affiliationNo: '2430123' }), '');
});

test('trust fields only apply to trust-run, private unaided and aided schools', () => {
  assert.equal(field('trustName').showIf({ schoolType: 'Government' }), false);
  assert.equal(field('trustName').showIf({ schoolType: 'Trust or society run' }), true);
});

test('email, phone, PIN, year and UDISE formats', () => {
  assert.match(fieldProblem(field('ownerEmail'), { ...good, ownerEmail: 'no-at-sign' }), /valid email/);
  assert.match(fieldProblem(field('schoolPhone'), { ...good, schoolPhone: 'abc' }), /phone/);
  assert.equal(fieldProblem(field('schoolPhone'), { ...good, schoolPhone: '+91 98300-12345' }), '');
  assert.match(fieldProblem(field('pin'), { ...good, pin: '012345' }), /PIN/);
  assert.match(fieldProblem(field('pin'), { ...good, pin: '1234' }), /PIN/);
  assert.equal(fieldProblem(field('pin'), { ...good, country: 'Bangladesh', pin: '1207' }), '');
  assert.match(fieldProblem(field('estYear'), { ...good, estYear: '1700' }), /year/);
  assert.match(fieldProblem(field('estYear'), { ...good, estYear: String(new Date().getFullYear() + 1) }), /year/);
  assert.equal(fieldProblem(field('estYear'), { ...good, estYear: '1998' }), '');
  assert.match(fieldProblem(field('udise'), { ...good, udise: '123' }), /11 digits/);
  assert.equal(fieldProblem(field('udise'), { ...good, udise: '19010100101' }), '');
});

test('selects only accept listed options; the state list applies to India only', () => {
  assert.match(fieldProblem(field('schoolType'), { ...good, schoolType: 'Made up' }), /listed/);
  assert.match(fieldProblem(field('state'), { ...good, state: 'Atlantis' }), /listed/);
  assert.equal(fieldProblem(field('state'), { ...good, country: 'Bangladesh', state: 'Dhaka Division' }), '');
});

test('too-long values are refused', () => {
  assert.match(fieldProblem(field('name'), { ...good, name: 'x'.repeat(121) }), /too long/);
});

test('progress counts valid sections only, not visited ones', () => {
  assert.equal(progressOf({}), 0);
  assert.equal(progressOf(good), 6);
  assert.equal(progressOf({ ...good, principalName: 'A Principal' }), 7);
  const broken = { ...good, pin: 'bad' };
  assert.equal(stepDone('C', broken), false);
  assert.equal(progressOf(broken), 5);
  assert.equal(progressOf({ ...good, ownerEmail: '' }), 5);
  assert.equal(stepProblems('A', {}).length, 5);
});

test('Mark 2: session, class range and sections', () => {
  assert.match(fieldProblem(field('sessionLabel'), { ...good, sessionLabel: '2026-28' }), /2026-27/);
  assert.equal(fieldProblem(field('sessionLabel'), { ...good, sessionLabel: '2099-00' }), '');
  assert.match(fieldProblem(field('highestClass'), { ...good, lowestClass: 'Class 8', highestClass: 'Class 3' }), /below/);
  assert.equal(field('classesOffered').showIf({}), false);
  assert.equal(field('classesOffered').showIf(good), true);
  assert.deepEqual(field('classesOffered').optionsFn(good).length, 10);
  assert.equal(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 1=A,B|Class 2=A' }), '');
  assert.match(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 12=A' }), /not in the class range/);
  assert.match(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 1=A,B,C,D,E,F,G,H,I' }), /at most 8/);
  assert.match(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 1=A!' }), /letters and numbers/);
  assert.match(fieldProblem(field('subjects'), { ...good, subjects: Array.from({ length: 41 }, (_, i) => 'S' + i).join(',') }), /at most 40/);
  assert.equal(fieldProblem(field('subjects'), { ...good, subjects: 'English,Mathematics,Drawing' }), '');
});

test('Mark 2: counts and capacity', () => {
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '-5' }), /whole number/);
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '2.5' }), /whole number/);
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '100001' }), /or less/);
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '' }), /required/);
  assert.equal(fieldProblem(field('studentCount'), { ...good, studentCount: '0' }), '');
  assert.match(fieldProblem(field('maxCapacity'), { ...good, maxCapacity: '100' }), /lower than/);
  assert.equal(fieldProblem(field('maxCapacity'), { ...good, maxCapacity: '500' }), '');
  assert.match(fieldProblem(field('campusCount'), { ...good, campusCount: '0' }), /1 or more/);
});

test('Mark 2: timing and attendance', () => {
  assert.match(fieldProblem(field('openTime'), { ...good, openTime: '25:00' }), /time/);
  assert.match(fieldProblem(field('closeTime'), { ...good, openTime: '09:00', closeTime: '08:00' }), /after the opening/);
  assert.equal(fieldProblem(field('closeTime'), { ...good, openTime: '09:00', closeTime: '15:30' }), '');
  assert.match(fieldProblem(field('teacherReportTime'), { ...good, closeTime: '15:00', teacherReportTime: '16:00' }), /before the closing/);
  assert.match(fieldProblem(field('weeklyHolidays'), { ...good, workingDays: 'Mon,Sat', weeklyHolidays: 'Sat' }), /both/);
  assert.equal(fieldProblem(field('weeklyHolidays'), { ...good, workingDays: 'Mon,Sat', weeklyHolidays: 'Sun' }), '');
  assert.match(fieldProblem(field('workingDays'), { ...good, workingDays: 'Mon,Funday' }), /listed/);
  assert.equal(field('lateGraceMinutes').showIf({}), false);
  assert.equal(field('lateGraceMinutes').showIf({ teacherReportTime: '08:00' }), true);
});

test('Mark 2: the GPS radius applies only when GPS attendance is chosen', () => {
  const geo = field('geofenceRadius');
  assert.equal(geo.showIf({}), false);
  assert.equal(geo.showIf({ studentAttendanceMethod: 'GPS' }), true);
  assert.equal(geo.showIf({ teacherAttendanceMethods: 'Manual,GPS' }), true);
  assert.equal(stepProblems('H', { ...good, studentAttendanceMethod: 'GPS' }).some((p) => /radius/i.test(p.label || p.message || JSON.stringify(p))), true);
  assert.equal(stepProblems('H', { ...good, studentAttendanceMethod: 'QR code' }).length, 0);
  assert.match(fieldProblem(geo, { ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '5' }), /10 or more/);
  assert.match(fieldProblem(geo, { ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '9000' }), /5000/);
  assert.equal(fieldProblem(geo, { ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '150' }), '');
});

test('Mark 2: fees are optional and checked when given', () => {
  assert.equal(stepProblems('I', {}).length, 0);
  assert.equal(stepDone('I', {}), false);
  assert.equal(stepDone('I', { currency: 'INR' }), false);
  assert.equal(stepDone('I', { admissionFee: '1500.50' }), true);
  assert.match(fieldProblem(field('admissionFee'), { admissionFee: '12.345' }), /2 decimals/);
  assert.match(fieldProblem(field('admissionFee'), { admissionFee: '-1' }), /2 decimals/);
  assert.match(fieldProblem(field('feeDueDay'), { feeDueDay: '31' }), /28 or less/);
  assert.match(fieldProblem(field('paymentMethods'), { paymentMethods: 'Cash,Bitcoin' }), /listed/);
  assert.match(fieldProblem(field('currency'), { currency: 'XYZ' }), /listed/);
});

test('Mark 2: defaults are filled in and are not counted as entered', () => {
  const d = Object.fromEntries(FIELDS.filter((f) => f.def !== undefined).map((f) => [f.key, f.def]));
  assert.equal(d.sessionStartMonth, '4'); assert.equal(d.sessionEndMonth, '3'); assert.equal(d.workingDays, 'Mon,Tue,Wed,Thu,Fri,Sat'); assert.equal(d.weeklyHolidays, 'Sun'); assert.equal(d.currency, 'INR'); assert.equal(d.campusCount, '1');
  assert.equal(stepDone('H', { workingDays: d.workingDays, weeklyHolidays: d.weeklyHolidays }), false);
  assert.equal(stepDone('H', { workingDays: d.workingDays, weeklyHolidays: d.weeklyHolidays, openTime: '08:00' }), true);
});

test('lists for classes, days, attendance and so on are in sync with the server', () => {
  const server = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const list = (name) => { const m = server.match(new RegExp('const ' + name + " = \\[([^\\]]*)\\];")); assert.ok(m, name); return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]); };
  assert.deepEqual(CLASS_LADDER, list('CLASS_LADDER'));
  assert.deepEqual(WEEK_DAYS, list('WEEK_DAYS'));
  assert.deepEqual(ATTENDANCE_METHODS, list('ATTENDANCE_METHODS'));
  assert.deepEqual(EXAM_SYSTEMS, list('EXAM_SYSTEMS'));
  assert.deepEqual(GRADING_SYSTEMS, list('GRADING_SYSTEMS'));
  assert.deepEqual(PAYMENT_METHODS, list('PAYMENT_METHODS'));
  assert.deepEqual(CURRENCIES, list('CURRENCIES'));
});
