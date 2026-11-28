// Firestore rules tests (Phase 5): the tuition and coaching records are server-only. No signed-in user, owner, teacher, other account or even a
// platform administrator may read or write them straight from the browser. They are reached only through the server functions, which check the account.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run through firebase emulators:exec.');
const project = process.env.GCLOUD_PROJECT || 'demo-aziz';
if (!project.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + project);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const tokenFor = (uid) => { const now = Math.floor(Date.now() / 1000); return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid, iat: now, auth_time: now, exp: now + 3600, email: uid + '@example.com', email_verified: true, firebase: { sign_in_provider: 'password', identities: {} } }) + '.'; };
const ADMIN = 'owner';
const encode = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
const fields = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, encode(v)]));
const call = async (method, who, path, data) => { const r = await fetch(base + '/' + path, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + (who === ADMIN ? ADMIN : tokenFor(who)) } : {}) }, ...(data ? { body: JSON.stringify({ fields: fields(data) }) } : {}) }); await r.arrayBuffer(); return r.status; };
const set = (who, p, d) => call('PATCH', who, p, d); const get = (who, p) => call('GET', who, p); const del = (who, p) => call('DELETE', who, p);
const denied = async (promise, label) => assert.equal(await promise, 403, label);

const T = 'ins-aaaaaaaaaaaaaaaaaaaa';
const PATHS = [
  [`institutions/${T}`, { type: 'tuition', status: 'active', ownerUid: 'owner-a' }], [`institutions/${T}/students/ST-ABC123`, { name: 'Anika' }], [`institutions/${T}/batches/BT-ABC123`, { name: 'Maths' }],
  [`institutions/${T}/feeCharges/ST-ABC123_2026-11`, { amountPaise: 50000 }], [`institutions/${T}/payments/P-ABC123`, { amountPaise: 50000 }], [`institutions/${T}/receipts/R-000001`, { amountPaise: 50000 }],
  [`institutions/${T}/attendance/2026-11-20_BT-ABC123_ST-ABC123`, { status: 'present' }], [`institutions/${T}/audit/A-1`, { action: 'x' }], [`institutions/${T}/config/entitlements`, { version: 1 }],
  [`institutions/${T}/teachers/TC-ABC123`, { name: 'T' }], [`institutions/${T}/exams/EX-ABC123`, { maxMarks: 50 }], [`institutions/${T}/marks/EX-ABC123_ST-ABC123`, { marks: 40 }], [`institutions/${T}/notices/AN-ABC123`, { title: 'x' }],
  [`memberships/owner-a_${T}`, { uid: 'owner-a', tenantId: T, role: 'owner', status: 'active' }], [`memberships/teach-a_${T}`, { uid: 'teach-a', tenantId: T, role: 'teacher', status: 'active' }],
  ['emailCodes/owner-a', { hash: 'x' }], ['teacherInvites/abc', { tenantId: T, status: 'pending' }], ['platformConfig/institutionPlans', { x: 'y' }],
];
beforeEach(async () => {
  const c = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' }); assert.equal(c.status, 200);
  for (const [p, d] of PATHS) assert.equal(await set(ADMIN, p, d), 200, 'seed ' + p);
  assert.equal(await set(ADMIN, 'platformAdmins/root-admin', { active: true }), 200);
});

test('the owner, a teacher, another account and a visitor cannot read any institution record straight from the browser', async () => {
  for (const who of ['owner-a', 'teach-a', 'someone-else', 'root-admin', null]) for (const [p] of PATHS) await denied(get(who, p), who + ' read ' + p);
});

test('nobody can create, change or delete institution records from the browser, not even the owner or a platform administrator', async () => {
  for (const who of ['owner-a', 'teach-a', 'someone-else', 'root-admin', null]) for (const [p] of PATHS) {
    await denied(set(who, p, { hacked: true }), who + ' write ' + p); await denied(del(who, p), who + ' delete ' + p);
  }
});

test('role escalation from the browser fails: a user cannot make themselves an owner, a teacher or a member of another institution', async () => {
  await denied(set('someone-else', `memberships/someone-else_${T}`, { uid: 'someone-else', tenantId: T, role: 'owner', status: 'active' }), 'self-made owner');
  await denied(set('teach-a', `memberships/teach-a_${T}`, { uid: 'teach-a', tenantId: T, role: 'owner', status: 'active' }), 'teacher promotes self');
  await denied(set('owner-a', `institutions/${T}`, { type: 'coaching', status: 'active', limits: 99999 }), 'owner raises own limits or changes type');
  await denied(set('owner-a', `emailCodes/owner-a`, { hash: 'known', expiresAt: 'x' }), 'owner plants own verification code');
  await denied(set('someone-else', 'teacherInvites/mine', { tenantId: T, status: 'pending' }), 'self-made teacher invite');
});

test('the audit trail cannot be edited: platformAudit entries are never changed or deleted from the browser', async () => {
  await set(ADMIN, 'platformAudit/A-TEST1', { action: 'x', actor: 'root-admin' });
  await denied(set('root-admin', 'platformAudit/A-TEST1', { action: 'changed' }), 'admin edits audit'); await denied(del('root-admin', 'platformAudit/A-TEST1'), 'admin deletes audit'); await denied(set('owner-a', 'platformAudit/A-TEST2', { action: 'fake' }), 'owner forges audit');
});

test('school data is not reachable through an institution account', async () => {
  await set(ADMIN, 'schools/abcd-school/members/owner-a', { role: 'owner', active: true });
  await denied(get('teach-a', 'schools/abcd-school/students/S1'), 'teacher reads school students');
});
