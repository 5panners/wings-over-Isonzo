// The rocket pickup: a small supply balloon with a crate of Le Prieur rockets slung under it.
// There is only ever one. The host makes it appear at a random place and time, it drifts a little, and it stays for
// two minutes unless somebody flies through it first. It is made to be impossible to miss: a pulsing outline of light
// around the whole thing, a glow, and a ring of light that swells and turns.
import * as THREE from 'three';
import { H, HALF, HALF_X } from './world.js';
import { Parts, gunMaterial, makeRocket } from './guns.js';

export const ROCKETS_PER_PACK = 8;
const COLLECT_R = 13, STAY = 120;
const rand = (a, b) => a + Math.random() * (b - a);

export function createPickup(scene) {
  const root = new THREE.Group(), bob = new THREE.Group(); root.add(bob); root.visible = false; scene.add(root);
  const HALF_PI = Math.PI / 2;
  // the balloon envelope (cream with red bands) and, beneath it, a wooden crate with rockets strapped on top, held by four ropes
  const env = new Parts().add(new THREE.IcosahedronGeometry(3.3, 1), '#ece2c4', 0, 6.6, 0, 0, 0, 0, 1, 1.28, 1)
    .add(new THREE.TorusGeometry(2.7, 0.2, 4, 12), '#c9302a', 0, 7.4, 0, HALF_PI).add(new THREE.TorusGeometry(2.4, 0.2, 4, 12), '#c9302a', 0, 5.4, 0, HALF_PI);
  const load = new Parts().add(new THREE.BoxGeometry(2.4, 1.7, 2.4), '#8a6a3a', 0, 0, 0).add(new THREE.BoxGeometry(2.5, 0.2, 2.5), '#5a4328', 0, 0.9, 0).add(new THREE.BoxGeometry(0.3, 1.8, 2.5), '#c9302a', 0, 0, 0)
    .add(new THREE.BoxGeometry(2.5, 1.8, 0.3), '#c9302a', 0, 0, 0);
  for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) load.add(new THREE.CylinderGeometry(0.03, 0.03, 4.7, 4), '#4a4034', dx * 0.55, 2.55, dz * 0.55, 0, 0, dx * 0.1);
  const envMesh = env.mesh(gunMaterial, false), loadMesh = load.mesh(gunMaterial, false); bob.add(envMesh, loadMesh);
  for (let i = 0; i < 4; i++) { const r = makeRocket(); r.position.set(-0.75 + i * 0.5, 1.12, 0); r.rotation.y = -HALF_PI + 0; r.rotation.x = 0; r.scale.setScalar(0.9); r.rotation.set(0, HALF_PI, 0); bob.add(r); }
  bob.scale.setScalar(1.15);

  // ---- the aura ----
  const glowMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, fog: false, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
  const outlineEnv = new THREE.Mesh(envMesh.geometry, glowMat('#ffd24a', 0.8)), outlineLoad = new THREE.Mesh(loadMesh.geometry, glowMat('#ffd24a', 0.8));   // a slightly larger back-faced copy rings each part in light
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 1), new THREE.MeshBasicMaterial({ color: '#ffcf4a', fog: false, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.35, 5, 36), new THREE.MeshBasicMaterial({ color: '#fff0a8', fog: false, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  const ring2 = ring.clone(); ring2.material = ring.material.clone();
  for (const o of [outlineEnv, outlineLoad, halo, ring, ring2]) { o.frustumCulled = false; o.renderOrder = 8; }
  outlineEnv.position.copy(envMesh.position); outlineLoad.position.copy(loadMesh.position);
  bob.add(outlineEnv, outlineLoad); root.add(halo, ring, ring2);
  halo.position.y = ring.position.y = ring2.position.y = 4.2;

  const state = { cur: null, nextAt: 0, id: 0, taken: new Set() };            // cur = { id, x, y, z, until }
  const vis = (on) => { root.visible = on; };
  function spawnAt() {                                       // anywhere over land inside the combat area, at flying height
    for (let i = 0; i < 40; i++) {
      const x = rand(-HALF_X * 0.8, HALF_X * 0.8), z = rand(-HALF * 0.55, HALF * 0.6), g = H(x, z);
      if (g < 3) continue;                                    // not over the sea
      return { x, z, y: Math.min(g + rand(45, 140), 380) };
    }
    return { x: 0, z: 100, y: 150 };
  }
  const api = {
    get current() { return state.cur; },
    // host: decide when and where a pickup appears
    host(now) {
      if (!state.nextAt) state.nextAt = now + rand(15, 45);
      if (state.cur && now > state.cur.until) { state.cur = null; state.nextAt = now + rand(25, 80); }
      if (!state.cur && now > state.nextAt) { const p = spawnAt(); state.cur = { id: ++state.id + Math.floor(Math.random() * 1e6), ...p, until: now + STAY }; }
    },
    // after somebody takes it (or the round restarts)
    clear(now, soon = false) { state.cur = null; state.nextAt = now + (soon ? rand(8, 15) : rand(25, 80)); },
    // the aircraft that can take it: true if p is inside the aura
    touching(p) { const c = state.cur; return !!c && p.alive && !p.dying && Math.hypot(p.pos.x - c.x, p.pos.y - c.y, p.pos.z - c.z) < COLLECT_R; },
    pack() { const c = state.cur; return c ? [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.z)] : 0; },
    // somebody (here) has just flown through it; remember its id so a late update from the host cannot bring it back
    take() { if (state.cur) state.taken.add(state.cur.id); state.cur = null; },
    unpack(a) { if (!a) { state.cur = null; return; } if (state.taken.has(a[0])) return; if (!state.cur || state.cur.id !== a[0]) state.cur = { id: a[0], x: a[1], y: a[2], z: a[3], until: Infinity }; },
    // drawing, every frame
    update(t, dt, night) {
      const c = state.cur; vis(!!c); if (!c) return;
      const sway = Math.sin(t * 0.6 + c.id) * 2.5, bobY = Math.sin(t * 1.1 + c.id) * 1.2;
      root.position.set(c.x + sway, c.y + bobY, c.z + Math.cos(t * 0.5 + c.id) * 2.5); bob.rotation.y = t * 0.35;
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.4), pulse2 = 0.5 + 0.5 * Math.sin(t * 4.4 + 2.1), s = 1.1 + 0.07 * pulse;
      outlineEnv.scale.setScalar(s); outlineLoad.scale.setScalar(s + 0.06); outlineEnv.material.opacity = outlineLoad.material.opacity = 0.45 + 0.55 * pulse;
      outlineEnv.material.color.setHSL(0.12 + 0.03 * pulse, 1, 0.55); outlineLoad.material.color.copy(outlineEnv.material.color);
      halo.scale.setScalar(0.85 + 0.35 * pulse); halo.material.opacity = 0.1 + 0.2 * pulse;
      ring.scale.setScalar(0.8 + 0.4 * pulse); ring.rotation.set(HALF_PI + 0.3 * Math.sin(t * 0.7), t * 0.9, 0); ring.material.opacity = 0.35 + 0.55 * pulse;
      ring2.scale.setScalar(0.8 + 0.4 * pulse2); ring2.rotation.set(HALF_PI - 0.3 * Math.sin(t * 0.6), -t * 0.7, 0.8); ring2.material.opacity = 0.3 + 0.5 * pulse2;
    },
    position() { const c = state.cur; return c ? new THREE.Vector3(c.x, c.y, c.z) : null; },
  };
  return api;
}
