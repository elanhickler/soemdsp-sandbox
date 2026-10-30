// Native clock v7: gate compares fractional phase, so Start 0 / End 1 never drops at non-integer periods.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "clock", "clock.wasm")), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
let fails = 0;
function gate(ok, msg) { if (!ok) { fails++; console.log("FAIL", msg); } }

gate(e.soemdsp_clock_version() >= 7, "clock version >= 7");
function run(rate, sr, start, end) {
  const h = e.soemdsp_clock_create();
  const n = rate > 0 ? Math.round(sr * Math.max(1, Math.ceil(rate)) / rate) : sr; // whole cycles
  let high = 0;
  for (let i = 0; i < n; i++) if (e.soemdsp_clock_sample(h, 0, 0, rate, start, end, 1, sr) > 0) high++;
  e.soemdsp_clock_destroy(h);
  return { high, n };
}
for (const sr of [44100, 48000, 96000]) {
  for (const rate of [74.2, 74.21, 33.3, 0.7, 1999.9, 441.7]) {
    const { high, n } = run(rate, sr, 0, 1);
    gate(high === n, `100% gate never low: ${rate} Hz @ ${sr} (${n - high} low)`);
    for (const w of [0.5, 0.25]) {
      const r = run(rate, sr, 0, w);
      gate(Math.abs(r.high / r.n - w) < 0.01 + 2 * rate / sr, `width ${w}: ${rate} Hz @ ${sr} duty ${(r.high / r.n).toFixed(4)}`);
    }
    const wrap = run(rate, sr, 0.75, 0.25);
    gate(Math.abs(wrap.high / wrap.n - 0.5) < 0.01 + 2 * rate / sr, `wrapped Start 0.75 / End 0.25: ${rate} Hz @ ${sr}`);
  }
}
gate(run(0, 48000, 0, 1).high === 0, "Rate 0 holds the gate low");
if (fails) { console.log(`smoke_clock_gate_fractional FAILED (${fails})`); process.exit(1); }
console.log("smoke_clock_gate_fractional ok");
