/**
 * Interactive 3D spare part for the hero card: a meshing spur-gear pair.
 *
 * - Teeth are generated (not a model file) and mesh at the correct ratio and phase.
 * - Drag (or arrow keys) turns the drive gear with momentum; the pinion follows.
 * - The scene tilts slightly toward the pointer; hovering a gear shows its part label.
 * - Three.js r128 loads from cdnjs after the page; rendering pauses off-screen.
 *   No WebGL / no library -> the card simply shows without the 3D part.
 */
import type * as THREE_NS from "three";
import type { Key, T } from "../../src/i18n/index.ts";

type Three = typeof THREE_NS;
declare global { interface Window { THREE?: Three } }

const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function loadThree(): Promise<Three> {
  if (window.THREE) return Promise.resolve(window.THREE);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = THREE_URL;
    s.async = true;
    const timer = window.setTimeout(() => reject(new Error("three.js load timeout")), 15000);
    s.onload = () => { window.clearTimeout(timer); window.THREE ? resolve(window.THREE) : reject(new Error("three.js missing")); };
    s.onerror = () => { window.clearTimeout(timer); reject(new Error("three.js failed to load")); };
    document.head.appendChild(s);
  });
}

/** Spur gear outline: z teeth, module m, with a bore and optional lightening holes. */
function gearShape(T: Three, z: number, m: number, bore: number, holes: number) {
  const rp = (m * z) / 2;          // pitch radius
  const ra = rp + m;               // tip
  const rf = rp - 1.2 * m;         // root
  const step = (Math.PI * 2) / z;
  const P = (r: number, a: number) => new T.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  const shape = new T.Shape();
  for (let k = 0; k < z; k++) {
    const a = k * step;
    const r0 = P(rf, a - 0.27 * step);
    const t0 = P(ra, a - 0.13 * step);
    const t1 = P(ra, a + 0.13 * step);
    const r1 = P(rf, a + 0.27 * step);
    const c0 = P(rp * 1.02, a - 0.215 * step);  // slightly convex flanks
    const c1 = P(rp * 1.02, a + 0.215 * step);
    if (k === 0) shape.moveTo(r0.x, r0.y); else shape.lineTo(r0.x, r0.y);
    shape.quadraticCurveTo(c0.x, c0.y, t0.x, t0.y);
    shape.absarc(0, 0, ra, a - 0.13 * step, a + 0.13 * step, false);
    shape.quadraticCurveTo(c1.x, c1.y, r1.x, r1.y);
    shape.absarc(0, 0, rf, a + 0.27 * step, a + 0.73 * step, false);
  }
  const hole = (cx: number, cy: number, r: number) => { const h = new T.Path(); h.absarc(cx, cy, r, 0, Math.PI * 2, true); return h; };
  shape.holes.push(hole(0, 0, bore));
  const ringR = (rf + bore) / 2 + 0.1;
  const holeR = Math.min((rf - bore) * 0.3, (Math.PI * ringR) / holes * 0.55);
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2 + Math.PI / holes;
    shape.holes.push(hole(Math.cos(a) * ringR, Math.sin(a) * ringR, holeR));
  }
  return { shape, rp };
}

