// Display layering Stage 4b: face boxes (no DOM canvas) still show in every
// view. Workspace face textures, a snapshot, one zoom step, Canvas tiles,
// screen solo and Mini Canvas all composite from the face textures, and the
// face host stays behind the face's own DOM (z-order).
// Usage: node scripts/smoke_display_face_views.mjs (app on :8765 or SANDBOX_URL).
// Never saves: every non-GET request is aborted.
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e.message || e).slice(0, 700)));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 400)}`);
});
await page.route("**/*", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

await page.goto(`${BASE}?mode=circuitbuilder`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => typeof showNodeGraphModule === "function"
  && document.querySelector("#nodeGraphWorkspace.gl-graph-on"), null, { timeout: 180000 });
await page.waitForTimeout(2500);

const TYPES = ["sinCos", "stepGraph", "smoothGraph", "xyPad", "scope2d", "waterfall"];
// One add per commit: back-to-back adds in one task overwrite each other.
const ids = await page.evaluate(async (types) => {
  const out = [];
  for (let i = 0; i < types.length; i += 1) {
    out.push({ type: types[i], id: showNodeGraphModule(types[i], { x: 60 + (i % 3) * 420, y: 60 + Math.floor(i / 3) * 420 }, { status: "probe" }) || "" });
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}, TYPES);
await page.waitForTimeout(2500);

const lit = (px) => { let n = 0; if (px) for (let i = 0; i < px.data.length; i += 4) if (px.data[i] + px.data[i + 1] + px.data[i + 2] > 24) n += 1; return n; };
const faces = () => page.evaluate(`(() => {
  const lit = ${lit.toString()};
  return [...document.querySelectorAll("#nodeGraphWorkspace .node-display-face")].map((el) => ({
    node: el.closest("[data-node]")?.dataset?.node || "",
    tag: el.tagName,
    key: nodeGraphDisplayFaceKey(el),
    tex: Boolean(nodeGraphSharedGlFaceTexture(el)),
    lit: lit(nodeGraphSharedGlFacePixels(el)),
    painted: (() => { const p = nodeGraphSharedGlFacePixels(el); if (!p) return 0; let n = 0; for (let i = 0; i < p.data.length; i += 4) if (p.data[i + 3] > 0) n += 1; return n; })(),
  }));
})()`);

// Workspace: every probe face is a face box with a picture (a stopped scope
// shows only its plate: painted, not lit).
const ws = await faces();
gate(ws.length > 0 && ws.every((f) => f.tag !== "CANVAS"), `workspace faces are face boxes (${ws.length})`);
gate(await page.evaluate(() => document.querySelectorAll("#nodeGraphWorkspace .dsp-node canvas.node-display-face").length === 0), "no display canvas in modules");
for (const { type, id } of ids) {
  const mine = ws.filter((f) => f.node === id);
  gate(mine.some((f) => f.tex && f.painted > 0), `${type}: face texture is painted (${mine.map((f) => `${f.key}:lit ${f.lit}, painted ${f.painted}`).join(", ")})`);
}

// Snapshot by face identity (key string) and by element.
const snap = await page.evaluate((id) => {
  const el = document.querySelector(`[data-node="${id}"] .node-display-face`);
  const a = nodeGraphGlLinesSnapshot(nodeGraphDisplayFaceKey(el));
  const b = nodeGraphGlLinesSnapshot(el);
  const ok = [Boolean(a), Boolean(b)];
  if (a) nodeGraphGlLinesReleaseSnapshot(a);
  if (b) nodeGraphGlLinesReleaseSnapshot(b);
  return ok;
}, ids.find((x) => x.type === "sinCos").id);
gate(snap[0] && snap[1], `snapshot by face key and by face box (${snap})`);

// One zoom step: faces keep their textures and pictures.
await page.evaluate(() => setNodeGraphZoom(1.6));
await page.waitForTimeout(1200);
const zoomed = await faces();
gate(ids.every(({ id }) => zoomed.some((f) => f.node === id && f.tex && f.painted > 0))
  && ws.every((f) => f.lit === 0 || zoomed.some((z) => z.key === f.key && z.lit > 0)), "faces keep their pictures after a zoom step");
await page.evaluate(() => setNodeGraphZoom(1));
await page.waitForTimeout(600);

// Canvas view: pin every probe module, open the Canvas, read the face hosts.
const canvasView = await page.evaluate(async (list) => {
  for (const { id } of list) nodeGraphLayoutCanvasSetPinned(id, true);
  nodeGraphLayoutCanvasOpen("perform");
  await new Promise((r) => setTimeout(r, 2000));
  const hosts = [...document.querySelectorAll(".gl-face-host")];
  const out = hosts.map((host) => {
    const c = host.querySelector(":scope > canvas.node-gl-face-host-canvas");
    if (!c || !(c.width > 0)) return { node: host.closest("[data-node]")?.dataset?.node || host.dataset?.node || "", lit: -1 };
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n += 1;
    return { node: host.closest("[data-node]")?.dataset?.node || host.dataset?.node || "", lit: n, z: getComputedStyle(c).zIndex, pe: getComputedStyle(c).pointerEvents };
  });
  const faceCanvases = document.querySelectorAll(".node-layout-canvas-tile canvas.node-display-face, .node-layout-canvas-tile .node-display-canvas").length;
  nodeGraphLayoutCanvasClose();
  await new Promise((r) => setTimeout(r, 800));
  return { hosts: out, faceCanvases, active: nodeGraphLayoutCanvasIsActive() };
}, ids);
gate(canvasView.hosts.length >= ids.length && canvasView.hosts.filter((h) => h.lit > 0).length >= ws.filter((f) => f.lit > 0).length, `Canvas tiles composite face textures (${JSON.stringify(canvasView.hosts.map((h) => h.lit))})`);
gate(canvasView.hosts.every((h) => h.lit < 0 || (h.z === "-1" && h.pe === "none")), "face host canvas sits behind the face DOM, never a hit target");
gate(canvasView.faceCanvases === 0, "no display canvases in Canvas tiles");

// Screen solo of the Step Graph face.
const solo = await page.evaluate(async (id) => {
  toggleNodeGraphScreenSolo(id);
  await new Promise((r) => setTimeout(r, 1500));
  const host = document.querySelector(".gl-face-host");
  const c = host?.querySelector(":scope > canvas.node-gl-face-host-canvas");
  let n = -1;
  if (c && c.width > 0) {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n += 1;
  }
  const active = nodeGraphScreenSoloIsActive();
  toggleNodeGraphScreenSolo(id);
  await new Promise((r) => setTimeout(r, 800));
  return { active, lit: n };
}, ids.find((x) => x.type === "stepGraph").id);
gate(solo.active && solo.lit > 0, `screen solo composites the Step Graph face (${JSON.stringify(solo)})`);

// Mini Canvas (pinned modules as tiles).
const mini = await page.evaluate(async () => {
  for (let i = 0; i < 4 && !nodeGraphMiniPerformShown(); i += 1) toggleNodeGraphMiniPerformView();
  await new Promise((r) => setTimeout(r, 1200));
  nodeGraphGlMiniPerformPresent();
  const c = document.getElementById("nodeGlGraphMiniPerform");
  const view = document.getElementById("nodeMiniPerformView");
  let n = -1;
  if (c && c.width > 0) {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n += 1;
  }
  return { shown: nodeGraphMiniPerformShown(), tiles: view?._miniTiles?.length || 0, lit: n };
});
gate(mini.shown && mini.tiles > 0 && mini.lit > 0, `Mini Canvas mirrors the faces (${JSON.stringify(mini)})`);

gate(errors.length === 0, `no page errors (${errors.length})`);
for (const e of errors.slice(0, 15)) console.log("ERR", e);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
