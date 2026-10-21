// B-101 smoke: pan out and back (slow/quick/instant) + wheel; every in-view module
// must be awake and have its GL plate and display faces. Server on :8090 or SANDBOX_URL.
// Usage: node scripts/smoke_cull_pan_return.mjs   (TRACE=1 for sleep/wake callers)
let failures = 0;
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const b = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${BASE}?pagePatch=${process.env.PATCH||"softpop"}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof setNodeGraphPan === "function" && document.querySelector("article[data-node-type]") && !document.body.classList.contains("node-boot-loading"), null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__toggles = 0;
  new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === "class" && m.target.classList?.contains("dsp-node")) { const was = (m.oldValue||"").includes("viewport-asleep"); if (was !== m.target.classList.contains("viewport-asleep")) window.__toggles++; } })
    .observe(document.getElementById("nodeGraphWorkspace").parentElement, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
  window.__audit = () => {
    const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
    const z = nodeGraphZoom(); const o = nodeGraphRenderedOriginOffset();
    const bad = []; let inView = 0;
    for (const el of document.querySelectorAll(".dsp-node:not(.removed)")) {
      if (el.hidden) continue;
      const x = parseFloat(el.style.getPropertyValue("--node-x"))||0, y = parseFloat(el.style.getPropertyValue("--node-y"))||0;
      const w = el._viewportCullW || el.offsetWidth || 0, h = el._viewportCullH || el.offsetHeight || 0;
      const sx = x*z+o.x, sy = y*z+o.y;
      const vis = sx < ws.width && sx + w*z > 0 && sy < ws.height && sy + h*z > 0;
      if (vis) { inView++; if (el.classList.contains("viewport-asleep")) bad.push(el.dataset.node); }
    }
    const disp = new Set((nodeGraphGlGraphState.displays||[]).map(d=>d.id)); const plates = new Set((nodeGraphGlGraphState.plates||[]).map(d=>d.id)); const noFace=[], noPlate=[]; for (const el of document.querySelectorAll(".dsp-node:not(.removed)")) { if (el.hidden||el.classList.contains("viewport-asleep")) continue; const r = el.getBoundingClientRect(); if (r.right<ws.left||r.left>ws.right||r.bottom<ws.top||r.top>ws.bottom) continue; if (!plates.has(el.dataset.node) && el.getAttribute("data-hide-module-frame")!=="1") noPlate.push(el.dataset.node); if ([...el.querySelectorAll(".node-display-canvas")].some(c=>c.width>1&&!c.classList.contains("node-round-shape-canvas")&&!c.closest("[hidden]")) && !disp.has(el.dataset.node)) noFace.push(el.dataset.node); } return { inView, asleepInView: bad, noFace, noPlate };
  };
  window.__pan = async (dx, dy, steps, ms) => {
    const p0 = { ...nodeGraphMvp.pan };
    nodeGraphMvp.workspacePanning = { pointerId: 1, startClientX: 0, startClientY: 0, startPanX: p0.x, startPanY: p0.y };
    markNodeGraphViewportGesture("pan");
    for (let i = 1; i <= steps; i++) { setNodeGraphPan(p0.x + dx*i/steps, p0.y + dy*i/steps, { gesture: true, persist: false }); markNodeGraphViewportGesture("pan"); await new Promise(r => setTimeout(r, ms)); }
    nodeGraphMvp.workspacePanning = null;
    flushNodeGraphViewportOnPointerUp({ persist: false });
  };
});
const wait = (ms) => page.waitForTimeout(ms);
if (process.env.TRACE) await page.evaluate(() => { window.__who = {}; const orig = nodeGraphViewportCullApply; window.nodeGraphViewportCullApply = function (el, i) { const was = el.classList.contains("viewport-asleep"); const r = orig.apply(this, arguments); if (was !== el.classList.contains("viewport-asleep")) { const k = (new Error().stack.split("\n")[2]||"").trim().replace(/\(.*\//,"(") + (was?" wake":" sleep"); __who[k] = (__who[k]||0)+1; } return r; }; });
console.log("start", await page.evaluate(() => __audit()));
for (const [label, settle] of [["slow", 600], ["quick", 30], ["instant", 0]]) {
  await page.evaluate(() => { window.__toggles = 0; });
  await page.evaluate(() => __pan(-3000, 0, 10, 16)); await wait(settle);
  await page.evaluate(() => __pan(3000, 0, 10, 16));
  await wait(50); const a50 = await page.evaluate(() => __audit());
  await wait(800); const a = await page.evaluate(() => __audit());
  if (a.asleepInView.length || a.noFace.length || a.noPlate.length) failures++;
  console.log(label, "after50", JSON.stringify(a50), "after850", JSON.stringify(a), "toggles", await page.evaluate(() => __toggles));
}
await page.evaluate(() => __pan(-200, 0, 4, 16));
await page.evaluate(() => __pan(200, 0, 4, 16)); await wait(800);
// wheel zoom out/in
await page.evaluate(() => { window.__toggles = 0; });
const ws = await page.evaluate(() => { const r = document.getElementById("nodeGraphWorkspace").getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; });
await page.mouse.move(ws.x, ws.y);
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 300); await wait(16); }
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -300); await wait(16); }
await wait(1200);
console.log("wheel", JSON.stringify(await page.evaluate(() => __audit())), "toggles", await page.evaluate(() => __toggles));
// idle: watch for thrash over 2s with no input
await page.evaluate(() => { window.__toggles = 0; }); await wait(2000);
console.log("idle toggles", await page.evaluate(() => __toggles), JSON.stringify(await page.evaluate(() => __audit())));
if (process.env.TRACE) console.log(JSON.stringify(await page.evaluate(() => __who), null, 1));
console.log("errors", errs.slice(0, 5));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok cull pan return"); process.exit(failures ? 1 : 0);



