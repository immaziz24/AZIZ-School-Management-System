// Unit tests for the server side of the registration wizard (Registration Marks 1 and 2, Batches 98 and 99). The functions file needs the Firebase Admin
// package to load, so the pure helpers are cut out of the source and run on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const grab = (re) => { const m = src.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const block = src.match(/\/\/ --- registration rules begin[\s\S]*?\/\/ --- registration rules end ---/);
assert.ok(block, 'registration rules block is missing');
const code = "class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }\n" + block[0];
const lib = new Function(code + '\n; return { slugifySchoolName, normalName, checkRegistration, cleanDraftValues, buildAcademicPlan, moneyToMinor, parseSections, sniffFile, slotAccepts, normalizeSubdomain, buildQuote, buildPdf, confirmationLines, welcomeEmailText, redactPersonal, INVITE_DAYS, LEGAL_VERSIONS, VERIFICATION_STATUSES, LOGIN_ROLES, toMinor, UPLOAD_SLOTS, THEME_KEYS, RESERVED_SUBDOMAINS, FACILITY_KEYS, NEW_SCHOOL_ID, DRAFT_ID, HttpsError, DRAFT_KEYS, REQUIRED_REGISTRATION };')();

const good = {
  name: 'Green Valley School', schoolType: 'Private unaided', schoolLevel: 'Secondary', genderComposition: 'Co-educational', medium: 'English',
  board: 'CBSE', affiliationNo: '2430123', country: 'India', state: 'West Bengal', district: 'Howrah', town: 'Howrah', street: '12 Main Road', pin: '711101',
  schoolPhone: '9830012345', schoolEmail: 'office@gv.in', ownerName: 'A Owner', ownerDesignation: 'Chairman', ownerEmail: 'owner@gv.in', ownerMobile: '9830012345',
  sessionLabel: '2026-27', lowestClass: 'Class 1', highestClass: 'Class 3', studentCount: '420', teacherCount: '24', planId: 'starter',
};

test('school IDs are built from the name and always valid', () => {
  assert.equal(lib.slugifySchoolName("St. Mary's Public School"), 'st-marys-public-school');
  assert.equal(lib.slugifySchoolName('Écolé Naïve  School!!'), 'ecole-naive-school');
  assert.equal(lib.slugifySchoolName('12th Standard Academy'), 'school-12th-standard-academy');
  for (const name of ['AB', 'ডি এ ভি', 'x'.repeat(100), '   ', '###', "O'Neil's Academy of Fine Arts and Sciences Kolkata"]) {
    assert.match(lib.slugifySchoolName(name), lib.NEW_SCHOOL_ID, name);
  }
});

test('name normalising ignores filler words, case and punctuation', () => {
  assert.equal(lib.normalName('The Green Valley Public School'), 'green valley');
  assert.equal(lib.normalName('GREEN-VALLEY  school'), 'green valley');
});

test('a complete draft has no problems', () => {
  assert.deepEqual(lib.checkRegistration(good), []);
});

test('the server repeats the field checks', () => {
  assert.ok(lib.checkRegistration({ ...good, name: '' }).some((p) => /name is required/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, ownerEmail: 'Owner@gv.in' }).some((p) => /lowercase/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, pin: '0123' }).some((p) => /pin/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, schoolPhone: 'abc' }).some((p) => /schoolPhone/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, estYear: '1700' }).some((p) => /estYear/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, udise: '123' }).some((p) => /udise/.test(p)));
  assert.ok(lib.checkRegistration({ ...good, affiliationNo: '' }).some((p) => /affiliationNo/.test(p)));
  assert.deepEqual(lib.checkRegistration({ ...good, board: 'state', affiliationNo: '' }), []);
});

test('draft ids have a fixed shape', () => {
  assert.ok(lib.DRAFT_ID.test('OB-ABCDEF2345'));
  assert.ok(!lib.DRAFT_ID.test('OB-short'));
  assert.ok(!lib.DRAFT_ID.test('../schools/abcd-school'));
});

