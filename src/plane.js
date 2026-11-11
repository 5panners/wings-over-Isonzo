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

// Bot difficulty presets. skill scales turn rate and steadiness of aim; range is how far they open fire;
// spread is how much their aim wanders; cone is how well lined up they must be before firing.
export const BOT_LEVELS = [
  { name: 'Rookie', skill: [0.15, 0.4], range: 100, spread: 0.11, cone: 0.9985 },
  { name: 'Regular', skill: [0.6, 0.9], range: 150, spread: 0.05, cone: 0.997 },
  { name: 'Ace', skill: [0.95, 1.1], range: 200, spread: 0.018, cone: 0.9955 },
];
export const botSettings = { level: 1 };
export const COLLIDE_RADIUS = 4.2;     // two aircraft closer than this have hit each other

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
    this.resetDamage();
    this.mesh = TYPES[type].build(true); this.mesh.visible = false;
  }
  get local() { return this.net === null; }
  // damage state: each zone runs 0 (sound) to 1 (destroyed)
  resetDamage() { this.dmg = { eng: 0, wing: 0, fuel: 0, ctl: 0 }; this.fuel = 1; this.fire = false; this.fireT = 0; this.dying = false; this.dyRoll = 0; this.power = 0; this.smoke = false; }
  spawn(now) {
    const f = AIRFIELDS[this.team], a = Math.random() * 6.28, r = 30 + Math.random() * 70;
    this.pos.set(f.x + Math.cos(a) * r, 0, f.z + Math.sin(a) * r);
    this.pos.y = H(this.pos.x, this.pos.z) + 70 + Math.random() * 40;
    this.quat.setFromAxisAngle(Y, Math.atan2(-this.pos.x, -this.pos.z + 60));   // nose toward the front
    this.speed = 42; this.throttle = 0.85; this.hp = TYPES[this.type].hp; this.alive = true; this.firing = false;
    this.lastHitBy = null; this.bank = 0; this.gunAt = now + 1.5; this.spawnedAt = now; this.resetDamage();
    this.fwd.copy(Z).applyQuaternion(this.quat); this.vdir.copy(this.fwd); this.sink = 0;
  }
  sync() { this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.quat); this.mesh.visible = this.alive; }
}

