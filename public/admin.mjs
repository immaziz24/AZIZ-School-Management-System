// Super Admin page (Batch 76, Mark 1). Platform administrators only: the database rules decide who may read or write, not this file.
// Every change writes a permanent entry to platformAudit in the same batch.
import { app } from './firebase-client.mjs';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, limit, documentId, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const S = { user: null, schools: [], plans: [], loaded: false, alerts: [], ownersCache: null };

// ---------- small helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const money = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
const num = (n) => (Number(n) || 0).toLocaleString('en-IN');
const newId = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const when = (t) => (t && t.toDate ? t.toDate().toLocaleString('en-IN') : '');
let toastTimer;
function toast(text) {
  const el = $('toast'); el.textContent = text; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}
function friendly(error) {
  const code = error && error.code ? String(error.code) : '';
  if (code.includes('permission-denied')) return 'The database rules did not allow that. If you just opened a school, your access pass may have expired.';
  if (code.includes('unavailable') || code.includes('network')) return 'The network is down. Check the connection and try again.';
  return (error && error.message) ? error.message : 'Something went wrong.';
}
async function guarded(fn) { try { return await fn(); } catch (error) { toast(friendly(error)); return undefined; } }
function loading(text) { return h('div', { class: 'empty' }, h('span', { class: 'spin' }), text || 'Loading.'); }
async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const index = next++; await worker(items[index], index); }
  }));
}

// A small modal form. Resolves with the values, or null when cancelled.
function formDialog({ title, note, fields, ok = 'Save' }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' });
    const form = h('form');
    const inputs = {};
    form.append(h('h3', {}, title));
    if (note) form.append(h('p', { class: 'muted' }, note));
    for (const f of fields) {
      let input;
      if (f.type === 'textarea') input = h('textarea', { rows: 3 });
      else if (f.type === 'select') input = h('select', {}, f.options.map(([value, text]) => h('option', { value }, text)));
      else input = h('input', { type: f.type || 'text' });
      if (f.value !== undefined) { if (f.type === 'checkbox') input.checked = Boolean(f.value); else input.value = f.value; }
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.readonly) input.readOnly = true;
      inputs[f.key] = input;
      form.append(f.type === 'checkbox' ? h('label', {}, input, f.label) : h('label', {}, f.label, input));
    }
    const err = h('p', { class: 'err' });
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    form.append(err, h('div', { class: 'row end' }, cancel, h('button', { type: 'submit', class: 'btn gold' }, ok)));
    const close = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(null));
    dlg.addEventListener('cancel', (event) => { event.preventDefault(); close(null); });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = {};
      for (const f of fields) {
        const el = inputs[f.key];
        let value = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (f.type === 'number') value = el.value === '' ? '' : Number(el.value);
        if (f.required && (value === '' || value === undefined)) { err.textContent = f.label + ' is required.'; return; }
        if (f.minLen && String(value).length < f.minLen) { err.textContent = f.label + ' needs at least ' + f.minLen + ' characters.'; return; }
        if (f.pattern && value !== '' && !f.pattern.test(value)) { err.textContent = f.patternText || (f.label + ' is not valid.'); return; }
        if (f.type === 'number' && value !== '' && (!Number.isInteger(value) || value < 0)) { err.textContent = f.label + ' must be a whole number, zero or more.'; return; }
        values[f.key] = value;
      }
      close(values);
    });
    dlg.append(form);
    document.body.append(dlg);
    dlg.showModal();
  });
}
const REASON = { key: 'reason', label: 'Reason (kept in the audit log)', type: 'textarea', required: true, minLen: 10, placeholder: 'Why are you doing this? At least 10 characters.' };

// One audit entry, added to a batch. Returns its id.
function audit(batch, action, schoolId, reason, detail, id = newId('A-')) {
  batch.set(doc(db, 'platformAudit', id), {
    actor: S.user.uid, actorEmail: S.user.email || '', action,
    ...(schoolId ? { schoolId } : {}), ...(reason ? { reason: String(reason).slice(0, 300) } : {}),
    ...(detail ? { detail: String(detail).slice(0, 1500) } : {}), at: serverTimestamp(),
  });
  return id;
}

// ---------- data ----------
async function loadSchools(force) {
  if (S.loaded && !force) return;
  const snap = await getDocsFromServer(collection(db, 'schools'));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data(), billing: null, usage: null, unpaid: [] }));
  await pool(list, 15, async (school) => {
    const [billing, usage, invoices] = await Promise.all([
      getDoc(doc(db, 'schools', school.id, 'billing', 'main')).catch(() => null),
      getDoc(doc(db, 'schools', school.id, 'usage', 'main')).catch(() => null),
      getDocs(query(collection(db, 'schools', school.id, 'invoices'), where('status', 'in', ['due', 'overdue']))).catch(() => null),
    ]);
    school.billing = billing && billing.exists() ? billing.data() : null;
    school.usage = usage && usage.exists() ? usage.data() : null;
    school.unpaid = invoices ? invoices.docs.map((d) => d.data()) : [];
  });
  S.schools = list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  S.loaded = true;
  S.invLoaded = false;
  S.ownersCache = null;
  buildAlerts();
  fillSwitcher();
}
async function loadPlans() {
  const snap = await getDocsFromServer(collection(db, 'plans'));
  S.plans = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.monthlyPrice - b.monthlyPrice);
}
const statusOf = (s) => (s.archived ? 'archived' : (s.billing && s.billing.status) || 'no plan');
const pillFor = (status) => h('span', { class: 'pill ' + (status === 'active' ? 'ok' : status === 'trial' ? 'warn' : ['suspended', 'cancelled', 'archived'].includes(status) ? 'bad' : '') }, status);

function buildAlerts() {
  const alerts = [];
  const now = Date.now();
  for (const s of S.schools) {
    const b = s.billing || {};
    const overdue = s.unpaid.filter((i) => i.status === 'overdue');
    if (overdue.length) alerts.push({ level: 'bad', school: s, text: overdue.length + ' overdue invoice(s), ' + money(overdue.reduce((t, i) => t + (Number(i.amount) || 0), 0)) });
    if (['suspended', 'cancelled'].includes(b.status) && !s.archived) alerts.push({ level: 'bad', school: s, text: 'School is ' + b.status });
    if (b.status === 'trial' && b.trialEnds && b.trialEnds.toMillis) {
      const days = Math.ceil((b.trialEnds.toMillis() - now) / 86400000);
      if (days <= 7) alerts.push({ level: 'warn', school: s, text: days < 0 ? 'Trial ended ' + (-days) + ' day(s) ago' : 'Trial ends in ' + days + ' day(s)' });
    }
    if (b.storageMb && s.usage && s.usage.storageMb && s.usage.storageMb / b.storageMb >= 0.9) alerts.push({ level: 'warn', school: s, text: 'Storage is at ' + Math.round(s.usage.storageMb / b.storageMb * 100) + '% of its limit' });
    if (b.studentLimit && s.usage && s.usage.students && s.usage.students / b.studentLimit >= 0.9) alerts.push({ level: 'warn', school: s, text: 'Students are at ' + Math.round(s.usage.students / b.studentLimit * 100) + '% of the plan limit' });
  }
  S.alerts = alerts;
  const bell = $('bellN'); bell.textContent = alerts.length; bell.hidden = alerts.length === 0;
}
function fillSwitcher() {
  const select = $('switcher');
  select.replaceChildren(h('option', { value: '' }, 'Switch school'), S.schools.slice(0, 500).map((s) => h('option', { value: s.id }, s.name)));
}

// ---------- views ----------
const view = () => $('view');
function setCrumbs(...parts) {
  const el = $('crumbs'); el.replaceChildren('Super Admin');
  parts.forEach((part, index) => { el.append(' / ', index === parts.length - 1 ? h('b', {}, part) : part); });
}
function stat(label, value, hint) { return h('div', { class: 'card stat' }, h('b', {}, value), h('span', {}, label), hint ? h('div', { class: 'muted', style: 'font-size:.78rem' }, hint) : null); }

async function viewDashboard() {
  setCrumbs('Dashboard');
  view().replaceChildren(loading('Loading schools and billing.'));
  await loadSchools();
  const count = (status) => S.schools.filter((s) => !s.archived && statusOf(s) === status).length;
  const students = S.schools.reduce((t, s) => t + (s.usage ? Number(s.usage.students) || 0 : 0), 0);
  const staff = S.schools.reduce((t, s) => t + (s.usage ? Number(s.usage.staff) || 0 : 0), 0);
  const mrr = S.schools.reduce((t, s) => t + (!s.archived && s.billing && s.billing.status === 'active' ? Number(s.billing.monthlyPrice) || 0 : 0), 0);
  const outstanding = S.schools.reduce((t, s) => t + s.unpaid.reduce((a, i) => a + (Number(i.amount) || 0), 0), 0);
  const overdueN = S.schools.reduce((t, s) => t + s.unpaid.filter((i) => i.status === 'overdue').length, 0);
  const suspended = count('suspended') + count('cancelled');
  view().replaceChildren(
    h('h2', {}, 'Command dashboard'),
    h('p', { class: 'muted' }, 'Live numbers from every registered school.'),
    h('div', { class: 'grid' },
      stat('Total schools', num(S.schools.length)),
      stat('Active schools', num(count('active'))),
      stat('Trial schools', num(count('trial'))),
      stat('Suspended or cancelled', num(suspended)),
      stat('Archived', num(S.schools.filter((s) => s.archived).length)),
      stat('Students', num(students), 'from each school\'s usage record'),
      stat('Teachers and staff', num(staff), 'staff profiles, teachers included'),
      stat('Monthly recurring revenue', money(mrr), 'active schools, monthly price'),
      stat('Outstanding payments', money(outstanding), overdueN + ' overdue invoice(s)'),
      stat('Alerts', num(S.alerts.length))),
    h('div', { class: 'card' }, h('h3', {}, 'Alerts'),
      S.alerts.length ? S.alerts.slice(0, 50).map((a) => h('div', { class: 'alert' }, h('span', { class: 'pill ' + a.level }, a.level === 'bad' ? 'Act' : 'Watch'),
        h('a', { href: '#/school/' + a.school.id }, a.school.name), h('span', { class: 'muted' }, a.text))) : h('div', { class: 'empty' }, 'No alerts. Every school looks healthy.')));
}

async function viewSchools() {
  setCrumbs('All schools');
  view().replaceChildren(loading('Loading schools.'));
  await loadSchools();
  const searchBox = h('input', { type: 'search', placeholder: 'Search by name, school ID or contact email' });
  const filter = h('select', {}, [['', 'All statuses'], ['active', 'Active'], ['trial', 'Trial'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled'], ['archived', 'Archived']].map(([v, t]) => h('option', { value: v }, t)));
  const body = h('tbody');
  const draw = () => {
    const words = searchBox.value.trim().toLowerCase();
    const rows = S.schools.filter((s) => (!filter.value || statusOf(s) === filter.value)
      && (!words || [s.name, s.id, s.contactEmail].some((v) => String(v || '').toLowerCase().includes(words))));
    body.replaceChildren(...rows.slice(0, 300).map((s) => h('tr', { class: 'click', onclick: () => { location.hash = '#/school/' + s.id; } },
      h('td', {}, h('b', {}, s.name), h('div', { class: 'muted' }, s.id)),
      h('td', {}, s.billing ? s.billing.plan : '-'), h('td', {}, pillFor(statusOf(s))),
      h('td', {}, s.usage ? num(s.usage.students) : '-'), h('td', {}, s.usage ? num(s.usage.staff) : '-'),
      h('td', {}, s.contactEmail || '-'))));
    if (!rows.length) body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, h('div', { class: 'empty' }, S.schools.length ? 'No school matches.' : 'No schools yet. Register the first one.'))));
  };
  searchBox.addEventListener('input', draw); filter.addEventListener('change', draw);
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'All schools (' + S.schools.length + ')'), h('button', { class: 'btn gold', onclick: () => guarded(registerSchool) }, 'Register a school')),
    h('div', { class: 'row' }, searchBox, filter),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['School', 'Plan', 'Status', 'Students', 'Staff', 'Contact'].map((t) => h('th', {}, t)))), body)),
    S.schools.length > 300 ? h('p', { class: 'muted' }, 'Showing the first 300 matches. Use the search to narrow it.') : null);
  draw();
}

