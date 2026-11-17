import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { app } from './firebase-client.mjs';

const auth = getAuth(app);
const form = document.querySelector('#sign-in');
const signInButton = form.querySelector('button');
const signOutButton = document.querySelector('#sign-out');
const status = document.querySelector('#firebase-status');
const schoolStatus = document.createElement('p');
schoolStatus.setAttribute('role', 'status');
schoolStatus.hidden = true;
signOutButton.before(schoolStatus);
const dashboard = document.querySelector('#owner-dashboard');
const teacherDashboard = document.querySelector('#teacher-dashboard');
const teacherEmail = document.querySelector('#teacher-email');
const schoolName = document.querySelector('#school-name');
const ownerEmail = document.querySelector('#owner-email');
const profileForm = document.querySelector('#school-profile');
const profileStatus = document.querySelector('#profile-status');
const saveProfile = profileForm.querySelector('button');
const profileFields = ['name', 'contactEmail', 'phone', 'address'];
let saveSchoolProfile;
let schoolRequest = 0;
let firestoreTools;
const assignmentForm = document.querySelector('#teacher-assignment');
const assignmentStatus = document.querySelector('#assignment-status');
const assignmentSummary = document.querySelector('#teacher-assignment-summary');
const assignmentButton = assignmentForm.querySelector('button');
let saveAssignment;
const marksForm = document.querySelector('#marks-entry');
const marksStatus = document.querySelector('#marks-status');
const marksButton = marksForm.querySelector('button');
let saveMark;

marksForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!saveMark || marksButton.disabled) return;
  const request = schoolRequest;
  const fields = new FormData(marksForm);
  const score = Number(fields.get('score'));
  const maximum = Number(fields.get('maximum'));
  if (score > maximum) {
    marksStatus.textContent = 'Marks obtained cannot exceed maximum marks.';
    return;
  }
  marksButton.disabled = true;
  marksStatus.textContent = 'Saving marks.';
  try {
    await saveMark({ exam: fields.get('exam'), roll: fields.get('roll'), score, maximum });
    if (request === schoolRequest) marksStatus.textContent = 'Marks saved.';
  } catch (error) {
    if (request === schoolRequest) marksStatus.textContent = error.code === 'permission-denied'
      ? 'These marks cannot be saved for your current assignment.'
      : 'Could not save marks. Try again.';
  } finally {
    if (request === schoolRequest) marksButton.disabled = false;
  }
});

assignmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!saveAssignment || assignmentButton.disabled) return;
  const request = schoolRequest;
  const fields = new FormData(assignmentForm);
  const uid = fields.get('uid').trim();
  const link = examData.mappings.find((record) => record.id === String(fields.get('mappingId') ?? ''));
  if (!link) {
    assignmentStatus.textContent = 'Link a subject to a class in Academic Setup first.';
    return;
  }
  const { classId, subjectId } = link.data();
  const className = examData.classes.find((record) => record.id === classId)?.data().name;
  const subject = examData.subjects.find((record) => record.id === subjectId)?.data().name;
  if (!className || !subject) {
    assignmentStatus.textContent = 'That class or subject could not be found. Reload and try again.';
    return;
  }
  assignmentButton.disabled = true;
  assignmentStatus.textContent = 'Saving assignment.';
  try {
    await saveAssignment(uid, { className, subject, classId, subjectId });
    if (request === schoolRequest) assignmentStatus.textContent = 'Assignment saved.';
  } catch (error) {
    if (request === schoolRequest) assignmentStatus.textContent = error.code === 'permission-denied'
      ? 'Check that this UID belongs to an active teacher at your school.'
      : 'Could not save the assignment. Try again.';
  } finally {
    if (request === schoolRequest) assignmentButton.disabled = false;
  }
});
const staffForm = document.querySelector('#staff-form');
const staffStatus = document.querySelector('#staff-status');
const staffList = document.querySelector('#staff-list');
const staffSave = staffForm.querySelector('[type="submit"]');
const staffCancel = staffForm.querySelector('[type="reset"]');
const staffFields = ['name', 'position', 'email'];
let staffDirectory;
let staffEditingId;

staffForm.addEventListener('reset', () => {
  staffEditingId = undefined;
  staffSave.textContent = 'Add staff member';
  staffCancel.hidden = true;
});

async function loadStaff(directory, request) {
  try {
    const records = await directory.list();
    if (request !== schoolRequest) return;
    staffList.replaceChildren();
    for (const record of records.docs) {
      const profile = record.data();
      const row = document.createElement('li');
      row.textContent = profile.name + ' - ' + profile.position + ' ';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit ' + profile.name;
      edit.addEventListener('click', () => {
        if (staffSave.disabled) return;
        staffEditingId = record.id;
        for (const field of staffFields) {
          staffForm.elements.namedItem(field).value = profile[field];
        }
        staffSave.textContent = 'Save staff profile';
        staffCancel.hidden = false;
        staffForm.elements.namedItem('name').focus();
      });
      row.append(edit);
      staffList.append(row);
    }
    staffForm.hidden = false;
    staffStatus.textContent = records.empty ? 'No staff profiles yet.' : '';
  } catch {
    if (request === schoolRequest) staffStatus.textContent = 'Could not load staff profiles.';
  }
}

staffForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!staffDirectory || staffSave.disabled) return;
  const request = schoolRequest;
  const directory = staffDirectory;
  const fields = new FormData(staffForm);
  const profile = Object.fromEntries(staffFields.map((field) => [field, fields.get(field).trim()]));
  if (!profile.name || !profile.position) {
    staffStatus.textContent = 'Enter a staff name and job title.';
    return;
  }
  staffSave.disabled = staffCancel.disabled = true;
  staffStatus.textContent = 'Saving staff profile.';
  try {
    await directory.save(staffEditingId, profile);
    if (request !== schoolRequest) return;
    staffForm.reset();
    await loadStaff(directory, request);
    if (request === schoolRequest) {
      staffStatus.textContent = 'Staff profile saved. ' + staffStatus.textContent;
    }
  } catch {
    if (request === schoolRequest) staffStatus.textContent = 'Could not save the staff profile.';
  } finally {
    if (request === schoolRequest) staffSave.disabled = staffCancel.disabled = false;
  }
});

const academicSection = document.querySelector('#academic-setup');
const academicStatus = document.querySelector('#academic-status');
const setupLists = {
  years: document.querySelector('#year-list'), classes: document.querySelector('#class-list'),
  sections: document.querySelector('#section-list'), subjects: document.querySelector('#subject-list'),
  mappings: document.querySelector('#mapping-list'),
};
const yearForm = document.querySelector('#year-form');
const classForm = document.querySelector('#class-form');
const sectionForm = document.querySelector('#section-form');
const subjectForm = document.querySelector('#subject-form');
const mappingForm = document.querySelector('#mapping-form');
let academic;

const slug = (text, max) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

function listItem(list, text, button) {
  const item = document.createElement('li');
  item.textContent = text + (button ? ' ' : '');
  if (button) item.append(button);
  list.append(item);
}

function fillSelect(select, records, label) {
  const previous = select.value;
  select.replaceChildren();
  for (const record of records) {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = label(record.data());
    select.append(option);
  }
  if (records.some((record) => record.id === previous)) select.value = previous;
}

async function loadAcademic(request) {
  const tools = academic;
  try {
    const [years, classes, sections, subjects, mappings, studentDocs, enrollments, exams, classTeacherDocs] = await Promise.all(
      ['academicYears', 'classes', 'sections', 'subjects', 'classSubjects', 'students', 'enrollments', 'exams', 'classTeachers']
        .map((name) => tools.list(name)),
    );
    if (request !== schoolRequest) return;
    studentRecords = studentDocs.docs;
    renderStudents();
    placementData = { years: years.docs, classes: classes.docs, sections: sections.docs, enrollments: enrollments.docs };
    renderPlacements();
    examData = { years: years.docs, classes: classes.docs, subjects: subjects.docs, mappings: mappings.docs, exams: exams.docs };
    renderExams();
    renderReviewExams();
    renderMarksReview();
    renderReportStudents();
    renderCardStudents();
    renderOfficeStudents();
    refreshOwnerLists();
    renderPromotionYears();
    renderFamilyLinks();
    classTeacherData = classTeacherDocs.docs;
    renderClassTeachers();
    renderAttendanceReview();
    for (const list of Object.values(setupLists)) list.replaceChildren();
    const classRecords = classes.docs.sort((a, b) => a.data().order - b.data().order);
    const className = (id) => classRecords.find((record) => record.id === id)?.data().name ?? id;
    const subjectName = (id) => subjects.docs.find((record) => record.id === id)?.data().name ?? id;
    const hasActiveYear = years.docs.some((record) => record.data().status === 'active');
    for (const record of years.docs.sort((a, b) => a.data().startDate.localeCompare(b.data().startDate))) {
      const year = record.data();
      let button;
      if (year.status === 'draft' || year.status === 'active') {
        button = document.createElement('button');
        button.type = 'button';
        button.textContent = year.status === 'draft' ? 'Activate ' + year.label : 'Close ' + year.label;
        button.disabled = year.status === 'draft' && hasActiveYear;
        button.addEventListener('click', () => runSetupAction(async () => {
          if (year.status === 'draft') return tools.activate(record.id, year);
          if (!confirm('Close ' + year.label + '? A closed year cannot be reopened or edited.')) return false;
          return tools.close(record.id);
        }, year.status === 'draft' ? 'Academic year activated.' : 'Academic year closed.'));
      }
      listItem(setupLists.years, year.label + ' (' + year.startDate + ' to ' + year.endDate + ') - ' + year.status
        + (year.status === 'draft' && hasActiveYear ? ' - close the active year first' : ''), button);
    }
    for (const record of classRecords) listItem(setupLists.classes, record.data().order + '. ' + record.data().name);
    for (const record of sections.docs.sort((a, b) => a.id.localeCompare(b.id))) {
      listItem(setupLists.sections, className(record.data().classId) + ' - Section ' + record.data().name);
    }
    for (const record of subjects.docs.sort((a, b) => a.id.localeCompare(b.id))) {
      listItem(setupLists.subjects, record.data().name + (record.data().code ? ' (' + record.data().code + ')' : ''));
    }
    for (const record of mappings.docs.sort((a, b) => a.id.localeCompare(b.id))) {
      listItem(setupLists.mappings, className(record.data().classId) + ' - ' + subjectName(record.data().subjectId));
    }
    fillSelect(sectionForm.elements.namedItem('classId'), classRecords, (item) => item.name);
    fillSelect(mappingForm.elements.namedItem('classId'), classRecords, (item) => item.name);
    fillSelect(mappingForm.elements.namedItem('subjectId'), subjects.docs, (item) => item.name);
    academicStatus.textContent = '';
  } catch {
    if (request === schoolRequest) academicStatus.textContent = 'Could not load academic setup.';
  }
}

async function runSetupAction(action, done, statusElement = academicStatus) {
  if (!academic || academic.busy) return;
  const tools = academic;
  const request = schoolRequest;
  tools.busy = true;
  statusElement.textContent = 'Saving.';
  try {
    if (await action() === false) {
      if (request === schoolRequest) statusElement.textContent = '';
      return;
    }
    if (request !== schoolRequest) return;
    statusElement.textContent = done;
    await loadAcademic(request);
    if (request === schoolRequest) statusElement.textContent = done;
  } catch (error) {
    if (request === schoolRequest) statusElement.textContent = error.code === 'permission-denied'
      ? 'This change is not allowed. Check that the records it depends on exist and are open.'
      : 'Could not save. Try again.';
  } finally {
    tools.busy = false;
  }
}

function bindSetupForm(form, build, done) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!academic || academic.busy) return;
    const fields = new FormData(form);
    const result = build((name) => String(fields.get(name) ?? '').trim());
    if (typeof result === 'string') {
      academicStatus.textContent = result;
      return;
    }
    runSetupAction(async () => {
      await academic.save(result.collection, result.id, result.data);
      form.reset();
    }, done);
  });
}

bindSetupForm(yearForm, (value) => {
  const id = slug(value('label'), 20);
  if (!id) return 'Enter a year label such as 2026-27.';
  if (value('endDate') <= value('startDate')) return 'The end date must be after the start date.';
  return { collection: 'academicYears', id, data: {
    label: value('label'), startDate: value('startDate'), endDate: value('endDate'), status: 'draft',
  } };
}, 'Academic year added as a draft.');

bindSetupForm(classForm, (value) => {
  const id = slug(value('name'), 20);
  const order = Number(value('order'));
  if (!id) return 'Enter a class name.';
  if (!Number.isInteger(order) || order < 1 || order > 100) return 'Display order must be a whole number from 1 to 100.';
  return { collection: 'classes', id, data: { name: value('name'), order } };
}, 'Class saved.');

bindSetupForm(sectionForm, (value) => {
  const suffix = slug(value('name'), 10);
  if (!value('classId')) return 'Add a class first.';
  if (!suffix) return 'Enter a section name.';
  return { collection: 'sections', id: value('classId') + '-' + suffix,
    data: { classId: value('classId'), name: value('name') } };
}, 'Section saved.');

bindSetupForm(subjectForm, (value) => {
  const id = slug(value('name'), 30);
  if (!id) return 'Enter a subject name.';
  return { collection: 'subjects', id, data: { name: value('name'), code: value('code') } };
}, 'Subject saved.');

bindSetupForm(mappingForm, (value) => {
  if (!value('classId') || !value('subjectId')) return 'Add a class and a subject first.';
  return { collection: 'classSubjects', id: value('classId') + '_' + value('subjectId'),
    data: { classId: value('classId'), subjectId: value('subjectId') } };
}, 'Subject added to the class.');

const studentSection = document.querySelector('#student-roster');
const studentStatus = document.querySelector('#student-status');
const studentList = document.querySelector('#student-list');
const studentSearch = document.querySelector('#student-search');
const studentForm = document.querySelector('#student-form');
const studentSave = studentForm.querySelector('[type="submit"]');
const studentCancel = studentForm.querySelector('[type="reset"]');
const studentFields = ['admissionNo', 'name', 'guardianName', 'guardianPhone'];
let studentRecords = [];
let studentEditingId;

studentForm.addEventListener('reset', () => {
  studentEditingId = undefined;
  studentForm.elements.namedItem('admissionNo').readOnly = false;
  studentSave.textContent = 'Save student';
  studentCancel.hidden = true;
});

function renderStudents() {
  studentList.replaceChildren();
  const term = studentSearch.value.trim().toLowerCase();
  const matches = studentRecords
    .filter((record) => !term || (record.data().name + ' ' + record.data().admissionNo).toLowerCase().includes(term))
    .sort((a, b) => a.data().name.localeCompare(b.data().name));
  for (const record of matches) {
    const student = record.data();
    const row = document.createElement('li');
    row.textContent = student.name + ' - ' + student.admissionNo + ' - ' + student.guardianName
      + (student.guardianPhone ? ' (' + student.guardianPhone + ')' : '') + ' - ' + student.status + ' ';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit ' + student.name;
    edit.addEventListener('click', () => {
      studentEditingId = record.id;
      for (const field of studentFields) studentForm.elements.namedItem(field).value = student[field];
      studentForm.elements.namedItem('admissionNo').readOnly = true;
      studentSave.textContent = 'Save changes';
      studentCancel.hidden = false;
      studentForm.elements.namedItem('name').focus();
    });
    const toggle = document.createElement('button');
    toggle.type = 'button';
    const next = student.status === 'active' ? 'inactive' : 'active';
    toggle.textContent = (next === 'inactive' ? 'Mark inactive ' : 'Mark active ') + student.name;
    toggle.addEventListener('click', () => runSetupAction(
      () => academic.save('students', record.id, { ...student, status: next }),
      'Student marked ' + next + '.', studentStatus,
    ));
    row.append(edit, toggle);
    studentList.append(row);
  }
  if (!studentRecords.length) studentStatus.textContent = studentStatus.textContent || 'No students yet.';
  else if (!matches.length) studentStatus.textContent = 'No students match your search.';
}

studentSearch.addEventListener('input', () => {
  studentStatus.textContent = '';
  renderStudents();
});

studentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(studentForm);
  const value = (name) => String(fields.get(name) ?? '').trim();
  const admissionNo = studentEditingId ? studentRecords.find((r) => r.id === studentEditingId).data().admissionNo
    : value('admissionNo');
  const id = admissionNo.toLowerCase();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(admissionNo)) {
    studentStatus.textContent = 'Admission number may use letters, numbers and hyphens only (up to 20).';
    return;
  }
  if (!value('name') || !value('guardianName')) {
    studentStatus.textContent = 'Enter the student name and guardian name.';
    return;
  }
  if (!/^[0-9+() -]{0,20}$/.test(value('guardianPhone'))) {
    studentStatus.textContent = 'Phone may use digits, +, spaces, hyphens and brackets only.';
    return;
  }
  const existing = studentRecords.find((record) => record.id === id);
  if (existing && !studentEditingId) {
    studentStatus.textContent = 'Admission number ' + existing.data().admissionNo + ' is already used by '
      + existing.data().name + '. Use Edit to change that student.';
    return;
  }
  runSetupAction(async () => {
    await academic.save('students', id, {
      admissionNo, name: value('name'), guardianName: value('guardianName'),
      guardianPhone: value('guardianPhone'), status: existing?.data().status ?? 'active',
    });
    studentForm.reset();
  }, 'Student saved.', studentStatus);
});

const placementStatus = document.querySelector('#placement-status');
const placementList = document.querySelector('#placement-list');
const placementForm = document.querySelector('#placement-form');
let placementData = { years: [], classes: [], sections: [], enrollments: [] };

function renderPlacements() {
  const { years, classes, sections, enrollments } = placementData;
  const className = (id) => classes.find((record) => record.id === id)?.data().name ?? id;
  const sectionLabel = (record) => className(record.data().classId) + ' - ' + record.data().name;
  placementList.replaceChildren();
  const sorted = [...enrollments].sort((a, b) => (a.data().yearId + a.data().sectionId).localeCompare(
    b.data().yearId + b.data().sectionId) || a.data().rollNo - b.data().rollNo);
  for (const record of sorted) {
    const item = record.data();
    const student = studentRecords.find((candidate) => candidate.id === item.studentId)?.data();
    const section = sections.find((candidate) => candidate.id === item.sectionId);
    listItem(placementList, (student ? student.name + ' (' + student.admissionNo + ')' : item.studentId)
      + ' - ' + (section ? sectionLabel(section) : item.sectionId) + ' - Roll ' + item.rollNo + ' - ' + item.yearId);
  }
  fillSelect(placementForm.elements.namedItem('yearId'),
    years.filter((record) => record.data().status !== 'closed'), (item) => item.label + ' (' + item.status + ')');
  fillSelect(placementForm.elements.namedItem('studentId'),
    studentRecords.filter((record) => record.data().status === 'active')
      .sort((a, b) => a.data().name.localeCompare(b.data().name)),
    (item) => item.name + ' (' + item.admissionNo + ')');
  fillSelect(placementForm.elements.namedItem('sectionId'),
    [...sections].sort((a, b) => a.id.localeCompare(b.id)).map((record) => ({
      id: record.id, data: () => ({ label: sectionLabel(record) }),
    })), (item) => item.label);
}

placementForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(placementForm);
  const yearId = String(fields.get('yearId') ?? '');
  const studentId = String(fields.get('studentId') ?? '');
  const sectionId = String(fields.get('sectionId') ?? '');
  const rollNo = Number(fields.get('rollNo'));
  if (!yearId || !studentId || !sectionId) {
    placementStatus.textContent = 'Add an open academic year, an active student and a section first.';
    return;
  }
  if (!Number.isInteger(rollNo) || rollNo < 1 || rollNo > 999) {
    placementStatus.textContent = 'Roll number must be a whole number from 1 to 999.';
    return;
  }
  const { sections, enrollments } = placementData;
  const section = sections.find((record) => record.id === sectionId);
  const holder = enrollments.find((record) => record.data().yearId === yearId
    && record.data().sectionId === sectionId && record.data().rollNo === rollNo);
  if (holder && holder.data().studentId !== studentId) {
    const other = studentRecords.find((record) => record.id === holder.data().studentId)?.data();
    placementStatus.textContent = 'Roll ' + rollNo + ' in this section is already held by '
      + (other ? other.name : holder.data().studentId) + '.';
    return;
  }
  const current = enrollments.find((record) => record.id === yearId + '_' + studentId)?.data();
  if (current && current.sectionId === sectionId && current.rollNo === rollNo) {
    placementStatus.textContent = 'This student already has that class, section and roll number.';
    return;
  }
  const ops = [
    { path: ['enrollments', yearId + '_' + studentId],
      data: { yearId, studentId, classId: section.data().classId, sectionId, rollNo } },
    { path: ['rollKeys', yearId + '_' + sectionId + '_' + rollNo],
      data: { yearId, sectionId, rollNo, studentId } },
  ];
  // Moving a student releases the roll number they held before.
  if (current) ops.push({ path: ['rollKeys', yearId + '_' + current.sectionId + '_' + current.rollNo], delete: true });
  runSetupAction(async () => {
    await academic.commit(ops);
    placementForm.elements.namedItem('rollNo').value = '';
  }, current ? 'Student moved.' : 'Student placed.', placementStatus);
});

const reviewSection = document.querySelector('#marks-review');
const reviewStatus = document.querySelector('#review-status');
const reviewExam = document.querySelector('#review-exam');
const reviewSummary = document.querySelector('#review-summary');
const reviewBody = document.querySelector('#review-body');
const reviewRefresh = document.querySelector('#review-refresh');
const reviewActions = document.querySelector('#review-actions');
let reviewRequest = 0;

function renderReviewExams() {
  const { classes, subjects, exams } = examData;
  const nameOf = (records, id) => records.find((record) => record.id === id)?.data().name ?? id;
  fillSelect(reviewExam, [...exams].sort((a, b) => a.id.localeCompare(b.id)),
    (exam) => exam.name + ' - ' + nameOf(classes, exam.classId) + ' - ' + nameOf(subjects, exam.subjectId)
      + ' - ' + exam.yearId + (exam.status === 'open' ? '' : ' - ' + (exam.published ? 'published' : exam.status)));
}

// Pass mark and grade bands. The owner sets them in settings/grading; until then these defaults apply.
const DEFAULT_GRADING = { passPercent: 40, minAPlus: 90, minA: 80, minB: 70, minC: 60, minD: 50, minE: 40 };
let grading = { ...DEFAULT_GRADING };
const GRADING_FIELDS = Object.keys(DEFAULT_GRADING);
const gradeFor = (percent) => {
  const bands = [[grading.minAPlus, 'A+'], [grading.minA, 'A'], [grading.minB, 'B'],
    [grading.minC, 'C'], [grading.minD, 'D'], [grading.minE, 'E']];
  return (bands.find(([min]) => percent >= min) ?? [0, 'F'])[1];
};
const isPass = (percent) => percent >= grading.passPercent;
const gradeText = (percent) => gradeFor(percent) + ' - ' + (isPass(percent) ? 'Pass' : 'Fail');
const resultText = (failed) => (failed ? 'Fail in ' + failed + ' subject' + (failed === 1 ? '' : 's') : 'Pass');

async function loadGrading(schoolRef) {
  const { doc, getDocFromServer } = firestoreTools;
  try {
    const saved = await getDocFromServer(doc(schoolRef, 'settings', 'grading'));
    grading = saved.exists() && GRADING_FIELDS.every((key) => Number.isInteger(saved.data()[key]))
      ? Object.fromEntries(GRADING_FIELDS.map((key) => [key, saved.data()[key]]))
      : { ...DEFAULT_GRADING };
  } catch {
    grading = { ...DEFAULT_GRADING };
  }
}

async function renderMarksReview() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++reviewRequest;
  reviewBody.replaceChildren();
  reviewActions.replaceChildren();
  reviewSummary.textContent = '';
  const examRecord = examData.exams.find((record) => record.id === reviewExam.value);
  if (!tools || !examRecord) {
    reviewStatus.textContent = 'Create an exam first to review its marks.';
    return;
  }
  const exam = examRecord.data();
  reviewStatus.textContent = 'Loading marks.';
  try {
    const saved = await tools.marksFor(examRecord.id);
    if (request !== schoolRequest || token !== reviewRequest) return;
    const scores = new Map(saved.docs.map((record) => [record.data().studentId, record.data().score]));
    const sectionName = (id) => placementData.sections.find((record) => record.id === id)?.data().name ?? id;
    const students = new Map(studentRecords.map((record) => [record.id, record.data()]));
    const rows = placementData.enrollments.map((record) => record.data())
      .filter((item) => item.yearId === exam.yearId && item.classId === exam.classId)
      .sort((a, b) => sectionName(a.sectionId).localeCompare(sectionName(b.sectionId)) || a.rollNo - b.rollNo);
    for (const row of rows) {
      const student = students.get(row.studentId);
      const tr = document.createElement('tr');
      const has = scores.has(row.studentId);
      const marks = has ? scores.get(row.studentId) + ' / ' + exam.maxMarks : 'Missing';
      const percent = has ? Math.round(scores.get(row.studentId) / exam.maxMarks * 1000) / 10 : null;
      for (const text of [sectionName(row.sectionId), String(row.rollNo),
        student ? student.name + ' (' + student.admissionNo + ')' : row.studentId, marks,
        has ? percent + '%' : '-', has ? gradeText(percent) : '-']) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      reviewBody.append(tr);
    }
    const entered = rows.filter((row) => scores.has(row.studentId)).map((row) => scores.get(row.studentId));
    reviewSummary.textContent = rows.length
      ? entered.length + ' of ' + rows.length + ' students have marks'
        + (entered.length ? '. Highest ' + Math.max(...entered) + ', lowest ' + Math.min(...entered)
          + ', average ' + (Math.round(entered.reduce((sum, score) => sum + score, 0) / entered.length * 10) / 10)
          + ' (out of ' + exam.maxMarks + '). ' + entered.filter((score) => score / exam.maxMarks * 100 >= 40).length
          + ' of ' + entered.length + ' at or above 40%.' : '.')
      : 'No students are placed in this class for ' + exam.yearId + '.';
    const missing = rows.length - entered.length;
    reviewStatus.textContent = {
      open: 'This exam is open for marks entry. Lock it when entry is finished.',
      locked: 'This exam is locked. Check the marks, then approve the results.',
      approved: exam.published
        ? 'These results are approved and published.'
        : 'These results are approved and final. Publish them when they are ready to be shared.',
    }[exam.status];
    const action = (label, question, status, done, publish = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => runSetupAction(async () => {
        if (!confirm(typeof question === 'function' ? question() : question)) return false;
        const { approvedBy, published, ...rest } = exam;
        return academic.save('exams', examRecord.id,
          status === 'approved'
            ? { ...rest, status, approvedBy: auth.currentUser.uid, ...(publish ? { published: true } : {}) }
            : { ...rest, status });
      }, done, reviewStatus));
      reviewActions.append(button);
    };
    if (exam.status === 'open') {
      action('Lock exam', 'Lock ' + exam.name + '? Teachers can no longer enter or change marks. You can unlock it later.', 'locked', 'Exam locked.');
    } else if (exam.status === 'locked') {
      if (!viewOnly) action('Unlock exam', 'Unlock ' + exam.name + '? Teachers can then enter and change marks again.', 'open', 'Exam unlocked.');
      action('Approve results', () => (missing
        ? missing + ' student' + (missing === 1 ? ' has' : 's have') + ' no marks yet. Approve the results anyway?'
        : 'Approve the results for ' + exam.name + '? Marks become final.'), 'approved', 'Results approved.');
    } else if (exam.published) {
      action('Unpublish results', 'Unpublish the results for ' + exam.name + '? They stop being shared. Marks stay approved.', 'approved', 'Results unpublished.');
    } else {
      action('Publish results', 'Publish the results for ' + exam.name + '? They become available to share with students and parents.', 'approved', 'Results published.', true);
      action('Withdraw approval', 'Withdraw approval for ' + exam.name + '? The exam goes back to locked.', 'locked', 'Approval withdrawn.');
    }
  } catch {
    if (request === schoolRequest && token === reviewRequest) reviewStatus.textContent = 'Could not load marks. Try again.';
  }
}

const reportSection = document.querySelector('#report-card');
const reportStatus = document.querySelector('#report-status');
const reportStudent = document.querySelector('#report-student');
const reportBody = document.querySelector('#report-body');
const reportTotal = document.querySelector('#report-total');
let reportRequest = 0;

function renderReportStudents() {
  fillSelect(reportStudent, [...studentRecords].sort((a, b) => a.data().name.localeCompare(b.data().name)),
    (student) => student.name + ' (' + student.admissionNo + ')');
  renderReportCard();
}

// Report card (feature 047): one student, published exams only.
async function renderReportCard() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++reportRequest;
  reportBody.replaceChildren();
  reportTotal.textContent = '';
  const studentId = reportStudent.value;
  if (!tools || !studentId) {
    reportStatus.textContent = 'Add a student to see a report card.';
    return;
  }
  reportStatus.textContent = 'Loading report card.';
  try {
    const saved = await tools.marksOfStudent(studentId);
    if (request !== schoolRequest || token !== reportRequest) return;
    const nameOf = (records, id) => records.find((record) => record.id === id)?.data().name ?? id;
    const published = new Map(examData.exams.filter((record) => record.data().published === true)
      .map((record) => [record.id, record.data()]));
    const lines = saved.docs.map((record) => record.data())
      .filter((mark) => published.has(mark.examId))
      .map((mark) => ({ exam: published.get(mark.examId), mark }))
      .sort((a, b) => a.exam.yearId.localeCompare(b.exam.yearId)
        || nameOf(examData.subjects, a.exam.subjectId).localeCompare(nameOf(examData.subjects, b.exam.subjectId)));
    let got = 0;
    let max = 0;
    let failed = 0;
    for (const { exam, mark } of lines) {
      const percent = Math.round(mark.score / exam.maxMarks * 1000) / 10;
      got += mark.score;
      max += exam.maxMarks;
      if (!isPass(percent)) failed += 1;
      const tr = document.createElement('tr');
      for (const text of [exam.yearId, nameOf(examData.subjects, exam.subjectId), exam.name,
        mark.score + ' / ' + exam.maxMarks, percent + '%', gradeText(percent)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      reportBody.append(tr);
    }
    reportStatus.textContent = lines.length ? '' : 'No published results for this student yet.';
    if (lines.length) {
      const overall = Math.round(got / max * 1000) / 10;
      reportTotal.textContent = 'Total ' + got + ' / ' + max + ' - ' + overall + '% - Grade ' + gradeFor(overall) + ' - ' + resultText(failed);
    }
  } catch {
    if (request === schoolRequest && token === reportRequest) reportStatus.textContent = 'Could not load the report card. Try again.';
  }
}

reportStudent.addEventListener('change', renderReportCard);

// Family access (feature 048): the owner links a student or parent account to one student.
const linkSection = document.querySelector('#family-access');
const linkForm = document.querySelector('#family-form');
const linkStatus = document.querySelector('#family-status');
const linkList = document.querySelector('#family-list');
let linkRequest = 0;

async function renderFamilyLinks() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++linkRequest;
  const sortedStudents = [...studentRecords].sort((a, b) => a.data().name.localeCompare(b.data().name));
  fillSelect(linkForm.elements.namedItem('studentId'), sortedStudents, (student) => student.name + ' (' + student.admissionNo + ')');
  fillSelect(linkForm.elements.namedItem('extra'), sortedStudents, (student) => student.name + ' (' + student.admissionNo + ')');
  linkList.replaceChildren();
  if (!tools) return;
  try {
    const saved = await tools.list('familyAccess');
    if (request !== schoolRequest || token !== linkRequest) return;
    for (const record of saved.docs.sort((a, b) => a.id.localeCompare(b.id))) {
      const link = record.data();
      const student = studentRecords.find((item) => item.id === link.studentId)?.data();
      const item = document.createElement('li');
      item.textContent = record.id + ' - ' + (student ? student.name + ' (' + student.admissionNo + ')' : link.studentId)
        + (link.extraStudentIds?.length ? ' + ' + link.extraStudentIds.map((id) => studentRecords.find((item) => item.id === id)?.data().name ?? id).join(', ') : '')
        + ' - ' + link.relation + ' - ' + (link.active ? 'active' : 'switched off');
      linkList.append(item);
    }
  } catch {
    if (request === schoolRequest && token === linkRequest) linkStatus.textContent = 'Could not load linked accounts. Try again.';
  }
}

linkForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(linkForm);
  const uid = String(fields.get('uid') ?? '').trim();
  const studentId = String(fields.get('studentId') ?? '');
  const relation = String(fields.get('relation') ?? '');
  if (!uid || uid.length > 128 || uid.includes('/')) {
    linkStatus.textContent = 'Enter the account ID (UID) from Firebase Authentication.';
    return;
  }
  if (!studentId) {
    linkStatus.textContent = 'Add a student first.';
    return;
  }
  const extras = [...new Set(fields.getAll('extra').map(String))].filter((id) => id && id !== studentId);
  if (extras.length && relation !== 'parent') {
    linkStatus.textContent = 'Only a parent login can have more than one child.';
    return;
  }
  if (extras.length > 4) {
    linkStatus.textContent = 'Pick at most 4 other children.';
    return;
  }
  const year = activeYearRecord();
  const extraClassIds = [...new Set(extras.map((id) => placementData.enrollments
    .find((record) => year && record.data().yearId === year.id && record.data().studentId === id)?.data().classId).filter(Boolean))];
  runSetupAction(async () => {
    await academic.save('familyAccess', uid, { studentId, relation, active: fields.get('state') === 'active',
      ...(extras.length ? { extraStudentIds: extras, extraClassIds } : {}) });
    linkForm.elements.namedItem('uid').value = '';
  }, 'Access saved.', linkStatus);
});
const portalDashboard = document.querySelector('#portal-dashboard');
const viewOnlyNote = document.querySelector('#view-only-note');
const ownerRole = document.querySelector('#owner-role');
let viewOnly = false;
// A principal sees every owner screen but cannot change anything: the rules refuse writes, and these
// two capture handlers stop the buttons and forms first so the page says why.
dashboard.addEventListener('click', (event) => {
  const button = viewOnly ? event.target.closest('button') : null;
  if (!button || /^(download|print|show|refresh|view|preview|approve results)/i.test(button.textContent.trim())) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  viewOnlyNote.focus?.();
  viewOnlyNote.textContent = 'View only. You cannot change anything with this login.';
}, true);
dashboard.addEventListener('submit', (event) => {
  if (!viewOnly) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  viewOnlyNote.textContent = 'View only. You cannot change anything with this login.';
}, true);
// Find a screen: lists the visible headings of the dashboard, filtered by what is typed, and scrolls to the chosen one.
const jumpSearch = document.querySelector('#jump-search');
const jumpSelect = document.querySelector('#jump');
let jumpTargets = [];
function refreshJump() {
  const words = jumpSearch.value.trim().toLowerCase();
  jumpTargets = [...dashboard.querySelectorAll('h3')].filter((heading) => !heading.closest('[hidden]') && heading.textContent.trim()
    && (!words || heading.textContent.toLowerCase().includes(words)));
  jumpSelect.replaceChildren(new Option(jumpTargets.length ? 'Choose a screen (' + jumpTargets.length + ')' : 'No screen matches', ''),
    ...jumpTargets.map((heading, index) => new Option(heading.textContent.trim(), String(index))));
}
jumpSearch.addEventListener('input', refreshJump);
jumpSelect.addEventListener('focus', refreshJump);
jumpSelect.addEventListener('mousedown', refreshJump);
jumpSelect.addEventListener('change', () => {
  const heading = jumpTargets[Number(jumpSelect.value)];
  if (!heading || jumpSelect.value === '') return;
  heading.tabIndex = -1;
  heading.scrollIntoView({ block: 'start' });
  heading.focus();
});

const portalChildWrap = document.querySelector('#portal-child-wrap');
const portalChild = document.querySelector('#portal-child');
let portalChoice = '';
let portalTools;
portalChild.addEventListener('change', () => {
  portalChoice = portalChild.value;
  if (portalTools) loadPortal(portalTools, schoolRequest);
});
const portalEmail = document.querySelector('#portal-email');
const portalStatus = document.querySelector('#portal-status');
const portalStudent = document.querySelector('#portal-student');
const portalBody = document.querySelector('#portal-body');
const portalTotal = document.querySelector('#portal-total');

// Student and parent page (feature 048). Marks are read one by one by ID: the rules allow only
// the linked student's marks in published exams, so an exam from another class is skipped.
async function loadPortal(tools, request) {
  const { schoolRef, user, doc, collection, getDocFromServer, getDocsFromServer, query, where } = tools;
  portalEmail.textContent = user.email;
  portalDashboard.hidden = false;
  await loadGrading(schoolRef);
  portalStatus.textContent = 'Loading results.';
  try {
    const link = await getDocFromServer(doc(schoolRef, 'familyAccess', user.uid));
    if (request !== schoolRequest) return;
    if (!link.exists() || link.data().active !== true) {
      portalStatus.textContent = 'Your account is not linked to a student yet. Ask the school office.';
      return;
    }
    const children = [link.data().studentId, ...(link.data().extraStudentIds ?? [])];
    const studentId = children.includes(portalChoice) ? portalChoice : children[0];
    portalTools = tools;
    portalBody.replaceChildren();
    portalTotal.textContent = '';
    if (children.length > 1) {
      const names = await Promise.all(children.map(async (id) => {
        try {
          const record = await getDocFromServer(doc(schoolRef, 'students', id));
          return record.exists() ? record.data().name : id;
        } catch {
          return id;
        }
      }));
      if (request !== schoolRequest) return;
      portalChild.replaceChildren();
      children.forEach((id, index) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = names[index];
        portalChild.append(option);
      });
      portalChild.value = studentId;
      portalChildWrap.hidden = false;
    } else {
      portalChildWrap.hidden = true;
    }
    loadPortalAttendance(tools, request, studentId);
    loadPortalFees(tools, request, studentId);
    loadPortalNotices(tools, request, studentId);
    loadPortalSchoolwork(tools, request, studentId);
    loadPortalLife(tools, request, studentId);
    loadPortalCommunity(tools, request, studentId);
    loadPortalEvents(tools, request, studentId);
    loadPortalCoursework(tools, request, studentId);
    loadUpcomingEvents(tools.schoolRef, portalCalendarSection, portalCalendarStatus, portalCalendarList);
    const [student, exams] = await Promise.all([
      getDocFromServer(doc(schoolRef, 'students', studentId)),
      getDocsFromServer(query(collection(schoolRef, 'exams'), where('published', '==', true))),
    ]);
    if (request !== schoolRequest) return;
    const attempt = async (promise) => { try { return await promise; } catch { return null; } };
    const marks = await Promise.all(exams.docs.map((record) =>
      attempt(getDocFromServer(doc(schoolRef, 'marks', record.id + '_' + studentId)))));
    const subjectIds = [...new Set(exams.docs.map((record) => record.data().subjectId))];
    const subjectDocs = await Promise.all(subjectIds.map((id) => attempt(getDocFromServer(doc(schoolRef, 'subjects', id)))));
    if (request !== schoolRequest) return;
    const subjectName = new Map(subjectIds.map((id, index) => [id, subjectDocs[index]?.data()?.name ?? id]));
    const lines = exams.docs.map((record, index) => ({ exam: record.data(), mark: marks[index]?.exists() ? marks[index].data() : null }))
      .filter((line) => line.mark)
      .sort((a, b) => a.exam.yearId.localeCompare(b.exam.yearId) || subjectName.get(a.exam.subjectId).localeCompare(subjectName.get(b.exam.subjectId)));
    portalStudent.textContent = student.exists() ? student.data().name + ' (' + student.data().admissionNo + ')' : '';
    let got = 0;
    let max = 0;
    let failed = 0;
    for (const { exam, mark } of lines) {
      const percent = Math.round(mark.score / exam.maxMarks * 1000) / 10;
      got += mark.score;
      max += exam.maxMarks;
      if (!isPass(percent)) failed += 1;
      const tr = document.createElement('tr');
      for (const text of [exam.yearId, subjectName.get(exam.subjectId), exam.name,
        mark.score + ' / ' + exam.maxMarks, percent + '%', gradeText(percent)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      portalBody.append(tr);
    }
    portalStatus.textContent = lines.length ? '' : 'No results have been published yet.';
    if (lines.length) {
      const overall = Math.round(got / max * 1000) / 10;
      portalTotal.textContent = 'Total ' + got + ' / ' + max + ' - ' + overall + '% - Grade ' + gradeFor(overall) + ' - ' + resultText(failed);
    }
  } catch {
    if (request === schoolRequest) portalStatus.textContent = 'Could not load results. Try again.';
  }
}

reviewExam.addEventListener('change', renderMarksReview);
reviewRefresh.addEventListener('click', () => { if (academic) loadAcademic(schoolRequest).then(renderMarksReview); });

const examSection = document.querySelector('#exam-setup');
const examStatus = document.querySelector('#exam-status');
const examList = document.querySelector('#exam-list');
const examForm = document.querySelector('#exam-form');
let examData = { years: [], classes: [], subjects: [], mappings: [], exams: [] };

function renderExams() {
  const { years, classes, subjects, mappings, exams } = examData;
  const nameOf = (records, id) => records.find((record) => record.id === id)?.data().name ?? id;
  examList.replaceChildren();
  const sorted = [...exams].sort((a, b) => a.id.localeCompare(b.id));
  for (const record of sorted) {
    const exam = record.data();
    let button;
    if (exam.status !== 'approved') {
      button = document.createElement('button');
      button.type = 'button';
      const isOpen = exam.status === 'open';
      button.textContent = (isOpen ? 'Lock ' : 'Unlock ') + exam.name;
      button.disabled = !years.some((year) => year.id === exam.yearId && year.data().status !== 'closed');
      button.addEventListener('click', () => runSetupAction(async () => {
        const question = isOpen
          ? 'Lock ' + exam.name + '? It cannot be changed while locked. You can unlock it later.'
          : 'Unlock ' + exam.name + '? Its name and maximum marks can then be changed again.';
        if (!confirm(question)) return false;
        return academic.save('exams', record.id, { ...exam, status: isOpen ? 'locked' : 'open' });
      }, isOpen ? 'Exam locked.' : 'Exam unlocked.', examStatus));
    }
    listItem(examList, exam.name + ' - ' + nameOf(classes, exam.classId) + ' - ' + nameOf(subjects, exam.subjectId)
      + ' - max ' + exam.maxMarks + ' - ' + exam.yearId + ' - ' + exam.status, button);
  }
  fillSelect(examForm.elements.namedItem('yearId'),
    years.filter((record) => record.data().status !== 'closed'), (item) => item.label + ' (' + item.status + ')');
  const links = [...mappings].sort((a, b) => a.id.localeCompare(b.id)).map((record) => ({
    id: record.id,
    data: () => ({ label: nameOf(classes, record.data().classId) + ' - ' + nameOf(subjects, record.data().subjectId) }),
  }));
  fillSelect(examForm.elements.namedItem('mappingId'), links, (item) => item.label);
  fillSelect(assignmentForm.elements.namedItem('mappingId'), links, (item) => item.label);
}

examForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(examForm);
  const yearId = String(fields.get('yearId') ?? '');
  const mapping = examData.mappings.find((record) => record.id === String(fields.get('mappingId') ?? ''));
  const name = String(fields.get('name') ?? '').trim();
  const examKey = slug(name, 20);
  const maxMarks = Number(fields.get('maxMarks'));
  if (!yearId || !mapping) {
    examStatus.textContent = 'Add an open academic year and link a subject to a class first.';
    return;
  }
  if (!name || !examKey) {
    examStatus.textContent = 'Give the exam a name with letters or numbers.';
    return;
  }
  if (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > 1000) {
    examStatus.textContent = 'Maximum marks must be a whole number from 1 to 1000.';
    return;
  }
  const { classId, subjectId } = mapping.data();
  const id = yearId + '_' + classId + '_' + subjectId + '_' + examKey;
  const existing = examData.exams.find((record) => record.id === id)?.data();
  if (existing && existing.status === 'locked') {
    examStatus.textContent = 'This exam is locked. Unlock it first to change it.';
    return;
  }
  runSetupAction(async () => {
    await academic.save('exams', id, { yearId, classId, subjectId, examKey, name, maxMarks, status: 'open' });
    examForm.elements.namedItem('name').value = '';
    examForm.elements.namedItem('maxMarks').value = '';
  }, existing ? 'Exam updated.' : 'Exam saved.', examStatus);
});

const examMarksSection = document.querySelector('#exam-marks');
const examMarksStatus = document.querySelector('#exam-marks-status');
const examMarksSelect = document.querySelector('#exam-marks-exam');
const examMarksForm = document.querySelector('#exam-marks-form');
const examMarksBody = document.querySelector('#exam-marks-body');
const examMarksHeading = document.querySelector('#exam-marks-heading');
let teacherMarks; // { schoolRef, uid, classId, subjectId, exams, busy }
const MARKS_PER_BATCH = 10;

async function loadTeacherExams(request) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  const context = teacherMarks;
  const snapshot = await getDocsFromServer(query(collection(context.schoolRef, 'exams'),
    where('classId', '==', context.classId), where('subjectId', '==', context.subjectId)));
  if (request !== schoolRequest || context !== teacherMarks) return;
  // Open exams first, so the screen opens on an exam that can be marked.
  const rank = { open: 0, locked: 1, approved: 2 };
  context.exams = snapshot.docs.sort((a, b) => rank[a.data().status] - rank[b.data().status] || a.id.localeCompare(b.id));
  fillSelect(examMarksSelect, context.exams,
    (exam) => exam.name + ' - ' + exam.yearId + ' (out of ' + exam.maxMarks + ')' + (exam.status === 'open' ? '' : ' - ' + exam.status));
  await renderTeacherMarks(request);
}

async function renderTeacherMarks(request) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  const context = teacherMarks;
  examMarksBody.replaceChildren();
  const examRecord = context.exams.find((record) => record.id === examMarksSelect.value);
  if (!examRecord) {
    examMarksStatus.textContent = 'No exams have been set up for your class and subject yet.';
    return;
  }
  const exam = examRecord.data();
  examMarksHeading.textContent = 'Marks (out of ' + exam.maxMarks + ')';
  examMarksStatus.textContent = 'Loading students.';
  try {
    const [placements, sections, saved] = await Promise.all([
      getDocsFromServer(query(collection(context.schoolRef, 'enrollments'),
        where('yearId', '==', exam.yearId), where('classId', '==', context.classId))),
      getDocsFromServer(query(collection(context.schoolRef, 'sections'), where('classId', '==', context.classId))),
      getDocsFromServer(query(collection(context.schoolRef, 'marks'),
        where('examId', '==', examRecord.id), where('enteredBy', '==', context.uid))),
    ]);
    if (request !== schoolRequest || context !== teacherMarks || examRecord.id !== examMarksSelect.value) return;
    const scores = new Map(saved.docs.map((record) => [record.data().studentId, record.data().score]));
    const sectionName = (id) => sections.docs.find((record) => record.id === id)?.data().name ?? id;
    const rows = placements.docs.map((record) => record.data())
      .sort((a, b) => sectionName(a.sectionId).localeCompare(sectionName(b.sectionId)) || a.rollNo - b.rollNo);
    for (const row of rows) {
      const tr = document.createElement('tr');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(exam.maxMarks);
      input.step = '1';
      input.disabled = exam.status !== 'open';
      input.dataset.student = row.studentId;
      input.dataset.original = scores.has(row.studentId) ? String(scores.get(row.studentId)) : '';
      input.value = input.dataset.original;
      input.setAttribute('aria-label', 'Marks for ' + sectionName(row.sectionId) + ' roll ' + row.rollNo);
      for (const content of [sectionName(row.sectionId), String(row.rollNo), input]) {
        const td = document.createElement('td');
        td.append(content);
        tr.append(td);
      }
      examMarksBody.append(tr);
    }
    examMarksForm.querySelector('button[type="submit"]').disabled = exam.status !== 'open' || !rows.length;
    examMarksStatus.textContent = exam.status === 'approved'
      ? 'These marks are approved and final.'
      : exam.status === 'locked'
        ? 'This exam is locked. Ask the principal to unlock it to change marks.'
        : rows.length ? '' : 'No students have been placed in your class for this year yet.';
  } catch {
    if (request === schoolRequest) examMarksStatus.textContent = 'Could not load students. Try again.';
  }
}

examMarksSelect.addEventListener('change', () => {
  if (teacherMarks) renderTeacherMarks(schoolRequest);
});

examMarksForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherMarks;
  if (!context || context.busy) return;
  const examRecord = context.exams.find((record) => record.id === examMarksSelect.value);
  if (!examRecord) return;
  const exam = examRecord.data();
  const writes = [];
  for (const input of examMarksBody.querySelectorAll('input')) {
    if (input.value === '' || input.value === input.dataset.original) continue;
    const score = Number(input.value);
    if (!Number.isInteger(score) || score < 0 || score > exam.maxMarks) {
      examMarksStatus.textContent = 'Marks must be whole numbers from 0 to ' + exam.maxMarks + '.';
      input.focus();
      return;
    }
    writes.push({ studentId: input.dataset.student, score });
  }
  if (!writes.length) {
    examMarksStatus.textContent = 'No new or changed marks to save.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  let done = 0;
  try {
    // One write per student: the rules read several documents to check each mark, and a
    // batched write may only read 20 in total. Ten parallel writes at a time keeps it quick.
    for (let start = 0; start < writes.length; start += MARKS_PER_BATCH) {
      examMarksStatus.textContent = 'Saving marks ' + (start + 1) + ' of ' + writes.length + '.';
      const results = await Promise.allSettled(writes.slice(start, start + MARKS_PER_BATCH).map(({ studentId, score }) => setDoc(
        doc(context.schoolRef, 'marks', examRecord.id + '_' + studentId), {
          examId: examRecord.id, yearId: exam.yearId, classId: exam.classId, subjectId: exam.subjectId,
          studentId, score, maxMarks: exam.maxMarks, enteredBy: context.uid,
        })));
      done += results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    if (request !== schoolRequest || context !== teacherMarks) return;
    await renderTeacherMarks(request);
    if (request === schoolRequest) examMarksStatus.textContent = 'Saved ' + done + ' mark' + (done === 1 ? '' : 's') + '.';
  } catch (error) {
    if (request !== schoolRequest || context !== teacherMarks) return;
    await renderTeacherMarks(request);
    examMarksStatus.textContent = (done ? 'Saved ' + done + ' of ' + writes.length + ' marks. ' : '')
      + (error.code === 'permission-denied'
        ? 'The rest could not be saved. The exam may be locked, or a student may have moved class.'
        : 'Could not save all marks. Check your connection and save again.');
  } finally {
    if (done) await writeAudit(context.schoolRef, context.uid, 'marks', 'marks', examRecord.id, done + ' mark' + (done === 1 ? '' : 's'));
    context.busy = false;
  }
});

// Attendance. The owner picks one class teacher per class. The class teacher marks
// each school day and the owner reviews it. One record per student per day: date_classId_studentId.
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const now = new Date();
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
};
const DATE_TEXT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late' };
const byClassOrder = (a, b) => a.data().order - b.data().order;

const classTeacherSection = document.querySelector('#class-teachers');
const classTeacherStatus = document.querySelector('#class-teacher-status');
const classTeacherList = document.querySelector('#class-teacher-list');
const classTeacherForm = document.querySelector('#class-teacher-form');
let classTeacherData = [];

function renderClassTeachers() {
  const classes = [...examData.classes].sort(byClassOrder);
  classTeacherList.replaceChildren();
  for (const record of classes) {
    const holder = classTeacherData.find((item) => item.id === record.id)?.data().teacherUid;
    listItem(classTeacherList, record.data().name + ' - ' + (holder ? 'class teacher account ' + holder : 'no class teacher yet'));
  }
  fillSelect(classTeacherForm.elements.namedItem('classId'), classes, (item) => item.name);
}

classTeacherForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(classTeacherForm);
  const classId = String(fields.get('classId') ?? '');
  const uid = String(fields.get('uid') ?? '').trim();
  if (!classId) {
    classTeacherStatus.textContent = 'Add a class in Academic Setup first.';
    return;
  }
  if (!uid || uid.length > 128 || uid.includes('/')) {
    classTeacherStatus.textContent = 'Enter the teacher account ID (UID) from Firebase Authentication.';
    return;
  }
  runSetupAction(async () => {
    await academic.save('classTeachers', classId, { teacherUid: uid });
    classTeacherForm.elements.namedItem('uid').value = '';
  }, 'Class teacher saved.', classTeacherStatus);
});

// Owner review: one date at a time, class by class, then the students of one class.
const attReviewSection = document.querySelector('#attendance-review');
const attReviewStatus = document.querySelector('#attendance-review-status');
const attReviewDate = document.querySelector('#attendance-review-date');
const attReviewRefresh = document.querySelector('#attendance-review-refresh');
const attReviewBody = document.querySelector('#attendance-review-body');
const attReviewClass = document.querySelector('#attendance-review-class');
const attDetailBody = document.querySelector('#attendance-detail-body');
let attReviewToken = 0;
let attReviewState; // { rows: Map(classId -> placements), marks: Map(classId/studentId -> status) }

function addRow(body, cells) {
  const tr = document.createElement('tr');
  for (const text of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  body.append(tr);
}

function renderAttendanceDetail() {
  attDetailBody.replaceChildren();
  if (!attReviewState) return;
  const sectionName = (id) => placementData.sections.find((record) => record.id === id)?.data().name ?? id;
  const students = new Map(studentRecords.map((record) => [record.id, record.data()]));
  const classId = attReviewClass.value;
  for (const row of attReviewState.rows.get(classId) ?? []) {
    const student = students.get(row.studentId);
    const mark = attReviewState.marks.get(classId + '/' + row.studentId);
    addRow(attDetailBody, [sectionName(row.sectionId), String(row.rollNo),
      student ? student.name + ' (' + student.admissionNo + ')' : row.studentId,
      mark ? STATUS_LABEL[mark] : 'Not marked']);
  }
}

async function renderAttendanceReview() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++attReviewToken;
  attReviewBody.replaceChildren();
  attDetailBody.replaceChildren();
  attReviewState = undefined;
  if (!tools) return;
  const year = placementData.years.find((record) => record.data().status === 'active');
  const date = attReviewDate.value;
  if (!year) {
    attReviewStatus.textContent = 'Activate an academic year to review attendance.';
    return;
  }
  if (!DATE_TEXT.test(date)) {
    attReviewStatus.textContent = 'Choose a date.';
    return;
  }
  attReviewStatus.textContent = 'Loading attendance.';
  try {
    const saved = await tools.attendanceOn(date);
    if (request !== schoolRequest || token !== attReviewToken) return;
    const marks = new Map(saved.docs.filter((record) => record.data().yearId === year.id)
      .map((record) => [record.data().classId + '/' + record.data().studentId, record.data().status]));
    const students = new Map(studentRecords.map((record) => [record.id, record.data()]));
    const sectionName = (id) => placementData.sections.find((record) => record.id === id)?.data().name ?? id;
    const placed = placementData.enrollments.map((record) => record.data())
      .filter((item) => item.yearId === year.id && students.get(item.studentId)?.status === 'active');
    const classes = [...examData.classes].sort(byClassOrder);
    const rows = new Map();
    let marked = 0;
    for (const record of classes) {
      const list = placed.filter((item) => item.classId === record.id)
        .sort((a, b) => sectionName(a.sectionId).localeCompare(sectionName(b.sectionId)) || a.rollNo - b.rollNo);
      rows.set(record.id, list);
      const count = { present: 0, absent: 0, late: 0 };
      for (const item of list) {
        const mark = marks.get(record.id + '/' + item.studentId);
        if (mark) count[mark] += 1;
      }
      const done = count.present + count.absent + count.late;
      if (done) marked += 1;
      addRow(attReviewBody, [record.data().name,
        classTeacherData.find((item) => item.id === record.id)?.data().teacherUid ?? 'Not set',
        String(list.length), String(count.present), String(count.absent), String(count.late), String(list.length - done)]);
    }
    attReviewState = { rows, marks };
    fillSelect(attReviewClass, classes, (item) => item.name);
    renderAttendanceDetail();
    attReviewStatus.textContent = classes.length
      ? marked + ' of ' + classes.length + ' classes have attendance marked for ' + date + '.'
      : 'Add classes in Academic Setup first.';
  } catch {
    if (request === schoolRequest && token === attReviewToken) attReviewStatus.textContent = 'Could not load attendance. Try again.';
  }
}

attReviewDate.addEventListener('change', renderAttendanceReview);
attReviewRefresh.addEventListener('click', () => {
  if (academic) loadAcademic(schoolRequest);
});
attReviewClass.addEventListener('change', renderAttendanceDetail);

// Class teacher: the daily marking sheet.
const attMarkSection = document.querySelector('#attendance-mark');
const attMarkStatus = document.querySelector('#attendance-mark-status');
const attClass = document.querySelector('#attendance-class');
const attDate = document.querySelector('#attendance-date');
const attForm = document.querySelector('#attendance-form');
const attBody = document.querySelector('#attendance-body');
const attCounts = document.querySelector('#attendance-counts');
const attAllPresent = document.querySelector('#attendance-all-present');
const attSave = attForm.querySelector('button[type="submit"]');
let teacherAttendance; // { schoolRef, uid, year, names: Map(studentId -> student or null), busy }
let attToken = 0;
let attPrev = { classId: '', date: '' };
const ATTENDANCE_PER_GROUP = 10;

const attSelects = () => [...attBody.querySelectorAll('select')];
const attendanceDirty = () => attSelects().some((select) => select.value !== select.dataset.original);

function updateAttendanceCounts() {
  const count = { present: 0, absent: 0, late: 0, '': 0 };
  for (const select of attSelects()) count[select.value] += 1;
  attCounts.textContent = attSelects().length
    ? 'Present ' + count.present + ', absent ' + count.absent + ', late ' + count.late + ', not marked ' + count['']
    : '';
}

async function loadAttendanceClasses(request, schoolRef, uid) {
  const { collection, doc, query, where, getDocFromServer, getDocsFromServer } = firestoreTools;
  try {
    const mine = await getDocsFromServer(query(collection(schoolRef, 'classTeachers'), where('teacherUid', '==', uid)));
    if (request !== schoolRequest || mine.empty) return;
    attMarkSection.hidden = false;
    attMarkStatus.textContent = 'Loading your class.';
    const years = await getDocsFromServer(query(collection(schoolRef, 'academicYears'), where('status', '==', 'active')));
    if (request !== schoolRequest) return;
    if (years.empty) {
      attMarkStatus.textContent = 'There is no active academic year yet. Ask the principal to activate one.';
      return;
    }
    const classDocs = await Promise.all(mine.docs.map((record) => getDocFromServer(doc(schoolRef, 'classes', record.id))));
    if (request !== schoolRequest) return;
    const classes = classDocs.filter((record) => record.exists()).sort(byClassOrder);
    teacherAttendance = { schoolRef, uid, year: years.docs[0], names: new Map(), busy: false };
    const year = years.docs[0].data();
    fillSelect(attClass, classes, (item) => item.name);
    const today = localToday();
    attDate.min = year.startDate;
    attDate.max = today < year.endDate ? today : year.endDate;
    attDate.value = today >= year.startDate && today <= year.endDate ? today : attDate.max;
    attPrev = { classId: attClass.value, date: attDate.value };
    await renderTeacherAttendance(request);
  } catch {
    if (request === schoolRequest) attMarkStatus.textContent = 'Could not load your class. Refresh to try again.';
  }
}

