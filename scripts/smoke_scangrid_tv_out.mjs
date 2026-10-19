// Scan Grid (rasterRgb) 📺 out smoke, on a real GPU (headed Chromium).
// In-memory patch: sine -> Scan Grid R, Scan Grid parked far from an Image Burn.
//   A. No 📺 cable: Scan Grid never exports (no picture published).
//   B. Cable rg-1 📺 -> ib-1 rgba: Image Burn reads rg-1's picture, and that
//      picture is the graded grid (grade LUT of the GPU grid, flipped to the
//      picture convention row 0 = bottom), byte for byte.
//   C. Scan Grid off screen (viewport-asleep), Image Burn on screen: the video
//      graph keeps rg-1 needed, so it still scans and exports (pull-based).
//   D. Both off screen: rg-1 stops exporting.
// Usage: node scripts/smoke_scangrid_tv_out.mjs   (server.py on :8765; SHOT=x.png: Image Burn in C)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";

function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 26, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  d.nodes.push({ gx: 1, gy: 1, id: "sw-1", type: "sineWavetable", params: { freq: 110, mode: 0, amp: 0.9 } });
  d.nodes.push({ gx: 8, gy: 1, id: "rg-1", type: "rasterRgb" });
  d.nodes.push({ gx: 400, gy: 1, id: "ib-1", type: "imageBurn" });
  d.connections.push({ sourceNode: "sw-1", sourcePort: "A", destinationNode: "rg-1", destinationPort: "R", tracePoints: [] });
  return JSON.stringify(d);
}

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
// The in-memory patch has no saved metadata (api/patches/meta 404): expected.
page.on("response", (r) => { if (r.status() >= 400 && !/api\/patches\/meta/.test(r.url())) errors.push(`${r.status()} ${r.url().slice(0, 160)}`); });
await page.route("**/sg-tv.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=sg-tv`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphRasterRgbGlExport === "function"
  && document.querySelector('article[data-node="rg-1"]') && document.querySelector('article[data-node="ib-1"]'), null, { timeout: 120000 });
await page.evaluate(() => {
  window.__sg = { exports: 0 };
  const exp = window.nodeGraphRasterRgbGlExport;
  window.nodeGraphRasterRgbGlExport = function (nodeId, ...a) {
    const ok = exp.call(this, nodeId, ...a);
    if (ok && String(nodeId) === "rg-1") window.__sg.exports += 1;
    return ok;
  };
});
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForFunction(() => nodeGraphRasterRgbCircuitRunning(), null, { timeout: 30000 });
const focus = (id) => page.evaluate((nodeId) => {
  const r0 = document.querySelector(`article[data-node="${nodeId}"]`).getBoundingClientRect();
  setNodeGraphZoom(1, { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 });
  const r = document.querySelector(`article[data-node="${nodeId}"]`).getBoundingClientRect();
  const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
  const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
  setNodeGraphPan(pan.x + (ws.left + 40 - r.left), pan.y + (ws.top + 40 - r.top));
}, id);
const windowed = (ms) => page.evaluate((t) => new Promise((done) => {
  const sg = window.__sg;
  const e0 = sg.exports;
  const p0 = nodeGraphRasterRgbBuffers.get("rg-1")?.writePos || 0;
  setTimeout(() => {
    const art = (id) => document.querySelector(`article[data-node="${id}"]`)?.classList.contains("viewport-asleep") ? "asleep" : "awake";
    done({ exports: sg.exports - e0, advanced: (nodeGraphRasterRgbBuffers.get("rg-1")?.writePos || 0) !== p0, rg: art("rg-1"), ib: art("ib-1") });
  }, t);
}), ms);
await focus("rg-1");
await page.waitForTimeout(2500);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); };

if (process.env.DEBUG) {
  await page.screenshot({ path: "scripts/out/scangrid/v2/tv-debug.png" });
  console.log(await page.evaluate(() => JSON.stringify({ dump: nodeGraphRasterRgbDebugDump(), state: nodeGraphRasterRgbBuffers.get("rg-1") ? { ...nodeGraphRasterRgbBuffers.get("rg-1"), gpu: null } : null, running: nodeGraphRasterRgbCircuitRunning(), play: document.querySelector("[data-transport-play]")?.outerHTML?.slice(0, 200) })));
}
// A. no cable
const a = await windowed(1500);
const aPic = await page.evaluate(() => Boolean(nodeGraphPictureGet("rg-1")) || nodeGraphPictureHasConsumer("rg-1"));
check("A no 📺 cable: no export", a.exports === 0 && !aPic && a.advanced, JSON.stringify({ ...a, published: aPic }));

