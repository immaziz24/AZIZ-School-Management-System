// Teacher profile card (16:9) and A4 portfolio PDF pages, drawn in the browser. No image service, no extra database reads.
// Everything comes from the saved teacher record, the centre's own name and logo, and the teacher's own photo (the full-size master, never the thumbnail).
// A field that is empty is never drawn, and nothing is invented. The library and the books are drawn in code, so there is no stored artwork to pay for.
export const CARD_W = 1920;
export const CARD_H = 1080;
export const PAGE_W = 1240; // A4 at 150 units per inch; scale 2 gives 2480 x 3508 pixels (300 dpi)
export const PAGE_H = 1754;
const C = { burg: '#45090F', maroon: '#240608', rich: '#650F1B', gold: '#D4AF37', champ: '#F2D69A', ivory: '#FFF4DF', shadow: '#120709' };
const SERIF = "'Cormorant Garamond','Playfair Display','Libre Baskerville',Georgia,'Times New Roman','Noto Serif Bengali','Nirmala UI',serif";
const SANS = "Inter,'DM Sans','Segoe UI',Arial,'Noto Sans Bengali','Nirmala UI',sans-serif";

const ICONS = {
  phone: { fill: true, d: 'M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z' },
  mail: { d: 'M3 5.5h18v13H3z M3 6l9 7 9-7' },
  cap: { fill: true, d: 'M12 3L1 9l11 6 9-4.9V17h2V9L12 3z M5 13.2v4L12 21l7-3.8v-4L12 17z' },
  cert: { d: 'M3.5 4h17v12h-17z M7 8h10 M7 11.5h6 M15.5 15.5a2.6 2.6 0 1 0 0.01 0 M14 18l-1 3.5 2.5-1.2 2.5 1.2-1-3.5' },
  book: { d: 'M3.5 5c3-1 6.2-.8 8.5 1.2 2.3-2 5.5-2.2 8.5-1.2v13.5c-3-1-6.2-.8-8.5 1.2-2.3-2-5.5-2.2-8.5-1.2z M12 6.2v13.5' },
  room: { d: 'M3 4h18v11H3z M8 20l4-5 4 5 M7 8h7 M7 11.3h4' },
  case: { d: 'M3 8h18v12H3z M9 8V5h6v3 M3 13.5h18' },
  school: { d: 'M4 21V7.5l8-4 8 4V21 M9.5 21v-5.5h5V21 M8 10.5h2 M14 10.5h2 M8 13.5h2 M14 13.5h2 M2.5 21h19' },
  cal: { d: 'M4 6h16v14H4z M4 10h16 M8 3.5v5 M16 3.5v5' },
  pin: { d: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z M12 12.2a2.7 2.7 0 1 0 0.01 0' },
  id: { d: 'M3 5h18v14H3z M7.5 11a2 2 0 1 0 0.01 0 M5 16c.6-2 4.4-2 5 0 M13.5 9.5H18 M13.5 13H18' },
  note: { d: 'M5 3.5h14v17H5z M8.5 8h7 M8.5 11.5h7 M8.5 15h4' },
};
const path2d = (d) => (typeof Path2D === 'function' ? new Path2D(d) : null);
function icon(g, name, x, y, size, color = C.gold) {
  const ic = ICONS[name]; const p = ic && path2d(ic.d); if (!p) return;
  g.save(); g.translate(x, y); g.scale(size / 24, size / 24); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.7; g.lineJoin = 'round'; g.lineCap = 'round';
  if (ic.fill) g.fill(p, 'evenodd'); else g.stroke(p); g.restore();
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const rrect = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
// Metallic gold: a bright edge, a warm body and a deeper band, like gold foil.
function goldGrad(g, x0, y0, x1, y1) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, '#FFF1C9'); gr.addColorStop(0.28, '#E9C968'); gr.addColorStop(0.55, '#B58B26'); gr.addColorStop(0.78, '#E8CC82'); gr.addColorStop(1, '#9C7A1F'); return gr; }
function goldText(g, y, px, x0, x1) { const gr = g.createLinearGradient(x0, y - px * 0.9, x1, y + px * 0.12); gr.addColorStop(0, '#FFF3CF'); gr.addColorStop(0.42, '#E6C766'); gr.addColorStop(0.6, '#B8902A'); gr.addColorStop(1, '#F0D58C'); return gr; }

