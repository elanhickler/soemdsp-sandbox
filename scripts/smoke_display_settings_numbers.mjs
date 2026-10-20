// DS-7 smoke: Display Settings number fields (drag law, fine modifiers,
// Ctrl/Cmd+click reset, Alt, steppers, hue wrap, labels) + DS-9 wheel audit.
//
// Usage: SANDBOX_URL=http://127.0.0.1:8765/ node scripts/smoke_display_settings_numbers.mjs
// Needs playwright (or playwright-core + CHROME_PATH).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("playwright-core"));
}

const ROOT = process.env.SANDBOX_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

// ---- DS-9 static audit: wheel listeners in public/ are zoom / scroll only.
const ALLOWED_WHEEL_FILES = new Set([
  "node-graph-workspace-zoom.js",
  "node-graph-sample-waveform.js",
  "text-box-widget.js",
  "text-box-host.js",
  "node-graph-magnifier.js",
  "audio-player-playlist.js",
  "node-graph-workspace-event-bindings.js",
  "node-graph-workspace-view.js",
]);
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith(".js") ? [p] : []);
});
const wheelFiles = walk(join(ROOT, "public"))
  .filter((p) => /addEventListener\(\s*["']wheel["']/.test(readFileSync(p, "utf8")))
  .map((p) => p.split(/[\\/]/).pop());
const unexpected = wheelFiles.filter((f) => !ALLOWED_WHEEL_FILES.has(f));
check(unexpected.length === 0, "wheel listeners are zoom/scroll only", unexpected.join(", "));
check(!/function bindNodeGraphNativeSliderModifiers[\s\S]*?addEventListener\("wheel"[\s\S]*?^function bindNodeGraphNativeSliderModifiersIn/m
  .test(readFileSync(join(ROOT, "public/node-graph-slider-dragging.js"), "utf8")), "native range panels have no wheel");

// ---- Browser checks.
const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof window.nodeGraphDisplaySettingsFieldSpec === "function"
  && typeof window.dragNodeGraphTraceDisplayField === "function"
  && typeof window.formatNodeGraphTraceDisplaySetting === "function"
  && typeof window.buildNodeGraphDisplaySettingsBodyHtml === "function"
  && typeof window.bindNodeGraphNativeSliderModifiers === "function", null, { timeout: 120000 });
await page.waitForTimeout(500);

const results = await page.evaluate(() => {
  const out = [];
  const ok = (cond, label, detail = "") => out.push({ ok: Boolean(cond), label, detail: String(detail) });
  let pop = document.getElementById("nodeTraceDisplaySettingsPopover");
  const created = !pop;
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "nodeTraceDisplaySettingsPopover";
    pop.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(pop);
  }
  const savedType = pop.dataset.displaySettingsType;
  const savedApply = window.applyNodeGraphTraceDisplaySettingsForm;
  const savedDirty = window.markNodeGraphTraceDisplaySettingsDirty;
  const applies = [];
  window.applyNodeGraphTraceDisplaySettingsForm = (opts) => applies.push(opts);
  window.markNodeGraphTraceDisplaySettingsDirty = () => {};
  const ev = (input, x, y, mods = {}) => ({
    button: 0, detail: 1, pointerId: 1, target: input, clientX: x, clientY: y, type: mods.type || "pointermove",
    shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt,
    preventDefault() {}, stopPropagation() {},
  });
  const clearSmoke = () => pop.querySelectorAll("[data-ds-smoke]").forEach((el) => el.remove());
  const field = (key, value) => {
    clearSmoke();
    const input = document.createElement("input");
    input.dataset.dsSmoke = "1";
    input.readOnly = true;
    input.setAttribute("data-trace-display-field", key);
    input.value = window.formatNodeGraphTraceDisplaySetting(value);
    pop.appendChild(input);
    return input;
  };
  const drag = (input, path, mods = {}) => {
    window.beginNodeGraphTraceDisplayFieldDrag(ev(input, 0, 0, { ...mods, type: "pointerdown" }));
    let last = { x: 0, y: 0 };
    for (const p of path) {
      last = p;
      window.dragNodeGraphTraceDisplayField(ev(input, p.x, p.y, p.mods || mods));
    }
    window.endNodeGraphTraceDisplayFieldDrag(ev(input, last.x, last.y, { ...mods, type: "pointerup" }));
    return Number(input.value);
  };
  const line = (n, mods) => Array.from({ length: n }, (_, i) => ({ x: i + 1, y: 0, mods }));
  try {
    // 1. Sweep / History rate fields: +20 px from 5 is modest; full sweep ≈ 220 px.
    const cases = [
      ["lineBurn", "sweepHz"], ["lineBurn", "sweepCycles"],
      ["trace", "historyHz"], ["gradientVectorscopeFace", "historyCycles"],
    ];
    for (const [type, key] of cases) {
      pop.dataset.displaySettingsType = type;
      const spec = window.nodeGraphDisplaySettingsFieldSpec(key);
      const v20 = drag(field(key, 5), line(20));
      ok(v20 > 5 && v20 < 20, `${type}.${key}: 5 +20 px stays modest`, v20);
      const input = field(key, spec.min);
      window.beginNodeGraphTraceDisplayFieldDrag(ev(input, 0, 0, { type: "pointerdown" }));
      let full = null;
      for (let px = 1; px <= 400; px += 1) {
        window.dragNodeGraphTraceDisplayField(ev(input, px, 0));
        if (Number(input.value) >= spec.max - 1e-9) { full = px; break; }
      }
      window.endNodeGraphTraceDisplayFieldDrag(ev(input, 0, 0, { type: "pointerup" }));
      ok(full !== null && full >= 210 && full <= 230, `${type}.${key}: full sweep ≈ 220 px`, full);
    }
    // Q2: 0 Hz pause detent — the first few px stay 0, then 0.01+ Hz.
    pop.dataset.displaySettingsType = "lineBurn";
    ok(drag(field("sweepHz", 0), line(3)) === 0, "sweepHz: 0 Hz is a detent (3 px stays 0)");
    const off = drag(field("sweepHz", 0), line(6));
    ok(off >= 0.01 && off < 0.05, "sweepHz: leaving the detent lands just above 0.01 Hz", off);
    ok(window.nodeGraphDisplaySettingsFieldSpec("sweepCycles").min === 0.05, "Q3: cycles min 0.05");

    // 2. Fine ×0.1 / ×0.01, and no jump when Shift changes mid-drag.
    pop.dataset.displaySettingsType = "lineBurn";
    const plain = drag(field("trail", 0.5), line(22)) - 0.5;
    const fine = drag(field("trail", 0.5), line(22, { shift: true })) - 0.5;
    const ctrlFine = drag(field("trail", 0.5), [{ x: 3, y: 0 }, ...line(22).map((p) => ({ ...p, x: p.x + 3 }))], { ctrl: true }) - 0.5;
    const extra = drag(field("trail", 0.5), line(22, { shift: true, ctrl: true })) - 0.5;
    ok(Math.abs(fine - plain * 0.1) < 0.002, "Shift drag = ×0.1", `${plain} vs ${fine}`);
    ok(Math.abs(ctrlFine - plain * 0.1) < 0.004, "Ctrl drag = ×0.1", ctrlFine);
    ok(Math.abs(extra - plain * 0.01) < 0.002, "Shift+Ctrl drag = ×0.01", extra);
    const mid = drag(field("trail", 0.5), [
      ...line(10),
      { x: 10, y: 0, mods: { shift: true } },
      { x: 11, y: 0, mods: { shift: true } },
    ]);
    ok(Math.abs(mid - (0.5 + 10 / 220 + 0.1 / 220)) < 0.002, "Shift pressed mid-drag re-anchors (no jump)", mid);

    // 3. Ctrl/Cmd+click resets to the form default with one recorded apply.
    for (const [type, key] of [["lineBurn", "trail"], ["lineBurn", "dot1Size"], ["lineBurn", "sweepHz"],
      ["trace", "historyHz"], ["imageBurnFace", "blur"], ["lineBurn", "dotBudget"], ["lineBurn", "backgroundHue"],
      ["spectrogramBurn", "fftSize"]]) {
      pop.dataset.displaySettingsType = type;
      const def = window.normalizeNodeGraphTraceDisplaySettingValueForKey(key, window.nodeGraphDisplaySettingsDefaultValue(key));
      const spec = window.nodeGraphDisplaySettingsFieldSpec(key);
      const input = field(key, spec.max);
      applies.length = 0;
      window.beginNodeGraphTraceDisplayFieldDrag(ev(input, 0, 0, { ctrl: true, type: "pointerdown" }));
      window.dragNodeGraphTraceDisplayField(ev(input, 1, 0, { ctrl: true }));
      window.endNodeGraphTraceDisplayFieldDrag(ev(input, 1, 0, { ctrl: true, type: "pointerup" }));
      const recorded = applies.filter((a) => a?.record === true).length;
      ok(Math.abs(Number(input.value) - def) < 1e-6 && recorded === 1, `Ctrl+click resets ${type}.${key}`, `${input.value} vs ${def}, records ${recorded}`);
    }
    // Ctrl+drag past the threshold is a fine drag, not a reset.
    pop.dataset.displaySettingsType = "lineBurn";
    const cd = drag(field("trail", 0.9), line(30), { ctrl: true });
    ok(cd > 0.9 && cd < 0.92, "Ctrl+drag is fine drag, not reset", cd);

    // 4. Alt: no jump, plain gain.
    const alt = drag(field("trail", 0.5), line(22), { alt: true }) - 0.5;
    ok(Math.abs(alt - plain) < 1e-6, "Alt+drag = plain drag", alt);

    // 6. Steppers: spec step, Shift fine, integers stay whole, FFT table.
    const step = (key, value, dir, shift = false) => {
      const input = field(key, value);
      const host = document.createElement("label");
      host.dataset.dsSmoke = "1";
      host.appendChild(input);
      const btn = document.createElement("button");
      btn.setAttribute("data-trace-display-step-target", key);
      btn.setAttribute("data-trace-display-step-direction", String(dir));
      host.appendChild(btn);
      pop.appendChild(host);
      // A drag end suppresses the next click for 180 ms; steppers here are separate gestures.
      for (const el of [pop, ...pop.querySelectorAll("[data-settings-text-suppress-click]")]) {
        el.dataset.settingsTextSuppressClick = "false";
      }
      window.stepNodeGraphTraceDisplaySetting({ target: btn, shiftKey: shift, detail: 1, preventDefault() {}, stopPropagation() {} });
      return Number(input.value);
    };
    pop.dataset.displaySettingsType = "lineBurn";
    ok(Math.abs(step("trail", 0.5, 1) - 0.6) < 1e-9, "stepper + = 0.1 on unit field");
    ok(Math.abs(step("trail", 0.5, 1, true) - 0.51) < 1e-9, "Shift stepper = fine 0.01");
    const s5 = step("sweepHz", 5, 1);
    ok(s5 > 5 && s5 < 7, "sweepHz + from 5 is a small log step", s5);
    ok(step("dotBudget", 2048, 1) === 2049, "dotBudget steps by 1");
    pop.dataset.displaySettingsType = "spectrogramBurn";
    ok(step("fftSize", 1024, 1) === 2048, "FFT + walks the size table");
    pop.dataset.displaySettingsType = "knobFace";
    ok(Number.isInteger(drag(field("decimals", 2), line(37))), "integer drag stays whole");

    // 7. Hue wraps and 1 px ≤ 2°.
    pop.dataset.displaySettingsType = "lineBurn";
    const h1 = drag(field("backgroundHue", 100), line(1));
    ok(h1 - 100 > 0 && h1 - 100 <= 2, "hue: 1 px ≤ 2°", h1 - 100);
    ok(step("backgroundHue", 359, 1) === 0, "hue + wraps 359→0");

    // 8. Gain does not depend on canvas zoom (screen px only).
    const savedZoom = window.nodeGraphMvp.zoom;
    const gains = [0.5, 1, 2].map((z) => {
      window.nodeGraphMvp.zoom = z;
      return drag(field("trail", 0.2), line(22));
    });
    window.nodeGraphMvp.zoom = savedZoom;
    ok(gains.every((g) => Math.abs(g - gains[0]) < 1e-9), "gain identical at zoom 0.5 / 1 / 2", gains.join(","));

    // Q4 labels.
    const html = window.buildNodeGraphDisplaySettingsBodyHtml("lineBurn", null) || "";
    ok(!html.includes("Sweep (c)"), "no 'Sweep (c)' label");
    ok(nodeGraphDisplaySettingsFieldMeta.historyCycles.label === "History (cycles)", "History (cycles) label");
    ok(nodeGraphDisplaySettingsFieldMeta.sweepCycles.label === "Sweep (cycles)", "Sweep (cycles) label");
  } catch (err) {
    ok(false, "exception", err.stack || err);
  } finally {
    clearSmoke();
    pop.dataset.displaySettingsType = savedType || "";
    window.applyNodeGraphTraceDisplaySettingsForm = savedApply;
    window.markNodeGraphTraceDisplaySettingsDirty = savedDirty;
    window.nodeGraphMvp.traceDisplayFieldDragging = null;
    if (created) pop.remove();
  }
  return out;
});
for (const r of results) check(r.ok, r.label, r.detail);

// 12. DS-8 order (APP_POLICY §21b), Sync off and on: rate row within the first
// 3 numeric rows after Sync/Scale; nothing but colors / image slots after the
// first color widget.
const order = await page.evaluate(() => {
  const TYPES = [
    "dot", "gradientVectorscopeFace", "graphFace", "hypersawBurn", "imageBurnFace", "knobFace", "lcd",
    "lcdDot", "led", "lineBurn", "numberReadout", "oscilloscopeBankBurn", "output", "phosphorLight",
    "pulseDot", "rasterRgbFace", "roundShapeFace", "basicShapeFace", "scope2d", "scope2dTrace",
    "softwaveOscFace", "spectrogramBurn", "trace", "traceRgb", "traceXyz", "value", "valueLcd",
    "vectorDot", "vectorRgbFace", "videoscopeBurn", "xyPad",
  ];
  const RATE = new Set(["sweepHz", "sweepCycles", "historyHz", "historyCycles", "historySeconds", "zoomSeconds"]);
  const COLOR = "[data-trace-display-color-row], [data-hue-title-stepper], [data-gradient-selector-host], input[type=color], [data-sound-color-widget]";
  const IMAGE = "[data-image-asset-row], [data-image-asset], [data-knob-face-layer]";
  const CONTROL = "[data-trace-display-field], [data-trace-display-choice], [data-trace-display-toggle], button, select";
  const out = [];
  let pop = document.getElementById("nodeTraceDisplaySettingsPopover");
  const created = !pop;
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "nodeTraceDisplaySettingsPopover";
    document.body.appendChild(pop);
  }
  const savedType = pop.dataset.displaySettingsType;
  for (const type of TYPES) {
    pop.dataset.displaySettingsType = type;
    let html = "";
    try {
      html = window.buildNodeGraphDisplaySettingsBodyHtml(type, null) || "";
    } catch (err) {
      out.push({ type, error: String(err.message || err) });
      continue;
    }
    const host = document.createElement("div");
    host.innerHTML = html;
    const all = [...host.querySelectorAll("*")];
    const firstColor = all.findIndex((el) => el.matches(COLOR));
    const late = firstColor < 0 ? [] : all.slice(firstColor).filter((el) => el.matches(CONTROL)
      && !el.closest(COLOR) && !el.closest(IMAGE));
    const numeric = [...host.querySelectorAll("[data-trace-display-field]")]
      .map((el) => el.getAttribute("data-trace-display-field"))
      .filter((k, i, a) => a.indexOf(k) === i && k !== "scale");
    const rateIdx = numeric.findIndex((k) => RATE.has(k));
    out.push({
      type,
      rateIdx,
      hasRate: rateIdx >= 0,
      late: late.map((el) => el.getAttribute("data-trace-display-field")
        || el.getAttribute("data-trace-display-choice") || el.getAttribute("data-trace-display-toggle")
        || el.textContent.trim().slice(0, 20) || el.tagName),
    });
  }
  pop.dataset.displaySettingsType = savedType || "";
  if (created) pop.remove();
  return out;
});
for (const r of order) {
  if (r.error) {
    check(false, `order ${r.type}: build error`, r.error);
    continue;
  }
  if (r.hasRate) {
    check(r.rateIdx < 3, `order ${r.type}: rate row in the first 3 numeric rows`, r.rateIdx);
  }
  check(r.late.length === 0, `order ${r.type}: nothing after the first color`, r.late.join(", "));
}

// 10. Native range panel: 220 px travel, Ctrl+click reset, wheel changes nothing.
const native = await page.evaluate(() => {
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.01";
  input.value = "0.2";
  input.style.cssText = "position:fixed;left:10px;top:10px;width:80px;z-index:2147483647";
  document.body.appendChild(input);
  window.bindNodeGraphNativeSliderModifiers(input, 0.5);
  return true;
});
const box = await page.locator('input[type="range"][data-native-slider-modifiers-bound="true"]').last().boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const val = () => page.evaluate(() => Number([...document.querySelectorAll('input[type="range"][data-native-slider-modifiers-bound="true"]')].pop().value));
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 44, cy, { steps: 4 });
await page.mouse.up();
const after44 = await val();
check(native && Math.abs(after44 - 0.4) < 0.01, "native range: 44 px = 0.2 of range (220 px travel)", after44);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(50);
check(Math.abs((await val()) - after44) < 1e-9, "native range: wheel changes nothing", await val());
await page.keyboard.down("Control");
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.up();
await page.keyboard.up("Control");
check(Math.abs((await val()) - 0.5) < 1e-9, "native range: Ctrl+click resets to default", await val());

await browser.close();
if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
console.log(failures.length ? `${failures.length} failure(s)` : "all display settings number checks passed");
process.exitCode = failures.length ? 1 : 0;