// B. cable in
await page.evaluate(() => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  patch.connections.push({ sourceNode: "rg-1", sourcePort: "rgba", destinationNode: "ib-1", destinationPort: "rgba", tracePoints: [] });
  commitNodeGraphPatch(patch, { wireEdit: true });
});
await page.waitForTimeout(1500);
const label = await page.evaluate(() => {
  const el = document.querySelector('article[data-node="rg-1"] [data-port="rgba"], article[data-node="rg-1"] [data-output-port="rgba"]');
  const def = typeof nodeGraphModuleDefinition === "function" ? nodeGraphModuleDefinition("rasterRgb") : null;
  return { dom: el ? (el.textContent || el.getAttribute("aria-label") || el.title || "").trim() : null, def: def?.outputLabels?.rgba ?? null };
});
const b = await page.evaluate(() => {
  const state = nodeGraphRasterRgbBuffers.get("rg-1");
  const node = nodeGraphPatchNode("rg-1");
  const grade = nodeGraphRasterRgbGrade(node);
  // Export now (deterministic: the same grid), then read both back.
  const ok = nodeGraphRasterRgbGlExport("rg-1", state, grade, {});
  const grid = nodeGraphRasterRgbGlReadGrid(state);
  const pic = nodeGraphPictureGet("rg-1");
  const read = nodeGraphPictureRead("ib-1", "rgba");
  const gl = nodeGraphPictureDevice().gl;
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pic.texture, 0);
  const px = new Uint8Array(pic.width * pic.height * 4);
  gl.readPixels(0, 0, pic.width, pic.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  const lut = nodeGraphRasterRgbGradeLut(grade);
  let bad = 0;
  let lit = 0;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const g = (y * grid.width + x) * 4;
      const p = ((grid.height - 1 - y) * grid.width + x) * 4;
      if (grid.pixels[g] + grid.pixels[g + 1] + grid.pixels[g + 2] > 0) lit += 1;
      for (let k = 0; k < 3; k += 1) if (Math.abs(px[p + k] - lut[grid.pixels[g + k]]) > 1) { bad += 1; break; }
    }
  }
  return { ok, size: `${pic.width}x${pic.height}`, grid: `${grid.width}x${grid.height}`, bad, lit, hue: grade.hue, readBy: read?.nodeId || null };
});
check("B 📺 carries the graded grid", b.ok && b.size === b.grid && b.bad === 0 && b.lit > 0 && b.readBy === "rg-1" && !b.hue,
  JSON.stringify(b));
check("B output label is 📺", label.def === "📺" && (label.dom === null || !/RGBA/i.test(label.dom)), JSON.stringify(label));

// C. Scan Grid off screen, Image Burn on screen
// ib-1 is asleep (no layout box): pan by the grid distance, measured on the
// two awake nodes sw-1 (gx 1) and rg-1 (gx 8) at zoom 1.
const fc = await page.evaluate(() => {
  const a = document.querySelector('article[data-node="sw-1"]').getBoundingClientRect();
  const b = document.querySelector('article[data-node="rg-1"]').getBoundingClientRect();
  const unit = (b.left - a.left) / 7;
  const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
  setNodeGraphPan(pan.x - (400 - 8) * unit, pan.y);
  return { unit };
});
if (process.env.DEBUG) console.log("focus", JSON.stringify(fc));
await page.waitForTimeout(1500);
const c = await windowed(1500);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
check("C rg-1 asleep, sink visible: still scans + exports", c.rg === "asleep" && c.ib === "awake" && c.exports > 0 && c.advanced, JSON.stringify(c));

// D. Both off screen
await page.evaluate(() => { const p = nodeGraphMvp.pan || { x: 0, y: 0 }; setNodeGraphPan(p.x, p.y + 30000); });
await page.waitForTimeout(1500);
const d = await windowed(1500);
check("D nothing visible: no export", d.exports === 0, JSON.stringify(d));
if (process.env.DEBUG) console.log(await page.evaluate(() => JSON.stringify({ rg: nodeGraphVideoGraphShouldSleep("rg-1"), ib: nodeGraphVideoGraphShouldSleep("ib-1"), stats: nodeGraphVideoGraphStats(), visible: [...nodeGraphVisibleModuleScopeSlots()].map((s) => s.nodeId), ibEl: (() => { const e = document.querySelector('article[data-node="ib-1"]'); return { hidden: e.hidden, asleep: nodeGraphModuleIsViewportAsleep(e) }; })() })));

const glFailures = await page.evaluate(() => typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()].length : 0);
check("no display GL failures / page errors", glFailures === 0 && errors.length === 0, `${glFailures} GL failures; ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
const pass = results.every((r) => r.ok);
console.log(pass ? "ok all" : "FAIL smoke_scangrid_tv_out");
process.exit(pass ? 0 : 1);
