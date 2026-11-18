// Marketing site behaviour: menu, reveal-on-scroll, 3D tilt cards, counters, pricing toggle, contact form and the WebGL scene.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

document.querySelector('.burger')?.addEventListener('click', () => document.querySelector('.links').classList.toggle('open'));

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: .12 });
$$('.reveal').forEach((el) => io.observe(el));

// Tilt: cards turn toward the pointer.
if (!reduced && matchMedia('(hover: hover)').matches) {
  for (const card of $$('.card')) {
    let frame = 0;
    card.addEventListener('pointermove', (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        card.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-3px)`;
      });
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  }
}

// Counters
const counter = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target, end = Number(el.dataset.count), t0 = performance.now();
    const tick = (t) => { const p = Math.min(1, (t - t0) / 1600); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString('en-IN') + (el.dataset.suffix ?? ''); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    counter.unobserve(el);
  }
}, { threshold: .5 });
$$('[data-count]').forEach((el) => counter.observe(el));

// Pricing toggle (monthly / yearly)
const toggle = document.querySelector('.toggle');
if (toggle) {
  toggle.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', toggle).forEach((x) => x.classList.toggle('on', x === b));
    const yearly = b.dataset.mode === 'yearly';
    $$('[data-monthly]').forEach((el) => { el.textContent = yearly ? el.dataset.yearly : el.dataset.monthly; });
    $$('[data-per]').forEach((el) => { el.textContent = yearly ? '/ year' : '/ month'; });
  });
}

// Contact form: opens the visitor's email app with the message filled in (no server needed).
document.querySelector('form.contact')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = `Name: ${f.get('name')}\nSchool: ${f.get('school')}\nPhone: ${f.get('phone')}\nStudents: ${f.get('size')}\n\n${f.get('message')}`;
  location.href = 'mailto:hello@example-saas.com?subject=' + encodeURIComponent('Demo request from ' + f.get('school')) + '&body=' + encodeURIComponent(body);
  document.querySelector('#contact-status').textContent = 'Opening your email app. If nothing opens, write to hello@example-saas.com.';
});

// Roles: tabs on the features page.
const tabs = document.querySelector('.tabs');
if (tabs) {
  const panels = $$('.role-panel');
  const show = (id) => {
    $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.role === id));
    panels.forEach((p) => { p.hidden = p.id !== 'role-' + id; });
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { show(b.dataset.role); history.replaceState(null, '', '#role-' + b.dataset.role); } });
  const wanted = location.hash.startsWith('#role-') ? location.hash.slice(6) : tabs.querySelector('button').dataset.role;
  show($$('button', tabs).some((b) => b.dataset.role === wanted) ? wanted : tabs.querySelector('button').dataset.role);
}

// Pause looping animations that are off screen so scrolling stays smooth.
const pauser = new IntersectionObserver((entries) => {
  for (const e of entries) e.target.classList.toggle('paused', !e.isIntersecting);
}, { rootMargin: '80px' });
$$('.deck,.deckwrap,.orb').forEach((el) => pauser.observe(el));

// ---------- WebGL scene (kept light: no glass pass, capped pixel ratio, pauses when hidden) ----------
(async function scene() {
  const canvas = document.getElementById('bg3d');
  if (!canvas || reduced) return;
  const small = innerWidth < 820 || matchMedia('(pointer: coarse)').matches;
  const weak = small || (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4;
  try {
    const THREE = await import('three');
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !weak, alpha: true, powerPreference: 'default' });
    const ratio = weak ? 1 : Math.min(devicePixelRatio, 1.5);
    renderer.setPixelRatio(ratio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    camera.position.set(0, 0, 9);
    scene.add(new THREE.AmbientLight(0x8fa4ff, .4));
    const warm = new THREE.PointLight(0xffd88a, 60, 30); warm.position.set(4, 3, 6); scene.add(warm);

    const hero = document.body.dataset.scene === 'hero';
    const group = new THREE.Group(); scene.add(group);
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: .22 });
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, .3, weak ? 90 : 140, weak ? 12 : 20, 2, 3), gold);
    group.add(knot);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshBasicMaterial({ color: 0xc9a24a, wireframe: true, transparent: true, opacity: .22 }));
    group.add(shell);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.9, .018, 8, 120), new THREE.MeshBasicMaterial({ color: 0xecd592, transparent: true, opacity: .55 }));
    ring.rotation.x = 1.1; group.add(ring);
    let gems = [];
    if (!weak) {
      const gemMat = new THREE.MeshStandardMaterial({ color: 0x1d2f66, metalness: .6, roughness: .2 });
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.45), gemMat); gem.position.set(-2.2, 1.4, 1);
      const gem2 = new THREE.Mesh(new THREE.OctahedronGeometry(.32), gemMat); gem2.position.set(2.4, -1.5, .5);
      group.add(gem, gem2); gems = [gem, gem2];
    }

    const N = weak ? 350 : 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const r = 6 + Math.random() * 14, a = Math.random() * 6.283; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - .5) * 18; pos[i * 3 + 2] = Math.sin(a) * r - 6; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xecd592, size: .05, transparent: true, opacity: .75 }));
    scene.add(stars);

    let mx = 0, my = 0, sy = 0;
    if (!small) addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });
    addEventListener('scroll', () => { sy = scrollY / Math.max(1, document.body.scrollHeight - innerHeight); }, { passive: true });
    let timer = 0;
    function size() {
      const w = innerWidth, h = innerHeight, wide = w > 960;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      group.scale.setScalar(hero ? (wide ? 1 : w > 600 ? .8 : .62) : (wide ? .62 : .4));
      group.userData.baseX = wide ? (hero ? 3.1 : 4.6) : 0;
      group.userData.baseY = wide ? 0 : (hero ? 2.4 : 3.4);
    }
    addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(size, 150); }); size();

    // Draw at most 45 frames a second (30 on weak devices) and stop completely while the tab is hidden.
    const gap = 1000 / (weak ? 30 : 45);
    let last = 0;
    const clock = new THREE.Clock();
    renderer.setAnimationLoop((now) => {
      if (document.hidden || now - last < gap) return;
      last = now;
      const t = clock.getElapsedTime();
      knot.rotation.set(t * .22, t * .3, 0);
      shell.rotation.set(-t * .08, t * .1, 0);
      ring.rotation.z = t * .15;
      if (gems.length) { gems[0].rotation.set(t * .6, t * .4, 0); gems[1].rotation.set(-t * .5, t * .7, 0); gems[0].position.y = 1.4 + Math.sin(t * .9) * .25; }
      group.position.x += ((group.userData.baseX - mx * .8) - group.position.x) * .08;
      group.position.y += ((group.userData.baseY - my * .6 + sy * 2.4) - group.position.y) * .08;
      group.rotation.y += ((mx * .9 + sy * 3) - group.rotation.y) * .06;
      group.rotation.x += ((my * .5) - group.rotation.x) * .06;
      stars.rotation.y = t * .015 + sy * 1.2;
      camera.position.z = 9 - sy * 1.6;
      renderer.render(scene, camera);
    });
  } catch (error) {
    document.body.classList.add('no3d');
    console.warn('3D scene is not available on this device.', error);
  }
})();
