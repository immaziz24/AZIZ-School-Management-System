// Unit tests for the registration field registry (Registration Marks 1 and 2, Batches 98 and 99): required rules, conditional fields, formats and progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/onboarding.mjs', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { FIELDS, CATEGORIES, fieldProblem, stepProblems, stepDone, progressOf, CLASS_LADDER, WEEK_DAYS, ATTENDANCE_METHODS, EXAM_SYSTEMS, GRADING_SYSTEMS, PAYMENT_METHODS, CURRENCIES, THEME_PALETTES, DOMAIN_PREFERENCES, UPLOAD_LIMITS, LOGIN_ROLES, INVITATION_METHODS, TWO_FACTOR_POLICIES, RETENTION_OPTIONS, VERIFICATION_STATUSES, BILLING_CYCLES } = mod;

const good = {
  name: 'Green Valley School', schoolType: 'Private unaided', schoolLevel: 'Secondary', genderComposition: 'Co-educational', medium: 'English',
  board: 'state', country: 'India', state: 'West Bengal', district: 'Howrah', town: 'Howrah', street: '12 Main Road', pin: '711101',
  schoolPhone: '9830012345', schoolEmail: 'office@gv.in', ownerName: 'A Owner', ownerDesignation: 'Chairman', ownerEmail: 'owner@gv.in', ownerMobile: '+91 98300 12345',
  sessionLabel: '2026-27', lowestClass: 'Class 1', highestClass: 'Class 10', studentCount: '420', teacherCount: '24',
};
const field = (key) => FIELDS.find((f) => f.key === key);

