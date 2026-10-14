// Sabrina Tap Mod switch (delayTapMod, graph slot kParamMode):
//  Off: the 2 main (non-diffuse) delay taps hold a fixed length (LFO depth 0 on
//       just those two); the LFO keeps running and the 12 diffusion allpasses
//       keep modulating.
//  On (default): bit-identical to Walter's original (the HEAD build), when
//       that build is available via git.
// Run: node scripts/smoke_sabrina_tap_mod.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rel = "native_modules/sabrina_reverb/sabrina_reverb.wasm";
const load = async (bytes) => (await WebAssembly.instantiate(bytes, {})).instance.exports;
const cur = await load(fs.readFileSync(path.join(root, rel)));

const sr = 44100, frames = 128, blocks = Math.ceil((sr * 2) / frames);

function render(e, { delayTapMod = 1, modAmp = 0.3, lfoStyle = 0, flipAt = -1, flipTo = 0 } = {}) {
  const h = e.soemdsp_sabrina_reverb_create(sr);
  if (!h) throw new Error("create failed");
  const set = (m) => e.soemdsp_sabrina_reverb_set_params(h, 1.0, 0.35, 0.7, 0.08, 0.85, modAmp, 0.83, 0.001, 0, lfoStyle, m);
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
  for (const v of off) if (!Number.isFinite(v)) { fail(`${name}: non-finite output`); break; }
}

let headBytes = null;
try { headBytes = execFileSync("git", ["show", `HEAD:${rel}`], { cwd: root, maxBuffer: 1 << 26 }); } catch { /* no git */ }
if (headBytes && headBytes.length) {
  const head = await load(headBytes);
  for (const [name, style] of [["parabol", 0], ["fbm", 1]]) {
    const d = maxDiff(render(cur, { delayTapMod: 1, lfoStyle: style }), render(head, { lfoStyle: style }));
    console.log(name, { onVsHeadOriginal: d });
    if (d !== 0) fail(`${name}: Tap Mod On differs from the original (HEAD) build`);
  }
} else {
  console.log("skip: HEAD build not available, On-vs-original check skipped");
}

if (failed) process.exit(1);
console.log("ok: sabrina Tap Mod switch -- Off holds the main taps, diffusion still modulates, On unchanged");
