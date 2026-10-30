// Controls keep their proportions when rails open (no stretched text/cells).
// Every spawn-layout module type is placed (in pages), first at rest, then with
// both rails open ("Mod rail" always-on). The GL text renderer reports the
// x/y scale of every glyph quad (nodeGraphGlLinesTextAspectStats); any ratio
// off 1 means a glyph was squeezed/stretched instead of shrunk uniformly.
// Face cells are checked too: each Ping Pong face widget's on-screen box must
// keep its layout aspect.
// Usage: node scripts/smoke_text_aspect.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR, SHOT_NAME (default stretch) optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const NAME = process.env.SHOT_NAME || "stretch";
const PAGE = 12;
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(label);
};

const base = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
// FAR_GX / FAR_GY shift every module away from the world origin (GL camera batches use world px).
const FAR = { gx: Number(process.env.FAR_GX || 0), gy: Number(process.env.FAR_GY || 0) };
base.nodes = base.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 120 + FAR.gx, gy: 1 + FAR.gy }));
base.connections = [];
base.graphConnections = [];
base.modulations = [];

const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1800, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/aspect-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(base) }));
await page.goto(`${BASE}?pagePatch=aspect-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof nodeGraphGlLinesTextAspectStats === "function" && document.querySelector('article[data-node="output"]'), null, { timeout: 180000 });
await page.waitForTimeout(2000);

const types = await page.evaluate(() => Object.entries(nodeGraphModuleDefinitions)
  .filter(([, d]) => d.faceLayout === "spawn" && (d.parameters || []).some((p) => !p.hidden))
  .map(([t]) => t).sort((a, b) => (a === "pingPongDelay" ? -1 : b === "pingPongDelay" ? 1 : a.localeCompare(b))));
// Types that cannot stand alone in a patch (validation rejects them) are skipped.
const loadable = await page.evaluate(({ types, base }) => types.filter((type) => {
  const patch = JSON.parse(JSON.stringify(base));
  patch.nodes.push({ id: "m-0", type, gx: 1, gy: 1, params: {} });
  try { loadNodeGraphPatchFromObject(patch); return true; } catch { return false; }
}), { types, base });
await page.getByRole("button", { name: "Close", exact: true }).click({ timeout: 3000 }).catch(() => {});
console.log(`spawn types with params: ${types.length}, loadable alone: ${loadable.length}`);
types.splice(0, types.length, ...loadable.slice(0, Number(process.env.LIMIT) || loadable.length));

const load = (list, open, far = FAR) => page.evaluate(({ list, open, base, far }) => {
  const patch = JSON.parse(JSON.stringify(base));
  list.forEach((type, i) => patch.nodes.push({
    id: `m-${i}`, type, gx: far.gx + 1 + (i % 6) * 10, gy: far.gy + 1 + Math.floor(i / 6) * 26, params: {},
    ui: open ? { modRailAlwaysOn: true } : {},
  }));
  commitNodeGraphPatch(loadNodeGraphPatchFromObject(patch), { status: "aspect smoke" });
  if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(0.62);
  // Centre on the test modules only: centring on every module also counts the
  // base patch's Output near the origin, which leaves the far modules off screen.
  const mods = [...document.querySelectorAll('article.dsp-node[data-node^="m-"]')];
  const b = typeof nodeGraphModuleBoundsUnion === "function" ? nodeGraphModuleBoundsUnion(mods) : null;
  if (b) {
    const z = nodeGraphZoom();
    setNodeGraphPan(-((b.left + b.right) / 2) * z, -((b.top + b.bottom) / 2) * z, { immediate: true });
  } else {
    nodeGraphCenterViewOnModules({ preferSelection: false });
  }
}, { list, open, base, far });
const measure = async () => {
  await page.evaluate(() => nodeGraphGlLinesTextAspectStats(true));
  await page.waitForTimeout(900);
  return page.evaluate(() => nodeGraphGlLinesTextAspectStats(false));
};

let worst = { rest: 1, open: 1 };
const offenders = new Set();
for (let i = 0; i < types.length; i += PAGE) {
  const list = types.slice(i, i + PAGE);
  for (const open of [false, true]) {
    await load(list, open);
    await page.waitForTimeout(700);
    const stats = await measure();
    const key = open ? "open" : "rest";
    const r = Math.min(stats.minRatio, 1 / Math.max(1e-9, stats.maxRatio));
    if (r < worst[key]) worst[key] = r;
    if (r < 0.99) offenders.add(`${key}:${list[0]}..${list[list.length - 1]} (${r.toFixed(2)})`);
    if (SHOT && i === 0) await page.screenshot({ path: path.join(SHOT, `${NAME}-${key}.png`) });
  }
}
console.log(`worst glyph x/y ratio: rest ${worst.rest.toFixed(3)}, rails open ${worst.open.toFixed(3)}`);
check("glyphs keep their aspect at rest (every module type)", worst.rest > 0.99, [...offenders].filter((o) => o.startsWith("rest")).slice(0, 6).join("; "));
check("glyphs keep their aspect with both rails open (every module type)", worst.open > 0.99, [...offenders].filter((o) => o.startsWith("open")).slice(0, 6).join("; "));

// Face cells: on-screen box aspect = layout box aspect, rails open.
await load(["pingPongDelay"], true);
await page.waitForTimeout(900);
const cells = await page.evaluate(() => {
  const el = document.querySelector('article[data-node="m-0"]');
  const face = el.querySelector(".node-face");
  const r = face.getBoundingClientRect();
  const kx = r.width / face.offsetWidth;
  const ky = r.height / face.offsetHeight;
  const widgets = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpec("pingPongDelay"), face.offsetWidth);
  return { kx, ky, n: widgets.length, minW: Math.min(...widgets.filter((w) => w.type !== "slash").map((w) => w.w)) };
});
check("face cells scale uniformly (kx = ky)", Math.abs(cells.kx - cells.ky) < 0.01, JSON.stringify(cells));
check("face controls reflow to the narrower width (no control < 18 px)", cells.minW >= 18, JSON.stringify(cells));
// Face + rails must draw for a module far from the world origin (B: screen cull on camera batches).
await load(["pingPongDelay"], true, { gx: 260, gy: -70 });
await page.waitForTimeout(900);
const far = await page.evaluate(async () => {
  const el = document.querySelector('article[data-node="m-0"]');
  const of = window.nodeGraphModuleFaceDrawGl;
  let face = 0;
  window.nodeGraphModuleFaceDrawGl = function (...a) { face += 1; return of.apply(this, a); };
  if (typeof nodeGraphGlGraphMarkDirty === "function") nodeGraphGlGraphMarkDirty();
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => setTimeout(r, 1200));
  window.nodeGraphModuleFaceDrawGl = of;
  const r = el.getBoundingClientRect();
  return { face, onScreen: r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight, x: nodeGraphMvp.patch.nodes.find((n) => n.id === "m-0").gx };
});
if (SHOT) {
  await page.evaluate(() => { setNodeGraphZoom(1.3); nodeGraphCenterViewOnModules({ preferSelection: false }); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT, `${NAME}-far.png`) });
}
check("face draws for a module far from the origin (rails open)", far.face > 0, JSON.stringify(far));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all text aspect checks passed");
process.exitCode = failures.length ? 1 : 0;
