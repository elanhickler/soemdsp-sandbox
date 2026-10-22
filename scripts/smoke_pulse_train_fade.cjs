// Pulse Train lit-dot fade uses PhosphorResidual.energyAfterSeconds.
// Usage: node scripts/smoke_pulse_train_fade.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ctx = {
  console,
  Math,
  Number,
  String,
  Object,
  nodeGraphFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
  SoemMath: {
    clamp01(value, fallback = 0) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n));
    },
  },
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "public", "lib", "phosphor", "phosphor-residual.js"), "utf8"),
  ctx,
  { filename: "phosphor-residual.js" },
);
const R = ctx.PhosphorResidual;
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures += 1; console.log(`FAIL ${msg}`); } };
ok(typeof R.energyAfterSeconds === "function", "energyAfterSeconds is on PhosphorResidual");
ok(R.energyAfterSeconds(1, 0, 10) === 1, "tau 0 holds");
ok(R.energyAfterSeconds(1, 0.001, 1) < 0.01, "tiny tau is gone after 1s");
const one = R.energyAfterSeconds(1, 1, 1);
ok(Math.abs(one - Math.exp(-1)) < 1e-9, `tau 1s at 1s is e^-1 (${one})`);
ok(Math.abs(one - Math.pow(R.secondsToKeep(1), 60)) < 1e-9, "matches secondsToKeep^frames");
const display = fs.readFileSync(path.join(__dirname, "..", "public", "node-graph-pulse-train-display.js"), "utf8");
ok(display.includes("fadeTau: Number(look.fadeTime)"), "pulse train passes fadeTau");
const gl = fs.readFileSync(path.join(__dirname, "..", "public", "lib", "visual", "gl-line-renderer.js"), "utf8");
ok(gl.includes("uFadeTau") && gl.includes("exp(-age / uFadeTau)"), "shader uses residual exponential");
ok(gl.includes("mix(uLine, uLit, litAmt)") && gl.includes("mix(uDotCol, uLit, litAmt)"), "stems and dots recolor with the fade");
ok(!gl.includes("vFlash") && !/halo = rad \* 2\.2/.test(gl), "no extra lit halo circle");
console.log(failures ? `${failures} FAILED` : "pulse train fade ok");
process.exit(failures ? 1 : 0);