async function registerSchool() {
  await loadPlans();
  const planOptions = [['trial', 'Free 30-day trial']].concat(S.plans.filter((p) => p.active).map((p) => [p.id, p.name + ' (' + money(p.monthlyPrice) + '/month)']));
  const v = await formDialog({
    title: 'Register a school',
    note: 'Creates the school and a pending owner invitation. The owner signs in with this email, verifies it and accepts the invitation.',
    ok: 'Register school',
    fields: [
      { key: 'id', label: 'School ID (lowercase letters, numbers, dashes; 3 to 30)', required: true, pattern: /^[a-z][a-z0-9-]{2,29}$/, patternText: 'Use 3 to 30 lowercase letters, numbers or dashes, starting with a letter.' },
      { key: 'name', label: 'School name', required: true },
      { key: 'ownerEmail', label: 'Owner email', type: 'email', required: true, pattern: /^[^@\sA-Z]+@[^@\sA-Z]+$/, patternText: 'Use a lowercase email address.' },
      { key: 'contactEmail', label: 'School contact email (optional)', type: 'email' },
      { key: 'phone', label: 'Phone (optional)' },
      { key: 'address', label: 'Address (optional)' },
      { key: 'plan', label: 'Plan', type: 'select', options: planOptions },
      REASON,
    ],
  });
  if (!v) return;
  if (['www', 'admin', 'api', 'app', 'platform', 'school', 'aziz', 'public', 'support', 'demo'].includes(v.id)) { toast('That school ID is reserved.'); return; }
  const taken = await getDocFromServer(doc(db, 'schools', v.id)).then((d) => d.exists());
  if (taken) { toast('That school ID is already used.'); return; }
  const plan = S.plans.find((p) => p.id === v.plan);
  const batch = writeBatch(db);
  batch.set(doc(db, 'schools', v.id), { name: v.name, contactEmail: v.contactEmail || '', phone: v.phone || '', address: v.address || '', createdBy: S.user.uid });
  const billing = plan
    ? { plan: plan.id, status: 'active', startedOn: today(), studentLimit: plan.studentLimit, staffLimit: plan.staffLimit, storageMb: plan.storageMb, monthlyPrice: plan.monthlyPrice }
    : { plan: 'trial', status: 'trial', trialEnds: Timestamp.fromMillis(Date.now() + 30 * 86400000), studentLimit: 50, staffLimit: 10 };
  batch.set(doc(db, 'schools', v.id, 'billing', 'main'), billing);
  batch.set(doc(db, 'invites', newId('OW-')), { schoolId: v.id, email: v.ownerEmail, role: 'owner', status: 'pending', createdBy: S.user.uid });
  audit(batch, 'register-school', v.id, v.reason, JSON.stringify({ name: v.name, owner: v.ownerEmail, plan: billing.plan }));
  await batch.commit();
  toast('School registered. Tell the owner to sign in at /app with ' + v.ownerEmail + ' and accept the invitation.');
  await loadSchools(true);
  location.hash = '#/school/' + v.id;
}

async function viewSchool(id) {
  view().replaceChildren(loading('Loading school.'));
  await Promise.all([loadSchools(), loadPlans()]);
  const school = S.schools.find((s) => s.id === id);
  if (!school) { setCrumbs('All schools'); view().replaceChildren(h('div', { class: 'empty' }, 'School not found.')); return; }
  setCrumbs(h('a', { href: '#/schools' }, 'All schools'), school.name);
  const b = school.billing || {};
  const owners = await loadOwnersOf(school.id);
  const refresh = async () => { await loadSchools(true); await viewSchool(id); };

  const profile = h('div', { class: 'card' }, h('h3', {}, 'Profile'),
    h('p', {}, h('b', {}, school.name), ' ', pillFor(statusOf(school))),
    h('p', { class: 'muted' }, 'ID: ' + school.id + ' | ' + (school.contactEmail || 'no contact email') + ' | ' + (school.phone || 'no phone')),
    h('p', { class: 'muted' }, school.address || 'No address'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => guarded(async () => { if (await editSchool(school)) await refresh(); }) }, 'Edit profile'),
      h('button', { class: 'btn gold', onclick: () => guarded(() => openSchoolAccess(school)) }, 'Open school administration')));

  const planCard = h('div', { class: 'card' }, h('h3', {}, 'Subscription and status'),
    h('p', {}, 'Plan: ', h('b', {}, b.plan || 'none'), ' | ', money(b.monthlyPrice), '/month'),
    h('p', { class: 'muted' }, 'Limits: ' + num(b.studentLimit) + ' students, ' + num(b.staffLimit) + ' staff, ' + num(b.storageMb) + ' MB storage'),
    b.trialEnds && b.trialEnds.toDate ? h('p', { class: 'muted' }, 'Trial ends ' + b.trialEnds.toDate().toLocaleDateString('en-IN')) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => guarded(async () => { if (await applyPlan(school)) await refresh(); }) }, 'Change plan'),
      statusOf(school) === 'active' ? null : h('button', { class: 'btn', onclick: () => guarded(async () => { if (await setStatus(school, 'active')) await refresh(); }) }, 'Activate'),
      ['active', 'trial'].includes(statusOf(school)) ? h('button', { class: 'btn red', onclick: () => guarded(async () => { if (await setStatus(school, 'suspended')) await refresh(); }) }, 'Suspend') : null,
      school.archived ? null : h('button', { class: 'btn red', onclick: () => guarded(async () => { if (await archiveSchool(school)) await refresh(); }) }, 'Archive')),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await assignSubdomain(school)) await refresh(); }) }, 'Assign subdomain'),
      h('a', { class: 'btn sm', href: '/school?school=' + encodeURIComponent(school.id), target: '_blank', rel: 'noopener' }, 'Preview public site'),
      h('button', { class: 'btn sm ' + (school.siteHold ? '' : 'red'), onclick: () => guarded(async () => { if (await setSiteHold(school, !school.siteHold)) await refresh(); }) }, school.siteHold ? 'Put website online' : 'Take website offline')));

  const usage = school.usage || {};
  const usageCard = h('div', { class: 'card' }, h('h3', {}, 'Usage'),
    h('p', {}, num(usage.students) + ' students | ' + num(usage.staff) + ' staff | ' + num(usage.storageMb) + ' MB stored'),
    h('p', { class: 'muted' }, school.unpaid.length ? school.unpaid.length + ' unpaid invoice(s), ' + money(school.unpaid.reduce((t, i) => t + (Number(i.amount) || 0), 0)) : 'No unpaid invoices.'));

  const ownerRows = owners.map((o) => h('tr', {},
    h('td', {}, o.email || h('span', { class: 'muted' }, 'Signed up directly (' + o.uid.slice(0, 8) + '...)')),
    h('td', {}, o.kind === 'invite' ? h('span', { class: 'pill warn' }, 'Invitation pending') : h('span', { class: 'pill ' + (o.active ? 'ok' : 'bad') }, o.active ? 'Active owner' : 'Deactivated')),
    h('td', { class: 'muted' }, o.lastLogin ? when(o.lastLogin) : '-'),
    h('td', {}, h('div', { class: 'row' },
      o.kind === 'invite' ? h('button', { class: 'btn sm red', onclick: () => guarded(async () => { if (await revokeInvite(school, o)) await refresh(); }) }, 'Revoke') : [
        h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await toggleOwner(school, o)) await refresh(); }) }, o.active ? 'Deactivate' : 'Activate'),
        o.email ? h('button', { class: 'btn sm', onclick: () => guarded(() => resetPassword(school, o)) }, 'Send password reset') : null]))));
  const ownersCard = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1' }, 'Owners'),
    h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await inviteOwner(school, false)) await refresh(); }) }, 'Invite owner'),
    h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await inviteOwner(school, true)) await refresh(); }) }, 'Transfer ownership')),
    owners.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Owner', 'Status', 'Last sign-in', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ownerRows)))
      : h('div', { class: 'empty' }, 'No owner yet. Invite one.'));

  await loadInvoices();
  const mine = (S.schools.find((x) => x.id === id).invoices || []).sort((a, c) => String(c.dueOn).localeCompare(String(a.dueOn))).map((inv) => ({ school, inv }));
  const invoicesCard = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1' }, 'Invoices'),
    h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await createInvoice(school)) await refresh(); }) }, 'Create invoice')),
    invoiceTable(mine, false, refresh));
  view().replaceChildren(h('h2', {}, school.name), h('div', { class: 'two' }, profile, planCard, usageCard), h('div', { style: 'height:14px' }), ownersCard, h('div', { style: 'height:14px' }), invoicesCard, h('div', { style: 'height:14px' }), await schoolFeaturesCard(school));
}

async function lastLogin(uid) {
  try {
    const snap = await getDocs(query(collection(db, 'loginHistory'), where(documentId(), '>=', uid + '_'), where(documentId(), '<=', uid + '_~'), limit(1)));
    const d = snap.docs[0];
    return d ? { at: d.data().at, email: d.data().email || '' } : null;
  } catch { return null; }
}
async function loadOwnersOf(schoolId) {
  const [members, invites] = await Promise.all([
    getDocs(query(collection(db, 'schools', schoolId, 'members'), where('role', '==', 'owner'))).catch(() => null),
    getDocs(query(collection(db, 'invites'), where('schoolId', '==', schoolId), where('role', '==', 'owner'))).catch(() => null),
  ]);
  const inviteList = invites ? invites.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const out = [];
  for (const m of members ? members.docs : []) {
    const data = m.data();
    const invite = data.inviteId ? inviteList.find((i) => i.id === data.inviteId) : null;
    const login = await lastLogin(m.id);
    out.push({ kind: 'member', uid: m.id, active: data.active === true, email: (invite && invite.email) || (login && login.email) || '', lastLogin: login ? login.at : null });
  }
  for (const i of inviteList) if (i.status === 'pending') out.push({ kind: 'invite', uid: i.id, id: i.id, email: i.email, active: false });
  return out;
}

async function editSchool(school) {
  const v = await formDialog({
    title: 'Edit school profile', ok: 'Save changes',
    fields: [
      { key: 'name', label: 'School name', required: true, value: school.name },
      { key: 'contactEmail', label: 'Contact email', type: 'email', value: school.contactEmail || '' },
      { key: 'phone', label: 'Phone', value: school.phone || '' },
      { key: 'address', label: 'Address', value: school.address || '' }, REASON],
  });
  if (!v) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', school.id), { name: v.name, contactEmail: v.contactEmail, phone: v.phone, address: v.address });
  audit(batch, 'edit-school', school.id, v.reason, JSON.stringify({ before: { name: school.name, contactEmail: school.contactEmail, phone: school.phone, address: school.address }, after: { name: v.name, contactEmail: v.contactEmail, phone: v.phone, address: v.address } }));
  await batch.commit();
  toast('School profile saved.');
  return true;
}

async function applyPlan(school) {
  if (!S.plans.length) { toast('Create a plan first (Plans and pricing).'); return false; }
  const v = await formDialog({
    title: 'Change plan for ' + school.name, ok: 'Apply plan',
    note: 'The school\'s student, staff and storage limits and monthly price are set from the plan.',
    fields: [{ key: 'plan', label: 'Plan', type: 'select', options: S.plans.filter((p) => p.active).map((p) => [p.id, p.name + ' (' + money(p.monthlyPrice) + '/month)']), value: school.billing ? school.billing.plan : undefined }, REASON],
  });
  if (!v) return false;
  const plan = S.plans.find((p) => p.id === v.plan);
  const fields = { plan: plan.id, studentLimit: plan.studentLimit, staffLimit: plan.staffLimit, storageMb: plan.storageMb, monthlyPrice: plan.monthlyPrice };
  if (!school.billing || school.billing.plan === 'trial' || !school.billing.startedOn) fields.startedOn = today();
  if (school.billing && school.billing.status === 'trial') fields.status = 'active';
  const batch = writeBatch(db);
  const ref = doc(db, 'schools', school.id, 'billing', 'main');
  if (school.billing) batch.update(ref, fields); else batch.set(ref, { ...fields, status: 'active' });
  audit(batch, 'change-plan', school.id, v.reason, JSON.stringify({ before: school.billing ? school.billing.plan : null, after: plan.id }));
  await batch.commit();
  try { await publishEntitlements([school], await loadCatalogue()); } catch { /* the plan change stands; Apply to all schools fixes it */ }
  toast('Plan applied.');
  return true;
}

async function setStatus(school, status) {
  const v = await formDialog({ title: (status === 'active' ? 'Activate ' : 'Suspend ') + school.name, ok: status === 'active' ? 'Activate' : 'Suspend',
    note: status === 'suspended' ? 'The school becomes read-only for its owner until you activate it again.' : '', fields: [REASON] });
  if (!v) return false;
  const batch = writeBatch(db);
  const ref = doc(db, 'schools', school.id, 'billing', 'main');
  if (school.billing) batch.update(ref, { status }); else batch.set(ref, { plan: 'trial', status, studentLimit: 50, staffLimit: 10 });
  if (status === 'active' && school.archived) batch.update(doc(db, 'schools', school.id), { archived: false, archivedOn: '' });
  audit(batch, status === 'active' ? 'activate-school' : 'suspend-school', school.id, v.reason, JSON.stringify({ before: statusOf(school), after: status }));
  await batch.commit();
  toast('School ' + (status === 'active' ? 'activated.' : 'suspended.'));
  return true;
}

async function archiveSchool(school) {
  const v = await formDialog({ title: 'Archive ' + school.name, ok: 'Archive school',
    note: 'The school is marked archived and becomes read-only. Nothing is deleted, and you can activate it again.', fields: [REASON] });
  if (!v) return false;
  if (!confirm('Archive ' + school.name + '? Its owner will no longer be able to change anything.')) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', school.id), { archived: true, archivedOn: today() });
  const ref = doc(db, 'schools', school.id, 'billing', 'main');
  if (school.billing) batch.update(ref, { status: 'cancelled' }); else batch.set(ref, { plan: 'trial', status: 'cancelled' });
  audit(batch, 'archive-school', school.id, v.reason, JSON.stringify({ before: statusOf(school), after: 'archived' }));
  await batch.commit();
  toast('School archived.');
  return true;
}

