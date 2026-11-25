// Super Admin page (Batch 76, Mark 1). Platform administrators only: the database rules decide who may read or write, not this file.
// Every change writes a permanent entry to platformAudit in the same batch.
import { app } from './firebase-client.mjs';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail, multiFactor, TotpMultiFactorGenerator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
  query, where, orderBy, limit, documentId, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const S = { user: null, role: 'admin', staff: null, schools: [], plans: [], loaded: false, alerts: [], opsAlerts: [], limits: null, ownersCache: null };

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
// replaceChildren turns a null child into the text "null" (it showed under the school list). Drop empty children before it runs.
const nativeReplaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildrenWithoutNull(...kids) {
  return nativeReplaceChildren.apply(this, kids.filter((kid) => kid !== null && kid !== undefined && kid !== false));
};
// Platform locale (Batch 87): currency, time zone and date style from platformConfig/locale apply to this admin panel. Defaults match the old behaviour.
let LOCALE = { currency: 'INR', timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY' };
const SYMBOLS = { INR: '₹', BDT: '৳', NPR: 'Rs ', AED: 'AED ', USD: '$' };
const money = (n) => (SYMBOLS[LOCALE.currency] || '₹') + (Number(n) || 0).toLocaleString('en-IN');
const num = (n) => (Number(n) || 0).toLocaleString('en-IN');
const newId = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const today = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: LOCALE.timezone }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
const when = (t) => {
  if (!(t && t.toDate)) return '';
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: LOCALE.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t.toDate()).map((x) => [x.type, x.value]));
    const date = LOCALE.dateFormat === 'MM/DD/YYYY' ? p.month + '/' + p.day + '/' + p.year : LOCALE.dateFormat === 'YYYY-MM-DD' ? p.year + '-' + p.month + '-' + p.day : p.day + '/' + p.month + '/' + p.year;
    return date + ', ' + p.hour + ':' + p.minute;
  } catch { return t.toDate().toLocaleString('en-IN'); }
};
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
  updateBell();
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
        h('a', { href: '#/school/' + a.school.id }, a.school.name), h('span', { class: 'muted' }, a.text))) : h('div', { class: 'empty' }, 'No alerts. Every school looks healthy.')),
    ...((S.opsAlerts || []).length ? [h('div', { class: 'card' }, h('h3', {}, 'Operations alerts'), S.opsAlerts.map((a) => h('div', { class: 'alert' }, h('span', { class: 'pill ' + a.level }, a.level === 'bad' ? 'Act' : 'Watch'), h('a', { href: a.href }, a.text))))] : []));
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
    h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'All schools (' + S.schools.length + ')'), h('button', { class: 'btn gold', onclick: () => { location.hash = '#/schools/register'; } }, 'Register a school')),
    h('div', { class: 'row' }, searchBox, filter),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['School', 'Plan', 'Status', 'Students', 'Staff', 'Contact'].map((t) => h('th', {}, t)))), body)),
    S.schools.length > 300 ? h('p', { class: 'muted' }, 'Showing the first 300 matches. Use the search to narrow it.') : null);
  draw();
}

// Registration wizard (Batch 98, Mark 1): a full-screen page at #/schools/register[/draftId], in its own file.
function closeOnboarding() {
  const open = document.getElementById('onb');
  if (open) { if (open._cleanup) open._cleanup(); open.remove(); document.body.style.overflow = ''; }
}
async function openRegister(draftId) {
  if (!isAdmin()) { toast('Only a platform administrator can register schools.'); location.hash = '#/schools'; return; }
  const mod = await import('./onboarding.mjs?v=batch-101');
  await mod.mountOnboarding({
    db, app, user: S.user, h, toast, friendly,
    plans: async () => {
      await loadPlans();
      return [['trial', 'Free 30-day trial'], ['trial60', 'Free 60-day trial'], ['trial90', 'Free 90-day trial']].concat(S.plans.filter((p) => p.active).map((p) => [p.id, p.name + ' (' + money(p.monthlyPrice) + '/month)']));
    },
    goSchool: async (id) => { await loadSchools(true); location.hash = '#/school/' + id; },
  }, draftId);
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

  // Registration record (Mark 4): verification, the owner's consent and activation. Loaded from the server because the record is not readable in the browser.
  const regBody = h('div', {}, h('span', { class: 'spin' }), ' Loading.');
  const regCard = h('div', { class: 'card' }, h('h3', {}, 'Registration, consent and activation'), regBody);
  (async () => {
    try {
      const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
      const fn = (name, data) => httpsCallable(getFunctions(app, 'asia-south1'), name)(data).then((r) => r.data);
      const r = await fn('getRegistrationStatus', { schoolId: school.id });
      if (!r.found) { regBody.replaceChildren(h('p', { class: 'muted' }, 'This school was not registered through the registration wizard, so there is no registration record.')); return; }
      const paise = (n) => money(Number(n || 0) / 100);
      regBody.replaceChildren(
        h('p', {}, 'Plan: ', h('b', {}, r.plan.name), ' (' + r.plan.cycle + ', ' + paise(r.plan.recurringMinor) + (r.plan.discountPercent ? ' after ' + r.plan.discountPercent + '% off' : '') + ', setup ' + paise(r.plan.setupMinor) + (r.plan.trial ? ', free trial ' + r.plan.trialDays + ' days' : '') + ')'),
        h('p', {}, 'Verification: ', h('span', { class: 'pill ' + (r.verificationStatus === 'Verified' ? 'ok' : r.verificationStatus === 'Rejected' ? 'bad' : 'warn') }, r.verificationStatus)),
        h('p', {}, 'Owner consent: ', r.consent.status === 'accepted' ? h('span', { class: 'pill ok' }, 'Accepted by ' + r.consent.by + ' on ' + new Date(r.consent.at).toLocaleDateString('en-IN')) : h('span', { class: 'pill warn' }, 'Pending the owner')),
        h('p', {}, 'Activation: ', h('span', { class: 'pill ' + (r.activationStatus === 'Active' ? 'ok' : 'warn') }, r.activationStatus)),
        h('p', { class: 'muted' }, 'Website published: ' + (r.siteWebsitePublished ? 'yes' : 'no') + (r.domain ? ' | custom domain: ' + (r.domain.customDomain ? r.domain.customDomainStatus + ' (HTTPS ' + r.domain.ssl + ')' : 'none') : '') + ' | ' + r.files + ' file(s) uploaded'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => guarded(async () => {
            const v = await formDialog({ title: 'Verification status for ' + school.name, ok: 'Save', fields: [{ key: 'status', label: 'Status', type: 'select', options: ['Unverified', 'Documents received', 'Verified', 'Rejected'].map((x) => [x, x]), value: r.verificationStatus }, REASON] });
            if (!v) return;
            await fn('setVerificationStatus', { schoolId: school.id, status: v.status, reason: v.reason }); toast('Verification status saved.'); await refresh();
          }) }, 'Set verification'),
          r.activationStatus === 'Active' ? null : h('button', { class: 'btn gold', onclick: () => guarded(async () => {
            const v = await formDialog({ title: 'Activate ' + school.name, note: 'Needs the school marked Verified and the owner\'s acceptance of the current terms and privacy agreement.', ok: 'Activate', fields: [REASON] });
            if (!v) return;
            await fn('activateSchool', { schoolId: school.id, reason: v.reason }); toast('School activated.'); await refresh();
          }) }, 'Activate registration')));
    } catch (error) { regBody.replaceChildren(h('p', { class: 'muted' }, 'Could not load the registration record. ' + (error?.message || ''))); }
  })();

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
  view().replaceChildren(h('h2', {}, school.name), h('div', { class: 'two' }, profile, planCard, usageCard), h('div', { style: 'height:14px' }), regCard, h('div', { style: 'height:14px' }), ownersCard, h('div', { style: 'height:14px' }), invoicesCard, h('div', { style: 'height:14px' }), await schoolLocationCard(school, refresh), h('div', { style: 'height:14px' }), await schoolFeaturesCard(school));
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

