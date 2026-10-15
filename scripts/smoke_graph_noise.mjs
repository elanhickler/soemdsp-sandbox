// Headless: Wave 7 noise/modulator cores → output.
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

const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const version = must("soemdsp_graph_version");

const TYPE_OUT = 6;
const TYPE_CLOCK = 28;
const PORT_MONO = 0;
const PORT_LEFT = 1;
const PORT_TRIGGER = 20;

const PARAM_FREQUENCY = 10;
const PARAM_AMPLITUDE = 12;
const PARAM_SHAPE = 13;
const PARAM_MODE = 21;
const PARAM_STAGES = 22;
const PARAM_CENTER = 30;
const PARAM_WIDTH = 31;
const PARAM_MIX = 40;
const PARAM_SEED = 48;
const PARAM_TIME_NUM = 52;
const PARAM_TIME_DEN = 53;
const PARAM_IN_LOW = 80;
const PARAM_IN_HIGH = 81;

const ver = version() | 0;
if (ver < 50) throw new Error(`graph version ${ver} < 50`);
console.log(`graph version ${ver}`);

function view(ptr, n) {
  return new Float64Array(mem.buffer, ptr, n);
}

function stats(ptr, n) {
  const x = view(ptr, n);
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(x[i]));
    sumSq += x[i] * x[i];
  }
  return { peak, rms: Math.sqrt(sumSq / n) };
}

