// Game controller support: assignable bindings, calibration, dead zone and response curve.
// Works with gamepads, joysticks, throttles and pedals — each binding remembers which device it is on,
// so a stick, a throttle quadrant and rudder pedals can be mixed freely.
const STORE = 'woi-controls-v1';
const $ = id => document.getElementById(id);

// kind 'axis' actions give -1..1 (prompt = direction that counts as positive), 'button' actions give 0..1
export const ACTIONS = [
  { key: 'pitch', label: 'Pitch', kind: 'axis', prompt: 'pull back (nose up)' },
  { key: 'roll', label: 'Roll', kind: 'axis', prompt: 'push right (roll right)' },
  { key: 'yaw', label: 'Rudder', kind: 'axis', prompt: 'push right (yaw right)' },
  { key: 'throttle', label: 'Throttle axis', kind: 'axis', prompt: 'push to full throttle', lever: true },
  { key: 'throttleUp', label: 'Throttle up', kind: 'button', prompt: 'press the button' },
  { key: 'throttleDown', label: 'Throttle down', kind: 'button', prompt: 'press the button' },
  { key: 'fire', label: 'Fire guns', kind: 'button', prompt: 'press the button or trigger' },
];
// Layout for pads the browser reports as "standard" (Xbox / PlayStation style):
// left stick pitch + roll, right stick rudder + throttle, right trigger fires.
const STANDARD = {
  pitch: { kind: 'axis', index: 1 }, roll: { kind: 'axis', index: 0 }, yaw: { kind: 'axis', index: 2 },
  throttle: { kind: 'axis', index: 3, invert: true }, fire: { kind: 'button', index: 7 },
  throttleUp: { kind: 'button', index: 12 }, throttleDown: { kind: 'button', index: 13 },
};

let cfg = { bind: {}, cal: {}, dead: 0.12, curve: 0.35 };
try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { /* no storage */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch { /* no storage */ } };

const pads = () => [...(navigator.getGamepads?.() || [])].filter(Boolean);
const padById = id => pads().find(p => p.id === id);
const shortName = id => id.replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*?\)/i, '').replace(/\s+/g, ' ').trim().slice(0, 34) || 'Controller';

function applyDefaults(pad) {
  for (const k in STANDARD) cfg.bind[k] = { pad: pad.id, ...STANDARD[k] };
  save();
}
addEventListener('gamepadconnected', e => {
  const bound = Object.values(cfg.bind).some(b => b);
  if (!bound && e.gamepad.mapping === 'standard') applyDefaults(e.gamepad);
  render();
});
addEventListener('gamepaddisconnected', () => render());

// ---- reading ----
// raw axis -> calibrated -1..1 (centre and end stops from calibration)
function calibrated(pad, index) {
  const v = pad.axes[index] ?? 0, c = cfg.cal[pad.id + '|' + index];
  if (!c) return v;
  const out = v >= c.c ? (v - c.c) / Math.max(0.05, c.max - c.c) : (v - c.c) / Math.max(0.05, c.c - c.min);
  return Math.max(-1, Math.min(1, out));
}
// dead zone, then blend linear with cubic for finer control near the centre
function shape(v) {
  const a = Math.abs(v); if (a <= cfg.dead) return 0;
  const n = (a - cfg.dead) / (1 - cfg.dead);
  return Math.sign(v) * ((1 - cfg.curve) * n + cfg.curve * n * n * n);
}
function readAction(a) {
  const b = cfg.bind[a.key]; if (!b) return null;
  const pad = padById(b.pad); if (!pad) return null;
  if (b.kind === 'button') return pad.buttons[b.index]?.value ?? 0;
  let v = calibrated(pad, b.index); if (b.invert) v = -v;
  if (a.lever && b.lever) {                                   // throttle lever: whole travel maps to 0..100 %
    const c = cfg.cal[pad.id + '|' + b.index]; let raw = pad.axes[b.index] ?? 0;
    const lo = c ? c.min : -1, hi = c ? c.max : 1; raw = (raw - lo) / Math.max(0.05, hi - lo);
    return Math.max(0, Math.min(1, b.invert ? 1 - raw : raw));
  }
  return shape(v);
}

