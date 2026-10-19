// Flower Child ƒ: a Hz cable into ƒ sets the resonance pitch you hear (replaces Cutoff
// per sample, resolve_osc_hz). At Resonance 1, Clean and Dirty must ring at the cabled
// Hz; the graph publishes that pitch via soemdsp_graph_node_effective_hz.
// Hz source: Robin Sinepulse ƒ out (Left). Unhit it holds Low Freq; hit, it sweeps.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bytes = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const imports = {};
for (const imp of WebAssembly.Module.imports(new WebAssembly.Module(bytes))) if (imp.kind === "function") (imports[imp.module] ||= {})[imp.name] = () => 0;
const e = (await WebAssembly.instantiate(bytes, imports)).instance.exports;
if ((e.soemdsp_graph_version() | 0) < 181) throw new Error("graph version < 181");
const SR = 48000, FC = 2, SP = 1, OSC = 3, OUT = 4;
const P = { FREQ: 10, AMP: 12, SHAPE: 13, RESO: 20, MODE: 21, CENTER: 30, TNUM: 52, TDEN: 53, WAVE: 11 };
const PORT = { MONO: 0, LEFT: 1, F: 16, TRIG: 20 };
let fail = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fail++; };

function run({ mode, high, low, hit, seconds, chaos = 0.002 }) {
  const g = e.soemdsp_graph_create() | 0; e.soemdsp_graph_set_sample_rate(g, SR);
  const S = (h, i, v) => e.soemdsp_graph_set_param(g, h, i, v);
  e.soemdsp_graph_add_node(g, SP, 205); e.soemdsp_graph_add_node(g, FC, 61); e.soemdsp_graph_add_node(g, OUT, 6);
  S(SP, P.FREQ, high); S(SP, P.CENTER, low); S(SP, P.TNUM, 0.3); S(SP, P.TDEN, 4); S(SP, P.AMP, 1);
  S(FC, P.FREQ, 0.1 /* Cutoff knob: must be ignored */); S(FC, P.RESO, 1); S(FC, P.MODE, mode); S(FC, P.SHAPE, chaos); S(FC, P.AMP, 1);
  e.soemdsp_graph_connect(g, SP, PORT.LEFT, FC, PORT.F);
  e.soemdsp_graph_connect(g, FC, PORT.MONO, OUT, PORT.MONO);
  if (hit) { e.soemdsp_graph_add_node(g, OSC, 1); S(OSC, P.FREQ, 0.25); S(OSC, P.WAVE, 4); S(OSC, P.AMP, 1); e.soemdsp_graph_connect(g, OSC, PORT.MONO, SP, PORT.TRIG); }
  e.soemdsp_graph_compile(g); e.soemdsp_graph_snap_controls(g);
  const N = Math.round(seconds * SR / 128) * 128, y = new Float64Array(N), hz = new Float64Array(N), pub = [];
  for (let b = 0; b < N; b += 128) {
    e.soemdsp_graph_process_block(g, 128);
    y.set(new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, FC, PORT.MONO) | 0, 128), b);
    hz.set(new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, SP, PORT.LEFT) | 0, 128), b);
    pub.push([b + 127, e.soemdsp_graph_node_effective_hz(g, FC)]);
  }
  e.soemdsp_graph_destroy(g);
  return { y, hz, pub };
}
const crossings = (y, a, b) => { const z = []; for (let i = Math.max(1, a); i < b; i++) if (y[i - 1] <= 0 && y[i] > 0) z.push(i - y[i] / (y[i] - y[i - 1])); return z; };
const cents = (a, b) => 1200 * Math.log2(a / b);

// Steady 100 Hz (and a high and low check) on Clean / Dirty.
for (const [mode, name, tol] of [[0, "Clean", 5], [1, "Dirty", 25]]) {
  for (const f of [100, 440, 1500]) {
    const { y, pub } = run({ mode, high: 3000, low: f, hit: false, seconds: 1.5 });
    const z = crossings(y, SR * 0.75, y.length);
    const meas = (z.length - 1) * SR / (z[z.length - 1] - z[0]);
    const lastPub = pub[pub.length - 1][1];
    ok(Math.abs(cents(meas, f)) < tol, `${name} ƒ ${f} Hz rings at ${meas.toFixed(2)} Hz (${cents(meas, f).toFixed(1)} cents, tol ${tol})`);
    ok(Math.abs(cents(lastPub, f)) < 0.5, `${name} ƒ ${f} Hz: effective Hz published ${lastPub.toFixed(2)}`);
  }
}
// Sweep: Sinepulse hit, ƒ 1500 -> 80 Hz over 0.3 s; resonance pitch follows window by window.
for (const [mode, name, tol] of [[0, "Clean", 10], [1, "Dirty", 40]]) {
  const { y, hz, pub } = run({ mode, high: 1500, low: 80, hit: true, seconds: 0.6 });
  let worst = 0, n = 0;
  const z = crossings(y, 1, y.length);
  for (let k = 2; k + 2 < z.length; k++) {
    const t = z[k]; if (t < SR * 0.02) continue; // let the resonance lock first
    const period = (z[k + 1] - z[k - 1]) / 2, meas = SR / period, want = hz[Math.round(t)];
    if (want < 90) continue;
    worst = Math.max(worst, Math.abs(cents(meas, want))); n++;
  }
  const pubErr = Math.max(...pub.filter(([i]) => i > 256).map(([i, v]) => Math.abs(cents(v, hz[i]))));
  ok(n > 20 && worst < tol, `${name} sweep 1500 -> 80 Hz: pitch tracks the cable over ${n} cycles (worst ${worst.toFixed(1)} cents, tol ${tol})`);
  ok(pubErr < 0.5, `${name} sweep: published effective Hz = cable Hz (worst ${pubErr.toFixed(3)} cents)`);
}
// Unwired ƒ: Cutoff knob rules again and nothing is published.
{
  const g = e.soemdsp_graph_create() | 0; e.soemdsp_graph_set_sample_rate(g, SR);
  e.soemdsp_graph_add_node(g, FC, 61); e.soemdsp_graph_add_node(g, OUT, 6); e.soemdsp_graph_connect(g, FC, 0, OUT, 0);
  e.soemdsp_graph_compile(g); e.soemdsp_graph_process_block(g, 128);
  ok(e.soemdsp_graph_node_effective_hz(g, FC) === -1, "ƒ unwired: no effective Hz published (-1)");
  e.soemdsp_graph_destroy(g);
}
console.log(fail ? `${fail} FAILED` : "flower child ƒ smoke ok"); process.exit(fail ? 1 : 0);
