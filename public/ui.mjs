// App shell: turns each dashboard into a launcher of module tiles. Only the chosen module is shown, so
// every role gets a clean home screen instead of one very long page. The modules keep working as before.
const $ = (s, r = document) => r.querySelector(s);
const ICONS = [[/fee|payment|defaulter|concession|sales/, '💳'], [/attend/, '🗓️'], [/exam|mark|assess|result/, '📝'], [/report|card|certificate/, '📄'],
  [/student|roster|profile|alumni|family/, '🎓'], [/library|book/, '📚'], [/timetable|cover|workload/, '⏱️'], [/homework|lesson|syllabus|diary|submit/, '📒'],
  [/calendar|event|ptm|meeting/, '📅'], [/notice|inbox|message|enquir|complaint/, '📣'], [/payroll|expense|finance|vendor/, '💰'], [/website|public/, '🌐'],
  [/staff|teacher|training|leave|class|assign/, '🧑‍🏫'], [/route|rider|transport|activit/, '🚌'], [/health|behaviour|visitor|lost|achieve/, '🛡️'],
  [/inventory|asset|stock/, '📦'], [/backup|audit|log|import|export/, '💾'], [/plan|billing|support|ticket/, '💎'], [/platform|school/, '🏛️'],
  [/grading|setup|academic|promotion|summary|insight|attention|checklist/, '⚙️'], [/member|people/, '👥']];
const iconFor = (text) => (ICONS.find(([re]) => re.test(text.toLowerCase())) ?? [0, '✦'])[1];

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
  launcher.innerHTML = '<div class="launch-head"><h3></h3><input type="search" placeholder="Search modules" aria-label="Search modules" autocomplete="off"></div><div class="tiles"></div>';
  launcher.querySelector('h3').textContent = label;
  const bar = document.createElement('div');
  bar.className = 'launcher-bar';
  bar.innerHTML = '<button type="button">← All modules</button><strong></strong>';
  const first = dash.querySelector(':scope > .mod');
  (first ?? dash).before(bar, launcher);
  const search = launcher.querySelector('input');
  const tiles = launcher.querySelector('.tiles');
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
    for (const section of modules) {
      const title = titleOf(section);
      if (words && !title.toLowerCase().includes(words)) continue;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      const icon = document.createElement('span'); icon.className = 'ti'; icon.textContent = iconFor(section.id + ' ' + title);
      const name = document.createElement('span'); name.className = 'tt'; name.textContent = title;
      tile.append(icon, name);
      tile.addEventListener('click', () => open(section));
      tiles.append(tile);
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
