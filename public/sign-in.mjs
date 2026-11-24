import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { app, PUSH_VAPID_KEY } from './firebase-client.mjs';

const auth = getAuth(app);
// The school comes from the page address (?school=green-valley); without it the original school is used.
const SCHOOL_ID = (() => {
  const wanted = new URLSearchParams(location.search).get('school') ?? '';
  return /^[a-z][a-z0-9-]{2,29}$/.test(wanted) ? wanted : 'abcd-school';
})();
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

// Long lists: show the first few rows and a button that opens or closes the rest.
function collapseList(list, limit, noun) {
  list.nextElementSibling?.matches('.list-toggle') && list.nextElementSibling.remove();
  const rows = [...list.children];
  if (rows.length <= limit) return;
  let open = false;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'list-toggle';
  const apply = () => {
    rows.forEach((row, index) => { row.hidden = !open && index >= limit; });
    toggle.textContent = open ? 'Hide the list' : 'Show all ' + rows.length + ' ' + noun;
  };
  toggle.addEventListener('click', () => { open = !open; apply(); });
  list.after(toggle);
  apply();
}
// Scrolling the page with the mouse over a number box must not change the number.
document.addEventListener('wheel', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === 'number' && document.activeElement === event.target) event.target.blur();
}, { passive: true });

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
    try { photoMap = new Map((await tools.list('studentPhotos')).docs.map((record) => [record.id, record.data().photo])); } catch { photoMap = new Map(); }
    if (request !== schoolRequest) return;
    studentRecords = studentDocs.docs;
    placementData = { years: years.docs, classes: classes.docs, sections: sections.docs, enrollments: enrollments.docs };
    fillStudentFilters();
    renderStudents();
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
const studentClassFilter = document.querySelector('#student-class-filter');
const studentSectionFilter = document.querySelector('#student-section-filter');
const studentCount = document.querySelector('#student-count');
const studentForm = document.querySelector('#student-form');
const studentSave = studentForm.querySelector('[type="submit"]');
const studentCancel = studentForm.querySelector('[type="reset"]');
const studentFields = ['admissionNo', 'name', 'guardianName', 'guardianPhone', 'dob', 'address', 'gender', 'motherName', 'previousSchool', 'emergencyPhone', 'guardianEmail', 'tcNo'];
const DOC_KEYS = ['birth', 'tc', 'marksheet', 'aadhaar', 'photos', 'address', 'medical', 'other'];
let studentRecords = [];
let studentEditingId;

let photoMap = new Map();
let pendingPhoto = '';
let schoolLogo = '';
const studentPhotoInput = document.querySelector('#student-photo');
const studentPhotoPreview = document.querySelector('#student-photo-preview');
const studentPhotoRemove = document.querySelector('#student-photo-remove');
const studentHistoryTitle = document.querySelector('#student-history-title');
const studentHistoryList = document.querySelector('#student-history');

// Shrinks a chosen picture to a small square JPEG (text) so it can be kept with the record. Returns '' if it cannot.
async function shrinkImage(file, size) {
  if (!file || !file.type.startsWith('image/') || file.size > 15000000) return '';
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return '';
  for (const [dimension, quality] of [[size, 0.72], [size, 0.55], [Math.round(size * 0.75), 0.5], [Math.round(size * 0.5), 0.5]]) {
    const canvas = document.createElement('canvas');
    canvas.width = dimension;
    canvas.height = dimension;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, dimension, dimension);
    const edge = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, dimension, dimension);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= 38000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  }
  return '';
}
studentPhotoInput.addEventListener('change', async () => {
  pendingPhoto = await shrinkImage(studentPhotoInput.files[0], 160);
  studentPhotoPreview.hidden = !pendingPhoto;
  if (pendingPhoto) { studentPhotoPreview.src = pendingPhoto; studentPhotoRemove.checked = false; }
  else if (studentPhotoInput.files[0]) studentStatus.textContent = 'That picture could not be used. Try a different image.';
});

studentForm.addEventListener('reset', () => {
  pendingPhoto = '';
  studentPhotoPreview.hidden = true;
  studentEditingId = undefined;
  studentForm.elements.namedItem('admissionNo').readOnly = false;
  studentSave.textContent = 'Save student';
  studentCancel.hidden = true;
});

// Profile history: each owner edit to a student leaves a short, permanent note of what changed.
async function addStudentHistory(studentId, summary) {
  try {
    await academic.save('studentHistory', newId('SH'), { studentId, at: new Date().toISOString(), by: schoolUid, summary: summary.slice(0, 500) });
  } catch { /* The change itself stands even if the note could not be written. */ }
}
async function showStudentHistory(studentId, name) {
  const { collection, getDocsFromServer, query, where } = firestoreTools;
  const request = schoolRequest;
  studentHistoryTitle.hidden = false;
  studentHistoryList.hidden = false;
  studentHistoryTitle.textContent = 'Change history - ' + name;
  studentHistoryList.replaceChildren();
  try {
    const found = await getDocsFromServer(query(collection(academic.schoolRef, 'studentHistory'), where('studentId', '==', studentId)));
    if (request !== schoolRequest) return;
    for (const record of found.docs.sort((a, b) => b.data().at.localeCompare(a.data().at))) listItem(studentHistoryList, record.data().at.slice(0, 16).replace('T', ' ') + ' - ' + record.data().summary);
    if (!found.docs.length) listItem(studentHistoryList, 'No changes recorded yet.');
  } catch {
    listItem(studentHistoryList, 'Could not load the history.');
  }
}

// The class a student sits in this year (the active academic year), used by the filters below.
function activePlacements() {
  const year = placementData.years.find((record) => record.data().status === 'active');
  const map = new Map();
  if (year) for (const record of placementData.enrollments) if (record.data().yearId === year.id) map.set(record.data().studentId, record.data());
  return { year, map };
}
function fillSectionFilter() {
  const keep = studentSectionFilter.value;
  studentSectionFilter.replaceChildren(new Option('All sections', ''));
  for (const record of [...placementData.sections].sort((a, b) => a.id.localeCompare(b.id))) {
    if (record.data().classId === studentClassFilter.value) studentSectionFilter.append(new Option('Section ' + record.data().name, record.id));
  }
  studentSectionFilter.value = [...studentSectionFilter.options].some((option) => option.value === keep) ? keep : '';
}
function fillStudentFilters() {
  const keep = studentClassFilter.value;
  const classes = [...placementData.classes].sort((a, b) => a.data().order - b.data().order);
  studentClassFilter.replaceChildren();
  for (const record of classes) studentClassFilter.append(new Option(record.data().name, record.id));
  studentClassFilter.append(new Option('All classes (first 100)', 'all'), new Option('Not placed in a class', 'none'));
  studentClassFilter.value = [...studentClassFilter.options].some((option) => option.value === keep) ? keep : (classes[0]?.id ?? 'all');
  fillSectionFilter();
}
studentClassFilter.addEventListener('change', () => { fillSectionFilter(); studentStatus.textContent = ''; renderStudents(); renderPlacements(); });
studentSectionFilter.addEventListener('change', () => { studentStatus.textContent = ''; renderStudents(); renderPlacements(); });

function renderStudents() {
  studentList.replaceChildren();
  const term = studentSearch.value.trim().toLowerCase();
  const { year, map } = activePlacements();
  const classFilter = studentClassFilter.value;
  const sectionFilter = studentSectionFilter.value;
  const className = (id) => placementData.classes.find((record) => record.id === id)?.data().name ?? id;
  const sectionName = (id) => placementData.sections.find((record) => record.id === id)?.data().name ?? '';
  const wide = Boolean(term) || classFilter === 'all' || classFilter === 'none';
  const all = studentRecords.filter((record) => {
    const item = record.data();
    if (term) return (item.name + ' ' + item.admissionNo).toLowerCase().includes(term);
    const placed = map.get(record.id);
    if (classFilter === 'all') return true;
    if (classFilter === 'none') return !placed;
    return Boolean(placed) && placed.classId === classFilter && (!sectionFilter || placed.sectionId === sectionFilter);
  });
  all.sort(wide ? (a, b) => a.data().name.localeCompare(b.data().name)
    : (a, b) => (map.get(a.id).sectionId.localeCompare(map.get(b.id).sectionId)) || map.get(a.id).rollNo - map.get(b.id).rollNo);
  const matches = wide ? all.slice(0, 100) : all;
  studentCount.textContent = studentRecords.length
    ? 'Showing ' + matches.length + (all.length > matches.length ? ' of ' + all.length : '') + ' student(s)'
      + (term ? ' matching your search (all classes).' : classFilter === 'all' || classFilter === 'none' ? '.' : ' in this class.')
    : '';
  for (const record of matches) {
    const student = record.data();
    const placed = map.get(record.id);
    const row = document.createElement('li');
    if (photoMap.has(record.id)) { const thumb = document.createElement('img'); thumb.className = 'thumb'; thumb.alt = ''; thumb.src = photoMap.get(record.id); row.append(thumb); }
    row.append((placed ? className(placed.classId) + ' ' + sectionName(placed.sectionId) + ', roll ' + placed.rollNo + ' - ' : 'Not placed - ')
      + student.name + ' - ' + student.admissionNo + ' - ' + student.guardianName
      + (student.guardianPhone ? ' (' + student.guardianPhone + ')' : '') + ' - ' + student.status + ' ');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit ' + student.name;
    edit.addEventListener('click', () => {
      studentEditingId = record.id;
      for (const field of studentFields) studentForm.elements.namedItem(field).value = student[field] ?? '';
      for (const box of studentForm.querySelectorAll('input[name="docs"]')) box.checked = (student.docsReceived ?? []).includes(box.value);
      studentForm.elements.namedItem('admissionNo').readOnly = true;
      studentSave.textContent = 'Save changes';
      studentCancel.hidden = false;
      pendingPhoto = '';
      studentPhotoPreview.hidden = !photoMap.has(record.id);
      if (photoMap.has(record.id)) studentPhotoPreview.src = photoMap.get(record.id);
      studentForm.elements.namedItem('name').focus();
    });
    const history = document.createElement('button');
    history.type = 'button';
    history.textContent = 'History of ' + student.name;
    history.addEventListener('click', () => showStudentHistory(record.id, student.name));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    const next = student.status === 'active' ? 'inactive' : 'active';
    toggle.textContent = (next === 'inactive' ? 'Mark inactive ' : 'Mark active ') + student.name;
    toggle.addEventListener('click', () => runSetupAction(
      async () => {
        await academic.save('students', record.id, { ...student, status: next });
        await addStudentHistory(record.id, 'status: ' + student.status + ' -> ' + next);
      },
      'Student marked ' + next + '.', studentStatus,
    ));
    row.append(edit, toggle, history);
    if (year && student.status === 'active') {
      const move = document.createElement('button');
      move.type = 'button';
      move.textContent = (placed ? 'Change class of ' : 'Place ') + student.name;
      move.addEventListener('click', () => {
        placementForm.elements.namedItem('yearId').value = year.id;
        placementForm.elements.namedItem('studentId').value = record.id;
        if (placed) placementForm.elements.namedItem('sectionId').value = placed.sectionId;
        placementForm.elements.namedItem('rollNo').value = placed ? placed.rollNo : '';
        placementStatus.textContent = 'Choose the class, section and roll number below, then press Place student.';
        placementForm.scrollIntoView({ block: 'center' });
      });
      row.append(move);
    }
    studentList.append(row);
  }
  if (!studentRecords.length) studentStatus.textContent = studentStatus.textContent || 'No students yet.';
  else if (!matches.length) studentStatus.textContent = 'No students found here. Pick another class or use the search box.';
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
  if (value('dob') && !DATE_TEXT.test(value('dob'))) {
    studentStatus.textContent = 'Enter the date of birth as a date.';
    return;
  }
  const existing = studentRecords.find((record) => record.id === id);
  if (existing && !studentEditingId) {
    studentStatus.textContent = 'Admission number ' + existing.data().admissionNo + ' is already used by '
      + existing.data().name + '. Use Edit to change that student.';
    return;
  }
  if (value('emergencyPhone') && !/^[0-9+() -]{1,20}$/.test(value('emergencyPhone'))) {
    studentStatus.textContent = 'Emergency phone may use digits, +, spaces, hyphens and brackets only.';
    return;
  }
  if (value('gender') && !['male', 'female', 'other'].includes(value('gender'))) {
    studentStatus.textContent = 'Choose a gender from the list, or leave it as Not stated.';
    return;
  }
  runSetupAction(async () => {
    const saved = {
      admissionNo, name: value('name'), guardianName: value('guardianName'),
      guardianPhone: value('guardianPhone'), status: existing?.data().status ?? 'active',
      ...(value('dob') ? { dob: value('dob') } : {}), ...(value('address') ? { address: value('address') } : {}),
      ...Object.fromEntries(['gender', 'motherName', 'previousSchool', 'emergencyPhone', 'guardianEmail', 'tcNo'].filter((key) => value(key)).map((key) => [key, value(key)])),
      ...(fields.getAll('docs').length ? { docsReceived: DOC_KEYS.filter((key) => fields.getAll('docs').includes(key)) } : {}),
    };
    await academic.save('students', id, saved);
    if (!existing && admissionEnquiry) {
      const fromEnquiry = admissionEnquiry;
      await academic.save('enquiries', fromEnquiry.id, { ...fromEnquiry.data, status: 'admitted', note: ('Admission no ' + admissionNo).slice(0, 300) });
      pendingPlacement = { studentId: id, classApplying: fromEnquiry.data.classApplying };
      admissionEnquiry = null;
    }
    if (existing) {
      const before = existing.data();
      const changes = studentFields.filter((field) => (before[field] ?? '') !== (saved[field] ?? '')).map((field) => field + ': ' + (before[field] || '-') + ' -> ' + (saved[field] || '-'));
      if (changes.length) await addStudentHistory(id, changes.join('; '));
    } else {
      await addStudentHistory(id, 'student added');
    }
    if (pendingPhoto) {
      await academic.save('studentPhotos', id, { photo: pendingPhoto });
      if (existing) await addStudentHistory(id, 'photo changed');
    } else if (studentPhotoRemove.checked && photoMap.has(id)) {
      await academic.remove('studentPhotos', id);
      await addStudentHistory(id, 'photo removed');
    }
    studentForm.reset();
  }, 'Student saved.', studentStatus).then(() => {
    if (!pendingPlacement) return;
    const wanted = pendingPlacement;
    pendingPlacement = null;
    prepareAdmissionPlacement(wanted);
    lists.enquiries.load(schoolRequest);
  });
});

// Admission hand-off. "Create student record" on an enquiry remembers which enquiry it came from. When the new student
// is saved the enquiry is marked admitted, and the placement form below is filled in with the active year, the section
// that matches the class applied for, and the next free roll number. The owner still presses Place student.
let admissionEnquiry = null;
let pendingPlacement = null;
function prepareAdmissionPlacement({ studentId, classApplying }) {
  const year = [...placementData.years].find((record) => record.data().status === 'active');
  const wanted = String(classApplying ?? '').trim().toLowerCase();
  const section = placementData.sections.find((record) => {
    const klass = placementData.classes.find((candidate) => candidate.id === record.data().classId)?.data().name.toLowerCase() ?? '';
    return wanted && (klass === wanted || wanted.includes(klass) || klass.includes(wanted));
  });
  if (year) placementForm.elements.namedItem('yearId').value = year.id;
  placementForm.elements.namedItem('studentId').value = studentId;
  if (section) {
    placementForm.elements.namedItem('sectionId').value = section.id;
    const rolls = placementData.enrollments.filter((record) => record.data().sectionId === section.id && (!year || record.data().yearId === year.id)).map((record) => record.data().rollNo);
    placementForm.elements.namedItem('rollNo').value = Math.min(999, Math.max(0, ...rolls) + 1);
  }
  placementStatus.textContent = 'Student saved and the enquiry is marked admitted. ' + (section ? 'The class, section and roll number are filled in from the enquiry. Check them, then press Place student.'
    : 'Choose the class, section and roll number, then press Place student.');
  placementForm.scrollIntoView({ block: 'center' });
}

const placementStatus = document.querySelector('#placement-status');
const placementList = document.querySelector('#placement-list');
const placementForm = document.querySelector('#placement-form');
let placementData = { years: [], classes: [], sections: [], enrollments: [] };

function renderPlacements() {
  const { years, classes, sections, enrollments } = placementData;
  const className = (id) => classes.find((record) => record.id === id)?.data().name ?? id;
  const sectionLabel = (record) => className(record.data().classId) + ' - ' + record.data().name;
  placementList.replaceChildren();
  const classFilter = studentClassFilter.value;
  const sectionFilter = studentSectionFilter.value;
  const sorted = [...enrollments].filter((record) => classFilter === 'all' || (classFilter !== 'none'
    && record.data().classId === classFilter && (!sectionFilter || record.data().sectionId === sectionFilter)))
    .sort((a, b) => (a.data().yearId + a.data().sectionId).localeCompare(
      b.data().yearId + b.data().sectionId) || a.data().rollNo - b.data().rollNo).slice(0, 100);
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
// A subject can have its own pass marks (exam.passMarks); otherwise the school's pass percentage applies.
const passedExam = (exam, score) => (typeof exam.passMarks === 'number' ? score >= exam.passMarks : isPass(Math.round(score / exam.maxMarks * 1000) / 10));
const gradeTextFor = (exam, score) => gradeFor(Math.round(score / exam.maxMarks * 1000) / 10) + ' - ' + (passedExam(exam, score) ? 'Pass' : 'Fail');
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
    const draftIds = new Set(saved.docs.filter((record) => record.data().draft === true).map((record) => record.data().studentId));
    const sectionName = (id) => placementData.sections.find((record) => record.id === id)?.data().name ?? id;
    const students = new Map(studentRecords.map((record) => [record.id, record.data()]));
    const rows = placementData.enrollments.map((record) => record.data())
      .filter((item) => item.yearId === exam.yearId && item.classId === exam.classId)
      .sort((a, b) => sectionName(a.sectionId).localeCompare(sectionName(b.sectionId)) || a.rollNo - b.rollNo);
    for (const row of rows) {
      const student = students.get(row.studentId);
      const tr = document.createElement('tr');
      const has = scores.has(row.studentId);
      const marks = has ? scores.get(row.studentId) + ' / ' + exam.maxMarks + (draftIds.has(row.studentId) ? ' (draft)' : '') : 'Missing';
      const percent = has ? Math.round(scores.get(row.studentId) / exam.maxMarks * 1000) / 10 : null;
      for (const text of [sectionName(row.sectionId), String(row.rollNo),
        student ? student.name + ' (' + student.admissionNo + ')' : row.studentId, marks,
        has ? percent + '%' : '-', has ? gradeTextFor(exam, scores.get(row.studentId)) : '-']) {
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
    const drafts = rows.filter((row) => draftIds.has(row.studentId)).length;
    const draftNote = drafts ? drafts + ' mark' + (drafts === 1 ? ' is' : 's are') + ' still draft (not submitted by the teacher). ' : '';
    reviewStatus.textContent = draftNote + {
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
      action('Lock exam', () => (drafts ? drafts + ' mark(s) are still drafts and will be locked as they are. ' : '') + 'Lock ' + exam.name + '? Teachers can no longer enter or change marks. You can unlock it later.', 'locked', 'Exam locked.');
    } else if (exam.status === 'locked') {
      if (!viewOnly) action('Unlock exam', 'Unlock ' + exam.name + '? Teachers can then enter and change marks again.', 'open', 'Exam unlocked.');
      action('Approve results', () => (drafts ? drafts + ' mark(s) are still drafts. ' : '') + (missing
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
      if (!passedExam(exam, mark.score)) failed += 1;
      const tr = document.createElement('tr');
      for (const text of [exam.yearId, nameOf(examData.subjects, exam.subjectId), exam.name,
        mark.score + ' / ' + exam.maxMarks, percent + '%', gradeTextFor(exam, mark.score)]) {
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
  if (!button || button.closest('#leave-review') || /^(download|print|show|refresh|view|preview|approve results)/i.test(button.textContent.trim())) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  viewOnlyNote.focus?.();
  viewOnlyNote.textContent = 'View only. This login can approve leave and post notices; everything else is the owner\'s.';
}, true);
dashboard.addEventListener('submit', (event) => {
  if (!viewOnly || event.target.closest('#notice-form')) return;
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
let portalRole = 'parent'; // 'student' or 'parent', from familyAccess.relation
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
// Results are tucked behind the My Results tile. The student picks one exam (term) at a time; "All exams" adds them up.
let portalLines = [];
let portalChosenExam = '';
const portalExamPick = document.querySelector('#portal-exam-pick');
const portalExamTitle = document.querySelector('#portal-exam-title');
const examKeyOf = (line) => line.exam.yearId + '|' + line.exam.name;
function buildPortalExamPicker() {
  portalExamPick.replaceChildren();
  portalBody.replaceChildren();
  portalTotal.textContent = '';
  portalExamTitle.textContent = '';
  if (!portalLines.length) return;
  const years = new Set(portalLines.map((line) => line.exam.yearId));
  const keys = [...new Map(portalLines.map((line) => [examKeyOf(line), line])).entries()]
    .sort((a, b) => b[1].exam.yearId.localeCompare(a[1].exam.yearId) || (a[1].exam.examKey ?? a[1].exam.name).localeCompare(b[1].exam.examKey ?? b[1].exam.name));
  const choices = [...keys.map(([key, line]) => [key, line.exam.name + (years.size > 1 ? ' (' + line.exam.yearId + ')' : '')]), ['all', 'All exams together']];
  for (const [key, label] of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.exam = key;
    button.textContent = label;
    button.style.cssText = 'margin:4px 6px 4px 0;min-height:44px';
    button.addEventListener('click', () => { portalChosenExam = key; showPortalExam(); });
    portalExamPick.append(button);
  }
  portalChosenExam = choices[0][0];
  showPortalExam();
}
function showPortalExam() {
  for (const button of portalExamPick.children) button.setAttribute('aria-pressed', String(button.dataset.exam === portalChosenExam));
  const shown = portalLines.filter((line) => portalChosenExam === 'all' || examKeyOf(line) === portalChosenExam);
  portalBody.replaceChildren();
  let got = 0;
  let max = 0;
  let failed = 0;
  for (const { exam, mark, subject } of shown) {
    const percent = Math.round(mark.score / exam.maxMarks * 1000) / 10;
    got += mark.score;
    max += exam.maxMarks;
    if (!passedExam(exam, mark.score)) failed += 1;
    const tr = document.createElement('tr');
    for (const text of [subject, exam.name + (portalChosenExam === 'all' ? ' (' + exam.yearId + ')' : ''), mark.score + ' / ' + exam.maxMarks, percent + '%', gradeTextFor(exam, mark.score)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    portalBody.append(tr);
  }
  const label = [...portalExamPick.children].find((button) => button.dataset.exam === portalChosenExam)?.textContent ?? '';
  portalExamTitle.textContent = shown.length ? label : '';
  if (shown.length) {
    const overall = Math.round(got / max * 1000) / 10;
    portalTotal.textContent = 'Total ' + got + ' / ' + max + ' - ' + overall + '% - Grade ' + gradeFor(overall) + ' - ' + resultText(failed);
  } else {
    portalTotal.textContent = '';
  }
}

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
    portalRole = link.data().relation === 'student' ? 'student' : 'parent';
    applyPortalRole(portalRole);
    portalEmail.textContent = (portalRole === 'student' ? 'Student login: ' : 'Parent login: ') + user.email;
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
    loadPortalEbooks(tools, request);
    loadPortalSchoolwork(tools, request, studentId);
    loadPortalLife(tools, request, studentId);
    loadPortalCommunity(tools, request, studentId);
    loadPortalConsents(tools, request, studentId);
    loadPortalTests(tools, request, studentId);
    loadPortalPickup(tools, request, studentId);
    loadPortalAlerts(tools, request, studentId);
    loadPortalEvents(tools, request, studentId);
    loadPortalCoursework(tools, request, studentId);
    loadPortalLeave(tools, request, studentId);
    portalHome = { att: null, pending: null, avg: null, subjects: null, due: null, today: [], homework: [], upcoming: [], name: '', classId: '', section: '', roll: '', admissionNo: '', photo: '' };
    renderPortalHome();
    loadPortalHome(tools, request, studentId);
    loadPortalProfile(tools, request, studentId);
    loadPortalMaterials(tools, request, studentId);
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
      .map((line) => ({ ...line, subject: subjectName.get(line.exam.subjectId) }))
      .sort((a, b) => a.exam.yearId.localeCompare(b.exam.yearId) || a.subject.localeCompare(b.subject));
    portalStudent.textContent = student.exists() ? student.data().name + ' (' + student.data().admissionNo + ')' : '';
    portalLines = lines;
    if (lines.length) {
      const gotAll = lines.reduce((sum, line) => sum + line.mark.score, 0);
      const maxAll = lines.reduce((sum, line) => sum + line.exam.maxMarks, 0);
      portalHome.avg = maxAll ? Math.round(gotAll / maxAll * 1000) / 10 : null;
      portalHome.subjects = new Set(lines.map((line) => line.subject)).size;
      renderPortalHome();
    }
    portalChosenExam = '';
    buildPortalExamPicker();
    portalStatus.textContent = lines.length ? '' : 'No results have been published yet.';
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
      + ' - max ' + exam.maxMarks + (typeof exam.passMarks === 'number' ? ' - pass ' + exam.passMarks : '') + ' - ' + exam.yearId + ' - ' + exam.status, button);
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
  const passText = String(fields.get('passMarks') ?? '').trim();
  const passMarks = passText === '' ? null : Number(passText);
  if (passMarks !== null && (!Number.isInteger(passMarks) || passMarks < 0 || passMarks > maxMarks)) {
    examStatus.textContent = 'Pass marks must be a whole number from 0 up to the maximum marks.';
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
    await academic.save('exams', id, { yearId, classId, subjectId, examKey, name, maxMarks, ...(passMarks !== null ? { passMarks } : {}), status: 'open' });
    examForm.elements.namedItem('name').value = '';
    examForm.elements.namedItem('passMarks').value = '';
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
  examMarksHeading.textContent = 'Marks (out of ' + exam.maxMarks + (typeof exam.passMarks === 'number' ? ', pass ' + exam.passMarks : '') + ')';
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
    const drafts = new Set(saved.docs.filter((record) => record.data().draft === true).map((record) => record.data().studentId));
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
      input.dataset.draft = drafts.has(row.studentId) ? '1' : '';
      input.value = input.dataset.original;
      input.setAttribute('aria-label', 'Marks for ' + sectionName(row.sectionId) + ' roll ' + row.rollNo);
      for (const content of [sectionName(row.sectionId), String(row.rollNo), input, scores.has(row.studentId) ? (drafts.has(row.studentId) ? 'Draft' : 'Submitted') : 'Not entered']) {
        const td = document.createElement('td');
        td.append(content);
        tr.append(td);
      }
      examMarksBody.append(tr);
    }
    for (const button of examMarksForm.querySelectorAll('button[type="submit"]')) button.disabled = exam.status !== 'open' || !rows.length;
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
  const asDraft = event.submitter?.dataset.draft === '1';
  const writes = [];
  for (const input of examMarksBody.querySelectorAll('input')) {
    if (input.value === '') continue;
    if (input.value === input.dataset.original && (asDraft || input.dataset.draft !== '1')) continue;
    const score = Number(input.value);
    if (!Number.isInteger(score) || score < 0 || score > exam.maxMarks) {
      examMarksStatus.textContent = 'Marks must be whole numbers from 0 to ' + exam.maxMarks + '.';
      input.focus();
      return;
    }
    writes.push({ studentId: input.dataset.student, score });
  }
  if (!writes.length) {
    examMarksStatus.textContent = asDraft ? 'No new or changed marks to save as a draft.' : 'No new or changed marks to submit.';
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
          studentId, score, maxMarks: exam.maxMarks, enteredBy: context.uid, ...(asDraft ? { draft: true } : {}),
        })));
      done += results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    if (request !== schoolRequest || context !== teacherMarks) return;
    await renderTeacherMarks(request);
    if (request === schoolRequest) examMarksStatus.textContent = (asDraft ? 'Saved ' + done + ' draft mark' + (done === 1 ? '' : 's') + '. Submit them when they are final.' : 'Submitted ' + done + ' mark' + (done === 1 ? '' : 's') + '.');
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
const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'On approved leave' };
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
      const count = { present: 0, absent: 0, late: 0, leave: 0 };
      for (const item of list) {
        const mark = marks.get(record.id + '/' + item.studentId);
        if (mark) count[mark] += 1;
      }
      const done = count.present + count.absent + count.late + count.leave;
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
  const count = { present: 0, absent: 0, late: 0, leave: 0, '': 0 };
  for (const select of attSelects()) count[select.value] += 1;
  attCounts.textContent = attSelects().length
    ? 'Present ' + count.present + ', absent ' + count.absent + ', late ' + count.late + ', on leave ' + count.leave + ', not marked ' + count['']
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
  } catch (error) {
    if (request === schoolRequest) attMarkStatus.textContent = 'Could not load your class. Refresh to try again.' + (error?.code ? ' (' + error.code + ')' : '');
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
  } catch (error) {
    if (!stale()) attMarkStatus.textContent = 'Could not load students. Try again.' + (error?.code ? ' (' + error.code + ')' : '');
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
    .map((select) => ({ studentId: select.dataset.student, status: select.value, corrected: select.dataset.original !== '' }));
  if (!writes.length) {
    attMarkStatus.textContent = 'No new or changed attendance to save.';
    return;
  }
  // Changing an attendance mark that was already saved needs a short reason, kept with the record.
  const correctionCount = writes.filter((write) => write.corrected).length;
  let reason = '';
  if (correctionCount) {
    reason = (prompt('You are correcting ' + correctionCount + ' saved mark' + (correctionCount === 1 ? '' : 's') + '. Why? (a few words, required)') ?? '').trim().slice(0, 120);
    if (reason.length < 3) {
      attMarkStatus.textContent = 'Nothing was saved. A correction needs a reason of at least 3 characters.';
      return;
    }
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
      const results = await Promise.allSettled(writes.slice(start, start + ATTENDANCE_PER_GROUP).map(({ studentId, status, corrected }) => setDoc(
        doc(context.schoolRef, 'attendance', date + '_' + classId + '_' + studentId), {
          yearId: context.year.id, classId, studentId, date, status, markedBy: context.uid, ...(corrected ? { reason } : {}),
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
  const count = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const mark of marks) count[mark.status] += 1;
  const counted = marks.length - count.leave;
  const percent = counted ? Math.round((count.present + count.late) / counted * 1000) / 10 : 100;
  portalAttTotal.textContent = 'Present ' + count.present + ', absent ' + count.absent + ', late ' + count.late
    + (count.leave ? ', on approved leave ' + count.leave : '')
    + ' - Attendance ' + percent + '% (present and late days out of ' + counted + ' school days marked; approved leave is not counted)';
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

// Teacher check-in and check-out (features 128, 130, 158). The school's map position and allowed distance are set by AZIZ
// (settings/location). The phone reports its position; the database rules check it again against the school position and stamp
// the time themselves, so a wrong phone clock or an edited page cannot make an early check-in. GPS can be faked, so a record
// is a strong signal and not proof: the principal sees every position and can reject a doubtful one.
const CHECKIN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const checkinSection = document.querySelector('#checkin');
const checkinStatus = document.querySelector('#checkin-status');
const checkinToday = document.querySelector('#checkin-today');
const checkinInButton = document.querySelector('#checkin-in');
const checkinOutButton = document.querySelector('#checkin-out');
const checkinReviewBox = document.querySelector('#checkin-review');
const checkinNote = document.querySelector('#checkin-note');
const checkinReviewSend = document.querySelector('#checkin-review-send');
const checkinQrBox = document.querySelector('#checkin-qr');
const checkinQrScan = document.querySelector('#checkin-qr-scan');
const checkinQrCode = document.querySelector('#checkin-qr-code');
const checkinQrVideo = document.querySelector('#checkin-qr-video');
const checkinSelfieBox = document.querySelector('#checkin-selfie');
const checkinSelfieVideo = document.querySelector('#checkin-selfie-video');
let myCheckin; // { schoolRef, uid, loc, docs: { in, out }, failed, busy }
const schoolClock = (loc, ms = Date.now()) => new Date(ms + (loc?.tzMinutes ?? 330) * 60000);
const schoolDay = (loc, ms) => schoolClock(loc, ms).toISOString().slice(0, 10);
const schoolTime = (loc, ms) => schoolClock(loc, ms).toISOString().slice(11, 19);
// The same flat-earth distance the database rules use, so the page and the server agree.
function metresFromSchool(loc, lat, lng) {
  const x = loc.lat * 0.017453292519943295;
  const x2 = x * x;
  const c = 1 - x2 / 2 + x2 * x2 / 24 - x2 * x2 * x2 / 720 + x2 * x2 * x2 * x2 / 40320;
  const dy = (lat - loc.lat) * 111320;
  const dx = (lng - loc.lng) * 111320 * c;
  return Math.sqrt(dx * dx + dy * dy);
}
const CHECKIN_STATE = { verified: 'position checked', review: 'waiting for the principal', approved: 'approved by the principal', rejected: 'rejected by the principal' };
const checkinKindLabel = { in: 'Check in', out: 'Check out' };

function renderMyCheckin() {
  const ctx = myCheckin;
  checkinToday.replaceChildren();
  if (!ctx?.loc) return;
  const dayText = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(schoolClock(ctx.loc));
  const lines = [dayText + ' (school time)'];
  for (const kind of ['in', 'out']) {
    const found = ctx.docs[kind];
    lines.push(checkinKindLabel[kind] + ': ' + (found ? (found.at?.toMillis ? schoolTime(ctx.loc, found.at.toMillis()) : 'saved') + ' - ' + (CHECKIN_STATE[found.status] ?? found.status) : 'not yet'));
  }
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    checkinToday.append(row);
  }
  checkinInButton.disabled = ctx.busy || Boolean(ctx.docs.in);
  checkinOutButton.disabled = ctx.busy || !ctx.docs.in || Boolean(ctx.docs.out);
}

async function refreshMyCheckin(request) {
  const ctx = myCheckin;
  const { doc, getDocFromServer } = firestoreTools;
  const day = schoolDay(ctx.loc);
  const [checkedIn, checkedOut] = await Promise.all(['in', 'out'].map((kind) => getDocFromServer(doc(ctx.schoolRef, 'staffCheckins', day + '_' + ctx.uid + '_' + kind))));
  if (request !== schoolRequest) return;
  ctx.docs = { in: checkedIn.exists() ? checkedIn.data() : null, out: checkedOut.exists() ? checkedOut.data() : null };
  renderMyCheckin();
}

async function loadMyCheckin(request, schoolRef, uid) {
  const { doc, getDocFromServer } = firestoreTools;
  checkinSection.hidden = false;
  myCheckin = { schoolRef, uid, loc: null, docs: { in: null, out: null }, failed: null, busy: false };
  checkinInButton.disabled = true;
  checkinOutButton.disabled = true;
  checkinStatus.textContent = 'Loading.';
  try {
    const found = await getDocFromServer(doc(schoolRef, 'settings', 'location'));
    if (request !== schoolRequest) return;
    if (!found.exists()) {
      checkinStatus.textContent = 'Your school has not set its map location yet, so check-in is not ready. Please tell the school owner.';
      return;
    }
    myCheckin.loc = found.data();
    checkinQrBox.hidden = myCheckin.loc.qrRequired !== true;
    checkinSelfieBox.hidden = myCheckin.loc.selfieRequired !== true;
    await refreshMyCheckin(request);
    if (request === schoolRequest) checkinStatus.textContent = 'You must be within ' + myCheckin.loc.radiusM + ' m of the school, with GPS accurate to ' + myCheckin.loc.maxAccuracyM + ' m or better.'
      + (myCheckin.loc.qrRequired ? ' You also need the code from the school QR screen.' : '') + (myCheckin.loc.selfieRequired ? ' A live selfie is taken with each check-in.' : '');
  } catch {
    if (request === schoolRequest) checkinStatus.textContent = 'Could not load check-in. Try again.';
  }
}

const currentPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject({ code: 0 }); return; }
  navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
});

// Camera QR reading (Batch 73). Chrome on Android reads QR codes itself (BarcodeDetector). Everywhere else (iPhone, Windows and Mac computers) a small
// open-source reader (jsQR, a pinned version) is loaded once from a public file host the first time the camera is used.
let jsQrLoading = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsQrLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => { jsQrLoading = null; script.remove(); reject(new Error('QR reader not loaded')); };
    document.head.append(script);
  });
  return jsQrLoading;
}
async function makeQrDetector() {
  if ('BarcodeDetector' in window) {
    const native = new BarcodeDetector({ formats: ['qr_code'] });
    return { detect: (video) => native.detect(video) };
  }
  const jsQR = await loadJsQr();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return {
    detect: async (video) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return [];
      const scale = Math.min(1, 640 / width);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      return found ? [{ rawValue: found.data }] : [];
    },
  };
}
const QR_CODE_TEXT = /^[A-HJ-NP-Z2-9]{8}$/;
let qrScanStop = null;
function stopQrScan() {
  if (qrScanStop) qrScanStop();
}
// Reads the school's QR code with the phone camera where the browser can (BarcodeDetector). Otherwise the teacher types the code.
async function scanSchoolQr() {
  if (qrScanStop) { stopQrScan(); return; }
  if (!navigator.mediaDevices?.getUserMedia) {
    checkinStatus.textContent = 'This browser cannot scan QR codes. Type the 8 letters shown under the code on the school screen.';
    return;
  }
  let stream;
  try {
    checkinStatus.textContent = 'Starting the camera.';
    const detector = await makeQrDetector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    let live = true;
    qrScanStop = () => {
      live = false;
      for (const track of stream.getTracks()) track.stop();
      checkinQrVideo.srcObject = null;
      checkinQrVideo.hidden = true;
      checkinQrScan.textContent = 'Scan QR code';
      qrScanStop = null;
    };
    checkinQrVideo.srcObject = stream;
    checkinQrVideo.hidden = false;
    await checkinQrVideo.play();
    checkinQrScan.textContent = 'Stop scanning';
    checkinStatus.textContent = 'Point the camera at the QR code on the school screen.';
    while (live) {
      const codes = await detector.detect(checkinQrVideo).catch(() => []);
      const match = codes.map((item) => /^AZIZ:([A-HJ-NP-Z2-9]{8})$/.exec(item.rawValue ?? '')).find(Boolean);
      if (match) {
        checkinQrCode.value = match[1];
        checkinStatus.textContent = 'Code read. Now press Check in or Check out.';
        stopQrScan();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch {
    if (stream && !qrScanStop) for (const track of stream.getTracks()) track.stop();
    stopQrScan();
    checkinStatus.textContent = 'Could not use the camera. Allow camera access for this site, or type the code shown on the school screen.';
  }
}
checkinQrScan.addEventListener('click', scanSchoolQr);
checkinQrCode.addEventListener('input', () => { checkinQrCode.value = checkinQrCode.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

// A live selfie: the front camera opens, counts down, and keeps one small JPEG (about 200 by 200 pixels) with the date and time on it.
// It is taken from the camera only, never from the gallery, and stays small so the database holds it cheaply.
async function takeSelfie(ctx) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: false });
  try {
    checkinSelfieVideo.srcObject = stream;
    checkinSelfieVideo.hidden = false;
    await checkinSelfieVideo.play();
    for (let count = 3; count >= 1; count--) {
      checkinStatus.textContent = 'Look at the camera. Taking the photo in ' + count + '.';
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const side = Math.min(checkinSelfieVideo.videoWidth, checkinSelfieVideo.videoHeight);
    if (!(side > 0)) throw new Error('camera not ready');
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    context.drawImage(checkinSelfieVideo, (checkinSelfieVideo.videoWidth - side) / 2, (checkinSelfieVideo.videoHeight - side) / 2, side, side, 0, 0, 200, 200);
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(0, 182, 200, 18);
    context.fillStyle = '#ffffff';
    context.font = '11px sans-serif';
    context.fillText(schoolDay(ctx.loc) + ' ' + schoolTime(ctx.loc).slice(0, 5), 4, 195);
    for (const quality of [0.6, 0.45, 0.3]) {
      const photo = canvas.toDataURL('image/jpeg', quality);
      if (photo.startsWith('data:image/jpeg;base64,') && photo.length <= 38000) return photo;
    }
    throw new Error('photo too large');
  } finally {
    for (const track of stream.getTracks()) track.stop();
    checkinSelfieVideo.srcObject = null;
    checkinSelfieVideo.hidden = true;
  }
}

async function attemptCheckin(kind) {
  const ctx = myCheckin;
  if (!ctx?.loc || ctx.busy) return;
  const request = schoolRequest;
  ctx.busy = true;
  ctx.failed = null;
  checkinReviewBox.hidden = true;
  renderMyCheckin();
  try {
    const qrCode = checkinQrCode.value.trim().toUpperCase();
    if (ctx.loc.qrRequired && !QR_CODE_TEXT.test(qrCode)) {
      checkinStatus.textContent = 'Scan the QR code on the school screen first, or type the 8 letters shown under it.';
      return;
    }
    checkinStatus.textContent = 'Finding your position. Keep this page open and allow location when your phone asks.';
    let position;
    try {
      position = await currentPosition();
    } catch (error) {
      ctx.failed = { kind, reason: 'gps-denied' };
      checkinStatus.textContent = error?.code === 1
        ? 'Location is blocked for this site. Allow location in your browser settings and try again, or send this for review.'
        : 'Your phone could not find its position. Go near a window or outside and try again, or send this for review.';
      checkinReviewBox.hidden = false;
      return;
    }
    const { latitude, longitude, accuracy } = position.coords;
    if (accuracy > ctx.loc.maxAccuracyM) {
      ctx.failed = { kind, reason: 'gps-weak', lat: latitude, lng: longitude, accuracy: Math.round(accuracy * 10) / 10 };
      checkinStatus.textContent = 'Your GPS is only accurate to about ' + Math.round(accuracy) + ' m, and ' + ctx.loc.maxAccuracyM
        + ' m or better is needed. Go near a window or outside and try again, or send this for review.';
      checkinReviewBox.hidden = false;
      return;
    }
    const away = metresFromSchool(ctx.loc, latitude, longitude);
    if (away > ctx.loc.radiusM) {
      checkinStatus.textContent = 'You are about ' + Math.round(away) + ' m from the school. You must be within ' + ctx.loc.radiusM + ' m to ' + checkinKindLabel[kind].toLowerCase() + '.';
      return;
    }
    const { doc, setDoc, serverTimestamp } = firestoreTools;
    const day = schoolDay(ctx.loc);
    const id = day + '_' + ctx.uid + '_' + kind;
    if (ctx.loc.selfieRequired) {
      let photo;
      try {
        photo = await takeSelfie(ctx);
      } catch {
        if (request === schoolRequest) checkinStatus.textContent = 'Could not take the selfie. Allow camera access for this site and try again. If the camera does not work, use Missed Check-in to tell the principal.';
        return;
      }
      checkinStatus.textContent = 'Saving your selfie.';
      await setDoc(doc(ctx.schoolRef, 'staffSelfies', id), { staffUid: ctx.uid, date: day, kind, photo, at: serverTimestamp() });
    }
    await setDoc(doc(ctx.schoolRef, 'staffCheckins', id),
      { staffUid: ctx.uid, date: day, kind, at: serverTimestamp(), lat: latitude, lng: longitude, accuracy: Math.round(accuracy * 10) / 10, status: 'verified',
        ...(ctx.loc.qrRequired ? { qr: qrCode } : {}) });
    await refreshMyCheckin(request);
    if (request === schoolRequest) {
      checkinQrCode.value = '';
      checkinStatus.textContent = checkinKindLabel[kind] + ' saved. Thank you.';
    }
  } catch (error) {
    if (request !== schoolRequest) return;
    checkinStatus.textContent = error?.code === 'permission-denied'
      ? (ctx.loc.qrRequired
        ? 'The school server did not accept this. The QR code changes every minute, so scan the screen again. Also make sure your phone date and time are set to automatic. If it keeps happening, tell the principal.'
        : 'The school server did not accept this. Make sure your phone date and time are set to automatic, then try again. If it keeps happening, tell the principal.')
      : 'Could not save. Check your internet and try again.';
  } finally {
    if (request === schoolRequest) {
      ctx.busy = false;
      renderMyCheckin();
    }
  }
}

checkinInButton.addEventListener('click', () => attemptCheckin('in'));
checkinOutButton.addEventListener('click', () => attemptCheckin('out'));
checkinReviewSend.addEventListener('click', async () => {
  const ctx = myCheckin;
  if (!ctx?.loc || !ctx.failed || ctx.busy) return;
  const request = schoolRequest;
  const { kind, reason, lat, lng, accuracy } = ctx.failed;
  const note = checkinNote.value.trim().slice(0, 200);
  ctx.busy = true;
  renderMyCheckin();
  checkinStatus.textContent = 'Sending for review.';
  try {
    const { doc, setDoc, serverTimestamp } = firestoreTools;
    const day = schoolDay(ctx.loc);
    await setDoc(doc(ctx.schoolRef, 'staffCheckins', day + '_' + ctx.uid + '_' + kind),
      { staffUid: ctx.uid, date: day, kind, at: serverTimestamp(), status: 'review', reason, ...(note ? { note } : {}),
        ...(lat !== undefined ? { lat, lng, accuracy } : {}) });
    await refreshMyCheckin(request);
    if (request === schoolRequest) {
      checkinReviewBox.hidden = true;
      checkinNote.value = '';
      ctx.failed = null;
      checkinStatus.textContent = 'Sent. The principal will approve or reject it.';
    }
  } catch {
    if (request === schoolRequest) checkinStatus.textContent = 'Could not send it. Make sure your phone date and time are automatic, then try again.';
  } finally {
    if (request === schoolRequest) {
      ctx.busy = false;
      renderMyCheckin();
    }
  }
});

// Owner and principal view: one day's check-ins. Only the owner decides a review.
const checkinsSection = document.querySelector('#checkins');
const checkinsStatus = document.querySelector('#checkins-status');
const checkinsLocation = document.querySelector('#checkins-location');
const checkinsDate = document.querySelector('#checkins-date');
const checkinsBody = document.querySelector('#checkins-body');
let checkinsToken = 0;
let checkinsLoc = null;
let checkinsReady = false;

async function renderCheckins() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++checkinsToken;
  if (!tools || !DATE_TEXT.test(checkinsDate.value)) return;
  checkinsStatus.textContent = 'Loading check-ins.';
  try {
    if (!checkinsReady) {
      const found = await firestoreTools.getDocFromServer(firestoreTools.doc(tools.schoolRef, 'settings', 'location'));
      if (request !== schoolRequest || token !== checkinsToken) return;
      checkinsLoc = found.exists() ? found.data() : null;
      checkinsReady = true;
      checkinsLocation.textContent = checkinsLoc
        ? 'School location is set. Teachers must be within ' + checkinsLoc.radiusM + ' m, with GPS accurate to ' + checkinsLoc.maxAccuracyM + ' m or better.'
          + (checkinsLoc.qrRequired ? ' The school QR code is required.' : '') + (checkinsLoc.selfieRequired ? ' A live selfie is required.' : '')
        : 'The school map location is not set yet, so teachers cannot check in. AZIZ support sets it for you.';
    }
    const saved = await firestoreTools.getDocsFromServer(firestoreTools.query(firestoreTools.collection(tools.schoolRef, 'staffCheckins'),
      firestoreTools.where('date', '==', checkinsDate.value)));
    if (request !== schoolRequest || token !== checkinsToken) return;
    const byTeacher = new Map();
    for (const record of saved.docs) {
      const data = record.data();
      const entry = byTeacher.get(data.staffUid) ?? {};
      entry[data.kind] = { id: record.id, data };
      byTeacher.set(data.staffUid, entry);
    }
    checkinsBody.replaceChildren();
    const accepted = (found) => found && ['verified', 'approved'].includes(found.data.status);
    for (const [uid, entry] of [...byTeacher].sort((a, b) => a[0].localeCompare(b[0]))) {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = staffLabel(uid);
      tr.append(nameCell);
      for (const kind of ['in', 'out']) {
        const cell = document.createElement('td');
        const found = entry[kind];
        if (!found) cell.textContent = '-';
        else {
          const at = found.data.at?.toMillis ? schoolTime(checkinsLoc, found.data.at.toMillis()) : 'saved';
          const place = found.data.accuracy !== undefined && checkinsLoc && found.data.lat !== undefined
            ? ', ' + Math.round(metresFromSchool(checkinsLoc, found.data.lat, found.data.lng)) + ' m from school, GPS +/-' + Math.round(found.data.accuracy) + ' m' : '';
          cell.textContent = at + ' - ' + (CHECKIN_STATE[found.data.status] ?? found.data.status)
            + (found.data.status === 'review' ? ' (' + found.data.reason + (found.data.note ? ': ' + found.data.note : '') + ')' : '') + place;
        }
        tr.append(cell);
      }
      const worked = document.createElement('td');
      if (accepted(entry.in) && accepted(entry.out) && entry.in.data.at?.toMillis && entry.out.data.at?.toMillis) {
        const minutes = Math.max(0, Math.round((entry.out.data.at.toMillis() - entry.in.data.at.toMillis()) / 60000));
        worked.textContent = Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
      } else worked.textContent = '-';
      tr.append(worked);
      const selfieCell = document.createElement('td');
      for (const kind of ['in', 'out']) {
        const found = entry[kind];
        if (!found) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Show ' + kind + ' selfie';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const photo = await firestoreTools.getDocFromServer(firestoreTools.doc(tools.schoolRef, 'staffSelfies', found.id));
            const url = photo.exists() ? photo.data().photo : '';
            if (typeof url === 'string' && url.startsWith('data:image/jpeg;base64,')) {
              const image = document.createElement('img');
              image.src = url;
              image.alt = 'Selfie at ' + kind;
              image.width = 100;
              image.height = 100;
              button.replaceWith(image);
            } else button.replaceWith(document.createTextNode('No ' + kind + ' selfie'));
          } catch {
            button.disabled = false;
            if (request === schoolRequest) checkinsStatus.textContent = 'Could not load the selfie. Try again.';
          }
        });
        selfieCell.append(button, ' ');
      }
      if (!selfieCell.childNodes.length) selfieCell.textContent = '-';
      tr.append(selfieCell);
      const decision = document.createElement('td');
      for (const kind of ['in', 'out']) {
        const found = entry[kind];
        if (!found || found.data.status !== 'review' || viewOnly) continue;
        for (const next of ['approved', 'rejected']) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = (next === 'approved' ? 'Approve ' : 'Reject ') + kind;
          button.addEventListener('click', async () => {
            if (tools.busy) return;
            tools.busy = true;
            checkinsStatus.textContent = 'Saving decision.';
            try {
              await tools.save('staffCheckins', found.id, { ...found.data, status: next, reviewedBy: auth.currentUser.uid });
              tools.busy = false;
              if (request === schoolRequest) await renderCheckins();
            } catch {
              if (request === schoolRequest) checkinsStatus.textContent = 'Could not save the decision. Try again.';
            } finally {
              tools.busy = false;
            }
          });
          decision.append(button, ' ');
        }
      }
      if (!decision.childNodes.length) decision.textContent = '-';
      tr.append(decision);
      checkinsBody.append(tr);
    }
    checkinsStatus.textContent = byTeacher.size ? byTeacher.size + ' teacher(s) checked in or out on ' + checkinsDate.value + '.' : 'No check-ins on this date.';
  } catch {
    if (request === schoolRequest && token === checkinsToken) checkinsStatus.textContent = 'Could not load check-ins. Try again.';
  }
}
checkinsDate.addEventListener('change', renderCheckins);
// Check-ins are read only when the owner opens this module, to save database reads.
checkinsSection.addEventListener('mod-open', () => { if (!checkinsDate.value) checkinsDate.value = checkinsLoc ? schoolDay(checkinsLoc) : localToday(); renderCheckins(); });
function startCheckins() {
  checkinsSection.hidden = false;
}
function resetCheckins() {
  checkinsSection.hidden = true;
  checkinsToken += 1;
  checkinsLoc = null;
  checkinsReady = false;
  checkinsBody.replaceChildren();
  checkinsStatus.textContent = '';
  checkinsLocation.textContent = '';
  checkinsDate.value = '';
}
function resetMyCheckin() {
  stopQrScan();
  checkinQrBox.hidden = true;
  checkinSelfieBox.hidden = true;
  checkinQrCode.value = '';
  checkinSection.hidden = true;
  myCheckin = undefined;
  checkinToday.replaceChildren();
  checkinStatus.textContent = '';
  checkinReviewBox.hidden = true;
  checkinNote.value = '';
}

// Missed check-in (feature 133). A teacher whose check-in did not work says what time they came and left; the owner decides.
const disputeSection = document.querySelector('#dispute');
const disputeStatus = document.querySelector('#dispute-status');
const disputeForm = document.querySelector('#dispute-form');
const disputeList = document.querySelector('#dispute-list');
let myDispute; // { schoolRef, uid, busy }
const DISPUTE_STATE = { open: 'waiting for the owner', approved: 'approved', rejected: 'rejected' };

async function refreshMyDisputes(request) {
  const ctx = myDispute;
  const { collection, getDocsFromServer, query, where } = firestoreTools;
  const saved = await getDocsFromServer(query(collection(ctx.schoolRef, 'attendanceDisputes'), where('staffUid', '==', ctx.uid)));
  if (request !== schoolRequest) return;
  disputeList.replaceChildren();
  const rows = saved.docs.map((record) => record.data()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  for (const item of rows) {
    const li = document.createElement('li');
    li.textContent = item.date + ' - came ' + (item.inTime ?? '-') + ', left ' + (item.outTime ?? '-') + ' - ' + (DISPUTE_STATE[item.status] ?? item.status)
      + (item.reviewNote ? ' (' + item.reviewNote + ')' : '');
    disputeList.append(li);
  }
}

async function loadMyDispute(request, schoolRef, uid) {
  disputeSection.hidden = false;
  myDispute = { schoolRef, uid, busy: false };
  try {
    await refreshMyDisputes(request);
  } catch {
    if (request === schoolRequest) disputeStatus.textContent = 'Could not load your earlier requests. Try again later.';
  }
}

disputeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ctx = myDispute;
  if (!ctx || ctx.busy) return;
  const request = schoolRequest;
  const form = new FormData(disputeForm);
  const date = String(form.get('date') ?? '');
  const inTime = String(form.get('inTime') ?? '');
  const outTime = String(form.get('outTime') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  if (!myCheckin?.loc) { disputeStatus.textContent = 'Your school has not set its map location yet, so this cannot be sent. Please tell the school owner.'; return; }
  if (!DATE_TEXT.test(date) || date > schoolDay(myCheckin.loc)) { disputeStatus.textContent = 'Choose today or an earlier day.'; return; }
  if (!inTime && !outTime) { disputeStatus.textContent = 'Enter the time you came, the time you left, or both.'; return; }
  if (reason.length < 3) { disputeStatus.textContent = 'Write the reason in a few words.'; return; }
  ctx.busy = true;
  disputeStatus.textContent = 'Sending.';
  try {
    const { doc, setDoc, serverTimestamp } = firestoreTools;
    await setDoc(doc(ctx.schoolRef, 'attendanceDisputes', date + '_' + ctx.uid),
      { staffUid: ctx.uid, date, reason: reason.slice(0, 300), ...(inTime ? { inTime } : {}), ...(outTime ? { outTime } : {}), status: 'open', createdAt: serverTimestamp() });
    await refreshMyDisputes(request);
    if (request === schoolRequest) {
      disputeForm.reset();
      disputeStatus.textContent = 'Sent. The owner will approve or reject it.';
    }
  } catch (error) {
    if (request === schoolRequest) disputeStatus.textContent = error?.code === 'permission-denied'
      ? 'Could not send. You may already have sent a request for that date.'
      : 'Could not send. Check your internet and try again.';
  } finally {
    ctx.busy = false;
  }
});
function resetMyDispute() {
  disputeSection.hidden = true;
  myDispute = undefined;
  disputeStatus.textContent = '';
  disputeList.replaceChildren();
  disputeForm.reset();
}

// School QR screen (features 129, 158). The owner's or principal's screen posts a fresh random code every minute. The code
// is saved with the server time, so the rules accept it for 150 seconds. Teachers cannot read it; they must see the screen.
const qrSection = document.querySelector('#qr-screen');
const qrStatus = document.querySelector('#qr-status');
const qrStart = document.querySelector('#qr-start');
const qrStop = document.querySelector('#qr-stop');
const qrCanvas = document.querySelector('#qr-canvas');
const qrCodeText = document.querySelector('#qr-code');
const QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let qrTimer = 0;
let qrLast = '';
let qrStartedAt = 0;
let qrBusy = false;
const newQrCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => QR_ALPHABET[byte % 32]).join('');

async function postQrCode(request) {
  const tools = academic;
  if (!tools || qrBusy) return;
  if (Date.now() - qrStartedAt > 12 * 3600000) { stopQrScreen('The QR screen stopped after 12 hours. Press Start to show it again.'); return; }
  qrBusy = true;
  try {
    const code = newQrCode();
    const { doc, setDoc, serverTimestamp } = firestoreTools;
    await setDoc(doc(tools.schoolRef, 'settings', 'qrCode'), { code, ...(qrLast ? { prev: qrLast } : {}), at: serverTimestamp() });
    qrLast = code;
    if (request !== schoolRequest || !qrTimer) return;
    const { drawQr } = await import('./qr.mjs?v=batch-64');
    drawQr(qrCanvas, 'AZIZ:' + code, 280);
    qrCanvas.hidden = false;
    qrCodeText.textContent = code.slice(0, 4) + ' ' + code.slice(4);
    qrStatus.textContent = 'Showing the code. It changes every minute. Keep this page open on this screen.';
  } catch {
    if (request === schoolRequest) qrStatus.textContent = 'Could not post a new code. Check the internet. Trying again in a minute.';
  } finally {
    qrBusy = false;
  }
}
function stopQrScreen(message = '') {
  clearInterval(qrTimer);
  qrTimer = 0;
  qrLast = '';
  qrCanvas.hidden = true;
  qrCodeText.textContent = '';
  qrStart.hidden = false;
  qrStop.hidden = true;
  qrStatus.textContent = message;
}
qrStart.addEventListener('click', () => {
  if (qrTimer || !academic) return;
  const request = schoolRequest;
  qrStartedAt = Date.now();
  qrStart.hidden = true;
  qrStop.hidden = false;
  qrStatus.textContent = 'Starting.';
  qrTimer = setInterval(() => postQrCode(request), 60000);
  postQrCode(request);
});
qrStop.addEventListener('click', () => stopQrScreen('Stopped. Teachers cannot scan until you start it again.'));
function startQrScreen() { qrSection.hidden = false; }

// Fixed banner while a super administrator is inside a school: who, what, until when, and the way to ask for a short sensitive pass.
function showSuperBanner(user, schoolId, name, pass) {
  document.querySelector('#super-banner')?.remove();
  const bar = document.createElement('div'); bar.id = 'super-banner';
  const text = document.createElement('span');
  const until = new Date(pass.expiresAt.toMillis()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  text.textContent = 'Super admin view of ' + name + '. Read only. Access pass ends at ' + until + '. Everything you open is recorded.';
  const ask = document.createElement('button'); ask.type = 'button'; ask.textContent = 'Request sensitive access (15 min)';
  const leave = document.createElement('a'); leave.href = '/admin'; leave.textContent = 'Leave school';
  ask.addEventListener('click', async () => {
    const reason = (prompt('Why do you need sensitive records (medical, identity, payroll, private family information)? At least 10 characters. This is kept in the audit log.') || '').trim();
    if (reason.length < 10) return;
    ask.disabled = true;
    try {
      const fs = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
      const db = fs.getFirestore(app);
      const auditId = 'A-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'platformAudit', auditId), { actor: user.uid, actorEmail: user.email || '', action: 'open-school-sensitive', schoolId, reason: reason.slice(0, 300), detail: 'sensitive records, 12 minutes', at: fs.serverTimestamp() });
      batch.set(fs.doc(db, 'platformGrants', user.uid + '_' + schoolId + '_sensitive'), { schoolId, tier: 'sensitive', reason: reason.slice(0, 300), createdBy: user.uid, createdAt: fs.serverTimestamp(), expiresAt: fs.Timestamp.fromMillis(Date.now() + 12 * 60000), auditId });
      await batch.commit();
      alert('Sensitive access granted for 12 minutes. The page will reload.');
      location.reload();
    } catch (error) {
      ask.disabled = false;
      alert(error && String(error.code).includes('permission') ? 'Sensitive access was refused. If MFA is required, sign in with your second factor first.' : 'Could not create the pass.');
    }
  });
  bar.append(text, ask, leave);
  document.body.prepend(bar);
  document.body.classList.add('has-super-banner');
}

// Messages from the platform (announcements, payment and renewal notices, maintenance) at the top of the owner's dashboard.
async function showPlatformInbox(schoolRef) {
  try {
    document.querySelector('#platform-inbox')?.remove();
    const fs = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
    const snap = await fs.getDocs(fs.query(fs.collection(schoolRef, 'platformInbox'), fs.orderBy('at', 'desc'), fs.limit(10)));
    const items = snap.docs.filter((d) => !d.data().readAt);
    if (!items.length) return;
    const box = document.createElement('section'); box.id = 'platform-inbox';
    const head = document.createElement('h3'); head.textContent = 'Messages from AZIZ (' + items.length + ' new)';
    box.append(head);
    for (const d of items) {
      const data = d.data();
      const row = document.createElement('div'); row.className = 'inbox-row';
      const title = document.createElement('strong'); title.textContent = data.title;
      const text = document.createElement('p'); text.textContent = data.body;
      const done = document.createElement('button'); done.type = 'button'; done.textContent = 'Mark as read';
      done.addEventListener('click', async () => {
        done.disabled = true;
        try { await fs.updateDoc(d.ref, { readAt: fs.serverTimestamp() }); row.remove(); if (!box.querySelector('.inbox-row')) box.remove(); } catch { done.disabled = false; }
      });
      row.append(title, text, done); box.append(row);
    }
    dashboard.prepend(box);
  } catch { /* the inbox is a convenience; the dashboard works without it */ }
}

// One sign-in record per browser session, so the super admin can see an owner's last sign-in.
async function recordLogin(user) {
  try {
    if (sessionStorage.getItem('aziz-login-logged') === user.uid) return;
    const fs = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
    const stamp = String(9999999999999 - Date.now()).padStart(13, '0');
    let mfa;
    try { const au = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'); mfa = au.multiFactor(user).enrolledFactors.length > 0; } catch { mfa = undefined; }
    await fs.setDoc(fs.doc(fs.getFirestore(app), 'loginHistory', user.uid + '_' + stamp), { uid: user.uid, email: user.email || '', agent: String(navigator.userAgent || '').slice(0, 160), ...(typeof mfa === 'boolean' ? { mfa } : {}), at: fs.serverTimestamp() });
    sessionStorage.setItem('aziz-login-logged', user.uid);
  } catch { /* history is best effort */ }
}
// Sends an uncaught browser error to the platform so the super admin can see it (signed-in users only, at most 3 different errors per visit).
let errorReportsSent = 0;
const errorReportsSeen = new Set();
async function sendErrorReport(message) {
  try {
    const text = String(message || '').slice(0, 300);
    if (!text || errorReportsSent >= 3 || errorReportsSeen.has(text) || /ResizeObserver|^Script error/.test(text)) return;
    const au = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
    const user = au.getAuth(app).currentUser;
    if (!user) return;
    errorReportsSent += 1; errorReportsSeen.add(text);
    const fs = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
    const id = 'E-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    await fs.setDoc(fs.doc(fs.getFirestore(app), 'errorReports', id), { uid: user.uid, message: text, page: (location.pathname + location.hash).slice(0, 120), agent: String(navigator.userAgent || '').slice(0, 160), at: fs.serverTimestamp() });
  } catch { /* reporting must never cause another error */ }
}
addEventListener('error', (event) => {
  if (event.filename && !String(event.filename).startsWith(location.origin)) return;
  sendErrorReport(String(event.message || '') + (event.filename ? ' @ ' + String(event.filename).split('/').pop().split('?')[0] + ':' + event.lineno : ''));
});
addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  sendErrorReport('Promise: ' + (reason && reason.message ? reason.message : String(reason)));
});
function resetQrScreen() {
  stopQrScreen('');
  qrSection.hidden = true;
}

// Missed check-in requests for the owner and principal. Only the owner decides.
const disputesSection = document.querySelector('#disputes');
const disputesStatus = document.querySelector('#disputes-status');
const disputesBody = document.querySelector('#disputes-body');
let disputesToken = 0;

async function renderDisputes() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++disputesToken;
  if (!tools) return;
  disputesStatus.textContent = 'Loading requests.';
  try {
    const { collection, getDocsFromServer, query, where } = firestoreTools;
    const saved = await getDocsFromServer(query(collection(tools.schoolRef, 'attendanceDisputes'), where('status', '==', 'open')));
    if (request !== schoolRequest || token !== disputesToken) return;
    disputesBody.replaceChildren();
    const rows = saved.docs.map((record) => ({ id: record.id, data: record.data() })).sort((a, b) => a.data.date.localeCompare(b.data.date) || a.id.localeCompare(b.id));
    for (const found of rows) {
      addRow(disputesBody, [found.data.date, staffLabel(found.data.staffUid), found.data.inTime ?? '-', found.data.outTime ?? '-', found.data.reason, '']);
      const cell = disputesBody.lastElementChild.lastElementChild;
      cell.textContent = viewOnly ? '-' : '';
      if (viewOnly) continue;
      for (const next of ['approved', 'rejected']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = next === 'approved' ? 'Approve' : 'Reject';
        button.addEventListener('click', async () => {
          if (tools.busy) return;
          tools.busy = true;
          disputesStatus.textContent = 'Saving decision.';
          try {
            await tools.save('attendanceDisputes', found.id, { ...found.data, status: next, reviewedBy: auth.currentUser.uid });
            tools.busy = false;
            if (request === schoolRequest) await renderDisputes();
          } catch {
            if (request === schoolRequest) disputesStatus.textContent = 'Could not save the decision. Try again.';
          } finally {
            tools.busy = false;
          }
        });
        cell.append(button, ' ');
      }
    }
    disputesStatus.textContent = rows.length ? rows.length + ' request(s) waiting.' : 'No requests waiting.';
  } catch {
    if (request === schoolRequest && token === disputesToken) disputesStatus.textContent = 'Could not load requests. Try again.';
  }
}
document.querySelector('#disputes-refresh').addEventListener('click', renderDisputes);
disputesSection.addEventListener('mod-open', renderDisputes);
function startDisputes() { disputesSection.hidden = false; }
function resetDisputes() {
  disputesSection.hidden = true;
  disputesToken += 1;
  disputesBody.replaceChildren();
  disputesStatus.textContent = '';
}

// Shifts, hours and the payroll check (features 132, 134). The shift decides what counts as late and overtime. The monthly
// table works out days at school, late days, hours and overtime from verified or approved check-ins and approved requests,
// and sets them beside the principal's own attendance marks and the salary record. It reads only when the owner presses the button.
const hoursSection = document.querySelector('#hours');
const shiftForm = document.querySelector('#shift-form');
const shiftStatus = document.querySelector('#shift-status');
const hoursMonth = document.querySelector('#hours-month');
const hoursStatus = document.querySelector('#hours-status');
const hoursBody = document.querySelector('#hours-body');
const SHIFT_DEFAULT = { start: '09:00', end: '17:00', graceMin: 10, breakMin: 30 };
let shiftSaved = null;
let shiftLoaded = false;
let hoursToken = 0;
let hoursBusy = false;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hoursText = (minutes) => Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';

async function loadShift() {
  const tools = academic;
  const request = schoolRequest;
  if (!tools || shiftLoaded) return;
  try {
    const found = await firestoreTools.getDocFromServer(firestoreTools.doc(tools.schoolRef, 'settings', 'shift'));
    if (request !== schoolRequest) return;
    shiftLoaded = true;
    shiftSaved = found.exists() ? found.data() : null;
    const values = shiftSaved ?? SHIFT_DEFAULT;
    for (const name of ['start', 'end', 'graceMin', 'breakMin']) shiftForm.elements.namedItem(name).value = values[name];
    for (const control of shiftForm.elements) control.disabled = viewOnly;
    shiftStatus.textContent = shiftSaved ? 'Shift saved.' : 'No shift saved yet. Hours are worked out with ' + SHIFT_DEFAULT.start + ' to ' + SHIFT_DEFAULT.end + ' until you save one.';
  } catch {
    if (request === schoolRequest) shiftStatus.textContent = 'Could not load the shift. Try again.';
  }
}
shiftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  const request = schoolRequest;
  if (!tools || viewOnly || hoursBusy) return;
  const form = new FormData(shiftForm);
  const start = String(form.get('start') ?? '');
  const end = String(form.get('end') ?? '');
  const graceMin = Number(form.get('graceMin'));
  const breakMin = Number(form.get('breakMin'));
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(start) || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(end) || end <= start) { shiftStatus.textContent = 'The shift must end after it starts.'; return; }
  if (!Number.isInteger(graceMin) || graceMin < 0 || graceMin > 120) { shiftStatus.textContent = 'Grace must be a whole number from 0 to 120 minutes.'; return; }
  if (!Number.isInteger(breakMin) || breakMin < 0 || breakMin > 240) { shiftStatus.textContent = 'Break must be a whole number from 0 to 240 minutes.'; return; }
  hoursBusy = true;
  shiftStatus.textContent = 'Saving.';
  try {
    const data = { start, end, graceMin, breakMin };
    await firestoreTools.setDoc(firestoreTools.doc(tools.schoolRef, 'settings', 'shift'), data);
    shiftSaved = data;
    if (request === schoolRequest) shiftStatus.textContent = 'Shift saved.';
  } catch {
    if (request === schoolRequest) shiftStatus.textContent = 'Could not save the shift. Try again.';
  } finally {
    hoursBusy = false;
  }
});

async function runHours() {
  const tools = academic;
  const request = schoolRequest;
  const token = ++hoursToken;
  if (!tools || hoursBusy) return;
  const month = hoursMonth.value;
  if (!/^[0-9]{4}-[0-9]{2}$/.test(month)) { hoursStatus.textContent = 'Choose a month.'; return; }
  hoursBusy = true;
  hoursBody.replaceChildren();
  hoursStatus.textContent = 'Working out the month. This reads every check-in of the month once.';
  try {
    const { collection, doc, getDocFromServer, getDocsFromServer, query, where } = firestoreTools;
    const from = month + '-01';
    const to = month + '-31';
    const range = (name) => getDocsFromServer(query(collection(tools.schoolRef, name), where('date', '>=', from), where('date', '<=', to)));
    const [locFound, checkSnap, disputeSnap, markSnap, payrollSnap] = await Promise.all([
      getDocFromServer(doc(tools.schoolRef, 'settings', 'location')),
      range('staffCheckins'), range('attendanceDisputes'), tools.staffAttendanceBetween(from, to),
      getDocsFromServer(query(collection(tools.schoolRef, 'payroll'), where('month', '==', month))).catch(() => null),
    ]);
    if (request !== schoolRequest || token !== hoursToken) return;
    const loc = locFound.exists() ? locFound.data() : null;
    if (!loc) { hoursStatus.textContent = 'The school map location is not set, so check-in times cannot be read. AZIZ support sets it.'; return; }
    const shift = shiftSaved ?? SHIFT_DEFAULT;
    const startMin = minutesOf(shift.start);
    const scheduled = minutesOf(shift.end) - startMin - shift.breakMin;
    const days = new Map(); // uid -> date -> { in, out } in minutes of the school day
    const slot = (uid, date) => {
      if (!days.has(uid)) days.set(uid, new Map());
      if (!days.get(uid).has(date)) days.get(uid).set(date, {});
      return days.get(uid).get(date);
    };
    for (const record of checkSnap.docs) {
      const item = record.data();
      if (!['verified', 'approved'].includes(item.status) || !item.at?.toMillis) continue;
      slot(item.staffUid, item.date)[item.kind] = minutesOf(schoolTime(loc, item.at.toMillis()).slice(0, 5));
    }
    for (const record of disputeSnap.docs) {
      const item = record.data();
      if (item.status !== 'approved') continue;
      const day = slot(item.staffUid, item.date);
      if (item.inTime && day.in === undefined) day.in = minutesOf(item.inTime);
      if (item.outTime && day.out === undefined) day.out = minutesOf(item.outTime);
    }
    const marked = new Map();
    for (const record of markSnap.docs) {
      const item = record.data();
      if (item.status === 'present' || item.status === 'late') marked.set(item.staffUid, (marked.get(item.staffUid) ?? 0) + 1);
    }
    const pay = new Map((payrollSnap?.docs ?? []).map((record) => [record.data().staffUid, record.data()]));
    for (const uid of staffRoster) {
      let present = 0; let late = 0; let worked = 0; let overtime = 0;
      for (const day of (days.get(uid) ?? new Map()).values()) {
        if (day.in === undefined) continue;
        present += 1;
        if (day.in > startMin + shift.graceMin) late += 1;
        if (day.out !== undefined && day.out > day.in) {
          const net = Math.max(0, day.out - day.in - shift.breakMin);
          worked += net;
          overtime += Math.max(0, net - scheduled);
        }
      }
      const byPrincipal = marked.get(uid) ?? 0;
      const salary = pay.get(uid);
      let check;
      if (present !== byPrincipal) check = 'Differs: ' + present + ' by check-in, ' + byPrincipal + ' marked';
      else if (salary && present === 0) check = 'Salary record but no attendance';
      else check = salary || !payrollSnap ? 'Matches' : 'Matches (no salary record)';
      addRow(hoursBody, [staffLabel(uid), String(present), String(byPrincipal), String(late), hoursText(worked), hoursText(overtime),
        !payrollSnap ? 'not shown' : salary ? 'net ' + rupees(salary.basic + salary.allowances - salary.deductions) + (salary.paidOn ? ', paid' : ', NOT PAID') : 'none', check]);
    }
    hoursStatus.textContent = (staffRoster.length ? 'Counted from verified or approved check-ins and approved requests. Shift ' + shift.start + ' to ' + shift.end
      + ', grace ' + shift.graceMin + ' min, break ' + shift.breakMin + ' min.' : 'No active teacher accounts yet.')
      + (shiftSaved ? '' : ' (No shift saved, so the default is used.)');
  } catch {
    if (request === schoolRequest && token === hoursToken) hoursStatus.textContent = 'Could not work out the month. Try again.';
  } finally {
    hoursBusy = false;
  }
}
document.querySelector('#hours-run').addEventListener('click', runHours);
hoursSection.addEventListener('mod-open', () => { if (!hoursMonth.value) hoursMonth.value = localToday().slice(0, 7); loadShift(); });
function startHours() { hoursSection.hidden = false; }
function resetHours() {
  hoursSection.hidden = true;
  hoursToken += 1;
  hoursBusy = false;
  shiftSaved = null;
  shiftLoaded = false;
  hoursBody.replaceChildren();
  hoursStatus.textContent = '';
  shiftStatus.textContent = '';
  hoursMonth.value = '';
  shiftForm.reset();
  for (const control of shiftForm.elements) control.disabled = false;
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

// Fees for one student in one year. Concessions given in the year are taken off the total, latest instalments first.
// Payments count against the earliest instalments first, so "overdue" is what has fallen due by today and is still unpaid.
// Transport: the route's monthly fee times the months the owner agreed with the parent (0 to 12 on the rider record).
// It is added to the fees of the active year only. A student who joins late simply has fewer months.
let transportData = { routes: [], riders: [] };
function transportChargeFor(studentId) {
  const rider = transportData.riders.find((record) => record.id === studentId)?.data();
  if (!rider?.months) return 0;
  return (transportData.routes.find((record) => record.id === rider.routeId)?.data().monthlyFee ?? 0) * rider.months;
}
function feeSummaryFor(studentId, yearId, classId) {
  const heads = feeData.structures.filter((item) => item.data().yearId === yearId && item.data().classId === classId).map((item) => item.data());
  const transport = activeYearRecord()?.id === yearId ? transportChargeFor(studentId) : 0;
  const gross = heads.reduce((sum, item) => sum + item.amount, 0) + transport;
  const year = examData.years.find((record) => record.id === yearId)?.data();
  const concession = (lists.concessions?.items ?? []).map((record) => record.data())
    .filter((item) => item.studentId === studentId && (!year || (item.givenOn >= year.startDate && item.givenOn <= year.endDate)))
    .reduce((sum, item) => sum + item.amount, 0);
  const due = Math.max(0, gross - concession);
  const paid = feeData.payments.filter((item) => item.data().studentId === studentId && item.data().yearId === yearId
    && item.data().voided !== true).reduce((sum, item) => sum + item.data().amount, 0);
  const today = localToday();
  const dueByToday = heads.filter((item) => !item.dueOn || item.dueOn <= today).reduce((sum, item) => sum + item.amount, 0) + transport;
  const concessionOnPast = Math.max(0, concession - (gross - dueByToday));
  const overdue = Math.max(0, dueByToday - concessionOnPast - paid);
  return { gross, concession, due, paid, balance: due - paid, overdue, transport };
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
      listItem(feeStructureList, className(item.data().classId) + ' - ' + item.data().name + ': ' + rupees(item.data().amount) + (item.data().dueOn ? ' (due ' + item.data().dueOn + ')' : ''), button);
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
  const { gross, concession, due, paid, balance, overdue, transport } = feeSummaryFor(studentId, year.id, placement.data().classId);
  feeBalanceSummary.textContent = 'Fees ' + rupees(gross) + (transport ? ' (includes transport ' + rupees(transport) + ')' : '') + (concession ? ', concession -' + rupees(concession) : '') + ', due ' + rupees(due) + ', paid ' + rupees(paid) + ', balance ' + rupees(balance)
    + (overdue ? ', overdue ' + rupees(overdue) : '');
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

// The fee office login (role accountant) sees only the fees: the students, classes and years that
// the fee screens need, the fee structures, payments, receipts and concessions.
async function loadFeeOffice(request) {
  const tools = academic;
  try {
    const [years, classes, students, enrollments] = await Promise.all(['academicYears', 'classes', 'students', 'enrollments'].map((name) => tools.list(name)));
    if (request !== schoolRequest) return;
    studentRecords = students.docs;
    placementData = { years: years.docs, classes: classes.docs, sections: [], enrollments: enrollments.docs };
    examData = { years: years.docs, classes: classes.docs, subjects: [], mappings: [], exams: [] };
    const [routeDocs, riderDocs] = await Promise.all([tools.list('routes').catch(() => ({ docs: [] })), tools.list('transportRiders').catch(() => ({ docs: [] }))]);
    if (request !== schoolRequest) return;
    transportData = { routes: routeDocs.docs, riders: riderDocs.docs };
    await loadFees(request);
    if (request === schoolRequest) await lists.concessions.load(request);
  } catch {
    if (request === schoolRequest) schoolStatus.hidden = false, schoolStatus.textContent = 'Could not load the fee records. Refresh to try again.';
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
  const dueOn = String(fields.get('dueOn') ?? '');
  if (dueOn && !DATE_TEXT.test(dueOn)) {
    feesStatus.textContent = 'Enter the due date as a date.';
    return;
  }
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
    await academic.save('feeStructures', year.id + '_' + classId + '_' + head, { yearId: year.id, classId, head, name, amount, ...(dueOn ? { dueOn } : {}) });
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
  if (portalRole === 'student') { portalFeesSection.hidden = true; return; } // fees are for the parent
  portalFeesSection.hidden = false;
  portalFeesStatus.textContent = 'Loading fees.';
  try {
    const { doc, getDocFromServer } = tools;
    const [placements, structures, payments, concessionDocs, riderDoc] = await Promise.all([
      getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId))),
      getDocsFromServer(collection(schoolRef, 'feeStructures')),
      getDocsFromServer(query(collection(schoolRef, 'payments'), where('studentId', '==', studentId))),
      getDocsFromServer(query(collection(schoolRef, 'concessions'), where('studentId', '==', studentId))).catch(() => ({ docs: [] })),
      getDocFromServer(doc(schoolRef, 'transportRiders', studentId)).catch(() => null),
    ]);
    // Transport: monthly route fee times the months the school agreed with the parent. Like concessions, it goes on the latest year.
    let transportCharge = 0;
    let transportNote = '';
    const rider = riderDoc?.exists() ? riderDoc.data() : null;
    if (rider?.months) {
      const route = await getDocFromServer(doc(schoolRef, 'routes', rider.routeId)).catch(() => null);
      const monthly = route?.exists() ? route.data().monthlyFee ?? 0 : 0;
      transportCharge = monthly * rider.months;
      transportNote = monthly ? 'transport ' + rupees(monthly) + ' x ' + rider.months + ' month(s)' : '';
    }
    let transportUsed = false;
    // The family cannot read academic years, so concessions are applied to the latest year only.
    const concessionTotal = concessionDocs.docs.reduce((sum, record) => sum + record.data().amount, 0);
    let concessionUsed = false;
    let balanceTotal = 0;
    if (request !== schoolRequest) return;
    portalFeesSummary.replaceChildren();
    portalFeesBody.replaceChildren();
    const paidList = payments.docs.map((record) => record.data());
    for (const placement of placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))) {
      const heads = structures.docs.map((record) => record.data())
        .filter((item) => item.yearId === placement.yearId && item.classId === placement.classId);
      const transport = transportUsed ? 0 : transportCharge;
      transportUsed = true;
      const gross = heads.reduce((sum, item) => sum + item.amount, 0) + transport;
      const concession = concessionUsed ? 0 : Math.min(concessionTotal, gross);
      concessionUsed = true;
      const due = gross - concession;
      const paid = paidList.filter((item) => item.yearId === placement.yearId && item.voided !== true)
        .reduce((sum, item) => sum + item.amount, 0);
      balanceTotal += due - paid;
      listItem(portalFeesSummary, placement.yearId + ': due ' + rupees(due) + (concession ? ' (after concession ' + rupees(concession) + ')' : '') + ', paid ' + rupees(paid)
        + ', balance ' + rupees(due - paid)
        + (heads.length || transport ? ' (' + [...heads.map((item) => item.name + ' ' + rupees(item.amount)), ...(transport ? [transportNote] : [])].join(', ') + ')' : ''));
    }
    for (const payment of paidList.sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo))) {
      addRow(portalFeesBody, [payment.receiptNo, payment.date, METHOD_LABEL[payment.method], rupees(payment.amount),
        payment.voided === true ? 'Voided' : 'Paid']);
    }
    portalFeesStatus.textContent = placements.empty && payments.empty ? 'No fee records yet.' : '';
    portalHome.due = Math.max(0, balanceTotal);
    renderPortalHome();
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
let noticeAckCount = new Map();
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
    listItem(noticeList, '[' + audienceLabel(item.data) + '] ' + noticeText(item.data) + (noticeAckCount.get(item.id) ? ' - confirmed by ' + noticeAckCount.get(item.id) + ' famil' + (noticeAckCount.get(item.id) === 1 ? 'y' : 'ies') : ''), button);
  }
  if (!noticeData.length) noticesStatus.textContent = 'No notices yet.';
}

async function loadNotices(request) {
  try {
    const saved = await academic.list('notices');
    if (request !== schoolRequest) return;
    noticeData = saved.docs.map((record) => ({ id: record.id, data: record.data() }));
    noticeAckCount = new Map();
    try { for (const record of (await academic.list('noticeAcks')).docs) noticeAckCount.set(record.data().noticeId, (noticeAckCount.get(record.data().noticeId) ?? 0) + 1); } catch { /* No counts shown. */ }
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
    await addNoticeAcks(tools, studentId, items);
  } catch {
    if (request === schoolRequest) portalNoticesStatus.textContent = 'Could not load notices. Try again.';
  }
}

// Acknowledgements (feature 150): the family taps "Got it" once on a notice; the school sees how many have.
async function addNoticeAcks(tools, studentId, items) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  let done;
  try {
    done = new Set((await getDocsFromServer(query(collection(schoolRef, 'noticeAcks'), where('by', '==', uid)))).docs.map((record) => record.id));
  } catch { return; }
  [...portalNoticesList.children].forEach((row, index) => {
    const item = items[index];
    if (!item) return;
    const ackId = item.id + '_' + studentId;
    if (done.has(ackId)) { row.append(' (You confirmed you have seen this.)'); return; }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Got it';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { doc, setDoc } = firestoreTools;
        await setDoc(doc(schoolRef, 'noticeAcks', ackId), { noticeId: item.id, studentId, studentName: portalHome.name || studentId, by: uid, on: localToday() });
        button.replaceWith(document.createTextNode('(You confirmed you have seen this.)'));
      } catch {
        button.disabled = false;
        portalNoticesStatus.textContent = 'Could not save. Check your connection and try again.';
      }
    });
    row.append(' ', button);
  });
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

let auditItems = [];
function renderAuditSummary(items) {
  const target = document.querySelector('#audit-summary');
  target.replaceChildren();
  const hours = (n) => new Date(Date.now() - n * 3600000).toISOString();
  const day = items.filter((item) => item.at >= hours(24));
  const week = items.filter((item) => item.at >= hours(168));
  listItem(target, 'Last 24 hours: ' + day.length + ' change(s). Last 7 days: ' + week.length + ' change(s).');
  const byAction = new Map();
  for (const item of week) byAction.set(item.action, (byAction.get(item.action) ?? 0) + 1);
  if (byAction.size) listItem(target, 'This week by type: ' + [...byAction].sort((a, b) => b[1] - a[1]).map(([action, n]) => (AUDIT_ACTION_LABEL[action] ?? action) + ' ' + n).join(', ') + '.');
  const byActor = new Map();
  for (const item of week) byActor.set(item.actor, (byActor.get(item.actor) ?? 0) + 1);
  const busy = [...byActor].filter(([, n]) => n >= 200).map(([actor, n]) => actor.slice(0, 6) + '... ' + n);
  if (busy.length) listItem(target, 'Unusually busy account(s) this week: ' + busy.join(', ') + '. Check the entries below.');
  const night = week.filter((item) => { const hour = (new Date(item.at).getHours()); return hour < 5; });
  if (night.length >= 5) listItem(target, night.length + ' change(s) were made between midnight and 5 am this week.');
  const removals = week.filter((item) => item.action === 'remove' || item.action === 'void').length;
  if (removals >= 5) listItem(target, removals + ' removal(s) or voided payment(s) this week. Check they were expected.');
  for (const note of securityNotes()) listItem(target, note);
}
async function loadAuditLog(request) {
  try {
    const saved = await academic.list('auditLog');
    if (request !== schoolRequest) return;
    const items = saved.docs.map((record) => record.data()).sort((a, b) => b.at.localeCompare(a.at));
    auditItems = items;
    auditSection.hidden = false;
    auditList.replaceChildren();
    for (const item of items.slice(0, AUDIT_SHOWN)) {
      const when = new Date(item.at).toLocaleString();
      const what = (AUDIT_ACTION_LABEL[item.action] ?? item.action) + ' ' + item.target + ' ' + item.docId
        + (item.detail ? ' (' + item.detail + ')' : '');
      listItem(auditList, when + ' - ' + what);
    }
    renderAuditSummary(items);
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
  if (academic) loadSecurityAlerts(schoolRequest);
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
function printCard(headingId, who, after) {
  const heading = document.querySelector(headingId);
  heading.textContent = (schoolName.textContent || 'School') + ' - ' + who + ' - ' + localToday();
  let logo;
  if (schoolLogo) {
    logo = document.createElement('img');
    logo.className = 'print-logo';
    logo.alt = 'School logo';
    logo.src = schoolLogo;
    heading.prepend(logo);
  }
  document.body.classList.add('printing');
  const done = () => {
    logo?.remove();
    after?.();
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
        + ', late ' + (att.late ?? 0) + ', on leave ' + (att.leave ?? 0),
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
  downloadCsv('students', [['Admission no', 'Name', 'Guardian', 'Guardian phone', 'Status', 'Class', 'Section', 'Roll no', 'Date of birth', 'Address'],
    ...studentRecords.map((record) => {
      const s = record.data();
      const p = placement.get(record.id);
      return [s.admissionNo, s.name, s.guardianName, s.guardianPhone, s.status,
        p ? nameOfClass(p.classId) : '', p ? sectionName(p.sectionId) : '', p ? p.rollNo : '', s.dob ?? '', s.address ?? ''];
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
      const passed = results[index].docs.filter((mark) => passedExam(exam, mark.data().score)).length;
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
  const cardPhoto = document.querySelector('#card-photo');
  cardPhoto.hidden = !photoMap.has(record.id);
  if (photoMap.has(record.id)) cardPhoto.src = photoMap.get(record.id);
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

async function printStudentCard(kind) {
  if (!buildCard(kind)) return;
  if (kind === 'admit') {
    // Eligibility: present and late days out of school days marked this year (approved leave is not counted).
    const tools = academic;
    const request = schoolRequest;
    const minimum = Number(document.querySelector('#cards-minpercent').value);
    const override = document.querySelector('#cards-override').checked;
    const activeYear = examData.years.find((item) => item.data().status === 'active');
    try {
      const marks = (await tools.attendanceOfStudent(cardsStudent.value)).docs.map((item) => item.data())
        .filter((mark) => mark.yearId === activeYear.id && mark.status !== 'leave');
      if (request !== schoolRequest) return;
      const percent = marks.length ? Math.round(marks.filter((mark) => mark.status !== 'absent').length / marks.length * 1000) / 10 : null;
      if (percent !== null && Number.isFinite(minimum) && percent < minimum && !override) {
        cardsStatus.textContent = 'Attendance is ' + percent + '%, below the minimum of ' + minimum
          + '%. Tick "Print anyway" if the student is allowed to sit the exams.';
        return;
      }
      cardsStatus.textContent = percent === null ? 'No attendance is marked for this student yet.' : 'Attendance this year: ' + percent + '%.';
    } catch {
      cardsStatus.textContent = 'Could not check attendance. Try again.';
      return;
    }
  }
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
        const count = perStudent.get(mark.studentId) ?? { present: 0, absent: 0, late: 0, leave: 0 };
        count[mark.status] += 1;
        perStudent.set(mark.studentId, count);
      }
    }
    attrepRows = [...perStudent.entries()].map(([studentId, count]) => {
      const marked = count.present + count.absent + count.late;
      return [nameOfStudent(studentId), count.present, count.absent, count.late, marked,
        marked ? Math.round((count.present + count.late) / marked * 1000) / 10 + '%' : 'On leave'];
    }).sort((a, b) => a[0].localeCompare(b[0]));
    attrepBody.replaceChildren();
    for (const row of attrepRows) addRow(attrepBody, row.map(String));
    attrepStatus.textContent = attrepRows.length ? 'Attendance % counts present and late days out of days marked. Approved leave days are not counted.'
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

const importKind = document.querySelector('#import-kind');
const IMPORT_KINDS = {
  students: { help: 'Columns, in this order: admission number, student name, guardian name, guardian phone, and optionally date of birth (YYYY-MM-DD) and address. Copy the rows from Excel and paste them here, or choose a CSV file. A header row is fine.',
    header: 'Admission no', sample: [['admissionNo', 'name', 'guardianName', 'guardianPhone', 'dob', 'address'], ['A-1001', 'Sample Student', 'Sample Guardian', '98300 00000', '2015-06-30', 'Sample Road']] },
  subjects: { help: 'Columns, in this order: subject name, and optionally a short code (up to 12 characters). A header row is fine.',
    header: 'Subject', sample: [['name', 'code'], ['Mathematics', 'MATH'], ['English', 'ENG']] },
  classes: { help: 'Columns, in this order: class name, and the order number from 1 to 100 (lowest class first). A header row is fine.',
    header: 'Class', sample: [['name', 'order'], ['Class 1', '1'], ['Class 2', '2']] },
};
function showImportKind() {
  const kind = IMPORT_KINDS[importKind.value];
  document.querySelector('#import-help').textContent = kind.help;
  document.querySelector('#import-col1').textContent = kind.header;
  importBody.replaceChildren();
  importReady = [];
  importRun.disabled = true;
}
importKind.addEventListener('change', showImportKind);
showImportKind();
document.querySelector('#import-sample').addEventListener('click', () => downloadCsv('sample-' + importKind.value, IMPORT_KINDS[importKind.value].sample));

// Checks one row for the chosen kind. Returns { problem } or { id, collection, data, label, name }.
function checkImportRow(kind, cells) {
  const [c1 = '', c2 = '', c3 = '', c4 = '', c5 = '', c6 = ''] = cells.map((value) => value.trim());
  if (kind === 'subjects') {
    const id = slug(c1, 30);
    if (!c1 || c1.length > 80 || !id) return { problem: 'Subject name is missing or too long.' };
    if (c2.length > 12) return { problem: 'Code is up to 12 characters.' };
    return { id, collection: 'subjects', data: { name: c1, code: c2 }, label: c1, name: c2 };
  }
  if (kind === 'classes') {
    const id = slug(c1, 20);
    const order = Number(c2);
    if (!c1 || c1.length > 40 || !id) return { problem: 'Class name is missing or too long.' };
    if (!Number.isInteger(order) || order < 1 || order > 100) return { problem: 'Order must be a whole number from 1 to 100.' };
    return { id, collection: 'classes', data: { name: c1, order }, label: c1, name: String(order) };
  }
  const id = c1.toLowerCase();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(c1)) return { problem: 'Admission number: letters, numbers and hyphens only (up to 20).' };
  if (!c2 || c2.length > 120) return { problem: 'Student name is missing or too long.' };
  if (!c3 || c3.length > 120) return { problem: 'Guardian name is missing or too long.' };
  if (!/^[0-9+() -]{0,20}$/.test(c4)) return { problem: 'Phone: digits, +, spaces, hyphens and brackets only.' };
  if (c5 && (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(c5) || Number.isNaN(Date.parse(c5)))) return { problem: 'Date of birth must look like 2015-06-30.' };
  if (c6.length > 200) return { problem: 'Address is up to 200 characters.' };
  const data = { admissionNo: c1, name: c2, guardianName: c3, guardianPhone: c4, status: 'active' };
  if (c5) data.dob = c5;
  if (c6) data.address = c6;
  return { id, collection: 'students', data, label: c1, name: c2 };
}

document.querySelector('#import-check').addEventListener('click', () => {
  importBody.replaceChildren();
  importReady = [];
  importRun.disabled = true;
  const kind = importKind.value;
  let rows = parseDelimited(importText.value);
  if (rows.length && /^(admission|name)/i.test((rows[0][0] ?? '').trim())) rows = rows.slice(1);
  if (!rows.length) {
    importStatus.textContent = 'Paste some rows first.';
    return;
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    importStatus.textContent = 'Too many rows. Import up to ' + IMPORT_MAX_ROWS + ' rows at a time.';
    return;
  }
  const seen = new Set();
  const existing = new Set((kind === 'students' ? studentRecords : kind === 'subjects' ? examData.subjects : placementData.classes).map((record) => record.id));
  let bad = 0;
  let skipped = 0;
  rows.forEach((cells, index) => {
    const checked = checkImportRow(kind, cells);
    let problem = checked.problem ?? '';
    if (!problem && seen.has(checked.id)) problem = 'Repeated in this list.';
    let result = 'OK - will be added';
    if (problem) { result = 'Problem: ' + problem; bad += 1; }
    else if (existing.has(checked.id)) { result = 'Skipped - already exists.'; skipped += 1; }
    else importReady.push({ path: [checked.collection, checked.id], data: checked.data });
    if (checked.id) seen.add(checked.id);
    addRow(importBody, [String(index + 1), checked.label ?? (cells[0] ?? ''), checked.name ?? (cells[1] ?? ''), result]);
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
  // Plan limit: do not start an import that would pass the student limit of the plan.
  if (importKind.value === 'students') {
    try {
      const { doc, getDocFromServer } = firestoreTools;
      const plan = await getDocFromServer(doc(tools.schoolRef, 'billing', 'main'));
      const limit = plan.exists() ? plan.data().studentLimit : undefined;
      if (typeof limit === 'number' && studentRecords.length + ops.length > limit) {
        importStatus.textContent = 'Your plan allows ' + limit + ' students and you have ' + studentRecords.length + '. You can add ' + Math.max(0, limit - studentRecords.length)
          + ' more; remove rows or ask support to raise the limit.';
        return;
      }
    } catch { /* No plan record: no limit to check. */ }
  }
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
    document.dispatchEvent(new Event('usage-changed'));
    if (request === schoolRequest) importStatus.textContent = 'Imported ' + done + ' row' + (done === 1 ? '' : 's') + '.';
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
    const buttons = document.createDocumentFragment();
    buttons.append(button);
    // Renewal (feature 137): 14 more days, up to 3 times, unless someone is waiting for the book.
    if ((loan.renewals ?? 0) < 3) {
      const renew = document.createElement('button');
      renew.type = 'button';
      renew.textContent = 'Renew 14 days';
      renew.addEventListener('click', () => {
        const waiting = (lists.bookreservations?.items ?? []).some((found) => found.data().bookId === loan.bookId && ['waiting', 'ready'].includes(found.data().status));
        if (waiting) { libraryStatus.textContent = 'Someone is waiting for this book, so it cannot be renewed.'; return; }
        const from = loan.dueOn > today ? loan.dueOn : today;
        runLibraryAction(() => academic.save('loans', record.id, { ...loan, dueOn: addDays(from, 14), renewals: (loan.renewals ?? 0) + 1 }), 'Renewed.');
      });
      buttons.append(renew);
    }
    listItem(loanList, title + ' - ' + nameOfStudent(loan.studentId) + ' - due ' + loan.dueOn
      + (loan.renewals ? ' (renewed ' + loan.renewals + ' time' + (loan.renewals > 1 ? 's' : '') + ')' : '') + (loan.dueOn < today ? ' (OVERDUE)' : ''), buttons);
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


// ---- Batch 67: QR codes for the library (135) and attendance (129), the e-library (136) and notice acknowledgements (150) ----
// A student card carries AZSTU:<admission number>; a book label carries AZBK:<book id>. Cameras read them with BarcodeDetector where the
// browser has it; a USB scanner types the code into the box and presses Enter, and a code can also be typed by hand.
function qrScanner(video, onCode, onState) {
  let live = false;
  let stream = null;
  let lastCode = '';
  let lastAt = 0;
  const stop = () => {
    live = false;
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    onState(false);
  };
  const start = async () => {
    if (live) { stop(); return ''; }
    if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot scan with the camera. Use a USB scanner or type the code.';
    try {
      const detector = await makeQrDetector();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      live = true;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      onState(true);
      (async () => {
        while (live) {
          const codes = await detector.detect(video).catch(() => []);
          for (const item of codes) {
            const value = String(item.rawValue ?? '');
            if (/^AZ(STU|BK):/.test(value) && (value !== lastCode || Date.now() - lastAt > 4000)) {
              lastCode = value;
              lastAt = Date.now();
              onCode(value);
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      })();
      return '';
    } catch {
      stop();
      return 'Could not use the camera. Allow camera access for this site, or type the code.';
    }
  };
  return { start, stop };
}
// Prints a sheet of QR labels from this same page (no pop-up window): the sheet is added to the page, only it is shown while printing,
// and it is removed afterwards. Text is placed with textContent only.
async function printQrSheet(title, items, statusEl) {
  let drawQr;
  try { ({ drawQr } = await import('./qr.mjs?v=batch-64')); } catch { statusEl.textContent = 'Could not load the QR maker. Check your connection and try again.'; return; }
  document.querySelector('#qr-print-area')?.remove();
  const area = document.createElement('div');
  area.id = 'qr-print-area';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'qr-grid';
  try {
    for (const item of items) {
      const canvas = document.createElement('canvas');
      drawQr(canvas, item.code, 150);
      const tag = document.createElement('div');
      tag.className = 'qr-tag';
      const image = document.createElement('img');
      image.src = canvas.toDataURL('image/png');
      image.alt = 'QR code';
      const first = document.createElement('b');
      first.textContent = item.first;
      const second = document.createElement('span');
      second.textContent = item.second ?? '';
      tag.append(image, first, second);
      grid.append(tag);
    }
  } catch { statusEl.textContent = 'Could not make the QR codes.'; return; }
  area.append(heading, grid);
  document.body.append(area);
  document.body.classList.add('qr-printing');
  const done = () => { document.body.classList.remove('qr-printing'); area.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  statusEl.textContent = items.length + ' QR code(s) ready. In the print window, choose your printer or "Save as PDF".';
  setTimeout(() => window.print(), 300);
}
const parseScan = (raw, prefix) => { const value = String(raw ?? '').trim(); const match = new RegExp('^AZ' + prefix + ':(.+)$').exec(value); return match ? match[1] : value; };

// -- Library scan desk, book labels and stock check (135) --
const libscanStatus = document.querySelector('#libscan-status');
const libscanWho = document.querySelector('#libscan-who');
const libscanCode = document.querySelector('#libscan-code');
const libauditStatus = document.querySelector('#libaudit-status');
const libauditList = document.querySelector('#libaudit-list');
let libScanStudent = null;
let libAudit = null;
const libauditRows = () => [...libBooks].sort((a, b) => a.data().title.localeCompare(b.data().title)).map((record) => {
  const out = libLoans.filter((loan) => loan.data().bookId === record.id && !loan.data().returnedOn).length;
  const expected = record.data().copies - out;
  const scanned = libAudit.get(record.id) ?? 0;
  return { title: record.data().title, expected, scanned, result: scanned === expected ? 'OK' : scanned < expected ? (expected - scanned) + ' missing' : (scanned - expected) + ' extra' };
});
function showLibScanWho() {
  libscanWho.textContent = libScanStudent ? 'Student: ' + libScanStudent.data().name + ' (' + libScanStudent.id + '). Now scan the book to issue.' : 'No student chosen. Scanning a book that is out returns it.';
}
async function handleLibraryCode(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return;
  const wantsStudent = /^AZSTU:/.test(value);
  const wantsBook = /^AZBK:/.test(value);
  const student = !wantsBook && studentRecords.find((record) => record.id === parseScan(value, 'STU'));
  const book = !wantsStudent && libBooks.find((record) => record.id === parseScan(value, 'BK'));
  if (student) {
    if (student.data().status !== 'active') { libscanStatus.textContent = student.data().name + ' is not an active student.'; return; }
    libScanStudent = student;
    showLibScanWho();
    libscanStatus.textContent = 'Student chosen.';
    return;
  }
  if (!book) { libscanStatus.textContent = 'This code is not a student card or a book label of this school.'; return; }
  if (libAudit) {
    libAudit.set(book.id, (libAudit.get(book.id) ?? 0) + 1);
    libscanStatus.textContent = 'Counted: ' + book.data().title + ' (' + libAudit.get(book.id) + ').';
    libauditStatus.textContent = 'Stock check running: ' + [...libAudit.values()].reduce((sum, count) => sum + count, 0) + ' book(s) scanned.';
    return;
  }
  if (!academic || academic.busy) { libscanStatus.textContent = 'Wait a moment and scan again.'; return; }
  const request = schoolRequest;
  const out = libLoans.filter((record) => record.data().bookId === book.id && !record.data().returnedOn).sort((a, b) => a.data().dueOn.localeCompare(b.data().dueOn));
  academic.busy = true;
  try {
    if (libScanStudent) {
      if (out.length >= book.data().copies) { libscanStatus.textContent = 'All copies of "' + book.data().title + '" are out.'; return; }
      const issuedOn = localToday();
      await academic.save('loans', newId('LN'), { bookId: book.id, studentId: libScanStudent.id, issuedOn, dueOn: addDays(issuedOn, 14), issuedBy: schoolUid });
      libscanStatus.textContent = 'Issued "' + book.data().title + '" to ' + libScanStudent.data().name + '. Due ' + addDays(issuedOn, 14) + '.';
      libScanStudent = null;
    } else if (out.length) {
      await academic.save('loans', out[0].id, { ...out[0].data(), returnedOn: localToday() });
      libscanStatus.textContent = 'Returned "' + book.data().title + '" from ' + nameOfStudent(out[0].data().studentId) + '.';
    } else {
      libscanStatus.textContent = '"' + book.data().title + '" is not out. Scan a student card first to issue it.';
    }
  } catch {
    libscanStatus.textContent = 'That did not work. Check the details and try again.';
  } finally {
    academic.busy = false;
  }
  if (request === schoolRequest) { await loadLibrary(request); showLibScanWho(); }
}
const libCamera = qrScanner(document.querySelector('#libscan-video'), handleLibraryCode, (on) => { document.querySelector('#libscan-camera').textContent = on ? 'Stop camera' : 'Use camera'; });
document.querySelector('#libscan-camera').addEventListener('click', async () => { libscanStatus.textContent = (await libCamera.start()) || libscanStatus.textContent; });
document.querySelector('#libscan-go').addEventListener('click', () => { const value = libscanCode.value; libscanCode.value = ''; handleLibraryCode(value); });
libscanCode.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); const value = libscanCode.value; libscanCode.value = ''; handleLibraryCode(value); } });
document.querySelector('#libscan-clear').addEventListener('click', () => { libScanStudent = null; showLibScanWho(); libscanStatus.textContent = ''; });
document.querySelector('#book-labels').addEventListener('click', () => {
  if (!libBooks.length) { libraryStatus.textContent = 'Add books first.'; return; }
  printQrSheet('Book QR labels', [...libBooks].sort((a, b) => a.data().title.localeCompare(b.data().title)).map((record) => ({ code: 'AZBK:' + record.id, first: record.data().title.slice(0, 40), second: record.data().author ?? '' })), libraryStatus);
});
document.querySelector('#libaudit-start').addEventListener('click', () => {
  libAudit = new Map();
  libauditList.replaceChildren();
  libauditStatus.textContent = 'Stock check running. Scan every book on the shelves.';
  document.querySelector('#libaudit-finish').hidden = false;
  document.querySelector('#libaudit-csv').hidden = true;
});
document.querySelector('#libaudit-finish').addEventListener('click', () => {
  if (!libAudit) return;
  const rows = libauditRows();
  libauditList.replaceChildren();
  for (const row of rows) listItem(libauditList, row.title + ' - should be on shelf ' + row.expected + ', scanned ' + row.scanned + ' - ' + row.result);
  const bad = rows.filter((row) => row.result !== 'OK').length;
  libauditStatus.textContent = 'Stock check done: ' + (bad ? bad + ' title(s) do not match.' : 'every title matches.');
  document.querySelector('#libaudit-finish').hidden = true;
  document.querySelector('#libaudit-csv').hidden = false;
  libAuditDone = rows;
  libAudit = null;
});
let libAuditDone = [];
document.querySelector('#libaudit-csv').addEventListener('click', () => {
  downloadCsv('library-stock-check', [['Title', 'Should be on shelf', 'Scanned', 'Result'], ...libAuditDone.map((row) => [row.title, row.expected, row.scanned, row.result])]);
});

// -- Student QR cards (owner) and scanning in Daily Attendance (class teacher) (129) --
const qrcardsSection = document.querySelector('#qrcards');
const qrcardsClass = document.querySelector('#qrcards-class');
const qrcardsStatus = document.querySelector('#qrcards-status');
qrcardsSection.addEventListener('mod-open', () => { fillSelect(qrcardsClass, [...examData.classes].sort(byClassOrder), (item) => item.name); });
document.querySelector('#qrcards-print').addEventListener('click', () => {
  const year = activeYearRecord();
  if (!year) { qrcardsStatus.textContent = 'Activate an academic year first.'; return; }
  const ids = new Set(placementData.enrollments.filter((record) => record.data().yearId === year.id && record.data().classId === qrcardsClass.value).map((record) => record.data().studentId));
  const people = studentRecords.filter((record) => ids.has(record.id) && record.data().status === 'active').sort(byStudentName);
  if (!people.length) { qrcardsStatus.textContent = 'No active students in this class this year.'; return; }
  const school = document.querySelector('#school-name').textContent.trim() || 'School';
  printQrSheet(school + ' - student QR cards - ' + nameOfClass(qrcardsClass.value), people.map((record) => ({
    code: 'AZSTU:' + record.id, first: record.data().name, second: nameOfClass(qrcardsClass.value) + ' - Adm ' + record.data().admissionNo })), qrcardsStatus);
});
const attscanStatus = document.querySelector('#attscan-status');
const attscanCode = document.querySelector('#attscan-code');
const attscanList = document.querySelector('#attscan-list');
function handleAttendanceCode(raw) {
  const id = parseScan(raw, 'STU');
  if (!id) return;
  const select = attSelects().find((item) => item.dataset.student === id);
  if (!select) { attscanStatus.textContent = 'This student is not in the class and date shown below.'; return; }
  const name = select.closest('tr')?.cells[2]?.textContent ?? id;
  if (select.dataset.original !== '' && select.dataset.original !== select.value) { attscanStatus.textContent = name + ' was already marked ' + select.dataset.original + '. Left as it is.'; return; }
  if (select.dataset.original !== '') { attscanStatus.textContent = name + ' is already saved as ' + select.dataset.original + '.'; return; }
  const mode = document.querySelector('#attscan-mode').value;
  select.value = mode;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  updateAttendanceCounts();
  listItem(attscanList, name + ' - ' + mode);
  attscanStatus.textContent = name + ' marked ' + mode + '. Press Save attendance when you are done.';
}
const attCamera = qrScanner(document.querySelector('#attscan-video'), handleAttendanceCode, (on) => { document.querySelector('#attscan-camera').textContent = on ? 'Stop camera' : 'Use camera'; });
document.querySelector('#attscan-camera').addEventListener('click', async () => { attscanStatus.textContent = (await attCamera.start()) || attscanStatus.textContent; });
document.querySelector('#attscan-go').addEventListener('click', () => { const value = attscanCode.value; attscanCode.value = ''; handleAttendanceCode(value); });
attscanCode.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); const value = attscanCode.value; attscanCode.value = ''; handleAttendanceCode(value); } });
document.querySelector('#attendance-class').addEventListener('change', () => { attscanList.replaceChildren(); });

// -- E-library (136): the owner uploads PDFs, everyone reads them --
let ebookItems = [];
const EBOOK_MAX_KB = 20480;
const ebooksSection = document.querySelector('#ebooks');
const ebooksStatus = document.querySelector('#ebooks-status');
const ebooksForm = document.querySelector('#ebooks-form');
const ebooksList = document.querySelector('#ebooks-list');
async function ebookUrl(id) {
  const { getStorage, ref, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
  return getDownloadURL(ref(getStorage(app), 'schools/' + SCHOOL_ID + '/ebooks/' + id));
}
async function openEbook(id, statusEl) {
  statusEl.textContent = 'Opening.';
  try {
    const url = await ebookUrl(id);
    statusEl.textContent = window.open(url, '_blank', 'noopener') ? '' : 'Your browser blocked the new window. Allow pop-ups for this site and try again.';
  } catch { statusEl.textContent = 'Could not open the book.'; }
}
const ebookLine = (item) => item.title + (item.author ? ' - ' + item.author : '') + (item.subject ? ' (' + item.subject + ')' : '') + ' - ' + Math.round(item.sizeKb / 102.4) / 10 + ' MB';
function drawEbooks() {
  ebooksList.replaceChildren();
  if (!ebookItems.length) { listItem(ebooksList, 'No e-books yet.'); return; }
  for (const record of [...ebookItems].sort((a, b) => a.data().title.localeCompare(b.data().title))) {
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => openEbook(record.id, ebooksStatus));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Delete "' + record.data().title + '"? The file is removed for good.')) return;
      try {
        await academic.ebookDrop(record.id).catch((error) => { if (error?.code !== 'storage/object-not-found') throw error; });
        await academic.remove('eBooks', record.id);
        ebookItems = ebookItems.filter((entry) => entry.id !== record.id);
        ebooksStatus.textContent = 'E-book deleted.';
        drawEbooks();
        if (!document.querySelector('#storage').hidden) lists.storage.render();
      } catch { ebooksStatus.textContent = 'Could not delete the e-book.'; }
    });
    listItem(ebooksList, ebookLine(record.data()), open);
    ebooksList.lastElementChild.append(' ', remove);
  }
}
async function ebooksLoad() {
  if (!academic) return;
  try {
    ebookItems = (await academic.list('eBooks')).docs;
    ebooksStatus.textContent = '';
  } catch { ebooksStatus.textContent = 'Could not load the e-books. Try again.'; }
  drawEbooks();
  if (!document.querySelector('#storage').hidden) lists.storage.render();
}
ebooksSection.addEventListener('mod-open', ebooksLoad);
ebooksForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(ebooksForm);
  const file = ebooksForm.elements.namedItem('file').files[0];
  if (!file || !/\.pdf$/i.test(file.name)) { ebooksStatus.textContent = 'Choose a PDF file.'; return; }
  const sizeKb = Math.max(1, Math.ceil(file.size / 1024));
  if (file.size === 0 || sizeKb > EBOOK_MAX_KB) { ebooksStatus.textContent = 'The file must be between 1 byte and 20 MB.'; return; }
  if (storagePlanMb && (vaultKb() + lists.storage.items.reduce((sum, record) => sum + record.data().sizeKb, 0) + sizeKb) / 1024 > storagePlanMb) {
    ebooksStatus.textContent = 'Your plan storage is full (' + storagePlanMb + ' MB). Delete a file or ask for a larger plan.';
    return;
  }
  const id = newId('EB');
  const data = { title: text(fields, 'title'), fileName: file.name.slice(-120), sizeKb, uploadedOn: localToday(), by: academic.uid, ...optional(fields, 'author'), ...optional(fields, 'subject') };
  academic.busy = true;
  ebooksStatus.textContent = 'Uploading.';
  try {
    await academic.ebookPut(id, file);
    try { await academic.save('eBooks', id, data); } catch (error) { await academic.ebookDrop(id).catch(() => {}); throw error; }
    ebookItems = [...ebookItems, { id, data: () => data }];
    ebooksForm.reset();
    ebooksStatus.textContent = 'E-book uploaded.';
    drawEbooks();
    if (!document.querySelector('#storage').hidden) lists.storage.render();
  } catch (error) {
    ebooksStatus.textContent = error?.code === 'permission-denied' || error?.code === 'storage/unauthorized'
      ? 'Not allowed. Your plan storage may be full.' : 'Could not upload. Check your connection and try again.';
  } finally { academic.busy = false; }
});
// Families (and teachers) read the e-library from their own screen.
const portalEbooksSection = document.querySelector('#portal-ebooks');
const portalEbooksStatus = document.querySelector('#portal-ebooks-status');
const portalEbooksList = document.querySelector('#portal-ebooks-list');
const portalEbooksSearch = document.querySelector('#portal-ebooks-search');
let portalEbookItems = [];
function drawPortalEbooks() {
  const needle = portalEbooksSearch.value.trim().toLowerCase();
  portalEbooksList.replaceChildren();
  const shown = portalEbookItems.filter((record) => !needle || ebookLine(record.data()).toLowerCase().includes(needle)).sort((a, b) => a.data().title.localeCompare(b.data().title));
  if (!shown.length) { listItem(portalEbooksList, portalEbookItems.length ? 'No e-books match.' : 'No e-books yet.'); return; }
  for (const record of shown) {
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Read';
    open.addEventListener('click', () => openEbook(record.id, portalEbooksStatus));
    listItem(portalEbooksList, ebookLine(record.data()), open);
  }
}
portalEbooksSearch.addEventListener('input', drawPortalEbooks);
async function loadPortalEbooks(tools, request) {
  portalEbooksSection.hidden = false;
  portalEbooksStatus.textContent = 'Loading.';
  try {
    const found = await tools.getDocsFromServer(tools.collection(tools.schoolRef, 'eBooks'));
    if (request !== schoolRequest) return;
    portalEbookItems = found.docs;
    portalEbooksStatus.textContent = '';
    drawPortalEbooks();
  } catch { if (request === schoolRequest) portalEbooksStatus.textContent = 'Could not load the e-library. Try again.'; }
}

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
document.addEventListener('mod-open', (event) => {
  const api = ownerLists.find((item) => document.querySelector('#' + item.cfg.id) === event.target);
  // Lists that nothing else depends on are read from the database only when their module is first opened (saves reads).
  if (api?.lazy && !api.loaded) {
    document.querySelector('#' + api.cfg.id + '-status').textContent = 'Loading.';
    api.load(schoolRequest);
  } else if (api?.dirty) api.render();
});

// Owner can change any saved record in these lists. Records that keep their number (like a payment receipt)
// are not here: the rules only allow a payment to be voided, never edited.
const NO_EDIT = new Set(['messages', 'enquiries', 'eventRegistrations', 'activityMembers', 'scholarshipApps', 'consentForms',
  'hostelStays', 'canteenPlans', 'bookReservations', 'questionBank', 'onlineTests', 'pickupPeople']);
const KEEP_ID = new Set(['routes', 'activities', 'inventory', 'expenses', 'tickets', 'staffDirectory', 'vendors', 'minutes', 'lostFound',
  'concessions', 'achievements', 'complaints', 'assets', 'sales', 'syllabus', 'trainings', 'diary', 'alumni', 'ptmSlots', 'storageRecords', 'scholarships',
  'hostelRooms', 'canteenMenu', 'workflowRules']);
function ownerList(cfg) {
  const section = document.querySelector('#' + cfg.id);
  const status = document.querySelector('#' + cfg.id + '-status');
  const form = document.querySelector('#' + cfg.id + '-form');
  const list = document.querySelector('#' + cfg.id + '-list');
  const api = { cfg, items: [] };
  let editing = null;
  const submitButton = form?.querySelector('button[type="submit"], button:not([type])');
  const submitLabel = submitButton?.textContent;
  const cancelEdit = document.createElement('button');
  cancelEdit.type = 'button';
  cancelEdit.textContent = 'Cancel edit';
  cancelEdit.hidden = true;
  submitButton?.after(cancelEdit);
  function stopEdit() {
    editing = null;
    cancelEdit.hidden = true;
    if (submitButton) submitButton.textContent = submitLabel;
    form?.reset();
  }
  cancelEdit.addEventListener('click', () => { stopEdit(); status.textContent = ''; });
  function startEdit(record) {
    editing = record;
    const data = record.data();
    form.reset();
    for (const field of form.elements) {
      if (!field.name || !(field.name in data)) continue;
      if (field.type === 'checkbox') field.checked = Boolean(data[field.name]);
      else field.value = String(data[field.name]);
    }
    if (submitButton) submitButton.textContent = 'Save changes';
    cancelEdit.hidden = false;
    status.textContent = 'Editing this record. Change what you need and press Save changes.';
    form.scrollIntoView({ block: 'center' });
  }

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

  // A list is only drawn while its module is open; otherwise it waits (dirty) until the module is opened.
  api.draw = () => {
    if (section.closest('.mod-open')) api.render();
    else api.dirty = true;
  };
  api.render = () => {
    if (api.lazy && !api.loaded) return;
    api.dirty = false;
    if (form && cfg.prepare) cfg.prepare(form, api.items);
    cfg.summary?.(api.items);
    list.replaceChildren();
    for (const record of [...api.items].sort(cfg.sort ?? ((a, b) => a.id.localeCompare(b.id)))) {
      const item = document.createElement('li');
      item.textContent = cfg.line(record.data(), record) + ' ';
      for (const extra of cfg.extra?.(record, act) ?? []) item.append(extra, ' ');
      if (form && !NO_EDIT.has(cfg.collection) && !cfg.noEdit) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => startEdit(record));
        item.append(editButton, ' ');
      }
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
      api.loaded = true;
      section.hidden = false;
      status.textContent = '';
      api.draw();
    } catch (error) {
      if (request !== schoolRequest) return;
      // A principal whose access to this area is switched off simply does not see the tile.
      if (viewOnly && error?.code === 'permission-denied') { section.hidden = true; return; }
      section.hidden = false;
      status.textContent = 'Could not load this list. Try again.';
    }
  };

  api.ensure = () => (api.loaded ? Promise.resolve() : api.load(schoolRequest));
  api.reset = () => {
    api.loaded = false;
    api.lazy = false;
    section.hidden = true;
    status.textContent = '';
    list.replaceChildren();
    api.items = [];
    stopEdit();
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const built = cfg.build(new FormData(form), editing ? api.items.filter((record) => record.id !== editing.id) : api.items);
    if (built.error) {
      status.textContent = built.error;
      return;
    }
    if (editing) {
      const old = editing;
      const id = KEEP_ID.has(cfg.collection) ? old.id : built.id;
      act(async () => {
        if (id === old.id) await academic.save(cfg.collection, id, built.data);
        else await academic.commit([{ path: [cfg.collection, id], data: built.data }, { path: [cfg.collection, old.id], delete: true }]);
        stopEdit();
      }, 'Changes saved.');
      return;
    }
    act(async () => {
      if (built.also) await academic.commit([{ path: [cfg.collection, built.id], data: built.data }, ...built.also]);
      else await academic.save(cfg.collection, built.id, built.data);
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
const routeFee = (id) => lists.routes.items.find((record) => record.id === id)?.data().monthlyFee ?? 0;
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
    const fee = text(fields, 'monthlyFee') ? wholeNumber(fields, 'monthlyFee') : 0;
    if (Number.isNaN(fee) || fee > 100000) return { error: 'The transport fee must be whole rupees, up to 100000.' };
    return { id: newId('RT'), data: { name: text(fields, 'name'), ...optional(fields, 'vehicle', 'driver', 'driverPhone', 'stops'),
      ...(fee ? { monthlyFee: fee } : {}) } };
  },
  line: (item, record) => item.name + (item.vehicle ? ' - ' + item.vehicle : '') + (item.driver ? ' - driver ' + item.driver : '')
    + (item.driverPhone ? ' (' + item.driverPhone + ')' : '') + (item.stops ? ' - stops: ' + item.stops : '')
    + (item.monthlyFee ? ' - fee ' + rupees(item.monthlyFee) + '/student/month, '
      + lists.riders.items.filter((rider) => rider.data().routeId === record.id).length + ' rider(s) = '
      + rupees(item.monthlyFee * lists.riders.items.filter((rider) => rider.data().routeId === record.id).length) + '/month' : ''),
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
    const months = text(fields, 'months') ? wholeNumber(fields, 'months') : 0;
    if (!(months >= 0 && months <= 12)) return { error: 'Months of transport fee must be a whole number from 0 to 12.' };
    return { id: text(fields, 'studentId'), data: { studentId: text(fields, 'studentId'), routeId: text(fields, 'routeId'), ...optional(fields, 'stop'),
      ...(months ? { months } : {}) } };
  },
  line: (item) => nameOfStudent(item.studentId) + ' - ' + routeName(item.routeId) + (item.stop ? ' - stop ' + item.stop : '')
    + (routeFee(item.routeId) ? ' - fee ' + rupees(routeFee(item.routeId)) + '/month' : '')
    + (item.months && routeFee(item.routeId) ? ' x ' + item.months + ' month(s) = ' + rupees(routeFee(item.routeId) * item.months) + ' on the fee balance' : ' - no transport fee on the fee balance yet'),
});

for (const [name, key] of [['routes', 'routes'], ['riders', 'riders']]) {
  const original = lists[name].load;
  lists[name].load = async (request) => {
    await original(request);
    if (request !== schoolRequest) return;
    transportData[key] = lists[name].items;
    renderFeeBalance();
  };
}

const SOON_DAYS = 30;
const daysUntil = (dateText) => Math.round((Date.parse(dateText) - Date.parse(localToday())) / 86400000);
const expiryNote = (label, dateText) => {
  if (!dateText) return '';
  const days = daysUntil(dateText);
  return ' - ' + label + ' ' + dateText + (days < 0 ? ' (EXPIRED ' + -days + ' days ago)' : days <= SOON_DAYS ? ' (expires in ' + days + ' days)' : '');
};
lists.vehicles = ownerList({
  id: 'vehicles', collection: 'vehicles', empty: 'No vehicles yet.', saved: 'Vehicle added.',
  sort: (a, b) => a.data().regNo.localeCompare(b.data().regNo),
  prepare: (form) => {
    const select = form.elements.namedItem('routeId');
    fillSelect(select, lists.routes.items, (item) => item.name);
    select.prepend(new Option('No route yet', ''));
    select.value = '';
  },
  build: (fields) => {
    const capacity = wholeNumber(fields, 'capacity');
    if (!text(fields, 'regNo')) return { error: 'Enter the registration number.' };
    if (!(capacity >= 1 && capacity <= 200)) return { error: 'Seats must be a whole number from 1 to 200.' };
    for (const key of ['insuranceExpiry', 'fitnessExpiry', 'licenseExpiry']) {
      if (text(fields, key) && !DATE_TEXT.test(text(fields, key))) return { error: 'Enter the dates as dates.' };
    }
    return { id: newId('VH'), data: { regNo: text(fields, 'regNo'), capacity,
      ...optional(fields, 'model', 'insuranceExpiry', 'fitnessExpiry', 'licenseExpiry', 'routeId') } };
  },
  line: (item) => item.regNo + (item.model ? ' - ' + item.model : '') + ' - ' + item.capacity + ' seats'
    + (item.routeId ? ' - route ' + routeName(item.routeId) + ', ' + lists.riders.items.filter((rider) => rider.data().routeId === item.routeId).length + ' rider(s)'
      + (lists.riders.items.filter((rider) => rider.data().routeId === item.routeId).length > item.capacity ? ' (MORE RIDERS THAN SEATS)' : '') : '')
    + expiryNote('insurance', item.insuranceExpiry) + expiryNote('fitness', item.fitnessExpiry) + expiryNote('driver licence', item.licenseExpiry),
});

// Training hours per staff member, for the appraisal summary. Planned training does not count.
const trainingHoursByStaff = () => {
  const hours = new Map();
  for (const record of lists.trainings?.items ?? []) {
    const item = record.data();
    if (item.status === 'planned') continue;
    hours.set(item.staffName, (hours.get(item.staffName) ?? 0) + item.hours);
  }
  return hours;
};
const APPRAISAL_STAGE = { draft: 'draft', submitted: 'submitted, waiting for approval', approved: 'approved' };
lists.appraisals = ownerList({
  id: 'appraisals', collection: 'appraisals', empty: 'No appraisals yet.', saved: 'Appraisal saved.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  prepare: (form, items) => {
    document.querySelector('#appraisal-staff').replaceChildren(...lists.staffdir.items.map((record) => new Option(record.data().name)));
    const byStaff = new Map();
    for (const record of items) {
      if (record.data().status && record.data().status !== 'approved') continue; // only approved reviews count towards the average
      const entry = byStaff.get(record.data().staffName) ?? { total: 0, n: 0 };
      entry.total += record.data().rating; entry.n += 1;
      byStaff.set(record.data().staffName, entry);
    }
    const hours = lists.trainings?.loaded ? trainingHoursByStaff() : null;
    document.querySelector('#appraisals-summary').textContent = byStaff.size
      ? 'Average ratings (approved reviews only): ' + [...byStaff].map(([name, entry]) => name + ' ' + (Math.round(entry.total / entry.n * 10) / 10)
        + (hours?.has(name) ? ' (' + hours.get(name) + ' training hours)' : '')).join(', ') + '.' : '';
  },
  build: (fields) => {
    const rating = wholeNumber(fields, 'rating');
    if (!text(fields, 'staffName') || !DATE_TEXT.test(text(fields, 'date'))) return { error: 'Enter the staff member and the date.' };
    if (!(rating >= 1 && rating <= 5)) return { error: 'Rating must be a whole number from 1 to 5.' };
    return { id: newId('AP'), data: { staffName: text(fields, 'staffName'), date: text(fields, 'date'), rating, ...optional(fields, 'remarks', 'cycle', 'goals'),
      status: ['draft', 'submitted', 'approved'].includes(text(fields, 'status')) ? text(fields, 'status') : 'submitted' } };
  },
  line: (item) => item.date + ' - ' + item.staffName + (item.cycle ? ' - ' + item.cycle : '') + ' - rating ' + item.rating + ' of 5'
    + ' - ' + (APPRAISAL_STAGE[item.status] ?? 'approved') + (item.goals ? ' - goals: ' + item.goals : '') + (item.remarks ? ' - ' + item.remarks : ''),
  extra: (record, act) => {
    if (!record.data().status || record.data().status === 'approved' || viewOnly) return [];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Approve';
    button.addEventListener('click', () => act(() => academic.save('appraisals', record.id, { ...record.data(), status: 'approved' }), 'Approved.'));
    return [button];
  },
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

// An expense waiting for approval or rejected does not count in totals, the ledger or the finance summary.
const expenseCounts = (item) => item.status !== 'pending' && item.status !== 'rejected';
const PAY_MODE = { cash: 'cash', bank: 'bank', upi: 'UPI', cheque: 'cheque' };
lists.expenses = ownerList({
  id: 'expenses', collection: 'expenses', empty: 'No expenses yet.', saved: 'Expense added.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  build: (fields) => {
    const amount = wholeNumber(fields, 'amount');
    if (!DATE_TEXT.test(text(fields, 'date')) || !text(fields, 'category') || !(amount >= 1 && amount <= 100000000)) {
      return { error: 'Enter the date, the category and the amount in whole rupees.' };
    }
    return { id: newId('EX'), data: { date: text(fields, 'date'), category: text(fields, 'category'), amount, ...optional(fields, 'note', 'vendor'),
      ...(PAY_MODE[text(fields, 'payMode')] ? { payMode: text(fields, 'payMode') } : {}),
      // An approval rule (feature 156) makes a large expense wait for the owner's approval.
      ...(amount >= approvalThreshold() ? { status: 'pending' } : ['approved', 'pending'].includes(text(fields, 'status')) ? { status: text(fields, 'status') } : {}) } };
  },
  line: (item) => item.date + ' - ' + item.category + ' - ' + rupees(item.amount) + (item.vendor ? ' - paid to ' + item.vendor : '')
    + (item.payMode ? ' - ' + PAY_MODE[item.payMode] : '') + (item.status === 'pending' ? ' - WAITING FOR APPROVAL' : item.status === 'rejected' ? ' - REJECTED' : '')
    + (item.note ? ' (' + item.note + ')' : ''),
  summary: (items) => {
    const month = localToday().slice(0, 7);
    const mine = items.filter((record) => record.data().date.startsWith(month) && expenseCounts(record.data()));
    const total = mine.reduce((sum, record) => sum + record.data().amount, 0);
    const byCategory = new Map();
    for (const record of mine) byCategory.set(record.data().category, (byCategory.get(record.data().category) ?? 0) + record.data().amount);
    const parts = [...byCategory].sort((a, b) => b[1] - a[1]).map(([name, amount]) => name + ' ' + rupees(amount));
    const waiting = items.filter((record) => record.data().status === 'pending');
    document.querySelector('#expenses-total').textContent = 'Spent this month (' + month + '): ' + rupees(total)
      + (parts.length ? ' - ' + parts.join(', ') : '')
      + (waiting.length ? '. Waiting for approval: ' + waiting.length + ' (' + rupees(waiting.reduce((sum, record) => sum + record.data().amount, 0)) + ').' : '');
  },
  extra: (record, act) => {
    if (record.data().status !== 'pending' || viewOnly) return [];
    return [['Approve', 'approved'], ['Reject', 'rejected']].map(([label, next]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => act(() => academic.save('expenses', record.id, { ...record.data(), status: next, decidedOn: localToday() }),
        next === 'approved' ? 'Expense approved.' : 'Expense rejected.'));
      return button;
    });
  },
});
document.querySelector('#expenses-csv').addEventListener('click', () => {
  downloadCsv('expenses', [['Date', 'Category', 'Amount', 'Note', 'Paid to', 'How paid', 'Stage'],
    ...[...lists.expenses.items].sort((a, b) => a.data().date.localeCompare(b.data().date))
      .map((record) => [record.data().date, record.data().category, record.data().amount, record.data().note ?? '', record.data().vendor ?? '',
        PAY_MODE[record.data().payMode] ?? '', record.data().status ?? 'approved'])]);
});

let storagePlanMb = null;
lists.storage = ownerList({
  id: 'storage', collection: 'storageRecords', empty: 'No storage records yet.', saved: 'Record added.',
  sort: (a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id),
  prepare: (form, items) => {
    const kb = items.reduce((sum, record) => sum + record.data().sizeKb, 0) + vaultKb();
    const mb = Math.round(kb / 1024 * 10) / 10;
    document.querySelector('#storage-total').textContent = 'Used: ' + mb + ' MB' + (storagePlanMb ? ' of ' + storagePlanMb + ' MB in your plan ('
      + Math.round(mb / storagePlanMb * 1000) / 10 + '% used).' : '. Your plan has no storage limit set yet.')
      + (storagePlanMb && mb / storagePlanMb >= 1 ? ' STORAGE FULL: new records and uploads are refused.' : storagePlanMb && mb / storagePlanMb >= 0.8 ? ' Warning: more than 80% used.' : '');
    const meter = document.querySelector('#storage-meter');
    meter.hidden = !storagePlanMb;
    if (storagePlanMb) meter.value = Math.min(100, mb / storagePlanMb * 100);
    const breakdown = document.querySelector('#storage-breakdown');
    breakdown.replaceChildren();
    const byKind = new Map();
    for (const record of items) byKind.set(record.data().kind, (byKind.get(record.data().kind) ?? 0) + record.data().sizeKb);
    if (vaultKb()) byKind.set('Files (staff vault and e-books)', vaultKb());
    for (const [kind, size] of [...byKind].sort((a, b) => b[1] - a[1])) listItem(breakdown, kind + ': ' + Math.round(size / 1024 * 10) / 10 + ' MB');
    const biggest = [...items].sort((a, b) => b.data().sizeKb - a.data().sizeKb).slice(0, 3);
    if (biggest.length) listItem(breakdown, 'Largest: ' + biggest.map((record) => record.data().name + ' (' + Math.round(record.data().sizeKb / 1024 * 10) / 10 + ' MB)').join(', '));
  },
  build: (fields) => {
    const sizeKb = Number(text(fields, 'sizeKb'));
    if (!Number.isInteger(sizeKb) || sizeKb < 0 || sizeKb > 5000000) return { error: 'Size must be a whole number of KB, from 0 to 5,000,000.' };
    return { id: newId('ST'), data: { name: text(fields, 'name'), kind: text(fields, 'kind'), sizeKb, date: localToday(), ...optional(fields, 'note') } };
  },
  line: (item) => item.date + ' - ' + item.name + ' - ' + item.kind + ' - ' + item.sizeKb + ' KB' + (item.note ? ' (' + item.note + ')' : ''),
});

// Staff Document Vault (feature 141). Files go to Cloud Storage under schools/<school>/staffDocs/<id>; the details are kept in
// Firestore (staffDocuments). Uploads are refused when the plan's storage is full.
let vaultItems = [];
let vaultLoaded = false;
const VAULT_KINDS = { 'id-proof': 'ID proof', contract: 'Contract', certificate: 'Certificate', qualification: 'Qualification', police: 'Police verification', medical: 'Medical', other: 'Other' };
const VAULT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const VAULT_MAX_KB = 5120;
// Files kept in Cloud Storage: staff vault documents and e-books.
function vaultKb() { return [...vaultItems, ...ebookItems].reduce((sum, record) => sum + (record.data().sizeKb ?? 0), 0); }
const vaultState = (item) => (!item.expiryOn ? 'none' : daysUntil(item.expiryOn) < 0 ? 'expired' : daysUntil(item.expiryOn) <= SOON_DAYS ? 'soon' : 'ok');
function vaultNotes() {
  const notes = [];
  for (const record of vaultItems) {
    const item = record.data();
    const state = vaultState(item);
    if (state === 'expired') notes.push('Staff document expired: ' + item.staffName + ' - ' + item.title + ' (' + item.expiryOn + ').');
    else if (state === 'soon') notes.push('Staff document expires in ' + daysUntil(item.expiryOn) + ' day(s): ' + item.staffName + ' - ' + item.title + '.');
  }
  return notes;
}
const vaultSection = document.querySelector('#staffdocs');
const vaultForm = document.querySelector('#staffdocs-form');
const vaultStatus = document.querySelector('#staffdocs-status');
const vaultAlert = document.querySelector('#staffdocs-alert');
const vaultList = document.querySelector('#staffdocs-list');
const vaultFilter = document.querySelector('#staffdocs-filter');
const vaultStaffFilter = document.querySelector('#staffdocs-staff');
let vaultPeople = [];
// Everyone a document can belong to: the Staff Directory (job titles), the Staff Contact Directory and the teacher accounts.
// The same name from two places is listed once.
async function vaultCollectPeople() {
  const found = new Map();
  const add = (id, name) => { const key = String(name ?? '').trim().toLowerCase(); if (key && !found.has(key)) found.set(key, { id: String(id).slice(0, 40), name: String(name).trim() }); };
  try { for (const record of (await staffDirectory.list()).docs) add(record.id, record.data().name); } catch { /* Not readable: skipped. */ }
  for (const record of lists.staffdir.items) add(record.id, record.data().name);
  for (const uid of staffRoster) add(uid, staffLabel(uid));
  vaultPeople = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function vaultStaffChoices() {
  const people = vaultPeople.map((person) => ({ id: person.id, data: () => person }));
  const staffSelect = vaultForm.elements.namedItem('staffId');
  fillSelect(staffSelect, people, (person) => person.name);
  if (!people.length) {
    staffSelect.append(new Option('No staff yet - add them in Staff Directory first', ''));
    vaultStatus.textContent = 'There are no staff members yet. Open Staff Directory, add the person, then come back here.';
  }
  const keep = vaultStaffFilter.value;
  vaultStaffFilter.replaceChildren(new Option('All staff', ''), ...people.map((record) => new Option(record.data().name, record.id)));
  vaultStaffFilter.value = people.some((record) => record.id === keep) ? keep : '';
}
function vaultVisible() {
  return vaultItems.filter((record) => {
    const item = record.data();
    if (vaultStaffFilter.value && item.staffId !== vaultStaffFilter.value) return false;
    const state = vaultState(item);
    return vaultFilter.value === 'all' || (vaultFilter.value === 'expired' && state === 'expired') || (vaultFilter.value === 'soon' && state === 'soon')
      || (vaultFilter.value === 'none' && state === 'none');
  }).sort((a, b) => (a.data().expiryOn ?? '9999').localeCompare(b.data().expiryOn ?? '9999') || b.id.localeCompare(a.id));
}
function vaultDraw() {
  vaultList.replaceChildren();
  const notes = vaultNotes();
  vaultAlert.textContent = notes.length ? notes.length + ' staff document(s) need attention. ' + notes.slice(0, 3).join(' ') : '';
  const rows = vaultVisible();
  if (!rows.length) { listItem(vaultList, vaultItems.length ? 'No documents match this filter.' : 'No staff documents yet.'); return; }
  for (const record of rows) {
    const item = record.data();
    const state = vaultState(item);
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => vaultOpenFile(record));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Change expiry';
    edit.addEventListener('click', () => vaultChangeExpiry(record));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => vaultDelete(record));
    listItem(vaultList, item.staffName + ' - ' + (VAULT_KINDS[item.kind] ?? item.kind) + ' - ' + item.title + ' (' + item.fileName + ', ' + item.sizeKb + ' KB)'
      + (item.expiryOn ? ' - expires ' + item.expiryOn + (state === 'expired' ? ' (EXPIRED)' : state === 'soon' ? ' (expires in ' + daysUntil(item.expiryOn) + ' days)' : '') : ' - no expiry date')
      + (item.note ? ' - ' + item.note : ''), open);
    const last = vaultList.lastElementChild;
    last.append(' ', edit, ' ', remove);
  }
}
async function vaultLoad() {
  if (!academic) return;
  vaultStatus.textContent = 'Loading documents.';
  try {
    vaultItems = (await academic.list('staffDocuments')).docs;
    vaultLoaded = true;
    vaultStatus.textContent = '';
  } catch {
    vaultStatus.textContent = 'Could not load the documents. Try again.';
  }
  await vaultCollectPeople();
  vaultStaffChoices();
  vaultDraw();
  if (!document.querySelector('#storage').hidden) lists.storage.render();
}
vaultSection.addEventListener('mod-open', vaultLoad);
vaultFilter.addEventListener('change', vaultDraw);
vaultStaffFilter.addEventListener('change', vaultDraw);
vaultForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!academic || academic.busy) return;
  const fields = new FormData(vaultForm);
  const file = vaultForm.elements.namedItem('file').files[0];
  const person = vaultPeople.find((entry) => entry.id === text(fields, 'staffId'));
  if (!person) { vaultStatus.textContent = 'Choose a staff member.'; return; }
  if (!file) { vaultStatus.textContent = 'Choose a file.'; return; }
  const ext = file.name.split('.').pop().toLowerCase();
  const contentType = VAULT_TYPES[ext];
  if (!contentType) { vaultStatus.textContent = 'Only PDF, JPG or PNG files are accepted.'; return; }
  const sizeKb = Math.max(1, Math.ceil(file.size / 1024));
  if (file.size === 0 || sizeKb > VAULT_MAX_KB) { vaultStatus.textContent = 'The file must be between 1 byte and 5 MB.'; return; }
  const expiryOn = text(fields, 'expiryOn');
  if (expiryOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiryOn)) { vaultStatus.textContent = 'Enter the expiry date as a full date.'; return; }
  if (storagePlanMb && (vaultKb() + lists.storage.items.reduce((sum, record) => sum + record.data().sizeKb, 0) + sizeKb) / 1024 > storagePlanMb) {
    vaultStatus.textContent = 'Your plan storage is full (' + storagePlanMb + ' MB). Delete a file or ask for a larger plan.';
    return;
  }
  const id = newId('SD');
  const data = { staffId: person.id, staffName: person.name, kind: text(fields, 'kind'), title: text(fields, 'title'), fileName: file.name.slice(-120),
    contentType, sizeKb, uploadedOn: localToday(), by: academic.uid, ...(expiryOn ? { expiryOn } : {}), ...optional(fields, 'note') };
  academic.busy = true;
  vaultStatus.textContent = 'Uploading.';
  try {
    await academic.vaultPut(id, file, contentType);
    try {
      await academic.save('staffDocuments', id, data);
    } catch (error) {
      await academic.vaultDrop(id).catch(() => {});
      throw error;
    }
    vaultItems = [...vaultItems, { id, data: () => data }];
    vaultForm.reset();
    vaultStatus.textContent = 'Document uploaded.';
    vaultStaffChoices();
    vaultDraw();
    if (!document.querySelector('#storage').hidden) lists.storage.render();
    refreshAttention();
  } catch (error) {
    vaultStatus.textContent = error?.code === 'permission-denied' || error?.code === 'storage/unauthorized'
      ? 'Not allowed. Your plan storage may be full, or file storage is not switched on yet.'
      : 'Could not upload. Check your connection and try again.';
  } finally {
    academic.busy = false;
  }
});
async function vaultOpenFile(record) {
  vaultStatus.textContent = 'Opening.';
  try {
    const url = await academic.vaultUrl(record.id);
    const win = window.open(url, '_blank', 'noopener');
    vaultStatus.textContent = win ? '' : 'Your browser blocked the new window. Allow pop-ups for this site and try again.';
  } catch {
    vaultStatus.textContent = 'Could not open the file.';
  }
}
async function vaultChangeExpiry(record) {
  const item = record.data();
  const entered = window.prompt('New expiry date for "' + item.title + '" (YYYY-MM-DD). Leave empty for no expiry.', item.expiryOn ?? '');
  if (entered === null) return;
  const value = entered.trim();
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { vaultStatus.textContent = 'Enter the date as YYYY-MM-DD.'; return; }
  const next = { ...item };
  delete next.expiryOn;
  if (value) next.expiryOn = value;
  try {
    await academic.save('staffDocuments', record.id, next);
    vaultItems = vaultItems.map((entry) => (entry.id === record.id ? { id: record.id, data: () => next } : entry));
    vaultStatus.textContent = 'Expiry updated.';
    vaultDraw();
    refreshAttention();
  } catch {
    vaultStatus.textContent = 'Could not change the date.';
  }
}
async function vaultDelete(record) {
  if (!window.confirm('Delete "' + record.data().title + '" for ' + record.data().staffName + '? The file is removed for good.')) return;
  try {
    await academic.vaultDrop(record.id).catch((error) => { if (error?.code !== 'storage/object-not-found') throw error; });
    await academic.remove('staffDocuments', record.id);
    vaultItems = vaultItems.filter((entry) => entry.id !== record.id);
    vaultStatus.textContent = 'Document deleted.';
    vaultDraw();
    if (!document.querySelector('#storage').hidden) lists.storage.render();
    refreshAttention();
  } catch {
    vaultStatus.textContent = 'Could not delete the document.';
  }
}
document.querySelector('#staffdocs-csv').addEventListener('click', () => {
  downloadCsv('staff-documents', [['Staff member', 'Type', 'Title', 'File', 'Size KB', 'Uploaded', 'Expires', 'State', 'Note'],
    ...vaultVisible().map((record) => { const item = record.data(); return [item.staffName, VAULT_KINDS[item.kind] ?? item.kind, item.title, item.fileName, item.sizeKb,
      item.uploadedOn, item.expiryOn ?? '', { none: 'No expiry date', ok: 'Valid', soon: 'Expiring soon', expired: 'Expired' }[vaultState(item)], item.note ?? '']; })]);
});
document.querySelector('#storage-report').addEventListener('click', () => {
  const rows = [['Source', 'Name', 'Type', 'Size KB', 'Date', 'Note']];
  for (const record of lists.storage.items) { const item = record.data(); rows.push(['Record', item.name, item.kind, item.sizeKb, item.date, item.note ?? '']); }
  for (const record of vaultItems) { const item = record.data(); rows.push(['Staff vault', item.staffName + ' - ' + item.title, VAULT_KINDS[item.kind] ?? item.kind, item.sizeKb, item.uploadedOn, item.fileName]); }
  const total = rows.slice(1).reduce((sum, row) => sum + Number(row[3]), 0);
  rows.push(['TOTAL', '', '', total, '', storagePlanMb ? 'Plan: ' + storagePlanMb + ' MB, ' + Math.round(total / 1024 / storagePlanMb * 1000) / 10 + '% used' : 'No plan limit set']);
  downloadCsv('storage-report', rows);
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
    if (!phoneOk(text(fields, 'emergencyPhone'))) return { error: 'Emergency phone may use digits, +, spaces, hyphens and brackets only.' };
    const years = text(fields, 'experienceYears') ? wholeNumber(fields, 'experienceYears') : null;
    if (years !== null && !(years >= 0 && years <= 60)) return { error: 'Experience must be a whole number of years, from 0 to 60.' };
    const todayText = new Date().toISOString().slice(0, 10);
    if (text(fields, 'dateOfBirth') && text(fields, 'dateOfBirth') > todayText) return { error: 'Date of birth cannot be in the future.' };
    return { id: newId('SD'), data: { name: text(fields, 'name'), role: text(fields, 'role'),
      ...optional(fields, 'phone', 'email', 'joinedOn', 'qualification', 'emergencyPhone', 'address', 'employeeId', 'department', 'subjects', 'employmentType', 'dateOfBirth', 'gender', 'bloodGroup', 'leftOn'), ...(years !== null ? { experienceYears: years } : {}) } };
  },
  line: (item) => item.name + ' - ' + item.role + (item.employeeId ? ' (ID ' + item.employeeId + ')' : '')
    + (item.department ? ' - ' + item.department : '') + (item.subjects ? ' - teaches ' + item.subjects : '')
    + (item.employmentType ? ' - ' + item.employmentType : '') + (item.leftOn ? ' - left on ' + item.leftOn : '')
    + (item.dateOfBirth ? ' - born ' + item.dateOfBirth : '') + (item.bloodGroup ? ' - blood group ' + item.bloodGroup : '')
    + (item.qualification ? ' - ' + item.qualification : '')
    + (item.experienceYears !== undefined ? ' - ' + item.experienceYears + ' yr experience' : '')
    + (item.phone ? ' - ' + item.phone : '') + (item.email ? ' - ' + item.email : '')
    + (item.emergencyPhone ? ' - emergency ' + item.emergencyPhone : '') + (item.address ? ' - ' + item.address : ''),
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

{
  const renderConcessions = lists.concessions.render;
  lists.concessions.render = () => { renderConcessions(); renderFeeBalance(); };
}

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

// Complaints desk (feature 147): who has it, how urgent, the date to answer by, escalation and a written response.
const complaintOverdue = (item) => item.status !== 'resolved' && Boolean(item.dueOn) && item.dueOn < localToday();
const withoutBlank = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== ''));
lists.complaints = ownerList({
  id: 'complaints', collection: 'complaints', empty: 'No complaints logged.', saved: 'Complaint logged.', noEdit: true,
  sort: (a, b) => (a.data().status === 'resolved') - (b.data().status === 'resolved') || complaintOverdue(b.data()) - complaintOverdue(a.data())
    || (b.data().status === 'escalated') - (a.data().status === 'escalated') || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!text(fields, 'title') || !text(fields, 'raisedBy')) return { error: 'Enter the complaint and who raised it.' };
    if (text(fields, 'dueOn') && !DATE_TEXT.test(text(fields, 'dueOn'))) return { error: 'Choose a valid date to answer by.' };
    return { id: newId('CP'), data: { title: text(fields, 'title'), raisedBy: text(fields, 'raisedBy'), date: localToday(), status: 'open',
      priority: ['low', 'normal', 'high'].includes(text(fields, 'priority')) ? text(fields, 'priority') : 'normal', ...optional(fields, 'note', 'assignedTo', 'dueOn') } };
  },
  line: (item) => '[' + item.status + (item.priority === 'high' ? ', HIGH' : '') + (complaintOverdue(item) ? ', OVERDUE' : '') + '] ' + item.date + ' - ' + item.title
    + ' - by ' + item.raisedBy + (item.assignedTo ? ' - with ' + item.assignedTo : '') + (item.dueOn ? ' - answer by ' + item.dueOn : '')
    + (item.note ? ' (' + item.note + ')' : '') + (item.response ? ' | Response (' + item.respondedOn + '): ' + item.response : ''),
  extra: (record, act) => {
    const item = record.data();
    const buttons = [];
    const add = (label, changes, message, ask) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        const extra = ask?.();
        if (extra === null) return;
        act(() => academic.save('complaints', record.id, withoutBlank({ ...item, ...changes, ...extra })), message);
      });
      buttons.push(button);
    };
    if (item.status !== 'resolved') {
      add('Assign', {}, 'Assigned.', () => {
        const who = prompt('Give this complaint to (name):', item.assignedTo ?? '');
        return who === null ? null : { assignedTo: who.trim().slice(0, 80) };
      });
      if (item.status === 'open') add('Start work', { status: 'in-progress' }, 'Marked in progress.');
      if (item.status !== 'escalated') add('Escalate', { status: 'escalated' }, 'Escalated.');
      add('Respond and resolve', { status: 'resolved', respondedOn: localToday() }, 'Resolved.', () => {
        const reply = prompt('Write the response given to ' + item.raisedBy + ':', '');
        if (reply === null) return null;
        return reply.trim() ? { response: reply.trim().slice(0, 500) } : null;
      });
    } else {
      add('Reopen', { status: 'open' }, 'Reopened.');
    }
    return buttons;
  },
});

// Scholarships (feature 152). A scheme has an amount, seats and a lowest marks percent. Approving an application saves the
// application and a fee concession together in one batch, so a scholarship cannot be approved without reaching the student's fees.
const approvedSeats = (schemeId) => (lists.scholarshipapps?.items ?? []).filter((record) => record.data().schemeId === schemeId && record.data().status === 'approved').length;
lists.scholarships = ownerList({
  id: 'scholarships', collection: 'scholarships', empty: 'No scholarship schemes yet.', saved: 'Scheme saved.',
  sort: (a, b) => a.data().name.localeCompare(b.data().name),
  build: (fields) => {
    const amount = wholeNumber(fields, 'amount');
    const seats = wholeNumber(fields, 'seats');
    const minPercent = wholeNumber(fields, 'minPercent');
    if (!text(fields, 'name') || !(amount >= 1 && amount <= 10000000) || !(seats >= 1 && seats <= 10000) || !(minPercent >= 0 && minPercent <= 100)) {
      return { error: 'Enter the name, the amount in whole rupees, the seats and a marks percent from 0 to 100.' };
    }
    return { id: newId('SC'), data: { name: text(fields, 'name'), amount, seats, minPercent, active: text(fields, 'active') !== 'false', ...optional(fields, 'criteria') } };
  },
  line: (item, record) => item.name + ' - ' + rupees(item.amount) + ' each - ' + (lists.scholarshipapps?.loaded ? approvedSeats(record.id) + ' of ' + item.seats + ' seats taken' : item.seats + ' seat(s)')
    + ' - lowest marks ' + item.minPercent + '%' + (item.active ? '' : ' - CLOSED') + (item.criteria ? ' (' + item.criteria + ')' : ''),
  canRemove: (record) => !(lists.scholarshipapps?.items ?? []).some((app) => app.data().schemeId === record.id),
});
lists.scholarshipapps = ownerList({
  id: 'scholarshipapps', collection: 'scholarshipApps', empty: 'No applications yet.', saved: 'Application recorded.', noEdit: true,
  sort: (a, b) => b.data().appliedOn.localeCompare(a.data().appliedOn) || b.id.localeCompare(a.id),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('schemeId'), lists.scholarships.items.filter((record) => record.data().active), (item) => item.name + ' (min ' + item.minPercent + '%)');
    fillSelect(form.elements.namedItem('studentId'), studentRecords.filter((item) => item.data().status === 'active').sort(byStudentName), studentOption);
  },
  build: (fields, items) => {
    const scheme = lists.scholarships.items.find((record) => record.id === text(fields, 'schemeId'));
    const student = pickedStudent(fields);
    const percent = wholeNumber(fields, 'percent');
    if (!scheme || !student || !(percent >= 0 && percent <= 100)) return { error: 'Choose the scheme and the student, and enter a marks percent from 0 to 100.' };
    if (!scheme.data().active) return { error: 'This scheme is closed for applications.' };
    if (percent < scheme.data().minPercent) return { error: 'This scheme needs at least ' + scheme.data().minPercent + '% marks.' };
    if (items.some((record) => record.data().schemeId === scheme.id && record.data().studentId === student.id && record.data().status !== 'rejected')) {
      return { error: 'This student already has an application for this scheme.' };
    }
    return { id: newId('SA'), data: { schemeId: scheme.id, schemeName: scheme.data().name, studentId: student.id, studentName: student.data().name, percent,
      status: 'applied', appliedOn: localToday(), ...optional(fields, 'note') } };
  },
  line: (item) => item.appliedOn + ' - ' + item.studentName + ' - ' + item.schemeName + ' - ' + item.percent + '% - ' + item.status.toUpperCase()
    + (item.decidedOn ? ' on ' + item.decidedOn : '') + (item.note ? ' (' + item.note + ')' : ''),
  canRemove: (record) => record.data().status !== 'approved',
  extra: (record) => {
    const item = record.data();
    if (item.status !== 'applied' || viewOnly) return [];
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = 'Approve and add concession';
    approve.addEventListener('click', async () => {
      const tools = academic;
      const scheme = lists.scholarships.items.find((found) => found.id === item.schemeId);
      if (!tools || tools.busy || !scheme) return;
      if (approvedSeats(item.schemeId) >= scheme.data().seats) { document.querySelector('#scholarshipapps-status').textContent = 'All seats of this scheme are taken.'; return; }
      if (!confirm('Approve ' + item.studentName + ' for ' + item.schemeName + '? A scholarship of ' + rupees(scheme.data().amount) + ' is added to their fee concessions.')) return;
      const request = schoolRequest;
      tools.busy = true;
      try {
        await tools.commit([
          { path: ['scholarshipApps', record.id], data: { ...item, status: 'approved', decidedOn: localToday() } },
          { path: ['concessions', 'CN-' + record.id], data: { studentId: item.studentId, studentName: item.studentName, kind: 'Scholarship', amount: scheme.data().amount,
            givenOn: localToday(), note: item.schemeName } },
        ]);
        tools.busy = false;
        await Promise.all([lists.scholarshipapps.load(request), lists.concessions.load(request)]);
        if (request === schoolRequest) document.querySelector('#scholarshipapps-status').textContent = 'Approved. The scholarship is in Fee Concessions.';
      } catch {
        if (request === schoolRequest) document.querySelector('#scholarshipapps-status').textContent = 'That did not work. Check the details and try again.';
      } finally {
        tools.busy = false;
      }
    });
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.textContent = 'Reject';
    reject.addEventListener('click', async () => {
      const tools = academic;
      if (!tools || tools.busy) return;
      const request = schoolRequest;
      tools.busy = true;
      try {
        await tools.save('scholarshipApps', record.id, { ...item, status: 'rejected', decidedOn: localToday() });
        tools.busy = false;
        await lists.scholarshipapps.load(request);
      } catch {
        if (request === schoolRequest) document.querySelector('#scholarshipapps-status').textContent = 'That did not work. Try again.';
      } finally {
        tools.busy = false;
      }
    });
    return [approve, reject];
  },
});

// Parent consent forms (feature 151). The owner sends a form; each linked parent answers Yes or No for their own child.
const CONSENT_KIND = { trip: 'trip', photo: 'photo or media', other: 'other' };
const consentsDetail = document.querySelector('#consents-detail');
lists.consents = ownerList({
  id: 'consents', collection: 'consentForms', empty: 'No consent forms yet.', saved: 'Form sent. Parents can answer from their dashboard.', noEdit: true,
  sort: (a, b) => (a.data().status === 'closed') - (b.data().status === 'closed') || b.id.localeCompare(a.id),
  build: (fields) => {
    if (!text(fields, 'title') || !text(fields, 'text')) return { error: 'Enter a title and what you are asking.' };
    if (text(fields, 'dueOn') && !DATE_TEXT.test(text(fields, 'dueOn'))) return { error: 'Choose a valid date.' };
    return { id: newId('CF'), data: { title: text(fields, 'title'), text: text(fields, 'text'), kind: ['trip', 'photo', 'other'].includes(text(fields, 'kind')) ? text(fields, 'kind') : 'other',
      status: 'open', createdOn: localToday(), ...optional(fields, 'dueOn') } };
  },
  line: (item) => '[' + item.status + '] ' + item.createdOn + ' - ' + item.title + ' (' + CONSENT_KIND[item.kind] + ')' + (item.dueOn ? ' - answer by ' + item.dueOn : ''),
  extra: (record, act) => {
    const item = record.data();
    const answers = document.createElement('button');
    answers.type = 'button';
    answers.textContent = 'See answers';
    answers.addEventListener('click', async () => {
      const request = schoolRequest;
      consentsDetail.textContent = 'Loading answers.';
      try {
        const { collection, getDocsFromServer, query, where } = firestoreTools;
        const saved = await getDocsFromServer(query(collection(academic.schoolRef, 'consentResponses'), where('formId', '==', record.id)));
        if (request !== schoolRequest) return;
        const decided = new Map(saved.docs.map((found) => [found.data().studentId, found.data().decision]));
        const pupils = studentRecords.filter((student) => student.data().status === 'active');
        const names = (test) => pupils.filter((student) => test(decided.get(student.id))).map((student) => student.data().name).sort().join(', ') || 'none';
        consentsDetail.replaceChildren();
        for (const line of [item.title + ' - answers from ' + decided.size + ' of ' + pupils.length + ' active students',
          'Yes (' + pupils.filter((student) => decided.get(student.id) === 'yes').length + '): ' + names((value) => value === 'yes'),
          'No (' + pupils.filter((student) => decided.get(student.id) === 'no').length + '): ' + names((value) => value === 'no'),
          'Not answered (' + pupils.filter((student) => !decided.has(student.id)).length + '): ' + names((value) => value === undefined)]) {
          const row = document.createElement('p');
          row.textContent = line;
          consentsDetail.append(row);
        }
      } catch {
        if (request === schoolRequest) consentsDetail.textContent = 'Could not load the answers. Try again.';
      }
    });
    if (viewOnly) return [answers];
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = item.status === 'open' ? 'Close form' : 'Reopen form';
    toggle.addEventListener('click', () => act(() => academic.save('consentForms', record.id, { ...item, status: item.status === 'open' ? 'closed' : 'open' }), 'Updated.'));
    return [answers, toggle];
  },
});

// ---------- Batch 63 ----------
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_ORDER = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];
const actionButton = (label, onClick) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
};

// Hostel (feature 144).
const stayingIn = (roomId) => (lists.hostelstays?.items ?? []).filter((record) => record.data().roomId === roomId && record.data().status === 'staying').length;
lists.hostelrooms = ownerList({
  id: 'hostelrooms', collection: 'hostelRooms', empty: 'No hostel rooms yet.', saved: 'Room saved.',
  sort: (a, b) => a.data().name.localeCompare(b.data().name, undefined, { numeric: true }),
  build: (fields) => {
    const beds = wholeNumber(fields, 'beds');
    const fee = text(fields, 'monthlyFee') ? wholeNumber(fields, 'monthlyFee') : undefined;
    if (!text(fields, 'name') || !(beds >= 1 && beds <= 50) || (fee !== undefined && !(fee >= 0))) return { error: 'Enter the room, the number of beds and a whole-rupee fee if any.' };
    return { id: newId('HR'), data: { name: text(fields, 'name'), beds, ...optional(fields, 'block'), ...(fee === undefined ? {} : { monthlyFee: fee }) } };
  },
  line: (item, record) => item.name + (item.block ? ' (' + item.block + ')' : '') + ' - ' + item.beds + ' beds'
    + (lists.hostelstays?.loaded ? ' - ' + stayingIn(record.id) + ' in use' : '') + (item.monthlyFee ? ' - ' + rupees(item.monthlyFee) + ' a month' : ''),
});
lists.hostelstays = ownerList({
  id: 'hostelstays', collection: 'hostelStays', empty: 'No one is allocated a bed yet.', saved: 'Bed allocated.', noEdit: true,
  sort: (a, b) => (a.data().status === 'left') - (b.data().status === 'left') || a.data().roomName.localeCompare(b.data().roomName, undefined, { numeric: true }),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('roomId'), [...lists.hostelrooms.items].sort((a, b) => a.data().name.localeCompare(b.data().name, undefined, { numeric: true })),
      (item) => item.name + ' (' + item.beds + ' beds' + (lists.hostelstays.loaded ? ', ' + (item.beds - stayingIn(item.id)) + ' free' : '') + ')');
    fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption);
    if (!form.elements.namedItem('from').value) form.elements.namedItem('from').value = localToday();
  },
  build: (fields, items) => {
    const room = lists.hostelrooms.items.find((record) => record.id === text(fields, 'roomId'));
    const student = pickedStudent(fields);
    if (!room || !student || !DATE_TEXT.test(text(fields, 'from'))) return { error: 'Choose the room, the student and the date.' };
    if (items.some((record) => record.data().studentId === student.id && record.data().status === 'staying')) return { error: student.data().name + ' already has a bed. Mark them as moved out first.' };
    const used = items.filter((record) => record.data().roomId === room.id && record.data().status === 'staying').length;
    if (used >= room.data().beds) return { error: room.data().name + ' is full (' + room.data().beds + ' beds).' };
    return { id: newId('HS'), data: { studentId: student.id, studentName: student.data().name, roomId: room.id, roomName: room.data().name, from: text(fields, 'from'), status: 'staying' } };
  },
  line: (item) => item.studentName + ' - ' + item.roomName + ' - from ' + item.from + (item.status === 'left' ? ' - left ' + (item.leftOn ?? '') : ' - staying'),
  extra: (record, act) => {
    if (record.data().status !== 'staying' || viewOnly) return [];
    return [actionButton('Moved out', () => act(() => academic.save('hostelStays', record.id, { ...record.data(), status: 'left', leftOn: localToday() }), 'Marked as moved out.'))];
  },
});

// Canteen (feature 145).
lists.canteenmenu = ownerList({
  id: 'canteenmenu', collection: 'canteenMenu', empty: 'No menu items yet.', saved: 'Menu item saved.',
  sort: (a, b) => DAY_ORDER.indexOf(a.data().day) - DAY_ORDER.indexOf(b.data().day) || MEAL_ORDER.indexOf(a.data().meal) - MEAL_ORDER.indexOf(b.data().meal),
  build: (fields) => {
    const price = text(fields, 'price') ? wholeNumber(fields, 'price') : undefined;
    if (!DAY_ORDER.includes(text(fields, 'day')) || !MEAL_ORDER.includes(text(fields, 'meal')) || !text(fields, 'items') || (price !== undefined && !(price >= 0))) {
      return { error: 'Choose the day and the meal, enter the items, and a whole-rupee price if any.' };
    }
    return { id: newId('CM'), data: { day: text(fields, 'day'), meal: text(fields, 'meal'), items: text(fields, 'items'), ...(price === undefined ? {} : { price }) } };
  },
  line: (item) => item.day + ' ' + item.meal + ': ' + item.items + (item.price !== undefined ? ' - ' + rupees(item.price) : ''),
});
lists.canteenplans = ownerList({
  id: 'canteenplans', collection: 'canteenPlans', empty: 'No meal plans yet.', saved: 'Meal plan added.', noEdit: true,
  sort: (a, b) => (b.data().active === true) - (a.data().active === true) || a.data().studentName.localeCompare(b.data().studentName),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption);
    if (!form.elements.namedItem('from').value) form.elements.namedItem('from').value = localToday();
  },
  build: (fields) => {
    const student = pickedStudent(fields);
    const fee = wholeNumber(fields, 'monthlyFee');
    if (!student || !text(fields, 'plan') || !(fee >= 0) || !DATE_TEXT.test(text(fields, 'from'))) return { error: 'Choose the student, name the plan, and enter the fee in whole rupees.' };
    return { id: newId('CP'), data: { studentId: student.id, studentName: student.data().name, plan: text(fields, 'plan'), monthlyFee: fee, from: text(fields, 'from'), active: true } };
  },
  line: (item) => item.studentName + ' - ' + item.plan + ' - ' + rupees(item.monthlyFee) + ' a month - from ' + item.from + (item.active ? '' : ' - STOPPED'),
  extra: (record, act) => viewOnly ? [] : [actionButton(record.data().active ? 'Stop plan' : 'Restart plan',
    () => act(() => academic.save('canteenPlans', record.id, { ...record.data(), active: !record.data().active }), 'Updated.'))],
});

// Book reservations (feature 137): a waiting list per book, first come first served.
const reservationLine = (record) => {
  const item = record.data();
  const queue = (lists.bookreservations?.items ?? []).filter((other) => other.data().bookId === item.bookId && ['waiting', 'ready'].includes(other.data().status))
    .sort((a, b) => a.data().createdOn.localeCompare(b.data().createdOn) || a.id.localeCompare(b.id));
  const place = queue.findIndex((other) => other.id === record.id);
  return place >= 0 ? ' - number ' + (place + 1) + ' in line' : '';
};
lists.bookreservations = ownerList({
  id: 'bookreservations', collection: 'bookReservations', empty: 'No reservations.', saved: 'Reserved.', noEdit: true,
  sort: (a, b) => (['waiting', 'ready'].includes(b.data().status)) - (['waiting', 'ready'].includes(a.data().status)) || a.data().createdOn.localeCompare(b.data().createdOn) || a.id.localeCompare(b.id),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('bookId'), [...libBooks].sort((a, b) => a.data().title.localeCompare(b.data().title)), (book) => book.title);
    fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption);
  },
  build: (fields, items) => {
    const book = libBooks.find((record) => record.id === text(fields, 'bookId'));
    const student = pickedStudent(fields);
    if (!book || !student) return { error: 'Choose the book and the student.' };
    if (items.some((record) => record.data().bookId === book.id && record.data().studentId === student.id && ['waiting', 'ready'].includes(record.data().status))) {
      return { error: student.data().name + ' is already waiting for this book.' };
    }
    return { id: newId('BR'), data: { bookId: book.id, bookTitle: book.data().title, studentId: student.id, studentName: student.data().name, createdOn: localToday(), status: 'waiting' } };
  },
  line: (item, record) => item.createdOn + ' - ' + item.bookTitle + ' - ' + item.studentName + ' - ' + item.status.toUpperCase() + reservationLine(record),
  canRemove: (record) => !['waiting', 'ready'].includes(record.data().status),
  extra: (record, act) => {
    const item = record.data();
    if (viewOnly || !['waiting', 'ready'].includes(item.status)) return [];
    const step = (label, status, message) => actionButton(label, () => act(() => academic.save('bookReservations', record.id, { ...item, status }), message));
    return [...(item.status === 'waiting' ? [step('Book is ready', 'ready', 'Marked ready. Tell the student.')] : [step('Collected', 'collected', 'Marked collected.')]),
      step('Cancel', 'cancelled', 'Cancelled.')];
  },
});

// Approval rules (feature 156): an expense at or above the amount waits for the owner's approval.
lists.workflowrules = ownerList({
  id: 'workflowrules', collection: 'workflowRules', empty: 'No approval rules yet. Every expense counts at once.', saved: 'Rule saved.',
  sort: (a, b) => a.data().over - b.data().over,
  build: (fields) => {
    const over = wholeNumber(fields, 'over');
    if (!text(fields, 'name') || !(over >= 1 && over <= 100000000)) return { error: 'Name the rule and enter the amount in whole rupees.' };
    return { id: newId('WR'), data: { name: text(fields, 'name'), over, kind: 'expense' } };
  },
  line: (item) => item.name + ' - an expense of ' + rupees(item.over) + ' or more waits for approval',
});
const approvalThreshold = () => Math.min(...(lists.workflowrules?.items ?? []).map((record) => record.data()).filter((rule) => rule.kind === 'expense').map((rule) => rule.over), Infinity);

// Question bank and online tests (feature 139).
lists.questionbank = ownerList({
  id: 'questionbank', collection: 'questionBank', empty: 'No questions yet.', saved: 'Question saved.', noEdit: true,
  sort: (a, b) => nameOfClass(a.data().classId).localeCompare(nameOfClass(b.data().classId)) || a.data().text.localeCompare(b.data().text),
  prepare: (form) => fillSelect(form.elements.namedItem('classId'), [...examData.classes].sort(byClassOrder), (item) => item.name),
  build: (fields) => {
    const options = [1, 2, 3, 4].map((number) => text(fields, 'opt' + number));
    const chosen = Number(text(fields, 'correct')) - 1;
    const marks = wholeNumber(fields, 'marks');
    if (!text(fields, 'classId') || !text(fields, 'text') || !(marks >= 1 && marks <= 20)) return { error: 'Choose the class, write the question and give marks from 1 to 20.' };
    const used = options.filter(Boolean);
    if (options.findIndex((option, index) => !option && options.slice(index + 1).some(Boolean)) >= 0 || used.length < 2) return { error: 'Fill the options in order, with at least two.' };
    if (!options[chosen]) return { error: 'The right answer must be one of the options you filled.' };
    return { id: newId('QB'), data: { classId: text(fields, 'classId'), text: text(fields, 'text'), options: used, correct: chosen, marks, ...optional(fields, 'subjectName') } };
  },
  line: (item) => '[' + nameOfClass(item.classId) + (item.subjectName ? ', ' + item.subjectName : '') + '] ' + item.text + ' - ' + item.options.map((option, index) => (index + 1) + ') ' + option).join('  ')
    + ' - right: ' + (item.correct + 1) + ' - ' + item.marks + ' mark(s)',
});
const onlineDetail = document.querySelector('#onlinetests-detail');
// Online test question picker: filter by class, subject and word, tick questions one by one, or pick a number at random.
const otForm = document.querySelector('#onlinetests-form');
const otList = document.querySelector('#otpick-list');
const otSummary = document.querySelector('#otpick-summary');
const otSubject = document.querySelector('#otpick-subject');
const otSearch = document.querySelector('#otpick-search');
const otCount = document.querySelector('#otpick-count');
const OT_MAX_QUESTIONS = 60;
const OT_SHOW_LIMIT = 300;
const otPicked = new Set();
const otShown = () => {
  const classId = otForm.elements.namedItem('classId').value;
  const subject = otSubject.value;
  const word = otSearch.value.trim().toLowerCase();
  return [...lists.questionbank.items].filter((record) => {
    const data = record.data();
    return data.classId === classId && (!subject || (data.subjectName ?? '') === subject) && (!word || data.text.toLowerCase().includes(word));
  }).sort((a, b) => (a.data().subjectName ?? '').localeCompare(b.data().subjectName ?? '') || a.data().text.localeCompare(b.data().text));
};
function otSync() {
  const select = otForm.elements.namedItem('questionIds');
  for (const option of select.options) option.selected = otPicked.has(option.value);
  const picked = [...otPicked].map((id) => lists.questionbank.items.find((record) => record.id === id)?.data()).filter(Boolean);
  const marks = picked.reduce((sum, item) => sum + item.marks, 0);
  const size = JSON.stringify(picked.map((item) => ({ q: item.text, o: item.options, m: item.marks }))).length;
  const shown = otShown().length;
  otSummary.textContent = picked.length + ' selected (' + marks + ' marks). ' + shown + ' question(s) shown for this class.'
    + (picked.length > OT_MAX_QUESTIONS ? ' A test can have at most ' + OT_MAX_QUESTIONS + ' questions. Untick some.' : '')
    + (size > 30000 ? ' These questions are too long for one test. Choose fewer.' : '');
}
function otRender() {
  const classId = otForm.elements.namedItem('classId').value;
  // Drop anything picked for another class or removed from the bank.
  for (const id of [...otPicked]) {
    const record = lists.questionbank.items.find((found) => found.id === id);
    if (!record || record.data().classId !== classId) otPicked.delete(id);
  }
  const subjects = [...new Set(lists.questionbank.items.filter((record) => record.data().classId === classId).map((record) => record.data().subjectName ?? '').filter(Boolean))].sort();
  const keep = subjects.includes(otSubject.value) ? otSubject.value : '';
  otSubject.replaceChildren(new Option('All subjects', ''), ...subjects.map((name) => new Option(name, name)));
  otSubject.value = keep;
  otList.replaceChildren();
  const shown = otShown();
  for (const record of shown.slice(0, OT_SHOW_LIMIT)) {
    const data = record.data();
    const row = document.createElement('label');
    row.className = 'otq';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = otPicked.has(record.id);
    box.addEventListener('change', () => { if (box.checked) otPicked.add(record.id); else otPicked.delete(record.id); otSync(); });
    const words = document.createElement('span');
    words.textContent = (data.subjectName ? '[' + data.subjectName + '] ' : '') + data.text + ' (' + data.marks + (data.marks === 1 ? ' mark' : ' marks') + ')';
    row.append(box, words);
    otList.append(row);
  }
  if (!shown.length) { const none = document.createElement('p'); none.textContent = 'No questions for this class yet. Add them in the Question Bank.'; otList.append(none); }
  else if (shown.length > OT_SHOW_LIMIT) { const more = document.createElement('p'); more.textContent = 'Showing the first ' + OT_SHOW_LIMIT + '. Use Subject or Search to narrow the list.'; otList.append(more); }
  otSync();
}
function fillQuestionPicker() {
  const select = otForm.elements.namedItem('questionIds');
  select.replaceChildren();
  for (const record of lists.questionbank.items) select.append(new Option(record.data().text.slice(0, 70), record.id));
  otRender();
}
otForm.elements.namedItem('classId').addEventListener('change', () => { otSubject.value = ''; otRender(); });
otSubject.addEventListener('change', otRender);
otSearch.addEventListener('input', otRender);
document.querySelector('#otpick-all').addEventListener('click', () => {
  for (const record of otShown().slice(0, OT_SHOW_LIMIT)) otPicked.add(record.id);
  otRender();
});
document.querySelector('#otpick-clear').addEventListener('click', () => { otPicked.clear(); otRender(); });
document.querySelector('#otpick-random').addEventListener('click', () => {
  const wanted = Number.parseInt(otCount.value, 10);
  if (!(wanted >= 1 && wanted <= OT_MAX_QUESTIONS)) { otSummary.textContent = 'Type how many questions you need, from 1 to ' + OT_MAX_QUESTIONS + '.'; return; }
  const pool = otShown();
  if (!pool.length) { otSummary.textContent = 'There are no questions to pick from. Check the class, subject and search.'; return; }
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  otPicked.clear();
  for (const record of pool.slice(0, wanted)) otPicked.add(record.id);
  otRender();
  if (wanted > pool.length) otSummary.textContent = 'Only ' + pool.length + ' question(s) are available, so all of them were picked. ' + otSummary.textContent;
});
otForm.addEventListener('reset', () => setTimeout(() => { otPicked.clear(); otSearch.value = ''; otRender(); }, 0));
// Question Bank import (CSV file, pasted rows or a shared Google Sheet). Rows are checked first and only the good ones are saved.
const qbStatus = document.querySelector('#qbimport-status');
const qbText = document.querySelector('#qbimport-text');
const qbPreview = document.querySelector('#qbimport-preview');
const qbRun = document.querySelector('#qbimport-run');
const qbClass = document.querySelector('#qbimport-class');
const QB_MAX_ROWS = 500;
let qbReady = [];
document.querySelector('#questionbank').addEventListener('mod-open', () => {
  fillSelect(qbClass, [...examData.classes].sort(byClassOrder), (item) => item.name);
});
document.querySelector('#qbimport-sample').addEventListener('click', () => {
  const first = [...examData.classes].sort(byClassOrder)[0]?.data().name ?? 'Class 1';
  const rows = [['Class', 'Subject', 'Question', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Right answer', 'Marks'],
    [first, 'GK', 'Which letter comes after A?', 'A', 'B', 'C', 'D', '2', '1'],
    [first, 'Maths', 'What is 2 + 3?', '4', '5', '6', '', 'B', '2']];
  const blob = new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'question-bank-sample.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
document.querySelector('#qbimport-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 1000000) { qbStatus.textContent = 'That file is too large. Import up to ' + QB_MAX_ROWS + ' questions at a time.'; return; }
  qbText.value = await file.text();
  qbReady = []; qbRun.disabled = true;
  qbStatus.textContent = 'File loaded. Press Check rows.';
});
document.querySelector('#qbimport-fetch').addEventListener('click', async () => {
  const link = document.querySelector('#qbimport-link').value.trim();
  const found = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(link);
  if (!found) { qbStatus.textContent = 'Paste the full Google Sheet link (it contains /spreadsheets/d/...).'; return; }
  const gid = /[#&?]gid=([0-9]+)/.exec(link)?.[1];
  qbStatus.textContent = 'Reading the Google Sheet.';
  try {
    const reply = await fetch('https://docs.google.com/spreadsheets/d/' + found[1] + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : ''), { credentials: 'omit' });
    const body = await reply.text();
    if (!reply.ok || /^\s*</.test(body)) throw new Error('blocked');
    qbText.value = body;
    qbReady = []; qbRun.disabled = true;
    qbStatus.textContent = 'Sheet loaded. Press Check rows.';
  } catch {
    qbStatus.textContent = 'Could not read that sheet. In Google Sheets press Share, set "Anyone with the link" to Viewer, then try again. Or use File, Download, CSV and choose the file here.';
  }
});
document.querySelector('#qbimport-check').addEventListener('click', async () => {
  qbPreview.replaceChildren(); qbReady = []; qbRun.disabled = true;
  if (!academic) return;
  await lists.questionbank.ensure();
  let rows = parseDelimited(qbText.value.replace(/^﻿/, '').trim());
  if (rows.length) {
    const head = rows[0].map((cell) => cell.trim().toLowerCase());
    if (head[0] === 'class' || head[2] === 'question' || head.includes('question')) rows = rows.slice(1);
  }
  if (!rows.length) { qbStatus.textContent = 'There are no rows yet. Choose a file, fetch a sheet or paste rows.'; return; }
  if (rows.length > QB_MAX_ROWS) { qbStatus.textContent = 'That is ' + rows.length + ' rows. Import up to ' + QB_MAX_ROWS + ' at a time.'; return; }
  const byName = new Map(examData.classes.map((record) => [record.data().name.trim().toLowerCase(), record.id]));
  const have = new Set(lists.questionbank.items.map((record) => record.data().classId + '|' + record.data().text.trim().toLowerCase()));
  const problems = [];
  let duplicates = 0;
  rows.forEach((cells, index) => {
    const cell = (n) => String(cells[n] ?? '').trim();
    const fail = (why) => problems.push('Row ' + (index + 1) + ': ' + why);
    const className = cell(0);
    const classId = className ? byName.get(className.toLowerCase()) : qbClass.value;
    if (!classId) { fail(className ? 'unknown class "' + className.slice(0, 30) + '"' : 'no class (choose a default class)'); return; }
    const question = cell(2);
    if (!question || question.length > 300) { fail('write the question (up to 300 characters)'); return; }
    const subject = cell(1);
    if (subject.length > 60) { fail('subject is longer than 60 characters'); return; }
    const options = [3, 4, 5, 6].map(cell);
    const used = options.filter(Boolean);
    if (used.length < 2 || options.findIndex((option, at) => !option && options.slice(at + 1).some(Boolean)) >= 0) { fail('fill at least two options, in order'); return; }
    if (used.some((option) => option.length > 120)) { fail('an option is longer than 120 characters'); return; }
    const answer = cell(7);
    let correct = /^[1-4]$/.test(answer) ? Number(answer) - 1 : /^[a-dA-D]$/.test(answer) ? answer.toUpperCase().charCodeAt(0) - 65 : used.findIndex((option) => option.toLowerCase() === answer.toLowerCase());
    if (!(correct >= 0 && correct < used.length)) { fail('the right answer must be 1 to ' + used.length + ', A to ' + 'ABCD'[used.length - 1] + ', or the exact option text'); return; }
    const marksText = cell(8);
    const marks = marksText === '' ? 1 : (/^[0-9]+$/.test(marksText) ? Number(marksText) : NaN);
    if (!(marks >= 1 && marks <= 20)) { fail('marks must be 1 to 20'); return; }
    const key = classId + '|' + question.toLowerCase();
    if (have.has(key)) { duplicates += 1; return; }
    have.add(key);
    qbReady.push({ classId, text: question, options: used, correct, marks, ...(subject ? { subjectName: subject } : {}) });
  });
  for (const item of qbReady.slice(0, 5)) listItem(qbPreview, '[' + nameOfClass(item.classId) + '] ' + item.text + ' (right: ' + (item.correct + 1) + ', ' + item.marks + ' mark(s))');
  for (const message of problems.slice(0, 10)) listItem(qbPreview, message);
  qbStatus.textContent = qbReady.length + ' question(s) ready' + (duplicates ? ', ' + duplicates + ' already in the bank (skipped)' : '') + (problems.length ? ', ' + problems.length + ' with problems (not imported)' : '') + '.';
  qbRun.disabled = !qbReady.length || viewOnly;
});
qbRun.addEventListener('click', async () => {
  if (viewOnly) { qbStatus.textContent = 'Only the owner can add questions.'; return; }
  if (!academic || academic.busy || !qbReady.length) return;
  if (!confirm('Add ' + qbReady.length + ' question(s) to the Question Bank?')) return;
  const request = schoolRequest;
  academic.busy = true;
  qbRun.disabled = true;
  try {
    let saved = 0;
    for (let start = 0; start < qbReady.length; start += 100) {
      const group = qbReady.slice(start, start + 100);
      await academic.commit(group.map((data) => ({ path: ['questionBank', newId('QB')], data })), true);
      saved += group.length;
      if (request === schoolRequest) qbStatus.textContent = 'Saved ' + saved + ' of ' + qbReady.length + '...';
    }
    await academic.log('bulk', 'questionBank', saved + ' questions', '').catch(() => {});
    qbReady = [];
    qbText.value = '';
    qbPreview.replaceChildren();
    academic.busy = false;
    await lists.questionbank.load(request);
    if (request === schoolRequest) qbStatus.textContent = 'Added ' + saved + ' question(s) to the Question Bank.';
  } catch (error) {
    if (request === schoolRequest) qbStatus.textContent = 'Some questions were not saved (' + (error && error.code ? error.code : 'error') + '). Press Check rows to see what is left.';
  } finally {
    academic.busy = false;
  }
});

const TEST_STAGE = { draft: 'draft, not visible to students', open: 'OPEN for students', closed: 'closed' };
async function gradeTest(record) {
  const request = schoolRequest;
  const { collection, doc, getDocFromServer, getDocsFromServer, query, where } = firestoreTools;
  onlineDetail.textContent = 'Reading answer sheets.';
  try {
    // The principal cannot read the answer key, so the principal only sees scores the owner has already recorded.
    const [keyDoc, sheets] = await Promise.all([viewOnly ? null : getDocFromServer(doc(academic.schoolRef, 'onlineTestKeys', record.id)),
      getDocsFromServer(query(collection(academic.schoolRef, 'onlineAttempts'), where('testId', '==', record.id)))]);
    if (request !== schoolRequest) return;
    if (!viewOnly && !keyDoc.exists()) { onlineDetail.textContent = 'The answer key for this test is missing.'; return; }
    const key = keyDoc ? keyDoc.data().key.split(',').map(Number) : [];
    const marks = keyDoc ? keyDoc.data().marks.split(',').map(Number) : [];
    const total = record.data().totalMarks;
    const scored = sheets.docs.map((sheet) => {
      const answers = sheet.data().answers.split(',');
      const score = sheet.data().score ?? (keyDoc ? key.reduce((sum, right, index) => sum + (answers[index] === String(right) ? marks[index] : 0), 0) : null);
      return { sheet, score };
    });
    const pending = scored.filter(({ sheet, score }) => sheet.data().score === undefined && score !== null);
    if (pending.length && !viewOnly) {
      // The sheet is written back unchanged except for the score and the date, so the answers and the time stay as the student sent them.
      await academic.commit(pending.map(({ sheet, score }) => ({ path: ['onlineAttempts', sheet.id], data: { ...sheet.data(), score, gradedOn: localToday() } })), true);
    }
    if (request !== schoolRequest) return;
    onlineDetail.replaceChildren();
    const done = scored.filter((item) => item.score !== null);
    const head = document.createElement('p');
    head.textContent = record.data().title + ' - ' + scored.length + ' answer sheet(s), out of ' + total + ' marks'
      + (done.length ? '. Average ' + Math.round(done.reduce((sum, item) => sum + item.score, 0) / done.length * 10) / 10 : '') + '.';
    onlineDetail.append(head);
    for (const { sheet, score } of scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))) {
      const row = document.createElement('p');
      row.textContent = nameOfStudent(sheet.data().studentId) + ' - ' + (score === null ? 'not graded yet' : score + ' of ' + total);
      onlineDetail.append(row);
    }
  } catch {
    if (request === schoolRequest) onlineDetail.textContent = 'Could not grade the test. Try again.';
  }
}
lists.onlinetests = ownerList({
  id: 'onlinetests', collection: 'onlineTests', empty: 'No online tests yet.', saved: 'Test created as a draft. Open it when students may start.', noEdit: true,
  sort: (a, b) => b.id.localeCompare(a.id),
  prepare: (form) => {
    fillSelect(form.elements.namedItem('classId'), [...examData.classes].sort(byClassOrder), (item) => item.name);
    fillQuestionPicker();
  },
  build: (fields) => {
    const ids = fields.getAll('questionIds');
    const minutes = wholeNumber(fields, 'durationMin');
    if (!text(fields, 'title') || !text(fields, 'classId') || !(minutes >= 5 && minutes <= 180)) return { error: 'Enter a title, choose the class and a time from 5 to 180 minutes.' };
    if (!lists.questionbank.loaded) return { error: 'Open Question Bank once so the questions load, then try again.' };
    const questions = ids.map((id) => lists.questionbank.items.find((record) => record.id === id)?.data()).filter(Boolean);
    if (!questions.length || questions.length > 60) return { error: 'Choose from 1 to 60 questions.' };
    if (questions.some((item) => item.classId !== text(fields, 'classId'))) return { error: 'Every question must be for the class you chose.' };
    const paper = JSON.stringify(questions.map((item) => ({ q: item.text, o: item.options, m: item.marks })));
    if (paper.length > 30000) return { error: 'That is too much text for one test. Choose fewer questions.' };
    const id = newId('OT');
    return { id, data: { title: text(fields, 'title'), classId: text(fields, 'classId'), className: nameOfClass(text(fields, 'classId')).slice(0, 40), durationMin: minutes, status: 'draft',
      paper, count: questions.length, totalMarks: questions.reduce((sum, item) => sum + item.marks, 0), createdOn: localToday() },
    also: [{ path: ['onlineTestKeys', id], data: { key: questions.map((item) => item.correct).join(','), marks: questions.map((item) => item.marks).join(',') } }] };
  },
  line: (item) => item.createdOn + ' - ' + item.title + ' - ' + item.className + ' - ' + item.count + ' question(s), ' + item.totalMarks + ' marks, ' + item.durationMin + ' min - ' + TEST_STAGE[item.status],
  canRemove: (record) => record.data().status === 'draft',
  extra: (record, act) => {
    const item = record.data();
    const buttons = [];
    if (!viewOnly) {
      if (item.status === 'draft') buttons.push(actionButton('Open for students', () => act(() => academic.save('onlineTests', record.id, { ...item, status: 'open' }), 'Test is open.')));
      if (item.status === 'open') buttons.push(actionButton('Close test', () => act(() => academic.save('onlineTests', record.id, { ...item, status: 'closed' }), 'Test closed.')));
      if (item.status === 'closed') buttons.push(actionButton('Open again', () => act(() => academic.save('onlineTests', record.id, { ...item, status: 'open' }), 'Test is open again.')));
    }
    if (item.status !== 'draft') buttons.push(actionButton(viewOnly ? 'See results' : 'Grade and see results', () => gradeTest(record)));
    return buttons;
  },
});
document.querySelector('#onlinetests').addEventListener('mod-open', async () => { await lists.questionbank.ensure(); fillQuestionPicker(); });

// Student pickup (feature 146). The code is 6 random digits; the parent's QR code carries "PICK:" and the code.
const newPickupCode = () => {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0] % 1000000).padStart(6, '0');
};
lists.pickuppeople = ownerList({
  id: 'pickuppeople', collection: 'pickupPeople', empty: 'No pickup people yet.', saved: 'Person added. Give them the code.', noEdit: true,
  sort: (a, b) => studentName(a.data().studentId).localeCompare(studentName(b.data().studentId)) || a.data().name.localeCompare(b.data().name),
  prepare: (form) => fillSelect(form.elements.namedItem('studentId'), activeStudents(), studentOption),
  build: (fields, items) => {
    const student = pickedStudent(fields);
    const phone = text(fields, 'phone');
    if (!student || !text(fields, 'name') || !text(fields, 'relation')) return { error: 'Choose the student and enter the name and relation.' };
    if (phone && !/^[0-9+() -]{1,20}$/.test(phone)) return { error: 'The phone number can have only digits, spaces and + ( ) -.' };
    let code = newPickupCode();
    while (items.some((record) => record.data().code === code)) code = newPickupCode();
    return { id: newId('PK'), data: { studentId: student.id, name: text(fields, 'name'), relation: text(fields, 'relation'), ...(phone ? { phone } : {}), code, active: true, createdBy: schoolUid } };
  },
  line: (item) => studentName(item.studentId) + ' - ' + item.name + ' (' + item.relation + ')' + (item.phone ? ' - ' + item.phone : '') + ' - code ' + item.code + (item.active ? '' : ' - SWITCHED OFF'),
  extra: (record, act) => viewOnly ? [] : [actionButton(record.data().active ? 'Switch off' : 'Switch on',
    () => act(() => academic.save('pickupPeople', record.id, { ...record.data(), active: !record.data().active }), 'Updated.'))],
});
const studentName = (id) => studentRecords.find((record) => record.id === id)?.data().name ?? id;

const gateCode = document.querySelector('#pickupgate-code');
const gateStatus = document.querySelector('#pickupgate-status');
const gateResult = document.querySelector('#pickupgate-result');
const gateLog = document.querySelector('#pickupgate-log');
async function loadGateLog() {
  const request = schoolRequest;
  const { collection, getDocsFromServer } = firestoreTools;
  try {
    const saved = await getDocsFromServer(collection(academic.schoolRef, 'pickupLogs'));
    if (request !== schoolRequest) return;
    gateLog.replaceChildren();
    for (const record of saved.docs.sort((a, b) => (b.data().at?.toMillis?.() ?? 0) - (a.data().at?.toMillis?.() ?? 0)).slice(0, 25)) {
      const item = record.data();
      listItem(gateLog, new Date(item.at?.toMillis?.() ?? 0).toLocaleString() + ' - ' + item.studentName + ' collected by ' + item.personName + ' (' + item.relation + ')');
    }
  } catch {
    if (request === schoolRequest) gateStatus.textContent = 'Could not load the hand-over log.';
  }
}
document.querySelector('#pickupgate').addEventListener('mod-open', async () => { await lists.pickuppeople.ensure(); loadGateLog(); });
document.querySelector('#pickupgate-check').addEventListener('click', async () => {
  gateResult.replaceChildren();
  const code = (gateCode.value.match(/[0-9]{6}/) ?? [])[0];
  if (!code) { gateStatus.textContent = 'Enter the 6-digit code.'; return; }
  await lists.pickuppeople.ensure();
  const matches = lists.pickuppeople.items.filter((found) => found.data().code === code);
  if (!matches.length) { gateStatus.textContent = 'No one has this code. Do not hand the child over.'; return; }
  const live = matches.filter((found) => found.data().active);
  if (!live.length) { gateStatus.textContent = matches[0].data().name + ' has been switched off for ' + studentName(matches[0].data().studentId) + '. Do not hand the child over.'; return; }
  gateStatus.textContent = live.length > 1 ? 'More than one person has this code. Pick the student who is being collected.' : '';
  for (const record of live) {
  const item = record.data();
  const line = document.createElement('p');
  line.textContent = 'OK: ' + studentName(item.studentId) + ' may go with ' + item.name + ' (' + item.relation + ')' + (item.phone ? ', phone ' + item.phone : '') + '.';
  const button = actionButton('Hand over', async () => {
    button.disabled = true;
    const request = schoolRequest;
    try {
      const { doc, setDoc, serverTimestamp } = firestoreTools;
      await setDoc(doc(academic.schoolRef, 'pickupLogs', newId('PL')), { studentId: item.studentId, studentName: studentName(item.studentId), personName: item.name,
        relation: item.relation, at: serverTimestamp(), by: schoolUid });
      if (request !== schoolRequest) return;
      gateResult.replaceChildren();
      gateCode.value = '';
      gateStatus.textContent = 'Recorded.';
      loadGateLog();
    } catch {
      button.disabled = false;
      if (request === schoolRequest) gateStatus.textContent = 'That was not recorded. Try again.';
    }
  });
  gateResult.append(line, button);
  }
});

// Risk and benchmarks (features 153, 155): signals worked out from attendance, marks and fees already in the system.
const riskBody = document.querySelector('#riskboard-body');
const riskClasses = document.querySelector('#riskboard-classes');
const riskStatus = document.querySelector('#riskboard-status');
let riskRows = [];
const percentText = (value) => value === null ? 'not enough data' : Math.round(value) + '%';
document.querySelector('#riskboard-run').addEventListener('click', async () => {
  const request = schoolRequest;
  const year = activeYearRecord();
  if (!academic || !year) { riskStatus.textContent = 'Set an active academic year first.'; return; }
  riskStatus.textContent = 'Reading attendance and marks.';
  try {
    const { collection, getDocsFromServer, query, where } = firestoreTools;
    const since = addDays(localToday(), -30);
    const middle = addDays(localToday(), -15);
    const [attendance, marks] = await Promise.all([
      getDocsFromServer(query(collection(academic.schoolRef, 'attendance'), where('date', '>=', since))),
      getDocsFromServer(query(collection(academic.schoolRef, 'marks'), where('yearId', '==', year.id))),
    ]);
    if (request !== schoolRequest) return;
    const classOf = new Map(placementData.enrollments.filter((record) => record.data().yearId === year.id).map((record) => [record.data().studentId, record.data().classId]));
    const att = new Map();
    for (const record of attendance.docs) {
      const item = record.data();
      const entry = att.get(item.studentId) ?? { all: 0, here: 0, early: 0, earlyHere: 0, late: 0, lateHere: 0 };
      const here = item.status === 'absent' ? 0 : 1;
      entry.all += 1; entry.here += here;
      if (item.date < middle) { entry.early += 1; entry.earlyHere += here; } else { entry.late += 1; entry.lateHere += here; }
      att.set(item.studentId, entry);
    }
    const score = new Map();
    for (const record of marks.docs) {
      const item = record.data();
      if (item.draft === true) continue;
      const entry = score.get(item.studentId) ?? { got: 0, max: 0 };
      entry.got += item.score; entry.max += item.maxMarks;
      score.set(item.studentId, entry);
    }
    const haveFees = feeData.structures.length > 0;
    const students = studentRecords.filter((record) => record.data().status === 'active');
    riskRows = [];
    const byClass = new Map();
    for (const record of students) {
      const classId = classOf.get(record.id) ?? '';
      const a = att.get(record.id);
      const attPct = a && a.all >= 5 ? a.here / a.all * 100 : null;
      const trend = a && a.early >= 3 && a.late >= 3 ? a.lateHere / a.late * 100 - a.earlyHere / a.early * 100 : null;
      const s = score.get(record.id);
      const marksPct = s && s.max > 0 ? s.got / s.max * 100 : null;
      const overdue = haveFees && classId ? feeSummaryFor(record.id, year.id, classId).overdue : 0;
      const signals = [];
      if (attPct !== null && attPct < 75) signals.push('attendance below 75%');
      if (trend !== null && trend <= -20 && !(attPct !== null && attPct < 75)) signals.push('attendance falling');
      if (marksPct !== null && marksPct < 40) signals.push('exam average below 40%');
      if (overdue > 0) signals.push('fees overdue ' + rupees(overdue));
      riskRows.push({ id: record.id, name: record.data().name, classId, attPct, marksPct, overdue, signals });
      const group = byClass.get(classId) ?? { n: 0, att: [], marks: [], overdueCount: 0 };
      group.n += 1;
      if (attPct !== null) group.att.push(attPct);
      if (marksPct !== null) group.marks.push(marksPct);
      if (overdue > 0) group.overdueCount += 1;
      byClass.set(classId, group);
    }
    riskBody.replaceChildren();
    const flagged = riskRows.filter((row) => row.signals.length).sort((a, b) => b.signals.length - a.signals.length || (a.attPct ?? 101) - (b.attPct ?? 101));
    for (const row of flagged) {
      addRow(riskBody, [row.name, row.classId ? nameOfClass(row.classId) : '-', percentText(row.attPct), percentText(row.marksPct), row.overdue ? rupees(row.overdue) : '-',
        (row.signals.length >= 2 ? 'HIGH: ' : 'Watch: ') + row.signals.join('; ')]);
    }
    riskClasses.replaceChildren();
    const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    for (const [classId, group] of [...byClass].sort((a, b) => nameOfClass(a[0]).localeCompare(nameOfClass(b[0])))) {
      if (group.n < 5) { addRow(riskClasses, [classId ? nameOfClass(classId) : 'Not placed', group.n, 'hidden', 'hidden', 'hidden']); continue; }
      addRow(riskClasses, [classId ? nameOfClass(classId) : 'Not placed', group.n, percentText(average(group.att)), percentText(average(group.marks)), Math.round(group.overdueCount / group.n * 100) + '% of students']);
    }
    riskStatus.textContent = flagged.length ? flagged.length + ' of ' + students.length + ' active students show a signal.' : 'No student shows a signal in the last 30 days.'
      + (haveFees ? '' : ' Fee data was not loaded, so fees are not part of this check.');
  } catch {
    if (request === schoolRequest) riskStatus.textContent = 'Could not analyse. Try again.';
  }
});
document.querySelector('#riskboard-csv').addEventListener('click', () => {
  if (!riskRows.length) { riskStatus.textContent = 'Press Analyse first.'; return; }
  downloadCsv('student-risk', [['Student', 'Class', 'Attendance 30 days %', 'Exam average %', 'Fees overdue', 'Signals'],
    ...riskRows.filter((row) => row.signals.length).map((row) => [row.name, row.classId ? nameOfClass(row.classId) : '', row.attPct === null ? '' : Math.round(row.attPct),
      row.marksPct === null ? '' : Math.round(row.marksPct), row.overdue, row.signals.join('; ')])]);
});

// ---------- Batch 64 ----------
// Fee reminders (feature 148). The owner finds students with overdue fees and sends a reminder record for each; the server job
// turns every new record into a phone notification for that family.
const reminderStatus = document.querySelector('#feereminders-status');
const reminderList = document.querySelector('#feereminders-list');
const reminderHistory = document.querySelector('#feereminders-history');
let reminderPlan = [];
let reminderSent = [];
let reminderBusy = false;
async function loadReminderHistory() {
  const request = schoolRequest;
  try {
    const { collection, getDocsFromServer } = firestoreTools;
    const saved = await getDocsFromServer(collection(academic.schoolRef, 'feeReminders'));
    if (request !== schoolRequest) return;
    reminderSent = saved.docs.map((record) => record.data());
    reminderHistory.replaceChildren();
    for (const item of [...reminderSent].sort((a, b) => b.createdOn.localeCompare(a.createdOn)).slice(0, 30)) {
      listItem(reminderHistory, item.createdOn + ' - ' + item.studentName + ' - ' + rupees(item.amount) + (item.message ? ' (' + item.message + ')' : ''));
    }
    collapseList(reminderHistory, 5, 'recent reminders');
  } catch (error) {
    if (request === schoolRequest) reminderStatus.textContent = 'Could not load the reminders already sent (' + (error && error.code ? error.code : 'error') + ').';
  }
}
document.querySelector('#feereminders').addEventListener('mod-open', loadReminderHistory);
document.querySelector('#feereminders-find').addEventListener('click', async () => {
  const year = activeYearRecord();
  if (!academic || !year) { reminderStatus.textContent = 'Set an active academic year first.'; return; }
  if (!feeData.structures.length) { reminderStatus.textContent = 'Fees are not set up for this year yet, so there is nothing to remind about.'; return; }
  const minimum = Math.max(1, Number.parseInt(document.querySelector('#feereminders-min').value || '1', 10) || 1);
  const skipDays = Number.parseInt(document.querySelector('#feereminders-skip').value, 10);
  if (!reminderSent.length) await loadReminderHistory();
  const since = skipDays > 0 ? addDays(localToday(), -skipDays) : '9999-12-31';
  const recent = new Set(reminderSent.filter((item) => item.createdOn >= since).map((item) => item.studentId));
  const classOf = new Map(placementData.enrollments.filter((record) => record.data().yearId === year.id).map((record) => [record.data().studentId, record.data().classId]));
  reminderPlan = [];
  let skipped = 0;
  for (const record of studentRecords.filter((found) => found.data().status === 'active')) {
    const classId = classOf.get(record.id);
    if (!classId) continue;
    const overdue = feeSummaryFor(record.id, year.id, classId).overdue;
    if (overdue < minimum) continue;
    if (recent.has(record.id)) { skipped += 1; continue; }
    reminderPlan.push({ studentId: record.id, studentName: record.data().name, amount: overdue });
  }
  reminderPlan.sort((a, b) => b.amount - a.amount);
  reminderList.replaceChildren();
  for (const item of reminderPlan) listItem(reminderList, item.studentName + ' - ' + rupees(item.amount) + ' overdue');
  collapseList(reminderList, 8, 'students');
  reminderStatus.textContent = reminderPlan.length ? reminderPlan.length + ' student(s) will get a reminder' + (skipped ? ' (' + skipped + ' skipped, reminded recently)' : '') + '. Press Send reminders.'
    : 'No student needs a reminder' + (skipped ? ' (' + skipped + ' reminded recently)' : '') + '.';
});
document.querySelector('#feereminders-send').addEventListener('click', async () => {
  if (viewOnly) { reminderStatus.textContent = 'Only the owner can send reminders.'; return; }
  if (!academic || reminderBusy) return;
  if (!reminderPlan.length) { reminderStatus.textContent = 'Press Find students with dues first.'; return; }
  const message = document.querySelector('#feereminders-message').value.trim().slice(0, 200);
  if (!confirm('Send a fee reminder to ' + reminderPlan.length + ' famil' + (reminderPlan.length === 1 ? 'y' : 'ies') + '?')) return;
  const request = schoolRequest;
  reminderBusy = true;
  try {
    const today = localToday();
    let sent = 0;
    const failed = [];
    const sentSet = new Set();
    const toRecord = (item) => ({ path: ['feeReminders', newId('FR')], data: { studentId: item.studentId, studentName: String(item.studentName).slice(0, 80),
      amount: Math.max(1, Math.round(Number(item.amount))), createdOn: today, ...(message ? { message } : {}), by: schoolUid } });
    // The rules look up each student once, and one batch may make only 20 such lookups, so each batch stays small.
    // If a batch is refused, its students are tried one by one so a single bad record cannot block the others.
    const queue = [...reminderPlan];
    for (let start = 0; start < queue.length; start += 10) {
      const group = queue.slice(start, start + 10);
      try {
        await academic.commit(group.map(toRecord));
        sent += group.length;
        for (const item of group) sentSet.add(item);
      } catch {
        for (const item of group) {
          try { await academic.commit([toRecord(item)]); sent += 1; sentSet.add(item); } catch (error) { failed.push({ item, code: error && error.code ? error.code : 'error' }); }
        }
      }
      if (request === schoolRequest) reminderStatus.textContent = 'Sent ' + sent + ' reminder(s)...';
      if (!sent && failed.length >= 10) break;
    }
    reminderPlan = queue.filter((item) => !sentSet.has(item));
    if (failed.length) {
      const first = failed[0];
      if (request === schoolRequest) {
        reminderStatus.textContent = sent + ' sent, ' + failed.length + ' not sent (' + first.code + '). First: ' + first.item.studentName + ' / ' + first.item.studentId + ' / ' + first.item.amount + '.';
        await loadReminderHistory();
        reminderStatus.textContent = sent + ' sent, ' + failed.length + ' not sent (' + first.code + '). First: ' + first.item.studentName + ' / ' + first.item.studentId + ' / ' + first.item.amount + '.';
      }
      return;
    }
    reminderPlan = [];
    if (request === schoolRequest) { reminderList.replaceChildren(); collapseList(reminderList, 8, 'students'); reminderStatus.textContent = 'Sent ' + sent + ' reminder(s).'; await loadReminderHistory(); }
  } catch (error) {
    if (request === schoolRequest) reminderStatus.textContent = 'Some reminders were not sent (' + (error && error.code ? error.code : 'error') + '). Press Find students with dues again to see who is left.';
  } finally {
    reminderBusy = false;
  }
});

// Parent: reminders and phone notifications.
const portalRemindersSection = document.querySelector('#portal-reminders');
const portalRemindersStatus = document.querySelector('#portal-reminders-status');
const portalRemindersList = document.querySelector('#portal-reminders-list');
const portalPushSection = document.querySelector('#portal-push');
const portalPushStatus = document.querySelector('#portal-push-status');
const portalPushOn = document.querySelector('#portal-push-on');
const portalPushOff = document.querySelector('#portal-push-off');
let portalPush; // { tools, studentId, busy }
async function loadPortalAlerts(tools, request, studentId) {
  if (portalRole === 'student') { portalRemindersSection.hidden = true; portalPushSection.hidden = true; return; }
  const { schoolRef, collection, doc, getDocFromServer, getDocsFromServer, query, where } = tools;
  portalPush = { tools, studentId, busy: false };
  portalRemindersSection.hidden = false;
  portalPushSection.hidden = false;
  try {
    const [saved, token] = await Promise.all([
      getDocsFromServer(query(collection(schoolRef, 'feeReminders'), where('studentId', '==', studentId))),
      getDocFromServer(doc(schoolRef, 'pushTokens', tools.user.uid)).catch(() => null),
    ]);
    if (request !== schoolRequest) return;
    portalRemindersList.replaceChildren();
    for (const item of saved.docs.map((record) => record.data()).sort((a, b) => b.createdOn.localeCompare(a.createdOn)).slice(0, 10)) {
      listItem(portalRemindersList, item.createdOn + ' - ' + rupees(item.amount) + ' overdue' + (item.message ? ' - ' + item.message : ''));
    }
    portalRemindersStatus.textContent = saved.docs.length ? '' : 'No reminders.';
    const on = Boolean(token?.exists()) && 'Notification' in window && Notification.permission === 'granted';
    portalPushOn.hidden = on;
    portalPushOff.hidden = !on;
    portalPushStatus.textContent = on ? 'Notifications are on for this phone.' : (PUSH_VAPID_KEY ? '' : 'Notifications are not switched on for this school yet.');
  } catch {
    if (request === schoolRequest) portalRemindersStatus.textContent = 'Could not load. Try again.';
  }
}
portalPushOn.addEventListener('click', async () => {
  const context = portalPush;
  if (!context || context.busy) return;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) { portalPushStatus.textContent = 'This browser cannot receive notifications. On an iPhone, add the app to the Home Screen first.'; return; }
  if (!PUSH_VAPID_KEY) { portalPushStatus.textContent = 'Notifications are not switched on for this school yet.'; return; }
  context.busy = true;
  const request = schoolRequest;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { portalPushStatus.textContent = 'Notifications are blocked. Allow them in the browser settings for this site.'; return; }
    const { getMessaging, getToken, isSupported } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js');
    if (!(await isSupported())) { portalPushStatus.textContent = 'This browser cannot receive notifications.'; return; }
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: PUSH_VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) { portalPushStatus.textContent = 'Could not turn on notifications. Try again.'; return; }
    const { schoolRef, collection, doc, setDoc, getDocsFromServer, query, where } = context.tools;
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', context.studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    await setDoc(doc(schoolRef, 'pushTokens', context.tools.user.uid), { token, studentId: context.studentId, ...(latest?.classId ? { classId: latest.classId } : {}), updatedOn: localToday() });
    if (request === schoolRequest) { portalPushOn.hidden = true; portalPushOff.hidden = false; portalPushStatus.textContent = 'Notifications are on for this phone.'; }
  } catch {
    if (request === schoolRequest) portalPushStatus.textContent = 'Could not turn on notifications. Try again.';
  } finally {
    context.busy = false;
  }
});
portalPushOff.addEventListener('click', async () => {
  const context = portalPush;
  if (!context || context.busy) return;
  context.busy = true;
  try {
    const { doc, deleteDoc } = firestoreTools;
    await deleteDoc(doc(context.tools.schoolRef, 'pushTokens', context.tools.user.uid));
    portalPushOn.hidden = false;
    portalPushOff.hidden = true;
    portalPushStatus.textContent = 'Notifications are off.';
  } catch {
    portalPushStatus.textContent = 'That did not work. Try again.';
  } finally {
    context.busy = false;
  }
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
    return { id: newId('TR'), data: { staffName: text(fields, 'staffName'), course: text(fields, 'course'), date: text(fields, 'date'), hours,
      status: text(fields, 'status') === 'planned' ? 'planned' : 'completed' } };
  },
  line: (item) => item.date + ' - ' + item.staffName + ' - ' + item.course + ' (' + item.hours + ' h)' + (item.status === 'planned' ? ' - PLANNED' : ''),
  extra: (record, act) => {
    if (record.data().status !== 'planned' || viewOnly) return [];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mark completed';
    button.addEventListener('click', () => act(() => academic.save('trainings', record.id, { ...record.data(), status: 'completed' }), 'Marked completed.'));
    return [button];
  },
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
// Backup reminder and simple security checks, worked out from the settings/backupLog record and the activity log.
let backupLog = null;
async function loadBackupLog() {
  try {
    const { doc, getDocFromServer } = firestoreTools;
    const found = await getDocFromServer(doc(academic.schoolRef, 'settings', 'backupLog'));
    backupLog = found.exists() ? found.data() : null;
  } catch {
    backupLog = null;
  }
  // The nightly server backup (feature 086) reports into settings/autoBackup.
  try {
    const { doc, getDocFromServer } = firestoreTools;
    const auto = await getDocFromServer(doc(academic.schoolRef, 'settings', 'autoBackup'));
    const line = document.querySelector('#backup-auto');
    if (!auto.exists()) line.textContent = 'Automatic nightly backup: no backup has run yet.';
    else if (auto.data().ok) line.textContent = 'Automatic nightly backup: last saved ' + auto.data().date + ', ' + auto.data().docs + ' records, checked after saving.';
    else line.textContent = 'Automatic nightly backup FAILED on ' + auto.data().date + '. Download a backup by hand and tell AZIZ support.';
  } catch { /* the school has no automatic backup result to show */ }
}
async function noteBackup(kind) {
  try {
    await academic.save('settings', 'backupLog', { lastAt: localToday(), kind });
    backupLog = { lastAt: localToday(), kind };
    refreshAttention();
  } catch { /* the backup itself already succeeded */ }
}
function securityNotes() {
  const notes = [];
  const days = backupLog ? Math.floor((Date.parse(localToday()) - Date.parse(backupLog.lastAt)) / 86400000) : null;
  if (!backupLog) notes.push('No data backup has been downloaded yet. Use Data Backup below.');
  else if (days > 14) notes.push('The last data backup was ' + days + ' days ago. Download a fresh one.');
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent = auditItems.filter((item) => item.at >= since);
  const voids = recent.filter((item) => item.action === 'void').length;
  const removals = recent.filter((item) => item.action === 'remove').length;
  if (voids >= 3) notes.push(voids + ' payments were voided in the last 7 days. Check the activity log.');
  if (removals >= 10) notes.push(removals + ' records were removed in the last 7 days. Check the activity log.');
  const studentRemovals = recent.filter((item) => item.action === 'remove' && item.target === 'students').length;
  if (studentRemovals >= 3) notes.push(studentRemovals + ' student records were removed in the last 7 days. Check the activity log.');
  const night = recent.filter((item) => { const hour = new Date(item.at).getHours(); return hour >= 23 || hour < 5; }).length;
  if (night >= 5) notes.push(night + ' changes were made between 11 pm and 5 am in the last 7 days. Check the activity log.');
  if (principalAccess.payroll) notes.push('The principal login can open staff payroll. Switch it off in Principal Access if that is not intended.');
  return notes;
}

function complianceNotes() {
  const notes = [];
  for (const record of lists.vehicles.items) {
    const item = record.data();
    for (const [label, key] of [['insurance', 'insuranceExpiry'], ['fitness certificate', 'fitnessExpiry'], ['driver licence', 'licenseExpiry']]) {
      if (!item[key]) continue;
      const days = daysUntil(item[key]);
      if (days < 0) notes.push('Vehicle ' + item.regNo + ': ' + label + ' expired on ' + item[key] + '.');
      else if (days <= SOON_DAYS) notes.push('Vehicle ' + item.regNo + ': ' + label + ' expires in ' + days + ' day(s).');
    }
    const riders = lists.riders.items.filter((rider) => rider.data().routeId === item.routeId).length;
    if (item.routeId && riders > item.capacity) notes.push('Vehicle ' + item.regNo + ' has ' + riders + ' riders for ' + item.capacity + ' seats.');
  }
  return notes;
}
function storageNotes() {
  const used = (lists.storage.items.reduce((sum, record) => sum + record.data().sizeKb, 0) + vaultKb()) / 1024;
  if (!storagePlanMb) return [];
  const percent = used / storagePlanMb * 100;
  if (percent >= 100) return ['Storage is full: ' + Math.round(used) + ' MB of ' + storagePlanMb + ' MB. New records and uploads are refused until space is freed or the plan is raised.'];
  if (percent >= 80) return ['Storage is ' + Math.round(percent) + '% full (' + Math.round(used) + ' MB of ' + storagePlanMb + ' MB).'];
  return [];
}

function refreshAttention() {
  const count = (list, test) => list.items.filter((record) => test(record.data())).length;
  const checks = [
    [count(lists.inventory, (item) => item.quantity <= item.minQuantity), 'inventory item(s) at or below the stock warning level'],
    [count(lists.enquiries, (item) => item.status === 'new'), 'new admission enquiry(ies) not yet handled'],
    [count(lists.inbox, (item) => !item.reply), 'parent message(s) waiting for a reply'],
    [count(lists.tickets, (item) => item.status === 'open'), 'open maintenance ticket(s)'],
    [count(lists.complaints, (item) => item.status !== 'resolved'), 'open complaint(s)'],
    [count(lists.complaints, (item) => item.status === 'escalated'), 'escalated complaint(s)'],
    [count(lists.complaints, complaintOverdue), 'complaint(s) past the date to answer'],
    [count(lists.expenses, (item) => item.status === 'pending'), 'expense(s) waiting for approval'],
    [count(lists.scholarshipapps, (item) => item.status === 'applied'), 'scholarship application(s) waiting for a decision'],
    [count(lists.lostfound, (item) => item.status === 'open'), 'lost and found item(s) still open'],
    [count(lists.syllabus, (item) => item.status !== 'Done'), 'syllabus chapter(s) not finished'],
  ].filter(([number]) => number > 0);
  attentionList.replaceChildren();
  const monthDay = localToday().slice(5);
  const birthdays = studentRecords.map((record) => record.data())
    .filter((student) => student.status === 'active' && student.dob && student.dob.slice(5) === monthDay).map((student) => student.name);
  if (birthdays.length) {
    const item = document.createElement('li');
    item.textContent = 'Birthday today: ' + birthdays.join(', ');
    attentionList.append(item);
  }
  for (const [number, label] of checks) {
    const item = document.createElement('li');
    item.textContent = number + ' ' + label;
    attentionList.append(item);
  }
  const notes = [...approvalNotes(), ...alertNotes(), ...securityNotes(), ...complianceNotes(), ...storageNotes(), ...vaultNotes()];
  for (const note of notes) listItem(attentionList, note);
  attentionStatus.textContent = checks.length || birthdays.length || notes.length ? '' : 'Nothing needs attention right now.';
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
    for (const record of lists.expenses.items) if (expenseCounts(record.data())) slot(record.data().date.slice(0, 7)).spent += record.data().amount;
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
    if (data.dob) rows.push(['Date of birth', data.dob]);
    if (data.address) rows.push(['Address', data.address]);
    for (const record of enrollments.docs.filter((item) => item.data().studentId === studentId)) {
      const placement = record.data();
      rows.push(['Class ' + placement.yearId, nameOfClass(placement.classId) + ', roll ' + placement.rollNo]);
    }
    const paid = payments.docs.filter((item) => item.data().studentId === studentId && !item.data().voided);
    rows.push(['Fees paid', rupees(paid.reduce((sum, item) => sum + item.data().amount, 0)) + ' in ' + paid.length + ' receipt(s)']);
    await Promise.all([lists.achievements.ensure(), lists.certificates.ensure(), lists.sales.ensure()]);
    if (request !== schoolRequest) return;
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

// Class roster: the students placed in a class this year, to read on screen or print.
const rosterClass = document.querySelector('#roster-class');
const rosterStatus = document.querySelector('#roster-status');
const rosterSheet = document.querySelector('#roster-sheet');
const rosterBody = document.querySelector('#roster-body');
const fillRosterClasses = () => {
  const chosen = rosterClass.value;
  rosterClass.replaceChildren(new Option('Choose a class', ''),
    ...[...examData.classes].sort(byClassOrder).map((record) => new Option(record.data().name, record.id)));
  rosterClass.value = chosen;
};
rosterClass.addEventListener('focus', fillRosterClasses);
rosterClass.addEventListener('mousedown', fillRosterClasses);
function buildRoster() {
  const activeYear = examData.years.find((item) => item.data().status === 'active');
  if (!rosterClass.value || !activeYear) {
    rosterStatus.textContent = rosterClass.value ? 'There is no active year yet.' : 'Choose a class first.';
    return false;
  }
  const rows = placementData.enrollments.map((item) => item.data())
    .filter((item) => item.yearId === activeYear.id && item.classId === rosterClass.value)
    .sort((a, b) => String(a.sectionId).localeCompare(String(b.sectionId)) || a.rollNo - b.rollNo);
  rosterBody.replaceChildren();
  for (const placement of rows) {
    const student = studentRecords.find((item) => item.id === placement.studentId)?.data();
    if (!student) continue;
    const section = placementData.sections.find((item) => item.id === placement.sectionId)?.data().name ?? placement.sectionId;
    addRow(rosterBody, [String(placement.rollNo), section, student.name, student.admissionNo, student.guardianName, student.guardianPhone || '-']);
  }
  document.querySelector('#roster-title-line').textContent = nameOfClass(rosterClass.value) + ' - ' + activeYear.data().label + ' - ' + rows.length + ' student(s)';
  rosterSheet.hidden = false;
  rosterStatus.textContent = rows.length ? '' : 'No students are placed in this class for the active year.';
  return rows.length > 0;
}
document.querySelector('#roster-show').addEventListener('click', buildRoster);
document.querySelector('#roster-print').addEventListener('click', () => {
  if (buildRoster()) printCard('#roster-head', 'Class roster ' + nameOfClass(rosterClass.value));
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
      ...optional(fields, 'allergies', 'conditions', 'emergencyContact', 'notes', 'vaccinations'),
      ...(DATE_TEXT.test(text(fields, 'lastCheckup')) ? { lastCheckup: text(fields, 'lastCheckup') } : {}),
      ...(DATE_TEXT.test(text(fields, 'nextCheckup')) ? { nextCheckup: text(fields, 'nextCheckup') } : {}) } };
  },
  line: (item) => nameOfStudent(item.studentId) + (item.bloodGroup ? ' - blood group ' + item.bloodGroup : '')
    + (item.allergies ? ' - allergies: ' + item.allergies : '') + (item.conditions ? ' - conditions: ' + item.conditions : '')
    + (item.emergencyContact ? ' - emergency: ' + item.emergencyContact : '')
    + (item.vaccinations ? ' - vaccinations: ' + item.vaccinations : '') + (item.lastCheckup ? ' - last checkup ' + item.lastCheckup : '')
    + (item.nextCheckup ? ' - next checkup ' + item.nextCheckup + (item.nextCheckup < localToday() ? ' (OVERDUE)' : '') : '')
    + (item.notes ? ' (' + item.notes + ')' : ''),
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
  extra: (record) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Payslip';
    button.addEventListener('click', () => printPayslip(record.data()));
    return [button];
  },
});

// Income tax estimate (new regime, 4% cess). Taxable yearly pay = (basic + allowances) x 12 minus the Rs 75,000 standard deduction.
// Slabs: up to 4 lakh nil, then 5%, 10%, 15%, 20%, 25% each 4 lakh, and 30% above 24 lakh. Tax is nil up to 12 lakh taxable,
// and just above 12 lakh it never takes more than the amount above 12 lakh. Check the slabs each year.
const NEW_REGIME_BANDS = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
function annualIncomeTax(taxable) {
  let tax = 0;
  let from = 0;
  for (const [limit, rate] of NEW_REGIME_BANDS) {
    if (taxable > from) tax += (Math.min(taxable, limit) - from) * rate;
    from = limit;
  }
  tax = taxable <= 1200000 ? 0 : Math.min(tax, taxable - 1200000);
  return Math.round(tax * 1.04);
}
const monthlyIncomeTax = (monthlyPay) => Math.round(annualIncomeTax(Math.max(0, monthlyPay * 12 - 75000)) / 12);

// Payroll helper: provident fund as a percentage of basic pay plus professional tax fill the deductions box.
document.querySelector('#payroll-calc').addEventListener('click', () => {
  const form = document.querySelector('#payroll-form');
  const basic = Number(form.elements.namedItem('basic').value);
  const percent = Number(form.elements.namedItem('pfPercent').value);
  const ptax = Number(form.elements.namedItem('ptax').value);
  if (!(basic >= 0) || !(percent >= 0) || !(ptax >= 0)) { document.querySelector('#payroll-status').textContent = 'Enter the basic pay first.'; return; }
  const withTax = form.elements.namedItem('withTax').checked;
  const allowances = Number(form.elements.namedItem('allowances').value) || 0;
  const tax = withTax ? monthlyIncomeTax(basic + allowances) : 0;
  form.elements.namedItem('deductions').value = String(Math.round(basic * percent / 100) + Math.round(ptax) + tax);
  document.querySelector('#payroll-status').textContent = 'Deductions filled in as provident fund plus professional tax'
    + (withTax ? ' plus an income tax estimate of ' + rupees(tax) + ' a month' : '')
    + '. Check them before saving.'
    + (withTax ? ' The tax estimate uses the new regime, treats basic plus allowances as the whole yearly salary, and allows the standard deduction. It is not a tax filing: confirm it with your accountant.' : '');
});

lists.inbox = ownerList({
  id: 'inbox', collection: 'messages', empty: 'No messages yet.',
  sort: (a, b) => b.data().createdAt.localeCompare(a.data().createdAt) || b.id.localeCompare(a.id),
  line: (item) => (item.mod === 'hidden' ? '[HIDDEN from parent] ' : item.mod === 'flagged' ? '[FLAGGED] ' : '')
    + item.createdAt + ' - ' + nameOfStudent(item.studentId) + ' - ' + item.subject + ': ' + item.body
    + (item.reply ? ' | REPLY (' + item.repliedAt + '): ' + item.reply : ' | NOT ANSWERED')
    + (item.modNote ? ' | NOTE: ' + item.modNote : ''),
  extra: (record, act) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = record.data().reply ? 'Change reply' : 'Reply';
    button.addEventListener('click', () => {
      const reply = (prompt('Your reply to the parent:', record.data().reply ?? '') ?? '').trim();
      if (!reply || reply.length > 1000) return;
      act(() => academic.save('messages', record.id, { ...record.data(), reply, repliedAt: localToday() }), 'Reply saved.');
    });
    const moderate = (label, mod, done) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = label;
      control.addEventListener('click', () => {
        const next = { ...record.data() };
        delete next.mod;
        delete next.modNote;
        if (mod) {
          const note = (prompt('Short reason (optional):', '') ?? '').trim().slice(0, 200);
          next.mod = mod;
          if (note) next.modNote = note;
        }
        act(() => academic.save('messages', record.id, next), done);
      });
      return control;
    };
    const mod = record.data().mod;
    return mod
      ? [button, moderate('Restore', '', 'Message restored.')]
      : [button, moderate('Flag', 'flagged', 'Message flagged.'), moderate('Hide', 'hidden', 'Message hidden from the parent.')];
  },
});

// Admission enquiries: sent from the public page, moved along the admission pipeline here. Only the status changes.
// Answers to the school's own extra questions (set in Website Look and Admission Form) are shown with their labels.
let extraLabels = [];
const answersOf = (item) => extraLabels.map((label, index) => (item['a' + (index + 1)] ? label + ': ' + item['a' + (index + 1)] : '')).filter(Boolean).join('; ');
lists.enquiries = ownerList({
  id: 'enquiries', collection: 'enquiries', empty: 'No enquiries yet.',
  summary: (items) => {
    const stages = ['new', 'contacted', 'interview', 'offered', 'admitted', 'rejected'];
    const counts = Object.fromEntries(stages.map((stage) => [stage, items.filter((record) => record.data().status === stage).length]));
    const decided = counts.admitted + counts.rejected;
    document.querySelector('#enquiries-pipeline').textContent = items.length
      ? 'Pipeline: ' + stages.map((stage) => stage + ' ' + counts[stage]).join(' > ') + '. ' + (decided ? 'Admission rate so far: ' + Math.round(counts.admitted / decided * 100) + '%.' : '')
        + (counts.new ? ' ' + counts.new + ' new enquiry(ies) need a first call.' : '') : '';
  },
  sort: (a, b) => b.data().createdAt.localeCompare(a.data().createdAt) || b.id.localeCompare(a.id),
  line: (item) => item.createdAt + ' - ' + item.studentName + ' for ' + item.classApplying + ' - guardian ' + item.guardianName
    + ' (' + item.phone + (item.email ? ', ' + item.email : '') + ')' + (item.message ? ' - "' + item.message + '"' : '')
    + (answersOf(item) ? ' - ' + answersOf(item) : '')
    + ' - STATUS: ' + item.status.toUpperCase() + (item.note ? ' (' + item.note + ')' : ''),
  extra: (record, act) => {
    const buttons = ['contacted', 'interview', 'offered', 'admitted', 'rejected'].filter((status) => status !== record.data().status).map((status) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Mark ' + status;
      button.addEventListener('click', () => act(() => academic.save('enquiries', record.id, { ...record.data(), status }), 'Marked ' + status + '.'));
      return button;
    });
    // Admitted enquiries can start the student record: the form is filled in and opened for the owner to finish.
    if (record.data().status === 'admitted' || record.data().status === 'offered') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Create student record';
      button.addEventListener('click', () => {
        const item = record.data();
        document.querySelector('#owner-dashboard').dispatchEvent(new CustomEvent('ui-open', { detail: 'student-roster' }));
        studentForm.reset();
        studentForm.elements.namedItem('name').value = item.studentName;
        studentForm.elements.namedItem('guardianName').value = item.guardianName;
        studentForm.elements.namedItem('guardianPhone').value = item.phone;
        if (item.email) studentForm.elements.namedItem('guardianEmail').value = item.email;
        admissionEnquiry = { id: record.id, data: item };
        studentStatus.textContent = 'Started from the enquiry for ' + item.classApplying + '. Give an admission number and save. The enquiry is then marked admitted and the class is filled in for you.';
        studentForm.elements.namedItem('admissionNo').focus();
      });
      buttons.push(button);
    }
    if (['offered', 'admitted'].includes(record.data().status)) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy message to parent';
      copy.addEventListener('click', async () => {
        const item = record.data();
        const school = document.querySelector('#school-name')?.textContent.trim() || 'our school';
        const message = item.status === 'admitted'
          ? 'Dear ' + item.guardianName + ', welcome to ' + school + '. ' + item.studentName + ' is admitted to ' + item.classApplying + '. Please visit the school office with the documents asked for to complete the formalities.'
          : 'Dear ' + item.guardianName + ', we are pleased to offer ' + item.studentName + ' a place in ' + item.classApplying + ' at ' + school + '. Please contact the school office to confirm the admission.';
        const where = document.querySelector('#enquiries-status');
        try { await navigator.clipboard.writeText(message); where.textContent = 'Message copied. Paste it into WhatsApp, SMS or email.'; } catch { where.textContent = message; }
      });
      buttons.push(copy);
    }
    return buttons;
  },
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
  'phone', 'email', 'address', 'mapUrl', 'seoTitle', 'seoDesc', 'gallery'];
const MAP_PREFIX = /^https:\/\/www\.google\.com\/maps\/embed\?[^ ]*$/;

// Starter text: fills only the empty boxes from what the school already holds (classes, staff directory, contact),
// so the owner reviews and edits before saving. Nothing is published until Save.
document.querySelector('#website-generate').addEventListener('click', () => {
  const field = (key) => websiteForm.elements.namedItem(key);
  const name = field('name').value.trim() || document.querySelector('#school-name')?.textContent.trim() || 'Our school';
  const classNames = [...examData.classes].sort(byClassOrder).map((item) => item.name);
  const staff = lists.staffdir.items.map((record) => record.data());
  const draft = {
    name,
    tagline: 'Learning with care, growing with confidence',
    about: name + ' is a school that welcomes students from ' + (classNames[0] ?? 'the early years') + ' to ' + (classNames.at(-1) ?? 'the senior classes')
      + '. We work with families so every child is known, supported and encouraged. Add the year of founding and the story of the school here.',
    vision: 'Every child learns well, behaves kindly and leaves school ready for the next step.',
    mission: 'To give each student a safe classroom, good teaching and honest feedback, and to keep parents informed.',
    programmes: classNames.join('\n'),
    faculty: staff.filter((item) => item.qualification).slice(0, 12).map((item) => item.name + ' | ' + item.qualification + ' | ' + item.role).join('\n'),
    seoTitle: name + ' - admissions, classes and contact',
    seoDesc: name + ' offers ' + classNames.length + ' classes. See our programmes, faculty, facilities and how to apply.',
  };
  // Extra sections from other screens: leadership from principal/head roles, facilities from clubs and transport, contact from the school profile.
  const heads = staff.filter((item) => /principal|head ?master|head ?mistress|vice|director/i.test(item.role)).map((item) => item.name + ' - ' + item.role);
  if (heads.length) draft.leadership = heads.join('\n');
  const facilityRows = [];
  if (lists.activities.items.length) facilityRows.push('Clubs and activities: ' + lists.activities.items.map((record) => record.data().name).slice(0, 8).join(', '));
  if (lists.routes.items.length) facilityRows.push('School transport on ' + lists.routes.items.length + ' route(s)');
  if (facilityRows.length) draft.facilities = facilityRows.join('\n');
  let filled = 0;
  for (const [key, value] of Object.entries(draft)) {
    const box = field(key);
    if (box && value && !box.value.trim()) { box.value = value.slice(0, Number(box.maxLength) > 0 ? Number(box.maxLength) : value.length); filled += 1; }
  }
  websiteStatus.textContent = filled ? 'Filled ' + filled + ' empty box(es) with starter text. Read it, change it to your own words, then press Save.'
    : 'Every box already has text, so nothing was changed.';
  showReadiness();
});

// Website readiness: which public sections have text, a percentage, and a link to the live page.
const READY_PARTS = [['about', 'About us'], ['vision', 'Vision'], ['mission', 'Mission'], ['leadership', 'Leadership'], ['programmes', 'Programmes'],
  ['faculty', 'Faculty'], ['facilities', 'Facilities'], ['news', 'News'], ['gallery', 'Gallery'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'],
  ['mapUrl', 'Map'], ['seoTitle', 'Search title'], ['seoDesc', 'Search description']];
function showReadiness() {
  const target = document.querySelector('#website-ready');
  if (!target) return;
  const filled = READY_PARTS.filter(([key]) => websiteForm.elements.namedItem(key).value.trim());
  const missing = READY_PARTS.filter(([key]) => !websiteForm.elements.namedItem(key).value.trim()).map(([, label]) => label);
  target.textContent = 'Website ready: ' + Math.round(filled.length / READY_PARTS.length * 100) + '% (' + filled.length + ' of ' + READY_PARTS.length + ' parts).'
    + (missing.length ? ' Still empty: ' + missing.join(', ') + '.' : ' Everything is filled in.');
  const link = document.querySelector('#website-open');
  if (link && academic?.schoolRef) { link.href = './school?school=' + encodeURIComponent(academic.schoolRef.id); link.hidden = false; }
}
websiteForm.addEventListener('input', showReadiness);

async function loadWebsite(request) {
  const { doc, getDocFromServer } = firestoreTools;
  websiteSection.hidden = false;
  try {
    const saved = await getDocFromServer(doc(academic.schoolRef, 'site', 'main'));
    if (request !== schoolRequest) return;
    const data = saved.exists() ? saved.data() : {};
    for (const key of WEBSITE_FIELDS) websiteForm.elements.namedItem(key).value = data[key] ?? '';
    websiteStatus.textContent = saved.exists() ? '' : 'Nothing is published yet. Fill this in and save.';
    showReadiness();
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

// Feature switches set by the platform administrator hide the matching modules for every school.
// This hides them in the app; it does not block the underlying records.
const FLAG_MODULES = { website: ['website', 'siteextras', 'enquiries'], finance: ['fees', 'payroll', 'expenses', 'finance', 'concessions', 'sales', 'vendors', 'defaulters'],
  library: ['library'], transport: ['routes', 'riders'] };
// The platform's switches (platformConfig/flags) plus this school's computed entitlements (schools/<id>/entitlements/main): features that are off for
// the school's plan, rollout or beta group, or that its override switched off, and which roles may use a feature.
let viewerRole = '';
let roleLimits = {};
async function readFlags() {
  let flags = {};
  const { doc, getDocFromServer } = firestoreTools;
  try {
    const found = await getDocFromServer(doc(academic.schoolRef.firestore, 'platformConfig', 'flags'));
    flags = found.exists() ? found.data() : {};
  } catch { flags = {}; }
  try {
    const ent = await getDocFromServer(doc(academic.schoolRef, 'entitlements', 'main'));
    if (ent.exists()) {
      for (const key of ent.data().off ?? []) flags[key] = false;
      roleLimits = ent.data().roles ?? {};
      for (const [key, roles] of Object.entries(roleLimits)) if (viewerRole && Array.isArray(roles) && roles.length && !roles.includes(viewerRole)) flags[key] = false;
    }
  } catch { /* no entitlements yet: nothing extra is switched off */ }
  return flags;
}
// Gradual rollout: a flag may also carry pct_<flag> (0-99). The school is in the rollout when a number
// worked out from its ID, between 0 and 99, is below that percentage. The same school always gets the same answer.
const rolloutNumber = () => [...SCHOOL_ID].reduce((total, ch) => (total * 31 + ch.charCodeAt(0)) % 100, 7);
const flagOff = (flags, flag) => flags[flag] === false || (Number.isInteger(flags['pct_' + flag]) && rolloutNumber() >= flags['pct_' + flag]);
function applyFlags(flags) {
  for (const [flag, ids] of Object.entries(FLAG_MODULES)) {
    for (const id of ids) {
      const section = document.querySelector('#' + id);
      if (!section) continue;
      if (flagOff(flags, flag)) section.setAttribute('data-off', ''); else section.removeAttribute('data-off');
    }
  }
}

// Website look, admission form questions, school settings and the launch checklist.
const siteExtrasSection = document.querySelector('#siteextras');
const siteExtrasStatus = document.querySelector('#siteextras-status');
const siteExtrasForm = document.querySelector('#siteextras-form');
const siteExtrasSlots = document.querySelector('#siteextras-slots');
const prefsSection = document.querySelector('#prefs');
const prefsStatus = document.querySelector('#prefs-status');
const prefsForm = document.querySelector('#prefs-form');
const launchStatus = document.querySelector('#launch-status');
const launchList = document.querySelector('#launch-manual');
const logoStatus = document.querySelector('#logo-status');
const logoPreview = document.querySelector('#logo-preview');
let pendingLogo = '';
document.querySelector('#logo-file').addEventListener('change', async (event) => {
  pendingLogo = await shrinkImage(event.target.files[0], 200);
  logoPreview.hidden = !pendingLogo;
  if (pendingLogo) { logoPreview.src = pendingLogo; logoStatus.textContent = 'Preview shown. Click Save logo.'; }
  else if (event.target.files[0]) logoStatus.textContent = 'That picture could not be used. Try a different image.';
});
document.querySelector('#logo-save').addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy || !pendingLogo) { if (!pendingLogo) logoStatus.textContent = 'Choose a picture first.'; return; }
  const request = schoolRequest;
  tools.busy = true;
  try {
    await tools.save('settings', 'branding', { logo: pendingLogo });
    schoolLogo = pendingLogo;
    pendingLogo = '';
    if (request === schoolRequest) logoStatus.textContent = 'Logo saved. It now prints on report cards, ID cards and admit cards.';
  } catch {
    if (request === schoolRequest) logoStatus.textContent = 'Could not save the logo. Try again.';
  } finally {
    tools.busy = false;
  }
});
document.querySelector('#logo-remove').addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy || !confirm('Remove the school logo from printed documents?')) return;
  const request = schoolRequest;
  tools.busy = true;
  try {
    await tools.remove('settings', 'branding');
    schoolLogo = '';
    logoPreview.hidden = true;
    if (request === schoolRequest) logoStatus.textContent = 'Logo removed.';
  } catch {
    if (request === schoolRequest) logoStatus.textContent = 'Could not remove the logo. Try again.';
  } finally {
    tools.busy = false;
  }
});
const FIELD_TYPES = [['text', 'Short text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Choose one']];
const LAUNCH_ITEMS = ['Parents and staff have been told about the new system', 'A full data backup has been downloaded',
  'Fees and concessions have been reviewed', 'Teachers have logged in and tried marking attendance', 'The public website has been read and approved',
  'The privacy policy has been shared with parents', 'Parent logins have been created and tested', 'A date for going live has been decided'];
let launchTicks = {};
let schoolPrefs = null;
let siteExtrasCurrent = {};
const tvInfo = document.querySelector('#tv-info');
const tvUpgrade = document.querySelector('#tv-upgrade');
const tvRollback = document.querySelector('#tv-rollback');
let tvLatest = 1;

// Template versions: the platform publishes the newest page template. A school stays on its version until
// the owner upgrades, and can go back to the one before.
async function loadTemplateInfo(request) {
  const { doc, getDocFromServer } = firestoreTools;
  let notes = '';
  tvLatest = 1;
  try {
    const config = await getDocFromServer(doc(academic.schoolRef.firestore, 'platformConfig', 'templates'));
    if (config.exists()) { tvLatest = config.data().latest; notes = config.data().notes ?? ''; }
  } catch { /* No newer template has been published. */ }
  if (request !== schoolRequest) return;
  const current = siteExtrasCurrent.tv ?? 1;
  tvInfo.textContent = 'Your public page uses template version ' + current + '. The newest is version ' + tvLatest + '.'
    + (current < tvLatest && notes ? ' What is new: ' + notes : '');
  tvUpgrade.hidden = current >= tvLatest;
  tvRollback.hidden = !siteExtrasCurrent.tvPrev || siteExtrasCurrent.tvPrev === current;
}
async function setTemplate(version, previous) {
  const tools = academic;
  if (!tools || tools.busy) return;
  const request = schoolRequest;
  tools.busy = true;
  try {
    await tools.save('site', 'extras', { ...siteExtrasCurrent, tv: version, tvPrev: previous });
    tools.busy = false;
    await loadSettings(request);
    if (request === schoolRequest) siteExtrasStatus.textContent = 'Template changed to version ' + version + '.';
  } catch {
    if (request === schoolRequest) siteExtrasStatus.textContent = 'Could not change the template. Try again.';
  } finally {
    tools.busy = false;
  }
}
tvUpgrade.addEventListener('click', () => setTemplate(tvLatest, siteExtrasCurrent.tv ?? 1));
tvRollback.addEventListener('click', () => setTemplate(siteExtrasCurrent.tvPrev, siteExtrasCurrent.tv ?? 1));

for (let slot = 1; slot <= 6; slot += 1) {
  const row = document.createElement('p');
  const label = document.createElement('input');
  label.name = 'label' + slot; label.maxLength = 60; label.placeholder = 'Question ' + slot + ' (leave empty to skip)';
  const type = document.createElement('select');
  type.name = 'type' + slot;
  for (const [value, name] of FIELD_TYPES) type.append(new Option(name, value));
  const required = document.createElement('input');
  required.type = 'checkbox'; required.name = 'required' + slot;
  const options = document.createElement('input');
  options.name = 'options' + slot; options.maxLength = 150; options.placeholder = 'Choices for "Choose one", separated by ;';
  const wrap = (text, control) => { const l = document.createElement('label'); l.append(text, control); return l; };
  row.append(wrap('Question ' + slot, label), wrap('Answer type', type), wrap('Required ', required), wrap('Choices', options));
  siteExtrasSlots.append(row);
}

function parseSlot(value) {
  const [label, type, required, options] = String(value).split('|');
  return { label, type, required: required === '1', options: options ?? '' };
}

async function loadSettings(request) {
  const { doc, getDocFromServer } = firestoreTools;
  siteExtrasSection.hidden = false;
  prefsSection.hidden = false;
  const flags = await readFlags();
  if (request === schoolRequest) applyFlags(flags);
  try {
    const [extras, prefs, launch] = await Promise.all(['site/extras', 'settings/preferences', 'settings/launch'].map((path) => {
      const [collectionName, id] = path.split('/');
      return getDocFromServer(doc(academic.schoolRef, collectionName, id));
    }));
    if (request !== schoolRequest) return;
    const extra = extras.exists() ? extras.data() : {};
    siteExtrasCurrent = extra;
    await addMarketplaceThemes();
    siteExtrasForm.elements.namedItem('theme').value = extra.theme ?? 'classic';
    markTheme();
    extraLabels = [];
    for (let slot = 1; slot <= 6; slot += 1) {
      const parsed = extra['f' + slot] ? parseSlot(extra['f' + slot]) : { label: '', type: 'text', required: false, options: '' };
      siteExtrasForm.elements.namedItem('label' + slot).value = parsed.label;
      siteExtrasForm.elements.namedItem('type' + slot).value = parsed.type;
      siteExtrasForm.elements.namedItem('required' + slot).checked = parsed.required;
      siteExtrasForm.elements.namedItem('options' + slot).value = parsed.options;
      extraLabels.push(parsed.label || 'Answer ' + slot);
    }
    schoolPrefs = prefs.exists() ? prefs.data() : null;
    if (schoolPrefs) {
      for (let day = 1; day <= 7; day += 1) prefsForm.elements.namedItem('day' + day).checked = schoolPrefs.workingDays.includes(String(day));
      for (const key of ['startTime', 'endTime', 'lowAttendance']) prefsForm.elements.namedItem(key).value = schoolPrefs[key];
      prefsForm.elements.namedItem('terms').value = schoolPrefs.terms ?? '';
      document.querySelector('#cards-minpercent').value = schoolPrefs.lowAttendance;
    } else {
      for (let day = 1; day <= 6; day += 1) prefsForm.elements.namedItem('day' + day).checked = true;
    }
    launchTicks = launch.exists() ? launch.data() : {};
    renderLaunch();
    try {
      const branding = await getDocFromServer(doc(academic.schoolRef, 'settings', 'branding'));
      schoolLogo = branding.exists() ? branding.data().logo : '';
      logoPreview.hidden = !schoolLogo;
      if (schoolLogo) logoPreview.src = schoolLogo;
    } catch { schoolLogo = ''; }
    await loadTemplateInfo(request);
    try {
      const plan = await getDocFromServer(doc(academic.schoolRef, 'billing', 'main'));
      storagePlanMb = plan.exists() && plan.data().storageMb ? plan.data().storageMb : null;
      if (lists.storage.items.length || !document.querySelector('#storage').hidden) lists.storage.render();
    } catch { storagePlanMb = null; }
    if (lists.enquiries.items.length) lists.enquiries.render();
  } catch {
    if (request === schoolRequest) siteExtrasStatus.textContent = 'Could not load these settings. Try again.';
  }
}

function renderLaunch() {
  launchList.replaceChildren();
  let done = 0;
  LAUNCH_ITEMS.forEach((label, index) => {
    const key = 'm' + (index + 1);
    const ticked = launchTicks[key] === true;
    if (ticked) done += 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = ticked ? 'Untick' : 'Tick as done';
    button.addEventListener('click', async () => {
      const tools = academic;
      if (!tools || tools.busy) return;
      const request = schoolRequest;
      tools.busy = true;
      try {
        const next = { ...launchTicks, [key]: !ticked };
        await tools.save('settings', 'launch', next);
        if (request === schoolRequest) { launchTicks = next; renderLaunch(); }
      } catch {
        if (request === schoolRequest) launchStatus.textContent = 'Could not save. Try again.';
      } finally {
        tools.busy = false;
      }
    });
    listItem(launchList, (ticked ? 'DONE - ' : 'TO DO - ') + label, button);
  });
  launchStatus.textContent = done + ' of ' + LAUNCH_ITEMS.length + ' go-live steps ticked.';
}

// Theme gallery: every palette as a card with its colours. Clicking one selects it in the list and previews it here;
// nothing is published until the owner presses Save.
const THEME_CARDS = [
  ['classic', 'Classic navy and gold', '#14243d', '#faf6ec', '#b8913a'], ['royal', 'Royal purple', '#2e1a4d', '#f7f3fb', '#c29b3f'],
  ['emerald', 'Emerald green', '#0f3d2e', '#f3f8f4', '#c0a040'], ['crimson', 'Crimson red', '#5a1020', '#fbf4f2', '#c79a3a'],
  ['midnight', 'Midnight dark', '#0b1020', '#e8ecf5', '#d4af37'], ['saffron', 'Saffron', '#7a2e0e', '#fdf6ee', '#d19a2a'],
  ['ocean', 'Ocean blue', '#0b3550', '#f1f7fa', '#c9a23c'], ['slate', 'Slate grey', '#2b2f38', '#f4f5f7', '#b8913a'],
  ['teal', 'Teal', '#0d4a52', '#f1f8f8', '#d0a23c'], ['maroon', 'Maroon', '#4a0f1f', '#fbf5f4', '#c9a24a'],
  ['indigo', 'Indigo', '#1f2a6b', '#f4f5fc', '#d1a53c'], ['forest', 'Forest green', '#1f4d2b', '#f5f8f1', '#bf9b3a'],
  ['sunrise', 'Sunrise orange', '#9a3412', '#fff7ed', '#eab308'], ['rose', 'Rose', '#8a1e4a', '#fdf3f6', '#c9a24a'],
  ['charcoal', 'Charcoal', '#222222', '#f5f5f3', '#c8a24a'], ['sky', 'Sky blue', '#0f5c8a', '#f2f9fd', '#e0b43c'],
  ['obsidian', 'Obsidian and gold', '#121212', '#f3ecd6', '#d4af37'],
  ['champagne', 'Champagne', '#5b4a2e', '#fbf6ea', '#c9a86a'],
  ['sapphire', 'Royal sapphire', '#0b2a5b', '#f4f7fc', '#d4b04a'],
  ['emerald-noir', 'Emerald noir', '#06241c', '#e6f2ec', '#d1b05a'],
  ['ruby', 'Ruby velvet', '#6b0f2a', '#fbf3f5', '#e0b55a'],
  ['rose-gold', 'Rose gold', '#5a3a3f', '#fdf6f4', '#d08a93'],
  ['sandstone', 'Sandstone', '#6b4f3a', '#faf4ea', '#d9a45e'],
  ['lavender', 'Lavender mist', '#4a3f6b', '#f7f4fc', '#c3aaf0'],
  ['sage', 'Sage garden', '#3d5a47', '#f4f7f1', '#d2bc72'],
  ['blush', 'Blush peach', '#8c4a3c', '#fff5f0', '#f0b27c'],
  ['pearl', 'Ivory pearl', '#2f3a4a', '#fcfbf7', '#c4a55a'],
  ['platinum', 'Platinum', '#3a3f47', '#f6f7f8', '#b4bcc7'],
  ['copper', 'Copper bronze', '#4a2c1a', '#fbf5ee', '#d18b4c'],
  ['abyss', 'Deep ocean', '#04202f', '#e4f1f6', '#6fd0d8'],
  ['amethyst', 'Amethyst night', '#1b1033', '#ece6f7', '#cdb0ff'],
  ['bordeaux', 'Bordeaux', '#3a1020', '#fbf4f3', '#d2a56c'],
  ['olive', 'Olive and brass', '#3b4220', '#f8f7ee', '#cdb84a'],
  ['denim', 'Denim and cream', '#2c4a6e', '#faf5ea', '#d9b66a'],
  ['mocha', 'Mocha latte', '#4b3621', '#f8f1e7', '#d0a778'],
  ['aurora', 'Aurora', '#101a2e', '#e8f0ff', '#7fdcc8'],
];
const themeGallery = document.querySelector('#theme-gallery');
const themePreview = document.querySelector('#theme-preview');
const themeSelect = siteExtrasForm.elements.namedItem('theme');
function markTheme() {
  for (const card of themeGallery.children) card.setAttribute('aria-pressed', String(card.dataset.theme === themeSelect.value));
  const found = THEME_CARDS.find((card) => card[0] === themeSelect.value);
  themePreview.replaceChildren();
  if (!found) return;
  const [, label, navy, ivory, gold] = found;
  const bar = document.createElement('div');
  bar.className = 'theme-sample';
  bar.style.cssText = 'background:' + navy + ';color:' + ivory + ';border-bottom:4px solid ' + gold + ';padding:12px;border-radius:8px;margin:8px 0';
  bar.textContent = 'Preview: ' + label + ' - your school name and tagline look like this on the public page.';
  themePreview.append(bar);
}
function makeThemeCard([key, label, navy, ivory, gold]) {
  const card = document.createElement('button');
  card.type = 'button';
  card.dataset.theme = key;
  card.setAttribute('aria-pressed', 'false');
  card.setAttribute('aria-label', label);
  card.title = label;
  card.className = 'theme-card';
  card.style.cssText = 'display:inline-flex;flex-direction:column;align-items:stretch;gap:4px;margin:4px;padding:6px;min-width:96px;border:2px solid #b9ad88;border-radius:10px;background:#fff;cursor:pointer';
  const swatch = document.createElement('span');
  swatch.style.cssText = 'display:flex;height:26px;border-radius:6px;overflow:hidden';
  for (const color of [navy, ivory, gold]) {
    const part = document.createElement('span');
    part.style.cssText = 'flex:1;background:' + color;
    swatch.append(part);
  }
  const name = document.createElement('span');
  name.textContent = label;
  name.style.fontSize = '.8rem';
  card.append(swatch, name);
  card.addEventListener('click', () => { themeSelect.value = key; markTheme(); });
  themeGallery.append(card);
}
for (const entry of THEME_CARDS) makeThemeCard(entry);
// Marketplace themes (feature 068): extra palettes the platform administrator publishes. They join the gallery and the theme list.
let marketplaceLoaded = false;
async function addMarketplaceThemes() {
  if (marketplaceLoaded || !academic) return;
  try {
    const { doc, getDocFromServer } = firestoreTools;
    const found = await getDocFromServer(doc(academic.schoolRef.firestore, 'platformConfig', 'marketplace'));
    const hex = /^#[0-9a-fA-F]{6}$/;
    let premiumOk = true;
    try { const ent = await getDocFromServer(doc(academic.schoolRef, 'entitlements', 'main')); premiumOk = !(ent.exists() && (ent.data().off ?? []).includes('premium-themes')); } catch { premiumOk = true; }
    const items = (found.exists() ? found.data().items ?? [] : []).filter((item) => item && /^mk-[a-z0-9]{3,12}$/.test(item.key) && typeof item.label === 'string'
      && hex.test(item.navy) && hex.test(item.ivory) && hex.test(item.gold) && (item.premium !== true || premiumOk));
    if (!items.length) { marketplaceLoaded = true; return; }
    const group = document.createElement('optgroup');
    group.label = 'Marketplace themes';
    for (const item of items) {
      const entry = [item.key, item.label.slice(0, 40), item.navy, item.ivory, item.gold];
      THEME_CARDS.push(entry);
      group.append(new Option(entry[1], item.key));
      makeThemeCard(entry);
    }
    themeSelect.append(group);
    marketplaceLoaded = true;
  } catch { /* the fixed themes still work */ }
}
themeSelect.addEventListener('change', markTheme);
markTheme();

siteExtrasForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const data = { theme: siteExtrasForm.elements.namedItem('theme').value };
  if (siteExtrasCurrent.tv) data.tv = siteExtrasCurrent.tv;
  if (siteExtrasCurrent.tvPrev) data.tvPrev = siteExtrasCurrent.tvPrev;
  for (let slot = 1; slot <= 6; slot += 1) {
    const label = siteExtrasForm.elements.namedItem('label' + slot).value.trim().replaceAll('|', '/');
    if (!label) continue;
    const type = siteExtrasForm.elements.namedItem('type' + slot).value;
    const required = siteExtrasForm.elements.namedItem('required' + slot).checked ? '1' : '0';
    const options = siteExtrasForm.elements.namedItem('options' + slot).value.trim().replaceAll('|', '/');
    if (type === 'select' && !options) { siteExtrasStatus.textContent = 'Question ' + slot + ' needs its choices, separated by ;'; return; }
    data['f' + slot] = label + '|' + type + '|' + required + (type === 'select' ? '|' + options : '');
  }
  const request = schoolRequest;
  tools.busy = true;
  siteExtrasStatus.textContent = 'Saving.';
  try {
    await tools.save('site', 'extras', data);
    if (request === schoolRequest) siteExtrasStatus.textContent = 'Saved. The public page now uses this theme and these questions.';
  } catch {
    if (request === schoolRequest) siteExtrasStatus.textContent = 'Could not save. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
  await loadSettings(request);
});

prefsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tools = academic;
  if (!tools || tools.busy) return;
  const days = [1, 2, 3, 4, 5, 6, 7].filter((day) => prefsForm.elements.namedItem('day' + day).checked).join('');
  const data = {
    workingDays: days, startTime: prefsForm.elements.namedItem('startTime').value, endTime: prefsForm.elements.namedItem('endTime').value,
    lowAttendance: Number(prefsForm.elements.namedItem('lowAttendance').value),
  };
  const terms = prefsForm.elements.namedItem('terms').value.trim();
  if (terms) data.terms = terms;
  if (!days) { prefsStatus.textContent = 'Choose at least one working day.'; return; }
  if (data.startTime >= data.endTime) { prefsStatus.textContent = 'School must end after it starts.'; return; }
  if (!Number.isInteger(data.lowAttendance) || data.lowAttendance < 1 || data.lowAttendance > 100) { prefsStatus.textContent = 'Attendance must be a whole number from 1 to 100.'; return; }
  const request = schoolRequest;
  tools.busy = true;
  prefsStatus.textContent = 'Saving.';
  try {
    await tools.save('settings', 'preferences', data);
    if (request === schoolRequest) { schoolPrefs = data; document.querySelector('#cards-minpercent').value = data.lowAttendance; prefsStatus.textContent = 'Saved. Admit cards now use this minimum attendance by default.'; }
  } catch {
    if (request === schoolRequest) prefsStatus.textContent = 'Could not save. Check the details and try again.';
  } finally {
    tools.busy = false;
  }
});

function resetSettings() {
  for (const section of [siteExtrasSection, prefsSection]) section.hidden = true;
  siteExtrasStatus.textContent = ''; prefsStatus.textContent = ''; launchStatus.textContent = '';
  siteExtrasForm.reset(); prefsForm.reset(); launchList.replaceChildren();
  launchTicks = {}; schoolPrefs = null; extraLabels = []; siteExtrasCurrent = {}; storagePlanMb = null; tvInfo.textContent = ''; schoolLogo = ''; pendingLogo = ''; logoPreview.hidden = true; logoStatus.textContent = '';
}

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
// Reports (batch 36): financial report, class ranks, report builder, bulk report cards and payslips.
// They only read records already loaded, plus the marks of published exams. Nothing is written.
const reportsSection = document.querySelector('#reports');
const reportsStatus = document.querySelector('#reports-status');
const finBody = document.querySelector('#fin-body');
const rankBody = document.querySelector('#rank-body');
const rankToppers = document.querySelector('#rank-toppers');
let finRows = [];
let rankRows = [];

function showReportSections() {
  fillSelect(document.querySelector('#rank-class'), [...examData.classes].sort(byClassOrder), (item) => item.name);
  fillSelect(document.querySelector('#bulk-class'), [...examData.classes].sort(byClassOrder), (item) => item.name);
  fillSelect(document.querySelector('#prog-student'), [...studentRecords].sort((a, b) => a.data().name.localeCompare(b.data().name)),
    (student) => student.name + ' (' + student.admissionNo + ')');
  const source = document.querySelector('#rb-source');
  if (!source.children.length) {
    for (const key of Object.keys(REPORT_SOURCES)) source.append(new Option(REPORT_SOURCES[key].label, key));
    renderBuilderColumns();
  }
  reportsSection.hidden = false;
}

function hideReportSections() {
  reportsSection.hidden = true;
  finBody.replaceChildren();
  rankBody.replaceChildren();
  rankToppers.textContent = '';
  reportsStatus.textContent = '';
  finRows = [];
  rankRows = [];
  document.querySelector('#bulk-body').replaceChildren();
  document.querySelector('#prog-body').replaceChildren();
}

// Financial report
document.querySelector('#fin-run').addEventListener('click', () => {
  const from = document.querySelector('#fin-from').value;
  const to = document.querySelector('#fin-to').value;
  if (!/^20[0-9]{2}-[0-9]{2}$/.test(from) || !/^20[0-9]{2}-[0-9]{2}$/.test(to) || from > to) {
    reportsStatus.textContent = 'Choose a start month and an end month that is not before it.';
    return;
  }
  const months = new Map();
  const slot = (month) => {
    if (month < from || month > to) return null;
    if (!months.has(month)) months.set(month, { fees: 0, spent: 0, salary: 0 });
    return months.get(month);
  };
  for (const record of feeData.payments) {
    const p = record.data();
    if (p.voided !== true) { const row = slot(p.date.slice(0, 7)); if (row) row.fees += p.amount; }
  }
  for (const record of lists.expenses.items) { const row = expenseCounts(record.data()) ? slot(record.data().date.slice(0, 7)) : null; if (row) row.spent += record.data().amount; }
  for (const record of lists.payroll.items) {
    const p = record.data();
    if (!p.paidOn) continue;
    const row = slot(p.paidOn.slice(0, 7));
    if (row) row.salary += p.basic + p.allowances - p.deductions;
  }
  finBody.replaceChildren();
  finRows = [...months.keys()].sort().map((month) => {
    const r = months.get(month);
    return [month, r.fees, r.spent, r.salary, r.fees - r.spent - r.salary];
  });
  const totals = finRows.reduce((t, r) => t.map((value, index) => (index ? value + r[index] : value)), ['Total', 0, 0, 0, 0]);
  for (const row of [...finRows, ...(finRows.length ? [totals] : [])]) addRow(finBody, row.map((value, index) => (index ? rupees(value) : value)));
  if (finRows.length) finRows.push(totals);
  reportsStatus.textContent = finRows.length ? '' : 'There is no money activity in those months.';
});

document.querySelector('#fin-csv').addEventListener('click', () => {
  if (!finRows.length) { reportsStatus.textContent = 'Show the financial report first.'; return; }
  downloadCsv('financial-report', [['Month', 'Fees collected (Rs)', 'Expenses (Rs)', 'Salaries paid (Rs)', 'Net (Rs)'], ...finRows]);
});

// Class rank list: total of every published exam for the class in the active year.
document.querySelector('#rank-run').addEventListener('click', async () => {
  const tools = academic;
  if (!tools) return;
  const request = schoolRequest;
  const classId = document.querySelector('#rank-class').value;
  const year = examData.years.find((record) => record.data().status === 'active');
  if (!classId || !year) { reportsStatus.textContent = 'Choose a class. An academic year must be active.'; return; }
  const exams = examData.exams.filter((record) => record.data().classId === classId && record.data().yearId === year.id && record.data().published === true);
  if (!exams.length) { reportsStatus.textContent = 'This class has no published exams in the active year.'; return; }
  reportsStatus.textContent = 'Working out the ranks.';
  try {
    const results = await Promise.all(exams.map((exam) => tools.marksFor(exam.id)));
    if (request !== schoolRequest) return;
    const totals = new Map();
    exams.forEach((record, index) => {
      const exam = record.data();
      for (const mark of results[index].docs) {
        const m = mark.data();
        if (m.draft === true) continue;
        const row = totals.get(m.studentId) ?? { got: 0, max: 0, failed: 0 };
        row.got += m.score;
        row.max += exam.maxMarks;
        if (!passedExam(exam, m.score)) row.failed += 1;
        totals.set(m.studentId, row);
      }
    });
    const ranked = [...totals.entries()].map(([studentId, r]) => ({ studentId, ...r, percent: Math.round(r.got / r.max * 1000) / 10 }))
      .sort((a, b) => b.percent - a.percent || nameOfStudent(a.studentId).localeCompare(nameOfStudent(b.studentId)));
    rankBody.replaceChildren();
    rankRows = [];
    let rank = 0;
    ranked.forEach((r, index) => {
      if (index === 0 || r.percent !== ranked[index - 1].percent) rank = index + 1;
      const row = [rank, nameOfStudent(r.studentId), r.got + ' / ' + r.max, r.percent + '%', gradeFor(r.percent), resultText(r.failed)];
      rankRows.push(row);
      addRow(rankBody, row.map(String));
    });
    const toppers = rankRows.filter((row) => row[0] <= 3).map((row) => row[0] + '. ' + row[1] + ' (' + row[3] + ')');
    rankToppers.textContent = toppers.length ? 'Toppers: ' + toppers.join('; ') : '';
    reportsStatus.textContent = ranked.length ? '' : 'No marks have been entered for these exams yet.';
  } catch {
    if (request === schoolRequest) reportsStatus.textContent = 'Could not work out the ranks. Try again.';
  }
});

document.querySelector('#rank-csv').addEventListener('click', () => {
  if (!rankRows.length) { reportsStatus.textContent = 'Show the ranks first.'; return; }
  downloadCsv('class-ranks', [['Rank', 'Student', 'Total', 'Percent', 'Grade', 'Result'], ...rankRows]);
});

// Student progress: published results of one student by subject, with the change from the previous exam.
document.querySelector('#prog-run').addEventListener('click', async () => {
  const tools = academic;
  const studentId = document.querySelector('#prog-student').value;
  if (!tools || !studentId) { reportsStatus.textContent = 'Choose a student.'; return; }
  const request = schoolRequest;
  reportsStatus.textContent = 'Loading results.';
  try {
    const saved = await tools.marksOfStudent(studentId);
    if (request !== schoolRequest) return;
    const published = new Map(examData.exams.filter((record) => record.data().published === true).map((record) => [record.id, record.data()]));
    const subjectName = (id) => examData.subjects.find((record) => record.id === id)?.data().name ?? id;
    const rows = saved.docs.map((record) => record.data()).filter((mark) => published.has(mark.examId) && mark.draft !== true)
      .map((mark) => ({ exam: published.get(mark.examId), percent: Math.round(mark.score / published.get(mark.examId).maxMarks * 1000) / 10 }))
      .sort((a, b) => subjectName(a.exam.subjectId).localeCompare(subjectName(b.exam.subjectId))
        || a.exam.yearId.localeCompare(b.exam.yearId) || a.exam.examKey.localeCompare(b.exam.examKey));
    const body = document.querySelector('#prog-body');
    body.replaceChildren();
    let previous;
    for (const row of rows) {
      const same = previous && previous.exam.subjectId === row.exam.subjectId;
      const change = same ? row.percent - previous.percent : null;
      addRow(body, [subjectName(row.exam.subjectId), row.exam.yearId, row.exam.name, row.percent + '%',
        change === null ? '-' : (change > 0 ? 'Up ' : change < 0 ? 'Down ' : 'Same ') + (change === 0 ? '' : Math.abs(Math.round(change * 10) / 10) + ' points')]);
      previous = row;
    }
    reportsStatus.textContent = rows.length ? '' : 'No published results for this student yet.';
  } catch {
    if (request === schoolRequest) reportsStatus.textContent = 'Could not load the results. Try again.';
  }
});

// Report builder: pick a list and its columns, download as CSV.
const REPORT_SOURCES = {
  students: { label: 'Students', rows: () => studentRecords.map((r) => r.data()),
    dateOf: () => '',
    cols: { 'Admission no': (s) => s.admissionNo, Name: (s) => s.name, Guardian: (s) => s.guardianName, 'Guardian phone': (s) => s.guardianPhone,
      Status: (s) => s.status, 'Date of birth': (s) => s.dob ?? '', Address: (s) => s.address ?? '' } },
  payments: { label: 'Fee payments', rows: () => feeData.payments.map((r) => r.data()), dateOf: (p) => p.date,
    cols: { Receipt: (p) => p.receiptNo, Date: (p) => p.date, Student: (p) => nameOfStudent(p.studentId), Year: (p) => p.yearId,
      Method: (p) => METHOD_LABEL[p.method] ?? p.method, 'Amount (Rs)': (p) => p.amount, Status: (p) => (p.voided ? 'Voided' : 'Valid') } },
  expenses: { label: 'Expenses', rows: () => lists.expenses.items.map((r) => r.data()), dateOf: (e) => e.date,
    cols: { Date: (e) => e.date, Amount: (e) => e.amount, Category: (e) => e.category ?? '', Note: (e) => e.note ?? '' } },
  payroll: { label: 'Salary records', rows: () => lists.payroll.items.map((r) => r.data()), dateOf: (p) => p.month + '-01',
    cols: { Month: (p) => p.month, Staff: (p) => staffLabel(p.staffUid), Basic: (p) => p.basic, Allowances: (p) => p.allowances,
      Deductions: (p) => p.deductions, Net: (p) => p.basic + p.allowances - p.deductions, 'Paid on': (p) => p.paidOn ?? '' } },
};

function renderBuilderColumns() {
  const box = document.querySelector('#rb-columns');
  box.replaceChildren(box.firstElementChild);
  for (const name of Object.keys(REPORT_SOURCES[document.querySelector('#rb-source').value].cols)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.checked = true;
    label.append(input, ' ' + name + ' ');
    box.append(label);
  }
}
document.querySelector('#rb-source').addEventListener('change', renderBuilderColumns);

document.querySelector('#rb-csv').addEventListener('click', () => {
  const key = document.querySelector('#rb-source').value;
  const source = REPORT_SOURCES[key];
  const picked = [...document.querySelectorAll('#rb-columns input:checked')].map((input) => input.value);
  if (!picked.length) { reportsStatus.textContent = 'Tick at least one column.'; return; }
  const from = document.querySelector('#rb-from').value;
  const to = document.querySelector('#rb-to').value;
  const rows = source.rows().filter((row) => {
    const when = source.dateOf(row);
    return !when || ((!from || when >= from) && (!to || when <= to));
  });
  downloadCsv('report-' + key, [picked, ...rows.map((row) => picked.map((name) => source.cols[name](row)))]);
});

// Report cards for a whole class: one page per student, published exams only.
document.querySelector('#bulk-run').addEventListener('click', async () => {
  const tools = academic;
  if (!tools) return;
  const request = schoolRequest;
  const classId = document.querySelector('#bulk-class').value;
  const year = examData.years.find((record) => record.data().status === 'active');
  if (!classId || !year) { reportsStatus.textContent = 'Choose a class. An academic year must be active.'; return; }
  const ids = new Set(placementData.enrollments.filter((r) => r.data().yearId === year.id && r.data().classId === classId).map((r) => r.data().studentId));
  const exams = examData.exams.filter((record) => record.data().classId === classId && record.data().published === true);
  if (!ids.size || !exams.length) { reportsStatus.textContent = 'This class needs students and published exams first.'; return; }
  reportsStatus.textContent = 'Preparing report cards.';
  try {
    const results = await Promise.all(exams.map((exam) => tools.marksFor(exam.id)));
    if (request !== schoolRequest) return;
    const body = document.querySelector('#bulk-body');
    body.replaceChildren();
    const subjectName = (id) => examData.subjects.find((r) => r.id === id)?.data().name ?? id;
    for (const studentId of [...ids].sort((a, b) => nameOfStudent(a).localeCompare(nameOfStudent(b)))) {
      const page = document.createElement('div');
      page.className = 'page-break';
      const title = document.createElement('h4');
      title.textContent = 'Report Card - ' + nameOfStudent(studentId) + ' (' + nameOfClass(classId) + ')';
      const table = document.createElement('table');
      const head = document.createElement('tr');
      for (const label of ['Subject', 'Exam', 'Marks', 'Percent', 'Grade']) { const th = document.createElement('th'); th.textContent = label; head.append(th); }
      table.append(head);
      let got = 0;
      let max = 0;
      let failed = 0;
      exams.forEach((record, index) => {
        const exam = record.data();
        const mark = results[index].docs.map((d) => d.data()).find((m) => m.studentId === studentId && m.draft !== true);
        if (!mark) return;
        got += mark.score;
        max += exam.maxMarks;
        if (!passedExam(exam, mark.score)) failed += 1;
        const tr = document.createElement('tr');
        for (const value of [subjectName(exam.subjectId), exam.name, mark.score + ' / ' + exam.maxMarks,
          Math.round(mark.score / exam.maxMarks * 1000) / 10 + '%', gradeTextFor(exam, mark.score)]) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        table.append(tr);
      });
      const total = document.createElement('p');
      total.textContent = max ? 'Total ' + got + ' / ' + max + ' - ' + Math.round(got / max * 1000) / 10 + '% - ' + resultText(failed) : 'No published results.';
      page.append(title, table, total);
      body.append(page);
    }
    reportsStatus.textContent = '';
    const section = document.querySelector('#bulk-cards');
    section.hidden = false;
    printCard('#bulk-print-head', 'Report Cards - ' + nameOfClass(classId), () => { section.hidden = true; body.replaceChildren(); });
  } catch {
    if (request === schoolRequest) reportsStatus.textContent = 'Could not prepare the report cards. Try again.';
  }
});

// Accounts ledger (feature 149): fees received, approved expenses and salaries paid, in date order with a running balance.
const ledgerBody = document.querySelector('#ledger-body');
const ledgerStatus = document.querySelector('#ledger-status');
const ledgerSummary = document.querySelector('#ledger-summary');
let ledgerRows = [];
function buildLedger() {
  const from = document.querySelector('#ledger-from').value;
  const to = document.querySelector('#ledger-to').value;
  const opening = Number.parseInt(document.querySelector('#ledger-opening').value || '0', 10);
  const bankText = document.querySelector('#ledger-bank').value.trim();
  if (Number.isNaN(opening) || (from && !DATE_TEXT.test(from)) || (to && !DATE_TEXT.test(to)) || (from && to && from > to)) {
    ledgerStatus.textContent = 'Check the dates and the opening balance.';
    return;
  }
  const entries = [];
  for (const record of feeData.payments) {
    const p = record.data();
    if (p.voided !== true) entries.push([p.date, 'Fee received', 'Receipt ' + p.receiptNo + ' - ' + nameOfStudent(p.studentId) + ' (' + (METHOD_LABEL[p.method] ?? p.method) + ')', p.amount, 0]);
  }
  for (const record of lists.expenses.items) {
    const e = record.data();
    if (expenseCounts(e)) entries.push([e.date, 'Expense', e.category + (e.vendor ? ' - ' + e.vendor : '') + (e.note ? ' (' + e.note + ')' : ''), 0, e.amount]);
  }
  for (const record of lists.payroll.items) {
    const p = record.data();
    if (p.paidOn) entries.push([p.paidOn, 'Salary', staffLabel(p.staffUid) + ' - ' + p.month, 0, p.basic + p.allowances - p.deductions]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  // Entries before the start date change the opening balance; later ones are left out.
  let balance = opening;
  ledgerRows = [];
  ledgerBody.replaceChildren();
  let moneyIn = 0;
  let moneyOut = 0;
  for (const [date, type, details, inAmount, outAmount] of entries) {
    if (from && date < from) { balance += inAmount - outAmount; continue; }
    if (to && date > to) continue;
    balance += inAmount - outAmount;
    moneyIn += inAmount;
    moneyOut += outAmount;
    ledgerRows.push([date, type, details, inAmount || '', outAmount || '', balance]);
    addRow(ledgerBody, [date, type, details, inAmount ? rupees(inAmount) : '', outAmount ? rupees(outAmount) : '', rupees(balance)]);
  }
  let note = ledgerRows.length ? '' : 'Nothing recorded in this period. ';
  note += 'Money in ' + rupees(moneyIn) + ', money out ' + rupees(moneyOut) + ', closing balance ' + rupees(balance) + '.';
  if (bankText) {
    const bank = Number.parseInt(bankText, 10);
    if (Number.isNaN(bank)) { ledgerStatus.textContent = 'The bank balance must be a whole number.'; return; }
    note += bank === balance ? ' Matches the bank statement.' : ' Differs from the bank statement by ' + rupees(Math.abs(bank - balance)) + ' (' + (bank > balance ? 'bank is higher' : 'ledger is higher') + ').';
  }
  ledgerStatus.textContent = '';
  ledgerSummary.textContent = note;
}
document.querySelector('#ledger-run').addEventListener('click', buildLedger);
document.querySelector('#ledger-csv').addEventListener('click', () => {
  if (!ledgerRows.length) { ledgerStatus.textContent = 'Build the ledger first.'; return; }
  downloadCsv('ledger', [['Date', 'Type', 'Details', 'Money in', 'Money out', 'Balance'], ...ledgerRows]);
});
document.querySelector('#ledger').addEventListener('mod-open', () => {
  if (!document.querySelector('#ledger-from').value) document.querySelector('#ledger-from').value = localToday().slice(0, 4) + '-04-01';
});

// Staff contact details (feature 143). The owner reads them; each teacher keeps their own up to date.
const staffProfilesBody = document.querySelector('#staff-profiles-body');
const staffProfilesStatus = document.querySelector('#staff-profiles-status');
document.querySelector('#staff-profiles').addEventListener('mod-open', async () => {
  if (!academic) return;
  const request = schoolRequest;
  staffProfilesStatus.textContent = 'Loading.';
  try {
    const saved = await academic.list('staffProfiles');
    if (request !== schoolRequest) return;
    const byUid = new Map(saved.docs.map((record) => [record.id, record.data()]));
    staffProfilesBody.replaceChildren();
    for (const uid of staffRoster) {
      const item = byUid.get(uid);
      addRow(staffProfilesBody, [staffLabel(uid), item?.phone ?? '', item?.address ?? '',
        item?.emergencyName || item?.emergencyPhone ? [item.emergencyName, item.emergencyPhone].filter(Boolean).join(' - ') : '', item?.updatedOn ?? 'Not added yet']);
    }
    staffProfilesStatus.textContent = staffRoster.length ? '' : 'No teachers yet.';
  } catch {
    if (request === schoolRequest) staffProfilesStatus.textContent = 'Could not load the details. Try again.';
  }
});

// Teacher: my payslips and my own contact details.
const myPaySection = document.querySelector('#my-pay');
const myPayStatus = document.querySelector('#my-pay-status');
const myPayList = document.querySelector('#my-pay-list');
const myProfileForm = document.querySelector('#my-profile-form');
const myProfileStatus = document.querySelector('#my-profile-status');
let myPayContext; // { schoolRef, uid, name, busy }
const PHONE_TEXT = /^[0-9+() -]{0,20}$/;
async function loadMyPay(request, schoolRef, user) {
  const { collection, doc, getDocFromServer, getDocsFromServer, query, where } = firestoreTools;
  myPayContext = { schoolRef, uid: user.uid, name: user.displayName || user.email || 'Staff member', busy: false };
  myPaySection.hidden = false;
  myPayStatus.textContent = 'Loading.';
  try {
    const [pay, profile] = await Promise.all([
      getDocsFromServer(query(collection(schoolRef, 'payroll'), where('staffUid', '==', user.uid))).catch(() => null),
      getDocFromServer(doc(schoolRef, 'staffProfiles', user.uid)).catch(() => null),
    ]);
    if (request !== schoolRequest) return;
    myPayList.replaceChildren();
    for (const record of (pay?.docs ?? []).sort((a, b) => b.data().month.localeCompare(a.data().month))) {
      const item = record.data();
      const row = document.createElement('li');
      row.append(item.month + ' - net ' + rupees(item.basic + item.allowances - item.deductions) + (item.paidOn ? ' - paid ' + item.paidOn : ' - not paid yet') + ' ');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Print payslip';
      button.addEventListener('click', () => {
        const body = document.querySelector('#my-payslip-body');
        body.replaceChildren();
        for (const line of [['Staff member', myPayContext?.name ?? ''], ['Month', item.month], ['Basic pay', rupees(item.basic)], ['Allowances', rupees(item.allowances)],
          ['Deductions', rupees(item.deductions)], ['Net pay', rupees(item.basic + item.allowances - item.deductions)], ['Paid on', item.paidOn ?? 'Not paid yet']]) addRow(body, line);
        const slip = document.querySelector('#my-payslip');
        slip.hidden = false;
        printCard('#my-payslip-head', 'Payslip - ' + (myPayContext?.name ?? '') + ' - ' + item.month, () => { slip.hidden = true; body.replaceChildren(); });
      });
      row.append(button);
      myPayList.append(row);
    }
    myPayStatus.textContent = pay ? (pay.docs.length ? '' : 'No salary records yet.') : 'Could not load your salary records.';
    const data = profile?.exists() ? profile.data() : {};
    for (const name of ['phone', 'address', 'emergencyName', 'emergencyPhone']) myProfileForm.elements.namedItem(name).value = data[name] ?? '';
  } catch {
    if (request === schoolRequest) myPayStatus.textContent = 'Could not load. Try again.';
  }
}
myProfileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = myPayContext;
  if (!context || context.busy) return;
  const fields = new FormData(myProfileForm);
  if (!PHONE_TEXT.test(text(fields, 'phone')) || !PHONE_TEXT.test(text(fields, 'emergencyPhone'))) {
    myProfileStatus.textContent = 'Phone numbers can have only digits, spaces and + ( ) -, up to 20 characters.';
    return;
  }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  myProfileStatus.textContent = 'Saving.';
  try {
    await setDoc(doc(context.schoolRef, 'staffProfiles', context.uid), { ...optional(fields, 'phone', 'address', 'emergencyName', 'emergencyPhone'), updatedOn: localToday() });
    if (request === schoolRequest) myProfileStatus.textContent = 'Saved.';
  } catch {
    if (request === schoolRequest) myProfileStatus.textContent = 'That did not save. Try again.';
  } finally {
    context.busy = false;
  }
});
const resetMyPay = () => {
  myPayContext = undefined;
  myPaySection.hidden = true;
  myPayStatus.textContent = '';
  myPayList.replaceChildren();
  myProfileForm.reset();
  myProfileStatus.textContent = '';
  document.querySelector('#my-payslip').hidden = true;
  document.querySelector('#my-payslip-body').replaceChildren();
};

// Parent: consent forms (feature 151). A parent answers Yes or No for their own child; the answer can be changed while the form is open.
const portalConsentsSection = document.querySelector('#portal-consents');
const portalConsentsStatus = document.querySelector('#portal-consents-status');
const portalConsentsList = document.querySelector('#portal-consents-list');
let portalConsentBusy = false;
async function loadPortalConsents(tools, request, studentId) {
  if (portalRole === 'student') { portalConsentsSection.hidden = true; return; }
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalConsentsSection.hidden = false;
  portalConsentsStatus.textContent = 'Loading.';
  try {
    const [forms, answers] = await Promise.all([
      getDocsFromServer(collection(schoolRef, 'consentForms')),
      getDocsFromServer(query(collection(schoolRef, 'consentResponses'), where('by', '==', tools.user.uid))),
    ]);
    if (request !== schoolRequest) return;
    const mine = new Map(answers.docs.filter((record) => record.data().studentId === studentId).map((record) => [record.data().formId, record.data().decision]));
    portalConsentsList.replaceChildren();
    for (const record of forms.docs.sort((a, b) => b.id.localeCompare(a.id))) {
      const item = record.data();
      const row = document.createElement('li');
      const answer = mine.get(record.id);
      row.append(item.title + ' (' + CONSENT_KIND[item.kind] + ')' + (item.dueOn ? ' - answer by ' + item.dueOn : '') + ': ' + item.text
        + ' - ' + (answer ? 'Your answer: ' + answer.toUpperCase() : 'Not answered') + (item.status === 'closed' ? ' (form closed)' : ' '));
      if (item.status === 'open') {
        for (const [label, decision] of [['Yes', 'yes'], ['No', 'no']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.addEventListener('click', async () => {
            if (portalConsentBusy) return;
            portalConsentBusy = true;
            try {
              const { doc, setDoc, serverTimestamp } = firestoreTools;
              await setDoc(doc(schoolRef, 'consentResponses', record.id + '_' + studentId), { formId: record.id, studentId, decision, by: tools.user.uid, at: serverTimestamp() });
              portalConsentBusy = false;
              await loadPortalConsents(tools, schoolRequest, studentId);
            } catch {
              portalConsentsStatus.textContent = 'That did not save. The form may have been closed.';
            } finally {
              portalConsentBusy = false;
            }
          });
          row.append(button);
        }
      }
      portalConsentsList.append(row);
    }
    portalConsentsStatus.textContent = forms.docs.length ? '' : 'There are no consent forms.';
  } catch {
    if (request === schoolRequest) portalConsentsStatus.textContent = 'Could not load the forms. Try again.';
  }
}

// Parent and student: online tests (feature 139).
const portalTestsSection = document.querySelector('#portal-tests');
const portalTestsStatus = document.querySelector('#portal-tests-status');
const portalTestsList = document.querySelector('#portal-tests-list');
const portalTestRun = document.querySelector('#portal-test-run');
const portalTestForm = document.querySelector('#portal-test-form');
const portalTestTimer = document.querySelector('#portal-test-timer');
const portalTestSubmit = document.querySelector('#portal-test-submit');
// The test runs one question at a time. Progress (answers, place, time left, pauses used) is saved as the student goes, so a paused or
// closed test continues from the same place with the same time left. A student may pause 7 times and must answer 30% to submit early.
const OT_PAUSES = 7;
const OT_MIN_SHARE = 0.3;
const portalTestNav = document.querySelector('#portal-test-nav');
const portalTestInfo = document.querySelector('#portal-test-info');
const portalTestLive = document.querySelector('#portal-test-live');
const portalTestPaused = document.querySelector('#portal-test-paused');
const portalTestPausedText = document.querySelector('#portal-test-paused-text');
let portalTestState; // { tools, studentId, test, questions, answers, index, remaining, deadline, paused, pauses, timer, busy, queue, saveFailed }
const clock = (seconds) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
const testLeft = (state) => (state.paused ? state.remaining : Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)));
const testAnswered = (state) => state.answers.filter((answer) => answer !== 'x').length;
const testNeeded = (state) => Math.ceil(state.questions.length * OT_MIN_SHARE);
const stopPortalTest = () => {
  if (portalTestState?.timer) clearInterval(portalTestState.timer);
  portalTestState = undefined;
  portalTestRun.hidden = true;
  portalTestForm.replaceChildren();
  portalTestNav.replaceChildren();
  portalTestTimer.textContent = '';
  portalTestInfo.textContent = '';
  portalTestLive.hidden = false;
  portalTestPaused.hidden = true;
};
// Writes happen one after another so the saved time left never goes up.
function saveTestProgress(state) {
  const { doc, setDoc, serverTimestamp } = firestoreTools;
  const data = { testId: state.test.id, studentId: state.studentId, by: state.tools.user.uid, answers: state.answers.join(','), index: state.index,
    remainingSec: testLeft(state), pauses: state.pauses, state: state.paused ? 'paused' : 'running', at: serverTimestamp() };
  state.queue = state.queue.then(() => setDoc(doc(state.tools.schoolRef, 'onlineProgress', state.test.id + '_' + state.studentId), data))
    .then(() => { state.saveFailed = false; }, () => { state.saveFailed = true; });
  return state.queue;
}
function renderTestQuestion() {
  const state = portalTestState;
  if (!state) return;
  const total = state.questions.length;
  const question = state.questions[state.index];
  portalTestForm.replaceChildren();
  const box = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Question ' + (state.index + 1) + ' of ' + total + ' (' + question.m + ' mark' + (question.m > 1 ? 's' : '') + ')';
  const words = document.createElement('p');
  words.textContent = question.q;
  box.append(legend, words);
  question.o.forEach((option, number) => {
    const label = document.createElement('label');
    label.className = 'otopt';
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'answer'; radio.value = String(number);
    radio.checked = state.answers[state.index] === String(number);
    label.append(radio, ' ' + option);
    box.append(label);
  });
  portalTestForm.append(box);
  portalTestNav.replaceChildren();
  state.questions.forEach((_, number) => {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.textContent = String(number + 1);
    jump.className = 'qn' + (state.answers[number] !== 'x' ? ' done' : '') + (number === state.index ? ' now' : '');
    jump.setAttribute('aria-label', 'Question ' + (number + 1) + (state.answers[number] !== 'x' ? ', answered' : ', not answered'));
    jump.addEventListener('click', () => { state.index = number; renderTestQuestion(); });
    portalTestNav.append(jump);
  });
  document.querySelector('#portal-test-prev').disabled = state.index === 0;
  document.querySelector('#portal-test-save').textContent = state.index === total - 1 ? 'Save answer' : 'Save and next';
  const left = OT_PAUSES - state.pauses;
  const pause = document.querySelector('#portal-test-pause');
  pause.disabled = left <= 0;
  pause.textContent = 'Pause exam (' + left + ' left)';
  portalTestInfo.textContent = testAnswered(state) + ' of ' + total + ' answered. You must answer at least ' + testNeeded(state) + ' to submit before the time ends.';
}
function nextTestQuestion() {
  const state = portalTestState;
  if (state.index < state.questions.length - 1) { state.index += 1; return true; }
  const open = state.answers.indexOf('x');
  if (open >= 0) { state.index = open; return true; }
  return false;
}
function tickPortalTest(request) {
  const state = portalTestState;
  if (!state || state.paused) return;
  const left = testLeft(state);
  portalTestTimer.textContent = 'Time left: ' + clock(left);
  if (left === 0) submitPortalTest(request, true);
}
function runPortalTest(request) {
  const state = portalTestState;
  document.querySelector('#portal-test-title').textContent = state.test.data.title + ' - ' + state.test.data.totalMarks + ' marks';
  portalTestRun.hidden = false;
  if (state.paused) { showPausedTest(); return; }
  portalTestLive.hidden = false;
  portalTestPaused.hidden = true;
  renderTestQuestion();
  tickPortalTest(request);
  state.timer = setInterval(() => tickPortalTest(request), 1000);
}
function showPausedTest() {
  const state = portalTestState;
  clearInterval(state.timer);
  portalTestLive.hidden = true;
  portalTestPaused.hidden = false;
  portalTestTimer.textContent = 'Paused. Time left: ' + clock(state.remaining);
  portalTestPausedText.textContent = 'Your exam is paused and the timer is stopped at ' + clock(state.remaining) + '. Pauses used: ' + state.pauses + ' of ' + OT_PAUSES + '. Press Resume to carry on from the same question.';
}
async function pausePortalTest() {
  const state = portalTestState;
  if (!state || state.paused || state.busy || state.pauses >= OT_PAUSES) return;
  const before = { remaining: testLeft(state), deadline: state.deadline };
  state.remaining = before.remaining;
  state.paused = true;
  state.pauses += 1;
  state.busy = true;
  await saveTestProgress(state);
  state.busy = false;
  if (state.saveFailed) {
    state.paused = false; state.pauses -= 1; state.deadline = before.deadline;
    portalTestInfo.textContent = 'The pause could not be saved. Check your connection and try again. Your timer is still running.';
    return;
  }
  showPausedTest();
}
async function resumePortalTest() {
  const state = portalTestState;
  if (!state || !state.paused || state.busy) return;
  state.paused = false;
  state.deadline = Date.now() + state.remaining * 1000;
  state.busy = true;
  await saveTestProgress(state);
  state.busy = false;
  if (state.saveFailed) {
    state.paused = true;
    portalTestPausedText.textContent = 'Could not resume. Check your connection and press Resume again.';
    return;
  }
  runPortalTest(schoolRequest);
}
async function submitPortalTest(request, forced) {
  const state = portalTestState;
  if (!state || state.busy) return;
  if (!forced) {
    if (state.paused) return;
    if (testAnswered(state) < testNeeded(state)) {
      portalTestInfo.textContent = 'Answer at least ' + testNeeded(state) + ' of the ' + state.questions.length + ' questions before you submit. You have answered ' + testAnswered(state) + '.';
      return;
    }
    if (!confirm('Submit your exam now? You have answered ' + testAnswered(state) + ' of ' + state.questions.length + ' questions. You cannot change anything after this.')) return;
  }
  state.busy = true;
  clearInterval(state.timer);
  const answers = state.answers.join(',');
  try {
    const { doc, setDoc, serverTimestamp } = firestoreTools;
    await setDoc(doc(state.tools.schoolRef, 'onlineAttempts', state.test.id + '_' + state.studentId),
      { testId: state.test.id, studentId: state.studentId, answers, by: state.tools.user.uid, at: serverTimestamp() });
    const { tools, studentId } = state;
    stopPortalTest();
    if (request === schoolRequest) { portalTestsStatus.textContent = 'Your answers are submitted.'; await loadPortalTests(tools, schoolRequest, studentId); }
  } catch {
    state.busy = false;
    if (!forced) state.timer = setInterval(() => tickPortalTest(request), 1000);
    if (request === schoolRequest) portalTestInfo.textContent = 'Your answers could not be submitted. The test may have been closed, or you may have already submitted.';
  }
}
// A new start saves the first progress record straight away; resuming carries on from the saved one.
async function startPortalTest(tools, studentId, test, saved) {
  let questions;
  try { questions = JSON.parse(test.data.paper); } catch { portalTestsStatus.textContent = 'This test could not be opened.'; return; }
  stopPortalTest();
  const request = schoolRequest;
  const state = { tools, studentId, test, questions, answers: questions.map(() => 'x'), index: 0, remaining: test.data.durationMin * 60, deadline: 0, paused: false, pauses: 0,
    timer: 0, busy: false, queue: Promise.resolve(), saveFailed: false };
  if (saved) {
    const answers = String(saved.answers).split(',');
    if (answers.length === questions.length) state.answers = answers;
    state.index = Math.min(Math.max(0, Number(saved.index) || 0), questions.length - 1);
    state.pauses = Number(saved.pauses) || 0;
    state.remaining = Number(saved.remainingSec) || 0;
    if (saved.state === 'paused') state.paused = true;
    else {
      // Closing the page does not stop the clock, so the time spent away is taken off.
      const savedAt = saved.at?.toMillis?.() ?? Date.now();
      state.remaining = Math.max(0, state.remaining - Math.floor((Date.now() - savedAt) / 1000));
    }
  }
  state.deadline = Date.now() + state.remaining * 1000;
  portalTestState = state;
  if (!saved) {
    portalTestsStatus.textContent = 'Starting the test.';
    await saveTestProgress(state);
    if (portalTestState !== state) return;
    if (state.saveFailed) { stopPortalTest(); portalTestsStatus.textContent = 'The test could not be started. Check your connection and try again.'; return; }
    portalTestsStatus.textContent = '';
  }
  runPortalTest(request);
}
portalTestSubmit.addEventListener('click', () => submitPortalTest(schoolRequest, false));
document.querySelector('#portal-test-pause').addEventListener('click', pausePortalTest);
document.querySelector('#portal-test-resume').addEventListener('click', resumePortalTest);
document.querySelector('#portal-test-prev').addEventListener('click', () => {
  const state = portalTestState;
  if (!state || state.index === 0) return;
  state.index -= 1;
  renderTestQuestion();
});
document.querySelector('#portal-test-save').addEventListener('click', () => {
  const state = portalTestState;
  if (!state || state.paused) return;
  const chosen = portalTestForm.querySelector('input[name="answer"]:checked');
  if (!chosen) { portalTestInfo.textContent = 'Choose an answer, or press Skip to leave this question for later.'; return; }
  state.answers[state.index] = chosen.value;
  const moved = nextTestQuestion();
  saveTestProgress(state);
  renderTestQuestion();
  if (!moved) portalTestInfo.textContent = 'All questions are answered. Press Submit exam when you are ready.';
});
document.querySelector('#portal-test-skip').addEventListener('click', () => {
  const state = portalTestState;
  if (!state || state.paused) return;
  const moved = nextTestQuestion();
  saveTestProgress(state);
  renderTestQuestion();
  if (!moved) portalTestInfo.textContent = 'You are on the last question. Use the numbers above to go back to any question, or press Submit exam.';
});
portalTestForm.addEventListener('submit', (event) => event.preventDefault());
async function loadPortalTests(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalTestsSection.hidden = false;
  portalTestsStatus.textContent = 'Loading.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const [open, closed, sheets, progress] = await Promise.all([
      getDocsFromServer(query(collection(schoolRef, 'onlineTests'), where('status', '==', 'open'))),
      getDocsFromServer(query(collection(schoolRef, 'onlineTests'), where('status', '==', 'closed'))),
      getDocsFromServer(query(collection(schoolRef, 'onlineAttempts'), where('by', '==', tools.user.uid))),
      getDocsFromServer(query(collection(schoolRef, 'onlineProgress'), where('by', '==', tools.user.uid))).catch(() => ({ docs: [] })),
    ]);
    const started = new Map(progress.docs.filter((record) => record.data().studentId === studentId).map((record) => [record.data().testId, record.data()]));
    if (request !== schoolRequest) return;
    const mine = new Map(sheets.docs.filter((record) => record.data().studentId === studentId).map((record) => [record.data().testId, record.data()]));
    const tests = [...open.docs, ...closed.docs].filter((record) => latest && record.data().classId === latest.classId)
      .filter((record) => record.data().status === 'open' || mine.has(record.id)).sort((a, b) => b.id.localeCompare(a.id));
    portalTestsList.replaceChildren();
    for (const record of tests) {
      const item = record.data();
      const sheet = mine.get(record.id);
      let button;
      let state;
      if (sheet) state = sheet.score !== undefined ? 'Your score: ' + sheet.score + ' of ' + item.totalMarks : 'Submitted. The score will appear after your teacher checks it.';
      else if (started.has(record.id)) {
        const saved = started.get(record.id);
        const left = saved.state === 'paused' ? saved.remainingSec : Math.max(0, saved.remainingSec - Math.floor((Date.now() - (saved.at?.toMillis?.() ?? Date.now())) / 1000));
        state = (saved.state === 'paused' ? 'Paused' : 'In progress') + ', ' + clock(left) + ' left, ' + saved.pauses + ' of ' + OT_PAUSES + ' pauses used';
        button = actionButton(saved.state === 'paused' ? 'Resume test' : 'Continue test', () => startPortalTest(tools, studentId, { id: record.id, data: item }, saved));
      } else { state = 'Not attempted'; button = actionButton('Start test (' + item.durationMin + ' min)', () => {
        if (confirm('Start "' + item.title + '"? The timer starts now. You answer one question at a time, can pause up to ' + OT_PAUSES + ' times, and must answer at least 30% of the questions to submit early.')) startPortalTest(tools, studentId, { id: record.id, data: item });
      }); }
      listItem(portalTestsList, item.title + ' - ' + item.count + ' question(s), ' + item.totalMarks + ' marks - ' + state, button);
    }
    portalTestsStatus.textContent = tests.length ? '' : 'There are no online tests for your class right now.';
  } catch {
    if (request === schoolRequest) portalTestsStatus.textContent = 'Could not load the tests. Try again.';
  }
}

// Parent: people allowed to pick up the child (feature 146).
const portalPickupSection = document.querySelector('#portal-pickup');
const portalPickupStatus = document.querySelector('#portal-pickup-status');
const portalPickupList = document.querySelector('#portal-pickup-list');
const portalPickupForm = document.querySelector('#portal-pickup-form');
const portalPickupQr = document.querySelector('#portal-pickup-qr');
let portalPickup; // { tools, studentId, busy }
async function loadPortalPickup(tools, request, studentId) {
  if (portalRole === 'student') { portalPickupSection.hidden = true; return; }
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalPickup = { tools, studentId, busy: false };
  portalPickupSection.hidden = false;
  portalPickupStatus.textContent = 'Loading.';
  try {
    const saved = await getDocsFromServer(query(collection(schoolRef, 'pickupPeople'), where('createdBy', '==', tools.user.uid)));
    if (request !== schoolRequest) return;
    portalPickupList.replaceChildren();
    const mine = saved.docs.filter((record) => record.data().studentId === studentId).sort((a, b) => a.data().name.localeCompare(b.data().name));
    for (const record of mine) {
      const item = record.data();
      const row = document.createElement('li');
      row.append(item.name + ' (' + item.relation + ')' + (item.phone ? ' - ' + item.phone : '') + ' - code ' + item.code + (item.active ? '' : ' - SWITCHED OFF') + ' ');
      row.append(actionButton('Show QR', async () => {
        const { drawQr } = await import('./qr.mjs?v=batch-64');
        portalPickupQr.hidden = false;
        drawQr(portalPickupQr, 'PICK:' + item.code, 200);
        portalPickupStatus.textContent = 'QR code for ' + item.name + '. Show it at the gate.';
      }));
      row.append(actionButton(item.active ? 'Switch off' : 'Switch on', async () => {
        const { doc, setDoc } = firestoreTools;
        try { await setDoc(doc(schoolRef, 'pickupPeople', record.id), { ...item, active: !item.active }); await loadPortalPickup(tools, schoolRequest, studentId); }
        catch { portalPickupStatus.textContent = 'That did not save. Try again.'; }
      }));
      row.append(actionButton('Remove', async () => {
        if (!confirm('Remove ' + item.name + '?')) return;
        const { doc, deleteDoc } = firestoreTools;
        try { await deleteDoc(doc(schoolRef, 'pickupPeople', record.id)); portalPickupQr.hidden = true; await loadPortalPickup(tools, schoolRequest, studentId); }
        catch { portalPickupStatus.textContent = 'That did not remove. Try again.'; }
      }));
      portalPickupList.append(row);
    }
    portalPickupStatus.textContent = mine.length ? '' : 'No one is added yet.';
  } catch {
    if (request === schoolRequest) portalPickupStatus.textContent = 'Could not load. Try again.';
  }
}
portalPickupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = portalPickup;
  if (!context || context.busy) return;
  const fields = new FormData(portalPickupForm);
  const phone = text(fields, 'phone');
  if (!text(fields, 'name') || !text(fields, 'relation')) { portalPickupStatus.textContent = 'Enter the name and the relation.'; return; }
  if (phone && !/^[0-9+() -]{1,20}$/.test(phone)) { portalPickupStatus.textContent = 'The phone number can have only digits, spaces and + ( ) -.'; return; }
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  try {
    await setDoc(doc(context.tools.schoolRef, 'pickupPeople', newId('PK')), { studentId: context.studentId, name: text(fields, 'name'), relation: text(fields, 'relation'),
      ...(phone ? { phone } : {}), code: newPickupCode(), active: true, createdBy: context.tools.user.uid });
    portalPickupForm.reset();
    context.busy = false;
    await loadPortalPickup(context.tools, request, context.studentId);
  } catch {
    if (request === schoolRequest) portalPickupStatus.textContent = 'That did not save. Try again.';
  } finally {
    context.busy = false;
  }
});

// Payslip for one salary record.
function printPayslip(item) {
  const body = document.querySelector('#payslip-body');
  body.replaceChildren();
  for (const row of [['Staff member', staffLabel(item.staffUid)], ['Month', item.month], ['Basic pay', rupees(item.basic)],
    ['Allowances', rupees(item.allowances)], ['Deductions', rupees(item.deductions)],
    ['Net pay', rupees(item.basic + item.allowances - item.deductions)], ['Paid on', item.paidOn ?? 'Not paid yet']]) addRow(body, row);
  const section = document.querySelector('#payslip');
  section.hidden = false;
  printCard('#payslip-print-head', 'Payslip - ' + staffLabel(item.staffUid) + ' - ' + item.month, () => { section.hidden = true; body.replaceChildren(); });
}

// Principal access switches: the owner decides whether the principal login may open payroll, fees and admissions.
const principalAccessSection = document.querySelector('#principal-access');
const principalAccessForm = document.querySelector('#principal-access-form');
const principalAccessStatus = document.querySelector('#principal-access-status');
const PRINCIPAL_DEFAULTS = { payroll: false, fees: true, admissions: true };
let principalAccess = { ...PRINCIPAL_DEFAULTS };
function drawPrincipalAccess() {
  for (const key of Object.keys(PRINCIPAL_DEFAULTS)) principalAccessForm.elements.namedItem(key).checked = principalAccess[key] === true;
}
async function loadPrincipalAccess(request) {
  principalAccessSection.hidden = viewOnly || document.body.dataset.role === 'accountant';
  if (principalAccessSection.hidden) return;
  try {
    const { doc, getDocFromServer } = firestoreTools;
    const found = await getDocFromServer(doc(academic.schoolRef, 'settings', 'principalAccess'));
    if (request !== schoolRequest) return;
    principalAccess = found.exists() ? { ...PRINCIPAL_DEFAULTS, ...found.data() } : { ...PRINCIPAL_DEFAULTS };
    drawPrincipalAccess();
    principalAccessStatus.textContent = '';
    refreshAttention();
  } catch {
    if (request === schoolRequest) principalAccessStatus.textContent = 'Could not load the principal access settings. Refresh to try again.';
  }
}
principalAccessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!academic || academic.busy || viewOnly) return;
  const next = Object.fromEntries(Object.keys(PRINCIPAL_DEFAULTS).map((key) => [key, principalAccessForm.elements.namedItem(key).checked]));
  academic.busy = true;
  try {
    await academic.save('settings', 'principalAccess', next);
    principalAccess = next;
    principalAccessStatus.textContent = 'Saved. The principal sees the change the next time they open the app.';
    refreshAttention();
  } catch {
    principalAccessStatus.textContent = 'That did not save. Try again.';
  } finally {
    academic.busy = false;
  }
});

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
      + ' - due ' + rupees(row.due) + (row.concession ? ' (after concession ' + rupees(row.concession) + ')' : '') + ', paid ' + rupees(row.paid) + ', balance ' + rupees(row.balance) + (row.overdue ? ', overdue ' + rupees(row.overdue) : '')
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
  downloadCsv('fee-dues', [['Admission no', 'Name', 'Class', 'Guardian', 'Guardian phone', 'Due (Rs)', 'Concession (Rs)', 'Paid (Rs)', 'Balance (Rs)', 'Overdue (Rs)'],
    ...defaultersRows.map((row) => [row.student.admissionNo, row.student.name, nameOfClass(row.classId), row.student.guardianName,
      row.student.guardianPhone, row.due, row.concession, row.paid, row.balance, row.overdue])]);
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

const BACKUP_COLLECTIONS = ['studentHistory', 'storageRecords', 'staffDocuments', 'eBooks', 'noticeAcks', 'members', 'students', 'academicYears', 'classes', 'sections', 'subjects', 'classSubjects', 'enrollments',
  'rollKeys', 'exams', 'marks', 'attendance', 'staffAttendance', 'leaveRequests', 'feeStructures', 'payments', 'notices',
  'timetable', 'homework', 'calendar', 'books', 'loans', 'behaviour', 'visitors', 'substitutions', 'routes', 'transportRiders',
  'activities', 'activityMembers', 'inventory', 'alumni', 'expenses', 'certificates', 'tickets', 'staffDirectory', 'vendors', 'minutes', 'lostFound', 'concessions', 'achievements', 'complaints', 'assets', 'sales', 'syllabus', 'trainings', 'diary', 'healthRecords', 'lessonPlans', 'ptmSlots', 'payroll', 'messages',
  'enquiries', 'eventRegistrations', 'familyAccess', 'classTeachers', 'auditLog', 'scholarships', 'scholarshipApps', 'consentForms', 'consentResponses', 'staffProfiles',
  'hostelRooms', 'hostelStays', 'canteenMenu', 'canteenPlans', 'bookReservations', 'workflowRules', 'approvalRequests', 'questionBank', 'onlineTests', 'onlineTestKeys', 'onlineAttempts', 'pickupPeople', 'pickupLogs', 'feeReminders'];

// School data pack: every list as a CSV file inside one ZIP (stored, not compressed) built here in the browser.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true); entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry.buffer, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
const plainValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return typeof value.toDate === 'function' ? value.toDate().toISOString() : JSON.stringify(value);
  return String(value);
};

// Restore from a nightly backup (feature 086). The work is done by server functions that only the school owner can call.
const restoreStatus = document.querySelector('#restore-status');
const restoreDate = document.querySelector('#restore-date');
const restoreFieldset = document.querySelector('#restore-lists');
const restoreListEl = document.querySelector('#restore-list');
const RESTORE_NAMES = { students: 'Students', payments: 'Fee payments', feeStructures: 'Fee structures', attendance: 'Student attendance', marks: 'Marks', exams: 'Exams',
  classes: 'Classes', sections: 'Sections', subjects: 'Subjects', enrollments: 'Class placements', staffProfiles: 'Staff profiles', staffDirectory: 'Staff contact directory',
  staffDocuments: 'Staff vault records', books: 'Library books', loans: 'Library loans', notices: 'Notices', homework: 'Homework', timetable: 'Timetable', payroll: 'Payroll',
  expenses: 'Expenses', onlineTests: 'Online tests', questionBank: 'Question bank', storageRecords: 'Storage records', inventory: 'Inventory', routes: 'Routes',
  hostelRooms: 'Hostel rooms', hostelStays: 'Hostel stays', canteenMenu: 'Canteen menu', canteenPlans: 'Canteen plans', bookReservations: 'Book reservations',
  workflowRules: 'Approval rules', onlineTestKeys: 'Online test answer keys', onlineAttempts: 'Online test attempts', pickupPeople: 'Pickup people', pickupLogs: 'Pickup log',
  studentHistory: 'Student history', rollKeys: 'Roll numbers', staffAttendance: 'Staff attendance', leaveRequests: 'Leave requests', calendar: 'School calendar',
  behaviour: 'Behaviour notes', visitors: 'Visitors', substitutions: 'Substitutions', transportRiders: 'Transport riders', activities: 'Activities', activityMembers: 'Activity members',
  alumni: 'Alumni', certificates: 'Certificates', tickets: 'Maintenance tickets', vendors: 'Vendors', minutes: 'Meeting minutes', lostFound: 'Lost and found',
  concessions: 'Fee concessions', achievements: 'Achievements', complaints: 'Complaints', assets: 'Assets', sales: 'Sales', syllabus: 'Syllabus', trainings: 'Staff training',
  diary: 'Diary', healthRecords: 'Health records', lessonPlans: 'Lesson plans', ptmSlots: 'PTM slots', messages: 'Messages', enquiries: 'Admission enquiries',
  eventRegistrations: 'Event registrations', classTeachers: 'Class teachers', scholarships: 'Scholarships', scholarshipApps: 'Scholarship applications',
  consentForms: 'Consent forms', consentResponses: 'Consent responses', classSubjects: 'Class subjects', academicYears: 'Academic years' };
async function restoreCall(name, data) {
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
  const result = await httpsCallable(getFunctions(app, 'asia-south1'), name)({ schoolId: SCHOOL_ID, ...data });
  return result.data;
}
const restoreError = (error) => (error?.code === 'functions/permission-denied' ? 'Only the school owner can restore.'
  : error?.code === 'functions/not-found' ? 'That backup file was not found, or the restore function is not switched on yet.'
  : error?.code === 'functions/failed-precondition' ? (error.message || 'This school is read-only.')
  : 'Could not reach the restore service. Check your connection, and that the functions are deployed, then try again.');
document.querySelector('#restore-load').addEventListener('click', async () => {
  restoreStatus.textContent = 'Looking for backups.';
  restoreFieldset.hidden = true;
  try {
    const { backups } = await restoreCall('listBackups', {});
    restoreDate.replaceChildren(...backups.map((item) => new Option(item.date.startsWith('pre-restore') ? 'Safety copy ' + item.date.slice(12) : item.date, item.date)));
    restoreStatus.textContent = backups.length ? backups.length + ' backup(s) found. Pick one and check what would change.' : 'No backups yet. The first one is made at 2:30 am.';
  } catch (error) { restoreStatus.textContent = restoreError(error); }
});
document.querySelector('#restore-check').addEventListener('click', async () => {
  if (!restoreDate.value) { restoreStatus.textContent = 'Click Find backups and pick one first.'; return; }
  restoreStatus.textContent = 'Comparing. This can take a minute.';
  restoreFieldset.hidden = true;
  try {
    const result = await restoreCall('previewRestore', { date: restoreDate.value });
    restoreListEl.replaceChildren();
    for (const item of result.lists) {
      const line = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = item.name;
      box.checked = item.missing > 0;
      const label = document.createElement('label');
      label.append(box, ' ' + (RESTORE_NAMES[item.name] ?? item.name) + ': ' + item.missing + ' gone, ' + item.changed + ' changed since the backup, ' + item.extra + ' added since (backup had ' + item.inBackup + ', now ' + item.now + ')');
      line.append(label);
      restoreListEl.append(line);
    }
    restoreFieldset.hidden = !result.lists.length;
    restoreStatus.textContent = result.lists.length ? 'Backup of ' + result.date + ': tick the lists to restore.' : 'Nothing differs from this backup. There is nothing to restore.';
  } catch (error) { restoreStatus.textContent = restoreError(error); }
});
document.querySelector('#restore-run').addEventListener('click', async () => {
  const chosen = [...restoreListEl.querySelectorAll('input:checked')].map((box) => box.value);
  if (!chosen.length) { restoreStatus.textContent = 'Tick at least one list.'; return; }
  const mode = document.querySelector('input[name="restoremode"]:checked').value;
  if (!window.confirm('Restore ' + chosen.length + ' list(s) from the backup of ' + restoreDate.value + (mode === 'overwrite' ? ', putting back saved versions of changed records too' : ', adding back only records that are gone')
    + '? Nothing will be deleted, and a safety copy is saved first.')) return;
  restoreStatus.textContent = 'Restoring. Do not close this page.';
  try {
    const result = await restoreCall('restoreBackup', { date: restoreDate.value, lists: chosen, mode });
    restoreStatus.textContent = 'Done: ' + result.restored + ' record(s) put back. Safety copy: ' + result.safetyCopy + '. Reload the page to see the restored records.';
    restoreFieldset.hidden = true;
    document.dispatchEvent(new Event('usage-changed'));
  } catch (error) { restoreStatus.textContent = restoreError(error); }
});
document.querySelector('#backup-zip').addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy) return;
  if (!confirm('Download a data pack that contains private records? Keep the file safe.')) return;
  const request = schoolRequest;
  const button = document.querySelector('#backup-zip');
  tools.busy = true;
  button.disabled = true;
  const files = [];
  const notRead = [];
  try {
    let done = 0;
    for (let start = 0; start < BACKUP_COLLECTIONS.length; start += 5) {
      const group = BACKUP_COLLECTIONS.slice(start, start + 5);
      const results = await Promise.allSettled(group.map((name) => tools.list(name)));
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') { notRead.push(group[index]); return; }
        const docs = result.value.docs;
        const columns = [...new Set(docs.flatMap((record) => Object.keys(record.data())))].sort();
        files.push([group[index] + '.csv', '﻿' + [['id', ...columns], ...docs.map((record) => [record.id, ...columns.map((key) => plainValue(record.data()[key]))])]
          .map((row) => row.map(csvCell).join(',')).join('\r\n')]);
      });
      done += group.length;
      if (request === schoolRequest) backupStatus.textContent = 'Reading ' + done + ' of ' + BACKUP_COLLECTIONS.length + '.';
    }
    files.unshift(['README.txt', 'AZIZ school data pack for ' + SCHOOL_ID + ', made on ' + new Date().toISOString() + '.\r\nOne CSV file per list. The first column is the record id. Open with Excel or Google Sheets.\r\n'
      + (notRead.length ? 'Could not be read: ' + notRead.join(', ') + '.\r\n' : '')]);
    const url = URL.createObjectURL(buildZip(files));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'school-data-pack-' + localToday() + '.zip';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await tools.log('bulk', 'backup', 'data pack', files.length - 1 + ' files');
    noteBackup('zip');
    if (request === schoolRequest) backupStatus.textContent = 'Data pack downloaded (' + (files.length - 1) + ' files).' + (notRead.length ? ' Could not read: ' + notRead.join(', ') + '.' : '');
  } catch {
    if (request === schoolRequest) backupStatus.textContent = 'The data pack did not finish. Try again.';
  } finally {
    tools.busy = false;
    button.disabled = false;
  }
});

backupRun.addEventListener('click', async () => {
  const tools = academic;
  if (!tools || tools.busy) return;
  if (!confirm('Download a backup that contains private records? Keep the file safe.')) return;
  const request = schoolRequest;
  tools.busy = true;
  backupRun.disabled = true;
  const backup = { school: SCHOOL_ID, takenAt: new Date().toISOString(), collections: {}, notRead: [] };
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
      noteBackup('full');
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
  loadPrincipalAccess(schoolRequest);
}
const resetInsights = () => {
  principalAccess = { ...PRINCIPAL_DEFAULTS };
  for (const section of [checklistSection, defaultersSection, workloadSection, backupSection, principalAccessSection]) section.hidden = true;
  for (const list of [checklistList, defaultersList, workloadList]) list.replaceChildren();
  ebookItems = []; vaultItems = []; vaultLoaded = false; vaultSection.hidden = true; ebooksSection.hidden = true; qrcardsSection.hidden = true; vaultList.replaceChildren(); vaultStatus.textContent = ''; vaultAlert.textContent = '';
  for (const status of [checklistStatus, defaultersStatus, workloadStatus, backupStatus]) status.textContent = '';
  defaultersRows = [];
};

async function loadOwnerLists(request) {
  const names = ['routes', 'riders', 'activities', 'members', 'substitutions', 'inventory', 'alumni', 'expenses', 'certificates', 'tickets', 'staffdir', 'vendors', 'minutes', 'lostfound', 'concessions', 'achievements', 'complaints', 'assets', 'sales', 'syllabus', 'trainings', 'diary', 'health', 'lessons', 'ptm', 'payroll', 'inbox', 'enquiries', 'eventregs', 'storage', 'vehicles', 'appraisals', 'scholarships', 'scholarshipapps', 'consents',
    'hostelrooms', 'hostelstays', 'canteenmenu', 'canteenplans', 'bookreservations', 'workflowrules', 'questionbank', 'onlinetests', 'pickuppeople'];
  // These lists feed no other screen, so they are read only when the owner opens them. The rest are needed at once by the
  // Needs Attention list, fee balances, finance summaries and the staff and activity screens.
  const lazyNames = new Set(['substitutions', 'alumni', 'certificates', 'vendors', 'minutes', 'achievements', 'assets', 'sales', 'trainings',
    'diary', 'health', 'lessons', 'ptm', 'eventregs', 'appraisals', 'scholarships', 'scholarshipapps', 'consents',
    'hostelstays', 'canteenmenu', 'canteenplans', 'bookreservations', 'questionbank', 'onlinetests', 'pickuppeople']);
  vaultSection.hidden = false;
  ebooksSection.hidden = false;
  qrcardsSection.hidden = false;
  for (const name of names) {
    if (!lazyNames.has(name)) continue;
    lists[name].lazy = true;
    lists[name].loaded = false;
    document.querySelector('#' + lists[name].cfg.id).hidden = false;
  }
  await Promise.allSettled([...names.filter((name) => !lazyNames.has(name)).map((name) => lists[name].load(request)), loadBackupLog(), vaultLoad(), ebooksLoad()]);
  if (request === schoolRequest) { refreshAttention(); showReportSections(); }
}
const refreshOwnerLists = () => { for (const api of ownerLists) if (!document.querySelector('#' + api.cfg.id).hidden) api.draw(); };
const resetOwnerLists = () => {
  hideReportSections();
  backupLog = null;
  auditItems = [];
  alertItems = [];
  approvalItems = []; approvalsSection.hidden = true;
  for (const api of ownerLists) api.reset();
  reminderPlan = []; reminderSent = []; reminderList.replaceChildren(); reminderHistory.replaceChildren(); reminderStatus.textContent = '';
  document.querySelector('#backup-auto').textContent = '';
  ledgerBody.replaceChildren(); ledgerRows = []; ledgerSummary.textContent = ''; ledgerStatus.textContent = '';
  staffProfilesBody.replaceChildren(); staffProfilesStatus.textContent = '';
  consentsDetail.replaceChildren();
  financeList.replaceChildren();
  financeStatus.textContent = '';
  attentionList.replaceChildren();
  attentionStatus.textContent = '';
  rosterSheet.hidden = true;
  rosterBody.replaceChildren();
  rosterStatus.textContent = '';
  rosterClass.replaceChildren(new Option('Choose a class', ''));
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
  if (portalRole === 'student') { portalPtmSection.hidden = true; portalMessagesSection.hidden = true; return; } // meetings and messages are for the parent
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
      if (item.mod === 'hidden') continue;
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
  portalSubmitSection.hidden = portalRole !== 'student'; // only the student submits homework
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

// Session expiry: a signed-in person who does nothing for IDLE_MINUTES is signed out, with a warning two minutes before.
const IDLE_MINUTES = 30;
let idleOn = false;
let idleWarned = false;
let idleTimer;
let idleWarnTimer;
let idleLast = 0;
function idleWatch(on, throttled) {
  if (on && throttled && Date.now() - idleLast < 5000 && !idleWarned) return;
  idleOn = on;
  clearTimeout(idleTimer);
  clearTimeout(idleWarnTimer);
  if (!on) { idleWarned = false; return; }
  idleLast = Date.now();
  if (idleWarned) { idleWarned = false; status.textContent = ''; }
  idleWarnTimer = setTimeout(() => {
    idleWarned = true;
    status.hidden = false;
    status.textContent = 'You will be signed out in 2 minutes because the page has not been used. Click anywhere to stay signed in.';
  }, (IDLE_MINUTES - 2) * 60000);
  idleTimer = setTimeout(() => { signOut(auth).catch(() => {}); }, IDLE_MINUTES * 60000);
}
for (const eventName of ['click', 'keydown', 'pointerdown', 'touchstart', 'scroll']) {
  document.addEventListener(eventName, () => { if (idleOn) idleWatch(true, true); }, { passive: true });
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
  portalPush = undefined;
  portalRemindersSection.hidden = true;
  portalRemindersStatus.textContent = '';
  portalRemindersList.replaceChildren();
  portalPushSection.hidden = true;
  portalPushStatus.textContent = '';
  stopPortalTest();
  portalTestsSection.hidden = true;
  portalTestsStatus.textContent = '';
  portalTestsList.replaceChildren();
  portalPickup = undefined;
  portalPickupSection.hidden = true;
  portalPickupStatus.textContent = '';
  portalPickupList.replaceChildren();
  portalPickupQr.hidden = true;
  portalPickupForm.reset();
  portalConsentsSection.hidden = true;
  portalConsentsStatus.textContent = '';
  portalConsentsList.replaceChildren();
  portalChoice = '';
  portalTools = undefined;
  viewOnly = false;
  delete document.body.dataset.role;
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
  resetSettings();
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
  document.querySelector('#teacher-requests').hidden = true;
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
  transportData = { routes: [], riders: [] };
  portalFeesSection.hidden = true;
  portalFeesStatus.textContent = '';
  portalFeesSummary.replaceChildren();
  portalFeesBody.replaceChildren();
  schoolUid = '';
  for (const [section, status, list] of [[studentLeaveSection, studentLeaveStatus, studentLeaveList],
    [teacherStudentLeaveSection, teacherStudentLeaveStatus, teacherStudentLeaveList], [portalLeaveSection, portalLeaveStatus, portalLeaveList]]) {
    section.hidden = true;
    status.textContent = '';
    list.replaceChildren();
  }
  portalLeave = null;
  portalLeaveForm.reset();
  teacherMaterialsSection.hidden = true;
  teacherMaterialsList.replaceChildren();
  for (const section of [portalProfileSection, portalIdSection, portalMaterialsSection]) section.hidden = true;
  portalProfileList.replaceChildren();
  portalMaterialsList.replaceChildren();
  portalEbooksSection.hidden = true; portalEbooksList.replaceChildren(); portalEbookItems = [];
  idCard.replaceChildren();
  portalHome = { ...portalHome, att: null, pending: null, avg: null, subjects: null, due: null, today: [], homework: [], upcoming: [] };
  portalStats.replaceChildren();
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
  resetCheckins();
  resetMyCheckin();
  resetMyDispute();
  resetQrScreen();
  resetDisputes();
  resetHours();
  resetMyPay();
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
  portalLines = [];
  portalExamPick.replaceChildren();
  portalExamTitle.textContent = '';
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
  photoMap = new Map();
  studentHistoryTitle.hidden = true;
  studentHistoryList.hidden = true;
  studentHistoryList.replaceChildren();
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
  idleWatch(Boolean(user));
  if (!user) { window.__bootDone?.(); return; }
  recordLogin(user);
  // The super administrator (a platformAdmins record) lands on the Super Admin Panel. Opening a school needs ?school=<id> in the address.
  delete document.body.dataset.mode;
  if (!new URLSearchParams(location.search).has('school')) {
    try {
      const tools = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
      const found = await tools.getDocFromServer(tools.doc(tools.getFirestore(app), 'platformAdmins', user.uid));
      if (request !== schoolRequest) return;
      if (found.exists()) {
        if (!new URLSearchParams(location.search).has('legacy')) { location.replace('/admin'); return; }
        document.body.dataset.mode = 'superadmin';
        schoolStatus.hidden = true;
        return;
      }
    } catch { /* not a platform administrator */ }
  }

  schoolStatus.textContent = 'Checking school access.';
  try {
    const { addDoc, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, getFirestore, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    if (request !== schoolRequest) return;
    firestoreTools = { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, query, serverTimestamp, setDoc, updateDoc, where };
    const schoolRef = doc(getFirestore(app), 'schools', SCHOOL_ID);
    const membership = await getDocFromServer(doc(schoolRef, 'members', user.uid));
    viewerRole = membership.data()?.role ?? '';
    if (request !== schoolRequest) return;
    if (membership.data()?.active === true && membership.data().role === 'teacher') {
      teacherEmail.textContent = user.email;
      teacherDashboard.hidden = false;
      status.hidden = true;
      schoolStatus.hidden = true;
      assignmentSummary.textContent = 'Loading assignment.';
      let examsLoader = null;
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
            examsLoader = () => loadTeacherExams(request);
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
      // Show every screen at once, then load them side by side. Before, each one waited for the one before it, so
      // the tiles popped in one by one and a slow class sheet held everything else back. The daily attendance
      // screen only appears for a class teacher, which one quick query tells us first.
      const myClassIds = await getDocsFromServer(query(collection(schoolRef, 'classTeachers'), where('teacherUid', '==', user.uid)))
        .then((found) => found.docs.map((record) => record.id)).catch(() => []);
      const isClassTeacher = myClassIds.length > 0;
      if (request !== schoolRequest) return;
      for (const id of ['my-attendance', 'leave-request', 'teacher-homework', 'teacher-timetable', 'teacher-calendar', 'teacher-cover',
        'teacher-lessons', 'teacher-notices', 'teacher-submissions', 'teacher-assessments', 'teacher-requests']) document.querySelector('#' + id).hidden = false;
      attMarkSection.hidden = !isClassTeacher;
      teacherStudentLeaveSection.hidden = !isClassTeacher;
      teacherMaterialsSection.hidden = !teacherHomework;
      if (isClassTeacher) attMarkStatus.textContent = 'Loading your class.';
      await Promise.allSettled([
        isClassTeacher ? loadAttendanceClasses(request, schoolRef, user.uid) : undefined,
        isClassTeacher ? loadStudentLeaveBoard(request, schoolRef, user.uid, { status: teacherStudentLeaveStatus, list: teacherStudentLeaveList }, myClassIds) : undefined,
        examsLoader?.(),
        loadMyAttendance(request, schoolRef, user.uid),
        loadMyPay(request, schoolRef, user),
        loadMyCheckin(request, schoolRef, user.uid),
        loadMyDispute(request, schoolRef, user.uid),
        loadMyLeave(request, schoolRef, user.uid),
        loadTeacherNotices(request, schoolRef, user.uid),
        loadTeacherHomework(request),
        loadTeacherMaterials(request),
        loadTeacherTimetable(request, schoolRef, user.uid),
        loadTeacherCover(request, schoolRef, user.uid),
        loadTeacherLessons(request),
        loadTeacherSubmissions(request),
        loadTeacherAssessments(request),
        loadTeacherRequests(request, schoolRef, user),
        loadUpcomingEvents(schoolRef, teacherCalendarSection, teacherCalendarStatus, teacherCalendarList),
      ]);
      return;
    }
    if (membership.data()?.active === true && ['student', 'parent'].includes(membership.data().role)) {
      status.hidden = true;
      schoolStatus.hidden = true;
      const portalFlags = await (async () => { try { const found = await getDocFromServer(doc(getFirestore(app), 'platformConfig', 'flags')); return found.exists() ? found.data() : {}; } catch { return {}; } })();
      if (portalFlags.portal === false) {
        status.hidden = false;
        status.textContent = 'The parent and student portal is switched off for now. Please contact the school.';
        return;
      }
      try { const branding = await getDocFromServer(doc(schoolRef, 'settings', 'branding')); schoolLogo = branding.exists() ? branding.data().logo : ''; } catch { schoolLogo = ''; }
      await loadPortal({ schoolRef, user, doc, collection, getDocFromServer, getDocsFromServer, query, where }, request);
      return;
    }
    // A super administrator who is not a member of this school looks at it read-only.
    let superView = false;
    if (membership.data()?.active !== true) {
      try { superView = (await getDocFromServer(doc(getFirestore(app), 'platformAdmins', user.uid))).exists(); } catch { superView = false; }
      if (request !== schoolRequest) return;
    }
    // A super administrator needs a live access pass (created on /admin with a reason, and audited) to look inside a school.
    let superPass = null;
    if (superView) {
      try {
        const pass = await getDocFromServer(doc(getFirestore(app), 'platformGrants', user.uid + '_' + SCHOOL_ID + '_standard'));
        if (pass.exists() && pass.data().expiresAt.toMillis() > Date.now()) superPass = pass.data();
      } catch { superPass = null; }
      if (request !== schoolRequest) return;
      if (!superPass) {
        schoolStatus.replaceChildren('You need an access pass to open this school. ');
        const link = document.createElement('a'); link.href = '/admin#/school/' + encodeURIComponent(SCHOOL_ID); link.textContent = 'Request one on the Super Admin page';
        schoolStatus.append(link);
        return;
      }
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
    viewOnly = membership.data()?.role === 'principal' || superView;
    const feeOffice = membership.data()?.active === true && membership.data()?.role === 'accountant';
    if (feeOffice) document.body.dataset.role = 'accountant';
    viewOnlyNote.hidden = !viewOnly;
    if (superView) {
      const back = document.createElement('a');
      back.href = location.pathname; back.textContent = 'Back to the Super Admin Panel';
      const strong = document.createElement('strong'); strong.textContent = 'Super admin view. ';
      viewOnlyNote.replaceChildren(strong, 'You can look at everything in this school but cannot change it. ', back);
      showSuperBanner(user, SCHOOL_ID, school.data().name, superPass);
    }
    ownerRole.textContent = feeOffice ? 'Fee office' : superView ? 'Super admin (view only)' : viewOnly ? 'Principal (view, approve leave, post notices)' : 'School Owner';
    saveSchoolProfile = (profile) => updateDoc(schoolRef, profile);
    saveAssignment = (uid, assignment) => setDoc(doc(schoolRef, 'teacherAssignments', uid), assignment);
    ownerEmail.textContent = user.email;
    dashboard.hidden = false;
    status.hidden = true;
    schoolStatus.hidden = true;
    if (!superView && membership.data()?.active === true && membership.data()?.role === 'owner') showPlatformInbox(schoolRef);
    const staff = collection(schoolRef, 'staff');
    staffDirectory = {
      list: () => getDocsFromServer(staff),
      save: (id, profile) => (id ? updateDoc(doc(staff, id), profile) : addDoc(staff, profile).then((ref) => { document.dispatchEvent(new Event('usage-changed')); return ref; })),
    };
    if (!feeOffice) {
      staffStatus.textContent = 'Loading staff profiles.';
      await loadStaff(staffDirectory, request);
    }
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
        if (name === 'students' || name === 'storageRecords' || name === 'staffDocuments' || name === 'eBooks') document.dispatchEvent(new Event('usage-changed'));
        const voided = name === 'payments' && data.voided === true;
        await log(voided ? 'void' : 'save', name, id, name === 'payments' ? 'Rs ' + data.amount : '');
      },
      marksOfStudent: (studentId) => getDocsFromServer(query(collection(schoolRef, 'marks'), where('studentId', '==', studentId))),
      remove: async (name, id) => {
        await deleteDoc(doc(schoolRef, name, id));
        if (name === 'staffDocuments' || name === 'eBooks') document.dispatchEvent(new Event('usage-changed'));
        await log('remove', name, id, '');
      },
      uid: user.uid,
      vaultPut: async (id, file, contentType) => {
        const { getStorage, ref, uploadBytes } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
        await uploadBytes(ref(getStorage(app), 'schools/' + SCHOOL_ID + '/staffDocs/' + id), file, { contentType });
      },
      vaultDrop: async (id) => {
        const { getStorage, ref, deleteObject } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
        await deleteObject(ref(getStorage(app), 'schools/' + SCHOOL_ID + '/staffDocs/' + id));
      },
      ebookPut: async (id, file) => {
        const { getStorage, ref, uploadBytes } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
        await uploadBytes(ref(getStorage(app), 'schools/' + SCHOOL_ID + '/ebooks/' + id), file, { contentType: 'application/pdf' });
      },
      ebookDrop: async (id) => {
        const { getStorage, ref, deleteObject } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
        await deleteObject(ref(getStorage(app), 'schools/' + SCHOOL_ID + '/ebooks/' + id));
      },
      vaultUrl: async (id) => {
        const { getStorage, ref, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
        return getDownloadURL(ref(getStorage(app), 'schools/' + SCHOOL_ID + '/staffDocs/' + id));
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
      attendanceOfStudent: (studentId) => getDocsFromServer(query(collection(schoolRef, 'attendance'), where('studentId', '==', studentId))),
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
    if (feeOffice) {
      await loadFeeOffice(request);
      return;
    }
    // Show every module tile straight away; each module fills in its own data in the background.
    for (const module of document.querySelectorAll('#owner-dashboard > .mod')) {
      if (!['bulk-cards', 'payslip'].includes(module.id) && !module.hasAttribute('data-off')) module.hidden = false;
    }
    attReviewDate.value = localToday();
    await loadGrading(schoolRef);
    if (request === schoolRequest) showGrading();
    academicStatus.textContent = 'Loading academic setup.';
    await loadAcademic(request);
    if (request === schoolRequest) {
      leaveReviewSection.hidden = false;
      studentLeaveSection.hidden = false;
      loadStudentLeaveBoard(request, schoolRef, user.uid, { status: studentLeaveStatus, list: studentLeaveList }, null);
      renderCardStudents();
      renderAttrepClasses();
      importSection.hidden = false;
      renderPromotionYears();
      // Everything below only reads, so it runs side by side instead of one after another.
      const roster = loadStaffAttendance(request);
      startCheckins();
      if (!superView) startQrScreen();
      startDisputes();
      startHours();
      await Promise.allSettled([
        roster.then(() => (request === schoolRequest ? renderLeaveReview() : undefined)),
        roster.then(() => (request === schoolRequest ? loadOwnerLists(request) : undefined)),
        loadFees(request), loadApprovals(request), loadNotices(request), loadAuditLog(request), loadTimetable(request), loadOwnerHomework(request),
        loadCalendar(request), loadLibrary(request), loadVisitors(request), loadBehaviour(request), loadWebsite(request), loadSettings(request),
      ]);
    }
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

// Student leave. A student or parent applies from the portal; the class teacher of that class approves or rejects it
// (the owner and principal can also decide). The family sees the answer, with the teacher's note.
const studentLeaveSection = document.querySelector('#student-leave');
const studentLeaveStatus = document.querySelector('#student-leave-status');
const studentLeaveList = document.querySelector('#student-leave-list');
const teacherStudentLeaveSection = document.querySelector('#teacher-studentleave');
const teacherStudentLeaveStatus = document.querySelector('#teacher-studentleave-status');
const teacherStudentLeaveList = document.querySelector('#teacher-studentleave-list');
const portalLeaveSection = document.querySelector('#portal-leave');
const portalLeaveStatus = document.querySelector('#portal-leave-status');
const portalLeaveList = document.querySelector('#portal-leave-list');
const portalLeaveForm = document.querySelector('#portal-leave-form');
let portalLeave = null; // { tools, studentId, items, busy }

function studentLeaveLine(item) {
  return item.studentName + ' | ' + item.fromDate + (item.toDate !== item.fromDate ? ' to ' + item.toDate : '') + ' | ' + item.reason
    + ' | ' + LEAVE_LABEL[item.status] + (item.decisionNote ? ' | Note: ' + item.decisionNote : '');
}

function drawStudentLeaves(list, items, onDecide) {
  list.replaceChildren();
  const sorted = [...items].sort((a, b) => (a.data.status === 'pending' ? 0 : 1) - (b.data.status === 'pending' ? 0 : 1)
    || b.data.fromDate.localeCompare(a.data.fromDate));
  for (const item of sorted) {
    const entry = document.createElement('li');
    entry.textContent = studentLeaveLine(item.data) + (onDecide && item.data.status === 'pending' ? ' ' : '');
    if (onDecide && item.data.status === 'pending') {
      for (const next of ['approved', 'rejected']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = next === 'approved' ? 'Approve' : 'Reject';
        button.addEventListener('click', () => onDecide(item, next));
        entry.append(button, ' ');
      }
    }
    list.append(entry);
  }
}

// Used by the class teacher (classIds = the classes they lead) and by the owner or principal (classIds = null, everything).
async function loadStudentLeaveBoard(request, schoolRef, uid, board, classIds) {
  const { collection, doc, query, where, getDocsFromServer, setDoc } = firestoreTools;
  board.status.textContent = 'Loading leave requests.';
  try {
    const parts = classIds
      ? await Promise.all(classIds.map((id) => getDocsFromServer(query(collection(schoolRef, 'studentLeaves'), where('classId', '==', id)))))
      : [await getDocsFromServer(collection(schoolRef, 'studentLeaves'))];
    if (request !== schoolRequest) return;
    const items = parts.flatMap((part) => part.docs.map((record) => ({ id: record.id, data: record.data() })));
    drawStudentLeaves(board.list, items, async (item, next) => {
      const answer = prompt((next === 'approved' ? 'Approve' : 'Reject') + ' leave for ' + item.data.studentName + '. Note for the family (optional):');
      if (answer === null || board.busy) return;
      board.busy = true;
      board.status.textContent = 'Saving decision.';
      try {
        const note = answer.trim().slice(0, 200);
        await setDoc(doc(schoolRef, 'studentLeaves', item.id), { ...item.data, status: next, decidedBy: uid, ...(note ? { decisionNote: note } : {}) });
        board.busy = false;
        if (request === schoolRequest) await loadStudentLeaveBoard(request, schoolRef, uid, board, classIds);
      } catch (error) {
        board.busy = false;
        if (request === schoolRequest) board.status.textContent = 'Could not save the decision (' + (error?.code ?? 'error') + '). Try again.';
      }
    });
    board.status.textContent = items.length ? '' : 'No leave requests yet.';
  } catch (error) {
    if (request === schoolRequest) board.status.textContent = 'Could not load leave requests (' + (error?.code ?? 'error') + ').';
  }
}

// Portal side: the student or parent's own requests, and the form.
async function loadPortalLeave(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalLeaveSection.hidden = false;
  portalLeave = { tools, studentId, items: [], busy: false };
  portalLeaveForm.elements.namedItem('fromDate').min = localToday();
  portalLeaveForm.elements.namedItem('toDate').min = localToday();
  portalLeaveStatus.textContent = 'Loading leave requests.';
  try {
    const found = await getDocsFromServer(query(collection(schoolRef, 'studentLeaves'), where('studentId', '==', studentId)));
    if (request !== schoolRequest || portalLeave?.studentId !== studentId) return;
    portalLeave.items = found.docs.map((record) => ({ id: record.id, data: record.data() }));
    drawStudentLeaves(portalLeaveList, portalLeave.items, null);
    portalLeaveStatus.textContent = portalLeave.items.length ? '' : 'No leave requests yet.';
  } catch (error) {
    if (request === schoolRequest) portalLeaveStatus.textContent = 'Could not load leave requests (' + (error?.code ?? 'error') + ').';
  }
}

portalLeaveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = portalLeave;
  if (!context || context.busy) return;
  const fields = new FormData(portalLeaveForm);
  const fromDate = String(fields.get('fromDate') ?? '');
  const toDate = String(fields.get('toDate') ?? '');
  const reason = String(fields.get('reason') ?? '').trim();
  if (!DATE_TEXT.test(fromDate) || !DATE_TEXT.test(toDate) || toDate < fromDate) {
    portalLeaveStatus.textContent = 'Choose a start date, and an end date that is not before it.';
    return;
  }
  if (!reason) {
    portalLeaveStatus.textContent = 'Enter a reason for the leave.';
    return;
  }
  const id = context.studentId + '_' + fromDate;
  if (context.items.some((item) => item.id === id)) {
    portalLeaveStatus.textContent = 'A leave request starting on that date was already sent.';
    return;
  }
  const { schoolRef, collection, doc, getDocsFromServer, getDocFromServer, query, where, user } = context.tools;
  const { setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  portalLeaveStatus.textContent = 'Sending leave request.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', context.studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const student = await getDocFromServer(doc(schoolRef, 'students', context.studentId));
    if (!latest || !student.exists()) {
      portalLeaveStatus.textContent = 'This student is not placed in a class yet. Ask the school office.';
      return;
    }
    const data = { studentId: context.studentId, studentName: student.data().name, classId: latest.classId, fromDate, toDate, reason,
      status: 'pending', requestedBy: user.uid };
    await setDoc(doc(schoolRef, 'studentLeaves', id), data);
    if (request !== schoolRequest) return;
    context.items.push({ id, data });
    portalLeaveForm.reset();
    drawStudentLeaves(portalLeaveList, context.items, null);
    portalLeaveStatus.textContent = 'Leave request sent. The class teacher will approve or reject it.';
  } catch (error) {
    if (request === schoolRequest) portalLeaveStatus.textContent = 'Could not send the leave request (' + (error?.code ?? 'error') + '). Try again.';
  } finally {
    context.busy = false;
  }
});

// ---------- Student and parent dashboards (batch 51) ----------
// The two logins now look and work differently. The student sees their own school day: homework to hand in, results,
// timetable, materials and an ID card. The parent sees the child from outside: fees, bus, meetings, messages and leave.
const portalStats = document.querySelector('#portal-stats');
const portalProfileSection = document.querySelector('#portal-profile');
const portalProfileStatus = document.querySelector('#portal-profile-status');
const portalProfileList = document.querySelector('#portal-profile-list');
const portalIdSection = document.querySelector('#portal-idcard');
const portalIdStatus = document.querySelector('#portal-idcard-status');
const idCard = document.querySelector('#idcard');
const portalMaterialsSection = document.querySelector('#portal-materials');
const portalMaterialsStatus = document.querySelector('#portal-materials-status');
const portalMaterialsList = document.querySelector('#portal-materials-list');
const teacherMaterialsSection = document.querySelector('#teacher-materials');
const teacherMaterialsStatus = document.querySelector('#teacher-materials-status');
const teacherMaterialsList = document.querySelector('#teacher-materials-list');
const materialsForm = document.querySelector('#materials-form');
let portalHome = { att: null, pending: null, avg: null, subjects: null, due: null, today: [], homework: [], upcoming: [], name: '', classId: '', section: '', roll: '', admissionNo: '', photo: '' };

const PORTAL_PLAN = {
  student: {
    title: 'Student Dashboard', tagline: 'Learn \u2022 Track \u2022 Achieve \u2022 All in One Place',
    order: ['portal-profile', 'portal-attendance', 'portal-timetable', 'portal-homework', 'portal-submit', 'portal-results', 'portal-assessments',
      'portal-materials', 'portal-ebooks', 'portal-tests', 'portal-notices', 'portal-calendar', 'portal-events', 'portal-leave', 'portal-life', 'portal-idcard'],
    names: { 'portal-profile': 'My Profile', 'portal-attendance': 'My Attendance', 'portal-timetable': 'My Timetable', 'portal-homework': 'Homework & Assignments',
      'portal-submit': 'Submit Homework', 'portal-results': 'Exams & Results', 'portal-assessments': 'Class Test Scores', 'portal-materials': 'Study Materials', 'portal-ebooks': 'E-Library', 'portal-tests': 'Online Tests',
      'portal-notices': 'Notices & Notifications', 'portal-calendar': 'School Calendar', 'portal-events': 'School Events', 'portal-leave': 'Apply for Leave',
      'portal-life': 'My Bus & Activities', 'portal-idcard': 'Digital ID Card' },
    quick: [['Homework', 'portal-homework'], ['Exams & Results', 'portal-results'], ['My Timetable', 'portal-timetable'], ['Study Materials', 'portal-materials']],
  },
  parent: {
    title: 'Parent Dashboard', tagline: 'Stay Connected \u2022 Monitor Progress \u2022 Support Your Child',
    order: ['portal-profile', 'portal-attendance', 'portal-homework', 'portal-timetable', 'portal-results', 'portal-assessments', 'portal-fees',
      'portal-materials', 'portal-ebooks', 'portal-life', 'portal-leave', 'portal-messages', 'portal-consents', 'portal-reminders', 'portal-push', 'portal-tests', 'portal-pickup', 'portal-ptm', 'portal-notices', 'portal-calendar', 'portal-events'],
    names: { 'portal-profile': 'My Child', 'portal-attendance': 'Attendance', 'portal-homework': 'Homework & Assignments', 'portal-timetable': 'Timetable',
      'portal-results': 'Exams & Results', 'portal-assessments': 'Class Test Scores', 'portal-fees': 'Fees & Payments', 'portal-materials': 'Study Materials', 'portal-ebooks': 'E-Library',
      'portal-life': 'Bus & Route', 'portal-leave': 'Leave Application', 'portal-messages': 'Messages & Communication', 'portal-consents': 'Consent Forms', 'portal-tests': 'Online Tests', 'portal-pickup': 'Pickup Authorisation', 'portal-reminders': 'Fee Reminders', 'portal-push': 'Phone Notifications', 'portal-ptm': 'Parent-Teacher Meetings',
      'portal-notices': 'Notices', 'portal-calendar': 'School Calendar', 'portal-events': 'School Events' },
    quick: [['Exams & Results', 'portal-results'], ['Fees & Payments', 'portal-fees'], ['Bus & Route', 'portal-life'], ['Apply for Leave', 'portal-leave']],
  },
};

function applyPortalRole(role) {
  const plan = PORTAL_PLAN[role];
  portalDashboard.dataset.role = role;
  document.querySelector('#portal-title').textContent = plan.title;
  document.querySelector('#portal-tagline').textContent = plan.tagline;
  for (const [id, name] of Object.entries(plan.names)) {
    const heading = document.querySelector('#' + id + ' > h3');
    if (heading) heading.textContent = name;
  }
  // The sections that belong to this role come first, in this role's order; the rest follow.
  for (const id of plan.order) {
    const section = document.querySelector('#' + id);
    if (section) portalDashboard.append(section);
  }
  const quick = document.querySelector('#portal-quick');
  quick.replaceChildren();
  for (const [label, id] of plan.quick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => portalDashboard.dispatchEvent(new CustomEvent('ui-open', { detail: id })));
    quick.append(button);
  }
}

const prettyClass = (id) => id ? id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';

function renderPortalHome() {
  const h = portalHome;
  const role = portalRole;
  const first = (h.name || '').split(' ')[0];
  document.querySelector('#portal-hello').textContent = role === 'student'
    ? 'Welcome back' + (first ? ', ' + first : '') + '!'
    : 'Welcome back!' + (h.name ? ' Here is how ' + first + ' is doing.' : '');
  document.querySelector('#portal-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const card = document.querySelector('#portal-childcard');
  card.replaceChildren();
  if (h.name) {
    if (h.photo) { const img = document.createElement('img'); img.alt = ''; img.src = h.photo; card.append(img); }
    const text = document.createElement('div');
    for (const [line, strong] of [[h.name, true], [[prettyClass(h.classId), h.section ? 'Section ' + h.section.toUpperCase() : '', h.roll ? 'Roll ' + h.roll : ''].filter(Boolean).join(' | '), false],
      ['Admission No: ' + h.admissionNo, false]]) {
      if (!line) continue;
      const p = document.createElement('p');
      if (strong) { const b = document.createElement('strong'); b.textContent = line; p.append(b); } else p.textContent = line;
      text.append(p);
    }
    card.append(text);
  }
  const money = (n) => 'Rs ' + n.toLocaleString('en-IN');
  const cards = role === 'student'
    ? [[h.att === null ? '-' : h.att + '%', 'Attendance', 'portal-attendance'], [h.pending === null ? '-' : String(h.pending), 'Pending homework', 'portal-submit'],
      [h.avg === null ? '-' : h.avg + '%', 'Average score', 'portal-results'], [h.subjects === null ? '-' : String(h.subjects), 'Subjects with results', 'portal-results']]
    : [[h.att === null ? '-' : h.att + '%', 'Attendance', 'portal-attendance'], [h.pending === null ? '-' : String(h.pending), 'Homework not yet submitted', 'portal-homework'],
      [h.upcoming.length ? String(h.upcoming.length) : '0', 'Upcoming dates', 'portal-calendar'], [h.due === null ? '-' : money(h.due), 'Fees due', 'portal-fees']];
  portalStats.replaceChildren();
  for (const [value, label, target] of cards) {
    const button = document.createElement('button');
    button.type = 'button';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    button.append(strong, span);
    button.addEventListener('click', () => portalDashboard.dispatchEvent(new CustomEvent('ui-open', { detail: target })));
    portalStats.append(button);
  }
  const fill = (id, items, empty) => {
    const list = document.querySelector(id);
    list.replaceChildren();
    for (const text of (items.length ? items : [empty])) { const li = document.createElement('li'); li.textContent = text; list.append(li); }
  };
  fill('#glance-timetable', h.today, 'No periods set for today.');
  fill('#glance-homework', h.homework, 'No homework yet.');
  fill('#glance-upcoming', h.upcoming, 'Nothing coming up.');
}

// One set of quick reads for the home panel. Each part fails on its own, so one slow or blocked read never blanks the rest.
async function loadPortalHome(tools, request, studentId) {
  const { schoolRef, collection, doc, getDocsFromServer, getDocFromServer, query, where } = tools;
  const safe = (promise, fallback) => promise.catch(() => fallback);
  const [attendance, placements, submitted, calendar, student, photo] = await Promise.all([
    safe(getDocsFromServer(query(collection(schoolRef, 'attendance'), where('studentId', '==', studentId))), { docs: [] }),
    safe(getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId))), { docs: [] }),
    safe(getDocsFromServer(query(collection(schoolRef, 'submissions'), where('studentId', '==', studentId))), { docs: [] }),
    safe(getDocsFromServer(collection(schoolRef, 'calendar')), { docs: [] }),
    safe(getDocFromServer(doc(schoolRef, 'students', studentId)), null),
    safe(getDocFromServer(doc(schoolRef, 'studentPhotos', studentId)), null)]);
  if (request !== schoolRequest) return;
  const marks = attendance.docs.map((record) => record.data());
  const counted = marks.filter((mark) => mark.status !== 'leave');
  portalHome.att = counted.length ? Math.round(counted.filter((mark) => mark.status !== 'absent').length / counted.length * 1000) / 10 : null;
  const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
  if (student?.exists()) { portalHome.name = student.data().name; portalHome.admissionNo = student.data().admissionNo; }
  if (photo?.exists()) portalHome.photo = photo.data().photo;
  if (latest) { portalHome.classId = latest.classId; portalHome.section = latest.sectionId ?? ''; portalHome.roll = latest.rollNo ?? ''; }
  const today = localToday();
  portalHome.upcoming = calendar.docs.map((record) => record.data()).filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4).map(eventText);
  if (latest) {
    const [workDocs, slots] = await Promise.all([
      safe(getDocsFromServer(query(collection(schoolRef, 'homework'), where('classId', '==', latest.classId))), { docs: [] }),
      safe(readBySlot(schoolRef, 'timetable', [latest.classId]), [])]);
    if (request !== schoolRequest) return;
    const done = new Set(submitted.docs.map((record) => record.data().homeworkId));
    const work = workDocs.docs.map((record) => ({ ...record.data(), id: record.id })).filter((item) => item.dueDate >= today);
    portalHome.pending = work.filter((item) => !done.has(item.id)).length;
    portalHome.homework = [...work].sort(dueFirst).slice(0, 3).map((item) => item.subject + ': ' + item.title + ' (due ' + item.dueDate + ')');
    portalHome.today = slots.filter((slot) => slot.day === (new Date().getDay() || 7)).sort(slotOrder)
      .map((slot) => slot.start + ' ' + slot.subject + (slot.teacher ? ' - ' + slot.teacher : ''));
  }
  renderPortalHome();
}

// My Profile (student) or My Child (parent).
async function loadPortalProfile(tools, request, studentId) {
  const { schoolRef, collection, doc, getDocsFromServer, getDocFromServer, query, where } = tools;
  portalProfileSection.hidden = false;
  portalProfileStatus.textContent = 'Loading.';
  try {
    const [student, placements, riders, photo, logo] = await Promise.all([
      getDocFromServer(doc(schoolRef, 'students', studentId)),
      getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId))),
      getDocsFromServer(query(collection(schoolRef, 'transportRiders'), where('studentId', '==', studentId))).catch(() => ({ docs: [] })),
      getDocFromServer(doc(schoolRef, 'studentPhotos', studentId)).catch(() => null),
      getDocFromServer(doc(schoolRef, 'settings', 'branding')).catch(() => null)]);
    if (request !== schoolRequest) return;
    if (!student.exists()) { portalProfileStatus.textContent = 'No profile found.'; return; }
    const data = student.data();
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const rows = [['Name', data.name], ['Admission No', data.admissionNo], ['Class', latest ? prettyClass(latest.classId) + (latest.sectionId ? ' - Section ' + latest.sectionId.toUpperCase() : '') : ''],
      ['Roll No', latest?.rollNo ?? ''], ['Date of birth', data.dob ?? ''], ['Gender', data.gender ?? ''], ['Parent / guardian', data.guardianName],
      ['Mother', data.motherName ?? ''], ['Contact phone', data.guardianPhone], ['Emergency phone', data.emergencyPhone ?? ''], ['Address', data.address ?? ''],
      ['Bus route', riders.docs.map((record) => record.data().routeId).join(', ')], ['Status', data.status === 'active' ? 'Active' : 'Inactive']];
    portalProfileList.replaceChildren();
    for (const [label, value] of rows) if (value !== '' && value !== undefined) listItem(portalProfileList, label + ': ' + value);
    portalProfileStatus.textContent = '';
    portalHome.photo = photo?.exists() ? photo.data().photo : portalHome.photo;
    renderPortalHome();
    if (portalRole === 'student') {
      portalIdSection.hidden = false;
      idCard.replaceChildren();
      const school = document.querySelector('#portal-head p:not([id])')?.textContent || 'School';
      if (logo?.exists()) { const mark = document.createElement('img'); mark.alt = 'School logo'; mark.src = logo.data().logo; idCard.append(mark); }
      const title = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = school + ' - Student ID Card';
      title.append(strong);
      idCard.append(title);
      if (photo?.exists()) { const img = document.createElement('img'); img.alt = 'Student photo'; img.src = photo.data().photo; idCard.append(img); }
      for (const [label, value] of [['Name', data.name], ['Class', latest ? prettyClass(latest.classId) + (latest.sectionId ? ' ' + latest.sectionId.toUpperCase() : '') : ''],
        ['Admission No', data.admissionNo], ['Guardian', data.guardianName], ['Phone', data.guardianPhone]]) {
        if (!value) continue;
        const p = document.createElement('p');
        p.textContent = label + ': ' + value;
        idCard.append(p);
      }
      portalIdStatus.textContent = '';
    }
  } catch (error) {
    if (request === schoolRequest) portalProfileStatus.textContent = 'Could not load the profile (' + (error?.code ?? 'error') + ').';
  }
}
document.querySelector('#idcard-print').addEventListener('click', () => window.print());

// Study materials: the portal list, and the teacher's form. A material is a title and an https link.
function materialLine(item, button) {
  const entry = document.createElement('li');
  entry.append(item.createdAt + ' - ' + item.subject + ': ');
  const link = document.createElement('a');
  link.href = item.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.title;
  entry.append(link);
  if (button) entry.append(' ', button);
  return entry;
}

async function loadPortalMaterials(tools, request, studentId) {
  const { schoolRef, collection, getDocsFromServer, query, where } = tools;
  portalMaterialsSection.hidden = false;
  portalMaterialsStatus.textContent = 'Loading study materials.';
  try {
    const placements = await getDocsFromServer(query(collection(schoolRef, 'enrollments'), where('studentId', '==', studentId)));
    const latest = placements.docs.map((record) => record.data()).sort((a, b) => b.yearId.localeCompare(a.yearId))[0];
    const items = latest ? await readBySlot(schoolRef, 'materials', [latest.classId]) : [];
    if (request !== schoolRequest) return;
    portalMaterialsList.replaceChildren();
    for (const item of items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) portalMaterialsList.append(materialLine(item));
    portalMaterialsStatus.textContent = items.length ? '' : 'No study materials have been shared yet.';
  } catch (error) {
    if (request === schoolRequest) portalMaterialsStatus.textContent = 'Could not load study materials (' + (error?.code ?? 'error') + ').';
  }
}

async function loadTeacherMaterials(request) {
  const context = teacherHomework;
  if (!context) return;
  const { collection, query, where, getDocsFromServer, doc, deleteDoc } = firestoreTools;
  teacherMaterialsSection.hidden = false;
  teacherMaterialsStatus.textContent = 'Loading.';
  try {
    const saved = await getDocsFromServer(query(collection(context.schoolRef, 'materials'), where('classId', '==', context.classId)));
    if (request !== schoolRequest || context !== teacherHomework) return;
    teacherMaterialsList.replaceChildren();
    for (const record of saved.docs.sort((a, b) => b.data().createdAt.localeCompare(a.data().createdAt))) {
      let button;
      if (record.data().createdBy === context.uid) {
        button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Remove';
        button.addEventListener('click', async () => {
          if (context.busy || !confirm('Remove this material? Students will no longer see it.')) return;
          context.busy = true;
          try { await deleteDoc(doc(context.schoolRef, 'materials', record.id)); } catch { teacherMaterialsStatus.textContent = 'Could not remove it. Try again.'; }
          context.busy = false;
          await loadTeacherMaterials(request);
        });
      }
      teacherMaterialsList.append(materialLine(record.data(), button));
    }
    teacherMaterialsStatus.textContent = saved.docs.length ? '' : 'Nothing shared yet.';
  } catch (error) {
    if (request === schoolRequest) teacherMaterialsStatus.textContent = 'Could not load materials (' + (error?.code ?? 'error') + ').';
  }
}

materialsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherHomework;
  if (!context || context.busy) return;
  const fields = new FormData(materialsForm);
  const title = String(fields.get('title') ?? '').trim();
  const link = String(fields.get('link') ?? '').trim();
  if (!title || !/^https:\/\/[^ ]{4,400}$/.test(link)) {
    teacherMaterialsStatus.textContent = 'Enter a title and a link that starts with https://';
    return;
  }
  const createdAt = localToday();
  const id = 'M-' + createdAt.replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const { doc, setDoc } = firestoreTools;
  const request = schoolRequest;
  context.busy = true;
  teacherMaterialsStatus.textContent = 'Sharing.';
  try {
    await setDoc(doc(context.schoolRef, 'materials', id), { classId: context.classId, subject: context.subject, title, link, createdAt, createdBy: context.uid });
    context.busy = false;
    materialsForm.reset();
    await loadTeacherMaterials(request);
    if (request === schoolRequest) teacherMaterialsStatus.textContent = 'Material shared with your class.';
  } catch (error) {
    if (request === schoolRequest) teacherMaterialsStatus.textContent = 'Could not share it (' + (error?.code ?? 'error') + '). Check the link and try again.';
  } finally {
    context.busy = false;
  }
});


// ---------- Batch 68 ----------
// Security alerts (feature 091): the server writes an alert for each sensitive entry in the activity log.
let alertItems = [];
const alertList = document.querySelector('#alerts-list');
const alertStatus = document.querySelector('#alerts-status');
const ALERT_LEVEL = { high: 'HIGH', medium: 'Medium', low: 'Low' };
function alertNotes() {
  const open = alertItems.filter((record) => record.data().seen !== true);
  const high = open.filter((record) => record.data().level === 'high').length;
  return open.length ? [open.length + ' security alert(s) not yet seen' + (high ? ' (' + high + ' high)' : '') + '. Open Activity Log.'] : [];
}
function drawAlerts() {
  alertList.replaceChildren();
  const rows = [...alertItems].sort((a, b) => b.data().at.localeCompare(a.data().at)).slice(0, 40);
  for (const record of rows) {
    const item = record.data();
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.textContent = item.seen === true ? 'Delete' : 'Mark seen';
    hide.addEventListener('click', async () => {
      try {
        const { doc, updateDoc, deleteDoc } = firestoreTools;
        if (item.seen === true) await deleteDoc(doc(academic.schoolRef, 'securityAlerts', record.id));
        else await updateDoc(doc(academic.schoolRef, 'securityAlerts', record.id), { seen: true });
        await loadSecurityAlerts(schoolRequest);
      } catch (error) { alertStatus.textContent = 'Could not update the alert (' + (error?.code ?? 'error') + ').'; }
    });
    listItem(alertList, (item.seen === true ? '' : 'NEW - ') + '[' + (ALERT_LEVEL[item.level] ?? item.level) + '] ' + new Date(item.at).toLocaleString() + ' - ' + item.title + ' - ' + item.detail, viewOnly ? undefined : hide);
  }
  const open = alertItems.filter((record) => record.data().seen !== true).length;
  alertStatus.textContent = alertItems.length ? open + ' new, ' + alertItems.length + ' in total.' : 'No security alerts. That is good news.';
}
async function loadSecurityAlerts(request) {
  try {
    const saved = await academic.list('securityAlerts');
    if (request !== schoolRequest) return;
    alertItems = saved.docs;
    drawAlerts();
    refreshAttention();
  } catch {
    if (request === schoolRequest) alertStatus.textContent = 'Could not load security alerts.';
  }
}
document.querySelector('#alerts-seen').addEventListener('click', async () => {
  if (viewOnly || !academic) return;
  try {
    const { doc, updateDoc } = firestoreTools;
    for (const record of alertItems.filter((found) => found.data().seen !== true)) await updateDoc(doc(academic.schoolRef, 'securityAlerts', record.id), { seen: true });
    await loadSecurityAlerts(schoolRequest);
  } catch (error) { alertStatus.textContent = 'Could not update the alerts (' + (error?.code ?? 'error') + ').'; }
});
document.querySelector('#audit-log').addEventListener('mod-open', () => { if (academic) loadSecurityAlerts(schoolRequest); });

// Automatic fee reminders (feature 148): the owner's switch. The server does the sending every morning.
const autoRemStatus = document.querySelector('#autorem-status');
const autoRemLast = document.querySelector('#autorem-last');
async function loadAutoReminders() {
  if (!academic) return;
  const request = schoolRequest;
  try {
    const { doc, getDocFromServer } = firestoreTools;
    const [setting, log] = await Promise.all([getDocFromServer(doc(academic.schoolRef, 'settings', 'autoReminders')), getDocFromServer(doc(academic.schoolRef, 'settings', 'autoRemindersLog'))]);
    if (request !== schoolRequest) return;
    const data = setting.exists() ? setting.data() : { on: false, min: 1, everyDays: 7, message: '' };
    document.querySelector('#autorem-on').checked = data.on === true;
    document.querySelector('#autorem-min').value = String(data.min ?? 1);
    document.querySelector('#autorem-every').value = String(data.everyDays ?? 7);
    document.querySelector('#autorem-message').value = data.message ?? '';
    autoRemStatus.textContent = data.on === true ? 'Automatic reminders are ON.' : 'Automatic reminders are off.';
    autoRemLast.textContent = log.exists() ? 'Last automatic run: ' + log.data().date + ' - ' + log.data().sent + ' reminder(s) sent, ' + log.data().skipped + ' skipped.' : 'The automatic run has not happened yet.';
  } catch { if (request === schoolRequest) autoRemStatus.textContent = 'Could not load the automatic reminder settings.'; }
}
document.querySelector('#feereminders').addEventListener('mod-open', loadAutoReminders);
document.querySelector('#autorem-save').addEventListener('click', async () => {
  if (viewOnly || !academic) { autoRemStatus.textContent = 'Only the owner can change this.'; return; }
  const message = document.querySelector('#autorem-message').value.trim().slice(0, 200);
  const data = { on: document.querySelector('#autorem-on').checked, min: Math.max(1, Number.parseInt(document.querySelector('#autorem-min').value || '1', 10) || 1),
    everyDays: Number.parseInt(document.querySelector('#autorem-every').value, 10) || 7, ...(message ? { message } : {}) };
  try {
    await academic.save('settings', 'autoReminders', data);
    autoRemStatus.textContent = data.on ? 'Saved. Reminders will go out automatically every morning.' : 'Saved. Automatic reminders are off.';
  } catch (error) { autoRemStatus.textContent = 'Could not save (' + (error?.code ?? 'error') + ').'; }
});
document.querySelector('#autorem-run').addEventListener('click', async () => {
  if (viewOnly || !academic) { autoRemStatus.textContent = 'Only the owner can do this.'; return; }
  autoRemStatus.textContent = 'Running.';
  try {
    const result = await restoreCall('runFeeRemindersNow', {});
    autoRemStatus.textContent = result.sent + ' reminder(s) sent, ' + result.skipped + ' skipped (reminded recently or below the minimum).';
    loadAutoReminders();
    loadReminderHistory();
  } catch (error) {
    autoRemStatus.textContent = error?.code === 'functions/failed-precondition' ? (error.message || 'Switch it on and save first.') : error?.code === 'functions/permission-denied' ? 'Only the school owner can do this.'
      : 'Could not reach the reminder service. Check the functions are deployed.';
  }
});


// ---------- Batch 69 ----------
// Approval requests (feature 156): teachers and the principal ask, the owner decides.
const APPROVAL_KINDS = { purchase: 'Purchase', expense: 'Expense', repair: 'Repair', event: 'Event', other: 'Other' };
const APPROVAL_STATE = { pending: 'WAITING', approved: 'APPROVED', rejected: 'REJECTED' };
let approvalItems = [];
const approvalsSection = document.querySelector('#approvals');
const approvalsStatus = document.querySelector('#approvals-status');
const approvalsList = document.querySelector('#approvals-list');
const approvalsForm = document.querySelector('#approvals-form');
function approvalLine(item) {
  return '[' + APPROVAL_STATE[item.status] + '] ' + item.createdOn + ' - ' + (APPROVAL_KINDS[item.kind] ?? item.kind) + ': ' + item.title
    + (item.amount ? ' - ' + rupees(item.amount) : '') + ' - from ' + item.requestedByName + (item.note ? ' (' + item.note + ')' : '')
    + (item.status !== 'pending' && item.decidedOn ? ' - decided ' + item.decidedOn + (item.decisionNote ? ': ' + item.decisionNote : '') : '');
}
function approvalNotes() {
  const waiting = approvalItems.filter((record) => record.data().status === 'pending').length;
  return waiting && !viewOnly ? [waiting + ' approval request(s) waiting for your decision. Open Approval Requests.'] : [];
}
function approvalData(form, who) {
  const fields = new FormData(form);
  const title = String(fields.get('title') ?? '').trim().slice(0, 80);
  const amount = Number.parseInt(String(fields.get('amount') ?? ''), 10);
  const note = String(fields.get('note') ?? '').trim().slice(0, 300);
  if (!title) return null;
  return { kind: String(fields.get('kind')), title, ...(amount > 0 ? { amount: Math.min(amount, 100000000) } : {}), ...(note ? { note } : {}),
    requestedBy: who.uid, requestedByName: String(who.name || 'Staff').slice(0, 60), createdOn: localToday(), status: 'pending' };
}
function drawApprovals() {
  approvalsList.replaceChildren();
  const rows = [...approvalItems].sort((a, b) => (a.data().status === 'pending' ? 0 : 1) - (b.data().status === 'pending' ? 0 : 1) || b.data().createdOn.localeCompare(a.data().createdOn)).slice(0, 60);
  for (const record of rows) {
    const item = record.data();
    const buttons = [];
    if (item.status === 'pending' && !viewOnly) {
      for (const [label, next] of [['Approve', 'approved'], ['Reject', 'rejected']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', async () => {
          try {
            const { doc, updateDoc } = firestoreTools;
            const note = document.querySelector('#approvals-note').value.trim().slice(0, 200);
            await updateDoc(doc(academic.schoolRef, 'approvalRequests', record.id), { status: next, decidedBy: schoolUid, decidedOn: localToday(), ...(note ? { decisionNote: note } : {}) });
            document.querySelector('#approvals-note').value = '';
            await loadApprovals(schoolRequest);
          } catch (error) { approvalsStatus.textContent = 'Could not save the decision (' + (error?.code ?? 'error') + ').'; }
        });
        buttons.push(button, ' ');
      }
    }
    listItem(approvalsList, approvalLine(item));
    approvalsList.lastElementChild.append(...buttons);
  }
  const waiting = approvalItems.filter((record) => record.data().status === 'pending').length;
  approvalsStatus.textContent = approvalItems.length ? waiting + ' waiting, ' + approvalItems.length + ' in total.' : 'No requests yet.';
}
async function loadApprovals(request) {
  if (!academic) return;
  try {
    const saved = await academic.list('approvalRequests');
    if (request !== schoolRequest) return;
    approvalItems = saved.docs;
    approvalsSection.hidden = false;
    approvalsForm.hidden = !viewOnly;
    document.querySelector('#approvals-notebox').hidden = viewOnly;
    drawApprovals();
    refreshAttention();
  } catch {
    if (request === schoolRequest) { approvalsSection.hidden = false; approvalsStatus.textContent = 'Could not load approval requests.'; }
  }
}
approvalsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!viewOnly || !academic) return;
  const data = approvalData(approvalsForm, { uid: schoolUid, name: 'Principal' });
  if (!data) { approvalsStatus.textContent = 'Write what the request is for.'; return; }
  try {
    const { doc, setDoc } = firestoreTools;
    await setDoc(doc(academic.schoolRef, 'approvalRequests', newId('AR')), data);
    approvalsForm.reset();
    await loadApprovals(schoolRequest);
    approvalsStatus.textContent = 'Request sent to the owner.';
  } catch (error) { approvalsStatus.textContent = 'Could not send the request (' + (error?.code ?? 'error') + ').'; }
});

// The teacher's side: ask, and see the answer.
const teacherRequestsForm = document.querySelector('#teacher-requests-form');
const teacherRequestsList = document.querySelector('#teacher-requests-list');
const teacherRequestsStatus = document.querySelector('#teacher-requests-status');
let teacherRequestsContext = null;
async function loadTeacherRequests(request, schoolRef, user) {
  teacherRequestsContext = { schoolRef, uid: user.uid, name: user.displayName || (user.email ? user.email.split('@')[0] : 'Teacher') };
  try {
    const { collection, query, where, getDocsFromServer } = firestoreTools;
    const found = await getDocsFromServer(query(collection(schoolRef, 'approvalRequests'), where('requestedBy', '==', user.uid)));
    if (request !== schoolRequest) return;
    teacherRequestsList.replaceChildren();
    const rows = found.docs.map((record) => ({ id: record.id, data: record.data() })).sort((a, b) => b.data.createdOn.localeCompare(a.data.createdOn));
    for (const row of rows) {
      let withdraw;
      if (row.data.status === 'pending') {
        withdraw = document.createElement('button');
        withdraw.type = 'button';
        withdraw.textContent = 'Withdraw';
        withdraw.addEventListener('click', async () => {
          try {
            const { doc, deleteDoc } = firestoreTools;
            await deleteDoc(doc(schoolRef, 'approvalRequests', row.id));
            await loadTeacherRequests(schoolRequest, schoolRef, user);
          } catch { teacherRequestsStatus.textContent = 'Could not withdraw the request.'; }
        });
      }
      listItem(teacherRequestsList, approvalLine(row.data), withdraw);
    }
    teacherRequestsStatus.textContent = rows.length ? '' : 'You have not asked for anything yet.';
  } catch {
    if (request === schoolRequest) teacherRequestsStatus.textContent = 'Could not load your requests.';
  }
}
teacherRequestsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = teacherRequestsContext;
  if (!context) return;
  const data = approvalData(teacherRequestsForm, { uid: context.uid, name: context.name });
  if (!data) { teacherRequestsStatus.textContent = 'Write what the request is for.'; return; }
  try {
    const { doc, setDoc } = firestoreTools;
    await setDoc(doc(context.schoolRef, 'approvalRequests', newId('AR')), data);
    teacherRequestsForm.reset();
    await loadTeacherRequests(schoolRequest, context.schoolRef, { uid: context.uid, displayName: context.name });
    teacherRequestsStatus.textContent = 'Request sent to the owner.';
  } catch (error) { teacherRequestsStatus.textContent = 'Could not send the request (' + (error?.code ?? 'error') + ').'; }
});

// ---------- Batch 70 ----------
// Biggest files (features 127, 157): the files using the most storage, so the owner knows what to delete.
const biggestList = document.querySelector('#storage-biggest');
async function drawBiggest() {
  if (!academic) return;
  const request = schoolRequest;
  try {
    const [docs, books] = await Promise.all([academic.list('staffDocuments'), academic.list('eBooks')]);
    if (request !== schoolRequest) return;
    const rows = [
      ...docs.docs.map((record) => ({ kb: record.data().sizeKb ?? 0, text: 'Staff document: ' + record.data().staffName + ' - ' + record.data().title })),
      ...books.docs.map((record) => ({ kb: record.data().sizeKb ?? 0, text: 'E-book: ' + record.data().title })),
      ...(lists.storage?.items ?? []).map((record) => ({ kb: record.data().sizeKb ?? 0, text: 'Record: ' + record.data().name })),
    ].filter((row) => row.kb > 0).sort((a, b) => b.kb - a.kb).slice(0, 8);
    biggestList.replaceChildren();
    for (const row of rows) listItem(biggestList, row.text + ' - ' + (row.kb >= 1024 ? (row.kb / 1024).toFixed(1) + ' MB' : row.kb + ' KB'));
    if (!rows.length) listItem(biggestList, 'No files yet.');
  } catch { if (request === schoolRequest) { biggestList.replaceChildren(); listItem(biggestList, 'Could not load the file list.'); } }
}
document.querySelector('#storage').addEventListener('mod-open', drawBiggest);
