// Display face boxes (layering Stage 4b): every module type's display faces
// are non-canvas face boxes keyed by node id + face slot, laid out at zoom 1,
// and they paint only through their face texture.
// Usage: node scripts/smoke_display_face_boxes.mjs [out.json]
// (app already running on :8765 or SANDBOX_URL). Never saves the patch.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const OUT = process.argv[2] || "";
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e.message || e).slice(0, 700)));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 400)}`); });
// Never write anything back to the server (patch saves, settings).
await page.route("**/*", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
// Any canvas-only API reached on a face box (not a <canvas>) is a leftover
// 2D-canvas assumption: record where it came from.
await page.addInitScript(() => {
  window.__faceBoxCanvasApi = [];
  for (const name of ["getContext", "toDataURL", "toBlob", "captureStream", "transferControlToOffscreen"]) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get() {
        if (this.classList?.contains?.("node-display-face")) {
          const stack = String(new Error().stack || "").split("\n").slice(2, 5).join(" | ");
          if (window.__faceBoxCanvasApi.length < 200) window.__faceBoxCanvasApi.push(`${name}: ${this.className} @ ${stack}`);
        }
        return undefined;
      },
    });
  }
});
await page.goto(`${BASE}?mode=circuitbuilder`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => typeof showNodeGraphModule === "function"
  && typeof nodeGraphModuleDefinitions === "object"
  && document.querySelector("#nodeGraphWorkspace.gl-graph-on"), null, { timeout: 180000 });
await page.waitForTimeout(3000);

const only = process.env.TYPES ? process.env.TYPES.split(",") : null;
const types = await page.evaluate((o) => Object.keys(nodeGraphModuleDefinitions).filter((t) => !o || o.includes(t)), only);
// Batches placed in view (off-screen modules are culled), measured, then
// deleted again so the next batch starts from the same workspace.
const collect = () => {
  const faces = [...document.querySelectorAll("#nodeGraphWorkspace .node-display-face, #nodeGraphWorkspace .node-display-canvas")];
  return faces.map((el) => {
    const host = el.closest("[data-node]");
    const key = typeof nodeGraphDisplayFaceKey === "function" ? nodeGraphDisplayFaceKey(el) : "";
    const tex = typeof nodeGraphSharedGlFaceTexture === "function" ? nodeGraphSharedGlFaceTexture(el) : null;
    let lit = -1;
    const px = tex && typeof nodeGraphSharedGlFacePixels === "function" ? nodeGraphSharedGlFacePixels(el) : null;
    if (px) {
      lit = 0;
      for (let i = 0; i < px.data.length; i += 4) if (px.data[i] + px.data[i + 1] + px.data[i + 2] > 24) lit += 1;
    }
    return {
      node: host?.dataset?.node || "",
      type: host?.dataset?.nodeType || "",
      cls: String(el.className || "").split(/\s+/).filter((c) => c && !/^display-canvas-/.test(c) && c !== "node-display-canvas" && c !== "node-display-face").join(" "),
      tag: el.tagName,
      key,
      w: el.offsetWidth,
      h: el.offsetHeight,
      bw: el.width | 0,
      bh: el.height | 0,
      tex: Boolean(tex),
      lit,
    };
  });
};
const BATCH = 6;
const added = [];
const rows = [];
let canvases = 0;
for (let b = 0; b < types.length; b += BATCH) {
  const part = types.slice(b, b + BATCH);
  // One add per commit: back-to-back adds in one task overwrite each other.
  const ids = await page.evaluate(async (list) => {
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const type = list[i];
      try {
        out.push({ type, id: showNodeGraphModule(type, { x: 40 + (i % 3) * 520, y: 40 + Math.floor(i / 3) * 460 }, { status: "probe" }) || "" });
      } catch (e) {
        out.push({ type, error: String(e.message || e) });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return out;
  }, part);
  added.push(...ids.filter((x) => x.id || x.error));
  await page.waitForTimeout(1800);
  const got = await page.evaluate(`(${collect.toString()})()`);
  for (const r of got) r.batch = b / BATCH;
  rows.push(...got);
  canvases += await page.evaluate(() => document.querySelectorAll("#nodeGraphWorkspace .dsp-node canvas").length);
  await page.evaluate((list) => {
    const live = list.filter((x) => x.id && nodeGraphPatchNode(x.id)).map((x) => x.id);
    if (!live.length) return;
    setNodeGraphNodeSelection(live);
    deleteSelectedNodeGraphItem();
  }, ids);
  await page.waitForTimeout(150);
}
const report = { canvases, faceCanvasTags: rows.filter((r) => r.tag === "CANVAS").length, canvasApi: await page.evaluate(() => window.__faceBoxCanvasApi), rows };
// Two live faces sharing one key in the same batch would share a texture.
const keys = new Map();
for (const r of report.rows) if (r.key) keys.set(`${r.batch}|${r.key}`, (keys.get(`${r.batch}|${r.key}`) || 0) + 1);
const dupKeys = [...new Set([...keys].filter(([, n]) => n > 1).map(([k]) => k.split("|").slice(1).join("|")))];
const out = { types: types.length, added: added.length, addErrors: added.filter((a) => a.error), dupKeys, errors, ...report };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({
  types: out.types, added: out.added, faces: report.rows.length, withTexture: report.rows.filter((r) => r.tex).length,
  lit: report.rows.filter((r) => r.lit > 0).length, zeroBox: report.rows.filter((r) => !(r.w > 0 && r.h > 0)).length,
  faceCanvasTags: report.faceCanvasTags, workspaceCanvases: report.canvases, dupKeys: dupKeys.length,
  canvasApi: report.canvasApi.length, errors: errors.length,
}));
for (const e of errors.slice(0, 20)) console.log("ERR", e);
for (const e of report.canvasApi.slice(0, 20)) console.log("API", e);
await browser.close();
process.exit(errors.length || report.canvasApi.length || dupKeys.length ? 1 : 0);
