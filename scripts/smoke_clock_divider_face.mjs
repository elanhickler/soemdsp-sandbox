// Clock Divider face (unit, stubbed GL): one dot per edge of the division in
// rows of <= 16, the engine count (__Count) lights that many dots, the dot a
// tick just lit flashes Tick, a fire (Out rising / count wrapping) flashes
// every dot and the Out bar, the Out bar fills while Out is high, and settings
// normalize with their own HBS lamps. Wiring: definition, schema, page tags.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN, CSS: { escape: (s) => s } };
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
let now = 0;
ctx.performance = { now: () => now * 1000 };
ctx.requestAnimationFrame = () => 0;
vm.createContext(ctx);
const visual = src("node-graph-visual-utils.js");
for (const name of ["nodeGraphHueUnitRgb01", "nodeGraphHueBrightnessRgb01", "nodeGraphHueBrightnessCss"]) {
  vm.runInContext(visual.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0], ctx);
}
vm.runInContext(src("modules/ellipsoid/ellipsoid-settings.js"), ctx);
vm.runInContext(src("modules/clockDivider/clock-divider-display.js"), ctx);

const d = ctx.normalizeNodeGraphClockDividerFaceSettings();
gate(d.backgroundPaint && d.strokePaint && d.dotPaint && d.fillPaint && d.startPaint && d.blinkPaint && d.blinkTime > 0, "defaults carry Background / Ring / Count / Out / Tick / Fire paints + blink time");
const custom = ctx.normalizeNodeGraphClockDividerFaceSettings({ startHue: 120, startBrightness: 0.5, startSaturation: 1, blinkTime: 7 });
gate(custom.startPaint === "rgb(0 255 0)" && custom.blinkTime === 1, `Tick HBS survives normalize, blink time clamps (${custom.startPaint}, ${custom.blinkTime})`);

