// Probe: lone `t` Torch face (4 frames, linear crossfade across Open 0..1).
// Usage: node scripts/probe_torch_face.mjs  (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: process.env.HEADED ? false : true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error" && /torch/i.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof drawNodeGraphTorchFaceItem === "function"
  && document.querySelector('article[data-node-type="t"]'), null, { timeout: 120000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(async () => {
  const out = {};
  out.renderer = nodeGraphModuleDisplayRendererForNode({ type: "t" });
  out.registered = typeof nodeGraphModuleScopeCustomRenderers?.torchFace === "function";
  out.t2Renderer = nodeGraphModuleDisplayRendererForNode({ type: "t2" });
  // Detached on-screen face (2D present path).
  const face = document.createElement("div");
  face.style.cssText = "position:fixed;left:0;top:0;width:90px;height:30px;z-index:99999";
  document.body.append(face);
  const draw = async (open, f, slot, node) => {
    for (let i = 0; i < 40; i += 1) {
      drawNodeGraphTorchFaceItem(null, { slot: slot || { nodeId: "probeT" }, node, screenElement: f, buffer: new Float32Array([open]) }, 1);
      if (f._torchFaceOpen === open) return true;
      await new Promise((res) => setTimeout(res, 50));
    }
    return false;
  };
  const px = (canvas, x, y) => Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data);
  out.drewOff = await draw(0, face);
  const c = face.querySelector(".node-torch-face-canvas");
  out.size = c ? [c.width, c.height] : null;
  out.flameOff = c ? px(c, 44, 5) : null;
  out.edge = c ? px(c, 5, 15) : null;
  await draw(1, face);
  out.flameOn = c ? px(c, 44, 5) : null;
  await draw(0.5, face);
  out.flameHalf = c ? px(c, 44, 5) : null;
  // Hue: whole-face snapshots at Open 1 for hue 0 (node param) vs no node, and 0.5.
  const all = (canvas) => Array.from(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data);
  const hueNode = (h) => ({ id: "probeT", type: "t", params: {}, traceDisplaySettings: { torchHue: h } });
  await draw(1, face);
  const base = all(c);
  face._torchFaceOpen = null;
  await draw(1, face, null, hueNode(0));
  const h0 = all(c);
  face._torchFaceOpen = null;
  await draw(1, face, null, hueNode(0.5));
  const h180 = all(c);
  let diff0 = 0, greySame = 0, greyBad = 0, colourMoved = 0, colourPx = 0, sample = null;
  for (let i = 0; i < base.length; i += 4) {
    if (base[i] !== h0[i] || base[i + 1] !== h0[i + 1] || base[i + 2] !== h0[i + 2]) diff0 += 1;
    const [r, g, b] = [base[i], base[i + 1], base[i + 2]];
    const grey = Math.max(r, g, b) - Math.min(r, g, b) <= 1;
    const same = Math.abs(r - h180[i]) <= 1 && Math.abs(g - h180[i + 1]) <= 1 && Math.abs(b - h180[i + 2]) <= 1;
    if (grey && r + g + b > 30) { if (same) greySame += 1; else greyBad += 1; }
    if (Math.max(r, g, b) - Math.min(r, g, b) > 60) {
      colourPx += 1;
      if (!same) colourMoved += 1;
      if (!sample) sample = { at: i / 4, before: [r, g, b], after: [h180[i], h180[i + 1], h180[i + 2]] };
    }
  }
  out.hue = { diff0, greySame, greyBad, colourPx, colourMoved, sample, clampHi: nodeGraphTorchFaceHue({ node: hueNode(3) }), clampLo: nodeGraphTorchFaceHue({ node: hueNode(-2) }) };
  // Display Settings path: schema, form fields, assign + clone round-trip, no Hue param.
  const tNode = { id: "probeT2", type: "t", params: {} };
  const stored = assignNodeGraphTypedDisplaySettingsToNode(tNode, "torchFace", { torchHue: 0.25 });
  out.ds = {
    schema: nodeGraphModuleDisplaySettingsSchemaForNode(tNode),
    params: (nodeGraphModuleDefinitions.t.parameters || []).map((p) => p.key),
    stored: stored?.torchHue,
    hue: nodeGraphTorchFaceHue({ node: tNode }),
    clone: cloneNodeGraphTypedDisplaySettings(tNode)?.traceDisplaySettings?.torchHue,
    defaults: nodeGraphDisplaySettingsDefaultsForFormType("torchFace")?.torchHue,
  };
  // Buffered A/D: Open = mean of this frame's new samples (Clock Blink window).
  {
    const id = "probeBuf";
    const bufs = nodeGraphModuleScopeState.buffers;
    const realConn = globalThis.nodeGraphModuleScopeConnectionsTo;
    let wired = { Analog: true, Digital: true };
    globalThis.nodeGraphModuleScopeConnectionsTo = (nodeId, port) => (nodeId === id && wired[port] ? [{}] : realConn(nodeId, port));
    const ring = (fill, total, recent) => {
      const r = new Float32Array(1000);
      for (let i = 0; i < r.length; i += 1) r[i] = fill(i);
      r.nodeGraphScopeTotalSampleCount = total;
      r.nodeGraphScopeRecentSampleCount = recent;
      return r;
    };
    const holder = document.createElement("div");
    const open = () => nodeGraphTorchFaceOpen({ slot: { nodeId: id, scopeElement: holder }, screenElement: holder });
    const b = {};
    try {
      // Frame 1: no stamp yet -> last write chunk (800). D 50% duty, A 0.
      bufs.set(`${id}:Digital`, ring((i) => (i % 4 < 2 ? 1 : 0), 1000, 800));
      bufs.set(`${id}:Analog`, ring(() => 0, 1000, 800));
      b.duty = open();
      // Same buffer, both helpers: LED Dot energy over the identical window.
      const c = document.createElement("canvas");
      b.ledDot = nodeGraphVectorDotFrameEnergy01(bufs.get(`${id}:Digital`), c);
      // Frame 2: 100 new samples, A = 0.25, D = 0 -> 0.25 (stamp-driven window).
      bufs.set(`${id}:Digital`, ring((i) => (i < 900 ? 1 : 0), 1100, 100));
      bufs.set(`${id}:Analog`, ring((i) => (i < 900 ? 1 : 0.25), 1100, 100));
      b.analog = open();
      // Frame 3: 50 new, A = -1 (clamped to 0, not |A|), D = 0 -> 0.
      bufs.set(`${id}:Digital`, ring(() => 0, 1150, 50));
      bufs.set(`${id}:Analog`, ring(() => -1, 1150, 50));
      b.negative = open();
      // Frame 4: 40 new, D pulses 0.3 (> 0 opens fully) on 10 of 40 -> 0.25.
      bufs.set(`${id}:Digital`, ring((i) => (i >= 990 ? 0.3 : 0), 1190, 40));
      bufs.set(`${id}:Analog`, ring(() => 0, 1190, 40));
      b.digitalAny = open();
      // Analog only wired.
      wired = { Analog: true, Digital: false };
      bufs.set(`${id}:Analog`, ring(() => 0.6, 1250, 60));
      b.analogOnly = open();
    } finally {
      globalThis.nodeGraphModuleScopeConnectionsTo = realConn;
      bufs.delete(`${id}:Digital`);
      bufs.delete(`${id}:Analog`);
    }
    b.buffered = nodeGraphModuleBufferedInputs("t");
    b.visual = nodeGraphPatchNodeVisualInputs({ type: "t" }).map((v) => v.port);
    out.buf = b;
  }
  face.remove();
  // Real workspace slot (GL graph composites the face texture).
  const slot = nodeGraphVisibleModuleScopeSlots().find((s) => nodeGraphModuleScopeNodeForSlot(s)?.type === "t");
  out.slot = Boolean(slot);
  if (slot) {
    await draw(1, slot.scopeElement, slot);
    const wc = slot.scopeElement.querySelector(".node-torch-face-canvas");
    const pix = wc && typeof nodeGraphSharedGlFacePixels === "function" ? nodeGraphSharedGlFacePixels(wc) : null;
    let lit = 0;
    if (pix) for (let i = 0; i < pix.data.length; i += 4) if (pix.data[i] + pix.data[i + 1] + pix.data[i + 2] > 200) lit += 1;
    out.workspace = { size: wc ? [wc.width, wc.height] : null, facePixels: Boolean(pix), brightPx: lit };
  }
  return out;
});
console.log(JSON.stringify(r));
gate(r.renderer === "torchFace" && r.registered, "t uses torchFace and it is registered");
gate(r.t2Renderer === "tSeriesFace", "t2 uses the Crossfade face");
gate(r.drewOff && r.size?.[0] === 90 && r.size?.[1] === 30, "detached face drew at 90x30");
const sum = (p) => (p ? p[0] + p[1] + p[2] : -1);
gate(r.flameOff && sum(r.flameOff) < 250, `closed: flame area is the dark unlit torch (${r.flameOff})`);
gate(r.flameOn && sum(r.flameOn) > 450, `open: flame area is lit (${r.flameOn})`);
gate(r.flameHalf && sum(r.flameHalf) > sum(r.flameOff) && sum(r.flameHalf) < sum(r.flameOn), `half open is in between (${r.flameHalf})`);
gate(r.edge && sum(r.edge) === 0, "outside the torch is black plate");
gate(r.ds && r.ds.schema === "torchFace" && r.ds.params.length === 0, `t has no Hue param; Display Settings schema torchFace (${JSON.stringify(r.ds)})`);
gate(r.ds && r.ds.stored === 0.25 && r.ds.hue === 0.25 && r.ds.clone === 0.25 && r.ds.defaults === 0, "torchHue stores, drives the face, clones, defaults 0");
const near = (x, y) => Math.abs(x - y) < 1e-6;
gate(r.buf && JSON.stringify(r.buf.buffered) === '["Analog","Digital"]' && JSON.stringify(r.buf.visual) === '["Analog","Digital"]', `t has buffered A/D inputs (${JSON.stringify(r.buf?.buffered)})`);
gate(r.buf && near(r.buf.duty, 1) && near(r.buf.ledDot, 0.5), `50% Digital frame: Open is the frame peak ${r.buf?.duty} (LED Dot energy, a mean, ${r.buf?.ledDot})`);
gate(r.buf && near(r.buf.analog, 0.25), `next frame uses only its 100 new samples (${r.buf?.analog})`);
gate(r.buf && near(r.buf.negative, 0), `negative Analog clamps to 0 (${r.buf?.negative})`);
gate(r.buf && near(r.buf.digitalAny, 1), `Digital > 0 opens fully, peak over the frame (${r.buf?.digitalAny})`);
gate(r.buf && near(r.buf.analogOnly, 0.6), `Analog-only wiring (${r.buf?.analogOnly})`);
gate(r.hue && r.hue.diff0 === 0, `hue 0 is bit-identical to the original (${r.hue?.diff0} px differ)`);
const s = r.hue?.sample;
// JS HSL reference for a 180 deg turn (lightness and saturation kept).
const hsl180 = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [r, g, b].map((v) => v * 255);
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  h = (h + 0.5) % 1;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p2 = 2 * l - q;
  const ch = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p2 + (q - p2) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p2 + (q - p2) * (2 / 3 - t) * 6 : p2; };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((v) => v * 255);
};
const want = s ? hsl180(s.before) : null;
gate(s && want.every((v, i) => Math.abs(v - s.after[i]) <= 3), `hue 0.5 (180 deg) rotates a flame pixel ${JSON.stringify(s)} ref ${want?.map(Math.round)}`);
gate(r.hue && r.hue.colourPx > 0 && r.hue.colourMoved === r.hue.colourPx, `hue 0.5 moves every saturated pixel (${r.hue?.colourMoved}/${r.hue?.colourPx})`);
gate(r.hue && r.hue.greySame > 0 && r.hue.greyBad === 0, `grey pixels unchanged at hue 0.5 (${r.hue?.greySame} same, ${r.hue?.greyBad} changed)`);
gate(r.hue && r.hue.clampHi === 1 && r.hue.clampLo === 0, `hue clamped to 0..1 (${r.hue?.clampHi}, ${r.hue?.clampLo})`);
gate(r.slot && r.workspace?.facePixels && r.workspace.brightPx > 0, `workspace face texture lit (${JSON.stringify(r.workspace)})`);
gate(errors.length === 0, `no page errors (${errors.length}) ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
process.exit(failures ? 1 : 0);