async function inviteOwner(school, transfer) {
  const v = await formDialog({
    title: transfer ? 'Transfer ownership of ' + school.name : 'Invite an owner to ' + school.name, ok: 'Send invitation',
    note: transfer ? 'The new owner signs in, verifies the email and accepts. After that, deactivate the previous owner here.' : 'The person signs in with this email, verifies it and accepts.',
    fields: [{ key: 'email', label: 'New owner email', type: 'email', required: true, pattern: /^[^@\sA-Z]+@[^@\sA-Z]+$/, patternText: 'Use a lowercase email address.' }, REASON],
  });
  if (!v) return false;
  const batch = writeBatch(db);
  batch.set(doc(db, 'invites', newId('OW-')), { schoolId: school.id, email: v.email, role: 'owner', status: 'pending', createdBy: S.user.uid });
  audit(batch, transfer ? 'transfer-ownership-invite' : 'invite-owner', school.id, v.reason, JSON.stringify({ email: v.email }));
  await batch.commit();
  toast('Invitation created for ' + v.email + '.');
  return true;
}

async function revokeInvite(school, owner) {
  const v = await formDialog({ title: 'Revoke the invitation for ' + owner.email, ok: 'Revoke', fields: [REASON] });
  if (!v) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, 'invites', owner.id), { status: 'revoked' });
  audit(batch, 'revoke-owner-invite', school.id, v.reason, JSON.stringify({ email: owner.email }));
  await batch.commit();
  toast('Invitation revoked.');
  return true;
}

async function toggleOwner(school, owner) {
  const next = !owner.active;
  const v = await formDialog({ title: (next ? 'Activate' : 'Deactivate') + ' owner ' + (owner.email || owner.uid.slice(0, 8)), ok: next ? 'Activate' : 'Deactivate',
    note: next ? '' : 'This owner can no longer use ' + school.name + '. Make sure another active owner exists first.', fields: [REASON] });
  if (!v) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', school.id, 'members', owner.uid), { active: next });
  audit(batch, next ? 'activate-owner' : 'deactivate-owner', school.id, v.reason, JSON.stringify({ owner: owner.uid, email: owner.email }));
  await batch.commit();
  toast('Owner ' + (next ? 'activated.' : 'deactivated.'));
  return true;
}

async function resetPassword(school, owner) {
  const v = await formDialog({ title: 'Send a password reset email to ' + owner.email, ok: 'Send email', fields: [REASON] });
  if (!v) return;
  await sendPasswordResetEmail(auth, owner.email);
  const batch = writeBatch(db);
  audit(batch, 'send-password-reset', school.id, v.reason, JSON.stringify({ email: owner.email }));
  await batch.commit();
  toast('Password reset email sent to ' + owner.email + '.');
}

// Open school administration: the reason and a 50-minute access pass are created together with the audit entry.
async function openSchoolAccess(school) {
  const v = await formDialog({
    title: 'Open school administration: ' + school.name, ok: 'Create access pass',
    note: 'You get a 50-minute, read-only pass for this school. Sensitive records (medical, identity, selfies, payroll, private family information) need a separate short pass inside the school view.',
    fields: [REASON],
  });
  if (!v) return;
  const batch = writeBatch(db);
  const auditId = audit(batch, 'open-school-standard', school.id, v.reason, 'read-only access pass, 50 minutes');
  batch.set(doc(db, 'platformGrants', S.user.uid + '_' + school.id + '_standard'), {
    schoolId: school.id, tier: 'standard', reason: v.reason, createdBy: S.user.uid, createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 50 * 60000), auditId,
  });
  await batch.commit();
  const link = h('a', { href: '/app?school=' + encodeURIComponent(school.id), target: '_blank', rel: 'noopener' }, 'Open ' + school.name + ' now');
  const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Access pass created'), h('p', {}, 'Valid for 50 minutes, read-only, and recorded in the audit log.'), h('p', {}, link),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  link.addEventListener('click', () => setTimeout(() => { dlg.close(); dlg.remove(); }, 200));
  document.body.append(dlg); dlg.showModal();
}

async function viewOwners() {
  setCrumbs('School owners');
  view().replaceChildren(loading('Loading every school\'s owners. This can take a moment.'));
  await loadSchools();
  if (!S.ownersCache) {
    const rows = [];
    await pool(S.schools, 10, async (school) => { for (const o of await loadOwnersOf(school.id)) rows.push({ ...o, school }); });
    S.ownersCache = rows;
  }
  const rows = S.ownersCache;
  const byUid = new Map();
  for (const r of rows) if (r.kind === 'member') byUid.set(r.uid, [...(byUid.get(r.uid) || []), r.school]);
  const searchBox = h('input', { type: 'search', placeholder: 'Search owner email or school' });
  const body = h('tbody');
  const draw = () => {
    const words = searchBox.value.trim().toLowerCase();
    const list = rows.filter((r) => !words || [r.email, r.school.name, r.school.id].some((v) => String(v || '').toLowerCase().includes(words)));
    body.replaceChildren(...list.slice(0, 400).map((r) => {
      const others = r.kind === 'member' ? (byUid.get(r.uid) || []).filter((s) => s.id !== r.school.id) : [];
      return h('tr', {},
        h('td', {}, r.email || h('span', { class: 'muted' }, 'Signed up directly (' + String(r.uid).slice(0, 8) + '...)')),
        h('td', {}, r.kind === 'invite' ? h('span', { class: 'pill warn' }, 'Invitation pending') : h('span', { class: 'pill ' + (r.active ? 'ok' : 'bad') }, r.active ? 'Active' : 'Deactivated')),
        h('td', {}, h('a', { href: '#/school/' + r.school.id }, r.school.name)),
        h('td', { class: 'muted' }, others.length ? 'Also owns: ' + others.map((s) => s.name).join(', ') : '-'),
        h('td', { class: 'muted' }, r.lastLogin ? when(r.lastLogin) : '-'));
    }));
    if (!list.length) body.replaceChildren(h('tr', {}, h('td', { colspan: 5 }, h('div', { class: 'empty' }, 'No owners match.'))));
  };
  searchBox.addEventListener('input', draw);
  view().replaceChildren(h('h2', {}, 'School owners (' + rows.length + ')'),
    h('p', { class: 'muted' }, 'Owners need a verified email to accept an invitation. Open a school to invite, transfer, deactivate or send a password reset.'),
    searchBox, h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Owner', 'Status', 'School', 'Relationships', 'Last sign-in'].map((t) => h('th', {}, t)))), body)));
  draw();
}

async function viewPlans() {
  setCrumbs('Plans and pricing');
  view().replaceChildren(loading('Loading plans.'));
  await loadPlans();
  const rows = S.plans.map((p) => h('tr', {},
    h('td', {}, h('b', {}, p.name), h('div', { class: 'muted' }, p.id), p.active ? null : h('span', { class: 'pill bad' }, 'Inactive')),
    h('td', {}, money(p.monthlyPrice)), h('td', {}, money(p.yearlyPrice)), h('td', {}, money(p.setupFee)),
    h('td', {}, num(p.studentLimit) + ' students, ' + num(p.staffLimit) + ' staff, ' + num(p.storageMb) + ' MB'),
    h('td', { class: 'muted' }, (p.features || []).join(', ') || '-'),
    h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await editPlan(p)) await viewPlans(); }) }, 'Edit'),
      h('button', { class: 'btn sm', onclick: () => guarded(() => showHistory(p)) }, 'Price history')))));
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Plans and pricing'), h('button', { class: 'btn gold', onclick: () => guarded(async () => { if (await editPlan(null)) await viewPlans(); }) }, 'Create a plan')),
    h('p', { class: 'muted' }, 'Prices are in rupees. Every price change is kept in the price history. Features are stored with the plan; switching features on and off per plan comes in a later batch.'),
    rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Plan', 'Monthly', 'Yearly', 'Setup fee', 'Limits', 'Features', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows)))
      : h('div', { class: 'empty' }, 'No plans yet. Create your first plan.'));
}

async function editPlan(plan) {
  const v = await formDialog({
    title: plan ? 'Edit plan ' + plan.name : 'Create a plan', ok: 'Save plan',
    fields: [
      { key: 'id', label: 'Plan ID (lowercase, fixed once created)', required: true, value: plan ? plan.id : '', readonly: Boolean(plan), pattern: /^[a-z][a-z0-9-]{1,29}$/, patternText: 'Use 2 to 30 lowercase letters, numbers or dashes.' },
      { key: 'name', label: 'Plan name', required: true, value: plan ? plan.name : '' },
      { key: 'monthlyPrice', label: 'Monthly price (Rs)', type: 'number', required: true, value: plan ? plan.monthlyPrice : 0 },
      { key: 'yearlyPrice', label: 'Yearly price (Rs)', type: 'number', required: true, value: plan ? plan.yearlyPrice : 0 },
      { key: 'setupFee', label: 'Setup fee (Rs)', type: 'number', required: true, value: plan ? plan.setupFee : 0 },
      { key: 'studentLimit', label: 'Student limit', type: 'number', required: true, value: plan ? plan.studentLimit : 100 },
      { key: 'staffLimit', label: 'Staff limit', type: 'number', required: true, value: plan ? plan.staffLimit : 20 },
      { key: 'storageMb', label: 'Storage limit (MB)', type: 'number', required: true, value: plan ? plan.storageMb : 1024 },
      { key: 'features', label: 'Features (comma separated)', value: plan ? (plan.features || []).join(', ') : '' },
      { key: 'active', label: 'Plan is available to schools', type: 'checkbox', value: plan ? plan.active : true },
      { key: 'note', label: 'Note for the price history (optional)' },
    ],
  });
  if (!v) return false;
  const features = v.features ? v.features.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 40) : [];
  const historyId = newId('H-');
  const batch = writeBatch(db);
  batch.set(doc(db, 'planHistory', historyId), { planId: v.id, by: S.user.uid, at: serverTimestamp(), monthlyPrice: v.monthlyPrice, yearlyPrice: v.yearlyPrice, setupFee: v.setupFee, ...(v.note ? { note: v.note.slice(0, 200) } : {}) });
  batch.set(doc(db, 'plans', v.id), { name: v.name, monthlyPrice: v.monthlyPrice, yearlyPrice: v.yearlyPrice, setupFee: v.setupFee, studentLimit: v.studentLimit, staffLimit: v.staffLimit, storageMb: v.storageMb, features, active: v.active, historyId });
  audit(batch, plan ? 'edit-plan' : 'create-plan', '', v.note || '', JSON.stringify({ plan: v.id, monthly: v.monthlyPrice, yearly: v.yearlyPrice, setup: v.setupFee, before: plan ? { monthly: plan.monthlyPrice, yearly: plan.yearlyPrice, setup: plan.setupFee } : null }));
  await batch.commit();
  toast('Plan saved.');
  return true;
}

async function showHistory(plan) {
  const snap = await getDocs(query(collection(db, 'planHistory'), where('planId', '==', plan.id)));
  const rows = snap.docs.map((d) => d.data()).sort((a, b) => (b.at && a.at ? b.at.toMillis() - a.at.toMillis() : 0));
  const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Price history: ' + plan.name),
    rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Monthly', 'Yearly', 'Setup', 'Note'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, money(r.monthlyPrice)), h('td', {}, money(r.yearlyPrice)), h('td', {}, money(r.setupFee)), h('td', { class: 'muted' }, r.note || ''))))) : h('div', { class: 'empty' }, 'No history yet.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  document.body.append(dlg); dlg.showModal();
}

async function viewAudit() {
  setCrumbs('Audit log');
  view().replaceChildren(loading('Loading the audit log.'));
  const snap = await getDocs(query(collection(db, 'platformAudit'), orderBy('at', 'desc'), limit(200)));
  const rows = snap.docs.map((d) => d.data());
  view().replaceChildren(h('h2', {}, 'Audit log'),
    h('p', { class: 'muted' }, 'The newest 200 entries. Entries can be added but never edited or deleted.'),
    rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'School', 'Reason', 'Detail'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.actorEmail || String(r.actor).slice(0, 8)), h('td', {}, h('b', {}, r.action)),
        h('td', {}, r.schoolId ? h('a', { href: '#/school/' + r.schoolId }, r.schoolId) : '-'), h('td', {}, r.reason || '-'), h('td', { class: 'muted', style: 'max-width:340px;word-break:break-word' }, r.detail || '-'))))))
      : h('div', { class: 'empty' }, 'Nothing recorded yet.'));
}

