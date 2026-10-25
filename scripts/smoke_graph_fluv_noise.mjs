// Fluv Noise: stereo differ when Stereo On; silent below Start; audible at Full.
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

const create = must("soemdsp_fluv_noise_create");
const destroy = must("soemdsp_fluv_noise_destroy");
const setSeed = must("soemdsp_fluv_noise_set_seed");
const sample = must("soemdsp_fluv_noise_sample_stereo");
const left = must("soemdsp_fluv_noise_left");
const right = must("soemdsp_fluv_noise_right");
const version = must("soemdsp_fluv_noise_version");
must("soemdsp_graph_version");

if ((version() | 0) < 1) throw new Error(`fluv noise version ${version()}`);

const sr = 48000;
const h = create() | 0;
if (!h) throw new Error("fluv noise create failed");
setSeed(h, 1);

function tick(freq, start, full, amount, spread, hp, lp, stereo, amp) {
  sample(h, freq, sr, start, full, amount, spread, hp, lp, stereo, amp, 0, 0);
  return { l: left(h), r: right(h) };
}

function rms(n, freq, start, full, amount, spread, hp, lp, stereo, amp) {
  let accL = 0;
  let accR = 0;
  let diff = 0;
  for (let i = 0; i < n; i += 1) {
    const y = tick(freq, start, full, amount, spread, hp, lp, stereo, amp);
    accL += y.l * y.l;
    accR += y.r * y.r;
    diff += (y.l - y.r) * (y.l - y.r);
  }
  return { l: Math.sqrt(accL / n), r: Math.sqrt(accR / n), diff: Math.sqrt(diff / n) };
}

const silent = rms(2048, 200, 2000, 7000, 1, 4, 2, 2, 1, 1);
if (silent.l > 1e-6 || silent.r > 1e-6) {
  throw new Error(`below Start should be silent, rms L=${silent.l} R=${silent.r}`);
}

const full = rms(4096, 8000, 2000, 7000, 1, 4, 2, 2, 1, 1);
if (!(full.l > 0.01) || !(full.r > 0.01)) {
  throw new Error(`at Full should be audible, rms L=${full.l} R=${full.r}`);
}
if (!(full.diff > 0.001)) {
  throw new Error(`Stereo On should differ L/R, diff=${full.diff}`);
}

const mono = rms(2048, 8000, 2000, 7000, 1, 4, 2, 2, 0, 1);
if (mono.diff > 1e-12) {
  throw new Error(`Stereo Off should copy L to R, diff=${mono.diff}`);
}

destroy(h);
console.log(
  `fluv-noise ok silent=${silent.l.toExponential(2)} fullL=${full.l.toFixed(4)} stereoDiff=${full.diff.toFixed(4)}`,
);
