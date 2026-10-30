// The one scope sync rule (public/lib/visual/scope-sync.js), shared by 1D Plot,
// 1D Trace and 1D Phosphor:
//   - a synced window starts at the same phase every frame, to a sub-sample,
//     whatever the frame boundaries (no jitter)
//   - Window Cycles (default 3): the window is N measured periods; Time: ms
//   - hysteresis ignores noise crossings near the level
//   - no edge: the window runs free; Free: the newest Time
//   - pen: Free wraps; Sync parks at the right edge until an edge, restarts at
//     the sub-sample crossing; no edge for a whole pass runs free
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public", "lib", "visual", "scope-sync.js"), "utf8"), ctx);
const S = ctx;
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail !== "" ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

const SR = 48000;
const hz = 437.3; // not a divisor of the rate: edges land between samples
const total = SR * 2;
const sine = new Float32Array(total);
for (let i = 0; i < total; i += 1) sine[i] = 0.8 * Math.sin(2 * Math.PI * hz * i / SR) + 0.1;

// 1) Window start phase across frames with different end points.
{
  const state = {};
  const settings = { windowMode: "time", timeMs: 10 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let frame = 0; frame < 60; frame += 1) {
    const end = 20000 + frame * 733;
    const view = sine.subarray(0, end);
    const win = S.nodeGraphScopeSyncWindow(S.nodeGraphScopeSyncState(state), view, end, { settings, sampleRate: SR, sync: true, trigger: false });
    // Phase of the sine at the window start, centred on 0 (cycles, -0.5..0.5).
    const phase = ((win.start * hz / SR + 0.5) % 1 + 1) % 1 - 0.5;
    lo = Math.min(lo, phase);
    hi = Math.max(hi, phase);
  }
  // Level = smoothed mid (0.1) → the crossing phase is asin(0)/2π after the
  // DC offset cancels; spread must be far below one sample (hz/SR cycles).
  const spread = hi - lo;
  const oneSample = hz / SR;
  check(spread < oneSample * 0.05, "synced window: same start phase every frame (sub-sample)", `${spread.toExponential(2)} cycles, 1 sample = ${oneSample.toExponential(2)}`);
}

// 2) Hysteresis: a slow ramp with small noise crosses the level once.
{
  const len = 4000;
  const ramp = new Float32Array(len);
  for (let i = 0; i < len; i += 1) ramp[i] = -1 + 2 * (i / len) + 0.01 * Math.sin(i * 2.1);
  const state = { armed: false };
  const level = { level: 0, hyst: 0.04 * 2 };
  let edges = 0;
  for (let i = 1; i < len; i += 1) if (S.nodeGraphScopeSyncStep(state, ramp[i - 1], ramp[i], level) >= 0) edges += 1;
  check(edges === 1, "hysteresis: noisy crossing fires once", edges);
  const plain = { armed: false };
  let raw = 0;
  for (let i = 1; i < len; i += 1) if (S.nodeGraphScopeSyncStep(plain, ramp[i - 1], ramp[i], { level: 0, hyst: 0 }) >= 0) raw += 1;
  check(raw > 1, "without hysteresis the same signal fires more than once", raw);
}

// 3) No edge (DC): window runs free; Free = newest Time.
{
  const dc = new Float32Array(10000).fill(0.5);
  const n = 480;
  const settings = { windowMode: "time", timeMs: 10 };
  const win = S.nodeGraphScopeSyncWindow(S.nodeGraphScopeSyncState({}), dc, dc.length, { settings, sampleRate: SR, sync: true, trigger: false });
  check(win.start === dc.length - 2 - n, "no edge: newest window", win.start);
  const free = S.nodeGraphScopeSyncWindow(S.nodeGraphScopeSyncState({}), sine, 20000, { settings, sampleRate: SR, sync: false, trigger: false });
  check(free.start === 20000 - 2 - n, "free: newest window", free.start);
}

