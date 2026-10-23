// Clock Divider face (unit, stubbed GL): one dot per edge of the division in
// rows of <= 16, the engine count (__Count) lights that many dots with the
// newest in the Tick colour, every dot shows Fire exactly while the engine's
// Gate output is high, no Out bar, settings carry Line thickness, Line
// smoothing, and the HBS lamps (no blink time). Wiring: definition (Gate ▮ /
// Trigger ⎍ outputs, no Threshold, Amplitude), engine trigger, page tags.
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
ctx.performance = { now: () => 0 };
ctx.requestAnimationFrame = () => 0;
vm.createContext(ctx);
const visual = src("node-graph-visual-utils.js");
for (const name of ["nodeGraphHueUnitRgb01", "nodeGraphHueBrightnessRgb01", "nodeGraphHueBrightnessCss"]) {
  vm.runInContext(visual.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0], ctx);
}
vm.runInContext(src("modules/ellipsoid/ellipsoid-settings.js"), ctx);
vm.runInContext(src("modules/clockDivider/clock-divider-display.js"), ctx);

const d = ctx.normalizeNodeGraphClockDividerFaceSettings({ lineSmoothing: 4, blinkTime: 0.5 });
gate(d.backgroundPaint && d.strokePaint && d.dotPaint && d.startPaint && d.blinkPaint && d.lineThickness === 1.5, "defaults carry Background / Ring / Count / Tick / Fire paints + Line thickness");
gate(d.lineSmoothing === 4 && !("blinkTime" in d) && !("fillPaint" in d), "Line smoothing 0–8 is kept; no Blink time or Out lamp");

