#!/usr/bin/env node
// Every oscilloscope / trace-style display face exposes Scale (vertical gain)
// in Display Settings, and 1D Phosphor applies it in its vertex mapping,
// clamped to the face edge.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let failures = 0;
const fail = (m) => { failures += 1; console.error("FAIL", m); };

const spectrum = read("node-graph-module-scope-spectrum.js");
const orderSrc = spectrum.match(/const nodeGraphPhosphorDisplayFieldOrder = Object\.freeze\(\[[\s\S]*?\]\);/);
if (!orderSrc) throw new Error("nodeGraphPhosphorDisplayFieldOrder not found");
const ctx = { nodeGraphTraceDisplaySettingFields: [] };
vm.createContext(ctx);
vm.runInContext(`${orderSrc[0]}\n${read("node-graph-module-scope-trace-controls.js")}\nthis.byType = nodeGraphTraceDisplayActiveControlsByType;`, ctx);
const byType = ctx.byType;

const SCOPE_FACES = [
  "waterfall", "waterfallRgb", "waterfallXyz", "value",
  "scope1dTrace", "scope2dTrace", "scope2d", "phosphorLight",
  "lineBurn", "videoscopeBurn",
  "vectorRgbFace", "gradientVectorscopeFace",
];
// Not amplitude traces (documented exemptions).
const EXEMPT = {
  xyPad: "Scale would desync the UI puck from its trail",
  dot: "0D Phosphor Dot has no vertical position (centered energy lamp)",
  hypersawBurn: "voice-stem visualizer, not a sample trace",
  vectorDot: "LED lamp (brightness only, no trace)",
};
for (const face of SCOPE_FACES) {
  const fields = byType[face]?.fields;
  if (!fields) { fail(`${face}: no active-controls entry`); continue; }
  if (!fields.includes("scale")) fail(`${face}: Display Settings missing Scale`);
}
// Any face whose name looks scope/trace-like must be listed or exempt.
for (const face of Object.keys(byType)) {
  if (/scope|trace|burn|waterfall|vector/i.test(face) && !/spectro|imageBurn|matrix|fbm|evolve/i.test(face)
    && !SCOPE_FACES.includes(face) && !EXEMPT[face]) {
    fail(`${face}: scope/trace-like face not classified for Scale`);
  }
}


// lineBurn: Scale already lives in the vertex mapping helper; check the hook.
if (!/nodeGraphDisplaySettingsAmplitudeScale\(settings\)[\s\S]{0,120}\* amp, -1, 1\)/.test(read("node-graph-module-scope-paint-helpers.js"))) {
  fail("lineBurn: SampleToY no longer applies clamped Scale");
}
if (failures) { console.error(`smoke_scope_scale: ${failures} failure(s)`); process.exit(1); }
console.log(`smoke_scope_scale: ok (${SCOPE_FACES.length} faces expose Scale; exempt: ${Object.keys(EXEMPT).join(", ")})`);