// Called every frame by the game. Values add to the keyboard.
export function pollGamepad() {
  const v = {}; for (const a of ACTIONS) v[a.key] = readAction(a);
  const lever = cfg.bind.throttle?.lever && v.throttle !== null;
  return {
    pitch: v.pitch || 0, roll: v.roll || 0, yaw: v.yaw || 0, fire: (v.fire || 0) > 0.3,
    throttle: (lever ? 0 : v.throttle || 0) + (v.throttleUp || 0) - (v.throttleDown || 0),
    throttleAbs: lever ? v.throttle : null,
  };
}

// ---- assignment: wait for the player to move an axis or press a button ----
let capture = null;
function startCapture(action) {
  const base = new Map(pads().map(p => [p.index, { axes: [...p.axes], buttons: p.buttons.map(b => b.value) }]));
  capture = { action, base, until: performance.now() + 10000 };
  render();
}
function pollCapture() {
  if (!capture) return;
  const { action, base } = capture;
  if (performance.now() > capture.until) { capture = null; return render(); }
  for (const p of pads()) {
    const b0 = base.get(p.index); if (!b0) continue;
    if (action.kind === 'button') {
      const bi = p.buttons.findIndex((b, i) => b.value > 0.6 && (b0.buttons[i] ?? 0) < 0.3);
      if (bi >= 0) { cfg.bind[action.key] = { pad: p.id, kind: 'button', index: bi }; return endCapture(); }
    } else {
      const ai = p.axes.findIndex((v, i) => Math.abs(v - (b0.axes[i] ?? 0)) > 0.55);
      if (ai >= 0) {
        const prev = cfg.bind[action.key];
        cfg.bind[action.key] = { pad: p.id, kind: 'axis', index: ai, invert: p.axes[ai] < b0.axes[ai], lever: !!prev?.lever };
        return endCapture();
      }
    }
  }
}
function endCapture() { capture = null; save(); render(); }

// ---- calibration: centre first, then full travel ----
let calib = null;
function calibStep() {
  if (!calib) { calib = { step: 1 }; return render(); }
  if (calib.step === 1) {
    calib = { step: 2, data: new Map() };
    for (const p of pads()) p.axes.forEach((v, i) => calib.data.set(p.id + '|' + i, { c: v, min: v, max: v }));
    return render();
  }
  pollCalib();
  for (const [key, d] of calib.data) {
    if (d.max - d.min > 0.4) cfg.cal[key] = { c: +d.c.toFixed(4), min: +d.min.toFixed(4), max: +d.max.toFixed(4) };   // only axes that were actually moved
  }
  calib = null; save(); render();
}
function pollCalib() {
  if (calib?.step !== 2) return;
  for (const p of pads()) p.axes.forEach((v, i) => { const d = calib.data.get(p.id + '|' + i); if (d) { d.min = Math.min(d.min, v); d.max = Math.max(d.max, v); } });
}

// ---- panel ----
let open = false;
export const controlsOpen = () => open;
export function toggleControls(force) { open = force ?? !open; $('controls').style.display = open ? 'grid' : 'none'; capture = null; calib = null; if (open) render(); }

