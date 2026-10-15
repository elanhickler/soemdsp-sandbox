// Headless: Softpop Oscillator (type 207) and Softpop Filter (type 214)
// display data path + outputs.
// Combined wasm graph -> soemdsp_softpop_{oscillator,filter}_display_* (what the
// worklet's syncNativeSoftpopPublish reads) -> the face's glow accumulator
// (public/modules/softpopOscillator/softpop-display.js, loaded in a vm).
// Also checks the Mono / Noise L / Noise R / pitch L / pitch R (♯/♭) ports.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };

const create = must("soemdsp_graph_create");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const nativeHandle = must("soemdsp_graph_node_native_handle");
const destroy = must("soemdsp_graph_destroy");
const binCount = must("soemdsp_softpop_oscillator_display_bin_count");
const bin = must("soemdsp_softpop_oscillator_display_bin");
const take = must("soemdsp_softpop_oscillator_display_take");
const info = must("soemdsp_softpop_oscillator_display_info");
const fBinCount = must("soemdsp_softpop_filter_display_bin_count");
const fBin = must("soemdsp_softpop_filter_display_bin");
const fTake = must("soemdsp_softpop_filter_display_take");
const fInfo = must("soemdsp_softpop_filter_display_info");

const TYPE_SOFTPOP = 207, TYPE_SOFTPOP_FILTER = 214, TYPE_OUT = 6;
const PARAM = { FREQUENCY: 10, SOURCE: 11, AMPLITUDE: 12, MORPH: 13, WIDTH: 31, PITCH: 45, SEED: 48 };
const PORT = { MONO: 0, LEFT: 1, RIGHT: 2, NOISE_L: 3, NOISE_R: 4, PITCH_L: 5, PITCH_R: 6 };
const SR = 48000, FRAMES = 128, HASH = 0x50f7a001 >>> 0, OUT_HASH = 0x50f7a0ff >>> 0;

let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures++; };

function build(params, type = TYPE_SOFTPOP) {
  const g = create() | 0;
  if (g <= 0) throw new Error("graph create");
  setSr(g, SR);
  add(g, HASH, type);
  add(g, OUT_HASH, TYPE_OUT);
  connect(g, HASH, PORT.MONO, OUT_HASH, 0);
  for (const [k, v] of Object.entries(params)) setParam(g, HASH, PARAM[k], v);
  if ((compile(g) | 0) < 0) throw new Error("compile");
  snap(g);
  const h = nativeHandle(g, HASH) | 0;
  if (!(h > 0)) throw new Error("native handle");
  return { g, h };
}
const port = (g, p) => new Float64Array(e.memory.buffer, portPtr(g, HASH, p) | 0, FRAMES).slice();
function run(g, blocks, onBlock) {
  for (let b = 0; b < blocks; b++) { processBlock(g, FRAMES); onBlock?.(); }
}
function readBins(h, filter = false) {
  const n = (filter ? fBinCount() : binCount()) | 0;
  const bins = new Float32Array(n);
  for (let i = 0; i < n; i++) bins[i] = (filter ? fBin : bin)(h, i);
  const count = (filter ? fTake : take)(h);
  const inf = [];
  for (let k = 0; k < 7; k++) inf.push((filter ? fInfo : info)(h, k));
  inf.push(count);
  return { bins, info: inf };
}
const binOf = (hz) => Math.floor(Math.log(hz / 20) / Math.log(1000) * (binCount() | 0));

