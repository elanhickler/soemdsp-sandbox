#!/usr/bin/env node
// Display GL contract, function level (hardens check_display_gl_contract in
// smoke_test.py, which only greps public/modules files).
//
// Scans every registered renderer and display draw function across public/
// (core scope files included) for Canvas2D use: getContext("2d") and 2D draw
// calls (fillRect, arc, fill, stroke, drawImage, fillText, putImageData, ...
// on a 2D context). Functions considered:
//   1. Registered renderers: nodeGraphModuleScopeCustomRenderers entries
//      (orchestrator table + every `.X = fn` registration) and
//      registerNodeGraphModuleFaceCreator(type, fn) face creators, plus every
//      uniquely named function they reach (call-graph closure).
//   2. Display draw functions by name (draw / paint / present / render /
//      stamp / blit / bake / wipe / clear / fill ...) in display code:
//      public/node-graph-module-scope-*.js, public/modules/**,
//      public/lib/visual/**, public/lib/trace/**, public/*display*.js.
// Every hit must be on scripts/display_gl_function_allowlist.txt
// (`path::function | CATEGORY | reason`, or `path::* | ...` for a whole
// approved file). The list is shrink-only: a new hit fails, and an entry that
// no longer hits (fixed, renamed or removed) fails until it is deleted.
//
//   --report   print every hit with its category and exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const allowPath = path.join(root, "scripts", "display_gl_function_allowlist.txt");
const report = process.argv.includes("--report");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

const SKIP_DIR = /(^|\/)(vendor|third_party|node_modules|wasm|fonts)(\/|$)/;
const SKIP_FILE = /worklet|\.min\.js$/;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(rel(p) + "/")) walk(p);
    } else if (e.name.endsWith(".js") && !SKIP_FILE.test(e.name)) {
      files.push(p);
    }
  }
})(pub);

const CTX2D = /getContext\(\s*["'`]2d["'`]/;
const DRAW2D = /\b(?:ctx|context|\w+Ctx|\w+Context|g2d|c2d)\s*\.\s*(fillRect|strokeRect|clearRect|arc|arcTo|ellipse|rect|roundRect|fill|stroke|drawImage|fillText|strokeText|putImageData|getImageData|createImageData|beginPath|moveTo|lineTo|quadraticCurveTo|bezierCurveTo|createLinearGradient|createRadialGradient|createConicGradient|createPattern|clip)\s*\(/;
// Self-test: the old Hypersaw / Phosphor Dot 2D lines must be caught, GL must not.
for (const [line, want] of [
  ['const context = canvas.getContext("2d");', true],
  ["context.fillRect(col.ix, 0, 1, heightPx);", true],
  ["inkCtx.fillRect(0, 0, width, height);", true],
  ["context.drawImage(ink, 0, 0);", true],
  ["gl.drawArrays(gl.TRIANGLES, 0, vertexCount);", false],
  ["verts.fill(0);", false],
]) {
  if ((CTX2D.test(line) || DRAW2D.test(line)) !== want) {
    console.error(`FAIL scanner self-test: ${line} should ${want ? "" : "not "}be flagged`);
    process.exit(1);
  }
}
const DISPLAY_FILE = /^public\/(node-graph-module-scope-[^/]+\.js|modules\/.+\.js|lib\/visual\/.+\.js|lib\/trace\/.+\.js|[^/]*display[^/]*\.js)$/;
const DRAW_NAME = /(^|[a-z])(draw|paint|present|render|stamp|blit|bake|wipe|clear|fill|stroke|composite|deposit)/i;

// Brace-matched function bodies (strings / templates / comments skipped).
function bodyEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return src.length; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) return src.length; continue; }
    if (c === "\"" || c === "'" || c === "`") {
      const q = c;
      for (i += 1; i < src.length && src[i] !== q; i += 1) {
        if (src[i] === "\\") i += 1;
        else if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
          i = bodyEnd(src, i + 1);
        }
      }
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return i; }
  }
  return src.length;
}

function parenEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "\"" || c === "'" || c === "`") {
      const q = c;
      for (i += 1; i < src.length && src[i] !== q; i += 1) if (src[i] === "\\") i += 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") { depth -= 1; if (depth === 0) return i; }
  }
  return src.length;
}