// A softly blurred library: wooden shelves, leather spines with gold tooling, a few leaning books and warm bokeh. Drawn the same way for every teacher.
function drawLibrary(g, x0, y0, w, h, seed) {
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip(); g.fillStyle = '#150706'; g.fillRect(x0, y0, w, h);
  const blur = 'filter' in g; if (blur) g.filter = 'blur(5px)';
  const rand = rng(seed); const shelfH = 200; const tones = ['#6E1823', '#4F1119', '#7A4A1C', '#3A1A12', '#8A6A2A', '#5C2417', '#2B2A3A', '#3F5239', '#7B2D26', '#44200F'];
  for (let r = 0; r * shelfH < h + shelfH; r++) {
    const baseY = y0 + (r + 1) * shelfH - 20; const back = g.createLinearGradient(0, baseY - shelfH, 0, baseY); back.addColorStop(0, '#2A0F0C'); back.addColorStop(1, '#170807'); g.fillStyle = back; g.fillRect(x0, baseY - shelfH + 14, w, shelfH - 14);
    let x = x0 - 12;
    while (x < x0 + w + 20) {
      if (rand() < 0.05) { x += 26 + rand() * 24; continue; }
      const bw = 20 + rand() * 30; const bh = 112 + rand() * 62; const col = tones[Math.floor(rand() * tones.length)]; const lean = rand() < 0.07 ? (rand() - 0.5) * 0.24 : 0;
      g.save(); g.translate(x + bw / 2, baseY); g.rotate(lean); const bx = -bw / 2;
      const sp = g.createLinearGradient(bx, 0, bx + bw, 0); sp.addColorStop(0, 'rgba(0,0,0,0.55)'); sp.addColorStop(0.18, col); sp.addColorStop(0.5, col); sp.addColorStop(0.82, 'rgba(0,0,0,0.35)'); sp.addColorStop(1, 'rgba(0,0,0,0.65)');
      g.fillStyle = col; g.fillRect(bx, -bh, bw, bh); g.fillStyle = sp; g.fillRect(bx, -bh, bw, bh);
      g.fillStyle = 'rgba(255,225,160,0.10)'; g.fillRect(bx + bw * 0.28, -bh, 2, bh);
      g.fillStyle = C.gold; g.globalAlpha = 0.55; g.fillRect(bx + 2, -bh + 14, bw - 4, 2.5); g.fillRect(bx + 2, -bh + 22, bw - 4, 1.5); g.fillRect(bx + 2, -22, bw - 4, 2.5);
      if (rand() < 0.6) { g.globalAlpha = 0.5; g.fillStyle = '#E8D3A0'; g.fillRect(bx + 4, -bh * 0.6, bw - 8, bh * 0.16); }
      g.globalAlpha = 1; g.restore(); x += bw + 1.5;
    }
    const wood = g.createLinearGradient(0, baseY, 0, baseY + 22); wood.addColorStop(0, '#6B3F22'); wood.addColorStop(0.15, '#4A2815'); wood.addColorStop(1, '#1B0C07'); g.fillStyle = wood; g.fillRect(x0, baseY, w, 22);
    g.fillStyle = 'rgba(255,214,150,0.25)'; g.fillRect(x0, baseY, w, 2);
    const sh = g.createLinearGradient(0, baseY + 22, 0, baseY + 60); sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(x0, baseY + 22, w, 38);
  }
  if (blur) g.filter = 'none';
  // Warm out-of-focus lights
  g.globalCompositeOperation = 'lighter'; const br = rng(seed + 11);
  for (let i = 0; i < 9; i++) { const cx = x0 + br() * w; const cy = y0 + br() * h * 0.7; const r = 26 + br() * 46; const bk = g.createRadialGradient(cx, cy, 0, cx, cy, r); bk.addColorStop(0, 'rgba(255,200,120,0.20)'); bk.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = bk; g.fillRect(cx - r, cy - r, r * 2, r * 2); }
  g.globalCompositeOperation = 'source-over'; g.restore();
}

function drawCardBackground(g) {
  const W = CARD_W; const H = CARD_H;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, C.rich); bg.addColorStop(0.45, C.burg); bg.addColorStop(1, C.maroon); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  drawLibrary(g, 900, 0, W - 900, H, 7);
  const glow = g.createRadialGradient(1540, 420, 40, 1540, 420, 700); glow.addColorStop(0, 'rgba(255,214,140,0.42)'); glow.addColorStop(0.5, 'rgba(212,120,60,0.14)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const fade = g.createLinearGradient(820, 0, 1400, 0); fade.addColorStop(0, 'rgba(36,6,8,0.97)'); fade.addColorStop(1, 'rgba(36,6,8,0)'); g.fillStyle = fade; g.fillRect(0, 0, 1420, H);
  const vig = g.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 1200); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(18,7,9,0.62)'); g.fillStyle = vig; g.fillRect(0, 0, W, H);
}

// Thin golden curves in the corners
function drawCurves(g, W, H, kLeft = 0.5, kRight = 1) {
  const gr = goldGrad(g, 0, 0, 420, 420);
  const sweep = (flipX, flipY, k) => { g.save(); g.translate(flipX ? W : 0, flipY ? H : 0); g.scale((flipX ? -1 : 1) * k, (flipY ? -1 : 1) * k);
    [[0, 330, 70, 190, 190, 70, 340, 0, 2.6, 0.9], [0, 366, 90, 226, 226, 90, 376, 0, 1.2, 0.65], [0, 296, 56, 160, 160, 56, 304, 0, 0.9, 0.5]].forEach(([x0, y0, a, b, c2, d2, x1, y1, lw, al]) => { g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(a, b, c2, d2, x1, y1); g.lineWidth = lw / Math.max(k, 0.5); g.globalAlpha = al; g.strokeStyle = gr; g.stroke(); });
    g.restore(); };
  g.save(); sweep(false, false, kLeft); sweep(true, true, kRight); g.globalAlpha = 0.6; sweep(true, false, kRight); sweep(false, true, kLeft * 0.72); g.restore();
}

