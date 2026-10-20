// Probe: Ghost hang is a continuous, monotonic function of Ghost from 0
// (Ghost 0 = no tail, no switch at 0.001), Trail is continuous up to its
// Trail 1 freeze, and the residual face (Phosphor Dot / Hypersaw plate,
// float target) fades to its background on the shared residual model.
// Usage: node scripts/probe_ghost_continuity.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof globalThis.PhosphorResidual?.ghostTailSeconds === "function"
  && typeof globalThis.nodeGraphResidualFaceGlPlate === "function" && globalThis.nodeGraphSharedGlDevice?.()?.gl, null, { timeout: 120000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const R = PhosphorResidual;
  // Seconds for stored energy 1 to fall below 1/255 at 60 fps.
  const fadeSeconds = (trail, ghost) => {
    let e = 1, n = 0;
    while (e >= 1 / 255 && n < 600000) { e = R.applyResidual(e, trail, ghost, 1); n += 1; }
    return n / 60;
  };
  const TRAIL = 0.5;
  const sweep = [];
  for (let i = 0; i <= 80; i += 1) {
    const g = i * 0.00025;
    sweep.push({ g, tail: R.keepToSeconds(R.residualKeeps(TRAIL, g).keepSlow), fade: fadeSeconds(TRAIL, g) });
  }
  const table = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 1].map((g) => ({
    g, ghostTail: R.ghostTailSeconds(g), tail: R.keepToSeconds(R.residualKeeps(TRAIL, g).keepSlow), fade: fadeSeconds(TRAIL, g),
    destErase: R.destGhostEraseAmount(g), sleep: R.residualSleepFrames(g),
  }));
  const trails = [0.9, 0.98, 0.99, 0.995, 0.999, 0.9999, 1].map((t) => ({ t, erase: R.trailFadeAmount(t), tau: R.keepToSeconds(R.trailKeep(t)) }));
  const trailFine = [];
  for (let i = 0; i <= 200; i += 1) { const t = 0.98 + i * 0.0001; trailFine.push(R.trailFadeAmount(t)); }

  // GPU: residual face plate fades to the background.
  const W = 64, H = 64;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const st = nodeGraphResidualFaceGlPlate(c, "probe");
  const gl = st.gl;
  const bg = [26 / 255, 26 / 255, 30 / 255];
  const readPlate = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.read.fbo);
    const px = new Float32Array(4);
    gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[3];
  };
  const faceDiff = () => {
    nodeGraphResidualFaceGlPresent(st, c, bg);
    const d = nodeGraphDisplayCanvasPresentContext(c).getImageData(0, 0, W, H).data;
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 26 || d[i + 1] !== 26 || d[i + 2] !== 30) diff += 1;
    return diff;
  };
  const face = { label: st.read.label, bgDiff: faceDiff() };
  const verts = new Float32Array(6 * 12);
  nodeGraphResidualFaceGlPushQuad(verts, 0, 0, 0, W, H, [1, 1, 1, 1], [0, W, -1, 0.5], [0, 0]);
  nodeGraphResidualFaceGlQuads(st, verts, 6, NODE_GRAPH_RESIDUAL_FACE_STEM_FS, "residual-face-stem", "add");
  face.start = readPlate();
  face.startDiff = faceDiff();
  const keeps = R.residualKeeps(0.5, 0.25);
  let prev = face.start, cpu = face.start;
  face.stalls = 0; face.worstErr = 0; face.frames = 0; face.diffRose = false;
  let lastDiff = face.startDiff;
  while (face.frames < 100000) {
    nodeGraphResidualFaceGlDecay(st, keeps, 1);
    cpu = R.applyResidual(cpu, 0.5, 0.25, 1);
    face.frames += 1;
    const v = readPlate();
    if (!(v < prev) && prev > 0) face.stalls += 1;
    if (cpu > 1e-30) face.worstErr = Math.max(face.worstErr, Math.abs(v - cpu) / cpu);
    prev = v;
    if (face.frames % 120 === 0) {
      const d = faceDiff();
      if (d > lastDiff) face.diffRose = true;
      lastDiff = d;
      if (d === 0) break;
    }
  }
  face.end = prev; face.endDiff = lastDiff;
  return { sweep, table, trails, trailFine, face };
});

const s = r.sweep;
let mono = true, maxStep = 0;
for (let i = 1; i < s.length; i += 1) {
  if (s[i].tail < s[i - 1].tail || s[i].fade < s[i - 1].fade) mono = false;
  maxStep = Math.max(maxStep, s[i].fade - s[i - 1].fade);
}
gate(mono, "Ghost 0..0.02 (step 0.00025): dim-tail time and 1->1/255 fade time never decrease");
gate(Math.abs(s[1].fade - s[0].fade) <= 1 / 60 && Math.abs(s[1].tail - s[0].tail) < 1e-3, `no jump leaving Ghost 0: fade ${s[0].fade.toFixed(3)} s -> ${s[1].fade.toFixed(3)} s at Ghost 0.00025`);
gate(maxStep <= 2 / 60, `continuous: largest fade-time step over the sweep ${(maxStep * 1000).toFixed(1)} ms (frame quantised)`);
console.log("Ghost sweep (Trail 0.5) g: fade s =", s.filter((_, i) => i % 8 === 0).map((x) => `${x.g.toFixed(4)}:${x.fade.toFixed(3)}`).join("  "));
console.log("\nGhost mapping (tail tau = 60 s * g^2, added to Trail's tau; Trail 0.5):");
console.log("  Ghost   ghost tau   dim-tail tau   fade 1->1/255   Trace ghost erase/frame   sleep frames");
for (const t of r.table) console.log(`  ${String(t.g).padEnd(6)}  ${t.ghostTail.toPrecision(3).padStart(9)} s  ${t.tail.toPrecision(3).padStart(10)} s  ${t.fade.toFixed(2).padStart(11)} s  ${t.destErase.toPrecision(3).padStart(14)}  ${String(t.sleep).padStart(12)}`);
gate(r.table[0].destErase === 1, "Trace ghost layer: Ghost 0 erases at once (no layer, no switch)");
let tMono = true, tStep = 0;
for (let i = 1; i < r.trailFine.length; i += 1) { if (r.trailFine[i] > r.trailFine[i - 1]) tMono = false; tStep = Math.max(tStep, r.trailFine[i - 1] - r.trailFine[i]); }
gate(tMono && tStep < 2e-4, `Trail 0.98..1: erase falls smoothly (largest step ${tStep.toExponential(2)})`);
console.log("Trail:", r.trails.map((t) => `${t.t}: erase ${t.erase.toPrecision(3)} tau ${Number.isFinite(t.tau) ? t.tau.toPrecision(3) + " s" : "freeze"}`).join(" | "));
gate(r.trails.at(-1).erase === 0, "Trail 1 still freezes");
const F = r.face;
gate(/rgba32f/.test(F.label), `residual face target: ${F.label}`);
gate(F.bgDiff === 0 && F.startDiff > 0, `empty face = background; deposit 0.5 shows (${F.startDiff} px)`);
gate(F.stalls === 0, `residual face plate decreases every frame (${F.frames} frames)`);
gate(F.worstErr < 1e-3, `GPU decay = PhosphorResidual.applyResidual (worst rel err ${F.worstErr.toExponential(2)})`);
gate(!F.diffRose && F.endDiff === 0, `fades to the background exactly (${(F.frames / 60).toFixed(1)} s at Trail 0.5 / Ghost 0.25, plate ${F.end.toExponential(2)})`);
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
