// Platform layer: self-service signup, plan and billing view, usage, support tickets, invitations,
// domain and data requests, consent, and the platform administrator dashboard.
// Everything read from the database is shown as plain text, never as HTML.
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, sendEmailVerification,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app } from './firebase-client.mjs';

const auth = getAuth(app);
const db = getFirestore(app);
const SLUG = /^[a-z][a-z0-9-]{2,29}$/;
const RESERVED = ['www', 'admin', 'api', 'app', 'platform', 'school', 'aziz', 'public', 'support', 'demo'];
const POLICY_VERSION = '2026-1';
const wanted = new URLSearchParams(location.search).get('school') ?? '';
const SCHOOL_ID = SLUG.test(wanted) ? wanted : 'abcd-school';
const schoolRef = doc(db, 'schools', SCHOOL_ID);
const $ = (selector) => document.querySelector(selector);
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const newId = (prefix) => prefix + '-' + today().replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
const rupees = (n) => 'Rs ' + Number(n ?? 0).toLocaleString('en-IN');
const dateOf = (stamp) => (stamp?.toDate ? stamp.toDate() : null);
const dayText = (stamp) => { const d = dateOf(stamp); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; };
const daysLeft = (stamp) => { const d = dateOf(stamp); return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null; };

const signup = { form: $('#signup-form'), status: $('#signup-status'), account: $('#signup-account'), box: $('#signup') };
const plan = {
  section: $('#plan-section'), banner: $('#plan-banner'), details: $('#plan-details'), usage: $('#usage-line'),
  invoices: $('#plan-invoices'), tickets: $('#ticket-list'), invites: $('#invite-list'), members: $('#member-list'),
  domains: $('#domain-list'), data: $('#data-list'), status: $('#plan-status'),
  consentBox: $('#consent-box'), consentVersion: $('#consent-version'),
};
const accept = { section: $('#invite-accept'), status: $('#invite-accept-status'), list: $('#invite-accept-list') };
const admin = {
  section: $('#platform-section'), status: $('#platform-status'), revenue: $('#platform-revenue'), schools: $('#platform-schools'),
  panel: $('#platform-school'), title: $('#platform-school-title'), usage: $('#platform-usage'),
  billing: $('#billing-form'), invoiceForm: $('#invoice-form'), invoices: $('#platform-invoices'),
  requests: $('#platform-requests'), tickets: $('#platform-tickets'), flagsForm: $('#flags-form'),
  templateForm: $('#template-form'), templateInfo: $('#template-info'), flagBoxes: $('#flags-boxes'), drillForm: $('#drill-form'), drills: $('#drill-list'),
};
let me = null;
let myRole = '';
let billing = null;
let chosenSchool = '';
let busy = false;
const pageOpenedAt = Date.now();

const button = (label, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};
function fillList(list, rows, empty) {
  list.replaceChildren();
  if (!rows.length) {
    const item = document.createElement('li');
    item.textContent = empty;
    list.append(item);
    return;
  }
  for (const [text, ...buttons] of rows) {
    const item = document.createElement('li');
    item.textContent = text + ' ';
    for (const b of buttons) item.append(b, ' ');
    list.append(item);
  }
}
const run = async (statusEl, action, done) => {
  if (busy) return;
  busy = true;
  statusEl.textContent = 'Working.';
  try {
    await action();
    statusEl.textContent = done;
  } catch (error) {
    statusEl.textContent = error?.code === 'permission-denied'
      ? 'That is not allowed. If the school is suspended it is read-only.'
      : 'That did not work. Check the details and try again.';
  } finally {
    busy = false;
  }
};

