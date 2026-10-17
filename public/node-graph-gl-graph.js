// GB-1: cables and grid in one screen-space GL batch.
// Camera changes only reproject a cached polyline list. Look is approximate on purpose.

const nodeGraphGlGraphState = {
  canvas: null,
  dotsCanvas: null,
  // { rgba: number[4], xy: Float32Array, dots: {x,y,rgba,square}[] } world pixels
  wires: [],
  plates: [],
  displays: [],
  chrome: { titles: [], labels: [], jacks: [], sliders: [], keys: [], graphs: [] },
  screen: new Float32Array(0),
};

function nodeGraphGlGraphEnsureCanvas(host, key, id, className, beforeSelector) {
  let canvas = nodeGraphGlGraphState[key];
  if (!canvas || !canvas.isConnected) {
    canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.className = className;
    canvas.setAttribute("aria-hidden", "true");
    const before = beforeSelector ? host.querySelector(beforeSelector) : null;
    if (before) host.insertBefore(canvas, before);
    else host.append(canvas);
    nodeGraphGlGraphState[key] = canvas;
  }
  return canvas;
}

function nodeGraphGlGraphCssColor(color) {
  const hex = String(color || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  return [0.75, 0.82, 0.9, 1];
}

function nodeGraphGlGraphParseCssColor(color, fallback) {
  const text = String(color || "").trim();
  const hex = nodeGraphGlGraphCssColor(text);
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return hex;
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, 1];
  }
  return fallback;
}

function nodeGraphGlGraphEdgeNotches(box, points, reach) {
  const left = [];
  const right = [];
  const top = [];
  const bottom = [];
  const x1 = box.x + box.w;
  const y1 = box.y + box.h;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p || p.visible === false) continue;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dl = Math.abs(x - box.x);
    const dr = Math.abs(x - x1);
    const dt = Math.abs(y - box.y);
    const db = Math.abs(y - y1);
    const nearest = Math.min(dl, dr, dt, db);
    if (nearest > reach) continue;
    if (dl <= dr && dl <= dt && dl <= db) left.push(y);
    else if (dr <= dt && dr <= db) right.push(y);
    else if (dt <= db) top.push(x);
    else bottom.push(x);
  }
  return { left, right, top, bottom };
}

function nodeGraphGlGraphStrokeRuns(start, end, centers, gap) {
  const half = gap * 0.5;
  const cuts = (centers || []).slice().sort((a, b) => a - b);
  const runs = [];
  let cursor = start;
  for (let i = 0; i < cuts.length; i += 1) {
    const lo = cuts[i] - half;
    const hi = cuts[i] + half;
    if (hi <= start || lo >= end) continue;
    const cutLo = Math.max(start, lo);
    if (cutLo - cursor > 0.4) runs.push([cursor, cutLo]);
    cursor = Math.max(cursor, Math.min(end, hi));
  }
  if (end - cursor > 0.4) runs.push([cursor, end]);
  return runs;
}

function nodeGraphGlGraphRebuildPlates() {
  const plates = [];
  const displays = [];
  const workspace = document.getElementById("nodeGraphWorkspace");
  const diameter = Number.parseFloat(
    workspace ? getComputedStyle(workspace).getPropertyValue("--node-port-diameter") : "",
  ) || 14;
  const gap = diameter * 1.55;
  const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "");
    if (!id) continue;
    const geo = typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(id) : null;
    const box = geo?.box;
    if (!box || !(box.w > 1) || !(box.h > 1)) continue;
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
    if (!el || !el.isConnected || el.hidden || el.classList.contains("removed")) continue;
    if (el.getAttribute("data-hide-module-frame") === "1") continue;
    if (el.querySelector(":scope > .node-text-box-body")) continue;
    const fill = nodeGraphGlGraphParseCssColor(
      getComputedStyle(el).getPropertyValue("--node-module-fill"),
      [0.09, 0.1, 0.12, 1],
    );
    const pins = [].concat(geo?.ports || [], geo?.paramJacks || []);
    plates.push({
      id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill,
      selected: el.classList.contains("selected"),
      gap,
      notches: nodeGraphGlGraphEdgeNotches(box, pins, diameter),
    });
    const canvases = el.querySelectorAll(".node-display-canvas");
    for (let c = 0; c < canvases.length; c += 1) {
      const face = canvases[c];
      if (!(face.width > 1) || !(face.height > 1)) continue;
      const rect = face.getBoundingClientRect();
      if (!(rect.width > 1) || !(rect.height > 1)) continue;
      const tl = typeof nodeGraphClientToZoomSurfacePoint === "function"
        ? nodeGraphClientToZoomSurfacePoint(rect.left, rect.top)
        : { x: box.x, y: box.y };
      const br = typeof nodeGraphClientToZoomSurfacePoint === "function"
        ? nodeGraphClientToZoomSurfacePoint(rect.right, rect.bottom)
        : { x: box.x + box.w, y: box.y + box.h };
      displays.push({
        canvas: face,
        x: tl.x,
        y: tl.y,
        w: Math.max(0, br.x - tl.x),
        h: Math.max(0, br.y - tl.y),
        output: String(nodes[i]?.type || "") === "output",
      });
    }
  }
  nodeGraphGlGraphState.plates = plates;
  nodeGraphGlGraphState.displays = displays;
  nodeGraphGlGraphRebuildChrome();
}

function nodeGraphGlGraphCssPx(el, name) {
  const raw = el?.style?.getPropertyValue?.(name) || "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function nodeGraphGlGraphWorldBox(el) {
  if (!el || typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 1) || !(rect.height > 1)) return null;
  const tl = nodeGraphClientToZoomSurfacePoint(rect.left, rect.top);
  const br = nodeGraphClientToZoomSurfacePoint(rect.right, rect.bottom);
  const w = br.x - tl.x;
  const h = br.y - tl.y;
  if (!(w > 0.5) || !(h > 0.5)) return null;
  return { x: tl.x, y: tl.y, w, h };
}

function nodeGraphGlGraphTextAnchor(el, box) {
  const align = String(getComputedStyle(el).textAlign || "left");
  if (align === "right" || align === "end") {
    return { align: "right", x: box.x + box.w };
  }
  if (align === "center") {
    return { align: "center", x: box.x + box.w * 0.5 };
  }
  return { align: "left", x: box.x };
}

