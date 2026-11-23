# AZIZ School Management System: handover (after Batch 73, 23 Nov 2026)

Paste this whole file into a new chat first, then say what you want next.

## 1. The project
- Owner: Munna Aziz (munnaaziz0090@gmail.com, super admin UID jIDbkI2A6fVJnCoIgoUCkHZ2whu2).
- Multi-school SaaS. Static HTML/CSS/JS in `public\` plus Firebase Auth, Firestore, Storage and Cloud Functions.
- Local folder: `E:\AZIZ School Management System`
- GitHub: immaziz24/AZIZ-School-Management-System, branch `main`. Hostinger auto-deploys it (about 1 minute after a push).
- Live site: https://azizschoolmanagement.plateria.in/app
- Firebase project: `aziz-school-management-system` (Blaze plan). Firestore and functions region: asia-south1. Bucket: `aziz-school-management-system.firebasestorage.app`.
- The user runs all commands himself in cmd. A platform-admin record `platformAdmins/<UID>` exists for the account above (created in Batch 71 session). Same login is also owner of "ABCD School".

## 2. How the user wants to work (important)
- Explain steps simply.
- Give ALL cmd commands of a step in ONE code block.
- Each batch = two blocks: (1) run tests (`tests\run-tests.cmd`), then (2) deploy + git push.
- Lists must be ranked.
- Do as many features as possible per batch.
- Do not repeat mistakes: always really deliver files (see section 5) and verify sizes.
- Commit message must end with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: <the session URL from the system reminder>`.
- Standard push block:
  ```
  cd /d "E:\AZIZ School Management System"
  firebase deploy --only firestore:rules,functions
  git add -A
  git commit -m "Batch NN: ..." -m "Co-Authored-By: ..." -m "Claude-Session: ..."
  git push origin main
  ```
  If the functions deploy asks about container image retention, type 1. A 503 or 409 from Firebase is a temporary Google glitch: wait a few minutes and run only the deploy line again.

## 3. Status (roadmap tracker v11 = 158 features)
File: `E:\AZIZ School Management System\Claude outputs\AZIZ-roadmap-tracker-v11-158-b73.csv`
**145 built, 4 partial, 9 not started.** Last tests: 352 pass. All batches through 72 are deployed and pushed; Batch 73 (screens only) was committed to the device and needs only `git push`.

### Built in this long session (Batches 65 to 73)
- 65: staff document vault, storage overview, plan quotas, storage report.
- 66: backup restore tool (owner).
- 67: library QR scan desk and labels, student QR cards, teacher QR attendance, e-library, notice "Got it" acknowledgements.
- 68: automatic nightly fee reminders, live security alerts, System Health page (platform admin).
- 69: Approval Requests (teacher and principal ask, owner decides), Platform shortcut button, modules listed A to Z, phone push key set.
- 70: storage add-on requests (owner asks, platform admin approves and raises limit), biggest files list.
- 71: automatic billing (nightly invoices, overdue, renewal advance, suspension after grace, per-school switch), no charging.
- 72: theme marketplace, priced storage add-ons become invoices, billing reconciliation CSV.
- 73: camera QR scanning on iPhone and computers (jsQR from jsDelivr, pinned 1.4.0, no SRI hash).

### The 4 partial features
1. 071 automatic charging: needs the payment gateway (Razorpay test keys).
2. 108 App Check: code ready in `public\firebase-client.mjs` (`APP_CHECK_SITE_KEY = ''`). Needs the reCAPTCHA v3 site key (create at google.com/recaptcha/admin, register the secret in Firebase console App Check, send the site key).
3. 131 face matching and liveness: deliberately not faked. Needs a paid service (e.g. AWS Rekognition) or stay as is.
4. 077 native app: needs Google Play / App Store accounts. Web app is installable.

### The 9 not started (all need an outside account or device)
097 online fee payment gateway, 078 WhatsApp Business notifications, 098 AI notice drafting, 154 AI suggestions for struggling students, 082 transport GPS, 100 domain ownership and automatic TLS, 126 fingerprint attendance, 138 live classes and recording, 140 plagiarism check.

