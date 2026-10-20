// Real-app check: open Display Settings on a real SinCos / SinCos4 module
// instance (patch load, face in the workspace) and list the rendered rows.
// Usage: node scripts/probe_sincos_real_ui.mjs [patch] (server on :8090 or SANDBOX_URL).
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const PATCH = process.argv[2] || "little_t";
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=${PATCH}`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof openNodeGraphTraceDisplaySettings === "function" && nodeGraphMvp?.patch?.nodes?.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(2500);
const types = process.argv[3] ? process.argv[3].split(",") : ["sinCos", "sineWavetable"];
for (const type of types) {
  const r = await page.evaluate(async ([type, oldSize]) => {
    const node = nodeGraphMvp.patch.nodes.find((n) => n.type === type);
    if (!node) return { type, missing: true };
    // OLD_SIZE=<v>: seed a pre-split saved SinCos4 look ({ dot1Size }) to check migration.
    if (oldSize != null && type === "sineWavetable") node.traceDisplaySettings = { ...(node.traceDisplaySettings || {}), dot1Size: oldSize, sinCos4OuterDotSize: undefined, sinCos4HubDotSize: undefined };
    nodeGraphMvp.sceneContextTargetNode = node.id; nodeGraphMvp.lastModuleActionTargetNode = node.id;
    const opened = openNodeGraphTraceDisplaySettings(node.id, { clientX: 700, clientY: 300 });
    await new Promise((res) => setTimeout(res, 600));
    const pop = document.getElementById("nodeTraceDisplaySettingsPopover");
    return { type, id: node.id, opened: !!opened, hidden: pop?.hidden, formType: pop?.dataset.displaySettingsType, displayMode: node.displayMode || node.traceDisplayMode || null,
      fields: [...(pop?.querySelectorAll("[data-trace-display-field]") || [])].map((el) => `${el.getAttribute("data-trace-display-field")}=${el.value}`),
      hbs: [...(pop?.querySelectorAll("[data-hbs-label]") || [])].map((el) => el.getAttribute("data-hbs-label")),
      text: (pop?.innerText || "").replace(/\s+/g, " ").slice(0, 400),
      // Type big values into the real form fields and commit like the user does.
      typed: await (async () => { const want = { sinCos4RayThickness: 30, sinCos4RingThickness: 40, sinCos4OuterDotSize: 6, sinCos4HubDotSize: 4, lineThickness: 9, dotThickness: 20 };
        const done = {};
        for (const [k, v] of Object.entries(want)) { const el = pop?.querySelector(`[data-trace-display-field="${k}"]`); if (!el) continue;
          el.readOnly = false; el.focus(); el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); el.blur(); await new Promise((res) => setTimeout(res, 150)); done[k] = v; }
        await new Promise((res) => setTimeout(res, 400));
        const td = nodeGraphMvp.patch.nodes.find((n) => n.id === node.id)?.traceDisplaySettings || {};
        return Object.fromEntries(Object.keys(done).map((k) => [k, td[k]])); })() };
  }, [type, process.env.OLD_SIZE != null ? Number(process.env.OLD_SIZE) : null]);
  console.log(JSON.stringify(r));
  if (!r.missing) { await page.locator("#nodeTraceDisplaySettingsPopover").screenshot({ path: `scripts/out/ds_${type}.png` }).catch(() => {}); }
}
console.log("errors", errors.slice(0, 3));
await browser.close();
