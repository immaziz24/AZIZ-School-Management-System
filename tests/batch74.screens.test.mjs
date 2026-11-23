// Batch 74: checks the speed and refresh fixes in the screen files. No database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const html = read('index.html'); const css = read('sign-in.css'); const ui = read('ui.mjs'); const sw = read('sw.js'); const app = read('sign-in.mjs');

test('page starts on a loading screen, not the login form', () => {
  assert.match(html, /<html lang="en" class="booting">/);
  assert.match(html, /id="boot"/);
  assert.match(html, /html\.booting body>main\{display:none\}/);
});
test('login screen is released only after sign-in is known', () => {
  assert.match(app, /if \(!user\) \{ window\.__bootDone\?\.\(\); return; \}/);
  assert.match(ui, /if \(active\) window\.__bootDone\?\.\(\)/);
  assert.match(html, /setTimeout\(window\.__bootDone,6000\)/);
});
test('open module is kept in the address and restored', () => {
  assert.match(ui, /#m=/);
  assert.match(ui, /popstate/);
  assert.match(ui, /wanted/);
});
test('heavy effects are gone', () => {
  assert.equal(css.includes('backdrop-filter'), false);
  assert.equal(css.includes('perspective:'), false);
  assert.equal(css.includes('preserve-3d'), false);
  assert.equal(/body::before,body::after\{[^}]*filter:blur/.test(css), false);
  assert.match(css, /content-visibility:auto/);
});
test('rebuild skips unchanged tiles and search is delayed', () => {
  assert.match(ui, /sig === lastSig/);
  assert.match(ui, /setTimeout\(rebuild, 60\)/);
  assert.match(ui, /typing = setTimeout/);
});
test('versioned files are served from the saved copy', () => {
  assert.match(sw, /searchParams\.has\('v'\)/);
  assert.match(sw, /aziz-shell-v7/);
});
test('cache numbers were bumped together', () => {
  for (const name of ['ui.mjs', 'sign-in.mjs', 'sign-in.css']) assert.match(html, new RegExp(name.replace('.', '\\.') + '\\?v=batch-\\d+'));
});
test('tile icons are not mixed up', () => {
  assert.match(ui, /\[\/activity log\|audit log\/, '📜'\]/);
  assert.match(ui, /\[\/attention\/, '⚠️'\]/);
});

test('super admin lands on the Super Admin Panel and can open a school read-only', () => {
  const platform = read('platform.mjs');
  assert.match(app, /dataset\.mode = 'superadmin'/);
  assert.match(app, /Super admin \(view only\)/);
  assert.match(platform, /Open school \(view only\)/);
  assert.match(platform, /has\('school'\)/);
  assert.match(css, /body\[data-mode=superadmin\] #owner-dashboard/);
  assert.match(html, /<h2>Super Admin Panel<\/h2>/);
});
