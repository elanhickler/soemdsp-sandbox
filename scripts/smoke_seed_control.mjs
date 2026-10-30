// Headless: Seed control [🎲][NUMBER][+][−] on kind:"seed" params.
// Non-GET requests are aborted so nothing is saved server-side.
// Usage: node scripts/smoke_seed_control.mjs [screenshot.png]
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const shot = process.argv[2] || "";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof window.showNodeGraphModule === "function"
  && typeof window.decorateNodeGraphSeedRow === "function"
  && Array.isArray(window.nodeGraphMvp?.patch?.nodes), null, { timeout: 120000 });
await page.waitForTimeout(800);
gate(true, "seed control script loaded");

const found = await page.evaluate(async () => {
  let row = document.querySelector(".node-parameter-row-seed:not([hidden])");
  if (!row) {
    const types = Object.keys((typeof nodeGraphNodeLabels !== "undefined" && nodeGraphNodeLabels) || {});
    for (const t of types) {
      try { window.showNodeGraphModule(t, { x: 200, y: 200 }, {}); } catch (_) { continue; }
      await new Promise((r) => setTimeout(r, 30));
      row = document.querySelector(".node-parameter-row-seed:not([hidden])");
      if (row) break;
    }
  }
  if (!row) return null;
  row.scrollIntoView({ block: "center", inline: "center" });
  row.id ||= "seedSmokeRow";
  return { id: row.id, type: row.closest(".dsp-node")?.dataset?.nodeType || "" };
});
gate(Boolean(found), `found a seed row (${found?.type})`);
if (!found) { await browser.close(); process.exit(1); }
const sel = `#${found.id}`;
const order = await page.evaluate((s) => {
  const lab = document.querySelector(s).querySelector(".node-seed-control");
  if (!lab) return null;
  return [...lab.children].filter((c) => getComputedStyle(c).display !== "none")
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .map((c) => c.dataset.seedAction || (c.classList.contains("node-slider-readout") ? "number" : c.tagName));
}, sel);
gate(JSON.stringify(order) === JSON.stringify(["number", "dice", "plus", "minus"]), `layout ${JSON.stringify(order)}`);
gate(await page.locator(`${sel} .node-seed-die, ${sel} .node-seed-die-pip`).count() === 0 && await page.evaluate(() => typeof window.nodeGraphGlGraphDrawSeedWidget === "function"), "dice is the shared GL widget (no DOM die)");


async function measureGlyphs(label) {
  const m = await page.evaluate((s) => {
    const row = document.querySelector(s);
    const out = {};
    const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];
    const ctl = row.querySelector(".node-seed-control").getBoundingClientRect();
    const ccy = ctl.top + ctl.height / 2;
    for (const el of row.querySelectorAll(".node-seed-btn, .node-slider-readout, .node-slider-readout-value")) {
      const r = el.getBoundingClientRect();
      out[`vs-control:${el.className.split(" ").pop()}`] = { dx: 0, dy: +((r.top + r.height / 2) - ccy).toFixed(2), w: r.width, h: r.height, inside: r.top >= ctl.top - 0.5 && r.bottom <= ctl.bottom + 0.5 };
    }
    return out;
  }, sel);
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith("vs-control")) {
      gate(Math.abs(v.dy) <= 1 && v.inside, `${label} ${k} vertical center vs control ${v.dy} (h ${v.h.toFixed(1)})`);
    } else {
      gate(Math.abs(v.dx) <= 1 && Math.abs(v.dy) <= 1 && v.w > 0 && v.h > 0, `${label} ${k} centered off (${v.dx}, ${v.dy}) size ${v.w}x${v.h}`);
    }
  }
}
await page.waitForTimeout(150);
await measureGlyphs("row default");
await page.evaluate((s) => { document.querySelector(s).closest(".dsp-node").style.setProperty("--node-slider-readout-height", "31px"); }, sel);
await page.waitForTimeout(200);
await measureGlyphs("row 31px");
if (shot) await page.locator(`${sel} .node-seed-control`).screenshot({ path: shot.replace(/\.png$/, "-big.png") });
await page.evaluate((s) => { document.querySelector(s).closest(".dsp-node").style.removeProperty("--node-slider-readout-height"); }, sel);
await page.waitForTimeout(200);
const val = () => page.evaluate((s) => Number(document.querySelector(s).querySelector('input[type="range"]').dataset.domainValue), sel);
const setv = (v) => page.evaluate(([s, v]) => { const sl = document.querySelector(s).querySelector('input[type="range"]'); window.setNodeSliderValue(sl, v); }, [sel, v]);
const max = await page.evaluate((s) => Number(document.querySelector(s).querySelector('input[type="range"]').max), sel);
gate(max === 16777215, `max ${max}`);

