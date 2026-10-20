// Probe: Ghost is decay time only, never brightness (trace-woscope burn path,
// shared PhosphorResidual model). On a real GPU:
//  1. burn a line, let it hang on the Ghost layer (Trail 0 wipes the hot path),
//  2. raise Ghost mid-hang -> no pixel may get brighter (readback),
//  3. fade rate per frame is slower at high Ghost than at low Ghost,
//  4. same elapsed time at 30 fps and 60 fps gives the same fade (dt-based),
//  5. PhosphorResidual: no floor/cap; stored energy never rises with Ghost,
//     lowering Ghost never drops it instantly, and it fades fully to 0.
//  6. 2D Phosphor energy GL (readback): raise Ghost -> never brighter; burn
//     fades all the way to the Background Brightness plate (no floor).
//  7. Matrix GL face (Matrix Waterfall / Matrix Display, readback): Bright
//     changes live glyphs but never rescales hung residual; matrix energy
//     fades to 0; Burn x scales the deposit peak.
//  8. Number readout plate fade math reaches 0 (no 8-bit stall).
//  9. Asciiscope GPU face: programs link, draws, deposit = Bright x Burn,
//     Ghost decay only, fades to the Background Brightness plate (no floor).
// 10. Matrix faces: Background Brightness lifts the plate; float cells.
// Usage: node scripts/probe_ghost_decay.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof TraceWoscope !== "undefined" && typeof PhosphorResidual !== "undefined"
  && typeof nodeGraphSharedGlDevice === "function", null, { timeout: 120000 })
  .catch((e) => { console.log("load errors:", errors.slice(0, 5)); throw e; });
await page.waitForTimeout(1500);

