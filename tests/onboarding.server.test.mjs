// Unit tests for the server side of the registration wizard (Registration Mark 1, Batch 98). The functions file needs the Firebase Admin
// package to load, so the pure helpers are cut out of the source and run on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const grab = (re) => { const m = src.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const code = [
  "class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }",
  "const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');",
  grab(/const NEW_SCHOOL_ID[^\n]*/), grab(/const DRAFT_ID[^\n]*/), grab(/function slugifySchoolName[\s\S]*?\n}\n/), grab(/const normalName[^\n]*/),
  grab(/const REQUIRED_REGISTRATION[\s\S]*?'ownerMobile'\];/), grab(/const EMAIL_PATTERN[^\n]*/), grab(/const PHONE_PATTERN[^\n]*/),
  grab(/function checkRegistration[\s\S]*?\n}\n/), grab(/const DRAFT_KEYS[\s\S]*?'adminPhone'\];/), grab(/function cleanDraftValues[\s\S]*?\n}\n/),
].join('\n');
const lib = new Function(code + '; return { slugifySchoolName, normalName, checkRegistration, cleanDraftValues, NEW_SCHOOL_ID, DRAFT_ID, HttpsError };')();

const good = {
  name: 'Green Valley School', schoolType: 'Private unaided', schoolLevel: 'Secondary', genderComposition: 'Co-educational', medium: 'English',
  board: 'CBSE', affiliationNo: '2430123', country: 'India', state: 'West Bengal', district: 'Howrah', town: 'Howrah', street: '12 Main Road', pin: '711101',
  schoolPhone: '9830012345', schoolEmail: 'office@gv.in', ownerName: 'A Owner', ownerDesignation: 'Chairman', ownerEmail: 'owner@gv.in', ownerMobile: '9830012345',
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
