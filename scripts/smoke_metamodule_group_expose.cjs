// Group-into-Metamodule: inbound param cables auto-expose and retarget to mx_*.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..", "public");
const ctx = {
  console,
  Math,
  JSON,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Set,
  Map,
  document: { getElementById: () => null, querySelector: () => null },
  nodeGraphMvp: { patch: null, activeNodes: new Set(), selected: null, metamoduleViewStack: [] },
  nodeGraphFiniteNumber: (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  },
  nodeGraphModuleDefinitions: {
    pulseTrain: { parameters: [{ key: "amplitude", label: "Amplitude", defaultValue: "1" }] },
  },
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "modules", "metamodule", "metamodule-core.js"), "utf8"),
  ctx,
  { filename: "metamodule-core.js" },
);

const r = (src) => vm.runInContext(src, ctx);
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const patch = {
  nodes: [
    { id: "pulseTrain-1", type: "pulseTrain", gx: 0, gy: 0, params: { amplitude: 0.4 }, paramMeta: {} },
    { id: "keyboard-1", type: "keyboard", gx: -4, gy: 0, params: {}, paramMeta: {} },
  ],
  connections: [],
  graphConnections: [],
  modulations: [
    {
      sourceNode: "keyboard-1",
      sourcePort: "Gate",
      destinationNode: "pulseTrain-1",
      destinationParam: "amplitude",
    },
  ],
};
ctx.nodeGraphMvp.patch = patch;
ctx.nodeGraphPatchNode = (id) => patch.nodes.find((n) => n.id === id) || null;
ctx.nodeGraphSelectedNodeIdsInOrder = () => ["pulseTrain-1"];
ctx.nodeGraphSelectedNodeIds = () => new Set(["pulseTrain-1"]);
ctx.nodeGraphMetamoduleIsRootView = () => true;
ctx.nodeGraphPatchIsLocked = () => false;
ctx.createNodeGraphPatchNode = (type, extra) => ({ type, params: {}, paramMeta: {}, ...extra });
ctx.commitNodeGraphPatch = () => {};
ctx.selectNodeGraphItem = () => {};

const meta = r("groupNodeGraphSelectionIntoMetamodule()");
ok(meta && meta.id, "grouped into a metamodule");
ok(r("nodeGraphMetamoduleIsParamExposed(nodeGraphMvp.patch.nodes.find(n => n.type === 'metamodule'), 'pulseTrain-1', 'amplitude')") === true, "Amplitude shown on metamodule");
const mods = patch.modulations;
ok(mods.length === 1, "one modulation remains");
ok(mods[0].destinationNode === meta.id, "modulation lands on the shell");
ok(String(mods[0].destinationParam).startsWith("mx_"), `shell param ${mods[0].destinationParam}`);
ok(mods[0].destinationParam.includes("amplitude"), "shell param is Amplitude");
ok(Number(meta.params[mods[0].destinationParam]) === 0.4, "shell seeded from inner Amplitude");
console.log("ok metamodule group auto-exposes inbound Amplitude modulation");
