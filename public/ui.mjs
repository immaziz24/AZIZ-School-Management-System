// App shell: turns each dashboard into a launcher of module tiles. Only the chosen module is shown, so
// every role gets a clean home screen instead of one very long page. The modules keep working as before.
const $ = (s, r = document) => r.querySelector(s);
const ICONS = [[/hostel/, '🛏️'], [/canteen|meal/, '🍽️'], [/pickup/, '🚸'], [/reminder|notification/, '🔔'], [/question|online test/, '🧠'], [/risk|benchmark/, '📊'], [/reservation/, '📚'], [/approval rule/, '⚙️'], [/qr/, '🔳'], [/shift|hours/, '⏰'], [/check-in|check in/, '📍'], [/fee|payment|defaulter|concession|sales|scholarship|ledger/, '💳'], [/attend/, '🗓️'], [/exam|mark|assess|result/, '📝'], [/report|card|certificate/, '📄'],
  [/student|roster|profile|alumni|family/, '🎓'], [/library|book/, '📚'], [/timetable|cover|workload/, '⏱️'], [/homework|lesson|syllabus|diary|submit/, '📒'],
  [/calendar|event|ptm|meeting/, '📅'], [/notice|inbox|message|enquir|complaint|consent/, '📣'], [/payroll|expense|finance|vendor/, '💰'], [/website|public/, '🌐'],
  [/staff|teacher|training|leave|class|assign|appraisal|my pay/, '🧑‍🏫'], [/route|rider|transport|activit/, '🚌'], [/health|behaviour|visitor|lost|achieve/, '🛡️'],
  [/inventory|asset|stock/, '📦'], [/backup|audit|log|import|export/, '💾'], [/plan|billing|support|ticket/, '💎'], [/platform|school/, '🏛️'],
  [/grading|setup|academic|promotion|summary|insight|attention|checklist/, '⚙️'], [/member|people/, '👥']];
const iconFor = (text) => (ICONS.find(([re]) => re.test(text.toLowerCase())) ?? [0, '✦'])[1];

// Categories for the module home screen. Each list is in the order the modules should appear; a module that is not listed
// goes to the last group, so a new module is never lost. Keys are section ids, or a lowercase title for loose headings.
const OWNER_CATS = [
  ['Daily work', ['attention', 'summary', 'checklist', 'attendance-review', 'student-leave', 'notices', 'inbox', 'calendar', 'timetable', 'substitutions', 'visitors', 'pickupgate', 'attendance-report']],
  ['Students and admissions', ['student-roster', 'roster', 'profile360', 'family-access', 'enquiries', 'bulk-import', 'promotion', 'cards', 'certificates', 'health', 'behaviour', 'achievements', 'alumni', 'hostelrooms', 'hostelstays', 'canteenmenu', 'canteenplans', 'pickuppeople']],
  ['Classes and exams', ['academic-setup', 'class-teachers', 'exam-setup', 'marks-review', 'report-card', 'grading', 'homework-owner', 'lessons-owner', 'syllabus', 'onlinetests', 'questionbank', 'riskboard', 'library', 'bookreservations', 'diary']],
  ['Fees and accounts', ['fees', 'defaulters', 'feereminders', 'concessions', 'scholarships', 'scholarshipapps', 'expenses', 'ledger', 'finance', 'sales', 'workflowrules', 'reports']],
  ['Staff', ['staffdir', 'staff-profiles', 'teacher assignment', 'staff directory', 'staff-attendance', 'checkins', 'qr-screen', 'disputes', 'hours', 'leave-review', 'payroll', 'bulk-cards', 'payslip', 'appraisals', 'trainings', 'workload']],
  ['Transport and campus', ['routes', 'riders', 'vehicles', 'activities', 'members', 'inventory', 'assets', 'tickets', 'vendors', 'lostfound', 'storage']],
  ['Parents and website', ['website', 'siteextras', 'ptm', 'eventregs', 'consents', 'complaints', 'minutes']],
  ['Settings and data', ['school profile', 'prefs', 'principal-access', 'backup', 'audit-log', 'plan-section', 'invite-accept']],
];
const TEACHER_CATS = [
  ['Teaching', ['attendance-mark', 'exam-marks', 'teacher-homework', 'teacher-assessments', 'teacher-submissions', 'teacher-lessons', 'teacher-materials', 'teacher-studentleave']],
  ['My work', ['checkin', 'dispute', 'my-attendance', 'leave-request', 'my-pay']],
  ['School', ['teacher-timetable', 'teacher-cover', 'teacher-calendar', 'teacher-notices']],
];
const PORTAL_CATS = [
  ['Study', ['portal-results', 'portal-attendance', 'portal-homework', 'portal-submit', 'portal-assessments', 'portal-tests', 'portal-materials', 'portal-timetable']],
  ['Fees and safety', ['portal-fees', 'portal-reminders', 'portal-push', 'portal-pickup', 'portal-idcard', 'portal-life']],
  ['School and messages', ['portal-notices', 'portal-calendar', 'portal-ptm', 'portal-events', 'portal-consents', 'portal-messages', 'portal-leave', 'portal-profile']],
];
const REST_NAME = 'More';
const COLLAPSE_KEY = 'aziz-collapsed-groups';
const readCollapsed = () => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; } };
const saveCollapsed = (value) => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(value)); } catch { /* storage may be blocked */ } };