function nodeGraphGlGraphRebuildChrome() {
  const titles = [];
  const labels = [];
  const jacks = [];
  const sliders = [];
  const keys = [];
  const graphs = [];
  const host = document.getElementById("nodeGraphWorkspace");
  const diameter = Number.parseFloat(
    host ? getComputedStyle(host).getPropertyValue("--node-port-diameter") : "",
  ) || 14;
  const radius = diameter * 0.5;
  const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "");
    const el = id && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
    if (!el || !el.isConnected || el.hidden) continue;
    if (el.querySelector(":scope > .node-text-box-body")) continue;
    const title = el.querySelector(".node-header-title");
    const titleBox = nodeGraphGlGraphWorldBox(title);
    if (title && titleBox) {
      titles.push({
        el: title,
        box: titleBox,
        x: titleBox.x + titleBox.w * 0.5,
        y: titleBox.y + titleBox.h * 0.5,
        h: titleBox.h,
      });
    }
    const ioLabels = el.querySelectorAll(".node-io-label");
    for (let n = 0; n < ioLabels.length; n += 1) {
      const box = nodeGraphGlGraphWorldBox(ioLabels[n]);
      if (!box) continue;
      const output = Boolean(ioLabels[n].closest(".node-io-row.output, .node-io-column.output"));
      const align = output ? "right" : "left";
      const fontPx = Number.parseFloat(getComputedStyle(ioLabels[n]).fontSize) || 13;
      labels.push({
        el: ioLabels[n],
        x: align === "right" ? box.x + box.w : box.x,
        y: box.y + box.h * 0.5,
        fontPx,
        align,
      });
    }
    const geo = typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(id) : null;
    const pins = []
      .concat(geo?.ports || [])
      .concat(geo?.paramJacks || []);
    for (let p = 0; p < pins.length; p += 1) {
      const pin = pins[p];
      if (!pin || pin.visible === false) continue;
      const px = Number(pin.x);
      const py = Number(pin.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const io = pin.io || (pin.kind === "output" ? "output" : pin.kind || "input");
      const port = pin.port || pin.key || "";
      const color = typeof nodeGraphPortWireColor === "function"
        ? nodeGraphPortWireColor(id, port, io)
        : "";
      const key = `${Math.round(px)}:${Math.round(py)}`;
      if (jacks.some((jack) => jack.key === key)) continue;
      jacks.push({
        key,
        x: px,
        y: py,
        r: radius,
        inwardRight: io !== "output",
        rgba: nodeGraphGlGraphCssColor(color),
      });
    }
    const readouts = el.querySelectorAll(".node-slider-readout");
    for (let s = 0; s < readouts.length; s += 1) {
      const readout = readouts[s];
      const box = nodeGraphGlGraphWorldBox(readout);
      if (!box) continue;
      const input = readout.closest("label")?.querySelector("input[type='range']") || null;
      const valueEl = readout.querySelector(".node-slider-readout-value");
      const labelEl = readout.querySelector(".node-slider-readout-label");
      const valueBox = nodeGraphGlGraphWorldBox(valueEl);
      const labelBox = nodeGraphGlGraphWorldBox(labelEl);
      sliders.push({
        readout,
        input,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        valueEl,
        valueBox,
        valueAnchor: valueEl && valueBox ? nodeGraphGlGraphTextAnchor(valueEl, valueBox) : null,
        labelEl,
        labelBox,
        labelAnchor: labelEl && labelBox ? nodeGraphGlGraphTextAnchor(labelEl, labelBox) : null,
      });
    }
    const keypadKeys = el.querySelectorAll(".node-keypad-key");
    for (let k = 0; k < keypadKeys.length; k += 1) {
      const key = keypadKeys[k];
      const keyBox = nodeGraphGlGraphWorldBox(key);
      if (!keyBox) continue;
      keys.push({
        el: key,
        x: keyBox.x,
        y: keyBox.y,
        w: keyBox.w,
        h: keyBox.h,
        label: String(key.querySelector(".node-keypad-key-label")?.textContent || "").trim(),
      });
    }
    const graphFace = el.querySelector(".node-module-graph-display");
    const graphBox = nodeGraphGlGraphWorldBox(graphFace);
    if (graphBox) {
      graphs.push({ id, x: graphBox.x, y: graphBox.y, w: graphBox.w, h: graphBox.h });
    }
  }
  nodeGraphGlGraphState.chrome = { titles, labels, jacks, sliders, keys, graphs };
}

function nodeGraphGlGraphTextOpts(opts) {
  const emojiPx = nodeGraphGlGraphState.emojiPx;
  if (emojiPx > 0) opts.emojiPx = emojiPx;
  return opts;
}

function nodeGraphGlGraphSettleTextBake() {
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const chrome = nodeGraphGlGraphState.chrome || {};
  let maxPx = 16;
  for (const title of chrome.titles || []) maxPx = Math.max(maxPx, (title.h || 16) * 0.78 * zoom);
  for (const label of chrome.labels || []) maxPx = Math.max(maxPx, (label.fontPx || 13) * zoom);
  for (const slider of chrome.sliders || []) {
    if (slider.labelBox) maxPx = Math.max(maxPx, slider.labelBox.h * 0.8 * zoom);
    if (slider.valueBox) maxPx = Math.max(maxPx, slider.valueBox.h * 0.85 * zoom);
  }
  const px = Math.max(16, Math.min(384, Math.round(maxPx)));
  nodeGraphGlGraphState.emojiPx = px;
  if (typeof nodeGraphGlLinesSetGlyphBakePx === "function") nodeGraphGlLinesSetGlyphBakePx(px);
}

function nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH, pad = 48) {
  return x + w < -pad || y + h < -pad || x > cssW + pad || y > cssH + pad;
}

