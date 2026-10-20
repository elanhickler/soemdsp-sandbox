// Probe: Trace (woscope 1D/2D) brightness scales continuously from 0.
// Sweeps Bright 0.0001..0.01 on the real GPU path and reads the presented
// pixels back: the mean over the stroke must rise from 0 with no jump
// (old rgba8 targets + `beamE <= 0.001` discard + LUT half-texel dead zone
// printed nothing below ~0.0023 and then suddenly printed).
// Usage: node scripts/probe_trace_low_bright.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof TraceWoscope !== "undefined" && typeof SoemGl?.energyFormats === "function"
  && typeof nodeGraphSharedGlDevice === "function", null, { timeout: 120000 });
await page.waitForTimeout(1000);
const r = await page.evaluate(() => {
  const W = 160, H = 64;
  const gl = nodeGraphSharedGlDevice().gl;
  const fmt = SoemGl.energyFormats(gl, { blend: false })[0].label;
  const fmtBlend = SoemGl.energyFormats(gl, { blend: true })[0].label;
  const run = (bright, solidCore) => {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const line = []; for (let i = 0; i <= 400; i += 1) line.push({ x: 8 + i * ((W - 16) / 400), y: H / 2 });
    TraceWoscope.draw(ctx, line, {
      brightAlong: true, solidCore, size: 6, faceMinSide: 64, intensity: bright, burnAmount: 1,
      trail: 0.5, ghost: 0, plateBrightness: 0,
      sampleRgb: (t) => [t * 255, t * 255, t * 255], lutKey: "probe-gray-lin",
    });
    const d = ctx.getImageData(0, 0, W, H).data;
    let s = 0, n = 0;
    for (let y = H / 2 - 2; y <= H / 2 + 1; y += 1) for (let x = 24; x < W - 24; x += 1) { s += d[(y * W + x) * 4]; n += 1; }
    return s / n;
  };
  const out = { fmt, fmtBlend, sweeps: {} };
  for (const solid of [false, true]) {
    const pts = [];
    for (let b = 0.0001; b <= 0.01000001; b += 0.0001) pts.push([+b.toFixed(4), run(b, solid)]);
    pts.unshift([0, run(0, solid)]);
    out.sweeps[solid ? "1D" : "2D"] = pts;
  }
  return out;
});
console.log(`targets: hung ${r.fmt}, live ${r.fmtBlend}`);
gate(r.fmt !== "rgba8" && r.fmtBlend !== "rgba8", "float accumulation targets in use on WebGL2");
for (const [k, pts] of Object.entries(r.sweeps)) {
  const at = (b) => pts.find((p) => Math.abs(p[0] - b) < 1e-6)[1];
  console.log(`${k}: 0->${at(0).toFixed(3)} 0.0005->${at(0.0005).toFixed(3)} 0.0022->${at(0.0022).toFixed(3)} 0.0023->${at(0.0023).toFixed(3)} 0.005->${at(0.005).toFixed(3)} 0.01->${at(0.01).toFixed(3)}`);
  gate(at(0) === 0, `${k}: Bright 0 prints nothing`);
  gate(at(0.0005) > 0, `${k}: Bright 0.0005 already prints (mean ${at(0.0005).toFixed(3)})`);
  let worstDown = 0, worstStep = 0;
  // Expected step per 0.0001 from the slope over the sweep.
  const slope = (pts[pts.length - 1][1] - pts[1][1]) / (pts.length - 2);
  for (let i = 1; i < pts.length; i += 1) {
    worstDown = Math.min(worstDown, pts[i][1] - pts[i - 1][1]);
    worstStep = Math.max(worstStep, pts[i][1] - pts[i - 1][1]);
  }
  gate(worstDown >= -0.02, `${k}: monotonic (worst drop ${worstDown.toFixed(3)})`);
  gate(worstStep <= Math.max(0.05, slope * 4), `${k}: continuous, no jump (largest step ${worstStep.toFixed(3)} vs mean step ${slope.toFixed(3)})`);
  const lin = at(0.01) / at(0.005);
  gate(lin > 1.8 && lin < 2.2, `${k}: scales ~linearly (0.01/0.005 = ${lin.toFixed(2)})`);
}
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
