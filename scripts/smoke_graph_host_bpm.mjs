// Host BPM (graph 305): every out comes from the shared project beat position.
//   - no tempo entry -> 120 BPM; ƒ at 1/4 = 2 Hz, pitch = MIDI of ƒ
//   - a tempo change never jumps Phase (the beat is the integral of the tempo)
//   - two Host BPMs with different divisions stay locked to the same beat
//   - set_host_beats (plugin) places the beat exactly
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")),
  { env: { emo_process_block: () => 0 } },
);
const E = instance.exports;
const SR = 48000, TYPE_HOST_BPM = 192;
const PORT = { MONO: 0, RIGHT: 2, SAW: 3, RAMP: 4, SQUARE: 5 };
const P = { NUM: 52, DEN: 53, MODE: 54 };
const fail = (m) => { throw new Error(m); };
const g = E.soemdsp_graph_create() | 0;
E.soemdsp_graph_set_sample_rate(g, SR);
const A = 0x9101, B = 0x9102;
if (E.soemdsp_graph_add_node(g, A, TYPE_HOST_BPM) | 0) fail("add A");
if (E.soemdsp_graph_add_node(g, B, TYPE_HOST_BPM) | 0) fail("add B");
for (const [h, num, den, mode] of [[A, 1, 4, 0], [B, 1, 8, 2]]) {
  E.soemdsp_graph_set_param(g, h, P.NUM, num);
  E.soemdsp_graph_set_param(g, h, P.DEN, den);
  E.soemdsp_graph_set_param(g, h, P.MODE, mode);
}
if (E.soemdsp_graph_compile(g) | 0) fail("compile");
E.soemdsp_graph_snap_controls(g);
const rd = (h, port) => new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
const block = () => { E.soemdsp_graph_process_block(g, 128); return { bpm: rd(A, PORT.MONO)[0], f: rd(A, PORT.SAW)[0], pitch: rd(A, PORT.RAMP)[0], pa: [...rd(A, PORT.SQUARE)], pb: [...rd(B, PORT.SQUARE)] }; };

// 1) No tempo entry -> 120 BPM, 1/4 -> 2 Hz.
E.soemdsp_graph_set_host_transport(g, 0, 0, 0);
let r = block();
if (r.bpm !== 120) fail(`no tempo: BPM ${r.bpm}, want 120`);
if (Math.abs(r.f - 2) > 1e-12) fail(`ƒ ${r.f}, want 2 Hz`);
const midi2 = 69 + 12 * Math.log2(2 / 440);
if (Math.abs(r.pitch - midi2) > 1e-6) fail(`pitch ${r.pitch}, want ${midi2}`);
console.log(`ok Host BPM no tempo entry: 120 BPM, ƒ ${r.f} Hz, pitch ${r.pitch.toFixed(3)}`);

// 2) Tempo change mid-run: Phase steps stay continuous (no jump).
let prev = r.pa[127], maxStep = 0;
for (let q = 0; q < 200; q++) {
  if (q === 100) E.soemdsp_graph_set_host_transport(g, 90, 0, 0);
  const s = block();
  for (const v of s.pa) {
    let d = v - prev; if (d < -0.5) d += 1; // wrap
    maxStep = Math.max(maxStep, Math.abs(d));
    prev = v;
  }
}
const stepAt120 = 120 / 60 / SR; // 1/4 cycle = one beat
if (maxStep > stepAt120 * 1.0001) fail(`tempo change jumped Phase: max step ${maxStep} > ${stepAt120}`);
console.log(`ok tempo 120 -> 90 mid-run: Phase never jumps (max step ${maxStep.toExponential(3)})`);

// 3) Two Host BPMs (1/4 normal, 1/8 triplet) read the same beat: phases relate exactly.
const s = block();
const cycA = 1, cycB = 4 * (1 / 8) * (2 / 3);
for (let i = 0; i < 128; i++) {
  const beatsA = s.pa[i] * cycA, phaseB = s.pb[i];
  // beats mod cycB from A's phase can't be recovered alone, so compare against set_host_beats below.
  if (!(phaseB >= 0 && phaseB < 1) || !(beatsA >= 0 && beatsA < 1)) fail("phase out of range");
}
// 4) set_host_beats places the beat exactly: beat 10.25 -> 1/4 phase 0.25, 1/8 triplet phase (10.25 / (1/3)) mod 1 = 0.75.
E.soemdsp_graph_set_host_beats(g, 10.25);
const t = block();
if (Math.abs(t.pa[0] - 0.25) > 1e-9) fail(`set_host_beats 10.25: 1/4 phase ${t.pa[0]}`);
if (Math.abs(t.pb[0] - 0.75) > 1e-9) fail(`set_host_beats 10.25: 1/8T phase ${t.pb[0]}`);
console.log(`ok set_host_beats 10.25: 1/4 phase ${t.pa[0].toFixed(6)}, 1/8 triplet phase ${t.pb[0].toFixed(6)} (both from one beat)`);
E.soemdsp_graph_destroy(g);
console.log("ok host bpm");
