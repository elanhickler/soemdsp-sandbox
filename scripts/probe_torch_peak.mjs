// Probe: Torch Open = peak of this frame's Analog samples (fast signals as
// bright as slow ones at the same amplitude). Usage: node scripts/probe_torch_peak.mjs
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof drawNodeGraphTorchFaceItem === "function", null, { timeout: 120000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const SR = 48000, N = 4096, ID = "probeTorchPeak";
  const realConn = nodeGraphModuleScopeConnectionsTo;
  globalThis.nodeGraphModuleScopeConnectionsTo = (id, port) => (id === ID && port === "Analog" ? [{}] : id === ID ? [] : realConn(id, port));
  const face = document.createElement("div");
  face.style.cssText = "position:fixed;left:0;top:0;width:90px;height:30px;z-index:99999"; document.body.append(face);
  const run = async (label, fn) => {
    const ring = new Float32Array(N); for (let i = 0; i < N; i += 1) ring[i] = fn((i - N) / SR);
    ring.nodeGraphScopeTotalSampleCount = 10 * SR; ring.nodeGraphScopeSampleRate = SR;
    nodeGraphModuleScopeState.buffers.set(`${ID}:Analog`, ring);
    const win = Math.ceil(SR / 60); let mean = 0; for (let i = N - win; i < N; i += 1) mean += Math.max(0, Math.min(1, ring[i])); mean /= win;
    let open = null, lum = 0;
    for (let k = 0; k < 30; k += 1) { delete face._torchFaceOpenAbs; drawNodeGraphTorchFaceItem(null, { slot: { nodeId: ID }, screenElement: face, buffer: null }, 1); open = face._torchFaceOpen; await new Promise((res) => setTimeout(res, 30)); }
    const c = face.querySelector(".node-torch-face-canvas");
    if (c) { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) lum += d[i] + d[i + 1] + d[i + 2]; }
    return { label, oldMean: mean, open, lum };
  };
  const out = [];
  out.push(await run("slow 0.5 Hz unipolar 0..1, at crest", (t) => 0.5 + 0.5 * Math.cos(2 * Math.PI * 0.5 * (t + 1 / 120))));
  out.push(await run("200 Hz unipolar 0..1", (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 200 * t)));
  out.push(await run("200 Hz bipolar +-1", (t) => Math.sin(2 * Math.PI * 200 * t)));
  out.push(await run("20 Hz fast LFO unipolar 0..1", (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 20 * t)));
  out.push(await run("DC 1", () => 1));
  out.push(await run("200 Hz unipolar 0..0.5", (t) => 0.25 + 0.25 * Math.sin(2 * Math.PI * 200 * t)));
  out.push(await run("DC 0.5", () => 0.5));
  out.push(await run("DC 0", () => 0));
  globalThis.nodeGraphModuleScopeConnectionsTo = realConn; face.remove();
  return out;
});
for (const x of r) console.log(`${x.label.padEnd(38)} old mean ${x.oldMean.toFixed(3)}  new Open ${Number(x.open).toFixed(3)}  face lum ${x.lum}`);
const by = Object.fromEntries(r.map((x) => [x.label, x]));
const slow = by["slow 0.5 Hz unipolar 0..1, at crest"], fast = by["200 Hz unipolar 0..1"];
gate(fast.open >= slow.open - 0.01 && fast.lum >= slow.lum * 0.98, `200 Hz torch not dimmer than slow (Open ${fast.open.toFixed(3)} vs ${slow.open.toFixed(3)}, lum ${fast.lum} vs ${slow.lum})`);
gate(Math.abs(by["200 Hz bipolar +-1"].open - 1) < 0.01, "bipolar sine: peak of clamp(A,0,1) = 1");
gate(Math.abs(by["200 Hz unipolar 0..0.5"].open - by["DC 0.5"].open) < 0.01, "0..0.5 sine = DC 0.5 (continuous in amplitude)");
gate(by["DC 0"].open === 0, "DC 0 stays unlit");
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close(); console.log(failures ? `${failures} FAIL` : "all ok"); process.exit(failures ? 1 : 0);
