// Pulse Train condensed face: nine widget rows under the GL pulse-curve plate.
// DSP stays Frequency + Duty (no Time / End Delay seconds knobs). Shape is a slider.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
const b0 = defs.search(/\n  pulseTrain: \{\r?\n/);
if (b0 < 0) throw new Error("pulseTrain def missing");
const next = /\n  [A-Za-z0-9_]+: \{\r?\n/g;
next.lastIndex = b0 + 2;
const b1 = next.exec(defs).index;
const d = vm.runInNewContext("(" + defs.slice(b0 + "\n  pulseTrain: ".length, defs.lastIndexOf("}", b1) + 1) + ")", {});

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures += 1; console.log(`FAIL ${msg}`); }
};

const keys = Object.fromEntries((d.parameters || []).map((p) => [p.key, p]));
const want = [
  { kind: "cells", params: [["pulseMode", "Fwd-Rev"]], horizontal: true },
  { kind: "cells", params: [["wave", "Shape"]], horizontal: true },
  { kind: "choices", param: "antialiasing", labels: ["Quant", "Rand", "Dither"] },
  { kind: "choices", param: "recalculateOnTrigger", labels: ["Free", "Latch"] },
  { kind: "choices", param: "mode", labels: ["One shot", "Loop"] },
  { kind: "cells", params: [["morph", "Morph"], ["count", "Count"], ["duty", "Duty"], ["stretch", "Stretch"]] },
  { kind: "cells", params: [["curvePolarity", "+", "stack"], ["frequency", "ƒ"], ["curve", "ƒ Crv", "bipolar"]] },
  { kind: "choices", param: "spacing", labels: ["Expo", "Harmonic", "Rational"] },
  { kind: "cells", params: [["ampStart", "A Start"], ["ampEnd", "A End"], ["ampCurve", "A Crv", "bipolar"]] },
  { kind: "cells", params: [["amplitude", "Amp"]], horizontal: true },
  { kind: "cells", params: [["presetMorph", "Preset Morph"]], horizontal: true },
  { kind: "seed", param: "seed" },
];

check(d.layout === "pulseCurve" && d.displayType === "pulseTrainFace" && d.defaultDisplayMode === "face", "GL pulse-curve plate stays (layout pulseCurve / pulseTrainFace)");
check(JSON.stringify(d.inputs) === JSON.stringify(["Trigger", "f"]), "jacks: Trigger, ƒ");
check(JSON.stringify(d.outputs) === JSON.stringify(["Shape", "Trigger", "End"]), "jacks: Shape, Trigger, End");
check(Array.isArray(d.face) && d.face.length === 12, `face has 12 rows (got ${d.face?.length})`);

for (let i = 0; i < want.length; i += 1) {
  const row = d.face?.[i] || {};
  const spec = want[i];
  check(row.kind === spec.kind, `row ${i} kind ${spec.kind}`);
  if (spec.params) {
    check(JSON.stringify(row.params) === JSON.stringify(spec.params), `row ${i} cells ${spec.params.map((c) => c[1]).join(" | ")}`);
    if (spec.horizontal) check(row.horizontal === true, `row ${i} horizontal cell`);
    for (const cell of spec.params) check(Boolean(keys[cell[0]]), `param ${cell[0]} exists`);
  } else {
    check(row.param === spec.param, `row ${i} param ${spec.param}`);
    check(Boolean(keys[spec.param]), `param ${spec.param} exists`);
  }
  if (spec.labels) {
    check(JSON.stringify(row.labels) === JSON.stringify(spec.labels), `row ${i} labels ${spec.labels.join("/")}`);
    check((keys[spec.param]?.choices || []).length === spec.labels.length, `${spec.param} choice count matches face labels`);
  }
}

