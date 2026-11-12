#!/usr/bin/env node
// Paused spawn: buffer faces (Spectrogram and others) must show a blank plate
// without starting audio, and hidden / height-0 faces must stay hidden.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = fs.readFileSync(path.join(root, "public/node-graph-module-scope-paint-gate.js"), "utf8");
const gl = fs.readFileSync(path.join(root, "public/node-graph-gl-graph.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  /nodeGraphModuleDisplayVisibleForUi\(host\.type, host\.ui\)/.test(gate),
  "cold plate must skip hidden or zero-height displays",
);

assert(
  /nodeGraphDisplayCanvasSizeCss\(canvas, cssW, cssH\)/.test(gate),
  "cold plate must size an unsized face box from its CSS box",
);

assert(
  /nodeGraphModuleScopeCustomRenderers\[displayType\]/.test(gate)
  && /nodeGraphGlGraphRebuildPlates\(\)/.test(gate),
  "cold plate must paint the face drawer and rebuild the GL graph so the plate is visible",
);

assert(
  /No live ink yet \(dragged in while paused\)/.test(gl)
  && /nodeGraphGlLinesRect\(pics, rect\.x, rect\.y, rect\.w, rect\.h, \[0, 0, 0, 1\]\)/.test(gl),
  "GL graph must draw a black rectangle when a visible face has no texture yet",
);

assert(
  /nodeGraphDisplayCanvasSizeCss\(face, laid\.w, laid\.h\)/.test(gl),
  "GL graph must size an unsized face from its layout box",
);

console.log("ok  paused display: blank plate while paused, hidden faces stay hidden");