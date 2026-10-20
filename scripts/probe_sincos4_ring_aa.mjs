// Probe: SinCos4 analytic ring at high zoom / DPR. Big face (900 css px) at
// DPR 1 and 2, screenshot, then measure the ring radially at 720 angles:
// radius spread (a 96-gon would wobble ~0.2% of R) and edge width (the
// 10-90% fade should be ~ the dot feather 0.7 css px * DPR + 1 px raster).
// Usage: node scripts/probe_sincos4_ring_aa.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let bad = 0; const gate = (ok, m) => { console.log(`${ok ? "ok  " : "FAIL"} ${m}`); if (!ok) bad += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
for (const dpr of [1, 2]) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: dpr })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof createNodeGraphSinCos4Display === "function" && nodeGraphMvp?.patch, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const id = "probeRing"; const node = { id, type: "sineWavetable", params: { mode: 2, freq: 0, phase: 0.125 }, traceDisplaySettings: { sinCos4RingThickness: 1.2, sinCos4RayThickness: 0, sinCos4OuterDotSize: 0, sinCos4HubDotSize: 0, sinCos4HubSize: 0 } };
    nodeGraphMvp.patch.nodes.push(node);
    const sec = createNodeGraphSinCos4Display(id); sec.id = "probeRingSec";
    sec.style.cssText = "position:fixed;left:0;top:0;width:900px;height:900px;z-index:99999;background:#000";
    document.body.append(sec); await new Promise((r) => setTimeout(r, 300));
    sec._sinCos4ForceDraw = true; sec._sinCos4LaidOut = false; drawNodeGraphSinCos4Display(sec);
  });
  await page.waitForTimeout(300);
  const png = await page.locator("#probeRingSec").screenshot({ path: `scripts/out/ring_aa_dpr${dpr}.png` });
  const m = await page.evaluate(async ([b64, dpr]) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const D = x.getImageData(0, 0, c.width, c.height).data; const W = c.width;
    const P = (ix, iy, ch) => D[(iy * W + ix) * 4 + ch];
    // Bilinear on pixel centres (i + 0.5) so the sampling itself adds no wobble.
    const L = (px, py) => { const fx = px - 0.5, fy = py - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      return [0, 1, 2].map((ch) => (P(x0, y0, ch) * (1 - tx) + P(x0 + 1, y0, ch) * tx) * (1 - ty) + (P(x0, y0 + 1, ch) * (1 - tx) + P(x0 + 1, y0 + 1, ch) * tx) * ty); };
    const cx = c.width / 2, cy = c.height / 2, R = 0.38 * c.width; const peaks = [], edges = [], angs = [];
    for (let k = 0; k < 720; k += 1) {
      const a = (k / 720) * Math.PI * 2; const prof = [];
      for (let r = R - 20 * dpr; r <= R + 20 * dpr; r += 0.25) prof.push([r, ...L(cx + Math.cos(a) * r, cy + Math.sin(a) * r)]);
      if (prof.some((p) => p[1] > 120 || p[2] > 120)) continue; // tap dots sit on the ring here
      const bg = Math.min(...prof.map((p) => p[3])); prof.forEach((p) => { p[1] = p[3] - bg; });
      const mx = Math.max(...prof.map((p) => p[1])); const hi = prof.filter((p) => p[1] >= mx * 0.5);
      peaks.push((hi[0][0] + hi.at(-1)[0]) / 2); angs.push(a);
      // outer edge 90% -> 10% distance
      const out = prof.filter((p) => p[0] > peaks.at(-1));
      const r90 = out.find((p) => p[1] <= mx * 0.9)?.[0], r10 = out.find((p) => p[1] <= mx * 0.1)?.[0]; edges.push(r10 - r90);
    }
    const mean = peaks.reduce((s, v) => s + v, 0) / peaks.length; const n = peaks.length;
    // Remove a centre offset (first harmonic); what is left is the shape error.
    const ca = angs.reduce((s, t, i) => s + (peaks[i] - mean) * Math.cos(t), 0) * 2 / n, sa = angs.reduce((s, t, i) => s + (peaks[i] - mean) * Math.sin(t), 0) * 2 / n;
    const res = peaks.map((v, i) => v - mean - ca * Math.cos(angs[i]) - sa * Math.sin(angs[i]));
    return { W, R: +mean.toFixed(2), spread: +(Math.max(...res) - Math.min(...res)).toFixed(2), centreOff: +Math.hypot(ca, sa).toFixed(2), edgeMean: +(edges.reduce((s, v) => s + v, 0) / edges.length).toFixed(2), edgeMax: Math.max(...edges), angles: n };
  }, [png.toString("base64"), dpr]);
  console.log(`dpr ${dpr}`, JSON.stringify(m));
  gate(Math.abs(m.R - 0.38 * m.W) < 1.5 * dpr, `dpr ${dpr}: ring radius ${m.R} = 0.38 x face`);
  gate(m.spread <= 1.0, `dpr ${dpr}: radius spread ${m.spread} device px shape error over 720 angles (96-gon would be ~${(0.38 * m.W * (1 - Math.cos(Math.PI / 96))).toFixed(2)})`);
  gate(m.edgeMax <= 0.7 * dpr + 1.5, `dpr ${dpr}: edge 90->10% ${m.edgeMean} (max ${m.edgeMax}) device px ~ dot feather 0.7*DPR`);
  gate(errors.length === 0, `dpr ${dpr}: no page errors ${errors.slice(0, 2).join(" | ")}`);
}
await browser.close(); console.log(bad ? `${bad} FAIL` : "all ok"); process.exit(bad ? 1 : 0);
