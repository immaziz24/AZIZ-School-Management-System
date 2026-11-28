// Tests for Tuition & Coaching free registration (Phase 1): the server rules, the plan allowlist, routing and the pages.
// The functions file needs the Firebase packages to load, so the pure block is cut out of the source and run on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodeCrypto from 'node:crypto';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('functions/index.js');
const block = src.match(/\/\/ --- institution rules begin[\s\S]*?\/\/ --- institution rules end ---/);
assert.ok(block, 'institution rules block is missing');
const code = 'class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }\n' + block[0];
const lib = new Function('nodeCrypto', code + '\n; return { INSTITUTION_TYPES, FREE_PLANS, institutionEntitlements, tenantIdFor, TENANT_ID, checkInstitution, buildInstitutionRecords };')(nodeCrypto);

const tuition = { fullName: 'Rina Das', email: 'RINA@example.com', mobile: '+91 98300 12345', locality: 'Salt Lake', subjects: ['Mathematics', 'Physics'], classes: 'Class 9,Class 10', teachingMode: 'hybrid', termsAccepted: true };
const coaching = { centreName: 'Bright Path Coaching', ownerName: 'A Owner', email: 'o@bp.in', mobile: '+919830012345', address: '12 Main Road, Howrah, West Bengal', pin: '711101',
  establishmentYear: '2015', teacherEstimate: '6', studentEstimate: '120', classes: ['Class 8'], subjects: ['English'], teachingMode: 'offline', termsAccepted: true };

test('plans come from an allowlist with the agreed limits', () => {
  assert.deepEqual(lib.INSTITUTION_TYPES, ['tuition', 'coaching']);
  const t = lib.institutionEntitlements('tuition'), c = lib.institutionEntitlements('coaching');
  assert.equal(t.planId, 'tuition_free'); assert.equal(c.planId, 'coaching_free');
  assert.equal(t.featureIds.length, 20); assert.equal(c.featureIds.length, 30);
  assert.deepEqual(t.limits, { activeStudents: 100, owners: 1, extraTeachers: 0, batches: 10, storageBytes: 10 * 1024 * 1024 });
  assert.deepEqual(c.limits, { activeStudents: 250, owners: 1, extraTeachers: 5, batches: 20, storageBytes: 50 * 1024 * 1024 });
  assert.equal(t.subscriptionInr, 0); assert.equal(t.trialExpiry, false); assert.equal(t.brandingRequired, true);
  assert.throws(() => lib.institutionEntitlements('premium'));
});

test('a valid tuition form is accepted and cleaned', () => {
  const r = lib.checkInstitution('tuition', tuition);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.clean.email, 'rina@example.com');
  assert.deepEqual(r.clean.classes, ['Class 9', 'Class 10']);
  assert.equal(r.clean.tuitionName, 'Rina Das', 'the teacher name is the default tuition name');
  assert.equal(r.clean.displayName, 'Rina Das');
});

test('a valid coaching form is accepted', () => {
  const r = lib.checkInstitution('coaching', coaching, 2026);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.clean.establishmentYear, 2015); assert.equal(r.clean.teacherEstimate, 6); assert.equal(r.clean.displayName, 'Bright Path Coaching');
});

test('invalid fields are refused with a message each', () => {
  const bad = lib.checkInstitution('tuition', { ...tuition, email: 'nope', mobile: 'abc', fullName: ' ', locality: '', subjects: [], classes: [], teachingMode: 'space', termsAccepted: false });
  assert.equal(bad.ok, false);
  for (const k of ['email', 'mobile', 'fullName', 'locality', 'subjects', 'classes', 'teachingMode', 'termsAccepted']) assert.ok(bad.errors[k], k);
  const c = lib.checkInstitution('coaching', { ...coaching, pin: '12345', establishmentYear: '2099', teacherEstimate: '-3', studentEstimate: '1.5', address: 'short' }, 2026);
  for (const k of ['pin', 'establishmentYear', 'teacherEstimate', 'studentEstimate', 'address']) assert.ok(c.errors[k], k);
  assert.equal(lib.checkInstitution('school', tuition).ok, false);
});

test('terms must be accepted as the real value true', () => {
  for (const v of ['true', 1, 'yes', undefined]) assert.equal(lib.checkInstitution('tuition', { ...tuition, termsAccepted: v }).ok, false, String(v));
});

test('role, plan, status and limits can never come from the form', () => {
  const evil = { ...tuition, role: 'admin', planId: 'coaching_free', status: 'active', limits: { activeStudents: 99999 }, ownerUid: 'someone-else', type: 'coaching' };
  const r = lib.checkInstitution('tuition', evil);
  assert.equal(r.ok, true);
  const recs = lib.buildInstitutionRecords('tuition', r.clean, { uid: 'u1', tenantId: lib.tenantIdFor('u1'), terms: 'T', privacy: 'P', now: 'NOW' });
  assert.equal(recs.institution.planId, 'tuition_free'); assert.equal(recs.institution.limits.activeStudents, 100);
  assert.equal(recs.institution.ownerUid, 'u1'); assert.equal(recs.membership.role, 'owner'); assert.equal(recs.institution.type, 'tuition');
  assert.equal(recs.institution.profile.role, undefined); assert.equal(recs.institution.profile.planId, undefined);
  assert.equal(JSON.stringify(recs).includes('password'), false, 'no password is ever stored');
  assert.deepEqual(recs.institution.usage, { activeStudents: 0, batches: 0, extraTeachers: 0, storageBytes: 0 });
  assert.equal(recs.institution.consent.terms, 'T');
});

