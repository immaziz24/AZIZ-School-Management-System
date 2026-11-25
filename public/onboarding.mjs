// School registration wizard (Registration Mark 1, Batch 98). Platform administrators only: the database rules and the server
// functions decide who may do what, not this file. A full-screen, resumable form that replaces the old Register a school pop-up.
// Mark 1 covers categories A to E (school, recognition, address, owner, principal). F to O are listed and arrive in Marks 2 to 4.
// ---------- field registry: one declarative list drives the form, the validation, the progress and the review ----------
const INDIA_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const opts = (list) => list.map((x) => (Array.isArray(x) ? x : [x, x]));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 -]{6,17}$/;

export const CATEGORIES = [
  { id: 'A', title: 'Basic school information' }, { id: 'B', title: 'Recognition and affiliation' }, { id: 'C', title: 'Address and contact' },
  { id: 'D', title: 'School owner' }, { id: 'E', title: 'Principal and administration' },
  { id: 'F', title: 'Academic configuration', later: 'Mark 2' }, { id: 'G', title: 'Capacity and staff', later: 'Mark 2' },
  { id: 'H', title: 'Timing and attendance', later: 'Mark 2' }, { id: 'I', title: 'Fees and finance', later: 'Mark 2' },
  { id: 'J', title: 'Website and branding', later: 'Mark 3' }, { id: 'K', title: 'Domain configuration', later: 'Mark 3' },
  { id: 'L', title: 'Facilities', later: 'Mark 3' }, { id: 'M', title: 'Subscription and commercial', later: 'Mark 4' },
  { id: 'N', title: 'Login and security', later: 'Mark 4' }, { id: 'O', title: 'Verification and activation', later: 'Mark 4' },
];
const noAffiliation = (v) => !v.board || v.board === 'none' || v.board === 'state';