async function viewSecurity() {
  setCrumbs('Security and access');
  view().replaceChildren(loading('Loading.'));
  const [grants, cfg, fl] = await Promise.all([getDocs(collection(db, 'platformGrants')), getDoc(doc(db, 'platformConfig', 'security')).catch(() => null), getDoc(doc(db, 'platformJobs', 'failedLogins')).catch(() => null)]);
  const fails = fl && fl.exists() ? fl.data() : null;
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
  // Failed sign-ins (Batch 86): written once an hour by the server job from Identity Platform's activity log.
  const scanNow = () => guarded(async () => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    let r;
    try { r = (await httpsCallable(getFunctions(app, 'asia-south1'), 'runLoginScanNow')()).data; } catch { toast('Could not run it. Check that the server functions are deployed.'); return; }
    toast(r.ok ? (r.note || r.failed + ' failed sign-in(s) in the last 24 hours.') : (r.hint || r.error || 'Not available.'));
    await viewSecurity();
  });
  const failCard = h('div', { class: 'card' }, h('h3', {}, 'Failed sign-ins (last 24 hours)'),
    !fails ? h('p', { class: 'muted' }, 'Not scanned yet. This needs Identity Platform with user activity logging on. The server job runs every hour.')
      : !fails.ok ? h('div', { class: 'alert' }, h('span', { class: 'pill bad' }, 'Not available'), h('span', {}, (fails.hint ? fails.hint + ' ' : '') + (fails.error || '')))
        : [h('p', {}, h('b', {}, num(fails.failed)), ' failed out of ', num(fails.attempts), ' password sign-ins. Scanned ', ago(msOf(fails)), '.'),
          fails.note ? h('p', { class: 'muted' }, fails.note) : null,
          fails.suspicious && fails.suspicious.length ? h('div', { class: 'alert' }, h('span', { class: 'pill bad' }, 'Watch'), h('span', {}, fails.suspicious.length + ' address(es) failed 5 or more times: ' + fails.suspicious.map((x) => x.email + ' (' + x.count + ')').join(', '))) : null,
          fails.byEmail && fails.byEmail.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Email (masked)', 'Failures'].map((t) => h('th', {}, t)))),
            h('tbody', {}, fails.byEmail.map((x) => h('tr', {}, h('td', {}, x.email), h('td', {}, num(x.count))))))) : null],
    isAdmin() ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: scanNow }, 'Scan now')) : null);
  // Authenticator app enrolment (Batch 87). Needs Identity Platform with TOTP switched on. After enrolling, sign-in at /app asks for the 6-digit code.
  const mfaHolder = h('div', {});
  const enrolled = multiFactor(auth.currentUser).enrolledFactors.length;
  const startEnrol = () => guarded(async () => {
    let secret;
    try { secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(auth.currentUser).getSession()); }
    catch (error) { toast(error.code === 'auth/requires-recent-login' ? 'Sign out and sign in again, then try once more.' : 'Authenticator apps are not switched on yet. In the Firebase console open Authentication, Sign-in method, Multi-factor authentication, and enable it with TOTP.'); return; }
    const canvas = document.createElement('canvas');
    let qrOk = false;
    try { const { drawQr } = await import('./qr.mjs?v=batch-64'); drawQr(canvas, secret.generateQrCodeUrl('admin', 'AZIZ'), 200); qrOk = true; } catch { qrOk = false; }
    const code = h('input', { inputmode: 'numeric', maxlength: '6', placeholder: '6-digit code' });
    const confirmBtn = h('button', { class: 'btn gold', onclick: () => guarded(async () => {
      try { await multiFactor(auth.currentUser).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.value.trim()), 'Authenticator app'); }
      catch { toast('That code did not work. Wait for a new code and try again.'); return; }
      toast('Authenticator app added. Sign-in now asks for its code.'); await viewSecurity();
    }) }, 'Confirm and turn on');
    mfaHolder.replaceChildren(h('p', {}, 'Scan this with Google Authenticator, Microsoft Authenticator or similar, or type the key by hand:'), qrOk ? canvas : null,
      h('p', { class: 'muted', style: 'word-break:break-all' }, 'Key: ' + secret.secretKey), h('div', { class: 'row' }, code, confirmBtn));
  });
  const mfaEnrolCard = h('div', { class: 'card' }, h('h3', {}, 'Your authenticator app'),
    h('p', {}, enrolled ? 'You have ' + enrolled + ' second factor(s). Sign-in at /app asks for the 6-digit code.' : 'No second factor yet. Add one before turning on the MFA requirement.'),
    h('p', { class: 'muted' }, 'Test sign-in in a private window right after adding it. If you are ever locked out, the project owner can remove the factor through the Firebase Admin tools.'),
    enrolled ? null : h('button', { class: 'btn', onclick: startEnrol }, 'Set up an authenticator app'), mfaHolder);
  view().replaceChildren(h('h2', {}, 'Security and access'),
    failCard, mfaEnrolCard,
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
  const payLines = S.pay ? [S.pay.gstNumber ? 'Tax number: ' + S.pay.gstNumber : '', S.pay.upiId ? 'UPI: ' + S.pay.upiId : '', S.pay.bankDetails || '', S.pay.instructions || ''].filter(Boolean) : [];
  const body = h('div', {}, h('h1', {}, 'AZIZ School Management System'), h('p', { class: 'mut' }, 'Tax invoice'),
    h('p', {}, h('b', {}, 'Invoice: '), inv.id, h('br'), h('b', {}, 'Period: '), inv.period, h('br'), h('b', {}, 'Due: '), inv.dueOn, h('br'), h('b', {}, 'Status: '), inv.status),
    h('p', {}, h('b', {}, 'Billed to: '), school.name, h('br'), school.address || '', school.address ? h('br') : null, school.contactEmail || ''),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Description'), h('th', { class: 'r' }, 'Amount'))),
      h('tbody', {}, line((inv.kind === 'setup' ? 'Setup fee' : 'Subscription') + ' ' + inv.period + (inv.note ? ' (' + inv.note + ')' : ''), money(inv.amount)),
        line('Received', money(inv.amountPaid || 0)), (inv.refunded ? line('Refunded', money(inv.refunded)) : null), line('Balance due', money(owing(inv)), 'tot'))),
    payLines.length ? h('p', {}, h('b', {}, 'How to pay'), ...payLines.flatMap((t) => [h('br'), t])) : null,
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
  if (isAdmin()) S.pay = await readSettingDoc('payment');
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
// ---------- Teacher check-in location (Batch 88) ----------
// The check-in rules (distance, GPS accuracy, live selfie, school QR) are enforced by the database rules from settings/location.
// This card is the Super Admin way to set that document without leaving the panel.
const TZ_OPTIONS = [['330', 'India (UTC+5:30)'], ['345', 'Nepal (UTC+5:45)'], ['360', 'Bangladesh (UTC+6:00)'], ['300', 'Pakistan (UTC+5:00)'], ['240', 'UAE (UTC+4:00)'], ['0', 'UTC (UTC+0:00)']];
function parseCoordinates(text) {
  const clean = String(text || '').trim();
  const patterns = [/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/, /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d{1,2}(?:\.\d+)?)(?:,|%2C)(-?\d{1,3}(?:\.\d+)?)/, /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/];
  for (const pattern of patterns) {
    const m = clean.match(pattern);
    if (m) { const lat = Number(m[1]); const lng = Number(m[2]); if (Math.abs(lat) <= 66 && Math.abs(lng) <= 180) return { lat, lng }; }
  }
  return null;
}
async function schoolLocationCard(school, refresh) {
  let loc = null;
  try { const snap = await getDocFromServer(doc(db, 'schools', school.id, 'settings', 'location')); loc = snap.exists() ? snap.data() : null; } catch { loc = null; }
  const body = loc
    ? [h('p', {}, 'Teachers must be within ', h('b', {}, loc.radiusM + ' m'), ' of the school, with GPS accurate to ', h('b', {}, loc.maxAccuracyM + ' m'), ' or better.'),
      h('p', { class: 'muted' }, 'Point: ' + Number(loc.lat).toFixed(6) + ', ' + Number(loc.lng).toFixed(6) + ' | Live selfie: ' + (loc.selfieRequired ? 'required' : 'off') + ' | School QR code: ' + (loc.qrRequired ? 'required' : 'off')),
      h('p', { class: 'muted' }, 'Each check-in and check-out saves the server time, GPS position and (if on) a selfie stamped with date and time. Hours at school are worked out from the pair.'),
      h('p', {}, h('a', { href: 'https://www.google.com/maps?q=' + loc.lat + ',' + loc.lng, target: '_blank', rel: 'noopener' }, 'Open this point on the map'))]
    : [h('p', { class: 'muted' }, 'Not set. Teachers cannot check in until a school location is saved.')];
  const edit = async () => {
    const v = await formDialog({
      title: 'Teacher check-in location - ' + school.name,
      note: 'Stand at the school gate or office, drop a pin in Google Maps, copy the two numbers (like 26.7271, 88.3953) or the whole map link, and paste it below. The check-in distance cannot be below 30 metres, because phone GPS is not reliable closer than that.',
      ok: 'Save location',
      fields: [
        { key: 'paste', label: 'Paste coordinates or a Google Maps link (fills latitude and longitude)', placeholder: loc ? '' : 'e.g. 26.7271, 88.3953' },
        { key: 'lat', label: 'Latitude', value: loc ? loc.lat : '', placeholder: 'e.g. 26.7271' },
        { key: 'lng', label: 'Longitude', value: loc ? loc.lng : '', placeholder: 'e.g. 88.3953' },
        { key: 'radiusM', label: 'Check-in distance in metres (30 to 500)', type: 'number', value: loc ? loc.radiusM : 30 },
        { key: 'maxAccuracyM', label: 'Worst GPS accuracy accepted in metres (10 to 100)', type: 'number', value: loc ? loc.maxAccuracyM : 30 },
        { key: 'tzMinutes', label: 'School time zone', type: 'select', options: TZ_OPTIONS, value: loc ? String(loc.tzMinutes) : '330' },
        { key: 'selfieRequired', label: 'Teacher must take a live selfie at check-in and check-out', type: 'checkbox', value: loc ? loc.selfieRequired === true : true },
        { key: 'qrRequired', label: 'Teacher must also scan the school QR code', type: 'checkbox', value: loc ? loc.qrRequired === true : false },
        REASON,
      ],
    });
    if (!v) return false;
    let lat = Number(v.lat); let lng = Number(v.lng);
    if (v.paste) { const found = parseCoordinates(v.paste); if (!found) { toast('Could not read two coordinates from what you pasted.'); return false; } lat = found.lat; lng = found.lng; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (v.lat === '' && !v.paste) || (v.lng === '' && !v.paste)) { toast('Enter the latitude and longitude.'); return false; }
    if (Math.abs(lat) > 66 || Math.abs(lng) > 180) { toast('Those coordinates are outside the supported range.'); return false; }
    if (!(v.radiusM >= 30 && v.radiusM <= 500)) { toast('The check-in distance must be from 30 to 500 metres.'); return false; }
    if (!(v.maxAccuracyM >= 10 && v.maxAccuracyM <= 100)) { toast('The accepted GPS accuracy must be from 10 to 100 metres.'); return false; }
    lat = Math.round(lat * 1e6) / 1e6; lng = Math.round(lng * 1e6) / 1e6;
    const batch = writeBatch(db);
    batch.set(doc(db, 'schools', school.id, 'settings', 'location'), { lat, lng, radiusM: v.radiusM, maxAccuracyM: v.maxAccuracyM, tzMinutes: Number(v.tzMinutes),
      qrRequired: v.qrRequired === true, selfieRequired: v.selfieRequired === true, setBy: S.user.uid, setOn: serverTimestamp() });
    audit(batch, 'set-school-location', school.id, v.reason, JSON.stringify({ lat, lng, radiusM: v.radiusM, maxAccuracyM: v.maxAccuracyM, selfie: v.selfieRequired === true, qr: v.qrRequired === true }));
    await batch.commit();
    toast('Check-in location saved.');
    return true;
  };
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1' }, 'Teacher check-in location and selfie'),
    h('button', { class: 'btn sm gold', onclick: () => guarded(async () => { if (await edit()) await refresh(); }) }, loc ? 'Change' : 'Set location')), body);
}

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

// ---------- Mark 4: operations and security (Batch 79) ----------
// Internal staff get limited access: the database rules decide what each permission may read or change. This page only hides what a person cannot use.
const show = (...parts) => view().replaceChildren(...parts.flat().filter((p) => p !== null && p !== undefined && p !== false));
const isAdmin = () => S.role === 'admin';
const can = (perm) => isAdmin() || Boolean(S.staff && S.staff.perms && S.staff.perms[perm] === true);
const ROUTE_PERM = { support: 'support', billing: 'finance', audit: 'audit', incidents: 'audit', infra: 'ops', backups: 'ops' };
const routeAllowed = (name) => isAdmin() || (name === 'reports' ? can('finance') || can('support') : ROUTE_PERM[name] !== undefined && can(ROUTE_PERM[name]));
const ROLE_PRESETS = { support: ['support'], finance: ['finance'], auditor: ['audit'], operations: ['ops', 'support'] };
const ROLE_LABEL = { support: 'Support', finance: 'Finance', auditor: 'Auditor', operations: 'Operations' };
const PERM_LABEL = { support: 'Support tickets', finance: 'Finance (read only)', audit: 'Audit log and incidents', ops: 'Infrastructure and backups' };
const permsFor = (role, extras) => {
  const out = { support: false, finance: false, audit: false, ops: false };
  for (const key of ROLE_PRESETS[role] || []) out[key] = true;
  for (const key of extras || []) out[key] = true;
  return out;
};
const permText = (perms) => Object.keys(PERM_LABEL).filter((k) => perms && perms[k] === true).map((k) => PERM_LABEL[k]).join(', ') || 'none';
const msOf = (r) => (r && r.at && r.at.toMillis ? r.at.toMillis() : 0);
const ago = (ms) => {
  if (!ms) return 'never';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return Math.max(mins, 0) + ' min ago';
  if (mins < 2880) return Math.round(mins / 60) + ' h ago';
  return Math.round(mins / 1440) + ' days ago';
};
function meter(used, limit, label) {
  const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const cls = pct >= 100 ? 'bad' : pct >= (S.limits ? S.limits.alertPct : 80) ? 'warn' : '';
  return h('div', {}, h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', {}, label), h('span', { class: 'muted' }, num(used) + ' of ' + num(limit) + ' (' + pct + '%)')),
    h('div', { class: 'meter ' + cls }, h('i', { style: 'width:' + pct + '%' })));
}
function exportCsv(name, header, rows) {
  const safe = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const text = [header, ...rows].map((r) => r.map(safe).join(',')).join('\r\n');
  const link = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.append(link); link.click(); link.remove();
}
function applyRoleToPage() {
  const side = document.querySelectorAll('nav.side a.item[data-r]');
  for (const a of side) a.hidden = !routeAllowed(a.dataset.r);
  const staffOnly = !isAdmin();
  for (const el of document.querySelectorAll('nav.side a.item:not([data-r])')) el.hidden = staffOnly;
  for (const el of document.querySelectorAll('[data-adminonly]')) el.hidden = staffOnly;
  if (staffOnly) {
    $('switcher').hidden = true; $('gsearch').parentElement.hidden = true; $('bell').hidden = true;
    $('who').textContent = ($('who').textContent || '') + ' (' + (ROLE_LABEL[S.staff.role] || 'staff') + ')';
  }
  const seps = [...document.querySelectorAll('nav.side .sep')];
  for (const sep of seps) {
    let next = sep.nextElementSibling; let any = false;
    while (next && !next.classList.contains('sep')) { if (!next.hidden) any = true; next = next.nextElementSibling; }
    sep.hidden = !any;
  }
}
function firstAllowedRoute() {
  if (isAdmin()) return 'dashboard';
  return ['support', 'billing', 'reports', 'audit', 'incidents', 'infra', 'backups'].find(routeAllowed) || 'denied';
}
function updateBell() {
  const total = S.alerts.length + (S.opsAlerts ? S.opsAlerts.length : 0);
  const bell = $('bellN'); bell.textContent = total; bell.hidden = total === 0;
}

// ---- operations alerts: failing backups, fresh errors, serious open incidents ----
const DEFAULT_LIMITS = { readsPerDay: 50000, writesPerDay: 20000, storageGb: 5, bandwidthGb: 100, authMau: 50000, budgetInr: 2000, alertPct: 80 };
async function loadLimits() {
  try { const snap = await getDoc(doc(db, 'platformConfig', 'infraLimits')); S.limits = snap.exists() ? { ...DEFAULT_LIMITS, ...snap.data() } : { ...DEFAULT_LIMITS }; }
  catch { S.limits = { ...DEFAULT_LIMITS }; }
  return S.limits;
}
const DEFAULT_BACKUP = { keepDays: 30, frequency: 'daily', alertAfterHours: 36 };
async function readBackups() {
  const [policySnap, jobs, health] = await Promise.all([
    getDoc(doc(db, 'platformConfig', 'backupPolicy')).catch(() => null),
    getDocs(collection(db, 'platformJobs')).catch(() => null),
    getDoc(doc(db, 'platformJobs', 'health')).catch(() => null),
  ]);
  const policy = { ...DEFAULT_BACKUP, ...(policySnap && policySnap.exists() ? policySnap.data() : {}) };
  const runs = jobs ? jobs.docs.filter((d) => /^backup-/.test(d.id)).map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id)) : [];
  const stamp = (run) => { const t = run.at && run.at.toMillis ? run.at.toMillis() : typeof run.at === 'string' ? Date.parse(run.at) : Date.parse(run.id.slice(7) + 'T00:00:00Z'); return Number.isFinite(t) ? t : 0; };
  const problems = [];
  const last = runs[0];
  if (!last) problems.push({ level: 'warn', text: 'No backup has reported yet.' });
  else {
    const failedN = Array.isArray(last.failed) ? last.failed.length : 0;
    if (failedN || (Number(last.done) < Number(last.schools))) problems.push({ level: 'bad', text: 'The latest backup (' + last.id.slice(7) + ') saved ' + last.done + ' of ' + last.schools + ' schools' + (failedN ? ', ' + failedN + ' failed.' : '.') });
    const hours = (Date.now() - stamp(last)) / 3600000;
    if (hours > policy.alertAfterHours) problems.push({ level: 'bad', text: 'The last backup is ' + Math.round(hours) + ' hours old. The policy allows ' + policy.alertAfterHours + '.' });
  }
  if (health && health.exists()) {
    const hd = health.data();
    if (hd.backupFailed && hd.backupFailed.length) problems.push({ level: 'bad', text: 'The health check reports ' + hd.backupFailed.length + ' school(s) with a failed backup.' });
    if (hd.backupStale && hd.backupStale.length) problems.push({ level: 'warn', text: 'The health check reports ' + hd.backupStale.length + ' school(s) with an out-of-date backup.' });
    for (const p of hd.problems || []) problems.push({ level: 'warn', text: 'Health check: ' + String(p).slice(0, 200) });
  }
  return { policy, runs, problems, health: health && health.exists() ? health.data() : null };
}
async function opsAlerts() {
  const out = [];
  try {
    if (can('ops')) {
      const b = await readBackups();
      for (const p of b.problems) out.push({ level: p.level, text: p.text, href: '#/backups' });
      const errs = await getDocs(query(collection(db, 'errorReports'), orderBy('at', 'desc'), limit(100))).catch(() => null);
      if (errs) { const n = errs.docs.filter((d) => msOf(d.data()) > Date.now() - 86400000).length; if (n >= 5) out.push({ level: n >= 20 ? 'bad' : 'warn', text: n + ' app errors were reported in the last 24 hours.', href: '#/infra' }); }
    }
    if (can('audit')) {
      const inc = await getDocs(query(collection(db, 'platformIncidents'), where('status', '!=', 'resolved'))).catch(() => null);
      if (inc) { const hot = inc.docs.filter((d) => ['high', 'critical'].includes(d.data().severity)).length; if (hot) out.push({ level: 'bad', text: hot + ' serious incident(s) still open.', href: '#/incidents' }); }
    }
  } catch { /* alerts are a convenience */ }
  S.opsAlerts = out; updateBell();
}

