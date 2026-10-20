// Probe: SinCos4 face Display Settings — size-only controls (ray / ring / hub
// thickness + Outer / Hub dot size + Pixel density); colours stay fixed; defaults = old look.
// Usage: node scripts/probe_sincos4_display_settings.mjs (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof createNodeGraphSinCos4Display === "function" && nodeGraphMvp?.patch, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const out = {};
  const id = "probeSinCos4";
  const node = { id, type: "sineWavetable", params: { mode: 2, freq: 1, phase: 0 }, traceDisplaySettings: {} };
  nodeGraphMvp.patch.nodes.push(node);
  const sec = createNodeGraphSinCos4Display(id);
  sec.style.cssText = "position:fixed;left:0;top:0;width:200px;height:200px;z-index:99999";
  document.body.append(sec);
  await new Promise((res) => setTimeout(res, 300));
  // Capture what the face hands the WebGL line batch.
  let calls = [];
  const wrap = (name) => { const real = globalThis[name]; globalThis[name] = (...a) => { calls.push([name, ...a.slice(1).map((v) => (Array.isArray(v) ? (typeof v[0] === "number" && v.length <= 4 ? v.map((x) => +(+x).toFixed(4)) : v.length) : (typeof v === "number" ? +v.toFixed(4) : v)))]); return real(...a); }; };
  ["nodeGraphGlLinesPolyline", "nodeGraphGlLinesRing", "nodeGraphGlLinesSegment", "nodeGraphGlLinesDot"].forEach(wrap);
  const grab = () => { calls = []; sec._sinCos4ForceDraw = true; sec._sinCos4LaidOut = false; drawNodeGraphSinCos4Display(sec); const c = calls.slice(); return c; };
  out.side = Math.min(sec.clientWidth, sec.clientHeight);
  out.def = grab();
  // Old fixed look, same formulas as before this change.
  const side = out.side, f = 0.7, half = (u) => Math.max(0, u * side * 0.5 - f * 0.5), tip = 0.01 + 0.08 * 0.04;
  out.expect = { ring: +half(0.012).toFixed(4), ray0: +half(0.012 * 1.35).toFixed(4), ray: +half(0.012).toFixed(4), tip0: +Math.max(0, tip * 1.15 * side - f * 0.5).toFixed(4), tip: +Math.max(0, tip * side - f * 0.5).toFixed(4), hub: +Math.max(0, tip * 0.7 * side - f * 0.5).toFixed(4) };
  assignNodeGraphTypedDisplaySettingsToNode(node, "sinCos4Face", { sinCos4RayThickness: 3, sinCos4RingThickness: 0.5, sinCos4HubSize: 1.5, sinCos4OuterDotSize: 0.08, sinCos4HubDotSize: 0.08 });
  out.chg = grab();
  out.stored = node.traceDisplaySettings;
  const dots = (cs) => cs.filter((x) => x[0] === "nodeGraphGlLinesDot").map((x) => x[3]);
  node.traceDisplaySettings = { sinCos4OuterDotSize: 3 }; out.outerOnly = dots(grab());
  node.traceDisplaySettings = { sinCos4HubDotSize: 3 }; out.hubOnly = dots(grab());
  node.traceDisplaySettings = { dot1Size: 3 }; out.legacy = dots(grab());
  node.traceDisplaySettings = { sinCos4OuterDotSize: 3, sinCos4HubDotSize: 3 }; out.both = dots(grab());
  node.traceDisplaySettings = {}; out.base = dots(grab());
  const pop = document.createElement("div"); pop.id = "probePop4"; pop.innerHTML = "<div data-display-settings-body></div>"; document.body.append(pop);
  try { mountNodeGraphDisplaySettingsBody(pop, "sinCos4Face", node); out.formHas = ["nodeTraceDisplaySinCos4OuterDotSize", "nodeTraceDisplaySinCos4HubDotSize", "nodeTraceDisplaySinCos4RayThickness", "nodeTraceDisplaySinCos4RingThickness", "nodeTraceDisplaySinCos4HubSize"].filter((k) => pop.innerHTML.includes(k)); out.formDot1 = pop.innerHTML.includes("nodeTraceDisplayDot1Size"); out.formColour = /hbs|Color/i.test(pop.innerHTML.replace(/class="[^"]*"/g, "")); } catch (e) { out.formErr = String(e); }
  return out;
});
const widths = (calls) => ({ ring: calls.find((c) => c[0] === "nodeGraphGlLinesRing")?.[4], ringR: calls.find((c) => c[0] === "nodeGraphGlLinesRing")?.[3], poly: calls.filter((c) => c[0] === "nodeGraphGlLinesPolyline").length, rays: calls.filter((c) => c[0] === "nodeGraphGlLinesSegment").map((c) => c[5]), dots: calls.filter((c) => c[0] === "nodeGraphGlLinesDot").map((c) => c[3]), colours: calls.map((c) => JSON.stringify(c.at(-1))) });
const d = widths(r.def), c = widths(r.chg), e = r.expect;
console.log("side", r.side, "expected old", JSON.stringify(e));
console.log("default", JSON.stringify({ ring: d.ring, rays: d.rays, dots: d.dots }));
console.log("changed", JSON.stringify({ ring: c.ring, rays: c.rays, dots: c.dots }));
const near = (a, b) => Math.abs(a - b) < 1e-3;
gate(near(d.ring, e.ring) && near(d.rays[0], e.ray0) && d.rays.slice(1).every((w) => near(w, e.ray)) && near(d.dots[0], e.tip0) && near(d.dots.at(-1), e.hub), "defaults draw the old ring / ray / tip / hub widths");
gate(c.ring < d.ring && c.rays[0] > d.rays[0] && c.dots.at(-1) > d.dots.at(-1), "ring / line thickness and hub size drive the WebGL draw");
console.log("dots base/outer/hub/legacy", JSON.stringify([r.base, r.outerOnly, r.hubOnly, r.legacy]));
gate(r.outerOnly[0] > r.base[0] && r.outerOnly[1] > r.base[1] && near(r.outerOnly.at(-1), r.base.at(-1)), "Outer dot size grows only the ring dots");
gate(r.hubOnly.at(-1) > r.base.at(-1) && near(r.hubOnly[0], r.base[0]), "Hub dot size grows only the centre dot");
gate(JSON.stringify(r.legacy) === JSON.stringify(r.both), "old saved Size (dot1Size) draws as Outer = Hub = Size");
gate(d.poly === 0 && near(d.ringR, 0.38 * r.side), `ring is one analytic nodeGraphGlLinesRing (r ${d.ringR}), no polyline`);
gate(JSON.stringify(c.colours) === JSON.stringify(d.colours), "colours unchanged by the size controls");
gate(r.formHas?.length === 5 && !r.formDot1, `form shows Outer / Hub dot size + the three thickness rows (${r.formHas} ${r.formErr || ""})`);
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close(); console.log(failures ? `${failures} FAIL` : "all ok"); process.exit(failures ? 1 : 0);
