// Smoke: native WebGL controller faces (Knob, Slider, Toggle, Momentary).
// Gates: the face files hold no display-GL contract hit and none of the old
// 2D / image-layer / CSS-var styling symbols; they draw through
// gl-line-renderer via modules/_shared/controller-face-gl.js; every draw call
// at a 2x face box is exactly 2x the zoom-1 call (canvas tiles scale, never
// reflow); a GL failure goes through nodeGraphDisplayGlFailed; older patches'
// dropped settings normalize to the new models without errors; and the knob
// left the shrink-only allowlist.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const PATTERNS = [
  /getContext\(\s*["']2d/,
  /createElement\(\s*["']canvas|new OffscreenCanvas/,
  /\b\w*[cC]anvas\w*\.(?:width|height)\s*=(?!=)/,
  /imageSmoothing/,
  /image-rendering|imageRendering/,
  /devicePixelRatio/,
];
const SHARED = "public/modules/_shared/controller-face-gl.js";
const FACES = {
  [SHARED]: [],
  "public/modules/knob/knob-face.js": [
    "node-knob-face-layer", "nodeGraphKnobFaceApplyMacroStyle", "--macro-arc", "node-macro-knob-dial",
    "normalizeNodeGraphKnobFace(", "nodeGraphKnobFaceMaybeStripSilverEdge", "has-image",
  ],
  "public/modules/slider/slider-face.js": [
    "nodeGraphSliderFacePlacePin", "nodeGraphSliderFaceApplyStyle", "data-pin-anchor", "node-macro-knob-dial",
  ],
  "public/modules/plugin/plugin-button-settings.js": [
    "nodeGraphPluginButtonPaintFace", "--plugin-btn-", "buttonPadLeft", "labelAlign", "cornerShape",
  ],
  "public/modules/plugin/plugin-controls-ui.js": ["btn-fit", "node-plugin-button-label", "--plugin-btn-"],
};
for (const [rel, gone] of Object.entries(FACES)) {
  const src = read(rel);
  const hits = PATTERNS.filter((re) => re.test(src)).map(String);
  gate(hits.length === 0, `${rel}: no display-GL contract hit ${hits.join(" ")}`);
  for (const sym of gone) gate(!src.includes(sym), `${rel}: old symbol gone (${sym})`);
}
const shared = read(SHARED);
for (const fn of ["nodeGraphGlLinesBegin", "nodeGraphGlLinesEnd", "nodeGraphGlLinesText", "nodeGraphGlLinesPolyline", "nodeGraphDisplayGlFailed", "nodeGraphDisplayCanvasSize", "nodeGraphDisplayCanvasCreate"]) {
  gate(shared.includes(fn), `controller-face-gl uses ${fn}`);
}
gate(read("public/modules/knob/knob-face.js").includes("nodeGraphControllerFacePaint(face, \"knob\""), "knob paints through nodeGraphControllerFacePaint");
gate(read("public/modules/slider/slider-face.js").includes("nodeGraphControllerFacePaint(face, \"slider\""), "slider paints through nodeGraphControllerFacePaint");
gate(read("public/modules/plugin/plugin-controls-ui.js").includes("nodeGraphControllerFacePaint(face, \"button\""), "buttons paint through nodeGraphControllerFacePaint");

// Draw recorder: run the real face painter on a fake shared-GL API.
function runPaint(kind, model, w, h, { failBegin = false } = {}) {
  const calls = [];
  const failed = [];
  const rec = (name) => (...args) => { calls.push([name, ...args.slice(1)]); };
  const sandbox = {
    performance: { now: () => 0 },
    nodeGraphGlLinesCss: (c) => [0.5, 0.5, 0.5, 1],
    nodeGraphGlLinesBegin: () => (failBegin ? null : { batch: true }),
    nodeGraphGlLinesEnd: () => true,
    nodeGraphGlLinesTriangle: rec("Triangle"),
    nodeGraphGlLinesSegment: rec("Segment"),
    nodeGraphGlLinesDot: rec("Dot"),
    nodeGraphGlLinesPolyline: rec("Polyline"),
    nodeGraphGlLinesRect: rec("Rect"),
    nodeGraphGlLinesText: (b, str, x, y, o) => calls.push(["Text", str, x, y, o.px, o.maxWidth]),
    nodeGraphDisplayCanvasCreate: () => ({ setAttribute() {} }),
    nodeGraphDisplayCanvasSize: () => ({ width: w, height: h, cssWidth: w, cssHeight: h, pixelRatio: 1 }),
    nodeGraphDisplayGlFailed: (target, reason) => failed.push(reason),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(shared, sandbox, { filename: SHARED });
  const canvas = { setAttribute() {} };
  const face = { querySelector: () => canvas, prepend() {} };
  const layout = sandbox.nodeGraphControllerFacePaint(face, kind, model);
  return { calls, failed, layout };
}
// Geometry args per call (feather / AA widths stay device-px and are skipped).
function geometry(call) {
  const [name, ...a] = call;
  if (name === "Triangle") return a.slice(0, 6);
  if (name === "Segment") return a.slice(0, 5);
  if (name === "Dot") return a.slice(0, 3);
  if (name === "Polyline") return [...a[0]];
  if (name === "Text") return a.slice(1, 5);
  if (name === "Rect") return a.slice(0, 4);
  return [];
}
const MODELS = {
  knob: { settings: { labelPosition: "top", valuePosition: "bottom", innerRadius: 0.72 }, background: "#000", fill: "#f1b84b", track: "#3a3428", text: "#ddd", span: 270, zero: 0, unit: 0.63, ghost: 0.8, value: "bottom", labelText: "Cutoff", valueText: "0.63" },
  knobMid: { settings: { labelPosition: "bottom", valuePosition: "mid", innerRadius: 0.5 }, background: "#000", fill: "#f1b84b", track: "#3a3428", text: "#ddd", span: 300, zero: 0.5, unit: 0.2, value: "mid", labelText: "Pan", valueText: "-0.6" },
  slider: { settings: { sliderShowLabel: true, sliderShowUnit: true, sliderRounding: 0.47 }, background: "#000", fill: "#5491ab", track: "#1a2226", text: "#cad3d8", numberColor: "#fff", zero: 0, unit: 0.37, ghost: 0.5, labelText: "Mix", unitText: "dB", valueText: "-6.0" },
  button: { settings: { showLabel: true, rounding: 0.18, strokeScale: 0.06 }, background: "#000", strokeColor: "#5c5071", hoverColor: "#89bfc2", inactiveColor: "#1a2228", activeColor: "#2f8f86", textColor: "#fff", mix: 1, hover: true, held: false, caption: "On", labelText: "Gate" },
};
for (const [name, model] of Object.entries(MODELS)) {
  const kind = name.startsWith("knob") ? "knob" : name;
  const one = runPaint(kind, model, 113, 97);
  const two = runPaint(kind, model, 226, 194);
  gate(one.calls.length > 3 && one.calls.length === two.calls.length, `${name}: same draw list at 1x and 2x (${one.calls.length} calls)`);
  let worst = 0;
  one.calls.forEach((c, i) => {
    const g1 = geometry(c);
    const g2 = geometry(two.calls[i] || [c[0]]);
    g1.forEach((v, k) => { worst = Math.max(worst, Math.abs(g2[k] - 2 * v)); });
  });
  gate(worst < 1e-9, `${name}: every draw call is exactly 2x in a 2x box (max err ${worst.toExponential(1)})`);
  const r1 = one.layout?.rects || {};
  const r2 = two.layout?.rects || {};
  const rectErr = Object.keys(r1).reduce((m, k) => Math.max(m, ...["x", "y", "w", "h"].map((f) => Math.abs(r2[k][f] - 2 * r1[k][f]))), 0);
  gate(Object.keys(r1).length > 0 && rectErr < 1e-9, `${name}: DOM hit rects scale exactly 2x`);
  const bad = runPaint(kind, model, 113, 97, { failBegin: true });
  gate(bad.failed.length === 1 && bad.calls.length === 0, `${name}: GL failure reports through nodeGraphDisplayGlFailed, no 2D fallback`);
}

// Settings models: older patches load, dropped keys fall away.
{
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of ["public/node-graph-module-scope-defaults.js", "public/node-graph-module-scope-normalize.js"]) {
    try { vm.runInContext(read(rel), sandbox, { filename: rel }); } catch (_) { /* later globals optional */ }
  }
  const legacyKnob = { dialSize: 0.5, dialOffsetY: 0.3, labelSize: 0.4, valueSize: 0.1, valueOffsetY: 0.2, valuePosition: "midknob", labelPosition: "mid", rotationDegrees: 1080, innerRadius: 0, arcFill: "#ff0000", backgroundColor: "#123456" };
  let k = null;
  try { k = vm.runInContext("normalizeNodeGraphKnobFaceDisplaySettings", sandbox)(legacyKnob); } catch (e) { gate(false, `knob normalize threw ${e.message}`); }
  if (k) {
    gate(!("dialSize" in k) && !("valueOffsetY" in k) && !("labelSize" in k), "knob: dropped layout keys are gone");
    gate(k.valuePosition === "mid" && k.labelPosition === "top", "knob: legacy midknob / mid positions map to mid / top");
    gate(k.rotationDegrees === 360 && k.innerRadius === 0.3, "knob: span and inner radius clamp to the new ranges");
    gate(k.arcFill === "#ff0000" && k.background === "#123456" && /^#/.test(k.textColor), "knob: colors carry over, textColor defaults");
  }
  const legacySlider = { sliderLength: 0.4, sliderAlign: "top", sliderLabelAlign: "bottomright", sliderUnitColor: "#00ff00", sliderCornerShape: "square", sliderShowUnit: false, sliderColor: "#abcdef" };
  let s = null;
  try { s = vm.runInContext("normalizeNodeGraphSliderFaceDisplaySettings", sandbox)(legacySlider); } catch (e) { gate(false, `slider normalize threw ${e.message}`); }
  if (s) {
    gate(["sliderLength", "sliderAlign", "sliderLabelAlign", "sliderUnitColor", "sliderCornerShape"].every((key) => !(key in s)), "slider: dropped layout keys are gone");
    gate(s.sliderShowUnit === false && s.sliderColor === "#abcdef", "slider: kept keys carry over");
  }
}
{
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(read("public/modules/plugin/plugin-button-settings.js"), sandbox);
  const b = vm.runInContext("normalizeNodeGraphPluginButtonDisplaySettings", sandbox)({ buttonPadLeft: 0.3, fontSize: 90, labelAlign: "bottomright", cornerShape: "square", rounding: 40, strokeColor: "#abc", onText: "Run" }, "toggleButtonFace");
  gate(["buttonPadLeft", "fontSize", "labelAlign", "cornerShape", "labelSize", "labelPadding"].every((key) => !(key in b)), "buttons: dropped keys are gone");
  gate(b.rounding === 0.4 && b.strokeColor === "#aabbcc" && b.onText === "Run" && b.backgroundColor === "#000000", "buttons: legacy percent rounding, colors and captions carry over");
  const m = vm.runInContext("normalizeNodeGraphPluginButtonDisplaySettings", sandbox)(undefined, "momentaryButtonFace");
  gate(m.offText === "Gate" && m.onText === "Gate", "momentary defaults to Gate caption");
}

// Allowlist: the knob is converted; nothing else was added.
{
  const lines = read("scripts/display_gl_allowlist.txt").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  gate(!lines.some((l) => l.includes("knob-face.js")), "allowlist: knob-face.js removed");
  gate(lines.length === 3, `allowlist: 3 entries left (${lines.length})`);
}
// Wiring: shared helper loads before the faces; the image-layer menu is gone.
for (const html of ["public/index.html", "public/perform.html"]) {
  const src = read(html);
  const a = src.indexOf("modules/_shared/controller-face-gl.js");
  const b = src.indexOf("modules/knob/knob-face.js");
  gate(a > 0 && a < b, `${html}: controller-face-gl.js loads before knob-face.js`);
  gate(!src.includes("nodeSceneKnobFaceControls"), `${html}: knob image-layer context controls removed`);
}

console.log(failures ? `\n${failures} failure(s)` : "\nall controller face GL gates passed");
process.exit(failures ? 1 : 0);
