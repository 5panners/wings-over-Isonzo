// Wings over Isonzo — team air battles over the Isonzo Front map: Dogfight, or Zeppelin Front (see front.js).
import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { createDayNight } from './daynight.js';
import { buildObjects, updateWindows, updateNavLights } from './objects.js';
import { AIRFIELDS, SECTORS, riverX, HALF, HALF_X, H, coastZ, coastW, coastE } from './world.js';
import { Plane, TYPES, TEAM_TYPE, TEAM_NAME, TEAM_COLOR, GUN, BOT_LEVELS, botSettings, COLLIDE_RADIUS, overOwnField, flight, setFlight, FLIGHT_DEFAULT, ZONE_TEXT, zoneAt, takeHit, systems, startDying, flyPlayer, flyBot, flyRemote, hooks } from './plane.js';
import { updateFlags } from './flags.js';
import { createWeather, WEATHER } from './weather.js';
import { createFront, POINT, CELLS, CELL_HP, SIDE_NAME, NATION, TEAM_TINT, SHIP_LEN } from './front.js';
import { connect } from './net.js';
import { startSound, updateSound, updateOthers, toggleMute, setMuted, isMuted, CHANNELS, getVolume, setVolume, resetVolumes, previewSound, setRain, thunderSound, gunSound, cannonSound, crumpSound, captureJingle, lostJingle, boomSound, hitTakenSound, hitScoredSound } from './sound.js';
import { pollGamepad, updateControls, initControls, toggleControls, controlsOpen } from './gamepad.js';

const MAX_PER_TEAM = 6, SCORE_LIMIT = 30, RESPAWN = 5, SEND_HZ = 15;
const BOT_NAMES = { it: ['Ten. Rossi', 'Serg. Bianchi', 'Cap. Moretti', 'Ten. Ferrari', 'Serg. Conti', 'Ten. Galli'], ah: ['Lt. Huber', 'Fw. Novak', 'Hptm. Steiner', 'Lt. Horvath', 'Zgf. Bauer', 'Oblt. Kovacs'] };
const $ = id => document.getElementById(id);
const other = t => (t === 'it' ? 'ah' : 'it');

// ---------------- renderer & world ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
// ---- graphics options (Options > Graphics), remembered in the browser ----
const GFX_DEFAULT = { shadows: true, shadowDist: 300, scale: Math.min(1, 2 / devicePixelRatio) };   // scale: share of the screen's own resolution
const gfx = { ...GFX_DEFAULT };
try { Object.assign(gfx, JSON.parse(localStorage.getItem('woi-gfx') || '{}')); } catch { /* no storage */ }
renderer.setPixelRatio(Math.min(devicePixelRatio * gfx.scale, 4));
renderer.shadowMap.enabled = new URLSearchParams(location.search).get('shadows') !== '0';   // ?shadows=0 for slow machines
 renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 1, 12000);
const { sun, hemi, updateWater, clouds } = buildTerrain(scene);
const sky = createDayNight(scene, { sun, hemi });   // sky.tod = hour of day, sky.rate = clock speed
// weather: fair / overcast / rain / thunderstorm (or changeable); see weather.js
const weather = createWeather(scene, { sky, camera, clouds, fx: { light: (p, peak, life, range) => flashLight(p, peak, life, range, 2, '#cfe0ff'), thunder: (d, delay) => thunderSound(d, delay), rain: l => setRain(l) } });
buildObjects(scene).setMode({ map: false, rings: false, flights: [], lineup: false });
{ const s = sun.shadow.camera; s.near = 100; s.far = 4500; }   // its width is set every frame by sky.update
const hud = $('hud'), ctx = hud.getContext('2d');
function resize() {
  renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  hud.width = innerWidth; hud.height = innerHeight;
}
addEventListener('resize', resize); resize();
camera.position.set(-470, 300, 900); camera.lookAt(0, 40, -100);

// ---------------- effects: tracers and puffs ----------------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), V2 = new THREE.Vector3(), S3 = new THREE.Vector3(), Zax = new THREE.Vector3(0, 0, 1), COL = new THREE.Color();
const bullets = [], puffs = [];
const tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 4), new THREE.MeshBasicMaterial({ color: '#ffe27a', fog: false }), 500);
const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 400);
// glowing puffs (fireballs) are unlit so they stay bright at night
const glowMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ fog: false }), 120);
for (const m of [tracerMesh, puffMesh, glowMesh]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
// Flashes of light for explosions and muzzle flashes. Every light in the scene costs every surface a little, so
// there are only four, shared: a new flash takes a free one, else it displaces the weakest/farthest unless it is
// less important. Range and strength are set per flash (changing them does not rebuild any shaders).
const LIGHTS = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#ffc070', 0, 40, 2); Object.assign(l.userData, { t: 0, life: 1, peak: 0, fresh: false, prio: 0 }); scene.add(l); return l; });
function flashLight(pos, peak, life, range, prio, color = '#ffc070') {
  const d2 = pos.distanceToSquared(camera.position); if (prio < 2 && d2 > 280 * 280) return;
  let slot = null, worst = Infinity;
  for (const l of LIGHTS) {
    if (l.userData.t <= 0) { slot = l; worst = -Infinity; break; }
    const score = l.userData.prio * 1e9 - l.position.distanceToSquared(camera.position);          // lower = easier to displace
    if (score < worst) { worst = score; slot = l; }
  }
  if (worst > prio * 1e9 - d2) return;                                  // everything running is more important than this
  Object.assign(slot.userData, { t: life, life, peak, fresh: true, prio });
  slot.position.copy(pos); slot.distance = range; slot.color.set(color);
}
const muzzleLight = (pos, power = 1) => flashLight(pos, 140 * power, 0.07, 32, 1, '#ffcf80');
function puff(pos, color, size, life, rise = 2, spread = 0) {
  if (puffs.length >= 400) puffs.shift();
  puffs.push({ p: pos.clone().add(V2.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)), c: color, s: size, life, max: life, rise, glow: false });
  return puffs[puffs.length - 1];
}
function explode(pos) {
  boomSound(pos.distanceTo(camera.position));
  for (let i = 0; i < 12; i++) puff(pos, ['#fff2b0', '#ffc24a', '#ff8a2a'][i % 3], 3 + Math.random() * 5, 0.45 + Math.random() * 0.6, 4, 7).glow = true;   // fireball
  for (let i = 0; i < 20; i++) puff(pos, i % 4 ? '#2d2a28' : '#55504a', 2.5 + Math.random() * 4, 1.8 + Math.random() * 2.8, 3 + Math.random() * 3, 11);       // smoke
  for (let i = 0; i < 8; i++) puff(pos, '#3a2a1c', 0.5 + Math.random() * 0.5, 0.9 + Math.random() * 0.8, -14 - Math.random() * 10, 16);                         // falling debris
  flashLight(V2.copy(pos).setY(pos.y + 4), 3500, 0.45, 320, 2);
}

// ---------------- Zeppelin Front ----------------
const front = createFront(scene, {
  jingle: won => (won ? captureJingle() : lostJingle()),
  puff, explode, say: t => say(t), label: id => label(id), light: (p, power) => muzzleLight(p, power),
  shoot(origin, dir, side, real, spec) {               // airship gunners: real shells on the host, tracers everywhere else
    bullets.push({ p: origin.clone(), v: dir.clone().multiplyScalar(spec.speed), life: spec.life, by: 'air-' + side, team: side, real, shell: true, dmg: spec.dmg, r: spec.r });
    cannonSound(origin.distanceTo(camera.position)); if (real) shellStats.fired++;
  },
});
const shellStats = { fired: 0, hit: 0 };         // for tests: how many airship shells were fired, and how many struck an aircraft
const ROLES = ['capture', 'attack', 'hunt', 'escort'];      // bot n on each side takes ROLES[n % 4]
let mode = 'front';
function setMode(m) {
  mode = m === 'dogfight' ? 'dogfight' : 'front';
  front.setActive(mode === 'front'); $('front').style.display = mode === 'front' ? 'flex' : 'none';
}
setMode(mode);
hooks.collide = pos => mode === 'front' && front.collide(pos);
hooks.avoid = p => (mode === 'front' ? front.avoid(p) : null);
hooks.objective = p => (mode === 'front' && p.isBot ? front.objectiveFor(p, ROLES[(+p.id.split('-')[2] || 0) % ROLES.length]) : null);

