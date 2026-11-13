// Aircraft types, arcade flight model and bot pilot.
import * as THREE from 'three';
import { H, AIRFIELDS, HALF, HALF_X, SECTORS } from './world.js';
import { SPAD, ALBATROS } from './objects.js';
import { makeFlash } from './guns.js';

// One fighter per side for now; add entries here to add aircraft.
export const TYPES = {
  // top / stall in units per second, pitch / roll in radians per second at full control authority
  spad: { name: 'SPAD VII', team: 'it', build: SPAD, top: 58, stall: 19, pitch: 1.35, roll: 1.9, hp: 100 },             // faster, heavier on the stick
  albatros: { name: 'Albatros D.III', team: 'ah', build: ALBATROS, top: 52, stall: 16.5, pitch: 1.55, roll: 2.2, hp: 100 }, // slower, turns tighter
};
export const TEAM_TYPE = { it: 'spad', ah: 'albatros' };
export const TEAM_NAME = { it: 'Italy', ah: 'Austria-Hungary' };
export const TEAM_COLOR = { it: '#3d8bf0', ah: '#e2463b' };

// Bot difficulty presets. skill scales turn rate and steadiness of aim; range is how far they open fire;
// spread is how much their aim wanders; cone is how well lined up they must be before firing.
export const BOT_LEVELS = [
  // turn: share of the aircraft's turn rate they use; lead: how well they aim ahead of a moving target (1 = perfectly);
  // burst / pause: seconds firing, then seconds off the trigger
  { name: 'Rookie', skill: [0.1, 0.3], turn: 0.55, lead: 0.4, range: 90, spread: 0.15, cone: 0.998, burst: 0.6, pause: 1.8 },
  { name: 'Regular', skill: [0.5, 0.8], turn: 0.72, lead: 0.75, range: 125, spread: 0.08, cone: 0.9975, burst: 0.9, pause: 1.2 },
  { name: 'Ace', skill: [0.95, 1.1], turn: 0.95, lead: 1, range: 190, spread: 0.02, cone: 0.9955, burst: 2, pause: 0.3 },
];
export const botSettings = { level: 0 };   // rookie by default
// Take-off direction along each strip (+1 / -1 along its length) so both sides roll toward the front.
const RUNWAY_DIR = { it: 1, ah: -1 }, spawnCount = { it: 0, ah: 0 };
// Height of the aircraft's centre above the ground when its wheels are down. The wheels hang 1.51 below the centre and
// 1.6 ahead of it, so as the tail rises (tail = pitch in radians) they lower toward the full 1.51.
const gearHeight = tail => 1.51 * Math.cos(tail) - 1.6 * Math.sin(tail);
// Observation balloons: solid obstacles. Envelope and basket are treated as spheres, the cable as a line to the winch.
export const BALLOONS = SECTORS.map(s => { const gy = H(s.x, s.z); return { x: s.x, y: gy + s.alt, z: s.z, r: 10.5, basketY: gy + s.alt - 20, wx: s.x + 9, wy: H(s.x + 9, s.z + 7) + 2.5, wz: s.z + 7 }; });
// Set by a game mode: objective(p) -> what a bot should do, avoid(p) -> escape direction from a large obstacle,
// collide(pos) -> true if that point is inside one (the aircraft crashes).
export const hooks = { objective: null, avoid: null, collide: null };
export const COLLIDE_RADIUS = 4.2;
// Is (x, z) over this side's own airfield: the grass strip and the apron in front of the hangars?
export function overOwnField(team, x, z) {
  const f = AIRFIELDS[team], c = Math.cos(-f.rot), s = Math.sin(-f.rot), dx = x - f.x, dz = z - f.z;
  const along = dx * c - dz * s, across = dx * s + dz * c;          // the airfield's own frame (see spawn on the runway)
  return Math.abs(along) < 130 && across > -24 && across < 48;
}     // two aircraft closer than this have hit each other

