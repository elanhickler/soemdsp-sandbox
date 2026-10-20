// Headless: stereo L/R outs (graph 187).
//   Bradley 2A Out L/R, Softpop 2 (R own Pitch Mod).
//   (Mode Resonator / Random Clock / Turing / Degree Turing stereo reverted, graph 190.)
// Checks per module: L != R where expected, every L/R out finite and
// Planck-clean (no |x| in (0, 1e-7)), two graphs with the same Reset schedule
// match bit-exact.
// Optional: --capture <file> stores L (and Softpop 2 R) outs; --compare <file>
// checks L is bit-identical to a capture made on the previous build.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const e = instance.exports;
const mem = e.memory;
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
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");

const argv = process.argv.slice(2);
const capturePath = argv[0] === "--capture" ? argv[1] : null;
const comparePath = argv[0] === "--compare" ? argv[1] : null;

const T = { out: 6, noise: 14, clock: 28, bradley: 49, softpop2: 219 };
const P = { mono: 0, left: 1, right: 2, saw: 3, ramp: 4, square: 5, tri: 6, sine: 7, trisaw: 8, reset: 19, trigger: 20 };
const K = {
  frequency: 10, amplitude: 12, shape: 13, phase: 14, mode: 21, stages: 22, center: 30, width: 31,
  mix: 40, diffusionSize: 41, diffusionAmount: 42, recycle: 44, lfoAmplitude: 45, lfoBaseSpeed: 46,
  seed: 48, feedback: 50, level: 51, timeNumerator: 52, timeDenominator: 53, offsetMs: 55,
  lfoRate: 57, lpfFrequency: 59,
};
const SR = 48000;
const N = 128;
const BLOCKS = 120;
const PLANCK = 1e-7;

