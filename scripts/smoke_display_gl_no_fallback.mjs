// Display GL policy: no silent fallbacks. GL failure -> black + one console.error
// per face/reason via nodeGraphDisplayGlFailed (display-canvas.js).
// Skipped (BugsFix-owned, still to port): gradient-vectorscope, trace-woscope,
// trace-dot-sprite.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const skip = /gradientVectorscope|trace-woscope|trace-dot-sprite/;
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.js$/.test(e.name) && !skip.test(p.replace(/\\/g, "/"))) files.push(p);
  }
}
walk(path.join(root, "public/lib/visual"));
walk(path.join(root, "public/modules"));
const targets = files.filter((p) => /lib[\\/]visual|-display\.js$|-gl\.js$/.test(p));
// Shared display files outside lib/visual + modules that own a GL-only path.
for (const rel of ["public/node-graph-module-scope-number-readout.js", "public/node-graph-module-scope-waterfall-gl.js"]) {
  targets.push(path.join(root, rel));
}
const bad = [];
const forbid = [
  [/console\.warn/, "console.warn in display/GL code (use console.error / nodeGraphDisplayGlFailed)"],
  [/\b(CPU|Canvas2D|2D) fallback\b(?! is gone)/i, "fallback path mention"],
  [/keeps? (its |the )?last frame/i, "keep-last-frame on failure"],
  [/falls? back to (the )?(old )?(2D|Canvas2D|CPU)\b/i, "falls back to a 2D/CPU path"],
];
// GL-or-2D splits: a GL helper that returns null must end in
// nodeGraphDisplayGlFailed, never in a second (2D) implementation of the
// same effect. Per-file signatures of removed 2D paths:
const forbidIn = {
  "public/node-graph-module-scope-number-readout.js": [
    [/burnCtx\.globalCompositeOperation = "destination-out"/, "2D burn-plate fade (GPU plate only)"],
    [/UNSIGNED_BYTE, burnPlate\)/, "uploads the 2D burn plate as the texture"],
    [/\} else if \(erase > /, "else-branch fade beside the GPU fade"],
    [/_numberReadoutBurnResizeScratch/, "2D burn-plate scale-preserve on resize"],
  ],
};
for (const [rel, rules] of Object.entries(forbidIn)) {
  const lines = fs.readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);
  lines.forEach((l, i) => { for (const [re, why] of rules) if (re.test(l)) bad.push(`${rel}:${i + 1}: ${why}`); });
}
{
  const nr = fs.readFileSync(path.join(root, "public/node-graph-module-scope-number-readout.js"), "utf8");
  if (!/!plateGl[^\n]*\)\s*\{\s*nodeGraphDisplayGlFailed\(canvas,/.test(nr)) bad.push("number-readout: no GPU burn plate must call nodeGraphDisplayGlFailed");
  if (!/const burnCtx = plateGl \?/.test(nr)) bad.push("number-readout: burn stamps must be gated on the GPU plate");
}
for (const f of targets) {
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/no (Canvas2D|CPU|2D) fallback/i.test(l)) return;
    for (const [re, why] of forbid) if (re.test(l)) bad.push(`${path.relative(root, f)}:${i + 1}: ${why}`);
  });
}
const dc = fs.readFileSync(path.join(root, "public/lib/visual/display-canvas.js"), "utf8");
const m = dc.match(/function nodeGraphDisplayGlFailed[\s\S]*?\n}/);
if (!m) bad.push("display-canvas.js: nodeGraphDisplayGlFailed missing");
else {
  if (!/console\.error/.test(m[0])) bad.push("nodeGraphDisplayGlFailed must console.error");
  if (!/FillBlack|fillRect/.test(m[0])) bad.push("nodeGraphDisplayGlFailed must fill black");
  if (!/has\(|\.add\(/.test(m[0])) bad.push("nodeGraphDisplayGlFailed must log once per key");
}
const need = {
  "public/modules/fbmField/fbm-field-display.js": 1,
  "public/modules/rasterRgb/raster-rgb-display.js": 1,
  "public/modules/rgbFractal/rgb-fractal-display.js": 1,
  "public/modules/spectrogram/spectrogram-display.js": 1,
  "public/modules/imageBurn/image-burn-display.js": 1,
  "public/modules/asciiscope/asciiscope-display.js": 1,
  "public/node-graph-module-scope-number-readout.js": 1,
};
for (const rel of Object.keys(need)) {
  const s = fs.readFileSync(path.join(root, rel), "utf8");
  if (!s.includes("nodeGraphDisplayGlFailed(")) bad.push(`${rel}: GL failure must go through nodeGraphDisplayGlFailed`);
}
for (const sym of ["nodeGraphRgbFractalJuliaSmooth", "nodeGraphRasterRgbApplyGrade", "spectrogramSpectrumToColumnMags", "nodeGraphImageBurnApplyContrastRgb"]) {
  for (const f of targets) if (fs.readFileSync(f, "utf8").includes(sym)) bad.push(`${path.relative(root, f)}: removed CPU helper ${sym} is back`);
}
if (bad.length) { console.error("FAIL display no-fallback\n" + bad.join("\n")); process.exit(1); }
console.log(`ok display no-fallback (${targets.length} files)`);
