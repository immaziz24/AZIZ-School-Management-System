// Tests for the Super Admin controls for tuition and coaching (Phase 4): rules, authorization, audit and the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('functions/index.js');
const blocks = ['institution rules', 'tuition rules', 'coaching rules', 'institution admin rules'].map((n) => { const m = src.match(new RegExp('// --- ' + n + ' begin[\\s\\S]*?// --- ' + n + ' end'));
  assert.ok(m, n + ' block missing'); return m[0].replace(/\/\/ --- [a-z ]+ (begin|end)[^\n]*/g, ''); });
const lib = new Function('HttpsError', 'nodeCrypto', 'FieldValue', blocks.join('\n') + '\n; return { checkLimits, checkReason, checkReasonOptional, cleanFeatures, activityState, summarizeInstitutions, estimateRecords, institutionEntitlements, buildInstitutionRecords, ADMIN_FEATURE_KEYS };')(class extends Error {}, {}, {});
const bodyOf = (name) => { const i = src.indexOf('exports.' + name + ' = '); assert.ok(i > 0, name + ' missing'); const j = src.indexOf('\nexports.', i + 10); return src.slice(i, j > 0 ? j : undefined); };
const ADMIN_CALLS = ['adminInstitutionList', 'adminInstitutionDetail', 'adminInstitutionSetStatus', 'adminInstitutionSetLimits', 'adminInstitutionSetFeatures', 'adminInstitutionPlanGet', 'adminInstitutionPlanSave', 'adminInstitutionSetConversion', 'adminInstitutionCost', 'adminInstitutionPrivateAccess'];

test('quota limits: whole numbers inside fixed bounds, storage kept in bytes', () => {
  const ok = lib.checkLimits({ activeStudents: '300', extraTeachers: 5, batches: 25, storageMB: '60' });
  assert.equal(ok.ok, true); assert.equal(ok.limits.storageBytes, 60 * 1048576); assert.equal(ok.limits.activeStudents, 300);
  for (const bad of [{ activeStudents: -1 }, { activeStudents: 5001 }, { activeStudents: 1.5 }, { activeStudents: 'x' }]) assert.equal(lib.checkLimits({ activeStudents: 10, extraTeachers: 0, batches: 1, storageMB: 1, ...bad }).ok, false);
  assert.equal(lib.checkLimits({ activeStudents: 10, extraTeachers: 0, batches: 1, storageMB: 0 }).ok, false); assert.equal(lib.checkLimits({}).ok, false);
});

test('a reason is required (5 to 300 characters)', () => {
  assert.equal(lib.checkReason('Payment dispute').ok, true); assert.equal(lib.checkReason('no').ok, false); assert.equal(lib.checkReason('   ').ok, false); assert.equal(lib.checkReason('x'.repeat(301)).ok, false); assert.equal(lib.checkReason(undefined).ok, false);
});

test('feature switches: only known keys for the type, only true or false', () => {
  assert.deepEqual(lib.cleanFeatures('tuition', { attendance: false, reports: true, exams: false, hack: false }), { attendance: false, reports: true });
  assert.equal(lib.cleanFeatures('coaching', { exams: false }).exams, false); assert.equal(lib.cleanFeatures('coaching', {}).timetable, true);
});

test('activity: never, active within 30 days, inactive after', () => {
  const now = Date.UTC(2026, 10, 28); assert.equal(lib.activityState(0, now), 'never'); assert.equal(lib.activityState(now - 29 * 86400000, now), 'active'); assert.equal(lib.activityState(now - 31 * 86400000, now), 'inactive');
});

