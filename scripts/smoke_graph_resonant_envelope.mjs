// Resonant Envelope (type 221). Fit step settles near Amplitude.
// Impulse 1 peaks near Amplitude. Tracking 1 at 880 Hz decays faster than 440.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
const e = instance.exports;

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_resonant_envelope_create");
const destroy = must("soemdsp_resonant_envelope_destroy");
const sample = must("soemdsp_resonant_envelope_sample");
const idle = must("soemdsp_resonant_envelope_is_idle");
const version = must("soemdsp_graph_version");
const ver = version() | 0;
if (ver < 179) throw new Error(`graph version ${ver} < 179`);

const SR = 48000;
function run(opts, n) {
  const h = create() | 0;
  if (!(h > 0)) throw new Error("create");
  const ys = [];
  for (let i = 0; i < n; i++) {
    ys.push(sample(
      h,
      opts.gate(i),
      opts.hz ?? 0,
      opts.attack ?? 0.01,
      opts.decay ?? 0.3,
      opts.resonance ?? 0,
      opts.impulse ?? 0,
      opts.tracking ?? 0,
      opts.amplitude ?? 1,
      opts.range ?? 0,
      opts.recalc ?? 1,
      SR,
      0, 0, 0,
      opts.detect ?? 0,
      0, 0, 0,
      opts.hold ?? 0,
    ));
  }
  const wasIdle = idle(h) | 0;
  destroy(h);
  return { ys, wasIdle };
}

const held = Math.round(0.2 * SR);
const step = run({
  gate: (i) => (i < held ? 1 : 0),
  resonance: 0,
  impulse: 0,
}, Math.round(0.25 * SR));
const settled = step.ys[held - 1];
if (!(settled > 0.85 && settled <= 1.01)) throw new Error(`smooth settle ${settled}`);
if (!step.ys.every((y) => y >= -1e-9 && y <= 1.01 && Number.isFinite(y))) {
  throw new Error("Fit step left 0..1");
}
console.log(`ok resonant settle ${settled.toFixed(4)}`);

const ping = run({
  gate: (i) => (i === 0 ? 1 : 0),
  resonance: 1,
  impulse: 1,
  decay: 0.3,
}, Math.round(0.4 * SR));
const peak = Math.max(...ping.ys);
if (!(peak > 0.7 && peak <= 1.01)) throw new Error(`impulse peak ${peak}`);
const later = ping.ys[Math.round(0.35 * SR)];
if (!(later < peak * 0.5)) throw new Error(`impulse did not decay ${later}`);
if (!ping.ys.every((y) => Number.isFinite(y) && y >= -1e-9)) throw new Error("impulse NaN or negative Fit");
console.log(`ok resonant impulse peak ${peak.toFixed(4)} tail ${later.toFixed(4)}`);

function energyAfter(hz) {
  const n = Math.round(0.15 * SR);
  const out = run({
    gate: (i) => (i === 0 ? 1 : 0),
    resonance: 0.6,
    impulse: 1,
    tracking: 1,
    decay: 0.4,
    hz,
  }, n);
  let eSum = 0;
  for (let i = Math.round(0.05 * SR); i < n; i++) eSum += out.ys[i] * out.ys[i];
  return eSum;
}
const e440 = energyAfter(440);
const e880 = energyAfter(880);
if (!(e880 < e440 * 0.85)) throw new Error(`tracking 880 not faster (${e880} vs ${e440})`);
// Hold = Follows detect: a long flat gate falls after its first sample for Shared / Rise / Abs rise.
for (const detect of [0, 4, 5]) {
  const hn = Math.round(0.5 * SR);
  const gHold = (i) => (i >= 10 && i < 10 + hn ? 1 : 0);
  const a = run({ gate: gHold, detect, hold: 0 }, hn + 20).ys[hn];
  const b = run({ gate: gHold, detect, hold: 1 }, hn + 20).ys[hn];
  if (!(a > 0.9)) throw new Error(`hold 0 detect ${detect} should stay high (${a})`);
  if (!(b < 0.01)) throw new Error(`hold 1 detect ${detect} should fall (${b})`);
}
console.log("ok resonant hold follows detect");
console.log(`ok resonant tracking 440=${e440.toExponential(2)} 880=${e880.toExponential(2)} version=${ver}`);