// ---------- Infrastructure ----------
async function viewInfra() {
  setCrumbs('Infrastructure');
  show(loading('Loading usage, costs and errors.'));
  const limits = await loadLimits();
  const month = today().slice(0, 7);
  const [monthsSnap, errs, logins] = await Promise.all([
    getDocs(collection(db, 'platformInfra')).catch(() => null),
    getDocs(query(collection(db, 'errorReports'), orderBy('at', 'desc'), limit(100))).catch(() => null),
    can('audit') ? getDocs(query(collection(db, 'loginHistory'), orderBy('at', 'desc'), limit(500))).catch(() => null) : Promise.resolve(null),
  ]);
  if (isAdmin()) await loadSchools().catch(() => {});
  const measured = await getDoc(doc(db, 'platformJobs', 'usage')).then((d) => (d.exists() ? d.data() : null)).catch(() => null);
  const mcost = await getDoc(doc(db, 'platformJobs', 'cost')).then((d) => (d.exists() ? d.data() : null)).catch(() => null);
  const months = monthsSnap ? monthsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id)) : [];
  const cur = months.find((m) => m.id === month) || null;
  const dayOfMonth = Math.max(1, new Date().getDate());
  const storageMb = S.schools.reduce((t, s) => t + (Number(s.billing && s.billing.storageCheckedMb) || Number(s.usage && s.usage.storageMb) || 0), 0);
  const topStorage = [...S.schools].map((s) => ({ s, mb: Number(s.billing && s.billing.storageCheckedMb) || Number(s.usage && s.usage.storageMb) || 0 })).sort((a, b) => b.mb - a.mb).slice(0, 5);
  const students = S.schools.reduce((t, s) => t + (Number(s.usage && s.usage.students) || 0), 0);
  const activeUsers = logins ? new Set(logins.docs.filter((d) => msOf(d.data()) > Date.now() - 30 * 86400000).map((d) => d.data().uid)).size : null;
  // Measured cost (Batch 85) wins over the typed-in figure when Google's billing export is on, has this month, and is in rupees.
  const mcur = mcost && mcost.ok && Array.isArray(mcost.months) ? mcost.months.find((m) => m.month === month) : null;
  const useMeasured = Boolean(mcur && mcur.currency === 'INR');
  const cost = useMeasured ? Math.round(mcur.cost) : (cur ? cur.costInr : 0);
  const costPct = limits.budgetInr > 0 ? Math.round(cost / limits.budgetInr * 100) : 0;
  const errRows = errs ? errs.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const groups = new Map();
  for (const e of errRows) { const g = groups.get(e.message) || { message: e.message, n: 0, last: 0, pages: new Set() }; g.n++; g.last = Math.max(g.last, msOf(e)); if (e.page) g.pages.add(e.page); groups.set(e.message, g); }
  const errGroups = [...groups.values()].sort((a, b) => b.last - a.last);
  const errDay = errRows.filter((e) => msOf(e) > Date.now() - 86400000).length;

  const record = () => guarded(async () => {
    const v = await formDialog({ title: 'Record usage and cost', note: 'Copy these from the Firebase console (Usage tab) and the Google Cloud billing report. They are readings you type in; this page does not measure them itself.',
      ok: 'Save readings', fields: [
        { key: 'month', label: 'Month (YYYY-MM)', required: true, value: month, pattern: /^20[0-9]{2}-(0[1-9]|1[0-2])$/, patternText: 'Use the form 2026-12.' },
        { key: 'reads', label: 'Firestore document reads this month', type: 'number', required: true, value: cur ? cur.reads : 0 },
        { key: 'writes', label: 'Firestore document writes this month', type: 'number', required: true, value: cur ? cur.writes : 0 },
        { key: 'deletes', label: 'Firestore document deletes this month', type: 'number', required: true, value: cur ? cur.deletes : 0 },
        { key: 'storageMb', label: 'File storage used (MB)', type: 'number', required: true, value: cur ? cur.storageMb : Math.round(storageMb) },
        { key: 'bandwidthMb', label: 'Download bandwidth this month (MB)', type: 'number', required: true, value: cur ? cur.bandwidthMb : 0 },
        { key: 'authActive', label: 'Active sign-in users this month', type: 'number', required: true, value: cur ? cur.authActive : (activeUsers || 0) },
        { key: 'costInr', label: 'Cost this month (Rs)', type: 'number', required: true, value: cur ? cur.costInr : 0 },
        { key: 'note', label: 'Note (optional)', value: cur && cur.note ? cur.note : '' }] });
    if (!v) return;
    const batch = writeBatch(db);
    batch.set(doc(db, 'platformInfra', v.month), { reads: v.reads, writes: v.writes, deletes: v.deletes, storageMb: v.storageMb, bandwidthMb: v.bandwidthMb, authActive: v.authActive, costInr: v.costInr, ...(v.note ? { note: v.note.slice(0, 300) } : {}), by: S.user.uid, at: serverTimestamp() });
    audit(batch, 'infra-readings', '', '', JSON.stringify({ month: v.month, cost: v.costInr }));
    await batch.commit(); toast('Readings saved.'); await viewInfra();
  });
  const editLimits = () => guarded(async () => {
    const v = await formDialog({ title: 'Limits and budget', note: 'The quotas the meters compare against. The starting values are the usual free amounts; set them to what your Firebase plan really allows.', ok: 'Save limits', fields: [
      { key: 'readsPerDay', label: 'Reads per day', type: 'number', required: true, value: limits.readsPerDay },
      { key: 'writesPerDay', label: 'Writes per day', type: 'number', required: true, value: limits.writesPerDay },
      { key: 'storageGb', label: 'File storage (GB)', type: 'number', required: true, value: limits.storageGb },
      { key: 'bandwidthGb', label: 'Bandwidth per month (GB)', type: 'number', required: true, value: limits.bandwidthGb },
      { key: 'authMau', label: 'Active users per month', type: 'number', required: true, value: limits.authMau },
      { key: 'budgetInr', label: 'Monthly budget (Rs)', type: 'number', required: true, value: limits.budgetInr },
      { key: 'alertPct', label: 'Warn at this percent (10 to 100)', type: 'number', required: true, value: limits.alertPct }, REASON] });
    if (!v) return;
    if (v.readsPerDay < 1 || v.writesPerDay < 1 || v.storageGb < 1 || v.bandwidthGb < 1 || v.authMau < 1 || v.alertPct < 10 || v.alertPct > 100) { toast('Limits must be at least 1, and the warning percent between 10 and 100.'); return; }
    const { reason, ...data } = v;
    const batch = writeBatch(db);
    batch.set(doc(db, 'platformConfig', 'infraLimits'), data);
    audit(batch, 'infra-limits', '', reason, JSON.stringify(data));
    await batch.commit(); toast('Limits saved.'); await viewInfra();
  });
  // Measured usage (Batch 83): platformJobs/usage is written by the server job from Google's monitoring numbers.
  const refreshMeasured = () => guarded(async () => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    let r;
    try { r = (await httpsCallable(getFunctions(app, 'asia-south1'), 'runUsageNow')()).data; } catch { toast('Could not run it. Check that the server functions are deployed.'); return; }
    const c = r.cost || {};
    toast((r.ok ? 'Usage refreshed.' : (r.hint || r.error || 'Usage not available.')) + ' ' + (c.ok ? (c.note || 'Costs refreshed.') : 'Costs: ' + (c.hint || c.error || 'not available.')));
    await viewInfra();
  });
  const mdays = measured && Array.isArray(measured.days) ? measured.days : [];
  const sum30 = (key) => mdays.reduce((t, d) => t + (Number(d[key]) || 0), 0);
  const measuredCard = h('div', { class: 'card' }, h('h3', {}, 'Measured by Google (last 30 days)'),
    !measured ? h('p', { class: 'muted' }, 'Not measured yet. The server job runs every morning at 4:10, or press Refresh now.')
      : !measured.ok ? h('div', { class: 'alert' }, h('span', { class: 'pill bad' }, 'Not available'), h('span', {}, (measured.hint ? measured.hint + ' ' : '') + (measured.error || '')))
        : [h('p', { class: 'muted' }, 'Last 30 days: ' + num(sum30('reads')) + ' reads, ' + num(sum30('writes')) + ' writes, ' + num(sum30('deletes')) + ' deletes, ' + (sum30('sentBytes') / 1073741824).toFixed(2) + ' GB of file downloads. Measured ' + ago(msOf(measured)) + '.'),
          mdays.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Day ending', 'Reads', 'Writes', 'Deletes', 'Downloads (MB)', 'Files stored (MB)'].map((t) => h('th', {}, t)))),
            h('tbody', {}, mdays.slice(0, 14).map((d) => h('tr', {}, h('td', {}, d.date), h('td', { class: d.reads > limits.readsPerDay ? 'bad' : '' }, num(d.reads)), h('td', { class: d.writes > limits.writesPerDay ? 'bad' : '' }, num(d.writes)), h('td', {}, num(d.deletes)), h('td', {}, num(Math.round((d.sentBytes || 0) / 1048576))), h('td', {}, num(Math.round((d.storageBytes || 0) / 1048576)))))))) : h('div', { class: 'empty' }, 'Google returned no numbers yet.')],
    isAdmin() ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: refreshMeasured }, 'Refresh now')) : null);
  const clearErrors = () => guarded(async () => {
    if (!errRows.length || !confirm('Remove the ' + errRows.length + ' error reports shown here? This cannot be undone.')) return;
    const batch = writeBatch(db);
    for (const e of errRows.slice(0, 400)) batch.delete(doc(db, 'errorReports', e.id));
    audit(batch, 'errors-cleared', '', '', errRows.length + ' reports');
    await batch.commit(); toast('Error reports cleared.'); await viewInfra();
  });

  show(h('h2', {}, 'Infrastructure'),
    h('p', { class: 'muted' }, 'Usage, bandwidth, cost and errors for the whole platform. Reads, writes, bandwidth and cost are readings you copy in from the Firebase and Google Cloud consoles; schools, students, storage and sign-ins are measured from your own records.'),
    h('div', { class: 'row' }, h('button', { class: 'btn gold', onclick: record }, 'Record this month\'s readings'), isAdmin() ? h('button', { class: 'btn', onclick: editLimits }, 'Limits and budget') : null),
    h('div', { class: 'two' },
      h('div', { class: 'card' }, h('h3', {}, 'Firestore (database)'),
        cur ? [meter(Math.round(cur.reads / dayOfMonth), limits.readsPerDay, 'Reads per day (monthly total / days so far)'), meter(Math.round(cur.writes / dayOfMonth), limits.writesPerDay, 'Writes per day'),
          h('p', { class: 'muted' }, 'This month: ' + num(cur.reads) + ' reads, ' + num(cur.writes) + ' writes, ' + num(cur.deletes) + ' deletes.')]
          : h('p', { class: 'muted' }, 'No readings for ' + month + ' yet. Press "Record this month\'s readings".'),
        isAdmin() ? h('p', { class: 'muted' }, S.schools.length + ' schools and ' + num(students) + ' students are stored.') : null),
      h('div', { class: 'card' }, h('h3', {}, 'File storage'),
        isAdmin() ? [meter(Math.round(storageMb / 1024 * 10) / 10, limits.storageGb, 'All schools together (GB)'),
          h('table', {}, h('tbody', {}, topStorage.map((t) => h('tr', {}, h('td', {}, h('a', { href: '#/school/' + t.s.id }, t.s.name)), h('td', {}, num(Math.round(t.mb)) + ' MB'))))),
          h('p', { class: 'muted' }, 'Uses each school\'s reconciled figure when there is one, otherwise the size the school reports.')]
          : h('p', { class: 'muted' }, cur ? num(cur.storageMb) + ' MB recorded for ' + month + '.' : 'Not recorded yet.')),
      h('div', { class: 'card' }, h('h3', {}, 'Authentication'),
        cur ? meter(cur.authActive, limits.authMau, 'Active users this month (recorded)') : h('p', { class: 'muted' }, 'Not recorded yet.'),
        activeUsers !== null ? h('p', { class: 'muted' }, activeUsers + ' different people signed in during the last 30 days (counted from the sign-in history, newest 500 sign-ins).') : null),
      h('div', { class: 'card' }, h('h3', {}, 'Bandwidth'),
        cur ? meter(Math.round(cur.bandwidthMb / 1024 * 10) / 10, limits.bandwidthGb, 'Downloads this month (GB)') : h('p', { class: 'muted' }, 'Not recorded yet.'))),
    measuredCard,
    h('div', { class: 'card' }, h('h3', {}, 'Costs'),
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', {}, month + ': ' + money(cost) + ' of a ' + money(limits.budgetInr) + ' budget'),
        h('span', { class: 'pill ' + (costPct >= 100 ? 'bad' : costPct >= limits.alertPct ? 'warn' : 'ok') }, costPct >= 100 ? 'Over budget' : costPct >= limits.alertPct ? 'Close to budget' : 'Within budget')),
      h('div', { class: 'meter ' + (costPct >= 100 ? 'bad' : costPct >= limits.alertPct ? 'warn' : '') }, h('i', { style: 'width:' + Math.min(100, costPct) + '%' })),
      h('p', { class: 'muted' }, useMeasured ? 'This month\'s figure is measured from Google\'s billing export' + (mcost.at ? ' ' + ago(msOf(mcost)) : '') + '.'
        : mcost && !mcost.ok ? 'Cost is typed in. Billing export: ' + (mcost.hint || mcost.error || 'not available yet.')
          : mcost && mcost.ok && mcur ? 'The billing export is in ' + mcur.currency + ', not rupees, so the typed-in figure is used.'
            : mcost && mcost.ok ? (mcost.note || 'The billing export has no figure for this month yet; the typed-in figure is used.') : 'Cost is typed in. Press Refresh now above to check the billing export.'),
      mcost && mcost.ok && Array.isArray(mcost.services) && mcost.services.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['This month by service', 'Cost'].map((t) => h('th', {}, t)))),
        h('tbody', {}, mcost.services.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, num(x.cost)))))))
        : null,
      months.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Month', 'Cost', 'Reads', 'Writes', 'Storage', 'Bandwidth', 'Active users'].map((t) => h('th', {}, t)))),
        h('tbody', {}, months.slice(0, 6).map((m) => h('tr', {}, h('td', {}, m.id), h('td', {}, money(m.costInr)), h('td', {}, num(m.reads)), h('td', {}, num(m.writes)), h('td', {}, num(m.storageMb) + ' MB'), h('td', {}, num(m.bandwidthMb) + ' MB'), h('td', {}, num(m.authActive))))))) : null),
    h('div', { class: 'card' }, h('h3', {}, 'Error alerts'),
      h('p', { class: 'muted' }, errDay + ' error report(s) in the last 24 hours. Browsers of signed-in users send these automatically (at most 3 per visit).'),
      errGroups.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Error', 'Times', 'Last seen', 'Where'].map((t) => h('th', {}, t)))),
        h('tbody', {}, errGroups.slice(0, 20).map((g) => h('tr', {}, h('td', { style: 'max-width:420px;word-break:break-word' }, g.message), h('td', {}, g.n), h('td', {}, ago(g.last)), h('td', { class: 'muted' }, [...g.pages].slice(0, 2).join(', ') || '-')))))) : h('div', { class: 'empty' }, 'No errors reported.'),
      isAdmin() && errRows.length ? h('button', { class: 'btn red sm', onclick: clearErrors }, 'Clear these reports') : null));
}

