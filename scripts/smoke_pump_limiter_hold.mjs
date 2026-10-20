// Headless: Pump Limiter Hold (native pumping_limiter + graph type 109).
// - Hold 0: every output bit-identical to the pre-Hold formula (JS twin of the old gain step below).
// - Hold N ms: release starts exactly round-up(N ms * sr) samples later than Hold 0.
// - A new deeper peak during the hold restarts it.
// - Graph: param 106 (laneBias[2]) reaches the DSP; default 0.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const create = must("soemdsp_pumping_limiter_create"), destroy = must("soemdsp_pumping_limiter_destroy");
const sample = must("soemdsp_pumping_limiter_sample"), gainOf = must("soemdsp_pumping_limiter_gain");
if ((must("soemdsp_pumping_limiter_version")() | 0) < 2) throw new Error("pumping_limiter version < 2");
const SR = 48000;

// Burst (loud) then quiet, optional second burst. Look-ahead off so gain timing is direct.
function run(holdMs, { second = -1, n = SR } = {}) {
  const h = create() | 0;
  const g = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const loud = i < 2400 || (second >= 0 && i >= second && i < second + 2400);
    const x = (loud ? 0.9 : 0.01) * Math.sin(2 * Math.PI * 220 * i / SR);
    y[i] = sample(h, x, x, 0, 0, 0, -18, 8, 5, 0, 5, holdMs, 250, SR, 0, 1);
    g[i] = gainOf(h);
  }
  destroy(h);
  return { g, y };
}
// release start = first sample after the burst where gain rises.
const releaseStart = (g, from = 2400) => { for (let i = from; i < g.length; i++) if (g[i] > g[i - 1]) return i; return -1; };

const h0 = run(0);
const r0 = releaseStart(h0.g);
if (r0 < 0) throw new Error("hold 0: no release found");
for (const ms of [10, 37.5, 100]) {
  const hN = run(ms);
  const rN = releaseStart(hN.g);
  const N = Math.ceil(ms * 0.001 * SR);
  if (rN - r0 !== N) throw new Error(`hold ${ms} ms: release delayed ${rN - r0} samples, expected ${N}`);
  for (let i = r0 - 1; i < rN; i++) if (hN.g[i] !== hN.g[r0 - 1]) throw new Error(`hold ${ms} ms: gain moved during hold at ${i}`);
  // before the hold point both runs are identical
  for (let i = 0; i < r0; i++) if (!Object.is(hN.y[i], h0.y[i])) throw new Error(`hold ${ms} ms differs before release at ${i}`);
  console.log(`ok hold ${ms} ms: release starts ${rN - r0} samples later (= ${N}), gain flat during hold`);
}
// Retrigger: a second burst (as loud and long as the first) inside a 100 ms hold restarts it.
{
  const ms = 100, N = Math.ceil(ms * 0.001 * SR);
  const base = run(ms), re = run(ms, { second: r0 + 2000 });
  const rb = releaseStart(base.g), rr = releaseStart(re.g, r0 + 2000 + 2400);
  if (!(rr > rb + 2000)) throw new Error(`retrigger did not restart hold (${rb} vs ${rr})`);
  console.log(`ok retrigger: new peak at ${r0 + 2000} restarts the hold (release ${rb} -> ${rr})`);
}

