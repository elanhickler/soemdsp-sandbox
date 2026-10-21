// Wire ends sit on their modules: every drawn GL wire (incl. param thru / rail
// outlets) starts and ends inside its source / destination module box, never
// off-screen. Server on :8090 or SANDBOX_URL. System Chrome (playwright-core).
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const P = { nodes: [
 { id: "a1", type: "attenuverter", gx: -14, gy: -4, params: { amplitude: 0.5, offset: 0 } },
 { id: "a2", type: "attenuverter", gx: -4, gy: -4, params: { amplitude: 0.5, offset: 0 } },
 { id: "pp", type: "pingPongDelay", gx: 6, gy: -4 },
 { id: "a3", type: "attenuverter", gx: 20, gy: -4 }],
 connections: [], modulations: [
  { sourceNode: "a1", sourcePort: "Out", destinationNode: "a2", destinationParam: "amplitude" },
  { sourceNode: "a1", sourcePort: "Out", destinationNode: "pp", destinationParam: "feedback" },
  { sourceNode: "a1", sourcePort: "Out", destinationNode: "pp", destinationParam: "lfoRate" },
  { sourceNode: "a2", sourcePort: "amplitude", destinationNode: "a3", destinationParam: "offset" },
  { sourceNode: "pp", sourcePort: "mix", destinationNode: "a3", destinationParam: "amplitude" }] };

const b = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.route("**/we-smoke.json*", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(P) }));
await page.goto(`${BASE}?pagePatch=we-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const s = page.locator("#nodeBootStartButton"); if (await s.count()) await s.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="a3"]') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => (nodeGraphGlGraphState.wires || []).filter((w) => w.kind === "modulation").map((w) => {
  const m = nodeGraphMvp.modulations[w.index];
  const n = w.xy.length;
  return { m: `${m.sourceNode}.${m.sourcePort}->${m.destinationNode}.${m.destinationParam}`, a: { x: w.xy[0], y: w.xy[1] }, z: { x: w.xy[n - 2], y: w.xy[n - 1] },
    fb: nodeGraphModuleGeometryGet(m.sourceNode)?.box, tb: nodeGraphModuleGeometryGet(m.destinationNode)?.box };
}));
const inb = (p, bx) => p && bx && p.x >= bx.x - 2 && p.x <= bx.x + bx.w + 2 && p.y >= bx.y - 2 && p.y <= bx.y + bx.h + 2;
if (r.length !== P.modulations.length) { failures++; console.log("FAIL drawn wires", r.length, "of", P.modulations.length); }
for (const x of r) {
  const ok = inb(x.a, x.fb) && inb(x.z, x.tb);
  if (!ok) failures++;
  console.log(ok ? "ok  " : "FAIL", x.m, ok ? "" : JSON.stringify(x));
}
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
if (errs.length) { failures++; console.log("FAIL page errors", errs.slice(0, 3)); }
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok wire ends on modules"); process.exit(failures ? 1 : 0);

