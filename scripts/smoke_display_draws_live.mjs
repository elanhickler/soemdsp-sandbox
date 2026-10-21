// Displays draw live: DSF Oscillator + Resonant Envelope faces must paint more
// than their background (the "black / background-only display" regression),
// and a Display Settings background colour change must show without refresh.
// Server on :8090 or SANDBOX_URL. Uses system Chrome (playwright-core).
import fs from "node:fs";
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const patch = fs.readFileSync(new URL("./smoke_display_draws_live.patch.json", import.meta.url), "utf8");
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/display-live-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patch }));
await page.goto(`${BASE}?pagePatch=display-live-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="resonantEnvelope-1"]') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.locator('button[aria-label="Play"]:visible').first().click();
await page.waitForTimeout(3000);
// Pixel stats of a face: share of pixels away from the face's dominant colour, and the mean colour.
async function stats(id) {
  const r = await page.evaluate((id) => {
    const face = [...document.querySelectorAll(`article[data-node="${id}"] .node-module-face`)].find((f) => !f.closest("[hidden]"));
    if (!face) return null; const b = face.getBoundingClientRect(); return { x: b.left + 2, y: b.top + 2, width: b.width - 4, height: b.height - 4 };
  }, id);
  if (!r || r.width < 8 || r.height < 8) return null;
  const b64 = (await page.screenshot({ clip: r })).toString("base64");
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data; const n = d.length / 4;
    const counts = new Map(); const mean = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3; counts.set(k, (counts.get(k) || 0) + 1); mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; }
    const top = Math.max(...counts.values());
    return { drawn: 1 - top / n, mean: mean.map((v) => Math.round(v / n)) };
  }, b64);
}
for (const id of ["dsfOscillator-1", "resonantEnvelope-1"]) {
  const s = await stats(id);
  check(Boolean(s) && s.drawn > 0.01, `${id} face draws more than its background`, JSON.stringify(s));
}
// Live background colour change (no refresh).
const before = await stats("dsfOscillator-1");
await page.evaluate(() => openNodeGraphTraceDisplaySettings("dsfOscillator-1", {}));
await page.waitForTimeout(800);
// DSF colour rows: Line, Dot, Background; Background is the last one.
const hex = await page.evaluateHandle(() => [...document.querySelectorAll(".scw-hex")].filter((e) => e.offsetParent).pop() || null);
const set = Boolean(await hex.evaluate((e) => Boolean(e && e.offsetParent)));
if (set) { await hex.click({ clickCount: 3 }); await page.keyboard.type("#ff0000"); await page.keyboard.press("Enter"); }
await page.waitForTimeout(500);
await page.evaluate(() => closeNodeGraphTraceDisplaySettings());
await page.waitForTimeout(800);
const after = await stats("dsfOscillator-1");
check(set && before && after && after.mean[0] - before.mean[0] > 20, "background colour change applies live", JSON.stringify({ set, before, after }));
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok display draws live"); process.exit(failures ? 1 : 0);






