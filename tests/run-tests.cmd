@echo off
rem Runs every rules test (synthetic data, local Firestore Emulator only). Nothing is deployed.
rem Output is saved to tests\test-output.txt.
cd /d "%~dp0.."
set OUT=tests\test-output.txt
echo == node --check public/sign-in.mjs > "%OUT%"
node --check public\sign-in.mjs >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == git diff --check >> "%OUT%"
git diff --check >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == firestore emulator rules tests >> "%OUT%"
call firebase emulators:exec --only firestore --project demo-aziz "node --test --test-concurrency=1 tests/marks.rules.test.mjs tests/academic.rules.test.mjs tests/students.rules.test.mjs tests/placement.rules.test.mjs tests/exams.rules.test.mjs tests/results.rules.test.mjs" >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
type "%OUT%"
pause