export const FIELDS = [
  { id: 'F001', key: 'name', cat: 'A', label: 'Official school name', type: 'text', req: true, max: 120, help: 'As it appears on the recognition certificate.' },
  { id: 'F002', key: 'shortName', cat: 'A', label: 'School short name', type: 'text', max: 40 },
  { id: 'F004', key: 'estYear', cat: 'A', label: 'Year of establishment', type: 'number',
    validate: (x) => (x && (!/^[0-9]{4}$/.test(x) || Number(x) < 1800 || Number(x) > new Date().getFullYear()) ? 'Enter a four digit year from 1800 to this year.' : '') },
  { id: 'F005', key: 'schoolType', cat: 'A', label: 'School type', type: 'select', req: true, options: opts(['Government', 'Government aided', 'Private unaided', 'Trust or society run', 'Other']) },
  { id: 'F006', key: 'schoolLevel', cat: 'A', label: 'School level', type: 'select', req: true, options: opts(['Pre-primary', 'Primary', 'Upper primary', 'Secondary', 'Higher secondary', 'Pre-primary to higher secondary']) },
  { id: 'F007', key: 'genderComposition', cat: 'A', label: 'Gender composition', type: 'select', req: true, options: opts(['Co-educational', 'Boys only', 'Girls only']) },
  { id: 'F008', key: 'medium', cat: 'A', label: 'Medium of instruction', type: 'select', req: true, options: opts(['Bengali', 'English', 'Hindi', 'Urdu', 'Nepali', 'More than one', 'Other']) },
  { id: 'F009', key: 'motto', cat: 'A', label: 'School motto', type: 'text', max: 120 },
  { id: 'F010', key: 'description', cat: 'A', label: 'School description', type: 'textarea', max: 1000, wide: true },

  { id: 'F011', key: 'board', cat: 'B', label: 'Education board', type: 'select', req: true,
    options: opts([['none', 'Not affiliated yet'], ['state', 'State board'], ['CBSE', 'CBSE'], ['ICSE', 'ICSE / ISC'], ['Madrasah', 'Madrasah board'], ['NIOS', 'NIOS'], ['Other', 'Other board']]) },
  { id: 'F012', key: 'affiliationNo', cat: 'B', label: 'Board affiliation number', type: 'text', max: 40, showIf: (v) => !noAffiliation(v), reqIf: (v) => !noAffiliation(v), help: 'Needed for CBSE, ICSE, Madrasah, NIOS and other boards.' },
  { id: 'F013', key: 'udise', cat: 'B', label: 'UDISE+ code', type: 'text', max: 20, help: '11 digits. Leave empty if the school has none yet.',
    validate: (x) => (x && !/^[0-9]{11}$/.test(x.replace(/\s/g, '')) ? 'The UDISE+ code has 11 digits.' : '') },
  { id: 'F014', key: 'recognitionNo', cat: 'B', label: 'School recognition number', type: 'text', max: 40 },
  { id: 'F015', key: 'trustName', cat: 'B', label: 'Registered trust or society name', type: 'text', max: 120, showIf: (v) => ['Private unaided', 'Trust or society run', 'Government aided'].includes(v.schoolType) },
  { id: 'F016', key: 'trustRegNo', cat: 'B', label: 'Trust or society registration number', type: 'text', max: 40, showIf: (v) => ['Private unaided', 'Trust or society run', 'Government aided'].includes(v.schoolType) },

  { id: 'F019', key: 'country', cat: 'C', label: 'Country', type: 'select', req: true, options: opts(['India', 'Bangladesh', 'Nepal', 'Other']) },
  { id: 'F020', key: 'state', cat: 'C', label: 'State', req: true, max: 60, dynamicType: (v) => (v.country === 'India' ? 'select' : 'text'), options: opts(INDIA_STATES) },
  { id: 'F021', key: 'district', cat: 'C', label: 'District', type: 'text', req: true, max: 60 },
  { id: 'F022', key: 'block', cat: 'C', label: 'Block or municipality', type: 'text', max: 60 },
  { id: 'F023', key: 'town', cat: 'C', label: 'Village, town or city', type: 'text', req: true, max: 80 },
  { id: 'F024', key: 'street', cat: 'C', label: 'Complete street address', type: 'textarea', req: true, max: 200, wide: true },
  { id: 'F025', key: 'pin', cat: 'C', label: 'PIN code', type: 'text', req: true, max: 10,
    validate: (x, v) => (x && v.country === 'India' && !/^[1-9][0-9]{5}$/.test(x) ? 'An Indian PIN code has 6 digits and does not start with 0.' : x && v.country !== 'India' && !/^[A-Za-z0-9 -]{3,10}$/.test(x) ? 'Enter a valid postal code.' : '') },
  { id: 'F026', key: 'schoolPhone', cat: 'C', label: 'Official school phone', type: 'phone', req: true },
  { id: 'F027', key: 'schoolEmail', cat: 'C', label: 'Official school email', type: 'email', req: true, help: 'The school\'s own address. The owner signs in with the owner email in the next section.' },
  { id: 'F028', key: 'mapLocation', cat: 'C', label: 'Google Maps link or GPS position', type: 'text', max: 200, help: 'For example a maps link, or 22.5726, 88.3639.' },

  { id: 'F029', key: 'ownerName', cat: 'D', label: 'Owner full name', type: 'text', req: true, max: 80 },
  { id: 'F030', key: 'ownerDesignation', cat: 'D', label: 'Owner designation', type: 'text', req: true, max: 60, help: 'For example Chairman, Secretary or Proprietor.' },
  { id: 'F031', key: 'ownerEmail', cat: 'D', label: 'Owner email', type: 'email', req: true, help: 'The owner signs in with this email and accepts the invitation. It must be a real address the owner can open.' },
  { id: 'F032', key: 'ownerMobile', cat: 'D', label: 'Owner mobile', type: 'phone', req: true },
  { id: 'F033', key: 'ownerWhatsapp', cat: 'D', label: 'Owner WhatsApp', type: 'phone' },
  { id: 'F034', key: 'ownerAddress', cat: 'D', label: 'Owner correspondence address', type: 'textarea', max: 300, wide: true },

  { id: 'F037', key: 'principalName', cat: 'E', label: 'Principal full name', type: 'text', max: 80 },
  { id: 'F038', key: 'principalEmail', cat: 'E', label: 'Principal email', type: 'email' },
  { id: 'F039', key: 'principalMobile', cat: 'E', label: 'Principal mobile', type: 'phone' },
  { id: 'F041', key: 'adminName', cat: 'E', label: 'Administrative contact person', type: 'text', max: 80 },
  { id: 'F042', key: 'adminEmail', cat: 'E', label: 'Administrative contact email', type: 'email' },
  { id: 'F043', key: 'adminPhone', cat: 'E', label: 'Administrative contact phone', type: 'phone' },
];
const UPLOAD_NOTES = { B: 'Recognition and affiliation certificates (F017, F018)', D: 'Owner photograph and authorization document (F035, F036)', E: 'Principal photograph (F040)' };
const ACTIVE = ['A', 'B', 'C', 'D', 'E'];

