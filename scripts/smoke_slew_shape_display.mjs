// Smoke: Up/Down Slew shape face (public/modules/slewLimiter/slew-shape-display.js).
// Shape law twin of slew_limiter.cpp applyShape; WebGL2-only drawing via a fake
// shared picture device + the real gl-line-renderer.js; no GL -> black square.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const glLog = { clear: null, verts: [], draws: 0 };
const fakeGl = new Proxy({
  isContextLost: () => false,
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getAttribLocation: (_p, n) => ["position", "local", "segLen", "halfPx", "feather", "colour"].indexOf(n),
  clearColor: (r, g, b) => { glLog.clear = [r, g, b].map((v) => Math.round(v * 255)).join(","); },
  bufferData: (_t, d) => { glLog.verts = Array.from(d); },
  drawArrays: () => { glLog.draws += 1; },
}, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && k === k.toUpperCase() ? 1 : () => ({}))) });
let glOn = true;
const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON };
ctx.nodeGraphPictureDevice = () => (glOn ? { gl: fakeGl, canvas: { height: 4096 } } : null);
ctx.nodeGraphSharedGlBlitTo2D = () => true;
vm.createContext(ctx);
for (const rel of ["lib/visual/gl-line-renderer.js", "modules/slewLimiter/slew-shape-display.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "public", rel), "utf8"), ctx);
}
const apply = ctx.nodeGraphSlewShapeApply;
const k = 3.5;
gate(apply(0.3, 0) === 0.3, "Lin: x");
gate(Math.abs(apply(0.3, 1) - (1 - Math.pow(0.7, k))) < 1e-12, "Log: 1-(1-x)^3.5 (fast start)");
gate(Math.abs(apply(0.3, 2) - Math.pow(0.3, k)) < 1e-12, "Exp: x^3.5 (slow start)");
gate(Math.abs(apply(0.25, 3) - (0.5 - 0.5 * Math.cos(Math.PI * 0.25))) < 1e-12, "Smooth: 0.5-0.5cos(pi x)");
for (let s = 0; s < 4; s += 1) gate(apply(0, s) === 0 && Math.abs(apply(1, s) - 1) < 1e-12, `shape ${s}: 0 -> 1 endpoints`);

const W = 200; const H = 60;
const geo = ctx.nodeGraphSlewShapeGeometry(W, H, 1, 2, 1);
const xs = (pts) => pts.filter((_, i) => i % 2 === 0);
const ys = (pts) => pts.filter((_, i) => i % 2 === 1);
gate(Math.max(...xs(geo.up)) <= W / 2 && Math.min(...xs(geo.down)) >= W / 2, "Up in left half, Down in right half");
gate(geo.up[geo.up.length - 2] === geo.down[0] && geo.up[geo.up.length - 1] === geo.down[1] && geo.down[0] === W / 2,
  "Up end meets Down start at the middle peak (same point, no gap)");
gate(!("divider" in geo), "no center divider");
const uy = ys(geo.up); const dy = ys(geo.down);
gate(uy[0] > uy[uy.length - 1] && Math.abs(uy[0] - dy[dy.length - 1]) < 1e-9 && Math.abs(uy[uy.length - 1] - dy[0]) < 1e-9,
  "Up rises bottom->top, Down falls top->bottom on the same normalized axis");
const mid = (a) => a[Math.floor(a.length / 2)];
const bottom = uy[0]; const span = uy[0] - uy[uy.length - 1];
gate(Math.abs((bottom - mid(uy)) / span - apply(0.5, 1)) < 0.02, "Up curve follows Up Shape (Log)");
gate(Math.abs((bottom - mid(dy)) / span - (1 - apply(0.5, 2))) < 0.02, "Down curve follows Down Shape (Exp)");

const fills = [];
const canvas = { width: W, height: H, getContext: () => ({ setTransform() {}, fillRect(...a) { fills.push([this.fillStyle, ...a]); } }) };
gate(ctx.nodeGraphSlewShapePresent(canvas, geo) === true && glLog.draws === 1 && fills.length === 0, "GL: one draw, no 2D drawing");
gate(glLog.clear === "2,6,9", `GL: dark plate clear (${glLog.clear})`);
const cols = new Set();
// Vertex layout (gl-line-renderer FLOATS = 12): pos2, local2, len1, half1, feather1, caps1, rgba4.
for (let i = 0; i < glLog.verts.length; i += 12) cols.add(glLog.verts.slice(i + 8, i + 11).map((v) => Math.round(v * 255)).join(","));
gate(cols.has("127,199,217") && cols.has("255,130,110"), "GL: Up and Down curves drawn in their colours");
glOn = false;
gate(ctx.nodeGraphSlewShapePresent(canvas, geo) === false && fills.length === 1 && fills[0][0] === "#000", "No GL: plain black square");
console.log(failures ? `FAILED ${failures}` : "smoke_slew_shape_display ok");
if (failures) process.exit(1);