function annulus(T: Three, outer: number, inner: number) {
  const s = new T.Shape();
  s.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const h = new T.Path();
  h.absarc(0, 0, inner, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/** `getT` returns the current translator, so labels follow language changes. */
export async function mountGear3D(host: HTMLElement, getT: () => T): Promise<void> {
  let T: Three;
  try { T = await loadThree(); } catch { host.hidden = true; host.closest(".hero-main")?.classList.add("no3d"); return; }

  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch { host.hidden = true; host.closest(".hero-main")?.classList.add("no3d"); return; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", getT()("gear.aria"));
  canvas.dataset.i18nAria = "gear.aria"; // refreshed by the page's language switch
  canvas.tabIndex = 0;
  host.prepend(canvas);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0, 30);

  // Soft studio reflections without loading an HDR file: a few bright panels baked into an env map.
  const pmrem = new T.PMREMGenerator(renderer);
  const env = new T.Scene();
  env.add(new T.Mesh(new T.SphereGeometry(20, 16, 12), new T.MeshBasicMaterial({ color: 0x2a313c, side: T.BackSide })));
  const panel = (w: number, h: number, x: number, y: number, z: number, c = 0xffffff) => {
    const p = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
    p.position.set(x, y, z); p.lookAt(0, 0, 0); env.add(p);
  };
  panel(14, 6, 0, 12, 6); panel(6, 10, -12, 2, 8); panel(6, 10, 13, -1, 4, 0xcfe9e5); panel(18, 4, 0, -12, -6, 0x8a94a6);
  scene.environment = pmrem.fromScene(env, 0.03).texture;

  scene.add(new T.HemisphereLight(0xffffff, 0x445064, 0.35));
  const key = new T.DirectionalLight(0xffffff, 1.6); key.position.set(-6, 9, 10); scene.add(key);
  const rim = new T.DirectionalLight(0xffffff, 0.9); rim.position.set(8, -4, -6); scene.add(rim);

  const accent = () => new T.Color(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0b7d72");
  const steel = new T.MeshStandardMaterial({ color: 0xc3cad5, metalness: 0.92, roughness: 0.3, envMapIntensity: 1.1 });
  const brass = new T.MeshStandardMaterial({ color: accent(), metalness: 0.75, roughness: 0.32, envMapIntensity: 1.0 });
  const shaftMat = new T.MeshStandardMaterial({ color: 0x5d6575, metalness: 0.95, roughness: 0.38 });

  const m = 0.5, zA = 18, zB = 11, depth = 1.15;
  const extrude = { depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 };
  const ga = gearShape(T, zA, m, 0.75, 6);
  const gb = gearShape(T, zB, m, 0.5, 0);
  const geoA = new T.ExtrudeGeometry(ga.shape, extrude); geoA.translate(0, 0, -depth / 2);
  const geoB = new T.ExtrudeGeometry(gb.shape, extrude); geoB.translate(0, 0, -depth / 2);

  const gearA = new T.Mesh(geoA, steel);
  const gearB = new T.Mesh(geoB, brass);
  gearA.userData.part = "drive";
  gearB.userData.part = "pinion";

  // Hubs and shafts
  const hub = (outer: number, inner: number, len: number, mat: THREE_NS.Material) => {
    const g = new T.ExtrudeGeometry(annulus(T, outer, inner), { depth: len, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: 24 });
    g.translate(0, 0, -len / 2);
    return new T.Mesh(g, mat);
  };
  const shaft = (r: number, len: number) => { const s = new T.Mesh(new T.CylinderGeometry(r, r, len, 32), shaftMat); s.rotation.x = Math.PI / 2; return s; };
  gearA.add(hub(1.45, 0.75, depth * 1.9, steel));
  gearB.add(hub(0.95, 0.5, depth * 1.7, brass));

  const theta = Math.PI / 6; // direction from drive to pinion
  const dist = ga.rp + gb.rp;
  const posA = new T.Vector3(0, 0, 0);
  const posB = new T.Vector3(Math.cos(theta) * dist, Math.sin(theta) * dist, 0);
  const assembly = new T.Group();
  const pivotA = new T.Group(); pivotA.position.copy(posA); pivotA.add(gearA, shaft(0.74, depth * 3.4));
  const pivotB = new T.Group(); pivotB.position.copy(posB); pivotB.add(gearB, shaft(0.49, depth * 3));
  assembly.add(pivotA, pivotB);
  const center = posA.clone().add(posB).multiplyScalar(0.5);
  assembly.position.set(-center.x, -center.y, 0);
  const rig = new T.Group();
  rig.add(assembly);
  scene.add(rig);
  const baseTilt = { x: -0.42, y: 0.38 };
  rig.rotation.set(baseTilt.x, baseTilt.y, 0);

  // Pinion phase so a drive tooth sits in a pinion gap on the line of centres.
  const ratio = zA / zB;
  const phaseB = (phiA: number) => theta + Math.PI - Math.PI / zB - ratio * (phiA - theta);

  // ---- state ----
  let phiA = theta, omega = 0, dragging = false, lastX = 0, lastY = 0, lastT = 0, moved = 0;
  const idle = reduced() ? 0 : 0.22;
  const tilt = { x: baseTilt.x, y: baseTilt.y, tx: baseTilt.x, ty: baseTilt.y };
  let hover: THREE_NS.Mesh | null = null;
  let glow = { drive: 0, pinion: 0 };
  let intro = reduced() ? 1 : 0;
  const hint = host.querySelector<HTMLElement>(".g-hint");
  const label = host.querySelector<HTMLElement>(".g-label");
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();

  function fit() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole assembly in view on narrow or short boxes
    const extent = dist / 2 + ga.rp + 1.6;
    const fovV = (camera.fov * Math.PI) / 180;
    const needH = extent / Math.tan(fovV / 2);
    const needW = extent / (Math.tan(fovV / 2) * camera.aspect);
    camera.position.z = Math.max(needH, needW) * 0.7;
    camera.updateProjectionMatrix();
    wake();
  }

  function pick(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([gearA, gearB], true)[0];
    let o: THREE_NS.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.part) o = o.parent;
    return (o as THREE_NS.Mesh) ?? null;
  }

  function showLabel(mesh: THREE_NS.Mesh | null, clientX = 0, clientY = 0) {
    hover = mesh;
    canvas.style.cursor = dragging ? "grabbing" : mesh ? "grab" : "default";
    if (!label) return;
    if (!mesh) { label.hidden = true; return; }
    const t = getT();
    const part = mesh.userData.part as string;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    label.innerHTML = `<b>${esc(t(`gear.${part}.name` as Key))}</b><span>${esc(t(`gear.${part}.spec` as Key))}</span><span>${esc(t("gear.ratio", { r: ratio.toFixed(2) }))}</span>`;
    label.hidden = false;
    const r = host.getBoundingClientRect();
    const x = Math.min(Math.max(8, clientX - r.left + 14), r.width - label.offsetWidth - 8);
    const y = Math.min(Math.max(8, clientY - r.top - label.offsetHeight - 10), r.height - label.offsetHeight - 8);
    label.style.transform = `translate(${x}px, ${y}px)`;
  }

  const firstUse = () => { hint?.classList.add("gone"); };

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    firstUse(); wake();
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1, py = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!reduced()) { tilt.tx = baseTilt.x + py * 0.16; tilt.ty = baseTilt.y + px * 0.24; }
    if (dragging) {
      const now = performance.now();
      const dt = Math.max(1, now - lastT) / 1000;
      const d = ((e.clientX - lastX) - (e.clientY - lastY) * 0.6) * 0.012;
      phiA -= d;
      omega = -d / dt;
      moved += Math.abs(d);
      lastX = e.clientX; lastY = e.clientY; lastT = now;
      label && (label.hidden = true);
    } else if (e.pointerType === "mouse") {
      showLabel(pick(e.clientX, e.clientY), e.clientX, e.clientY);
    }
    wake();
  });
  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (performance.now() - lastT > 80) omega *= 0.2; // held still before letting go
    omega = Math.max(-9, Math.min(9, omega));
    if (moved < 0.02) showLabel(pick(e.clientX, e.clientY), e.clientX, e.clientY); // tap shows the label (touch)
    else canvas.style.cursor = hover ? "grab" : "default";
    wake();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => { tilt.tx = baseTilt.x; tilt.ty = baseTilt.y; if (!dragging) showLabel(null); wake(); });
  canvas.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); omega += e.key === "ArrowRight" ? -1.6 : 1.6; firstUse(); wake(); }
  });

  // Theme changes recolour the pinion.
  const recolor = () => { brass.color.copy(accent()); wake(); };
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", recolor);

  // ---- loop: runs only while visible and something moves ----
  let visible = true, running = false, prev = 0;
  function wake() { if (!running && visible && !document.hidden) { running = true; prev = performance.now(); requestAnimationFrame(frame); } }
  function frame(now: number) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (!dragging) {
      omega += (idle - omega) * (1 - Math.exp(-dt * 1.4)); // momentum decays back to the idle speed
      phiA -= omega * dt;
    }
    intro = Math.min(1, intro + dt / 1.3);
    const e = 1 - Math.pow(1 - intro, 3);
    pivotA.rotation.z = phiA;
    pivotB.rotation.z = phaseB(phiA);
    pivotB.position.set(posB.x + Math.cos(theta) * (1 - e) * 4, posB.y + Math.sin(theta) * (1 - e) * 4, 0); // pinion slides into mesh
    rig.scale.setScalar(0.88 + 0.12 * e);
    tilt.x += (tilt.tx - tilt.x) * (1 - Math.exp(-dt * 5));
    tilt.y += (tilt.ty - tilt.y) * (1 - Math.exp(-dt * 5));
    rig.rotation.set(tilt.x, tilt.y, 0);
    for (const [k, mesh, mat] of [["drive", gearA, steel], ["pinion", gearB, brass]] as const) {
      const target = hover === mesh ? 1 : 0;
      glow[k] += (target - glow[k]) * (1 - Math.exp(-dt * 10));
      mat.emissive.copy(accent()).multiplyScalar(glow[k] * 0.14);
    }
    renderer.render(scene, camera);
    const settled = !dragging && Math.abs(omega - idle) < 0.002 && idle === 0 && intro >= 1
      && Math.abs(tilt.tx - tilt.x) < 0.0005 && Math.abs(tilt.ty - tilt.y) < 0.0005 && glow.drive < 0.01 && glow.pinion < 0.01;
    if (!visible || document.hidden || settled) { running = false; return; }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(fit).observe(host);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { visible = es[0]!.isIntersecting; if (visible) wake(); }).observe(host);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  fit();
  host.classList.add("ready");
  wake();
}
