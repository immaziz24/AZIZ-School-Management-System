@echo off
rem Runs every rules test (synthetic data, local Firestore Emulator only). Nothing is deployed.
rem Output is saved to tests\test-output.txt.
cd /d "%~dp0.."
set OUT=tests\test-output.txt
echo == node --check public/sign-in.mjs > "%OUT%"
node --check public\sign-in.mjs >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == node --check public/admin.mjs >> "%OUT%"
node --check public\admin.mjs >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == git diff --check >> "%OUT%"
git diff --check >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == firestore emulator rules tests >> "%OUT%"
call firebase emulators:exec --only firestore --project demo-aziz "node --test --test-concurrency=1 tests/marks.rules.test.mjs tests/academic.rules.test.mjs tests/students.rules.test.mjs tests/placement.rules.test.mjs tests/exams.rules.test.mjs tests/results.rules.test.mjs tests/family.rules.test.mjs tests/attendance.rules.test.mjs tests/staffattendance.rules.test.mjs tests/leave.rules.test.mjs tests/fees.rules.test.mjs tests/notices.rules.test.mjs tests/audit.rules.test.mjs tests/grading.rules.test.mjs tests/timetable.rules.test.mjs tests/homework.rules.test.mjs tests/calendar.rules.test.mjs tests/library.rules.test.mjs tests/office.rules.test.mjs tests/schoollife.rules.test.mjs tests/community.rules.test.mjs tests/website.rules.test.mjs tests/coursework.rules.test.mjs tests/siblings.rules.test.mjs tests/principal.rules.test.mjs tests/approval.rules.test.mjs tests/lists.rules.test.mjs tests/lists2.rules.test.mjs tests/lists3.rules.test.mjs tests/lists4.rules.test.mjs tests/students2.rules.test.mjs tests/platform.rules.test.mjs tests/settings.rules.test.mjs tests/saas.rules.test.mjs tests/people.rules.test.mjs tests/marks2.rules.test.mjs tests/reports.rules.test.mjs tests/web.rules.test.mjs tests/accountant.rules.test.mjs tests/security.rules.test.mjs tests/hr.rules.test.mjs tests/studentleave.rules.test.mjs tests/materials.rules.test.mjs tests/batch52.rules.test.mjs tests/domain.rules.test.mjs tests/staffcard.rules.test.mjs tests/themes.rules.test.mjs tests/geofence.rules.test.mjs tests/attendance61.rules.test.mjs tests/batch62.rules.test.mjs tests/batch63.rules.test.mjs tests/batch64.rules.test.mjs tests/batch65.rules.test.mjs tests/batch65vault.rules.test.mjs tests/batch67.rules.test.mjs tests/batch68.rules.test.mjs tests/batch69.rules.test.mjs tests/batch70.rules.test.mjs tests/batch71.rules.test.mjs tests/batch72.rules.test.mjs tests/batch74.screens.test.mjs tests/batch75.rules.test.mjs tests/batch76.rules.test.mjs tests/batch77.rules.test.mjs tests/batch78.rules.test.mjs tests/batch79.rules.test.mjs tests/batch80.rules.test.mjs tests/batch90.rules.test.mjs tests/batch91.rules.test.mjs tests/batch96.rules.test.mjs tests/batch98.rules.test.mjs tests/onboarding.unit.test.mjs tests/onboarding.server.test.mjs tests/institution.test.mjs" >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
type "%OUT%"
pause
