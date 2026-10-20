// Hand-written module faces (rails plan PP-5). A definition's `face` is a list
// of rows; each row is one widget group drawn in WebGL by
// nodeGraphModuleFaceDrawGl and driven by one pointer handler on .node-face.
// The hidden range inputs in the param rows stay the source of truth, and the
// param rows keep their rail jacks, which are stacked into each face row.
// Look: soundemote-dev experiments/condensed-widgets "Condensed 5".

const NODE_GRAPH_FACE_JACK_SLOT_PX = 17;
const NODE_GRAPH_FACE_CELL_DRAG_PX = 220;
const NODE_GRAPH_FACE_STEP_DRAG_PX = 6;
const NODE_GRAPH_FACE_SEED_DRAG_PX = 4;
const NODE_GRAPH_FACE_FILTER_HZ = Object.freeze({ min: 20, max: 20000 });
const NODE_GRAPH_FACE_FILTER_SLOPE_DB = 12;
const NODE_GRAPH_FACE_FILTER_DB_MIN = -18;
const NODE_GRAPH_FACE_FILTER_HANDLE_PX = 10;

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
  lfoOn: "#c8e4ff",
  lfoOff: "#6a7a90",
  seedText: "#e8eaef",
  seedButton: "#c5ccd8",
});

function nodeGraphModuleFaceSpec(type) {
  const face = nodeGraphModuleDefinitions?.[type]?.face;
  return Array.isArray(face) && face.length ? face : null;
}

/** Params a face row owns, in rail order (top to bottom). */
function nodeGraphModuleFaceRowParams(row) {
  switch (row.kind) {
    case "fraction": return [row.num, row.den, row.mode, row.cell?.[0]].filter(Boolean);
    case "cells": return row.params.map((cell) => cell[0]);
    case "filter": return [row.hpf, row.lpf];
    default: return [row.param];
  }
}

/** Row height: the drawn height, grown so stacked 16 px rail tags never overlap. */
function nodeGraphModuleFaceRowHeight(row) {
  return Math.max(row.h, nodeGraphModuleFaceRowParams(row).length * NODE_GRAPH_FACE_JACK_SLOT_PX);
}

function nodeGraphModuleFaceHeightPx(type) {
  const spec = nodeGraphModuleFaceSpec(type);
  return spec ? spec.reduce((sum, row) => sum + nodeGraphModuleFaceRowHeight(row), 0) : 0;
}