function nodeGraphGlGraphDrawChrome(batch, toX, toY, zoom, cssW, cssH) {
  const chrome = nodeGraphGlGraphState.chrome;
  if (!chrome) return;
  const ink = [1, 1, 1, 1];
  const well = [0.031, 0.043, 0.051, 1];
  const amount = [0.05, 0.09, 0.12, 1];
  const valueFill = [0.27, 0.64, 1, 0.9];
  const jacks = chrome.jacks || [];
  const jackHalf = Math.max(0.6, 0.7 * zoom);
  for (let i = 0; i < jacks.length; i += 1) {
    const jack = jacks[i];
    const cx = toX(jack.x);
    const cy = toY(jack.y);
    const r = Math.max(2, jack.r * zoom);
    if (nodeGraphGlGraphOutside(cx - r, cy - r, r * 2, r * 2, cssW, cssH, r)) continue;
    const steps = 10;
    const pts = new Float32Array((steps + 1) * 2);
    const a0 = jack.inwardRight ? -Math.PI / 2 : Math.PI / 2;
    const a1 = jack.inwardRight ? Math.PI / 2 : Math.PI * 1.5;
    for (let s = 0; s <= steps; s += 1) {
      const a = a0 + (a1 - a0) * (s / steps);
      pts[s * 2] = cx + Math.cos(a) * r;
      pts[s * 2 + 1] = cy + Math.sin(a) * r;
    }
    nodeGraphGlLinesPolyline(batch, pts, jackHalf, 0.4, jack.rgba);
  }
  const sliders = chrome.sliders || [];
  for (let i = 0; i < sliders.length; i += 1) {
    const slider = sliders[i];
    const x = toX(slider.x);
    const y = toY(slider.y);
    const w = slider.w * zoom;
    const h = slider.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    nodeGraphGlLinesRect(batch, x, y, w, h, well);
    const readout = slider.readout;
    const amountStart = nodeGraphGlGraphCssPx(readout, "--amount-start");
    const amountEnd = nodeGraphGlGraphCssPx(readout, "--amount-end");
    if (amountEnd > amountStart) {
      nodeGraphGlLinesRect(
        batch,
        x + amountStart * zoom,
        y,
        (amountEnd - amountStart) * zoom,
        h,
        amount,
      );
    }
    const valueStart = nodeGraphGlGraphCssPx(readout, "--value-start");
    const valueEnd = nodeGraphGlGraphCssPx(readout, "--value-end");
    if (valueEnd > valueStart) {
      nodeGraphGlLinesRect(
        batch,
        x + valueStart * zoom,
        y,
        (valueEnd - valueStart) * zoom,
        h,
        valueFill,
      );
    }
    if (typeof nodeGraphGlLinesText === "function") {
      const labelText = String(slider.labelEl?.textContent || "").replace(/\s+/g, " ").trim();
      const valueText = String(slider.valueEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (labelText && slider.labelBox && slider.labelAnchor) {
        nodeGraphGlLinesText(
          batch,
          labelText,
          toX(slider.labelAnchor.x),
          toY(slider.labelBox.y + slider.labelBox.h * 0.5),
          nodeGraphGlGraphTextOpts({ px: Math.max(8, slider.labelBox.h * zoom * 0.8), rgba: ink, align: slider.labelAnchor.align, baseline: "middle", weight: 400 }),
        );
      }
      if (valueText && slider.valueBox && slider.valueAnchor) {
        nodeGraphGlLinesText(
          batch,
          valueText,
          toX(slider.valueAnchor.x),
          toY(slider.valueBox.y + slider.valueBox.h * 0.5),
          nodeGraphGlGraphTextOpts({ px: Math.max(8, slider.valueBox.h * zoom * 0.85), rgba: ink, align: slider.valueAnchor.align, baseline: "middle", weight: 400 }),
        );
      }
    }
  }
  const labels = chrome.labels || [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    const text = String(label.el?.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || typeof nodeGraphGlLinesText !== "function") continue;
    const lx = toX(label.x);
    const ly = toY(label.y);
    if (nodeGraphGlGraphOutside(lx, ly, 0, 0, cssW, cssH, 480)) continue;
    nodeGraphGlLinesText(batch, text, lx, ly, nodeGraphGlGraphTextOpts({
      px: Math.max(1, (label.fontPx || 13) * zoom),
      rgba: ink,
      align: label.align,
      baseline: "middle",
      weight: 400,
    }));
  }
  const titles = chrome.titles || [];
  for (let i = 0; i < titles.length; i += 1) {
    const title = titles[i];
    if (title.el?.dataset?.titleEditing === "1") continue;
    const text = String(title.el?.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || typeof nodeGraphGlLinesText !== "function") continue;
    const tx = toX(title.x);
    const ty = toY(title.y);
    if (nodeGraphGlGraphOutside(tx, ty, 0, 0, cssW, cssH, 480)) continue;
    nodeGraphGlLinesText(batch, text, tx, ty, nodeGraphGlGraphTextOpts({
      px: Math.max(9, title.h * zoom * 0.78),
      rgba: [1, 1, 1, 1],
      align: "center",
      baseline: "middle",
      weight: 400,
    }));
  }
  const keyIdle = [0.1, 0.11, 0.13, 1];
  const keyDown = [0.35, 0.62, 0.78, 1];
  const keyList = chrome.keys || [];
  for (let i = 0; i < keyList.length; i += 1) {
    const key = keyList[i];
    const down = key.el?.classList?.contains("is-down") || key.el?.classList?.contains("is-active");
    const x = toX(key.x);
    const y = toY(key.y);
    const w = key.w * zoom;
    const h = key.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    nodeGraphGlLinesRect(batch, x, y, w, h, down ? keyDown : keyIdle);
    if (key.label && typeof nodeGraphGlLinesText === "function") {
      nodeGraphGlLinesText(batch, key.label, x + w * 0.5, y + h * 0.5, nodeGraphGlGraphTextOpts({
        px: Math.max(8, h * 0.42),
        rgba: ink,
        align: "center",
        baseline: "middle",
        weight: 400,
      }));
    }
  }
  const graphList = chrome.graphs || [];
  for (let i = 0; i < graphList.length; i += 1) {
    const face = graphList[i];
    const x = toX(face.x);
    const y = toY(face.y);
    const w = face.w * zoom;
    const h = face.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    nodeGraphGlLinesRect(batch, x, y, w, h, [0.04, 0.05, 0.07, 1]);
    const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(face.id) : null;
    const graph = patchNode && typeof nodeGraphGraphForNode === "function"
      ? nodeGraphGraphForNode(patchNode)
      : null;
    const samples = 32;
    if (graph && typeof nodeGraphGraphValueAt === "function") {
      const pts = new Float32Array(samples * 2);
      for (let s = 0; s < samples; s += 1) {
        const u = s / (samples - 1);
        const v = Number(nodeGraphGraphValueAt(graph, u));
        const yy = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
        pts[s * 2] = x + u * w;
        pts[s * 2 + 1] = y + (1 - yy) * h;
      }
      nodeGraphGlLinesPolyline(batch, pts, Math.max(0.8, zoom * 0.6), 0.4, [0.85, 0.9, 0.95, 1]);
    }
  }
}

function nodeGraphGlGraphCubic(ax, ay, bx, by, steps) {
  const curve = typeof nodeGraphWireCurve === "function" ? nodeGraphWireCurve() : 1;
  const span = Math.min(
    96,
    (Math.abs(bx - ax) * 0.48 + Math.abs(by - ay) * 0.12) * (Number(curve) || 1),
  );
  const c1x = ax + span;
  const c1y = ay;
  const c2x = bx - span;
  const c2y = by;
  const n = Math.max(1, steps | 0);
  const xy = new Float32Array((n + 1) * 2);
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    xy[i * 2] = uu * u * ax + 3 * uu * t * c1x + 3 * u * tt * c2x + tt * t * bx;
    xy[i * 2 + 1] = uu * u * ay + 3 * uu * t * c1y + 3 * u * tt * c2y + tt * t * by;
  }
  return xy;
}

