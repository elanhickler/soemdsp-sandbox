// Formant Filter (graph type 244) native smoke: standalone eval matches the
// audio path, levels stay safe, the internal source (BLIT saw / Sub / Noise)
// sounds with no input, and the graph wiring (Ext In replaces the saw, Reset,
// stereo Left; Vowel / Shift jacks removed in graph 323) works in the combined binary.
// Shift (-4..+7 oct) keeps rising with bands fading out at Nyquist (no clamp,
// no clicks, no NaN) and the internal Noise is stereo (decorrelated L / R).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sr = 48000;
const ff = new WebAssembly.Instance(new WebAssembly.Module(
  readFileSync(new URL("../native_modules/formant_filter/formant_filter.wasm", import.meta.url)),
)).exports;
const P = { vowel: 1 / 3, sweep: 0, shift: 0, res: 1, body: 0.5, drive: 0, level: 1 };
const G = [1, 1, 1, 1, 1];
const ON = [1, 1, 1, 1, 1];

// 1) Display eval == audio: steady-state sine gain vs eval_response.
const probes = [40, 110, 300, 600, 730, 900, 1090, 1500, 2440, 3400, 4500, 8000];
const minHz = 30;
const maxHz = 16000;
const nPts = 2048;
ff.soemdsp_formant_filter_eval_response(sr, P.vowel, P.sweep, P.shift, P.res, P.body, P.level, ...G, ...ON, nPts, minHz, maxHz);
let worstDb = 0;
// Shift 0 plus shifts that put bands inside the Nyquist fade window (eval and audio must agree there too).
for (const shift of [0, 2.5, 3.3, 4.2]) {
  const shiftProbes = shift === 0 ? probes : [300, 1000, 3000, 8000, 12000, 16000, 19000, 21000];
  for (const hz of shiftProbes) {
    // Exact eval at this Hz (1-point grid).
    ff.soemdsp_formant_filter_eval_response(sr, P.vowel, P.sweep, shift, P.res, P.body, P.level, ...G, ...ON, 1, hz, hz * 2);
    const want = new Float64Array(ff.memory.buffer, ff.soemdsp_formant_filter_eval_buffer(), 40)[32];
    const h = ff.soemdsp_formant_filter_create();
    const N = sr; let c = 0, s = 0;
    for (let i = 0; i < N; i += 1) {
      const x = Math.sin(2 * Math.PI * hz * i / sr);
      const y = ff.soemdsp_formant_filter_sample(h, x, 1, 0, 0, 0, 0, sr, P.vowel, P.sweep, shift, P.res, P.body, P.drive, P.level, ...G, ...ON);
      if (i >= N / 2) { c += y * Math.cos(2 * Math.PI * hz * i / sr); s += y * Math.sin(2 * Math.PI * hz * i / sr); }
    }
    ff.soemdsp_formant_filter_destroy(h);
    const got = 2 * Math.hypot(c, s) / (N / 2);
    if (want < 1e-4 && got < 1e-4) continue; // both silent (band faded out)
    const d = Math.abs(20 * Math.log10(got / want));
    worstDb = Math.max(worstDb, d);
    assert.ok(d < 0.05, `eval vs audio at ${hz} Hz shift ${shift}: eval ${want}, audio ${got}`);
  }
}
// Eval band gains: fully faded at/after Nyquist, untouched well inside.
{
  ff.soemdsp_formant_filter_eval_response(sr, P.vowel, P.sweep, 7, P.res, P.body, P.level, ...G, ...ON, 2, 30, 16000);
  const E = new Float64Array(ff.memory.buffer, ff.soemdsp_formant_filter_eval_buffer(), 32);
  for (let b = 0; b < 5; b += 1) assert.equal(E[10 + b], 0, `shift +7 band ${b + 1} faded`);
  ff.soemdsp_formant_filter_eval_response(sr, 0, P.sweep, -4, P.res, P.body, P.level, ...G, ...ON, 2, 30, 16000);
  assert.equal(new Float64Array(ff.memory.buffer, ff.soemdsp_formant_filter_eval_buffer(), 32)[10], 0, "shift -4, vowel I: F1 (17 Hz) faded");
}