async function renderTeacherAttendance(request) {
  const { collection, doc, query, where, getDocFromServer, getDocsFromServer } = firestoreTools;
  const context = teacherAttendance;
  const token = ++attToken;
  attBody.replaceChildren();
  attCounts.textContent = '';
  attSave.disabled = attAllPresent.disabled = true;
  const classId = attClass.value;
  const date = attDate.value;
  const year = context?.year.data();
  if (!context || !classId) {
    attMarkStatus.textContent = 'No class is assigned to you yet.';
    return;
  }
  if (!DATE_TEXT.test(date) || date < year.startDate || date > year.endDate || date > localToday()) {
    attMarkStatus.textContent = 'Choose a date this school year, up to today.';
    return;
  }
  attMarkStatus.textContent = 'Loading students.';
  const stale = () => request !== schoolRequest || context !== teacherAttendance || token !== attToken;
  try {
    const [placements, sections, saved] = await Promise.all([
      getDocsFromServer(query(collection(context.schoolRef, 'enrollments'),
        where('yearId', '==', context.year.id), where('classId', '==', classId))),
      getDocsFromServer(query(collection(context.schoolRef, 'sections'), where('classId', '==', classId))),
      getDocsFromServer(query(collection(context.schoolRef, 'attendance'),
        where('classId', '==', classId), where('date', '==', date))),
    ]);
    if (stale()) return;
    // Names are read one student at a time; the rules allow only students placed in your class.
    const missing = placements.docs.map((record) => record.data().studentId).filter((id) => !context.names.has(id));
    const fetched = await Promise.all(missing.map(async (id) => {
      try {
        const record = await getDocFromServer(doc(context.schoolRef, 'students', id));
        return [id, record.exists() ? record.data() : null];
      } catch {
        return [id, null];
      }
    }));
    if (stale()) return;
    for (const [id, student] of fetched) context.names.set(id, student);
    const marks = new Map(saved.docs.map((record) => [record.data().studentId, record.data().status]));
    const sectionName = (id) => sections.docs.find((record) => record.id === id)?.data().name ?? id;
    const rows = placements.docs.map((record) => record.data())
      .filter((item) => context.names.get(item.studentId)?.status !== 'inactive')
      .sort((a, b) => sectionName(a.sectionId).localeCompare(sectionName(b.sectionId)) || a.rollNo - b.rollNo);
    for (const row of rows) {
      const student = context.names.get(row.studentId);
      const original = marks.get(row.studentId) ?? '';
      const select = document.createElement('select');
      select.dataset.student = row.studentId;
      select.dataset.original = original;
      for (const [value, label] of [['', 'Not marked'], ...Object.entries(STATUS_LABEL)]) {
        // A saved mark can be corrected but not turned back into "not marked".
        if (value === '' && original) continue;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      select.value = original;
      select.setAttribute('aria-label', 'Attendance for ' + sectionName(row.sectionId) + ' roll ' + row.rollNo);
      select.addEventListener('change', updateAttendanceCounts);
      const tr = document.createElement('tr');
      for (const content of [sectionName(row.sectionId), String(row.rollNo),
        student ? student.name + ' (' + student.admissionNo + ')' : row.studentId, select]) {
        const td = document.createElement('td');
        td.append(content);
        tr.append(td);
      }
      attBody.append(tr);
    }
    attSave.disabled = attAllPresent.disabled = !rows.length;
    updateAttendanceCounts();
    attMarkStatus.textContent = rows.length ? '' : 'No students have been placed in this class for this year yet.';
  } catch {
    if (!stale()) attMarkStatus.textContent = 'Could not load students. Try again.';
  }
}

function onAttendanceChoice() {
  if (attendanceDirty() && !confirm('You have attendance that is not saved. Switch without saving it?')) {
    attClass.value = attPrev.classId;
    attDate.value = attPrev.date;
    return;
  }
  attPrev = { classId: attClass.value, date: attDate.value };
  if (teacherAttendance) renderTeacherAttendance(schoolRequest);
}
attClass.addEventListener('change', onAttendanceChoice);
attDate.addEventListener('change', onAttendanceChoice);

attAllPresent.addEventListener('click', () => {
  for (const select of attSelects()) if (select.value === '') select.value = 'present';
  updateAttendanceCounts();
});

attForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherAttendance;
  if (!context || context.busy) return;
  const classId = attClass.value;
  const date = attDate.value;
  const writes = attSelects().filter((select) => select.value !== '' && select.value !== select.dataset.original)
    .map((select) => ({ studentId: select.dataset.student, status: select.value }));
  if (!writes.length) {
    attMarkStatus.textContent = 'No new or changed attendance to save.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  attSave.disabled = true;
  let done = 0;
  try {
    // One write per student: each is checked on its own by the rules, so ten run at a time.
    for (let start = 0; start < writes.length; start += ATTENDANCE_PER_GROUP) {
      attMarkStatus.textContent = 'Saving attendance ' + (start + 1) + ' of ' + writes.length + '.';
      const results = await Promise.allSettled(writes.slice(start, start + ATTENDANCE_PER_GROUP).map(({ studentId, status }) => setDoc(
        doc(context.schoolRef, 'attendance', date + '_' + classId + '_' + studentId), {
          yearId: context.year.id, classId, studentId, date, status, markedBy: context.uid,
        })));
      done += results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    if (request !== schoolRequest || context !== teacherAttendance) return;
    await renderTeacherAttendance(request);
    if (request === schoolRequest) attMarkStatus.textContent = 'Saved attendance for ' + done + ' student' + (done === 1 ? '' : 's') + '.';
  } catch (error) {
    if (request !== schoolRequest || context !== teacherAttendance) return;
    await renderTeacherAttendance(request);
    attMarkStatus.textContent = (done ? 'Saved ' + done + ' of ' + writes.length + '. ' : '')
      + (error.code === 'permission-denied'
        ? 'The rest could not be saved. Check the date, and that you are still this class\'s teacher.'
        : 'Could not save all attendance. Check your connection and save again.');
  } finally {
    if (done) await writeAudit(context.schoolRef, context.uid, 'attendance', 'attendance', date + '_' + classId, done + ' student' + (done === 1 ? '' : 's'));
    context.busy = false;
  }
});

// Student and parent attendance. All of the linked student's marks are read once, by
// studentId (the rules allow only that), then filtered by month on the screen.
const portalAttSection = document.querySelector('#portal-attendance');
const portalAttStatus = document.querySelector('#portal-attendance-status');
const portalAttMonth = document.querySelector('#portal-attendance-month');
const portalAttTotal = document.querySelector('#portal-attendance-total');
const portalAttBody = document.querySelector('#portal-attendance-body');
let portalAttMarks = [];

function renderPortalAttendance() {
  portalAttBody.replaceChildren();
  portalAttTotal.textContent = '';
  const month = portalAttMonth.value;
  const marks = portalAttMarks.filter((mark) => mark.date.startsWith(month + '-'))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const mark of marks) addRow(portalAttBody, [mark.date, STATUS_LABEL[mark.status]]);
  if (!marks.length) {
    portalAttStatus.textContent = 'No attendance has been marked for this month.';
    return;
  }
  portalAttStatus.textContent = '';
  const count = { present: 0, absent: 0, late: 0 };
  for (const mark of marks) count[mark.status] += 1;
  const percent = Math.round((count.present + count.late) / marks.length * 1000) / 10;
  portalAttTotal.textContent = 'Present ' + count.present + ', absent ' + count.absent + ', late ' + count.late
    + ' - Attendance ' + percent + '% (present and late days out of ' + marks.length + ' marked)';
}

async function loadPortalAttendance(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalAttSection.hidden = false;
  portalAttMonth.value = localToday().slice(0, 7);
  portalAttStatus.textContent = 'Loading attendance.';
  try {
    const saved = await getDocsFromServer(query(collection(schoolRef, 'attendance'), where('studentId', '==', studentId)));
    if (request !== schoolRequest) return;
    portalAttMarks = saved.docs.map((record) => record.data());
    renderPortalAttendance();
  } catch {
    if (request === schoolRequest) portalAttStatus.textContent = 'Could not load attendance. Try again.';
  }
}

portalAttMonth.addEventListener('change', renderPortalAttendance);

// Owner: daily staff attendance sheet and monthly report. Teachers are the active members with
// the teacher role; the owner marks them and no one else can.
const STAFF_STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'Leave' };
const staffAttSection = document.querySelector('#staff-attendance');
const staffAttStatus = document.querySelector('#staff-attendance-status');
const staffAttDate = document.querySelector('#staff-attendance-date');
const staffAttForm = document.querySelector('#staff-attendance-form');
const staffAttBody = document.querySelector('#staff-attendance-body');
const staffAttCounts = document.querySelector('#staff-attendance-counts');
const staffAttAllPresent = document.querySelector('#staff-attendance-all-present');
const staffAttSave = staffAttForm.querySelector('button[type="submit"]');
const staffReportStatus = document.querySelector('#staff-report-status');
const staffReportMonth = document.querySelector('#staff-report-month');
const staffReportBody = document.querySelector('#staff-report-body');
let staffRoster = [];
let staffAttToken = 0;
let staffReportToken = 0;
const staffSelects = () => [...staffAttBody.querySelectorAll('select')];

function staffLabel(uid) {
  const names = classTeacherData.filter((record) => record.data().teacherUid === uid)
    .map((record) => examData.classes.find((item) => item.id === record.id)?.data().name ?? record.id);
  return 'Teacher account ' + uid + (names.length ? ' (class teacher of ' + names.join(', ') + ')' : '');
}

function updateStaffCounts() {
  const count = { present: 0, absent: 0, late: 0, leave: 0, '': 0 };
  for (const select of staffSelects()) count[select.value] += 1;
  staffAttCounts.textContent = staffSelects().length
    ? 'Present ' + count.present + ', absent ' + count.absent + ', late ' + count.late
      + ', leave ' + count.leave + ', not marked ' + count['']
    : '';
}

async function renderStaffSheet() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++staffAttToken;
  staffAttBody.replaceChildren();
  staffAttCounts.textContent = '';
  if (!tools) return;
  const date = staffAttDate.value;
  if (!DATE_TEXT.test(date) || date < '2020-01-01' || date > localToday()) {
    staffAttStatus.textContent = 'Choose a date up to today.';
    return;
  }
  if (!staffRoster.length) {
    staffAttStatus.textContent = 'No active teacher accounts yet.';
    return;
  }
  staffAttStatus.textContent = 'Loading staff attendance.';
  try {
    const [saved, leaves] = await Promise.all([tools.staffAttendanceOn(date), tools.list('leaveRequests')]);
    if (request !== schoolRequest || token !== staffAttToken) return;
    const marks = new Map(saved.docs.map((record) => [record.data().staffUid, record.data().status]));
    // Approved leave covering this date is pre-selected for anyone not marked yet. Save keeps it.
    let fromLeave = 0;
    for (const record of leaves.docs) {
      const item = record.data();
      if (item.status === 'approved' && item.fromDate <= date && date <= item.toDate && !marks.has(item.staffUid)) {
        marks.set(item.staffUid, 'leave');
        fromLeave += 1;
      }
    }
    for (const uid of staffRoster) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = staffLabel(uid);
      const cell = document.createElement('td');
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Attendance for ' + uid);
      for (const [value, label] of [['', 'Not marked'], ...Object.entries(STAFF_STATUS_LABEL)]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      select.value = marks.get(uid) ?? '';
      select.dataset.original = select.value;
      select.dataset.uid = uid;
      select.addEventListener('change', updateStaffCounts);
      cell.append(select);
      tr.append(name, cell);
      staffAttBody.append(tr);
    }
    updateStaffCounts();
    staffAttStatus.textContent = fromLeave
      ? fromLeave + ' teacher(s) have approved leave and are set to Leave. Press Save to keep it.'
      : '';
  } catch {
    if (request === schoolRequest && token === staffAttToken) staffAttStatus.textContent = 'Could not load staff attendance. Try again.';
  }
}

async function renderStaffReport() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++staffReportToken;
  staffReportBody.replaceChildren();
  if (!tools) return;
  const month = staffReportMonth.value;
  if (!/^[0-9]{4}-[0-9]{2}$/.test(month)) {
    staffReportStatus.textContent = 'Choose a month.';
    return;
  }
  staffReportStatus.textContent = 'Loading monthly report.';
  try {
    const saved = await tools.staffAttendanceBetween(month + '-01', month + '-31');
    if (request !== schoolRequest || token !== staffReportToken) return;
    const marks = saved.docs.map((record) => record.data());
    for (const uid of staffRoster) {
      const own = marks.filter((item) => item.staffUid === uid);
      const count = { present: 0, absent: 0, late: 0, leave: 0 };
      for (const item of own) count[item.status] += 1;
      const worked = count.present + count.late + count.absent;
      addRow(staffReportBody, [staffLabel(uid), String(count.present), String(count.absent), String(count.late),
        String(count.leave), String(own.length),
        worked ? Math.round((count.present + count.late) / worked * 1000) / 10 + '%' : '-']);
    }
    staffReportStatus.textContent = staffRoster.length ? '' : 'No active teacher accounts yet.';
  } catch {
    if (request === schoolRequest && token === staffReportToken) staffReportStatus.textContent = 'Could not load the monthly report. Try again.';
  }
}

async function loadStaffAttendance(request) {
  const tools = academic;
  try {
    const members = await tools.list('members');
    if (request !== schoolRequest) return;
    staffRoster = members.docs.filter((record) => record.data().role === 'teacher' && record.data().active === true)
      .map((record) => record.id).sort();
    staffAttSection.hidden = false;
    staffAttDate.value = localToday();
    staffReportMonth.value = localToday().slice(0, 7);
    renderStaffSheet();
    renderStaffReport();
  } catch {
    if (request === schoolRequest) {
      staffAttSection.hidden = false;
      staffAttStatus.textContent = 'Could not load staff attendance. Try again.';
    }
  }
}

staffAttDate.addEventListener('change', renderStaffSheet);
staffReportMonth.addEventListener('change', renderStaffReport);
staffAttAllPresent.addEventListener('click', () => {
  for (const select of staffSelects()) if (select.value === '') select.value = 'present';
  updateStaffCounts();
});

staffAttForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const date = staffAttDate.value;
  const writes = staffSelects().filter((select) => select.value !== '' && select.value !== select.dataset.original)
    .map((select) => ({ uid: select.dataset.uid, status: select.value }));
  if (!writes.length) {
    staffAttStatus.textContent = 'No new or changed attendance to save.';
    return;
  }
  const request = schoolRequest;
  tools.busy = true;
  staffAttSave.disabled = true;
  let done = 0;
  try {
    for (let start = 0; start < writes.length; start += ATTENDANCE_PER_GROUP) {
      staffAttStatus.textContent = 'Saving staff attendance ' + (start + 1) + ' of ' + writes.length + '.';
      const results = await Promise.allSettled(writes.slice(start, start + ATTENDANCE_PER_GROUP)
        .map(({ uid, status }) => tools.saveStaffAttendance(date, uid, status)));
      done += results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    if (request !== schoolRequest) return;
    tools.busy = false;
    staffAttSave.disabled = false;
    await renderStaffSheet();
    await renderStaffReport();
    if (request === schoolRequest) staffAttStatus.textContent = 'Staff attendance saved (' + done + ').';
  } catch (error) {
    if (request !== schoolRequest) return;
    staffAttStatus.textContent = (error.code === 'permission-denied'
      ? 'Some staff attendance could not be saved. Check the date and that each account is an active teacher.'
      : 'Could not save all staff attendance. Try again.') + (done ? ' ' + done + ' saved before the problem.' : '');
  } finally {
    if (request === schoolRequest) {
      tools.busy = false;
      staffAttSave.disabled = false;
    }
  }
});

// Teacher: my own attendance, by month.
const myAttSection = document.querySelector('#my-attendance');
const myAttStatus = document.querySelector('#my-attendance-status');
const myAttMonth = document.querySelector('#my-attendance-month');
const myAttTotal = document.querySelector('#my-attendance-total');
const myAttBody = document.querySelector('#my-attendance-body');
let myAttMarks = [];

function renderMyAttendance() {
  myAttBody.replaceChildren();
  myAttTotal.textContent = '';
  const month = myAttMonth.value;
  const marks = myAttMarks.filter((item) => item.date.startsWith(month + '-')).sort((a, b) => a.date.localeCompare(b.date));
  if (!marks.length) {
    myAttStatus.textContent = 'No attendance marked for this month.';
    return;
  }
  myAttStatus.textContent = '';
  const count = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const item of marks) {
    count[item.status] += 1;
    addRow(myAttBody, [item.date, STAFF_STATUS_LABEL[item.status]]);
  }
  myAttTotal.textContent = 'Present ' + count.present + ', absent ' + count.absent + ', late ' + count.late
    + ', leave ' + count.leave;
}

myAttMonth.addEventListener('change', renderMyAttendance);

async function loadMyAttendance(request, schoolRef, uid) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  myAttSection.hidden = false;
  myAttMonth.value = localToday().slice(0, 7);
  myAttStatus.textContent = 'Loading your attendance.';
  try {
    const saved = await getDocsFromServer(query(collection(schoolRef, 'staffAttendance'), where('staffUid', '==', uid)));
    if (request !== schoolRequest) return;
    myAttMarks = saved.docs.map((record) => record.data());
    renderMyAttendance();
  } catch {
    if (request === schoolRequest) myAttStatus.textContent = 'Could not load your attendance. Try again.';
  }
}

// Leave requests. Teachers ask for their own leave; the owner approves or rejects each once.
const LEAVE_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const leaveReviewSection = document.querySelector('#leave-review');
const leaveReviewStatus = document.querySelector('#leave-review-status');
const leaveReviewBody = document.querySelector('#leave-review-body');
const leaveRequestSection = document.querySelector('#leave-request');
const leaveRequestStatus = document.querySelector('#leave-request-status');
const leaveRequestForm = document.querySelector('#leave-request-form');
const leaveRequestBody = document.querySelector('#leave-request-body');
const leaveSend = leaveRequestForm.querySelector('button[type="submit"]');
let leaveReviewToken = 0;
let myLeave; // { schoolRef, uid, items: [{ id, data }], busy }

async function renderLeaveReview() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++leaveReviewToken;
  if (!tools) return;
  leaveReviewStatus.textContent = 'Loading leave requests.';
  try {
    const saved = await tools.list('leaveRequests');
    if (request !== schoolRequest || token !== leaveReviewToken) return;
    leaveReviewBody.replaceChildren();
    // Pending first, then the newest decisions.
    const items = saved.docs.map((record) => ({ id: record.id, data: record.data() }))
      .sort((a, b) => (a.data.status === 'pending' ? 0 : 1) - (b.data.status === 'pending' ? 0 : 1)
        || b.data.fromDate.localeCompare(a.data.fromDate));
    for (const item of items) {
      const { staffUid, fromDate, toDate, reason, status } = item.data;
      const tr = document.createElement('tr');
      for (const text of [staffLabel(staffUid), fromDate, toDate, reason, LEAVE_LABEL[status]]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      const decision = document.createElement('td');
      if (status === 'pending') {
        for (const next of ['approved', 'rejected']) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = next === 'approved' ? 'Approve' : 'Reject';
          button.addEventListener('click', async () => {
            if (tools.busy) return;
            tools.busy = true;
            leaveReviewStatus.textContent = 'Saving decision.';
            try {
              await tools.decideLeave(item.id, item.data, next);
              tools.busy = false;
              if (request === schoolRequest) await renderLeaveReview();
            } catch {
              if (request === schoolRequest) leaveReviewStatus.textContent = 'Could not save the decision. Try again.';
            } finally {
              tools.busy = false;
            }
          });
          decision.append(button);
        }
      } else {
        decision.textContent = '-';
      }
      tr.append(decision);
      leaveReviewBody.append(tr);
    }
    const pending = items.filter((item) => item.data.status === 'pending').length;
    leaveReviewStatus.textContent = items.length
      ? pending + ' pending of ' + items.length + ' leave requests.'
      : 'No leave requests yet.';
  } catch {
    if (request === schoolRequest && token === leaveReviewToken) leaveReviewStatus.textContent = 'Could not load leave requests. Try again.';
  }
}

function renderMyLeave() {
  leaveRequestBody.replaceChildren();
  if (!myLeave) return;
  const items = [...myLeave.items].sort((a, b) => b.data.fromDate.localeCompare(a.data.fromDate));
  for (const { data } of items) addRow(leaveRequestBody, [data.fromDate, data.toDate, data.reason, LEAVE_LABEL[data.status]]);
}

async function loadMyLeave(request, schoolRef, uid) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  leaveRequestSection.hidden = false;
  myLeave = { schoolRef, uid, items: [], busy: false };
  leaveRequestForm.elements.namedItem('fromDate').min = localToday();
  leaveRequestForm.elements.namedItem('toDate').min = localToday();
  leaveRequestStatus.textContent = 'Loading your leave requests.';
  try {
    const saved = await getDocsFromServer(query(collection(schoolRef, 'leaveRequests'), where('staffUid', '==', uid)));
    if (request !== schoolRequest) return;
    myLeave.items = saved.docs.map((record) => ({ id: record.id, data: record.data() }));
    renderMyLeave();
    leaveRequestStatus.textContent = '';
  } catch {
    if (request === schoolRequest) leaveRequestStatus.textContent = 'Could not load your leave requests. Try again.';
  }
}

leaveRequestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = myLeave;
  if (!context || context.busy) return;
  const fields = new FormData(leaveRequestForm);
  const fromDate = String(fields.get('fromDate') ?? '');
  const toDate = String(fields.get('toDate') ?? '');
  const reason = String(fields.get('reason') ?? '').trim();
  if (!DATE_TEXT.test(fromDate) || !DATE_TEXT.test(toDate) || toDate < fromDate) {
    leaveRequestStatus.textContent = 'Choose a start date, and an end date that is not before it.';
    return;
  }
  if (!reason) {
    leaveRequestStatus.textContent = 'Enter a reason for the leave.';
    return;
  }
  if (context.items.some((item) => item.id === context.uid + '_' + fromDate)) {
    leaveRequestStatus.textContent = 'You already sent a leave request starting on that date.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  leaveSend.disabled = true;
  leaveRequestStatus.textContent = 'Sending leave request.';
  try {
    const data = { staffUid: context.uid, fromDate, toDate, reason, status: 'pending' };
    await setDoc(doc(context.schoolRef, 'leaveRequests', context.uid + '_' + fromDate), data);
    if (request !== schoolRequest) return;
    context.items.push({ id: context.uid + '_' + fromDate, data });
    leaveRequestForm.reset();
    renderMyLeave();
    leaveRequestStatus.textContent = 'Leave request sent. The principal will approve or reject it.';
  } catch {
    if (request === schoolRequest) leaveRequestStatus.textContent = 'Could not send the leave request. Try again.';
  } finally {
    if (request === schoolRequest) {
      context.busy = false;
      leaveSend.disabled = false;
    }
  }
});

// Fees. The owner sets fee amounts per class for the active year and records payments. Payments
// are never edited or deleted; a mistake is voided once. Whole rupees only.
const rupees = (amount) => 'Rs ' + Number(amount).toLocaleString('en-IN');
const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', bank: 'Bank', cheque: 'Cheque' };
const feesSection = document.querySelector('#fees');
const feesStatus = document.querySelector('#fees-status');
const feeStructureList = document.querySelector('#fee-structure-list');
const feeStructureForm = document.querySelector('#fee-structure-form');
const paymentForm = document.querySelector('#payment-form');
const feeBalanceStudent = document.querySelector('#fee-balance-student');
const feeBalanceSummary = document.querySelector('#fee-balance-summary');
const feeBalanceBody = document.querySelector('#fee-balance-body');
let feeData = { structures: [], payments: [] };
let schoolUid = '';

const activeYearRecord = () => placementData.years.find((record) => record.data().status === 'active');
const feeKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/g, '');

function feeSummaryFor(studentId, yearId, classId) {
  const due = feeData.structures.filter((item) => item.data().yearId === yearId && item.data().classId === classId)
    .reduce((sum, item) => sum + item.data().amount, 0);
  const paid = feeData.payments.filter((item) => item.data().studentId === studentId && item.data().yearId === yearId
    && item.data().voided !== true).reduce((sum, item) => sum + item.data().amount, 0);
  return { due, paid, balance: due - paid };
}

function renderFees() {
  const year = activeYearRecord();
  const classes = [...examData.classes].sort(byClassOrder);
  const students = studentRecords.filter((record) => record.data().status === 'active')
    .sort((a, b) => a.data().name.localeCompare(b.data().name));
  fillSelect(feeStructureForm.elements.namedItem('classId'), classes, (item) => item.name);
  fillSelect(paymentForm.elements.namedItem('studentId'), students, (item) => item.name + ' (' + item.admissionNo + ')');
  fillSelect(feeBalanceStudent, students, (item) => item.name + ' (' + item.admissionNo + ')');
  if (!paymentForm.elements.namedItem('date').value) paymentForm.elements.namedItem('date').value = localToday();
  feeStructureList.replaceChildren();
  if (!year) {
    feesStatus.textContent = 'Activate an academic year to set fees.';
  } else {
    const className = (id) => classes.find((record) => record.id === id)?.data().name ?? id;
    const mine = feeData.structures.filter((item) => item.data().yearId === year.id)
      .sort((a, b) => className(a.data().classId).localeCompare(className(b.data().classId)) || a.id.localeCompare(b.id));
    for (const item of mine) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', () => runFeeAction(async () => {
        if (!confirm('Remove ' + item.data().name + ' for ' + className(item.data().classId) + '?')) return false;
        await academic.remove('feeStructures', item.id);
      }, 'Fee amount removed.'));
      listItem(feeStructureList, className(item.data().classId) + ' - ' + item.data().name + ': ' + rupees(item.data().amount), button);
    }
    if (!mine.length) feesStatus.textContent = 'No fee amounts set for ' + year.data().label + ' yet.';
  }
  renderFeeBalance();
}

function renderFeeBalance() {
  feeBalanceBody.replaceChildren();
  feeBalanceSummary.textContent = '';
  const year = activeYearRecord();
  const studentId = feeBalanceStudent.value;
  if (!year || !studentId) return;
  const placement = placementData.enrollments.find((record) => record.id === year.id + '_' + studentId);
  if (!placement) {
    feeBalanceSummary.textContent = 'This student is not placed in a class this year.';
    return;
  }
  const { due, paid, balance } = feeSummaryFor(studentId, year.id, placement.data().classId);
  feeBalanceSummary.textContent = 'Due ' + rupees(due) + ', paid ' + rupees(paid) + ', balance ' + rupees(balance);
  const mine = feeData.payments.filter((item) => item.data().studentId === studentId && item.data().yearId === year.id)
    .sort((a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id));
  for (const item of mine) {
    const payment = item.data();
    const tr = document.createElement('tr');
    for (const text of [payment.receiptNo, payment.date, METHOD_LABEL[payment.method], rupees(payment.amount),
      payment.voided === true ? 'Voided' : 'Paid']) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const action = document.createElement('td');
    if (payment.voided !== true) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Void';
      button.addEventListener('click', () => runFeeAction(async () => {
        if (!confirm('Void receipt ' + payment.receiptNo + ' for ' + rupees(payment.amount) + '? This cannot be undone.')) return false;
        await academic.save('payments', item.id, { ...payment, voided: true });
      }, 'Payment voided.'));
      action.append(button);
    } else {
      action.textContent = '-';
    }
    tr.append(action);
    feeBalanceBody.append(tr);
  }
}

async function loadFees(request) {
  const tools = academic;
  try {
    const [structures, payments] = await Promise.all([tools.list('feeStructures'), tools.list('payments')]);
    if (request !== schoolRequest) return;
    feeData = { structures: structures.docs, payments: payments.docs };
    feesSection.hidden = false;
    feesStatus.textContent = '';
    renderFees();
  } catch {
    if (request === schoolRequest) {
      feesSection.hidden = false;
      feesStatus.textContent = 'Could not load fees. Try again.';
    }
  }
}

async function runFeeAction(action, done) {
  const tools = academic;
  if (!tools || tools.busy) return;
  const request = schoolRequest;
  tools.busy = true;
  feesStatus.textContent = 'Saving.';
  try {
    if (await action() === false) {
      if (request === schoolRequest) feesStatus.textContent = '';
      return;
    }
    tools.busy = false;
    await loadFees(request);
    if (request === schoolRequest) feesStatus.textContent = done;
  } catch (error) {
    if (request === schoolRequest) feesStatus.textContent = error.code === 'permission-denied'
      ? 'This could not be saved. Check the details and that the academic year is set up.'
      : 'Could not save. Try again.';
  } finally {
    tools.busy = false;
  }
}

feeStructureForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const year = activeYearRecord();
  const fields = new FormData(feeStructureForm);
  const classId = String(fields.get('classId') ?? '');
  const name = String(fields.get('feeName') ?? '').trim();
  const amount = Number(fields.get('amount'));
  if (!year) {
    feesStatus.textContent = 'Activate an academic year first.';
    return;
  }
  if (!classId || !name || !feeKey(name)) {
    feesStatus.textContent = 'Choose a class and enter a fee name using letters or numbers.';
    return;
  }
  if (!Number.isInteger(amount) || amount < 0 || amount > 10000000) {
    feesStatus.textContent = 'Enter the amount in whole rupees.';
    return;
  }
  const head = feeKey(name);
  runFeeAction(async () => {
    await academic.save('feeStructures', year.id + '_' + classId + '_' + head, { yearId: year.id, classId, head, name, amount });
    feeStructureForm.elements.namedItem('feeName').value = '';
    feeStructureForm.elements.namedItem('amount').value = '';
  }, 'Fee amount saved.');
});

paymentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const year = activeYearRecord();
  const fields = new FormData(paymentForm);
  const studentId = String(fields.get('studentId') ?? '');
  const amount = Number(fields.get('amount'));
  const method = String(fields.get('method') ?? '');
  const date = String(fields.get('date') ?? '');
  if (!year) {
    feesStatus.textContent = 'Activate an academic year first.';
    return;
  }
  if (!studentId || !Number.isInteger(amount) || amount < 1 || amount > 10000000) {
    feesStatus.textContent = 'Choose a student and enter the amount in whole rupees.';
    return;
  }
  if (!DATE_TEXT.test(date) || date > localToday()) {
    feesStatus.textContent = 'Choose a payment date up to today.';
    return;
  }
  const receiptNo = 'R-' + date.replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  runFeeAction(async () => {
    await academic.save('payments', receiptNo, { studentId, yearId: year.id, amount, date, method, receiptNo, receivedBy: schoolUid });
    paymentForm.elements.namedItem('amount').value = '';
    feeBalanceStudent.value = studentId;
  }, 'Payment saved. Receipt ' + receiptNo + '.');
});

feeBalanceStudent.addEventListener('change', renderFeeBalance);

// Student and parent: fees and payments of the linked student only.
const portalFeesSection = document.querySelector('#portal-fees');
const portalFeesStatus = document.querySelector('#portal-fees-status');
const portalFeesSummary = document.querySelector('#portal-fees-summary');
const portalFeesBody = document.querySelector('#portal-fees-body');

async function loadPortalFees(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalFeesSection.hidden = false;
  portalFeesStatus.textContent = 'Loading fees.';
  try {
    const [placements, structures, payments] = await Promise.all([
      getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId))),
      getDocsFromServer(collection(schoolRef, 'feeStructures')),
      getDocsFromServer(query(collection(schoolRef, 'payments'), where('studentId', '==', studentId))),
    ]);
    if (request !== schoolRequest) return;
    portalFeesSummary.replaceChildren();
    portalFeesBody.replaceChildren();
    const paidList = payments.docs.map((record) => record.data());
    for (const placement of placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))) {
      const heads = structures.docs.map((record) => record.data())
        .filter((item) => item.yearId === placement.yearId && item.classId === placement.classId);
      const due = heads.reduce((sum, item) => sum + item.amount, 0);
      const paid = paidList.filter((item) => item.yearId === placement.yearId && item.voided !== true)
        .reduce((sum, item) => sum + item.amount, 0);
      listItem(portalFeesSummary, placement.yearId + ': due ' + rupees(due) + ', paid ' + rupees(paid)
        + ', balance ' + rupees(due - paid)
        + (heads.length ? ' (' + heads.map((item) => item.name + ' ' + rupees(item.amount)).join(', ') + ')' : ''));
    }
    for (const payment of paidList.sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo))) {
      addRow(portalFeesBody, [payment.receiptNo, payment.date, METHOD_LABEL[payment.method], rupees(payment.amount),
        payment.voided === true ? 'Voided' : 'Paid']);
    }
    portalFeesStatus.textContent = placements.empty && payments.empty ? 'No fee records yet.' : '';
  } catch {
    if (request === schoolRequest) portalFeesStatus.textContent = 'Could not load fees. Try again.';
  }
}

// Notice board. The owner posts notices for everyone, teachers, families or one class. Notices are
// never edited; the owner can remove one. Each reader asks only for the notices they may see.
const noticesSection = document.querySelector('#notices');
const noticesStatus = document.querySelector('#notices-status');
const noticeForm = document.querySelector('#notice-form');
const noticeList = document.querySelector('#notice-list');
const teacherNoticesSection = document.querySelector('#teacher-notices');
const teacherNoticesStatus = document.querySelector('#teacher-notices-status');
const teacherNoticesList = document.querySelector('#teacher-notices-list');
const portalNoticesSection = document.querySelector('#portal-notices');
const portalNoticesStatus = document.querySelector('#portal-notices-status');
const portalNoticesList = document.querySelector('#portal-notices-list');
let noticeData = [];
let noticeAssignedClass = '';

const newestFirst = (a, b) => b.data.createdAt.localeCompare(a.data.createdAt) || b.id.localeCompare(a.id);
const noticeText = (data) => data.createdAt + ' - ' + data.title + ': ' + data.body;