/** Face-local widget boxes for width w (layout px, zoom 1). */
function nodeGraphModuleFaceWidgets(spec, w) {
  const out = [];
  let y = 0;
  const split = (x0, width, n) => Array.from({ length: n }, (_, i) => {
    const a = Math.round(x0 + (width * i) / n);
    const b = Math.round(x0 + (width * (i + 1)) / n);
    return [a, b - a];
  });
  for (const row of spec) {
    const h = nodeGraphModuleFaceRowHeight(row);
    const base = { row, y, h };
    if (row.kind === "choices" || row.kind === "lfoStyles") {
      split(0, w, row.labels.length).forEach(([x, cw], i) => out.push({
        ...base, type: row.kind === "choices" ? "choice" : "lfoStyle", param: row.param, index: i, label: row.labels[i], x, w: cw,
      }));
    } else if (row.kind === "fraction") {
      const side = 46;
      const cellW = 50;
      const numW = Math.max(10, (w - side - cellW - 10) / 2);
      out.push({ ...base, type: "step", param: row.num, x: 0, w: numW });
      out.push({ ...base, type: "slash", x: numW, w: 10 });
      out.push({ ...base, type: "step", param: row.den, x: numW + 10, w: numW });
      split(y, h, row.modeLabels.length).forEach(([sy, sh], i) => out.push({
        row, type: "subChoice", param: row.mode, index: i, label: row.modeLabels[i],
        x: numW * 2 + 10, w: side, y: sy, h: sh,
      }));
      out.push({ ...base, type: "cell", param: row.cell[0], label: row.cell[1], bipolar: true, x: w - cellW, w: cellW });
    } else if (row.kind === "cells") {
      split(0, w, row.params.length).forEach(([x, cw], i) => out.push({
        ...base, type: "cell", param: row.params[i][0], label: row.params[i][1], x, w: cw,
      }));
    } else if (row.kind === "filter") {
      out.push({ ...base, type: "filter", hpf: row.hpf, lpf: row.lpf, x: 0, w, param: "" });
    } else if (row.kind === "seed") {
      const bw = 28;
      out.push({ ...base, type: "seedNumber", param: row.param, x: 0, w: w - bw * 3 });
      ["dice", "plus", "minus"].forEach((action, i) => out.push({
        ...base, type: "seedButton", action, param: row.param, x: w - bw * (3 - i), w: bw,
      }));
    }
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

/** Compact shown value (modulated when sent) + unit, as the Condensed 5 cells read. */
function nodeGraphModuleFaceValueText(input) {
  if (!input) return "";
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

function nodeGraphModuleFaceButterworth(f, fc, highPass) {
  const order = NODE_GRAPH_FACE_FILTER_SLOPE_DB / 6;
  const r = highPass ? fc / Math.max(f, 1e-3) : f / Math.max(fc, 1e-3);
  return 1 / Math.sqrt(1 + r ** (2 * order));
}

// ---------------------------------------------------------------- DOM -----

/** Mount .node-face over the param body and stack each row's rail jacks. */
function mountNodeGraphModuleFace(article, type) {
  const spec = nodeGraphModuleFaceSpec(type);
  const body = article?.querySelector(":scope > .dsp-node-body");
  if (!spec || !body) return;
  article.classList.add("has-module-face");
  const total = nodeGraphModuleFaceHeightPx(type);
  body.style.height = `${total}px`;
  const face = document.createElement("div");
  face.className = "node-face";
  face.style.height = `${total}px`;
  body.append(face);
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
    if (!placed.has(row.dataset.param)) row.classList.add("node-face-unplaced");
  }
  face.addEventListener("pointerdown", (event) => beginNodeGraphModuleFaceGesture(article, face, spec, event));
}

function nodeGraphModuleFaceLocalPoint(face, event) {
  const rect = face.getBoundingClientRect();
  const sx = face.offsetWidth / Math.max(1e-6, rect.width);
  const sy = face.offsetHeight / Math.max(1e-6, rect.height);
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy, sx, sy };
}

function nodeGraphModuleFaceWidgetAt(spec, face, x, y) {
  return nodeGraphModuleFaceWidgets(spec, face.offsetWidth)
    .find((wd) => wd.type !== "slash" && x >= wd.x && x < wd.x + wd.w && y >= wd.y && y < wd.y + wd.h) || null;
}

/** Wire-drop hit boxes (client px) so a cable dropped on a widget finds its param row. */
function nodeGraphModuleFaceHitBoxes(moduleEl) {
  const face = moduleEl?.querySelector(":scope > .dsp-node-body > .node-face");
  const spec = face ? nodeGraphModuleFaceSpec(moduleEl.dataset.nodeType) : null;
  if (!spec) return [];
  const rect = face.getBoundingClientRect();
  const kx = rect.width / Math.max(1, face.offsetWidth);
  const ky = rect.height / Math.max(1, face.offsetHeight);
  const boxes = [];
  for (const wd of nodeGraphModuleFaceWidgets(spec, face.offsetWidth)) {
    const keys = wd.type === "filter" ? [wd.hpf, wd.lpf] : [wd.param];
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
  const input = wd.param ? nodeGraphModuleFaceInput(article, wd.param) : null;
  if (wd.type === "choice" || wd.type === "lfoStyle" || wd.type === "subChoice") {
    setNodeGraphModuleFaceValue(input, Number(input?.min || 0) + wd.index, false);
    return;
  }
  if (wd.type === "seedButton") {
    const max = Number(input?.max) || 16777215;
    const now = Math.round(nodeGraphModuleFaceValue(input));
    const step = event.ctrlKey && event.shiftKey ? 100 : event.ctrlKey ? 10 : 1;
    const next = wd.action === "dice"
      ? Math.floor(Math.random() * (max + 1))
      : (((now + (wd.action === "plus" ? step : -step)) % (max + 1)) + max + 1) % (max + 1);
    setNodeGraphModuleFaceValue(input, next, false);
    return;
  }
  let move = null;
  if (wd.type === "cell") {
    const t0 = nodeGraphModuleFaceTravel(input);
    const y0 = event.clientY;
    move = (ev) => {
      const t = Math.max(0, Math.min(1, t0 + ((y0 - ev.clientY) * p.sy) / NODE_GRAPH_FACE_CELL_DRAG_PX));
      return typeof nodeSliderValueFromTravel === "function" ? nodeSliderValueFromTravel(input, t) : t;
    };
  } else if (wd.type === "step" || wd.type === "seedNumber") {
    const v0 = Math.round(nodeGraphModuleFaceValue(input));
    const y0 = event.clientY;
    const px = wd.type === "seedNumber" ? NODE_GRAPH_FACE_SEED_DRAG_PX : NODE_GRAPH_FACE_STEP_DRAG_PX;
    move = (ev) => {
      const digits = String(Math.abs(v0)).length;
      const step = wd.type === "seedNumber" ? Math.max(1, 10 ** Math.max(0, digits - 2)) : (ev.ctrlKey ? 10 : 1);
      const v = v0 + Math.trunc(((y0 - ev.clientY) * p.sy) / px) * step;
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
    const x0 = event.clientX;
    const onMove = (ev, drag) => {
      const du = ((ev.clientX - x0) * p.sx) / Math.max(1, wd.w);
      if (mode !== "lpf") setNodeGraphModuleFaceValue(hpf, nodeGraphModuleFaceFromLogT(th + du), drag);
      if (mode !== "hpf") setNodeGraphModuleFaceValue(lpf, nodeGraphModuleFaceFromLogT(tl + du), drag);
    };
    nodeGraphModuleFaceCapture(face, event, onMove);
    return;
  }
  if (!move || !input) return;
  nodeGraphModuleFaceCapture(face, event, (ev, drag) => setNodeGraphModuleFaceValue(input, move(ev), drag));
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

function nodeGraphModuleFaceDrawGl(batch, el, w, ox, oy, z) {
  const spec = nodeGraphModuleFaceSpec(el.dataset.nodeType);
  if (!spec) return;
  const ink = NodeGraphFaceInk;
  const rect = (x, y, rw, rh, css) => nodeGraphGlLinesRect(batch, ox + x * z, oy + y * z, rw * z, rh * z, nodeGraphModuleFaceRgba(css));
  const line = (x, y, rw, rh, css) => nodeGraphGlLinesRect(batch, ox + x * z, oy + y * z, Math.max(1, rw * z), Math.max(1, rh * z), nodeGraphModuleFaceRgba(css));
  const fit = (text, bw, bh, hRatio, wRatio) => Math.min((bh - 2) * hRatio, (bw - 4) / (Math.max(1, String(text).length) * wRatio));
  const widgets = nodeGraphModuleFaceWidgets(spec, w);
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
      if (typeof nodeGraphGlLinesPolyline === "function") {
        nodeGraphGlLinesPolyline(batch, pts, Math.max(1, z), 0.8, nodeGraphModuleFaceRgba(on ? ink.lfoOn : ink.lfoOff), "round");
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
      if (wd.bipolar) {
        const a = Math.min(0.5, 1 - t);
        rect(wd.x + gap, top + a * ch, cw, Math.abs(0.5 - t) * ch, ink.cellValueFill);
      } else {
        rect(wd.x + gap, top + (1 - t) * ch, cw, t * ch, ink.cellValueFill);
      }
      nodeGraphModuleFaceText(batch, wd.label, ox + cx * z, oy + (cy - 7) * z, 12.6 * z, ink.label, { maxWidth: (cw - 4) * z });
      nodeGraphModuleFaceText(batch, nodeGraphModuleFaceValueText(input), ox + cx * z, oy + (cy + 7) * z, 13.8 * z, ink.value, { maxWidth: (cw - 4) * z });
    } else if (wd.type === "filter") {
      nodeGraphModuleFaceDrawFilterGl(batch, el, wd, ox, oy, z, rect, line);
    } else if (wd.type === "seedNumber") {
      const text = String(Math.round(nodeGraphModuleFaceValue(input)));
      nodeGraphModuleFaceText(batch, text, ox + cx * z, oy + cy * z, fit(text, wd.w, wd.h, 0.62, 0.52) * z, ink.seedText);
    } else if (wd.type === "seedButton") {
      line(wd.x, wd.y, 1, wd.h, ink.rowLine);
      const c = nodeGraphModuleFaceRgba(ink.seedButton);
      const bx = ox + wd.x * z;
      const by = oy + wd.y * z;
      const bw = wd.w * z;
      const bh = wd.h * z;
      if (wd.action === "dice" && typeof nodeGraphGlGraphDrawSeedDie === "function") {
        nodeGraphGlGraphDrawSeedDie(batch, { x: bx, y: by, w: bw, h: bh }, c);
      } else {
        const s = Math.min(bw, bh) * 0.4;
        const k = Math.max(1, Math.min(bw, bh) * 0.08);
        nodeGraphGlLinesRect(batch, bx + (bw - s) / 2, by + (bh - k) / 2, s, k, c);
        if (wd.action === "plus") nodeGraphGlLinesRect(batch, bx + (bw - k) / 2, by + (bh - s) / 2, k, s, c);
      }
    }
  }
}

function nodeGraphModuleFaceDrawFilterGl(batch, el, wd, ox, oy, z, rect, line) {
  const ink = NodeGraphFaceInk;
  const hpfInput = nodeGraphModuleFaceInput(el, wd.hpf);
  const lpfInput = nodeGraphModuleFaceInput(el, wd.lpf);
  const fcH = Math.max(1, nodeGraphModuleFaceValue(hpfInput));
  const fcL = Math.max(1, nodeGraphModuleFaceValue(lpfInput));
  const labH = 20;
  const tickH = 16;
  const top = wd.y + labH;
  const ch = wd.h - labH - tickH;
  const w = wd.w;
  line(0, top, w, 1, ink.rowLine);
  line(0, top + ch, w, 1, ink.tickLine);
  const slope = `${NODE_GRAPH_FACE_FILTER_SLOPE_DB} dB`;
  const hpText = `${nodeGraphModuleFaceHzText(fcH)} ${slope}`;
  const lpText = `${nodeGraphModuleFaceHzText(fcL)} ${slope}`;
  const labPx = Math.min(12.6, ((w - 14) / 2 - 4) / (Math.max(hpText.length, lpText.length) * 0.6));
  nodeGraphModuleFaceText(batch, hpText, ox + 7 * z, oy + (wd.y + labH / 2) * z, labPx * z, ink.hpf, { align: "left" });
  nodeGraphModuleFaceText(batch, lpText, ox + (w - 7) * z, oy + (wd.y + labH / 2) * z, labPx * z, ink.lpf, { align: "right" });
  const steps = Math.max(16, Math.round(w / 2));
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
    const h = nodeGraphModuleFaceButterworth(f, fcH, true);
    const l = nodeGraphModuleFaceButterworth(f, fcL, false);
    const x = t * w;
    const y = yOf(h * l);
    if (i < steps) rect(x, y, w / steps + 0.5, top + ch - y, ink.curveFill);
    const sx = ox + x * z;
    // Skirts stop at the floor (no flat line along the bottom).
    const floor = 10 ** (NODE_GRAPH_FACE_FILTER_DB_MIN / 20);
    if (h < 0.97 && h > floor) hp.push(sx, oy + yOf(h) * z);
    if (l < 0.97 && l > floor) lp.push(sx, oy + yOf(l) * z);
    if (h > 0.92 && l > 0.92) pass.push(sx, oy + y * z);
  }
  if (typeof nodeGraphGlLinesPolyline === "function") {
    const stroke = (pts, width, css) => {
      if (pts.length >= 4) nodeGraphGlLinesPolyline(batch, new Float32Array(pts), width * z, 0.8, nodeGraphModuleFaceRgba(css), "round");
    };
    stroke(pass, 1.5, ink.passCurve);
    stroke(hp, 2.5, ink.hpfCurve);
    stroke(lp, 2.5, ink.lpfCurve);
  }
  for (const [fc, css] of [[fcH, ink.hpfCurve], [fcL, ink.lpfCurve]]) {
    const t = nodeGraphModuleFaceLogT(fc);
    const m = nodeGraphModuleFaceButterworth(fc, fcH, true) * nodeGraphModuleFaceButterworth(fc, fcL, false);
    if (typeof nodeGraphGlLinesDot === "function") {
      nodeGraphGlLinesDot(batch, ox + t * w * z, oy + yOf(m) * z, 3 * z, 0.8, nodeGraphModuleFaceRgba(css));
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
