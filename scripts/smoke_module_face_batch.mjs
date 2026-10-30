// UI overhaul batch: hand-written faces for Metronome (transport), Random Clock,
// Range, RMS Stereo and Shooting Star Explosion (node-graph-module-face.js).
// Per module: the face replaces the slider rows, places every visible param
// exactly once and sets the body height. Then each band moves both ends from
// its middle, Metronome's musical division steps, and undo restores.
// Usage: node scripts/smoke_module_face_batch.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const TYPES = ["transport", "randomClock", "range", "rmsStereo", "shootingStarExplosion"];
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
  // Range ends start apart so a press in the middle of each band grabs the span.
  const params = { range: { inLow: -5, inHigh: 5, outLow: -6, outHigh: 6 }, rmsStereo: { minDb: -40, maxDb: -8 },
    randomClock: { minSeconds: 10, maxSeconds: 40 }, shootingStarExplosion: { lowRange: 0.2, highRange: 0.7 } };
  // Three columns, two rows: every face stays on screen (off-screen modules are culled).
  TYPES.forEach((type, i) => d.nodes.push({ gx: 2 + (i % 3) * 11, gy: 1 + Math.floor(i / 3) * 20, id: `m-${i}`, type, params: params[type] || {} }));
  return JSON.stringify(d);
}

const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 2400, height: 2600 } })).newPage();
// undoNodeGraphPatch applies two animation frames later (after the button glow).
// Wait until the history index moves, or the undo can land on a later click.
const undo = () => page.evaluate(() => new Promise((resolve) => {
  const before = nodeGraphMvp.historyIndex;
  undoNodeGraphPatch();
  const t0 = performance.now();
  const poll = () => (nodeGraphMvp.historyIndex !== before || performance.now() - t0 > 5000 ? resolve() : setTimeout(poll, 10));
  poll();
}));
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

for (let i = 0; i < TYPES.length; i += 1) {
  const id = `m-${i}`;
  for (const wd of (await widgets(id, TYPES[i])).filter((w) => w.type === "band")) {
    const [lo, hi] = wd.keys;
    const a0 = await val(id, lo);
    const b0 = await val(id, hi);
    const mid = wd.x + ((wd.t[0] + wd.t[1]) / 2) * wd.w;
    await drag(mid, wd.y, 12, 0);
    const a1 = await val(id, lo);
    const b1 = await val(id, hi);
    check(`${TYPES[i]} band ${lo}/${hi}: middle drag moves both ends up`, a1 > a0 && b1 > b0, `${a0},${b0} -> ${a1},${b1}`);
  }
}
const tIdx = TYPES.indexOf("transport");
const den = (await widgets(`m-${tIdx}`, "transport")).find((w) => w.type === "step" && w.keys[0] === "timeDenominator");
const d0 = await val(`m-${tIdx}`, "timeDenominator");
if (!Number.isFinite(den?.x + den?.y + den?.w)) console.log("den widget", JSON.stringify(den));
if (Number.isFinite(den?.x + den?.y + den?.w)) await drag(den.x + den.w / 2, den.y, 0, -30);
const d1 = await val(`m-${tIdx}`, "timeDenominator");
check("Metronome division: dragging the denominator up steps it", d1 > d0, `${d0} -> ${d1}`);
await undo();
await page.waitForTimeout(400);
check("undo restores the denominator", (await val(`m-${tIdx}`, "timeDenominator")) === d0, await val(`m-${tIdx}`, "timeDenominator"));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
if (SHOT) {
  for (let i = 0; i < TYPES.length; i += 1) {
    await page.locator(`article[data-node="m-${i}"]`).screenshot({ path: path.join(SHOT, `face-${TYPES[i]}.png`) });
  }
}
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all face batch checks passed");
process.exitCode = failures.length ? 1 : 0;
