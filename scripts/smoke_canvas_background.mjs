// Canvas background image: Arrange bar "Add image" / "Change image" / "Clear"
// set the current Canvas's background (saved on its bucket with the pins).
// The Canvas stage covers it behind every tile; tiles keep their blend over
// it; Mini Canvas draws the same picture first. Checks state and CSS, not pixels.
// Usage: node scripts/smoke_canvas_background.mjs (app on :8765 or SANDBOX_URL).
// Never saves: every non-GET request is aborted.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
// 4x2 PNG (wider than tall), so cover has something to crop.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4oaEBRwzIHAB22gjB9Lr9UAAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 500)));
await page.route("**/*", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
await page.goto(`${BASE}?mode=circuitbuilder`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.querySelector("#nodeGraphWorkspace.gl-graph-on"), null, { timeout: 180000 });
await page.waitForTimeout(2500);
let fails = 0; const gate = (ok, m) => { console.log(`${ok ? "ok  " : "FAIL"} ${m}`); if (!ok) fails++; };
const ids = await page.evaluate(async () => {
  const out = [];
  for (const [i, t] of ["sinCos", "scope2d"].entries()) { out.push(showNodeGraphModule(t, { x: 60 + i * 420, y: 60 }, { status: "probe" })); await new Promise((r) => setTimeout(r, 300)); }
  return out;
});
await page.waitForTimeout(1500);
await page.evaluate((ids) => { for (const id of ids) nodeGraphLayoutCanvasSetPinned(id, true, { refresh: false }); toggleNodeGraphLayoutCanvasView(); toggleNodeGraphLayoutCanvasView(); }, ids);
await page.waitForTimeout(1500);
const state = () => page.evaluate((id) => {
  const stage = document.getElementById("nodeScreenSoloStage");
  const cs = getComputedStyle(stage);
  const bar = document.getElementById("nodeLayoutCanvasArrangeBar");
  const pick = bar?.querySelector('button[data-background="pick"]');
  const clear = bar?.querySelector('button[data-background="clear"]');
  const tile = document.querySelector(`.node-layout-canvas-tile[data-node="${id}"]`);
  return {
    image: cs.backgroundImage.slice(0, 30), size: cs.backgroundSize, pos: cs.backgroundPosition,
    stored: nodeGraphMvp.patch.view.canvases.root.background?.fileName || null,
    pick: pick?.textContent, clearOff: clear?.disabled, mode: nodeGraphLayoutCanvasMode(),
    tileBlend: tile ? getComputedStyle(tile).mixBlendMode : null,
    mini: Boolean(nodeGraphLayoutCanvasBackgroundImage()),
  };
}, ids[1]);
let s = await state();
gate(s.image === "none" && s.pick === "Add image" && s.clearOff === true, `starts with no background ${JSON.stringify(s)}`);
const chooser = page.waitForEvent("filechooser");
await page.click('#nodeLayoutCanvasArrangeBar button[data-background="pick"]');
await (await chooser).setFiles({ name: "stage.png", mimeType: "image/png", buffer: PNG });
await page.waitForTimeout(800);
s = await state();
gate(s.image.startsWith('url("data:image/png') && s.size === "cover" && s.stored === "stage.png", `Add image covers the stage ${JSON.stringify(s)}`);
gate(s.pick === "Change image" && s.clearOff === false, `bar offers Change image / Clear ${JSON.stringify(s)}`);
gate(s.mini, "Mini Canvas has the decoded picture");
const cover = await page.evaluate(() => nodeGraphCanvasBackgroundCoverRect(4, 2, 100, 100));
gate(cover && cover.h === 100 && cover.w === 200 && cover.x === -50 && cover.y === 0, `cover math ${JSON.stringify(cover)}`);
// Tile blend still applies over the picture.
const r = await page.evaluate((id) => document.querySelector(`.node-layout-canvas-tile[data-node="${id}"]`).getBoundingClientRect().toJSON(), ids[1]);
await page.mouse.move(r.x + 20, r.y + 8); await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(200);
await page.click('#nodeLayoutCanvasArrangeBar button[data-blend="screen"]');
await page.waitForTimeout(200);
// Drag a tile: the background stays.
await page.mouse.move(r.x + 20, r.y + 8); await page.mouse.down(); await page.mouse.move(r.x + 70, r.y + 40, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(300);
s = await state();
gate(s.tileBlend === "screen" && s.image.startsWith('url("data:image/png'), `blend + drag keep the background ${JSON.stringify(s)}`);
const saved = await page.evaluate(() => {
  const norm = normalizeNodeGraphPatchViewCanvases(nodeGraphMvp.patch.view.canvases).root.background;
  const pruned = nodeGraphPruneViewCanvasesToExistingNodes(nodeGraphMvp.patch.view, nodeGraphMvp.patch.nodes).canvases.root.background;
  return { norm: norm?.fileName, pruned: pruned?.fileName, url: norm?.dataUrl?.slice(0, 22) };
});
gate(saved.norm === "stage.png" && saved.pruned === "stage.png" && saved.url === "data:image/png;base64,", `save / load keep it ${JSON.stringify(saved)}`);
// Leave Arrange (F: Arrange -> off), reopen Perform: still there; off the Canvas the stage is plain.
await page.evaluate(() => toggleNodeGraphLayoutCanvasView());
await page.waitForTimeout(500);
s = await state();
gate(s.image === "none" && s.mode === "off", `Canvas closed: stage plain ${JSON.stringify(s)}`);
// Mini Canvas (Shift+F) presents with the picture under its tiles.
const mini = await page.evaluate(async () => {
  toggleNodeGraphMiniPerformView();
  await new Promise((r) => setTimeout(r, 600));
  const out = { shown: nodeGraphMiniPerformShown(), present: nodeGraphGlMiniPerformPresent(), picture: Boolean(nodeGraphLayoutCanvasBackgroundImage()) };
  toggleNodeGraphMiniPerformView();
  toggleNodeGraphMiniPerformView();
  return out;
});
gate(mini.shown && mini.present === true && mini.picture, `Mini Canvas presents over the picture ${JSON.stringify(mini)}`);
await page.evaluate(() => toggleNodeGraphLayoutCanvasView());
await page.waitForTimeout(1000);
s = await state();
gate(s.mode === "perform" && s.image.startsWith('url("data:image/png'), `Canvas Perform shows it ${JSON.stringify(s)}`);
await page.evaluate(() => toggleNodeGraphLayoutCanvasView());
await page.waitForTimeout(500);
await page.click('#nodeLayoutCanvasArrangeBar button[data-background="clear"]');
await page.waitForTimeout(300);
s = await state();
gate(s.image === "none" && s.stored === null && s.pick === "Add image" && s.clearOff === true && !s.mini, `Clear removes it ${JSON.stringify(s)}`);
await page.click('#nodeLayoutCanvasArrangeBar button[data-blend="normal"]');
await page.evaluate(() => toggleNodeGraphLayoutCanvasView());
await page.waitForTimeout(300);
gate(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
process.exit(fails ? 1 : 0);
