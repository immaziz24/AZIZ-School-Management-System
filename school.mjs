// Public school page. Reads the one public document schools/abcd-school/site/main and lets visitors send
// an admission enquiry. Everything from the database is shown as plain text, never as HTML.
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app } from './firebase-client.mjs';

const db = getFirestore(app);
const wanted = new URLSearchParams(location.search).get('school') ?? '';
const SCHOOL_ID = /^[a-z][a-z0-9-]{2,29}$/.test(wanted) ? wanted : 'abcd-school';
const schoolRef = doc(db, 'schools', SCHOOL_ID);
const status = document.querySelector('#site-status');
const MAP = /^https:\/\/www\.google\.com\/maps\/embed\?[^ ]*$/;
const SECTIONS = [['about', 'About'], ['vision', 'Vision'], ['leadership', 'Leadership'], ['programmes', 'Programmes'],
  ['faculty', 'Faculty'], ['facilities', 'Facilities'], ['news', 'News'], ['gallery', 'Gallery'], ['contact', 'Contact'], ['admissions', 'Admissions']];

const lines = (value) => String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function fill(target, value, asList) {
  target.replaceChildren();
  const rows = lines(value);
  if (asList && rows.length > 1) {
    const list = document.createElement('ul');
    for (const row of rows) {
      const item = document.createElement('li');
      item.textContent = row;
      list.append(item);
    }
    target.append(list);
    return rows.length;
  }
  for (const row of rows) {
    const paragraph = document.createElement('p');
    paragraph.textContent = row;
    target.append(paragraph);
  }
  return rows.length;
}

function show(id, count) {
  document.querySelector('#' + id).hidden = !count;
}

// Colour themes chosen by the owner (site/extras). Only these fixed palettes are ever applied.
const THEMES = {
  classic: ['#14243d', '#faf6ec', '#b8913a', '#0f1b2f'], royal: ['#2e1a4d', '#f7f3fb', '#c29b3f', '#22123a'],
  emerald: ['#0f3d2e', '#f3f8f4', '#c0a040', '#0a2d22'], crimson: ['#5a1020', '#fbf4f2', '#c79a3a', '#430b17'],
  midnight: ['#0b1020', '#e8ecf5', '#d4af37', '#070a14'],
  saffron: ['#7a2e0e', '#fdf6ee', '#d19a2a', '#5a2009'], ocean: ['#0b3550', '#f1f7fa', '#c9a23c', '#082a40'],
  slate: ['#2b2f38', '#f4f5f7', '#b8913a', '#1f2229'],
};
async function loadExtras() {
  try {
    const extras = await getDoc(doc(schoolRef, 'site', 'extras'));
    if (!extras.exists()) return;
    const data = extras.data();
    if (data.tv === 2) document.body.classList.add('tv2'); // Template version chosen by the school.
    const theme = THEMES[data.theme];
    if (theme) {
      const root = document.documentElement.style;
      root.setProperty('--navy', theme[0]); root.setProperty('--ivory', theme[1]); root.setProperty('--gold', theme[2]);
      document.querySelector('nav.site').style.background = theme[3];
      if (data.theme === 'midnight') { root.setProperty('--ink', '#e8ecf5'); document.body.style.background = theme[0]; }
    }
    const host = document.querySelector('#extra-fields');
    host.replaceChildren();
    for (let slot = 1; slot <= 6; slot += 1) {
      if (!data['f' + slot]) continue;
      const [label, type, required, options] = String(data['f' + slot]).split('|');
      const p = document.createElement('p');
      const l = document.createElement('label');
      let input;
      if (type === 'textarea') { input = document.createElement('textarea'); input.rows = 3; }
      else if (type === 'select') {
        input = document.createElement('select');
        input.append(new Option('Choose', ''));
        for (const choice of String(options ?? '').split(';').map((c) => c.trim()).filter(Boolean)) input.append(new Option(choice, choice));
      } else { input = document.createElement('input'); input.type = type === 'number' || type === 'date' ? type : 'text'; }
      input.name = 'a' + slot; input.maxLength = 200;
      if (required === '1') input.required = true;
      l.append(label + (required === '1' ? ' *' : '') + ' ', input);
      p.append(l);
      host.append(p);
    }
  } catch { /* The standard form still works. */ }
}

