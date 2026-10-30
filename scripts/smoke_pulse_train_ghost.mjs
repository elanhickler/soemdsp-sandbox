// Pulse Train Recalc On: the next trigger plays the live knobs, but the face
// stays on the in-effect (latched) cycle until then. No next-pattern ghost.
//  1. Engine: knobs moved mid-train (latched) -> the next trigger plays
//     exactly soemdsp_pulse_train_preview(live params).
//  2. Face: engine readouts stubbed as "playing with the old params": the
//     schedule is the latched cycle (axis / playhead); live knobs do not add
//     a second train.
//  3. Display Settings: Pulse Train schema (pulseTrainFace) is Background,
//     Line, Dot, Playhead, Lit + Fade time. No Ghost lamp / opacity.
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
const W = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules/pulse_train/pulse_train.wasm")), { env: { emo_process_block: () => 0 } })).instance.exports;
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
  d.nodes.push({ gx: 2, gy: 2, id: "pt-1", type: "pulseTrain", params: { count: newP[0], frequency: 1 / newP[1], curve: newP[2], ampStart: newP[3], ampEnd: newP[4], ampCurve: newP[5], amplitude: newP[6], mode: 0, recalculateOnTrigger: 1 } });
  return JSON.stringify(d);
}
const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
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
  return s ? { n: s.times.length, end: s.end, duration: s.duration, ghost: s.ghost || null } : null;
}, [eng, look]);
const look = {};
const latched = await face(oldP, look);
check("face: playing old params -> schedule shows them", latched?.n === oldP[0], JSON.stringify(latched));
check("face: no next-pattern ghost while knobs differ", latched && latched.ghost == null, JSON.stringify(latched));
check("face: axis is the latched Time, not the live Frequency", latched && Math.abs(latched.duration - oldP[1]) < 1e-12, JSON.stringify(latched));
const shotEl = page.locator('.node-pulse-train-display[data-node="pt-1"]');
await shotEl.screenshot({ path: path.join(SHOT, "pulse-train-ghost.png") });
const match = await face(newP, look);
check("face: still no ghost when live params match what plays", match && match.ghost == null, JSON.stringify(match));
// 3. Own Display Settings.
const schema = await page.evaluate(() => [nodeGraphModuleDefinitions.pulseTrain.displayType, nodeGraphModuleDefinitions.pulseTrain.displayModes[0].settingsSchema, nodeGraphModuleDefinitions.pulseTrain.displayModes[0].renderer]);
check("schema: pulseTrainFace (type, settings, renderer)", schema.every((s) => s === "pulseTrainFace"), JSON.stringify(schema));
const pop = await page.evaluate(async () => {
  const node = nodeGraphPatchNode("pt-1");
  node.traceDisplaySettings = {};
  window.openNodeGraphTraceDisplaySettings("pt-1", { clientX: 500, clientY: 300 });
  await new Promise((r) => setTimeout(r, 500));
  const p = document.getElementById("nodeTraceDisplaySettingsPopover");
  return { lamps: [...(p?.querySelectorAll("[data-hsl-lamp]") || [])].map((el) => el.getAttribute("data-hsl-label")), opacity: Boolean(p?.querySelector('[data-trace-display-field="ghostOpacity"]')) };
});
check("settings: Background, Line, Dot, Playhead, Lit", JSON.stringify(pop.lamps) === JSON.stringify(["Background", "Line", "Dot", "Playhead", "Lit"]), JSON.stringify(pop.lamps));
check("settings: no Ghost opacity field", pop.opacity === false);
const saved = await page.evaluate(() => {
  const node = nodeGraphPatchNode("pt-1");
  node.traceDisplaySettings = { lineHue: 42, litHue: 10, dotThickness: 7, fadeTime: 0.4 };
  const s = nodeGraphPulseTrainFaceSettingsForNode(node);
  const d = normalizeNodeGraphPulseTrainFaceSettings({ lineHue: 42 });
  return [s.lineHue, s.litHue, s.dotThickness, s.fadeTime, d.fadeTime];
});
check("saved Pulse Train settings load (shared keys + fade); fade defaults fill old patches", JSON.stringify(saved) === JSON.stringify([42, 10, 7, 0.4, 0]), JSON.stringify(saved));
await browser.close();
if (errors.length) console.log("page errors:", errors.slice(0, 5));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures.length ? `${failures.length} failure(s)` : "all pulse train ghost checks passed");
process.exitCode = failures.length ? 1 : 0;