function fitSingle(g, text, family, weight, style, maxW, start, min) { for (let px = start; px >= min; px -= 2) { g.font = style + ' ' + weight + ' ' + px + 'px ' + family; if (g.measureText(text).width <= maxW) return px; } return min; }
function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '); while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1); keep[maxLines - 1] = last.trim() + '…'; return keep; }
  return lines.map((l) => { let s = l; while (s.length > 1 && g.measureText(s).width > maxW) s = s.slice(0, -1); return s === l ? l : s.trim() + '…'; });
}

export function designationOf(t) {
  const s = Array.isArray(t.subjects) ? t.subjects.filter(Boolean) : [];
  if (!s.length) return ''; if (s.length === 1) return s[0] + ' Educator'; if (s.length === 2) return s[0] + ' & ' + s[1] + ' Educator'; return 'Multi-Subject Educator';
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function sinceText(d) { const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(d || '')); return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }
const has = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';
const yearsText = (y) => (y !== null && y !== undefined && y !== '' && Number.isFinite(Number(y)) && Number(y) >= 0 ? Number(y) + (Number(y) === 1 ? ' year' : ' years') : '');
const statusText = (s) => (s === 'invited' ? 'Invited (login not created yet)' : s === 'active' ? 'Active' : s === 'inactive' ? 'Switched off' : '');

// The information rows on the card, in order. A row with nothing to show is left out. hideContact removes mobile and email for public sharing.
export function cardRows(t, opts = {}) {
  const rows = [];
  if (!opts.hideContact && has(t.mobile)) rows.push({ icon: 'phone', label: 'Mobile', value: t.mobile.trim() });
  if (!opts.hideContact && has(t.email)) rows.push({ icon: 'mail', label: 'Email', value: t.email.trim() });
  const acad = [has(t.highestQualification) ? t.highestQualification.trim() + (has(t.qualificationSubject) ? ' in ' + t.qualificationSubject.trim() : '') : '', has(t.otherQualifications) ? t.otherQualifications.trim() : ''].filter(Boolean).join(' · ');
  if (acad) rows.push({ icon: 'cap', label: 'Academic Qualification', value: acad });
  const train = [t.deled ? 'D.El.Ed' : '', t.bed ? 'B.Ed' : '', t.med ? 'M.Ed' : '', t.tet ? 'TET / CTET' : ''].filter(Boolean).join(' · ');
  if (train) rows.push({ icon: 'cert', label: 'Teaching Qualification', value: train });
  const subs = (Array.isArray(t.subjects) ? t.subjects : []).filter(Boolean).join(', '); if (subs) rows.push({ icon: 'book', label: 'Teaching Subjects', value: subs });
  const cls = (Array.isArray(t.classes) ? t.classes : []).filter(Boolean).join(', '); if (cls) rows.push({ icon: 'room', label: 'Assigned Classes', value: cls });
  return rows;
}

// The sections of the PDF. Empty fields are left out and an empty section is left out. Administrative details come last and are drawn quieter.
export function pdfSections(t, opts = {}) {
  const list = (a) => (Array.isArray(a) ? a.filter(Boolean).join(', ') : '');
  const acad = has(t.highestQualification) ? t.highestQualification.trim() + (has(t.qualificationSubject) ? ' in ' + t.qualificationSubject.trim() : '') : '';
  const train = [t.deled ? 'D.El.Ed' : '', t.bed ? 'B.Ed' : '', t.med ? 'M.Ed' : '', t.tet ? 'TET / CTET passed' : ''].filter(Boolean).join(' · ');
  const batches = (Array.isArray(t.batches) ? t.batches : []).map((b) => b && b.name).filter(Boolean).join(', ');
  const defs = [
    { title: 'Academic Credentials', icon: 'cap', items: [['cap', 'Highest Qualification', acad], ['cert', 'Teaching Qualification', train], ['book', 'Other Qualifications', has(t.otherQualifications) ? t.otherQualifications.trim() : ''], ['case', 'Teaching Experience', yearsText(t.experienceYears)], ['book', 'Teaching Subjects', list(t.subjects)]] },
    { title: 'Teaching Assignments', icon: 'room', items: [['room', 'Assigned Classes', list(t.classes)], ['school', 'Assigned Batches', batches], ['cal', 'Joined Coaching Centre', sinceText(t.joiningDate)]] },
  ];
  if (!opts.hideContact) defs.push({ title: 'Contact Information', icon: 'phone', items: [['phone', 'Mobile', has(t.mobile) ? t.mobile.trim() : ''], ['mail', 'Email', has(t.email) ? t.email.trim() : ''], ['pin', 'Address', has(t.address) ? t.address.trim() : '']] });
  defs.push({ title: 'Administrative Information', icon: 'id', quiet: true, items: [['id', 'Teacher ID', has(t.id) ? t.id : ''], ['id', 'Account Status', statusText(t.status)], ['cal', 'Joined', sinceText(t.joiningDate)], ['note', 'Notes', has(t.notes) ? t.notes.trim() : '']] });
  return defs.map((d) => ({ ...d, items: d.items.filter((i) => i[2]).map(([ic, label, value]) => ({ icon: ic, label, value })) })).filter((d) => d.items.length);
}