test('the tenant id is stable per account and different between accounts', () => {
  assert.equal(lib.tenantIdFor('u1'), lib.tenantIdFor('u1'));
  assert.notEqual(lib.tenantIdFor('u1'), lib.tenantIdFor('u2'));
  assert.match(lib.tenantIdFor('u1'), lib.TENANT_ID);
});

test('the server functions exist, require sign-in, and the email must be verified before provisioning', () => {
  for (const name of ['registerInstitution', 'resolveMyInstitutions', 'sendInstitutionVerification']) assert.match(src, new RegExp('exports\\.' + name + ' = onCall'), name);
  const reg = src.match(/exports\.registerInstitution = onCall[\s\S]*?\n\}\);/)[0];
  assert.match(reg, /email_verified !== true/); assert.match(reg, /runTransaction/); assert.match(reg, /tx\.create\(instRef/);
  assert.match(reg, /request\.auth\.token\.email/, 'the email comes from the account');
  assert.equal(/data\.(role|planId|status|limits)/.test(reg), false, 'nothing privileged is read from the request');
});

test('the rules file did not grow and no password field is written to the database', () => {
  assert.equal(readFileSync(new URL('../firestore.rules', import.meta.url)).length, 204667);
  const page = read('public/register.mjs');
  assert.equal(/localStorage\.setItem\([^)]*password/.test(page), false);
  assert.match(page, /delete v\.password/);
});

test('Registration is in the navigation of all eight marketing pages, between Sign in and Start free trial', () => {
  for (const p of ['index', 'features', 'pricing', 'about', 'contact', 'security', 'privacy', 'terms', 'register']) {
    const html = read('public/site/' + p + '.html');
    assert.match(html, /href="\/app">Sign in<\/a><a class="btn" href="\/register">Registration<\/a><a class="btn gold-bg" href="\/app#signup">Start free trial<\/a>/, p);
  }
});

test('routing: /register, /tuition and /coaching are mapped and the new modules are whitelisted', () => {
  const ht = read('.htaccess');
  assert.match(ht, /\(features\|pricing\|about\|contact\|security\|privacy\|terms\|register\)/);
  assert.match(ht, /\^\(tuition\|coaching\)\/\?\$ public\/institution\.html/);
  const list = ht.match(/RewriteRule \^\(sign-in[^\n]*/)[0];
  for (const f of ['register\\.mjs', 'institution\\.mjs', 'onboarding\\.mjs', 'consent\\.mjs']) assert.ok(list.includes(f), f);
  assert.match(ht, /school-trial|app#signup|\^app\$ public\/index\.html/);
});

test('the school sign-in and trial links are unchanged', () => {
  const home = read('public/site/index.html');
  assert.match(home, /href="\/app">Sign in</); assert.match(home, /Start free trial/);
  const signIn = read('public/sign-in.mjs');
  assert.ok(signIn.length > 600000, 'the school app file is untouched');
});

test('every page file referenced by the portal and the form exists', () => {
  for (const f of ['public/institution.html', 'public/institution.mjs', 'public/register.mjs', 'public/site/register.html']) assert.ok(read(f).length > 500, f);
  assert.match(read('public/site/register.html'), /\/register\.mjs\?v=/);
  assert.match(read('public/institution.html'), /\/institution\.mjs\?v=/);
  const portal = read('public/institution.mjs');
  assert.match(portal, /Account restricted/); assert.match(portal, /resolveMyInstitutions/);
  for (const n of ['Students', 'Batches', 'Fees', 'Attendance', 'Reports', 'Settings', 'Teachers', 'Timetable', 'Examinations', 'Announcements']) assert.ok(portal.includes("'" + n + "'"), n);
});

test('subjects for each class: only chosen classes are kept, cleaned, and unsafe keys are dropped', () => {
  const ok = lib.checkInstitution('coaching', { ...coaching, classes: ['Class 8', 'Class 9'], classSubjects: { 'Class 8': ['English', ' Maths ', 'English'], 'Class 9': 'Physics,Chemistry', 'Class 10': ['History'], __proto__x: ['A'] } });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.clean.classSubjects).sort(), ['Class 8', 'Class 9']);
  assert.deepEqual(ok.clean.classSubjects['Class 9'], ['Physics', 'Chemistry']);
  assert.ok(ok.clean.classSubjects['Class 8'].includes('Maths'));
  const bad = lib.checkInstitution('coaching', { ...coaching, classes: ['__x__', 'a/b', 'Class 8'], classSubjects: { '__x__': ['E'], 'a/b': ['E'], 'Class 8': ['E'] } });
  assert.deepEqual(Object.keys(bad.clean.classSubjects), ['Class 8']);
  assert.deepEqual(lib.checkInstitution('coaching', coaching).clean.classSubjects, {});
  assert.deepEqual(lib.checkInstitution('coaching', { ...coaching, classSubjects: 'oops' }).clean.classSubjects, {});
});

test('the student form fills subjects from the class and Settings has a subjects-for-each-class section', () => {
  const ui = read('public/tuition-ui.mjs');
  assert.match(ui, /useClass/); assert.match(ui, /linkClass\(classSel/); assert.match(ui, /Subjects for each class/); assert.match(ui, /values\.classSubjects = kept/);
});