function nodeGraphGlGraphShape(from, to, wire, zoom) {
  const ax = Number(from.x);
  const ay = Number(from.y);
  const bx = Number(to.x);
  const by = Number(to.y);
  let trace = null;
  if (wire && typeof nodeGraphManualTracePathOptions === "function") {
    const opts = nodeGraphManualTracePathOptions(wire, from, to);
    if (Array.isArray(opts?.tracePoints) && opts.tracePoints.length) {
      trace = opts.tracePoints;
    }
  }
  if (trace) {
    const xy = new Float32Array((trace.length + 2) * 2);
    xy[0] = ax;
    xy[1] = ay;
    for (let i = 0; i < trace.length; i += 1) {
      xy[(i + 1) * 2] = Number(trace[i].x);
      xy[(i + 1) * 2 + 1] = Number(trace[i].y);
    }
    xy[xy.length - 2] = bx;
    xy[xy.length - 1] = by;
    return xy;
  }
  const screenLen = Math.hypot((bx - ax) * zoom, (by - ay) * zoom);
  const steps = Math.max(8, Math.min(32, Math.ceil(screenLen / 8)));
  return nodeGraphGlGraphCubic(ax, ay, bx, by, steps);
}

function nodeGraphGlGraphPushWire(wires, from, to, color, toColor, zoom, wire, squareFrom, squareTo, kind, index) {
  if (!from || !to) return;
  const ax = Number(from.x);
  const ay = Number(from.y);
  const bx = Number(to.x);
  const by = Number(to.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return;
  }
  const rgba = nodeGraphGlGraphCssColor(color);
  const endRgba = nodeGraphGlGraphCssColor(toColor || color);
  wires.push({
    rgba,
    kind: kind || "",
    index: Number.isInteger(index) ? index : -1,
    xy: nodeGraphGlGraphShape(from, to, wire, zoom),
    dots: [
      { x: ax, y: ay, rgba, square: squareFrom === true },
      { x: bx, y: by, rgba: endRgba, square: squareTo === true },
    ],
  });
}

function nodeGraphGlGraphRebuild(options = {}) {
  const lite = options.lite === true;
  const wires = [];
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const colorOf = (node, port, io) => (
    typeof nodeGraphPortWireColor === "function" ? nodeGraphPortWireColor(node, port, io) : ""
  );
  const square = (node, port, io) => (
    typeof nodeGraphWireJackIsSquare === "function" && nodeGraphWireJackIsSquare(node, port, io)
  );
  if (!lite && nodeGraphMvp) {
    const signalWires = nodeGraphMvp.connections || [];
    for (let i = 0; i < signalWires.length; i += 1) {
      const connection = signalWires[i];
      if (typeof nodeGraphSignalWireDestinationIsRenderable === "function"
        && !nodeGraphSignalWireDestinationIsRenderable(connection)) {
        continue;
      }
      const from = nodeGraphPortCenter(connection.sourceNode, connection.sourcePort, "output");
      const to = nodeGraphPortCenter(connection.destinationNode, connection.destinationPort, "input");
      const fromColor = colorOf(connection.sourceNode, connection.sourcePort, "output");
      nodeGraphGlGraphPushWire(
        wires, from, to, fromColor, fromColor, zoom, connection,
        square(connection.sourceNode, connection.sourcePort, "output"),
        square(connection.destinationNode, connection.destinationPort, "input"),
        "signal",
        i,
      );
    }
    const modulationWires = nodeGraphMvp.modulations || [];
    for (let i = 0; i < modulationWires.length; i += 1) {
      const modulation = modulationWires[i];
      if (typeof nodeGraphModulationWireDestinationIsRenderable === "function"
        && !nodeGraphModulationWireDestinationIsRenderable(modulation)) {
        continue;
      }
      const from = nodeGraphPortCenter(modulation.sourceNode, modulation.sourcePort, "output");
      const to = typeof nodeGraphModulationPortCenter === "function"
        ? nodeGraphModulationPortCenter(modulation.destinationNode, modulation.destinationParam)
        : null;
      const fromColor = colorOf(modulation.sourceNode, modulation.sourcePort, "output");
      nodeGraphGlGraphPushWire(
        wires, from, to, fromColor,
        colorOf(modulation.destinationNode, modulation.destinationParam, "modulation") || fromColor,
        zoom, modulation,
        square(modulation.sourceNode, modulation.sourcePort, "output"),
        square(modulation.destinationNode, modulation.destinationParam, "modulation"),
        "modulation",
        i,
      );
    }
    const graphWires = nodeGraphMvp.graphConnections || [];
    for (let i = 0; i < graphWires.length; i += 1) {
      const graphConnection = graphWires[i];
      const from = nodeGraphPortCenter(graphConnection.sourceNode, graphConnection.sourcePort, "output");
      const to = typeof nodeGraphGraphInputPortCenter === "function"
        ? nodeGraphGraphInputPortCenter(graphConnection.destinationNode, graphConnection.destinationGraphInput)
        : null;
      const fromColor = colorOf(graphConnection.sourceNode, graphConnection.sourcePort, "output") || "#e6d36a";
      nodeGraphGlGraphPushWire(
        wires, from, to, fromColor, fromColor, zoom, graphConnection,
        square(graphConnection.sourceNode, graphConnection.sourcePort, "output"),
        false,
        "graph",
        i,
      );
    }
    const drag = nodeGraphMvp.wireDragging;
    if (drag?.active && drag.from && drag.cursorPoint) {
      nodeGraphGlGraphPushWire(wires, drag.from, drag.cursorPoint, "#ffffff", "#ffffff", zoom, null, false, false);
    }
    const mode = nodeGraphMvp.portConnectionMode;
    if (mode?.cursorPoint && mode.selected && typeof mode.selected.values === "function") {
      for (const entry of mode.selected.values()) {
        if (entry?.from) {
          nodeGraphGlGraphPushWire(wires, entry.from, mode.cursorPoint, "#ffffff", "#ffffff", zoom, null, false, false);
        }
      }
    }
  }
  if (!lite || !nodeGraphGlGraphState.wires.length) {
    nodeGraphGlGraphState.wires = wires;
    if (!lite) nodeGraphGlGraphRebuildPlates();
  }
}

