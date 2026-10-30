// Real-browser smoke for the Parameter Settings slider: one slider, the selected parameter (mirror readout on the
// module's own input). Covers a collapsed module: the slider follows the PARAMETER picker, mouse and touch drag change
// the param and the module input, a module-side write repaints the page, ctrl+click resets to default, undo flows back.
// Run: node scripts/smoke_param_sliders_browser.mjs   (env: SANDBOX_URL, OUT=dir, HEADED=1)
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.SANDBOX_URL || "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const OUT = process.env.OUT || "scripts/out/command-center";
fs.mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/onset_clock_reset_position.json", import.meta.url), "utf8"));
const NODE = "polyBlep-1";
const fail = [];
const b = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
// undoNodeGraphPatch applies two animation frames later (after the button glow).
// Wait until the history index moves, or the undo can land on a later click.
const undo = () => page.evaluate(() => new Promise((resolve) => {
  const before = nodeGraphMvp.historyIndex;
  undoNodeGraphPatch();
  const t0 = performance.now();
  const poll = () => (nodeGraphMvp.historyIndex !== before || performance.now() - t0 > 5000 ? resolve() : setTimeout(poll, 10));
  poll();
}));
page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
await page.route("**/paramsliders.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }));
await page.goto(`${BASE}?pagePatch=paramsliders`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction((id) => document.querySelector(`article[data-node="${id}"]`) && !document.body.classList.contains("node-boot-loading"), NODE, { timeout: 180000 });
await page.waitForTimeout(800);

// Collapse the module through the real action, then open Parameter Settings for it.
const setup = await page.evaluate((id) => {
  nodeGraphSelectInspectorModule(id);
  toggleNodeGraphModuleCollapsedFromContext();
  const collapsed = nodeGraphModuleIsCollapsedUi(nodeGraphPatchNode(id).type, nodeGraphPatchNode(id).ui);
  const opened = openNodeGraphMetaparametersForNode(id);
  return { collapsed, opened };
}, NODE);
await page.waitForTimeout(600);

const state = () => page.evaluate((id) => {
  const list = document.getElementById("metadataParameterSlider");
  const rows = [...(list?.querySelectorAll(".node-slider-readout") || [])];
  const article = document.querySelector(`article[data-node="${id}"]`);
  return {
    collapsed: article?.classList.contains("module-collapsed"),
    listVisible: Boolean(list && !list.hidden && list.offsetHeight > 0),
    picker: document.getElementById("metadataParameterPicker")?.value,
    rows: rows.map((r) => {
      const input = document.getElementById(r.dataset.sliderTarget);
      return {
        param: input?.dataset.param,
        label: r.querySelector(".node-slider-readout-label")?.textContent,
        text: r.querySelector(".node-slider-readout-value")?.textContent,
        shown: r.dataset.value,
        domain: Number(input?.dataset.domainValue),
        patch: Number(nodeGraphPatchNode(id).params?.[input?.dataset.param]),
        choices: r.classList.contains("choices-divided"),
        moduleRowVisible: Boolean(input?.closest(".node-parameter-row")?.offsetHeight),
      };
    }),
  };
}, NODE);

const first = await state();
console.log("setup", JSON.stringify(setup), "rows", first.rows.length, "picker", first.picker, "collapsed", first.collapsed);
if (!setup.collapsed || !first.collapsed) fail.push("module did not collapse");
if (!first.listVisible) fail.push("slider not visible");
if (first.rows.length !== 1) fail.push(`expected one slider, got ${first.rows.length}`);
if (first.rows[0]?.param !== first.picker) fail.push(`slider ${first.rows[0]?.param} != picker ${first.picker}`);
if (first.rows.some((r) => r.moduleRowVisible)) fail.push("module rows should be hidden while collapsed");
// Follows the PARAMETER picker.
await page.selectOption("#metadataParameterPicker", "frequency");
await page.waitForTimeout(400);
const s0 = await state();
console.log("picker -> frequency", JSON.stringify(s0.rows));
if (s0.rows.length !== 1 || s0.rows[0].param !== "frequency") fail.push("slider did not follow the picker");
const idx = 0;
const key = s0.rows[idx]?.param;
const row = page.locator("#metadataParameterSlider .node-slider-readout").first();
const box = await row.boundingBox();
const at = (r) => ({ x: box.x + box.width * r, y: box.y + box.height / 2 });

// 1. Mouse drag in the page -> patch + module input.
await page.mouse.move(at(0.3).x, at(0.3).y);
await page.mouse.down();
for (let i = 1; i <= 8; i += 1) await page.mouse.move(at(0.3).x + i * 15, at(0.3).y);
await page.mouse.up();
await page.waitForTimeout(300);
const s1 = (await state()).rows[idx];
console.log("mouse drag", key, JSON.stringify(s0.rows[idx]), "->", JSON.stringify(s1));
if (!(s1.patch !== s0.rows[idx].patch)) fail.push("mouse drag did not change the patch");
if (Math.abs(s1.patch - s1.domain) > 1e-9) fail.push("module input does not match patch after drag");
if (s1.text === s0.rows[idx].text) fail.push("page readout did not repaint after drag");

// 2. Module side write (module slider setter) -> page repaints live.
const target = await page.evaluate(({ id, key }) => {
  const input = document.querySelector(`article[data-node="${id}"] input[data-param="${key}"]`);
  const v = Number(input.min) + (Number(input.max) - Number(input.min)) * 0.25;
  setNodeSliderValue(input, v, { interaction: "drag" });
  commitNodeSliderDragValue(input, "parameter changed");
  return Number(input.dataset.domainValue);
}, { id: NODE, key });
await page.waitForTimeout(300);
const s2 = (await state()).rows[idx];
console.log("module write", target, JSON.stringify(s2));
if (Math.abs(Number(s2.shown) - target) > 1e-6) fail.push("page did not follow module write");

// 3. Undo flows back to the page.
await undo();
await page.waitForTimeout(500);
const s3 = (await state()).rows[idx];
console.log("undo", JSON.stringify(s3));
if (Math.abs(s3.patch - s1.patch) > 1e-6) fail.push(`undo did not restore patch (${s3.patch} vs ${s1.patch})`);
if (Math.abs(Number(s3.shown) - s3.patch) > 1e-6) fail.push("page does not show undone value");

// 4. Ctrl+click resets to default (same as module sliders).
const def = await page.evaluate(({ id, key }) => nodeSliderCtrlClickDefaultValue(document.querySelector(`article[data-node="${id}"] input[data-param="${key}"]`)), { id: NODE, key });
await page.keyboard.down("Control");
await page.mouse.click(at(0.5).x, at(0.5).y);
await page.keyboard.up("Control");
await page.waitForTimeout(300);
const s4 = (await state()).rows[idx];
console.log("ctrl+click", def, JSON.stringify(s4));
if (Math.abs(s4.patch - def) > 1e-6) fail.push(`ctrl+click did not reset (${s4.patch} vs ${def})`);

// 5. Touch drag (phone).
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
await touch("touchStart", at(0.5).x, at(0.5).y);
for (let i = 1; i <= 8; i += 1) { await touch("touchMove", at(0.5).x + i * 12, at(0.5).y); await page.waitForTimeout(16); }
await touch("touchEnd");
await page.waitForTimeout(400);
const s5 = (await state()).rows[idx];
console.log("touch drag", JSON.stringify(s5));
if (s5.patch === s4.patch) fail.push("touch drag did not change the patch");
if (Math.abs(s5.patch - s5.domain) > 1e-9) fail.push("module input does not match patch after touch drag");

await page.locator("#nodeParameterMetadataPopover").screenshot({ path: `${OUT}/single-slider.png` }).catch(async () => page.screenshot({ path: `${OUT}/single-slider.png` }));
await b.close();
if (fail.length) {
  console.log("FAIL\n" + fail.join("\n"));
  process.exit(1);
}
console.log("param slider smoke ok");
