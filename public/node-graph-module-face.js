// Hand-written module faces (rails plan PP-5). A definition's `face` is a list
// of rows; each row is one widget group drawn in WebGL by
// nodeGraphModuleFaceDrawGl and driven by one pointer handler on .node-face.
// The hidden range inputs in the param rows stay the source of truth, and the
// param rows keep their rail jacks, which are stacked into each face row.
// Look: soundemote-dev experiments/condensed-widgets "Condensed 5".

const NODE_GRAPH_FACE_JACK_SLOT_PX = 17;
const NODE_GRAPH_FACE_CELL_DRAG_PX = 220;
const NODE_GRAPH_FACE_STEP_DRAG_PX = 6;
const NODE_GRAPH_FACE_FILTER_HZ = Object.freeze({ min: 20, max: 20000 });
const NODE_GRAPH_FACE_FILTER_DB_MIN = -18;
const NODE_GRAPH_FACE_FILTER_HANDLE_PX = 10;
const NODE_GRAPH_FACE_FILTER_LABEL_PX = 20;
const NODE_GRAPH_FACE_FILTER_TICK_PX = 16;
// LFO style snip stroke half width (face px): about 1 px wide.
const NODE_GRAPH_FACE_LFO_HALF_PX = 0.5;
const NODE_GRAPH_FACE_BAND_HANDLE_PX = 8;

const NodeGraphFaceInk = Object.freeze({
  rowFill: "#10131a",
  lfoFill: "#0e1117",
  cellFill: "#0e1117",
  cellValueFill: "#1c334c",
  curveBack: "#08090c",
  curveFill: "#1e3a58",
  rowLine: "#2a3140",
  cellLine: "#4a5568",
  tickLine: "#1a2030",
  choiceOn: "#3a6ea8",
  choiceOnText: "#ffffff",
  subOn: "#243044",
  subOnText: "#e8f0ff",
  offText: "#7b8494",
  number: "#f2f5ff",
  slash: "#5a6578",
  label: "#cfdde5",
  value: "#ffffff",
  hpf: "#ffb0a0",
  lpf: "#9ec0ff",
  hpfCurve: "rgb(255 130 110)",
  lpfCurve: "rgb(110 170 255)",
  passCurve: "rgb(142 197 255 / 0.7)",
  tick: "#6fa3b4",
  bandSpan: "#1e3a58",
  bandHandle: "#8ec5ff",
  bandText: "#dce6f5",
  lfoOn: "#c8e4ff",
  lfoOff: "#6a7a90",
});

/** Face rows for a type. With a patch node, hidden params drop out and their rows close up. */
function nodeGraphModuleFaceSpec(type, node = null) {
  const face = nodeGraphModuleDefinitions?.[type]?.face;
  if (!Array.isArray(face) || !face.length) return null;
  if (!node || typeof nodeGraphParameterEffectiveVisible !== "function") return face;
  const defs = nodeGraphModuleDefinitions[type]?.parameters || [];
  const shown = (key) => nodeGraphParameterEffectiveVisible(defs.find((p) => p.key === key), node.paramMeta?.[key]);
  const rows = [];
  for (const row of face) {
    if (row.kind === "cells") {
      const params = row.params.filter((cell) => shown(cell[0]));
      if (params.length) rows.push(params.length === row.params.length ? row : { ...row, params });
    } else if (nodeGraphModuleFaceRowParams(row).some(shown)) {
      rows.push(row);
    }
  }
  return rows;
}

function nodeGraphModuleFaceSpecForElement(el) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(el?.dataset?.node) : null;
  return nodeGraphModuleFaceSpec(el?.dataset?.nodeType, node);
}

/** Params a face row owns, in rail order (top to bottom). */
function nodeGraphModuleFaceRowParams(row) {
  switch (row.kind) {
    case "fraction": return [row.num, row.den, row.mode, row.cell?.[0]].filter(Boolean);
    case "cells": return row.params.map((cell) => cell[0]);
    case "filter": return [row.hpf, row.lpf];
    case "band": return [row.lo, row.hi];
    default: return [row.param];
  }
}

/** Row height: the drawn height, grown so stacked 16 px rail tags never overlap. */
function nodeGraphModuleFaceRowHeight(row) {
  return Math.max(row.h, nodeGraphModuleFaceRowParams(row).length * NODE_GRAPH_FACE_JACK_SLOT_PX);
}

function nodeGraphModuleFaceHeightPx(type, node = null) {
  const spec = nodeGraphModuleFaceSpec(type, node);
  return spec ? spec.reduce((sum, row) => sum + nodeGraphModuleFaceRowHeight(row), 0) : 0;
}

/** Rail inset (px) for a face row of moduleEl: the rail width when the row holds a patched param, else 0. */
function nodeGraphModuleFaceRowInset(moduleEl) {
  if (!moduleEl?.classList.contains("mod-rail-open") || typeof NODE_GRAPH_RAIL_WIDTH_PX === "undefined") return () => 0;
  const patched = new Set([...moduleEl.querySelectorAll(".node-param-port.rail-patched")].map((port) => port.dataset.param));
  return (row) => (nodeGraphModuleFaceRowParams(row).some((key) => patched.has(key)) ? NODE_GRAPH_RAIL_WIDTH_PX : 0);
}

