// Pulse Train Out and End use the shared trigger symbol: Out is the symbol
// alone, End is "End" + symbol; both carry white digital cables.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const ctx = { console, Math, Number, String, Array, Object, JSON };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public", "node-graph-port-geometry.js"), "utf8"), ctx);
const G = vm.runInContext("NODE_GRAPH_TRIGGER_GLYPH", ctx);
const label = (t, p) => ctx.nodeGraphGateTriggerPortDisplayLabel(t, p);
gate(label("pulseTrain", "Out") === G, `Pulse Train Out: trigger symbol only (${label("pulseTrain", "Out")})`);
gate(label("pulseTrain", "End") === `End${G}`, `Pulse Train End: End + trigger symbol (${label("pulseTrain", "End")})`);
gate(label("pulseTrain", "Out") === label("clock", "Pulse") && label("clock", "Pulse") === label("sequencer", "Trigger"), "same symbol as Clock Pulse and Trigger ports");
gate(ctx.nodeGraphGateTriggerPortSpokenName("pulseTrain", "End") === "End trigger" && ctx.nodeGraphGateTriggerPortSpokenName("pulseTrain", "Out") === "Trigger", "spoken names");
gate(ctx.nodeGraphPortIsGateOrTrigger("Out", "pulseTrain") && ctx.nodeGraphPortIsGateOrTrigger("End", "pulseTrain"), "white digital cables");
gate(label("pulseTrain", "f") === "" && label("pulseExplosion", "Out") === "" && label("noise", "Out") === "", "other Out ports unchanged");
console.log(failures ? `FAILED ${failures}` : "smoke_pulse_train_trigger_ports ok");
process.exit(failures ? 1 : 0);
