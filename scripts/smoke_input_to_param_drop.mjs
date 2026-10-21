// B-103 smoke: drag from an input jack onto a parameter mod jack must connect
// that parameter's outlet -> the input (never input -> mod inlet). Also checks
// output -> mod jack still makes a modulation. Server on :8090 or SANDBOX_URL.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const b = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof setNodeGraphPan === "function" && document.querySelector("article[data-node-type]") && !document.body.classList.contains("node-boot-loading"), null, { timeout: 120000 });
await page.waitForTimeout(2500);
const snap = () => page.evaluate(() => JSON.stringify({ c: nodeGraphMvp.patch.connections, m: nodeGraphMvp.patch.modulations }));
const added = (B, A, k) => { const s = new Set(JSON.parse(B)[k].map((x) => JSON.stringify(x))); return JSON.parse(A)[k].filter((x) => !s.has(JSON.stringify(x))); };
async function drag(srcSel) {
  const pts = await page.evaluate((srcSel) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.top > 120 && r.bottom < 950 && r.left > 0 && r.right < 1600; };
    const src = [...document.querySelectorAll(srcSel)].find(vis);
    const mod = [...document.querySelectorAll(".node-param-port.modulation-input")].find((e) => vis(e) && e.dataset.node !== src.dataset.node
      && document.querySelector(`.node-param-port.parameter-output[data-node="${e.dataset.node}"][data-param="${e.dataset.param}"]`));
    const a = src.getBoundingClientRect(); const m = mod.getBoundingClientRect();
    return { src: [src.dataset.node, src.dataset.port], mod: [mod.dataset.node, mod.dataset.param], a: [a.left + a.width / 2, a.top + a.height / 2], m: [m.left + m.width / 2, m.top + m.height / 2] };
  }, srcSel);
  const before = await snap();
  await page.mouse.move(...pts.a); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(pts.a[0] + (pts.m[0] - pts.a[0]) * i / 12, pts.a[1] + (pts.m[1] - pts.a[1]) * i / 12);
  await page.mouse.up(); await page.waitForTimeout(400);
  const after = await snap();
  return { pts, c: added(before, after, "c"), m: added(before, after, "m") };
}
const r1 = await drag('.node-port[data-io="input"]:not(.node-param-port)');
check(r1.c.length === 1 && r1.c[0].sourceNode === r1.pts.mod[0] && r1.c[0].sourcePort === r1.pts.mod[1]
  && r1.c[0].destinationNode === r1.pts.src[0] && r1.c[0].destinationPort === r1.pts.src[1] && r1.m.length === 0,
  "input -> param mod jack connects param outlet -> input", JSON.stringify(r1));
const bad = await page.evaluate(() => nodeGraphMvp.patch.modulations.filter((m) => {
  const d = nodeGraphModuleDefinitions[nodeGraphPatchNode(m.sourceNode)?.type];
  return d && (d.inputs || []).includes(m.sourcePort) && !(d.outputs || []).includes(m.sourcePort);
}));
check(bad.length === 0, "no modulation sourced from an input", JSON.stringify(bad));
const r2 = await drag('.node-port[data-io="output"]:not(.node-param-port)');
check(r2.m.length === 1 && r2.c.length === 0, "output -> param mod jack still modulates", JSON.stringify(r2));
check(errs.length === 0, "no page errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
console.log(failures ? `FAIL ${failures}` : "ok input to param drop"); process.exit(failures ? 1 : 0);
