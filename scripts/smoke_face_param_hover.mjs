// Face widget hover shows that parameter's authored tooltip in the docked help bar.
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
    if (o.id === "dsfOscillator-1") {
      return {
        ...o, id: "clock-1", type: "clock",
        params: { rate: "2", phase: "0", pulseStart: "0.1", pulseEnd: "0.6", amplitude: "1" },
        paramMeta: {}, traceDisplaySettings: {},
      };
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [swap(k), walk(v)]));
  }
  return swap(o);
};
const body = JSON.stringify({ ...walk(patch), connections: patch.connections.filter((c) => c.sourceNode !== "dsfOscillator-1") });
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.route("**/clock-hover-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body }));
await page.goto(`${BASE}?pagePatch=clock-hover-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(
  () => document.querySelector('article[data-node="clock-1"] .node-face') && !document.body.classList.contains("node-boot-loading"),
  null,
  { timeout: 180000 },
);
await page.waitForTimeout(800);
const point = (key) => page.evaluate((key) => {
  const article = document.querySelector('article[data-node="clock-1"]');
  const face = article.querySelector(".node-face");
  const spec = nodeGraphModuleFaceSpecForElement(article);
  const rect = face.getBoundingClientRect();
  const kx = rect.width / face.offsetWidth;
  const ky = rect.height / face.offsetHeight;
  for (const wd of nodeGraphModuleFaceWidgets(spec, face.offsetWidth, article)) {
    const keys = nodeGraphModuleFaceWidgetKeys(wd);
    const i = keys.indexOf(key);
    if (i < 0) continue;
    const part = wd.w / keys.length;
    return { x: rect.left + (wd.x + part * (i + 0.5)) * kx, y: rect.top + (wd.y + wd.h * 0.5) * ky };
  }
  return null;
}, key);
async function hoverText(key) {
  const p = await point(key);
  if (!p) return "";
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(120);
  return page.evaluate(() => document.getElementById("nodeInteractionHelp")?.textContent || "");
}
const rateHelp = await hoverText("rate");
check(rateHelp.includes("Clock rate in Hz"), "hover Rate shows Rate tooltip", JSON.stringify(rateHelp));
const startHelp = await hoverText("pulseStart");
check(startHelp.includes("Where in the cycle the gate goes high"), "hover Pulse Start shows Start tooltip", JSON.stringify(startHelp));
const endHelp = await hoverText("pulseEnd");
check(endHelp.includes("Where in the cycle the gate goes low"), "hover Pulse End shows End tooltip", JSON.stringify(endHelp));
await b.close();
console.log(failures ? `FAILED ${failures}` : "smoke_face_param_hover ok");
process.exit(failures ? 1 : 0);
