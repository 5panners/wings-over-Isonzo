// Wings over Isonzo — world definition (terrain maths + gameplay layout). Shared by 3D scene and map overlay.
export const sst = (a, b, x) => { let t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// ---- seeded noise ----
let seed = 1917;
export function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const P = new Uint8Array(512);
{ const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
export function perlin(x, y) {
  const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
  const g = (ix, iy, dx, dy) => { const v = G[P[(P[ix & 255] + iy) & 255] & 7]; return v[0] * dx + v[1] * dy; };
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(g(X, Y, xf, yf), g(X + 1, Y, xf - 1, yf), u), lerp(g(X, Y + 1, xf, yf - 1), g(X + 1, Y + 1, xf - 1, yf - 1), u), v) * 1.4;
}
export function fbm(x, y, o = 4) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < o; i++) { s += a * perlin(x * f, y * f); a *= 0.5; f *= 2.03; } return s; }
export function ridged(x, y, o = 4) { let a = 0.6, s = 0, f = 1, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(perlin(x * f + 13.1, y * f - 7.7)); n = Math.pow(Math.max(0, n), 1.6); s += a * n * w; w = Math.min(1, n * 1.5); a *= 0.4; f *= 2.1; } return s; }
export const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---- geography ----
export const HALF = 750;                 // combat area reaches ±750 north-south
export const HALF_X = 1350;              // and ±1350 east-west, out past the coasts
export const riverX = z => -20 + 70 * Math.sin(z / 160 + 0.5) + 35 * Math.sin(z / 70 + 2);
export const riverLevel = z => Math.max(0, (520 - z) / 1420 * 62);
export const riverHalf = z => lerp(5, 13, sst(-500, 400, z));
// Coastlines. The land is bounded by sea to the south, west and east. Each coast is a sum of unrelated sine
// waves, which gives an irregular run of bays and headlands and can be repeated exactly in the water shader.
export const coastZ = x => 545 + 28 * Math.sin(x / 170 + 1) - 60 * sst(60, 400, x) + 16 * Math.sin(x / 63 + 2.2) + 34 * Math.sin(x / 410 + 0.4);   // south coast: z of the shore at x
export const coastW = z => -1235 + 85 * Math.sin(z / 230 + 0.7) + 48 * Math.sin(z / 97 + 2.1) + 24 * Math.sin(z / 41 + 4.0) + 60 * Math.sin(z / 560 + 1.3);   // west coast: x of the shore at z
export const coastE = z => 1240 + 80 * Math.sin(z / 205 + 3.9) + 52 * Math.sin(z / 88 + 0.6) + 22 * Math.sin(z / 37 + 1.7) + 65 * Math.sin(z / 610 + 5.2);    // east coast
// How far inland a point is from the nearest coast (negative = out at sea)
export const inland = (x, z) => Math.min(coastZ(x) - z, x - coastW(z), coastE(z) - x);

export const AIRFIELDS = {
  it: { x: -430, z: 255, rot: 0.32, name: 'Campo Santa Caterina', side: 'it' },
  ah: { x: 395, z: 203, rot: -0.06, name: 'Flugfeld Haidenschaft', side: 'ah' },
};
const rx = riverX;
export const PEAKS = [
  { n: 'Monte Nero (Krn)', x: rx(-430) + 165, z: -430, a: 150, s: 80, el: 1.5, rot: -0.5, e: '2244 m' },
  { n: 'Monte Matajur', x: -290, z: -370, a: 95, s: 80, el: 1.8, rot: 0.3, e: '1641 m' },
  { n: 'Monte Canin', x: -230, z: -610, a: 150, s: 120, e: '2587 m' },
  { n: 'Monte Santo', x: rx(-5) + 128, z: -5, a: 70, s: 46, e: '681 m' },
  { n: 'Monte Sabotino', x: rx(55) - 118, z: 55, a: 104, s: 36, el: 2.3, rot: 0.9, e: '609 m' },
  { n: 'Monte San Michele', x: rx(335) + 112, z: 335, a: 30, s: 45, e: '275 m' },
  { n: 'Monte Hermada', x: 215, z: 432, a: 34, s: 42, e: '323 m' },
];
export const TOWNS = [
  { n: 'Caporetto', x: rx(-400) - 34, z: -400, k: 16, r: 22 },
  { n: 'Tolmino', x: rx(-235) + 36, z: -235, k: 18, r: 24 },
  { n: 'Canale', x: rx(-150) - 30, z: -150, k: 9, r: 15 },
  { n: 'Plava', x: rx(-70) - 30, z: -70, k: 7, r: 12 },
  { n: 'Gorizia', x: rx(175) + 62, z: 178, k: 44, r: 44 },
  { n: 'Cormons', x: -305, z: 85, k: 20, r: 26 },
  { n: 'Cividale', x: -380, z: -150, k: 16, r: 24 },
  { n: 'Aidussina', x: 500, z: 168, k: 16, r: 22 },
  { n: 'Monfalcone', x: rx(470) + 95, z: 478, k: 22, r: 28 },
  { n: 'Gradisca', x: rx(300) - 50, z: 300, k: 12, r: 18 },
];
// Aerial capture points — tethered observation balloons
export const SECTORS = [
  { id: 'A', n: 'Monte Nero', x: rx(-405) + 30, z: -405, alt: 95, type: 'drachen', own: 'n', r: 62 },
  { id: 'B', n: 'Tolmino', x: rx(-235) + 95, z: -215, alt: 85, type: 'drachen', own: 'ah', r: 62 },
  { id: 'C', n: 'Monte Santo', x: rx(70) + 12, z: 70, alt: 105, type: 'caquot', own: 'n', r: 66 },
  { id: 'D', n: 'Collio', x: -215, z: -75, alt: 80, type: 'avorio', own: 'it', r: 62 },
  { id: 'E', n: 'Carso', x: rx(370) + 60, z: 372, alt: 85, type: 'avorio', own: 'n', r: 62 },
];
// Ground target objectives (two per sector)
export const TARGETS = [
  { id: 'A1', s: 'A', kind: 'pontoon', n: 'Caporetto pontoon bridge', x: rx(-372), z: -372 },
  { id: 'A2', s: 'A', kind: 'battery', side: 'ah', n: 'Krn mountain howitzers', x: rx(-455) + 78, z: -455 },
  { id: 'B1', s: 'B', kind: 'rail', n: 'Santa Lucia railhead', x: rx(-185) + 58, z: -180 },
  { id: 'B2', s: 'B', kind: 'battery', side: 'ah', n: 'Škoda 30.5 cm mortars', x: rx(-270) + 150, z: -262 },
  { id: 'C1', s: 'C', kind: 'bridge', n: 'Salcano railway bridge', x: rx(112), z: 112 },
  { id: 'C2', s: 'C', kind: 'monastery', n: 'Monte Santo strongpoint', x: PEAKS[3].x, z: PEAKS[3].z },
  { id: 'D1', s: 'D', kind: 'depot', n: 'Cormons supply depot', x: -235, z: 5 },
  { id: 'D2', s: 'D', kind: 'battery', side: 'it', n: 'Batteria da 149 — Sabotino', x: PEAKS[4].x - 48, z: PEAKS[4].z - 34 },
  { id: 'E1', s: 'E', kind: 'redoubt', n: 'San Michele redoubt', x: PEAKS[5].x, z: PEAKS[5].z },
  { id: 'E2', s: 'E', kind: 'shipyard', n: 'Monfalcone shipyard', x: rx(470) + 70, z: 0 },
];
{ const t = TARGETS[9]; t.z = coastZ(t.x) - 6; }

