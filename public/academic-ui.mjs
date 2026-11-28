// Settings workspace and academic setup (Tuition and Coaching): centre profile, classes, subject library, class-subject mapping, curriculum templates,
// admission preferences, and the compact "assigned subjects" card used in the student form.
// Principle: configure once, reuse automatically, customise whenever necessary. Everything is kept in the institution profile that is already loaded,
// so switching classes or opening the student form needs no extra database reads, and saving is one server call that checks the signed-in owner.
export const ALL_CLASSES = ['Nursery', 'KG 1', 'KG 2', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12', 'College / Other'];
export const ALL_SUBJECTS = ['English', 'Bengali', 'Hindi', 'Sanskrit', 'Mathematics', 'Science', 'Environmental Studies', 'Social Science', 'History', 'Geography', 'Civics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Accountancy', 'Commerce', 'Economics', 'Reasoning', 'General Knowledge', 'Spoken English', 'Handwriting', 'Drawing', 'Art', 'Music', 'Dance'];
export const PREF_DEFAULTS = { autoAssign: true, allowCustomise: true, showAssigned: true, warnUnconfigured: true, autoDate: true, autoTime: false };
export const prefsOf = (profile) => ({ ...PREF_DEFAULTS, ...((profile && profile.admissionPrefs) || {}) });

// Lets the student form open Settings straight at the class-subject screen.
let pendingJump = null;
export const requestSettingsView = (v) => { pendingJump = v; };

const PATHS = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>', cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 13h2M3 10h18"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  arrow: '<path d="M9 6l6 6-6 6"/>', check: '<path d="M5 12l5 5 9-10"/>',
};
// Icons are drawn from the small path table above with createElementNS, so no markup is ever parsed from a string.
const SVG_NS = 'http://www.w3.org/2000/svg';
const icon = (name) => {
  const span = document.createElement('span'); span.className = 'ico'; span.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg'); for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  for (const m of String(PATHS[name] || '').matchAll(/<(\w+)([^>]*)\/>/g)) { const el = document.createElementNS(SVG_NS, m[1]); for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(a[1], a[2]); svg.append(el); }
  span.append(svg); return span;
};

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const uniqCi = (list) => { const out = []; for (const x of list) { const n = norm(x); if (n && !out.some((o) => same(o, n))) out.push(n); } return out; };
const newTplId = () => 'TP-' + Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');

