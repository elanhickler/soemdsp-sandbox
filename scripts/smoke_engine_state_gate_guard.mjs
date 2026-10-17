// ES-6 (docs/ENGINE_STATE_DISPLAY_PLAN.md): static guard. Display and UI files
// must not add new reads of live.node / live.outputEnabled / live.speedMultiplier;
// ask the paint gate instead (scopePaintEngineState, scopePaintFacePolicy,
// nodeGraphFacePaintKindFor). Existing reads are baselined per file in
// scripts/engine_state_gate_allowlist.txt, which may only shrink.
// Usage: node scripts/smoke_engine_state_gate_guard.mjs [--write-baseline]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUB = path.join(ROOT, "public");
const LIST = path.join(ROOT, "scripts", "engine_state_gate_allowlist.txt");
const EXEMPT = new Set([
  "public/node-graph-module-scope-paint-gate.js",
  "public/node-graph-live-runtime.js",
]);
const READ = /\blive\??\.(node|outputEnabled|speedMultiplier)\b/g;

function isDisplayOrUi(rel) {
  const base = path.posix.basename(rel);
  return /-(display|ui)\.js$/.test(base)
    || /^node-graph-module-scope.*\.js$/.test(base)
    || /^node-graph-.*(display|face|scope|waveform|dragging|selection|gl-graph|visual).*\.js$/.test(base)
    || rel.startsWith("public/lib/visual/");
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "vendor" || e.name === "node_modules") continue;
      walk(p, out);
    } else if (e.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

const counts = new Map();
for (const file of walk(PUB)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (EXEMPT.has(rel) || !isDisplayOrUi(rel)) continue;
  let n = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*")) continue;
    n += (line.match(READ) || []).length;
  }
  if (n) counts.set(rel, n);
}

if (process.argv.includes("--write-baseline")) {
  const lines = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `${f} | ${n}`);
  fs.writeFileSync(LIST, `# ES-6 baseline: engine reads (live.node / outputEnabled / speedMultiplier) in display + UI files.\n# Shrink-only. Lower a count (or drop a line) when you remove reads; never raise one.\n${lines.join("\n")}\n`);
  console.log(`wrote ${lines.length} entries`);
  process.exit(0);
}

const allowed = new Map();
for (const line of fs.readFileSync(LIST, "utf8").split("\n")) {
  const m = /^([^#|][^|]*?)\s*\|\s*(\d+)\s*$/.exec(line.trim());
  if (m) allowed.set(m[1], Number(m[2]));
}
const fails = [];
for (const [f, n] of counts) {
  const a = allowed.get(f) ?? 0;
  if (n > a) fails.push(`${f}: ${n} engine reads (allowed ${a}). Use scopePaintEngineState / scopePaintFacePolicy from the paint gate.`);
  else if (n < a) fails.push(`${f}: ${n} engine reads but allowlist says ${a}. Shrink the allowlist.`);
}
for (const [f, a] of allowed) {
  if (!counts.has(f)) fails.push(`${f}: allowlisted (${a}) but has no engine reads. Remove the line.`);
}
if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  console.error(`${fails.length} failure(s)`);
  process.exit(1);
}
const total = [...counts.values()].reduce((s, n) => s + n, 0);
console.log(`smoke_engine_state_gate_guard ok (${counts.size} files, ${total} baselined reads)`);
