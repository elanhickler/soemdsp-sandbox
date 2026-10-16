// Shared harness for scripts/test_softpop_oscillator.mjs and
// scripts/test_softpop_filter.mjs: builds scripts/softpop_test_probe.cpp
// against one Softpop module (production flags: wasm32 -O3 -msimd128), a
// worker pool for long level loops (this file is also the worker script),
// render helpers, and the spectral estimators (Welch PSD, Lorentz fit,
// half-power crossings).
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

export const SR = 48000;
export const COLORS = ["white", "gaussian", "average", "pink", "brown"];
export const COLOR = { WHITE: 0, PINK: 1, BROWN: 2 };
// Probe channels (tp_render mask bits).
export const CH = { MONO: 0, L: 1, R: 2, NP_L: 3, NP_R: 4, NA_L: 5, NA_R: 6, NAUD_L: 7, NAUD_R: 8, FI_L: 9, FI_R: 10, Q: 11, CV_L: 12, CV_R: 13, PITCH_L: 14, PITCH_R: 15 };
export const Qof = (w) => 2000 * Math.pow(0.5 / 2000, w);
export const dB = (p) => 10 * Math.log10(p);

const selfFile = fileURLToPath(import.meta.url);

function levelJob(x, job) {
  const h = x.tp_create() | 0;
  if (!(h > 0)) throw new Error("create failed");
  x.tp_set(...job.params);
  x.tp_level(h, job.warm, job.n);
  const s = Array.from(new Float64Array(x.memory.buffer, x.tp_stats(), 8));
  x.tp_destroy(h);
  return s;
}

if (!isMainThread && workerData?.softpopProbe) {
  const x = new WebAssembly.Instance(workerData.module, {}).exports;
  parentPort.on("message", (job) => parentPort.postMessage({ id: job.id, stats: levelJob(x, job) }));
}

// which: "oscillator" | "filter".
export function buildProbe(which) {
  const root = path.resolve(path.dirname(selfFile), "..");
  const clangCandidates = [process.env.SOEMDSP_CLANG, "C:\\Program Files\\LLVM\\bin\\clang++.exe", "/usr/bin/clang++"].filter(Boolean);
  const clang = clangCandidates.find((p) => fs.existsSync(p));
  if (!clang) throw new Error(`clang++ not found (tried ${clangCandidates.join(", ")})`);
  const wasmPath = path.join(os.tmpdir(), `softpop_${which}_test_${process.pid}.wasm`);
  const exportsList = ["tp_buf", "tp_cap", "tp_in", "tp_in_l", "tp_in_r", "tp_in_cap", "tp_stats", "tp_create", "tp_destroy", "tp_reset", "tp_set", "tp_render", "tp_level"];
  const sources = [
    path.join(root, "scripts", "softpop_test_probe.cpp"),
    path.join(root, "native_modules", `softpop_${which}`, `softpop_${which}.cpp`),
    path.join(root, "native_modules", "combined", "shim.cpp"),
  ];
  // The Oscillator's Robin dither lives in native_modules/ellipsoid.
  if (which === "oscillator") sources.push(path.join(root, "native_modules", "ellipsoid", "ellipsoid.cpp"));
  // PolyBLEP Trisaw = native_modules/polyblep Trisaw Center (soemdsp_polyblep_trisaw_center).
  if (which === "oscillator") sources.push(path.join(root, "native_modules", "polyblep", "polyblep.cpp"));
  execFileSync(clang, [
    "--target=wasm32", "-O3", "-msimd128", "-nostdlib", "-fno-exceptions", "-fno-rtti",
    `-DSOFTPOP_PROBE_FILTER=${which === "filter" ? 1 : 0}`,
    `-I${path.join(root, "library", "include")}`,
    "-Wl,--no-entry", ...exportsList.map((e) => `-Wl,--export=${e}`), "-Wl,--export-memory",
    "-o", wasmPath, ...sources,
  ], { stdio: "inherit" });
  const module = new WebAssembly.Module(fs.readFileSync(wasmPath));
  fs.rmSync(wasmPath, { force: true });
  return module;
}

