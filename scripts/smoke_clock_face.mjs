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
gate(Math.abs(top - (80 - bot)) < 1e-9 && Math.abs(top - (80 * 0.16 + 1.5)) < 1e-9, `vertical margins equal, Amp 0.5 does not shrink the gate (${top.toFixed(2)} / ${(80 - bot).toFixed(2)})`);
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

// Endless gate: Start 0 / End 1 never falls (native clock v7 compares fractional phase in [0, 1)).
ctx.nodeGraphMvp.live.context.sampleRate = 48000;
draw({ pulseStart: 0, pulseEnd: 1, rate: 1 }, 0.7);
const horiz = segs.filter((s) => s.y0 === s.y1);
gate(polys.length === 0 && horiz.length === 2, "100% gate: top and bottom only, no side strokes");
gate(rects.length === 1 && Math.abs(rects[0].x + rects[0].w - segs[segs.length - 1].x0) < 1e-9, "100% gate: fill from cycle start to the playhead");
draw({ pulseStart: 0, pulseEnd: 0.999, rate: 1 }, 0.5);
gate(polys.length === 1, "End short of 1 re-triggers: closed rectangle");
draw({ pulseStart: 0.001, pulseEnd: 1, rate: 1 }, 0.5);
gate(polys.length === 1, "Start past 0 re-triggers: closed rectangle");
draw({ pulseStart: 0, pulseEnd: 1, rate: 0 }, 0.5);
gate(polys.length === 0, "Rate 0 pauses (clock v8, no forced low): 100% gate stays endless");
gate(ctx.nodeGraphClockFaceGateEndless(0, 1, 2) && !ctx.nodeGraphClockFaceGateEndless(0.01, 1, 2) && ctx.nodeGraphClockFaceGateEndless(0, 1, 0), "endless rule matches native: Start 0, End 1, any rate (0 included)");
// B-104: fully open stays endless at every rate (fractional periods like 48000 / 74.2).
{
  const miss = [];
  for (const sr of [44100, 48000, 96000]) {
    for (let r10 = 1; r10 <= 20000; r10 += 1) {
      const rate = r10 / 10;
      if (!ctx.nodeGraphClockFaceGateEndless(0, 1, rate, sr)) miss.push(`${rate}@${sr}`);
    }
    for (const rate of [74.2, 74.21, 33.3, 0.7, 1999.9]) if (!ctx.nodeGraphClockFaceGateEndless(0, 1, rate, sr)) miss.push(`${rate}@${sr}`);
  }
  gate(miss.length === 0, `Start 0 / End 1 endless across 0.1..2000 Hz sweep (misses: ${miss.slice(0, 5).join(", ") || "none"})`);
  ctx.nodeGraphMvp.live.context.sampleRate = 44100;
  draw({ pulseStart: 0, pulseEnd: 1, rate: 74.2 }, 0.5);
  gate(polys.length === 0, "rate 74.2 @ 44.1 kHz at 100% open: no side strokes");
  ctx.nodeGraphMvp.live.context.sampleRate = 48000;
  const half = [];
  for (let r10 = 1; r10 <= 20000; r10 += 7) if (ctx.nodeGraphClockFaceGateEndless(0, 0.5, r10 / 10, 48000)) half.push(r10 / 10);
  gate(half.length === 0, "a half-open gate is never endless across the sweep");
}

// Every element has a control: Start marker and Blink use their own HBS, thickness and time.
const look2 = ctx.normalizeNodeGraphClockFaceSettings();
gate(look2.startPaint === "rgb(116 99 51)" && look2.blinkPaint === "rgb(254 215 102)" && look2.startThickness === 1.5 && look2.blinkTime === 0, `defaults: old start marker, gold blink color, blink off (${look2.startPaint}, ${look2.blinkPaint})`);
Object.assign(node.traceDisplaySettings, { startHue: 120, startBrightness: 0.5, startSaturation: 1, startThickness: 4, blinkHue: 240, blinkBrightness: 0.5, blinkSaturation: 1, blinkTime: 0.5 });
draw({ pulseStart: 0.1, pulseEnd: 0.6, rate: 1, phase: 0.3 }, 0.9);
const mark = segs.find((s) => s.rgba === "rgb(0 255 0)");
gate(Boolean(mark) && mark.half === 2, "Start marker uses Start HBS and Start thickness");
section._clockLast = 0.05; ctx.performance.now = () => 1000;
draw({}, 0.12);
gate(segs[segs.length - 1].rgba === "rgb(0 0 255)", "blink uses Blink HBS when T fires");
ctx.performance.now = () => 1000 + 400; draw({}, 0.1);
gate(segs[segs.length - 1].rgba === "rgb(0 0 255)", "blink lasts Blink time (still on at 0.4 s of 0.5 s)");
ctx.performance.now = () => 1000 + 600; draw({}, 0.15);
gate(segs[segs.length - 1].rgba !== "rgb(0 0 255)", "blink over after Blink time");
Object.assign(node.traceDisplaySettings, { blinkTime: 0, startThickness: 0 });
section._clockLast = 0.95; ctx.performance.now = () => 5000; draw({}, 0.05);
gate(segs[segs.length - 1].rgba !== "rgb(0 0 255)" && !segs.some((s) => s.rgba === "rgb(0 255 0)"), "Blink time 0 = no blink; Start thickness 0 = no marker");

