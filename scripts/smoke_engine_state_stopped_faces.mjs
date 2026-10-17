// ES-5 (docs/ENGINE_STATE_DISPLAY_PLAN.md): with the engine STOPPED, every
// param face paints, every Music Player page switches, and dragging a module
// keeps faces painted. Read-only: non-GET requests are aborted.
// Usage: node scripts/smoke_engine_state_stopped_faces.mjs   (server.py on :8765)
// Needs a real GPU (faces are WebGL only): runs headed by default; HEADLESS=1
// only for a machine with GPU headless support.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const errors = [];
async function open(patch) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => errors.push(`${patch}: ${e.message || e}`));
  await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  await page.goto(`${BASE}?pagePatch=${patch}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof scopePaintEngineState === "function"
    && typeof nodeGraphFacePaintKindFor === "function"
    && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}
const paramFaces = () => {
  const lit = (c) => {
    const o = document.createElement("canvas"); o.width = 16; o.height = 16;
    const g = o.getContext("2d"); g.drawImage(c, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n += 1;
    return n;
  };
  const out = [];
  for (const a of document.querySelectorAll("article[data-node-type]")) {
    const slot = nodeGraphModuleScopeState?.slots?.get(a.dataset.node);
    const kind = slot ? nodeGraphFacePaintKindFor(slot) : nodeGraphFacePaintKindFor(a);
    if (kind !== "param") continue;
    const cs = [...a.querySelectorAll("canvas")].filter((c) => c.width > 1 && c.height > 1 && !c.closest("[hidden]"));
    if (!cs.length) continue;
    let best = 0;
    for (const c of cs) { try { best = Math.max(best, lit(c)); } catch (_e) { /* tainted */ } }
    out.push({ id: a.dataset.node, lit: best });
  }
  return { state: scopePaintEngineState(), faces: out };
};

// 1. Param faces paint on a stopped patch load.
{
  const page = await open("softpop");
  const r = await page.evaluate(paramFaces);
  gate(r.state === "stopped", `softpop loads stopped (${r.state})`);
  gate(r.faces.length >= 3, `softpop has param faces (${r.faces.length})`);
  for (const f of r.faces) gate(f.lit > 0, `param face painted while stopped: ${f.id} (${f.lit})`);

  // 3. Drag a module while stopped: it moves and faces stay painted.
  // Grab the module by its title strip (top 8 px of the article).
  const box = await page.locator("article[data-node-type='slewLimiter']").first().boundingBox();
  const before = box?.x;
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + 28, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const after = await page.evaluate(() => document.querySelector("article[data-node-type='slewLimiter']")?.getBoundingClientRect().x);
  gate(box && Math.abs(after - before) > 20, `module drags while stopped (${before} -> ${after})`);
  const r2 = await page.evaluate(paramFaces);
  for (const f of r2.faces) gate(f.lit > 0, `param face still painted after drag: ${f.id} (${f.lit})`);
  await page.close();
}

// 2. Every Music Player page switches while stopped.
{
  const page = await open("musicplayer");
  const faces = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-music-player-face]")]
    .filter((b) => b.tagName === "BUTTON").map((b) => b.dataset.musicPlayerFace))]);
  gate(faces.length >= 3, `music player page buttons found (${faces.join(",")})`);
  for (const face of faces) {
    await page.click(`button[data-music-player-face='${face}']`);
    await page.waitForTimeout(400);
    const r = await page.evaluate((want) => {
      const pages = [...document.querySelectorAll("[data-music-player-page]")];
      const shown = pages.filter((p) => !p.hidden).map((p) => p.dataset.musicPlayerPage);
      const el = pages.find((p) => p.dataset.musicPlayerPage === want);
      return { shown, h: el ? el.getBoundingClientRect().height : 0, state: scopePaintEngineState() };
    }, face);
    gate(r.state === "stopped" && r.shown.length === 1 && r.shown[0] === face && r.h > 10,
      `page '${face}' shows alone while stopped (shown=${r.shown.join(",")}, h=${Math.round(r.h)})`);
  }
  await page.close();
}

gate(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("smoke_engine_state_stopped_faces ok");
