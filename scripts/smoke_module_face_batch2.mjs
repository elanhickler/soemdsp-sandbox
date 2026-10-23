// Batch 2 faces (node-graph-module-face.js): oscillators, filters, utilities,
// envelopes, Delay. Per module: the face replaces the slider rows, places every
// visible param exactly once and sets the body height. Every choice button stores
// its own index, dragging the first cell up raises it (whole steps stay whole),
// and undo restores it.
// Usage: node scripts/smoke_module_face_batch2.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const TYPES = (process.env.FACE_TYPES || "blit,sineWarp,surgeOscillator,superloveFilter,resonatorFilter,humanFilter,modeResonator,pll,hilbert,inertialFilter,vactrol,pingEnvelope,timeQuantizer,pitchHz,ampDb,ampCurve,randomWalk,sinc,delayEffect").split(",");
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(label);
};

function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 60, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  const params = {};
  // Five columns: every face stays on screen (off-screen modules are culled).
  TYPES.forEach((type, i) => d.nodes.push({ gx: 2 + (i % 5) * 13, gy: 1 + Math.floor(i / 5) * 26, id: `m-${i}`, type, params: params[type] || {} }));
  return JSON.stringify(d);
}

const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 3600, height: 9000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/batch-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=batch-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction((n) => document.querySelectorAll("article .node-face").length >= n, TYPES.length, { timeout: 180000 });
await page.waitForTimeout(2500);

for (let i = 0; i < TYPES.length; i += 1) {
  const type = TYPES[i];
  const info = await page.evaluate(({ id, type }) => {
    const el = document.querySelector(`article[data-node="${id}"]`);
    const face = el?.querySelector(".node-face");
    if (!face) return { missing: true };
    const node = nodeGraphPatchNode(id);
    const spec = nodeGraphModuleFaceSpec(type, node);
    const placed = spec.flatMap((row) => nodeGraphModuleFaceRowParams(row));
    const visible = nodeGraphModuleDefinitions[type].parameters
      .filter((p) => nodeGraphParameterEffectiveVisible(p, node.paramMeta?.[p.key])).map((p) => p.key);
    return {
      faceH: face.offsetHeight,
      specH: nodeGraphModuleFaceHeightPx(type, node),
      sliders: [...el.querySelectorAll(".node-parameter-control")].filter((c) => c.getBoundingClientRect().height > 0).length,
      dup: placed.length !== new Set(placed).size,
      missingKeys: visible.filter((k) => !placed.includes(k)),
      extra: placed.filter((k) => !visible.includes(k)),
    };
  }, { id: `m-${i}`, type });
  check(`${type}: face mounted, height matches the spec`, !info.missing && info.faceH === info.specH, JSON.stringify(info));
  check(`${type}: no slider rows drawn`, info.sliders === 0, info.sliders);
  check(`${type}: every visible param placed exactly once`, !info.dup && !info.missingKeys?.length && !info.extra?.length, JSON.stringify(info));
}

const val = (id, key) => page.evaluate(({ id, key }) => Number(nodeGraphMvp.patch.nodes.find((n) => n.id === id).params[key]), { id, key });
const widgets = (id, type) => page.evaluate(({ id, type }) => {
  const el = document.querySelector(`article[data-node="${id}"]`);
  const face = el.querySelector(".node-face");
  const r = face.getBoundingClientRect();
  const k = r.width / face.offsetWidth;
  return nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpec(type, nodeGraphPatchNode(id)), face.offsetWidth, el).map((wd) => {
    const keys = nodeGraphModuleFaceWidgetKeys(wd);
    const t = wd.type === "band" ? keys.map((key) => nodeGraphModuleFaceTravel(nodeGraphModuleFaceInput(el, key))) : [];
    return { type: wd.type, keys, x: r.left + wd.x * k, y: r.top + (wd.y + wd.h / 2) * k, w: wd.w * k, t };
  });
}, { id, type });
const drag = async (x, y, dx, dy) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};

const choiceLabel = (id, key) => page.evaluate(({ id, key }) => String(nodeSliderChoiceLabel(nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key))), { id, key });
const click = async (wd) => { await page.mouse.click(wd.x + wd.w / 2, wd.y); await page.waitForTimeout(500); };
for (let i = 0; i < TYPES.length; i += 1) {
  const id = `m-${i}`;
  const ws = await widgets(id, TYPES[i]);
  const keys = [...new Set(ws.filter((w) => w.type === "choice").map((w) => w.keys[0]))];
  for (const key of keys) {
    const btns = ws.filter((w) => w.type === "choice" && w.keys[0] === key);
    for (let k = btns.length - 1; k >= 0; k -= 1) {
      await click(btns[k]);
      const want = await page.evaluate(({ t, key, k }) => String(nodeGraphModuleDefinitions[t].parameters.find((p) => p.key === key).choices[k]), { t: TYPES[i], key, k });
      const shown = await choiceLabel(id, key);
      check(`${TYPES[i]}: ${key} button ${k} selects ${want}`, shown === want, `shown "${shown}"`);
    }
  }
  const cell = ws.find((w) => w.type === "cell");
  if (!cell) continue;
  const key = cell.keys[0];
  const c0 = await val(id, key);
  const atMax = await page.evaluate(({ id, key }) => { const n = nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key); return Number(n.value) >= Number(n.max); }, { id, key });
  await drag(cell.x + cell.w / 2, cell.y, 0, atMax ? 40 : -40);
  const c1 = await val(id, key);
  check(`${TYPES[i]}: dragging ${key} ${atMax ? "down lowers" : "up raises"} it`, atMax ? c1 < c0 : c1 > c0, `${c0} -> ${c1}`);
  const step = await page.evaluate(({ t, key }) => Number(nodeGraphModuleDefinitions[t].parameters.find((p) => p.key === key).step), { t: TYPES[i], key });
  if (step >= 1) check(`${TYPES[i]}: ${key} stays whole`, Number.isInteger(c1), c1);
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForFunction(({ id, key, c0 }) => Math.abs(Number(nodeGraphMvp.patch.nodes.find((n) => n.id === id).params[key]) - c0) < 1e-6, { id, key, c0 }, { timeout: 5000 }).catch(() => {});
  check(`${TYPES[i]}: undo restores ${key}`, Math.abs((await val(id, key)) - c0) < 1e-6, await val(id, key));
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
if (SHOT) {
  for (let i = 0; i < TYPES.length; i += 1) {
    await page.locator(`article[data-node="m-${i}"]`).screenshot({ path: path.join(SHOT, `face-${TYPES[i]}.png`) });
  }
}
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all batch 2 face checks passed");
process.exitCode = failures.length ? 1 : 0;