// Teacher profile card (1920 x 1080 design units, drawn in the browser; no image service, no extra reads).
// Everything on the card comes from the saved teacher record, the centre's own name and logo, and the teacher's own photo.
// Nothing is invented: a field that is empty is not drawn. The library background and decorations are drawn in code, so there is no stored artwork.
export const CARD_W = 1920;
export const CARD_H = 1080;
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
};
const path2d = (d) => (typeof Path2D === 'function' ? new Path2D(d) : null);
function icon(g, name, x, y, size, color = C.gold) {
  const ic = ICONS[name]; const p = ic && path2d(ic.d); if (!p) return;
  g.save(); g.translate(x, y); g.scale(size / 24, size / 24); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.7; g.lineJoin = 'round'; g.lineCap = 'round';
  if (ic.fill) g.fill(p, 'evenodd'); else g.stroke(p); g.restore();
}

// A small deterministic random generator: the library background is the same for every card.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function goldGrad(g, x0, y0, x1, y1) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, C.champ); gr.addColorStop(0.5, C.gold); gr.addColorStop(1, '#9C7A1F'); return gr; }

function drawBackground(g) {
  const W = CARD_W; const H = CARD_H;
  let bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, C.rich); bg.addColorStop(0.45, C.burg); bg.addColorStop(1, C.maroon); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // The library: rows of books, softly blurred, on the right.
  g.save(); g.beginPath(); g.rect(900, 0, W - 900, H); g.clip();
  const blur = 'filter' in g; if (blur) g.filter = 'blur(7px)';
  const rand = rng(7); const tones = ['#7A1B25', '#5A1219', '#8C5A1F', '#3B0C10', '#A5782A', '#6B2A1A', '#4A0F16', '#9B3A2E'];
  for (let row = 0; row < 6; row++) { const baseY = 150 + row * 170; let x = 880;
    g.fillStyle = '#1A0507'; g.fillRect(880, baseY, W - 880, 12);
    while (x < W + 40) { const w = 22 + rand() * 30; const h = 100 + rand() * 55; g.fillStyle = tones[Math.floor(rand() * tones.length)]; g.globalAlpha = 0.85; g.fillRect(x, baseY - h, w, h); g.fillStyle = C.gold; g.globalAlpha = 0.35; g.fillRect(x + 3, baseY - h + 14, w - 6, 3); g.globalAlpha = 1; x += w + 2; } }
  if (blur) g.filter = 'none'; g.restore();
  // Warm cinematic light from behind the portrait.
  let glow = g.createRadialGradient(1520, 430, 40, 1520, 430, 720); glow.addColorStop(0, 'rgba(255,214,140,0.55)'); glow.addColorStop(0.5, 'rgba(212,120,60,0.18)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  // Keep the left side dark so the text is easy to read.
  let fade = g.createLinearGradient(820, 0, 1380, 0); fade.addColorStop(0, 'rgba(36,6,8,0.96)'); fade.addColorStop(1, 'rgba(36,6,8,0)'); g.fillStyle = fade; g.fillRect(0, 0, 1400, H);
  let vig = g.createRadialGradient(W / 2, H / 2, 380, W / 2, H / 2, 1180); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(18,7,9,0.7)'); g.fillStyle = vig; g.fillRect(0, 0, W, H);
  // A fine diagonal texture.
  g.save(); g.globalAlpha = 0.05; g.strokeStyle = C.champ; g.lineWidth = 1; g.beginPath(); for (let i = -H; i < W; i += 14) { g.moveTo(i, 0); g.lineTo(i + H, H); } g.stroke(); g.restore();
}

