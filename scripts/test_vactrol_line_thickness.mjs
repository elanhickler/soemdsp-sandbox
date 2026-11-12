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

// Legend wrap: Mem is already in the list (not added twice). A narrow face
// that cannot fit one row must wrap so every item stays inside availW.
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

const wide = layoutAt(400);
assert(wide.placed.length === 4, "wide legend places all four items");
assert(wide.rows === 1, "wide face stays on one row");
const wideRight = Math.max(...wide.placed.map((p) => p.x + p.w));
assert(wideRight <= 4 + 400, `wide items stay in box, right=${wideRight}`);

const narrow = layoutAt(90);
assert(narrow.placed.length === 4, "narrow legend still places all four items");
assert(narrow.rows >= 2, `narrow face wraps, rows=${narrow.rows}`);
assert(narrow.height >= narrow.rows * 16, "legend height grows with rows");
const mem = narrow.placed.find((p) => p.label === "Mem");
assert(mem, "Mem is present after wrap");
assert(mem.x + mem.w <= 4 + 90 + 1e-6, `Mem stays inside availW, right=${mem.x + mem.w}`);
for (const item of narrow.placed) {
  assert(item.x >= 4, `${item.label} starts in box`);
  assert(item.x + item.w <= 4 + 90 + 1e-6, `${item.label} clipped at ${item.x + item.w}`);
}

console.log("ok: vactrol line thickness and legend wrap");
console.log(JSON.stringify({
  defaults: {
    lightThickness: defaults.lightThickness,
    fltThickness: defaults.fltThickness,
    ampThickness: defaults.ampThickness,
    memThickness: defaults.memThickness,
  },
  independent,
  ink: { min96, dpr2InkDevice, tileMin, tileInkCss, tileDevice, ref: FACE_INK_REF_PX },
  legend: { wideRows: wide.rows, narrowRows: narrow.rows, memY: mem.y },
}, null, 2));
