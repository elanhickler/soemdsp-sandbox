// Headless: Sidechain (type 216) through the combined wasm graph.
// Sources are Softpop Oscillators (type 207, Sine, Pitch Mod 0).
// Ports: Wet L = 1, Wet R = 2, Dry L = 3, Dry R = 4, Envelope = 5,
// Sidechain = 22 (Morph live bus). Outs: Left = 1, Right = 2, Envelope = 3.
// Mix law: m = Mix + (Ducked Mix - Mix) * env; out = Dry (1 - m) + Wet m.
// Gates: env 0 (silent key) = Mix crossfade; env 1 (Envelope input 1) =
// Ducked Mix crossfade; ducking from Sidechain and from Dry (Sidechain
// unwired); Envelope override (env = clamp(e, 0, 1), ignores Threshold);
// Ducked Mix > Mix swells; Hold delays the release; mono fallback per pair;
// bypass = Dry; Envelope output = env. Plus the shared GL gain face geometry.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

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
const P = { FREQUENCY: 10, AMPLITUDE: 12, PITCH: 45, THRESHOLD: 105, RATIO: 31, ATTACK: 55, HOLD: 52, RELEASE: 104, MIX: 40, DUCKED_MIX: 42 };
const IN = { WET_L: 1, WET_R: 2, DRY_L: 3, DRY_R: 4, ENV: 5, SC: 22 };
const OUT_L = 1, OUT_R = 2, ENV_OUT = 3;
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
    out.g.set(rd(SCN, ENV_OUT), b * FRAMES);
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

const MIX = 0.35; // default Mix; Ducked Mix default 0
const xf = (d, w, m) => d.map((v, i) => v * (1 - m[i]) + w[i] * m[i]);
const mOf = (env, mix = MIX, ducked = 0) => env.map((e) => mix + (ducked - mix) * e);
const flat = (n, v) => new Float64Array(n).fill(v);

