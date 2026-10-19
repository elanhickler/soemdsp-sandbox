// Scan Grid (rasterRgb) GPU beam smoke, on a real GPU (headed Chromium).
// 1. Beam writes: nodeGraphRasterRgbGlScan into a fresh grid, fed in several
//    batches, must match a CPU reference of the raster timing byte for byte.
//    Line D = Width / speed samples, column D / Width, frame F = Height x D;
//    every line restarts at column 0 and writes all ceil(Width) columns, every
//    frame restarts at row 0 and writes all ceil(Height) rows. Cell (r, c) is
//    stamped by sample ceil(exit - 1e-3) - 1, exit = min(lineStart +
//    min(c + 1, Width) x D / Width, frameEnd). Colour round(clamp(|v|) x 255).
//    The reference walks absolute time in doubles, so batching cannot matter.
//    Whole sizes must also equal the old Scan Speed loop (credit += speed per
//    sample): saved patches keep their look. Last column: on fractional Width
//    every row's last column must hold its line-end sample (no stale cells).
// Line Rate (Hz): beam speed = Width x Line Rate / sampleRate px/sample.
//   - formula: nodeGraphRasterRgbBeamSpeed for whole / fractional Width and
//     44.1 / 48 / 88.2 kHz (one line = sampleRate / Line Rate samples).
//   - stability (GPU, synthetic): a 60 Hz sine / cosine at Line Rate 60, fed
//     in a jittery 1470 / 1471 / 2940 cadence, must leave the grid unchanged
//     frame after frame once it has filled (whole and fractional Width).
//   - stability (live): SinCos 60 Hz -> R / G of a 96 x 54 Line Rate 60 grid,
//     sampled every 100 ms for 3 s: frame-to-frame cell changes must be 0.
//     SHOT=path saves the face (default scripts/out/scangrid/linerate-60.png).
// Usage: node scripts/smoke_scangrid_gpu_beam.mjs   (server.py on :8765)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${BASE}?pagePatch=rgb`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphRasterRgbGlScan === "function" && typeof nodeGraphPictureDevice === "function", null, { timeout: 120000 });
// The scan GLSL is fetched: wait until a probe scan succeeds.
await page.waitForFunction(() => {
  const s = { width: 2, height: 2, writePos: 0, scanCredit: 0, gpu: null };
  const ok = nodeGraphRasterRgbGlScan(s, { take: 1, channels: [new Float32Array([1]), null, null], logicalW: 2, logicalH: 2, speed: 1 });
  nodeGraphRasterRgbGlFree(s);
  return ok;
}, null, { timeout: 60000, polling: 250 });