// ---------- Backups ----------
async function viewBackups() {
  setCrumbs('Backups');
  show(loading('Loading backups.'));
  const b = await readBackups();
  const editPolicy = () => guarded(async () => {
    const v = await formDialog({ title: 'Backup retention and alerts', note: 'The nightly server job reads this policy: it removes backups older than the days you set (it always keeps the newest 3) and, if you choose weekly, makes them on Sundays only. The alert email is not sent yet; alerts show on this page.', ok: 'Save policy', fields: [
      { key: 'keepDays', label: 'Keep each backup for (days, 7 to 3650)', type: 'number', required: true, value: b.policy.keepDays },
      { key: 'frequency', label: 'How often', type: 'select', options: [['daily', 'Every day'], ['weekly', 'Every week']], value: b.policy.frequency },
      { key: 'alertAfterHours', label: 'Raise an alert when the last backup is older than (hours, 6 to 720)', type: 'number', required: true, value: b.policy.alertAfterHours },
      { key: 'notifyEmail', label: 'Alert email (optional)', value: b.policy.notifyEmail || '' }, REASON] });
    if (!v) return;
    if (v.keepDays < 7 || v.keepDays > 3650 || v.alertAfterHours < 6 || v.alertAfterHours > 720) { toast('Check the day and hour ranges.'); return; }
    const data = { keepDays: v.keepDays, frequency: v.frequency, alertAfterHours: v.alertAfterHours, ...(v.notifyEmail ? { notifyEmail: v.notifyEmail.slice(0, 120) } : {}) };
    const batch = writeBatch(db);
    batch.set(doc(db, 'platformConfig', 'backupPolicy'), data);
    audit(batch, 'backup-policy', '', v.reason, JSON.stringify(data));
    await batch.commit(); toast('Policy saved.'); await viewBackups();
  });
  show(h('h2', {}, 'Backups'),
    h('div', { class: 'card' }, h('h3', {}, 'Failure alerts'),
      b.problems.length ? b.problems.map((p) => h('div', { class: 'alert' }, h('span', { class: 'pill ' + p.level }, p.level === 'bad' ? 'Act' : 'Watch'), h('span', {}, p.text)))
        : h('div', { class: 'empty' }, 'The latest backup finished and is within the allowed age.')),
    h('div', { class: 'card' }, h('h3', {}, 'Retention policy'),
      h('p', {}, 'Keep for ' + b.policy.keepDays + ' days. Run ' + (b.policy.frequency === 'weekly' ? 'every week' : 'every day') + '. Alert after ' + b.policy.alertAfterHours + ' hours without a backup' + (b.policy.notifyEmail ? '. Email: ' + b.policy.notifyEmail : '') + '.'),
      isAdmin() ? h('button', { class: 'btn', onclick: editPolicy }, 'Change policy') : null),
    h('div', { class: 'card' }, h('h3', {}, 'Recent backup runs'),
      b.runs.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Run', 'Schools saved', 'Failed', 'Status'].map((t) => h('th', {}, t)))),
        h('tbody', {}, b.runs.slice(0, 14).map((r) => { const failed = Array.isArray(r.failed) ? r.failed.length : 0; const ok = !failed && Number(r.done) >= Number(r.schools);
          return h('tr', {}, h('td', {}, r.id.slice(7)), h('td', {}, num(r.done) + ' of ' + num(r.schools)), h('td', {}, failed), h('td', {}, h('span', { class: 'pill ' + (ok ? 'ok' : 'bad') }, ok ? 'Complete' : 'Needs attention'))); })))) : h('div', { class: 'empty' }, 'No backup has reported yet.')));
}

// ---------- Support ----------
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_CLASS = { urgent: 'bad', high: 'warn', normal: '', low: '' };
S.supFilter = 'open';
async function viewSupport() {
  setCrumbs('Support tickets');
  show(loading('Loading tickets.'));
  const [snap, staffSnap] = await Promise.all([getDocs(collection(db, 'supportTickets')), isAdmin() ? getDocs(collection(db, 'platformStaff')).catch(() => null) : Promise.resolve(null)]);
  await loadSchools().catch(() => {});
  // Suggestions (Batch 87): platformJobs/triage holds {ticketId: {category, priority, summary, by}} written by the server (an AI model when a key is set, otherwise fixed keyword rules).
  const triageDoc = await getDoc(doc(db, 'platformJobs', 'triage')).catch(() => null);
  const triage = triageDoc && triageDoc.exists() && triageDoc.data().items ? triageDoc.data().items : {};
  const classifyNow = () => guarded(async () => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    let r;
    try { r = (await httpsCallable(getFunctions(app, 'asia-south1'), 'triageOpenTickets')()).data; } catch { toast('Could not run it. Check that the server functions are deployed.'); return; }
    toast(r.done + ' ticket(s) classified' + (r.by ? ' by ' + r.by : '') + '.');
    await viewSupport();
  });
  const nameOf = (id) => { const s = S.schools.find((x) => x.id === id); return s ? s.name : id; };
  const people = [[S.user.uid, S.user.email || 'Me']];
  if (staffSnap) for (const d of staffSnap.docs) if (d.data().status === 'active' && d.id !== S.user.uid) people.push([d.id, d.data().email]);
  const emailFor = (uid) => (people.find((p) => p[0] === uid) || [uid, ''])[1];
  const todayText = today();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).map((t) => ({ ...t, priority: t.priority || 'normal' }));
  const overdue = (t) => t.status !== 'closed' && t.dueOn && t.dueOn < todayText;
  const filters = { open: (t) => t.status !== 'closed', mine: (t) => t.assignedTo === S.user.uid && t.status !== 'closed', overdue, unassigned: (t) => !t.assignedTo && t.status !== 'closed', all: () => true };
  const shown = rows.filter(filters[S.supFilter] || filters.open).sort((a, b) =>
    (a.status === 'closed') - (b.status === 'closed') || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || String(a.dueOn || '9999').localeCompare(String(b.dueOn || '9999')) || String(a.createdOn).localeCompare(String(b.createdOn)));

  const openTicket = (t) => guarded(async () => {
    const v = await formDialog({ title: t.subject, note: nameOf(t.schoolId) + ' - raised ' + t.createdOn + ': ' + t.body, ok: 'Save', fields: [
      { key: 'reply', label: 'Reply to the school', type: 'textarea', value: t.reply || '' },
      { key: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['answered', 'Answered'], ['closed', 'Closed']], value: t.status },
      { key: 'priority', label: 'Priority', type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], value: t.priority },
      { key: 'dueOn', label: 'Deadline (optional)', type: 'date', value: t.dueOn || '' },
      { key: 'assignedTo', label: 'Assigned to', type: 'select', options: [['', 'Nobody'], ...people], value: t.assignedTo || '' }] });
    if (!v) return;
    const patch = { status: v.status, priority: v.priority };
    patch.reply = v.reply ? v.reply.slice(0, 2000) : deleteField();
    patch.dueOn = v.dueOn ? v.dueOn : deleteField();
    if (v.assignedTo) { patch.assignedTo = v.assignedTo; patch.assignedEmail = (emailFor(v.assignedTo) || '').slice(0, 120); } else { patch.assignedTo = deleteField(); patch.assignedEmail = deleteField(); }
    const batch = writeBatch(db);
    batch.update(doc(db, 'supportTickets', t.id), patch);
    audit(batch, 'ticket-update', t.schoolId, '', JSON.stringify({ ticket: t.id, status: v.status, priority: v.priority, due: v.dueOn || '', to: v.assignedTo ? emailFor(v.assignedTo) : '' }));
    await batch.commit(); toast('Ticket saved.'); await viewSupport();
  });
  const tab = (key, label, n) => h('button', { class: 'btn' + (S.supFilter === key ? ' gold' : ''), onclick: () => { S.supFilter = key; viewSupport(); } }, label + ' (' + n + ')');
  show(h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Support tickets'), isAdmin() ? h('button', { class: 'btn', onclick: classifyNow }, 'Classify open tickets') : null),
    h('div', { class: 'row' }, tab('open', 'Open', rows.filter(filters.open).length), tab('mine', 'Assigned to me', rows.filter(filters.mine).length), tab('unassigned', 'Unassigned', rows.filter(filters.unassigned).length),
      tab('overdue', 'Overdue', rows.filter(filters.overdue).length), tab('all', 'All', rows.length)),
    shown.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Priority', 'School', 'Subject', 'Deadline', 'Assigned to', 'Status', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, shown.map((t) => h('tr', {}, h('td', {}, h('span', { class: 'pill ' + PRIORITY_CLASS[t.priority] }, t.priority)), h('td', {}, nameOf(t.schoolId)), h('td', {}, t.subject, h('div', { class: 'muted' }, t.createdOn), triage[t.id] ? h('div', { class: 'muted' }, 'Suggested: ' + triage[t.id].category + ', ' + triage[t.id].priority + ' priority' + (triage[t.id].summary ? ' - ' + triage[t.id].summary : '') + ' (' + (triage[t.id].by === 'ai' ? 'AI' : 'rules') + ')') : null),
        h('td', {}, t.dueOn ? h('span', { class: overdue(t) ? 'pill bad' : '' }, t.dueOn + (overdue(t) ? ' (overdue)' : '')) : '-'), h('td', {}, t.assignedEmail || (t.assignedTo ? 'Someone' : 'Nobody')), h('td', {}, t.status),
        h('td', {}, h('button', { class: 'btn sm', onclick: () => openTicket(t) }, 'Open'))))))) : h('div', { class: 'empty' }, 'No tickets here.'));
}

