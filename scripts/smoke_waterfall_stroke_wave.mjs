// Smoke: Instant Waterfall Stroke = draw the waveform (both peaks), not a
// one-sided upper/lower edge. Loads node-graph-module-scope-waterfall.js in a vm.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN };
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8"), ctx);
const H = 100;
const acc = ctx.nodeGraphWaterfallAccMake();
// One column of a sine: rises to +0.8 first, then down to -0.6, ends at -0.2.
const buf = new Float32Array([0, 0.5, 0.8, 0.3, -0.6, -0.2]);
ctx.nodeGraphWaterfallAccPush(acc, buf, 0, buf.length, {}, null);
gate(acc.maxAt === 2 && acc.minAt === 4 && Math.abs(acc.last - -0.2) < 1e-6, "accumulator keeps peak order and last sample");
const raw = ctx.nodeGraphWaterfallWaveRaw(acc, {});
gate(raw.length === 3 && Math.abs(raw[0] - 0.8) < 1e-6 && Math.abs(raw[1] + 0.6) < 1e-6 && Math.abs(raw[2] + 0.2) < 1e-6,
  `wave points in time order: max, min, last (${raw.map((v) => v.toFixed(2)).join(", ")})`);
const ys = ctx.nodeGraphWaterfallWaveYs(acc, buf, null, {}, H);
gate(Math.min(...ys) < H / 2 && Math.max(...ys) > H / 2, "stroke spans both the top AND bottom of the signal (not top-only)");
// Stroke run: previous frame's tail -> each column's peaks -> last.
const drawn = [];
ctx.nodeGraphOnsetGlStrokePolyline = (_c, pts, _w, _rgb, clip) => { drawn.push({ pts: pts.map((p) => [p.x, p.y]), clip }); return true; };
ctx.nodeGraphOnsetStrokeCanvasPx = () => 1;
const bag = {};
ctx.nodeGraphWaterfallStrokeWaveRun({}, bag, "L", [{ x: 10, ys }], {}, null, 10);
ctx.nodeGraphWaterfallStrokeWaveRun({}, bag, "L", [{ x: 11, ys: [40, 60] }], {}, null, 11);
gate(drawn.length === 2 && drawn[1].pts.some((q) => q[0] === 11 && q[1] === ys[ys.length - 1]) && drawn[1].clip === 11,
  "next frame continues from the previous column's last sample (one continuous waveform), clipped to the new strip");
{
  const xs = drawn[0].pts.map((q) => q[0]);
  gate(xs.length === ys.length + 1 && xs[0] === 10 && xs[xs.length - 1] === 11 && xs.every((v, i) => i === 0 || v > xs[i - 1]),
    "a column's peaks are spread across its width in time order (no vertical spike per column)");
}
ctx.nodeGraphWaterfallStrokeWaveRun({}, bag, "L", [{ x: 12, ys: null }, { x: 13, ys: [50] }], {}, null, 12);
gate(drawn[drawn.length - 1].pts[0][0] === 13, "a column without signal breaks the line");
// Absolute polarity folds a zero crossing between the peaks.
const absRaw = ctx.nodeGraphWaterfallWaveRaw(acc, { polarity: "absolute" });
gate(absRaw.length === 4 && absRaw[1] === 0, "absolute polarity: line passes through 0 between opposite-sign peaks");
// Per-channel stroke colors (two-channel faces: Left/Right, Sidechain Dry/Wet).
{
  const rgbOf = (hex) => JSON.stringify(ctx.nodeGraphWaterfallParseInkRgb(hex));
  const colors = [];
  ctx.nodeGraphOnsetGlStrokePolyline = (_c, _pts, _px, rgb) => { colors.push(JSON.stringify(rgb)); return true; };
  const b2 = {};
  ctx.nodeGraphWaterfallStrokeWaveRun({}, b2, "L", [{ x: 1, ys: [40, 60] }], { strokeColor: "#ffffff" }, "#ff8000", 1);
  ctx.nodeGraphWaterfallStrokeWaveRun({}, b2, "R", [{ x: 1, ys: [40, 60] }], { strokeColor: "#ffffff" }, null, 1);
  gate(colors[0] === rgbOf("#ff8000") && colors[1] === rgbOf("#ffffff"), "channel stroke color wins; missing falls back to the shared Stroke");
  const stereo = { stereoBuffers: { left: new Float32Array(4), right: new Float32Array(4) } };
  const both = ctx.nodeGraphWaterfallChannelList(stereo, { strokeColor: "#aaaaaa", strokeLeftColor: "#ff0000", strokeRightColor: "#00ff00" });
  gate(both.length === 2 && both[0].strokeColor === "#ff0000" && both[1].strokeColor === "#00ff00", "stereo channels carry Left / Right stroke colors");
  const old = ctx.nodeGraphWaterfallChannelList(stereo, { strokeColor: "#aaaaaa" });
  gate(old[0].strokeColor === "#aaaaaa" && old[1].strokeColor === "#aaaaaa", "old patch (no per-channel strokes): both use the shared Stroke");
  const mono = ctx.nodeGraphWaterfallChannelList({ buffer: new Float32Array(4) }, { strokeColor: "#aaaaaa", strokeLeftColor: "#ff0000" });
  gate(mono.length === 1 && !mono[0].strokeColor, "single-channel waterfall keeps its one Stroke color");
  const src = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
  const norm = src("node-graph-module-scope-normalize.js");
  gate(/strokeLeftColor: normalizeNodeGraphTraceDisplayColor\(\s*source\.strokeLeftColor,\s*normalizeNodeGraphTraceDisplayColor\(source\.strokeColor/.test(norm)
    && /strokeRightColor: normalizeNodeGraphTraceDisplayColor\(\s*source\.strokeRightColor,\s*normalizeNodeGraphTraceDisplayColor\(source\.strokeColor/.test(norm),
    "normalize: missing per-channel strokes default to the saved Stroke color");
  const io = src("node-graph-module-scope-settings-form-io.js");
  gate(/field === "strokeLeftColor" \|\| field === "strokeRightColor"[\s\S]{0,600}stereoWaterfallLabels\?\.\[side\][\s\S]{0,120}\} stroke`/.test(io), "labels: Left stroke / Right stroke, Dry stroke / Wet stroke via stereoWaterfallLabels");
  const form = src("node-graph-module-scope-settings-form.js");
  gate(/BuildColorRowHtml\("strokeLeftColor", type\),\s*nodeGraphDisplaySettingsBuildColorRowHtml\("strokeRightColor", type\)/.test(form), "stereo waterfall form: two stroke HBS widgets");
}
// Sidechain Dry / Wet Gain strokes: realistic duck sequences (relative gains,
// 1 = rest = middle). Regression: a raw-0 column (Wet fully ducked) counted
// as silent, so no fill AND no stroke; values past 2x rest left the canvas.
{
  ctx.nodeGraphModuleSelectedDisplayMode = () => ({ key: "gains" });
  const H = 64, strokeW = 2, inset = strokeW / 2;
  ctx.nodeGraphOnsetStrokeCanvasPx = () => strokeW;
  const lines = { D: [], W: [] };
  let cur = null;
  // Keep only what lands in the new strip (the tail before it is clipped).
  ctx.nodeGraphOnsetGlStrokePolyline = (_c, pts, _w, _rgb, clip) => { lines[cur].push(pts.filter((q) => q.x >= clip).map((q) => ({ x: q.x, y: q.y }))); return true; };
  const slot = { type: "sidechain" };
  const canvas = { height: H };
  const run = (mix, ducked, label) => {
    lines.D = []; lines.W = [];
    const bag = {};
    // env: 0 idle, sudden onset to 1, hold, slow release back to 0.
    const env = [];
    for (let i = 0; i < 40; i++) env.push(0);
    for (let i = 0; i < 40; i++) env.push(1);
    for (let i = 0; i < 400; i++) env.push(Math.exp(-i / 80));
    const rel = (g, rest) => (rest < 1e-6 ? (g > 1e-6 ? 2 : 1) : g / rest);
    const dry = [], wet = [];
    for (const e of env) { const m = mix + (ducked - mix) * e; dry.push(rel(1 - m, 1 - mix)); wet.push(rel(m, mix)); }
    const per = 4, cols = env.length / per;
    for (let c = 0; c < cols; c++) {
      for (const [key, sig] of [["D", dry], ["W", wet]]) {
        const acc = ctx.nodeGraphWaterfallAccMake();
        ctx.nodeGraphWaterfallAccPush(acc, Float32Array.from(sig), c * per, (c + 1) * per, {}, slot);
        const ys = ctx.nodeGraphWaterfallWaveYs(acc, null, slot, {}, H);
        cur = key;
        ctx.nodeGraphWaterfallStrokeWaveRun(canvas, bag, key, [{ x: c, ys }], {}, null, c);
      }
    }
    const ok = (arr) => arr.length === cols
      && arr.every((pl) => pl.every((q) => q.y >= inset - 1e-9 && q.y <= H - inset + 1e-9))
      && arr.every((pl, i) => i === 0 || (pl[0].x === arr[i - 1][arr[i - 1].length - 1].x && pl[0].y === arr[i - 1][arr[i - 1].length - 1].y));
    gate(ok(lines.D) && ok(lines.W), `${label}: Dry and Wet stroke every column, inside the panel, continuous per channel`);
    return { cols, lines: { D: lines.D.slice(), W: lines.W.slice() } };
  };
  const a = run(0.35, 0, "Mix 0.35 / Ducked 0");
  const ys = (pl) => pl.map((q) => q.y);
  gate(ys(a.lines.W[0]).every((y) => Math.abs(y - H / 2) < 1e-9) && ys(a.lines.D[0]).every((y) => Math.abs(y - H / 2) < 1e-9), "idle: both lines rest at the middle");
  gate(ys(a.lines.W[12]).every((y) => Math.abs(y - (H - inset)) < 1e-9), "full duck: Wet (raw 0) still stroked, on the bottom edge");
  gate(a.lines.W[10].some((y) => true) && Math.max(...ys(a.lines.W[10])) - Math.min(...ys(a.lines.W[10])) > H * 0.4, "sudden onset: vertical jump drawn inside one segment");
  gate(Math.min(...ys(a.lines.D[12])) < H / 2 && Math.min(...ys(a.lines.D[12])) >= inset, "full duck: Dry rises above the middle (1.54x rest)");
  const m0 = run(0, 0.5, "Mix 0 / Ducked 0.5 (wet rest 0 -> top)");
  gate(ys(m0.lines.W[12]).every((y) => Math.abs(y - inset) < 1e-9), "rest-0 'top' case rides the top edge, visible");
  const m1 = run(1, 0, "Mix 1 / Ducked 0 (dry rest 0 -> top, wet -> bottom)");
  gate(ys(m1.lines.D[12]).every((y) => Math.abs(y - inset) < 1e-9) && ys(m1.lines.W[12]).every((y) => Math.abs(y - (H - inset)) < 1e-9), "Mix 1 full duck: Dry at the top edge, Wet at the bottom edge");
  const wfSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8");
  const strokeFirst = wfSrc.match(/if \(useStroke\) \{\s*const run = strokeCols\[span\.key\][\s\S]{0,200}?\}\s*const ys = span\.ys;\s*if \(!ys\) continue;/g) || [];
  // Onset no longer uses this column stroke. It draws one sample-accurate line.
  gate(strokeFirst.length === 1, `waterfall column path collects the stroke before the fill's silent-column skip (${strokeFirst.length}/1)`);
}
// Sub-pixel frames (advance < 1 px, e.g. long History at 60 fps): their
// samples must reach the next column. Regression: SmoothAdvance reset the
// carried accumulator, so short Dry Gain rises inside those frames vanished
// and the stroke top was skipped intermittently.
{
  const W = 120, H = 60, N = 8192;
  let grid = Array.from({ length: W }, () => new Array(H).fill(0));
  ctx.nodeGraphWaterfallEnsureHold = () => ({ getContext: () => ({}) });
  ctx.nodeGraphWaterfallPresentHold = () => {};
  ctx.nodeGraphWaterfallStampColumnFills = () => {};
  ctx.nodeGraphWaterfallGlScroll = (_c, px) => { grid = grid.map((_, x) => (x + px < W ? grid[x + px] : new Array(H).fill(0))); };
  ctx.nodeGraphWaterfallGlClearColumn = (_c, x, w = 1) => { for (let i = x; i < Math.min(W, x + w); i++) grid[i] = new Array(H).fill(0); };
  ctx.nodeGraphOnsetStrokeCanvasPx = () => 1;
  ctx.nodeGraphOnsetGlStrokePolyline = (_c, pts, _w, rgb, clip = 0) => {
    const bit = rgb[0] > rgb[2] ? 1 : 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], q = pts[i], n = Math.ceil(Math.hypot(q.x - a.x, q.y - a.y) * 4) + 1;
      for (let k = 0; k <= n; k++) { const x = Math.floor(a.x + (q.x - a.x) * k / n), y = Math.floor(a.y + (q.y - a.y) * k / n); if (x >= clip && x < W && y >= 0 && y < H) grid[x][y] |= bit; }
    }
  };
  ctx.nodeGraphModuleSelectedDisplayMode = () => ({ key: "gains" });
  const settings = { barInk: "stroke", strokeLeftColor: "#ff0000", strokeRightColor: "#0000ff" };
  const total = 300000, dry = new Float32Array(total), wet = new Float32Array(total);
  // Short duck bursts (200 samples) every 3000 (< one 3333-sample column): Dry jumps to 1.5x rest, Wet to 0.
  for (let i = 0; i < total; i++) { const on = (i % 3000) < 200; dry[i] = on ? 1.5 : 1; wet[i] = on ? 0 : 1; }
  const faceSamples = 400000;  // ~0.25 px per 800-sample frame -> mostly sub-pixel frames
  const canvas = { width: W, height: H, _waterfall: {} };
  let pos = N, carryPx = 0, carrySamples = 0, colPx = 0; const barAcc = Object.create(null);
  while (pos + 800 < total) {
    const k = 800; pos += k;
    carryPx += k / faceSamples * W; const move = Math.floor(carryPx + 1e-6); carryPx -= move;
    if (move < 1) { carrySamples += k; continue; }
    const L = dry.slice(pos - N, pos), R = wet.slice(pos - N, pos);
    colPx = ctx.nodeGraphWaterfallSmoothAdvance(null, canvas, { slot: { type: "sidechain" }, settings, buffer: L, stereoBuffers: { left: L, right: R } },
      { advancePx: move, barPx: 1, sampleStart: N - k - carrySamples, sampleEnd: N, colPx, barAcc });
    carrySamples = 0;
  }
  const yTop = Math.floor(H / 2 - 0.5 * H / 2);
  let dryCols = 0, wetCols = 0, drawn = 0;
  for (let x = 0; x < W; x++) { if (grid[x].some((v) => v)) drawn++; if (grid[x][yTop] & 1) dryCols++; if (grid[x][H - 1] & 2) wetCols++; }
  gate(drawn > 10 && dryCols === drawn && wetCols === drawn, `carried sub-pixel samples: every drawn column shows the Dry top and Wet bottom (${dryCols}/${wetCols}/${drawn})`);
  const wfSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8");
  gate(/st\.carrySamples = nodeGraphFiniteNumber\(st\.carrySamples\) \+/.test(wfSrc) && /sampleStart = Math\.max\(0, sampleStart - Math\.floor\(st\.carrySamples\)\)/.test(wfSrc),
    "Paint carries sub-pixel frame samples into the next column's window");
}
// Held steps (Pi Noise, smoothing Hold) on a stereo face: every column that
// sits inside a hold must show the held level (flat tops included), for both
// channels, fill on and off, frames advancing 1..4 px. Regression: after the
// plate scrolled, the last stroke point kept its old x, so the next column's
// connector (the held flat) started paintPx too far right and later column
// clears erased it: flat tops vanished at frame boundaries.
{
  const W = 160, H = 64, N = 16384;
  let grid;
  ctx.nodeGraphWaterfallGlScroll = (_c, px) => { grid = grid.map((_, x) => (x + px < W ? grid[x + px] : new Array(H).fill(0))); };
  ctx.nodeGraphWaterfallGlClearColumn = (_c, x, w = 1) => { for (let i = x; i < Math.min(W, x + w); i++) grid[i] = new Array(H).fill(0); };
  ctx.nodeGraphWaterfallGlStampBar = (_c, x, _w, ys, _p, _cn, _rgb, blend) => {
    for (let y = Math.max(0, Math.floor(Math.min(ys.y0, ys.y1))); y < Math.min(H, Math.ceil(Math.max(ys.y0, ys.y1))); y++) grid[x][y] = blend === "source-over" ? 4 : (grid[x][y] | 8);
    return true;
  };
  ctx.nodeGraphOnsetGlStrokePolyline = (_c, pts, _w, rgb, clip = 0) => {
    const bit = rgb[0] > rgb[2] ? 1 : 2;
    // The line is continuous: every step moves right by at most one column
    // (a stale tail after a scroll would jump or step backwards).
    for (let i = 1; i < pts.length; i++) { connectors++; const d = pts[i].x - pts[i - 1].x; if (d < 0 || d > 1 + 1e-9) badConnectors++; }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], q = pts[i], n = Math.ceil(Math.hypot(q.x - a.x, q.y - a.y) * 4) + 1;
      for (let k = 0; k <= n; k++) { const x = Math.floor(a.x + (q.x - a.x) * k / n), y = Math.floor(a.y + (q.y - a.y) * k / n); if (x >= clip && x < W && y >= 0 && y < H) grid[x][y] |= bit; }
    }
  };
  let connectors = 0, badConnectors = 0;
  delete ctx.nodeGraphWaterfallStampColumnFills;
  vm.runInContext("nodeGraphWaterfallStampColumnFills = nodeGraphWaterfallStampColumnFills;", ctx);
  ctx.nodeGraphModuleSelectedDisplayMode = () => ({ key: "gains" });
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const total = 600000, left = new Float32Array(total), right = new Float32Array(total);
  for (const sig of [left, right]) { let i = 0; while (i < total) { const v = rnd() * 1.6 - 0.8, len = 3000 + Math.floor(rnd() * 9000); for (let j = 0; j < len && i < total; j++, i++) sig[i] = v; } }
  const yOf = (v) => H / 2 - v * H / 2;
  for (const barInk of ["stroke", "both"]) {
    for (const faceSamples of [160000, 480000]) {
      for (const frame of [700, 2500]) {
        grid = Array.from({ length: W }, () => new Array(H).fill(0));
        const settings = { barInk, blendMode: "lighter", strokeLeftColor: "#ff0000", strokeRightColor: "#0000ff" };
        const canvas = { width: W, height: H, _waterfall: {} };
        let pos = N, carryPx = 0, carry = 0, colPx = 0, lastPos = pos; const barAcc = Object.create(null);
        const colEnds = [];
        while (pos + frame < total) {
          pos += frame;
          carryPx += frame / faceSamples * W; const move = Math.floor(carryPx + 1e-6); carryPx -= move;
          if (move < 1) { carry += frame; continue; }
          const L = left.slice(pos - N, pos), R = right.slice(pos - N, pos);
          colPx = ctx.nodeGraphWaterfallSmoothAdvance(null, canvas, { slot: { type: "output" }, settings, buffer: L, stereoBuffers: { left: L, right: R } },
            { advancePx: move, barPx: 1, sampleStart: N - frame - carry, sampleEnd: N, colPx, barAcc });
          const span = frame + carry; carry = 0;
          for (let c = 0; c < move; c++) colEnds.push(pos - span + Math.round(span * (c + 1) / move));
          lastPos = pos;
        }
        // Map the last W column sample windows to screen x and check held levels.
        let checked = 0, missing = 0;
        const ends = colEnds.slice(-W);
        for (let x = 1; x < W - 1; x++) {
          const e0 = ends[x - 1], e1 = ends[x];
          for (const [sig, bit] of [[left, 1], [right, 2]]) {
            const v = sig[e0];
            let flat = true; for (let s = e0; s < e1 && flat; s++) if (sig[s] !== v) flat = false;
            if (!flat || sig[e0 - 1] !== v) continue;
            checked++;
            if (!(grid[x][Math.min(H - 1, Math.floor(yOf(v)))] & bit)) missing++;
          }
        }
        gate(connectors > 100 && badConnectors === 0, `held steps (${barInk}, history ${faceSamples}, frame ${frame}): the line steps right by at most one column, also after a multi-px scroll (${badConnectors} bad of ${connectors})`);
        connectors = 0; badConnectors = 0;
        gate(checked > 50 && missing === 0, `held steps (${barInk}, history ${faceSamples}, frame ${frame}): flat tops drawn in every held column (${missing} missing of ${checked})`);
      }
    }
  }
  const wfSrc2 = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8");
  gate(/strokeBag\.strokePts\[k\] = pts\.map\(\(q\) => \(\{ x: q\.x - paintPx, y: q\.y \}\)\)/.test(wfSrc2), "scroll moves the stored stroke points with the plate");
}
// Fixed z order: Right always over Left. Thick strokes reach past their
// column; stroked column by column (L, R, L, R ...) the next column's Left
// covered the previous column's Right where they cross. Every pixel the
// Right stroke covers must end Right, at every frame size.
{
  const W = 140, H = 60, N = 16384, R = 1;
  let main, rOnly;
  const blank = () => Array.from({ length: W }, () => new Array(H).fill(0));
  const shift = (g, px) => g.map((_, x) => (x + px < W ? g[x + px] : new Array(H).fill(0)));
  ctx.nodeGraphWaterfallGlScroll = (_c, px) => { main = shift(main, px); rOnly = shift(rOnly, px); };
  ctx.nodeGraphWaterfallGlClearColumn = (_c, x, w = 1) => { for (let i = x; i < Math.min(W, x + w); i++) { main[i] = new Array(H).fill(0); rOnly[i] = new Array(H).fill(0); } };
  ctx.nodeGraphWaterfallGlStampBar = () => true;
  ctx.nodeGraphOnsetStrokeCanvasPx = () => 2 * R + 1;
  ctx.nodeGraphOnsetGlStrokePolyline = (_c, pts, _w, rgb, clip = 0) => {
    const id = rgb[0] > rgb[2] ? 1 : 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], q = pts[i], n = Math.ceil(Math.hypot(q.x - a.x, q.y - a.y) * 4) + 1;
      for (let k = 0; k <= n; k++) {
        const cx = Math.floor(a.x + (q.x - a.x) * k / n), cy = Math.floor(a.y + (q.y - a.y) * k / n);
        for (let x = cx - R; x <= cx + R; x++) for (let y = cy - R; y <= cy + R; y++) {
          if (x < clip || x >= W || y < 0 || y >= H) continue;
          main[x][y] = id;  // source-over: the last stroke wins
          if (id === 2) rOnly[x][y] = 1;
        }
      }
    }
  };
  ctx.nodeGraphModuleSelectedDisplayMode = () => ({ key: "wave" });
  const total = 400000, left = new Float32Array(total), right = new Float32Array(total);
  for (let i = 0; i < total; i++) { left[i] = 0.8 * Math.sin(i / 900); right[i] = 0.5 * Math.sin(i / 640 + 1); }
  for (const frame of [600, 1500, 4000]) {
    main = blank(); rOnly = blank();
    const settings = { barInk: "stroke", blendMode: "lighter", strokeLeftColor: "#ff0000", strokeRightColor: "#0000ff" };
    const canvas = { width: W, height: H, _waterfall: {} };
    let pos = N, carryPx = 0, carry = 0, colPx = 0; const barAcc = Object.create(null);
    const faceSamples = 140000;
    while (pos + frame < total) {
      pos += frame;
      carryPx += frame / faceSamples * W; const move = Math.floor(carryPx + 1e-6); carryPx -= move;
      if (move < 1) { carry += frame; continue; }
      const L = left.slice(pos - N, pos), Rb = right.slice(pos - N, pos);
      colPx = ctx.nodeGraphWaterfallSmoothAdvance(null, canvas, { slot: { type: "output" }, settings, buffer: L, stereoBuffers: { left: L, right: Rb } },
        { advancePx: move, barPx: 1, sampleStart: N - frame - carry, sampleEnd: N, colPx, barAcc });
      carry = 0;
    }
    let rPx = 0, under = 0, both = 0;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (rOnly[x][y]) { rPx++; if (main[x][y] !== 2) under++; }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (main[x][y] === 1) both++;
    gate(rPx > 300 && both > 300 && under === 0, `L/R z order (frame ${frame}): Right on top of Left at every crossing (${under} of ${rPx} Right pixels under Left)`);
  }
}
console.log(failures ? `FAILED ${failures}` : "smoke_waterfall_stroke_wave ok");
if (failures) process.exit(1);
