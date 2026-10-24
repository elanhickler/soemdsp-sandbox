// Percussion faces (node-graph-module-face.js): Electro Kick / Snare / Hat /
// Tom / Clap, Modal Snare, Sweep Kick (robinSinepulse), Allpass Zap
// (robinSinepulseAllpass), Drummer, Percussion. Per module: the face replaces the
// slider rows, places every visible param exactly once and sets the body height.
// Then every model button selects its own choice (the readout label matches the
// button), dragging the first cell up raises it, a bipolar cell fills from the
// middle, Latch sets the param, and undo restores.
// Usage: node scripts/smoke_module_face_percussion.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const TYPES = (process.env.FACE_TYPES || "electroKick,electroSnare,electroHat,electroTom,electroClap,modalSnare,robinSinepulse,robinSinepulseAllpass,drummer,percussion").split(",");
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
  // Three columns, two rows: every face stays on screen (off-screen modules are culled).
  TYPES.forEach((type, i) => d.nodes.push({ gx: 2 + (i % 3) * 11, gy: 1 + Math.floor(i / 3) * 26, id: `m-${i}`, type, params: params[type] || {} }));
  return JSON.stringify(d);
}

const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 2400, height: 5200 } })).newPage();
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
      sliders: [...el.querySelectorAll(".node-parameter-row:not(.node-face-slider-row) > .node-parameter-control")].filter((c) => c.getBoundingClientRect().height > 0).length,
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

