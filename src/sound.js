// Sound with Web Audio: a recorded engine loop, plus synthesised wind, guns, hits and explosions.
let ctx = null, master, eng, wind, noise, muted = false;
try { muted = localStorage.getItem('woi-mute') === '1'; } catch { /* no storage */ }

// Browsers only allow audio after a click or key press, so this is called from those.
export function startSound() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
  // two seconds of white noise, reused by wind, guns and explosions
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // engine: a recorded propeller loop (assets/engine.mp3); its playback speed follows the revs
  const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
  eng = { g, src: null, rate: 1 };
  fetch(new URL('../assets/engine.mp3', import.meta.url)).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => {
    const loop = seamless(buf);
    const src = ctx.createBufferSource(); src.buffer = loop; src.loop = true; src.connect(g); src.start(); eng.src = src;
    // voices for other aircraft: each is the same loop with its own volume, stereo position and speed
    for (let i = 0; i < VOICES; i++) {
      const s = ctx.createBufferSource(), vg = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      s.buffer = loop; s.loop = true; vg.gain.value = 0; s.connect(vg); if (pan) { vg.connect(pan); pan.connect(master); } else vg.connect(master);
      s.start(0, loop.duration * i / VOICES);                       // staggered so voices do not phase together
      voices.push({ src: s, g: vg, pan, id: null, rate: 1, vol: 0 });
    }
  }).catch(() => { /* no engine sound if the file cannot be loaded */ });
  // wind: looped noise through a band-pass that opens up with speed
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), wg = ctx.createGain();
  src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.6; wg.gain.value = 0;
  src.connect(bp); bp.connect(wg); wg.connect(master); src.start();
  wind = { bp, g: wg };
}

// Make a recording loop without a click: cut the silence MP3 encoding leaves at each end, then fade the
// last part of the clip into the first part so the join is continuous.
function seamless(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  let a = 0, b = d.length - 1; while (a < b && Math.abs(d[a]) < 0.004) a++; while (b > a && Math.abs(d[b]) < 0.004) b--;
  const fade = Math.min(Math.floor(sr * 0.25), Math.floor((b - a) / 3)), n = b - a - fade;
  if (n < sr * 0.3) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < n; i++) dst[i] = src[a + i];
    for (let i = 0; i < fade; i++) { const w = i / fade; dst[i] = src[a + i] * Math.sqrt(w) + src[a + n + i] * Math.sqrt(1 - w); }   // equal-power crossfade
  }
  return out;
}

export function toggleMute() {
  muted = !muted; try { localStorage.setItem('woi-mute', muted ? '1' : '0'); } catch { /* no storage */ }
  if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
  return muted;
}
export const isMuted = () => muted;
export const engineRate = () => (eng && eng.src ? eng.src.playbackRate.value : null);   // for tests

// Called every frame with the player's aircraft state.
export function updateSound(alive, throttle, speed, topSpeed) {
  if (!ctx) return;
  const t = ctx.currentTime, k = speed / topSpeed;
  // revs follow the engine power and, a little, the airspeed (a dive winds the propeller up)
  // set directly each frame with our own smoothing: scheduled changes to a looping sample's speed are ignored by some browsers
  eng.rate += (0.55 + throttle * 0.75 + k * 0.2 - eng.rate) * 0.12;
  if (eng.src) eng.src.playbackRate.value = eng.rate;
  eng.g.gain.setTargetAtTime(alive ? 0.13 + throttle * 0.22 : 0, t, 0.12);
  wind.bp.frequency.setTargetAtTime(300 + k * 900, t, 0.2);
  wind.g.gain.setTargetAtTime(alive ? Math.min(0.22, 0.03 + k * k * 0.1) : 0.02, t, 0.2);
}

// Other aircraft. list = [{ id, dist, doppler, pan }] for aircraft near the listener:
//   dist    distance in units
//   doppler pitch factor from relative motion (above 1 approaching, below 1 receding)
//   pan     -1 (left) .. 1 (right)
// The nearest few get a voice each. As one sweeps past, volume peaks and the pitch drops: the whizz.
const VOICES = 4, voices = [];
let rush = null;
export function updateOthers(list) {
  if (!ctx || !voices.length) return;
  if (!rush) {                                                     // air rush layered on a close pass
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 1.2; g.gain.value = 0; src.connect(bp); bp.connect(g); g.connect(master); src.start();
    rush = { bp, g, vol: 0 };
  }
  list.sort((a, b) => a.dist - b.dist); list.length = Math.min(list.length, VOICES);
  for (const v of voices) if (v.id !== null && !list.some(o => o.id === v.id)) v.id = null;         // its aircraft is no longer among the nearest
  let close = 0, closeRate = 1;
  for (const o of list) {
    let v = voices.find(x => x.id === o.id) || voices.find(x => x.id === null && x.vol < 0.01) || voices.find(x => x.id === null);
    if (!v) continue;
    if (v.id !== o.id) { v.id = o.id; v.rate = 1.15 * o.doppler; }
    const vol = 0.55 / (1 + (o.dist / 40) * (o.dist / 40)) * Math.max(0, 1 - o.dist / 320);
    v.vol += (vol - v.vol) * 0.25; v.rate += (1.15 * o.doppler - v.rate) * 0.3;
    v.g.gain.value = v.vol; v.src.playbackRate.value = v.rate; if (v.pan) v.pan.pan.value = o.pan;
    const c = Math.max(0, 1 - o.dist / 45); if (c > close) { close = c; closeRate = o.doppler; }
  }
  for (const v of voices) if (v.id === null && v.vol > 0) { v.vol *= 0.8; if (v.vol < 0.002) v.vol = 0; v.g.gain.value = v.vol; }
  rush.vol += (close * close * 0.35 - rush.vol) * 0.3; rush.g.gain.value = rush.vol; rush.bp.frequency.value = 900 * closeRate;
}
export const otherVoices = () => voices.map(v => ({ id: v.id, vol: +v.vol.toFixed(3), rate: +v.rate.toFixed(2) }));   // for tests

const near = dist => 1 / (1 + (dist / 70) * (dist / 70));          // loudness falls off with distance
function burst(dur, type, f0, f1, gain) {                           // a filtered slice of noise with a decaying envelope
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  src.buffer = noise; flt.type = type; flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(flt); flt.connect(g); g.connect(master); src.start(t, Math.random() * 1.5, dur + 0.02);
}
function tone(dur, type, f0, f1, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
export function gunSound(dist, own) {
  if (!ctx) return; const v = own ? 1 : near(dist); if (v < 0.03) return;
  burst(0.07, 'bandpass', own ? 1500 : 1100, 500, 0.3 * v);
  tone(0.06, 'square', own ? 150 : 120, 60, 0.14 * v);
}
export function boomSound(dist) {
  if (!ctx) return; const v = Math.max(0.12, near(dist * 0.4));
  burst(1.4, 'lowpass', 900, 50, 0.9 * v); tone(0.5, 'sine', 90, 30, 0.5 * v);
}
export function hitTakenSound() { if (ctx) { tone(0.09, 'triangle', 900, 260, 0.3); burst(0.05, 'highpass', 2500, 1500, 0.2); } }   // rounds striking our aircraft
export function hitScoredSound() { if (ctx) tone(0.05, 'sine', 1700, 1300, 0.12); }                                                // our rounds striking home
