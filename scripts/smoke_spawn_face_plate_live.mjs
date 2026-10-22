// Display faces spawned during Play show their plate at once (no blank /
// see-through screen until the live loop happens to paint them). Play, then
// drop each display module in and check its face is the black plate (not the panel or workspace
// showing through). Stop-mode spawn is the control. Server on :8090 or SANDBOX_URL.
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const TYPES = ["polyBlep", "dsfOscillator", "resonantEnvelope", "dotOscilloscope", "valueOscilloscope", "lineBurnOscilloscope", "scope1dTrace", "spectrum1d"];
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector("article[data-node]") && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.waitForTimeout(1500);
async function meanRgb(clip) {
  const shot = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data; const s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return s.map((v) => Math.round(v / (d.length / 4)));
  }, shot.toString("base64"));
}
async function spawnAndMeasure(type) {
  const before = new Set(await page.evaluate(() => [...document.querySelectorAll("article[data-node]")].map((a) => a.dataset.node)));
  await page.evaluate((type) => { beginNodeGraphModulePlacement(type, nodeGraphClientPoint({ clientX: 1250, clientY: 650 })); finishNodeGraphModulePlacementAtCurrentPosition(); }, type);
  await page.waitForTimeout(1500);
  const info = await page.evaluate((before) => {
    const a = [...document.querySelectorAll("article[data-node]")].find((el) => !before.includes(el.dataset.node));
    const f = a && [...a.querySelectorAll(".node-module-face")].find((el) => !el.closest("[hidden]"));
    const r = f?.getBoundingClientRect(); const m = a?.getBoundingClientRect();
    return a && r && r.width > 10 && r.height > 10 ? { id: a.dataset.node, face: { x: r.left + 3, y: r.top + 3, width: r.width - 6, height: Math.min(r.height - 6, 40) }, empty: { x: Math.max(0, m.left - 60), y: r.top + 3, width: 40, height: Math.min(r.height - 6, 40) } } : { id: a?.dataset.node };
  }, [...before]);
  let res = null;
  if (info.face) res = { face: await meanRgb(info.face), empty: await meanRgb(info.empty) };
  await page.evaluate((id) => { const p = cloneNodeGraphPatch(nodeGraphMvp.patch); p.nodes = p.nodes.filter((n) => n.id !== id); commitNodeGraphPatch(p, { status: "smoke cleanup", topologyEdit: true, record: false, autosaveWorkingPatch: false }); }, info.id);
  await page.waitForTimeout(400);
  return { id: info.id, ...res };
}
// Default plate is black: an unplated face shows the module panel (~23,26,31) or workspace through it.
const differs = (r) => r && r.face && r.empty && Math.max(...r.face) <= 15 && Math.max(...r.face.map((v, i) => Math.abs(v - r.empty[i]))) > 6;
// Control: Stop-mode spawn plates.
check(differs(await spawnAndMeasure("polyBlep")), "stopped spawn: polyBlep face shows its plate");
await page.locator('button[aria-label="Play"]:visible').first().click();
await page.waitForTimeout(2000);
check(await page.evaluate(() => scopePaintEngineState()) === "playing", "engine playing");
for (const type of TYPES) {
  const r = await spawnAndMeasure(type);
  check(differs(r), `playing spawn: ${type} face shows its plate`, JSON.stringify(r));
}
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok spawn face plate live"); process.exit(failures ? 1 : 0);