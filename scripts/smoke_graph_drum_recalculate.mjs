// Recalculate On Trigger on the drum modules: Off is bit-identical to the
// previous build; On keeps the ringing hit's decay and applies a change on the next hit.
import fs from "fs";
const imp = { env: { emo_process_block: () => 0 } };
const N = (await WebAssembly.instantiate(fs.readFileSync(process.argv[2] || "native_modules/combined/soemdsp_combined.wasm"), imp)).instance.exports;
const O = process.argv[3] ? (await WebAssembly.instantiate(fs.readFileSync(process.argv[3]), imp)).instance.exports : null;
const SR = 48000;
// name, trigger arg idx list, reset idx, base args (after handle, sr last excluded), decay idx, algorithms, getters
const M = [
  ["electro_kick", [0], 1, [0, 0, 0, 55, 1, 0.05, 0.5, 0.5, 0.5, 1], [6], 3, ["right", "env"]],
  ["electro_snare", [0], 1, [0, 0, 0, 180, 0.5, 0.5, 0.25, 0.2, 0, 1, 2, 0.4], [6, 7], 5, ["right", "env"]],
  ["electro_tom", [0], 1, [0, 0, 0, 120, 0.5, 0.5, 0.4, 0.3, 1], [6], 3, ["right", "env"]],
  ["electro_hat", [0, 1], 2, [0, 0, 0, 0, 1, 0.5, 0.08, 0.5, 0.5, 1], [6, 7], 4, ["right", "env"]],
  ["electro_clap", [0], 1, [0, 0, 0, 0.5, 0.5, 0.4, 0.5, 1], [5], 3, ["right", "env"]],
  ["modal_snare", [0], 1, [0, 0, 180, 0.5, 0.5, 0.25, 0.2, 0, 1, 3000, 1, 0.3, 2, 0], [5, 6], 1, ["right", "env"]],
  ["robin_sinepulse", [0], -1, [0, 200, 50, 0.1, 0, 0, 0, 0, 0, 0.4, 1], [9], 1, ["env", "freq", "unit"]],
];
const algIdx = (m) => (m[0] === "modal_snare" || m[0] === "robin_sinepulse") ? -1 : (m[0] === "electro_hat" ? 3 : 2);
function run(E, m, alg, n, { recalc, auto, decayAt, trigEvery = 12000 }) {
  const [name, trigs, resetIdx, base, decIdx, , getters] = m;
  const h = E[`soemdsp_${name}_create`]();
  const args = base.slice();
  if (algIdx(m) >= 0) args[algIdx(m)] = alg;
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = args.slice();
    const beat = Math.floor(i / trigEvery);
    trigs.forEach((ti, k) => { a[ti] = (i % trigEvery) < 8 && (beat % trigs.length) === k ? 0.5 + 0.5 * ((beat * 7) % 3) / 2 : 0; });
    if (resetIdx >= 0) a[resetIdx] = (i % 30000) > 29990 ? 1 : 0;
    if (auto && i % 1500 === 0) for (let j = 0; j < args.length; j++) if (!trigs.includes(j) && j !== resetIdx && j !== algIdx(m)) args[j] = base[j] * (0.7 + 0.6 * rnd());
    if (decayAt) for (const d of decIdx) a[d] = i >= decayAt.at ? base[d] * decayAt.mul : base[d];
    const call = recalc === undefined ? [h, ...a, SR] : [h, ...a, SR, recalc];
    out.push(E[`soemdsp_${name}_sample`](...call));
    for (const g of getters) out.push(E[`soemdsp_${name}_${g}`](h));
  }
  E[`soemdsp_${name}_destroy`](h);
  return out;
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, Object.is(v, b[i]) || v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
const rows = [];
for (const m of M) {
  const name = m[0];
  for (let alg = 0; alg < m[5]; alg++) {
    if (name === "electro_snare" && alg === 3) continue;
    const n = 96000;
    let offDiff = 0, undefDiff = 0;
    const off = run(N, m, alg, n, { recalc: 0, auto: true });
    if (O) offDiff = md(off, run(O, m, alg, n, { auto: true }));
    undefDiff = md(off, run(N, m, alg, n, { auto: true }));
    // On: decay x0.3 at sample 3000 (mid first hit). Must match "no change" until the
    // next hit (12000), then differ.
    const per = 1 + m[6].length;
    const hitLen = 12000;
    const changed = run(N, m, alg, 30000, { recalc: 1, decayAt: { at: 3000, mul: 0.3 } });
    const steady = run(N, m, alg, 30000, { recalc: 1, decayAt: { at: 1e9, mul: 1 } });
    const liveChanged = run(N, m, alg, 30000, { recalc: 0, decayAt: { at: 3000, mul: 0.3 } });
    const firstHitSame = md(changed.slice(0, hitLen * per), steady.slice(0, hitLen * per));
    const nextHitDiff = md(changed.slice(hitLen * per, 2 * hitLen * per), steady.slice(hitLen * per, 2 * hitLen * per));
    const liveMidDiff = md(liveChanged.slice(0, hitLen * per), steady.slice(0, hitLen * per));
    const nextHitMatchesLive = md(changed.slice((hitLen + 4000) * per, 2 * hitLen * per), liveChanged.slice((hitLen + 4000) * per, 2 * hitLen * per));
    rows.push({ name, alg, offVsOldBuild: O ? offDiff : "n/a", offVsNoArg: undefDiff, onFirstHitDiff: firstHitSame, onNextHitDiff: +nextHitDiff.toExponential(2), offMidHitDiff: +liveMidDiff.toExponential(2) });
    if (O && offDiff !== 0) throw new Error(`${name} alg ${alg}: Off differs from old build (${offDiff})`);
    if (undefDiff !== 0) throw new Error(`${name} alg ${alg}: Off differs from no-arg call`);
    if (firstHitSame !== 0) throw new Error(`${name} alg ${alg}: On changed the ringing hit (${firstHitSame})`);
    if (!(nextHitDiff > 0)) throw new Error(`${name} alg ${alg}: On did not apply the change on the next hit`);
    if (!(liveMidDiff > 0)) throw new Error(`${name} alg ${alg}: Off decay change had no effect mid-hit (test is blind)`);
  }
}
console.table(rows);
console.log("ok drum Recalculate On Trigger");

