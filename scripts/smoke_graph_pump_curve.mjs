// Pump Curve: trigger duck — gain falls then returns; inf ratio deeper than 2:1; Env = 1-Gain.
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

const create = must("soemdsp_pump_curve_create");
const destroy = must("soemdsp_pump_curve_destroy");
const sample = must("soemdsp_pump_curve_sample");
const right = must("soemdsp_pump_curve_right");
const gain = must("soemdsp_pump_curve_gain");
const env = must("soemdsp_pump_curve_env");
const version = must("soemdsp_pump_curve_version");
must("soemdsp_graph_version");

if ((version() | 0) < 1) throw new Error(`pump curve version ${version()}`);

const sr = 48000;
const h = create() | 0;
if (!h) throw new Error("pump curve create failed");

function tick(trig, law, ratio, depth, att, hold, rel, knee, makeup, mix, mode) {
  const y = sample(h, 1, 0.5, trig, sr, law, ratio, depth, att, hold, rel, knee, makeup, mix, mode);
  return { y, r: right(h), g: gain(h), e: env(h) };
}

// Rest: unity gain, Env 0, audio thru (mix 1, makeup 0).
const rest = tick(0, 0, 8, 12, 5, 0, 250, 0, 0, 1, 0);
if (Math.abs(rest.g - 1) > 1e-9) throw new Error(`rest gain ${rest.g}`);
if (Math.abs(rest.e) > 1e-9) throw new Error(`rest env ${rest.e}`);
if (Math.abs(rest.y - 1) > 1e-9) throw new Error(`rest out ${rest.y}`);

function runDuck(ratio) {
  const hh = create() | 0;
  if (!hh) throw new Error("create failed");
  const gs = [];
  sample(hh, 1, 1, 0, sr, 0, ratio, 12, 0, 0, 5, 0, 0, 1, 0);
  sample(hh, 1, 1, 1, sr, 0, ratio, 12, 0, 0, 5, 0, 0, 1, 0);
  let minG = 1;
  for (let i = 0; i < 64; i += 1) {
    sample(hh, 1, 1, 0, sr, 0, ratio, 12, 0, 0, 5, 0, 0, 1, 0);
    const g = gain(hh);
    const en = env(hh);
    if (Math.abs(en - (1 - g)) > 1e-9) throw new Error(`Env != 1-Gain ${en} ${g}`);
    if (g < minG) minG = g;
    gs.push(g);
  }
  for (let i = 0; i < Math.floor(sr * 0.3); i += 1) {
    sample(hh, 1, 1, 0, sr, 0, ratio, 12, 0, 0, 5, 0, 0, 1, 0);
  }
  const recovered = gain(hh);
  destroy(hh);
  return { minG, recovered, first: gs[0] };
}

const r2 = runDuck(2);
const rInf = runDuck(20);
if (!(r2.minG < 0.999)) throw new Error(`2:1 did not dip, minG=${r2.minG}`);
if (!(rInf.minG < r2.minG - 0.01)) {
  throw new Error(`inf should dip deeper than 2:1 (${rInf.minG} vs ${r2.minG})`);
}
if (!(r2.recovered > 0.99) || !(rInf.recovered > 0.99)) {
  throw new Error(`gain should recover, 2:1=${r2.recovered} inf=${rInf.recovered}`);
}

destroy(h);
console.log(
  `pump-curve ok 2:1 min=${r2.minG.toFixed(4)} inf min=${rInf.minG.toFixed(4)} recovered=${r2.recovered.toFixed(4)}`,
);
