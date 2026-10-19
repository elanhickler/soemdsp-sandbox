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
//   fbm-solo, rf-solo, vf-solo, vd-solo, ib-solo                no cable out
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
  ["fbm-1", "vd-1"], ["vd-1", "ib-1"], ["vf-1", "ib-2"], ["vd-3", "ib-3"], ["ib-3", "vd-3"], ["fbm-far", "vd-far"], ["vd-x", "ib-x"],
];
const LOOP = new Set(["vd-3>ib-3", "ib-3>vd-3"]);
const NODES = ["fbm-1", "vd-1", "ib-1", "vf-1", "ib-2", "vd-3", "ib-3", "fbm-far", "vd-far"];
const SOLO = ["fbm-solo", "rf-solo", "vf-solo", "vd-solo", "ib-solo", "vd-x", "ib-x"];
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
  // No cable out: VG-2 says these publish nothing.
  at("fbm-solo", "fbmField", 38, 1);
  at("rf-solo", "rgbFractal", 44, 1);
  at("vf-solo", "videoFeedback", 26, 17);
  at("vd-solo", "videoDelay", 32, 17);
  at("ib-solo", "imageBurn", 38, 17);
  // VG-6 audio handoff: a 1 Hz sine drives Video Delay X on a delay parked
  // far off screen (asleep) whose picture feeds a visible Image Burn.
  d.nodes.push({ gx: 44, gy: 17, id: "sw-1", type: "sineWavetable", params: { frequency: 1, mode: 0, amplitude: 0.7 } });
  at("vd-x", "videoDelay", 400, 17);
  at("ib-x", "imageBurn", 44, 1);
  for (const [a, b] of VG_CHAIN_EDGES) {
    d.connections.push({ sourceNode: a, sourcePort: "rgba", destinationNode: b, destinationPort: "rgba", tracePoints: [] });
  }
  d.connections.push({ sourceNode: "sw-1", sourcePort: "A", destinationNode: "vd-x", destinationPort: "X", tracePoints: [] });
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
    if (vg.on && vg.wantStack === id && !vg.stack) vg.stack = new Error("publish").stack;
    if (vg.on) vg.pubs[id] = (vg.pubs[id] || 0) + 1;
    vg.pub[id] = vg.frame;
  };
  const pub = window.nodeGraphPicturePublish;
  // Count only real copies (publish returns false when it skips).
  window.nodeGraphPicturePublish = function (nodeId, ...a) { const ok = pub.call(this, nodeId, ...a); if (ok) mark(nodeId); return ok; };
  const exp = window.nodeGraphPictureExportTarget;
  window.nodeGraphPictureExportTarget = function (nodeId, ...a) { const t = exp.call(this, nodeId, ...a); if (t) mark(nodeId); return t; };
  vg.panX = [];
  vg.ingests = [];
  vg.lastIngest = 0;
  const ingest = window.nodeGraphIngestFrameBatchNow;
  if (typeof ingest === "function") {
    window.nodeGraphIngestFrameBatchNow = function (batch) {
      const r = ingest.call(this, batch);
      if (batch?.scope) { vg.lastIngest = performance.now(); if (vg.on) vg.ingests.push(vg.lastIngest); }
      return r;
    };
  }
  const vdStep = window.nodeGraphVideoDelayGlStep;
  if (typeof vdStep === "function") {
    window.nodeGraphVideoDelayGlStep = function (host, o) {
      if (vg.on && o?.nodeId === "vd-x") vg.panX.push([performance.now(), Number(o.panX), vg.lastIngest ? performance.now() - vg.lastIngest : -1]);
      return vdStep.call(this, host, o);
    };
  }
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
if (process.env.DEBUG) {
  console.log(await page.evaluate(() => {
    const face = document.querySelector('.dsp-node[data-node="fbm-far"] .node-fbm-field-face');
    return JSON.stringify({ sleep: nodeGraphVideoGraphShouldSleep("fbm-far"), running: face?._fbmFieldRunning, raf: face?._fbmFieldRaf,
      needed: nodeGraphVideoGraphStats().needed, upstream: [...nodeGraphPictureEdges().upstream.entries()] });
  }));
}
await page.evaluate(() => { const vg = window.__vg; vg.on = true; vg.frame0 = vg.frame; vg.edges0 = typeof nodeGraphPictureEdgeStats === "function" ? nodeGraphPictureEdgeStats() : null; });
await page.waitForTimeout(SECONDS * 1000);
const res = await page.evaluate(() => {
  const vg = window.__vg; vg.on = false;
  const f = vg.frames.slice().sort((a, b) => a - b);
  const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))] || 0;
  const total = f.reduce((s, d) => s + d, 0);
  return {
    frames: vg.frame - vg.frame0, fps: f.length ? (1000 * f.length) / total : 0, p50: q(0.5), p90: q(0.9), max: f[f.length - 1] || 0,
    pubs: vg.pubs, reads: vg.reads, scans: vg.scans, panX: vg.panX, ingests: vg.ingests,
    // VG-1: rebuilds of the ?? edge table in the window (each is one walk of
    // the connection list). Before VG-1 every read was a walk: null here.
    listScans: vg.edges0 ? nodeGraphPictureEdgeStats().rebuilds - vg.edges0.rebuilds : null,
    // VG-5: publish copies vs by-reference publishes in the window.
    copies: vg.edges0 && vg.edges0.copies != null ? nodeGraphPictureEdgeStats().copies - vg.edges0.copies : null,
    refs: vg.edges0 && vg.edges0.refs != null ? nodeGraphPictureEdgeStats().refs - vg.edges0.refs : null,
    scheduler: typeof nodeGraphVideoGraphStats === "function" ? nodeGraphVideoGraphStats() : null,
    glFailures: typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : [],
  };
});
// Phase B: pan the whole cluster off screen. Nothing visible needs a picture,
// so under the plan (decision 2) every node should stop publishing.
await page.evaluate(() => { const p = nodeGraphMvp.pan || { x: 0, y: 0 }; setNodeGraphPan(p.x - 20000, p.y); });
await page.waitForTimeout(1500);
const off = await page.evaluate((ms) => new Promise((done) => {
  const vg = window.__vg; vg.pubs = {}; vg.wantStack = "vd-1"; vg.stack = ""; vg.on = true; const f0 = vg.frame;
  if (vg.wantStack) {
    const rq = window.nodeGraphVideoGraphRequestFrame;
    vg.reqStacks = [];
    window.nodeGraphVideoGraphRequestFrame = function (id, cb) {
      if (vg.on && id === "vd-1" && vg.reqStacks.length < 3) vg.reqStacks.push(new Error("request").stack);
      return rq.call(this, id, cb);
    };
  }
  const runs0 = typeof nodeGraphVideoGraphStats === "function" ? nodeGraphVideoGraphStats().runsBy : {};
  setTimeout(() => {
    vg.on = false;
    const asleep = [...document.querySelectorAll("article[data-node-type]")].filter((a) => a.classList.contains("viewport-asleep")).length;
    const runs1 = typeof nodeGraphVideoGraphStats === "function" ? nodeGraphVideoGraphStats().runsBy : {};
    const runs = Object.fromEntries(Object.keys(runs1).map((k) => [k, runs1[k] - (runs0[k] || 0)]).filter(([, v]) => v > 0));
    done({ frames: vg.frame - f0, pubs: vg.pubs, asleep, stack: vg.stack || "", runs, reqStacks: (vg.reqStacks || []).join("\n----\n") });
  }, ms);
}), 2000);
// Phase C: pan back. vd-far wakes on screen; the scheduler must wake the
// still-asleep fbm-far it reads (VG-4 wake on "newly needed").
await page.evaluate(() => { const p = nodeGraphMvp.pan || { x: 0, y: 0 }; setNodeGraphPan(p.x + 20000, p.y); });
await page.waitForTimeout(1500);
const back = await page.evaluate((ms) => new Promise((done) => {
  const vg = window.__vg; vg.pubs = {}; vg.on = true; const f0 = vg.frame;
  // Probe-only readback, 4 times across the window: the asleep source's
  // picture is not black (% of pixels lit).
  vg.lit = [];
  const sample = () => {
    const pic = nodeGraphPictureGet("fbm-far"); const gl = nodeGraphPictureDevice()?.gl;
    if (!pic?.texture || !gl) { vg.lit.push(-1); return; }
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pic.texture, 0);
    const px = new Uint8Array(pic.width * pic.height * 4);
    gl.readPixels(0, 0, pic.width, pic.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] + px[k + 1] + px[k + 2] > 24) n += 1;
    vg.lit.push(`${Math.round((100 * n) / (pic.width * pic.height))}%@${pic.width}x${pic.height}`);
  };
  const nSamples = Number(globalThis.__vgLitSamples || 4);
  for (let t = 1; t <= nSamples; t += 1) setTimeout(sample, (ms * t) / (nSamples + 1));
  setTimeout(() => {
    vg.on = false;
    const lit = vg.lit.join("/");
    const asleep = document.querySelector('article[data-node="fbm-far"]')?.classList.contains("viewport-asleep");
    const sizes = Object.fromEntries(["fbm-1", "fbm-far", "vd-1", "vd-x", "ib-3"].map((id) => {
      const pic = nodeGraphPictureGet(id);
      return [id, pic ? `${pic.width}x${pic.height}` : "-"];
    }));
    done({ frames: vg.frame - f0, pubs: vg.pubs, lit, asleep, sizes });
  }, ms);
}), 1000);
// Edge table follows patch edits: drop vd-1 -> ib-1 through the normal commit.
const rewire = await page.evaluate(() => {
  const before = Boolean(nodeGraphPictureRead("ib-1", "rgba")) && nodeGraphPictureHasConsumer("vd-1");
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  patch.connections = patch.connections.filter((c) => !(c.sourceNode === "vd-1" && c.destinationNode === "ib-1"));
  commitNodeGraphPatch(patch, { wireEdit: true });
  return { before, after: !nodeGraphPictureRead("ib-1", "rgba") && !nodeGraphPictureHasConsumer("vd-1"), other: Boolean(nodeGraphPictureRead("vd-1", "rgba")) };
});
await browser.close();
const r1 = (v) => Math.round(v * 10) / 10;
if (process.env.JSON) console.log(JSON.stringify({ states, ...res }, null, 1));
console.log(`vg-chain ${SECONDS}s: frames=${res.frames} fps=${r1(res.fps)} p50=${r1(res.p50)}ms p90=${r1(res.p90)}ms max=${r1(res.max)}ms pictureRead calls=${res.scans} (${r1(res.scans / Math.max(1, res.frames))}/frame)`);
const scans = res.listScans == null ? res.scans : res.listScans;
console.log(`connection-list scans: ${scans} (${r1(scans / Math.max(1, res.frames))}/frame)${res.listScans == null ? " [no edge table: every read scans]" : " [edge table rebuilds]"}`);
if (res.copies != null) console.log(`publish: ${r1(res.copies / Math.max(1, res.frames))} copies/frame, ${r1(res.refs / Math.max(1, res.frames))} by reference/frame`);
console.log(res.scheduler
  ? `video graph scheduler: order ${res.scheduler.order.filter((id) => [...NODES, ...SOLO].includes(id)).join(" ")}; back edges ${res.scheduler.backEdges}`
  : "video graph scheduler: none (per-module rAF loops)");
