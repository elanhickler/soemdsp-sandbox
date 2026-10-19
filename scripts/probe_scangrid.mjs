// Scan Grid (rasterRgb) screenshots with play on.
// Usage: node scripts/probe_scangrid.mjs <outPrefix> [patch] [nodeId ...]
// OLD=<rev> serves picture-device.js and raster-rgb-display.js from that rev (use ~1, not ^: cmd eats ^).
// SRC=<nodeId> reports whether that source has a published picture / counts as a picture consumer.
import { execSync } from "node:child_process";
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SRC = process.env.SRC || "sineWavetable-3";
const [prefix = "sg", patch = "rgb", ...ids] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
if (process.env.OLD) {
  for (const f of ["lib/visual/picture-device.js", "modules/rasterRgb/raster-rgb-display.js"]) {
    const body = execSync(`git show ${process.env.OLD}:public/${f}`, { encoding: "utf8", maxBuffer: 1 << 26 });
    await page.route(`**/public/${f}*`, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body }));
  }
}
await page.goto(`${BASE}?pagePatch=${patch}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof setNodeGraphZoom === "function" && document.querySelectorAll("article[data-node-type]").length > 2, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForTimeout(Number(process.env.WAIT || 4000));
const info = await page.evaluate((src) => {
  const out = {};
  for (const a of document.querySelectorAll("article[data-node-type=rasterRgb]")) {
    const id = a.dataset.node;
    const pic = ["rgba", "📺", "R", "G", "B"].map((p) => [p, typeof nodeGraphPictureRead === "function" ? (nodeGraphPictureRead(id, p)?.nodeId || null) : "n/a"]);
    const c = a.querySelector(".node-raster-rgb-canvas");
    out[id] = { pic, wired: c?._rasterRgbDebug?.wired, grid: c?._rasterRgbDebug?.grid, writePos: c?._rasterRgb?.writePos };
  }
  out.srcPublished = typeof nodeGraphPictureGet === "function" ? Boolean(nodeGraphPictureGet(src)) : "n/a";
  out.srcConsumed = typeof nodeGraphPictureHasConsumer === "function" ? nodeGraphPictureHasConsumer(src) : "n/a";
  out.edgeStats = typeof nodeGraphPictureEdgeStats === "function" ? nodeGraphPictureEdgeStats() : null;
  return out;
}, SRC);
console.log(JSON.stringify(info));
for (const id of ids) {
  const b = await page.evaluate((id) => { const r = document.querySelector(`article[data-node="${id}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, id);
  await page.screenshot({ path: `${prefix}-${id}.png`, clip: b });
  console.log("shot", `${prefix}-${id}.png`);
}
console.log("errors", JSON.stringify(errors.slice(0, 8)));
await browser.close();