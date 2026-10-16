// Smoke: waterfall GL bars / Meet columns / column clears are batched.
// Per-bar values travel as per-vertex attributes, consecutive stamps with the
// same program + blend go out in ONE bufferSubData + ONE drawArrays, and any
// other session op (present, scroll, blend change) flushes first so draw order
// is unchanged. (Pixel parity old vs new was checked in Chrome: bit-exact.)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const log = [];
const attrIds = {};
const gl = new Proxy({}, {
  get: (_t, k) => {
    if (typeof k !== "string") return undefined;
    if (/^[A-Z_0-9]+$/.test(k)) return k;
    if (k === "isContextLost") return () => false;
    if (k === "checkFramebufferStatus") return () => "FRAMEBUFFER_COMPLETE";
    if (k === "getShaderParameter" || k === "getProgramParameter") return () => true;
    if (k === "getAttribLocation") return (_p, n) => (attrIds[n] ??= Object.keys(attrIds).length + 1);
    if (k.startsWith("create")) return () => ({ kind: k });
    return (...a) => { log.push([k, a]); };
  },
});
const ctx = {
  console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Promise,
  queueMicrotask: (fn) => Promise.resolve().then(fn),
  TraceMeetGlsl: { MEET_SPAN_GLSL: "", MEET_GLSL: "" },
};
ctx.nodeGraphSharedGlDevice = () => ({ gl, canvas: { width: 4096, height: 4096 } });
const blits = [];
ctx.nodeGraphDisplayCanvasPresentContext = (c) => c.getContext("2d");
ctx.nodeGraphDisplayCanvasBlit = (...a) => { blits.push(a); return true; };
vm.createContext(ctx);
vm.runInContext(src("node-graph-module-scope-waterfall-gl.js"), ctx);
const face = { width: 320, height: 160, style: {}, getContext: () => ({}) };
gate(ctx.nodeGraphWaterfallGlReset(face, "#101828") === true, "session created on the mock shared device");
const s = face._wfGlSession;
const count = (name) => log.filter(([k]) => k === name).length;
const plate = "#101828";

// Warm-up column: a face's first clear has no run to join yet.
const meetCol = (x) => {
  ctx.nodeGraphWaterfallGlClearColumn(face, x, 1, plate);
  ctx.nodeGraphWaterfallGlStampMeetColumn(face, x, { y0: 40, y1: 90 }, null, { only: [{ y0: 10, y1: 20 }], overlap: { y0: 30, y1: 35 } }, [255, 0, 0], [0, 0, 255], [0, 255, 0], 0);
};
meetCol(199);
ctx.nodeGraphWaterfallGlPresent(face, plate);
// 1) 40 columns of clear + Meet (the hypersaw pattern): one run.
log.length = 0;
for (let i = 0; i < 40; i += 1) {
  const ys = { y0: 40 + i, y1: 90 };
  ctx.nodeGraphWaterfallGlClearColumn(face, 200 + i, 1, plate);
  ctx.nodeGraphWaterfallGlStampMeetColumn(face, 200 + i, ys, null, { only: [{ y0: 10, y1: 20 }], overlap: { y0: 30, y1: 35 } }, [255, 0, 0], [0, 0, 255], [0, 255, 0], 0);
}
gate(count("drawArrays") === 0 && count("bufferSubData") === 0, "stamps are queued, nothing drawn before a flush point");
gate(s.wfQueue.n === 80 * 6 * 24, `80 quads (40 clears + 40 meets) in one meet run (${s.wfQueue.n / 144})`);
ctx.nodeGraphWaterfallGlPresent(face, plate);
gate(count("bufferSubData") + count("bufferData") <= 2 && count("drawArrays") === 2, `present flushed: ${count("bufferSubData")} sub-upload(s), ${count("drawArrays")} draws (1 batch + present quad)`);
const firstDraw = log.findIndex(([k]) => k === "drawArrays");
gate(log[firstDraw][1][2] === 80 * 6, "batch draw covers all 480 vertices");