const owner = $('#owner-dashboard');
const teacher = $('#teacher-dashboard');
const portal = $('#portal-dashboard');
const platformSection = $('#platform-section');
if (owner && $('#plan-section')) owner.append($('#plan-section'));
let platform = null;
if (platformSection) {
  platform = document.createElement('section');
  platform.id = 'platform-dashboard';
  platformSection.before(platform);
  platform.append(platformSection);
}
const dashes = [owner, teacher, portal, platform].filter(Boolean);

function prepare(dash, label) {
  dash.classList.add('dash');
  // Loose headings with their forms become modules of their own.
  if (dash !== portal) {
    const kids = [...dash.children];
    let group = null;
    for (const node of kids) {
      if (node.tagName === 'H3') {
        group = document.createElement('section');
        group.className = 'wrapped';
        node.before(group);
        group.append(node);
      } else if (node.tagName === 'SECTION' && node !== group) {
        group = null;
      } else if (group) {
        group.append(node);
      }
    }
  }
  for (const node of dash.children) {
    if (node.tagName === 'SECTION') node.classList.add('mod');
    else node.classList.add('hd', ...(dash === portal ? ['keep'] : []));
  }
  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  launcher.innerHTML = '<div class="launch-head"><h3></h3><input type="search" placeholder="Search modules" aria-label="Search modules" autocomplete="off"></div><div class="cats"></div>';
  launcher.querySelector('h3').textContent = label;
  const bar = document.createElement('div');
  bar.className = 'launcher-bar';
  bar.innerHTML = '<button type="button">← All modules</button><strong></strong>';
  const first = dash.querySelector(':scope > .mod');
  (first ?? dash).before(bar, launcher);
  const search = launcher.querySelector('input');
  const tiles = launcher.querySelector('.cats');
  const catList = dash === owner ? OWNER_CATS : dash === teacher ? TEACHER_CATS : dash === portal ? PORTAL_CATS : null;
  const groupOf = (section) => {
    if (!catList) return '';
    const keys = [section.id, titleOf(section).toLowerCase()];
    const found = catList.find(([, ids]) => keys.some((k) => ids.includes(k)));
    return found ? found[0] : REST_NAME;
  };
  const orderIn = (section) => {
    const keys = [section.id, titleOf(section).toLowerCase()];
    for (const [, ids] of catList) { const at = ids.findIndex((id) => keys.includes(id)); if (at >= 0) return at; }
    return 999;
  };
  const titleOf = (section) => (section.querySelector('h1,h2,h3')?.textContent ?? '').trim();
  const close = () => { dash.removeAttribute('data-open'); for (const m of dash.querySelectorAll(':scope > .mod-open')) m.classList.remove('mod-open'); scrollTo({ top: 0 }); };
  bar.querySelector('button').addEventListener('click', close);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && dash.dataset.open && !dash.hidden && !e.target.closest('input,select,textarea')) close(); });
  const open = (section) => {
    for (const m of dash.querySelectorAll(':scope > .mod-open')) m.classList.remove('mod-open');
    section.classList.add('mod-open');
    dash.dataset.open = '1';
    bar.querySelector('strong').textContent = titleOf(section);
    section.dispatchEvent(new CustomEvent('mod-open', { bubbles: true }));
    scrollTo({ top: 0 });
  };
  let queued = false;
  const rebuild = () => {
    queued = false;
    const modules = [...dash.querySelectorAll(':scope > .mod')].filter((m) => !m.hidden && !m.hasAttribute('data-off') && titleOf(m));
    const openNow = dash.querySelector(':scope > .mod-open');
    if (openNow && openNow.hidden) close();
    const words = search.value.trim().toLowerCase();
    tiles.replaceChildren();
    const made = new Map();
    const makeTile = (section) => {
      const title = titleOf(section);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      const icon = document.createElement('span'); icon.className = 'ti'; icon.textContent = iconFor(section.id + ' ' + title);
      const name = document.createElement('span'); name.className = 'tt'; name.textContent = title;
      tile.append(icon, name);
      tile.addEventListener('click', () => open(section));
      return tile;
    };
    const shown = modules.filter((section) => !words || titleOf(section).toLowerCase().includes(words));
    if (!catList || modules.length <= 8) {
      const grid = document.createElement('div'); grid.className = 'tiles';
      for (const section of shown) grid.append(makeTile(section));
      if (grid.children.length) tiles.append(grid);
    } else {
      const collapsed = readCollapsed();
      const names = [...catList.map(([name]) => name), REST_NAME];
      for (const section of shown) {
        const name = groupOf(section);
        if (!made.has(name)) made.set(name, []);
        made.get(name).push(section);
      }
      const bar = document.createElement('div'); bar.className = 'cat-tools';
      const expandAll = document.createElement('button'); expandAll.type = 'button'; expandAll.textContent = 'Expand all';
      const collapseAll = document.createElement('button'); collapseAll.type = 'button'; collapseAll.textContent = 'Collapse all';
      const setAll = (value) => { const next = readCollapsed(); for (const name of names) next[dash.id + ':' + name] = value; saveCollapsed(next); rebuild(); };
      expandAll.addEventListener('click', () => setAll(false));
      collapseAll.addEventListener('click', () => setAll(true));
      if (!words) bar.append(expandAll, collapseAll);
      if (bar.children.length) tiles.append(bar);
      let firstGroup = true;
      for (const name of names) {
        const list = made.get(name);
        if (!list || !list.length) continue;
        list.sort((a, b) => orderIn(a) - orderIn(b));
        const stateKey = dash.id + ':' + name;
        // A group nobody has touched opens only when it is the first one; searching opens every group that has a match.
        const closed = words ? false : (stateKey in collapsed ? collapsed[stateKey] : !firstGroup);
        firstGroup = false;
        const block = document.createElement('section'); block.className = 'cat' + (closed ? ' cat-closed' : '');
        const head = document.createElement('button'); head.type = 'button'; head.className = 'cat-head';
        head.setAttribute('aria-expanded', String(!closed));
        const arrow = document.createElement('span'); arrow.className = 'cat-arrow'; arrow.textContent = closed ? '▸' : '▾';
        const label = document.createElement('span'); label.className = 'cat-name'; label.textContent = name;
        const count = document.createElement('span'); count.className = 'cat-count'; count.textContent = String(list.length);
        head.append(arrow, label, count);
        const grid = document.createElement('div'); grid.className = 'tiles';
        for (const section of list) grid.append(makeTile(section));
        if (!words) head.addEventListener('click', () => { const next = readCollapsed(); next[stateKey] = !block.classList.contains('cat-closed'); saveCollapsed(next); rebuild(); });
        block.append(head, grid);
        tiles.append(block);
      }
    }
    if (!tiles.children.length) { const none = document.createElement('p'); none.textContent = words ? 'No module matches.' : 'Loading your modules.'; none.style.color = 'var(--mut)'; tiles.append(none); }
    refreshShell();
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(rebuild); } };
  search.addEventListener('input', rebuild);
  new MutationObserver(schedule).observe(dash, { attributes: true, attributeFilter: ['hidden', 'data-off'], subtree: true });
  schedule();
  dash.addEventListener('ui-open', (e) => { const target = dash.querySelector(':scope > #' + e.detail); if (target) open(target); });
}

