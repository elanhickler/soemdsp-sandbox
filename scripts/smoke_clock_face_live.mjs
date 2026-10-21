// Clock face live (headless Chrome): face draws, Display Settings shows the
// HBS rows Background, Pulse, Playhead, Fill in order + Line thickness, and a
// Background change applies live. Server on :8090 or SANDBOX_URL.
import fs from "node:fs";
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const patch = JSON.parse(fs.readFileSync(new URL("./smoke_display_draws_live.patch.json", import.meta.url), "utf8"));
const swap = (v) => (v === "dsfOscillator-1" ? "clock-1" : v);
const walk = (o) => {
  if (Array.isArray(o)) return o.map(walk);
  if (o && typeof o === "object") {
    if (o.id === "dsfOscillator-1") return { ...o, id: "clock-1", type: "clock", params: { rate: "1", phase: "0", pulseStart: "0.1", pulseEnd: "0.6", amplitude: "1" }, paramMeta: {}, traceDisplaySettings: {} };
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [swap(k), walk(v)]));
  }
  return swap(o);
};
const body = JSON.stringify({ ...walk(patch), connections: patch.connections.filter((c) => c.sourceNode !== "dsfOscillator-1") });
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/clock-face-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body }));
await page.goto(`${BASE}?pagePatch=clock-face-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="clock-1"]') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.locator('button[aria-label="Play"]:visible').first().click();
await page.waitForTimeout(2500);
async function stats(id) {
  const r = await page.evaluate((id) => {
    const face = [...document.querySelectorAll(`article[data-node="${id}"] .node-clock-face`)].find((f) => !f.closest("[hidden]"));
    if (!face) return null; const bb = face.getBoundingClientRect(); return { x: bb.left + 2, y: bb.top + 2, width: bb.width - 4, height: bb.height - 4 };
  }, id);
  if (!r || r.width < 8 || r.height < 8) return null;
  const b64 = (await page.screenshot({ clip: r })).toString("base64");
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data; const n = d.length / 4;
    const counts = new Map(); const mean = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3; counts.set(k, (counts.get(k) || 0) + 1); mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; }
    return { drawn: 1 - Math.max(...counts.values()) / n, mean: mean.map((v) => Math.round(v / n)) };
  }, b64);
}
const before = await stats("clock-1");
check(Boolean(before) && before.drawn > 0.01, "clock face draws more than its background", JSON.stringify(before));
await page.evaluate(() => openNodeGraphTraceDisplaySettings("clock-1", {}));
await page.waitForTimeout(800);
const labels = await page.evaluate(() => [...document.querySelectorAll("#nodeTraceDisplaySettingsPopover [data-hsl-lamp]")].map((e) => e.getAttribute("data-hsl-label")));
check(JSON.stringify(labels) === JSON.stringify(["Background", "Pulse", "Playhead", "Fill", "Start", "Blink"]), "HBS rows Background, Pulse, Playhead, Fill, Start, Blink", JSON.stringify(labels));
const thick = await page.evaluate(() => Boolean(document.querySelector('#nodeTraceDisplaySettingsPopover [data-trace-display-field="lineThickness"]')));
check(thick, "Line thickness control present");
const extra = await page.evaluate(() => ["startThickness", "blinkTime"].every((k) => document.querySelector(`#nodeTraceDisplaySettingsPopover [data-trace-display-field="${k}"]`)));
check(extra, "Start thickness + Blink time controls present");
const hex = await page.evaluateHandle(() => document.querySelector('[data-hsl-lamp="background"]')?.querySelector(".scw-hex") || null);
const set = Boolean(await hex.evaluate((e) => Boolean(e && e.offsetParent)));
if (set) { await hex.click({ clickCount: 3 }); await page.keyboard.type("#ff0000"); await page.keyboard.press("Enter"); }
await page.waitForTimeout(500);
await page.evaluate(() => closeNodeGraphTraceDisplaySettings());
await page.waitForTimeout(800);
const after = await stats("clock-1");
check(set && after && after.mean[0] - before.mean[0] > 20, "background colour change applies live", JSON.stringify({ set, after }));
const saved = await page.evaluate(() => nodeGraphPatchNode("clock-1")?.traceDisplaySettings?.fillPaint || "");
check(Boolean(saved), "fill paint stored on the node", saved);
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok clock face live"); process.exit(failures ? 1 : 0);