// 2) Bars: fill + stroke per column, source-over, with clears: one run.
ctx.nodeGraphWaterfallGlStampBar(face, 99, 1, { y0: 20, y1: 60 }, null, false, [1, 1, 1], "source-over", 1, true, null);
ctx.nodeGraphWaterfallGlPresent(face, plate);
log.length = 0;
for (let i = 0; i < 30; i += 1) {
  ctx.nodeGraphWaterfallGlClearColumn(face, 100 + i, 1, plate);
  ctx.nodeGraphWaterfallGlStampBar(face, 100 + i, 1, { y0: 20, y1: 60 + i, strokeY0: 20, strokeY1: 60 }, null, false, [200, 100, 50], "source-over", 1, true, { on: true, px: 2, rgb: [10, 20, 30] });
}
gate(s.wfQueue.kind === "bar" && s.wfQueue.n === 90 * 6 * 15, `90 bar quads queued in one bar run (${s.wfQueue.n / 90})`);
// Attributes carry the old uniform values (fill quad of column 0 = quad #1).
const d = s.wfQueue.data;
const v = 90; // second quad (15 floats x 6 vertices), first vertex
const near = (a, b) => Math.abs(a - b) < 1e-5;
gate(near(d[v + 2], 200 / 255) && near(d[v + 3], 100 / 255) && near(d[v + 4], 50 / 255), "colour attribute = rgb / 255 (was uColor)");
gate(near(d[v + 5], 100) && near(d[v + 6], 101), "span attribute = x0..x1 (was uSpan)");
gate(near(d[v + 7], 20) && near(d[v + 9], 60), "edge attribute = top0/top1/bot0/bot1 (was uEdge)");
gate(d[v + 11] === 0 && d[v + 12] === 0 && d[v + 13] === 1 && d[v + 14] === 1, "blend kind / fill mode / stroke px / ink alpha attributes");
const sv = 90 * 2;
gate(d[sv + 12] === 1 && d[sv + 13] === 2 && near(d[sv + 2], 10 / 255), "stroke quad: mode 1, stroke px 2, stroke colour");
gate(d[2] === 0x10 / 255 || near(d[2], 0x10 / 255), "clear quad carries the plate colour");
gate(d[12] === 2, "clear quad uses mode 2 (opaque replace)");
// 3) A blend change flushes the source-over run first (order kept).
ctx.nodeGraphWaterfallGlStampBar(face, 140, 1, { y0: 5, y1: 15 }, null, false, [1, 2, 3], "lighter", 1, true, null);
gate(count("drawArrays") === 1 && s.wfQueue.blend === "lighter" && s.wfQueue.n === 90, "blend change: previous run drawn, new run started");
ctx.nodeGraphWaterfallGlScroll(face, 1, plate);
gate(count("drawArrays") === 3 && s.wfQueue.n === 0, "scroll flushes the pending run before moving the history");
// 4) Shaders read attributes, not per-draw uniforms.
const wf = src("node-graph-module-scope-waterfall-gl.js");
gate(!/uniform vec3 uColor;|uniform vec4 uEdge;|uniform float uFormula;/.test(wf), "bar / meet shaders have no per-draw colour / edge / formula uniforms");
gate(/attribute vec4 aEdge;/.test(wf) && /attribute vec4 aEdgeL;/.test(wf), "bar / meet vertex shaders declare the per-vertex attributes");
// 5) Microtask flush covers a frame that stamps without presenting.
log.length = 0;
ctx.nodeGraphWaterfallGlStampBar(face, 150, 1, { y0: 5, y1: 15 }, null, false, [1, 2, 3], "source-over", 1, true, null);
await new Promise((r) => setTimeout(r, 0));
gate(count("drawArrays") === 1 && s.wfQueue.n === 0, "un-presented stamps are flushed in a microtask");
console.log(failures ? `\n${failures} check(s) FAILED` : "\nwaterfall GL batch smoke passed");
process.exit(failures ? 1 : 0);