/** Face-local widget boxes for face width fw (layout px, zoom 1). Rows beside a rail gutter are inset. */
function nodeGraphModuleFaceWidgets(spec, fw, moduleEl = null) {
  const out = [];
  const insetOf = nodeGraphModuleFaceRowInset(moduleEl);
  let y = 0;
  const split = (x0, width, n) => Array.from({ length: n }, (_, i) => {
    const a = Math.round(x0 + (width * i) / n);
    const b = Math.round(x0 + (width * (i + 1)) / n);
    return [a, b - a];
  });
  for (const row of spec) {
    const h = nodeGraphModuleFaceRowHeight(row);
    const ins = insetOf(row);
    const w = fw - ins * 2;
    const first = out.length;
    const base = { row, y, h };
    if (row.kind === "choices" || row.kind === "lfoStyles") {
      split(0, w, row.labels.length).forEach(([x, cw], i) => out.push({
        ...base, type: row.kind === "choices" ? "choice" : "lfoStyle", param: row.param, index: i, label: row.labels[i], x, w: cw,
      }));
    } else if (row.kind === "fraction") {
      // Proportional so the row reads at any width (rails take width, never add it).
      const slash = 8;
      const side = Math.round(Math.min(46, w * 0.27));
      const cellW = Math.round(Math.min(50, w * 0.29));
      const numW = Math.max(10, (w - side - cellW - slash) / 2);
      out.push({ ...base, type: "step", param: row.num, x: 0, w: numW });
      out.push({ ...base, type: "slash", x: numW, w: slash });
      out.push({ ...base, type: "step", param: row.den, x: numW + slash, w: numW });
      split(y, h, row.modeLabels.length).forEach(([sy, sh], i) => out.push({
        row, type: "subChoice", param: row.mode, index: i, label: row.modeLabels[i],
        x: numW * 2 + slash, w: side, y: sy, h: sh,
      }));
      out.push({ ...base, type: "cell", param: row.cell[0], label: row.cell[1], bipolar: true, x: w - cellW, w: cellW });
    } else if (row.kind === "cells") {
      split(0, w, row.params.length).forEach(([x, cw], i) => out.push({
        ...base, type: "cell", param: row.params[i][0], label: row.params[i][1], horizontal: !!row.horizontal, x, w: cw,
      }));
    } else if (row.kind === "filter") {
      out.push({ ...base, type: "filter", hpf: row.hpf, lpf: row.lpf, x: 0, w, param: "" });
    } else if (row.kind === "band") {
      out.push({ ...base, type: "band", lo: row.lo, hi: row.hi, label: row.label, x: 0, w, param: "" });
    } else if (row.kind === "seed") {
      const bw = Math.round(Math.min(28, w * 0.15));
      out.push({ ...base, type: "seedNumber", param: row.param, x: 0, w: w - bw * 3 });
      ["dice", "plus", "minus"].forEach((action, i) => out.push({
        ...base, type: "seedButton", action, param: row.param, x: w - bw * (3 - i), w: bw,
      }));
    }
    for (let k = first; k < out.length; k += 1) out[k].x += ins;
    y += h;
  }
  return out;
}

function nodeGraphModuleFaceInput(moduleEl, key) {
  return moduleEl?.querySelector(`.node-parameter-row[data-param="${CSS.escape(key)}"] input[type="range"]`) || null;
}

function nodeGraphModuleFaceValue(input) {
  const domain = Number(input?.dataset?.domainValue);
  return Number.isFinite(domain) ? domain : Number(input?.value) || 0;
}

/** Shown value (modulated when sent) + unit. B-106: same formatter as the slider readout, so the param's Max Digits applies. */
function nodeGraphModuleFaceValueText(input) {
  if (!input) return "";
  if (typeof nodeSliderReadoutValueText === "function") {
    const text = String(nodeSliderReadoutValueText(input)).trim();
    const unit = String(input.dataset.unit || "");
    return unit && !(typeof nodeSliderChoiceLabel === "function" && nodeSliderChoiceLabel(input)) ? `${text} ${unit}` : text;
  }
  const sent = Number(input.dataset.sentDomainValue);
  const v = Number.isFinite(sent) ? sent : nodeGraphModuleFaceValue(input);
  const a = Math.abs(v);
  const integer = Number(input.dataset.step) >= 1;
  const text = integer || (a >= 10 && Math.abs(v - Math.round(v)) < 1e-6) ? String(Math.round(v))
    : v.toFixed(a >= 100 ? 0 : (a >= 10 ? 1 : 2));
  const unit = String(input.dataset.unit || "");
  return unit ? `${text} ${unit}` : text;
}

function nodeGraphModuleFaceTravel(input) {
  if (!input) return 0;
  const sent = Number(input.dataset.sentDomainValue);
  const value = Number.isFinite(sent) ? sent : nodeGraphModuleFaceValue(input);
  const t = typeof nodeSliderTravelFromValue === "function"
    ? nodeSliderTravelFromValue(input, value)
    : (value - Number(input.min)) / Math.max(1e-9, Number(input.max) - Number(input.min));
  return Math.max(0, Math.min(1, Number(t) || 0));
}

function nodeGraphModuleFaceLogT(hz) {
  const { min, max } = NODE_GRAPH_FACE_FILTER_HZ;
  return Math.max(0, Math.min(1, Math.log(Math.max(hz, min) / min) / Math.log(max / min)));
}

function nodeGraphModuleFaceFromLogT(t) {
  const { min, max } = NODE_GRAPH_FACE_FILTER_HZ;
  return min * (max / min) ** Math.max(0, Math.min(1, t));
}

