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
// DB: background square pixel check. Pick in-view color squares, sample the
// screenshot at each square centre (a 3px inset avoids the face border).
async function squareCheck(label, forceAsleep) {
  const picks = await page.evaluate((forceAsleep) => {
    const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
    const out = [];
    for (const back of nodeGraphGlGraphState.displayBacks || []) {
      const el = document.querySelector(`.dsp-node[data-node="${back.id}"]`);
      if (!el || el.hidden) continue;
      const face = [...el.querySelectorAll(".node-module-face")].find((f) => !f.closest("[hidden]"));
      if (!face) continue;
      const r = face.getBoundingClientRect();
      if (r.width < 12 || r.height < 12 || r.left < ws.left || r.top < ws.top || r.right > ws.right || r.bottom > ws.bottom) continue;
      out.push({ id: back.id, key: back.key, x: r.left + r.width / 2, y: r.top + r.height / 2, rgba: back.rgba });
      if (out.length >= 4) break;
    }
    // Faces draw over the square; drop the picked faces from this frame so
    // the sample sees the body-pass square itself.
    const ids = new Set(out.map((p) => p.id));
    if (forceAsleep) for (const p of out) document.querySelector(`.dsp-node[data-node="${p.id}"]`).classList.add("viewport-asleep");
    window.__skipFaces = ids;
    if (!window.__presentWrapped) {
      window.__presentWrapped = true;
      const orig = nodeGraphGlGraphPresent;
      window.nodeGraphGlGraphPresent = function (...a) {
        const st = nodeGraphGlGraphState; const keep = st.displays;
        if (window.__skipFaces?.size && Array.isArray(keep)) st.displays = keep.filter((d) => !window.__skipFaces.has(d.id));
        try { return orig.apply(this, a); } finally { if (st.displays !== keep && Array.isArray(keep)) st.displays = keep; }
      };
    }
    nodeGraphGlGraphPresent();
    return out;
  }, forceAsleep);
  // Sample the composited page (1x1 screenshot, decoded in the page so no
  // image deps are needed). Faces of the picks are skipped by the wrapper.
  await page.evaluate(() => nodeGraphGlGraphPresent()); await wait(50);
  const samples = [];
  for (const p of picks) {
    const b64 = (await page.screenshot({ clip: { x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1 } })).toString("base64");
    samples.push(await page.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(1, 1); const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }, b64));
  }
  const bad = [];
  if (!picks.length) bad.push("no in-view squares");
  picks.forEach((p, i) => {
    const px = samples[i];
    const want = p.rgba.slice(0, 3).map((v) => Math.round(v * 255));
    if (px.some((v, k) => Math.abs(v - want[k]) > 24)) bad.push(`${p.id}(${p.key}) px=${px} want=${want}`);
  });
  await page.evaluate(() => { window.__skipFaces = null; nodeGraphGlGraphPresent(); });
  if (forceAsleep) await page.evaluate((ids) => { for (const id of ids) document.querySelector(`.dsp-node[data-node="${id}"]`)?.classList.remove("viewport-asleep"); nodeGraphViewportCullRefresh?.(); }, picks.map((p) => p.id));
  if (bad.length) failures++;
  console.log(bad.length ? "FAIL" : "ok  ", `square pixel ${label} (${picks.length})`, bad.join("; "));
}
await squareCheck("asleep", true);
await page.evaluate(() => __pan(-200, 0, 4, 16));
await squareCheck("mid-pan", false);
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



