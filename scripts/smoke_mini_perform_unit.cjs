// MP-8 unit checks for the pure Mini Performance View helpers (no DOM).
// Usage: node scripts/smoke_mini_perform_unit.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..", "public");
const store = new Map();
const ctx = {
  console,
  Math,
  JSON,
  Number,
  String,
  Boolean,
  Object,
  Array,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  nodeGraphMvp: { patch: null },
};
ctx.globalThis = ctx;
ctx.window = { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, addEventListener: () => {}, innerWidth: 1600, innerHeight: 1000 };
ctx.window.localStorage = ctx.localStorage;
ctx.setTimeout = () => 0;
vm.createContext(ctx);
const soemMath = path.join(root, "lib", "soem-math.js");
if (fs.existsSync(soemMath)) vm.runInContext(fs.readFileSync(soemMath, "utf8"), ctx, { filename: "soem-math.js" });
for (const file of ["node-graph-canvas-fit.js", "node-graph-mini-perform.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
}
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures += 1; console.log(`FAIL ${msg}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const r = (src) => vm.runInContext(src, ctx);

// Reference sizes.
const win = r("nodeGraphMiniPerformReferenceSize('window', 1600, 1000)");
ok(win.w === 1600 && win.h === 1000, "window reference = window size");
const pp = r("nodeGraphMiniPerformReferenceSize('phonePortrait', 1600, 1000)");
ok(near(pp.w / pp.h, 9 / 19.5), "phone portrait aspect 9/19.5");
const pl = r("nodeGraphMiniPerformReferenceSize('phoneLandscape', 1600, 1000)");
ok(near(pl.h / pl.w, 9 / 19.5), "phone landscape aspect 19.5/9");

// Whole-module fit matches the F rule: contain inside padded tile.
const fit = r("nodeGraphWholeModuleFitBox(400, 300, 200, 100)");
ok(fit && fit.s > 0 && fit.ox >= fit.pad - 1e-9 && fit.oy >= fit.pad - 1e-9, "whole-module fit stays inside pad");
ok(near(fit.s * 200 + 2 * fit.ox, 400) || near(fit.s * 100 + 2 * fit.oy, 300), "whole-module fit is centred");
const contain = r("nodeGraphContainFitBox(100, 100, 50, 25)");
ok(near(contain.s, 2) && near(contain.oy, 25) && near(contain.ox, 0), "contain fit");

// Tile rect is fractions of the reference stage.
const tile = r("nodeGraphCanvasTileRectPx({ x: 0.25, y: 0.5, w: 0.5, h: 0.25, z: 3 }, 800, 400)");
ok(near(tile.x, 200) && near(tile.y, 200) && near(tile.w, 400) && near(tile.h, 100), "tile rect px");

// Frame rect: screen anchor corners and width -> scale factor.
const frame = r("nodeGraphMiniPerformFrameRect({ anchor: 'screen', corner: 'bottomRight', margin: 16, width: 400 }, { w: 1600, h: 1000 }, 1600, 1000, { originX: 0, originY: 0, zoom: 1 })");
ok(near(frame.w, 400) && near(frame.h, 250) && near(frame.s, 0.25), "frame size keeps reference aspect");
ok(near(frame.x, 1600 - 16 - 400) && near(frame.y, 1000 - 16 - 250), "bottom-right corner + margin");

// Settings normalize + per-machine storage round trip.
const bad = r("normalizeNodeGraphMiniPerformSettings({ show: 'yes', corner: 'middle', width: 99999, opacity: -3, refresh: 7, pointer: 'x' })");
ok(bad.corner === "bottomRight" && bad.width <= 1600 && bad.opacity >= 0.1 && bad.pointer === "clickThrough", "normalize clamps bad values");
r("setNodeGraphMiniPerformSettings({ show: true, corner: 'topLeft', width: 500 }, { sync: false })");
const saved = JSON.parse(store.get("soemdsp.miniPerform") || "{}");
ok(saved.show === true && saved.corner === "topLeft" && saved.width === 500, "settings persist in localStorage");
ok(r("nodeGraphMvp.patch") === null, "settings never touch the patch");

console.log(failures ? `${failures} FAILED` : "mini perform unit ok");
process.exit(failures ? 1 : 0);