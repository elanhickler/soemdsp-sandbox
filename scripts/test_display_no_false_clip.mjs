#!/usr/bin/env node
// Unit test: app-wide "no false visual clip" display policy.
// Scale / zoom / offset must never flatten a non-clipping trace against the
// face rail; only a signal that is itself flat at a limit may draw flat.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Math, Number, String, Boolean, Object, Array };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  "function nodeGraphFiniteNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }",
  ctx,
);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
vm.runInContext(read("public/lib/trace/trace-waveform.js"), ctx, { filename: "trace-waveform.js" });

const waterfall = read("public/node-graph-module-scope-waterfall.js");
const wStart = waterfall.indexOf("function nodeGraphWaterfallPolarity");
const wEnd = waterfall.indexOf("function nodeGraphWaterfallPrepare");
if (wStart < 0 || wEnd < 0) throw new Error("Could not extract waterfall Y helpers");
vm.runInContext(waterfall.slice(wStart, wEnd), ctx, { filename: "waterfall-y-slice.js" });
vm.runInContext(
  "this.nodeGraphWaterfallY = nodeGraphWaterfallY; this.nodeGraphWaterfallNoFalseClipY = nodeGraphWaterfallNoFalseClipY;",
  ctx,
);

const { TraceWaveform, nodeGraphTraceDisplayValue, nodeGraphWaterfallY } = ctx;
let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
}

// Helper: unit map without rails.
check(nodeGraphTraceDisplayValue(0.8, 2, 0) === 1.6, "0.8 x gain 2 maps to 1.6 (not railed to 1)");
check(nodeGraphTraceDisplayValue(-0.5, 1, -0.75) === -1.25, "offset past the rail is not railed");
check(nodeGraphTraceDisplayValue(0.5, 1, 0) === 0.5, "in-range value unchanged");
check(nodeGraphTraceDisplayValue(NaN, 1, 0) === 0, "non-finite sample draws at 0");
check(Math.abs(nodeGraphTraceDisplayValue(1e9, 100, 0)) === TraceWaveform.DISPLAY_UNIT_OVERSHOOT,
  "far bound only far off-face (GL safety)");

// Sine with peaks at 0.8 (inside the legal range), shown at gain 2.
const N = 512;
const sine = new Float32Array(N);
for (let i = 0; i < N; i += 1) sine[i] = 0.8 * Math.sin((i / N) * Math.PI * 4);
const height = 100;
const midY = 50;
const halfHeight = 42;
const railTop = midY - halfHeight;
const railBot = midY + halfHeight;
const ys = (buf, gain) => TraceWaveform.buildPoints({
  buffer: buf, start: 0, end: buf.length, width: 400, height, midY, halfHeight, gain, offset: 0,
}).filter(Boolean).map((p) => p.y);

const zoomed = ys(sine, 2);
const atRail = zoomed.filter((y) => Math.abs(y - railTop) < 1e-6 || Math.abs(y - railBot) < 1e-6).length;
const flatRun = (() => {
  let run = 0; let best = 0;
  for (const y of zoomed) {
    if (y <= railTop + 1e-6 || y >= railBot - 1e-6) { run += 1; best = Math.max(best, run); } else run = 0;
  }
  return Math.min(...zoomed) < railTop - 1 ? 0 : best;
})();
check(Math.min(...zoomed) < railTop - 10 && Math.max(...zoomed) > railBot + 10,
  "zoomed non-clipping sine peaks leave the plot instead of mashing into the rails");
check(atRail <= 2 && flatRun === 0, "zoomed non-clipping sine has no flat run pinned at a rail");
const peakY = midY - 1.6 * halfHeight;
check(Math.abs(Math.min(...zoomed) - peakY) < 0.5, "zoomed peak sits at its true (off-face) position");

// Unzoomed non-clipping sine stays fully inside, untouched.
const plain = ys(sine, 1);
check(Math.min(...plain) > railTop && Math.max(...plain) < railBot, "gain 1 sine stays inside the plot");

// A signal that really clips (flat at +/-1) still draws flat at the rail.
const clipped = new Float32Array(N);
for (let i = 0; i < N; i += 1) clipped[i] = Math.max(-1, Math.min(1, 2 * Math.sin((i / N) * Math.PI * 4)));
const clippedYs = ys(clipped, 1);
const onTop = clippedYs.filter((y) => Math.abs(y - railTop) < 1e-6).length;
check(onTop > 10, "a truly clipped signal still slams flat against the rail");

// Waterfall: Scale 2 on a 0.8 sine peak must not ride the face edge.
const H = 96;
const wfTop = nodeGraphWaterfallY(0.8, 1, 0, H / 2, H / 2, null, { scale: 2 });
check(wfTop < -10, `Waterfall Scale 2 peak leaves the face (y=${wfTop.toFixed(2)}), not pinned at 0`);
const wfIn = nodeGraphWaterfallY(0.5, 1, 0, H / 2, H / 2, null, { scale: 1 });
check(Math.abs(wfIn - 24) < 1e-9, "Waterfall in-range value maps unchanged");
const wfUni = nodeGraphWaterfallY(0.75, 1, 0, H / 2, H / 2, null, { scale: 2, polarity: "unipolar" });
check(wfUni < 0, "Waterfall unipolar Scale 2 peak leaves the face instead of railing");
const wfClip = nodeGraphWaterfallY(1, 1, 0, H / 2, H / 2, null, { scale: 1 });
check(Math.abs(wfClip - 0) < 1e-9, "Waterfall full-scale (clipped) sample sits exactly on the rail");

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("display no-false-clip: all checks passed");