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
  const className = fields.get('className').trim();
  const subject = fields.get('subject').trim();
  if (!className || !subject) {
    assignmentStatus.textContent = 'Enter a class and subject.';
    return;
  }
  assignmentButton.disabled = true;
  assignmentStatus.textContent = 'Saving assignment.';
  try {
    await saveAssignment(uid, { className, subject });
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
    const [years, classes, sections, subjects, mappings] = await Promise.all(
      ['academicYears', 'classes', 'sections', 'subjects', 'classSubjects'].map((name) => tools.list(name)),
    );
    if (request !== schoolRequest) return;
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

async function runSetupAction(action, done) {
  if (!academic || academic.busy) return;
  const tools = academic;
  const request = schoolRequest;
  tools.busy = true;
  academicStatus.textContent = 'Saving.';
  try {
    if (await action() === false) {
      if (request === schoolRequest) academicStatus.textContent = '';
      return;
    }
    if (request !== schoolRequest) return;
    academicStatus.textContent = done;
    await loadAcademic(request);
    if (request === schoolRequest) academicStatus.textContent = done;
  } catch (error) {
    if (request === schoolRequest) academicStatus.textContent = error.code === 'permission-denied'
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

onAuthStateChanged(auth, async (user) => {
  const request = ++schoolRequest;
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
    const { addDoc, collection, doc, getDocFromServer, getDocsFromServer, getFirestore, setDoc, updateDoc, writeBatch } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    if (request !== schoolRequest) return;
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
          const { className, subject } = assignment.data();
          saveMark = (mark) => setDoc(doc(assignment.ref, 'marks', mark.exam + '_' + mark.roll), {
            ...mark, className, subject,
          });
          marksForm.hidden = false;
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
      // A year becomes active in one batch with the pointer the rules check.
      activate: (id, year) => {
        const batch = writeBatch(firestore);
        batch.set(doc(schoolRef, 'academicYears', id), { ...year, status: 'active' });
        batch.set(doc(schoolRef, 'settings', 'academic'), { activeYearId: id });
        return batch.commit();
      },
      close: (id) => updateDoc(doc(schoolRef, 'academicYears', id), { status: 'closed' }),
    };
    academicSection.hidden = false;
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

