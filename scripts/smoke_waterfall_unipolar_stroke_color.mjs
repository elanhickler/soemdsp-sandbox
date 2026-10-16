// Smoke: waterfall Polarity (Bipolar default / Unipolar fill bottom-up) and
// stroke colour (dark picks draw as picked; regression: GL stroke clamped the
// 0..255 colour to 0..1, so any non-zero channel went to full brightness).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN };
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
vm.createContext(ctx);
vm.runInContext(src("node-graph-module-scope-waterfall.js"), ctx);
const H = 100;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const Y = (v, s) => ctx.nodeGraphWaterfallY(v, 1, 0, H / 2, H / 2, null, s);
// Bipolar (default, old patches: no polarity saved).
gate(near(Y(0, {}), 50) && near(Y(1, {}), 0) && near(Y(-1, {}), 100), "default/bipolar: -1 bottom, 0 middle, +1 top");
// Unipolar.
const U = { polarity: "unipolar" };
gate(near(Y(0, U), 100) && near(Y(1, U), 0) && near(Y(0.25, U), 75), "unipolar: 0 at the bottom edge, 1 at the top");
gate(near(Y(-0.7, U), 100) && near(Y(3, U), 0), "unipolar: negatives clamp to 0, above 1 clamps to the top");
gate(near(Y(0.5, { polarity: "unipolar", scale: 2 }), 0), "unipolar follows the display Scale (0.5 x 2 = top)");
const bar = ctx.nodeGraphWaterfallAccBarYs({ has: true, min: 0.2, max: 0.6 }, null, null, U, H);
gate(bar && near(bar.y1, 100) && near(bar.y0, 40), `unipolar fill: bottom edge up to the column peak (${bar && bar.y0}..${bar && bar.y1})`);
gate(bar && near(bar.strokeY0, 40) && near(bar.strokeY1, 80), "unipolar stroke extents follow the signal (0.2..0.6), not the fill");
const bb = ctx.nodeGraphWaterfallAccBarYs({ has: true, min: 0.2, max: 0.6 }, null, null, {}, H);
gate(bb && near(bb.y1, 50), "bipolar fill unchanged: one-sided column fills to the middle");
const wy = ctx.nodeGraphWaterfallWaveYs({ has: true, min: 0.1, max: 0.9, minAt: 1, maxAt: 0, last: 0.5 }, null, null, U, H);
gate(Array.isArray(wy) && wy.every((y) => y >= 0 && y <= 100) && Math.max(...wy) > 85, "unipolar stroke wave maps the same way (0.1 near the bottom)");
// Settings: choice present on every waterfall face, Bipolar default, saved key.
const tc = src("node-graph-module-scope-trace-controls.js");
const facePolarityFaces = ["waterfall", "waterfallXyz", "waterfallRgb"].filter((k) => new RegExp(`\\n  ${k}: Object\\.freeze\\(\\{[\\s\\S]*?choices: Object\\.freeze\\(\\[[^\\]]*"facePolarity"`).test(tc));
gate(facePolarityFaces.length === 3, `Polarity choice on waterfall / waterfallXyz / waterfallRgb (${facePolarityFaces.join(", ")})`);
gate(/value: "bipolar", label: "Bipolar"[\s\S]{0,80}value: "unipolar", label: "Unipolar"/.test(tc), "choice offers Bipolar and Unipolar");
const norm = src("node-graph-module-scope-normalize.js");
gate(/polarity: \(function \(\) \{\s*const raw = String\(source\.facePolarity \|\| source\.polarity \|\| defaults\.polarity \|\| "bipolar"\)/.test(norm), "normalize: saved polarity / facePolarity kept, missing = Bipolar");
// Bottom fill: bipolar -1..1 map, clamped; bars from the bottom edge to the column max.
const B = { polarity: "bottomFill" };
gate(near(Y(-1, B), 100) && near(Y(0, B), 50) && near(Y(1, B), 0), "bottom fill: -1 bottom, 0 middle, +1 top");
gate(near(Y(-3, B), 100) && near(Y(3, B), 0) && near(Y(0.5, { polarity: "bottomFill", scale: 2 }), 0), "bottom fill: clamps at the edges, after Scale");
const bf = ctx.nodeGraphWaterfallAccBarYs({ has: true, min: -0.6, max: -0.2 }, null, null, B, H);
gate(bf && near(bf.y1, 100) && near(bf.y0, 60), `bottom fill: negative column fills bottom..max (${bf && bf.y0}..${bf && bf.y1})`);
gate(bf && near(bf.strokeY0, 60) && near(bf.strokeY1, 80), "bottom fill: stroke extents stay min..max");
const bf2 = ctx.nodeGraphWaterfallAccBarYs({ has: true, min: -0.4, max: 0.8 }, null, null, B, H);
gate(bf2 && near(bf2.y1, 100) && near(bf2.y0, 10), "bottom fill: spanning column fills bottom..+0.8");
const bz = ctx.nodeGraphWaterfallAccBarYs({ has: true, min: 0, max: 0 }, null, null, B, H);
gate(bz && near(bz.y1, 100) && Math.abs(bz.y0 - 50) <= 0.5, "bottom fill: a 0 column fills to the middle (not skipped as silent)");
const bw = ctx.nodeGraphWaterfallWaveYs({ has: true, min: -0.9, max: 0.9, minAt: 0, maxAt: 1, last: 0 }, null, null, B, H);
gate(Array.isArray(bw) && Math.min(...bw) < 10 && Math.max(...bw) > 90, "bottom fill: stroke wave goes through both peaks on the -1..1 map");
gate(near(ctx.nodeGraphWaterfallAccBarYs({ has: true, min: 0.2, max: 0.6 }, null, null, { polarity: "absolute" }, H).y1, 100)
  && near(ctx.nodeGraphWaterfallAccBarYs({ has: true, min: -0.6, max: -0.2 }, null, null, {}, H).y0, 50), "bipolar / absolute unchanged");
gate(/value: "bottomFill", label: "Bottom fill"/.test(tc), "choice offers Bottom fill (bottomFill)");
gate(/if \(raw === "bottomfill" \|\| raw === "bottom"\) return "bottomFill";/.test(norm), "normalize keeps bottomFill");
// GL stroke colour reaches the shader as picked.
{
  const g = { console, Math, Number, Float32Array, Object, String, Array, JSON };
  vm.createContext(g);
  vm.runInContext(src("node-graph-module-scope-waterfall-gl.js"), g);
  let data = null;
  const gl = new Proxy({}, { get: (_t, k) => (k === "bufferData" ? (_a, arr) => { data = arr; } : typeof k === "string" && /^[A-Z_0-9]+$/.test(k) ? 1 : () => null) });
  g.nodeGraphOnsetGlEnsureLine = () => {};
  const canvas = { _wfGlSession: { gl, lineProg: {}, lineLoc: {}, read: { fbo: {} }, w: 10, h: 10 } };
  const check = (rgb, label) => {
    data = null;
    g.nodeGraphOnsetGlStrokePolyline(canvas, [{ x: 1, y: 1 }, { x: 5, y: 5 }], 2, rgb);
    const c = data ? Array.from(data.slice(4, 8)) : [];
    const want = rgb.map((v) => v / 255);
    gate(c.length === 4 && c.slice(0, 3).every((v, i) => Math.abs(v - want[i]) < 1e-6) && c[3] === 1, `${label}: stroke colour ${JSON.stringify(rgb)} -> ${c.map((v) => v.toFixed(3)).join(",")}`);
  };
  check([45, 45, 45], "dark grey #2d2d2d");
  check([0, 0, 64], "dark navy #000040");
  check([255, 128, 0], "bright orange");
  const parsed = ctx.nodeGraphWaterfallStrokeRgb({ strokeColor: "#2d2d2d" });
  gate(JSON.stringify(parsed) === "[45,45,45]", "Stroke hex parses to 0..255 for the GL stroke");
}
console.log(failures ? `FAILED ${failures}` : "smoke_waterfall_unipolar_stroke_color ok");
if (failures) process.exit(1);
