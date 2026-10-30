// Render Sample parity: Render Sample output must equal a direct bounce of the
// live worklet (native graph + native rapt elliptic decimator) at 1x/2x/4x,
// and node-graph-render-output.js must hold no JS resampler/decimator.
import fs from "fs";
import { chromium } from "playwright";

const src = fs.readFileSync(new URL("../public/node-graph-render-output.js", import.meta.url), "utf8");
for (const banned of ["RaptElliptic", "Resample", "Prefilter", "QuarterbandSos"]) {
  if (src.includes(banned)) throw new Error(`render output still has JS DSP: ${banned}`);
}

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto("http://127.0.0.1:8765/?v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof renderNodeGraphAudio === "function" && typeof createNodeGraphLiveWorkletNode === "function" && nodeGraphMvp?.patch, null, { timeout: 120000 });
await page.waitForTimeout(1500);

const results = await page.evaluate(async () => {
  const out = [];
  // Pick the first saved patch that makes sound at 1x.
  const entries = await loadNodeGraphDemoPatchEntries();
  let picked = "";
  for (const entry of entries) {
    const name = entry?.filename || entry;
    try { await loadNodeGraphDemoPatch(name); } catch (_e) { continue; }
    nodeGraphMvp.patch.audio = { ...(nodeGraphMvp.patch.audio || {}), oversamplingFactor: 1 };
    await renderNodeGraphAudio();
    if ((nodeGraphMvp.rendered?.peak || 0) > 0.01) { picked = String(name); break; }
  }
  out.push({ patch: picked || "(none sounded)" });
  for (const factor of [1, 2, 4]) {
    nodeGraphMvp.patch.audio = { ...(nodeGraphMvp.patch.audio || {}), oversamplingFactor: factor };
    await renderNodeGraphAudio();
    const r = nodeGraphMvp.rendered;
    if (!r) { out.push({ factor, error: "no render" }); continue; }
    const hostRate = nodeGraphLiveHostSampleRate();
    const audio = nodeGraphAudioDerivation(nodeGraphMvp.patch, hostRate);
    const plan = nodeGraphBuildLivePlan();
    const ctx = new OfflineAudioContext(2, r.fullEngineFrames, audio.outputSampleRate);
    const node = await createNodeGraphLiveWorkletNode(ctx, plan);
    node.connect(ctx.destination);
    const compiled = new Promise((res) => {
      node.port.addEventListener("message", (ev) => { if (ev.data?.type === "nativeGraphStatus" && ev.data.status !== "pending") res(); });
      setTimeout(res, 15000);
    });
    node.port.postMessage({
      type: "setPlan", plan, planSerial: 999999, patchFingerprint: nodeGraphPatchFingerprint(),
      sampleRate: audio.outputSampleRate, engineSampleRate: audio.clampedEngineSampleRate,
      oversamplingRatio: audio.oversamplingRatio,
      pitchReferenceHz: nodeGraphFiniteNumber(nodeGraphMvp?.pitchReferenceHz, 440),
      pitchReferenceMidiNote: nodeGraphFiniteNumber(nodeGraphMvp?.pitchReferenceMidiNote, 69),
      sessionId: nodeGraphFiniteNumber(nodeGraphMvp?.live?.sessionId, 1),
      timing: nodeGraphMvp?.patch?.timing || null,
    });
    node.port.postMessage({ type: "setSpeed", speed: 1 });
    await compiled;
    node.port.postMessage({ type: "setSpeed", speed: 1 });
    await new Promise((res) => setTimeout(res, 50));
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let maxDiff = 0, peak = 0;
    for (let i = 0; i < r.frames; i++) {
      const s = r.startEngineFrame + i;
      maxDiff = Math.max(maxDiff, Math.abs(L[s] - r.leftSamples[i]), Math.abs(R[s] - r.rightSamples[i]));
      peak = Math.max(peak, Math.abs(L[s]));
    }
    out.push({ factor, ratio: r.oversamplingRatio, frames: r.frames, peak, maxDiff, muted: r.protectionMuteCount });
  }
  return out;
});
console.table(results);
await browser.close();
let bad = !results[0].patch || results[0].patch.startsWith("(");
for (const r of results.slice(1)) {
  if (r.error || r.ratio !== r.factor || !(r.peak > 0) || (r.muted === 0 && r.maxDiff > 1e-6)) bad = true;
}
if (bad) { console.error("render parity FAILED"); process.exit(1); }
console.log("render native parity ok");


