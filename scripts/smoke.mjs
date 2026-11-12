// Smoke test: patches/smoke_test.json must render exactly patches/smoke_test.wav.
// The WAV is the reference Argi rendered and saved with Render Sample + download,
// so this checks the patch, the engine, seeds and the WAV encoder in one go:
// render 1 s headless, encode it with the app's own nodeGraphRenderedWavBlob,
// subtract sample by sample. Every difference must be 0.
// Report only: always exits 0, never blocks a release. Read the last lines.
//   node scripts/smoke.mjs
//   SANDBOX_URL=http://127.0.0.1:8765/ node scripts/smoke.mjs   (use a running server)
// New reference after an intended change: re-render in the app and save over
// patches/smoke_test.wav.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATCH = "smoke_test";
const REFERENCE = path.join(ROOT, "patches", `${PATCH}.wav`);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch (_e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not answer at ${url}`);
}

// 16-bit stereo PCM WAV -> { sampleRate, frames, pcm: Int16Array interleaved }.
function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let sampleRate = 0, channels = 0, bits = 0, pcm = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = view.getUint32(o + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(o + 10, true);
      sampleRate = view.getUint32(o + 12, true);
      bits = view.getUint16(o + 22, true);
    } else if (id === "data") {
      pcm = new Int16Array(size / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(o + 8 + i * 2, true);
    }
    o += 8 + size + (size & 1);
  }
  if (bits !== 16 || channels !== 2 || !pcm) throw new Error(`expected 16-bit stereo PCM, got ${bits}-bit ${channels} ch`);
  return { sampleRate, frames: pcm.length / 2, pcm };
}

const lines = [];
const SMOKE_RED = "\x1b[31m";
const SMOKE_RESET = "\x1b[0m";
const say = (s) => {
  lines.push(s);
  // Failure lines in red so they stand out in the terminal.
  console.log(s.includes("PROBLEM") ? `${SMOKE_RED}${s}${SMOKE_RESET}` : s);
};
let server = null;
let browser = null;
let baseUrl = process.env.SANDBOX_URL || "";
try {
  const ref = readWav(new Uint8Array(fs.readFileSync(REFERENCE)));
  say(`[smoke] reference ${PATCH}.wav: ${ref.frames} frames at ${ref.sampleRate} Hz (${(ref.frames / ref.sampleRate).toFixed(6)} s)`);

  if (!baseUrl) {
    const port = await freePort();
    const python = process.platform === "win32" ? "python" : "python3";
    server = spawn(python, [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
  }
  await waitForServer(baseUrl, 60000);
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(
    () => typeof renderNodeGraphAudio === "function"
      && typeof nodeGraphRenderedWavBlob === "function"
      && typeof scheduleNodeGraphLivePlanSync === "function"
      && nodeGraphMvp?.patch,
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(1500); // let boot finish its own first commit

  const seconds = ref.frames / ref.sampleRate;
  const got = await page.evaluate(async ({ patch, seconds }) => {
    const res = await fetch(`/soemdsp-sandbox/patches/${patch}.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${patch}.json`);
    const data = await res.json();
    const loaded = nodeGraphPatchFromShareProjectData(
      data?.kind === "sandbox_patch"
        ? data
        : { kind: "sandbox_patch", version: 1, title: patch, bank_name: "soundemote", patch_data: data },
    );
    commitNodeGraphPatch(cloneNodeGraphPatch(loaded), { autosaveWorkingPatch: false });
    // Render range = the reference length, from 0.
    const secs = document.getElementById("nodeRenderSecondsValue");
    if (secs) secs.value = String(seconds);
    const root = nodeGraphRenderRangeInputRoot();
    const s = root.querySelector(".node-header-render-start-input");
    const e = root.querySelector(".node-header-render-end-input");
    if (s) s.value = "0";
    if (e) e.value = String(seconds);
    nodeGraphMvp.renderStartSeconds = 0;
    nodeGraphMvp.renderEndSeconds = seconds;
    nodeGraphMvp.seconds = seconds;
    await renderNodeGraphAudio();
    if (!nodeGraphMvp.rendered?.leftSamples) return null;
    const blob = nodeGraphRenderedWavBlob(nodeGraphMvp.rendered);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { patch: PATCH, seconds });

  if (!got) {
    say("[smoke] PROBLEM: render produced nothing (graph invalid or render blocked)");
  } else {
    const now = readWav(new Uint8Array(got));
    if (now.sampleRate !== ref.sampleRate) say(`[smoke] PROBLEM: render is ${now.sampleRate} Hz, reference is ${ref.sampleRate} Hz`);
    if (now.frames !== ref.frames) say(`[smoke] PROBLEM: render is ${now.frames} frames, reference is ${ref.frames} (Render Sample length bug?)`);
    const n = Math.min(now.pcm.length, ref.pcm.length);
    let differ = 0, maxDiff = 0, first = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(now.pcm[i] - ref.pcm[i]);
      if (d) {
        differ++;
        if (first < 0) first = i;
        if (d > maxDiff) maxDiff = d;
      }
    }
    say(`[smoke] first sample: render L ${now.pcm[0]} R ${now.pcm[1]}, reference L ${ref.pcm[0]} R ${ref.pcm[1]}`);
    if (differ) {
      const frame = first >> 1;
      say(`[smoke] PROBLEM: ${differ} of ${n} samples differ, largest by ${maxDiff} (16-bit steps), first at frame ${frame} (${(frame / ref.sampleRate).toFixed(5)} s, ${first & 1 ? "R" : "L"})`);
    } else if (now.frames === ref.frames) {
      say(`[smoke] render minus reference = 0 on all ${n} samples`);
    }
  }
  for (const msg of pageErrors) say(`[smoke] PROBLEM: page error: ${msg}`);
} catch (error) {
  say(`[smoke] PROBLEM: smoke could not run: ${error.message || error}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
const problems = lines.filter((l) => l.includes("PROBLEM")).length;
console.log(problems
  ? `${SMOKE_RED}[smoke] ${problems} problem(s), see above${SMOKE_RESET}`
  : "[smoke] pass");
process.exit(0);