function laurel(g, cx, cy, r) {
  g.save(); g.translate(cx, cy); const gr = goldGrad(g, -r, -r, r, r);
  for (const side of [-1, 1]) {
    g.save(); g.scale(side, 1); g.beginPath(); g.arc(0, 0, r, Math.PI * 0.62, Math.PI * 1.32, false); g.lineWidth = 2; g.strokeStyle = gr; g.globalAlpha = 0.9; g.stroke(); g.globalAlpha = 1;
    for (let i = 0; i < 11; i++) { const a = Math.PI * 0.62 + (i / 10) * (Math.PI * 0.7); const x = Math.cos(a) * r; const y = Math.sin(a) * r;
      for (const out of [1, -1]) { g.save(); g.translate(x, y); g.rotate(a + (out > 0 ? 0.55 : -0.55) + Math.PI / 2); g.beginPath(); g.ellipse(0, -9 * out, 4.8, 12, 0, 0, Math.PI * 2); g.fillStyle = gr; g.globalAlpha = 0.95; g.fill(); g.restore(); } }
    g.restore();
  }
  g.restore();
}

// Real-looking hardbound books, stacked: shaded covers, gold-tooled spines, page edges, a soft shadow beneath.
function bookStack(g, cx, baseY) {
  const books = [{ w: 600, h: 46, col: '#5A1219', dx: 0 }, { w: 540, h: 40, col: '#2F2417', dx: 22 }, { w: 480, h: 44, col: '#3E0E16', dx: -14 }];
  const sh = g.createRadialGradient(cx, baseY + 6, 10, cx, baseY + 6, 340); sh.addColorStop(0, 'rgba(0,0,0,0.65)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.scale(1, 0.16); g.fillStyle = sh; g.beginPath(); g.arc(cx, (baseY + 6) / 0.16, 340, 0, Math.PI * 2); g.fill(); g.restore();
  let y = baseY;
  books.forEach((b) => { y -= b.h; const x = cx - b.w / 2 + b.dx; const cov = g.createLinearGradient(0, y, 0, y + b.h); cov.addColorStop(0, 'rgba(255,230,190,0.30)'); cov.addColorStop(0.12, b.col); cov.addColorStop(0.8, b.col); cov.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = b.col; rrect(g, x, y, b.w, b.h, 6); g.fill(); g.fillStyle = cov; rrect(g, x, y, b.w, b.h, 6); g.fill();
    g.fillStyle = '#EAD9B2'; g.fillRect(x + b.w - 26, y + 4, 24, b.h - 8); g.strokeStyle = 'rgba(120,90,50,0.5)'; g.lineWidth = 1; for (let k = 8; k < b.h - 6; k += 4) { g.beginPath(); g.moveTo(x + b.w - 26, y + k); g.lineTo(x + b.w - 2, y + k); g.stroke(); }
    const sp = g.createLinearGradient(x + b.w - 26, 0, x + b.w, 0); sp.addColorStop(0, 'rgba(0,0,0,0.35)'); sp.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sp; g.fillRect(x + b.w - 26, y + 4, 26, b.h - 8);
    const gold = goldGrad(g, x, y, x + b.w, y); g.fillStyle = gold; g.globalAlpha = 0.9; g.fillRect(x + 54, y + 4, 3, b.h - 8); g.fillRect(x + 62, y + 4, 1.5, b.h - 8); g.fillRect(x + b.w - 96, y + 4, 3, b.h - 8); g.fillRect(x + b.w - 104, y + 4, 1.5, b.h - 8);
    g.globalAlpha = 0.85; g.fillRect(x + b.w / 2 - 60, y + b.h / 2 - 5, 120, 10); g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + b.w / 2 - 50, y + b.h / 2 - 1, 100, 2); });
}

function archPath(g, x, y, w, h) { const r = w / 2; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); }
const loadImage = (src) => new Promise((resolve) => { if (!src) { resolve(null); return; } const im = new Image(); im.onload = () => { if (typeof im.decode === 'function') im.decode().then(() => resolve(im), () => resolve(im)); else resolve(im); }; im.onerror = () => resolve(null); im.src = src; });
// The photo is drawn once, at full quality, from its top edge, never stretched and never blurred.
function drawPhoto(g, img, x, y, w, h) { const k = Math.max(w / img.width, h / img.height); if ('imageSmoothingEnabled' in g) g.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high'; g.drawImage(img, x + (w - img.width * k) / 2, y, img.width * k, img.height * k); }
function monogram(g, name, x, y, w, h) { const pg = g.createLinearGradient(x, y, x + w, y + h); pg.addColorStop(0, '#650F1B'); pg.addColorStop(1, '#240608'); g.fillStyle = pg; g.fillRect(x, y, w, h); g.fillStyle = goldGrad(g, x, y, x + w, y + h); g.font = '700 ' + Math.round(h * 0.4) + 'px ' + SERIF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((name || '?').charAt(0).toUpperCase(), x + w / 2, y + h / 2); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; }
const makeCanvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
const ready = async () => { if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* system fonts are used */ } } };

