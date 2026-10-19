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
// Usage: node scripts/smoke_scangrid_gpu_beam.mjs   (server.py on :8765)
import { chromium } from "playwright";

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
if (errors.length) { console.log("page errors", JSON.stringify(errors.slice(0, 5))); }
await browser.close();
if (fail) { console.log("FAIL smoke_scangrid_gpu_beam"); process.exit(1); }
console.log("ok all");
