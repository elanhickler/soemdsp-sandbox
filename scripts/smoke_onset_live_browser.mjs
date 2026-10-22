// Real-browser Onset smoke: loads the patch in PATCH (default runaway triggers.json), plays through the worklet, asserts the sweep draws every frame with new audio and settings repaint.
// Asserts every Reset edge restarts the sweep at Position on that sample, and the mod rail is closed with no param wires.
// Run: node scripts/smoke_onset_live_browser.mjs  (env: SYNC=1 RESET_OUT=1 SETTINGS=1 FRAMES=30 NEED_RESET=1)
// Per-frame trace of the real 1D Onset pipeline on Argi's patch.
import fs from "node:fs";
import { chromium } from "playwright-core";
const d = JSON.parse(fs.readFileSync(process.env.PATCH || new URL("./fixtures/onset_runaway_triggers.json", import.meta.url), "utf8"));
const on = d.nodes.find((n) => n.type === "onset");
if (process.env.SYNC) on.traceDisplaySettings.resetSync = true;
if (process.env.RESET_OUT) for (const c of d.connections) if (c.destinationNode === on.id && c.destinationPort === "Reset") c.sourcePort = "Out";
const body = JSON.stringify(d);
const OUT = process.env.OUT || "scripts/out/onset-live";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
page.on("console", (m) => { if (/error|fail/i.test(m.text())) console.log("console:", m.text().slice(0, 200)); });
await page.route("**/deep.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body }));
await page.goto("http://127.0.0.1:8765/?pagePatch=deep", { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction((id) => document.querySelector(`article[data-node="${id}"]`) && !document.body.classList.contains("node-boot-loading"), on.id, { timeout: 180000 });
console.log("settings", JSON.stringify(on.traceDisplaySettings));
console.log("onset wiring", JSON.stringify(d.connections.filter((c) => c.destinationNode === on.id)));
await page.evaluate((id) => {
  const L = window.__L = { raf: 0, paints: [], strips: [], gl: [] };
  const r0 = window.requestAnimationFrame;
  window.requestAnimationFrame = (f) => r0.call(window, (t) => { L.raf += 1; f(t); });
  const op = nodeGraphOnsetPaint;
  window.nodeGraphOnsetPaint = function (spec, live) {
    const o = spec.canvas._onset || {};
    const pre = { origin: o.origin, drawn: o.drawn, lp: o.lastPixel, scanned: o.scanned, parked: o.parked };
    const abs = nodeGraphScopeBufferAbsoluteFrame(live);
    const avail = nodeGraphScopeAvailableSampleCount(live);
    const st0 = L.strips.length;
    const r = op(spec, live);
    const p = spec.canvas._onset || {};
    L.paints.push({ t: performance.now() | 0, raf: L.raf, abs, avail, w: spec.canvas.width, pre, post: { origin: p.origin, drawn: p.drawn, lp: p.lastPixel, parked: p.parked, face: p.latchedSamples }, strips: L.strips.length - st0, r });
    return r;
  };
  const ds = nodeGraphOnsetDrawStrip;
  window.nodeGraphOnsetDrawStrip = function (canvas, onset, keys, slot, settings, h, w, face, sp, begin, end, clip) {
    L.strips.push({ begin, end, clip, keys: keys.length, s: Boolean(canvas._wfGlSession?.read?.fbo) });
    return ds.apply(this, arguments);
  };
  L.rs = []; const se = nodeGraphOnsetScanEdges;
  window.nodeGraphOnsetScanEdges = function (buf, from, to, planck, latch, kind, onHit) {
    if (kind !== "reset") return se.apply(this, arguments);
    let mx = 0, n = 0; if (buf) for (let f = Math.floor(from); f < Math.floor(to); f += 1) { const v = nodeGraphScopeBufferSampleAtAbsoluteFrame(buf, f); if (v != null && Math.abs(v) > mx) mx = Math.abs(v); if (v != null && Math.abs(v) > planck) n += 1; }
    const hits = []; const h = se.call(this, buf, from, to, planck, latch, kind, (f) => { hits.push(f); if (onHit) onHit(f); });
    L.rs.push({ buf: Boolean(buf), from: Math.floor(from), to: Math.floor(to), babs: buf ? nodeGraphScopeBufferAbsoluteFrame(buf) : null, mx, n, hits, h, planck });
    return h;
  };
  const wp = nodeGraphWaterfallPaint;
  L.wf = 0; L.wfOnset = 0;
  window.nodeGraphWaterfallPaint = function (spec) { if (spec?.slot?.type === "onset") L.wfOnset += 1; else L.wf += 1; return wp.apply(this, arguments); };
}, on.id);
await page.locator('button[aria-label="Play"]:visible').first().click();
const N = Number(process.env.FRAMES || 12);
for (let i = 0; i < N; i += 1) {
  await page.waitForTimeout(500);
  await page.locator(`article[data-node="${on.id}"]`).screenshot({ path: `${OUT}/${process.env.TAG || "f"}-${String(i).padStart(2, "0")}.png` });
}
if (process.env.SETTINGS) {
  {
    const bb = await page.locator(`article[data-node="${on.id}"]`).boundingBox();
    console.log("bb", JSON.stringify(bb));
    await page.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.5, { button: "right" });
  }
  await page.waitForTimeout(800);
  const pop = page.locator("#nodeTraceDisplaySettingsPopover");
  await pop.screenshot({ path: `${OUT}/${process.env.TAG}-settings.png` }).catch((e) => console.log("pop", e.message));
  const rows = await pop.evaluate((el) => [...el.querySelectorAll("[data-trace-display-control-row], label")].map((r) => r.textContent.trim().replace(/\s+/g, " ").slice(0, 30)));
  console.log("rows", JSON.stringify(rows));
  const step = async (key, n, dir) => {
    const r = await page.evaluate(([key, n, dir]) => {
      const pop = document.getElementById("nodeTraceDisplaySettingsPopover");
      const btns = [...pop.querySelectorAll(`[data-trace-display-step-target="${key}"]`)];
      const fields = pop.querySelectorAll(`[data-trace-display-field="${key}"]`).length;
      const pick = btns.find((b) => (dir > 0 ? /\+|up|inc|right|more/i : /-|down|dec|left|less/i).test(`${b.textContent} ${b.getAttribute("aria-label") || ""} ${b.dataset.traceDisplayStep || ""} ${b.className}`)) || btns[dir > 0 ? btns.length - 1 : 0];
      for (let i = 0; pick && i < n; i += 1) pick.click();
      return { buttons: btns.length, fields, picked: pick ? `${pick.textContent}|${pick.getAttribute("aria-label")}|${pick.className}` : null };
    }, [key, n, dir]);
    console.log("step", key, JSON.stringify(r));
  };
  await page.evaluate(() => { window.__L.mark = window.__L.paints.length; });
  await step("backgroundBrightness", 6, 1);
  await page.waitForTimeout(300);
  await page.locator(`article[data-node="${on.id}"]`).screenshot({ path: `${OUT}/${process.env.TAG}-bg.png` });
  await step("scale", 4, 1);
  await page.waitForTimeout(300);
  await page.locator(`article[data-node="${on.id}"]`).screenshot({ path: `${OUT}/${process.env.TAG}-scale.png` });
  const st = await page.evaluate((id) => { const n = nodeGraphPatchNode(id); const L = window.__L; const after = L.paints.slice(L.mark); return { scale: n.traceDisplaySettings?.scale, bg: n.traceDisplaySettings?.backgroundColor, pauseAtEnd: n.traceDisplaySettings?.pauseAtEnd, fullRedraws: L.strips.slice(-after.length * 2).filter((s) => s.clip == null && s.begin === 0 && s.end > 1000).length }; }, on.id);
  console.log("after settings", JSON.stringify(st)); globalThis.__st = st;
}
const L = await page.evaluate(() => window.__L);
const rail = await page.evaluate((id) => { const p = nodeGraphMvp.patch; const wired = (p.modulations || []).some((w) => w.destinationNode === id || w.sourceNode === id) || nodeGraphPatchNode(id)?.ui?.modRailAlwaysOn; return { open: document.querySelector(`article[data-node="${id}"]`).classList.contains("mod-rail-open"), wired: Boolean(wired) }; }, on.id);
fs.writeFileSync(`${OUT}/${process.env.TAG || "f"}-log.json`, JSON.stringify(L));
const p = L.paints;
let gaps = 0, back = 0, maxGap = 0;
for (let i = 1; i < p.length; i += 1) { const dt = p[i].t - p[i - 1].t; if (dt > 50) gaps += 1; maxGap = Math.max(maxGap, dt); if (p[i].abs < p[i - 1].abs) back += 1; }
const idle = p.filter((x, i) => i > 5 && x.strips === 0 && x.abs > p[i - 1].abs).length;
console.log(JSON.stringify({ idlePaintsWithNewAudio: idle, paints: p.length, wf: L.wf, wfOnset: L.wfOnset, strips: L.strips.length, gaps, maxGap, absBack: back, first: p.slice(0, 3), sample: p.filter((_, i) => i % 25 === 0).slice(0, 12) }));
await b.close();
const fail = [];
const hits = L.rs.flatMap((r) => r.hits);
if (process.env.NEED_RESET && !hits.length) fail.push("no Reset edge seen");
for (const h of hits) { const at = L.paints.find((x) => x.abs > h); if (!at || at.post.origin !== h) fail.push(`Reset at ${h} did not restart (origin ${at?.post.origin})`); }
if (rail.open !== rail.wired) fail.push(`mod rail open=${rail.open} but param wires=${rail.wired}`);
console.log("reset edges", JSON.stringify(hits));
if (idle > 0) fail.push(`idle paints with new audio: ${idle}`);
if (L.strips.length < p.length / 2) fail.push(`too few strips ${L.strips.length}/${p.length}`);
if (back > 0) fail.push(`abs went back ${back}`);
if (process.env.SETTINGS && !(globalThis.__st && globalThis.__st.fullRedraws > 0 && globalThis.__st.scale > 1)) fail.push(`scale change did not repaint ${JSON.stringify(globalThis.__st)}`);
if (fail.length) { console.error("FAIL", fail.join("; ")); process.exit(1); }
console.log("ok smoke_onset_live_browser", process.env.TAG || "");
