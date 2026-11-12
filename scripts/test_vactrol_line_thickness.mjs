#!/usr/bin/env node
// Unit test: Vactrol per-line thickness, ink scale, and legend wrap (no clipped Mem).
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {
  console,
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  parseInt,
  parseFloat,
  module: { exports: {} },
  exports: {},
};
vm.createContext(ctx);

function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  vm.runInContext(src, ctx, { filename: rel });
}

load("public/lib/visual/display-scale.js");
load("public/modules/vactrol/vactrol-scope-display.js");

const {
  FACE_INK_REF_PX,
  faceInkPx,
  faceMinSide,
} = ctx;
const vac = ctx.module && ctx.module.exports ? ctx.module.exports : {};
const {
  normalizeNodeGraphVactrolScopeSettings,
  nodeGraphVactrolScopeDisplaySettingsDefaults: defaults,
  nodeGraphVactrolScopeClampThickness,
  nodeGraphVactrolScopeLineThickness,
  nodeGraphVactrolScopeLayoutLegend,
} = vac;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, msg, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: ${a} !== ${b}`);
}

assert(defaults.lightThickness === 1.5, "default lightThickness 1.5");
assert(defaults.fltThickness === 1.5, "default fltThickness 1.5");
assert(defaults.ampThickness === 1.5, "default ampThickness 1.5");
assert(defaults.memThickness === 1.5, "default memThickness 1.5");

const empty = normalizeNodeGraphVactrolScopeSettings({});
assert(empty.lightThickness === 1.5 && empty.memThickness === 1.5, "normalize fills 1.5");
assert(empty.showMem === false, "showMem still defaults off (legend still lists Mem)");

const clamped = normalizeNodeGraphVactrolScopeSettings({
  lightThickness: -2,
  fltThickness: 99,
  ampThickness: "nope",
  memThickness: 0,
});
assert(clamped.lightThickness === 0, "negative clamps to 0");
assert(clamped.fltThickness === 16, "oversize clamps to 16");
assert(clamped.ampThickness === 1.5, "invalid falls back to 1.5");
assert(clamped.memThickness === 0, "0 is a real hide-stroke value");
assert(nodeGraphVactrolScopeClampThickness(0, 1.5) === 0, "clamp keeps 0");

const independent = normalizeNodeGraphVactrolScopeSettings({
  lightThickness: 1,
  fltThickness: 3,
  ampThickness: 5,
  memThickness: 8,
});
assert(independent.lightThickness === 1, "light independent");
assert(independent.fltThickness === 3, "flt independent");
assert(independent.ampThickness === 5, "amp independent");
assert(independent.memThickness === 8, "mem independent");
assert(nodeGraphVactrolScopeLineThickness(independent, "lightThickness") === 1, "line helper light");
assert(nodeGraphVactrolScopeLineThickness(independent, "memThickness") === 8, "line helper mem");

// Authored CSS px at 96: ink == authored. Backing scale is css * (width/cssW).
const min96 = faceMinSide(96, 96);
almost(min96, 96, "96 face minSide");
almost(faceInkPx(1.5, min96), 1.5, "96 face ink == authored 1.5");
const dpr2InkDevice = faceInkPx(1.5, min96) * (192 / 96);
almost(dpr2InkDevice, 3, "dpr2 device px is 3");

// Canvas tile CSS 384x256, backing 768x512 (dpr 2).
const tileMin = faceMinSide(384, 256);
almost(tileMin, 256, "tile minSide");
const tileInkCss = faceInkPx(1.5, tileMin);
const tileDevice = tileInkCss * (768 / 384);
almost(tileInkCss, 1.5 * (256 / FACE_INK_REF_PX), "tile ink scales with minSide");
almost(tileDevice, tileInkCss * 2, "tile device = ink * (backing/css)");
assert(tileDevice !== 1.5, "tile thickness is not the raw authored CSS px");

// Legend: Mem is already in the list (not added twice). Only two modes exist:
// 1 tidy row when it fits, otherwise a 2+2 column-aligned grid. Never 3+ rows.
const items = [
  { port: "Light", label: "Light", showKey: "showLight" },
  { port: "Tone", label: "Flt Env", showKey: "showFlt" },
  { port: "Out", label: "Amp Env", showKey: "showAmp" },
  { port: "Mem", label: "Mem", showKey: "showMem" },
];
const memCount = items.filter((it) => it.label === "Mem" || it.port === "Mem").length;
assert(memCount === 1, "legend has exactly one Mem item");

function layoutAt(availW) {
  return nodeGraphVactrolScopeLayoutLegend(items, {
    x: 4,
    y: 4,
    availW,
    rowH: 16,
    gap: 8,
    ink: (n) => n,
    legendPx: 11,
  });
}

function assertInside(layout, availW, label) {
  assert(layout.placed.length === 4, `${label} places all four items`);
  assert(layout.rows === 1 || layout.rows === 2, `${label} rows must be 1 or 2, got ${layout.rows}`);
  assert(layout.rows <= 2, `${label} never uses 3+ rows (${layout.rows})`);
  const memItem = layout.placed.find((p) => p.label === "Mem");
  assert(memItem, `${label} includes Mem`);
  for (const item of layout.placed) {
    assert(item.x >= 4 - 1e-6, `${label} ${item.label} starts in box`);
    assert(item.x + item.w <= 4 + availW + 1e-6, `${label} ${item.label} clipped at ${item.x + item.w}`);
  }
}

function assertTwoByTwo(layout, label) {
  assert(layout.rows === 2, `${label} is 2 rows`);
  assert(layout.split === 2, `${label} splits 2+2`);
  const byLabel = Object.fromEntries(layout.placed.map((p) => [p.label, p]));
  assert(byLabel.Light.row === 0 && byLabel["Flt Env"].row === 0, `${label} row 1 is Light | Flt Env`);
  assert(byLabel["Amp Env"].row === 1 && byLabel.Mem.row === 1, `${label} row 2 is Amp Env | Mem`);
  almost(byLabel.Light.x, byLabel["Amp Env"].x, `${label} column 0 aligned`);
  almost(byLabel["Flt Env"].x, byLabel.Mem.x, `${label} column 1 aligned`);
  almost(byLabel.Light.ly, byLabel["Flt Env"].ly, `${label} row 0 baseline`);
  almost(byLabel["Amp Env"].ly, byLabel.Mem.ly, `${label} row 1 baseline`);
  assert(byLabel["Flt Env"].x > byLabel.Light.x, `${label} columns increase`);
  assert(byLabel.Mem.ly > byLabel.Light.ly, `${label} row 1 is below row 0`);
}

const wide = layoutAt(400);
assertInside(wide, 400, "wide");
assert(wide.rows === 1, "wide face stays on one row");
assert(wide.scale === 1, "wide face keeps full typography");
assert(wide.placed[0].label === "Light" && wide.placed[3].label === "Mem", "wide order Light..Mem");
const wideXs = wide.placed.map((p) => p.x);
assert(wideXs[0] < wideXs[1] && wideXs[1] < wideXs[2] && wideXs[2] < wideXs[3], "wide is a single left-to-right row");

// Mid width: too tight for one full row, wide enough for a full-size 2x2 grid.
const mid = layoutAt(150);
assertInside(mid, 150, "mid");
assertTwoByTwo(mid, "mid");
almost(mid.scale, 1, "mid 2-row keeps full typography");

// Narrow width: still exactly 2 rows; typography shrinks so nothing clips.
const narrow = layoutAt(90);
assertInside(narrow, 90, "narrow");
assertTwoByTwo(narrow, "narrow");
assert(narrow.scale < 1, `narrow typography shrinks, scale=${narrow.scale}`);
assert(narrow.height <= 2 * 16 + 1e-6, "compact 2-row height does not exceed two full rows");

// Very narrow face: still 1 or 2 rows (never 3+), Mem inside the box.
for (const w of [40, 60, 80, 100, 160, 220, 400]) {
  const layout = layoutAt(w);
  assertInside(layout, w, `avail ${w}`);
  if (layout.rows === 2) assertTwoByTwo(layout, `avail ${w}`);
}

console.log("ok: vactrol line thickness and legend 1/2-row layout");
console.log(JSON.stringify({
  defaults: {
    lightThickness: defaults.lightThickness,
    fltThickness: defaults.fltThickness,
    ampThickness: defaults.ampThickness,
    memThickness: defaults.memThickness,
  },
  independent,
  ink: { min96, dpr2InkDevice, tileMin, tileInkCss, tileDevice, ref: FACE_INK_REF_PX },
  legend: {
    wideRows: wide.rows,
    midRows: mid.rows,
    midScale: mid.scale,
    narrowRows: narrow.rows,
    narrowScale: narrow.scale,
    memCol: narrow.placed.find((p) => p.label === "Mem").col,
  },
}, null, 2));