// --- display API shape / arming ---
gate((binCount() | 0) === 256 && (fBinCount() | 0) === 256, "display bin count 256 (Oscillator and Filter)");
{
  const { g, h } = build({ SOURCE: 0, FREQUENCY: 440, PITCH: 0, SEED: 1 });
  run(g, 10);
  const first = readBins(h);  // never armed: nothing binned
  gate(first.info[7] === 0, `unwatched: no samples binned before the first take (${first.info[7]})`);
  run(g, 100);
  const d = readBins(h);
  const total = d.bins.reduce((s, v) => s + v, 0);
  const peak = d.bins.indexOf(Math.max(...d.bins));
  gate(d.info[7] === 100 * FRAMES && total === 100 * FRAMES, `armed: every audio sample binned (${total} / ${d.info[7]})`);
  gate(peak === binOf(440) && d.bins[peak] === total, `Sine, Pitch Mod 0: all samples in the 440 Hz bin (${peak})`);
  gate(d.info[0] === 1 && Math.abs(d.info[1] - 440) < 1e-6 && d.info[3] === SR && d.info[5] === 20 && d.info[6] === 20000,
    `info: Oscillator glow mode (1), fEff 440, sr ${d.info[3]}, axis ${d.info[5]}..${d.info[6]} Hz`);
}
// --- Pitch Mod spreads the glow around the note ---
let spread;
{
  const { g, h } = build({ SOURCE: 0, FREQUENCY: 440, PITCH: 600, SEED: 3 });
  readBins(h);
  run(g, 375);  // 1 s
  spread = readBins(h);
  const c = binOf(440);
  let used = 0, near = 0, total = 0;
  for (let i = 0; i < spread.bins.length; i++) {
    total += spread.bins[i];
    if (spread.bins[i] > 0) used++;
    if (Math.abs(i - c) <= 26) near += spread.bins[i];  // +-1 octave (25.6 bins/oct)
  }
  gate(used > 40, `Sine, Pitch Mod 600: glow spreads over ${used} bins`);
  gate(near / total > 0.93 && near / total < 0.98, `Pitch Mod 600 (1 sigma = half an octave): ${(100 * near / total).toFixed(1)}% within +-1 octave = 2 sigma (expect ~95%)`);
}
// --- Pitch Mod sets the pitch spread ---
let curve;
{
  const spreadOf = (cents) => {
    const { g, h } = build({ SOURCE: 0, FREQUENCY: 440, PITCH: cents, SEED: 4 });
    readBins(h);
    run(g, 375);
    const d = readBins(h);
    destroy(g);
    let used = 0;
    for (const v of d.bins) if (v > 0) used++;
    return { d, used };
  };
  const wide = spreadOf(1200), mid = spreadOf(100), narrow = spreadOf(20);
  curve = mid.d;
  gate(wide.used > mid.used && mid.used > narrow.used && narrow.used <= 5,
    `Pitch Mod sets the spread: bins hit 1200 c ${wide.used}, 100 c ${mid.used}, 20 c ${narrow.used}`);
}
// --- Display is in pitch: centred on the note, symmetric at large Pitch Mod ---
{
  const { g, h } = build({ SOURCE: 0, FREQUENCY: 440, PITCH: 2400, SEED: 5 });
  readBins(h);
  run(g, 375 * 8);  // 8 s
  const d = readBins(h);
  destroy(g);
  const c = binOf(440), centreLn = Math.log(440 / 20) / Math.log(1000) * d.bins.length;  // fractional note bin
  let total = 0, sum = 0, below = 0, above = 0;
  for (let i = 0; i < d.bins.length; i++) { total += d.bins[i]; sum += d.bins[i] * (i + 0.5); if (i < c) below += d.bins[i]; else if (i > c) above += d.bins[i]; }
  let acc = 0, med = 0;
  for (let i = 0; i < d.bins.length; i++) { acc += d.bins[i]; if (acc >= total / 2) { med = i; break; } }
  const centroidC = (sum / total - centreLn) * 1200 * Math.log2(1000) / d.bins.length;  // cents
  gate(Math.abs(med - c) <= 1 && Math.abs(centroidC) < 100 && above / below > 0.85 && above / below < 1.18,
    `Pitch Mod 2400: display centred on the note in pitch (median bin ${med} vs ${c}, centroid ${centroidC.toFixed(0)} c, above/below ${(above / below).toFixed(3)})`);
}
// --- Amplitude drives line brightness: bins sum |Amplitude * Amp Mod gain| (<= 1) ---
{
  const sumAt = (amp) => {
    const { g, h } = build({ SOURCE: 0, FREQUENCY: 440, PITCH: 0, AMPLITUDE: amp, SEED: 1 });
    readBins(h);
    run(g, 20);
    const d = readBins(h);
    destroy(g);
    return d.bins.reduce((s, v) => s + v, 0) / d.info[7];
  };
  const b1 = sumAt(1), bh = sumAt(0.5), b0 = sumAt(0);
  gate(Math.abs(b1 - 1) < 1e-9 && Math.abs(bh / b1 - 0.5) < 0.02 && b0 === 0,
    `Amplitude -> line brightness weight per sample: 1 -> ${b1.toFixed(3)}, 0.5 -> ${bh.toFixed(3)}, 0 -> ${b0}`);
}
// --- Every Oscillator Source draws the glow line ---
{
  let allGlow = true;
  for (const src of [0, 1, 2, 3, 4]) {
    const { g, h } = build({ SOURCE: src, MORPH: 0.5, FREQUENCY: 440, PITCH: 300, SEED: 2 });
    readBins(h);
    run(g, 20);
    const d = readBins(h);
    if (d.info[0] !== 1 || d.info[7] !== 20 * FRAMES) allGlow = false;
    destroy(g);
  }
  gate(allGlow, "Oscillator: all 5 sources publish the glow line (mode 1, every sample binned)");
}
// --- Softpop Filter: centre + Q for the response curve ---
{
  const { g, h } = build({ FREQUENCY: 2000, WIDTH: 0.3, PITCH: 0, SEED: 1 }, TYPE_SOFTPOP_FILTER);
  readBins(h, true);
  run(g, 20);
  const d = readBins(h, true);
  const q = 2000 * Math.pow(0.5 / 2000, 0.3);
  gate(d.info[0] === 0 && Math.abs(d.info[1] - 2000) < 1e-6 && Math.abs(d.info[2] - q) < 1e-6 * q,
    `Softpop Filter: curve mode 0, centre ${d.info[1]} Hz, Q ${d.info[2].toFixed(3)} (Width 0.3 -> ${q.toFixed(3)})`);
}
// --- new outputs ---
{
  const { g, h } = build({ SOURCE: 0, FREQUENCY: 440, PITCH: 600, SEED: 5 });
  let monoIsL = true, lrDiffer = false, noiseDiffer = false, cvOk = true, cvLR = false, n2 = 0, n = 0;
  run(g, 50, () => {
    const m = port(g, PORT.MONO), l = port(g, PORT.LEFT), r = port(g, PORT.RIGHT);
    const nl = port(g, PORT.NOISE_L), nr = port(g, PORT.NOISE_R);
    const cl = port(g, PORT.PITCH_L), cr = port(g, PORT.PITCH_R);
    for (let i = 0; i < FRAMES; i++) {
      if (m[i] !== l[i]) monoIsL = false;
      if (l[i] !== r[i]) lrDiffer = true;
      if (nl[i] !== nr[i]) noiseDiffer = true;
      if (!Number.isFinite(cl[i]) || !Number.isFinite(cr[i]) || Math.abs(cl[i] - 69) > 36 || Math.abs(cr[i] - 69) > 36) cvOk = false;
      if (cl[i] !== cr[i]) cvLR = true;
      n2 += nl[i] * nl[i]; n++;
    }
  });
  const sd = Math.sqrt(n2 / n);
  gate(monoIsL && lrDiffer, "ports: Mono == Left render, Left != Right");
  gate(noiseDiffer && sd > 0.85 && sd < 1.15, `ports: Left/Noise R independent, RMS ${sd.toFixed(3)}`);
  gate(cvOk && cvLR, "ports: pitch L/R finite MIDI within 69 +-36 st (440 Hz, Pitch Mod 600), L != R");
}
// --- face accumulator (softpop-display.js) ---
{
  const ctx = { console, Math, Number, Float32Array, Object, String, Array };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "public", "modules", "softpopOscillator", "softpop-display.js"), "utf8") +
    "\nthis.__acc = nodeGraphSoftpopFaceAccumulate; this.__norm = normalizeNodeGraphSoftpopFaceSettings; this.__x = nodeGraphSoftpopFacePerSample;", ctx);
  const settings = ctx.__norm({ brightness: 0.5, decaySeconds: 0.15 });
  const canvas = {};
  const g1 = ctx.__acc(canvas, spread.bins, spread.info, settings);
  const g1c = g1[binOf(440)];
  const x = ctx.__x(0.5);
  const c = binOf(440);
  gate(Math.abs(g1[c] - x * spread.bins[c]) < 1e-6 * (1 + g1[c]), `face: glow = X * samples per bin (X ${x.toExponential(2)} at Brightness 0.5)`);
  const again = ctx.__acc(canvas, spread.bins, spread.info, settings);
  gate(again[c] === g1[c], "face: the same publish is not added twice");
  const zero = { bins: new Float32Array(256), info: [...spread.info.slice(0, 7), 0.15 * SR] };
  const g2 = ctx.__acc(canvas, zero.bins, zero.info, settings);
  gate(Math.abs(g2[c] / g1c - 0.5) < 1e-3, `face: glow halves after Decay (0.15 s of audio): ${(g2[c] / g1c).toFixed(4)}`);
}
// --- face colour: shared gradient LUT, same mapping as the trace drawers ---
{
  const ctx = { console, Math, Number, Float32Array, Uint8ClampedArray, Object, String, Array, JSON, Boolean, RegExp, parseInt, isFinite };
  vm.createContext(ctx);
  // Real shared gradient helpers (nodeGraphPhosphorGradientStopsFromSettings /
  // nodeGraphSampleGradientStopsRgb) so the face uses the trace drawers' path.
  for (const rel of ["node-graph-slider-values.js", "node-graph-stdlib/node-graph-param-surface-helpers.js", "node-graph-module-scope-normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "public", rel), "utf8"), ctx);
  }
  // Shared gradient selector (Bone preset + softpopFace profile defaultStops).
  vm.runInContext(fs.readFileSync(path.join(root, "public", "modules", "spectrogram", "spectrogram-gradient-editor.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "public", "modules", "softpopOscillator", "softpop-display.js"), "utf8") +
    "\nthis.__norm = normalizeNodeGraphSoftpopFaceSettings; this.__lut = nodeGraphSoftpopFaceLut; this.__idx = nodeGraphSoftpopFaceLutIndex; this.__present = nodeGraphSoftpopFacePresent; this.__bone = nodeGraphSoftpopFaceDefaultGradientStops;", ctx);
  gate(typeof ctx.nodeGraphSampleGradientStopsRgb === "function" && typeof ctx.nodeGraphPhosphorGradientStopsFromSettings === "function",
    "shared gradient helpers loaded from node-graph-module-scope-normalize.js");
  gate(typeof ctx.NodeGraphGradientSelector?.defaultStops === "function" && ctx.NodeGraphGradientSelector.displayProfiles?.softpopFace?.defaultStops === "bone",
    "softpopFace profile defaultStops is bone");
  const boneExpected = ctx.NodeGraphGradientSelector.defaultStops("bone");
  const boneDefault = ctx.__norm({});
  const boneColors = (boneDefault.gradientStops || []).map((s) => s.color).join(",");
  const expectedColors = boneExpected.map((s) => s.color).join(",");
  gate(boneColors === expectedColors && boneColors === "#000000,#2b2b4d,#7a7a9a,#d0c8c0,#ffffff",
    `default Softpop gradient is Bone (${boneColors})`);
  const stops = [{ t: 0, color: "#000000" }, { t: 0.5, color: "#ff0000" }, { t: 1, color: "#ffffff" }];
  const s = ctx.__norm({ lineHue: 10, backgroundHue: 20, lineSaturation: 1, backgroundSaturation: 1, lineBrightness: 1, backgroundBrightness: 0.5, gradientStops: stops });
  const keys = Object.keys(s).sort().join(",");
  gate(keys === "backgroundBrightness,brightness,decaySeconds,filterFillBrightness,filterStrokeBrightness,gradientStops,lineBrightness,lineThickness",
    `settings: Brightness, Decay, Background brightness, Line brightness, Line thickness, Filter stroke / fill brightness + gradient; no HSB colours (${keys})`);
  const lut = ctx.__lut(s);
  const at = (i) => [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]].join(",");
  gate(at(0) === "0,0,0" && at(255) === "255,255,255" && lut[128 * 3] > 250 && lut[128 * 3 + 1] < 5, `LUT follows the stops (0 ${at(0)}, mid ${at(128)}, top ${at(255)})`);
  gate(ctx.__idx(0, 0.5) === 128 && ctx.__idx(0.9, 0.5) === 230 && ctx.__idx(0.2, 0) === 51, "LUT position = max(brightness, Background brightness), like TraceWoscope uPlate");
  // WebGL2-only face: fake shared picture device + real gl-line-renderer.js.
  const glLog = { clear: null, verts: [], draws: 0 };
  const fakeGl = new Proxy({
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: (_p, n) => ["position", "local", "segLen", "halfPx", "feather", "colour"].indexOf(n),
    clearColor: (r, g, b, a) => { glLog.clear = [r, g, b, a].map((v) => Math.round(v * 255)).slice(0, 3).join(","); },
    bufferData: (_t, d) => { glLog.verts = Array.from(d); },
    drawArrays: () => { glLog.draws += 1; },
  }, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && k === k.toUpperCase() ? 1 : () => ({}))) });
  let glOn = true;
  ctx.nodeGraphPictureDevice = () => (glOn ? { gl: fakeGl, canvas: { height: 4096 } } : null);
  ctx.nodeGraphSharedGlBlitTo2D = () => true;
  vm.runInContext(fs.readFileSync(path.join(root, "public", "lib", "visual", "gl-line-renderer.js"), "utf8"), ctx);
  const colours = () => {
    const out = [];
    for (let i = 0; i < glLog.verts.length; i += 11) out.push(glLog.verts.slice(i + 7, i + 10).map((v) => Math.round(v * 255)).join(","));
    return out;
  };
  const halves = () => { const out = new Set(); for (let i = 0; i < glLog.verts.length; i += 11) out.add(glLog.verts[i + 5]); return out; };
  const reset = () => { glLog.clear = null; glLog.verts = []; glLog.draws = 0; };
  const mkCanvas = (w, h) => {
    const calls = { fills: [] };
    const c2d = { setTransform() {}, fillRect(x, y, ww, hh) { calls.fills.push([this.fillStyle, x, y, ww, hh]); } };
    return { width: w, height: h, getContext: () => c2d, calls };
  };
  // Sine: plate (GL clear) = LUT(plate); the note column climbs the gradient.
  const sS = ctx.__norm({ brightness: 1, decaySeconds: 0.15, backgroundBrightness: 0.5, gradientStops: stops });
  reset();
  ctx.__present(mkCanvas(256, 4), spread.bins, spread.info, sS, 256);
  gate(glLog.clear === at(128), `Sine (GL): empty pitch = LUT(Background brightness 0.5) = red (${glLog.clear})`);
  const sineCols = colours();
  // Full-height lines: every drawn quad spans the whole face.
  {
    reset();
    const cH = 100;
    ctx.__present(mkCanvas(256, cH), curve.bins, curve.info, sS, 256);
    let full = glLog.verts.length > 0;
    for (let i = 0; i < glLog.verts.length; i += 11) { const y = glLog.verts[i + 1]; if (Math.abs(Math.abs(y) - 1) > 1e-6) full = false; }
    gate(full, `Sine (GL): every printed line is full face height (${glLog.verts.length / 11} verts)`);
  }
  gate(sineCols.some((c) => { const v = c.split(",").map(Number); return v[0] === 255 && v[1] > 100; }) && glLog.draws === 1,
    `Sine (GL): glow at the note climbs the gradient toward white, one draw (${glLog.draws})`);
  // Filter: plate = LUT(0); fill coloured per column; stroke one constant colour.
  const fInfo = [0, 2000, 4, SR, 0, 20, 20000, 0];
  reset();
  ctx.__present(mkCanvas(200, 50), new Float32Array(256), fInfo, ctx.__norm({ backgroundBrightness: 0, gradientStops: stops }), 200);
  const fillCols = new Set(); const strokeCols = new Set();
  const cols = colours();
  for (let i = 0; i < cols.length; i += 1) (glLog.verts[i * 11 + 5] > 1e5 ? fillCols : strokeCols).add(cols[i]);
  gate(glLog.clear === "0,0,0", `Filter (GL): plate = LUT(0) (${glLog.clear})`);
  gate(fillCols.size > 5 && strokeCols.size === 1 && strokeCols.has(at(255)) && glLog.draws === 1,
    `Filter (GL): area coloured per column (${fillCols.size} colours), stroke = one constant LUT(1) colour, one draw`);
  gate(halves().size === 2, "Filter (GL): stroke is shader-expanded quads with one halfPx");
  // No GL: plain black square, no drawing fallback.
  glOn = false;
  const cb = mkCanvas(64, 8);
  reset();
  ctx.__present(cb, new Float32Array(256), fInfo, ctx.__norm({}), 64);
  gate(cb.calls.fills.length === 1 && cb.calls.fills[0][0] === "#000" && glLog.draws === 0, "No GL: face is a plain black square");
}
console.log(failures ? `FAILED ${failures}` : "smoke_graph_softpop_display ok");
if (failures) process.exit(1);