// ---------------- game state ----------------
const planes = new Map();
const score = { it: 0, ah: 0 };
let heard = null;          // the latest settings message from a battle in progress, heard while joining
let onRunway = true;       // start (and restart) on the runway instead of in the air; the host's choice also applies to its bots
let me = null, net = null, teamSize = 4, roundEndAt = 0, nextSend = 0, nextBotCheck = 0, running = false, oobSince = 0;
const feed = [];
// The host runs the bots, the clock and the objectives. It is the flying player with the lowest id: a player still on
// the start screen does not count, so someone joining never takes over a battle before they have heard its state.
const flying = new Map();                                   // peer id -> when we last heard its aircraft
function hostId() {
  if (!net) return null;
  const t = now(), ids = [...net.peers].filter(id => flying.has(id) && t - flying.get(id) < 5);
  if (running) ids.push(net.id);
  return ids.sort()[0] ?? net.id;
}
const isHost = () => !net || hostId() === net.id;
let clockSkew = 0;
const now = () => performance.now() / 1000 + clockSkew;

function addPlane(id, name, team, type, owner, isBot) { const p = new Plane(id, name, team, type, owner, isBot); planes.set(id, p); scene.add(p.mesh); return p; }
function removePlane(p) { scene.remove(p.mesh); planes.delete(p.id); }
function say(text) { feed.unshift({ text, at: now() }); feed.length = Math.min(feed.length, 6); }
const isGunners = id => typeof id === 'string' && id.startsWith('air-');
const nameOf = id => (isGunners(id) ? `${SIDE_NAME[id.slice(4)] || ''} airship gunners` : planes.get(id)?.name.replace(/[<&]/g, ''));
const label = id => { const p = planes.get(id), team = p ? p.team : isGunners(id) ? id.slice(4) : null; return team && nameOf(id) ? `<b style="color:${TEAM_COLOR[team]}">${nameOf(id)}</b>` : 'someone'; };

function onKill(victimId, killerId, collidedWith) {
  const v = planes.get(victimId); if (!v) return;
  say(collidedWith === 'balloon' ? `${label(victimId)} flew into a balloon` : collidedWith === 'airship' ? `${label(victimId)} flew into an airship` : collidedWith ? `${label(victimId)} collided with ${label(collidedWith)}` : killerId && nameOf(killerId) ? `${label(killerId)} shot down ${label(victimId)}` : `${label(victimId)} crashed`);
  if (isHost() && !roundEndAt) { if (mode === 'front') front.tickets[v.team]--; else score[other(v.team)]++; }      // Front: every aircraft lost costs its side a ticket
}
// The functions below are only ever called by the peer that owns p.
// Tell everyone an aircraft is lost. Returns who is credited (an aircraft id) or null.
function announce(p, by, collidedWith, credit = true) {
  // credit goes to whoever delivered the fatal damage; for fire or structural failure, whoever hit it last within half a minute
  const killer = !credit || collidedWith ? null : by || (now() - p.lastHitAt < 30 ? p.lastHitBy : null);
  onKill(p.id, killer, collidedWith); net?.send({ t: 'k', v: p.id, by: killer, c: collidedWith });
  return killer;
}
function die(p, by, collidedWith) {           // destroyed outright: crash, collision, or a falling wreck reaching the ground
  if (!p.alive) return;
  if (!p.dying) {                                                 // a wreck that was already going down has been counted
    // flew into the ground, a balloon or another aircraft without a fatal hit from the enemy: that is a crash, whoever shot at it earlier
    announce(p, null, collidedWith, false);
    p.fate = collidedWith === 'balloon' ? 'Flew into a balloon' : collidedWith === 'airship' ? 'Flew into an airship' : collidedWith ? 'Collided' : p.crashWhy || 'Crashed';
  }
  p.alive = false; p.dying = false; p.firing = false; p.respawnAt = now() + RESPAWN; explode(p.pos);
}
function goDown(p, by, why) {                 // fatally hit: falls burning and out of control until it hits the ground
  if (!p.alive || p.dying) return;
  const killer = announce(p, by); startDying(p);
  p.fate = killer && nameOf(killer) ? 'Shot down by ' + nameOf(killer) : 'Crashed';
  if (p === me) say('Going down! ' + why);
}
function damage(p, amount, by, where) {
  if (!p.alive || p.dying) return;
  p.lastHitBy = by; p.lastHitAt = now();
  const msgs = takeHit(p, amount, where, p === me ? 1 / flight.tough : 1);
  if (p === me) { hitTakenSound(); msgs.forEach(say); }
  if (p.hp <= 0) goDown(p, by, 'Shot to pieces.');
}

// ---------------- networking ----------------
function packState() {
  const e = [];
  for (const p of planes.values()) if (p.local) e.push([p.id, p.name, p.team, p.type, +p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1), +p.quat.x.toFixed(3), +p.quat.y.toFixed(3), +p.quat.z.toFixed(3), +p.quat.w.toFixed(3), +p.speed.toFixed(1), Math.round(p.hp), (p.alive ? 1 : 0) | (p.firing ? 2 : 0) | (p.isBot ? 4 : 0) | (p.dying ? 8 : 0) | (p.fire ? 16 : 0) | (p.dmg.eng > 0.3 ? 32 : 0)]);
  const m = { t: 's', e };
  if (isHost()) { m.sc = [score.it, score.ah]; m.n = teamSize; m.d = [+sky.tod.toFixed(3), sky.rate]; m.b = botSettings.level; m.md = mode; m.wx = [weather.index, weather.auto ? 1 : 0]; if (mode === 'front') m.f = front.pack(); }
  return m;
}
function onMessage(m, from) {
  const t = now();
  if (m.t === 's') {
    flying.set(from, t);
    if (m.md && !running) heard = m;                         // settings of a battle already in progress (see start)
    for (const a of m.e) {
      const [id, name, team, type, x, y, z, qx, qy, qz, qw, speed, hp, flags] = a;
      if (id === me?.id || !TYPES[type]) continue;
      let p = planes.get(id);
      if (p && p.local) { if (isHost()) continue; }             // we are the authority for our own bots
      if (!p) { p = addPlane(id, String(name).slice(0, 20), team, type, from, !!(flags & 4)); p.pos.set(x, y, z); p.quat.set(qx, qy, qz, qw); }
      const n = p.net ??= { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fwd: new THREE.Vector3() };
      n.pos.set(x, y, z); n.quat.set(qx, qy, qz, qw).normalize(); n.fwd.copy(Zax).applyQuaternion(n.quat); n.speed = speed; n.at = t;
      const alive = !!(flags & 1); p.dying = !!(flags & 8); p.fire = !!(flags & 16); p.smoke = !!(flags & 32);
      if (p.alive && !alive) explode(p.pos);
      if (!p.alive && alive) { p.pos.copy(n.pos); p.quat.copy(n.quat); p.spawnedAt = t; }
      p.owner = from; p.alive = alive; p.firing = !!(flags & 2); p.hp = hp; p.speed = speed; p.seen = t; p.team = team;
    }
    if (m.sc && !isHost()) {
      score.it = m.sc[0]; score.ah = m.sc[1]; teamSize = m.n; if (m.b != null) botSettings.level = THREE.MathUtils.clamp(m.b | 0, -1, BOT_LEVELS.length - 1);
      if ((m.md === 'front' || m.md === 'dogfight') && m.md !== mode) setMode(m.md);    // the host's mode is everyone's mode
      if (m.f && mode === 'front') front.unpack(m.f, t);
      if (m.wx) weather.follow(m.wx[0]);                                         // the host's weather is everyone's weather
      if (m.d) { sky.rate = +m.d[1] || 0; const off = Math.abs(sky.tod - m.d[0]); if (Math.min(off, 24 - off) > 0.03) sky.tod = +m.d[0] || 0; }   // the host's clock is everyone's clock
    }
  } else if (m.t === 'x') {                                   // someone's bullet hit a plane we own
    const p = planes.get(m.to); if (p && p.local) damage(p, Math.min(+m.d || 0, 40), m.by, ['eng', 'wingL', 'wingR', 'tail', 'fuel', 'pilot', 'body'].includes(m.z) ? m.z : undefined);
  } else if (m.t === 'k') onKill(m.v, m.by, m.c);
  else if (m.t === 'zx' && isHost() && mode === 'front') front.damage(m.s, m.c | 0, Math.min(+m.d || 0, 25), m.by);   // a player's rounds struck an airship
}
function onLeave(id) { flying.delete(id); for (const p of [...planes.values()]) if (p.owner === id && !p.local) { if (!p.isBot) say(`${label(p.id)} left`); removePlane(p); } }