// ---------- damage model (after Home Skies 1917) ----------
// A hit costs airframe strength and also damages one system, each with its own effect on flying:
//   engine   -> less power; destroyed = no power, and it may catch fire
//   wings    -> sluggish roll, higher stall speed; badly damaged wings fold if dived too fast
//   fuel     -> the tank leaks; with no fuel the engine stops
//   controls -> weak elevator and rudder
// Fire burns the airframe away until it is blown out in a fast dive. An aircraft with no strength
// left is "going down": out of control and burning until it hits the ground.
export const ZONE_TEXT = {
  eng: ['Engine', 'Engine hit, losing power', 'Engine badly damaged'],
  wing: ['Wings', 'Wings holed, roll is sluggish', 'Wing spars damaged, keep the speed down'],
  fuel: ['Fuel tank', 'Fuel tank holed, losing fuel', 'Fuel pouring out'],
  ctl: ['Controls', 'Control wires hit', 'Controls badly damaged'],
};
// Apply one hit to an aircraft we own. Returns messages for its pilot.
export function takeHit(p, amount) {
  const msgs = [], r = Math.random(), a = 0.1 + Math.random() * 0.12, D = p.dmg;
  p.hp -= amount;
  const zone = z => { const was = D[z]; D[z] = Math.min(1, was + a); if (was <= 0.3 && D[z] > 0.3) msgs.push(ZONE_TEXT[z][1]); else if (was <= 0.75 && D[z] > 0.75) msgs.push(ZONE_TEXT[z][2]); };
  if (r < 0.3) { zone('eng'); if (D.eng >= 1 && !p.fire && Math.random() < 0.45) { p.fire = true; msgs.push('Engine on fire. Dive hard to blow it out.'); } }
  else if (r < 0.65) zone('wing'); else if (r < 0.8) zone('fuel'); else if (r < 0.95) zone('ctl');
  else { p.hp -= 8; msgs.push('Pilot wounded'); }
  return msgs;
}
// Engine, fuel and fire, run every frame for aircraft we own. Returns a reason if this brings the aircraft down.
export function systems(p, dt, msgs) {
  const t = TYPES[p.type], D = p.dmg;
  if (p.dying) { p.throttle = 0; D.eng = 1; p.fire = true; p.power = 0; return null; }
  const hadFuel = p.fuel > 0;
  p.fuel = Math.max(0, p.fuel - (0.0008 * p.throttle + 0.02 * D.fuel) * dt);
  if (hadFuel && p.fuel <= 0) msgs.push('Out of fuel');
  p.power = D.eng >= 1 || p.fuel <= 0 ? 0 : p.throttle * (1 - 0.7 * D.eng);
  if (p.fire) {
    p.hp -= 4 * dt;
    if (p.speed > t.top * 1.08) { p.fireT += dt; if (p.fireT > 1.5) { p.fire = false; msgs.push('The fire is out.'); } } else p.fireT = 0;
    if (p.hp <= 0) return 'Burned.';
  }
  if (D.wing > 0.8 && p.speed > t.top * 1.2) return 'The damaged wings folded.';
  return null;
}
export function startDying(p) {
  p.dying = true; p.dyRoll = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.3);
  p.fire = true; p.dmg.eng = 1; p.dmg.ctl = Math.max(p.dmg.ctl, 0.9); p.hp = Math.min(p.hp, 0); p.firing = false;
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
  const t = TYPES[p.type], q = p.quat, D = p.dmg, stall = t.stall * (1 + 0.35 * D.wing);
  if (p.dying) input = { pitch: -0.25, roll: p.dyRoll, yaw: 0, throttle: 0, throttleAbs: 0, fire: false };   // out of control
  p.throttle = input.throttleAbs != null ? input.throttleAbs : THREE.MathUtils.clamp(p.throttle + input.throttle * 0.7 * dt, 0, 1);
  // control surfaces lose authority as the aircraft slows
  const auth = THREE.MathUtils.clamp((p.speed - 6) / (stall * 1.3), 0.12, 1);
  q.multiply(q1.setFromAxisAngle(X, -input.pitch * t.pitch * (1 - 0.6 * D.ctl) * auth * dt));
  q.multiply(q1.setFromAxisAngle(Z, input.roll * t.roll * (1 - 0.6 * D.wing) * auth * dt));
  // rudder swings the nose and skids the flight path round with it, so it turns the aircraft flat without needing bank
  const rud = -input.yaw * 0.8 * (1 - 0.6 * D.ctl) * auth * dt;
  q.multiply(q1.setFromAxisAngle(Y, rud));
  p.vdir.applyAxisAngle(v3.copy(Y).applyQuaternion(q), rud * 0.75);
  // rightY > 0 means the right wing is high (banked left)
  const rightY = -v1.copy(X).applyQuaternion(q).y, upY = v2.copy(Y).applyQuaternion(q).y;
  // a banked aircraft turns: coordinated-turn rate g * bank / speed
  if (upY > 0) q.premultiply(q1.setFromAxisAngle(Y, rightY * 1.5 * G / Math.max(p.speed, 18) * dt));
  // lift: the flight path can only bend as fast as the wings can pull, which grows with the square of speed
  const n = Math.min(4.5, (p.speed / stall) * (p.speed / stall));
  if (n < 1) { p.sink = Math.min(11, p.sink + G * (1 - n) * dt); q.multiply(q1.setFromAxisAngle(X, 1.0 * (1 - n) * dt)); }   // stalled: sink and drop the nose
  else p.sink *= Math.exp(-2.5 * dt);
  if (p.dying) p.sink = Math.min(34, p.sink + 7 * dt);
  if (p.pos.y > CEILING) q.multiply(q1.setFromAxisAngle(X, 0.5 * dt));                                                       // thin air above the ceiling
  q.normalize(); p.fwd.copy(Z).applyQuaternion(q);
  const ang = p.vdir.angleTo(p.fwd), wmax = G * Math.max(0.15, n) / Math.max(p.speed, 8);
  if (ang > 1e-4) p.vdir.lerp(p.fwd, Math.min(1, wmax * dt / ang)).normalize();
  // (not in Home Skies) below stall speed gravity takes over the flight path, so a stalled aircraft falls, gains speed and recovers
  if (n < 1) { p.vdir.y -= (1 - n) * 0.9 * dt; p.vdir.normalize(); }
  // thrust, drag, weight along the flight path, and extra drag when the nose is pulled away from it
  p.speed += (p.power * KD * t.top * t.top - KD * p.speed * p.speed - 15.5 * p.vdir.y - Math.sin(Math.min(ang, 0.7)) * 26) * dt;
  p.speed = THREE.MathUtils.clamp(p.speed, 0, t.top * 1.5);
  p.pos.addScaledVector(p.vdir, p.speed * dt); p.pos.y -= p.sink * dt;
  p.firing = !!input.fire;
  return crashed(p);
}

