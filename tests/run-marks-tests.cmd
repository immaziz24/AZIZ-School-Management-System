@echo off
rem Runs the Marks Entry checks (features 042, 043) with synthetic data in the local Firestore Emulator.
rem Nothing is deployed and no live data is touched. Output is saved to tests\marks-test-output.txt.
cd /d "%~dp0.."
set OUT=tests\marks-test-output.txt
echo == node --check public/sign-in.mjs > "%OUT%"
node --check public\sign-in.mjs >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == git diff --check >> "%OUT%"
git diff --check >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
echo == firestore emulator rules tests >> "%OUT%"
call firebase emulators:exec --only firestore --project demo-aziz "node --test tests/marks.rules.test.mjs" >> "%OUT%" 2>&1
echo exit code %errorlevel% >> "%OUT%"
type "%OUT%"
pause
