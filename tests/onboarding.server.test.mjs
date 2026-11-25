// Unit tests for the server side of the registration wizard (Registration Marks 1 and 2, Batches 98 and 99). The functions file needs the Firebase Admin
// package to load, so the pure helpers are cut out of the source and run on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const grab = (re) => { const m = src.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const block = src.match(/\/\/ --- registration rules begin[\s\S]*?\/\/ --- registration rules end ---/);
assert.ok(block, 'registration rules block is missing');
const code = "class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }\n" + block[0];
const lib = new Function(code + '\n; return { slugifySchoolName, normalName, checkRegistration, cleanDraftValues, buildAcademicPlan, moneyToMinor, parseSections, NEW_SCHOOL_ID, DRAFT_ID, HttpsError, DRAFT_KEYS, REQUIRED_REGISTRATION };')();

const good = {
  name: 'Green Valley School', schoolType: 'Private unaided', schoolLevel: 'Secondary', genderComposition: 'Co-educational', medium: 'English',
  board: 'CBSE', affiliationNo: '2430123', country: 'India', state: 'West Bengal', district: 'Howrah', town: 'Howrah', street: '12 Main Road', pin: '711101',
  schoolPhone: '9830012345', schoolEmail: 'office@gv.in', ownerName: 'A Owner', ownerDesignation: 'Chairman', ownerEmail: 'owner@gv.in', ownerMobile: '9830012345',
  sessionLabel: '2026-27', lowestClass: 'Class 1', highestClass: 'Class 3', studentCount: '420', teacherCount: '24',
};

test('school IDs are built from the name and always valid', () => {
  assert.equal(lib.slugifySchoolName("St. Mary's Public School"), 'st-marys-public-school');
  assert.equal(lib.slugifySchoolName('Écolé Naïve  School!!'), 'ecole-naive-school');
  assert.equal(lib.slugifySchoolName('12th Standard Academy'), 'school-12th-standard-academy');
  for (const name of ['AB', 'ডি এ ভি', 'x'.repeat(100), '   ', '###', "O'Neil's Academy of Fine Arts and Sciences Kolkata"]) {
    assert.match(lib.slugifySchoolName(name), lib.NEW_SCHOOL_ID, name);
  }
});

test('name normalising ignores filler words, case and punctuation', () => {
  assert.equal(lib.normalName('The Green Valley Public School'), 'green valley');
  assert.equal(lib.normalName('GREEN-VALLEY  school'), 'green valley');
});

test('a complete draft has no problems', () => {
  assert.deepEqual(lib.checkRegistration(good), []);
});

test('the server repeats the field checks', () => {
  assert.ok(lib.checkRegistration({ ...good, name: '' }).some((p) => /name is required/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, ownerEmail: 'Owner@gv.in' }).some((p) => /lowercase/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, pin: '0123' }).some((p) => /pin/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, schoolPhone: 'abc' }).some((p) => /schoolPhone/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, estYear: '1700' }).some((p) => /estYear/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, udise: '123' }).some((p) => /udise/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, affiliationNo: '' }).some((p) => /affiliationNo/.test(p)));
  assert.deepEqual(lib.checkRegistration({ ...good, board: 'state', affiliationNo: '' }), []);
});

test('draft ids have a fixed shape', () => {
  assert.ok(lib.DRAFT_ID.test('OB-ABCDEF2345'));
  assert.ok(!lib.DRAFT_ID.test('OB-short'));
  assert.ok(!lib.DRAFT_ID.test('../schools/abcd-school'));
});

test('draft values keep known fields only, as text, and drop empty ones', () => {
  assert.deepEqual(lib.cleanDraftValues({ name: ' Green Valley ', motto: '   ', town: 'Howrah' }), { name: 'Green Valley', town: 'Howrah' });
  assert.throws(() => lib.cleanDraftValues({ password: 'x' }), /Unknown field/);
  assert.throws(() => lib.cleanDraftValues({ name: 5 }), /not valid/);
  assert.throws(() => lib.cleanDraftValues({ name: 'x'.repeat(1001) }), /not valid/);
  assert.throws(() => lib.cleanDraftValues(['name']), /not valid/);
});