// ------------------------------------------------------------ The 16:9 card
// data: { teacher, centreName, photo (full-size data URL), logo, scale, hideContact }. scale 1 = 1920 x 1080, scale 2 = 3840 x 2160.
export async function paintTeacherCard({ teacher, centreName, photo, logo, scale = 1, hideContact = false }) {
  const t = teacher || {}; const [pimg, limg] = await Promise.all([loadImage(photo), loadImage(logo)]);
  const cv = makeCanvas(CARD_W * scale, CARD_H * scale); const g = cv.getContext('2d'); g.scale(scale, scale); await ready();
  drawCardBackground(g); drawCurves(g, CARD_W, CARD_H, 0.5, 1);
  const X = 96; const LEFTW = 1000; const ls = (px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };

  g.save(); g.lineWidth = 1.6; g.strokeStyle = C.gold; rrect(g, X, 86, 292, 60, 30); g.fillStyle = 'rgba(18,7,9,0.5)'; g.fill(); g.stroke();
  icon(g, 'cap', X + 20, 98, 36, C.gold); g.fillStyle = C.champ; g.font = '600 25px ' + SANS; ls(1.5); g.textBaseline = 'middle'; g.fillText('Teacher Profile', X + 66, 117); ls(0); g.restore();

  g.textBaseline = 'alphabetic'; const name = has(t.name) ? t.name.trim() : '';
  let y = 262; let px = fitSingle(g, name, SERIF, '700', '', LEFTW, 124, 70); g.font = '700 ' + px + 'px ' + SERIF; let nameLines = [name];
  if (g.measureText(name).width > LEFTW) { px = 64; y = 214; g.font = '700 ' + px + 'px ' + SERIF; nameLines = wrapLines(g, name, LEFTW, 2); }
  g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 16; g.shadowOffsetY = 5;
  nameLines.forEach((ln, i) => { g.font = '700 ' + px + 'px ' + SERIF; const by = y + i * px * 1.05; g.fillStyle = goldText(g, by, px, X, X + Math.min(LEFTW, g.measureText(ln).width)); g.fillText(ln, X, by); }); g.restore();
  y += (nameLines.length - 1) * px * 1.05;
  g.save(); g.strokeStyle = goldGrad(g, X, 0, X + 420, 0); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X, y + 26); g.lineTo(X + 360, y + 26); g.stroke(); g.fillStyle = C.gold; g.translate(X + 380, y + 26); g.rotate(Math.PI / 4); g.fillRect(-5, -5, 10, 10); g.restore();

  const des = designationOf(t); y += 76;
  if (des) { g.font = 'italic 500 ' + fitSingle(g, des, SERIF, '500', 'italic', LEFTW, 44, 30) + 'px ' + SERIF; g.fillStyle = C.champ; g.fillText(des, X, y); y += 20; }

  const centre = has(centreName) ? centreName.trim() : ''; y += 26;
  if (centre) {
    let tx = X; const LOGO_H = 76; let blockH = 40;
    if (limg && limg.width && limg.height) { const k = Math.min(150 / limg.width, LOGO_H / limg.height); const lw = limg.width * k; const lh = limg.height * k;
      g.save(); g.fillStyle = 'rgba(255,244,223,0.96)'; rrect(g, X, y - 8, lw + 20, lh + 16, 12); g.fill(); g.drawImage(limg, X + 10, y, lw, lh); g.restore(); tx = X + lw + 42; blockH = Math.max(blockH, lh); }
    const maxW = LEFTW - (tx - X) - 56; let cpx = 30; g.font = '600 30px ' + SANS; ls(2.2); if (g.measureText(centre.toUpperCase()).width > maxW) cpx = 26; g.font = '600 ' + cpx + 'px ' + SANS;
    const lines = wrapLines(g, centre.toUpperCase(), maxW, 2); const textH = lines.length * (cpx + 8); const top = y + Math.max(0, (blockH - textH) / 2);
    icon(g, 'school', tx, top + (textH - 34) / 2 - 2, 34, C.gold); g.fillStyle = C.ivory; lines.forEach((ln, i) => g.fillText(ln, tx + 50, top + cpx - 1 + i * (cpx + 8))); ls(0);
    y += Math.max(blockH, textH) + 24;
  }

  // Experience and joining date are separate: only entered experience is called experience.
  const expTxt = yearsText(t.experienceYears); const since = sinceText(t.joiningDate);
  const panels = []; if (expTxt) panels.push({ icon: 'case', head: 'TEACHING EXPERIENCE', text: expTxt + ' of teaching' }); if (since) panels.push({ icon: 'cal', head: 'MEMBER SINCE', text: since });
  const panelH = panels.length ? 108 : 0; const panelY = 960 - panelH; const panelW = panels.length === 2 ? 332 : 440;

  const rows = cardRows(t, { hideContact }); const colW = 470; const per = Math.ceil(rows.length / 2) || 1; const rowTop = Math.max(y + 16, 452);
  const limit = Math.min(panels.length ? panelY - 14 : 960, 800); const rowH = Math.max(78, Math.min(100, (limit - rowTop) / per)); const vfont = rowH >= 92 ? 25 : 23;
  rows.forEach((r, i) => { const col = i < per ? 0 : 1; const idx = col === 0 ? i : i - per; const rx = X + col * (colW + 52); const ry = rowTop + idx * rowH;
    g.save(); g.strokeStyle = C.gold; g.lineWidth = 1.4; g.beginPath(); g.arc(rx + 28, ry + 26, 28, 0, Math.PI * 2); g.fillStyle = 'rgba(18,7,9,0.5)'; g.fill(); g.stroke(); g.restore(); icon(g, r.icon, rx + 14, ry + 12, 28, C.gold);
    g.fillStyle = C.gold; g.font = '600 17px ' + SANS; ls(1.6); g.fillText(r.label.toUpperCase(), rx + 74, ry + 12); ls(0);
    g.font = '500 ' + vfont + 'px ' + SANS; g.fillStyle = C.ivory; wrapLines(g, r.value, colW - 78, 2).forEach((ln, j) => g.fillText(ln, rx + 74, ry + 42 + j * (vfont + 5))); });

  panels.forEach((p, i) => { const px0 = X + i * (panelW + 24); g.save(); g.lineWidth = 1.6; g.strokeStyle = goldGrad(g, px0, panelY, px0 + panelW, panelY + panelH); g.fillStyle = 'rgba(18,7,9,0.55)'; rrect(g, px0, panelY, panelW, panelH, 16); g.fill(); g.stroke(); g.restore();
    icon(g, p.icon, px0 + 22, panelY + 18, 30, C.gold); g.fillStyle = C.gold; g.font = '600 16px ' + SANS; ls(1.6); g.fillText(p.head, px0 + 64, panelY + 40); ls(0);
    g.fillStyle = C.ivory; g.font = '500 25px ' + SANS; let s = p.text; while (s.length > 4 && g.measureText(s).width > panelW - 44) s = s.slice(0, -1); g.fillText(s === p.text ? s : s.trim() + '…', px0 + 22, panelY + 82); });

  // The portrait: an arch with a thin gold edge, a sharp full-size photo, a warm glow behind it, and a stack of books beneath it.
  const fw = 600; const fh = 820; const fx = 1230; const fy = 64;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 44; g.shadowOffsetY = 16; archPath(g, fx, fy, fw, fh); g.fillStyle = '#1A0507'; g.fill(); g.restore();
  g.save(); archPath(g, fx, fy, fw, fh); g.clip();
  if (pimg && pimg.width && pimg.height) drawPhoto(g, pimg, fx, fy, fw, fh); else monogram(g, name, fx, fy, fw, fh);
  const sh = g.createLinearGradient(0, fy + fh - 200, 0, fy + fh); sh.addColorStop(0, 'rgba(36,6,8,0)'); sh.addColorStop(1, 'rgba(36,6,8,0.55)'); g.fillStyle = sh; g.fillRect(fx, fy + fh - 200, fw, 200); g.restore();
  g.save(); archPath(g, fx, fy, fw, fh); g.lineWidth = 4; g.strokeStyle = goldGrad(g, fx, fy, fx + fw, fy + fh); g.shadowColor = 'rgba(212,175,55,0.45)'; g.shadowBlur = 16; g.stroke(); g.restore();
  bookStack(g, fx + fw / 2, 1044);

  laurel(g, 985, 905, 80); g.save(); g.textAlign = 'center'; g.fillStyle = C.champ; g.font = 'italic 600 26px ' + SERIF; ['Educate', 'Inspire', 'Empower'].forEach((w, i) => g.fillText(w, 985, 884 + i * 29)); g.restore();

  g.save(); g.fillStyle = C.champ; g.globalAlpha = 0.85; g.font = '500 19px ' + SANS; g.fillText('Powered by AZIZ School Management System', X, 1020); g.globalAlpha = 0.6; g.font = '400 16px ' + SANS; g.fillText('azizschoolmanagementsystem.com', X, 1046); g.restore();
  return cv;
}

