# AZIZ School Registration Engine: Audit, Gap Matrix and Mark 1 Plan

Scope of this audit: I read `public/admin.mjs` (199,476 bytes), `public/admin.html`, `firestore.rules` (204,667 bytes) and `functions/index.js` (73,806 bytes), as committed in Batch 97. I did not touch production data. I could NOT run git, the build or the tests on your machine from here, and I did not read live Firebase data or Storage rules. Those items are listed under "Not verified".

## 1. What exists today (evidence)

| Item | Where | Behaviour |
|---|---|---|
| Register a school button | `admin.mjs` line 230, inside `viewSchools()` | Calls `registerSchool()` |
| Modal and submit handler | `admin.mjs` lines 237 to 275, `registerSchool()` | Small dialog (`formDialog`) with 4 data fields (id, name, ownerEmail, contactEmail), phone, address, plan, reason. All writes come straight from the browser in ONE batch: `schools/{id}` {name, contactEmail, phone, address, createdBy}, `schools/{id}/billing/main`, `invites/OW-xxxx` {schoolId, email, role:'owner', status:'pending'}, plus an audit entry |
| School ID | same | Typed by hand. Uniqueness is a read (`getDocFromServer`) followed by a batch, so two simultaneous requests can race. Reserved words list is in the browser only |
| Invitation | rules lines 380 to 394 | Root `invites/{id}`. Accepted by matching a VERIFIED sign-in email. No token hash, no expiry, no single-use consume. No email is sent (email delivery is not set up) |
| Plans and trial | `loadPlans()` plus `TRIAL_DAYS` (trial 30, 60, 90) | Trial is a billing state (`status:'trial'`), as the roadmap wants. The price and limits are copied from `plans` by the browser, so they are not authoritative |
| Subdomain | `assignSubdomain()` line 1035 | Separate action after registration. Writes `domainMap/{host}` from the browser (read-then-write, not transactional). Custom domains: `domainRequests` exist |
| Profile validation in rules | `validProfile` (rules line 3452) | Accepts name, contactEmail, phone, address only. Every new field needs a rules change, or the write must go through a trusted function |
| Audit | `platformAudit/A-...` | Browser-written audit with actor and time. Not server-written and not append-only enforced beyond the create rule |
| Backend | `functions/index.js` | Region asia-south1, Admin SDK. Has `sendTestEmail`, `admitStudent`, `promoteStudents`. No registration or provisioning function |

### Source of the visible "null"
`viewSchools()` ends with `view().replaceChildren(..., S.schools.length > 300 ? h('p', ...) : null)`. `replaceChildren(null)` turns `null` into the text "null". Fix: drop null children before the call. The same pattern should be searched everywhere `replaceChildren(` is passed a conditional (a small, safe fix for Mark 1).

## 2. Gap matrix (by category, F001 to F120)

Status key: V = verified working today, P = partial or exists elsewhere in the app but not in registration, N = not started, B = blocked (needs access or a decision).

| Cat | IDs | V | P | N | B | Notes |
|---|---|---|---|---|---|---|
| A Basic | F001 to F010 | F001 (name) | F003 (typed, not automatic) | F002, F004 to F010 | | |
| B Recognition | F011 to F018 | | | F011 to F016 | F017, F018 (uploads: Storage rules not verified) | |
| C Address and contact | F019 to F028 | | F024 (single address text), F026 (phone), F027 (contact email) | F019 to F023, F025, F028 | | |
| D Owner | F029 to F036 | F031 (owner email, via invite) | | F029, F030, F032 to F034 | F035, F036 (uploads) | |
| E Principal and admin | F037 to F043 | | | all | F040 (upload) | Principal accounts can be invited later in the school app |
| F Academic | F044 to F053 | | F044, F047 to F053 (the school owner sets these in Academic Setup after login) | F045, F046 | | Reuse existing schema as the roadmap says |
| G Capacity | F054 to F060 | | | all | | |
| H Timing and attendance | F061 to F069 | | F067 to F069 (attendance methods and geofence exist in the school app) | F061 to F066 | | Hardware (biometric) is configuration only |
| I Fees | F070 to F077 | | F070 to F077 (fee setup exists in the school app) | | | Optional at registration |
| J Branding | F078 to F087 | | F081 (theme registry exists) | F082 to F086 | F078 to F080, F087 (uploads) | |
| K Domain | F088 to F093 | | F088 to F090 (assign subdomain and domain requests exist, outside registration) | F091 to F093 | | DNS and HTTPS status needs Hostinger access |
| L Facilities | F094 to F100 | | modules exist (transport, hostel, library, canteen) but not as registration toggles | all toggles | | |
| M Commercial | F101 to F110 | F101, F102, F103, F108, F109 | F104, F106 (monthly price only) | F105, F107, F110 | | Pricing is computed in the browser today, so it is not yet trusted |
| N Login and security | F111 to F115 | | F111 (owner email is the login), F112 (email match only) | F113 to F115 | | |
| O Verification | F116 to F120 | | F119 (reason), F120 (status via `statusOf`) | F116 to F118 | | Consent records do not exist |

