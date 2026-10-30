// Hand-written module face smoke (rails plan PP-5, node-graph-module-face.js):
// Ping Pong Delay's Condensed 5 face. Checks the face replaces the slider rows,
// sets the body height, stacks rail jacks inside the module, and that each
// widget type drives its param: choice row, fraction steps + Normal/Dotted/
// Triplet, LFO style buttons, cells (vertical drag), filter curve handles, seed.
// Usage: node scripts/smoke_module_face.mjs   (server.py on :8765)
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

function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 40, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  d.nodes.push({ gx: 2, gy: 1, id: "pp-1", type: "pingPongDelay", params: {} });
  return JSON.stringify(d);
}

const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/face-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=face-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pp-1"] .node-face'), null, { timeout: 180000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const pp = document.querySelector('article[data-node="pp-1"]');
  const face = pp.querySelector(".node-face");
  const body = pp.querySelector(".dsp-node-body");
  const pr = pp.getBoundingClientRect();
  const ports = [...pp.querySelectorAll(".node-parameter-row:not([hidden]):not(.node-face-unplaced) > .node-param-port.parameter-output")];
  const tops = ports.map((p) => p.getBoundingClientRect().top);
  return {
    faceH: face.offsetHeight,
    specH: nodeGraphModuleFaceHeightPx("pingPongDelay"),
    bodyH: body.offsetHeight,
    sliders: [...pp.querySelectorAll(".node-parameter-control")].filter((c) => c.getBoundingClientRect().height > 0).length,
    portsInside: ports.every((p) => { const r = p.getBoundingClientRect(); return r.top >= pr.top - 0.5 && r.bottom <= pr.bottom + 0.5; }),
    portsOrdered: tops.every((t, i) => i === 0 || t >= tops[i - 1] - 0.5),
    ports: ports.length,
  };
});
check("face height matches the spec", info.faceH === info.specH && info.bodyH === info.specH, JSON.stringify(info));
check("no slider rows drawn", info.sliders === 0, info.sliders);
check("every placed thru jack sits inside the module", info.portsInside && info.ports >= 16, JSON.stringify(info));

const val = (key) => page.evaluate((k) => Number(nodeGraphMvp.patch.nodes.find((n) => n.id === "pp-1").params[k]), key);
const widget = (pred) => page.evaluate((src) => {
  const pp = document.querySelector('article[data-node="pp-1"]');
  const face = pp.querySelector(".node-face");
  const f = new Function("wd", `return (${src})(wd);`);
  const wd = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpec("pingPongDelay"), face.offsetWidth).find(f);
  const r = face.getBoundingClientRect();
  const k = r.width / face.offsetWidth;
  return { x: r.left + (wd.x + wd.w / 2) * k, y: r.top + (wd.y + wd.h / 2) * k, w: wd.w * k, h: wd.h * k };
}, pred.toString());
const click = async (pred) => { const p = await widget(pred); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); };
const drag = async (pred, dx, dy, at = 0) => {
  const p = await widget(pred);
  const x = p.x + at * p.w;
  await page.mouse.move(x, p.y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, p.y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, p.y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
};

await click((wd) => wd.type === "choice" && wd.index === 2);
check("choice row: LMR sets Mode 2", (await val("pingPong")) === 2, await val("pingPong"));
await click((wd) => wd.type === "subChoice" && wd.index === 2);
check("Triplet sets timingMode 2", (await val("timingMode")) === 2, await val("timingMode"));
await click((wd) => wd.type === "lfoStyle" && wd.index === 1);
check("LFO style button: Walk sets lfoStyle 1", (await val("lfoStyle")) === 1, await val("lfoStyle"));
const den0 = await val("timeDenominator");
await drag((wd) => wd.type === "step" && wd.param === "timeDenominator", 0, -30);
check("fraction: dragging the denominator up steps it", (await val("timeDenominator")) > den0, `${den0} -> ${await val("timeDenominator")}`);
const fb0 = await val("feedback");
await drag((wd) => wd.type === "cell" && wd.param === "feedback", 0, -60);
check("cell: dragging Feedback up raises it", (await val("feedback")) > fb0, `${fb0} -> ${await val("feedback")}`);
const off0 = await val("offset");
await drag((wd) => wd.type === "cell" && wd.param === "offset", 0, 40);
check("bipolar Offset cell: dragging down lowers it", (await val("offset")) < off0, `${off0} -> ${await val("offset")}`);
const lpf0 = await val("lpfFrequency");
const curve = await page.evaluate(() => {
  const face = document.querySelector('article[data-node="pp-1"] .node-face');
  const wd = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpec("pingPongDelay"), face.offsetWidth).find((w) => w.type === "filter");
  const lpf = Number(nodeGraphMvp.patch.nodes.find((n) => n.id === "pp-1").params.lpfFrequency);
  return { at: nodeGraphModuleFaceLogT(lpf) - 0.5 };
});
await drag((wd) => wd.type === "filter", -40, 0, curve.at);
check("filter curve: dragging the LPF handle left lowers LPF", (await val("lpfFrequency")) < lpf0, `${lpf0} -> ${await val("lpfFrequency")}`);
const seed0 = await val("seed");
// + steps the last letter of the 4-character seed code (84877a07), not the raw number.
const seedPlus = await page.evaluate((s) => stepNodeGraphSeedCode(s, 3, 1), seed0);
await click((wd) => wd.type === "seedButton" && wd.action === "plus");
check("seed + steps the last code letter", (await val("seed")) === seedPlus, `${seed0} -> ${await val("seed")} (want ${seedPlus})`);
await click((wd) => wd.type === "seedButton" && wd.action === "dice");
check("seed die rolls", (await val("seed")) !== seedPlus);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
if (SHOT) await page.locator('article[data-node="pp-1"]').screenshot({ path: path.join(SHOT, "rails3-pingpong-face.png") });
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all module face checks passed");
process.exitCode = failures.length ? 1 : 0;
