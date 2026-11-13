// The railway: ballast, rails and sleepers along the planned line (see world.js), stone viaducts where it crosses the valley,
// portals where it runs into the hillside, telegraph poles, and a steam train that comes through every now and then.
// By day it is a passenger train or a goods train; at night it is the sleeper service, every window lit and a lamp on the engine.
import * as THREE from 'three';
import { rail, baseH } from './world.js';
import { Parts } from './guns.js';

const HALF = Math.PI / 2;
const LINE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const TRAIN_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const CYCLE = 150, SPEED = 17;                                        // a train starts every 150 s (wall clock, so everyone sees the same one) at 17 units/s
const col = c => new THREE.Color(c);

export function createRailway(scene, fx = {}) {
  const R = rail(), P = R.P, N = P.length, total = R.length;
  const root = new THREE.Group(); scene.add(root);

  // ---- position along the line ----
  const at = (s, o = {}) => {                                            // x, y (bed), z and direction at distance s from the west end
    s = Math.max(0, Math.min(total, s)); let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], u = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    o.x = a.x + (b.x - a.x) * u; o.y = a.y + (b.y - a.y) * u; o.z = a.z + (b.z - a.z) * u; o.tx = a.tx + (b.tx - a.tx) * u; o.tz = a.tz + (b.tz - a.tz) * u; return o;
  };

  const idxAt = s => { let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; } return lo; };

  // ---- a prism following the line: lateral offset `off`, half width `hw`, from yBot to yTop above the bed ----
  function strip(from, to, off, hw, yBot, yTop, color, geo) {
    const c = col(color), pos = geo.pos, cl = geo.col;
    const V = (p, side, y) => { const l = off + side * hw; return [p.x - p.tz * l, p.y + y, p.z + p.tx * l]; };
    const quad = (a, b, d, e, k) => { const f = k ? 0.8 : 1; for (const v of [a, b, d, a, d, e]) { pos.push(...v); cl.push(c.r * f, c.g * f, c.b * f); } };
    for (let i = from; i < to; i++) {
      const p = P[i], q = P[i + 1];
      const tl = V(p, -1, yTop), tr = V(p, 1, yTop), bl = V(p, -1, yBot), br = V(p, 1, yBot), tl2 = V(q, -1, yTop), tr2 = V(q, 1, yTop), bl2 = V(q, -1, yBot), br2 = V(q, 1, yBot);
      quad(tl, tr, tr2, tl2, 0); quad(tl, bl, bl2, tl2, 1); quad(tr, br, br2, tr2, 1);
    }
  }
  const geoOf = g => { const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); m.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3)); m.computeVertexNormals(); return m; };
  const line = { pos: [], col: [] };
  strip(0, N - 1, 0, 2.1, -0.3, 0.14, '#6c675d', line);                                  // ballast
  strip(0, N - 1, -0.72, 0.07, 0.14, 0.4, '#8b9096', line); strip(0, N - 1, 0.72, 0.07, 0.14, 0.4, '#8b9096', line);   // the two rails
  // viaduct decks and stone parapets
  const runs = []; { let i = 0; while (i < N) { let j = i; while (j < N && P[j].kind === P[i].kind) j++; runs.push({ kind: P[i].kind, a: i, b: j - 1 }); i = j; } }
  for (const r of runs) if (r.kind === 'via') {
    const a = Math.max(0, r.a - 1), b = Math.min(N - 1, r.b + 1);
    strip(a, b, 0, 2.6, -1.0, -0.25, '#b8ad94', line); strip(a, b, -2.45, 0.2, -0.25, 0.75, '#c9bfa6', line); strip(a, b, 2.45, 0.2, -0.25, 0.75, '#c9bfa6', line);
  }
  const lineMesh = new THREE.Mesh(geoOf(line), LINE_MAT); lineMesh.receiveShadow = true; lineMesh.castShadow = true; root.add(lineMesh);

  // sleepers: one mesh for the lot
  { const n = Math.floor(total / 1.15), box = new THREE.BoxGeometry(2.3, 0.14, 0.32), inst = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#4a3a2a', flatShading: true }), n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), o = {};
    for (let i = 0; i < n; i++) { at(i * 1.15 + 0.5, o); q.setFromAxisAngle(Y, Math.atan2(o.tx, o.tz)); m4.compose(new THREE.Vector3(o.x, o.y + 0.2, o.z), q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(i, m4); }
    inst.receiveShadow = true; inst.frustumCulled = false; root.add(inst); }

  // viaduct piers and arches, portals at the two ends, telegraph poles
  const stone = new Parts(), o1 = {};
  const heading = s => { at(s, o1); return Math.atan2(-o1.tz, o1.tx); };      // turns an x-axis part so that it lies along the line
  for (const r of runs) if (r.kind === 'via') {
    const s0 = P[r.a].s, s1 = P[r.b].s, len = s1 - s0, n = Math.max(1, Math.round(len / 13)), span = len / n;
    for (let k = 0; k <= n; k++) {
      const s = s0 + k * span; at(s, o1); const g = baseH(o1.x, o1.z), top = o1.y - 1.0, h = Math.max(1, top - g + 1.5), rot = heading(s);
      stone.add(new THREE.CylinderGeometry(1.5, 2.1 + h * 0.035, h, 4), '#a89d84', o1.x, g - 1.5 + h / 2, o1.z, 0, rot + Math.PI / 4, 0, 1, 1, 1);            // a tapering pier
      stone.add(new THREE.BoxGeometry(3.0, 0.5, 4.0), '#c9bfa6', o1.x, top - 0.25, o1.z, 0, rot, 0);                                                              // its cap
    }
    for (let k = 0; k < n; k++) {
      const s = s0 + (k + 0.5) * span; at(s, o1); const rr = span / 2 - 1.5, rot = heading(s), top = o1.y - 1.0;
      stone.add(new THREE.TorusGeometry(rr, 0.45, 4, 10, Math.PI), '#bdb298', o1.x, top - 0.5 - rr, o1.z, 0, rot, 0, 1, 1, 3.4);                                  // the arch
    }
  }
  const portal = (end) => {                                                // a stone mouth in a rocky mound, where the line goes under the hill
    const p = end ? P[N - 1] : P[0], dir = end ? 1 : -1, tx = p.tx * dir, tz = p.tz * dir, rot = Math.atan2(tx, tz), by = p.y;
    const px = p.x + tx * 3, pz = p.z + tz * 3, g = new Parts();
    g.add(new THREE.BoxGeometry(9, 7.5, 5), '#9c917a', 0, 3.4, 0).add(new THREE.BoxGeometry(5, 5, 0.6), '#0b0b0d', 0, 2.5, -2.45).add(new THREE.BoxGeometry(6, 0.7, 5.3), '#b9ae95', 0, 5.2, 0)
      .add(new THREE.IcosahedronGeometry(11, 0), '#7c8068', 0, 3.5, 7, 0, 0.5, 0, 1.15, 0.8, 1.2).add(new THREE.IcosahedronGeometry(8, 0), '#6f7b5c', 4, 3, 12, 0, 1, 0, 1, 0.85, 1);
    const m = g.mesh(TRAIN_MAT, true); m.position.set(px, by - 0.2, pz); m.rotation.y = rot; root.add(m);
  };
  portal(false); portal(true);
  { const pole = new Parts(), o = {}; for (let s = 24; s < total - 20; s += 46) { const k = P[idxAt(s)]; if (k.kind !== 'earth') continue;
      at(s, o); const x = o.x - o.tz * 3.6, z = o.z + o.tx * 3.6, rot = heading(s);
      pole.add(new THREE.CylinderGeometry(0.1, 0.14, 6, 5), '#5a4630', x, o.y + 2.8, z).add(new THREE.BoxGeometry(0.16, 0.16, 1.5), '#5a4630', x, o.y + 5.4, z, 0, rot + HALF, 0)
        .add(new THREE.BoxGeometry(0.1, 0.18, 0.1), '#d9d4c4', x + Math.cos(rot) * 0.6, o.y + 5.6, z - Math.sin(rot) * 0.6).add(new THREE.BoxGeometry(0.1, 0.18, 0.1), '#d9d4c4', x - Math.cos(rot) * 0.6, o.y + 5.6, z + Math.sin(rot) * 0.6); }
    root.add(pole.mesh(TRAIN_MAT, true)); }
  root.add(stone.mesh(TRAIN_MAT, true));

  // =====================================================================================================================
  // the trains. Every vehicle faces +z; it is placed on the line from where its two ends are.
  // =====================================================================================================================
  const windowMat = new THREE.MeshBasicMaterial({ color: '#16202c', fog: false });           // glass: dark by day, warm yellow at night
  const wheels = (p, y, r, zs, xs = 0.98, c = '#2e2e30') => { for (const z of zs) for (const x of [-xs, xs]) p.add(new THREE.CylinderGeometry(r, r, 0.16, 9), c, x, y + r, z, 0, 0, HALF); return p; };
  function locomotive() {
    const p = new Parts();
    p.add(new THREE.BoxGeometry(1.9, 0.35, 7.8), '#1c1c1e', 0, 0.95, 0).add(new THREE.CylinderGeometry(0.82, 0.82, 4.4, 10), '#2b2d30', 0, 2.05, 1.2, HALF).add(new THREE.CylinderGeometry(0.86, 0.86, 0.5, 10), '#17171a', 0, 2.05, 3.55, HALF)
      .add(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 10), '#b8924a', 0, 2.05, 0.2, HALF).add(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 10), '#b8924a', 0, 2.05, 2.3, HALF)
      .add(new THREE.CylinderGeometry(0.2, 0.32, 1.1, 7), '#1c1c1e', 0, 3.3, 3.2).add(new THREE.CylinderGeometry(0.36, 0.26, 0.15, 7), '#b8924a', 0, 3.9, 3.2)
      .add(new THREE.SphereGeometry(0.5, 7, 4, 0, 6.3, 0, 1.6), '#b8924a', 0, 2.8, 1.6).add(new THREE.SphereGeometry(0.38, 7, 4, 0, 6.3, 0, 1.6), '#2b2d30', 0, 2.8, 0.2)
      .add(new THREE.BoxGeometry(2.2, 2.6, 2.1), '#23402f', 0, 2.5, -2.4).add(new THREE.BoxGeometry(2.45, 0.16, 2.6), '#2a2a2a', 0, 3.9, -2.4)
      .add(new THREE.BoxGeometry(2.25, 0.8, 0.9), '#0d1218', 0, 2.8, -2.4)
      .add(new THREE.BoxGeometry(2.3, 0.4, 0.35), '#8a2a22', 0, 1.05, 3.9).add(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 6), '#2a2a2a', -0.7, 1.05, 4.2, HALF).add(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 6), '#2a2a2a', 0.7, 1.05, 4.2, HALF)
      .add(new THREE.BoxGeometry(0.4, 0.4, 0.35), '#3a3228', 0, 2.75, 3.8)
      .add(new THREE.BoxGeometry(1.4, 0.15, 1.2), '#2a2a2a', 0, 0.75, 4.35, 0.5);
    wheels(p, 0.0, 0.55, [-2.6, -0.9], 0.98, '#8a2a22'); wheels(p, 0, 0.8, [1.1, 2.9], 0.98, '#8a2a22'); wheels(p, 0, 0.8, [0.2], 0.98, '#8a2a22');
    for (const x of [-1.0, 1.0]) p.add(new THREE.BoxGeometry(0.06, 0.12, 4), '#b8b8b8', x * 1.06, 0.55, 0.2);                    // coupling rods
    return { mesh: p.mesh(TRAIN_MAT, true), hl: 4.4, win: null, chimney: new THREE.Vector3(0, 4.1, 3.2) };
  }
  function tender() {
    const p = new Parts();
    p.add(new THREE.BoxGeometry(1.9, 0.35, 3.8), '#1c1c1e', 0, 0.95, 0).add(new THREE.BoxGeometry(2.2, 1.5, 3.6), '#26272a', 0, 1.8, 0).add(new THREE.BoxGeometry(1.8, 0.7, 3.0), '#111113', 0, 2.75, 0)
      .add(new THREE.BoxGeometry(2.25, 0.2, 3.65), '#8a2a22', 0, 1.3, 0); wheels(p, 0, 0.55, [-1.2, 1.2]);
    return { mesh: p.mesh(TRAIN_MAT, true), hl: 2.2, win: null };
  }
  function carriage(body, band, roof, lit = true) {
    const p = new Parts(), w = new Parts();
    p.add(new THREE.BoxGeometry(1.8, 0.3, 7.2), '#1c1c1e', 0, 0.75, 0).add(new THREE.BoxGeometry(2.3, 2.2, 7.2), body, 0, 2.0, 0).add(new THREE.CylinderGeometry(1.15, 1.15, 7.2, 8, 1, false, 0, Math.PI), roof, 0, 3.1, 0, HALF, 0, HALF, 1, 1, 0.35)
      .add(new THREE.BoxGeometry(2.34, 0.16, 7.22), band, 0, 2.55, 0).add(new THREE.BoxGeometry(2.34, 0.16, 7.22), band, 0, 1.45, 0);
    for (const z of [-2.4, 2.4]) { p.add(new THREE.BoxGeometry(1.7, 0.4, 2.3), '#1c1c1e', 0, 0.6, z); wheels(p, 0, 0.4, [z - 0.8, z + 0.8], 0.82); }
    if (lit) for (const z of [-2.9, -1.75, -0.6, 0.6, 1.75, 2.9]) for (const s of [-1, 1]) w.add(new THREE.BoxGeometry(0.08, 0.72, 0.72), '#ffffff', s * 1.16, 2.1, z);
    return { mesh: p.mesh(TRAIN_MAT, true), hl: 3.6, win: lit ? new THREE.Mesh(w.geometry(), windowMat) : null };
  }
  function wagon(kind) {
    const p = new Parts();
    p.add(new THREE.BoxGeometry(1.8, 0.3, 6), '#1c1c1e', 0, 0.75, 0).add(new THREE.BoxGeometry(2.3, 0.2, 6), '#4a3c2c', 0, 1.0, 0);
    if (kind === 0) p.add(new THREE.BoxGeometry(2.3, 0.9, 6), '#7b5a3a', 0, 1.6, 0).add(new THREE.BoxGeometry(1.9, 0.5, 5.2), '#16161a', 0, 2.1, 0);                 // coal
    else if (kind === 1) p.add(new THREE.BoxGeometry(2.3, 2.3, 6), '#6e4a30', 0, 2.1, 0).add(new THREE.BoxGeometry(2.5, 0.2, 6.2), '#3a3a3c', 0, 3.3, 0).add(new THREE.BoxGeometry(0.06, 1.8, 1.6), '#4a3220', 1.17, 2.0, 0).add(new THREE.BoxGeometry(0.06, 1.8, 1.6), '#4a3220', -1.17, 2.0, 0);   // box van
    else { p.add(new THREE.BoxGeometry(2.3, 0.7, 6), '#8a8168', 0, 1.5, 0); for (let i = 0; i < 4; i++) p.add(new THREE.CylinderGeometry(0.4, 0.4, 5.6, 7), '#6a5030', -0.65 + (i % 2) * 1.3, 2.1 + Math.floor(i / 2) * 0.7, 0, HALF); }  // timber
    for (const z of [-1.9, 1.9]) wheels(p, 0, 0.4, [z], 0.82);
    return { mesh: p.mesh(TRAIN_MAT, true), hl: 3.0, win: null };
  }
  // the lamp on the engine: a hot glow and a faint beam down the track, for the night service
  const lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff0c0', fog: false, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  const beam = new THREE.Mesh(new THREE.ConeGeometry(6, 46, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe9b0', fog: false, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.rotation.x = -HALF; beam.position.set(0, 0, 23 + 0.4); beam.frustumCulled = false; lampGlow.frustumCulled = false; beam.renderOrder = lampGlow.renderOrder = 6;

  const consists = {};                                                              // built once each, when first needed
  function consist(kind) {
    if (consists[kind]) return consists[kind];
    const cars = [locomotive(), tender()];
    if (kind === 'sleeper') { cars.push(carriage('#233e6a', '#c9a64a', '#3c3f46'), carriage('#233e6a', '#c9a64a', '#3c3f46'), carriage('#233e6a', '#c9a64a', '#3c3f46'), carriage('#233e6a', '#c9a64a', '#3c3f46'), carriage('#2c2a30', '#c9a64a', '#3c3f46')); }
    else if (kind === 'passenger') cars.push(carriage('#5b3a28', '#d6c18a', '#555a5e'), carriage('#3f6a42', '#d6c18a', '#555a5e'), carriage('#5b3a28', '#d6c18a', '#555a5e'));
    else for (let i = 0; i < 8; i++) cars.push(wagon(i % 3));
    const g = new THREE.Group(); g.visible = false; let off = 0; const parts = [];
    for (const c of cars) { const v = new THREE.Group(); v.add(c.mesh); if (c.win) v.add(c.win); g.add(v); off += c.hl; parts.push({ v, hl: c.hl, off, chimney: c.chimney }); off += c.hl + 0.6; }
    parts[0].v.add(lampGlow.clone(), beam.clone()); parts[0].v.children.slice(-2).forEach(m => { m.position.y = m.geometry.type === 'SphereGeometry' ? 2.75 : 2.75; m.position.z = m.geometry.type === 'SphereGeometry' ? 4.1 : 4.1 + 23; });
    parts[0].lamp = parts[0].v.children.slice(-2);
    root.add(g); return (consists[kind] = { g, parts, len: off - 0.6, lit: kind !== 'freight' });
  }

  // ---- the timetable: a train every CYCLE seconds, alternating direction ----
  const run = { idx: -1, kind: null }, a = {}, b = {}; let smokeAt = 0, chuff = 0;
  const state = { active: false, pos: new THREE.Vector3(), speed: SPEED, kind: null };
  function update(dt, t, night = 0) {
    const secs = globalThis.__railTime ?? Date.now() / 1000, idx = Math.floor(secs / CYCLE), tp = secs - idx * CYCLE, dir = idx % 2 ? 1 : -1;
    if (idx !== run.idx) { run.idx = idx; run.kind = night > 0.5 ? 'sleeper' : idx % 3 === 0 ? 'freight' : 'passenger'; for (const k in consists) consists[k].g.visible = false; state.kind = run.kind; }
    const c = consist(run.kind), head = tp * SPEED, done = head - c.len > total + 6;                // head: how far the engine has come since it entered
    c.g.visible = state.active = !done;
    if (done) return;
    const winLit = c.lit ? night : 0; windowMat.color.setRGB(0.09 + 0.91 * winLit, 0.13 + 0.67 * winLit, 0.17 + 0.25 * winLit * 0.5);
    for (const [i, p] of c.parts.entries()) {
      const s = dir > 0 ? head - p.off : total - head + p.off, sf = s + dir * p.hl * 0.75, sr = s - dir * p.hl * 0.75;       // front and rear ends along the line
      const on = s > -2 && s < total + 2; p.v.visible = on; if (!on) continue;
      at(Math.max(0, Math.min(total, sf)), a); at(Math.max(0, Math.min(total, sr)), b);
      p.v.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.38, (a.z + b.z) / 2);
      const dx = (a.x - b.x) * dir, dz = (a.z - b.z) * dir, dy = (a.y - b.y) * dir, hz = Math.hypot(dx, dz) || 1;       // direction of travel
      p.v.rotation.set(-Math.atan2(dy, hz), Math.atan2(dx, dz), 0, 'YXZ');
      if (i === 0) {
        const lamps = p.lamp; if (lamps) for (const m of lamps) m.visible = night > 0.35;
        state.pos.copy(p.v.position);
        if (t > smokeAt && fx.puff) {                                                // steam from the chimney, and a heavier puff with each chuff
          smokeAt = t + 0.22; const ch = p.v.localToWorld(new THREE.Vector3(0, 4.1, 3.2)); fx.puff(ch, '#d9d9d6', 1.5 + Math.random(), 2.4, 3.2, 0.4);
          if ((chuff++ & 1) === 0 && fx.chuff) fx.chuff(p.v.position);
        }
      }
    }
  }
  return { update, root, line: () => P, total, state, at };
}
