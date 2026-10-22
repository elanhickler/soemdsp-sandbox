// Pulse Train Curve follows parameter smoothing (it used to jump: the shared
// "curve" key is on the native discrete list, so smooth time/mode/type were
// never pushed for it). Amp Curve is the control (always smoothed). Recalculate
// Off so the engine's in-effect values (__Curve / __AmpCurve) are live.
// Server on :8090 or SANDBOX_URL. Uses system Chrome (playwright-core).
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector("article[data-node]") && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
const id = await page.evaluate(() => {
  const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const n = createNodeGraphPatchNode("pulseTrain", {}, { patch: p });
  n.id = "pulseTrain-smooth"; n.gx = 4; n.gy = 4;
  n.params = { ...(n.params || {}), curve: -8, ampCurve: -8, recalculateOnTrigger: 0, mode: 1 };
  const slow = { smoothingMode: "internal", smoothingType: "linear", linearSmoothing: true, smoothingSeconds: 48000 };
  n.paramMeta = { ...(n.paramMeta || {}), curve: { ...slow }, ampCurve: { ...slow } };
  p.nodes.push(n);
  p.connections.push({ sourceNode: n.id, sourcePort: "Out", destinationNode: "output", destinationPort: "Mono" });
  commitNodeGraphPatch(p, { status: "smoke", topologyEdit: true, livePlan: true });
  return n.id;
});
await page.locator('button[aria-label="Play"]:visible').first().click();
await page.waitForTimeout(2500);
const read = () => page.evaluate((id) => ({ c: Number(nodeGraphModuleScopeLatestOutputValue(id, "__Curve", NaN)), a: Number(nodeGraphModuleScopeLatestOutputValue(id, "__AmpCurve", NaN)) }), id);
const before = await read();
// Move the sliders like a user (input events), not a patch reload (that snaps).
const moved = await page.evaluate((id) => ["curve", "ampCurve"].map((key) => { const s = document.getElementById(`node-${id}-${key}`); if (!s) return key + ":missing"; s.value = "8"; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); return key + ":" + s.value; }), id);
console.log("sliders", JSON.stringify(moved));
const samples = [];
for (let i = 0; i < 8; i++) { await page.waitForTimeout(120); samples.push(await read()); }
await page.waitForTimeout(1500);
const after = await read();
const mid = (key) => samples.some((s) => s[key] > before[key] + 1 && s[key] < 7.5);
console.log(JSON.stringify({ before, samples: samples.map((s) => `${s.c.toFixed(2)}/${s.a.toFixed(2)}`), after }));
check(Math.abs(before.c + 8) < 0.01 && Math.abs(before.a + 8) < 0.01, "start at -8");
check(mid("a"), "Amp Curve glides (control)");
check(mid("c"), "Curve glides (smoothing applied)");
check(Math.abs(after.c - 8) < 0.01 && Math.abs(after.a - 8) < 0.01, "both settle at 8", JSON.stringify(after));
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok pulse train curve smoothing"); process.exit(failures ? 1 : 0);