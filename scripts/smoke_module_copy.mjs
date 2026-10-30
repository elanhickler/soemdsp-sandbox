// Module copy smoke: a copied module (Ctrl+C / context-menu Copy, both via
// copyNodeGraphModule) spawns flush below its source, zero grid gap; a second
// copy of the source lands flush below the first copy.
// Usage: node scripts/smoke_module_copy.mjs   (SANDBOX_URL, CHROME_PATH, PW_MODULE optional)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(label);
};
const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 60, gy: 1 }));
d.connections = []; d.graphConnections = []; d.modulations = [];
d.nodes.push({ id: "chorus-1", type: "chorus", gx: 4, gy: 3, params: {} });
d.nodes.push({ id: "pingPongDelay-1", type: "pingPongDelay", gx: 20, gy: 3, params: {} });

const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/copy-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) }));
await page.goto(`${BASE}?pagePatch=copy-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pingPongDelay-1"]'), null, { timeout: 180000 });
await page.waitForTimeout(1500);

for (const src of ["chorus-1", "pingPongDelay-1"]) {
  const r = await page.evaluate((src) => {
    const rect = (id) => nodeGraphPatchNodeGridRect(nodeGraphPatchNode(id));
    setNodeGraphNodeSelection([src]);
    const ids = [...nodeGraphMvp.patch.nodes.map((n) => n.id)];
    copySelectedNodeGraphModule();
    const a = nodeGraphMvp.patch.nodes.find((n) => !ids.includes(n.id))?.id;
    nodeGraphMvp.sceneContextTargetNode = src;
    const ids2 = [...nodeGraphMvp.patch.nodes.map((n) => n.id)];
    copyNodeGraphModule(nodeGraphPatchNode(src));
    const b = nodeGraphMvp.patch.nodes.find((n) => !ids2.includes(n.id))?.id;
    return { s: rect(src), a: a && rect(a), b: b && rect(b) };
  }, src);
  check(`${src}: copy is flush below (zero gap)`, r.a && r.a.left === r.s.left && r.a.top === r.s.bottom, JSON.stringify(r));
  check(`${src}: second copy is flush below the first`, r.b && r.b.left === r.s.left && r.b.top === r.a.bottom, JSON.stringify(r));
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all module copy checks passed");
process.exitCode = failures.length ? 1 : 0;