test('the registry covers the 119 form fields of categories A to O with no duplicates', () => {
  assert.equal(FIELDS.length, 119);
  assert.equal(new Set(FIELDS.map((f) => f.key)).size, 119);
  assert.equal(new Set(FIELDS.map((f) => f.id)).size, 119);
  assert.deepEqual([...new Set(FIELDS.map((f) => f.cat))], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']);
  assert.equal(CATEGORIES.length, 15);
});

test('required fields are reported when empty and pass when filled', () => {
  assert.match(fieldProblem(field('name'), {}), /required/);
  assert.equal(fieldProblem(field('name'), good), '');
  assert.equal(fieldProblem(field('motto'), {}), '');
});

test('the affiliation number is hidden and unchecked for no board or the state board, and required for CBSE', () => {
  assert.equal(fieldProblem(field('affiliationNo'), { ...good, board: 'state' }), '');
  assert.equal(fieldProblem(field('affiliationNo'), { ...good, board: 'none' }), '');
  assert.match(fieldProblem(field('affiliationNo'), { ...good, board: 'CBSE' }), /required/);
  assert.equal(fieldProblem(field('affiliationNo'), { ...good, board: 'CBSE', affiliationNo: '2430123' }), '');
});

test('trust fields only apply to trust-run, private unaided and aided schools', () => {
  assert.equal(field('trustName').showIf({ schoolType: 'Government' }), false);
  assert.equal(field('trustName').showIf({ schoolType: 'Trust or society run' }), true);
});

test('email, phone, PIN, year and UDISE formats', () => {
  assert.match(fieldProblem(field('ownerEmail'), { ...good, ownerEmail: 'no-at-sign' }), /valid email/);
  assert.match(fieldProblem(field('schoolPhone'), { ...good, schoolPhone: 'abc' }), /phone/);
  assert.equal(fieldProblem(field('schoolPhone'), { ...good, schoolPhone: '+91 98300-12345' }), '');
  assert.match(fieldProblem(field('pin'), { ...good, pin: '012345' }), /PIN/);
  assert.match(fieldProblem(field('pin'), { ...good, pin: '1234' }), /PIN/);
  assert.equal(fieldProblem(field('pin'), { ...good, country: 'Bangladesh', pin: '1207' }), '');
  assert.match(fieldProblem(field('estYear'), { ...good, estYear: '1700' }), /year/);
  assert.match(fieldProblem(field('estYear'), { ...good, estYear: String(new Date().getFullYear() + 1) }), /year/);
  assert.equal(fieldProblem(field('estYear'), { ...good, estYear: '1998' }), '');
  assert.match(fieldProblem(field('udise'), { ...good, udise: '123' }), /11 digits/);
  assert.equal(fieldProblem(field('udise'), { ...good, udise: '19010100101' }), '');
});

test('selects only accept listed options; the state list applies to India only', () => {
  assert.match(fieldProblem(field('schoolType'), { ...good, schoolType: 'Made up' }), /listed/);
  assert.match(fieldProblem(field('state'), { ...good, state: 'Atlantis' }), /listed/);
  assert.equal(fieldProblem(field('state'), { ...good, country: 'Bangladesh', state: 'Dhaka Division' }), '');
});

test('too-long values are refused', () => {
  assert.match(fieldProblem(field('name'), { ...good, name: 'x'.repeat(121) }), /too long/);
});

test('progress counts valid sections only, not visited ones', () => {
  assert.equal(progressOf({}), 0);
  assert.equal(progressOf(good), 6);
  assert.equal(progressOf({ ...good, principalName: 'A Principal' }), 7);
  const broken = { ...good, pin: 'bad' };
  assert.equal(stepDone('C', broken), false);
  assert.equal(progressOf(broken), 5);
  assert.equal(progressOf({ ...good, ownerEmail: '' }), 5);
  assert.equal(stepProblems('A', {}).length, 5);
});

test('Mark 2: session, class range and sections', () => {
  assert.match(fieldProblem(field('sessionLabel'), { ...good, sessionLabel: '2026-28' }), /2026-27/);
  assert.equal(fieldProblem(field('sessionLabel'), { ...good, sessionLabel: '2099-00' }), '');
  assert.match(fieldProblem(field('highestClass'), { ...good, lowestClass: 'Class 8', highestClass: 'Class 3' }), /below/);
  assert.equal(field('classesOffered').showIf({}), false);
  assert.equal(field('classesOffered').showIf(good), true);
  assert.deepEqual(field('classesOffered').optionsFn(good).length, 10);
  assert.equal(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 1=A,B|Class 2=A' }), '');
  assert.match(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 12=A' }), /not in the class range/);
  assert.match(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 1=A,B,C,D,E,F,G,H,I' }), /at most 8/);
  assert.match(fieldProblem(field('sectionsByClass'), { ...good, sectionsByClass: 'Class 1=A!' }), /letters and numbers/);
  assert.match(fieldProblem(field('subjects'), { ...good, subjects: Array.from({ length: 41 }, (_, i) => 'S' + i).join(',') }), /at most 40/);
  assert.equal(fieldProblem(field('subjects'), { ...good, subjects: 'English,Mathematics,Drawing' }), '');
});

test('Mark 2: counts and capacity', () => {
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '-5' }), /whole number/);
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '2.5' }), /whole number/);
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '100001' }), /or less/);
  assert.match(fieldProblem(field('studentCount'), { ...good, studentCount: '' }), /required/);
  assert.equal(fieldProblem(field('studentCount'), { ...good, studentCount: '0' }), '');
  assert.match(fieldProblem(field('maxCapacity'), { ...good, maxCapacity: '100' }), /lower than/);
  assert.equal(fieldProblem(field('maxCapacity'), { ...good, maxCapacity: '500' }), '');
  assert.match(fieldProblem(field('campusCount'), { ...good, campusCount: '0' }), /1 or more/);
});

test('Mark 2: timing and attendance', () => {
  assert.match(fieldProblem(field('openTime'), { ...good, openTime: '25:00' }), /time/);
  assert.match(fieldProblem(field('closeTime'), { ...good, openTime: '09:00', closeTime: '08:00' }), /after the opening/);
  assert.equal(fieldProblem(field('closeTime'), { ...good, openTime: '09:00', closeTime: '15:30' }), '');
  assert.match(fieldProblem(field('teacherReportTime'), { ...good, closeTime: '15:00', teacherReportTime: '16:00' }), /before the closing/);
  assert.match(fieldProblem(field('weeklyHolidays'), { ...good, workingDays: 'Mon,Sat', weeklyHolidays: 'Sat' }), /both/);
  assert.equal(fieldProblem(field('weeklyHolidays'), { ...good, workingDays: 'Mon,Sat', weeklyHolidays: 'Sun' }), '');
  assert.match(fieldProblem(field('workingDays'), { ...good, workingDays: 'Mon,Funday' }), /listed/);
  assert.equal(field('lateGraceMinutes').showIf({}), false);
  assert.equal(field('lateGraceMinutes').showIf({ teacherReportTime: '08:00' }), true);
});