// ---------- Signup ----------
if (location.hash === '#signup') { signup.box.open = true; signup.box.scrollIntoView(); }
onAuthStateChanged(auth, (user) => { signup.account.hidden = Boolean(user); });
signup.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = new FormData(signup.form);
  const slug = String(f.get('slug')).trim().toLowerCase();
  const name = String(f.get('name')).trim();
  if (!SLUG.test(slug) || RESERVED.includes(slug)) {
    signup.status.textContent = 'That web name is not allowed. Use 3 to 30 lowercase letters, numbers or dashes, starting with a letter.';
    return;
  }
  if (!name) { signup.status.textContent = 'Enter the school name.'; return; }
  // Browser-side abuse guard: a short wait after the page opens, 30 seconds between tries, three new schools a day.
  // It slows careless spam only; real protection needs Firebase App Check, switched on in the console.
  let times = [];
  try { times = JSON.parse(localStorage.getItem('aziz-signup-times') ?? '[]').filter((t) => Number.isFinite(t) && Date.now() - t < 86400000); } catch { /* none */ }
  if (Date.now() - pageOpenedAt < 4000) { signup.status.textContent = 'Please take a moment to fill in the form, then try again.'; return; }
  if (times.length >= 3) { signup.status.textContent = 'Too many schools were created from this browser today. Please try again tomorrow or contact us.'; return; }
  if (times.length && Date.now() - times[times.length - 1] < 30000) { signup.status.textContent = 'Please wait half a minute before trying again.'; return; }
  if (busy) return;
  busy = true;
  signup.status.textContent = 'Creating your school.';
  try {
    let user = auth.currentUser;
    if (!user) {
      const email = String(f.get('email')).trim();
      const password = String(f.get('password'));
      if (!email || password.length < 8) { signup.status.textContent = 'Enter your email and a password of at least 8 characters.'; busy = false; return; }
      user = (await createUserWithEmailAndPassword(auth, email, password)).user;
      sendEmailVerification(user).catch(() => {});
    }
    const batch = writeBatch(db);
    const school = doc(db, 'schools', slug);
    batch.set(school, { name, contactEmail: user.email ?? '', phone: String(f.get('phone')).trim(), address: String(f.get('address')).trim(), createdBy: user.uid });
    batch.set(doc(school, 'members', user.uid), { role: 'owner', active: true });
    batch.set(doc(school, 'billing', 'main'), {
      plan: 'trial', status: 'trial', trialEnds: Timestamp.fromDate(new Date(Date.now() + 30 * 86400000)), studentLimit: 50, staffLimit: 10,
    });
    await batch.commit();
    try { localStorage.setItem("aziz-signup-times", JSON.stringify([...times, Date.now()])); } catch { /* Storage may be off. */ }
    signup.status.textContent = 'School created. Opening it now.';
    location.search = '?school=' + slug;
  } catch (error) {
    signup.status.textContent = error?.code === 'auth/email-already-in-use'
      ? 'That email already has an account. Sign in first, then create the school.'
      : error?.code === 'permission-denied'
        ? 'That web name is already taken. Try another.'
        : 'Could not create the school. Check the details and try again.';
  } finally {
    busy = false;
  }
});

// ---------- Invitations for the signed-in person ----------
async function loadMyInvites(user) {
  accept.section.hidden = true;
  accept.list.replaceChildren();
  if (!user.email) return;
  if (!user.emailVerified) {
    accept.section.hidden = false;
    accept.status.textContent = 'Verify your email address (we sent you a link) to see and accept invitations. Then refresh this page.';
    return;
  }
  try {
    const found = await getDocs(query(collection(db, 'invites'), where('email', '==', user.email.toLowerCase())));
    const pending = found.docs.filter((d) => d.data().status === 'pending');
    if (!pending.length) return;
    accept.section.hidden = false;
    fillList(accept.list, pending.map((d) => [
      'Join school "' + d.data().schoolId + '" as ' + d.data().role + '.',
      button('Accept', () => run(accept.status, async () => {
        const batch = writeBatch(db);
        batch.set(d.ref, { ...d.data(), status: 'accepted' });
        batch.set(doc(db, 'schools', d.data().schoolId, 'members', user.uid), { role: d.data().role, active: true, inviteId: d.id });
        await batch.commit();
        location.search = '?school=' + d.data().schoolId;
      }, 'Accepted.')),
    ]), '');
  } catch { /* no invitations or no access */ }
}

