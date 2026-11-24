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
  locationForm: $('#location-form'), locationStatus: $('#location-status'), locationMap: $('#location-map'),
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
    const out = await action();
    statusEl.textContent = out?.message ?? done;
  } catch (error) {
    statusEl.textContent = error?.userMessage ? error.userMessage : error?.code === 'permission-denied'
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
    // Someone who already belongs to this school (a teacher, parent or student the owner set up) has no invitation to
    // accept, so show nothing. Only a person with no place here is told how to see invitations.
    try {
      const member = await getDoc(doc(db, 'schools', SCHOOL_ID, 'members', user.uid));
      if (member.exists() && member.data().active === true) return;
    } catch { /* not a member */ }
    accept.section.hidden = false;
    accept.status.textContent = 'Your email address is not verified yet, so invitations cannot be shown. No email has been sent unless you ask for one below.';
    accept.list.replaceChildren();
    fillList(accept.list, [['Get a verification link by email.',
      button('Send verification email', () => run(accept.status, async () => {
        await sendEmailVerification(user);
      }, 'Verification email sent to ' + user.email + '. Open it, then refresh this page.'))]], '');
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
  document.dispatchEvent(new Event('plan-loaded'));
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
  // Storage counts the hand-kept records and the files uploaded to the staff document vault.
  let storageKb = 0;
  for (const name of ['storageRecords', 'staffDocuments', 'eBooks']) {
    try { storageKb += (await getDocs(collection(schoolRef, name))).docs.reduce((total, d) => total + (d.data().sizeKb ?? 0), 0); } catch { /* Not readable: counts as nothing. */ }
  }
  const storageMb = Math.ceil(storageKb / 1024);
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
    // Members hold only a role; the email lives on the invitation they accepted, so the list can name people instead of showing an ID.
    let emails = new Map();
    try { emails = new Map((await getDocs(query(collection(db, 'invites'), where('schoolId', '==', SCHOOL_ID)))).docs.map((i) => [i.id, i.data().email])); } catch { emails = new Map(); }
    const personName = (d) => (d.id === me.uid ? (me.email || 'You') + ' (you)' : emails.get(d.data().inviteId) || 'Member ' + d.id.slice(0, 6) + '…');
    const roleName = (role) => (role === 'staff' ? 'non-teaching staff' : role === 'accountant' ? 'fee office' : role === 'office' ? 'admission staff' : role);
    let consents = new Map();
    try { consents = new Map((await getDocs(collection(schoolRef, 'consents'))).docs.map((c) => [c.id, c.data()])); } catch { consents = new Map(); }
    const consentText = (uid) => (consents.has(uid)
      ? ' - privacy policy ' + consents.get(uid).policyVersion + (dayText(consents.get(uid).acceptedAt) ? ' accepted ' + dayText(consents.get(uid).acceptedAt) : ' accepted')
      : ' - has not accepted the privacy policy');
    fillList(plan.members, found.docs.map((d) => [personName(d) + ' (' + roleName(d.data().role) + ') - ' + (d.data().active ? 'active' : 'switched off') + consentText(d.id),
      ...(myRole === 'owner' && d.id !== me.uid ? [button(d.data().active ? 'Switch off' : 'Switch on', () => run(plan.status, async () => {
        await updateDoc(d.ref, { active: !d.data().active });
        await loadMembers();
      }, 'Updated.'))] : [])]), 'No members.');
  } catch { fillList(plan.members, [], 'Members could not be loaded.'); }
}
// Domain check, run from the platform administrator's browser: the DNS records through Google's public DNS lookup, and whether
// https:// answers (it only does when the secure certificate is working for that address).
async function checkDomain(domain) {
  const result = { dns: [], https: false };
  for (const type of ['CNAME', 'A']) {
    try {
      const answer = await (await fetch('https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=' + type)).json();
      for (const record of answer.Answer ?? []) if (record.type === (type === 'A' ? 1 : 5)) result.dns.push(type + ' ' + String(record.data).replace(/\.$/, ''));
    } catch { /* This lookup failed; the other one may still work. */ }
  }
  try { await fetch('https://' + domain + '/robots.txt', { mode: 'no-cors', cache: 'no-store' }); result.https = true; } catch { /* No secure page yet. */ }
  return result;
}
async function loadDomains() {
  try {
    const found = await getDocs(collection(schoolRef, 'domainRequests'));
    fillList(plan.domains, found.docs.map((d) => [d.data().domain + ' - ' + d.data().status + (d.data().note ? ' (' + d.data().note + ')' : '')
      + (d.data().dnsTarget ? '. Set this at your domain provider: ' + d.data().dnsTarget : '')
      + (d.data().ssl ? '. Secure certificate: ' + d.data().ssl : '') + (d.data().checkedOn ? '. Last checked ' + d.data().checkedOn : '')
      + (d.data().status === 'verified' ? '. Your school page now opens at https://' + d.data().domain : '')]), 'No domain requests.');
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
  document.dispatchEvent(new Event('platform-admin-open'));
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
    const countStatus = (status) => allSchools.filter((s) => s.billing?.status === status).length;
    const activeN = countStatus('active'); const trialN = countStatus('trial');
    const lostN = countStatus('cancelled') + countStatus('suspended');
    const soon = allSchools.filter((s) => s.billing?.status === 'trial' && daysLeft(s.billing.trialEnds) !== null && daysLeft(s.billing.trialEnds) >= 0 && daysLeft(s.billing.trialEnds) <= 14).length;
    const overdue = allSchools.filter((s) => s.billing?.status === 'active' && s.billing.renewsOn && Date.parse(s.billing.renewsOn) < Date.now() - 86400000).length;
    const analytics = [
      ['Annual run rate: ' + rupees(mrr * 12) + '. Average per paying school: ' + (activeN ? rupees(Math.round(mrr / activeN)) : '-') + ' a month.'],
      ['Schools: ' + activeN + ' active, ' + trialN + ' on trial, ' + lostN + ' cancelled or suspended.'],
      ['Trial to paid so far: ' + (activeN + lostN ? Math.round(activeN / (activeN + lostN) * 100) + '% of schools that left trial are still paying.' : 'no school has left trial yet.')],
      ['Churn: ' + (activeN + lostN ? Math.round(lostN / (activeN + lostN) * 100) + '% of paying-or-lost schools are cancelled or suspended.' : 'nothing yet.')],
      ['Trials ending within 14 days: ' + soon + '. Renewals overdue: ' + overdue + '. Unpaid invoices: ' + rupees(due) + '.'],
    ];
    drawRevenueChart($('#platform-revenue-chart'), byMonth, { active: activeN, trial: trialN, lost: lostN });
    fillList($('#platform-revenue-breakdown'), [
      ...analytics,
      ...[...byPlan.entries()].sort().map(([key, r]) => ['Plan ' + key + ': ' + r.n + ' school(s), monthly ' + rupees(r.mrr)]),
      ...[...byMonth.entries()].sort().reverse().slice(0, 12).map(([period, r]) => [period + ': paid ' + rupees(r.paid) + ', unpaid ' + rupees(r.unpaid) + ' ' + bar(r.paid) + (r.unpaid ? ' (' + bar(r.unpaid).replaceAll('#', '.') + ')' : '')]),
    ], 'No billing yet.');
    fillList(admin.schools, allSchools.map((s) => [s.name + ' (' + s.id + ') - ' + (s.billing ? s.billing.plan + ' / ' + s.billing.status : 'no plan')
      + (s.usage ? ' - ' + s.usage.students + ' students, ' + s.usage.staff + ' staff' : ''), button('Manage', () => openSchool(s.id)), button('Open school (view only)', () => window.open(location.pathname + '?school=' + encodeURIComponent(s.id), '_blank', 'noopener'))]), 'No schools.');
    admin.status.textContent = '';
  } catch { admin.status.textContent = 'Could not load schools.'; }
  await Promise.all([loadAdminTickets(), loadFlags(), loadDrills(), loadTemplate(), loadStorageRequests()]);
}
// Revenue chart: one stacked bar per month (collected in navy, unpaid in gold) drawn as SVG, with a status line under it.
// The text list below the chart carries the same numbers for screen readers.
function drawRevenueChart(target, byMonth, counts) {
  target.replaceChildren();
  const SVG = 'http://www.w3.org/2000/svg';
  const make = (name, attrs, text) => {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const months = [...byMonth.entries()].sort().slice(-12);
  if (!months.length) { target.textContent = 'No invoices yet, so there is nothing to chart.'; return; }
  const width = 640; const height = 260; const left = 56; const bottom = 30; const top = 16;
  const peak = Math.max(1, ...months.map(([, r]) => r.paid + r.unpaid));
  const plotH = height - top - bottom; const slot = (width - left - 10) / months.length;
  const svg = make('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', width: '100%',
    'aria-label': 'Invoices by month, collected and unpaid, for the last ' + months.length + ' month(s).' });
  for (const fraction of [0, 0.5, 1]) {
    const y = top + plotH * (1 - fraction);
    svg.append(make('line', { x1: left, x2: width - 10, y1: y, y2: y, stroke: '#d9d2bd', 'stroke-width': 1 }));
    svg.append(make('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#14243d' }, rupees(Math.round(peak * fraction))));
  }
  months.forEach(([period, r], index) => {
    const x = left + index * slot + slot * 0.15; const barW = slot * 0.7;
    const paidH = plotH * r.paid / peak; const unpaidH = plotH * r.unpaid / peak;
    const group = make('g', {});
    group.append(make('title', {}, period + ': collected ' + rupees(r.paid) + ', unpaid ' + rupees(r.unpaid)));
    group.append(make('rect', { x, y: top + plotH - paidH, width: barW, height: paidH, fill: '#14243d' }));
    group.append(make('rect', { x, y: top + plotH - paidH - unpaidH, width: barW, height: unpaidH, fill: '#b8902f' }));
    group.append(make('text', { x: x + barW / 2, y: height - 10, 'text-anchor': 'middle', 'font-size': 10, fill: '#14243d' }, period.slice(2)));
    svg.append(group);
  });
  const legend = document.createElement('p');
  legend.textContent = 'Navy: collected. Gold: unpaid. Schools: ' + counts.active + ' active, ' + counts.trial + ' on trial, ' + counts.lost + ' cancelled or suspended.';
  target.append(svg, legend);
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
  f.legalHold.checked = b.legalHold === true; f.autoBilling.checked = b.autoBilling === true; f.note.value = b.note ?? '';
  await loadLocation(ref);
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
      button('Check domain', () => run(admin.status, async () => {
        const result = await checkDomain(d.data().domain);
        await setDoc(d.ref, { ...d.data(), checkedOn: today(), ssl: result.https ? 'active' : 'pending' });
        await openSchool(id);
        return { message: d.data().domain + ' - DNS: ' + (result.dns.length ? result.dns.join(', ') : 'no record found yet')
          + '. Secure page (HTTPS): ' + (result.https ? 'works, the padlock is ready.' : 'not working yet.')
          + (result.https && result.dns.length ? ' You can mark it verified.' : '') };
      }, 'Checked.')),
      ...['dns-pending', 'verified', 'rejected'].map((st) => button(st, () => run(admin.status, async () => {
        const next = { ...d.data(), status: st, checkedOn: today() };
        if (st === 'dns-pending') {
          const target = prompt('What should the school set at its domain provider? (for example: CNAME to azizschoolmanagement.plateria.in)', d.data().dnsTarget ?? '');
          if (target === null) return;
          if (target.trim()) next.dnsTarget = target.trim().slice(0, 100);
          next.ssl = 'pending';
        }
        if (st === 'verified') next.ssl = 'active';
        // A verified domain is also written to domainMap, so the public school page can find the school from the address.
        // Any other status removes the link, unless the address belongs to another school.
        const mapRef = doc(db, 'domainMap', d.data().domain);
        const linked = await getDoc(mapRef);
        if (linked.exists() && linked.data().schoolId !== id) throw Object.assign(new Error('Address in use'), { userMessage: 'This address is already linked to another school.' });
        const batch = writeBatch(db);
        batch.set(d.ref, next);
        if (st === 'verified') batch.set(mapRef, { schoolId: id, verifiedOn: today() });
        else if (linked.exists()) batch.delete(mapRef);
        await batch.commit();
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
  if (f.autoBilling.checked) data.autoBilling = true;
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
// School location (feature 130). The platform administrator sets where the school is, the distance a teacher must be inside to check in
// (30 metres or more), the worst GPS accuracy accepted and the time zone. Teachers' check-ins are checked against this by the database rules.
function showLocationMap(lat, lng) {
  const frame = admin.locationMap;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { frame.hidden = true; return; }
  const d = 0.003;
  frame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + [lng - d, lat - d, lng + d, lat + d].join('%2C')
    + '&layer=mapnik&marker=' + lat + '%2C' + lng;
  frame.hidden = false;
}
// Reads "26.7271, 88.3953", "26.7271 88.3953" or a map link with @lat,lng, ?q=lat,lng or !3dLAT!4dLNG in it.
function parseCoordinates(text) {
  const clean = String(text ?? '').trim();
  const patterns = [/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/, /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d{1,2}(?:\.\d+)?)(?:,|%2C)(-?\d{1,3}(?:\.\d+)?)/, /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) {
      const lat = Number(match[1]); const lng = Number(match[2]);
      if (Math.abs(lat) <= 66 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}
async function loadLocation(ref) {
  const f = admin.locationForm.elements;
  admin.locationForm.reset();
  admin.locationMap.hidden = true;
  admin.locationStatus.textContent = 'Loading the saved location.';
  try {
    const found = await getDoc(doc(ref, 'settings', 'location'));
    if (found.exists()) {
      const l = found.data();
      f.lat.value = l.lat; f.lng.value = l.lng; f.radiusM.value = l.radiusM; f.maxAccuracyM.value = l.maxAccuracyM; f.tzMinutes.value = String(l.tzMinutes);
      f.qrRequired.checked = l.qrRequired === true; f.selfieRequired.checked = l.selfieRequired === true;
      showLocationMap(l.lat, l.lng);
      admin.locationStatus.textContent = 'Saved: teachers must be within ' + l.radiusM + ' m of this point, with GPS accurate to ' + l.maxAccuracyM + ' m or better.'
        + (l.qrRequired ? ' They must scan the school QR code.' : '') + (l.selfieRequired ? ' They must take a live selfie.' : '');
    } else {
      admin.locationStatus.textContent = 'No location saved yet. Teachers cannot check in until you save one.';
    }
  } catch { admin.locationStatus.textContent = 'Could not load the saved location.'; }
}
$('#location-read').addEventListener('click', () => {
  const f = admin.locationForm.elements;
  const found = parseCoordinates(f.paste.value);
  if (!found) { admin.locationStatus.textContent = 'Could not find two coordinates in that. Try two numbers like 26.7271, 88.3953, or a Google Maps link that contains them.'; return; }
  f.lat.value = found.lat; f.lng.value = found.lng;
  showLocationMap(found.lat, found.lng);
  admin.locationStatus.textContent = 'Coordinates read. Check the map, then press Save school location.';
});
$('#location-here').addEventListener('click', () => {
  const f = admin.locationForm.elements;
  if (!navigator.geolocation) { admin.locationStatus.textContent = 'This browser cannot give its location. Paste coordinates instead.'; return; }
  admin.locationStatus.textContent = 'Asking for your location. Allow it when the browser asks.';
  navigator.geolocation.getCurrentPosition((pos) => {
    f.lat.value = Math.round(pos.coords.latitude * 1e6) / 1e6; f.lng.value = Math.round(pos.coords.longitude * 1e6) / 1e6;
    showLocationMap(pos.coords.latitude, pos.coords.longitude);
    admin.locationStatus.textContent = 'Got your position (accurate to about ' + Math.round(pos.coords.accuracy) + ' m). Stand at the school for best results, then press Save school location.';
  }, () => { admin.locationStatus.textContent = 'Could not get your location. Allow location for this site, or paste coordinates.'; },
  { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
});
for (const name of ['lat', 'lng']) admin.locationForm.elements.namedItem(name).addEventListener('change', () => {
  const f = admin.locationForm.elements;
  showLocationMap(Number(f.lat.value), Number(f.lng.value));
});
admin.locationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!chosenSchool) return;
  const f = admin.locationForm.elements;
  const lat = Number(f.lat.value); const lng = Number(f.lng.value);
  const radiusM = Number(f.radiusM.value); const maxAccuracyM = Number(f.maxAccuracyM.value); const tzMinutes = Number(f.tzMinutes.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || f.lat.value === '' || f.lng.value === '') { admin.locationStatus.textContent = 'Enter the latitude and longitude.'; return; }
  if (Math.abs(lat) > 66 || Math.abs(lng) > 180) { admin.locationStatus.textContent = 'Those coordinates are outside the supported range.'; return; }
  if (!(radiusM >= 30 && radiusM <= 500)) { admin.locationStatus.textContent = 'The check-in distance must be from 30 to 500 metres.'; return; }
  if (!(maxAccuracyM >= 10 && maxAccuracyM <= 100)) { admin.locationStatus.textContent = 'The accepted GPS accuracy must be from 10 to 100 metres.'; return; }
  const id = chosenSchool;
  run(admin.locationStatus, async () => {
    await setDoc(doc(db, 'schools', id, 'settings', 'location'), { lat, lng, radiusM, maxAccuracyM, tzMinutes,
      qrRequired: f.qrRequired.checked, selfieRequired: f.selfieRequired.checked, setBy: me.uid, setOn: serverTimestamp() });
    showLocationMap(lat, lng);
  }, 'School location saved. Teachers can now check in within ' + radiusM + ' m.'
    + (f.qrRequired.checked ? ' The school QR code is required.' : '') + (f.selfieRequired.checked ? ' A live selfie is required.' : ''));
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
  // The super administrator signing in without ?school= sees only the Super Admin Panel, so no school screens are loaded here.
  if (!new URLSearchParams(location.search).has('school')) {
    try {
      const platform = await getDoc(doc(db, 'platformAdmins', user.uid));
      if (mine !== seen) return;
      if (platform.exists()) { if (new URLSearchParams(location.search).has('legacy')) await loadAdmin(); return; }
    } catch { /* not a platform administrator */ }
  }
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
});


// ---------- Batch 68: system health (feature 092) ----------
// The server checks the database, file storage and the nightly backups every 6 hours and writes the result to platformJobs/health.
async function callHealth(name) {
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
  return (await httpsCallable(getFunctions(app, 'asia-south1'), name)()).data;
}
function showHealth(data) {
  const list = document.querySelector('#health-list');
  const status = document.querySelector('#health-status');
  const rows = [];
  const ms = (value) => (value < 0 ? 'FAILED' : value + ' ms');
  const at = typeof data.at === 'string' ? data.at : data.at?.toDate?.().toISOString();
  rows.push('Last check: ' + (at ? new Date(at).toLocaleString() : 'unknown'));
  rows.push('Database: ' + ms(data.firestoreMs) + '. File storage: ' + ms(data.storageMs) + '. Schools: ' + (data.schools ?? '-') + '.');
  rows.push('Backups: ' + (data.backupFailed?.length ? data.backupFailed.length + ' failed' : 'none failed') + ', ' + (data.backupStale?.length ? data.backupStale.length + ' out of date' : 'none out of date') + '.');
  for (const problem of data.problems ?? []) rows.push('PROBLEM: ' + problem);
  const history = data.history ?? [];
  const good = history.filter((item) => item.ok).length;
  if (history.length) rows.push('Last ' + history.length + ' checks: ' + good + ' fully healthy (' + Math.round((good / history.length) * 100) + '%).');
  fillList(list, rows.map((text) => [text]), '');
  status.textContent = (data.problems ?? []).length ? 'Needs attention: ' + data.problems.length + ' problem(s).' : 'Everything looks healthy.';
}
async function loadHealth() {
  const status = document.querySelector('#health-status');
  try {
    const found = await getDoc(doc(db, 'platformJobs', 'health'));
    if (found.exists()) showHealth(found.data());
    else status.textContent = 'No health check has run yet. Press Check now.';
    const jobs = await getDocs(collection(db, 'platformJobs'));
    const rows = jobs.docs.filter((item) => /^(backup|reminders|billing)-/.test(item.id)).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 10).map((item) => {
      const d = item.data();
      const kind = item.id.split('-')[0];
      const label = kind === 'backup' ? 'Backup ' + item.id.slice(7) : kind === 'billing' ? 'Billing ' + item.id.slice(8) : 'Fee reminders ' + item.id.slice(10);
      return label + ': ' + (kind === 'backup' ? d.done + ' of ' + d.schools + ' schools saved' : kind === 'billing' ? d.invoices + ' invoices, ' + d.overdue + ' overdue, ' + d.renewed + ' renewed, ' + d.suspended + ' suspended' : d.sent + ' reminders sent') + (d.failed?.length ? ', ' + d.failed.length + ' failed' : '');
    });
    fillList(document.querySelector('#health-jobs'), rows.map((text) => [text]), 'No server jobs have reported yet.');
  } catch {
    status.textContent = 'Could not load the health report.';
  }
}
document.querySelector('#health-run').addEventListener('click', async () => {
  const status = document.querySelector('#health-status');
  status.textContent = 'Checking.';
  try { showHealth(await callHealth('runHealthNow')); } catch { status.textContent = 'Could not run the check. Check the functions are deployed.'; }
});
document.addEventListener('platform-admin-open', loadHealth);


// ---------- Batch 70: extra storage requests (features 127, 157) ----------
const askStatus = document.querySelector('#storage-ask-status');
const askList = document.querySelector('#storage-ask-list');
const askMb = (mb) => (mb >= 1000 ? mb / 1000 + ' GB' : mb + ' MB');
async function loadMyStorageRequests() {
  try {
    const found = await getDocs(query(collection(db, 'storageRequests'), where('schoolId', '==', SCHOOL_ID)));
    const rows = found.docs.map((d) => d.data()).sort((a, b) => b.createdOn.localeCompare(a.createdOn));
    fillList(askList, rows.map((r) => [r.createdOn + ' - ' + askMb(r.mb) + ' - ' + r.status.toUpperCase() + (r.reply ? ' - ' + r.reply : '')]), 'No storage requests yet.');
  } catch { fillList(askList, [], 'Storage requests could not be loaded.'); }
}
document.querySelector('#storage-ask-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const note = String(new FormData(form).get('note') ?? '').trim().slice(0, 300);
  try {
    await setDoc(doc(db, 'storageRequests', newId('SR')), { schoolId: SCHOOL_ID, mb: Number(new FormData(form).get('mb')), ...(note ? { note } : {}),
      status: 'pending', createdBy: auth.currentUser.uid, createdOn: today() });
    form.reset();
    askStatus.textContent = 'Request sent. AZIZ support will answer it here.';
    await loadMyStorageRequests();
  } catch { askStatus.textContent = 'Could not send the request. Try again.'; }
});
document.addEventListener('plan-loaded', loadMyStorageRequests);

async function loadStorageRequests() {
  const list = document.querySelector('#storagereq-list');
  try {
    const found = await getDocs(query(collection(db, 'storageRequests'), where('status', '==', 'pending')));
    fillList(list, found.docs.map((d) => {
      const r = d.data();
      const decide = (status) => run(admin.status, async () => {
        const reply = status === 'rejected' ? (prompt('Reason (optional):') ?? '') : '';
        const price = status === 'approved' ? Math.max(0, Math.round(Number(prompt('Price to charge for ' + askMb(r.mb) + ' in Rs (leave empty or 0 for free):') || 0)) || 0) : 0;
        const batch = writeBatch(db);
        batch.update(d.ref, { status, decidedOn: today(), ...(reply.trim() ? { reply: reply.trim().slice(0, 300) } : {}) });
        if (status === 'approved') {
          const billing = await getDoc(doc(db, 'schools', r.schoolId, 'billing', 'main'));
          if (!billing.exists()) throw new Error('This school has no plan record yet.');
          batch.update(billing.ref, { storageMb: (billing.data().storageMb ?? 0) + r.mb });
          // A priced add-on becomes an invoice for the school, due in 7 days.
          if (price > 0) {
            batch.set(doc(db, 'schools', r.schoolId, 'invoices', 'INV-' + d.id), { period: today().slice(0, 7), amount: Math.min(price, 100000000),
              dueOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), status: 'due', note: ('Extra storage ' + askMb(r.mb)).slice(0, 200) });
          }
        }
        await batch.commit();
        await loadStorageRequests();
      }, status === 'approved' ? 'Approved. The storage limit was raised.' : 'Rejected.');
      return [r.schoolId + ' - ' + r.createdOn + ' - ' + askMb(r.mb) + (r.note ? ' - ' + r.note : ''), button('Approve', () => decide('approved')), button('Reject', () => decide('rejected'))];
    }), 'No storage requests waiting.');
  } catch { fillList(list, [], 'Storage requests could not be loaded.'); }
}


// ---------- Batch 71: automatic billing (feature 071) ----------
document.querySelector('#billing-run')?.addEventListener('click', async () => {
  admin.status.textContent = 'Running the billing check.';
  try {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    const r = (await httpsCallable(getFunctions(app, 'asia-south1'), 'runBillingNow')()).data;
    admin.status.textContent = 'Billing check done: ' + r.invoices + ' invoice(s) created, ' + r.overdue + ' marked overdue, ' + r.renewed + ' renewed, ' + r.suspended + ' suspended.';
    if (chosenSchool) await openSchool(chosenSchool);
  } catch { admin.status.textContent = 'Could not run the billing check. Check the functions are deployed.'; }
});


// ---------- Batch 72: theme marketplace (068) and billing reconciliation (071, 157) ----------
const marketList = document.querySelector('#market-list');
async function loadMarket() {
  try {
    const found = await getDoc(doc(db, 'platformConfig', 'marketplace'));
    const items = found.exists() ? found.data().items ?? [] : [];
    fillList(marketList, items.map((item) => [item.label + ' (' + item.navy + ', ' + item.ivory + ', ' + item.gold + ')',
      button('Remove', () => run(admin.status, async () => { await setDoc(doc(db, 'platformConfig', 'marketplace'), { items: items.filter((entry) => entry.key !== item.key) }); await loadMarket(); }, 'Theme removed.'))]),
      'No marketplace themes published yet.');
  } catch { fillList(marketList, [], 'Marketplace themes could not be loaded.'); }
}
document.addEventListener('platform-admin-open', loadMarket);
document.querySelector('#market-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const label = String(form.get('label') ?? '').trim().slice(0, 40);
  const hex = /^#[0-9a-fA-F]{6}$/;
  const colors = ['navy', 'ivory', 'gold'].map((name) => String(form.get(name)));
  if (!label || !colors.every((color) => hex.test(color))) { admin.status.textContent = 'Give the theme a name and three colours.'; return; }
  run(admin.status, async () => {
    const found = await getDoc(doc(db, 'platformConfig', 'marketplace'));
    const items = found.exists() ? found.data().items ?? [] : [];
    if (items.length >= 12) throw new Error('Remove a theme first. Twelve is the limit.');
    const key = 'mk-' + Math.random().toString(36).slice(2, 8);
    await setDoc(doc(db, 'platformConfig', 'marketplace'), { items: [...items, { key, label, navy: colors[0], ivory: colors[1], gold: colors[2] }] });
    event.currentTarget.reset();
    await loadMarket();
  }, 'Theme published. School owners see it in their theme gallery.');
});

// Reconciliation: every school's invoices, then a total for each school.
document.querySelector('#reconcile-csv').addEventListener('click', () => {
  const cell = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const lines = [['Row', 'School id', 'School', 'Period', 'Amount (Rs)', 'Due on', 'Status', 'Paid on', 'Note']];
  const totals = [];
  for (const s of allSchools) {
    let billed = 0, paid = 0;
    for (const i of [...s.invoices].sort((a, b) => a.period.localeCompare(b.period))) {
      lines.push(['Invoice', s.id, s.name, i.period, i.amount, i.dueOn, i.status, i.paidOn ?? '', i.note ?? '']);
      billed += i.amount;
      if (i.status === 'paid') paid += i.amount;
    }
    totals.push(['Total', s.id, s.name, '', '', '', 'billed ' + billed + ' / paid ' + paid + ' / unpaid ' + (billed - paid), '', '']);
  }
  const text = '\ufeff' + [...lines, ...totals].map((line) => line.map(cell).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  link.download = 'billing-reconciliation-' + today() + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
