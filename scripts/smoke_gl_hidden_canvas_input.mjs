// Flags pointer/mouse/touch/click/wheel listeners attached to a display canvas
// (or svg) that the GL graph hides with visibility:hidden. A hidden element is
// not hit-tested, so such a listener never fires; route it through the visible
// parent. Spawns every module type on an empty patch with the GL graph on.
// Usage: node scripts/smoke_gl_hidden_canvas_input.mjs  (SANDBOX_URL, default :8765)
// Needs a real GPU: headed by default.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const INPUT = ["pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup", "click", "dblclick", "wheel", "touchstart", "contextmenu"];
const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message || String(e)));
await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
await page.addInitScript((input) => {
  const seen = new WeakMap();
  window.__inputListenerTypes = (el) => [...(seen.get(el) || [])];
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (input.includes(type) && (this instanceof HTMLCanvasElement || this instanceof SVGSVGElement)) {
      if (!seen.has(this)) seen.set(this, new Set());
      seen.get(this).add(type);
    }
    return orig.call(this, type, fn, opts);
  };
}, INPUT);
await page.goto(`${BASE}?pagePatch=musicplayer`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof showNodeGraphModule === "function" && typeof nodeGraphModuleDefinitions === "object"
  && document.querySelectorAll("article[data-node-type]").length > 0, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  const types = Object.keys(nodeGraphModuleDefinitions);
  let i = 0;
  const failedSpawn = [];
  for (const t of types) {
    try { showNodeGraphModule(t, { x: 40 + (i % 8) * 210, y: 60 + Math.floor(i / 8) * 260 }, {}); } catch (e) { failedSpawn.push(t); }
    i += 1;
    if (i % 10 === 0) await new Promise((res) => setTimeout(res, 50));
  }
  await new Promise((res) => setTimeout(res, 3000));
  const ws = document.querySelector(".node-graph-workspace");
  const glOn = Boolean(ws?.classList.contains("gl-graph-on"));
  const bad = [];
  for (const el of document.querySelectorAll("article[data-node-type] canvas, article[data-node-type] svg")) {
    const types = window.__inputListenerTypes(el);
    if (!types.length) continue;
    if (getComputedStyle(el).visibility !== "hidden") continue;
    const art = el.closest("article[data-node-type]");
    bad.push({ type: art.dataset.nodeType, el: `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(" ").join(".")}`, listeners: types.join(",") });
  }
  const uniq = [...new Map(bad.map((b) => [`${b.type}|${b.el}`, b])).values()];
  return { glOn, spawned: types.length - failedSpawn.length, failedSpawn: failedSpawn.length, bad: uniq };
});
console.log(`gl-graph-on=${r.glOn} spawned=${r.spawned} (spawn errors ${r.failedSpawn})`);
for (const b of r.bad) console.log(`FAIL ${b.type}: ${b.el} has [${b.listeners}] but is visibility:hidden`);
await browser.close();
if (!r.glOn) { console.error("FAIL GL graph not on"); process.exit(1); }
if (r.bad.length) { console.error(`${r.bad.length} hidden canvas input listener(s)`); process.exit(1); }
console.log("smoke_gl_hidden_canvas_input ok");
