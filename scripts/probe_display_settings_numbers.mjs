// DS-1 probe: every Display Settings form type x number field.
// Dumps range (from the live clamp), default, spec (taper/step when present),
// and how many screen px an unmodified drag needs for a full min→max sweep,
// measured through the real drag handlers (begin/drag/end).
//
// Usage: SANDBOX_URL=http://127.0.0.1:8765/ node scripts/probe_display_settings_numbers.mjs [--markdown] [--json]
// Needs playwright (or playwright-core + CHROME_PATH).
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("playwright-core"));
}

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const markdown = process.argv.includes("--markdown");
const json = process.argv.includes("--json");

const launch = { headless: true };
if (process.env.CHROME_PATH) {
  launch.executablePath = process.env.CHROME_PATH;
}
const browser = await chromium.launch(launch);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err.message || err)));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) {
  await start.click().catch(() => {});
}
await page.waitForFunction(
  () => typeof window.buildNodeGraphDisplaySettingsBodyHtml === "function"
    && typeof window.beginNodeGraphTraceDisplayFieldDrag === "function",
  null,
  { timeout: 120000 },
);
await page.waitForTimeout(500);

const rows = await page.evaluate(() => {
  const FORM_TYPES = [
    "arpKeysFace", "basicShapeFace", "dot", "evolveFieldFace", "fbmFieldFace", "gradientVectorscopeFace",
    "graphFace", "hypersawBurn", "imageBurnFace", "keyboardControllerFace", "keypadFace", "knobFace", "lcd",
    "lcdDot", "led", "limiterGainFace", "lineBurn", "macroControlsFace", "matrixDisplayFace", "matrixFace",
    "matrixWaterfallFace", "momentaryButtonFace", "numberReadout", "oscilloscopeBankBurn", "output", "patchFace",
    "phosphorLight", "phosphorWaveform", "portalFace", "pulseDot", "rasterRgbFace", "rgbFractalFace",
    "rgbPictureFace", "rgbShapeFace", "roundShapeFace", "scope2d", "scope2dTrace",
    "spectrogramBurn", "textBoxFace", "toggleButtonFace", "trace", "traceRgb", "traceXyz", "transportBpm",
    "value", "valueLcd", "vectorDot", "vectorRgbFace", "videoscopeBurn", "xyPad",
  ];
  // The popover mounts lazily (floating window); a bare host is enough for the
  // form-type lookup the clamps read.
  let pop = document.getElementById("nodeTraceDisplaySettingsPopover");
  const createdPop = !pop;
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "nodeTraceDisplaySettingsPopover";
    pop.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(pop);
  }
  const savedType = pop.dataset.displaySettingsType;
  const savedApply = window.applyNodeGraphTraceDisplaySettingsForm;
  const savedDirty = window.markNodeGraphTraceDisplaySettingsDirty;
  window.applyNodeGraphTraceDisplaySettingsForm = () => {};
  window.markNodeGraphTraceDisplaySettingsDirty = () => {};
  const fake = (input, x, y) => ({
    button: 0, detail: 1, pointerId: 1, target: input, clientX: x, clientY: y,
    shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {},
  });
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const out = [];
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-9999px;top:0";
  pop.appendChild(holder);
  try {
    for (const type of FORM_TYPES) {
      pop.dataset.displaySettingsType = type;
      let html = "";
      try {
        html = window.buildNodeGraphDisplaySettingsBodyHtml(type, null) || "";
      } catch (err) {
        out.push({ type, key: "(build error)", error: String(err.message || err) });
        continue;
      }
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      const keys = [...new Set([...tpl.content.querySelectorAll("[data-trace-display-field]")]
        .map((el) => el.getAttribute("data-trace-display-field")))];
      for (const key of keys) {
        const row = { type, key };
        try {
          const norm = (v) => window.normalizeNodeGraphTraceDisplaySettingValueForKey(key, v);
          const spec = typeof window.nodeGraphDisplaySettingsFieldSpec === "function"
            ? window.nodeGraphDisplaySettingsFieldSpec(key, type)
            : null;
          row.min = spec ? spec.min : num(norm(-1e9));
          row.max = spec ? spec.max : num(norm(1e9));
          row.default = num(window.nodeGraphDisplaySettingsDefaultValue(key));
          row.taper = spec ? (spec.taper + (spec.exponent ? `^${spec.exponent}` : "")) : "";
          row.step = spec ? (spec.integer ? `${spec.step} (int)` : spec.step) : "";
          row.wrap = spec ? Boolean(spec.wrap) : false;
          // Full sweep: start at min, drag right until max (cap 4000 px).
          const input = document.createElement("input");
          input.type = "text";
          input.readOnly = true;
          input.setAttribute("data-trace-display-field", key);
          holder.replaceChildren(input);
          const lo = Number.isFinite(row.min) ? row.min : 0;
          const hi = Number.isFinite(row.max) && Math.abs(row.max) < 1e8 ? row.max : null;
          input.value = window.formatNodeGraphTraceDisplaySetting(lo);
          window.beginNodeGraphTraceDisplayFieldDrag(fake(input, 0, 0));
          let fullPx = null;
          let atStart = Number(input.value);
          let last = atStart;
          for (let px = 1; px <= 4000; px += 1) {
            window.dragNodeGraphTraceDisplayField(fake(input, px, 0));
            last = Number(input.value);
            if (hi !== null && last >= hi - Math.abs(hi - lo) * 1e-6) {
              fullPx = px;
              break;
            }
          }
          window.endNodeGraphTraceDisplayFieldDrag(fake(input, 0, 0));
          row.fullSweepPx = fullPx;
          row.valueAt4000 = fullPx === null ? last : undefined;
          // From default, +20 px.
          const d = Number.isFinite(row.default) ? row.default : lo;
          input.value = window.formatNodeGraphTraceDisplaySetting(d);
          window.beginNodeGraphTraceDisplayFieldDrag(fake(input, 0, 0));
          window.dragNodeGraphTraceDisplayField(fake(input, 20, 0));
          row.defaultPlus20 = Number(input.value);
          window.endNodeGraphTraceDisplayFieldDrag(fake(input, 20, 0));
        } catch (err) {
          row.error = String(err.message || err);
        }
        out.push(row);
      }
    }
  } finally {
    holder.remove();
    if (createdPop) {
      pop.remove();
    }
    pop.dataset.displaySettingsType = savedType || "";
    window.applyNodeGraphTraceDisplaySettingsForm = savedApply;
    window.markNodeGraphTraceDisplaySettingsDirty = savedDirty;
    window.nodeGraphMvp.traceDisplayFieldDragging = null;
  }
  return out;
});

