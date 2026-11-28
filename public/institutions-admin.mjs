// Super Admin: tuition teachers and coaching centres (Phase 4). Opened from the existing Super Admin panel. Everything goes through server functions that
// check the platform administrator and write platformAudit; this file only draws screens. Server text is always shown as plain text.
import { app } from './firebase-client.mjs';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const call = async (name, data) => (await httpsCallable(getFunctions(app, 'asia-south1'), name)(data || {})).data;
const failText = (e) => (e && e.message && !/^internal$/i.test(e.message) ? e.message.replace(/^.*?: /, '') : 'Something went wrong. Check the internet and that the server functions are deployed.');
const num = (n) => (Number(n) || 0).toLocaleString('en-IN');
const mb = (b) => (Number(b || 0) / 1048576).toFixed(Number(b || 0) < 10485760 ? 2 : 1) + ' MB';
const dmy = (ms) => (ms ? new Date(ms + 330 * 60000).toISOString().slice(0, 10).split('-').reverse().join('-') : '-');
const dt = (ms) => (ms ? dmy(ms) + ' ' + new Date(ms + 330 * 60000).toISOString().slice(11, 16) : '-');
const TYPE_LABEL = { tuition: 'Tuition teacher', coaching: 'Coaching centre' };
const ACT_LABEL = { active: 'Active (30 days)', inactive: 'Inactive 30+ days', never: 'Not seen yet' };

