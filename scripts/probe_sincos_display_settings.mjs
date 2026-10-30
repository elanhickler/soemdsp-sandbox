// Probe: SinCos face Display Settings (line/dot/background HBS + thickness).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof createNodeGraphSinCosDisplay === "function" && nodeGraphMvp?.patch, null, { timeout: 120000 });
await page.waitForTimeout(1500);
// await page.exposeFunction("probeShot", async () => (await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 120 } })).toString("base64"));
const r = await page.evaluate(async () => {
  const out = {};
  const id = "probeSinCos";
  const node = { id, type: "sinCos", params: { amp: 1, freq: 1, phase: 0 }, traceDisplaySettings: {} };
  nodeGraphMvp.patch.nodes.push(node);
  nodeGraphMvp.patch.connections = nodeGraphMvp.patch.connections || [];
  nodeGraphMvp.patch.connections.push({ sourceNode: id, sourcePort: "sin", targetNode: "x", targetPort: "y" }, { sourceNode: id, sourcePort: "cos", targetNode: "x", targetPort: "y" });
  const sec = createNodeGraphSinCosDisplay(id);
  sec.style.cssText = "position:fixed;left:0;top:0;width:240px;height:120px;z-index:99999";
  document.body.append(sec);
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await wait(300);
  // Capture what the face hands the WebGL line renderer (colours parsed to RGB).
  const realPresent = nodeGraphCycleLineGlPresent; let frame = null;
  globalThis.nodeGraphCycleLineGlPresent = (c, f) => { frame = f; return realPresent(c, f); };
  const rgb = (css) => { const v = nodeGraphGlLinesCss(css); return v.slice(0, 3).map((x) => Math.round(x * 255)).join(","); };
  const grab = async () => { frame = null; sec._sinCosForceDraw = true; sec._sinCosLaidOut = false; drawNodeGraphSinCosDisplay(sec);
    return { bg: rgb(frame.background), lines: frame.plots.map((l) => ({ c: rgb(l.color), w: l.width })), dots: frame.dots.map((d) => ({ c: rgb(d.color), r: d.radius })) }; };
  out.dbg = { found: !!nodeGraphPatchNode(id), canvasClass: sec.querySelector("canvas")?.className, w: sec.querySelector("canvas")?.width, sig: sec._sinCosSignature || null, wire: nodeGraphSinCosOutputHasWire(id, "sin") };
  const def = await grab();
  out.dbg.sig2 = sec._sinCosSignature || null; { const c = sec.querySelector("canvas"); out.dbg.state = !!c.__cycleLineGl; const d = nodeGraphDisplayCanvasPresentContext(c).getImageData(0,0,1,1).data; out.dbg.px = Array.from(d); out.dbg.keys = Object.keys(c).filter((k) => k.startsWith("_") || k.startsWith("__")); }
  out.defFrame = def; out.def = { corner: def.bg.split(",").map(Number), sin: def.lines[0]?.c === "255,45,45" && def.lines[0]?.w === 2, cos: def.lines[1]?.c === "61,126,255" && def.lines[1]?.w === 2, white: def.dots.every((d) => d.c === "255,255,255" && d.r === 2.5) };
  out.norm = normalizeNodeGraphSinCosFaceSettings({});
  out.sinPaint = out.norm.strokePaint; out.cosPaint = nodeGraphSinCosCosPaint(out.norm); out.dotPaint = out.norm.dotPaint; out.bgPaint = out.norm.backgroundPaint;
  assignNodeGraphTypedDisplaySettingsToNode(node, "sinCosFace", { lineHue: 120, lineBrightness: 0.3, lineThickness: 6, dotThickness: 12, dotHue: 60, dotBrightness: 0.5, dotSaturation: 1, backgroundHue: 0, backgroundBrightness: 0.2, backgroundSaturation: 1 });
  const chg = await grab();
  out.chgFrame = chg; out.chg = { top: chg, corner: chg.bg.split(",").map(Number), look: nodeGraphSinCosFaceSettingsForNode(node) };
  out.schema = (typeof nodeGraphModuleDefinitions !== "undefined" ? nodeGraphModuleDefinitions?.sinCos?.displayModes?.[0]?.settingsSchema : null) ?? null;
  const pop = document.createElement("div"); pop.id = "probePop"; pop.innerHTML = '<div data-display-settings-body></div>'; document.body.append(pop);
  try { mountNodeGraphDisplaySettingsBody(pop, "sinCosFace", node); out.formHtml = pop.innerHTML.length; out.formHas = ["lineThickness", "dotThickness", "lineHue", "dotHue", "backgroundHue"].filter((k) => pop.innerHTML.includes(k)); } catch (e) { out.formErr = String(e); }
  return out;
});
console.log("default frame", JSON.stringify(r.defFrame), "\nchanged frame", JSON.stringify(r.chgFrame), "\nschema", r.schema);
gate(r.def.sin && r.def.cos && r.def.white && r.def.corner.join(",") === "2,6,9", "defaults = original look (#ff2d2d, #3d7eff, white dots, #020609 plate)");
gate(r.chg.corner.join(",") !== "2,6,9" && JSON.stringify(r.chg.top) !== JSON.stringify(r.def.top), "changed HBS / thickness change the WebGL face");
gate(r.formHas && r.formHas.length === 5, `form exposes line/dot/background HBS + thickness (${r.formHas} ${r.formErr || ""})`);
gate(errors.length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await browser.close(); console.log(failures ? `${failures} FAIL` : "all ok"); process.exit(failures ? 1 : 0);
