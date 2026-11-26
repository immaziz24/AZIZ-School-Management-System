// Tuition and coaching dashboard shell (Phase 1). It finds which institution this account may open, shows the right portal and
// the restricted screen for a suspended account. The records themselves are read through server functions only.
import { app } from './firebase-client.mjs';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
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
  coaching: ['Dashboard', 'Students', 'Teachers', 'Batches', 'Fees', 'Attendance', 'Timetable', 'Examinations', 'Announcements', 'Reports', 'Settings'],
};
const CHECKLIST = {
  tuition: ['Add your first student', 'Create a batch', 'Set monthly fees'],
  coaching: ['Create a batch', 'Add teachers', 'Invite teachers', 'Add students', 'Configure fees'],
};
const pathType = location.pathname.replace(/^\/|\/$/g, '');
let current = 'Dashboard';
let list = [];
let chosen = 0;

function signInPanel(note = '') {
  root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Sign in'), h('p', { style: 'color:var(--mut)' }, 'Use the email and password you registered with.'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const msg = e.target.querySelector('.err'); msg.textContent = 'Signing in.';
      try { await signInWithEmailAndPassword(auth, String(f.get('email')).trim(), String(f.get('password'))); }
      catch { msg.textContent = 'That email or password is not right.'; } } },
      h('label', {}, 'Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
      h('label', {}, 'Password', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
      h('p', { class: 'err', role: 'alert' }, note), h('button', { class: 'gold', type: 'submit' }, 'Sign in')),
    h('p', { style: 'color:var(--mut)' }, 'New here? ', h('a', { href: '/register' }, 'Register free'), '. School staff sign in at ', h('a', { href: '/app' }, '/app'), '.')));
}

function restricted(inst) {
  root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Account restricted'),
    h('p', {}, (inst.name || 'This account') + ' is currently suspended, so changes are switched off. Your records are safe and nothing has been deleted.'),
    h('p', { style: 'color:var(--mut)' }, 'Write to support@azizschoolmanagementsystem.com to ask about reactivation or to export your data.'),
    h('button', { onclick: () => signOut(auth) }, 'Sign out')));
}

function usageCard(label, used, limit) { return h('div', { class: 'card' }, h('small', {}, label), h('b', {}, used + ' / ' + limit)); }

function render() {
  const inst = list[chosen];
  const nav = NAV[inst.type];
  const layout = h('div', { class: 'layout' });
  const side = h('nav', { class: 'side', 'aria-label': 'Sections' }, nav.map((n) => h('button', { type: 'button', ...(n === current ? { 'aria-current': 'page' } : {}), onclick: () => { current = n; render(); } }, n)));
  const body = h('main', {});
  if (current === 'Dashboard') {
    const l = inst.limits || {}; const u = inst.usage || {};
    body.append(h('h1', {}, inst.name), h('p', { style: 'color:var(--mut)' }, (inst.type === 'coaching' ? 'Coaching centre' : 'Tuition') + ' · Free plan · AZIZ branding on receipts'),
      h('div', { class: 'grid' },
        usageCard('Active students', u.activeStudents ?? 0, l.activeStudents ?? 0), usageCard('Batches', u.batches ?? 0, l.batches ?? 0),
        ...(inst.type === 'coaching' ? [usageCard('Extra teachers', u.extraTeachers ?? 0, l.extraTeachers ?? 0)] : []),
        h('div', { class: 'card' }, h('small', {}, 'Expected fees'), h('b', {}, '₹0')), h('div', { class: 'card' }, h('small', {}, 'Collected'), h('b', {}, '₹0')), h('div', { class: 'card' }, h('small', {}, 'Pending'), h('b', {}, '₹0'))),
      h('h2', {}, 'Quick actions'),
      h('div', { style: 'display:flex;gap:.7rem;flex-wrap:wrap' }, ['Add student', 'Record payment', 'Mark attendance'].map((a) => h('button', { type: 'button', disabled: true, title: 'Coming in the next release' }, a))),
      h('h2', {}, 'Get started'), h('ol', { class: 'todo' }, CHECKLIST[inst.type].map((x) => h('li', {}, x))),
      h('p', { class: 'empty' }, 'Students, batches, fees and attendance are being switched on in the next releases. Your account and limits are ready.'));
  } else {
    body.append(h('h1', {}, current), h('p', { class: 'empty' }, 'Nothing here yet. This section opens in the next release.'));
  }
  const bar = h('header', { class: 'bar' }, h('div', { class: 'brand' }, h('i', {}, 'A'), h('span', {}, 'AZIZ'), h('span', { class: 'tag' }, inst.type)),
    h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' },
      list.length > 1 ? h('select', { 'aria-label': 'Switch institution', onchange: (e) => { chosen = Number(e.target.value); current = 'Dashboard'; render(); } }, list.map((x, i) => h('option', { value: i, selected: i === chosen ? true : undefined }, x.name))) : null,
      h('button', { type: 'button', onclick: () => signOut(auth) }, 'Sign out')));
  layout.append(side, body);
  root.replaceChildren(bar, layout);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { signInPanel(); return; }
  root.replaceChildren(h('div', { class: 'panel' }, h('p', {}, 'Loading.')));
  try {
    const r = await call('resolveMyInstitutions');
    list = r.institutions || [];
    if (!list.length) { root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'No account found'), h('p', {}, 'This email has no tuition or coaching account yet.'), h('a', { class: 'btn', href: '/register' }, 'Register free'), ' ', h('button', { onclick: () => signOut(auth) }, 'Sign out'))); return; }
    const match = list.findIndex((x) => x.type === pathType);
    if (match < 0) { location.replace('/' + list[0].type); return; }
    chosen = match;
    if (list[chosen].status !== 'active') { restricted(list[chosen]); return; }
    render();
  } catch { root.replaceChildren(h('div', { class: 'panel' }, h('h1', {}, 'Could not load'), h('p', {}, 'Check the internet and try again.'), h('button', { onclick: () => location.reload() }, 'Reload'))); }
});
