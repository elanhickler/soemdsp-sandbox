// Probe: float burn targets on the real GPU.
// 1) Number readout burn plate: a Burn 0.0001 deposit is stored as 0.0001
//    (float plate), prints through the 8-bit present (ordered dither), and
//    fades every frame on the shared residual model until the face equals
//    the no-deposit background (the sleep clear happens only after that).
// 2) Image Ghost (imageBurn): High Hang keeps decreasing (no 16F stall) and
//    reaches background.
// Usage: node scripts/probe_float_burn.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphNumberReadoutGlPlateEnsure === "function"
  && typeof nodeGraphImageBurnGlEnsure === "function" && typeof PhosphorResidual !== "undefined"
  && typeof nodeGraphSharedGlDevice === "function" && nodeGraphSharedGlDevice()?.gl, null, { timeout: 120000 });
await page.waitForTimeout(1000);

const nr = await page.evaluate(() => {
  const W = 128, H = 64;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const host = mk(), plate = mk(), bgHost = mk();
  const st = nodeGraphNumberReadoutGlPlateEnsure(host, plate);
  const gl = st.gl;
  const readPlate = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.read.fbo);
    const px = new Float32Array(4);
    gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[3];
  };
  // Flat white ghost gradient: tint = energy, so output measures the plate.
  const stops = [{ t: 0, color: "#ffffff" }, { t: 1, color: "#ffffff" }];
  const face = (c, withPlate) => {
    const pen = nodeGraphNumberReadoutGlBeginFace(c);
    nodeGraphNumberReadoutGlPenRect(pen, 0, 0, W, H, [0, 0, 0], 1);
    if (withPlate) nodeGraphNumberReadoutPresentBurnPlate(pen, c, plate, stops, "#ffffff");
    nodeGraphNumberReadoutGlEndFace(c, pen);
    const d = nodeGraphDisplayCanvasPresentContext(c).getImageData(0, 0, W, H).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 0) lit += 1; sum += d[i]; }
    return { lit, mean: sum / (W * H) };
  };
  const out = { label: st.read.label };
  out.bg = face(bgHost, false);
  const pen = nodeGraphNumberReadoutGlPen(gl, st.read, W, H);
  nodeGraphNumberReadoutGlPenRect(pen, 0, 0, W, H, [255, 255, 255], 0.0001);
  nodeGraphNumberReadoutGlPenFlush(pen);
  out.stored = readPlate();
  out.print = face(host, true);
  // Fade exactly like the draw path (time-based keeps, 1 frame at 60 fps).
  const keeps = PhosphorResidual.residualKeeps(0.5, 0.5);
  let tracker = 0.0001, prev = out.stored, cpu = out.stored;
  out.steps = 0; out.nonDecreasing = 0; out.worstCpuErr = 0; out.litTrace = [];
  out.litRose = false; let lastLit = out.print.lit;
  while (out.steps < 200000) {
    nodeGraphNumberReadoutGlPlateFade(st, keeps, 1);
    tracker *= Math.max(keeps.keepFast, keeps.keepSlow);
    cpu = PhosphorResidual.applyResidual(cpu, 0.5, 0.5, 1);
    out.steps += 1;
    const v = readPlate();
    if (!(v < prev)) out.nonDecreasing += 1;
    out.worstCpuErr = Math.max(out.worstCpuErr, Math.abs(v - cpu) / cpu);
    prev = v;
    if (out.steps % 200 === 0) {
      const f = face(host, true);
      out.litTrace.push(f.lit);
      if (f.lit > lastLit) out.litRose = true;
      lastLit = f.lit;
    }
    if (tracker * 255 < SoemGl.DITHER_INVISIBLE_LSB) break;
  }
  out.atClear = { value: prev, tracker, face: face(host, true) };
  nodeGraphNumberReadoutGlPlateClear(st);
  out.afterClear = face(host, true);
  return out;
});
console.log(JSON.stringify({ ...nr, litTrace: nr.litTrace.slice(0, 12) }));
gate(nr.label === "rgba32f", `number readout plate target: ${nr.label}`);
gate(Math.abs(nr.stored - 0.0001) < 1e-6, `Burn 0.0001 deposit stored as ${nr.stored.toExponential(4)}`);
gate(nr.print.lit > 0 && nr.bg.lit === 0, `0.0001 deposit prints through the 8-bit present (${nr.print.lit}/${128 * 64} dithered pixels lit; background ${nr.bg.lit})`);
gate(nr.nonDecreasing === 0, `plate decreases every frame (${nr.steps} frames, ${nr.nonDecreasing} stalls)`);
gate(nr.worstCpuErr < 1e-3, `GPU fade = PhosphorResidual.applyResidual (worst rel err ${nr.worstCpuErr.toExponential(2)})`);
gate(!nr.litRose, "lit pixels never increase while fading");
gate(nr.atClear.face.lit === 0 && nr.atClear.face.mean === nr.bg.mean, `face already equals background when the sleep clear runs (lit ${nr.atClear.face.lit}, plate ${nr.atClear.value.toExponential(2)}, after ${nr.steps} frames = ${(nr.steps / 60).toFixed(1)} s)`);
gate(nr.afterClear.lit === 0 && nr.afterClear.mean === nr.bg.mean, "clear is invisible (face unchanged)");

