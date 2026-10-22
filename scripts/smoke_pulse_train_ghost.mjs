// Pulse Train ghost: with Recalculate On, the face draws the next pattern
// (live params, via the engine preview) dim behind the playing one.
//  1. Engine: knobs moved mid-train (latched) -> the next trigger plays
//     exactly soemdsp_pulse_train_preview(live params), the ghost's source.
//  2. Face: engine readouts stubbed as "playing with the old params": the
//     schedule carries a ghost equal to the live preview; drawn in the Ghost
//     colour; no ghost when the live params match what plays; Ghost opacity 0
//     hides it.
// Usage: node scripts/smoke_pulse_train_ghost.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR (default scripts/out/pulse-train-ghost).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(label);
};

// 1. Engine.
const W = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules/pulse_train/pulse_train.wasm")), {})).instance.exports;
const SR = 48000;
const h = W.soemdsp_pulse_train_create();
const oldP = [6, 0.5, 2, 1, 0.2, 0, 1];
const newP = [9, 0.8, -1.5, 0.7, 0.4, 1, 0.9];
let trig = 0;
const step = (t, p) => W.soemdsp_pulse_train_sample(h, t, ...p, SR, 0, 1);
step(1, oldP);
for (let i = 0; i < SR * 0.2; i += 1) step(0, newP); // knobs moved mid-train: latched
for (let i = 0; i < SR * 1; i += 1) step(0, newP);    // let the train end
const fired = [];
for (let i = 0; i < SR * 1; i += 1) {
  const v = step(i === 0 ? 1 : 0, newP);
  if (v !== 0) fired.push([i / SR, v]);
}
const n = W.soemdsp_pulse_train_preview(...newP, 0);
const want = [...Array(n).keys()].map((i) => [W.soemdsp_pulse_train_preview_time(i), W.soemdsp_pulse_train_preview_amplitude(i)]);
const same = fired.length === want.length && fired.every(([t, a], i) => Math.abs(t - want[i][0]) <= 1 / SR + 1e-9 && Math.abs(a - want[i][1]) < 1e-9);
check("engine: next trigger plays exactly the previewed (ghost) pattern", same, JSON.stringify({ fired: fired.slice(0, 4), want: want.slice(0, 4), nf: fired.length, nw: want.length }));
void trig;

// 2. Face.
const { chromium } = await import(process.env.PW_MODULE || "playwright");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || path.join(root, "scripts/out/pulse-train-ghost");
fs.mkdirSync(SHOT, { recursive: true });
function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((x) => x.id === "output").map((x) => ({ ...x, gx: 40, gy: 1 }));
  d.connections = []; d.graphConnections = []; d.modulations = [];
  d.nodes.push({ gx: 2, gy: 2, id: "pt-1", type: "pulseTrain", params: { count: newP[0], endTime: newP[1], curve: newP[2], ampStart: newP[3], ampEnd: newP[4], ampCurve: newP[5], amplitude: newP[6], mode: 0, recalculateOnTrigger: 1 } });
  return JSON.stringify(d);
}
const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/pt-ghost-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=pt-ghost-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('.node-pulse-train-display[data-node="pt-1"]') && nodeGraphPulseTrainPreviewWasm.exports, null, { timeout: 400000 });
await page.waitForTimeout(1500);
// Stub: audio running, engine playing the old (latched) params.
const face = (eng, look) => page.evaluate(([e, l]) => {
  const names = ["__Count", "__End", "__Curve", "__AmpStart", "__AmpEnd", "__AmpCurve", "__Amp"];
  window.__ptEng = e;
  if (!window.__ptStub) {
    window.__ptStub = true;
    const orig = nodeGraphModuleScopeLatestOutputValue;
    window.nodeGraphModuleScopeLatestOutputValue = (id, name, fb) => {
      const k = names.indexOf(name);
      if (id === "pt-1" && window.__ptEng && k >= 0) return window.__ptEng[k];
      if (id === "pt-1" && name === "__Elapsed") return -1;
      return orig(id, name, fb);
    };
    // Pinned: the app may swap nodeGraphMvp.live while the face pump redraws.
    const live = { ...(nodeGraphMvp.live || {}), context: { state: "running", currentTime: 0, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: performance.now() }) } };
    Object.defineProperty(nodeGraphMvp, "live", { configurable: true, get: () => live, set: () => {} });
  }
  const node = nodeGraphPatchNode("pt-1");
  node.traceDisplaySettings = { ...(node.traceDisplaySettings || {}), ...l };
  const el = document.querySelector('.node-pulse-train-display[data-node="pt-1"]');
  el._pulseTrainKey = null;
  drawNodeGraphPulseTrainDisplay(el);
  if (typeof drawNodeGraphWires === "function") drawNodeGraphWires();
  const s = el._pulseTrainSchedule;
  return s ? { n: s.times.length, ghost: s.ghost ? [...s.ghost.times] : null, ghostAmps: s.ghost ? [...s.ghost.amps] : null } : null;
}, [eng, look]);
const look = { ghostHue: 300, ghostBrightness: 0.6, ghostSaturation: 1, ghostOpacity: 1 };
const latched = await face(oldP, look);
check("face: playing old params -> schedule shows them", latched?.n === oldP[0], JSON.stringify(latched));
check("face: ghost = engine preview of the live params", latched?.ghost?.length === want.length && latched.ghost.every((t, i) => Math.abs(t - want[i][0]) < 1e-12 && Math.abs(latched.ghostAmps[i] - want[i][1]) < 1e-12), JSON.stringify(latched?.ghost));
const shotEl = page.locator('.node-pulse-train-display[data-node="pt-1"]');
const magenta = async () => {
  await page.waitForTimeout(300);
  const buf = await shotEl.screenshot();
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height).getContext("2d");
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height).data;
    let k = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 110 && d[i + 2] > 110 && d[i + 1] < d[i] * 0.6) k += 1;
    return k;
  }, buf.toString("base64"));
};
const on = await magenta();
check("face: ghost drawn in the Ghost colour", on > 30, on);
await face(oldP, { ghostHue: 187.5, ghostBrightness: 0.55, ghostSaturation: 0.5, ghostOpacity: 0.35 });
await shotEl.screenshot({ path: path.join(SHOT, "pulse-train-ghost.png") });
await face(oldP, { ...look, ghostOpacity: 0 });
check("face: Ghost opacity 0 hides it", (await magenta()) === 0);
const match = await face(newP, look);
check("face: no ghost when the live params match what plays", match && match.ghost === null && (await magenta()) === 0, JSON.stringify(match));
await browser.close();
if (errors.length) console.log("page errors:", errors.slice(0, 5));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures.length ? `${failures.length} failure(s)` : "all pulse train ghost checks passed");
process.exitCode = failures.length ? 1 : 0;
