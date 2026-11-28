// Tests for the Settings workspace and the student "assigned subjects" card (public/academic-ui.mjs).
// No browser is needed: a very small fake page is built here, the screens are drawn into it, buttons are pressed and the server calls are recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.listeners = {}; this.parent = null; this.style = {}; this.cls = new Set(); this._value; this._checked;
    this.classList = { add: (c) => this.cls.add(c), remove: (c) => this.cls.delete(c), contains: (c) => this.cls.has(c), toggle: (c, on) => ((on === undefined ? !this.cls.has(c) : on) ? this.cls.add(c) : this.cls.delete(c)) }; }
  get className() { return [...this.cls].join(' '); } set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? { nodeType: 3, text: k, parent: this } : k; n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  dispatch(t, ev = {}) { ev.target ??= this; ev.currentTarget = this; for (const f of this.listeners[t] || []) f(ev); }
  click() { if (this.attrs.disabled !== undefined) return; if (this.tagName === 'A') { this.dispatch('click', { preventDefault() {} }); return; } this.dispatch('click'); }
  get textContent() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(''); } set textContent(v) { this.children = [{ nodeType: 3, text: String(v), parent: this }]; }
  focus() {}
  get value() { return this._value !== undefined ? this._value : (this.attrs.value ?? ''); } set value(v) { this._value = String(v); }
  get checked() { return this._checked !== undefined ? this._checked : 'checked' in this.attrs; } set checked(v) { this._checked = !!v; }
  get name() { return this.attrs.name; }
  walk(fn) { for (const c of this.children) if (c.nodeType === 1) { fn(c); c.walk(fn); } }
  matches(sel) { return sel.split(',').some((part) => { const m = part.trim().match(/^([a-z0-9]*)((?:\.[\w-]+)*)(?:\[(\w+)="([^"]*)"\])?$/i); if (!m) return false; const [, tag, cl, an, av] = m;
    return (!tag || this.tagName === tag.toUpperCase()) && cl.split('.').filter(Boolean).every((c) => this.cls.has(c)) && (!an || this.attrs[an] === av); }); }
  querySelectorAll(sel) { const out = []; this.walk((c) => { if (c.matches(sel)) out.push(c); }); return out; } querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const doc = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (t) => ({ nodeType: 3, text: String(t) }), body: new El('body'), addEventListener() {}, removeEventListener() {} };
globalThis.document = doc; globalThis.window = { confirm: () => true, prompt: () => 'X' };
const h = (tag, attrs = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};
const ui = await import('../public/academic-ui.mjs');
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/academic-ui.mjs', import.meta.url), 'utf8');
test('the academic screens never build markup from strings and hold no secrets', () => { assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/); assert.doesNotMatch(source, /apiKey|secret/i); });
const tick = () => new Promise((r) => setTimeout(r, 0));
const find = (root, tag, text) => { const hits = []; root.walk((c) => { if (c.tagName === tag.toUpperCase() && c.textContent.includes(text)) hits.push(c); }); return hits; };
const press = (root, tag, text, nth = 0) => { const l = find(root, tag, text); assert.ok(l[nth], 'missing ' + tag + ' "' + text + '"'); l[nth].click(); return l[nth]; };

const makeProfile = () => ({ email: 'o@x.in', centreName: 'Bright', ownerName: 'Aziz', address: '12 Main Road', pin: '711101', mobile: '+919830012345', teachingMode: 'offline',
  classes: ['Class 5', 'Class 6', 'Class 10'], subjects: ['English', 'Bengali', 'Mathematics', 'Science', 'General Knowledge', 'Physics'], classSubjects: { 'Class 10': ['English', 'Physics'] }, templates: [] });
