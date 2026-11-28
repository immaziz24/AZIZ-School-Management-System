// Tests for the Coaching centre extras (Phase 3): validation, timetable clashes, marks, logo, teacher access rules and the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('functions/index.js');
const t1 = src.match(/\/\/ --- tuition rules begin[\s\S]*?\/\/ --- tuition rules end ---/); const t2 = src.match(/\/\/ --- coaching rules begin[\s\S]*?\/\/ --- coaching rules end ---/);
assert.ok(t1 && t2, 'rule blocks are missing');
const lib = new Function(t1[0] + '\n' + t2[0] + '\n; return { checkTeacher, checkSubject, checkSession, findSessionConflicts, checkExam, checkMarks, checkNotice, checkLogo, checkPhoto, toMinutes };')();
const bodyOf = (name) => { const i = src.indexOf('exports.' + name + ' = '); assert.ok(i > 0, name + ' missing'); const j = src.indexOf('\nexports.', i + 10); return src.slice(i, j > 0 ? j : undefined); };

test('teacher: name, a real email and optional mobile; subjects are kept', () => {
  const ok = lib.checkTeacher({ name: 'Rina Das', email: ' Rina@Example.com ', mobile: '+91 98300 12345', subjects: ['Mathematics', 'Physics'] });
  assert.equal(ok.ok, true); assert.equal(ok.clean.email, 'rina@example.com'); assert.deepEqual(ok.clean.subjects, ['Mathematics', 'Physics']);
  assert.ok(lib.checkTeacher({ name: 'R', email: 'x@y.in' }).errors.name); assert.ok(lib.checkTeacher({ name: 'Rina', email: 'nope' }).errors.email); assert.ok(lib.checkTeacher({ name: 'Rina', email: 'a@b.in', mobile: 'abc' }).errors.mobile);
});

test('subject: needs a name and keeps an upper-case code', () => {
  assert.equal(lib.checkSubject({ name: 'Mathematics', code: 'mat' }).clean.code, 'MAT'); assert.ok(lib.checkSubject({ name: '' }).errors.name);
});

const sess = { batchId: 'BT-ABC123', teacherId: 'TC-ABC123', weekday: 'Mon', startTime: '16:00', endTime: '17:00', room: 'R1', subject: 'Maths' };
test('timetable: valid class, bad times and unknown days are refused', () => {
  assert.equal(lib.checkSession(sess).ok, true);
  assert.ok(lib.checkSession({ ...sess, endTime: '15:00' }).errors.endTime); assert.ok(lib.checkSession({ ...sess, weekday: 'Funday' }).errors.weekday); assert.ok(lib.checkSession({ ...sess, teacherId: '' }).errors.teacherId); assert.ok(lib.checkSession({ ...sess, batchId: 'x' }).errors.batchId);
});

test('timetable clashes: same teacher or same room overlapping on the same day; touching times and other days are fine', () => {
  const ex = [{ id: 'SS-1', ...sess }];
  assert.equal(lib.findSessionConflicts({ ...sess, startTime: '16:30', endTime: '17:30' }, ex)[0].type, 'teacher');
  assert.equal(lib.findSessionConflicts({ ...sess, teacherId: 'TC-OTHER1', startTime: '16:30', endTime: '17:30' }, ex)[0].type, 'room');
  assert.equal(lib.findSessionConflicts({ ...sess, teacherId: 'TC-OTHER1', room: 'R2', startTime: '16:30', endTime: '17:30' }, ex).length, 0);
  assert.equal(lib.findSessionConflicts({ ...sess, startTime: '17:00', endTime: '18:00' }, ex).length, 0);
  assert.equal(lib.findSessionConflicts({ ...sess, weekday: 'Tue' }, ex).length, 0);
  assert.equal(lib.findSessionConflicts(sess, ex, 'SS-1').length, 0);
});

test('exam: maximum marks is a whole number from 1 to 1000 and the date must be real', () => {
  const e = { name: 'Unit test 1', batchId: 'BT-ABC123', date: '2026-11-20', maxMarks: '50' };
  assert.equal(lib.checkExam(e).clean.maxMarks, 50);
  for (const bad of [0, 1001, '4.5', 'x', '']) assert.ok(lib.checkExam({ ...e, maxMarks: bad }).errors.maxMarks, String(bad));
  assert.ok(lib.checkExam({ ...e, date: '2026-02-30' }).errors.date); assert.ok(lib.checkExam({ ...e, batchId: '' }).errors.batchId);
});

