// Wings over Isonzo — minimal playable build: team dogfight over the Isonzo Front map.
import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { buildObjects } from './objects.js';
import { AIRFIELDS, SECTORS, riverX, HALF, H } from './world.js';
import { Plane, TYPES, TEAM_TYPE, TEAM_NAME, TEAM_COLOR, GUN, flyPlayer, flyBot, flyRemote } from './plane.js';
import { connect } from './net.js';
import { pollGamepad, updateControls, initControls, toggleControls, controlsOpen } from './gamepad.js';

const MAX_PER_TEAM = 6, SCORE_LIMIT = 30, RESPAWN = 5, SEND_HZ = 15;
const BOT_NAMES = { it: ['Ten. Rossi', 'Serg. Bianchi', 'Cap. Moretti', 'Ten. Ferrari', 'Serg. Conti', 'Ten. Galli'], ah: ['Lt. Huber', 'Fw. Novak', 'Hptm. Steiner', 'Lt. Horvath', 'Zgf. Bauer', 'Oblt. Kovacs'] };
const $ = id => document.getElementById(id);
const other = t => (t === 'it' ? 'ah' : 'it');

// ---------------- renderer & world ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = new URLSearchParams(location.search).get('shadows') !== '0';   // ?shadows=0 for slow machines
 renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 1, 12000);
const { sun, SUN } = buildTerrain(scene);
buildObjects(scene).setMode({ map: false, rings: false, flights: [], lineup: false });
{ const s = sun.shadow.camera; s.left = s.bottom = -260; s.right = s.top = 260; s.near = 100; s.far = 4500; s.updateProjectionMatrix(); }
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
for (const m of [tracerMesh, puffMesh]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
function puff(pos, color, size, life, rise = 2, spread = 0) {
  if (puffs.length >= 400) puffs.shift();
  puffs.push({ p: pos.clone().add(V2.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)), c: color, s: size, life, max: life, rise });
}
function explode(pos) { for (let i = 0; i < 14; i++) puff(pos, i % 3 ? '#2d2a28' : '#ff9a2e', 1.5 + Math.random() * 2.5, 1.2 + Math.random() * 1.6, 3, 5); }

// ---------------- game state ----------------
const planes = new Map();
const score = { it: 0, ah: 0 };
let me = null, net = null, teamSize = 4, roundEndAt = 0, nextSend = 0, nextBotCheck = 0, running = false, oobSince = 0;
const feed = [];
const isHost = () => !net || [net.id, ...net.peers].sort()[0] === net.id;
let clockSkew = 0;
const now = () => performance.now() / 1000 + clockSkew;

function addPlane(id, name, team, type, owner, isBot) { const p = new Plane(id, name, team, type, owner, isBot); planes.set(id, p); scene.add(p.mesh); return p; }
function removePlane(p) { scene.remove(p.mesh); planes.delete(p.id); }
function say(text) { feed.unshift({ text, at: now() }); feed.length = Math.min(feed.length, 6); }
const label = id => { const p = planes.get(id); return p ? `<b style="color:${TEAM_COLOR[p.team]}">${p.name.replace(/[<&]/g, '')}</b>` : 'someone'; };

function onKill(victimId, killerId) {
  const v = planes.get(victimId); if (!v) return;
  say(killerId && planes.has(killerId) ? `${label(killerId)} shot down ${label(victimId)}` : `${label(victimId)} crashed`);
  if (isHost() && !roundEndAt) { score[other(v.team)]++; if (score[other(v.team)] >= SCORE_LIMIT) roundEndAt = now() + 8; }
}
function die(p, by) {          // only ever called by the peer that owns p
  if (!p.alive) return;
  const t = now(), killer = by || (t - p.lastHitAt < 10 ? p.lastHitBy : null);
  p.alive = false; p.firing = false; p.respawnAt = t + RESPAWN; explode(p.pos);
  onKill(p.id, killer); net?.send({ t: 'k', v: p.id, by: killer });
}
function damage(p, amount, by) {
  if (!p.alive) return;
  p.hp -= amount; p.lastHitBy = by; p.lastHitAt = now();
  if (p.hp <= 0) die(p, by);
}