function setup() {
  const calls = []; const profile = makeProfile(); const inst = { name: 'Bright', type: 'coaching', role: 'owner', profile };
  const api = async (fn, data) => { calls.push({ fn, data }); if (fn === 'tuitionFees') return { items: globalThis.__feeItems || [] }; return { ok: true, name: 'Bright' }; };
  const body = new El('main'); const nav = [];
  ui.mountSettings({ inst, profile, api, h, body, go: (to) => nav.push(to), say: (el, t, ok) => { el.textContent = t; }, failText: (e) => String(e.message), fieldErrors: () => ({}), showErrors() {}, field: (l, i) => h('label', {}, l, i), inp: (n, t, v) => h('input', { name: n, type: t, value: v }), sel: (n, o, v) => h('select', { name: n }, o.map((x) => h('option', { value: x }, x))), brandingMount: null });
  return { calls, profile, body, nav };
}

test('Academic Setup shows real numbers and the five areas', () => {
  const { body } = setup(); press(body, 'button', 'Academic Setup');
  const txt = body.textContent; assert.match(txt, /Active classes3/); assert.match(txt, /Subject library6/); assert.match(txt, /Configured classes1\/3/); assert.match(txt, /Curriculum templates0/);
  for (const n of ['Classes offered', 'Subject library', 'Class-subject mapping', 'Curriculum templates', 'Admission preferences']) assert.ok(find(body, 'button', n).length, n);
});

test('mapping: ticking subjects for Class 5 and saving sends only the class subjects, and other classes keep theirs', async () => {
  const { body, calls, profile } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Class-subject mapping');
  press(body, 'button', 'English'); press(body, 'button', 'Mathematics'); press(body, 'button', 'Save changes'); await tick();
  const save = calls.find((c) => c.fn === 'institutionProfileSave'); assert.ok(save);
  assert.deepEqual(save.data.values.classSubjects['Class 5'], ['English', 'Mathematics']); assert.deepEqual(save.data.values.classSubjects['Class 10'], ['English', 'Physics']);
  assert.deepEqual(profile.classSubjects['Class 5'], ['English', 'Mathematics']);
});

test('mapping: switching class with unsaved changes asks first, and a refused warning keeps the class', () => {
  const { body } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Class-subject mapping'); press(body, 'button', 'English');
  let asked = 0; window.confirm = () => { asked += 1; return false; }; press(body, 'button', 'Class 6'); assert.equal(asked, 1); assert.match(body.textContent, /Class 5\d+ selected/);
  window.confirm = () => true;
});

test('copy to classes: merge keeps existing subjects, replace swaps them, and the preview shows the change', async () => {
  window.confirm = () => true; doc.body.children = [];
  const { body, calls } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Class-subject mapping'); press(body, 'button', 'English'); press(body, 'button', 'Bengali');
  press(body, 'button', 'Copy to classes'); const dlg = doc.body.children[0]; assert.ok(dlg, 'dialog opens');
  press(dlg, 'button', 'Class 10'); assert.match(dlg.textContent, /Class 10: 2 → 3 subjects/);
  const replace = dlg.querySelectorAll('input').find((i) => i.attrs.value === 'replace'); replace.dispatch('change'); assert.match(dlg.textContent, /Class 10: 2 → 2 subjects \(replaces 2 existing\)/);
  press(dlg, 'button', 'Apply'); await tick();
  const save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); assert.deepEqual(save.data.values.classSubjects['Class 10'], ['English', 'Bengali']); assert.equal(doc.body.children.length, 0, 'dialog closes');
});

test('templates: create, apply to a class without touching others, edit does not change classes', async () => {
  window.confirm = () => true; doc.body.children = [];
  const { body, calls, profile } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Curriculum templates'); press(body, 'button', 'Create template');
  const ed = doc.body.children[0]; ed.querySelectorAll('input').find((i) => i.attrs['aria-label'] === 'Template name').value = 'Foundation'; press(ed, 'button', 'English'); press(ed, 'button', 'Science'); press(ed, 'button', 'Save template'); await tick();
  let save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); const t = save.data.values.templates[0]; assert.equal(t.name, 'Foundation'); assert.deepEqual(t.subjects, ['English', 'Science']); assert.match(t.id, /^TP-/);
  assert.deepEqual(profile.classSubjects, { 'Class 10': ['English', 'Physics'] }, 'saving a template changes no class');
  press(body, 'button', 'Apply to classes'); const dlg = doc.body.children[0]; press(dlg, 'button', 'Class 5'); press(dlg, 'button', 'Apply'); await tick();
  save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); assert.deepEqual(save.data.values.classSubjects['Class 5'], ['English', 'Science']); assert.deepEqual(save.data.values.templates[0].classes, ['Class 5']);
});

