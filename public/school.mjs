// Public school page. Reads the one public document schools/abcd-school/site/main and lets visitors send
// an admission enquiry. Everything from the database is shown as plain text, never as HTML.
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app } from './firebase-client.mjs';

const db = getFirestore(app);
const schoolRef = doc(db, 'schools', 'abcd-school');
const status = document.querySelector('#site-status');
const MAP = /^https:\/\/www\.google\.com\/maps\/embed\?[^ ]*$/;
const SECTIONS = [['about', 'About'], ['vision', 'Vision'], ['leadership', 'Leadership'], ['programmes', 'Programmes'],
  ['faculty', 'Faculty'], ['facilities', 'Facilities'], ['news', 'News'], ['contact', 'Contact'], ['admissions', 'Admissions']];

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

async function load() {
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
  const data = {
    studentName: value('studentName'), classApplying: value('classApplying'), guardianName: value('guardianName'),
    phone: value('phone'), createdAt: today(), status: 'new',
  };
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
    enquiryStatus.textContent = 'Thank you. Your enquiry has been sent and the school office will contact you.';
  } catch {
    enquiryStatus.textContent = 'Sorry, your enquiry could not be sent. Please try again or phone the school.';
  } finally {
    button.disabled = false;
  }
});

load();
