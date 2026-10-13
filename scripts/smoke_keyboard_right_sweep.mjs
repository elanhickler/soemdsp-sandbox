// Keyboard right-click sweep (arp-style): right press on a key = Trigger with
// Gate low; right drag = one Trigger per new key; same key = nothing; release
// clears. Left press still plays with Gate high. Two keyboards stay independent.
// Runs the real updateNodeGraphMidiKeyboardSignal in a vm, then feeds what it
// renders through the real worklet event queue and the real key highlighter.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public", "node-graph-view-controls.js"), "utf8");
const start = src.indexOf("function updateNodeGraphMidiKeyboardSignal(event)");
const end = src.indexOf("function handleNodeGraphMidiKeyboardPointerLeave(", start);
if (start < 0 || end < 0) throw new Error("updateNodeGraphMidiKeyboardSignal not found");
const fnSrc = src.slice(start, end);

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const runtimes = new Map();
const rendered = [];
const sandbox = {
  nodeGraphMidiKeyboardModeForElement: (s) => s.mode,
  nodeGraphMidiKeyboardNodeIdFromElement: (s) => s.nodeId,
  nodeGraphKeyboardRuntime: (id) => {
    if (!runtimes.has(id)) runtimes.set(id, {});
    return runtimes.get(id);
  },
  nodeGraphMidiKeyboardHeldPointerSignal: () => null,
  clearNodeGraphMidiKeyboardPointerHold: () => {},
  nodeGraphMidiKeyboardSignalFromPointer: (ev, s, opts) => ({ rawMidi: ev.midi, midi: ev.midi, gate: 1, gatePulse: 0 }),
  nodeGraphMidiKeyboardRawMidiFromSignal: (sig) => Number(sig?.rawMidi),
  renderNodeGraphMidiKeyboardSignal: (id, sig) => {
    rendered.push({ id, ...sig });
    sandbox.nodeGraphKeyboardRuntime(id).signal = sig;
  },
  nodeGraphMidiKeyboardPointerXY: () => ({ x: 0, y: 0, velocity: 1 }),
  nodeGraphMidiKeyboardFallbackSignal: () => ({}),
  updateNodeGraphMidiKeyboardPointerPosition: () => {},
  toggleNodeGraphMidiKeyboardPointerHold: () => {},
  renderNodeGraphMidiKeyboardActiveKeys: () => {},
};
vm.createContext(sandbox);
vm.runInContext(`${fnSrc}\nthis.update = updateNodeGraphMidiKeyboardSignal;`, sandbox);

function makeSurface(nodeId, mode) {
  const surface = { nodeId, mode, contains: () => true, setPointerCapture() {}, releasePointerCapture() {} };
  const module = { querySelector: () => surface };
  return { surface, module };
}
function ev(kb, type, midi, { button = 0, buttons = 0, pointerId = 1, onKey = true, ctrl = false } = {}) {
  const key = onKey ? { dataset: { keyIndex: "0", midi: String(midi) } } : null;
  return {
    type, button, buttons, pointerId, midi, ctrlKey: ctrl, shiftKey: false, altKey: false,
    currentTarget: { closest: () => kb.module },
    target: { closest: (sel) => (sel.includes("data-key-index") || sel.includes("data-midi") ? key : null) },
    getModifierState: () => false, preventDefault() {}, stopPropagation() {},
  };
}

for (const mode of ["press", "slide", "hold"]) {
  rendered.length = 0;
  runtimes.clear();
  const a = makeSurface(`kbA-${mode}`, mode);
  const b = makeSurface(`kbB-${mode}`, mode);
  sandbox.update(ev(a, "pointerdown", 60, { button: 2, buttons: 2 }));
  assert(rendered.length === 1 && rendered[0].gate === 0 && rendered[0].gatePulse === 1 && rendered[0].midi === 60,
    `${mode}: right press should fire Trigger with Gate low on 60: ${JSON.stringify(rendered)}`);
  sandbox.update(ev(a, "pointermove", 60, { buttons: 2 }));
  assert(rendered.length === 1, `${mode}: same key must not retrigger`);
  sandbox.update(ev(a, "pointermove", 62, { buttons: 2 }));
  sandbox.update(ev(a, "pointermove", 64, { buttons: 2 }));
  assert(rendered.length === 3 && rendered.slice(1).every((r) => r.gate === 0 && r.gatePulse === 1),
    `${mode}: each new key fires one Trigger, Gate low`);
  assert(rendered[2].midi === 64, `${mode}: sweep pitch follows key`);
  // Keyboard B is independent: no sweep state leaked.
  assert(runtimes.get(`kbB-${mode}`) === undefined, `${mode}: other keyboard touched`);
  sandbox.update(ev(a, "pointerup", 64, {}));
  assert(runtimes.get(`kbA-${mode}`).rightSweepPointerId === null, `${mode}: release clears sweep`);
  const before = rendered.length;
  sandbox.update(ev(a, "pointermove", 65, { buttons: 0 }));
  assert(rendered.length === before, `${mode}: no Trigger after release`);
  // Left press still the normal play path (Gate high) on keyboard B.
  if (mode !== "hold") {
    sandbox.update(ev(b, "pointerdown", 67, { button: 0, buttons: 1 }));
    const last = rendered[rendered.length - 1];
    assert(last.id === `kbB-${mode}` && last.gate === 1, `${mode}: left press should play Gate high`);
  }
  // Right press off the keys is not intercepted (menu stays elsewhere).
  const n = rendered.length;
  sandbox.update(ev(b, "pointerdown", 70, { button: 2, buttons: 2, onKey: false, pointerId: 5 }));
  assert(runtimes.get(`kbB-${mode}`).rightSweepPointerId == null, `${mode}: off-key right press must not start a sweep`);
  void n;
}