// ---------- Incidents ----------
const SEVERITY_CLASS = { low: '', medium: 'warn', high: 'bad', critical: 'bad' };
S.incFilter = 'open';
async function createIncident(preset = {}) {
  const v = await formDialog({ title: 'Open an incident', ok: 'Open incident', fields: [
    { key: 'title', label: 'What happened (short)', required: true, minLen: 3, value: preset.title || '' },
    { key: 'severity', label: 'Severity', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']], value: preset.severity || 'medium' },
    { key: 'schoolId', label: 'School ID (optional)', value: preset.schoolId || '', pattern: /^[a-z0-9-]{1,40}$/, patternText: 'A school id is lowercase letters, numbers and dashes.' },
    { key: 'notes', label: 'Details and first steps', type: 'textarea', value: preset.notes || '' }] });
  if (!v) return false;
  const batch = writeBatch(db);
  const auditId = audit(batch, 'incident-open', v.schoolId, v.title, v.notes ? v.notes.slice(0, 500) : '');
  batch.set(doc(db, 'platformIncidents', newId('I-')), { title: v.title.slice(0, 120), severity: v.severity, status: 'open', ...(v.schoolId ? { schoolId: v.schoolId } : {}), ...(v.notes ? { notes: v.notes.slice(0, 1500) } : {}),
    openedBy: S.user.uid, openedAt: serverTimestamp(), updatedAt: serverTimestamp(), auditId });
  await batch.commit(); toast('Incident opened.'); return true;
}
async function viewIncidents() {
  setCrumbs('Incidents');
  show(loading('Loading incidents.'));
  const snap = await getDocs(collection(db, 'platformIncidents'));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => msOfField(b, 'openedAt') - msOfField(a, 'openedAt'));
  const shown = S.incFilter === 'all' ? rows : rows.filter((r) => r.status !== 'resolved');
  const edit = (r) => guarded(async () => {
    const v = await formDialog({ title: r.title, note: 'Opened ' + when(r.openedAt), ok: 'Save', fields: [
      { key: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['investigating', 'Investigating'], ['resolved', 'Resolved']], value: r.status },
      { key: 'severity', label: 'Severity', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']], value: r.severity },
      { key: 'notes', label: 'Notes and what was done', type: 'textarea', value: r.notes || '' }] });
    if (!v) return;
    const batch = writeBatch(db);
    const auditId = audit(batch, 'incident-update', r.schoolId || '', r.title, JSON.stringify({ from: r.status, to: v.status, severity: v.severity }));
    const patch = { status: v.status, severity: v.severity, notes: v.notes ? v.notes.slice(0, 1500) : deleteField(), updatedAt: serverTimestamp(), auditId };
    patch.resolvedAt = v.status === 'resolved' ? serverTimestamp() : deleteField();
    batch.update(doc(db, 'platformIncidents', r.id), patch);
    await batch.commit(); toast('Incident saved.'); await viewIncidents();
  });
  show(h('h2', {}, 'Incidents'),
    h('p', { class: 'muted' }, 'Security and operations incidents. Opening, changing and resolving one is written to the audit log.'),
    h('div', { class: 'row' }, h('button', { class: 'btn gold', onclick: () => guarded(async () => { if (await createIncident()) await viewIncidents(); }) }, 'Open an incident'),
      h('button', { class: 'btn' + (S.incFilter === 'open' ? ' gold' : ''), onclick: () => { S.incFilter = 'open'; viewIncidents(); } }, 'Open'),
      h('button', { class: 'btn' + (S.incFilter === 'all' ? ' gold' : ''), onclick: () => { S.incFilter = 'all'; viewIncidents(); } }, 'All')),
    shown.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Opened', 'Severity', 'Incident', 'School', 'Status', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, shown.map((r) => h('tr', {}, h('td', {}, when(r.openedAt)), h('td', {}, h('span', { class: 'pill ' + SEVERITY_CLASS[r.severity] }, r.severity)), h('td', {}, h('b', {}, r.title), r.notes ? h('div', { class: 'muted', style: 'max-width:420px;word-break:break-word' }, r.notes) : null),
        h('td', {}, r.schoolId ? (isAdmin() ? h('a', { href: '#/school/' + r.schoolId }, r.schoolId) : r.schoolId) : '-'), h('td', {}, r.status), h('td', {}, h('button', { class: 'btn sm', onclick: () => edit(r) }, 'Update'))))))) : h('div', { class: 'empty' }, 'No incidents here.'));
}
function msOfField(r, key) { return r[key] && r[key].toMillis ? r[key].toMillis() : 0; }

// ---------- Internal staff ----------
async function viewStaff() {
  setCrumbs('Internal staff');
  show(loading('Loading staff.'));
  const [staffSnap, inviteSnap] = await Promise.all([getDocs(collection(db, 'platformStaff')), getDocs(collection(db, 'staffInvites'))]);
  const staff = staffSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const invites = inviteSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status !== 'accepted');
  await pool(staff, 6, async (m) => {
    const logins = await getDocs(query(collection(db, 'loginHistory'), where('uid', '==', m.uid))).catch(() => null);
    const rows = logins ? logins.docs.map((d) => d.data()).sort((a, b) => msOf(b) - msOf(a)) : [];
    m.lastLogin = rows[0] ? msOf(rows[0]) : 0; m.mfa = rows[0] && typeof rows[0].mfa === 'boolean' ? rows[0].mfa : null;
  });
  const extraFields = (perms) => Object.keys(PERM_LABEL).map((k) => ({ key: 'x_' + k, label: 'Also allow: ' + PERM_LABEL[k], type: 'checkbox', value: perms ? perms[k] === true : false }));
  const pickExtras = (v) => Object.keys(PERM_LABEL).filter((k) => v['x_' + k]);

  const invite = () => guarded(async () => {
    const v = await formDialog({ title: 'Invite a staff member', note: 'They sign in at /admin with this email address (verified, for example a Google account). Pick a role; the boxes add permissions on top of it.', ok: 'Send invitation', fields: [
      { key: 'email', label: 'Email address', type: 'email', required: true, pattern: /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,100}$/, patternText: 'Enter a valid email address.' },
      { key: 'role', label: 'Role', type: 'select', options: Object.entries(ROLE_LABEL).map(([k, t]) => [k, t + ' (' + permText(permsFor(k, [])) + ')']) },
      ...extraFields(null), REASON] });
    if (!v) return;
    const email = v.email.toLowerCase();
    if (staff.some((m) => m.email === email && m.status === 'active')) { toast('That person is already on the staff.'); return; }
    const perms = permsFor(v.role, pickExtras(v));
    const batch = writeBatch(db);
    const auditId = audit(batch, 'staff-invite', '', v.reason, JSON.stringify({ email, role: v.role, perms: permText(perms) }));
    batch.set(doc(db, 'staffInvites', email), { email, role: v.role, perms, status: 'invited', by: S.user.uid, at: serverTimestamp(), auditId });
    await batch.commit(); toast('Invitation saved. Ask them to sign in at /admin.'); await viewStaff();
  });
  const change = (m) => guarded(async () => {
    const v = await formDialog({ title: 'Change ' + m.email, ok: 'Save changes', fields: [
      { key: 'role', label: 'Role', type: 'select', options: Object.entries(ROLE_LABEL), value: m.role }, ...extraFields(m.perms), REASON] });
    if (!v) return;
    const perms = permsFor(v.role, pickExtras(v));
    const batch = writeBatch(db);
    const auditId = audit(batch, 'staff-change', '', v.reason, JSON.stringify({ email: m.email, from: m.role + ': ' + permText(m.perms), to: v.role + ': ' + permText(perms) }));
    batch.update(doc(db, 'platformStaff', m.uid), { role: v.role, perms, changedAt: serverTimestamp(), auditId });
    await batch.commit(); toast('Saved.'); await viewStaff();
  });
  const setStatus = (m, status) => guarded(async () => {
    const v = await formDialog({ title: (status === 'revoked' ? 'Revoke access for ' : 'Restore access for ') + m.email, note: status === 'revoked' ? 'They lose all access at once. Their past actions stay in the audit log.' : 'They get back the role and permissions they had.', ok: status === 'revoked' ? 'Revoke access' : 'Restore access', fields: [REASON] });
    if (!v) return;
    const batch = writeBatch(db);
    const auditId = audit(batch, status === 'revoked' ? 'staff-revoke' : 'staff-restore', '', v.reason, m.email);
    batch.update(doc(db, 'platformStaff', m.uid), { status, revokedAt: status === 'revoked' ? serverTimestamp() : deleteField(), changedAt: serverTimestamp(), auditId });
    await batch.commit(); toast(status === 'revoked' ? 'Access revoked.' : 'Access restored.'); await viewStaff();
  });
  const setInvite = (i, status) => guarded(async () => {
    const batch = writeBatch(db);
    const auditId = audit(batch, status === 'cancelled' ? 'staff-invite-cancel' : 'staff-invite', '', '', i.email);
    batch.update(doc(db, 'staffInvites', i.id), { status, by: S.user.uid, at: serverTimestamp(), auditId });
    await batch.commit(); toast(status === 'cancelled' ? 'Invitation cancelled.' : 'Invitation sent again.'); await viewStaff();
  });
  show(h('h2', {}, 'Internal staff'),
    h('p', { class: 'muted' }, 'People who help run the platform with limited access. Finance access is read-only: staff can see invoices and payments but cannot create or change them. Support access covers tickets only. Nothing here opens a school\'s own records; that still needs a super admin access pass.'),
    h('div', { class: 'row' }, h('button', { class: 'btn gold', onclick: invite }, 'Invite staff')),
    h('div', { class: 'card' }, h('h3', {}, 'Staff'),
      staff.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Person', 'Role', 'Can use', 'Last sign-in', 'Second factor', 'Status', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, staff.map((m) => h('tr', {}, h('td', {}, m.email), h('td', {}, ROLE_LABEL[m.role] || m.role), h('td', { class: 'muted' }, permText(m.perms)), h('td', {}, ago(m.lastLogin)),
          h('td', {}, m.mfa === null ? 'not recorded' : m.mfa ? 'enrolled' : 'not enrolled'), h('td', {}, h('span', { class: 'pill ' + (m.status === 'active' ? 'ok' : 'bad') }, m.status)),
          h('td', { class: 'row' }, m.status === 'active' ? [h('button', { class: 'btn sm', onclick: () => change(m) }, 'Change'), h('button', { class: 'btn sm red', onclick: () => setStatus(m, 'revoked') }, 'Revoke')]
            : h('button', { class: 'btn sm', onclick: () => setStatus(m, 'active') }, 'Restore'))))))) : h('div', { class: 'empty' }, 'No staff yet.')),
    h('div', { class: 'card' }, h('h3', {}, 'Invitations'),
      invites.length ? h('table', {}, h('tbody', {}, invites.map((i) => h('tr', {}, h('td', {}, i.email, h('div', { class: 'muted' }, (ROLE_LABEL[i.role] || i.role) + ' - ' + permText(i.perms))), h('td', {}, h('span', { class: 'pill ' + (i.status === 'invited' ? 'warn' : '') }, i.status)),
        h('td', {}, i.status === 'invited' ? h('button', { class: 'btn sm red', onclick: () => setInvite(i, 'cancelled') }, 'Cancel') : h('button', { class: 'btn sm', onclick: () => setInvite(i, 'invited') }, 'Invite again')))))) : h('div', { class: 'empty' }, 'No open invitations.')));
}

