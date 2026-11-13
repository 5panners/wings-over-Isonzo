// Machine-gun models and muzzle flashes, shared by the airships and the aircraft.
// Every model is merged into a few vertex-coloured meshes (one per moving part) so that detailed guns cost
// only a handful of draw calls.
import * as THREE from 'three';

export const gunMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const flashMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });

// A pile of primitives, each with its own colour and transform, merged into one geometry.
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
class Parts {
  constructor() { this.pos = []; this.col = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)));
    const a = g.attributes.position.array, c = new THREE.Color(color);
    for (let i = 0; i < a.length; i++) this.pos.push(a[i]);
    for (let i = 0; i < a.length / 3; i++) this.col.push(c.r, c.g, c.b);
    g.dispose(); return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
  mesh(material = gunMaterial, shadows = true) { const m = new THREE.Mesh(this.geometry(), material); m.castShadow = m.receiveShadow = shadows; return m; }
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const HALF = Math.PI / 2;

// ---- muzzle flash: a hot core, a bright cone along the barrel and a wider orange one, pointing along +z ----
let flashGeo = null;
export function makeFlash(scale = 1) {
  flashGeo ??= new Parts()
    .add(new THREE.ConeGeometry(0.2, 1.5, 5), '#ff9a30', 0, 0, 0.75, HALF)
    .add(new THREE.ConeGeometry(0.11, 1.0, 5), '#fff2b0', 0, 0, 0.5, HALF)
    .add(new THREE.ConeGeometry(0.09, 0.55, 4), '#ffb040', 0.2, 0, 0.1, HALF, 0, -HALF * 0.8).add(new THREE.ConeGeometry(0.09, 0.55, 4), '#ffb040', -0.2, 0, 0.1, HALF, 0, HALF * 0.8)     // side bursts
    .add(new THREE.ConeGeometry(0.09, 0.55, 4), '#ffb040', 0, 0.2, 0.1, HALF + HALF * 0.8).add(new THREE.ConeGeometry(0.09, 0.55, 4), '#ffb040', 0, -0.2, 0.1, HALF - HALF * 0.8)
    .add(new THREE.IcosahedronGeometry(0.16, 0), '#ffffff', 0, 0, 0.05).geometry();
  const m = new THREE.Mesh(flashGeo, flashMaterial); m.scale.setScalar(scale); m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
  return m;
}