export const GUN = { speed: 230, life: 1.5, interval: 0.09, damage: 3, hitRadius: 3.2 };
const CEILING = 480, G = 9.81, KD = 0.0055;   // drag coefficient; thrust is sized so level top speed = TYPES[..].top
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), ZERO = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m1 = new THREE.Matrix4();

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
    // the two guns on the nose fire in turn, each with its own flash
    this.muzzles = [new THREE.Vector3(-0.2, 0.64, 2.95), new THREE.Vector3(0.2, 0.64, 2.95)];
    this.flash = this.muzzles.map(m => { const f = makeFlash(0.55); f.position.copy(m); this.mesh.add(f); return f; });
    this.flashT = -9; this.flashSide = 0;
    this.rockets = 0; this.rocketMeshes = this.mesh.userData.rockets || []; this.rocketPos = this.mesh.userData.rocketPos || [];   // Le Prieur rockets left (0..8); the loaded ones show on the struts
    // control surfaces: ctl = stick positions (-1..1) for the player's own aircraft, otherwise worked out from how the aircraft is turning
    this.ctl = { pitch: 0, roll: 0, yaw: 0 }; this.shown = { pitch: 0, roll: 0, yaw: 0 }; this.live = false; this.surf = this.mesh.userData.ctl || null; this.prevQuat = new THREE.Quaternion();
  }
  get local() { return this.net === null; }
  // damage state: each zone runs 0 (sound) to 1 (destroyed)
  resetDamage() { this.dmg = { eng: 0, wingL: 0, wingR: 0, tail: 0, fuel: 0 }; this.fuel = 1; this.fire = false; this.fireT = 0; this.dying = false; this.dyRoll = 0; this.power = 0; this.smoke = false; }
  // Start in the air over the home airfield, or lined up on its runway.
  spawn(now, onRunway = false) {
    const f = AIRFIELDS[this.team], dir = RUNWAY_DIR[this.team];
    if (onRunway) {
      // six places in two rows at the downwind end of the strip, pointing along it toward the front
      const slot = spawnCount[this.team]++ % 6, along = (-88 + Math.floor(slot / 3) * 16) * dir, across = 14 + (slot % 3 - 1) * 9;
      const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
      this.pos.set(f.x + along * c + across * s, 0, f.z - along * s + across * c);
      this.pos.y = H(this.pos.x, this.pos.z) + gearHeight(0.19);
      this.heading = Math.PI / 2 - f.rot + (dir < 0 ? Math.PI : 0);
      this.quat.setFromAxisAngle(Y, this.heading).multiply(q1.setFromAxisAngle(X, -0.19));
      this.speed = 0; this.throttle = this.isBot ? 1 : 0; this.tail = 0.19;
    } else {
      const a = Math.random() * 6.28, r = 30 + Math.random() * 70;
      this.pos.set(f.x + Math.cos(a) * r, 0, f.z + Math.sin(a) * r);
      this.pos.y = H(this.pos.x, this.pos.z) + 70 + Math.random() * 40;
      this.quat.setFromAxisAngle(Y, Math.atan2(-this.pos.x, -this.pos.z + 60));   // nose toward the front
      this.speed = 42; this.throttle = 0.85;
    }
    this.onGround = onRunway; this.hp = TYPES[this.type].hp; this.alive = true; this.firing = false;
    this.lastHitBy = null; this.bank = 0; this.gunAt = now + 1.5; this.spawnedAt = now; this.resetDamage(); this.rockets = 0;                  // rockets are lost with the aircraft this.crashWhy = null; this.event = null; this.repairing = -9;
    this.fwd.copy(Z).applyQuaternion(this.quat); this.vdir.copy(this.fwd); this.sink = 0;
  }
  sync(dt = 1 / 60) { this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.quat); this.mesh.visible = this.alive; if (this.surf && this.alive) this.moveSurfaces(dt); for (let i = 0; i < this.rocketMeshes.length; i++) this.rocketMeshes[i].visible = i < this.rockets; this.prevQuat.copy(this.quat); }
  // Deflect the ailerons, elevator and rudder. They follow the stick when it is ours; for every other aircraft they follow the turning
  // it is doing (angular velocity in its own frame, from how its orientation changed this frame), which gives the same picture.
  moveSurfaces(dt) {
    const t = TYPES[this.type], c = this.ctl, s = this.shown, f = this.surf;
    if (!this.live && dt > 1e-4) {
      const rel = q2.copy(this.prevQuat).invert().multiply(this.quat), k = (rel.w < 0 ? -2 : 2) / dt;
      c.roll = THREE.MathUtils.clamp(rel.z * k / (t.roll * 0.8), -1, 1); c.pitch = THREE.MathUtils.clamp(-rel.x * k / (t.pitch * 0.8), -1, 1); c.yaw = THREE.MathUtils.clamp(-rel.y * k / 1.1, -1, 1);
    }
    const a = Math.min(1, 12 * dt);
    s.pitch += (c.pitch - s.pitch) * a; s.roll += (c.roll - s.roll) * a; s.yaw += (c.yaw - s.yaw) * a;
    const D = this.dmg, M = 0.55;
    f.ailL.rotation.x = -s.roll * M; f.ailR.rotation.x = s.roll * M;                       // roll right: left aileron down, right aileron up
    f.elev.rotation.x = s.pitch * M; f.rud.rotation.y = s.yaw * M;                         // pull back: elevator up; right rudder: trailing edge to the right (flipped per playtest)
    f.ailL.visible = D.wingL < 0.7; f.ailR.visible = D.wingR < 0.7; f.elev.visible = f.rud.visible = D.tail < 0.85;   // shot away
  }
}

