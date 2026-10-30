// Sabrina Tap Mod slider (delayTapMod 0..2, graph slot kParamMode): multiplies
// the LFO depth on the 2 main (non-diffuse) delay taps.
//  0: those taps hold a fixed length; the LFO keeps running and the 12
//     diffusion allpasses keep modulating.
//  1 (default): bit-identical to Walter's original (the HEAD build), when
//     that build is available via git.
//  2: double depth -- differs from 1, and 0.5 sits between 0 and 1.
// Run: node scripts/smoke_sabrina_tap_mod.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rel = "native_modules/sabrina_reverb/sabrina_reverb.wasm";
const load = async (bytes) => (await WebAssembly.instantiate(bytes, { env: { emo_process_block: () => 0 } })).instance.exports;
const cur = await load(fs.readFileSync(path.join(root, rel)));

// Same LFO settings as the old 0.83 / 0.001 knobs, in the current mappings
// (Speed: period = 2 * 0.025^v; Vary: spread = v * 0.25).
const CUR_SPEED = Math.log((((1 - 0.83) * 1.95 + 0.5) * 0.5) / 2) / Math.log(0.025);
// Cinematic Reverb (variant 0) takes real units: ms / depth fraction / Hz / ms.
const units = (ds, dl, amp, speed, vary) => [ds * 400, dl * 400, amp * 0.4, 0.5 * Math.pow(40, speed), vary * 250];
const sr = 44100, frames = 128, blocks = Math.ceil((sr * 2) / frames);

function render(e, { delayTapMod = 1, modAmp = 0.3, lfoStyle = 0, flipAt = -1, flipTo = 0, speed = CUR_SPEED, vary = 0.999, normalized = false } = {}) {
  const h = e.soemdsp_sabrina_reverb_create(sr);
  if (!h) throw new Error("create failed");
  const [ds, dl, amp, sp, va] = normalized ? [0.35, 0.08, modAmp, speed, vary] : units(0.35, 0.08, modAmp, speed, vary);
  const set = (m) => e.soemdsp_sabrina_reverb_set_params(h, 1.0, ds, 0.7, dl, 0.85, amp, sp, va, 0, lfoStyle, m);
  set(delayTapMod);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5;
  const out = new Float64Array(blocks * frames * 2);
  for (let b = 0; b < blocks; b += 1) {
    if (b === flipAt) set(flipTo);
    const mem = e.memory.buffer;
    const inL = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_input_left_ptr(h), frames);
    const inR = new Float64Array(mem, e.soemdsp_sabrina_reverb_block_input_right_ptr(h), frames);
    const burst = b < blocks / 4;
    for (let i = 0; i < frames; i += 1) { inL[i] = burst ? rnd() : 0; inR[i] = burst ? rnd() : 0; }
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

let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };

for (const [name, style] of [["parabol", 0], ["fbm", 1]]) {
  const on = render(cur, { delayTapMod: 1, lfoStyle: style });
  const off = render(cur, { delayTapMod: 0, lfoStyle: style });
  const onNoMod = render(cur, { delayTapMod: 1, modAmp: 0, lfoStyle: style });
  const offNoMod = render(cur, { delayTapMod: 0, modAmp: 0, lfoStyle: style });
  const flipped = render(cur, { delayTapMod: 1, lfoStyle: style, flipAt: Math.floor(blocks / 2) });
  const r = { onVsOff: maxDiff(on, off), noModOnVsOff: maxDiff(onNoMod, offNoMod), offVsOffNoMod: maxDiff(off, offNoMod), flipVsOn: maxDiff(flipped, on) };
  console.log(name, r);
  if (!(r.onVsOff > 1e-4)) fail(`${name}: On and Off sound the same`);
  if (!(r.offVsOffNoMod > 1e-4)) fail(`${name}: Off froze the diffusion modulation too`);
  if (!(r.flipVsOn > 1e-4)) fail(`${name}: switching Off mid-play did not take effect`);
  const dbl = render(cur, { delayTapMod: 2, lfoStyle: style });
  const half = render(cur, { delayTapMod: 0.5, lfoStyle: style });
  const r2 = { dblVsOn: maxDiff(dbl, on), halfVsOn: maxDiff(half, on), halfVsOff: maxDiff(half, off) };
  console.log(name, r2);
  if (!(r2.dblVsOn > 1e-4)) fail(`${name}: Tap Mod 2 sounds the same as 1`);
  if (!(r2.halfVsOn > 1e-4 && r2.halfVsOff > 1e-4)) fail(`${name}: Tap Mod 0.5 equals 0 or 1`);
  for (const v of dbl) if (!Number.isFinite(v)) { fail(`${name}: non-finite output at Tap Mod 2`); break; }
  for (const v of off) if (!Number.isFinite(v)) { fail(`${name}: non-finite output`); break; }
}

let headBytes = null;
try { headBytes = execFileSync("git", ["show", `HEAD:${rel}`], { cwd: root, maxBuffer: 1 << 26 }); } catch { /* no git */ }
if (headBytes && headBytes.length) {
  const head = await load(headBytes);
  // HEAD may predate the Speed/Vary remap; if so feed it the old knob values.
  const headSrc = execFileSync("git", ["show", "HEAD:native_modules/sabrina_reverb/sabrina_reverb.cpp"], { cwd: root }).toString();
  const oldMap = headSrc.includes("(1.0 - state.smoothedLfoVariation)");
  const headUnits = headSrc.includes("applyCinematicGeometry");
  const HEAD_SPEED = oldMap ? 0.83 : CUR_SPEED, HEAD_VARY = oldMap ? 0.001 : 0.999;
  for (const [name, style] of [["parabol", 0], ["fbm", 1]]) {
    const d = maxDiff(render(cur, { delayTapMod: 1, lfoStyle: style }), render(head, { lfoStyle: style, speed: HEAD_SPEED, vary: HEAD_VARY, normalized: !headUnits }));
    console.log(name, { onVsHeadOriginal: d });
    // Same map as HEAD -> must be bit-exact (d === 0). Only a pre-remap HEAD is not bit-exact: the period goes through dsp_exp, and a tiny period error
    // drifts the LFO phase over 2 s, so allow a small diff (On vs Off is ~0.6).
    // Same units as HEAD -> bit-exact. Normalized HEAD (pre real-units) -> rounding only
    // (1/Hz vs 2*dsp_exp period, ms/400 vs knob), so a small LFO-phase drift is allowed.
    if (!(oldMap ? d < 0.1 : headUnits ? d === 0 : d < 1e-3)) fail(`${name}: Tap Mod 1 differs from the original (HEAD) build`);
  }
} else {
  console.log("skip: HEAD build not available, On-vs-original check skipped");
}

if (failed) process.exit(1);
console.log("ok: sabrina Tap Mod slider -- 0 holds the main taps, diffusion still modulates, 1 unchanged, 2 deeper");
