// One-shot patch migration. Load each patch through node-graph-patch-migrations.js,
// write the current format back, then prove a second pass is a no-op.
//
//   node scripts/migrate_all_patches.js --check [dir ...]
//   node scripts/migrate_all_patches.js --write [--strip-stamps] [dir ...]
//
// Default dirs: patches, public/presets, saved-patches.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const STAMPS = new Set([
  "_slopeUnit",
  "_wfBasic",
  "_freqMathBipolar",
  "_freqSkewCurve",
  "_slopeModel",
  "_bubbleSlim",
  "_cutoffHz",
]);

const root = path.resolve(__dirname, "..");
const migPath = path.join(root, "public", "node-graph-patch-migrations.js");

function nodeGraphFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const sandbox = {
  nodeGraphFiniteNumber,
  nodeGraphPatchFormat: Object.freeze({
    kind: "soemdsp-sandbox-node-patch",
    version: 2,
  }),
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(migPath, "utf8"), sandbox, { filename: migPath });

function sealConvertedDecibels(patch) {
  if (!patch || !Array.isArray(patch.nodes)) return patch;
  let changed = false;
  const nodes = patch.nodes.map((node) => {
    if (!node || typeof node !== "object") return node;
    const keys = node.type === "output"
      ? ["volume"]
      : (node.type === "midSideEncode" ? ["midGain", "sideGain"] : []);
    if (!keys.length) return node;
    const meta = node.paramMeta && typeof node.paramMeta === "object" ? { ...node.paramMeta } : {};
    let nodeChanged = false;
    for (const key of keys) {
      const entry = meta[key];
      const kind = String(entry?.kind || "").trim().toLowerCase();
      if (kind === "decibels") continue;
      if (entry) continue;
      const value = Number(node.params?.[key]);
      if (!Number.isFinite(value)) continue;
      meta[key] = { kind: "decibels" };
      nodeChanged = true;
    }
    if (!nodeChanged) return node;
    changed = true;
    return { ...node, paramMeta: meta };
  });
  return changed ? { ...patch, nodes } : patch;
}

function migrate(patch) {
  return sealConvertedDecibels(sandbox.migrateNodeGraphPatchToCurrent(patch));
}

function stripStamps(value) {
  if (Array.isArray(value)) return value.map(stripStamps);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (STAMPS.has(key)) continue;
    next[key] = stripStamps(child);
  }
  return next;
}

function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function detectIndent(text) {
  const match = text.match(/\n( +|\t+)\S/);
  return match ? match[1] : "  ";
}

function stringify(value, indent, newline) {
  const json = JSON.stringify(value, null, indent);
  const body = newline === "\r\n" ? json.replace(/\n/g, "\r\n") : json;
  return body.endsWith(newline) ? body : body + newline;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith(".json") && path.basename(full) !== "index.json") out.push(full);
  }
}

function isPatch(value) {
  return Boolean(value) && typeof value === "object" && Array.isArray(value.nodes);
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const check = args.includes("--check") || !write;
const strip = args.includes("--strip-stamps");
const dirs = args.filter((arg) => !arg.startsWith("--"));
const targets = (dirs.length ? dirs : ["patches", "public/presets", "saved-patches"])
  .map((dir) => path.resolve(root, dir));

const files = [];
for (const dir of targets) walk(dir, files);

let changed = 0;
let failed = 0;
let skipped = 0;
const problems = [];

for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(original);
  } catch (error) {
    failed += 1;
    problems.push(`${file}: JSON ${error.message}`);
    continue;
  }
  if (!isPatch(parsed)) {
    skipped += 1;
    continue;
  }
  let next;
  try {
    next = migrate(parsed);
    if (strip) next = stripStamps(next);
  } catch (error) {
    failed += 1;
    problems.push(`${file}: migrate ${error.message}`);
    continue;
  }
  let again;
  try {
    again = migrate(strip ? stripStamps(next) : next);
    if (strip) again = stripStamps(again);
  } catch (error) {
    failed += 1;
    problems.push(`${file}: second pass ${error.message}`);
    continue;
  }
  const indent = detectIndent(original);
  const newline = detectNewline(original);
  const first = stringify(next, indent, newline);
  const second = stringify(again, indent, newline);
  if (first !== second) {
    failed += 1;
    problems.push(`${file}: second pass changed the patch`);
    continue;
  }
  if (first !== (original.endsWith(newline) ? original : original + newline) && first !== original) {
    changed += 1;
    if (write) fs.writeFileSync(file, first);
    else problems.push(`would write ${path.relative(root, file)}`);
  }
}

const mode = write ? "write" : "check";
console.log(`migrate_all_patches ${mode}: ${files.length} json, ${changed} changed, ${skipped} not patches, ${failed} failed`);
if (!write) {
  for (const line of problems.slice(0, 40)) console.log(line);
  if (problems.length > 40) console.log(`... ${problems.length - 40} more`);
}
if (failed) process.exit(1);
if (check && !write && changed) process.exit(2);
