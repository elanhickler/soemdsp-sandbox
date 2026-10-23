// Headless: every percussion voice has an f out (Hz) and an Env out.
// Electro Kick / Snare / Tom / Hat / Clap, Modal Snare (Robin Sinepulse already
// had f + env). Checks, per module and algorithm, on the combined wasm:
//  - soemdsp_<m>_f exists; at rest (before a hit and after the hit dies) f is the
//    resting value (kick / tom / snare: Tune; hat: main filter centre; clap:
//    burst band-pass centre), Env is exactly 0.
//  - after a hit Env peaks > 0 and decays to exact 0; with Bend > 0 the body
//    f starts above Tune and falls back toward Tune.
//  - f never changes the audio: with OLD_COMBINED=<path to previous combined
//    wasm> the L / R / Env streams at defaults are bit-identical.
//  - static: definitions list "f" after Env (port ids stable), the worklet maps
//    "f" to the Saw port, graph_engine writes kPortSaw from soemdsp_<m>_f.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SR = 48000;
async function load(p) { return (await WebAssembly.instantiate(fs.readFileSync(p), { env: { emo_process_block: () => 0 } })).instance.exports; }
const E = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const OLD = process.env.OLD_COMBINED ? await load(process.env.OLD_COMBINED) : null;

const hatC = (alg, tune, tone) => {
  const sh = 2 ** (2 * tone - 1), nyq = 0.45 * SR;
  return Math.min([7100 * sh, 9000 * sh, 4000 * sh, 8000 * tune][alg], nyq);
};
const clapC = (alg, tone) => Math.min([1000, 1140, 1200][alg] * 2 ** (2 * tone - 1), 0.45 * SR);
// args(trigger, reset, alg, p) -> native arg list after handle
const MODS = [
  { m: "electro_kick", key: "electroKick", algs: 3, p: { tune: 52, bend: 1.5, bendTime: 0.005, decay: 0.6, click: 0.3, tone: 0.5, amplitude: 1 },
    args: (t, r, a, p) => [t, r, a, p.tune, p.bend, p.bendTime, p.decay, p.click, p.tone, p.amplitude, SR, 0], rest: (a, p) => p.tune, bends: true },
  { m: "electro_snare", key: "electroSnare", algs: [0, 1, 2, 4], p: { tune: 180, tone: 0.5, snappy: 0.5, bodyDecay: 0.25, snapDecay: 0.2, bend: 0, amplitude: 1, q: 2, click: 0.4 },
    args: (t, r, a, p) => [t, r, a, p.tune, p.tone, p.snappy, p.bodyDecay, p.snapDecay, p.bend, p.amplitude, p.q, p.click, SR, 0], rest: (a, p) => p.tune, bendKey: "bend" },
  { m: "modal_snare", key: "modalSnare", algs: [0], p: { tune: 180, tone: 0.5, snappy: 0.5, bodyDecay: 0.25, snapDecay: 0.2, bend: 0, amplitude: 1, nf: 3000, nq: 1, click: 0.3, cd: 2, tilt: 0, bn: 0 },
    args: (t, r, a, p) => [t, r, p.tune, p.tone, p.snappy, p.bodyDecay, p.snapDecay, p.bend, p.amplitude, p.nf, p.nq, p.click, p.cd, p.tilt, SR, 0, p.bn], rest: (a, p) => p.tune, bendKey: "bend" },
  { m: "electro_tom", key: "electroTom", algs: 3, p: { tune: 135, bend: 0.25, tone: 0.5, bodyDecay: 0.2, noise: 0.2, amplitude: 1 },
    args: (t, r, a, p) => [t, r, a, p.tune, p.bend, p.tone, p.bodyDecay, p.noise, p.amplitude, SR, 0], rest: (a, p) => p.tune, bends: true },
  { m: "electro_hat", key: "electroHat", algs: 4, p: { tune: 1, tone: 0.5, cd: 0.05, od: 0.5, metal: 1, amplitude: 1 },
    args: (t, r, a, p) => [t, 0, r, a, p.tune, p.tone, p.cd, p.od, p.metal, p.amplitude, SR, 0], rest: (a, p) => hatC(a, p.tune, p.tone) },
  { m: "electro_clap", key: "electroClap", algs: 3, p: { tone: 0.5, spread: 0.5, decay: 0.3, snappy: 0.6, amplitude: 1 },
    args: (t, r, a, p) => [t, r, a, p.tone, p.spread, p.decay, p.snappy, p.amplitude, SR, 0], rest: (a, p) => clapC(a, p.tone) },
];
function must(e, n) { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; }
function render(e, mod, alg, p, n, hitAt, withF) {
  const c = must(e, `soemdsp_${mod.m}_create`), d = must(e, `soemdsp_${mod.m}_destroy`), s = must(e, `soemdsp_${mod.m}_sample`);
  const R = must(e, `soemdsp_${mod.m}_right`), En = must(e, `soemdsp_${mod.m}_env`), F = withF ? must(e, `soemdsp_${mod.m}_f`) : null;
  const h = c();
  const L = new Float64Array(n), Rr = new Float64Array(n), Ev = new Float64Array(n), Fv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i === hitAt ? 0.8 : 0;
    L[i] = s(h, ...mod.args(t, 0, alg, p)); Rr[i] = R(h); Ev[i] = En(h); if (F) Fv[i] = F(h);
  }
  d(h);
  return { L, R: Rr, Ev, Fv };
}
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const N = SR * 6, HIT = 1000;
const rows = [];
for (const mod of MODS) {
  const algs = Array.isArray(mod.algs) ? mod.algs : [...Array(mod.algs).keys()];
  for (const alg of algs) {
    const r = render(E, mod, alg, mod.p, N, HIT, true);
    const rest = mod.rest(alg, mod.p);
    for (let i = 0; i < HIT; i++) {
      if (!near(r.Fv[i], rest)) throw new Error(`${mod.m} alg ${alg}: f before hit ${r.Fv[i]} != ${rest}`);
      if (r.Ev[i] !== 0) throw new Error(`${mod.m} alg ${alg}: env before hit ${r.Ev[i]}`);
    }
    let peak = 0; for (const x of r.Ev) peak = Math.max(peak, x);
    if (!(peak > 0.1)) throw new Error(`${mod.m} alg ${alg}: env peak ${peak}`);
    if (r.Ev[N - 1] !== 0) throw new Error(`${mod.m} alg ${alg}: env did not reach exact 0 (${r.Ev[N - 1]})`);
    if (!near(r.Fv[N - 1], rest)) throw new Error(`${mod.m} alg ${alg}: f after the hit ${r.Fv[N - 1]} != ${rest}`);
    for (const x of r.Fv) if (!Number.isFinite(x) || x <= 0) throw new Error(`${mod.m} alg ${alg}: bad f ${x}`);
    let fHit = r.Fv[HIT];
    if (mod.bends || mod.bendKey) {
      const p = mod.bendKey ? { ...mod.p, [mod.bendKey]: 1 } : mod.p;
      const b = render(E, mod, alg, p, SR, HIT, true);
      fHit = b.Fv[HIT];
      if (!(fHit > p.tune * 1.05)) throw new Error(`${mod.m} alg ${alg}: bend did not raise f at the hit (${fHit} vs Tune ${p.tune})`);
      const late = b.Fv[HIT + Math.round(0.5 * SR)];
      if (!(late < fHit && late >= p.tune * 0.999)) throw new Error(`${mod.m} alg ${alg}: f did not fall back toward Tune (${late})`);
    }
    if (OLD) {
      const o = render(OLD, mod, alg, mod.p, N, HIT, false);
      for (let i = 0; i < N; i++) {
        if (!Object.is(o.L[i], r.L[i]) || !Object.is(o.R[i], r.R[i]) || !Object.is(o.Ev[i], r.Ev[i])) {
          throw new Error(`${mod.m} alg ${alg}: audio differs from the previous build at ${i}`);
        }
      }
    }
    rows.push(`${mod.m} alg ${alg}: f rest ${rest.toFixed(2)} Hz, f at hit ${fHit.toFixed(2)} Hz, env peak ${peak.toFixed(3)} -> 0${OLD ? ", audio bit-identical" : ""}`);
  }
}
// Static wiring
const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
for (const o of ['["Kick L", "Kick R", "Env", "f"]', '["Snare L", "Snare R", "Env", "f"]', '["Tom L", "Tom R", "Env", "f"]', '["Hat L", "Hat R", "Env", "f"]', '["Clap L", "Clap R", "Env", "f"]']) {
  if (!defs.includes(`outputs: ${o}`)) throw new Error(`definitions missing outputs: ${o}`);
}
if ((defs.match(/outputs: \["Snare L", "Snare R", "Env", "f"\]/g) || []).length !== 2) throw new Error("Electro Snare + Modal Snare both need f");
const wk = fs.readFileSync(path.join(root, "public", "node-live-audio-worklet-native-graph.js"), "utf8");
if ((wk.match(/if \(p === "f" \|\| p === "\\u0192"\) return NodeLiveAudioProcessor\.NATIVE_GRAPH_PORT_SAW;/g) || []).length < 2) throw new Error("worklet f -> Saw mapping missing");
const ge = fs.readFileSync(path.join(root, "native_modules", "graph_engine", "graph_engine.cpp"), "utf8");
for (const mod of MODS) if (!ge.includes(`node.buf[kPortSaw][f] = soemdsp_${mod.m}_f(node.nativeHandle);`)) throw new Error(`graph_engine ${mod.m} f out missing`);
for (const r of rows) console.log("ok " + r);
console.log("drum f + env outs smoke OK");
