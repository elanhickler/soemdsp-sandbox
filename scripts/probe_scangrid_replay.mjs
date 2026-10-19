// Scan Grid live-stream replay (rgb patch, play on). Clears rasterRgb-1, records
// every nodeGraphRasterRgbGlScan input for 1.5 s (the exact ring windows the
// paint fed it), reads the GPU grid back, and replays the same stream through
// the old (pre-v2) JS scan loop twice: with |v| bytes (must equal the GPU grid
// byte for byte) and with the old per-window polarity guess (0.5 + 0.5v when a
// window had a negative sample, else clamp). Shows whether a look change comes
// from scan positions or from the brightness mapping.
// Usage: node scripts/probe_scangrid_replay.mjs   (server.py on :8765; OUT=grids.json)
import fs from "node:fs";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.goto("http://127.0.0.1:8765/?pagePatch=rgb", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof setNodeGraphZoom === "function" && document.querySelectorAll("article[data-node-type]").length > 2, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForTimeout(2500);
const r = await page.evaluate(() => new Promise((done) => {
  const calls = [];
  const orig = window.nodeGraphRasterRgbGlScan;
  clearNodeGraphRasterRgbForNode("rasterRgb-1");
  window.nodeGraphRasterRgbGlScan = function (state, input) {
    calls.push({ take: input.take, pos0: state.writePos, credit0: state.scanCredit || 0, W: input.logicalW, H: input.logicalH, speed: input.speed,
      ch: input.channels.map((c) => (c ? Array.from(c) : null)) });
    return orig.call(this, state, input);
  };
  setTimeout(() => {
    window.nodeGraphRasterRgbGlScan = orig;
    const st = nodeGraphRasterRgbBuffers.get("rasterRgb-1");
    const g = nodeGraphRasterRgbGlReadGrid(st);
    done({ calls, gpu: Array.from(g.pixels), w: g.width, h: g.height });
  }, 1500);
}));
const { calls, w, h } = r;
const posMod = (p, m) => { const q = p % m; return q < 0 ? q + m : q; };
function render(mode) {
  const px = new Uint8Array(w * h * 4); for (let i = 3; i < px.length; i += 4) px[i] = 255;
  let pos = calls[0].pos0, credit = calls[0].credit0;
  for (const c of calls) {
    const n = c.take;
    const bi = c.ch.map((d) => { if (!d) return false; for (let i = 0; i < d.length; i += 8) if (d[i] < -1e-6) return true; return false; });
    const byte = (v, k) => {
      if (!Number.isFinite(v)) return 0;
      let u;
      if (mode === "abs") u = Math.min(1, Math.abs(v));
      else if (bi[k]) u = 0.5 + 0.5 * Math.max(-1, Math.min(1, v));
      else u = Math.max(0, Math.min(1, v));
      return u <= 0 ? 0 : u >= 1 ? 255 : Math.round(u * 255);
    };
    for (let i = 0; i < n; i += 1) {
      const vals = c.ch.map((d, k) => (d ? byte(d[i - (n - d.length)] ?? 0, k) : 0));
      credit += c.speed; const st = Math.floor(credit); credit -= st;
      for (let s = 0; s < st; s += 1) {
        const x = Math.min(w - 1, Math.floor(posMod(pos, c.W)));
        const y = Math.min(h - 1, Math.floor(posMod(Math.floor(pos / c.W), c.H)));
        const o = (y * w + x) * 4; px[o] = vals[0]; px[o + 1] = vals[1]; px[o + 2] = vals[2];
        pos += 1;
      }
    }
    if (pos >= c.W * c.H * 4096) pos = posMod(pos, c.W * c.H);
  }
  return px;
}
const oldGuess = render("old");
const oldAbs = render("abs");
let bad = 0; for (let i = 0; i < w * h; i += 1) for (let k = 0; k < 3; k += 1) if (oldAbs[i * 4 + k] !== r.gpu[i * 4 + k]) { bad += 1; break; }
let differ = 0; for (let i = 0; i < w * h; i += 1) for (let k = 0; k < 3; k += 1) if (oldAbs[i * 4 + k] !== oldGuess[i * 4 + k]) { differ += 1; break; }
console.log(`frames ${calls.length}, samples ${calls.reduce((s, c) => s + c.take, 0)}, grid ${w}x${h}`);
console.log(`GPU vs old JS loop with |v| bytes: ${bad}/${w * h} cells differ`);
console.log(`old JS loop: |v| vs old polarity-guess bytes: ${differ}/${w * h} cells differ`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ w, h, gpu: r.gpu, oldGuess: Array.from(oldGuess), oldAbs: Array.from(oldAbs) }));
await browser.close();