// Buttons step one character of the 4-char code (84877a07): + / - = last
// character, Ctrl = 3rd, Ctrl+Shift = 2nd, Ctrl+Shift+Alt = 1st; Alt alone = random.
const code = (v) => page.evaluate((v) => window.formatNodeGraphSeedCode(v), v);
const ALPHA = await page.evaluate(() => window.NODE_GRAPH_SEED_ALPHA);
const shift = (c, place, dir) => { const a = c.split(""); a[place] = ALPHA[(ALPHA.indexOf(a[place]) + dir + 64) % 64]; return a.join(""); };
const press = async (btn, modifiers, place, dir, label) => {
  const c0 = await code(await val());
  await page.click(`${sel} .node-seed-btn-${btn}`, { modifiers });
  const c1 = await code(await val());
  gate(c1 === shift(c0, place, dir), `${label}: ${c0} -> ${c1}`);
};
await setv(8762440);
await press("plus", [], 3, 1, "+ steps last character");
await press("minus", [], 3, -1, "- steps last character back");
await press("plus", ["Control"], 2, 1, "Ctrl+ steps 3rd character");
await press("plus", ["Control", "Shift"], 1, 1, "Ctrl+Shift+ steps 2nd character");
await press("minus", ["Control", "Shift", "Alt"], 0, -1, "Ctrl+Shift+Alt- steps 1st character");
// Wrap: the stepped character walks the 64-letter alphabet both ways.
const wrapAt = (ch) => page.evaluate((ch) => { for (let n = 0; n < 1 << 24; n += 4099) if (window.formatNodeGraphSeedCode(n)[3] === ch) return n; return -1; }, ch);
await setv(await wrapAt("_"));
await press("plus", [], 3, 1, "+ wraps _ to A");
await setv(await wrapAt("A"));
await press("minus", [], 3, -1, "- wraps A to _");
const vr = await val();
await page.click(`${sel} .node-seed-btn-plus`, { modifiers: ["Alt"] });
const ra = await val();
gate(ra !== vr && ra >= 0 && ra <= max, `Alt+ is random ${ra}`);
await page.click(`${sel} .node-seed-btn-dice`);
const r = await val();
gate(r !== ra && r >= 0 && r <= max, `dice random ${r}`);

// Drag on the number: 4 px per step of 1, right and up raise (same law as nodeGraphSeedDragValue).
await setv(8762440);
const box = await page.locator(`${sel} .node-slider-readout`).boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx + 8, cy, { steps: 4 }); await page.mouse.up();
gate(await val() === 8762442, `drag right 8px = +2 (${await val()})`);
await page.waitForTimeout(500);
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx, cy - 12, { steps: 4 }); await page.mouse.up();
gate(await val() === 8762445, `drag up 12px = +3 (${await val()})`);
await page.waitForTimeout(500);
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx - 20, cy, { steps: 5 }); await page.mouse.up();
gate(await val() === 8762440, `drag left 20px = -5 (${await val()})`);
gate(await page.evaluate(() => [[0, 8, 0], [0, 0, -8], [10, 3, 0], [0, -6, 0]].map(([v, dx, dy]) => window.nodeGraphSeedDragValue({ min: "0", max: "16777215", dataset: {} }, v, dx, dy)).join()) === "2,2,10,0", "nodeGraphSeedDragValue law (4 px/step, right/up raise, clamps at 0)");
await page.waitForTimeout(500);
await page.mouse.move(cx, cy);
const beforeWheel = await val();
await page.mouse.wheel(0, -100);
await page.waitForTimeout(80);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(80);
gate(await val() === beforeWheel, `wheel leaves Seed unchanged (${await val()})`);
await page.waitForTimeout(500);
const before = await val();
await page.click(`${sel} .node-slider-readout`, { modifiers: ["Alt"] });
gate(await val() === before, "Alt click on number does nothing");

// GL die: the shared widget draws this row (die, +, -) with the row's code.
const gl = await page.evaluate(async (s) => {
  const calls = [];
  const orig = window.nodeGraphGlGraphDrawSeedWidget;
  window.nodeGraphGlGraphDrawSeedWidget = function (batch, rects, text, ...rest) { calls.push({ text, keys: Object.keys(rects || {}).sort().join() }); return orig.call(this, batch, rects, text, ...rest); };
  try {
    if (typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
    if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    await new Promise((r) => setTimeout(r, 400));
  } finally { window.nodeGraphGlGraphDrawSeedWidget = orig; }
  const sl = document.querySelector(s).querySelector('input[type="range"]');
  return { calls, want: window.formatNodeGraphSeedCode(Number(sl.dataset.domainValue)) };
}, sel);
gate(gl.calls.some((c) => c.text === gl.want && /dice/.test(c.keys) && /plus/.test(c.keys) && /minus/.test(c.keys)), `GL die drawn for this row (${gl.want}; ${gl.calls.length} widget draws)`);
await setv(8762440);
await page.waitForTimeout(120);
if (shot) await page.locator(`${sel} .node-seed-control`).screenshot({ path: shot });
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
