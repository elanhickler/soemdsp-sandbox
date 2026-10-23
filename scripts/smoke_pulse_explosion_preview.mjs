// Pulse Explosion XY: preview schedule matches playback, Seed-deterministic,
// times inside [Start, End], Left/Right park at the pivot then jump to sparks,
// Mono = (L+R)/2.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const N = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), imp)).instance.exports;
const SR = 48000;
if (N.soemdsp_pulse_explosion_version() < 5) throw new Error(`pulse_explosion version ${N.soemdsp_pulse_explosion_version()} < 5`);
// start, center, end, timeSpread, count, spread, x0, y0, seed
const SETS = [
  [0, 0.5, 1, 0.3, 20, 0.5, 0, 0, 0],
  [0.1, 0.2, 0.9, 0.05, 64, 0.8, 0.2, -0.1, 12345],
  [0, 0.05, 0.3, 1, 128, 1, 0, 0, 777],
  [0.25, 0.25, 0.25, 0.5, 1, 0, 0.3, -0.4, 9],
];
const preview = (set) => {
  const n = N.soemdsp_pulse_explosion_preview(...set);
  return {
    times: Array.from({ length: n }, (_, i) => N.soemdsp_pulse_explosion_preview_time(i)),
    xs: Array.from({ length: n }, (_, i) => N.soemdsp_pulse_explosion_preview_x(i)),
    ys: Array.from({ length: n }, (_, i) => N.soemdsp_pulse_explosion_preview_y(i)),
  };
};
const hold = 0;
for (const [k, set] of SETS.entries()) {
  const { times, xs, ys } = preview(set);
  if (times.length !== Math.max(1, Math.min(128, set[4]))) throw new Error(`set ${k}: count ${times.length}`);
  const s0 = Math.max(0, set[0]); const e0 = set[2] > s0 ? set[2] : s0 + 0.001;
  if (times.some((t, i) => t < s0 || t > e0 || (i && t < times[i - 1]))) throw new Error(`set ${k}: times outside [Start, End] or unsorted`);
  if (JSON.stringify(preview(set)) !== JSON.stringify({ times, xs, ys })) throw new Error(`set ${k}: same Seed, different schedule`);
  const spread = set[5];
  const x0 = set[6];
  const y0 = set[7];
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - x0;
    const dy = ys[i] - y0;
    const r = Math.hypot(dx, dy);
    if (r > spread + 1e-9) throw new Error(`set ${k}: spark ${i} r=${r} > spread ${spread}`);
  }
  const expect = new Map();
  let e = 0, j = 0;
  for (let i = 0; i < SR * 2 && j < times.length; i++) {
    if (e >= times[j]) { expect.set(i, [xs[j], ys[j]]); j++; }
    e += 1 / SR;
  }
  const h = N.soemdsp_pulse_explosion_create();
  const play = (trig) => N.soemdsp_pulse_explosion_sample(
    h, trig, set[0], set[1], set[2], set[3], set[4], set[5], set[6], set[7], hold, set[8], SR
  );
  for (let i = 0; i < SR * 2; i++) {
    const mono = play(i < 3 ? 1 : 0);
    const L = N.soemdsp_pulse_explosion_left(h);
    const R = N.soemdsp_pulse_explosion_right(h);
    if (Math.abs(mono - 0.5 * (L + R)) > 1e-12) throw new Error(`set ${k}: sample ${i} mono ${mono} != (L+R)/2`);
    const xy = expect.get(i);
    if (xy) {
      if (L !== xy[0] || R !== xy[1]) throw new Error(`set ${k}: sample ${i} L/R ${L},${R} preview ${xy}`);
    }
  }
  N.soemdsp_pulse_explosion_destroy(h);
}
const a = preview(SETS[0]).times, b = preview([...SETS[0].slice(0, 8), 1]).times;
if (JSON.stringify(a) === JSON.stringify(b)) throw new Error("Seed 0 and Seed 1 gave the same schedule");
{
  const set = [0, 0.05, 0.2, 0, 4, 0.6, 0.1, -0.2, 3];
  const h = N.soemdsp_pulse_explosion_create();
  const L0 = N.soemdsp_pulse_explosion_sample(h, 0, set[0], set[1], set[2], set[3], set[4], set[5], set[6], set[7], 0.01, set[8], SR);
  if (Math.abs(N.soemdsp_pulse_explosion_left(h) - 0.1) > 1e-12 || Math.abs(N.soemdsp_pulse_explosion_right(h) + 0.2) > 1e-12) {
    throw new Error("idle parks at x0/y0");
  }
  void L0;
  N.soemdsp_pulse_explosion_destroy(h);
}
console.log(`ok pulseExplosion XY preview == played sparks (${SETS.length} sets), Seed-deterministic, disk around pivot, Mono=(L+R)/2`);
