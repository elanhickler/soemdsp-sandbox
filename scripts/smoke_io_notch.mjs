// IO notch screenshots: the shader semicircle cut-out on a rail param inlet
// and outlet (Ping Pong Feedback, one cable) and on the IO-section signal
// sockets, at UIDev defaults, rendered at DPR 4 so the smoothstep rim reads.
// Usage: node scripts/smoke_io_notch.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE, SHOT_DIR (default scripts/out/rail-cutout).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || path.join(root, "scripts/out/rail-cutout");
fs.mkdirSync(SHOT, { recursive: true });

function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 40, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.nodes.push({ gx: 1, gy: 1, id: "sw-1", type: "sineWavetable", params: { freq: 1, mode: 0, amp: 0.5 } });
  d.nodes.push({ gx: 12, gy: 1, id: "pp-1", type: "pingPongDelay", params: {} });
  d.modulations = [{ sourceNode: "sw-1", sourcePort: "A", destinationNode: "pp-1", destinationParam: "feedback", tracePoints: [] }];
  return JSON.stringify(d);
}

const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 4 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/io-notch-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=io-notch-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pp-1"] .node-param-port.rail-patched'), null, { timeout: 400000 });
await page.waitForTimeout(2500);
await page.evaluate(() => drawNodeGraphWires());
await page.waitForTimeout(300);

const clip = (sel, padX, padY) => page.evaluate(([s, px, py]) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: Math.max(0, r.left - px), y: Math.max(0, r.top - py), width: r.width + 2 * px, height: r.height + 2 * py };
}, [sel, padX, padY]);
const row = 'article[data-node="pp-1"] .node-parameter-row[data-param="feedback"]';
const inlet = await clip(`${row} .modulation-input`, 14, 6);
const outlet = await clip(`${row} .parameter-output`, 14, 6);
await page.screenshot({ path: path.join(SHOT, "cutout-param-inlet.png"), clip: inlet });
await page.screenshot({ path: path.join(SHOT, "cutout-param-outlet.png"), clip: outlet });
await page.screenshot({ path: path.join(SHOT, "cutout-signal-io.png"), clip: await clip('article[data-node="pp-1"] .dsp-node-io-section', 12, 4) });
await page.screenshot({ path: path.join(SHOT, "cutout-module.png"), clip: await clip('article[data-node="pp-1"]', 20, 10) });
await browser.close();
if (errors.length) console.log("page errors:", errors.slice(0, 5));
console.log(`shots in ${SHOT}`);
process.exitCode = errors.length ? 1 : 0;
