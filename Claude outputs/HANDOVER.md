# AZIZ School Management System: handover for a new chat

## 1. Project
- Multi-school SaaS: static HTML/CSS/JS plus Firebase Auth and Firestore. Hosted on Hostinger (Business plan), deployed by `git push` from GitHub `immaziz24/AZIZ-School-Management-System` (branch main).
- Local checkout: `E:\AZIZ School Management System`. App files are in `public\`; `firestore.rules`, `.htaccess` and `tests\` are at the repo root.
- Live site: https://azizschoolmanagement.plateria.in (app at `/app`). Firebase project: `aziz-school-management-system`.
- Demo school: `schools/abcd-school` (ABCD School, about 12k fake docs, billing standard/active).
- Key files: `public/sign-in.mjs` (owner, teacher and portal logic, about 400 KB), `public/index.html`, `public/sign-in.css`, `public/platform.mjs`, `public/ui.mjs` (tile launcher), `public/school.html` and `school.mjs` (public school page), `firestore.rules`.

## 2. How the user wants me to work (standing preferences)
- Explain simply. The user runs commands themselves in cmd.
- Do as many features as possible per batch (one test run, one deploy).
- Two cmd code blocks per batch.
  - Block 1: `E:`, `cd "E:\AZIZ School Management System"`, `tests\run-tests.cmd`.
  - Block 2, only if `fail 0`: `firebase deploy --only firestore:rules` (when the rules changed), `git add -A`, `git commit -m "..."`, `git push`. Then Ctrl+Shift+R.
- The user replies "all pass, deploy and push" or sends screenshots.
- Never delete data without explicit approval. Never type passwords (I never sign in for the user). Never use live student data.
- Keep the navy/ivory/gold look. Every rules change needs tests.
- Don't add UI the user didn't ask for (they were upset about an unrequested jump bar).
- SECURITY: the user once showed a Google Doc screenshot with demo login emails and passwords. Never use or repeat them, and remind the user to change them.

## 3. Delivery mechanics (important)
- Work in `/home/claude/w10` (flat copy of the app files, plus `tests/`).
- Stage to a NEW output dir each time, e.g. `/mnt/user-data/outputs/b52/{public,tests}`.
- Write to the device with `device_commit_files` (force) to `E:\AZIZ School Management System\...`, then verify sizes with `device_list_dir`. Device copies can be stale; if sizes are equal, grep the content.
- `node --check` every .mjs before delivering. No Firebase emulator in my workspace, so tests only run on the user's machine.
- Firestore rules facts:
  - Separate `allow` statements are OR-ed.
  - A rule evaluation allows at most 10 access calls (get/exists).
  - Student doc id must equal lowercase admissionNo.
  - Helpers: `isSchoolOwner`, `isSchoolViewer` (owner or principal), `isActivePrincipal`, `isActiveTeacher`, `familyActive`, `familyOwns(studentId)`, `familyInClass`, `classTeacherOf(classId)`, `teachesClass`, `withinLimit`.
- The UI shell (`ui.mjs`) turns each direct child `<section>` of a dashboard into a tile. Hidden sections are excluded. `ui-open` event with detail = section id opens a tile.

## 4. State of batches
- Batches 46 and 47 are live. Batches 48 (teacher panel loads in parallel and shows attendance error codes) and 49 (student results tile with a term/exam picker) were delivered; the live portal showed batch 49.
- Batch 50 (delivered to the user's folder; tests and deploy NOT confirmed):
  - removed the portal jump bar;
  - honest email-verification prompt in `platform.mjs` (hidden for existing members, with a "Send verification email" button);
  - student leave requests: rules and `studentLeaves/{studentId_fromDate}`, `tests/studentleave.rules.test.mjs`, a portal Leave Request tile, a class-teacher "Student Leave (my class)" tile, and an owner/principal "Student Leave" tile.
  - Approver: the CLASS TEACHER decides, not the HOD. The owner and principal can also decide.
- Batch 51 (delivered; tests and deploy NOT confirmed):
  - separate Student Dashboard and Parent Dashboard (role from `familyAccess.relation`): home panel with stat cards, today's timetable, recent homework, upcoming dates and quick links; role-specific tile names and order;
  - My Profile / My Child, student Digital ID Card (printable), parent Fees & Bus & Messages & Meetings, student Submit Homework;
  - new Study Materials (title plus https link; teacher form; rules `materials/{id}`; `tests/materials.rules.test.mjs`).
- The user runs the batch 50 and 51 tests together. Both are in `tests/run-tests.cmd`.
- Waiting for feedback:
  - whether the teacher's Daily Attendance works after batch 48 (possible `resource-exhausted` from the free-plan quota; Blaze recommended);
  - screenshots of both new dashboards, to polish spacing and colours.

## 5. Unfinished work

### A. Blocked or outside-service items

**1. Domain mapping (067)**
- Missing: each school gets its own address such as `myschool.com`, with the secure padlock.
- Who blocks it: Hostinger. A static plan serves one domain; extra domains need a plan that allows many sites, and each needs its own SSL certificate.
- Verified via the Hostinger connector: the Business plan (`hostinger_business_v3`, order 1009650040) supports addon/parked domains, so Hostinger does not block custom domains. Remaining blockers are the school's DNS change, Firebase authorized domains, and SSL on parked domains (unverified).
- User does: check hPanel for extra domains and automatic SSL; the school points its DNS at the server.
- Built already: the app records each school's domain request.
- Buildable by me: a domain-to-school lookup so a custom domain opens the right school.

**2. Automated billing and renewals (071)**
- Missing: send invoices automatically, move a school to "overdue" when it doesn't pay, and suspend it after the grace period.
- Who blocks it: Firebase. Changes happen only when someone opens the app; a scheduled job needs Cloud Functions.
- User does: upgrade Firebase to the Blaze plan (pay-as-you-go) with a low budget alert.

**3. Automated backups and restore (086)**
- Missing: a nightly backup and a tested restore.
- Who blocks it: Firebase. Today a backup happens only when the owner presses Download; automatic backup needs a scheduled job and Firestore export, both on Blaze.
- User does: the same Blaze upgrade.

**4. API rate limits (108)**
- Missing: a hard cap on requests per school.
- Who blocks it: Firebase. Security rules can't count how often something happens; real limits need a server-side check or App Check.
- User does: turn on App Check in the Firebase console. Per-school counting also needs Blaze.
- Built already: simple in-page limits that slow down careless spam, but they can't stop a determined attacker.

**5. Bengali and Hindi (096)**
- Missing: a native speaker confirms the Bengali and Hindi words are correct and natural.
- Who blocks it: a person.
- User does: ask a teacher or parent who reads each language to review the screens.

**What this means**
- One Blaze upgrade unlocks 071 and 086 and half-unlocks 108.
- It also unlocks four of the 8 outside-service items: payment gateway, WhatsApp, AI drafting and background jobs.
- Hostinger controls 067 and 100, the two domain items.
- A native speaker is the only thing that finishes 096.
- Best next step: upgrade to Blaze with a low budget alert; then build background jobs, automatic billing and backups.

### B. The 8 outside-service items
- IDs: 078, 082, 092, 097, 098, 100, 102, 126. Their exact names are in the tracker CSV.
- Four of them (payment gateway, WhatsApp, AI drafting, background jobs) need Blaze or an outside account. 100 is a domain item (Hostinger).
- Suggested outside accounts: a Razorpay test account, and uptime monitoring.

### C. Not built in the portals
- Live bus tracking: needs a GPS device on each bus. Bus & Route shows route, stop, vehicle and driver only.
- Pay Fees Online: needs a payment gateway. Fees shows balance and history.
- Direct file upload for study materials (links only today).
- Class teacher's name on the parent screen: the app doesn't store a teacher name.
- Multi-child parents: `familyInClass` only matches the primary child's class (or `extraClassIds`), so homework and materials for a second child may fail to load. A known limitation to fix.

### D. Product decisions and ideas
- Plan-based feature gating:
  - today every school gets every feature in the code;
  - only student and staff limits, billing status, and platform-wide feature switches exist (website, finance, library, transport; they only hide tiles);
  - build a per-school plan record deciding which tiles are enabled, enforced in rules for the important ones.
  - Ask the user what each plan includes (Basic and Premium, or one plan).
- Pushing a batch makes it live for every school at once. Test on the ABCD demo school first.
- Optional: demo rows for vehicles and appraisals; show an approved-leave hint on the attendance sheet.

### E. Housekeeping and reminders
- Tracker CSV status updates once the user confirms things live: 012, 025, 030, 084, 091, 093, 112, 119, 127 move to Built; 066, 077, 118 are closer; 001, 009, 068 were built in batch 47 and await live confirmation. Send the updated CSV after confirmation.
- Optional cleanup: `git rm` the 7 stray duplicate app files in the repo root (the user hasn't confirmed).
- One-time `platformAdmins/{uid}` console step.
- 3 dangling `familyAccess` docs can be deleted only with explicit approval.
- Concession `note` privacy choice is open.
- The user should download one backup.
- Free Firebase quota may be exhausted by the demo data (`resource-exhausted`); Blaze is recommended.

## 6. Suggested first message in the new chat
"Read HANDOVER.md. First, help me run the batch 50 and 51 tests and deploy. Then guide me through the Blaze upgrade, and build background jobs, automatic billing and backups."