async function viewSecurity() {
  setCrumbs('Security and access');
  view().replaceChildren(loading('Loading.'));
  const [grants, cfg] = await Promise.all([getDocs(collection(db, 'platformGrants')), getDoc(doc(db, 'platformConfig', 'security')).catch(() => null)]);
  const now = Date.now();
  const live = grants.docs.map((d) => ({ id: d.id, ...d.data() })).filter((g) => g.expiresAt && g.expiresAt.toMillis() > now);
  const mfaOn = cfg && cfg.exists() && cfg.data().requireMfa === true;
  const mfaBox = h('input', { type: 'checkbox' }); mfaBox.checked = mfaOn;
  mfaBox.addEventListener('change', () => guarded(async () => {
    const next = mfaBox.checked;
    if (next && !confirm('Turn on the MFA requirement? Sensitive access passes will fail until your account has a second factor enrolled in Firebase.')) { mfaBox.checked = false; return; }
    const batch = writeBatch(db);
    batch.set(doc(db, 'platformConfig', 'security'), { requireMfa: next });
    audit(batch, next ? 'require-mfa-on' : 'require-mfa-off', '', '', '');
    await batch.commit();
    toast('Saved.');
  }));
  view().replaceChildren(h('h2', {}, 'Security and access'),
    h('div', { class: 'two' },
      h('div', { class: 'card' }, h('h3', {}, 'Active access passes'),
        live.length ? h('table', {}, h('tbody', {}, live.map((g) => h('tr', {}, h('td', {}, h('a', { href: '#/school/' + g.schoolId }, g.schoolId), h('div', { class: 'muted' }, g.tier + ' until ' + when(g.expiresAt))),
          h('td', {}, g.createdBy === S.user.uid ? h('button', { class: 'btn sm red', onclick: () => guarded(async () => {
            const batch = writeBatch(db);
            batch.delete(doc(db, 'platformGrants', g.id));
            audit(batch, 'revoke-access-pass', g.schoolId, '', g.tier);
            await batch.commit(); toast('Access pass revoked.'); await viewSecurity();
          }) }, 'Revoke') : null))))) : h('div', { class: 'empty' }, 'No active passes.')),
      h('div', { class: 'card' }, h('h3', {}, 'Multi-factor sign-in (MFA)'),
        h('p', { class: 'muted' }, 'When this is on, sensitive access passes need a second-factor sign-in from the last hour. Before you turn it on: in the Firebase console open Authentication, upgrade to Identity Platform, and enroll a second factor for your account. Enrollment on this page comes in a later batch.'),
        h('label', {}, mfaBox, 'Require MFA for sensitive access passes'))));
}

// ---------- Mark 2: billing, analytics, notifications, trials (Batch 77) ----------
const owing = (i) => (i.status === 'paid' ? 0 : Math.max(0, (Number(i.amount) || 0) - (Number(i.amountPaid) || 0)));
async function loadInvoices(force) {
  await loadSchools(force);
  if (S.invLoaded && !force) return;
  await pool(S.schools, 12, async (school) => {
    const snap = await getDocs(collection(db, 'schools', school.id, 'invoices')).catch(() => null);
    school.invoices = snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  });
  S.invLoaded = true;
}
const invPill = (i) => h('span', { class: 'pill ' + (i.status === 'paid' ? 'ok' : i.status === 'overdue' ? 'bad' : (i.amountPaid ? 'warn' : '')) }, i.status === 'due' && i.amountPaid ? 'part paid' : i.status);

async function createInvoice(school) {
  await loadSchools();
  const fields = [];
  if (!school) fields.push({ key: 'school', label: 'School', type: 'select', options: S.schools.filter((s) => !s.archived).map((s) => [s.id, s.name + ' (' + s.id + ')']) });
  fields.push(
    { key: 'kind', label: 'Invoice type', type: 'select', options: [['setup', 'Setup fee'], ['subscription', 'Subscription']] },
    { key: 'period', label: 'Period (YYYY-MM)', required: true, value: today().slice(0, 7), pattern: /^[0-9]{4}-[0-9]{2}$/, patternText: 'Use the form 2026-12.' },
    { key: 'amount', label: 'Amount (Rs)', type: 'number', required: true },
    { key: 'dueOn', label: 'Due date', type: 'date', required: true, value: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) },
    { key: 'note', label: 'Note on the invoice (optional)' });
  const v = await formDialog({ title: 'Create an invoice' + (school ? ' for ' + school.name : ''), ok: 'Create invoice', fields });
  if (!v) return false;
  if (!(v.amount > 0)) { toast('The amount must be more than zero.'); return false; }
  const target = school || S.schools.find((s) => s.id === v.school);
  const id = newId('INV-');
  const batch = writeBatch(db);
  batch.set(doc(db, 'schools', target.id, 'invoices', id), { period: v.period, amount: v.amount, dueOn: v.dueOn, status: 'due', kind: v.kind, ...(v.note ? { note: v.note.slice(0, 200) } : {}) });
  audit(batch, 'create-invoice', target.id, v.note || '', JSON.stringify({ invoice: id, kind: v.kind, amount: v.amount, period: v.period }));
  await batch.commit();
  toast('Invoice ' + id + ' created.');
  return true;
}

// kind: 'payment' (verified offline or gateway payment), 'failed' (a payment that did not go through), 'refund'.
async function moneyEntry(school, inv, kind) {
  const balance = owing(inv);
  const refundable = Math.max(0, (Number(inv.amountPaid) || 0) - (Number(inv.refunded) || 0));
  const v = await formDialog({
    title: (kind === 'refund' ? 'Refund on ' : kind === 'failed' ? 'Record a failed payment on ' : 'Record a payment on ') + inv.id, ok: 'Save',
    note: kind === 'refund' ? 'Refundable so far: ' + money(refundable) + '. The refund is recorded here; send the money back yourself, then record it.'
      : kind === 'failed' ? 'A failed attempt does not change the balance. It is kept in the invoice history.'
      : 'Balance due: ' + money(balance) + '. Enter what you verified you received. A smaller amount is a part payment.',
    fields: [
      { key: 'amount', label: 'Amount (Rs)', type: 'number', required: true, value: kind === 'refund' ? refundable : balance },
      { key: 'method', label: 'How it was paid', type: 'select', options: [['upi', 'UPI'], ['bank', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['gateway', 'Payment gateway (recorded by hand)']] },
      { key: 'reference', label: 'Reference (UTR, cheque number, receipt)', placeholder: kind === 'failed' ? 'Gateway or bank message' : 'Needed so someone else can verify it' },
      kind === 'refund' ? REASON : { key: 'note', label: 'Note (optional)' }],
  });
  if (!v) return false;
  if (!(v.amount > 0)) { toast('The amount must be more than zero.'); return false; }
  if (kind === 'payment' && v.amount > balance) { toast('That is more than the balance due (' + money(balance) + ').'); return false; }
  if (kind === 'refund' && v.amount > refundable) { toast('That is more than was paid (' + money(refundable) + ').'); return false; }
  if (kind !== 'failed' && v.method !== 'cash' && !v.reference) { toast('Add the reference so the payment can be verified later.'); return false; }
  const batch = writeBatch(db);
  const auditId = audit(batch, kind === 'refund' ? 'refund-invoice' : kind === 'failed' ? 'failed-payment' : 'record-payment', school.id, kind === 'refund' ? v.reason : (v.note || ''),
    JSON.stringify({ invoice: inv.id, amount: v.amount, method: v.method, reference: v.reference || '' }));
  batch.set(doc(db, 'schools', school.id, 'invoices', inv.id, 'payments', newId('PAY-')), {
    kind: kind === 'refund' ? 'refund' : 'payment', amount: v.amount, method: v.method, status: kind === 'failed' ? 'failed' : 'verified',
    ...(v.reference ? { reference: v.reference.slice(0, 80) } : {}), ...((kind === 'refund' ? v.reason : v.note) ? { note: (kind === 'refund' ? v.reason : v.note).slice(0, 200) } : {}),
    by: S.user.uid, at: serverTimestamp(), auditId });
  const ref = doc(db, 'schools', school.id, 'invoices', inv.id);
  if (kind === 'payment') {
    const paid = (Number(inv.amountPaid) || 0) + v.amount;
    batch.update(ref, paid >= inv.amount ? { amountPaid: paid, status: 'paid', paidOn: today() } : { amountPaid: paid });
  } else if (kind === 'refund') batch.update(ref, { refunded: (Number(inv.refunded) || 0) + v.amount });
  await batch.commit();
  toast(kind === 'refund' ? 'Refund recorded.' : kind === 'failed' ? 'Failed payment recorded.' : 'Payment recorded.');
  return true;
}

async function paymentHistory(school, inv) {
  const snap = await getDocs(collection(db, 'schools', school.id, 'invoices', inv.id, 'payments'));
  const rows = snap.docs.map((d) => d.data()).sort((a, b) => (b.at && a.at ? b.at.toMillis() - a.at.toMillis() : 0));
  const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Payments on ' + inv.id),
    rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Type', 'Amount', 'Method', 'Reference', 'Result'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.kind), h('td', {}, money(r.amount)), h('td', {}, r.method), h('td', { class: 'muted' }, r.reference || '-'),
        h('td', {}, h('span', { class: 'pill ' + (r.status === 'verified' ? 'ok' : 'bad') }, r.status)))))) : h('div', { class: 'empty' }, 'No payments recorded yet.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  document.body.append(dlg); dlg.showModal();
}

// A printable invoice: opens a clean page and the browser's print box, where "Save as PDF" makes the PDF.
function printInvoice(school, inv) {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups for this page, then try again.'); return; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>body{font:15px/1.5 Georgia,serif;color:#111;margin:40px auto;max-width:720px}h1{color:#0b1f3a;margin:0}table{width:100%;border-collapse:collapse;margin:22px 0}td,th{padding:8px;border-bottom:1px solid #ccc;text-align:left}.r{text-align:right}.tot td{font-weight:bold;border-top:2px solid #0b1f3a}.mut{color:#555}@media print{button{display:none}}</style></head><body></body></html>');
  w.document.title = 'Invoice ' + inv.id;
  const line = (label, value, cls) => h('tr', { class: cls || '' }, h('td', {}, label), h('td', { class: 'r' }, value));
  const body = h('div', {}, h('h1', {}, 'AZIZ School Management System'), h('p', { class: 'mut' }, 'Tax invoice'),
    h('p', {}, h('b', {}, 'Invoice: '), inv.id, h('br'), h('b', {}, 'Period: '), inv.period, h('br'), h('b', {}, 'Due: '), inv.dueOn, h('br'), h('b', {}, 'Status: '), inv.status),
    h('p', {}, h('b', {}, 'Billed to: '), school.name, h('br'), school.address || '', school.address ? h('br') : null, school.contactEmail || ''),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Description'), h('th', { class: 'r' }, 'Amount'))),
      h('tbody', {}, line((inv.kind === 'setup' ? 'Setup fee' : 'Subscription') + ' ' + inv.period + (inv.note ? ' (' + inv.note + ')' : ''), money(inv.amount)),
        line('Received', money(inv.amountPaid || 0)), (inv.refunded ? line('Refunded', money(inv.refunded)) : null), line('Balance due', money(owing(inv)), 'tot'))),
    h('p', { class: 'mut' }, 'Generated ' + new Date().toLocaleString('en-IN') + '.'),
    h('button', { onclick: () => w.print() }, 'Print or save as PDF'));
  w.document.body.append(w.document.adoptNode(body));
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* the button is still there */ } }, 400);
}

function invoiceTable(rows, withSchool, after) {
  const body = h('tbody');
  for (const { school, inv } of rows.slice(0, 300)) {
    const left = owing(inv);
    body.append(h('tr', {},
      h('td', {}, h('b', {}, inv.id), h('div', { class: 'muted' }, (inv.kind === 'setup' ? 'Setup fee ' : 'Subscription ') + inv.period)),
      withSchool ? h('td', {}, h('a', { href: '#/school/' + school.id }, school.name)) : null,
      h('td', {}, money(inv.amount)), h('td', {}, money(inv.amountPaid || 0) + (inv.refunded ? ' (refunded ' + money(inv.refunded) + ')' : '')), h('td', {}, money(left)),
      h('td', {}, inv.dueOn), h('td', {}, invPill(inv)),
      h('td', {}, h('div', { class: 'row' },
        left > 0 ? h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await moneyEntry(school, inv, 'payment')) await after(); }) }, 'Record payment') : null,
        left > 0 ? h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await moneyEntry(school, inv, 'failed')) await after(); }) }, 'Failed attempt') : null,
        (inv.amountPaid || 0) - (inv.refunded || 0) > 0 ? h('button', { class: 'btn sm red', onclick: () => guarded(async () => { if (await moneyEntry(school, inv, 'refund')) await after(); }) }, 'Refund') : null,
        h('button', { class: 'btn sm', onclick: () => guarded(() => paymentHistory(school, inv)) }, 'History'),
        h('button', { class: 'btn sm', onclick: () => printInvoice(school, inv) }, 'PDF')))));
  }
  if (!rows.length) body.append(h('tr', {}, h('td', { colspan: 8 }, h('div', { class: 'empty' }, 'No invoices.'))));
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Invoice', withSchool ? 'School' : null, 'Amount', 'Received', 'Balance', 'Due', 'Status', ''].filter((t) => t !== null).map((t) => h('th', {}, t)))), body));
}