test('totals are kept apart for tuition and coaching and count status, activity and conversion', () => {
  const now = Date.UTC(2026, 10, 28); const row = (type, o) => ({ type, status: 'active', lastSeenMs: now - 1000, usage: { activeStudents: 10, batches: 2, extraTeachers: 1, storageBytes: 100 }, conversion: 'none', ...o });
  const t = lib.summarizeInstitutions([row('tuition', {}), row('tuition', { status: 'suspended', lastSeenMs: 0 }), row('coaching', { conversion: 'interested' }), row('coaching', { conversion: 'converted', lastSeenMs: now - 40 * 86400000 }), row('other', {})], now);
  assert.equal(t.tuition.accounts, 2); assert.equal(t.tuition.suspended, 1); assert.equal(t.tuition.students, 20); assert.equal(t.tuition.never, 1);
  assert.equal(t.coaching.accounts, 2); assert.equal(t.coaching.interested, 1); assert.equal(t.coaching.converted, 1); assert.equal(t.coaching.inactive, 1); assert.equal(t.coaching.students, 20);
});

test('cost numbers are labelled as estimates and grow with students', () => {
  assert.ok(lib.estimateRecords({ activeStudents: 100 }).records > lib.estimateRecords({ activeStudents: 10 }).records); assert.equal(lib.estimateRecords(undefined).records, 0);
  assert.match(bodyOf('adminInstitutionCost'), /estimate: true/); assert.match(bodyOf('adminInstitutionCost'), /not a bill/);
  assert.match(read('public/institutions-admin.mjs'), /ESTIMATE, not a bill/);
});

test('new accounts start from the saved free plan version, and the default plan is unchanged when nothing is saved', () => {
  const d = lib.institutionEntitlements('coaching'); assert.equal(d.limits.activeStudents, 250); assert.equal(d.version, 1);
  const o = lib.institutionEntitlements('coaching', { version: 3, limits: { activeStudents: 300 }, features: { exams: false } }); assert.equal(o.limits.activeStudents, 300); assert.equal(o.limits.batches, 20); assert.equal(o.version, 3); assert.equal(o.features.exams, false);
  assert.match(bodyOf('registerInstitution'), /platformConfig\/institutionPlans/); assert.equal(lib.institutionEntitlements('tuition').limits.extraTeachers, 0);
});

