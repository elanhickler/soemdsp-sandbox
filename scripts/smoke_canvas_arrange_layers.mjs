// Canvas Arrange layering: the layer bar sets z-order (no raise-on-click, a
// press or drag never restacks) and right-click on a tile opens that
// display's Display Settings above the Canvas stage.
// Usage: node scripts/smoke_canvas_arrange_layers.mjs (app on :8765 or SANDBOX_URL).
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
  for (const [i, t] of ["sinCos", "scope2d", "waterfall"].entries()) { out.push(showNodeGraphModule(t, { x: 60 + i * 420, y: 60 }, { status: "probe" })); await new Promise((r) => setTimeout(r, 300)); }
  return out;
});
await page.waitForTimeout(1500);
await page.evaluate((ids) => { for (const id of ids) nodeGraphLayoutCanvasSetPinned(id, true, { refresh: false }); toggleNodeGraphLayoutCanvasView(); toggleNodeGraphLayoutCanvasView(); }, ids);
await page.waitForTimeout(1500);
const tiles = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".node-layout-canvas-tile")].map((t) => [t.dataset.node, { z: t.style.zIndex, r: t.getBoundingClientRect().toJSON(), target: t.classList.contains("is-arrange-target") }])));
const bar = () => page.evaluate(() => { const b = document.getElementById("nodeLayoutCanvasArrangeBar"); return b && { shown: getComputedStyle(b).display !== "none", label: b.querySelector("span").textContent, dis: [...b.querySelectorAll("button")].map((x) => x.textContent + (x.disabled ? ":off" : ":on")) }; });
let t = await tiles();
console.log(JSON.stringify(t));
console.log(JSON.stringify(await bar()));
// Press the visible top-left corner region of the back tile (ids[0])
const r0 = t[ids[0]].r;
await page.mouse.move(r0.x + 20, r0.y + 8); await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(300);
t = await tiles(); let b = await bar();
gate(t[ids[0]].target, "pressed tile is the arrange target");
gate(t[ids[0]].z === "100", `pressing does not restack (z ${t[ids[0]].z})`);
gate(/layer 1 of 3/.test(b.label), `bar label: ${b.label} ${b.dis}`);
await page.click('#nodeLayoutCanvasArrangeBar button[data-restack="front"]');
await page.waitForTimeout(300);
t = await tiles(); b = await bar();
gate(Number(t[ids[0]].z) > Number(t[ids[1]].z) && Number(t[ids[0]].z) > Number(t[ids[2]].z), `To front: z ${JSON.stringify(Object.values(t).map((x) => x.z))}`);
gate(/layer 3 of 3/.test(b.label), `bar label after: ${b.label} ${b.dis}`);
const stored = await page.evaluate(() => nodeGraphLayoutCanvasStackOrder().map((e) => e.nodeId + ":" + e.z));
console.log(stored.join(" "));
await page.click('#nodeLayoutCanvasArrangeBar button[data-restack="backward"]');
await page.waitForTimeout(200);
b = await bar(); gate(/layer 2 of 3/.test(b.label), `Back one: ${b.label}`);
// drag keeps z
const zBefore = (await tiles())[ids[0]].z;
const r = (await tiles())[ids[0]].r;
await page.mouse.move(r.x + 20, r.y + 8); await page.mouse.down(); await page.mouse.move(r.x + 60, r.y + 40, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(300);
gate((await tiles())[ids[0]].z === zBefore, "drag keeps the stack index");
// right-click the top tile (ids[2]) center
const r2 = (await tiles())[ids[2]].r;
await page.mouse.click(r2.x + r2.width - 30, r2.y + r2.height - 30, { button: "right" });
await page.waitForTimeout(800);
const ds = await page.evaluate(() => {
  const p = document.getElementById("nodeTraceDisplaySettingsPopover");
  if (!p) return { none: true };
  const rr = p.getBoundingClientRect();
  const top = document.elementFromPoint(rr.x + rr.width / 2, rr.y + 20);
  return { hidden: p.hidden, target: nodeGraphMvp.traceDisplaySettingsTargetNode, onTop: p.contains(top), mode: nodeGraphLayoutCanvasMode(), tiles: document.querySelectorAll(".node-layout-canvas-tile").length };
});
gate(ds.hidden === false && ds.target === ids[2] && ds.onTop, `right-click opens Display Settings on top: ${JSON.stringify(ds)}`);
b = await bar(); gate(b.label.includes("of 3"), `bar follows right-clicked tile: ${b.label}`);
gate(ds.mode === "edit" && ds.tiles === 3, "still in Arrange with all tiles");
// Tweak one Display Settings field while arranging: the stage stays.
const tweak = await page.evaluate(() => {
  const p = document.getElementById("nodeTraceDisplaySettingsPopover");
  const select = [...p.querySelectorAll("select")].find((el) => !el.disabled && el.getClientRects().length && el.options.length > 1);
  if (!select) return { field: "" };
  const before = select.value;
  select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { field: select.id, before, after: select.value };
});
await page.waitForTimeout(800);
const still = await page.evaluate(() => ({ mode: nodeGraphLayoutCanvasMode(), tiles: document.querySelectorAll(".node-layout-canvas-tile").length, open: !document.getElementById("nodeTraceDisplaySettingsPopover").hidden }));
gate(Boolean(tweak.field) && still.mode === "edit" && still.tiles === 3 && still.open, `Display Settings edit keeps Arrange (${JSON.stringify(tweak)} -> ${JSON.stringify(still)})`);
// F to exit arrange -> bar hidden
await page.evaluate(() => toggleNodeGraphLayoutCanvasView());
await page.waitForTimeout(500);
b = await bar(); gate(!b.shown, "bar hidden after leaving Arrange");
gate(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
process.exit(fails ? 1 : 0);