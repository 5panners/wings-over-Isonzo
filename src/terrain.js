// Terrain, water, sky, trees and clouds for the Isonzo Front map (flat-shaded, no textures).
import * as THREE from 'three';
import { sst, lerp, rnd, fbm, hash2, H, railDist, riverX, riverLevel, riverHalf, inland, AIRFIELDS, TOWNS, TARGETS } from './world.js';

export function buildTerrain(scene) {
const HAZE = new THREE.Color('#c9dbe6');
scene.fog = new THREE.Fog(HAZE, 500, 3400);

// ---------- sky ----------
{
  const g = new THREE.SphereGeometry(7000, 32, 16), col = [], p = g.attributes.position;
  const top = new THREE.Color('#3f7fca'), mid = new THREE.Color('#9cc6e6'), hor = new THREE.Color('#f3e6c8');
  for (let i = 0; i < p.count; i++) { const t = Math.max(0, p.getY(i) / 7000); const c = t < 0.18 ? hor.clone().lerp(mid, t / 0.18) : mid.clone().lerp(top, Math.pow((t - 0.18) / 0.82, 0.7)); col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.name = 'sky'; sky.renderOrder = -10; scene.add(sky);
}
const SUN = new THREE.Vector3(-0.62, 0.58, 0.5).normalize();
const hemi = new THREE.HemisphereLight('#cfe4ff', '#8a7a55', 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d2', 2.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.3; scene.add(sun, sun.target);

// ---------- terrain ----------
const SIZE_X = 2850, SIZE_Z = 1950, NX = 380, NZ = 260, cell = SIZE_X / NX;   // covers the land out past both coasts
const C = h => new THREE.Color(h);
const PAL = {
  fields: ['#8db552', '#a2c35a', '#79a547', '#d8c66a', '#b38b5c', '#94ba58', '#c4d06f', '#6f9c44', '#e0cf7a'].map(C),
  meadow: C('#86b254'), forest: C('#4f8043'), forest2: C('#3f6e3c'), alpine: C('#9aa56a'), rock: C('#a7a199'), rock2: C('#8c8780'), rockWarm: C('#c2b8a4'),
  snow: C('#f6f9fd'), gravel: C('#e3dfcc'), sand: C('#dccf9f'), karst: C('#b7b584'), karst2: C('#cfcbb0'), mud: C('#8b7558'), bed: C('#4aa99a'),
};
function inField(f, x, z, a, b) { const c = Math.cos(f.rot), s = Math.sin(f.rot), dx = x - f.x, dz = z - f.z; const u = dx * c + dz * s, v = -dx * s + dz * c; return Math.abs(u) < a && Math.abs(v) < b; }
function zone(x, z, y, ny) { // classify ground
  const r = riverX(z), d = x - r, ad = Math.abs(d), lvl = riverLevel(z), rw = riverHalf(z), slope = 1 - ny, rel = y - lvl;
  if (y < 1.9 && inland(x, z) < 70) return 'sand';
  if (ad < rw + 7 && rel < 2.4) return rel < -0.5 ? 'bed' : 'gravel';
  if (slope > (y - lvl < 120 ? 0.5 : 0.36)) return 'rock';
  const n = fbm(x * 0.02, z * 0.02, 2);
  if (y > 215 + 30 * n) return 'snow';
  if (y > 172 + 20 * n) return 'alpine';
  const w = lerp(20, 44, sst(-480, 320, z));
  if (z > -130 && z < 440 && ad > rw + 9 && ad < w + 62 && fbm(x * 0.03 + 9, z * 0.03, 2) > -0.12 && slope < 0.2) return 'mud';
  if (rel < 13 && slope < 0.035) return 'fields';
  if (d > 30 && z > 262 && rel > 12) return 'karst';
  return n > 0.12 && slope < 0.1 ? 'meadow' : 'forest';
}
{
  const pos = [], col = [], hs = new Float32Array((NX + 1) * (NZ + 1));
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) hs[j * (NX + 1) + i] = H(-SIZE_X / 2 + i * cell, -SIZE_Z / 2 + j * cell);
  const v = (i, j) => new THREE.Vector3(-SIZE_X / 2 + i * cell, hs[j * (NX + 1) + i], -SIZE_Z / 2 + j * cell);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), c = new THREE.Color();
  const tri = (a, b, d, k) => {
    e1.subVectors(b, a); e2.subVectors(d, a); nn.crossVectors(e1, e2).normalize();
    const cx = (a.x + b.x + d.x) / 3, cy = (a.y + b.y + d.y) / 3, cz = (a.z + b.z + d.z) / 3;
    const zn = zone(cx, cz, cy, nn.y); const j = hash2(Math.round(cx * 3), Math.round(cz * 3) + k);
    if (zn === 'fields') { const u = cx * 0.95 + cz * 0.3, w = -cx * 0.3 + cz * 0.95; c.copy(PAL.fields[Math.floor(hash2(Math.floor(u / 36), Math.floor(w / 25)) * PAL.fields.length)]); }
    else if (zn === 'rock') c.copy(cy < 150 ? PAL.rockWarm : j > 0.5 ? PAL.rock : PAL.rock2).lerp(PAL.snow, sst(215, 300, cy) * (nn.y > 0.45 ? 0.75 : 0.15));
    else if (zn === 'forest') c.copy(j > 0.5 ? PAL.forest : PAL.forest2);
    else if (zn === 'karst') c.copy(j > 0.72 ? PAL.karst2 : PAL.karst).lerp(PAL.meadow, 0.25 * j);
    else c.copy(PAL[zn]);
    if (inField(AIRFIELDS.it, cx, cz, 135, 60) || inField(AIRFIELDS.ah, cx, cz, 135, 60)) c.copy(PAL.fields[5]);
    c.offsetHSL(0, 0, (j - 0.5) * 0.06);
    for (const p of [a, b, d]) { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); }
  };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = v(i, j), b = v(i + 1, j), d = v(i, j + 1), e = v(i + 1, j + 1);
    if ((i + j) & 1) { tri(a, d, b, 0); tri(b, d, e, 1); } else { tri(a, d, e, 0); tri(a, e, b, 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); m.receiveShadow = true; m.castShadow = true; scene.add(m);
}
// ---------- water ----------
// One small shader for sea and river. Everything is computed per pixel from the world position, so the
// geometry stays tiny (the sea is two triangles) and the cost is a handful of arithmetic per pixel:
//  - low-poly facets: the surface is cut into triangles in the shader, each with its own gently rocking normal
//  - sun / moon glints off the facets, and sky colour reflected at shallow viewing angles
//  - colour runs from pale shallows to deep water (by distance offshore, or from the river banks to mid-stream)
//  - foam lines rolling onto the beach; on the river the facets drift downstream
const waterUniforms = {
  uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
  uAmbSky: { value: new THREE.Color() }, uAmbGnd: { value: new THREE.Color() }, uSky: { value: new THREE.Color() },
};
const waterMaterial = (river, shallow, deep) => new THREE.ShaderMaterial({
  fog: true,
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...waterUniforms, uRiver: { value: river ? 1 : 0 }, uShallow: { value: new THREE.Color(shallow) }, uDeep: { value: new THREE.Color(deep) } },
  vertexShader: `
    varying vec3 vWorld; varying vec2 vUv;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform float uTime, uRiver; uniform vec3 uSunDir, uSunCol, uAmbSky, uAmbGnd, uSky, uShallow, uDeep;
    varying vec3 vWorld; varying vec2 vUv;
    #include <fog_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); vec3 V = toCam / dist;
      // facets: grid cells split along the diagonal; on the river the grid slides downstream
      vec2 q = vWorld.xz; if (uRiver > 0.5) q.y -= uTime * 9.0;
      q = vec2(q.x + q.y * 0.5, q.y * 0.866);                                               // skew the grid so the facets are near-equilateral, not a checkerboard
      vec2 g = q / (uRiver > 0.5 ? 3.5 : 8.0), cell = floor(g), f = fract(g);
      float tri = step(f.x, f.y), h1 = hash(cell + tri * 17.3), h2 = hash(cell * 1.7 + tri * 5.1 + 3.0);
      float amp = (uRiver > 0.5 ? 0.13 : 0.14) * (1.0 - smoothstep(250.0, 1000.0, dist));     // calm down far away so it does not sparkle into noise
      vec3 n = normalize(vec3(sin(uTime * (0.8 + h1) + h1 * 6.283) * amp, 1.0, cos(uTime * (0.7 + h2) + h2 * 6.283) * amp));
      float depth, foam;
      if (uRiver > 0.5) {
        float e = abs(vUv.x * 2.0 - 1.0);                                                    // 0 mid-stream, 1 at the bank
        depth = 1.0 - smoothstep(0.35, 1.0, e);
        foam = smoothstep(0.84, 1.0, e) * step(0.5, h2) * 0.45;                              // broken white water along the gravel
      } else {
        // distance offshore from the nearest of the three coasts (same formulas as coastZ / coastW / coastE in world.js)
        float x = vWorld.x, z = vWorld.z;
        float cS = 545.0 + 28.0 * sin(x / 170.0 + 1.0) - 60.0 * smoothstep(60.0, 400.0, x) + 16.0 * sin(x / 63.0 + 2.2) + 34.0 * sin(x / 410.0 + 0.4);
        float cW = -1235.0 + 85.0 * sin(z / 230.0 + 0.7) + 48.0 * sin(z / 97.0 + 2.1) + 24.0 * sin(z / 41.0 + 4.0) + 60.0 * sin(z / 560.0 + 1.3);
        float cE = 1240.0 + 80.0 * sin(z / 205.0 + 3.9) + 52.0 * sin(z / 88.0 + 0.6) + 22.0 * sin(z / 37.0 + 1.7) + 65.0 * sin(z / 610.0 + 5.2);
        float d = -min(cS - z, min(x - cW, cE - x));
        depth = smoothstep(0.0, 170.0, d);
        foam = smoothstep(0.72, 1.0, sin(d * 0.5 - uTime * 1.2 + h1 * 1.6)) * (1.0 - smoothstep(2.0, 38.0, d)) * step(-14.0, d) * 0.85;   // surf lines
      }
      vec3 light = uSunCol * max(dot(n, uSunDir), 0.0) + mix(uAmbGnd, uAmbSky, 0.5 + 0.5 * n.y);
      vec3 col = mix(uShallow, uDeep, depth) * (0.93 + 0.14 * h1) * light * 0.3183;
      col = mix(col, uSky, pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.65);                      // sky reflection at grazing angles
      col += uSunCol * pow(max(dot(reflect(-uSunDir, n), V), 0.0), 80.0) * 0.8;              // glint
      col = mix(col, light * 0.3, foam);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
{
  const pos = [], uv = [], step = 7;
  for (let z = -975; z < 600; z += step) {
    const q = zz => [riverX(zz) - riverHalf(zz) - 2.2, riverX(zz) + riverHalf(zz) + 2.2, riverLevel(zz) + 0.05];
    const [l0, r0, y0] = q(z), [l1, r1, y1] = q(z + step);
    pos.push(l0, y0, z, l1, y1, z + step, r1, y1, z + step, l0, y0, z, r1, y1, z + step, r0, y0, z);
    uv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);                    // u runs bank to bank
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  scene.add(new THREE.Mesh(g, waterMaterial(true, '#8fe6d2', '#1fae95')));        // the emerald Isonzo
  // Adriatic
  const sg = new THREE.PlaneGeometry(9000, 9000); sg.rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(sg, waterMaterial(false, '#55d0c4', '#1c6a93')));
}
// call every frame: time in seconds, the shadow-casting light (sun or moon) and the ambient light
const tmpDir = new THREE.Vector3();
function updateWater(time, light, ambient) {
  const u = waterUniforms; u.uTime.value = time % 10000;
  u.uSunDir.value.copy(tmpDir.copy(light.position).sub(light.target.position).normalize());
  u.uSunCol.value.copy(light.color).multiplyScalar(light.intensity);
  u.uAmbSky.value.copy(ambient.color).multiplyScalar(ambient.intensity); u.uAmbGnd.value.copy(ambient.groundColor).multiplyScalar(ambient.intensity);
  u.uSky.value.copy(scene.fog.color);
}
// ---------- distant ranges ----------
for (const [R, hh, colr, sd] of [[1750, 420, '#8fa9bf', 3], [2500, 620, '#a9c0d2', 8]]) {
  const pos = [], col = [], S = 120, c = new THREE.Color(colr), w = new THREE.Color('#eef4fa');
  const top = i => { const a = i / S * Math.PI * 2; const north = sst(0.45, -0.5, Math.sin(a)); return 20 + hh * north * (0.45 + 0.75 * Math.abs(fbm(i * 0.21 + sd, sd, 3)) + 0.25 * hash2(i, sd)); };
  for (let i = 0; i < S; i++) {
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2, t0 = top(i), t1 = top((i + 1) % S);
    const P0 = [Math.cos(a0) * R, -30, Math.sin(a0) * R], P1 = [Math.cos(a1) * R, -30, Math.sin(a1) * R], Q0 = [Math.cos(a0) * R * 1.03, t0, Math.sin(a0) * R * 1.03], Q1 = [Math.cos(a1) * R * 1.03, t1, Math.sin(a1) * R * 1.03];
    pos.push(...P0, ...Q0, ...P1, ...P1, ...Q0, ...Q1);
    for (const t of [0, t0, 0, 0, t0, t1]) { const k = c.clone().lerp(w, sst(hh * 0.5, hh * 0.85, t)); col.push(k.r, k.g, k.b); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })); m.name = 'far'; scene.add(m);
}
// ---------- trees ----------
{
  const cone = new THREE.ConeGeometry(1, 1, 5); cone.translate(0, 0.5, 0);
  const ico = new THREE.IcosahedronGeometry(1, 0); ico.translate(0, 0.9, 0);
  const A = [], Bk = [];
  const near = (x, z) => railDist(x, z, 10) < 9 || TOWNS.some(t => (x - t.x) ** 2 + (z - t.z) ** 2 < (t.r + 3) ** 2) || TARGETS.some(t => (x - t.x) ** 2 + (z - t.z) ** 2 < (t.kind === 'battery' ? 1100 : 500)) || inField(AIRFIELDS.it, x, z, 150, 75) || inField(AIRFIELDS.ah, x, z, 150, 75);
  for (let i = 0; i < 130000; i++) {
    const x = (rnd() - 0.5) * 2800, z = (rnd() - 0.5) * 1900, y = H(x, z);
    const e = 2, ny = 1 / Math.hypot((H(x + e, z) - H(x - e, z)) / (2 * e), 1, (H(x, z + e) - H(x, z - e)) / (2 * e));
    const zn = zone(x, z, y, ny); if (near(x, z)) continue;
    const dens = fbm(x * 0.012 + 40, z * 0.012, 2);
    if (zn === 'forest' && dens > -0.25) (y - riverLevel(z) > 45 || rnd() > 0.5 ? A : Bk).push([x, y, z, 0]);
    else if ((zn === 'meadow' || zn === 'alpine') && rnd() < 0.1) A.push([x, y, z, 0]);
    else if (zn === 'fields' && rnd() < 0.045) Bk.push([x, y, z, 1]);
    else if (zn === 'karst' && rnd() < 0.2) Bk.push([x, y, z, 2]);
  }
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const mk = (geo, list, cols, sx, sy) => {
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), list.length);
    list.forEach((t, i) => { const s = 0.75 + rnd() * 0.7; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6); M4.compose(new THREE.Vector3(t[0], t[1] - 0.2, t[2]), q, new THREE.Vector3(sx * s * (t[3] == 2 ? 0.7 : 1), sy * s * (t[3] == 2 ? 0.6 : 1), sx * s)); im.setMatrixAt(i, M4); c.set(cols[Math.floor(rnd() * cols.length)]); im.setColorAt(i, c); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  };
  mk(cone, A, ['#2f5d38', '#37693c', '#2a5233', '#3e7440'], 2.1, 7.5);
  mk(ico, Bk, ['#5e9440', '#6aa048', '#4f8539', '#7dab4c', '#89a845'], 2.6, 2.9);
}
// ---------- clouds ----------
const clouds = new THREE.Group(); clouds.name = 'clouds'; scene.add(clouds);
{
  const g = new THREE.IcosahedronGeometry(1, 1), m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#8f9fb0', emissiveIntensity: 0.35 });
  for (let i = 0; i < 46; i++) {
    const grp = new THREE.Group(), n = 4 + Math.floor(rnd() * 5), s = 13 + rnd() * 20;
    for (let k = 0; k < n; k++) { const b = new THREE.Mesh(g, m); const r = s * (0.5 + rnd() * 0.6); b.scale.set(r * 1.5, r * 0.62, r); b.position.set((k - n / 2) * s * 0.85 + rnd() * 8, rnd() * s * 0.25, (rnd() - 0.5) * s * 0.9); b.castShadow = true; grp.add(b); }
    const a = rnd() * 6.28, R = 350 + rnd() * 1700; grp.position.set(Math.cos(a) * R, 400 + rnd() * 260, Math.sin(a) * R - 250); grp.rotation.y = rnd() * 0.5; clouds.add(grp);
  }
}

  return { sun, hemi, clouds, updateWater };
}