export async function viewInstitutions({ h, show, toast, sub }) {
  const table = (head, rows, empty) => (rows.length ? h('div', { class: 'card', style: 'overflow:auto' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : h('div', { class: 'empty' }, empty));
  const stat = (label, value) => h('div', { class: 'card' }, h('div', { class: 'muted' }, label), h('div', { style: 'font-size:1.5rem;font-weight:700' }, value));
  const tabs = (cur) => h('div', { class: 'row', style: 'gap:.5rem;flex-wrap:wrap;margin:.6rem 0' }, [['', 'Overview'], ['tuition', 'Tuition teachers'], ['coaching', 'Coaching centres'], ['plan', 'Free plan'], ['cost', 'Database cost estimate']].map(([k, l]) =>
    h('a', { class: 'btn' + (cur === k ? ' gold' : ''), href: '#/institutions' + (k ? '/' + k : '') }, l)));
  const lead = h('h1', {}, 'Tuition teachers and coaching centres');
  const fail = (e) => show(lead, h('div', { class: 'empty' }, failText(e)));
  const fields = (rowsDef) => rowsDef.map(([l, v]) => h('div', {}, h('span', { class: 'muted' }, l + ': '), String(v)));
  const reasonBox = (label = 'Reason (saved in the audit log)') => h('input', { type: 'text', maxlength: 300, placeholder: label, 'aria-label': label, style: 'min-width:18rem' });

  // ---------- Overview ----------
  async function overview(data) {
    const t = data.totals; const col = (k) => h('div', { class: 'card' }, h('h3', {}, TYPE_LABEL[k] + 's'),
      ...fields([['Accounts', t[k].accounts], ['Active accounts', t[k].active], ['Suspended', t[k].suspended], ['Seen in the last 30 days', t[k].activeNow], ['Not seen for 30+ days', t[k].inactive], ['Not seen yet', t[k].never], ['Students (active)', num(t[k].students)],
        ...(k === 'coaching' ? [['Extra teachers', num(t[k].teachers)]] : []), ['Batches', num(t[k].batches)], ['Storage used', mb(t[k].storageBytes)], ['Interested in paid plans', t[k].interested], ['Converted to paid', t[k].converted]]));
    show(lead, tabs(''), h('div', { class: 'grid2', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem' }, col('tuition'), col('coaching')),
      h('p', { class: 'muted' }, 'Free accounts are kept apart from school subscriptions, so they are never counted in school revenue or billing totals. "Seen" means the owner opened the dashboard.'), ...(data.truncated ? [h('p', { class: 'err' }, 'Only the first 2000 accounts are counted.')] : []));
  }

  // ---------- Directory ----------
  async function directory(type, data) {
    const st = { q: '', status: '', activity: '' };
    const out = h('div', {});
    const draw = () => {
      const rows = data.items.filter((r) => r.type === type && (!st.status || r.status === st.status) && (!st.activity || r.activity === st.activity)
        && (!st.q || (r.name + ' ' + r.ownerEmail + ' ' + r.city + ' ' + r.tenantId).toLowerCase().includes(st.q.toLowerCase()))).sort((a, b) => b.createdMs - a.createdMs);
      out.replaceChildren(table(['Name', 'Owner email', 'Status', 'Activity', 'Students', 'Created', ''], rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.ownerEmail), h('td', {}, r.status === 'active' ? 'Active' : 'Suspended'), h('td', {}, ACT_LABEL[r.activity]),
        h('td', {}, (r.usage.activeStudents || 0) + ' / ' + (r.limits.activeStudents ?? 0)), h('td', {}, dmy(r.createdMs)), h('td', {}, h('a', { class: 'btn', href: '#/institutions/' + r.tenantId }, 'Open')))), 'No accounts match.'), h('p', { class: 'muted' }, rows.length + ' shown.'));
    };
    const q = h('input', { type: 'search', placeholder: 'Search name, email or place', 'aria-label': 'Search', oninput: (e) => { st.q = e.target.value; draw(); } });
    const pick = (key, opts) => h('select', { 'aria-label': key, onchange: (e) => { st[key] = e.target.value; draw(); } }, opts.map(([v, l]) => h('option', { value: v }, l)));
    show(lead, tabs(type), h('div', { class: 'row', style: 'gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem' }, q, pick('status', [['', 'Any status'], ['active', 'Active'], ['suspended', 'Suspended']]), pick('activity', [['', 'Any activity'], ['active', ACT_LABEL.active], ['inactive', ACT_LABEL.inactive], ['never', ACT_LABEL.never]])), out);
    draw();
  }

  // ---------- Free plan ----------
  async function plan() {
    const p = await call('adminInstitutionPlanGet'); const blocks = [];
    for (const type of ['tuition', 'coaching']) {
      const d = p[type]; const f = h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); msg.textContent = 'Saving.';
        const features = {}; d.featureKeys.forEach((k) => { features[k] = fd.get('f-' + k) === 'on'; });
        try { const r = await call('adminInstitutionPlanSave', { type, reason: fd.get('reason'), applyToExisting: fd.get('apply') === 'on', features, limits: { activeStudents: fd.get('activeStudents'), extraTeachers: fd.get('extraTeachers'), batches: fd.get('batches'), storageMB: fd.get('storageMB') } });
          msg.textContent = 'Saved as version ' + r.version + (r.applied ? '. Applied to ' + r.applied + ' existing accounts.' : '.'); } catch (er) { msg.textContent = failText(er); } } },
        h('h3', {}, TYPE_LABEL[type] + ' free plan · version ' + d.version),
        h('div', { class: 'row', style: 'gap:.6rem;flex-wrap:wrap' }, [['activeStudents', 'Active students', d.limits.activeStudents], ['extraTeachers', 'Extra teachers', d.limits.extraTeachers], ['batches', 'Batches', d.limits.batches], ['storageMB', 'Storage (MB)', Math.round(d.limits.storageBytes / 1048576)]].map(([k, l, v]) =>
          h('label', {}, l, h('input', { name: k, type: 'number', min: 0, value: v, style: 'width:7rem', ...(type === 'tuition' && k === 'extraTeachers' ? { readonly: true } : {}) })))),
        h('div', {}, d.featureKeys.map((k) => h('label', { class: 'chk', style: 'margin-right:1rem' }, h('input', { type: 'checkbox', name: 'f-' + k, checked: d.features[k] ? true : undefined }), k))),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'apply' }), 'Also apply to existing accounts that have no custom quota'),
        h('div', {}, reasonBox(), ' ', h('button', { class: 'btn gold', type: 'submit' }, 'Save new version')), h('p', { class: 'msg muted', role: 'status' }));
      f.querySelector('input[type=text]').name = 'reason'; blocks.push(f);
    }
    show(lead, tabs('plan'), h('p', { class: 'muted' }, 'Each save creates a new version. New accounts start with the latest version. A feature switched off here is refused by the server for those accounts.'), ...blocks);
  }

  // ---------- Cost ----------
  async function cost() {
    const c = await call('adminInstitutionCost');
    show(lead, tabs('cost'), h('div', { class: 'card' }, h('h3', {}, 'ESTIMATE, not a bill'), h('p', {}, c.note),
      ...fields([['Estimated records', num(c.total.records)], ['Estimated stored size', mb(c.total.approxBytes)], ['Tuition accounts', c.byType.tuition.accounts + ' · ' + num(c.byType.tuition.records) + ' records'], ['Coaching accounts', c.byType.coaching.accounts + ' · ' + num(c.byType.coaching.records) + ' records']])),
      h('h3', {}, 'Largest accounts (estimate)'), table(['Name', 'Type', 'Estimated records', 'Estimated size'], c.top.map((r) => h('tr', {}, h('td', {}, h('a', { href: '#/institutions/' + r.tenantId }, r.name || r.tenantId)), h('td', {}, TYPE_LABEL[r.type]), h('td', {}, num(r.records)), h('td', {}, mb(r.approxBytes)))), 'No accounts yet.'),
      h('p', { class: 'muted' }, 'For the real Firebase charges open Google Cloud Billing for the project. The existing Infrastructure page shows measured platform usage.'));
  }

  // ---------- One account ----------
  async function detail(id) {
    const d = await call('adminInstitutionDetail', { tenantId: id }); const box = h('div', {});
    const act = (label, fn, input) => h('button', { class: 'btn', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (er) { toast(failText(er)); } b.disabled = false; } }, label);
    const refresh = () => detail(id);
    const statusReason = reasonBox('Reason for suspending or reactivating');
    const limitsForm = h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(e.target);
      try { await call('adminInstitutionSetLimits', { tenantId: id, reason: fd.get('reason'), limits: { activeStudents: fd.get('activeStudents'), extraTeachers: fd.get('extraTeachers'), batches: fd.get('batches'), storageMB: fd.get('storageMB') } }); toast('Quotas saved.'); refresh(); } catch (er) { toast(failText(er)); } } },
      h('h3', {}, 'Quotas (students, teachers, batches, storage)'), h('div', { class: 'row', style: 'gap:.6rem;flex-wrap:wrap' }, [['activeStudents', 'Active students', d.limits.activeStudents], ['extraTeachers', 'Extra teachers', d.limits.extraTeachers], ['batches', 'Batches', d.limits.batches], ['storageMB', 'Storage (MB)', Math.round((d.limits.storageBytes || 0) / 1048576)]].map(([k, l, v]) =>
        h('label', {}, l, h('input', { name: k, type: 'number', min: 0, value: v ?? 0, style: 'width:7rem' })))), h('div', {}, h('input', { name: 'reason', type: 'text', maxlength: 300, placeholder: 'Reason (saved in the audit log)', style: 'min-width:18rem' }), ' ', h('button', { class: 'btn gold', type: 'submit' }, 'Save quotas')));
    const featForm = h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(e.target); const features = {}; d.featureKeys.forEach((k) => { features[k] = fd.get('f-' + k) === 'on'; });
      try { await call('adminInstitutionSetFeatures', { tenantId: id, reason: fd.get('reason'), features }); toast('Features saved.'); refresh(); } catch (er) { toast(failText(er)); } } },
      h('h3', {}, 'Free plan features for this account'), h('div', {}, d.featureKeys.map((k) => h('label', { class: 'chk', style: 'margin-right:1rem' }, h('input', { type: 'checkbox', name: 'f-' + k, checked: d.features[k] === false ? undefined : true }), k))),
      h('div', {}, h('input', { name: 'reason', type: 'text', maxlength: 300, placeholder: 'Reason (saved in the audit log)', style: 'min-width:18rem' }), ' ', h('button', { class: 'btn gold', type: 'submit' }, 'Save features')));
    const convForm = h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await call('adminInstitutionSetConversion', { tenantId: id, state: fd.get('state'), note: fd.get('note') }); toast('Saved.'); refresh(); } catch (er) { toast(failText(er)); } } },
      h('h3', {}, 'Free to paid'), h('select', { name: 'state' }, [['none', 'Not interested'], ['interested', 'Interested in a paid plan'], ['converted', 'Converted to paid']].map(([v, l]) => h('option', { value: v, selected: v === d.conversion ? true : undefined }, l))), ' ',
      h('input', { name: 'note', type: 'text', maxlength: 200, value: d.conversionNote || '', placeholder: 'Note (optional)' }), ' ', h('button', { class: 'btn', type: 'submit' }, 'Save'));
    const priv = h('div', { class: 'card' }, h('h3', {}, 'Private records (reason required, always logged)'), h('p', { class: 'muted' }, 'Opens at most 100 rows of student names and contacts, or recent payments. Passwords are never shown.'));
    const privReason = reasonBox('Why do you need to see these records?'); const privOut = h('div', {});
    const openPriv = (kind) => async () => { const r = await call('adminInstitutionPrivateAccess', { tenantId: id, kind, reason: privReason.value });
      privOut.replaceChildren(r.kind === 'students' ? table(['Name', 'Class', 'Guardian', 'Mobile', 'Status'], r.items.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.className), h('td', {}, x.guardianName), h('td', {}, x.guardianMobile), h('td', {}, x.status))), 'No students.')
        : table(['Receipt', 'Date', 'Amount (₹)', 'Method', 'Status'], r.items.map((x) => h('tr', {}, h('td', {}, x.receiptNo), h('td', {}, x.paidOn), h('td', {}, (x.amountPaise / 100).toFixed(2)), h('td', {}, x.method), h('td', {}, x.status))), 'No payments.'), h('p', { class: 'muted' }, 'This access was written to the audit log.')); };
    priv.append(privReason, ' ', act('View students', openPriv('students')), ' ', act('View payments', openPriv('fees')), privOut);
    show(lead, h('p', {}, h('a', { href: '#/institutions/' + d.type }, '← Back to the list')), h('div', { class: 'card' }, h('h2', {}, d.name || d.tenantId),
      ...fields([['Type', TYPE_LABEL[d.type]], ['Account id', d.tenantId], ['Owner email', d.ownerEmail], ['Owner email verified', d.owner.verified === null ? 'unknown' : d.owner.verified ? 'Yes' : 'No'], ['Created', dmy(d.createdMs)], ['Last owner sign-in (Firebase)', d.owner.lastSignIn || '-'],
        ['Last seen on dashboard', dt(d.lastSeenMs)], ['Activity', ACT_LABEL[d.activityState]], ['Plan', d.planId + ' · version ' + d.entitlementVersion + (d.limitsCustom ? ' (custom quota)' : '')], ['Status', (d.status === 'active' ? 'Active' : 'Suspended') + (d.statusReason ? ' · ' + d.statusReason : '')],
        ['Students', (d.usage.activeStudents || 0) + ' / ' + (d.limits.activeStudents ?? 0)], ['Batches', (d.usage.batches || 0) + ' / ' + (d.limits.batches ?? 0)], ['Extra teachers', (d.usage.extraTeachers || 0) + ' / ' + (d.limits.extraTeachers ?? 0)], ['Storage', mb(d.usage.storageBytes) + ' / ' + mb(d.limits.storageBytes)],
        ['Estimated records', num(d.estimate.records) + ' (estimate, not a bill)']]),
      h('div', { style: 'margin-top:.6rem' }, statusReason, ' ', d.status === 'active' ? act('Suspend', async () => { await call('adminInstitutionSetStatus', { tenantId: id, status: 'suspended', reason: statusReason.value }); toast('Suspended.'); refresh(); }) : act('Reactivate', async () => { await call('adminInstitutionSetStatus', { tenantId: id, status: 'active', reason: statusReason.value }); toast('Reactivated.'); refresh(); }))),
      limitsForm, featForm, convForm, priv, h('h3', {}, 'History'), table(['When', 'Who', 'What', 'Reason'], d.history.map((x) => h('tr', {}, h('td', {}, dt(x.at)), h('td', {}, x.who), h('td', {}, x.action), h('td', {}, x.reason || ''))), 'No history yet.'), box);
  }

  try {
    show(lead, h('div', { class: 'empty' }, 'Loading.'));
    if (sub === 'plan') return await plan();
    if (sub === 'cost') return await cost();
    if (/^ins-[0-9a-f]{20}$/.test(sub)) return await detail(sub);
    const data = await call('adminInstitutionList');
    if (sub === 'tuition' || sub === 'coaching') return await directory(sub, data);
    return await overview(data);
  } catch (e) { fail(e); }
}