// defaults: per-module param defaults merged under each call's options.
export function makeHarness(module, defaults = {}) {
  const x = new WebAssembly.Instance(module, {}).exports;
  const failures = [];
  const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };
  const params = (o0) => {
    const o = { ...defaults, ...o0 };
    return [o.freq ?? 1000, o.source ?? 0, o.morph ?? 0.5, o.width ?? 0.3, o.pitch ?? 0, o.ampMod ?? 0, o.amp ?? 1, o.color ?? 1, o.seed ?? 1, o.sr ?? SR];
  };

  // ---- worker pool (long level loops) ----
  const nWorkers = Math.max(1, Math.min(os.cpus().length - 2, 22));
  const workers = [], pending = new Map(), queue = [], idle = [];
  let nextId = 1;
  const pump = () => {
    while (idle.length && queue.length) idle.pop().postMessage(queue.shift());
  };
  const ensureWorkers = () => {
    if (workers.length) return;
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(selfFile, { workerData: { module, softpopProbe: true } });
      w.on("message", (m) => { const p = pending.get(m.id); pending.delete(m.id); idle.push(w); p(m.stats); pump(); });
      w.on("error", (e) => { console.error(e); process.exit(2); });
      workers.push(w);
      idle.push(w);
    }
  };
  const runJob = (job) => new Promise((resolve) => {
    ensureWorkers();
    const id = nextId++;
    pending.set(id, resolve);
    queue.push({ ...job, id });
    pump();
  });
  const stopWorkers = () => { for (const w of workers) w.terminate(); };

  // in: { hz: (i) => Hz } and/or { l: (i) => x, r: (i) => x } (Filter external input).
  function render(h, n, chans, onChunk, inp = null) {
    let mask = 0;
    for (const c of chans) mask |= 1 << c;
    const order = [...chans].sort((a, b) => a - b);
    const cap = x.tp_cap() | 0;
    const useIn = (inp?.hz ? 1 : 0) | (inp?.l || inp?.r ? 2 : 0);
    const chunk = Math.min(Math.floor(cap / chans.length), useIn ? (x.tp_in_cap() | 0) : 1 << 20);
    for (let off = 0; off < n; off += chunk) {
      const m = Math.min(chunk, n - off);
      const fill = (ptr, fn) => { const a = new Float64Array(x.memory.buffer, ptr, m); for (let i = 0; i < m; i++) a[i] = fn ? fn(off + i) : 0; };
      if (useIn & 1) fill(x.tp_in(), inp.hz);
      if (useIn & 2) { fill(x.tp_in_l(), inp.l); fill(x.tp_in_r(), inp.r); }
      if ((x.tp_render(h, m, mask, useIn) | 0) !== chans.length) throw new Error("tp_render failed");
      const buf = new Float64Array(x.memory.buffer, x.tp_buf(), m * chans.length);
      const arrays = {};
      order.forEach((c, k) => { arrays[c] = buf.subarray(k * m, (k + 1) * m); });
      onChunk(chans.map((c) => arrays[c]), off);
    }
  }
  function renderAll(h, n, chans, inp = null) {
    const out = chans.map(() => new Float64Array(n));
    render(h, n, chans, (arrs, off) => arrs.forEach((a, k) => out[k].set(a, off)), inp);
    return out;
  }
  function withInstance(o, fn) {
    const h = x.tp_create() | 0;
    if (!(h > 0)) throw new Error("create failed");
    x.tp_set(...params(o));
    try { return fn(h); } finally { x.tp_destroy(h); }
  }
  const setParams = (o) => x.tp_set(...params(o));
  const finish = (t0) => {
    stopWorkers();
    console.log(`\n${failures.length ? `FAILED ${failures.length}` : "ALL PASSED"} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (failures.length) process.exit(1);
  };

  // Level of a noise voice: mean L^2 / R^2 over enough seconds (parallel jobs).
  async function noiseLevel(o, totalSeconds) {
    const fc = o.freq;
    // Filter bandpass settle time from its Width (Oscillator has no Width: no SVF to settle).
    const tau = o.width === undefined ? 0 : Qof(o.width) / (Math.PI * Math.max(fc, 20));
    const warmS = Math.max(0.5, 8 * tau);
    const chunkS = Math.max(60, 4 * warmS);
    const nJobs = Math.max(1, Math.ceil(totalSeconds / chunkS));
    const per = Math.ceil((totalSeconds / nJobs) * SR);
    const jobs = [];
    for (let j = 0; j < nJobs; j++) {
      jobs.push(runJob({ params: params({ ...o, seed: (o.seed ?? 1) + 7919 * j }), warm: Math.ceil(warmS * SR), n: per }));
    }
    const res = await Promise.all(jobs);
    let pl = 0, pr = 0, bad = 0, mx = 0;
    for (const s of res) { pl += s[0]; pr += s[1]; bad += s[4]; mx = Math.max(mx, s[5]); }
    const p = (pl + pr) / (2 * res.length);
    return { p, rmsDb: dB(p / 0.5), bad, mx, seconds: nJobs * per / SR };
  }

  return { x, gate, failures, params, render, renderAll, withInstance, setParams, runJob, noiseLevel, finish, stopWorkers };
}

export function bitEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

// FFT (in place, radix 2) and Welch PSD (Hann, 50 % overlap).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
export function welch(sig, L) {
  const win = new Float64Array(L);
  for (let i = 0; i < L; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / L);
  const psd = new Float64Array(L / 2 + 1);
  const re = new Float64Array(L), im = new Float64Array(L);
  let segs = 0;
  for (let s = 0; s + L <= sig.length; s += L / 2) {
    for (let i = 0; i < L; i++) { re[i] = sig[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= L / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    segs++;
  }
  for (let k = 0; k <= L / 2; k++) psd[k] /= segs;
  return { psd, df: SR / L, segs };
}
export function smooth(a, r) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; c++; }
    out[i] = s / c;
  }
  return out;
}
export function solve3(m, v) {
  const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det3(m);
  return [0, 1, 2].map((k) => det3(m.map((row, i) => row.map((val, j) => (j === k ? v[i] : val)))) / D);
}
// Narrow bands: weighted least squares of 1/P = a + b u + c u^2 near the peak.
export function lorentzFit(p, df) {
  const ps = smooth(p, 2);
  let k0 = 0;
  for (let k = 1; k < ps.length; k++) if (ps[k] > ps[k0]) k0 = k;
  let a = k0; while (a > 0 && ps[a - 1] > 0.3 * ps[k0]) a--;
  let b = k0; while (b < ps.length - 1 && ps[b + 1] > 0.3 * ps[k0]) b++;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (let k = a; k <= b; k++) {
    const u = (k - k0) * df, w2 = p[k] * p[k], basis = [1, u, u * u], y = 1 / p[k];
    for (let i = 0; i < 3; i++) { v[i] += w2 * basis[i] * y; for (let j = 0; j < 3; j++) M[i][j] += w2 * basis[i] * basis[j]; }
  }
  const c = solve3(M, v);
  const uc = -c[1] / (2 * c[2]);
  const invPeak = c[0] - c[1] * c[1] / (4 * c[2]);
  return { fc: k0 * df + uc, bw: 2 * Math.sqrt(invPeak / c[2]) };
}
// Broad bands: half-power crossings around the maximum.
export function halfPower(p, df) {
  let k0 = 0;
  for (let k = 1; k < p.length; k++) if (p[k] > p[k0]) k0 = k;
  const half = p[k0] / 2;
  let a = k0; while (a > 0 && p[a] > half) a--;
  let b = k0; while (b < p.length - 1 && p[b] > half) b++;
  const fa = (a + (half - p[a]) / (p[a + 1] - p[a])) * df;
  const fb = (b - 1 + (p[b - 1] - half) / (p[b - 1] - p[b])) * df;
  return { peak: k0 * df, f1: fa, f2: fb };
}
// Least-squares sinusoid fit at f: returns { amp, thdDb }.
export function sineFit(y, f, start = 0) {
  const om = 2 * Math.PI * f / SR;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (let n = start; n < y.length; n++) {
    const b = [Math.sin(om * n), Math.cos(om * n), 1];
    for (let i = 0; i < 3; i++) { v[i] += b[i] * y[n]; for (let j = 0; j < 3; j++) m[i][j] += b[i] * b[j]; }
  }
  const c = solve3(m, v);
  let pr = 0, pf = 0;
  for (let n = start; n < y.length; n++) {
    const fit = c[0] * Math.sin(om * n) + c[1] * Math.cos(om * n) + c[2];
    pr += (y[n] - fit) ** 2; pf += fit * fit;
  }
  return { amp: Math.hypot(c[0], c[1]), thdDb: dB(pr / pf) };
}
