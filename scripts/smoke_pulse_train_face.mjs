// Pulse Train condensed face: nine widget rows under the GL pulse-curve plate.
// DSP stays Frequency + Duty (no Time / End Delay seconds knobs). Shape is a slider.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
const b0 = defs.indexOf("\n  pulseTrain: {\n");
if (b0 < 0) throw new Error("pulseTrain def missing");
const next = /\n  [A-Za-z0-9_]+: \{\n/g;
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
  { kind: "cells", params: [["count", "Count"], ["frequency", "Freq"], ["duty", "Duty"]] },
  { kind: "cells", params: [["curve", "Curve", "bipolar"], ["ampStart", "A Start"], ["ampEnd", "A End"], ["ampCurve", "A Crv", "bipolar"]] },
  { kind: "slider", param: "pulseMode" },
  { kind: "choices", param: "mode", labels: ["One shot", "Loop"] },
  { kind: "choices", param: "recalculateOnTrigger", labels: ["Free", "Latch"] },
  { kind: "slider", param: "wave" },
  { kind: "cells", params: [["morph", "Morph"], ["amplitude", "Amp"]] },
  { kind: "choices", param: "antialiasing", labels: ["Off", "Random", "Dither"] },
  { kind: "seed", param: "seed" },
];

check(d.layout === "pulseCurve" && d.displayType === "pulseTrainFace" && d.defaultDisplayMode === "face", "GL pulse-curve plate stays (layout pulseCurve / pulseTrainFace)");
check(JSON.stringify(d.inputs) === JSON.stringify(["Trigger", "f"]), "jacks: Trigger, ƒ");
check(JSON.stringify(d.outputs) === JSON.stringify(["Shape", "Trigger", "End"]), "jacks: Shape, Trigger, End");
check(Array.isArray(d.face) && d.face.length === 9, `face has 9 rows (got ${d.face?.length})`);

for (let i = 0; i < want.length; i += 1) {
  const row = d.face?.[i] || {};
  const spec = want[i];
  check(row.kind === spec.kind, `row ${i} kind ${spec.kind}`);
  if (spec.params) {
    check(JSON.stringify(row.params) === JSON.stringify(spec.params), `row ${i} cells ${spec.params.map((c) => c[1]).join(" | ")}`);
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
check(d.face.find((r) => r.param === "wave")?.kind === "slider", "Shape is a slider (10 grains)");
check(keys.wave?.choices?.length === 10, "Shape has 10 grains");
check(keys.frequency?.unit === "Hz" && keys.duty?.label === "Pulse Duty", "Freq is Hz, Duty is Pulse Duty");
check(keys.pulseMode?.label === "Fwd-Rev" && keys.pulseMode?.max === "1" && keys.pulseMode?.step === "any" && !keys.pulseMode?.choices, "Fwd-Rev is a 0..1 slider");

for (const page of ["index.html", "perform.html"]) {
  const html = fs.readFileSync(path.join(root, "public", page), "utf8");
  check(/node-graph-module-definitions\.js\?v=pt-fwdrev-1/.test(html), `${page} cache-bust pt-fwdrev-1`);
  check(/node-graph-pulse-train-display\.js\?v=pt-fwdrev-1/.test(html), `${page} cache-bust pt-fwdrev-1`);
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