// A modal (centred) or drawer (side) shell. Esc and the backdrop close it.
function overlay(h, title, content, { onClose, wide } = {}) {
  const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'ovl', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'drawer' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'dhead' }, h('h3', {}, title), h('button', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')), content));
  document.addEventListener('keydown', onKey); document.body.append(ov);
  const first = ov.querySelector('input,button.gold,select'); if (first) first.focus();
  return { close, el: ov };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
export function mountSettings({ inst, profile, api, h, body, go, say, failText, fieldErrors, showErrors, field, inp, sel, brandingMount }) {
  body.classList.add('wide');
  const S = { classes: [...(profile.classes || [])], subjects: [...(profile.subjects || [])], archived: [...(profile.archivedSubjects || [])], map: {},
    templates: (profile.templates || []).map((t) => ({ ...t, subjects: [...t.subjects], classes: [...(t.classes || [])] })), prefs: prefsOf(profile) };
  for (const [k, v] of Object.entries(profile.classSubjects || {})) S.map[k] = [...v];
  const view = { sec: 'profile', sub: 'overview', cls: null };
  if (pendingJump) { Object.assign(view, pendingJump); pendingJump = null; }
  let dirty = false;

  // One server call per save. The server merges it into the stored profile and checks every field again.
  const persist = async (partial) => { const r = await api('institutionProfileSave', { values: partial }); Object.assign(profile, partial); if (r && r.name) inst.name = r.name; return r; };
  const guard = (fn) => { if (dirty && !window.confirm('You have unsaved changes. Leave without saving them?')) return; dirty = false; fn(); };
  const msgBox = () => h('p', { class: 'msg err', role: 'status' });
  const ok = (m, t) => { say(m, t, true); };
  const usedBy = (subject) => Object.values(S.map).filter((l) => l.some((x) => same(x, subject))).length;
  const configuredCount = () => S.classes.filter((c) => (S.map[c] || []).length).length;
  const tile = (label, on, onclick, extra = {}) => h('button', { type: 'button', class: 'tile' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick, ...extra }, h('span', { class: 'tk' }, on ? '✓' : ''), h('span', { class: 'tl' }, label));
  const setTile = (el, on) => { el.classList.toggle('on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); el.querySelector('.tk').textContent = on ? '✓' : ''; };

  const root = h('div', { class: 'setwrap' }); const nav = h('nav', { class: 'snav', 'aria-label': 'Settings sections' }); const pane = h('div', { class: 'spane' });
  root.append(nav, pane); body.append(root);
  const SECTIONS = [['profile', 'Centre Profile', 'user'], ['academic', 'Academic Setup', 'cap'], ['fees', 'Fee Settings', 'wallet'], ['branding', 'Branding & Logo', 'image'], ['account', 'Account & Security', 'lock'], ['privacy', 'Data & Privacy', 'shield']];
  const draw = () => {
    nav.replaceChildren(...SECTIONS.map(([k, label, ic]) => h('button', { type: 'button', ...(view.sec === k ? { 'aria-current': 'page' } : {}), onclick: () => guard(() => { view.sec = k; view.sub = 'overview'; draw(); }) }, icon(ic), h('span', {}, label))));
    const secs = { profile: profileSec, academic: academicSec, fees: feesSec, branding: brandingSec, account: accountSec, privacy: privacySec };
    pane.replaceChildren(secs[view.sec]());
  };
  const head = (title, sub) => h('div', { class: 'shead' }, h('h2', {}, title), sub ? h('p', { class: 'hint' }, sub) : null);

  // ---------- A. Centre profile ----------
  function profileSec() {
    const tuition = inst.type === 'tuition';
    const f = h('form', { class: 'scard', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); const m = f.querySelector('.msg'); say(m, 'Saving.'); const values = Object.fromEntries(new FormData(f).entries());
      try { await persist(values); ok(m, 'Saved.'); } catch (er) { showErrors(f, fieldErrors(er)); say(m, failText(er)); } } },
      h('p', { class: 'hint' }, 'Registered email: ' + (profile.email || '')),
      h('div', { class: 'two' }, ...(tuition ? [field('Tuition name', inp('tuitionName', 'text', profile.tuitionName), 'tuitionName'), field('Your name', inp('fullName', 'text', profile.fullName), 'fullName')]
        : [field('Centre name', inp('centreName', 'text', profile.centreName), 'centreName'), field('Owner name', inp('ownerName', 'text', profile.ownerName), 'ownerName')])),
      h('div', { class: 'two' }, field('Mobile', inp('mobile', 'tel', profile.mobile), 'mobile'), field('Teaching mode', sel('teachingMode', ['offline', 'online', 'hybrid'], profile.teachingMode), 'teachingMode')),
      ...(tuition ? [field('Address or locality', inp('locality', 'text', profile.locality), 'locality')] : [h('div', { class: 'two' }, field('Address', inp('address', 'text', profile.address), 'address'), field('PIN code', inp('pin', 'text', profile.pin), 'pin'))]),
      msgBox(), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'submit' }, 'Save profile')));
    return h('div', {}, head('Centre profile', 'Your basic details.'), f);
  }

  // ---------- B. Academic setup ----------
  function academicSec() {
    const subs = { overview: acOverview, classes: acClasses, library: acLibrary, mapping: acMapping, templates: acTemplates, prefs: acPrefs };
    const titles = { classes: 'Classes offered', library: 'Subject library', mapping: 'Class-subject mapping', templates: 'Curriculum templates', prefs: 'Admission preferences' };
    const crumb = view.sub === 'overview' ? null : h('div', { class: 'crumb' }, h('button', { type: 'button', onclick: () => guard(() => { view.sub = 'overview'; draw(); }) }, '← Academic Setup'), h('span', {}, titles[view.sub]));
    return h('div', {}, crumb, subs[view.sub]());
  }
  const stat = (label, value) => h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, String(value)));
  function acOverview() {
    const cards = [['classes', 'Classes offered', 'Choose the classes you teach.', 'cap'], ['library', 'Subject library', 'One list of subjects for your centre.', 'book'], ['mapping', 'Class-subject mapping', 'Set the default subjects for each class.', 'grid'],
      ['templates', 'Curriculum templates', 'Save a subject combination and reuse it.', 'layers'], ['prefs', 'Admission preferences', 'How the new-student form behaves.', 'sliders']];
    return h('div', {}, head('Academic Setup', 'Configure once. New students then get the right subjects automatically.'),
      h('div', { class: 'stats' }, stat('Active classes', S.classes.length), stat('Subject library', S.subjects.length), stat('Configured classes', configuredCount() + '/' + S.classes.length), stat('Curriculum templates', S.templates.length)),
      h('div', { class: 'navcards' }, cards.map(([k, t, d, ic]) => h('button', { type: 'button', class: 'navcard', onclick: () => { view.sub = k; draw(); } }, icon(ic), h('span', { class: 'nct' }, h('b', {}, t), h('small', {}, d)), icon('arrow')))));
  }

  // Classes offered: compact tiles. Switching a class off never touches students already in it.
  function acClasses() {
    const draft = new Set(S.classes); const customs = S.classes.filter((c) => !ALL_CLASSES.includes(c)); const m = msgBox(); const count = h('span', { class: 'pill' });
    const grid = h('div', { class: 'tiles' }); const upd = () => { count.textContent = draft.size + ' selected'; };
    const add = (label) => { const t = tile(label, draft.has(label), () => { if (draft.has(label)) draft.delete(label); else if (draft.size >= 20) { say(m, 'You can offer up to 20 classes.'); return; } else draft.add(label); setTile(t, draft.has(label)); dirty = true; upd(); }); grid.append(t); };
    [...ALL_CLASSES, ...customs].forEach(add); upd();
    const cInput = h('input', { type: 'text', maxlength: 40, placeholder: 'Custom class, for example Class 9 Science', 'aria-label': 'Custom class' });
    const addCustom = () => { const n = norm(cInput.value); if (!n) return; if ([...ALL_CLASSES, ...customs].some((c) => same(c, n))) { say(m, 'That class is already in the list.'); return; } if (n.includes('/') || /^__.*__$/.test(n)) { say(m, 'That name cannot be used.'); return; }
      customs.push(n); draft.add(n); add(n); cInput.value = ''; dirty = true; upd(); say(m, ''); };
    cInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
    const save = async () => { const list = [...ALL_CLASSES.filter((c) => draft.has(c)), ...customs.filter((c) => draft.has(c))]; say(m, 'Saving.');
      try { await persist({ classes: list }); S.classes = list; dirty = false; ok(m, 'Saved. Students already in a class you switched off are not changed.'); } catch (er) { say(m, failText(er)); } };
    return h('div', {}, head('Classes offered', 'Tap the classes you teach. Only these appear in the new-student form and in the class-subject mapping.'), h('div', { class: 'scard' }, count, grid,
      h('div', { class: 'addrow' }, cInput, h('button', { type: 'button', onclick: addCustom }, 'Add class')), m, h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: save }, 'Save classes'))));
  }

  // Subject library: one central list. Tap to offer or remove; custom subjects can be renamed or archived.
  function acLibrary() {
    const offered = new Set(S.subjects); const archived = new Set(S.archived); const renames = []; const known = () => uniqCi([...ALL_SUBJECTS, ...offered, ...archived]); let query = '';
    const m = msgBox(); const grid = h('div', { class: 'tiles' }); const count = h('span', { class: 'pill' });
    const paint = () => {
      count.textContent = offered.size + ' in your library';
      grid.replaceChildren(...known().filter((s) => !query || s.toLowerCase().includes(query)).map((s) => {
        const custom = !ALL_SUBJECTS.some((x) => same(x, s)); const isArch = archived.has(s); const used = usedBy(s);
        const t = tile(s, offered.has(s), () => { if (isArch) return; if (offered.has(s)) offered.delete(s); else if (offered.size >= 60) { say(m, 'The library can hold up to 60 subjects.'); return; } else offered.add(s); dirty = true; paint(); }, isArch ? { disabled: true } : {});
        return h('div', { class: 'subcell' + (isArch ? ' arch' : '') }, t, h('small', {}, isArch ? 'Archived' : (used ? 'Used in ' + used + ' class' + (used > 1 ? 'es' : '') : 'Not used yet')),
          custom ? h('div', { class: 'mini' }, !isArch ? h('button', { type: 'button', onclick: () => { const n = norm(window.prompt('Rename subject', s) || ''); if (!n || n === s) return;
              if (known().some((x) => same(x, n) && !same(x, s))) { say(m, 'A subject with that name already exists.'); return; }
              if (n.length > 40) { say(m, 'Use 40 characters or fewer.'); return; } renames.push([s, n]); offered.delete(s); offered.add(n); dirty = true; paint(); } }, 'Rename') : null,
            h('button', { type: 'button', onclick: () => { if (isArch) { archived.delete(s); offered.add(s); } else { offered.delete(s); archived.add(s); } dirty = true; paint(); } }, isArch ? 'Restore' : 'Archive')) : null);
      }));
    };
    const search = h('input', { type: 'search', placeholder: 'Search subjects', 'aria-label': 'Search subjects', oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); } });
    const cInput = h('input', { type: 'text', maxlength: 40, placeholder: 'Add a custom subject', 'aria-label': 'Custom subject' });
    const addCustom = () => { const n = norm(cInput.value); if (!n) return; const hit = known().find((x) => same(x, n));
      if (hit) { say(m, archived.has(hit) ? hit + ' is archived. Use Restore to bring it back.' : hit + ' is already in the list.'); return; } if (n.includes(',') || n.includes('/')) { say(m, 'Do not use commas or slashes.'); return; }
      offered.add(n); cInput.value = ''; dirty = true; say(m, ''); paint(); };
    cInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
    const save = async () => { say(m, 'Saving.'); const rn = (name) => { let x = name; for (const [a, b] of renames) if (x === a) x = b; return x; };
      const subjects = [...offered]; const values = { subjects, archivedSubjects: [...archived] };
      if (renames.length) { values.classSubjects = Object.fromEntries(Object.entries(S.map).map(([k, l]) => [k, uniqCi(l.map(rn))])); values.templates = S.templates.map((t) => ({ ...t, subjects: uniqCi(t.subjects.map(rn)) })); }
      try { await persist(values); S.subjects = subjects; S.archived = values.archivedSubjects; if (values.classSubjects) { S.map = values.classSubjects; S.templates = values.templates; } renames.length = 0; dirty = false; ok(m, 'Saved.'); } catch (er) { say(m, failText(er)); } };
    paint();
    return h('div', {}, head('Subject library', 'Tap a subject to add it to your centre or remove it. A subject lives here once and is reused by every class.'), h('div', { class: 'scard' },
      h('div', { class: 'toolrow' }, search, count), grid, h('div', { class: 'addrow' }, cInput, h('button', { type: 'button', onclick: addCustom }, 'Add subject')), m, h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: save }, 'Save library'))));
  }

  // The shared "copy or apply to classes" dialog: pick classes, merge or replace, preview, confirm.
  function applyDialog({ heading, subjects, exclude = [], preselect = [], extra, done }) {
    const targets = S.classes.filter((c) => !exclude.includes(c)); const chosen = new Set(preselect.filter((c) => targets.includes(c))); let mode = 'merge';
    const m = msgBox(); const list = h('div', { class: 'tiles small' }); const prev = h('div', { class: 'preview' }); const go2 = h('button', { class: 'gold', type: 'button' }, 'Apply');
    const result = (c) => (mode === 'replace' ? uniqCi(subjects) : uniqCi([...(S.map[c] || []), ...subjects]));
    const paint = () => { list.replaceChildren(...targets.map((c) => tile(c, chosen.has(c), () => { if (chosen.has(c)) chosen.delete(c); else chosen.add(c); paint(); })));
      const picked = targets.filter((c) => chosen.has(c)); go2.disabled = !picked.length;
      prev.replaceChildren(...(picked.length ? picked.map((c) => { const before = (S.map[c] || []).length; const after = result(c).length; const warn = mode === 'replace' && before > 0;
        return h('p', { class: warn ? 'warn' : '' }, h('b', {}, c + ': '), before + ' → ' + after + ' subjects' + (warn ? ' (replaces ' + before + ' existing)' : '')); }) : [h('p', { class: 'hint' }, targets.length ? 'Choose the classes to change.' : 'There are no other classes. Add classes first.')])); };
    const radio = (v, label) => h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'applymode', value: v, checked: v === mode ? true : undefined, onchange: () => { mode = v; paint(); } }), label);
    go2.addEventListener('click', async () => { const picked = targets.filter((c) => chosen.has(c)); if (!picked.length) return;
      if (mode === 'replace' && picked.some((c) => (S.map[c] || []).length) && !window.confirm('Replace the existing subjects of the selected classes? This cannot be undone.')) return;
      const nextMap = { ...S.map }; for (const c of picked) nextMap[c] = result(c); const values = { classSubjects: nextMap, ...(extra ? extra(picked) : {}) }; say(m, 'Saving.');
      try { await persist(values); S.map = nextMap; if (values.templates) S.templates = values.templates; ov.close(); if (done) done(picked); } catch (er) { say(m, failText(er)); } });
    const content = h('div', { class: 'dbody' }, h('p', { class: 'hint' }, 'Subjects: ' + (subjects.length ? subjects.join(', ') : 'none selected')),
      h('div', { class: 'toolrow' }, h('b', {}, 'Target classes'), h('span', {}, h('button', { type: 'button', onclick: () => { targets.forEach((c) => chosen.add(c)); paint(); } }, 'Select all'), ' ', h('button', { type: 'button', onclick: () => { chosen.clear(); paint(); } }, 'Clear'))), list,
      h('div', { class: 'actions' }, radio('merge', 'Merge with existing subjects'), radio('replace', 'Replace existing subjects')), h('h4', {}, 'Preview'), prev, m, h('div', { class: 'actions' }, go2, h('button', { type: 'button', onclick: () => ov.close() }, 'Cancel')));
    const ov = overlay(h, heading, content); paint(); return ov;
  }

  // Vertical class navigation on the left, one class's subject tiles on the right.
  function acMapping() {
    if (!S.classes.length) return h('div', {}, head('Class-subject mapping'), h('p', { class: 'empty' }, 'Choose your classes first.'), h('button', { type: 'button', onclick: () => { view.sub = 'classes'; draw(); } }, 'Choose classes'));
    if (!view.cls || !S.classes.includes(view.cls)) view.cls = S.classes[0];
    const left = h('div', { class: 'clist', role: 'tablist', 'aria-label': 'Classes' }); const right = h('div', { class: 'cpanel' });
    let working = new Set(S.map[view.cls] || []); let query = '';
    const status = (c) => { const n = (S.map[c] || []).length; return n ? n + ' subject' + (n > 1 ? 's' : '') : 'Not configured'; };
    const paintLeft = () => left.replaceChildren(...S.classes.map((c) => h('button', { type: 'button', role: 'tab', class: 'citem' + (c === view.cls ? ' on' : ''), 'aria-selected': c === view.cls ? 'true' : 'false',
      onclick: () => { if (c === view.cls) return; guard(() => { view.cls = c; working = new Set(S.map[c] || []); query = ''; paintLeft(); paintRight(); }); } },
      h('i', { class: 'dot ' + ((S.map[c] || []).length ? 'good' : 'warn') }), h('span', { class: 'cn' }, c), h('small', {}, status(c)))));
    const options = () => uniqCi([...S.subjects, ...(S.map[view.cls] || []), ...working]);
    function paintRight() {
      const m = msgBox(); const grid = h('div', { class: 'tiles' }); const cnt = h('span', { class: 'pill' });
      const paintTiles = () => { cnt.textContent = working.size + ' selected'; const opts = options().filter((s) => !query || s.toLowerCase().includes(query));
        grid.replaceChildren(...(opts.length ? opts.map((s) => tile(s, working.has(s), () => { if (working.has(s)) working.delete(s); else if (working.size >= 25) { say(m, 'A class can have up to 25 subjects.'); return; } else working.add(s); dirty = true; paintTiles(); })) : [h('p', { class: 'empty' }, S.subjects.length ? 'No subject matches your search.' : 'Your subject library is empty.')])); };
      const search = h('input', { type: 'search', placeholder: 'Search subjects', 'aria-label': 'Search subjects', value: query, oninput: (e) => { query = e.target.value.trim().toLowerCase(); paintTiles(); } });
      const tpl = h('select', { 'aria-label': 'Apply curriculum template', onchange: (e) => { const t = S.templates.find((x) => x.id === e.target.value); e.target.value = ''; if (!t) return;
        if (working.size && !window.confirm('Replace the ticked subjects with the template "' + t.name + '"? You can still change them before saving.')) return; working = new Set(t.subjects); dirty = true; paintTiles(); } },
        h('option', { value: '' }, S.templates.length ? 'Apply template…' : 'No templates yet'), S.templates.map((t) => h('option', { value: t.id }, t.name)));
      const save = async () => { say(m, 'Saving.'); const next = { ...S.map }; if (working.size) next[view.cls] = [...working]; else delete next[view.cls];
        try { await persist({ classSubjects: next }); S.map = next; dirty = false; paintLeft(); ok(m, 'Saved. New students in ' + view.cls + ' will get these subjects. Existing students are not changed.'); } catch (er) { say(m, failText(er)); } };
      right.replaceChildren(h('div', { class: 'phead' }, h('h3', {}, view.cls), cnt),
        h('div', { class: 'toolrow' }, search, h('button', { type: 'button', onclick: () => { options().filter((s) => !query || s.toLowerCase().includes(query)).slice(0, 25).forEach((s) => working.add(s)); dirty = true; paintTiles(); } }, 'Select all'),
          h('button', { type: 'button', onclick: () => { working = new Set(); dirty = true; paintTiles(); } }, 'Clear'), tpl),
        grid, h('p', { class: 'hint' }, 'Missing a subject? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); guard(() => { view.sub = 'library'; draw(); }); } }, 'Add it to the subject library'), '.'), m,
        h('div', { class: 'stickybar' }, h('button', { class: 'gold', type: 'button', onclick: save }, 'Save changes'),
          h('button', { type: 'button', onclick: () => { if (!working.size) { say(m, 'Tick at least one subject first.'); return; } applyDialog({ heading: 'Copy subjects to classes', subjects: [...working], exclude: [view.cls],
            done: (picked) => { paintLeft(); say(m, 'Copied to ' + picked.join(', ') + '.', true); } }); } }, 'Copy to classes'),
          h('button', { type: 'button', onclick: async () => { if (!working.size) { say(m, 'Tick at least one subject first.'); return; } const name = norm(window.prompt('Template name', view.cls + ' subjects') || ''); if (!name) return;
              if (S.templates.length >= 20) { say(m, 'You can keep up to 20 templates.'); return; } if (S.templates.some((t) => same(t.name, name))) { say(m, 'A template with that name already exists.'); return; }
              const templates = [...S.templates, { id: newTplId(), name: name.slice(0, 50), description: '', subjects: [...working], classes: [view.cls] }]; say(m, 'Saving.'); try { await persist({ templates }); S.templates = templates; paintRight(); ok(right.querySelector('.msg'), 'Saved as a template.'); } catch (er) { say(m, failText(er)); } } }, 'Save as template')));
      paintTiles();
    }
    paintLeft(); paintRight();
    return h('div', {}, head('Class-subject mapping', 'Pick a class on the left, tick its subjects on the right. New students in that class get them automatically.'), h('div', { class: 'mapgrid' }, left, right));
  }

  // Reusable templates. Editing a template never changes classes or students by itself; use Apply to classes.
  function acTemplates() {
    const chips = (l) => h('div', { class: 'chips' }, l.slice(0, 8).map((s) => h('span', { class: 'chip' }, s)), l.length > 8 ? h('span', { class: 'chip mute' }, '+' + (l.length - 8)) : null);
    const m = msgBox();
    const saveTemplates = async (templates, text) => { say(m, 'Saving.'); try { await persist({ templates }); S.templates = templates; draw(); } catch (er) { say(m, failText(er)); throw er; } };
    const card = (t) => h('div', { class: 'tcard' }, h('div', { class: 'thead' }, icon('layers'), h('div', {}, h('b', {}, t.name), h('small', {}, t.subjects.length + ' subject' + (t.subjects.length === 1 ? '' : 's')))), t.description ? h('p', { class: 'hint' }, t.description) : null, chips(t.subjects),
      h('p', { class: 'hint' }, t.classes.length ? 'Applied to: ' + t.classes.join(', ') : 'Not applied to any class yet'),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => editor(t) }, 'Edit'),
        h('button', { type: 'button', onclick: () => { if (S.templates.length >= 20) { say(m, 'You can keep up to 20 templates.'); return; } let n = (t.name + ' (copy)').slice(0, 50); saveTemplates([...S.templates, { ...t, id: newTplId(), name: n, classes: [], subjects: [...t.subjects] }]).catch(() => {}); } }, 'Duplicate'),
        h('button', { type: 'button', onclick: () => applyDialog({ heading: 'Apply "' + t.name + '"', subjects: t.subjects, preselect: t.classes, extra: (picked) => ({ templates: S.templates.map((x) => (x.id === t.id ? { ...x, classes: uniqCi([...x.classes, ...picked]) } : x)) }), done: () => draw() }) }, 'Apply to classes'),
        h('button', { type: 'button', onclick: () => { if (window.confirm('Delete the template "' + t.name + '"? Classes and students that already use its subjects are not changed.')) saveTemplates(S.templates.filter((x) => x.id !== t.id)).catch(() => {}); } }, 'Delete')));
    function editor(t) {
      const st = { subjects: new Set(t ? t.subjects : []), classes: new Set(t ? t.classes : []), query: '' }; const em = msgBox(); const grid = h('div', { class: 'tiles' }); const cnt = h('span', { class: 'pill' });
      const name = h('input', { type: 'text', maxlength: 50, value: t ? t.name : '', placeholder: 'For example Foundation Curriculum', 'aria-label': 'Template name' }); const desc = h('input', { type: 'text', maxlength: 120, value: t ? t.description : '', placeholder: 'Optional note', 'aria-label': 'Description' });
      const paint = () => { cnt.textContent = st.subjects.size + ' selected'; grid.replaceChildren(...uniqCi([...S.subjects, ...st.subjects]).filter((s) => !st.query || s.toLowerCase().includes(st.query)).map((s) => tile(s, st.subjects.has(s), () => { if (st.subjects.has(s)) st.subjects.delete(s); else if (st.subjects.size >= 40) return; else st.subjects.add(s); paint(); }))); };
      const clsGrid = h('div', { class: 'tiles small' }, S.classes.map((c) => tile(c, st.classes.has(c), (e) => { const b = e.currentTarget; if (st.classes.has(c)) st.classes.delete(c); else st.classes.add(c); setTile(b, st.classes.has(c)); })));
      const save = async () => { const n = norm(name.value); if (!n) { say(em, 'Give the template a name.'); return; } if (!st.subjects.size) { say(em, 'Tick at least one subject.'); return; }
        if (S.templates.some((x) => x.id !== (t && t.id) && same(x.name, n))) { say(em, 'A template with that name already exists.'); return; } if (!t && S.templates.length >= 20) { say(em, 'You can keep up to 20 templates.'); return; }
        const rec = { id: t ? t.id : newTplId(), name: n, description: norm(desc.value).slice(0, 120), subjects: [...st.subjects], classes: [...st.classes] }; const templates = t ? S.templates.map((x) => (x.id === t.id ? rec : x)) : [...S.templates, rec];
        say(em, 'Saving.'); try { await persist({ templates }); S.templates = templates; ov.close(); draw(); } catch (er) { say(em, failText(er)); } };
      const content = h('div', { class: 'dbody' }, h('label', {}, 'Template name', name), h('label', {}, 'Description (optional)', desc), h('div', { class: 'toolrow' }, h('input', { type: 'search', placeholder: 'Search subjects', 'aria-label': 'Search subjects', oninput: (e) => { st.query = e.target.value.trim().toLowerCase(); paint(); } }), cnt), grid,
        h('h4', {}, 'Applicable classes'), S.classes.length ? clsGrid : h('p', { class: 'hint' }, 'Choose your classes first.'), h('p', { class: 'hint' }, 'Saving a template does not change any class or student. Use Apply to classes to copy it.'), em,
        h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: save }, 'Save template'), h('button', { type: 'button', onclick: () => ov.close() }, 'Cancel')));
      const ov = overlay(h, t ? 'Edit template' : 'Create template', content, { wide: true }); paint();
    }
    return h('div', {}, head('Curriculum templates', 'Build a subject combination once and apply it to as many classes as you like.'), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: () => editor(null) }, 'Create template')), m,
      S.templates.length ? h('div', { class: 'tcards' }, S.templates.map(card)) : h('p', { class: 'empty' }, 'No templates yet. Create one, or open Class-subject mapping and press Save as template.'));
  }

  // Admission preferences.
  function acPrefs() {
    const draft = { ...S.prefs }; const m = msgBox();
    const rows = [['autoAssign', 'Automatically assign subjects based on class', 'Choosing a class in the new-student form fills in its default subjects.'], ['allowCustomise', 'Allow individual student subject customisation', 'Show the Edit subjects button on a student.'],
      ['autoDate', 'Automatically fill the joining date', 'The joining date starts as today. You can still change it.'], ['autoTime', 'Automatically fill the joining time', 'The joining time starts as the current time.'],
      ['showAssigned', 'Display assigned subjects before saving', 'Show the subject chips in the student form.'], ['warnUnconfigured', 'Warn when a class has no configured subjects', 'Show a notice when the chosen class has no default subjects.']];
    const save = async () => { say(m, 'Saving.'); try { await persist({ admissionPrefs: draft }); S.prefs = { ...draft }; dirty = false; ok(m, 'Saved.'); } catch (er) { say(m, failText(er)); } };
    return h('div', {}, head('Admission preferences', 'How the new-student form behaves.'), h('div', { class: 'scard' }, rows.map(([k, t, d]) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: draft[k] ? true : undefined, onchange: (e) => { draft[k] = e.target.checked; dirty = true; } }), h('span', { class: 'sw' }), h('span', { class: 'swt' }, h('b', {}, t), h('small', {}, d)))),
      m, h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: save }, 'Save preferences')), h('p', { class: 'hint' }, 'The time a student record is created is stored by the server and cannot be edited. The joining date and time are separate, editable fields.')));
  }

  // ---------- C to F ----------
  function feesSec() {
    return h('div', {}, head('Fee settings', 'Fees are set where you use them, so each batch and student can differ.'), h('div', { class: 'navcards' },
      h('button', { type: 'button', class: 'navcard', onclick: () => guard(() => go('Batches')) }, icon('layers'), h('span', { class: 'nct' }, h('b', {}, 'Monthly fee for a batch'), h('small', {}, 'New students in a batch start with its fee.')), icon('arrow')),
      h('button', { type: 'button', class: 'navcard', onclick: () => guard(() => go('Students')) }, icon('user'), h('span', { class: 'nct' }, h('b', {}, 'Fee and due day for a student'), h('small', {}, 'Set in the student form. Changes start from the month you choose.')), icon('arrow')),
      h('button', { type: 'button', class: 'navcard', onclick: () => guard(() => go('Fees')) }, icon('wallet'), h('span', { class: 'nct' }, h('b', {}, 'Collect fees, history and receipts'), h('small', {}, 'The payment method is chosen each time you record a payment.')), icon('arrow'))));
  }
  function brandingSec() {
    const box = h('div', {}); const out = h('div', {}, head('Branding & logo', 'Your logo is printed at the top of your fee receipts.'), box);
    if (brandingMount) brandingMount(box); else box.append(h('p', { class: 'empty' }, 'Logo upload is available for coaching centres. Your fee receipts show your name and the AZIZ footer.'));
    return out;
  }
  function accountSec() {
    return h('div', {}, head('Account & security'), h('div', { class: 'scard' }, h('p', {}, 'Registered email: ', h('b', {}, profile.email || '')), h('p', {}, 'Role: ', h('b', {}, inst.role === 'owner' ? 'Owner' : inst.role)), h('p', {}, 'Plan: ', h('b', {}, 'Free')),
      h('p', { class: 'hint' }, 'To change your sign-in email or get help with access, write to support@azizschoolmanagementsystem.com from your registered email address.')));
  }
  function privacySec() {
    return h('div', {}, head('Data & privacy'), h('div', { class: 'scard' }, h('p', {}, 'Your students, fees and attendance belong to you and are visible only to your account.'),
      h('p', {}, 'To export your data or ask for your account to be deleted, write to ', h('b', {}, 'support@azizschoolmanagementsystem.com'), ' from your registered email. We delete it on request.'),
      h('p', { class: 'hint' }, 'Deleting an account is never done from this screen, so nothing can be removed by accident.')));
  }

  draw();
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The "Assigned subjects" card for the student form. Class defaults come from Settings; changes here affect only this student.
export function subjectsCard({ h, profile, current = [], editing = false, go }) {
  const prefs = prefsOf(profile); const map = profile.classSubjects || {}; const templates = profile.templates || [];
  let list = [...current]; let cls = ''; let source = ''; let customised = editing && current.length > 0; let note = '';
  const hid = h('div', { style: 'display:none' }); const out = h('div', { class: 'acard' });
  const defaults = (c) => (c && Object.prototype.hasOwnProperty.call(map, c) ? map[c] : []);
  const render = () => {
    hid.replaceChildren(...list.map((s) => h('input', { type: 'hidden', name: 'subjects[]', value: s })));
    const unconfigured = cls && cls !== '__other' && !defaults(cls).length && !editing;
    out.replaceChildren(...[h('div', { class: 'ahead' }, h('b', {}, 'Assigned subjects'), h('span', { class: 'pill' }, list.length + (list.length === 1 ? ' subject' : ' subjects')), (prefs.allowCustomise || unconfigured || !list.length) ? h('button', { type: 'button', onclick: open }, 'Edit subjects') : null),
      prefs.showAssigned ? (list.length ? h('div', { class: 'chips' }, list.map((s) => h('span', { class: 'chip' }, s))) : h('p', { class: 'hint' }, 'No subjects yet.')) : null,
      note ? h('p', { class: 'hint ok' }, note) : null,
      unconfigured && prefs.warnUnconfigured ? h('div', { class: 'notice' }, h('p', {}, 'No default subjects have been configured for this class.'), h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => { if (window.confirm('Opening Settings will clear what you typed in this form. Continue?')) { requestSettingsView({ sec: 'academic', sub: 'mapping', cls }); go('Settings'); } } }, 'Configure class subjects'), h('button', { type: 'button', onclick: open }, 'Select subjects manually'))) : null].filter(Boolean));
  };
  const open = () => {
    const draft = new Set(list); let query = ''; let showAll = false; const grid = h('div', { class: 'tiles' }); const cnt = h('span', { class: 'pill' });
    const extra = h('input', { type: 'text', maxlength: 120, placeholder: 'Other subjects, separated by commas', 'aria-label': 'Other subjects' });
    const opts = () => { const base = [...(profile.subjects || []), ...draft]; if (showAll) base.push(...ALL_SUBJECTS); return uniqCi(base).filter((s) => !query || s.toLowerCase().includes(query)); };
    const paint = () => { cnt.textContent = draft.size + ' selected'; grid.replaceChildren(...opts().map((s) => h('button', { type: 'button', class: 'tile' + (draft.has(s) ? ' on' : ''), 'aria-pressed': draft.has(s) ? 'true' : 'false', onclick: () => { if (draft.has(s)) draft.delete(s); else if (draft.size < 25) draft.add(s); paint(); } }, h('span', { class: 'tk' }, draft.has(s) ? '✓' : ''), h('span', { class: 'tl' }, s)))); };
    const tpl = h('select', { 'aria-label': 'Apply curriculum template', onchange: (e) => { const t = templates.find((x) => x.id === e.target.value); e.target.value = ''; if (t) { draft.clear(); t.subjects.slice(0, 25).forEach((s) => draft.add(s)); paint(); } } },
      h('option', { value: '' }, templates.length ? 'Apply template…' : 'No templates yet'), templates.map((t) => h('option', { value: t.id }, t.name)));
    const reset = h('button', { type: 'button', onclick: () => { const d = defaults(cls); if (!d.length) return; draft.clear(); d.forEach((s) => draft.add(s)); paint(); } }, 'Reset to class defaults'); if (!defaults(cls).length) reset.disabled = true;
    const save = () => { const more = String(extra.value || '').split(',').map(norm).filter(Boolean); const next = uniqCi([...draft, ...more]).slice(0, 25); const d = defaults(cls); const sameAsDefault = d.length === next.length && d.every((x) => next.some((y) => same(x, y)));
      list = next; customised = !sameAsDefault; note = customised ? 'Customised for this student. The class defaults are unchanged.' : ''; ov.close(); render(); };
    const content = h('div', { class: 'dbody' }, h('div', { class: 'toolrow' }, h('input', { type: 'search', placeholder: 'Search subjects', 'aria-label': 'Search subjects', oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); } }), cnt),
      h('div', { class: 'toolrow' }, tpl, reset, h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; paint(); } }), 'Show all subjects')), grid, extra,
      h('p', { class: 'hint' }, 'Changes here apply to this student only, not to the whole class.'), h('div', { class: 'actions' }, h('button', { class: 'gold', type: 'button', onclick: save }, 'Use these subjects'), h('button', { type: 'button', onclick: () => ov.close() }, 'Cancel')));
    const ov = overlay(h, 'Subjects for this student', content, { wide: true }); paint();
  };
  const wrap = h('div', { 'data-field': 'subjects' }, hid, out, h('span', { class: 'ferr', 'data-err': 'subjects' }));
  // Called when the class dropdown changes. Customised subjects are never replaced without asking.
  wrap.useClass = (c) => {
    cls = c || ''; if (!cls || cls === '__other') { note = ''; render(); return; }
    const d = defaults(cls);
    if (prefs.autoAssign && d.length) {
      if (customised && !window.confirm('This student\'s subjects were customised. Replace them with the defaults for ' + cls + '?')) { render(); return; }
      list = [...d]; source = cls; customised = false; note = d.length + ' subject' + (d.length === 1 ? '' : 's') + ' automatically assigned from ' + cls + ' academic settings.';
    } else if (!d.length) { if (!customised) list = []; note = ''; }
    render();
  };
  render(); return wrap;
}