await browser.close();

if (json) {
  console.log(JSON.stringify(rows, null, 2));
} else if (markdown) {
  console.log("| Form | Key | Min | Max | Default | Taper | Step | Full sweep px | Default +20 px |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const sweep = r.error ? `error: ${r.error}` : (r.fullSweepPx ?? `> 4000 (at ${r.valueAt4000})`);
    console.log(`| ${r.type} | ${r.key} | ${r.min ?? ""} | ${r.max ?? ""} | ${r.default ?? ""} | ${r.taper || ""} | ${r.step ?? ""}${r.wrap ? " wrap" : ""} | ${sweep} | ${r.defaultPlus20 ?? ""} |`);
  }
} else {
  const fast = rows.filter((r) => Number.isFinite(r.fullSweepPx) && r.fullSweepPx < 150);
  const errs = rows.filter((r) => r.error);
  console.log(`rows ${rows.length}, keys ${new Set(rows.map((r) => r.key)).size}`);
  console.log(`full sweep < 150 px: ${fast.length}`);
  for (const r of fast) {
    console.log(`  ${r.type}.${r.key}: ${r.fullSweepPx} px (${r.min}…${r.max})`);
  }
  console.log(`errors: ${errs.length}`);
  for (const r of errs) {
    console.log(`  ${r.type}.${r.key}: ${r.error}`);
  }
}
if (errors.length) {
  console.error(`page errors (${errors.length}):`, errors.slice(0, 5));
}
process.exitCode = rows.some((r) => Number.isFinite(r.fullSweepPx) && r.fullSweepPx < 150) ? 1 : 0;
