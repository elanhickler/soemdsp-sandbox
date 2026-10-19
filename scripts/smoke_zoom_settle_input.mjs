// ZP-4 (docs/ZOOM_PERF_PLAN.md): frozen module HTML during a wheel zoom, then
// real-mouse input right after the settle.
//  1. Mid-gesture the module HTML must sit on the GPU plates (one layer
//     transform carries it; no module style writes), within 1.5 px.
//  2. After the settle every module has the live CSS zoom and still matches.
//  3. Real mouse, right after the zoom: drag a module by its title, drag a
//     slider, and drag a cable from an output to a free input.
// Usage: node scripts/smoke_zoom_settle_input.mjs   (server.py on :8765)
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOTS = process.env.SHOTS || "";
const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphZoom === "function"
  && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForTimeout(1500);

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// HTML module box vs the GL plate under the live camera, in client px.
const alignment = () => page.evaluate(() => {
  const host = document.getElementById("nodeGraphWorkspace");
  const ws = host.getBoundingClientRect();
  const zoom = nodeGraphGlGraphZoom();
  const cam = nodeGraphWireCameraViewBox(host);
  let worst = 0; let n = 0; let worstId = "";
  for (const plate of nodeGraphGlGraphState.plates || []) {
    const el = nodeGraphNodeElement(plate.id);
    if (!el || el.classList.contains("viewport-asleep")) continue;
    const r = el.getBoundingClientRect();
    const ex = ws.left + host.clientLeft + (plate.x - cam.x) * zoom;
    const ey = ws.top + host.clientTop + (plate.y - cam.y) * zoom;
    if (ex > ws.right || ey > ws.bottom || ex + plate.w * zoom < ws.left || ey + plate.h * zoom < ws.top) continue;
    const err = Math.max(Math.abs(r.left - ex), Math.abs(r.top - ey), Math.abs(r.width - plate.w * zoom), Math.abs(r.height - plate.h * zoom));
    n += 1;
    if (err > worst) { worst = err; worstId = plate.id; }
  }
  const zooms = [...document.querySelectorAll("#nodeGraphNodes > .dsp-node")].map((el) => el.style.zoom);
  return {
    zoom, n, worst, worstId,
    frozen: typeof nodeGraphHtmlFrozen === "function" && nodeGraphHtmlFrozen(),
    gesturing: nodeGraphViewportGestureActive(),
    liveZoomOnModules: zooms.every((z) => Math.abs(Number(z) - zoom) < 1e-6),
  };
});

const vp = page.viewportSize();
const cx = vp.width * 0.42; const cy = vp.height * 0.45;
await page.mouse.move(cx, cy);
// Real wheel notches, close enough together that the gesture stays open.
const startZoom = await page.evaluate(() => nodeGraphZoom());
let mid = null;
for (let i = 0; i < 80; i += 1) {
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(25);
  const z = await page.evaluate(() => nodeGraphZoom());
  if (z >= 3.2) break;
}
mid = await alignment();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/zp4_mid.png` });
check(mid.gesturing && mid.frozen, "module HTML frozen mid-gesture", `zoom=${mid.zoom.toFixed(2)} from ${startZoom.toFixed(2)}`);
check(mid.n > 3 && mid.worst <= 1.5, "mid-gesture HTML sits on the GL plates", `modules=${mid.n} worst=${mid.worst.toFixed(2)}px (${mid.worstId})`);
await page.waitForTimeout(700);
const settled = await alignment();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/zp4_settled.png` });
check(!settled.frozen && !settled.gesturing, "thawed after settle");
check(settled.liveZoomOnModules, "every module has the live CSS zoom after settle", `zoom=${settled.zoom.toFixed(2)}`);
check(settled.n > 3 && settled.worst <= 1.5, "settled HTML sits on the GL plates", `modules=${settled.n} worst=${settled.worst.toFixed(2)}px (${settled.worstId})`);

