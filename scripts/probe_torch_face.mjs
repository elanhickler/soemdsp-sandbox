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
  const draw = async (open, f, slot) => {
    for (let i = 0; i < 40; i += 1) {
      drawNodeGraphTorchFaceItem(null, { slot: slot || { nodeId: "probeT" }, screenElement: f, buffer: new Float32Array([open]) }, 1);
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
  out.handleOff = c ? px(c, 44, 20) : null;
  out.edge = c ? px(c, 5, 15) : null;
  await draw(1, face);
  out.flameOn = c ? px(c, 44, 5) : null;
  out.handleOn = c ? px(c, 44, 20) : null;
  await draw(0.5, face);
  out.flameHalf = c ? px(c, 44, 5) : null;
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
gate(JSON.stringify(r.handleOff) === JSON.stringify(r.handleOn), "handle (same in both images) unchanged");
gate(r.edge && sum(r.edge) === 0, "outside the torch is black plate");
gate(r.slot && r.workspace?.facePixels && r.workspace.brightPx > 0, `workspace face texture lit (${JSON.stringify(r.workspace)})`);
gate(errors.length === 0, `no page errors (${errors.length}) ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
process.exit(failures ? 1 : 0);
