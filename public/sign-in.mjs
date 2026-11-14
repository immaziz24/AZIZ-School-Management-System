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
const schoolName = document.querySelector('#school-name');
const ownerEmail = document.querySelector('#owner-email');
let schoolRequest = 0;

onAuthStateChanged(auth, async (user) => {
  const request = ++schoolRequest;
  dashboard.hidden = true;
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
    const { doc, getDocFromServer, getFirestore } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    if (request !== schoolRequest) return;
    const school = await getDocFromServer(doc(getFirestore(app), 'schools', 'abcd-school'));
    if (request !== schoolRequest) return;
    if (!school.exists()) {
      schoolStatus.textContent = 'The school record was not found.';
      return;
    }
    schoolName.textContent = school.data().name;
    ownerEmail.textContent = user.email;
    dashboard.hidden = false;
    status.hidden = true;
    schoolStatus.hidden = true;
  } catch (error) {
    if (request !== schoolRequest) return;
    schoolStatus.textContent = error.code === 'permission-denied'
      ? 'School access has not been granted to this account.'
      : 'School access could not be checked. Refresh to try again.';
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