async function viewBilling() {
  setCrumbs('Billing and invoices');
  view().replaceChildren(loading('Loading every school\'s invoices.'));
  await loadInvoices();
  const all = S.schools.flatMap((school) => (school.invoices || []).map((inv) => ({ school, inv })));
  const filter = h('select', {}, [['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['all', 'All invoices']].map(([v, t]) => h('option', { value: v }, t)));
  const searchBox = h('input', { type: 'search', placeholder: 'Search by school or invoice number' });
  const holder = h('div');
  const refresh = async () => { await loadInvoices(true); await viewBilling(); };
  const draw = () => {
    const words = searchBox.value.trim().toLowerCase();
    const rows = all.filter(({ school, inv }) => (filter.value === 'all' || (filter.value === 'overdue' ? inv.status === 'overdue' : owing(inv) > 0))
      && (!words || school.name.toLowerCase().includes(words) || inv.id.toLowerCase().includes(words)))
      .sort((a, b) => String(a.inv.dueOn).localeCompare(String(b.inv.dueOn)));
    holder.replaceChildren(invoiceTable(rows, true, refresh));
  };
  searchBox.addEventListener('input', draw); filter.addEventListener('change', draw);
  const outstanding = all.reduce((t, { inv }) => t + owing(inv), 0);
  const collected = all.reduce((t, { inv }) => t + (Number(inv.amountPaid) || 0), 0);
  const refunded = all.reduce((t, { inv }) => t + (Number(inv.refunded) || 0), 0);
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Billing and invoices'), h('button', { class: 'btn gold', onclick: () => guarded(async () => { if (await createInvoice(null)) await refresh(); }) }, 'Create invoice')),
    h('p', { class: 'muted' }, 'Payments are recorded by hand after you verify them (bank statement, UPI, cash, cheque). Every entry is kept in the invoice history and the audit log. Online payment through a gateway is not connected yet.'),
    h('div', { class: 'grid' }, stat('Outstanding', money(outstanding)), stat('Collected', money(collected)), stat('Refunded', money(refunded)), stat('Overdue invoices', num(all.filter(({ inv }) => inv.status === 'overdue').length))),
    h('div', { class: 'row' }, searchBox, filter), holder);
  draw();
}

// ---------- analytics ----------
function barRow(label, value, max, text) {
  return h('div', { class: 'barrow' }, h('span', {}, label), h('div', {}, h('div', { class: 'bar', style: 'width:' + Math.round((max ? value / max : 0) * 100) + '%' })), h('span', { class: 'muted' }, text));
}
async function viewAnalytics() {
  setCrumbs('Revenue analytics');
  view().replaceChildren(loading('Working out the numbers.'));
  await Promise.all([loadInvoices(), loadPlans()]);
  const live = S.schools.filter((s) => !s.archived);
  const paying = live.filter((s) => s.billing && s.billing.status === 'active' && s.billing.plan !== 'trial');
  const mrr = paying.reduce((t, s) => t + (Number(s.billing.monthlyPrice) || 0), 0);
  const arps = paying.length ? Math.round(mrr / paying.length) : 0;
  // New subscriptions: schools whose paid plan started in each of the last six months.
  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - k)); return d.toISOString().slice(0, 7); });
  const started = months.map((m) => live.filter((s) => s.billing && s.billing.startedOn && s.billing.startedOn.slice(0, 7) === m).length);
  const converted = live.filter((s) => s.billing && s.billing.plan !== 'trial' && ['active', 'suspended'].includes(s.billing.status)).length;
  const inTrial = live.filter((s) => s.billing && s.billing.status === 'trial').length;
  const lost = S.schools.filter((s) => s.billing && s.billing.plan === 'trial' && s.billing.status === 'cancelled').length;
  const rate = converted + inTrial + lost ? Math.round(converted / (converted + inTrial + lost) * 100) : 0;
  const byPlan = new Map();
  for (const s of live) {
    const planId = s.billing ? s.billing.plan : 'none';
    const row = byPlan.get(planId) || { schools: 0, mrr: 0, collected: 0 };
    row.schools += 1;
    if (s.billing && s.billing.status === 'active') row.mrr += Number(s.billing.monthlyPrice) || 0;
    row.collected += (s.invoices || []).reduce((t, i) => t + (Number(i.amountPaid) || 0) - (Number(i.refunded) || 0), 0);
    byPlan.set(planId, row);
  }
  const planRows = [...byPlan.entries()].sort((a, b) => b[1].mrr - a[1].mrr);
  const maxMrr = Math.max(1, ...planRows.map(([, r]) => r.mrr));
  const maxNew = Math.max(1, ...started);
  view().replaceChildren(h('h2', {}, 'Revenue analytics'),
    h('p', { class: 'muted' }, 'Worked out live from each school\'s plan and invoices. Only active, paying schools count toward revenue.'),
    h('div', { class: 'grid' }, stat('MRR (monthly recurring revenue)', money(mrr)), stat('ARR (annual run rate)', money(mrr * 12), 'MRR times 12'), stat('Paying schools', num(paying.length)),
      stat('Average revenue per school', money(arps), 'MRR divided by paying schools'), stat('Trial conversion', rate + '%', converted + ' paid, ' + inTrial + ' in trial, ' + lost + ' lost')),
    h('div', { class: 'two' },
      h('div', { class: 'card' }, h('h3', {}, 'New subscriptions, last 6 months'), ...months.map((m, k) => barRow(m, started[k], maxNew, String(started[k]))),
        h('p', { class: 'muted' }, 'Counted from the start date saved when a school moves onto a paid plan. Schools that paid before this batch have no start date and do not appear here.')),
      h('div', { class: 'card' }, h('h3', {}, 'Revenue by plan'), planRows.length ? planRows.map(([planId, r]) => barRow(planId + ' (' + r.schools + ')', r.mrr, maxMrr, money(r.mrr) + '/mo')) : h('div', { class: 'empty' }, 'No schools yet.'),
        planRows.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Plan', 'Schools', 'MRR', 'Collected to date'].map((t) => h('th', {}, t)))),
          h('tbody', {}, planRows.map(([planId, r]) => h('tr', {}, h('td', {}, planId), h('td', {}, num(r.schools)), h('td', {}, money(r.mrr)), h('td', {}, money(r.collected)))))) : null)));
}

// ---------- notifications ----------
const KINDS = [['announcement', 'Announcement'], ['renewal', 'Renewal reminder'], ['payment', 'Payment alert'], ['maintenance', 'Maintenance notice'], ['targeted', 'Targeted message']];
async function sendMessage({ kind, title, body, audience, recipients }) {
  if (!recipients.length) { toast('No school matches that audience.'); return false; }
  if (recipients.length > 450) { toast('That is ' + recipients.length + ' schools. Send to at most 450 at a time.'); return false; }
  if (!confirm('Send "' + title + '" to ' + recipients.length + ' school(s)?')) return false;
  const id = newId('M-');
  const batch = writeBatch(db);
  const auditId = audit(batch, 'send-message', '', '', JSON.stringify({ message: id, kind, audience, schools: recipients.length }));
  batch.set(doc(db, 'platformMessages', id), { kind, title, body, audience, recipients, by: S.user.uid, at: serverTimestamp(), auditId });
  for (const schoolId of recipients) batch.set(doc(db, 'schools', schoolId, 'platformInbox', id), { kind, title, body, at: serverTimestamp() });
  await batch.commit();
  toast('Sent to ' + recipients.length + ' school(s).');
  return true;
}
async function composeMessage(preset = {}) {
  await Promise.all([loadSchools(), loadPlans()]);
  const live = S.schools.filter((s) => !s.archived);
  const audiences = [['all', 'All schools (not archived)'], ['status:trial', 'Schools on trial'], ['status:active', 'Active schools'], ['status:suspended', 'Suspended schools']]
    .concat(S.plans.map((p) => ['plan:' + p.id, 'Schools on the ' + p.name + ' plan'])).concat([['ids', 'Chosen schools (type their IDs)']]);
  const v = await formDialog({
    title: preset.title ? 'Send: ' + preset.title : 'New message to schools', ok: 'Review and send',
    note: 'Owners see this at the top of their dashboard.',
    fields: [
      { key: 'kind', label: 'Type', type: 'select', options: KINDS, value: preset.kind },
      { key: 'title', label: 'Title', required: true, minLen: 3, value: preset.title || '' },
      { key: 'body', label: 'Message', type: 'textarea', required: true, value: preset.body || '' },
      { key: 'audience', label: 'Send to', type: 'select', options: audiences, value: preset.ids ? 'ids' : preset.audience },
      { key: 'ids', label: 'School IDs (only for "Chosen schools"), separated by commas', value: preset.ids ? preset.ids.join(', ') : '' },
    ],
  });
  if (!v) return false;
  let recipients;
  if (v.audience === 'ids') recipients = v.ids.split(/[\s,]+/).filter(Boolean).filter((id) => live.some((s) => s.id === id));
  else if (v.audience === 'all') recipients = live.map((s) => s.id);
  else if (v.audience.startsWith('status:')) recipients = live.filter((s) => statusOf(s) === v.audience.slice(7)).map((s) => s.id);
  else recipients = live.filter((s) => s.billing && s.billing.plan === v.audience.slice(5)).map((s) => s.id);
  const label = v.audience === 'ids' ? 'Chosen schools' : audiences.find(([k]) => k === v.audience)[1];
  return sendMessage({ kind: v.kind, title: v.title.slice(0, 100), body: v.body.slice(0, 1000), audience: label, recipients });
}
async function deliveryReport(message) {
  const rows = [];
  await pool(message.recipients, 10, async (schoolId) => {
    const snap = await getDoc(doc(db, 'schools', schoolId, 'platformInbox', message.id)).catch(() => null);
    rows.push({ schoolId, delivered: Boolean(snap && snap.exists()), readAt: snap && snap.exists() ? snap.data().readAt : null });
  });
  const read = rows.filter((r) => r.readAt).length;
  const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Delivery: ' + message.title),
    h('p', { class: 'muted' }, rows.filter((r) => r.delivered).length + ' delivered, ' + read + ' read, ' + (rows.length - read) + ' not read yet. Delivery is inside the app only.'),
    h('table', {}, h('thead', {}, h('tr', {}, ['School', 'Delivered', 'Read'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt))).map((r) => h('tr', {}, h('td', {}, S.schools.find((s) => s.id === r.schoolId)?.name || r.schoolId),
        h('td', {}, r.delivered ? 'Yes' : 'No'), h('td', {}, r.readAt ? when(r.readAt) : 'Not yet'))))),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  document.body.append(dlg); dlg.showModal();
}
async function viewNotifications() {
  setCrumbs('Notifications');
  view().replaceChildren(loading('Loading messages.'));
  await loadInvoices();
  const snap = await getDocs(query(collection(db, 'platformMessages'), orderBy('at', 'desc'), limit(40)));
  const sent = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const live = S.schools.filter((s) => !s.archived);
  const overdue = live.filter((s) => (s.invoices || []).some((i) => i.status === 'overdue'));
  const soon = live.filter((s) => {
    const b = s.billing || {}; const now = Date.now();
    const trial = b.status === 'trial' && b.trialEnds && b.trialEnds.toMillis && b.trialEnds.toMillis() - now < 7 * 86400000;
    const renew = b.status === 'active' && b.renewsOn && new Date(b.renewsOn).getTime() - now < 7 * 86400000;
    return trial || renew;
  });
  const refresh = () => viewNotifications();
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Notifications'), h('button', { class: 'btn gold', onclick: () => guarded(async () => { if (await composeMessage()) await refresh(); }) }, 'New message')),
    h('p', { class: 'muted' }, 'Messages appear at the top of each school owner\'s dashboard. Email and phone alerts are not connected yet.'),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h3', {}, 'Payment alerts'), h('p', { class: 'muted' }, overdue.length + ' school(s) have an overdue invoice.'),
        h('button', { class: 'btn', disabled: !overdue.length, onclick: () => guarded(async () => { if (await composeMessage({ kind: 'payment', title: 'Payment overdue', body: 'You have an overdue AZIZ invoice. Please pay it to keep your school running without interruption.', ids: overdue.map((s) => s.id) })) await refresh(); }) }, 'Remind them')),
      h('div', { class: 'card' }, h('h3', {}, 'Renewal reminders'), h('p', { class: 'muted' }, soon.length + ' school(s) have a trial or renewal ending within 7 days.'),
        h('button', { class: 'btn', disabled: !soon.length, onclick: () => guarded(async () => { if (await composeMessage({ kind: 'renewal', title: 'Your plan is due for renewal soon', body: 'Your trial or plan ends within a week. Contact AZIZ to continue without a break.', ids: soon.map((s) => s.id) })) await refresh(); }) }, 'Send reminder')),
      h('div', { class: 'card' }, h('h3', {}, 'Maintenance notice'), h('p', { class: 'muted' }, 'Warn every school before planned downtime.'),
        h('button', { class: 'btn', onclick: () => guarded(async () => { if (await composeMessage({ kind: 'maintenance', title: 'Planned maintenance', body: 'AZIZ will be briefly unavailable on DATE between TIME and TIME. Please save your work before then.', audience: 'all' })) await refresh(); }) }, 'Write notice'))),
    h('div', { style: 'height:14px' }),
    h('div', { class: 'card' }, h('h3', {}, 'Sent messages'),
      sent.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Type', 'Title', 'Sent to', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, sent.map((m) => h('tr', {}, h('td', {}, when(m.at)), h('td', {}, m.kind), h('td', {}, h('b', {}, m.title)), h('td', {}, m.audience + ' (' + m.recipients.length + ')'),
          h('td', {}, h('button', { class: 'btn sm', onclick: () => guarded(() => deliveryReport(m)) }, 'Delivery'))))))) : h('div', { class: 'empty' }, 'Nothing sent yet.')));
}

