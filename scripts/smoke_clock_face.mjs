// Clock face: closed gate rectangle, vertical symmetry, fill only while the
// playhead is in the gate, Display Settings HBS (Background/Pulse/Playhead/Fill)
// and one thickness for gate + playhead; Phase is a horizontal face slider.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let failures = 0;
const gate = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures += 1;
};

const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN, CSS: { escape: (s) => s } };
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
ctx.performance = { now: () => 0 };
ctx.requestAnimationFrame = () => 0;
vm.createContext(ctx);
const visual = src("node-graph-visual-utils.js");
for (const name of ["nodeGraphHueUnitRgb01", "nodeGraphHueBrightnessRgb01", "nodeGraphHueBrightnessCss"]) {
  const m = visual.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
  vm.runInContext(m[0], ctx);
}
vm.runInContext(src("modules/ellipsoid/ellipsoid-settings.js"), ctx);
vm.runInContext(src("modules/clock/clock-display.js"), ctx);

const d = ctx.normalizeNodeGraphClockFaceSettings();
gate(d.lineThickness === 2 && d.fillPaint && d.strokePaint && d.dotPaint && d.backgroundPaint, "defaults carry pulse / playhead / fill / background paints + thickness");
const custom = ctx.normalizeNodeGraphClockFaceSettings({ fillHue: 120, fillBrightness: 0.5, fillSaturation: 1, lineThickness: 5 });
gate(custom.fillHue === 120 && custom.fillPaint === "rgb(0 255 0)" && custom.lineThickness === 5, `fill HBS survives normalize (${custom.fillPaint})`);

// Draw with stubbed GL; capture primitives.
const polys = []; const segs = []; const rects = []; let bg = null;
ctx.nodeGraphGlGraphParseCssColor = (css) => css;
ctx.nodeGraphCycleLineGlMetrics = () => ({ cssWidth: 200, cssHeight: 80, pixelRatio: 1 });
ctx.nodeGraphGlLinesBegin = (_c, color) => { bg = color; return {}; };
ctx.nodeGraphGlLinesPolyline = (_b, pts, half, _f, rgba) => polys.push({ pts, half, rgba });
ctx.nodeGraphGlLinesSegment = (_b, x0, y0, x1, y1, half, _f, rgba) => segs.push({ x0, y0, x1, y1, half, rgba });
ctx.nodeGraphGlLinesRect = (_b, x, y, w, h, rgba) => rects.push({ x, y, w, h, rgba });
ctx.nodeGraphGlLinesEnd = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};
let params = {};
const node = { id: "c1", params, traceDisplaySettings: { lineThickness: 3, fillHue: 120, fillBrightness: 0.5, fillSaturation: 1 } };
ctx.nodeGraphPatchNode = () => node;
ctx.nodeGraphMvp = { live: { context: { state: "running", currentTime: 0, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) } } };
let livePhase = 0.25;
ctx.nodeGraphModuleScopeLatestOutputValue = () => livePhase;
const section = { dataset: { node: "c1" }, querySelector: () => ({}) };
const draw = (p, phase) => {
  Object.assign(node.params, p); livePhase = phase;
  polys.length = 0; segs.length = 0; rects.length = 0;
  section._clockAnchorValue = undefined;
  ctx.drawNodeGraphClockFace(section);
};
const look = ctx.normalizeNodeGraphClockFaceSettings(node.traceDisplaySettings);

draw({ pulseStart: 0.1, pulseEnd: 0.6, amplitude: 0.5, rate: 0 }, 0.3);
gate(bg === look.backgroundPaint, "background uses the Background HBS");
const gp = polys[0]?.pts || [];
gate(polys.length === 1 && gp[0] === gp[gp.length - 2] && gp[1] === gp[gp.length - 1], "gate is one closed rectangle (bottom stroke present)");
const ys = gp.filter((_, i) => i % 2 === 1);
const top = Math.min(...ys); const bot = Math.max(...ys);
gate(Math.abs(top - (80 - bot)) < 1e-9, `vertical margins equal at Amp 0.5 (${top.toFixed(2)} / ${(80 - bot).toFixed(2)})`);
gate(polys[0].rgba === look.strokePaint && polys[0].half === 1.5, "gate stroke = Pulse HBS, half of Line thickness");
const head = segs[segs.length - 1];
gate(head.half === polys[0].half && head.rgba === look.dotPaint && head.y0 === top && head.y1 === bot, "playhead = Playhead HBS, same thickness and height as the gate");
gate(rects.length === 1 && rects[0].rgba === look.fillPaint && Math.abs(rects[0].x + rects[0].w - head.x0) < 1e-9 && Math.abs(rects[0].x - Math.min(...gp.filter((_, i) => i % 2 === 0))) < 1e-9, "fill runs from Pulse Start to the playhead in Fill HBS");
draw({}, 0.8);
gate(rects.length === 0, "no fill once the playhead leaves the gate");
draw({ pulseStart: 0.7, pulseEnd: 0.2 }, 0.1);
gate(polys.length === 2 && rects.length === 2, "wrapped gate: two closed pieces, fill from Start across the wrap");
draw({}, 0.5);
gate(rects.length === 0, "wrapped gate: no fill outside");

const defs = src("node-graph-module-definitions.js");
gate(/\["phase", "Phase"\]\], horizontal: true/.test(defs), "Clock Phase face row is a horizontal slider");
gate(/renderer: "clockFace", settingsSchema: "clockFace"/.test(defs), "Clock face has the clockFace Display Settings schema");
const face = src("node-graph-module-face.js");
gate(face.includes("horizontal: !!row.horizontal") && face.includes("if (wd.horizontal)"), "face cells draw horizontal sliders");
const form = src("node-graph-module-scope-settings-form.js");
gate(/\["fill", "Fill", "fillHue"/.test(form) && /clock \? "Playhead"/.test(form), "Display Settings lamps: Background, Pulse, Playhead, Fill");
console.log(failures ? `FAILED ${failures}` : "smoke_clock_face ok");
process.exit(failures ? 1 : 0);
