// Main-thread perf round 4 (ghost sliders, scope draw pass, frame-batch
// ingest, parameter metadata cache, drag parameter deltas). Behavior checks
// run the real functions in a vm with stubs; source checks pin the wiring.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let failed = 0;
const check = (ok, label) => {
  if (ok) console.log(`ok   ${label}`);
  else { failed += 1; console.log(`FAIL ${label}`); }
};

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(^|\\n)(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

// ---- 4. normalized parameter metadata cache --------------------------------
{
  const src = read("public/node-graph-node-accessors.js");
  let normalizeCalls = 0;
  const ctx = vm.createContext({
    CSS: { escape: (s) => s },
    nodeGraphModuleDefinitions: { osc: { parameters: [{ key: "freq", min: 0, max: 1 }] } },
    normalizeNodeGraphPatchParameterMetadata: (type, key, raw) => {
      normalizeCalls += 1;
      return { key, min: raw?.min ?? 0, max: raw?.max ?? 1, type };
    },
    nodeGraphParameterDefinitionMetadata: () => ({ fallback: true }),
    nodeGraphPatchNodeType: () => "osc",
  });
  vm.runInContext(src, ctx);
  const node = { id: "a", type: "osc", params: {}, paramMeta: { freq: { min: 2, max: 9 } } };
  ctx.nodeGraphMvp = { patch: { nodes: [node] } };
  ctx.nodeGraphPatchNode = (id) => ctx.nodeGraphMvp.patch.nodes.find((n) => n.id === id);
  vm.runInContext("var nodeGraphMvp = this.nodeGraphMvp; var nodeGraphPatchNode = this.nodeGraphPatchNode;", ctx);
  const first = ctx.nodeGraphReadPatchParameterMetadata(node, "freq");
  const second = ctx.nodeGraphReadPatchParameterMetadata("a", "freq");
  check(normalizeCalls === 1 && second.min === 2 && second.max === 9, "metadata: second read is served from the per-node cache");
  second.min = 123;
  check(ctx.nodeGraphReadPatchParameterMetadata(node, "freq").min === 2, "metadata: callers get a copy (mutating it does not poison the cache)");
  node.paramMeta = { ...node.paramMeta, freq: { min: 3, max: 9 } };
  check(ctx.nodeGraphReadPatchParameterMetadata(node, "freq").min === 3 && normalizeCalls === 2, "metadata: replaced paramMeta re-normalizes");
  ctx.nodeGraphMvp.patch = { nodes: [node] };
  ctx.nodeGraphReadPatchParameterMetadata(node, "freq");
  check(normalizeCalls === 3, "metadata: new patch object (commit / load / undo) clears the cache");
  ctx.nodeGraphClearParameterMetadataCache();
  ctx.nodeGraphReadPatchParameterMetadata(node, "freq");
  check(normalizeCalls === 4, "metadata: nodeGraphClearParameterMetadataCache drops entries");
  check(/function commitNodeGraphPatch\(patch, options = \{\}\) \{\s+if \(typeof nodeGraphClearParameterMetadataCache === "function"\) \{\s+nodeGraphClearParameterMetadataCache\(\);/.test(read("public/node-graph-patch-core.js")),
    "metadata: commitNodeGraphPatch clears the cache");
}

// ---- 5. drag parameter deltas ----------------------------------------------
{
  const src = read("public/node-graph-live-runtime.js");
  const fns = ["nodeGraphLiveParameterNodeSignature", "nodeGraphLiveRememberParameterNodes",
    "nodeGraphLiveDragParameterDelta", "sendNodeGraphLiveParameterUpdate"].map((n) => extractFunction(src, n)).join("\n");
  const posts = [];
  let fingerprints = 0;
  const patch = { nodes: [] };
  const params = { a: { x: 1 }, b: { y: 2 } };
  const ctx = vm.createContext({
    performance: { now: () => 1 },
    posts,
    nodeGraphMvp: {
      patch,
      sliderDragging: null,
      live: { node: { port: { postMessage: (m) => posts.push(m) } }, usesWorklet: true, activeNodeIds: new Set(), planSerial: 0, sessionId: 7, autoSmoothingSeconds: 0.01 },
    },
    nodeGraphBuildLiveParameterNodes: () => Object.keys(params).map((id) => ({ id, type: "osc", params: { ...params[id] }, paramMeta: { k: { min: 0, max: 1 } } })),
    nodeGraphPatchFingerprint: () => { fingerprints += 1; return `fp${fingerprints}`; },
    clampNodeGraphAutoSmoothingSeconds: (v) => v,
    setNodeGraphLiveEvidence: () => {},
    setNodeGraphLivePlanStatus: () => {},
    nodeGraphLiveParametersSentStatusText: (n) => `${n.length}`,
    nodeGraphLiveParameterCount: (n) => n.length,
    setNodeGraphLiveStatus: () => {},
    clearNodeGraphLiveStatusTitle: () => {},
    setNodeGraphLiveBlockedError: (k, e) => { throw e; },
  });
  vm.runInContext(fns, ctx);
  const mvp = ctx.nodeGraphMvp;
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts.length === 1 && posts[0].nodes.length === 2 && fingerprints === 1, "params: not dragging sends every node with a fresh fingerprint");
  mvp.sliderDragging = { slider: {} };
  params.a.x = 0.5;
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts.length === 2 && posts[1].nodes.length === 1 && posts[1].nodes[0].id === "a" && posts[1].nodes[0].params.x === 0.5,
    "params: drag frame posts only the changed node with its exact value");
  check(fingerprints === 1 && posts[1].patchFingerprint === "fp1", "params: drag frame reuses the last full fingerprint (no serialize)");
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts.length === 2, "params: drag frame with no change posts nothing");
  params.a.x = 0.25;
  params.b.y = 3;
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts.length === 3 && posts[2].nodes.map((n) => n.id).join() === "a,b", "params: linked writes (two nodes) both go out");
  mvp.live.paramSnapshot = null; // plan sent
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts.length === 4 && posts[3].nodes.length === 2 && fingerprints === 2, "params: after a plan the next push is full");
  mvp.sliderDragging = null;
  params.a.x = 0.75;
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts.length === 5 && posts[4].nodes.length === 2 && fingerprints === 3 && posts[4].nodes[0].params.x === 0.75,
    "params: drag end sends everything with a fresh fingerprint");
  mvp.sliderDragging = { slider: {} };
  mvp.live.sessionId = 8;
  params.a.x = 0.1;
  ctx.sendNodeGraphLiveParameterUpdate();
  check(posts[5].nodes.length === 2, "params: new audio session forces a full push");
  check(/nodeGraphMvp\.live\.paramSnapshot = null;\s*\n/.test(extractFunction(src, "sendNodeGraphLivePlan")), "params: sendNodeGraphLivePlan resets the delta snapshot");
  check(/syncFrame = window\.requestAnimationFrame\(flush\)/.test(src), "params: pushes stay coalesced to one per animation frame");
}