test('draft values keep known fields only, as text, and drop empty ones', () => {
  assert.deepEqual(lib.cleanDraftValues({ name: ' Green Valley ', motto: '   ', town: 'Howrah' }), { name: 'Green Valley', town: 'Howrah' });
  assert.throws(() => lib.cleanDraftValues({ password: 'x' }), /Unknown field/);
  assert.throws(() => lib.cleanDraftValues({ name: 5 }), /not valid/);
  assert.throws(() => lib.cleanDraftValues({ name: 'x'.repeat(1001) }), /not valid/);
  assert.throws(() => lib.cleanDraftValues(['name']), /not valid/);
});

test('Mark 2: the server repeats the academic, capacity, timing and fee checks', () => {
  const bad = (patch, re) => assert.ok(lib.checkRegistration({ ...good, ...patch }).some((p) => re.test(p)), JSON.stringify(patch));
  bad({ sessionLabel: '2026-28' }, /sessionLabel/);
  bad({ sessionStartMonth: '13' }, /sessionStartMonth/);
  bad({ lowestClass: 'Class 9' }, /highestClass must not be below/);
  bad({ highestClass: 'Class 20' }, /highestClass is not/);
  bad({ classesOffered: 'Class 7' }, /classesOffered/);
  bad({ sectionsByClass: 'Class 9=A' }, /sections/);
  bad({ sectionsByClass: 'Class 1=A,B,C,D,E,F,G,H,I' }, /more than 8/);
  bad({ subjects: Array.from({ length: 41 }, (_, i) => 'S' + i).join(',') }, /subjects/);
  bad({ studentCount: '' }, /studentCount is required/);
  bad({ studentCount: '-1' }, /studentCount must be/);
  bad({ teacherCount: '99999' }, /teacherCount must be/);
  bad({ maxCapacity: '10' }, /maxCapacity is below/);
  bad({ campusCount: '0' }, /campusCount/);
  bad({ openTime: '9am' }, /openTime/);
  bad({ openTime: '10:00', closeTime: '09:00' }, /closeTime must be after/);
  bad({ closeTime: '15:00', teacherReportTime: '16:00' }, /teacherReportTime must be before/);
  bad({ workingDays: 'Mon,Sat', weeklyHolidays: 'Sat' }, /both a working day/);
  bad({ workingDays: 'Mon,Zzz' }, /unknown day/);
  bad({ lateGraceMinutes: '500' }, /lateGraceMinutes/);
  bad({ studentAttendanceMethod: 'Telepathy' }, /studentAttendanceMethod/);
  bad({ teacherAttendanceMethods: 'Manual,Telepathy' }, /teacherAttendanceMethods/);
  bad({ studentAttendanceMethod: 'GPS' }, /geofenceRadius is required/);
  bad({ teacherAttendanceMethods: 'GPS', geofenceRadius: '5' }, /geofenceRadius must be/);
  bad({ currency: 'XYZ' }, /currency/);
  bad({ admissionFee: '12.345' }, /admissionFee/);
  bad({ feeDueDay: '31' }, /feeDueDay/);
  bad({ paymentMethods: 'Cash,Bitcoin' }, /paymentMethods/);
  assert.deepEqual(lib.checkRegistration({ ...good, studentAttendanceMethod: 'GPS', geofenceRadius: '150', openTime: '08:00', closeTime: '15:00', teacherReportTime: '07:45', workingDays: 'Mon,Tue', weeklyHolidays: 'Sun', admissionFee: '1500.50', feeDueDay: '10', paymentMethods: 'Cash,UPI' }), []);
});

