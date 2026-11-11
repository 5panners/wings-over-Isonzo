// Sound, synthesised with Web Audio (no audio files): engine, wind, guns, hits and explosions.
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
  // engine: two detuned oscillators through a low-pass, chopped by a slow oscillator for the cylinder beat
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), beat = ctx.createOscillator(), beatDepth = ctx.createGain();
  const lp = ctx.createBiquadFilter(), g = ctx.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; beat.type = 'sine'; lp.type = 'lowpass'; lp.frequency.value = 600; g.gain.value = 0;
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
  beat.connect(beatDepth); beatDepth.connect(g.gain); beatDepth.gain.value = 0;
  o1.start(); o2.start(); beat.start();
  eng = { o1, o2, beat, beatDepth, lp, g };
  // wind: looped noise through a band-pass that opens up with speed
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), wg = ctx.createGain();
  src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.6; wg.gain.value = 0;
  src.connect(bp); bp.connect(wg); wg.connect(master); src.start();
  wind = { bp, g: wg };
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
  const f = 42 + throttle * 34 + k * 14;                           // revs follow the throttle, and a little the airspeed
  eng.o1.frequency.setTargetAtTime(f, t, 0.08); eng.o2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.08);
  eng.beat.frequency.setTargetAtTime(f * 0.25, t, 0.08);
  eng.lp.frequency.setTargetAtTime(420 + throttle * 520, t, 0.1);
  const vol = alive ? 0.07 + throttle * 0.1 : 0;
  eng.g.gain.setTargetAtTime(vol, t, 0.12); eng.beatDepth.gain.setTargetAtTime(vol * 0.45, t, 0.12);
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
