// Free Tuition & Coaching registration (Phase 1). The browser only collects and sends the form; the server checks everything, picks
// the plan and role, and writes the records. Passwords go to Firebase Authentication only: they are never saved in the browser
// storage or in the database.
import { app } from './firebase-client.mjs';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const auth = getAuth(app);
const call = async (name, data) => (await httpsCallable(getFunctions(app, 'asia-south1'), name)(data || {})).data;
const root = document.querySelector('#app');
const STORE = 'aziz-free-registration';
const CLASSES = ['Nursery', 'KG 1', 'KG 2', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12', 'College / Other'];
const SUBJECTS = ['English', 'Bengali', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Accountancy', 'Commerce', 'Economics', 'Reasoning', 'General Knowledge'];
const MODES = [['offline', 'Offline'], ['online', 'Online'], ['hybrid', 'Hybrid']];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 -]{6,17}$/;

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

// Field lists. Each step is a list of fields; the server repeats every check.
const FIELDS = {
  tuition: [
    { title: 'Account details', fields: [
      { key: 'fullName', label: 'Full name', type: 'text', req: true, min: 2 },
      { key: 'email', label: 'Email address', type: 'email', req: true, help: 'We send a link to confirm it.' },
      { key: 'mobile', label: 'Mobile number', type: 'tel', req: true, help: 'With country code, for example +91 98300 12345.' },
      { key: 'password', label: 'Password', type: 'password', req: true },
    ] },
    { title: 'Teaching profile', fields: [
      { key: 'tuitionName', label: 'Tuition name', type: 'text', help: 'Optional. Your name is used if you leave it empty.' },
      { key: 'locality', label: 'Address or locality', type: 'text', req: true, min: 3, help: 'Area or locality is enough. Do not enter a precise home address.' },
      { key: 'subjects', label: 'Subjects taught', type: 'multi', options: SUBJECTS, custom: true, req: true },
      { key: 'classes', label: 'Classes taught', type: 'multi', options: CLASSES, req: true },
      { key: 'teachingMode', label: 'Teaching mode', type: 'select', options: MODES, req: true },
      { key: 'termsAccepted', label: 'I accept the Terms and the Privacy policy', type: 'terms', req: true },
    ] },
  ],
  coaching: [
    { title: 'Account details', fields: [
      { key: 'centreName', label: 'Coaching centre name', type: 'text', req: true, min: 2 },
      { key: 'ownerName', label: 'Owner name', type: 'text', req: true, min: 2 },
      { key: 'email', label: 'Email address', type: 'email', req: true, help: 'We send a link to confirm it.' },
      { key: 'mobile', label: 'Mobile number', type: 'tel', req: true, help: 'With country code, for example +91 98300 12345.' },
      { key: 'password', label: 'Password', type: 'password', req: true },
    ] },
    { title: 'Centre profile', fields: [
      { key: 'address', label: 'Complete business address', type: 'text', req: true, min: 10 },
      { key: 'pin', label: 'PIN code', type: 'text', req: true, pattern: /^[1-9][0-9]{5}$/, msg: 'Enter a six-digit PIN code.' },
      { key: 'establishmentYear', label: 'Establishment year', type: 'number', help: 'Optional.' },
      { key: 'teacherEstimate', label: 'Number of teachers', type: 'number', help: 'Optional estimate. It does not change your limits.' },
      { key: 'studentEstimate', label: 'Number of students', type: 'number', help: 'Optional estimate. It does not change your limits.' },
    ] },
    { title: 'Academic setup', fields: [
      { key: 'classes', label: 'Classes offered', type: 'multi', options: CLASSES, req: true },
      { key: 'subjects', label: 'Subjects offered', type: 'multi', options: SUBJECTS, custom: true, req: true },
      { key: 'teachingMode', label: 'Teaching mode', type: 'select', options: MODES, req: true },
      { key: 'termsAccepted', label: 'I accept the Terms and the Privacy policy', type: 'terms', req: true },
    ] },
  ],
};
const PLAN_NOTE = {
  tuition: 'Free plan: 20 features, up to 100 active students, 10 batches, 10 MB of files, AZIZ branding on receipts.',
  coaching: 'Free plan: 30 features, up to 250 active students, 5 extra teachers, 20 batches, 50 MB of files, AZIZ branding on receipts.',
};

const S = { view: 'choose', type: '', step: 0, values: {}, password: '', errors: {}, busy: false, note: '', cool: 0 };

const saveValues = (uid) => { try { const v = { ...S.values }; delete v.password; localStorage.setItem(STORE, JSON.stringify({ uid, type: S.type, values: v })); } catch { /* storage may be blocked */ } };
const loadValues = (uid) => { try { const d = JSON.parse(localStorage.getItem(STORE) || 'null'); return d && d.uid === uid && ['tuition', 'coaching'].includes(d.type) ? d : null; } catch { return null; } };
const clearValues = () => { try { localStorage.removeItem(STORE); } catch { /* ignore */ } };

function fieldError(f, v) {
  const val = v[f.key];
  if (f.type === 'terms') return val === true ? '' : 'Accept the terms and privacy policy to continue.';
  if (f.type === 'multi') return (Array.isArray(val) && val.length) ? '' : 'Choose at least one.';
  const t = typeof val === 'string' ? val.trim() : (val ?? '');
  if (f.req && t === '') return f.label + ' is required.';
  if (t === '') return '';
  if (f.key === 'email' && !EMAIL.test(t)) return 'Enter a valid email address.';
  if (f.key === 'mobile' && !PHONE.test(t)) return 'Enter a mobile number with country code.';
  if (f.key === 'password' && String(t).length < 8) return 'Use at least 8 characters.';
  if (f.min && String(t).length < f.min) return f.label + ' is too short.';
  if (f.pattern && !f.pattern.test(String(t))) return f.msg || 'Check this value.';
  if (f.type === 'number' && (!Number.isInteger(Number(t)) || Number(t) < 0)) return 'Enter a whole number.';
  return '';
}

function draw() {
  root.replaceChildren();
  if (S.view === 'choose') return drawChoose();
  if (S.view === 'form') return drawForm();
  if (S.view === 'verify') return drawVerify();
  if (S.view === 'progress') return drawProgress();
}

function drawChoose() {
  const card = (type, tag, title, lines) => h('button', { type: 'button', class: 'card', onclick: () => { S.type = type; S.step = 0; S.values = { ...S.values }; S.view = 'form'; draw(); window.scrollTo({ top: 0 }); } },
    h('span', { class: 'tag' }, tag), h('h3', {}, title), h('p', {}, lines[0]), h('ul', {}, lines.slice(1).map((x) => h('li', {}, x))));
  root.append(
    h('p', { class: 'notice' }, 'Already registered? ', h('a', { href: '/app', style: 'text-decoration:underline' }, 'Sign in'), ' with your email. Schools should use ', h('a', { href: '/app#signup', style: 'text-decoration:underline' }, 'Start free trial'), '.'),
    h('div', { class: 'pick' },
      card('tuition', 'Free · 20 features', 'Tuition Teacher', ['For a teacher who runs their own tuition.', 'Students, batches and monthly fees', 'Partial payments and receipts', 'Attendance and monthly income summary']),
      card('coaching', 'Free · 30 features', 'Coaching Centre', ['Everything in Tuition, plus a team.', 'Teachers with their own logins', 'Batch-wise fees, timetable and attendance', 'Exams, marks and announcements'])));
}

function drawForm() {
  const steps = FIELDS[S.type];
  const step = steps[S.step];
  const last = S.step === steps.length - 1;
  const form = h('form', { class: 'card formcard', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } });
  form.append(h('ol', { class: 'steps-ind' }, steps.map((s, i) => h('li', { class: i === S.step ? 'on' : '', ...(i === S.step ? { 'aria-current': 'step' } : {}) }, (i + 1) + '. ' + s.title))));
  form.append(h('h3', {}, step.title));
  if (S.step === 0) form.append(h('p', { class: 'help' }, PLAN_NOTE[S.type]));
  for (const f of step.fields) form.append(fieldEl(f));
  form.append(h('p', { class: 'err', role: 'alert', id: 'form-err' }, S.note));
  form.append(h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn', onclick: back }, 'Back'),
    h('button', { type: 'submit', class: 'btn gold-bg', disabled: S.busy }, S.busy ? 'Please wait.' : (last ? 'Create free account' : 'Continue'))));
  root.append(form);
  form.querySelector('input,select')?.focus({ preventScroll: true });
}