const dots = []; const rects = []; const polys = []; const feathers = new Set();
ctx.nodeGraphGlGraphParseCssColor = (css) => css;
ctx.nodeGraphCycleLineGlMetrics = () => ({ cssWidth: 240, cssHeight: 90, pixelRatio: 1 });
ctx.nodeGraphGlLinesBegin = () => ({});
ctx.nodeGraphGlLinesDot = (_b, x, y, r, f, rgba) => { feathers.add(f); dots.push({ x, y, r, rgba }); };
ctx.nodeGraphGlLinesRect = (...a) => rects.push(a);
ctx.nodeGraphGlLinesPolyline = (...a) => polys.push(a);
ctx.nodeGraphGlLinesEnd = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};
const node = { id: "cd1", params: { division: 4 }, traceDisplaySettings: {} };
ctx.nodeGraphPatchNode = () => node;
ctx.nodeGraphMvp = { live: { context: { state: "running" } } };
let engine = {};
ctx.nodeGraphModuleScopeLatestOutputValue = (_id, port, fb) => (port in engine ? engine[port] : fb);
const section = { dataset: { node: "cd1" }, querySelector: () => ({}) };
const look = ctx.normalizeNodeGraphClockDividerFaceSettings();
const frame = (count, g) => {
  engine = { __Count: count, Gate: g };
  dots.length = 0; rects.length = 0; polys.length = 0; feathers.clear();
  ctx.drawNodeGraphClockDividerFace(section);
  const centers = new Map();
  for (const p of dots.filter((p) => p.rgba !== look.backgroundPaint)) { const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`; if (!centers.has(k) || p.r > centers.get(k).r) centers.set(k, p); }
  const cells = [...centers.values()];
  const n = (c) => cells.filter((p) => p.rgba === c).length;
  return { cells, lit: n(look.dotPaint), tick: n(look.startPaint), fire: n(look.blinkPaint), ring: n(look.strokePaint) };
};
let f = frame(0, 0);
gate(f.cells.length === 4 && f.ring === 4, "division 4, count 0, gate low: 4 empty rings");
gate(rects.length === 0 && polys.length === 0, "no Out bar");
f = frame(1, 0);
gate(f.tick === 1 && f.lit === 0 && f.ring === 3, "count 1: dot 1 in the Tick colour");
f = frame(3, 0);
gate(f.lit === 2 && f.tick === 1 && f.ring === 1, "count 3 of 4: two Count dots, the newest Tick, the fire step still a ring");
f = frame(0, 1);
gate(f.fire === 4, "gate high: every dot shows Fire");
f = frame(1, 1);
gate(f.fire === 4, "Fire lasts as long as the engine gate is high (duty), not a timer");
f = frame(1, 0);
gate(f.fire === 0 && f.tick === 1, "gate low again: Fire ends");
node.params.division = 40;
f = frame(5, 0);
const rows = new Set(f.cells.map((p) => p.y.toFixed(2)));
const cols = new Set(f.cells.map((p) => p.x.toFixed(2)));
gate(f.cells.length === 40 && rows.size === 3 && cols.size === 16 && f.lit + f.tick === 5, `division 40 wraps to 3 rows of 16 (${rows.size}x${cols.size}), 5 counted`);
gate(f.cells.every((p) => p.x - p.r >= 0 && p.x + p.r <= 240 && p.y - p.r >= 0 && p.y + p.r <= 90), "dots stay inside the face");
node.params.division = 21;
f = frame(0, 0);
{
  const byRow = new Map();
  for (const p of f.cells) { const k = p.y.toFixed(2); if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(p.x); }
  const [full, part] = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, xs]) => xs.sort((a, b) => a - b));
  const mid = (xs) => (xs[0] + xs[xs.length - 1]) / 2;
  const step = (xs) => xs[1] - xs[0];
  gate(full.length === 16 && part.length === 5 && Math.abs(mid(full) - mid(part)) < 1e-6 && Math.abs(step(full) - step(part)) < 1e-6 && part.every((x, i) => i === 0 || Math.abs(x - part[i - 1] - step(full)) < 1e-6),
    `division 21: partial row of 5 centred under the 16, same spacing (mid ${mid(full).toFixed(2)} / ${mid(part).toFixed(2)})`);
}
node.params.division = 2.6; f = frame(7, 0);
gate(f.cells.length === 3 && f.tick === 1, "division rounds like the engine (2.6 -> 3); count wraps into it (7 % 3 = 1)");
node.params.division = 4;
node.traceDisplaySettings = {};
f = frame(0, 0);
gate(feathers.size === 1 && [...feathers][0] === 1, "default Line smoothing is a 1px smootherstep skirt");
node.traceDisplaySettings = { lineSmoothing: 0 };
f = frame(0, 0);
gate(feathers.size === 1 && [...feathers][0] === 0, "Line smoothing 0 is a hard core");
node.traceDisplaySettings = { lineSmoothing: 4 };
f = frame(0, 0);
gate(feathers.size === 1 && [...feathers][0] === 4, "Line smoothing 4 is the smootherstep skirt in CSS px");
node.traceDisplaySettings = {};
ctx.nodeGraphMvp.live.context.state = "suspended";
node.params.division = 4; f = frame(2, 1);
gate(f.ring === 4, "stopped: no engine state, nothing lit");

const defs = src("node-graph-module-definitions.js");
const def = defs.slice(defs.indexOf("  clockDivider: {"), defs.indexOf("  delayedTrigger: {"));
gate(/displayType: "clockDividerFace"/.test(def) && /renderer: "clockDividerFace", settingsSchema: "clockDividerFace"/.test(def), "Clock Divider uses the clockDividerFace display + settings schema");
gate(/outputs: \["Gate", "Trigger"\]/.test(def) && /outputAliases: \{ Out: "Gate" \}/.test(def), "outputs Gate + Trigger; old Out cables land on Gate");
gate(!/threshold/i.test(def.replace(/\/\/.*$/gm, "")) && /key: "amplitude", label: "Amplitude"/.test(def) && !/key: "level"/.test(def), "no Threshold; Level is now Amplitude");
const geo = src("node-graph-port-geometry.js");
gate(/NODE_GRAPH_GATE_GLYPH = "\\u25AE"/.test(geo) && /NODE_GRAPH_TRIGGER_GLYPH = "\\u238D"/.test(geo) && /lower === "gate"/.test(geo) && /lower === "trigger"/.test(geo), "Gate / Trigger port names take the shared ▮ / ⎍ marks (white digital cable)");
gate(/kind === "clockDivider" && \(raw === "Clock"/.test(geo), "Clock Divider Clock in is classified as Trigger (white ⎍)");
gate(/digitalInputs: \["Clock", "Reset"\]/.test(def), "Clock Divider Clock + Reset are digitalInputs");
gate(/gate_hit\(safeClock, &s\.lastTrigger\)/.test(fs.readFileSync(path.join(root, "native_modules/trigger_divider/trigger_divider.cpp"), "utf8")), "clockDivider Clock uses gate_hit");
gate(/clockDividerFace: Object\.freeze\(\{\s*fields: Object\.freeze\(\["lineThickness", "lineSmoothing"\]\)/.test(src("node-graph-module-scope-trace-controls.js")), "clockDividerFace settings fields: Line thickness and Line smoothing");
gate(/push\("amplitude", P\.NATIVE_GRAPH_PARAM_AMPLITUDE, cont\("amplitude", 1\)\)/.test(src("node-live-audio-worklet-native-graph.js")) && /if \(type === "clockDivider"\) return \["Trigger"\];/.test(src("node-live-audio-worklet-native-graph.js")), "worklet sends Amplitude and publishes Trigger");
const eng = fs.readFileSync(path.join(root, "native_modules/graph_engine/graph_engine.cpp"), "utf8");
gate(/kPortRight\]\[f\] = soemdsp_trigger_divider_trigger\(node\.nativeHandle\)/.test(eng) && /kPortPhase01\]\[f\] = \(double\)soemdsp_trigger_divider_count/.test(eng), "graph engine writes Trigger (Right) and the count (face port)");
gate(/if \(type === "clockDivider" && node\.params\)/.test(src("node-graph-patch-core.js")), "old patches: Level -> Amplitude, Threshold dropped");
for (const page of ["index.html", "perform.html"]) {
  gate(/modules\/clock\/clock-display\.js\?v=[^"]+"><\/script>\s*<script[^>]+modules\/clockDivider\/clock-divider-display\.js\?v=/.test(src(page)), `${page} loads clock-divider-display.js`);
}
console.log(failures ? `FAILED ${failures}` : "smoke_clock_divider_face ok");
process.exit(failures ? 1 : 0);
