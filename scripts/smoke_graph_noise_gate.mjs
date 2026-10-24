// Headless Noise Gate: silence closed, open burst, hold then release, sub-Open stays closed, Close>Open clamp.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const imp = { env: { emo_process_block: () => 0 } };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), imp);
const e = instance.exports;

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_noise_gate_create");
const destroy = must("soemdsp_noise_gate_destroy");
const sample = must("soemdsp_noise_gate_sample");
const gainOut = must("soemdsp_noise_gate_gain");
const envOut = must("soemdsp_noise_gate_env");
const leftOut = must("soemdsp_noise_gate_left");
const version = must("soemdsp_noise_gate_version");
const graphVersion = must("soemdsp_graph_version");

function expect(got, want, label, eps = 1e-6) {
  if (!(Math.abs(got - want) <= eps)) {
    throw new Error(`${label}: got ${got}, want ${want}`);
  }
}

function expectGt(got, floor, label) {
  if (!(got > floor)) throw new Error(`${label}: got ${got}, want > ${floor}`);
}

function expectLt(got, ceil, label) {
  if (!(got < ceil)) throw new Error(`${label}: got ${got}, want < ${ceil}`);
}

function run(h, left, right, sc, hasSc, openDb, closeDb, att, hold, rel, rangeDb, sr, amp) {
  const mono = sample(h, left, right, sc, hasSc, openDb, closeDb, att, hold, rel, rangeDb, sr, amp);
  return {
    mono,
    gain: gainOut(h),
    env: envOut(h),
    left: leftOut(h),
  };
}

const sr = 48000;
const h = create() | 0;
if (!h) throw new Error("noise gate create failed");

// Silence stays closed.
for (let i = 0; i < 512; i += 1) {
  const g = run(h, 0, 0, 0, 0, -32, -44, 0, 50, 80, -80, sr, 1);
  expect(g.gain, 0, "silence gain", 1e-5);
  expect(g.left, 0, "silence left", 1e-9);
}
expect(envOut(h), 0, "silence env", 1e-9);

// Burst above Open (Attack 0) snaps Gain to 1.
let opened = null;
for (let i = 0; i < 64; i += 1) {
  opened = run(h, 0.5, 0.5, 0, 0, -32, -44, 0, 50, 80, -80, sr, 1);
}
expect(opened.gain, 1, "open burst gain", 1e-5);
expect(opened.left, 0.5, "open burst left", 1e-5);
expectGt(opened.env, 0.4, "open burst env");

// Drop below Close: Hold 50 ms keeps Gain at 1, then Release falls.
const holdSamples = Math.round(0.050 * sr);
for (let i = 0; i < holdSamples; i += 1) {
  const g = run(h, 0, 0, 0, 0, -32, -44, 0, 50, 80, -80, sr, 1);
  expectGt(g.gain, 0.99, `hold sample ${i}`);
}
let released = null;
for (let i = 0; i < Math.round(0.640 * sr); i += 1) {
  released = run(h, 0, 0, 0, 0, -32, -44, 0, 50, 80, -80, sr, 1);
}
expectLt(released.gain, 0.01, "after release gain");

destroy(h);

// Sub-Open burst never opens.
const h2 = create() | 0;
if (!h2) throw new Error("noise gate create 2 failed");
// -40 dB ≈ 0.01, Open is -32 dB ≈ 0.025.
for (let i = 0; i < 2048; i += 1) {
  const g = run(h2, 0.01, 0.01, 0, 0, -32, -44, 0, 0, 1, -80, sr, 1);
  expectLt(g.gain, 0.02, "sub-open stays closed");
}
destroy(h2);

// Close > Open on the slider still closes at Open (clamp Close to Open).
const h3 = create() | 0;
if (!h3) throw new Error("noise gate create 3 failed");
for (let i = 0; i < 32; i += 1) {
  run(h3, 0.5, 0.5, 0, 0, -32, 0, 0, 0, 1, -80, sr, 1);
}
expect(gainOut(h3), 1, "clamp open", 1e-5);
// 0.1 is above Open (-20 dB vs -32). Unclamped Close=0 dB would start closing.
let stayed = null;
for (let i = 0; i < 256; i += 1) {
  stayed = run(h3, 0.1, 0.1, 0, 0, -32, 0, 0, 0, 1, -80, sr, 1);
}
expect(stayed.gain, 1, "clamp stay open above Open", 1e-5);
// Drop just below Open: clamped Close==Open so it starts closing.
let closing = null;
for (let i = 0; i < 256; i += 1) {
  closing = run(h3, 0.02, 0.02, 0, 0, -32, 0, 0, 0, 1, -80, sr, 1);
}
expectLt(closing.gain, 0.5, "clamp close below Open");
destroy(h3);

if ((version() | 0) < 1) throw new Error(`noise_gate version ${version()}`);
if ((graphVersion() | 0) < 276) throw new Error(`graph version ${graphVersion()} expected >= 276`);

console.log(`smoke_graph_noise_gate ok: noise_gate=${version() | 0} graph=${graphVersion() | 0}`);