// 2) Extreme settings stay finite and bounded.
{
  const h = ff.soemdsp_formant_filter_create();
  let peak = 0;
  let seed = 1;
  for (let i = 0; i < sr * 2; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed / 2147483648 - 1;
    const vowel = ((i * 60 / sr) % 1) < 0.5 ? 0 : 1;
    const ext = (i >> 14) & 1;
    const hz = 20 * Math.pow(1000, (i % sr) / sr);
    const shift = -4 + 11 * ((i * 3 / sr) % 1); // fast Shift sweeps over the whole range
    const y = ff.soemdsp_formant_filter_sample(h, x, ext, hz, 1, 1, 1, sr, vowel, (i >> 10) % 5, shift, 4, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1);
    assert.ok(Number.isFinite(y));
    peak = Math.max(peak, Math.abs(y));
  }
  ff.soemdsp_formant_filter_destroy(h);
  assert.ok(peak < 4, `extreme peak ${peak}`);
}

// 2b) No range clamps in code (parameter ranges decide): absurd values stay
//     finite (audio and eval), out-of-range bands are silent, and the module
//     recovers once the knobs come back.
{
  const absurd = [
    { shift: 1e6 }, { shift: -1e6 }, { shift: 1.7e308 }, { shift: -1.7e308 }, { shift: Infinity }, { shift: NaN },
    { vowel: 1e308 }, { vowel: -1e308 }, { vowel: 5 }, { vowel: -3 },
    { res: 0 }, { res: -5 }, { res: 1e9 }, { res: 1e300 },
    { body: -3 }, { body: 10 }, { drive: -1 / 7 }, { drive: -2 }, { drive: 50 }, { drive: 1e308 },
  ];
  for (const over of absurd) {
    const Q = { ...P, ...over };
    const h = ff.soemdsp_formant_filter_create();
    let bad = 0, peak = 0;
    for (let i = 0; i < 4800; i += 1) {
      const y = ff.soemdsp_formant_filter_sample(h, 0, 0, 110, 1, 0.5, 0.5, sr, Q.vowel, P.sweep, Q.shift, Q.res, Q.body, Q.drive, P.level, ...G, ...ON);
      if (!Number.isFinite(y)) bad += 1; peak = Math.max(peak, Math.abs(y));
    }
    let back = 0;
    for (let i = 0; i < 9600; i += 1) {
      const y = ff.soemdsp_formant_filter_sample(h, 0, 0, 110, 1, 0, 0, sr, P.vowel, P.sweep, 0, P.res, P.body, P.drive, P.level, ...G, ...ON);
      if (!Number.isFinite(y)) bad += 1; if (i >= 4800) back += y * y;
    }
    ff.soemdsp_formant_filter_destroy(h);
    assert.equal(bad, 0, `non-finite output at ${JSON.stringify(over)}`);
    assert.ok(back > 1, `recovers after ${JSON.stringify(over)}`);
    ff.soemdsp_formant_filter_eval_response(sr, Q.vowel, P.sweep, Q.shift, Q.res, Q.body, P.level, ...G, ...ON, 256, 30, 16000);
    const E = new Float64Array(ff.memory.buffer, ff.soemdsp_formant_filter_eval_buffer(), 32 + 512);
    assert.ok(E.every(Number.isFinite), `eval non-finite at ${JSON.stringify(over)}`);
  }
  // Huge Shift: every band faded (silent bank), with Body 0 the output is silent.
  for (const shift of [1e6, -1e6, 1.7e308]) {
    const h = ff.soemdsp_formant_filter_create(); let e = 0;
    for (let i = 0; i < 9600; i += 1) { const y = ff.soemdsp_formant_filter_sample(h, 0, 0, 110, 1, 0, 0, sr, P.vowel, P.sweep, shift, P.res, 0, 0, 1, ...G, ...ON); if (i > 4800) e += y * y; }
    ff.soemdsp_formant_filter_destroy(h);
    assert.ok(e === 0, `Shift ${shift}: silent`);
  }
  console.log(`no-clamp: ${absurd.length} absurd settings finite + recover; huge Shift silent`);
}