// ---------- Owner / principal view ----------
function showBanner() {
  if (!billing) { plan.banner.textContent = 'No plan has been recorded for this school yet.'; return; }
  const left = daysLeft(billing.trialEnds);
  if (['suspended', 'cancelled'].includes(billing.status)) {
    plan.banner.textContent = 'This school is ' + billing.status + '. Everything is read-only until the account is reactivated. Contact support.';
  } else if (billing.status === 'trial') {
    plan.banner.textContent = left === null ? 'Free trial.' : left >= 0 ? 'Free trial: ' + left + ' day(s) left.' : 'The free trial ended ' + (-left)
      + ' day(s) ago. ' + (billing.graceDays && billing.graceDays + left >= 0
        ? 'Grace period: ' + (billing.graceDays + left) + ' day(s) left, then the school becomes read-only.'
        : 'The school is now read-only. Contact support to continue; you can still download your data from Data Backup.');
  } else if (billing.renewsOn) {
    const d = daysLeft(Timestamp.fromDate(new Date(billing.renewsOn + 'T00:00:00')));
    plan.banner.textContent = d !== null && d < 0 ? 'Renewal was due on ' + billing.renewsOn + '. Please pay to avoid suspension.' : 'Renews on ' + billing.renewsOn + '.';
  } else plan.banner.textContent = '';
}
function showPlan() {
  plan.details.replaceChildren();
  const rows = billing ? [
    ['Plan', billing.plan], ['Status', billing.status], ['Trial ends', dayText(billing.trialEnds) || '-'], ['Renews on', billing.renewsOn ?? '-'],
    ['Student limit', billing.studentLimit ?? 'no limit'], ['Staff limit', billing.staffLimit ?? 'no limit'],
    ['Storage', billing.storageMb != null ? billing.storageMb + ' MB' : '-'], ['Monthly price', billing.monthlyPrice != null ? rupees(billing.monthlyPrice) : '-'],
    ['Legal hold', billing.legalHold ? 'Yes - nothing can be deleted' : 'No'],
  ] : [['Plan', 'not set']];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = String(v);
    plan.details.append(dt, dd);
  }
}
async function showUsage() {
  try {
    const usage = await getDoc(doc(schoolRef, 'usage', 'main'));
    if (!usage.exists()) { plan.usage.textContent = 'Usage has not been counted yet.'; return; }
    const u = usage.data();
    const over = (n, limit) => (limit != null && n > limit ? ' (OVER the limit of ' + limit + ')' : limit != null ? ' of ' + limit : '');
    plan.usage.textContent = 'Students: ' + u.students + over(u.students, billing?.studentLimit) + '. Staff: ' + u.staff + over(u.staff, billing?.staffLimit)
      + (u.classes != null ? '. Classes: ' + u.classes : '') + '. Counted on ' + (dayText(u.updatedAt) || '-') + '.';
  } catch { plan.usage.textContent = 'Usage could not be loaded.'; }
}
async function loadPlan() {
  plan.status.textContent = '';
  try { const b = await getDoc(doc(schoolRef, 'billing', 'main')); billing = b.exists() ? b.data() : null; } catch { billing = null; }
  showBanner(); showPlan(); await showUsage();
  try {
    const inv = await getDocs(collection(schoolRef, 'invoices'));
    fillList(plan.invoices, inv.docs.map((d) => d.data()).sort((a, b) => b.period.localeCompare(a.period))
      .map((i) => [i.period + ': ' + rupees(i.amount) + ', due ' + i.dueOn + ', ' + i.status + (i.paidOn ? ' (paid ' + i.paidOn + ')' : '')]), 'No invoices yet.');
  } catch { fillList(plan.invoices, [], 'Invoices could not be loaded.'); }
  await Promise.all([loadTickets(), loadInvites(), loadMembers(), loadDomains(), loadData(), loadConsent()]);
}
async function loadConsent() {
  plan.consentVersion.textContent = POLICY_VERSION;
  try {
    const c = await getDoc(doc(schoolRef, 'consents', me.uid));
    plan.consentBox.hidden = c.exists() && c.data().policyVersion === POLICY_VERSION;
  } catch { plan.consentBox.hidden = true; }
}
$('#consent-accept').addEventListener('click', () => run(plan.status, async () => {
  await setDoc(doc(schoolRef, 'consents', me.uid), { policyVersion: POLICY_VERSION, acceptedAt: serverTimestamp() });
  plan.consentBox.hidden = true;
}, 'Thank you. Your acceptance is recorded.'));
async function recountUsage() {
  const [students, staff, classes] = await Promise.all(['students', 'staff', 'classes'].map((n) => getDocs(collection(schoolRef, n))));
  let storageMb = 0;
  try { storageMb = Math.ceil((await getDocs(collection(schoolRef, 'storageRecords'))).docs.reduce((total, d) => total + (d.data().sizeKb ?? 0), 0) / 1024); } catch { storageMb = 0; }
  await setDoc(doc(schoolRef, 'usage', 'main'), { students: students.size, staff: staff.size, classes: classes.size, storageMb, updatedAt: serverTimestamp() });
  await showUsage();
}
$('#usage-refresh').addEventListener('click', () => run(plan.status, recountUsage, 'Usage updated.'));
// The plan limits are checked against the last counted usage, so the count is refreshed after students or staff are added.
let usageTimer = 0;
document.addEventListener('usage-changed', () => {
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => { if (schoolRef && myRole === 'owner') recountUsage().catch(() => {}); }, 1500);
});