test('the server and the form agree on which fields exist and which are required', () => {
  const ui = readFileSync(new URL('../public/onboarding.mjs', import.meta.url), 'utf8');
  const keys = [...ui.matchAll(/\{ id: 'F\d{3}', key: '([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.equal(keys.length, 119);
  // Uploads are files, and the calculated and consent rows are read-only, so the draft stores none of them as text.
  const notStored = keys.filter((k) => !lib.DRAFT_KEYS.includes(k)).sort();
  const files = ['affiliationCert', 'favicon', 'gallery', 'heroImage', 'logo', 'ownerPhoto', 'ownershipDoc', 'principalPhoto', 'recognitionCert'];
  const shown = ['activationStatus', 'entitlements', 'maxStudents', 'ownerLoginEmail', 'privacyAccepted', 'setupFee', 'storageAllocated', 'subscriptionPrice', 'termsAccepted'];
  assert.deepEqual(notStored, [...files, ...shown].sort());
  assert.equal(lib.DRAFT_KEYS.length, 101);
  assert.equal(new Set(lib.DRAFT_KEYS).size, 101);
  assert.ok(Object.keys(lib.UPLOAD_SLOTS).includes('gallery6') && files.every((k) => k === 'gallery' || lib.UPLOAD_SLOTS[k]));
  // Consent can never be sent in a draft: the server refuses unknown fields.
  assert.throws(() => lib.cleanDraftValues({ termsAccepted: 'yes' }), /Unknown field/);
  assert.throws(() => lib.cleanDraftValues({ activationStatus: 'Active' }), /Unknown field/);
  assert.throws(() => lib.cleanDraftValues({ setupFee: '0' }), /Unknown field/);
});

test('money is converted to the smallest unit without rounding errors', () => {
  assert.equal(lib.moneyToMinor('1500'), 150000);
  assert.equal(lib.moneyToMinor('1500.5'), 150050);
  assert.equal(lib.moneyToMinor('0.07'), 7);
  assert.equal(lib.moneyToMinor('19.99'), 1999);
  assert.equal(lib.moneyToMinor(''), 0);
});

test('sections text is read into a map', () => {
  assert.deepEqual(lib.parseSections('Class 1=A, B|Class 2=A'), { 'Class 1': ['A', 'B'], 'Class 2': ['A'] });
  assert.deepEqual(lib.parseSections(''), {});
  assert.deepEqual(lib.parseSections('garbage'), {});
});

test('the academic plan has the right years, classes, sections, subjects and links', () => {
  const plan = lib.buildAcademicPlan({ ...good, lowestClass: 'Class 1', highestClass: 'Class 3', sectionsByClass: 'Class 1=A,B', subjects: 'English, Mathematics, English' });
  assert.equal(plan.year.id, '2026-27');
  assert.equal(plan.year.data.startDate, '2026-04-01');
  assert.equal(plan.year.data.endDate, '2027-03-31');
  assert.equal(plan.year.data.status, 'active');
  assert.deepEqual(plan.classes.map((c) => [c.id, c.data.name, c.data.order]), [['class-1', 'Class 1', 4], ['class-2', 'Class 2', 5], ['class-3', 'Class 3', 6]]);
  assert.deepEqual(plan.sections.map((s) => s.id), ['class-1-a', 'class-1-b', 'class-2-a', 'class-3-a']);
  assert.deepEqual(plan.subjects.map((s) => s.id), ['english', 'mathematics']);
  assert.ok(plan.subjects.every((s) => s.data.code.length <= 12));
  assert.equal(plan.mappings.length, 6);
  assert.ok(plan.mappings.some((m) => m.id === 'class-2_mathematics'));
  for (const c of plan.classes) assert.ok(c.data.order >= 1 && c.data.order <= 100);
  for (const s of plan.sections) assert.ok(s.data.name.length <= 10);
});

test('a January to December session ends in the same year; classesOffered narrows the plan', () => {
  const plan = lib.buildAcademicPlan({ ...good, sessionStartMonth: '1', sessionEndMonth: '12', classesOffered: 'Class 1,Class 3' });
  assert.equal(plan.year.data.startDate, '2026-01-01');
  assert.equal(plan.year.data.endDate, '2026-12-31');
  assert.deepEqual(plan.classes.map((c) => c.data.name), ['Class 1', 'Class 3']);
  assert.equal(plan.subjects.length, 0);
  assert.equal(plan.mappings.length, 0);
});

test('a leap-year February end date is handled', () => {
  const plan = lib.buildAcademicPlan({ ...good, sessionLabel: '2027-28', sessionStartMonth: '4', sessionEndMonth: '2' });
  assert.equal(plan.year.data.endDate, '2028-02-29');
});

test('Mark 3: the server repeats the website, domain and facility checks', () => {
  const bad = (patch, re) => assert.ok(lib.checkRegistration({ ...good, ...patch }).some((p) => re.test(p)), JSON.stringify(patch));
  bad({ websiteTheme: 'neon' }, /websiteTheme/);
  bad({ brandPrimary: 'blue' }, /brandPrimary/);
  bad({ brandSecondary: '#12' }, /brandSecondary/);
  bad({ principalMessage: 'x'.repeat(901) }, /principalMessage/);
  bad({ preferredSubdomain: 'www' }, /preferredSubdomain/);
  bad({ preferredSubdomain: 'Bad Name' }, /preferredSubdomain/);
  bad({ domainPreference: 'Whenever' }, /domainPreference/);
  bad({ customDomain: 'http://x.com' }, /customDomain/);
  bad({ domainPreference: 'Connect my own domain now' }, /customDomain is required/);
  bad({ facebookUrl: 'http://facebook.com/x' }, /facebookUrl/);
  bad({ facebookUrl: 'https://notfacebook.com/x' }, /facebookUrl/);
  bad({ instagramUrl: 'https://instagram.com.evil.com/x' }, /instagramUrl/);
  bad({ facilityLibrary: 'maybe' }, /facilityLibrary/);
  assert.deepEqual(lib.checkRegistration({ ...good, websiteTheme: 'royal', brandPrimary: '#14243D', preferredSubdomain: 'green-valley', domainPreference: 'Connect my own domain now', customDomain: 'school.example.com',
    facebookUrl: 'https://www.facebook.com/gv', youtubeUrl: 'https://youtu.be/abc', facilityLibrary: 'yes', facilityHostel: 'no' }), []);
  assert.ok(lib.THEME_KEYS.includes('royal') && lib.FACILITY_KEYS.length === 7);
});

test('Mark 3: files are recognised by their contents, never by name', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)]);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20)]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = Buffer.from('<html><body>hello world</body></html>');
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)]);
  assert.equal(lib.sniffFile(png).type, 'image/png');
  assert.equal(lib.sniffFile(jpg).ext, 'jpg');
  assert.equal(lib.sniffFile(webp).type, 'image/webp');
  assert.equal(lib.sniffFile(pdf).type, 'application/pdf');
  for (const x of [svg, html, exe, Buffer.alloc(0), Buffer.from('abc')]) assert.equal(lib.sniffFile(x), null);
  assert.equal(lib.slotAccepts('logo', lib.sniffFile(png)), true);
  assert.equal(lib.slotAccepts('logo', lib.sniffFile(pdf)), false);
  assert.equal(lib.slotAccepts('ownerPhoto', lib.sniffFile(pdf)), false);
  assert.equal(lib.slotAccepts('recognitionCert', lib.sniffFile(pdf)), true);
  assert.equal(lib.slotAccepts('recognitionCert', lib.sniffFile(jpg)), true);
  assert.equal(lib.slotAccepts('recognitionCert', lib.sniffFile(svg)), false);
  assert.equal(lib.slotAccepts('notASlot', lib.sniffFile(png)), false);
  assert.equal(lib.slotAccepts('logo', null), false);
});