function renderNotices() {
  noticeList.replaceChildren();
  const classes = [...examData.classes].sort(byClassOrder);
  const className = (id) => classes.find((record) => record.id === id)?.data().name ?? id;
  fillSelect(noticeForm.elements.namedItem('classId'), classes, (item) => item.name);
  const audienceLabel = (data) => ({ all: 'Everyone', teachers: 'Teachers', families: 'Parents and students' })[data.audience]
    ?? className(data.classId);
  for (const item of [...noticeData].sort(newestFirst)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Remove';
    button.addEventListener('click', async () => {
      if (!academic || academic.busy || !confirm('Remove this notice? It will disappear for everyone.')) return;
      const request = schoolRequest;
      academic.busy = true;
      noticesStatus.textContent = 'Removing.';
      try {
        await academic.remove('notices', item.id);
        academic.busy = false;
        await loadNotices(request);
        if (request === schoolRequest) noticesStatus.textContent = 'Notice removed.';
      } catch {
        if (request === schoolRequest) noticesStatus.textContent = 'Could not remove the notice. Try again.';
      } finally {
        academic.busy = false;
      }
    });
    listItem(noticeList, '[' + audienceLabel(item.data) + '] ' + noticeText(item.data), button);
  }
  if (!noticeData.length) noticesStatus.textContent = 'No notices yet.';
}

async function loadNotices(request) {
  try {
    const saved = await academic.list('notices');
    if (request !== schoolRequest) return;
    noticeData = saved.docs.map((record) => ({ id: record.id, data: record.data() }));
    noticesSection.hidden = false;
    noticesStatus.textContent = '';
    renderNotices();
  } catch {
    if (request === schoolRequest) {
      noticesSection.hidden = false;
      noticesStatus.textContent = 'Could not load notices. Try again.';
    }
  }
}

noticeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const fields = new FormData(noticeForm);
  const title = String(fields.get('title') ?? '').trim();
  const body = String(fields.get('body') ?? '').trim();
  const audience = String(fields.get('audience') ?? '');
  const classId = String(fields.get('classId') ?? '');
  if (!title || !body) {
    noticesStatus.textContent = 'Enter a title and the notice text.';
    return;
  }
  if (audience === 'class' && !classId) {
    noticesStatus.textContent = 'Choose the class for this notice.';
    return;
  }
  const createdAt = localToday();
  const id = 'N-' + createdAt.replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const data = { title, body, audience, createdAt, createdBy: schoolUid, ...(audience === 'class' ? { classId } : {}) };
  const request = schoolRequest;
  tools.busy = true;
  noticesStatus.textContent = 'Posting.';
  try {
    await tools.save('notices', id, data);
    tools.busy = false;
    noticeForm.reset();
    await loadNotices(request);
    if (request === schoolRequest) noticesStatus.textContent = 'Notice posted.';
  } catch {
    if (request === schoolRequest) noticesStatus.textContent = 'Could not post the notice. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
});

// One query for each kind of notice the reader may see, then merged.
async function readNotices(schoolRef, audiences, classIds) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  const notices = collection(schoolRef, 'notices');
  const runs = [getDocsFromServer(query(notices, where('audience', 'in', audiences)))];
  for (const classId of classIds) {
    runs.push(getDocsFromServer(query(notices, where('audience', '==', 'class'), where('classId', '==', classId))));
  }
  const results = await Promise.all(runs);
  const seen = new Map();
  for (const result of results) for (const record of result.docs) seen.set(record.id, { id: record.id, data: record.data() });
  return [...seen.values()].sort(newestFirst);
}

function showNotices(list, items) {
  list.replaceChildren();
  for (const item of items) listItem(list, noticeText(item.data));
}

async function loadTeacherNotices(request, schoolRef, uid) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  teacherNoticesSection.hidden = false;
  teacherNoticesStatus.textContent = 'Loading notices.';
  try {
    const mine = await getDocsFromServer(query(collection(schoolRef, 'classTeachers'), where('teacherUid', '==', uid)));
    const classIds = new Set(mine.docs.map((record) => record.id));
    if (noticeAssignedClass) classIds.add(noticeAssignedClass);
    const items = await readNotices(schoolRef, ['all', 'teachers'], [...classIds]);
    if (request !== schoolRequest) return;
    showNotices(teacherNoticesList, items);
    teacherNoticesStatus.textContent = items.length ? '' : 'No notices yet.';
  } catch {
    if (request === schoolRequest) teacherNoticesStatus.textContent = 'Could not load notices. Try again.';
  }
}

async function loadPortalNotices(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalNoticesSection.hidden = false;
  portalNoticesStatus.textContent = 'Loading notices.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const items = await readNotices(schoolRef, ['all', 'families'], latest ? [latest.classId] : []);
    if (request !== schoolRequest) return;
    showNotices(portalNoticesList, items);
    portalNoticesStatus.textContent = items.length ? '' : 'No notices yet.';
  } catch {
    if (request === schoolRequest) portalNoticesStatus.textContent = 'Could not load notices. Try again.';
  }
}

// Activity log. Read-only list of the owner's recent changes, newest first.
const auditSection = document.querySelector('#audit-log');
const auditStatus = document.querySelector('#audit-log-status');
const auditList = document.querySelector('#audit-list');
const auditRefresh = document.querySelector('#audit-refresh');
const AUDIT_ACTION_LABEL = {
  save: 'saved', remove: 'removed', void: 'voided a payment', 'decide-leave': 'decided leave',
  'activate-year': 'activated year', 'close-year': 'closed year', bulk: 'changed',
  marks: 'teacher saved', attendance: 'teacher saved',
};
const AUDIT_SHOWN = 100;

async function loadAuditLog(request) {
  try {
    const saved = await academic.list('auditLog');
    if (request !== schoolRequest) return;
    const items = saved.docs.map((record) => record.data()).sort((a, b) => b.at.localeCompare(a.at));
    auditSection.hidden = false;
    auditList.replaceChildren();
    for (const item of items.slice(0, AUDIT_SHOWN)) {
      const when = new Date(item.at).toLocaleString();
      const what = (AUDIT_ACTION_LABEL[item.action] ?? item.action) + ' ' + item.target + ' ' + item.docId
        + (item.detail ? ' (' + item.detail + ')' : '');
      listItem(auditList, when + ' - ' + what);
    }
    auditStatus.textContent = items.length
      ? 'Showing the latest ' + Math.min(items.length, AUDIT_SHOWN) + ' of ' + items.length + ' entries.'
      : 'No activity yet.';
  } catch {
    if (request === schoolRequest) {
      auditSection.hidden = false;
      auditStatus.textContent = 'Could not load the activity log. Try again.';
    }
  }
}

auditRefresh.addEventListener('click', () => {
  if (academic) loadAuditLog(schoolRequest);
});

// Pass marks and grades. The owner sets the pass percentage and the lowest percentage for each grade.
const gradingSection = document.querySelector('#grading');
const gradingStatus = document.querySelector('#grading-status');
const gradingForm = document.querySelector('#grading-form');

function showGrading() {
  gradingSection.hidden = false;
  for (const key of GRADING_FIELDS) gradingForm.elements.namedItem(key).value = grading[key];
  gradingStatus.textContent = '';
}

gradingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const fields = new FormData(gradingForm);
  const next = Object.fromEntries(GRADING_FIELDS.map((key) => [key, Number(fields.get(key))]));
  const bands = ['minAPlus', 'minA', 'minB', 'minC', 'minD', 'minE'].map((key) => next[key]);
  if (!GRADING_FIELDS.every((key) => Number.isInteger(next[key]) && next[key] >= 1 && next[key] <= 100)) {
    gradingStatus.textContent = 'Use whole numbers from 1 to 100.';
    return;
  }
  if (bands.some((value, index) => index && value >= bands[index - 1])) {
    gradingStatus.textContent = 'Each grade must start lower than the grade above it (A+ highest, E lowest).';
    return;
  }
  const request = schoolRequest;
  tools.busy = true;
  gradingStatus.textContent = 'Saving.';
  try {
    await tools.save('settings', 'grading', next);
    grading = next;
    if (request === schoolRequest) gradingStatus.textContent = 'Saved. Open a result again to see the new grades.';
  } catch {
    if (request === schoolRequest) gradingStatus.textContent = 'Could not save the grading rules. Try again.';
  } finally {
    tools.busy = false;
  }
});

// Printing. The browser's print dialog can save a PDF. Only the report card is printed (see the
// print rules in sign-in.css); a heading with the school, student and date is filled in first.
function printCard(headingId, who) {
  const heading = document.querySelector(headingId);
  heading.textContent = (schoolName.textContent || 'School') + ' - ' + who + ' - ' + localToday();
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

document.querySelector('#report-print').addEventListener('click', () => {
  if (!reportBody.children.length) {
    reportStatus.textContent = 'There are no published results to print for this student.';
    return;
  }
  printCard('#report-print-head', 'Report Card - ' + (reportStudent.selectedOptions[0]?.textContent ?? ''));
});

document.querySelector('#portal-print').addEventListener('click', () => {
  if (!portalBody.children.length) {
    portalStatus.textContent = 'There are no published results to print yet.';
    return;
  }
  printCard('#portal-print-head', 'Report Card - ' + portalStudent.textContent);
});

// School summary, CSV exports and class performance. Everything here is read-only: it is worked out
// from records the owner can already read.
const summarySection = document.querySelector('#summary');
const summaryStatus = document.querySelector('#summary-status');
const summaryList = document.querySelector('#summary-list');
const performanceStatus = document.querySelector('#performance-status');
const performanceBody = document.querySelector('#performance-body');

const countBy = (docs, key) => {
  const counts = {};
  for (const record of docs) counts[record.data()[key]] = (counts[record.data()[key]] ?? 0) + 1;
  return counts;
};

async function renderSummary(request) {
  const tools = academic;
  summarySection.hidden = false;
  summaryStatus.textContent = 'Loading summary.';
  try {
    const today = localToday();
    const [attendance, staffToday, members, leave] = await Promise.all([
      tools.attendanceOn(today), tools.staffAttendanceOn(today), tools.list('members'), tools.list('leaveRequests')]);
    if (request !== schoolRequest) return;
    const activeYear = examData.years.find((record) => record.data().status === 'active');
    const students = studentRecords.map((record) => record.data());
    const placed = activeYear ? placementData.enrollments.filter((record) => record.data().yearId === activeYear.id).length : 0;
    const teachers = members.docs.filter((record) => record.data().role === 'teacher' && record.data().active === true).length;
    const att = countBy(attendance.docs, 'status');
    const staff = countBy(staffToday.docs, 'status');
    const pending = leave.docs.filter((record) => record.data().status === 'pending').length;
    const paid = feeData.payments.map((record) => record.data()).filter((payment) => payment.voided !== true);
    const sum = (items) => items.reduce((total, payment) => total + payment.amount, 0);
    summaryList.replaceChildren();
    for (const line of [
      'Students: ' + students.filter((item) => item.status === 'active').length + ' active of ' + students.length,
      'Placed in ' + (activeYear ? activeYear.data().label : 'no active year') + ': ' + placed,
      'Active teachers: ' + teachers,
      'Student attendance today (' + today + '): present ' + (att.present ?? 0) + ', absent ' + (att.absent ?? 0)
        + ', late ' + (att.late ?? 0),
      'Staff attendance today: present ' + (staff.present ?? 0) + ', absent ' + (staff.absent ?? 0)
        + ', late ' + (staff.late ?? 0) + ', on leave ' + (staff.leave ?? 0),
      'Leave requests waiting: ' + pending,
      'Fees collected this month: ' + rupees(sum(paid.filter((payment) => payment.date.startsWith(today.slice(0, 7))))),
      'Fees collected in total: ' + rupees(sum(paid)),
    ]) listItem(summaryList, line);
    summaryStatus.textContent = '';
  } catch {
    if (request === schoolRequest) summaryStatus.textContent = 'Could not load the summary. Try again.';
  }
}

document.querySelector('#summary-refresh').addEventListener('click', () => {
  if (academic) renderSummary(schoolRequest);
});

// CSV files open in Excel. A cell that starts with = or @ could run as a formula there, so it gets a
// leading apostrophe; phone numbers starting with + or - and a digit are left alone.
const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^(=|@|\t|\r|[+-](?![0-9( ]))/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

function downloadCsv(name, rows) {
  const blob = new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name + '-' + localToday() + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const nameOfClass = (id) => examData.classes.find((record) => record.id === id)?.data().name ?? id;
const nameOfStudent = (id) => studentRecords.find((record) => record.id === id)?.data().name ?? id;

document.querySelector('#export-students').addEventListener('click', () => {
  const activeYear = examData.years.find((record) => record.data().status === 'active');
  const placement = new Map(placementData.enrollments.filter((record) => activeYear && record.data().yearId === activeYear.id)
    .map((record) => [record.data().studentId, record.data()]));
  const sectionName = (id) => placementData.sections.find((record) => record.id === id)?.data().name ?? id;
  downloadCsv('students', [['Admission no', 'Name', 'Guardian', 'Guardian phone', 'Status', 'Class', 'Section', 'Roll no'],
    ...studentRecords.map((record) => {
      const s = record.data();
      const p = placement.get(record.id);
      return [s.admissionNo, s.name, s.guardianName, s.guardianPhone, s.status,
        p ? nameOfClass(p.classId) : '', p ? sectionName(p.sectionId) : '', p ? p.rollNo : ''];
    })]);
});

document.querySelector('#export-payments').addEventListener('click', () => {
  downloadCsv('payments', [['Receipt', 'Date', 'Student', 'Year', 'Method', 'Amount (Rs)', 'Status'],
    ...feeData.payments.map((record) => record.data()).sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [p.receiptNo, p.date, nameOfStudent(p.studentId), p.yearId, METHOD_LABEL[p.method] ?? p.method,
        p.amount, p.voided === true ? 'Voided' : 'Paid'])]);
});

document.querySelector('#export-log').addEventListener('click', async () => {
  if (!academic) return;
  const request = schoolRequest;
  try {
    const saved = await academic.list('auditLog');
    if (request !== schoolRequest) return;
    downloadCsv('activity-log', [['Time', 'Who (user id)', 'Action', 'Record type', 'Record', 'Detail'],
      ...saved.docs.map((record) => record.data()).sort((a, b) => a.at.localeCompare(b.at))
        .map((item) => [item.at, item.actor, item.action, item.target, item.docId, item.detail ?? ''])]);
  } catch {
    if (request === schoolRequest) summaryStatus.textContent = 'Could not download the activity log. Try again.';
  }
});

document.querySelector('#performance-load').addEventListener('click', async () => {
  const tools = academic;
  if (!tools) return;
  const request = schoolRequest;
  performanceStatus.textContent = 'Working out the results.';
  try {
    const exams = [...examData.exams].sort((a, b) => a.id.localeCompare(b.id));
    const results = await Promise.all(exams.map((exam) => tools.marksFor(exam.id)));
    if (request !== schoolRequest) return;
    performanceBody.replaceChildren();
    exams.forEach((record, index) => {
      const exam = record.data();
      const percents = results[index].docs.map((mark) => mark.data().score / exam.maxMarks * 100);
      if (!percents.length) return;
      const subject = examData.subjects.find((item) => item.id === exam.subjectId)?.data().name ?? exam.subjectId;
      const average = percents.reduce((total, value) => total + value, 0) / percents.length;
      const passed = percents.filter((value) => isPass(value)).length;
      const round = (value) => Math.round(value * 10) / 10 + '%';
      addRow(performanceBody, [exam.name + ' (' + exam.yearId + ')', nameOfClass(exam.classId), subject,
        String(percents.length), round(average), round(Math.max(...percents)), round(Math.min(...percents)),
        passed + ' of ' + percents.length + ' (' + Math.round(passed / percents.length * 100) + '%)']);
    });
    performanceStatus.textContent = performanceBody.children.length ? '' : 'No marks have been entered yet.';
  } catch {
    if (request === schoolRequest) performanceStatus.textContent = 'Could not load the results. Try again.';
  }
});

// Timetable. One record per class, day and period: classId_day_period. The owner manages it; teachers
// and linked families read it.
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const timetableSection = document.querySelector('#timetable');
const timetableStatus = document.querySelector('#timetable-status');
const timetableForm = document.querySelector('#timetable-form');
const timetableList = document.querySelector('#timetable-list');
let timetableData = [];

const slotText = (slot) => DAY_NAMES[slot.day] + ' period ' + slot.period + ' ' + slot.start + '-' + slot.end + ' ' + slot.subject
  + (slot.teacher ? ' (' + slot.teacher + ')' : '');
const slotOrder = (a, b) => a.day - b.day || a.period - b.period;

function renderTimetable() {
  fillSelect(timetableForm.elements.namedItem('classId'), [...examData.classes].sort(byClassOrder), (item) => item.name);
  fillSelect(timetableForm.elements.namedItem('subject'), examData.subjects, (item) => item.name);
  timetableList.replaceChildren();
  const classId = timetableForm.elements.namedItem('classId').value;
  for (const item of timetableData.filter((entry) => entry.data.classId === classId).sort((a, b) => slotOrder(a.data, b.data))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Remove';
    button.addEventListener('click', async () => {
      if (!academic || academic.busy || !confirm('Remove this lesson from the timetable?')) return;
      const request = schoolRequest;
      academic.busy = true;
      try {
        await academic.remove('timetable', item.id);
        academic.busy = false;
        await loadTimetable(request);
        if (request === schoolRequest) timetableStatus.textContent = 'Lesson removed.';
      } catch {
        if (request === schoolRequest) timetableStatus.textContent = 'Could not remove the lesson. Try again.';
      } finally {
        academic.busy = false;
      }
    });
    listItem(timetableList, slotText(item.data), button);
  }
  if (!timetableList.children.length) timetableStatus.textContent = 'No lessons for this class yet.';
}

async function loadTimetable(request) {
  try {
    const saved = await academic.list('timetable');
    if (request !== schoolRequest) return;
    timetableData = saved.docs.map((record) => ({ id: record.id, data: record.data() }));
    timetableSection.hidden = false;
    timetableStatus.textContent = '';
    renderTimetable();
  } catch {
    if (request === schoolRequest) {
      timetableSection.hidden = false;
      timetableStatus.textContent = 'Could not load the timetable. Try again.';
    }
  }
}

timetableForm.elements.namedItem('classId').addEventListener('change', () => {
  timetableStatus.textContent = '';
  renderTimetable();
});

timetableForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const fields = new FormData(timetableForm);
  const classId = String(fields.get('classId') ?? '');
  const day = Number(fields.get('day'));
  const period = Number(fields.get('period'));
  const subject = examData.subjects.find((item) => item.id === fields.get('subject'))?.data().name ?? '';
  const start = String(fields.get('start') ?? '');
  const end = String(fields.get('end') ?? '');
  const teacher = String(fields.get('teacher') ?? '').trim();
  if (!classId || !subject) {
    timetableStatus.textContent = 'Choose a class and a subject first.';
    return;
  }
  if (!Number.isInteger(period) || period < 1 || period > 12) {
    timetableStatus.textContent = 'Period number must be from 1 to 12.';
    return;
  }
  if (!start || !end || end <= start) {
    timetableStatus.textContent = 'The lesson must end after it starts.';
    return;
  }
  const data = { classId, className: nameOfClass(classId), day, period, subject, start, end, ...(teacher ? { teacher } : {}) };
  const request = schoolRequest;
  tools.busy = true;
  timetableStatus.textContent = 'Saving.';
  try {
    await tools.save('timetable', classId + '_' + day + '_' + period, data);
    tools.busy = false;
    await loadTimetable(request);
    if (request === schoolRequest) timetableStatus.textContent = 'Lesson saved. Saving the same day and period again replaces it.';
  } catch {
    if (request === schoolRequest) timetableStatus.textContent = 'Could not save the lesson. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
});

// Homework. The subject teacher of a class posts it; the class's teachers and linked families read
// it. Homework is never edited: the author or the owner removes it.
const ownerHomeworkSection = document.querySelector('#homework-owner');
const ownerHomeworkStatus = document.querySelector('#homework-owner-status');
const ownerHomeworkList = document.querySelector('#homework-owner-list');
const teacherHomeworkSection = document.querySelector('#teacher-homework');
const teacherHomeworkStatus = document.querySelector('#teacher-homework-status');
const teacherHomeworkList = document.querySelector('#teacher-homework-list');
const homeworkForm = document.querySelector('#homework-form');
const teacherTimetableSection = document.querySelector('#teacher-timetable');
const teacherTimetableStatus = document.querySelector('#teacher-timetable-status');
const teacherTimetableList = document.querySelector('#teacher-timetable-list');
const portalHomeworkSection = document.querySelector('#portal-homework');
const portalHomeworkStatus = document.querySelector('#portal-homework-status');
const portalHomeworkList = document.querySelector('#portal-homework-list');
const portalTimetableSection = document.querySelector('#portal-timetable');
const portalTimetableStatus = document.querySelector('#portal-timetable-status');
const portalTimetableList = document.querySelector('#portal-timetable-list');
let teacherHomework; // { schoolRef, uid, classId, subjectId, subject, busy }

const homeworkText = (item) => 'Due ' + item.dueDate + ' - ' + item.subject + ': ' + item.title + ' - ' + item.details;
const dueFirst = (a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);

async function loadOwnerHomework(request) {
  try {
    const saved = await academic.list('homework');
    if (request !== schoolRequest) return;
    ownerHomeworkSection.hidden = false;
    ownerHomeworkList.replaceChildren();
    for (const record of saved.docs.sort((a, b) => dueFirst(a.data(), b.data()))) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', async () => {
        if (!academic || academic.busy || !confirm('Remove this homework?')) return;
        academic.busy = true;
        try {
          await academic.remove('homework', record.id);
          academic.busy = false;
          await loadOwnerHomework(request);
        } catch {
          if (request === schoolRequest) ownerHomeworkStatus.textContent = 'Could not remove the homework. Try again.';
        } finally {
          academic.busy = false;
        }
      });
      listItem(ownerHomeworkList, nameOfClass(record.data().classId) + ' - ' + homeworkText(record.data()), button);
    }
    ownerHomeworkStatus.textContent = saved.docs.length ? '' : 'No homework has been posted yet.';
  } catch {
    if (request === schoolRequest) {
      ownerHomeworkSection.hidden = false;
      ownerHomeworkStatus.textContent = 'Could not load homework. Try again.';
    }
  }
}

async function loadTeacherHomework(request) {
  const context = teacherHomework;
  if (!context) return;
  const { collection, query, where, getDocsFromServer, doc } = firestoreTools;
  teacherHomeworkSection.hidden = false;
  teacherHomeworkStatus.textContent = 'Loading homework.';
  try {
    const saved = await getDocsFromServer(query(collection(context.schoolRef, 'homework'), where('classId', '==', context.classId)));
    if (request !== schoolRequest || context !== teacherHomework) return;
    teacherHomeworkList.replaceChildren();
    for (const record of saved.docs.sort((a, b) => dueFirst(a.data(), b.data()))) {
      let button;
      if (record.data().createdBy === context.uid) {
        button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Remove';
        button.addEventListener('click', async () => {
          if (context.busy || !confirm('Remove this homework? Students will no longer see it.')) return;
          context.busy = true;
          try {
            await firestoreTools.deleteDoc(doc(context.schoolRef, 'homework', record.id));
          } catch {
            teacherHomeworkStatus.textContent = 'Could not remove the homework. Try again.';
          } finally {
            context.busy = false;
          }
          await loadTeacherHomework(request);
        });
      }
      listItem(teacherHomeworkList, homeworkText(record.data()), button);
    }
    if (!saved.docs.length) teacherHomeworkStatus.textContent = 'No homework posted yet.';
    else teacherHomeworkStatus.textContent = '';
  } catch {
    if (request === schoolRequest) teacherHomeworkStatus.textContent = 'Could not load homework. Try again.';
  }
}

homeworkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherHomework;
  if (!context || context.busy) return;
  const fields = new FormData(homeworkForm);
  const title = String(fields.get('title') ?? '').trim();
  const details = String(fields.get('details') ?? '').trim();
  const dueDate = String(fields.get('dueDate') ?? '');
  const createdAt = localToday();
  if (!title || !details || !DATE_TEXT.test(dueDate)) {
    teacherHomeworkStatus.textContent = 'Enter a title, the details and a due date.';
    return;
  }
  if (dueDate < createdAt) {
    teacherHomeworkStatus.textContent = 'The due date cannot be in the past.';
    return;
  }
  const id = 'W-' + createdAt.replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  teacherHomeworkStatus.textContent = 'Posting.';
  try {
    await setDoc(doc(context.schoolRef, 'homework', id), {
      classId: context.classId, subjectId: context.subjectId, subject: context.subject,
      title, details, dueDate, createdAt, createdBy: context.uid,
    });
    context.busy = false;
    homeworkForm.reset();
    await loadTeacherHomework(request);
    if (request === schoolRequest) teacherHomeworkStatus.textContent = 'Homework posted.';
  } catch {
    if (request === schoolRequest) teacherHomeworkStatus.textContent = 'Could not post the homework. Check the details and try again.';
  } finally {
    context.busy = false;
  }
});

async function readBySlot(schoolRef, name, classIds) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  const results = await Promise.all(classIds.map((classId) =>
    getDocsFromServer(query(collection(schoolRef, name), where('classId', '==', classId)))));
  return results.flatMap((result) => result.docs.map((record) => record.data()));
}

async function loadTeacherTimetable(request, schoolRef, uid) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  teacherTimetableSection.hidden = false;
  teacherTimetableStatus.textContent = 'Loading timetable.';
  try {
    const mine = await getDocsFromServer(query(collection(schoolRef, 'classTeachers'), where('teacherUid', '==', uid)));
    const classIds = new Set(mine.docs.map((record) => record.id));
    if (noticeAssignedClass) classIds.add(noticeAssignedClass);
    const slots = (await readBySlot(schoolRef, 'timetable', [...classIds]))
      .sort((a, b) => a.className.localeCompare(b.className) || slotOrder(a, b));
    if (request !== schoolRequest) return;
    teacherTimetableList.replaceChildren();
    for (const slot of slots) listItem(teacherTimetableList, slot.className + ' - ' + slotText(slot));
    teacherTimetableStatus.textContent = slots.length ? '' : 'No timetable has been set for your classes yet.';
  } catch {
    if (request === schoolRequest) teacherTimetableStatus.textContent = 'Could not load the timetable. Try again.';
  }
}

async function loadPortalSchoolwork(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalHomeworkSection.hidden = false;
  portalTimetableSection.hidden = false;
  portalHomeworkStatus.textContent = 'Loading homework.';
  portalTimetableStatus.textContent = 'Loading timetable.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const classIds = latest ? [latest.classId] : [];
    const [work, slots] = await Promise.all([readBySlot(schoolRef, 'homework', classIds), readBySlot(schoolRef, 'timetable', classIds)]);
    if (request !== schoolRequest) return;
    portalHomeworkList.replaceChildren();
    for (const item of work.sort(dueFirst)) listItem(portalHomeworkList, homeworkText(item));
    portalHomeworkStatus.textContent = work.length ? '' : 'No homework yet.';
    portalTimetableList.replaceChildren();
    for (const slot of slots.sort(slotOrder)) listItem(portalTimetableList, slotText(slot));
    portalTimetableStatus.textContent = slots.length ? '' : 'No timetable has been set yet.';
  } catch {
    if (request === schoolRequest) {
      portalHomeworkStatus.textContent = 'Could not load homework. Try again.';
      portalTimetableStatus.textContent = 'Could not load the timetable. Try again.';
    }
  }
}

// School calendar. The owner adds holidays, exams, events and meetings; teachers and linked families
// see what is coming up.
const KIND_LABEL = { holiday: 'Holiday', exam: 'Exam', event: 'Event', meeting: 'Meeting' };
const calendarSection = document.querySelector('#calendar');
const calendarStatus = document.querySelector('#calendar-status');
const calendarForm = document.querySelector('#calendar-form');
const calendarList = document.querySelector('#calendar-list');
const teacherCalendarSection = document.querySelector('#teacher-calendar');
const teacherCalendarStatus = document.querySelector('#teacher-calendar-status');
const teacherCalendarList = document.querySelector('#teacher-calendar-list');
const portalCalendarSection = document.querySelector('#portal-calendar');
const portalCalendarStatus = document.querySelector('#portal-calendar-status');
const portalCalendarList = document.querySelector('#portal-calendar-list');

const eventText = (item) => item.date + ' - ' + (KIND_LABEL[item.kind] ?? item.kind) + ': ' + item.title
  + (item.note ? ' (' + item.note + ')' : '');
const byDate = (a, b) => a.data.date.localeCompare(b.data.date) || a.id.localeCompare(b.id);

async function loadCalendar(request) {
  try {
    const saved = await academic.list('calendar');
    if (request !== schoolRequest) return;
    calendarSection.hidden = false;
    calendarList.replaceChildren();
    const today = localToday();
    const items = saved.docs.map((record) => ({ id: record.id, data: record.data() })).sort(byDate);
    for (const item of [...items.filter((entry) => entry.data.date >= today), ...items.filter((entry) => entry.data.date < today).reverse()]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', async () => {
        if (!academic || academic.busy || !confirm('Remove this event from the calendar?')) return;
        academic.busy = true;
        try {
          await academic.remove('calendar', item.id);
          academic.busy = false;
          await loadCalendar(request);
        } catch {
          if (request === schoolRequest) calendarStatus.textContent = 'Could not remove the event. Try again.';
        } finally {
          academic.busy = false;
        }
      });
      listItem(calendarList, (item.data.date < today ? '(past) ' : '') + eventText(item.data), button);
    }
    calendarStatus.textContent = items.length ? '' : 'No events yet.';
  } catch {
    if (request === schoolRequest) {
      calendarSection.hidden = false;
      calendarStatus.textContent = 'Could not load the calendar. Try again.';
    }
  }
}

calendarForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const fields = new FormData(calendarForm);
  const title = String(fields.get('title') ?? '').trim();
  const date = String(fields.get('date') ?? '');
  const kind = String(fields.get('kind') ?? '');
  const note = String(fields.get('note') ?? '').trim();
  if (!title || !DATE_TEXT.test(date)) {
    calendarStatus.textContent = 'Enter a title and a date.';
    return;
  }
  const id = 'C-' + date.replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const request = schoolRequest;
  tools.busy = true;
  calendarStatus.textContent = 'Saving.';
  try {
    await tools.save('calendar', id, { title, date, kind, ...(note ? { note } : {}) });
    tools.busy = false;
    calendarForm.reset();
    await loadCalendar(request);
    if (request === schoolRequest) calendarStatus.textContent = 'Event added.';
  } catch {
    if (request === schoolRequest) calendarStatus.textContent = 'Could not save the event. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
});

async function loadUpcomingEvents(schoolRef, section, status, list) {
  const { collection, getDocsFromServer } = firestoreTools;
  const request = schoolRequest;
  section.hidden = false;
  status.textContent = 'Loading calendar.';
  try {
    const saved = await getDocsFromServer(collection(schoolRef, 'calendar'));
    if (request !== schoolRequest) return;
    const today = localToday();
    const items = saved.docs.map((record) => ({ id: record.id, data: record.data() }))
      .filter((entry) => entry.data.date >= today).sort(byDate);
    list.replaceChildren();
    for (const item of items) listItem(list, eventText(item.data));
    status.textContent = items.length ? '' : 'Nothing coming up on the calendar.';
  } catch {
    if (request === schoolRequest) status.textContent = 'Could not load the calendar. Try again.';
  }
}

// ID cards and admit cards. The card is built on screen and printed with the browser's print dialog
// (which can also save a PDF). An admit card lists the exams of the student's class in the placement year.
const cardsSection = document.querySelector('#cards');
const cardsStatus = document.querySelector('#cards-status');
const cardsStudent = document.querySelector('#cards-student');
const cardSheet = document.querySelector('#card-sheet');
const cardTitle = document.querySelector('#card-title');
const cardLines = document.querySelector('#card-lines');
const cardTable = document.querySelector('#card-table');
const cardBody = document.querySelector('#card-body');

