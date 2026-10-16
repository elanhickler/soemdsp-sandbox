// Smoke: every waterfall Blend mode stays itself on the GPU.
// source-over / lighter / meet / screen / multiply use blend equations;
// difference / exclusion / xor copy the history (ping-pong write target) and
// do the math in the bar shader. Brightness is ink alpha, not a darker colour.
// Overlapping stamps of a destination-read mode flush so each sees the last.
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
    if (k === "getUniformLocation") return (_p, n) => ({ u: n });
    if (k.startsWith("create")) return () => ({ kind: k });
    return (...a) => { log.push([k, a]); };
  },
});
const ctx = {
  console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Promise, Set, Map,
  queueMicrotask: (fn) => Promise.resolve().then(fn),
  TraceMeetGlsl: { MEET_SPAN_GLSL: "", MEET_GLSL: "" },
};
ctx.nodeGraphSharedGlDevice = () => ({ gl, canvas: { width: 4096, height: 4096 } });
ctx.nodeGraphDisplayCanvasPresentContext = (c) => c.getContext("2d");
ctx.nodeGraphDisplayCanvasBlit = () => true;
vm.createContext(ctx);
const glSrc = src("node-graph-module-scope-waterfall-gl.js");
vm.runInContext(glSrc, ctx);
const face = { width: 64, height: 32, style: {}, getContext: () => ({}) };
const plate = "#102030";
gate(ctx.nodeGraphWaterfallGlReset(face, plate) === true, "session on the mock shared device");
const s = face._wfGlSession;

const expect = {
  "source-over": { kind: 0, func: ["ONE", "ONE_MINUS_SRC_ALPHA"] },
  lighter: { kind: 1, func: ["ONE", "ONE"] },
  meet: { kind: 1, func: ["ONE", "ONE"] },
  screen: { kind: 1, func: ["ONE_MINUS_DST_COLOR", "ONE"] },
  multiply: { kind: 2, func: ["DST_COLOR", "ZERO"] },
  difference: { kind: 3, dst: true },
  exclusion: { kind: 4, dst: true },
  xor: { kind: 5, dst: true },
};
for (const [mode, e] of Object.entries(expect)) {
  log.length = 0;
  s.wfDstCopies = 0;
  ctx.nodeGraphWaterfallGlStampBar(face, 4, 2, { y0: 4, y1: 20 }, null, false, [200, 100, 50, 0.4], mode, 1, true, null);
  const q = s.wfQueue;
  const F = 15;
  gate(q.data[11] === e.kind, `${mode}: bar blend kind ${e.kind} (got ${q.data[11]})`);
  gate(Math.abs(q.data[14] - 0.4) < 1e-6, `${mode}: Brightness travels as ink alpha 0.4`);
  gate(Math.abs(q.data[2] - 200 / 255) < 1e-6, `${mode}: colour is not darkened by Brightness`);
  ctx.nodeGraphWaterfallGlFlush(s);
  const funcs = log.filter(([k]) => k === "blendFunc").map(([, a]) => a.join(","));
  const disabled = log.some(([k, a]) => k === "disable" && a[0] === "BLEND");
  if (e.dst) {
    gate(s.wfDstCopies === 1, `${mode}: history copied once for the destination read`);
    gate(disabled && !funcs.length, `${mode}: blending off, math in the shader`);
    gate(log.some(([k, a]) => k === "bindTexture" && a[1] === s.write.tex), `${mode}: shader samples the write (copy) texture`);
  } else {
    gate(s.wfDstCopies === 0, `${mode}: no destination copy`);
    gate(funcs.includes(e.func.join(",")), `${mode}: blendFunc ${e.func.join(",")} (got ${funcs.join(" | ")})`);
  }
  void F;
}

// Overlap: second difference stamp over the first must flush in between.
log.length = 0;
s.wfDstCopies = 0;
ctx.nodeGraphWaterfallGlStampBar(face, 4, 2, { y0: 4, y1: 20 }, null, false, [255, 0, 0, 1], "difference", 1, true, null);
ctx.nodeGraphWaterfallGlStampBar(face, 10, 2, { y0: 4, y1: 20 }, null, false, [0, 255, 0, 1], "difference", 1, true, null);
gate(s.wfDstCopies === 0, "non-overlapping difference stamps share one batch");
ctx.nodeGraphWaterfallGlStampBar(face, 4, 2, { y0: 8, y1: 12 }, null, false, [0, 0, 255, 1], "difference", 1, true, null);
gate(s.wfDstCopies === 1, "an overlapping difference stamp flushes first");
ctx.nodeGraphWaterfallGlFlush(s);
gate(s.wfDstCopies === 2, "then its own batch reads the updated history");

// Shader maths, evaluated here with the same formulas as the GLSL.
const bar = /const NODE_GRAPH_WF_GL_BAR = `([\s\S]*?)`;/.exec(glSrc)[1];
for (const frag of [
  "abs(d - uColor)",
  "d + uColor - 2.0 * d * uColor",
  "r = uPlate",
  "mix(d, r, k)",
  "float k = cover * inkA",
  "vec4(uColor * k, k)",
  "mix(vec3(1.0), uColor, k)",
]) gate(bar.includes(frag), `bar shader: ${frag}`);
const canvasRef = {
  difference: (d, c) => Math.abs(d - c),
  exclusion: (d, c) => d + c - 2 * d * c,
};
const shader = {
  difference: (d, c, k) => d + (Math.abs(d - c) - d) * k,
  exclusion: (d, c, k) => d + (d + c - 2 * d * c - d) * k,
};
for (const m of Object.keys(shader)) {
  let worst = 0;
  for (let d = 0; d <= 1; d += 0.125) for (let c = 0; c <= 1; c += 0.125) for (const a of [0.25, 1]) {
    // Canvas 2D separable blend with source alpha a over an opaque dest.
    const ref = (1 - a) * d + a * canvasRef[m](d, c);
    worst = Math.max(worst, Math.abs(ref - shader[m](d, c, a)));
  }
  gate(worst < 1e-9, `${m}: shader matches Canvas 2D compositing (max err ${worst})`);
}

if (failures) {
  console.error(`smoke_waterfall_gl_blend_modes: ${failures} failure(s)`);
  process.exit(1);
}
console.log("smoke_waterfall_gl_blend_modes ok");