test('Mark 2: the GPS radius applies only when GPS attendance is chosen', () => {
  const geo = field('geofenceRadius');
  assert.equal(geo.showIf({}), false);
  assert.equal(geo.showIf({ studentAttendanceMethod: 'GPS' }), true);
  assert.equal(geo.showIf({ teacherAttendanceMethods: 'Manual,GPS' }), true);
  assert.equal(stepProblems('H', { ...good, studentAttendanceMethod: 'GPS' }).some((p) => /radius/i.test(p.label || p.message || JSON.stringify(p))), true);
  assert.equal(stepProblems('H', { ...good, studentAttendanceMethod: 'QR code' }).length, 0);
  assert.match(fieldProblem(geo, { ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '5' }), /10 or more/);
  assert.match(fieldProblem(geo, { ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '9000' }), /5000/);
  assert.equal(fieldProblem(geo, { ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '150' }), '');
});

test('Mark 2: fees are optional and checked when given', () => {
  assert.equal(stepProblems('I', {}).length, 0);
  assert.equal(stepDone('I', {}), false);
  assert.equal(stepDone('I', { currency: 'INR' }), false);
  assert.equal(stepDone('I', { admissionFee: '1500.50' }), true);
  assert.match(fieldProblem(field('admissionFee'), { admissionFee: '12.345' }), /2 decimals/);
  assert.match(fieldProblem(field('admissionFee'), { admissionFee: '-1' }), /2 decimals/);
  assert.match(fieldProblem(field('feeDueDay'), { feeDueDay: '31' }), /28 or less/);
  assert.match(fieldProblem(field('paymentMethods'), { paymentMethods: 'Cash,Bitcoin' }), /listed/);
  assert.match(fieldProblem(field('currency'), { currency: 'XYZ' }), /listed/);
});

test('Mark 2: defaults are filled in and are not counted as entered', () => {
  const d = Object.fromEntries(FIELDS.filter((f) => f.def !== undefined).map((f) => [f.key, f.def]));
  assert.equal(d.sessionStartMonth, '4'); assert.equal(d.sessionEndMonth, '3'); assert.equal(d.workingDays, 'Mon,Tue,Wed,Thu,Fri,Sat'); assert.equal(d.weeklyHolidays, 'Sun'); assert.equal(d.currency, 'INR'); assert.equal(d.campusCount, '1');
  assert.equal(stepDone('H', { workingDays: d.workingDays, weeklyHolidays: d.weeklyHolidays }), false);
  assert.equal(stepDone('H', { workingDays: d.workingDays, weeklyHolidays: d.weeklyHolidays, openTime: '08:00' }), true);
});

test('lists for classes, days, attendance and so on are in sync with the server', () => {
  const server = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const list = (name) => { const m = server.match(new RegExp('const ' + name + " = \\[([^\\]]*)\\];")); assert.ok(m, name); return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]); };
  assert.deepEqual(CLASS_LADDER, list('CLASS_LADDER'));
  assert.deepEqual(WEEK_DAYS, list('WEEK_DAYS'));
  assert.deepEqual(ATTENDANCE_METHODS, list('ATTENDANCE_METHODS'));
  assert.deepEqual(EXAM_SYSTEMS, list('EXAM_SYSTEMS'));
  assert.deepEqual(GRADING_SYSTEMS, list('GRADING_SYSTEMS'));
  assert.deepEqual(PAYMENT_METHODS, list('PAYMENT_METHODS'));
  assert.deepEqual(CURRENCIES, list('CURRENCIES'));
});

test('Mark 3: website branding checks', () => {
  assert.match(fieldProblem(field('brandPrimary'), { brandPrimary: 'red' }), /colour/);
  assert.match(fieldProblem(field('brandPrimary'), { brandPrimary: '#12345' }), /colour/);
  assert.equal(fieldProblem(field('brandPrimary'), { brandPrimary: '#14243D' }), '');
  assert.equal(fieldProblem(field('brandSecondary'), {}), '');
  assert.match(fieldProblem(field('websiteTheme'), { websiteTheme: 'neon-pink' }), /listed/);
  assert.equal(fieldProblem(field('websiteTheme'), { websiteTheme: 'royal' }), '');
  assert.match(fieldProblem(field('principalMessage'), { principalMessage: 'x'.repeat(901) }), /too long/);
  assert.equal(fieldProblem(field('mission'), { mission: 'x'.repeat(500) }), '');
});