// ---------- bot pilot: steers a direction vector toward its goal at a limited turn rate ----------
export function flyBot(p, planes, now, dt) {
  if (p.dying) {                                                    // spinning down out of control
    p.fwd.y = Math.max(-0.85, p.fwd.y - 0.5 * dt); p.fwd.normalize(); p.bank += 2.5 * dt * Math.sign(p.dyRoll || 1);
    p.fwd.applyAxisAngle(Y, 0.5 * dt * Math.sign(p.dyRoll || 1));
    p.quat.setFromRotationMatrix(m1.lookAt(p.fwd, ZERO, Y)).multiply(q1.setFromAxisAngle(Z, p.bank));
    p.speed = Math.min(TYPES[p.type].top * 1.2, p.speed + 12 * dt); p.vdir.copy(p.fwd); p.pos.addScaledVector(p.fwd, p.speed * dt); p.firing = false;
    return crashed(p);
  }
  const t = TYPES[p.type];
  const L = BOT_LEVELS[botSettings.level] || BOT_LEVELS[1];
  if (p.ai && p.ai.level !== botSettings.level) p.ai = null;            // difficulty changed: re-roll this pilot
  const ai = p.ai ??= { level: botSettings.level, skill: L.skill[0] + Math.random() * (L.skill[1] - L.skill[0]), patrol: new THREE.Vector3(), patrolAt: 0, jink: 0, aim: new THREE.Vector3() };
  // nearest living enemy
  let target = null, best = 650;
  for (const o of planes.values()) if (o.alive && !o.dying && o.team !== p.team) { const d = o.pos.distanceTo(p.pos); if (d < best) { best = d; target = o; } }
  const goal = v1;
  p.firing = false;
  if (target) {
    goal.copy(target.pos).addScaledVector(target.fwd, target.speed * best / GUN.speed);   // lead the shot
    goal.addScaledVector(ai.aim, best * L.spread * (1.4 - Math.min(1, ai.skill)));
    if (now > ai.jink) { ai.jink = now + 0.6 + Math.random(); ai.aim.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); }
    goal.sub(p.pos).normalize();
    if (best < 28) goal.y += 0.5;                                    // don't ram
    if (best < L.range && goal.dot(p.fwd) > L.cone && now > p.gunAt - 1) p.firing = true;
  } else {
    if (now > ai.patrolAt || ai.patrol.distanceTo(p.pos) < 60) { ai.patrolAt = now + 25; ai.patrol.set((Math.random() - 0.5) * 500, 150 + Math.random() * 120, (Math.random() - 0.5) * 800); }
    goal.copy(ai.patrol).sub(p.pos).normalize();
  }
  // steer clear of any aircraft about to be hit
  // break away from any aircraft on a collision course (closing fast, under ~1.3 s from contact)
  for (const o of planes.values()) {
    if (o === p || !o.alive) continue;
    const dist = v2.copy(o.pos).sub(p.pos).length(); if (dist > 120) continue;
    v2.divideScalar(dist || 1);
    const closing = v3.copy(p.fwd).multiplyScalar(p.speed).addScaledVector(o.fwd, -o.speed).dot(v2);
    if (dist < 16 || (closing > 0 && dist / closing < 1.3)) { goal.copy(v2).negate(); goal.y += p.id < o.id ? 0.9 : -0.5; goal.normalize(); p.firing = p.firing && dist > 40; break; }
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
  // damage: a dead engine means a glide down; holed wings and cut control wires slow the turn
  const D = p.dmg, dead = p.power <= 0;
  if (dead) { goal.y = Math.min(goal.y, -0.3); goal.normalize(); p.firing = false; }
  const rate = t.pitch * (0.55 + 0.35 * ai.skill) * (1 - 0.5 * Math.max(D.wing, D.ctl)), ang = p.fwd.angleTo(goal);
  const turnY = v3.crossVectors(p.fwd, goal).y;
  if (ang > 1e-4) p.fwd.lerp(goal, Math.min(1, rate * dt / ang)).normalize();
  p.fwd.y = THREE.MathUtils.clamp(p.fwd.y, -0.8, 0.8); p.fwd.normalize();
  p.bank += (THREE.MathUtils.clamp(-turnY * 2.4, -1.25, 1.25) - p.bank) * Math.min(1, 4 * dt);
  p.quat.setFromRotationMatrix(m1.lookAt(p.fwd, ZERO, Y)).multiply(q1.setFromAxisAngle(Z, p.bank));
  p.speed += ((t.top * (dead ? 0.6 : 0.86 * (1 - 0.3 * D.eng)) - 16 * p.fwd.y) - p.speed) * Math.min(1, 0.7 * dt);
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
