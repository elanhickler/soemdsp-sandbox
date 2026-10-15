// Headless: Sidechain (type 216) through the combined wasm graph.
// Sources are Softpop Oscillators (type 207, Sine, Pitch Mod 0).
// Ports: Wet L = 1, Wet R = 2, Dry L = 3, Dry R = 4, Envelope = 5,
// Sidechain = 22 (Morph live bus). Outs: Left = 1, Right = 2, gain tap = 3.
// Gates: unity when the key is silent; ducking from Sidechain and from Dry
// (Sidechain unwired); Envelope override (gain = 1 - clamp(e, 0, 1), ignores
// Threshold); Hold delays the release; mono fallback per pair; bypass = Dry + Wet.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const create = must("soemdsp_graph_create");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const destroy = must("soemdsp_graph_destroy");
const setBypassed = must("soemdsp_graph_set_bypassed");

const TYPE_OSC = 207, TYPE_SC = 216, TYPE_OUT = 6;
const P = { FREQUENCY: 10, AMPLITUDE: 12, PITCH: 45, THRESHOLD: 105, RATIO: 31, ATTACK: 55, HOLD: 52, RELEASE: 104 };
const IN = { WET_L: 1, WET_R: 2, DRY_L: 3, DRY_R: 4, ENV: 5, SC: 22 };
const OUT_L = 1, OUT_R = 2, GAIN = 3;
const SR = 48000, FRAMES = 128;
const SCN = 0x5c0c0001 >>> 0, OUTN = 0x5c0c00ff >>> 0;
const SRC = { dry: [0x5c0c0a01 >>> 0, 300], wet: [0x5c0c0b01 >>> 0, 700], wet2: [0x5c0c0b02 >>> 0, 900], key: [0x5c0c0c01 >>> 0, 60], env: [0x5c0c0d01 >>> 0, 5] };

let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures++; };

// opts: wires [[srcKey, inPort]], amps {srcKey: amp}, params {P: v}, blocks, bypass, at: {block, src, amp}
function render(opts) {
  const blocks = opts.blocks || 200;
  const g = create() | 0;
  setSr(g, SR);
  add(g, SCN, TYPE_SC);
  add(g, OUTN, TYPE_OUT);
  const keys = [...new Set(opts.wires.map((w) => w[0]))];
  for (const k of keys) {
    add(g, SRC[k][0], TYPE_OSC);
    setParam(g, SRC[k][0], P.FREQUENCY, SRC[k][1]);
    setParam(g, SRC[k][0], P.PITCH, 0);
    setParam(g, SRC[k][0], P.AMPLITUDE, (opts.amps && opts.amps[k] !== undefined) ? opts.amps[k] : 0.5);
  }
  for (const [k, p] of opts.wires) connect(g, SRC[k][0], 0, SCN, p);
  connect(g, SCN, OUT_L, OUTN, 0);
  connect(g, SCN, OUT_R, OUTN, 0);
  for (const [id, v] of Object.entries(opts.params || {})) setParam(g, SCN, Number(id), v);
  if ((compile(g) | 0) < 0) throw new Error("compile");
  if (opts.bypass) setBypassed(g, SCN, 1);
  snap(g);
  const n = blocks * FRAMES;
  const out = { l: new Float64Array(n), r: new Float64Array(n), g: new Float64Array(n), src: {} };
  for (const k of keys) out.src[k] = new Float64Array(n);
  for (let b = 0; b < blocks; b++) {
    if (opts.at && b === opts.at.block) setParam(g, SRC[opts.at.src][0], P.AMPLITUDE, opts.at.amp);
    processBlock(g, FRAMES);
    const rd = (node, p) => new Float64Array(e.memory.buffer, portPtr(g, node, p) | 0, FRAMES);
    out.l.set(rd(SCN, OUT_L), b * FRAMES);
    out.r.set(rd(SCN, OUT_R), b * FRAMES);
    out.g.set(rd(SCN, GAIN), b * FRAMES);
    for (const k of keys) out.src[k].set(rd(SRC[k][0], 0), b * FRAMES);
  }
  destroy(g);
  return out;
}
const close = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const rms = (a, from = 0) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length - from)); };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add2 = (a, b) => a.map((v, i) => v + b[i]);
const tail = (a) => a.length >> 1;