// Golden curved ribbons around the corners.
function drawRibbons(g) {
  const W = CARD_W; const H = CARD_H; const gr = goldGrad(g, 0, 0, 420, 420);
  const sweep = (flipX, flipY, k = 1) => { g.save(); g.translate(flipX ? W : 0, flipY ? H : 0); g.scale((flipX ? -1 : 1) * k, (flipY ? -1 : 1) * k);
    [[0, 330, 70, 190, 190, 70, 340, 0, 7, 0.95], [0, 372, 90, 230, 230, 90, 382, 0, 3, 0.7], [0, 292, 56, 160, 160, 56, 298, 0, 2, 0.55]].forEach(([x0, y0, a, b, c2, d2, x1, y1, lw, al]) => { g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(a, b, c2, d2, x1, y1); g.lineWidth = lw; g.globalAlpha = al; g.strokeStyle = gr; g.shadowColor = 'rgba(212,175,55,0.5)'; g.shadowBlur = 12; g.stroke(); });
    g.restore(); };
  g.save(); sweep(false, false, 0.5); sweep(true, true, 1); g.restore();
  g.save(); g.globalAlpha = 0.5; sweep(true, false, 1); sweep(false, true, 0.36); g.restore();
}

function fitSingle(g, text, family, weight, style, maxW, start, min) { for (let px = start; px >= min; px -= 2) { g.font = style + ' ' + weight + ' ' + px + 'px ' + family; if (g.measureText(text).width <= maxW) return px; } return min; }
function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '); while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1); keep[maxLines - 1] = last.trim() + '…'; return keep; }
  // One very long word still has to fit.
  return lines.map((l) => { let s = l; while (s.length > 1 && g.measureText(s).width > maxW) s = s.slice(0, -1); return s === l ? l : s.trim() + '…'; });
}

export function designationOf(t) {
  const s = Array.isArray(t.subjects) ? t.subjects.filter(Boolean) : [];
  if (!s.length) return ''; if (s.length === 1) return s[0] + ' Educator'; if (s.length === 2) return s[0] + ' & ' + s[1] + ' Educator'; return 'Multi-Subject Educator';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sinceText(d) { const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(d || '')); return m ? MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }
const has = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';

// The information rows, in order. A row with nothing to show is left out.
export function cardRows(t) {
  const rows = [];
  if (has(t.mobile)) rows.push({ icon: 'phone', label: 'Mobile', value: t.mobile.trim() });
  if (has(t.email)) rows.push({ icon: 'mail', label: 'Email', value: t.email.trim() });
  const acad = [has(t.highestQualification) ? t.highestQualification.trim() + (has(t.qualificationSubject) ? ' in ' + t.qualificationSubject.trim() : '') : '', has(t.otherQualifications) ? t.otherQualifications.trim() : ''].filter(Boolean).join(' · ');
  if (acad) rows.push({ icon: 'cap', label: 'Academic Qualification', value: acad });
  const train = [t.deled ? 'D.El.Ed' : '', t.bed ? 'B.Ed' : '', t.med ? 'M.Ed' : '', t.tet ? 'TET / CTET' : ''].filter(Boolean).join(' · ');
  if (train) rows.push({ icon: 'cert', label: 'Teaching Qualification', value: train });
  const subs = (Array.isArray(t.subjects) ? t.subjects : []).filter(Boolean).join(', '); if (subs) rows.push({ icon: 'book', label: 'Teaching Subjects', value: subs });
  const cls = (Array.isArray(t.classes) ? t.classes : []).filter(Boolean).join(', '); if (cls) rows.push({ icon: 'room', label: 'Assigned Classes', value: cls });
  return rows;
}

function laurel(g, cx, cy, r) {
  g.save(); g.translate(cx, cy);
  const gr = goldGrad(g, -r, -r, r, r);
  for (const side of [-1, 1]) {
    g.save(); g.scale(side, 1);
    g.beginPath(); g.arc(0, 0, r, Math.PI * 0.62, Math.PI * 1.32, false); g.lineWidth = 3; g.strokeStyle = gr; g.globalAlpha = 0.9; g.stroke(); g.globalAlpha = 1;
    for (let i = 0; i < 13; i++) { const a = Math.PI * 0.62 + (i / 12) * (Math.PI * 0.7); const x = Math.cos(a) * r; const y = Math.sin(a) * r;
      for (const out of [1, -1]) { g.save(); g.translate(x, y); g.rotate(a + (out > 0 ? 0.55 : -0.55) + Math.PI / 2); g.beginPath(); g.ellipse(0, -13 * out, 7, 17, 0, 0, Math.PI * 2); g.fillStyle = gr; g.globalAlpha = 0.95; g.fill(); g.restore(); } }
    g.restore();
  }
  g.restore();
}