// ---- 3. frame-batch ingest: native ring copy, identical samples ------------
{
  const src = read("public/node-graph-module-scope-buffer-io.js");
  check(/buffer\.set\(start === 0 && count === values\.length \? values : values\.subarray\(start, start \+ count\), dest\)/.test(src),
    "ingest: Float32 chunks are copied into the ring with one native set()");
  const fn = extractFunction(src, "pushNodeGraphLiveModuleScopeSamples") + "\n" + extractFunction(src, "nodeGraphScopeRingAdvance");
  const mk = () => {
    const state = { buffers: new Map(), frames: 0, versionSerial: 0, waterfallDrawCache: new Map() };
    const ctx = vm.createContext({
      nodeGraphModuleScopeState: state,
      nodeGraphScopeRingCarriedProps: vm.runInNewContext(src.match(/const nodeGraphScopeRingCarriedProps = (\[[\s\S]*?\]);/)[1]),
      nodeGraphLiveModuleScopeFrameCapacity: () => 64,
      resizeNodeGraphLiveModuleScopeBuffer: (b, n) => new Float32Array(n),
      nodeGraphModuleScopeScalarValue: (v) => Number(v),
      nodeGraphFiniteNumber: (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d),
    });
    vm.runInContext(fn, ctx);
    return ctx;
  };
  const ctxNew = mk();
  const ref = new Float32Array(64);
  const chunks = [];
  for (let c = 0; c < 9; c += 1) {
    const chunk = new Float32Array(5 + c * 3);
    for (let i = 0; i < chunk.length; i += 1) chunk[i] = Math.sin(c * 7 + i) * 3;
    chunk[1] = NaN; chunk[2] = Infinity; chunk[3] = -Infinity; chunk[4] = -0;
    chunks.push(chunk);
  }
  chunks.push(new Float32Array(100).map((_, i) => i)); // larger than the ring
  for (const chunk of chunks) {
    ctxNew.pushNodeGraphLiveModuleScopeSamples("n:Out", chunk, null);
    const count = Math.min(64, chunk.length);
    ref.copyWithin(0, count);
    for (let i = 0; i < count; i += 1) {
      const v = Number(chunk[chunk.length - count + i]);
      ref[64 - count + i] = Number.isFinite(v) ? v : 0;
    }
  }
  const got = ctxNew.nodeGraphModuleScopeState.buffers.get("n:Out");
  let same = got.length === 64;
  for (let i = 0; i < 64 && same; i += 1) same = Object.is(got[i], ref[i]);
  check(same, "ingest: ring contents bit-identical to the per-sample path (NaN/Inf -> 0, -0 kept, oversize chunk)");
  check(got.nodeGraphScopeTotalSampleCount === chunks.reduce((s, c) => s + Math.min(64, c.length), 0), "ingest: sample counters unchanged");
  check(!fs.existsSync(path.join(root, "docs/FRAME_BATCH_FORMAT.md")) || /nodeGraphReceiveFrameBatch/.test(read("docs/FRAME_BATCH_FORMAT.md")),
    "ingest: frame-batch contract doc still present");
}

