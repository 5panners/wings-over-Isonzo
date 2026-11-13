import * as THREE from 'three';
import { makeFlagMesh, registerArm } from './flags.js';
import { lerp, rnd, H, riverX, riverLevel, riverHalf, sst, AIRFIELDS, TOWNS, SECTORS, TARGETS } from './world.js';

export const TEAM = { it: '#2f7fe0', ah: '#d8362c', n: '#f2ead0', obj: '#ffb21e' };
const mats = {};
const mat = (c, o) => mats[c + (o ? JSON.stringify(o) : '')] ??= new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...(o || {}) });
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cy = (r1, r2, h, s = 8) => new THREE.CylinderGeometry(r1, r2, h, s);
function mk(geo, c, x = 0, y = 0, z = 0, o) { const m = new THREE.Mesh(geo, mat(c, o)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
const UP = new THREE.Vector3(0, 1, 0);
function rod(a, b, r, c) { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A); const m = mk(Cy(r, r, d.length(), 4), c); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m; }
function prism(w, h, d) { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2); return g; }
function arch(w, h, d) { const g = new THREE.CylinderGeometry(w / 2, w / 2, d, 8, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); g.scale(1, h / (w / 2), 1); return g; }
const G = (...ch) => { const g = new THREE.Group(); ch.forEach(c => g.add(c)); return g; };
const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };

// ============ aircraft (nose +z) ============
function roundel(side, r) {
  if (side === 'it') return G(mk(Cy(r, r, 0.03, 10), '#c9302a'), mk(Cy(r * 0.66, r * 0.66, 0.05, 10), '#f4f1e6'), mk(Cy(r * 0.33, r * 0.33, 0.07, 10), '#2f8a45'));
  return G(mk(B(r * 2, 0.03, r * 2), '#f4f1e6'), mk(B(r * 1.7, 0.05, r * 0.5), '#1a1a1a'), mk(B(r * 0.5, 0.05, r * 1.7), '#1a1a1a'));
}
function rudder(side, h, d) {
  if (side === 'it') return G(mk(B(0.09, h, d / 3), '#2f8a45', 0, 0, d / 3), mk(B(0.09, h, d / 3), '#f4f1e6'), mk(B(0.09, h, d / 3), '#c9302a', 0, 0, -d / 3));
  return G(mk(B(0.08, h, d), '#f4f1e6'), mk(B(0.1, h * 0.22, d * 0.75), '#1a1a1a'), mk(B(0.1, h * 0.75, d * 0.24), '#1a1a1a'));
}
export function biplane(o) {
  const g = new THREE.Group(), side = o.side;
  const fus = mk(Cy(0.55, 0.16, 4.6, 6), o.fus); fus.rotation.x = Math.PI / 2; g.add(fus);
  const cowl = mk(Cy(0.5, 0.58, 0.7, 8), o.cowl, 0, 0, 2.55); cowl.rotation.x = Math.PI / 2; g.add(cowl);
  g.add(mk(Cy(0.16, 0.05, 0.4, 6), o.cowl, 0, 0, 3.05).rotateX(Math.PI / 2));
  if (o.flying) { const d = mk(Cy(1.45, 1.45, 0.03, 12), '#e8dcc0', 0, 0, 3.1, { transparent: true, opacity: 0.35 }); d.rotation.x = Math.PI / 2; d.castShadow = false; g.add(d); }
  else g.add(mk(B(0.22, 2.8, 0.1), '#6b4424', 0, 0, 3.1).rotateZ(0.5));
  const sp = o.span || 6.4;
  g.add(mk(B(sp, 0.12, 1.35), o.wing, 0, 1.05, 1.15), mk(B(sp * (o.sesqui ? 0.82 : 0.94), 0.11, o.sesqui ? 0.8 : 1.2), o.wing2 || o.wing, 0, -0.42, 0.95));
  for (const sx of [-1, 1]) { g.add(rod([sx * sp * 0.33, -0.4, 1.35], [sx * sp * 0.33, 1.02, 1.6], 0.045, '#5a3d22'), rod([sx * sp * 0.33, -0.4, 0.55], [sx * sp * 0.33, 1.02, 0.7], 0.045, '#5a3d22'), rod([sx * 0.4, 0.4, 1.5], [sx * 0.55, 1.02, 1.5], 0.045, '#5a3d22')); }
  g.add(mk(B(2.3, 0.08, 0.85), o.wing, 0, 0.1, -2.05)); g.add(at(rudder(side, 1.05, 0.8), 0, 0.55, -2.25));
  for (const sx of [-1, 1]) { const w = mk(Cy(0.36, 0.36, 0.14, 8), '#2b2b2b', sx * 0.75, -1.15, 1.6); w.rotation.z = Math.PI / 2; g.add(w, rod([sx * 0.35, -0.4, 1.9], [sx * 0.7, -1.15, 1.6], 0.05, '#5a3d22'), rod([sx * 0.35, -0.4, 1.2], [sx * 0.7, -1.15, 1.6], 0.05, '#5a3d22')); }
  g.add(rod([-0.75, -1.15, 1.6], [0.75, -1.15, 1.6], 0.05, '#333'), rod([0, -0.2, -2.0], [0, -0.55, -2.3], 0.05, '#5a3d22'));
  for (const sx of [-1, 1]) g.add(at(roundel(side, 0.5), sx * sp * 0.38, 1.12, 1.15));
  g.add(mk(B(0.5, 0.3, 0.7), '#2a2420', 0, 0.45, 0.2)); // cockpit
  if (o.flying) for (const x of [-0.2, 0.2]) {                                           // twin synchronised machine guns on top of the nose
    g.add(mk(Cy(0.04, 0.04, 1.5, 6), '#1c1c1c', x, 0.64, 2.15).rotateX(Math.PI / 2), mk(Cy(0.075, 0.075, 0.7, 6), '#5d605c', x, 0.64, 1.65).rotateX(Math.PI / 2), mk(B(0.14, 0.12, 0.5), '#3a3d3a', x, 0.58, 1.3));
  }
  if (o.band) g.add(mk(Cy(0.36, 0.3, 0.4, 6), o.band, 0, 0, -0.6).rotateX(Math.PI / 2));
  return g;
}
export const SPAD = f => biplane({ side: 'it', fus: '#d9cf9a', wing: '#dcd3a2', cowl: '#b9bcc0', flying: f, band: '#c9302a' });
export const NIEUPORT = f => biplane({ side: 'it', fus: '#c9cdd0', wing: '#d0d4d6', cowl: '#aeb3b8', flying: f, sesqui: true, span: 6 });
export const HANRIOT = f => biplane({ side: 'it', fus: '#c8cbb0', wing: '#5f7a4c', wing2: '#d6cfa6', cowl: '#b9bcc0', flying: f, span: 6.1 });
export const ALBATROS = f => biplane({ side: 'ah', fus: '#b98144', wing: '#6c7a4a', wing2: '#d9d0a8', cowl: '#8a8d90', flying: f, sesqui: true, span: 6.6 });
export const PHONIX = f => biplane({ side: 'ah', fus: '#8b6a3e', wing: '#7b6846', cowl: '#77797b', flying: f, span: 6.3, band: '#f4f1e6' });
export function CAPRONI(f) {
  const g = new THREE.Group(), w = '#d8d0a4';
  g.add(mk(B(15, 0.14, 2.1), w, 0, 1.5, 0.6), mk(B(15, 0.14, 2.1), w, 0, -0.7, 0.6));
  g.add(mk(B(1.1, 1.1, 4.2), '#cfc59a', 0, -0.1, 1.2), mk(Cy(0.5, 0.5, 0.8, 8), '#9a9da0', 0, -0.1, -1.2).rotateX(Math.PI / 2));
  for (const sx of [-1, 1]) {
    g.add(mk(B(0.55, 0.6, 9.5), '#cfc59a', sx * 2.1, -0.1, -2.6), mk(Cy(0.42, 0.5, 0.9, 8), '#9a9da0', sx * 2.1, -0.1, 2.5).rotateX(Math.PI / 2));
    if (f) { const d = mk(Cy(1.3, 1.3, 0.03, 12), '#e8dcc0', sx * 2.1, -0.1, 3.0, { transparent: true, opacity: 0.35 }); d.rotation.x = Math.PI / 2; g.add(d); } else g.add(mk(B(0.2, 2.6, 0.1), '#6b4424', sx * 2.1, -0.1, 3.0));
    for (const k of [1.2, 3.4, 5.6]) g.add(rod([sx * k * 1.2, -0.7, 0.2], [sx * k * 1.2, 1.5, 0.2], 0.05, '#5a3d22'), rod([sx * k * 1.2, -0.7, 1.2], [sx * k * 1.2, 1.5, 1.2], 0.05, '#5a3d22'));
    for (const k of [0.9, 1.5]) { const wh = mk(Cy(0.42, 0.42, 0.16, 8), '#2b2b2b', sx * (k + 0.9), -1.7, 1.0); wh.rotation.z = Math.PI / 2; g.add(wh); }
    g.add(rod([sx * 2.1, -0.4, 1.0], [sx * 2.1, -1.7, 1.0], 0.07, '#5a3d22'));
    g.add(at(roundel('it', 0.8), sx * 6, 1.6, 0.6));
  }
  g.add(mk(B(5.6, 0.1, 1.3), w, 0, 0.1, -7));
  for (const x of [-1.6, 0, 1.6]) g.add(at(rudder('it', 1.3, 0.9), x, 0.75, -7.1));
  return g;
}
function parked(p, x, z, ry, lift = 1.5) { p.rotation.order = 'YXZ'; p.rotation.set(-0.2, ry, 0); p.position.set(x, H(x, z) + lift, z); return p; }