const ib = await page.evaluate(() => {
  const host = {};
  const S = 64;
  if (!nodeGraphImageBurnGlEnsure(host, S, S)) return { err: "ensure failed" };
  const r = host._imageBurnGl;
  const gl = r.gl;
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const read = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.read.framebuffer);
    const px = new Float32Array(4);
    gl.readPixels(S >> 1, S >> 1, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[0];
  };
  const opts = { hang: 0.95, burn: 1, contrast: 0, blur: 0, imageSize: 1, accumulate: false };
  nodeGraphImageBurnGlStep(host, { ...opts, deposit: 1, textureIn: { texture: white, width: 1, height: 1 } });
  const out = { label: nodeGraphImageBurnGlFormatLabel(host), start: read(), checkpoints: [], steps: 0 };
  let prev = out.start;
  out.stalls = 0;
  while (out.steps < 120000) {
    for (let i = 0; i < 1000; i += 1) nodeGraphImageBurnGlStep(host, { ...opts, deposit: 0 });
    out.steps += 1000;
    const v = read();
    out.checkpoints.push(v);
    if (!(v < prev)) out.stalls += 1;
    prev = v;
    if (v * 255 < 0.5) break;
  }
  out.end = prev;
  // 16F (11-bit mantissa) emulation of the same frame keep: where it stalls.
  const half = (x) => { if (x === 0) return 0; const e = Math.floor(Math.log2(x)); const q = Math.pow(2, e - 10); return Math.round(x / q) * q; };
  const keepAt = (v) => { const hk = 1 - Math.pow(0.05, 3); return hk + (0.9995 - hk) * Math.min(1, v); };
  let h = 1, n = 0; while (n < 200000) { const nh = half(h * keepAt(h)); if (nh === h) break; h = nh; n += 1; }
  out.half16StallAt = h;
  return out;
});
if (ib.err) gate(false, `imageBurn: ${ib.err}`); else {
  console.log(JSON.stringify({ ...ib, checkpoints: ib.checkpoints.slice(0, 8).map((v) => +v.toExponential(3)) }));
  gate(/rgba32f/.test(String(ib.label)), `imageBurn residual target: ${ib.label}`);
  gate(ib.stalls === 0, `Hang 0.95 + Burn 1: residual decreases at every 1000-frame checkpoint (${ib.checkpoints.length} checkpoints, ${ib.stalls} stalls)`);
  gate(ib.end * 255 < 0.5, `reaches background: ${ib.start.toFixed(3)} -> ${ib.end.toExponential(2)} (< 0.5/255) in ${ib.steps} frames (${(ib.steps / 60 / 60).toFixed(1)} min at 60 fps)`);
  console.log(`info: the old RGBA16F target would stall at ${ib.half16StallAt.toFixed(4)} (${(ib.half16StallAt * 255).toFixed(1)}/255) forever`);
}
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