// Graph: param 106 Hold reaches the DSP; default 0 == explicit 0.
{
  const gC = must("soemdsp_graph_create"), gD = must("soemdsp_graph_destroy"), add = must("soemdsp_graph_add_node");
  const connect = must("soemdsp_graph_connect"), setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
  const proc = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
  const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
  if ((must("soemdsp_graph_version")() | 0) < 168) throw new Error("graph version < 168");
  const grun = (hold) => {
    const g = gC() | 0; setSr(g, SR);
    const hO = 0x9301, hL = 0x9302, hOut = 0x9303;
    add(g, hO, 1); add(g, hL, 109); add(g, hOut, 6);
    connect(g, hO, 0, hL, 0); connect(g, hL, 0, hOut, 0);
    setParam(g, hO, 10, 110); setParam(g, hO, 12, 0.9);
    setParam(g, hL, 21, 0); // look-ahead off
    if (hold !== null) setParam(g, hL, 106, hold);
    compile(g); snap(g);
    const gains = [];
    for (let q = 0; q < 40; q++) {
      if (q === 10) { setParam(g, hO, 12, 0.01); snap(g); } // drop level -> release
      proc(g, 128);
      gains.push(...new Float64Array(e.memory.buffer, portPtr(g, hL, 3) | 0, 128));
    }
    gD(g); return gains;
  };
  const d = grun(null), z = grun(0), h = grun(20);
  if (!d.every((v, i) => Object.is(v, z[i]))) throw new Error("graph: default hold != 0");
  const rd = releaseStart(d, 1280), rh = releaseStart(h, 1280);
  if (rh - rd !== Math.ceil(0.02 * SR)) throw new Error(`graph hold 20 ms: delay ${rh - rd}`);
  console.log(`ok graph: default Hold = 0; Hold 20 ms (param 106) delays release by ${rh - rd} samples`);
}
// Attack 0 + look-ahead: a hot spike must not leave the delay above Threshold.
// Threshold 0 dB, ratio 8, 5 ms look-ahead, one sample at amplitude 4 (+12 dB).
{
  const h = create() | 0;
  const n = Math.ceil(0.05 * SR);
  let peak = 0;
  let peakAt = -1;
  const laSamples = Math.round(0.005 * SR);
  for (let i = 0; i < n; i++) {
    const x = i === 1000 ? 4 : 0.05;
    const y = sample(h, x, x, 0, 0, 0, 0, 8, 5, 0, 0, 0, 250, SR, 1, 1);
    const a = Math.abs(y);
    if (a > peak) {
      peak = a;
      peakAt = i;
    }
  }
  destroy(h);
  if (peak > 1 + 1e-9) throw new Error(`attack 0 look-ahead: peak ${peak} at ${peakAt} exceeds 0 dB`);
  const expectAt = 1000 + laSamples;
  if (Math.abs(peakAt - expectAt) > 1) {
    throw new Error(`attack 0 look-ahead: loudest sample at ${peakAt}, expected ${expectAt} (peak ${peak})`);
  }
  if (peak < 0.5) throw new Error(`attack 0 look-ahead: limited spike too quiet (${peak})`);
  console.log(`ok attack 0 + 5 ms look-ahead: peak ${peak.toFixed(4)} at ${peakAt} (<= 0 dB)`);
}
// Attack shorter than look-ahead: the ramp finishes in the preview, so the
// spike stays at Threshold. Attack longer than look-ahead: it has not finished.
{
  const runSpike = (attackMs) => {
    const h = create() | 0;
    const n = Math.ceil(0.05 * SR);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const x = i === 1000 ? 4 : 0.05;
      const y = sample(h, x, x, 0, 0, 0, 0, 8, 5, 0, attackMs, 0, 250, SR, 1, 1);
      peak = Math.max(peak, Math.abs(y));
    }
    destroy(h);
    return peak;
  };
  const fast = runSpike(2);
  const slow = runSpike(20);
  if (fast > 1 + 1e-9) throw new Error(`attack 2 ms < look-ahead 5 ms: peak ${fast} exceeds 0 dB`);
  if (!(slow > 1.05)) throw new Error(`attack 20 ms > look-ahead 5 ms: expected the spike to poke through, peak ${slow}`);
  console.log(`ok attack vs look-ahead: 2 ms peak ${fast.toFixed(4)} (<= 0 dB), 20 ms peak ${slow.toFixed(4)} (pokes through)`);
}
console.log("pump limiter hold smoke ok");

