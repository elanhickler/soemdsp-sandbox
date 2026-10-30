// Cinematic Reverb (reverbEffect, native variant 0) real-unit params:
// diffusionSize ms, delaySize ms, lfoAmplitude depth fraction, lfoBaseSpeed Hz, lfoVariation ms.
// 1) Defaults and a converted patch setting sound the same as the normalized
//    build at REF_COMMIT (old knob v: ms = 400 v, depth = 0.4 v, Hz = 0.5 * 40^v, vary = 250 v ms).
// 2) Recycle / Diffusion Amount above 1 behave exactly like 1 (the only param caps).
// 3) Out-of-range delay times (no param clamps) stay finite: buffer sanity cap only.
// Run: node scripts/smoke_cinematic_units.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rel = "native_modules/sabrina_reverb/sabrina_reverb.wasm";
const REF_COMMIT = "c4f6a9f8";
const load = async (bytes) => (await WebAssembly.instantiate(bytes, { env: { emo_process_block: () => 0 } })).instance.exports;
const cur = await load(fs.readFileSync(path.join(root, rel)));
const sr = 44100, frames = 128, blocks = Math.ceil((sr * 3) / frames);
let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };

function render(e, params = null) {
  const h = e.soemdsp_sabrina_reverb_create(sr);
  if (params) e.soemdsp_sabrina_reverb_set_params(h, ...params);
  let seed = 777;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5;
  const out = new Float64Array(blocks * frames * 2);
  for (let b = 0; b < blocks; b += 1) {
    const mem = e.memory.buffer;
    const inL = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_input_left_ptr(h), frames);
    const inR = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_input_right_ptr(h), frames);
    for (let i = 0; i < frames; i += 1) { const v = b < blocks / 4 ? rnd() : 0; inL[i] = v; inR[i] = -v; }
    // Reset on frame 0 snaps the param smoothing to its targets, so the test
    // compares the settled mapping, not the (unit-dependent) glide from defaults.
    const rb = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_reset_ptr(h), frames);
    for (let i = 0; i < frames; i += 1) rb[i] = b === 0 ? 1 : 0;
    e.soemdsp_sabrina_reverb_process_block(h, frames, 1);
    const m2 = e.memory.buffer;
    const oL = new Float64Array(m2, e.soemdsp_sabrina_reverb_block_output_left_ptr(h), frames);
    const oR = new Float64Array(m2, e.soemdsp_sabrina_reverb_block_output_right_ptr(h), frames);
    for (let i = 0; i < frames; i += 1) { out[(b * frames + i) * 2] = oL[i]; out[(b * frames + i) * 2 + 1] = oR[i]; }
  }
  e.soemdsp_sabrina_reverb_destroy(h);
  return out;
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 1) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const peak = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };
const toUnits = ([mix, ds, da, dl, rc, amp, sp, va, sd, st, tm]) => [mix, ds * 400, da, dl * 400, rc, amp * 0.4, 0.5 * Math.pow(40, sp), va * 250, sd, st, tm];

let ref = null;
try { ref = await load(execFileSync("git", ["show", `${REF_COMMIT}:${rel}`], { cwd: root, maxBuffer: 1 << 26 })); } catch { /* no git */ }
if (ref) {
  const r = { defaults: maxDiff(render(cur), render(ref)) };
  // patches/reverb.json's old knob values, both Mod styles.
  for (const st of [0, 1]) {
    const knobs = [0.570542657373128, 0.354453983984381, 0.506523279753873, 0.509366525183971, 0.451121023837684, 0.0947911043291925, 0.211473635570263, 0.761264685331553, 52147, st, 1];
    r[`patchStyle${st}`] = maxDiff(render(cur, toUnits(knobs)), render(ref, knobs));
  }
  console.log("vs normalized build", REF_COMMIT, r);
  // Rounding only (1/Hz vs 2*dsp_exp period, ms*0.001 vs knob*0.1*4): tiny LFO-phase drift over 3 s.
  for (const [k, v] of Object.entries(r)) if (!(v < 1e-3)) fail(`${k}: Cinematic units differ from the old knobs (${v})`);
} else {
  console.log(`skip: reference build ${REF_COMMIT} not available`);
}
const base = [1, 140, 0.7, 32, 0.85, 0.12, 2.40684, 249.75, 3, 0, 1];
const withAt = (i, v) => { const p = base.slice(); p[i] = v; return p; };
const capRecycle = maxDiff(render(cur, withAt(4, 1.7)), render(cur, withAt(4, 1)));
const capDiff = maxDiff(render(cur, withAt(2, 3)), render(cur, withAt(2, 1)));
console.log({ capRecycle, capDiff });
if (capRecycle !== 0) fail("Recycle > 1 not capped at 1");
if (capDiff !== 0) fail("Diffusion Amount > 1 not capped at 1");
const huge = render(cur, withAt(3, 60000)); // 60 s main taps, far past the buffer
const hugeDiff = render(cur, withAt(1, 60000));
const fast = render(cur, withAt(6, 400)); // 400 Hz LFO, above the slider range
for (const [n, a] of [["huge delay", huge], ["huge diffusion", hugeDiff], ["fast LFO", fast]]) {
  if (![...a].every(Number.isFinite)) fail(`${n}: non-finite output`);
  console.log(n, { peak: peak(a) });
}
if (failed) process.exit(1);
console.log("smoke_cinematic_units OK");