// ---- an airship machine-gun mount ----
// up = 1: on a platform on top of the hull, the gunner standing behind the gun;
// up = -1: slung under the gondola in a blister, the gunner above the gun.
// The gun points along +z at rest. Turn it with yawG.rotation.y (about the vertical) and pitchG.rotation.x (negative = up).
export function buildGunMount(up) {
  const u = up > 0;
  const root = new THREE.Group(), yawG = new THREE.Group(), pitchG = new THREE.Group(), recoilG = new THREE.Group();
  root.add(yawG); yawG.add(pitchG); pitchG.add(recoilG);
  // fixed: pedestal and the deck or blister it stands in
  const fixed = new Parts();
  if (u) {
    fixed.add(cyl(1.55, 1.75, 0.3, 14), '#6b6d66', 0, -1.9, 0).add(cyl(0.2, 0.28, 1.8, 8), '#4d524d', 0, -1.0, 0)                   // deck and pedestal
      .add(new THREE.TorusGeometry(1.35, 0.05, 4, 20), '#484b45', 0, -0.55, 0, HALF).add(cyl(0.05, 0.05, 1.2, 4), '#484b45', 1.35, -1.15, 0).add(cyl(0.05, 0.05, 1.2, 4), '#484b45', -1.35, -1.15, 0)
      .add(cyl(0.05, 0.05, 1.2, 4), '#484b45', 0, -1.15, 1.35).add(cyl(0.05, 0.05, 1.2, 4), '#484b45', 0, -1.15, -1.35);          // the rail round the gunner
  } else {
    fixed.add(cyl(0.2, 0.28, 1.5, 8), '#4d524d', 0, 0.85, 0).add(cyl(0.1, 0.1, 0.1, 8), '#484b45', 0, 0.1, 0);                      // pedestal hung from the gondola
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fixed.add(cyl(0.05, 0.05, 2.3, 4), '#484b45', sx * 1.05, 0.55, sz * 1.0);   // blister frame
    fixed.add(box(2.4, 0.08, 2.4), '#484b45', 0, -0.55, 0).add(box(0.08, 0.5, 2.2), '#767971', 1.05, -0.3, 0).add(box(0.08, 0.5, 2.2), '#767971', -1.05, -0.3, 0);
  }
  root.add(fixed.mesh());
  // turns with the gun: shield and gunner
  const sh = u ? 0 : 1, gy = u ? 0 : 0.95, ty = u ? -0.1 : 0.95, ey = u ? 0.64 : 1.5;
  const turn = new Parts()
    .add(box(1.5, 0.95, 0.07), '#707b68', 0, 0.12, 0.6).add(box(0.5, 0.18, 0.06), '#2c302b', 0, 0.12, 0.64)                          // shield with a slot for the guns
    .add(box(0.6, 1.0, 0.42), '#7d6040', 0, ty + gy * 0, -0.85).add(cyl(0.18, 0.2, 1.0, 6), '#4a4636', -0.17, ty - 0.95, -0.85).add(cyl(0.18, 0.2, 1.0, 6), '#4a4636', 0.17, ty - 0.95, -0.85)
    .add(new THREE.SphereGeometry(0.22, 6, 5), '#d2a67e', 0, ey, -0.85).add(new THREE.SphereGeometry(0.25, 6, 4, 0, 6.3, 0, 1.3), '#5b4a35', 0, ey + 0.04, -0.85)   // head and leather helmet
    .add(box(0.36, 0.1, 0.1), '#1d1d1d', 0, ey - 0.02, -0.64)                                                                         // goggles
    .add(box(0.13, 0.13, 0.62), '#7d6040', -0.24, 0.0, -0.45).add(box(0.13, 0.13, 0.62), '#7d6040', 0.24, 0.0, -0.45);                 // arms to the grips
  if (!u) { turn.add(box(0.5, 0.5, 0.4), '#4a4636', 0, ty - 0.45, -0.85); }
  yawG.add(turn.mesh());
  // turns with the elevation: cradle, ammunition drum, grips and sight
  const cradle = new Parts()
    .add(box(0.4, 0.32, 0.7), '#5a615a', 0, 0, 0.1).add(cyl(0.3, 0.3, 0.2, 12), '#767971', 0.42, 0.04, 0.05, 0, 0, HALF).add(cyl(0.2, 0.2, 0.22, 8), '#2c2e2b', 0.42, 0.04, 0.05, 0, 0, HALF)   // ammunition drum
    .add(box(0.06, 0.18, 0.06), '#222', -0.16, 0, -0.5).add(box(0.06, 0.18, 0.06), '#222', 0.16, 0, -0.5).add(box(0.4, 0.05, 0.05), '#222', 0, 0.08, -0.5)   // spade grips
    .add(new THREE.TorusGeometry(0.15, 0.015, 4, 12), '#222', 0, 0.34, 0.2).add(cyl(0.015, 0.015, 0.22, 4), '#222', 0, 0.22, 0.2)       // ring sight
    .add(box(0.5, 0.06, 0.06), '#4d524d', 0, -0.2, 0.15).add(box(0.06, 0.4, 0.06), '#4d524d', 0, -0.05, 0.15);                          // trunnion
  pitchG.add(cradle.mesh());
  // recoils with each shot: the two barrels in their cooling jackets
  const barrels = new Parts();
  for (const x of [-0.14, 0.14]) {
    barrels.add(cyl(0.055, 0.055, 1.55, 8), '#262626', x, 0, 0.95, HALF).add(cyl(0.105, 0.105, 0.85, 8), '#6d716c', x, 0, 0.6, HALF)
      .add(cyl(0.115, 0.115, 0.06, 8), '#444', x, 0, 0.3, HALF).add(cyl(0.115, 0.115, 0.06, 8), '#444', x, 0, 0.6, HALF).add(cyl(0.115, 0.115, 0.06, 8), '#444', x, 0, 0.9, HALF)      // cooling rings
      .add(cyl(0.09, 0.075, 0.14, 8), '#151515', x, 0, 1.78, HALF);                                                                   // muzzle brake
  }
  recoilG.add(barrels.mesh());
  const flashes = [-0.14, 0.14].map(x => { const f = makeFlash(1.6); f.position.set(x, 0, 1.85); pitchG.add(f); return f; });
  return { root, yawG, pitchG, recoilG, flashes };
}