// One graph: module h (+ optional Clock -> Trigger / Reset, Noise -> In).
// outs: { name: port }. Returns { name: Float64Array }.
function render(spec) {
  const g = create() | 0;
  setSr(g, SR);
  const hOut = 0x7f00, h = 0x7a10, hClk = 0x7f01, hRst = 0x7f02, hIn = 0x7f03;
  if ((add(g, hOut, T.out) | 0) !== 0) throw new Error("out add");
  if ((add(g, h, spec.type) | 0) !== 0) throw new Error(`add ${spec.name}`);
  for (const [k, v] of Object.entries(spec.params || {})) setParam(g, h, K[k], v);
  if (spec.clockHz) {
    if ((add(g, hClk, T.clock) | 0) !== 0) throw new Error("clock add");
    setParam(g, hClk, K.frequency, spec.clockHz);
    setParam(g, hClk, K.amplitude, 1);
    if ((connect(g, hClk, P.mono, h, P.trigger) | 0) !== 0) throw new Error("clock connect");
  }
  if (spec.resetHz) {
    if ((add(g, hRst, T.clock) | 0) !== 0) throw new Error("reset clock add");
    setParam(g, hRst, K.frequency, spec.resetHz);
    setParam(g, hRst, K.amplitude, 1);
    if ((connect(g, hRst, P.mono, h, P.reset) | 0) !== 0) throw new Error("reset connect");
  }
  if (spec.noiseIn) {
    if ((add(g, hIn, T.noise) | 0) !== 0) throw new Error("noise add");
    setParam(g, hIn, K.amplitude, spec.noiseIn);
    setParam(g, hIn, K.seed, 7);
    if ((connect(g, hIn, P.mono, h, P.mono) | 0) !== 0) throw new Error("noise connect");
  }
  const outs = Object.entries(spec.outs);
  for (const [, port] of outs.slice(0, 2)) {
    if ((connect(g, h, port, hOut, P.mono) | 0) !== 0) throw new Error("out connect");
  }
  if ((compile(g) | 0) !== 0) throw new Error(`compile ${spec.name}`);
  snap(g);
  const res = {};
  for (const [name] of outs) res[name] = new Float64Array(BLOCKS * N);
  if (spec.resetHz) res.__reset = new Float64Array(BLOCKS * N);
  for (let b = 0; b < BLOCKS; b++) {
    processBlock(g, N);
    for (const [name, port] of outs) res[name].set(new Float64Array(mem.buffer, portPtr(g, h, port) | 0, N), b * N);
    if (spec.resetHz) res.__reset.set(new Float64Array(mem.buffer, portPtr(g, hRst, P.mono) | 0, N), b * N);
  }
  destroy(g);
  return res;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const diff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`ok   ${name}${detail ? ` (${detail})` : ""}`);
  else { failures += 1; console.error(`FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}
// sineZero: a pure unimpaired sine lands within ~1e-13 of 0 at its zero
// crossings (sin of a wrapped phase). That residue is in the original L output
// too (bit-identical requirement), so those specs only check finite + no
// subnormals; every impaired / noise / CV spec checks the full 1e-7 floor.
function planck(a, sineZero) {
  const floor = sineZero ? 2.2250738585072014e-308 : PLANCK;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (!Number.isFinite(x)) return `non-finite at ${i}`;
    if (x !== 0 && Math.abs(x) < floor) return `sub-floor ${x} at ${i}`;
  }
  return "";
}

// pairs: [L name, R name, expect different]
const SPECS = [
  { name: "bradley2a", type: T.bradley, params: {
      frequency: 1004, width: 3, shape: 0.6, lfoRate: 7, lfoAmplitude: 0.4, lfoBaseSpeed: 5,
      mix: 0.2, lpfFrequency: 2600, diffusionSize: 0.1, diffusionAmount: 0.1, feedback: 6,
      timeNumerator: 0.02, level: 0, phase: 0, recycle: 0.3, amplitude: 0.8, seed: 11 },
    outs: { "Out L": P.mono, "Out R": P.right }, pairs: [["Out L", "Out R", true]] },
  { name: "bradley2a clean (no impairments)", type: T.bradley, params: { frequency: 1004, amplitude: 1, feedback: 0, seed: 11 },
    outs: { "Out L": P.mono, "Out R": P.right }, pairs: [["Out L", "Out R", false]], sineZero: true },
  { name: "softpop2 Pitch Mod", type: T.softpop2, params: { frequency: 330, mix: 0.4, shape: 0, width: 0.3, lfoAmplitude: 1, amplitude: 1, stages: 0, seed: 2 },
    outs: { "Left": P.left, "Right": P.right }, pairs: [["Left", "Right", true]], keepR: true },
  { name: "softpop2 sine only (Crossfade 0)", type: T.softpop2, params: { frequency: 330, mix: 0, shape: 0, width: 0.3, lfoAmplitude: 1, amplitude: 1, stages: 0, seed: 2 },
    outs: { "Left": P.left, "Right": P.right }, pairs: [["Left", "Right", false]], keepR: true, sineZero: true },
];

const captured = {};
const baseline = comparePath ? JSON.parse(fs.readFileSync(comparePath, "utf8")) : null;
for (const spec of SPECS) {
  const a = render(spec);
  const lNames = spec.pairs.map((p) => p[0]);
  if (capturePath) {
    captured[spec.name] = {};
    for (const n of [...lNames, ...(spec.keepR ? spec.pairs.map((p) => p[1]) : [])]) captured[spec.name][n] = Array.from(a[n]);
    continue;
  }
  const b = render(spec);
  for (const [l, r, expectDiff] of spec.pairs) {
    const d = diff(a[l], a[r]);
    if (expectDiff) check(`${spec.name}: ${l} != ${r}`, d > 1e-6 && peak(a[r]) > 1e-3, `maxDiff=${d.toFixed(4)} peakR=${peak(a[r]).toFixed(4)}`);
    else check(`${spec.name}: ${l} == ${r} (shared core only)`, same(a[l], a[r]), `maxDiff=${d}`);
  }
  for (const n of Object.keys(spec.outs)) {
    const bad = planck(a[n], spec.sineZero);
    check(`${spec.name}: ${n} finite + ${spec.sineZero ? "no subnormals (pure sine)" : "Planck-clean"}`, !bad, bad);
    check(`${spec.name}: ${n} repeats bit-exact (same Reset schedule)`, same(a[n], b[n]));
  }
  if (baseline && baseline[spec.name]) {
    for (const n of lNames) {
      const old = Float64Array.from(baseline[spec.name][n]);
      check(`${spec.name}: ${n} bit-identical to previous build`, same(a[n], old), `maxDiff=${diff(a[n], old)}`);
    }
    if (spec.keepR) {
      for (const [, r] of spec.pairs) {
        const old = Float64Array.from(baseline[spec.name][r]);
        const d = diff(a[r], old);
        console.log(`info ${spec.name}: ${r} vs previous build maxDiff=${d}`);
      }
    }
  }
}
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(captured));
  console.log(`captured ${Object.keys(captured).length} specs -> ${capturePath}`);
  process.exit(0);
}
if (failures) {
  console.error(`smoke_graph_stereo_lr: ${failures} failure(s)`);
  process.exit(1);
}
console.log("smoke_graph_stereo_lr ok");
