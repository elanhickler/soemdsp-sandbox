// Smoke: Phase 3c - partly-GL faces lose their Canvas2D paths (fbm Field,
// Raster RGB, RGB Fractal, Spectrogram, Vector RGB, Asciiscope, Image Burn).
// Gates: no display-GL contract hit in the face files, removed fallback
// symbols stay gone, and the display-canvas.js helpers they now use behave
// (exact backing, pixel ratio, pixelated/smooth classes, blit, glyph atlas,
// image downscale). Spectrogram state carries no 2D bitmap; RGB Fractal and
// fbm Field plates go through gl-line-renderer.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const PATTERNS = [
  /getContext\(\s*["']2d/,
  /createElement\(\s*["']canvas|new OffscreenCanvas/,
  /\b\w*[cC]anvas\w*\.(?:width|height)\s*=(?!=)/,
  /imageSmoothing/,
  /image-rendering|imageRendering/,
  /devicePixelRatio/,
];
const FACES = {
  "public/modules/fbmField/fbm-field-display.js": ["fill_grid only if GL fails", "nodeGraphFbmFieldPresentCanvas2d("],
  "public/modules/fbmField/fbm-field-gl.js": ["function nodeGraphFbmFieldPresentCanvas2d"],
  "public/modules/rasterRgb/raster-rgb-display.js": ["state.tileCanvas", "gpuDrawn ? null : nodeGraphRasterRgbApplyGrade"],
  "public/modules/rasterRgb/raster-rgb-gl.js": [],
  "public/modules/rgbFractal/rgb-fractal-display.js": ["paintNodeGraphRgbFractalFaceCpu", "_rgbFractalOff"],
  "public/modules/rgbFractal/rgb-fractal-gl.js": [],
  "public/modules/spectrogram/spectrogram-display.js": ["spectrogramRasterizeRingTo2d", "spectrogramScrollPaintPixels", "function spectrogramPresent("],
  "public/modules/spectrogram/spectrogram-gl.js": [],
  "public/modules/vectorRgb/vector-rgb-display.js": ["nodeGraphVectorRgbStampArcs"],
  "public/modules/asciiscope/asciiscope-core.js": [],
  "public/modules/asciiscope/asciiscope-display.js": ["matrixDrawFace2d", "matrixSyncCanvasBacking2d"],
  "public/modules/asciiscope/asciiscope-gl.js": [],
  "public/modules/asciiscope/asciiscope-ui.js": [],
  "public/modules/imageBurn/image-burn-display.js": ["nodeGraphImageBurnBuffers", "nodeGraphImageBurnDrawDry", "nodeGraphImageBurnFadeByLuma"],
  "public/modules/imageBurn/image-burn-gl.js": [],
  "public/modules/imageBurn/image-burn-ui.js": [],
};
for (const [rel, gone] of Object.entries(FACES)) {
  const src = read(rel);
  const hit = PATTERNS.find((re) => re.test(src));
  gate(!hit, `${path.basename(rel)}: no display-GL contract hit${hit ? ` (${hit})` : ""}`);
  for (const sym of gone) gate(!src.includes(sym), `${path.basename(rel)}: removed 2D path stays gone (${sym})`);
}
const allow = read("scripts/display_gl_allowlist.txt");
for (const rel of Object.keys(FACES)) gate(!allow.includes(rel), `allowlist no longer lists ${path.basename(rel)}`);
{
  const gvs = read("public/modules/gradientVectorscope/gradient-vectorscope-display.js");
  gate(!/getContext\(\s*["']2d/.test(gvs) && !/image-rendering|imageRendering/.test(gvs), "Gradient Vectorscope: no getContext('2d') / imageRendering");
  gate(!allow.includes("gradient-vectorscope-display.js"), "allowlist no longer lists gradient-vectorscope-display.js");
}
// Real-GPU findings fixed with this port (the removed 2D paths had masked them):
const sgl = read("public/modules/spectrogram/spectrogram-gl.js");
gate(/instanceof WebGL2RenderingContext/.test(sgl) && sgl.includes("gl.RGBA32F") && sgl.includes("g.entry.floatInternal"),
  "Spectrogram GL: WebGL2 float ring (core floats + RGBA32F), not OES_texture_float only");
const frag = fs.readFileSync(path.join(root, "native_modules/fbm_field/fbm_field.frag.glsl"), "utf8");
const hashCalls = [...frag.matchAll(/=\s*hash3d\(([^)]*)\)/g)].map((m) => m[1].split(",").length);
gate(hashCalls.length >= 8 && hashCalls.every((n) => n === 4), `fbm Field shader: every hash3d call has 4 args (${hashCalls.join(",")})`);
const rfd = read("public/modules/rgbFractal/rgb-fractal-display.js");
gate(!/nodeId: id,/.test(rfd), "RGB Fractal: paint params no longer reference an undeclared id");
const css = read("public/styles.css");
gate(/\.display-canvas-pixelated\s*\{\s*image-rendering:\s*pixelated/.test(css), "styles.css: .display-canvas-pixelated rule");
gate(/display-canvas-smooth\s*\{\s*image-rendering:\s*auto/.test(css), "styles.css: .display-canvas-smooth pins auto over zoom pixelation");

// --- display-canvas.js helpers
function classList() {
  const set = new Set();
  return { set, add: (c) => set.add(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; }, contains: (c) => set.has(c) };
}
function fakeCtx(log) {
  return {
    setTransform() {}, fillRect() { log.fills += 1; }, fillText(t) { log.text.push(t); }, clearRect() {},
    drawImage(...a) { log.draws.push({ smooth: this.imageSmoothingEnabled, a }); },
    imageSmoothingEnabled: true, imageSmoothingQuality: "low",
  };
}
const dlog = { fills: 0, text: [], draws: [] };
const document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx(dlog) }) };
const dctx = vm.createContext({ document, devicePixelRatio: 3, console });
dctx.globalThis = dctx;
vm.runInContext(read("public/lib/visual/display-canvas.js"), dctx);
{
  const c = { width: 10, height: 10, classList: classList() };
  gate(dctx.nodeGraphDisplayCanvasSetBacking(c, 64.4, 32) === true && c.width === 64 && c.height === 32, "SetBacking: exact rounded size");
  gate(dctx.nodeGraphDisplayCanvasSetBacking(c, 64, 32) === false, "SetBacking: unchanged size is a no-op (keeps the surface)");
  gate(c.classList.contains("node-display-canvas"), "SetBacking marks node-display-canvas");
  gate(dctx.nodeGraphDisplayCanvasPixelRatio() === 3 && dctx.nodeGraphDisplayCanvasPixelRatio(2.5) === 2.5, "PixelRatio: dpr, capped");
  dctx.nodeGraphDisplayCanvasPixelated(c, true);
  gate(c.classList.contains("display-canvas-pixelated") && !c.classList.contains("display-canvas-smooth"), "Pixelated on");
  dctx.nodeGraphDisplayCanvasPixelated(c, false, true);
  gate(!c.classList.contains("display-canvas-pixelated") && c.classList.contains("display-canvas-smooth"), "Pixelated off + pinned smooth");
  dctx.nodeGraphDisplayCanvasPixelated(c, false);
  gate(!c.classList.contains("display-canvas-smooth"), "Pixelated off without pin clears smooth");
  const blog = { fills: 0, text: [], draws: [] };
  const bctx = fakeCtx(blog);
  dctx.nodeGraphDisplayCanvasBlit(bctx, {}, 0, 5, 8, 8, 0, 0, 16, 16, true);
  dctx.nodeGraphDisplayCanvasBlit(bctx, {}, 0, 5, 8, 8, 0, 0, 8, 8, false);
  gate(blog.draws.length === 2 && blog.draws[0].smooth === true && blog.draws[1].smooth === false, "Blit: smoothing follows the scale flag");
  const atlas = dctx.nodeGraphDisplayCanvasBakeGlyphAtlas({ glyphs: ["A", " ", "B"], cols: 2, cellW: 10, cellH: 20, fontPx: 15, family: "monospace", yFrac: 0.54 });
  gate(atlas && atlas.width === 20 && atlas.height === 40 && dlog.text.join("") === "AB", "BakeGlyphAtlas: grid size + skips spaces");
  const down = dctx.nodeGraphDisplayCanvasDownscaleImage({}, 100, 50);
  gate(down && down.width === 100 && down.height === 50 && dlog.draws.at(-1).smooth === true, "DownscaleImage: high-quality resize");
}

// --- fbm Field / RGB Fractal plates through gl-line-renderer
function glCtx() {
  const calls = { black: 0, begin: [], end: 0 };
  const ctx = vm.createContext({
    console, document, devicePixelRatio: 1,
    SoemMath: { finiteOr: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d), clamp: (v) => v, clamp01: (v) => v, SEED_MAX: 1 },
    nodeGraphGlLinesFillBlack: () => { calls.black += 1; },
    nodeGraphGlLinesBegin: (_c, rgba, opts) => { calls.begin.push({ rgba, opts }); return {}; },
    nodeGraphGlLinesEnd: () => { calls.end += 1; return true; },
    nodeGraphGlLinesCss: () => [0, 0, 0, 1],
  });
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.runInContext(read("public/lib/visual/display-canvas.js"), ctx);
  return { ctx, calls };
}
{
  const { ctx, calls } = glCtx();
  vm.runInContext(read("public/modules/fbmField/fbm-field-gl.js"), ctx);
  const c = { width: 0, height: 0, classList: classList(), getContext: () => { throw new Error("2d"); } };
  const ok = vm.runInContext("nodeGraphFbmFieldGlClearBlack", ctx)(c);
  gate(ok === true && calls.black === 1 && c.width >= 1, "fbm Field: clear-black goes through nodeGraphGlLinesFillBlack");
  gate(vm.runInContext("nodeGraphFbmFieldGlPresent", ctx)(c, new Float32Array(4), 2, 2, {}) === false, "fbm Field: mono-grid legacy entry no longer paints 2D");
}
{
  const { ctx, calls } = glCtx();
  vm.runInContext(read("public/modules/rgbFractal/rgb-fractal-gl.js"), ctx);
  vm.runInContext("nodeGraphRgbFractalGlEnsure = () => ({ gl: {}, lost: false })", ctx);
  const c = { width: 8, height: 8, classList: classList(), getContext: () => { throw new Error("2d"); } };
  const ok = vm.runInContext("nodeGraphRgbFractalGlClearPlate", ctx)(c, "#ff0000");
  const rgba = calls.begin[0]?.rgba || [];
  gate(ok === true && calls.end === 1 && rgba[0] === 1 && rgba[1] === 0 && rgba[3] === 1, "RGB Fractal: plate clear is a GL batch in the plate colour");
}

// --- Spectrogram: no 2D bitmap in state; resize keeps the GL ring
{
  const ctx = vm.createContext({ console, nodeGraphModuleScopeCustomRenderers: {}, nodeGraphFiniteNumber: (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d) });
  ctx.globalThis = ctx;
  vm.runInContext(read("public/modules/spectrogram/spectrogram-display.js"), ctx);
  const st = vm.runInContext("spectrogramCreateState", ctx)(40, 20);
  gate(!("canvas" in st) && !("ctx" in st) && st.faceW === 40 && st.faceH === 20, "Spectrogram: state carries no Canvas2D bitmap");
  st.ring = { w: 40 };
  vm.runInContext("spectrogramGlRingResize = (ring, w) => ({ ...ring, w })", ctx);
  const next = vm.runInContext("spectrogramResizePreserve", ctx)(st, 60, 30);
  gate(next.ring?.w === 60 && next.faceW === 60 && !("ctx" in next), "Spectrogram: resize keeps history in the GL ring only");
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("smoke_display_gl_phase3c passed");
