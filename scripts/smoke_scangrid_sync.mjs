// Scan Grid (rasterRgb) H Sync / V Sync smoke, on a real GPU (headed Chromium).
//   1. Edge detector (nodeGraphRasterRgbSyncHits): a hit is leaving Planck
//      silence in either sign, carried across frames; unwired = no hits.
//   2. Beam jumps (nodeGraphRasterRgbGlScan syncs): H = start of the next line
//      (stays put at column 0), V = top-left, before that sample writes; GPU
//      grid and pos/credit equal a CPU reference.
//   3. Live: Clock T (200 Hz) into V Sync of a cleared 96x54, Scan Speed 8 grid
//      restarts the frame every sampleRate/200 samples (88.2 kHz: 441 samples
//      = 3528 px = 36.75 lines), so the lines below stay black; with the cable
//      removed every line lights.
// Usage: node scripts/smoke_scangrid_sync.mjs   (server.py on :8765)
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
  d.nodes.push({ gx: 1, gy: 1, id: "sw-1", type: "sineWavetable", params: { freq: 50, mode: 0, amp: 0.9 } });
  d.nodes.push({ gx: 1, gy: 8, id: "ck-1", type: "clock", params: { rate: 200 } });
  d.nodes.push({ gx: 8, gy: 1, id: "rg-1", type: "rasterRgb", params: { width: 96, height: 54, scanSpeed: 8 } });
  d.connections.push({ sourceNode: "sw-1", sourcePort: "A", destinationNode: "rg-1", destinationPort: "R", tracePoints: [] });
  return JSON.stringify(d);
}

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.route("**/sg-sync.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=sg-sync`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphRasterRgbSyncHits === "function" && document.querySelector('article[data-node="rg-1"]'), null, { timeout: 120000 });
await page.waitForTimeout(3000);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); };

// 1. Edge detector.
const hits = await page.evaluate(() => {
  const buffers = nodeGraphModuleScopeState.buffers;
  const conns = window.nodeGraphModuleScopeConnectionsTo;
  const wired = new Set(["sync-test:H Sync"]);
  window.nodeGraphModuleScopeConnectionsTo = (id, port) => (wired.has(`${id}:${port}`) ? [{ sourceNode: "x", sourcePort: "y" }] : conns(id, port));
  const state = { syncOn: { h: false, v: false } };
  const slot = { nodeId: "sync-test" };
  try {
    buffers.set("sync-test:H Sync", new Float32Array([0, 0, 1, 1, 0, -0.5, 0, 0, 1e-8, 2e-7]));
    buffers.set("sync-test:V Sync", new Float32Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]));
    const a = nodeGraphRasterRgbSyncHits(state, slot, 10);
    // Next frame starts high (no new hit), drops, rises at 3.
    buffers.set("sync-test:H Sync", new Float32Array([0.7, 0.7, 0, 0.9]));
    const b = nodeGraphRasterRgbSyncHits(state, slot, 4);
    // Shorter ring than take: indices offset to the end of the window.
    buffers.set("sync-test:H Sync", new Float32Array([0, 1]));
    const c = nodeGraphRasterRgbSyncHits(state, slot, 6);
    return { a, b, c };
  } finally {
    buffers.delete("sync-test:H Sync");
    buffers.delete("sync-test:V Sync");
    window.nodeGraphModuleScopeConnectionsTo = conns;
  }
});
const at = (list) => list.map((h) => `${h.kind}${h.at}`).join(",");
check("edges: Planck rising edge in either sign, unwired V ignored", at(hits.a) === "h2,h5,h9", at(hits.a));
check("edges: carried across frames", at(hits.b) === "h3", at(hits.b));
check("edges: short ring aligned to the window end", at(hits.c) === "h5", at(hits.c));

