// Softpop 2 native tests (docs/SOFTPOP2_PLAN.md smoke).
// Builds native_modules/softpop2/softpop2.cpp with a small probe and runs
// offline at 48 kHz.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SR = 48000;
const COLORS = ["white", "gaussian", "average", "pink", "brown", "blue", "violet"];
const clangCandidates = [
  process.env.SOEMDSP_CLANG,
  "C:\\Program Files\\LLVM\\bin\\clang++.exe",
  "/usr/bin/clang++",
].filter(Boolean);
const clang = clangCandidates.find((p) => fs.existsSync(p));
if (!clang) throw new Error(`clang++ not found (tried ${clangCandidates.join(", ")})`);

const probeSrc = path.join(os.tmpdir(), `softpop2_probe_${process.pid}.cpp`);
const wasmPath = path.join(os.tmpdir(), `softpop2_test_${process.pid}.wasm`);
fs.writeFileSync(probeSrc, `
extern "C" int soemdsp_softpop2_create();
extern "C" void soemdsp_softpop2_destroy(int handle);
extern "C" void soemdsp_softpop2_reset(int handle);
extern "C" double soemdsp_softpop2_sample(int handle, double freqHz, double crossfade, double ampOver, double bandwidthOver, double pitchOver, double amplitude, double color, double seedValue, double sampleRate);
extern "C" double soemdsp_softpop2_left(int handle);
extern "C" double soemdsp_softpop2_right(int handle);
static const int kCap = 1 << 20;
static double gL[kCap];
static double gR[kCap];
extern "C" double* tp_l() { return gL; }
extern "C" double* tp_r() { return gR; }
extern "C" int tp_cap() { return kCap; }
extern "C" int tp_create() { return soemdsp_softpop2_create(); }
extern "C" void tp_destroy(int h) { soemdsp_softpop2_destroy(h); }
extern "C" void tp_reset(int h) { soemdsp_softpop2_reset(h); }
extern "C" int tp_render(int h, int n, double freq, double xf, double ao, double amp, double color, double seed, double sr) {
  if (n < 1 || n > kCap) return 0;
  for (int i = 0; i < n; i++) {
    soemdsp_softpop2_sample(h, freq, xf, ao, 1.0, 0.0, amp, color, seed, sr);
    gL[i] = soemdsp_softpop2_left(h);
    gR[i] = soemdsp_softpop2_right(h);
  }
  return n;
}
`);
execFileSync(clang, [
  "--target=wasm32", "-O3", "-msimd128", "-nostdlib", "-fno-exceptions", "-fno-rtti",
  `-I${path.join(root, "library", "include")}`,
  "-Wl,--no-entry",
  ...["tp_l", "tp_r", "tp_cap", "tp_create", "tp_destroy", "tp_reset", "tp_render"].map((e) => `-Wl,--export=${e}`),
  "-Wl,--export-memory",
  "-o", wasmPath,
  probeSrc,
  path.join(root, "native_modules", "softpop2", "softpop2.cpp"),
  path.join(root, "native_modules", "combined", "shim.cpp"),
], { stdio: "inherit" });
fs.rmSync(probeSrc, { force: true });
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
fs.rmSync(wasmPath, { force: true });
const x = instance.exports;

let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

function render(n, freq, xf, ao, amp, color, seed) {
  const h = x.tp_create() | 0;
  if (!(h > 0)) throw new Error("create failed");
  if ((x.tp_render(h, n, freq, xf, ao, amp, color, seed, SR) | 0) !== n) throw new Error("render");
  const l = new Float64Array(x.memory.buffer, x.tp_l(), n).slice();
  const r = new Float64Array(x.memory.buffer, x.tp_r(), n).slice();
  x.tp_destroy(h);
  return { l, r };
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}
function dB(p) { return 10 * Math.log10(p); }
function thdSine(a, freq) {
  const n = a.length;
  let c = 0, s = 0;
  const w = 2 * Math.PI * freq / SR;
  for (let i = 0; i < n; i++) {
    c += a[i] * Math.cos(w * i);
    s += a[i] * Math.sin(w * i);
  }
  c *= 2 / n; s *= 2 / n;
  const fund = (c * c + s * s) / 2;
  let tot = 0;
  for (let i = 0; i < n; i++) tot += a[i] * a[i];
  tot /= n;
  const rest = Math.max(0, tot - fund);
  return { rms: Math.sqrt(tot), fundRms: Math.sqrt(fund), thdDb: dB(rest / Math.max(fund, 1e-30)) };
}

{
  const { l, r } = render(SR, 440, 0, 0, 1, 0, 1);
  gate(l.every(Number.isFinite) && r.every(Number.isFinite), "renders finite samples");
  gate(l.some((v) => v !== 0), "Crossfade 0 is not silent");
  let same = true;
  for (let i = 0; i < l.length; i++) if (!Object.is(l[i], r[i])) { same = false; break; }
  gate(same, "Crossfade 0: Left == Right (shared sine, no noise in the mix)");
  const t = thdSine(l, 440);
  gate(t.thdDb < -60, `Crossfade 0 = pure sine (THD ${t.thdDb.toFixed(1)} dB, RMS ${t.rms.toFixed(4)})`);
}

{
  const sineRms = Math.SQRT1_2;
  const xf = process.argv.includes("--cal-w03") ? 0.3 : 1;
  for (let color = 0; color < COLORS.length; color += 1) {
    const { l } = render(8 * SR, 1000, xf, 0, 1, color, 1);
    const tail = l.subarray(2 * SR);
    const r = rms(tail);
    const errDb = 20 * Math.log10(r / sineRms);
    const lim = xf === 1 && color <= 4 ? 0.6 : 0.5;
    gate(Math.abs(errDb) < lim, `Crossfade ${xf} Amp over 0 ${COLORS[color]}: RMS ${r.toFixed(4)} vs sine ${sineRms.toFixed(4)} (${errDb.toFixed(3)} dB)`);
    if (process.argv.includes("--cal-w03") || process.argv.includes("--cal")) {
      console.log(`  k *= ${Math.pow(10, -errDb / 20).toFixed(6)}`);
    }
  }
}

{
  const { l, r } = render(SR, 440, 1, 1, 1, 0, 1);
  gate(l.every((v) => v === 0) && r.every((v) => v === 0), "Amp over Crossfade 1 at Crossfade 1 = silent");
}

{
  const n = SR;
  const h = x.tp_create() | 0;
  x.tp_render(h, n, 700, 0.4, 0, 1, 3, 4242, SR);
  const a = new Float64Array(x.memory.buffer, x.tp_l(), n).slice();
  x.tp_reset(h);
  x.tp_render(h, n, 700, 0.4, 0, 1, 3, 4242, SR);
  const b = new Float64Array(x.memory.buffer, x.tp_l(), n).slice();
  x.tp_destroy(h);
  const h2 = x.tp_create() | 0;
  x.tp_render(h2, n, 700, 0.4, 0, 1, 3, 4242, SR);
  const c = new Float64Array(x.memory.buffer, x.tp_l(), n).slice();
  x.tp_destroy(h2);
  let eq = true;
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i]) || !Object.is(a[i], c[i])) { eq = false; break; }
  gate(eq, "Reset / same Seed: exact repeat");
}

{
  const { l, r } = render(SR, 440, 1, 0, 1, 1, 1);
  let differ = false;
  for (let i = 0; i < l.length; i++) if (!Object.is(l[i], r[i])) { differ = true; break; }
  gate(differ, "Crossfade 1: Left and Right independent noise");
}

if (failures) {
  console.error(`${failures} FAIL`);
  process.exit(1);
}
console.log("softpop2 ok");