function fieldEl(f) {
  const id = 'f-' + f.key;
  const err = h('p', { class: 'err', id: id + '-err', role: 'alert' }, S.errors[f.key] || '');
  const mark = f.req ? h('span', { class: 'req' }, ' *') : null;
  const help = f.help ? h('p', { class: 'help' }, f.help) : null;
  if (f.type === 'terms') {
    const box = h('input', { type: 'checkbox', id, checked: S.values[f.key] === true ? true : undefined, onchange: () => { S.values[f.key] = box.checked; } });
    return h('div', {}, h('label', { for: id, style: 'display:flex;gap:.6rem;align-items:flex-start;color:var(--ink)' }, box, h('span', {}, 'I accept the ', h('a', { href: '/terms', target: '_blank', rel: 'noopener', style: 'text-decoration:underline' }, 'Terms'), ' and the ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener', style: 'text-decoration:underline' }, 'Privacy policy'), '.')), err);
  }
  if (f.type === 'multi') {
    const chosen = new Set(Array.isArray(S.values[f.key]) ? S.values[f.key] : []);
    const sync = () => { S.values[f.key] = [...chosen]; };
    const boxes = f.options.map((o) => { const c = h('input', { type: 'checkbox', value: o, checked: chosen.has(o) ? true : undefined, onchange: () => { c.checked ? chosen.add(o) : chosen.delete(o); sync(); } }); return h('label', {}, c, o); });
    const extras = [...chosen].filter((x) => !f.options.includes(x));
    const other = f.custom ? h('input', { type: 'text', id: id + '-other', placeholder: 'Other subjects, separated by commas', value: extras.join(', '), 'aria-label': 'Other subjects', oninput: () => {
      for (const x of [...chosen]) if (!f.options.includes(x)) chosen.delete(x);
      other.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10).forEach((x) => chosen.add(x.slice(0, 40))); sync(); } }) : null;
    return h('div', { role: 'group', 'aria-labelledby': id + '-l' }, h('label', { id: id + '-l' }, f.label, mark), h('div', { class: 'checks' }, boxes), other, err);
  }
  if (f.type === 'select') {
    const sel = h('select', { id, onchange: () => { S.values[f.key] = sel.value; } }, h('option', { value: '' }, 'Choose'), f.options.map(([v, l]) => h('option', { value: v, selected: S.values[f.key] === v ? true : undefined }, l)));
    return h('div', {}, h('label', { for: id }, f.label, mark, sel), err);
  }
  if (f.type === 'password') {
    const input = h('input', { type: 'password', id, autocomplete: 'new-password', value: S.password, oninput: () => { S.password = input.value; } });
    const toggle = h('button', { type: 'button', class: 'btn', 'aria-label': 'Show or hide the password', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; toggle.textContent = input.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
    return h('div', {}, h('label', { for: id }, f.label, mark), h('div', { class: 'pwrow' }, input, toggle), h('p', { class: 'help' }, 'At least 8 characters. It is kept only by Firebase sign-in, never by AZIZ.'), err);
  }
  const input = h('input', { type: f.type === 'number' ? 'number' : f.type, id, value: S.values[f.key] ?? '', inputmode: f.type === 'number' ? 'numeric' : undefined, autocomplete: f.key === 'email' ? 'email' : f.key === 'mobile' ? 'tel' : 'off',
    oninput: () => { S.values[f.key] = input.value; } });
  return h('div', {}, h('label', { for: id }, f.label, mark, input), help, err);
}

function back() {
  S.note = ''; S.errors = {};
  if (S.step > 0) S.step -= 1; else { S.view = 'choose'; }
  draw();
}

async function next() {
  const steps = FIELDS[S.type];
  const step = steps[S.step];
  S.errors = {}; S.note = '';
  for (const f of step.fields) { const m = f.key === 'password' ? fieldError(f, { password: S.password }) : fieldError(f, S.values); if (m) S.errors[f.key] = m; }
  if (Object.keys(S.errors).length) { S.note = 'Please fix the highlighted fields.'; draw(); root.querySelector('.err:not(:empty)')?.scrollIntoView({ block: 'center' }); return; }
  if (S.step < steps.length - 1) { S.step += 1; draw(); return; }
  S.busy = true; draw();
  try { await createAccount(); } catch (error) { S.note = friendly(error); } finally { S.busy = false; }
  if (S.view === 'form') draw();
}

const friendly = (error) => {
  const code = String(error?.code || '');
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'An account with this email already exists. Enter its password to continue, or sign in at /app.';
  if (code.includes('weak-password')) return 'Choose a stronger password (at least 8 characters).';
  if (code.includes('network')) return 'No connection. Check the internet and try again.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a few minutes and try again.';
  if (code.includes('already-exists') || code.includes('failed-precondition') || code.includes('invalid-argument')) return error.message || 'Please check the form and try again.';
  return error?.message && !/internal/i.test(error.message) ? error.message : 'Something went wrong. Please try again.';
};

async function createAccount() {
  const email = String(S.values.email).trim().toLowerCase();
  let user;
  try { user = (await createUserWithEmailAndPassword(auth, email, S.password)).user; }
  catch (error) {
    if (error?.code === 'auth/email-already-in-use') user = (await signInWithEmailAndPassword(auth, email, S.password)).user;
    else throw error;
  }
  try { await updateProfile(user, { displayName: String(S.values.fullName || S.values.ownerName || '').slice(0, 80) }); } catch { /* the name is optional */ }
  S.password = '';
  saveValues(user.uid);
  await user.reload();
  if (user.emailVerified) { await provision(user); return; }
  S.view = 'verify'; draw();
  await sendVerification(user);
}

async function sendVerification(user) {
  S.note = ''; S.codeError = '';
  try {
    const r = await call('sendInstitutionVerification');
    if (r.status === 'verified') { await provision(user); return; }
    if (r.status === 'sent') S.note = 'We emailed a 6-digit code to ' + user.email + '. It works for 10 minutes. Check Spam too.';
    else if (r.status === 'wait') S.note = 'A code was just sent to ' + user.email + '. Please check your inbox and Spam. You can ask again in ' + (r.seconds || 60) + ' seconds.';
    else if (r.status === 'limit') S.note = 'Too many codes were requested. Please wait an hour, or write to support@azizschoolmanagementsystem.com.';
    else S.note = 'We could not send the email just now. Press "Send a new code" in a minute. If it keeps failing, write to support@azizschoolmanagementsystem.com.';
    S.cool = r.status === 'sent' ? 60 : Math.min(60, r.seconds || 30);
  } catch (error) { S.note = friendly(error); S.cool = 20; }
  draw();
  const timer = setInterval(() => { S.cool -= 1; if (S.cool <= 0) { clearInterval(timer); S.cool = 0; } const b = document.querySelector('#resend-code'); if (S.view !== 'verify' || !b) { clearInterval(timer); return; } b.disabled = S.cool > 0; b.textContent = S.cool > 0 ? 'Send a new code in ' + S.cool + 's' : 'Send a new code'; }, 1000);
}

async function checkCode(user, code) {
  S.busy = true; S.codeError = ''; draw();
  try {
    await call('verifyInstitutionOtp', { code });
    await user.reload(); await user.getIdToken(true);
    S.busy = false; await provision(auth.currentUser); return;
  } catch (error) { S.codeError = friendly(error); }
  S.busy = false; draw();
}

function drawVerify() {
  const user = auth.currentUser;
  const code = h('input', { name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', placeholder: '6-digit code', 'aria-label': 'Verification code', style: 'font-size:1.4rem;letter-spacing:.35em;text-align:center;max-width:14rem' });
  root.append(h('div', { class: 'card formcard' },
    h('h3', {}, 'Enter the code from your email'),
    h('p', {}, 'We sent a 6-digit code to ', h('b', {}, user?.email || 'your email address'), '. Type it here to confirm your email.'),
    S.note ? h('p', { class: 'notice' }, S.note) : null,
    h('form', { onsubmit: (e) => { e.preventDefault(); const v = code.value.trim(); if (!/^[0-9]{6}$/.test(v)) { S.codeError = 'Enter the 6-digit code.'; draw(); return; } checkCode(user, v); } },
      code, S.codeError ? h('p', { class: 'err', role: 'alert' }, S.codeError) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'btn gold-bg', disabled: S.busy }, S.busy ? 'Checking.' : 'Verify and continue'),
        h('button', { type: 'button', id: 'resend-code', class: 'btn', disabled: S.cool > 0 || S.busy, onclick: () => user && sendVerification(user) }, S.cool > 0 ? 'Send a new code in ' + S.cool + 's' : 'Send a new code'),
        h('button', { type: 'button', class: 'btn', onclick: async () => { await signOut(auth); clearValues(); S.view = 'choose'; S.values = {}; draw(); } }, 'Use a different email')))));
}

