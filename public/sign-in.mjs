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
    const [years, classes, sections, subjects, mappings, studentDocs, enrollments, exams] = await Promise.all(
      ['academicYears', 'classes', 'sections', 'subjects', 'classSubjects', 'students', 'enrollments', 'exams']
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
      + ' - ' + exam.yearId + (exam.status === 'open' ? '' : ' - ' + exam.status));
}

const GRADE_SCALE = [[90, 'A+'], [80, 'A'], [70, 'B'], [60, 'C'], [50, 'D'], [40, 'E'], [0, 'F']];
const gradeFor = (percent) => GRADE_SCALE.find(([min]) => percent >= min)[1];

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
        has ? percent + '%' : '-', has ? gradeFor(percent) : '-']) {
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
      approved: 'These results are approved and final.',
    }[exam.status];
    const action = (label, question, status, done) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => runSetupAction(async () => {
        if (!confirm(typeof question === 'function' ? question() : question)) return false;
        const { approvedBy, ...rest } = exam;
        return academic.save('exams', examRecord.id,
          status === 'approved' ? { ...rest, status, approvedBy: auth.currentUser.uid } : { ...rest, status });
      }, done, reviewStatus));
      reviewActions.append(button);
    };
    if (exam.status === 'open') {
      action('Lock exam', 'Lock ' + exam.name + '? Teachers can no longer enter or change marks. You can unlock it later.', 'locked', 'Exam locked.');
    } else if (exam.status === 'locked') {
      action('Unlock exam', 'Unlock ' + exam.name + '? Teachers can then enter and change marks again.', 'open', 'Exam unlocked.');
      action('Approve results', () => (missing
        ? missing + ' student' + (missing === 1 ? ' has' : 's have') + ' no marks yet. Approve the results anyway?'
        : 'Approve the results for ' + exam.name + '? Marks become final.'), 'approved', 'Results approved.');
    } else {
      action('Withdraw approval', 'Withdraw approval for ' + exam.name + '? The exam goes back to locked.', 'locked', 'Approval withdrawn.');
    }
  } catch {
    if (request === schoolRequest && token === reviewRequest) reviewStatus.textContent = 'Could not load marks. Try again.';
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
    context.busy = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  const request = ++schoolRequest;
  teacherMarks = undefined;
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
    const { addDoc, collection, doc, getDocFromServer, getDocsFromServer, getFirestore, query, setDoc, updateDoc, where, writeBatch } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    if (request !== schoolRequest) return;
    firestoreTools = { collection, doc, getDocsFromServer, query, setDoc, where };
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
    academic = {
      busy: false,
      list: (name) => getDocsFromServer(collection(schoolRef, name)),
      save: (name, id, data) => setDoc(doc(schoolRef, name, id), data),
      marksFor: (examId) => getDocsFromServer(query(collection(schoolRef, 'marks'), where('examId', '==', examId))),
      // A year becomes active in one batch with the pointer the rules check.
      activate: (id, year) => {
        const batch = writeBatch(firestore);
        batch.set(doc(schoolRef, 'academicYears', id), { ...year, status: 'active' });
        batch.set(doc(schoolRef, 'settings', 'academic'), { activeYearId: id });
        return batch.commit();
      },
      close: (id) => updateDoc(doc(schoolRef, 'academicYears', id), { status: 'closed' }),
      commit: (ops) => {
        const batch = writeBatch(firestore);
        for (const op of ops) {
          const ref = doc(schoolRef, ...op.path);
          if (op.delete) batch.delete(ref); else batch.set(ref, op.data);
        }
        return batch.commit();
      },
    };
    academicSection.hidden = false;
    studentSection.hidden = false;
    examSection.hidden = false;
    reviewSection.hidden = false;
    academicStatus.textContent = 'Loading academic setup.';
    await loadAcademic(request);
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

