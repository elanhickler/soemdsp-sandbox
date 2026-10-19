// One-shot (DO-4b): rename every Input module id to "audioInput" (normalize now
// rejects any other id) and rewrite every reference to the old id. Run once on
// the repo patches, then delete this script. No runtime shim.
//   node scripts/migrate_audio_input_id.mjs [--write]
import fs from "fs";
import path from "path";

const DIRS = ["patches", "public/presets", "saved-patches", "library", "fixtures"];
const write = process.argv.includes("--write");
const report = { files: 0, patches: 0, inputNodes: 0, renamed: [] };

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}

// Every patch object (top level and nested, e.g. circuitPatches) has a nodes array.
function patchesIn(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => patchesIn(v, out));
  else if (value && typeof value === "object") {
    if (Array.isArray(value.nodes) && value.nodes.some((n) => n && typeof n === "object" && "type" in n)) out.push(value);
    for (const key of Object.keys(value)) if (key !== "nodes") patchesIn(value[key], out);
  }
  return out;
}

// Replace string values equal to oldId anywhere under the patch (node refs:
// connections, modulations, graphConnections, bypassedNodes, view tiles, ui items).
function renameRefs(value, oldId, newId) {
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, oldId, newId));
  if (value && typeof value === "object") {
    const next = {};
    for (const [k, v] of Object.entries(value)) next[k] = renameRefs(v, oldId, newId);
    return next;
  }
  return value === oldId ? newId : value;
}

for (const file of DIRS.flatMap((d) => walk(d, []))) {
  report.files += 1;
  const text = fs.readFileSync(file, "utf8");
  let data;
  try { data = JSON.parse(text); } catch { continue; }
  let changed = false;
  for (const patch of patchesIn(data)) {
    report.patches += 1;
    const inputs = patch.nodes.filter((n) => n?.type === "audioInput");
    report.inputNodes += inputs.length;
    if (inputs.length > 1) throw new Error(`${file}: ${inputs.length} Input modules (unique per patch)`);
    const input = inputs[0];
    if (!input || input.id === "audioInput") continue;
    if (patch.nodes.some((n) => n !== input && n?.id === "audioInput")) throw new Error(`${file}: id audioInput taken`);
    const oldId = input.id;
    Object.assign(patch, renameRefs({ ...patch }, oldId, "audioInput"));
    report.renamed.push(`${file}: ${oldId} -> audioInput`);
    changed = true;
  }
  if (changed && write) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const indent = /^\{\r?\n( +)/.exec(text)?.[1]?.length ?? 2;
    fs.writeFileSync(file, JSON.stringify(data, null, indent).replace(/\n/g, eol) + (/\r?\n$/.test(text) ? eol : ""));
  }
}
console.log(JSON.stringify({ write, ...report }, null, 1));
