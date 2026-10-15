// Smoke: Instant Waterfall Stroke = draw the waveform (both peaks), not a
// one-sided upper/lower edge. Loads node-graph-module-scope-waterfall.js in a vm.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN };
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8"), ctx);
const H = 100;
const acc = ctx.nodeGraphWaterfallAccMake();
// One column of a sine: rises to +0.8 first, then down to -0.6, ends at -0.2.
const buf = new Float32Array([0, 0.5, 0.8, 0.3, -0.6, -0.2]);
ctx.nodeGraphWaterfallAccPush(acc, buf, 0, buf.length, {}, null);
gate(acc.maxAt === 2 && acc.minAt === 4 && Math.abs(acc.last - -0.2) < 1e-6, "accumulator keeps peak order and last sample");
const raw = ctx.nodeGraphWaterfallWaveRaw(acc, {});
gate(raw.length === 3 && Math.abs(raw[0] - 0.8) < 1e-6 && Math.abs(raw[1] + 0.6) < 1e-6 && Math.abs(raw[2] + 0.2) < 1e-6,
  `wave points in time order: max, min, last (${raw.map((v) => v.toFixed(2)).join(", ")})`);
const ys = ctx.nodeGraphWaterfallWaveYs(acc, buf, null, {}, H);
gate(Math.min(...ys) < H / 2 && Math.max(...ys) > H / 2, "stroke spans both the top AND bottom of the signal (not top-only)");
// Stroke column polyline: previous last point -> peaks -> last.
const drawn = [];
ctx.nodeGraphOnsetGlStrokePolyline = (_c, pts) => { drawn.push(pts.map((p) => [p.x, p.y])); return true; };
ctx.nodeGraphOnsetStrokeCanvasPx = () => 1;
const bag = {};
ctx.nodeGraphWaterfallStrokeWaveColumn({}, bag, "L", 10, ys, {}, false);
ctx.nodeGraphWaterfallStrokeWaveColumn({}, bag, "L", 11, [40, 60], {}, false);
gate(drawn.length === 2 && drawn[1][0][1] === ys[ys.length - 1] && drawn[1].length === 3,
  "next column continues from the previous column's last sample (one continuous waveform)");
ctx.nodeGraphWaterfallStrokeWaveColumn({}, bag, "L", 0, [50], {}, true);
gate(drawn[2].length === 2 && drawn[2][0][0] === 0.5, "seam starts a new line (no wrap-around segment)");
// Absolute polarity folds a zero crossing between the peaks.
const absRaw = ctx.nodeGraphWaterfallWaveRaw(acc, { polarity: "absolute" });
gate(absRaw.length === 4 && absRaw[1] === 0, "absolute polarity: line passes through 0 between opposite-sign peaks");
console.log(failures ? `FAILED ${failures}` : "smoke_waterfall_stroke_wave ok");
if (failures) process.exit(1);
