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
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.transform = `perspective(900px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateY(-4px)`;
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

// ---------- WebGL scene ----------
(async function scene() {
  const canvas = document.getElementById('bg3d');
  if (!canvas || reduced) return;
  try {
    const THREE = await import('three');
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    camera.position.set(0, 0, 9);
    scene.add(new THREE.AmbientLight(0x8fa4ff, .35));
    const warm = new THREE.PointLight(0xffd88a, 60, 30); warm.position.set(4, 3, 6); scene.add(warm);
    const cool = new THREE.PointLight(0x5b7bff, 40, 30); cool.position.set(-5, -2, 4); scene.add(cool);

    const hero = document.body.dataset.scene === 'hero';
    const group = new THREE.Group(); scene.add(group);
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 1, roughness: .18, clearcoat: 1, clearcoatRoughness: .1 });
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, .3, 260, 36, 2, 3), gold);
    group.add(knot);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshBasicMaterial({ color: 0xc9a24a, wireframe: true, transparent: true, opacity: .22 }));
    group.add(shell);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.9, .018, 16, 220), new THREE.MeshBasicMaterial({ color: 0xecd592, transparent: true, opacity: .55 }));
    ring.rotation.x = 1.1; group.add(ring);
    const ring2 = ring.clone(); ring2.rotation.set(.4, .9, 0); ring2.scale.setScalar(.82); group.add(ring2);
    const glass = new THREE.Mesh(new THREE.OctahedronGeometry(.45), new THREE.MeshPhysicalMaterial({ color: 0x1a2b5c, metalness: .2, roughness: .05, transmission: .6, thickness: .8, clearcoat: 1 }));
    glass.position.set(-2.2, 1.4, 1); group.add(glass);
    const glass2 = glass.clone(); glass2.position.set(2.4, -1.5, .5); glass2.scale.setScalar(.7); group.add(glass2);

    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const r = 6 + Math.random() * 14, a = Math.random() * 6.283, y = (Math.random() - .5) * 18; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r - 6; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xecd592, size: .045, transparent: true, opacity: .75, sizeAttenuation: true }));
    scene.add(stars);

    let mx = 0, my = 0, sy = 0;
    addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });
    addEventListener('scroll', () => { sy = scrollY / Math.max(1, document.body.scrollHeight - innerHeight); }, { passive: true });
    function size() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      const wide = w > 960;
      group.scale.setScalar(hero ? (wide ? 1 : .7) : (wide ? .62 : .4));
      group.userData.baseX = wide ? (hero ? 3.1 : 4.6) : 0;
      group.userData.baseY = wide ? 0 : (hero ? 2.2 : 3.2);
    }
    addEventListener('resize', size); size();

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const t = clock.getElapsedTime();
      knot.rotation.set(t * .22, t * .3, 0);
      shell.rotation.set(-t * .08, t * .1, 0);
      ring.rotation.z = t * .15; ring2.rotation.y = t * .2;
      glass.rotation.set(t * .6, t * .4, 0); glass2.rotation.set(-t * .5, t * .7, 0);
      glass.position.y = 1.4 + Math.sin(t * .9) * .25; glass2.position.y = -1.5 + Math.cos(t * .8) * .25;
      group.position.x += ((group.userData.baseX - mx * .8) - group.position.x) * .05;
      group.position.y += ((group.userData.baseY + my * -.6 + sy * 2.4) - group.position.y) * .05;
      group.rotation.y += ((mx * .9 + sy * 3) - group.rotation.y) * .04;
      group.rotation.x += ((my * .5) - group.rotation.x) * .04;
      stars.rotation.y = t * .015 + sy * 1.2; stars.rotation.x = sy * .4;
      camera.position.z = 9 - sy * 1.6;
      renderer.render(scene, camera);
    });
  } catch (error) {
    document.body.classList.add('no3d');
    console.warn('3D scene is not available on this device.', error);
  }
})();
