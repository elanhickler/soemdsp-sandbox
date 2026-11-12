#!/usr/bin/env node
// Unit test: Waterfall frame padding / fade scale with faceInkPx on the CSS box.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Math, Number, String, Boolean, Object, Array, parseInt, parseFloat };
vm.createContext(ctx);

function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  vm.runInContext(src, ctx, { filename: rel });
}

load("public/lib/visual/display-scale.js");

const waterfall = fs.readFileSync(path.join(root, "public/node-graph-module-scope-waterfall.js"), "utf8");
const start = waterfall.indexOf("// Waterfall frame defaults");
const end = waterfall.indexOf("function nodeGraphWaterfallWaveRaw");
if (start < 0 || end < 0) {
  throw new Error("Could not extract waterfall frame helpers");
}
vm.runInContext(waterfall.slice(start, end), ctx, { filename: "waterfall-frame-slice.js" });
vm.runInContext(
  "this.NODE_GRAPH_WATERFALL_FRAME = NODE_GRAPH_WATERFALL_FRAME;"
  + "this.nodeGraphWaterfallFramePx = nodeGraphWaterfallFramePx;"
  + "this.nodeGraphWaterfallFrameAuthored = nodeGraphWaterfallFrameAuthored;"
  + "this.nodeGraphWaterfallFaceCssBox = nodeGraphWaterfallFaceCssBox;"
  + "this.nodeGraphWaterfallFramePresent = nodeGraphWaterfallFramePresent;",
  ctx,
);