async function loadTickets() {
  try {
    const found = await getDocs(query(collection(db, 'supportTickets'), where('schoolId', '==', SCHOOL_ID)));
    fillList(plan.tickets, found.docs.map((d) => d.data()).sort((a, b) => b.createdOn.localeCompare(a.createdOn)).map((t) =>
      [t.createdOn + ' - ' + t.subject + ' [' + t.status + ']' + (t.reply ? ' Reply: ' + t.reply : '')]), 'No tickets.');
  } catch { fillList(plan.tickets, [], 'Tickets could not be loaded.'); }
}
$('#ticket-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(event.target);
  run(plan.status, async () => {
    await setDoc(doc(db, 'supportTickets', newId('ST')), {
      schoolId: SCHOOL_ID, subject: String(f.get('subject')).trim(), body: String(f.get('body')).trim(), status: 'open', createdBy: me.uid, createdOn: today(),
    });
    event.target.reset();
    await loadTickets();
  }, 'Sent to support.');
});

async function loadInvites() {
  try {
    const found = await getDocs(query(collection(db, 'invites'), where('schoolId', '==', SCHOOL_ID)));
    fillList(plan.invites, found.docs.map((d) => [d.data().email + ' as ' + d.data().role + ' - ' + d.data().status,
      ...(d.data().status === 'pending' && myRole === 'owner' ? [button('Cancel invitation', () => run(plan.status, async () => {
        await setDoc(d.ref, { ...d.data(), status: 'revoked' });
        await loadInvites();
      }, 'Invitation cancelled.'))] : [])]), 'No invitations.');
  } catch { fillList(plan.invites, [], 'Invitations could not be loaded.'); }
}
$('#invite-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(event.target);
  run(plan.status, async () => {
    await setDoc(doc(db, 'invites', newId('IN')), {
      schoolId: SCHOOL_ID, email: String(f.get('email')).trim().toLowerCase(), role: String(f.get('role')), status: 'pending', createdBy: me.uid,
    });
    event.target.reset();
    await loadInvites();
  }, 'Invitation saved. Ask them to sign in with that email on this page.');
});
async function loadMembers() {
  try {
    const found = await getDocs(collection(schoolRef, 'members'));
    let consents = new Map();
    try { consents = new Map((await getDocs(collection(schoolRef, 'consents'))).docs.map((c) => [c.id, c.data()])); } catch { consents = new Map(); }
    const consentText = (uid) => (consents.has(uid)
      ? ' - privacy policy ' + consents.get(uid).policyVersion + (dayText(consents.get(uid).acceptedAt) ? ' accepted ' + dayText(consents.get(uid).acceptedAt) : ' accepted')
      : ' - has not accepted the privacy policy');
    fillList(plan.members, found.docs.map((d) => ['Member ' + d.id.slice(0, 6) + '… (' + d.data().role + ') - ' + (d.data().active ? 'active' : 'switched off') + consentText(d.id),
      ...(myRole === 'owner' && d.id !== me.uid ? [button(d.data().active ? 'Switch off' : 'Switch on', () => run(plan.status, async () => {
        await updateDoc(d.ref, { active: !d.data().active });
        await loadMembers();
      }, 'Updated.'))] : [])]), 'No members.');
  } catch { fillList(plan.members, [], 'Members could not be loaded.'); }
}
async function loadDomains() {
  try {
    const found = await getDocs(collection(schoolRef, 'domainRequests'));
    fillList(plan.domains, found.docs.map((d) => [d.data().domain + ' - ' + d.data().status + (d.data().note ? ' (' + d.data().note + ')' : '')
      + (d.data().dnsTarget ? '. Set this at your domain provider: ' + d.data().dnsTarget : '')
      + (d.data().ssl ? '. Secure certificate: ' + d.data().ssl : '') + (d.data().checkedOn ? '. Last checked ' + d.data().checkedOn : '')]), 'No domain requests.');
  } catch { fillList(plan.domains, [], 'Requests could not be loaded.'); }
}
$('#domain-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const domain = String(new FormData(event.target).get('domain')).trim().toLowerCase();
  run(plan.status, async () => {
    await setDoc(doc(schoolRef, 'domainRequests', newId('DM')), { domain, status: 'requested', createdOn: today() });
    event.target.reset();
    await loadDomains();
  }, 'Requested. Support will tell you which DNS records to add.');
});
async function loadData() {
  try {
    const found = await getDocs(collection(schoolRef, 'dataRequests'));
    fillList(plan.data, found.docs.map((d) => [d.data().createdOn + ' - ' + d.data().kind + ' - ' + d.data().status + (d.data().note ? ' (' + d.data().note + ')' : '')]), 'No data requests.');
  } catch { fillList(plan.data, [], 'Requests could not be loaded.'); }
}
$('#data-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const kind = String(new FormData(event.target).get('kind'));
  if (kind === 'deletion' && !confirm('Ask for ALL school data to be deleted? Support will confirm with you before anything is removed.')) return;
  run(plan.status, async () => {
    await setDoc(doc(schoolRef, 'dataRequests', newId('DR')), { kind, status: 'requested', createdOn: today() });
    await loadData();
  }, 'Request sent. Nothing is deleted until support confirms with you.');
});