function nodeGraphModuleFaceHzText(hz) {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz`;
  if (hz < 20) return `${hz.toFixed(1)} Hz`;
  return `${Math.round(hz)} Hz`;
}

// LFO style previews: one cycle of each shape, deterministic from the seed.
function nodeGraphModuleFaceLfoShape(style, seed, n) {
  const pts = new Float32Array(n);
  if (style === 0) {
    for (let i = 0; i < n; i += 1) {
      const p = (i / (n - 1)) * 2 % 2;
      const u = p < 1 ? p : p - 1;
      const v = 4 * u * (1 - u);
      pts[i] = p < 1 ? v : -v;
    }
    return pts;
  }
  let s = (Number(seed) >>> 0) + style * 7919 + 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  let v = 0;
  let peak = 1e-6;
  for (let i = 0; i < n; i += 1) {
    if (style === 1) {
      v = v * 0.96 + rnd() * 0.5;
    } else {
      v = rnd() * 0.6 + Math.sin(i * 0.31) * 0.3 + Math.sin(i * 0.11 + 1) * 0.4;
    }
    pts[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < n; i += 1) pts[i] /= peak;
  return pts;
}

/** n cascaded one-pole sections (6 dB/oct each), as the Ping Pong DSP runs them. */
function nodeGraphModuleFaceRolloff(f, fc, highPass, n) {
  const r = highPass ? fc / Math.max(f, 1e-3) : f / Math.max(fc, 1e-3);
  return (1 + r * r) ** (-n / 2);
}

// ---------------------------------------------------------------- DOM -----

/** Mount .node-face over the param body and stack each row's rail jacks. */
function mountNodeGraphModuleFace(article, type) {
  const spec = nodeGraphModuleFaceSpec(type);
  const body = article?.querySelector(":scope > .dsp-node-body");
  if (!spec || !body) return;
  article.classList.add("has-module-face");
  const face = document.createElement("div");
  face.className = "node-face";
  body.append(face);
  layoutNodeGraphModuleFace(article);
  face.addEventListener("pointerdown", (event) => beginNodeGraphModuleFaceGesture(article, face, nodeGraphModuleFaceSpecForElement(article), event));
  face.addEventListener("contextmenu", (event) => openNodeGraphModuleFaceParamOptions(article, face, event));
}

/** Size the face to its visible rows and stack each row's rail jacks (rerun when params hide/show). */
function layoutNodeGraphModuleFace(article) {
  const body = article?.querySelector(":scope > .dsp-node-body");
  const face = body?.querySelector(":scope > .node-face");
  const spec = face ? nodeGraphModuleFaceSpecForElement(article) : null;
  if (!spec) return;
  const total = spec.reduce((sum, row) => sum + nodeGraphModuleFaceRowHeight(row), 0);
  body.style.height = `${total}px`;
  face.style.height = `${total}px`;
  const placed = new Set();
  let y = 0;
  for (const row of spec) {
    const h = nodeGraphModuleFaceRowHeight(row);
    const keys = nodeGraphModuleFaceRowParams(row);
    keys.forEach((key, i) => {
      placed.add(key);
      const slot = h / keys.length;
      for (const port of body.querySelectorAll(`.node-parameter-row[data-param="${CSS.escape(key)}"] > .node-param-port`)) {
        port.style.top = `${Math.round(y + slot * i)}px`;
        port.style.height = `${Math.round(slot)}px`;
      }
    });
    y += h;
  }
  for (const row of body.querySelectorAll(".node-parameter-row")) {
    row.classList.toggle("node-face-unplaced", !placed.has(row.dataset.param));
  }
}

function nodeGraphModuleFaceLocalPoint(face, event) {
  const rect = face.getBoundingClientRect();
  const sx = face.offsetWidth / Math.max(1e-6, rect.width);
  const sy = face.offsetHeight / Math.max(1e-6, rect.height);
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy, sx, sy };
}

function nodeGraphModuleFaceWidgetAt(spec, face, x, y) {
  return nodeGraphModuleFaceWidgets(spec, face.offsetWidth, face.closest(".dsp-node"))
    .find((wd) => wd.type !== "slash" && x >= wd.x && x < wd.x + wd.w && y >= wd.y && y < wd.y + wd.h) || null;
}

/** Wire-drop hit boxes (client px) so a cable dropped on a widget finds its param row. */
function nodeGraphModuleFaceHitBoxes(moduleEl) {
  const face = moduleEl?.querySelector(":scope > .dsp-node-body > .node-face");
  const spec = face ? nodeGraphModuleFaceSpecForElement(moduleEl) : null;
  if (!spec) return [];
  const rect = face.getBoundingClientRect();
  const kx = rect.width / Math.max(1, face.offsetWidth);
  const ky = rect.height / Math.max(1, face.offsetHeight);
  const boxes = [];
  for (const wd of nodeGraphModuleFaceWidgets(spec, face.offsetWidth, moduleEl)) {
    const keys = nodeGraphModuleFaceWidgetKeys(wd);
    keys.forEach((key, i) => {
      const row = key && moduleEl.querySelector(`.node-parameter-row[data-param="${CSS.escape(key)}"]`);
      if (!row) return;
      const part = wd.w / keys.length;
      const left = rect.left + (wd.x + part * i) * kx;
      const top = rect.top + wd.y * ky;
      boxes.push({ row, left, right: left + part * kx, top, bottom: top + wd.h * ky, midY: top + wd.h * ky * 0.5 });
    });
  }
  return boxes;
}

/** Params a widget sets (two-ended widgets own both ends). */
function nodeGraphModuleFaceWidgetKeys(wd) {
  if (wd.type === "filter") return [wd.hpf, wd.lpf];
  if (wd.type === "band") return [wd.lo, wd.hi];
  return [wd.param];
}

/** Band end positions 0..1 across the widget (travel of each end's input). */
function nodeGraphModuleFaceBandEnds(article, wd) {
  const lo = nodeGraphModuleFaceInput(article, wd.lo);
  const hi = nodeGraphModuleFaceInput(article, wd.hi);
  return { lo, hi, tl: nodeGraphModuleFaceTravel(lo), th: nodeGraphModuleFaceTravel(hi) };
}

/** Which end a band press at u (0..1) grabs: inside the span moves both. */
function nodeGraphModuleFaceBandMode(u, tl, th, w) {
  const edge = NODE_GRAPH_FACE_BAND_HANDLE_PX / Math.max(1, w);
  if (u > Math.min(tl, th) + edge && u < Math.max(tl, th) - edge) return "span";
  return Math.abs(u - tl) <= Math.abs(u - th) ? "lo" : "hi";
}

function setNodeGraphModuleFaceValue(input, value, drag) {
  if (!input || typeof setNodeSliderValue !== "function") return;
  setNodeSliderValue(input, value, drag ? { interaction: "drag" } : {});
  if (typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
}

function beginNodeGraphModuleFaceGesture(article, face, spec, event) {
  if (event.button !== 0) return;
  const p = nodeGraphModuleFaceLocalPoint(face, event);
  const wd = nodeGraphModuleFaceWidgetAt(spec, face, p.x, p.y);
  if (!wd) return;
  event.preventDefault();
  event.stopPropagation();
  // B-105: double-click types a value, same rule as every slider surface.
  if (nodeGraphModuleFaceDoubleClick(face, wd, event)) {
    beginNodeGraphModuleFaceValueEdit(article, face, wd, p);
    return;
  }
  const input = wd.param ? nodeGraphModuleFaceInput(article, wd.param) : null;
  // Same modifiers as every slider (nodeGraphNumericResetClickModifier): Ctrl/Cmd+click resets to default.
  if (wd.type !== "seedButton" && wd.type !== "seedNumber" && typeof nodeGraphNumericResetClickModifier === "function"
    && nodeGraphNumericResetClickModifier(event)) {
    for (const key of nodeGraphModuleFaceWidgetKeys(wd)) {
      const target = key ? nodeGraphModuleFaceInput(article, key) : null;
      const def = target && typeof nodeSliderCtrlClickDefaultValue === "function" ? nodeSliderCtrlClickDefaultValue(target) : NaN;
      if (Number.isFinite(def)) setNodeGraphModuleFaceValue(target, def, false);
    }
    return;
  }
  if (wd.type === "choice" || wd.type === "lfoStyle" || wd.type === "subChoice") {
    setNodeGraphModuleFaceValue(input, Number(input?.min || 0) + wd.index, false);
    return;
  }
  if (wd.type === "seedButton") {
    if (input && typeof nodeGraphSeedAction === "function") nodeGraphSeedAction(input, wd.action, event);
    if (typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
    return;
  }
  if (wd.type === "seedNumber") {
    const v0 = Math.round(nodeGraphModuleFaceValue(input));
    const x0 = event.clientX;
    const y0 = event.clientY;
    if (!input || typeof nodeGraphSeedDragValue !== "function") return;
    nodeGraphModuleFaceCapture(face, event, (ev, drag) => setNodeGraphModuleFaceValue(input,
      nodeGraphSeedDragValue(input, v0, (ev.clientX - x0) * p.sx, (ev.clientY - y0) * p.sy), drag));
    return;
  }
  // Drag travel scaled per move by the shared fine/coarse law (nodeGraphNumericDragMultiplier).
  let lx = event.clientX;
  let ly = event.clientY;
  let ax = 0;
  let ay = 0;
  const travel = (ev) => {
    const k = typeof nodeGraphNumericDragMultiplier === "function" ? nodeGraphNumericDragMultiplier(ev) : 1;
    ax += (ev.clientX - lx) * p.sx * k;
    ay += (ev.clientY - ly) * p.sy * k;
    lx = ev.clientX;
    ly = ev.clientY;
    return { dx: ax, dy: ay };
  };
  let move = null;
  if (wd.type === "cell") {
    const t0 = nodeGraphModuleFaceTravel(input);
    // Like every slider: up or right raises, down or left lowers.
    move = (ev) => {
      const { dx, dy } = travel(ev);
      const d = dx - dy;
      const t = Math.max(0, Math.min(1, t0 + d / NODE_GRAPH_FACE_CELL_DRAG_PX));
      return typeof nodeSliderValueFromTravel === "function" ? nodeSliderValueFromTravel(input, t) : t;
    };
  } else if (wd.type === "step") {
    const v0 = Math.round(nodeGraphModuleFaceValue(input));
    const px = NODE_GRAPH_FACE_STEP_DRAG_PX;
    move = (ev) => {
      const { dx, dy } = travel(ev);
      const v = v0 + Math.trunc((dx - dy) / px);
      return Math.max(Number(input.min), Math.min(Number(input.max), v));
    };
  } else if (wd.type === "filter") {
    const hpf = nodeGraphModuleFaceInput(article, wd.hpf);
    const lpf = nodeGraphModuleFaceInput(article, wd.lpf);
    const th = nodeGraphModuleFaceLogT(nodeGraphModuleFaceValue(hpf));
    const tl = nodeGraphModuleFaceLogT(nodeGraphModuleFaceValue(lpf));
    const u0 = p.x / Math.max(1, wd.w);
    const edge = NODE_GRAPH_FACE_FILTER_HANDLE_PX / Math.max(1, wd.w);
    const lo = Math.min(th, tl);
    const hi = Math.max(th, tl);
    const mode = u0 > lo + edge && u0 < hi - edge ? "span" : (Math.abs(u0 - th) <= Math.abs(u0 - tl) ? "hpf" : "lpf");
    // A single handle's up/down sets that side's poles (1-4), one dot stop per step.
    const polesKey = mode === "hpf" ? wd.row?.hpfPoles : (mode === "lpf" ? wd.row?.lpfPoles : "");
    const polesIn = polesKey ? nodeGraphModuleFaceInput(article, polesKey) : null;
    const n0 = polesIn ? Math.round(nodeGraphModuleFaceValue(polesIn)) : 0;
    const stopPx = Math.max(4, (wd.h - NODE_GRAPH_FACE_FILTER_LABEL_PX - NODE_GRAPH_FACE_FILTER_TICK_PX - 10) / 3);
    const onMove = (ev, drag) => {
      const { dx, dy } = travel(ev);
      const du = dx / Math.max(1, wd.w);
      if (mode !== "lpf") setNodeGraphModuleFaceValue(hpf, nodeGraphModuleFaceFromLogT(th + du), drag);
      if (mode !== "hpf") setNodeGraphModuleFaceValue(lpf, nodeGraphModuleFaceFromLogT(tl + du), drag);
      if (polesIn) setNodeGraphModuleFaceValue(polesIn, Math.max(1, Math.min(4, n0 + Math.round(-dy / stopPx))), drag);
    };
    nodeGraphModuleFaceCapture(face, event, onMove);
    return;
  }
  if (wd.type === "band") {
    // Two-ended range (soundemote-dev Condensed band): drag an end, or the span to move both.
    // Like every slider: right or up raises.
    const { lo, hi, tl, th } = nodeGraphModuleFaceBandEnds(article, wd);
    const mode = nodeGraphModuleFaceBandMode((p.x - wd.x) / Math.max(1, wd.w), tl, th, wd.w);
    const set = (input, t, drag) => setNodeGraphModuleFaceValue(input,
      typeof nodeSliderValueFromTravel === "function" ? nodeSliderValueFromTravel(input, t) : t, drag);
    nodeGraphModuleFaceCapture(face, event, (ev, drag) => {
      const { dx, dy } = travel(ev);
      let du = (dx - dy) / Math.max(1, wd.w);
      if (mode === "span") du = Math.max(-Math.min(tl, th), Math.min(1 - Math.max(tl, th), du));
      if (mode !== "hi") set(lo, Math.max(0, Math.min(1, tl + du)), drag);
      if (mode !== "lo") set(hi, Math.max(0, Math.min(1, th + du)), drag);
    });
    return;
  }
  if (!move || !input) return;
  nodeGraphModuleFaceCapture(face, event, (ev, drag) => setNodeGraphModuleFaceValue(input, move(ev), drag));
}

// B-105: a second press on the same widget within 400 ms / 6 px (or detail > 1)
// is a double-click, as beginNodeSliderDrag decides for the old sliders.
function nodeGraphModuleFaceDoubleClick(face, wd, event) {
  if (event.altKey || (typeof nodeGraphTouchGestureIsTouch === "function" && nodeGraphTouchGestureIsTouch(event))) return false;
  if (!nodeGraphModuleFaceTypesValue(wd)) return false;
  const now = performance.now();
  const last = face._faceLastDown;
  const id = `${wd.type}:${wd.x}:${wd.y}`;
  face._faceLastDown = { id, time: now, x: event.clientX, y: event.clientY };
  const hit = event.detail > 1 || Boolean(last && last.id === id && now - last.time < 400
    && Math.abs(event.clientX - last.x) < 6 && Math.abs(event.clientY - last.y) < 6);
  if (hit) face._faceLastDown = null;
  return hit;
}

/** Widgets with a typed value (choices, seeds and buttons have none). */
function nodeGraphModuleFaceTypesValue(wd) {
  return wd.type === "cell" || wd.type === "step" || wd.type === "band" || wd.type === "filter";
}

/** Inline type-in over the widget part under the pointer (the old slider face editor). */
function beginNodeGraphModuleFaceValueEdit(article, face, wd, p) {
  if (typeof beginNodeSliderFaceValueEdit !== "function") return false;
  const keys = nodeGraphModuleFaceWidgetKeys(wd).filter(Boolean);
  if (!keys.length) return false;
  const i = Math.max(0, Math.min(keys.length - 1, Math.floor(((p.x - wd.x) / Math.max(1, wd.w)) * keys.length)));
  const input = nodeGraphModuleFaceInput(article, keys[i]);
  if (!input?.id) return false;
  for (const old of face.querySelectorAll(":scope > .node-face-value-edit")) old.remove();
  const part = wd.w / keys.length;
  const host = document.createElement("div");
  host.className = "node-face-value-edit";
  host.dataset.sliderTarget = input.id;
  Object.assign(host.style, {
    position: "absolute", left: `${wd.x + part * i}px`, top: `${wd.y}px`,
    width: `${part}px`, height: `${wd.h}px`, pointerEvents: "auto",
  });
  if (getComputedStyle(face).position === "static") face.style.position = "relative";
  face.append(host);
  if (!beginNodeSliderFaceValueEdit(host)) {
    host.remove();
    return false;
  }
  // The host lives only while its input does.
  const observer = new MutationObserver(() => {
    if (!host.querySelector("input")) {
      observer.disconnect();
      host.remove();
    }
  });
  observer.observe(host, { childList: true });
  return true;
}

/** Right-click on a face widget opens that param's options, like a normal slider. */
function openNodeGraphModuleFaceParamOptions(article, face, event) {
  const spec = nodeGraphModuleFaceSpecForElement(article);
  const p = nodeGraphModuleFaceLocalPoint(face, event);
  const wd = spec ? nodeGraphModuleFaceWidgetAt(spec, face, p.x, p.y) : null;
  if (!wd) return;
  let key = wd.param;
  if (wd.type === "band") {
    const { tl, th } = nodeGraphModuleFaceBandEnds(article, wd);
    const u = (p.x - wd.x) / Math.max(1, wd.w);
    key = Math.abs(u - tl) <= Math.abs(u - th) ? wd.lo : wd.hi;
  }
  if (wd.type === "filter") {
    const u = p.x / Math.max(1, wd.w);
    const th = nodeGraphModuleFaceLogT(nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(article, wd.hpf)));
    const tl = nodeGraphModuleFaceLogT(nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(article, wd.lpf)));
    key = Math.abs(u - th) <= Math.abs(u - tl) ? wd.hpf : wd.lpf;
  }
  const readout = key && article.querySelector(`.node-parameter-row[data-param="${CSS.escape(key)}"] [data-slider-target]`);
  if (!readout || typeof openNodeMetadataPopover !== "function") return;
  openNodeMetadataPopover(event, readout);
}

function nodeGraphModuleFaceCapture(face, event, onMove) {
  face.setPointerCapture?.(event.pointerId);
  const mv = (ev) => onMove(ev, true);
  const up = (ev) => {
    onMove(ev, false);
    face.removeEventListener("pointermove", mv);
    face.removeEventListener("pointerup", up);
    face.removeEventListener("pointercancel", up);
  };
  face.addEventListener("pointermove", mv);
  face.addEventListener("pointerup", up);
  face.addEventListener("pointercancel", up);
}

// ----------------------------------------------------------------- GL -----

const nodeGraphModuleFaceRgbaCache = new Map();
function nodeGraphModuleFaceRgba(css) {
  let rgba = nodeGraphModuleFaceRgbaCache.get(css);
  if (!rgba) {
    rgba = typeof nodeGraphGlGraphParseCssColor === "function" ? nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]) : [1, 1, 1, 1];
    nodeGraphModuleFaceRgbaCache.set(css, rgba);
  }
  return rgba;
}

/** Draw every module face. World box comes from the module plate + the face's layout offset. */
function nodeGraphModuleFaceDrawAllGl(batch, plates, toX, toY, zoom, cssW, cssH) {
  for (let i = 0; i < plates.length; i += 1) {
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plates[i].id) : null;
    const face = el?.classList.contains("has-module-face") ? el.querySelector(":scope > .dsp-node-body > .node-face") : null;
    if (!face) continue;
    const laid = typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(face, el) : null;
    if (!laid || !(laid.w > 1)) continue;
    const ox = toX(plates[i].x + laid.x);
    const oy = toY(plates[i].y + laid.y);
    // Camera batches are in world px: the screen cull only applies without one.
    if (!batch.camera && (ox > cssW || oy > cssH || ox + laid.w * zoom < 0 || oy + laid.h * zoom < 0)) continue;
    // Over layer: above the plate fill and chrome, below text.
    batch._over = true;
    nodeGraphModuleFaceDrawGl(batch, el, laid.w, ox, oy, zoom);
    batch._over = false;
  }
}

function nodeGraphModuleFaceText(batch, text, x, y, px, css, opts = {}) {
  if (!text || typeof nodeGraphGlLinesText !== "function") return;
  const o = {
    px: Math.max(4, px), rgba: nodeGraphModuleFaceRgba(css), align: opts.align || "center",
    baseline: "middle", weight: opts.weight || 400, maxWidth: opts.maxWidth,
  };
  nodeGraphGlLinesText(batch, String(text), x, y, typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts(o) : o);
}

/** 135deg stripes (7 px band / 14 px period, as the CSS gradient) clipped to a screen-px box. */
function nodeGraphModuleFaceDrawOwnedStripes(batch, x, y, w, h, z) {
  const rgba = nodeGraphModuleFaceRgba("rgba(226, 168, 109, 0.16)");
  const period = 14 * Math.SQRT2 * z;
  const half = 3.5 * z;
  for (let s = -h; s < w; s += period) {
    const t0 = Math.max(0, -s);
    const t1 = Math.min(h, w - s);
    if (t1 <= t0) continue;
    nodeGraphGlLinesSegment(batch, x + s + t0, y + h - t0, x + s + t1, y + h - t1, half, 0.6, rgba, 0);
  }
}

function nodeGraphModuleFaceDrawGl(batch, el, w, ox, oy, z) {
  const spec = nodeGraphModuleFaceSpecForElement(el);
  if (!spec) return;
  const ink = NodeGraphFaceInk;
  const rect = (x, y, rw, rh, css) => nodeGraphGlLinesRect(batch, ox + x * z, oy + y * z, rw * z, rh * z, nodeGraphModuleFaceRgba(css));
  const line = (x, y, rw, rh, css) => nodeGraphGlLinesRect(batch, ox + x * z, oy + y * z, Math.max(1, rw * z), Math.max(1, rh * z), nodeGraphModuleFaceRgba(css));
  const fit = (text, bw, bh, hRatio, wRatio) => Math.min((bh - 2) * hRatio, (bw - 4) / (Math.max(1, String(text).length) * wRatio));
  const widgets = nodeGraphModuleFaceWidgets(spec, w, el);
  let rowY = -1;
  for (const wd of widgets) {
    if (wd.row && wd.y !== rowY && wd.type !== "subChoice") {
      rowY = wd.y;
      const fill = wd.row.kind === "lfoStyles" ? ink.lfoFill : (wd.row.kind === "filter" ? ink.curveBack : ink.rowFill);
      rect(0, wd.y, w, wd.h, wd.row.kind === "cells" ? ink.cellLine : fill);
      line(0, wd.y, w, 1, wd.row.kind === "cells" ? ink.cellLine : ink.rowLine);
    }
    const input = wd.param ? nodeGraphModuleFaceInput(el, wd.param) : null;
    const index = input ? Math.round(nodeGraphModuleFaceValue(input) - Number(input.min || 0)) : -1;
    const cx = wd.x + wd.w * 0.5;
    const cy = wd.y + wd.h * 0.5;
    if (wd.type === "choice") {
      const on = index === wd.index;
      if (on) rect(wd.x, wd.y + 1, wd.w, wd.h - 1, ink.choiceOn);
      if (wd.x > 0) line(wd.x, wd.y, 1, wd.h, ink.rowLine);
      nodeGraphModuleFaceText(batch, wd.label, ox + cx * z, oy + cy * z, 12.6 * z, on ? ink.choiceOnText : ink.offText);
    } else if (wd.type === "lfoStyle") {
      const on = index === wd.index;
      if (on) rect(wd.x, wd.y + 1, wd.w, wd.h - 1, ink.subOn);
      if (wd.x > 0) line(wd.x, wd.y, 1, wd.h, ink.rowLine);
      // Condensed 5 waveform snips, drawn only while the project plays.
      const live = typeof scopePaintIsDrawingLive === "function" && scopePaintIsDrawingLive();
      const seed = nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(el, wd.row.seedParam || "seed"));
      const n = 48;
      const shape = nodeGraphModuleFaceLfoShape(wd.index, seed, n);
      const px0 = wd.x + 5;
      const pw = wd.w - 10;
      const py = wd.y + 4;
      const ph = wd.h - 22;
      const pts = new Float32Array(n * 2);
      for (let i = 0; i < n; i += 1) {
        pts[i * 2] = ox + (px0 + (pw * i) / (n - 1)) * z;
        pts[i * 2 + 1] = oy + (py + ph * 0.5 - shape[i] * 0.92 * ph * 0.5) * z;
      }
      if (live) {
        // One thin stroke of constant width: round-capped pieces of an opaque
        // ink meet as round joins, so the sharp Walk / FBM turns do not bulge
        // the way mitered ribbon joins do.
        const rgba = nodeGraphModuleFaceRgba(on ? ink.lfoOn : ink.lfoOff);
        for (let i = 2; i < pts.length; i += 2) {
          nodeGraphGlLinesSegment(batch, pts[i - 2], pts[i - 1], pts[i], pts[i + 1], NODE_GRAPH_FACE_LFO_HALF_PX * z, 0.6, rgba, 0);
        }
      }
      nodeGraphModuleFaceText(batch, wd.label, ox + cx * z, oy + (wd.y + wd.h - 9) * z, Math.min(12.6, fit(wd.label, wd.w, 40, 1, 0.6)) * z, on ? ink.subOnText : ink.offText);
    } else if (wd.type === "step") {
      const text = String(Math.round(nodeGraphModuleFaceValue(input)));
      nodeGraphModuleFaceText(batch, text, ox + cx * z, oy + cy * z, fit(text, wd.w, wd.h, 0.72, 0.55) * z, ink.number, { weight: 700 });
    } else if (wd.type === "slash") {
      nodeGraphModuleFaceText(batch, "/", ox + cx * z, oy + cy * z, 22 * z, ink.slash);
    } else if (wd.type === "subChoice") {
      const on = index === wd.index;
      if (on) rect(wd.x, wd.y, wd.w, wd.h, ink.subOn);
      line(wd.x, wd.y, 1, wd.h, ink.rowLine);
      if (wd.index > 0) line(wd.x, wd.y, wd.w, 1, ink.rowLine);
      nodeGraphModuleFaceText(batch, wd.label, ox + cx * z, oy + cy * z, 11.5 * z, on ? ink.subOnText : ink.offText);
    } else if (wd.type === "cell") {
      const top = wd.row.kind === "cells" ? wd.y + 1 : wd.y + 1;
      const gap = wd.row.kind === "cells" && wd.x > 0 ? 1 : 0;
      const cw = wd.w - gap;
      const ch = wd.h - 1;
      rect(wd.x + gap, top, cw, ch, ink.cellFill);
      if (wd.bipolar) line(wd.x, wd.y, 1, wd.h, ink.cellLine);
      const t = nodeGraphModuleFaceTravel(input);
      // Jack-owned param (wired ƒ replaces it): the same 135deg stripes as the
      // .node-parameter-row.f-jack-owns-frequency row (styles.css).
      if (wd.param && el.querySelector(`.node-parameter-row.f-jack-owns-frequency[data-param="${CSS.escape(wd.param)}"]`)) {
        nodeGraphModuleFaceDrawOwnedStripes(batch, ox + (wd.x + gap) * z, oy + top * z, cw * z, ch * z, z);
      }
      if (wd.horizontal) {
        // Horizontal slider: fills left to right, label left, value right.
        rect(wd.x + gap, top, t * cw, ch, ink.cellValueFill);
        nodeGraphModuleFaceText(batch, wd.label, ox + (wd.x + gap + 6) * z, oy + cy * z, 12.6 * z, ink.label, { align: "left" });
        nodeGraphModuleFaceText(batch, nodeGraphModuleFaceValueText(input), ox + (wd.x + wd.w - 6) * z, oy + cy * z, 13.8 * z, ink.value, { align: "right" });
      } else {
        if (wd.bipolar) {
          const a = Math.min(0.5, 1 - t);
          rect(wd.x + gap, top + a * ch, cw, Math.abs(0.5 - t) * ch, ink.cellValueFill);
        } else {
          rect(wd.x + gap, top + (1 - t) * ch, cw, t * ch, ink.cellValueFill);
        }
        nodeGraphModuleFaceText(batch, wd.label, ox + cx * z, oy + (cy - 7) * z, 12.6 * z, ink.label, { maxWidth: (cw - 4) * z });
        nodeGraphModuleFaceText(batch, nodeGraphModuleFaceValueText(input), ox + cx * z, oy + (cy + 7) * z, 13.8 * z, ink.value, { maxWidth: (cw - 4) * z });
      }
    } else if (wd.type === "filter") {
      nodeGraphModuleFaceDrawFilterGl(batch, el, wd, ox, oy, z, rect, line);
    } else if (wd.type === "band") {
      // Condensed band: span fill between the two ends, a 3 px handle at each, label inside.
      const { lo, hi, tl, th } = nodeGraphModuleFaceBandEnds(el, wd);
      const a = Math.min(tl, th);
      const b = Math.max(tl, th);
      rect(wd.x + a * wd.w, wd.y + 1, (b - a) * wd.w, wd.h - 1, ink.bandSpan);
      const loText = nodeGraphModuleFaceValueText(lo);
      const hiText = nodeGraphModuleFaceValueText(hi);
      nodeGraphModuleFaceText(batch, loText, ox + (wd.x + 6) * z, oy + cy * z, 12 * z, ink.bandText, { align: "left" });
      nodeGraphModuleFaceText(batch, hiText, ox + (wd.x + wd.w - 6) * z, oy + cy * z, 12 * z, ink.bandText, { align: "right" });
      // Label shrinks to fit between the two values (one uniform px, no squeeze).
      const family = typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts({ px: 12 }).family : undefined;
      const measure = (text, px) => nodeGraphGlLinesMeasureText(text, px, family, 400);
      const room = wd.w - 12 - measure(loText, 12) - measure(hiText, 12) - 10;
      const labelPx = Math.min(12.6, 12.6 * Math.max(0, room) / Math.max(1, measure(wd.label, 12.6)));
      nodeGraphModuleFaceText(batch, wd.label, ox + cx * z, oy + cy * z, labelPx * z, ink.label);
      // Handles break around the label so it never draws through one.
      const labelHalfW = measure(wd.label, labelPx) * 0.5 + 3;
      const gapHalf = labelPx * 0.6;
      for (const t of [tl, th]) {
        const hx = wd.x + t * wd.w - 1;
        const top = wd.y + 4;
        const bottom = wd.y + wd.h - 4;
        if (hx + 3 > cx - labelHalfW && hx < cx + labelHalfW) {
          rect(hx, top, 3, Math.max(0, cy - gapHalf - top), ink.bandHandle);
          rect(hx, cy + gapHalf, 3, Math.max(0, bottom - cy - gapHalf), ink.bandHandle);
        } else {
          rect(hx, top, 3, bottom - top, ink.bandHandle);
        }
      }
    } else if (wd.type === "seedNumber" && typeof nodeGraphGlGraphDrawSeedWidget === "function") {
      // The app-wide seed widget ([code][die][+][-]); its buttons are this row's seedButton cells.
      const bw = (w - wd.w) / 3;
      const cell = (x, cw) => ({ x: ox + x * z, y: oy + wd.y * z, w: cw * z, h: wd.h * z });
      const text = typeof formatNodeGraphSeedCode === "function" ? formatNodeGraphSeedCode(nodeGraphModuleFaceValue(input)) : "";
      nodeGraphGlGraphDrawSeedWidget(batch, {
        host: cell(0, w), value: cell(0, wd.w), dice: cell(wd.w, bw), plus: cell(wd.w + bw, bw), minus: cell(wd.w + bw * 2, bw),
      }, text, z);
    }
  }
}

function nodeGraphModuleFaceDrawFilterGl(batch, el, wd, ox, oy, z, rect, line) {
  const ink = NodeGraphFaceInk;
  const hpfInput = nodeGraphModuleFaceInput(el, wd.hpf);
  const lpfInput = nodeGraphModuleFaceInput(el, wd.lpf);
  const fcH = Math.max(1, nodeGraphModuleFaceValue(hpfInput));
  const fcL = Math.max(1, nodeGraphModuleFaceValue(lpfInput));
  const labH = NODE_GRAPH_FACE_FILTER_LABEL_PX;
  const tickH = NODE_GRAPH_FACE_FILTER_TICK_PX;
  const top = wd.y + labH;
  const ch = wd.h - labH - tickH;
  const w = wd.w;
  line(0, top, w, 1, ink.rowLine);
  line(0, top + ch, w, 1, ink.tickLine);
  // Pole params per side (wd.row.hpfPoles / lpfPoles, 1-4); none = 2 poles.
  const stops = 4;
  const poles = (key) => {
    const input = key ? nodeGraphModuleFaceInput(el, key) : null;
    const n = input ? Math.round(nodeGraphModuleFaceValue(input)) : 2;
    return Math.max(1, Math.min(stops, n));
  };
  const nH = poles(wd.row?.hpfPoles);
  const nL = poles(wd.row?.lpfPoles);
  const hpText = `${nodeGraphModuleFaceHzText(fcH)} ${nH * 6} dB`;
  const lpText = `${nodeGraphModuleFaceHzText(fcL)} ${nL * 6} dB`;
  const labPx = Math.min(12.6, ((w - 14) / 2 - 4) / (Math.max(hpText.length, lpText.length) * 0.6));
  nodeGraphModuleFaceText(batch, hpText, ox + 7 * z, oy + (wd.y + labH / 2) * z, labPx * z, ink.hpf, { align: "left" });
  nodeGraphModuleFaceText(batch, lpText, ox + (w - 7) * z, oy + (wd.y + labH / 2) * z, labPx * z, ink.lpf, { align: "right" });
  // One sample per screen pixel: smooth at any zoom.
  const steps = Math.max(32, Math.round(w * z));
  const yOf = (m) => {
    const db = 20 * Math.log10(Math.max(1e-12, m));
    return top + 2 + Math.min(1, -db / -NODE_GRAPH_FACE_FILTER_DB_MIN) * (ch - 2);
  };
  const hp = [];
  const lp = [];
  const pass = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const f = nodeGraphModuleFaceFromLogT(t);
    const h = nodeGraphModuleFaceRolloff(f, fcH, true, nH);
    const l = nodeGraphModuleFaceRolloff(f, fcL, false, nL);
    const x = t * w;
    const y = yOf(h * l);
    if (i < steps) nodeGraphGlLinesRect(batch, ox + x * z, oy + y * z, (w / steps) * z + 0.5, (top + ch - y) * z, nodeGraphModuleFaceRgba(ink.curveFill));
    const sx = ox + x * z;
    // Skirts stop at the floor (no flat line along the bottom).
    const floor = 10 ** (NODE_GRAPH_FACE_FILTER_DB_MIN / 20);
    if (h < 0.97 && h > floor) hp.push(sx, oy + yOf(h) * z);
    if (l < 0.97 && l > floor) lp.push(sx, oy + yOf(l) * z);
    if (h > 0.92 && l > 0.92) pass.push(sx, oy + y * z);
  }
  if (typeof nodeGraphGlLinesPolyline === "function") {
    const stroke = (pts, width, css) => {
      if (pts.length >= 4) nodeGraphGlLinesPolyline(batch, new Float32Array(pts), width * z, Math.max(1, z), nodeGraphModuleFaceRgba(css), "round");
    };
    // Antialiased edge over the pixel-column fill across the whole width.
    const edge = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const f = nodeGraphModuleFaceFromLogT(t);
      edge.push(ox + t * w * z, oy + yOf(nodeGraphModuleFaceRolloff(f, fcH, true, nH) * nodeGraphModuleFaceRolloff(f, fcL, false, nL)) * z);
    }
    stroke(edge, 1, ink.curveFill);
    stroke(pass, 1.2, ink.passCurve);
    stroke(hp, 1.6, ink.hpfCurve);
    stroke(lp, 1.6, ink.lpfCurve);
  }
  // Vertical handles (soundemote-dev Condensed 5 drawFilterCurve): a faint
  // full-height bar at each cutoff and the 4 pole stops (1-4 poles = 6/12/18/24
  // dB, bottom to top) as dots, the current one bigger and brighter.
  for (const [fc, css, n] of [[fcH, ink.hpfCurve, nH], [fcL, ink.lpfCurve, nL]]) {
    const on = n - 1;
    const hx = ox + nodeGraphModuleFaceLogT(fc) * w * z;
    const c = nodeGraphModuleFaceRgba(css);
    const tint = (a) => [c[0], c[1], c[2], c[3] * a];
    nodeGraphGlLinesRect(batch, hx - z, oy + top * z, 2 * z, ch * z, tint(0.14));
    if (typeof nodeGraphGlLinesDot !== "function") continue;
    const pad = 5;
    for (let k = 0; k < stops; k += 1) {
      const py = top + pad + ((stops - 1 - k) / (stops - 1)) * (ch - pad * 2);
      nodeGraphGlLinesDot(batch, hx, oy + py * z, (k === on ? 3.4 : 2.2) * z, Math.max(0.8, z), tint(k === on ? 0.75 : 0.18));
    }
  }
  // Tick strip spaced evenly (soundemote-dev look), labels at the 4 decades.
  const ticks = ["20 Hz", "200", "2 kHz", "20 kHz"];
  // Room between neighbours: half a centred label plus a whole edge label.
  const tickPx = Math.min(9.9, (w - 8) / 3 / (8.5 * 0.6 + 1));
  ticks.forEach((label, i) => {
    const t = ticks.length > 1 ? i / (ticks.length - 1) : 0;
    const align = i === 0 ? "left" : (i === ticks.length - 1 ? "right" : "center");
    const x = 4 + t * (w - 8);
    nodeGraphModuleFaceText(batch, label, ox + x * z, oy + (top + ch + tickH / 2) * z, tickPx * z, ink.tick, { align });
  });
}
