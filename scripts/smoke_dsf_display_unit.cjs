// DSF Oscillator face: Spacing / Odd-Even must change the drawn cycle.
// Usage: node scripts/smoke_dsf_display_unit.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const file = path.join(__dirname, "..", "public", "modules", "sinCos", "sin-cos-display.js");
const ctx = {
  console,
  Math,
  JSON,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Float64Array,
  nodeGraphFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
  nodeGraphMvp: { live: { context: { sampleRate: 48000 } } },
  nodeGraphModuleScopeCustomRenderers: {},
  registerNodeGraphModuleFaceCreator() {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: "sin-cos-display.js" });

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures += 1; console.log(`FAIL ${msg}`); } };
const cycle = (patch) => ctx.nodeGraphDsfCycle({
  waveform: 1,
  frequency: 100,
  morph: 1,
  pulseWidth: 0.5,
  blend: 0.5,
  spacing: 1,
  oddEven: 0,
  amplitude: 1,
  ...patch,
}, 256);

const harmonic = cycle({});
const spaced = cycle({ spacing: 2 });
const odd = cycle({ oddEven: 1 });
ok(harmonic.length === 256 && Number.isFinite(harmonic[0]) && Number.isFinite(harmonic[128]), "harmonic cycle is finite");
const mean = (arr) => {
  let s = 0;
  for (let i = 0; i < arr.length; i += 1) s += arr[i];
  return s / arr.length;
};
ok(Math.abs(mean(harmonic)) < 0.05, `harmonic cycle stays centered (mean ${mean(harmonic).toFixed(4)})`);
ok(Math.abs(mean(spaced)) < 0.05, `spacing 2 stays centered (mean ${mean(spaced).toFixed(4)})`);
ok(Math.abs(mean(odd)) < 0.05, `odd/even 1 stays centered (mean ${mean(odd).toFixed(4)})`);
let spaceDiff = 0;
let oddDiff = 0;
for (let i = 0; i < 256; i += 1) {
  spaceDiff += Math.abs(harmonic[i] - spaced[i]);
  oddDiff += Math.abs(harmonic[i] - odd[i]);
}
ok(spaceDiff > 1, `spacing 2 changes the saw (diff ${spaceDiff.toFixed(3)})`);
ok(oddDiff > 1, `odd/even 1 changes the saw (diff ${oddDiff.toFixed(3)})`);
const sine = cycle({ waveform: 0, spacing: 2, oddEven: 1 });
ok(Math.abs(sine[0] - 0) < 1e-9 && Math.abs(sine[64] - 1) < 1e-6, "sine waveform ignores spectrum");
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok(near(ctx.nodeGraphSinCosFacePadPx({ lineThickness: 2, dotThickness: 5, padExtra: 0 }, 1), 3.5), "pad is max(line/2, dot/2) + 1px AA");
ok(near(ctx.nodeGraphSinCosFacePadPx({ lineThickness: 2, dotThickness: 5, padExtra: 4 }, 1), 7.5), "extra padding adds on top");
ok(near(ctx.nodeGraphSinCosFacePadPx({ lineThickness: 16, dotThickness: 5, padExtra: 0 }, 1), 9), "thicker line grows the pad");
ok(near(ctx.nodeGraphSinCosFacePadPx({ lineThickness: 2, dotThickness: 5, padExtra: 0 }, 1, { showDot: false }), 2), "no-dot pad is line half + AA");

console.log(failures ? `${failures} FAILED` : "dsf display unit ok");
process.exit(failures ? 1 : 0);
