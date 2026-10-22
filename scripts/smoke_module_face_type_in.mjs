// B-105/B-106 smoke (headless Chrome): new face widgets (Clock) take a double-click
// type-in like the old sliders, and their shown digits follow the param's Max Digits.
// Server on :8090 or SANDBOX_URL.
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
    if (o.id === "dsfOscillator-1") return { ...o, id: "clock-1", type: "clock", params: { rate: "2", phase: "0", pulseStart: "0.1", pulseEnd: "0.6", amplitude: "1" }, paramMeta: {}, traceDisplaySettings: {} };
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [swap(k), walk(v)]));
  }
  return swap(o);
};
const body = JSON.stringify({ ...walk(patch), connections: patch.connections.filter((c) => c.sourceNode !== "dsfOscillator-1") });
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/clock-entry-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body }));
await page.goto(`${BASE}?pagePatch=clock-entry-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="clock-1"] .node-face') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.waitForTimeout(1500);
// Client point inside a widget part: key = param, frac = 0..1 across that part.
const point = (key) => page.evaluate((key) => {
  const article = document.querySelector('article[data-node="clock-1"]');
  const face = article.querySelector(".node-face");
  const spec = nodeGraphModuleFaceSpecForElement(article);
  const rect = face.getBoundingClientRect();
  const kx = rect.width / face.offsetWidth; const ky = rect.height / face.offsetHeight;
  for (const wd of nodeGraphModuleFaceWidgets(spec, face.offsetWidth, article)) {
    const keys = nodeGraphModuleFaceWidgetKeys(wd); const i = keys.indexOf(key);
    if (i < 0) continue;
    const part = wd.w / keys.length;
    return { x: rect.left + (wd.x + part * (i + 0.5)) * kx, y: rect.top + (wd.y + wd.h * 0.5) * ky };
  }
  return null;
}, key);
const param = (key) => page.evaluate((key) => Number(nodeGraphPatchNode("clock-1").params[key]), key);
async function typeIn(key, text) {
  const p = await point(key);
  if (!p) return { opened: false };
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForTimeout(150);
  const opened = await page.evaluate(() => Boolean(document.querySelector('article[data-node="clock-1"] .node-face input.node-slider-readout-input')));
  if (opened) { await page.keyboard.press("Control+A"); await page.keyboard.type(text); await page.keyboard.press("Enter"); }
  await page.waitForTimeout(250);
  const left = await page.evaluate(() => document.querySelectorAll('article[data-node="clock-1"] .node-face .node-face-value-edit').length);
  return { opened, left };
}
let r = await typeIn("rate", "12.5");
check(r.opened, "double-click on Rate cell opens the inline type-in");
check(Math.abs(await param("rate") - 12.5) < 1e-9, "typed Rate 12.5 is applied", String(await param("rate")));
check(r.left === 0, "type-in host removed after Enter");
r = await typeIn("pulseEnd", "0.75");
check(r.opened && Math.abs(await param("pulseEnd") - 0.75) < 1e-9, "double-click on the band's End half types Pulse End", String(await param("pulseEnd")));
r = await typeIn("phase", "0.25");
check(r.opened && Math.abs(await param("phase") - 0.25) < 1e-9, "double-click on the horizontal Phase slider types Phase", String(await param("phase")));
// Escape cancels.
const before = await param("amplitude");
{ const p = await point("amplitude"); await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(150); await page.keyboard.type("0.123"); await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
check(await param("amplitude") === before, "Escape cancels the type-in");
// Single click-drag still drags (no type-in on one press). Amp starts at max, so drag down.
{ const p = await point("amplitude"); await page.waitForTimeout(500); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x - 30, p.y + 30, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200); }
check(await param("amplitude") !== before && !(await page.evaluate(() => document.querySelector('article[data-node="clock-1"] .node-face input'))), "single press still drags, no type-in", JSON.stringify({ before, after: await param("amplitude"), input: await page.evaluate(() => Boolean(document.querySelector('article[data-node="clock-1"] .node-face input'))) }));
// Max Digits drives the face's shown digits (same formatter as the slider readout).
const digits = await page.evaluate(() => {
  const input = nodeGraphModuleFaceInput(document.querySelector('article[data-node="clock-1"]'), "rate");
  setNodeSliderValue(input, 12.345678, {});
  const out = {};
  for (const d of ["2", "4", "7"]) { input.dataset.maxDigits = d; out[d] = { face: nodeGraphModuleFaceValueText(input), readout: String(nodeSliderReadoutValueText(input)).trim() }; }
  return out;
});
check(new Set(Object.values(digits).map((v) => v.face)).size === 3 && Object.values(digits).every((v) => v.face.startsWith(v.readout)), "face digits follow Max Digits like the readout", JSON.stringify(digits));
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAILED ${failures}` : "smoke_module_face_type_in ok");
process.exit(failures ? 1 : 0);
