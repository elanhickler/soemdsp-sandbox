// Headless: Robin Sinepulse face preview + elapsed + field pack (robin_sinepulse v14).
// Uses the standalone robin_sinepulse.wasm (no imports).
// 1) Preview window crops a long Decay to the kick body (sweep land vs env −24 dB).
// 2) preview_min/max are connected per-column bands; the sweep start fills ~-A..A (no aliasing).
// 3) Elapsed is −1 before the first Trigger, then seconds since the newest hit.
// 4) preview_field window is T60-to-1e-6 * 1.12 (amp 1, decay 0.5 → 1.12 s).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "robin_sinepulse", "robin_sinepulse.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const ver = e.soemdsp_robin_sinepulse_version();
if (ver < 14) throw new Error(`robin_sinepulse version ${ver} < 14`);
for (const name of [
  "soemdsp_robin_sinepulse_preview",
  "soemdsp_robin_sinepulse_preview_min",
  "soemdsp_robin_sinepulse_preview_max",
  "soemdsp_robin_sinepulse_preview_window",
  "soemdsp_robin_sinepulse_preview_field",
  "soemdsp_robin_sinepulse_preview_field_at",
  "soemdsp_robin_sinepulse_elapsed",
]) {
  if (typeof e[name] !== "function") throw new Error(`missing export ${name}`);
}

const SR = 48000;
function preview(p, cols = 240) {
  const n = e.soemdsp_robin_sinepulse_preview(
    p.hi, p.lo, p.sweep, p.chirp ?? 0, p.shape ?? 0,
    p.wave ?? 0, p.ws ?? 0, p.phase ?? 0, p.decay, p.amp ?? 1, SR, cols,
  ) | 0;
  const window = e.soemdsp_robin_sinepulse_preview_window();
  const ys = [];
  let peak = 0;
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.5 * (e.soemdsp_robin_sinepulse_preview_min(i) + e.soemdsp_robin_sinepulse_preview_max(i));
    ys.push(y);
    peak = Math.max(peak, Math.abs(y));
    if (i > 0 && ys[i - 1] <= 0 && y > 0) crossings += 1;
  }
  return { n, window, peak, crossings, ys };
}

{
  const def = preview({ hi: 10000, lo: 0, sweep: 0.2, decay: 0.5 });
  if (def.n < 2) throw new Error(`preview columns ${def.n}`);
  if (!(def.window > 0.05 && def.window < 0.5)) throw new Error(`default window ${def.window}s, expected ~0.22s kick body`);
  if (!(def.peak > 0.2)) throw new Error(`default preview too quiet ${def.peak}`);
  for (let i = 0; i < 4; i++) {
    const lo = e.soemdsp_robin_sinepulse_preview_min(i);
    const hi = e.soemdsp_robin_sinepulse_preview_max(i);
    if (!(lo < -0.8 && hi > 0.8)) throw new Error(`sweep-start column ${i} band ${lo}..${hi} should fill ~-1..1`);
  }
}

{
  const longDecay = preview({ hi: 10000, lo: 0, sweep: 0.2, decay: 4 });
  if (!(longDecay.window < 0.5)) throw new Error(`long Decay still filled the face (${longDecay.window}s)`);
  if (!(longDecay.window < 4 * 0.2)) throw new Error(`long Decay window ${longDecay.window} should crop vs 4s T60`);
}

{
  const shortEnv = preview({ hi: 10000, lo: 200, sweep: 0.4, decay: 0.05 });
  // tEnv = 0.05 * 24/60 = 0.02; sweep land ~0.4; floor 3/200 = 0.015; pad 12%.
  if (!(shortEnv.window < 0.08)) throw new Error(`short Decay should win the crop (${shortEnv.window}s)`);
  if (!(shortEnv.window >= 0.008)) throw new Error(`window below 8 ms floor (${shortEnv.window})`);
}

{
  const a = preview({ hi: 10000, lo: 40, sweep: 0.1, decay: 0.4, wave: 0, phase: 0 });
  const b = preview({ hi: 10000, lo: 40, sweep: 0.1, decay: 0.4, wave: 2, ws: 0.8, phase: 0 });
  let diff = 0;
  for (let i = 0; i < Math.min(a.n, b.n); i++) diff = Math.max(diff, Math.abs(a.ys[i] - b.ys[i]));
  if (!(diff > 0.05)) throw new Error(`TriSaw preview matched Sine (${diff})`);
  if (!(a.crossings >= 2)) throw new Error(`Sine path never crossed zero (${a.crossings})`);
}

{
  const h = e.soemdsp_robin_sinepulse_create();
  if (e.soemdsp_robin_sinepulse_elapsed(h) !== -1) throw new Error("elapsed before first Trigger should be -1");
  e.soemdsp_robin_sinepulse_sample(h, 1, 10000, 40, 0.05, 0, 0, 0, 0, 0, 0.5, 1, SR, 0, 1, 0);
  const e0 = e.soemdsp_robin_sinepulse_elapsed(h);
  if (!(e0 >= 0 && e0 < 2 / SR)) throw new Error(`elapsed on hit ${e0}`);
  for (let i = 0; i < 480; i++) {
    e.soemdsp_robin_sinepulse_sample(h, 0, 10000, 40, 0.05, 0, 0, 0, 0, 0, 0.5, 1, SR, 0, 1, 0);
  }
  const e1 = e.soemdsp_robin_sinepulse_elapsed(h);
  if (!(e1 > 0.008 && e1 < 0.02)) throw new Error(`elapsed after 480 samples ${e1}`);
  e.soemdsp_robin_sinepulse_destroy(h);
}

{
  const win = e.soemdsp_robin_sinepulse_preview_field(10000, 0, 0.2, 0, 0, 0.5, 1, SR);
  const expect = 0.5 * Math.log(1e6) / Math.log(1000) * 1.12;
  if (!(Math.abs(win - expect) < 1e-6)) throw new Error(`field window ${win} expected ${expect}`);
  if (!(e.soemdsp_robin_sinepulse_preview_field_at(10) === win)) throw new Error("field pack window slot");
  if (!(e.soemdsp_robin_sinepulse_preview_field_at(5) === 1)) throw new Error("powFree should be 1 at chirp=shape=0");
  const long = e.soemdsp_robin_sinepulse_preview_field(10000, 0, 0.2, 0, 0, 4, 1, SR);
  const longExpect = 4 * Math.log(1e6) / Math.log(1000) * 1.12;
  if (!(Math.abs(long - longExpect) < 1e-6)) throw new Error(`long Decay field window ${long} expected ${longExpect}`);
}

console.log("ok robinSinepulse preview window crops long Decay; elapsed tracks the newest hit; field pack T60 window");
