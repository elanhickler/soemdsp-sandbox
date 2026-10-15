// Frozen Sabrina Reverb (graph type sabrinaReverbOriginal = native speed variant 1)
// must reproduce Walter's mapping exactly: at Walter defaults it is compared to the
// frozen reference build at commit 8854809a (Walter Speed map, old inverted Vary;
// old Vary 0.001 == new Vary 0.999). Also checks the variant defaults (no set_params)
// and that the dev variant (0) differs at the same knob value (it uses the wide map).
// Run: node scripts/smoke_sabrina_original.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rel = "native_modules/sabrina_reverb/sabrina_reverb.wasm";
const REF_COMMIT = "8854809a";
const load = async (bytes) => (await WebAssembly.instantiate(bytes, {})).instance.exports;
const cur = await load(fs.readFileSync(path.join(root, rel)));
const sr = 44100, frames = 128, blocks = Math.ceil((sr * 3) / frames);
let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };
if (typeof cur.soemdsp_sabrina_reverb_set_variant !== "function") { console.error("FAIL: set_variant export missing"); process.exit(1); }

function render(e, { variant = -1, params = null } = {}) {
  const h = e.soemdsp_sabrina_reverb_create(sr);
  if (!h) throw new Error("create failed");
  if (variant >= 0) e.soemdsp_sabrina_reverb_set_variant(h, variant);
  if (params) e.soemdsp_sabrina_reverb_set_params(h, ...params);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5;
  const out = new Float64Array(blocks * frames * 2);
  for (let b = 0; b < blocks; b += 1) {
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

// Walter defaults; Mod(~)Amp raised in a second case so modulation is clearly audible.
const walter = (amp, style, varyNew) => [0.43, 0.35, 0.7, 0.02, 0.7, amp, 0.83, varyNew, 0, style, 1];
let ref = null;
try { ref = await load(execFileSync("git", ["show", `${REF_COMMIT}:${rel}`], { cwd: root, maxBuffer: 1 << 26 })); } catch { /* no git */ }

for (const [name, style] of [["parabol", 0], ["fbm", 1]]) {
  for (const amp of [0.07, 0.4]) {
    const orig = render(cur, { variant: 1, params: walter(amp, style, 0.999) });
    const dev = render(cur, { variant: 0, params: walter(amp, style, 0.999) });
    const r = { origVsDevSameKnob: maxDiff(orig, dev) };
    if (amp === 0.07 && style === 0) r.origDefaultsVsExplicit = maxDiff(render(cur, { variant: 1 }), orig);
    if (ref) r.origVsWalterRef = maxDiff(orig, render(ref, { params: walter(amp, style, 0.001) }));
    console.log(name, `amp ${amp}`, r);
    if (!(r.origVsDevSameKnob > 1e-4)) fail(`${name}/${amp}: Original and dev sound the same at Speed 0.83`);
    if ("origDefaultsVsExplicit" in r && r.origDefaultsVsExplicit !== 0) fail("Original variant defaults are not Walter's");
    // 1 - 0.001 vs 0.999 may differ by 1 ulp in the Vary spread -> allow round-off only.
    if (ref && !(r.origVsWalterRef < 1e-9)) fail(`${name}/${amp}: Original differs from Walter reference ${REF_COMMIT}`);
  }
}
if (!ref) console.log(`skip: reference build ${REF_COMMIT} not available`);
if (failed) process.exit(1);
console.log("smoke_sabrina_original OK");
