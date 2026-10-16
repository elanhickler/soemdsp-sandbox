// Pitch Quantizer face: keys show output pitch classes (mask + Semitone Offset),
// a key click toggles the class that lands there, no All/None toolbar, and the face
// repaints after a toggle even when the layout canvas has moved it into a tile
// outside its .dsp-node (the canvas bug: sync looked up ".dsp-node .face").
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {}; this.style = { setProperty() {} }; this.listeners = {}; this._cls = new Set(); this.textContent = ""; }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); } get className() { return [...this._cls].join(" "); }
  get classList() { const s = this._cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, on) => (on ?? !s.has(c)) ? s.add(c) : s.delete(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
  append(...k) { for (const c of k) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); } }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } blur() {} closest() { return null; }
  click() { for (const f of this.listeners.click || []) f({ preventDefault() {}, stopPropagation() {} }); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) { const m = /^(?:\.([\w-]+))?(?:\[data-([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel); if (!m) throw new Error("selector " + sel);
    const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return [...this.walk()].filter((e) => (!m[1] || e._cls.has(m[1])) && (!m[2] || (camel(m[2]) in e.dataset && (m[3] === undefined || e.dataset[camel(m[2])] === m[3])))); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const body = new El("body");
const patch = { nodes: [{ id: "pq", type: "pitchQuantizer", params: { scaleMask: 0b000010010001, semitones: 2, octave: 3 } }], connections: [] };
let commits = 0;
const ctx = { console, Math, Number, String, Boolean, Object, Array, Set, queueMicrotask: () => {}, CSS: { escape: (s) => s },
  document: { createElement: (t) => new El(t), querySelectorAll: (s) => body.querySelectorAll(s), querySelector: (s) => body.querySelector(s) },
  nodeGraphMvp: { patch, activeNodes: new Set(["pq"]) }, soemdspPerformMode: true,
  nodeGraphPatchNode: (id) => patch.nodes.find((n) => n.id === (typeof id === "string" ? id : id?.id)),
  nodeGraphFiniteNumber: (v) => (Number.isFinite(Number(v)) ? Number(v) : 0),
  cloneNodeGraphPatch: (p) => JSON.parse(JSON.stringify(p)),
  normalizeNodeGraphPatchParameter: (_t, _k, v) => v,
  commitNodeGraphPatch: (p) => { patch.nodes = p.nodes; commits++; } };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ["public/node-graph-pitch-quantizer.js", "public/modules/pitchQuantizer/pitch-quantizer-ui.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
let fail = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fail++; };
const shown = (face) => face.querySelectorAll("[data-pitch-class]").filter((b) => b._cls.has("active")).map((b) => +b.dataset.pitchClass).sort((a, b) => a - b);
// Workspace: face inside .dsp-node.
const mod = new El("div"); mod.className = "dsp-node"; mod.dataset.node = "pq"; body.append(mod);
const face = vm.runInContext('createNodeGraphPitchQuantizerFace("pq")', ctx); mod.append(face);
ok(face.querySelectorAll("[data-pitch-class]").length === 12, "12 keys");
ok(![...face.walk()].filter((e) => e.tagName === "BUTTON").some((b) => /^(All|None)$/.test(b.textContent)) && !face.querySelector(".node-pitch-quantizer-toolbar"), "no All/None buttons or toolbar");
ok(JSON.stringify(shown(face)) === "[2,6,9]", `C E G + 2 semitones shows D F# A (shown ${shown(face)})`);
// Canvas: reparent the face into a tile outside the .dsp-node, then toggle a key.
const tile = new El("div"); tile.className = "node-layout-canvas-tile"; tile.dataset.node = "pq"; body.append(tile); tile.append(face);
ok(!mod.querySelector(".node-pitch-quantizer-face"), "canvas: face lives in the tile, not the .dsp-node");
face.querySelectorAll("[data-pitch-class]").find((b) => b.dataset.pitchClass === "11").click();
ok(commits === 1 && patch.nodes[0].params.scaleMask === (0b000010010001 | (1 << 9)), `shown B toggles source A (mask ${patch.nodes[0].params.scaleMask})`);
ok(JSON.stringify(shown(face)) === "[2,6,9,11]", `canvas tile repainted after toggle (shown ${shown(face)})`);
// Semitone change repaints; Octave Offset does not move classes.
patch.nodes[0].params.semitones = -13; patch.nodes[0].params.octave = -2; vm.runInContext('syncNodeGraphPitchQuantizerFace("pq")', ctx);
ok(JSON.stringify(shown(face)) === "[3,6,8,11]", `semitones -13 (= -1 class) shows the mask down one (shown ${shown(face)})`);
console.log(fail ? `${fail} FAILED` : "pitch quantizer face smoke ok"); process.exit(fail ? 1 : 0);