// Blink fires on gate start (crossing Pulse Start), not on the phase wrap.
Object.assign(node.traceDisplaySettings, { blinkTime: 0.5 });
section._clockFlash = undefined; section._clockLast = 0.95; ctx.performance.now = () => 9000;
draw({ pulseStart: 0.1, pulseEnd: 0.6 }, 0.02);
gate(segs[segs.length - 1].rgba !== "rgb(0 0 255)", "no blink on the phase wrap (gate not started yet)");
section._clockLast = 0.08; draw({}, 0.11);
gate(segs[segs.length - 1].rgba === "rgb(0 0 255)", "blink when the playhead crosses Pulse Start");
section._clockFlash = undefined; section._clockLast = 0.95; ctx.performance.now = () => 20000;
draw({ pulseStart: 0 }, 0.02);
gate(segs[segs.length - 1].rgba === "rgb(0 0 255)", "Pulse Start 0: gate start is the wrap, blinks there");
section._clockFlash = undefined; section._clockLast = 0.4; ctx.performance.now = () => 30000;
draw({ pulseStart: 0, pulseEnd: 1 }, 0.6);
section._clockLast = 0.95; draw({}, 0.02);
gate(segs[segs.length - 1].rgba !== "rgb(0 0 255)", "endless gate never re-triggers: no blink");
Object.assign(node.traceDisplaySettings, { blinkTime: 0 });
// Height: % of the face height the gate spans, centered; default 68 = the old 0.16 h margins.
gate(look2.gateHeight === 68, "Height defaults to 68 %");
Object.assign(node.traceDisplaySettings, { gateHeight: 50, lineThickness: 2 });
draw({ pulseStart: 0.1, pulseEnd: 0.6, rate: 1, amplitude: 1 }, 0.3);
const hy = polys[0].pts.filter((_, i) => i % 2 === 1);
const hTop = Math.min(...hy); const hBot = Math.max(...hy);
gate(Math.abs((hBot - hTop + 2) - 40) < 1e-9 && Math.abs(hTop - (80 - hBot)) < 1e-9, `Height 50 % spans half the face, centered (${hTop}..${hBot})`);
const ph = segs[segs.length - 1];
gate(ph.y0 === hTop && ph.y1 === hBot && rects.every((r) => r.y === hTop && Math.abs(r.y + r.h - hBot) < 1e-9), "playhead + fill follow Height");
Object.assign(node.traceDisplaySettings, { gateHeight: 68 });
draw({ amplitude: 0.061 }, 0.3);
const ay = polys[0].pts.filter((_, i) => i % 2 === 1);
gate(Math.abs(Math.min(...ay) - (80 * 0.16 + 1)) < 1e-9, "Amp 0.061 (Argi's runaway triggers patch) keeps the full Height");
draw({ amplitude: 1 }, 0.3);
const oy = polys[0].pts.filter((_, i) => i % 2 === 1);
gate(Math.abs(Math.min(...oy) - (80 * 0.16 + 1)) < 1e-9, "Height 68 % matches the old 0.16 h + half-stroke margin");

const defs = src("node-graph-module-definitions.js");
gate(/\["phase", "Phase"\]\], horizontal: true/.test(defs), "Clock Phase face row is a horizontal slider");
gate(/renderer: "clockFace", settingsSchema: "clockFace"/.test(defs), "Clock face has the clockFace Display Settings schema");
const face = src("node-graph-module-face.js");
gate(face.includes("horizontal: !!row.horizontal") && face.includes("if (wd.horizontal)"), "face cells draw horizontal sliders");
const form = src("node-graph-module-scope-settings-form.js");
gate(/\["fill", "Fill", "fillHue"/.test(form) && /\["start", "Start"/.test(form) && /\["blink", "Blink"/.test(form) && /clock \? "Playhead"/.test(form), "Display Settings lamps: Background, Pulse, Playhead, Fill, Start, Blink");
console.log(failures ? `FAILED ${failures}` : "smoke_clock_face ok");
process.exit(failures ? 1 : 0);
