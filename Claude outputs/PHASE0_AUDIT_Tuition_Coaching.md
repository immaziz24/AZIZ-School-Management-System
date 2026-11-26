# Phase 0 audit: Tuition & Coaching Manager

Date: 26 November 2026. Scope: read-only inspection of the repository on your computer (nothing changed, nothing deployed).
Gate for Phase 0: documented architecture, no production changes. Met.

## 1. How the site is published today

- `git push` to `main` runs `.github/workflows/hostinger.yml`. It copies only `.htaccess` and `public/` into the branch
  `hostinger-production`, and Hostinger deploys that branch. Functions, Firestore rules and Storage rules are NOT published by
  this: they go out separately with the Firebase CLI (`publish-rules.mjs` for rules).
- Static files only: no build step. Publish directory is `public/`.
- `.htaccess` is a whitelist. A new page needs a rewrite rule, and every new top-level `.mjs` file must be added to the
  filename list or it returns 404. Current routes: `/` (marketing site), `/app`, `/admin`, and the marketing pages
  (features, pricing, about, contact, security, privacy, terms).
- A host that is not AZIZ's own opens a school's public page. AZIZ's own hosts open the marketing site at `/`.

## 2. Homepage and navigation

- The homepage is `public/site/index.html`. The nav line is repeated by hand in 8 pages (index, features, pricing, about,
  contact, security, privacy, terms): `Features, Pricing, Security, About, Contact, Sign in, Start free trial`.
  The mobile menu is the same `#site-links` element toggled by `site.js`.
- "Registration" must be added in all 8 pages between Sign in and Start free trial. Pricing copy says "every plan starts
  with a 30-day free trial", so the free tuition/coaching plans need their own wording on the pricing page.

## 3. Sign-in and tenant model (the key finding)

- `public/sign-in.mjs` (694 KB, one file) serves `/app`. It resolves exactly ONE school from `?school=`, the host name, or
  the `domainMap` collection. AZIZ's own hosts resolve to the demo school `abcd-school`.
- Roles are read from `schools/{schoolId}/members/{uid}` (`role`, `active`). There is no cross-school membership lookup and
  no institution switcher. The app has no self-service signup: accounts are created by the Admin SDK (`createUser`), and
  there is no `createUserWithEmailAndPassword` or `sendEmailVerification` in the client.
- Result: a tuition owner who signs in at `/app` would be treated as a user of `abcd-school` and refused. The blueprint's
  `memberships/{uid_tenantId}` resolver and institution switcher do not exist and must be built.
- All 55 callable functions are v2, region `asia-south1`. Reusable helpers: `requirePlatformAdmin`, `requireOwner`,
  idempotent provisioning (draft id as key), `emailOutbox` + Resend `sendEmail`, `buildPdf` (receipts), the hourly
  `onSchedule` pattern, `redactPersonal` for audit logs.

## 4. Firestore and Storage rules

- `firestore.rules`: 3,462 lines, 204,667 bytes, at the platform's compiled-size limit. It cannot take a new tenant type.
- Anything not matched by a rule is denied, so new collections are safe by default.
- `storage.rules` is deny-all except `schools/{id}/staffDocs` and `ebooks`.

## 5. Tests

- `tests/run-tests.cmd` runs an explicit list of ~70 emulator rules tests plus registration unit and server tests (489 pass
  per your last run). New test files must be added to that list by name.
- Last known baseline: all pass. Re-run before any Phase 1 change.

## 6. Reuse inventory

| Reuse as is | Reuse the idea only | Do not reuse |
|---|---|---|
| `ui.mjs`, theme/navy-gold styles, `buildPdf`, Resend email + outbox, audit pattern, scheduler pattern, consent text | School fee, attendance, exam and timetable logic (they live under `schools/` with client rules) | `sign-in.mjs` (one school per page), school billing and plan code |

## 7. Recommended architecture

1. Separate `institutions/{tenantId}` collections (`students, batches, teachers, subjects, sessions, attendance, feeCharges,
   payments, receipts, exams, announcements`) plus `memberships/{uid_tenantId}`. School data is not touched or migrated.
2. All reads and writes go through Admin-SDK callable functions (the same pattern as the registration engine). Every call
   checks the verified token, an active membership, tenant and role. No client rules are needed, so `firestore.rules` does
   not grow. Cost: a few more function calls than direct reads; fine at free-plan sizes (100 / 250 students).
3. New portal pages (for example `/tuition` and `/coaching`) instead of adding to `sign-in.mjs`. Add their rewrite rules and
   `.mjs` names to `.htaccess`.
4. Free signup: client creates the Auth user and a callable sends the verification link through Resend (the Firebase default
   sender is a fallback). Provisioning runs after verification, with the plan taken from an allowlist on the server.
5. Money in integer paise; fee charge ids are deterministic (`studentId_cycle`); payments in transactions with an
   idempotency key; corrections by reversal entries.
6. Existing school billing and revenue reports already exclude free tenants, because they are not in `schools/`.

## 8. Risks and things I could not verify from here

- `azizschoolmanagementsystem.com` must be in Firebase Authentication > Authorized domains before email sign-in works there.
  I cannot read that setting from here.
- Local `git status` showed other modified files (`.htaccess`, `school.mjs`, `sign-in.mjs` line-ending warnings). Normal,
  but Phase 1 will start from a clean commit on a feature branch.
- `firestore-debug.log` (16 MB) is in the repo folder. It should be in `.gitignore`.
- Quota counters, fee generation and rate limits are new work. Concurrent-boundary tests need the emulator on your PC.

## 9. Rollback plan

Work on branch `feature/tuition-coaching`. Frontend: revert the merge commit and push (Hostinger redeploys in about a minute).
Functions: all new callables have new names, so existing ones are untouched; remove the new ones with
`firebase functions:delete <name>`. Rules: unchanged in every phase except possibly none. Data: new collections only.

## 10. Decisions needed from you (open decisions in the blueprint)

1. Accept the proposed free limits? Tuition 100 students / 10 batches / 10 MB. Coaching 250 students / 5 extra teachers /
   20 batches / 50 MB.
2. First-cycle fee policy: full fee by default, optional manual adjustment with a reason.
3. Can one account own more than one institution? Recommended: no, one institution per account at launch.
4. Architecture: callable-only data access with separate portal pages (recommended).
5. Privacy and retention: guardian contact data kept while the student is active; export on request; deletion on request
   after the owner closes the account. Needs your approval.