// ---------------- networking ----------------
function packState() {
  const e = [];
  for (const p of planes.values()) if (p.local) e.push([p.id, p.name, p.team, p.type, +p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1), +p.quat.x.toFixed(3), +p.quat.y.toFixed(3), +p.quat.z.toFixed(3), +p.quat.w.toFixed(3), +p.speed.toFixed(1), Math.round(p.hp), (p.alive ? 1 : 0) | (p.firing ? 2 : 0) | (p.isBot ? 4 : 0)]);
  const m = { t: 's', e };
  if (isHost()) { m.sc = [score.it, score.ah]; m.n = teamSize; }
  return m;
}
function onMessage(m, from) {
  const t = now();
  if (m.t === 's') {
    for (const a of m.e) {
      const [id, name, team, type, x, y, z, qx, qy, qz, qw, speed, hp, flags] = a;
      if (id === me?.id || !TYPES[type]) continue;
      let p = planes.get(id);
      if (p && p.local) { if (isHost()) continue; }             // we are the authority for our own bots
      if (!p) { p = addPlane(id, String(name).slice(0, 20), team, type, from, !!(flags & 4)); p.pos.set(x, y, z); p.quat.set(qx, qy, qz, qw); }
      const n = p.net ??= { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fwd: new THREE.Vector3() };
      n.pos.set(x, y, z); n.quat.set(qx, qy, qz, qw).normalize(); n.fwd.copy(Zax).applyQuaternion(n.quat); n.speed = speed; n.at = t;
      const alive = !!(flags & 1);
      if (p.alive && !alive) explode(p.pos);
      if (!p.alive && alive) { p.pos.copy(n.pos); p.quat.copy(n.quat); }
      p.owner = from; p.alive = alive; p.firing = !!(flags & 2); p.hp = hp; p.speed = speed; p.seen = t; p.team = team;
    }
    if (m.sc && !isHost()) { score.it = m.sc[0]; score.ah = m.sc[1]; teamSize = m.n; }
  } else if (m.t === 'x') {                                   // someone's bullet hit a plane we own
    const p = planes.get(m.to); if (p && p.local) damage(p, Math.min(+m.d || 0, 25), m.by);
  } else if (m.t === 'k') onKill(m.v, m.by);
}
function onLeave(id) { for (const p of [...planes.values()]) if (p.owner === id && !p.local) { if (!p.isBot) say(`${label(p.id)} left`); removePlane(p); } }

