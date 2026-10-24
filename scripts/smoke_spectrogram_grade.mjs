// Spectrogram Contrast/Brightness: dBFS window + gamma, not a photo S-curve.
// Usage: node scripts/smoke_spectrogram_grade.mjs
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {
  console,
  Math,
  Number,
  String,
  Object,
  Float32Array,
  Uint8Array,
  WeakMap,
  WeakSet,
  WebGL2RenderingContext: function WebGL2RenderingContext() {},
  nodeGraphFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "public/modules/spectrogram/spectrogram-gl.js"), "utf8"),
  ctx,
  { filename: "spectrogram-gl.js" },
);

const grade = ctx.spectrogramGrade01;
if (typeof grade !== "function") {
  console.error("smoke_spectrogram_grade FAILED: spectrogramGrade01 missing");
  process.exit(1);
}

const fullMag = 256;
const compressed = (ema) => Math.log10(1 + ema * 100);
const near = (got, want, eps, msg) => {
  if (!(Math.abs(got - want) <= eps)) {
    throw new Error(`${msg}: got ${got}, want ${want} ±${eps}`);
  }
};

const fsSrc = ctx.SPECTROGRAM_GL_FRAGMENT_SHADER || "";
if (!fsSrc.includes("uFullMag") || !fsSrc.includes("80.0")) {
  throw new Error("shader missing dBFS window / uFullMag");
}
if (fsSrc.includes("nodeGraphRasterRgbGradeChannel01") || /t = x \/ \(1\.0 \+ x\)/.test(fsSrc)) {
  throw new Error("shader still uses photo S-curve fold");
}

// 0 dBFS sine → top of the LUT at Contrast 1, Brightness 1.
near(grade(compressed(fullMag), 1, 1, fullMag), 1, 1e-5, "0 dBFS → 1");

// −40 dB harmonic sits at mid-window with Contrast 1.
near(grade(compressed(fullMag * 0.01), 1, 1, fullMag), 0.5, 1e-4, "−40 dB Contrast 1 → 0.5");

// Contrast 2 uses gamma 0.5, so it lifts that harmonic instead of crushing it.
const harmonicC1 = grade(compressed(fullMag * 0.01), 1, 1, fullMag);
const harmonicC2 = grade(compressed(fullMag * 0.01), 2, 1, fullMag);
near(harmonicC2, Math.sqrt(0.5), 1e-4, "−40 dB Contrast 2 → √0.5");
if (!(harmonicC2 > harmonicC1 + 0.1)) {
  throw new Error(`Contrast up should lift harmonics: c1=${harmonicC1} c2=${harmonicC2}`);
}

if (grade(compressed(fullMag), 1, 0, fullMag) !== 0) {
  throw new Error("Brightness 0 → 0");
}
near(grade(compressed(fullMag), 0, 1, fullMag), 0.5, 1e-9, "Contrast 0 → 0.5");

const defs = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");
const spectroStart = defs.indexOf("  spectrogram: {");
if (spectroStart < 0) throw new Error("spectrogram catalog missing");
const spectroBlock = defs.slice(spectroStart, spectroStart + 3500);
if (!/defaultValue: "1",\s*key: "brightness"/.test(spectroBlock)) {
  throw new Error("spectrogram Brightness default is not 1");
}
if (spectroBlock.includes("Same S-curve as Scan Grid")) {
  throw new Error("spectrogram still documents Scan Grid S-curve");
}

const worklet = fs.readFileSync(
  path.join(root, "public/modules/spectrogram/spectrogram-worklet-evaluator.js"),
  "utf8",
);
if (!worklet.includes("state.windowSum || 0")) {
  throw new Error("worklet FftSize[7] is not windowSum");
}
if (worklet.includes("historyFlag")) {
  throw new Error("worklet still names historyFlag");
}

console.log("smoke_spectrogram_grade ok");