// ---------------- bots (run by the host) ----------------
function manageBots() {
  if (!isHost()) { for (const p of [...planes.values()]) if (p.isBot && p.local) removePlane(p); return; }
  for (const team of ['it', 'ah']) {
    let humans = 0; for (const p of planes.values()) if (!p.isBot && p.team === team) humans++;
    const want = botSettings.level < 0 ? 0 : Math.max(0, teamSize - humans);      // level -1 = no bots
    for (let i = 0; i < MAX_PER_TEAM; i++) {
      const id = `bot-${team}-${i}`, p = planes.get(id);
      if (i < want) {
        if (!p) addPlane(id, BOT_NAMES[team][i], team, TEAM_TYPE[team], net?.id || 'solo', true).respawnAt = now() + i * 0.7;
        else if (!p.local) { p.net = null; p.owner = net?.id || 'solo'; p.respawnAt = Math.max(p.respawnAt, now() + 1); }   // took over from an old host
      } else if (p) removePlane(p);
    }
  }
}

// ---------------- input ----------------
const keys = new Set(); let mouseFire = false;
addEventListener('keydown', e => { if (e.code === 'Escape' && running) { toggleControls(); if (controlsOpen()) showLiveSetup(); return; } if (controlsOpen()) return; startSound(); if (running && (e.code === 'Comma' || e.code === 'Period')) { setCamEase(camEase + (e.code === 'Period' ? 0.1 : -0.1)); say(`Camera smoothing ${Math.round(camEase * 100)}%`); } if (e.code === 'KeyM' && running) { say(toggleMute() ? 'Sound off' : 'Sound on'); $('aud-mute').checked = isMuted(); }
  if (running && (e.code === 'BracketLeft' || e.code === 'BracketRight')) { if (isHost()) { sky.tod = (sky.tod + (e.code === 'BracketRight' ? 1 : 23)) % 24; say('Time set to ' + sky.clock()); } else say('Only the host can change the time'); }
  keys.add(e.code); if (running && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseFire = false; });
$('c').addEventListener('mousedown', () => { startSound(); mouseFire = true; }); addEventListener('mouseup', () => mouseFire = false);
const k = (...c) => c.some(x => keys.has(x)) ? 1 : 0;
const clamp1 = v => Math.max(-1, Math.min(1, v));
function readInput() {                                        // keyboard and controller add together
  const g = pollGamepad();
  return {
    pitch: clamp1(k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp') + g.pitch) * (flight.invert ? -1 : 1),       // S / down arrow / stick back pulls the nose up (reversed if inverted)
    roll: clamp1(k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + g.roll),
    yaw: clamp1(k('KeyE') - k('KeyQ') + g.yaw),
    throttle: clamp1(k('ShiftLeft', 'ShiftRight') - k('ControlLeft', 'KeyC') + g.throttle),
    throttleAbs: g.throttleAbs,
    fire: k('Space') || mouseFire || g.fire,
  };
}

// ---------------- main loop ----------------
let last = now();
function frame() {
  requestAnimationFrame(frame);
  const t = now(), dt = Math.min(0.05, t - last); last = t;
  if (running && !window.__woi.freeze) step(t, dt);   // freeze: test hook to hold the simulation still
  else if (!running && mode === 'front') front.update(dt, t, { host: true, planes, level: botSettings.level, frozen: true });   // airships drift past behind the start screen
  updateControls();
  if (me) {
    updateSound(running && me.alive, me.power, me.speed, TYPES[me.type].top);
    // other aircraft's engines: volume by distance, left/right by where they are, pitch by Doppler shift.
    // SOUND_SPEED is lower than real (340) so the pitch drop of a pass is easy to hear.
    const SOUND_SPEED = 200, list = [], live = running && me.alive;
    V2.set(1, 0, 0).applyQuaternion(camera.quaternion);                                  // listener's right
    for (const p of planes.values()) {
      if (p === me || !p.alive || !running) continue;
      V.copy(p.pos).sub(live ? me.pos : camera.position); const dist = V.length(); if (dist > 450) continue;
      V.divideScalar(dist || 1);                                                         // unit vector from listener to source
      const vl = live ? me.vdir.dot(V) * me.speed : 0, vs = p.fwd.dot(V) * p.speed;       // each one's speed along that line
      list.push({ id: p.id, dist, doppler: THREE.MathUtils.clamp((SOUND_SPEED + vl) / (SOUND_SPEED + vs), 0.55, 1.9), pan: THREE.MathUtils.clamp(V.dot(V2), -1, 1) * 0.8 });
    }
    updateOthers(list);
  }
  updateEffects(dt);
  updateFlags(t, dt);
  updateWindows(sky.night, sky.tod);
  updateNavLights(sky.night, t);
  updateWater(t, sun, hemi);
  weather.update(dt, t, isHost(), me && me.alive ? V2.copy(me.vdir).multiplyScalar(me.speed) : V2.set(0, 0, 0));
  updateCamera(dt);
  renderer.render(scene, camera);
  drawHud(t);
}
function step(t, dt) {
  if (t > nextBotCheck) { nextBotCheck = t + 1; manageBots(); }
  for (const p of planes.values()) {
    if (!p.local) {                                           // remote: interpolate, drop if silent
      flyRemote(p, t, dt);
      if (t - p.seen > 4) { removePlane(p); continue; }
    } else if (p.alive) {
      const msgs = [], why = systems(p, dt, msgs, t);                  // engine, fuel, fire
      if (p === me) msgs.forEach(say);
      if (why) goDown(p, null, why);
      const crash = p === me ? flyPlayer(p, readInput(), dt) : flyBot(p, planes, t, dt);
      if (p.event) { if (p === me) say(p.event + (overOwnField(p.team, p.pos.x, p.pos.z) ? '. Roll to a stop to repair and refuel' : '')); p.event = null; }
      if (p === me && !p.onGround && !p.dying && weather.turbulence > 0.01) {                      // rough air: the aircraft is shaken about, as in Home Skies 1917
        const tb = weather.turbulence * flight.turb * dt;
        p.quat.multiply(TB1.setFromAxisAngle(Zax, (Math.sin(t * 1.7) + Math.sin(t * 4.3 + 1)) * 0.22 * tb)).multiply(TB2.setFromAxisAngle(XAX, (Math.sin(t * 2.3 + 2) + Math.sin(t * 5.1)) * 0.12 * tb)); p.quat.normalize();
      }
      if (!crash) repair(p, t, dt);                               // ground crews at your own airfield
      if (crash) die(p, null, crash === 'balloon' || crash === 'airship' ? crash : undefined);
      else if (t - p.spawnedAt > 3 && !p.dying && !p.onGround) {                           // mid-air collision: each owner destroys its own aircraft
        for (const o of planes.values()) if (o !== p && o.alive && !o.onGround && t - (o.spawnedAt || 0) > 3 && o.pos.distanceToSquared(p.pos) < COLLIDE_RADIUS * COLLIDE_RADIUS) { die(p, null, o.id); if (o.local) die(o, null, p.id); break; }
      }
    } else if (t > p.respawnAt && !roundEndAt) p.spawn(t, onRunway);
    // guns: real bullets for planes we own, cosmetic tracers for everyone else
    if (p.alive && p.firing && t >= p.gunAt) {
      p.gunAt = t + GUN.interval;
      V.copy(p.fwd).multiplyScalar(GUN.speed + p.speed).add(V2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
      gunSound(p.pos.distanceTo(camera.position), p === me);
      const side = p.flashSide ^= 1, origin = BE.copy(p.muzzles[side]).applyQuaternion(p.quat).add(p.pos);   // rounds leave from the muzzles, alternately
      bullets.push({ p: origin.clone(), v: V.clone(), life: GUN.life, by: p.id, team: p.team, real: p.local });
      p.flashT = t; p.flash[side].rotation.z = Math.random() * 6.28; p.flash[side].scale.setScalar(0.4 + Math.random() * 0.3);
      muzzleLight(origin, p === me ? 1 : 0.8);
    }
    if (p.alive) {                                             // smoke, flame and fuel vapour show the damage
      const eng = p.local ? p.dmg.eng : (p.smoke ? 0.5 : 0), k = p === me ? 0.5 : 1;   // our own trail is kept small so it does not blot out the view
      if (eng > 0.3 && Math.random() < dt * 14) puff(p.pos, '#2a1c10', 0.45 * k, 0.9, -1.5, 0.3);                          // thin dark stream of oil
      if (eng > 0.75 && Math.random() < dt * 14) puff(p.pos, '#2b2927', 1.0 * k, 1.5 * k, 1.5, 0.6);                      // heavy smoke
      if (p.fire && Math.random() < dt * 22) puff(p.pos, Math.random() < 0.6 ? '#ff8a2a' : '#2b2927', 1.1 * k, 0.7 * k, 2.5, 0.9);
      if (p.local && p.dmg.fuel > 0.3 && p.fuel > 0 && Math.random() < dt * 9) puff(p.pos, '#e9eef2', 0.6, 1.0, 0.5, 0.4);
    }
    p.sync(dt);
    for (let k = 0; k < 2; k++) p.flash[k].visible = p.alive && p.flashSide === k && t - p.flashT < 0.05;       // each flash shows for a moment after its shot
  }
  if (mode === 'front') front.update(dt, t, { host: isHost(), planes, myTeam: me?.team, level: botSettings.level, frozen: !!roundEndAt });
  // bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.life -= dt;
    V.copy(b.v).multiplyScalar(dt);
    let hit = null, where = null;
    if (b.real) for (const p of planes.values()) {
      if (!p.alive || p.dying || p.team === b.team) continue;
      // closest approach of this frame's bullet segment to the plane
      V2.copy(p.pos).sub(b.p); const u = THREE.MathUtils.clamp(V2.dot(V) / V.lengthSq(), 0, 1);
      const rad = b.r ?? GUN.hitRadius;
      if (V2.addScaledVector(V, -u).lengthSq() < rad * rad) {
        hit = p;
        // where it struck: a point between where the round entered the aircraft's space and its closest pass,
        // in the aircraft's own frame, so shots from astern find the tail and head-on shots the engine
        const back = Math.sqrt(Math.max(0, rad * rad - V2.lengthSq())) * Math.random();
        V2.copy(b.p).addScaledVector(V, u).addScaledVector(S3.copy(V).normalize(), -back).sub(p.pos).applyQuaternion(Q.copy(p.quat).invert());
        where = zoneAt(V2.x, V2.z); break;
      }
    }
    if (!hit && mode === 'front') {                            // rounds striking an airship (any tracer stops on the hull; only real ones do damage)
      const fh = front.hitTest(b.p, BE.copy(b.p).add(V), b.team);
      if (fh) {
        puff(BE, '#ffd36b', 1, 0.3, 0, 2);
        if (b.real) {
          if (isHost()) front.damage(fh.side, fh.cell, GUN.damage, b.by); else net?.send({ t: 'zx', s: fh.side, c: fh.cell, d: GUN.damage, by: b.by }, hostId());
          if (b.by === me?.id) { hitFlash = t + 0.12; hitScoredSound(); }
        }
        bullets.splice(i, 1); continue;
      }
    }
    b.p.add(V);
    if (hit) {
      puff(hit.pos, '#ffd36b', 0.8, 0.25, 0, 2); if (b.shell) shellStats.hit++;
      if (hit.local) damage(hit, b.dmg ?? GUN.damage, b.by, where); else net?.send({ t: 'x', to: hit.id, by: b.by, d: b.dmg ?? GUN.damage, z: where }, hit.owner);
      if (b.by === me?.id) { hitFlash = t + 0.12; hitScoredSound(); }
    }
    if (hit || b.life <= 0) { if (b.shell) shellBurst(b.p, !!hit); bullets.splice(i, 1); }
  }
  // round end: the host decides, everyone else follows the score it sends
  if (isHost()) {
    if (!roundEndAt && winner()) roundEndAt = t + 8;
    if (roundEndAt && t > roundEndAt) { score.it = score.ah = 0; if (mode === 'front') front.reset(); roundEndAt = 0; for (const p of planes.values()) if (p.local) { p.alive = false; p.respawnAt = t + 1; } }
  } else roundEndAt = winner() ? 1 : 0;
  // out of bounds warning
  const out = me.alive && (Math.abs(me.pos.x) > HALF_X || Math.abs(me.pos.z) > HALF);
  oobSince = out ? (oobSince || t) : 0;
  if (net && t > nextSend) { nextSend = t + 1 / SEND_HZ; net.send(packState()); }
}
let hitFlash = 0;
// Ground crews at your own airfield: rolled out and nearly stopped, they repair and refuel quickly; still rolling,
// or on a low pass over the strip (under 20 m above it), more slowly.
const REPAIR_FAST = 0.4, REPAIR_SLOW = 0.15, LOW_PASS = 20;     // share of full health restored per second
function repair(p, t, dt) {
  if (!p.alive || p.dying || !overOwnField(p.team, p.pos.x, p.pos.z)) return;
  if (!p.onGround && p.pos.y - H(p.pos.x, p.pos.z) > LOW_PASS) return;
  const rate = (p.onGround && p.speed < 6 ? REPAIR_FAST : REPAIR_SLOW) * dt, max = TYPES[p.type].hp, D = p.dmg;
  const needed = p.hp < max || p.fuel < 1 || p.fire || Object.values(D).some(v => v > 0);
  if (!needed) { if (p === me && p.repairing > 0 && t - p.repairing < 0.5) say('Repairs complete'); p.repairing = -9; return; }
  p.hp = Math.min(max, p.hp + max * rate); p.fuel = Math.min(1, p.fuel + rate);
  for (const z in D) D[z] = Math.max(0, D[z] - rate);
  if (p.onGround) p.fire = false;                                           // the crew put the fire out
  p.repairing = t;
}
const BE = new THREE.Vector3(), TB1 = new THREE.Quaternion(), TB2 = new THREE.Quaternion(), XAX = new THREE.Vector3(1, 0, 0);
// a shell going off: a dark flak puff with a hot centre, bigger and brighter if it struck something
function shellBurst(pos, struck) {
  for (let i = 0; i < (struck ? 6 : 4); i++) puff(pos, i % 3 ? '#2d2a28' : '#55504a', 2 + Math.random() * 2.5, 1.2 + Math.random() * 1.4, 1.5, 5);
  for (let i = 0; i < 3; i++) puff(pos, i ? '#ffb040' : '#fff2b0', 2 + Math.random() * 2, 0.18 + Math.random() * 0.15, 1, 3).glow = true;
  const d = pos.distanceTo(camera.position); if (d < 260) crumpSound(d);
  if (struck) flashLight(pos, 220, 0.12, 45, 1);
}
// the side that has won the round, or null
function winner() {
  if (mode === 'front') return front.tickets.it <= 0 ? 'ah' : front.tickets.ah <= 0 ? 'it' : null;
  return Math.max(score.it, score.ah) >= SCORE_LIMIT ? (score.it > score.ah ? 'it' : 'ah') : null;
}

function updateEffects(dt) {
  let n = 0;
  for (const b of bullets) { if (n >= 500) break; Q.setFromUnitVectors(Zax, V.copy(b.v).normalize()); const sc = b.shell ? 3 : 1; tracerMesh.setMatrixAt(n++, M4.compose(b.p, Q, S3.set(sc, sc, sc))); }
  tracerMesh.count = n; tracerMesh.instanceMatrix.needsUpdate = true;
  n = 0; let g = 0;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const f = puffs[i]; f.life -= dt; if (f.life <= 0) { puffs.splice(i, 1); continue; }
    f.p.y += f.rise * dt; const a = f.life / f.max, s = f.s * (1.6 - a) * Math.min(1, a * 3);
    M4.compose(f.p, Q.identity(), S3.set(s, s, s));
    if (f.glow) { if (g < 120) { glowMesh.setMatrixAt(g, M4); glowMesh.setColorAt(g++, COL.set(f.c)); } }
    else { puffMesh.setMatrixAt(n, M4); puffMesh.setColorAt(n++, COL.set(f.c)); }
  }
  glowMesh.count = g; glowMesh.instanceMatrix.needsUpdate = true; if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  // flash: full brightness at once, then a quick fade
  for (const l of LIGHTS) {                                             // full strength on the first frame, then a quick fade
    const u = l.userData; if (u.fresh) u.fresh = false; else u.t = Math.max(0, u.t - dt);
    const a = u.t / u.life; l.intensity = u.peak * a * a;
  }
  puffMesh.count = n; puffMesh.instanceMatrix.needsUpdate = true; if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
}

// Chase camera as in Home Skies 1917: follows behind and above, and always keeps the horizon level.
const camLook = new THREE.Vector3();
let cine = false;                      // true while the going-down shot is running
let camEase = 0.45;                    // 0 = camera locked tight to the aircraft, 1 = very lazy
try { const v = parseFloat(localStorage.getItem('woi-camease')); if (v >= 0 && v <= 1) camEase = v; } catch { /* no storage */ }
function setCamEase(v) { camEase = THREE.MathUtils.clamp(v, 0, 1); try { localStorage.setItem('woi-camease', camEase); } catch { /* no storage */ } $('camease').value = Math.round(camEase * 100); $('camease-out').textContent = Math.round(camEase * 100) + '%'; }
function updateCamera(dt) {
  camera.up.set(0, 1, 0);
  if (!me) { const a = now() * 0.03; camera.position.set(Math.sin(a) * 900, 380, 300 + Math.cos(a) * 700); camera.lookAt(0, 40, -80); }
  else if (me.alive && me.dying) {
    // cinematic: a fixed camera set ahead of and beside the falling aircraft watches it come down past the lens
    if (!cine || camera.position.distanceToSquared(me.pos) > 110 * 110) {
      cine = true;
      V2.set(-me.vdir.z, 0, me.vdir.x); if (V2.lengthSq() < 0.01) V2.set(1, 0, 0); V2.normalize();           // level direction across the flight path
      V.copy(me.pos).addScaledVector(me.vdir, me.speed * 0.9).addScaledVector(V2, (Math.random() < 0.5 ? -1 : 1) * 16); V.y += 3;
      V.y = Math.max(V.y, H(V.x, V.z) + 2.5); camera.position.copy(V);
    }
    camLook.lerp(me.pos, 1 - Math.exp(-10 * dt)); camera.lookAt(camLook);
  }
  else if (me.alive) {
    V.copy(me.pos).addScaledVector(me.fwd, -14); V.y += 4.6;       // offset uses world up only, so rolling never moves the view
    V.y = Math.max(V.y, H(V.x, V.z) + 1.5);                       // never let the camera sink into a hillside
    // both where the camera sits and where it looks ease toward their targets; camEase sets how lazily
    const k = 16 * Math.pow(0.12, camEase);
    if (camera.position.distanceToSquared(V) > 150 * 150) { camera.position.copy(V); camLook.copy(me.pos).addScaledVector(me.fwd, 25); }   // respawned: jump, don't swoop
    camera.position.lerp(V, 1 - Math.exp(-k * dt));
    camLook.lerp(V.copy(me.pos).addScaledVector(me.fwd, 25), 1 - Math.exp(-k * 1.5 * dt));
    camera.lookAt(camLook);
  } else camera.lookAt(camLook.lerp(me.pos, 1 - Math.exp(-3 * dt)));                // wreck: hold the shot on the crash
  // cinematic framing: tighter lens and letterbox bars while going down and until the respawn
  const wantCine = !!me && (me.dying || (cine && !me.alive));
  if (!wantCine) cine = false;
  const fov = wantCine ? 38 : 62;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-6 * dt)); camera.updateProjectionMatrix(); }
  document.body.classList.toggle('cine', wantCine);
  // advance the clock; this also keeps the shadow map centred on the aircraft, and tight around it when low
  // so that its shadow on the ground is crisp
  const c = me ? me.pos : V.set(0, 0, 0);
  sky.update(dt, c, camera, me ? THREE.MathUtils.clamp(60 + (me.pos.y - H(me.pos.x, me.pos.z)) * 4, 60, Math.max(60, gfx.shadowDist)) : gfx.shadowDist);
}

