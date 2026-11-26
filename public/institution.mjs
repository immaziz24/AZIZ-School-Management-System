// Tuition and coaching dashboard shell (Phase 1). It finds which institution this account may open, shows the right portal and
// the restricted screen for a suspended account. The records themselves are read through server functions only.
import { app } from './firebase-client.mjs';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { mountTuition } from './tuition-ui.mjs?v=tc-9';
import { mountCoaching, coachingExtras } from './coaching-ui.mjs?v=tc-1';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const auth = getAuth(app);
const call = async (name, data) => (await httpsCallable(getFunctions(app, 'asia-south1'), name)(data || {})).data;
const root = document.querySelector('#root');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};
const NAV = {
  tuition: ['Dashboard', 'Students', 'Batches', 'Fees', 'Attendance', 'Reports', 'Settings'],
  coaching: ['Dashboard', 'Students', 'Teachers', 'Subjects', 'Batches', 'Fees', 'Attendance', 'Timetable', 'Examinations', 'Announcements', 'Reports', 'Settings'],
  teacher: ['Dashboard', 'Batches', 'Attendance', 'Timetable', 'Examinations', 'Announcements'],
};
const CHECKLIST = {
  tuition: ['Add your first student', 'Create a batch', 'Set monthly fees'],
  coaching: ['Create a batch', 'Add teachers', 'Invite teachers', 'Add students', 'Configure fees'],
};
const pathType = location.pathname.replace(/^\/|\/$/g, '');
let current = 'Dashboard';
let list = [];
let chosen = 0;
let joining = false;

function signInPanel(note = '') {
  root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Sign in'), h('p', { style: 'color:var(--mut)' }, 'Use the email and password you registered with.'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const msg = e.target.querySelector('.err'); msg.textContent = 'Signing in.';
      try { await signInWithEmailAndPassword(auth, String(f.get('email')).trim(), String(f.get('password'))); }
      catch { msg.textContent = 'That email or password is not right.'; } } },
      h('label', {}, 'Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
      h('label', {}, 'Password', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
      h('p', { class: 'err', role: 'alert' }, note), h('button', { class: 'gold', type: 'submit' }, 'Sign in')),
    h('p', { style: 'color:var(--mut)' }, 'New here? ', h('a', { href: '/register' }, 'Register free'), '. School staff sign in on their own school website.'),
    h('p', { style: 'color:var(--mut)' }, 'Teacher of a coaching centre? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); joinPanel(); } }, 'Create your login'), ' (use the email your centre added).'),
    h('p', {}, h('a', { href: '/' }, '← Back to home'))));
}

// A teacher the coaching owner invited creates a login here: account, email code, then the invite is accepted.
function joinPanel(note = '', view = 'form', email = '') {
  joining = true; const msgFor = (e) => (e?.code === 'auth/weak-password' ? 'Choose a password of at least 6 characters.' : e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential' ? 'That email already has a login, and the password is not the same.' : e?.message && !/^internal$/i.test(e.message) ? e.message.replace(/^.*?: /, '') : 'Something went wrong. Check the internet and try again.');
  const back = h('p', {}, h('a', { href: '#', onclick: async (e) => { e.preventDefault(); joining = false; if (auth.currentUser) await signOut(auth); signInPanel(); } }, '← Back to sign in'));
  if (view === 'form') {
    root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Teacher login'), h('p', { style: 'color:var(--mut)' }, 'Use the same email address your centre added for you. Choose a password for yourself.'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); const f = new FormData(e.target); const msg = e.target.querySelector('.err'); msg.textContent = 'Please wait.'; const mail = String(f.get('email')).trim().toLowerCase();
        try {
          let user; try { user = (await createUserWithEmailAndPassword(auth, mail, String(f.get('password')))).user; } catch (er) { if (er?.code === 'auth/email-already-in-use') user = (await signInWithEmailAndPassword(auth, mail, String(f.get('password')))).user; else throw er; }
          try { await updateProfile(user, { displayName: String(f.get('name') || '').slice(0, 80) }); } catch { /* optional */ }
          await user.reload(); if (user.emailVerified) { await finishJoin(); return; }
          joinPanel('', 'verify', mail); await sendCode(true);
        } catch (er) { msg.textContent = msgFor(er); } } },
        h('label', {}, 'Your name', h('input', { name: 'name', type: 'text', maxlength: 80, autocomplete: 'name' })),
        h('label', {}, 'Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
        h('label', {}, 'Password', h('input', { name: 'password', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' })),
        h('p', { class: 'err', role: 'alert' }, note), h('button', { class: 'gold', type: 'submit' }, 'Continue')), back));
    return;
  }
  const code = h('input', { type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '6-digit code', 'aria-label': 'Verification code', style: 'font-size:1.4rem;letter-spacing:.35em;text-align:center;max-width:14rem' });
  root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Enter the code from your email'), h('p', {}, 'We sent a 6-digit code to ', h('b', {}, email), '. Check Spam too.'),
    h('form', { onsubmit: async (e) => { e.preventDefault(); const msg = e.target.querySelector('.err'); if (!/^[0-9]{6}$/.test(code.value.trim())) { msg.textContent = 'Enter the 6-digit code.'; return; } msg.textContent = 'Checking.';
      try { await call('verifyInstitutionOtp', { code: code.value.trim() }); await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); await finishJoin(); } catch (er) { msg.textContent = msgFor(er); } } },
      code, h('p', { class: 'err', role: 'alert' }, note), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Verify and continue'), h('button', { type: 'button', onclick: () => sendCode(false) }, 'Send a new code'))), back));
}
async function sendCode(first) {
  try { const r = await call('sendInstitutionVerification'); const msg = root.querySelector('.err');
    if (msg && !first) msg.textContent = r.status === 'sent' ? 'A new code was sent.' : r.status === 'wait' ? 'A code was just sent. You can ask again in ' + (r.seconds || 60) + ' seconds.' : r.status === 'limit' ? 'Too many codes were requested. Please wait an hour.' : 'We could not send the email just now. Try again in a minute.';
    else if (msg && r.status !== 'sent' && r.status !== 'wait') msg.textContent = 'We could not send the email just now. Press "Send a new code" in a minute.';
  } catch { const msg = root.querySelector('.err'); if (msg) msg.textContent = 'We could not send the email just now. Try again in a minute.'; }
}
async function finishJoin() {
  const r = await call('acceptTeacherInvite');
  if (!r.accepted) { joining = false; root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'No invitation found'), h('p', {}, 'This email has not been added as a teacher by any coaching centre. Ask the centre owner to add exactly this email address under Teachers.'), h('button', { onclick: async () => { await signOut(auth); location.reload(); } }, 'Sign out'))); return; }
  location.replace('/coaching');
}