test('Mark 3: subdomain, custom domain and links', () => {
  const sub = field('preferredSubdomain');
  assert.equal(fieldProblem(sub, { preferredSubdomain: 'green-valley' }), '');
  for (const bad of ['ab', 'Green', '9school', 'a--b', '-abc', 'abc-', 'www', 'admin', 'x'.repeat(31)]) assert.notEqual(fieldProblem(sub, { preferredSubdomain: bad }), '', bad);
  const dom = field('customDomain');
  assert.equal(dom.showIf({ domainPreference: 'AZIZ subdomain only' }), false);
  assert.equal(fieldProblem(dom, { domainPreference: 'AZIZ subdomain only', customDomain: 'not a domain' }), '');
  assert.match(fieldProblem(dom, { domainPreference: 'Connect my own domain now' }), /required/);
  assert.equal(fieldProblem(dom, { domainPreference: 'Connect my own domain later' }), '');
  assert.match(fieldProblem(dom, { domainPreference: 'Connect my own domain later', customDomain: 'https://x.com' }), /domain/);
  assert.equal(fieldProblem(dom, { domainPreference: 'Connect my own domain now', customDomain: 'school.example.com' }), '');
  assert.match(fieldProblem(field('facebookUrl'), { facebookUrl: 'http://facebook.com/x' }), /https/);
  assert.match(fieldProblem(field('facebookUrl'), { facebookUrl: 'https://evil.com/facebook.com' }), /facebook/);
  assert.equal(fieldProblem(field('facebookUrl'), { facebookUrl: 'https://www.facebook.com/greenvalley' }), '');
  assert.equal(fieldProblem(field('youtubeUrl'), { youtubeUrl: 'https://youtu.be/abc' }), '');
  assert.match(fieldProblem(field('instagramUrl'), { instagramUrl: 'https://user:pw@instagram.com/x' }), /instagram/);
});

test('Mark 3: uploads and facilities are optional and keep no text value', () => {
  const uploads = FIELDS.filter((f) => f.type === 'upload' || f.type === 'gallery');
  assert.equal(uploads.length, 9);
  for (const f of uploads) assert.equal(fieldProblem(f, {}), '');
  assert.equal(FIELDS.filter((f) => f.type === 'toggle').length, 7);
  assert.equal(stepDone('L', {}), false);
  assert.equal(stepDone('L', { facilityLibrary: 'yes' }), true);
  assert.equal(stepProblems('J', {}).length, 0);
  assert.equal(stepProblems('K', {}).length, 0);
});

