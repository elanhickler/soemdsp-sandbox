// Scan Grid (rasterRgb) GPU beam smoke, on a real GPU (headed Chromium).
// 1. Beam writes: nodeGraphRasterRgbGlScan into a fresh grid, fed in several
//    frames, must match a CPU reference of the position maths byte for byte:
//    sample i makes floor(c + (i+1)*speed) - floor(c + i*speed) stamps (c =
//    credit carried in), stamp at pos: x = floor(pos mod W),
//    y = floor(floor(pos / W) mod H) (clamped to the storage grid), colour
//    round(clamp(|v|, 0, 1) * 255). Whole, binary-fraction and decimal W/H/Speed.
//    The old JS loop (credit += speed each sample) is reported alongside: it
//    equals the reference exactly for binary-fraction speeds; for decimal
//    speeds (0.3) its running sum drifts and flips stamps at the exact ties.
//    For whole / binary-fraction values the GPU must equal the old JS loop
//    too (asserted). Streaming cases: the saved rgb patch (41 x 29, Scan
//    Speed 2) fed 45 frames of 1536 samples, as the live ring delivers them at
//    44.1 kHz, and a mixed 1470 / 1471 / 2940 (stall) cadence: catches any
//    start-position, credit or per-frame offset drift across frames.
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
];
const results = await page.evaluate((cases) => {
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const posMod = (p, m) => { const r = p % m; return r < 0 ? r + m : r; };
  const out = [];
  for (const c of cases) {
    const width = Math.ceil(c.W - 1e-12);
    const height = Math.ceil(c.H - 1e-12);
    const gpuState = { width, height, logicalWidth: c.W, logicalHeight: c.H, writePos: 0, scanCredit: 0, gpu: null };
    const ref = new Uint8Array(width * height * 4);
    for (let i = 3; i < ref.length; i += 4) ref[i] = 255;
    const old = ref.slice();
    let pos = 0;
    let credit = 0;
    let oldPos = 0;
    let oldCredit = 0;
    const r = rng(c.W * 1000 + c.H);
    let ok = true;
    for (const n of c.batches) {
      const ch = [0, 1, 2].map(() => {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i += 1) a[i] = (r() * 3 - 1.5);
        return a;
      });
      // Missing channel in one batch: G unwired.
      const channels = n === 7 ? [ch[0], null, ch[2]] : ch;
      ok = nodeGraphRasterRgbGlScan(gpuState, { take: n, channels, logicalW: c.W, logicalH: c.H, speed: c.speed }) && ok;
      const byte = (v) => { const u = Math.min(1, Math.abs(v)); return Number.isFinite(u) ? Math.round(u * 255) : 0; };
      const stamp = (grid, p, i) => {
        const x = Math.min(width - 1, Math.floor(posMod(p, c.W)));
        const y = Math.min(height - 1, Math.floor(posMod(Math.floor(p / c.W), c.H)));
        const o = (y * width + x) * 4;
        grid[o] = byte(channels[0] ? channels[0][i] : 0);
        grid[o + 1] = byte(channels[1] ? channels[1][i] : 0);
        grid[o + 2] = byte(channels[2] ? channels[2][i] : 0);
        grid[o + 3] = 255;
      };
      // CPU reference: closed-form stamp schedule.
      for (let i = 0; i < n; i += 1) {
        const stamps = Math.floor(credit + (i + 1) * c.speed) - Math.floor(credit + i * c.speed);
        for (let s = 0; s < stamps; s += 1) { stamp(ref, pos, i); pos += 1; }
      }
      const total = credit + n * c.speed;
      credit = total - Math.floor(total);
      if (pos >= c.W * c.H * 4096) pos = posMod(pos, c.W * c.H);
      // The old JS loop, for the report.
      for (let i = 0; i < n; i += 1) {
        oldCredit += c.speed;
        const stamps = Math.floor(oldCredit);
        oldCredit -= stamps;
        for (let s = 0; s < stamps; s += 1) { stamp(old, oldPos, i); oldPos += 1; }
      }
      if (oldPos >= c.W * c.H * 4096) oldPos = posMod(oldPos, c.W * c.H);
    }
    const grid = nodeGraphRasterRgbGlReadGrid(gpuState);
    let bad = 0;
    let off = 0;
    for (let i = 0; i < width * height; i += 1) {
      let diff = false;
      for (let k = 0; k < 4; k += 1) {
        const d = Math.abs(grid.pixels[i * 4 + k] - ref[i * 4 + k]);
        if (d > 0) diff = true;
        if (d > 1) off = Math.max(off, d);
      }
      if (diff) bad += 1;
    }
    let oldBad = 0;
    let oldVsRef = 0;
    for (let i = 0; i < width * height; i += 1) {
      for (let k = 0; k < 3; k += 1) if (grid.pixels[i * 4 + k] !== old[i * 4 + k]) { oldBad += 1; break; }
      for (let k = 0; k < 3; k += 1) if (ref[i * 4 + k] !== old[i * 4 + k]) { oldVsRef += 1; break; }
    }
    out.push({ ...c, ok, cells: width * height, bad, oldBad, oldVsRef, maxDiff: off, posGpu: gpuState.writePos, posRef: pos, creditGpu: gpuState.scanCredit, creditRef: credit, draws: gpuState.lastScan?.draws });
    nodeGraphRasterRgbGlFree(gpuState);
  }
  return out;
}, CASES);
let fail = false;
for (const r of results) {
  const exactMath = Number.isInteger(r.W * 4) && Number.isInteger(r.H * 4) && Number.isInteger(r.speed * 4);
  // Decimal sizes / speeds are not exact in binary. Where the exact maths
  // lands a stamp exactly on a boundary (2.6 * 5 = 13), float32 (GPU) and
  // double (CPU) can round it to the neighbouring sample or column. That pixel
  // then holds the colour of a sample 1/44100 s away. The old JS loop has
  // the same kind of tie flips against the exact maths (reported). Allow 5% of
  // cells there; binary fractions (all saved patches) must match exactly.
  const allowed = exactMath ? 0 : Math.ceil(r.cells * 0.05);
  const good = r.ok && r.bad <= allowed && (!exactMath || r.oldBad === 0) && Math.abs(r.posGpu - r.posRef) < 1e-6 && Math.abs(r.creditGpu - r.creditRef) < 1e-6;
  if (!good) fail = true;
  console.log(`${good ? "ok  " : "FAIL"} W=${r.W} H=${r.H} speed=${r.speed} batches=${r.batches.length > 6 ? `${r.batches.length} frames, ${r.batches.reduce((s, n) => s + n, 0)} samples` : r.batches.join("+")}: ${r.bad}/${r.cells} cells differ (allowed ${allowed}${r.maxDiff ? `, max byte diff ${r.maxDiff}` : ""}; vs old JS loop ${r.oldBad}, old loop vs reference ${r.oldVsRef}); pos ${r.posGpu} vs ${r.posRef}, credit ${r.creditGpu.toFixed(6)} vs ${r.creditRef.toFixed(6)}`);
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
}), [{ W: 96, H: 54, sr: 44100 }, { W: 96, H: 54, sr: 48000 }, { W: 96, H: 54, sr: 88200 }, { W: 41, H: 29, sr: 44100 }, { W: 41.5, H: 30, sr: 44100 }, { W: 7.25, H: 8, sr: 88200 }, { W: 41.5, H: 29, sr: 44100, alternates: true }]);
for (const s of stable) {
  // Fractional Width with an odd line count: row y is fed by lines whose
  // sub-pixel start phase alternates each pass, so it flips between two
  // still pictures (reported, not asserted).
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
