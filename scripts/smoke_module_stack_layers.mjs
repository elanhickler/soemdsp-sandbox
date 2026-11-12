// Circuit-builder module front/back: Module Settings > Layer writes node.z
// (patch.nodes order never changes), and the GL draw order, the GL hit test
// and the .dsp-node tree order all follow it. No blend in the circuit builder.
// Usage: node scripts/smoke_module_stack_layers.mjs (app on :8765 or SANDBOX_URL).
// Never saves: every non-GET request is aborted.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const browser = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 500)));
await page.route("**/*", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
await page.goto(`${BASE}?mode=circuitbuilder`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.querySelector("#nodeGraphWorkspace.gl-graph-on"), null, { timeout: 180000 });
await page.waitForTimeout(2500);
let fails = 0; const gate = (ok, m) => { console.log(`${ok ? "ok  " : "FAIL"} ${m}`); if (!ok) fails++; };
const ids = await page.evaluate(async () => {
  const out = [];
  for (const [i, t] of ["sinCos", "scope2d"].entries()) { out.push(showNodeGraphModule(t, { x: 80 + i * 500, y: 80 }, { status: "probe" })); await new Promise((r) => setTimeout(r, 300)); }
  return out;
});
const [A, B] = ids;
// Overlap B onto A (B is later in patch.nodes, so it starts in front).
await page.evaluate(([a, b]) => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const na = patch.nodes.find((n) => n.id === a);
  const nb = patch.nodes.find((n) => n.id === b);
  nb.gx = na.gx + 2; nb.gy = na.gy + 2;
  commitNodeGraphPatch(patch, { layoutEdit: true, skipValidate: true });
}, ids);
await page.waitForTimeout(1500);
const order0 = await page.evaluate(() => nodeGraphMvp.patch.nodes.map((n) => n.id));
const overlap = () => page.evaluate(([a, b]) => {
  const ra = nodeGraphNodeElement(a).getBoundingClientRect();
  const rb = nodeGraphNodeElement(b).getBoundingClientRect();
  const x0 = Math.max(ra.left, rb.left); const x1 = Math.min(ra.right, rb.right);
  const y0 = Math.max(ra.top, rb.top); const y1 = Math.min(ra.bottom, rb.bottom);
  return x1 > x0 + 20 && y1 > y0 + 20 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
}, ids);
const state = (pt) => page.evaluate(({ pt, a, b }) => {
  const world = nodeGraphClientToZoomSurfacePoint(pt.x, pt.y);
  const hit = nodeGraphGlHitTest(world.x, world.y);
  const hitId = hit ? (hit.id || hit.jack?.id || (hit.el || hit.readout)?.closest?.(".dsp-node")?.dataset?.node || "") : "";
  const plates = nodeGraphGlGraphState.plates.map((p) => p.id).filter((id) => id === a || id === b);
  const dom = [...document.querySelectorAll(".dsp-node")].map((el) => el.dataset.node).filter((id) => id === a || id === b);
  const entries = nodeGraphGlGraphState.stack.entries.map((e) => e.plate.id).filter((id) => id === a || id === b);
  const z = Object.fromEntries(nodeGraphMvp.patch.nodes.filter((n) => n.id === a || n.id === b).map((n) => [n.id, n.z]));
  return { hitId, hitKind: hit?.kind || "", plates, dom, entries, z, order: nodeGraphMvp.patch.nodes.map((n) => n.id) };
}, { pt, a: A, b: B });
const pt = await overlap();
gate(Boolean(pt), `modules overlap ${JSON.stringify(pt)}`);
let s = await state(pt);
gate(s.hitId === B && s.plates.join() === `${A},${B}` && s.dom.join() === `${A},${B}`, `untouched: patch order, B in front ${JSON.stringify(s)}`);
gate(s.z[A] === undefined && s.z[B] === undefined, "no z until the Layer row is used");
// Right-click B's title -> Module Settings with the Layer row.
const title = await page.evaluate((b) => nodeGraphNodeElement(b).querySelector(".node-header-title-row, .node-header-title").getBoundingClientRect().toJSON(), B);
const titlePt = { x: title.x + title.width / 2, y: title.y + title.height / 2 };
s = await state(titlePt);
gate(s.hitId === B && s.hitKind === "title", `B's title (over A's plate) hits B while B is in front (${s.hitKind} ${s.hitId})`);
await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2, { button: "right" });
await page.waitForTimeout(800);
const row = () => page.evaluate(() => {
  const sec = document.getElementById("nodeSceneModuleLayerSection");
  return {
    shown: Boolean(sec) && !sec.hidden && sec.getClientRects().length > 0,
    title: sec?.querySelector(".scene-context-module-section-title")?.textContent || "",
    buttons: [...(sec?.querySelectorAll("button") || [])].map((x) => `${[...x.querySelectorAll("span span")].map((p) => p.textContent).join(" ")}${x.disabled ? ":off" : ":on"}`),
    target: nodeGraphModuleActionTargetNodeId(),
    blend: Boolean(sec?.querySelector("[data-blend]")),
  };
});
let r = await row();
gate(r.shown && r.target === B && r.title === `Layer ${order0.length} of ${order0.length}`, `Layer row in Module Settings ${JSON.stringify(r)}`);
gate(r.buttons.join("|") === "To back:on|Back one:on|Forward one:off|To front:off", `labels / enabled ${r.buttons.join("|")}`);
gate(!r.blend, "no blend buttons in Module Settings");
await page.click('#nodeSceneModuleLayerSection button[data-module-restack="back"]');
await page.waitForTimeout(1200);
r = await row();
s = await state(pt);
gate(r.title === `Layer 1 of ${order0.length}` && r.target === B, `To back: ${r.title} ${r.buttons.join("|")}`);
gate(s.order.join() === order0.join(), "patch.nodes order unchanged (audio scheduler order)");
gate(s.z[B] < s.z[A], `z written ${JSON.stringify(s.z)}`);
gate(s.plates.join() === `${B},${A}` && s.entries.join() === `${B},${A}`, `GL draw order follows z ${JSON.stringify(s.plates)}`);
gate(s.dom.join() === `${B},${A}`, `.dsp-node tree order follows z ${JSON.stringify(s.dom)}`);
gate(s.hitId === A, `hit at the overlap lands on the front module (${s.hitKind} ${s.hitId})`);
s = await state(titlePt);
gate(s.hitId === A, `B's title under A's plate no longer takes the hit (${s.hitKind} ${s.hitId})`);
if (process.env.SMOKE_SHOT) await page.screenshot({ path: process.env.SMOKE_SHOT });
// Right-click at the overlap: the front module (A) opens its settings.
await page.keyboard.press("Escape");
await page.mouse.click(pt.x, pt.y, { button: "right" });
await page.waitForTimeout(800);
const rc = await page.evaluate(() => ({ module: nodeGraphModuleActionTargetNodeId(), display: nodeGraphMvp.traceDisplaySettingsTargetNode || "" }));
gate(rc.module === A || rc.display === A, `right-click at the overlap targets the front module ${JSON.stringify(rc)}`);
// Survives clone + validate (save / load / undo path).
const kept = await page.evaluate((b) => validateNodeGraphPatch(cloneNodeGraphPatch(nodeGraphMvp.patch)).nodes.find((n) => n.id === b)?.z, B);
gate(kept === 0, `z survives clone + validate (${kept})`);
// New modules land on top; a copy does not inherit z.
const C = await page.evaluate(async () => { const id = showNodeGraphModule("sinCos", { x: 900, y: 500 }, { status: "probe" }); await new Promise((res) => setTimeout(res, 500)); return id; });
const top = await page.evaluate(() => nodeGraphModuleStackNodes().at(-1)?.id);
gate(top === C, `new module lands on top (${top})`);
gate(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
process.exit(fails ? 1 : 0);