function nodeGraphGlGraphFit(canvas, cssW, cssH) {
  const bw = Math.min(4096, cssW);
  const bh = Math.min(4096, cssH);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  return bw / cssW;
}

function nodeGraphGlGraphPresent() {
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host || typeof nodeGraphGlLinesBegin !== "function") return false;
  host.classList.add("gl-graph-on");
  const canvas = nodeGraphGlGraphEnsureCanvas(
    host, "canvas", "nodeGlGraphCanvas", "node-gl-graph-canvas", ".node-graph-zoom-surface",
  );
  const dotsCanvas = nodeGraphGlGraphEnsureCanvas(
    host, "dotsCanvas", "nodeGlGraphDots", "node-gl-graph-dots", null,
  );
  const cssW = Math.max(1, host.clientWidth || 1);
  const cssH = Math.max(1, host.clientHeight || 1);
  const scale = nodeGraphGlGraphFit(canvas, cssW, cssH);
  nodeGraphGlGraphFit(dotsCanvas, cssW, cssH);
  const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale, transparent: true });
  const dotBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { scale, transparent: true });
  if (!batch || !dotBatch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return false;
  }
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const gesturing = typeof nodeGraphViewportHoldsDisplays === "function"
    && nodeGraphViewportHoldsDisplays();
  if (!gesturing) nodeGraphGlGraphSettleTextBake();
  let thick = nodeGraphGlGraphState.thick;
  let dotSize = nodeGraphGlGraphState.dotSize;
  if (!gesturing || !(thick > 0)) {
    const style = getComputedStyle(host);
    thick = Number.parseFloat(style.getPropertyValue("--node-wire-thickness")) || 3.5;
    dotSize = Number.parseFloat(style.getPropertyValue("--node-wire-patch-point-size")) || 8;
    nodeGraphGlGraphState.thick = thick;
    nodeGraphGlGraphState.dotSize = dotSize;
  }
  // Zoom-1 sizes. The camera scales them, same as the module plates.
  const halfPx = Math.max(0.4, thick * 0.5 * zoom);
  const dotR = Math.max(0.6, dotSize * 0.5 * zoom);
  const cam = typeof nodeGraphWireCameraViewBox === "function"
    ? nodeGraphWireCameraViewBox(host)
    : { x: 0, y: 0 };
  const toX = (x) => (x - cam.x) * zoom;
  const toY = (y) => (y - cam.y) * zoom;

  if (nodeGraphMvp?.gridVisible === true && typeof nodeGraphGridScreenCellPx === "function") {
    let cell = nodeGraphGridScreenCellPx(host, zoom);
    let cw = cell.width;
    let ch = cell.height;
    while (cw > 0 && cw < 14) cw *= 2;
    while (ch > 0 && ch < 14) ch *= 2;
    const origin = typeof nodeGraphRenderedOriginOffset === "function"
      ? nodeGraphRenderedOriginOffset()
      : { x: 0, y: 0 };
    const phaseX = typeof nodeGraphGridBackgroundPhase === "function"
      ? nodeGraphGridBackgroundPhase(origin.x, cw)
      : 0;
    const phaseY = typeof nodeGraphGridBackgroundPhase === "function"
      ? nodeGraphGridBackgroundPhase(origin.y, ch)
      : 0;
    const grid = [1, 1, 1, 0.14];
    if (cw >= 14) {
      for (let x = phaseX; x < cssW; x += cw) {
        nodeGraphGlLinesSegment(batch, x, 0, x, cssH, 0.5, 0.4, grid);
      }
    }
    if (ch >= 14) {
      for (let y = phaseY; y < cssH; y += ch) {
        nodeGraphGlLinesSegment(batch, 0, y, cssW, y, 0.5, 0.4, grid);
      }
    }
  }

  const pad = 120;
  for (let i = 0; i < nodeGraphGlGraphState.wires.length; i += 1) {
    const wire = nodeGraphGlGraphState.wires[i];
    const src = wire.xy;
    if (!src || src.length < 4) continue;
    const x0 = toX(src[0]);
    const y0 = toY(src[1]);
    const x1 = toX(src[src.length - 2]);
    const y1 = toY(src[src.length - 1]);
    if (Math.max(x0, x1) < -pad || Math.max(y0, y1) < -pad
      || Math.min(x0, x1) > cssW + pad || Math.min(y0, y1) > cssH + pad) {
      continue;
    }
    let screen = nodeGraphGlGraphState.screen;
    if (screen.length < src.length) {
      screen = new Float32Array(src.length);
      nodeGraphGlGraphState.screen = screen;
    }
    for (let p = 0; p < src.length; p += 2) {
      screen[p] = toX(src[p]);
      screen[p + 1] = toY(src[p + 1]);
    }
    let stroke = halfPx;
    let rgba = wire.rgba;
    if (wire.kind && wire.index >= 0 && typeof nodeGraphSelectedWireEntries === "function") {
      const picked = nodeGraphSelectedWireEntries().some((entry) =>
        (entry.kind || "signal") === wire.kind && Number(entry.index) === wire.index,
      );
      if (picked) {
        rgba = [0.95, 0.86, 0.45, 1];
        stroke = halfPx + Math.max(0.8, 0.35 * zoom);
      }
    }
    nodeGraphGlLinesPolyline(batch, screen.subarray(0, src.length), stroke, 0.55, rgba);
    const dots = wire.dots || [];
    for (let d = 0; d < dots.length; d += 1) {
      const dot = dots[d];
      const dx = toX(dot.x);
      const dy = toY(dot.y);
      if (dx < -dotR || dy < -dotR || dx > cssW + dotR || dy > cssH + dotR) continue;
      if (dot.square) {
        nodeGraphGlLinesRect(dotBatch, dx - dotR, dy - dotR, dotR * 2, dotR * 2, dot.rgba);
      } else {
        nodeGraphGlLinesDot(dotBatch, dx, dy, dotR, 0.55, dot.rgba);
      }
    }
  }
  const borderIdle = [1, 1, 1, 0.55];
  const borderOn = [0.95, 0.86, 0.45, 1];
  for (let i = 0; i < nodeGraphGlGraphState.plates.length; i += 1) {
    const plate = nodeGraphGlGraphState.plates[i];
    const x = toX(plate.x);
    const y = toY(plate.y);
    const w = plate.w * zoom;
    const h = plate.h * zoom;
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;
    const edge = Math.max(1, zoom);
    const selected = typeof nodeGraphNodeElement === "function"
      && nodeGraphNodeElement(plate.id)?.classList.contains("selected");
    const color = selected ? borderOn : borderIdle;
    const gap = plate.gap || 16;
    const notches = plate.notches || { left: [], right: [], top: [], bottom: [] };
    nodeGraphGlLinesRect(batch, x, y, w, h, plate.fill);
    const paintSide = (runs, horizontal, fixed) => {
      for (let r = 0; r < runs.length; r += 1) {
        const a = runs[r][0];
        const b = runs[r][1];
        if (horizontal) {
          const sx = toX(a);
          nodeGraphGlLinesRect(batch, sx, fixed, Math.max(0.5, toX(b) - sx), edge, color);
        } else {
          const sy = toY(a);
          nodeGraphGlLinesRect(batch, fixed, sy, edge, Math.max(0.5, toY(b) - sy), color);
        }
      }
    };
    paintSide(nodeGraphGlGraphStrokeRuns(plate.y, plate.y + plate.h, notches.left, gap), false, x - edge);
    paintSide(nodeGraphGlGraphStrokeRuns(plate.y, plate.y + plate.h, notches.right, gap), false, x + w);
    paintSide(nodeGraphGlGraphStrokeRuns(plate.x, plate.x + plate.w, notches.top, gap), true, y - edge);
    paintSide(nodeGraphGlGraphStrokeRuns(plate.x, plate.x + plate.w, notches.bottom, gap), true, y + h);
  }
  batch.textPixelated = zoom > 2.5;
  nodeGraphGlGraphDrawChrome(batch, toX, toY, zoom, cssW, cssH);
  const pixelated = zoom > 2.5;
  for (let i = 0; i < nodeGraphGlGraphState.displays.length; i += 1) {
    const face = nodeGraphGlGraphState.displays[i];
    if (!face.canvas || !(face.w > 0) || !(face.h > 0)) continue;
    const x = toX(face.x);
    const y = toY(face.y);
    const w = face.w * zoom;
    const h = face.h * zoom;
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;
    nodeGraphGlLinesImage(dotBatch, face.canvas, x, y, w, h, {
      nearest: pixelated,
      // Pan/zoom already froze the face pixels. Re-upload only when displays paint.
      cache: gesturing,
      alpha: 1,
    });
  }
  const outputPaused = typeof nodeGraphLiveEngineIsPaused === "function" && nodeGraphLiveEngineIsPaused();
  if (outputPaused) {
    const white = [1, 1, 1, 1];
    for (let i = 0; i < nodeGraphGlGraphState.displays.length; i += 1) {
      const face = nodeGraphGlGraphState.displays[i];
      if (!face.output || !(face.w > 0) || !(face.h > 0)) continue;
      const x = toX(face.x);
      const y = toY(face.y);
      const w = face.w * zoom;
      const h = face.h * zoom;
      if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;
      const side = Math.min(w, h);
      const barH = Math.max(6, side * 0.46);
      const barW = Math.max(2, side * 0.14);
      const gap = Math.max(2, side * 0.1);
      const x0 = x + (w - (barW * 2 + gap)) * 0.5;
      const y0 = y + (h - barH) * 0.5;
      nodeGraphGlLinesRect(dotBatch, x0, y0, barW, barH, white);
      nodeGraphGlLinesRect(dotBatch, x0 + barW + gap, y0, barW, barH, white);
    }
  }
  const cablesOk = nodeGraphGlLinesEnd(batch, "alpha") !== false;
  const dotsOk = nodeGraphGlLinesEnd(dotBatch, "alpha") !== false;
  return cablesOk && dotsOk;
}

