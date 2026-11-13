// Zeppelin Front game mode.
// Each side has an airship patrolling in front of its own airfield, and a ground capture point at Gradisca sits
// between them (it is almost exactly as far from one airfield as from the other). Each side starts with TICKETS: every aircraft lost costs 1, a lost airship costs AIRSHIP_TICKETS,
// and the side holding Gradisca drains 1 ticket from the other every BLEED_EVERY seconds. A side at 0 loses.
// The host simulates all of this; other players draw the state the host sends.
import * as THREE from 'three';
import { H, TOWNS } from './world.js';
import { GUN } from './plane.js';
import { makeFlagMesh, registerArm } from './flags.js';

export const TICKETS = 150, AIRSHIP_TICKETS = 50, BLEED_EVERY = 4;
export const SHIP_LEN = 160, SHIP_R = 11, CELLS = 6, CELL_HP = 320;
const L = SHIP_LEN, R = SHIP_R, LOST_CELLS = 3, SPEED = 6, SPREAD = 4;   // SPREAD: hp per second fire eats from a burning cell's neighbours
const SIDES = ['it', 'ah'], other = s => (s === 'it' ? 'ah' : 'it');
export const SIDE_NAME = { it: 'Italian', ah: 'Austro-Hungarian' }, NATION = { it: 'Italy', ah: 'Austria-Hungary' };
export const TEAM_TINT = { it: '#3d8bf0', ah: '#e2463b', none: '#f2ead0' };
// hull radius along the length, s = 0 at the tail to 1 at the nose
export const radiusAt = s => (s <= 0 || s >= 1 ? 0 : R * Math.sqrt(1 - Math.pow(Math.abs(2 * s - 1), 2.4)));
// gun positions in the hull frame (x, y, z) and which way they can fire: 1 = upper hemisphere, -1 = lower
const TURRETS = [[0, R + 0.8, L * 0.22, 1], [0, R * 0.8, -L * 0.3, 1], [0, -R - 4.5, L * 0.22, -1], [0, -R - 4.5, -L * 0.18, -1]];
const TURRET_RANGE = 210, AIM_ERROR = [0.06, 0.075, 0.048, 0.03];   // aim error by bot level + 1: no bots, rookie, regular, ace
// patrol racetracks in front of each airfield, long axis north-south, about the same distance from Gradisca
const PATROL = { it: { cx: -245, cz: 230, rx: 80, rz: 200, theta0: 0 }, ah: { cx: 225, cz: 215, rx: 80, rz: 200, theta0: Math.PI } };
const town = TOWNS.find(t => t.n === 'Gradisca');
export const POINT = { name: 'Gradisca', x: town.x, z: town.z, y: H(town.x, town.z), r: 90, ceiling: 85 };   // capture: inside r, below ceiling above the ground

const Y = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3(), SCORCH = new THREE.Color(0.16, 0.12, 0.1);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m1 = new THREE.Matrix4();