// Pick targets that are fully on screen at this zoom.
const targets = await page.evaluate(() => {
  const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
  const inView = (r) => r.width > 4 && r.height > 4 && r.left > ws.left + 8 && r.top > ws.top + 8 && r.right < ws.right - 8 && r.bottom < ws.bottom - 8;
  const nodes = [...document.querySelectorAll("#nodeGraphNodes > .dsp-node:not(.viewport-asleep)")];
  let title = null; let slider = null; let out = null; let inp = null;
  for (const n of nodes) {
    const row = n.querySelector(".node-header-title-row") || n.querySelector(".node-header-title");
    const rr = row?.getBoundingClientRect();
    if (!title && rr && inView(rr)) title = { id: n.dataset.node, x: rr.left + rr.width * 0.5, y: rr.top + rr.height * 0.5, nx: n.style.getPropertyValue("--node-x"), ny: n.style.getPropertyValue("--node-y") };
    for (const ro of n.querySelectorAll(".node-parameter-row .node-slider-readout")) {
      const input = ro.closest("label")?.querySelector("input[type='range']");
      const r = ro.getBoundingClientRect();
      if (slider || !input || !inView(r) || ro.closest(".node-seed-control")) continue;
      input.dataset.zpProbe = "1";
      slider = { id: n.dataset.node, name: input.name || input.dataset.param || "", x0: r.left + r.width * 0.3, x1: r.left + r.width * 0.75, y: r.top + r.height * 0.5, value: input.value };
    }
  }
  const taken = new Set((nodeGraphMvp.connections || []).map((c) => `${c.destinationNode}:${c.destinationPort}`));
  for (const p of document.querySelectorAll("#nodeGraphNodes .node-port.output")) {
    const r = p.getBoundingClientRect();
    if (!out && inView(r)) out = { node: p.dataset.node, port: p.dataset.port, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  for (const p of document.querySelectorAll("#nodeGraphNodes .node-port.input")) {
    const r = p.getBoundingClientRect();
    if (inp || !out || p.dataset.node === out.node || taken.has(`${p.dataset.node}:${p.dataset.port}`) || !inView(r)) continue;
    inp = { node: p.dataset.node, port: p.dataset.port, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { title, slider, out, inp, conns: nodeGraphMvp.connections.length };
});

const drag = async (x0, y0, x1, y1, steps = 12) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
};

if (targets.slider) {
  await drag(targets.slider.x0, targets.slider.y, targets.slider.x1, targets.slider.y);
  const value = await page.evaluate(() => document.querySelector("input[data-zp-probe='1']")?.value);
  check(value !== targets.slider.value, "real mouse: drag a slider", `${targets.slider.id} ${targets.slider.value} -> ${value}`);
} else check(false, "real mouse: no slider on screen");

if (targets.title) {
  await drag(targets.title.x, targets.title.y, targets.title.x + 90, targets.title.y + 60);
  const after = await page.evaluate((id) => {
    const n = nodeGraphNodeElement(id);
    return { nx: n.style.getPropertyValue("--node-x"), ny: n.style.getPropertyValue("--node-y") };
  }, targets.title.id);
  check(after.nx !== targets.title.nx || after.ny !== targets.title.ny, "real mouse: drag a module by its title", `${targets.title.id} ${targets.title.nx},${targets.title.ny} -> ${after.nx},${after.ny}`);
} else check(false, "real mouse: no module title on screen");

if (targets.out && targets.inp) {
  // The module drag moved things: re-read the two jacks.
  const pts = await page.evaluate(({ out, inp }) => {
    const at = (p, io) => {
      const el = document.querySelector(`#nodeGraphNodes .node-port.${io}[data-node="${CSS.escape(p.node)}"][data-port="${CSS.escape(p.port)}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    return { a: at(out, "output"), b: at(inp, "input") };
  }, targets);
  await drag(pts.a.x, pts.a.y, pts.b.x, pts.b.y, 16);
  const made = await page.evaluate(({ out, inp }) => (nodeGraphMvp.connections || []).some((c) => c.sourceNode === out.node
    && c.sourcePort === out.port && c.destinationNode === inp.node && c.destinationPort === inp.port), targets);
  check(made, "real mouse: drag a cable output -> input", `${targets.out.node}.${targets.out.port} -> ${targets.inp.node}.${targets.inp.port}`);
} else check(false, "real mouse: no free jack pair on screen");

if (errors.length) console.log("page errors:", errors.slice(0, 5));
check(!errors.length, "no page errors");
await browser.close();
console.log(failures ? `FAIL ${failures}` : "ok   all");
process.exit(failures ? 1 : 0);
