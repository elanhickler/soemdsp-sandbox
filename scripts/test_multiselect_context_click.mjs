#!/usr/bin/env node
// Unit test: right-click on an already-selected module keeps a multi-selection.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/node-graph-selection.js"), "utf8");

const selectedStart = src.indexOf("function nodeGraphSelectedNodeIds(");
const selectedEnd = src.indexOf("function nodeGraphSelectedNodeIdsInOrder(");
const ensureStart = src.indexOf("function ensureNodeGraphModuleSelectedForContext(");
const ensureEnd = src.indexOf("function nodeGraphFinishContextSelection(");
if (selectedStart < 0 || selectedEnd < 0 || ensureStart < 0 || ensureEnd < 0) {
  throw new Error("Could not extract selection helpers");
}

const calls = [];
const ctx = {
  console,
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Set,
  parseInt,
  parseFloat,
  nodeGraphMvp: {
    activeNodes: new Set(["a", "b", "c"]),
    selected: { type: "nodes", ids: ["a", "b"] },
  },
  setNodeGraphNodeSelection(ids) {
    calls.push(["set", [...ids]]);
    const list = [...ids];
    ctx.nodeGraphMvp.selected = list.length === 1
      ? { type: "node", id: list[0] }
      : { type: "nodes", ids: list };
  },
  setNodeGraphSelection(selection) {
    calls.push(["setSelection", selection]);
    ctx.nodeGraphMvp.selected = selection;
  },
  toggleNodeGraphNodeSelection(id, additive) {
    calls.push(["toggle", id, additive]);
  },
};
vm.createContext(ctx);
vm.runInContext(src.slice(selectedStart, selectedEnd) + src.slice(ensureStart, ensureEnd), ctx);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ensure = ctx.ensureNodeGraphModuleSelectedForContext;

calls.length = 0;
assert(ensure("b") === true, "already-selected member stays selected");
assert(calls.length === 0, `right-click on selected module must not replace selection, got ${JSON.stringify(calls)}`);
assert(ctx.nodeGraphMvp.selected.type === "nodes", "multi-selection type kept");
assert(ctx.nodeGraphMvp.selected.ids.join(",") === "a,b", "multi-selection ids kept");

calls.length = 0;
assert(ensure("c") === true, "unselected module can be selected");
assert(calls.length === 1 && calls[0][0] === "set" && calls[0][1].join(",") === "c", `unselected right-click selects only that module, got ${JSON.stringify(calls)}`);
assert(ctx.nodeGraphMvp.selected.type === "node" && ctx.nodeGraphMvp.selected.id === "c", "collapsed to the hit module");

ctx.nodeGraphMvp.selected = { type: "nodes", ids: ["a", "b"] };
calls.length = 0;
assert(ensure("c", { ctrlKey: true }) === true, "ctrl right-click toggles");
assert(calls.length === 1 && calls[0][0] === "toggle" && calls[0][1] === "c", "ctrl/cmd uses toggle, not replace");

assert(ensure("") === false, "empty id rejected");
assert(ensure("missing") === false, "inactive id rejected");

console.log("ok: multi-select right-click keeps selection");