// 3) Combined graph: Sine -> Formant Filter (type 244).
const graph = new WebAssembly.Instance(new WebAssembly.Module(
  readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url)),
), { env: { emo_process_block: () => {} } }).exports;
assert.ok(graph.soemdsp_graph_version() >= 322, `graph version ${graph.soemdsp_graph_version()}`);
function run(setup, blocks = 200) {
  const c = graph.soemdsp_graph_create();
  graph.soemdsp_graph_set_sample_rate?.(c, sr);
  assert.equal(graph.soemdsp_graph_add_node(c, 1, 40), 0); // Sine Wavetable
  assert.equal(graph.soemdsp_graph_add_node(c, 2, 244), 0); // Formant Filter
  setup(c);
  assert.equal(graph.soemdsp_graph_compile(c), 0);
  let e = 0, n = 0, bad = 0;
  for (let b = 0; b < blocks; b += 1) {
    graph.soemdsp_graph_process_block(c, 128);
    if (b < blocks / 2) continue;
    const y = new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 0), 128);
    for (const v of y) { if (!Number.isFinite(v)) bad += 1; e += v * v; n += 1; }
  }
  graph.soemdsp_graph_destroy(c);
  assert.equal(bad, 0);
  return Math.sqrt(e / n);
}
const base = (hz) => (c) => {
  graph.soemdsp_graph_set_param(c, 1, 10, hz);
  graph.soemdsp_graph_connect(c, 1, 0, 2, 0);
  graph.soemdsp_graph_set_param(c, 2, 13, 1 / 3); // Vowel at A
};
const atF1 = run(base(730));
const bodyOff = run((c) => { base(730)(c); graph.soemdsp_graph_set_param(c, 2, 21, 0); graph.soemdsp_graph_set_param(c, 2, 40, 0); });
const low = run(base(55));
const lowNoBody = run((c) => { base(55)(c); graph.soemdsp_graph_set_param(c, 2, 40, 0); });
const vowelU = run((c) => { base(730)(c); graph.soemdsp_graph_set_param(c, 2, 13, 1); });
// Old Vowel jack (Morph bus 22) is gone: a cable there must not move the vowel.
const vowelJack = run((c) => {
  base(730)(c);
  assert.equal(graph.soemdsp_graph_add_node(c, 3, 40), 0);
  graph.soemdsp_graph_set_param(c, 3, 10, 0.0001);
  graph.soemdsp_graph_set_param(c, 3, 14, 0.75); // phase: wavetable sin = +1 (DC-like)
  graph.soemdsp_graph_set_param(c, 3, 12, 1 / 3); // amplitude: CV = 1/3 -> vowel A
  graph.soemdsp_graph_connect(c, 3, 0, 2, 22);
});
const leftOnly = (() => {
  const c = graph.soemdsp_graph_create();
  graph.soemdsp_graph_add_node(c, 1, 40);
  graph.soemdsp_graph_add_node(c, 2, 244);
  graph.soemdsp_graph_set_param(c, 1, 10, 730);
  graph.soemdsp_graph_set_param(c, 2, 13, 1 / 3);
  graph.soemdsp_graph_connect(c, 1, 0, 2, 1);
  graph.soemdsp_graph_compile(c);
  let e = 0;
  for (let b = 0; b < 100; b += 1) {
    graph.soemdsp_graph_process_block(c, 128);
    const y = new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 1), 128);
    if (b > 50) for (const v of y) e += v * v;
  }
  graph.soemdsp_graph_destroy(c);
  return Math.sqrt(e / (49 * 128));
})();
// Internal source: no input -> BLIT saw at 110 Hz; Noise only -> whisper.
function runAlone(setup, blocks = 200) {
  const c = graph.soemdsp_graph_create();
  graph.soemdsp_graph_set_sample_rate?.(c, sr);
  assert.equal(graph.soemdsp_graph_add_node(c, 2, 244), 0);
  setup(c);
  assert.equal(graph.soemdsp_graph_compile(c), 0);
  const out = [];
  for (let b = 0; b < blocks; b += 1) {
    graph.soemdsp_graph_process_block(c, 128);
    out.push(...new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 0), 128));
  }
  graph.soemdsp_graph_destroy(c);
  assert.ok(out.every(Number.isFinite));
  return out.slice(out.length >> 1);
}
const rms = (a) => Math.sqrt(a.reduce((e, v) => e + v * v, 0) / a.length);
// Hann-windowed single-bin amplitude (window gain 0.5 undone).
const bin = (a, hz) => { let c = 0, s = 0; a.forEach((v, i) => { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / a.length); c += w * v * Math.cos(2 * Math.PI * hz * i / sr); s += w * v * Math.sin(2 * Math.PI * hz * i / sr); }); return 4 * Math.hypot(c, s) / a.length; };
const alone = runAlone(() => {});
const aloneRms = rms(alone);
const fund110 = bin(alone, 110);
const whisper = rms(runAlone((c) => { graph.soemdsp_graph_set_param(c, 2, 51, 0); graph.soemdsp_graph_set_param(c, 2, 50, 1); }));
const silent = rms(runAlone((c) => { graph.soemdsp_graph_set_param(c, 2, 51, 0); }));
const fHz = runAlone((c) => { graph.soemdsp_graph_set_param(c, 2, 10, 220); });
const extHides = bin(runAlone((c) => {
  graph.soemdsp_graph_add_node(c, 1, 40);
  graph.soemdsp_graph_set_param(c, 1, 10, 82.5);
  graph.soemdsp_graph_connect(c, 1, 0, 2, 0);
}), 110);
const db = (v) => (20 * Math.log10(v)).toFixed(1);