function books(g, x, y) {
  const data = [[250, 34, '#7A1B25'], [226, 30, '#2E0A0E'], [240, 38, '#8C5A1F'], [210, 28, '#5A1219']];
  let yy = y; data.forEach(([w, h, col], i) => { const xx = x + (i % 2) * 14; yy -= h; g.fillStyle = col; g.fillRect(xx, yy, w, h); g.fillStyle = goldGrad(g, xx, yy, xx + w, yy); g.fillRect(xx + 14, yy + 6, w - 28, 3); g.fillRect(xx + 14, yy + h - 9, w - 28, 3); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(xx, yy + h - 5, w, 5); });
}

function archPath(g, x, y, w, h) { const r = w / 2; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); }

const loadImage = (src) => new Promise((resolve) => { if (!src) { resolve(null); return; } const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });

// Draws the card. data: { teacher, centreName, photo (data URL or ''), logo (data URL or '') }. scale 1 = 1920 x 1080, scale 2 = 3840 x 2160.
export async function paintTeacherCard({ teacher, centreName, photo, logo, scale = 1 }) {
  const t = teacher || {}; const [pimg, limg] = await Promise.all([loadImage(photo), loadImage(logo)]);
  const cv = document.createElement('canvas'); cv.width = CARD_W * scale; cv.height = CARD_H * scale; const g = cv.getContext('2d'); g.scale(scale, scale);
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* the system fonts are used */ } }
  drawBackground(g); drawRibbons(g);
  const X = 96; const LEFTW = 1000;
  const ls = (px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };

  // A. Badge
  g.save(); g.lineWidth = 2; g.strokeStyle = C.gold; g.beginPath(); if (g.roundRect) g.roundRect(X, 86, 292, 60, 30); else g.rect(X, 86, 292, 60); g.fillStyle = 'rgba(18,7,9,0.45)'; g.fill(); g.stroke();
  icon(g, 'cap', X + 20, 98, 36, C.gold); g.fillStyle = C.champ; g.font = '600 25px ' + SANS; ls(1.5); g.textBaseline = 'middle'; g.fillText('Teacher Profile', X + 66, 117); ls(0); g.restore();

  // B. Name (large gold serif; one line when it fits, else two)
  g.textBaseline = 'alphabetic'; const name = has(t.name) ? t.name.trim() : '';
  let y = 262; let px = fitSingle(g, name, SERIF, '700', '', LEFTW, 118, 70); g.font = '700 ' + px + 'px ' + SERIF; let nameLines = [name];
  if (g.measureText(name).width > LEFTW) { px = 64; y = 214; g.font = '700 ' + px + 'px ' + SERIF; nameLines = wrapLines(g, name, LEFTW, 2); }
  g.save(); g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
  nameLines.forEach((ln, i) => { g.font = '700 ' + px + 'px ' + SERIF; g.fillStyle = goldGrad(g, X, y - px, X + Math.min(LEFTW, g.measureText(ln).width), y); g.fillText(ln, X, y + i * px * 1.05); }); g.restore();
  y += (nameLines.length - 1) * px * 1.05;
  g.save(); g.strokeStyle = goldGrad(g, X, 0, X + 420, 0); g.lineWidth = 2; g.beginPath(); g.moveTo(X, y + 26); g.lineTo(X + 360, y + 26); g.stroke(); g.fillStyle = C.gold; g.translate(X + 380, y + 26); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.restore();

  // C. Designation
  const des = designationOf(t); y += 74;
  if (des) { g.font = 'italic 500 ' + fitSingle(g, des, SERIF, '500', 'italic', LEFTW, 46, 30) + 'px ' + SERIF; g.fillStyle = C.champ; g.fillText(des, X, y); y += 22; }

  // D. Coaching centre: logo (if any, in its own proportions), building icon and the registered name
  const centre = has(centreName) ? centreName.trim() : ''; y += 26;
  if (centre) {
    let tx = X; const LOGO_H = 76; let blockH = 40;
    if (limg && limg.width && limg.height) { const k = Math.min(150 / limg.width, LOGO_H / limg.height); const lw = limg.width * k; const lh = limg.height * k;
      g.save(); g.fillStyle = 'rgba(255,244,223,0.95)'; g.beginPath(); if (g.roundRect) g.roundRect(X, y - 8, lw + 20, lh + 16, 12); else g.rect(X, y - 8, lw + 20, lh + 16); g.fill(); g.drawImage(limg, X + 10, y, lw, lh); g.restore(); tx = X + lw + 42; blockH = Math.max(blockH, lh); }
    const maxW = LEFTW - (tx - X) - 56; let cpx = 30; g.font = '600 30px ' + SANS; ls(2.2); if (g.measureText(centre.toUpperCase()).width > maxW) cpx = 26; g.font = '600 ' + cpx + 'px ' + SANS; const lines = wrapLines(g, centre.toUpperCase(), maxW, 2); const textH = lines.length * (cpx + 8); const top = y + Math.max(0, (blockH - textH) / 2);
    icon(g, 'school', tx, top + (textH - 34) / 2 - 2, 34, C.gold); g.fillStyle = C.ivory; g.textBaseline = 'alphabetic'; lines.forEach((ln, i) => g.fillText(ln, tx + 50, top + cpx - 1 + i * (cpx + 8))); ls(0);
    y += Math.max(blockH, textH) + 24;
  }

  // E. Information rows, two columns, each with a golden icon
  const rows = cardRows(t); const colW = 470; const per = Math.ceil(rows.length / 2) || 1; const rowTop = Math.max(y + 16, 452);
  const expYears = t.experienceYears; const expLines = [];
  if (expYears !== null && expYears !== undefined && expYears !== '' && Number(expYears) >= 0) expLines.push(Number(expYears) + (Number(expYears) === 1 ? ' year' : ' years') + ' of teaching experience');
  const since = sinceText(t.joiningDate); if (since) expLines.push('Teaching' + (centre ? ' at ' + centre : '') + ' since ' + since);
  const panelH = expLines.length ? 36 + expLines.length * 38 + 26 : 0; const panelY = 960 - panelH;
  // The rows share the space above the experience panel and the laurel wreath; a crowded card gets tighter rows, never overlapping ones.
  const limit = Math.min(expLines.length ? panelY - 14 : 960, 765); const rowH = Math.max(78, Math.min(100, (limit - rowTop) / per)); const vfont = rowH >= 92 ? 25 : 23;
  rows.forEach((r, i) => { const col = i < per ? 0 : 1; const idx = col === 0 ? i : i - per; const rx = X + col * (colW + 52); const ry = rowTop + idx * rowH;
    g.save(); g.strokeStyle = C.gold; g.lineWidth = 1.6; g.beginPath(); g.arc(rx + 28, ry + 26, 28, 0, Math.PI * 2); g.fillStyle = 'rgba(18,7,9,0.5)'; g.fill(); g.stroke(); g.restore(); icon(g, r.icon, rx + 14, ry + 12, 28, C.gold);
    g.fillStyle = C.gold; g.font = '600 17px ' + SANS; ls(1.6); g.fillText(r.label.toUpperCase(), rx + 74, ry + 12); ls(0);
    g.font = '500 ' + vfont + 'px ' + SANS; g.fillStyle = C.ivory; wrapLines(g, r.value, colW - 78, 2).forEach((ln, j) => g.fillText(ln, rx + 74, ry + 42 + j * (vfont + 5))); });

  // Teaching experience panel (only when the teacher has experience or a joining date saved)
  if (expLines.length) { const py = panelY; const ph = panelH; g.save(); g.lineWidth = 2; g.strokeStyle = goldGrad(g, X, py, X + 720, py + ph); g.fillStyle = 'rgba(18,7,9,0.55)'; g.beginPath(); if (g.roundRect) g.roundRect(X, py, 720, ph, 18); else g.rect(X, py, 720, ph); g.fill(); g.stroke(); g.restore();
    icon(g, 'case', X + 24, py + 20, 34, C.gold); g.fillStyle = C.gold; g.font = '600 18px ' + SANS; ls(1.6); g.fillText('TEACHING EXPERIENCE', X + 74, py + 42); ls(0);
    g.fillStyle = C.ivory; g.font = '500 23px ' + SANS; expLines.forEach((ln, i) => { let s = ln; while (s.length > 4 && g.measureText(s).width > 720 - 100) s = s.slice(0, -1); g.fillText(s === ln ? ln : s.trim() + '…', X + 74, py + 82 + i * 38); }); }

  // Motto inside a golden laurel wreath
  laurel(g, 980, 892, 112); g.save(); g.textAlign = 'center'; g.fillStyle = C.champ; g.font = 'italic 600 33px ' + SERIF; ['Educate', 'Inspire', 'Empower'].forEach((w, i) => g.fillText(w, 980, 872 + i * 38)); g.restore();

  // Portrait: an arch frame on the right. The photo is placed from the top so heads are never cut off, and it is never stretched.
  const fx = 1190; const fy = 78; const fw = 650; const fh = 880;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 14; archPath(g, fx, fy, fw, fh); g.fillStyle = '#1A0507'; g.fill(); g.restore();
  g.save(); archPath(g, fx, fy, fw, fh); g.clip();
  if (pimg && pimg.width && pimg.height) { const k = Math.max(fw / pimg.width, fh / pimg.height); g.drawImage(pimg, fx + (fw - pimg.width * k) / 2, fy, pimg.width * k, pimg.height * k); }
  else { const pg = g.createLinearGradient(fx, fy, fx + fw, fy + fh); pg.addColorStop(0, '#650F1B'); pg.addColorStop(1, '#240608'); g.fillStyle = pg; g.fillRect(fx, fy, fw, fh); g.fillStyle = goldGrad(g, fx, fy, fx + fw, fy + fh); g.font = '700 340px ' + SERIF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((name || '?').charAt(0).toUpperCase(), fx + fw / 2, fy + fh / 2); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; }
  const sh = g.createLinearGradient(0, fy + fh - 220, 0, fy + fh); sh.addColorStop(0, 'rgba(36,6,8,0)'); sh.addColorStop(1, 'rgba(36,6,8,0.65)'); g.fillStyle = sh; g.fillRect(fx, fy + fh - 220, fw, 220); g.restore();
  g.save(); archPath(g, fx, fy, fw, fh); g.lineWidth = 7; g.strokeStyle = goldGrad(g, fx, fy, fx + fw, fy + fh); g.shadowColor = 'rgba(212,175,55,0.55)'; g.shadowBlur = 22; g.stroke(); g.restore();
  g.save(); archPath(g, fx + 16, fy + 16, fw - 32, fh - 32); g.lineWidth = 1.5; g.strokeStyle = 'rgba(242,214,154,0.55)'; g.stroke(); g.restore();
  books(g, 1130, 1060);

  // Platform branding (small and quiet)
  g.save(); g.fillStyle = C.champ; g.globalAlpha = 0.85; g.font = '500 19px ' + SANS; g.fillText('Powered by AZIZ School Management System', X, 1020); g.globalAlpha = 0.6; g.font = '400 16px ' + SANS; g.fillText('azizschoolmanagementsystem.com', X, 1046); g.restore();
  return cv;
}