const typeOf = (field, v) => (field.dynamicType ? field.dynamicType(v) : field.type);
const visible = (field, v) => !field.showIf || field.showIf(v);
const required = (field, v) => visible(field, v) && (field.req === true || (field.reqIf ? field.reqIf(v) : false));
// Returns the problem with one field, or ''. Hidden fields are never checked (C08).
export function fieldProblem(field, v) {
  if (!visible(field, v)) return '';
  const x = String(v[field.key] ?? '').trim();
  if (!x) return required(field, v) ? field.label + ' is required.' : '';
  const type = typeOf(field, v);
  if (field.max && x.length > field.max) return field.label + ' is too long (' + field.max + ' characters at most).';
  if (type === 'email' && !EMAIL.test(x)) return 'Enter a valid email address.';
  if (type === 'phone' && !PHONE.test(x)) return 'Enter a phone number with digits only (a leading + is fine).';
  if (type === 'select' && !field.options.some(([value]) => value === x)) return 'Choose one of the listed options.';
  return field.validate ? field.validate(x, v) : '';
}
export const stepProblems = (cat, v) => FIELDS.filter((f) => f.cat === cat).map((f) => ({ field: f, message: fieldProblem(f, v) })).filter((p) => p.message);
// A section with required fields is done when they are all filled and valid. A section with none (principal and administration) is done once something valid is entered.
export const stepDone = (cat, v) => {
  const own = FIELDS.filter((f) => f.cat === cat && visible(f, v));
  const mustFill = own.filter((f) => required(f, v));
  if (stepProblems(cat, v).length || !mustFill.every((f) => String(v[f.key] ?? '').trim())) return false;
  return mustFill.length > 0 || own.some((f) => String(v[f.key] ?? '').trim());
};
// Progress counts only the steps that are valid and applicable, not the steps that were merely visited.
export const progressOf = (v) => ACTIVE.filter((cat) => stepDone(cat, v)).length;
const newDraftId = () => 'OB-' + Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');

const STYLE = `
#onb{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--navy);color:var(--ivory)}
#onb *{box-sizing:border-box}
#onb .ob-top{display:flex;align-items:center;gap:14px;padding:12px 22px;border-bottom:1px solid var(--line);background:var(--navy2)}
#onb .ob-top h1{font-size:1.5rem;flex:1;margin:0}
#onb .ob-chip{font-size:.82rem;color:var(--muted)}#onb .ob-chip.bad{color:var(--red)}#onb .ob-chip.ok{color:var(--green)}
#onb .ob-body{flex:1;overflow:auto}
#onb .ob-wrap{display:grid;grid-template-columns:270px minmax(0,1fr);gap:26px;max-width:1240px;margin:0 auto;padding:22px}
#onb nav.ob-nav{position:sticky;top:0;align-self:start}
#onb nav.ob-nav button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:none;border:0;border-radius:10px;padding:8px 10px;color:var(--ivory);cursor:pointer}
#onb nav.ob-nav button:hover:not(:disabled){background:#16264f}
#onb nav.ob-nav button.on{background:#1b2c58;box-shadow:inset 3px 0 0 var(--gold)}
#onb nav.ob-nav button:disabled{color:var(--muted);cursor:default;opacity:.7}
#onb nav.ob-nav b{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);font-size:.8rem;flex:none}
#onb nav.ob-nav b.done{background:var(--green);border-color:var(--green);color:#06150e}
#onb nav.ob-nav small{display:block;color:var(--muted)}
#onb .ob-pick{display:none}
#onb .ob-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 18px}
#onb .ob-grid .wide{grid-column:1/-1}
#onb .ob-grid label,#onb .ob-pickl{display:block;margin:10px 0 2px}
#onb .ob-id{display:inline-block;font-size:.72rem;color:var(--muted);margin-left:6px}
#onb .ob-req{color:var(--gold)}
#onb .ob-help{color:var(--muted);font-size:.8rem;margin:3px 0 0}
#onb .ob-err{color:var(--red);font-size:.82rem;margin:3px 0 0;min-height:1em}
#onb [aria-invalid=true]{border-color:var(--red)}
#onb .ob-sum{border:1px solid var(--red);border-radius:12px;padding:10px 14px;margin:0 0 14px}
#onb .ob-warn{border:1px solid #7a6226;background:#2a2410;border-radius:12px;padding:10px 14px;margin:0 0 14px}
#onb .ob-foot{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 22px;border-top:1px solid var(--line);background:var(--navy2)}
#onb .ob-bar{height:8px;background:#1b2542;border-radius:6px;overflow:hidden;margin:6px 0 14px}#onb .ob-bar i{display:block;height:100%;background:var(--gold)}
#onb table.ob-rev td:first-child{width:38%;color:var(--muted)}
#onb .ob-list a{display:block;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin:6px 0;text-decoration:none;color:var(--ivory)}
#onb .ob-list a:hover{border-color:var(--gold)}
@media (max-width:820px){#onb .ob-wrap{grid-template-columns:1fr;padding:14px}#onb nav.ob-nav{display:none}#onb .ob-pick{display:block}#onb .ob-grid{grid-template-columns:1fr}#onb .ob-top{padding:10px 14px}#onb .ob-foot{padding:10px 14px;flex-wrap:wrap}}
`;