test('Mark 2: the server repeats the academic, capacity, timing and fee checks', () => {
  const bad = (patch, re) => assert.ok(lib.checkRegistration({ ...good, ...patch }).some((p) => re.test(p)), JSON.stringify(patch));
  bad({ sessionLabel: '2026-28' }, /sessionLabel/);
  bad({ sessionStartMonth: '13' }, /sessionStartMonth/);
  bad({ lowestClass: 'Class 9' }, /highestClass must not be below/);
  bad({ highestClass: 'Class 20' }, /highestClass is not/);
  bad({ classesOffered: 'Class 7' }, /classesOffered/);
  bad({ sectionsByClass: 'Class 9=A' }, /sections/);
  bad({ sectionsByClass: 'Class 1=A,B,C,D,E,F,G,H,I' }, /more than 8/);
  bad({ subjects: Array.from({ length: 41 }, (_, i) => 'S' + i).join(',') }, /subjects/);
  bad({ studentCount: '' }, /studentCount is required/);
  bad({ studentCount: '-1' }, /studentCount must be/);
  bad({ teacherCount: '99999' }, /teacherCount must be/);
  bad({ maxCapacity: '10' }, /maxCapacity is below/);
  bad({ campusCount: '0' }, /campusCount/);
  bad({ openTime: '9am' }, /openTime/);
  bad({ openTime: '10:00', closeTime: '09:00' }, /closeTime must be after/);
  bad({ closeTime: '15:00', teacherReportTime: '16:00' }, /teacherReportTime must be before/);
  bad({ workingDays: 'Mon,Sat', weeklyHolidays: 'Sat' }, /both a working day/);
  bad({ workingDays: 'Mon,Zzz' }, /unknown day/);
  bad({ lateGraceMinutes: '500' }, /lateGraceMinutes/);
  bad({ studentAttendanceMethod: 'Telepathy' }, /studentAttendanceMethod/);
  bad({ teacherAttendanceMethods: 'Manual,Telepathy' }, /teacherAttendanceMethods/);
  bad({ studentAttendanceMethod: 'GPS' }, /geofenceRadius is required/);
  bad({ teacherAttendanceMethods: 'GPS', geofenceRadius: '5' }, /geofenceRadius must be/);
  bad({ currency: 'XYZ' }, /currency/);
  bad({ admissionFee: '12.345' }, /admissionFee/);
  bad({ feeDueDay: '31' }, /feeDueDay/);
  bad({ paymentMethods: 'Cash,Bitcoin' }, /paymentMethods/);
  assert.deepEqual(lib.checkRegistration({ ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '150', openTime: '08:00', closeTime: '15:00', teacherReportTime: '07:45', workingDays: 'Mon,Tue', weeklyHolidays: 'Sun', admissionFee: '1500.50', feeDueDay: '10', paymentMethods: 'Cash,UPI' }), []);
});

test('the server and the form agree on which fields exist and which are required', () => {
  const ui = readFileSync(new URL('../public/onboarding.mjs', import.meta.url), 'utf8');
  const keys = [...ui.matchAll(/\{ id: 'F\d{3}', key: '([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.equal(keys.length, 71);
  const uploads = keys.filter((k) => !lib.DRAFT_KEYS.includes(k));
  assert.deepEqual(uploads, []);
  assert.equal(lib.DRAFT_KEYS.length, 71);
});

test('money is converted to the smallest unit without rounding errors', () => {
  assert.equal(lib.moneyToMinor('1500'), 150000);
  assert.equal(lib.moneyToMinor('1500.5'), 150050);
  assert.equal(lib.moneyToMinor('0.07'), 7);
  assert.equal(lib.moneyToMinor('19.99'), 1999);
  assert.equal(lib.moneyToMinor(''), 0);
});

test('sections text is read into a map', () => {
  assert.deepEqual(lib.parseSections('Class 1=A, B|Class 2=A'), { 'Class 1': ['A', 'B'], 'Class 2': ['A'] });
  assert.deepEqual(lib.parseSections(''), {});
  assert.deepEqual(lib.parseSections('garbage'), {});
});

test('the academic plan has the right years, classes, sections, subjects and links', () => {
  const plan = lib.buildAcademicPlan({ ...good, lowestClass: 'Class 1', highestClass: 'Class 3', sectionsByClass: 'Class 1=A,B', subjects: 'English, Mathematics, English' });
  assert.equal(plan.year.id, '2026-27');
  assert.equal(plan.year.data.startDate, '2026-04-01');
  assert.equal(plan.year.data.endDate, '2027-03-31');
  assert.equal(plan.year.data.status, 'active');
  assert.deepEqual(plan.classes.map((c) => [c.id, c.data.name, c.data.order]), [['class-1', 'Class 1', 4], ['class-2', 'Class 2', 5], ['class-3', 'Class 3', 6]]);
  assert.deepEqual(plan.sections.map((s) => s.id), ['class-1-a', 'class-1-b', 'class-2-a', 'class-3-a']);
  assert.deepEqual(plan.subjects.map((s) => s.id), ['english', 'mathematics']);
  assert.ok(plan.subjects.every((s) => s.data.code.length <= 12));
  assert.equal(plan.mappings.length, 6);
  assert.ok(plan.mappings.some((m) => m.id === 'class-2_mathematics'));
  for (const c of plan.classes) assert.ok(c.data.order >= 1 && c.data.order <= 100);
  for (const s of plan.sections) assert.ok(s.data.name.length <= 10);
});

test('a January to December session ends in the same year; classesOffered narrows the plan', () => {
  const plan = lib.buildAcademicPlan({ ...good, sessionStartMonth: '1', sessionEndMonth: '12', classesOffered: 'Class 1,Class 3' });
  assert.equal(plan.year.data.startDate, '2026-01-01');
  assert.equal(plan.year.data.endDate, '2026-12-31');
  assert.deepEqual(plan.classes.map((c) => c.data.name), ['Class 1', 'Class 3']);
  assert.equal(plan.subjects.length, 0);
  assert.equal(plan.mappings.length, 0);
});

test('a leap-year February end date is handled', () => {
  const plan = lib.buildAcademicPlan({ ...good, sessionLabel: '2027-28', sessionStartMonth: '4', sessionEndMonth: '2' });
  assert.equal(plan.year.data.endDate, '2028-02-29');
});
