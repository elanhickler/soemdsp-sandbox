// Smoke: Value LED burn plate lives on the GPU (ping-pong textures on the
// shared device). Per frame: one fade pass, no plate upload. On a value
// change: only the stamped digit rect goes up (texSubImage2D), then the 2D
// scratch rect is cleared. Present binds the GPU plate instead of
// texImage2D-ing the 2D canvas. Fade maths mirrors 2D destination-out
// (round(in * (255 - round(erase * 255)) / 255), measured in Chrome).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const log = [];
const gl = new Proxy({}, {
  get: (_t, k) => {
    if (typeof k !== "string") return undefined;
    if (/^[A-Z_0-9]+$/.test(k)) return k;
    if (k === "isContextLost") return () => false;
    if (k === "checkFramebufferStatus") return () => "FRAMEBUFFER_COMPLETE";
    if (k === "getAttribLocation") return () => 0;
    if (k === "getUniformLocation") return (_p, n) => ({ n });
    if (k.startsWith("create")) return () => ({ kind: k });
    return (...a) => { log.push([k, a]); };
  },
});
const ctx2d = () => {
  const calls = [];
  return { calls, setTransform() {}, clearRect(...a) { calls.push(["clearRect", ...a]); }, drawImage(...a) { calls.push(["drawImage", ...a]); }, save() {}, restore() {}, fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }) };
};
const mkCanvas = (w = 0, h = 0) => { const c = { width: w, height: h, style: {}, _ctx: null }; c.getContext = () => (c._ctx ||= ctx2d()); return c; };
const programs = [];
const ctx = {
  console, Math, Number, Float32Array, Uint8Array, Uint8ClampedArray, Object, String, Array, JSON, Boolean, Map, WeakMap, Set, Promise, RegExp, Error,
  document: { createElement: () => mkCanvas(), fonts: null },
  window: {},
  SoemGl: { program: (_g, key, _vs, fs) => { programs.push([key, fs]); return { key }; }, drawQuad: () => { log.push(["drawArrays", ["quad"]]); }, GLSL_FULLSCREEN_VS: "" },
};
ctx.nodeGraphSharedGlDevice = () => ({ gl, canvas: { width: 4096, height: 4096 } });
ctx.nodeGraphSharedGlBindPresent = () => {};
ctx.nodeGraphSharedGlEndPresent = () => {};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src("node-graph-module-scope-number-readout.js"), ctx);
const count = (name, pred = () => true) => log.filter(([k, a]) => k === name && pred(a)).length;

