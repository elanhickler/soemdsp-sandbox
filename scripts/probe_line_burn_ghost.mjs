// Probe: line-burn energy (phosphor-energy-gl) Ghost decay times at Trail 0.3,
// stored energy <= 1, and total energy never grows without a deposit.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof globalThis.nodeGraphPhosphorEnergyGlEnsure === "function" && globalThis.PhosphorResidual, null, { timeout: 120000 });
await page.waitForTimeout(800);
const r = await page.evaluate(() => {
  const R = PhosphorResidual; const realFrames = R.stepFrames; R.stepFrames = () => 1;
  const W = 64, H = 64, out = { rows: [] };
  const read = (rd) => { const gl = rd.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, rd.read.framebuffer);
    const px = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let mx = 0, sum = 0; for (let i = 0; i < px.length; i += 4) { mx = Math.max(mx, px[i]); sum += px[i]; } return { mx, sum }; };
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    const rd = nodeGraphPhosphorEnergyGlEnsure({}, W, H, "_probe" + g);
    out.label = rd.read.label;
    nodeGraphPhosphorEnergyGlClear(rd);
    for (let k = 0; k < 20; k += 1) nodeGraphPhosphorEnergyGlDepositDots(rd, { pathPoints: [{ x: 32, y: 32 }], radius: 6, brightness: 1, blur: 0 });
    nodeGraphPhosphorEnergyGlStep(rd, { trail: 0.3, ghost: g, bleed: 0 });
    const s0 = read(rd); let t50 = null, t10 = null, grow = 0, prev = s0.sum, n = 1;
    for (; n < 60 * 240; n += 1) { nodeGraphPhosphorEnergyGlStep(rd, { trail: 0.3, ghost: g, bleed: 0.12 });
      const s = read(rd); if (s.sum > prev * (1 + 1e-5)) grow += 1; prev = s.sum;
      if (t50 == null && s.mx <= 0.5 * s0.mx) t50 = n / 60; if (s.mx <= 0.1 * s0.mx) { t10 = n / 60; break; } }
    out.rows.push({ g, peak: s0.mx, t50, t10, grow });
    nodeGraphPhosphorEnergyGlDestroy(rd);
  }
  // Bright -> stored peak: 20 stacked frames of a packed stroke via StepBeams.
  out.bright = [0, 0.05, 0.25, 0.5, 1, 2].map((b) => { const rd = nodeGraphPhosphorEnergyGlEnsure({}, W, H, "_pb" + b); nodeGraphPhosphorEnergyGlClear(rd);
    const pts = []; for (let i = 0; i < 64; i += 1) pts.push({ x: 4 + i * 56 / 63, y: 32 });
    for (let k = 0; k < 20; k += 1) nodeGraphPhosphorEnergyGlStepBeams(rd, { trail: 0.3, ghost: 0.5, pathPoints: pts, radius: 4, brightness: b, blur: 0.35, mode: k % 2 ? "dots" : "segments", bleed: 0 });
    const m = read(rd).mx; nodeGraphPhosphorEnergyGlDestroy(rd); return { b, m }; });
  R.stepFrames = realFrames; return out;
});
console.log(`energy target ${r.label}`);
console.log("Ghost  stored peak  t50     t10     frames where total grew");
for (const x of r.rows) console.log(`${String(x.g).padEnd(6)} ${x.peak.toFixed(3).padStart(10)}  ${x.t50 == null ? ">240s" : x.t50.toFixed(2) + "s"}  ${x.t10 == null ? ">240s" : x.t10.toFixed(2) + "s"}  ${x.grow}`);
console.log("Bright -> stored peak:", r.bright.map((x) => `${x.b}:${x.m.toFixed(3)}`).join("  "));
gate(r.bright.every((x) => x.m <= 1.0001) && r.bright.every((x, i) => i === 0 || x.m >= r.bright[i - 1].m), "stroke deposits: peak <= 1 and rises with Bright");
gate(r.bright[0].m === 0 && Math.abs(r.bright[2].m / r.bright[4].m - 0.25) < 0.02, "Bright scales the peak linearly from 0");
gate(r.rows.every((x) => x.peak <= 1.0001), "stored energy <= 1 after 20 stacked deposits");
gate(r.rows.every((x) => x.grow === 0), "total energy never grows without a deposit (bleed 0.12)");
const t10 = r.rows.map((x) => x.t10 ?? 1e9); gate(t10.every((v, i) => i === 0 || v >= t10[i - 1]), "10% time rises with Ghost");
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close(); console.log(failures ? `${failures} FAIL` : "all ok"); process.exit(failures ? 1 : 0);