function renderCardStudents() {
  fillSelect(cardsStudent, [...studentRecords].sort((a, b) => a.data().name.localeCompare(b.data().name)),
    (student) => student.name + ' (' + student.admissionNo + ')');
  cardsSection.hidden = false;
}

function buildCard(kind) {
  const record = studentRecords.find((item) => item.id === cardsStudent.value);
  if (!record) {
    cardsStatus.textContent = 'Choose a student first.';
    return false;
  }
  const student = record.data();
  const activeYear = examData.years.find((item) => item.data().status === 'active');
  const placement = placementData.enrollments.map((item) => item.data())
    .find((item) => item.studentId === record.id && activeYear && item.yearId === activeYear.id);
  if (!placement) {
    cardsStatus.textContent = 'This student is not placed in a class for the active year yet.';
    return false;
  }
  const sectionName = placementData.sections.find((item) => item.id === placement.sectionId)?.data().name ?? placement.sectionId;
  cardTitle.textContent = (kind === 'admit' ? 'Admit Card' : 'Student ID Card') + ' - ' + activeYear.data().label;
  cardLines.replaceChildren();
  const lines = ['Name: ' + student.name, 'Admission no: ' + student.admissionNo,
    'Class: ' + nameOfClass(placement.classId) + ' - ' + sectionName + ', roll ' + placement.rollNo];
  if (kind === 'id') lines.push('Guardian: ' + student.guardianName, 'Phone: ' + (student.guardianPhone || '-'));
  for (const line of lines) listItem(cardLines, line);
  cardBody.replaceChildren();
  cardTable.hidden = kind !== 'admit';
  if (kind === 'admit') {
    const exams = examData.exams.filter((item) => item.data().classId === placement.classId && item.data().yearId === activeYear.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const exam of exams) {
      const data = exam.data();
      addRow(cardBody, [data.name, examData.subjects.find((item) => item.id === data.subjectId)?.data().name ?? data.subjectId,
        String(data.maxMarks)]);
    }
    if (!exams.length) {
      cardsStatus.textContent = 'There are no exams set up for this class yet.';
      return false;
    }
  }
  cardSheet.hidden = false;
  cardsStatus.textContent = '';
  return true;
}

function printStudentCard(kind) {
  if (!buildCard(kind)) return;
  printCard('#card-print-head', cardTitle.textContent + ' - ' + (cardsStudent.selectedOptions[0]?.textContent ?? ''));
}

document.querySelector('#card-id-print').addEventListener('click', () => printStudentCard('id'));
document.querySelector('#card-admit-print').addEventListener('click', () => printStudentCard('admit'));

// Class attendance report. One query per day of the month, filtered to the class on the screen.
const attrepSection = document.querySelector('#attendance-report');
const attrepStatus = document.querySelector('#attrep-status');
const attrepClass = document.querySelector('#attrep-class');
const attrepMonth = document.querySelector('#attrep-month');
const attrepBody = document.querySelector('#attrep-body');
let attrepRows = [];

function renderAttrepClasses() {
  fillSelect(attrepClass, [...examData.classes].sort(byClassOrder), (item) => item.name);
  if (!attrepMonth.value) attrepMonth.value = localToday().slice(0, 7);
  attrepSection.hidden = false;
}

document.querySelector('#attrep-load').addEventListener('click', async () => {
  const tools = academic;
  if (!tools || !attrepClass.value || !/^[0-9]{4}-[0-9]{2}$/.test(attrepMonth.value)) {
    attrepStatus.textContent = 'Choose a class and a month.';
    return;
  }
  const request = schoolRequest;
  const classId = attrepClass.value;
  const [year, month] = attrepMonth.value.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const dates = Array.from({ length: days }, (_, index) => attrepMonth.value + '-' + pad(index + 1));
  attrepStatus.textContent = 'Working out the report.';
  try {
    const results = await Promise.all(dates.map((date) => tools.attendanceOn(date)));
    if (request !== schoolRequest) return;
    const perStudent = new Map();
    for (const result of results) {
      for (const record of result.docs) {
        const mark = record.data();
        if (mark.classId !== classId) continue;
        const count = perStudent.get(mark.studentId) ?? { present: 0, absent: 0, late: 0 };
        count[mark.status] += 1;
        perStudent.set(mark.studentId, count);
      }
    }
    attrepRows = [...perStudent.entries()].map(([studentId, count]) => {
      const marked = count.present + count.absent + count.late;
      return [nameOfStudent(studentId), count.present, count.absent, count.late, marked,
        Math.round((count.present + count.late) / marked * 1000) / 10 + '%'];
    }).sort((a, b) => a[0].localeCompare(b[0]));
    attrepBody.replaceChildren();
    for (const row of attrepRows) addRow(attrepBody, row.map(String));
    attrepStatus.textContent = attrepRows.length ? 'Attendance % counts present and late days out of days marked.'
      : 'No attendance has been marked for this class in this month.';
  } catch {
    if (request === schoolRequest) attrepStatus.textContent = 'Could not load the report. Try again.';
  }
});

document.querySelector('#attrep-csv').addEventListener('click', () => {
  if (!attrepRows.length) {
    attrepStatus.textContent = 'Show a report first.';
    return;
  }
  downloadCsv('attendance-' + attrepMonth.value, [['Student', 'Present', 'Absent', 'Late', 'Days marked', 'Attendance'], ...attrepRows]);
});

// Bulk student import. Rows are pasted from a spreadsheet or read from a CSV file, checked with the same
// rules as the student form, and only the good rows are saved (in batches, as one activity-log entry each).
const importSection = document.querySelector('#bulk-import');
const importStatus = document.querySelector('#import-status');
const importText = document.querySelector('#import-text');
const importBody = document.querySelector('#import-body');
const importRun = document.querySelector('#import-run');
const IMPORT_MAX_ROWS = 500;
const IMPORT_BATCH = 100;
let importReady = [];

function parseDelimited(text) {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

document.querySelector('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 1000000) {
    importStatus.textContent = 'That file is too large. Import up to ' + IMPORT_MAX_ROWS + ' students at a time.';
    return;
  }
  importText.value = await file.text();
  importStatus.textContent = 'File loaded. Click Check rows.';
});

document.querySelector('#import-check').addEventListener('click', () => {
  importBody.replaceChildren();
  importReady = [];
  importRun.disabled = true;
  let rows = parseDelimited(importText.value);
  if (rows.length && /admission/i.test(rows[0][0] ?? '')) rows = rows.slice(1);
  if (!rows.length) {
    importStatus.textContent = 'Paste some rows first.';
    return;
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    importStatus.textContent = 'Too many rows. Import up to ' + IMPORT_MAX_ROWS + ' students at a time.';
    return;
  }
  const seen = new Set();
  const existing = new Set(studentRecords.map((record) => record.id));
  let bad = 0;
  let skipped = 0;
  rows.forEach((cells, index) => {
    const [admissionNo = '', name = '', guardianName = '', guardianPhone = ''] = cells.map((value) => value.trim());
    const id = admissionNo.toLowerCase();
    let problem = '';
    if (!/^[A-Za-z0-9-]{1,20}$/.test(admissionNo)) problem = 'Admission number: letters, numbers and hyphens only (up to 20).';
    else if (!name || name.length > 120) problem = 'Student name is missing or too long.';
    else if (!guardianName || guardianName.length > 120) problem = 'Guardian name is missing or too long.';
    else if (!/^[0-9+() -]{0,20}$/.test(guardianPhone)) problem = 'Phone: digits, +, spaces, hyphens and brackets only.';
    else if (seen.has(id)) problem = 'Repeated admission number in this list.';
    let result = 'OK - will be added';
    if (problem) { result = 'Problem: ' + problem; bad += 1; }
    else if (existing.has(id)) { result = 'Skipped - this admission number already exists.'; skipped += 1; }
    else importReady.push({ path: ['students', id], data: { admissionNo, name, guardianName, guardianPhone, status: 'active' } });
    seen.add(id);
    addRow(importBody, [String(index + 1), admissionNo, name, result]);
  });
  importRun.disabled = !importReady.length;
  importStatus.textContent = importReady.length + ' ready to import, ' + skipped + ' skipped, ' + bad + ' with problems.'
    + (bad ? ' Rows with problems are left out; fix them and check again.' : '');
});

importRun.addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy || !importReady.length) return;
  const request = schoolRequest;
  const ops = importReady;
  tools.busy = true;
  importRun.disabled = true;
  let done = 0;
  try {
    for (let start = 0; start < ops.length; start += IMPORT_BATCH) {
      importStatus.textContent = 'Importing ' + (start + 1) + ' of ' + ops.length + '.';
      await tools.commit(ops.slice(start, start + IMPORT_BATCH));
      done = Math.min(start + IMPORT_BATCH, ops.length);
    }
    tools.busy = false;
    importReady = [];
    importText.value = '';
    importBody.replaceChildren();
    await loadAcademic(request);
    if (request === schoolRequest) importStatus.textContent = 'Imported ' + done + ' student' + (done === 1 ? '' : 's') + '.';
  } catch {
    tools.busy = false;
    if (request === schoolRequest) {
      importStatus.textContent = 'Imported ' + done + ' of ' + ops.length + ' before an error. Check the list and run Check rows again.';
    }
  } finally {
    tools.busy = false;
  }
});

// Office records (owner only): library, visitor log and behaviour notes.
const addDays = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  return next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate());
};
const nowTime = () => {
  const now = new Date();
  return pad(now.getHours()) + ':' + pad(now.getMinutes());
};
const newId = (prefix) => prefix + '-' + localToday().replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

const librarySection = document.querySelector('#library');
const libraryStatus = document.querySelector('#library-status');
const bookForm = document.querySelector('#book-form');
const loanForm = document.querySelector('#loan-form');
const bookList = document.querySelector('#book-list');
const loanList = document.querySelector('#loan-list');
let libBooks = [];
let libLoans = [];

function renderLibrary() {
  const open = libLoans.filter((record) => !record.data().returnedOn);
  const out = (bookId) => open.filter((record) => record.data().bookId === bookId).length;
  const today = localToday();
  fillSelect(loanForm.elements.namedItem('bookId'), [...libBooks].sort((a, b) => a.data().title.localeCompare(b.data().title)),
    (book) => book.title);
  bookList.replaceChildren();
  for (const record of [...libBooks].sort((a, b) => a.data().title.localeCompare(b.data().title))) {
    const book = record.data();
    const available = book.copies - out(record.id);
    let button;
    if (!libLoans.some((loan) => loan.data().bookId === record.id)) {
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', () => runLibraryAction(() => academic.remove('books', record.id), 'Book removed.',
        'Remove "' + book.title + '" from the library?'));
    }
    listItem(bookList, book.title + (book.author ? ' - ' + book.author : '') + ' - ' + available + ' of ' + book.copies + ' available', button);
  }
  loanList.replaceChildren();
  for (const record of open.sort((a, b) => a.data().dueOn.localeCompare(b.data().dueOn))) {
    const loan = record.data();
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mark returned';
    button.addEventListener('click', () => runLibraryAction(() => academic.save('loans', record.id, { ...loan, returnedOn: localToday() }),
      'Book returned.'));
    const title = libBooks.find((book) => book.id === loan.bookId)?.data().title ?? loan.bookId;
    listItem(loanList, title + ' - ' + nameOfStudent(loan.studentId) + ' - due ' + loan.dueOn
      + (loan.dueOn < today ? ' (OVERDUE)' : ''), button);
  }
  if (!libBooks.length) libraryStatus.textContent = 'No books yet. Add the first one above.';
}

async function loadLibrary(request) {
  try {
    const [books, loans] = await Promise.all([academic.list('books'), academic.list('loans')]);
    if (request !== schoolRequest) return;
    libBooks = books.docs;
    libLoans = loans.docs;
    librarySection.hidden = false;
    libraryStatus.textContent = '';
    renderLibrary();
  } catch {
    if (request === schoolRequest) {
      librarySection.hidden = false;
      libraryStatus.textContent = 'Could not load the library. Try again.';
    }
  }
}

async function runLibraryAction(action, message, question) {
  const tools = academic;
  if (!tools || tools.busy || (question && !confirm(question))) return;
  const request = schoolRequest;
  tools.busy = true;
  try {
    await action();
    tools.busy = false;
    await loadLibrary(request);
    if (request === schoolRequest) libraryStatus.textContent = message;
  } catch {
    if (request === schoolRequest) libraryStatus.textContent = 'That did not work. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
}

bookForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = new FormData(bookForm);
  const title = String(fields.get('title') ?? '').trim();
  const author = String(fields.get('author') ?? '').trim();
  const copies = Number(fields.get('copies'));
  if (!title || !Number.isInteger(copies) || copies < 1 || copies > 1000) {
    libraryStatus.textContent = 'Enter a title and a number of copies from 1 to 1000.';
    return;
  }
  runLibraryAction(async () => {
    await academic.save('books', 'bk-' + Math.random().toString(36).slice(2, 10), { title, author, copies });
    bookForm.reset();
  }, 'Book added.');
});

loanForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = new FormData(loanForm);
  const bookId = String(fields.get('bookId') ?? '');
  const studentId = String(fields.get('studentId') ?? '');
  const days = Number(fields.get('days'));
  const book = libBooks.find((record) => record.id === bookId);
  if (!book || !studentId || !Number.isInteger(days) || days < 1 || days > 90) {
    libraryStatus.textContent = 'Choose a book, a student and the number of days (1 to 90).';
    return;
  }
  const out = libLoans.filter((record) => record.data().bookId === bookId && !record.data().returnedOn).length;
  if (out >= book.data().copies) {
    libraryStatus.textContent = 'All copies of this book are out.';
    return;
  }
  const issuedOn = localToday();
  runLibraryAction(() => academic.save('loans', newId('LN'), { bookId, studentId, issuedOn, dueOn: addDays(issuedOn, days), issuedBy: schoolUid }),
    'Book issued. Due ' + addDays(issuedOn, days) + '.');
});

const visitorsSection = document.querySelector('#visitors');
const visitorsStatus = document.querySelector('#visitors-status');
const visitorForm = document.querySelector('#visitor-form');
const visitorList = document.querySelector('#visitor-list');
let visitorData = [];

function renderVisitors() {
  visitorList.replaceChildren();
  const today = localToday();
  const shown = visitorData.filter((record) => record.data().date === today || !record.data().timeOut)
    .sort((a, b) => (b.data().date + b.data().timeIn).localeCompare(a.data().date + a.data().timeIn));
  for (const record of shown) {
    const visit = record.data();
    let button;
    if (!visit.timeOut) {
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Sign out';
      button.addEventListener('click', () => runVisitorAction(() => academic.save('visitors', record.id, { ...visit, timeOut: nowTime() }),
        'Visitor signed out.'));
    }
    listItem(visitorList, (visit.date === today ? '' : visit.date + ' ') + visit.timeIn + ' - ' + visit.name + ' - ' + visit.purpose
      + (visit.whom ? ' (to see ' + visit.whom + ')' : '') + (visit.timeOut ? ' - left ' + visit.timeOut : ' - still inside'), button);
  }
  if (!shown.length) visitorsStatus.textContent = 'No visitors today.';
}

async function loadVisitors(request) {
  try {
    const saved = await academic.list('visitors');
    if (request !== schoolRequest) return;
    visitorData = saved.docs;
    visitorsSection.hidden = false;
    visitorsStatus.textContent = '';
    renderVisitors();
  } catch {
    if (request === schoolRequest) {
      visitorsSection.hidden = false;
      visitorsStatus.textContent = 'Could not load the visitor log. Try again.';
    }
  }
}

async function runVisitorAction(action, message) {
  const tools = academic;
  if (!tools || tools.busy) return;
  const request = schoolRequest;
  tools.busy = true;
  try {
    await action();
    tools.busy = false;
    await loadVisitors(request);
    if (request === schoolRequest) visitorsStatus.textContent = message;
  } catch {
    if (request === schoolRequest) visitorsStatus.textContent = 'That did not work. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
}

visitorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = new FormData(visitorForm);
  const text = (key) => String(fields.get(key) ?? '').trim();
  if (!text('name') || !text('purpose')) {
    visitorsStatus.textContent = 'Enter the visitor name and the purpose.';
    return;
  }
  if (!/^[0-9+() -]{0,20}$/.test(text('phone'))) {
    visitorsStatus.textContent = 'Phone may use digits, +, spaces, hyphens and brackets only.';
    return;
  }
  const data = { name: text('name'), purpose: text('purpose'), date: localToday(), timeIn: nowTime(), recordedBy: schoolUid,
    ...(text('whom') ? { whom: text('whom') } : {}), ...(text('phone') ? { phone: text('phone') } : {}) };
  runVisitorAction(async () => {
    await academic.save('visitors', newId('V'), data);
    visitorForm.reset();
  }, 'Visitor signed in.');
});

document.querySelector('#visitors-csv').addEventListener('click', () => {
  downloadCsv('visitors', [['Date', 'Time in', 'Time out', 'Name', 'Purpose', 'To meet', 'Phone'],
    ...visitorData.map((record) => record.data()).sort((a, b) => (a.date + a.timeIn).localeCompare(b.date + b.timeIn))
      .map((v) => [v.date, v.timeIn, v.timeOut ?? '', v.name, v.purpose, v.whom ?? '', v.phone ?? ''])]);
});

const behaviourSection = document.querySelector('#behaviour');
const behaviourStatus = document.querySelector('#behaviour-status');
const behaviourForm = document.querySelector('#behaviour-form');
const behaviourList = document.querySelector('#behaviour-list');
const BEHAVIOUR_SHOWN = 50;
let behaviourData = [];

function renderOfficeStudents() {
  const sorted = [...studentRecords].sort((a, b) => a.data().name.localeCompare(b.data().name));
  fillSelect(behaviourForm.elements.namedItem('studentId'), sorted, (item) => item.name + ' (' + item.admissionNo + ')');
  fillSelect(loanForm.elements.namedItem('studentId'), sorted.filter((record) => record.data().status === 'active'),
    (item) => item.name + ' (' + item.admissionNo + ')');
  behaviourSection.hidden = false;
}

function renderBehaviour() {
  behaviourList.replaceChildren();
  for (const record of [...behaviourData].sort((a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id)).slice(0, BEHAVIOUR_SHOWN)) {
    const item = record.data();
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Remove';
    button.addEventListener('click', async () => {
      const tools = academic;
      if (!tools || tools.busy || !confirm('Remove this note?')) return;
      const request = schoolRequest;
      tools.busy = true;
      try {
        await tools.remove('behaviour', record.id);
        tools.busy = false;
        await loadBehaviour(request);
      } catch {
        if (request === schoolRequest) behaviourStatus.textContent = 'Could not remove the note. Try again.';
      } finally {
        tools.busy = false;
      }
    });
    listItem(behaviourList, item.date + ' - ' + nameOfStudent(item.studentId) + ' - ' + (item.kind === 'positive' ? 'Positive' : 'Concern')
      + ': ' + item.note, button);
  }
  behaviourStatus.textContent = behaviourData.length ? '' : 'No notes yet.';
}

async function loadBehaviour(request) {
  try {
    const saved = await academic.list('behaviour');
    if (request !== schoolRequest) return;
    behaviourData = saved.docs;
    behaviourSection.hidden = false;
    renderBehaviour();
  } catch {
    if (request === schoolRequest) {
      behaviourSection.hidden = false;
      behaviourStatus.textContent = 'Could not load the notes. Try again.';
    }
  }
}

behaviourForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const fields = new FormData(behaviourForm);
  const studentId = String(fields.get('studentId') ?? '');
  const kind = String(fields.get('kind') ?? '');
  const note = String(fields.get('note') ?? '').trim();
  if (!studentId || !note) {
    behaviourStatus.textContent = 'Choose a student and write the note.';
    return;
  }
  const request = schoolRequest;
  tools.busy = true;
  behaviourStatus.textContent = 'Saving.';
  try {
    await tools.save('behaviour', newId('BH'), { studentId, date: localToday(), kind, note, recordedBy: schoolUid });
    tools.busy = false;
    behaviourForm.elements.namedItem('note').value = '';
    await loadBehaviour(request);
    if (request === schoolRequest) behaviourStatus.textContent = 'Note saved.';
  } catch {
    if (request === schoolRequest) behaviourStatus.textContent = 'Could not save the note. Try again.';
  } finally {
    tools.busy = false;
  }
});

// Owner record lists. Each of these sections is a small form plus a list: the owner adds records,
// sees them, and removes them. Every save and removal goes through academic.save / academic.remove,
// so it lands in the activity log. Records are never edited in place unless the rules say so.
const ownerLists = [];

function ownerList(cfg) {
  const section = document.querySelector('#' + cfg.id);
  const status = document.querySelector('#' + cfg.id + '-status');
  const form = document.querySelector('#' + cfg.id + '-form');
  const list = document.querySelector('#' + cfg.id + '-list');
  const api = { cfg, items: [] };

  async function act(action, message, question) {
    const tools = academic;
    if (!tools || tools.busy || (question && !confirm(question))) return;
    const request = schoolRequest;
    tools.busy = true;
    try {
      await action();
      tools.busy = false;
      await api.load(request);
      if (request === schoolRequest) status.textContent = message;
    } catch {
      if (request === schoolRequest) status.textContent = 'That did not work. Check the details and try again.';
    } finally {
      tools.busy = false;
    }
  }

  api.render = () => {
    if (form && cfg.prepare) cfg.prepare(form, api.items);
    list.replaceChildren();
    for (const record of [...api.items].sort(cfg.sort ?? ((a, b) => a.id.localeCompare(b.id)))) {
      const item = document.createElement('li');
      item.textContent = cfg.line(record.data(), record) + ' ';
      for (const extra of cfg.extra?.(record, act) ?? []) item.append(extra, ' ');
      if (!cfg.noRemove && (!cfg.canRemove || cfg.canRemove(record))) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Remove';
        button.addEventListener('click', () => act(() => academic.remove(cfg.collection, record.id), 'Removed.',
          'Remove this record? ' + cfg.line(record.data(), record)));
        item.append(button);
      }
      list.append(item);
    }
    if (!api.items.length) status.textContent = cfg.empty;
  };

  api.load = async (request) => {
    try {
      const saved = await academic.list(cfg.collection);
      if (request !== schoolRequest) return;
      api.items = saved.docs;
      section.hidden = false;
      status.textContent = '';
      api.render();
    } catch {
      if (request === schoolRequest) {
        section.hidden = false;
        status.textContent = 'Could not load this list. Try again.';
      }
    }
  };

  api.reset = () => {
    section.hidden = true;
    status.textContent = '';
    list.replaceChildren();
    api.items = [];
    form?.reset();
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const built = cfg.build(new FormData(form), api.items);
    if (built.error) {
      status.textContent = built.error;
      return;
    }
    act(async () => {
      await academic.save(cfg.collection, built.id, built.data);
      form.reset();
    }, cfg.saved ?? 'Saved.');
  });

  ownerLists.push(api);
  return api;
}

const text = (fields, key) => String(fields.get(key) ?? '').trim();
const optional = (fields, ...keys) => Object.fromEntries(keys.filter((key) => text(fields, key)).map((key) => [key, text(fields, key)]));
const wholeNumber = (fields, key) => (/^[0-9]+$/.test(text(fields, key)) ? Number(text(fields, key)) : NaN);
const phoneOk = (value) => /^[0-9+() -]{0,20}$/.test(value);
const byStudentName = (a, b) => a.data().name.localeCompare(b.data().name);
const studentOption = (item) => item.name + ' (' + item.admissionNo + ')';
const teacherRecords = () => staffRoster.map((uid) => ({ id: uid, data: () => ({ label: staffLabel(uid) }) }));
const routeName = (id) => lists.routes.items.find((record) => record.id === id)?.data().name ?? id;
const activityName = (id) => lists.activities.items.find((record) => record.id === id)?.data().name ?? id;

const lists = {};
lists.substitutions = ownerList({
  id: 'substitutions', collection: 'substitutions', empty: 'No cover has been arranged yet.', saved: 'Cover arranged.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('classId'), [...examData.classes].sort(byClassOrder), (item) => item.name);
    fillSelect(form.elements.namedItem('substituteUid'), teacherRecords(), (item) => item.label);
  },
  build: (fields) => {
    const date = text(fields, 'date');
    const period = wholeNumber(fields, 'period');
    const classId = text(fields, 'classId');
    const substituteUid = text(fields, 'substituteUid');
    if (!DATE_TEXT.test(date) || !classId || !substituteUid) return { error: 'Choose the date, the class and the substitute teacher.' };
    if (!(period >= 1 && period <= 12)) return { error: 'Period number must be from 1 to 12.' };
    return { id: newId('SB'), data: { date, classId, className: nameOfClass(classId), period, substituteUid,
      ...optional(fields, 'absentTeacher', 'note'), createdBy: schoolUid } };
  },
  line: (item) => item.date + ' - ' + item.className + ' period ' + item.period + ' - ' + staffLabel(item.substituteUid)
    + (item.absentTeacher ? ' - covering ' + item.absentTeacher : '') + (item.note ? ' (' + item.note + ')' : ''),
});

lists.routes = ownerList({
  id: 'routes', collection: 'routes', empty: 'No routes yet.', saved: 'Route added.',
  sort: (a, b) => a.data().name.localeCompare(b.data().name),
  canRemove: (record) => !lists.riders.items.some((rider) => rider.data().routeId === record.id),
  build: (fields) => {
    if (!text(fields, 'name')) return { error: 'Enter the route name.' };
    if (!phoneOk(text(fields, 'driverPhone'))) return { error: 'Phone may use digits, +, spaces, hyphens and brackets only.' };
    return { id: newId('RT'), data: { name: text(fields, 'name'), ...optional(fields, 'vehicle', 'driver', 'driverPhone', 'stops') } };
  },
  line: (item) => item.name + (item.vehicle ? ' - ' + item.vehicle : '') + (item.driver ? ' - driver ' + item.driver : '')
    + (item.driverPhone ? ' (' + item.driverPhone + ')' : '') + (item.stops ? ' - stops: ' + item.stops : ''),
});

lists.riders = ownerList({
  id: 'riders', collection: 'transportRiders', empty: 'No students have been assigned to a route yet.', saved: 'Student assigned. Saving again changes their route.',
  sort: (a, b) => nameOfStudent(a.id).localeCompare(nameOfStudent(b.id)),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('studentId'), studentRecords.filter((record) => record.data().status === 'active').sort(byStudentName),
      studentOption);
    fillSelect(form.elements.namedItem('routeId'), lists.routes.items, (item) => item.name);
  },
  build: (fields) => {
    if (!text(fields, 'studentId') || !text(fields, 'routeId')) return { error: 'Choose a student and a route. Add a route first if there is none.' };
    return { id: text(fields, 'studentId'), data: { studentId: text(fields, 'studentId'), routeId: text(fields, 'routeId'), ...optional(fields, 'stop') } };
  },
  line: (item) => nameOfStudent(item.studentId) + ' - ' + routeName(item.routeId) + (item.stop ? ' - stop ' + item.stop : ''),
});

lists.activities = ownerList({
  id: 'activities', collection: 'activities', empty: 'No activities yet.', saved: 'Activity added.',
  sort: (a, b) => a.data().name.localeCompare(b.data().name),
  canRemove: (record) => !lists.members.items.some((member) => member.data().activityId === record.id),
  build: (fields) => {
    if (!text(fields, 'name')) return { error: 'Enter the activity name.' };
    return { id: newId('AC'), data: { name: text(fields, 'name'), ...optional(fields, 'teacher', 'schedule') } };
  },
  line: (item) => item.name + (item.teacher ? ' - ' + item.teacher : '') + (item.schedule ? ' - ' + item.schedule : ''),
});

lists.members = ownerList({
  id: 'members', collection: 'activityMembers', empty: 'No members yet.', saved: 'Member added.',
  sort: (a, b) => activityName(a.data().activityId).localeCompare(activityName(b.data().activityId)) || nameOfStudent(a.data().studentId).localeCompare(nameOfStudent(b.data().studentId)),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('activityId'), lists.activities.items, (item) => item.name);
    fillSelect(form.elements.namedItem('studentId'), studentRecords.filter((record) => record.data().status === 'active').sort(byStudentName),
      studentOption);
  },
  build: (fields, items) => {
    const activityId = text(fields, 'activityId');
    const studentId = text(fields, 'studentId');
    if (!activityId || !studentId) return { error: 'Choose an activity and a student. Add an activity first if there is none.' };
    if (items.some((record) => record.id === activityId + '_' + studentId)) return { error: 'This student is already a member.' };
    return { id: activityId + '_' + studentId, data: { activityId, studentId, joinedOn: localToday() } };
  },
  line: (item) => activityName(item.activityId) + ' - ' + nameOfStudent(item.studentId) + ' (joined ' + item.joinedOn + ')',
});

lists.inventory = ownerList({
  id: 'inventory', collection: 'inventory', empty: 'No items yet.', saved: 'Item added.',
  sort: (a, b) => a.data().name.localeCompare(b.data().name),
  build: (fields) => {
    const quantity = wholeNumber(fields, 'quantity');
    const minQuantity = wholeNumber(fields, 'minQuantity');
    if (!text(fields, 'name') || Number.isNaN(quantity) || Number.isNaN(minQuantity)) return { error: 'Enter the item and whole numbers for the quantities.' };
    return { id: newId('IV'), data: { name: text(fields, 'name'), ...optional(fields, 'category', 'unit'), quantity, minQuantity } };
  },
  line: (item) => item.name + (item.category ? ' (' + item.category + ')' : '') + ' - ' + item.quantity + (item.unit ? ' ' + item.unit : '')
    + (item.quantity <= item.minQuantity ? ' - LOW STOCK' : ''),
  extra: (record, act) => ['Add stock', 'Use stock'].map((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      const amount = Number(prompt(label + ': how many?') ?? '');
      if (!Number.isInteger(amount) || amount < 1) return;
      const item = record.data();
      const quantity = item.quantity + (index === 0 ? amount : -amount);
      if (quantity < 0 || quantity > 1000000) {
        lists.inventory.status?.();
        return;
      }
      act(() => academic.save('inventory', record.id, { ...item, quantity }), 'Stock updated.');
    });
    return button;
  }),
});

lists.expenses = ownerList({
  id: 'expenses', collection: 'expenses', empty: 'No expenses yet.', saved: 'Expense added.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  build: (fields) => {
    const amount = wholeNumber(fields, 'amount');
    if (!DATE_TEXT.test(text(fields, 'date')) || !text(fields, 'category') || !(amount >= 1 && amount <= 100000000)) {
      return { error: 'Enter the date, the category and the amount in whole rupees.' };
    }
    return { id: newId('EX'), data: { date: text(fields, 'date'), category: text(fields, 'category'), amount, ...optional(fields, 'note') } };
  },
  line: (item) => item.date + ' - ' + item.category + ' - ' + rupees(item.amount) + (item.note ? ' (' + item.note + ')' : ''),
  extra: () => {
    const month = localToday().slice(0, 7);
    const total = lists.expenses.items.filter((record) => record.data().date.startsWith(month))
      .reduce((sum, record) => sum + record.data().amount, 0);
    const byCategory = new Map();
    for (const record of lists.expenses.items) {
      if (record.data().date.startsWith(month)) byCategory.set(record.data().category, (byCategory.get(record.data().category) ?? 0) + record.data().amount);
    }
    const parts = [...byCategory].sort((a, b) => b[1] - a[1]).map(([name, amount]) => name + ' ' + rupees(amount));
    document.querySelector('#expenses-total').textContent = 'Spent this month (' + month + '): ' + rupees(total)
      + (parts.length ? ' - ' + parts.join(', ') : '');
    return [];
  },
});
document.querySelector('#expenses-csv').addEventListener('click', () => {
  downloadCsv('expenses.csv', [['Date', 'Category', 'Amount', 'Note'],
    ...[...lists.expenses.items].sort((a, b) => a.data().date.localeCompare(b.data().date))
      .map((record) => [record.data().date, record.data().category, record.data().amount, record.data().note ?? ''])]);
});