test('classes offered: switching a class off keeps its subject mapping; an empty list is refused by the server rules, not lost here', async () => {
  const { body, calls } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Classes offered'); press(body, 'button', 'Class 10'); press(body, 'button', 'Save classes'); await tick();
  const save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); assert.deepEqual(save.data.values, { classes: ['Class 5', 'Class 6'] }); assert.equal('classSubjects' in save.data.values, false, 'the mapping is not sent, so it is kept');
});

test('subject library: duplicates are refused case-insensitively and a custom subject can be added and archived', async () => {
  const { body, calls } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Subject library');
  const box = body.querySelectorAll('input').find((i) => i.attrs['aria-label'] === 'Custom subject'); box.value = 'mathematics'; press(body, 'button', 'Add subject'); assert.match(body.textContent, /already in the list/);
  box.value = 'Robotics'; press(body, 'button', 'Add subject'); press(body, 'button', 'Archive'); press(body, 'button', 'Save library'); await tick();
  const save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); assert.deepEqual(save.data.values.archivedSubjects, ['Robotics']); assert.equal(save.data.values.subjects.includes('Robotics'), false);
});

test('student card: choosing a class fills its subjects, an unconfigured class warns, and the hidden fields carry the subjects', () => {
  window.confirm = () => true; const profile = makeProfile(); profile.classSubjects['Class 5'] = ['English', 'Mathematics']; profile.admissionPrefs = {};
  const card = ui.subjectsCard({ h, profile, current: [], editing: false, go() {} });
  card.useClass('Class 5'); assert.match(card.textContent, /2 subjects automatically assigned from Class 5 academic settings/);
  assert.deepEqual(card.querySelectorAll('input').map((i) => i.attrs.value), ['English', 'Mathematics']); assert.ok(card.querySelectorAll('input').every((i) => i.attrs.name === 'subjects[]'));
  card.useClass('Class 6'); assert.match(card.textContent, /No default subjects have been configured for this class\./); assert.equal(card.querySelectorAll('input').length, 0);
  assert.ok(find(card, 'button', 'Configure class subjects').length && find(card, 'button', 'Select subjects manually').length);
});

test('student card: a customised student is not overwritten without asking, and a refusal keeps the subjects', () => {
  const profile = makeProfile(); profile.classSubjects['Class 5'] = ['English']; const card = ui.subjectsCard({ h, profile, current: ['Hindi', 'Dance'], editing: true, go() {} });
  let asked = 0; window.confirm = () => { asked += 1; return false; }; card.useClass('Class 5'); assert.equal(asked, 1); assert.deepEqual(card.querySelectorAll('input').map((i) => i.attrs.value), ['Hindi', 'Dance']);
  window.confirm = () => true; card.useClass('Class 5'); assert.deepEqual(card.querySelectorAll('input').map((i) => i.attrs.value), ['English']);
});

test('student card: preferences switch auto-assign off and hide the chips', () => {
  const profile = makeProfile(); profile.classSubjects['Class 5'] = ['English']; profile.admissionPrefs = { autoAssign: false, showAssigned: false };
  const card = ui.subjectsCard({ h, profile, current: [], editing: false, go() {} }); card.useClass('Class 5'); assert.equal(card.querySelectorAll('input').length, 0); assert.equal(card.querySelectorAll('.chip').length, 0);
});

test('preferences save sends all six switches', async () => {
  const { body, calls } = setup(); press(body, 'button', 'Academic Setup'); press(body, 'button', 'Admission preferences'); press(body, 'button', 'Save preferences'); await tick();
  const save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); assert.deepEqual(Object.keys(save.data.values.admissionPrefs).sort(), ['allowCustomise', 'autoAssign', 'autoDate', 'autoTime', 'showAssigned', 'warnUnconfigured']);
});