// ---------- Audit (action log, school access, permission changes, logins, suspicious activity) ----------
const AUDIT_TABS = [['log', 'Action log'], ['access', 'School access'], ['permissions', 'Permission changes'], ['logins', 'Sign-ins and MFA'], ['suspicious', 'Suspicious activity']];
const ACCESS_ACTION = /^(open-school|revoke-access-pass)/;
const PERMISSION_ACTION = /^(staff-|require-mfa|revoke-|invite-owner|owner-|feature-override|feature-apply|change-plan)/;
const istHour = (ms) => Number(new Date(ms).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
function findSuspicious(entries, logins, attempts) {
  const flags = []; const now = Date.now(); const DAY = 86400000;
  const byKey = (list, key, since) => { const m = new Map(); for (const r of list) if (msOf(r) > now - since) { const k = key(r); m.set(k, (m.get(k) || []).concat(r)); } return m; };
  for (const [who, list] of byKey(attempts, (r) => r.email || r.uid, DAY)) if (list.length >= 3) flags.push({ level: 'bad', title: 'Repeated blocked access', detail: who + ' was refused entry to the Super Admin page ' + list.length + ' times in 24 hours.', school: '' });
  const opens = entries.filter((r) => /^open-school/.test(r.action));
  for (const [who, list] of byKey(opens, (r) => r.actorEmail || r.actor, DAY)) {
    const sensitive = list.filter((r) => r.action.includes('sensitive')).length;
    if (sensitive >= 3) flags.push({ level: 'bad', title: 'Many sensitive access passes', detail: who + ' opened ' + sensitive + ' sensitive passes in 24 hours.', school: '' });
    else if (list.length >= 10) flags.push({ level: 'warn', title: 'Many school openings', detail: who + ' opened schools ' + list.length + ' times in 24 hours.', school: '' });
  }
  for (const [who, list] of byKey(opens, (r) => r.actorEmail || r.actor, 7 * DAY)) {
    const sorted = [...list].sort((a, b) => msOf(a) - msOf(b));
    for (let i = 0; i < sorted.length; i++) {
      const window = sorted.filter((r) => msOf(r) >= msOf(sorted[i]) && msOf(r) < msOf(sorted[i]) + 3600000);
      if (new Set(window.map((r) => r.schoolId)).size >= 5) { flags.push({ level: 'bad', title: 'Many schools in one hour', detail: who + ' opened ' + new Set(window.map((r) => r.schoolId)).size + ' different schools within an hour (' + when(sorted[i].at) + ').', school: '' }); break; }
    }
  }
  const night = opens.filter((r) => msOf(r) > now - 7 * DAY && istHour(msOf(r)) < 5);
  for (const r of night.slice(0, 8)) flags.push({ level: 'warn', title: 'Access at night', detail: (r.actorEmail || r.actor) + ' opened ' + (r.schoolId || 'a school') + ' at ' + when(r.at) + ' (between midnight and 5 am India time).', school: r.schoolId || '' });
  for (const [uid, list] of byKey(logins, (r) => r.uid, 7 * DAY)) {
    const agents = new Set(list.map((r) => r.agent).filter(Boolean));
    if (agents.size >= 4) flags.push({ level: 'warn', title: 'Many devices for one account', detail: (list[0].email || uid) + ' signed in from ' + agents.size + ' different browsers or devices in 7 days.', school: '' });
  }
  return flags;
}
async function viewAudit(tab = 'log') {
  if (!AUDIT_TABS.some(([k]) => k === tab)) tab = 'log';
  setCrumbs('Audit log');
  show(loading('Loading the audit log.'));
  const needLogins = tab === 'logins' || tab === 'suspicious';
  const [snap, loginSnap, attemptSnap, grantSnap] = await Promise.all([
    getDocs(query(collection(db, 'platformAudit'), orderBy('at', 'desc'), limit(500))),
    needLogins ? getDocs(query(collection(db, 'loginHistory'), orderBy('at', 'desc'), limit(300))).catch(() => null) : Promise.resolve(null),
    needLogins ? getDocs(query(collection(db, 'accessAttempts'), orderBy('at', 'desc'), limit(150))).catch(() => null) : Promise.resolve(null),
    tab === 'access' && isAdmin() ? getDocs(collection(db, 'platformGrants')).catch(() => null) : Promise.resolve(null),
  ]);
  const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const logins = loginSnap ? loginSnap.docs.map((d) => d.data()) : [];
  const attempts = attemptSnap ? attemptSnap.docs.map((d) => d.data()) : [];
  const tabs = h('div', { class: 'row' }, AUDIT_TABS.map(([k, label]) => h('a', { class: 'btn' + (k === tab ? ' gold' : ''), href: '#/audit/' + k }, label)));
  const auditTable = (list) => list.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'School', 'Reason', 'Detail'].map((t) => h('th', {}, t)))),
    h('tbody', {}, list.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.actorEmail || String(r.actor).slice(0, 8)), h('td', {}, h('b', {}, r.action)),
      h('td', {}, r.schoolId ? (isAdmin() ? h('a', { href: '#/school/' + r.schoolId }, r.schoolId) : r.schoolId) : '-'), h('td', {}, r.reason || '-'), h('td', { class: 'muted', style: 'max-width:340px;word-break:break-word' }, r.detail || '-')))))) : h('div', { class: 'empty' }, 'Nothing recorded here yet.');
  const head = h('h2', {}, 'Audit log');
  const lead = h('p', { class: 'muted' }, 'Entries can be added but never edited or deleted.');
  if (tab === 'log') {
    const box = h('input', { type: 'search', placeholder: 'Filter by person, action, school or reason' });
    const holder = h('div');
    const draw = () => { const w = box.value.trim().toLowerCase(); holder.replaceChildren(auditTable(w ? entries.filter((r) => [r.actorEmail, r.action, r.schoolId, r.reason, r.detail].some((v) => String(v || '').toLowerCase().includes(w))) : entries)); };
    box.addEventListener('input', draw); draw();
    show(head, lead, tabs, h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:220px' }, box),
      h('button', { class: 'btn', onclick: () => exportCsv('audit-log.csv', ['When', 'Who', 'Action', 'School', 'Reason', 'Detail'], entries.map((r) => [when(r.at), r.actorEmail || r.actor, r.action, r.schoolId || '', r.reason || '', r.detail || ''])) }, 'Download as CSV')),
      h('p', { class: 'muted' }, 'The newest 500 entries.'), holder);
    return;
  }
  if (tab === 'access') {
    const now = Date.now();
    const live = grantSnap ? grantSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((g) => g.expiresAt && g.expiresAt.toMillis() > now) : [];
    show(head, lead, tabs, h('p', { class: 'muted' }, 'Every time a super admin opened a school, and every access pass revoked. A school page shows only its own history.'),
      live.length ? h('div', { class: 'card' }, h('h3', {}, 'Open right now'), h('table', {}, h('tbody', {}, live.map((g) => h('tr', {}, h('td', {}, g.schoolId), h('td', {}, g.tier), h('td', {}, 'until ' + when(g.expiresAt)), h('td', { class: 'muted' }, g.reason))))) ) : null,
      auditTable(entries.filter((r) => ACCESS_ACTION.test(r.action))));
    return;
  }
  if (tab === 'permissions') {
    show(head, lead, tabs, h('p', { class: 'muted' }, 'Changes to who can do what: staff invitations, role and permission changes, revoked access, plan and feature changes, and the MFA switch.'),
      auditTable(entries.filter((r) => PERMISSION_ACTION.test(r.action))));
    return;
  }
  if (tab === 'logins') {
    const cfg = await getDoc(doc(db, 'platformConfig', 'security')).catch(() => null);
    const mfaOn = cfg && cfg.exists() && cfg.data().requireMfa === true;
    const mine = multiFactor(auth.currentUser).enrolledFactors.length;
    const latest = new Map();
    for (const r of logins) if (!latest.has(r.uid)) latest.set(r.uid, r);
    show(head, lead, tabs,
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h3', {}, 'MFA'), h('p', {}, 'Requirement for sensitive access passes: ', h('b', {}, mfaOn ? 'on' : 'off')), h('p', {}, 'Your own account has ' + mine + ' second factor(s) enrolled.'),
          h('p', { class: 'muted' }, 'Staff show "enrolled" only if their latest sign-in recorded it. Change the requirement under Security and access.')),
        h('div', { class: 'card' }, h('h3', {}, 'Blocked access'), h('p', { class: 'muted' }, 'Signed-in people who opened the Super Admin page without permission. Wrong-password attempts happen before sign-in, so Firebase Authentication keeps those, not this page.'),
          attempts.length ? h('table', {}, h('tbody', {}, attempts.slice(0, 25).map((r) => h('tr', {}, h('td', {}, r.email || String(r.uid).slice(0, 8)), h('td', {}, when(r.at)), h('td', { class: 'muted' }, String(r.agent || '').slice(0, 60)))))) : h('div', { class: 'empty' }, 'None.'))),
      h('div', { class: 'card' }, h('h3', {}, 'Sign-in history'), h('p', { class: 'muted' }, 'Newest 300 sign-ins from every school. MFA shows whether the account had a second factor when it signed in.'),
        logins.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Person', 'MFA', 'Browser'].map((t) => h('th', {}, t)))),
          h('tbody', {}, logins.slice(0, 100).map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.email || String(r.uid).slice(0, 8)), h('td', {}, typeof r.mfa === 'boolean' ? (r.mfa ? 'yes' : 'no') : '-'), h('td', { class: 'muted' }, String(r.agent || '').slice(0, 70))))))) : h('div', { class: 'empty' }, 'No sign-ins recorded.')));
    return;
  }
  const flags = findSuspicious(entries, logins, attempts);
  show(head, lead, tabs, h('p', { class: 'muted' }, 'Simple rules over the last week of records: repeated blocked access, many access passes, many schools in an hour, night-time access and many devices for one account. A flag is a reason to look, not proof.'),
    flags.length ? flags.map((f) => h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', {}, h('span', { class: 'pill ' + f.level }, f.level === 'bad' ? 'Act' : 'Watch'), ' ', h('b', {}, f.title)),
      can('audit') ? h('button', { class: 'btn sm', onclick: () => guarded(async () => { await createIncident({ title: f.title, severity: f.level === 'bad' ? 'high' : 'medium', schoolId: f.school, notes: f.detail }); }) }, 'Open incident') : null), h('p', { class: 'muted' }, f.detail)))
      : h('div', { class: 'empty' }, 'Nothing suspicious in the last 7 days.'));
}

// ---------- routing ----------
// ---------- Mark 5 (Batch 80): reports, platform settings and insights ----------
const dayOf = (v) => (v && v.toDate ? v.toDate().toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : '');
const msOfAny = (v) => (v && v.toMillis ? v.toMillis() : typeof v === 'string' ? (Date.parse(v) || 0) : 0);
const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);
const REPORT_TABS = [['schools', 'Schools'], ['subscriptions', 'Subscriptions'], ['revenue', 'Revenue'], ['storage', 'Storage'], ['support', 'Support']];
const reportTabAllowed = (tab) => isAdmin() || (tab === 'support' ? can('support') : (tab === 'subscriptions' || tab === 'revenue') && can('finance'));

async function buildReport(tab) {
  if (tab === 'support') {
    const [snap] = await Promise.all([getDocs(collection(db, 'supportTickets')), loadSchools().catch(() => {})]);
    const nameOf = (id) => { const s = S.schools.find((x) => x.id === id); return s ? s.name : id; };
    const by = new Map();
    const dueCut = today();
    for (const d of snap.docs) {
      const t = d.data(); const row = by.get(t.schoolId) || { open: 0, closed: 0, hot: 0, late: 0, oldest: '' };
      if (t.status === 'closed') row.closed += 1;
      else {
        row.open += 1;
        if (t.priority === 'urgent' || t.priority === 'high') row.hot += 1;
        if (t.dueOn && t.dueOn < dueCut) row.late += 1;
        if (!row.oldest || String(t.createdOn) < row.oldest) row.oldest = String(t.createdOn || '');
      }
      by.set(t.schoolId, row);
    }
    const rows = [...by.entries()].sort((a, b) => b[1].open - a[1].open).map(([id, r]) => [nameOf(id), r.open, r.closed, r.hot, r.late, r.oldest]);
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    return { title: 'Support report', header: ['School', 'Open tickets', 'Closed tickets', 'Urgent or high (open)', 'Past deadline', 'Oldest open since'], rows,
      stats: [['Open tickets', num(sum(1))], ['Closed tickets', num(sum(2))], ['Urgent or high, open', num(sum(3))], ['Past deadline', num(sum(4))]] };
  }
  if (tab === 'subscriptions' || tab === 'revenue') await loadInvoices(); else await loadSchools();
  const live = S.schools.filter((s) => !s.archived);
  if (tab === 'schools') {
    const rows = S.schools.map((s) => [s.name, s.id, statusOf(s), s.billing ? s.billing.plan || '' : '', s.usage ? Number(s.usage.students) || 0 : 0, s.usage ? Number(s.usage.staff) || 0 : 0,
      s.billing ? Number(s.billing.studentLimit) || '' : '', effectiveMb(s)]);
    return { title: 'School report', header: ['School', 'School ID', 'Status', 'Plan', 'Students', 'Staff', 'Student limit', 'Storage used (MB)'], rows,
      stats: [['Schools', num(S.schools.length)], ['Live', num(live.length)], ['Students', num(rows.reduce((t, r) => t + r[4], 0))], ['Staff', num(rows.reduce((t, r) => t + r[5], 0))]] };
  }
  if (tab === 'subscriptions') {
    const rows = live.map((s) => { const inv = (s.invoices || []).filter((i) => i.status !== 'paid');
      return [s.name, s.billing ? s.billing.plan || '' : 'none', statusOf(s), s.billing ? Number(s.billing.monthlyPrice) || 0 : 0, s.billing ? dayOf(s.billing.startedOn) : '', s.billing ? dayOf(s.billing.trialEnds) : '',
        inv.length, inv.reduce((t, i) => t + owing(i), 0)]; });
    const active = live.filter((s) => s.billing && s.billing.status === 'active');
    return { title: 'Subscription report', header: ['School', 'Plan', 'Status', 'Monthly price (Rs)', 'Paid plan started', 'Trial ends', 'Unpaid invoices', 'Amount owing (Rs)'], rows,
      stats: [['Active subscriptions', num(active.length)], ['On trial', num(live.filter((s) => s.billing && s.billing.status === 'trial').length)], ['Monthly recurring revenue', money(active.reduce((t, s) => t + (Number(s.billing.monthlyPrice) || 0), 0))], ['Owing', money(rows.reduce((t, r) => t + r[7], 0))]] };
  }
  if (tab === 'revenue') {
    const months = new Map();
    for (const s of S.schools) for (const i of s.invoices || []) {
      const key = i.period || 'unknown'; const m = months.get(key) || { n: 0, billed: 0, paid: 0, refunded: 0, owing: 0 };
      m.n += 1; m.billed += Number(i.amount) || 0; m.paid += Number(i.amountPaid) || 0; m.refunded += Number(i.refunded) || 0; m.owing += owing(i); months.set(key, m);
    }
    const rows = [...months.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([k, m]) => [k, m.n, m.billed, m.paid, m.refunded, m.owing]);
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    return { title: 'Revenue report', header: ['Period', 'Invoices', 'Billed (Rs)', 'Collected (Rs)', 'Refunded (Rs)', 'Still owing (Rs)'], rows,
      stats: [['Billed', money(sum(2))], ['Collected', money(sum(3))], ['Refunded', money(sum(4))], ['Still owing', money(sum(5))]] };
  }
  const rows = live.filter((s) => s.billing).map((s) => { const used = effectiveMb(s); const limit = Number(s.billing.storageMb) || 0;
    return [s.name, used, limit, pct(used, limit), s.billing.storageCheckedOn || '']; }).sort((a, b) => b[3] - a[3]);
  return { title: 'Storage report', header: ['School', 'Used (MB)', 'Limit (MB)', 'Used (%)', 'Last measured on'], rows,
    stats: [['Total used (MB)', num(rows.reduce((t, r) => t + r[1], 0))], ['Over 80%', num(rows.filter((r) => r[3] >= 80).length)], ['Over limit', num(rows.filter((r) => r[3] >= 100).length)]] };
}

