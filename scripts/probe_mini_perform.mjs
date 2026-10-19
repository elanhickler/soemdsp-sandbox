// MP-8 probe: Mini Performance View with real keyboard/mouse on a real GPU.
// Usage: node scripts/probe_mini_perform.mjs  (server on :8090 or SANDBOX_URL). Headed by default.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error" && /mini|GL mini/i.test(m.text())) errors.push(m.text()); });
// RENDERER_FILE=path serves that gl-line-renderer.js instead (to probe around a broken WIP renderer).
const rendererOverride = process.env.RENDERER_FILE ? (await import("node:fs")).readFileSync(process.env.RENDERER_FILE, "utf8") : "";
await page.route("**/*", (r) => {
  if (r.request().method() !== "GET") return r.abort();
  if (rendererOverride && r.request().url().includes("/lib/visual/gl-line-renderer.js")) {
    return r.fulfill({ status: 200, contentType: "text/javascript", body: rendererOverride });
  }
  return r.continue();
});
async function load(path = "") {
  await page.goto(`${BASE}${path}?pagePatch=${process.env.PATCH || "softpop"}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof toggleNodeGraphMiniPerformView === "function"
    && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
}
const state = () => page.evaluate(() => {
  const v = document.getElementById("nodeMiniPerformView");
  const c = document.getElementById("nodeGlGraphMiniPerform");
  let lit = 0;
  if (c && v && !v.hidden) {
    const o = document.createElement("canvas"); o.width = 32; o.height = 32;
    const g = o.getContext("2d"); g.drawImage(c, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 40) lit += 1;
  }
  const r = v?.getBoundingClientRect();
  return {
    show: nodeGraphMiniPerformSettings().mode !== "off",
    mode: nodeGraphMiniPerformSettings().mode,
    visible: Boolean(v && !v.hidden && r.width > 10),
    rect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
    tiles: (v?._miniTiles || []).map((t) => [t.nodeId, Math.round(t.x), Math.round(t.y), Math.round(t.w), Math.round(t.h)]),
    hosts: v ? v.querySelectorAll(".node-mini-perform-module").length : 0,
    lit,
    stored: localStorage.getItem("soemdsp.miniPerform"),
    fMode: typeof nodeGraphLayoutCanvasMode === "function" ? nodeGraphLayoutCanvasMode() : "?",
  };
});
await load();
await page.evaluate(() => localStorage.removeItem("soemdsp.miniPerform"));
await load();
let s = await state();
gate(!s.show && !s.visible, "off by default");
await page.mouse.click(800, 960);
await page.keyboard.press("Shift+F");
await page.waitForTimeout(800);
s = await state();
console.log(JSON.stringify(s));
gate(s.mode === "perform" && s.visible, "Shift+F shows mini Perform");
gate(s.tiles.length >= 1, `tiles laid out (${s.tiles.length})`);
gate(s.lit >= 2 || s.hosts > 0, `mini view paints (${s.lit} lit cells, ${s.hosts} module hosts)`);
await page.screenshot({ path: process.env.SHOT || "mp_probe.png" });
// Persistence across reload.
await load();
s = await state();
gate(s.mode === "perform" && s.visible, "perform persists across reload (localStorage)");
// Click a display tile -> module selected.
await page.waitForTimeout(400);
s = await state();
if (s.tiles.length) {
  const [id, x, y, w, h] = s.tiles[0];
  await page.mouse.click(s.rect[0] + x + w / 2, s.rect[1] + y + h / 2);
  await page.waitForTimeout(500);
  const sel = await page.evaluate((nid) => Boolean(document.querySelector(`[data-node="${nid}"]`)?.classList.contains("selected")) || [...(nodeGraphMvp.selectedNodeIds || [])].map(String).includes(nid), id);
  gate(sel, `click on tile selects ${id}`);
}
// Drag stays where it is dropped (no corner snap).
const before = await state();
if (process.env.DEBUG_MP) { page.on("console", (m) => console.log("  page:", m.text())); await page.evaluate(() => { const o = beginNodeGraphMiniPerformPointer; window.beginNodeGraphMiniPerformPointer = (e) => { console.log("down", e.clientX, e.clientY, e.button, nodeGraphMiniPerformSettings().pointer); return o(e); }; const v = document.getElementById("nodeMiniPerformView"); v.addEventListener("pointermove", (e) => { if (!v._mm) { v._mm = 1; console.log("move seen"); } }); window.addEventListener("pointerup", (e) => console.log("up", e.target.id || e.target.className), true); window.addEventListener("pointerdown", (e) => console.log("cap-down", e.clientX, e.clientY, e.target.id || e.target.className, e.pointerType), true); }); console.log("before", JSON.stringify(before.rect), await page.evaluate(() => { const v = document.getElementById("nodeMiniPerformView"); const r = v.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [v.hidden, getComputedStyle(v).pointerEvents, getComputedStyle(v).zIndex, e?.id || e?.className, JSON.stringify(r)]; })); }
await page.mouse.move(before.rect[0] + before.rect[2] / 2, before.rect[1] + before.rect[3] / 2);
await page.mouse.down();
await page.mouse.move(200, 200, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
const dropped = await state();
const expectX = before.rect[0] + (200 - (before.rect[0] + before.rect[2] / 2));
gate(dropped.rect && Math.abs(dropped.rect[0] - Math.max(0, expectX)) < 12, `drag stays put (${dropped.rect} vs ${Math.round(expectX)})`);
const cursor = await page.evaluate(() => getComputedStyle(document.getElementById("nodeMiniPerformView")).cursor);
gate(cursor === "default", `cursor stays default (${cursor})`);
// Resize grip: width changes.
const g0 = await state();
const w0 = await page.evaluate(() => nodeGraphMiniPerformSettings().width);
const gx = g0.rect[0] + g0.rect[2] - 4, gy = g0.rect[1] + g0.rect[3] - 4;
await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx + 120, gy + 60, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(400);
const w1 = await page.evaluate(() => nodeGraphMiniPerformSettings().width);
gate(w1 > w0, `grip resizes width (${w0} -> ${w1})`);
// Hidden while F mode is on.
await page.mouse.click(800, 960);
await page.keyboard.press("f");
await page.waitForTimeout(800);
s = await state();
gate(s.fMode !== "off" && !s.visible, `hidden while F is open (mode ${s.fMode})`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
if ((await state()).fMode !== "off") { await page.keyboard.press("f"); await page.waitForTimeout(300); await page.keyboard.press("f"); await page.waitForTimeout(500); }
s = await state();
gate(s.fMode === "off" && s.visible, `back after F closes (mode ${s.fMode})`);
// Cull: pan far away, pinned modules stay awake.
const awake = await page.evaluate(() => (nodeGraphMiniPerformElements() || []).every((e) => typeof nodeGraphViewportCullMustStayAwake !== "function" || nodeGraphViewportCullMustStayAwake(e.nodeId)));
gate(awake, "pinned modules must stay awake while shown");
// perform.html: page disallowed.
await load("perform.html");
s = await state();
gate(!s.visible, "perform.html never shows it");
gate(errors.length === 0, `no page errors (${errors.length}) ${errors.slice(0, 3).join(" | ")}`);
await page.evaluate(() => localStorage.removeItem("soemdsp.miniPerform"));
await browser.close();
console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);