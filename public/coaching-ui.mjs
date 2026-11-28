// Coaching centre screens (Phase 3): teachers, subjects, timetable, examinations, announcements, teacher home, batch fee and attendance reports, logo.
// Records are read and written through server functions only; a teacher is limited by the server to the batches assigned to them.
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const money = (p) => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number(p || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const dmy = (s) => (s ? s.split('-').reverse().join('-') : '');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const ALL_SUBJECTS = ['English', 'Bengali', 'Hindi', 'Sanskrit', 'Mathematics', 'Science', 'Physical Science', 'Life Science', 'Environmental Studies', 'Social Science', 'History', 'Geography', 'Civics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Accountancy', 'Commerce', 'Economics', 'Reasoning', 'General Knowledge', 'Spoken English', 'Handwriting', 'Drawing', 'Art', 'Music', 'Dance'];

export function mountCoaching({ section, inst, call, h, body, go }) {
  const tenantId = inst.tenantId; const isTeacher = inst.role === 'teacher';
  const api = (name, data) => call(name, { tenantId, ...(data || {}) });
  const say = (el, text, ok) => { el.textContent = text; el.style.color = ok ? '#8fe0a5' : ''; };
  const failText = (e) => (e && e.message && !/^internal$/i.test(e.message) ? e.message.replace(/^.*?: /, '') : 'Something went wrong. Check the internet and try again.');
  const fieldErrors = (e) => (e && e.details && e.details.errors) || {};
  const loading = () => h('p', { class: 'empty' }, 'Loading.');
  const field = (label, input, key) => h('label', { 'data-field': key }, label, input, h('span', { class: 'ferr', 'data-err': key }));
  const inp = (name, type = 'text', value = '', extra = {}) => h('input', { name, type, value: value ?? '', ...extra });
  const sel = (name, options, value = '', blank = '') => h('select', { name }, blank ? h('option', { value: '' }, blank) : null, options.map((o) => h('option', { value: o.value, selected: o.value === value ? true : undefined }, o.label)));
  const showErrors = (form, errs) => { form.querySelectorAll('[data-err]').forEach((n) => { n.textContent = errs[n.dataset.err] || ''; }); };
  const table = (head, rows, empty) => (rows.length ? h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : h('p', { class: 'empty' }, empty));
  const card = (label, value) => h('div', { class: 'card' }, h('small', {}, label), h('b', {}, value));
  const notices = (items) => (items.length ? items.map((n) => h('div', { class: 'card', style: 'margin:.5rem 0;text-align:left' }, h('b', {}, (n.pinned ? '📌 ' : '') + n.title), h('p', { style: 'white-space:pre-wrap;margin:.3rem 0' }, n.body), h('small', {}, new Date(n.createdAt + 330 * 60000).toISOString().slice(0, 10).split('-').reverse().join('-')))) : [h('p', { class: 'empty' }, 'No announcements yet.')]);
  const batchOptions = async () => (await api('tuitionBatchList')).items.filter((b) => b.status === 'active').map((b) => ({ value: b.id, label: b.name }));

  // ---------- Teacher home ----------
  async function teacherHome() {
    const box = h('div', {}, loading()); body.append(box);
    try {
      const d = await api('coachingTeacherHome');
      box.replaceChildren(h('p', { style: 'color:var(--mut)' }, 'Today, ' + dmy(d.today)),
        h('div', { class: 'grid' }, card('My batches', String(d.batches.length)), card('My students', String(d.batches.reduce((t, b) => t + b.students, 0))), card('Classes today', String(d.classesToday.length))),
        h('h2', {}, 'Today\'s classes'), table(['Time', 'Batch', 'Subject', 'Room'], d.classesToday.map((c) => h('tr', {}, h('td', {}, c.startTime + ' – ' + c.endTime), h('td', {}, c.batchName), h('td', {}, c.subject || ''), h('td', {}, c.room || ''))), 'No classes today.'),
        h('h2', {}, 'My batches'), table(['Batch', 'Class', 'Students'], d.batches.map((b) => h('tr', {}, h('td', {}, b.name), h('td', {}, b.className), h('td', {}, String(b.students)))), 'No batch is assigned to you yet. Ask the centre owner.'),
        h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => go('Attendance') }, 'Mark attendance')),
        h('h2', {}, 'Announcements'), ...notices(d.notices));
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); }
  }

  // ---------- Teachers ----------
  async function teachers() {
    const box = h('div', {}, loading()); body.append(box); const st = { tab: 'list' };
    const draw = async () => {
      box.replaceChildren(h('div', { class: 'tabs' }, [['list', 'Teachers'], ['assign', 'Assign to batches']].map(([k, l]) => h('button', { type: 'button', ...(st.tab === k ? { 'aria-current': 'true' } : {}), onclick: () => { st.tab = k; draw(); } }, l))), loading());
      try { const [t, b] = await Promise.all([api('coachingTeacherList'), batchesFull()]); const out = st.tab === 'list' ? list(t.items) : assign(t.items, b); box.replaceChildren(box.firstChild, out); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    const batchesFull = async () => (await api('tuitionBatchList')).items.filter((b) => b.status === 'active');
    const list = (items) => h('div', {}, h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add teacher')),
      h('p', { class: 'hint' }, 'A teacher logs in at azizschoolmanagementsystem.com/coaching with the email you enter here: "Teacher? Create your login".'),
      table(['Name', 'Email', 'Mobile', 'Subjects', 'Batches', 'Status', ''], items.map((t) => h('tr', {}, h('td', {}, t.name), h('td', {}, t.email), h('td', {}, t.mobile || ''), h('td', {}, t.subjects.length > 4 ? t.subjects.length + ' subjects' : t.subjects.join(', ')), h('td', {}, t.batches.map((x) => x.name).join(', ') || '-'),
        h('td', {}, t.status === 'invited' ? 'Invited' : t.status === 'active' ? 'Active' : 'Switched off'),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(t) }, 'Edit'), h('button', { type: 'button', onclick: async () => { try { await api('coachingTeacherStatus', { teacherId: t.id, status: t.status === 'inactive' ? 'active' : 'inactive' }); draw(); } catch (e) { window.alert(failText(e)); } } }, t.status === 'inactive' ? 'Switch on' : t.status === 'invited' ? 'Cancel invite' : 'Switch off')))), 'No teachers yet. Add your first teacher.'));
    const form = (t) => {
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        const values = { name: fd.get('name'), email: fd.get('email'), mobile: fd.get('mobile'), notes: fd.get('notes'), subjects: [...fd.getAll('subjects[]'), ...String(fd.get('subjectsOther') || '').split(',')].map((x) => x.trim()).filter(Boolean) };
        try { await api('coachingTeacherSave', { teacherId: t ? t.id : '', values }); draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, t ? 'Edit teacher' : 'Add teacher'),
        field('Teacher name', inp('name', 'text', t?.name, { maxlength: 80 }), 'name'),
        field('Login email', inp('email', 'email', t?.email, { maxlength: 120, ...(t ? { disabled: true } : {}) }), 'email'),
        field('Mobile (optional)', inp('mobile', 'tel', t?.mobile), 'mobile'),
        h('fieldset', { 'data-field': 'subjects' }, h('legend', {}, 'Subjects this teacher teaches'), h('div', { class: 'checks' }, [...new Set([...ALL_SUBJECTS, ...(t?.subjects || [])])].map((o) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'subjects[]', value: o, checked: (t?.subjects || []).includes(o) ? true : undefined }), o))),
          h('input', { type: 'text', name: 'subjectsOther', maxlength: 120, placeholder: 'Other subjects, separated by commas', 'aria-label': 'Other subjects' }), h('span', { class: 'ferr', 'data-err': 'subjects' })),
        field('Notes (optional)', inp('notes', 'text', t?.notes, { maxlength: 200 }), 'notes'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save teacher'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    const assign = (teachersList, batchList) => {
      const usable = teachersList.filter((t) => t.status !== 'inactive');
      if (!batchList.length) return h('p', { class: 'empty' }, 'Create a batch first (Batches).');
      if (!usable.length) return h('p', { class: 'empty' }, 'Add a teacher first.');
      return h('div', {}, h('p', { class: 'hint' }, 'Tick the teachers for each batch. A teacher sees only the batches ticked here.'), ...batchList.map((b) => {
        const f = h('form', { class: 'formcard', onsubmit: async (e) => { e.preventDefault(); const msg = f.querySelector('.msg'); say(msg, 'Saving.'); try { await api('coachingAssign', { batchId: b.id, teacherIds: new FormData(f).getAll('t') }); say(msg, 'Saved.', true); } catch (er) { say(msg, failText(er)); } } },
          h('h3', {}, b.name + ' · ' + b.className), h('div', { class: 'checks' }, usable.map((t) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 't', value: t.id, checked: (b.teacherIds || []).includes(t.id) ? true : undefined }), t.name))),
          h('p', { class: 'msg err', role: 'status' }), h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save')));
        return f; }));
    };
    draw();
  }

  // ---------- Subjects ----------
  async function subjects() {
    const box = h('div', {}, loading()); body.append(box);
    const draw = async () => {
      let items; try { items = (await api('coachingSubjectList')).items; } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
      box.replaceChildren(h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add subject')),
        h('p', { class: 'hint' }, 'Your centre\'s own subject list, used in the timetable and examinations.'),
        table(['Subject', 'Code', 'Status', ''], items.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, s.code), h('td', {}, s.status === 'active' ? 'Active' : 'Archived'),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(s) }, 'Rename'), h('button', { type: 'button', onclick: async () => { try { await api('coachingSubjectArchive', { subjectId: s.id, restore: s.status !== 'active' }); draw(); } catch (e) { window.alert(failText(e)); } } }, s.status === 'active' ? 'Archive' : 'Restore')))), 'No subjects yet. Add your first subject.'));
    };
    const form = (s) => {
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        try { await api('coachingSubjectSave', { subjectId: s ? s.id : '', values: { name: fd.get('name'), code: fd.get('code') } }); draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, s ? 'Rename subject' : 'Add subject'), field('Subject name', inp('name', 'text', s?.name, { maxlength: 40 }), 'name'), field('Short code (optional)', inp('code', 'text', s?.code, { maxlength: 10 }), 'code'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    draw();
  }

  // ---------- Timetable ----------
  async function timetable() {
    const box = h('div', {}, loading()); body.append(box);
    const draw = async () => {
      let items; try { items = (await api('coachingSessionList')).items; } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
      const byDay = DAYS.map((d) => [d, items.filter((x) => x.weekday === d)]).filter(([, l]) => l.length);
      box.replaceChildren(isTeacher ? h('p', { class: 'hint' }, 'Your weekly classes.') : h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add class')),
        ...(byDay.length ? byDay.map(([d, l]) => h('div', {}, h('h2', {}, DAY_NAME[d]), table(['Time', 'Batch', 'Teacher', 'Subject', 'Room', ...(isTeacher ? [] : [''])], l.map((x) => h('tr', {}, h('td', {}, x.startTime + ' – ' + x.endTime), h('td', {}, x.batchName), h('td', {}, x.teacherName), h('td', {}, x.subject || ''), h('td', {}, x.room || ''),
          isTeacher ? null : h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(x) }, 'Edit'), h('button', { type: 'button', onclick: async () => { if (!window.confirm('Delete this class from the timetable?')) return; try { await api('coachingSessionDelete', { sessionId: x.id }); draw(); } catch (e) { window.alert(failText(e)); } } }, 'Delete')))), ''))) : [h('p', { class: 'empty' }, isTeacher ? 'No classes are scheduled for you yet.' : 'No classes yet. Add the first class.')]));
    };
    const form = async (x) => {
      let bo, to; try { [bo, to] = await Promise.all([batchOptions(), api('coachingTeacherList')]); } catch (e) { window.alert(failText(e)); return; }
      const tOpts = to.items.filter((t) => t.status !== 'inactive').map((t) => ({ value: t.id, label: t.name }));
      if (!bo.length || !tOpts.length) { window.alert('Add at least one batch and one teacher first.'); return; }
      const f = h('form', { class: 'formcard', novalidate: true });
      const save = async (force) => { const fd = new FormData(f); const msg = f.querySelector('.msg'); const warn = f.querySelector('.warn'); warn.replaceChildren(); say(msg, 'Saving.');
        try { const r = await api('coachingSessionSave', { sessionId: x ? x.id : '', force, values: Object.fromEntries(fd.entries()) });
          if (r.saved) { draw(); return; }
          say(msg, '');
          warn.replaceChildren(h('p', { class: 'err' }, 'Clash: ' + r.conflicts.map((c) => (c.type === 'teacher' ? 'this teacher already has a class' : 'this room is already in use') + ' from ' + c.startTime + ' to ' + c.endTime).join('; ') + '.'), h('button', { type: 'button', onclick: () => save(true) }, 'Save anyway'));
        } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } };
      f.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
      f.append(h('h2', {}, x ? 'Edit class' : 'Add class'),
        field('Batch', sel('batchId', bo, x?.batchId, 'Choose a batch'), 'batchId'), field('Teacher', sel('teacherId', tOpts, x?.teacherId, 'Choose a teacher'), 'teacherId'),
        field('Day', sel('weekday', DAYS.map((d) => ({ value: d, label: DAY_NAME[d] })), x?.weekday, 'Choose a day'), 'weekday'),
        h('div', { class: 'two' }, field('Starts', inp('startTime', 'time', x?.startTime), 'startTime'), field('Ends', inp('endTime', 'time', x?.endTime), 'endTime')),
        field('Subject (optional)', inp('subject', 'text', x?.subject, { maxlength: 40 }), 'subject'), field('Room (optional)', inp('room', 'text', x?.room, { maxlength: 30 }), 'room'),
        h('div', { class: 'warn' }), h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save class'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    draw();
  }

  // ---------- Examinations ----------
  async function exams() {
    const box = h('div', {}, loading()); body.append(box);
    const draw = async () => {
      let items; try { items = (await api('coachingExamList')).items; } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
      box.replaceChildren(h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add exam')),
        table(['Exam', 'Batch', 'Subject', 'Date', 'Max marks', 'Marks', ''], items.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.batchName), h('td', {}, x.subject || ''), h('td', {}, dmy(x.date)), h('td', {}, String(x.maxMarks)), h('td', {}, x.marksEntered ? 'Entered' : 'Not yet'),
          h('td', { class: 'row-actions' }, h('button', { class: 'gold', type: 'button', onclick: () => marks(x) }, 'Marks'), h('button', { type: 'button', onclick: () => form(x) }, 'Edit')))), 'No exams yet. Add your first exam.'));
    };
    const form = async (x) => {
      let bo; try { bo = await batchOptions(); } catch (e) { window.alert(failText(e)); return; }
      if (!bo.length) { window.alert(isTeacher ? 'No batch is assigned to you yet.' : 'Create a batch first.'); return; }
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        try { await api('coachingExamSave', { examId: x ? x.id : '', values: Object.fromEntries(fd.entries()) }); draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, x ? 'Edit exam' : 'Add exam'), field('Exam name', inp('name', 'text', x?.name, { maxlength: 80, placeholder: 'Unit test 1' }), 'name'),
        field('Batch', x ? h('select', { name: 'batchId' }, h('option', { value: x.batchId }, x.batchName)) : sel('batchId', bo, '', 'Choose a batch'), 'batchId'),
        field('Subject (optional)', inp('subject', 'text', x?.subject, { maxlength: 40 }), 'subject'), field('Exam date', inp('date', 'date', x?.date || today()), 'date'),
        field('Maximum marks', inp('maxMarks', 'number', x?.maxMarks ?? 100, { min: 1, max: 1000 }), 'maxMarks'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save exam'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    const marks = async (x) => {
      box.replaceChildren(loading());
      let d; try { d = await api('coachingMarksGet', { examId: x.id }); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e)), h('button', { type: 'button', onclick: draw }, 'Back')); return; }
      const f = h('form', { class: 'formcard', onsubmit: async (e) => { e.preventDefault(); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        const entries = d.items.map((s) => ({ studentId: s.studentId, marks: f.querySelector('[data-s="' + s.studentId + '"]').value }));
        try { const r = await api('coachingMarksSave', { examId: x.id, entries }); say(msg, 'Saved marks for ' + r.saved + ' students.', true); } catch (er) { say(msg, failText(er)); } } },
        h('h2', {}, d.exam.name + ' · ' + (d.exam.subject || 'Marks')), h('p', { class: 'hint' }, 'Maximum ' + d.exam.maxMarks + ' · ' + dmy(d.exam.date) + '. Leave a box empty for an absent student.'),
        d.summary.average !== null ? h('p', { class: 'hint' }, 'Highest ' + d.summary.highest + ' · Average ' + d.summary.average + ' · Absent ' + d.summary.absent) : null,
        d.items.length ? table(['Student', 'Marks'], d.items.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, h('input', { type: 'text', inputmode: 'decimal', 'data-s': s.studentId, value: s.marks === null ? '' : String(s.marks), 'aria-label': 'Marks for ' + s.name, style: 'max-width:7rem' })))), '') : h('p', { class: 'empty' }, 'No active students are in this batch yet.'),
        h('p', { class: 'msg err', role: 'status' }), h('div', { class: 'actions' }, d.items.length ? h('button', { class: 'gold', type: 'submit' }, 'Save marks') : null, h('button', { type: 'button', onclick: draw }, 'Back')));
      box.replaceChildren(f);
    };
    draw();
  }

  // ---------- Announcements ----------
  async function announcements() {
    const box = h('div', {}, loading()); body.append(box);
    const draw = async () => {
      let items; try { items = (await api('coachingNoticeList')).items; } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); return; }
      box.replaceChildren(...(isTeacher ? [] : [h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'New announcement'))]),
        ...items.map((n) => h('div', { class: 'card', style: 'margin:.5rem 0;text-align:left' }, h('b', {}, (n.pinned ? '📌 ' : '') + n.title), h('p', { style: 'white-space:pre-wrap;margin:.3rem 0' }, n.body), h('small', {}, dmy(new Date(n.createdAt + 330 * 60000).toISOString().slice(0, 10))),
          isTeacher ? null : h('div', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(n) }, 'Edit'), h('button', { type: 'button', onclick: async () => { if (!window.confirm('Delete this announcement?')) return; try { await api('coachingNoticeDelete', { noticeId: n.id }); draw(); } catch (e) { window.alert(failText(e)); } } }, 'Delete')))),
        ...(items.length ? [] : [h('p', { class: 'empty' }, 'No announcements yet.')]));
    };
    const form = (n) => {
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        try { await api('coachingNoticeSave', { noticeId: n ? n.id : '', values: { title: fd.get('title'), body: fd.get('body'), pinned: fd.get('pinned') === 'on' } }); draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, n ? 'Edit announcement' : 'New announcement'), field('Title', inp('title', 'text', n?.title, { maxlength: 100 }), 'title'),
        field('Message', h('textarea', { name: 'body', rows: 5, maxlength: 1000 }, n?.body || ''), 'body'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'pinned', checked: n?.pinned ? true : undefined }), 'Pin to the top'),
        h('p', { class: 'hint' }, 'Teachers of your centre can read announcements here.'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Publish'), h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    draw();
  }

  const screens = isTeacher ? { Dashboard: teacherHome, Timetable: timetable, Examinations: exams, Announcements: announcements }
    : { Teachers: teachers, Subjects: subjects, Timetable: timetable, Examinations: exams, Announcements: announcements };
  if (!screens[section]) return false;
  screens[section](); return true;
}

