// Weather: fair, overcast, rain and thunderstorm, plus a "changeable" setting that drifts between them.
//
// Each weather is described by three numbers that fade smoothly from one to the next:
//   cover  how much cloud: dims the sun, greys the sky and haze, builds a dark cloud deck
//   rain   rain streaks around the camera, rain noise, shorter visibility
//   storm  lightning and thunder, a darker sky, stronger wind and heavy turbulence
// The sky module (daynight.js) reads sky.cover / sky.dark / sky.vis / sky.flash and tints the whole scene.
//
// Weather is cosmetic apart from the turbulence. In a shared battle the host chooses it and sends it to everyone;
// each player's own lightning is random (like the wind), so strikes differ between players.
import * as THREE from 'three';
import { H } from './world.js';
import { wind } from './flags.js';

export const WEATHER = [
  { key: 'fair', name: 'Fair', cover: 0, rain: 0, storm: 0 },
  { key: 'overcast', name: 'Overcast', cover: 0.78, rain: 0, storm: 0 },
  { key: 'rain', name: 'Rain', cover: 0.93, rain: 0.75, storm: 0 },
  { key: 'storm', name: 'Thunderstorm', cover: 1, rain: 1, storm: 1 },
];
const FADE = 0.07;                         // how fast the weather changes: about 14 seconds from one to the next
const SOUND_SPEED = 1500;                  // for thunder: units per second (the clap follows the flash closely, a near strike almost at once)
const BOX = new THREE.Vector3(160, 110, 160), N_RAIN = 2600, FALL = 55, WIND_X = 8, WIND_Z = 4;   // wind and fall chosen so that the rain tiles seamlessly in time

const STORM_GREY = new THREE.Color(0.2, 0.21, 0.25);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