const {
  FACE_INK_REF_PX,
  faceInkPx,
  faceMinSide,
  NODE_GRAPH_WATERFALL_FRAME,
  nodeGraphWaterfallFramePx,
  nodeGraphWaterfallFrameAuthored,
  nodeGraphWaterfallFramePresent,
} = ctx;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, msg, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: ${a} !== ${b}`);
}

assert(NODE_GRAPH_WATERFALL_FRAME.fadeLeft === 4, "default fade should be 4 px (less drastic than old 8)");
assert(NODE_GRAPH_WATERFALL_FRAME.padLeft === 6, "default pad should be 6 px");

const authored = nodeGraphWaterfallFrameAuthored({ framePadding: 6, fadeAmount: 4 });
assert(authored.padLeft === 6 && authored.padRight === 6 && authored.fadeLeft === 4, "authored pad/fade");
const missing = nodeGraphWaterfallFrameAuthored({});
assert(missing.fadeLeft === 4 && missing.padLeft === 6, "missing settings use defaults");

// 96x96 CSS box, backing 96 (dpr 1): ink == authored, device == authored.
const face96 = { width: 96, height: 96, cssW: 96, cssH: 96 };
const f96 = nodeGraphWaterfallFramePx(face96, { framePadding: 6, fadeAmount: 4 });
assert(f96.padLeft === 6, `96px face padLeft ${f96.padLeft}`);
assert(f96.padRight === 6, `96px face padRight ${f96.padRight}`);
assert(f96.fadeLeft === 4, `96px face fadeLeft ${f96.fadeLeft}`);

// Same face at dpr 2: backing 192, CSS 96. device = authored * 2.
const face96dpr2 = { width: 192, height: 192, cssW: 96, cssH: 96 };
const f96x2 = nodeGraphWaterfallFramePx(face96dpr2, { framePadding: 6, fadeAmount: 4 });
assert(f96x2.padLeft === 12, `dpr2 padLeft ${f96x2.padLeft}`);
assert(f96x2.fadeLeft === 8, `dpr2 fadeLeft ${f96x2.fadeLeft}`);

// Canvas tile: CSS box 384x256 (minSide 256), backing = css * dpr 2.
// faceInkPx(4, 256) = 4 * (256/96), device = that * 2.
const tile = { width: 768, height: 512, cssW: 384, cssH: 256 };
const minSide = faceMinSide(384, 256);
almost(minSide, 256, "tile minSide");
const fadeCss = faceInkPx(4, minSide);
const padCss = faceInkPx(6, minSide);
const sx = 768 / 384;
const ft = nodeGraphWaterfallFramePx(tile, { framePadding: 6, fadeAmount: 4 });
assert(ft.fadeLeft === Math.round(fadeCss * sx), `tile fadeLeft ${ft.fadeLeft} != ${Math.round(fadeCss * sx)}`);
assert(ft.padLeft === Math.round(padCss * sx), `tile padLeft ${ft.padLeft} != ${Math.round(padCss * sx)}`);
// Must not blow up to 20% of backing width (old cap / inkScale bug).
assert(ft.fadeLeft < tile.width * 0.1, `tile fade should stay modest, got ${ft.fadeLeft} of ${tile.width}`);

// Hidden builder backing composited onto a large tile: css box is the TILE,
// canvas.width stays at the builder size. Convert ink through width/cssW
// so compositor * (tile/backing) yields faceInkPx on the tile.
const composited = { width: 192, height: 128, cssW: 384, cssH: 256 };
const fc = nodeGraphWaterfallFramePx(composited, { framePadding: 6, fadeAmount: 4 });
const sxC = 192 / 384;
assert(fc.fadeLeft === Math.round(fadeCss * sxC), `composited fadeLeft ${fc.fadeLeft}`);
assert(fc.padLeft === Math.round(padCss * sxC), `composited padLeft ${fc.padLeft}`);

// Old-style wrong scale (dpr * ink from clientWidth of a stretched canvas)
// would have been huge; our result must stay well below 20% of width.
assert(fc.fadeLeft + fc.padLeft < composited.width * 0.2, "composited left frame is not 20% of the plot");

// User can set fade to 0 (no fade) or a custom pixel amount.
const zero = nodeGraphWaterfallFramePx(face96, { framePadding: 6, fadeAmount: 0 });
assert(zero.fadeLeft === 0 && zero.padLeft === 6, "fade 0");

// Present path: one continuous fade quad, not one rect per fade column.
assert(typeof nodeGraphWaterfallFramePresent === "function", "present helper is exported");
const rects = [];
const fades = [];
ctx.nodeGraphGlLinesRect = (batch, x, y, w, h, c) => { rects.push({ x, y, w, h, c: c.slice() }); };
ctx.nodeGraphGlLinesFadeRect = (batch, x, y, w, h, c) => { fades.push({ x, y, w, h, c: c.slice() }); };
const frame = { padLeft: 6, padRight: 6, fadeLeft: 4, minPadY: 4 };
const plate = [0.1, 0.2, 0.3, 1];
nodeGraphWaterfallFramePresent({}, 10, 20, 100, frame, plate, 2);
assert(rects.length === 1, `present draws one pad rect, got ${rects.length}`);
assert(fades.length === 1, `present draws one fade quad, got ${fades.length}`);
almost(rects[0].x, 10, "pad x");
almost(rects[0].w, 12, "pad width uses kx");
almost(rects[0].h, 100, "pad height");
almost(fades[0].x, 10 + 12, "fade starts after pad");
almost(fades[0].w, 8, "fade width is fadeLeft * kx, not 1px columns");
almost(fades[0].h, 100, "fade height");
assert(fades[0].w !== 2, "fade is not a single kx column");
rects.length = 0;
fades.length = 0;
nodeGraphWaterfallFramePresent({}, 0, 0, 50, { padLeft: 6, fadeLeft: 0 }, plate, 1);
assert(rects.length === 1 && fades.length === 0, "fade 0 draws only the pad");

// Both real draw paths share the helper; neither still stacks 1px alpha rects.
const helpers = fs.readFileSync(path.join(root, "public/node-graph-module-scope-paint-helpers.js"), "utf8");
const compositor = fs.readFileSync(path.join(root, "public/node-graph-gl-graph.js"), "utf8");
const lines = fs.readFileSync(path.join(root, "public/lib/visual/gl-line-renderer.js"), "utf8");
assert(helpers.includes("nodeGraphWaterfallFramePresent("), "FaceFrameDraw uses the shared present helper");
assert(compositor.includes("nodeGraphWaterfallFramePresent("), "DrawDisplayInk uses the shared present helper");
assert(!/for \(let i = 0; i < frame\.fadeLeft/.test(helpers), "FaceFrameDraw no longer loops fade columns");
assert(!/for \(let i = 0; i < frame\.fadeLeft/.test(compositor), "DrawDisplayInk no longer loops fade columns");
assert(lines.includes("function nodeGraphGlLinesFadeRect"), "FadeRect primitive exists");
assert(lines.includes("soemDither(gl_FragCoord.xy)"), "fade shader uses Soem ordered dither");
assert(lines.includes("float fade = a * a;"), "fade shader keeps quadratic ease, continuously");
assert(lines.includes("caps = 11") || lines.includes("const caps = 11"), "fade verts are tagged caps 11");

console.log("ok: waterfall frame pad/fade scale and dithered gradient present");
console.log(JSON.stringify({
  defaults: NODE_GRAPH_WATERFALL_FRAME,
  face96: f96,
  face96dpr2: f96x2,
  tile: ft,
  tileCssInk: { padCss, fadeCss, minSide, ref: FACE_INK_REF_PX },
  composited: fc,
  present: { pad: rects, /* reset after fade0 case */ fadeQuad: { x: 22, w: 8, kx: 2 } },
}, null, 2));
