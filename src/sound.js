// Sound with Web Audio: a recorded engine loop, plus synthesised wind, guns, hits and explosions.
let ctx = null, master, eng, wind, noise, muted = false, loopBuf = null, rainNodes = null, gustNode = null;

// One volume per kind of sound. 100% is the designed level; each can go from silent to double.
export const CHANNELS = [
  { key: 'master', label: 'Master volume', hint: 'Everything at once' },
  { key: 'engine', label: 'Your engine', hint: 'The propeller note, rising and falling with the throttle' },
  { key: 'flyby', label: 'Other aircraft', hint: 'Engines of nearby aircraft, with the Doppler pitch drop as they pass' },
  { key: 'wind', label: 'Wind', hint: 'Air noise that builds with speed' },
  { key: 'rain', label: 'Rain', hint: 'Rain on the aircraft, louder in a heavy storm' },
  { key: 'gusts', label: 'Storm wind', hint: 'The howl and gusts of wind in rain and storms' },
  { key: 'thunder', label: 'Thunder', hint: 'Thunder rolling in after the lightning, later the further away the strike' },
  { key: 'guns', label: 'Guns', hint: 'Your guns and everyone else\'s' },
  { key: 'jingle', label: 'Capture jingles', hint: 'The fanfare when your side takes the point, and the sad phrase when it is lost' },
  { key: 'rockets', label: 'Rockets', hint: 'Rockets launching and streaking away, and the chime of the rocket pickup' },
  { key: 'cannons', label: 'Airship cannons', hint: 'The heavy guns on the airships, and their shells bursting' },
  { key: 'hits', label: 'Hits', hint: 'Rounds striking your aircraft, and your rounds striking home' },
  { key: 'booms', label: 'Explosions', hint: 'Crashes and aircraft blowing up' },
];
const vol = Object.fromEntries(CHANNELS.map(c => [c.key, 1])), bus = {};
try { const s = JSON.parse(localStorage.getItem('woi-audio') || '{}'); for (const k in vol) if (Number.isFinite(s[k])) vol[k] = Math.min(2, Math.max(0, s[k])); } catch { /* no storage */ }
export const getVolume = key => vol[key];
export function setVolume(key, v) {
  if (!(key in vol)) return;
  vol[key] = Math.min(2, Math.max(0, +v || 0));
  try { localStorage.setItem('woi-audio', JSON.stringify(vol)); } catch { /* no storage */ }
  if (!ctx) return;
  if (key === 'master') applyMaster(); else bus[key].gain.setTargetAtTime(vol[key], ctx.currentTime, 0.04);
}
export const resetVolumes = () => { for (const c of CHANNELS) setVolume(c.key, 1); };
const applyMaster = () => master.gain.setTargetAtTime(muted ? 0 : 0.8 * vol.master, ctx.currentTime, 0.05);
export const busGain = key => (key === 'master' ? master : bus[key])?.gain.value;   // for tests
try { muted = localStorage.getItem('woi-mute') === '1'; } catch { /* no storage */ }

