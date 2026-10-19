// VG-0 (docs/VIDEO_GRAPH_PLAN.md): video graph probe. Builds the `vg-chain`
// test patch in memory, plays it, and measures per 📺 edge how many frames old
// the source picture is when the consumer reads it (hop latency), how often
// each node publishes, and the frame rate. Probe-only hooks (wrappers around
// nodeGraphPicturePublish / nodeGraphPictureRead / nodeGraphPictureExportTarget);
// no product code reads pixels.
//
// vg-chain (📺 = rgba port):
//   fbmField fbm-1 -> videoDelay vd-1 -> imageBurn ib-1         acyclic chain
//   videoFeedback vf-1 -> imageBurn ib-2                        acyclic
//   videoDelay vd-3 <-> imageBurn ib-3                          2-node loop
//   fbmField fbm-far (far off screen) -> videoDelay vd-far      asleep source
// (videoFeedback has no 📺 inlet, so the plan's fbm -> delay -> feedback ->
// burn chain is split as above and the loop is delay <-> burn.)
// Usage: node scripts/probe_video_graph.mjs   (server.py on :8765)
//   SECONDS=4  measuring window.  JSON=1  print the raw result.  SHOT=file.png  screenshot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SECONDS = Number(process.env.SECONDS || 4);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VG_CHAIN_EDGES = [
  ["fbm-1", "vd-1"], ["vd-1", "ib-1"], ["vf-1", "ib-2"], ["vd-3", "ib-3"], ["ib-3", "vd-3"], ["fbm-far", "vd-far"],
];
const LOOP = new Set(["vd-3>ib-3", "ib-3>vd-3"]);
const NODES = ["fbm-1", "vd-1", "ib-1", "vf-1", "ib-2", "vd-3", "ib-3", "fbm-far", "vd-far"];
export function vgChainPatch() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 26, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  const at = (id, type, gx, gy) => d.nodes.push({ gx, gy, id, type });
  at("fbm-1", "fbmField", 1, 1);
  at("vd-1", "videoDelay", 7, 1);
  at("ib-1", "imageBurn", 13, 1);
  at("vd-far", "videoDelay", 19, 1);
  at("vf-1", "videoFeedback", 1, 17);
  at("ib-2", "imageBurn", 7, 17);
  at("vd-3", "videoDelay", 13, 17);
  at("ib-3", "imageBurn", 19, 17);
  at("fbm-far", "fbmField", 400, 1);
  for (const [a, b] of VG_CHAIN_EDGES) {
    d.connections.push({ sourceNode: a, sourcePort: "rgba", destinationNode: b, destinationPort: "rgba", tracePoints: [] });
  }
  return JSON.stringify(d);
}

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  // Frame counter: this rAF is registered first, so it runs first every frame.
  const vg = { frame: 0, on: false, frames: [], pub: {}, pubs: {}, reads: {}, scans: 0 };
  window.__vg = vg;
  let last = 0;
  const tick = (t) => {
    vg.frame += 1;
    if (vg.on && last) vg.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await page.route("**/vg-chain.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: vgChainPatch() }));
await page.goto(`${BASE}?pagePatch=vg-chain`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphPicturePublish === "function"
  && document.querySelectorAll("article[data-node-type]").length > 5, null, { timeout: 120000 });
await page.waitForTimeout(3000);
// Hooks: publish frame per node; age of the source picture at each read.
await page.evaluate(() => {
  const vg = window.__vg;
  const mark = (nodeId) => {
    const id = String(nodeId || "");
    if (vg.on) vg.pubs[id] = (vg.pubs[id] || 0) + 1;
    vg.pub[id] = vg.frame;
  };
  const pub = window.nodeGraphPicturePublish;
  window.nodeGraphPicturePublish = function (nodeId, ...a) { mark(nodeId); return pub.call(this, nodeId, ...a); };
  const exp = window.nodeGraphPictureExportTarget;
  window.nodeGraphPictureExportTarget = function (nodeId, ...a) { mark(nodeId); return exp.call(this, nodeId, ...a); };
  const read = window.nodeGraphPictureRead;
  window.nodeGraphPictureRead = function (nodeId, port) {
    const r = read.call(this, nodeId, port);
    if (vg.on) vg.scans += 1;
    if (vg.on && r?.nodeId) {
      const key = `${r.nodeId}>${String(nodeId)}`;
      const age = Number.isFinite(vg.pub[r.nodeId]) ? vg.frame - vg.pub[r.nodeId] : -1;
      const h = vg.reads[key] || (vg.reads[key] = {});
      h[age] = (h[age] || 0) + 1;
    }
    return r;
  };
});
const play = page.locator("[data-transport-play]:visible").first();
if (await play.count()) await play.click();
await page.waitForTimeout(1500);
// Load fits the view to every node (fbm-far included); zoom 1 shows the
// cluster and leaves fbm-far ~10000 px off screen.
await page.evaluate(() => {
  const r = document.querySelector('article[data-node="fbm-1"]').getBoundingClientRect();
  setNodeGraphZoom(1, { x: r.left + r.width / 2, y: r.top + r.height });
  const f = document.querySelector('article[data-node="fbm-1"]').getBoundingClientRect();
  const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
  const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
  setNodeGraphPan(pan.x + (ws.left + 20 - f.left), pan.y + (ws.top + 20 - f.top));
});
await page.waitForTimeout(1500);
const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("article[data-node-type]")]
  .map((a) => {
    const r = a.getBoundingClientRect();
    const on = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && r.width > 0;
    return [a.dataset.node, `${a.classList.contains("viewport-asleep") ? "asleep" : "awake"}${on ? "" : "(off)"}`];
  })));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await page.evaluate(() => { const vg = window.__vg; vg.on = true; vg.frame0 = vg.frame; });
