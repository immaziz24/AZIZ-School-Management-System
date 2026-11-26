// Tuition and coaching shared screens (Phase 2): dashboard numbers, students, batches, fees, payments, receipts, attendance, reports, settings.
// Every record is read and written through server functions that check the signed-in owner; this file only draws screens.
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const money = (p) => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number(p || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const rupees = (p) => (Number(p || 0) / 100).toFixed(2).replace(/\.00$/, '');
const dmy = (s) => (s ? s.split('-').reverse().join('-') : '');
const monthLabel = (c) => new Date(c + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue' };

export function mountTuition({ section, inst, call, h, body, go }) {
  const tenantId = inst.tenantId;
  const api = (name, data) => call(name, { tenantId, ...(data || {}) });
  const profile = inst.profile || {};
  const say = (el, text, ok) => { el.textContent = text; el.style.color = ok ? '#8fe0a5' : ''; };
  const failText = (e) => (e && e.message && !/^internal$/i.test(e.message) ? e.message.replace(/^.*?: /, '') : 'Something went wrong. Check the internet and try again.');
  const fieldErrors = (e) => (e && e.details && e.details.errors) || {};
  const loading = () => h('p', { class: 'empty' }, 'Loading.');
  const field = (label, input, key) => h('label', { 'data-field': key }, label, input, h('span', { class: 'ferr', 'data-err': key }));
  const inp = (name, type = 'text', value = '', extra = {}) => h('input', { name, type, value: value ?? '', ...extra });
  const sel = (name, options, value = '', blank = '') => h('select', { name }, blank ? h('option', { value: '' }, blank) : null, options.map((o) => (typeof o === 'string' ? h('option', { value: o, selected: o === value ? true : undefined }, o) : h('option', { value: o.value, selected: o.value === value ? true : undefined }, o.label))));
  const showErrors = (form, errs) => { form.querySelectorAll('[data-err]').forEach((n) => { n.textContent = errs[n.dataset.err] || ''; }); };
  const table = (head, rows, empty) => (rows.length ? h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : h('p', { class: 'empty' }, empty));
  const confirmBox = (message, onYes) => { if (window.confirm(message)) onYes(); };

  // ---------- Receipt ----------
  async function showReceipt(receiptNo) {
    const r = await api('tuitionReceipt', { receiptNo });
    const sheet = h('div', { class: 'receipt-sheet' },
      h('div', { class: 'rc' }, h('p', { class: 'rc-brand' }, r.institutionName), h('h2', {}, 'Fee receipt' + (r.status === 'reversed' ? ' (REVERSED)' : '')),
        h('p', {}, 'Receipt no. ', h('b', {}, r.receiptNo), ' · Date ', h('b', {}, dmy(r.paidOn))),
        h('p', {}, 'Student: ', h('b', {}, r.studentName), ' · Class ', r.className), h('p', {}, 'Guardian: ' + r.guardianName),
        table(['For', 'Amount'], r.lines.map((l) => h('tr', {}, h('td', {}, l.label), h('td', {}, money(l.amountPaise)))), 'No lines.'),
        h('p', {}, 'Paid ', h('b', {}, money(r.amountPaise)), ' by ' + r.method.toUpperCase() + (r.note ? ' · ' + r.note : '')),
        h('p', {}, 'Balance still due: ', h('b', {}, money(r.balanceAfterPaise))), h('p', { class: 'rc-foot' }, 'Powered by AZIZ School Management System')),
      h('div', { class: 'rc-actions' }, h('button', { class: 'gold', type: 'button', onclick: () => window.print() }, 'Print'), h('button', { type: 'button', onclick: () => sheet.remove() }, 'Close')));
    document.body.append(sheet);
  }

  // ---------- Dashboard ----------
  async function dashboard() {
    const box = h('div', {}, loading()); body.append(box);
    try {
      const d = await api('tuitionDashboard');
      box.replaceChildren(h('p', { style: 'color:var(--mut)' }, monthLabel(d.cycle)),
        h('div', { class: 'grid' },
          card('Active students', d.activeStudents + ' / ' + (d.limits.activeStudents ?? 0)), card('Batches', d.batches + ' / ' + (d.limits.batches ?? 0)),
          card('Expected this month', money(d.expectedPaise)), card('Collected this month', money(d.collectedPaise)), card('Total pending', money(d.pendingPaise)), card('Overdue charges', String(d.overdueCount))),
        h('h2', {}, 'Quick actions'), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => go('Students', 'add') }, 'Add student'),
          h('button', { type: 'button', onclick: () => go('Fees') }, 'Record payment'), h('button', { type: 'button', onclick: () => go('Attendance') }, 'Mark attendance')));
      if (!d.activeStudents) box.append(h('h2', {}, 'Get started'), h('ol', { class: 'todo' }, h('li', {}, 'Create a batch'), h('li', {}, 'Add your first student'), h('li', {}, 'Record the first fee payment')));
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); }
  }
  const card = (label, value) => h('div', { class: 'card' }, h('small', {}, label), h('b', {}, value));

  // ---------- Batches ----------
  let batchCache = null;
  async function loadBatches(force) { if (force || !batchCache) batchCache = (await api('tuitionBatchList')).items; return batchCache; }
  async function batches() {
    const box = h('div', {}, loading()); body.append(box);
    const draw = async () => {
      let items; try { items = (await loadBatches(true)).filter((b) => b.status === 'active'); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
      box.replaceChildren(h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add batch')),
        table(['Batch', 'Class', 'Subject', 'Days', 'Time', 'Students', ''], items.map((b) => h('tr', {}, h('td', {}, b.name), h('td', {}, b.className), h('td', {}, b.subject), h('td', {}, b.days.join(', ')), h('td', {}, b.startTime + ' – ' + b.endTime), h('td', {}, String(b.students)),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(b) }, 'Edit'), h('button', { type: 'button', onclick: () => confirmBox('Archive "' + b.name + '"? Students keep their records, but the batch closes.', async () => { try { await api('tuitionBatchArchive', { batchId: b.id }); draw(); } catch (e) { window.alert(failText(e)); } }) }, 'Archive')))),
          'No batches yet. Add your first batch.'));
    };
    const form = (b) => {
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        const values = { name: fd.get('name'), className: fd.get('className'), subject: fd.get('subject'), days: fd.getAll('days'), startTime: fd.get('startTime'), endTime: fd.get('endTime') };
        try { await api('tuitionBatchSave', { batchId: b ? b.id : '', values }); batchCache = null; draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, b ? 'Edit batch' : 'New batch'),
        field('Batch name', inp('name', 'text', b?.name, { maxlength: 60, placeholder: 'Class 10 Maths – Morning' }), 'name'),
        field('Class', inp('className', 'text', b?.className, { list: 'classes', maxlength: 40 }), 'className'), field('Subject', inp('subject', 'text', b?.subject, { list: 'subjects', maxlength: 40 }), 'subject'),
        h('fieldset', {}, h('legend', {}, 'Days'), WEEKDAYS.map((d) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'days', value: d, checked: b?.days?.includes(d) ? true : undefined }), d)), h('span', { class: 'ferr', 'data-err': 'days' })),
        h('div', { class: 'two' }, field('Starts', inp('startTime', 'time', b?.startTime), 'startTime'), field('Ends', inp('endTime', 'time', b?.endTime), 'endTime')),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save batch'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    draw();
  }
  const datalists = () => [h('datalist', { id: 'classes' }, (profile.classes || []).map((c) => h('option', { value: c }))), h('datalist', { id: 'subjects' }, (profile.subjects || []).map((c) => h('option', { value: c })))];

  // ---------- Students ----------
  async function students(startAdd) {
    const box = h('div', {}, loading(), ...datalists()); body.append(box);
    const state = { q: '', status: 'active', className: '', batchId: '', page: 1 };
    let bl = []; try { bl = (await loadBatches(true)).filter((b) => b.status === 'active'); } catch { bl = []; }
    const draw = async () => {
      const list = h('div', {}, loading());
      const q = inp('q', 'search', state.q, { placeholder: 'Search name, guardian or mobile', 'aria-label': 'Search students' });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.q = q.value; state.page = 1; draw(); } });
      const filt = (name, options, blank) => { const s = sel(name, options, state[name], blank); s.addEventListener('change', () => { state[name] = s.value; state.page = 1; draw(); }); return s; };
      box.replaceChildren(h('div', { class: 'toolbar' }, q, h('button', { type: 'button', onclick: () => { state.q = q.value; state.page = 1; draw(); } }, 'Search'),
        filt('status', [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]),
        filt('className', profile.classes || [], 'All classes'), filt('batchId', bl.map((b) => ({ value: b.id, label: b.name })), 'All batches'),
        h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add student')), list, ...datalists());
      try {
        const r = await api('tuitionStudentList', state); const bname = Object.fromEntries(bl.map((b) => [b.id, b.name]));
        list.replaceChildren(table(['Student', 'Class', 'Guardian', 'Batch', 'Fee / month', 'Status', ''], r.items.map((s) => h('tr', {}, h('td', {}, h('b', {}, s.name), h('br'), h('small', {}, s.subject)), h('td', {}, s.className), h('td', {}, s.guardianName, h('br'), h('small', {}, s.guardianMobile)),
          h('td', {}, bname[s.batchId] || '–'), h('td', {}, money(s.monthlyFeePaise)), h('td', {}, h('span', { class: 'pill ' + s.status }, s.status)),
          h('td', { class: 'row-actions' }, s.status !== 'archived' ? h('button', { type: 'button', onclick: () => form(s) }, 'Edit') : null, s.status === 'active' ? h('button', { type: 'button', onclick: () => change(s, 'inactive') }, 'Pause') : null,
            s.status !== 'active' ? h('button', { type: 'button', onclick: () => change(s, 'active') }, 'Activate') : null, s.status !== 'archived' ? h('button', { type: 'button', onclick: () => change(s, 'archived') }, 'Archive') : null))),
          'No students match. Try another search or add a student.'),
          r.pages > 1 ? h('div', { class: 'actions' }, h('button', { type: 'button', disabled: r.page <= 1, onclick: () => { state.page = r.page - 1; draw(); } }, 'Previous'), h('span', {}, 'Page ' + r.page + ' of ' + r.pages + ' · ' + r.total + ' students'),
            h('button', { type: 'button', disabled: r.page >= r.pages, onclick: () => { state.page = r.page + 1; draw(); } }, 'Next')) : h('p', { style: 'color:var(--mut)' }, r.total + ' students'));
      } catch (e) { list.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    const change = (s, to) => {
      let reason = '';
      if (to === 'archived') { reason = window.prompt('Why are you archiving ' + s.name + '? (required)') || ''; if (reason.trim().length < 3) return; }
      else if (!window.confirm((to === 'active' ? 'Activate ' : 'Pause ') + s.name + '?')) return;
      api('tuitionStudentStatus', { studentId: s.id, status: to, reason }).then(draw).catch((e) => window.alert(failText(e)));
    };
    const form = (s) => {
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.'); const values = Object.fromEntries(fd.entries());
        try { await api('tuitionStudentSave', { studentId: s ? s.id : '', values }); batchCache = null; draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, s ? 'Edit student' : 'New student'),
        h('div', { class: 'two' }, field('Student name', inp('name', 'text', s?.name, { maxlength: 80 }), 'name'), field('Class', inp('className', 'text', s?.className, { list: 'classes', maxlength: 40 }), 'className')),
        h('div', { class: 'two' }, field('School name (optional)', inp('schoolName', 'text', s?.schoolName, { maxlength: 100 }), 'schoolName'), field('Subject', inp('subject', 'text', s?.subject, { list: 'subjects', maxlength: 80 }), 'subject')),
        h('div', { class: 'two' }, field('Guardian name', inp('guardianName', 'text', s?.guardianName, { maxlength: 80 }), 'guardianName'), field('Guardian mobile', inp('guardianMobile', 'tel', s?.guardianMobile, { placeholder: '+91 98300 12345' }), 'guardianMobile')),
        h('div', { class: 'two' }, field('Student mobile (optional)', inp('studentMobile', 'tel', s?.studentMobile), 'studentMobile'), field('Batch', sel('batchId', bl.map((b) => ({ value: b.id, label: b.name })), s?.batchId || '', 'No batch yet'), 'batchId')),
        field('Address (optional)', inp('address', 'text', s?.address, { maxlength: 200 }), 'address'),
        h('div', { class: 'two' }, field('Joining date', inp('joiningDate', 'date', s?.joiningDate || today(), { max: '9999-12-31' }), 'joiningDate'), field('Joining time (optional)', inp('joiningTime', 'time', s?.joiningTime), 'joiningTime')),
        h('div', { class: 'two' }, field('Monthly fee (₹)', inp('monthlyFee', 'text', s ? rupees(s.monthlyFeePaise) : '', { inputmode: 'decimal', placeholder: '500' }), 'monthlyFee'), field('Fee due day of month (1–31)', inp('dueDay', 'number', s?.dueDay ?? 5, { min: 1, max: 31 }), 'dueDay')),
        s ? h('p', { class: 'hint' }, 'Changing the monthly fee affects new months only. To fix a charge already created, use Fees → Adjust.') : h('div', { class: 'two' },
          field('Admission fee (₹, optional)', inp('admissionFee', 'text', '', { inputmode: 'decimal' }), 'admissionFee'), field('Opening balance (₹, optional)', inp('openingBalance', 'text', '', { inputmode: 'decimal' }), 'openingBalance')),
        field('Notes (optional)', inp('notes', 'text', s?.notes, { maxlength: 300 }), 'notes'),
        h('p', { class: 'hint' }, 'The first month is charged in full by default. If you want a different amount, record it later from Fees → Adjust with a reason.'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save student'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f, ...datalists());
    };
    startAdd ? form(null) : draw();
  }

  // ---------- Fees and payments ----------
  async function fees() {
    const box = h('div', {}, loading()); body.append(box);
    const state = { tab: 'dues', scope: 'month', cycle: today().slice(0, 7), from: today().slice(0, 8) + '01', to: today() };
    const tabs = () => h('div', { class: 'tabs' }, [['dues', 'Fee dues'], ['payments', 'Payments']].map(([k, l]) => h('button', { type: 'button', ...(state.tab === k ? { 'aria-current': 'true' } : {}), onclick: () => { state.tab = k; draw(); } }, l)));
    const draw = async () => {
      const out = h('div', {}, loading()); box.replaceChildren(tabs(), out);
      try { state.tab === 'dues' ? await dues(out) : await payments(out); } catch (e) { out.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    const dues = async (out) => {
      const r = await api('tuitionFees', { cycle: state.cycle, scope: state.scope });
      const month = inp('cycle', 'month', state.cycle); month.addEventListener('change', () => { if (month.value) { state.cycle = month.value; state.scope = 'month'; draw(); } });
      const scope = sel('scope', [{ value: 'month', label: 'One month' }, { value: 'due', label: 'All unpaid dues' }], state.scope); scope.addEventListener('change', () => { state.scope = scope.value; draw(); });
      const owed = r.items.reduce((t, x) => t + x.balancePaise, 0);
      out.replaceChildren(h('div', { class: 'toolbar' }, scope, state.scope === 'month' ? month : null, h('b', {}, 'Due in view: ' + money(owed))),
        table(['Student', 'For', 'Due date', 'Amount', 'Paid', 'Balance', 'Status', ''], r.items.map((x) => h('tr', {}, h('td', {}, h('b', {}, x.studentName), h('br'), h('small', {}, x.className + (x.guardianMobile ? ' · ' + x.guardianMobile : ''))),
          h('td', {}, x.kind === 'monthly' ? monthLabel(x.cycle) : x.kind === 'admission' ? 'Admission fee' : 'Opening balance'), h('td', {}, dmy(x.dueDate)), h('td', {}, money(x.amountPaise)), h('td', {}, money(x.paidPaise)), h('td', {}, money(x.balancePaise)),
          h('td', {}, h('span', { class: 'pill ' + x.status }, STATUS_LABEL[x.status])),
          h('td', { class: 'row-actions' }, x.balancePaise > 0 ? h('button', { class: 'gold', type: 'button', onclick: () => payForm(out, x) }, 'Record payment') : null, h('button', { type: 'button', onclick: () => adjustForm(out, x) }, 'Adjust')))),
          'Nothing to show. Add students with a monthly fee and their charges appear here.'));
    };
    const payForm = (out, x) => {
      let key = newKey();
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); const btn = f.querySelector('button[type=submit]'); btn.disabled = true; say(msg, 'Saving.');
        try { const r = await api('tuitionPaymentRecord', { studentId: x.studentId, chargeId: fd.get('apply') === 'this' ? x.id : '', amount: fd.get('amount'), method: fd.get('method'), paidOn: fd.get('paidOn'), note: fd.get('note'), idempotencyKey: key });
          say(msg, (r.duplicate ? 'Already saved. Receipt ' : 'Saved. Receipt ') + r.receiptNo, true); await draw(); showReceipt(r.receiptNo).catch(() => {}); }
        catch (er) { btn.disabled = false; showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, 'Record payment'), h('p', {}, x.studentName + ' · balance on this item ' + money(x.balancePaise)),
        field('Amount received (₹)', inp('amount', 'text', rupees(x.balancePaise), { inputmode: 'decimal' }), 'amount'),
        h('div', { class: 'two' }, field('Method', sel('method', [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank transfer' }], 'cash'), 'method'), field('Date received', inp('paidOn', 'date', today(), { max: today() }), 'paidOn')),
        field('Note (optional)', inp('note', 'text', '', { maxlength: 100 }), 'note'),
        h('label', {}, 'Apply to', sel('apply', [{ value: 'this', label: 'This item only' }, { value: 'oldest', label: 'Oldest dues first (all items of this student)' }], 'this')),
        h('p', { class: 'hint' }, 'A part payment is allowed. You cannot take more than is due.'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save and get receipt'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      out.replaceChildren(f);
    };
    const adjustForm = (out, x) => {
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        try { await api('tuitionChargeAdjust', { chargeId: x.id, amount: fd.get('amount'), reason: fd.get('reason') }); draw(); } catch (er) { say(msg, failText(er)); } } },
        h('h2', {}, 'Adjust amount'), h('p', {}, x.studentName + ' · now ' + money(x.amountPaise) + ', already paid ' + money(x.paidPaise)),
        field('New amount (₹)', inp('amount', 'text', rupees(x.amountPaise), { inputmode: 'decimal' }), 'amount'), field('Reason (required, kept in the audit trail)', inp('reason', 'text', '', { maxlength: 200, placeholder: 'Joined mid-month, half fee' }), 'reason'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save change'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      out.replaceChildren(f);
    };
    const payments = async (out) => {
      const from = inp('from', 'date', state.from); const to = inp('to', 'date', state.to, { max: today() });
      const r = await api('tuitionPayments', { from: state.from, to: state.to });
      const apply = () => { if (from.value && to.value) { state.from = from.value; state.to = to.value; draw(); } };
      const posted = r.items.filter((p) => p.status === 'posted').reduce((t, p) => t + p.amountPaise, 0);
      out.replaceChildren(h('div', { class: 'toolbar' }, h('label', {}, 'From', from), h('label', {}, 'To', to), h('button', { type: 'button', onclick: apply }, 'Show'), h('b', {}, 'Received: ' + money(posted))),
        table(['Date', 'Receipt', 'Student', 'Amount', 'Method', 'Status', ''], r.items.map((p) => h('tr', {}, h('td', {}, dmy(p.paidOn)), h('td', {}, p.receiptNo), h('td', {}, p.studentName), h('td', {}, money(p.amountPaise)), h('td', {}, p.method.toUpperCase()), h('td', {}, h('span', { class: 'pill ' + (p.status === 'posted' ? 'active' : 'archived') }, p.status)),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => showReceipt(p.receiptNo).catch((e) => window.alert(failText(e))) }, 'Receipt'),
            p.status === 'posted' ? h('button', { type: 'button', onclick: () => { const reason = window.prompt('Why is this payment being reversed? (required)') || ''; if (reason.trim().length < 5) return; api('tuitionPaymentReverse', { paymentId: p.id, reason }).then(draw).catch((e) => window.alert(failText(e))); } }, 'Reverse') : null))),
          'No payments in this period.'));
    };
    draw();
  }

  // ---------- Attendance ----------
  async function attendance() {
    const box = h('div', {}, loading()); body.append(box);
    let bl = []; try { bl = (await loadBatches(true)).filter((b) => b.status === 'active'); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
    if (!bl.length) { box.replaceChildren(h('p', { class: 'empty' }, 'Create a batch and assign students to it first. Attendance is taken batch by batch.')); return; }
    const state = { tab: 'mark', batchId: bl[0].id, date: today(), from: today().slice(0, 8) + '01', to: today() };
    const batchSel = () => { const s = sel('batchId', bl.map((b) => ({ value: b.id, label: b.name })), state.batchId); s.addEventListener('change', () => { state.batchId = s.value; draw(); }); return s; };
    const draw = async () => {
      const out = h('div', {}, loading());
      box.replaceChildren(h('div', { class: 'tabs' }, [['mark', 'Mark attendance'], ['history', 'History']].map(([k, l]) => h('button', { type: 'button', ...(state.tab === k ? { 'aria-current': 'true' } : {}), onclick: () => { state.tab = k; draw(); } }, l))), out);
      try { state.tab === 'mark' ? await mark(out) : await history(out); } catch (e) { out.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    const mark = async (out) => {
      const date = inp('date', 'date', state.date, { max: today() }); date.addEventListener('change', () => { if (date.value) { state.date = date.value; draw(); } });
      const r = await api('tuitionAttendanceGet', { batchId: state.batchId, date: state.date }); const picks = {}; r.items.forEach((i) => { picks[i.studentId] = i.status || ''; });
      const msg = h('p', { class: 'msg err', role: 'alert' });
      const rows = r.items.map((i) => h('tr', {}, h('td', {}, i.name), h('td', { class: 'seg' }, [['present', 'P'], ['absent', 'A'], ['late', 'L'], ['excused', 'E']].map(([v, l]) => h('button', { type: 'button', title: v, 'aria-pressed': picks[i.studentId] === v ? 'true' : 'false', onclick: (e) => { picks[i.studentId] = v; e.target.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.target.setAttribute('aria-pressed', 'true'); } }, l)))));
      out.replaceChildren(h('div', { class: 'toolbar' }, batchSel(), date, h('button', { type: 'button', onclick: () => { r.items.forEach((i) => { picks[i.studentId] = 'present'; }); out.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b, n) => b.setAttribute('aria-pressed', n % 4 === 0 ? 'true' : 'false'))); } }, 'Mark all present')),
        table(['Student', 'P = present · A = absent · L = late · E = excused'], rows, 'No active students are assigned to this batch.'), msg,
        r.items.length ? h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: async () => {
          const entries = r.items.filter((i) => picks[i.studentId]).map((i) => ({ studentId: i.studentId, status: picks[i.studentId] }));
          if (entries.length !== r.items.length) { say(msg, 'Mark every student before saving.'); return; }
          say(msg, 'Saving.'); try { const s = await api('tuitionAttendanceMark', { batchId: state.batchId, date: state.date, entries }); say(msg, 'Saved ' + s.saved + ' students' + (s.corrected ? ' (' + s.corrected + ' corrected, kept in the audit trail).' : '.'), true); } catch (e) { say(msg, failText(e)); } } }, 'Save attendance')) : null);
    };
    const history = async (out) => {
      const from = inp('from', 'date', state.from); const to = inp('to', 'date', state.to, { max: today() });
      const r = await api('tuitionAttendanceHistory', { batchId: state.batchId, from: state.from, to: state.to });
      const apply = () => { if (from.value && to.value) { state.from = from.value; state.to = to.value; draw(); } };
      out.replaceChildren(h('div', { class: 'toolbar' }, batchSel(), h('label', {}, 'From', from), h('label', {}, 'To', to), h('button', { type: 'button', onclick: apply }, 'Show'), h('b', {}, r.days + ' class days')),
        table(['Student', 'Present', 'Absent', 'Late', 'Excused'], r.students.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, String(s.present)), h('td', {}, String(s.absent)), h('td', {}, String(s.late)), h('td', {}, String(s.excused)))), 'No attendance was marked in this period.'));
    };
    draw();
  }

  // ---------- Reports ----------
  async function reports() {
    const box = h('div', {}, loading()); body.append(box); let cycle = today().slice(0, 7);
    const draw = async () => {
      const month = inp('cycle', 'month', cycle); month.addEventListener('change', () => { if (month.value) { cycle = month.value; draw(); } });
      try {
        const r = await api('tuitionReport', { cycle });
        box.replaceChildren(h('div', { class: 'toolbar' }, h('label', {}, 'Month', month), h('button', { type: 'button', onclick: () => exportCsv(cycle) }, 'Download payments (CSV)')),
          h('div', { class: 'grid' }, card('Billed for ' + monthLabel(cycle), money(r.billedPaise)), card('Received this month', money(r.receiptsPaise)), card('Receipts issued', String(r.receiptCount)), card('Arrears before this month', money(r.arrearsPaise)), card('Outstanding at month end', money(r.outstandingPaise))),
          h('h2', {}, 'Received by method'), table(['Cash', 'UPI', 'Bank transfer'], [h('tr', {}, h('td', {}, money(r.byMethod.cash)), h('td', {}, money(r.byMethod.upi)), h('td', {}, money(r.byMethod.bank)))], ''));
      } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    const exportCsv = async (c) => {
      const r = await api('tuitionPayments', { from: c + '-01', to: c + '-31' }); const q = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
      const lines = [['Date', 'Receipt', 'Student', 'Amount (INR)', 'Method', 'Status'].map(q).join(',')].concat(r.items.map((p) => [p.paidOn, p.receiptNo, p.studentName, rupees(p.amountPaise), p.method, p.status].map(q).join(',')));
      const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: 'payments-' + c + '.csv' }); document.body.append(a); a.click(); a.remove();
    };
    draw();
  }

  // ---------- Settings ----------
  function settings() {
    const tuition = inst.type === 'tuition';
    const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.'); const values = Object.fromEntries(fd.entries());
      try { const r = await api('institutionProfileSave', { values }); inst.name = r.name; Object.assign(profile, values, { classes: String(values.classes).split(',').map((x) => x.trim()).filter(Boolean), subjects: String(values.subjects).split(',').map((x) => x.trim()).filter(Boolean) }); say(msg, 'Saved.', true); }
      catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
      h('h2', {}, 'Profile'), h('p', { class: 'hint' }, 'Sign-in email: ' + (profile.email || '')),
      ...(tuition ? [field('Tuition name', inp('tuitionName', 'text', profile.tuitionName), 'tuitionName'), field('Your name', inp('fullName', 'text', profile.fullName), 'fullName'), field('Address or locality', inp('locality', 'text', profile.locality), 'locality')]
        : [field('Centre name', inp('centreName', 'text', profile.centreName), 'centreName'), field('Owner name', inp('ownerName', 'text', profile.ownerName), 'ownerName'), field('Address', inp('address', 'text', profile.address), 'address'), field('PIN code', inp('pin', 'text', profile.pin), 'pin')]),
      field('Mobile', inp('mobile', 'tel', profile.mobile), 'mobile'), field('Classes (comma separated)', inp('classes', 'text', (profile.classes || []).join(', ')), 'classes'), field('Subjects (comma separated)', inp('subjects', 'text', (profile.subjects || []).join(', ')), 'subjects'),
      field('Teaching mode', sel('teachingMode', ['offline', 'online', 'hybrid'], profile.teachingMode), 'teachingMode'),
      h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save profile')),
      h('p', { class: 'hint' }, 'To export or delete your data, write to support@azizschoolmanagementsystem.com from your registered email.'));
    body.append(f);
  }

  const screens = { Dashboard: dashboard, Students: () => students(false), Batches: batches, Fees: fees, Attendance: attendance, Reports: reports, Settings: settings };
  if (section === 'Students+add') { students(true); return true; }
  if (!screens[section]) return false;
  screens[section](); return true;
}
