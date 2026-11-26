// Publishes firestore.rules straight through the Firebase Rules API (works around the CLI's 409 error).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT = 'aziz-school-management-system';
const file = path.resolve('firestore.rules');
const content = fs.readFileSync(file, 'utf8');
const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const refresh = cfg.tokens && cfg.tokens.refresh_token;
if (!refresh) throw new Error('Not logged in. Run: firebase login');

const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refresh,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
}).then((r) => r.json());
if (!tok.access_token) throw new Error('Could not get a token: ' + JSON.stringify(tok));
const auth = { authorization: 'Bearer ' + tok.access_token, 'content-type': 'application/json' };
const api = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;

console.log('Rules file bytes:', Buffer.byteLength(content));
const rs = await fetch(`${api}/rulesets`, { method: 'POST', headers: auth, body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }) });
const rsBody = await rs.json();
console.log('Create ruleset:', rs.status, rs.ok ? rsBody.name : JSON.stringify(rsBody, null, 1));
if (!rs.ok) process.exit(1);

const relName = `projects/${PROJECT}/releases/cloud.firestore`;
const rel = await fetch(`https://firebaserules.googleapis.com/v1/${relName}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ release: { name: relName, rulesetName: rsBody.name } }) });
const relBody = await rel.json();
console.log('Update release:', rel.status, JSON.stringify(relBody, null, 1));
if (!rel.ok) process.exit(1);
console.log('\nDONE. The new rules are live.');