// 4) Shift sweep 0 -> +7 oct on the internal 110 Hz saw (graph): centroid per
//    half octave, max sample-to-sample step vs the static renders, NaN.
function fftMag(a) {
  const n = a.length; const re = Float64Array.from(a, (v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n))); const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i += 1) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k += 1) { const wr = Math.cos(ang * k), wi = Math.sin(ang * k); const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr; re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } }
  return Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
}
const centroid = (a) => { const m = fftMag(a); let num = 0, den = 0; m.forEach((v, k) => { num += v * v * k * sr / a.length; den += v * v; }); return den > 0 ? num / den : 0; };
function shiftRender(body, shiftAt, blocks) {
  const c = graph.soemdsp_graph_create();
  graph.soemdsp_graph_set_sample_rate?.(c, sr);
  graph.soemdsp_graph_add_node(c, 2, 244);
  graph.soemdsp_graph_set_param(c, 2, 40, body);
  graph.soemdsp_graph_compile(c);
  const out = new Float64Array(blocks * 128);
  for (let b = 0; b < blocks; b += 1) {
    graph.soemdsp_graph_set_param(c, 2, 30, shiftAt(b / blocks));
    graph.soemdsp_graph_process_block(c, 128);
    out.set(new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 0), 128), b * 128);
  }
  graph.soemdsp_graph_destroy(c);
  return out;
}
const maxStep = (a, from = 0) => { let m = 0; for (let i = Math.max(1, from); i < a.length; i += 1) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
const shiftReport = {};
for (const body of [0, 0.5]) {
  const sweepBlocks = Math.round(8 * sr / 128); // 8 s sweep
  const sweepOut = shiftRender(body, (u) => 7 * u, sweepBlocks);
  assert.ok(sweepOut.every(Number.isFinite), "Shift sweep NaN / Inf");
  const rows = [];
  for (let k = 0; k <= 14; k += 1) {
    const sh = k * 0.5;
    const center = Math.min(sweepOut.length - 2048, Math.round((sh / 7) * sweepOut.length));
    const win = sweepOut.subarray(Math.max(0, center - 2048), Math.max(0, center - 2048) + 4096);
    const r = rms(Array.from(win));
    rows.push({ sh, c: r > 1e-6 ? centroid(win) : 0, r });
  }
  // Static renders: step size the saw itself makes at each shift.
  let staticStep = 0;
  for (let k = 0; k <= 14; k += 1) staticStep = Math.max(staticStep, maxStep(shiftRender(body, () => k * 0.5, 120), 128 * 60));
  const sweepStep = maxStep(sweepOut, 128 * 60);
  shiftReport[body] = { rows, staticStep, sweepStep };
  console.log(`Shift sweep Body ${body}: ` + rows.map((x) => `${x.sh >= 0 ? "+" : ""}${x.sh}:${x.r > 1e-6 ? Math.round(x.c) + "Hz/" + db(x.r) + "dB" : "silent"}`).join(" "));
  console.log(`  max |y[n]-y[n-1]| sweep ${sweepStep.toFixed(4)} vs static max ${staticStep.toFixed(4)}`);
  assert.ok(sweepStep <= staticStep * 1.25 + 1e-9, "Shift sweep clicks: step larger than any static render");
}
{
  // Body 0: centroid keeps rising while the bank is audible (no stall at the old 0.45 x sr clamp).
  const rows = shiftReport[0].rows.filter((x) => x.r > 1e-3);
  const firstSix = rows.filter((x) => x.sh <= 4);
  for (let i = 1; i < firstSix.length; i += 1) assert.ok(firstSix[i].c > firstSix[i - 1].c, `centroid stalls at shift ${firstSix[i].sh}`);
  const last = shiftReport[0].rows[shiftReport[0].rows.length - 1];
  assert.ok(last.r < 1e-3, "Body 0, Shift +7 at 48 kHz: every band faded out");
}

// 5) Stereo noise: independent L / R noise through their own banks; Mono = (L+R)/2.
function runPorts(setup, blocks = 400) {
  const c = graph.soemdsp_graph_create();
  graph.soemdsp_graph_set_sample_rate?.(c, sr);
  graph.soemdsp_graph_add_node(c, 2, 244);
  setup(c);
  graph.soemdsp_graph_compile(c);
  const m = [], l = [], r = [];
  for (let b = 0; b < blocks; b += 1) {
    graph.soemdsp_graph_process_block(c, 128);
    if (b < blocks / 2) continue;
    m.push(...new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 0), 128));
    l.push(...new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 1), 128));
    r.push(...new Float64Array(graph.memory.buffer, graph.soemdsp_graph_node_port_ptr(c, 2, 2), 128));
  }
  graph.soemdsp_graph_destroy(c);
  return { m, l, r };
}
const corr = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i += 1) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb); };
const nz = runPorts((c) => { graph.soemdsp_graph_set_param(c, 2, 51, 0); graph.soemdsp_graph_set_param(c, 2, 50, 1); });
const nzCorr = corr(nz.l, nz.r);
const monoVsSide = rms(nz.m) / (0.5 * (rms(nz.l) + rms(nz.r)));
const sawOnly = runPorts(() => {});
const sawLR = Math.max(...sawOnly.l.map((v, i) => Math.abs(v - sawOnly.r[i])));
const sawML = Math.max(...sawOnly.l.map((v, i) => Math.abs(v - sawOnly.m[i])));
const mixed = runPorts((c) => { graph.soemdsp_graph_set_param(c, 2, 50, 0.5); });
console.log(`stereo noise: L/R correlation ${nzCorr.toFixed(4)}, whisper L ${db(rms(nz.l))} dB R ${db(rms(nz.r))} dB Mono ${db(rms(nz.m))} dB (Mono/side ${monoVsSide.toFixed(3)}); saw only max |L-R| ${sawLR} |L-Mono| ${sawML}; saw + Noise 0.5 L/R corr ${corr(mixed.l, mixed.r).toFixed(3)}`);
assert.ok(Math.abs(nzCorr) < 0.05, "L / R noise decorrelated");
assert.ok(monoVsSide > 0.6 && monoVsSide < 0.8, "Mono noise is the L/R average (about -3 dB)");
assert.ok(sawLR === 0 && sawML === 0, "voiced part identical on L / R / Mono");
console.log(`eval vs audio worst ${worstDb.toFixed(4)} dB`);
console.log(`graph: 730 Hz sine at vowel A ${db(atF1)} dB, F1 off + Body 0 ${db(bodyOff)} dB, Vowel U ${db(vowelU)} dB`);
console.log(`graph: 55 Hz sine Body 0.5 ${db(low)} dB, Body 0 ${db(lowNoBody)} dB; stale Vowel cable ${db(vowelJack)} dB; Left-only ${db(leftOnly)} dB`);
console.log(`internal: no input RMS ${db(aloneRms)} dB, 110 Hz fundamental ${db(fund110)} dB; 220 Hz knob fundamental ${db(bin(fHz, 220))} dB; whisper RMS ${db(whisper)} dB; Saw 0 ${db(silent)} dB; Ext In wired -> internal 110 Hz ${db(extHides)} dB`);
assert.ok(aloneRms > 0.1, "no input: internal saw makes sound");
assert.ok(fund110 > 0.05, "internal saw sits at 110 Hz by default");
assert.ok(bin(fHz, 220) > 0.05, "Frequency knob moves the saw");
assert.ok(whisper > 0.05, "Noise alone whispers");
assert.ok(silent < 1e-6, "Saw 0, Noise 0, no Ext In: silent");
assert.ok(extHides < 1e-3, "Ext In cable replaces the internal saw");
assert.ok(atF1 > 0.9, "a sine at F1 should pass near or above unity");
assert.ok(bodyOff < atF1 * 0.5, "F1 off + Body 0 should drop the F1 sine");
assert.ok(vowelU < atF1 * 0.5, "Vowel U moves F1 away from 730 Hz");
assert.ok(low > lowNoBody * 4, "Body carries the fundamental");
assert.ok(Math.abs(20 * Math.log10(vowelJack / atF1)) < 0.1, "a cable on the removed Vowel bus changes nothing");
assert.ok(leftOnly > 0.9, "Left-only input is filtered on Left");
console.log("Formant Filter native smoke passed");