// Module Browser drag: the visible preview (the GL graph plate) must sit under
// the cursor with the same grab point at every zoom, and the dropped module
// must land where the preview was (within the grid snap).
// Usage: node scripts/smoke_module_drag_preview.mjs  (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const b = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof setNodeGraphZoom === "function" && typeof openNodeGraphModuleShop === "function"
  && document.querySelector("article[data-node-type]"), null, { timeout: 120000 });
await page.waitForTimeout(2500);
// Move the patch away so the drop target is empty.
await page.evaluate(() => { const p = cloneNodeGraphPatch(nodeGraphMvp.patch); for (const n of p.nodes) n.gx = (+n.gx || 0) + 400; commitNodeGraphPatch(p, { record: false }); });
await page.evaluate(() => openNodeGraphModuleShop(null, { x: 20, y: 120 }));
await page.waitForTimeout(800);
if (!(await page.$(".scene-context-store-card[data-context-module]"))) {
  await page.locator("#nodeModuleShopView").getByText("Modulator", { exact: true }).first().click();
  await page.waitForTimeout(800);
}
const ws = await page.evaluate(() => { const r = document.getElementById("nodeGraphWorkspace").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const tgt = { x: ws.x + ws.w * 0.5, y: ws.y + ws.h * 0.5 };
const grabs = [];
for (const z of [0.5, 1, 2]) {
  await page.evaluate((z) => setNodeGraphZoom(z), z);
  await page.waitForTimeout(1000);
  const card = await page.evaluate(() => { const c = document.querySelector(".scene-context-store-card[data-context-module]"); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const before = await page.evaluate(() => [...document.querySelectorAll("#nodeGraphNodes > .dsp-node")].map((e) => e.dataset.node));
  await page.mouse.move(card.x, card.y); await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) { await page.mouse.move(card.x + (tgt.x - card.x) * i / 20, card.y + (tgt.y - card.y) * i / 20); await page.waitForTimeout(16); }
  await page.waitForTimeout(300);
  const m = await page.evaluate((before) => {
    const el = [...document.querySelectorAll("#nodeGraphNodes > .dsp-node")].find((e) => !before.includes(e.dataset.node));
    if (!el) return null;
    const zz = nodeGraphGlGraphZoom();
    const wb = nodeGraphGlGraphWorldBox(el);
    const pl = (nodeGraphGlGraphState?.plates || []).find((p) => p.id === el.dataset.node);
    // Plate on screen = workspace origin + (world - camera) * zoom; compare in world, scale to px.
    return { id: el.dataset.node, zz, plate: pl && [pl.x, pl.y, pl.w, pl.h], wb: wb && [wb.x, wb.y, wb.w, wb.h], r: (() => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })() };
  }, before);
  await page.mouse.up(); await page.waitForTimeout(500);
  if (!m?.plate || !m.wb) { gate(false, `z${z}: no preview plate`); continue; }
  const dx = (m.plate[0] - m.wb[0]) * m.zz, dy = (m.plate[1] - m.wb[1]) * m.zz;
  gate(Math.abs(dx) <= 1 && Math.abs(dy) <= 1, `z${z}: preview plate on the dragged module (${dx.toFixed(1)}, ${dy.toFixed(1)} px)`);
  const grab = [(tgt.x - m.r[0]) / m.r[2], (tgt.y - m.r[1]) / m.r[3]];
  const grabPx = [tgt.x - (m.r[0] + m.r[2] / 2), (tgt.y - m.r[1]) / m.zz];
  grabs.push(grabPx);
  const d = await page.evaluate((id) => { const r = document.querySelector(`[data-node="${id}"]`).getBoundingClientRect(); return [r.left, r.top]; }, m.id);
  const snap = 16 * m.zz;
  gate(Math.abs(d[0] - m.r[0]) <= snap && Math.abs(d[1] - m.r[1]) <= snap, `z${z}: dropped within one grid cell of the preview (${(d[0] - m.r[0]).toFixed(1)}, ${(d[1] - m.r[1]).toFixed(1)} px), grab ${grab.map((v) => v.toFixed(3))}`);
  await page.evaluate((id) => { const p = cloneNodeGraphPatch(nodeGraphMvp.patch); p.nodes = p.nodes.filter((n) => n.id !== id); commitNodeGraphPatch(p, { record: false }); }, m.id);
  await page.waitForTimeout(300);
}
const spread = (k) => Math.max(...grabs.map((g) => g[k])) - Math.min(...grabs.map((g) => g[k]));
gate(grabs.length === 3 && spread(0) <= 1 && spread(1) <= 1, `grab point stable across zooms (zoom-1 px: ${JSON.stringify(grabs.map((g) => g.map((v) => +v.toFixed(1))))})`);
gate(errs.length === 0, `no page errors (${errs.length}) ${errs.slice(0, 2).join(" | ")}`);
await b.close();
process.exit(failures ? 1 : 0);