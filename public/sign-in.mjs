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

onAuthStateChanged(auth, (user) => {
  form.hidden = Boolean(user);
  signOutButton.hidden = !user;
  status.textContent = user ? 'Signed in as ' + user.email : 'Sign in with your AZIZ account.';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  signInButton.disabled = true;
  status.textContent = 'Signing in…';
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
