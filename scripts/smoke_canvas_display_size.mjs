// PP-10 canvas display sizing smoke (docs/MODULE_RAILS_PLAN.md): in Canvas
// view a display's size comes only from its canvas tile.
//   - nodeGraphCanvasDisplayBox: fill the tile, or contain-fit a declared displayAspect.
//   - F solo: a 1-grid-tall workspace display fills its cell; changing
//     displayHeightGu leaves the solo size unchanged; displayAspect:1 (SinCos4)
//     is square-contained in the cell.
//   - Layout canvas tile: the display fills its tile; resizing the tile resizes it.
//   - Mini Performance View: the display map equals the tile box (no workspace aspect).
// Usage: node scripts/smoke_canvas_display_size.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(label);
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 40, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  d.nodes.push({ gx: 1, gy: 1, id: "pp-1", type: "pingPongDelay", params: {}, ui: { displayHeightGu: 1 } });
  d.nodes.push({ gx: 14, gy: 1, id: "sw-1", type: "sineWavetable", params: { freq: 1, mode: 2 } });
  return JSON.stringify(d);
}

const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/canvas-size.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=canvas-size`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pp-1"]')
  && typeof beginNodeGraphScreenSolo === "function", null, { timeout: 200000 });
await page.waitForTimeout(2500);

// 1. Pure box rule.
const unit = await page.evaluate(() => ({
  fill: nodeGraphCanvasDisplayBox(400, 100, 0),
  square: nodeGraphCanvasDisplayBox(400, 100, 1),
  tall: nodeGraphCanvasDisplayBox(100, 400, 1),
  ppAspect: nodeGraphDisplayAspect("pingPongDelay"),
  swAspect: nodeGraphDisplayAspect("sineWavetable"),
}));
check("fill box = tile", unit.fill.w === 400 && unit.fill.h === 100 && unit.fill.x === 0);
check("aspect 1 box contain-fitted, centred", unit.square.w === 100 && unit.square.h === 100 && unit.square.x === 150);
check("aspect 1 in a tall tile", unit.tall.w === 100 && unit.tall.y === 150);
check("Ping Pong fills (no aspect), SinCos4 declares aspect 1", unit.ppAspect === 0 && unit.swAspect === 1, JSON.stringify(unit));

// 2. F solo.
const solo = async (id, ui) => {
  await page.evaluate(({ id, ui }) => {
    if (ui) {
      const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
      const node = patch.nodes.find((n) => n.id === id);
      node.ui = { ...(node.ui || {}), ...ui };
      commitNodeGraphPatch(patch, {});
    }
    beginNodeGraphScreenSolo(id);
  }, { id, ui });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const stage = document.querySelector("#nodeScreenSoloStage");
    const face = stage?.querySelector(".node-screen-solo-face");
    const canvas = face?.querySelector("canvas");
    const s = stage?.getBoundingClientRect();
    const f = face?.getBoundingClientRect();
    const c = canvas?.getBoundingClientRect();
    return s && f ? { stage: [s.width, s.height], face: [f.width, f.height], canvas: c ? [c.width, c.height] : null, fit: stage.getAttribute("data-fit"), n: stage.querySelectorAll(".node-screen-solo-face").length, vars: face.style.getPropertyValue("--node-screen-solo-item-w"), items: nodeGraphScreenSoloItems().map((i) => [i.nodeId, i.aspect]) } : null;
  });
  if (SHOT) await page.screenshot({ path: path.join(SHOT, `rails2-fsolo-${id}${ui ? `-gu${ui.displayHeightGu}` : ""}.png`) });
  await page.evaluate(() => endNodeGraphScreenSolo());
  await page.waitForTimeout(500);
  return m;
};
const pp1 = await solo("pp-1");
check("F solo: 1-grid-tall display fills the stage", pp1 && near(pp1.face[0], pp1.stage[0], 4) && near(pp1.face[1], pp1.stage[1], 4), JSON.stringify(pp1));
const pp6 = await solo("pp-1", { displayHeightGu: 6 });
check("F solo: displayHeightGu does not change the solo size", pp1 && pp6 && near(pp1.face[0], pp6.face[0], 1) && near(pp1.face[1], pp6.face[1], 1), `${JSON.stringify(pp1)} vs ${JSON.stringify(pp6)}`);
const sw = await solo("sw-1");
check("F solo: displayAspect 1 is square in the stage", sw && near(sw.face[0], sw.face[1], 3)
  && near(Math.min(...sw.stage), sw.face[0], 4), JSON.stringify(sw));

// 3. Layout canvas tile.
const tile = async (rect) => {
  await page.evaluate(({ rect }) => {
    nodeGraphLayoutCanvasSetPinned("pp-1", true);
    nodeGraphLayoutCanvasWriteRect("pp-1", rect);
    if (!nodeGraphLayoutCanvasIsActive()) nodeGraphLayoutCanvasOpen("perform");
    else nodeGraphLayoutCanvasRefreshOpenStage();
  }, { rect });
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const t = document.querySelector('.node-layout-canvas-tile[data-node="pp-1"]') || document.querySelector(".node-layout-canvas-tile");
    const c = t?.querySelector("canvas");
    const tr = t?.getBoundingClientRect();
    const cr = c?.getBoundingClientRect();
    return tr && cr ? { tile: [tr.width, tr.height], canvas: [cr.width, cr.height] } : null;
  });
};
const t1 = await tile({ x: 0.05, y: 0.1, w: 0.8, h: 0.5 });
check("canvas tile: display fills its tile", t1 && near(t1.canvas[0], t1.tile[0], 6) && near(t1.canvas[1], t1.tile[1], 6), JSON.stringify(t1));
if (SHOT) await page.screenshot({ path: path.join(SHOT, "rails2-canvas-tile.png") });
const t2 = await tile({ x: 0.1, y: 0.1, w: 0.3, h: 0.7 });
check("canvas tile: resizing the tile resizes the display", t1 && t2 && near(t2.canvas[0], t2.tile[0], 6) && near(t2.canvas[1], t2.tile[1], 6) && !near(t1.canvas[0], t2.canvas[0], 6), JSON.stringify(t2));

await browser.close();
if (errors.length) console.log("page errors:", errors.slice(0, 5));
console.log(failures.length ? `${failures.length} failure(s)` : "all canvas display size checks passed");
process.exitCode = failures.length ? 1 : 0;
