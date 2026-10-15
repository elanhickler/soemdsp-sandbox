/**
 * Keyboard pitch/gate sync (sample accurate): F and Pitch are per-sample
 * blocks written from the same stamped events as Gate/Trigger. On a key
 * press F equals the new pitch on exactly the gate's first high sample and
 * the old pitch on the sample before it. Covers note-on, legato and MIDI.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = path.join(__dirname, "..", "public");
const P = function NodeLiveAudioProcessor() {};
P.prototype = {};
const sandbox = {
  console, Object, Array, Map, Set, String, Number, Boolean, Math, JSON, Float64Array,
  NodeLiveAudioProcessor: P,
  sampleRate: 48000,
  nodeGraphFiniteNumber: (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d),
};
vm.createContext(sandbox);

function slice(file, from, to, tail = "") {
  const src = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  assert(a >= 0 && b > a, `slice ${from} in ${file}`);
  vm.runInContext(src.slice(a, b) + tail, sandbox, { filename: file });
}
slice("node-live-audio-worklet-events.js",
  "NodeLiveAudioProcessor.prototype.queueKeyboardEvent =",
  "NodeLiveAudioProcessor.prototype.setKeyboardModuleSignal =");
slice("node-live-audio-worklet-native-graph.js",
  "NodeLiveAudioProcessor.HOST_INLET_MIX = ",
  "NodeLiveAudioProcessor.prototype.expandControllerDigitalThruConnections =");
slice("node-live-audio-worklet-native-graph.js",
  "NodeLiveAudioProcessor.prototype.nativeHostCvFeederKind =",
  "NodeLiveAudioProcessor.prototype.writeNativeHostCvSampleBlocksChunk =");
slice("node-live-audio-worklet-native-graph.js",
  "NodeLiveAudioProcessor.prototype.syncNativeHostCvFeeders =",
  "  // Metamodule Amplitude inlet", "};"); // ends mid-function: close it
P.NATIVE_GRAPH_PARAM_ATT_OFFSET = 0;
P.NATIVE_GRAPH_TYPE_IDS = { audioInput: 7 };

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const near = (a, b) => Math.abs(a - b) < 1e-9;

function rig(type, fPort, pitchPort) {
  const views = new Map();
  const pushed = [];
  const id = type === "keyboardController" ? "midi" : "kb";
  const self = Object.create(P.prototype);
  Object.assign(self, {
    nodes: new Map([[id, { type }]]),
    keyboardSignalByNode: new Map(),
    midiKeyboardSignal: null,
    efficientProduct: true,
    nativeGraphCompiled: true,
    nativeGraphHandle: 1,
    nativeGraph: {},
    _nativeHostCvFeeders: [],
    nativeHostCvSampleBlockView: (feed) => views.get(feed.hash),
    pushNativeGraphParam: (_n, hash) => pushed.push(hash),
  });
  ["Gate", "Trigger", fPort, pitchPort].forEach((port, i) => {
    assert(self.efficientModSourceIsSampleBlock(id, port), `${type}.${port} must be a per-sample block`);
    assert(self.nativeHostCvFeederKind(id, port, 99).typeId === 7, `${type}.${port} feeder must be AudioInput`);
    views.set(i + 1, new Float64Array(128));
    self._nativeHostCvFeeders.push({ hash: i + 1, sourceNode: id, sourcePort: port, sampleBlock: true });
  });
  // Thru expansion stays Gate/Trigger only (keyboards have no F / Pitch inlets).
  assert(P.hostInletMixPorts(type).indexOf(fPort) < 0, "F must not join inlet-mix thru");
  const arrive = (next, atFrame) => {
    if (type === "keyboardController") {
      const prev = self.midiKeyboardSignal;
      self.midiKeyboardSignal = next;
      self.queueKeyboardEvent("\u0000midiKeyboard", prev, next, next, atFrame);
    } else {
      const prev = self.keyboardSignalByNode.get(id);
      self.keyboardSignalByNode.set(id, next);
      self.queueKeyboardEvent(id, prev, next, next, atFrame);
    }
  };
  if (type === "keyboardController") {
    self.keyboardEventStateFor = function keyboardEventStateFor() {
      return this._keyboardEventState?.get?.("\u0000midiKeyboard") || null;
    };
  }
  const quantum = (start) => {
    self.prepareKeyboardEventBlock(start, 128, 1);
    self._keyboardChunkStart = 0;
    self._keyboardChunkFrames = 128;
    self.syncNativeHostCvFeeders();
    assert(pushed.length === 0, "no quantum Bias push for keyboard F / Pitch");
    return {
      gate: Array.from(views.get(1)),
      trig: Array.from(views.get(2)),
      f: Array.from(views.get(3)),
      pitch: Array.from(views.get(4)),
    };
  };
  return { arrive, quantum };
}

const sig = (gate, midi, extra = {}) => ({ gate, midi, velocity: 1, rawMidi: midi, frequency: hz(midi), ...extra });

function run(type, fPort, pitchPort) {
  const { arrive, quantum } = rig(type, fPort, pitchPort);
  arrive(sig(1, 69), 0);
  let q = quantum(0);
  assert(q.gate[0] > 0 && near(q.f[0], 440) && q.pitch[0] === 69, `${type} A4 on at 0`);
  arrive(sig(0, 69), 200);
  quantum(128);
  q = quantum(256);
  assert(q.gate.every((v) => v === 0) && q.f.every((v) => near(v, 440)), `${type} release keeps pitch`);

  // Note-on C5 stamped 3 quanta ahead at offset 40.
  arrive(sig(1, 72), 768 + 40);
  for (const s of [384, 512, 640]) {
    q = quantum(s);
    assert(q.f.every((v) => near(v, 440)), `${type} F moved before its gate (quantum ${s})`);
  }
  q = quantum(768);
  const rise = q.gate.findIndex((v) => v > 0);
  assert(rise === 40, `${type} gate rise at 40, got ${rise}`);
  assert(q.trig[40] > 0, `${type} trigger at 40`);
  assert(near(q.f[39], 440), `${type} F on sample before gate must be old pitch: ${q.f[39]}`);
  assert(near(q.f[40], hz(72)), `${type} F on gate's first high sample must be new pitch: ${q.f[40]}`);
  assert(q.pitch[39] === 69 && q.pitch[40] === 72, `${type} Pitch steps on the gate sample`);
  assert(q.f.slice(40).every((v) => near(v, hz(72))), `${type} no glide after the step`);

  // Legato D5 while C5 held, stamped at 1024 + 300 (quantum 1280, offset 44).
  arrive(sig(1, 74, { gatePulse: 1 }), 1024 + 300);
  quantum(896);
  q = quantum(1024);
  assert(q.f.every((v) => near(v, hz(72))), `${type} legato F early`);
  q = quantum(1152);
  q = quantum(1280);
  assert(q.trig.findIndex((v) => v > 0) === 44, `${type} legato retrigger at 44`);
  assert(near(q.f[43], hz(72)) && near(q.f[44], hz(74)), `${type} legato F steps on the retrigger sample`);
  assert(q.pitch[43] === 72 && q.pitch[44] === 74, `${type} legato Pitch steps on the retrigger sample`);
  assert(q.gate[43] > 0 && q.gate[44] > 0, `${type} legato gate held`);
}

run("keyboard", "f", "pitch");
run("gridKeyboard", "f", "pitch");
run("keyboardController", "Frequency", "pitch");
console.log("test_keyboard_pitch_gate_sync: ok (keyboard, gridKeyboard, MIDI)");