// ---- 1. ghost sliders -------------------------------------------------------
{
  const src = read("public/node-graph-ghost-sliders.js");
  check(!/for \(const slider of document\.querySelectorAll\("\.dsp-node input\[data-param\]"\)\) \{\s+if \(\s+typeof nodeGraphElementInSkippedContentVisibility/.test(src),
    "ghost: no per-frame document-wide slider scan in the sync loop");
  check(/nodeGraphGhostSliderCurrentMap\(\)/.test(extractFunction(src, "syncNodeGraphGhostSliders")), "ghost: sync walks the cached param->slider map");
  check(/nodeGraphGhostSliderIsCandidate\(map, entry\)/.test(src), "ghost: sliders no modulation targets are skipped");
  check(/last\.start === range\.start/.test(src) && /last\.sent === sentNow/.test(src), "ghost: unchanged ghost range / target skips DOM writes");
  check(/nodeGraphGhostSliderLiveMinIntervalMs = 1000 \/ 30/.test(src), "ghost: live refresh capped at ~30 Hz");
  check(/map\.patch !== patch/.test(src) && /!entry\.slider\.isConnected/.test(src), "ghost: map rebuilt on patch change or detached slider");
  const vals = read("public/node-graph-slider-values.js");
  check(/new ResizeObserver\(/.test(vals) && /nodeSliderLayoutWidthCache\.delete\(entry\.target\)/.test(vals), "ghost: lane widths cached until a ResizeObserver reports a resize");
}

// ---- 2. scope draw pass -----------------------------------------------------
{
  const scopes = read("public/node-graph-module-scopes.js");
  const slots = read("public/node-graph-module-scope-slots.js");
  check(/visibleSlotsFrameMemo = \{ slots: null \}/.test(scopes) && /visibleSlotsFrameMemo = null;/.test(scopes),
    "draw: visible slots memoized for one draw frame only");
  check(/memo\.slots\.slice\(\)/.test(slots), "draw: memo hands each caller its own array");
  const vp = read("public/node-graph-viewport-perf.js");
  check(/nodeGraphPresentedFaceMap = null;/.test(vp) && /map.frameStamp !== frameStamp/.test(vp), "draw: presented-face lookup is one map per animation frame");
  check(/nodeGraphCachedNodeElement\("\.dsp-node", nodeOrElement\)/.test(vp), "draw: viewport-asleep check uses the cached node lookup");
  const bpm = read("public/modules/transport/transport-display.js");
  check(/canvas\._nodeGraphTransportBpmDigits === digits[\s\S]{0,400}\) \{\s+return;\s+\}/.test(bpm), "draw: BPM plate redraws only when its text / lamp / size changes");
  check(/_nodeGraphTransportBpmDigits = null/.test(read("public/node-graph-module-scope-paint-helpers.js"))
    && /_nodeGraphTransportBpmDigits = null/.test(read("public/node-graph-module-scope-face-canvas.js"))
    && (read("public/node-graph-module-scope-wipe.js").match(/_nodeGraphTransportBpmDigits = null/g) || []).length >= 2,
    "draw: every BPM pixel clear (plate fill, resize, wipe, cold boot) forces a repaint");
}

// BPM plate behavior: second identical frame does not draw; wipe redraws.
{
  const src = read("public/modules/transport/transport-display.js");
  // The BPM plate paints through the shared GL batch; one Begin = one painted frame.
  let fills = 0;
  const canvas = { width: 40, height: 20 };
  const ctx = vm.createContext({
    nodeGraphGlLinesBegin: () => { fills += 1; return {}; },
    nodeGraphGlLinesEnd: () => true,
    nodeGraphGlLinesText: () => {},
    nodeGraphGlLinesDot: () => {},
    nodeGraphGlLinesMeasureText: () => 5,
    nodeGraphModuleScopeLocalFallbackCanvas: () => canvas,
    syncNodeGraphModuleScopeLocalFallbackCanvas: () => true,
    nodeGraphMvp: { patch: { nodes: [{ id: "t", params: { bpm: 120 } }] } },
    nodeGraphFiniteNumber: (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d),
    document: { querySelectorAll: () => [], fonts: { load: () => Promise.resolve([]), check: () => true, ready: Promise.resolve() } },
    window: {},
  });
  vm.runInContext(src, ctx);
  vm.runInContext("nodeGraphTransportBpmFontReady = true;", ctx);
  ctx.nodeGraphTransportBindBpmDrag = () => {};
  ctx.nodeGraphTransportSettingsForNode = () => ({ gateBlink: false });
  ctx.nodeGraphTransportFaceBpm = () => 120;
  vm.runInContext("nodeGraphTransportBindBpmDrag = this.nodeGraphTransportBindBpmDrag; nodeGraphTransportSettingsForNode = this.nodeGraphTransportSettingsForNode; nodeGraphTransportFaceBpm = this.nodeGraphTransportFaceBpm;", ctx);
  const item = { slot: { nodeId: "t" } };
  ctx.drawNodeGraphTransportBpmItem(null, item, 1);
  const afterFirst = fills;
  ctx.drawNodeGraphTransportBpmItem(null, item, 1);
  check(afterFirst > 0 && fills === afterFirst, "draw: unchanged BPM frame paints nothing");
  canvas._nodeGraphTransportBpmDigits = null; // what a wipe does
  ctx.drawNodeGraphTransportBpmItem(null, item, 1);
  check(fills > afterFirst, "draw: wiped BPM plate repaints");
  ctx.nodeGraphTransportFaceBpm = () => 121;
  vm.runInContext("nodeGraphTransportFaceBpm = this.nodeGraphTransportFaceBpm;", ctx);
  const beforeChange = fills;
  ctx.drawNodeGraphTransportBpmItem(null, item, 1);
  check(fills > beforeChange, "draw: new BPM text repaints");
}

// ---- header timing drag: preview per move, one commit at drag end ---------
{
  const hdr = read("public/node-graph-module-header-rendering.js");
  const sc = read("public/node-graph-module-scope-scene-controls.js");
  const fns = [extractFunction(hdr, "previewNodeGraphPatchTimingFromHeader"), extractFunction(hdr, "updateNodeGraphPatchTimingFromHeader"),
    extractFunction(sc, "endNodeGraphScopeNumberDrag")].join("\n");
  let commits = 0; let planSyncs = 0;
  const ctx = vm.createContext({
    nodeGraphMvp: { patch: { timing: { tempoBpm: 120, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } }, scopeNumberDragging: null },
    normalizeNodeGraphPatchTiming: (t) => ({ tempoBpm: Number(t?.tempoBpm ?? 120), timeSignatureNumerator: Number(t?.timeSignatureNumerator ?? 4), timeSignatureDenominator: Number(t?.timeSignatureDenominator ?? 4) }),
    cloneNodeGraphPatch: (p) => JSON.parse(JSON.stringify(p)),
    commitNodeGraphPatch: (p) => { commits += 1; ctx.nodeGraphMvp.patch = p; },
    scheduleNodeGraphLivePlanSync: () => { planSyncs += 1; },
  });
  vm.runInContext(fns, ctx);
  const input = { value: "120", dataset: { timingField: "tempoBpm" }, classList: { remove() {} }, closest: () => null };
  const startTiming = ctx.nodeGraphMvp.patch.timing;
  ctx.nodeGraphMvp.scopeNumberDragging = { input, pointerId: null, timingStart: startTiming };
  for (const v of ["121", "125", "131"]) { input.value = v; ctx.previewNodeGraphPatchTimingFromHeader(input); }
  check(commits === 0 && planSyncs === 3 && ctx.nodeGraphMvp.patch.timing.tempoBpm === 131,
    "timing drag: moves preview tempo + live plan sync, no full patch commit");
  ctx.endNodeGraphScopeNumberDrag({ preventDefault() {} });
  check(commits === 1 && ctx.nodeGraphMvp.patch.timing.tempoBpm === 131 && startTiming.tempoBpm === 120,
    "timing drag: drag end commits the final tempo once (history / autosave see it)");
  check(/nodeGraphMvp\.scopeNumberDragging\?\.input === input[\s\S]{0,160}previewNodeGraphPatchTimingFromHeader\(input\)/.test(sc),
    "timing drag: setNodeGraphScopeNumberInputValue previews only while that input is dragged");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
