// Smoke test for module browser search ranking (node scripts/smoke_module_search.mjs).
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const el = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : el()), apply: () => el(), construct: () => el() });
const ctx = { console, document: el(), window: undefined, localStorage: el(), navigator: el(), setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ["public/node-graph-chromeless-module-registry.js", "public/node-graph-module-definitions.js", "public/node-graph-module-store.js"]) {
  try {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8") + "\n;globalThis.__ok=1;", ctx, { filename: f });
  } catch (err) {
    console.warn(`load warning ${f}: ${err.message}`);
  }
}
const probe = vm.runInContext(`({
  catalog: typeof nodeGraphModuleStoreCatalog !== "undefined" ? nodeGraphModuleStoreCatalog : null,
  labels: typeof nodeGraphNodeLabels !== "undefined" ? nodeGraphNodeLabels : {},
  rank: typeof nodeGraphModuleStoreSearchRank === "function" ? nodeGraphModuleStoreSearchRank : null,
  family: typeof nodeGraphModuleStoreSearchFamilyPriority === "function" ? nodeGraphModuleStoreSearchFamilyPriority : null,
  norm: typeof normalizeNodeGraphModuleStoreDepartment === "function" ? normalizeNodeGraphModuleStoreDepartment : (x) => x,
})`, ctx);
if (!probe.catalog || !probe.rank || !probe.family) {
  console.error("FAIL: could not load catalog/search functions");
  process.exit(1);
}
const entries = Object.entries(probe.catalog)
  .filter(([, e]) => !e.hidden && !e.developerOnly && e.category !== "invisible")
  .map(([type, e]) => ({ ...e, type, category: probe.norm(e.category || ""), label: e.label || probe.labels[type] || type }));
const searchHits = (q) => entries
  .map((e) => ({ e, r: probe.rank(e, q) }))
  .filter((x) => x.r < 0)
  .sort((a, b) => a.r - b.r || probe.family(a.e) - probe.family(b.e) || a.e.label.localeCompare(b.e.label));
const search = (q) => searchHits(q).map((x) => x.e.label);

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error("FAIL:", msg); } else { console.log("ok:", msg); } };
const show = (q) => search(q).slice(0, 6).join(" | ");

for (const q of ["S&H", "s&h", "sh", "s and h", "S+H"]) {
  const top = search(q).slice(0, 3);
  const want = ["Sample & Hold", "Sample Delay", "Time Quantizer"];
  check(want.every((w) => top.includes(w)), `'${q}' top3 = ${top.join(" | ")}`);
}
const sample = search("sample");
check(!sample.includes("Flower Child Filter") && !sample.includes("2D Trace"), `'sample' excludes Flower Child / 2D Trace: ${show("sample")}`);

const common = {
  lowpass: /low|lp/i, env: /env|adsr/i, delay: /delay/i, reverb: /reverb|verb/i,
  kick: /kick/i, snare: /snare/i, clock: /clock/i, filter: /filter/i, noise: /noise/i, scope: /scope|trace|phosphor/i,
};
for (const [q, re] of Object.entries(common)) {
  const top = search(q)[0] || "";
  check(re.test(top), `'${q}' top = ${top}  [${show(q)}]`);
}
for (const [q, want] of [["lp", "Lowpass Filter ZDF"], ["osc", /oscillator|osc$/i]]) {
  const top5 = search(q).slice(0, 5);
  check(top5.some((l) => (typeof want === "string" ? l === want : want.test(l))), `'${q}' top5 = ${top5.join(" | ")}`);
}
for (const q of ["sine", "lp", "filter", "osc", "noise"]) {
  let lastR = null;
  let seenOther = false;
  let ok = true;
  for (const x of searchHits(q)) {
    if (x.r !== lastR) {
      lastR = x.r;
      seenOther = false;
    }
    const isFO = probe.family(x.e) === 0;
    if (!isFO) seenOther = true;
    else if (seenOther) ok = false;
  }
  check(ok, `'${q}' filters/oscillators before others at the same rank`);
}
const mathTypes = [
  "comparator", "b2u", "u2b", "bias", "divide", "inv", "minMax", "range",
  "rotate3dTo2d", "attenumax", "ampDb",
];
for (const t of mathTypes) {
  const cat = probe.norm(probe.catalog[t]?.category || "");
  check(cat === "math", `${t} category = ${cat || "(missing)"}`);
  const fam = probe.family({ category: cat });
  check(fam === 1, `${t} family priority = ${fam} (math is not filter/osc boost)`);
}
check(probe.norm("utility") === "math", `utility alias = ${probe.norm("utility")}`);
check(probe.norm("Math") === "math", `Math alias = ${probe.norm("Math")}`);
check(probe.norm(probe.catalog.sampleDelay?.category || "") === "space",
  `sampleDelay category = ${probe.norm(probe.catalog.sampleDelay?.category || "")}`);
check(probe.norm(probe.catalog.gain?.category || "") === "dynamics",
  `gain stays dynamics = ${probe.norm(probe.catalog.gain?.category || "")}`);
check(probe.norm(probe.catalog.ringMod?.category || "") === "dynamics",
  `ringMod stays dynamics = ${probe.norm(probe.catalog.ringMod?.category || "")}`);
const mathHits = search("math");
check(mathHits.includes("Comparator") || mathHits.includes("AM Index") || mathHits.includes("Range"),
  `'math' hits include a math-shelf module: ${show("math")}`);
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("module search smoke: all passed");