// ---------- the wizard ----------
// ctx: { app, user, h, toast, friendly, plans: () => Promise<[[value, label]]>, goSchool: (id) => void }
// Drafts are read and saved by server functions (the browser rules do not expose them), so no Firestore import is needed here.
export async function mountOnboarding(ctx, draftIdFromRoute) {
  const { app, h, toast, friendly } = ctx;
  unmountOnboarding();
  if (!document.getElementById('onb-style')) document.head.append(h('style', { id: 'onb-style' }, STYLE));
  const root = h('div', { id: 'onb' });
  document.body.append(root);
  document.body.style.overflow = 'hidden';

  const S = { draftId: draftIdFromRoute || '', exists: false, revision: 0, step: 0, values: {}, schoolId: '', dupes: [], saveState: '', saveAt: '', busy: false, plan: 'trial', reason: '', registered: null };
  let timer = 0; let saving = false; let dirty = false;

  const call = async (name, data) => {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    return (await httpsCallable(getFunctions(app, 'asia-south1'), name)(data)).data;
  };
  const say = (state, text) => { S.saveState = state; S.saveAt = text; const chip = root.querySelector('.ob-chip'); if (chip) { chip.className = 'ob-chip ' + state; chip.textContent = text; } };

  // ----- saving: debounced, with a revision check so a second tab cannot silently overwrite the first (C04) -----
  const clean = () => Object.fromEntries(Object.entries(S.values).filter(([, x]) => String(x ?? '').trim() !== '').map(([k, x]) => [k, String(x).trim()]));
  async function persist() {
    if (!S.draftId) return true;
    while (saving) await new Promise((resolve) => setTimeout(resolve, 80));
    saving = true; say('', 'Saving.');
    try {
      const saved = await call('saveOnboardingDraft', { draftId: S.draftId, values: clean(), step: S.step, revision: S.exists ? S.revision : 0 });
      S.exists = true; S.revision = saved.revision;
      dirty = false;
      say('ok', 'Saved ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      return true;
    } catch (error) {
      const code = String(error?.code || '');
      say('bad', code.includes('aborted') ? 'Not saved. This draft was changed in another tab or window. Reload the page.' : 'Not saved. ' + (error?.message || friendly(error)));
      return false;
    } finally {
      saving = false;
    }
  }
  const later = () => { dirty = true; clearTimeout(timer); timer = setTimeout(persist, 1200); say('', 'Unsaved changes.'); };

  // ----- starting and resuming (C05) -----
  async function landing() {
    S.draftId = ''; S.exists = false;
    root.replaceChildren(shell(h('div', {}, h('h2', {}, 'Register a school'), h('div', { class: 'empty' }, h('span', { class: 'spin' }), 'Loading drafts.'))));
    let drafts = [];
    try { drafts = (await call('listOnboardingDrafts', {})).drafts || []; } catch { drafts = []; }
    const list = h('div', { class: 'ob-list' }, drafts.length ? drafts.map((d) => h('a', { href: '#/schools/register/' + d.id },
      h('b', {}, d.values?.name || 'Untitled registration'), h('div', { class: 'muted' }, 'Step ' + ((d.step ?? 0) + 1) + ' of 5 | ' + progressOf(d.values || {}) + ' sections complete | last saved ' + (d.updatedAt ? new Date(d.updatedAt).toLocaleString('en-IN') : 'just now')))) : h('p', { class: 'muted' }, 'No unfinished registrations.'));
    root.replaceChildren(shell(h('div', {},
      h('h2', {}, 'Register a school'),
      h('p', { class: 'muted' }, 'Fill the school\'s details in sections. Your work is saved as you go, so you can leave and come back.'),
      h('p', {}, h('a', { class: 'btn gold', href: '#/schools/register/new', style: 'text-decoration:none;display:inline-block' }, 'Start a new registration')),
      h('h3', { style: 'margin-top:22px' }, 'Unfinished registrations'), list), true));
  }
  async function open(id) {
    S.draftId = id; S.exists = false;
    root.replaceChildren(shell(h('div', { class: 'empty' }, h('span', { class: 'spin' }), 'Loading the draft.'), true));
    let found;
    try { found = await call('getOnboardingDraft', { draftId: id }); } catch (error) { toast(error?.message || friendly(error)); return landing(); }
    if (found.exists) {
      const d = found.draft;
      if (d.status !== 'draft') { toast('That registration is already finished.'); location.hash = '#/schools'; return undefined; }
      S.exists = true; S.revision = d.revision; S.step = Math.min(d.step ?? 0, ACTIVE.length); S.values = { ...d.values }; S.schoolId = d.schoolId || '';
    }
    return draw();
  }

  // ----- layout -----
  function shell(content, plain) {
    const top = h('div', { class: 'ob-top' }, h('div', { class: 'brand' }, h('b', {}, 'A')), h('h1', {}, 'Register a school'),
      h('span', { class: 'ob-chip' }, ''), h('a', { class: 'btn', href: '#/schools', onclick: () => { unmountOnboarding(); } }, 'Close'));
    return h('div', { style: 'display:contents' }, top, h('div', { class: 'ob-body' }, h('div', plain ? { style: 'max-width:760px;margin:0 auto;padding:26px 22px' } : { class: 'ob-wrap' }, content)));
  }
  const stepName = (i) => (i < ACTIVE.length ? CATEGORIES[i].title : 'Review and register');

  function nav() {
    const items = CATEGORIES.map((c, i) => {
      const active = ACTIVE.includes(c.id);
      const b = h('button', { type: 'button', disabled: !active, class: active && S.step === i ? 'on' : '', 'aria-current': active && S.step === i ? 'step' : undefined,
        onclick: () => go(i) }, h('b', { class: active && stepDone(c.id, S.values) ? 'done' : '' }, active && stepDone(c.id, S.values) ? '✓' : c.id),
      h('span', {}, c.title, c.later ? h('small', {}, 'Arrives in ' + c.later) : null));
      return b;
    });
    items.splice(ACTIVE.length, 0, h('button', { type: 'button', class: S.step === ACTIVE.length ? 'on' : '', onclick: () => go(ACTIVE.length) }, h('b', {}, '→'), h('span', {}, 'Review and register', h('small', {}, 'Mark 1 steps'))));
    return h('nav', { class: 'ob-nav', 'aria-label': 'Registration steps' }, items);
  }
  function picker() {
    const sel = h('select', { 'aria-label': 'Jump to a step', onchange: () => go(Number(sel.value)) },
      [...ACTIVE.map((c, i) => h('option', { value: i }, c + ' - ' + CATEGORIES[i].title)), h('option', { value: ACTIVE.length }, 'Review and register')]);
    sel.value = String(S.step);
    return h('div', { class: 'ob-pick' }, h('label', { class: 'ob-pickl' }, 'Step', sel));
  }

  function input(field) {
    const type = typeOf(field, S.values);
    const id = 'ob-' + field.key;
    const value = S.values[field.key] ?? '';
    let el;
    if (type === 'select') {
      el = h('select', { id }, [h('option', { value: '' }, 'Select'), ...field.options.map(([v, t]) => h('option', { value: v }, t))]);
      el.value = value;
    } else if (type === 'textarea') { el = h('textarea', { id, rows: 3 }); el.value = value; } else {
      el = h('input', { id, type: type === 'phone' ? 'tel' : type === 'number' ? 'text' : type, ...(type === 'number' ? { inputmode: 'numeric' } : {}), autocomplete: 'off' });
      el.value = value;
    }
    const err = h('p', { class: 'ob-err', id: id + '-err' });
    el.setAttribute('aria-describedby', id + '-err');
    const sync = (final) => {
      let x = el.value;
      if (type === 'email') x = x.toLowerCase();
      S.values[field.key] = x;
      if (field.key === 'country' || field.key === 'board' || field.key === 'schoolType') { draw(); later(); return; }
      if (final) { el.value = x.trim(); S.values[field.key] = x.trim(); const p = fieldProblem(field, S.values); err.textContent = p; el.setAttribute('aria-invalid', p ? 'true' : 'false'); }
      later();
    };
    el.addEventListener('input', () => sync(false));
    el.addEventListener('change', () => sync(true));
    el.addEventListener('blur', () => sync(true));
    return h('div', { class: field.wide ? 'wide' : '' }, h('label', { for: id }, field.label, required(field, S.values) ? h('span', { class: 'ob-req' }, ' *') : null, h('span', { class: 'ob-id' }, field.id)),
      el, field.help ? h('p', { class: 'ob-help' }, field.help) : null, err);
  }

  function idBlock() {
    const have = S.schoolId;
    const wanted = h('input', { id: 'ob-wanted', placeholder: 'Optional: type the ID you want', autocomplete: 'off' });
    const status = h('p', { class: 'ob-help', id: 'ob-id-status' }, have ? 'Held for this registration. It cannot change once the school is registered.' : 'It is created from the school name and held when you leave this step.');
    const hold = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
      const w = wanted.value.trim().toLowerCase();
      if (!w) { status.textContent = 'Type the ID you want first.'; return; }
      if (!(await persist())) return;
      status.textContent = 'Checking.';
      try { const r = await call('reserveSchoolId', { draftId: S.draftId, name: S.values.name || '', wanted: w }); S.schoolId = r.schoolId; draw(); } catch (e) { status.textContent = e?.message || 'Could not hold that ID.'; }
    } }, 'Use this ID');
    return h('div', { class: 'wide' }, h('label', {}, 'School ID', h('span', { class: 'ob-id' }, 'F003')),
      h('input', { value: have || '(not held yet)', readonly: true, 'aria-readonly': 'true' }), status,
      have ? null : h('div', { class: 'row', style: 'margin-top:6px' }, wanted, hold));
  }

  // ----- steps -----
  function dupePanel() {
    if (!S.dupes.length) return null;
    return h('div', { class: 'ob-warn', role: 'status' }, h('b', {}, 'This may already be registered. '), 'You can still continue; this is only a warning.',
      h('ul', {}, S.dupes.map((d) => h('li', {}, h('a', { href: '#/school/' + d.id, target: '_blank', rel: 'noopener' }, d.name + ' (' + d.id + ')'), ' - ' + d.reason))));
  }
  function stepBody() {
    if (S.step >= ACTIVE.length) return review();
    const cat = ACTIVE[S.step];
    const fields = FIELDS.filter((f) => f.cat === cat && visible(f, S.values));
    return h('form', { id: 'ob-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } },
      h('h2', {}, CATEGORIES[S.step].id + '. ' + CATEGORIES[S.step].title),
      dupePanel(),
      h('div', { class: 'ob-grid' }, cat === 'A' ? [fields.slice(0, 1).map(input), idBlock(), fields.slice(1).map(input)] : fields.map(input)),
      UPLOAD_NOTES[cat] ? h('p', { class: 'ob-help', style: 'margin-top:14px' }, UPLOAD_NOTES[cat] + ' arrive in Mark 3, together with secure file storage.') : null,
      h('button', { type: 'submit', hidden: true }));
  }

  function review() {
    const missing = ACTIVE.flatMap((cat) => stepProblems(cat, S.values).map((p) => ({ cat, ...p })).concat(
      FIELDS.filter((f) => f.cat === cat && required(f, S.values) && !String(S.values[f.key] ?? '').trim() && !fieldProblem(f, S.values)).map((f) => ({ cat, field: f, message: f.label + ' is required.' }))));
    const planBox = h('select', { id: 'ob-plan', onchange: () => { S.plan = planBox.value; } });
    ctx.plans().then((list) => { planBox.replaceChildren(...list.map(([v, t]) => h('option', { value: v }, t))); planBox.value = S.plan; });
    const reason = h('textarea', { id: 'ob-reason', rows: 3, placeholder: 'Why are you registering this school? At least 10 characters.', oninput: () => { S.reason = reason.value; } });
    reason.value = S.reason;
    const go1 = h('button', { type: 'button', class: 'btn gold', disabled: S.busy || missing.length > 0, onclick: () => submit(go1) }, S.busy ? 'Registering.' : 'Register school');
    return h('div', {},
      h('h2', {}, 'Review and register'),
      missing.length ? h('div', { class: 'ob-sum', role: 'alert' }, h('b', {}, missing.length + ' thing(s) to fix before registering'),
        h('ul', {}, missing.map((m) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(ACTIVE.indexOf(m.cat)); } }, m.message))))) : h('p', { class: 'ob-help' }, 'Everything required is filled in.'),
      dupePanel(),
      ACTIVE.map((cat, i) => h('div', { class: 'card', style: 'margin:12px 0' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1;margin:0' }, cat + '. ' + CATEGORIES[i].title), h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(i); } }, 'Edit')),
        h('table', { class: 'ob-rev' }, h('tbody', {}, FIELDS.filter((f) => f.cat === cat && visible(f, S.values)).map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, S.values[f.key] || h('span', { class: 'muted' }, '-')))))))),
      h('div', { class: 'card', style: 'margin:12px 0' }, h('h3', {}, 'Plan and reason'),
        h('p', { class: 'ob-help' }, 'Billing and activation settings arrive in Mark 4. For now choose the plan, as before. The price and limits are taken from the plan list on the server.'),
        h('label', { for: 'ob-plan' }, 'Plan'), planBox, h('label', { for: 'ob-reason' }, 'Reason (kept in the audit log)'), reason),
      h('div', { class: 'card' }, h('p', {}, 'Registering creates the school, its billing record and a pending owner invitation for ', h('b', {}, S.values.ownerEmail || 'the owner email'), '. The owner signs in at /app with that email, verifies it and accepts the invitation.'), go1));
  }

  // ----- actions -----
  function showProblems(cat) {
    const problems = stepProblems(cat, S.values).concat(FIELDS.filter((f) => f.cat === cat && required(f, S.values) && !String(S.values[f.key] ?? '').trim() && !fieldProblem(f, S.values)).map((f) => ({ field: f, message: f.label + ' is required.' })));
    const form = root.querySelector('#ob-form');
    form?.querySelector('.ob-sum')?.remove();
    for (const p of problems) { const e = root.querySelector('#ob-' + p.field.key + '-err'); const i = root.querySelector('#ob-' + p.field.key); if (e) e.textContent = p.message; if (i) i.setAttribute('aria-invalid', 'true'); }
    if (problems.length && form) {
      const sum = h('div', { class: 'ob-sum', role: 'alert', tabindex: '-1' }, h('b', {}, 'Please fix ' + problems.length + ' field(s):'),
        h('ul', {}, problems.map((p) => h('li', {}, h('a', { href: '#ob-' + p.field.key, onclick: (e) => { e.preventDefault(); root.querySelector('#ob-' + p.field.key)?.focus(); } }, p.message)))));
      form.querySelector('h2').after(sum); sum.focus();
    }
    return problems.length === 0;
  }
  async function checkDupes() {
    if (!S.values.name) return;
    try { S.dupes = (await call('checkSchoolDuplicates', { name: S.values.name, town: S.values.town || '', udise: S.values.udise || '', affiliation: S.values.affiliationNo || '' })).matches || []; } catch { /* a warning only */ }
  }
  async function next() {
    if (S.step < ACTIVE.length && !showProblems(ACTIVE[S.step])) return;
    clearTimeout(timer);
    if (!S.draftId) { S.draftId = newDraftId(); history.replaceState(null, '', '#/schools/register/' + S.draftId); }
    if (!(await persist())) return;
    if (S.step === 0 && !S.schoolId && S.values.name) {
      try { S.schoolId = (await call('reserveSchoolId', { draftId: S.draftId, name: S.values.name })).schoolId; } catch (e) { toast(e?.message || 'Could not hold a school ID.'); return; }
    }
    if (S.step <= 2) await checkDupes();
    S.step = Math.min(S.step + 1, ACTIVE.length); await persist(); draw(); scrollTop();
  }
  async function go(i) {
    if (i === S.step) return;
    if (S.draftId) { clearTimeout(timer); if (dirty) await persist(); }
    S.step = i; if (S.draftId && S.exists) persist(); draw(); scrollTop();
  }
  function back() { if (S.step > 0) go(S.step - 1); }
  const scrollTop = () => root.querySelector('.ob-body')?.scrollTo(0, 0);

  async function submit(button) {
    if (S.reason.trim().length < 10) { toast('Give a reason of at least 10 characters.'); root.querySelector('#ob-reason')?.focus(); return; }
    S.busy = true; button.disabled = true; button.textContent = 'Registering.';
    clearTimeout(timer);
    try {
      if (dirty && !(await persist())) throw new Error('The draft could not be saved first.');
      const result = await call('registerSchool', { draftId: S.draftId, plan: S.plan, reason: S.reason.trim() });
      toast('School registered. Tell the owner to sign in at /app with ' + (result.ownerEmail || S.values.ownerEmail) + ' and accept the invitation.');
      unmountOnboarding();
      ctx.goSchool(result.schoolId);
    } catch (error) {
      S.busy = false; toast(error?.message || friendly(error)); draw();
    }
  }
  async function discard() {
    if (!S.exists) { unmountOnboarding(); location.hash = '#/schools'; return; }
    if (!confirm('Delete this unfinished registration? This cannot be undone.')) return;
    try { await call('deleteOnboardingDraft', { draftId: S.draftId }); } catch (e) { toast(e?.message || friendly(e)); return; }
    unmountOnboarding(); location.hash = '#/schools';
  }

  function draw() {
    const width = Math.round((progressOf(S.values) / ACTIVE.length) * 100);
    const main = h('div', {},
      h('p', { class: 'muted', style: 'margin:0' }, 'Step ' + (S.step + 1) + ' of ' + (ACTIVE.length + 1) + ': ' + stepName(S.step) + ' | ' + progressOf(S.values) + ' of ' + ACTIVE.length + ' sections complete'),
      h('div', { class: 'ob-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(ACTIVE.length), 'aria-valuenow': String(progressOf(S.values)) }, h('i', { style: 'width:' + width + '%' })),
      picker(), stepBody());
    const content = h('div', { style: 'display:contents' }, nav(), main);
    const chipClass = S.saveState, chipText = S.saveAt;
    root.replaceChildren(shell(content));
    const chip = root.querySelector('.ob-chip'); chip.className = 'ob-chip ' + chipClass; chip.textContent = chipText;
    root.append(h('div', { class: 'ob-foot' },
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', disabled: S.step === 0, onclick: back }, 'Back'), S.draftId ? h('button', { type: 'button', class: 'btn red', onclick: discard }, 'Discard draft') : null),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: async () => { if (!S.draftId) { S.draftId = newDraftId(); history.replaceState(null, '', '#/schools/register/' + S.draftId); } clearTimeout(timer); await persist(); } }, 'Save draft'),
        S.step < ACTIVE.length ? h('button', { type: 'button', class: 'btn gold', onclick: next }, S.step === ACTIVE.length - 1 ? 'Save and review' : 'Save and continue') : null)));
  }

  root._cleanup = () => { clearTimeout(timer); if (dirty) persist(); removeEventListener('beforeunload', warn); };
  const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  addEventListener('beforeunload', warn);

  if (draftIdFromRoute === 'new') { S.draftId = ''; draw(); } else if (draftIdFromRoute) await open(draftIdFromRoute); else await landing();
}

export function unmountOnboarding() {
  const root = document.getElementById('onb');
  if (root) { root._cleanup?.(); root.remove(); document.body.style.overflow = ''; }
}