const r = await page.evaluate(() => {
  const realNow = performance.now.bind(performance);
  let fake = 1000;
  performance.now = () => fake;
  const W = 128, H = 128;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c.getContext("2d", { willReadFrequently: true }); };
  // Dense sweep: brightAlong spreads a pass's light over its length, so one
  // long segment is dim; 400 short ones sum to a full beam.
  const line = []; for (let i = 0; i <= 400; i += 1) line.push({ x: 8 + i * ((W - 16) / 400), y: H / 2 });
  const opts = (ghost) => ({
    brightAlong: true, size: 10, faceMinSide: 96, intensity: 1, burnAmount: 1,
    trail: 0, ghost, plateBrightness: 0,
    sampleRgb: (t) => [t * 255, t * 255, t * 255], lutKey: "probe-gray",
  });
  const read = (ctx) => {
    const d = ctx.getImageData(0, 0, W, H).data;
    const px = new Float64Array(W * H);
    for (let i = 0; i < W * H; i += 1) px[i] = d[i * 4];
    return px;
  };
  const mean = (px) => { let s = 0, n = 0; for (let x = 24; x < W - 24; x += 1) { s += px[(H / 2) * W + x]; n += 1; } return s / n; };
  const maxRise = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 1) m = Math.max(m, b[i] - a[i]); return m; };
  const frame = (ctx, pts, ghost, dtMs) => { fake += dtMs; TraceWoscope.draw(ctx, pts, opts(ghost)); return read(ctx); };
  const out = {};
  try {
    // 1+2: burn then raise Ghost mid-hang.
    const a = mk();
    frame(a, line, 0.2, 16.67);
    frame(a, line, 0.2, 16.67);
    let prev = frame(a, [], 0.2, 16.67);
    out.burnMean = mean(prev);
    const lowSeries = [mean(prev)];
    for (let i = 0; i < 4; i += 1) { prev = frame(a, [], 0.2, 16.67); lowSeries.push(mean(prev)); }
    let rise = 0; const highSeries = [mean(prev)];
    for (let i = 0; i < 6; i += 1) {
      const cur = frame(a, [], 0.9, 16.67);
      rise = Math.max(rise, maxRise(prev, cur));
      prev = cur; highSeries.push(mean(cur));
    }
    // and back down: lowering Ghost may only speed the fade.
    for (let i = 0; i < 4; i += 1) { const cur = frame(a, [], 0.05, 16.67); rise = Math.max(rise, maxRise(prev, cur)); prev = cur; }
    out.lowSeries = lowSeries; out.highSeries = highSeries; out.maxRise = rise;
    const ratio = (s) => s[s.length - 1] / Math.max(1e-6, s[0]);
    out.lowKeep = Math.pow(ratio(lowSeries), 1 / (lowSeries.length - 1));
    out.highKeep = Math.pow(ratio(highSeries), 1 / (highSeries.length - 1));
    // 4: same 400 ms at 60 fps vs 30 fps.
    const run = (dt) => {
      const c = mk();
      frame(c, line, 0.5, dt); frame(c, line, 0.5, dt);
      const start = mean(frame(c, [], 0.5, dt));
      const n = Math.round(400 / dt);
      let px = null;
      for (let i = 0; i < n; i += 1) px = frame(c, [], 0.5, dt);
      return { start, end: mean(px) };
    };
    out.fps60 = run(1000 / 60); out.fps30 = run(1000 / 30);
  } finally {
    performance.now = realNow;
  }
  // 5: shared model (no floor, decay only).
  const R = PhosphorResidual;
  out.noFloorApi = !("GHOST_FLOOR" in R) && !("ghostCap" in R.residualKeeps(0.3, 0.5));
  let e = 0.9; let up = 0; let worstDrop = 1;
  for (let i = 0; i < 40; i += 1) {
    const g = i < 20 ? 0.1 + i * 0.04 : 0.9 - (i - 20) * 0.04;
    const n = R.applyResidual(e, 0.3, g);
    up = Math.max(up, n - e);
    // A step may never cut more than the Trail (fastest) rate allows.
    worstDrop = Math.min(worstDrop, (n / e) / R.trailKeep(0.3));
    e = n;
  }
  out.residualRise = up; out.residualWorstDrop = worstDrop;
  let z = 1; for (let i = 0; i < 60 * 600; i += 1) z = R.applyResidual(z, 0.3, 1);
  out.residualAfter10min = z;
  out.freeze = R.applyResidual(0.4, 1, 0.8) === 0.4;

  // 6: 2D Phosphor energy GL.
  try {
    fake = 5000; performance.now = () => fake;
    const W2 = 96, H2 = 96;
    const host = document.createElement("canvas"); host.width = W2; host.height = H2;
    const r = nodeGraphPhosphorEnergyGlEnsure(host, W2, H2, "_probeEnergy");
    const outC = document.createElement("canvas"); outC.width = W2; outC.height = H2;
    const octx = outC.getContext("2d", { willReadFrequently: true });
    const path = []; for (let i = 0; i <= 200; i += 1) path.push({ x: 10 + i * 0.38, y: H2 / 2 });
    const plate = 0.2;
    const shot = () => {
      nodeGraphPhosphorEnergyGlPresent(r, 1, { scope2dOpaque: true, plate });
      nodeGraphSharedGlBlitTo2D(octx, W2, H2);
      const d = octx.getImageData(0, 0, W2, H2).data;
      const lum = (x, y) => { const o = (y * W2 + x) * 4; return d[o] + d[o + 1] + d[o + 2]; };
      let line = 0; for (let x = 20; x < 76; x += 1) line += lum(x, H2 / 2);
      return { line: line / 56, bg: lum(5, 5), px: Array.from({ length: 56 }, (_, i) => lum(20 + i, H2 / 2)) };
    };
    const step = (ghost, deposit) => {
      fake += 16.67;
      nodeGraphPhosphorEnergyGlStepBeams(r, { trail: 0.3, ghost, pathPoints: deposit ? path : [], radius: 3, brightness: deposit ? 1 : 0, blur: 0.3, mode: "segments", bleed: 0 });
    };
    for (let i = 0; i < 4; i += 1) step(0.3, true);
    let prev = shot(); const startLine = prev.line; let rise = 0;
    for (let i = 0; i < 30; i += 1) {
      step(i < 10 ? 0.3 : (i < 20 ? 0.95 : 0.05), false);
      const cur = shot();
      for (let k = 0; k < cur.px.length; k += 1) rise = Math.max(rise, cur.px[k] - prev.px[k]);
      prev = cur;
    }
    for (let i = 0; i < 1800; i += 1) step(0.3, false);
    const end = shot();
    out.energy = { startLine, maxRise: rise, endLine: end.line, bg: end.bg };
  } catch (err) { out.energyErr = String(err && err.stack || err); }

  // 7: Matrix GL face.
  try {
    const cols = 8, rows = 4, n = cols * rows;
    const ramp = typeof MATRIX_GLYPH_RAMP === "string" ? MATRIX_GLYPH_RAMP : "#";
    const ch = ramp.charAt(ramp.length - 1) || "#";
    const st = { columns: cols, rows, live: new Array(n).fill(" "), residual: new Array(n).fill(" "), energy: new Float32Array(n), tip: new Uint8Array(n) };
    for (let i = 0; i < cols; i += 1) { st.residual[i] = ch; st.energy[i] = 0.8; }   // row 0 = hung residual
    for (let i = 2 * cols; i < 3 * cols; i += 1) { st.live[i] = ch; }               // row 2 = live glyphs
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;left:0;top:0;width:256px;height:128px"; document.body.appendChild(cv);
    const measure = (bright) => {
      matrixDrawFace(cv, st, { brightness: bright, trail: 0.5, ghost: 0.5 }, 0);
      const c2 = cv.getContext("2d"); const W3 = cv.width, H3 = cv.height;
      const d = c2.getImageData(0, 0, W3, H3).data;
      const band = (r0) => { let sum = 0; const y0 = Math.floor(r0 * H3 / rows), y1 = Math.floor((r0 + 1) * H3 / rows);
        for (let y = y0; y < y1; y += 1) for (let x = 0; x < W3; x += 1) { const o = (y * W3 + x) * 4; sum += d[o] + d[o + 1] + d[o + 2]; } return sum; };
      return { residual: band(0), live: band(2), w: W3, h: H3 };
    };
    const hi = measure(1), lo = measure(0.3);
    cv.remove();
    const st2 = { energy: new Float32Array([1, 0.5, 0.1]) };
    let up2 = 0;
    for (let i = 0; i < 60 * 300; i += 1) {
      const before = Array.from(st2.energy);
      matrixDecayEnergy(st2, { trail: 0.5, ghost: i < 600 ? 0.2 : 0.95 }, 1 / 60);
      for (let k = 0; k < 3; k += 1) up2 = Math.max(up2, st2.energy[k] - before[k]);
    }
    out.matrix = { hi, lo, rise: up2, after5min: Math.max(...st2.energy),
      peakB05x1: matrixPhosphorDepositPeak({ brightness: 0.5, burnAmount: 1 }),
      peakB05x2: matrixPhosphorDepositPeak({ brightness: 0.5, burnAmount: 2 }),
      peakB1x2: Math.min(1, matrixPhosphorDepositPeak({ brightness: 1, burnAmount: 2 })) };
  } catch (err) { out.matrixErr = String(err && err.stack || err); }

  // 9: Asciiscope GPU face (real GPU, float energy readback + presented pixels).
  try {
    const gl = nodeGraphSharedGlDevice().gl;
    out.ascii = { link: Boolean(matrixDisplayGlSharedFor(gl)) };
    const id = "probe-ascii";
    const N = 512;
    const xs = new Float32Array(N), ys = new Float32Array(N);
    for (let i = 0; i < N; i += 1) { xs[i] = 0.8 * Math.cos(i / N * Math.PI * 2); ys[i] = 0.8 * Math.sin(i / N * Math.PI * 2); }
    let abs = 0;
    const bufs = nodeGraphModuleScopeState.buffers;
    bufs.set(`${id}:X`, xs); bufs.set(`${id}:Y`, ys);
    const feed = (fresh) => { if (fresh) abs += N; xs.nodeGraphScopeAbsoluteFrame = abs; ys.nodeGraphScopeAbsoluteFrame = abs; };
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:240px;height:160px";
    const cv = document.createElement("canvas"); cv.className = "node-matrix-display-canvas";
    cv.style.cssText = "width:100%;height:100%"; host.appendChild(cv); document.body.appendChild(host);
    const P = (o) => ({ density: 0.5, trail: 0.5, ghost: 0.5, brightness: 1, burnAmount: 1, backgroundBrightness: 0, freeze: false, ...o });
    const ramp = " .:-=+*#%@";
    const energy = () => {
      const st = matrixDisplayGpuStates.get(id);
      const px = new Float32Array(st.cols * st.rows * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.read.fbo);
      gl.readPixels(0, 0, st.cols, st.rows, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const e = new Float32Array(st.cols * st.rows);
      for (let i = 0; i < e.length; i += 1) e[i] = px[i * 4];
      return e;
    };
    const max = (a) => { let m = 0; for (const v of a) m = Math.max(m, v); return m; };
    const pixels = () => { const c = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data; return c; };
    const lumStats = (d) => { let mx = 0, mn = 1e9, s = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; mx = Math.max(mx, l); mn = Math.min(mn, l); s += l; } return { mx, mn, mean: s / (d.length / 4) }; };
    const draw = (o, fresh, dt = 16.67) => { fake += dt; feed(fresh); return matrixDisplayDrawFace(cv, id, ramp, P(o)); };
    out.ascii.drew = draw({ brightness: 0.5, burnAmount: 1 }, true);
    out.ascii.label = matrixDisplayGpuStates.get(id)?.read?.label;
    out.ascii.peakB05 = max(energy());
    out.ascii.firstFrame = lumStats(pixels());
    matrixDisplayClearTrails(id);
    draw({ brightness: 0.5, burnAmount: 2 }, true);
    out.ascii.peakB05x2 = max(energy());
    matrixDisplayClearTrails(id);
    draw({ brightness: 0.002, burnAmount: 1 }, true);
    out.ascii.peakTiny = max(energy());
    // Ghost is decay only: raise / lower Ghost mid-hang, never a rise.
    matrixDisplayClearTrails(id);
    draw({}, true);
    let prev = energy(); let rise = 0; const series = [max(prev)];
    for (let i = 0; i < 30; i += 1) {
      const g = i < 10 ? 0.2 : (i < 20 ? 0.95 : 0.05);
      draw({ ghost: g }, false);
      const cur = energy();
      for (let k = 0; k < cur.length; k += 1) rise = Math.max(rise, cur[k] - prev[k]);
      prev = cur; series.push(max(cur));
    }
    out.ascii.rise = rise;
    out.ascii.keepLow = Math.pow(series[10] / series[0], 1 / 10);
    out.ascii.keepHigh = Math.pow(series[20] / series[10], 1 / 10);
    // Fades fully: long hang (Ghost 0.9), 4-frame steps, then compare the
    // presented face to an empty face at the same Background Brightness.
    const e0 = max(energy());
    for (let i = 0; i < 5000; i += 1) draw({ ghost: 0.7, backgroundBrightness: 0.3 }, false, 66.7);
    out.ascii.after = max(energy());
    // Same curve as the shared CPU model (PhosphorResidual.applyResidual).
    let cpu = e0; for (let i = 0; i < 5000; i += 1) cpu = PhosphorResidual.applyResidual(cpu, 0.5, 0.7, 66.7 * 0.06);
    out.ascii.cpuAfter = cpu;
    out.ascii.fadedFace = lumStats(pixels());
    matrixDisplayClearTrails(id);
    draw({ backgroundBrightness: 0.3 }, false);
    out.ascii.emptyFace = lumStats(pixels());
    draw({ backgroundBrightness: 0 }, false);
    out.ascii.emptyFace0 = lumStats(pixels());
    host.remove();
    bufs.delete(`${id}:X`); bufs.delete(`${id}:Y`);
  } catch (err) { out.asciiErr = String(err && err.stack || err); }

  // 10: Background Brightness on the Matrix faces (Waterfall / Display GL).
  try {
    const cols = 8, rows = 4, n = cols * rows;
    const ramp = typeof MATRIX_GLYPH_RAMP === "string" ? MATRIX_GLYPH_RAMP : "#";
    const ch = ramp.charAt(ramp.length - 1) || "#";
    const st = { columns: cols, rows, live: new Array(n).fill(" "), residual: new Array(n).fill(" "), energy: new Float32Array(n), tip: new Uint8Array(n) };
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;left:0;top:0;width:256px;height:128px"; document.body.appendChild(cv);
    const face = (bg) => {
      matrixDrawFace(cv, st, { brightness: 1, trail: 0.5, ghost: 0.5, backgroundBrightness: bg }, 0);
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let mx = 0, mn = 1e9, s = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; mx = Math.max(mx, l); mn = Math.min(mn, l); s += l; }
      return { mx, mn, mean: s / (d.length / 4) };
    };
    out.matrixBg = { bg0: face(0), bg04: face(0.4), bg08: face(0.8) };
    // Float cells: a dim residual (energy 0.002, under 1/255) still shows.
    for (let i = 0; i < cols; i += 1) { st.residual[i] = ch; st.energy[i] = 0.002; }
    out.matrixBg.dim = face(0);
    cv.remove();
  } catch (err) { out.matrixBgErr = String(err && err.stack || err); }
  performance.now = realNow;

  // 8: number readout plate fade (rgba8 last-resort shader math).
  const fadeTo0 = (d, erase8, round) => { let n = 0; while (d > 0 && n < 5000) { const k = 255 - erase8; const nd = round ? Math.floor(d * k / 255 + 0.5) : Math.floor(d * k / 255); if (nd === d) return { stalledAt: d }; d = nd; n += 1; } return { frames: n }; };
  out.readout = { old: fadeTo0(200, 4, true), fixed: fadeTo0(200, 4, false) };
  const fs = typeof NODE_GRAPH_NUMBER_READOUT_PLATE_FS === "string" ? NODE_GRAPH_NUMBER_READOUT_PLATE_FS : "";
  out.readoutShaderFixed = /pow\(mix\(uKeepSlow, uKeepFast, pow\(clamp\(t\.a, 0\.0, 1\.0\), 12\.0\)\), uFrames\)/.test(fs)
    && /floor\(floor\(t \* 255\.0 \+ 0\.5\) \* k\) \/ 255\.0/.test(fs);
  return out;
});
console.log(JSON.stringify(r));
gate(r.burnMean > 40, `burn deposited on Ghost layer (mean ${r.burnMean.toFixed(1)})`);
gate(r.maxRise <= 1, `raising/lowering Ghost never brightens any stored pixel (max rise ${r.maxRise})`);
gate(r.highKeep > r.lowKeep + 0.02, `fade slower at Ghost 0.9 (keep/frame ${r.highKeep.toFixed(4)}) than 0.2 (${r.lowKeep.toFixed(4)})`);
const f60 = r.fps60.end / r.fps60.start, f30 = r.fps30.end / r.fps30.start;
gate(Math.abs(f60 - f30) < 0.06, `same fade over 400 ms at 60 fps (${f60.toFixed(3)}) and 30 fps (${f30.toFixed(3)})`);
gate(r.noFloorApi, "no fixed Ghost floor/cap in PhosphorResidual");
gate(r.residualRise <= 0, "applyResidual never raises stored energy while Ghost moves");
gate(r.residualWorstDrop >= 0.999, `lowering Ghost never cuts stored energy faster than the Trail rate (worst ${r.residualWorstDrop.toFixed(4)})`);
gate(r.residualAfter10min < 1e-3, `residual fades to 0 at Ghost 1 (left ${r.residualAfter10min.toExponential(2)} after 10 min)`);
gate(r.freeze, "Trail 1 still freezes");
if (r.energyErr) gate(false, `energy GL probe: ${r.energyErr}`); else {
  const E = r.energy;
  gate(E.startLine > E.bg + 30, `2D Phosphor burn deposited (line ${E.startLine.toFixed(0)} vs bg ${E.bg})`);
  gate(E.maxRise <= 3, `2D Phosphor: raising/lowering Ghost never brightens stored pixels (max rise ${E.maxRise})`);
  gate(Math.abs(E.endLine - E.bg) <= 3, `2D Phosphor: burn fades fully to Background Brightness plate (line ${E.endLine.toFixed(1)} vs bg ${E.bg})`);
}
if (r.matrixErr) gate(false, `matrix probe: ${r.matrixErr}`); else {
  const M = r.matrix;
  gate(M.hi.residual > 0 && Math.abs(M.hi.residual - M.lo.residual) <= M.hi.residual * 0.01, `Matrix: Bright 1 -> 0.3 leaves hung residual unchanged (${M.hi.residual} vs ${M.lo.residual})`);
  gate(M.lo.live < M.hi.live * 0.8, `Matrix: Bright still dims live glyphs (${M.hi.live} -> ${M.lo.live})`);
  gate(M.rise <= 0, "Matrix: raising Ghost never raises stored energy");
  gate(M.after5min < 1e-3, `Matrix: energy fades to 0 (max ${M.after5min.toExponential(2)} after 5 min)`);
  gate(M.peakB05x2 > M.peakB05x1, `Matrix: Burn x scales the deposit (${M.peakB05x1} -> ${M.peakB05x2})`);
  console.log(`info Matrix: Bright 1 x Burn 2 deposit peak clips to ${M.peakB1x2}`);
}
if (r.asciiErr) gate(false, `asciiscope probe: ${r.asciiErr}`); else {
  const A = r.ascii;
  gate(A.link, "Asciiscope: GL programs link (point / step / present)");
  gate(A.drew === true && A.firstFrame.mx > A.firstFrame.mn + 30, `Asciiscope: draws on GPU (${A.label}; lum ${A.firstFrame.mn}..${A.firstFrame.mx})`);
  gate(Math.abs(A.peakB05 - 0.5) < 1e-6 && Math.abs(A.peakB05x2 - 1) < 1e-6, `Asciiscope: deposit = Bright x Burn (0.5x1 -> ${A.peakB05}, 0.5x2 -> ${A.peakB05x2})`);
  gate(Math.abs(A.peakTiny - 0.002) < 1e-6, `Asciiscope: Bright 0.002 deposits exactly (${A.peakTiny}; no 8-bit floor)`);
  gate(A.rise <= 1e-7, `Asciiscope: raising/lowering Ghost never raises stored energy (max rise ${A.rise})`);
  gate(A.keepHigh > A.keepLow, `Asciiscope: Ghost sets decay only (keep/frame 0.2 -> ${A.keepLow.toFixed(4)}, 0.95 -> ${A.keepHigh.toFixed(4)})`);
  gate(A.after < 1e-4, `Asciiscope: energy fades to 0, no floor (max ${A.after.toExponential(2)} after 20000 frames, Ghost 0.7)`);
  gate(Math.abs(A.after - A.cpuAfter) <= Math.max(1e-7, A.cpuAfter * 0.05), `Asciiscope: GPU decay matches PhosphorResidual (${A.after.toExponential(2)} vs ${A.cpuAfter.toExponential(2)})`);
  gate(Math.abs(A.fadedFace.mean - A.emptyFace.mean) < 0.5 && A.fadedFace.mx - A.fadedFace.mn <= 3,
    `Asciiscope: faded face = Background Brightness plate (mean ${A.fadedFace.mean.toFixed(2)} vs empty ${A.emptyFace.mean.toFixed(2)})`);
  gate(A.emptyFace.mean > A.emptyFace0.mean + 20, `Asciiscope: Background Brightness lifts empty cells (${A.emptyFace0.mean.toFixed(1)} -> ${A.emptyFace.mean.toFixed(1)})`);
}
if (r.matrixBgErr) gate(false, `matrix background probe: ${r.matrixBgErr}`); else {
  const B = r.matrixBg;
  gate(B.bg04.mean > B.bg0.mean + 20 && B.bg08.mean > B.bg04.mean + 20, `Matrix: Background Brightness lifts the plate (${B.bg0.mean.toFixed(1)} -> ${B.bg04.mean.toFixed(1)} -> ${B.bg08.mean.toFixed(1)})`);
  gate(B.bg04.mx - B.bg04.mn <= 3, "Matrix: empty face is one uniform background level");
  gate(B.dim.mx > B.bg0.mx, `Matrix: residual under 1/255 still shows (float cells; max ${B.bg0.mx} -> ${B.dim.mx})`);
}
gate(r.readout.old.stalledAt > 0 && r.readout.fixed.frames > 0, `Number readout: old rounding stalls at ${r.readout.old.stalledAt}/255; fixed reaches 0 in ${r.readout.fixed.frames} frames`);
gate(r.readoutShaderFixed, "Number readout plate shader: shared residual model; rgba8 last resort rounds toward 0");
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
