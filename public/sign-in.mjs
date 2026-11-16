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

onAuthStateChanged(auth, async (user) => {
  const request = ++schoolRequest;
  dashboard.hidden = true;
  saveAssignment = undefined;
  assignmentForm.reset();
  assignmentStatus.textContent = '';
  assignmentSummary.textContent = '';
  assignmentButton.disabled = false;
  teacherDashboard.hidden = true;
  teacherEmail.textContent = '';
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
    const { addDoc, collection, doc, getDocFromServer, getDocsFromServer, getFirestore, setDoc, updateDoc } = await import(
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

