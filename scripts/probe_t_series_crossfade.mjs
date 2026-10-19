// Probe: t2…t11 / 2t…11t crossfade face on a real GPU.
// Adds t3 + 5t to the softpop page, wires Analog/Digital, feeds the input
// rings, and reads the face back (GL face texture): playhead column and cell
// fill heights must match the gain law. Also: live path from rings, stopped =
// black, no GL failures, screenshot (big detached faces, same paint code) to
// scripts/out/t_series_crossfade.png.
// Usage: node scripts/probe_t_series_crossfade.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts", "out"); fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error" && /display-gl|crossfade|t-series/i.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof drawNodeGraphTSeriesCrossfadeFaceItem === "function"
  && typeof commitNodeGraphPatch === "function" && document.querySelector("article[data-node-type]"), null, { timeout: 120000 });
await page.waitForTimeout(2000);

const setup = await page.evaluate(() => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const add = (type, id, gx, gy) => { const n = createNodeGraphPatchNode(type, { id, gx, gy }); patch.nodes.push(n); return n; };
  const xs = Math.max(...patch.nodes.map((n) => Number(n.gx) || 0)) + 8;
  add("t3", "probeT3", xs, 2);
  add("5t", "probe5t", xs, 9);
  add("bias", "probeA", xs - 6, 2);
  add("bias", "probeD", xs - 6, 6);
  const out = nodeGraphPatchNodeOutputPorts(patch.nodes.find((n) => n.id === "probeA"))[0];
  for (const dst of ["probeT3", "probe5t"]) {
    patch.connections.push({ sourceNode: "probeA", sourcePort: out, destinationNode: dst, destinationPort: "Analog" });
    patch.connections.push({ sourceNode: "probeD", sourcePort: out, destinationNode: dst, destinationPort: "Digital" });
  }
  commitNodeGraphPatch(patch, { record: false, status: "probe" });
  return {
    renderers: ["t2", "t3", "t11", "2t", "5t", "11t", "t"].map((t) => nodeGraphModuleDisplayRendererForNode({ type: t })),
    visualSink: Boolean(nodeGraphModuleDefinitions.t3.visualSink && nodeGraphModuleDefinitions["5t"].visualSink),
  };
});
gate(setup.renderers.slice(0, 6).every((r) => r === "tSeriesFace") && setup.renderers[6] === "torchFace",
  `t2…t11 / 2t…11t use tSeriesFace, t keeps Torch (${setup.renderers.join(",")})`);
gate(setup.visualSink, "t3 / 5t are visual sinks (A/D input rings)");
await page.waitForTimeout(1500);
// Bring the probe modules into view.
await page.evaluate(() => document.querySelector('[data-node="probeT3"]')?.scrollIntoView?.({ block: "center", inline: "center" }));
await page.waitForTimeout(800);

