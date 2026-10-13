// Keyboard Gate/Trigger are sample-accurate on every keyboard route.
// Trigger: exactly one sample per strike, at its stamped offset (late -> sample 0,
// never dropped, never longer). Gate: edges at the exact sample.
// Routes: Keyboard, Grid Keyboard, MIDI keyboard (keyboardController); jack,
// MOD (ParamModEdge feeders share nativeHostCvFeederKind), and Thru legs.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, "..", "public");
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures += 1; console.log(`FAIL ${msg}`); }
};

function P() {}
P.prototype = {};
P.NATIVE_GRAPH_TYPE_IDS = { audioInput: 7 };
const sandbox = { console, Map, Set, Math, Number, String, Array, Object, JSON, NodeLiveAudioProcessor: P, sampleRate: 48000 };
vm.createContext(sandbox);
const slice = (file, from, to) => {
  const src = fs.readFileSync(path.join(pub, file), "utf8").replace(/\r\n/g, "\n");
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(`slice not found in ${file}: ${from}`);
  vm.runInContext(src.slice(a, b), sandbox, { filename: file });
};
slice("node-live-audio-worklet-events.js",
  "NodeLiveAudioProcessor.KEYBOARD_MIDI_EVENT_ID",
  "NodeLiveAudioProcessor.prototype.setMidiKeyboardPlayKeysBitmask");
slice("node-live-audio-worklet-native-graph.js",
  "NodeLiveAudioProcessor.HOST_INLET_MIX =",
  "NodeLiveAudioProcessor.prototype.expandControllerDigitalThruConnections");
slice("node-live-audio-worklet-native-graph.js",
  "NodeLiveAudioProcessor.prototype.nativeHostCvFeederKind",
  "/**\n * Mono buf of a sample-block feeder");

const types = { kb: "keyboard", grid: "gridKeyboard", midi: "keyboardController" };
function makeProc() {
  const proc = Object.create(P.prototype);
  proc.nodes = new Map(Object.entries(types).map(([id, type]) => [id, { type }]));
  proc.keyboardSignalByNode = new Map();
  proc.midiKeyboardSignal = null;
  proc._normalizeKeyboardSignalPayload = (s, o) => ({ ...(o?.previous || {}), ...s });
  return proc;
}
function send(proc, id, signal, atFrame) {
  if (types[id] === "keyboardController") proc.setMidiKeyboardSignal(signal, atFrame);
  else proc.setKeyboardModuleSignal(id, signal, atFrame);
}
// One quantum (host 128 frames, engine 128*os) in 128-frame chunks, like processNativeGraphQuantum.
function quantum(proc, id, start, os = 1) {
  proc.prepareKeyboardEventBlock(start, 128, os);
  const frames = 128 * os;
  const gate = new Float64Array(frames);
  const trig = new Float64Array(frames);
  for (let w = 0; w < frames; w += 128) {
    proc._keyboardChunkStart = w;
    proc._keyboardChunkFrames = 128;
    const g = new Float64Array(128);
    const t = new Float64Array(128);
    proc.readEfficientModSourceBlock(id, "Gate", g);
    proc.readEfficientModSourceBlock(id, "Trigger", t);
    gate.set(g, w);
    trig.set(t, w);
  }
  return { gate, trig };
}
const nz = (a) => [...a.keys()].filter((i) => a[i] !== 0);

for (const id of Object.keys(types)) {
  const t = types[id];
  check(P.hostInletMixKind(t, "Trigger") === "edge" && P.hostInletMixKind(t, "Gate") === "level",
    `${t}: Gate/Trigger are inlet-mix sample-block ports (Thru legs splice natively)`);
  const proc = makeProc();
  check(proc.nativeHostCvFeederKind(id, "Trigger", 99).sampleBlock === true, `${t}: Trigger feeder (jack + MOD) is a sample block`);
  check(proc.nativeHostCvFeederKind(id, "Gate", 99).sampleBlock === true, `${t}: Gate feeder (jack + MOD) is a sample block`);

  for (const os of [1, 2]) {
    const p = makeProc();
    const start = 4096;
    send(p, id, { gate: 1, velocity: 0.8, rawMidi: 60, gatePulse: 1 }, start + 37);
    let q = quantum(p, id, start, os);
    check(nz(q.trig).length === 1 && q.trig[37 * os] === 0.8, `${t} os${os}: trigger is 1 sample at offset ${37 * os}`);
    check(q.gate[37 * os - 1] === 0 && q.gate[37 * os] === 0.8 && q.gate[128 * os - 1] === 0.8, `${t} os${os}: gate rises at the same sample`);
    q = quantum(p, id, start + 128, os);
    check(nz(q.trig).length === 0, `${t} os${os}: no trigger in the next block (not held)`);
    check(nz(q.gate).length === 128 * os, `${t} os${os}: gate held through next block`);
    send(p, id, { gate: 0, velocity: 0.8, rawMidi: 60 }, start + 256 + 90);
    q = quantum(p, id, start + 256, os);
    check(q.gate[90 * os - 1] === 0.8 && q.gate[90 * os] === 0, `${t} os${os}: gate falls at offset ${90 * os}`);
    check(nz(q.trig).length === 0, `${t} os${os}: release sends no trigger`);
    send(p, id, { gate: 1, velocity: 0.5, rawMidi: 62, gatePulse: 1 }, start + 100);
    q = quantum(p, id, start + 384, os);
    check(nz(q.trig).length === 1 && q.trig[0] === 0.5, `${t} os${os}: late strike lands on sample 0, one sample`);
    send(p, id, { gate: 0, velocity: 0.5, rawMidi: 62 }, start + 512 + 10);
    send(p, id, { gate: 1, velocity: 1, rawMidi: 64, gatePulse: 1 }, start + 512 + 11);
    q = quantum(p, id, start + 512, os);
    check(nz(q.trig).length === 1 && q.trig[11 * os] === 1 && q.gate[11 * os - 1] === 0 && q.gate[11 * os] === 1,
      `${t} os${os}: release+restrike: gate dips, trigger 1 sample at ${11 * os}`);
    send(p, id, { gate: 1, velocity: 0.7, rawMidi: 65, gatePulse: 1 }, start + 640 + 5);
    send(p, id, { gate: 1, velocity: 0.7, rawMidi: 65, gatePulse: 1 }, start + 640 + 6);
    q = quantum(p, id, start + 640, os);
    check(nz(q.trig).length === 1 && q.trig[5 * os] === 0.7, `${t} os${os}: legato restrike once, same-key resend ignored`);
    send(p, id, { gate: 0, velocity: 0.7, rawMidi: 65 }, start + 768 + 128 + 3);
    q = quantum(p, id, start + 768, os);
    check(nz(q.gate).length === 128 * os, `${t} os${os}: future event not applied early`);
    q = quantum(p, id, start + 896, os);
    check(q.gate[3 * os - 1] > 0 && q.gate[3 * os] === 0, `${t} os${os}: future event applied at its sample`);
  }
}
const src = fs.readFileSync(path.join(pub, "node-live-audio-worklet-native-graph.js"), "utf8");
check(!/_keyboardDownPulseByNode|_keyboardPulseCommit/.test(src), "no held pulse flag left in the worklet");
const side = fs.readFileSync(path.join(pub, "modules/_shared/controller-efficient-sidecar.js"), "utf8");
check(!/signal\.gatePulse/.test(side), "sidecar Trigger does not read the held gatePulse");
console.log(failures ? `\n${failures} FAILED` : "\nall keyboard trigger checks passed");
process.exit(failures ? 1 : 0);