function restricted(inst) {
  root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Account restricted'),
    h('p', {}, (inst.name || 'This account') + ' is currently suspended, so changes are switched off. Your records are safe and nothing has been deleted.'),
    h('p', { style: 'color:var(--mut)' }, 'Write to support@azizschoolmanagementsystem.com to ask about reactivation or to export your data.'),
    h('button', { onclick: () => signOut(auth) }, 'Sign out')));
}

function usageCard(label, used, limit) { return h('div', { class: 'card' }, h('small', {}, label), h('b', {}, used + ' / ' + limit)); }

function render(mode) {
  const inst = list[chosen];
  const isTeacher = inst.role === 'teacher'; const nav = isTeacher ? NAV.teacher : NAV[inst.type];
  const layout = h('div', { class: 'layout' });
  const side = h('nav', { class: 'side', 'aria-label': 'Sections' }, nav.map((n) => h('button', { type: 'button', ...(n === current ? { 'aria-current': 'page' } : {}), onclick: () => { current = n; render(); } }, n)));
  const body = h('main', {});
  body.append(h('h1', {}, current === 'Dashboard' ? inst.name : current));
  if (current === 'Dashboard') body.append(h('p', { style: 'color:var(--mut)' }, isTeacher ? 'Teacher · ' + inst.name : (inst.type === 'coaching' ? 'Coaching centre' : 'Tuition') + ' · Free plan · AZIZ branding on receipts'));
  const go = (to, mode) => { current = to; render(mode === 'add' ? 'Students+add' : undefined); };
  const args = { section: mode || current, inst, call, h, body, go };
  const handled = (inst.type === 'coaching' && mountCoaching(args)) || mountTuition(args);
  if (handled && inst.type === 'coaching' && !isTeacher) coachingExtras(args);
  if (!handled) body.append(h('p', { class: 'empty' }, 'This coaching section opens in the next release. Everything you need for students, fees and attendance is already available.'));
  const bar = h('header', { class: 'bar' }, h('div', { class: 'brand' }, h('i', {}, 'A'), h('span', {}, 'AZIZ'), h('span', { class: 'tag' }, inst.type)),
    h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' },
      list.length > 1 ? h('select', { 'aria-label': 'Switch institution', onchange: (e) => { chosen = Number(e.target.value); current = 'Dashboard'; render(); } }, list.map((x, i) => h('option', { value: i, selected: i === chosen ? true : undefined }, x.name))) : null,
      h('a', { class: 'btn', href: '/' }, 'Home'), h('button', { type: 'button', onclick: () => signOut(auth) }, 'Sign out')));
  layout.append(side, body);
  root.replaceChildren(bar, layout);
}

onAuthStateChanged(auth, async (user) => {
  if (joining) return;
  if (!user) { signInPanel(); return; }
  root.replaceChildren(h('div', { class: 'panel' }, h('p', {}, 'Loading.')));
  try {
    const r = await call('resolveMyInstitutions');
    list = r.institutions || [];
    if (!list.length && r.emailVerified) { try { const a = await call('acceptTeacherInvite'); if (a.accepted) { location.replace('/coaching'); return; } } catch { /* no invitation */ } }
    if (!list.length) { root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'No account found'), h('p', {}, 'This email has no tuition or coaching account yet.'), h('a', { class: 'btn', href: '/register' }, 'Register free'), ' ', h('button', { onclick: () => signOut(auth) }, 'Sign out'), h('p', {}, h('a', { href: '/' }, '← Back to home')))); return; }
    const match = list.findIndex((x) => x.type === pathType);
    if (match < 0) { location.replace('/' + list[0].type); return; }
    chosen = match;
    if (list[chosen].status !== 'active') { restricted(list[chosen]); return; }
    render();
  } catch { root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Could not load'), h('p', {}, 'Check the internet and try again.'), h('button', { onclick: () => location.reload() }, 'Reload'))); }
});