// 2. Beam jumps vs a CPU reference.
const CASES = [
  { W: 10, H: 6, speed: 1, take: 200, syncs: [{ at: 3, kind: "h" }, { at: 17, kind: "h" }, { at: 20, kind: "h" }, { at: 21, kind: "h" }, { at: 100, kind: "v" }, { at: 150, kind: "h" }] },
  { W: 7.5, H: 4.25, speed: 2, take: 300, syncs: [{ at: 1, kind: "h" }, { at: 50, kind: "v" }, { at: 50, kind: "h" }, { at: 77, kind: "h" }, { at: 210, kind: "v" }] },
  { W: 12, H: 9, speed: 0.75, take: 500, syncs: [{ at: 9, kind: "h" }, { at: 99, kind: "h" }, { at: 333, kind: "v" }, { at: 334, kind: "h" }] },
];
const beam = await page.evaluate((cases) => {
  const posMod = (p, m) => { const r = p % m; return r < 0 ? r + m : r; };
  const out = [];
  for (const c of cases) {
    const width = Math.ceil(c.W);
    const height = Math.ceil(c.H);
    const data = new Float32Array(c.take);
    for (let i = 0; i < c.take; i += 1) data[i] = ((i * 37) % 255 + 1) / 255;
    const st = { width, height, logicalWidth: c.W, logicalHeight: c.H, writePos: 0, scanCredit: 0, gpu: null };
    const ok = nodeGraphRasterRgbGlScan(st, { take: c.take, channels: [data, null, null], logicalW: c.W, logicalH: c.H, speed: c.speed, syncs: c.syncs });
    const grid = nodeGraphRasterRgbGlReadGrid(st);
    nodeGraphRasterRgbGlFree(st);
    const ref = new Uint8Array(width * height);
    let pos = 0;
    let credit = 0;
    let k = 0;
    for (let i = 0; i < c.take; i += 1) {
      while (k < c.syncs.length && c.syncs[k].at === i) {
        if (c.syncs[k].kind === "v") pos = 0;
        else if (posMod(pos, c.W) > 0) pos = (Math.floor(pos / c.W) + 1) * c.W;
        k += 1;
      }
      credit += c.speed;
      const n = Math.floor(credit);
      credit -= n;
      for (let s = 0; s < n; s += 1) {
        const x = Math.min(width - 1, Math.floor(posMod(pos, c.W)));
        const y = Math.min(height - 1, Math.floor(posMod(Math.floor(pos / c.W), c.H)));
        ref[y * width + x] = Math.round(Math.min(1, Math.abs(data[i])) * 255);
        pos += 1;
      }
    }
    let bad = 0;
    for (let i = 0; i < width * height; i += 1) if (grid.pixels[i * 4] !== ref[i]) bad += 1;
    out.push({ W: c.W, H: c.H, speed: c.speed, ok, bad, cells: width * height, pos: [st.writePos, pos], credit: [st.scanCredit, credit] });
  }
  return out;
}, CASES);
for (const r of beam) {
  check(`beam W=${r.W} H=${r.H} speed=${r.speed}`, r.ok && r.bad === 0 && Math.abs(r.pos[0] - r.pos[1]) < 1e-9 && Math.abs(r.credit[0] - r.credit[1]) < 1e-9,
    `${r.bad}/${r.cells} cells differ; pos ${r.pos[0]} vs ${r.pos[1]}; credit ${r.credit[0]} vs ${r.credit[1]}`);
}

// 3. Live: Clock T -> V Sync.
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForFunction(() => nodeGraphRasterRgbCircuitRunning(), null, { timeout: 30000 });
await page.waitForTimeout(1500);
const litRows = () => page.evaluate(() => new Promise((done) => {
  clearNodeGraphRasterRgbForNode("rg-1");
  setTimeout(() => {
    const st = nodeGraphRasterRgbBuffers.get("rg-1");
    const grid = st ? nodeGraphRasterRgbGlReadGrid(st) : null;
    if (!grid) { done(null); return; }
    const rows = [];
    for (let y = 0; y < grid.height; y += 1) {
      let any = false;
      for (let x = 0; x < grid.width && !any; x += 1) any = grid.pixels[(y * grid.width + x) * 4] > 0;
      if (any) rows.push(y);
    }
    const ring = nodeGraphRasterRgbPickChannel({ nodeId: "rg-1" }, "R");
    const sr = Number(ring?.nodeGraphScopeSampleRate) || 0;
    done({ h: grid.height, lit: rows.length, last: rows.length ? rows[rows.length - 1] : -1, sr });
  }, 1200);
}));
const wire = (on) => page.evaluate((connect) => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  patch.connections = patch.connections.filter((c) => !(c.destinationNode === "rg-1" && c.destinationPort === "V Sync"));
  if (connect) patch.connections.push({ sourceNode: "ck-1", sourcePort: "T", destinationNode: "rg-1", destinationPort: "V Sync", tracePoints: [] });
  commitNodeGraphPatch(patch, { wireEdit: true });
}, on);
const free = await litRows();
await wire(true);
await page.waitForTimeout(1500);
const synced = await litRows();
if (process.env.DEBUG) console.log(await page.evaluate(() => {
  const b = nodeGraphModuleScopeState.buffers;
  const keys = [...b.keys()].filter((k) => /rg-1|ck-1/.test(k));
  const ring = nodeGraphRasterRgbPickChannel({ nodeId: "rg-1" }, "V Sync");
  let nz = 0; if (ring) for (let i = 0; i < ring.length; i += 1) if (Math.abs(ring[i]) >= 1e-7) nz += 1;
  return JSON.stringify({ keys, conns: nodeGraphModuleScopeConnectionsTo("rg-1", "V Sync"), ring: ring ? { len: ring.length, nz, rate: ring.nodeGraphScopeSampleRate, stride: ring.nodeGraphScopeSampleStride } : null, buffered: nodeGraphModuleBufferedInputs("rasterRgb") });
}));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await wire(false);
await page.waitForTimeout(1500);
const unsynced = await litRows();
check("live: free run lights every line", free && free.lit === free.h, JSON.stringify(free));
const lines = synced ? (synced.sr / 200) * 8 / 96 : 0;
const wantLast = Math.ceil(lines) - 1;
check(`live: V Sync 200 Hz restarts every ${lines.toFixed(2)} lines (line ${wantLast} is the last lit)`,
  synced && lines < 54 && synced.last === wantLast && synced.lit >= wantLast - 2, JSON.stringify(synced));
check("live: cable removed -> free run again", unsynced && unsynced.lit === unsynced.h, JSON.stringify(unsynced));
const glFailures = await page.evaluate(() => typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()].length : 0);
check("no display GL failures / page errors", glFailures === 0 && errors.length === 0, `${glFailures} GL failures; ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
const pass = results.every((r) => r.ok);
console.log(pass ? "ok all" : "FAIL smoke_scangrid_sync");
process.exit(pass ? 0 : 1);
