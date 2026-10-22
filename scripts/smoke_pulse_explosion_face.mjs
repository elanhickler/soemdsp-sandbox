// Headless: Pulse Explosion face draws the engine's exact schedule (stems at
// each pulse time, height = amplitude, dot on top) on a 0..End axis, follows
// Seed, lights fired pulses behind the playhead, Display Settings HBS.
// Non-GET requests are aborted so nothing is saved server-side.
// Usage: node scripts/smoke_pulse_explosion_face.mjs [screenshot.png]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const shot = process.argv[2] || "";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

// Engine: _elapsed = seconds since trigger while a burst plays, -1 idle (face playhead, __Elapsed).
{
  const E = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } })).instance.exports;
  const h = E.soemdsp_pulse_explosion_create();
  const run = (n, trig) => { for (let i = 0; i < n; i += 1) E.soemdsp_pulse_explosion_sample(h, trig && i < 2 ? 1 : 0, 0, 0.5, 1, 0.3, 4, 1, 1, 0, 1000); return E.soemdsp_pulse_explosion_elapsed(h); };
  const idle = E.soemdsp_pulse_explosion_elapsed(h);
  const mid = run(500, true);
  const done = run(700, false);
  E.soemdsp_pulse_explosion_destroy(h);
  gate(idle === -1 && Math.abs(mid - 0.5) < 1e-9 && done === -1, `engine elapsed: idle -1, 0.5 s after trigger ${mid}, -1 after the window`);
}
const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
const patchJson = () => {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 40, gy: 1 }));
  d.connections = []; d.graphConnections = []; d.modulations = [];
  d.nodes.push({ gx: 2, gy: 2, id: "pe-1", type: "pulseExplosion", params: {} });
  return JSON.stringify(d);
};
await page.route("**/pe-face-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=pe-face-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('.node-pulse-curve-display[data-node="pe-1"]'), null, { timeout: 400000 });
await page.waitForTimeout(2500);
const id = "pe-1";
gate(true, "Pulse Explosion face mounted");
const sel = `.node-pulse-curve-display[data-node="${id}"]`;
await page.waitForFunction(() => Boolean(typeof nodeGraphPulseExplosionPreviewWasm !== "undefined" && nodeGraphPulseExplosionPreviewWasm.exports?.soemdsp_pulse_explosion_preview), null, { timeout: 30000 });
gate(true, "pulse_explosion.wasm preview loaded on the main thread");
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center", inline: "center" }), sel);

const setParams = (p) => page.evaluate(([nid, p, s]) => {
  for (const [k, v] of Object.entries(p)) {
    const sl = window.nodeGraphSliderForParameter?.(nid, k);
    if (sl) window.setNodeSliderValue(sl, v);
    const node = window.nodeGraphPatchNode(nid);
    node.params = { ...(node.params || {}), [k]: v };
  }
  const el = document.querySelector(s);
  el._pulseForceDraw = true;
  window.drawNodeGraphPulseCurveDisplay(el);
}, [id, p, sel]);

// The face canvas is composited by the shared GL graph; capture its box from the page.
const faceClip = () => page.evaluate((s) => { const r = document.querySelector(s).querySelector("canvas").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, sel);
// Face pixels -> { w, h, px(x, y) -> [r, g, b] } via a PNG decode in the page.
async function grab() {
  await page.evaluate(() => { window.markNodeGraphRenderPending?.(); window.nodeGraphGlGraphPresentSoon?.(); });
  await page.waitForTimeout(250);
  const png = await page.screenshot({ clip: await faceClip() });
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, data: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, png.toString("base64"));
}
const px = (img, x, y) => { const i = (Math.round(y) * img.w + Math.round(x)) * 4; return img.data.slice(i, i + 3); };
const lum = (c) => c[0] + c[1] + c[2];
const geom = () => page.evaluate((s) => {
  const el = document.querySelector(s);
  const cv = el.querySelector("canvas").getBoundingClientRect();
  const node = window.nodeGraphPatchNode(el.dataset.node);
  const look = window.nodeGraphPulseExplosionFaceSettingsForNode(node);
  const sch = el._pulseSchedule;
  const g = window.nodeGraphPulseExplosionFaceGeometry(cv.width, cv.height, sch.end, look.dotThickness / 2);
  return { cw: cv.width, ch: cv.height, xs: Array.from(sch.times, (t) => g.at(t)), amps: Array.from(sch.amps), times: Array.from(sch.times), base: g.base, top: g.top, end: sch.end };
}, sel);
// Brightest pixel in a column band, rows y0..y1 (CSS px scaled to image px).
const colMax = (img, G, x, y0, y1) => {
  const sx = img.w / G.cw, sy = img.h / G.ch; let m = 0;
  for (let y = Math.round(y0 * sy); y <= Math.round(y1 * sy); y += 1) m = Math.max(m, lum(px(img, x * sx, y)));
  return m;
};

// 1) Random, 6 pulses, full amplitude: six stems at the engine times, full height.
await setParams({ startTime: 0, centerTime: 0.5, endTime: 1, timeSpread: 0.3, numberOfPulses: 6, lowAmplitude: 1, highAmplitude: 1, seed: 0 });
let G = await geom(); let img = await grab();
gate(G.times.length === 6 && G.times.every((t) => t >= 0 && t <= 1), `Random: engine schedule ${G.times.map((t) => t.toFixed(2)).join(" ")}`);
const bg = lum(px(img, 2, 2));
const midStem = (G.base + G.top) / 2;
gate(G.xs.every((x) => colMax(img, G, x, midStem - 2, midStem + 2) > bg + 60), "a stem is drawn at every pulse time");
const gaps = G.xs.slice(1).map((x, i) => [x, G.xs[i]]).filter(([x, y]) => x - y > 10).map(([x, y]) => (x + y) / 2);
gate(gaps.every((x) => colMax(img, G, x, midStem - 2, midStem + 2) < bg + 25), "nothing between stems (no density curve, no stray dots)");
gate(G.xs.every((x) => colMax(img, G, x, G.top - 1, G.top + 1) > bg + 120), "full-amplitude dots sit at the top");
gate(G.end === 1 && G.xs.every((x, i) => Math.abs(x - (Math.max(6, G.cw * 0.04) + 2.5 + (G.cw - 2 * (Math.max(6, G.cw * 0.04) + 2.5)) * G.times[i])) < 1e-6), "axis runs 0 .. End Time");
if (shot) await page.screenshot({ clip: await faceClip(), path: shot.replace(/\.png$/, "-lin.png") });

// 2) Amplitude sets height: low 0.25 high 0.25 -> dots a quarter up.
await setParams({ lowAmplitude: 0.25, highAmplitude: 0.25 });
G = await geom(); img = await grab();
const qy = G.base - 0.25 * (G.base - G.top);
gate(G.xs.every((x) => colMax(img, G, x, qy - 1, qy + 1) > bg + 120) && G.xs.every((x) => colMax(img, G, x, G.top - 1, G.top + 2) < bg + 25), "stem height = amplitude (0.25 -> quarter height, nothing above)");

// 3) Random follows the Seed (engine schedule, not a JS copy).
await setParams({ lowAmplitude: 0.3, highAmplitude: 1, numberOfPulses: 12, seed: 1234 });
const ga = await geom(); img = await grab();
const want = await page.evaluate(() => { const w = nodeGraphPulseExplosionPreviewWasm.exports; const n = w.soemdsp_pulse_explosion_preview(0, 0.5, 1, 0.3, 12, 0.3, 1, 1234); return Array.from({ length: n }, (_, i) => w.soemdsp_pulse_explosion_preview_time(i)); });
gate(JSON.stringify(ga.times) === JSON.stringify(want), "Random: face uses the engine preview for this Seed exactly");
gate(ga.xs.every((x, i) => colMax(img, ga, x, ga.base - ga.amps[i] * (ga.base - ga.top) - 1, ga.base - ga.amps[i] * (ga.base - ga.top) + 1) > bg + 100), "Random: a dot at every scheduled (time, amplitude)");
await setParams({ seed: 99 });
const gb = await geom();
gate(JSON.stringify(gb.times) !== JSON.stringify(ga.times), "a new Seed moves the pulses");
if (shot) await page.screenshot({ clip: await faceClip(), path: shot });

// 4) Playhead: fake a running engine reporting 0.4 s since trigger; fired stems turn Lit.
await setParams({ numberOfPulses: 6, lowAmplitude: 1, highAmplitude: 1, seed: 0 });
await page.evaluate(() => {
  window.__peFake = { t0: performance.now() };
  const ctx = { state: "running", get currentTime() { return (performance.now() - window.__peFake.t0) / 1000; }, getOutputTimestamp() { return { contextTime: (performance.now() - window.__peFake.t0) / 1000, performanceTime: performance.now() }; } };
  window.__peOrig = { mvpLive: window.nodeGraphMvp.live, latest: window.nodeGraphModuleScopeLatestOutputValue };
  window.nodeGraphMvp.live = { ...(window.nodeGraphMvp.live || {}), context: ctx };
  window.nodeGraphModuleScopeLatestOutputValue = (nid, port, fb) => (port === "__Elapsed" ? 0.4 : window.__peOrig.latest(nid, port, fb));
});
await setParams({});
G = await geom();
img = await grab();
await page.evaluate(() => { window.nodeGraphMvp.live = window.__peOrig.mvpLive; window.nodeGraphModuleScopeLatestOutputValue = window.__peOrig.latest; });
const look = await page.evaluate((nid) => window.nodeGraphPulseExplosionFaceSettingsForNode(window.nodeGraphPatchNode(nid)), id);
const parse = (css) => css.match(/\d+/g).slice(0, 3).map(Number);
const litC = parse(look.litPaint), dotC = parse(look.dotPaint);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sx = img.w / G.cw, sy = img.h / G.ch;
const dotAt = (x) => px(img, x * sx, G.top * sy);
const fired = G.times.map((t) => t < 0.4);
gate(G.xs.every((x, i) => (fired[i] ? dist(dotAt(x), litC) < dist(dotAt(x), dotC) : dist(dotAt(x), dotC) < dist(dotAt(x), litC))), `pulses before the playhead are Lit, later ones keep Dot (${fired.map((f) => (f ? "L" : "d")).join("")})`);
const padX = Math.max(6, G.cw * 0.04) + 2.5;
const xp = padX + (G.cw - 2 * padX) * 0.4;
const xpPx = Math.round(xp * sx);
let headHits = 0;
for (let dx = -2; dx <= 2; dx += 1) if (lum(px(img, xpPx + dx, ((G.top + G.base) / 2) * sy)) > bg + 150) headHits += 1;
gate(headHits > 0, "playhead line at 0.4 s");
if (shot) await page.screenshot({ clip: await faceClip(), path: shot.replace(/\.png$/, "-playing.png") });

// 5) Display Settings colors: Background HBS repaints the face.
await page.evaluate((nid) => {
  const node = window.nodeGraphPatchNode(nid);
  node.traceDisplaySettings = window.normalizeNodeGraphPulseExplosionFaceSettings({ ...(node.traceDisplaySettings || {}), backgroundHue: 120, backgroundBrightness: 0.5, backgroundSaturation: 1 });
  window.applyNodeGraphPulseExplosionDisplaySettingsToFace(node);
}, id);
img = await grab();
const c = px(img, 2, 2);
gate(c[1] > 200 && c[0] < 40 && c[2] < 40, `Background HBS paints the face (${c})`);
await page.evaluate((nid) => { const node = window.nodeGraphPatchNode(nid); node.traceDisplaySettings = {}; window.applyNodeGraphPulseExplosionDisplaySettingsToFace(node); }, id);
const lamps = await page.evaluate(async (nid) => {
  window.openNodeGraphTraceDisplaySettings(nid, { clientX: 500, clientY: 300 });
  await new Promise((r) => setTimeout(r, 500));
  const pop = document.getElementById("nodeTraceDisplaySettingsPopover");
  const out = { lamps: [...(pop?.querySelectorAll("[data-hsl-lamp]") || [])].map((el) => el.getAttribute("data-hsl-label")), fields: [...(pop?.querySelectorAll("[data-trace-display-field]") || [])].map((el) => el.getAttribute("data-trace-display-field")).filter((k) => /Thickness$/.test(k)), ghost: Boolean(pop?.querySelector('[data-trace-display-field="ghostOpacity"], [data-hsl-lamp="ghost"]')) };
  return out;
}, id);
gate(JSON.stringify(lamps.lamps) === JSON.stringify(["Background", "Line", "Dot", "Playhead", "Lit"]), `Display Settings HBS order ${JSON.stringify(lamps.lamps)}`);
gate(lamps.fields.includes("lineThickness") && lamps.fields.includes("dotThickness"), `Display Settings thickness controls ${JSON.stringify(lamps.fields)}`);
gate(!lamps.ghost, "no Ghost colour / opacity in Pulse Explosion Display Settings (Pulse Train only)");
const saved = await page.evaluate(() => normalizeNodeGraphPulseExplosionFaceSettings({ lineHue: 42, litHue: 10, ghostOpacity: 0.7 }));
gate(saved.lineHue === 42 && saved.litHue === 10 && !("ghostOpacity" in saved) && !("ghostHue" in saved), `saved Pulse Explosion settings load, no ghost keys ${JSON.stringify(saved)}`);
if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-settings.png") });
const form = await page.evaluate(() => [typeof window.nodeGraphPulseExplosionFaceSettingsForNode, nodeGraphModuleDefinitions?.pulseExplosion?.displayModes?.[0]?.settingsSchema]);
gate(form[0] === "function" && form[1] === "pulseExplosionFace", "pulseExplosionFace Display Settings schema");
gate(await page.evaluate(() => typeof window.nodeGraphPulseExplosionComputeSchedule === "undefined" && typeof window.nodeGraphPulseExplosionRandomFn === "undefined" && typeof window.nodeGraphPulseExplosionDensity === "undefined"), "no JS schedule / density twins");
gate(await page.evaluate(() => !nodeGraphModuleDefinitions.pulseExplosion.parameters.some((p) => p.key === "timing") && !document.querySelector('[data-node="pe-1"] [data-param="timing"]')), "no Timing control (Random only)");
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(failures ? `${failures} FAIL` : "smoke_pulse_explosion_face ok");
process.exit(failures ? 1 : 0);