lists.certificates = ownerList({
  id: 'certificates', collection: 'certificates', empty: 'No certificates recorded yet.', saved: 'Certificate recorded.',
  sort: (a, b) => b.data().issuedOn.localeCompare(a.data().issuedOn) || b.id.localeCompare(a.id),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('studentId'), [...studentRecords].sort(byStudentName), studentOption);
  },
  build: (fields) => {
    const record = studentRecords.find((item) => item.id === text(fields, 'studentId'));
    if (!record) return { error: 'Choose a student.' };
    const type = text(fields, 'type');
    return { id: newId(type.slice(0, 2).toUpperCase()), data: { type, studentId: record.id, studentName: record.data().name,
      issuedOn: localToday(), ...optional(fields, 'purpose') } };
  },
  line: (item, record) => record.id + ' - ' + item.type + ' certificate - ' + item.studentName + ' - ' + item.issuedOn
    + (item.purpose ? ' (' + item.purpose + ')' : ''),
  extra: (record) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Print certificate';
    button.addEventListener('click', () => printCertificate(record.id, record.data()));
    return [button];
  },
});

// Opens a clean page with the certificate wording and starts printing. Text is placed with textContent only.
function printCertificate(certNo, item) {
  const win = window.open('', '_blank');
  if (!win) {
    document.querySelector('#certificates-status').textContent = 'Your browser blocked the print window. Allow pop-ups for this site and try again.';
    return;
  }
  const school = document.querySelector('#school-name').textContent.trim() || 'School';
  const body = {
    Bonafide: 'This is to certify that ' + item.studentName + ' is a bonafide student of this school.',
    Transfer: 'This is to certify that ' + item.studentName + ' has studied in this school and is granted a transfer certificate.',
    Character: 'This is to certify that ' + item.studentName + ' has shown good conduct and character while studying in this school.',
  }[item.type];
  const doc = win.document;
  doc.title = item.type + ' Certificate ' + certNo;
  const style = doc.createElement('style');
  style.textContent = 'body{font-family:Georgia,serif;max-width:700px;margin:60px auto;padding:40px;border:4px double #1b2a49;text-align:center}'
    + 'h1{color:#1b2a49;margin-bottom:0}h2{font-weight:normal;letter-spacing:2px}p{font-size:18px;line-height:1.7}.meta{margin-top:60px;display:flex;justify-content:space-between;font-size:15px}';
  doc.head.append(style);
  const add = (tag, textValue, className) => {
    const element = doc.createElement(tag);
    element.textContent = textValue;
    if (className) element.className = className;
    doc.body.append(element);
    return element;
  };
  add('h1', school);
  add('h2', item.type.toUpperCase() + ' CERTIFICATE');
  add('p', 'Certificate no. ' + certNo);
  add('p', body);
  if (item.purpose) add('p', 'Issued for: ' + item.purpose);
  const meta = add('div', '', 'meta');
  for (const label of ['Date: ' + item.issuedOn, 'Principal signature']) {
    const span = doc.createElement('span');
    span.textContent = label;
    meta.append(span);
  }
  win.focus();
  win.print();
}

lists.tickets = ownerList({
  id: 'tickets', collection: 'tickets', empty: 'No tickets yet.', saved: 'Ticket added.',
  sort: (a, b) => (a.data().status === 'done') - (b.data().status === 'done') || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!text(fields, 'title')) return { error: 'Describe the problem.' };
    return { id: newId('TK'), data: { title: text(fields, 'title'), ...optional(fields, 'place'),
      priority: text(fields, 'priority'), status: 'open', createdOn: localToday() } };
  },
  line: (item) => '[' + item.status + '] ' + item.title + (item.place ? ' - ' + item.place : '') + ' - ' + item.priority + ' priority - ' + item.createdOn,
  extra: (record, act) => {
    const button = document.createElement('button');
    button.type = 'button';
    const done = record.data().status === 'done';
    button.textContent = done ? 'Reopen' : 'Mark done';
    button.addEventListener('click', () => act(() => academic.save('tickets', record.id,
      { ...record.data(), status: done ? 'open' : 'done' }), 'Ticket updated.'));
    return [button];
  },
});

lists.staffdir = ownerList({
  id: 'staffdir', collection: 'staffDirectory', empty: 'No staff added yet.', saved: 'Staff member added.',
  sort: (a, b) => a.data().name.localeCompare(b.data().name),
  build: (fields) => {
    if (!text(fields, 'name') || !text(fields, 'role')) return { error: 'Enter the name and the role.' };
    if (!phoneOk(text(fields, 'phone'))) return { error: 'Phone may use digits, +, spaces, hyphens and brackets only.' };
    return { id: newId('SD'), data: { name: text(fields, 'name'), role: text(fields, 'role'), ...optional(fields, 'phone', 'email', 'joinedOn') } };
  },
  line: (item) => item.name + ' - ' + item.role + (item.phone ? ' - ' + item.phone : '') + (item.email ? ' - ' + item.email : ''),
});

lists.vendors = ownerList({
  id: 'vendors', collection: 'vendors', empty: 'No vendors yet.', saved: 'Vendor added.',
  sort: (a, b) => a.data().trade.localeCompare(b.data().trade) || a.data().name.localeCompare(b.data().name),
  build: (fields) => {
    if (!text(fields, 'name') || !text(fields, 'trade')) return { error: 'Enter the name and the service.' };
    if (!phoneOk(text(fields, 'phone'))) return { error: 'Phone may use digits, +, spaces, hyphens and brackets only.' };
    return { id: newId('VN'), data: { name: text(fields, 'name'), trade: text(fields, 'trade'), ...optional(fields, 'phone', 'note') } };
  },
  line: (item) => item.trade + ' - ' + item.name + (item.phone ? ' - ' + item.phone : '') + (item.note ? ' (' + item.note + ')' : ''),
});

lists.minutes = ownerList({
  id: 'minutes', collection: 'minutes', empty: 'No minutes saved yet.', saved: 'Minutes saved.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!DATE_TEXT.test(text(fields, 'date')) || !text(fields, 'title') || !text(fields, 'notes')) return { error: 'Enter the date, the title and the notes.' };
    return { id: newId('MN'), data: { date: text(fields, 'date'), title: text(fields, 'title'), notes: text(fields, 'notes') } };
  },
  line: (item) => item.date + ' - ' + item.title + ': ' + item.notes,
});

lists.lostfound = ownerList({
  id: 'lostfound', collection: 'lostFound', empty: 'Nothing recorded yet.', saved: 'Item recorded.',
  sort: (a, b) => (a.data().status === 'returned') - (b.data().status === 'returned') || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!text(fields, 'item')) return { error: 'Describe the item.' };
    return { id: newId('LF'), data: { item: text(fields, 'item'), kind: text(fields, 'kind'), date: localToday(), status: 'open', ...optional(fields, 'place') } };
  },
  line: (item) => '[' + item.status + '] ' + item.kind.toUpperCase() + ': ' + item.item + (item.place ? ' - ' + item.place : '') + ' - ' + item.date,
  extra: (record, act) => {
    const button = document.createElement('button');
    button.type = 'button';
    const returned = record.data().status === 'returned';
    button.textContent = returned ? 'Reopen' : 'Mark returned';
    button.addEventListener('click', () => act(() => academic.save('lostFound', record.id,
      { ...record.data(), status: returned ? 'open' : 'returned' }), 'Updated.'));
    return [button];
  },
});

const pickedStudent = (fields) => studentRecords.find((item) => item.id === text(fields, 'studentId'));
const activeStudents = () => [...studentRecords].sort(byStudentName);

lists.concessions = ownerList({
  id: 'concessions', collection: 'concessions', empty: 'No concessions recorded yet.', saved: 'Concession recorded.',
  sort: (a, b) => b.data().givenOn.localeCompare(a.data().givenOn) || b.id.localeCompare(a.id),
  prepare: (form) => fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption),
  build: (fields) => {
    const student = pickedStudent(fields);
    const amount = wholeNumber(fields, 'amount');
    if (!student || !(amount >= 1 && amount <= 10000000)) return { error: 'Choose a student and enter the amount in whole rupees.' };
    return { id: newId('CN'), data: { studentId: student.id, studentName: student.data().name, kind: text(fields, 'kind'),
      amount, givenOn: localToday(), ...optional(fields, 'note') } };
  },
  line: (item) => item.givenOn + ' - ' + item.studentName + ' - ' + item.kind + ' - ' + rupees(item.amount) + (item.note ? ' (' + item.note + ')' : ''),
});

lists.achievements = ownerList({
  id: 'achievements', collection: 'achievements', empty: 'No achievements recorded yet.', saved: 'Achievement added.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  prepare: (form) => fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption),
  build: (fields) => {
    const student = pickedStudent(fields);
    if (!student || !text(fields, 'title') || !DATE_TEXT.test(text(fields, 'date'))) return { error: 'Choose a student, then enter the achievement and the date.' };
    return { id: newId('AC'), data: { studentId: student.id, studentName: student.data().name, title: text(fields, 'title'),
      level: text(fields, 'level'), date: text(fields, 'date') } };
  },
  line: (item) => item.date + ' - ' + item.studentName + ' - ' + item.title + ' (' + item.level + ' level)',
});

lists.complaints = ownerList({
  id: 'complaints', collection: 'complaints', empty: 'No complaints logged.', saved: 'Complaint logged.',
  sort: (a, b) => (a.data().status === 'resolved') - (b.data().status === 'resolved') || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!text(fields, 'title') || !text(fields, 'raisedBy')) return { error: 'Enter the complaint and who raised it.' };
    return { id: newId('CP'), data: { title: text(fields, 'title'), raisedBy: text(fields, 'raisedBy'), date: localToday(), status: 'open', ...optional(fields, 'note') } };
  },
  line: (item) => '[' + item.status + '] ' + item.date + ' - ' + item.title + ' - by ' + item.raisedBy + (item.note ? ' (' + item.note + ')' : ''),
  extra: (record, act) => {
    const button = document.createElement('button');
    button.type = 'button';
    const resolved = record.data().status === 'resolved';
    button.textContent = resolved ? 'Reopen' : 'Mark resolved';
    button.addEventListener('click', () => act(() => academic.save('complaints', record.id,
      { ...record.data(), status: resolved ? 'open' : 'resolved' }), 'Updated.'));
    return [button];
  },
});

lists.assets = ownerList({
  id: 'assets', collection: 'assets', empty: 'No assets recorded yet.', saved: 'Asset added.',
  sort: (a, b) => a.data().place.localeCompare(b.data().place) || a.data().name.localeCompare(b.data().name),
  build: (fields) => {
    const cost = wholeNumber(fields, 'cost');
    if (!text(fields, 'name') || !text(fields, 'place') || !(cost >= 0 && cost <= 1000000000)) return { error: 'Enter the asset, the place and the cost in whole rupees.' };
    return { id: newId('AS'), data: { name: text(fields, 'name'), place: text(fields, 'place'), cost, condition: text(fields, 'condition'), ...optional(fields, 'boughtOn') } };
  },
  line: (item) => item.place + ' - ' + item.name + ' - ' + rupees(item.cost) + ' - ' + item.condition + (item.boughtOn ? ' - bought ' + item.boughtOn : ''),
});

lists.sales = ownerList({
  id: 'sales', collection: 'sales', empty: 'No sales recorded yet.', saved: 'Sale recorded.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  prepare: (form) => fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption),
  build: (fields) => {
    const student = pickedStudent(fields);
    const quantity = wholeNumber(fields, 'quantity');
    const amount = wholeNumber(fields, 'amount');
    if (!student || !text(fields, 'item') || !(quantity >= 1 && quantity <= 1000) || !(amount >= 0 && amount <= 10000000)) {
      return { error: 'Choose a student, then enter the item, the quantity and the amount in whole numbers.' };
    }
    return { id: newId('SL'), data: { studentId: student.id, studentName: student.data().name, item: text(fields, 'item'),
      quantity, amount, date: localToday() } };
  },
  line: (item) => item.date + ' - ' + item.studentName + ' - ' + item.quantity + ' x ' + item.item + ' - ' + rupees(item.amount),
});

lists.syllabus = ownerList({
  id: 'syllabus', collection: 'syllabus', empty: 'No chapters added yet.', saved: 'Chapter added.',
  sort: (a, b) => a.data().className.localeCompare(b.data().className, undefined, { numeric: true })
    || a.data().subjectName.localeCompare(b.data().subjectName) || a.id.localeCompare(b.id),
  build: (fields) => {
    if (!text(fields, 'className') || !text(fields, 'subjectName') || !text(fields, 'chapter')) return { error: 'Enter the class, the subject and the chapter.' };
    return { id: newId('SY'), data: { className: text(fields, 'className'), subjectName: text(fields, 'subjectName'), chapter: text(fields, 'chapter'), status: 'Pending' } };
  },
  line: (item) => item.className + ' - ' + item.subjectName + ' - ' + item.chapter + ' - ' + item.status,
  extra: (record, act) => {
    const order = ['Pending', 'In progress', 'Done'];
    const button = document.createElement('button');
    button.type = 'button';
    const next = order[(order.indexOf(record.data().status) + 1) % order.length];
    button.textContent = 'Set ' + next;
    button.addEventListener('click', () => act(() => academic.save('syllabus', record.id, { ...record.data(), status: next }), 'Updated.'));
    return [button];
  },
});

lists.trainings = ownerList({
  id: 'trainings', collection: 'trainings', empty: 'No training recorded yet.', saved: 'Training recorded.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  build: (fields) => {
    const hours = wholeNumber(fields, 'hours');
    if (!text(fields, 'staffName') || !text(fields, 'course') || !DATE_TEXT.test(text(fields, 'date')) || !(hours >= 1 && hours <= 1000)) {
      return { error: 'Enter the staff member, the course, the date and the hours.' };
    }
    return { id: newId('TR'), data: { staffName: text(fields, 'staffName'), course: text(fields, 'course'), date: text(fields, 'date'), hours } };
  },
  line: (item) => item.date + ' - ' + item.staffName + ' - ' + item.course + ' (' + item.hours + ' h)',
});

lists.diary = ownerList({
  id: 'diary', collection: 'diary', empty: 'No diary entries yet.', saved: 'Entry saved.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!DATE_TEXT.test(text(fields, 'date')) || !text(fields, 'entry')) return { error: 'Enter the date and the entry.' };
    return { id: newId('DY'), data: { date: text(fields, 'date'), entry: text(fields, 'entry') } };
  },
  line: (item) => item.date + ' - ' + item.entry,
});

// Needs attention: counts of open work, taken from the lists the owner screens have already loaded.
const attentionList = document.querySelector('#attention-list');
const attentionStatus = document.querySelector('#attention-status');
function refreshAttention() {
  const count = (list, test) => list.items.filter((record) => test(record.data())).length;
  const checks = [
    [count(lists.inventory, (item) => item.quantity <= item.minQuantity), 'inventory item(s) at or below the stock warning level'],
    [count(lists.enquiries, (item) => item.status === 'new'), 'new admission enquiry(ies) not yet handled'],
    [count(lists.inbox, (item) => !item.reply), 'parent message(s) waiting for a reply'],
    [count(lists.tickets, (item) => item.status === 'open'), 'open maintenance ticket(s)'],
    [count(lists.complaints, (item) => item.status === 'open'), 'open complaint(s)'],
    [count(lists.lostfound, (item) => item.status === 'open'), 'lost and found item(s) still open'],
    [count(lists.syllabus, (item) => item.status !== 'Done'), 'syllabus chapter(s) not finished'],
  ].filter(([number]) => number > 0);
  attentionList.replaceChildren();
  for (const [number, label] of checks) {
    const item = document.createElement('li');
    item.textContent = number + ' ' + label;
    attentionList.append(item);
  }
  attentionStatus.textContent = checks.length ? '' : 'Nothing needs attention right now.';
}
document.querySelector('#attention-refresh').addEventListener('click', refreshAttention);

// Finance summary: fees collected (voided receipts left out) against expenses, month by month.
const financeStatus = document.querySelector('#finance-status');
const financeList = document.querySelector('#finance-list');
document.querySelector('#finance-show').addEventListener('click', async () => {
  const tools = academic;
  if (!tools) return;
  const request = schoolRequest;
  financeStatus.textContent = 'Loading...';
  try {
    const payments = await tools.list('payments');
    if (request !== schoolRequest) return;
    const months = new Map();
    const slot = (month) => months.get(month) ?? months.set(month, { fees: 0, spent: 0 }).get(month);
    for (const record of payments.docs) {
      const payment = record.data();
      if (!payment.voided) slot(payment.date.slice(0, 7)).fees += payment.amount;
    }
    for (const record of lists.expenses.items) slot(record.data().date.slice(0, 7)).spent += record.data().amount;
    financeList.replaceChildren();
    for (const [month, figures] of [...months].sort((a, b) => b[0].localeCompare(a[0]))) {
      const item = document.createElement('li');
      item.textContent = month + ' - fees collected ' + rupees(figures.fees) + ' - expenses ' + rupees(figures.spent)
        + ' - ' + (figures.fees >= figures.spent ? 'surplus ' : 'shortfall ') + rupees(Math.abs(figures.fees - figures.spent));
      financeList.append(item);
    }
    financeStatus.textContent = months.size ? 'Expenses come from the Expenses screen. Voided receipts are not counted.' : 'No payments or expenses yet.';
  } catch {
    if (request === schoolRequest) financeStatus.textContent = 'Could not load. Try again.';
  }
});

// Student profile: one page that gathers what the school holds about a student.
const p360Student = document.querySelector('#profile360-student');
const p360Status = document.querySelector('#profile360-status');
const p360List = document.querySelector('#profile360-list');
const fillP360Students = () => {
  const chosen = p360Student.value;
  p360Student.replaceChildren(new Option('Choose a student', ''),
    ...activeStudents().map((record) => new Option(studentOption(record.data()), record.id)));
  p360Student.value = chosen;
};
p360Student.addEventListener('focus', fillP360Students);
p360Student.addEventListener('mousedown', fillP360Students);
document.querySelector('#profile360-show').addEventListener('click', async () => {
  const tools = academic;
  const studentId = p360Student.value;
  const student = studentRecords.find((record) => record.id === studentId);
  if (!tools || !student) {
    p360Status.textContent = 'Choose a student first.';
    return;
  }
  const request = schoolRequest;
  p360Status.textContent = 'Loading...';
  try {
    const [payments, enrollments] = await Promise.all([tools.list('payments'), tools.list('enrollments')]);
    if (request !== schoolRequest) return;
    const data = student.data();
    const rows = [['Student', data.name + ' (' + data.admissionNo + ') - ' + data.status],
      ['Guardian', data.guardianName + (data.guardianPhone ? ' - ' + data.guardianPhone : '')]];
    for (const record of enrollments.docs.filter((item) => item.data().studentId === studentId)) {
      const placement = record.data();
      rows.push(['Class ' + placement.yearId, nameOfClass(placement.classId) + ', roll ' + placement.rollNo]);
    }
    const paid = payments.docs.filter((item) => item.data().studentId === studentId && !item.data().voided);
    rows.push(['Fees paid', rupees(paid.reduce((sum, item) => sum + item.data().amount, 0)) + ' in ' + paid.length + ' receipt(s)']);
    const mine = (list) => list.items.filter((record) => record.data().studentId === studentId).map((record) => record.data());
    const concessions = mine(lists.concessions);
    if (concessions.length) rows.push(['Concessions', concessions.map((item) => item.kind + ' ' + rupees(item.amount)).join(', ')]);
    const achievements = mine(lists.achievements);
    if (achievements.length) rows.push(['Achievements', achievements.map((item) => item.title + ' (' + item.level + ')').join(', ')]);
    const certificates = mine(lists.certificates);
    if (certificates.length) rows.push(['Certificates', certificates.map((item) => item.type + ' ' + item.issuedOn).join(', ')]);
    const sales = mine(lists.sales);
    if (sales.length) rows.push(['Purchases', sales.map((item) => item.quantity + ' x ' + item.item).join(', ')]);
    const rider = lists.riders.items.find((record) => record.id === studentId);
    if (rider) rows.push(['Transport', routeName(rider.data().routeId)]);
    const activities = lists.members.items.filter((record) => record.data().studentId === studentId).map((record) => activityName(record.data().activityId));
    if (activities.length) rows.push(['Activities', activities.join(', ')]);
    p360List.replaceChildren();
    for (const [label, value] of rows) {
      const item = document.createElement('li');
      item.textContent = label + ': ' + value;
      p360List.append(item);
    }
    p360Status.textContent = '';
  } catch {
    if (request === schoolRequest) p360Status.textContent = 'Could not load. Try again.';
  }
});

lists.alumni = ownerList({
  id: 'alumni', collection: 'alumni', empty: 'No alumni yet.', saved: 'Alumnus added.',
  sort: (a, b) => b.data().passoutYear - a.data().passoutYear || a.data().name.localeCompare(b.data().name),
  build: (fields) => {
    const year = wholeNumber(fields, 'passoutYear');
    if (!text(fields, 'name') || !(year >= 1950 && year <= 2100)) return { error: 'Enter the name and the year they left (1950 to 2100).' };
    return { id: newId('AL'), data: { name: text(fields, 'name'), passoutYear: year, ...optional(fields, 'contact', 'occupation', 'note') } };
  },
  line: (item) => item.passoutYear + ' - ' + item.name + (item.occupation ? ' - ' + item.occupation : '')
    + (item.contact ? ' - ' + item.contact : '') + (item.note ? ' (' + item.note + ')' : ''),
});

lists.health = ownerList({
  id: 'health', collection: 'healthRecords', empty: 'No health records yet.', saved: 'Health record saved. Saving again for the same student replaces it.',
  sort: (a, b) => nameOfStudent(a.id).localeCompare(nameOfStudent(b.id)),
  prepare: (form) => fillSelect(form.elements.namedItem('studentId'), [...studentRecords].sort(byStudentName), studentOption),
  build: (fields) => {
    if (!text(fields, 'studentId')) return { error: 'Choose a student.' };
    return { id: text(fields, 'studentId'), data: { studentId: text(fields, 'studentId'), bloodGroup: text(fields, 'bloodGroup'),
      ...optional(fields, 'allergies', 'conditions', 'emergencyContact', 'notes') } };
  },
  line: (item) => nameOfStudent(item.studentId) + (item.bloodGroup ? ' - blood group ' + item.bloodGroup : '')
    + (item.allergies ? ' - allergies: ' + item.allergies : '') + (item.conditions ? ' - conditions: ' + item.conditions : '')
    + (item.emergencyContact ? ' - emergency: ' + item.emergencyContact : '') + (item.notes ? ' (' + item.notes + ')' : ''),
});

lists.lessons = ownerList({
  id: 'lessons-owner', collection: 'lessonPlans', empty: 'No lesson plans yet.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  line: (item) => item.date + ' - ' + nameOfClass(item.classId) + ' - ' + item.subject + ': ' + item.topic + ' - ' + item.objectives,
});

lists.ptm = ownerList({
  id: 'ptm', collection: 'ptmSlots', empty: 'No meetings scheduled.', saved: 'Meeting scheduled.',
  sort: (a, b) => a.data().date.localeCompare(b.data().date) || a.data().time.localeCompare(b.data().time),
  prepare: (form) => fillSelect(form.elements.namedItem('classId'), [...examData.classes].sort(byClassOrder), (item) => item.name),
  build: (fields) => {
    if (!text(fields, 'classId') || !DATE_TEXT.test(text(fields, 'date')) || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(text(fields, 'time'))) {
      return { error: 'Choose the class, the date and the time.' };
    }
    return { id: newId('PT'), data: { classId: text(fields, 'classId'), date: text(fields, 'date'), time: text(fields, 'time'),
      ...optional(fields, 'teacher', 'place', 'note') } };
  },
  line: (item) => item.date + ' ' + item.time + ' - ' + nameOfClass(item.classId) + (item.teacher ? ' - ' + item.teacher : '')
    + (item.place ? ' - ' + item.place : '') + (item.note ? ' (' + item.note + ')' : ''),
});

lists.payroll = ownerList({
  id: 'payroll', collection: 'payroll', empty: 'No salary records yet.', saved: 'Salary record saved. Saving the same person and month again replaces it.',
  sort: (a, b) => b.data().month.localeCompare(a.data().month) || a.id.localeCompare(b.id),
  prepare: (form) => fillSelect(form.elements.namedItem('staffUid'), teacherRecords(), (item) => item.label),
  build: (fields) => {
    const basic = wholeNumber(fields, 'basic');
    const allowances = wholeNumber(fields, 'allowances');
    const deductions = wholeNumber(fields, 'deductions');
    const staffUid = text(fields, 'staffUid');
    const month = text(fields, 'month');
    if (!staffUid || !/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Choose the staff member and the month.' };
    if ([basic, allowances, deductions].some(Number.isNaN)) return { error: 'Pay amounts must be whole rupees.' };
    if (deductions > basic + allowances) return { error: 'Deductions cannot be more than the pay.' };
    return { id: staffUid + '_' + month, data: { staffUid, month, basic, allowances, deductions,
      ...(DATE_TEXT.test(text(fields, 'paidOn')) ? { paidOn: text(fields, 'paidOn') } : {}), ...optional(fields, 'note') } };
  },
  line: (item) => item.month + ' - ' + staffLabel(item.staffUid) + ' - net ' + rupees(item.basic + item.allowances - item.deductions)
    + ' (basic ' + rupees(item.basic) + ', allowances ' + rupees(item.allowances) + ', deductions ' + rupees(item.deductions) + ')'
    + (item.paidOn ? ' - paid ' + item.paidOn : ' - NOT PAID') + (item.note ? ' (' + item.note + ')' : ''),
});

lists.inbox = ownerList({
  id: 'inbox', collection: 'messages', empty: 'No messages yet.',
  sort: (a, b) => b.data().createdAt.localeCompare(a.data().createdAt) || b.id.localeCompare(a.id),
  line: (item) => item.createdAt + ' - ' + nameOfStudent(item.studentId) + ' - ' + item.subject + ': ' + item.body
    + (item.reply ? ' | REPLY (' + item.repliedAt + '): ' + item.reply : ' | NOT ANSWERED'),
  extra: (record, act) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = record.data().reply ? 'Change reply' : 'Reply';
    button.addEventListener('click', () => {
      const reply = (prompt('Your reply to the parent:', record.data().reply ?? '') ?? '').trim();
      if (!reply || reply.length > 1000) return;
      act(() => academic.save('messages', record.id, { ...record.data(), reply, repliedAt: localToday() }), 'Reply saved.');
    });
    return [button];
  },
});

// Admission enquiries: sent from the public page, moved along here. Only the status changes.
lists.enquiries = ownerList({
  id: 'enquiries', collection: 'enquiries', empty: 'No enquiries yet.',
  sort: (a, b) => b.data().createdAt.localeCompare(a.data().createdAt) || b.id.localeCompare(a.id),
  line: (item) => item.createdAt + ' - ' + item.studentName + ' for ' + item.classApplying + ' - guardian ' + item.guardianName
    + ' (' + item.phone + (item.email ? ', ' + item.email : '') + ')' + (item.message ? ' - "' + item.message + '"' : '')
    + ' - STATUS: ' + item.status.toUpperCase() + (item.note ? ' (' + item.note + ')' : ''),
  extra: (record, act) => ['contacted', 'admitted', 'rejected'].filter((status) => status !== record.data().status).map((status) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mark ' + status;
    button.addEventListener('click', () => act(() => academic.save('enquiries', record.id, { ...record.data(), status }), 'Marked ' + status + '.'));
    return button;
  }),
});

lists.eventregs = ownerList({
  id: 'eventregs', collection: 'eventRegistrations', empty: 'No registrations yet.',
  sort: (a, b) => a.data().eventTitle.localeCompare(b.data().eventTitle) || nameOfStudent(a.data().studentId).localeCompare(nameOfStudent(b.data().studentId)),
  line: (item) => item.eventTitle + ' - ' + nameOfStudent(item.studentId) + ' (registered ' + item.registeredOn + ')',
});

// Public website content: one document the public page reads.
const websiteSection = document.querySelector('#website');
const websiteStatus = document.querySelector('#website-status');
const websiteForm = document.querySelector('#website-form');
const WEBSITE_FIELDS = ['name', 'tagline', 'about', 'vision', 'mission', 'leadership', 'programmes', 'faculty', 'facilities', 'news',
  'phone', 'email', 'address', 'mapUrl'];
const MAP_PREFIX = /^https:\/\/www\.google\.com\/maps\/embed\?[^ ]*$/;

async function loadWebsite(request) {
  const { doc, getDocFromServer } = firestoreTools;
  websiteSection.hidden = false;
  try {
    const saved = await getDocFromServer(doc(academic.schoolRef, 'site', 'main'));
    if (request !== schoolRequest) return;
    const data = saved.exists() ? saved.data() : {};
    for (const key of WEBSITE_FIELDS) websiteForm.elements.namedItem(key).value = data[key] ?? '';
    websiteStatus.textContent = saved.exists() ? '' : 'Nothing is published yet. Fill this in and save.';
  } catch {
    if (request === schoolRequest) websiteStatus.textContent = 'Could not load the website content. Try again.';
  }
}

websiteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const fields = new FormData(websiteForm);
  const data = { name: text(fields, 'name') };
  for (const key of WEBSITE_FIELDS.slice(1)) if (text(fields, key)) data[key] = text(fields, key);
  if (!data.name) {
    websiteStatus.textContent = 'Enter the school name.';
    return;
  }
  if (data.mapUrl && !MAP_PREFIX.test(data.mapUrl)) {
    websiteStatus.textContent = 'The map link must be a Google Maps embed link starting with https://www.google.com/maps/embed?';
    return;
  }
  const request = schoolRequest;
  tools.busy = true;
  websiteStatus.textContent = 'Saving.';
  try {
    await tools.save('site', 'main', data);
    if (request === schoolRequest) websiteStatus.textContent = 'Saved. The public page now shows this.';
  } catch {
    if (request === schoolRequest) websiteStatus.textContent = 'Could not save. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
});

// Parent page: register the student for upcoming calendar events, or cancel.
const portalEventsSection = document.querySelector('#portal-events');
const portalEventsStatus = document.querySelector('#portal-events-status');
const portalEventsList = document.querySelector('#portal-events-list');