// Extra blocks added under the shared Fees, Reports and Settings screens of a coaching centre (owner only).
export function coachingExtras({ section, inst, call, h, body }) {
  if (inst.role === 'teacher') return;
  const tenantId = inst.tenantId; const api = (name, data) => call(name, { tenantId, ...(data || {}) });
  const failText = (e) => (e && e.message && !/^internal$/i.test(e.message) ? e.message.replace(/^.*?: /, '') : 'Something went wrong. Check the internet and try again.');
  const table = (head, rows, empty) => (rows.length ? h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : h('p', { class: 'empty' }, empty));
  const box = h('div', {}); body.append(box);
  if (section === 'Fees') {
    const draw = async (cycle) => {
      box.replaceChildren(h('h2', {}, 'Fees by batch'), h('p', { class: 'empty' }, 'Loading.'));
      try {
        const r = await api('coachingFeesByBatch', cycle ? { cycle } : {});
        const m = h('input', { type: 'month', value: r.cycle, 'aria-label': 'Month' }); m.addEventListener('change', () => m.value && draw(m.value)); m.addEventListener('click', () => { try { m.showPicker(); } catch { /* ok */ } });
        box.replaceChildren(h('h2', {}, 'Fees by batch'), h('div', { class: 'actions' }, m),
          table(['Batch', 'Monthly fee', 'Students', 'Billed', 'Collected', 'Pending'], r.items.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.feePaise ? money(x.feePaise) : '-'), h('td', {}, String(x.students)), h('td', {}, money(x.billedPaise)), h('td', {}, money(x.collectedPaise)), h('td', {}, money(x.pendingPaise)))), 'No fee data for this month yet.'),
          h('p', { class: 'hint' }, 'Set a batch fee in Batches. New students in that batch start with it, and you can still change any student\'s fee.'));
      } catch (e) { box.replaceChildren(h('h2', {}, 'Fees by batch'), h('p', { class: 'err' }, failText(e))); }
    };
    draw();
  } else if (section === 'Reports') {
    const t = today(); const state = { from: t.slice(0, 8) + '01', to: t };
    const draw = async () => {
      const from = h('input', { type: 'date', value: state.from, max: t, 'aria-label': 'From' }); const to = h('input', { type: 'date', value: state.to, max: t, 'aria-label': 'To' });
      const out = h('div', {}, h('p', { class: 'empty' }, 'Loading.'));
      const go2 = () => { if (from.value && to.value) { state.from = from.value; state.to = to.value; draw(); } };
      [from, to].forEach((i) => { i.addEventListener('change', go2); i.addEventListener('click', () => { try { i.showPicker(); } catch { /* ok */ } }); });
      box.replaceChildren(h('h2', {}, 'Attendance by batch'), h('div', { class: 'actions' }, h('label', {}, 'From ', from), h('label', {}, 'To ', to)), out);
      try {
        const r = await api('coachingAttendanceReport', { from: state.from, to: state.to });
        out.replaceChildren(table(['Batch', 'Days', 'Present', 'Absent', 'Late', 'Excused', 'Attendance'], r.items.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, String(x.days)), h('td', {}, String(x.present)), h('td', {}, String(x.absent)), h('td', {}, String(x.late)), h('td', {}, String(x.excused)), h('td', {}, x.percent === null ? '-' : x.percent + '%'))), 'No attendance was marked in this period.'),
          ...(r.truncated ? [h('p', { class: 'err' }, 'This range has a lot of records. Choose a shorter range for exact numbers.')] : []), h('p', { class: 'hint' }, 'Attendance % counts present and late as attended.'));
      } catch (e) { out.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    draw();
  } else if (section === 'Settings') {
    const msg = h('p', { class: 'msg err', role: 'status' }); const prev = h('div', {});
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Logo file' });
    const show = (u) => prev.replaceChildren(u ? h('img', { src: u, alt: 'Centre logo', style: 'max-height:80px;max-width:200px;background:#fff;padding:.3rem;border-radius:.4rem' }) : h('p', { class: 'hint' }, 'No logo yet.'));
    api('institutionLogoGet').then((r) => show(r.dataUrl)).catch(() => show(''));
    const f = h('form', { class: 'formcard', onsubmit: async (e) => { e.preventDefault(); const pick = file.files && file.files[0];
      if (!pick) { msg.textContent = 'Choose a picture first.'; return; } if (pick.size > 100 * 1024) { msg.textContent = 'The picture must be under 100 KB. Try a smaller one.'; return; }
      const url = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.onerror = rej; rd.readAsDataURL(pick); });
      msg.textContent = 'Saving.'; try { await api('institutionLogoSave', { dataUrl: url }); show(url); msg.textContent = 'Logo saved. It now appears on your receipts.'; msg.style.color = '#8fe0a5'; } catch (er) { msg.style.color = ''; msg.textContent = failText(er); } } },
      h('h2', {}, 'Centre logo'), h('p', { class: 'hint' }, 'PNG, JPEG or WebP, under 100 KB. It is printed at the top of your fee receipts.'), prev, file, msg,
      h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save logo'), h('button', { type: 'button', onclick: async () => { try { await api('institutionLogoSave', { remove: true }); show(''); file.value = ''; msg.textContent = 'Logo removed.'; } catch (er) { msg.textContent = failText(er); } } }, 'Remove logo')));
    box.append(f);
  }
}