// ---------- trials and onboarding ----------
async function viewTrials() {
  setCrumbs('Trials and onboarding');
  view().replaceChildren(loading('Checking how each trial school is getting on.'));
  await loadSchools();
  const trials = S.schools.filter((s) => !s.archived && s.billing && s.billing.status === 'trial');
  const owners = new Map();
  await pool(trials, 8, async (s) => { owners.set(s.id, (await loadOwnersOf(s.id)).some((o) => o.kind === 'member' && o.active)); });
  const converted = S.schools.filter((s) => !s.archived && s.billing && s.billing.plan !== 'trial' && ['active', 'suspended'].includes(s.billing.status)).length;
  const lost = S.schools.filter((s) => s.billing && s.billing.plan === 'trial' && s.billing.status === 'cancelled').length;
  const rate = converted + trials.length + lost ? Math.round(converted / (converted + trials.length + lost) * 100) : 0;
  const refresh = async () => { await loadSchools(true); await viewTrials(); };
  const cards = trials.map((s) => {
    const u = s.usage || {};
    const steps = [['Owner joined', owners.get(s.id)], ['Profile filled in', Boolean(s.contactEmail && s.phone && s.address)], ['Classes set up', (u.classes || 0) > 0],
      ['Staff added', (u.staff || 0) > 0], ['Students added', (u.students || 0) > 0], ['First payment recorded', (u.payments || 0) > 0]];
    const done = steps.filter(([, ok]) => ok).length;
    const b = s.billing;
    const days = b.trialEnds && b.trialEnds.toMillis ? Math.ceil((b.trialEnds.toMillis() - Date.now()) / 86400000) : null;
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h3', { style: 'flex:1' }, h('a', { href: '#/school/' + s.id }, s.name)), h('span', { class: 'pill ' + (days !== null && days <= 7 ? 'warn' : '') }, days === null ? 'no end date' : days < 0 ? 'ended ' + (-days) + ' days ago' : days + ' days left')),
      barRow('Onboarding', done, steps.length, done + ' of ' + steps.length),
      h('div', { class: 'steps' }, steps.map(([label, ok]) => h('span', { class: 'pill ' + (ok ? 'ok' : '') }, (ok ? 'Done: ' : 'To do: ') + label))),
      h('div', { class: 'row' }, h('button', { class: 'btn sm gold', onclick: () => guarded(async () => { if (await applyPlan(s)) await refresh(); }) }, 'Convert to a paid plan'),
        h('button', { class: 'btn sm', onclick: () => guarded(() => composeMessage({ kind: 'targeted', title: 'Need help getting started?', body: 'We noticed your setup is not finished. Reply to us and we will help you finish it.', ids: [s.id] })) }, 'Send a nudge')));
  });
  view().replaceChildren(h('h2', {}, 'Trials and onboarding'),
    h('div', { class: 'grid' }, stat('Schools on trial', num(trials.length)), stat('Converted to paid', num(converted)), stat('Lost trials', num(lost)), stat('Trial conversion', rate + '%', 'paid, divided by paid plus trial plus lost')),
    h('div', { style: 'height:14px' }), cards.length ? h('div', { class: 'two' }, cards) : h('div', { class: 'empty' }, 'No school is on trial right now.'));
}

// ---------- Mark 3: domains, themes, feature access, storage (Batch 78) ----------
const BASE_DOMAIN = 'azizschoolmanagement.plateria.in';
const SEEDS = [
  ['website', 'Public website', 'The school\'s public website pages and enquiries.'], ['finance', 'Finance', 'Fees, payroll, expenses, concessions, sales, vendors and defaulters.'],
  ['library', 'Library', 'Library books and lending.'], ['transport', 'Transport', 'Routes and riders.'],
  ['portal', 'Parent and student portal', 'Parent and student sign-in.'], ['premium-themes', 'Premium themes', 'Marketplace themes marked premium.']];
const ROLE_NAMES = ['owner', 'principal', 'teacher', 'accountant', 'student', 'parent'];
const csv = (text) => String(text || '').split(',').map((t) => t.trim()).filter(Boolean);

// A DNS and HTTPS check from the browser (Google's public DNS-over-HTTPS), the same one the older panel uses.
async function checkDomain(domain) {
  const result = { dns: [], https: false };
  for (const type of ['CNAME', 'A']) {
    try {
      const answer = await (await fetch('https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=' + type)).json();
      for (const record of answer.Answer || []) if (record.type === (type === 'A' ? 1 : 5)) result.dns.push(type + ' ' + String(record.data).replace(/\.$/, ''));
    } catch { /* the other lookup may still work */ }
  }
  try { await fetch('https://' + domain + '/robots.txt', { mode: 'no-cors', cache: 'no-store' }); result.https = true; } catch { /* no secure page yet */ }
  return result;
}
async function loadDomainRequests() {
  await loadSchools();
  const rows = [];
  await pool(S.schools, 12, async (school) => {
    const snap = await getDocs(collection(db, 'schools', school.id, 'domainRequests')).catch(() => null);
    for (const d of snap ? snap.docs : []) rows.push({ school, id: d.id, ...d.data() });
  });
  return rows.sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn)));
}
async function setDomainState(row, changes, action, detail) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', row.school.id, 'domainRequests', row.id), changes);
  audit(batch, action, row.school.id, '', detail || JSON.stringify({ domain: row.domain, ...changes }));
  return batch;
}
async function verifyAndPublish(row) {
  const mapRef = doc(db, 'domainMap', row.domain);
  const linked = await getDoc(mapRef);
  if (linked.exists() && linked.data().schoolId !== row.school.id) { toast('That address is already linked to another school.'); return false; }
  if (!confirm('Publish ' + row.domain + ' as the school\'s address? Visitors will see the school website there.')) return false;
  const batch = await setDomainState(row, { status: 'verified', ssl: 'active', checkedOn: today() }, 'domain-publish');
  batch.set(mapRef, { schoolId: row.school.id, verifiedOn: today() });
  await batch.commit();
  toast(row.domain + ' is published.');
  return true;
}
async function unpublishDomain(row) {
  if (!confirm('Take ' + row.domain + ' offline? The school website stops opening at that address.')) return false;
  const batch = await setDomainState(row, { status: 'dns-pending' }, 'domain-unpublish');
  batch.delete(doc(db, 'domainMap', row.domain));
  await batch.commit();
  toast(row.domain + ' is offline.');
  return true;
}
function previewLinks(row) {
  return h('span', {}, h('a', { href: '/school?school=' + encodeURIComponent(row.school.id), target: '_blank', rel: 'noopener' }, 'Preview site'),
    row.status === 'verified' ? [' | ', h('a', { href: 'https://' + row.domain, target: '_blank', rel: 'noopener' }, 'Open live')] : null);
}
async function assignSubdomain(school) {
  const v = await formDialog({ title: 'Assign a subdomain to ' + school.name, ok: 'Assign',
    note: 'The address becomes LABEL.' + BASE_DOMAIN + '. It only opens once a wildcard DNS record (* pointing to the site) exists at Hostinger.',
    fields: [{ key: 'label', label: 'Subdomain label', required: true, value: school.id, pattern: /^[a-z][a-z0-9-]{2,29}$/, patternText: 'Use 3 to 30 lowercase letters, numbers or dashes.' }] });
  if (!v) return false;
  if (['www', 'admin', 'api', 'app', 'mail', 'ftp', 'support'].includes(v.label)) { toast('That label is reserved.'); return false; }
  const host = v.label + '.' + BASE_DOMAIN;
  const taken = await getDocFromServer(doc(db, 'domainMap', host)).then((d) => d.exists() && d.data().schoolId !== school.id);
  if (taken) { toast('That subdomain belongs to another school.'); return false; }
  const batch = writeBatch(db);
  batch.set(doc(db, 'domainMap', host), { schoolId: school.id, verifiedOn: today() });
  batch.set(doc(db, 'schools', school.id, 'domainRequests', newId('SD-')), { domain: host, status: 'verified', createdOn: today(), ssl: 'pending', dnsTarget: 'Wildcard record * at ' + BASE_DOMAIN, note: 'subdomain' });
  audit(batch, 'assign-subdomain', school.id, '', host);
  await batch.commit();
  toast(host + ' assigned.');
  return true;
}
async function setSiteHold(school, hold) {
  const v = await formDialog({ title: (hold ? 'Take the public website offline: ' : 'Put the public website back online: ') + school.name, ok: hold ? 'Take offline' : 'Put online', fields: [REASON] });
  if (!v) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', school.id), { siteHold: hold });
  if (hold) batch.set(doc(db, 'siteHolds', school.id), { held: true }); else batch.delete(doc(db, 'siteHolds', school.id));
  audit(batch, hold ? 'site-offline' : 'site-online', school.id, v.reason, '');
  await batch.commit();
  toast(hold ? 'Website taken offline.' : 'Website is online again.');
  return true;
}
async function viewDomains() {
  setCrumbs('Domains and website');
  view().replaceChildren(loading('Loading domain requests.'));
  const rows = await loadDomainRequests();
  const refresh = async () => { await loadSchools(true); await viewDomains(); };
  const body = rows.map((row) => h('tr', {},
    h('td', {}, h('b', {}, row.domain), h('div', { class: 'muted' }, row.dnsTarget || 'No DNS target set')),
    h('td', {}, h('a', { href: '#/school/' + row.school.id }, row.school.name)),
    h('td', {}, h('span', { class: 'pill ' + (row.status === 'verified' ? 'ok' : row.status === 'rejected' ? 'bad' : 'warn') }, row.status)),
    h('td', {}, h('span', { class: 'pill ' + (row.ssl === 'active' ? 'ok' : 'warn') }, row.ssl || 'none')),
    h('td', { class: 'muted' }, row.checkedOn || '-'), h('td', {}, previewLinks(row)),
    h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => guarded(async () => {
        const r = await checkDomain(row.domain);
        const batch = await setDomainState(row, { checkedOn: today(), ssl: r.https ? 'active' : 'pending' }, 'domain-check', JSON.stringify({ domain: row.domain, dns: r.dns, https: r.https }));
        await batch.commit();
        toast(row.domain + ': DNS ' + (r.dns.length ? r.dns.join(', ') : 'no record yet') + '. HTTPS ' + (r.https ? 'works.' : 'not working yet.'));
        await refresh();
      }) }, 'Check DNS and SSL'),
      h('button', { class: 'btn sm', onclick: () => guarded(async () => {
        const v = await formDialog({ title: 'What should ' + row.school.name + ' set at its domain provider?', ok: 'Save',
          fields: [{ key: 'target', label: 'DNS instruction', required: true, value: row.dnsTarget || 'CNAME to ' + BASE_DOMAIN }] });
        if (!v) return;
        await (await setDomainState(row, { dnsTarget: v.target.slice(0, 100), status: 'dns-pending', ssl: 'pending' }, 'domain-dns-target')).commit();
        toast('DNS instruction saved.'); await refresh();
      }) }, 'Set DNS target'),
      row.status !== 'verified' ? h('button', { class: 'btn sm gold', onclick: () => guarded(async () => { if (await verifyAndPublish(row)) await refresh(); }) }, 'Verify and publish')
        : h('button', { class: 'btn sm red', onclick: () => guarded(async () => { if (await unpublishDomain(row)) await refresh(); }) }, 'Unpublish'),
      row.status !== 'rejected' && row.status !== 'verified' ? h('button', { class: 'btn sm red', onclick: () => guarded(async () => { await (await setDomainState(row, { status: 'rejected' }, 'domain-reject')).commit(); toast('Rejected.'); await refresh(); }) }, 'Reject') : null))));
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Domains and website'),
      h('button', { class: 'btn gold', onclick: () => guarded(async () => {
        const v = await formDialog({ title: 'Assign a subdomain', ok: 'Continue', fields: [{ key: 'school', label: 'School', type: 'select', options: S.schools.filter((s) => !s.archived).map((s) => [s.id, s.name]) }] });
        if (v && await assignSubdomain(S.schools.find((s) => s.id === v.school))) await refresh();
      }) }, 'Assign a subdomain')),
    h('p', { class: 'muted' }, 'Schools ask for a domain from their own dashboard. You set the DNS instruction, check it, then verify and publish. Subdomains of ' + BASE_DOMAIN + ' need a wildcard DNS record at Hostinger before they open.'),
    rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Address', 'School', 'Status', 'SSL', 'Last checked', 'Preview', ''].map((t) => h('th', {}, t)))), h('tbody', {}, body)))
      : h('div', { class: 'empty' }, 'No domain requests yet.'));
}

