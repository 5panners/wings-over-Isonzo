// Day / night cycle: sun and moon cross the sky, light the world and cast the shadows.
// One shadow-casting light is shared: it follows the sun by day and the moon by night
// (the moon sits opposite the sun, so they are never both well above the horizon).
import * as THREE from 'three';

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const C = h => new THREE.Color(h);
// sky colours at zenith / mid-sky / horizon, plus haze, ambient light and tints, for full day, dusk or dawn, and night
const LOOK = {
  day: { top: C('#3f7fca'), mid: C('#9cc6e6'), hor: C('#f3e6c8'), fog: C('#c9dbe6'), hemiSky: C('#cfe4ff'), hemiGnd: C('#8a7a55'), hemi: 1.25, far: C('#ffffff'), cloud: 0.35 },
  dusk: { top: C('#2f477f'), mid: C('#d98a6a'), hor: C('#ffc98a'), fog: C('#d9a58a'), hemiSky: C('#c8a0a0'), hemiGnd: C('#6a5340'), hemi: 0.7, far: C('#c79a8e'), cloud: 0.3 },
  night: { top: C('#050a18'), mid: C('#0c1730'), hor: C('#1c2a4a'), fog: C('#141d33'), hemiSky: C('#44558c'), hemiGnd: C('#161b28'), hemi: 0.42, far: C('#2a3554'), cloud: 0.05 },
};
const TILT = 0.5;      // how far the daily arc leans toward the south (+z); the noon sun stands about 60 degrees high
// direction to a body that is highest at `hour`: rises in the east (+x), sets in the west
function arc(hour, out) {
  const h = hour / 12 * Math.PI, y = Math.cos(h);
  return out.set(-Math.sin(h), y * Math.cos(TILT), y * Math.sin(TILT) + 0.12).normalize();
}

export function createDayNight(scene, { sun: light, hemi }) {
  const sky = scene.getObjectByName('sky'), far = scene.children.filter(o => o.name === 'far'), clouds = scene.getObjectByName('clouds');
  const cloudMat = clouds.children[0].children[0].material;
  const skyPos = sky.geometry.attributes.position, skyCol = sky.geometry.attributes.color;
  const basic = c => new THREE.MeshBasicMaterial({ color: c, fog: false });
  // low-poly discs for the sun (with a soft halo) and the moon
  const sunDisc = new THREE.Mesh(new THREE.IcosahedronGeometry(230, 1), basic('#fff3c4'));
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(430, 1), new THREE.MeshBasicMaterial({ color: '#ffd9a0', fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
  const moonDisc = new THREE.Mesh(new THREE.IcosahedronGeometry(170, 1), basic('#e6ebf7'));
  // stars: fixed points on the sky dome that fade in after dusk
  const sp = []; for (let i = 0; i < 700; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.95 + 0.03; v.normalize().multiplyScalar(6700); sp.push(v.x, v.y, v.z); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
  for (const o of [sunDisc, halo, moonDisc, stars]) { o.frustumCulled = false; scene.add(o); }

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), c1 = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();
  const lowSun = C('#ff8a3a'), highSun = C('#fff0d2'), moonLight = C('#a9bcff');
  // blend the three looks by the sun's height: dusk -> day as it climbs, dusk -> night as it sinks
  const blend = (key, d, n, out) => out.copy(LOOK.dusk[key]).lerp(LOOK.day[key], d).lerp(LOOK.night[key], n);
  const num = (key, d, n) => { const v = LOOK.dusk[key] + (LOOK.day[key] - LOOK.dusk[key]) * d; return v + (LOOK.night[key] - v) * n; };
  let lastE = 9;

  const api = {
    tod: 6,            // hour of day, 0..24
    rate: 12,          // game hours per real hour (1 = real time, 0 = stopped)
    sunDir, moonDir,
    update(dt, focus, camera) {
      api.tod = (api.tod + api.rate * dt / 3600 + 24) % 24;
      arc(api.tod - 12, sunDir); arc(api.tod - 24.6, moonDir);      // moon peaks a little after midnight
      const e = sunDir.y, d = sst(-0.05, 0.35, e), n = sst(0.03, -0.26, e);
      // the shared light: sun while it is up, otherwise the moon
      const bySun = e > 0, dir = bySun ? sunDir : moonDir;
      if (bySun) { light.color.copy(lowSun).lerp(highSun, sst(0, 0.4, e)); light.intensity = 2.6 * sst(0, 0.14, e); }
      else { light.color.copy(moonLight); light.intensity = 0.75 * sst(0.02, 0.2, moonDir.y) * n; }
      light.castShadow = light.intensity > 0.02;
      light.target.position.set(Math.round(focus.x / 20) * 20, 0, Math.round(focus.z / 20) * 20);
      light.position.copy(light.target.position).addScaledVector(dir, 2200); light.target.updateMatrixWorld();
      // discs and stars ride with the camera so they sit at the horizon, not in the map
      sunDisc.position.copy(camera.position).addScaledVector(sunDir, 6400); halo.position.copy(sunDisc.position);
      moonDisc.position.copy(camera.position).addScaledVector(moonDir, 6300); stars.position.copy(camera.position);
      sunDisc.material.color.copy(lowSun).lerp(highSun, sst(0, 0.35, e)); halo.material.color.copy(sunDisc.material.color);
      sunDisc.visible = halo.visible = e > -0.08; moonDisc.visible = moonDir.y > -0.08;
      stars.material.opacity = n; stars.visible = n > 0.01;
      // ambient light, haze, distant ranges and clouds
      hemi.intensity = num('hemi', d, n); blend('hemiSky', d, n, hemi.color); blend('hemiGnd', d, n, hemi.groundColor);
      blend('fog', d, n, scene.fog.color);
      blend('far', d, n, c1); for (const m of far) m.material.color.copy(c1);
      cloudMat.emissiveIntensity = num('cloud', d, n);
      // repaint the sky dome only when the light has changed noticeably
      if (Math.abs(e - lastE) > 0.003) {
        lastE = e; blend('top', d, n, c1); blend('mid', d, n, c2); blend('hor', d, n, c3);
        const c = new THREE.Color();
        for (let i = 0; i < skyPos.count; i++) {
          const t = Math.max(0, skyPos.getY(i) / 7000);
          if (t < 0.18) c.copy(c3).lerp(c2, t / 0.18); else c.copy(c2).lerp(c1, Math.pow((t - 0.18) / 0.82, 0.7));
          skyCol.setXYZ(i, c.r, c.g, c.b);
        }
        skyCol.needsUpdate = true;
      }
    },
    clock() { const h = Math.floor(api.tod), m = Math.floor((api.tod - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; },
  };
  return api;
}
