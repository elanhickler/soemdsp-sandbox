// Mini Performance View unit checks (docs/MINI_PERFORM_VIEW_PLAN.md MP-14).
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
const soemMath = path.join(root, "lib", "math", "soem-math.js");
if (fs.existsSync(soemMath)) vm.runInContext(fs.readFileSync(soemMath, "utf8"), ctx, { filename: "soem-math.js" });
for (const file of ["node-graph-canvas-fit.js", "node-graph-mini-perform.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
}
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures += 1; console.log(`FAIL ${msg}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-4;
const r = (src) => vm.runInContext(src, ctx);

const aspects = ["window", "16:9", "4:3", "1:1", "9:16", "phonePortrait", "phoneLandscape"];
const table = r("NODE_GRAPH_MINI_PERFORM_ASPECTS");
for (const key of aspects) ok(Object.prototype.hasOwnProperty.call(table, key), `aspect table has ${key}`);
ok(!Object.prototype.hasOwnProperty.call(table, "free"), "free is not a ratio table entry");
const win = r("nodeGraphMiniPerformReferenceSize('window', 1600, 1000)");
ok(win.w === 1600 && win.h === 1000, "window stage = window size");
for (const key of aspects.filter((name) => name !== "window")) {
  const size = r(`nodeGraphMiniPerformReferenceSize(${JSON.stringify(key)}, 1600, 1000)`);
  ok(near(size.h, 1000) && near(size.w / size.h, table[key]), `${key} keeps window height`);
}
const freeRef = r("nodeGraphMiniPerformReferenceSize('free', 1600, 1000, { width: 480, height: 200 })");
ok(near(freeRef.w, 480) && near(freeRef.h, 200), "free stage is the stored size");
const freeFallback = r("nodeGraphMiniPerformReferenceSize('free', 1600, 1000, { width: 360 })");
ok(near(freeFallback.w, 360) && near(freeFallback.h, 360 * 1000 / 1600), "free without height uses window aspect");
ok(r("nodeGraphMiniPerformChoices.aspect[0][0]") === "free", "Free is the first aspect choice");

const fit = r("nodeGraphWholeModuleFitBox(400, 300, 200, 100)");
ok(fit && fit.s > 0 && fit.ox >= fit.pad - 1e-9 && fit.oy >= fit.pad - 1e-9, "whole-module fit stays inside pad");
const tile = r("nodeGraphCanvasTileRectPx({ x: 0.25, y: 0.5, w: 0.5, h: 0.25, z: 3 }, 800, 400)");
ok(near(tile.x, 200) && near(tile.y, 200) && near(tile.w, 400) && near(tile.h, 100), "tile rect px");

const frame = r("nodeGraphMiniPerformFrameRect({ anchor: 'screen', corner: 'bottomRight', offsetX: 16, offsetY: 16, width: 400 }, { w: 1600, h: 1000 }, 1600, 1000)");
ok(near(frame.w, 400) && near(frame.h, 250) && near(frame.s, 0.25), "frame size keeps stage aspect");
ok(near(frame.x, 1600 - 16 - 400) && near(frame.y, 1000 - 16 - 250), "bottom-right offsets");
const clamped = r("nodeGraphMiniPerformFrameRect({ anchor: 'screen', corner: 'topLeft', offsetX: 5000, offsetY: 5000, width: 360 }, { w: 1600, h: 1000 }, 800, 600)");
ok(clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.w <= 800 + 1e-6 && clamped.y + clamped.h <= 600 + 1e-6, "screen frame stays inside the host");
const world = r("nodeGraphMiniPerformFrameRect({ anchor: 'workspace', worldX: 10, worldY: 20, width: 200 }, { w: 1600, h: 1000 }, 1600, 1000, { originX: 5, originY: 6, zoom: 2 })");
ok(near(world.w, 400) && near(world.x, 25) && near(world.y, 46) && near(world.s, 0.25), "workspace frame scales by zoom");

const dropped = r("normalizeNodeGraphMiniPerformSettings({ show: true, margin: 40, pointer: 'interactive', reference: 'phonePortrait', aspect: 'nope', mode: 'arrange', width: 99999 }, { fromStorage: true })");
ok(dropped.mode === "perform", "stored arrange loads as perform");
ok(dropped.aspect === "window" && dropped.width === 1600, "unknown aspect and width clamp");
ok(!("show" in dropped) && !("margin" in dropped) && !("pointer" in dropped) && !("reference" in dropped), "removed keys are dropped");
const live = r("normalizeNodeGraphMiniPerformSettings({ mode: 'arrange', aspect: '4:3', offsetX: 12, offsetY: 18 })");
ok(live.mode === "arrange" && live.aspect === "4:3" && live.offsetX === 12, "in-session arrange is kept");

r("nodeGraphMvp.miniPerform = null");
store.set("soemdsp.miniPerform", JSON.stringify({ mode: "arrange", show: true, margin: 8, reference: "phonePortrait", aspect: "1:1", width: 500 }));
const loaded = r("nodeGraphMiniPerformSettings()");
ok(loaded.mode === "perform" && loaded.aspect === "1:1" && loaded.width === 500, "storage load downgrades arrange and keeps aspect");
ok(r("nodeGraphMvp.patch") === null, "settings never touch the patch");
ok(r("nodeGraphMiniPerformNextMode('off')") === "perform", "cycle off to perform");
ok(r("nodeGraphMiniPerformNextMode('perform')") === "background", "cycle perform to background");
ok(r("nodeGraphMiniPerformNextMode('background')") === "position", "cycle background to position");
ok(r("nodeGraphMiniPerformNextMode('position')") === "arrange", "cycle position to arrange");
ok(r("nodeGraphMiniPerformNextMode('arrange')") === "off", "cycle arrange to off");
const storedPosition = r("normalizeNodeGraphMiniPerformSettings({ mode: 'position' }, { fromStorage: true })");
ok(storedPosition.mode === "perform", "stored position loads as perform");
const storedBackground = r("normalizeNodeGraphMiniPerformSettings({ mode: 'background' }, { fromStorage: true })");
ok(storedBackground.mode === "perform", "stored background loads as perform");

r("setNodeGraphMiniPerformSettings({ mode: 'perform', width: 420, corner: 'topLeft', offsetX: 20, offsetY: 24, aspect: '16:9' }, { sync: false })");
r("nodeGraphMiniPerformEnterEnlarged()");
r("nodeGraphMiniPerformEnlarged.box = { x: 4, y: 6, w: 900, h: 500 }");
ok(r("nodeGraphMiniPerformEnlargedActive()") === true, "enlarged is on");
ok(r("nodeGraphMiniPerformExitEnlarged()") === true, "escape-style exit returns true");
ok(r("nodeGraphMiniPerformEnlargedActive()") === false, "enlarged is off");
const kept = r("nodeGraphMiniPerformSettings()");
ok(kept.width === 420 && kept.corner === "topLeft" && kept.offsetX === 20, "exit restores the remembered mini rect");

const refW = 1600;
const refH = 1000;
const dx = 160;
const fFrac = dx / refW;
ok(near(r(`nodeGraphMiniPerformDragFraction(${dx}, 0, ${refW}, ${refH}, 1, 1).x`), fFrac), "screen drag at stage size matches F");
ok(near(r(`nodeGraphMiniPerformDragFraction(${dx}, 0, ${refW}, ${refH}, 0.5, 2).x`), fFrac), "workspace zoom 2 at stage size matches F");
ok(near(r(`nodeGraphMiniPerformDragFraction(${dx}, 0, ${refW}, ${refH}, 2, 0.5).x`), fFrac), "workspace zoom 0.5 at stage size matches F");

ok(r("nodeGraphMiniPerformResizeDelta(40, 1, 'bottomRight', 16, 9)") > 0, "outward corner drag grows");
ok(r("nodeGraphMiniPerformResizeDelta(-40, -1, 'bottomRight', 16, 9)") < 0, "inward corner drag shrinks");
const freeGrow = r("nodeGraphMiniPerformResizeFreeRect(10, 20, 400, 200, 40, 10, 'bottomRight', 120, 80, 1600, 1600)");
ok(near(freeGrow.x, 10) && near(freeGrow.y, 20) && near(freeGrow.w, 440) && near(freeGrow.h, 210), "free bottom-right moves each axis");
const freeOut = r("nodeGraphMiniPerformResizeFreeRect(100, 80, 400, 200, -50, -30, 'topLeft', 120, 80, 1600, 1600)");
ok(near(freeOut.w, 450) && near(freeOut.h, 230) && near(freeOut.x, 50) && near(freeOut.y, 50), "free top-left keeps opposite corner");
const freeClamp = r("nodeGraphMiniPerformResizeFreeRect(0, 0, 400, 200, -500, -500, 'bottomRight', 120, 80, 1600, 1600)");
ok(near(freeClamp.w, 120) && near(freeClamp.h, 80) && near(freeClamp.x, 0) && near(freeClamp.y, 0), "free resize clamps independently");
const freeFrame = r("nodeGraphMiniPerformFrameRect({ anchor: 'screen', corner: 'bottomRight', offsetX: 16, offsetY: 16, width: 480, height: 200, aspect: 'free' }, { w: 480, h: 200 }, 1600, 1000)");
ok(near(freeFrame.w, 480) && near(freeFrame.h, 200) && near(freeFrame.s, 1), "free frame uses stored width and height");

r("setNodeGraphMiniPerformSettings({ mode: 'perform', width: 400, aspect: '1:1' }, { sync: false })");
r("setNodeGraphMiniPerformSettings({ aspect: 'free' }, { sync: false })");
ok(r("nodeGraphMiniPerformSettings().aspect") === "free" && r("nodeGraphMiniPerformSettings().height") === 400, "switching to free seeds the current height");
ok(r("normalizeNodeGraphMiniPerformSettings({ aspect: 'free', width: 500, height: 180 }).height") === 180, "stored free height is kept");

const line = "Canvas is empty. Turn on Show in performance view on a module.";
for (const cssW of [200, 360, 800, 1280]) {
  const px = r(`nodeGraphEmptyCanvasLinePx(${cssW}, ${JSON.stringify(line)}, (px) => ${JSON.stringify(line)}.length * px * 0.6)`);
  const advance = line.length * px * 0.6;
  ok(advance <= cssW * 0.95 + 0.6 && advance >= cssW * 0.9, `empty line fits ${cssW} (${advance.toFixed(1)})`);
}

let box = r("nodeGraphEmptyCanvasDvdStep({ x: 0, y: 10, vx: -80, vy: 0, size: 20 }, 0.1, 200, 100)");
ok(box.x === 0 && box.vx > 0, "dvd hits the left edge");
box = r("nodeGraphEmptyCanvasDvdStep({ x: 190, y: 10, vx: 80, vy: 0, size: 20 }, 0.2, 200, 100)");
ok(near(box.x, 180) && box.vx < 0, "dvd hits the right edge");
box = r("nodeGraphEmptyCanvasDvdStep({ x: 10, y: 0, vx: 0, vy: -80, size: 20 }, 0.1, 200, 100)");
ok(box.y === 0 && box.vy > 0, "dvd hits the top edge");
box = r("nodeGraphEmptyCanvasDvdStep({ x: 10, y: 90, vx: 0, vy: 80, size: 20 }, 0.2, 200, 100)");
ok(near(box.y, 80) && box.vy < 0, "dvd hits the bottom edge");
box = r("nodeGraphEmptyCanvasDvdStep({ x: 10, y: 10, vx: 10, vy: 10, size: 80 }, 0, 100, 90)");
ok(box.x >= 0 && box.y >= 0 && box.x + box.size <= 100 && box.y + box.size <= 90, "logo stays inside after a resize");

console.log(failures ? `${failures} FAILED` : "mini perform unit ok");
process.exit(failures ? 1 : 0);