// ---------- Platform administrator ----------
const FLAGS = [['website', 'Public website'], ['finance', 'Finance'], ['library', 'Library'], ['transport', 'Transport'], ['portal', 'Parent portal']];
let allSchools = [];
async function loadAdmin() {
  admin.section.hidden = false;
  admin.status.textContent = 'Loading schools.';
  try {
    const list = await getDocs(collection(db, 'schools'));
    allSchools = await Promise.all(list.docs.map(async (d) => {
      const [b, u, inv] = await Promise.all([getDoc(doc(d.ref, 'billing', 'main')), getDoc(doc(d.ref, 'usage', 'main')), getDocs(collection(d.ref, 'invoices'))]);
      return { id: d.id, name: d.data().name, billing: b.exists() ? b.data() : null, usage: u.exists() ? u.data() : null, invoices: inv.docs.map((x) => x.data()) };
    }));
    let paid = 0; let due = 0; let mrr = 0;
    for (const s of allSchools) {
      for (const i of s.invoices) { if (i.status === 'paid') paid += i.amount; else due += i.amount; }
      if (s.billing?.status === 'active') mrr += s.billing.monthlyPrice ?? 0;
    }
    admin.revenue.textContent = allSchools.length + ' school(s). Monthly recurring: ' + rupees(mrr) + '. Collected: ' + rupees(paid) + '. Unpaid: ' + rupees(due) + '.';
    const byPlan = new Map();
    for (const s of allSchools) {
      const key = (s.billing?.plan ?? 'no plan') + ' / ' + (s.billing?.status ?? '-');
      const row = byPlan.get(key) ?? { n: 0, mrr: 0 };
      row.n += 1;
      if (s.billing?.status === 'active') row.mrr += s.billing.monthlyPrice ?? 0;
      byPlan.set(key, row);
    }
    const byMonth = new Map();
    for (const s of allSchools) for (const i of s.invoices) {
      const row = byMonth.get(i.period) ?? { paid: 0, unpaid: 0 };
      if (i.status === 'paid') row.paid += i.amount; else row.unpaid += i.amount;
      byMonth.set(i.period, row);
    }
    const peak = Math.max(1, ...[...byMonth.values()].map((r) => r.paid + r.unpaid));
    const bar = (value) => '#'.repeat(Math.round(value / peak * 20));
    fillList($('#platform-revenue-breakdown'), [
      ...[...byPlan.entries()].sort().map(([key, r]) => ['Plan ' + key + ': ' + r.n + ' school(s), monthly ' + rupees(r.mrr)]),
      ...[...byMonth.entries()].sort().reverse().slice(0, 12).map(([period, r]) => [period + ': paid ' + rupees(r.paid) + ', unpaid ' + rupees(r.unpaid) + ' ' + bar(r.paid) + (r.unpaid ? ' (' + bar(r.unpaid).replaceAll('#', '.') + ')' : '')]),
    ], 'No billing yet.');
    fillList(admin.schools, allSchools.map((s) => [s.name + ' (' + s.id + ') - ' + (s.billing ? s.billing.plan + ' / ' + s.billing.status : 'no plan')
      + (s.usage ? ' - ' + s.usage.students + ' students, ' + s.usage.staff + ' staff' : ''), button('Manage', () => openSchool(s.id))]), 'No schools.');
    admin.status.textContent = '';
  } catch { admin.status.textContent = 'Could not load schools.'; }
  await Promise.all([loadAdminTickets(), loadFlags(), loadDrills(), loadTemplate()]);
}
async function openSchool(id) {
  chosenSchool = id;
  const s = allSchools.find((x) => x.id === id);
  const ref = doc(db, 'schools', id);
  admin.panel.hidden = false;
  admin.title.textContent = s.name + ' (' + id + ')';
  admin.usage.textContent = s.usage ? 'Counted: ' + s.usage.students + ' students, ' + s.usage.staff + ' staff, on ' + (dayText(s.usage.updatedAt) || '-') : 'No usage counted yet.';
  try {
    const records = await getDocs(collection(ref, 'storageRecords'));
    const kb = records.docs.reduce((sum, d) => sum + (d.data().sizeKb ?? 0), 0);
    admin.usage.textContent += ' Storage recorded: ' + Math.round(kb / 1024 * 10) / 10 + ' MB in ' + records.size + ' file record(s).';
  } catch { /* Storage records could not be read. */ }
  const f = admin.billing.elements;
  const b = s.billing ?? { plan: 'trial', status: 'trial' };
  f.plan.value = b.plan; f.status.value = b.status; f.trialEnds.value = dayText(b.trialEnds); f.renewsOn.value = b.renewsOn ?? '';
  for (const k of ['graceDays', 'studentLimit', 'staffLimit', 'storageMb', 'monthlyPrice']) f[k].value = b[k] ?? '';
  f.legalHold.checked = b.legalHold === true; f.note.value = b.note ?? '';
  try {
    const inv = await getDocs(collection(ref, 'invoices'));
    fillList(admin.invoices, inv.docs.sort((a, c) => c.data().period.localeCompare(a.data().period)).map((d) => [
      d.data().period + ': ' + rupees(d.data().amount) + ', due ' + d.data().dueOn + ', ' + d.data().status,
      ...(d.data().status !== 'paid' ? [button('Mark paid', () => run(admin.status, async () => {
        await setDoc(d.ref, { ...d.data(), status: 'paid', paidOn: today() });
        await loadAdmin(); await openSchool(id);
      }, 'Marked paid.'))] : [])]), 'No invoices.');
    const [dm, dr] = await Promise.all([getDocs(collection(ref, 'domainRequests')), getDocs(collection(ref, 'dataRequests'))]);
    const rows = [];
    for (const d of dm.docs) rows.push(['Domain ' + d.data().domain + ' - ' + d.data().status,
      ...['dns-pending', 'verified', 'rejected'].map((st) => button(st, () => run(admin.status, async () => {
        const next = { ...d.data(), status: st, checkedOn: today() };
        if (st === 'dns-pending') {
          const target = prompt('What should the school set at its domain provider? (for example: CNAME to azizschoolmanagement.plateria.in)', d.data().dnsTarget ?? '');
          if (target === null) return;
          if (target.trim()) next.dnsTarget = target.trim().slice(0, 100);
          next.ssl = 'pending';
        }
        if (st === 'verified') next.ssl = 'active';
        await setDoc(d.ref, next);
        await openSchool(id);
      }, 'Updated.')))]);
    for (const d of dr.docs) rows.push(['Data ' + d.data().kind + ' - ' + d.data().status,
      ...['approved', 'completed', 'held'].map((st) => button(st, () => run(admin.status, async () => { await setDoc(d.ref, { ...d.data(), status: st }); await openSchool(id); }, 'Updated.')))]);
    fillList(admin.requests, rows, 'No requests.');
  } catch { admin.status.textContent = 'Could not load this school.'; }
}
admin.billing.addEventListener('submit', (event) => {
  event.preventDefault();
  const f = admin.billing.elements;
  const data = { plan: f.plan.value, status: f.status.value };
  for (const k of ['graceDays', 'studentLimit', 'staffLimit', 'storageMb', 'monthlyPrice']) if (f[k].value !== '') data[k] = Number(f[k].value);
  if (f.trialEnds.value) data.trialEnds = Timestamp.fromDate(new Date(f.trialEnds.value + 'T23:59:59'));
  if (f.renewsOn.value) data.renewsOn = f.renewsOn.value;
  if (f.legalHold.checked) data.legalHold = true;
  if (f.note.value.trim()) data.note = f.note.value.trim();
  if (['suspended', 'cancelled'].includes(data.status) && !confirm('Make this school read-only for its owner?')) return;
  run(admin.status, async () => { await setDoc(doc(db, 'schools', chosenSchool, 'billing', 'main'), data); await loadAdmin(); await openSchool(chosenSchool); }, 'Plan saved.');
});
admin.invoiceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(admin.invoiceForm);
  run(admin.status, async () => {
    await setDoc(doc(db, 'schools', chosenSchool, 'invoices', newId('INV')), {
      period: String(f.get('period')), amount: Number(f.get('amount')), dueOn: String(f.get('dueOn')), status: 'due',
    });
    admin.invoiceForm.reset();
    await loadAdmin(); await openSchool(chosenSchool);
  }, 'Invoice added.');
});
async function loadAdminTickets() {
  try {
    const found = await getDocs(query(collection(db, 'supportTickets'), where('status', '==', 'open')));
    fillList(admin.tickets, found.docs.map((d) => [d.data().schoolId + ' - ' + d.data().createdOn + ' - ' + d.data().subject + ': ' + d.data().body,
      button('Reply and close', () => {
        const reply = prompt('Your reply:');
        if (!reply || !reply.trim()) return;
        run(admin.status, async () => { await setDoc(d.ref, { ...d.data(), status: 'answered', reply: reply.trim().slice(0, 2000) }); await loadAdminTickets(); }, 'Reply sent.');
      })]), 'No open tickets.');
  } catch { fillList(admin.tickets, [], 'Tickets could not be loaded.'); }
}
async function loadTemplate() {
  try {
    const d = await getDoc(doc(db, 'platformConfig', 'templates'));
    const t = d.exists() ? d.data() : { latest: 1 };
    admin.templateInfo.textContent = 'Newest published version: ' + t.latest + (t.notes ? ' - ' + t.notes : '') + '. Schools upgrade themselves from their own settings and can go back.';
    admin.templateForm.elements.namedItem('latest').value = t.latest;
    admin.templateForm.elements.namedItem('notes').value = t.notes ?? '';
  } catch { admin.templateInfo.textContent = 'Could not load the template version.'; }
}
admin.templateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const latest = Number(admin.templateForm.elements.namedItem('latest').value);
  const notes = admin.templateForm.elements.namedItem('notes').value.trim();
  if (!Number.isInteger(latest) || latest < 1 || latest > 20) { admin.status.textContent = 'Version must be a whole number from 1 to 20.'; return; }
  run(admin.status, async () => { await setDoc(doc(db, 'platformConfig', 'templates'), { latest, ...(notes ? { notes } : {}) }); await loadTemplate(); }, 'Template version published.');
});
async function loadFlags() {
  let flags = {};
  try { const d = await getDoc(doc(db, 'platformConfig', 'flags')); flags = d.exists() ? d.data() : {}; } catch { /* none yet */ }
  admin.flagBoxes.replaceChildren();
  for (const [key, label] of FLAGS) {
    const box = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = key; input.checked = flags[key] !== false;
    const percent = document.createElement('input');
    percent.type = 'number'; percent.name = 'pct_' + key; percent.min = '0'; percent.max = '100'; percent.step = '1'; percent.placeholder = '100';
    percent.style.width = '4.5em'; percent.value = Number.isInteger(flags['pct_' + key]) ? String(flags['pct_' + key]) : '';
    box.append(input, ' ' + label + ' - on for ', percent, '% of schools   ');
    admin.flagBoxes.append(box);
  }
}
admin.flagsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const flags = Object.fromEntries(FLAGS.map(([key]) => [key, admin.flagsForm.elements.namedItem(key).checked]));
  for (const [key] of FLAGS) {
    const raw = admin.flagsForm.elements.namedItem('pct_' + key).value.trim();
    if (raw !== '' && /^[0-9]{1,3}$/.test(raw) && Number(raw) < 100) flags['pct_' + key] = Number(raw);
  }
  run(admin.status, () => setDoc(doc(db, 'platformConfig', 'flags'), flags), 'Switches saved.');
});
async function loadDrills() {
  try {
    const found = await getDocs(collection(db, 'platformDrills'));
    fillList(admin.drills, found.docs.map((d) => d.data()).sort((a, b) => b.date.localeCompare(a.date)).map((x) =>
      [x.date + ' - ' + x.what + ': ' + x.result + (x.minutes != null ? ' (' + x.minutes + ' min)' : '')]), 'No drills logged yet.');
  } catch { fillList(admin.drills, [], 'Drills could not be loaded.'); }
}
admin.drillForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(admin.drillForm);
  const data = { date: String(f.get('date')), what: String(f.get('what')).trim(), result: String(f.get('result')).trim() };
  if (f.get('minutes') !== '') data.minutes = Number(f.get('minutes'));
  run(admin.status, async () => { await setDoc(doc(db, 'platformDrills', newId('DL')), data); admin.drillForm.reset(); await loadDrills(); }, 'Drill logged.');
});

// ---------- Who is signed in ----------
let seen = 0;
onAuthStateChanged(auth, async (user) => {
  const mine = ++seen;
  me = user;
  myRole = '';
  plan.section.hidden = true; admin.section.hidden = true; accept.section.hidden = true; admin.panel.hidden = true;
  if (!user) return;
  loadMyInvites(user);
  try {
    const member = await getDoc(doc(schoolRef, 'members', user.uid));
    if (mine !== seen) return;
    if (member.exists() && member.data().active === true && ['owner', 'principal'].includes(member.data().role)) {
      myRole = member.data().role;
      plan.section.hidden = false;
      for (const el of document.querySelectorAll('#plan-section .owner-only')) el.hidden = myRole !== 'owner';
      await loadPlan();
    }
  } catch { /* not a member of this school */ }
  try {
    const platform = await getDoc(doc(db, 'platformAdmins', user.uid));
    if (mine === seen && platform.exists()) await loadAdmin();
  } catch { /* not a platform administrator */ }
});