// ---------- themes ----------
const swatch = (t) => h('span', { style: 'display:inline-flex;gap:3px;vertical-align:middle' }, [t.navy, t.ivory, t.gold].map((c) => h('i', { style: 'width:18px;height:18px;border-radius:4px;border:1px solid #888;background:' + c })));
function previewDialog(t) {
  return new Promise((resolve) => {
    const card = h('div', { style: 'border-radius:10px;overflow:hidden;border:1px solid #888;margin:10px 0' },
      h('div', { style: 'background:' + t.navy + ';color:' + t.ivory + ';padding:14px;font-weight:700' }, 'Sample School  ', h('span', { style: 'color:' + t.gold + ';font-weight:400' }, 'Admissions open')),
      h('div', { style: 'background:' + t.ivory + ';color:' + t.navy + ';padding:14px' }, 'Welcome to the school website. ', h('b', { style: 'color:' + t.gold }, 'Highlights look like this.')));
    const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Preview: ' + t.label), card,
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); resolve(false); } }, 'Back'), h('button', { class: 'btn gold', onclick: () => { dlg.close(); dlg.remove(); resolve(true); } }, 'Publish this')));
    document.body.append(dlg); dlg.showModal();
  });
}
async function readThemes() {
  const found = await getDoc(doc(db, 'platformConfig', 'marketplace')).catch(() => null);
  return found && found.exists() ? (found.data().items || []) : [];
}
// items: the new marketplace list. entry: the history record. Both are written with an audit entry in one batch.
async function writeThemes(items, entry, action, reason) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'platformConfig', 'marketplace'), { items });
  batch.set(doc(db, 'themeHistory', newId('T-')), { themeKey: entry.key, label: entry.label, navy: entry.navy, ivory: entry.ivory, gold: entry.gold, premium: Boolean(entry.premium), version: entry.version, ...(entry.removed ? { removed: true } : {}), by: S.user.uid, at: serverTimestamp() });
  audit(batch, action, '', reason || '', JSON.stringify({ theme: entry.key, label: entry.label, version: entry.version }));
  await batch.commit();
}
async function editTheme(theme) {
  const items = await readThemes();
  if (!theme && items.length >= 12) { toast('Remove a theme first. Twelve is the limit.'); return false; }
  const v = await formDialog({ title: theme ? 'Update theme ' + theme.label : 'New marketplace theme', ok: 'Preview',
    fields: [{ key: 'label', label: 'Theme name', required: true, value: theme ? theme.label : '' },
      { key: 'navy', label: 'Main colour', type: 'color', value: theme ? theme.navy : '#0b1f3a' }, { key: 'ivory', label: 'Background colour', type: 'color', value: theme ? theme.ivory : '#f6efdc' },
      { key: 'gold', label: 'Accent colour', type: 'color', value: theme ? theme.gold : '#c9a24b' },
      { key: 'premium', label: 'Premium (only schools whose plan includes Premium themes see it)', type: 'checkbox', value: theme ? theme.premium === true : false }] });
  if (!v) return false;
  const entry = { key: theme ? theme.key : 'mk-' + Math.random().toString(36).slice(2, 8), label: v.label.slice(0, 40), navy: v.navy, ivory: v.ivory, gold: v.gold, premium: v.premium, version: theme ? (Number(theme.version) || 1) + 1 : 1 };
  if (!(await previewDialog(entry))) return false;
  const next = theme ? items.map((i) => (i.key === theme.key ? entry : i)) : [...items, entry];
  await writeThemes(next, entry, theme ? 'theme-update' : 'theme-publish');
  toast('Theme published (version ' + entry.version + ').');
  return true;
}
async function themeHistoryDialog(theme) {
  const snap = await getDocs(query(collection(db, 'themeHistory'), where('themeKey', '==', theme.key)));
  const rows = snap.docs.map((d) => d.data()).sort((a, b) => b.version - a.version);
  const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Versions of ' + theme.label),
    h('table', {}, h('thead', {}, h('tr', {}, ['Version', 'When', 'Colours', 'Premium', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, 'v' + r.version + (r.removed ? ' (removed)' : '')), h('td', {}, when(r.at)), h('td', {}, swatch(r)), h('td', {}, r.premium ? 'Yes' : 'No'),
        h('td', {}, r.removed ? null : h('button', { class: 'btn sm', onclick: () => guarded(async () => {
          if (!confirm('Roll ' + theme.label + ' back to version ' + r.version + '? Schools see it at once.')) return;
          const items = await readThemes();
          const entry = { key: theme.key, label: r.label, navy: r.navy, ivory: r.ivory, gold: r.gold, premium: r.premium, version: Math.max(...rows.map((x) => x.version)) + 1 };
          await writeThemes(items.map((i) => (i.key === theme.key ? entry : i)), entry, 'theme-rollback', 'rolled back to v' + r.version);
          dlg.close(); dlg.remove(); toast('Rolled back as version ' + entry.version + '.'); await viewThemes();
        }) }, 'Roll back to this')))))),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  document.body.append(dlg); dlg.showModal();
}
async function viewThemes() {
  setCrumbs('Themes');
  view().replaceChildren(loading('Loading themes.'));
  const items = await readThemes();
  const rows = items.map((t) => h('tr', {}, h('td', {}, h('b', {}, t.label), h('div', { class: 'muted' }, t.key)), h('td', {}, swatch(t)),
    h('td', {}, t.premium ? h('span', { class: 'pill warn' }, 'Premium') : 'Free'), h('td', {}, 'v' + (t.version || 1)),
    h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => guarded(async () => { await previewDialog(t); }) }, 'Preview'),
      h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await editTheme(t)) await viewThemes(); }) }, 'Update'),
      h('button', { class: 'btn sm', onclick: () => guarded(() => themeHistoryDialog(t)) }, 'Versions and rollback'),
      h('button', { class: 'btn sm red', onclick: () => guarded(async () => {
        if (!confirm('Remove ' + t.label + ' from the marketplace? Schools already using it keep their saved colours.')) return;
        await writeThemes(items.filter((i) => i.key !== t.key), { ...t, version: (Number(t.version) || 1) + 1, removed: true }, 'theme-remove');
        toast('Theme removed.'); await viewThemes();
      }) }, 'Remove')))));
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Themes'), h('button', { class: 'btn gold', onclick: () => guarded(async () => { if (await editTheme(null)) await viewThemes(); }) }, 'New theme')),
    h('p', { class: 'muted' }, 'Marketplace themes appear in each school owner\'s theme gallery. Every publish and update keeps a version, so you can roll back. Premium themes need the "Premium themes" feature on the school\'s plan.'),
    rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Theme', 'Colours', 'Type', 'Version', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))) : h('div', { class: 'empty' }, 'No marketplace themes yet.'));
}

// ---------- feature access ----------
const rollNum = (id) => [...id].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) % 100, 7);
async function loadCatalogue() {
  const snap = await getDocs(collection(db, 'featureCatalogue'));
  S.features = snap.docs.map((d) => ({ key: d.id, ...d.data() })).sort((a, b) => a.label.localeCompare(b.label));
  return S.features;
}
function computeEntitlements(school, features, overrides) {
  const off = []; const beta = []; const roles = {};
  const plan = school.billing ? school.billing.plan : '';
  for (const f of features) {
    const ov = overrides[f.key];
    let on;
    if (f.state === 'off') on = false;
    else if (ov === 'off') on = false;
    else if (ov === 'on') on = true;
    else if (f.state === 'beta') on = false;
    else if (f.plans.length && !f.plans.includes(plan)) on = false;
    else if (f.rollout < 100 && rollNum(school.id) >= f.rollout) on = false;
    else on = true;
    if (!on) off.push(f.key);
    if (f.state === 'beta') beta.push(f.key);
    if (f.roles.length) roles[f.key] = f.roles;
  }
  return { off, beta, roles };
}
async function overridesOf(schoolId) {
  const snap = await getDocs(collection(db, 'schools', schoolId, 'featureOverrides')).catch(() => null);
  const map = {}; for (const d of snap ? snap.docs : []) map[d.id] = d.data().mode;
  return map;
}
// Recomputes and saves the entitlements of the given schools (50 per batch).
async function publishEntitlements(schoolList, features) {
  const computed = [];
  await pool(schoolList, 10, async (school) => { computed.push([school, computeEntitlements(school, features, await overridesOf(school.id))]); });
  for (let i = 0; i < computed.length; i += 50) {
    const batch = writeBatch(db);
    for (const [school, e] of computed.slice(i, i + 50)) batch.set(doc(db, 'schools', school.id, 'entitlements', 'main'), { ...e, at: serverTimestamp() });
    await batch.commit();
  }
  return computed.length;
}
async function afterFeatureChange(note) {
  await loadSchools();
  const features = await loadCatalogue();
  const live = S.schools.filter((s) => !s.archived);
  const count = await publishEntitlements(live, features);
  const batch = writeBatch(db);
  audit(batch, 'feature-apply', '', '', note + ' (applied to ' + count + ' schools)');
  await batch.commit();
  return count;
}
async function editFeature(f) {
  await loadPlans();
  const v = await formDialog({ title: f ? 'Edit feature ' + f.label : 'New feature', ok: 'Save and apply',
    note: 'Only features wired into the app (website, finance, library, transport, portal, premium themes) change what schools see. New keys are recorded for later.',
    fields: [
      { key: 'key', label: 'Key (lowercase, fixed once created)', required: true, value: f ? f.key : '', readonly: Boolean(f), pattern: /^[a-z][a-z0-9-]{1,29}$/, patternText: 'Use 2 to 30 lowercase letters, numbers or dashes.' },
      { key: 'label', label: 'Name', required: true, value: f ? f.label : '' },
      { key: 'description', label: 'Description (optional)', value: f ? f.description || '' : '' },
      { key: 'state', label: 'State', type: 'select', options: [['live', 'Live for everyone it applies to'], ['beta', 'Beta (only schools you grant access)'], ['off', 'Off for every school']], value: f ? f.state : 'live' },
      { key: 'rollout', label: 'Gradual rollout, percent of schools (100 = all)', type: 'number', required: true, value: f ? f.rollout : 100 },
      { key: 'plans', label: 'Plans that include it, comma separated (empty = every plan). Plan IDs: trial, ' + S.plans.map((p) => p.id).join(', '), value: f ? f.plans.join(', ') : '' },
      { key: 'roles', label: 'Roles allowed to use it, comma separated from ' + ROLE_NAMES.join(', ') + ' (empty = all)', value: f ? f.roles.join(', ') : '' }],
  });
  if (!v) return false;
  if (v.rollout > 100) { toast('Rollout is a percent from 0 to 100.'); return false; }
  const roles = csv(v.roles).filter((r) => ROLE_NAMES.includes(r));
  const data = { label: v.label.slice(0, 60), ...(v.description ? { description: v.description.slice(0, 300) } : {}), state: v.state, rollout: v.rollout, plans: csv(v.plans).slice(0, 30), roles };
  const batch = writeBatch(db);
  batch.set(doc(db, 'featureCatalogue', v.key), data);
  audit(batch, f ? 'feature-edit' : 'feature-create', '', '', JSON.stringify({ key: v.key, before: f ? { state: f.state, rollout: f.rollout, plans: f.plans, roles: f.roles } : null, after: { state: data.state, rollout: data.rollout, plans: data.plans, roles } }));
  await batch.commit();
  const n = await afterFeatureChange('saved ' + v.key);
  toast('Saved and applied to ' + n + ' school(s).');
  return true;
}
async function featureHistoryDialog() {
  const snap = await getDocs(query(collection(db, 'platformAudit'), where('action', '>=', 'feature-'), where('action', '<=', 'feature-~'), limit(200)));
  const rows = snap.docs.map((d) => d.data()).sort((a, b) => (b.at && a.at ? b.at.toMillis() - a.at.toMillis() : 0));
  const dlg = h('dialog', { class: 'dlg' }, h('h3', {}, 'Feature change history'),
    rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'School', 'Detail'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.actorEmail || ''), h('td', {}, r.action), h('td', {}, r.schoolId || 'all'), h('td', { class: 'muted', style: 'word-break:break-word;max-width:320px' }, r.detail || ''))))) : h('div', { class: 'empty' }, 'No changes yet.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  document.body.append(dlg); dlg.showModal();
}
async function viewFeatures() {
  setCrumbs('Feature access');
  view().replaceChildren(loading('Loading the feature catalogue.'));
  await Promise.all([loadSchools(), loadPlans()]);
  const features = await loadCatalogue();
  const refresh = () => viewFeatures();
  const rows = features.map((f) => h('tr', {},
    h('td', {}, h('b', {}, f.label), h('div', { class: 'muted' }, f.key + (f.description ? ' - ' + f.description : ''))),
    h('td', {}, h('span', { class: 'pill ' + (f.state === 'live' ? 'ok' : f.state === 'beta' ? 'warn' : 'bad') }, f.state)),
    h('td', {}, f.rollout + '%'), h('td', { class: 'muted' }, f.plans.length ? f.plans.join(', ') : 'Every plan'), h('td', { class: 'muted' }, f.roles.length ? f.roles.join(', ') : 'All roles'),
    h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => guarded(async () => { if (await editFeature(f)) await refresh(); }) }, 'Edit'),
      h('button', { class: 'btn sm red', onclick: () => guarded(async () => {
        if (!confirm('Remove ' + f.label + ' from the catalogue? Every school gets it back, unless another switch hides it.')) return;
        const batch = writeBatch(db); batch.delete(doc(db, 'featureCatalogue', f.key)); audit(batch, 'feature-delete', '', '', f.key); await batch.commit();
        await afterFeatureChange('deleted ' + f.key); await refresh();
      }) }, 'Remove')))));
  view().replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Feature access'),
      h('button', { class: 'btn', onclick: () => guarded(() => featureHistoryDialog()) }, 'Change history'),
      h('button', { class: 'btn', onclick: () => guarded(async () => { const n = await afterFeatureChange('manual recompute'); toast('Applied to ' + n + ' school(s).'); }) }, 'Apply to all schools'),
      h('button', { class: 'btn gold', onclick: () => guarded(async () => { if (await editFeature(null)) await refresh(); }) }, 'New feature')),
    h('p', { class: 'muted' }, 'The catalogue decides what each school sees: by plan, by rollout percentage, by beta access, by role, and per school (open a school to override). This hides modules in the app; it does not yet block the underlying records.'),
    features.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Feature', 'State', 'Rollout', 'Plans', 'Roles', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows)))
      : h('div', { class: 'card' }, h('div', { class: 'empty' }, 'The catalogue is empty.'), h('div', { class: 'row end' }, h('button', { class: 'btn gold', onclick: () => guarded(async () => {
        const batch = writeBatch(db);
        for (const [key, label, description] of SEEDS) batch.set(doc(db, 'featureCatalogue', key), { label, description, state: 'live', rollout: 100, plans: [], roles: [] });
        audit(batch, 'feature-seed', '', '', SEEDS.map((x) => x[0]).join(', ')); await batch.commit();
        await afterFeatureChange('seeded standard features'); await refresh();
      }) }, 'Add the standard features'))));
}
// Per-school overrides, shown on the school page.
async function schoolFeaturesCard(school) {
  const features = await loadCatalogue();
  const ov = await overridesOf(school.id);
  const ent = computeEntitlements(school, features, ov);
  const rows = features.map((f) => {
    const select = h('select', {}, [['', 'Follow the catalogue'], ['on', 'Always on'], ['off', 'Always off']].map(([v, t]) => h('option', { value: v }, t)));
    select.value = ov[f.key] || '';
    select.addEventListener('change', () => guarded(async () => {
      const batch = writeBatch(db);
      if (select.value) batch.set(doc(db, 'schools', school.id, 'featureOverrides', f.key), { mode: select.value }); else batch.delete(doc(db, 'schools', school.id, 'featureOverrides', f.key));
      audit(batch, 'feature-override', school.id, '', JSON.stringify({ feature: f.key, mode: select.value || 'catalogue' }));
      await batch.commit();
      ov[f.key] = select.value;
      await publishEntitlements([school], features);
      toast('Saved for ' + school.name + '.');
    }));
    const isOn = !ent.off.includes(f.key);
    return h('tr', {}, h('td', {}, f.label, f.state === 'beta' ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'beta') : null), h('td', {}, h('span', { class: 'pill ' + (isOn ? 'ok' : 'bad') }, isOn ? 'on' : 'off')), h('td', {}, select));
  });
  return h('div', { class: 'card' }, h('h3', {}, 'Feature access for this school'),
    features.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Feature', 'Now', 'Override'].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
      : h('div', { class: 'empty' }, 'No features in the catalogue yet. Open Feature access first.'),
    h('p', { class: 'muted' }, 'Beta features are off for everyone until you choose "Always on" for a school.'));
}