function printReport(title, header, rows) {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups for this page, then try again.'); return; }
  const d = w.document;
  const el = (tag, text) => { const e = d.createElement(tag); if (text !== undefined) e.textContent = String(text); return e; };
  d.title = title;
  const style = el('style', 'body{font:13px Arial,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}h1{font-size:18px;margin:0 0 4px}p{color:#555}');
  d.head.append(style);
  const table = el('table'); const head = el('tr');
  for (const t of header) head.append(el('th', t));
  const thead = el('thead'); thead.append(head); table.append(thead);
  const body = el('tbody');
  for (const r of rows) { const tr = el('tr'); for (const c of r) tr.append(el('td', c)); body.append(tr); }
  table.append(body);
  d.body.append(el('h1', title), el('p', 'Made ' + new Date().toLocaleString('en-IN') + ' by ' + (S.user.email || '') + '. Confidential: do not share outside the company.'), table);
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* the page stays open */ } }, 400);
}

async function viewReports(tab) {
  const tabs = REPORT_TABS.filter(([k]) => reportTabAllowed(k));
  if (!tabs.length) { show(h('div', { class: 'empty' }, 'Your staff role has no reports yet.')); return; }
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  setCrumbs('Reports', (tabs.find(([k]) => k === tab) || [])[1]);
  show(loading('Building the report.'));
  const data = await buildReport(tab);
  // An export needs a reason, which is kept in the audit log with what was exported. CSV and print both count as exports.
  const exportIt = (kind) => guarded(async () => {
    const v = await formDialog({ title: kind === 'csv' ? 'Download this report as CSV' : 'Print or save this report as PDF',
      note: 'The report holds business data about every school. The reason, your name and the number of rows are kept in the audit log.', ok: 'Export', fields: [REASON] });
    if (!v) return;
    const batch = writeBatch(db);
    audit(batch, 'export-report', '', v.reason, tab + ' ' + (kind === 'csv' ? 'CSV' : 'PDF') + ', ' + data.rows.length + ' rows');
    await batch.commit();
    if (kind === 'csv') exportCsv('aziz-' + tab + '-report-' + today() + '.csv', data.header, data.rows); else printReport(data.title, data.header, data.rows);
  });
  show(h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, data.title), h('button', { class: 'btn', onclick: () => exportIt('pdf') }, 'Print or save as PDF'), h('button', { class: 'btn gold', onclick: () => exportIt('csv') }, 'Download CSV')),
    h('div', { class: 'row' }, tabs.map(([k, t]) => h('a', { class: 'btn' + (k === tab ? ' gold' : ''), href: '#/reports/' + k }, t))),
    h('div', { class: 'grid' }, data.stats.map(([label, value]) => stat(label, value))),
    h('div', { class: 'card' }, data.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, data.header.map((t) => h('th', {}, t)))),
      h('tbody', {}, data.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, typeof c === 'number' ? num(c) : String(c ?? '')))))))) : h('div', { class: 'empty' }, 'Nothing to report yet.')));
}

// ---- platform settings: one document per group in platformConfig; every change is audited ----
const URL_PAT = /^https:\/\/[^\s]{3,200}$/;
const MAIL_PAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SETTING_GROUPS = [
  ['branding', 'Branding', 'The name, tagline, logo and colours the platform shows. Public: anyone can read this group.', [
    { key: 'productName', label: 'Product name', required: true, maxLen: 60 }, { key: 'tagline', label: 'Tagline', maxLen: 120 },
    { key: 'logoUrl', label: 'Logo address (https)', pattern: URL_PAT, patternText: 'Use an https address.' },
    { key: 'primaryColor', label: 'Main colour (#rrggbb)', pattern: /^#[0-9a-fA-F]{6}$/, patternText: 'Use a colour like #0b1a3b.' },
    { key: 'accentColor', label: 'Accent colour (#rrggbb)', pattern: /^#[0-9a-fA-F]{6}$/, patternText: 'Use a colour like #c9a227.' },
    { key: 'supportEmail', label: 'Public support email', pattern: MAIL_PAT, patternText: 'Use a real email address.' }]],
  ['locale', 'Language and time', 'Language is the default for school apps. Currency, time zone and date style apply to this admin panel (school apps do not use them yet). Anyone signed in can read this group.', [
    { key: 'language', label: 'Default language', type: 'select', options: [['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali']] },
    { key: 'timezone', label: 'Time zone', type: 'select', options: [['Asia/Kolkata', 'India (Asia/Kolkata)'], ['Asia/Dhaka', 'Bangladesh (Asia/Dhaka)'], ['Asia/Kathmandu', 'Nepal (Asia/Kathmandu)'], ['Asia/Dubai', 'Gulf (Asia/Dubai)'], ['UTC', 'UTC']] },
    { key: 'dateFormat', label: 'Date style', type: 'select', options: [['DD/MM/YYYY', '31/12/2026'], ['MM/DD/YYYY', '12/31/2026'], ['YYYY-MM-DD', '2026-12-31']] },
    { key: 'currency', label: 'Currency', type: 'select', options: [['INR', 'Rupee (INR)'], ['BDT', 'Taka (BDT)'], ['NPR', 'Nepali rupee (NPR)'], ['AED', 'Dirham (AED)'], ['USD', 'US dollar (USD)']] },
    { key: 'weekStart', label: 'Week starts on', type: 'select', options: [['monday', 'Monday'], ['sunday', 'Sunday']] }]],
  ['email', 'Email', 'How platform emails look. Only you can read this. Never type a password or key here: the Resend key is kept in Google Secret Manager (name RESEND_API_KEY). The from address must be on a domain verified in Resend.', [
    { key: 'fromAddress', label: 'From address (verified in Resend)', pattern: MAIL_PAT, patternText: 'Use a real email address.' }, { key: 'senderName', label: 'Sender name', maxLen: 60 }, { key: 'replyTo', label: 'Reply-to address', pattern: MAIL_PAT, patternText: 'Use a real email address.' },
    { key: 'supportEmail', label: 'Support address', pattern: MAIL_PAT, patternText: 'Use a real email address.' },
    { key: 'provider', label: 'Mail service (name only)', type: 'select', options: [['none', 'Not chosen yet'], ['resend', 'Resend'], ['sendgrid', 'SendGrid'], ['ses', 'Amazon SES'], ['smtp', 'Own mail server']] },
    { key: 'footerNote', label: 'Footer line on every email', maxLen: 200 }]],
  ['payment', 'Payments', 'What the platform tells schools about paying. Only you can read this. Never type a gateway secret key; the printed invoice shows the details below.', [
    { key: 'currency', label: 'Invoice currency', type: 'select', options: [['INR', 'Rupee (INR)'], ['BDT', 'Taka (BDT)'], ['USD', 'US dollar (USD)']] },
    { key: 'gstPercent', label: 'GST or tax percent (0 to 40)', type: 'number' }, { key: 'gstNumber', label: 'GST or tax number', maxLen: 30 },
    { key: 'upiId', label: 'UPI address', maxLen: 60 }, { key: 'bankDetails', label: 'Bank details for transfers', type: 'textarea', maxLen: 400 },
    { key: 'instructions', label: 'How to pay (printed on invoices)', type: 'textarea', maxLen: 400 },
    { key: 'gateway', label: 'Online gateway', type: 'select', options: [['none', 'None, record payments by hand'], ['razorpay', 'Razorpay (not connected yet)'], ['other', 'Other (not connected yet)']] }]],
  ['maintenance', 'Maintenance', 'A notice bar shown at the top of every school app while it is on and today is inside the dates. It does not lock anything.', [
    { key: 'on', label: 'Show the notice', type: 'select', options: [['off', 'Off'], ['on', 'On']] }, { key: 'message', label: 'Message (up to 200 letters)', maxLen: 200 },
    { key: 'startsOn', label: 'Show from (optional)', type: 'date' }, { key: 'endsOn', label: 'Show until (optional)', type: 'date' }]],
  ['legal', 'Legal and privacy', 'Links and versions for the terms and privacy policy. Public: anyone can read this group.', [
    { key: 'termsUrl', label: 'Terms address (https)', pattern: URL_PAT, patternText: 'Use an https address.' }, { key: 'termsVersion', label: 'Terms version', maxLen: 20 },
    { key: 'privacyUrl', label: 'Privacy policy address (https)', pattern: URL_PAT, patternText: 'Use an https address.' }, { key: 'privacyVersion', label: 'Privacy version', maxLen: 20 },
    { key: 'retentionNote', label: 'Data retention statement', type: 'textarea', maxLen: 300 }, { key: 'grievanceEmail', label: 'Privacy or grievance contact', pattern: MAIL_PAT, patternText: 'Use a real email address.' }]],
];
async function readSettingDoc(id) {
  const found = await getDocFromServer(doc(db, 'platformConfig', id)).catch(() => null);
  return found && found.exists() ? found.data() : {};
}
async function viewSettings(tab) {
  if (!isAdmin()) { show(h('div', { class: 'empty' }, 'Only the super admin changes platform settings.')); return; }
  const group = SETTING_GROUPS.find((g) => g[0] === tab) || SETTING_GROUPS[0];
  const [id, label, note, fields] = group;
  setCrumbs('Settings', label);
  show(loading('Loading settings.'));
  const current = await readSettingDoc(id);
  const shown = (f) => { const v = id === 'maintenance' && f.key === 'on' ? (current.on === true ? 'on' : 'off') : current[f.key];
    if (v === undefined || v === '') return h('span', { class: 'muted' }, 'not set'); const opt = f.options ? f.options.find((o) => o[0] === v) : null; return String(opt ? opt[1] : v); };
  const edit = () => guarded(async () => {
    const v = await formDialog({ title: 'Change ' + label.toLowerCase() + ' settings', note, ok: 'Save', fields: [...fields.map((f) => ({ ...f,
      value: id === 'maintenance' && f.key === 'on' ? (current.on === true ? 'on' : 'off') : current[f.key] ?? (f.type === 'select' ? f.options[0][0] : '') })), REASON] });
    if (!v) return;
    const data = {};
    for (const f of fields) {
      let value = v[f.key];
      if (value === '' || value === undefined) continue;
      if (f.maxLen && String(value).length > f.maxLen) { toast(f.label + ' is too long (up to ' + f.maxLen + ' letters).'); return; }
      if (id === 'maintenance' && f.key === 'on') value = value === 'on';
      data[f.key] = value;
    }
    if (id === 'branding' && !data.productName) { toast('The product name is required.'); return; }
    if (id === 'payment' && data.gstPercent !== undefined && data.gstPercent > 40) { toast('Tax percent must be 0 to 40.'); return; }
    if (id === 'maintenance' && data.on === true && !data.message) { toast('Write the message people should see.'); return; }
    if (id === 'maintenance' && data.startsOn && data.endsOn && data.startsOn > data.endsOn) { toast('The end date comes before the start date.'); return; }
    data.updatedBy = S.user.email || S.user.uid; data.updatedOn = today();
    const batch = writeBatch(db);
    batch.set(doc(db, 'platformConfig', id), data);
    audit(batch, 'platform-setting', '', v.reason, JSON.stringify({ group: id, before: current, after: data }));
    await batch.commit(); toast('Settings saved.'); await viewSettings(id);
  });
  const testEmail = () => guarded(async () => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    let r;
    try { r = (await httpsCallable(getFunctions(app, 'asia-south1'), 'sendTestEmail')()).data; } catch { toast('Could not run it. Check that the server functions are deployed.'); return; }
    toast(r.ok ? 'Test email sent to ' + r.to + '.' : (r.hint || r.error || 'Not sent.'));
  });
  show(h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Platform settings'), id === 'email' ? h('button', { class: 'btn', onclick: testEmail }, 'Send me a test email') : null, h('button', { class: 'btn gold', onclick: edit }, 'Change')),
    h('div', { class: 'row' }, SETTING_GROUPS.map(([k, t]) => h('a', { class: 'btn' + (k === id ? ' gold' : ''), href: '#/settings/' + k }, t))),
    h('div', { class: 'card' }, h('h3', {}, label), h('p', { class: 'muted' }, note),
      h('table', {}, h('tbody', {}, fields.map((f) => h('tr', {}, h('td', { style: 'width:40%' }, f.label), h('td', {}, shown(f)))))),
      current.updatedBy ? h('p', { class: 'muted' }, 'Last changed by ' + current.updatedBy + ' on ' + (current.updatedOn || '?') + '. Every change is in the audit log with the old and new values.') : h('p', { class: 'muted' }, 'Nothing saved yet.')),
    id === 'maintenance' ? h('div', { class: 'card' }, h('h3', {}, 'What people see'), current.on === true && current.message ? h('div', { class: 'alert' }, h('span', { class: 'pill warn' }, 'Notice'), h('span', {}, current.message)) : h('div', { class: 'empty' }, 'No notice is showing.')) : null);
}

// ---- insights: usage anomalies, churn indicators and a plain written summary. These are fixed rules, not AI, so they cost nothing and no data leaves the platform. ----
async function viewInsights() {
  setCrumbs('Insights');
  show(loading('Working out the signals.'));
  await loadInvoices();
  const snap = await getDocs(collection(db, 'supportTickets')).catch(() => null);
  const openBy = new Map();
  if (snap) for (const d of snap.docs) { const t = d.data(); if (t.status !== 'closed') openBy.set(t.schoolId, (openBy.get(t.schoolId) || 0) + 1); }
  const now = Date.now(); const DAY = 86400000;
  const live = S.schools.filter((s) => !s.archived);
  const rows = live.map((s) => {
    const b = s.billing || {}; const u = s.usage || {}; const anomalies = []; const risks = [];
    const students = Number(u.students) || 0; const limit = Number(b.studentLimit) || 0;
    const used = effectiveMb(s); const cap = Number(b.storageMb) || 0;
    const quiet = u.updatedAt ? Math.floor((now - msOfAny(u.updatedAt)) / DAY) : null;
    if (limit && students >= limit) anomalies.push(['bad', 'At the student limit (' + students + ' of ' + limit + ')']);
    else if (limit && students >= limit * 0.9) anomalies.push(['warn', 'Near the student limit (' + students + ' of ' + limit + ')']);
    if (cap && used >= cap) anomalies.push(['bad', 'Storage is over its limit (' + num(used) + ' of ' + num(cap) + ' MB)']);
    else if (cap && used >= cap * 0.9) anomalies.push(['warn', 'Storage is above 90% (' + num(used) + ' of ' + num(cap) + ' MB)']);
    const reported = Number(u.storageMb) || 0; const measured = b.storageCheckedMb;
    if (measured != null && reported && Math.abs(measured - reported) / Math.max(measured, reported) > 0.1) anomalies.push(['warn', 'Reported and measured storage differ by more than 10%']);
    if (b.status === 'active' && b.plan !== 'trial' && u.students !== undefined && students === 0) anomalies.push(['warn', 'Paying school with no students recorded']);
    if (b.status === 'active' && quiet !== null && quiet > 14) anomalies.push(['warn', 'Usage record not updated for ' + quiet + ' days']);
    let score = 0;
    if (['suspended', 'cancelled'].includes(b.status)) { score += 3; risks.push('Suspended or cancelled'); }
    const overdue = (s.unpaid || []).filter((i) => i.status === 'overdue').length;
    if (overdue) { score += 2; risks.push(overdue + ' overdue invoice(s)'); }
    const trialMs = msOfAny(b.trialEnds);
    if (b.status === 'trial' && trialMs) { const left = Math.ceil((trialMs - now) / DAY); if (left < 0) { score += 3; risks.push('Trial ended ' + (-left) + ' days ago'); } else if (left <= 7) { score += 2; risks.push('Trial ends in ' + left + ' days'); } }
    if (quiet !== null && quiet > 14) { score += 2; risks.push('Quiet for ' + quiet + ' days'); }
    if ((openBy.get(s.id) || 0) >= 3) { score += 1; risks.push((openBy.get(s.id)) + ' open support tickets'); }
    const level = score >= 5 ? 'High' : score >= 3 ? 'Medium' : score >= 1 ? 'Low' : 'None';
    return { s, anomalies, risks, score, level, status: statusOf(s) };
  });
  const risky = rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const odd = rows.filter((r) => r.anomalies.length);
  const count = (st) => live.filter((s) => statusOf(s) === st).length;
  const owingAll = live.reduce((t, s) => t + (s.unpaid || []).reduce((a, i) => a + owing(i), 0), 0);
  const lines = [
    live.length + ' schools are live: ' + count('active') + ' active, ' + count('trial') + ' on trial, ' + (count('suspended') + count('cancelled')) + ' suspended or cancelled.',
    risky.length ? risky.length + ' school(s) show churn signals; the most at risk are ' + risky.slice(0, 3).map((r) => r.s.name + ' (' + r.level + ')').join(', ') + '.' : 'No school shows a churn signal today.',
    odd.length ? odd.length + ' school(s) have a usage anomaly, for example ' + odd[0].s.name + ': ' + odd[0].anomalies[0][1] + '.' : 'No usage anomalies found.',
    'Money owing across all schools: ' + money(owingAll) + '.',
    (S.opsAlerts || []).length ? (S.opsAlerts.length) + ' operations alert(s) are open, for example: ' + S.opsAlerts[0].text : 'No operations alerts (backups, errors and incidents look fine).',
  ];
  const copy = () => { try { navigator.clipboard.writeText(lines.join('\n')); toast('Summary copied.'); } catch { toast('Copy did not work; select the text instead.'); } };
  const levelPill = (l) => h('span', { class: 'pill ' + (l === 'High' ? 'bad' : l === 'Medium' ? 'warn' : '') }, l);
  show(h('div', { class: 'row' }, h('h2', { style: 'flex:1' }, 'Insights'), h('button', { class: 'btn', onclick: copy }, 'Copy summary')),
    h('p', { class: 'muted' }, 'Worked out live from billing, usage, invoices and tickets with fixed rules. They are signals to look at, not verdicts. A written AI summary needs an AI key and is not switched on.'),
    h('div', { class: 'card' }, h('h3', {}, 'Health summary'), lines.map((t) => h('p', {}, t))),
    h('div', { class: 'card' }, h('h3', {}, 'Churn indicators'), risky.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['School', 'Status', 'Risk', 'Why'].map((t) => h('th', {}, t)))),
      h('tbody', {}, risky.map((r) => h('tr', {}, h('td', {}, h('a', { href: '#/school/' + r.s.id }, r.s.name)), h('td', {}, pillFor(r.status)), h('td', {}, levelPill(r.level)), h('td', {}, r.risks.join('; ')))))))
      : h('div', { class: 'empty' }, 'No school shows a churn signal.')),
    h('div', { class: 'card' }, h('h3', {}, 'Usage anomalies'), odd.length ? odd.map((r) => h('div', { class: 'alert' }, h('a', { href: '#/school/' + r.s.id }, r.s.name), r.anomalies.map(([cls, text]) => h('span', { class: 'pill ' + cls }, text))))
      : h('div', { class: 'empty' }, 'No anomalies. Usage looks normal for every school.'), h('p', { class: 'muted' }, 'Rules used: at or near the student limit, storage near or over its limit, reported and measured storage far apart, paying school with no students, usage record not updated for 14 days.')));
}

