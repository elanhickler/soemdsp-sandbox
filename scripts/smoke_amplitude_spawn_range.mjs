// Headless: app-wide policy — every amplitude-type parameter spawns with range 0…1.
// Spawn range = the definition min/max in node-graph-module-definitions.js (saved
// patches keep their own paramMeta min/max, so old wider ranges survive load).
// Amplitude-type = linear output scale: key amplitude*/amp/volume*/level*/outputLevel/
// outputGain or label Amplitude/Amp/Volume/Level/Output Level. dB-kind and choice
// params are not linear amplitude and are exempt; EXEMPT lists deliberate exceptions.
// Also: no modClamp key may exist anywhere (defs, any public JS, presets). MOD always
// clamps to the slider range; only "use real mod values" (outputDomain) passes raw.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");

// Load the defs in a sandbox; browser-only helpers it calls are stubbed.
const base = { console, Object, Array, Math, Number, String, JSON, Set, Map, Symbol, RegExp, Error, Boolean, Infinity, NaN, parseFloat, parseInt };
const stubs = new Set();
let ctx;
for (let attempt = 0; ; attempt++) {
  ctx = vm.createContext({ ...base });
  for (const s of stubs) ctx[s] = () => [];
  try { vm.runInContext(`${src}\n;globalThis.__defs = nodeGraphModuleDefinitions;`, ctx); break; } catch (err) {
    const m = /(\w+) is not defined/.exec(err.message);
    if (!m || attempt > 100) throw err;
    stubs.add(m[1]);
  }
}
const defs = ctx.__defs;

// Deliberate exceptions (borderline: not a 0…1 output level). type.key -> reason.
const EXEMPT = {
  "attenuverter.amplitude": "bipolar scale −1…+1 (inverts by design)",
  "attenumax.amplitude": "bipolar scale −1…+1 (inverts by design)",
};
const KEY_RE = /^(amplitude\d*|amp|volume\d*|level\d*|outputlevel|outlevel|outputgain|outputamplitude)$/i;
const LABEL_RE = /^(amplitude|amp|volume|level|output level|output amplitude)(\s*\d+)?(\s*\(.*\))?$/i;

const bad = [];
let checked = 0;
for (const [type, def] of Object.entries(defs)) {
  for (const p of def?.parameters || []) {
    if (!(KEY_RE.test(p.key || "") || LABEL_RE.test(String(p.label || "").trim()))) continue;
    if (p.choices || String(p.kind || "") === "decibels" || /db/i.test(String(p.unit || ""))) continue;
    const id = `${type}.${p.key}`;
    if (EXEMPT[id]) continue;
    checked++;
    const min = Number(p.min), max = Number(p.max), d = Number(p.defaultValue ?? p.min);
    if (min !== 0 || max !== 1 || !(d >= 0 && d <= 1)) bad.push(`${id} (${p.label}): min ${p.min} max ${p.max} default ${p.defaultValue}`);
  }
}
// No modClamp opt-out anywhere: scan definitions, every public JS file and presets.
const modClampHits = [];
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== "node_modules" && ent.name !== "vendor") walk(p); continue; }
    if (!/\.(js|mjs|json)$/.test(ent.name)) continue;
    if (p.includes(path.join("public", "")) && !p.endsWith(".js") && !p.includes(path.join("public", "presets"))) continue;
    fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (/modClamp/.test(line)) modClampHits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
};
walk(path.join(root, "public"));
for (const [type, def] of Object.entries(defs)) {
  for (const p of def?.parameters || []) if (p && Object.hasOwn(p, "modClamp")) modClampHits.push(`defs ${type}.${p.key}: modClamp ${p.modClamp}`);
}
if (modClampHits.length) throw new Error(`modClamp must not exist (MOD always clamps to slider range):\n  ${modClampHits.join("\n  ")}`);

if (checked < 50) throw new Error(`only ${checked} amplitude params found — matcher broken?`);
if (bad.length) throw new Error(`amplitude params must spawn 0…1:\n  ${bad.join("\n  ")}`);
console.log(`amplitude spawn range smoke ok: ${checked} amplitude params spawn 0…1 (${Object.keys(EXEMPT).length} exempt); no modClamp anywhere in public/`);