// ---------------- models ----------------
const lambert = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
function part(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
function buildAirship(side) {
  const g = new THREE.Group(), cellMats = [], base = [];
  const tone = side === 'it' ? ['#cfcfc3', '#c2c2b6'] : ['#bcab78', '#b09f6c'];
  // envelope: one lathe per gas cell so each can be scorched on its own
  for (let i = 0; i < CELLS; i++) {
    const pts = []; for (let k = 0; k <= 6; k++) { const s = (i + k / 6) / CELLS; pts.push(new THREE.Vector2(radiusAt(s), (s - 0.5) * L)); }
    const geo = new THREE.LatheGeometry(pts, 14); geo.rotateX(Math.PI / 2);          // lathe height (y) becomes the length (z)
    const mat = lambert(tone[i % 2]); cellMats.push(mat); base.push(new THREE.Color(tone[i % 2]));
    g.add(part(geo, mat, 0, 0, 0));
  }
  // tail fins: vertical pair in national colours, horizontal pair plain
  const zf = -L / 2 + 22, rf = radiusAt(0.14) + 5.5, finCols = side === 'it' ? ['#2f8a45', '#f4f1e6', '#c9302a'] : ['#c9302a', '#f4f1e6', '#c9302a'];
  for (const sy of [1, -1]) finCols.forEach((c, i) => g.add(part(new THREE.BoxGeometry(0.7, 11, 8), lambert(c), 0, sy * rf, zf - 8 + i * 8)));
  for (const sx of [1, -1]) g.add(part(new THREE.BoxGeometry(11, 0.7, 24), lambert(side === 'it' ? '#9a9a90' : '#8c7c50'), sx * rf, 0, zf));
  // markings on both flanks, a quarter of the way back from the nose
  const zr = L * 0.25, rr = radiusAt(0.75) + 0.15;
  for (const sx of [1, -1]) {
    const mk = new THREE.Group(); mk.position.set(sx * rr, 0, zr); mk.rotation.z = Math.PI / 2; g.add(mk);
    if (side === 'it') [['#c9302a', 5], ['#f4f1e6', 3.3], ['#2f8a45', 1.65]].forEach(([c, r], i) => mk.add(part(new THREE.CylinderGeometry(r, r, 0.3 + i * 0.1, 16), lambert(c), 0, 0, 0)));
    else { mk.add(part(new THREE.BoxGeometry(9, 0.3, 9), lambert('#f4f1e6'), 0, 0, 0)); mk.add(part(new THREE.BoxGeometry(7.6, 0.45, 2.2), lambert('#1a1a1a'), 0, 0, 0)); mk.add(part(new THREE.BoxGeometry(2.2, 0.45, 7.6), lambert('#1a1a1a'), 0, 0, 0)); }
  }
  // gondolas with struts and engines
  const wood = lambert(side === 'it' ? '#6b5a44' : '#5c6656'), dark = lambert('#2b2b2b');
  for (const [z, len] of [[L * 0.22, 16], [-L * 0.18, 12]]) {
    g.add(part(new THREE.BoxGeometry(4.5, 3.6, len), wood, 0, -R - 3.2, z));
    for (const dz of [-len / 2 + 2, len / 2 - 2]) for (const sx of [-1.6, 1.6]) g.add(part(new THREE.BoxGeometry(0.25, 3.2, 0.25), dark, sx, -R - 0.4, z + dz));
    for (const sx of [-1, 1]) { g.add(part(new THREE.CylinderGeometry(0.9, 0.9, 3.4, 8).rotateX(Math.PI / 2), dark, sx * 3.6, -R - 2.6, z - len / 2 + 2)); g.add(part(new THREE.CylinderGeometry(2.4, 2.4, 0.08, 14).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#e8dcc0', transparent: true, opacity: 0.3 }), sx * 3.6, -R - 2.6, z - len / 2)); }
  }
  g.add(part(new THREE.BoxGeometry(2.4, 1.2, 3), dark, 0, R + 0.6, L * 0.22));      // gun platform on top
  return { group: g, cellMats, base };
}
function buildPoint(scene) {
  const g = new THREE.Group(), pts = [];
  for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, x = POINT.x + Math.cos(a) * POINT.r, z = POINT.z + Math.sin(a) * POINT.r; pts.push(new THREE.Vector3(x, H(x, z) + 0.8, z)); }
  const ringMat = new THREE.MeshBasicMaterial({ color: TEAM_TINT.none, fog: false });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 192, 0.9, 4, true), ringMat));
  const wallMat = new THREE.MeshBasicMaterial({ color: TEAM_TINT.none, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(POINT.r, POINT.r, POINT.ceiling, 48, 1, true), wallMat); wall.position.set(POINT.x, POINT.y + POINT.ceiling / 2, POINT.z); g.add(wall);
  const fx = POINT.x + 20, fz = POINT.z - 16, fy = H(fx, fz);
  g.add(part(new THREE.CylinderGeometry(0.25, 0.32, 18, 6), lambert('#e9e4d6'), fx, fy + 9, fz));
  const arm = new THREE.Group(); arm.position.set(fx + 0.1, fy + 17.6, fz); arm.scale.setScalar(1.35); g.add(arm); registerArm(arm, 'flag');
  const flags = {}; for (const side of ['it', 'ah', 'none']) { flags[side] = makeFlagMesh(side); flags[side].visible = side === 'none'; arm.add(flags[side]); }   // the flag of whoever holds the town
  scene.add(g);
  return { group: g, ringMat, wallMat, flags };
}

// ---------------- the mode ----------------
// fx: { puff, explode, shoot(origin, dir, side, real), say(html), label(id) } supplied by the game
export function createFront(scene, fx) {
  let active = false, bleed = 0;
  const tickets = { it: TICKETS, ah: TICKETS };
  const point = { v: 0, owner: null, contested: false, count: { it: 0, ah: 0 }, ...buildPoint(scene) };
  const ships = {};
  for (const side of SIDES) {
    const cfg = PATROL[side], { group, cellMats, base } = buildAirship(side);
    // cruise height: well clear of the highest ground anywhere under the racetrack
    let top = 0; for (let a = 0; a < Math.PI * 2; a += 0.05) for (const dx of [-90, 0, 90]) for (const dz of [-90, 0, 90]) top = Math.max(top, H(cfg.cx + cfg.rx * Math.cos(a) + dx, cfg.cz + cfg.rz * Math.sin(a) + dz));
    scene.add(group);
    ships[side] = { side, ...cfg, alt: Math.max(200, top + 95), theta: cfg.theta0, mesh: group, cellMats, base,
      cells: new Array(CELLS).fill(CELL_HP), burning: new Array(CELLS).fill(false), down: false, crashed: false, fall: 0, heading: 0, sink: 0,
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), inv: new THREE.Quaternion(), fwd: new THREE.Vector3(0, 0, 1),
      netPos: new THREE.Vector3(), netQuat: new THREE.Quaternion(), hasNet: false, lastHitBy: null, downBy: null, wreck: null,
      turrets: TURRETS.map(t => ({ off: new THREE.Vector3(t[0], t[1], t[2]), up: t[3], burstEnd: 0, nextShot: 0, err: new THREE.Vector3(), target: null, firing: false })),
      seen: { down: false, hp: CELLS * CELL_HP, alarm: -99 } };
  }
  const prevOwner = { v: null };

  function pose(s) {
    const c = Math.cos(s.theta), sn = Math.sin(s.theta);
    s.pos.set(s.cx + s.rx * c, s.alt, s.cz + s.rz * sn);
    s.fwd.set(-s.rx * sn, 0, s.rz * c).normalize();
    s.quat.setFromRotationMatrix(m1.lookAt(s.fwd, ZERO, Y));
  }
  const local = (s, x, y, z, out = v3) => out.set(x, y, z).applyQuaternion(s.quat).add(s.pos);
  const cellCentre = (s, i, out) => local(s, 0, R * 0.55, ((i + 0.5) / CELLS - 0.5) * L, out);

  function resetShip(s) {
    s.theta = s.theta0; s.cells.fill(CELL_HP); s.burning.fill(false); s.down = s.crashed = false; s.fall = 0; s.sink = 0;
    s.lastHitBy = s.downBy = null; s.wreck = null; s.hasNet = false; s.mesh.visible = active;
    for (const t of s.turrets) { t.target = null; t.firing = false; t.burstEnd = 0; }
    pose(s); s.inv.copy(s.quat).invert(); s.mesh.position.copy(s.pos); s.mesh.quaternion.copy(s.quat);
    s.seen.down = false; s.seen.hp = CELLS * CELL_HP;
  }
  function reset() {
    for (const side of SIDES) resetShip(ships[side]);
    point.v = 0; point.owner = null; point.contested = false; prevOwner.v = null; bleed = 0;
    tickets.it = tickets.ah = TICKETS;
  }
  function setActive(on) { active = !!on; for (const side of SIDES) ships[side].mesh.visible = active && !ships[side].crashed; point.group.visible = active; if (active) reset(); }

  // ---- damage (host only) ----
  function ignite(s, i) {
    if (s.burning[i]) return; s.burning[i] = true; s.cells[i] = 0;
    fx.explode(cellCentre(s, i, new THREE.Vector3()));
  }
  function goDown(s) {
    if (s.down) return; s.down = true; s.fall = 0; s.heading = Math.atan2(s.fwd.x, s.fwd.z); s.downBy = s.lastHitBy;
    tickets[s.side] -= AIRSHIP_TICKETS;
  }
  function damage(side, cell, amount, by) {
    const s = ships[side]; if (!active || !s || s.down || s.crashed || !(cell >= 0 && cell < CELLS)) return;
    s.lastHitBy = by;
    if (s.burning[cell]) {                                                     // already alight: rounds go into a neighbour
      const nb = [cell - 1, cell + 1].filter(j => j >= 0 && j < CELLS && !s.burning[j]); if (!nb.length) return;
      cell = nb[Math.floor(Math.random() * nb.length)]; amount *= 0.5;
    }
    s.cells[cell] -= amount; if (s.cells[cell] <= 0) ignite(s, cell);
    if (s.burning.filter(Boolean).length >= LOST_CELLS) goDown(s);
  }

  // ---- motion ----
  function fallStep(s, dt) {
    s.fall += dt; s.sink = Math.min(24, 1 + 2.4 * s.fall);
    const pitch = Math.min(0.55, 0.05 + 0.07 * s.fall), roll = 0.18 * Math.sin(s.fall * 0.6);
    s.pos.x += Math.sin(s.heading) * SPEED * dt; s.pos.z += Math.cos(s.heading) * SPEED * dt; s.pos.y -= s.sink * dt;
    s.quat.setFromAxisAngle(Y, s.heading).multiply(q1.setFromAxisAngle(v1.set(1, 0, 0), pitch)).multiply(q2.setFromAxisAngle(v2.set(0, 0, 1), roll));
    s.fwd.set(0, 0, 1).applyQuaternion(s.quat);
  }
  function crash(s, now) {
    s.crashed = true; s.mesh.visible = false; s.wreck = { pos: s.pos.clone(), until: now + 30 };
    s.wreck.pos.y = H(s.pos.x, s.pos.z) + 2;
    for (let i = 0; i < 5; i++) fx.explode(local(s, (Math.random() - 0.5) * 8, 0, (i / 4 - 0.5) * L * 0.85, new THREE.Vector3()));
  }

  // ---- turrets ----
  function turrets(s, now, planes, host, level) {
    const err = AIM_ERROR[level + 1] ?? 0.05;
    for (const t of s.turrets) {
      const o = local(s, t.off.x, t.off.y, t.off.z, new THREE.Vector3());
      let tgt = null;
      if (host) {
        let bd = TURRET_RANGE;
        for (const p of planes.values()) {
          if (!p.alive || p.dying || p.onGround || p.team === s.side) continue;
          const d = p.pos.distanceTo(o); if (d >= bd) continue;
          v1.copy(p.pos).sub(s.pos).applyQuaternion(s.inv);                  // only shoot where the hull does not block
          if (t.up > 0 ? v1.y > -2 : v1.y < 2) { bd = d; tgt = p; }
        }
        if (tgt && now > t.burstEnd + 1.3) { t.burstEnd = now + 0.9 + Math.random() * 0.5; t.err.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * err); }
        t.firing = !!tgt && now < t.burstEnd; t.target = t.firing ? tgt.id : null;
      } else { tgt = t.target ? planes.get(t.target) : null; t.firing = !!tgt; }
      if (!t.firing || !tgt || now < t.nextShot) continue;
      t.nextShot = now + (host ? 0.12 : 0.14);
      const d = tgt.pos.distanceTo(o);
      v2.copy(tgt.pos).addScaledVector(tgt.fwd, tgt.speed * d / GUN.speed).addScaledVector(t.err, d).sub(o).normalize();
      fx.shoot(o, v2, s.side, host);
    }
  }

  // ---- ground point (host only) ----
  function pointStep(dt, planes) {
    const c = point.count; c.it = c.ah = 0;
    for (const p of planes.values()) {
      if (!p.alive || p.dying || p.onGround) continue;
      const dx = p.pos.x - POINT.x, dz = p.pos.z - POINT.z;
      if (dx * dx + dz * dz < POINT.r * POINT.r && p.pos.y - H(p.pos.x, p.pos.z) < POINT.ceiling) c[p.team]++;
    }
    point.contested = c.it > 0 && c.ah > 0;
    if (c.it !== c.ah) point.v = THREE.MathUtils.clamp(point.v + THREE.MathUtils.clamp(0.2 * (c.it - c.ah), -0.5, 0.5) * dt, -1, 1);
    else if (!c.it) { const home = point.owner === 'it' ? 1 : point.owner === 'ah' ? -1 : 0; point.v += THREE.MathUtils.clamp(home - point.v, -0.05 * dt, 0.05 * dt); }
    if (point.v >= 1) point.owner = 'it'; else if (point.v <= -1) point.owner = 'ah';
    else if ((point.owner === 'it' && point.v <= 0) || (point.owner === 'ah' && point.v >= 0)) point.owner = null;
    if (point.owner) { bleed += dt; while (bleed >= BLEED_EVERY) { bleed -= BLEED_EVERY; tickets[other(point.owner)]--; } } else bleed = 0;
  }

  // ---- messages for this player, from state changes (works the same for host and the others) ----
  function observe(now, myTeam) {
    for (const side of SIDES) {
      const s = ships[side], hp = s.cells.reduce((a, b) => a + b, 0);
      if (s.down && !s.seen.down) fx.say(side === myTeam ? `Our airship is going down! <b>−${AIRSHIP_TICKETS} tickets</b>` : `${s.downBy ? fx.label(s.downBy) + ' brought down' : 'Down goes'} the ${SIDE_NAME[side]} airship! <b>−${AIRSHIP_TICKETS} enemy tickets</b>`);
      if (side === myTeam && !s.down && hp < s.seen.hp - 0.5 && now - s.seen.alarm > 20) { s.seen.alarm = now; fx.say('Our airship is under attack!'); }
      s.seen.down = s.down; s.seen.hp = hp;
    }
    if (point.owner !== prevOwner.v) {
      if (point.owner) fx.say(`<b style="color:${TEAM_TINT[point.owner]}">${NATION[point.owner]}</b> captured ${POINT.name}`);
      else if (prevOwner.v) fx.say(`${POINT.name} is neutral`);
      prevOwner.v = point.owner;
    }
  }

  function update(dt, now, { host, planes, myTeam, level, frozen }) {
    if (!active) return;
    for (const side of SIDES) {
      const s = ships[side];
      if (s.wreck && now < s.wreck.until && Math.random() < dt * 12) fx.puff(s.wreck.pos, Math.random() < 0.3 ? '#ff8a2a' : '#2b2927', 4 + Math.random() * 4, 2.5, 6, 25);
      if (s.crashed) continue;
      if (host) {
        if (s.down) fallStep(s, dt);
        else { s.theta += SPEED / Math.hypot(s.rx * Math.sin(s.theta), s.rz * Math.cos(s.theta)) * dt; pose(s); }
      } else if (s.hasNet) {
        s.pos.lerp(s.netPos, 1 - Math.exp(-4 * dt)); s.quat.slerp(s.netQuat, 1 - Math.exp(-4 * dt)); s.fwd.set(0, 0, 1).applyQuaternion(s.quat);
      }
      s.inv.copy(s.quat).invert(); s.mesh.position.copy(s.pos); s.mesh.quaternion.copy(s.quat); s.mesh.visible = true;
      // fire spreading along the gas cells
      if (host && !frozen && !s.down) {
        for (let i = 0; i < CELLS; i++) if (s.burning[i]) for (const j of [i - 1, i + 1]) if (j >= 0 && j < CELLS && !s.burning[j]) { s.cells[j] -= SPREAD * dt; if (s.cells[j] <= 0) ignite(s, j); }
        if (s.burning.filter(Boolean).length >= LOST_CELLS) goDown(s);
      }
      if (host && s.down) {                                                     // the falling wreck reaches the ground
        const tip = local(s, 0, 0, L / 2, v1);
        if (tip.y < H(tip.x, tip.z) + 1 || s.pos.y - R < H(s.pos.x, s.pos.z)) crash(s, now);
        if (s.crashed) continue;
      }
      // scorch damaged cells; flames and smoke from the burning ones
      for (let i = 0; i < CELLS; i++) {
        const burnt = s.burning[i] || s.down ? 0.8 : (1 - s.cells[i] / CELL_HP) * 0.35;
        s.cellMats[i].color.copy(s.base[i]).lerp(SCORCH, burnt);
        if ((s.burning[i] || s.down) && Math.random() < dt * 10) {
          const p = local(s, (Math.random() - 0.5) * R, R * (0.2 + Math.random() * 0.7), ((i + Math.random()) / CELLS - 0.5) * L, v1);
          const f = fx.puff(p, Math.random() < 0.65 ? '#ff8a2a' : '#ffc24a', 2.5 + Math.random() * 3, 0.7, 5, 2); f.glow = true;
          if (Math.random() < 0.6) fx.puff(p, '#2b2927', 4 + Math.random() * 4, 2.6, 6, 3);
        }
      }
      if (!s.down && !frozen) turrets(s, now, planes, host, level);
    }
    // ground point visuals and (host) capture
    if (host && !frozen) pointStep(dt, planes);
    const tint = TEAM_TINT[point.owner || 'none'];
    point.ringMat.color.set(tint); point.wallMat.color.set(tint);
    for (const k of ['it', 'ah', 'none']) point.flags[k].visible = k === (point.owner || 'none');
    point.wallMat.opacity = 0.07 + (point.contested || (Math.abs(point.v) < 0.999 && Math.abs(point.v) > 0.001) ? 0.05 * (1 + Math.sin(now * 6)) : 0);
    observe(now, myTeam);
  }

  // ---- bullets and collisions ----
  // which gas cell (0 tail .. 5 nose) a world point is inside, or -1; margin widens the hull for collisions
  function cellAt(s, pt, margin) {
    v1.copy(pt).sub(s.pos).applyQuaternion(s.inv);
    const sf = v1.z / L + 0.5; if (sf < -margin / L || sf > 1 + margin / L) return -1;
    const cell = Math.min(CELLS - 1, Math.max(0, Math.floor(sf * CELLS))), r = radiusAt(Math.min(1, Math.max(0, sf))) + margin;
    if (v1.x * v1.x + v1.y * v1.y < r * r) return cell;
    const inGondola = (zc, half) => v1.z > zc - half - margin && v1.z < zc + half + margin;
    if (Math.abs(v1.x) < 2.6 + margin && v1.y < -R + 1 && v1.y > -R - 5.5 - margin && (inGondola(L * 0.22, 8) || inGondola(-L * 0.18, 6))) return cell;
    return -1;
  }
  // a bullet that moved from a to b this frame: the enemy airship and cell it struck, or null
  function hitTest(a, b, team) {
    if (!active) return null;
    for (const side of SIDES) {
      const s = ships[side]; if (side === team || s.crashed) continue;
      if (Math.abs(b.x - s.pos.x) > L || Math.abs(b.z - s.pos.z) > L) continue;
      let c = cellAt(s, b, 0); if (c < 0) c = cellAt(s, v2.copy(a).add(b).multiplyScalar(0.5), 0);
      if (c >= 0) return { side, cell: c };
    }
    return null;
  }
  // does a straight line (a burst of fire) from origin along dir strike this airship within range?
  function lineHits(s, origin, dir, range) {
    if (s.crashed) return false;
    for (let d = 6; d <= range; d += 6) if (cellAt(s, v3.copy(origin).addScaledVector(dir, d), 0) >= 0) return true;
    return false;
  }
  const collide = pos => active && SIDES.some(side => !ships[side].crashed && Math.abs(pos.x - ships[side].pos.x) < L && cellAt(ships[side], pos, 2.2) >= 0);

  // ---- bots ----
  // On a collision course with an airship: the way to break off (over or under the hull), else null.
  function avoid(p) {
    if (!active) return null;
    for (const side of SIDES) {
      const s = ships[side]; if (s.crashed || p.pos.distanceTo(s.pos) > L) continue;
      const lp = v1.copy(p.pos).sub(s.pos).applyQuaternion(s.inv), sf = Math.min(1, Math.max(0, lp.z / L + 0.5));
      const radial = v2.set(lp.x, lp.y, 0), surface = radial.length() - radiusAt(sf);
      const normal = radial.lengthSq() > 1e-6 ? radial.normalize().applyQuaternion(s.quat) : v2.set(0, 1, 0);
      const closing = -v3.copy(p.fwd).multiplyScalar(p.speed).dot(normal);
      if (surface < 25 || (closing > 0 && surface / closing < 1.4)) return new THREE.Vector3().copy(normal).multiplyScalar(0.4).addScaledVector(Y, lp.y >= -2 ? 1 : -1).normalize();
    }
    return null;
  }
  const POINT_LEASH = { pos: new THREE.Vector3(POINT.x, POINT.y, POINT.z), r: 320 };
  const orbit = (cx, cz, radius, y, p) => { const a = Math.atan2(p.pos.z - cz, p.pos.x - cx) + 0.55; return new THREE.Vector3(cx + radius * Math.cos(a), y, cz + radius * Math.sin(a)); };
  // what a bot with this role should do: { engage, guard?, attack?, goal? } (see flyBot), or null for a free hunt
  function objectiveFor(p, role) {
    if (!active) return null;
    const own = ships[p.team], foe = ships[other(p.team)], foeUp = !foe.down && !foe.crashed, ownUp = !own.down && !own.crashed;
    if (role === 'attack' && foeUp) return { engage: 160, attack: foe, aimed: () => lineHits(foe, p.pos, p.fwd, 300), leash: { pos: foe.pos, r: 450 } };
    if (role === 'escort' && ownUp) return { engage: 220, guard: { pos: own.pos, r: 450 }, leash: { pos: own.pos, r: 550 }, goal: orbit(own.pos.x, own.pos.z, 170, own.pos.y + 25, p) };
    if (role === 'hunt') return null;
    if (point.owner !== p.team || Math.abs(point.v) < 0.999) {               // the town is not fully ours: go and take it, flying low
      const d = Math.hypot(p.pos.x - POINT.x, p.pos.z - POINT.z);
      return d > 400 ? { engage: 200, leash: POINT_LEASH, goal: new THREE.Vector3(POINT.x, POINT.y + 100, POINT.z) } : { engage: 120, leash: POINT_LEASH, low: true, goal: orbit(POINT.x, POINT.z, 60, POINT.y + 36, p) };
    }
    return { engage: 450, guard: { pos: POINT_LEASH.pos, r: 350 }, leash: POINT_LEASH, goal: orbit(POINT.x, POINT.z, 160, POINT.y + 110, p) };
  }

  // ---- network (host sends, everyone else applies) ----
  function pack() {
    return {
      s: SIDES.map(side => { const s = ships[side]; return [+s.pos.x.toFixed(1), +s.pos.y.toFixed(1), +s.pos.z.toFixed(1), +s.quat.x.toFixed(4), +s.quat.y.toFixed(4), +s.quat.z.toFixed(4), +s.quat.w.toFixed(4), s.cells.map(Math.round), s.burning.reduce((m, b, i) => m | (b ? 1 << i : 0), 0), (s.down ? 1 : 0) | (s.crashed ? 2 : 0), s.downBy || 0, s.turrets.map(t => (t.firing && t.target) || 0), +s.theta.toFixed(4), +s.heading.toFixed(4), +s.fall.toFixed(2)]; }),
      g: [+point.v.toFixed(3), point.owner || 0, point.contested ? 1 : 0], tk: [tickets.it, tickets.ah],
    };
  }
  function unpack(m, now) {
    if (!active || !m || !Array.isArray(m.s)) return;
    SIDES.forEach((side, k) => {
      const a = m.s[k], s = ships[side]; if (!Array.isArray(a)) return;
      const flags = a[9] | 0, crashed = !!(flags & 2);
      if (s.crashed && !crashed) resetShip(s);                                 // a new round has begun
      s.netPos.set(+a[0], +a[1], +a[2]); s.netQuat.set(+a[3], +a[4], +a[5], +a[6]).normalize();
      if (!s.hasNet || s.pos.distanceToSquared(s.netPos) > 200 * 200) { s.pos.copy(s.netPos); s.quat.copy(s.netQuat); }
      s.hasNet = true;
      if (Array.isArray(a[7])) for (let i = 0; i < CELLS; i++) s.cells[i] = +a[7][i] || 0;
      for (let i = 0; i < CELLS; i++) s.burning[i] = !!((a[8] | 0) & (1 << i));
      s.down = !!(flags & 1); s.downBy = a[10] || null;
      if (crashed && !s.crashed) crash(s, now);
      if (Array.isArray(a[11])) s.turrets.forEach((t, i) => { t.target = a[11][i] || null; });
      s.theta = +a[12] || s.theta; s.heading = +a[13] || 0; s.fall = +a[14] || 0;          // so that whoever takes over as host carries on from here
    });
    if (Array.isArray(m.g)) { point.v = +m.g[0] || 0; point.owner = m.g[1] === 'it' || m.g[1] === 'ah' ? m.g[1] : null; point.contested = !!m.g[2]; }
    if (Array.isArray(m.tk)) { tickets.it = m.tk[0] | 0; tickets.ah = m.tk[1] | 0; }
  }

  return { ships, point, tickets, get active() { return active; }, setActive, reset, update, damage, hitTest, collide, avoid, objectiveFor, pack, unpack };
}
