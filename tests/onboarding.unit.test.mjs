// Unit tests for the registration field registry (Registration Mark 1, Batch 98): required rules, conditional fields, formats and progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/onboarding.mjs', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { FIELDS, CATEGORIES, fieldProblem, stepProblems, stepDone, progressOf } = mod;

const good = {
  name: 'Green Valley School', schoolType: 'Private unaided', schoolLevel: 'Secondary', genderComposition: 'Co-educational', medium: 'English',
  board: 'state', country: 'India', state: 'West Bengal', district: 'Howrah', town: 'Howrah', street: '12 Main Road', pin: '711101',
  schoolPhone: '9830012345', schoolEmail: 'office@gv.in', ownerName: 'A Owner', ownerDesignation: 'Chairman', ownerEmail: 'owner@gv.in', ownerMobile: '+91 98300 12345',
};
const field = (key) => FIELDS.find((f) => f.key === key);

test('the registry covers the 37 stored fields of categories A to E plus no duplicates', () => {
  assert.equal(FIELDS.length, 37);
  assert.equal(new Set(FIELDS.map((f) => f.key)).size, 37);
  assert.equal(new Set(FIELDS.map((f) => f.id)).size, 37);
  assert.deepEqual([...new Set(FIELDS.map((f) => f.cat))], ['A', 'B', 'C', 'D', 'E']);
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
  assert.equal(progressOf(good), 4);
  assert.equal(progressOf({ ...good, principalName: 'A Principal' }), 5);
  const broken = { ...good, pin: 'bad' };
  assert.equal(stepDone('C', broken), false);
  assert.equal(progressOf(broken), 3);
  assert.equal(progressOf({ ...good, ownerEmail: '' }), 3);
  assert.equal(stepProblems('A', {}).length, 5);
});