async function load() {
  loadExtras();
  try {
    const saved = await getDoc(doc(schoolRef, 'site', 'main'));
    if (!saved.exists()) {
      status.textContent = 'This school page is being prepared. You can still send an admission enquiry below.';
      document.title = 'School website';
      document.querySelector('#site-name').textContent = 'Welcome';
      return;
    }
    const data = saved.data();
    status.hidden = true;
    document.title = data.name;
    document.querySelector('#site-name').textContent = data.name;
    document.querySelector('#site-tagline').textContent = data.tagline ?? '';
    show('about', fill(document.querySelector('#about-body'), data.about, false));
    const vision = lines(data.vision).length + lines(data.mission).length;
    const visionBody = document.querySelector('#vision-body');
    visionBody.replaceChildren();
    for (const [label, value] of [['Vision', data.vision], ['Mission', data.mission]]) {
      for (const row of lines(value)) {
        const paragraph = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = label + ': ';
        paragraph.append(strong, row);
        visionBody.append(paragraph);
      }
    }
    show('vision', vision);
    show('leadership', fill(document.querySelector('#leadership-body'), data.leadership, true));
    show('programmes', fill(document.querySelector('#programmes-body'), data.programmes, true));
    show('faculty', fill(document.querySelector('#faculty-body'), data.faculty, true));
    show('facilities', fill(document.querySelector('#facilities-body'), data.facilities, true));
    show('news', fill(document.querySelector('#news-body'), data.news, true));
    const galleryBody = document.querySelector('#gallery-body');
    galleryBody.replaceChildren();
    for (const row of lines(data.gallery)) {
      const [url, ...caption] = row.split('|').map((part) => part.trim());
      if (!/^https:\/\/[^ "'<>]{4,300}$/.test(url)) continue;
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = url;
      image.alt = caption.join(' ') || 'School photo';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.style.maxWidth = '100%';
      figure.append(image);
      if (caption.length) {
        const text = document.createElement('figcaption');
        text.textContent = caption.join(' ');
        figure.append(text);
      }
      galleryBody.append(figure);
    }
    show('gallery', galleryBody.children.length);
    if (data.seoTitle) document.title = data.seoTitle;
    if (data.seoDesc) document.querySelector('meta[name="description"]')?.setAttribute('content', data.seoDesc);
    const contact = document.querySelector('#contact-body');
    contact.replaceChildren();
    for (const [label, value] of [['Phone', data.phone], ['Email', data.email], ['Address', data.address]]) {
      if (!value) continue;
      const paragraph = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = label + ': ';
      paragraph.append(strong, value);
      contact.append(paragraph);
    }
    const map = document.querySelector('#map');
    if (data.mapUrl && MAP.test(data.mapUrl)) {
      map.src = data.mapUrl;
      map.hidden = false;
    }
    show('contact', contact.children.length + (map.hidden ? 0 : 1));
    document.querySelector('#footer-line').textContent = data.name + (data.address ? ' - ' + data.address : '');
    const nav = document.querySelector('#site-nav');
    nav.replaceChildren();
    for (const [id, label] of SECTIONS) {
      if (document.querySelector('#' + id).hidden) continue;
      const link = document.createElement('a');
      link.href = '#' + id;
      link.textContent = label;
      nav.append(link);
    }
  } catch {
    status.textContent = 'Could not load the school page. Please try again later.';
  }
}

// Abuse protection for the public form. These checks run in the visitor's browser: a short wait after the page
// opens, at least a minute between enquiries and three a day. They slow down careless spam; they cannot stop
// a determined attacker (that needs Firebase App Check, switched on in the console).
const loadedAt = Date.now();
const GAP_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_MAX = 3;
function recentSends() {
  try { return JSON.parse(localStorage.getItem('aziz-enquiry-times') ?? '[]').filter((time) => Number.isFinite(time) && Date.now() - time < DAY_MS); } catch { return []; }
}
function rememberSend() {
  try { localStorage.setItem('aziz-enquiry-times', JSON.stringify([...recentSends(), Date.now()])); } catch { /* Storage may be off. */ }
}
function tooFast() {
  if (Date.now() - loadedAt < 4000) return 'Please take a moment to fill in the form, then send it again.';
  const sends = recentSends();
  if (sends.length >= DAILY_MAX) return 'You have sent several enquiries today. Please phone the school office instead.';
  if (sends.length && Date.now() - sends[sends.length - 1] < GAP_MS) return 'Please wait a minute before sending another enquiry.';
  return '';
}

const form = document.querySelector('#enquiry-form');
const enquiryStatus = document.querySelector('#enquiry-status');
const today = () => {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = new FormData(form);
  const value = (key) => String(fields.get(key) ?? '').trim();
  if (value('website')) return; // A hidden field only automatic form-fillers complete.
  const slow = tooFast();
  if (slow) { enquiryStatus.textContent = slow; return; }
  const data = {
    studentName: value('studentName'), classApplying: value('classApplying'), guardianName: value('guardianName'),
    phone: value('phone'), createdAt: today(), status: 'new',
  };
  for (let slot = 1; slot <= 6; slot += 1) if (value('a' + slot)) data['a' + slot] = value('a' + slot).slice(0, 200);
  if (value('email')) data.email = value('email');
  if (value('message')) data.message = value('message');
  if (!data.studentName || !data.classApplying || !data.guardianName || !/^[0-9+() -]{6,20}$/.test(data.phone)) {
    enquiryStatus.textContent = 'Please fill in every required field. The phone number may use digits, +, spaces, hyphens and brackets.';
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  enquiryStatus.textContent = 'Sending.';
  const id = 'EQ-' + today().replaceAll('-', '') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  try {
    await setDoc(doc(schoolRef, 'enquiries', id), data);
    form.reset();
    rememberSend();
    enquiryStatus.textContent = 'Thank you. Your enquiry has been sent and the school office will contact you.';
  } catch {
    enquiryStatus.textContent = 'Sorry, your enquiry could not be sent. Please try again or phone the school.';
  } finally {
    button.disabled = false;
  }
});

load();