function runSource(name, typeId, setup, opts = {}) {
  const g = create() | 0;
  setSr(g, 48000);
  const h = 0x8700 + typeId;
  const hOut = h + 1;
  if ((add(g, h, typeId) | 0) !== 0) throw new Error(`${name} add`);
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error(`${name} out`);
  if ((connect(g, h, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error(`${name} conn`);
  setup(g, h);
  if ((compile(g) | 0) !== 0) throw new Error(`${name} compile`);
  snap(g);
  let peak = 0;
  let sumSq = 0;
  let n = 0;
  let yPeak = 0;
  for (let q = 0; q < (opts.blocks || 80); q++) {
    process(g, 128);
    const s = stats(portPtr(g, h, PORT_MONO) | 0, 128);
    peak = Math.max(peak, s.peak);
    sumSq += s.rms * s.rms * 128;
    n += 128;
    yPeak = Math.max(yPeak, stats(portPtr(g, h, PORT_LEFT) | 0, 128).peak);
  }
  const rms = Math.sqrt(sumSq / n);
  const minPeak = opts.minPeak ?? 0.01;
  const maxPeak = opts.maxPeak ?? 4;
  if (!(peak > minPeak && peak < maxPeak)) throw new Error(`${name} peak=${peak}`);
  if (!(rms > (opts.minRms ?? 0.001))) throw new Error(`${name} rms=${rms}`);
  console.log(`${name} ok peak=${peak.toFixed(4)} rms=${rms.toFixed(4)} yPeak=${yPeak.toFixed(4)}`);
  destroy(g);
}

runSource("fractalBrownianNoise", 87, (g, h) => {
  setParam(g, h, PARAM_FREQUENCY, 8);
  setParam(g, h, PARAM_STAGES, 4);
  setParam(g, h, PARAM_SHAPE, 0.5);
  setParam(g, h, PARAM_CENTER, 1);
  setParam(g, h, PARAM_SEED, 1);
  setParam(g, h, PARAM_AMPLITUDE, 1);
});

runSource("formulaNoise", 88, (g, h) => {
  setParam(g, h, PARAM_FREQUENCY, 44100); // speed digits/s
  setParam(g, h, PARAM_CENTER, 0);        // start
  setParam(g, h, PARAM_STAGES, 0);        // loop Wrap
  setParam(g, h, PARAM_MODE, 6);          // Cubic
}, { blocks: 200, minPeak: 0.05 });

runSource("formulaNoise", 88, (g, h) => {
  setParam(g, h, PARAM_FREQUENCY, 2000);  // speed steps/s
  setParam(g, h, PARAM_SHAPE, 8);         // source Random Walk (graph Source wiring)
  setParam(g, h, PARAM_SEED, 0);          // Seed 0 is valid
  setParam(g, h, PARAM_MODE, 9);          // Gaussian
}, { blocks: 200, minPeak: 0.05 });

// formulaNoise Amplitude: per-sample gain on Bipolar/Unipolar (Trigger unscaled).
{
  const runFn = (amp) => {
    const g = create() | 0; setSr(g, 48000);
    const h = 0x9888, hOut = h + 1;
    add(g, h, 88); add(g, hOut, TYPE_OUT); connect(g, h, PORT_MONO, hOut, PORT_MONO);
    setParam(g, h, PARAM_FREQUENCY, 2000); setParam(g, h, PARAM_MODE, 6);
    if (amp !== null) setParam(g, h, PARAM_AMPLITUDE, amp);
    compile(g); snap(g);
    const mono = [], uni = [], trig = [];
    for (let q = 0; q < 20; q++) { process(g, 128);
      mono.push(...view(portPtr(g, h, PORT_MONO) | 0, 128)); uni.push(...view(portPtr(g, h, PORT_LEFT) | 0, 128));
      trig.push(...view(portPtr(g, h, 2) | 0, 128)); }
    destroy(g); return { mono, uni, trig };
  };
  const def = runFn(null), one = runFn(1), half = runFn(0.5), big = runFn(2), zero = runFn(0);
  let peak = 0;
  for (let i = 0; i < one.mono.length; i++) {
    peak = Math.max(peak, Math.abs(one.mono[i]));
    if (def.mono[i] !== one.mono[i]) throw new Error(`formulaNoise amp default != 1 at ${i}`);
    if (Math.abs(half.mono[i] - 0.5 * one.mono[i]) > 1e-12 || Math.abs(half.uni[i] - 0.5 * one.uni[i]) > 1e-12) throw new Error(`formulaNoise amp 0.5 at ${i}`);
    if (Math.abs(big.mono[i] - 2 * one.mono[i]) > 1e-12) throw new Error(`formulaNoise amp 2 (no clamp) at ${i}`);
    if (zero.mono[i] !== 0 || zero.uni[i] !== 0) throw new Error(`formulaNoise amp 0 at ${i}`);
    if (half.trig[i] !== one.trig[i]) throw new Error(`formulaNoise trigger scaled at ${i}`);
  }
  if (!(peak > 0.05)) throw new Error(`formulaNoise amp test silent`);
  console.log(`formulaNoise amplitude ok: default=1, 0.5/2/0 scale Bipolar+Unipolar exactly, Trigger unscaled`);
}

runSource("randomWalk", 89, (g, h) => {
  setParam(g, h, PARAM_MODE, 3);
  setParam(g, h, PARAM_FREQUENCY, 32);
  setParam(g, h, PARAM_WIDTH, 8);
  setParam(g, h, PARAM_SEED, 7);
  setParam(g, h, PARAM_AMPLITUDE, 1);
});

// pulseExplosion needs a trigger clock
{
  const g = create() | 0;
  setSr(g, 48000);
  const h = 0x90a1;
  const hClk = 0x90a2;
  const hOut = 0x90a3;
  if ((add(g, h, 90) | 0) !== 0) throw new Error("pulseExplosion add");
  if ((add(g, hClk, TYPE_CLOCK) | 0) !== 0) throw new Error("pulseExplosion clock");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("pulseExplosion out");
  setParam(g, hClk, PARAM_FREQUENCY, 2);
  setParam(g, hClk, PARAM_AMPLITUDE, 1);
  setParam(g, h, PARAM_TIME_NUM, 0);
  setParam(g, h, PARAM_CENTER, 0.05);
  setParam(g, h, PARAM_TIME_DEN, 0.2);
  setParam(g, h, PARAM_MIX, 0.5);
  setParam(g, h, PARAM_STAGES, 16);
  setParam(g, h, PARAM_IN_LOW, 0.5);
  setParam(g, h, PARAM_IN_HIGH, 1);
  setParam(g, h, PARAM_SEED, 42);
  if ((connect(g, hClk, PORT_MONO, h, PORT_TRIGGER) | 0) !== 0) {
    throw new Error("pulseExplosion trig");
  }
  if ((connect(g, h, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) {
    throw new Error("pulseExplosion out");
  }
  if ((compile(g) | 0) !== 0) throw new Error("pulseExplosion compile");
  snap(g);
  let peak = 0;
  let curvePeak = 0;
  for (let q = 0; q < 400; q++) {
    process(g, 128);
    peak = Math.max(peak, stats(portPtr(g, h, PORT_MONO) | 0, 128).peak);
    curvePeak = Math.max(curvePeak, stats(portPtr(g, h, PORT_LEFT) | 0, 128).peak);
  }
  if (!(peak > 0.4)) throw new Error(`pulseExplosion peak=${peak}`);
  if (!(curvePeak > 0.01)) throw new Error(`pulseExplosion curve=${curvePeak}`);
  console.log(`pulseExplosion ok peak=${peak.toFixed(4)} curvePeak=${curvePeak.toFixed(4)}`);
  destroy(g);
}

// Formula Noise sources: first values per source (tables vs known digits; live
// sources vs a JS twin of seed_mix / indexed_noise.h), determinism, and every
// Source x Smoothing combination stays finite and near range.
{
  const pn = (n) => must(`soemdsp_formula_noise_${n}`);
  const pnCreate = pn("create"), pnDestroy = pn("destroy"), pnSetSource = pn("set_source");
  const pnSample = pn("sample"), pnValueAt = pn("value_at"), pnSetStart = pn("set_start");
  if ((pn("source_count")() | 0) !== 11) throw new Error("formulaNoise source count");
  const imul = Math.imul;
  const av = (x) => {
    x >>>= 0; x ^= x >>> 16; x = imul(x, 0x85EBCA6B) >>> 0; x ^= x >>> 13;
    x = imul(x, 0xC2B2AE35) >>> 0; x ^= x >>> 16; return x >>> 0;
  };
  const mix = (seed, c, i) => {
    let h = av((seed + 0x9E3779B9) >>> 0);
    h = av(h ^ ((imul(c, 0x27D4EB2F) + 0x165667B1) >>> 0));
    return av(h ^ ((imul(i, 0x85EBCA77) + 0xC2B2AE3D) >>> 0));
  };
  const idx = (seed, part, k) => mix(mix(seed, part, 0), part, k); // k < 2^32
  const u01 = (seed, part, k) => (idx(seed, part, k) >>> 8) / 16777216;
  const h = pnCreate() | 0;
  if (h <= 0) throw new Error("formulaNoise create");
  const first = (src, seed, n) => {
    pnSetSource(h, src, seed);
    const out = [];
    for (let i = 0; i < n; i++) out.push(pnValueAt(h, i));
    return out;
  };
  const known = { 0: "31415926535897932384", 1: "27182818284590452353", 2: "14142135623730950488",
    3: "16180339887498948482", 4: "06931471805599453094" };
  for (const [src, digits] of Object.entries(known)) {
    const got = first(+src, 1, 20).join("");
    if (got !== digits) throw new Error(`formulaNoise source ${src} digits ${got} != ${digits}`);
  }
  const close = (a, b, what) => { if (Math.abs(a - b) > 1e-12) throw new Error(`formulaNoise ${what}: ${a} vs ${b}`); };
  for (const seed of [0, 1, 12345]) {
    const dig = first(5, seed, 64);
    dig.forEach((v, i) => close(v, Number((BigInt(idx(seed, 1, i)) * 10n) >> 32n), `digits seed ${seed} i ${i}`));
    first(6, seed, 64).forEach((v, i) => close(v, u01(seed, 2, i) * 9, `white seed ${seed} i ${i}`));
    first(7, seed, 64).forEach((v, i) => close(v, (u01(seed, 3, i) + u01(seed, 4, i) + u01(seed, 5, i) + u01(seed, 6, i)) * 2.25, `gauss seed ${seed} i ${i}`));
    const walk = first(8, seed, 200);
    let p = Number((BigInt(idx(seed, 8, 0)) * 10n) >> 32n);
    for (let i = 0; i < 200; i++) {
      const m = ((p % 18) + 18) % 18;
      close(walk[i], m <= 9 ? m : 18 - m, `walk seed ${seed} i ${i}`);
      p += ((mix(seed, 7, i >> 5) >>> (i & 31)) & 1) ? 1 : -1;
    }
    const lg = first(9, seed, 256);
    for (let i = 0; i + 1 < 256; i++) {
      const x = lg[i] / 9;
      close(lg[i + 1], 3.99 * x * (1 - x) * 9, `logistic seed ${seed} i ${i}`);
    }
    const fib = first(10, seed, 80);
    for (let i = 0; i + 2 < 80; i++) close(fib[i + 2], (fib[i] + fib[i + 1]) % 10, `fibonacci seed ${seed} i ${i}`);
  }
  if (first(5, 0, 16).join() === first(5, 1, 16).join()) throw new Error("formulaNoise seed 0 == seed 1");
  // far value then back near the start (walk cursor both ways)
  pnSetSource(h, 8, 3);
  const w0 = pnValueAt(h, 5), wFar = pnValueAt(h, 2097151), w0b = pnValueAt(h, 5);
  if (w0 !== w0b || !(wFar >= 0 && wFar <= 9)) throw new Error("formulaNoise walk cursor");
  for (let src = 0; src < 11; src++) {
    for (let mode = 0; mode < 10; mode++) {
      pnSetSource(h, src, 7);
      pnSetStart(h, 0.25); pnSetStart(h, 0);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 4000; i++) {
        const v = pnSample(h, 3000, 48000, mode, i > 2000 ? 1 : 0, 0, 0);
        if (!Number.isFinite(v)) throw new Error(`formulaNoise src ${src} mode ${mode} non-finite`);
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      if (lo < -1.3 || hi > 1.3 || !(hi > lo)) throw new Error(`formulaNoise src ${src} mode ${mode} range ${lo}..${hi}`);
    }
  }
  pnDestroy(h);
  console.log("formulaNoise sources ok: 5 tables match known digits, 6 live sources match JS twin");
}

runSource("fibonacciNoise", 217, (g, h) => {
  setParam(g, h, PARAM_FREQUENCY, 3000);  // speed steps/s
  setParam(g, h, PARAM_STAGES, 5);        // lags 418/1279
  setParam(g, h, PARAM_SHAPE, 3);         // XOR
  setParam(g, h, PARAM_CENTER, 1);        // Continuous
  setParam(g, h, PARAM_SEED, 0);          // Seed 0 is valid
  setParam(g, h, PARAM_MODE, 9);          // Gaussian
}, { blocks: 200, minPeak: 0.05 });

// Fibonacci Noise: recurrence for every operation, exact XOR period,
// no early repeat, output range / levels, Seed 0 vs 1, look-ahead smoothing.
{
  const fn = (n) => must(`soemdsp_fibonacci_noise_${n}`);
  const tInit = fn("test_init"), tNext = fn("test_next");
  const fCreate = fn("create"), fDestroy = fn("destroy"), fConfig = fn("set_config"), fSample = fn("sample");
  const lagPairs = [[24, 55], [5, 17], [31, 63], [97, 127], [273, 607], [418, 1279]];
  const ops = [(a, b) => (a + b) >>> 0, (a, b) => (a - b) >>> 0, (a, b) => Math.imul(a, b) >>> 0, (a, b) => (a ^ b) >>> 0];
  for (let li = 0; li < lagPairs.length; li++) {
    const [j, k] = lagPairs[li];
    for (let op = 0; op < 4; op++) {
      tInit(1, li, op);
      const x = [];
      for (let i = 0; i < k + 2000; i++) x.push(tNext());
      for (let n = k; n < x.length; n++) {
        if (x[n] !== ops[op](x[n - j], x[n - k])) throw new Error(`fibonacciNoise recurrence lags ${j}/${k} op ${op} n ${n}`);
      }
      if (new Set(x.slice(-200)).size < 150) throw new Error(`fibonacciNoise lags ${j}/${k} op ${op} degenerate`);
    }
  }
  // XOR 5/17 is a GFSR: period exactly 2^17 - 1 = 131071 (prime, so 1 or 131071).
  tInit(3, 1, 3);
  const P = 131071;
  const xs = new Float64Array(P + 300);
  for (let i = 0; i < xs.length; i++) xs[i] = tNext();
  for (let i = 0; i < 300; i++) if (xs[i] !== xs[i + P]) throw new Error("fibonacciNoise XOR 5/17 period != 131071");
  if (xs[0] === xs[1] && xs[1] === xs[2]) throw new Error("fibonacciNoise XOR constant");
  // Add 5/17: the first 8 outputs never reappear in the next 1,000,000.
  tInit(3, 1, 0);
  const head = []; for (let i = 0; i < 8; i++) head.push(tNext());
  const win = head.slice();
  for (let i = 0; i < 1000000; i++) {
    win.shift(); win.push(tNext());
    if (win.every((v, q) => v === head[q])) throw new Error(`fibonacciNoise Add 5/17 repeated after ${i + 1}`);
  }
  const run = (cfg, mode, n, speed = 48000) => {
    const h = fCreate() | 0;
    if (h <= 0) throw new Error("fibonacciNoise create");
    fConfig(h, cfg.lags, cfg.op, cfg.out, cfg.seed);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = fSample(h, speed, 48000, mode, 0, 0);
    fDestroy(h);
    return out;
  };
  for (let li = 0; li < 6; li++) for (let op = 0; op < 4; op++) for (let outm = 0; outm < 2; outm++) {
    const y = run({ lags: li, op, out: outm, seed: 1 }, 0, 20000);
    const counts = new Array(10).fill(0);
    for (const v of y) {
      if (!(v >= -1 && v <= 1)) throw new Error(`fibonacciNoise range ${v}`);
      if (outm === 0) {
        const d = (v + 1) * 4.5;
        if (Math.abs(d - Math.round(d)) > 1e-9) throw new Error(`fibonacciNoise digit level ${v}`);
        counts[Math.round(d)]++;
      }
    }
    if (outm === 0 && counts.some((c) => c < 1500 || c > 2500)) throw new Error(`fibonacciNoise digits uneven lags ${li} op ${op}: ${counts}`);
  }
  const s0 = run({ lags: 0, op: 0, out: 0, seed: 0 }, 0, 64), s1 = run({ lags: 0, op: 0, out: 0, seed: 1 }, 0, 64);
  if (s0.join() === s1.join()) throw new Error("fibonacciNoise Seed 0 == Seed 1");
  if (new Set(s0).size < 5) throw new Error("fibonacciNoise Seed 0 degenerate");
  // look-ahead: at speed sr/8, Linear/Cubic/etc. at step starts; Linear equals Hold there.
  const cfg = { lags: 3, op: 0, out: 1, seed: 9 };
  const hold = run(cfg, 0, 8000, 6000);
  const lin = run(cfg, 1, 8000, 6000);
  for (let i = 0; i < 8000; i += 8) if (Math.abs(hold[i] - lin[i]) > 1e-12) throw new Error(`fibonacciNoise linear look-ahead i ${i}`);
  for (let i = 1; i < 8; i++) {
    const want = hold[0] + (hold[8] - hold[0]) * i / 8;
    if (Math.abs(lin[i] - want) > 1e-9) throw new Error("fibonacciNoise linear ramp");
  }
  for (let mode = 0; mode < 10; mode++) {
    const y = run(cfg, mode, 8000, 3000);
    let lo = Infinity, hi = -Infinity;
    for (const v of y) { if (!Number.isFinite(v)) throw new Error(`fibonacciNoise mode ${mode} NaN`); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (lo < -1.3 || hi > 1.3 || !(hi > lo)) throw new Error(`fibonacciNoise mode ${mode} range ${lo}..${hi}`);
  }
  // Reset restarts the same sequence.
  {
    const h = fCreate() | 0;
    fConfig(h, 0, 0, 0, 5);
    const a = []; for (let i = 0; i < 50; i++) a.push(fSample(h, 48000, 48000, 0, 0, 0));
    for (let i = 0; i < 77; i++) fSample(h, 48000, 48000, 0, 0, 0);
    const b = []; for (let i = 0; i < 50; i++) b.push(fSample(h, 48000, 48000, 0, 0, i === 0 ? 1 : 0));
    if (a.join() !== b.join()) throw new Error("fibonacciNoise reset");
    fDestroy(h);
  }
  console.log("fibonacciNoise ok: recurrence x 24 configs, XOR 5/17 period 131071, no early repeat, levels/range, Seed 0 != 1, look-ahead, reset");
}

console.log("noise smoke ok");
