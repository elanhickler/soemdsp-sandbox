// Pulse Train preset explorer: isolated from Sabrina, sample-browser keys, Trigger poke.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ptPath = path.join(root, "public", "modules", "pulseTrain", "pulse-train-preset-browser.js");
const sabPath = path.join(root, "public", "modules", "sabrinaReverb", "sabrina-preset-browser.js");
const keysPath = path.join(root, "public", "node-graph-keyboard-shortcuts.js");
const pt = fs.readFileSync(ptPath, "utf8");
const sab = fs.readFileSync(sabPath, "utf8");
const keys = fs.readFileSync(keysPath, "utf8");

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures += 1; console.log(`FAIL ${msg}`); }
};

check(/function pulseTrainPresetBrowserModule/.test(pt) && /\(function pulseTrainPresetBrowserModule/.test(pt), "Pulse Train browser is an IIFE");
check(!/const SABRINA_PRESET_TYPE/.test(pt), "Pulse Train does not declare SABRINA_PRESET_TYPE");
check(/globalThis\.mountPulseTrainPresetBrowser/.test(pt) && /globalThis\.pulseTrainPresetBarOffset/.test(pt), "exports mount + bar offset on globalThis");
check(/triggerNodeGraphInputWireBreakPulse\(nodeId, "Trigger"\)/.test(pt), "click/arrow pokes Trigger so the patch plays");
check(/event\.key === "ArrowDown"/.test(pt) && /event\.key === "ArrowUp"/.test(pt), "Arrow Up/Down step presets");
check(/event\.key === "Enter" && auditionId/.test(pt) && /event\.key === "Escape" && auditionId/.test(pt), "Enter loads, Esc cancels audition");
check(/if \(!auditionId\) committed = ptPresetSnapshot\(article\)/.test(pt), "audition snapshots the original patch once");
check(/function applyPreset\(pr, drag\) \{\s*if \(!pr\) return;\s*ptPresetSmartApply\(article, pr\.values, null, null, drag\);\s*\}/.test(pt),
  "applyPreset does not overwrite the cancel snapshot");
check(/key: "stretch"/.test(pt) && /key: "spacing"/.test(pt), "presets include Stretch and Spacing");
check(/One Shot Click/.test(pt), "factory example includes a one-shot click patch");
check(/nodeGraphPresetExplorerCapturesArrows/.test(keys), "graph arrow-nudge yields to the explorer");
check(/event\.key === "ArrowDown"/.test(sab) && /if \(!auditionId\) committed = sabrinaPresetSnapshot/.test(sab), "Sabrina explorer has arrows and a one-shot snapshot");
check(/function applyPreset\(pr, drag\) \{\s*if \(!pr\) return;\s*sabrinaPresetSmartApply\(article, pr\.values, null, null, drag\);\s*\}/.test(sab), "Sabrina applyPreset does not overwrite the cancel snapshot");

const ctx = vm.createContext({
  globalThis: null,
  document: { addEventListener() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  CSS: { escape: (s) => String(s) },
  nodeGraphModuleDefinitions: {
    sabrinaReverbOriginal: { parameters: [] },
    pulseTrain: { parameters: [{ key: "count", defaultValue: "12", min: "1", max: "1280" }] },
  },
});
ctx.globalThis = ctx;
vm.runInContext(sab, ctx);
const sabAll = ctx.sabrinaPresetAll;
const sabType = ctx.SABRINA_PRESET_TYPE;
vm.runInContext(pt, ctx);
check(ctx.sabrinaPresetAll === sabAll, "loading Pulse Train does not replace sabrinaPresetAll");
check(ctx.SABRINA_PRESET_TYPE === sabType, "loading Pulse Train does not replace SABRINA_PRESET_TYPE");
check(typeof ctx.mountPulseTrainPresetBrowser === "function", "mountPulseTrainPresetBrowser is a function");
check(typeof ctx.pulseTrainPresetBarOffset === "function", "pulseTrainPresetBarOffset is a function");
check(typeof ctx.mountSabrinaPresetBrowser === "function", "mountSabrinaPresetBrowser still exists");

const fakeArticle = { dataset: { nodeType: "pulseTrain" }, querySelector: () => null };
check(ctx.pulseTrainPresetBarOffset(fakeArticle) === 26, "Pulse Train bar offset is 26px");
check(ctx.sabrinaPresetBarOffset({ dataset: { nodeType: "sabrinaReverbOriginal" }, querySelector: () => null }) === 26, "Sabrina bar offset still 26px");
check(ctx.sabrinaPresetBarOffset(fakeArticle) === 0, "Sabrina bar offset ignores Pulse Train articles");

for (const page of ["index.html", "perform.html"]) {
  const html = fs.readFileSync(path.join(root, "public", page), "utf8");
  check(html.includes("pulse-train-preset-browser.js?v=pt-preset-2"), `${page} cache-bust Pulse Train browser pt-preset-2`);
  check(html.includes("sabrina-preset-browser.js?v=sabrina-preset-2"), `${page} cache-bust Sabrina browser sabrina-preset-2`);
  check(html.includes("node-graph-keyboard-shortcuts.js?v=pt-preset-2"), `${page} cache-bust keyboard shortcuts pt-preset-2`);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall ok");