test('every admin function checks the platform administrator first and changes need a reason and an audit record', () => {
  for (const n of ADMIN_CALLS) assert.match(bodyOf(n), /requirePlatformAdmin\(request\)/, n);
  for (const n of ['adminInstitutionSetStatus', 'adminInstitutionSetLimits', 'adminInstitutionSetFeatures', 'adminInstitutionPlanSave', 'adminInstitutionPrivateAccess']) { assert.match(bodyOf(n), /checkReason/, n); assert.match(bodyOf(n), /adminAudit\(/, n); }
  assert.match(bodyOf('adminInstitutionSetConversion'), /adminAudit\(/);
  assert.match(src, /const adminAudit = [\s\S]*platformAudit\/[\s\S]*actorEmail/);
});

test('private records: audit is written BEFORE any record is read, only names and amounts, at most 100 rows', () => {
  const b = bodyOf('adminInstitutionPrivateAccess'); assert.ok(b.indexOf('adminAudit(') < b.indexOf("collection('students')")); assert.ok(b.indexOf('adminAudit(') < b.indexOf("collection('payments')"));
  assert.match(b, /limit\(100\)/); assert.doesNotMatch(b, /password|token/i);
});

test('detail view never returns passwords and uses only Auth facts', () => {
  const b = bodyOf('adminInstitutionDetail'); assert.match(b, /emailVerified/); assert.doesNotMatch(b, /passwordHash|password:/i); assert.match(b, /audit/);
});

test('suspension: reason required, state saved; a suspended account is refused by every action', () => {
  assert.match(bodyOf('adminInstitutionSetStatus'), /update\(\{ status, statusReason/); assert.match(bodyOf('adminInstitutionSetStatus'), /statusReason/);
  assert.match(src, /async function requireMember[\s\S]*status !== 'active'\) throw new HttpsError\('failed-precondition', 'This account is suspended/);
});

test('quota changes bump the entitlement version and keep history', () => {
  const b = bodyOf('adminInstitutionSetLimits'); assert.match(b, /entitlementVersion: version/); assert.match(b, /entitlementHistory/); assert.match(b, /runTransaction/); assert.match(b, /Tuition accounts have no extra teachers/);
});

test('a switched-off feature is refused by the server for the owner and the teacher', () => {
  assert.match(src, /async function requireMember[\s\S]*features \|\| \{\}\)\[feature\] === false/);
  const keys = lib.ADMIN_FEATURE_KEYS; assert.deepEqual(keys.tuition, ['attendance', 'reports']);
  const used = new Set([...src.matchAll(/require(?:Coaching|Member)\(request, [a-z.]+, \['owner'(?:, 'teacher')?\], '([a-z]+)'\)/g)].map((m) => m[1])); for (const k of keys.coaching) assert.ok(used.has(k), 'no function enforces ' + k);
});

test('conversion: owners can only say they are interested; the administrator records the rest', () => {
  assert.match(bodyOf('institutionUpgradeInterest'), /requireInstitution/); assert.match(bodyOf('institutionUpgradeInterest'), /'interested'/); assert.doesNotMatch(bodyOf('institutionUpgradeInterest'), /request\.data\.state/);
});

test('free accounts stay out of school revenue: school billing code never reads institutions', () => {
  const admin = read('public/admin.mjs'); const withoutNew = admin.replace(/institutions-admin\.mjs[^\n]*/g, ''); assert.doesNotMatch(withoutNew, /collection\(db, 'institutions'\)|doc\(db, 'institutions'/);
  const billing = src.slice(src.indexOf('runBillingNow')); assert.doesNotMatch(bodyOf('runBillingNow'), /institutions/);
});

test('the Super Admin page: new menu item, admin-only route, whitelisted module, no innerHTML, no secrets', () => {
  const html = read('public/admin.html'); assert.match(html, /data-r="institutions" href="#\/institutions"/); assert.match(html, /admin\.mjs\?v=batch-\d+/);
  const admin = read('public/admin.mjs'); assert.match(admin, /name === 'institutions'/); assert.doesNotMatch(admin.match(/ROUTE_PERM = [^\n]*/)[0], /institutions/);
  const ui = read('public/institutions-admin.mjs'); assert.doesNotMatch(ui, /innerHTML/); assert.doesNotMatch(ui, /apiKey|secret/i);
  for (const n of [...ADMIN_CALLS.filter((x) => x !== 'adminInstitutionPlanGet'), 'adminInstitutionPlanGet']) assert.ok(ui.includes("'" + n + "'"), n);
  assert.match(read('.htaccess'), /institutions-admin\\\.mjs/); assert.match(read('tests/run-tests.cmd'), /tests\/institutionadmin\.test\.mjs/);
});

test('firestore.rules is untouched by this phase', () => {
  const rules = read('firestore.rules'); for (const w of ['adminInstitution', 'institutionPlans', 'teacherInvites']) assert.doesNotMatch(rules, new RegExp(w));
});

test('changes need no reason, but one is kept when typed; private records still need one', () => {
  assert.equal(lib.checkReasonOptional('').ok, true); assert.equal(lib.checkReasonOptional('').reason, 'No reason given'); assert.equal(lib.checkReasonOptional(' Fee help ').reason, 'Fee help'); assert.equal(lib.checkReasonOptional('x'.repeat(301)).ok, false);
  for (const n of ['adminInstitutionSetStatus', 'adminInstitutionSetLimits', 'adminInstitutionSetFeatures', 'adminInstitutionPlanSave']) assert.match(bodyOf(n), /checkReasonOptional/, n);
  assert.doesNotMatch(bodyOf('adminInstitutionPrivateAccess'), /checkReasonOptional/); assert.match(bodyOf('adminInstitutionPrivateAccess'), /checkReason\(/);
});
