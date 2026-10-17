// ES-1 smoke: engine state + face paint policy (docs/ENGINE_STATE_DISPLAY_PLAN.md).
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync("public/node-graph-module-scope-paint-gate.js", "utf8");
const ctx = { console, nodeGraphFiniteNumber: (v) => (Number.isFinite(Number(v)) ? Number(v) : 0) };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const setLive = (live) => { ctx.nodeGraphMvp = { live, visualControls: {} }; };
setLive(null);
check(ctx.scopePaintEngineState() === "stopped", "no live -> stopped");
setLive({ node: {}, speedMultiplier: 0 });
check(ctx.scopePaintEngineState() === "paused", "speed 0 -> paused");
setLive({ node: {}, speedMultiplier: 1 });
check(ctx.scopePaintEngineState() === "playing", "speed 1 -> playing");

for (const state of ["stopped", "paused", "playing"]) {
  const p = ctx.scopePaintFacePolicy("param", state);
  check(p.paint === true && p.black === false && p.freeze === false, `param paints while ${state}`);
}
const bs = ctx.scopePaintFacePolicy("buffer", "stopped");
check(bs.black === true && bs.paint === false, "buffer black when stopped");
const bp = ctx.scopePaintFacePolicy("buffer", "paused");
check(bp.freeze === true && bp.black === false, "buffer frozen when paused");
check(ctx.scopePaintFacePolicy("buffer", "playing").paint === true, "buffer paints when playing");
check(ctx.scopePaintFacePolicy("modulation", "stopped").paint === false, "modulation may wait");
check(ctx.scopePaintFacePolicy("bogus", "stopped").black === true, "unknown kind is buffer");

check(ctx.nodeGraphFacePaintKindFor("slewShapeFace") === "param", "renderer table lookup");
check(ctx.nodeGraphFacePaintKindFor("unknownRenderer") === "buffer", "default buffer");
const el = { dataset: {} };
ctx.nodeGraphDeclareFacePaintKind(el, "modulation");
check(ctx.nodeGraphFacePaintKindFor(el) === "modulation", "element declaration wins");
ctx.nodeGraphRegisterFacePaintKind("myFace", "param");
check(ctx.nodeGraphFacePaintKindFor("myFace") === "param", "register adds kind");
ctx.nodeGraphRegisterFacePaintKind("myFace2", "nope");
check(ctx.nodeGraphFacePaintKindFor("myFace2") === "buffer", "register rejects bad kind");

// ES-2: stop wipes buffer faces only; param faces keep painting.
setLive(null);
ctx.nodeGraphPatchNode = (id) => ({ t1: { type: "transport" }, s1: { type: "slewLimiter" } })[id] || null;
ctx.nodeGraphModuleDisplayRendererForSlot = (slot) => slot.renderer;
check(ctx.scopePaintShouldColdBootFace("s1") === false, "param node type not cold-booted when stopped");
check(ctx.scopePaintShouldColdBootFace("t1", { nodeId: "t1", renderer: "transportBpm", scopeElement: {} }) === false, "param renderer not cold-booted when stopped");
check(ctx.scopePaintShouldColdBootFace("x1", { nodeId: "x1", renderer: "waterfall", scopeElement: {} }) === true, "buffer face cold-booted when stopped");
ctx.nodeGraphMvp.patch = { bypassedNodes: ["s1"] };
check(ctx.scopePaintShouldColdBootFace("s1") === true, "power-off still wipes param face");
ctx.nodeGraphMvp.patch = { bypassedNodes: [] };
setLive({ node: {}, speedMultiplier: 1 });
check(ctx.scopePaintShouldColdBootFace("x1", { nodeId: "x1", renderer: "waterfall" }) === false, "playing never cold-boots");
setLive(null);
let drew = 0;
ctx.nodeGraphModuleScopeCustomRenderers = { transportBpm: (r, item, pr) => { drew += 1; }, slewShapeFace: () => {}, waterfall: (r, i, p) => { drew += 100; } };
ctx.nodeGraphVisibleModuleScopeSlots = () => [
  { nodeId: "t1", renderer: "transportBpm", scopeElement: {} },
  { nodeId: "s1", renderer: "slewShapeFace", scopeElement: {} },
  { nodeId: "x1", renderer: "waterfall", scopeElement: {} },
];
check(ctx.paintNodeGraphParamFacesNow(1) === 1 && drew === 1, "stopped: only param renderer faces painted");

// ES-2 wiring: orchestrator passes the slot and paints param faces when not live.
const orch = fs.readFileSync("public/node-graph-module-scope-draw-orchestrator.js", "utf8");
check(orch.includes("scopePaintShouldColdBootFace(nodeId, item?.slot)"), "typed item passes slot to cold-boot check");
check((orch.match(/paintNodeGraphParamFacesNow\(/g) || []).length >= 2, "both not-live branches paint param faces");

if (fails.length) {
  for (const f of fails) console.error("FAIL:", f);
  console.error(`${fails.length} failure(s)`);
  process.exit(1);
}
console.log("smoke_engine_state_policy ok");
