// Batch 91: the Admission desk (owner, admission/office staff, principal with admissions access).
// Enquiries, admit a student with class placement and logins, reset a family password, and yearly promotion (owner only).
import { collection, doc, getDocsFromServer, getFirestore, updateDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const STAGES = ['new', 'contacted', 'interview', 'offered', 'admitted', 'rejected'];
const DOCS = [['birth', 'Birth certificate'], ['tc', 'Transfer certificate'], ['marksheet', 'Marksheet'], ['aadhaar', 'Aadhaar'], ['photos', 'Photos'], ['address', 'Address proof'], ['medical', 'Medical'], ['other', 'Other']];

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const field = (label, input) => h('p', {}, h('label', {}, label + ' ', input));
const input = (name, attrs = {}) => h('input', { name, maxlength: '120', ...attrs });
const select = (name, options) => h('select', { name }, ...options.map(([v, t]) => h('option', { value: v, text: t })));

// A printable slip. It opens inside a hidden frame so pop-up blockers do not interfere.
function printSlip(school, studentName, admissionNo, slips) {
  const rows = slips.map((s) => '<div class="b"><h3>' + esc(s.who) + ' login</h3><p>Login ID: <b>' + esc(s.loginId) + '</b></p>'
    + (s.password ? '<p>First password: <b>' + esc(s.password) + '</b></p><p class="n">You will be asked to choose a new password the first time you sign in.</p>' : '<p class="n">' + esc(s.note || '') + '</p>') + '</div>').join('');
  const html = '<!doctype html><meta charset="utf-8"><title>Login slip</title><style>body{font:15px Arial,sans-serif;margin:24px}h1{font-size:20px}.b{border:1px solid #333;border-radius:8px;padding:10px 16px;margin:14px 0}.n{color:#444;font-size:13px}</style>'
    + '<h1>' + esc(school) + '</h1><p>Student: <b>' + esc(studentName) + '</b> (admission no ' + esc(admissionNo) + ')</p>' + rows
    + '<p class="n">Sign in at the school page with the login ID above. Keep this slip safe and do not share the password.</p>';
  const frame = h('iframe', { style: 'position:fixed;width:0;height:0;border:0' });
  document.body.append(frame);
  frame.srcdoc = html;
  frame.addEventListener('load', () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); });
}
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function mountAdmissionDesk({ app, schoolId, role, schoolName, root }) {
  const call = (name, data) => httpsCallable(getFunctions(app, 'asia-south1'), name)({ schoolId, ...data }).then((r) => r.data);
  const message = (error) => (error?.message || 'Something went wrong.').replace(/^.*?: /, '');
  const status = h('p', { role: 'status' });
  const body = h('div');
  root.replaceChildren(h('summary', { text: 'Admission desk: enquiries, admit a student, logins' }), status, body);
  root.hidden = false;
  if (role === 'office') root.open = true;
  let options;
  try { options = await call('admissionOptions', {}); } catch (e) { status.textContent = message(e); return; }
  const firestore = getFirestore(app);
  const classOf = (id) => options.classes.find((c) => c.id === id);
  const sectionChoices = () => options.sections.filter((s) => classOf(s.classId)).sort((a, b) => classOf(a.classId).order - classOf(b.classId).order || a.name.localeCompare(b.name))
    .map((s) => [s.id, classOf(s.classId).name + ' - ' + s.name]);

  // ---- Admit form
  const admit = h('form', { class: 'desk-admit' });
  const sectionSelect = select('sectionId', [['', 'Choose class and section'], ...sectionChoices()]);
  const docsBox = h('p', {}, 'Documents received: ', ...DOCS.map(([k, t]) => h('label', {}, h('input', { type: 'checkbox', name: 'docs', value: k }), ' ' + t + ' ')));
  const stud = h('input', { type: 'checkbox', name: 'studentLogin', checked: '' });
  const par = h('input', { type: 'checkbox', name: 'parentLogin', checked: '' });
  let enquiryId = '';
  const result = h('div', { role: 'status' });
  const gender = select('gender', [['', 'Not stated'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']]);
  admit.append(
    h('h3', { text: 'Admit a student' }),
    field('Admission number', input('admissionNo', { maxlength: '20', required: '' })),
    field('Student name', input('name', { required: '' })),
    field('Date of birth', input('dob', { type: 'date' })),
    field('Gender', gender),
    field('Class and section', sectionSelect),
    field('Father or guardian name', input('guardianName', { required: '' })),
    field('Mother name', input('motherName')),
    field('Guardian phone', input('guardianPhone', { maxlength: '20' })),
    field('Emergency phone', input('emergencyPhone', { maxlength: '20' })),
    field('Guardian email (optional)', input('guardianEmail', { maxlength: '100' })),
    field('Address', input('address', { maxlength: '200' })),
    field('Previous school', input('previousSchool')),
    field('Transfer certificate no', input('tcNo', { maxlength: '40' })),
    docsBox,
    h('p', {}, h('label', {}, stud, ' Create the student login'), ' ', h('label', {}, par, ' Create the parent login (one login per family)')),
    h('button', { type: 'submit', text: 'Admit student' }),
    result,
  );
  admit.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = new FormData(admit);
    const data = Object.fromEntries(['admissionNo', 'name', 'dob', 'gender', 'sectionId', 'guardianName', 'motherName', 'guardianPhone', 'emergencyPhone', 'guardianEmail', 'address', 'previousSchool', 'tcNo'].map((k) => [k, String(f.get(k) ?? '')]));
    Object.assign(data, { docs: f.getAll('docs'), studentLogin: stud.checked, parentLogin: par.checked, enquiryId });
    const button = admit.querySelector('button[type=submit]');
    button.disabled = true; result.textContent = 'Admitting.';
    try {
      const r = await call('admitStudent', data);
      result.replaceChildren('Admitted. Roll number ' + r.rollNo + '. ');
      if (r.slips.length) {
        for (const s of r.slips) result.append(h('div', {}, s.who + ' login ID: ', h('b', { text: s.loginId }), s.password ? ' password: ' : '', s.password ? h('b', { text: s.password }) : (s.note || '')));
        result.append(h('p', { text: 'Write these down or print the slip now. The passwords are not stored anywhere readable and are not shown again.' }),
          h('button', { type: 'button', text: 'Print slip', onclick: () => printSlip(schoolName, data.name, data.admissionNo, r.slips) }));
      }
      admit.reset(); enquiryId = '';
      loadEnquiries();
    } catch (e) { result.textContent = message(e); } finally { button.disabled = false; }
  });

  // ---- Enquiries
  const enquiryList = h('div');
  async function loadEnquiries() {
    enquiryList.textContent = 'Loading enquiries.';
    let snap;
    try { snap = await getDocsFromServer(collection(doc(firestore, 'schools', schoolId), 'enquiries')); } catch { enquiryList.textContent = 'Enquiries are not available to you.'; return; }
    const items = snap.docs.sort((a, b) => b.data().createdAt.localeCompare(a.data().createdAt));
    enquiryList.replaceChildren(h('p', { text: items.length ? STAGES.map((s) => s + ' ' + items.filter((i) => i.data().status === s).length).join(' > ') : 'No enquiries yet.' }));
    const canEdit = role !== 'principal';
    for (const item of items.slice(0, 100)) {
      const e = item.data();
      const line = h('div', { class: 'desk-enq' }, h('p', { text: e.createdAt + ' - ' + e.studentName + ' for ' + e.classApplying + ' - guardian ' + e.guardianName + ' (' + e.phone + (e.email ? ', ' + e.email : '') + ')' + (e.message ? ' - ' + e.message : '') + ' - ' + e.status.toUpperCase() + (e.note ? ' (' + e.note + ')' : '') }));
      if (canEdit) {
        for (const stage of STAGES.filter((s) => s !== e.status && s !== 'admitted')) {
          line.append(h('button', { type: 'button', text: 'Mark ' + stage, onclick: async () => { try { await updateDoc(item.ref, { status: stage }); loadEnquiries(); } catch { status.textContent = 'Could not change the stage.'; } } }), ' ');
        }
        if (e.status !== 'admitted' && e.status !== 'rejected') {
          line.append(h('button', { type: 'button', text: 'Admit this student', onclick: () => {
            admit.reset(); enquiryId = item.id;
            admit.elements.namedItem('name').value = e.studentName;
            admit.elements.namedItem('guardianName').value = e.guardianName;
            admit.elements.namedItem('guardianPhone').value = e.phone;
            if (e.email) admit.elements.namedItem('guardianEmail').value = e.email;
            const wanted = String(e.classApplying).trim().toLowerCase();
            const match = options.sections.find((s) => { const c = (classOf(s.classId)?.name ?? '').toLowerCase(); return wanted && c && (c === wanted || wanted.includes(c) || c.includes(wanted)); });
            if (match) sectionSelect.value = match.id;
            result.textContent = 'Filled in from the enquiry. Add the admission number and check the details.';
            admit.scrollIntoView({ block: 'center' });
          } }));
        }
      }
      enquiryList.append(line);
    }
  }

  // ---- Reset a family password
  const reset = h('form', {});
  const resetOut = h('div', { role: 'status' });
  const resetNo = input('studentId', { maxlength: '20', required: '' });
  const resetRel = select('relation', [['parent', 'Parent login'], ['student', 'Student login']]);
  reset.append(h('h3', { text: 'Forgot a password? Reset it' }), field('Admission number', resetNo), field('Which login', resetRel), h('button', { type: 'submit', text: 'Reset password' }), resetOut);
  reset.addEventListener('submit', async (event) => {
    event.preventDefault(); resetOut.textContent = 'Resetting.';
    try {
      const r = await call('resetFamilyPassword', { studentId: resetNo.value, relation: resetRel.value });
      resetOut.replaceChildren('Login ID ', h('b', { text: r.loginId }), ' new password ', h('b', { text: r.password }), '. Shown once. ', h('button', { type: 'button', text: 'Print slip', onclick: () => printSlip(schoolName, '', resetNo.value, [{ who: r.relation === 'student' ? 'Student' : 'Parent', loginId: r.loginId, password: r.password }]) }));
    } catch (e) { resetOut.textContent = message(e); }
  });

  body.append(h('h3', { text: 'Admission enquiries' }), enquiryList, role === 'principal' ? h('p', { text: 'You can see the enquiries. The owner or admission staff admits students.' }) : admit, role === 'principal' ? null : reset);
  loadEnquiries();

  // ---- Promotion (owner only)
  if (role === 'owner') {
    const promo = h('form', {});
    const years = options.years.map((y) => [y.id, y.label + ' (' + y.status + ')']);
    const fromY = select('from', years); const toY = select('to', years);
    if (years.length > 1) toY.selectedIndex = years.length - 1;
    const table = h('div'); const out = h('p', { role: 'status' });
    let last = null;
    const holdBoxes = () => [...table.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    const run = async (apply) => {
      out.textContent = apply ? 'Promoting.' : 'Checking.';
      try {
        const r = await call('promoteStudents', { fromYearId: fromY.value, toYearId: toY.value, holdBack: holdBoxes(), apply });
        last = r;
        if (apply) { out.textContent = r.moved + ' students moved to the new year.'; table.replaceChildren(); return; }
        const held = new Set(holdBoxes());
        table.replaceChildren(...r.rows.map((row) => h('p', {}, row.plan !== undefined || row.to ? h('label', {}, h('input', { type: 'checkbox', value: row.studentId, ...(held.has(row.studentId) ? { checked: '' } : {}) }), ' keep in same class ') : '', row.name + ': ' + row.from + ' -> ' + (row.to || row.reason) + (row.to && row.reason ? ' (' + row.reason + ')' : ''))));
        out.textContent = r.moved + ' students will move. Tick "keep in same class" for anyone who did not pass, then press Check again. Press Promote when it looks right.';
      } catch (e) { out.textContent = message(e); }
    };
    promo.append(h('h3', { text: 'Promote students to the next class' }), h('p', { text: 'Create and open next year in Academic setup first. Each student moves to the next class, same section name. Students in the last class are not moved.' }),
      field('From year', fromY), field('To year', toY),
      h('button', { type: 'button', text: 'Check (preview)', onclick: () => run(false) }), ' ',
      h('button', { type: 'button', text: 'Promote now', onclick: () => { if (!last) { out.textContent = 'Press Check first.'; return; } if (confirm('Move these students to the new year now?')) run(true); } }), out, table);
    body.append(promo);
  }
}