// ============ balloons ============
function lobe(sx, sy, sz, c) { const m = mk(new THREE.SphereGeometry(1, 7, 5), c); m.scale.set(sx, sy, sz); return m; }
function basket(g, y, pts, c = '#8a6a3a') { g.add(mk(B(1.3, 1.1, 1.3), c, 0, y, 0)); for (const p of pts) g.add(rod(p, [Math.sign(p[0]) * 0.6, y + 0.5, Math.sign(p[2]) * 0.6], 0.035, '#4a4034')); }
export function balloon(type) {
  const g = new THREE.Group(), env = new THREE.Group(); g.add(env);
  if (type === 'drachen') { // Parseval-Sigsfeld Drachen kite balloon
    const R = 2.5, L = 16, c = '#cfa64a', pts = [[0, -L / 2], [R * 0.72, -L / 2 + R * 0.3], [R, -L / 2 + R], [R, L / 2 - R], [R * 0.72, L / 2 - R * 0.3], [0, L / 2]].map(p => new THREE.Vector2(...p));
    const body = mk(new THREE.LatheGeometry(pts, 9), c); body.rotation.x = Math.PI / 2; env.add(body);
    env.add(mk(Cy(R * 1.02, R * 1.02, 1.2, 9), '#9c7a30', 0, 0, 2).rotateX(Math.PI / 2));
    const bag = mk(new THREE.TorusGeometry(3.4, 1.15, 6, 8, Math.PI * 0.8), '#b88f3a', 0, 0.2, -3.6); bag.rotation.set(0, Math.PI / 2, 0); bag.rotation.z = Math.PI * 1.02; env.add(bag);
    for (const sx of [-1, 1]) env.add(at(mk(B(0.12, 2.2, 3.4), '#b88f3a'), sx * R * 1.05, 0, -4.5));
    for (let i = 0; i < 4; i++) { env.add(mk(new THREE.ConeGeometry(0.55, 0.9, 6, 1, true), i % 2 ? '#f4f1e6' : '#c9302a', 0, -1.2 - i * 0.5, -10 - i * 2.3, { side: THREE.DoubleSide }).rotateX(-Math.PI / 2)); }
    env.add(rod([0, 0, -8], [0, -3, -17.5], 0.03, '#4a4034'));
    env.rotation.x = -0.42;
    basket(g, -9.5, [[1.5, -1.5, 5], [-1.5, -1.5, 5], [1.5, -3, -2], [-1.5, -3, -2]]);
  } else if (type === 'caquot') { // Caquot Type M
    const c = '#8d9462', pts = [[0, -7.5], [1.3, -6], [2.5, -3.4], [3.3, -0.2], [3.5, 2.6], [3.0, 5.0], [1.7, 6.6], [0, 7.3]].map(p => new THREE.Vector2(...p));
    const body = mk(new THREE.LatheGeometry(pts, 10), c); body.rotation.x = Math.PI / 2; env.add(body);
    for (const a of [Math.PI, Math.PI / 3, -Math.PI / 3]) { const f = lobe(0.95, 2.3, 2.7, '#7b8356'); const h = G(f); f.position.set(0, 2.5, -5.0); h.rotation.z = a; env.add(h); }
    env.rotation.x = -0.2; basket(g, -9.5, [[2, -2.6, 3], [-2, -2.6, 3], [2, -2.4, -2.5], [-2, -2.4, -2.5]]);
  } else { // Avorio-Prassone
    const c = '#c9ccc2'; const body = mk(new THREE.SphereGeometry(4.3, 10, 7), c); body.scale.set(1, 0.97, 1.2); env.add(body);
    env.add(mk(Cy(4.36, 4.36, 0.5, 10), '#9fa39a', 0, -0.4, 0)); // rigging band
    env.add(at(lobe(1.05, 2.4, 2.6, '#b4b8ad'), 0, -3.4, -4.4));
    for (const sx of [-1, 1]) { const f = lobe(2.5, 0.95, 2.5, '#b4b8ad'); f.position.set(sx * 3.5, 0.1, -4.3); f.rotation.y = sx * 0.35; env.add(f); }
    env.add(mk(new THREE.ConeGeometry(1.2, 1.6, 8), '#b4b8ad', 0, -4.6, 0.6).rotateX(Math.PI));
    env.rotation.x = -0.1; basket(g, -10, [[3, -2.6, 3], [-3, -2.6, 3], [3, -2.6, -3], [-3, -2.6, -3]]);
  }
  return g;
}
function winch(side) {
  const c = side === 'ah' ? '#5c6656' : '#6c7758', g = new THREE.Group();
  g.add(mk(B(2.2, 1.2, 5), c, 0, 1.2, 0), mk(B(2.2, 1.6, 1.6), c, 0, 2.2, 1.6), mk(Cy(0.9, 0.9, 1.6, 8), '#3a3a38', 0, 2.3, -1).rotateZ(Math.PI / 2));
  for (const [x, z] of [[-1.1, 1.6], [1.1, 1.6], [-1.1, -1.6], [1.1, -1.6]]) g.add(mk(Cy(0.6, 0.6, 0.3, 8), '#222', x, 0.6, z).rotateZ(Math.PI / 2));
  return g;
}
function ring(r, h, color, y0 = 0, wall = 0.12) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: wall, side: THREE.DoubleSide, depthWrite: false, fog: false })); w.position.y = y0 + h / 2; g.add(w);
  for (const y of [y0, y0 + h]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.3, r * 0.007), 4, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false })); t.rotation.x = Math.PI / 2; t.position.y = y; g.add(t); }
  return g;
}

