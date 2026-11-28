// Coaching centre screens (Phase 3): teachers, subjects, timetable, examinations, announcements, teacher home, batch fee and attendance reports, logo.
// Records are read and written through server functions only; a teacher is limited by the server to the batches assigned to them.
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const money = (p) => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number(p || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const dmy = (s) => (s ? s.split('-').reverse().join('-') : '');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const ALL_SUBJECTS = ['English', 'Bengali', 'Hindi', 'Sanskrit', 'Mathematics', 'Science', 'Physical Science', 'Life Science', 'Environmental Studies', 'Social Science', 'History', 'Geography', 'Civics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Accountancy', 'Commerce', 'Economics', 'Reasoning', 'General Knowledge', 'Spoken English', 'Handwriting', 'Drawing', 'Art', 'Music', 'Dance'];

import { paintTeacherCard } from './teacher-card.mjs?v=tcd-1';

// A one-page PDF that holds one JPEG picture (made in the browser, nothing is sent anywhere).
export function pdfFromJpeg(jpeg, w, h, pageW = 595.28, pageH = 841.89) {
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; put(n + ' 0 obj\n'); put(body); put('\nendobj\n'); };
  put('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  offs[4] = len; put('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'); put(jpeg); put('\nendstream\nendobj\n');
  const cs = 'q ' + pageW + ' 0 0 ' + pageH + ' 0 0 cm /Im0 Do Q'; obj(5, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
  const xref = len; let x = 'xref\n0 6\n0000000000 65535 f \n'; for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  put(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  const out = new Uint8Array(len); let p = 0; for (const b of parts) { out.set(b, p); p += b.length; } return out;
}

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
      box.replaceChildren(h('div', { class: 'tabs' }, [['list', 'Teachers'], ['classes', 'Assign to classes'], ['assign', 'Assign to batches']].map(([k, l]) => h('button', { type: 'button', ...(st.tab === k ? { 'aria-current': 'true' } : {}), onclick: () => { st.tab = k; draw(); } }, l))), loading());
      try { const [t, b] = await Promise.all([api('coachingTeacherList'), batchesFull()]); const out = st.tab === 'list' ? list(t.items) : st.tab === 'classes' ? assignClasses(t.items) : assign(t.items, b); box.replaceChildren(box.firstChild, out); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, failText(e))); }
    };
    const batchesFull = async () => (await api('tuitionBatchList')).items.filter((b) => b.status === 'active');
    const list = (items) => h('div', {}, h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => form(null) }, 'Add teacher')),
      h('p', { class: 'hint' }, 'A teacher logs in at azizschoolmanagementsystem.com/coaching with the email you enter here: "Teacher? Create your login".'),
      table(['Name', 'Email', 'Mobile', 'Qualification', 'Subjects', 'Classes', 'Batches', 'Status', ''], items.map((t) => h('tr', {}, h('td', {}, t.name), h('td', {}, t.email), h('td', {}, t.mobile || ''), h('td', {}, [t.highestQualification ? t.highestQualification + (t.qualificationSubject ? ' in ' + t.qualificationSubject : '') : '', t.bed ? 'B.Ed' : '', t.deled ? 'D.El.Ed' : ''].filter(Boolean).join(', ') || '-'), h('td', {}, t.subjects.length > 4 ? t.subjects.length + ' subjects' : t.subjects.join(', ')), h('td', {}, (t.classes || []).join(', ') || '-'), h('td', {}, t.batches.map((x) => x.name).join(', ') || '-'),
        h('td', {}, t.status === 'invited' ? 'Invited' : t.status === 'active' ? 'Active' : 'Switched off'),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => form(t) }, 'Edit'), h('button', { type: 'button', onclick: () => downloadPdf(t) }, 'PDF'), h('button', { type: 'button', onclick: () => openCard(t) }, 'Card image'), h('button', { type: 'button', onclick: async () => { try { await api('coachingTeacherStatus', { teacherId: t.id, status: t.status === 'inactive' ? 'active' : 'inactive' }); draw(); } catch (e) { window.alert(failText(e)); } } }, t.status === 'inactive' ? 'Switch on' : t.status === 'invited' ? 'Cancel invite' : 'Switch off')))), 'No teachers yet. Add your first teacher.'));
    // Shrinks a chosen picture to a small square-ish JPEG so it stays well under the server limit.
    const shrink = (file) => new Promise((res, rej) => { const url = URL.createObjectURL(file); const im = new Image();
      im.onload = () => { const k = Math.min(1, 320 / Math.max(im.width, im.height)); const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
        const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', 0.85)); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture.')); }; im.src = url; });
    // Draws the teacher profile on a canvas: a printable sheet (A4, for the PDF) or a card (for the picture). The photo is placed from the top so heads are never cut off.
    const loadImg = (src) => new Promise((res) => { if (!src) { res(null); return; } const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    const paintProfile = async (t, mode) => {
      let photo = ''; if (t.hasPhoto) { try { photo = (await api('coachingTeacherPhotoGet', { teacherId: t.id })).dataUrl || ''; } catch (e) { photo = ''; } }
      const img = await loadImg(photo); const sheet = mode === 'sheet'; const W = sheet ? 1240 : 1100; const yes = (v) => (v ? 'Yes' : 'No');
      const centre = inst.name || (inst.profile && inst.profile.name) || '';
      const qual = [t.highestQualification, t.qualificationSubject ? '(' + t.qualificationSubject + ')' : ''].filter(Boolean).join(' ') || '-';
      const training = [t.deled ? 'D.El.Ed' : '', t.bed ? 'B.Ed' : '', t.med ? 'M.Ed' : '', t.tet ? 'TET / CTET' : ''].filter(Boolean).join(', ') || '-';
      const rows = sheet
        ? [['Teacher ID', t.id], ['Status', t.status === 'invited' ? 'Invited (login not created yet)' : t.status === 'active' ? 'Active' : 'Switched off'], ['Mobile', t.mobile || '-'], ['Email', t.email], ['Highest qualification', qual], ['Teaching training', training], ['Other qualifications', t.otherQualifications || '-'], ['Experience', t.experienceYears === null || t.experienceYears === undefined ? '-' : t.experienceYears + ' years'], ['Joined', dmy(t.joiningDate) || '-'], ['Subjects', (t.subjects || []).join(', ') || '-'], ['Classes', (t.classes || []).join(', ') || '-'], ['Batches', (t.batches || []).map((x) => x.name).join(', ') || '-'], ['Address', t.address || '-'], ['Notes', t.notes || '-']]
        : [['Mobile', t.mobile || '-'], ['Email', t.email], ['Qualification', qual], ['Teaching training', training], ['Subjects', (t.subjects || []).join(', ') || '-']];
      const cv = document.createElement('canvas'); cv.width = W; const g = cv.getContext('2d'); const FONT = 'Arial, Helvetica, sans-serif';
      const wrap = (text, font, maxW) => { g.font = font; const words = String(text).split(/\s+/); const lines = []; let cur = ''; for (const w of words) { const test = cur ? cur + ' ' + w : w; if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; } lines.push(cur); return lines; };
      const lh = sheet ? 44 : 40; const labelW = sheet ? 330 : 250; const padX = sheet ? 80 : 60; const valW = W - padX * 2 - labelW; const head = sheet ? 360 : 330;
      const laid = rows.map(([k, v]) => ({ k, lines: wrap(v, (sheet ? '30px ' : '28px ') + FONT, valW) })); const bodyH = laid.reduce((s, r) => s + r.lines.length * lh + 22, 0);
      const H = sheet ? 1754 : head + bodyH + 150; cv.height = H; g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#0D1424'; g.fillRect(0, 0, W, head); g.fillStyle = '#D4B367'; g.fillRect(0, head, W, 8);
      const ps = sheet ? 240 : 220; const px = padX; const py = (head - ps) / 2;
      g.save(); g.beginPath(); g.roundRect ? g.roundRect(px, py, ps, ps, 22) : g.rect(px, py, ps, ps); g.clip();
      if (img) { const k = Math.max(ps / img.width, ps / img.height); g.drawImage(img, px + (ps - img.width * k) / 2, py, img.width * k, img.height * k); }
      else { g.fillStyle = '#293346'; g.fillRect(px, py, ps, ps); g.fillStyle = '#E5C77D'; g.font = 'bold ' + Math.round(ps / 2) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((t.name || '?').trim().charAt(0).toUpperCase(), px + ps / 2, py + ps / 2); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; }
      g.restore(); g.strokeStyle = '#D4B367'; g.lineWidth = 4; g.beginPath(); g.roundRect ? g.roundRect(px, py, ps, ps, 22) : g.rect(px, py, ps, ps); g.stroke();
      const tx = px + ps + 50; const tw = W - tx - padX; g.fillStyle = '#E5C77D'; g.font = 'bold 22px ' + FONT; g.fillText('TEACHER PROFILE', tx, py + 30);
      let y = py + 90; g.fillStyle = '#F4F1E8'; for (const ln of wrap(t.name, 'bold ' + (sheet ? 52 : 46) + 'px Georgia, serif', tw)) { g.font = 'bold ' + (sheet ? 52 : 46) + 'px Georgia, serif'; g.fillText(ln, tx, y); y += sheet ? 60 : 54; }
      g.fillStyle = '#94A3B8'; g.font = '28px ' + FONT; for (const ln of wrap(centre, '28px ' + FONT, tw)) { g.fillText(ln, tx, y + 6); y += 36; }
      let yy = head + 8 + 50; g.textBaseline = 'alphabetic';
      laid.forEach((r, i) => { const h2 = r.lines.length * lh + 22; if (i % 2 === 0) { g.fillStyle = '#F7F4EC'; g.fillRect(padX - 20, yy - lh + 8, W - padX * 2 + 40, h2); }
        g.fillStyle = '#6B5A2A'; g.font = 'bold ' + (sheet ? 28 : 26) + 'px ' + FONT; g.fillText(r.k, padX, yy); g.fillStyle = '#111111'; g.font = (sheet ? 30 : 28) + 'px ' + FONT; r.lines.forEach((ln, j) => g.fillText(ln, padX + labelW, yy + j * lh)); yy += h2; });
      g.fillStyle = '#8A8A8A'; g.font = '22px ' + FONT; g.fillText('AZIZ School Management System · ' + new Date().toLocaleDateString('en-IN'), padX, H - 40);
      return cv;
    };
    const saveBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const fileBase = (t) => (t.name || 'teacher').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-profile';
    // The premium card: a preview window with PNG, JPG and PDF downloads. It is drawn in the browser from the saved teacher, the centre name and logo.
    let logoCache;
    const getLogo = async () => { if (logoCache === undefined) { try { logoCache = (await api('institutionLogoGet')).dataUrl || ''; } catch (e) { logoCache = ''; } } return logoCache; };
    const openCard = async (t) => {
      const ov = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Teacher profile card', style: 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:.8rem;overflow:auto' });
      const panel = h('div', { style: 'background:#0D1424;border:1px solid #293346;border-radius:1rem;padding:1rem;width:min(1100px,96vw);max-height:96vh;overflow:auto' });
      const status = h('p', { class: 'hint', role: 'status' }, 'Preparing the card.'); const stage = h('div', { style: 'width:100%;aspect-ratio:16/9;background:#240608;border-radius:.6rem;overflow:hidden' });
      const hi = h('input', { type: 'checkbox', id: 'card-hi' }); const cache = {}; let busy = false;
      const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); }; const onKey = (e) => { if (e.key === 'Escape') close(); };
      const data = { teacher: t, centreName: inst.name || (inst.profile && inst.profile.name) || '' };
      const make = async (scale) => { if (!cache[scale]) cache[scale] = await paintTeacherCard({ ...data, photo: data.photo, logo: data.logo, scale }); return cache[scale]; };
      const out = async (kind) => { if (busy) return; busy = true; status.textContent = 'Preparing the download.';
        try { const scale = hi.checked ? 2 : 1; const cv = await make(scale); const base = fileBase(t).replace(/-profile$/, '-card') + (scale === 2 ? '-4k' : '');
          if (kind === 'png') cv.toBlob((b) => saveBlob(b, base + '.png'), 'image/png');
          else if (kind === 'jpg') cv.toBlob((b) => saveBlob(b, base + '.jpg'), 'image/jpeg', 0.95);
          else { const url = cv.toDataURL('image/jpeg', 0.95); const bin = atob(url.split(',')[1]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); saveBlob(new Blob([pdfFromJpeg(bytes, cv.width, cv.height, 841.89, 473.56)], { type: 'application/pdf' }), base + '.pdf'); }
          status.textContent = 'Downloaded.'; } catch (e) { status.textContent = 'Could not make the file. Try again.'; } busy = false; };
      const btn = (label, fn, gold) => h('button', { type: 'button', ...(gold ? { class: 'gold' } : {}), onclick: fn }, label);
      panel.append(h('h2', { style: 'margin:.2rem 0 .6rem' }, 'Teacher profile card'), stage, status,
        h('div', { class: 'actions', style: 'flex-wrap:wrap;align-items:center' }, btn('Download PNG', () => out('png'), true), btn('Download JPG', () => out('jpg')), btn('Download PDF', () => out('pdf')), h('label', { class: 'chk', for: 'card-hi' }, hi, 'High resolution (3840 × 2160)'), btn('Close preview', close)));
      ov.append(panel); ov.addEventListener('click', (e) => { if (e.target === ov) close(); }); document.addEventListener('keydown', onKey); document.body.append(ov);
      try { const [ph, lg] = await Promise.all([t.hasPhoto ? api('coachingTeacherPhotoGet', { teacherId: t.id }).then((r) => r.dataUrl || '').catch(() => '') : '', getLogo()]); data.photo = ph; data.logo = lg;
        const cv = await make(1); cv.style.width = '100%'; cv.style.height = 'auto'; cv.style.display = 'block'; stage.replaceChildren(cv); status.textContent = 'This is how the card will look. Choose a format to download.'; }
      catch (e) { status.textContent = 'Could not make the card. Close this window and try again.'; }
    };
    const downloadPdf = async (t) => { try { const cv = await paintProfile(t, 'sheet'); const url = cv.toDataURL('image/jpeg', 0.92); const bin = atob(url.split(',')[1]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      saveBlob(new Blob([pdfFromJpeg(bytes, cv.width, cv.height)], { type: 'application/pdf' }), fileBase(t) + '.pdf'); } catch (e) { window.alert('Could not make the PDF. Try again.'); } };
    const form = (t) => {
      const photoFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Teacher photo' }); const photoPrev = h('div', {});
      const showPhoto = (u) => photoPrev.replaceChildren(u ? h('img', { src: u, alt: 'Teacher photo', style: 'width:96px;height:120px;object-fit:cover;object-position:center top;border-radius:.5rem;border:1px solid #293346' }) : h('p', { class: 'hint' }, 'No photo yet.'));
      showPhoto(''); if (t && t.hasPhoto) api('coachingTeacherPhotoGet', { teacherId: t.id }).then((r) => showPhoto(r.dataUrl)).catch(() => {});
      photoFile.addEventListener('change', async () => { const p = photoFile.files && photoFile.files[0]; if (p) { try { showPhoto(await shrink(p)); } catch (e) { showPhoto(''); window.alert(failText(e)); } } });
      const chk = (name, label, on) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name, value: 'yes', checked: on ? true : undefined }), label);
      const f = h('form', { class: 'formcard', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); const fd = new FormData(f); const msg = f.querySelector('.msg'); say(msg, 'Saving.');
        const values = { name: fd.get('name'), email: fd.get('email'), mobile: fd.get('mobile'), notes: fd.get('notes'), highestQualification: fd.get('highestQualification'), qualificationSubject: fd.get('qualificationSubject'), otherQualifications: fd.get('otherQualifications'), address: fd.get('address'), experienceYears: fd.get('experienceYears'), joiningDate: fd.get('joiningDate'),
          deled: fd.get('deled') === 'yes', bed: fd.get('bed') === 'yes', med: fd.get('med') === 'yes', tet: fd.get('tet') === 'yes', subjects: [...fd.getAll('subjects[]'), ...String(fd.get('subjectsOther') || '').split(',')].map((x) => x.trim()).filter(Boolean) };
        try { const saved = await api('coachingTeacherSave', { teacherId: t ? t.id : '', values }); const pick = photoFile.files && photoFile.files[0];
          if (pick) { try { await api('coachingTeacherPhotoSave', { teacherId: saved.teacherId, dataUrl: await shrink(pick) }); } catch (pe) { window.alert('The teacher was saved, but the photo was not: ' + failText(pe)); } }
          draw(); } catch (er) { showErrors(f, fieldErrors(er)); say(msg, failText(er)); } } },
        h('h2', {}, t ? 'Edit teacher' : 'Add teacher'),
        field('Teacher name', inp('name', 'text', t?.name, { maxlength: 80 }), 'name'),
        field('Login email', inp('email', 'email', t?.email, { maxlength: 120, ...(t ? { disabled: true } : {}) }), 'email'),
        field('Mobile (optional)', inp('mobile', 'tel', t?.mobile), 'mobile'),
        h('h3', {}, 'Profile photo'), photoPrev, photoFile, h('p', { class: 'hint' }, 'PNG, JPEG or WebP. It is made small automatically.'),
        t && t.hasPhoto ? h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async () => { try { await api('coachingTeacherPhotoSave', { teacherId: t.id, remove: true }); t.hasPhoto = false; showPhoto(''); } catch (er) { window.alert(failText(er)); } } }, 'Remove photo')) : null,
        h('h3', {}, 'Qualifications'),
        field('Highest qualification', qualBox(t?.highestQualification || ''), 'highestQualification'),
        field('Subject of higher education (optional)', inp('qualificationSubject', 'text', t?.qualificationSubject, { maxlength: 80, placeholder: 'The subject studied, for example Physics, Bengali, Mathematics' }), 'qualificationSubject'),
        h('fieldset', {}, h('legend', {}, 'Teaching training'), h('div', { class: 'checks' }, chk('deled', 'D.El.Ed', t?.deled), chk('bed', 'B.Ed', t?.bed), chk('med', 'M.Ed', t?.med), chk('tet', 'TET / CTET passed', t?.tet))),
        field('Other qualifications or courses (optional)', inp('otherQualifications', 'text', t?.otherQualifications, { maxlength: 150 }), 'otherQualifications'),
        field('Teaching experience in years (optional)', inp('experienceYears', 'number', t?.experienceYears ?? '', { min: '0', max: '60', step: '1' }), 'experienceYears'),
        field('Joining date at your centre (optional)', inp('joiningDate', 'date', t?.joiningDate || '', { max: '9999-12-31' }), 'joiningDate'),
        field('Address (optional)', inp('address', 'text', t?.address, { maxlength: 200 }), 'address'),
        h('fieldset', { 'data-field': 'subjects' }, h('legend', {}, 'Subjects this teacher teaches'), h('div', { class: 'checks' }, [...new Set([...ALL_SUBJECTS, ...(t?.subjects || [])])].map((o) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'subjects[]', value: o, checked: (t?.subjects || []).includes(o) ? true : undefined }), o))),
          h('input', { type: 'text', name: 'subjectsOther', maxlength: 120, placeholder: 'Other subjects, separated by commas', 'aria-label': 'Other subjects' }), h('span', { class: 'ferr', 'data-err': 'subjects' })),
        field('Notes (optional)', inp('notes', 'text', t?.notes, { maxlength: 200 }), 'notes'),
        h('p', { class: 'msg err', role: 'alert' }), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save teacher'), t ? h('button', { type: 'button', onclick: () => downloadPdf(t) }, 'Download PDF') : null, t ? h('button', { type: 'button', onclick: () => openCard(t) }, 'Card image') : null, h('button', { type: 'button', onclick: draw }, 'Cancel')));
      box.replaceChildren(f);
    };
    const assignClasses = (teachersList) => {
      const classes = (inst.profile && inst.profile.classes) || []; const usable = teachersList.filter((t) => t.status !== 'inactive');
      const how = h('details', { class: 'formcard', open: 'open' }, h('summary', {}, h('b', {}, 'How to assign teachers to classes')),
        h('ol', {}, h('li', {}, 'Add your teachers first in the Teachers tab. A teacher who is switched off cannot be chosen.'),
          h('li', {}, 'Find the class below, for example Class 7, and tick every teacher who teaches that class.'),
          h('li', {}, 'Press Save on that class. Each class is saved on its own.'),
          h('li', {}, 'The teacher now sees every batch of that class, its students and its attendance, and the class shows against their name in the Teachers list.'),
          h('li', {}, 'To remove a teacher from a class, untick the name and press Save again.')),
        h('p', { class: 'hint' }, 'You can also assign a teacher to one batch only, using the Assign to batches tab. A teacher sees a batch if either way includes it. Your classes come from Settings → Academic Setup → Classes offered.'));
      if (!classes.length) return h('div', {}, how, h('p', { class: 'empty' }, 'Choose your classes first in Settings → Academic Setup.'));
      if (!usable.length) return h('div', {}, how, h('p', { class: 'empty' }, 'Add a teacher first.'));
      return h('div', {}, how, ...classes.map((cls) => {
        const f = h('form', { class: 'formcard', onsubmit: async (e) => { e.preventDefault(); const msg = f.querySelector('.msg'); say(msg, 'Saving.'); try { await api('coachingAssignClasses', { className: cls, teacherIds: new FormData(f).getAll('t') }); say(msg, 'Saved.', true); } catch (er) { say(msg, failText(er)); } } },
          h('h3', {}, cls), h('div', { class: 'checks' }, usable.map((t) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 't', value: t.id, checked: (t.classes || []).includes(cls) ? true : undefined }), t.name))),
          h('p', { class: 'msg err', role: 'status' }), h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save')));
        return f; }));
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