test('Settings remembers where you were across a refresh, and West Bengal science subjects are in the library', () => {
  const saved = []; globalThis.location = { hash: '#Settings/academic/mapping' }; globalThis.history = { replaceState: (a, b, url) => { saved.push(url); } };
  const { body } = setup(); assert.match(body.textContent, /Class-subject mapping/); assert.match(body.textContent, /Class 5/); assert.ok(saved.includes('#Settings/academic/mapping'));
  press(body, 'button', 'Fee Settings'); assert.equal(saved.at(-1), '#Settings/fees');
  assert.ok(ui.ALL_SUBJECTS.includes('Physical Science') && ui.ALL_SUBJECTS.includes('Life Science'));
  delete globalThis.location; delete globalThis.history;
});

test('class-wise fees: amounts are saved in paise, bad amounts are refused, empty means not set', async () => {
  const { body, calls } = setup(); press(body, 'button', 'Fee Settings'); assert.match(body.textContent, /Class-wise fees/); assert.match(body.textContent, /Class 5/);
  const box = (n) => body.querySelectorAll('input').find((i) => i.attrs['aria-label'] === 'Monthly fee for ' + n);
  box('Class 5').value = '1500'; box('Class 6').value = '999.5'; box('Class 10').value = 'abc'; press(body, 'button', 'Save class fees'); await tick();
  assert.match(body.textContent, /Enter the fee for Class 10/); assert.equal(calls.filter((c) => c.fn === 'institutionProfileSave').length, 0);
  box('Class 10').value = ''; press(body, 'button', 'Save class fees'); await tick();
  const save = calls.filter((c) => c.fn === 'institutionProfileSave').pop(); assert.deepEqual(save.data.values.classFees, { 'Class 5': 150000, 'Class 6': 99950 });
});

test('students by class: classes list totals, a class opens its students with paid, partial, unpaid and overdue, and the filter works', async () => {
  globalThis.__feeItems = [
    { studentId: 'ST-A', studentName: 'Anika', className: 'Class 5', guardianMobile: '+911', amountPaise: 150000, paidPaise: 150000, balancePaise: 0, prevDuePaise: 0, status: 'paid' },
    { studentId: 'ST-B', studentName: 'Bimal', className: 'Class 5', guardianMobile: '+912', amountPaise: 150000, paidPaise: 50000, balancePaise: 100000, prevDuePaise: 0, status: 'unpaid' },
    { studentId: 'ST-C', studentName: 'Chitra', className: 'Class 5', guardianMobile: '+913', amountPaise: 150000, paidPaise: 0, balancePaise: 150000, prevDuePaise: 100000, status: 'overdue' },
    { studentId: 'ST-D', studentName: 'Dev', className: 'Class 6', guardianMobile: '+914', amountPaise: 160000, paidPaise: 0, balancePaise: 160000, prevDuePaise: 0, status: 'unpaid' }];
  const { body, calls } = setup(); press(body, 'button', 'Fee Settings'); press(body, 'button', 'Students by class'); await tick(); await tick();
  assert.equal(calls.filter((c) => c.fn === 'tuitionFees').length, 1); assert.match(body.textContent, /Class 53 students/); assert.match(body.textContent, /Class 61 student/); assert.match(body.textContent, /1 paid/);
  press(body, 'button', 'Class 5'); await tick(); await tick(); const t = body.textContent;
  for (const n of ['Anika', 'Bimal', 'Chitra']) assert.ok(t.includes(n), n); assert.ok(!t.includes('Dev')); assert.match(t, /Paid/); assert.match(t, /Partial/); assert.match(t, /Overdue/); assert.match(t, /₹1,000/);
  press(body, 'button', 'Partial'); await tick(); await tick(); assert.ok(body.textContent.includes('Bimal') && !body.textContent.includes('Anika'));
  assert.equal(calls.filter((c) => c.fn === 'tuitionFees').length, 1, 'switching class or filter does not read again');
  delete globalThis.__feeItems;
});