// ---------- damage model (after Home Skies 1917, with hits located on the airframe) ----------
// Where a round strikes decides what it damages. Each zone runs 0 (sound) to 1 (destroyed):
//   engine      -> less power and an oil leak; badly hit it runs rough; destroyed = no power; it may catch fire
//   left wing   -> sluggish roll, higher stall speed, and the aircraft keeps rolling toward the damaged side;
//   right wing     a destroyed wing breaks away, and a badly damaged one folds in a fast dive
//   tail        -> weak elevator and rudder; destroyed = no control at all
//   fuel tank   -> leaks; with no fuel the engine stops
// Fire burns the airframe away until it is blown out in a fast dive. An aircraft that has lost a wing,
// its tail or all its strength is "going down": it noses over and spins into the ground.
export const ZONE_TEXT = {
  eng: ['Engine', 'Engine hit: losing power, oil on the windscreen', 'Engine badly damaged and running rough'],
  wingL: ['Left wing', 'Left wing holed: she wants to roll left', 'Left wing spars damaged, keep the speed down'],
  wingR: ['Right wing', 'Right wing holed: she wants to roll right', 'Right wing spars damaged, keep the speed down'],
  tail: ['Tail controls', 'Tail hit: elevator and rudder are weak', 'Tail controls barely answering'],
  fuel: ['Fuel tank', 'Fuel tank holed, losing fuel', 'Fuel pouring out'],
};
// Average damage one hit does to each zone. Rounds cost little airframe strength (GUN.damage), so an aircraft
// is usually crippled system by system before it is destroyed. Engine and tank fail soonest; the structural
// zones (wings, tail), whose loss is fatal, take the most punishment.
const ZONE_HIT = { eng: 0.14, fuel: 0.16, wingL: 0.085, wingR: 0.085, tail: 0.085 };
// Which part of the aircraft a round struck, from the strike point in the aircraft's own frame
// (x = toward the left wingtip, z = toward the nose). Returns a zone key, 'pilot' or 'body'.
export function zoneAt(x, z) {
  if (z > 1.3 && Math.abs(x) < 1.4) return 'eng';
  if (z < -1.0 && Math.abs(x) < 1.7) return 'tail';
  if (x > 0.9) return 'wingL';
  if (x < -0.9) return 'wingR';
  const r = Math.random(); return r < 0.5 ? 'fuel' : r < 0.65 ? 'pilot' : 'body';   // fuselage
}
// Apply one hit to an aircraft we own. Returns messages for its pilot.
export function takeHit(p, amount, where, scale = 1) {   // scale: 1 / toughness
  const msgs = [], D = p.dmg;
  if (!where) where = zoneAt((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  p.hp -= amount * scale;
  if (where === 'pilot') { p.hp -= 8 * scale; msgs.push('Pilot wounded'); return msgs; }
  if (where === 'body') return msgs;
  const a = ZONE_HIT[where] * scale * Math.sqrt(Math.max(1, amount / 3)) * (0.7 + Math.random() * 0.6), was = D[where]; D[where] = Math.min(1, was + a);
  if (was <= 0.3 && D[where] > 0.3) msgs.push(ZONE_TEXT[where][1]); else if (was <= 0.75 && D[where] > 0.75) msgs.push(ZONE_TEXT[where][2]);
  if (where === 'eng') {
    if (was < 1 && D.eng >= 1) msgs.push('Engine seized: no power');
    if (!p.fire && Math.random() < (D.eng >= 1 ? 0.45 : D.eng > 0.5 ? 0.12 : 0)) { p.fire = true; msgs.push('Engine on fire! Dive hard to blow it out.'); }
  }
  return msgs;
}
export const wingDamage = p => Math.max(p.dmg.wingL, p.dmg.wingR);
// Engine, fuel, fire and structural failure, run every frame for aircraft we own.
// Returns a reason if this brings the aircraft down.
export function systems(p, dt, msgs, now = 0) {
  const t = TYPES[p.type], D = p.dmg;
  if (p.dying) { p.throttle = 0; D.eng = 1; p.fire = true; p.power = 0; return null; }
  const hadFuel = p.fuel > 0;
  p.fuel = Math.max(0, p.fuel - (0.0008 * p.throttle + 0.02 * D.fuel) * dt);
  if (hadFuel && p.fuel <= 0) msgs.push('Out of fuel');
  p.power = D.eng >= 1 || p.fuel <= 0 ? 0 : p.throttle * (1 - 0.7 * D.eng);
  if (D.eng > 0.75 && p.power > 0) p.power *= 0.7 + 0.3 * Math.abs(Math.sin(now * 7) * Math.sin(now * 2.3));   // misfiring
  if (p.fire) {
    p.hp -= 4 * dt;
    if (p.speed > t.top * 1.08) { p.fireT += dt; if (p.fireT > 1.5) { p.fire = false; msgs.push('The fire is out.'); } } else p.fireT = 0;
    if (p.hp <= 0) return 'Burned.';
  }
  if (D.wingL >= 1 || D.wingR >= 1) return `The ${D.wingL >= 1 ? 'left' : 'right'} wing broke away.`;
  if (wingDamage(p) > 0.8 && p.speed > t.top * 1.2) return 'The damaged wings folded.';
  if (D.tail >= 1) return 'Tail shot away.';
  return null;
}
export function startDying(p) {
  p.dying = true; p.dyRoll = p.dmg.wingL > p.dmg.wingR ? 1 : p.dmg.wingR > p.dmg.wingL ? -1 : (Math.random() < 0.5 ? -1 : 1);   // spins toward the worse wing
  p.fire = true; p.dmg.eng = 1; p.hp = Math.min(p.hp, 0); p.firing = false;
}
// A doomed aircraft: the nose falls through to near vertical, it spins, and gravity takes it down fast.
function fallDying(p, dt) {
  const t = TYPES[p.type];
  p.fwd.copy(Z).applyQuaternion(p.quat);
  v1.set(p.fwd.x * 0.25, -1, p.fwd.z * 0.25).normalize();                         // where the nose is heading: almost straight down
  const ang = p.fwd.angleTo(v1);
  if (ang > 1e-3) { v2.copy(p.fwd).lerp(v1, Math.min(1, 1.3 * dt / ang)).normalize(); p.quat.premultiply(q1.setFromUnitVectors(p.fwd, v2)); }
  p.quat.multiply(q1.setFromAxisAngle(Z, p.dyRoll * 3.2 * dt)).normalize();        // spin
  p.fwd.copy(Z).applyQuaternion(p.quat);
  p.vdir.lerp(p.fwd, Math.min(1, 2.5 * dt)).normalize();
  p.speed = Math.min(t.top * 1.4, p.speed + (26 * Math.max(0.2, -p.vdir.y) - KD * 0.4 * p.speed * p.speed + 4) * dt);
  p.sink = Math.min(10, p.sink + 8 * dt);
  p.pos.addScaledVector(p.vdir, p.speed * dt); p.pos.y -= p.sink * dt;
  p.firing = false;
  return crashed(p);
}

// Returns a crash reason ('ground' | 'bounds') or null.
function crashed(p) {
  if (p.pos.y < Math.max(0.4, H(p.pos.x, p.pos.z) + 1)) return 'ground';
  if (hooks.collide && hooks.collide(p.pos)) return 'airship';
  for (const b of BALLOONS) {
    const dx = p.pos.x - b.x, dz = p.pos.z - b.z; if (dx * dx + dz * dz > 40 * 40) continue;
    if (p.pos.distanceToSquared(v1.set(b.x, b.y, b.z)) < b.r * b.r) return 'balloon';              // envelope
    if (p.pos.distanceToSquared(v1.set(b.x, b.basketY, b.z)) < 4 * 4) return 'balloon';            // basket
    // cable: closest point on the line from the basket down to the winch
    v1.set(b.wx - b.x, b.wy - b.basketY, b.wz - b.z); v2.set(p.pos.x - b.x, p.pos.y - b.basketY, p.pos.z - b.z);
    const u = THREE.MathUtils.clamp(v2.dot(v1) / v1.lengthSq(), 0, 1);
    if (v2.addScaledVector(v1, -u).lengthSq() < 1.8 * 1.8) return 'balloon';
  }
  if (Math.abs(p.pos.x) > HALF_X + 220 || Math.abs(p.pos.z) > HALF + 220) return 'bounds';
  return null;
}

// ---------- player flight options (Options > Flight) ----------
// All 1 = the standard model. They apply to the player's own aircraft only; bots always fly the standard one.
export const FLIGHT_DEFAULT = { invert: false, level: 0, pitch: 1, roll: 1, rudder: 1, stall: 1, top: 1, bleed: 1, tough: 1, turb: 1 };
export const flight = { ...FLIGHT_DEFAULT };
try { const s = JSON.parse(localStorage.getItem('woi-flight') || '{}'); for (const k in flight) if (typeof s[k] === typeof flight[k] && (typeof s[k] !== 'number' || Number.isFinite(s[k]))) flight[k] = s[k]; } catch { /* no storage */ }
export function setFlight(patch) {
  Object.assign(flight, patch);
  try { localStorage.setItem('woi-flight', JSON.stringify(flight)); } catch { /* no storage */ }
}

// ---------- on the runway (ground handling after Home Skies 1917) ----------
// steer = -1..1 left/right. Returns a crash reason or null; clears p.onGround at lift-off.
// Share of full thrust the engine gives on the ground. It has to be high enough that even a modest throttle (about 40%)
// reaches lift-off speed, otherwise the aircraft rolls on at a steady speed and refuses to leave the ground.
const GROUND_THRUST = 0.42;
function groundRoll(p, pitch, steer, input, dt) {
  const fo = input ? flight : FLIGHT_DEFAULT, t = TYPES[p.type], top = t.top * fo.top, takeoff = t.stall * fo.stall * 1.05 * (1 + 0.3 * wingDamage(p));      // lift-off speed: a little over the stall speed
  if (input) p.throttle = input.throttleAbs != null ? input.throttleAbs : THREE.MathUtils.clamp(p.throttle + input.throttle * 0.7 * dt, 0, 1);
  p.heading -= steer * 0.9 * dt * THREE.MathUtils.clamp(p.speed / 8, 0.15, 1);
  // the tail comes up as speed builds; holding the stick back keeps the skid dragging on the grass
  let td = THREE.MathUtils.clamp(1.6 - p.speed / (takeoff * 0.55), 0, 1); if (pitch > 0.3 && p.speed < takeoff) td = Math.max(td, 0.7);
  const drag = p.speed > 0.05 ? 0.7 + 1.7 * td * (p.power > 0.2 ? 0.25 : 1) : 0;
  p.speed = Math.max(0, p.speed + (p.power * KD * top * top * GROUND_THRUST - KD * p.speed * p.speed - drag) * dt);
  p.pos.x += Math.sin(p.heading) * p.speed * dt; p.pos.z += Math.cos(p.heading) * p.speed * dt;
  p.tail += (td * 0.19 - p.tail) * Math.min(1, 3 * dt);
  p.pos.y = H(p.pos.x, p.pos.z) + gearHeight(p.tail);
  p.quat.setFromAxisAngle(Y, p.heading).multiply(q1.setFromAxisAngle(X, -p.tail));
  p.fwd.copy(Z).applyQuaternion(p.quat); p.vdir.set(Math.sin(p.heading), 0, Math.cos(p.heading)); p.sink = 0;
  if (input) p.firing = !!input.fire;
  // unstick: at flying speed with the stick back, or fast under power (with the throttle closed after landing it stays down)
  if ((p.speed >= takeoff && pitch > 0.1 && td < 0.5) || (p.speed > takeoff * 1.4 && p.power > 0.5)) { p.onGround = false; p.liftTimer = 0.9; }      // just left the ground: touchdown is ignored for a moment
  if (p.pos.y < 1.2) return 'ground';                                                                    // rolled into the sea
  return Math.abs(p.pos.x) > HALF_X + 220 || Math.abs(p.pos.z) > HALF + 220 ? 'bounds' : null;
}

// Ground effect: close to the ground the wings ride a cushion of air, so the stall speed drops by up to 15%
// (the nearer, the more). It is what lets a slowing aircraft settle onto the runway instead of dropping out of the sky.
const groundEffect = p => { const a = p.pos.y - H(p.pos.x, p.pos.z); return a < 6 ? 0.85 + 0.15 * Math.max(0, a) / 6 : 1; };

// ---------- human pilot ----------
// Flight model ported from Home Skies 1917 (in-flight part, standard handling).
// input = { pitch, roll, yaw (-1..1), throttle (-1..1 change), throttleAbs (0..1 or null), fire }
export function flyPlayer(p, input, dt) {
  const t = TYPES[p.type], fo = flight, top = t.top * fo.top, q = p.quat, D = p.dmg, wing = wingDamage(p), stall = t.stall * fo.stall * (1 + 0.35 * wing) * groundEffect(p);
  p.liftTimer = Math.max(0, (p.liftTimer || 0) - dt);
  p.live = !p.dying; p.ctl.pitch = input.pitch; p.ctl.roll = input.roll; p.ctl.yaw = input.yaw;           // the control surfaces follow the stick
  if (p.onGround) return groundRoll(p, input.pitch, input.roll * 0.5 + input.yaw, input, dt);
  if (p.dying) return fallDying(p, dt);
  p.throttle = input.throttleAbs != null ? input.throttleAbs : THREE.MathUtils.clamp(p.throttle + input.throttle * 0.7 * dt, 0, 1);
  // control surfaces lose authority as the aircraft slows
  const auth = THREE.MathUtils.clamp((p.speed - 6) / (stall * 1.3), 0.12, 1);
  q.multiply(q1.setFromAxisAngle(X, -input.pitch * t.pitch * fo.pitch * (1 - 0.75 * D.tail) * auth * dt));
  // the less-damaged wing lifts more, so the aircraft keeps rolling toward the damaged side (negative = left)
  q.multiply(q1.setFromAxisAngle(Z, (input.roll * t.roll * fo.roll * (1 - 0.6 * wing) + (D.wingR - D.wingL) * 0.55) * auth * dt));
  // rudder swings the nose and skids the flight path round with it, so it turns the aircraft flat without needing bank
  const rud = -input.yaw * 0.8 * fo.rudder * (1 - 0.75 * D.tail) * auth * dt;
  q.multiply(q1.setFromAxisAngle(Y, rud));
  p.vdir.applyAxisAngle(v3.copy(Y).applyQuaternion(q), rud * 0.75);
  // rightY > 0 means the right wing is high (banked left)
  const rightY = -v1.copy(X).applyQuaternion(q).y, upY = v2.copy(Y).applyQuaternion(q).y;
  // a banked aircraft turns: coordinated-turn rate g * bank / speed
  if (upY > 0) q.premultiply(q1.setFromAxisAngle(Y, rightY * 1.5 * G / Math.max(p.speed, 18) * dt));
  // optional wing levelling: with the stick released the wings roll back toward level (strength fo.level, 0 = off)
  if (fo.level > 0 && Math.abs(input.roll) < 0.05 && upY > 0.2) q.multiply(q1.setFromAxisAngle(Z, rightY * 1.1 * fo.level * dt));
  // lift: the flight path can only bend as fast as the wings can pull, which grows with the square of speed
  const n = Math.min(4.5, (p.speed / stall) * (p.speed / stall));
  if (n < 1) p.sink = Math.min(11, p.sink + G * (1 - n) * dt);                                                              // stalled: sink
  else p.sink *= Math.exp(-2.5 * dt);
  if (p.pos.y > CEILING) q.multiply(q1.setFromAxisAngle(X, 0.5 * dt));                                                       // thin air above the ceiling
  q.normalize(); p.fwd.copy(Z).applyQuaternion(q);
  const ang = p.vdir.angleTo(p.fwd), wmax = G * Math.max(0.15, n) / Math.max(p.speed, 8);
  if (ang > 1e-4) p.vdir.lerp(p.fwd, Math.min(1, wmax * dt / ang)).normalize();
  // (not in Home Skies) below stall speed gravity takes over the flight path, so a stalled aircraft falls, gains speed and recovers
  if (n < 1) { p.vdir.y -= (1 - n) * 0.9 * dt; p.vdir.normalize(); }
  // weathercock: like a dart, the nose swings to point the way the aircraft is actually moving. It acts when
  // stalled (so the nose follows the falling flight path down) and whenever the nose is far off the path,
  // which stops the aircraft ever sliding along tail-first.
  const off = p.vdir.angleTo(p.fwd), swing = (n < 1 ? 1.2 * (1 - n) : 0) + (off > 0.9 ? 2.4 : 0);
  if (swing > 0 && off > 1e-3) { q.premultiply(q1.identity().slerp(q2.setFromUnitVectors(p.fwd, p.vdir), Math.min(1, swing * dt / off))).normalize(); p.fwd.copy(Z).applyQuaternion(q); }
  // thrust, drag, weight along the flight path, and extra drag when the nose is pulled away from it
  if (p.power <= 0) p.speed -= 2.5 * dt;                                    // a stopped propeller is a brake
  p.speed += (p.power * KD * top * top - KD * p.speed * p.speed - 15.5 * p.vdir.y - Math.sin(Math.min(ang, 0.7)) * 15 * fo.bleed) * dt;   // 15: how hard pulling the nose off the flight path bleeds speed (Home Skies used 26)
  p.speed = THREE.MathUtils.clamp(p.speed, 0, top * 1.5);
  p.pos.addScaledVector(p.vdir, p.speed * dt); p.pos.y -= p.sink * dt;
  p.firing = !!input.fire;
  // touchdown: the wheels reach the ground. Home Skies 1917 rules: gently, wings level, nose not down, not too fast
  const gy = H(p.pos.x, p.pos.z);
  const vs = p.vdir.y * p.speed - p.sink;                                       // vertical speed, negative = sinking
  // Just after lift-off, or while still climbing away, the wheels are near the ground but that is not a landing:
  // only an aircraft that is level or coming down onto the ground touches down. Never let it sink into the runway.
  if (p.liftTimer > 0 || vs >= 0.3) { if (p.pos.y < gy + gearHeight(0.02)) p.pos.y = gy + gearHeight(0.02); }
  else if (!p.dying && p.pos.y - 1.5 <= gy) {
    const slope = Math.hypot(H(p.pos.x + 3, p.pos.z) - H(p.pos.x - 3, p.pos.z), H(p.pos.x, p.pos.z + 3) - H(p.pos.x, p.pos.z - 3)) / 6;
    const why = gy < 0.6 ? 'Ditched in the sea' : p.fwd.y < -0.14 ? 'Nosed in' : vs < -5.2 ? 'Hit the ground too hard'
      : Math.abs(rightY) > 0.42 ? 'Cartwheeled on a wingtip' : p.speed > top * 0.9 ? 'Far too fast to land' : slope > 0.14 ? 'Ran into a hillside' : null;
    if (why) { p.crashWhy = why; return 'ground'; }
    p.onGround = true; p.heading = Math.atan2(p.fwd.x, p.fwd.z); p.sink = 0;
    p.tail = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(p.fwd.y, -1, 1)), 0, 0.19);
    p.pos.y = gy + gearHeight(p.tail);
    if (vs < -2.4) { p.hp -= (-vs - 2.4) * 6; p.dmg.tail = Math.min(1, p.dmg.tail + 0.1); p.event = 'Hard landing'; }
    else p.event = vs > -1.2 ? 'A fine landing' : 'Landed';
    return null;
  }
  return crashed(p);
}

