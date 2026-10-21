// One jack path: every outlet (module outputs incl. Smooth Graph's, and param
// thru outlets) is driven by the GL hit test only. A plain click arms a wire
// (never a self-plug zap), and a drag lands on each Attenuverter param slider. Server on :8090 or SANDBOX_URL. System Chrome.
import { chromium } from "playwright-core";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const P = { nodes: [
  { id: "sg", type: "smoothGraph", gx: 0, gy: 8 },
  { id: "re", type: "resonantEnvelope", gx: 0, gy: 30 },
  { id: "a3", type: "attenuverter", gx: 20, gy: 8 },
  { id: "k1", type: "attenuverter", gx: 20, gy: 22 },
  { id: "ad", type: "expAdsr", gx: 40, gy: 8 }],
  connections: [], modulations: [{ sourceNode: "k1", sourcePort: "Out", destinationNode: "sg", destinationParam: "tension" }] };
const b = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/we-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(P) }));
await page.goto(`${BASE}?pagePatch=we-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="a3"]') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
await page.waitForTimeout(2500);
// The interaction help card sits over the workspace top; keep it off the jacks.
await page.evaluate(() => { const h = document.getElementById("nodeInteractionHelp"); if (h) h.style.display = "none"; });
// Client point of a GL jack (the picture the user sees), or of a DOM element centre.
const pointOf = (q) => page.evaluate((q) => {
  const w0 = nodeGraphGlGraphToWorld(0, 0); const w1 = nodeGraphGlGraphToWorld(100, 100);
  const cl = (x, y) => [(x - w0.x) * 100 / (w1.x - w0.x), (y - w0.y) * 100 / (w1.y - w0.y)];
  if (q.jack) {
    const j = (nodeGraphGlGraphState.chrome?.jacks || []).find((j) => j.id === q.node && j.port === q.jack && (q.mod ? (j.kind === "modulation" || j.io === "modulation") : j.io === "output"));
    return j ? cl(j.x, j.y) : null;
  }
  const e = document.querySelector(`article[data-node="${q.node}"] ${q.sel}`);
  if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.5];
}, q);
const mods = () => page.evaluate(() => JSON.stringify(nodeGraphMvp.patch.modulations));
const clear = () => page.evaluate(() => { nodeGraphMvp.patch.modulations = nodeGraphMvp.patch.modulations.filter((m) => m.destinationNode !== "a3"); nodeGraphWireInteractions?.cancelPortConnectionMode?.(); });
const zapped = () => page.evaluate(() => document.querySelectorAll(".node-zap-particle").length);
const sources = [{ node: "sg", jack: "Out" }, { node: "sg", jack: "tension" }, { node: "re", jack: "Out" }];
for (const src of sources) {
  const a = await pointOf(src);
  check(Boolean(a), `${src.node}.${src.jack} has a GL jack`);
  if (!a) continue;
  // Plain click arms, no zap.
  const z0 = await zapped();
  await page.mouse.click(...a); await page.waitForTimeout(250);
  const armed = await page.evaluate(() => Boolean(nodeGraphMvp.portConnectionMode));
  check(armed && (await zapped()) === z0, `${src.node}.${src.jack} plain click arms a wire, no wire break`);
  await clear();
  for (const key of ["amplitude", "offset"]) {
    const targets = {
      slider: await pointOf({ node: "a3", sel: `.node-slider-readout[data-param="${key}"], [data-slider-target="node-a3-${key}"]` }),
    };
    for (const [where, t] of Object.entries(targets)) {
      if (!t) { check(false, `a3.${key} ${where} target found`); continue; }
      for (const how of ["drag"]) {
        await clear();
        const before = await mods();
        if (how === "drag") {
          await page.mouse.move(...a); await page.mouse.down();
          for (let i = 1; i <= 12; i++) await page.mouse.move(a[0] + (t[0] - a[0]) * i / 12, a[1] + (t[1] - a[1]) * i / 12);
          await page.mouse.up();
        } else {
          await page.mouse.click(...a); await page.waitForTimeout(150); await page.mouse.click(...t);
        }
        await page.waitForTimeout(300);
        const added = JSON.parse(await mods()).filter((m) => m.destinationNode === "a3");
        check(added.length === 1 && added[0].destinationParam === key && added[0].sourceNode === src.node,
          `${src.node}.${src.jack} ${how} -> a3.${key} ${where}`, JSON.stringify({ before: before.length, added }));
      }
    }
  }
  await clear();
}
// Curve ADSR Out dropped on Resonant Envelope's Frequency param slider (Argi's repro).
{
  const a = await pointOf({ node: "ad", jack: "Out" });
  const t = await pointOf({ node: "re", sel: `.node-slider-readout[data-param="frequency"], [data-slider-target="node-re-frequency"]` });
  check(Boolean(a && t), "ad.Out jack and re.frequency slider found");
  if (a && t) {
    await page.mouse.move(...a); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(a[0] + (t[0] - a[0]) * i / 12, a[1] + (t[1] - a[1]) * i / 12);
    await page.mouse.up(); await page.waitForTimeout(300);
    const added = JSON.parse(await mods()).filter((m) => m.destinationNode === "re" && m.sourceNode === "ad");
    check(added.length === 1 && added[0].destinationParam === "frequency", "ad.Out drag -> re.frequency", JSON.stringify(added));
  }
}
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok jack one path"); process.exit(failures ? 1 : 0);
