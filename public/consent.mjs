// Owner consent (Registration Mark 4). A school registered through the onboarding wizard starts with the terms and privacy agreement pending.
// Only the school's own owner can accept, signed in with a verified email: the server refuses anyone else, including platform administrators.
// This is a banner, not a lock, so it never stops the owner from working.
export async function mountConsent({ app, schoolId }) {
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
  const fns = getFunctions(app, 'asia-south1');
  let status;
  try { status = (await httpsCallable(fns, 'getConsentStatus')({ schoolId })).data; } catch { return; }
  if (!status || !status.applies || !status.pending) return;
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) el.append(kid);
    return el;
  };
  const bar = h('div', { role: 'region', 'aria-label': 'Agreement pending', style: 'position:sticky;top:0;z-index:50;background:#fff7e0;border-bottom:1px solid #e0b43c;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font:14px system-ui,sans-serif;color:#3b2f00' },
    h('b', {}, 'Action needed:'), h('span', { style: 'flex:1;min-width:220px' }, 'Please review and accept the Terms of Service and the Privacy and Data Processing Agreement for your school.'));
  const open = h('button', { type: 'button', style: 'padding:6px 14px;border-radius:8px;border:1px solid #b8913a;background:#fff;cursor:pointer;font:inherit' }, 'Review and accept');
  bar.append(open);
  const dialogue = () => {
    const terms = h('input', { type: 'checkbox', id: 'cs-terms' });
    const privacy = h('input', { type: 'checkbox', id: 'cs-privacy' });
    const msg = h('p', { role: 'status', style: 'min-height:1.2em;color:#a40000;margin:8px 0' });
    const accept = h('button', { type: 'button', style: 'padding:8px 16px;border-radius:8px;border:0;background:#14243d;color:#fff;cursor:pointer;font:inherit' }, 'Accept');
    const close = h('button', { type: 'button', style: 'padding:8px 16px;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer;font:inherit' }, 'Not now');
    const box = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Terms and privacy agreement', style: 'background:#fff;color:#111;max-width:520px;width:calc(100% - 32px);border-radius:14px;padding:20px;font:15px system-ui,sans-serif' },
      h('h2', { style: 'margin:0 0 8px' }, 'Terms and privacy agreement'),
      h('p', {}, 'Accepting is recorded against your name and verified email, with the version and the time. Only you, as the school owner, can accept for this school.'),
      h('p', {}, h('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Read the Terms of Service'), ' | ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Read the Privacy Policy')),
      h('p', {}, h('label', {}, terms, ' I accept the Terms of Service (version ' + status.termsVersion + ').')),
      h('p', {}, h('label', {}, privacy, ' I accept the Privacy and Data Processing Agreement (version ' + status.privacyVersion + ').')),
      msg, h('div', { style: 'display:flex;gap:10px' }, accept, close));
    const wrap = h('div', { style: 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center' }, box);
    close.addEventListener('click', () => wrap.remove());
    accept.addEventListener('click', async () => {
      if (!terms.checked || !privacy.checked) { msg.textContent = 'Tick both boxes to accept.'; return; }
      accept.disabled = true; msg.textContent = '';
      try {
        await httpsCallable(fns, 'acceptSchoolConsent')({ schoolId, terms: true, privacy: true, termsVersion: status.termsVersion, privacyVersion: status.privacyVersion });
        wrap.remove(); bar.remove();
      } catch (error) { msg.textContent = error?.message || 'Could not record your acceptance.'; accept.disabled = false; }
    });
    document.body.append(wrap); terms.focus();
  };
  open.addEventListener('click', dialogue);
  document.body.prepend(bar);
}
