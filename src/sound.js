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
  eng = { g, src: null };
  fetch(new URL('../assets/engine.mp3', import.meta.url)).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => {
    const src = ctx.createBufferSource(); src.buffer = seamless(buf); src.loop = true; src.connect(g); src.start(); eng.src = src;
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

// Called every frame with the player's aircraft state.
export function updateSound(alive, throttle, speed, topSpeed) {
  if (!ctx) return;
  const t = ctx.currentTime, k = speed / topSpeed;
  // revs follow the engine power and, a little, the airspeed (a dive winds the propeller up)
  if (eng.src) eng.src.playbackRate.setTargetAtTime(0.62 + throttle * 0.5 + k * 0.16, t, 0.15);
  eng.g.gain.setTargetAtTime(alive ? 0.22 + throttle * 0.38 : 0, t, 0.12);
  wind.bp.frequency.setTargetAtTime(300 + k * 900, t, 0.2);
  wind.g.gain.setTargetAtTime(alive ? Math.min(0.22, 0.03 + k * k * 0.1) : 0.02, t, 0.2);
}

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
