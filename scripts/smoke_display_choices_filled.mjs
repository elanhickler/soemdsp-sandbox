// Display Settings selects always show a value: every
// [data-trace-display-choice] select (Polarity on waterfalls included) opens
// filled with the saved/default option, never blank. Also: a non-default
// Polarity written to the patch shows when the window reopens.
// Server on :8090 or SANDBOX_URL. Uses system Chrome (playwright-core).
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const TYPES = ["resonantEnvelope", "linearEnvelope", "pluckEnvelope", "rmsMeter", "scope1dTrace", "scope2dTrace", "dotOscilloscope", "valueOscilloscope", "lineBurnOscilloscope", "spectrum1d", "spectrogram", "polyBlep", "dsfOscillator"];
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector("article[data-node]") && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.waitForTimeout(1000);
const blanks = () => page.evaluate(() => [...document.querySelectorAll("#nodeTraceDisplaySettingsPopover select[data-trace-display-choice]")]
  .filter((s) => !s.closest("[hidden]") && s.options.length && (s.selectedIndex < 0 || s.value === ""))
  .map((s) => s.dataset.traceDisplayChoice));
for (const type of TYPES) {
  const id = await page.evaluate((type) => {
    const before = new Set(nodeGraphMvp.patch.nodes.map((n) => n.id));
    beginNodeGraphModulePlacement(type, nodeGraphClientPoint({ clientX: 1250, clientY: 650 }));
    finishNodeGraphModulePlacementAtCurrentPosition();
    return null;
  }, type);
  await page.waitForTimeout(700);
  const nodeId = await page.evaluate((type) => [...nodeGraphMvp.patch.nodes].reverse().find((n) => n.type === type)?.id || "", type);
  if (!nodeId) { console.log("skip", type, "(not placed)"); continue; }
  await page.evaluate((id) => openNodeGraphTraceDisplaySettings(id, {}), nodeId);
  await page.waitForTimeout(500);
  const count = await page.evaluate(() => document.querySelectorAll("#nodeTraceDisplaySettingsPopover select[data-trace-display-choice]").length);
  const bad = await blanks();
  check(bad.length === 0, `${type}: ${count} choice selects filled`, bad.length ? JSON.stringify(bad) : "");
  if (await page.evaluate(() => Boolean(document.querySelector('#nodeTraceDisplaySettingsPopover [data-trace-display-choice="facePolarity"]')))) {
    // A chosen value shows again when the window reopens.
    const pick = page.locator('#nodeTraceDisplaySettingsPopover select[data-trace-display-choice="facePolarity"]');
    await pick.selectOption("bottomFill"); await page.waitForTimeout(300);
    await page.evaluate(() => closeNodeGraphTraceDisplaySettings()); await page.waitForTimeout(200);
    await page.evaluate((id) => openNodeGraphTraceDisplaySettings(id, {}), nodeId); await page.waitForTimeout(400);
    const v = await pick.inputValue();
    check(v === "bottomFill", `${type}: Polarity reopens as the chosen value`, v);
  }
  await page.evaluate(() => closeNodeGraphTraceDisplaySettings());
  await page.evaluate((id) => { const p = cloneNodeGraphPatch(nodeGraphMvp.patch); p.nodes = p.nodes.filter((n) => n.id !== id); commitNodeGraphPatch(p, { status: "smoke cleanup", topologyEdit: true, record: false, autosaveWorkingPatch: false }); }, nodeId);
  await page.waitForTimeout(300);
}
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok display choices filled"); process.exit(failures ? 1 : 0);