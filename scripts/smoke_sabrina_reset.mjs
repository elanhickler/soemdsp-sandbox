// Sabrina Reset jack: a rising edge (> 0.5) on blockReset puts every delay
// line's LFO phase (modInc), period (modSpeed), offset and depth back to a
// fresh instance's values for the same params/seed, without clearing tails.
// Run: node scripts/smoke_sabrina_reset.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const e = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules/sabrina_reverb/sabrina_reverb.wasm")), { env: { emo_process_block: () => 0 } })).instance.exports;
const sr = 44100, frames = 128, N = 14;
// Defaults (so a fresh instance has no smoothing glide), with seed 7.
// Cinematic Reverb units: ms, ms, depth fraction, Hz, ms (Cinematic defaults).
const P = { mix: 0.43, dSize: 140, dAmt: 0.7, delay: 8, recycle: 0.7, amp: 0.028, speed: 2.40684, vary: 249.75, seed: 7, style: 0, tap: 1 };
let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };
const set = (h, o = {}) => { const p = { ...P, ...o }; e.soemdsp_sabrina_reverb_set_params(h, p.mix, p.dSize, p.dAmt, p.delay, p.recycle, p.amp, p.speed, p.vary, p.seed, p.style, p.tap); };
let rs = 99;
const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5;
function block(h, input, reset) {
  const mem = e.memory.buffer;
  const inL = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_input_left_ptr(h), frames);
  const inR = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_input_right_ptr(h), frames);
  const rb = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_reset_ptr(h), frames);
  for (let i = 0; i < frames; i += 1) { inL[i] = input(i); inR[i] = input(i); rb[i] = reset(i); }
  e.soemdsp_sabrina_reverb_process_block(h, frames, 1);
  const m2 = e.memory.buffer;
  return [new Float64Array(m2, e.soemdsp_sabrina_reverb_block_output_left_ptr(h), frames).slice(), new Float64Array(m2, e.soemdsp_sabrina_reverb_block_output_right_ptr(h), frames).slice()];
}
const snap = (h) => { const s = []; for (let i = 0; i < N; i += 1) for (let f = 0; f < 4; f += 1) s.push(e.soemdsp_sabrina_reverb_debug_mod(h, i, f)); return s; };
const maxRel = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 1) m = Math.max(m, Math.abs(a[i] - b[i]) / Math.max(1e-12, Math.abs(b[i]))); return m; };

for (const [name, style] of [["parabol", 0], ["fbm", 1]]) {
  const one = () => 0.1;
  // A: play 3 s with modulation, wander the geometry and Tap Mod, then come back.
  const a = e.soemdsp_sabrina_reverb_create(sr);
  set(a, { style });
  const blocks = Math.ceil((sr * 3) / frames);
  for (let b = 0; b < blocks; b += 1) {
    if (b === 200) set(a, { style, delay: 120, amp: 0.24, speed: 13.8, vary: 50, dSize: 320, tap: 2 });
    if (b === blocks - 3) set(a, { style }); // back to targets; smoothing still mid-glide
    block(a, (b < blocks / 3) ? rnd : () => 0, () => 0);
  }
  const drifted = snap(a);
  // Fire Reset on frame 0 (rising edge, then held high all block -> one edge only).
  const outA = block(a, one, () => 1);
  const afterA = snap(a);
  // B: fresh instance, same params, same post-reset input, no reset.
  const fresh = e.soemdsp_sabrina_reverb_create(sr);
  set(fresh, { style });
  const outB = block(fresh, one, () => 0);
  const afterB = snap(fresh);
  const r = { driftBefore: maxRel(drifted, afterB), afterReset: maxRel(afterA, afterB) };
  // Tails kept: A's output still carries reverb that B (fresh) doesn't have.
  let tail = 0; for (let i = 0; i < frames; i += 1) tail = Math.max(tail, Math.abs(outA[0][i] - outB[0][i]));
  r.tailDiff = tail;
  console.log(name, r);
  if (!(r.driftBefore > 1e-3)) fail(`${name}: modulation never drifted, test is meaningless`);
  if (!(r.afterReset < 1e-12)) fail(`${name}: after Reset modulation state != fresh instance`);
  if (!(r.tailDiff > 1e-6)) fail(`${name}: Reset seems to have cleared the tails`);
  // Held gate must not re-fire across the block boundary: still high, keeps advancing.
  block(a, one, () => 1);
  block(fresh, one, () => 0);
  const held = maxRel(snap(a), snap(fresh));
  if (!(held < 1e-12)) fail(`${name}: held-high Reset re-fired (${held})`);
  // New edge after a low fires again.
  block(a, one, (i) => (i < 5 ? 0 : 1));
  if (!(e.soemdsp_sabrina_reverb_debug_mod(a, 12, 0) < e.soemdsp_sabrina_reverb_debug_mod(fresh, 12, 0))) fail(`${name}: second edge did not reset`);
  e.soemdsp_sabrina_reverb_destroy(a);
  e.soemdsp_sabrina_reverb_destroy(fresh);
}
if (failed) process.exit(1);
console.log("smoke_sabrina_reset OK");
