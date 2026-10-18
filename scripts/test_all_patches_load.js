// Every bundled patch parses, is format version 2, and has no retired module type.
// The migration hook is empty, so a second pass must not be required.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const retired = new Set([
  "phosphorLight",
  "gainBias",
  "gainBiasMix",
  "additiveNoisy",
  "valueSlider",
  "graph",
  "graph2",
  "graphCopy",
]);

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".json") && name !== "index.json") out.push(full);
  }
}

const files = [];
for (const dir of ["patches", "public/presets", "saved-patches"]) {
  walk(path.join(root, dir), files);
}

let loaded = 0;
const problems = [];
for (const file of files) {
  let patch;
  try {
    patch = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${file}: ${error.message}`);
    continue;
  }
  if (!patch || !Array.isArray(patch.nodes)) continue;
  loaded += 1;
  const version = Number(patch.format?.version);
  const kind = String(patch.format?.kind || "");
  if (kind !== "soemdsp-sandbox-node-patch" || version !== 2) {
    problems.push(`${file}: format ${kind} v${version}`);
  }
  for (const node of patch.nodes) {
    const type = String(node?.type || "");
    if (retired.has(type)) problems.push(`${file}: retired type ${type}`);
  }
}

if (problems.length) {
  console.error(problems.slice(0, 30).join("\n"));
  process.exit(1);
}
console.log(`patches load: ${loaded} current-format patches`);