const CASES = [
  { W: 41, H: 29, speed: 2, batches: [735, 735, 1470, 3] },
  { W: 19, H: 13, speed: 8, batches: [735, 900, 64] },
  { W: 96, H: 54, speed: 0.5, batches: [4000, 735, 7] },
  { W: 1, H: 207, speed: 8, batches: [735, 735] },
  { W: 41.5, H: 29.25, speed: 1.5, batches: [735, 1001, 999] },
  { W: 7.25, H: 5.5, speed: 0.75, batches: [100, 333, 50] },
  { W: 13.7, H: 9.3, speed: 0.3, batches: [2000, 777] },
  { W: 33.3, H: 17.9, speed: 2.6, batches: [735, 735, 735] },
  { W: 64, H: 48, speed: 64, batches: [9000, 1] },
  { W: 41, H: 29, speed: 2, batches: Array(45).fill(1536) },
  { W: 41, H: 29, speed: 2, batches: Array.from({ length: 40 }, (_, i) => (i % 9 === 8 ? 2940 : 1470 + (i % 3 === 0 ? 1 : 0))) },
  // Fractional Width / Height at Line Rate 60 (96.4 x 54, 96 x 54.5 at 48 kHz).
  { W: 96.4, H: 54, speed: 96.4 * 60 / 48000, batches: Array(60).fill(800) },
  { W: 96, H: 54.5, speed: 96 * 60 / 48000, batches: Array(60).fill(801) },
  { W: 12.6, H: 7.3, speed: 3.3, batches: [1500, 2222, 17] },
];
const results = await page.evaluate((cases) => {
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const posMod = (p, m) => { const r = p % m; return r < 0 ? r + m : r; };
  const byte = (v) => { const u = Math.min(1, Math.abs(v)); return Number.isFinite(u) ? Math.round(u * 255) : 0; };
  const out = [];
  for (const c of cases) {
    const width = Math.ceil(c.W - 1e-12);
    const height = Math.ceil(c.H - 1e-12);
    const gpuState = { width, height, logicalWidth: c.W, logicalHeight: c.H, writePos: 0, scanCredit: 0, gpu: null };
    const r = rng(c.W * 1000 + c.H);
    let ok = true;
    const all = [[], [], []];
    for (const n of c.batches) {
      const ch = [0, 1, 2].map(() => {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i += 1) a[i] = (r() * 3 - 1.5);
        return a;
      });
      // Missing channel in one batch: G unwired.
      const channels = n === 7 ? [ch[0], null, ch[2]] : ch;
      ok = nodeGraphRasterRgbGlScan(gpuState, { take: n, channels, logicalW: c.W, logicalH: c.H, speed: c.speed }) && ok;
      for (let k = 0; k < 3; k += 1) for (let i = 0; i < n; i += 1) all[k].push(channels[k] ? channels[k][i] : 0);
    }
    const total = all[0].length;
    // CPU reference: raster timing in absolute samples (doubles).
    const D = c.W / c.speed;
    const DW = 1 / c.speed;
    const F = c.H * D;
    const ref = new Uint8Array(width * height * 4);
    for (let i = 3; i < ref.length; i += 4) ref[i] = 255;
    const sampleOf = new Int32Array(width * height).fill(-1);
    let stamps = 0;
    outer: for (let f = 0; ; f += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const exit = Math.min(f * F + y * D + Math.min((x + 1) * DW, D), (f + 1) * F);
          const s = Math.ceil(exit - 1e-3) - 1;
          if (s >= total) break outer;
          const o = (y * width + x) * 4;
          ref[o] = byte(all[0][s]); ref[o + 1] = byte(all[1][s]); ref[o + 2] = byte(all[2][s]);
          sampleOf[y * width + x] = s;
          stamps += 1;
        }
      }
    }
    // The old Scan Speed loop (credit += speed), for whole sizes.
    const old = new Uint8Array(width * height * 4);
    for (let i = 3; i < old.length; i += 4) old[i] = 255;
    let oldPos = 0;
    let oldCredit = 0;
    for (let i = 0; i < total; i += 1) {
      oldCredit += c.speed;
      const n = Math.floor(oldCredit);
      oldCredit -= n;
      for (let k = 0; k < n; k += 1) {
        const x = Math.min(width - 1, Math.floor(posMod(oldPos, c.W)));
        const y = Math.min(height - 1, Math.floor(posMod(Math.floor(oldPos / c.W), c.H)));
        const o = (y * width + x) * 4;
        old[o] = byte(all[0][i]); old[o + 1] = byte(all[1][i]); old[o + 2] = byte(all[2][i]);
        oldPos += 1;
      }
    }
    const grid = nodeGraphRasterRgbGlReadGrid(gpuState);
    let bad = 0;
    let off = 0;
    let lastColBad = 0;
    let lastColStale = 0;
    for (let i = 0; i < width * height; i += 1) {
      let diff = false;
      for (let k = 0; k < 4; k += 1) {
        const d = Math.abs(grid.pixels[i * 4 + k] - ref[i * 4 + k]);
        if (d > 0) diff = true;
        if (d > 1) off = Math.max(off, d);
      }
      if (diff) bad += 1;
      if (i % width === width - 1) {
        if (diff) lastColBad += 1;
        // Stale: the row's beam passed (neighbour written) but the last
        // column was never written, or holds a sample from another pass.
        const s = sampleOf[i];
        const left = width > 1 ? sampleOf[i - 1] : s;
        if (left >= 0 && (s < 0 || (s >= left && s - left > D))) lastColStale += 1;
      }
    }
    let oldBad = 0;
    for (let i = 0; i < width * height; i += 1) {
      for (let k = 0; k < 3; k += 1) if (grid.pixels[i * 4 + k] !== old[i * 4 + k]) { oldBad += 1; break; }
    }
    out.push({ ...c, ok, cells: width * height, bad, oldBad, lastColBad, lastColStale, maxDiff: off, stampsGpu: gpuState.writePos, stampsRef: stamps, draws: gpuState.lastScan?.draws });
    nodeGraphRasterRgbGlFree(gpuState);
  }
  return out;
}, CASES);
let fail = false;
for (const r of results) {
  const whole = Number.isInteger(r.W) && Number.isInteger(r.H) && Number.isInteger(r.speed * 4);
  // No tolerance: positions are integers and every stamp's sample uses the
  // same tie rule on the CPU and GPU.
  const good = r.ok && r.bad === 0 && r.lastColBad === 0 && r.lastColStale === 0 && (!whole || r.oldBad === 0) && r.stampsGpu === r.stampsRef;
  if (!good) fail = true;
  console.log(`${good ? "ok  " : "FAIL"} W=${r.W} H=${r.H} speed=${r.speed} batches=${r.batches.length > 6 ? `${r.batches.length} frames, ${r.batches.reduce((s, n) => s + n, 0)} samples` : r.batches.join("+")}: ${r.bad}/${r.cells} cells differ${r.maxDiff ? ` (max byte diff ${r.maxDiff})` : ""}; last column ${r.lastColBad} wrong, ${r.lastColStale} stale; vs old Scan Speed loop ${r.oldBad}${whole ? "" : " (fractional: new raster)"}; stamps ${r.stampsGpu} vs ${r.stampsRef}`);
}