// ---------- bot pilot: steers a direction vector toward its goal at a limited turn rate ----------
export function flyBot(p, planes, now, dt) {
  if (p.onGround) {                                                 // take-off run: full throttle, straight down the strip, then climb away
    const crash = groundRoll(p, p.speed > TYPES[p.type].stall * 1.1 ? 0.5 : 0, 0, null, dt);
    if (!p.onGround) { p.fwd.set(Math.sin(p.heading), 0.18, Math.cos(p.heading)).normalize(); p.bank = 0; }
    return crash;
  }
  if (p.dying) return fallDying(p, dt);
  const t = TYPES[p.type];
  const L = BOT_LEVELS[botSettings.level] || BOT_LEVELS[1];
  if (p.ai && p.ai.level !== botSettings.level) p.ai = null;            // difficulty changed: re-roll this pilot
  const ai = p.ai ??= { level: botSettings.level, skill: L.skill[0] + Math.random() * (L.skill[1] - L.skill[0]), patrol: new THREE.Vector3(), patrolAt: 0, jink: 0, aim: new THREE.Vector3() };
  // the mode's orders for this bot, if any: { engage: range for dogfighting, guard: { pos, r } enemies near it are
  // fair game too, leash: { pos, r } don't chase further than this from it, attack: an airship to strafe,
  // aimed(): whether the guns bear on it, goal: a point to fly to, low: a low run (less terrain clearance) }
  const obj = hooks.objective ? hooks.objective(p) : null, engage = obj ? obj.engage : 650;
  // nearest living enemy worth engaging
  let target = null, best = 1e9;
  for (const o of planes.values()) {
    if (!o.alive || o.dying || o.team === p.team) continue;
    const d = o.pos.distanceTo(p.pos);
    if ((d < engage || (obj?.guard && d < 900 && o.pos.distanceTo(obj.guard.pos) < obj.guard.r)) && d < best) { best = d; target = o; }
  }
  // on a leash: a bot with a job breaks off a chase that has dragged it too far from the job, unless the enemy is close
  if (target && obj?.leash && best > 70 && Math.hypot(p.pos.x - obj.leash.pos.x, p.pos.z - obj.leash.pos.z) > obj.leash.r) target = null;
  const goal = v1;
  p.firing = false;
  const fire = () => { if (now > (ai.burstEnd || 0) + L.pause) ai.burstEnd = now + L.burst * (0.6 + Math.random() * 0.8); p.firing = now < ai.burstEnd; };
  if (target) {
    goal.copy(target.pos).addScaledVector(target.fwd, target.speed * best / GUN.speed * L.lead);   // aim ahead of the target
    goal.addScaledVector(ai.aim, best * L.spread * (1.4 - Math.min(1, ai.skill)));
    if (now > ai.jink) { ai.jink = now + 0.6 + Math.random(); ai.aim.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); }
    goal.sub(p.pos).normalize();
    if (best < 28) goal.y += 0.5;                                    // don't ram
    if (best < L.range && goal.dot(p.fwd) > L.cone && now > p.gunAt - 1) fire();
  } else if (obj?.attack) {                                         // strafing run on an airship: aim at the hull and fire when lined up
    goal.copy(obj.attack.pos).sub(p.pos); const d = goal.length(); goal.divideScalar(d || 1);
    if (obj.aimed ? obj.aimed() : d < 300 && goal.dot(p.fwd) > 0.98) p.firing = true;           // a big target: hold the trigger while the guns bear on it
  } else if (obj?.goal) {
    goal.copy(obj.goal).sub(p.pos).normalize();
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
  // pull up or dive under an airship rather than fly into it
  const esc = hooks.avoid ? hooks.avoid(p) : null; if (esc) goal.copy(esc);
  // give the observation balloons and their cables a wide berth
  for (const b of BALLOONS) { const dx = p.pos.x - b.x, dz = p.pos.z - b.z, d2 = dx * dx + dz * dz; if (d2 < 45 * 45 && p.pos.y < b.y + 30) { const d = Math.sqrt(d2) || 1; goal.x += dx / d * 1.8; goal.z += dz / d * 1.8; } }
  // stay inside the map, below the ceiling, and off the mountains
  if (Math.abs(p.pos.x) > HALF_X - 20 || Math.abs(p.pos.z) > HALF - 20) goal.set(-p.pos.x, 0.1, -p.pos.z).normalize();
  if (p.pos.y > CEILING - 60) goal.y = Math.min(goal.y, -0.15);
  // terrain: look ahead and climb if the ground would come too close; a low capture run looks less far and accepts less clearance
  for (const look of obj?.low ? [1.2] : [1.2, 2.8]) {
    v2.copy(p.pos).addScaledVector(p.fwd, p.speed * look);
    if (v2.y < H(v2.x, v2.z) + (obj?.low ? 24 : 38)) { goal.set(p.fwd.x * 0.6, 1, p.fwd.z * 0.6); break; }
  }
  if (p.pos.y < H(p.pos.x, p.pos.z) + 30) goal.y = Math.max(goal.y, 0.7);
  goal.normalize();
  // turn toward the goal
  // damage: a dead engine means a glide down; holed wings and cut control wires slow the turn
  const D = p.dmg, dead = p.power <= 0;
  if (dead) { goal.y = Math.min(goal.y, -0.3); goal.normalize(); p.firing = false; }
  const rate = t.pitch * L.turn * (0.9 + 0.2 * Math.min(1, ai.skill)) * (1 - 0.5 * Math.max(D.wingL, D.wingR, D.tail)), ang = p.fwd.angleTo(goal);
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
