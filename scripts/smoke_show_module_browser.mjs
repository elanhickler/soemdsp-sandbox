// Real-browser smoke for the performance view pins in Display Settings:
// "Show module" puts the whole module in its performance view tile, "Show in performance view" its display.
// One pin per module (node.ui.showInCanvas), node.ui.canvasWholeModule picks the tile content.
// Run: node scripts/smoke_show_module_browser.mjs   (env: SANDBOX_URL, OUT=dir, HEADED=1)
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.SANDBOX_URL || "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const OUT = process.env.OUT || "scripts/out/command-center";
fs.mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/onset_clock_reset_position.json", import.meta.url), "utf8"));
const NODE = "polyBlep-1";
const fail = [];
const b = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
await page.route("**/showmodule.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }));
await page.goto(`${BASE}?pagePatch=showmodule`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction((id) => document.querySelector(`article[data-node="${id}"]`) && !document.body.classList.contains("node-boot-loading"), NODE, { timeout: 180000 });
await page.waitForTimeout(800);

await page.evaluate((id) => {
  setNodeGraphSelection({ type: "node", id });
  openNodeGraphTraceDisplaySettings(id);
}, NODE);
await page.waitForTimeout(500);

const state = () => page.evaluate((id) => {
  const ui = nodeGraphPatchNode(id)?.ui || {};
  const saved = cloneNodeGraphPatch(nodeGraphMvp.patch).nodes.find((n) => n.id === id)?.ui || {};
  const tile = document.querySelector(`.node-layout-canvas-tile[data-node="${id}"]`);
  return {
    selection: nodeGraphLayoutCanvasSelectionIds(),
    showInCanvas: Boolean(ui.showInCanvas),
    whole: Boolean(ui.canvasWholeModule),
    savedWhole: Boolean(saved.canvasWholeModule),
    display: document.getElementById("nodeLayoutCanvasShowInCanvas")?.checked,
    module: document.getElementById("nodeLayoutCanvasShowModule")?.checked,
    moduleLabel: document.querySelector('label[for="nodeLayoutCanvasShowModule"]')?.textContent.trim(),
    tile: Boolean(tile),
    tileWhole: Boolean(tile?.querySelector(":scope > .node-whole-module-face")),
  };
}, NODE);

const perform = async (shot) => {
  await page.evaluate(() => nodeGraphLayoutCanvasOpen("perform"));
  await page.waitForTimeout(1200);
  const s = await state();
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
  await page.evaluate(() => nodeGraphLayoutCanvasClose());
  await page.waitForTimeout(500);
  await page.evaluate((id) => { setNodeGraphSelection({ type: "node", id }); openNodeGraphTraceDisplaySettings(id); }, NODE);
  await page.waitForTimeout(400);
  return s;
};

const s0 = await state();
console.log("start", JSON.stringify(s0));
if (s0.moduleLabel !== "Show module") fail.push(`label: ${s0.moduleLabel}`);
if (!s0.selection.includes(NODE)) fail.push("module not selected");

// Show module on.
await page.locator('label[for="nodeLayoutCanvasShowModule"]').click();
await page.waitForTimeout(300);
const s1 = await state();
console.log("show module", JSON.stringify(s1));
await page.locator("#nodeTraceDisplaySettingsPopover").screenshot({ path: `${OUT}/show-module.png` }).catch(() => page.screenshot({ path: `${OUT}/show-module.png` }));
if (!s1.showInCanvas || !s1.whole || !s1.savedWhole) fail.push("show module: pin / whole flag not set (or not saved)");
if (!s1.module || s1.display) fail.push("show module: checkboxes wrong");
const p1 = await perform("show-module-perform.png");
console.log("perform (module)", JSON.stringify(p1));
if (!p1.tile || !p1.tileWhole) fail.push("performance view: whole module tile missing");

// Show display instead: same pin, display face.
await page.locator('label[for="nodeLayoutCanvasShowInCanvas"]').click();
await page.waitForTimeout(300);
const s2 = await state();
console.log("show display", JSON.stringify(s2));
if (!s2.showInCanvas || s2.whole) fail.push("show display: flags wrong");
if (s2.module || !s2.display) fail.push("show display: checkboxes wrong");
const p2 = await perform();
console.log("perform (display)", JSON.stringify(p2));
if (!p2.tile || p2.tileWhole) fail.push("performance view: display tile wrong");

// Show module on, then off: removed from the performance view.
await page.locator('label[for="nodeLayoutCanvasShowModule"]').click();
await page.waitForTimeout(200);
await page.locator('label[for="nodeLayoutCanvasShowModule"]').click();
await page.waitForTimeout(300);
const s3 = await state();
console.log("show module off", JSON.stringify(s3));
if (s3.showInCanvas || s3.whole || s3.module || s3.display) fail.push("show module off: not cleared");

await b.close();
if (fail.length) {
  console.log("FAIL\n" + fail.join("\n"));
  process.exit(1);
}
console.log("show module smoke ok");