async function loadPortalEvents(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  const { doc, setDoc, deleteDoc } = firestoreTools;
  portalEventsSection.hidden = false;
  portalEventsStatus.textContent = 'Loading events.';
  try {
    const [events, registered] = await Promise.all([
      getDocsFromServer(collection(schoolRef, 'calendar')),
      getDocsFromServer(query(collection(schoolRef, 'eventRegistrations'), where('studentId', '==', studentId)))]);
    if (request !== schoolRequest) return;
    const already = new Set(registered.docs.map((record) => record.data().eventId));
    const today = localToday();
    const upcoming = events.docs.map((record) => ({ id: record.id, data: record.data() }))
      .filter((entry) => entry.data.date >= today && ['event', 'exam', 'meeting'].includes(entry.data.kind)).sort(byDate);
    portalEventsList.replaceChildren();
    let busy = false;
    for (const entry of upcoming) {
      const joined = already.has(entry.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = joined ? 'Cancel registration' : 'Register';
      button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        const target = doc(schoolRef, 'eventRegistrations', entry.id + '_' + studentId);
        try {
          if (joined) await deleteDoc(target);
          else await setDoc(target, { eventId: entry.id, eventTitle: entry.data.title, studentId, registeredOn: localToday(), createdBy: tools.user.uid });
        } catch {
          portalEventsStatus.textContent = 'That did not work. Try again.';
          busy = false;
          return;
        }
        busy = false;
        await loadPortalEvents(tools, request, studentId);
      });
      listItem(portalEventsList, eventText(entry.data) + (joined ? ' - REGISTERED' : ''), button);
    }
    portalEventsStatus.textContent = upcoming.length ? '' : 'No events are open for registration.';
  } catch {
    if (request === schoolRequest) portalEventsStatus.textContent = 'Could not load events. Try again.';
  }
}

// Reports and tools computed in the browser from data already loaded: setup checklist, fee dues,
// teacher workload and a full data backup. None of these write anything.
const checklistSection = document.querySelector('#checklist');
const checklistStatus = document.querySelector('#checklist-status');
const checklistList = document.querySelector('#checklist-list');
const defaultersSection = document.querySelector('#defaulters');
const defaultersStatus = document.querySelector('#defaulters-status');
const defaultersClass = document.querySelector('#defaulters-class');
const defaultersList = document.querySelector('#defaulters-list');
const workloadSection = document.querySelector('#workload');
const workloadStatus = document.querySelector('#workload-status');
const workloadList = document.querySelector('#workload-list');
const backupSection = document.querySelector('#backup');
const backupStatus = document.querySelector('#backup-status');
const backupRun = document.querySelector('#backup-run');
let defaultersRows = [];

function renderChecklist() {
  const year = activeYearRecord();
  const active = studentRecords.filter((record) => record.data().status === 'active');
  const placed = year ? placementData.enrollments.filter((record) => record.data().yearId === year.id).length : 0;
  const steps = [
    ['An academic year is active', Boolean(year)],
    ['Classes are created', examData.classes.length > 0],
    ['Sections are created', placementData.sections.length > 0],
    ['Subjects are created', examData.subjects.length > 0],
    ['Students are added', active.length > 0],
    ['Students are placed in classes this year', Boolean(year) && placed > 0 && placed >= active.length],
    ['Teachers are added', staffRoster.length > 0],
    ['Fees are set for this year', Boolean(year) && feeData.structures.some((item) => item.data().yearId === year.id)],
    ['Timetable is filled', timetableData.length > 0],
    ['Exams are set up', examData.exams.length > 0],
  ];
  checklistList.replaceChildren();
  let done = 0;
  for (const [label, ok] of steps) {
    if (ok) done += 1;
    listItem(checklistList, (ok ? 'DONE - ' : 'TO DO - ') + label);
  }
  checklistSection.hidden = false;
  checklistStatus.textContent = done + ' of ' + steps.length + ' steps done.';
}

function feeDuesRows(classId) {
  const year = activeYearRecord();
  if (!year) return null;
  const rows = [];
  for (const record of placementData.enrollments.filter((item) => item.data().yearId === year.id
    && (!classId || item.data().classId === classId))) {
    const student = studentRecords.find((item) => item.id === record.data().studentId)?.data();
    if (!student || student.status !== 'active') continue;
    const summary = feeSummaryFor(record.data().studentId, year.id, record.data().classId);
    if (summary.balance > 0) rows.push({ student, classId: record.data().classId, ...summary });
  }
  return rows.sort((a, b) => b.balance - a.balance || a.student.name.localeCompare(b.student.name));
}

function renderDefaulterClasses() {
  const classes = [...examData.classes].sort(byClassOrder);
  const previous = defaultersClass.value;
  defaultersClass.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All classes';
  defaultersClass.append(all);
  for (const record of classes) {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = record.data().name;
    defaultersClass.append(option);
  }
  defaultersClass.value = previous;
  defaultersSection.hidden = false;
}

document.querySelector('#defaulters-run').addEventListener('click', () => {
  const rows = feeDuesRows(defaultersClass.value);
  defaultersList.replaceChildren();
  if (!rows) {
    defaultersStatus.textContent = 'Activate an academic year first.';
    defaultersRows = [];
    return;
  }
  defaultersRows = rows;
  for (const row of rows) {
    listItem(defaultersList, row.student.name + ' (' + row.student.admissionNo + ') - ' + nameOfClass(row.classId)
      + ' - due ' + rupees(row.due) + ', paid ' + rupees(row.paid) + ', balance ' + rupees(row.balance)
      + (row.student.guardianPhone ? ' - ' + row.student.guardianName + ' ' + row.student.guardianPhone : ''));
  }
  defaultersStatus.textContent = rows.length
    ? rows.length + ' students owe ' + rupees(rows.reduce((sum, row) => sum + row.balance, 0)) + ' in total.'
    : 'Nobody has dues here.';
});

document.querySelector('#defaulters-csv').addEventListener('click', () => {
  if (!defaultersRows.length) {
    defaultersStatus.textContent = 'Show the students with dues first.';
    return;
  }
  downloadCsv('fee-dues', [['Admission no', 'Name', 'Class', 'Guardian', 'Guardian phone', 'Due (Rs)', 'Paid (Rs)', 'Balance (Rs)'],
    ...defaultersRows.map((row) => [row.student.admissionNo, row.student.name, nameOfClass(row.classId), row.student.guardianName,
      row.student.guardianPhone, row.due, row.paid, row.balance])]);
});

function renderWorkload() {
  const byTeacher = new Map();
  for (const { data } of timetableData) {
    const name = (data.teacher ?? '').trim() || '(no teacher named)';
    const entry = byTeacher.get(name) ?? { periods: 0, days: new Map(), classes: new Set() };
    entry.periods += 1;
    entry.days.set(data.day, (entry.days.get(data.day) ?? 0) + 1);
    entry.classes.add(data.className);
    byTeacher.set(name, entry);
  }
  workloadList.replaceChildren();
  for (const [name, entry] of [...byTeacher].sort((a, b) => b[1].periods - a[1].periods || a[0].localeCompare(b[0]))) {
    listItem(workloadList, name + ' - ' + entry.periods + ' periods a week, busiest day ' + Math.max(...entry.days.values())
      + ' periods, ' + entry.classes.size + ' classes');
  }
  workloadSection.hidden = false;
  workloadStatus.textContent = byTeacher.size ? 'Counted from the timetable.' : 'The timetable is empty, so there is nothing to count yet.';
}

const BACKUP_COLLECTIONS = ['members', 'students', 'academicYears', 'classes', 'sections', 'subjects', 'classSubjects', 'enrollments',
  'rollKeys', 'exams', 'marks', 'attendance', 'staffAttendance', 'leaveRequests', 'feeStructures', 'payments', 'notices',
  'timetable', 'homework', 'calendar', 'books', 'loans', 'behaviour', 'visitors', 'substitutions', 'routes', 'transportRiders',
  'activities', 'activityMembers', 'inventory', 'alumni', 'expenses', 'certificates', 'tickets', 'staffDirectory', 'vendors', 'minutes', 'lostFound', 'concessions', 'achievements', 'complaints', 'assets', 'sales', 'syllabus', 'trainings', 'diary', 'healthRecords', 'lessonPlans', 'ptmSlots', 'payroll', 'messages',
  'enquiries', 'eventRegistrations', 'familyAccess', 'classTeachers', 'auditLog'];

backupRun.addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy) return;
  if (!confirm('Download a backup that contains private records? Keep the file safe.')) return;
  const request = schoolRequest;
  tools.busy = true;
  backupRun.disabled = true;
  const backup = { school: 'abcd-school', takenAt: new Date().toISOString(), collections: {}, notRead: [] };
  try {
    let done = 0;
    for (let start = 0; start < BACKUP_COLLECTIONS.length; start += 5) {
      const group = BACKUP_COLLECTIONS.slice(start, start + 5);
      const results = await Promise.allSettled(group.map((name) => tools.list(name)));
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') backup.collections[group[index]] = Object.fromEntries(result.value.docs.map((record) => [record.id, record.data()]));
        else backup.notRead.push(group[index]);
      });
      done += group.length;
      if (request === schoolRequest) backupStatus.textContent = 'Reading ' + done + ' of ' + BACKUP_COLLECTIONS.length + '.';
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'school-backup-' + localToday() + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await tools.log('bulk', 'backup', 'download', Object.keys(backup.collections).length + ' collections');
    if (request === schoolRequest) {
      backupStatus.textContent = 'Backup downloaded (' + Object.keys(backup.collections).length + ' lists).'
        + (backup.notRead.length ? ' Could not read: ' + backup.notRead.join(', ') + '.' : '');
    }
  } catch {
    if (request === schoolRequest) backupStatus.textContent = 'The backup did not finish. Try again.';
  } finally {
    tools.busy = false;
    backupRun.disabled = false;
  }
});

function renderInsights() {
  renderChecklist();
  renderDefaulterClasses();
  renderWorkload();
  backupSection.hidden = false;
}
const resetInsights = () => {
  for (const section of [checklistSection, defaultersSection, workloadSection, backupSection]) section.hidden = true;
  for (const list of [checklistList, defaultersList, workloadList]) list.replaceChildren();
  for (const status of [checklistStatus, defaultersStatus, workloadStatus, backupStatus]) status.textContent = '';
  defaultersRows = [];
};

async function loadOwnerLists(request) {
  for (const name of ['routes', 'riders', 'activities', 'members', 'substitutions', 'inventory', 'alumni', 'expenses', 'certificates', 'tickets', 'staffdir', 'vendors', 'minutes', 'lostfound', 'concessions', 'achievements', 'complaints', 'assets', 'sales', 'syllabus', 'trainings', 'diary', 'health', 'lessons', 'ptm', 'payroll', 'inbox', 'enquiries', 'eventregs']) {
    if (request !== schoolRequest) return;
    await lists[name].load(request);
  }
  if (request === schoolRequest) refreshAttention();
}
const refreshOwnerLists = () => { for (const api of ownerLists) if (!document.querySelector('#' + api.cfg.id).hidden) api.render(); };
const resetOwnerLists = () => {
  for (const api of ownerLists) api.reset();
  financeList.replaceChildren();
  financeStatus.textContent = '';
  attentionList.replaceChildren();
  attentionStatus.textContent = '';
  p360List.replaceChildren();
  p360Status.textContent = '';
  p360Student.replaceChildren(new Option('Choose a student', ''));
};

// Class promotion. Each student of the "from" year gets a placement in the "to" year through the same
// enrollment and roll-number records the placement screen writes, so every existing rule still applies.
const promotionSection = document.querySelector('#promotion');
const promotionStatus = document.querySelector('#promotion-status');
const promotionFrom = document.querySelector('#promotion-from');
const promotionTo = document.querySelector('#promotion-to');
const promotionMap = document.querySelector('#promotion-map');
const promotionRun = document.querySelector('#promotion-run');
const PROMOTION_PARALLEL = 10;
let promotionPlan = [];

function renderPromotionYears() {
  const years = [...examData.years].sort((a, b) => a.data().startDate.localeCompare(b.data().startDate));
  fillSelect(promotionFrom, years, (year) => year.label + ' (' + year.status + ')');
  fillSelect(promotionTo, years.filter((record) => ['draft', 'active'].includes(record.data().status)),
    (year) => year.label + ' (' + year.status + ')');
  promotionSection.hidden = false;
}

document.querySelector('#promotion-preview').addEventListener('click', () => {
  promotionMap.replaceChildren();
  promotionPlan = [];
  promotionRun.disabled = true;
  const from = promotionFrom.value;
  const to = promotionTo.value;
  if (!from || !to || from === to) {
    promotionStatus.textContent = 'Choose two different years. The "to" year must be a draft or active year.';
    return;
  }
  const classes = [...examData.classes].sort(byClassOrder);
  const counts = new Map();
  for (const record of placementData.enrollments) {
    if (record.data().yearId === from) counts.set(record.data().classId, (counts.get(record.data().classId) ?? 0) + 1);
  }
  if (!counts.size) {
    promotionStatus.textContent = 'No students are placed in the "from" year.';
    return;
  }
  for (const record of classes.filter((item) => counts.has(item.id))) {
    const index = classes.indexOf(record);
    const row = document.createElement('p');
    const label = document.createElement('label');
    label.textContent = record.data().name + ' (' + counts.get(record.id) + ' students) moves to ';
    const select = document.createElement('select');
    select.dataset.from = record.id;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Nobody - they leave or graduate';
    select.append(none);
    for (const target of classes) {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = target.data().name;
      select.append(option);
    }
    select.value = classes[index + 1]?.id ?? '';
    label.append(select);
    row.append(label);
    promotionMap.append(row);
  }
  promotionRun.disabled = false;
  promotionStatus.textContent = 'Check where each class goes, then click Promote students.';
});

promotionRun.addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy) return;
  const from = promotionFrom.value;
  const to = promotionTo.value;
  const target = new Map([...promotionMap.querySelectorAll('select')].map((select) => [select.dataset.from, select.value]));
  const active = new Set(studentRecords.filter((record) => record.data().status === 'active').map((record) => record.id));
  const sectionOf = (id) => placementData.sections.find((record) => record.id === id)?.data();
  const used = new Map();
  const taken = new Set();
  for (const record of placementData.enrollments) {
    const item = record.data();
    if (item.yearId !== to) continue;
    taken.add(item.studentId);
    if (!used.has(item.sectionId)) used.set(item.sectionId, new Set());
    used.get(item.sectionId).add(item.rollNo);
  }
  const movers = placementData.enrollments.map((record) => record.data())
    .filter((item) => item.yearId === from && target.get(item.classId) && active.has(item.studentId) && !taken.has(item.studentId))
    .sort((a, b) => (sectionOf(a.sectionId)?.name ?? '').localeCompare(sectionOf(b.sectionId)?.name ?? '') || a.rollNo - b.rollNo);
  const plan = [];
  let skipped = 0;
  for (const item of movers) {
    const classId = target.get(item.classId);
    const sections = placementData.sections.filter((record) => record.data().classId === classId)
      .sort((a, b) => a.data().name.localeCompare(b.data().name));
    const section = sections.find((record) => record.data().name === sectionOf(item.sectionId)?.name) ?? sections[0];
    if (!section) { skipped += 1; continue; }
    const rolls = used.get(section.id) ?? new Set();
    used.set(section.id, rolls);
    let rollNo = item.rollNo;
    while (rolls.has(rollNo) && rollNo < 999) rollNo += 1;
    if (rolls.has(rollNo)) {
      rollNo = 1;
      while (rolls.has(rollNo) && rollNo < 999) rollNo += 1;
    }
    if (rolls.has(rollNo)) { skipped += 1; continue; }
    rolls.add(rollNo);
    plan.push([
      { path: ['enrollments', to + '_' + item.studentId], data: { yearId: to, studentId: item.studentId, classId, sectionId: section.id, rollNo } },
      { path: ['rollKeys', to + '_' + section.id + '_' + rollNo], data: { yearId: to, sectionId: section.id, rollNo, studentId: item.studentId } },
    ]);
  }
  if (!plan.length) {
    promotionStatus.textContent = 'There is nobody to promote. Everyone may already be placed in the new year, or the new classes have no sections yet.'
      + (skipped ? ' (' + skipped + ' could not be placed.)' : '');
    return;
  }
  const yearName = (id) => examData.years.find((record) => record.id === id)?.data().label ?? id;
  if (!confirm('Promote ' + plan.length + ' students from ' + yearName(from) + ' to ' + yearName(to) + '?'
    + (skipped ? ' ' + skipped + ' cannot be placed and will be left out.' : ''))) return;
  const request = schoolRequest;
  tools.busy = true;
  promotionRun.disabled = true;
  let done = 0;
  try {
    for (let start = 0; start < plan.length; start += PROMOTION_PARALLEL) {
      promotionStatus.textContent = 'Promoting ' + (start + 1) + ' of ' + plan.length + '.';
      const results = await Promise.allSettled(plan.slice(start, start + PROMOTION_PARALLEL).map((ops) => tools.commit(ops, true)));
      done += results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    tools.busy = false;
    await tools.log('bulk', 'enrollments', 'promotion ' + from + ' to ' + to, done + ' students');
    promotionMap.replaceChildren();
    await loadAcademic(request);
    if (request === schoolRequest) promotionStatus.textContent = 'Promoted ' + done + ' students.' + (skipped ? ' ' + skipped + ' could not be placed.' : '');
  } catch {
    tools.busy = false;
    await tools.log('bulk', 'enrollments', 'promotion ' + from + ' to ' + to, done + ' students (stopped early)');
    if (request === schoolRequest) {
      promotionStatus.textContent = 'Promoted ' + done + ' of ' + plan.length + ' before an error. Click Show classes and run it again; students already moved are skipped.';
    }
  } finally {
    tools.busy = false;
  }
});

// Teacher side: cover duties and lesson plans.
const teacherCoverSection = document.querySelector('#teacher-cover');
const teacherCoverStatus = document.querySelector('#teacher-cover-status');
const teacherCoverList = document.querySelector('#teacher-cover-list');
const teacherLessonsSection = document.querySelector('#teacher-lessons');
const teacherLessonsStatus = document.querySelector('#teacher-lessons-status');
const teacherLessonsList = document.querySelector('#teacher-lessons-list');
const lessonForm = document.querySelector('#lesson-form');

async function loadTeacherCover(request, schoolRef, uid) {
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  teacherCoverSection.hidden = false;
  teacherCoverStatus.textContent = 'Loading cover duties.';
  try {
    const saved = await getDocsFromServer(query(collection(schoolRef, 'substitutions'), where('substituteUid', '==', uid)));
    if (request !== schoolRequest) return;
    const today = localToday();
    const upcoming = saved.docs.map((record) => record.data()).filter((item) => item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
    teacherCoverList.replaceChildren();
    for (const item of upcoming) {
      listItem(teacherCoverList, item.date + ' - ' + item.className + ' period ' + item.period
        + (item.absentTeacher ? ' - covering ' + item.absentTeacher : '') + (item.note ? ' (' + item.note + ')' : ''));
    }
    teacherCoverStatus.textContent = upcoming.length ? '' : 'You have no cover duties coming up.';
  } catch {
    if (request === schoolRequest) teacherCoverStatus.textContent = 'Could not load cover duties. Try again.';
  }
}

async function loadTeacherLessons(request) {
  const context = teacherHomework;
  if (!context) return;
  const { collection, query, where, getDocsFromServer, doc, deleteDoc } = firestoreTools;
  teacherLessonsSection.hidden = false;
  teacherLessonsStatus.textContent = 'Loading lesson plans.';
  try {
    const saved = await getDocsFromServer(query(collection(context.schoolRef, 'lessonPlans'), where('createdBy', '==', context.uid)));
    if (request !== schoolRequest || context !== teacherHomework) return;
    teacherLessonsList.replaceChildren();
    for (const record of saved.docs.sort((a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id))) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', async () => {
        if (context.busy || !confirm('Remove this lesson plan?')) return;
        context.busy = true;
        try {
          await deleteDoc(doc(context.schoolRef, 'lessonPlans', record.id));
        } catch {
          teacherLessonsStatus.textContent = 'Could not remove the lesson plan. Try again.';
        } finally {
          context.busy = false;
        }
        await loadTeacherLessons(request);
      });
      const item = record.data();
      listItem(teacherLessonsList, item.date + ' - ' + item.topic + ': ' + item.objectives, button);
    }
    teacherLessonsStatus.textContent = saved.docs.length ? '' : 'No lesson plans yet.';
  } catch {
    if (request === schoolRequest) teacherLessonsStatus.textContent = 'Could not load lesson plans. Try again.';
  }
}

lessonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherHomework;
  if (!context || context.busy) return;
  const fields = new FormData(lessonForm);
  const date = text(fields, 'date');
  const topic = text(fields, 'topic');
  const objectives = text(fields, 'objectives');
  if (!DATE_TEXT.test(date) || !topic || !objectives) {
    teacherLessonsStatus.textContent = 'Enter the date, the topic and the objectives.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  teacherLessonsStatus.textContent = 'Saving.';
  try {
    await setDoc(doc(context.schoolRef, 'lessonPlans', newId('LP')), {
      classId: context.classId, subjectId: context.subjectId, subject: context.subject,
      date, topic, objectives, createdAt: localToday(), createdBy: context.uid,
    });
    context.busy = false;
    lessonForm.reset();
    await loadTeacherLessons(request);
    if (request === schoolRequest) teacherLessonsStatus.textContent = 'Lesson plan saved.';
  } catch {
    if (request === schoolRequest) teacherLessonsStatus.textContent = 'Could not save the lesson plan. Check the details and try again.';
  } finally {
    context.busy = false;
  }
});

// Student and parent page: the child's bus route and activities.
const portalLifeSection = document.querySelector('#portal-life');
const portalLifeStatus = document.querySelector('#portal-life-status');
const portalLifeList = document.querySelector('#portal-life-list');

async function loadPortalLife(tools, request, studentId) {
  const { schoolRef, collection, doc, getDocFromServer, getDocsFromServer, query, where } = tools;
  portalLifeSection.hidden = false;
  portalLifeStatus.textContent = 'Loading.';
  try {
    const [riders, members] = await Promise.all([
      getDocsFromServer(query(collection(schoolRef, 'transportRiders'), where('studentId', '==', studentId))),
      getDocsFromServer(query(collection(schoolRef, 'activityMembers'), where('studentId', '==', studentId)))]);
    const lines = [];
    for (const rider of riders.docs) {
      const route = await getDocFromServer(doc(schoolRef, 'routes', rider.data().routeId));
      const data = route.exists() ? route.data() : {};
      lines.push('Bus: ' + (data.name ?? rider.data().routeId) + (rider.data().stop ? ' - stop ' + rider.data().stop : '')
        + (data.vehicle ? ' - vehicle ' + data.vehicle : '') + (data.driver ? ' - driver ' + data.driver : '')
        + (data.driverPhone ? ' (' + data.driverPhone + ')' : ''));
    }
    for (const member of members.docs) {
      const activity = await getDocFromServer(doc(schoolRef, 'activities', member.data().activityId));
      const data = activity.exists() ? activity.data() : {};
      lines.push('Activity: ' + (data.name ?? member.data().activityId) + (data.schedule ? ' - ' + data.schedule : '')
        + (data.teacher ? ' - ' + data.teacher : ''));
    }
    if (request !== schoolRequest) return;
    portalLifeList.replaceChildren();
    for (const line of lines) listItem(portalLifeList, line);
    portalLifeStatus.textContent = lines.length ? '' : 'No bus route or activities are recorded yet.';
  } catch {
    if (request === schoolRequest) portalLifeStatus.textContent = 'Could not load this information. Try again.';
  }
}

// Student and parent page: meetings for the student's class, and messages to the school.
const portalPtmSection = document.querySelector('#portal-ptm');
const portalPtmStatus = document.querySelector('#portal-ptm-status');
const portalPtmList = document.querySelector('#portal-ptm-list');
const portalMessagesSection = document.querySelector('#portal-messages');
const portalMessagesStatus = document.querySelector('#portal-messages-status');
const portalMessagesList = document.querySelector('#portal-messages-list');
const messageForm = document.querySelector('#message-form');
let portalMessaging; // { tools, studentId, uid, busy }

async function loadPortalCommunity(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalMessaging = { tools, studentId, uid: tools.user.uid, busy: false };
  portalPtmSection.hidden = false;
  portalMessagesSection.hidden = false;
  portalPtmStatus.textContent = 'Loading.';
  portalMessagesStatus.textContent = 'Loading.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const meetings = latest ? await getDocsFromServer(query(collection(schoolRef, 'ptmSlots'), where('classId', '==', latest.classId))) : { docs: [] };
    const today = localToday();
    const upcoming = meetings.docs.map((record) => record.data()).filter((item) => item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    if (request !== schoolRequest) return;
    portalPtmList.replaceChildren();
    for (const item of upcoming) {
      listItem(portalPtmList, item.date + ' ' + item.time + (item.teacher ? ' - ' + item.teacher : '')
        + (item.place ? ' - ' + item.place : '') + (item.note ? ' (' + item.note + ')' : ''));
    }
    portalPtmStatus.textContent = upcoming.length ? '' : 'No meetings are scheduled for your class.';
  } catch {
    if (request === schoolRequest) portalPtmStatus.textContent = 'Could not load meetings. Try again.';
  }
  await loadPortalMessages(request);
}

async function loadPortalMessages(request) {
  const context = portalMessaging;
  if (!context) return;
  const { schoolRef, collection, getDocsFromServer, query, where } = context.tools;
  try {
    const saved = await getDocsFromServer(query(collection(schoolRef, 'messages'), where('createdBy', '==', context.uid)));
    if (request !== schoolRequest || context !== portalMessaging) return;
    portalMessagesList.replaceChildren();
    for (const record of saved.docs.sort((a, b) => b.data().createdAt.localeCompare(a.data().createdAt) || b.id.localeCompare(a.id))) {
      const item = record.data();
      listItem(portalMessagesList, item.createdAt + ' - ' + item.subject + ': ' + item.body
        + (item.reply ? ' | School replied (' + item.repliedAt + '): ' + item.reply : ' | Waiting for a reply'));
    }
    portalMessagesStatus.textContent = saved.docs.length ? '' : 'You have not sent any messages yet.';
  } catch {
    if (request === schoolRequest) portalMessagesStatus.textContent = 'Could not load messages. Try again.';
  }
}

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = portalMessaging;
  if (!context || context.busy) return;
  const fields = new FormData(messageForm);
  const subject = text(fields, 'subject');
  const body = text(fields, 'body');
  if (!subject || !body) {
    portalMessagesStatus.textContent = 'Enter a subject and a message.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  portalMessagesStatus.textContent = 'Sending.';
  try {
    await setDoc(doc(context.tools.schoolRef, 'messages', newId('MS')), {
      studentId: context.studentId, subject, body, createdAt: localToday(), createdBy: context.uid,
    });
    context.busy = false;
    messageForm.reset();
    await loadPortalMessages(request);
    if (request === schoolRequest) portalMessagesStatus.textContent = 'Message sent. The school will reply here.';
  } catch {
    if (request === schoolRequest) portalMessagesStatus.textContent = 'Could not send the message. Try again.';
  } finally {
    context.busy = false;
  }
});

// Teacher side: homework submissions with feedback, and class tests (continuous assessment).
const teacherSubmissionsSection = document.querySelector('#teacher-submissions');
const teacherSubmissionsStatus = document.querySelector('#teacher-submissions-status');
const teacherSubmissionsList = document.querySelector('#teacher-submissions-list');
const teacherAssessmentsSection = document.querySelector('#teacher-assessments');
const teacherAssessmentsStatus = document.querySelector('#teacher-assessments-status');
const assessmentForm = document.querySelector('#assessment-form');
const assessmentSelect = document.querySelector('#assessment-select');
const assessmentRemove = document.querySelector('#assessment-remove');
const assessmentScoresForm = document.querySelector('#assessment-scores');
const assessmentBody = document.querySelector('#assessment-body');
let teacherAssessments = []; // records of this teacher's class and subject
let assessmentRoster = []; // { studentId, sectionName, rollNo, yearId }

async function loadTeacherSubmissions(request) {
  const context = teacherHomework;
  if (!context) return;
  const { collection, query, where, getDocsFromServer, doc, setDoc } = firestoreTools;
  teacherSubmissionsSection.hidden = false;
  teacherSubmissionsStatus.textContent = 'Loading submissions.';
  try {
    const saved = await getDocsFromServer(query(collection(context.schoolRef, 'submissions'), where('classId', '==', context.classId)));
    if (request !== schoolRequest || context !== teacherHomework) return;
    teacherSubmissionsList.replaceChildren();
    for (const record of saved.docs.sort((a, b) => b.data().submittedOn.localeCompare(a.data().submittedOn) || a.id.localeCompare(b.id))) {
      const item = record.data();
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.feedback ? 'Change feedback' : 'Give feedback';
      button.addEventListener('click', async () => {
        const feedback = (prompt('Feedback for ' + item.studentName + ':', item.feedback ?? '') ?? '').trim();
        if (!feedback || feedback.length > 500 || context.busy) return;
        context.busy = true;
        try {
          await setDoc(doc(context.schoolRef, 'submissions', record.id), { ...item, feedback, feedbackAt: localToday() });
        } catch {
          teacherSubmissionsStatus.textContent = 'Could not save the feedback. Try again.';
        } finally {
          context.busy = false;
        }
        await loadTeacherSubmissions(request);
      });
      listItem(teacherSubmissionsList, item.submittedOn + ' - ' + item.studentName + ' - ' + item.homeworkTitle + ': ' + item.answer
        + (item.feedback ? ' | Your feedback: ' + item.feedback : ' | No feedback yet'), button);
    }
    teacherSubmissionsStatus.textContent = saved.docs.length ? '' : 'No homework has been submitted yet.';
  } catch {
    if (request === schoolRequest) teacherSubmissionsStatus.textContent = 'Could not load submissions. Try again.';
  }
}

async function loadTeacherAssessments(request) {
  const context = teacherHomework;
  if (!context) return;
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  teacherAssessmentsSection.hidden = false;
  teacherAssessmentsStatus.textContent = 'Loading.';
  try {
    const [saved, placements, sections] = await Promise.all([
      getDocsFromServer(query(collection(context.schoolRef, 'assessments'),
        where('classId', '==', context.classId), where('subjectId', '==', context.subjectId))),
      getDocsFromServer(query(collection(context.schoolRef, 'enrollments'), where('classId', '==', context.classId))),
      getDocsFromServer(query(collection(context.schoolRef, 'sections'), where('classId', '==', context.classId)))]);
    if (request !== schoolRequest || context !== teacherHomework) return;
    teacherAssessments = saved.docs.sort((a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id));
    const rows = placements.docs.map((record) => record.data());
    const latest = rows.map((item) => item.yearId).sort().at(-1);
    const sectionName = (id) => sections.docs.find((record) => record.id === id)?.data().name ?? id;
    assessmentRoster = rows.filter((item) => item.yearId === latest)
      .map((item) => ({ studentId: item.studentId, sectionName: sectionName(item.sectionId), rollNo: item.rollNo, yearId: item.yearId }))
      .sort((a, b) => a.sectionName.localeCompare(b.sectionName) || a.rollNo - b.rollNo);
    fillSelect(assessmentSelect, teacherAssessments, (item) => item.title + ' (' + item.date + ', out of ' + item.maxMarks + ')');
    teacherAssessmentsStatus.textContent = teacherAssessments.length ? '' : 'No class tests yet. Add one above.';
    await renderAssessmentScores(request);
  } catch {
    if (request === schoolRequest) teacherAssessmentsStatus.textContent = 'Could not load class tests. Try again.';
  }
}

