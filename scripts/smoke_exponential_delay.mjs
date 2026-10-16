// Early Reflections: stereo smoke.
// 1) Native taps: impulse in, count tap clusters per side for Dual and Split.
// 2) No feedback: nothing after the last tap.
// 3) Drift Speed / Drift Amp: Amp 0 = static, Speed 0 = frozen, both > 0 = moving.
// 4) Graph: Left / Right ports carry audio, Mono = (L+R)/2, Dual L != R; drift params reach the DSP.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");

const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const e = instance.exports;
const mem = e.memory;
if (!mem) throw new Error("wasm memory export missing");

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

// ---- 1) native tap layout ----
const erCreate = must("soemdsp_exponential_delay_create");
const erDestroy = must("soemdsp_exponential_delay_destroy");
const erSample = must("soemdsp_exponential_delay_sample");
const erRight = must("soemdsp_exponential_delay_right");

const SR = 48000;
const TIME = 0.1;
const N = 6;

function impulseResponse(mode, offset = 0, len = Math.ceil(TIME * SR) + 64) {
  const h = erCreate() | 0;
  if (!h) throw new Error("create failed");
  const L = new Float64Array(len);
  const R = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    // args: inL, inR, time, count, mix, driftSpeed, driftAmp, seed, randomOffset, mode, sr
    const x = i === 0 ? 1 : 0;
    L[i] = erSample(h, x, x, TIME, N, 1, 0.25, 0, 1, offset, mode, SR);
    R[i] = erRight(h);
  }
  erDestroy(h);
  return { L, R };
}

// Tap clusters: runs of nonzero samples (a fractional tap spans 2 samples).
function clusters(buf) {
  const out = [];
  let start = -1;
  let sum = 0;
  for (let i = 0; i <= buf.length; i++) {
    const v = i < buf.length ? Math.abs(buf[i]) : 0;
    if (v > 1e-9) {
      if (start < 0) { start = i; sum = 0; }
      sum += v;
    } else if (start >= 0) {
      out.push({ at: start, energy: sum });
      start = -1;
    }
  }
  return out;
}

function expTap(u) {
  return TIME * SR * (Math.exp(3 * u) - 1) / (Math.exp(3) - 1);
}
function near(cs, pos) {
  return cs.some((c) => Math.abs(c.at - pos) <= 1.5);
}

{
  const { L, R } = impulseResponse(0);
  const cl = clusters(L);
  const cr = clusters(R);
  if (cl.length !== N) throw new Error(`Dual L taps ${cl.length} != ${N}`);
  if (cr.length !== N) throw new Error(`Dual R taps ${cr.length} != ${N}`);
  for (let i = 1; i <= N; i++) {
    if (!near(cl, expTap(i / N))) throw new Error(`Dual L missing tap ${i}`);
    if (!near(cr, expTap((i - 0.5) / N))) throw new Error(`Dual R missing tap ${i}`);
  }
  let diff = 0;
  for (let i = 0; i < L.length; i++) diff += Math.abs(L[i] - R[i]);
  if (!(diff > 0.1)) throw new Error(`Dual L/R identical diff=${diff}`);
  const sumL = cl.reduce((s, c) => s + c.energy, 0);
  const sumR = cr.reduce((s, c) => s + c.energy, 0);
  if (Math.abs(sumL - 1) > 0.02 || Math.abs(sumR - 1) > 0.02) {
    throw new Error(`Dual per-side gain L=${sumL} R=${sumR} (want 1)`);
  }
  console.log(`dual ok: L ${cl.map((c) => c.at).join(",")} | R ${cr.map((c) => c.at).join(",")}`);
}

{
  // Dual with Random Offset: sides get different random offsets.
  const { L, R } = impulseResponse(0, 0.01);
  const cl = clusters(L).map((c) => c.at);
  const cr = clusters(R).map((c) => c.at);
  if (cl.length !== N || cr.length !== N) throw new Error("Dual offset tap count");
  console.log(`dual+offset ok: L ${cl.join(",")} | R ${cr.join(",")}`);
}

