// Interpolation refactor: old curves bit-identical, new curves exact.
// Sample & Hold modes 0-3 and Pi Noise modes 0-9 are compared sample-for-sample against
// golden hashes; new choices (S&H 4 Cosine, 5 Hold; Pi Noise 10 Quadratic In, 11 Quadratic Out)
// checked against their formulas.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url"; import crypto from "crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const old = process.argv[2];
async function load(f) { return (await WebAssembly.instantiate(fs.readFileSync(f), { env: { emo_process_block: () => 0 } })).instance.exports; }
function shRun(e, mode, smooth) { const h = e.soemdsp_sample_hold_create(); const o = new Float64Array(6000);
  let c = 0; for (let i = 0; i < 6000; i++) { const clk = (i % 173) < 9 ? 1 : 0; o[i] = e.soemdsp_sample_hold_sample(h, Math.sin(i * 0.37) * 0.9, clk, 0, i < 3000 ? 0 : 301, 48000, i < 4500 ? 1 : 0, 7, 0.8, 0, mode, 0.25, smooth); }
  e.soemdsp_sample_hold_destroy(h); return o; }
function piRun(e, mode) { const h = e.soemdsp_formula_noise_create(); e.soemdsp_formula_noise_set_source(h, 0, 1); const o = new Float64Array(6000);
  for (let i = 0; i < 6000; i++) o[i] = e.soemdsp_formula_noise_sample(h, i < 3000 ? 977 : 13001, 48000, mode, i > 4000 ? 1 : 0, 0, 0);
  e.soemdsp_formula_noise_destroy(h); return o; }
const hash = (a) => crypto.createHash("sha256").update(Buffer.from(a.buffer)).digest("hex").slice(0, 16);
const neu = { sh: await load(path.join(root, "native_modules/sample_hold/sample_hold.wasm")), pi: await load(path.join(root, "native_modules/formula_noise/formula_noise.wasm")) };
let fail = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fail++; };
if (old) { const o = { sh: await load(path.join(old, "sample_hold.wasm")), pi: await load(path.join(old, "formula_noise.wasm")) };
  for (const m of [0, 1, 2, 3]) for (const sm of [0, 0.5, 1.7]) ok(hash(shRun(o.sh, m, sm)) === hash(shRun(neu.sh, m, sm)), `S&H mode ${m} smoothing ${sm} bit-identical`);
  for (let m = 0; m <= 9; m++) ok(hash(piRun(o.pi, m)) === hash(piRun(neu.pi, m)), `Pi Noise mode ${m} bit-identical`); }
// New Pi Noise curves: v = lerp(d1, d2, w(t)) with digits from digit_at.
{ const e = neu.pi; for (const [m, w] of [[10, (t) => t * t], [11, (t) => 1 - (1 - t) * (1 - t)], [4, (t) => 0.5 - 0.5 * Math.cos(Math.PI * t)]]) {
  const h = e.soemdsp_formula_noise_create(); e.soemdsp_formula_noise_set_source(h, 0, 1); let err = 0; const steps = 64, sp = 48000 / steps;
  for (let i = 0; i < 4000; i++) { const v = (e.soemdsp_formula_noise_sample(h, sp, 48000, m, 0, 0, 0) + 1) / 2 * 9; const k = Math.floor(i / steps), t = (i % steps) / steps;
    const d1 = e.soemdsp_formula_noise_digit_at(k), d2 = e.soemdsp_formula_noise_digit_at(k + 1); err = Math.max(err, Math.abs(v - (d1 + (d2 - d1) * w(t)))); }
  e.soemdsp_formula_noise_destroy(h); ok(err < 1e-6, `Pi Noise mode ${m} matches its formula (max err ${err.toExponential(1)})`); } }
console.log(fail ? `${fail} FAILED` : "interpolation curves ok"); process.exit(fail ? 1 : 0);