// 1. env 0: silent key (Sidechain wired at amplitude 0) = Mix crossfade, Envelope out 0.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, key: 0 } });
  gate(o.g.every((v) => v === 0) && close(o.l, xf(o.src.dry, o.src.wet, flat(o.l.length, MIX))), "silent Sidechain: env 0, out = Dry x 0.65 + Wet x 0.35 (Mix)");
}
// 2. env 1 via the Envelope input: Ducked Mix crossfade.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["env", IN.ENV]], amps: { dry: 0.3, wet: 0.5, env: 1 }, params: { [P.DUCKED_MIX]: 0.1 } });
  const m = mOf(o.src.env.map((e) => Math.min(1, Math.max(0, e))), MIX, 0.1);
  gate(close(o.l, xf(o.src.dry, o.src.wet, m), 1e-9), "Envelope input: m = lerp(Mix, Ducked Mix, clamp(e, 0, 1)) per sample");
  const full = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["env", IN.ENV]], amps: { dry: 0.3, wet: 0.5, env: 4 }, params: { [P.DUCKED_MIX]: 0.1 } });
  let atOne = 0, okOne = true;
  for (let k = 0; k < full.l.length; k++) {
    if (full.src.env[k] >= 1) { atOne++; if (Math.abs(full.l[k] - (full.src.dry[k] * 0.9 + full.src.wet[k] * 0.1)) > 1e-9 || full.g[k] !== 1) okOne = false; }
  }
  gate(atOne > 100 && okOne, `env 1: out = Dry x 0.9 + Wet x 0.1 (Ducked Mix), Envelope out 1 (${atOne} samples)`);
}
// 3. Ducking from Sidechain: key 0 dB vs Threshold -18 dB, Ratio 8 -> env near 1.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, key: 1 } });
  const eMax = Math.max(...o.g.slice(tail(o.g)));
  gate(eMax > 0.7 && o.g.every((v) => v >= 0 && v <= 1), `Sidechain key ducks (Envelope out ${eMax.toFixed(3)})`);
  gate(close(o.l, xf(o.src.dry, o.src.wet, mOf(o.g)), 1e-9), "out follows m = lerp(Mix, Ducked Mix, Envelope out)");
  const sw = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, key: 1 }, params: { [P.MIX]: 0.1, [P.DUCKED_MIX]: 0.9 } });
  const wetPart = rms(sw.l.map((v, i) => v - sw.src.dry[i] * (1 - (0.1 + 0.8 * sw.g[i]))), tail(sw.l)) / rms(sw.src.wet, tail(sw.l));
  gate(wetPart > 0.6, `Ducked Mix > Mix: Wet swells on hits (Wet share ${wetPart.toFixed(3)} vs Mix 0.1)`);
}
// 4. Sidechain unwired: Dry keys the ducking; below Threshold = env 0.
{
  const loud = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L]], amps: { dry: 1, wet: 0.5 } });
  const quiet = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L]], amps: { dry: 0.05, wet: 0.5 } });
  gate(Math.max(...loud.g.slice(tail(loud.g))) > 0.7, "no Sidechain: loud Dry ducks");
  gate(quiet.g.every((v) => v === 0) && close(quiet.l, xf(quiet.src.dry, quiet.src.wet, flat(quiet.l.length, MIX))), "no Sidechain: Dry below Threshold = Mix crossfade");
  const wetOnly = render({ wires: [["wet", IN.WET_L]], amps: { wet: 1 } });
  const want = wetOnly.src.wet.map((v) => v * MIX);
  gate(close(wetOnly.l, want) && close(wetOnly.r, want), "Wet only (no Dry, no key): Wet x Mix, lone Wet L feeds both sides");
}
// 5. Envelope override ignores Sidechain / Threshold / Ratio.
{
  const a = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["env", IN.ENV], ["key", IN.SC]], amps: { dry: 0.3, wet: 0.5, env: 1.3, key: 1 } });
  const b = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["env", IN.ENV]], amps: { dry: 0.3, wet: 0.5, env: 1.3 }, params: { [P.THRESHOLD]: -48, [P.RATIO]: 20 } });
  const want = a.src.env.map((ev) => Math.min(1, Math.max(0, ev)));
  gate(close(a.g, want, 1e-12), "Envelope wired: Envelope out = clamp(Envelope in, 0, 1), raw per sample");
  gate(close(a.l, b.l, 1e-12), "Envelope wired: Sidechain and Threshold / Ratio have no effect");
}
// 6. Hold: after the key stops, env stays up for Hold ms, then releases.
{
  const run = (holdMs) => render({ wires: [["wet", IN.WET_L], ["key", IN.SC]], amps: { wet: 0.5, key: 1 }, params: { [P.HOLD]: holdMs, [P.RELEASE]: 50 }, blocks: 300, at: { block: 100, src: "key", amp: 0 } });
  const h0 = run(0), h300 = run(300);
  const idx = Math.round(100 * FRAMES + 0.2 * SR); // 200 ms after the key drops
  gate(h300.g[idx] > 0.5 && h300.g[idx] > h0.g[idx] + 0.3, `Hold 300 ms keeps the duck (env ${h300.g[idx].toFixed(3)}) while Hold 0 has released (env ${h0.g[idx].toFixed(3)})`);
  gate(h300.g[h300.g.length - 1] < 0.05, "after Hold, Release brings env back to 0");
}
// 7. Stereo pairs + stereo link.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["wet2", IN.WET_R], ["key", IN.SC]], amps: { dry: 0.05, wet: 0.5, wet2: 0.5, key: 1 } });
  gate(close(o.r, xf(o.src.dry, o.src.wet2, mOf(o.g)), 1e-9), "Wet R uses the same env; lone Dry L feeds both sides");
}
// 8. Bypass = Dry, Envelope out 0.
{
  const o = render({ wires: [["dry", IN.DRY_L], ["wet", IN.WET_L], ["key", IN.SC]], amps: { dry: 0.3, wet: 0.5, key: 1 }, bypass: true });
  gate(close(o.l, o.src.dry) && close(o.r, o.src.dry) && o.g.every((v) => v === 0), "bypass: Left / Right = Dry, Envelope 0");
}
// 9. Shared GL gain face (Pump Limiter Gain / Sidechain Envelope): geometry only.
{
  const req = createRequire(import.meta.url);
  const face = req(path.join(root, "public", "modules", "lookaheadLimiter", "lookahead-limiter-display.js"));
  const gainPts = face.nodeGraphLimiterGainFacePoints([1, 1, 0.5, 0.5], 4, 4, 11, false);
  const duckPts = face.nodeGraphLimiterGainFacePoints([0, 0, 0.5, 0.5], 4, 4, 11, true);
  gate(gainPts.join() === duckPts.join() && gainPts[1] === 0.5 && gainPts[7] === 5.5, "GL face: Gain 0.5 and Envelope 0.5 both dip to mid-height; rest sits at the top");
  const src = fs.readFileSync(path.join(root, "public", "modules", "lookaheadLimiter", "lookahead-limiter-display.js"), "utf8");
  gate(!/getContext\(|ctx\.stroke|drawNodeGraphTraceDisplay/.test(src) && /nodeGraphGlLinesBegin/.test(src) && /nodeGraphGlLinesFillBlack/.test(src), "GL face: gl-line-renderer only, no 2D drawing, black on GL failure");
}
console.log(failures ? `FAILED ${failures}` : "smoke_graph_sidechain ok");
if (failures) process.exit(1);
