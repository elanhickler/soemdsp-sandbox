// Headless: Softpop Filter (type 214) audio inputs through the combined wasm
// graph. Input routing follows soemdsp/routing/stereo_route.h: Mono alone,
// a lone Left or a lone Right -> the same signal into both channels; Left and
// Right both wired -> Left channel = Left + Mono, Right channel = Right + Mono.
// Any wired input replaces the internal noise. Sources are Softpop
// Oscillators (type 207, Sine, Pitch Mod 0) so the inputs are pure tones.
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

const TYPE_OSC = 207, TYPE_FILTER = 214, TYPE_OUT = 6;
const PARAM = { FREQUENCY: 10, AMPLITUDE: 12, WIDTH: 31, PITCH: 45, SEED: 48 };
const PORT = { MONO: 0, LEFT: 1, RIGHT: 2 };
const SR = 48000, FRAMES = 128, BLOCKS = 200;
const FILT = 0x5f0f0001 >>> 0, OUT = 0x5f0f00ff >>> 0;
const OSC = { a: 0x5f0f0a01 >>> 0, b: 0x5f0f0b01 >>> 0, c: 0x5f0f0c01 >>> 0 };
const OSC_HZ = { a: 1000, b: 1200, c: 800 };

let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures++; };

// wires: [[oscKey, filterInPort], ...]. Returns rendered Left / Right / Mono.
function render(wires) {
  const g = create() | 0;
  setSr(g, SR);
  add(g, FILT, TYPE_FILTER);
  add(g, OUT, TYPE_OUT);
  for (const k of new Set(wires.map((w) => w[0]))) {
    add(g, OSC[k], TYPE_OSC);
    setParam(g, OSC[k], PARAM.FREQUENCY, OSC_HZ[k]);
    setParam(g, OSC[k], PARAM.PITCH, 0);
  }
  for (const [k, p] of wires) connect(g, OSC[k], PORT.MONO, FILT, p);
  connect(g, FILT, PORT.LEFT, OUT, 0);
  connect(g, FILT, PORT.RIGHT, OUT, 0);
  setParam(g, FILT, PARAM.FREQUENCY, 1000);
  setParam(g, FILT, PARAM.WIDTH, 0.8);
  setParam(g, FILT, PARAM.PITCH, 0);
  setParam(g, FILT, PARAM.SEED, 1);
  if ((compile(g) | 0) < 0) throw new Error("compile");
  snap(g);
  const out = { l: new Float64Array(BLOCKS * FRAMES), r: new Float64Array(BLOCKS * FRAMES), m: new Float64Array(BLOCKS * FRAMES) };
  for (let b = 0; b < BLOCKS; b++) {
    processBlock(g, FRAMES);
    const rd = (p) => new Float64Array(e.memory.buffer, portPtr(g, FILT, p) | 0, FRAMES);
    out.m.set(rd(PORT.MONO), b * FRAMES);
    out.l.set(rd(PORT.LEFT), b * FRAMES);
    out.r.set(rd(PORT.RIGHT), b * FRAMES);
  }
  destroy(g);
  return out;
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const close = (a, b) => { let m = 0, s = 0; for (let i = 0; i < a.length; i++) { m = Math.max(m, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(b[i])); } return m <= 1e-9 * Math.max(1, s); };
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

const noise = render([]);
const mono = render([["a", PORT.MONO]]);
const loneL = render([["a", PORT.LEFT]]);
const loneR = render([["a", PORT.RIGHT]]);
gate(!eq(noise.l, noise.r) && rms(noise.l) > 0.05, `nothing wired: internal noise, L != R (RMS ${rms(noise.l).toFixed(3)})`);
gate(eq(mono.l, mono.r) && rms(mono.l) > 0.3 && !eq(mono.l, noise.l), `Mono in: copied into both channels, replaces the noise (RMS ${rms(mono.l).toFixed(3)})`);
gate(eq(mono.m, mono.l), "Mono out == Left render");
gate(eq(loneL.l, mono.l) && eq(loneL.r, mono.r), "lone Left in: treated as Mono (both channels)");
gate(eq(loneR.l, mono.l) && eq(loneR.r, mono.r), "lone Right in: treated as Mono (both channels)");
// Stereo source: L and R independent.
const stereo = render([["a", PORT.LEFT], ["b", PORT.RIGHT]]);
const onlyB = render([["b", PORT.MONO]]);
gate(eq(stereo.l, mono.l) && eq(stereo.r, onlyB.r) && !eq(stereo.l, stereo.r), "Left + Right in: Left channel = Left source, Right channel = Right source");
// Stereo + Mono: L' = L + M, R' = R + M (the filter is linear, so sums of single renders).
const withM = render([["a", PORT.LEFT], ["b", PORT.RIGHT], ["c", PORT.MONO]]);
const onlyC = render([["c", PORT.MONO]]);
gate(close(withM.l, mono.l.map((v, i) => v + onlyC.l[i])) && close(withM.r, onlyB.r.map((v, i) => v + onlyC.r[i])),
  "Left + Right + Mono in: Left = filter(Left + Mono), Right = filter(Right + Mono)");
// Single source with all three summed: Mono + lone Left -> both channels get M + L.
const monoPlusL = render([["a", PORT.LEFT], ["c", PORT.MONO]]);
gate(eq(monoPlusL.l, monoPlusL.r) && close(monoPlusL.l, mono.l.map((v, i) => v + onlyC.l[i])), "Mono + lone Left in: single source M + L into both channels");
// --- Bypass (native process_bypass): inputs thru, stereo_route feeds, Noise / CV silent ---
const setBypassed = must("soemdsp_graph_set_bypassed");
function renderBypassed(wires) {
  const g = create() | 0;
  setSr(g, SR);
  add(g, FILT, TYPE_FILTER);
  add(g, OUT, TYPE_OUT);
  const keys = [...new Set(wires.map((w) => w[0]))];
  for (const k of keys) {
    add(g, OSC[k], TYPE_OSC);
    setParam(g, OSC[k], PARAM.FREQUENCY, OSC_HZ[k]);
    setParam(g, OSC[k], PARAM.PITCH, 0);
  }
  for (const [k, p] of wires) connect(g, OSC[k], PORT.MONO, FILT, p);
  connect(g, FILT, PORT.LEFT, OUT, 0);
  connect(g, FILT, PORT.RIGHT, OUT, 0);
  if ((compile(g) | 0) < 0) throw new Error("compile");
  setBypassed(g, FILT, 1);
  snap(g);
  const n = BLOCKS * FRAMES;
  const out = { l: new Float64Array(n), r: new Float64Array(n), m: new Float64Array(n), side: 0, src: {} };
  for (const k of keys) out.src[k] = new Float64Array(n);
  for (let b = 0; b < BLOCKS; b++) {
    processBlock(g, FRAMES);
    const rd = (node, p) => new Float64Array(e.memory.buffer, portPtr(g, node, p) | 0, FRAMES);
    out.m.set(rd(FILT, PORT.MONO), b * FRAMES);
    out.l.set(rd(FILT, PORT.LEFT), b * FRAMES);
    out.r.set(rd(FILT, PORT.RIGHT), b * FRAMES);
    for (const p of [3, 4, 5, 6]) for (const v of rd(FILT, p)) out.side = Math.max(out.side, Math.abs(v));
    for (const k of keys) out.src[k].set(rd(OSC[k], PORT.MONO), b * FRAMES);
  }
  destroy(g);
  return out;
}
const zeros = new Float64Array(BLOCKS * FRAMES);
const sum = (a, b) => a.map((v, i) => v + b[i]);
{
  const bn = renderBypassed([]);
  gate(eq(bn.l, zeros) && eq(bn.r, zeros) && bn.side === 0, "bypass, nothing wired: silent (noise voice is a source)");
  const bs = renderBypassed([["a", PORT.LEFT], ["b", PORT.RIGHT]]);
  gate(eq(bs.l, bs.src.a) && eq(bs.r, bs.src.b) && eq(bs.m, bs.l) && bs.side === 0, "bypass, Left + Right in: Left out = Left in, Right out = Right in, Mono out = Left, Noise / CV silent");
  const bm = renderBypassed([["a", PORT.MONO]]);
  gate(eq(bm.l, bm.src.a) && eq(bm.r, bm.src.a) && eq(bm.m, bm.src.a), "bypass, Mono in: into both outs");
  const bl = renderBypassed([["a", PORT.LEFT]]);
  gate(eq(bl.l, bl.src.a) && eq(bl.r, bl.src.a), "bypass, lone Left in: into both outs (stereo_route, same as live)");
  const bsm = renderBypassed([["a", PORT.LEFT], ["b", PORT.RIGHT], ["c", PORT.MONO]]);
  gate(close(bsm.l, sum(bsm.src.a, bsm.src.c)) && close(bsm.r, sum(bsm.src.b, bsm.src.c)), "bypass, Left + Right + Mono in: Left = L + M, Right = R + M");
}
// --- JS bypass spec (plan side): declared map, Noise / CV not mapped ---
{
  const vm = await import("vm");
  const ctx = { console, Object, Array, Set, Map, String, Number, RegExp, globalThis: {} };
  vm.createContext(ctx);
  ctx.nodeGraphModuleDefinitions = { softpopFilter: { inputs: ["Reset", "f", "In", "Left", "Right"], outputs: ["Mono", "Left", "Right", "Noise L", "Noise R", "CV L", "CV R"], bypass: "pass", bypassMap: [{ out: "Mono", in: "Left" }, { out: "Left", in: "Left" }, { out: "Right", in: "Right" }] } };
  vm.runInContext(fs.readFileSync(path.join(root, "public", "node-graph-module-bypass.js"), "utf8") + "\nthis.__spec = nodeGraphModuleBypassSpec;", ctx);
  // The real definition carries the same map.
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const blk = defs.slice(defs.indexOf("  softpopFilter: {"), defs.indexOf("parameters:", defs.indexOf("  softpopFilter: {")));
  const spec = ctx.__spec("softpopFilter");
  const outs = spec.map.map((r) => `${r.out}<-${r.in}`).join(",");
  gate(spec.mode === "pass" && outs === "Mono<-Left,Left<-Left,Right<-Right" && blk.includes('bypassMap: [{ out: "Mono", in: "Left" }, { out: "Left", in: "Left" }, { out: "Right", in: "Right" }]'),
    `JS bypass spec: pass ${outs}; Noise / CV outputs unmapped (silent)`);
}
console.log(failures ? `FAILED ${failures}` : "smoke_graph_softpop_filter ok");
if (failures) process.exit(1);