async function provision(user) {
  const saved = loadValues(user.uid);
  if (!saved) { S.view = 'choose'; S.note = ''; draw(); return; }
  S.type = saved.type; S.values = saved.values; S.view = 'progress'; S.note = ''; draw();
  try {
    await user.getIdToken(true);
    const r = await call('registerInstitution', { type: saved.type, values: saved.values });
    clearValues();
    S.view = 'progress'; S.note = 'done'; S.done = r.type; draw();
    setTimeout(() => { location.href = '/' + r.type; }, 900);
  } catch (error) {
    S.view = 'progress'; S.note = friendly(error); S.failed = true; draw();
  }
}

function drawProgress() {
  const done = S.note === 'done';
  root.append(h('div', { class: 'card formcard' },
    h('h3', {}, done ? 'Your free account is ready' : S.failed ? 'We could not finish setting up' : 'Setting up your account'),
    h('ul', { class: 'prog' }, h('li', { class: 'done' }, 'Email confirmed'), h('li', { class: done ? 'done' : S.failed ? '' : 'now' }, 'Creating your free account'), h('li', { class: done ? 'now' : '' }, 'Opening your dashboard')),
    S.failed ? h('p', { class: 'err', role: 'alert' }, S.note) : null,
    S.failed ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn gold-bg', onclick: () => { S.failed = false; provision(auth.currentUser); } }, 'Try again')) : null));
}

// Returning visitors: finish a half-done registration, or go straight to the dashboard.
onAuthStateChanged(auth, async (user) => {
  if (!user || S.busy || S.view === 'progress') { if (!user && S.view !== 'form') draw(); return; }
  try {
    await user.reload();
    const saved = loadValues(user.uid);
    if (user.emailVerified && saved) { await provision(user); return; }
    if (!user.emailVerified && saved) { S.type = saved.type; S.values = saved.values; S.view = 'verify'; draw(); sendVerification(user); return; }
    const mine = await call('resolveMyInstitutions');
    if (mine.institutions?.length) { location.replace('/' + mine.institutions[0].type); return; }
  } catch { /* stay on the first screen */ }
});
draw();