function bindingText(a) {
  const b = cfg.bind[a.key]; if (!b) return '<i>not assigned</i>';
  const pad = padById(b.pad);
  return `${b.kind === 'axis' ? 'Axis' : 'Button'} ${b.index}${b.kind === 'axis' && b.invert ? ' (reversed)' : ''} <small>· ${shortName(b.pad)}${pad ? '' : ' — not connected'}</small>`;
}
function render() {
  if (!open) return;
  const list = pads(), el = $('controls-body');
  const rows = ACTIONS.map(a => {
    const b = cfg.bind[a.key], cap = capture?.action === a;
    return `<tr class="${cap ? 'cap' : ''}"><th>${a.label}</th>
      <td>${cap ? `<b>Now ${a.prompt}…</b>` : bindingText(a)}</td>
      <td><div class="meter"><i data-meter="${a.key}"></i></div></td>
      <td class="opts">${a.kind === 'axis' && b ? `<label><input type="checkbox" data-invert="${a.key}" ${b.invert ? 'checked' : ''}> reverse</label>` : ''}${a.lever && b ? `<label title="The lever position sets the throttle directly, like a real throttle quadrant"><input type="checkbox" data-lever="${a.key}" ${b.lever ? 'checked' : ''}> lever</label>` : ''}</td>
      <td class="btns"><button type="button" data-assign="${a.key}" ${list.length ? '' : 'disabled'}>${cap ? 'Cancel' : 'Assign'}</button><button type="button" data-clear="${a.key}" ${b ? '' : 'disabled'}>Clear</button></td></tr>`;
  }).join('');
  const calText = !calib ? `Calibrate if the aircraft drifts with the stick released or does not reach full deflection. ${Object.keys(cfg.cal).length ? `<small>${Object.keys(cfg.cal).length} axes calibrated.</small>` : ''}`
    : calib.step === 1 ? '<b>Step 1 of 2:</b> let go of every stick and pedal so they rest at centre, then press Next.'
    : '<b>Step 2 of 2:</b> move every stick, throttle and pedal slowly to all of its end stops, then press Finish.';
  el.innerHTML = `
    <p class="pads">${list.length ? list.map(p => `<span>● ${shortName(p.id)} <small>${p.axes.length} axes, ${p.buttons.length} buttons</small></span>`).join('') : 'No controller detected. Plug one in and press any button on it.'}</p>
    <table>${rows}</table>
    <div class="cal"><div>${calText}</div><div class="btns"><button type="button" id="cal-go" ${list.length ? '' : 'disabled'}>${!calib ? 'Calibrate' : calib.step === 1 ? 'Next' : 'Finish'}</button>${calib ? '<button type="button" id="cal-cancel">Cancel</button>' : `<button type="button" id="cal-clear" ${Object.keys(cfg.cal).length ? '' : 'disabled'}>Clear calibration</button>`}</div></div>
    <div class="sliders">
      <label>Dead zone <output>${Math.round(cfg.dead * 100)}%</output><input type="range" id="dead" min="0" max="35" value="${Math.round(cfg.dead * 100)}"></label>
      <label>Response curve <output>${Math.round(cfg.curve * 100)}%</output><input type="range" id="curve" min="0" max="100" value="${Math.round(cfg.curve * 100)}"></label>
    </div>
    <div class="foot"><button type="button" id="defaults" ${list.length ? '' : 'disabled'}>Standard gamepad layout</button><button type="button" id="controls-close" class="primary">Done</button></div>`;
}
function onClick(e) {
  const t = e.target, d = t.dataset;
  if (d.assign) { const a = ACTIONS.find(x => x.key === d.assign); capture?.action === a ? (capture = null, render()) : startCapture(a); }
  else if (d.clear) { delete cfg.bind[d.clear]; save(); render(); }
  else if (t.id === 'cal-go') calibStep();
  else if (t.id === 'cal-cancel') { calib = null; render(); }
  else if (t.id === 'cal-clear') { cfg.cal = {}; save(); render(); }
  else if (t.id === 'defaults') { const p = pads().find(x => x.mapping === 'standard') || pads()[0]; if (p) { applyDefaults(p); render(); } }
  else if (t.id === 'controls-close') toggleControls(false);
}
function onChange(e) {
  const t = e.target, d = t.dataset;
  if (d.invert) cfg.bind[d.invert].invert = t.checked;
  else if (d.lever) cfg.bind[d.lever].lever = t.checked;
  else if (t.id === 'dead') { cfg.dead = t.value / 100; t.previousElementSibling.textContent = t.value + '%'; }
  else if (t.id === 'curve') { cfg.curve = t.value / 100; t.previousElementSibling.textContent = t.value + '%'; }
  save();
}
// Runs every frame from the game loop: updates the live meters.
export function updateControls() {
  if (!open) return;
  for (const a of ACTIONS) {
    const m = document.querySelector(`[data-meter="${a.key}"]`); if (!m) continue;
    const v = readAction(a) ?? 0, bar = a.kind === 'axis' && !(a.lever && cfg.bind[a.key]?.lever);
    m.style.left = bar ? (v < 0 ? 50 + v * 50 : 50) + '%' : '0'; m.style.width = (bar ? Math.abs(v) * 50 : v * 100) + '%';
  }
}
export function initControls() {
  setInterval(() => { if (open) { pollCapture(); pollCalib(); } }, 25);   // own timer, so it keeps sampling even at low frame rates
  $('controls').addEventListener('click', onClick);
  $('controls').addEventListener('input', onChange);
  $('controls').addEventListener('mousedown', e => { if (e.target.id === 'controls') toggleControls(false); });
}
export const _debug = { get cfg() { return cfg; } };
