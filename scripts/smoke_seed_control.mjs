// Headless: Seed control [🎲][NUMBER][+][−] on kind:"seed" params.
// Non-GET requests are aborted so nothing is saved server-side.
// Usage: node scripts/smoke_seed_control.mjs [screenshot.png]
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const shot = process.argv[2] || "";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const browser = await chromium.launch({ headless: true });
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
gate(await page.locator(`${sel} .node-seed-btn-dice .node-seed-die-pip`).count() === 5, "dice is the drawn 5-pip die");


async function measureGlyphs(label) {
  const m = await page.evaluate((s) => {
    const row = document.querySelector(s);
    const out = {};
    const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];
    for (const k of ["plus", "minus"]) {
      const b = row.querySelector(`.node-seed-btn-${k}`);
      const br = b.getBoundingClientRect();
      const [bx, by] = center(br);
      const scale = br.width / b.offsetWidth || 1;
      for (const pe of ["::before", "::after"]) {
        if (k === "minus" && pe === "::after") continue;
        const cs = getComputedStyle(b, pe);
        const mt = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
        const w = parseFloat(cs.width), h = parseFloat(cs.height);
        const cx = br.left + (b.clientLeft + parseFloat(cs.left) + mt.e + w / 2) * scale;
        const cy = br.top + (b.clientTop + parseFloat(cs.top) + mt.f + h / 2) * scale;
        out[`${k}${pe}`] = { dx: +(cx - bx).toFixed(2), dy: +(cy - by).toFixed(2), w, h };
      }
    }
    const ctl = row.querySelector(".node-seed-control").getBoundingClientRect();
    const ccy = ctl.top + ctl.height / 2;
    for (const el of row.querySelectorAll(".node-seed-btn, .node-slider-readout, .node-slider-readout-value")) {
      const r = el.getBoundingClientRect();
      out[`vs-control:${el.className.split(" ").pop()}`] = { dx: 0, dy: +((r.top + r.height / 2) - ccy).toFixed(2), w: r.width, h: r.height, inside: r.top >= ctl.top - 0.5 && r.bottom <= ctl.bottom + 0.5 };
    }
    const db = row.querySelector(".node-seed-btn-dice").getBoundingClientRect();
    const g = row.querySelector(".node-seed-die").getBoundingClientRect();
    out.dice = { l: +(g.left - db.left).toFixed(2), r: +(db.right - g.right).toFixed(2), t: +(g.top - db.top).toFixed(2), b: +(db.bottom - g.bottom).toFixed(2), dx: +((g.left + g.width / 2) - (db.left + db.width / 2)).toFixed(2), dy: +((g.top + g.height / 2) - (db.top + db.height / 2)).toFixed(2) };
    return out;
  }, sel);
  for (const [k, v] of Object.entries(m)) {
    if (k === "dice") {
      gate(Math.min(v.l, v.r, v.t, v.b) >= 1, `${label} dice inside button, margins L${v.l} R${v.r} T${v.t} B${v.b} (center off ${v.dx},${v.dy})`);
    } else if (k.startsWith("vs-control")) {
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

await setv(0);
await page.click(`${sel} .node-seed-btn-minus`);
gate(await val() === max, "0 − 1 wraps to max");
await page.click(`${sel} .node-seed-btn-plus`);
gate(await val() === 0, "max + 1 wraps to 0");
await page.click(`${sel} .node-seed-btn-plus`, { modifiers: ["Control"] });
gate(await val() === 10, "Ctrl+ = 10");
await page.click(`${sel} .node-seed-btn-plus`, { modifiers: ["Control", "Shift"] });
gate(await val() === 110, "Ctrl+Shift+ = 100");
await page.click(`${sel} .node-seed-btn-plus`, { modifiers: ["Control", "Shift", "Alt"] });
gate(await val() === 1110, "Ctrl+Alt+Shift+ = 1000");
await page.click(`${sel} .node-seed-btn-dice`);
const r = await val();
gate(r !== 1110 && r >= 0 && r <= max, `dice random ${r}`);

// Drag: 8762440 → step 100000, 4px/step.
await setv(8762440);
const box = await page.locator(`${sel} .node-slider-readout`).boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx + 8, cy, { steps: 4 }); await page.mouse.up();
gate(await val() === 8962440, `drag +8px = +2×100000 (${await val()})`);
await page.waitForTimeout(500);
await page.keyboard.down("Shift");
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx + 4, cy, { steps: 2 }); await page.mouse.up();
await page.keyboard.up("Shift");
gate(await val() === 9012440, `Shift drag halves step (${await val()})`);
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
const fs = (v) => setv(v).then(() => page.waitForTimeout(120)).then(() => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s).querySelector(".node-slider-readout-value")).fontSize), sel));
const small = await fs(42), big = await fs(16777215);
gate(small > big * 1.5, `number fills box: 42 → ${small}px, 16777215 → ${big}px`);
const fits = await page.evaluate((s) => { const r = document.querySelector(s).querySelector(".node-slider-readout"); const v = r.querySelector(".node-slider-readout-value"); return v.scrollWidth <= r.clientWidth + 1; }, sel);
gate(fits, "8 digits fit inside the number box");
await setv(8762440);
await page.waitForTimeout(120);
if (shot) await page.locator(`${sel} .node-seed-control`).screenshot({ path: shot });
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "all ok");
process.exit(failures ? 1 : 0);