// ============ buildings ============
const HOUSE = ['#efe3c6', '#e8d5ae', '#f2e9d8', '#e6c9a0', '#dcc7b0', '#f0dcc0'], ROOF = ['#c2603a', '#b5532f', '#cc6e44', '#a94a2c'];
// ---- windows: one instanced mesh for the whole map. By day they are dark glass; at night some glow. ----
// Each house gets a few lit rooms: they come on at their own point in the dusk, and about half go dark again late in the evening.
const WIN = [], winRand = (() => { let s = 20171024; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();   // its own random stream, so adding windows moves nothing else
function addWindows(g, w, h, d) {
  const occupied = winRand() < 0.78, on = 0.12 + winRand() * 0.55, off = winRand() < 0.5 ? 22.5 + winRand() * 5 : 99;
  const walls = [[w, d / 2, 0, 0], [w, -d / 2, Math.PI, 0], [d, w / 2, Math.PI / 2, 1], [d, -w / 2, -Math.PI / 2, 1]];       // [width, offset, yaw, side wall?]
  for (const [width, off2, yaw, side] of walls) {
    const n = Math.max(1, Math.floor(width / 1.9));
    for (let row = 0; row < (h >= 4 ? 2 : 1); row++) for (let i = 0; i < n; i++) {
      const u = -width / 2 + (i + 0.5) * width / n, y = row === 0 ? 1.25 : 3.15, out = off2 + Math.sign(off2) * 0.02;
      const m = new THREE.Matrix4().compose(side ? new THREE.Vector3(out, y, u) : new THREE.Vector3(u, y, out), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(0.55, 0.75, 1));
      WIN.push({ g, m, lit: occupied && winRand() < 0.8, on, off, warm: Math.floor(winRand() * 3) });
    }
  }
}
let winMesh = null, winKey = -1;
const GLASS_DAY = new THREE.Color('#56677a'), GLASS_NIGHT = new THREE.Color('#0d121a'), WARM = ['#ffc766', '#ffb347', '#ffe0a0'].map(c => new THREE.Color(c)), CC = new THREE.Color();
function buildWindows(scene) {
  scene.updateMatrixWorld(true);
  winMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), WIN.length);
  const M = new THREE.Matrix4(); WIN.forEach((win, i) => { winMesh.setMatrixAt(i, M.multiplyMatrices(win.g.matrixWorld, win.m)); winMesh.setColorAt(i, GLASS_DAY); });
  winMesh.frustumCulled = false; scene.add(winMesh);
}
// night: 0 (day) .. 1 (dark), from the day-night cycle; tod: hour of the day
export function updateWindows(night, tod) {
  if (!winMesh) return;
  const key = Math.round(night * 40) * 1000 + Math.floor(tod * 6); if (key === winKey) return; winKey = key;
  const t = tod < 12 ? tod + 24 : tod;                                                  // hours after midnight count on from 24
  CC.copy(GLASS_DAY).lerp(GLASS_NIGHT, night); const gr = CC.r, gg = CC.g, gb = CC.b;
  WIN.forEach((win, i) => {
    const k = win.lit && !(t >= win.off && t < 29.5) ? Math.min(1, Math.max(0, (night - win.on) / 0.08)) : 0;
    const warm = WARM[win.warm];
    winMesh.setColorAt(i, k > 0 ? CC.setRGB(gr + (warm.r - gr) * k, gg + (warm.g - gg) * k, gb + (warm.b - gb) * k) : CC.setRGB(gr, gg, gb));
  });
  winMesh.instanceColor.needsUpdate = true;
}
function house(w, h, d, wc, rc) { const g = G(mk(B(w, h, d), wc, 0, h / 2, 0)); const r = mk(prism(w * 1.1, w * 0.42, d * 1.08), rc, 0, h, 0); g.add(r); addWindows(g, w, h, d); return g; }
function village(scene, t) {
  for (let i = 0; i < t.k; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * t.r, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r * 0.8;
    if (Math.abs(x - riverX(z)) < riverHalf(z) + 9) continue;
    const hs = house(3 + rnd() * 2.5, 2.6 + rnd() * 2.2, 4 + rnd() * 3.5, HOUSE[Math.floor(rnd() * 6)], ROOF[Math.floor(rnd() * 4)]); at(hs, x, H(x, z) - 0.3, z, Math.floor(rnd() * 4) * 0.4 + (rnd() > 0.5 ? 1.57 : 0)); scene.add(hs);
  }
  const y = H(t.x, t.z) - 0.3; // church + campanile
  scene.add(at(G(house(5, 5.5, 10, '#f2ead8', '#b5532f'), mk(B(2.6, 14, 2.6), '#efe6d2', 4.4, 7, -3.5), mk(B(2.9, 1.6, 2.9), '#d9cdb4', 4.4, 12.4, -3.5), mk(new THREE.ConeGeometry(2.1, 4, 4), '#a94a2c', 4.4, 16, -3.5).rotateY(Math.PI / 4)), t.x, y, t.z, rnd() * 3));
  for (let i = 0; i < 5; i++) { const a = rnd() * 6.28, x = t.x + Math.cos(a) * (6 + rnd() * t.r), z = t.z + Math.sin(a) * (6 + rnd() * t.r); scene.add(mk(new THREE.ConeGeometry(0.8, 7, 5), '#28502f', x, H(x, z) + 3.3, z)); }
}
function hangar(side, w = 11, d = 13) {
  if (side === 'it') return G(mk(B(w, 3.6, d), '#d6c9a0', 0, 1.8, 0), mk(arch(w * 1.04, 3, d * 1.03), '#bfae7f', 0, 3.6, 0), mk(B(w * 0.82, 3.3, 0.3), '#2a2620', 0, 1.65, d / 2), mk(B(w * 0.3, 3.3, 0.35), '#8d7a52', -w * 0.5, 1.65, d / 2 + 0.2));
  return G(mk(B(w, 4, d), '#7c5d3e', 0, 2, 0), mk(prism(w * 1.08, 3, d * 1.05), '#4b5a48', 0, 4, 0), mk(B(w * 0.8, 3.5, 0.3), '#221d18', 0, 1.75, d / 2), mk(B(w * 0.28, 3.5, 0.35), '#6a4e33', w * 0.48, 1.75, d / 2 + 0.2));
}
function tent(c = '#e4dcc0', r = 1.8) { return mk(new THREE.ConeGeometry(r, r * 1.3, 6), c, 0, r * 0.65, 0); }
function truck(c) { const g = G(mk(B(1.9, 1.5, 3.2), '#a79c78', 0, 1.7, -0.9), mk(B(1.9, 0.5, 5), c, 0, 0.9, 0), mk(B(1.8, 1.3, 1.3), c, 0, 1.6, 1.6)); for (const [x, z] of [[-1, 1.6], [1, 1.6], [-1, -1.5], [1, -1.5]]) g.add(mk(Cy(0.5, 0.5, 0.3, 8), '#222', x, 0.5, z).rotateZ(Math.PI / 2)); return g; }
function flag(side) {                                      // a pole with its nation's waving flag (see flags.js)
  const g = G(mk(Cy(0.09, 0.13, 15, 5), '#e9e4d6', 0, 7.5, 0), mk(new THREE.SphereGeometry(0.3, 6, 4), '#d9b13b', 0, 15.1, 0));
  const arm = new THREE.Group(); arm.position.set(0.1, 14.9, 0); arm.add(makeFlagMesh(side)); g.add(arm); registerArm(arm, 'flag');
  return g;
}
function windsock() {                                         // the sock streams downwind, drooping when the wind is light
  const g = G(mk(Cy(0.07, 0.07, 7, 5), '#e9e4d6', 0, 3.5, 0)), arm = new THREE.Group(); arm.position.set(0, 6.8, 0);
  const cone = mk(new THREE.ConeGeometry(0.55, 2.8, 6), '#e8632a', 1.4, 0, 0); cone.rotation.z = -Math.PI / 2;        // wide mouth upwind, tip downwind
  arm.add(cone, mk(new THREE.TorusGeometry(0.5, 0.06, 4, 8), '#f4f1e6', 0.15, 0, 0).rotateY(Math.PI / 2)); g.add(arm); registerArm(arm, 'sock');
  return g;
}
function sandbags(r) { const m = mk(new THREE.TorusGeometry(r, 0.55, 4, 9), '#c2b189'); m.rotation.x = Math.PI / 2; m.position.y = 0.35; return m; }
function gun(side, mortar) {
  const c = side === 'ah' ? '#59645a' : '#6f7a5c', g = G(sandbags(mortar ? 3.6 : 3.2), mk(B(2.2, 0.8, 3), c, 0, 0.6, 0));
  const b = mk(Cy(mortar ? 0.55 : 0.28, mortar ? 0.7 : 0.4, mortar ? 3.2 : 5, 7), '#3f4640', 0, 1.6, 0.8); b.rotation.x = mortar ? 0.6 : 0.95; b.position.y += mortar ? 0.9 : 0.8; g.add(b);
  for (const sx of [-1, 1]) g.add(mk(Cy(0.9, 0.9, 0.25, 8), '#39362f', sx * 1.25, 0.9, 0).rotateZ(Math.PI / 2));
  g.add(mk(B(1, 0.7, 1.4), '#8a6a3a', 2.2, 0.4, -1.6), mk(B(1, 0.7, 1.4), '#8a6a3a', 2.4, 1.0, -1.5));
  return g;
}
function flak(side) { const c = side === 'ah' ? '#59645a' : '#6f7a5c'; const b = mk(Cy(0.14, 0.2, 3.4, 6), '#3f4640', 0, 2.4, 0.6); b.rotation.x = 0.5; return G(sandbags(2.3), mk(Cy(0.7, 0.9, 1.2, 6), c, 0, 0.7, 0), b); }
function train(n = 4) {
  const g = G(mk(B(1.7, 1.3, 4.2), '#26272a', 0, 1.3, 0), mk(Cy(0.75, 0.75, 3, 8), '#2f3033', 0, 2.1, 0.5).rotateX(Math.PI / 2), mk(B(1.8, 1.6, 1.4), '#26272a', 0, 2.5, -1.5), mk(Cy(0.22, 0.3, 1.1, 6), '#1c1c1e', 0, 3.3, 1.5), mk(B(1.5, 0.3, 0.5), '#b0362b', 0, 0.8, 2.2));
  for (let i = 0; i < n; i++) g.add(mk(B(1.7, 1.7, 4), i % 2 ? '#7b5a3a' : '#6c6f5c', 0, 1.6, -5 - i * 4.6));
  return g;
}