test('Mark 3: subdomain names are normalised and unsafe ones refused', () => {
  assert.equal(lib.normalName('x'), 'x');
  assert.equal(lib.normalizeSubdomain(' Green-Valley '), 'green-valley');
  for (const bad of ['', 'ab', 'a b', '9abc', 'a--b', '-abc', 'abc-', 'abc.def', '../x', 'x'.repeat(31), 'ñandú']) assert.equal(lib.normalizeSubdomain(bad), null, bad);
  assert.ok(lib.RESERVED_SUBDOMAINS.includes('www') && lib.RESERVED_SUBDOMAINS.includes('admin'));
  assert.equal(lib.UPLOAD_SLOTS.favicon.max, 256 * 1024);
  assert.ok(Object.values(lib.UPLOAD_SLOTS).every((r) => r.max <= 5 * 1024 * 1024));
});

test('Mark 4: the server repeats the commercial, login and verification checks', () => {
  const bad = (patch, re) => assert.ok(lib.checkRegistration({ ...good, ...patch }).some((p) => re.test(p)), JSON.stringify(patch));
  bad({ planId: '' }, /planId is required/);
  bad({ planId: '../plans/x' }, /planId/);
  bad({ trialEnabled: 'Maybe' }, /trialEnabled/);
  bad({ trialDays: '45' }, /trialDays/);
  bad({ billingCycle: 'Weekly' }, /billingCycle/);
  bad({ discountPercent: '101' }, /discountPercent/);
  bad({ discountPercent: '-1' }, /discountPercent/);
  bad({ invitationMethod: 'Pigeon' }, /invitationMethod/);
  bad({ twoFactorPolicy: 'Never' }, /twoFactorPolicy/);
  bad({ loginRoles: 'owner,hacker' }, /loginRoles/);
  bad({ loginRoles: 'teacher' }, /must include owner/);
  bad({ dataRetention: 'Forever' }, /dataRetention/);
  bad({ verificationStatus: 'Maybe' }, /verificationStatus/);
  bad({ internalNotes: 'x'.repeat(501) }, /internalNotes/);
  assert.deepEqual(lib.checkRegistration({ ...good, trialEnabled: 'Yes', trialDays: '60', billingCycle: 'Yearly', discountPercent: '10', loginRoles: lib.LOGIN_ROLES.join(','), twoFactorPolicy: 'Optional', verificationStatus: 'Verified' }), []);
});