// Line Rate -> beam speed.
const speeds = await page.evaluate(() => [
  [{ params: { lineRate: 60 } }, 96, 44100],
  [{ params: { lineRate: 60 } }, 41.5, 48000],
  [{ params: { lineRate: 2151.2195121951218 } }, 41, 44100],
  [{ params: { lineRate: 352800 } }, 1, 88200],
  [{ params: {} }, 96, 44100],
].map(([node, w, sr]) => ({ w, sr, lineRate: node.params.lineRate ?? 3675, speed: nodeGraphRasterRgbBeamSpeed(node, w, sr) })));
for (const s of speeds) {
  const want = (s.w * s.lineRate) / s.sr;
  const ok = Math.abs(s.speed - want) < 1e-12 * Math.max(1, want);
  if (!ok) fail = true;
  console.log(`${ok ? "ok  " : "FAIL"} Line Rate ${s.lineRate} Hz, Width ${s.w}, ${s.sr} Hz -> ${s.speed} px/sample (want ${want}; line = ${(s.w / s.speed).toFixed(3)} samples)`);
}

// Stability, synthetic: 60 Hz at Line Rate 60 holds still.
const stable = await page.evaluate((cases) => cases.map((c) => {
  const speed = nodeGraphRasterRgbBeamSpeed({ params: { lineRate: 60 } }, c.W, c.sr);
  const st = { width: Math.ceil(c.W), height: Math.ceil(c.H), writePos: 0, scanCredit: 0, gpu: null };
  let n0 = 0;
  const feed = (n) => {
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const ph = (2 * Math.PI * 60 * (n0 + i)) / c.sr;
      r[i] = 0.9 * Math.sin(ph);
      g[i] = 0.9 * Math.cos(ph);
    }
    n0 += n;
    return nodeGraphRasterRgbGlScan(st, { take: n, channels: [r, g, null], logicalW: c.W, logicalH: c.H, speed });
  };
  const cadence = (i) => (i % 9 === 8 ? 2940 : 1470 + (i % 3 === 0 ? 1 : 0));
  let ok = true;
  let i = 0;
  while (n0 < (2 * c.H / 60) * c.sr) ok = feed(cadence(i++)) && ok;
  const first = nodeGraphRasterRgbGlReadGrid(st).pixels.slice();
  let maxCells = 0;
  let maxByte = 0;
  for (let f = 0; f < 60; f += 1) {
    ok = feed(cadence(i++)) && ok;
    const px = nodeGraphRasterRgbGlReadGrid(st).pixels;
    let cells = 0;
    for (let k = 0; k < px.length; k += 4) {
      let d = 0;
      for (let j = 0; j < 3; j += 1) d = Math.max(d, Math.abs(px[k + j] - first[k + j]));
      if (d) cells += 1;
      maxByte = Math.max(maxByte, d);
    }
    maxCells = Math.max(maxCells, cells);
  }
  nodeGraphRasterRgbGlFree(st);
  return { ...c, ok, speed, maxCells, maxByte, cells: st.width * st.height };
}), [{ W: 96, H: 54, sr: 44100 }, { W: 96, H: 54, sr: 48000 }, { W: 96, H: 54, sr: 88200 }, { W: 41, H: 29, sr: 44100 }, { W: 41.5, H: 30, sr: 44100 }, { W: 7.25, H: 8, sr: 88200 }, { W: 41.5, H: 29, sr: 44100 }, { W: 96.4, H: 54, sr: 48000 }, { W: 96, H: 54.5, sr: 48000, alternates: true }]);
for (const s of stable) {
  // Fractional Height: a frame lasts 54.5 lines, so each frame starts half a
  // source cycle later than the last and the picture flips between two (a
  // real raster does the same; reported, not asserted).
  const ok = s.alternates ? s.ok : s.ok && s.maxCells === 0;
  if (!ok) fail = true;
  console.log(`${ok ? "ok  " : "FAIL"}${s.alternates ? " (info)" : ""} still image (synthetic): 60 Hz at Line Rate 60, W=${s.W} H=${s.H} ${s.sr} Hz (speed ${s.speed.toFixed(6)}): over 60 frames max ${s.maxCells}/${s.cells} cells changed, max byte diff ${s.maxByte}`);
}