test('marks: 0 to max, blank means absent, no duplicates, no bad ids', () => {
  const r = lib.checkMarks([{ studentId: 'ST-ABC123', marks: '42.5' }, { studentId: 'ST-ABC124', marks: '' }, { studentId: 'ST-ABC125', marks: 0 }], 50);
  assert.deepEqual(r.entries.map((x) => x.marks), [42.5, null, 0]);
  assert.ok(lib.checkMarks([{ studentId: 'ST-ABC123', marks: '51' }], 50).error); assert.ok(lib.checkMarks([{ studentId: 'ST-ABC123', marks: '-1' }], 50).error); assert.ok(lib.checkMarks([{ studentId: 'ST-ABC123', marks: '4.555' }], 50).error);
  assert.ok(lib.checkMarks([{ studentId: 'ST-ABC123', marks: '1' }, { studentId: 'ST-ABC123', marks: '2' }], 50).error); assert.ok(lib.checkMarks([{ studentId: 'bad', marks: '1' }], 50).error); assert.ok(lib.checkMarks([], 50).error);
});

test('announcement: title and message are required', () => {
  assert.equal(lib.checkNotice({ title: 'Holiday', body: 'Closed on Friday', pinned: true }).clean.pinned, true); assert.ok(lib.checkNotice({ title: 'x', body: 'Closed' }).errors.title); assert.ok(lib.checkNotice({ title: 'Holiday', body: '' }).errors.body);
});

test('logo: real small PNG accepted; wrong type, fake picture and big files refused', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
  assert.equal(lib.checkLogo('data:image/png;base64,' + png.toString('base64')).ok, true);
  assert.ok(lib.checkLogo('data:image/jpeg;base64,' + png.toString('base64')).error);
  assert.ok(lib.checkLogo('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').error); assert.ok(lib.checkLogo('hello').error);
  assert.ok(lib.checkLogo('data:image/png;base64,' + Buffer.concat([png, Buffer.alloc(120 * 1024)]).toString('base64')).error);
});

const OWNER_ONLY = ['coachingTeacherSave', 'coachingTeacherStatus', 'coachingTeacherList', 'coachingAssign', 'coachingAssignClasses', 'coachingTeacherPhotoSave', 'coachingTeacherPhotoGet', 'coachingSubjectSave', 'coachingSubjectArchive', 'coachingSessionSave', 'coachingSessionDelete', 'coachingNoticeSave', 'coachingNoticeDelete', 'coachingFeesByBatch', 'coachingAttendanceReport', 'institutionLogoSave'];
const SHARED = ['coachingSubjectList', 'coachingSessionList', 'coachingExamSave', 'coachingExamList', 'coachingMarksGet', 'coachingMarksSave', 'coachingNoticeList', 'institutionLogoGet'];
test('coaching functions: owner-only ones check the coaching owner; shared ones name both roles; teacher-only home', () => {
  for (const n of OWNER_ONLY) assert.match(bodyOf(n), /requireCoaching\(request, (data|request\.data)(, \['owner'\], '[a-z]+')?\)/, n);
  for (const n of SHARED) assert.match(bodyOf(n), /requireCoaching\(request, (data|request\.data), \['owner', 'teacher'\](, '[a-z]+')?\)/, n);
  assert.match(bodyOf('coachingTeacherHome'), /requireCoaching\(request, request\.data, \['teacher'\]\)/);
  assert.match(src, /async function requireCoaching[\s\S]*?type !== 'coaching'/);
});

test('a teacher reaches only assigned batches, and never sees fees', () => {
  assert.ok(src.includes("const canReachBatch = (ctx, batch) => ctx.role === 'owner' || (ctx.role === 'teacher' && ((Array.isArray(batch.teacherIds) && batch.teacherIds.includes(ctx.teacherId))"));
  for (const n of ['coachingExamSave', 'coachingMarksGet', 'coachingMarksSave']) assert.match(bodyOf(n) + src.slice(src.indexOf('async function examForMarks'), src.indexOf("exports.coachingMarksGet")), /canReachBatch/, n);
  assert.match(bodyOf('tuitionBatchList'), /delete x\.feePaise/); assert.match(bodyOf('coachingSessionList'), /ctx\.role === 'teacher'/);
  assert.doesNotMatch(bodyOf('coachingTeacherHome'), /feeCharges|payments|feePaise/);
  assert.match(bodyOf('resolveMyInstitutions'), /role === 'owner' \?/);
});

test('teacher invites: email must be verified, one login per email, limits counted, no client-chosen role', () => {
  const a = bodyOf('acceptTeacherInvite'); assert.match(a, /email_verified !== true/); assert.match(a, /runTransaction/); assert.match(a, /role: 'teacher'/); assert.match(a, /status !== 'pending'/); assert.doesNotMatch(a, /request\.data/);
  const s = bodyOf('coachingTeacherSave'); assert.match(s, /resource-exhausted/); assert.match(s, /already-exists/); assert.match(s, /extraTeachers/);
  assert.match(bodyOf('coachingTeacherStatus'), /extraTeachers/); assert.match(bodyOf('coachingAssign'), /Choose up to 10 teachers/);
});