{
  const { L, R } = impulseResponse(1);
  const cl = clusters(L);
  const cr = clusters(R);
  const half = N / 2;
  if (cl.length !== half || cr.length !== half) {
    throw new Error(`Split taps L=${cl.length} R=${cr.length} want ${half}/${half}`);
  }
  for (let i = 1; i <= N; i++) {
    const pos = expTap(i / N);
    const onL = near(cl, pos);
    const onR = near(cr, pos);
    if (i % 2 === 1 && !(onL && !onR)) throw new Error(`Split tap ${i} should be Left only`);
    if (i % 2 === 0 && !(onR && !onL)) throw new Error(`Split tap ${i} should be Right only`);
  }
  const sumL = cl.reduce((s, c) => s + c.energy, 0);
  const sumR = cr.reduce((s, c) => s + c.energy, 0);
  if (Math.abs(sumL - 1) > 0.02 || Math.abs(sumR - 1) > 0.02) {
    throw new Error(`Split per-side gain L=${sumL} R=${sumR} (want 1)`);
  }
  console.log(`split ok: L ${cl.map((c) => c.at).join(",")} | R ${cr.map((c) => c.at).join(",")}`);
}

{
  // Mono: original single ring. L == R, taps at u = i/N, sum / N.
  const { L, R } = impulseResponse(2);
  for (let i = 0; i < L.length; i++) if (L[i] !== R[i]) throw new Error(`Mono L != R at ${i}`);
  // Old v3 formula: impulse through linear-interp taps at expTap(i/N), each 1/N.
  const ref = new Float64Array(L.length);
  for (let i = 1; i <= N; i++) {
    const d = Math.max(1, expTap(i / N));
    const k = Math.floor(d);
    const frac = d - k;
    ref[k] += (1 - frac) / N;
    if (k + 1 < ref.length) ref[k + 1] += frac / N;
  }
  let err = 0;
  for (let i = 0; i < L.length; i++) err = Math.max(err, Math.abs(L[i] - ref[i]));
  // dsp_exp vs Math.exp shifts tap fractions slightly (~1e-4).
  if (err > 1e-3) throw new Error(`Mono vs old formula max err ${err}`);
  // Mono Left equals Dual Left (same ring, slots, seeds).
  const dual = impulseResponse(0);
  for (let i = 0; i < L.length; i++) if (L[i] !== dual.L[i]) throw new Error("Mono L != Dual L");
  console.log(`mono ok: taps ${clusters(L).map((c) => c.at).join(",")} err ${err.toExponential(2)}`);
}

{
  // No feedback: an impulse must leave nothing after the farthest tap.
  for (const mode of [0, 1, 2]) {
    const len = Math.ceil(TIME * SR) * 4;
    const { L, R } = impulseResponse(mode, 0, len);
    const tail = Math.ceil(TIME * SR) + 4;
    for (let i = tail; i < len; i++) {
      if (L[i] !== 0 || R[i] !== 0) throw new Error(`mode ${mode} tail at ${i}: feedback still present`);
    }
  }
  console.log("no-feedback ok");
}

function noiseRun(speed, amp, len = SR) {
  const h = erCreate() | 0;
  let x = 12345;
  const L = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const v = x / 4294967296 - 0.5;
    L[i] = erSample(h, v, v, TIME, N, 1, speed, amp, 1, 0, 0, SR) + erRight(h);
  }
  erDestroy(h);
  return L;
}
function absDiff(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d; }
{
  const still = noiseRun(0.25, 0);
  if (absDiff(still, noiseRun(5, 0)) !== 0) throw new Error("Drift Amp 0 must ignore Drift Speed");
  const frozen = noiseRun(0, 0.1);
  if (!(absDiff(still, frozen) > 1)) throw new Error("Drift Amp 0.1 at Speed 0 should still shift taps");
  // Frozen drift = static taps: impulse response is the same early and late.
  const moving = noiseRun(5, 0.1);
  if (!(absDiff(frozen, moving) > 1)) throw new Error("Drift Speed had no effect");
  const slow = noiseRun(0.25, 0.1);
  if (!(absDiff(slow, moving) > 1)) throw new Error("Drift Speed 0.25 vs 5 identical");
  console.log("drift speed/amp ok");
}

// ---- 4) graph wiring: Left / Right / Mono ----
const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const outL = must("soemdsp_graph_block_output_left_ptr");

const TYPE_POLY = 1;
const TYPE_DELAY = 203;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const PORT_LEFT = 1;
const PORT_RIGHT = 2;
const PARAM_FREQUENCY = 10;
const PARAM_AMPLITUDE = 12;
const PARAM_MODE = 21;
const PARAM_STAGES = 22;
const PARAM_TIME_NUM = 52;
const PARAM_VOLUME_DB = 0;
const PARAM_LFO_AMPLITUDE = 45; // Drift Amp
const PARAM_LFO_RATE = 57; // Drift Speed

