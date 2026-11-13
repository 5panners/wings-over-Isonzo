// National flags that wave in the wind, and the wind itself. No textures: each flag is a grid of flat-coloured
// cells (so the design shows as low-poly facets), and a small shader bends it into waves every frame.
//
//   Italy             the tricolore with the crowned Savoy shield (red, white cross, blue border) on the white band
//   Austria-Hungary   the Imperial war ensign: red-white-red with the Austrian and Hungarian arms under a crown
//                     (simplified: eagles and charges are too fine for a flat-shaded grid)
//   none              plain white, for a capture point nobody holds
//
// The wind is cosmetic. It drifts slowly with gusts; flags and windsocks stream downwind.
import * as THREE from 'three';

export const FLAG_W = 6.4, FLAG_H = 4.27;
const COLS = 36, ROWS = 24;
const C = h => new THREE.Color(h);
const WHITE = C('#f4f1e6'), RED = C('#c8262f'), GREEN = C('#0a8f4a'), BLUE = C('#1d3f94'), GOLD = C('#e2b32a'), INK = C('#26221e'), HGREEN = C('#2f7a3c');

// ---- designs: cell (i = column from the hoist, j = row from the top) -> colour ----
const inShield = (i, j, c0, c1, r0, r1) => {                      // a heater shield: full width, then narrowing to a point
  if (j < r0 || j > r1 || i < c0 || i > c1) return false;
  const taper = Math.max(0, j - (r0 + Math.round((r1 - r0) * 0.55))), w = c1 - c0 + 1, cut = Math.min(Math.floor(w / 2), taper);
  return i >= c0 + cut && i <= c1 - cut;
};
const edge = (i, j, test) => test(i, j) && !(test(i - 1, j) && test(i + 1, j) && test(i, j - 1) && test(i, j + 1));
function italy(i, j) {
  const shield = (a, b) => inShield(a, b, 15, 21, 8, 16);
  if (shield(i, j)) {
    if (edge(i, j, shield)) return BLUE;
    return i === 18 || j === 11 ? WHITE : RED;                      // the white cross of Savoy on red
  }
  if ((j === 7 && i >= 15 && i <= 21) || (j === 6 && (i === 15 || i === 18 || i === 21))) return GOLD;   // crown
  return i < 12 ? GREEN : i < 24 ? WHITE : RED;
}
function austriaHungary(i, j) {
  const left = (a, b) => inShield(a, b, 12, 17, 8, 16), right = (a, b) => inShield(a, b, 18, 23, 8, 16);
  if (left(i, j)) return edge(i, j, left) ? INK : (j < 11 || j > 13 ? RED : WHITE);                          // Austria: red-white-red bands
  if (right(i, j)) return edge(i, j, right) ? INK : (i >= 21 ? HGREEN : (j % 2 === 0 ? RED : WHITE));      // Hungary: red and silver bars, green mount
  if ((j === 7 && i >= 14 && i <= 21) || (j === 6 && (i === 14 || i === 17 || i === 18 || i === 21))) return GOLD;
  return j < 8 || j > 15 ? RED : WHITE;
}
const DESIGNS = { it: italy, ah: austriaHungary, none: () => WHITE };

function flagGeometry(design) {
  const pos = [], col = [], dx = FLAG_W / COLS, dy = FLAG_H / ROWS;
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    const c = design(i, j), x0 = i * dx, x1 = x0 + dx, y0 = -j * dy, y1 = y0 - dy;
    pos.push(x0, y0, 0, x0, y1, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x1, y0, 0);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ---- the wind ----
export const wind = { angle: 2.35, speed: 0.5 };             // angle: direction it blows toward, in the x-z plane (atan2(z, x)); speed 0..1
const timeU = { value: 0 }, windU = { value: 0.5 };
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
material.onBeforeCompile = sh => {
  sh.uniforms.uTime = timeU; sh.uniforms.uWind = windU;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float k = clamp(position.x / ${FLAG_W.toFixed(2)}, 0.0, 1.0);                       // 0 at the pole, 1 at the fly
      float ph = position.x * 1.15 - uTime * (2.2 + 5.0 * uWind) + position.y * 0.45;      // a wave running down the flag
      float amp = (0.12 + 0.55 * uWind) * k;
      transformed.z += (sin(ph) + 0.4 * sin(ph * 2.1 + 1.3)) * amp;
      transformed.y += sin(ph * 0.7 + 2.0) * 0.08 * k * uWind;
      transformed.x -= amp * amp * 0.25;                                                 // the cloth gathers a little as it waves`);
};

// A waving flag of this side ('it' | 'ah' | 'none'), hanging from its top-left corner at the origin and
// streaming along +x. Mount it on an arm registered with registerArm so it follows the wind.
export function makeFlagMesh(side) {
  const m = new THREE.Mesh(flagGeometry(DESIGNS[side] || DESIGNS.none), material);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;          // it moves in the shader, so its bounds are not the geometry's
  return m;
}

const arms = [];
const yawOf = o => { let y = 0; for (; o; o = o.parent) y += o.rotation.y; return y; };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// An arm streams along its local +x. kind 'flag' turns it downwind; 'sock' also lets it droop when the wind is light.
export function registerArm(arm, kind = 'flag') { arms.push({ arm, kind, yaw: null }); }

export function updateFlags(t, dt) {
  wind.angle = 2.35 + 0.55 * Math.sin(t * 0.021) + 0.25 * Math.sin(t * 0.07 + 1);
  wind.speed = THREE.MathUtils.clamp(0.5 + 0.28 * Math.sin(t * 0.11) + 0.18 * Math.sin(t * 0.43 + 2), 0.12, 1);
  timeU.value = t % 1000; windU.value = wind.speed;
  for (const r of arms) {
    const target = -wind.angle - yawOf(r.arm.parent);
    r.yaw = r.yaw === null ? target : r.yaw + wrap(target - r.yaw) * Math.min(1, 1.5 * dt);
    r.arm.rotation.y = r.yaw;
    if (r.kind === 'sock') r.arm.rotation.z = -(1 - wind.speed) * 0.9;
  }
}