test('Mark 3: theme list, domain options and file limits agree with school.mjs and the server', () => {
  const school = readFileSync(new URL('../public/school.mjs', import.meta.url), 'utf8');
  const block = school.slice(school.indexOf('const THEMES = {'), school.indexOf('async function loadExtras'));
  const keys = [...block.matchAll(/'?([a-z][a-z-]*)'?:\s*\['#/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(THEME_PALETTES), keys);
  const server = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const serverThemes = [...server.match(/const THEME_KEYS = \[([^\]]*)\]/)[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(serverThemes, keys);
  const serverPrefs = [...server.match(/const DOMAIN_PREFERENCES = \[([^\]]*)\]/)[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(serverPrefs, DOMAIN_PREFERENCES);
  const slots = Object.fromEntries([...server.matchAll(/(\w+): \{ kind: '[a-z-]+', max: (\d+(?: \* \d+)*) \}/g)].map((m) => [m[1], eval(m[2])]));
  assert.deepEqual(slots, UPLOAD_LIMITS);
});

test('Mark 4: plan, trial and discount fields', () => {
  assert.match(fieldProblem(field('planId'), {}), /required/);
  assert.equal(fieldProblem(field('planId'), { planId: 'starter' }), '');
  assert.equal(field('trialDays').showIf({ trialEnabled: 'No' }), false);
  assert.equal(field('trialDays').showIf({ trialEnabled: 'Yes' }), true);
  assert.equal(field('trialDays').showIf({}), true);
  assert.match(fieldProblem(field('trialDays'), { trialEnabled: 'Yes', trialDays: '45' }), /listed/);
  assert.equal(fieldProblem(field('trialDays'), { trialEnabled: 'No', trialDays: '45' }), '');
  assert.match(fieldProblem(field('discountPercent'), { discountPercent: '101' }), /100 or less/);
  assert.match(fieldProblem(field('discountPercent'), { discountPercent: '-5' }), /whole number/);
  assert.equal(fieldProblem(field('discountPercent'), { discountPercent: '25' }), '');
  assert.match(fieldProblem(field('billingCycle'), { billingCycle: 'Weekly' }), /listed/);
});

test('Mark 4: server-worked rows and consent cannot be typed in or sent', () => {
  const shown = FIELDS.filter((f) => f.type === 'calc' || f.type === 'consent');
  assert.deepEqual(shown.map((f) => f.id), ['F105', 'F106', 'F108', 'F109', 'F110', 'F111', 'F117', 'F118', 'F120']);
  for (const f of shown) assert.equal(fieldProblem(f, {}), '');
  assert.equal(FIELDS.filter((f) => f.type === 'consent').length, 2);
});

test('Mark 4: login, retention and verification', () => {
  assert.match(fieldProblem(field('loginRoles'), { loginRoles: 'teacher,principal' }), /owner/);
  assert.match(fieldProblem(field('loginRoles'), { loginRoles: 'owner,hacker' }), /listed/);
  assert.equal(fieldProblem(field('loginRoles'), { loginRoles: LOGIN_ROLES.join(',') }), '');
  assert.match(fieldProblem(field('twoFactorPolicy'), { twoFactorPolicy: 'Never' }), /listed/);
  assert.match(fieldProblem(field('verificationStatus'), { verificationStatus: 'Maybe' }), /listed/);
  assert.match(fieldProblem(field('internalNotes'), { internalNotes: 'x'.repeat(501) }), /too long/);
  assert.equal(stepDone('N', { invitationMethod: INVITATION_METHODS[0], twoFactorPolicy: 'Optional', loginRoles: LOGIN_ROLES.join(','), dataRetention: RETENTION_OPTIONS[0] }), true);
  assert.equal(stepDone('N', {}), false);
  assert.equal(stepDone('O', { verificationStatus: 'Unverified' }), true);
  assert.equal(stepDone('M', { planId: 'starter' }), true);
  assert.equal(stepDone('M', {}), false);
});

test('Mark 4: lists agree with the server', () => {
  const server = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const list = (name) => [...server.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\];'))[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(LOGIN_ROLES, list('LOGIN_ROLES'));
  assert.deepEqual(INVITATION_METHODS, list('INVITATION_METHODS'));
  assert.deepEqual(TWO_FACTOR_POLICIES, list('TWO_FACTOR_POLICIES'));
  assert.deepEqual(RETENTION_OPTIONS, list('RETENTION_OPTIONS'));
  assert.deepEqual(VERIFICATION_STATUSES, list('VERIFICATION_STATUSES'));
  assert.deepEqual(BILLING_CYCLES, list('BILLING_CYCLES'));
});

test('every public module the app loads by name is allowed through .htaccess (a missing one made the wizard fail to load)', () => {
  const htaccess = readFileSync(new URL('../.htaccess', import.meta.url), 'utf8');
  const allowed = htaccess.match(/RewriteRule \^\(sign-in[^\n]*\)\$ public/)[0];
  for (const name of ['onboarding.mjs', 'consent.mjs', 'admission-desk.mjs', 'admin.mjs', 'sign-in.mjs', 'platform.mjs', 'school.mjs']) assert.ok(allowed.includes(name.replace('.', '\\.')), name);
});

test('Regression: every field F001 to F120 exists exactly once (F003, the school ID, is the automatic ID box)', () => {
  const ids = FIELDS.map((f) => f.id);
  for (let n = 1; n <= 120; n += 1) {
    const id = 'F' + String(n).padStart(3, '0');
    assert.equal(ids.filter((x) => x === id).length, id === 'F003' ? 0 : 1, id);
  }
  assert.equal(CATEGORIES.length, 15);
  assert.equal(new Set(FIELDS.map((f) => f.cat)).size, 15);
});