// Stability, live: SinCos 60 Hz -> Line Rate 60.
function livePatch() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 26, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  d.nodes.push({ gx: 1, gy: 1, id: "sc-1", type: "sinCos", params: { freq: 60, amp: 0.9 } });
  d.nodes.push({ gx: 8, gy: 1, id: "rg-1", type: "rasterRgb", params: { width: 96, height: 54, lineRate: 60 } });
  d.connections.push({ sourceNode: "sc-1", sourcePort: "sin", destinationNode: "rg-1", destinationPort: "R", tracePoints: [] });
  d.connections.push({ sourceNode: "sc-1", sourcePort: "cos", destinationNode: "rg-1", destinationPort: "G", tracePoints: [] });
  return JSON.stringify(d);
}
const live = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
live.on("pageerror", (e) => errors.push(String(e)));
await live.route("**/sg-linerate.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: livePatch() }));
await live.goto(`${BASE}?pagePatch=sg-linerate`, { waitUntil: "domcontentloaded", timeout: 120000 });
await live.waitForFunction(() => typeof nodeGraphRasterRgbGlReadGrid === "function" && document.querySelector('article[data-node="rg-1"]'), null, { timeout: 120000 });
await live.waitForTimeout(3000);
await live.locator("[data-transport-play]:visible").first().click();
await live.waitForFunction(() => nodeGraphRasterRgbCircuitRunning(), null, { timeout: 30000 });
await live.waitForTimeout(3000);
const liveRun = await live.evaluate(() => new Promise((done) => {
  const grab = () => {
    const st = nodeGraphRasterRgbBuffers.get("rg-1");
    const g = st ? nodeGraphRasterRgbGlReadGrid(st) : null;
    return g ? g.pixels.slice() : null;
  };
  const ring = nodeGraphRasterRgbPickChannel({ nodeId: "rg-1" }, "R");
  const sr = typeof nodeGraphScopeSampleRate === "function" ? nodeGraphScopeSampleRate(ring) : Number(ring?.nodeGraphScopeSampleRate);
  const frames = [];
  const tick = () => {
    frames.push(grab());
    if (frames.length < 31) { setTimeout(tick, 100); return; }
    const out = { sr, frames: frames.length, nullFrames: frames.filter((f) => !f).length, maxCells: 0, maxByte: 0, lit: 0, cells: 0 };
    const ok = frames.filter(Boolean);
    for (let f = 1; f < ok.length; f += 1) {
      let cells = 0;
      for (let k = 0; k < ok[f].length; k += 4) {
        let d = 0;
        for (let j = 0; j < 3; j += 1) d = Math.max(d, Math.abs(ok[f][k + j] - ok[f - 1][k + j]));
        if (d) cells += 1;
        out.maxByte = Math.max(out.maxByte, d);
      }
      out.maxCells = Math.max(out.maxCells, cells);
    }
    if (ok.length) {
      out.cells = ok[0].length / 4;
      for (let k = 0; k < ok[0].length; k += 4) if (ok[0][k] || ok[0][k + 1]) out.lit += 1;
    }
    done(out);
  };
  tick();
}));
const liveOk = liveRun.nullFrames === 0 && liveRun.lit > liveRun.cells * 0.5 && liveRun.maxCells === 0;
if (!liveOk) fail = true;
console.log(`${liveOk ? "ok  " : "FAIL"} still image (live): SinCos 60 Hz at Line Rate 60, 96 x 54, engine ${liveRun.sr} Hz: ${liveRun.frames} grabs 100 ms apart, max ${liveRun.maxCells}/${liveRun.cells} cells changed frame to frame, max byte diff ${liveRun.maxByte} (${liveRun.lit} cells lit)`);
const shot = process.env.SHOT || path.join(root, "scripts/out/scangrid/linerate-60.png");
await live.locator('article[data-node="rg-1"]').screenshot({ path: shot });
console.log(`face screenshot: ${shot}`);
if (errors.length) { console.log("page errors", JSON.stringify(errors.slice(0, 5))); }
await browser.close();
if (fail) { console.log("FAIL smoke_scangrid_gpu_beam"); process.exit(1); }
console.log("ok all");