async function renderAssessmentScores(request) {
  const context = teacherHomework;
  const record = teacherAssessments.find((item) => item.id === assessmentSelect.value);
  assessmentBody.replaceChildren();
  assessmentScoresForm.querySelector('button').disabled = !record;
  assessmentRemove.disabled = !record;
  if (!record || !context) return;
  const { collection, query, where, getDocsFromServer } = firestoreTools;
  try {
    const saved = await getDocsFromServer(query(collection(context.schoolRef, 'assessmentScores'),
      where('assessmentId', '==', record.id), where('classId', '==', context.classId)));
    if (request !== schoolRequest || context !== teacherHomework || record.id !== assessmentSelect.value) return;
    const scores = new Map(saved.docs.map((item) => [item.data().studentId, item.data().score]));
    for (const row of assessmentRoster) {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(record.data().maxMarks);
      input.step = '1';
      input.dataset.student = row.studentId;
      input.dataset.original = scores.has(row.studentId) ? String(scores.get(row.studentId)) : '';
      input.value = input.dataset.original;
      input.setAttribute('aria-label', 'Marks for ' + row.sectionName + ' roll ' + row.rollNo);
      const tr = document.createElement('tr');
      for (const content of [row.sectionName, String(row.rollNo), input]) {
        const td = document.createElement('td');
        td.append(content);
        tr.append(td);
      }
      assessmentBody.append(tr);
    }
    if (!assessmentRoster.length) teacherAssessmentsStatus.textContent = 'No students have been placed in your class yet.';
  } catch {
    if (request === schoolRequest) teacherAssessmentsStatus.textContent = 'Could not load the scores. Try again.';
  }
}

assessmentSelect.addEventListener('change', () => renderAssessmentScores(schoolRequest));

assessmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherHomework;
  if (!context || context.busy) return;
  const fields = new FormData(assessmentForm);
  const title = text(fields, 'title');
  const date = text(fields, 'date');
  const maxMarks = wholeNumber(fields, 'maxMarks');
  if (!title || !DATE_TEXT.test(date) || !(maxMarks >= 1 && maxMarks <= 1000)) {
    teacherAssessmentsStatus.textContent = 'Enter the title, the date and the maximum marks (1 to 1000).';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  try {
    await setDoc(doc(context.schoolRef, 'assessments', newId('AS')), {
      classId: context.classId, subjectId: context.subjectId, subject: context.subject, title, date, maxMarks, createdBy: context.uid,
    });
    context.busy = false;
    assessmentForm.reset();
    await loadTeacherAssessments(request);
    if (request === schoolRequest) teacherAssessmentsStatus.textContent = 'Class test added. Enter the scores below.';
  } catch {
    if (request === schoolRequest) teacherAssessmentsStatus.textContent = 'Could not add the class test. Check the details and try again.';
  } finally {
    context.busy = false;
  }
});

assessmentRemove.addEventListener('click', async () => {
  const context = teacherHomework;
  const record = teacherAssessments.find((item) => item.id === assessmentSelect.value);
  if (!context || !record || context.busy || !confirm('Remove "' + record.data().title + '" and all its scores?')) return;
  const { collection, query, where, getDocsFromServer, doc, deleteDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  try {
    const scores = await getDocsFromServer(query(collection(context.schoolRef, 'assessmentScores'),
      where('assessmentId', '==', record.id), where('classId', '==', context.classId)));
    await Promise.all(scores.docs.map((item) => deleteDoc(doc(context.schoolRef, 'assessmentScores', item.id))));
    await deleteDoc(doc(context.schoolRef, 'assessments', record.id));
    context.busy = false;
    await loadTeacherAssessments(request);
    if (request === schoolRequest) teacherAssessmentsStatus.textContent = 'Class test removed.';
  } catch {
    if (request === schoolRequest) teacherAssessmentsStatus.textContent = 'Could not remove it. Try again.';
  } finally {
    context.busy = false;
  }
});

assessmentScoresForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherHomework;
  const record = teacherAssessments.find((item) => item.id === assessmentSelect.value);
  if (!context || !record || context.busy) return;
  const assessment = record.data();
  const writes = [];
  for (const input of assessmentBody.querySelectorAll('input')) {
    if (input.value === input.dataset.original || input.value === '') continue;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > assessment.maxMarks) {
      teacherAssessmentsStatus.textContent = 'Marks must be whole numbers from 0 to ' + assessment.maxMarks + '.';
      return;
    }
    const row = assessmentRoster.find((item) => item.studentId === input.dataset.student);
    writes.push({ studentId: row.studentId, yearId: row.yearId, score: value });
  }
  if (!writes.length) {
    teacherAssessmentsStatus.textContent = 'Nothing has changed.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  let saved = 0;
  try {
    for (let start = 0; start < writes.length; start += 10) {
      const results = await Promise.allSettled(writes.slice(start, start + 10).map((item) => setDoc(
        doc(context.schoolRef, 'assessmentScores', record.id + '_' + item.studentId), {
          assessmentId: record.id, assessmentTitle: assessment.title, subject: assessment.subject, subjectId: assessment.subjectId,
          date: assessment.date, studentId: item.studentId, classId: context.classId, yearId: item.yearId, score: item.score,
          maxMarks: assessment.maxMarks, createdBy: context.uid })));
      saved += results.filter((result) => result.status === 'fulfilled').length;
    }
    context.busy = false;
    await renderAssessmentScores(request);
    if (request === schoolRequest) {
      teacherAssessmentsStatus.textContent = saved === writes.length ? 'Saved ' + saved + ' scores.'
        : 'Saved ' + saved + ' of ' + writes.length + ' scores. Try saving again.';
    }
  } finally {
    context.busy = false;
  }
});

// Student and parent page: submit homework, and see class test scores.
const portalSubmitSection = document.querySelector('#portal-submit');
const portalSubmitStatus = document.querySelector('#portal-submit-status');
const portalSubmitList = document.querySelector('#portal-submit-list');
const portalAssessmentsSection = document.querySelector('#portal-assessments');
const portalAssessmentsStatus = document.querySelector('#portal-assessments-status');
const portalAssessmentsList = document.querySelector('#portal-assessments-list');

async function loadPortalCoursework(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, getDocFromServer, doc, query, where } = tools;
  const { setDoc } = firestoreTools;
  portalSubmitSection.hidden = false;
  portalAssessmentsSection.hidden = false;
  portalSubmitStatus.textContent = 'Loading homework.';
  portalAssessmentsStatus.textContent = 'Loading scores.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const [work, submitted, scores, student] = await Promise.all([
      latest ? getDocsFromServer(query(collection(schoolRef, 'homework'), where('classId', '==', latest.classId))) : { docs: [] },
      getDocsFromServer(query(collection(schoolRef, 'submissions'), where('studentId', '==', studentId))),
      getDocsFromServer(query(collection(schoolRef, 'assessmentScores'), where('studentId', '==', studentId))),
      getDocFromServer(doc(schoolRef, 'students', studentId))]);
    if (request !== schoolRequest) return;
    const mine = new Map(submitted.docs.map((record) => [record.data().homeworkId, record.data()]));
    const studentName = student.exists() ? student.data().name : studentId;
    portalSubmitList.replaceChildren();
    let busy = false;
    for (const record of work.docs.sort((a, b) => dueFirst(a.data(), b.data()))) {
      const item = record.data();
      const done = mine.get(record.id);
      let button;
      if (!done) {
        button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Submit answer';
        button.addEventListener('click', async () => {
          const answer = (prompt('Your answer for "' + item.title + '" (you can submit only once):') ?? '').trim();
          if (!answer || answer.length > 2000 || busy) return;
          busy = true;
          try {
            await setDoc(doc(schoolRef, 'submissions', record.id + '_' + studentId), {
              homeworkId: record.id, homeworkTitle: item.title, studentId, studentName, classId: item.classId,
              answer, submittedOn: localToday(), createdBy: tools.user.uid });
          } catch {
            portalSubmitStatus.textContent = 'Could not submit. Try again.';
            busy = false;
            return;
          }
          busy = false;
          await loadPortalCoursework(tools, request, studentId);
        });
      }
      listItem(portalSubmitList, homeworkText(item) + (done ? ' | SUBMITTED ' + done.submittedOn
        + (done.feedback ? ' | Teacher feedback: ' + done.feedback : ' | Waiting for feedback') : ''), button);
    }
    portalSubmitStatus.textContent = work.docs.length ? '' : 'No homework yet.';
    portalAssessmentsList.replaceChildren();
    for (const record of scores.docs.sort((a, b) => b.data().date.localeCompare(a.data().date) || a.id.localeCompare(b.id))) {
      const item = record.data();
      listItem(portalAssessmentsList, item.date + ' - ' + item.subject + ': ' + item.assessmentTitle + ' - ' + item.score + ' out of ' + item.maxMarks);
    }
    portalAssessmentsStatus.textContent = scores.docs.length ? '' : 'No class test scores yet.';
  } catch {
    if (request === schoolRequest) {
      portalSubmitStatus.textContent = 'Could not load homework. Try again.';
      portalAssessmentsStatus.textContent = 'Could not load scores. Try again.';
    }
  }
}

// Teachers' saves are logged as one summary entry each (who, which exam or class day, how many).
// The log never blocks the save itself: if the entry cannot be written, the save still stands.
function writeAudit(schoolRef, uid, action, target, docId, detail) {
  const { doc, setDoc } = firestoreTools;
  return setDoc(
    doc(schoolRef, 'auditLog', 'L-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()),
    { actor: uid, action, target, docId: String(docId), at: new Date().toISOString(), detail: String(detail) },
  ).catch(() => {});
}

onAuthStateChanged(auth, async (user) => {
  const request = ++schoolRequest;
  teacherMarks = undefined;
  teacherAttendance = undefined;
  attToken += 1;
  attMarkSection.hidden = true;
  attMarkStatus.textContent = '';
  attBody.replaceChildren();
  attCounts.textContent = '';
  attClass.replaceChildren();
  attDate.value = '';
  attPrev = { classId: '', date: '' };
  summarySection.hidden = true;
  summaryStatus.textContent = '';
  summaryList.replaceChildren();
  performanceStatus.textContent = '';
  performanceBody.replaceChildren();
  timetableSection.hidden = true;
  timetableStatus.textContent = '';
  timetableList.replaceChildren();
  timetableData = [];
  ownerHomeworkSection.hidden = true;
  ownerHomeworkStatus.textContent = '';
  ownerHomeworkList.replaceChildren();
  teacherHomework = undefined;
  teacherHomeworkSection.hidden = true;
  teacherHomeworkStatus.textContent = '';
  teacherHomeworkList.replaceChildren();
  homeworkForm.reset();
  teacherTimetableSection.hidden = true;
  teacherTimetableStatus.textContent = '';
  teacherTimetableList.replaceChildren();
  portalHomeworkSection.hidden = true;
  portalHomeworkStatus.textContent = '';
  portalHomeworkList.replaceChildren();
  portalTimetableSection.hidden = true;
  portalTimetableStatus.textContent = '';
  portalTimetableList.replaceChildren();
  calendarSection.hidden = true;
  calendarStatus.textContent = '';
  calendarList.replaceChildren();
  cardsSection.hidden = true;
  cardsStatus.textContent = '';
  cardSheet.hidden = true;
  teacherCalendarSection.hidden = true;
  teacherCalendarStatus.textContent = '';
  teacherCalendarList.replaceChildren();
  portalCalendarSection.hidden = true;
  portalCalendarStatus.textContent = '';
  portalCalendarList.replaceChildren();
  attrepSection.hidden = true;
  attrepStatus.textContent = '';
  attrepBody.replaceChildren();
  attrepRows = [];
  importSection.hidden = true;
  importStatus.textContent = '';
  importText.value = '';
  importBody.replaceChildren();
  importReady = [];
  librarySection.hidden = true;
  libraryStatus.textContent = '';
  bookList.replaceChildren();
  loanList.replaceChildren();
  libBooks = [];
  libLoans = [];
  visitorsSection.hidden = true;
  visitorsStatus.textContent = '';
  visitorList.replaceChildren();
  visitorData = [];
  behaviourSection.hidden = true;
  behaviourStatus.textContent = '';
  behaviourList.replaceChildren();
  behaviourData = [];
  resetOwnerLists();
  promotionSection.hidden = true;
  promotionStatus.textContent = '';
  promotionMap.replaceChildren();
  promotionPlan = [];
  teacherCoverSection.hidden = true;
  teacherCoverStatus.textContent = '';
  teacherCoverList.replaceChildren();
  teacherLessonsSection.hidden = true;
  teacherLessonsStatus.textContent = '';
  teacherLessonsList.replaceChildren();
  lessonForm.reset();
  portalLifeSection.hidden = true;
  portalLifeStatus.textContent = '';
  portalLifeList.replaceChildren();
  portalPtmSection.hidden = true;
  portalPtmStatus.textContent = '';
  portalPtmList.replaceChildren();
  portalMessagesSection.hidden = true;
  portalMessagesStatus.textContent = '';
  portalMessagesList.replaceChildren();
  messageForm.reset();
  portalMessaging = undefined;
  portalChoice = '';
  portalTools = undefined;
  viewOnly = false;
  viewOnlyNote.hidden = true;
  portalChildWrap.hidden = true;
  portalChild.replaceChildren();
  portalEventsSection.hidden = true;
  portalEventsStatus.textContent = '';
  portalEventsList.replaceChildren();
  portalSubmitSection.hidden = true;
  portalSubmitStatus.textContent = '';
  portalSubmitList.replaceChildren();
  portalAssessmentsSection.hidden = true;
  portalAssessmentsStatus.textContent = '';
  portalAssessmentsList.replaceChildren();
  teacherSubmissionsSection.hidden = true;
  teacherSubmissionsStatus.textContent = '';
  teacherSubmissionsList.replaceChildren();
  teacherAssessmentsSection.hidden = true;
  teacherAssessmentsStatus.textContent = '';
  assessmentBody.replaceChildren();
  assessmentForm.reset();
  teacherAssessments = [];
  assessmentRoster = [];
  websiteSection.hidden = true;
  websiteStatus.textContent = '';
  websiteForm.reset();
  resetInsights();
  gradingSection.hidden = true;
  gradingStatus.textContent = '';
  grading = { ...DEFAULT_GRADING };
  auditSection.hidden = true;
  auditStatus.textContent = '';
  auditList.replaceChildren();
  noticesSection.hidden = true;
  noticesStatus.textContent = '';
  noticeForm.reset();
  noticeForm.elements.namedItem('classId').replaceChildren();
  noticeList.replaceChildren();
  noticeData = [];
  noticeAssignedClass = '';
  teacherNoticesSection.hidden = true;
  teacherNoticesStatus.textContent = '';
  teacherNoticesList.replaceChildren();
  portalNoticesSection.hidden = true;
  portalNoticesStatus.textContent = '';
  portalNoticesList.replaceChildren();
  feesSection.hidden = true;
  feesStatus.textContent = '';
  feeStructureList.replaceChildren();
  feeStructureForm.reset();
  feeStructureForm.elements.namedItem('classId').replaceChildren();
  paymentForm.reset();
  paymentForm.elements.namedItem('studentId').replaceChildren();
  feeBalanceStudent.replaceChildren();
  feeBalanceSummary.textContent = '';
  feeBalanceBody.replaceChildren();
  feeData = { structures: [], payments: [] };
  portalFeesSection.hidden = true;
  portalFeesStatus.textContent = '';
  portalFeesSummary.replaceChildren();
  portalFeesBody.replaceChildren();
  schoolUid = '';
  leaveReviewSection.hidden = true;
  leaveReviewStatus.textContent = '';
  leaveReviewBody.replaceChildren();
  leaveReviewToken += 1;
  leaveRequestSection.hidden = true;
  leaveRequestStatus.textContent = '';
  leaveRequestForm.reset();
  leaveRequestBody.replaceChildren();
  leaveSend.disabled = false;
  myLeave = undefined;
  staffAttSection.hidden = true;
  staffAttStatus.textContent = '';
  staffAttBody.replaceChildren();
  staffAttCounts.textContent = '';
  staffAttDate.value = '';
  staffReportStatus.textContent = '';
  staffReportBody.replaceChildren();
  staffReportMonth.value = '';
  staffRoster = [];
  staffAttToken += 1;
  staffReportToken += 1;
  myAttSection.hidden = true;
  myAttStatus.textContent = '';
  myAttTotal.textContent = '';
  myAttBody.replaceChildren();
  myAttMonth.value = '';
  myAttMarks = [];
  classTeacherSection.hidden = true;
  classTeacherStatus.textContent = '';
  classTeacherList.replaceChildren();
  classTeacherForm.reset();
  classTeacherForm.elements.namedItem('classId').replaceChildren();
  classTeacherData = [];
  attReviewSection.hidden = true;
  attReviewStatus.textContent = '';
  attReviewBody.replaceChildren();
  attDetailBody.replaceChildren();
  attReviewClass.replaceChildren();
  attReviewDate.value = '';
  attReviewState = undefined;
  attReviewToken += 1;
  examMarksSection.hidden = true;
  examMarksStatus.textContent = '';
  examMarksBody.replaceChildren();
  examMarksSelect.replaceChildren();
  assignmentForm.elements.namedItem('mappingId').replaceChildren();
  dashboard.hidden = true;
  saveAssignment = undefined;
  saveMark = undefined;
  marksForm.hidden = true;
  marksForm.reset();
  marksButton.disabled = false;
  marksStatus.textContent = '';
  assignmentForm.reset();
  assignmentStatus.textContent = '';
  assignmentSummary.textContent = '';
  assignmentButton.disabled = false;
  teacherDashboard.hidden = true;
  teacherEmail.textContent = '';
  placementData = { years: [], classes: [], sections: [], enrollments: [] };
  placementStatus.textContent = '';
  placementList.replaceChildren();
  placementForm.reset();
  for (const name of ['yearId', 'studentId', 'sectionId']) placementForm.elements.namedItem(name).replaceChildren();
  examData = { years: [], classes: [], subjects: [], mappings: [], exams: [] };
  examSection.hidden = true;
  reviewSection.hidden = true;
  reportSection.hidden = true;
  linkSection.hidden = true;
  linkStatus.textContent = '';
  linkList.replaceChildren();
  linkForm.reset();
  linkForm.elements.namedItem('studentId').replaceChildren();
  portalDashboard.hidden = true;
  portalAttSection.hidden = true;
  portalAttStatus.textContent = '';
  portalAttTotal.textContent = '';
  portalAttBody.replaceChildren();
  portalAttMonth.value = '';
  portalAttMarks = [];
  portalStatus.textContent = '';
  portalEmail.textContent = '';
  portalStudent.textContent = '';
  portalBody.replaceChildren();
  portalTotal.textContent = '';
  reportStatus.textContent = '';
  reportTotal.textContent = '';
  reportBody.replaceChildren();
  reportStudent.replaceChildren();
  reviewStatus.textContent = '';
  reviewSummary.textContent = '';
  reviewBody.replaceChildren();
  reviewExam.replaceChildren();
  examStatus.textContent = '';
  examList.replaceChildren();
  examForm.reset();
  for (const name of ['yearId', 'mappingId']) examForm.elements.namedItem(name).replaceChildren();
  studentRecords = [];
  studentSection.hidden = true;
  studentStatus.textContent = '';
  studentSearch.value = '';
  studentList.replaceChildren();
  studentForm.reset();
  academic = undefined;
  academicSection.hidden = true;
  academicStatus.textContent = '';
  for (const list of Object.values(setupLists)) list.replaceChildren();
  for (const form of [yearForm, classForm, sectionForm, subjectForm, mappingForm]) form.reset();
  for (const select of [sectionForm.elements.namedItem('classId'), mappingForm.elements.namedItem('classId'),
    mappingForm.elements.namedItem('subjectId')]) select.replaceChildren();
  staffDirectory = undefined;
  staffForm.reset();
  staffForm.hidden = true;
  staffSave.disabled = staffCancel.disabled = false;
  staffList.replaceChildren();
  staffStatus.textContent = '';
  saveSchoolProfile = undefined;
  profileForm.reset();
  profileStatus.textContent = '';
  saveProfile.disabled = false;
  schoolName.textContent = '';
  ownerEmail.textContent = '';
  status.hidden = false;
  form.hidden = Boolean(user);
  signOutButton.hidden = !user;
  status.textContent = user ? 'Signed in as ' + user.email : 'Sign in with your AZIZ account.';
  schoolStatus.hidden = !user;
  schoolStatus.textContent = '';
  if (!user) return;

  schoolStatus.textContent = 'Checking school access.';
  try {
    const { addDoc, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, getFirestore, query, setDoc, updateDoc, where, writeBatch } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    if (request !== schoolRequest) return;
    firestoreTools = { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, query, setDoc, where };
    const schoolRef = doc(getFirestore(app), 'schools', 'abcd-school');
    const membership = await getDocFromServer(doc(schoolRef, 'members', user.uid));
    if (request !== schoolRequest) return;
    if (membership.data()?.active === true && membership.data().role === 'teacher') {
      teacherEmail.textContent = user.email;
      teacherDashboard.hidden = false;
      status.hidden = true;
      schoolStatus.hidden = true;
      assignmentSummary.textContent = 'Loading assignment.';
      try {
        const assignment = await getDocFromServer(doc(schoolRef, 'teacherAssignments', user.uid));
        if (request !== schoolRequest) return;
        assignmentSummary.textContent = assignment.exists()
          ? assignment.data().className + ' - ' + assignment.data().subject
          : 'No class or subject assigned yet.';
        if (assignment.exists()) {
          const { className, subject, classId, subjectId } = assignment.data();
          noticeAssignedClass = classId ?? '';
          teacherHomework = classId && subjectId ? { schoolRef, uid: user.uid, classId, subjectId, subject, busy: false } : undefined;
          if (classId && subjectId) {
            teacherMarks = { schoolRef, uid: user.uid, classId, subjectId, exams: [], busy: false };
            examMarksSection.hidden = false;
            examMarksStatus.textContent = 'Loading exams.';
            await loadTeacherExams(request);
          } else {
            assignmentSummary.textContent += ' - ask the principal to save your assignment again to use the new marks screen.';
            saveMark = (mark) => setDoc(doc(assignment.ref, 'marks', mark.exam + '_' + mark.roll), {
              ...mark, className, subject,
            });
            marksForm.hidden = false;
          }
        }
      } catch {
        if (request === schoolRequest) assignmentSummary.textContent = 'Could not load your assignment.';
      }
      // A class teacher also gets the daily attendance sheet, with or without a subject assignment.
      await loadAttendanceClasses(request, schoolRef, user.uid);
      if (request === schoolRequest) await loadMyAttendance(request, schoolRef, user.uid);
      if (request === schoolRequest) await loadMyLeave(request, schoolRef, user.uid);
      if (request === schoolRequest) await loadTeacherNotices(request, schoolRef, user.uid);
      if (request === schoolRequest) await loadTeacherHomework(request);
      if (request === schoolRequest) await loadTeacherTimetable(request, schoolRef, user.uid);
      if (request === schoolRequest) await loadTeacherCover(request, schoolRef, user.uid);
      if (request === schoolRequest) await loadTeacherLessons(request);
      if (request === schoolRequest) await loadTeacherSubmissions(request);
      if (request === schoolRequest) await loadTeacherAssessments(request);
      if (request === schoolRequest) await loadUpcomingEvents(schoolRef, teacherCalendarSection, teacherCalendarStatus, teacherCalendarList);
      return;
    }
    if (membership.data()?.active === true && ['student', 'parent'].includes(membership.data().role)) {
      status.hidden = true;
      schoolStatus.hidden = true;
      await loadPortal({ schoolRef, user, doc, collection, getDocFromServer, getDocsFromServer, query, where }, request);
      return;
    }
    const school = await getDocFromServer(schoolRef);
    if (request !== schoolRequest) return;
    if (!school.exists()) {
      schoolStatus.textContent = 'The school record was not found.';
      return;
    }
    schoolName.textContent = school.data().name;
    for (const field of profileFields) {
      profileForm.elements.namedItem(field).value = school.data()[field] ?? '';
    }
    schoolUid = user.uid;
    viewOnly = membership.data()?.role === 'principal';
    viewOnlyNote.hidden = !viewOnly;
    ownerRole.textContent = viewOnly ? 'Principal (view only)' : 'School Owner';
    saveSchoolProfile = (profile) => updateDoc(schoolRef, profile);
    saveAssignment = (uid, assignment) => setDoc(doc(schoolRef, 'teacherAssignments', uid), assignment);
    ownerEmail.textContent = user.email;
    dashboard.hidden = false;
    status.hidden = true;
    schoolStatus.hidden = true;
    const staff = collection(schoolRef, 'staff');
    staffDirectory = {
      list: () => getDocsFromServer(staff),
      save: (id, profile) => id ? updateDoc(doc(staff, id), profile) : addDoc(staff, profile),
    };
    staffStatus.textContent = 'Loading staff profiles.';
    await loadStaff(staffDirectory, request);
    const firestore = getFirestore(app);
    // Every owner change is written to the activity log after it succeeds. The log never blocks the
    // change itself: if the entry cannot be written, the change still stands.
    const log = (action, target, docId, detail) => setDoc(
      doc(schoolRef, 'auditLog', 'L-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()),
      { actor: user.uid, action, target, docId: String(docId), at: new Date().toISOString(), ...(detail ? { detail: String(detail) } : {}) },
    ).catch(() => {});
    academic = {
      busy: false,
      schoolRef,
      list: (name) => getDocsFromServer(collection(schoolRef, name)),
      save: async (name, id, data) => {
        await setDoc(doc(schoolRef, name, id), data);
        const voided = name === 'payments' && data.voided === true;
        await log(voided ? 'void' : 'save', name, id, name === 'payments' ? 'Rs ' + data.amount : '');
      },
      marksOfStudent: (studentId) => getDocsFromServer(query(collection(schoolRef, 'marks'), where('studentId', '==', studentId))),
      remove: async (name, id) => {
        await deleteDoc(doc(schoolRef, name, id));
        await log('remove', name, id, '');
      },
      decideLeave: async (id, data, status) => {
        await setDoc(doc(schoolRef, 'leaveRequests', id), { ...data, status, decidedBy: user.uid });
        await log('decide-leave', 'leaveRequests', id, status);
      },
      staffAttendanceOn: (date) => getDocsFromServer(query(collection(schoolRef, 'staffAttendance'), where('date', '==', date))),
      staffAttendanceBetween: (from, to) => getDocsFromServer(query(collection(schoolRef, 'staffAttendance'),
        where('date', '>=', from), where('date', '<=', to))),
      saveStaffAttendance: (date, uid, status) => setDoc(doc(schoolRef, 'staffAttendance', date + '_' + uid),
        { staffUid: uid, date, status, markedBy: user.uid }),
      attendanceOn: (date) => getDocsFromServer(query(collection(schoolRef, 'attendance'), where('date', '==', date))),
      marksFor: (examId) => getDocsFromServer(query(collection(schoolRef, 'marks'), where('examId', '==', examId))),
      // A year becomes active in one batch with the pointer the rules check.
      activate: (id, year) => {
        const batch = writeBatch(firestore);
        batch.set(doc(schoolRef, 'academicYears', id), { ...year, status: 'active' });
        batch.set(doc(schoolRef, 'settings', 'academic'), { activeYearId: id });
        return batch.commit().then(() => log('activate-year', 'academicYears', id, ''));
      },
      close: (id) => updateDoc(doc(schoolRef, 'academicYears', id), { status: 'closed' })
        .then(() => log('close-year', 'academicYears', id, '')),
      log,
      commit: (ops, quiet) => {
        const batch = writeBatch(firestore);
        for (const op of ops) {
          const ref = doc(schoolRef, ...op.path);
          if (op.delete) batch.delete(ref); else batch.set(ref, op.data);
        }
        return batch.commit().then(() => (quiet ? undefined : log('bulk', ops[0]?.path[0] ?? 'records', ops.length + ' records', '')));
      },
    };
    academicSection.hidden = false;
    studentSection.hidden = false;
    examSection.hidden = false;
    reviewSection.hidden = false;
    reportSection.hidden = false;
    linkSection.hidden = false;
    classTeacherSection.hidden = false;
    attReviewSection.hidden = false;
    attReviewDate.value = localToday();
    await loadGrading(schoolRef);
    if (request === schoolRequest) showGrading();
    academicStatus.textContent = 'Loading academic setup.';
    await loadAcademic(request);
    if (request === schoolRequest) await loadStaffAttendance(request);
    if (request === schoolRequest) {
      leaveReviewSection.hidden = false;
      await renderLeaveReview();
    }
    if (request === schoolRequest) await loadFees(request);
    if (request === schoolRequest) await loadNotices(request);
    if (request === schoolRequest) await loadAuditLog(request);
    if (request === schoolRequest) await loadTimetable(request);
    if (request === schoolRequest) await loadOwnerHomework(request);
    if (request === schoolRequest) await loadCalendar(request);
    if (request === schoolRequest) renderCardStudents();
    if (request === schoolRequest) {
      renderAttrepClasses();
      importSection.hidden = false;
    }
    if (request === schoolRequest) await loadLibrary(request);
    if (request === schoolRequest) await loadVisitors(request);
    if (request === schoolRequest) await loadBehaviour(request);
    if (request === schoolRequest) renderPromotionYears();
    if (request === schoolRequest) await loadOwnerLists(request);
    if (request === schoolRequest) await loadWebsite(request);
    if (request === schoolRequest) renderInsights();
    if (request === schoolRequest) await renderSummary(request);
  } catch (error) {
    if (request !== schoolRequest) return;
    schoolStatus.textContent = error.code === 'permission-denied'
      ? 'School access has not been granted to this account.'
      : 'School access could not be checked. Refresh to try again.';
  }
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!saveSchoolProfile || saveProfile.disabled) return;
  const request = schoolRequest;
  const fields = new FormData(profileForm);
  const profile = Object.fromEntries(profileFields.map((field) => [field, fields.get(field).trim()]));
  if (!profile.name) {
    profileStatus.textContent = 'Enter a school name.';
    return;
  }
  saveProfile.disabled = true;
  profileStatus.textContent = 'Saving profile.';
  try {
    await saveSchoolProfile(profile);
    if (request !== schoolRequest) return;
    schoolName.textContent = profile.name;
    profileStatus.textContent = 'School profile saved.';
  } catch (error) {
    if (request !== schoolRequest) return;
    profileStatus.textContent = error.code === 'permission-denied'
      ? 'This account cannot save the school profile.'
      : 'Could not save the profile. Try again.';
  } finally {
    if (request === schoolRequest) saveProfile.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  signInButton.disabled = true;
  status.textContent = 'Signing in.';
  const fields = new FormData(form);
  try {
    await signInWithEmailAndPassword(auth, fields.get('email').trim(), fields.get('password'));
    form.reset();
  } catch (error) {
    status.textContent = error.code === 'auth/operation-not-allowed'
      ? 'Email/password sign-in is unavailable. Contact your administrator.'
      : 'Could not sign in. Check your email and password and try again.';
  } finally {
    signInButton.disabled = false;
  }
});

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    await signOut(auth);
  } catch {
    status.textContent = 'Could not sign out. Try again.';
  } finally {
    signOutButton.disabled = false;
  }
});

// Installable app: the service worker keeps the page shell for offline opening.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