// ---------------- bots (run by the host) ----------------
function manageBots() {
  if (!isHost()) { for (const p of [...planes.values()]) if (p.isBot && p.local) removePlane(p); return; }
  for (const team of ['it', 'ah']) {
    let humans = 0; for (const p of planes.values()) if (!p.isBot && p.team === team) humans++;
    const want = Math.max(0, teamSize - humans);
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
addEventListener('keydown', e => { if (e.code === 'Escape' && (running || controlsOpen())) return toggleControls(); if (controlsOpen()) return; keys.add(e.code); if (running && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseFire = false; });
$('c').addEventListener('mousedown', () => mouseFire = true); addEventListener('mouseup', () => mouseFire = false);
const k = (...c) => c.some(x => keys.has(x)) ? 1 : 0;
const clamp1 = v => Math.max(-1, Math.min(1, v));
function readInput() {                                        // keyboard and controller add together
  const g = pollGamepad();
  return {
    pitch: clamp1(k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp') + g.pitch),       // S / down arrow / stick back pulls the nose up
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
  if (running) step(t, dt);
  updateControls();
  updateEffects(dt);
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
      const crash = p === me ? flyPlayer(p, readInput(), dt) : flyBot(p, planes, t, dt);
      if (crash) die(p, null);
    } else if (t > p.respawnAt && !roundEndAt) p.spawn(t);
    // guns: real bullets for planes we own, cosmetic tracers for everyone else
    if (p.alive && p.firing && t >= p.gunAt) {
      p.gunAt = t + GUN.interval;
      V.copy(p.fwd).multiplyScalar(GUN.speed + p.speed).add(V2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
      bullets.push({ p: p.pos.clone().addScaledVector(p.fwd, 3.5), v: V.clone(), life: GUN.life, by: p.id, team: p.team, real: p.local });
    }
    if (p.alive && p.hp < 45 && Math.random() < dt * 14) puff(p.pos, '#3a3735', 0.9, 1.3, 1.5, 0.6);
    p.sync();
  }
  // bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.life -= dt;
    V.copy(b.v).multiplyScalar(dt);
    let hit = null;
    if (b.real) for (const p of planes.values()) {
      if (!p.alive || p.team === b.team) continue;
      // closest approach of this frame's bullet segment to the plane
      V2.copy(p.pos).sub(b.p); const u = THREE.MathUtils.clamp(V2.dot(V) / V.lengthSq(), 0, 1);
      if (V2.addScaledVector(V, -u).lengthSq() < GUN.hitRadius * GUN.hitRadius) { hit = p; break; }
    }
    b.p.add(V);
    if (hit) {
      puff(hit.pos, '#ffd36b', 0.8, 0.25, 0, 2);
      if (hit.local) damage(hit, GUN.damage, b.by); else net?.send({ t: 'x', to: hit.id, by: b.by, d: GUN.damage }, hit.owner);
      if (b.by === me?.id) hitFlash = t + 0.12;
    }
    if (hit || b.life <= 0) bullets.splice(i, 1);
  }
  // round end
  if (roundEndAt && isHost() && t > roundEndAt) { score.it = score.ah = 0; roundEndAt = 0; for (const p of planes.values()) if (p.local) { p.alive = false; p.respawnAt = t + 1; } }
  if (!isHost()) roundEndAt = Math.max(score.it, score.ah) >= SCORE_LIMIT ? 1 : 0;
  // out of bounds warning
  const out = me.alive && (Math.abs(me.pos.x) > HALF || Math.abs(me.pos.z) > HALF);
  oobSince = out ? (oobSince || t) : 0;
  if (net && t > nextSend) { nextSend = t + 1 / SEND_HZ; net.send(packState()); }
}
let hitFlash = 0;

function updateEffects(dt) {
  let n = 0;
  for (const b of bullets) { if (n >= 500) break; Q.setFromUnitVectors(Zax, V.copy(b.v).normalize()); tracerMesh.setMatrixAt(n++, M4.compose(b.p, Q, S3.set(1, 1, 1))); }
  tracerMesh.count = n; tracerMesh.instanceMatrix.needsUpdate = true;
  n = 0;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const f = puffs[i]; f.life -= dt; if (f.life <= 0) { puffs.splice(i, 1); continue; }
    f.p.y += f.rise * dt; const a = f.life / f.max, s = f.s * (1.6 - a) * Math.min(1, a * 3);
    puffMesh.setMatrixAt(n, M4.compose(f.p, Q.identity(), S3.set(s, s, s))); puffMesh.setColorAt(n++, COL.set(f.c));
  }
  puffMesh.count = n; puffMesh.instanceMatrix.needsUpdate = true; if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
}

// Chase camera as in Home Skies 1917: follows behind and above, and always keeps the horizon level.
function updateCamera(dt) {
  camera.up.set(0, 1, 0);
  if (!me) { const a = now() * 0.03; camera.position.set(Math.sin(a) * 900, 380, 300 + Math.cos(a) * 700); camera.lookAt(0, 40, -80); }
  else if (me.alive) {
    V.copy(me.pos).addScaledVector(me.fwd, -14); V.y += 3.6; V.addScaledVector(V2.set(0, 1, 0).applyQuaternion(me.quat), 1.2);
    V.y = Math.max(V.y, H(V.x, V.z) + 1.5);                       // never let the camera sink into a hillside
    camera.position.lerp(V, 1 - Math.exp(-7 * dt));
    camera.lookAt(V.copy(me.pos).addScaledVector(me.fwd, 25));
  } else camera.lookAt(me.pos);
  // keep the shadow map centred on the action
  const c = me ? me.pos : V.set(0, 0, 0);
  sun.target.position.set(Math.round(c.x / 20) * 20, 0, Math.round(c.z / 20) * 20); sun.position.copy(sun.target.position).addScaledVector(SUN, 2200); sun.target.updateMatrixWorld();
}

// ---------------- HUD ----------------
function drawHud(t) {
  const W = hud.width, Hh = hud.height; ctx.clearRect(0, 0, W, Hh);
  if (!me) return;
  const proj = v => { V.copy(v).project(camera); return V.z < 1 ? [(V.x + 1) / 2 * W, (1 - V.y) / 2 * Hh] : null; };
  ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const p of planes.values()) {
    if (p === me || !p.alive) continue;
    const d = p.pos.distanceTo(me.pos); if (d > 900) continue;
    const s = proj(p.pos); if (!s) continue;
    const foe = p.team !== me.team; ctx.strokeStyle = ctx.fillStyle = TEAM_COLOR[p.team]; ctx.lineWidth = 2;
    ctx.beginPath(); if (foe) { ctx.moveTo(s[0], s[1] - 9); ctx.lineTo(s[0] + 9, s[1]); ctx.lineTo(s[0], s[1] + 9); ctx.lineTo(s[0] - 9, s[1]); ctx.closePath(); } else ctx.arc(s[0], s[1], 8, 0, 6.3);
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(`${p.name}  ${Math.round(d * 10)} m`, s[0], s[1] - 15); ctx.shadowBlur = 0;
  }
  if (me.alive) {                                              // gunsight
    const s = proj(V2.copy(me.pos).addScaledVector(me.fwd, 190));
    if (s) { ctx.strokeStyle = t < hitFlash ? '#ff5a3c' : '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s[0], s[1], 13, 0, 6.3); ctx.moveTo(s[0] - 22, s[1]); ctx.lineTo(s[0] - 6, s[1]); ctx.moveTo(s[0] + 6, s[1]); ctx.lineTo(s[0] + 22, s[1]); ctx.moveTo(s[0], s[1] - 22); ctx.lineTo(s[0], s[1] - 6); ctx.stroke(); }
  }
  // minimap
  const R = 84, cx = W - R - 18, cy = Hh - R - 18, m = (x, z) => [cx + x / 700 * R, cy + z / 700 * R];
  ctx.fillStyle = 'rgba(16,22,28,.72)'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.strokeRect(cx - R, cy - R, R * 2, R * 2);
  ctx.strokeStyle = '#35c9ae'; ctx.lineWidth = 2.5; ctx.beginPath(); for (let z = -690; z <= 560; z += 30) { const q = m(riverX(z), z); z === -690 ? ctx.moveTo(...q) : ctx.lineTo(...q); } ctx.stroke();
  for (const key of ['it', 'ah']) { const q = m(AIRFIELDS[key].x, AIRFIELDS[key].z); ctx.fillStyle = TEAM_COLOR[key]; ctx.fillRect(q[0] - 6, q[1] - 3, 12, 6); }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; for (const s of SECTORS) { const q = m(s.x, s.z); ctx.beginPath(); ctx.arc(q[0], q[1], 2.5, 0, 6.3); ctx.fill(); }
  for (const p of planes.values()) { if (!p.alive) continue; const q = m(THREE.MathUtils.clamp(p.pos.x, -690, 690), THREE.MathUtils.clamp(p.pos.z, -690, 690)); ctx.fillStyle = p === me ? '#fff' : TEAM_COLOR[p.team]; ctx.beginPath(); ctx.arc(q[0], q[1], p === me ? 4 : 3, 0, 6.3); ctx.fill(); if (p === me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...q); ctx.lineTo(q[0] + me.fwd.x * 11, q[1] + me.fwd.z * 11); ctx.stroke(); } }
  // text panels
  let it = 0, ah = 0; for (const p of planes.values()) p.team === 'it' ? it++ : ah++;
  $('score').innerHTML = `<span style="color:${TEAM_COLOR.it}">Italy ${score.it}</span><small>first to ${SCORE_LIMIT} · ${it} v ${ah}</small><span style="color:${TEAM_COLOR.ah}">${score.ah} Austria-Hungary</span>`;
  $('stats').innerHTML = `<b>${TYPES[me.type].name}</b><br>Speed ${Math.round(me.speed * 3.6)} km/h<br>Altitude ${Math.round(me.pos.y * 10)} m<br>Throttle ${Math.round(me.throttle * 100)}%<br>Airframe <span style="color:${me.hp < 45 ? '#ff7a5c' : '#fff'}">${Math.max(0, Math.round(me.hp))}%</span>`;
  $('feed').innerHTML = feed.filter(f => t - f.at < 9).map(f => `<div>${f.text}</div>`).join('');
  const over = Math.max(score.it, score.ah) >= SCORE_LIMIT;
  $('msg').innerHTML = over ? `${score.it > score.ah ? 'Italy' : 'Austria-Hungary'} wins the round<small>next round starting…</small>`
    : !me.alive ? `Shot down<small>back in the air in ${Math.max(0, Math.ceil(me.respawnAt - t))} s</small>`
    : oobSince ? 'Turn back<small>you are leaving the combat area</small>'
    : me.speed < TYPES[me.type].stall * 1.05 ? 'Stall<small>nose down, throttle up</small>' : '';
  $('netinfo').textContent = net ? `${net.kind === 'p2p' ? 'peer-to-peer' : 'relay'} · ${net.peers.size + 1} pilot${net.peers.size ? 's' : ''} online${isHost() ? ' · you host the bots' : ''}` : 'solo flight';
}

// ---------------- lobby ----------------
const params = new URLSearchParams(location.search);
for (const [id, key] of [['name', 'name'], ['pw', 'pw'], ['team', 'team'], ['size', 'size'], ['relay', 'relay']]) if (params.get(key)) $(id).value = params.get(key);
if (!$('name').value) $('name').value = localStorage.getItem('woi-name') || 'Pilot ' + Math.floor(100 + Math.random() * 900);

async function start() {
  const name = $('name').value.trim().slice(0, 20) || 'Pilot', password = $('pw').value, relay = $('relay').value.trim();
  teamSize = THREE.MathUtils.clamp(+$('size').value || 4, 1, MAX_PER_TEAM);
  try { localStorage.setItem('woi-name', name); } catch { /* private mode */ }
  $('go').disabled = true; $('status').textContent = password ? 'Finding your squadron…' : '';
  try {
    if (password) {
      net = await connect({ password, relay, turn: window.WOI_TURN }, { onMessage, onLeave, onJoin: () => { nextSend = 0; }, onError: e => say('Network: ' + e) });
      await new Promise(r => setTimeout(r, relay ? 900 : 3500));   // hear who is already flying before picking a side
    }
    const humans = { it: 0, ah: 0 }; for (const p of planes.values()) if (!p.isBot) humans[p.team]++;
    let team = $('team').value; if (team !== 'it' && team !== 'ah') team = humans.it <= humans.ah ? 'it' : 'ah';
    if (humans[team] >= MAX_PER_TEAM) team = other(team);
    if (humans[team] >= MAX_PER_TEAM) throw new Error('This squadron room is full (6 v 6).');
    me = addPlane(net?.id || 'solo', name, team, TEAM_TYPE[team], net?.id || 'solo', false);
    me.spawn(now()); camera.position.copy(me.pos).addScaledVector(me.fwd, -20);
    $('lobby').style.display = 'none'; $('ui').style.display = 'block'; running = true; window.__woi.me = me; window.__woi.net = net;
  } catch (err) { net?.close(); net = null; for (const p of [...planes.values()]) removePlane(p); $('status').textContent = err.message || String(err); $('go').disabled = false; }
}
initControls();
$('open-controls').addEventListener('click', () => toggleControls(true));
$('form').addEventListener('submit', e => { e.preventDefault(); start(); });
// debug handle; sim(seconds) fast-forwards the simulation without rendering (used by tests)
window.__woi = { planes, score, isHost, camera, sim(sec) { for (let i = 0; i < sec * 30; i++) { clockSkew += 1 / 30; step(now(), 1 / 30); } last = now(); } };
frame();
if (params.get('autostart')) start();