// ---------------- HUD ----------------
// fixed oil-spatter pattern: [x, y, size, squash, tilt], kept away from the gunsight in the middle
const OIL = Array.from({ length: 16 }, (_, i) => { const a = i * 2.4, r = 0.24 + ((i * 37) % 10) / 40; return [0.5 + Math.cos(a) * r * 1.25, 0.5 + Math.sin(a) * r, 0.025 + ((i * 53) % 7) / 140, 0.5 + ((i * 29) % 5) / 8, a]; });
function drawHud(t) {
  const W = hud.width, Hh = hud.height; ctx.clearRect(0, 0, W, Hh);
  if (!me) return;
  const proj = v => { V.copy(v).project(camera); return V.z < 1 ? [(V.x + 1) / 2 * W, (1 - V.y) / 2 * Hh] : null; };
  ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const p of planes.values()) {
    if (p === me || !p.alive) continue;
    const d = p.pos.distanceTo(me.pos); if (d > 900) continue;
    const s = proj(p.pos);
    if (!s || s[0] < 0 || s[0] > W || s[1] < 0 || s[1] > Hh) {
      // out of view: an arrow on a ring round the screen centre points toward the aircraft
      if (me.dying) continue;
      V.copy(p.pos).applyMatrix4(camera.matrixWorldInverse);                  // camera space: x right, y up, -z ahead
      const a = Math.atan2(-V.y, V.x), R = Math.min(W, Hh) * 0.4, ax = W / 2 + Math.cos(a) * R, ay = Hh / 2 + Math.sin(a) * R;
      const foe = p.team !== me.team, size = (foe ? 15 : 11) * (1.25 - 0.5 * Math.min(1, d / 900));   // nearer aircraft get bigger arrows
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a); ctx.globalAlpha = foe ? 0.95 : 0.7;
      ctx.fillStyle = TEAM_COLOR[p.team]; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.62); ctx.lineTo(-size * 0.3, 0); ctx.lineTo(-size * 0.7, -size * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (foe) { ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(`${Math.round(d)} m`, ax - Math.cos(a) * 28, ay - Math.sin(a) * 28 + 4); ctx.shadowBlur = 0; }
      continue;
    }
    const foe = p.team !== me.team; ctx.strokeStyle = ctx.fillStyle = TEAM_COLOR[p.team]; ctx.lineWidth = 2;
    ctx.beginPath(); if (foe) { ctx.moveTo(s[0], s[1] - 9); ctx.lineTo(s[0] + 9, s[1]); ctx.lineTo(s[0], s[1] + 9); ctx.lineTo(s[0] - 9, s[1]); ctx.closePath(); } else ctx.arc(s[0], s[1], 8, 0, 6.3);
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(`${p.name}  ${Math.round(d)} m`, s[0], s[1] - 15);   // one unit = one metre at aircraft scale, the same scale the airspeed uses ctx.shadowBlur = 0;
  }
  if (mode === 'front') {                                     // airships and Gradisca: a marker in view, an arrow at the edge out of view
    const mark = (pos, color, text, kind) => {
      const d = pos.distanceTo(me.pos), s = proj(pos);
      if (s && s[0] > 0 && s[0] < W && s[1] > 0 && s[1] < Hh) {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
        if (kind === 'ship') ctx.ellipse(s[0], s[1], 17, 6, 0, 0, 6.3); else { ctx.moveTo(s[0], s[1] + 10); ctx.lineTo(s[0], s[1] - 10); ctx.lineTo(s[0] + 10, s[1] - 6); ctx.lineTo(s[0], s[1] - 2); }
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(`${text}  ${Math.round(d)} m`, s[0], s[1] - 17); ctx.shadowBlur = 0;
      } else if (!me.dying) {
        V.copy(pos).applyMatrix4(camera.matrixWorldInverse);
        const a = Math.atan2(-V.y, V.x), R = Math.min(W, Hh) * 0.4 + 26, ax = W / 2 + Math.cos(a) * R, ay = Hh / 2 + Math.sin(a) * R;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a); ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-6, 9); ctx.lineTo(-6, -9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(text, ax - Math.cos(a) * 30, ay - Math.sin(a) * 30 + 4); ctx.shadowBlur = 0;
      }
    };
    for (const side of ['it', 'ah']) { const s = front.ships[side]; if (!s.crashed) mark(s.pos, TEAM_COLOR[side], side === me.team ? 'Our airship' : 'Enemy airship', 'ship'); }
    mark(V2.set(POINT.x, POINT.y + 20, POINT.z).clone(), TEAM_TINT[front.point.owner || 'none'], POINT.name, 'point');
  }
  if (me.alive && !me.dying) {                                 // gunsight
    const s = proj(V2.copy(me.pos).addScaledVector(me.fwd, 190));
    if (s) { ctx.strokeStyle = t < hitFlash ? '#ff5a3c' : '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s[0], s[1], 13, 0, 6.3); ctx.moveTo(s[0] - 22, s[1]); ctx.lineTo(s[0] - 6, s[1]); ctx.moveTo(s[0] + 6, s[1]); ctx.lineTo(s[0] + 22, s[1]); ctx.moveTo(s[0], s[1] - 22); ctx.lineTo(s[0], s[1] - 6); ctx.stroke(); }
  }
  // oil thrown back from a damaged engine spatters the pilot's view
  if (me.alive && !me.dying && me.dmg.eng > 0.3) {
    ctx.fillStyle = 'rgba(22, 13, 6, 0.6)';
    for (let i = 0, n = Math.floor(me.dmg.eng * 16); i < n; i++) { const o = OIL[i]; ctx.beginPath(); ctx.ellipse(o[0] * W, o[1] * Hh, o[2] * Hh, o[2] * Hh * o[3], o[4], 0, 6.3); ctx.fill(); }
  }
  // minimap
  const RX = 132, RZ = 76, cx = W - RX - 18, cy = Hh - RZ - 18, K = RX / 1500, m = (x, z) => [cx + x * K, cy + z * K];   // shows 1500 units east-west, 860 north-south of centre
  ctx.fillStyle = 'rgba(20,60,84,.8)'; ctx.fillRect(cx - RX, cy - RZ, RX * 2, RZ * 2);                               // sea
  ctx.save(); ctx.beginPath(); ctx.rect(cx - RX, cy - RZ, RX * 2, RZ * 2); ctx.clip();
  ctx.fillStyle = 'rgba(58,84,52,.9)'; ctx.beginPath();                                                              // land, traced round the three coasts
  for (let z = -880; z <= 860; z += 40) { const q = m(coastW(z), Math.min(z, coastZ(coastW(z)))); z === -880 ? ctx.moveTo(...q) : ctx.lineTo(...q); }
  for (let x = -1500; x <= 1500; x += 40) if (x > coastW(coastZ(x)) && x < coastE(coastZ(x))) ctx.lineTo(...m(x, coastZ(x)));
  for (let z = 860; z >= -880; z -= 40) ctx.lineTo(...m(coastE(z), Math.min(z, coastZ(coastE(z)))));
  ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.strokeRect(cx - RX, cy - RZ, RX * 2, RZ * 2);
  ctx.strokeStyle = '#35c9ae'; ctx.lineWidth = 2.5; ctx.beginPath(); for (let z = -860; z <= 560; z += 30) { const q = m(riverX(z), z); z === -860 ? ctx.moveTo(...q) : ctx.lineTo(...q); } ctx.stroke();
  for (const key of ['it', 'ah']) { const q = m(AIRFIELDS[key].x, AIRFIELDS[key].z); ctx.fillStyle = TEAM_COLOR[key]; ctx.fillRect(q[0] - 6, q[1] - 3, 12, 6); }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; for (const s of SECTORS) { const q = m(s.x, s.z); ctx.beginPath(); ctx.arc(q[0], q[1], 2.5, 0, 6.3); ctx.fill(); }
  if (mode === 'front') {
    const g = m(POINT.x, POINT.z); ctx.strokeStyle = TEAM_TINT[front.point.owner || 'none']; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g[0], g[1], POINT.r * K, 0, 6.3); ctx.stroke();
    for (const side of ['it', 'ah']) { const s = front.ships[side]; if (s.crashed) continue; const q = m(s.pos.x, s.pos.z); ctx.fillStyle = TEAM_COLOR[side]; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(q[0], q[1], SHIP_LEN * K / 2, 2.6, Math.atan2(s.fwd.z, s.fwd.x), 0, 6.3); ctx.fill(); ctx.stroke(); }
  }
  for (const p of planes.values()) { if (!p.alive) continue; const q = m(THREE.MathUtils.clamp(p.pos.x, -1490, 1490), THREE.MathUtils.clamp(p.pos.z, -850, 850)); ctx.fillStyle = p === me ? '#fff' : TEAM_COLOR[p.team]; ctx.beginPath(); ctx.arc(q[0], q[1], p === me ? 4 : 3, 0, 6.3); ctx.fill(); if (p === me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...q); ctx.lineTo(q[0] + me.fwd.x * 11, q[1] + me.fwd.z * 11); ctx.stroke(); } }
  // text panels
  let it = 0, ah = 0; for (const p of planes.values()) p.team === 'it' ? it++ : ah++;
  if (mode === 'front') {
    const tk = front.tickets, pt = front.point;
    $('score').innerHTML = `<span style="color:${TEAM_COLOR.it}">Italy ${Math.max(0, tk.it)}</span><small>tickets · ${it} v ${ah}</small><span style="color:${TEAM_COLOR.ah}">${Math.max(0, tk.ah)} Austria-Hungary</span>`;
    const ship = side => { const s = front.ships[side]; return s.down || s.crashed ? `<span class="lost">${SIDE_NAME[side]} airship down</span>` : `<span>${side === 'it' ? 'Italian airship ' : ''}<span class="cells">${s.cells.map((h, i) => `<i style="background:${s.burning[i] ? '#ff8a2a' : TEAM_COLOR[side]};opacity:${s.burning[i] ? 1 : (0.3 + 0.7 * h / CELL_HP).toFixed(2)}"></i>`).join('')}</span>${side === 'ah' ? ' Austro-Hungarian airship' : ''}</span>`; };
    const lead = pt.v > 0 ? 'it' : 'ah', pct = Math.round(Math.abs(pt.v) * 100);
    const gor = pt.contested ? 'contested' : pt.owner ? (pct < 100 ? `${NATION[pt.owner]} ${pct}%` : NATION[pt.owner]) : pct ? `${NATION[lead]} capturing ${pct}%` : 'neutral';
    $('front').innerHTML = `${ship('it')}<span>${POINT.name}: <b style="color:${TEAM_TINT[pt.owner || (pct ? lead : 'none')]}">${gor}</b></span>${ship('ah')}`;
  } else $('score').innerHTML = `<span style="color:${TEAM_COLOR.it}">Italy ${score.it}</span><small>first to ${SCORE_LIMIT} · ${it} v ${ah}</small><span style="color:${TEAM_COLOR.ah}">${score.ah} Austria-Hungary</span>`;
  const bar = (v, good) => { const c = good ? (v > 0.5 ? '#9fd08a' : v > 0.2 ? '#f0c05a' : '#ff7a5c') : (v < 0.3 ? '#9fd08a' : v < 0.75 ? '#f0c05a' : '#ff7a5c'); return `<i class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, good ? v : 1 - v)) * 100)}%;background:${c}"></i></i>`; };
  $('stats').innerHTML = `<b>${TYPES[me.type].name}</b><br>Speed ${Math.round(me.speed * 3.6)} km/h<br>Altitude ${Math.round(me.pos.y * 10)} m<br>Throttle ${Math.round(me.throttle * 100)}%`
    + `<table><tr><td>Airframe</td><td>${bar(me.hp / TYPES[me.type].hp, true)}</td></tr><tr><td>Fuel</td><td>${bar(me.fuel, true)}</td></tr>`
    + Object.keys(ZONE_TEXT).map(z => `<tr><td>${ZONE_TEXT[z][0]}</td><td>${bar(me.dmg[z], false)}</td></tr>`).join('') + '</table>'
    + (me.fire ? '<b style="color:#ff7a5c">ON FIRE</b>' : '');
  $('feed').innerHTML = feed.filter(f => t - f.at < 9).map(f => `<div>${f.text}</div>`).join('');
  const won = winner();
  $('msg').innerHTML = won ? `${NATION[won]} wins the ${mode === 'front' ? 'battle' : 'round'}<small>next round starting…</small>`
    : me.alive && me.dying ? 'Going down<small>out of control</small>'
    : me.alive && t - me.repairing < 0.4 ? `${me.onGround ? (me.speed < 6 ? 'Repairing and refuelling' : 'Repairing') : 'Ground crew at work'}<small>${me.onGround && me.speed >= 6 ? 'roll to a stop for faster repairs · ' : ''}${Math.round(100 * Math.min(me.hp / TYPES[me.type].hp, 1 - Math.max(...Object.values(me.dmg))))}% fit</small>`
    : me.alive && me.onGround && me.speed > 8 && me.throttle < 0.5 ? 'Not enough power<small>open the throttle further to lift off</small>'
    : me.alive && me.onGround ? (me.throttle < 0.5 ? 'On the runway<small>open the throttle (Shift)</small>' : me.speed > TYPES[me.type].stall * 1.05 * flight.stall ? 'Flying speed<small>ease the stick back</small>' : '')
    : me.alive && me.fire ? 'On fire<small>dive hard to blow it out</small>'
    : !me.alive ? `${me.fate || 'Crashed'}<small>back in the air in ${Math.max(0, Math.ceil(me.respawnAt - t))} s</small>`
    : oobSince ? 'Turn back<small>you are leaving the combat area</small>'
    : me.speed < TYPES[me.type].stall * 1.05 ? 'Stall<small>nose down, throttle up</small>' : '';
  const wxLabel = weather.cur.cover + weather.cur.rain > 0.05 ? ' · ' + WEATHER[weather.index].name.toLowerCase() : '';
  $('netinfo').textContent = net ? `${net.kind === 'p2p' ? 'peer-to-peer' : 'relay'} · ${net.peers.size + 1} pilot${net.peers.size ? 's' : ''} online${isHost() ? ' · you host the bots' : ''} · ${sky.clock()}${wxLabel}` : 'solo flight · ' + sky.clock() + wxLabel;
}

