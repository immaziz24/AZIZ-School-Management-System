// Tuition and coaching shared screens (Phase 2): dashboard numbers, students, batches, fees, payments, receipts, attendance, reports, settings.
// Every record is read and written through server functions that check the signed-in owner; this file only draws screens.
import { mountSettings, subjectsCard, prefsOf, ALL_CLASSES, ALL_SUBJECTS } from './academic-ui.mjs?v=ac-2';
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const money = (p) => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number(p || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const rupees = (p) => (Number(p || 0) / 100).toFixed(2).replace(/\.00$/, '');
const nowTime = () => new Date(Date.now() + 330 * 60000).toISOString().slice(11, 16);
const dmy = (s) => (s ? s.split('-').reverse().join('-') : '');
const monthLabel = (c) => new Date(c + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GROUPS = [['All subjects', null], ['Science group', ['Mathematics', 'Science', 'Physical Science', 'Life Science', 'Physics', 'Chemistry', 'Biology', 'Computer Science']],
  ['Arts group', ['English', 'Bengali', 'Hindi', 'History', 'Geography', 'Civics', 'Sanskrit', 'Social Science']], ['Commerce group', ['Accountancy', 'Commerce', 'Economics', 'Mathematics', 'English']]];
const subjectsOf = (r) => (Array.isArray(r?.subjects) && r.subjects.length ? r.subjects : String(r?.subject || '').split(',').map((x) => x.trim()).filter(Boolean));
const subjectSummary = (r) => { const l = subjectsOf(r); return l.length > 4 ? l.length + ' subjects' : l.join(', '); };
const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue' };
const statusText = (x) => (x.status !== 'paid' && x.paidPaise > 0 ? 'Partial' + (x.status === 'overdue' ? ' · Overdue' : '') : STATUS_LABEL[x.status]);

export function mountTuition(args) {
  const { section, inst, call, h, body, go } = args;
  const tenantId = inst.tenantId;
  // Open the calendar or clock when the date, time or month box is clicked anywhere, not only on its small icon.
  body.addEventListener('click', (e) => { const t = e.target; if (t && t.matches && t.matches('input[type=date],input[type=time],input[type=month]')) { try { t.showPicker(); } catch { /* the browser opens it itself */ } } });
  const api = (name, data) => call(name, { tenantId, ...(data || {}) });
  const profile = inst.profile || {};
  const isTeacher = inst.role === 'teacher'; const isCoaching = inst.type === 'coaching';
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
      h('div', { class: 'rc' }, r.logo ? h('img', { src: r.logo, alt: '', style: 'max-height:64px;max-width:160px;display:block;margin:0 auto .4rem' }) : null, h('p', { class: 'rc-brand' }, r.institutionName), h('h2', {}, 'Fee receipt' + (r.status === 'reversed' ? ' (REVERSED)' : '')),
        h('p', {}, 'Receipt no. ', h('b', {}, r.receiptNo), ' · Date ', h('b', {}, dmy(r.paidOn))),
        h('p', {}, 'Student: ', h('b', {}, r.studentName), ' · ', /^class\b/i.test(r.className) ? r.className : 'Class ' + r.className), h('p', {}, 'Guardian: ' + r.guardianName),
        table(['For', 'Amount'], r.lines.map((l) => h('tr', {}, h('td', {}, String(l.label).replace(/^Fee (\d{4}-\d{2})$/, (m, c) => 'Fee for ' + monthLabel(c))), h('td', {}, money(l.amountPaise)))), 'No lines.'),
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
      if (d.batchOverview) box.append(h('h2', {}, 'Batches at a glance' + (d.teachers !== undefined ? ' · ' + d.teachers + ' teacher' + (d.teachers === 1 ? '' : 's') : '')), table(['Batch', 'Class', 'Students', 'Teachers'], d.batchOverview.map((b) => h('tr', {}, h('td', {}, b.name), h('td', {}, b.className), h('td', {}, String(b.students)), h('td', {}, String(b.teachers)))), 'No batches yet.'));
      if (!d.activeStudents) box.append(h('h2', {}, 'Get started'), h('ol', { class: 'todo' }, h('li', {}, 'Create a batch'), h('li', {}, 'Add your first student'), h('li', {}, 'Record the first fee payment')));
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); }
  }
  const nextMonth = () => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); };
  const upcomingFee = (s) => { const f = (s.feePlan || []).filter((x) => x.from > today().slice(0, 7)); return f.length ? ' Scheduled: ' + money(f[f.length - 1].monthlyFeePaise) + ' from ' + monthLabel(f[f.length - 1].from) + '.' : ''; };
  const card = (label, value) => h('div', { class: 'card' }, h('small', {}, label), h('b', {}, value));

  // ---------- Batches ----------
  let batchCache = null;
  async function loadBatches(force) { if (force || !batchCache) batchCache = (await api('tuitionBatchList')).items; return batchCache; }
  async function batches() {
    const box = h('div', {}, loading()); body.append(box);
    const draw = async () => {
      let items; try { items = (await loadBatches(true)).filter((b) => b.status === 'active'); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
      const showFee = isCoaching && !isTeacher;
      box.replaceChildren(isTeacher ? h('p', { class: 'hint' }, 'These are the batches your centre assigned to you.') : h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add batch')),
        table(['Batch', 'Class', 'Subject', 'Days', 'Time', 'Students', ...(showFee ? ['Monthly fee'] : []), ...(isTeacher ? [] : [''])], items.map((b) => h('tr', {}, h('td', {}, b.name), h('td', {}, b.className), h('td', {}, subjectSummary(b)), h('td', {}, b.days.join(', ')), h('td', {}, b.startTime + ' – ' + b.endTime), h('td', {}, String(b.students)), showFee ? h('td', {}, b.feePaise ? money(b.feePaise) : '-') : null,
          isTeacher ? null : h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(b) }, 'Edit'), h('button', { type: 'button', onclick: () => confirmBox('Archive "' + b.name + '"? Students keep their records, but the batch closes.', async () => { try { await api('tuitionBatchArchive', { batchId: b.id }); draw(); } catch (e) { window.alert(failText(e)); } }) }, 'Archive')))),
          'No batches yet. Add your first batch.'));
    };
    const form = (b) => {
      const classSel = choiceSelect('className', 'classes', b?.className, 'Choose a class');
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        const values = withOther({ name: fd.get('name'), className: fd.get('className'), classNameOther: fd.get('classNameOther'), subjects: [...fd.getAll('subjects[]'), ...String(fd.get('subjectsOther') || '').split(',')].map((x) => x.trim()).filter(Boolean), days: fd.getAll('days'), startTime: fd.get('startTime'), endTime: fd.get('endTime'), fee: fd.get('fee') });
        try { await api('tuitionBatchSave', { batchId: b ? b.id : '', values }); batchCache = null; draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, b ? 'Edit batch' : 'New batch'),
        field('Batch name', inp('name', 'text', b?.name, { maxlength: 60, placeholder: 'Class 10 Maths – Morning' }), 'name'),
        field('Class', classSel, 'className'), settingsHint('classes or subjects'),
        linkClass(classSel, subjectPicker(subjectsOf(b), true)),
        h('fieldset', {}, h('legend', {}, 'Days'), WEEKDAYS.map((d) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'days', value: d, checked: b?.days?.includes(d) ? true : undefined }), d)), h('span', { class: 'ferr', 'data-err': 'days' })),
        h('div', { class: 'two' }, field('Starts', inp('startTime', 'time', b?.startTime), 'startTime'), field('Ends', inp('endTime', 'time', b?.endTime), 'endTime')),
        isCoaching ? field('Monthly fee for this batch (₹, optional)', inp('fee', 'text', b?.feePaise ? rupees(b.feePaise) : '', { inputmode: 'decimal', placeholder: 'For example 1500' }), 'fee') : null,
        isCoaching ? h('p', { class: 'hint' }, 'New students added to this batch get this fee unless you type a different one. Existing students are not changed.') : null,
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save batch'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    draw();
  }
  const datalists = () => [];
  // The teacher's own classes and subjects (chosen in Settings) are the choices in the forms; a value already saved on a record is always kept in its list.
  const choiceSelect = (name, kind, current, blank) => {
    const all = kind === 'classes' ? ALL_CLASSES : ALL_SUBJECTS; const mine = [...new Set([...(profile[kind] || []), ...(current ? [current] : [])])];
    const more = [...(kind === 'subjects' ? ['All subjects'] : []), ...all].filter((x) => !mine.includes(x));
    const opt = (o) => h('option', { value: o, selected: o === current ? true : undefined }, o);
    const other = h('input', { type: 'text', name: name + 'Other', maxlength: 80, placeholder: 'Type it here', 'aria-label': 'Other ' + name, style: 'display:none' });
    const select = h('select', { name, onchange: () => { other.style.display = select.value === '__other' ? 'block' : 'none'; } }, h('option', { value: '' }, blank),
      mine.length ? h('optgroup', { label: 'Your ' + kind }, mine.map(opt)) : null, h('optgroup', { label: 'More ' + kind }, more.map(opt)), h('option', { value: '__other' }, 'Other (type your own)'));
    return h('span', {}, select, other);
  };
  // Many subjects: tick the boxes, or press a group button to tick a set at once (then change any box). Own subjects can be typed.
  const subjectPicker = (current, required) => {
    const mine = profile.subjects || []; const options = [...new Set([...mine, ...ALL_SUBJECTS, ...current])];
    const map = profile.classSubjects || {};
    const box = (o, on) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'subjects[]', value: o, checked: on ? true : undefined }), o);
    const main = h('div', { class: 'checks' }, options.map((o) => box(o, current.includes(o))));
    const restBox = h('div', { class: 'checks' }); const more = h('details', { style: 'display:none' }, h('summary', {}, 'More subjects'), restBox);
    const note = h('p', { class: 'hint' });
    const wrap = h('fieldset', { 'data-field': 'subjects' }, h('legend', {}, (required ? 'Subjects (tick one or more)' : 'Subjects (optional, tick any)')), note,
      h('div', { class: 'actions' }, GROUPS.map(([label, list]) => h('button', { type: 'button', onclick: () => wrap.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = list === null ? (mine.length ? mine.includes(c.value) : true) : list.includes(c.value); }) }, label === 'All subjects' && mine.length ? 'All my subjects' : label)),
        h('button', { type: 'button', onclick: () => wrap.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; }) }, 'Clear')),
      main, more, h('input', { type: 'text', name: 'subjectsOther', maxlength: 120, placeholder: 'Other subjects, separated by commas', 'aria-label': 'Other subjects' }), h('span', { class: 'ferr', 'data-err': 'subjects' }));
    // Choosing a class fills in the subjects saved for that class in Settings; the rest stay one tap away under "More subjects".
    wrap.useClass = (cls) => {
      const list = Object.prototype.hasOwnProperty.call(map, cls) ? map[cls] : null;
      if (!list || !list.length) { note.textContent = ''; return; }
      const rest = options.filter((o) => !list.includes(o));
      main.replaceChildren(...list.map((o) => box(o, true))); restBox.replaceChildren(...rest.map((o) => box(o, false))); more.style.display = rest.length ? '' : 'none';
      note.textContent = 'Subjects for ' + cls + ' filled in from Settings. Untick any this student does not take.';
    };
    return wrap;
  };
  // Links a class dropdown to a subject picker so a class change refreshes the subjects.
  const linkClass = (classSpan, picker) => { const s = classSpan.querySelector('select'); if (s) s.addEventListener('change', () => picker.useClass(s.value)); return picker; };
  const collectSubjects = (fd, values) => { values.subjects = [...fd.getAll('subjects[]'), ...String(fd.get('subjectsOther') || '').split(',')].map((x) => x.trim()).filter(Boolean); delete values['subjects[]']; delete values.subjectsOther; return values; };
  const withOther = (values) => { for (const k of ['className', 'subject']) { if (values[k] === '__other') values[k] = String(values[k + 'Other'] || '').trim(); delete values[k + 'Other']; } return values; };
  const settingsHint = (what) => h('span', { class: 'hint' }, 'Missing one? Add more ' + what + ' in ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('Settings'); } }, 'Settings'), '.');

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
        list.replaceChildren(table(['Student', 'Class', 'Guardian', 'Batch', 'Fee / month', 'Status', ''], r.items.map((s) => h('tr', {}, h('td', {}, h('b', {}, s.name), h('br'), h('small', {}, subjectSummary(s))), h('td', {}, s.className), h('td', {}, s.guardianName, h('br'), h('small', {}, s.guardianMobile)),
          h('td', {}, bname[s.batchId] || '–'), h('td', {}, money(s.monthlyFeePaise)), h('td', {}, h('span', { class: 'pill ' + s.status }, s.status)),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => ledger(s) }, 'History'), s.status !== 'archived' ? h('button', { type: 'button', onclick: () => form(s) }, 'Edit') : null, s.status === 'active' ? h('button', { type: 'button', onclick: () => change(s, 'inactive') }, 'Pause') : null,
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
    // One student's money history: every charge, every payment (with receipts), and what is still due.
    const ledger = async (s) => {
      const out = h('div', {}, loading()); box.replaceChildren(out);
      try {
        const [c, p] = await Promise.all([api('tuitionFees', { studentId: s.id }), api('tuitionPayments', { studentId: s.id })]);
        const charges = [...c.items].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)); const due = charges.reduce((t, x) => t + x.balancePaise, 0); const paid = p.items.filter((x) => x.status === 'posted').reduce((t, x) => t + x.amountPaise, 0);
        out.replaceChildren(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: draw }, '← Back to students')), h('h2', {}, s.name + ' · fee history'),
          h('div', { class: 'grid' }, card('Total paid', money(paid)), card('Still due', money(due))),
          h('h2', {}, 'Charges'), table(['For', 'Due date', 'Amount', 'Paid', 'Balance', 'Status'], charges.map((x) => h('tr', {}, h('td', {}, x.kind === 'monthly' ? monthLabel(x.cycle) : x.kind === 'admission' ? 'Admission fee' : 'Opening balance'), h('td', {}, dmy(x.dueDate)), h('td', {}, money(x.amountPaise)), h('td', {}, money(x.paidPaise)), h('td', {}, money(x.balancePaise)), h('td', {}, h('span', { class: 'pill ' + x.status }, statusText(x))))), 'No charges yet.'),
          h('h2', {}, 'Payments'), table(['Date', 'Receipt', 'Amount', 'Method', 'Status', ''], p.items.map((x) => h('tr', {}, h('td', {}, dmy(x.paidOn)), h('td', {}, x.receiptNo), h('td', {}, money(x.amountPaise)), h('td', {}, x.method.toUpperCase()), h('td', {}, h('span', { class: 'pill ' + (x.status === 'posted' ? 'active' : 'archived') }, x.status)),
            h('td', {}, h('button', { type: 'button', onclick: () => showReceipt(x.receiptNo).catch((e) => window.alert(failText(e))) }, 'Receipt')))), 'No payments yet.'));
      } catch (e) { out.replaceChildren(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: draw }, '← Back')), h('p', { class: 'err' }, failText(e))); }
    };
    const form = (s) => {
      const classSel = choiceSelect('className', 'classes', s?.className, 'Choose a class');
      const prefs = prefsOf(profile); const card = subjectsCard({ h, profile, current: subjectsOf(s), editing: !!s, go });
      classSel.querySelector('select').addEventListener('change', (ev) => card.useClass(ev.target.value));
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.'); const values = collectSubjects(fd, withOther(Object.fromEntries(fd.entries())));
        try { await api('tuitionStudentSave', { studentId: s ? s.id : '', values, feeEffectiveFrom: values.feeEffectiveFrom || '' }); batchCache = null; draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, s ? 'Edit student' : 'New student'),
        h('h3', { class: 'fsec' }, 'Student information'),
        h('div', { class: 'two' }, field('Student name', inp('name', 'text', s?.name, { maxlength: 80 }), 'name'), field('Class', classSel, 'className')),
        h('div', { class: 'two' }, field('School name (optional)', inp('schoolName', 'text', s?.schoolName, { maxlength: 100 }), 'schoolName'), field('Batch', sel('batchId', bl.map((b) => ({ value: b.id, label: b.name })), s?.batchId || '', 'No batch yet'), 'batchId')),
        h('h3', { class: 'fsec' }, 'Academic information'), card,
        h('h3', { class: 'fsec' }, 'Guardian information'),
        h('div', { class: 'two' }, field('Guardian name', inp('guardianName', 'text', s?.guardianName, { maxlength: 80 }), 'guardianName'), field('Guardian mobile', inp('guardianMobile', 'tel', s?.guardianMobile, { placeholder: '+91 98300 12345' }), 'guardianMobile')),
        h('div', { class: 'two' }, field('Student mobile (optional)', inp('studentMobile', 'tel', s?.studentMobile), 'studentMobile'), field('Address (optional)', inp('address', 'text', s?.address, { maxlength: 200 }), 'address')),
        h('h3', { class: 'fsec' }, 'Admission information'),
        h('div', { class: 'two' }, field('Joining date', inp('joiningDate', 'date', s?.joiningDate || (prefs.autoDate ? today() : ''), { max: '9999-12-31' }), 'joiningDate'), field('Joining time (optional)', inp('joiningTime', 'time', s?.joiningTime || (!s && prefs.autoTime ? nowTime() : '')), 'joiningTime')),
        h('h3', { class: 'fsec' }, 'Fee information'),
        h('div', { class: 'two' }, field('Monthly fee (₹)', inp('monthlyFee', 'text', s ? rupees(s.monthlyFeePaise) : '', { inputmode: 'decimal', placeholder: '500' }), 'monthlyFee'), field('Fee due day of month (1–31)', inp('dueDay', 'number', s?.dueDay ?? 5, { min: 1, max: 31 }), 'dueDay')),
        s ? h('div', {}, field('If you change the fee or due day, it starts from (month)', inp('feeEffectiveFrom', 'month', nextMonth(), { min: today().slice(0, 7) }), 'feeEffectiveFrom'), h('p', { class: 'hint' }, 'Months before this keep their old fee. To fix a charge already created, use Fees → Adjust.' + upcomingFee(s))) : h('div', { class: 'two' },
          field('Admission fee (₹, optional)', inp('admissionFee', 'text', '', { inputmode: 'decimal' }), 'admissionFee'), field('Opening balance (₹, optional)', inp('openingBalance', 'text', '', { inputmode: 'decimal' }), 'openingBalance')),
        field('Notes (optional)', inp('notes', 'text', s?.notes, { maxlength: 300 }), 'notes'),
        settingsHint('classes or subjects'), h('p', { class: 'hint' }, 'The first month is charged in full by default. If you want a different amount, record it later from Fees → Adjust with a reason.'),
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
        table(['Student', 'For', 'Due date', 'Amount', 'Paid', 'Balance', ...(state.scope === 'month' ? ['Earlier due', 'Total to collect'] : []), 'Status', ''], r.items.map((x) => h('tr', {}, h('td', {}, h('b', {}, x.studentName), h('br'), h('small', {}, x.className + (x.guardianMobile ? ' · ' + x.guardianMobile : ''))),
          h('td', {}, x.kind === 'monthly' ? monthLabel(x.cycle) : x.kind === 'admission' ? 'Admission fee' : 'Opening balance'), h('td', {}, dmy(x.dueDate)), h('td', {}, money(x.amountPaise)), h('td', {}, money(x.paidPaise)), h('td', {}, money(x.balancePaise)),
          ...(state.scope === 'month' ? [h('td', {}, x.prevDuePaise ? money(x.prevDuePaise) : '—'), h('td', {}, h('b', {}, money(x.balancePaise + x.prevDuePaise)))] : []),
          h('td', {}, h('span', { class: 'pill ' + x.status }, statusText(x))),
          h('td', { class: 'row-actions' }, x.balancePaise > 0 || x.prevDuePaise > 0 ? h('button', { class: 'gold', type: 'button', onclick: () => payForm(out, x) }, 'Record payment') : null, h('button', { type: 'button', onclick: () => historyView(out, x) }, 'History'), h('button', { type: 'button', onclick: () => adjustForm(out, x) }, 'Adjust')))),
          'Nothing to show. Add students with a monthly fee and their charges appear here.'));
    };
    const payForm = (out, x) => {
      let key = newKey(); const carry = (x.prevDuePaise || 0) > 0;
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); const btn = f.querySelector('button[type=submit]'); btn.disabled = true; say(msg, 'Saving.');
        try { const r = await api('tuitionPaymentRecord', { studentId: x.studentId, chargeId: fd.get('apply') === 'this' ? x.id : '', amount: fd.get('amount'), method: fd.get('method'), paidOn: fd.get('paidOn'), note: fd.get('note'), idempotencyKey: key });
          say(msg, (r.duplicate ? 'Already saved. Receipt ' : 'Saved. Receipt ') + r.receiptNo, true); await draw(); showReceipt(r.receiptNo).catch(() => {}); }
        catch (er) { btn.disabled = false; showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, 'Record payment'), h('p', {}, x.studentName + ' · balance on this item ' + money(x.balancePaise) + (carry ? ' + earlier due ' + money(x.prevDuePaise) + ' = ' + money(x.balancePaise + x.prevDuePaise) + ' to collect' : '')),
        field('Amount received (₹)', inp('amount', 'text', rupees(carry ? x.balancePaise + x.prevDuePaise : x.balancePaise), { inputmode: 'decimal' }), 'amount'),
        h('div', { class: 'two' }, field('Method', sel('method', [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank transfer' }], 'cash'), 'method'), field('Date received', inp('paidOn', 'date', today(), { max: today() }), 'paidOn')),
        field('Note (optional)', inp('note', 'text', '', { maxlength: 100 }), 'note'),
        h('label', {}, 'Apply to', sel('apply', [{ value: 'this', label: 'This item only' }, { value: 'oldest', label: 'Oldest dues first (all items of this student)' }], carry ? 'oldest' : 'this')),
        h('p', { class: 'hint' }, 'A part payment is allowed and the rest stays due. Whatever is not paid carries forward and is shown with next month\'s fee. You cannot take more than is due.'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save and get receipt'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      out.replaceChildren(f);
    };
    // Every payment applied to one fee item: when it came, how much, how, the receipt, and what is left. Unpaid money carries forward.
    const historyView = async (out, x) => {
      out.replaceChildren(loading());
      try {
        const p = await api('tuitionPayments', { studentId: x.studentId });
        const mine = p.items.map((q) => ({ q, part: (q.allocations || []).filter((l) => l.chargeId === x.id).reduce((t, l) => t + l.amountPaise, 0) })).filter((m) => m.part > 0).sort((a, b) => (a.q.paidOn < b.q.paidOn ? -1 : a.q.paidOn > b.q.paidOn ? 1 : a.q.receiptNo < b.q.receiptNo ? -1 : 1));
        const live = mine.filter((m) => m.q.status === 'posted'); let left = x.amountPaise;
        const rows = mine.map((m) => { const ok = m.q.status === 'posted'; if (ok) left -= m.part;
          return h('tr', {}, h('td', {}, dmy(m.q.paidOn)), h('td', {}, money(m.part)), h('td', {}, ok ? money(left) : '—'), h('td', {}, m.q.method.toUpperCase()), h('td', {}, m.q.receiptNo), h('td', {}, h('span', { class: 'pill ' + (ok ? 'paid' : 'overdue') }, ok ? 'Posted' : 'Reversed')), h('td', {}, m.q.note || (ok ? '' : m.q.reverseReason || '')),
            h('td', {}, h('button', { type: 'button', onclick: () => showReceipt(m.q.receiptNo).catch((e) => window.alert(failText(e))) }, 'Receipt'))); });
        const last = live.length ? live[live.length - 1].q.paidOn : '';
        out.replaceChildren(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: draw }, '← Back to fees')),
          h('h2', {}, x.studentName + ' · ' + (x.kind === 'monthly' ? monthLabel(x.cycle) : x.kind === 'admission' ? 'Admission fee' : 'Opening balance') + ' · payment history'),
          h('div', { class: 'grid' }, card('Fee', money(x.amountPaise)), card('Paid so far', money(x.paidPaise)), card('Still due', money(x.balancePaise)), card('Payments received', String(live.length)), card('Last payment', last ? dmy(last) : 'None yet')),
          x.balancePaise > 0 ? h('p', { class: 'hint' }, 'Status: ' + statusText(x) + '. The ' + money(x.balancePaise) + ' still due carries forward: it is added to next month\'s fee (see "Earlier due" and "Total to collect" on the next month).') : h('p', { class: 'hint' }, 'This item is fully paid.'),
          table(['Date received', 'Amount', 'Due after this', 'Method', 'Receipt', 'Status', 'Note', ''], rows, 'No payment has been recorded for this item yet.'),
          x.balancePaise > 0 ? h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => payForm(out, x) }, 'Record payment for the due')) : null);
      } catch (e) { out.replaceChildren(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: draw }, '← Back')), h('p', { class: 'err' }, failText(e))); }
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
    const batchSel = () => { const s = sel('batchId', bl.map((b) => ({ value: b.id, label: b.name })), state.batchId); s.addEventListener('change', () => { state.batchId = s.value; state.studentId = ''; draw(); }); return s; };
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
      const roster = (await api('tuitionAttendanceGet', { batchId: state.batchId, date: today() })).items;
      const pick = sel('studentId', roster.map((x) => ({ value: x.studentId, label: x.name })), state.studentId || '', 'All students'); pick.addEventListener('change', () => { state.studentId = pick.value; draw(); });
      const r = await api('tuitionAttendanceHistory', { batchId: state.batchId, studentId: state.studentId || '', from: state.from, to: state.to });
      const apply = () => { if (from.value && to.value) { state.from = from.value; state.to = to.value; draw(); } };
      out.replaceChildren(h('div', { class: 'toolbar' }, batchSel(), pick, h('label', {}, 'From', from), h('label', {}, 'To', to), h('button', { type: 'button', onclick: apply }, 'Show'), h('b', {}, r.days + ' class days')),
        state.studentId ? table(['Date', 'Status'], r.items.map((x) => h('tr', {}, h('td', {}, dmy(x.date)), h('td', {}, h('span', { class: 'pill ' + (x.status === 'present' ? 'active' : x.status === 'absent' ? 'overdue' : 'unpaid') }, x.status)))), 'No attendance was marked for this student in this period.') : null,
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
  // The whole workspace (profile, academic setup, fees, branding, account, privacy) lives in academic-ui.mjs.
  function settings() { mountSettings({ inst, profile, api, h, body, go, say, failText, fieldErrors, showErrors, field, inp, sel, brandingMount: args.brandingMount }); }

  const screens = isTeacher ? { Batches: batches, Attendance: attendance } : { Dashboard: dashboard, Students: () => students(false), Batches: batches, Fees: fees, Attendance: attendance, Reports: reports, Settings: settings };
  if (section === 'Students+add') { students(true); return true; }
  if (!screens[section]) return false;
  screens[section](); return true;
}
