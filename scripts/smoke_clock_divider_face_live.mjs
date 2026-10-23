// Clock Divider face live (headless Chrome, fixture clock_divider_clock_in.json:
// a 4 Hz Clock into a divide-by-4, Gate to Output). While playing: the engine
// publishes __Count, it steps through 0..3, Gate is high right after it wraps
// to 0, the face draws (Fire while Gate is high), the jacks read ▮ / ⎍ on
// white digital cables, Display Settings shows Background, Ring, Count, Tick,
// Fire + Line thickness only, a settings change repaints at once, and an old
// patch (Out cable, Threshold, Level) loads as Gate / Amplitude.
// Run: node scripts/smoke_clock_divider_face_live.mjs  (env: SANDBOX_URL, OUT=dir)
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.SANDBOX_URL || "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const OUT = process.env.OUT || "scripts/out/clock-divider";
fs.mkdirSync(OUT, { recursive: true });
const fixture = fs.readFileSync(new URL("./fixtures/clock_divider_clock_in.json", import.meta.url), "utf8");
const ID = "clockDivider-1";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const b = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/clock-divider-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: fixture }));
await page.goto(`${BASE}?pagePatch=clock-divider-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction((id) => document.querySelector(`article[data-node="${id}"]`) && !document.body.classList.contains("node-boot-loading"), ID, { timeout: 180000 });
const faceSel = `article[data-node="${ID}"] .node-clock-divider-face`;
check(await page.locator(faceSel).count() === 1, "Clock Divider mounts its own face");
await page.locator('button[aria-label="Play"]:visible').first().click();
await page.waitForTimeout(2000);
// Sample engine state at frame rate for 3 s (4 Hz clock / 4 = one fire per second).
const samples = await page.evaluate(async (id) => {
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await new Promise((r) => requestAnimationFrame(r));
    out.push([Number(nodeGraphModuleScopeLatestOutputValue(id, "__Count", NaN)), Number(nodeGraphModuleScopeLatestOutputValue(id, "Gate", NaN))]);
  }
  return out;
}, ID);
const counts = new Set(samples.map((s) => s[0]));
check([0, 1, 2, 3].every((c) => counts.has(c)) && [...counts].every((c) => c >= 0 && c <= 3), "engine __Count steps through 0..3", JSON.stringify([...counts].sort()));
// Gate (duty 0.5 of 4 clock periods = 0.5 s) is high only while the count is 0 or 1.
const outHigh = samples.filter((s) => s[1] > 0.5);
check(outHigh.length > 0 && outHigh.every((s) => s[0] === 0 || s[0] === 1), "Gate is high only right after the count wraps", `${outHigh.length} high samples`);
// The face paints into its shared-GL face texture (what the GL graph composites);
// read that texture back: pixel stats, dot-row brightness (above the Out bar) + a PNG.
const faceTexture = (name) => page.evaluate(async ([id, name]) => {
  const face = document.querySelector(`article[data-node="${id}"] .node-clock-divider-face`);
  const canvas = face.querySelector("canvas");
  // Paint now and note the engine count this paint used, then read it back.
  drawNodeGraphClockDividerFace(face);
  const count = Number(nodeGraphModuleScopeLatestOutputValue(id, "__Count", NaN));
  const px = nodeGraphSharedGlFacePixels(canvas);
  if (!px) return null;
  const { width: w, height: h, data } = px;
  const img = new ImageData(w, h);
  img.data.set(data);
  const counts = new Map(); const mean = [0, 0, 0];
  for (let i = 0; i < img.data.length; i += 4) { const d = img.data; const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3; counts.set(k, (counts.get(k) || 0) + 1); mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; }
  const n = w * h;
  let dots = 0; for (let i = 0; i < w * Math.floor(h * 0.7) * 4; i += 4) dots += img.data[i] + img.data[i + 1] + img.data[i + 2];
  const c = new OffscreenCanvas(w, h); c.getContext("2d").putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return { name, count, dots: Math.round(dots / (w * Math.floor(h * 0.7))), drawn: 1 - Math.max(...counts.values()) / n, mean: mean.map((v) => Math.round(v / n)), png: btoa(bin) };
}, [ID, name]);
const writeTexture = (t, name) => { if (t) fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(t.png, "base64")); return t; };
const saveTexture = async (name) => writeTexture(await faceTexture(name), name);
// Face texture at each count while playing (count 0 + 1 sit inside the gate: Fire).
const byCount = {};
for (let tries = 0; tries < 200 && Object.keys(byCount).length < 4; tries += 1) {
  const t = await faceTexture("");
  if (t && [0, 1, 2, 3].includes(t.count) && !byCount[t.count]) byCount[t.count] = writeTexture(t, `simple-playing-count-${t.count}`);
  await page.waitForTimeout(40);
}
const before = byCount[2];
check(Boolean(before) && before.drawn > 0.02, "face draws more than its background", JSON.stringify(before && { drawn: before.drawn, mean: before.mean }));
const lum = (t) => (t ? t.dots : 0);
check(lum(byCount[2]) < lum(byCount[3]), "more lit dots as the engine count climbs 2 -> 3", JSON.stringify([2, 3].map((c) => lum(byCount[c]))));
check(lum(byCount[0]) > lum(byCount[3]), "count 0 (gate high): every dot shows Fire", JSON.stringify([0, 3].map((c) => lum(byCount[c]))));
const jacks = await page.evaluate((id) => ({
  text: document.querySelector(`article[data-node="${id}"]`)?.innerText || "",
  digital: ["Gate", "Trigger"].map((p) => nodeGraphPortIsDigitalSignal("clockDivider", p, "output")),
  labels: ["Gate", "Trigger"].map((p) => nodeGraphGateTriggerPortDisplayLabel("clockDivider", p)),
}), ID);
check(JSON.stringify(jacks.labels) === JSON.stringify(["\u25AE", "\u238D"]) && jacks.text.includes("\u25AE") && jacks.text.includes("\u238D"), "jacks read ▮ (Gate) and ⎍ (Trigger)", JSON.stringify(jacks.labels));
check(jacks.digital.every(Boolean), "Gate and Trigger are digital (white cable)");
const params = await page.evaluate((id) => [...document.querySelectorAll(`article[data-node="${id}"] [data-param]`)].map((e) => e.getAttribute("data-param")), ID);
check(!params.includes("threshold") && !params.includes("level"), "no Threshold or Level control on the module", JSON.stringify([...new Set(params)]));
const legacy = await page.evaluate(() => {
  const p = JSON.parse(JSON.stringify(nodeGraphMvp.patch));
  const n = p.nodes.find((x) => x.id === "clockDivider-1");
  n.params = { threshold: 0.2, division: 3, duty: 0.5, level: 0.4 };
  for (const c of p.connections) if (c.sourceNode === "clockDivider-1") c.sourcePort = "Out";
  const v = validateNodeGraphPatch(p);
  const m = v.nodes.find((x) => x.id === "clockDivider-1");
  const c = v.connections.find((x) => x.sourceNode === "clockDivider-1");
  return { params: m.params, port: c?.sourcePort, canonical: typeof nodeGraphCanonicalOutputPort === "function" ? nodeGraphCanonicalOutputPort("clockDivider", c?.sourcePort) : null };
});
check(Number(legacy.params.amplitude) === 0.4 && !("level" in legacy.params) && !("threshold" in legacy.params), "old patch: Level 0.4 loads as Amplitude 0.4, Threshold dropped", JSON.stringify(legacy.params));
check(legacy.port === "Gate" || legacy.canonical === "Gate", "old patch: Out cable lands on Gate", JSON.stringify(legacy));
await page.evaluate(() => openNodeGraphTraceDisplaySettings("clockDivider-1", {}));
await page.waitForTimeout(800);
const labels = await page.evaluate(() => [...document.querySelectorAll("#nodeTraceDisplaySettingsPopover [data-hsl-lamp]")].map((e) => e.getAttribute("data-hsl-label")));
check(JSON.stringify(labels) === JSON.stringify(["Background", "Ring", "Count", "Tick", "Fire"]), "HBS rows Background, Ring, Count, Tick, Fire", JSON.stringify(labels));
const fields = await page.evaluate(() => ["lineThickness", "lineSmoothing", "blinkTime"].map((k) => Boolean(document.querySelector(`#nodeTraceDisplaySettingsPopover [data-trace-display-field="${k}"]`))));
check(JSON.stringify(fields) === "[true,false,false]", "Line thickness only (no Line smoothing, no Blink time)", JSON.stringify(fields));
await page.locator("#nodeTraceDisplaySettingsPopover").screenshot({ path: `${OUT}/simple-settings.png` }).catch(() => {});
await page.evaluate(() => closeNodeGraphTraceDisplaySettings());
// Settings repaint immediately: apply a red background through the shared settings path, read the next frame.
const red = await page.evaluate((id) => {
  const node = nodeGraphPatchNode(id);
  const face = document.querySelector(`article[data-node="${id}"] .node-clock-divider-face`);
  assignNodeGraphTypedDisplaySettingsToNode(node, "clockDividerFace", { ...node.traceDisplaySettings, backgroundHue: 0, backgroundBrightness: 0.5, backgroundSaturation: 1 });
  return Boolean(face) && node.traceDisplaySettings.backgroundHue === 0;
}, ID);
const after = await saveTexture("simple-settings-red-background");
check(red && after && after.mean[0] - before.mean[0] > 40, "background change repaints at once (same task, no frame wait)", JSON.stringify(after && after.mean));
await page.evaluate((id) => { const node = nodeGraphPatchNode(id); assignNodeGraphTypedDisplaySettingsToNode(node, "clockDividerFace", { ...node.traceDisplaySettings, backgroundHue: 205.714, backgroundBrightness: 0.009, backgroundSaturation: 0.59 }); }, ID);
await page.waitForTimeout(600);
await page.locator(`article[data-node="${ID}"]`).screenshot({ path: `${OUT}/simple-module.png` });
await page.locator(`article[data-node="clock-1"]`).screenshot({ path: `${OUT}/simple-clock-source.png` }).catch(() => {});
await page.screenshot({ path: `${OUT}/simple-patch.png` });
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok clock divider face live"); process.exit(failures ? 1 : 0);