// Read the face back for a set of states (forced engine-running paint).
const results = await page.evaluate(async () => {
  const realCold = window.scopePaintShouldColdBootFace;
  window.scopePaintShouldColdBootFace = () => false;
  const slotOf = (id) => nodeGraphVisibleModuleScopeSlots().find((s) => s.nodeId === id)
    || nodeGraphModuleScopeState?.slots?.get?.(id);
  const read = (canvas) => (typeof nodeGraphSharedGlFacePixels === "function" ? nodeGraphSharedGlFacePixels(canvas) : null);
  const scopeBuffers = nodeGraphModuleScopeState.buffers;
  const out = [];
  const cases = [
    { id: "probeT3", kind: "demux", last: 2, a: 0.25, d: null },
    { id: "probeT3", kind: "demux", last: 2, a: 0.8, d: null },
    { id: "probeT3", kind: "demux", last: 2, a: null, d: 1 },
    { id: "probe5t", kind: "mux", last: 4, a: 0, d: null },
    { id: "probe5t", kind: "mux", last: 4, a: -0.7, d: null },
    { id: "probe5t", kind: "mux", last: 4, a: 0.5, d: 2 },
  ];
  for (const c of cases) {
    const slot = slotOf(c.id);
    if (!slot) { out.push({ c, error: "no slot" }); continue; }
    // Live path: rings + patch wires -> gain law (no injected state).
    const prevA = scopeBuffers.get(`${c.id}:Analog`), prevD = scopeBuffers.get(`${c.id}:Digital`);
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.connections = patch.connections.filter((k) => !(k.destinationNode === c.id && ((k.destinationPort === "Analog" && c.a == null) || (k.destinationPort === "Digital" && c.d == null))));
    for (const [port, v] of [["Analog", c.a], ["Digital", c.d]]) {
      const has = patch.connections.some((k) => k.destinationNode === c.id && k.destinationPort === port);
      if (v != null && !has) patch.connections.push({ sourceNode: port === "Analog" ? "probeA" : "probeD", sourcePort: nodeGraphPatchNodeOutputPorts(patch.nodes.find((n) => n.id === "probeA"))[0], destinationNode: c.id, destinationPort: port });
    }
    commitNodeGraphPatch(patch, { record: false, status: "probe" });
    if (c.a != null) scopeBuffers.set(`${c.id}:Analog`, new Float32Array([0, c.a]));
    if (c.d != null) scopeBuffers.set(`${c.id}:Digital`, new Float32Array([0, c.d]));
    const s2 = slotOf(c.id) || slot;
    drawNodeGraphTSeriesCrossfadeFaceItem(null, { slot: s2, screenElement: s2.scopeElement }, nodeGraphDisplayCanvasPixelRatio());
    const face = s2.scopeElement;
    const canvas = face.querySelector(".node-t-series-crossfade-canvas");
    const pix = canvas ? read(canvas) : null;
    const st = face._tSeriesCrossfade;
    const want = nodeGraphTSeriesCrossfadeState(c.kind, c.last, { hasAnalog: c.a != null, analog: c.a ?? 0, hasDigital: c.d != null, digital: c.d ?? 0 });
    const m = face.getBoundingClientRect();
    const metrics = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(face) : null;
    out.push({
      c, liveGains: st?.gains, wantGains: want.gains, livePos: st?.position, wantPos: want.position,
      css: [metrics?.cssW, metrics?.cssH], w: pix?.width, h: pix?.height,
      data: pix ? Array.from(pix.data) : null,
    });
    void prevA; void prevD; void m;
  }
  // Stopped policy: real cold-boot check -> black plate.
  window.scopePaintShouldColdBootFace = realCold;
  const slot = slotOf("probeT3");
  let stoppedBlack = null;
  if (slot && scopePaintShouldColdBootFace(slot.nodeId, slot)) {
    drawNodeGraphTSeriesCrossfadeFaceItem(null, { slot, screenElement: slot.scopeElement }, 1);
    const canvas = slot.scopeElement.querySelector(".node-t-series-crossfade-canvas");
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) lit += d[i] + d[i + 1] + d[i + 2] > 30 ? 1 : 0;
    stoppedBlack = lit === 0;
  }
  const glFails = typeof nodeGraphDisplayGlFailures === "function"
    ? [...nodeGraphDisplayGlFailures().keys()].filter((k) => /probe|t-series|crossfade/i.test(k)) : [];
  return { out, stoppedBlack, glFails };
});

