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
const bad = [];
const forbid = [
  [/console\.warn/, "console.warn in display/GL code (use console.error / nodeGraphDisplayGlFailed)"],
  [/\b(CPU|Canvas2D|2D) fallback\b(?! is gone)/i, "fallback path mention"],
  [/keeps? (its |the )?last frame/i, "keep-last-frame on failure"],
];
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