test('the marks save stays inside the exam batch and the maximum cannot change after marks exist', () => {
  assert.match(bodyOf('coachingMarksSave'), /not in this batch/); assert.match(bodyOf('coachingExamSave'), /Marks are already entered/);
});

test('receipts carry the logo only for coaching; batch fee fills a new student\'s fee', () => {
  assert.match(bodyOf('tuitionReceipt'), /config\/logo/); assert.match(bodyOf('tuitionStudentSave'), /b\.data\(\)\.feePaise/);
});

test('screens: no innerHTML, no secrets, every coaching function is wired, teacher menu has no fees', () => {
  const ui = read('public/coaching-ui.mjs'); assert.doesNotMatch(ui, /innerHTML/); assert.doesNotMatch(ui, /apiKey|secret/i);
  for (const n of [...OWNER_ONLY, ...SHARED, 'coachingTeacherHome']) assert.ok(ui.includes("'" + n + "'"), n);
  const inst = read('public/institution.mjs'); assert.match(inst, /coaching-ui\.mjs/); assert.match(inst, /acceptTeacherInvite/); assert.match(inst, /teacher: \['Dashboard', 'Batches', 'Attendance', 'Timetable', 'Examinations', 'Announcements'\]/);
  assert.match(inst, /'Subjects'/); assert.match(inst, /if \(joining\) return/); assert.doesNotMatch(inst, /innerHTML/);
  assert.match(read('.htaccess'), /coaching-ui\\\.mjs/); assert.match(read('tests/run-tests.cmd'), /tests\/coaching\.test\.mjs/);
});

test('firestore.rules is untouched by this phase: the new collections are not mentioned', () => {
  const rules = read('firestore.rules'); for (const w of ['teacherInvites', 'coachingTeacher', 'institutions/']) assert.doesNotMatch(rules, new RegExp(w));
});

test('assign teachers to classes: owner-only, class checked, teacher reaches the batches of the class', () => {
  assert.match(bodyOf('coachingAssignClasses'), /Choose one of your classes/); assert.match(bodyOf('coachingAssignClasses'), /Choose up to 10 teachers/);
  assert.ok(src.includes('ctx.teacherClasses.includes(batch.className)'));
});

test('teacher qualifications and photo are checked', () => {
  const base = { name: 'Rina Das', email: 'rina@example.com', subjects: ['Mathematics'] };
  const ok = lib.checkTeacher({ ...base, highestQualification: 'Post Graduate (M.Sc.)', qualificationSubject: 'Physics', bed: true, deled: 'yes', experienceYears: '6', joiningDate: '2026-04-01', address: 'Kolkata' });
  assert.equal(ok.ok, true); assert.equal(ok.clean.bed, true); assert.equal(ok.clean.deled, true); assert.equal(ok.clean.med, false); assert.equal(ok.clean.experienceYears, 6); assert.equal(ok.clean.highestQualification, 'Post Graduate (M.Sc.)'); assert.equal(ok.clean.qualificationSubject, 'Physics');
  assert.equal(lib.checkTeacher(base).clean.experienceYears, null);
  assert.ok(lib.checkTeacher({ ...base, experienceYears: '99' }).errors.experienceYears); assert.ok(lib.checkTeacher({ ...base, joiningDate: '2026-02-30' }).errors.joiningDate);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300)]);
  assert.equal(lib.checkPhoto('data:image/png;base64,' + png.toString('base64')).ok, true);
  assert.ok(lib.checkPhoto('data:image/png;base64,' + Buffer.concat([png, Buffer.alloc(90 * 1024)]).toString('base64')).error); assert.ok(lib.checkPhoto('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').error);
});

test('teacher profile PDF: a valid one-page file around one picture; the photo is placed from the top', async () => {
  const { pdfFromJpeg } = await import('../public/coaching-ui.mjs');
  const out = Buffer.from(pdfFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), 10, 20)).toString('latin1');
  assert.ok(out.startsWith('%PDF-1.4') && out.endsWith('%%EOF') && out.includes('/DCTDecode') && out.includes('/Count 1'));
  const offs = [...out.slice(out.indexOf('xref' + String.fromCharCode(10) + '0 6')).matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
  assert.ok(offs.length === 5 && offs.every((o, i) => out.slice(o, o + String(i + 1).length + 7) === (i + 1) + ' 0 obj' + String.fromCharCode(10)));
  const ui = readFileSync(new URL('../public/coaching-ui.mjs', import.meta.url), 'utf8'); assert.ok(ui.includes('py, img.width * k, img.height * k')); assert.ok(ui.includes('object-position:center top'));
});