## 4. Technical notes
- Files in `public\`: index.html, sign-in.mjs (about 627 KB, the main app), platform.mjs (plan, billing, platform admin, health, marketplace, storage requests), school.mjs and school.html (public school page), ui.mjs (module launcher, A to Z tiles, categories OWNER_CATS / TEACHER_CATS / PORTAL_CATS), sign-in.css, i18n.mjs, qr.mjs, firebase-client.mjs, sw.js. Root: firestore.rules (about 186 KB, limit 256,000 bytes compiled), storage.rules, firebase.json, functions\index.js, tests\.
- Cache-bust query strings live in index.html (`sign-in.mjs?v=batch-73`, `platform.mjs?v=batch-72`, `ui.mjs?v=batch-69b`) and school.html (`school.mjs?v=batch-72`). Bump when a file changes.
- `.htaccess` at the repo root rewrites top-level files into `public\`. Any new top-level module file must be added to its RewriteRule list (qr.mjs was missed once).
- Cloud Functions (Node 22, v2, asia-south1): nightlyBackup (02:30 IST), listBackups, previewRestore, restoreBackup, pushOnNotice, pushOnFeeReminder, autoFeeReminders (09:00), runFeeRemindersNow, securityAlerts (auditLog trigger), healthCheck (every 6 h), runHealthNow, nightlyBilling (03:30), runBillingNow. Results go to `platformJobs/*` (platform admin reads). `BACKUP_COLLECTIONS` in functions/index.js must include any new school collection (approvalRequests is in).
- New collections: staffDocuments, eBooks, noticeAcks, securityAlerts (server writes, owner marks seen), approvalRequests, settings/autoReminders and autoRemindersLog, top-level storageRequests, platformJobs, platformConfig/marketplace (public read).
- Rules helpers: viewerAuth (owner or principal), ownerAuth, isSchoolOwner, isActivePrincipal, isActiveTeacher, isPlatformAdmin, validators named `validXxx`, `intIn`, `textLen`, `optText`, `dateText`.
- Roles: owner writes most data. Principal is view-only except notices, leave decisions and approval requests. Only the class teacher can write attendance (QR attendance lives in teacher Daily Attendance). Platform admin only sets billing, location and marketplace.
- Test pattern: tests\batchNN.rules.test.mjs use the Firestore emulator through REST (copy tests\batch72.rules.test.mjs). Add each new file to tests\run-tests.cmd. Test billing seeds need `{status:'active', storageMb:N}`. The emulator needs Java; the Claude workspace has no firebase CLI, so the user runs tests.
- Camera QR: BarcodeDetector in Android Chrome; elsewhere jsQR fallback (makeQrDetector in sign-in.mjs). QR formats: `AZSTU:<admissionNo>` (student card), `AZBK:<bookId>` (book label), school code `AZIZ:<8 letters>`.
- Cosmetic backlog: none known besides the user's own checks. Unverified by the user: System Health "Check now", billing "Run billing check now" on a test school, marketplace theme on the public page, e-library portal read, phone push on a real phone.

## 5. How to deliver files to the user's computer (do not skip)
1. Edit in a working copy in the Claude workspace; run `node --check` on every .mjs and functions\index.js.
2. `cp` changed files to `/mnt/user-data/outputs/bNN/`, then wait about 8 seconds.
3. Call device_commit_files with the exact device paths (`E:\AZIZ School Management System\public\...`), in a separate step from the cp.
4. Verify with device_stage_files that the byte sizes on the device match.
5. Then give the two cmd blocks.
Rules files go to the repo root, not public\. New tests go to `tests\`; trackers to `Claude outputs\`.

## 6. Suggested next steps (ranked)
1. Get the reCAPTCHA site key, switch on App Check (finishes 108).
2. Get the Razorpay test Key ID, build online fee payment, receipts and automatic renewal charging (097 and 071, payment parts of 127 and 157).
3. WhatsApp provider (078) or AI key (098, 154) if wanted.
4. Run the user's unverified checks above; fix anything found.