// Browsers only allow audio after a click or key press, so this is called from those.
export function startSound() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8 * vol.master;
  for (const c of CHANNELS) if (c.key !== 'master') { bus[c.key] = ctx.createGain(); bus[c.key].gain.value = vol[c.key]; bus[c.key].connect(master); }
  // a limiter after the mix, so loud passes and explosions do not distort
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 8; limiter.attack.value = 0.004; limiter.release.value = 0.2;
  master.connect(limiter); limiter.connect(ctx.destination);
  // two seconds of white noise, reused by wind, guns and explosions
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // engine: a recorded propeller loop (assets/engine.mp3); its playback speed follows the revs
  const g = ctx.createGain(); g.gain.value = 0; g.connect(bus.engine);
  eng = { g, src: null, rate: 1 };
  fetch(new URL('../assets/engine.mp3', import.meta.url)).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => {
    const loop = loopBuf = seamless(buf);
    const src = ctx.createBufferSource(); src.buffer = loop; src.loop = true; src.connect(g); src.start(); eng.src = src;
    // voices for other aircraft: each is the same loop with its own volume, stereo position and speed
    for (let i = 0; i < VOICES; i++) {
      const s = ctx.createBufferSource(), vg = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      s.buffer = loop; s.loop = true; vg.gain.value = 0; s.connect(vg); if (pan) { vg.connect(pan); pan.connect(bus.flyby); } else vg.connect(bus.flyby);
      s.start(0, loop.duration * i / VOICES);                       // staggered so voices do not phase together
      voices.push({ src: s, g: vg, pan, id: null, rate: 1, vol: 0 });
    }
  }).catch(() => { /* no engine sound if the file cannot be loaded */ });
  // thunder: three recorded claps (assets/thunder1-3.mp3), one picked at random for each flash
  for (const n of [1, 2, 3]) fetch(new URL(`../assets/thunder${n}.mp3`, import.meta.url)).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => thunderBufs.push(buf)).catch(() => {});
  // wind: looped noise through a band-pass that opens up with speed
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), wg = ctx.createGain();
  src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.6; wg.gain.value = 0;
  src.connect(bp); bp.connect(wg); wg.connect(bus.wind); src.start();
  wind = { bp, g: wg };
  // storm wind: band-passed noise whose pitch and loudness are swept by two slow oscillators, so it howls and gusts
  { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lfo2 = ctx.createOscillator(), fd = ctx.createGain(), gd = ctx.createGain(), swell = ctx.createGain();
    s.buffer = noise; s.loop = true; f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 2.2; g.gain.value = 0; swell.gain.value = 0;
    lfo.frequency.value = 0.13; fd.gain.value = 170; lfo.connect(fd); fd.connect(f.frequency); lfo2.frequency.value = 0.31; gd.gain.value = 0.5; lfo2.connect(gd); gd.connect(swell.gain);
    s.connect(f); f.connect(g); g.connect(swell); swell.connect(bus.gusts); s.start(0, 0.4); lfo.start(); lfo2.start(); gustNode = g; }
  // rain: two offset loops of band-passed noise, a hiss with a patter on top
  rainNodes = [[2800, 0.4, 0.3], [900, 0.7, 1.1]].map(([f, q, off]) => { const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; s.loop = true; flt.type = 'bandpass'; flt.frequency.value = f; flt.Q.value = q; g.gain.value = 0; s.connect(flt); flt.connect(g); g.connect(bus.rain); s.start(0, off); return g; });
}

// Make a recording loop without a click: cut the silence MP3 encoding leaves at each end, then fade the
// last part of the clip into the first part so the join is continuous.
const LOOP_TRIM = 0.63;      // brings this recording (4 dB hotter than the first two) to the level the mix was set for
function seamless(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  let a = 0, b = d.length - 1; while (a < b && Math.abs(d[a]) < 0.004) a++; while (b > a && Math.abs(d[b]) < 0.004) b--;
  const fade = Math.min(Math.floor(sr * 0.25), Math.floor((b - a) / 3)), n = b - a - fade;
  if (n < sr * 0.3) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < n; i++) dst[i] = src[a + i] * LOOP_TRIM;
    for (let i = 0; i < fade; i++) { const w = i / fade; dst[i] = (src[a + i] * Math.sqrt(w) + src[a + n + i] * Math.sqrt(1 - w)) * LOOP_TRIM; }   // equal-power crossfade
  }
  return out;
}

export function setMuted(m) {
  muted = !!m; try { localStorage.setItem('woi-mute', muted ? '1' : '0'); } catch { /* no storage */ }
  if (ctx) applyMaster();
  return muted;
}
export const toggleMute = () => setMuted(!muted);
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
  // our own engine ducks while another aircraft is close, so its pass is heard over ours
  eng.g.gain.setTargetAtTime(alive ? (0.13 + throttle * 0.22) * (1 - 0.6 * duck) : 0, t, 0.08);
  wind.bp.frequency.setTargetAtTime(300 + k * 900, t, 0.2);
  wind.g.gain.setTargetAtTime(alive ? Math.min(0.22, 0.03 + k * k * 0.1) : 0.02, t, 0.2);
}

