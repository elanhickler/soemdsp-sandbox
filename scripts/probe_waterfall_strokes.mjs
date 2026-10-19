// Waterfall stroke screenshots at zoom 1 with play on (jagged-edge check).
// Usage: node scripts/probe_waterfall_strokes.mjs <outPrefix> [patch] [nodeId ...]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
// patch "wf-sine": softpop's output node (stroke ink 5.5 px) fed by a sine at
// SINE_HZ (default 3), and a Ping Pong Delay (fill ink) fed by the same sine.
function sinePatch() {
  const d = JSON.parse(fs.readFileSync(new URL("../patches/livedemos/softpop.json", import.meta.url), "utf8"));
  const keep = d.nodes.filter((n) => n.id === "output" || n.id === "pingPongDelay-1");
  d.nodes = keep.map((n) => ({ ...n, gx: n.id === "output" ? 10 : 1, gy: 1 }));
  d.nodes.push({ gx: 1, gy: 20, id: "sw-1", type: "sineWavetable", params: { freq: Number(process.env.SINE_HZ || 3), mode: 0, amp: 0.8 } });
  // L and R cross: a second sine (SINE2_HZ, default 1.3x) feeds Right.
  d.nodes.push({ gx: 8, gy: 20, id: "sw-2", type: "sineWavetable", params: { freq: Number(process.env.SINE2_HZ || 1.3 * Number(process.env.SINE_HZ || 3)), mode: 0, amp: 0.8 } });
  const out = d.nodes.find((n) => n.id === "output");
  out.traceDisplaySettings = { ...(out.traceDisplaySettings || {}), strokeLeftColor: "#ff3030", strokeRightColor: "#30e0ff" };
  d.connections = [["sw-1", "Left"], ["sw-2", "Right"]].flatMap(([src, port]) => [
    { sourceNode: src, sourcePort: "A", destinationNode: "output", destinationPort: port, tracePoints: [] },
    { sourceNode: src, sourcePort: "A", destinationNode: "pingPongDelay-1", destinationPort: port, tracePoints: [] },
  ]);
  // 1D Onset (its own stroke path), fed by the first sine.
  d.nodes.push({ gx: 19, gy: 1, id: "onset-1", type: "onset", params: {}, traceDisplaySettings: { barInk: "stroke", strokeThickness: 5.5, strokeColor: "#ffd040" } });
  d.connections.push({ sourceNode: "sw-1", sourcePort: "A", destinationNode: "onset-1", destinationPort: "In", tracePoints: [] });
  d.graphConnections = []; d.modulations = [];
  return JSON.stringify(d);
}
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const [prefix = "wf", patch = "softpop", ...ids] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(process.env.DPR || 1) });
const page = await ctx.newPage();
if (process.env.BEFORE) {
  const rev = process.env.BEFORE === "1" ? "HEAD" : process.env.BEFORE;
  for (const f of ["node-graph-module-scope-waterfall.js", "node-graph-module-scope-waterfall-gl.js"]) {
    const body = execSync(`git show ${rev}:public/${f}`, { encoding: "utf8", maxBuffer: 1 << 26 });
    await page.route(`**/public/${f}*`, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body }));
  }
}
await page.route("**/wf-sine.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: sinePatch() }));
await page.goto(`${BASE}?pagePatch=${patch}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof setNodeGraphZoom === "function" && document.querySelectorAll("article[data-node-type]").length > 2, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
if (process.env.COUNT) {
  await page.evaluate((names) => {
    window.__wfCount = {};
    for (const n of names) {
      const f = window[n];
      if (typeof f !== "function") { window.__wfCount[n] = "missing"; continue; }
      window.__wfCount[n] = 0;
      window[n] = function (...a) { window.__wfCount[n] += 1; return f.apply(this, a); };
    }
  }, process.env.COUNT.split(","));
}
await page.waitForTimeout(1000);
for (const id of ids) {
  await page.evaluate(({ id, zoom }) => {
    const a = document.querySelector(`article[data-node="${id}"]`);
    let r = a.getBoundingClientRect();
    setNodeGraphZoom(Number(zoom || 1), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    r = a.getBoundingClientRect();
    const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
    setNodeGraphPan(pan.x + (innerWidth / 2 - (r.left + r.width / 2)), pan.y + (innerHeight / 2 - (r.top + r.height / 2)));
  }, { id, zoom: Number(process.env.ZOOM || 1) });
  await page.waitForTimeout(Number(process.env.WAIT || 3000));
  const b = await page.evaluate((id) => { const r = document.querySelector(`article[data-node="${id}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, id);
  await page.screenshot({ path: `${prefix}-${id}.png`, clip: b });
  const info = await page.evaluate((id) => ({ zoom: nodeGraphZoom(), dpr: devicePixelRatio, settings: typeof nodeGraphModuleScopeSettingsForNode === "function" ? null : null }), id);
  console.log(id, JSON.stringify(info), `${prefix}-${id}.png`);
}
if (process.env.COUNT) console.log("calls", JSON.stringify(await page.evaluate(() => window.__wfCount)));
await browser.close();
