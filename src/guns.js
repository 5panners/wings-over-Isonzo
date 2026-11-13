// Machine-gun models and muzzle flashes, shared by the airships and the aircraft.
// Every model is merged into a few vertex-coloured meshes (one per moving part) so that detailed guns cost
// only a handful of draw calls.
import * as THREE from 'three';

export const gunMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const flashMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });

// A pile of primitives, each with its own colour and transform, merged into one geometry.
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
export class Parts {
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

// ---- a Le Prieur rocket: the black-powder rocket WW1 pilots fixed to the interplane struts and fired electrically at balloons and airships ----
// Along +z, about 1.2 long, centred on its middle: a cardboard-and-brass body, a pointed steel head, three small fins and the tube it sits in.
let rocketGeo = null;
export function makeRocket() {
  rocketGeo ??= new Parts()
    .add(cyl(0.062, 0.062, 0.8, 8), '#6a4a2c', 0, 0, 0.0, HALF).add(cyl(0.066, 0.066, 0.06, 8), '#b8924a', 0, 0, -0.18, HALF).add(cyl(0.066, 0.066, 0.06, 8), '#b8924a', 0, 0, 0.2, HALF)
    .add(new THREE.ConeGeometry(0.062, 0.3, 8), '#2a2a2a', 0, 0, 0.55, HALF)
    .add(box(0.012, 0.2, 0.2), '#3a3a3a', 0, 0, -0.5).add(box(0.2, 0.012, 0.2), '#3a3a3a', 0, 0, -0.5)
    .add(cyl(0.085, 0.085, 0.36, 8), '#7a7d78', 0, 0, -0.32, HALF).geometry();
  const m = new THREE.Mesh(rocketGeo, gunMaterial); m.castShadow = true; return m;
}

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
  // turns with the gun: shield and the loader behind it
  const ty = u ? -0.1 : 0.95, ey = u ? 0.64 : 1.5;
  const turn = new Parts()
    .add(box(1.9, 1.25, 0.1), '#707b68', 0, 0.2, 0.85).add(box(0.8, 0.4, 0.08), '#2c302b', 0, 0.2, 0.9)                              // heavy shield with a wide port for the barrels
    .add(box(0.6, 1.0, 0.42), '#7d6040', 0, ty, -0.95).add(cyl(0.18, 0.2, 1.0, 6), '#4d524d', -0.17, ty - 0.95, -0.95).add(cyl(0.18, 0.2, 1.0, 6), '#4d524d', 0.17, ty - 0.95, -0.95)
    .add(new THREE.SphereGeometry(0.22, 6, 5), '#d2a67e', 0, ey, -0.95).add(new THREE.SphereGeometry(0.25, 6, 4, 0, 6.3, 0, 1.3), '#5b4a35', 0, ey + 0.04, -0.95)
    .add(box(0.36, 0.1, 0.1), '#1d1d1d', 0, ey - 0.02, -0.74)                                                                         // goggles
    .add(box(0.13, 0.13, 0.6), '#7d6040', -0.3, 0.05, -0.55).add(box(0.13, 0.13, 0.6), '#7d6040', 0.3, 0.05, -0.55);                   // arms to the hand wheels
  if (!u) turn.add(box(0.5, 0.5, 0.4), '#4d524d', 0, ty - 0.45, -0.95);
  yawG.add(turn.mesh());
  // turns with the elevation: the cradle with its breech block, hand wheels, shell box and sight
  const cradle = new Parts()
    .add(box(0.9, 0.5, 0.9), '#5a615a', 0, 0, 0.15).add(box(0.5, 0.36, 0.5), '#3d423d', 0, 0, -0.4)                                   // cradle and breech
    .add(new THREE.TorusGeometry(0.17, 0.02, 4, 12), '#222', -0.45, 0, -0.35, 0, HALF).add(new THREE.TorusGeometry(0.17, 0.02, 4, 12), '#222', 0.45, 0, -0.35, 0, HALF)   // elevating and traversing wheels
    .add(box(0.4, 0.3, 0.6), '#5d4a2c', 0.72, 0.0, 0.05)                                                                               // ready-use shell box
    .add(cyl(0.075, 0.075, 0.34, 8), '#c9a44a', 0.62, 0.3, -0.1).add(cyl(0.075, 0.075, 0.34, 8), '#c9a44a', 0.82, 0.3, -0.1).add(cyl(0.075, 0.075, 0.34, 8), '#c9a44a', 0.72, 0.3, 0.2)   // brass shells
    .add(new THREE.TorusGeometry(0.15, 0.015, 4, 12), '#222', 0, 0.44, 0.35).add(cyl(0.015, 0.015, 0.2, 4), '#222', 0, 0.34, 0.35)    // ring sight
    .add(box(0.7, 0.07, 0.07), '#4d524d', 0, -0.3, 0.2).add(box(0.07, 0.5, 0.07), '#4d524d', 0, -0.12, 0.2);                           // trunnion
  pitchG.add(cradle.mesh());
  // recoils with each shot: two heavy barrels, their recoil sleeves and the hydraulic buffers
  const barrels = new Parts();
  for (const x of [-0.22, 0.22]) {
    barrels.add(cyl(0.12, 0.095, 2.4, 10), '#2b2b2b', x, 0, 1.3, HALF)                                                                 // barrel
      .add(cyl(0.21, 0.21, 0.95, 10), '#6a6e68', x, 0, 0.6, HALF).add(cyl(0.23, 0.23, 0.07, 10), '#3a3a38', x, 0, 0.15, HALF).add(cyl(0.23, 0.23, 0.07, 10), '#3a3a38', x, 0, 1.07, HALF)   // recoil sleeve
      .add(cyl(0.15, 0.15, 0.1, 10), '#3a3a38', x, 0, 1.7, HALF)                                                                       // reinforcing ring
      .add(cyl(0.17, 0.2, 0.4, 10), '#161616', x, 0, 2.6, HALF).add(box(0.05, 0.22, 0.22), '#262626', x, 0, 2.6)                       // muzzle brake with its baffle
      .add(cyl(0.045, 0.045, 1.2, 6), '#9a9d96', x * 1.75, -0.12, 0.8, HALF);                                                          // hydraulic buffer
  }
  recoilG.add(barrels.mesh());
  const flashes = [-0.22, 0.22].map(x => { const f = makeFlash(2.6); f.position.set(x, 0, 2.85); pitchG.add(f); return f; });
  return { root, yawG, pitchG, recoilG, flashes };
}