export function buildObjects(scene) {
  const rings = new THREE.Group(), flights = new THREE.Group(), lineup = new THREE.Group(); scene.add(rings, flights, lineup);
  const put = (o, x, z, ry = 0, dy = 0) => { at(o, x, H(x, z) + dy, z, ry); scene.add(o); return o; };
  TOWNS.forEach(t => village(scene, t));

  // ---- trenches along both banks ----
  {
    const tg = B(1, 0.7, 1), tm = mat('#54402c'), pm = mat('#b9a67c');
    for (const s of [-1, 1]) {
      let prev = null;
      for (let z = -130, i = 0; z < 440; z += 6.5, i++) {
        const w = lerp(20, 44, sst(-480, 320, z)); const x = riverX(z) + s * (w + 26 + 9 * Math.sin(z / 37)) + (i % 2 ? 3.2 : -3.2);
        const p = new THREE.Vector3(x, H(x, z) + 0.25, z);
        if (prev) { for (const [mm, wd, off, hh] of [[tm, 1.9, 0, 0.5], [pm, 0.9, s * -1.5, 0.9]]) { const m = new THREE.Mesh(tg, mm); m.position.copy(prev).lerp(p, 0.5); m.position.x += off; m.scale.set(wd, hh, prev.distanceTo(p) + 0.6); m.lookAt(p.x + off, p.y, p.z); m.receiveShadow = true; scene.add(m); } }
        prev = p;
      }
    }
  }

  // ---- airfields ----
  for (const key of ['it', 'ah']) {
    const f = AIRFIELDS[key], g = new THREE.Group(), y = H(f.x, f.z); g.position.set(f.x, y, f.z); g.rotation.y = -f.rot; scene.add(g);
    const ad = (o, x, z, ry = 0, dy = 0) => { at(o, x, dy, z, ry); g.add(o); return o; };
    const strip = mk(B(230, 0.1, 30), key === 'it' ? '#b9c66c' : '#aebd68', 0, 0.12, 14); strip.castShadow = false; g.add(strip);
    const worn = mk(B(190, 0.1, 6), '#c9b98a', 0, 0.18, 14); worn.castShadow = false; g.add(worn);
    const apron = mk(B(150, 0.1, 16), '#cdbf92', 0, 0.15, -14); apron.castShadow = false; g.add(apron);
    for (let i = 0; i < 6; i++) ad(hangar(key), -62 + i * 22, -32, 0);
    const types = key === 'it' ? [SPAD, SPAD, NIEUPORT, HANRIOT, SPAD, NIEUPORT, HANRIOT, SPAD] : [ALBATROS, ALBATROS, PHONIX, ALBATROS, PHONIX, ALBATROS, ALBATROS, PHONIX];
    types.forEach((T, i) => { const p = T(false); p.rotation.order = 'YXZ'; p.rotation.set(-0.2, 0.25, 0); p.position.set(-66 + i * 11.5, 1.38, -12); g.add(p); });
    if (key === 'it') for (const x of [44, 66]) { const c = CAPRONI(false); c.rotation.order = 'YXZ'; c.rotation.set(-0.1, 0.1, 0); c.position.set(x, 2.25, -11); g.add(c); }
    else for (const x of [40, 54, 68]) { const p = ALBATROS(false); p.rotation.order = 'YXZ'; p.rotation.set(-0.2, -0.3, 0); p.position.set(x, 1.38, -11); g.add(p); }
    ad(flag(key), -84, -24); ad(windsock(), 96, -6); ad(windsock(), -108, 34);
    for (let i = 0; i < 12; i++) ad(tent(key === 'it' ? '#e8e0c4' : '#d8d2b6'), -100 + (i % 6) * 5.5, -44 - Math.floor(i / 6) * 5.5);
    for (let i = 0; i < 3; i++) ad(truck(key === 'it' ? '#6c7758' : '#5c6656'), 82 + i * 5, -30, 0.2);
    for (let i = 0; i < 10; i++) ad(mk(Cy(0.5, 0.5, 1.2, 7), i % 3 ? '#8c3b2e' : '#55606a'), 76 + (i % 5) * 1.3, -22 - Math.floor(i / 5) * 1.3, 0, 0.6);
    ad(house(7, 4, 12, key === 'it' ? '#efe3c6' : '#e3d8bf', key === 'it' ? '#b5532f' : '#7a4a36'), 104, -40, 1.57); // HQ / mess
    for (const [x, z] of [[-118, -30], [118, -20], [0, 42], [-70, 44], [80, 44]]) ad(flak(key), x, z);
    // landing T
    ad(mk(B(8, 0.1, 1.4), '#f6f3e8'), 0, 32, 0, 0.2).castShadow = false; ad(mk(B(1.4, 0.1, 6), '#f6f3e8'), 0, 32, 0, 0.2).castShadow = false;
    { const r = at(ring(150, 46, TEAM[key], 0, 0.06), f.x, y, f.z); r.userData.id = key; rings.add(r); }
  }

  // ---- balloons / sectors ----
  const balloons = {};
  for (const s of SECTORS) {
    const gy = H(s.x, s.z), b = balloon(s.type); b.position.set(s.x, gy + s.alt, s.z); b.rotation.y = -1.1; b.scale.setScalar(2); scene.add(b); balloons[s.id] = b;
    const wx = s.x + 9, wz = s.z + 7, wy = H(wx, wz);
    scene.add(rod([s.x, gy + s.alt - 21, s.z], [wx, wy + 2.5, wz], 0.12, '#3d3a34'));
    put(winch(s.own === 'ah' ? 'ah' : 'it'), wx, wz, 0.6);
    for (const [dx, dz] of [[-16, 10], [14, -15], [22, 12]]) put(flak(s.own === 'ah' ? 'ah' : 'it'), s.x + dx, s.z + dz);
    put(tent(), s.x + 4, s.z + 13); put(tent(), s.x + 8, s.z + 16);
    { const r = at(ring(s.r, 84, TEAM[s.own], s.alt - 50, 0.07), s.x, gy, s.z); r.userData.id = s.id; rings.add(r); }
  }

  // ---- ground targets ----
  for (const t of TARGETS) {
    const y = H(t.x, t.z), lvl = riverLevel(t.z), rw = riverHalf(t.z);
    if (t.kind === 'pontoon') {
      const g = new THREE.Group(); const L = rw * 2 + 14;
      g.add(mk(B(L, 0.35, 3), '#a98a5c', 0, 1.05, 0));
      for (let x = -rw; x <= rw; x += 3.2) g.add(mk(B(1.4, 0.9, 5.2), '#5e6a58', x, 0.45, 0));
      at(g, t.x, lvl, t.z); scene.add(g);
      for (const sx of [-1, 1]) { put(truck('#6c7758'), t.x + sx * (rw + 16), t.z + 2, 1.57); put(tent(), t.x + sx * (rw + 14), t.z - 9); }
    } else if (t.kind === 'bridge') {
      const sh = new THREE.Shape(); const L = 48, D = 25; sh.moveTo(-L, 0); sh.lineTo(L, 0); sh.lineTo(L, -D * 0.4); sh.lineTo(L - 10, -D); sh.lineTo(18, -D); sh.lineTo(18, -20); sh.absarc(0, -20, 18, 0, Math.PI, false); sh.lineTo(-18, -D); sh.lineTo(-L + 10, -D); sh.lineTo(-L, -D * 0.4); sh.closePath();
      const hole = (cx, r, cy) => { const p = new THREE.Path(); p.moveTo(cx - r, cy - 30); p.lineTo(cx - r, cy); p.absarc(cx, cy, r, Math.PI, 0, true); p.lineTo(cx + r, cy - 30); p.closePath(); return p; };
      for (const cx of [-41, -34, -27, 27, 34, 41]) { const p = new THREE.Path(); p.absarc(cx, -6.5, 2.7, 0, Math.PI * 2, false); sh.holes.push(p); }
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 4.4, bevelEnabled: false, curveSegments: 7 }); geo.translate(0, 0, -2.2);
      const g = G(mk(geo, '#d8cfb8'), mk(B(L * 2, 0.5, 5), '#bfb59c', 0, 0.25, 0), mk(B(L * 2 + 60, 0.25, 1.6), '#4a433a', 0, 0.6, 0));
      const tr = train(5); tr.rotation.y = Math.PI / 2; tr.position.set(14, 0.3, 0); g.add(tr);
      at(g, t.x, lvl + 24.6, t.z, -0.28); scene.add(g);
    } else if (t.kind === 'battery') {
      const mortar = t.id === 'B2';
      for (let i = 0; i < 4; i++) { const x = t.x - 18 + i * 12, z = t.z + Math.abs(i - 1.5) * 4; put(gun(t.side, mortar), x, z, t.side === 'ah' ? -1.9 : 1.2).scale.setScalar(1.5); }
      put(tent('#cfc8a6', 2.4), t.x - 6, t.z - 12); put(tent('#cfc8a6', 2.4), t.x + 2, t.z - 13); put(truck(t.side === 'ah' ? '#5c6656' : '#6c7758'), t.x + 12, t.z - 12, 0.8);
      for (let i = 0; i < 6; i++) put(mk(B(1.3, 0.9, 1.9), '#8a6a3a'), t.x - 16 + (i % 3) * 1.6, t.z - 9 - Math.floor(i / 3) * 2.2, 0, 0.45);
    } else if (t.kind === 'rail') {
      const g = new THREE.Group();
      for (const z of [-3, 0, 3]) g.add(mk(B(70, 0.25, 1.5), '#4a433a', 0, 0.15, z));
      g.add(at(house(7, 5, 26, '#d9c9a8', '#8f4a34'), -6, 0, -11, 1.57), at(house(6, 4, 16, '#e6d7b6', '#b5532f'), 22, 0, -10, 1.57), mk(B(46, 0.6, 3), '#bdb39b', 0, 0.3, -5.6));
      g.add(mk(Cy(1.8, 1.8, 2.4, 8), '#5b6a72', -28, 6.2, -8), mk(Cy(0.3, 0.5, 5, 4), '#4a433a', -28, 2.5, -8), mk(new THREE.ConeGeometry(4, 3, 6), '#25262a', 30, 1.5, 7));
      const tr = train(6); tr.rotation.y = Math.PI / 2; tr.position.set(16, 0.2, 0); g.add(tr);
      const t2 = train(3); t2.rotation.y = -Math.PI / 2; t2.position.set(-20, 0.2, 3); g.add(t2);
      at(g, t.x, y + 0.2, t.z, 1.35); scene.add(g);
    } else if (t.kind === 'monastery') {
      const g = G(house(8, 7, 18, '#efe9da', '#a85436'), mk(B(4, 15, 4), '#ece5d4', 6.5, 7.5, -6), mk(B(4.4, 2, 2.2), '#d8d0bc', 6.5, 15.5, -6.9), house(16, 4, 5, '#e9e1cf', '#a85436'));
      g.children[3].position.set(-12, 0, 6);
      for (const [x, z, w, d] of [[0, 15, 44, 1.2], [0, -15, 44, 1.2], [-22, 0, 1.2, 30], [22, 0, 1.2, 30]]) g.add(mk(B(w, 2.6, d), '#d6ceb9', x, 1.3, z));
      at(g, t.x, y - 1.5, t.z, 0.5); scene.add(g);
      put(flak('ah'), t.x + 16, t.z + 12); put(flak('ah'), t.x - 18, t.z - 8);
    } else if (t.kind === 'depot') {
      for (let i = 0; i < 18; i++) put(tent('#e4dcc0', 2), t.x - 20 + (i % 6) * 6, t.z - 12 + Math.floor(i / 6) * 6);
      for (let i = 0; i < 5; i++) put(truck('#6c7758'), t.x + 20, t.z - 14 + i * 5, 1.57);
      for (let i = 0; i < 24; i++) put(mk(B(1.6, 1.1, 2.2), i % 4 ? '#8a6a3a' : '#6c7758'), t.x - 16 + (i % 8) * 2.1, t.z + 10 + Math.floor(i / 8) * 2.8, 0, 0.55 + (i % 5 == 0 ? 1.1 : 0));
      put(house(8, 4.5, 20, '#cdbf94', '#7a6a4c'), t.x - 30, t.z, 0); put(flag('it'), t.x + 6, t.z + 4);
    } else if (t.kind === 'redoubt') {
      put(mk(B(14, 2.6, 8), '#a3a096'), t.x, t.z, 0.3, 0.6); put(mk(B(6, 2.2, 6), '#98958b'), t.x + 12, t.z + 7, 0.3, 0.5); put(mk(B(5, 2, 5), '#98958b'), t.x - 13, t.z - 6, 0.6, 0.5);
      for (const [dx, dz] of [[-8, 12], [6, 14], [18, -6], [-18, 6], [0, -14]]) { put(sandbags(2.6), t.x + dx, t.z + dz); put(mk(Cy(0.12, 0.12, 2.4, 5), '#333'), t.x + dx, t.z + dz, 0, 1.2).rotation.x = 1.2; }
      put(flak('ah'), t.x + 4, t.z - 22);
    } else if (t.kind === 'shipyard') {
      const g = new THREE.Group();
      g.add(mk(B(60, 1.2, 34), '#b9b3a2', 0, 0.6, -10), mk(B(8, 1, 40), '#9c917a', -18, 0.7, 24), mk(B(8, 1, 40), '#9c917a', 16, 0.7, 24));
      const hull = mk(Cy(4.4, 3, 34, 6), '#8f4a36', -1, 5.2, 8); hull.rotation.x = Math.PI / 2 - 0.07; hull.scale.set(1, 1, 0.75); g.add(hull, mk(B(7, 1, 30), '#6d6a64', -1, 7.6, 6));
      for (const x of [-11, 9]) g.add(mk(B(1.2, 18, 1.2), '#4d5258', x, 9.6, 2), mk(B(1, 1, 16), '#4d5258', x, 18, 8), rod([x, 18, 15], [x, 10, 15], 0.06, '#222'));
      g.add(at(house(9, 6, 24, '#c9b999', '#7a4a36'), -22, 1.2, -16, 1.57), at(house(9, 6, 24, '#d6c7a6', '#8f4a34'), 6, 1.2, -18, 1.57), mk(Cy(1, 1.3, 16, 6), '#8f6a55', 24, 9, -12));
      at(g, t.x, 0.6, t.z + 2, 0.1); scene.add(g);
    }
    const r = ring(26, 7, TEAM.obj, 0, 0.12); at(r, t.x, t.kind === 'bridge' || t.kind === 'pontoon' ? lvl : y - 1, t.z); r.userData.id = t.id; rings.add(r);
  }

  // ---- balloon type line-up (only shown in its own shot) ----
  const LU = { x: -70, y: 150, z: -40 };
  ['avorio', 'drachen', 'caquot'].forEach((ty, i) => { const b = balloon(ty); b.position.set(LU.x + (i - 1) * 27, LU.y, LU.z + (i - 1) * 4); b.rotation.y = -1.25; b.scale.setScalar(1.25); lineup.add(b); lineup.add(rod([b.position.x, LU.y - 13.5, b.position.z], [b.position.x + 4, LU.y - 80, b.position.z + 3], 0.08, '#3d3a34')); });

  buildWindows(scene);                                      // after every building has been placed
  const KIND = { spad: SPAD, nieuport: NIEUPORT, hanriot: HANRIOT, albatros: ALBATROS, phonix: PHONIX, caproni: CAPRONI };
  return {
    LU,
    setMode({ map, rings: showRings, flights: fl, lineup: lu }) {
      rings.visible = !!showRings && !map; rings.children.forEach(r => r.visible = !Array.isArray(showRings) || showRings.includes(r.userData.id)); lineup.visible = lu;
      flights.clear();
      for (const f of fl) { const p = KIND[f.k](true); p.rotation.order = 'YXZ'; p.rotation.set(f.pitch || 0, f.h || 0, f.bank || 0); p.position.set(...f.p); p.scale.setScalar(f.s || 1); flights.add(p); if (f.smoke) for (let i = 1; i < 9; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + i * 0.22, 0), mat('#3b3836', { transparent: true, opacity: 0.75 - i * 0.07 })); s.position.set(f.p[0] - Math.sin(f.h) * i * 3 * (f.s || 1), f.p[1] + i * 0.5 + (i % 2) * 0.6, f.p[2] - Math.cos(f.h) * i * 3 * (f.s || 1)); flights.add(s); } }
    },
  };
}
