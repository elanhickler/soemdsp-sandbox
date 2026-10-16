// Smoke: Value LED / LCD faces draw on the shared GL device. The burn plate
// is two ping-pong textures (per frame: one fade pass, no upload); deposits
// are GL glyph quads drawn straight into the plate. Each face draws into its
// own GL target (rects + atlas glyphs batched, premultiplied source-over),
// then presents through nodeGraphDisplayCanvasBlit. Fade maths mirrors 2D
// destination-out (round(in * (255 - round(erase * 255)) / 255), measured in Chrome).
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
// Face pipeline: rects + glyphs batch into one draw, present blits once.
const bakes = [];
ctx.nodeGraphDisplayCanvasBakeGlyphAtlas = (o) => {
  bakes.push(o);
  const c = mkCanvas((o.cols | 0) * (o.cellW | 0), Math.ceil(o.glyphs.length / o.cols) * (o.cellH | 0));
  if (o.metrics) c.glyphMetrics = o.glyphs.map(() => ({ width: 30, ascent: 30, descent: 2 }));
  return c;
};
const blits = [];
ctx.nodeGraphDisplayCanvasPresentContext = (c) => ({ canvas: c });
ctx.nodeGraphDisplayCanvasBlit = (...a) => { blits.push(a); return true; };
ctx.clampNodeSliderValue = (v, a, b) => Math.max(a, Math.min(b, v));
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
log.length = 0;
const pen = ctx.nodeGraphNumberReadoutGlBeginFace(host);
gate(Boolean(pen && host._numberReadoutGlFace && pen.target === host._numberReadoutGlFace.target), "face: GL target on the shared device");
ctx.nodeGraphNumberReadoutGlPenRect(pen, 0, 0, 240, 90, [10, 20, 30], 1);
ctx.nodeGraphNumberReadoutDrawDigits(pen, { text: "-12.5", centerX: 120, centerY: 45, fontFamily: "x", fontSize: 40, cellW: 26, rgb: [255, 200, 0], alpha: 1 });
gate(pen.verts.length === 9 * 6 * 6, `face: 1 rect + 5 glyphs queued (${pen.verts.length / 54} quads; "." zero advance drawn)`);
ctx.nodeGraphNumberReadoutGlEndFace(host, pen);
gate(count("drawArrays", (a) => a[2] === 36) === 1, "face: one batched draw for rect + glyphs");
gate(blits.length === 1 && blits[0][4] === 240 && blits[0][5] === 90, "face: one present blit at face size");
gate(bakes.some((o) => o.transparent && o.fontPx === 40 && o.glyphs.includes("8")), "glyphs come from a transparent atlas baked at the face font size");
const nBakes = bakes.length;
const pen2 = ctx.nodeGraphNumberReadoutGlBeginFace(host);
ctx.nodeGraphNumberReadoutDrawDigits(pen2, { text: "-13.7", centerX: 120, centerY: 45, fontFamily: "x", fontSize: 40, cellW: 26, rgb: [255, 200, 0], alpha: 1 });
gate(bakes.length === nBakes, "atlas reused for the next value (no rebake per frame)");
ctx.nodeGraphNumberReadoutDrawDigits(pen2, { text: "C#3", centerX: 120, centerY: 45, fontFamily: "x", fontSize: 40, cellW: 26, rgb: [255, 200, 0], alpha: 1 });
gate(bakes.length === nBakes + 1 && bakes.at(-1).glyphs.includes("C") && bakes.at(-1).glyphs.includes("1"), "new characters rebake the atlas with the union");
// LCD inner shadow: one analytic full-target pass.
log.length = 0;
ctx.nodeGraphNumberReadoutGlPenLcdInnerShadow(pen2, 0, 0, 240, 90, 0.5, 0.2, 0.3, 0.1);
const sig = log.filter(([k, a]) => k === "uniform1f" && a[0]?.n === "uSigma").map(([, a]) => a[1]);
gate(sig.length === 1 && sig[0] > 0.35, `soft shadow: Gaussian sigma ${sig[0]?.toFixed?.(2)}px`);
log.length = 0;
ctx.nodeGraphNumberReadoutGlPenLcdInnerShadow(pen2, 0, 0, 240, 90, 0.5, 1, 0, 0);
gate(log.some(([k, a]) => k === "uniform1f" && a[0]?.n === "uSigma" && a[1] === 0), "hard shadow: box coverage (sigma 0)");
const shadowFs = programs.find(([k]) => k === "number-readout-lcd-shadow")?.[1] || "";
gate(/erfApprox/.test(shadowFs) && /uClip/.test(shadowFs), "shadow shader: erf blur, clipped to the plate");
// Deposits: glyphs into the GPU plate FBO, no upload.
log.length = 0;
const dpen = ctx.nodeGraphNumberReadoutGlPen(st.gl, st.read, st.w, st.h);
ctx.nodeGraphNumberReadoutDrawDigits(dpen, { text: "12.5", centerX: 120, centerY: 45, fontFamily: "x", fontSize: 40, cellW: 26, rgb: [255, 255, 255], alpha: 0.8, energy: true });
ctx.nodeGraphNumberReadoutGlPenFlush(dpen);
gate(log.some(([k, a]) => k === "bindFramebuffer" && a[1] === st.read.fbo) && count("texSubImage2D") === 0, "deposit: drawn into the GPU plate, nothing uploaded");
// Tint: samples the GPU plate into the face target.
log.length = 0;
const pen3 = ctx.nodeGraphNumberReadoutGlBeginFace(host);
ctx.nodeGraphNumberReadoutPresentBurnPlate(pen3, host, plate, [{ t: 0, color: "#000000" }, { t: 1, color: "#ffffff" }], "#ffffff");
gate(count("texImage2D", (a) => a.length === 6) === 0, "tint: no texImage2D of a 2D plate");
gate(log.some(([k, a]) => k === "bindTexture" && a[1] === st.read.tex) && log.some(([k, a]) => k === "bindFramebuffer" && a[1] === pen3.target.fbo), "tint: GPU plate sampled into the face target");
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
{
  const twoD = [...nr.matchAll(/getContext\("2d"|getContext\('2d'/g)].length;
  gate(twoD === 0 && !/DrawLcdInnerShadow/.test(nr), `no 2D context left; LCD shadow is the GL pen (${twoD})`);
  gate(!/fillText|measureText|drawImage\(/.test(nr), "no fillText / measureText / drawImage in the face path");
  gate(!/LcdCompositeHang|DrawInnerShadow\(|GlPlateStamp|StampTrack/.test(nr), "unused 2D helpers deleted");
}
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
  gate(ctx.nodeGraphNumberReadoutGlBeginFace(h2) === null, "no GL device: no face pen");
  gate(failed.length === 1 && log.length === 0 && !h2._ctx, `no GL device: nodeGraphDisplayGlFailed (${failed.join("; ")}), no 2D drawing`);
  ctx.nodeGraphSharedGlDevice = saveDev;
}
// Layout: measured from atlas metrics (no 2D context), memoised.
const nBake2 = bakes.length;
const opts = { hasUnit: false, padding01: 0, faceStyle: "led", pixelRatio: 1, zoom: 1, fitText: "12.5" };
const l1 = ctx.nodeGraphNumberReadoutComputeLayout(null, "12.5", "y", 200, 80, opts);
const bake1 = bakes.length;
const l2 = ctx.nodeGraphNumberReadoutComputeLayout(null, "13.7", "y", 200, 80, opts);
gate(l1.fontSize > 0 && bake1 > nBake2 && bakes.length === bake1 && JSON.stringify(l1) === JSON.stringify(l2), `layout: metrics baked once, layout memoised (fontSize ${l1.fontSize.toFixed(1)})`);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nnumber readout GPU plate smoke passed");
process.exit(failures ? 1 : 0);
