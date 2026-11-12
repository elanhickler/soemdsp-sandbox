#!/usr/bin/env node
// RGBA Out must be last on Additive Generator and across modules.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import vm from "vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/node-graph-parameter-metadata.js"), "utf8");
const defs = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(/function nodeGraphOrderRgbaOutLast\(ports\)/.test(src), "helper must exist");
assert(/return nodeGraphOrderRgbaOutLast\(\[/.test(src), "module output ports must go through the helper");
assert(/return nodeGraphOrderRgbaOutLast\(ports\)/.test(src), "script module outputs must go through the helper");
assert(/return nodeGraphOrderRgbaOutLast\(nodeGraphModuleOutputPorts/.test(src), "patch node outputs must go through the helper");

const start = src.indexOf("function nodeGraphIsRgbaOutPort");
const end = src.indexOf("function nodeGraphModuleOutputPorts");
assert(start >= 0 && end > start, "helper block bounds");
const ctx = { console };
vm.runInNewContext(src.slice(start, end), ctx);

const ordered = ctx.nodeGraphOrderRgbaOutLast(["rgba", "Graph"]);
assert(ordered[0] === "Graph" && ordered[1] === "rgba", "rgba must move after Graph");
assert(ctx.nodeGraphOrderRgbaOutLast(["Mono", "Left", "rgba", "Right"]).pop() === "rgba", "rgba must be last among signal outs");
assert(ctx.nodeGraphOrderRgbaOutLast(["Graph"]).length === 1, "single-port lists stay unchanged");

// Additive Generator still declares rgba as a signal out and Graph as data; order is enforced in the helper.
assert(/additiveGenerator:\s*\{[\s\S]*?outputs:\s*\["rgba"\][\s\S]*?dataOutputs:\s*\["Graph"\]/.test(defs), "Additive Generator still lists rgba + Graph");

console.log("ok  RGBA Out is last on Additive Generator and generally");