const choiceLabel = (id, key) => page.evaluate(({ id, key }) => {
  const input = nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key);
  return String(typeof nodeSliderChoiceLabel === "function" ? nodeSliderChoiceLabel(input) : "");
}, { id, key });
const raw = (id, key) => page.evaluate(({ id, key }) => nodeGraphMvp.patch.nodes.find((n) => n.id === id).params[key], { id, key });
const click = async (wd) => { await page.mouse.click(wd.x + wd.w / 2, wd.y); await page.waitForTimeout(200); };
for (let i = 0; i < TYPES.length; i += 1) {
  const id = `m-${i}`;
  const ws = await widgets(id, TYPES[i]);
  // Model buttons: the first choices row that is not Recalc.
  const modelRow = await page.evaluate(({ id }) => {
    const skip = new Set(["recalculateOnTrigger", "voiceFade"]);
    const row = nodeGraphModuleFaceSpec(nodeGraphPatchNode(id).type).find((r) => r.kind === "choices" && !skip.has(r.param));
    return row ? { param: row.param, labels: row.labels } : { param: "", labels: [] };
  }, { id });
  const labels = modelRow.labels;
  const models = ws.filter((w) => w.type === "choice" && w.keys[0] === modelRow.param);
  for (let k = models.length - 1; k >= 0; k -= 1) {
    await click(models[k]);
    const shown = await choiceLabel(id, modelRow.param);
    const catalog = await page.evaluate(({ t, key, k }) => String(nodeGraphModuleDefinitions[t].parameters.find((p) => p.key === key)?.choices?.[k] ?? ""), { t: TYPES[i], key: modelRow.param, k });
    check(`${TYPES[i]}: model button ${labels[k]} selects ${labels[k]}`, shown === labels[k] || shown === catalog, `shown "${shown}", stored ${JSON.stringify(await raw(id, modelRow.param))}`);
  }
  const sliderRows = await page.evaluate((id) => [...document.querySelectorAll(`article[data-node="${id}"] .node-parameter-row.node-face-slider-row`)].map((r) => {
    const c = (r.querySelector(".node-slider-readout") || r.querySelector(".node-parameter-control")).getBoundingClientRect();
    return { key: r.dataset.param, x: c.left, w: c.width, y: c.top + c.height / 2, h: c.height };
  }), id);
  for (const sw of sliderRows) {
    check(`${TYPES[i]}: ${sw.key} shows its own slider row`, sw.w > 40 && sw.h > 10, JSON.stringify(sw));
    const l0 = await choiceLabel(id, sw.key);
    const swMax = await page.evaluate(({ id, key }) => { const n = nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key); return Number(n.value) >= Number(n.max); }, { id, key: sw.key });
    const swMin = await page.evaluate(({ id, key }) => { const n = nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key); return Number(n.value) <= Number(n.min); }, { id, key: sw.key });
    const from = swMin || !swMax ? 0.2 : 0.8;
    const to = from < 0.5 ? 0.8 : 0.2;
    await drag(sw.x + sw.w * from, sw.y, sw.w * (to - from), 0);
    const l1 = await choiceLabel(id, sw.key);
    check(`${TYPES[i]}: switch ${sw.key} drag changes choice`, l1 !== l0 && l1 !== "", `${l0} -> ${l1}`);
    await page.evaluate(() => undoNodeGraphPatch());
    await page.waitForFunction(({ id, key, l0 }) => String(nodeSliderChoiceLabel(nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key))) === l0, { id, key: sw.key, l0 }, { timeout: 5000 }).catch(() => {});
    check(`${TYPES[i]}: undo restores ${sw.key}`, (await choiceLabel(id, sw.key)) === l0, await choiceLabel(id, sw.key));
  }
  const cell = ws.find((w) => w.type === "cell");
  if (!cell) continue;
  const key = cell.keys[0];
  const c0 = await val(id, key);
  const atMax = await page.evaluate(({ id, key }) => { const n = nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), key); return Number(n.value) >= Number(n.max); }, { id, key });
  await drag(cell.x + cell.w / 2, cell.y, 0, atMax ? 40 : -40);
  const c1 = await val(id, key);
  check(`${TYPES[i]}: dragging ${key} ${atMax ? "down lowers" : "up raises"} it`, atMax ? c1 < c0 : c1 > c0, `${c0} -> ${c1}`);
  if (TYPES[i] === "percussion") check("Percussion Channel stays a whole number", Number.isInteger(c1), c1);
  if (TYPES[i] === "robinSinepulseAllpass") check("Allpass Zap Stages stays a whole number", Number.isInteger(c1), c1);
  const recalc = ws.filter((w) => w.type === "choice" && w.keys[0] === "recalculateOnTrigger");
  if (recalc.length) {
    await click(recalc[1]);
    check(`${TYPES[i]}: Latch`, (await choiceLabel(id, "recalculateOnTrigger")) === "Latch", await choiceLabel(id, "recalculateOnTrigger"));
  }
}
const rIdx = TYPES.indexOf("robinSinepulse");
if (rIdx >= 0) {
  const t = await page.evaluate((id) => nodeGraphModuleFaceValueText(nodeGraphModuleFaceInput(document.querySelector(`article[data-node="${id}"]`), "sweepTime")), `m-${rIdx}`);
  check("Sweep Kick Time shows its display unit (ms)", /ms$/.test(t), t);
}
const mIdx = TYPES.indexOf("modalSnare");
if (mIdx >= 0) {
  const tilt = (await widgets(`m-${mIdx}`, "modalSnare")).find((w) => w.keys[0] === "noiseTilt");
  const bip = await page.evaluate(() => nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpec("modalSnare"), 184).find((w) => w.param === "noiseTilt")?.bipolar);
  check("Modal Snare Tilt is a bipolar cell", bip === true, bip);
  const t0 = await val(`m-${mIdx}`, "noiseTilt");
  await drag(tilt.x + tilt.w / 2, tilt.y, 0, 30);
  const t1 = await val(`m-${mIdx}`, "noiseTilt");
  check("Modal Snare Tilt: dragging down goes negative", t1 < t0 && t1 < 0, `${t0} -> ${t1}`);
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForTimeout(400);
  check("undo restores Tilt", Math.abs((await val(`m-${mIdx}`, "noiseTilt")) - t0) < 1e-6, await val(`m-${mIdx}`, "noiseTilt"));
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
if (SHOT) {
  for (let i = 0; i < TYPES.length; i += 1) {
    await page.locator(`article[data-node="m-${i}"]`).screenshot({ path: path.join(SHOT, `perc-${TYPES[i]}.png`) });
  }
}
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all percussion face checks passed");
process.exitCode = failures.length ? 1 : 0;