// Modal Snare: Body / Noise is latched too (On), live (Off). Change 0 -> -1 at
// sample 3000 (mid first hit, hits every 12000): On keeps the first hit, the
// next hit plays body only; Off changes mid-hit; On without a change == Off.
{
  const base = [0, 0, 180, 0.5, 0.5, 0.25, 0.2, 0, 1, 3000, 1, 0.3, 2, 0];
  const runBn = (E, recalc, at, n = 30000) => {
    const h = E.soemdsp_modal_snare_create();
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = base.slice();
      a[0] = i % 12000 < 8 ? 1 : 0;
      out.push(E.soemdsp_modal_snare_sample(h, ...a, SR, recalc, i >= at ? -1 : 0), E.soemdsp_modal_snare_right(h), E.soemdsp_modal_snare_env(h));
    }
    E.soemdsp_modal_snare_destroy(h);
    return out;
  };
  const hit = 12000 * 3;
  const onChanged = runBn(N, 1, 3000), onSteady = runBn(N, 1, 1e9), offChanged = runBn(N, 0, 3000), offSteady = runBn(N, 0, 1e9);
  const first = md(onChanged.slice(0, hit), onSteady.slice(0, hit));
  const next = md(onChanged.slice(hit, 2 * hit), onSteady.slice(hit, 2 * hit));
  const offMid = md(offChanged.slice(0, hit), offSteady.slice(0, hit));
  const nextIsBodyOnly = md(onChanged.slice(hit + 3, 2 * hit), offChanged.slice(hit + 3, 2 * hit));
  if (md(onSteady, offSteady) !== 0) throw new Error("modal_snare bodyNoise: On without a change differs from Off");
  if (first !== 0) throw new Error(`modal_snare bodyNoise: On changed the ringing hit (${first})`);
  if (!(next > 0)) throw new Error("modal_snare bodyNoise: On did not apply the change on the next hit");
  if (!(offMid > 0)) throw new Error("modal_snare bodyNoise: Off had no mid-hit effect (test is blind)");
  console.log(`ok modal_snare Body / Noise latch: On first hit diff 0, next hit diff ${next.toExponential(2)} (next hit vs Off body-only ${nextIsBodyOnly.toExponential(2)}), Off mid-hit diff ${offMid.toExponential(2)}`);
}
