// Span face row (node-graph-module-face.js kind "span", N handles, superdot
// falloff law), first used by Pulse Explosion (Start / Center / End). Checks the
// face places every visible param once, sets the body height, and that the span
// drives its params through the shared slider setter: a handle moves alone and
// stops at its neighbour, a press between two handles moves that pair, the pair
// stops at the next handle, Ctrl+click resets, and undo restores.
// Usage: node scripts/smoke_module_face_span.mjs   (server.py on :8765)
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
  d.nodes.push({ gx: 2, gy: 1, id: "pe-1", type: "pulseExplosion", params: { startTime: 1, centerTime: 4, endTime: 7 } });
  return JSON.stringify(d);
}

const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/span-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=span-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pe-1"] .node-face'), null, { timeout: 180000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const el = document.querySelector('article[data-node="pe-1"]');
  const face = el.querySelector(".node-face");
  const spec = nodeGraphModuleFaceSpec("pulseExplosion");
  const placed = spec.flatMap((row) => nodeGraphModuleFaceRowParams(row));
  const visible = nodeGraphModuleDefinitions.pulseExplosion.parameters.filter((p) => !p.hidden).map((p) => p.key);
  return {
    faceH: face.offsetHeight,
    specH: nodeGraphModuleFaceHeightPx("pulseExplosion"),
    sliders: [...el.querySelectorAll(".node-parameter-control")].filter((c) => c.getBoundingClientRect().height > 0).length,
    once: placed.length === new Set(placed).size && visible.every((k) => placed.includes(k)) && placed.length === visible.length,
    span: nodeGraphModuleFaceWidgetKeys(nodeGraphModuleFaceWidgets(spec, face.offsetWidth).find((wd) => wd.type === "span")).join(","),
  };
});
check("face height matches the spec", info.faceH === info.specH, JSON.stringify(info));
check("no slider rows drawn", info.sliders === 0, info.sliders);
check("every visible param placed exactly once", info.once);
check("span owns Start / Center / End", info.span === "startTime,centerTime,endTime", info.span);

const vals = () => page.evaluate(() => {
  const p = nodeGraphMvp.patch.nodes.find((n) => n.id === "pe-1").params;
  return { s: Number(p.startTime), c: Number(p.centerTime), e: Number(p.endTime) };
});
const box = () => page.evaluate(() => {
  const face = document.querySelector('article[data-node="pe-1"] .node-face');
  const wd = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpec("pulseExplosion"), face.offsetWidth).find((w) => w.type === "span");
  const r = face.getBoundingClientRect();
  const k = r.width / face.offsetWidth;
  return { x: r.left + wd.x * k, y: r.top + (wd.y + wd.h * 0.7) * k, w: wd.w, k };
});
const drag = async (v, dx, mods = []) => {
  const b = await box();
  // Bar spans wd.x + 4 .. wd.x + w - 4 (face px); all three params share 0..10 s linear travel.
  const x = b.x + (4 + (v / 10) * (b.w - 8)) * b.k;
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x, b.y);
  if (typeof dx === "function") dx = dx(b);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, b.y, { steps: 4 });
  await page.mouse.move(x + dx, b.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await page.waitForTimeout(200);
};
const near = (a, b) => Math.abs(a - b) < 0.03;

// Start 1, Center 4, End 7 (of 0..10 s).
let v0 = await vals();
await drag(v0.c, 25);
let v1 = await vals();
check("Center handle moves Center alone", v1.c > v0.c + 0.3 && near(v1.s, v0.s) && near(v1.e, v0.e), `${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`);
await page.evaluate(() => undoNodeGraphPatch());
await page.waitForTimeout(400);
const vu = await vals();
check("undo restores Center", near(vu.c, v0.c), JSON.stringify(vu));
v0 = await vals();
await drag((v0.s + v0.c) / 2, 12);
v1 = await vals();
check("press between Start and Center moves that pair only", v1.s > v0.s + 0.1 && near(v1.c - v0.c, v1.s - v0.s) && near(v1.e, v0.e), `${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`);
v0 = await vals();
await drag((v0.s + v0.c) / 2, (b) => (((v0.e - v0.c) / 10) * (b.w - 8) + 40) * b.k);
v1 = await vals();
check("the pair stops at End (no crossing, no pushing)", near(v1.c, v0.e) && near(v1.e, v0.e) && near(v1.c - v1.s, v0.c - v0.s), `${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`);
v0 = await vals();
await drag(v0.e, 25);
v1 = await vals();
check("End handle moves End alone", v1.e > v0.e + 0.3 && near(v1.s, v0.s) && near(v1.c, v0.c), `${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`);
v0 = await vals();
await drag(v0.s, (b) => (((v0.c - v0.s) / 10) * (b.w - 8) + 40) * b.k);
v1 = await vals();
check("Start handle stops at Center", near(v1.s, v0.c) && near(v1.c, v0.c) && near(v1.e, v0.e), `${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`);
const input = await page.evaluate(() => Number(document.querySelector('article[data-node="pe-1"] .node-parameter-row[data-param="startTime"] input[type="range"]').dataset.domainValue));
check("hidden slider input follows the face (shared source)", near(input, v1.s), `${input} vs ${v1.s}`);
await drag(v1.e, 0, [process.platform === "darwin" ? "Meta" : "Control"]);
const vr = await vals();
check("Ctrl+click resets the span params to defaults", near(vr.s, 0) && near(vr.c, 0.5) && near(vr.e, 1), JSON.stringify(vr));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
if (SHOT) await page.locator('article[data-node="pe-1"]').screenshot({ path: path.join(SHOT, "pulse-explosion-span.png") });
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all span face checks passed");
process.exitCode = failures.length ? 1 : 0;
