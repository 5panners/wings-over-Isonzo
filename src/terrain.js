// Terrain, water, sky, trees and clouds for the Isonzo Front map (flat-shaded, no textures).
import * as THREE from 'three';
import { sst, lerp, rnd, fbm, hash2, H, riverX, riverLevel, riverHalf, coastZ, AIRFIELDS, TOWNS, TARGETS } from './world.js';

export function buildTerrain(scene) {
const HAZE = new THREE.Color('#c9dbe6');
scene.fog = new THREE.Fog(HAZE, 500, 3400);

// ---------- sky ----------
{
  const g = new THREE.SphereGeometry(7000, 32, 16), col = [], p = g.attributes.position;
  const top = new THREE.Color('#3f7fca'), mid = new THREE.Color('#9cc6e6'), hor = new THREE.Color('#f3e6c8');
  for (let i = 0; i < p.count; i++) { const t = Math.max(0, p.getY(i) / 7000); const c = t < 0.18 ? hor.clone().lerp(mid, t / 0.18) : mid.clone().lerp(top, Math.pow((t - 0.18) / 0.82, 0.7)); col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.name = 'sky'; sky.renderOrder = -10; scene.add(sky);
}
const SUN = new THREE.Vector3(-0.62, 0.58, 0.5).normalize();
const hemi = new THREE.HemisphereLight('#cfe4ff', '#8a7a55', 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d2', 2.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; scene.add(sun, sun.target);

// ---------- terrain ----------
const SIZE = 1950, N = 260, cell = SIZE / N;
const C = h => new THREE.Color(h);
const PAL = {
  fields: ['#8db552', '#a2c35a', '#79a547', '#d8c66a', '#b38b5c', '#94ba58', '#c4d06f', '#6f9c44', '#e0cf7a'].map(C),
  meadow: C('#86b254'), forest: C('#4f8043'), forest2: C('#3f6e3c'), alpine: C('#9aa56a'), rock: C('#a7a199'), rock2: C('#8c8780'), rockWarm: C('#c2b8a4'),
  snow: C('#f6f9fd'), gravel: C('#e3dfcc'), sand: C('#dccf9f'), karst: C('#b7b584'), karst2: C('#cfcbb0'), mud: C('#8b7558'), bed: C('#4aa99a'),
};
function inField(f, x, z, a, b) { const c = Math.cos(f.rot), s = Math.sin(f.rot), dx = x - f.x, dz = z - f.z; const u = dx * c + dz * s, v = -dx * s + dz * c; return Math.abs(u) < a && Math.abs(v) < b; }
function zone(x, z, y, ny) { // classify ground
  const r = riverX(z), d = x - r, ad = Math.abs(d), lvl = riverLevel(z), rw = riverHalf(z), slope = 1 - ny, rel = y - lvl;
  if (y < 1.2 && z > coastZ(x) - 45) return 'sand';
  if (ad < rw + 7 && rel < 2.4) return rel < -0.5 ? 'bed' : 'gravel';
  if (slope > (y - lvl < 120 ? 0.5 : 0.36)) return 'rock';
  const n = fbm(x * 0.02, z * 0.02, 2);
  if (y > 215 + 30 * n) return 'snow';
  if (y > 172 + 20 * n) return 'alpine';
  const w = lerp(20, 44, sst(-480, 320, z));
  if (z > -130 && z < 440 && ad > rw + 9 && ad < w + 62 && fbm(x * 0.03 + 9, z * 0.03, 2) > -0.12 && slope < 0.2) return 'mud';
  if (rel < 13 && slope < 0.035) return 'fields';
  if (d > 30 && z > 262 && rel > 12) return 'karst';
  return n > 0.12 && slope < 0.1 ? 'meadow' : 'forest';
}
{
  const pos = [], col = [], hs = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hs[j * (N + 1) + i] = H(-SIZE / 2 + i * cell, -SIZE / 2 + j * cell);
  const v = (i, j) => new THREE.Vector3(-SIZE / 2 + i * cell, hs[j * (N + 1) + i], -SIZE / 2 + j * cell);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), c = new THREE.Color();
  const tri = (a, b, d, k) => {
    e1.subVectors(b, a); e2.subVectors(d, a); nn.crossVectors(e1, e2).normalize();
    const cx = (a.x + b.x + d.x) / 3, cy = (a.y + b.y + d.y) / 3, cz = (a.z + b.z + d.z) / 3;
    const zn = zone(cx, cz, cy, nn.y); const j = hash2(Math.round(cx * 3), Math.round(cz * 3) + k);
    if (zn === 'fields') { const u = cx * 0.95 + cz * 0.3, w = -cx * 0.3 + cz * 0.95; c.copy(PAL.fields[Math.floor(hash2(Math.floor(u / 36), Math.floor(w / 25)) * PAL.fields.length)]); }
    else if (zn === 'rock') c.copy(cy < 150 ? PAL.rockWarm : j > 0.5 ? PAL.rock : PAL.rock2).lerp(PAL.snow, sst(215, 300, cy) * (nn.y > 0.45 ? 0.75 : 0.15));
    else if (zn === 'forest') c.copy(j > 0.5 ? PAL.forest : PAL.forest2);
    else if (zn === 'karst') c.copy(j > 0.72 ? PAL.karst2 : PAL.karst).lerp(PAL.meadow, 0.25 * j);
    else c.copy(PAL[zn]);
    if (inField(AIRFIELDS.it, cx, cz, 135, 60) || inField(AIRFIELDS.ah, cx, cz, 135, 60)) c.copy(PAL.fields[5]);
    c.offsetHSL(0, 0, (j - 0.5) * 0.06);
    for (const p of [a, b, d]) { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); }
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = v(i, j), b = v(i + 1, j), d = v(i, j + 1), e = v(i + 1, j + 1);
    if ((i + j) & 1) { tri(a, d, b, 0); tri(b, d, e, 1); } else { tri(a, d, e, 0); tri(a, e, b, 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); m.receiveShadow = true; m.castShadow = true; scene.add(m);
}
// ---------- water ----------
{
  const pos = [], col = [], c = new THREE.Color(), step = 7;
  for (let z = -975; z < 600; z += step) {
    const q = zz => [riverX(zz) - riverHalf(zz) - 2.2, riverX(zz) + riverHalf(zz) + 2.2, riverLevel(zz) + 0.05];
    const [l0, r0, y0] = q(z), [l1, r1, y1] = q(z + step);
    const quad = [[l0, y0, z], [l1, y1, z + step], [r1, y1, z + step], [l0, y0, z], [r1, y1, z + step], [r0, y0, z]];
    quad.forEach((p, i) => { if (i % 3 === 0) c.set('#35c9ae').offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.06); pos.push(...p); col.push(c.r, c.g, c.b); });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); m.receiveShadow = true; scene.add(m);
  // Adriatic
  const sg = new THREE.PlaneGeometry(9000, 9000, 90, 90).toNonIndexed(); sg.rotateX(-Math.PI / 2);
  const sp = sg.attributes.position, sc = [];
  for (let i = 0; i < sp.count; i += 3) { c.set('#2f86a6').offsetHSL(0, 0, (rnd() - 0.5) * 0.05); for (let k = 0; k < 3; k++) sc.push(c.r, c.g, c.b); }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const sea = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); sea.position.y = 0; sea.receiveShadow = true; scene.add(sea);
}
// ---------- distant ranges ----------
for (const [R, hh, colr, sd] of [[1750, 420, '#8fa9bf', 3], [2500, 620, '#a9c0d2', 8]]) {
  const pos = [], col = [], S = 120, c = new THREE.Color(colr), w = new THREE.Color('#eef4fa');
  const top = i => { const a = i / S * Math.PI * 2; const north = sst(0.45, -0.5, Math.sin(a)); return 20 + hh * north * (0.45 + 0.75 * Math.abs(fbm(i * 0.21 + sd, sd, 3)) + 0.25 * hash2(i, sd)); };
  for (let i = 0; i < S; i++) {
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2, t0 = top(i), t1 = top((i + 1) % S);
    const P0 = [Math.cos(a0) * R, -30, Math.sin(a0) * R], P1 = [Math.cos(a1) * R, -30, Math.sin(a1) * R], Q0 = [Math.cos(a0) * R * 1.03, t0, Math.sin(a0) * R * 1.03], Q1 = [Math.cos(a1) * R * 1.03, t1, Math.sin(a1) * R * 1.03];
    pos.push(...P0, ...Q0, ...P1, ...P1, ...Q0, ...Q1);
    for (const t of [0, t0, 0, 0, t0, t1]) { const k = c.clone().lerp(w, sst(hh * 0.5, hh * 0.85, t)); col.push(k.r, k.g, k.b); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })); m.name = 'far'; scene.add(m);
}
// ---------- trees ----------
{
  const cone = new THREE.ConeGeometry(1, 1, 5); cone.translate(0, 0.5, 0);
  const ico = new THREE.IcosahedronGeometry(1, 0); ico.translate(0, 0.9, 0);
  const A = [], Bk = [];
  const near = (x, z) => TOWNS.some(t => (x - t.x) ** 2 + (z - t.z) ** 2 < (t.r + 3) ** 2) || TARGETS.some(t => (x - t.x) ** 2 + (z - t.z) ** 2 < (t.kind === 'battery' ? 1100 : 500)) || inField(AIRFIELDS.it, x, z, 150, 75) || inField(AIRFIELDS.ah, x, z, 150, 75);
  for (let i = 0; i < 90000; i++) {
    const x = (rnd() - 0.5) * 1900, z = (rnd() - 0.5) * 1900, y = H(x, z);
    const e = 2, ny = 1 / Math.hypot((H(x + e, z) - H(x - e, z)) / (2 * e), 1, (H(x, z + e) - H(x, z - e)) / (2 * e));
    const zn = zone(x, z, y, ny); if (near(x, z)) continue;
    const dens = fbm(x * 0.012 + 40, z * 0.012, 2);
    if (zn === 'forest' && dens > -0.25) (y - riverLevel(z) > 45 || rnd() > 0.5 ? A : Bk).push([x, y, z, 0]);
    else if ((zn === 'meadow' || zn === 'alpine') && rnd() < 0.1) A.push([x, y, z, 0]);
    else if (zn === 'fields' && rnd() < 0.045) Bk.push([x, y, z, 1]);
    else if (zn === 'karst' && rnd() < 0.2) Bk.push([x, y, z, 2]);
  }
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const mk = (geo, list, cols, sx, sy) => {
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), list.length);
    list.forEach((t, i) => { const s = 0.75 + rnd() * 0.7; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6); M4.compose(new THREE.Vector3(t[0], t[1] - 0.2, t[2]), q, new THREE.Vector3(sx * s * (t[3] == 2 ? 0.7 : 1), sy * s * (t[3] == 2 ? 0.6 : 1), sx * s)); im.setMatrixAt(i, M4); c.set(cols[Math.floor(rnd() * cols.length)]); im.setColorAt(i, c); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  };
  mk(cone, A, ['#2f5d38', '#37693c', '#2a5233', '#3e7440'], 2.1, 7.5);
  mk(ico, Bk, ['#5e9440', '#6aa048', '#4f8539', '#7dab4c', '#89a845'], 2.6, 2.9);
}
// ---------- clouds ----------
const clouds = new THREE.Group(); clouds.name = 'clouds'; scene.add(clouds);
{
  const g = new THREE.IcosahedronGeometry(1, 1), m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#8f9fb0', emissiveIntensity: 0.35 });
  for (let i = 0; i < 46; i++) {
    const grp = new THREE.Group(), n = 4 + Math.floor(rnd() * 5), s = 13 + rnd() * 20;
    for (let k = 0; k < n; k++) { const b = new THREE.Mesh(g, m); const r = s * (0.5 + rnd() * 0.6); b.scale.set(r * 1.5, r * 0.62, r); b.position.set((k - n / 2) * s * 0.85 + rnd() * 8, rnd() * s * 0.25, (rnd() - 0.5) * s * 0.9); b.castShadow = true; grp.add(b); }
    const a = rnd() * 6.28, R = 350 + rnd() * 1700; grp.position.set(Math.cos(a) * R, 400 + rnd() * 260, Math.sin(a) * R - 250); grp.rotation.y = rnd() * 0.5; clouds.add(grp);
  }
}

  return { sun, hemi, clouds };
}