// 3b) Window Cycles (default 3): N measured periods, same start phase.
{
  const def = S.nodeGraphScopeWindowSettings({}, {});
  check(def.windowMode === "cycles" && def.windowCycles === 3, "default window: Cycles 3", JSON.stringify(def));
  const state = {};
  const settings = { windowMode: "cycles", windowCycles: 3, timeMs: 10 };
  const period = SR / hz;
  let nErr = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let frame = 0; frame < 40; frame += 1) {
    const end = 30000 + frame * 611;
    const win = S.nodeGraphScopeSyncWindow(S.nodeGraphScopeSyncState(state), sine.subarray(0, end), end, { settings, sampleRate: SR, sync: true, trigger: false });
    if (frame > 2) {
      nErr = Math.max(nErr, Math.abs(win.n - 3 * period));
      const phase = ((win.start * hz / SR + 0.5) % 1 + 1) % 1 - 0.5;
      lo = Math.min(lo, phase);
      hi = Math.max(hi, phase);
    }
  }
  check(nErr <= 1, "cycles window = 3 measured periods (±1 sample)", `${nErr.toFixed(3)} samples, period ${period.toFixed(2)}`);
  check(hi - lo < (hz / SR) * 0.05, "cycles window: same start phase every frame", (hi - lo).toExponential(2));
  // Pen scopes measure the period sample by sample.
  const pen = S.nodeGraphScopeSyncState({});
  const level = { level: 0.1, hyst: 0.05 };
  let prev = sine[0];
  for (let i = 1; i < 20000; i += 1) {
    S.nodeGraphScopeSyncTrackPeriod(pen, S.nodeGraphScopeSyncStep(pen, prev, sine[i], level));
    prev = sine[i];
  }
  check(Math.abs(pen.period - period) < 0.01, "pen period from edge intervals", `${pen.period.toFixed(4)} vs ${period.toFixed(4)}`);
  check(Math.abs(S.nodeGraphScopePassSamples(pen, settings, SR) - 3 * period) < 0.05, "pen pass = 3 periods in Cycles mode");
  check(S.nodeGraphScopePassSamples(pen, { ...settings, windowMode: "time" }, SR) === 480, "pen pass = Time in Time mode");
}

// 4) Pen.
{
  const pen = { phasor: 0, waiting: false, waited: 0 };
  const inc = 1 / 100;
  let wraps = 0;
  for (let i = 0; i < 250; i += 1) {
    const step = S.nodeGraphScopeSyncPenStep(pen, inc, false, -1);
    if (step === S.NODE_GRAPH_SCOPE_PEN_BREAK_DRAW) wraps += 1;
    if (step === S.NODE_GRAPH_SCOPE_PEN_DRAW || step === S.NODE_GRAPH_SCOPE_PEN_BREAK_DRAW) S.nodeGraphScopeSyncPenAdvance(pen, inc);
  }
  check(wraps === 2, "free pen wraps every pass", wraps);

  const synced = { phasor: 0, waiting: false, waited: 0 };
  let parked = 0;
  let restartPhasor = -1;
  for (let i = 0; i < 160; i += 1) {
    const edgeT = i === 130 ? 0.25 : -1;
    const step = S.nodeGraphScopeSyncPenStep(synced, inc, true, edgeT);
    if (step === S.NODE_GRAPH_SCOPE_PEN_WAIT || step === S.NODE_GRAPH_SCOPE_PEN_BREAK_WAIT) parked += 1;
    if (step === S.NODE_GRAPH_SCOPE_PEN_BREAK_DRAW && restartPhasor < 0) restartPhasor = synced.phasor;
    if (step === S.NODE_GRAPH_SCOPE_PEN_DRAW || step === S.NODE_GRAPH_SCOPE_PEN_BREAK_DRAW) S.nodeGraphScopeSyncPenAdvance(synced, inc);
  }
  check(parked === 30, "sync pen parks at the right edge until the edge", parked);
  check(Math.abs(restartPhasor - 0.75 * inc) < 1e-12, "sync pen restarts at the sub-sample crossing", restartPhasor);

  const auto = { phasor: 0, waiting: false, waited: 0 };
  let autoRestart = -1;
  for (let i = 0; i < 400; i += 1) {
    const step = S.nodeGraphScopeSyncPenStep(auto, inc, true, -1);
    if (step === S.NODE_GRAPH_SCOPE_PEN_BREAK_DRAW && autoRestart < 0) autoRestart = i;
    if (step === S.NODE_GRAPH_SCOPE_PEN_DRAW || step === S.NODE_GRAPH_SCOPE_PEN_BREAK_DRAW) S.nodeGraphScopeSyncPenAdvance(auto, inc);
  }
  check(autoRestart === 200, "no edge for a whole pass: pen runs free", autoRestart);
}

console.log(failed ? `${failed} FAILED` : "ok scope sync");
process.exit(failed ? 1 : 0);