const host = mkCanvas(240, 90);
const plate = mkCanvas(240, 90);
const st = ctx.nodeGraphNumberReadoutGlPlateEnsure(host, plate);
gate(Boolean(st && st.read && st.write && st.read !== st.write), "GPU plate: two ping-pong targets on the shared device");
gate(ctx.nodeGraphNumberReadoutGlPlateEnsure(host, plate) === st, "same size: same plate (no re-create per frame)");
log.length = 0;
for (let f = 0; f < 60; f += 1) ctx.nodeGraphNumberReadoutGlPlateFade(st, 0.2);
gate(count("texImage2D") === 0 && count("texSubImage2D") === 0, "60 fade frames upload nothing");
gate(count("drawArrays") === 60, "one full-plate pass per fade frame");
const k255 = log.filter(([k, a]) => k === "uniform1f" && a[0]?.n === "uKeep255").map(([, a]) => a[1]);
gate(k255.length === 60 && k255.every((v) => v === 255 - 51), "fade keep = 255 - round(0.2 * 255) = 204 (2D destination-out maths)");
const plateFs = programs.find(([k]) => k === "number-readout-burn-plate")?.[1] || "";
gate(/floor\(d \* uKeep255 \/ 255\.0 \+ 0\.5\) \/ 255\.0/.test(plateFs) && /floor\(t \* 255\.0 \+ 0\.5\)/.test(plateFs), "shader rounds like the 8-bit 2D path");
// Stamp: only the tracked rect goes up, then the scratch rect is cleared.
log.length = 0;
ctx.nodeGraphNumberReadoutGlPlateStamp(st, plate, 100.4, 20.2, 140.6, 70.1);
const subs = log.filter(([k]) => k === "texSubImage2D");
gate(subs.length === 1 && subs[0][1][2] === 100 && subs[0][1][3] === 20, "stamp: one texSubImage2D at the rect origin");
gate(st.stampCanvas.width === 41 && st.stampCanvas.height === 51, `stamp upload is the digit rect only (${st.stampCanvas.width}x${st.stampCanvas.height}, not 240x90)`);
gate(count("texImage2D", (a) => a.length === 6) === 0, "no full canvas texImage2D on stamp");
gate(plate._ctx.calls.some(([k, x, y, w, h]) => k === "clearRect" && x === 100 && y === 20 && w === 41 && h === 51), "2D scratch rect cleared after the move");
gate(count("blendFuncSeparate") === 1 && count("scissor") === 1, "stamp blends source-over inside a scissor");
// Track bounds from the digit draw.
const t = vm.runInContext("nodeGraphNumberReadoutStampTrack", ctx);
const sc = plate.getContext("2d");
t.ctx = sc; t.any = false;
ctx.nodeGraphNumberReadoutDrawDigits(sc, { text: "12.5", centerX: 120, centerY: 45, fontFamily: "x", fontSize: 40, cellW: 26, rgb: [255, 255, 255], alpha: 0.8, energy: true });
t.ctx = null;
gate(t.any && t.x0 < 120 - 26 && t.x1 > 120 + 26 && t.y0 < 45 - 20 && t.y1 > 45 + 20, `digit draw tracked (${Math.round(t.x0)},${Math.round(t.y0)})-(${Math.round(t.x1)},${Math.round(t.y1)})`);
// Present binds the GPU texture; no plate upload.
log.length = 0;
const dest = { canvas: host, save() {}, restore() {}, drawImage() {} };
ctx.nodeGraphNumberReadoutPresentBurnPlate(dest, plate, [{ t: 0, color: "#000000" }, { t: 1, color: "#ffffff" }], "#ffffff");
gate(count("texImage2D", (a) => a.length === 6) === 0, "present: no texImage2D of the 2D plate");
gate(log.some(([k, a]) => k === "bindTexture" && a[1] === st.read.tex), "present: samples the GPU plate texture");
// Resize: scale-preserve on the GPU.
const plate2 = mkCanvas(300, 100);
log.length = 0;
const st2 = ctx.nodeGraphNumberReadoutGlPlateEnsure(host, plate2);
gate(st2 && st2 !== st && st2.w === 300 && count("drawArrays") >= 1, "resize: new targets, old deposits scaled across in one pass");
// Clear wipes both targets.
log.length = 0;
host._numberReadoutBurnPlate = plate2;
ctx.nodeGraphNumberReadoutClearBurnPlate(host);
gate(count("clear") === 2, "ClearBurnPlate clears both GPU targets");
// Draw path wiring.
const nr = src("node-graph-module-scope-number-readout.js");
gate(/nodeGraphNumberReadoutGlPlateFade\(plateGl, Number\(erase\.toFixed\(4\)\)\)/.test(nr), "draw path fades on the GPU when the plate is up");
gate(/nodeGraphNumberReadoutGlPlateStamp\(plateGl, burnPlate, track\.x0, track\.y0, track\.x1, track\.y1\)/.test(nr), "draw path moves stamps to the GPU");
gate(!/UNSIGNED_BYTE, burnPlate\)/.test(nr) && /gl\.bindTexture\(gl\.TEXTURE_2D, plateTex\);/.test(nr), "present binds the GPU plate; the 2D plate is never uploaded");
// No shared device: black + nodeGraphDisplayGlFailed, no 2D plate work.
{
  const failed = [];
  ctx.nodeGraphDisplayGlFailed = (c, why) => failed.push(why);
  const saveDev = ctx.nodeGraphSharedGlDevice;
  ctx.nodeGraphSharedGlDevice = () => null;
  const h2 = mkCanvas(240, 90);
  const p2 = mkCanvas(240, 90);
  gate(ctx.nodeGraphNumberReadoutGlPlateEnsure(h2, p2) === null, "no GL device: no GPU plate");
  log.length = 0;
  ctx.nodeGraphNumberReadoutPresentBurnPlate({ canvas: h2, save() {}, restore() {}, drawImage() {} }, p2, [{ t: 0, color: "#000000" }], "#ffffff");
  gate(failed.length === 1 && log.length === 0, `no GL device: present reports via nodeGraphDisplayGlFailed (${failed.join("; ")}) and draws nothing`);
  ctx.nodeGraphSharedGlDevice = saveDev;
}
// Layout memo: second identical layout does not touch context.font.
let fontSets = 0;
const lctx = { set font(_v) { fontSets += 1; }, get font() { return ""; }, measureText: () => ({ width: 30, actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 2 }) };
ctx.clampNodeSliderValue = (v, a, b) => Math.max(a, Math.min(b, v));
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const opts = { hasUnit: false, padding01: 0, faceStyle: "led", pixelRatio: 1, zoom: 1, fitText: "12.5" };
const l1 = ctx.nodeGraphNumberReadoutComputeLayout(lctx, "12.5", "x", 200, 80, opts);
const sets1 = fontSets;
const l2 = ctx.nodeGraphNumberReadoutComputeLayout(lctx, "13.7", "x", 200, 80, opts);
gate(sets1 > 0 && fontSets === sets1 && JSON.stringify(l1) === JSON.stringify(l2), `layout memo: same cells/face reuse the layout (font sets ${sets1} -> ${fontSets})`);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nnumber readout GPU plate smoke passed");
process.exit(failures ? 1 : 0);