// ------------------------------------------------------------ The A4 portfolio PDF (one canvas per page; scale 2 = 300 dpi)
function pageBase(g, first) {
  const bg = g.createLinearGradient(0, 0, 0, PAGE_H); bg.addColorStop(0, C.burg); bg.addColorStop(0.5, '#33070C'); bg.addColorStop(1, C.maroon); g.fillStyle = bg; g.fillRect(0, 0, PAGE_W, PAGE_H);
  if (first) { drawLibrary(g, 0, 0, PAGE_W, 660, 21); const fade = g.createLinearGradient(0, 380, 0, 700); fade.addColorStop(0, 'rgba(51,7,12,0)'); fade.addColorStop(1, 'rgba(51,7,12,1)'); g.fillStyle = fade; g.fillRect(0, 380, PAGE_W, 330);
    const lr = g.createLinearGradient(0, 0, 820, 0); lr.addColorStop(0, 'rgba(36,6,8,0.94)'); lr.addColorStop(1, 'rgba(36,6,8,0.1)'); g.fillStyle = lr; g.fillRect(0, 0, 900, 660);
    const glow = g.createRadialGradient(960, 330, 30, 960, 330, 520); glow.addColorStop(0, 'rgba(255,214,140,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, PAGE_W, 700); }
  const vig = g.createRadialGradient(PAGE_W / 2, PAGE_H / 2, 500, PAGE_W / 2, PAGE_H / 2, 1250); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(18,7,9,0.5)'); g.fillStyle = vig; g.fillRect(0, 0, PAGE_W, PAGE_H);
}
function pageFooter(g, n, total, generated) {
  g.save(); g.strokeStyle = goldGrad(g, 90, 0, PAGE_W - 90, 0); g.lineWidth = 1.4; g.beginPath(); g.moveTo(90, PAGE_H - 120); g.lineTo(PAGE_W - 90, PAGE_H - 120); g.stroke(); g.fillStyle = C.gold; g.translate(PAGE_W / 2, PAGE_H - 120); g.rotate(Math.PI / 4); g.fillRect(-5, -5, 10, 10); g.restore();
  g.save(); g.fillStyle = C.champ; g.font = '500 21px ' + SANS; g.fillText('Powered by AZIZ School Management System', 90, PAGE_H - 74); g.globalAlpha = 0.65; g.font = '400 18px ' + SANS; g.fillText('azizschoolmanagementsystem.com', 90, PAGE_H - 46); g.globalAlpha = 0.85; g.textAlign = 'right'; g.font = '400 18px ' + SANS; g.fillText('Generated on ' + generated, PAGE_W - 90, PAGE_H - 74); g.fillText('Page ' + n + ' of ' + total, PAGE_W - 90, PAGE_H - 46); g.restore();
}

// data: { teacher, centreName, photo, logo, scale, hideContact, generated }. Returns an array of page canvases.
export async function paintTeacherPdfPages({ teacher, centreName, photo, logo, scale = 2, hideContact = false, generated }) {
  const t = teacher || {}; const [pimg, limg] = await Promise.all([loadImage(photo), loadImage(logo)]); await ready();
  const when = generated || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const m = makeCanvas(10, 10).getContext('2d'); const name = has(t.name) ? t.name.trim() : ''; const centre = has(centreName) ? centreName.trim() : '';
  const MX = 90; const GAPX = 60; const COLW = (PAGE_W - MX * 2 - GAPX) / 2; const BOTTOM = PAGE_H - 160;
  // Lay out the sections, then flow them onto as many pages as they need.
  const secs = pdfSections(t, { hideContact }).map((s) => { const vf = s.quiet ? 21 : 26; const lf = s.quiet ? 15 : 17; m.font = '500 ' + vf + 'px ' + SANS;
    const items = s.items.map((i) => ({ ...i, lines: wrapLines(m, i.value, COLW - (s.quiet ? 0 : 76), s.quiet ? 4 : 5) })); const rows = []; for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
    const rh = rows.map((r) => Math.max(...r.map((i) => (s.quiet ? 28 : 40) + i.lines.length * (vf + 9) + 22))); return { ...s, items, rows, rh, vf, lf, height: 76 + rh.reduce((a, b) => a + b, 0) + 20 }; });
  const pages = [{ y: 690, list: [] }]; for (const s of secs) { let pg = pages[pages.length - 1]; if (pg.y + s.height > BOTTOM) { pg = { y: 190, list: [] }; pages.push(pg); } pg.list.push({ s, y: pg.y }); pg.y += s.height; }
  const out = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const cv = makeCanvas(PAGE_W * scale, PAGE_H * scale); const g = cv.getContext('2d'); g.scale(scale, scale); const first = pi === 0; const ls = (px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };
    pageBase(g, first); drawCurves(g, PAGE_W, PAGE_H, 0.42, 0.3);
    if (first) {
      g.save(); g.lineWidth = 1.6; g.strokeStyle = C.gold; rrect(g, MX, 96, 276, 56, 28); g.fillStyle = 'rgba(18,7,9,0.55)'; g.fill(); g.stroke(); icon(g, 'cap', MX + 18, 107, 34, C.gold); g.fillStyle = C.champ; g.font = '600 23px ' + SANS; ls(1.4); g.textBaseline = 'middle'; g.fillText('Teacher Profile', MX + 62, 125); ls(0); g.restore(); g.textBaseline = 'alphabetic';
      const fw = 340; const fh = 430; const fx = PAGE_W - MX - fw; const fy = 200;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 36; g.shadowOffsetY = 12; archPath(g, fx, fy, fw, fh); g.fillStyle = '#1A0507'; g.fill(); g.restore();
      g.save(); archPath(g, fx, fy, fw, fh); g.clip(); if (pimg && pimg.width) drawPhoto(g, pimg, fx, fy, fw, fh); else monogram(g, name, fx, fy, fw, fh); g.restore();
      g.save(); archPath(g, fx, fy, fw, fh); g.lineWidth = 3.5; g.strokeStyle = goldGrad(g, fx, fy, fx + fw, fy + fh); g.stroke(); g.restore();
      if (limg && limg.width && limg.height) { const k = Math.min(190 / limg.width, 70 / limg.height); const lw = limg.width * k; const lh = limg.height * k; g.save(); g.fillStyle = 'rgba(255,244,223,0.96)'; rrect(g, PAGE_W - MX - lw - 20, 84, lw + 20, lh + 16, 10); g.fill(); g.drawImage(limg, PAGE_W - MX - lw - 10, 92, lw, lh); g.restore(); }
      const NW = fx - MX - 40; let y = 290; let px = fitSingle(g, name, SERIF, '700', '', NW, 84, 46); g.font = '700 ' + px + 'px ' + SERIF; let lines = [name];
      if (g.measureText(name).width > NW) { px = 46; g.font = '700 ' + px + 'px ' + SERIF; lines = wrapLines(g, name, NW, 3); y = 270; }
      g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 12; g.shadowOffsetY = 4; lines.forEach((ln, i) => { g.font = '700 ' + px + 'px ' + SERIF; const by = y + i * px * 1.08; g.fillStyle = goldText(g, by, px, MX, MX + g.measureText(ln).width); g.fillText(ln, MX, by); }); g.restore();
      y += (lines.length - 1) * px * 1.08 + 30; g.save(); g.strokeStyle = goldGrad(g, MX, 0, MX + 320, 0); g.lineWidth = 1.4; g.beginPath(); g.moveTo(MX, y); g.lineTo(MX + 300, y); g.stroke(); g.fillStyle = C.gold; g.translate(MX + 318, y); g.rotate(Math.PI / 4); g.fillRect(-4.5, -4.5, 9, 9); g.restore();
      const des = designationOf(t); y += 56; if (des) { g.font = 'italic 500 ' + fitSingle(g, des, SERIF, '500', 'italic', NW, 36, 26) + 'px ' + SERIF; g.fillStyle = C.champ; g.fillText(des, MX, y); y += 14; }
      if (centre) { y += 30; let cpx = 27; g.font = '600 27px ' + SANS; ls(2); if (g.measureText(centre.toUpperCase()).width > NW - 50) cpx = 23; g.font = '600 ' + cpx + 'px ' + SANS; const cl = wrapLines(g, centre.toUpperCase(), NW - 50, 3); icon(g, 'school', MX, y - 26, 32, C.gold); g.fillStyle = C.ivory; cl.forEach((ln, i) => g.fillText(ln, MX + 46, y + i * (cpx + 8))); ls(0); }
    } else {
      g.fillStyle = goldText(g, 110, 40, MX, MX + 400); g.font = '700 40px ' + SERIF; g.fillText(name, MX, 108); g.fillStyle = C.champ; g.font = '500 20px ' + SANS; ls(1.6); g.fillText(centre.toUpperCase(), MX, 146); ls(0);
      g.strokeStyle = goldGrad(g, MX, 0, PAGE_W - MX, 0); g.lineWidth = 1.2; g.beginPath(); g.moveTo(MX, 168); g.lineTo(PAGE_W - MX, 168); g.stroke();
    }
    for (const { s, y } of pages[pi].list) {
      icon(g, s.icon, MX, y + 2, 34, s.quiet ? 'rgba(242,214,154,0.65)' : C.gold); g.fillStyle = s.quiet ? 'rgba(242,214,154,0.7)' : C.gold; g.font = '600 ' + (s.quiet ? 21 : 26) + 'px ' + SANS; ls(2.4); g.fillText(s.title.toUpperCase(), MX + 48, y + 28); const tw = g.measureText(s.title.toUpperCase()).width; ls(0);
      g.strokeStyle = 'rgba(212,175,55,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(MX + 48 + tw + 20, y + 20); g.lineTo(PAGE_W - MX, y + 20); g.stroke();
      let ry = y + 68;
      s.rows.forEach((row, ri) => { row.forEach((it, ci) => { const x = MX + ci * (COLW + GAPX);
        if (!s.quiet) { g.save(); g.strokeStyle = C.gold; g.lineWidth = 1.3; g.beginPath(); g.arc(x + 26, ry + 22, 26, 0, Math.PI * 2); g.fillStyle = 'rgba(18,7,9,0.5)'; g.fill(); g.stroke(); g.restore(); icon(g, it.icon, x + 13, ry + 9, 26, C.gold); }
        const tx = x + (s.quiet ? 0 : 76); g.fillStyle = s.quiet ? 'rgba(242,214,154,0.7)' : C.gold; g.font = '600 ' + s.lf + 'px ' + SANS; ls(1.6); g.fillText(it.label.toUpperCase(), tx, ry + 12); ls(0);
        g.fillStyle = s.quiet ? 'rgba(255,244,223,0.82)' : C.ivory; g.font = '500 ' + s.vf + 'px ' + SANS; it.lines.forEach((ln, li) => g.fillText(ln, tx, ry + (s.quiet ? 40 : 46) + li * (s.vf + 9))); }); ry += s.rh[ri]; });
    }
    pageFooter(g, pi + 1, pages.length, when); out.push(cv);
  }
  return out;
}
