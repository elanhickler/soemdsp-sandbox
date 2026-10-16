// Plugin host topology locks: adding modules allowed; wiring + delete stay locked.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, "../public/plugin-host.js");
const src = fs.readFileSync(srcPath, "utf8");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!src.includes('var LOCK_HINT = "Plugin: wiring and deleting modules are locked.";')) {
  fail("LOCK_HINT must say wiring/deleting only (no add, no soundemote.io/Sandbox-app wording)");
}
if (/LOCK_HINT[\s\S]{0,80}adding/i.test(src)) {
  fail("LOCK_HINT must not mention adding");
}
if (/soundemote\.io/i.test(src)) {
  fail("plugin-host.js must not mention soundemote.io");
}

const blockedMatch = src.match(/var BLOCKED = \[([\s\S]*?)\];/);
if (!blockedMatch) fail("BLOCKED list missing");
const blocked = [...blockedMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const mustBlock = [
  "connectNodeGraphPorts",
  "connectNodeGraphModulation",
  "connectNodeGraphGraphInput",
  "disconnectNodeGraphConnection",
  "disconnectNodeGraphConnections",
  "deleteNodeGraphSelectionFromContext",
  "deleteNodeGraphModuleFromContext",
];
const mustAllow = [
  "addNodeGraphModuleFromShop",
  "addNodeGraphModuleFromContext",
  "beginNodeGraphModulePlacement",
];
for (const name of mustBlock) {
  if (!blocked.includes(name)) fail(`BLOCKED missing ${name}`);
}
for (const name of mustAllow) {
  if (blocked.includes(name)) fail(`BLOCKED must not include ${name}`);
}

if (/opts\.wireEdit\s*\|\|\s*opts\.topologyEdit/.test(src)) {
  fail("commit wrapper must not block topologyEdit");
}
if (!/if\s*\(\s*opts\.wireEdit\s*\)/.test(src)) {
  fail("commit wrapper must still block wireEdit");
}

// Simulate the commit gate + afterCommit topology send.
const calls = [];
const patchA = {
  nodes: [{ id: "sine-1", type: "sine", params: { Frequency: 440 } }],
  connections: [],
};
const patchB = {
  nodes: [
    { id: "sine-1", type: "sine", params: { Frequency: 440 } },
    { id: "gain-1", type: "gain", params: { Gain: 0.5 } },
  ],
  connections: [],
};

function topologySignature(patch) {
  if (!patch || typeof patch !== "object") return "";
  const parts = [];
  for (const n of patch.nodes || []) {
    if (n) parts.push(`n:${n.id}:${n.type}`);
  }
  parts.sort();
  return parts.join("|");
}

let lastSentSignature = topologySignature(patchA);
function afterCommit(patch) {
  if (topologySignature(patch) !== lastSentSignature) {
    lastSentSignature = topologySignature(patch);
    calls.push({ event: "patch", nodes: patch.nodes.map((n) => n.id) });
  } else {
    calls.push({ event: "param" });
  }
}

function commitGate(options, patch) {
  const opts = options || {};
  if (opts.wireEdit) return "blocked";
  afterCommit(patch);
  return "ok";
}

if (commitGate({ wireEdit: true }, patchA) !== "blocked") fail("wireEdit should block");
if (commitGate({ topologyEdit: true }, patchB) !== "ok") fail("topologyEdit should allow");
if (!calls.some((c) => c.event === "patch" && c.nodes.includes("gain-1"))) {
  fail("topology add must send patch event including new module");
}

// Ensure add wrappers are not stubbed by installWrappers scanning BLOCKED.
for (const name of mustAllow) {
  if (new RegExp(`"${name}"\\s*,?\\s*\\n\\s*"delete`).test(src) || blocked.includes(name)) {
    fail(`${name} still looks blocked`);
  }
}

console.log("smoke_plugin_host_topology ok");
console.log("  still blocked:", mustBlock.join(", "));
console.log("  allowed add:", mustAllow.join(", "));
