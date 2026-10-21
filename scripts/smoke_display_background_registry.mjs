// DB smoke: every display type registers a screen background (color or
// explicit transparent), and every mounted display rect resolves.
// Also: registry color matches the face's own plate token for the scope family
// (drift check), and hidden displays have no rect.
// Usage: node scripts/smoke_display_background_registry.mjs  (server on :8090 or SANDBOX_URL)
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
// Faces that publish their plate through nodeGraphFacePlateApplyCss (the
// --node-scope-background token is authoritative only for these).
const SCOPE_FAMILY = new Set(["waterfall", "waterfallRgb", "waterfallXyz", "value", "lineBurn", "dot", "vectorDot", "lcdDot",
  "numberReadout", "scope2d", "scope2dTrace", "scope1dTrace", "hypersawBurn", "spectrumLine"]);
// Pre-existing, unrelated page error (logged in BUG_PLAN B-102).
const KNOWN_PAGE_ERRORS = [/nodeGraphPulseExplosionDensity is not defined/];
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const b = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await b.newContext({ viewport: { width: 2400, height: 1600 } })).newPage();
const errs = []; page.on("pageerror", (e) => { if (!KNOWN_PAGE_ERRORS.some((re) => re.test(e.message))) errs.push(e.message); });
const consoleErrs = []; page.on("console", (m) => { if (m.type() === "error" && /display background/.test(m.text())) consoleErrs.push(m.text()); });
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => typeof nodeGraphDisplayBackgroundFor === "function" && document.querySelector("article[data-node-type]") && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.waitForTimeout(1500);
const types = await page.evaluate(() => Object.keys(nodeGraphModuleDefinitions).filter((t) => {
  const d = nodeGraphModuleDefinitions[t];
  return nodeGraphModuleDisplayRendererForNode({ id: "x", type: t, params: {} }) || d.displayType || (d.displayModes || []).length;
}));
const unregistered = new Map(); const drift = []; let rects = 0, colored = 0, transparent = 0;
for (let i = 0; i < types.length; i += 30) {
  const batch = types.slice(i, i + 30);
  const ids = await page.evaluate((batch) => {
    const ids = {}; for (const t of batch) ids[t] = `${t}-9`;
    for (let tries = 0; tries < 40; tries++) {
      const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
      p.nodes = batch.filter((t) => ids[t]).map((t, k) => createNodeGraphPatchNode(t, { id: ids[t], gx: (k % 6) * 12, gy: Math.floor(k / 6) * 12 }));
      p.connections = []; p.modulations = []; if (p.graphConnections) p.graphConnections = [];
      try { commitNodeGraphPatch(p, { record: false }); break; } catch (e) {
        const m = String(e.message).match(/(\w+) module id must be (\w+)/);
        if (m && ids[m[1]] !== m[2]) { ids[m[1]] = m[2]; continue; }
        const bad = batch.find((t) => ids[t] && String(e.message).includes(t));
        if (bad) { ids[bad] = null; continue; }
        throw e;
      }
    }
    setNodeGraphZoom(0.5); setNodeGraphPan(20, 20);
    return ids;
  }, batch);
  await page.waitForTimeout(2000);
  const res = await page.evaluate((ids) => {
    nodeGraphModuleGeometryPublishVisible();
    if (typeof scopePaintEnsureColdPlates === "function") scopePaintEnsureColdPlates({ create: true, force: true, assumeStopped: true });
    const out = [];
    for (const [t, id] of Object.entries(ids)) {
      if (!id) continue;
      const geo = nodeGraphModuleGeometryGet(id); const node = nodeGraphPatchNode(id);
      const el = nodeGraphNodeElement(id);
      for (const d of geo?.displays || []) {
        const bg = nodeGraphDisplayBackgroundFor(node, d.key);
        // Only a plate the face itself wrote (inline), not the inherited default.
        const face = el?.querySelector(".node-module-face");
        const token = face ? face.style.getPropertyValue("--node-scope-background").trim() : "";
        out.push({ t, key: d.key, kind: bg.kind, rgba: bg.rgba ? [...bg.rgba] : null, token: token ? nodeGraphGlLinesCss(token) : null, settings: Boolean(nodeGraphModuleDisplaySettingsSchemaForNode(node)) });
      }
    }
    return out;
  }, ids);
  for (const r of res) {
    rects += 1;
    if (r.kind === "unregistered") { unregistered.set(r.key, r.t); continue; }
    if (r.kind === "transparent") { transparent += 1; continue; }
    colored += 1;
    // Drift: settings-backed scope faces publish their plate as --node-scope-background.
    if (SCOPE_FAMILY.has(r.key) && r.token && r.token[3] > 0.99) {
      const dmax = Math.max(...[0, 1, 2].map((c) => Math.abs(r.token[c] - r.rgba[c])));
      if (dmax > 3 / 255) drift.push(`${r.t}(${r.key}) reg=${r.rgba.map((c) => Math.round(c * 255))} face=${r.token.map((c) => Math.round(c * 255))}`);
    }
  }
}
gate(unregistered.size === 0, `every mounted display key is registered (${rects} rects: ${colored} color, ${transparent} transparent)${unregistered.size ? " missing: " + [...unregistered].map(([k, t]) => `${k}<-${t}`).join(", ") : ""}`);
gate(drift.length === 0, `registry color matches face plate token${drift.length ? ": " + drift.slice(0, 8).join("; ") : ""}`);
gate(consoleErrs.length === 0, `no registry console errors${consoleErrs.length ? ": " + consoleErrs.slice(0, 3).join(" | ") : ""}`);
// Explicit transparent value is first-class.
gate(await page.evaluate(() => nodeGraphDisplayBackgroundFor(null, "roundShapeFace") === NODE_GRAPH_DISPLAY_BACKGROUND_TRANSPARENT), "transparent is an explicit registered value");
// Hidden display: no rect, no square. Display Height 0 via layout.
const hidden = await page.evaluate(async () => {
  const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
  p.nodes = [createNodeGraphPatchNode("polyBlep", { id: "polyBlep-1", gx: 0, gy: 0 }), createNodeGraphPatchNode("polyBlep", { id: "polyBlep-2", gx: 14, gy: 0 }),
    createNodeGraphPatchNode("polyBlep", { id: "polyBlep-3", gx: 28, gy: 0 })];
  p.nodes[1].ui = { ...(p.nodes[1].ui || {}), displayHeightGu: 0 };
  p.nodes[2].ui = { ...(p.nodes[2].ui || {}), oscilloscopeHidden: true };
  p.connections = []; p.modulations = [];
  commitNodeGraphPatch(p, { record: false });
  await new Promise((r) => setTimeout(r, 1500));
  nodeGraphModuleGeometryPublishVisible();
  drawNodeGraphWires();
  const n = (id) => nodeGraphModuleGeometryGet(id)?.displays?.length || 0;
  const sq = (id) => (nodeGraphGlGraphState.displayBacks || []).filter((d) => d.id === id).length;
  return [n("polyBlep-1"), n("polyBlep-2") + sq("polyBlep-2"), n("polyBlep-3") + sq("polyBlep-3")];
});
gate(hidden[0] === 1, `shown display has one screen rect (${hidden[0]})`);
gate(hidden[1] === 0, `Display Height 0 has no screen rect / square (${hidden[1]})`);
gate(hidden[2] === 0, `hidden display has no screen rect / square (${hidden[2]})`);
gate(errs.length === 0, `no page errors (${errs.length}) ${errs.slice(0, 2).join(" | ")}`);
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok display background registry");
process.exit(failures ? 1 : 0);