/** Full rebuild from the patch. Returns true when GL owns cables. */
function nodeGraphGlGraphPaint(options = {}) {
  if (!options.lite && nodeGraphMvp) {
    for (const connection of nodeGraphMvp.connections || []) {
      if (typeof markNodeGraphWireEndpointsConnected === "function") {
        markNodeGraphWireEndpointsConnected(connection);
      }
    }
    for (const modulation of nodeGraphMvp.modulations || []) {
      if (typeof markNodeGraphWireEndpointsConnected === "function") {
        markNodeGraphWireEndpointsConnected(modulation, "modulation");
      }
    }
  }
  nodeGraphGlGraphRebuild(options);
  nodeGraphGlGraphPresent();
  nodeGraphGlHitInstall();
  return true;
}

function nodeGraphGlGraphPresentCamera() {
  if (!nodeGraphGlGraphState.canvas && !nodeGraphGlGraphState.wires.length) return;
  nodeGraphGlGraphPresent();
}

function nodeGraphGlHitIsLiveHtml(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [popover], .metadata-popover, .node-floating-window, .node-context-menu")) {
    return true;
  }
  return Boolean(target.closest(".node-header-title[data-title-editing='1']"));
}

function nodeGraphGlHitKeepsNativeTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    ".node-module-graph-face, .node-module-graph-display, .node-keypad-face, .node-knob-face, .node-xy-pad-canvas, .node-sequencer-roll, .acid-seq-face, .node-arp-keys-face, .node-plugin-toggle-button, .node-plugin-momentary-button",
  ));
}