// ---------- storage ----------
const effectiveMb = (s) => Math.max(Number(s.usage && s.usage.storageMb) || 0, Number(s.billing && s.billing.storageCheckedMb) || 0);
async function viewStorage() {
  setCrumbs('Storage');
  view().replaceChildren(loading('Loading storage use.'));
  await loadSchools();
  const retentionSnap = await getDoc(doc(db, 'platformConfig', 'retention')).catch(() => null);
  const retention = retentionSnap && retentionSnap.exists() ? retentionSnap.data() : { selfieDays: 365, visitorDays: 365, messageDays: 730, archivedSchoolDays: 365 };
  const refresh = async () => { await loadSchools(true); await viewStorage(); };
  const live = S.schools.filter((s) => !s.archived && s.billing).map((s) => ({ s, used: effectiveMb(s), limit: Number(s.billing.storageMb) || 0 }))
    .map((r) => ({ ...r, pct: r.limit ? Math.round(r.used / r.limit * 100) : 0 })).sort((a, b) => b.pct - a.pct);
  const level = (pct) => (pct >= 100 ? ['bad', 'Over limit'] : pct >= 90 ? ['bad', 'Warning'] : pct >= 80 ? ['warn', 'Getting full'] : ['ok', 'Fine']);
  const rows = live.map(({ s, used, limit, pct }) => {
    const reported = Number(s.usage && s.usage.storageMb) || 0; const checked = s.billing.storageCheckedMb;
    const mismatch = checked != null && reported && Math.abs(checked - reported) / Math.max(checked, reported) > 0.1;
    const [cls, text] = level(pct);
    return h('tr', {}, h('td', {}, h('a', { href: '#/school/' + s.id }, s.name)),
      h('td', {}, barRow('', Math.min(pct, 100), 100, pct + '%')), h('td', {}, num(used) + ' of ' + num(limit) + ' MB'),
      h('td', {}, h('span', { class: 'pill ' + cls }, text)),
      h('td', { class: 'muted' }, 'Reported ' + num(reported) + ' MB' + (checked != null ? '; measured ' + num(checked) + ' MB on ' + (s.billing.storageCheckedOn || '?') : '; not measured') + (mismatch ? ' (differs by more than 10%)' : '')),
      h('td', {}, h('div', { class: 'row' },
        pct >= 80 ? h('button', { class: 'btn sm', onclick: () => guarded(async () => { await sendMessage({ kind: 'targeted', title: 'Your storage is ' + (pct >= 100 ? 'full' : 'almost full'), body: 'Your school has used ' + pct + '% of its storage. Ask AZIZ for more space or remove files you no longer need.', audience: 'Storage warning: ' + s.name, recipients: [s.id] }); }) }, 'Warn school') : null,
        h('button', { class: 'btn sm', onclick: () => guarded(async () => {
          const v = await formDialog({ title: 'Record measured storage for ' + s.name, ok: 'Save', note: 'Read the school\'s folder size in the Firebase console (Storage) and enter it here. The larger of reported and measured is used for warnings.',
            fields: [{ key: 'mb', label: 'Measured storage (MB)', type: 'number', required: true, value: checked != null ? checked : reported }] });
          if (!v) return;
          const batch = writeBatch(db);
          batch.update(doc(db, 'schools', s.id, 'billing', 'main'), { storageCheckedMb: v.mb, storageCheckedOn: today() });
          audit(batch, 'storage-reconcile', s.id, '', JSON.stringify({ reported, measured: v.mb }));
          await batch.commit(); toast('Saved.'); await refresh();
        }) }, 'Reconcile'))));
  });
  const over = live.filter((r) => r.pct >= 90).length;
  view().replaceChildren(h('h2', {}, 'Storage'),
    h('div', { class: 'grid' }, stat('Schools', num(live.length)), stat('At 80% or more', num(live.filter((r) => r.pct >= 80).length)), stat('At 90% or more', num(over)), stat('Used in total', num(live.reduce((t, r) => t + r.used, 0)) + ' MB')),
    h('div', { style: 'height:14px' }),
    live.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['School', 'Use', 'Amount', 'Level', 'Reconciliation', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))) : h('div', { class: 'empty' }, 'No schools with a plan yet.'),
    h('p', { class: 'muted' }, 'Reported use comes from each school\'s own app. Measured use is what you read from the Firebase console. Automatic measuring needs a Cloud Function and is not built yet.'),
    h('div', { style: 'height:14px' }),
    h('div', { class: 'card' }, h('h3', {}, 'Retention policy'),
      h('p', { class: 'muted' }, 'How long records are kept. This is the published policy. Old records are not deleted automatically yet.'),
      h('p', {}, 'Staff selfies: ' + retention.selfieDays + ' days | Visitor logs: ' + retention.visitorDays + ' days | Messages: ' + retention.messageDays + ' days | Archived schools: ' + retention.archivedSchoolDays + ' days'),
      h('button', { class: 'btn', onclick: () => guarded(async () => {
        const v = await formDialog({ title: 'Retention policy', ok: 'Save', fields: [
          { key: 'selfieDays', label: 'Staff selfies (days)', type: 'number', required: true, value: retention.selfieDays }, { key: 'visitorDays', label: 'Visitor logs (days)', type: 'number', required: true, value: retention.visitorDays },
          { key: 'messageDays', label: 'Messages (days)', type: 'number', required: true, value: retention.messageDays }, { key: 'archivedSchoolDays', label: 'Archived schools, before deletion is allowed (days, 30 or more)', type: 'number', required: true, value: retention.archivedSchoolDays }, REASON] });
        if (!v) return;
        if (v.selfieDays < 1 || v.visitorDays < 1 || v.messageDays < 1 || v.archivedSchoolDays < 30) { toast('Check the numbers: at least 1 day, and 30 for archived schools.'); return; }
        const batch = writeBatch(db);
        batch.set(doc(db, 'platformConfig', 'retention'), { selfieDays: v.selfieDays, visitorDays: v.visitorDays, messageDays: v.messageDays, archivedSchoolDays: v.archivedSchoolDays });
        audit(batch, 'retention-policy', '', v.reason, JSON.stringify({ selfieDays: v.selfieDays, visitorDays: v.visitorDays, messageDays: v.messageDays, archivedSchoolDays: v.archivedSchoolDays }));
        await batch.commit(); toast('Policy saved.'); await refresh();
      }) }, 'Change policy')));
}

// ---------- routing ----------
async function route() {
  const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'dashboard';
  for (const a of document.querySelectorAll('nav.side a.item[data-r]')) a.classList.toggle('on', a.dataset.r === (name === 'school' ? 'schools' : name));
  await guarded(async () => {
    if (name === 'schools') await viewSchools();
    else if (name === 'school') await viewSchool(decodeURIComponent(parts[1] || ''));
    else if (name === 'owners') await viewOwners();
    else if (name === 'plans') await viewPlans();
    else if (name === 'billing') await viewBilling();
    else if (name === 'analytics') await viewAnalytics();
    else if (name === 'notifications') await viewNotifications();
    else if (name === 'trials') await viewTrials();
    else if (name === 'domains') await viewDomains();
    else if (name === 'themes') await viewThemes();
    else if (name === 'features') await viewFeatures();
    else if (name === 'storage') await viewStorage();
    else if (name === 'audit') await viewAudit();
    else if (name === 'security') await viewSecurity();
    else await viewDashboard();
  }).then(() => {});
}

function wireTop() {
  const box = $('gsearch'); const hits = $('hits');
  box.addEventListener('input', async () => {
    const words = box.value.trim().toLowerCase();
    if (words.length < 2) { hits.hidden = true; return; }
    await guarded(loadSchools);
    const found = S.schools.filter((s) => [s.name, s.id, s.contactEmail].some((v) => String(v || '').toLowerCase().includes(words))).slice(0, 8);
    hits.replaceChildren(...(found.length ? found.map((s) => h('a', { href: '#/school/' + s.id, onclick: () => { hits.hidden = true; box.value = ''; } }, s.name + ' (' + s.id + ')')) : [h('a', { href: '#/schools' }, 'No school found')]));
    hits.hidden = false;
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.search')) hits.hidden = true; if (!event.target.closest('#menu')) $('menu').classList.remove('open'); });
  $('switcher').addEventListener('change', (event) => { if (event.target.value) location.hash = '#/school/' + event.target.value; event.target.value = ''; });
  $('bell').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('menuBtn').addEventListener('click', () => $('menu').classList.toggle('open'));
  $('out').addEventListener('click', async () => { await signOut(auth); location.href = '/app'; });
  addEventListener('hashchange', route);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('/app'); return; }
  let isAdmin = false;
  try { isAdmin = (await getDocFromServer(doc(db, 'platformAdmins', user.uid))).exists(); } catch { isAdmin = false; }
  if (!isAdmin) {
    $('gate').replaceChildren(h('div', { style: 'text-align:center' }, h('h2', {}, 'Super admin only'), h('p', { class: 'muted' }, 'This account is not a platform administrator.'), h('a', { href: '/app' }, 'Go to the school app')));
    return;
  }
  S.user = user;
  $('who').textContent = user.email || user.uid;
  $('gate').hidden = true; $('gate').style.display = 'none'; $('shell').hidden = false;
  wireTop();
  route();
});