// ---------------- lobby ----------------
const params = new URLSearchParams(location.search);
for (const [id, key] of [['name', 'name'], ['pw', 'pw'], ['team', 'team'], ['size', 'size'], ['relay', 'relay'], ['time', 'time'], ['clock', 'clock'], ['bots', 'bots'], ['startpos', 'start'], ['mode', 'mode'], ['weather', 'weather']]) if (params.get(key)) $(id).value = params.get(key);
if (!$('name').value) $('name').value = localStorage.getItem('woi-name') || 'Pilot ' + Math.floor(100 + Math.random() * 900);

async function start() {
  startSound();
  const name = $('name').value.trim().slice(0, 20) || 'Pilot', password = $('pw').value, relay = $('relay').value.trim();
  teamSize = THREE.MathUtils.clamp(+$('size').value || 4, 1, MAX_PER_TEAM);
  onRunway = $('startpos').value === 'runway';
  weather.set($('weather').value, true);
  setMode($('mode').value);                                                    // switched to the host's mode if joining a battle
  botSettings.level = THREE.MathUtils.clamp(+$('bots').value | 0, -1, BOT_LEVELS.length - 1);
  sky.tod = +$('time').value || 0; sky.rate = +$('clock').value || 0;      // overridden by the host's clock when joining a battle
  try { localStorage.setItem('woi-name', name); } catch { /* private mode */ }
  $('go').disabled = true; $('status').textContent = password ? 'Finding your squadron…' : '';
  try {
    if (password) {
      net = await connect({ password, relay, turn: window.WOI_TURN }, { onMessage, onLeave, onJoin: () => { nextSend = 0; }, onError: e => say('Network: ' + e) });
      await new Promise(r => setTimeout(r, relay ? 900 : 3500));   // hear who is already flying before picking a side
      // joining a battle in progress: take on its settings and state, so that if host duties pass to us it carries on unchanged
      if (heard) {
        setMode(heard.md); if (heard.n) teamSize = THREE.MathUtils.clamp(heard.n | 0, 1, MAX_PER_TEAM);
        if (heard.b != null) botSettings.level = THREE.MathUtils.clamp(heard.b | 0, -1, BOT_LEVELS.length - 1);
        if (heard.d) { sky.tod = +heard.d[0] || 0; sky.rate = +heard.d[1] || 0; }
        if (heard.sc) { score.it = heard.sc[0] | 0; score.ah = heard.sc[1] | 0; }
        if (heard.f && mode === 'front') front.unpack(heard.f, now());
        if (heard.wx) { weather.set(heard.wx[0], true); weather.follow(heard.wx[0]); }
      }
    }
    const humans = { it: 0, ah: 0 }; for (const p of planes.values()) if (!p.isBot) humans[p.team]++;
    let team = $('team').value; if (team !== 'it' && team !== 'ah') team = humans.it <= humans.ah ? 'it' : 'ah';
    if (humans[team] >= MAX_PER_TEAM) team = other(team);
    if (humans[team] >= MAX_PER_TEAM) throw new Error('This squadron room is full (6 v 6).');
    me = addPlane(net?.id || 'solo', name, team, TEAM_TYPE[team], net?.id || 'solo', false);
    me.spawn(now(), onRunway); camera.position.copy(me.pos).addScaledVector(me.fwd, -20);
    if (onRunway) say('On the runway: open the throttle, then ease the stick back to lift off');
    sky.clock(); running = true; toggleControls(false); enterLiveSetup(); showTab('controls'); $('ui').style.display = 'block'; window.__woi.me = me; window.__woi.net = net;
  } catch (err) { net?.close(); net = null; for (const p of [...planes.values()]) removePlane(p); $('status').textContent = err.message || String(err); $('go').disabled = false; }
}
initControls();
setCamEase(camEase);
$('camease').addEventListener('input', e => setCamEase(e.target.value / 100));
// the start screen is the Options dialog's first tab; it stays open until the game begins
// ---- the Game tab while flying: change the setup without a restart ----
// Callsign, password, side and relay belong to the connection, so they are locked. In a shared battle only the host
// can change the battle itself (mode, bots, pilots per side, time, clock); everybody can change where they start from.
let applied = {};
const HOST_FIELDS = ['mode', 'size', 'bots', 'time', 'clock', 'weather'], LOCKED_FIELDS = ['name', 'pw', 'team', 'relay'];
function currentSetup() { return { mode, size: String(teamSize), bots: String(botSettings.level), startpos: onRunway ? 'runway' : 'air', time: String(Math.round(sky.tod * 100) / 100), clock: String(sky.rate), weather: weather.auto ? 'auto' : String(weather.index) }; }
function showLiveSetup() {                                                 // fill the form from what is actually happening now
  if (!running) return;
  const cur = currentSetup(); applied = { ...cur };
  const pick = (id, v) => { const el = $(id), want = String(v); if ([...el.options].some(o => o.value === want)) el.value = want; };
  pick('mode', cur.mode); pick('size', cur.size); pick('bots', cur.bots); pick('startpos', cur.startpos); pick('clock', cur.clock); pick('weather', cur.weather);
  const near = [...$('time').options].map(o => +o.value).sort((a, b) => Math.abs(a - sky.tod) - Math.abs(b - sky.tod))[0];
  $('time').dataset.shown = near; pick('time', near);                      // the menu only has a few hours; "applied" remembers it so an untouched menu changes nothing
  applied.time = String(near);
  const host = isHost();
  for (const id of HOST_FIELDS) $(id).disabled = !host;
  $('status').textContent = host ? '' : 'Only the host can change the battle; you can change where you start from.';
}
function enterLiveSetup() {
  for (const id of LOCKED_FIELDS) $(id).disabled = true;
  $('go').textContent = 'Apply changes'; $('go').disabled = false;
  $('opt-title').textContent = 'Wings over Isonzo'; document.querySelector('#tab-game > form > p').textContent = 'The battle is under way. Change the setup and press Apply: a new mode or number of pilots restarts the round, the rest take effect straight away.';
  showLiveSetup();
}
function applyLiveSetup() {
  const f = { mode: $('mode').value, size: $('size').value, bots: $('bots').value, startpos: $('startpos').value, time: $('time').value, clock: $('clock').value, weather: $('weather').value }, host = isHost(), changes = [];
  if (f.startpos !== applied.startpos) { onRunway = f.startpos === 'runway'; changes.push(onRunway ? 'you start on the runway' : 'you start in the air'); }
  if (host) {
    const restart = f.mode !== applied.mode || f.size !== applied.size;
    if (f.bots !== applied.bots) { botSettings.level = THREE.MathUtils.clamp(+f.bots | 0, -1, BOT_LEVELS.length - 1); changes.push('bots: ' + $('bots').selectedOptions[0].textContent.split(' — ')[0].toLowerCase()); }
    if (f.time !== applied.time) { sky.tod = +f.time; changes.push('time ' + sky.clock()); }
    if (f.clock !== applied.clock) { sky.rate = +f.clock; changes.push('clock ' + $('clock').selectedOptions[0].textContent.toLowerCase()); }
    if (f.weather !== applied.weather) { weather.set(f.weather); changes.push('weather: ' + $('weather').selectedOptions[0].textContent.toLowerCase()); }
    if (f.size !== applied.size) { teamSize = THREE.MathUtils.clamp(+f.size || 1, 1, MAX_PER_TEAM); changes.push(`${teamSize} per side`); }
    if (f.mode !== applied.mode) { setMode(f.mode); changes.push(f.mode === 'front' ? 'Zeppelin Front' : 'Dogfight'); }
    if (restart) {                                                           // a fresh round: scores and objectives reset, everybody respawns
      score.it = score.ah = 0; roundEndAt = 0; if (mode === 'front') front.reset();
      for (const p of planes.values()) if (p.local) { p.alive = false; p.dying = false; p.respawnAt = now() + 0.8; }
      nextBotCheck = 0;
    }
  }
  applied = { ...applied, ...f };
  say(changes.length ? 'Setup changed: ' + changes.join(', ') : 'No changes');
  toggleControls(false);
}
function showTab(name) {
  for (const t of document.querySelectorAll('#controls .tabs button')) t.classList.toggle('on', t.dataset.tab === name);
  for (const n of ['game', 'controls', 'flight', 'graphics', 'audio']) $('tab-' + n).hidden = n !== name;
  if (name === 'audio') startSound();
  if (name === 'game') showLiveSetup();
}
const closeOptions = () => { if (running) toggleControls(false); else showTab('game'); };       // before take-off "Done" returns to the Game tab
$('controls').addEventListener('close-request', closeOptions);
toggleControls(true); showTab('game');
// options dialog: tabs
for (const tab of document.querySelectorAll('#controls .tabs button')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
// options dialog: graphics
const noShadowsUrl = params.get('shadows') === '0';
function applyGfx(save = true) {
  gfx.shadowDist = THREE.MathUtils.clamp(+gfx.shadowDist || 300, 60, 2000); gfx.scale = THREE.MathUtils.clamp(+gfx.scale || 1, 0.3, 2);
  sky.shadows = gfx.shadows && !noShadowsUrl;
  renderer.setPixelRatio(Math.min(devicePixelRatio * gfx.scale, 4)); resize();
  $('gfx-shadows').checked = sky.shadows; $('gfx-shadows').disabled = noShadowsUrl;
  $('gfx-shadowdist').value = gfx.shadowDist; $('gfx-shadowdist-out').textContent = gfx.shadowDist + ' m'; $('gfx-shadowdist').disabled = !sky.shadows;
  $('gfx-scale').value = Math.round(gfx.scale * 100); $('gfx-scale-out').textContent = `${Math.round(gfx.scale * 100)}%  (${Math.round(innerWidth * devicePixelRatio * gfx.scale)} × ${Math.round(innerHeight * devicePixelRatio * gfx.scale)})`;
  if (save) try { localStorage.setItem('woi-gfx', JSON.stringify(gfx)); } catch { /* no storage */ }
}
$('gfx-shadows').addEventListener('change', e => { gfx.shadows = e.target.checked; applyGfx(); });
$('gfx-shadowdist').addEventListener('input', e => { gfx.shadowDist = +e.target.value; applyGfx(); });
$('gfx-scale').addEventListener('input', e => { gfx.scale = e.target.value / 100; applyGfx(); });
$('gfx-reset').addEventListener('click', () => { Object.assign(gfx, GFX_DEFAULT); applyGfx(); });
$('gfx-close').addEventListener('click', () => closeOptions());
// options dialog: flight model
const SPAD_STALL = TYPES.spad.stall * 3.6, SPAD_TOP = TYPES.spad.top * 3.6;
const FLIGHT_ROWS = [
  { key: 'pitch', label: 'Pitch response', min: 50, max: 150, hint: 'How briskly the nose answers the stick up and down', fmt: v => v + '%' },
  { key: 'roll', label: 'Roll response', min: 50, max: 150, hint: 'How quickly the wings bank', fmt: v => v + '%' },
  { key: 'rudder', label: 'Rudder strength', min: 50, max: 200, hint: 'How hard the rudder swings the nose; also turns the aircraft flat without bank', fmt: v => v + '%' },
  { key: 'level', label: 'Wing levelling', min: 0, max: 100, hint: 'With the stick released the wings roll back toward level. Off keeps the bank you set', fmt: v => v ? v + '%' : 'off' },
  { key: 'stall', label: 'Stall speed', min: 60, max: 130, hint: 'Below this the wings stop lifting. Lower is more forgiving in tight turns', fmt: v => `${v}%  (SPAD ${Math.round(SPAD_STALL * v / 100)} km/h)` },
  { key: 'top', label: 'Top speed', min: 80, max: 130, hint: 'Engine power: the level top speed and how fast you climb', fmt: v => `${v}%  (SPAD ${Math.round(SPAD_TOP * v / 100)} km/h)` },
  { key: 'bleed', label: 'Speed lost in turns', min: 0, max: 200, hint: 'How much speed hard pulls cost. Lower keeps energy in a dogfight', fmt: v => v + '%' },
  { key: 'turb', label: 'Turbulence', min: 0, max: 200, hint: 'How hard rough air in rain and storms shakes the aircraft', fmt: v => v ? v + '%' : 'off' },
  { key: 'tough', label: 'Aircraft toughness', min: 50, max: 300, hint: 'How much punishment your aircraft takes before systems fail and it goes down', fmt: v => v + '%' },
];
const FLIGHT_PRESETS = {
  forgiving: { turb: 0.5, level: 0.5, stall: 0.85, bleed: 0.6, tough: 1.5, top: 1, pitch: 1, roll: 1, rudder: 1 },
  standard: { ...FLIGHT_DEFAULT, invert: flight.invert },
  demanding: { turb: 1.3, level: 0, stall: 1.1, bleed: 1.4, tough: 0.8, top: 1, pitch: 1, roll: 1, rudder: 1 },
};
$('flt-rows').innerHTML = FLIGHT_ROWS.map(r => `<div class="aud-row flt"><span>${r.label}</span><input type="range" min="${r.min}" max="${r.max}" step="5" data-flt="${r.key}" aria-label="${r.label}"><output data-fout="${r.key}"></output></div><p class="aud-hint">${r.hint}</p>`).join('');
function showFlight() {
  for (const r of FLIGHT_ROWS) { const v = Math.round(flight[r.key] * 100); document.querySelector(`[data-flt="${r.key}"]`).value = v; document.querySelector(`[data-fout="${r.key}"]`).textContent = r.fmt(v); }
  $('flt-invert').checked = flight.invert;
}
$('flt-rows').addEventListener('input', e => { const k = e.target.dataset.flt; if (k) { setFlight({ [k]: e.target.value / 100 }); showFlight(); } });
$('flt-invert').addEventListener('change', e => setFlight({ invert: e.target.checked }));
for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => { setFlight({ ...FLIGHT_PRESETS[b.dataset.preset], invert: flight.invert }); showFlight(); });
$('flt-reset').addEventListener('click', () => { setFlight({ ...FLIGHT_DEFAULT }); showFlight(); });
$('flt-close').addEventListener('click', () => closeOptions());
showFlight();
// options dialog: audio, one volume slider per kind of sound
$('aud-rows').innerHTML = CHANNELS.map(c => `<div class="aud-row"><span>${c.label}</span><input type="range" min="0" max="200" step="5" data-vol="${c.key}" aria-label="${c.label} volume"><output data-out="${c.key}"></output><button type="button" data-test="${c.key}">Test</button></div><p class="aud-hint">${c.hint}</p>`).join('');
function showVolumes() { for (const c of CHANNELS) { const v = Math.round(getVolume(c.key) * 100); document.querySelector(`[data-vol="${c.key}"]`).value = v; document.querySelector(`[data-out="${c.key}"]`).textContent = v + '%'; } $('aud-mute').checked = isMuted(); }
$('aud-rows').addEventListener('input', e => { const k = e.target.dataset.vol; if (k) { setVolume(k, e.target.value / 100); showVolumes(); } });
$('aud-rows').addEventListener('click', e => { const k = e.target.dataset.test; if (k) { startSound(); previewSound(k); } });
$('aud-mute').addEventListener('change', e => setMuted(e.target.checked));
$('aud-reset').addEventListener('click', () => { resetVolumes(); setMuted(false); showVolumes(); });
$('aud-close').addEventListener('click', () => closeOptions());
showVolumes();
applyGfx(false);
$('form').addEventListener('submit', e => { e.preventDefault(); if (running) applyLiveSetup(); else start(); });
// debug handle; sim(seconds) fast-forwards the simulation without rendering (used by tests)
window.__woi = { weather, shellStats, LIGHTS, front, get mode() { return mode; }, setMode, flight, shadowExtent: () => sun.shadow.camera.right, gfx, renderer, explode, planes, score, isHost, camera, sky, feed, H, hit: (p, d, z) => damage(p, d, null, z), hitBy: (p, d, by, z) => damage(p, d, by, z), cameraStep: dt => updateCamera(dt), sim(sec) { for (let i = 0; i < sec * 30; i++) { clockSkew += 1 / 30; step(now(), 1 / 30); } last = now(); } };
frame();
if (params.get('autostart')) start();