// Other aircraft. list = [{ id, dist, doppler, pan }] for aircraft near the listener:
//   dist    distance in units
//   doppler pitch factor from relative motion (above 1 approaching, below 1 receding)
//   pan     -1 (left) .. 1 (right)
// The nearest few get a voice each. As one sweeps past, volume peaks and the pitch drops: the whizz.
const VOICES = 4, voices = [];
let duck = 0;        // duck: 0..1, how close the nearest other aircraft is
export function updateOthers(list) {
  if (!ctx || !voices.length) return;
  list.sort((a, b) => a.dist - b.dist); list.length = Math.min(list.length, VOICES);
  for (const v of voices) if (v.id !== null && !list.some(o => o.id === v.id)) v.id = null;         // its aircraft is no longer among the nearest
  let close = 0;
  for (const o of list) {
    let v = voices.find(x => x.id === o.id) || voices.find(x => x.id === null && x.vol < 0.01) || voices.find(x => x.id === null);
    if (!v) continue;
    if (v.id !== o.id) { v.id = o.id; v.rate = 1.15 * o.doppler; }
    const vol = 1.7 / (1 + (o.dist / 95) * (o.dist / 95)) * Math.max(0, 1 - o.dist / 450);      // loud inside ~100 m, audible to ~400 m
    v.vol += (vol - v.vol) * 0.25; v.rate += (1.15 * o.doppler - v.rate) * 0.3;
    v.g.gain.value = v.vol; v.src.playbackRate.value = v.rate; if (v.pan) v.pan.pan.value = o.pan;
    const c = Math.max(0, 1 - o.dist / 130); if (c > close) close = c;
  }
  for (const v of voices) if (v.id === null && v.vol > 0) { v.vol *= 0.8; if (v.vol < 0.002) v.vol = 0; v.g.gain.value = v.vol; }
  duck += (close - duck) * 0.3;
}
export const otherVoices = () => voices.map(v => ({ id: v.id, vol: +v.vol.toFixed(3), rate: +v.rate.toFixed(2) }));   // for tests