console.log("node        state        publish copies/frame");
for (const id of [...NODES, ...SOLO]) {
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
if (process.env.STACK) console.log(off.stack, off.reqStacks);
console.log(`all off screen: scheduler passes ${Object.keys(off.runs).length ? JSON.stringify(off.runs) : "0 on every node"}`);
console.log(`all off screen (${off.frames} frames, ${off.asleep} modules asleep): ` + NODES.map((id) => `${id}=${r1((off.pubs[id] || 0) / Math.max(1, off.frames))}`).join(" ") + " publishes/frame");
if (back.frames < 30) console.log("WARN: rAF stalled in the pan-back window (browser window hidden?); rerun");
console.log(`panned back (${back.frames} frames): fbm-far ${back.asleep ? "asleep" : "awake"} publishes ${r1((back.pubs["fbm-far"] || 0) / Math.max(1, back.frames))}/frame, vd-far ${r1((back.pubs["vd-far"] || 0) / Math.max(1, back.frames))}/frame; fbm-far picture ${back.lit} lit`);
console.log(`picture sizes (awake vs asleep sources): ${Object.entries(back.sizes).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`rewire (drop vd-1 -> ib-1): ${rewire.before && rewire.after && rewire.other ? "ok" : "FAIL " + JSON.stringify(rewire)}`);
{
  // VG-6: X seen by the asleep vd-x (1 Hz sine, amplitude 0.7 -> panX +-0.385).
  const v = res.panX.map((p) => p[1]);
  const lo = Math.min(...v); const hi = Math.max(...v);
  let changes = 0; for (let i = 1; i < v.length; i += 1) if (v[i] !== v[i - 1]) changes += 1;
  const ages = res.panX.map((p) => p[2]).filter((a) => a >= 0).sort((a, b) => a - b);
  const gaps = res.ingests.slice(1).map((t, i) => t - res.ingests[i]).sort((a, b) => a - b);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : -1);
  console.log(`audio ingest: ${res.ingests.length} scope batches, interval p50 ${r1(med(gaps))} ms; ring age at the vd-x step p50 ${r1(med(ages))} ms, max ${r1(ages[ages.length - 1] ?? -1)} ms (plus the worklet block and output latency)`);
  console.log(`audio X -> asleep vd-x: ${v.length} steps, panX ${v.length ? `${r1(lo * 100) / 100}..${r1(hi * 100) / 100}` : "-"}, value changed on ${changes} steps`);
}
if (res.glFailures.length) console.log("display GL failures:", res.glFailures);
const errs = [...new Set(errors.filter((e) => !/favicon|Failed to load resource/.test(e)))];
if (errs.length) console.log("page errors:", errs.slice(0, 6));