const fns = []; // { file, name, body, top }
const byName = new Map();
const DEF = /(?:^|\n)([ \t]*)(?:async\s+)?function\s*\*?\s*(\w+)\s*\(|(?:^|\n)([ \t]*)(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\b[^(]*\(|\([^)]*\)\s*=>|\w+\s*=>)/g;
const sources = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  sources.set(f, src);
  let m;
  DEF.lastIndex = 0;
  while ((m = DEF.exec(src))) {
    const name = m[2] || m[4];
    const indent = (m[1] ?? m[3] ?? "").length;
    // Skip the parameter list (default values may hold braces), then "=>".
    let at = m.index + m[0].length;
    if (m[0].endsWith("(")) at = parenEnd(src, at - 1) + 1;
    const after = /^\s*(=>)?\s*/.exec(src.slice(at, at + 200));
    at += after ? after[0].length : 0;
    const arrowExpr = src[at] !== "{";
    const open = at;
    const end = arrowExpr ? src.indexOf("\n", at) : bodyEnd(src, open);
    const body = src.slice(m.index, end < 0 ? src.length : end + 1);
    const rec = { file: rel(f), name, body, top: indent <= 2 };
    fns.push(rec);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(rec);
  }
}
const unique = (name) => (byName.get(name)?.length === 1 ? byName.get(name)[0] : null);

// Roots: registered renderers + face creators.
const roots = new Set();
const rootBodies = [];
for (const [f, src] of sources) {
  const table = src.indexOf("const nodeGraphModuleScopeCustomRenderers = {");
  if (table >= 0) {
    const end = bodyEnd(src, src.indexOf("{", table));
    rootBodies.push({ file: rel(f), name: "nodeGraphModuleScopeCustomRenderers", body: src.slice(table, end + 1) });
  }
  const reg = /nodeGraphModuleScopeCustomRenderers(?:\.(\w+)|\[[^\]]+\])\s*=\s*([\s\S]{0,400})/g;
  let m;
  while ((m = reg.exec(src))) {
    const rhs = m[2];
    const id = /^(\w+)\s*;/.exec(rhs);
    if (id && unique(id[1])) roots.add(id[1]);
    else {
      const start = m.index + m[0].length - rhs.length;
      const brace = src.indexOf("{", start);
      if (brace >= 0 && brace - start < 200) {
        rootBodies.push({ file: rel(f), name: `CustomRenderers.${m[1] || "?"}`, body: src.slice(m.index, bodyEnd(src, brace) + 1) });
      }
    }
  }
  const fc = /registerNodeGraphModuleFaceCreator\(\s*["'`][^"'`]+["'`]\s*,\s*(\w+)/g;
  while ((m = fc.exec(src))) if (unique(m[1])) roots.add(m[1]);
}
const IDENT = /\b([A-Za-z_]\w{3,})\b/g;
const pending = [...roots];
for (const rb of rootBodies) {
  let m;
  while ((m = IDENT.exec(rb.body))) if (unique(m[1])) pending.push(m[1]);
}
const reached = new Set();
while (pending.length) {
  const name = pending.pop();
  if (reached.has(name)) continue;
  const rec = unique(name);
  if (!rec) continue;
  reached.add(name);
  let m;
  IDENT.lastIndex = 0;
  while ((m = IDENT.exec(rec.body))) {
    if (m[1] !== name && unique(m[1]) && !reached.has(m[1])) pending.push(m[1]);
  }
}

const hits = new Map(); // key -> { file, name, why, how }
for (const rec of fns) {
  const viaRenderer = reached.has(rec.name) && unique(rec.name) === rec;
  const viaName = DISPLAY_FILE.test(rec.file) && DRAW_NAME.test(rec.name);
  if (!viaRenderer && !viaName) continue;
  const what = [];
  if (CTX2D.test(rec.body)) what.push("getContext('2d')");
  const d = DRAW2D.exec(rec.body);
  if (d) what.push(`2D ${d[1]}()`);
  if (!what.length) continue;
  const key = `${rec.file}::${rec.name}`;
  if (!hits.has(key)) hits.set(key, { ...rec, what, how: viaRenderer ? "renderer" : "display-name" });
}

const allowed = new Map();
for (const raw of fs.readFileSync(allowPath, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const [key, cat, ...rest] = line.split("|").map((s) => s.trim());
  if (!key || !cat || !rest.join("|")) {
    console.error(`FAIL allowlist entry needs 'path::function | CATEGORY | reason': ${line}`);
    process.exit(1);
  }
  allowed.set(key, { cat, reason: rest.join(" | ") });
}
const allowFor = (key) => allowed.get(key) || allowed.get(`${key.split("::")[0]}::*`);

if (report) {
  for (const [key, h] of [...hits].sort()) {
    const a = allowFor(key);
    console.log(`${a ? a.cat.padEnd(9) : "NEW      "} ${key}  [${h.what.join(", ")}; ${h.how}]`);
  }
  console.log(`hits ${hits.size}, renderer closure ${reached.size} functions, ${fns.length} functions scanned in ${files.length} files`);
  process.exit(0);
}
let failures = 0;
for (const [key, h] of [...hits].sort()) {
  if (!allowFor(key)) {
    failures += 1;
    console.error(`FAIL new Canvas2D use in display code: ${key} [${h.what.join(", ")}; ${h.how}] - draw through the shared GL device (or remove it)`);
  }
}
const usedFiles = new Set([...hits.keys()].map((k) => k.split("::")[0]));
for (const key of allowed.keys()) {
  const stale = key.endsWith("::*") ? !usedFiles.has(key.slice(0, -3)) : !hits.has(key);
  if (stale) {
    failures += 1;
    console.error(`FAIL display_gl_function_allowlist.txt is shrink-only; delete clean entry: ${key}`);
  }
}
if (failures) {
  console.error(`smoke_display_gl_renderers: ${failures} failure(s)`);
  process.exit(1);
}
const cats = {};
for (const key of hits.keys()) { const c = allowFor(key).cat; cats[c] = (cats[c] || 0) + 1; }
console.log(`smoke_display_gl_renderers: ok (${hits.size} Canvas2D functions, all listed: ${Object.entries(cats).map(([c, n]) => `${c} ${n}`).join(", ")}; renderer closure ${reached.size} functions)`);