const near = dist => 1 / (1 + (dist / 70) * (dist / 70));          // loudness falls off with distance
function burst(out, dur, type, f0, f1, gain, at = 0) {                  // a filtered slice of noise with a decaying envelope, starting 'at' seconds from now
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + at;
  src.buffer = noise; flt.type = type; flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(flt); flt.connect(g); g.connect(out); src.start(t, Math.random() * 1.5, dur + 0.02);
}
function tone(out, dur, type, f0, f1, gain, at = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}
export function gunSound(dist, own) {
  if (!ctx) return; const v = own ? 1 : near(dist); if (v < 0.03) return;
  burst(bus.guns, 0.07, 'bandpass', own ? 1500 : 1100, 500, 0.3 * v);
  tone(bus.guns, 0.06, 'square', own ? 150 : 120, 60, 0.14 * v);
}
// The airship cannons: a heavy slow gun. Layers: a thump you feel, a body, the blast, the crack, and a rumble rolling away.
export function cannonSound(dist) {
  if (!ctx) return; const v = Math.max(0.1, 1 / (1 + (dist / 190) * (dist / 190))); if (v < 0.04) return;
  tone(bus.cannons, 0.6, 'sine', 95, 26, 1.0 * v);
  tone(bus.cannons, 0.2, 'sawtooth', 220, 48, 0.32 * v);
  burst(bus.cannons, 0.55, 'lowpass', 1500, 90, 0.95 * v);
  burst(bus.cannons, 0.08, 'highpass', 3500, 1800, 0.45 * v);
  burst(bus.cannons, 1.3, 'lowpass', 380, 50, 0.4 * v);
}
// A shell bursting in the air or on a hit: a short dull crump.
export function crumpSound(dist) {
  if (!ctx) return; const v = 1 / (1 + (dist / 130) * (dist / 130)); if (v < 0.05) return;
  burst(bus.cannons, 0.4, 'lowpass', 1000, 110, 0.7 * v); tone(bus.cannons, 0.28, 'sine', 130, 38, 0.5 * v);
}
// ---- jingles: a small brass band, built from two detuned sawtooth voices and a square, with vibrato, through a low-pass ----
const NOTE = { C3: 130.8, G3: 196, Bb3: 233.1, C4: 261.6, D4: 293.7, Eb4: 311.1, E4: 329.6, F4: 349.2, G4: 392, Ab4: 415.3, Bb4: 466.2, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784 };
function brass(freq, at, dur, vol, soft = 0) {
  const t = ctx.currentTime + at, g = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), depth = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(soft ? 700 : 900, t); lp.frequency.linearRampToValueAtTime(soft ? 1400 : 3200, t + Math.min(0.09, dur * 0.4)); lp.frequency.linearRampToValueAtTime(soft ? 900 : 1600, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol * 0.85, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.12);
  lfo.frequency.value = 5.4; depth.gain.value = freq * 0.006; lfo.connect(depth); lfo.start(t); lfo.stop(t + dur + 0.2);
  for (const [type, det, v] of [['sawtooth', -5, 1], ['sawtooth', 6, 0.8], ['square', 0, 0.35]]) {
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = freq; o.detune.value = det; og.gain.value = v;
    depth.connect(o.frequency); o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.2);
  }
  lp.connect(g); g.connect(bus.jingle);
}
function drum(at, vol) {                                            // a snare tap: a burst of noise, high-passed
  const t = ctx.currentTime + at, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise; f.type = 'bandpass'; f.frequency.value = 1900; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(f); f.connect(g); g.connect(bus.jingle); src.start(t, Math.random(), 0.12);
}
// A bugle-and-brass fanfare in C major: a rising call, a dotted answer, and a held chord. About three seconds.
export function captureJingle() {
  if (!ctx) return;
  const call = [['G3', 0, 0.2], ['C4', 0.22, 0.2], ['E4', 0.44, 0.2], ['G4', 0.66, 0.34], ['E4', 1.04, 0.14], ['G4', 1.2, 0.14], ['C5', 1.36, 0.55]];
  for (const [n, at, d] of call) { brass(NOTE[n], at, d, 0.2); brass(NOTE[n] / 2, at, d, 0.12); }
  for (const [chord, at] of [[['C4', 'E4', 'G4', 'C5'], 2.0], [['C4', 'E4', 'G4', 'E5'], 2.0], [['E4', 'G4', 'C5', 'G5'], 2.0]].slice(0, 1)) for (const n of chord) brass(NOTE[n], at, 1.15, 0.13);
  brass(NOTE.C3, 2.0, 1.15, 0.2); brass(NOTE.G5, 2.0, 1.15, 0.08);
  for (const at of [0, 0.22, 0.44, 0.66, 1.04, 1.2, 1.36, 2.0]) drum(at, 0.12);
}
// The opposite: slow, low and soft, a falling minor line that comes to rest on a bare fifth, with a muffled drum. About three seconds.
export function lostJingle() {
  if (!ctx) return;
  const line = [['G4', 0, 0.5], ['F4', 0.55, 0.5], ['Eb4', 1.1, 0.5], ['D4', 1.65, 0.45], ['C4', 2.15, 1.5]];
  for (const [n, at, d] of line) { brass(NOTE[n], at, d, 0.17, 1); brass(NOTE[n] / 2, at, d, 0.1, 1); }
  brass(NOTE.G3, 2.15, 1.5, 0.1, 1); brass(NOTE.Eb4, 2.15, 1.5, 0.06, 1);
  for (const at of [0, 0.55, 1.1, 1.65, 2.15]) { tone(bus.jingle, 0.22, 'sine', 90, 45, 0.5); drum(at + 0.02, 0.05); }
}
// Rain on the aircraft, level 0..1 (called every frame).
export function setRain(level) {
  if (!ctx || !rainNodes) return; const t = ctx.currentTime;
  rainNodes[0].gain.setTargetAtTime(level * (0.05 + 0.2 * level), t, 0.4); rainNodes[1].gain.setTargetAtTime(level * level * 0.28, t, 0.4);
}
// Storm wind, level 0..1 (called every frame).
export function setGusts(level) { if (ctx && gustNode) gustNode.gain.setTargetAtTime(level * 0.55, ctx.currentTime, 0.6); }
// Thunder after a delay (seconds): near strikes open with a sharp crack, every strike ends in a long rolling rumble that gets duller with distance.
const thunderBufs = []; let lastThunder = -1;
export function thunderSound(dist, delay = 0) {
  if (!ctx) return;
  if (thunderBufs.length) {                                              // a recording: never the same one twice running, pitched a little differently each time, duller and quieter the further away
    let k; do k = Math.floor(Math.random() * thunderBufs.length); while (k === lastThunder && thunderBufs.length > 1); lastThunder = k;
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), v = Math.max(0.2, 1 / (1 + (dist / 900) * (dist / 900)));
    src.buffer = thunderBufs[k]; src.playbackRate.value = 0.9 + Math.random() * 0.2 - (dist > 600 ? 0.05 : 0); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 14000 - dist * 9); g.gain.value = 1.15 * v;
    src.connect(lp); lp.connect(g); g.connect(bus.thunder); src.start(ctx.currentTime + Math.max(0, delay)); return;
  } const v = Math.max(0.14, 1 / (1 + (dist / 700) * (dist / 700))), d = Math.max(0, delay);
  if (dist < 420) { burst(bus.thunder, 0.14, 'highpass', 4800, 1500, 0.9 * v, d); burst(bus.thunder, 0.4, 'lowpass', 2800, 130, 1.3 * v, d); tone(bus.thunder, 0.6, 'sine', 75, 24, 1.1 * v, d); }
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) burst(bus.thunder, 1.4 + Math.random() * 2, 'lowpass', 300 + Math.random() * 260 - dist * 0.12, 45, (0.62 - i * 0.07) * v * (0.6 + Math.random() * 0.6), d + 0.1 + i * 0.34 + Math.random() * 0.35);
}
// A Le Prieur rocket leaving its tube: a crack of ignition, then a long hissing roar that falls away.
export function rocketSound(dist) {
  if (!ctx) return; const v = Math.max(0.12, 1 / (1 + (dist / 160) * (dist / 160)));
  burst(bus.rockets, 0.1, 'highpass', 4200, 1600, 0.7 * v); tone(bus.rockets, 0.14, 'sine', 210, 60, 0.7 * v);
  burst(bus.rockets, 1.0, 'bandpass', 2400, 700, 0.55 * v, 0.03); burst(bus.rockets, 1.3, 'lowpass', 900, 160, 0.5 * v, 0.03);
}
// The pickup: a bright two-note chime.
export function pickupSound() {
  if (!ctx) return; tone(bus.rockets, 0.5, 'sine', 880, 880, 0.35); tone(bus.rockets, 0.5, 'triangle', 880, 880, 0.12);
  tone(bus.rockets, 0.7, 'sine', 1320, 1320, 0.32, 0.14); tone(bus.rockets, 0.7, 'triangle', 1320, 1320, 0.1, 0.14);
}
export function boomSound(dist) {
  if (!ctx) return; const v = Math.max(0.12, near(dist * 0.4));
  burst(bus.booms, 1.4, 'lowpass', 900, 50, 0.9 * v); tone(bus.booms, 0.5, 'sine', 90, 30, 0.5 * v);
}
export function hitTakenSound() { if (ctx) { tone(bus.hits, 0.09, 'triangle', 900, 260, 0.3); burst(bus.hits, 0.05, 'highpass', 2500, 1500, 0.2); } }   // rounds striking our aircraft
export function hitScoredSound() { if (ctx) tone(bus.hits, 0.05, 'sine', 1700, 1300, 0.12); }                                                // our rounds striking home