export function createWeather(scene, { sky, camera, clouds, fx }) {
  const cur = { cover: 0, rain: 0, storm: 0 };
  const state = { index: 0, auto: false, autoAt: 0, set: false };
  sky.cover = sky.dark = sky.vis = sky.flash = 0;

  // ---------- the cloud deck: one instanced mesh of flattened blobs, grown in as the cover rises ----------
  const BLOBS = 360, deckGeo = new THREE.IcosahedronGeometry(1, 1);
  const deckMat = new THREE.MeshLambertMaterial({ color: '#b9bec8', flatShading: true, emissive: '#6d7787', emissiveIntensity: 0.2 });
  const deck = new THREE.InstancedMesh(deckGeo, deckMat, BLOBS); deck.frustumCulled = false; deck.castShadow = false; deck.receiveShadow = false; deck.visible = false;
  const blobs = [];
  for (let c = 0; c < 48; c++) {                                     // 48 clusters over the whole map and beyond
    const cx = rand(-2600, 2600), cz = rand(-2100, 2100), cy = rand(430, 520), n = Math.round(BLOBS / 48);
    for (let i = 0; i < n; i++) blobs.push({ x: cx + rand(-190, 190), y: cy + rand(-30, 40), z: cz + rand(-190, 190), s: rand(95, 190), th: Math.random() });
  }
  const M4 = new THREE.Matrix4(), Qn = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  let deckCover = -1;
  function placeDeck(cover) {
    for (let i = 0; i < BLOBS; i++) {
      const b = blobs[i], k = smooth(b.th * 0.8, b.th * 0.8 + 0.25, cover), s = b.s * k;
      deck.setMatrixAt(i, M4.compose(P.set(b.x, b.y, b.z), Qn, S.set(s * 1.5, s * 0.34, s)));
    }
    deck.instanceMatrix.needsUpdate = true; deckCover = cover;
  }
  scene.add(deck);

  // ---------- rain: line segments positioned entirely in the vertex shader ----------
  const rg = new THREE.BufferGeometry(), seed = new Float32Array(N_RAIN * 6), end = new Float32Array(N_RAIN * 2), pos = new Float32Array(N_RAIN * 6);
  for (let i = 0; i < N_RAIN; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); for (let k = 0; k < 2; k++) { seed.set([x, y, z], i * 6 + k * 3); end[i * 2 + k] = k; } }
  rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3)); rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const rainU = { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAlpha: { value: 0 }, uBox: { value: BOX }, uLight: { value: new THREE.Color('#aab6c8') } };
  const rainMat = new THREE.ShaderMaterial({
    uniforms: rainU, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 aSeed; attribute float aEnd; uniform vec3 uCam, uVel, uBox; uniform float uTime; varying float vFade;
      void main() {
        vec3 fall = vec3(${WIND_X.toFixed(1)}, -${FALL.toFixed(1)}, ${WIND_Z.toFixed(1)});
        vec3 w = mod(aSeed * uBox + fall * uTime - uCam, uBox) - uBox * 0.5;          // a box of rain that follows the camera
        vec3 v = fall - uVel; float sp = length(v);                                    // streaks lean the way the rain moves past us
        vec3 p = uCam + w - (v / max(sp, 1.0)) * aEnd * min(sp * 0.03, 7.0);
        vFade = 1.0 - smoothstep(35.0, 78.0, length(w));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uAlpha; uniform vec3 uLight; varying float vFade; void main() { gl_FragColor = vec4(uLight, uAlpha * vFade); }`,
  });
  const rain = new THREE.LineSegments(rg, rainMat); rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 6; scene.add(rain);

  // ---------- lightning ----------
  const boltCore = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#f4f8ff', fog: false, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const boltGlow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#7f9fff', fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  for (const m of [boltCore, boltGlow]) { m.frustumCulled = false; m.visible = false; m.renderOrder = 7; scene.add(m); }
  let strikeAt = 0, nextStrike = 4, amp = 1, hasBolt = false;
  const camRight = new THREE.Vector3(), segDir = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
  function ribbon(points, width, out) {                                 // a strip of quads through the points, turned to face the camera
    const a = [], idx = [];
    points.forEach((p, i) => {
      const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      segDir.copy(next).sub(prev).normalize(); toCam.copy(camera.position).sub(p).normalize(); side.crossVectors(segDir, toCam).normalize();
      const w = width * (p.userData?.w ?? 1) * 0.5; a.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
    });
    for (let i = 0; i < points.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    out.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.setIndex(idx); out.geometry = g;
  }
  function jagged(from, to, steps, jitter, wTop, wBot) {               // a wandering line from from to to
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, p = new THREE.Vector3().lerpVectors(from, to, t);
      if (i > 0 && i < steps) { p.x += rand(-jitter, jitter); p.z += rand(-jitter, jitter); p.y += rand(-jitter * 0.4, jitter * 0.4); }
      p.userData = { w: wTop + (wBot - wTop) * t }; pts.push(p);
    }
    return pts;
  }
  function strike() {
    const dist = rand(260, 1300), ang = Math.random() * 6.283, bolt = Math.random() < 0.62;
    const gx = camera.position.x + Math.cos(ang) * dist, gz = camera.position.z + Math.sin(ang) * dist, gy = Math.max(0, H(gx, gz));
    strikeAt = performance.now() / 1000; amp = THREE.MathUtils.clamp(1.25 - dist / 1500, 0.3, 1);
    hasBolt = bolt;
    if (bolt) {
      const top = new THREE.Vector3(gx + rand(-80, 80), rand(440, 520), gz + rand(-80, 80)), ground = new THREE.Vector3(gx, gy, gz);
      const main = jagged(top, ground, 16, 26, 1.6, 0.8);
      const core = [main], glow = [main];
      for (let b = 0; b < 2; b++) { const at = main[4 + Math.floor(Math.random() * 8)], end = at.clone().add(new THREE.Vector3(rand(-110, 110), -rand(70, 190), rand(-110, 110))); const br = jagged(at, end, 6, 14, 0.9, 0.3); core.push(br); glow.push(br); }
      // one ribbon per branch, merged into a single geometry
      const merge = (lists, width, out) => { const parts = lists.map(pts => { const tmp = { geometry: new THREE.BufferGeometry() }; ribbon(pts, width, tmp); return tmp.geometry; }); let pos = [], idx = [], off = 0; for (const g of parts) { pos.push(...g.attributes.position.array); idx.push(...[...g.index.array].map(i => i + off)); off += g.attributes.position.count; g.dispose(); } out.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); out.geometry = g; };
      merge(core, 3.2, boltCore); merge(glow, 12, boltGlow);
      boltCore.visible = boltGlow.visible = true;
      fx.light(new THREE.Vector3(gx, gy + 25, gz), 2600 * amp, 0.4, 520);                   // the ground lights up where it strikes
    }
    fx.thunder(dist, 0.04 + dist / SOUND_SPEED + Math.random() * 0.35);
  }
  const flashAt = age => age < 0.04 ? age / 0.04 : age < 0.1 ? 1 - (age - 0.04) / 0.06 * 0.7 : age < 0.16 ? 0.3 + (age - 0.1) / 0.06 * 0.65 : Math.exp(-(age - 0.16) * 6.5);   // a flicker: flash, dip, flash again, fade

  const api = {
    cur, turbulence: 0, strike, hold: null,                            // strike() and hold (a fixed flash level) are for tests
    get index() { return state.index; }, get auto() { return state.auto; },
    label() { return state.auto ? WEATHER[state.index].name + ' (changeable)' : WEATHER[state.index].name; },
    // value: 'auto' or an index into WEATHER; snap: jump there at once instead of fading
    set(value, snap = false) {
      state.auto = value === 'auto';
      const i = state.auto ? (state.set ? state.index : 0) : Math.min(WEATHER.length - 1, Math.max(0, value | 0));
      state.index = i; state.autoAt = performance.now() / 1000 + rand(60, 140); state.set = true;
      if (snap) { const w = WEATHER[i]; cur.cover = w.cover; cur.rain = w.rain; cur.storm = w.storm; }
    },
    // from the host in a shared battle: follow its weather, never run our own changes
    follow(i) { i = Math.min(WEATHER.length - 1, Math.max(0, i | 0)); if (state.auto || state.index !== i || !state.set) { state.auto = false; state.index = i; state.set = true; } },
    update(dt, t, host, camVel) {
      if (state.auto && host && t > state.autoAt) {                      // changeable: step to a neighbouring weather now and then
        const up = state.index === 0 ? true : state.index === WEATHER.length - 1 ? false : Math.random() < 0.5;
        state.index += up ? 1 : -1; state.autoAt = t + rand(90, 200);
      }
      const w = WEATHER[state.index];
      for (const k of ['cover', 'rain', 'storm']) cur[k] += THREE.MathUtils.clamp(w[k] - cur[k], -FADE * dt, FADE * dt);
      sky.cover = cur.cover; sky.dark = Math.min(1, cur.storm * 0.85 + cur.rain * 0.3); sky.vis = Math.min(1, cur.cover * 0.15 + cur.rain * 0.5 + cur.storm * 0.3);
      wind.boost = cur.rain * 0.2 + cur.storm * 0.3;
      api.turbulence = cur.rain * 0.25 + cur.storm * 0.75;
      // cloud deck
      deck.visible = cur.cover > 0.04;
      if (deck.visible && Math.abs(cur.cover - deckCover) > 0.015) placeDeck(cur.cover);
      deckMat.color.setRGB(0.74, 0.76, 0.8).lerp(STORM_GREY, Math.min(1, sky.dark * 1.1));
      // rain
      rain.visible = cur.rain > 0.02;
      if (rain.visible) {
        rainU.uCam.value.copy(camera.position); rainU.uVel.value.copy(camVel); rainU.uTime.value = t % 1600; rainU.uAlpha.value = 0.12 + 0.3 * cur.rain;
        rainU.uLight.value.set(0.62, 0.68, 0.78).multiplyScalar(0.45 + 0.55 * (1 - sky.dark * 0.6) * (1 - sky.cover * 0.3) * (0.35 + 0.65 * (1 - (sky.night || 0))));
        rg.setDrawRange(0, Math.floor(N_RAIN * Math.min(1, 0.25 + cur.rain)) * 2);
      }
      fx.rain(cur.rain); fx.gusts(Math.min(1, cur.storm * 0.85 + cur.rain * 0.3));
      // lightning: only when the storm is well established
      const now = performance.now() / 1000;
      if (cur.storm > 0.55) { if (now > nextStrike) { strike(); nextStrike = now + rand(9, 26) * (1.5 - 0.5 * cur.storm); } }
      else nextStrike = Math.max(nextStrike, now + 3);
      const age = now - strikeAt, f = api.hold != null ? api.hold : age < 1.2 ? flashAt(age) * amp : 0;
      sky.flash = f;
      deckMat.emissiveIntensity = 0.2 * (1 - 0.7 * sky.dark) + 3.2 * f;
      if (boltCore.visible) { if (age > 0.5 && api.hold == null) boltCore.visible = boltGlow.visible = false; else { boltCore.material.opacity = Math.min(1, f * 1.4); boltGlow.material.opacity = 0.45 * f; } }
    },
  };
  return api;
}