// Analyse pixels with the face's own layout (pad / gap / cell width in CSS px).
for (const r of results.out) {
  const tag = `${r.c.id} A=${r.c.a} D=${r.c.d}`;
  if (r.error || !r.data) { gate(false, `${tag}: ${r.error || "no face pixels"}`); continue; }
  const same = (x, y) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-6);
  gate(same(r.liveGains, r.wantGains), `${tag}: live gains from rings ${JSON.stringify(r.liveGains.map((g) => +g.toFixed(3)))}`);
  const [cssW, cssH] = r.css;
  const k = r.w / cssW;
  const n = r.wantGains.length;
  const pad = Math.max(1, Math.round(Math.min(cssW, cssH) * 0.08));
  const gap = Math.max(1, Math.round(cssW / n * 0.08));
  const cw = (cssW - pad * 2) / n;
  const cellH = cssH - pad * 2;
  const px = (x, y) => { const i = (Math.round(y) * r.w + Math.round(x)) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2]]; };
  const lum = (p) => p[0] + p[1] + p[2];
  // No white cursor: no column is near-white through the middle of the cells.
  const midY = (pad + cellH * 0.5) * k;
  let whiteCols = 0;
  for (let x = 0; x < r.w; x += 1) { const p = px(x, midY); if (p[0] > 230 && p[1] > 230 && p[2] > 230) whiteCols += 1; }
  gate(whiteCols === 0, `${tag}: no white cursor (${whiteCols} white px on the mid row)`);
  const wantCss = -1e9;
  // Fill height per cell: scan a column at 80% across the cell (off the digit).
  const fills = [];
  for (let i = 0; i < n; i += 1) {
    let x = (pad + i * cw + gap * 0.5 + (cw - gap) * 0.82) * k;
    if (Math.abs(x / k - wantCss) < 2) x = (pad + i * cw + gap * 0.5 + (cw - gap) * 0.18) * k;
    let rows = 0;
    for (let y = Math.ceil(pad * k); y < Math.floor((pad + cellH) * k); y += 1) {
      const p = px(x, y);
      // Fill colour is much brighter than the empty cell (~26,29,33).
      if (lum(p) > 160) rows += 1;
    }
    // Bottom-up: a lit cell must be lit on its bottom row.
    if (r.wantGains[i] > 0.1 && lum(px(x, Math.floor((pad + cellH) * k) - 2)) <= 160) rows = -1e6;
    fills.push(rows / k / cellH);
  }
  const fillOk = fills.every((f, i) => Math.abs(f - r.wantGains[i]) <= 2.5 / cellH + 0.04);
  gate(fillOk, `${tag}: cell fills ${JSON.stringify(fills.map((f) => +f.toFixed(2)))} vs gains ${JSON.stringify(r.wantGains.map((g) => +g.toFixed(2)))}`);
}
gate(results.stoppedBlack === true, `stopped engine: face is a black plate (${results.stoppedBlack})`);
gate(results.glFails.length === 0, `no GL failures for the faces ${JSON.stringify(results.glFails)}`);

// Screenshot: big detached faces (same paint code) for several positions.
await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "tSeriesProbeShots";
  host.style.cssText = "position:fixed;left:20px;top:20px;z-index:2147483647;background:#222;padding:10px;display:grid;grid-template-columns:auto 360px;gap:8px 12px;font:13px monospace;color:#ccc";
  document.body.append(host);
  window.scopePaintShouldColdBootFace = () => false;
  const rows = [
    ["t2   A 0", "demux", 1, { hasAnalog: true, analog: 0 }],
    ["t2   A 0.5", "demux", 1, { hasAnalog: true, analog: 0.5 }],
    ["t2   A 1", "demux", 1, { hasAnalog: true, analog: 1 }],
    ["t3   A 0.25", "demux", 2, { hasAnalog: true, analog: 0.25 }],
    ["t5   A 0.62", "demux", 4, { hasAnalog: true, analog: 0.62 }],
    ["t5   D 3", "demux", 4, { hasDigital: true, digital: 3 }],
    ["5t   A -0.3", "mux", 4, { hasAnalog: true, analog: -0.3 }],
    ["5t   D 2 + A 0.5", "mux", 4, { hasAnalog: true, analog: 0.5, hasDigital: true, digital: 2 }],
    ["11t  A 0.1", "mux", 10, { hasAnalog: true, analog: 0.1 }],
  ];
  for (const [label, kind, last, input] of rows) {
    const l = document.createElement("div"); l.textContent = label; l.style.alignSelf = "center"; host.append(l);
    const face = document.createElement("div"); face.style.cssText = "position:relative;width:360px;height:56px"; host.append(face);
    const st = { kind, lastIndex: last, ...nodeGraphTSeriesCrossfadeState(kind, last, input) };
    drawNodeGraphTSeriesCrossfadeFaceItem(null, { slot: { nodeId: "shot" }, screenElement: face, tSeriesState: st }, 2);
  }
});
await page.waitForTimeout(300);
const shot = path.join(outDir, "t_series_crossfade.png");
await page.locator("#tSeriesProbeShots").screenshot({ path: shot });
await page.evaluate(() => document.getElementById("tSeriesProbeShots")?.remove());
console.log(`screenshot: ${shot}`);
gate(errors.length === 0, `no page errors (${errors.length}) ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
process.exit(failures ? 1 : 0);