function nodeGraphGlHitWireAt(x, y) {
  const wires = nodeGraphGlGraphState.wires || [];
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const reach = 9 / Math.max(0.2, zoom);
  let best = null;
  let bestD = reach;
  for (let w = 0; w < wires.length; w += 1) {
    const wire = wires[w];
    const pts = wire.xy;
    if (!wire.kind || wire.index < 0 || !pts || pts.length < 4) continue;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const ay = pts[i + 1];
      const bx = pts[i + 2];
      const by = pts[i + 3];
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / len2)) : 0;
      const dx = x - (ax + abx * t);
      const dy = y - (ay + aby * t);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = wire;
      }
    }
  }
  return best ? { kind: best.kind, index: best.index } : null;
}

function nodeGraphGlHitWireAtEvent(event) {
  const point = nodeGraphGlHitPoint(event);
  if (!point) return null;
  return nodeGraphGlHitWireAt(point.x, point.y);
}

function nodeGraphGlHitPoint(event) {
  if (typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  return nodeGraphClientToZoomSurfacePoint(event.clientX, event.clientY);
}

function nodeGraphGlHitTest(x, y) {
  const chrome = nodeGraphGlGraphState.chrome || {};
  const jacks = chrome.jacks || [];
  for (let i = jacks.length - 1; i >= 0; i -= 1) {
    const jack = jacks[i];
    const reach = Math.max(8, jack.r * 1.25);
    const dx = jack.x - x;
    const dy = jack.y - y;
    if (dx * dx + dy * dy <= reach * reach) {
      return { kind: "jack", x: jack.x, y: jack.y };
    }
  }
  const sliders = chrome.sliders || [];
  for (let i = sliders.length - 1; i >= 0; i -= 1) {
    const slider = sliders[i];
    if (x >= slider.x && x <= slider.x + slider.w && y >= slider.y && y <= slider.y + slider.h) {
      return { kind: "slider", readout: slider.readout };
    }
  }
  const titles = chrome.titles || [];
  for (let i = titles.length - 1; i >= 0; i -= 1) {
    const title = titles[i];
    const box = title.box;
    if (!box) continue;
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      return { kind: "title", el: title.el };
    }
  }
  const plates = nodeGraphGlGraphState.plates || [];
  for (let i = plates.length - 1; i >= 0; i -= 1) {
    const plate = plates[i];
    if (x >= plate.x && x <= plate.x + plate.w && y >= plate.y && y <= plate.y + plate.h) {
      return { kind: "plate", id: plate.id };
    }
  }
  return null;
}