Totals (field level, my reading of the code): V about 9, P about 31, N about 62, B about 12 (some fields overlap two states). Nothing counts as complete under the roadmap rule until its acceptance test passes.

Capabilities C01 to C20: V none of the 20 fully. P: C07 (basic required checks in the dialog only), C14 (price copied in the browser), C17 (email-bound invite, no expiry or hash), C20 (client-written audit). N: C01 to C06, C08 to C13, C15, C16, C18. B: C19 (no email provider chosen), C11 and C13 live checks (need DNS access).

## 3. Not verified (needs you)
1. Git state: run `git status`, `git branch --show-current`, `git remote -v`, `git log -3 --oneline` and tell me the output. I will not discard any work.
2. Baseline: `tests\run-tests.cmd` result before Mark 1 (last known: all pass).
3. Live data: authorised read of `schools/abcd-school` and `schools/second-demo-school` (field shapes), and whether Storage rules exist (no `storage.rules` was in the project copy I have).
4. Plan names: the roadmap says Starter, Elite, Growth. I have not read the live `plans` collection, so I cannot confirm those names.

## 4. Mark 1 implementation plan (needs your approval)

Scope: F001 to F043 (A to E), C01 to C10.

1. Route and shell: `/admin#/schools/register/<draftId>`. Full-screen page, left step list (mobile: a step selector), sticky Back / Save draft / Save and continue. The old modal is removed. New file `public/onboarding.mjs`, loaded from `admin.mjs`.
2. Field registry: one declarative list (id, key, label, category, type, required condition, validator, default, help text). Progress is derived from valid applicable steps.
3. Drafts: `onboardingDrafts/{draftId}` with schemaVersion, values, completed steps, revision, status. Debounced autosave with a revision check. Rules: platform admin only. "Resume" list on the All schools page.
4. Trusted functions (asia-south1): `reserveSchoolId` (normalised name to id, transaction on a reservation doc, collision-safe, immutable) and `registerSchool` (validates, creates school + billing + owner invite from the draft in one transaction, idempotency key, server-written audit). The browser no longer writes the school, billing or invite directly.
5. Duplicate warning: by normalised name, locality, UDISE and affiliation number. A warning only, never a hard block on a fuzzy match.
6. Validation: email, phone, PIN, year of establishment, conditional affiliation fields. Owner email stays separate from the school contact email.
7. Rules: add `onboardingDrafts`, `schoolReservations`; widen `validProfile` only for the fields Mark 1 stores (backward compatible defaults, `schemaVersion`). Existing schools and members are unchanged.
8. Also fixed in Mark 1: the "null" text bug on the school list.
9. Tests: rules tests (platform admin vs owner/teacher/student/parent/revoked admin; cross-school), function tests (duplicate ID, repeated submit, concurrent reserve), UI checks (reload resumes, required errors, no nested scroll). 

Approval gate (from the roadmap): existing schools unchanged, refresh resumes the draft, duplicate ID rejected, required errors visible, old modal replaced.

Uploads (F017, F018, F035, F036, F040) stay out of Mark 1 until Storage rules are confirmed; they are in Mark 3.

## 5. Decisions I need before coding
1. Approve this Mark 1 plan (or change it).
2. Plan names to use (read from your `plans` collection, or tell me).
3. Email provider for invitations: Mark 1 does not need it, but Mark 5 does.
