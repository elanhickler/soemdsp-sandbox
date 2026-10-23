// Trigger Counter (type triggerDivider) LED: engine __Count | Division.
// Worklet must publish PHASE01 for triggerDivider (same as clockDivider) or
// the left digit stays 0. Digits use alphabetic baseline so DSEG ink sits
// on the bar midline (GL "middle" + TEXT_ASCENT 0.8 leaves them high).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const wk = src("node-live-audio-worklet-native-graph.js");
gate(/if \(type === "clockDivider" \|\| type === "triggerDivider"\) \{\s*return \["__Count"\];/.test(wk),
  "PHASE01 names __Count for triggerDivider");
gate(/const publishOneNativeOut[\s\S]*?type === "clockDivider" \|\| type === "triggerDivider"[\s\S]*?audioPorts\.concat\(P\.NATIVE_GRAPH_PORT_PHASE01\)/.test(wk),
  "publishOneNativeOut includes PHASE01 for triggerDivider");
gate(/type === "clockDivider" \|\| type === "triggerDivider"\s*\) \{\s*ports = facePorts\.concat\(P\.NATIVE_GRAPH_PORT_PHASE01\)/.test(wk),
  "face taps include PHASE01 for triggerDivider");

const ctx = { console, Math, Number, Object, String, Array, JSON, Boolean, Infinity, NaN, CSS: { escape: (s) => s } };
vm.createContext(ctx);
vm.runInContext(src("modules/triggerDivider/trigger-divider-display.js"), ctx);

const texts = [];
const rects = [];
ctx.nodeGraphGlGraphParseCssColor = (css) => css;
ctx.nodeGraphCycleLineGlMetrics = () => ({ cssWidth: 240, cssHeight: 90, pixelRatio: 1 });
ctx.nodeGraphGlLinesBegin = () => ({});
ctx.nodeGraphGlLinesMeasureText = (t, px) => px * 0.7 * String(t).length;
ctx.nodeGraphGlLinesText = (_b, t, x, y, opt) => { texts.push({ t, x, y, opt }); };
ctx.nodeGraphGlLinesRect = (...a) => rects.push(a);
ctx.nodeGraphGlLinesEnd = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};
ctx.nodeGraphClockDividerFaceSettingsForNode = () => ({
  backgroundPaint: "#030508", dotPaint: "#ffb000", blinkPaint: "#ffe56a",
});
const node = { id: "td1", params: { division: 4 }, traceDisplaySettings: {} };
ctx.nodeGraphPatchNode = () => node;
ctx.nodeGraphMvp = { live: { context: { state: "running" } } };
let engine = {};
ctx.nodeGraphModuleScopeLatestOutputValue = (_id, port, fb) => (port in engine ? engine[port] : fb);
const section = { dataset: { node: "td1" }, querySelector: () => ({}) };

const frame = (count, out) => {
  engine = { __Count: count, Out: out };
  texts.length = 0;
  rects.length = 0;
  ctx.drawNodeGraphTriggerDividerFace(section);
  return { texts: texts.map((p) => ({ ...p })), rects: rects.slice() };
};

let f = frame(0, 0);
gate(f.texts.length === 2 && f.texts[0].t === "0" && f.texts[1].t === "4", "count 0 | division 4");
f = frame(1, 0);
gate(f.texts[0].t === "1" && f.texts[1].t === "4", "count rises with __Count");
f = frame(3, 0);
gate(f.texts[0].t === "3", "count 3 of 4");
f = frame(4, 0);
gate(f.texts[0].t === "4", "face shows engine __Count as published (no extra wrap)");
engine = {};
f = frame(undefined, 0);
gate(f.texts[0].t === "0" && f.texts[1].t === "4", "missing __Count draws 0 | division");

f = frame(1, 0);
const bar = f.rects[0];
gate(bar && f.texts.every((p) => p.opt?.baseline === "alphabetic"), "digits use alphabetic baseline");
const mid = bar[2] + bar[4] * 0.5;
gate(f.texts.every((p) => Math.abs(p.y - (mid + (p.opt.px * 0.80) * 0.5)) < 0.51),
  `digit alphabetic y is ink-centered on the bar (textY=${f.texts[0].y.toFixed(2)} barMid=${mid.toFixed(2)})`);
node.params.division = 29;
f = frame(1, 0);
gate(f.texts[0].t === "1" && f.texts[1].t === "29" && f.texts[0].opt.align === "right",
  "count 1 | 29: no zero pad, count right-aligned in a 2-digit slot");
gate(f.texts[0].x + 1e-6 >= f.texts[0].opt.px * 0.7, "1 | 29 leaves a 2-digit counter column");
node.params.division = 4;
f = frame(345, 0);
gate(f.texts[0].t === "345" && f.texts[1].t === "4" && f.texts[0].opt.align === "right",
  "count 345 | 4: no zero pad, count right-aligned in a 3-digit slot");
gate(f.texts[0].x + 1e-6 >= f.texts[0].opt.px * 0.7 * 3, "345 | 4 leaves a 3-digit counter column");

for (const page of ["index.html", "perform.html"]) {
  gate(/trigger-divider-display\.js\?v=/.test(src(page)), `${page} loads trigger-divider-display.js`);
}
gate(/node-live-audio-worklet-native-graph\.js\?v=/.test(src("node-graph-live-runtime.js")),
  "worklet cache-bust present");

console.log(failures ? `FAILED ${failures}` : "smoke_trigger_divider_face ok");
process.exit(failures ? 1 : 0);
