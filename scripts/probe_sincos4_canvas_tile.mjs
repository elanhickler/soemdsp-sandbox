// Probe: SinCos4 face in Canvas view tiles keeps a square drawing (backing
// canvas = tile box, circle centred by min(w, h)); screenshots in scripts/out/.
// Usage: node scripts/probe_sincos4_canvas_tile.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
let bad = 0;
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=crossover`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof nodeGraphLayoutCanvasOpen === "function" && nodeGraphMvp?.patch?.nodes?.some((n) => n.type === "sineWavetable"), null, { timeout: 120000 });
await page.waitForTimeout(2500);
const measure = () => page.evaluate(() => { const c = document.querySelector(".node-sincos4-canvas"); const r = c.getBoundingClientRect(); const s = c.closest(".node-sincos4-display").getBoundingClientRect();
  return { css: [Math.round(r.width), Math.round(r.height)], backing: [c.width, c.height], cssAspect: +(r.width / r.height).toFixed(3), backingAspect: +(c.width / c.height).toFixed(3), section: [Math.round(s.width), Math.round(s.height)], tile: !!c.closest(".node-layout-canvas-tile") }; });
console.log("workspace", JSON.stringify(await measure()));
await page.locator(".node-sincos4-display").screenshot({ path: "scripts/out/sc4_workspace.png" });
const id = await page.evaluate(() => nodeGraphMvp.patch.nodes.find((n) => n.type === "sineWavetable").id);
for (const rect of [{ x: 0.05, y: 0.1, w: 0.8, h: 0.3 }, { x: 0.3, y: 0.05, w: 0.15, h: 0.85 }]) {
  await page.evaluate(({ id, rect }) => { nodeGraphLayoutCanvasSetPinned(id, true); nodeGraphLayoutCanvasWriteRect(id, rect); if (!nodeGraphLayoutCanvasIsActive()) nodeGraphLayoutCanvasOpen("perform"); else nodeGraphLayoutCanvasRefreshOpenStage(); }, { id, rect });
  await page.waitForTimeout(1500);
  { const m = await measure(); console.log("canvas tile", JSON.stringify(rect), JSON.stringify(m)); if (!m.tile || Math.abs(m.cssAspect - m.backingAspect) > 0.02) { console.log("FAIL canvas tile backing aspect != tile aspect (face stretched)"); bad += 1; } }
  await page.locator(".node-layout-canvas-tile").first().screenshot({ path: `scripts/out/sc4_tile_${rect.w}.png` });
}
console.log("errors", errors.slice(0, 3)); await browser.close();
if (errors.length) bad += 1;
console.log(bad ? `${bad} FAIL` : "all ok"); process.exit(bad ? 1 : 0);
