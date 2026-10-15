// Smoke: Phase 3 Canvas2D -> shared WebGL2 ports (docs/WEBGL_DISPLAY_PLAN.md).
// Wall Delay room, Matrix Display, RGB Picture draw through gl-line-renderer.js
// on a fake shared picture device; Ellipsoid goes through cycle-line-gl.js
// (presenter stubbed: orbit tessellated once, dot rebuilt per frame).
// Gates: GL draw happens, no 2D drawing on the face canvas, no canvas sizing
// in module code, no GL -> plain black fill.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const glLog = { draws: 0, clear: null, tex: 0 };
const fakeGl = new Proxy({
  isContextLost: () => false,
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getAttribLocation: (_p, n) => ["position", "local", "segLen", "halfPx", "feather", "colour"].indexOf(n),
  clearColor: (r, g, b, a) => { glLog.clear = [r, g, b, a].map((v) => Math.round(v * 255)).join(","); },
  drawArrays: () => { glLog.draws += 1; },
  texImage2D: () => { glLog.tex += 1; },
}, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && k === k.toUpperCase() ? 1 : () => ({}))) });
let glOn = true;

function faceCanvas() {
  const log = { twoD: 0, fills: [] };
  const ctx2d = {
    setTransform() {}, clearRect() {}, drawImage() { log.twoD += 1; },
    fillRect(...a) { log.fills.push([this.fillStyle, ...a]); },
    fillText() { log.twoD += 1; }, stroke() { log.twoD += 1; }, fill() { log.twoD += 1; }, arc() {}, beginPath() {}, moveTo() {}, lineTo() {},
  };
  const canvas = { width: 0, height: 0, style: {}, className: "", classList: { add() {} }, getContext: () => ctx2d, log };
  return canvas;
}
const atlasCanvas = () => ({ width: 0, height: 0, getContext: () => ({ measureText: (ch) => ({ width: 7 }), fillText() {}, clearRect() {} }) });

const params = { roomPreset: 1, roomSeed: 3, roomWidth: 1, roomHeight: 0.8, roomScale: 4, roomRoundness: 0.3, earDistance: 18 };
const ctx = {
  console, Math, Number, Float32Array, Uint8Array, Object, String, Array, JSON, Map, Set, parseInt, parseFloat, Date,
  performance: { now: () => 1000 },
  requestAnimationFrame: () => 0,
  document: { createElement: (t) => (t === "canvas" ? atlasCanvas() : { className: "", classList: { add() {} }, dataset: {}, append() {} }) },
  nodeGraphPictureDevice: () => (glOn ? { gl: fakeGl, canvas: { height: 4096 } } : null),
  nodeGraphSharedGlBlitTo2D: () => true,
  nodeGraphFiniteNumber: (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb),
  clampNodeSliderValue: (v, a, b) => Math.max(a, Math.min(b, v)),
  nodeGraphPatchNode: (id) => ({ id, type: "wallDelay", params }),
  nodeGraphMvp: { zoom: 1 },
};
ctx.nodeGraphSizeDisplayCanvas = (_s, canvas) => { canvas.width = 400; canvas.height = 240; return { width: 400, height: 240, cssWidth: 200, cssHeight: 120, pixelRatio: 2 }; };
vm.createContext(ctx);
const load = (rel) => vm.runInContext(fs.readFileSync(path.join(root, "public", rel), "utf8"), ctx);
load("lib/visual/display-canvas.js");
load("lib/visual/gl-line-renderer.js");