const LABELS = new Map([[owner, 'Your school'], [teacher, 'Your classroom'], [portal, 'Your family portal'], [platform, 'Platform']]);
for (const dash of dashes) prepare(dash, LABELS.get(dash));

function refreshShell() {
  const active = dashes.some((d) => !d.hidden);
  document.body.classList.toggle('signed-in', active || !$('#sign-out').hidden);
}
const shell = new MutationObserver(refreshShell);
for (const el of [...dashes, $('#sign-out'), platformSection].filter(Boolean)) shell.observe(el, { attributes: true, attributeFilter: ['hidden'] });
if (platformSection) new MutationObserver(() => { platform.hidden = platformSection.hidden; }).observe(platformSection, { attributes: true, attributeFilter: ['hidden'] });
if (platform) platform.hidden = platformSection.hidden;
refreshShell();

// Live clock beside the Sign out button: day, date and time with seconds, on every panel.
const clock = $('#clock');
if (clock) {
  const longDate = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeText = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const parts = { long: $('.d-long', clock), short: $('.d-short', clock), time: $('.clock-time', clock) };
  const tick = () => {
    if (document.hidden || !document.body.classList.contains('signed-in')) return;
    const now = new Date();
    parts.long.textContent = longDate.format(now);
    parts.short.textContent = shortDate.format(now);
    parts.time.textContent = timeText.format(now).toUpperCase();
  };
  tick();
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
}