async function route() {
  const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'dashboard';
  if (!isAdmin() && (name === 'dashboard' || !routeAllowed(name))) {
    const first = firstAllowedRoute();
    if (first === 'denied') { show(h('div', { class: 'empty' }, 'Your staff role has no pages yet. Ask the super admin to give you a permission.')); return; }
    if (name !== first) { location.hash = '#/' + first; return; }
  }
  if (!(name === 'schools' && parts[1] === 'register')) closeOnboarding();
  for (const a of document.querySelectorAll('nav.side a.item[data-r]')) a.classList.toggle('on', a.dataset.r === (name === 'school' ? 'schools' : name));
  await guarded(async () => {
    if (name === 'schools' && parts[1] === 'register') await openRegister(decodeURIComponent(parts[2] || ''));
    else if (name === 'schools') await viewSchools();
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
    else if (name === 'audit') await viewAudit(parts[1] || 'log');
    else if (name === 'infra') await viewInfra();
    else if (name === 'backups') await viewBackups();
    else if (name === 'support') await viewSupport();
    else if (name === 'incidents') await viewIncidents();
    else if (name === 'staff') await viewStaff();
    else if (name === 'reports') await viewReports(parts[1] || 'schools');
    else if (name === 'settings') await viewSettings(parts[1] || 'branding');
    else if (name === 'insights') await viewInsights();
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

async function recordAttempt(user) {
  try {
    if (sessionStorage.getItem('aziz-denied') === user.uid) return;
    const stamp = String(9999999999999 - Date.now()).padStart(13, '0');
    await setDoc(doc(db, 'accessAttempts', user.uid + '_' + stamp), { uid: user.uid, email: String(user.email || '').slice(0, 120), agent: navigator.userAgent.slice(0, 160), at: serverTimestamp() });
    sessionStorage.setItem('aziz-denied', user.uid);
  } catch { /* the record is best effort */ }
}
async function acceptInvite(user, invite) {
  const email = user.email.toLowerCase();
  const batch = writeBatch(db);
  const auditId = newId('A-');
  batch.set(doc(db, 'platformAudit', auditId), { actor: user.uid, actorEmail: email, action: 'staff-joined', detail: String(invite.role), at: serverTimestamp() });
  batch.set(doc(db, 'platformStaff', user.uid), { email, role: invite.role, perms: invite.perms, status: 'active', joinedAt: serverTimestamp(), auditId });
  batch.update(doc(db, 'staffInvites', email), { status: 'accepted', acceptedAt: serverTimestamp() });
  await batch.commit();
}
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('/app'); return; }
  let role = null; let staffData = null; let revoked = false; let invite = null;
  try { if ((await getDocFromServer(doc(db, 'platformAdmins', user.uid))).exists()) role = 'admin'; } catch { /* not an admin */ }
  if (!role) {
    try {
      const mine = await getDocFromServer(doc(db, 'platformStaff', user.uid));
      if (mine.exists()) { if (mine.data().status === 'active') { role = 'staff'; staffData = mine.data(); } else revoked = true; }
    } catch { /* no staff record */ }
  }
  if (!role && !revoked && user.email && user.emailVerified) {
    try { const found = await getDocFromServer(doc(db, 'staffInvites', user.email.toLowerCase())); if (found.exists() && found.data().status === 'invited') invite = found.data(); } catch { /* no invitation */ }
  }
  if (!role && invite) {
    const button = h('button', { class: 'btn gold' }, 'Accept the invitation');
    const note = h('p', { class: 'err' });
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await acceptInvite(user, invite); location.reload(); } catch (error) { note.textContent = friendly(error); button.disabled = false; }
    });
    $('gate').replaceChildren(h('div', { style: 'text-align:center;max-width:420px' }, h('h2', {}, 'You are invited'), h('p', { class: 'muted' }, 'You have been invited to the AZIZ Super Admin panel as ' + (ROLE_LABEL[invite.role] || invite.role) + ': ' + permText(invite.perms) + '.'), button, note));
    return;
  }
  if (!role) {
    recordAttempt(user);
    $('gate').replaceChildren(h('div', { style: 'text-align:center' }, h('h2', {}, revoked ? 'Access revoked' : 'Super admin only'), h('p', { class: 'muted' }, revoked ? 'Your staff access has been revoked.' : 'This account is not a platform administrator or staff member. If you were invited, sign in with the email address that received the invitation (it must be verified).'), h('a', { href: '/app' }, 'Go to the school app')));
    return;
  }
  S.user = user; S.role = role; S.staff = staffData;
  try { const lc = await getDocFromServer(doc(db, 'platformConfig', 'locale')); if (lc.exists()) LOCALE = { ...LOCALE, ...Object.fromEntries(['currency', 'timezone', 'dateFormat'].filter((k) => typeof lc.data()[k] === 'string').map((k) => [k, lc.data()[k]])) }; } catch { /* keep the defaults */ }
  $('who').textContent = user.email || user.uid;
  $('gate').hidden = true; $('gate').style.display = 'none'; $('shell').hidden = false;
  applyRoleToPage();
  wireTop();
  route();
  if (can('ops') || can('audit')) opsAlerts();
});
