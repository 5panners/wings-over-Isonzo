// Aircraft types, arcade flight model and bot pilot.
import * as THREE from 'three';
import { H, AIRFIELDS, HALF } from './world.js';
import { SPAD, ALBATROS } from './objects.js';

// One fighter per side for now; add entries here to add aircraft.
export const TYPES = {
  // top / stall in units per second, pitch / roll in radians per second at full control authority
  spad: { name: 'SPAD VII', team: 'it', build: SPAD, top: 58, stall: 21, pitch: 1.35, roll: 1.9, hp: 100 },             // faster, heavier on the stick
  albatros: { name: 'Albatros D.III', team: 'ah', build: ALBATROS, top: 52, stall: 18, pitch: 1.55, roll: 2.2, hp: 100 }, // slower, turns tighter
};
export const TEAM_TYPE = { it: 'spad', ah: 'albatros' };
export const TEAM_NAME = { it: 'Italy', ah: 'Austria-Hungary' };
export const TEAM_COLOR = { it: '#3d8bf0', ah: '#e2463b' };

export const GUN = { speed: 230, life: 1.5, interval: 0.09, damage: 7, hitRadius: 3.2 };
const CEILING = 480, G = 9.81, KD = 0.0055;   // drag coefficient; thrust is sized so level top speed = TYPES[..].top
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), ZERO = new THREE.Vector3();
const q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m1 = new THREE.Matrix4();

export class Plane {
  constructor(id, name, team, type, owner, isBot = false) {
    Object.assign(this, { id, name, team, type, owner, isBot });
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.fwd = new THREE.Vector3(0, 0, 1);
    this.vdir = new THREE.Vector3(0, 0, 1); this.sink = 0;   // flight-path direction (lags the nose) and stall sink rate
    this.speed = 40; this.throttle = 0.85; this.hp = TYPES[type].hp; this.alive = false; this.firing = false;
    this.respawnAt = 0; this.gunAt = 0; this.lastHitBy = null; this.lastHitAt = 0; this.seen = 0; this.bank = 0;
    this.net = null;                                  // latest network snapshot (remote planes only)
    this.mesh = TYPES[type].build(true); this.mesh.visible = false;
  }
  get local() { return this.net === null; }
  spawn(now) {
    const f = AIRFIELDS[this.team], a = Math.random() * 6.28, r = 30 + Math.random() * 70;
    this.pos.set(f.x + Math.cos(a) * r, 0, f.z + Math.sin(a) * r);
    this.pos.y = H(this.pos.x, this.pos.z) + 70 + Math.random() * 40;
    this.quat.setFromAxisAngle(Y, Math.atan2(-this.pos.x, -this.pos.z + 60));   // nose toward the front
    this.speed = 42; this.throttle = 0.85; this.hp = TYPES[this.type].hp; this.alive = true; this.firing = false;
    this.lastHitBy = null; this.bank = 0; this.gunAt = now + 1.5;
    this.fwd.copy(Z).applyQuaternion(this.quat); this.vdir.copy(this.fwd); this.sink = 0;
  }
  sync() { this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.quat); this.mesh.visible = this.alive; }
}

// Returns a crash reason ('ground' | 'bounds') or null.
function crashed(p) {
  if (p.pos.y < Math.max(0.4, H(p.pos.x, p.pos.z) + 1)) return 'ground';
  if (Math.abs(p.pos.x) > HALF + 220 || Math.abs(p.pos.z) > HALF + 220) return 'bounds';
  return null;
}

// ---------- human pilot ----------
// Flight model ported from Home Skies 1917 (in-flight part, standard handling).
// input = { pitch, roll, yaw (-1..1), throttle (-1..1 change), throttleAbs (0..1 or null), fire }
export function flyPlayer(p, input, dt) {
  const t = TYPES[p.type], q = p.quat, stall = t.stall;
  p.throttle = input.throttleAbs != null ? input.throttleAbs : THREE.MathUtils.clamp(p.throttle + input.throttle * 0.7 * dt, 0, 1);
  // control surfaces lose authority as the aircraft slows
  const auth = THREE.MathUtils.clamp((p.speed - 6) / (stall * 1.3), 0.12, 1);
  q.multiply(q1.setFromAxisAngle(X, -input.pitch * t.pitch * auth * dt));
  q.multiply(q1.setFromAxisAngle(Z, input.roll * t.roll * auth * dt));
  q.multiply(q1.setFromAxisAngle(Y, -input.yaw * 0.7 * auth * dt));
  // rightY > 0 means the right wing is high (banked left)
  const rightY = -v1.copy(X).applyQuaternion(q).y, upY = v2.copy(Y).applyQuaternion(q).y;
  // a banked aircraft turns: coordinated-turn rate g * bank / speed
  if (upY > 0) q.premultiply(q1.setFromAxisAngle(Y, rightY * 1.5 * G / Math.max(p.speed, 18) * dt));
  // lift: the flight path can only bend as fast as the wings can pull, which grows with the square of speed
  const n = Math.min(4.5, (p.speed / stall) * (p.speed / stall));
  if (n < 1) { p.sink = Math.min(11, p.sink + G * (1 - n) * dt); q.multiply(q1.setFromAxisAngle(X, 1.0 * (1 - n) * dt)); }   // stalled: sink and drop the nose
  else p.sink *= Math.exp(-2.5 * dt);
  if (p.pos.y > CEILING) q.multiply(q1.setFromAxisAngle(X, 0.5 * dt));                                                       // thin air above the ceiling
  q.normalize(); p.fwd.copy(Z).applyQuaternion(q);
  const ang = p.vdir.angleTo(p.fwd), wmax = G * Math.max(0.15, n) / Math.max(p.speed, 8);
  if (ang > 1e-4) p.vdir.lerp(p.fwd, Math.min(1, wmax * dt / ang)).normalize();
  // (not in Home Skies) below stall speed gravity takes over the flight path, so a stalled aircraft falls, gains speed and recovers
  if (n < 1) { p.vdir.y -= (1 - n) * 0.9 * dt; p.vdir.normalize(); }
  // thrust, drag, weight along the flight path, and extra drag when the nose is pulled away from it
  p.speed += (p.throttle * KD * t.top * t.top - KD * p.speed * p.speed - 15.5 * p.vdir.y - Math.sin(Math.min(ang, 0.7)) * 26) * dt;
  p.speed = THREE.MathUtils.clamp(p.speed, 0, t.top * 1.5);
  p.pos.addScaledVector(p.vdir, p.speed * dt); p.pos.y -= p.sink * dt;
  p.firing = !!input.fire;
  return crashed(p);
}