// Context menu: blocked on keys only; panel elsewhere still opens settings.
const kls = fs.readFileSync(path.join(root, "public", "modules", "keyboardController", "keyboard-layout-settings.js"), "utf8");
assert(/closest\?\.\("\.node-midi-keyboard-surface \[data-key-index\]"\)/.test(kls), "context menu key guard missing");
assert(kls.includes("openNodeGraphKeyboardControllerDisplaySettings(event);"), "settings menu path missing");

// â€”â€”â€” Real downstream path (would have caught the dead sweep) â€”â€”â€”
// 1) Real worklet queueKeyboardEvent + prepareKeyboardEventBlock: each sweep
//    signal the handler renders must land as a Trigger pulse with Gate low.
const wsrc = fs.readFileSync(path.join(root, "public", "node-live-audio-worklet-events.js"), "utf8");
function protoSlice(name) {
  const a = wsrc.indexOf(`NodeLiveAudioProcessor.prototype.${name} = function`);
  const b = wsrc.indexOf("\n};", a);
  assert(a >= 0 && b > a, `${name} not found in worklet`);
  return wsrc.slice(a, b + 3);
}
const wctx = { NodeLiveAudioProcessor: function NodeLiveAudioProcessor() {}, sampleRate: 48000 };
vm.createContext(wctx);
vm.runInContext(`${protoSlice("queueKeyboardEvent")}\n${protoSlice("prepareKeyboardEventBlock")}`, wctx);
{
  rendered.length = 0;
  runtimes.clear();
  const kb = makeSurface("kbW", "slide");
  sandbox.update(ev(kb, "pointerdown", 60, { button: 2, buttons: 2 }));
  sandbox.update(ev(kb, "pointermove", 60, { buttons: 2 }));
  sandbox.update(ev(kb, "pointermove", 62, { buttons: 2 }));
  sandbox.update(ev(kb, "pointermove", 64, { buttons: 2 }));
  const proc = new wctx.NodeLiveAudioProcessor();
  let prev;
  let frame = 0;
  for (const sig of rendered) {
    const next = { gate: sig.gate, rawMidi: sig.rawMidi, velocity: 1 };
    proc.queueKeyboardEvent("kbW", prev, next, sig, frame);
    // The 60 ms display clear re-sends the same note with gatePulse 0: no Trigger.
    proc.queueKeyboardEvent("kbW", next, next, { ...sig, gatePulse: 0 }, frame + 1);
    prev = next;
    frame += 10;
  }
  proc.prepareKeyboardEventBlock(0, 128, 1);
  const plan = proc._keyboardEventState.get("kbW").plan;
  assert(plan.pulses.length === 3, `worklet: expected 3 sweep Triggers, got ${plan.pulses.length}`);
  assert(plan.edges.every((e) => e.gate === 0), "worklet: sweep must keep Gate low");
  // A held left-click note still only strikes on its rising edge.
  const p2 = new wctx.NodeLiveAudioProcessor();
  const held = { gate: 1, rawMidi: 60, velocity: 1 };
  p2.queueKeyboardEvent("kbH", undefined, held, { gatePulse: 1 }, 0);
  p2.queueKeyboardEvent("kbH", held, { gate: 0, rawMidi: 60, velocity: 1 }, { gatePulse: 0 }, 5);
  p2.prepareKeyboardEventBlock(0, 128, 1);
  assert(p2._keyboardEventState.get("kbH").plan.pulses.length === 1, "worklet: left press/release = one Trigger");
}

// 2) Real renderNodeGraphMidiKeyboardActiveKeys: swept key is blue while held.
{
  const aStart = src.indexOf("function renderNodeGraphMidiKeyboardActiveKeys(");
  const aEnd = src.indexOf("\n}", aStart);
  assert(aStart >= 0 && aEnd > aStart, "renderNodeGraphMidiKeyboardActiveKeys not found");
  const keys = [60, 62, 64].map((m) => {
    const cls = new Set();
    return { dataset: { midi: String(m) }, cls, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } };
  });
  const face = { classList: { contains: () => true }, querySelectorAll: () => keys };
  const actx = {
    nodeGraphKeyboardNodeIds: () => ["kbW"],
    nodeGraphKeyboardRuntime: (id) => sandbox.nodeGraphKeyboardRuntime(id),
    nodeGraphMidiKeyboardHeldPointerSignal: () => null,
    nodeGraphMidiKeyboardRawMidiFromSignal: (s) => Number(s?.rawMidi),
    nodeGraphHeldKeysDemux: () => null,
    nodeGraphKeyboardFaces: () => [face],
  };
  vm.createContext(actx);
  vm.runInContext(`${src.slice(aStart, aEnd + 2)}\nthis.paint = renderNodeGraphMidiKeyboardActiveKeys;`, actx);
  actx.paint("kbW");
  const lit = keys.filter((k) => k.cls.has("active")).map((k) => k.dataset.midi);
  assert(lit.length === 1 && lit[0] === "64", `highlight: swept key 64 should be blue, got ${lit}`);
  sandbox.update(ev(makeSurface("kbW", "slide"), "pointerup", 64, {}));
  actx.paint("kbW");
  assert(keys.every((k) => !k.cls.has("active")), "highlight: release clears the swept key");
}

console.log("smoke_keyboard_right_sweep ok: press/slide/hold, per-module, worklet Trigger with Gate low, blue highlight");