await page.waitForTimeout(SECONDS * 1000);
const res = await page.evaluate(() => {
  const vg = window.__vg; vg.on = false;
  const f = vg.frames.slice().sort((a, b) => a - b);
  const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))] || 0;
  const total = f.reduce((s, d) => s + d, 0);
  return {
    frames: vg.frame - vg.frame0, fps: f.length ? (1000 * f.length) / total : 0, p50: q(0.5), p90: q(0.9), max: f[f.length - 1] || 0,
    pubs: vg.pubs, reads: vg.reads, scans: vg.scans,
    glFailures: typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : [],
  };
});
// Phase B: pan the whole cluster off screen. Nothing visible needs a picture,
// so under the plan (decision 2) every node should stop publishing.
await page.evaluate(() => { const p = nodeGraphMvp.pan || { x: 0, y: 0 }; setNodeGraphPan(p.x - 20000, p.y); });
await page.waitForTimeout(1500);
const off = await page.evaluate((ms) => new Promise((done) => {
  const vg = window.__vg; vg.pubs = {}; vg.on = true; const f0 = vg.frame;
  setTimeout(() => { vg.on = false; done({ frames: vg.frame - f0, pubs: vg.pubs }); }, ms);
}), 2000);
await browser.close();
const r1 = (v) => Math.round(v * 10) / 10;
if (process.env.JSON) console.log(JSON.stringify({ states, ...res }, null, 1));
console.log(`vg-chain ${SECONDS}s: frames=${res.frames} fps=${r1(res.fps)} p50=${r1(res.p50)}ms p90=${r1(res.p90)}ms max=${r1(res.max)}ms pictureRead calls=${res.scans} (${r1(res.scans / Math.max(1, res.frames))}/frame, each a connection-list scan)`);
console.log("node        state        publishes/frame");
for (const id of NODES) {
  console.log(`${id.padEnd(11)} ${String(states[id] || "?").padEnd(12)} ${r1((res.pubs[id] || 0) / Math.max(1, res.frames))}`);
}
console.log("edge             reads  age histogram (frames since the source published: count)");
for (const [a, b] of VG_CHAIN_EDGES) {
  const key = `${a}>${b}`;
  const h = res.reads[key] || {};
  const n = Object.values(h).reduce((s, v) => s + v, 0);
  const ent = Object.entries(h).map(([k, v]) => [Number(k), v]).sort((x, y) => x[0] - y[0]);
  const fresh = ent.filter(([k]) => k < 3).map(([k, v]) => `${k}:${v}`);
  const stale = ent.filter(([k]) => k >= 3);
  if (stale.length) fresh.push(`${stale[0][0]}..${stale[stale.length - 1][0]}:${stale.reduce((t, [, v]) => t + v, 0)} (stale)`);
  const hist = fresh.join(" ");
  console.log(`${key.padEnd(16)} ${String(n).padStart(5)}  ${hist || "(no reads)"}${LOOP.has(key) ? "   [loop edge]" : ""}`);
}
console.log(`all off screen (${off.frames} frames): ` + NODES.map((id) => `${id}=${r1((off.pubs[id] || 0) / Math.max(1, off.frames))}`).join(" ") + " publishes/frame");
if (res.glFailures.length) console.log("display GL failures:", res.glFailures);
const errs = [...new Set(errors.filter((e) => !/favicon|Failed to load resource/.test(e)))];
if (errs.length) console.log("page errors:", errs.slice(0, 6));