const plan = { name: 'Growth', monthlyPrice: 999, yearlyPrice: 9990, setupFee: 1500, studentLimit: 500, staffLimit: 40, storageMb: 5120, features: ['Fees', 'Reports'], historyId: 'H-1' };
test('Mark 4: prices are worked out from the catalog, in paise', () => {
  const m = lib.buildQuote(plan, 'growth', { billingCycle: 'Monthly', discountPercent: '0', trialEnabled: 'No' });
  assert.equal(m.recurringMinor, 99900); assert.equal(m.setupMinor, 150000); assert.equal(m.firstInvoiceMinor, 249900); assert.equal(m.dueNowMinor, 249900);
  assert.equal(m.studentLimit, 500); assert.equal(m.storageMb, 5120); assert.equal(m.planVersion, 'H-1'); assert.deepEqual(m.features, ['Fees', 'Reports']);
  const y = lib.buildQuote(plan, 'growth', { billingCycle: 'Yearly', discountPercent: '20', trialEnabled: 'No' });
  assert.equal(y.listMinor, 999000); assert.equal(y.discountMinor, 199800); assert.equal(y.recurringMinor, 799200); assert.equal(y.monthlyEquivalentMinor, 66600);
  const t = lib.buildQuote(plan, 'growth', { trialEnabled: 'Yes', trialDays: '60' });
  assert.equal(t.trial, true); assert.equal(t.trialDays, 60); assert.equal(t.dueNowMinor, 0); assert.equal(t.cycle, 'Monthly');
  const odd = lib.buildQuote(plan, 'growth', { trialEnabled: 'Yes', trialDays: '999', discountPercent: 'abc', billingCycle: 'Nonsense' });
  assert.equal(odd.trialDays, 30); assert.equal(odd.discountPercent, 0); assert.equal(odd.cycle, 'Monthly');
  const full = lib.buildQuote(plan, 'growth', { discountPercent: '100' });
  assert.equal(full.recurringMinor, 0);
  const over = lib.buildQuote(plan, 'growth', { discountPercent: '500' });
  assert.ok(over.recurringMinor >= 0);
  assert.equal(lib.toMinor(19.99), 1999); assert.equal(lib.toMinor(0.07), 7); assert.equal(lib.toMinor(undefined), 0);
  const bare = lib.buildQuote({}, 'x', {});
  assert.equal(bare.recurringMinor, 0); assert.deepEqual(bare.features, []);
});

test('Mark 4: legal versions and statuses exist', () => {
  assert.match(lib.LEGAL_VERSIONS.terms, /^20[0-9]{2}-/);
  assert.match(lib.LEGAL_VERSIONS.privacy, /^20[0-9]{2}-/);
  assert.ok(lib.VERIFICATION_STATUSES.includes('Verified') && lib.VERIFICATION_STATUSES[0] === 'Unverified');
});

const info = { generatedOn: '2026-11-25', name: 'Green Valley (School)', schoolId: 'green-valley', registeredOn: '2026-11-25', planName: 'Growth', cycle: 'Monthly', recurringMinor: 99900, discountPercent: 10, setupMinor: 150000,
  trial: true, trialDays: 30, verificationStatus: 'Verified', consent: 'Pending the owner', activationStatus: 'Pending activation', ownerEmail: 'owner@gv.in', invitation: 'pending', websitePublished: false, domain: 'none' };