check(d.face.every((row) => !JSON.stringify(row).match(/time|endDelay|endTime/i)), "face has no Time / End Delay seconds widgets");
check(!keys.time && !keys.endDelay && !keys.endTime, "parameters stay Frequency + Duty (no Time / End Delay keys)");
check(d.face.find((r) => r.params?.[0]?.[0] === "wave")?.horizontal === true, "Shape is a horizontal cell switch (10 grains)");
check(keys.wave?.choices?.length === 10, "Shape has 10 grains");
check(keys.frequency?.unit === "Hz" && keys.duty?.label === "Pulse Duty", "ƒ is Hz, Duty is Pulse Duty");
check(keys.pulseMode?.label === "Fwd-Rev" && keys.pulseMode?.max === "1" && keys.pulseMode?.step === "any" && !keys.pulseMode?.choices, "Fwd-Rev is a 0..1 slider");
check(keys.curve?.label === "ƒ Crv" && keys.curve?.min === "-10" && keys.curve?.max === "10", "ƒ Crv is bipolar Time Curve");
check(keys.count?.max === "1280" && keys.count?.mid === "64" && keys.count?.sliderCurve === "skew", "Count slider domain 1280 mid-skew (DSP 16384)");
check(d.face[0]?.params?.[0]?.[0] === "pulseMode" && d.face[0]?.horizontal === true, "Fwd-Rev is the first face row, horizontal");
check(d.face[1]?.params?.[0]?.[0] === "wave" && d.face[1]?.params.length === 1, "Shape is its own row under Fwd-Rev");
check(d.face[2]?.kind === "choices" && d.face[2]?.param === "antialiasing", "Antialiasing is a labeled-box choice row under Shape");
check(d.face[3]?.kind === "choices" && d.face[3]?.param === "recalculateOnTrigger", "Free/Latch sits between AA and One shot/Loop");
check(d.face[4]?.kind === "choices" && d.face[4]?.param === "mode", "One shot/Loop is a labeled-box choice row under Free/Latch");
check(d.face[5]?.params?.[0]?.[0] === "morph" && d.face[5]?.params?.[1]?.[0] === "count" && d.face[5]?.params?.[3]?.[0] === "stretch", "Morph | Count | Duty | Stretch");
check(keys.stretch?.defaultValue === "1" && keys.stretch?.min === "1" && keys.stretch?.max === "8" && keys.stretch?.sliderCurve === "skew", "Stretch slider 1–8 mid-skew (DSP unclamped)");
check(d.face[6]?.params?.[0]?.[0] === "curvePolarity" && d.face[6]?.params?.[1]?.[1] === "ƒ" && d.face[6]?.params?.[2]?.[1] === "ƒ Crv", "+/- | ƒ | ƒ Crv");
check(d.face[7]?.kind === "choices" && d.face[7]?.param === "spacing", "Expo/Harmonic/Rational is a labeled-box choice row");
check(d.face[8]?.params?.[0]?.[0] === "ampStart" && d.face[8]?.params.length === 3, "A Start | A End | A Crv");
check(d.face[9]?.horizontal === true && d.face[9]?.params?.[0]?.[0] === "amplitude", "Amp is its own horizontal fill row");
check(d.face[10]?.horizontal === true && d.face[10]?.params?.[0]?.[0] === "presetMorph", "Preset Morph sits above Seed");
check(d.face[d.face.length - 1]?.kind === "seed" && d.face[d.face.length - 1]?.param === "seed", "Seed uses the shared seed row helper");
check(!d.face.some((r) => r.seed), "seed is not jammed into cells");
check(keys.curvePolarity?.choices?.[0] === "+" && keys.curvePolarity?.choices?.[1] === "\u2212" && keys.curvePolarity?.defaultValue === "0", "Curve polarity is + / \u2212, default +");
check(keys.spacing?.choices?.[0] === "Expo" && keys.spacing?.choices?.[2] === "Rational" && keys.spacing?.defaultValue === "0", "Spacing is Expo / Harmonic / Rational, default Expo");

for (const page of ["index.html", "perform.html"]) {
  const html = fs.readFileSync(path.join(root, "public", page), "utf8");
  check(/node-graph-module-definitions\.js\?v=pt-f-label-1/.test(html), `${page} cache-bust definitions pt-f-label-1`);
  check(/node-graph-module-face\.js\?v=unit-phi-1/.test(html) || /node-graph-module-face\.js\?v=player-mode-1/.test(html) || /node-graph-module-face\.js\?v=pt-face-9/.test(html), `${page} cache-bust module-face`);
  check(/node-graph-pulse-train-display\.js\?v=pt-stretch-1/.test(html), `${page} cache-bust display pt-stretch-1`);
  check(/gl-line-renderer\.js\?v=pt-dsp-16384/.test(html), `${page} cache-bust gl-line-renderer pt-dsp-16384`);
}

const display = fs.readFileSync(path.join(root, "public", "node-graph-pulse-train-display.js"), "utf8");
check(!/sched\.ghost/.test(display) && !/ghostOpacity/.test(display), "face does not draw a next-pattern ghost");
check(/in-effect \(latched\) cycle/.test(display), "face comment: plate follows the latched cycle with Latch");
check(/phase-locked/.test(display) && !/elapsed %= end/.test(display), "Loop playhead is phase-locked (no elapsed % newEnd)");
const form = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-settings-form.js"), "utf8");
const trace = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-trace-controls.js"), "utf8");
const trainFields = trace.slice(trace.indexOf("pulseTrainFace:"), trace.indexOf("robinSinepulseFace:"));
check(!form.includes('if (type === "pulseTrainFace") {\n        lamps.push(["ghost"'), "Display Settings has no Pulse Train Ghost lamp");
check(form.includes('pulseTrainFace" ? ["fadeTime"]') && trainFields.includes('"fadeTime"') && !trainFields.includes("ghostOpacity"), "Display Settings keeps Fade time, drops Ghost opacity");

console.log(failures ? `\n${failures} FAILED` : "\nsmoke_pulse_train_face ok");
process.exit(failures ? 1 : 0);