// 1. Unity when the key is silent (Sidechain wired at amplitude 0, Dry quiet below Threshold).
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, key: 0 } });
  gate(close(o.l, add2(o.src.dry, o.src.wet)) && o.g.every((v) => v === 1), "silent Sidechain: out = Dry + Wet exactly, gain 1");
}
// 2. Ducking from Sidechain: key 0 dB vs Threshold -18 dB, Ratio 8 -> deep duck; Dry untouched.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, key: 1 } });
  const wetOut = sub(o.l, o.src.dry);
  const ratio = rms(wetOut, tail(wetOut)) / rms(o.src.wet, tail(wetOut));
  const gMin = Math.min(...o.g.slice(tail(o.g)));
  gate(ratio < 0.25 && gMin < 0.3, `Sidechain key ducks Wet (Wet RMS ratio ${ratio.toFixed(3)}, gain ${gMin.toFixed(3)})`);
  gate(close(o.l.map((v, i) => v - o.g[i] * o.src.wet[i]), o.src.dry, 1e-9), "Dry passes at unity: out = Dry + gain * Wet");
}
// 3. Sidechain unwired: Dry keys the ducking.
{
  const loud = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L]], amps: { dry: 1, wet: 0.5 } });
  const quiet = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L]], amps: { dry: 0.05, wet: 0.5 } });
  gate(Math.min(...loud.g.slice(tail(loud.g))) < 0.3, "no Sidechain: loud Dry ducks Wet");
  gate(quiet.g.every((v) => v === 1) && close(quiet.l, add2(quiet.src.dry, quiet.src.wet)), "no Sidechain: Dry below Threshold = unity");
  const wetOnly = render({ wires: [["wet", IN.WET_L]], amps: { wet: 1 } });
  gate(close(wetOnly.l, wetOnly.src.wet) && close(wetOnly.r, wetOnly.src.wet), "Wet only (no Dry, no key): no ducking, lone Wet L feeds both sides");
}
// 4. Envelope override: gain = 1 - clamp(e, 0, 1), Threshold / key ignored.
{
  const a = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["env", IN.ENV], ["key", IN.SC]], amps: { dry: 0.3, wet: 0.5, env: 1.3, key: 1 } });
  const b = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["env", IN.ENV]], amps: { dry: 0.3, wet: 0.5, env: 1.3 }, params: { [P.THRESHOLD]: -48, [P.RATIO]: 20 } });
  const want = a.src.env.map((ev, i) => 1 - Math.min(1, Math.max(0, ev)));
  gate(close(a.g, want, 1e-12) && close(a.l, a.src.dry.map((d, i) => d + want[i] * a.src.wet[i]), 1e-9), "Envelope wired: gain = 1 - clamp(Envelope, 0, 1), raw per sample");
  gate(close(a.l, b.l, 1e-12), "Envelope wired: Sidechain and Threshold / Ratio have no effect");
}
// 5. Hold: after the key stops, gain stays down for Hold ms, then releases.
{
  const run = (holdMs) => render({ wires: [["wet", IN.WET_L], ["key", IN.SC]], amps: { wet: 0.5, key: 1 }, params: { [P.HOLD]: holdMs, [P.RELEASE]: 50 }, blocks: 300, at: { block: 100, src: "key", amp: 0 } });
  const h0 = run(0), h300 = run(300);
  const idx = Math.round(100 * FRAMES + 0.2 * SR); // 200 ms after the key drops
  gate(h300.g[idx] < 0.5 && h0.g[idx] > h300.g[idx] + 0.3, `Hold 300 ms keeps the duck (g ${h300.g[idx].toFixed(3)}) while Hold 0 has released (g ${h0.g[idx].toFixed(3)})`);
  gate(h300.g[h300.g.length - 1] > 0.95, "after Hold, Release brings the gain back");
}
// 6. Stereo pairs + stereo link.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["wet2", IN.WET_R], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, wet2: 0.5, key: 1 } });
  gate(close(o.r, o.src.dry.map((d, i) => d + o.g[i] * o.src.wet2[i]), 1e-9), "Wet R ducked by the same gain; lone Dry L feeds both sides");
}
// 7. Bypass = Dry + Wet (no ducking).
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.3, wet: 0.5, key: 1 }, bypass: true });
  gate(close(o.l, add2(o.src.dry, o.src.wet)) && close(o.r, add2(o.src.dry, o.src.wet)), "bypass: Left / Right = Dry + Wet");
}
console.log(failures ? `FAILED ${failures}` : "smoke_graph_sidechain ok");
if (failures) process.exit(1);
