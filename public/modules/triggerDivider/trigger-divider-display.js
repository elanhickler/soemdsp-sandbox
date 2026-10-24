// Trigger Counter (type triggerDivider) LED face: DSEG "count | division".
// count is the engine __Count (hits toward the next Out pulse). Division is
// the param. Digits use the Clock Divider face lamps (dot = idle, blink = Out).

const NODE_GRAPH_TRIGGER_DIVIDER_LED_FONT = "\"DSEG7 Classic\", Consolas, monospace";
// DSEG 7-seg ink sits high in the em. GL `baseline: "middle"` uses TEXT_ASCENT
// 0.8 and leaves the digits above the bar. Alphabetic + measured ink box.
const NODE_GRAPH_TRIGGER_DIVIDER_LED_INK_OF_EM = 0.80;
let nodeGraphTriggerDividerLedInkCache = null;

function nodeGraphTriggerDividerLedInk(px, family) {
  const key = `${family}|${px}`;
  const hit = nodeGraphTriggerDividerLedInkCache;
  if (hit && hit.key === key) return hit;
  let ascent = px * NODE_GRAPH_TRIGGER_DIVIDER_LED_INK_OF_EM;
  let descent = 0;
  try {
    const baked = typeof nodeGraphDisplayCanvasBakeGlyphAtlas === "function"
      ? nodeGraphDisplayCanvasBakeGlyphAtlas({
        glyphs: ["8"], cols: 1, cellW: 1, cellH: 1, fontPx: px, family, weight: 400,
        transparent: true, metrics: true, skipDraw: true,
      })
      : null;
    const m = baked?.glyphMetrics?.[0];
    const a = Number(m?.ascent);
    const d = Number(m?.descent);
    if (Number.isFinite(a) && Number.isFinite(d) && a + d > 1) {
      ascent = a;
      descent = d;
    }
  } catch (_e) { /* headless smoke */ }
  nodeGraphTriggerDividerLedInkCache = { key, ascent, descent, height: ascent + descent };
  return nodeGraphTriggerDividerLedInkCache;
}

function applyNodeGraphTriggerDividerDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-trigger-divider-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._triggerDividerForceDraw = true;
  drawNodeGraphTriggerDividerFace(el);
}

function nodeGraphTriggerDividerFaceDivision(node) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, "division", 2) : node?.params?.division;
  const n = Math.floor(Number(live) + 0.5);
  return Number.isFinite(n) ? Math.max(1, Math.min(64, n)) : 2;
}

function nodeGraphTriggerDividerFaceEngineState(nodeId, division) {
  const ctx = nodeGraphMvp?.live?.context;
  if (!ctx || ctx.state !== "running" || typeof nodeGraphModuleScopeLatestOutputValue !== "function") return null;
  const count = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "__Count", Number.NaN));
  if (!Number.isFinite(count)) return null;
  const out = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "Out", 0));
  return {
    count: Math.max(0, Math.round(count)),
    pulse: Number.isFinite(out) && out > 0,
  };
}

function drawNodeGraphTriggerDividerFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const division = nodeGraphTriggerDividerFaceDivision(node);
  const state = nodeGraphTriggerDividerFaceEngineState(section.dataset.node, division);
  const count = state ? state.count : 0;
  const look = typeof nodeGraphClockDividerFaceSettingsForNode === "function"
    ? nodeGraphClockDividerFaceSettingsForNode(node)
    : { backgroundPaint: "#030508", dotPaint: "#ffb000", blinkPaint: "#ffe56a" };
  const rgba = (css) => (typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1])
    : [1, 1, 1, 1]);
  const bg = rgba(look.backgroundPaint);
  const batch = nodeGraphGlLinesBegin(canvas, bg, { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "trigger divider face: no shared GL device");
    return;
  }
  const digit = rgba(state?.pulse ? look.blinkPaint : look.dotPaint);
  const left = String(count);
  const right = String(division);
  const family = NODE_GRAPH_TRIGGER_DIVIDER_LED_FONT;
  const measure = (t, px) => (typeof nodeGraphGlLinesMeasureText === "function"
    ? nodeGraphGlLinesMeasureText(t, px, family, 400)
    : px * 0.7 * String(t).length);
  const pad = Math.max(6, Math.min(w, h) * 0.08);
  const barW = Math.max(2, Math.min(w, h) * 0.03);
  const gap = Math.max(6, w * 0.04);
  const eights = (n) => "8".repeat(Math.max(1, n));
  const leftCells = Math.max(left.length, right.length);
  const rightCells = right.length;
  let px = Math.max(10, h - pad * 2);
  const fit = (size) => measure(eights(leftCells), size) + gap + barW + gap + measure(eights(rightCells), size);
  while (px > 8 && fit(px) > w - pad * 2) px -= 1;
  const total = fit(px);
  let x = (w - total) * 0.5;
  const y = h * 0.5;
  const ink = nodeGraphTriggerDividerLedInk(px, family);
  const textY = y + (ink.ascent - ink.descent) * 0.5;
  const barH = Math.max(2, ink.height * 0.92);
  const leftSlot = measure(eights(leftCells), px);
  nodeGraphGlLinesText(batch, left, x + leftSlot, textY, {
    px, family, weight: 400, rgba: digit, align: "right", baseline: "alphabetic",
  });
  x += leftSlot + gap;
  nodeGraphGlLinesRect(batch, x, y - barH * 0.5, barW, barH, digit);
  x += barW + gap;
  nodeGraphGlLinesText(batch, right, x, textY, {
    px, family, weight: 400, rgba: digit, align: "left", baseline: "alphabetic",
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha")) {
    nodeGraphDisplayGlFailed(canvas, "trigger divider face: GL present failed");
  }
}

function createNodeGraphTriggerDividerFace(nodeId, type = "triggerDivider") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-trigger-divider-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "triggerDivider");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-trigger-divider-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `triggerDivider:${el.dataset?.node || ""}`,
    forceKey: "_triggerDividerForceDraw",
    rafKey: "_triggerDividerRaf",
    paint: drawNodeGraphTriggerDividerFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphTriggerDividerFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.triggerDividerFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("triggerDividerFace", createNodeGraphTriggerDividerFace);
}