// A short sample of one channel, for the volume sliders in Options.
export function previewSound(key) {
  if (!ctx) return;
  const t = ctx.currentTime, later = (fn, ms) => setTimeout(fn, ms);
  if (key === 'guns') for (let i = 0; i < 6; i++) later(() => gunSound(0, true), i * 90);
  else if (key === 'cannons') { cannonSound(0); later(() => crumpSound(20), 900); later(() => cannonSound(0), 1700); }
  else if (key === 'jingle') { captureJingle(); later(lostJingle, 3600); }
  else if (key === 'rain' && rainNodes) { const t = ctx.currentTime; for (const [g, a] of [[rainNodes[0], 0.3], [rainNodes[1], 0.28]]) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.7); g.gain.setValueAtTime(a, t + 2.0); g.gain.linearRampToValueAtTime(0, t + 3.0); } }
  else if (key === 'gusts' && gustNode) { const t = ctx.currentTime; gustNode.gain.cancelScheduledValues(t); gustNode.gain.setValueAtTime(0, t); gustNode.gain.linearRampToValueAtTime(0.5, t + 1.2); gustNode.gain.setValueAtTime(0.5, t + 2.6); gustNode.gain.linearRampToValueAtTime(0, t + 4.2); }
  else if (key === 'thunder') { thunderSound(150, 0); later(() => thunderSound(900, 0.3), 3800); }
  else if (key === 'rockets') { pickupSound(); later(() => rocketSound(0), 900); later(() => rocketSound(60), 1500); }
  else if (key === 'hits') { hitTakenSound(); later(hitScoredSound, 350); later(hitTakenSound, 700); }
  else if (key === 'booms') boomSound(120);
  else if (key === 'master') { for (let i = 0; i < 4; i++) later(() => gunSound(0, true), i * 90); later(() => cannonSound(40), 450); later(() => boomSound(120), 1100); }
  else if (key === 'wind') {
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.6; bp.frequency.setValueAtTime(300, t); bp.frequency.linearRampToValueAtTime(1100, t + 1.8);
    g.gain.setValueAtTime(0.01, t); g.gain.linearRampToValueAtTime(0.2, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 1.8);
    src.connect(bp); bp.connect(g); g.connect(bus.wind); src.start(t); src.stop(t + 1.9);
  } else if ((key === 'engine' || key === 'flyby') && loopBuf) {
    const src = ctx.createBufferSource(), g = ctx.createGain(), pan = key === 'flyby' && ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.buffer = loopBuf; src.loop = true;
    if (key === 'engine') {                       // revs climbing as if the throttle were opened
      src.playbackRate.setValueAtTime(0.7, t); src.playbackRate.linearRampToValueAtTime(1.3, t + 1.8);
      g.gain.setValueAtTime(0.3, t); g.gain.linearRampToValueAtTime(0, t + 2);
    } else {                                      // a fly-by: swells, passes at the middle with the pitch dropping, and fades
      src.playbackRate.setValueAtTime(1.9, t); src.playbackRate.setValueAtTime(1.9, t + 0.95); src.playbackRate.linearRampToValueAtTime(0.72, t + 1.15); src.playbackRate.linearRampToValueAtTime(0.69, t + 2.2);
      g.gain.setValueAtTime(0.02, t); g.gain.linearRampToValueAtTime(1.3, t + 1.0); g.gain.linearRampToValueAtTime(0.02, t + 2.2);
      if (pan) { pan.pan.setValueAtTime(-0.8, t); pan.pan.linearRampToValueAtTime(0.8, t + 2.2); }
    }
    src.connect(g); if (pan) { g.connect(pan); pan.connect(bus[key]); } else g.connect(bus[key]);
    src.start(t); src.stop(t + 2.3);
  }
}
export const thunderLoaded = () => thunderBufs.length;
