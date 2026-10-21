// Pulse Explosion (Random only): soemdsp_pulse_explosion_preview returns
// exactly the schedule a trigger plays, the same Seed gives the same schedule,
// a different Seed a different one, and times stay inside [Start, End].
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const N = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), imp)).instance.exports;
const SR = 48000;
// start, center, end, spread, count, lo, hi, seed
const SETS = [
  [0, 0.5, 1, 0.3, 20, 0.3, 1, 0],
  [0.1, 0.2, 0.9, 0.05, 64, 0, 1, 12345],
  [0, 0.05, 0.3, 1, 128, 0.5, 0.6, 777],
  [0.25, 0.25, 0.25, 0.5, 1, 1, 1, 9],
];
const preview = (set) => {
  const n = N.soemdsp_pulse_explosion_preview(...set);
  return { times: Array.from({ length: n }, (_, i) => N.soemdsp_pulse_explosion_preview_time(i)), amps: Array.from({ length: n }, (_, i) => N.soemdsp_pulse_explosion_preview_amplitude(i)) };
};
for (const [k, set] of SETS.entries()) {
  const { times, amps } = preview(set);
  if (times.length !== Math.max(1, Math.min(128, set[4]))) throw new Error(`set ${k}: count ${times.length}`);
  const s0 = Math.max(0, set[0]); const e0 = set[2] > s0 ? set[2] : s0 + 0.001;
  if (times.some((t, i) => t < s0 || t > e0 || (i && t < times[i - 1]))) throw new Error(`set ${k}: times outside [Start, End] or unsorted`);
  if (JSON.stringify(preview(set)) !== JSON.stringify({ times, amps })) throw new Error(`set ${k}: same Seed, different schedule`);
  // Engine timeline: pulse j fires on the first sample whose elapsed >= time (one per sample).
  const expect = new Map();
  let e = 0, j = 0;
  for (let i = 0; i < SR * 2 && j < times.length; i++) { if (e >= times[j]) { expect.set(i, amps[j]); j++; } e += 1 / SR; }
  const h = N.soemdsp_pulse_explosion_create();
  for (let i = 0; i < SR * 2; i++) {
    const v = N.soemdsp_pulse_explosion_sample(h, i < 3 ? 1 : 0, ...set, SR);
    const w = expect.get(i) || 0;
    if (v !== w) throw new Error(`set ${k}: sample ${i} out ${v}, preview ${w}`);
  }
  N.soemdsp_pulse_explosion_destroy(h);
}
const a = preview(SETS[0]).times, b = preview([...SETS[0].slice(0, 7), 1]).times;
if (JSON.stringify(a) === JSON.stringify(b)) throw new Error("Seed 0 and Seed 1 gave the same schedule");
console.log(`ok pulseExplosion preview == played schedule (${SETS.length} sets, 2 s each), Seed-deterministic, inside [Start, End]`);