const moduleSrc = (rel) => fs.readFileSync(path.join(root, "public", rel), "utf8");
for (const rel of [
  "modules/wallDelay/wall-delay-room-display.js",
  "modules/matrixDisplay/matrix-display-display.js",
  "modules/ellipsoid/ellipsoid-display.js",
  "modules/rgbPicture/rgb-picture-display.js",
]) {
  const src = moduleSrc(rel);
  gate(!/getContext\(|devicePixelRatio|canvas\.(width|height)\s*=[^=]|createElement\(\s*["']canvas/.test(src), `${rel}: no 2D context / canvas sizing / dpr`);
}

// ---- Wall Delay -----------------------------------------------------------
load("modules/wallDelay/wall-delay-room-display.js");
{
  const canvas = faceCanvas();
  const section = { dataset: { node: "wall-1" }, querySelector: () => canvas };
  glLog.draws = 0;
  ctx.drawNodeGraphWallRoomDisplay(section);
  gate(glLog.draws > 0 && canvas.log.twoD === 0, `Wall Delay: GL draw (${glLog.draws}), no 2D strokes`);
  gate(glLog.clear === "2,6,9,224", `Wall Delay: plate rgba(2,6,9,0.88) (got ${glLog.clear})`);
  glOn = false;
  const c2 = faceCanvas();
  ctx.drawNodeGraphWallRoomDisplay({ dataset: { node: "wall-1" }, querySelector: () => c2 });
  gate(c2.log.fills.length === 1 && c2.log.fills[0][0] === "#000", "Wall Delay: no GL -> black square");
  glOn = true;
}

// ---- Matrix Display ---------------------------------------------------------
ctx.MATRIX_DISPLAY_MAX_AGE = 32;
ctx.matrixDisplayGlyphForAge = (_r, age) => (age > 2 ? "#" : " ");
ctx.matrixDisplayColorForAge = (age) => `rgb(0,${Math.min(255, age * 8)},255)`;
load("modules/matrixDisplay/matrix-display-display.js");
{
  const canvas = faceCanvas();
  canvas.parentElement = {};
  const ages = new Float32Array(8 * 4);
  for (let i = 0; i < ages.length; i += 1) ages[i] = i;
  glLog.draws = 0;
  ctx.matrixDisplayDrawFace(canvas, { columns: 8, rows: 4, ages }, "#", { brightness: 1, blackFloor: 0 });
  gate(glLog.draws > 0 && canvas.log.twoD === 0, `Matrix: glyphs drawn on GL (${glLog.draws} draws), no 2D fillText`);
  gate(glLog.clear === "1,1,4,255", `Matrix: plate #010104 (got ${glLog.clear})`);
  const cacheSize = vm.runInContext("matrixDisplayGlColourCache.size", ctx);
  ctx.matrixDisplayDrawFace(canvas, { columns: 8, rows: 4, ages }, "#", { brightness: 1, blackFloor: 0 });
  gate(vm.runInContext("matrixDisplayGlColourCache.size", ctx) === cacheSize && cacheSize > 0, "Matrix: colour cache reused across frames (no reparse)");
  glLog.draws = 0;
  ctx.matrixDisplayDrawFace(canvas, { columns: 8, rows: 4, ages }, "#", { brightness: 0 });
  gate(glLog.clear === "1,1,4,255", "Matrix: brightness 0 = plate only");
}

// ---- RGB Picture -------------------------------------------------------------
ctx.nodeGraphRgbPictureSettingsForNode = undefined;
load("modules/rgbPicture/rgb-picture-display.js");
{
  const canvas = faceCanvas();
  const face = { dataset: {}, classList: { toggle() {} } };
  glLog.draws = 0;
  ctx.paintNodeGraphRgbPictureFace(canvas, face, "pic-1");
  gate(glLog.draws > 0 && canvas.log.twoD === 0, "RGB Picture: empty-plate hint drawn on GL");
  // Loaded image: one texture upload, then the static face skips redraws.
  face._rgbPictureImage = { complete: true, naturalWidth: 64, naturalHeight: 32, src: "data:x", dataset: { rgbPictureUrl: "data:x" }, removeAttribute() {} };
  ctx.nodeGraphRgbPictureSettingsForNode = () => ({ background: "#102030", dataUrl: "data:x" });
  glLog.tex = 0; glLog.draws = 0;
  ctx.paintNodeGraphRgbPictureFace(canvas, face, "pic-1");
  const firstTex = glLog.tex;
  const firstDraws = glLog.draws;
  ctx.paintNodeGraphRgbPictureFace(canvas, face, "pic-1");
  gate(firstTex >= 1 && firstDraws > 0, `RGB Picture: image uploaded and drawn (${firstTex} uploads)`);
  gate(glLog.tex === firstTex && glLog.draws === firstDraws, "RGB Picture: unchanged picture skips redraw/upload");
  gate(glLog.clear === "16,32,48,255", `RGB Picture: background colour (got ${glLog.clear})`);
}

// ---- Ellipsoid (cycle-line-gl presenter) -------------------------------------
{
  const presents = [];
  ctx.nodeGraphCycleLineGlMetrics = (_s, canvas) => { canvas.width = 200; canvas.height = 200; canvas.__cycleLineGl = canvas.__cycleLineGl || { waveKey: "" }; return { cssWidth: 100, cssHeight: 100, pixelRatio: 2, width: 200, height: 200 }; };
  ctx.nodeGraphCycleLineGlPresent = (canvas, frame) => {
    presents.push({ lines: frame.lines.length, pts: frame.lines[0]?.points.length || 0, dots: frame.dots.length, bg: frame.background });
    canvas.__cycleLineGl.waveKey = `${frame.waveKey}|${canvas.width}x${canvas.height}`;
    return true;
  };
  ctx.ensureFaceMetrics = () => ({ cssW: 100, cssH: 100, dpr: 2 });
  ctx.nodeGraphPatchNode = (id) => ({ id, type: "ellipsoid", params: { morph: 0.5 }, traceDisplaySettings: {} });
  ctx.nodeGraphEllipsoidSineToSquareVector = () => ({ x: 0, y: 0 });
  load("modules/ellipsoid/ellipsoid-display.js");
  ctx.nodeGraphRoundShapeFaceLook = () => ({ strokeColor: "#78dcc8", background: "#020609", dotColor: "#ffffff", lineThickness: 2, dotThickness: 5, lineBlur: 0, pixelDensity: 1 });
  ctx.nodeGraphRoundShapeLivePlaying = () => true;
  ctx.nodeGraphRoundShapeLiveCursor = () => ({ x: 0.5, y: 0.25 });
  ctx.nodeGraphRoundShapeEllipsoidPoint = (p) => ({ x: Math.cos(p * Math.PI * 2), y: Math.sin(p * Math.PI * 2) });
  const canvas = faceCanvas();
  const section = { dataset: { node: "ell-1" }, querySelector: () => canvas, closest: () => null };
  ctx.drawNodeGraphRoundShapeDisplayInner(section);
  ctx.drawNodeGraphRoundShapeDisplayInner(section);
  gate(presents.length === 2, `Ellipsoid: presented each frame (${presents.length})`);
  gate(presents[0]?.lines === 1 && presents[0]?.pts === 257, `Ellipsoid: orbit closed polyline on first frame (${presents[0]?.pts} pts)`);
  gate(presents[1]?.lines === 0 && presents[1]?.dots === 1, "Ellipsoid: orbit cached, only the phase dot per frame");
  gate(presents[0]?.bg === "#020609" && canvas.log.twoD === 0, "Ellipsoid: plate colour, no 2D drawing");
}

// ---- Matrix: all glyphs in one text draw (batched atlas run) ----------------
{
  const canvas = faceCanvas();
  canvas.parentElement = {};
  const ages = new Float32Array(8 * 4);
  for (let i = 0; i < ages.length; i += 1) ages[i] = i;
  glLog.draws = 0;
  ctx.matrixDisplayDrawFace(canvas, { columns: 8, rows: 4, ages }, "#", { brightness: 1, blackFloor: 0 });
  gate(glLog.draws === 1, `Matrix: one draw call for all glyphs (got ${glLog.draws})`);
}

// ---- RGB Shape: TraceDotSprite mask as a tinted, cached textured quad ---------
{
  const spriteCanvas = { width: 41, height: 41 };
  let bakes = 0;
  ctx.TraceDotSprite = {
    extents: (r, st) => ({ rx: st.rx, ry: st.ry, shape: st.shape, shapeParam: st.shapeParam }),
    ensureRect: (rx, ry) => { bakes += 1; return { canvas: spriteCanvas, width: 41, height: 41, rx, ry }; },
  };
  ctx.RgbShapeMath = { shapeIdFromIndex: () => "star" };
  ctx.nodeGraphSampleGradientStopsRgb = () => [255, 128, 0];
  ctx.nodeGraphPatchNode = (id) => ({ id, type: "rgbShape", params: { brightness: 0.5, size: 0.2 }, traceDisplaySettings: {} });
  load("modules/rgbShape/rgb-shape-display.js");
  const canvas = faceCanvas();
  const face = { dataset: {}, clientWidth: 200, clientHeight: 120 };
  glLog.tex = 0; glLog.draws = 0;
  ctx.paintNodeGraphRgbShapeFace(canvas, face, "shape-1", null);
  const t1 = glLog.tex;
  ctx.paintNodeGraphRgbShapeFace(canvas, face, "shape-1", null);
  gate(glLog.draws > 0 && canvas.log.twoD === 0 && bakes === 2, "RGB Shape: sprite drawn on GL, no 2D");
  gate(t1 === 1 && glLog.tex === 1, `RGB Shape: sprite texture uploaded once and reused (${glLog.tex})`);
  gate(JSON.stringify(face._rgbShapeGlTint) === JSON.stringify([1, 128 / 255, 0, 1]), "RGB Shape: tint = gradient colour");
}

// ---- Arp: rounded clip + band fill geometry ------------------------------------
{
  const src = moduleSrc("modules/arp/arp-display.js");
  gate(!/getContext\(|devicePixelRatio|canvas\.(width|height)\s*=[^=]|imageSmoothing/.test(src), "Arp: no 2D context / canvas sizing / dpr");
  const xy = moduleSrc("modules/xyPad/xy-pad-ui.js");
  gate(!/getContext\(|devicePixelRatio|imageSmoothing|imageRendering|image-rendering|[cC]anvas\w*\.(width|height)\s*=[^=]/.test(xy), "XY Pad: no 2D context / canvas sizing / dpr / smoothing");
  load("modules/arp/arp-display.js");
  const sq = ctx.nodeGraphArpKeysCornerRectPoints(10, 10, 100, 40, 0, false, []);
  gate(sq.length === 8, "Arp: square corners = 4-point box");
  const rr = ctx.nodeGraphArpKeysCornerRectPoints(10, 10, 100, 40, 12, true, []);
  gate(rr.length === 72 && Math.min(...rr.filter((_, i) => i % 2 === 0)) >= 10 - 1e-9, "Arp: squircle outline inside the box");
  const tris = [];
  const fake = {};
  const saveTri = ctx.nodeGraphGlLinesTriangle;
  ctx.nodeGraphGlLinesTriangle = (_b, ...a) => tris.push(a);
  vm.runInContext("nodeGraphGlLinesTriangle = globalThis.nodeGraphGlLinesTriangle", ctx);
  ctx.nodeGraphArpKeysFillPolyBand(fake, rr, 10, 40, [1, 0, 0, 1], [[], []]);
  let area = 0;
  for (const t of tris) area += Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2;
  gate(tris.length > 0 && area < 30 * 40 && area > 30 * 40 * 0.85, `Arp: first cell fill clipped by the rounded corner (area ${area.toFixed(1)})`);
  ctx.nodeGraphGlLinesTriangle = saveTri;
  vm.runInContext("nodeGraphGlLinesTriangle = globalThis.nodeGraphGlLinesTriangle", ctx);
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("smoke_display_gl_phase3 passed");