function flat(h, f, level) { // flatten around airfield (rotated ellipse)
  const c = Math.cos(f.rot), s = Math.sin(f.rot), dx = f.dx, dz = f.dz;
  const u = (dx * c + dz * s) / 135, v = (-dx * s + dz * c) / 62;
  return lerp(level, h, sst(0.75, 1.45, Math.sqrt(u * u + v * v)));
}
export function H(x, z) {
  const r = riverX(z), d = x - r, ad = Math.abs(d), lvl = riverLevel(z), rw = riverHalf(z);
  const M = sst(40, -600, z);
  const n1 = fbm(x * 0.006, z * 0.006), wx = x + 60 * fbm(x * 0.004 + 3, z * 0.004, 2), wz = z + 60 * fbm(x * 0.004, z * 0.004 + 8, 2), rg = ridged(wx * 0.0023, wz * 0.0023, 3);
  let alps = M * M * (40 + 300 * rg) + M * 34 * (n1 + 0.4);
  alps *= lerp(1, 0.55, sst(-150, -520, x) * sst(-250, 0, z)); // foothills fall away to the Friuli plain in the west
  const east = sst(50, 200, d);
  const zb = z + 46 * fbm(x * 0.007 + 2, z * 0.007 + 7, 2), zc = z + 40 * fbm(x * 0.008 - 4, z * 0.008 + 1, 2);
  const bains = east * sst(150, 40, zb) * (108 + 42 * fbm(x * 0.009 + 5, z * 0.009, 3));
  const carso = sst(26, 120, d) * sst(252, 335, zc) * (44 + 16 * fbm(x * 0.012, z * 0.012 + 9, 3));
  const collio = sst(-520, -330, x) * sst(-40, -130, d) * sst(190, 90, z) * (16 + 16 * fbm(x * 0.013 + 3, z * 0.013, 3));
  let h = lvl + 4 + 2.2 * n1 + Math.max(alps, bains, carso, collio);
  for (const p of PEAKS) { const c = Math.cos(p.rot || 0), sn = Math.sin(p.rot || 0), dx = x - p.x, dz = z - p.z, u = (dx * c + dz * sn) / (p.s * (p.el || 1)), v = (-dx * sn + dz * c) / p.s, q = u * u + v * v; if (q < 6) h += p.a * Math.exp(-q) * (0.85 + 0.3 * ridged(x * 0.009, z * 0.009, 2)); }
  // river valley
  const w = lerp(20, 44, sst(-480, 320, z));
  const t = sst(w, w + lerp(105, 125, sst(-500, 300, z)), ad);
  const floor = lvl + 1.2 + 2.5 * sst(rw, w, ad);
  h = lerp(floor, Math.max(h, floor), t);
  h = lerp(lvl - 3, h, sst(rw - 1.5, rw + 3.5, ad));
  // airfields
  for (const k in AIRFIELDS) { const f = AIRFIELDS[k]; h = flat(h, { rot: f.rot, dx: x - f.x, dz: z - f.z }, riverLevel(f.z) + 5.5); }
  // sea
  // coasts: the land sinks toward every shore, flattening into a beach just above the waterline, then drops under the sea
  const s = inland(x, z);
  h = 1.1 + (h - 1.1) * Math.pow(sst(0, 230, s), 0.85);
  h = lerp(h, -7, sst(10, -30, s));
  return h;
}