test('Mark 5: the confirmation PDF is a valid, readable file with the key facts and no secrets', () => {
  const pdf = lib.buildPdf(lib.confirmationLines(info));
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('green-valley') && text.includes('Growth') && text.includes('Rs 999') && text.includes('Rs 1,500'));
  assert.ok(text.includes('Green Valley \\(School\\)'), 'brackets are escaped');
  assert.ok(!/password|token|https?:\/\//i.test(text.replace('no passwords and no sign-in links', '')));
  // Every cross-reference offset points at its object.
  const start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(start).startsWith('xref'));
  const rows = text.slice(start).split('\n').filter((l) => /^\d{10} 00000 n/.test(l));
  rows.forEach((row, i) => assert.ok(text.slice(Number(row.slice(0, 10))).startsWith((i + 1) + ' 0 obj'), 'object ' + (i + 1)));
});

test('Mark 5: the PDF copes with other scripts, long text and many lines', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ text: 'Line ' + i + ' ' + 'x'.repeat(200) }));
  const pdf = lib.buildPdf(many).toString('latin1');
  assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 3);
  const odd = lib.buildPdf([{ text: 'ডি এ ভি স্কুল \\ ( ) é' }]).toString('latin1');
  assert.ok(odd.includes('?') && odd.includes('\\\\') && odd.includes('\\(') && odd.includes('\\)'));
  assert.ok(lib.buildPdf([]).length > 100);
});

test('Mark 5: the welcome email goes to the owner, with no password', () => {
  const text = lib.welcomeEmailText({ ownerName: 'A Owner', name: 'Green Valley', schoolId: 'green-valley', ownerEmail: 'owner@gv.in' });
  assert.ok(text.includes('Hello A Owner') && text.includes('owner@gv.in') && text.includes('green-valley') && text.includes('/app'));
  assert.ok(/never send passwords/i.test(text));
  assert.ok(!/password:/i.test(text));
});

test('Mark 5: audit text is masked before it is shown', () => {
  assert.equal(lib.redactPersonal('owner@school.in asked'), 'o***@school.in asked');
  assert.equal(lib.redactPersonal('mobile 9830012345 ok'), 'mobile 98******45 ok');
  assert.equal(lib.redactPersonal(undefined), '');
  assert.equal(lib.INVITE_DAYS, 14);
});

test('Mark 5: the server functions that must be admin-only all check the role first', () => {
  for (const name of ['getOnboardingFlag', 'setOnboardingFlag', 'retryProvisioning', 'sendWelcomeEmail', 'resendOwnerInvitation', 'expireOwnerInvitationsNow', 'getConfirmationPdf',
    'listRegistrationAudit', 'getRegistrationStatus', 'activateSchool', 'setVerificationStatus', 'quoteSubscription', 'uploadOnboardingFile', 'removeOnboardingFile', 'previewOnboardingFile',
    'reserveSubdomain', 'checkCustomDomain', 'cleanupAbandonedDrafts', 'registerSchool', 'saveOnboardingDraft', 'getOnboardingDraft', 'listOnboardingDrafts', 'deleteOnboardingDraft']) {
    const at = src.indexOf('exports.' + name + ' = ');
    assert.ok(at > 0, name);
    const body = src.slice(at, at + 400);
    assert.ok(/requirePlatformAdmin\(request\)/.test(body), name + ' must check the platform admin first');
  }
  // The two owner-side functions require the school's own owner, never an admin.
  for (const name of ['getConsentStatus', 'acceptSchoolConsent']) assert.ok(/requireOwner\(request\)/.test(src.slice(src.indexOf('exports.' + name + ' = '), src.indexOf('exports.' + name + ' = ') + 300)), name);
});

test('Mark 5: one invitation, one welcome record per registration (the fixed record id stops a double send)', () => {
  assert.ok(/'EM-' \+ \(draftId \|\| r\.draftId \|\| schoolId\) \+ '-welcome'/.test(src));
  assert.ok(/ref\.create\(/.test(src));
  assert.ok(/expiresAt: Timestamp\.fromMillis\(Date\.now\(\) \+ INVITE_DAYS/.test(src));
});