const dots = []; const rects = []; const polys = [];
ctx.nodeGraphGlGraphParseCssColor = (css) => css;
ctx.nodeGraphCycleLineGlMetrics = () => ({ cssWidth: 240, cssHeight: 90, pixelRatio: 1 });
ctx.nodeGraphGlLinesBegin = () => ({});
ctx.nodeGraphGlLinesDot = (_b, x, y, r, _f, rgba) => dots.push({ x, y, r, rgba });
ctx.nodeGraphGlLinesRect = (_b, x, y, w, h, rgba) => rects.push({ x, y, w, h, rgba });
ctx.nodeGraphGlLinesPolyline = (_b, pts, half, _f, rgba) => polys.push({ pts, half, rgba });
ctx.nodeGraphGlLinesEnd = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};
const node = { id: "cd1", params: { division: 4 }, traceDisplaySettings: {} };
ctx.nodeGraphPatchNode = () => node;
ctx.nodeGraphMvp = { live: { context: { state: "running" } } };
let engine = { __Count: 0, Out: 0 };
ctx.nodeGraphModuleScopeLatestOutputValue = (_id, port, fb) => (port in engine ? engine[port] : fb);
const section = { dataset: { node: "cd1" }, querySelector: () => ({}) };
const look = ctx.normalizeNodeGraphClockDividerFaceSettings();
const frame = (count, out, t) => {
  engine = { __Count: count, Out: out }; now = t;
  dots.length = 0; rects.length = 0; polys.length = 0;
  ctx.drawNodeGraphClockDividerFace(section);
  const full = dots.filter((p) => p.rgba !== look.backgroundPaint);
  const centers = new Map();
  for (const p of full) { const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`; if (!centers.has(k) || p.r > centers.get(k).r) centers.set(k, p); }
  const cells = [...centers.values()];
  return { cells, lit: cells.filter((p) => p.rgba === look.dotPaint).length, tick: cells.filter((p) => p.rgba === look.startPaint).length,
    fire: cells.filter((p) => p.rgba === look.blinkPaint).length, ring: cells.filter((p) => p.rgba === look.strokePaint).length, rects: [...rects], polys: [...polys] };
};
let f = frame(0, 0, 0);
gate(f.cells.length === 4 && f.ring === 4 && f.rects.length === 0, `division 4: 4 empty rings, Out bar empty (${f.cells.length}, ${f.ring})`);
f = frame(1, 0, 1);
gate(f.tick === 1 && f.lit === 0 && f.ring === 3, "tick: count 1 lights dot 1 in the Tick colour");
f = frame(1, 0, 2);
gate(f.lit === 1 && f.tick === 0 && f.ring === 3, "after Blink time the counted dot holds the Count colour");
f = frame(3, 0, 3); f = frame(3, 0, 4);
gate(f.lit === 3 && f.ring === 1, "count 3 of 4: three lit, the fire step still a ring");
f = frame(0, 1, 5);
gate(f.fire === 4 && f.rects.length === 1 && f.rects[0].rgba === look.blinkPaint && f.polys[0].rgba === look.blinkPaint, "fire: every dot + the Out bar flash");
f = frame(0, 1, 6);
gate(f.ring === 4 && f.rects.length === 1 && f.rects[0].rgba === look.fillPaint, "Out still high after the flash: bar holds the Out fill, dots back to rings");
f = frame(0, 0, 7); frame(3, 0, 8); f = frame(0, 0, 8.01);
gate(f.fire === 4, "count wrapping to 0 flashes Fire even if the Out pulse was missed");
node.params.division = 40;
f = frame(5, 0, 20); f = frame(5, 0, 21);
const rows = new Set(f.cells.map((p) => p.y.toFixed(2)));
const cols = new Set(f.cells.map((p) => p.x.toFixed(2)));
gate(f.cells.length === 40 && rows.size === 3 && cols.size === 16 && f.lit === 5, `division 40 wraps to 3 rows of 16 (${rows.size}x${cols.size}), 5 lit`);
gate(f.cells.every((p) => p.x - p.r >= 0 && p.x + p.r <= 240 && p.y - p.r >= 0 && p.y + p.r <= 90 * 0.86), "dots stay inside the face above the Out bar");
node.params.division = 2.6; f = frame(7, 0, 30); f = frame(7, 0, 31);
gate(f.cells.length === 3 && f.lit === 1, "division rounds like the engine (2.6 -> 3); count wraps into it (7 % 3 = 1)");
ctx.nodeGraphMvp.live.context.state = "suspended";
node.params.division = 4; f = frame(2, 1, 40);
gate(f.ring === 4 && f.rects.length === 0, "stopped: no engine state, nothing lit");

const defs = src("node-graph-module-definitions.js");
gate(/clockDivider: \{[\s\S]{0,400}displayType: "clockDividerFace"[\s\S]{0,200}renderer: "clockDividerFace", settingsSchema: "clockDividerFace"/.test(defs), "Clock Divider uses the clockDividerFace display + settings schema");
gate(/clockDividerFace: Object\.freeze\(\{\s*fields: Object\.freeze\(\["lineThickness", "lineSmoothing", "blinkTime"\]\)/.test(src("node-graph-module-scope-trace-controls.js")), "clockDividerFace settings fields: Line thickness, Line smoothing, Blink time");
gate(/if \(type === "clockDivider"\) \{\s*return \["__Count"\];/.test(src("node-live-audio-worklet-native-graph.js")), "worklet publishes the engine count as __Count");
gate(/kPortPhase01\]\[f\] = \(double\)soemdsp_trigger_divider_count/.test(fs.readFileSync(path.join(root, "native_modules/graph_engine/graph_engine.cpp"), "utf8")), "graph engine writes the divider count to the face port");
for (const page of ["index.html", "perform.html"]) {
  gate(/modules\/clock\/clock-display\.js\?v=[^"]+"><\/script>\s*<script[^>]+modules\/clockDivider\/clock-divider-display\.js\?v=/.test(src(page)), `${page} loads clock-divider-display.js`);
}
console.log(failures ? `FAILED ${failures}` : "smoke_clock_divider_face ok");
process.exit(failures ? 1 : 0);
