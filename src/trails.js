// Coloured vapour trails streaming from the wingtips of any aircraft diving faster than 200 km/h.
// One dynamic ribbon mesh holds every trail; each ribbon turns to face the camera and widens and fades as it ages.
import * as THREE from 'three';

const FAST = 200 / 3.6, LIFE = 2.2, SPACING = 1.6, MAXPTS = 56, MAXTRAILS = 64;      // 200 km/h in units per second
const TIPS = [new THREE.Vector3(-3.1, 1.05, 0.55), new THREE.Vector3(3.1, 1.05, 0.55)];
const TINT = { it: new THREE.Color('#78b8ff'), ah: new THREE.Color('#ff8a74') };

export function createTrails(scene, camera) {
  const verts = MAXTRAILS * MAXPTS * 2, pos = new Float32Array(verts * 3), col = new Float32Array(verts * 4), idx = new Uint32Array(MAXTRAILS * (MAXPTS - 1) * 6);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })); mesh.frustumCulled = false; mesh.renderOrder = 4; scene.add(mesh);
  const state = new Map();                                             // plane id -> { team, trails: [[{p, age}...], [...]] }
  const tip = new THREE.Vector3(), tan = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
  const api = {
    count: 0,
    update(planes, dt) {
      for (const p of planes.values()) {
        let s = state.get(p.id);
        const diving = p.alive && !p.dying && !p.onGround && p.speed > FAST && p.vdir.y < -0.12;       // fast and heading down
        if (!s) { if (!diving) continue; s = { team: p.team, trails: [[], []] }; state.set(p.id, s); }
        s.team = p.team;
        for (let k = 0; k < 2; k++) {
          const tr = s.trails[k]; for (const q of tr) q.age += dt;
          while (tr.length && tr[0].age > LIFE) tr.shift();
          if (diving) { tip.copy(TIPS[k]).applyQuaternion(p.quat).add(p.pos); const last = tr[tr.length - 1]; if (!last || last.p.distanceToSquared(tip) > SPACING * SPACING) { tr.push({ p: tip.clone(), age: 0, a: Math.min(1, (p.speed - FAST) / 12 + 0.3) }); if (tr.length > MAXPTS) tr.shift(); } }
        }
      }
      for (const [id, s] of state) if (!s.trails[0].length && !s.trails[1].length && !planes.has(id)) state.delete(id); else if (!s.trails[0].length && !s.trails[1].length) state.delete(id);
      // build the ribbons
      let v = 0, ix = 0, n = 0;
      for (const s of state.values()) for (const tr of s.trails) {
        if (tr.length < 2 || n >= MAXTRAILS) continue; n++; const c = TINT[s.team] || TINT.it, base = v;
        for (let i = 0; i < tr.length; i++) {
          const q = tr[i], a = tr[Math.max(0, i - 1)].p, b = tr[Math.min(tr.length - 1, i + 1)].p;
          tan.copy(b).sub(a); toCam.copy(camera.position).sub(q.p); side.crossVectors(tan, toCam).normalize();
          const f = 1 - q.age / LIFE, w = 0.14 + 0.55 * (q.age / LIFE), alpha = Math.min(1, f * 1.4) * 0.7 * q.a, hot = Math.max(0, f - 0.6) * 1.6;      // fresh vapour is whiter
          for (const sg of [-1, 1]) { pos[v * 3] = q.p.x + side.x * w * sg; pos[v * 3 + 1] = q.p.y + side.y * w * sg; pos[v * 3 + 2] = q.p.z + side.z * w * sg; const o = v * 4; col[o] = c.r + (1 - c.r) * hot; col[o + 1] = c.g + (1 - c.g) * hot; col[o + 2] = c.b + (1 - c.b) * hot; col[o + 3] = alpha; v++; }
        }
        for (let i = 0; i < tr.length - 1; i++) { const a = base + i * 2; idx[ix++] = a; idx[ix++] = a + 1; idx[ix++] = a + 2; idx[ix++] = a + 1; idx[ix++] = a + 3; idx[ix++] = a + 2; }
      }
      geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true; geo.index.needsUpdate = true; geo.setDrawRange(0, ix); api.count = n;
    },
  };
  return api;
}