// Route one Early Reflections port into the Out node's main input and
// capture the block output. Blocks are 128 frames (the engine's max);
// reading further runs past outL into outR and engine state.
function capturePort(mode, port, driftSpeed = 0.25, driftAmp = 0) {
  const g = create() | 0;
  setSr(g, 48000);
  const hOsc = 0x20301 >>> 0;
  const hDel = 0x20302 >>> 0;
  const hOut = 0x20303 >>> 0;
  if ((add(g, hOsc, TYPE_POLY) | 0) !== 0) throw new Error("add osc");
  if ((add(g, hDel, TYPE_DELAY) | 0) !== 0) throw new Error("add earlyReflections");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("add out");
  if ((connect(g, hOsc, PORT_MONO, hDel, PORT_MONO) | 0) !== 0) throw new Error("connect in");
  if ((connect(g, hDel, port, hOut, PORT_MONO) | 0) !== 0) throw new Error("connect out");
  setParam(g, hOsc, PARAM_FREQUENCY, 220);
  setParam(g, hOsc, PARAM_AMPLITUDE, 0.5);
  setParam(g, hDel, PARAM_TIME_NUM, 0.1);
  setParam(g, hDel, PARAM_STAGES, 7);
  setParam(g, hDel, PARAM_MODE, mode);
  setParam(g, hDel, PARAM_AMPLITUDE, 1);
  setParam(g, hDel, PARAM_LFO_RATE, driftSpeed);
  setParam(g, hDel, PARAM_LFO_AMPLITUDE, driftAmp);
  setParam(g, hOut, PARAM_VOLUME_DB, 0);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  const out = new Float64Array(80 * 128);
  for (let i = 0; i < 80; i++) {
    process(g, 128);
    out.set(new Float64Array(mem.buffer, outL(g) | 0, 128), i * 128);
  }
  destroy(g);
  return out;
}

function runGraph(mode) {
  const l = capturePort(mode, PORT_LEFT);
  const r = capturePort(mode, PORT_RIGHT);
  const m = capturePort(mode, PORT_MONO);
  let pl = 0, pr = 0, pm = 0, diff = 0;
  for (let k = 0; k < l.length; k++) {
    pl = Math.max(pl, Math.abs(l[k]));
    pr = Math.max(pr, Math.abs(r[k]));
    pm = Math.max(pm, Math.abs(m[k]));
    diff += Math.abs(l[k] - r[k]);
  }
  if (!(pl > 0.01 && pr > 0.01)) throw new Error(`mode ${mode} silent L=${pl} R=${pr}`);
  if (pl > 2 || pr > 2) throw new Error(`mode ${mode} too hot L=${pl} R=${pr}`);
  if (!(diff > 0.1)) throw new Error(`mode ${mode} Left == Right diff=${diff}`);
  let me = 0;
  for (let k = 0; k < l.length; k++) me = Math.max(me, Math.abs(m[k] - 0.5 * (l[k] + r[k])));
  if (me > 1e-9) throw new Error(`mode ${mode} Mono out != (Left + Right) / 2 (err ${me}, peak ${pm})`);
  console.log(`graph mode ${mode} ok peak Left=${pl.toFixed(4)} Right=${pr.toFixed(4)} Mono=(L+R)/2`);
}
runGraph(0);
runGraph(1);
{
  const l = capturePort(2, PORT_LEFT);
  const r = capturePort(2, PORT_RIGHT);
  let pk = 0;
  for (let k = 0; k < l.length; k++) { if (l[k] !== r[k]) throw new Error("graph Mono L != R"); pk = Math.max(pk, Math.abs(l[k])); }
  if (!(pk > 0.01)) throw new Error("graph Mono silent");
  console.log(`graph mono ok peak=${pk.toFixed(4)}`);
}
{
  const a = capturePort(0, PORT_LEFT, 0.25, 0);
  const b = capturePort(0, PORT_LEFT, 0.25, 0.2);
  const c = capturePort(0, PORT_LEFT, 8, 0.2);
  if (!(absDiff(a, b) > 0.1)) throw new Error("graph Drift Amp has no effect");
  if (!(absDiff(b, c) > 0.1)) throw new Error("graph Drift Speed has no effect");
  console.log("graph drift params ok");
}

console.log("smoke_exponential_delay ok");