function nodeGraphGlHitRetarget(event, element) {
  return new Proxy(event, {
    get(source, key) {
      if (key === "target" || key === "currentTarget") return element;
      const value = source[key];
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}

function nodeGraphGlHitPortElement(moduleEl, x, y) {
  if (!moduleEl) return null;
  const ports = moduleEl.querySelectorAll(".node-port, .node-param-port");
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < ports.length; i += 1) {
    const port = ports[i];
    const box = nodeGraphGlGraphWorldBox(port);
    if (!box) continue;
    const dx = box.x + box.w * 0.5 - x;
    const dy = box.y + box.h * 0.5 - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = port;
    }
  }
  return best;
}

const nodeGraphGlHitState = { lastTitleDown: null };

function nodeGraphGlHitPointerDown(event) {
  if (event.button !== 0) return;
  if (nodeGraphGlHitIsLiveHtml(event.target) || nodeGraphGlHitKeepsNativeTarget(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".node-text-box-body, .node-text-box-input")) return;
  const point = nodeGraphGlHitPoint(event);
  if (!point) return;
  const hit = nodeGraphGlHitTest(point.x, point.y);
  if (!hit) {
    const wire = nodeGraphGlHitWireAt(point.x, point.y);
    if (wire && typeof selectNodeGraphWire === "function") {
      event.preventDefault();
      event.stopPropagation();
      selectNodeGraphWire(event, wire.index, wire.kind);
    }
    return;
  }
  if (hit.kind === "slider" && hit.readout && typeof beginNodeSliderDrag === "function") {
    event.preventDefault();
    event.stopPropagation();
    beginNodeSliderDrag(nodeGraphGlHitRetarget(event, hit.readout));
    return;
  }
  if (hit.kind === "jack") {
    const plates = nodeGraphGlGraphState.plates || [];
    let moduleEl = null;
    for (let i = plates.length - 1; i >= 0; i -= 1) {
      const plate = plates[i];
      const pad = 14;
      if (point.x >= plate.x - pad && point.x <= plate.x + plate.w + pad
        && point.y >= plate.y - pad && point.y <= plate.y + plate.h + pad) {
        moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
        break;
      }
    }
    const port = nodeGraphGlHitPortElement(moduleEl, hit.x, hit.y);
    const handler = nodeGraphWireInteractions?.handlePortPointerDown;
    if (port && typeof handler === "function") {
      event.preventDefault();
      event.stopPropagation();
      handler(nodeGraphGlHitRetarget(event, port));
    }
    return;
  }
  if (hit.kind === "title" && hit.el) {
    const now = performance.now();
    const last = nodeGraphGlHitState.lastTitleDown;
    const repeat = last && last.el === hit.el && now - last.time < 400;
    nodeGraphGlHitState.lastTitleDown = { el: hit.el, time: now };
    if (repeat && typeof startNodeGraphModuleTitleEdit === "function") {
      event.preventDefault();
      event.stopPropagation();
      startNodeGraphModuleTitleEdit(hit.el, event);
      nodeGraphGlHitState.lastTitleDown = null;
      return;
    }
    const row = hit.el.closest(".node-header-title-row") || hit.el;
    if (typeof beginNodeGraphNodeDrag === "function") {
      event.preventDefault();
      event.stopPropagation();
      beginNodeGraphNodeDrag(nodeGraphGlHitRetarget(event, row));
    }
    return;
  }
  if (hit.kind === "plate" && typeof beginNodeGraphNodeDrag === "function") {
    const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(hit.id) : null;
    const shell = moduleEl?.querySelector(".node-solid-module-shell, .node-module-chrome-layout-b-shell, .node-header-title-row") || moduleEl;
    if (!shell) return;
    event.preventDefault();
    event.stopPropagation();
    beginNodeGraphNodeDrag(nodeGraphGlHitRetarget(event, shell));
  }
}

function nodeGraphGlHitContextMenu(event) {
  if (nodeGraphGlHitIsLiveHtml(event.target) || nodeGraphGlHitKeepsNativeTarget(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".node-text-box-body, .node-text-box-input")) return;
  const point = nodeGraphGlHitPoint(event);
  if (!point) return;
  const hit = nodeGraphGlHitTest(point.x, point.y);
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  if (hit.kind === "slider" && hit.readout && typeof openNodeMetadataPopover === "function") {
    openNodeMetadataPopover(nodeGraphGlHitRetarget(event, hit.readout), hit.readout);
    return;
  }
  const id = hit.id || hit.el?.closest?.(".dsp-node")?.dataset?.node;
  const moduleEl = id && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : hit.el?.closest?.(".dsp-node");
  const shell = moduleEl?.querySelector(".node-solid-module-shell, .node-module-chrome-layout-b-shell") || moduleEl;
  if (shell && typeof openNodeModuleActionMenu === "function") {
    openNodeModuleActionMenu(nodeGraphGlHitRetarget(event, shell));
  }
}

function nodeGraphGlHitInstall() {
  if (nodeGraphGlHitState.installed) return;
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return;
  host.addEventListener("pointerdown", nodeGraphGlHitPointerDown, true);
  host.addEventListener("contextmenu", nodeGraphGlHitContextMenu, true);
  nodeGraphGlHitState.installed = true;
}

/**
 * GB-5. Same four traces every time: zoom out 40→0.35, zoom in 0.35→40,
 * pan at 40×, pan at 0.35×. Restores the camera. Logs a table.
 * Run from the console on the patch you care about: nodeGraphGlGraphMeasureGb5()
 */
function nodeGraphGlGraphMeasureGb5() {
  const frames = 24;
  const traces = [
    { name: "zoom-out 40 to 0.35", from: 40, to: 0.35 },
    { name: "zoom-in 0.35 to 40", from: 0.35, to: 40 },
    { name: "pan at 40x", zoom: 40, pan: true },
    { name: "pan at 0.35x", zoom: 0.35, pan: true },
  ];
  const savedZoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const savedPan = {
    x: Number(nodeGraphMvp?.pan?.x) || 0,
    y: Number(nodeGraphMvp?.pan?.y) || 0,
  };
  const rows = [];
  let traceIndex = 0;
  let step = 0;
  const write = (line) => {
    console.warn(line);
    try {
      if (window.SE && typeof window.SE.NOTE === "function") window.SE.NOTE(line);
      else if (window.SE && typeof window.SE.VM === "function") window.SE.VM(line);
    } catch (_error) {
      // The debug log is optional. The console line is the record.
    }
  };
  write("GB-5 started");
  const finish = () => {
    write("GB-5 done");
    try {
      if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(savedZoom);
      if (nodeGraphMvp) nodeGraphMvp.pan = { x: savedPan.x, y: savedPan.y };
      if (typeof applyNodeGraphViewportCssLight === "function") {
        applyNodeGraphViewportCssLight({ zoom: true, pan: true });
      }
      if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
      if (typeof flushNodeGraphViewportOnPointerUp === "function") {
        flushNodeGraphViewportOnPointerUp();
      }
    } catch (error) {
      write(`GB-5 restore failed: ${error && error.message ? error.message : error}`);
    }
    return rows;
  };
  const tick = () => {
    try {
      if (traceIndex >= traces.length) {
        finish();
        return;
      }
      const trace = traces[traceIndex];
      const t0 = performance.now();
      if (trace.pan) {
        if (step === 0 && typeof setNodeGraphZoom === "function") setNodeGraphZoom(trace.zoom);
        const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
        if (nodeGraphMvp) {
          nodeGraphMvp.pan = { x: Number(pan.x) + 48, y: Number(pan.y) + 28 };
        }
        if (typeof markNodeGraphViewportGesture === "function") markNodeGraphViewportGesture("pan");
        if (typeof applyNodeGraphViewportCssLight === "function") {
          applyNodeGraphViewportCssLight({ zoom: false, pan: true, readouts: false });
        }
      } else if (typeof setNodeGraphZoom === "function") {
        const u = frames <= 1 ? 1 : step / (frames - 1);
        setNodeGraphZoom(trace.from + (trace.to - trace.from) * u);
      }
      const mid = performance.now();
      if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
      const total = performance.now() - t0;
      if (!trace.samples) trace.samples = [];
      trace.samples.push(total);
      trace.present = (trace.present || 0) + (performance.now() - mid);
      step += 1;
      if (step >= frames) {
        const samples = trace.samples;
        const sum = samples.reduce((acc, ms) => acc + ms, 0);
        const row = {
          trace: trace.name,
          frames: samples.length,
          totalMs: Math.round(sum),
          presentMs: Math.round(trace.present),
          maxFrameMs: Math.round(samples.reduce((acc, ms) => Math.max(acc, ms), 0)),
        };
        rows.push(row);
        write(`${row.trace}: total ${row.totalMs} ms, present ${row.presentMs} ms, max frame ${row.maxFrameMs} ms`);
        traceIndex += 1;
        step = 0;
      }
    } catch (error) {
      write(`GB-5 stopped: ${error && error.message ? error.message : error}`);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return "GB-5 started. Each trace prints in the console and in the debug log.";
}