// ---------- bot pilot: steers a direction vector toward its goal at a limited turn rate ----------
export function flyBot(p, planes, now, dt) {
  const t = TYPES[p.type];
  const ai = p.ai ??= { skill: 0.6 + Math.random() * 0.35, patrol: new THREE.Vector3(), patrolAt: 0, jink: 0, aim: new THREE.Vector3() };
  // nearest living enemy
  let target = null, best = 650;
  for (const o of planes.values()) if (o.alive && o.team !== p.team) { const d = o.pos.distanceTo(p.pos); if (d < best) { best = d; target = o; } }
  const goal = v1;
  p.firing = false;
  if (target) {
    goal.copy(target.pos).addScaledVector(target.fwd, target.speed * best / GUN.speed);   // lead the shot
    goal.addScaledVector(ai.aim, best * 0.05 * (1.4 - ai.skill));
    if (now > ai.jink) { ai.jink = now + 0.6 + Math.random(); ai.aim.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); }
    goal.sub(p.pos).normalize();
    if (best < 28) goal.y += 0.5;                                    // don't ram
    if (best < 150 && goal.dot(p.fwd) > 0.997 && now > p.gunAt - 1) p.firing = true;
  } else {
    if (now > ai.patrolAt || ai.patrol.distanceTo(p.pos) < 60) { ai.patrolAt = now + 25; ai.patrol.set((Math.random() - 0.5) * 500, 150 + Math.random() * 120, (Math.random() - 0.5) * 800); }
    goal.copy(ai.patrol).sub(p.pos).normalize();
  }
  // stay inside the map, below the ceiling, and off the mountains
  if (Math.abs(p.pos.x) > HALF - 20 || Math.abs(p.pos.z) > HALF - 20) goal.set(-p.pos.x, 0.1, -p.pos.z).normalize();
  if (p.pos.y > CEILING - 60) goal.y = Math.min(goal.y, -0.15);
  for (const look of [1.2, 2.8]) {
    v2.copy(p.pos).addScaledVector(p.fwd, p.speed * look);
    if (v2.y < H(v2.x, v2.z) + 38) { goal.set(p.fwd.x * 0.6, 1, p.fwd.z * 0.6); break; }
  }
  if (p.pos.y < H(p.pos.x, p.pos.z) + 30) goal.y = Math.max(goal.y, 0.7);
  goal.normalize();
  // turn toward the goal
  const rate = t.pitch * (0.55 + 0.35 * ai.skill), ang = p.fwd.angleTo(goal);
  const turnY = v3.crossVectors(p.fwd, goal).y;
  if (ang > 1e-4) p.fwd.lerp(goal, Math.min(1, rate * dt / ang)).normalize();
  p.fwd.y = THREE.MathUtils.clamp(p.fwd.y, -0.8, 0.8); p.fwd.normalize();
  p.bank += (THREE.MathUtils.clamp(-turnY * 2.4, -1.25, 1.25) - p.bank) * Math.min(1, 4 * dt);
  p.quat.setFromRotationMatrix(m1.lookAt(p.fwd, ZERO, Y)).multiply(q1.setFromAxisAngle(Z, p.bank));
  p.speed += ((t.top * 0.86 - 16 * p.fwd.y) - p.speed) * Math.min(1, 0.7 * dt);
  p.vdir.copy(p.fwd); p.pos.addScaledVector(p.fwd, p.speed * dt);
  return crashed(p);
}

// ---------- remote planes: ease toward the dead-reckoned network snapshot ----------
export function flyRemote(p, now, dt) {
  const n = p.net; if (!n || !p.alive) return;
  v1.copy(n.fwd).multiplyScalar(n.speed * (now - n.at)).add(n.pos);
  if (p.pos.distanceToSquared(v1) > 120 * 120) p.pos.copy(v1); else p.pos.lerp(v1, 1 - Math.exp(-14 * dt));
  p.quat.slerp(n.quat, 1 - Math.exp(-12 * dt));
  p.fwd.copy(Z).applyQuaternion(p.quat);
}
