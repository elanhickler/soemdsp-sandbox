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
  // null = the workspace camera. Set only while nodeGraphGlGraphPresentTile runs this same pass
  // for a perform / layout canvas whole-module tile: { host, ids, zoom, cam, toWorld }.
  view: null,
};

// Client -> graph point for the pass being built (workspace zoom surface, or the tile's zoom-1 module).
function nodeGraphGlGraphToWorld(clientX, clientY) {
  const view = nodeGraphGlGraphState.view;
  return view ? view.toWorld(clientX, clientY) : nodeGraphClientToZoomSurfacePoint(clientX, clientY);
}

function nodeGraphGlGraphZoom() {
  const view = nodeGraphGlGraphState.view;
  if (view) return view.zoom;
  return typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
}

function nodeGraphGlGraphGeometry(id) {
  const view = nodeGraphGlGraphState.view;
  if (!view) return typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(id) : null;
  if (!view.ids.has(id) || typeof nodeGraphModuleGeometryPublishFromDom !== "function") return null;
  return nodeGraphModuleGeometryPublishFromDom(id, { toSurface: view.toWorld, store: false });
}

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
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?/);
  if (rgb) {
    let alpha = 1;
    if (rgb[4] != null && rgb[4] !== "") {
      alpha = rgb[5] === "%" ? Number(rgb[4]) / 100 : Number(rgb[4]);
      if (alpha > 1) alpha /= 255;
    }
    return [
      Number(rgb[1]) / 255,
      Number(rgb[2]) / 255,
      Number(rgb[3]) / 255,
      Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
    ];
  }
  return fallback;
}

function nodeGraphGlGraphPortBrightness(moduleEl, port) {
  const name = String(port || "");
  let connected = false;
  if (moduleEl && name && typeof CSS !== "undefined" && CSS.escape) {
    const esc = CSS.escape(name);
    const el = moduleEl.querySelector(
      `.node-port[data-port="${esc}"], .node-param-port[data-port="${esc}"]`,
    );
    connected = Boolean(el?.classList.contains("connected-port"));
  }
  const raw = getComputedStyle(moduleEl || document.documentElement).getPropertyValue(
    connected ? "--node-port-used-brightness" : "--node-port-unused-brightness",
  );
  let amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount)) return connected ? 0.85 : 0.68;
  if (String(raw).includes("%") || amount > 1) amount /= 100;
  return Math.max(0, Math.min(1, amount));
}

// Layout pixels inside the module, before the camera transform. Same space as
// the plate box, so the display and the stroke share one pixel grid.
function nodeGraphGlGraphLayoutBox(el, moduleEl) {
  if (typeof nodeGraphModuleLayoutBox === "function") {
    const laid = nodeGraphModuleLayoutBox(el, moduleEl);
    if (!laid || !(laid.w > 1) || !(laid.h > 1)) return null;
    return laid;
  }
  return null;
}

function nodeGraphGlGraphRebuildPlates() {
  const plates = [];
  const displays = [];
  const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "");
    if (!id) continue;
    const geo = nodeGraphGlGraphGeometry(id);
    const box = geo?.box;
    if (!box || !(box.w > 1) || !(box.h > 1)) continue;
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
    if (!el || !el.isConnected || el.hidden || el.classList.contains("removed")) continue;
    if (el.getAttribute("data-hide-module-frame") === "1") continue;
    const textBody = el.querySelector(":scope > .node-text-box-body");
    const style = getComputedStyle(el);
    let fill = nodeGraphGlGraphParseCssColor(
      style.getPropertyValue("--node-module-fill"),
      [0.09, 0.1, 0.12, 1],
    );
    let onTop = false;
    if (textBody) {
      const layout = typeof normalizeNodeGraphTextBoxLayout === "function"
        ? normalizeNodeGraphTextBoxLayout(nodes[i]?.layout)
        : nodes[i]?.layout || {};
      onTop = layout.showOnTop === true;
      const bg = nodeGraphGlGraphParseCssColor(
        style.getPropertyValue("--node-text-box-bg-color") || layout.backgroundColor,
        [0.008, 0.016, 0.027, 1],
      );
      const alpha = Number.isFinite(Number(layout.backgroundAlpha))
        ? Math.max(0, Math.min(1, Number(layout.backgroundAlpha)))
        : Number.parseFloat(style.getPropertyValue("--node-text-box-bg-alpha")) || 0.78;
      fill = [bg[0], bg[1], bg[2], alpha];
    }
    plates.push({
      id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill,
      selected: el.classList.contains("selected"),
      textBox: Boolean(textBody),
      onTop,
    });
    const canvases = el.querySelectorAll(".node-display-canvas");
    for (let c = 0; c < canvases.length; c += 1) {
      const face = canvases[c];
      if (!(face.width > 1) || !(face.height > 1)) continue;
      const page = face.closest("[data-music-player-page]");
      if (page?.hidden || face.closest("[hidden]")) continue;
      if (face.classList.contains("node-round-shape-canvas")) continue;
      const laid = nodeGraphGlGraphLayoutBox(face, el);
      if (!laid) continue;
      displays.push({
        canvas: face,
        id,
        x: box.x + laid.x,
        y: box.y + laid.y,
        w: laid.w,
        h: laid.h,
        output: String(nodes[i]?.type || "") === "output",
      });
    }
  }
  nodeGraphGlGraphState.plates = plates;
  nodeGraphGlGraphState.displays = displays;
  nodeGraphGlGraphRebuildChrome();
}

// Display meets the plate edge. The stroke is the band outside that edge.
function nodeGraphGlGraphDisplayScreenRect(face, toX, toY, zoom) {
  return nodeGraphGlGraphScreenRect(face.id, face, toX, toY, zoom);
}

function nodeGraphGlGraphCssPx(el, name) {
  const raw = el?.style?.getPropertyValue?.(name) || "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function nodeGraphGlGraphClientWorldBox(el) {
  if (!el || typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 1) || !(rect.height > 1)) return null;
  const tl = nodeGraphGlGraphToWorld(rect.left, rect.top);
  const br = nodeGraphGlGraphToWorld(rect.right, rect.bottom);
  const w = br.x - tl.x;
  const h = br.y - tl.y;
  if (!(w > 0.5) || !(h > 0.5)) return null;
  return { x: tl.x, y: tl.y, w, h };
}

function nodeGraphGlGraphWorldBox(el) {
  if (!el) return null;
  // Tiles map through the face's client rect. The workspace uses layout pixels.
  if (nodeGraphGlGraphState.view) return nodeGraphGlGraphClientWorldBox(el);
  const moduleEl = el.classList?.contains("dsp-node") ? el : el.closest?.(".dsp-node");
  if (!moduleEl || typeof nodeGraphModuleLayoutBox !== "function") return nodeGraphGlGraphClientWorldBox(el);
  const origin = nodeGraphModuleLayoutBox(moduleEl);
  if (!origin) return null;
  if (el === moduleEl) return origin;
  const laid = nodeGraphModuleLayoutBox(el, moduleEl);
  if (!laid) return null;
  return { x: origin.x + laid.x, y: origin.y + laid.y, w: laid.w, h: laid.h };
}

// Project a layout box and snap any edge that sits on the plate to the plate's pixel.
function nodeGraphGlGraphScreenRect(id, world, toX, toY, zoom) {
  let x = toX(world.x);
  let y = toY(world.y);
  let x2 = toX(world.x + world.w);
  let y2 = toY(world.y + world.h);
  const plates = nodeGraphGlGraphState.plates;
  let plate = null;
  for (let i = 0; i < plates.length; i += 1) {
    if (plates[i].id === id) {
      plate = plates[i];
      break;
    }
  }
  if (!plate) return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
  const minX = Math.round(toX(plate.x));
  const minY = Math.round(toY(plate.y));
  const maxX = minX + Math.max(1, Math.round(plate.w * zoom));
  const maxY = minY + Math.max(1, Math.round(plate.h * zoom));
  if (world.x - plate.x <= 1) x = minX;
  if (plate.x + plate.w - (world.x + world.w) <= 1) x2 = maxX;
  if (world.y - plate.y <= 1) y = minY;
  if (plate.y + plate.h - (world.y + world.h) <= 1) y2 = maxY;
  x = Math.max(x, minX);
  y = Math.max(y, minY);
  x2 = Math.min(x2, maxX);
  y2 = Math.min(y2, maxY);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
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
  const seeds = [];
  const keys = [];
  const graphs = [];
  const headerButtons = [];
  const host = document.getElementById("nodeGraphWorkspace");
  const diameter = Number.parseFloat(
    host ? getComputedStyle(host).getPropertyValue("--node-port-diameter") : "",
  ) || 14;
  const radius = diameter * 0.5;
  const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "");
    if (nodeGraphGlGraphState.view && !nodeGraphGlGraphState.view.ids.has(id)) continue;
    const el = id && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
    if (!el || !el.isConnected || el.hidden) continue;
    const title = el.querySelector(".node-header-title");
    const titleRow = el.querySelector(".node-header-title-row") || title;
    const titleBox = nodeGraphGlGraphWorldBox(titleRow);
    if (title && titleBox) {
      titles.push({
        id,
        el: title,
        box: titleBox,
        x: titleBox.x + titleBox.w * 0.5,
        y: titleBox.y + titleBox.h * 0.5,
        h: titleBox.h,
        fill: nodeGraphGlGraphParseCssColor(
          getComputedStyle(el).getPropertyValue("--node-module-title-fill"),
          [0.012, 0.004, 0.075, 1],
        ),
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
        box,
        x: align === "right" ? box.x + box.w : box.x,
        y: box.y + box.h * 0.5,
        fontPx,
        align,
      });
    }
    const geo = nodeGraphGlGraphGeometry(id);
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
      const rgba = nodeGraphGlGraphParseCssColor(color, nodeGraphGlGraphCssColor(color));
      rgba[3] *= nodeGraphGlGraphPortBrightness(el, port);
      const squareJack = typeof nodeGraphWireJackIsSquare === "function"
        && nodeGraphWireJackIsSquare(id, port, io);
      jacks.push({
        key,
        id,
        port,
        io,
        kind: pin.kind || "",
        signal: Boolean(pin.port),
        x: px,
        y: py,
        r: radius,
        square: squareJack,
        rail: !pin.port && typeof nodeGraphModuleRailOwnsParam === "function"
          && nodeGraphModuleRailOwnsParam(id, pin.key),
        inwardRight: io !== "output",
        inlet: true,
        rgba,
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
      const unitEl = readout.querySelector(".node-slider-readout-unit");
      const valueBox = nodeGraphGlGraphWorldBox(valueEl);
      const labelBox = nodeGraphGlGraphWorldBox(labelEl);
      const unitBox = nodeGraphGlGraphWorldBox(unitEl);
      const row = readout.closest(".node-parameter-row");
      const rowBox = nodeGraphGlGraphWorldBox(row);
      if (readout.closest(".node-seed-control, .node-parameter-row-seed")) {
        continue;
      }
      sliders.push({
        id,
        readout,
        input,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        hitX: rowBox ? rowBox.x : box.x,
        hitY: rowBox ? rowBox.y : box.y,
        hitW: rowBox ? rowBox.w : box.w,
        hitH: rowBox ? rowBox.h : box.h,
        valueEl,
        valueBox,
        valueAnchor: valueEl && valueBox ? nodeGraphGlGraphTextAnchor(valueEl, valueBox) : null,
        labelEl,
        labelBox,
        labelAnchor: labelEl && labelBox ? nodeGraphGlGraphTextAnchor(labelEl, labelBox) : null,
        unitEl,
        unitBox,
        unitAnchor: unitEl && unitBox ? nodeGraphGlGraphTextAnchor(unitEl, unitBox) : null,
        // Text metrics read once here (ZP-5); presents never call getComputedStyle.
        ...nodeGraphGlGraphSliderTextMetrics(labelEl, valueEl, unitEl),
      });
    }
    const seedControls = el.querySelectorAll(".node-seed-control");
    for (let se = 0; se < seedControls.length; se += 1) {
      const control = seedControls[se];
      const box = nodeGraphGlGraphWorldBox(control);
      if (!box) continue;
      const valueEl = control.querySelector(".node-slider-readout-value");
      const dice = control.querySelector(".node-seed-btn-dice");
      const plus = control.querySelector(".node-seed-btn-plus");
      const minus = control.querySelector(".node-seed-btn-minus");
      seeds.push({
        id,
        control,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        valueEl,
        valueBox: nodeGraphGlGraphWorldBox(valueEl),
        readoutBox: nodeGraphGlGraphWorldBox(control.querySelector(".node-slider-readout")),
        valuePx: Number.parseFloat(valueEl ? getComputedStyle(valueEl).fontSize : "") || 0,
        dice,
        plus,
        minus,
        diceBox: nodeGraphGlGraphWorldBox(dice),
        plusBox: nodeGraphGlGraphWorldBox(plus),
        minusBox: nodeGraphGlGraphWorldBox(minus),
        hover: (dice?.matches?.(":hover") && "dice")
          || (plus?.matches?.(":hover") && "plus")
          || (minus?.matches?.(":hover") && "minus")
          || "",
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
    const headerEls = el.querySelectorAll(
      ".node-drag-handle, .node-display-settings-button, .node-metaparameter-button, .node-action-button, .node-bypass-button, .node-execution-order-badge",
    );
    for (let h = 0; h < headerEls.length; h += 1) {
      const box = nodeGraphGlGraphWorldBox(headerEls[h]);
      if (box) headerButtons.push({ el: headerEls[h], box });
    }
  }
  const root = document.documentElement;
  const ghostHost = host || root;
  nodeGraphGlGraphState.chrome = {
    titles, labels, jacks, sliders, seeds, keys, graphs, headerButtons,
    // Read once per rebuild, not per present.
    seedLine: typeof nodeGraphGlLinesCss === "function"
      ? nodeGraphGlLinesCss(getComputedStyle(root).getPropertyValue("--line") || "#3a4248")
      : [0.23, 0.26, 0.28, 1],
    ghostFill: typeof nodeGraphGlLinesCss === "function"
      ? nodeGraphGlLinesCss(getComputedStyle(ghostHost).getPropertyValue("--node-slider-ghost-color") || "hsl(262 100% 76% / 0.38)")
      : [0.78, 0.55, 1, 0.38],
    bakePx: 0,
    constraints: nodeGraphGlGraphCollectConstraintBoxes(),
  };
  nodeGraphGlGraphState.chrome.bakePx = nodeGraphGlGraphChromeBakePx(nodeGraphGlGraphState.chrome);
}

// ZP-6: constraint badge boxes are world boxes read at rebuild. The badges
// are drawn into the veil batch, so they ride the cached mesh mid-gesture.
function nodeGraphGlGraphCollectConstraintBoxes() {
  const out = [];
  const nodes = document.querySelectorAll(".node-graph-workspace [data-node-constraint]");
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    if (el.closest(".node-layout-canvas-tile, .node-screen-solo-stage")) continue;
    const keys = String(el.dataset.nodeConstraint || "").split(/\s+/).filter(Boolean);
    if (!keys.length) continue;
    const box = nodeGraphGlGraphWorldBox(el);
    if (box) out.push({ box, keys });
  }
  return out;
}

function nodeGraphGlGraphSliderTextMetrics(labelEl, valueEl, unitEl) {
  const px = (el) => Number.parseFloat(el ? getComputedStyle(el).fontSize : "") || 0;
  const out = { labelPx: px(labelEl), valuePx: px(valueEl), unitPx: 0, unitInk: null };
  if (unitEl) {
    const unitStyle = getComputedStyle(unitEl);
    out.unitPx = Number.parseFloat(unitStyle.fontSize) || 0;
    out.unitInk = nodeGraphGlGraphParseCssColor(
      unitStyle.getPropertyValue("--node-slider-unit-color"),
      [127 / 255, 199 / 255, 217 / 255, 1],
    );
  }
  return out;
}

// ZP-5: one glyph bake size per rebuild, from zoom-1 text sizes. The camera
// scales the atlas (nearest above 2.5x); zooming never re-bakes it.
const NODE_GRAPH_GL_TEXT_BAKE_FLOOR = 64;
function nodeGraphGlGraphChromeBakePx(chrome) {
  let maxPx = NODE_GRAPH_GL_TEXT_BAKE_FLOOR;
  for (const title of chrome.titles || []) {
    const chars = Math.max(1, String(title.el?.textContent || "").trim().length);
    maxPx = Math.max(maxPx, Math.min((title.h || 16) * 0.62, (title.box?.w || 16) / chars / 0.62));
  }
  const buttonNodes = (nodeGraphGlGraphState.view?.host || document)
    .querySelectorAll(".node-plugin-momentary-button, .node-plugin-toggle-button");
  for (let i = 0; i < buttonNodes.length; i += 1) {
    const box = nodeGraphGlGraphWorldBox(buttonNodes[i]);
    if (box) maxPx = Math.max(maxPx, Math.min(box.h * 0.42, box.w * 0.5));
  }
  for (const label of chrome.labels || []) maxPx = Math.max(maxPx, label.fontPx || 13);
  for (const slider of chrome.sliders || []) {
    maxPx = Math.max(maxPx, slider.labelPx || 0, slider.valuePx || 0, slider.unitPx || 0);
  }
  return Math.max(16, Math.min(384, Math.round(maxPx)));
}

function nodeGraphGlGraphTextOpts(opts) {
  const emojiPx = nodeGraphGlGraphState.emojiPx;
  if (emojiPx > 0) opts.emojiPx = emojiPx;
  return opts;
}

function nodeGraphGlGraphSettleTextBake() {
  const chrome = nodeGraphGlGraphState.chrome || {};
  let px = chrome.bakePx || NODE_GRAPH_GL_TEXT_BAKE_FLOOR;
  // Tiles only raise the shared bake, so several tiles never rebake against each other.
  if (nodeGraphGlGraphState.view) px = Math.max(px, nodeGraphGlGraphState.emojiPx || 0);
  nodeGraphGlGraphState.emojiPx = px;
  if (typeof nodeGraphGlLinesSetGlyphBakePx === "function") nodeGraphGlLinesSetGlyphBakePx(px);
}

function nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH, pad = 48) {
  if (nodeGraphGlGraphState.frameCamera) return false;
  return x + w < -pad || y + h < -pad || x > cssW + pad || y > cssH + pad;
}

function nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill) {
  if (hideGhost || !readout?.classList.contains("has-ghost-slider")) return;
  const start = nodeGraphGlGraphCssPx(readout, "--ghost-start");
  const end = nodeGraphGlGraphCssPx(readout, "--ghost-end");
  if (!(end > start)) return;
  nodeGraphGlLinesRect(batch, x + start * zoom, y, (end - start) * zoom, h, ghostFill);
}

// Wraparound handle: the part that would leave the track is clipped, and that
// same width is drawn on the opposite edge. Matches --portal-left-width /
// --portal-right-width from syncNodeSliderPortalHandle.
function nodeGraphGlGraphDrawSliderHandle(batch, readout, x, y, h, zoom, layoutW, fill) {
  const valueStart = nodeGraphGlGraphCssPx(readout, "--value-start");
  const valueEnd = nodeGraphGlGraphCssPx(readout, "--value-end");
  if (!(valueEnd > valueStart) || !(layoutW > 0)) return;
  const wrap = readout?.classList?.contains("wraparound-slider");
  const start = wrap ? Math.max(0, valueStart) : valueStart;
  const end = wrap ? Math.min(layoutW, valueEnd) : valueEnd;
  if (end > start) {
    nodeGraphGlLinesRect(batch, x + start * zoom, y, (end - start) * zoom, h, fill);
  }
  if (!wrap) return;
  const portalLeft = nodeGraphGlGraphCssPx(readout, "--portal-left-width");
  const portalRight = nodeGraphGlGraphCssPx(readout, "--portal-right-width");
  if (portalLeft > 0) {
    nodeGraphGlLinesRect(batch, x, y, Math.min(layoutW, portalLeft) * zoom, h, fill);
  }
  if (portalRight > 0) {
    const width = Math.min(layoutW, portalRight);
    nodeGraphGlLinesRect(batch, x + (layoutW - width) * zoom, y, width * zoom, h, fill);
  }
}

function nodeGraphGlGraphWrapTextBoxLine(text, maxW, px, family, weight) {
  const str = String(text ?? "");
  const measure = (s) => (typeof nodeGraphGlLinesMeasureText === "function"
    ? nodeGraphGlLinesMeasureText(s, px, family, weight)
    : s.length * px * 0.58);
  if (!str) return [""];
  if (!(maxW > 8) || measure(str) <= maxW) return [str];
  const out = [];
  let line = "";
  for (const ch of str) {
    const next = line + ch;
    if (line && measure(next) > maxW) {
      out.push(line);
      line = ch === " " ? "" : ch;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function nodeGraphGlGraphDrawTextBox(batch, plate, toX, toY, zoom, cssW, cssH) {
  if (!batch || !plate?.textBox) return;
  const x = toX(plate.x);
  const y = toY(plate.y);
  const w = plate.w * zoom;
  const h = plate.h * zoom;
  if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) return;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(plate.id) : null;
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
  const field = el?.querySelector?.(".node-text-box-input");
  if (field && (document.activeElement === field || field.contains(document.activeElement))) {
    return;
  }
  const layout = typeof normalizeNodeGraphTextBoxLayout === "function"
    ? normalizeNodeGraphTextBoxLayout(node?.layout)
    : node?.layout || {};
  const text = String(layout.text ?? "");
  if (!text && layout.backgroundAlpha === 0) return;
  const grid = Number.parseFloat(
    getComputedStyle(document.getElementById("nodeGraphWorkspace") || document.documentElement)
      .getPropertyValue("--node-grid-size"),
  ) || 28;
  const family = typeof nodeGraphTextBoxFontFamily === "function"
    ? nodeGraphTextBoxFontFamily(layout.font)
    : "Cascadia Mono, Consolas, monospace";
  const weight = Math.max(100, Math.min(900, Number(layout.textWeight) || 400));
  const px = Math.max(6, grid * 0.36 * ((Number(layout.textSizePercent) || 100) / 100) * zoom);
  const lineH = Math.max(0.5, Number(layout.lineHeight) || 1.2);
  const newH = Math.max(0.5, Number(layout.newLineHeight) || lineH);
  const align = layout.horizontalAlign === "left" || layout.horizontalAlign === "right"
    ? layout.horizontalAlign
    : "center";
  const ink = nodeGraphGlGraphParseCssColor(layout.textColor, [0.95, 0.94, 0.92, 1]);
  const paragraphs = String(text).split("\n");
  const lines = [];
  for (let p = 0; p < paragraphs.length; p += 1) {
    const wrapped = nodeGraphGlGraphWrapTextBoxLine(paragraphs[p], w, px, family, weight);
    for (let i = 0; i < wrapped.length; i += 1) {
      lines.push({ text: wrapped[i], gap: i === 0 && p > 0 ? newH : lineH });
    }
  }
  const t = ((Number(layout.verticalAlignPercent) || 50) - 50) / 50;
  const offset = t * h * 2;
  let yy = y + offset + px * 0.5;
  const ax = align === "left" ? x : (align === "right" ? x + w : x + w * 0.5);
  if (typeof nodeGraphGlLinesText !== "function") return;
  for (let i = 0; i < lines.length; i += 1) {
    if (i) yy += px * lines[i].gap;
    if (yy < y - px || yy > y + h + px) continue;
    nodeGraphGlLinesText(batch, lines[i].text, ax, yy, nodeGraphGlGraphTextOpts({
      px,
      rgba: ink,
      align,
      baseline: "middle",
      weight,
      family,
      maxWidth: w,
    }));
  }
}

function nodeGraphGlGraphDrawPlate(batch, plate, toX, toY, zoom, cssW, cssH, plateStyle, borderOn, borderIdle) {
  const x = toX(plate.x);
  const y = toY(plate.y);
  const w = plate.w * zoom;
  const h = plate.h * zoom;
  if (!batch?.camera) {
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) return;
  }
  const strokeW = Number.parseFloat(plateStyle.getPropertyValue("--node-module-idle-stroke-width")) || 1;
  const edge = strokeW * zoom;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const w0 = Math.max(1, Math.round(w));
  const h0 = Math.max(1, Math.round(h));
  const selected = typeof nodeGraphNodeElement === "function"
    && nodeGraphNodeElement(plate.id)?.classList.contains("selected");
  const color = selected ? borderOn : borderIdle;
  const plateJacks = [];
  const allJacks = nodeGraphGlGraphState.chrome?.jacks || [];
  for (let j = 0; j < allJacks.length; j += 1) {
    const jack = allJacks[j];
    if (jack.id !== plate.id || jack.rail) continue;
    plateJacks.push({
      x: toX(jack.x),
      y: toY(jack.y),
      r: jack.r * zoom,
      rgba: jack.rgba,
      square: jack.square === true,
      inlet: jack.inlet === true,
    });
  }
  if (typeof nodeGraphGlLinesModuleOutline === "function") {
    const cuts = typeof nodeGraphModuleRailBorderCuts === "function" ? nodeGraphModuleRailBorderCuts(batch, plate, toX, toY, zoom) : null;
    nodeGraphGlLinesModuleOutline(batch, x0, y0, w0, h0, edge, color, plateJacks, plate.fill, cuts);
  }
}

function nodeGraphGlGraphDrawOver(batch, draw) {
  if (!batch) return;
  batch._over = true;
  draw();
  batch._over = false;
}

function nodeGraphGlGraphSeedCell(el, toX, toY, zoom) {
  const box = nodeGraphGlGraphWorldBox(el);
  if (!box) return null;
  return { x: toX(box.x), y: toY(box.y), w: box.w * zoom, h: box.h * zoom };
}

function nodeGraphGlGraphDrawSeedBar(batch, cx, cy, w, h, ink) {
  nodeGraphGlLinesRect(batch, cx - w * 0.5, cy - h * 0.5, w, h, ink);
}

function nodeGraphGlGraphDrawSeedDie(batch, cell, ink) {
  const side = Math.min(cell.w, cell.h) * 0.62;
  const stroke = Math.max(1, Math.min(cell.w, cell.h) * 0.07);
  const x = cell.x + (cell.w - side) * 0.5;
  const y = cell.y + (cell.h - side) * 0.5;
  nodeGraphGlLinesRect(batch, x, y, side, stroke, ink);
  nodeGraphGlLinesRect(batch, x, y + side - stroke, side, stroke, ink);
  nodeGraphGlLinesRect(batch, x, y, stroke, side, ink);
  nodeGraphGlLinesRect(batch, x + side - stroke, y, stroke, side, ink);
  const r = side * 0.08;
  const pips = [
    [0.24, 0.24], [0.76, 0.24], [0.5, 0.5], [0.24, 0.76], [0.76, 0.76],
  ];
  if (typeof nodeGraphGlLinesDot !== "function") return;
  for (let i = 0; i < pips.length; i += 1) {
    nodeGraphGlLinesDot(batch, x + side * pips[i][0], y + side * pips[i][1], r, 0.7, ink);
  }
}

function nodeGraphGlGraphDrawSeeds(batch, toX, toY, zoom, cssW, cssH) {
  const seeds = nodeGraphGlGraphState.chrome?.seeds || [];
  if (!seeds.length) return;
  const line = nodeGraphGlGraphState.chrome?.seedLine || [0.23, 0.26, 0.28, 1];
  // World boxes come from the rebuild (no layout reads per present).
  const cell = (box) => (box ? { x: toX(box.x), y: toY(box.y), w: box.w * zoom, h: box.h * zoom } : null);
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    const host = cell(seed);
    if (!host || nodeGraphGlGraphOutside(host.x, host.y, host.w, host.h, cssW, cssH)) continue;
    const valueEl = seed.valueEl;
    const { dice, plus, minus } = seed;
    const valueCell = cell(seed.readoutBox);
    const diceCell = cell(seed.diceBox);
    const plusCell = cell(seed.plusBox);
    const minusCell = cell(seed.minusBox);
    const hoverCell = (dice?.matches?.(":hover") && diceCell)
      || (plus?.matches?.(":hover") && plusCell)
      || (minus?.matches?.(":hover") && minusCell)
      || null;
    const text = String(valueEl?.textContent || "").replace(/\s+/g, " ").trim();
    // The seed fit writes an inline size per value; else the rebuild's computed size.
    const cssPx = Number.parseFloat(valueEl?.style?.fontSize || "") || seed.valuePx || 0;
    nodeGraphGlGraphDrawSeedWidget(batch, { host, value: valueCell, dice: diceCell, plus: plusCell, minus: minusCell }, text, zoom, { hoverCell, cssPx, line });
  }
}

/**
 * The one seed widget: [code][die][+][-] (screen px cells). Every seed /
 * random control draws through this (param rows and hand-written faces).
 */
function nodeGraphGlGraphDrawSeedWidget(batch, cells, text, zoom, opts = {}) {
  const ink = [0.98, 0.992, 1, 0.92];
  const well = [0.031, 0.043, 0.051, 1];
  const line = opts.line || nodeGraphGlGraphState.chrome?.seedLine || [0.23, 0.26, 0.28, 1];
  const hover = [1, 1, 1, 0.08];
  const { host, value: valueCell, dice: diceCell, plus: plusCell, minus: minusCell } = cells;
  const hoverCell = opts.hoverCell || null;
  const cssPx = opts.cssPx || 0;
  nodeGraphGlGraphDrawOver(batch, () => {
    nodeGraphGlLinesRect(batch, host.x, host.y, host.w, host.h, well);
    const stroke = Math.max(1, zoom);
    nodeGraphGlLinesRect(batch, host.x, host.y, host.w, stroke, line);
    nodeGraphGlLinesRect(batch, host.x, host.y + host.h - stroke, host.w, stroke, line);
    nodeGraphGlLinesRect(batch, host.x, host.y, stroke, host.h, line);
    nodeGraphGlLinesRect(batch, host.x + host.w - stroke, host.y, stroke, host.h, line);
    const split = (cell) => {
      if (!cell) return;
      nodeGraphGlLinesRect(batch, cell.x, cell.y, stroke, cell.h, line);
    };
    split(diceCell);
    split(plusCell);
    split(minusCell);
    if (hoverCell) {
      nodeGraphGlLinesRect(batch, hoverCell.x, hoverCell.y, hoverCell.w, hoverCell.h, hover);
    }
    if (diceCell) nodeGraphGlGraphDrawSeedDie(batch, diceCell, ink);
    const bar = (cell, cross) => {
      if (!cell) return;
      const t = Math.max(1, Math.min(cell.w, cell.h) * 0.09);
      const len = Math.min(cell.w, cell.h) * 0.62;
      const cx = cell.x + cell.w * 0.5;
      const cy = cell.y + cell.h * 0.5;
      nodeGraphGlGraphDrawSeedBar(batch, cx, cy, len, t, ink);
      if (cross) nodeGraphGlGraphDrawSeedBar(batch, cx, cy, t, len, ink);
    };
    bar(minusCell, false);
    bar(plusCell, true);
  });
  if (text && valueCell && typeof nodeGraphGlLinesText === "function") {
    const pad = Math.max(2, valueCell.h * 0.12) + 4 * zoom;
    const fillPx = Math.max(
      6,
      Math.min((valueCell.h - pad * 2) / 0.78, (valueCell.w - pad * 2) / Math.max(1, text.length) / 0.58),
    );
    nodeGraphGlLinesText(batch, text, valueCell.x + valueCell.w * 0.5, valueCell.y + valueCell.h * 0.5, nodeGraphGlGraphTextOpts({
      px: Math.max(6, Math.min(cssPx > 4 ? cssPx * zoom : fillPx, fillPx)),
      rgba: ink,
      align: "center",
      baseline: "middle",
      weight: 600,
      family: "Consolas, \"Courier New\", monospace",
    }));
  }
}

function nodeGraphGlGraphDrawChrome(batch, toX, toY, zoom, cssW, cssH) {
  const chrome = nodeGraphGlGraphState.chrome;
  if (!chrome) return;
  const ink = [1, 1, 1, 1];
  const well = [0.031, 0.043, 0.051, 1];
  const valueFill = [0.27, 0.64, 1, 0.9];
  const ghostHost = document.getElementById("nodeGraphWorkspace");
  const hideGhost = ghostHost?.classList.contains("hide-slider-position");
  const ghostFill = chrome.ghostFill || [0.78, 0.55, 1, 0.38];
  const sliders = chrome.sliders || [];
  for (let i = 0; i < sliders.length; i += 1) {
    const slider = sliders[i];
    const screen = nodeGraphGlGraphScreenRect(slider.id, {
      x: slider.x, y: slider.y, w: slider.w, h: slider.h,
    }, toX, toY, zoom);
    const x = screen.x;
    const y = screen.y;
    const w = screen.w;
    const h = screen.h;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    if (slider.readout?.closest?.(".node-seed-control, .node-parameter-row-seed")) {
      continue;
    }
    nodeGraphGlGraphDrawOver(batch, () => {
      nodeGraphGlLinesRect(batch, x, y, w, h, well);
      const readout = slider.readout;
      const divided = readout?.classList?.contains("choices-divided");
      if (divided) {
        const cell = readout.querySelector(".node-choice-debug-cell-fill");
        const fx = Number(cell?.getAttribute("x"));
        const fw = Number(cell?.getAttribute("width"));
        if (fw > 0) {
          nodeGraphGlLinesRect(batch, x + fx * zoom, y, fw * zoom, h, valueFill);
        }
        const dividers = readout.querySelectorAll(".node-choice-debug-divider");
        const line = [0.62, 0.64, 0.66, 0.55];
        for (let d = 0; d < dividers.length; d += 1) {
          const dx = Number(dividers[d].getAttribute("x1"));
          if (!Number.isFinite(dx)) continue;
          nodeGraphGlLinesRect(batch, x + dx * zoom, y, Math.max(1, 0.5 * zoom), h, line);
        }
        nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill);
        return;
      }
      // Position handle only. Wraparound clips it to the track and draws the
      // overflow on the other edge.
      nodeGraphGlGraphDrawSliderHandle(batch, readout, x, y, h, zoom, slider.w, valueFill);
      nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill);
    });
    if (typeof nodeGraphGlLinesText === "function") {
      const labelText = String(slider.labelEl?.textContent || "").replace(/\s+/g, " ").trim();
      const valueText = String(slider.valueEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (labelText && slider.labelBox && slider.labelAnchor) {
        nodeGraphGlLinesText(
          batch,
          labelText,
          toX(slider.labelAnchor.x),
          toY(slider.labelBox.y + slider.labelBox.h * 0.5),
          nodeGraphGlGraphTextOpts({
            px: Math.max(8, (slider.labelPx || 12.6) * zoom),
            rgba: ink,
            align: slider.labelAnchor.align,
            baseline: "middle",
            weight: 400,
          }),
        );
      }
      if (valueText && slider.valueBox && slider.valueAnchor) {
        nodeGraphGlLinesText(
          batch,
          valueText,
          toX(slider.valueAnchor.x),
          toY(slider.valueBox.y + slider.valueBox.h * 0.5),
          nodeGraphGlGraphTextOpts({
            px: Math.max(8, (slider.valuePx || 13.8) * zoom),
            rgba: ink,
            align: slider.valueAnchor.align,
            baseline: "middle",
            weight: 400,
          }),
        );
      }
      const unitText = String(slider.unitEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (unitText && slider.unitBox && slider.unitAnchor && !slider.unitEl.classList.contains("is-empty")) {
        const unitInk = slider.unitInk || [127 / 255, 199 / 255, 217 / 255, 1];
        nodeGraphGlLinesText(
          batch,
          unitText,
          toX(slider.unitAnchor.x),
          toY(slider.unitBox.y + slider.unitBox.h * 0.5),
          nodeGraphGlGraphTextOpts({
            px: Math.max(8, (slider.unitPx || 11) * zoom),
            rgba: unitInk,
            align: slider.unitAnchor.align,
            baseline: "middle",
            weight: 400,
          }),
        );
      }
    }
  }
  nodeGraphGlGraphDrawSeeds(batch, toX, toY, zoom, cssW, cssH);
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
    if (title.fill && title.box && typeof nodeGraphGlLinesRect === "function") {
      const screen = nodeGraphGlGraphScreenRect(title.id, title.box, toX, toY, zoom);
      const bx = screen.x;
      const by = screen.y;
      const bw = screen.w;
      const bh = screen.h;
      nodeGraphGlGraphDrawOver(batch, () => {
        nodeGraphGlLinesRect(batch, bx, by, bw, bh, title.fill);
      });
    }
    if (title.el?.dataset?.titleEditing === "1") continue;
    const text = String(title.el?.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || typeof nodeGraphGlLinesText !== "function") continue;
    const tx = toX(title.x);
    const ty = toY(title.y);
    if (nodeGraphGlGraphOutside(tx, ty, 0, 0, cssW, cssH, 480)) continue;
    const chars = Math.max(1, text.length);
    const fit = Math.min(title.h * 0.62, (title.box?.w || title.h) / chars / 0.62);
    const room = Math.max(8, ((title.box?.w || 0) - 12) * zoom);
    nodeGraphGlLinesText(batch, text, tx, ty, nodeGraphGlGraphTextOpts({
      px: Math.max(8, fit * zoom),
      maxWidth: room,
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
    nodeGraphGlGraphDrawOver(batch, () => nodeGraphGlLinesRect(batch, x, y, w, h, down ? keyDown : keyIdle));
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
    nodeGraphGlGraphDrawOver(batch, () => {
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
    });
  }
}

function nodeGraphGlGraphDrawVeils(batch, toX, toY, zoom) {
  if (!batch || typeof nodeGraphGlLinesVeil !== "function") return;
  const plates = nodeGraphGlGraphState.plates || [];
  for (let i = 0; i < plates.length; i += 1) {
    const plate = plates[i];
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
    if (!el) continue;
    const veiled = el.classList.contains("bypassed")
      || el.querySelector(":scope > .node-module-under-construction");
    if (!veiled) continue;
    nodeGraphGlLinesVeil(batch, toX(plate.x), toY(plate.y), plate.w * zoom, plate.h * zoom, 18 * zoom);
  }
}

function nodeGraphGlGraphDrawButtonCaptions(batch, toX, toY, zoom, cssW, cssH) {
  if (!batch || typeof nodeGraphGlLinesText !== "function") return;
  const buttons = (nodeGraphGlGraphState.view?.host || document)
    .querySelectorAll(".node-plugin-momentary-button, .node-plugin-toggle-button");
  for (let i = 0; i < buttons.length; i += 1) {
    const button = buttons[i];
    const caption = String(button.dataset.glCaption || "").replace(/\s+/g, " ").trim();
    if (!caption) continue;
    const box = nodeGraphGlGraphWorldBox(button);
    if (!box) continue;
    const x = toX(box.x);
    const y = toY(box.y);
    const w = box.w * zoom;
    const h = box.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH, 480)) continue;
    const px = Math.min(h * 0.42, w * 0.5);
    nodeGraphGlLinesText(batch, caption, x + w * 0.5, y + h * 0.5, nodeGraphGlGraphTextOpts({
      px: Math.max(8, px),
      maxWidth: Math.max(8, w * 0.86),
      rgba: nodeGraphGlGraphCssColor(button.dataset.glCaptionColor || "#ffffff"),
      align: "center",
      baseline: "middle",
      weight: 400,
    }));
  }
}

function nodeGraphGlGraphCubic(ax, ay, bx, by, steps, departSign = 1) {
  const curve = typeof nodeGraphWireCurve === "function" ? nodeGraphWireCurve() : 1;
  const span = Math.min(
    96,
    (Math.abs(bx - ax) * 0.48 + Math.abs(by - ay) * 0.12) * (Number(curve) || 1),
  );
  // Outlets leave to the right. Inlets leave to the left, out of the module.
  const sign = departSign < 0 ? -1 : 1;
  const c1x = ax + sign * span;
  const c1y = ay;
  const c2x = bx - sign * span;
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
  const style = typeof normalizeNodeGraphWireType === "function"
    ? normalizeNodeGraphWireType(wire?.wireType)
    : (wire?.wireType === "trace" ? "trace" : "ribbon");
  if (style === "trace") {
    const routed = typeof nodeGraphTraceOrthogonalPoints === "function"
      ? nodeGraphTraceOrthogonalPoints({ x: ax, y: ay }, trace || [], { x: bx, y: by })
      : null;
    const pts = routed && routed.length >= 2 ? routed : [{ x: ax, y: ay }, { x: bx, y: by }];
    const xy = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i += 1) {
      xy[i * 2] = Number(pts[i].x);
      xy[i * 2 + 1] = Number(pts[i].y);
    }
    return xy;
  }
  const screenLen = Math.hypot((bx - ax) * zoom, (by - ay) * zoom);
  const steps = Math.max(8, Math.min(32, Math.ceil(screenLen / 8)));
  const depart = Number(from?.departSign) < 0 ? -1 : 1;
  return nodeGraphGlGraphCubic(ax, ay, bx, by, steps, depart);
}

function nodeGraphGlGraphDragFrom(point, endpoint) {
  if (!point) return point;
  const io = endpoint?.io;
  if (io && io !== "output") {
    return { x: point.x, y: point.y, departSign: -1 };
  }
  return point;
}

function nodeGraphGlGraphPushWire(wires, from, to, color, zoom, wire, squareFrom, squareTo, kind, index, railFrom = false, railTo = false, toColor = "") {
  if (!from || !to) return;
  const ax = Number(from.x);
  const ay = Number(from.y);
  const bx = Number(to.x);
  const by = Number(to.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return;
  }
  // Wire colour (single source): the IN (destination) jack decides it, via
  // nodeGraphPortWireColor (mod inlet purple, ...); source colour only when
  // there is no destination colour (drag / port-connection previews). Param
  // wires keep the start/end pair (both the destination colour) so the
  // gradient dip still darkens their middle.
  const rgba = nodeGraphGlGraphCssColor(toColor || color);
  const rgbaFrom = rgba;
  const rgbaTo = rgba;
  wires.push({
    rgba: rgbaFrom,
    rgbaEnd: railFrom || railTo ? rgbaTo : null,
    kind: kind || "",
    style: typeof normalizeNodeGraphWireType === "function"
      ? normalizeNodeGraphWireType(wire?.wireType)
      : "ribbon",
    index: Number.isInteger(index) ? index : -1,
    xy: nodeGraphGlGraphShape(from, to, wire, zoom),
    // A param wire (an end on a rail IO box) has its own width and a tiny
    // round end dot where it meets the box.
    param: railFrom === true || railTo === true,
    dots: [
      { x: ax, y: ay, rgba: rgbaFrom, square: !railFrom && squareFrom === true, param: railFrom === true },
      { x: bx, y: by, rgba: rgbaTo, square: !railTo && squareTo === true, param: railTo === true },
    ],
  });
}

function nodeGraphGlGraphRebuild(options = {}) {
  nodeGraphGlGraphState.gen = (nodeGraphGlGraphState.gen || 0) + 1;
  const lite = options.lite === true;
  const wires = [];
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const rail = (node, param) => typeof nodeGraphModuleRailOwnsParam === "function"
    && nodeGraphModuleRailOwnsParam(node, param);
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
        wires, from, to, fromColor, zoom, connection,
        square(connection.sourceNode, connection.sourcePort, "output"),
        square(connection.destinationNode, connection.destinationPort, "input"),
        "signal",
        i,
        rail(connection.sourceNode, connection.sourcePort),
        false,
        colorOf(connection.destinationNode, connection.destinationPort, "input"),
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
        wires, from, to, fromColor, zoom, modulation,
        square(modulation.sourceNode, modulation.sourcePort, "output"),
        square(modulation.destinationNode, modulation.destinationParam, "modulation"),
        "modulation",
        i,
        rail(modulation.sourceNode, modulation.sourcePort),
        rail(modulation.destinationNode, modulation.destinationParam),
        colorOf(modulation.destinationNode, modulation.destinationParam, "modulation"),
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
        wires, from, to, fromColor, zoom, graphConnection,
        square(graphConnection.sourceNode, graphConnection.sourcePort, "output"),
        false,
        "graph",
        i,
      );
    }
    const endpointColor = (endpoint) => {
      if (!endpoint) return "#ffffff";
      const port = endpoint.port || endpoint.param || endpoint.graphInput || "";
      return colorOf(endpoint.node, port, endpoint.io) || "#ffffff";
    };
    const drag = nodeGraphMvp.wireDragging;
    if (drag?.active && drag.from && drag.cursorPoint) {
      const dragColor = endpointColor(drag.endpoint);
      nodeGraphGlGraphPushWire(
        wires,
        nodeGraphGlGraphDragFrom(drag.from, drag.endpoint),
        drag.cursorPoint,
        dragColor,
        zoom,
        null,
        false,
        false,
      );
    }
    const mode = nodeGraphMvp.portConnectionMode;
    if (mode?.cursorPoint && mode.selected && typeof mode.selected.values === "function") {
      for (const entry of mode.selected.values()) {
        if (entry?.from) {
          const modeColor = mode.interactColor || endpointColor(entry.endpoint);
          nodeGraphGlGraphPushWire(
            wires,
            nodeGraphGlGraphDragFrom(entry.from, entry.endpoint),
            mode.cursorPoint,
            modeColor,
            zoom,
            null,
            false,
            false,
          );
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

function nodeGraphGlGraphConstraintMarksAllowed() {
  const body = document.body;
  if (!body || body.classList.contains("node-screen-solo-active")) return false;
  if (body.classList.contains("keyboard-debug-hidden") && !body.classList.contains("constraint-guide-visible")) {
    return false;
  }
  return true;
}

const NODE_GRAPH_CONSTRAINT_INK = {
  cpu: [240 / 255, 179 / 255, 95 / 255, 1],
  ram: [95 / 255, 199 / 255, 238 / 255, 1],
  gpu: [192 / 255, 131 / 255, 255 / 255, 1],
};

function nodeGraphGlGraphDrawConstraintBadges(batch, toX, toY, zoom, cssW, cssH) {
  if (!batch || !nodeGraphGlGraphConstraintMarksAllowed()) return;
  const marks = nodeGraphGlGraphState.chrome?.constraints || [];
  const bodyClasses = document.body.classList;
  for (let i = 0; i < marks.length; i += 1) {
    const box = marks[i].box;
    const keys = marks[i].keys.filter((key) =>
      NODE_GRAPH_CONSTRAINT_INK[key] && bodyClasses.contains(`node-constraint-${key}-active`));
    if (!keys.length) continue;
    const s = zoom > 0 ? zoom : 1;
    let right = box.x + box.w - 4;
    for (let k = keys.length - 1; k >= 0; k -= 1) {
      const key = keys[k];
      const label = key.toUpperCase();
      const bwWorld = 10 + label.length * 6;
      const bhWorld = 12;
      right -= bwWorld;
      const ink = NODE_GRAPH_CONSTRAINT_INK[key];
      const fill = [ink[0] * 0.28 + 0.02, ink[1] * 0.28 + 0.02, ink[2] * 0.28 + 0.03, 0.94];
      const x = toX(right);
      const y = toY(box.y + 3);
      const bw = bwWorld * s;
      const bh = bhWorld * s;
      if (nodeGraphGlGraphOutside(x, y, bw, bh, cssW, cssH)) {
        right -= 2;
        continue;
      }
      nodeGraphGlLinesRect(batch, x - 1, y - 1, bw + 2, bh + 2, ink);
      nodeGraphGlLinesRect(batch, x, y, bw, bh, fill);
      if (typeof nodeGraphGlLinesText === "function") {
        nodeGraphGlLinesText(batch, label, x + bw * 0.5, y + bh * 0.5, nodeGraphGlGraphTextOpts({
          px: Math.max(8, 9 * s),
          rgba: ink,
          align: "center",
          baseline: "middle",
          weight: 700,
        }));
      }
      right -= 2;
    }
  }
}

function nodeGraphGlConstraintGuidePresent() {
  // A screen HUD, not camera content. It reads its own layout, so never
  // mid-gesture: mark it and redraw on the settle rebuild (ZP-6).
  if (typeof nodeGraphHtmlFrozen === "function" && nodeGraphHtmlFrozen()) {
    nodeGraphGlGraphState.guideDirty = true;
    return;
  }
  nodeGraphGlGraphState.guideDirty = false;
  const guide = document.querySelector(".node-constraint-color-guide");
  if (!guide || typeof nodeGraphGlLinesBegin !== "function") return;
  guide.classList.add("gl-constraint-hits");
  let canvas = document.getElementById("nodeGlConstraintHud");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "nodeGlConstraintHud";
    canvas.className = "node-gl-constraint-hud";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
  }
  const hidden = !nodeGraphGlGraphConstraintMarksAllowed()
    || getComputedStyle(guide).display === "none";
  canvas.hidden = hidden;
  if (hidden) return;
  const width = Math.max(1, Math.ceil(guide.offsetWidth));
  const height = Math.max(1, Math.ceil(guide.offsetHeight));
  const host = document.getElementById("nodeGraphWorkspace");
  const hostRect = host?.getBoundingClientRect();
  const left = hostRect ? hostRect.left + Math.max(0, (hostRect.width - width) * 0.5) : 8;
  const top = hostRect ? Math.max(8, hostRect.bottom - height - 8) : 8;
  guide.style.left = `${left}px`;
  guide.style.top = `${top}px`;
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const batch = nodeGraphGlLinesBegin(canvas, [0.012, 0.02, 0.027, 0.86], {
    scale: 1,
    transparent: true,
    camera: { x: 0, y: 0, zoom: 1 },
  });
  if (!batch) return;
  const stacks = guide.querySelectorAll(".node-constraint-stack");
  for (let i = 0; i < stacks.length; i += 1) {
    const stack = stacks[i];
    const key = stack.getAttribute("data-constraint-stack") || "cpu";
    const ink = NODE_GRAPH_CONSTRAINT_INK[key] || [1, 1, 1, 1];
    const parts = stack.querySelectorAll(".node-constraint-chip, .node-constraint-metrics");
    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p];
      if (getComputedStyle(part).display === "none") continue;
      const box = part.getBoundingClientRect();
      const x = box.left - left;
      const y = box.top - top;
      if (!(box.width > 1) || !(box.height > 1)) continue;
      const checked = Boolean(part.querySelector("input")?.checked);
      const mix = checked ? 0.42 : 0.16;
      const fill = [ink[0] * mix + 0.02, ink[1] * mix + 0.02, ink[2] * mix + 0.03, 0.92];
      nodeGraphGlLinesRect(batch, x, y, box.width, box.height, fill);
      const text = String(part.textContent || "").replace(/\s+/g, " ").trim();
      if (text && typeof nodeGraphGlLinesText === "function") {
        nodeGraphGlLinesText(batch, text, x + box.width * 0.5, y + box.height * 0.5, nodeGraphGlGraphTextOpts({
          px: 11,
          rgba: ink,
          align: "center",
          baseline: "middle",
          weight: 700,
        }));
      }
    }
  }
  nodeGraphGlLinesEnd(batch, "alpha");
}

// Replay the cached mesh with the live camera (ZP-2 / ZP-3). Face quads in it
// sample each face's GPU texture (picture-device face textures), so a replay
// shows the latest display frame with no rebuild, no CSS reads and no upload.
// layers: "all" (gesture) or "dots" (a display frame: only the dots layer holds
// face quads). Returns false when there is no valid cached mesh.
function nodeGraphGlGraphReplayMesh(layers = "all") {
  const mesh = nodeGraphGlGraphState.mesh;
  if (!mesh || mesh.gen !== nodeGraphGlGraphState.gen || nodeGraphGlGraphState.view) return false;
  const canvas = nodeGraphGlGraphState.canvas;
  if (!canvas || mesh.w !== canvas.width || mesh.h !== canvas.height) return false;
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return false;
  const zoom = nodeGraphGlGraphZoom();
  const cam = typeof nodeGraphWireCameraViewBox === "function" ? nodeGraphWireCameraViewBox(host) : { x: 0, y: 0 };
  const frameCamera = { x: cam.x, y: cam.y, zoom };
  // Zoom-1 pictures, nearest-neighbour above 2.5x, chosen at replay time.
  const pixelated = zoom > 2.5;
  // mesh.batches: [plates, wires, contacts, dots, veil, trail]. Contacts clear
  // the dots canvas; dots and veil keep, so the dots layer replays as a unit.
  const from = layers === "dots" ? 2 : 0;
  const to = layers === "dots" ? 5 : mesh.batches.length;
  let ok = true;
  for (let i = from; i < to; i += 1) {
    const held = mesh.batches[i];
    if (!held) continue;
    held.camera = frameCamera;
    held.textPixelated = pixelated;
    if (i === 3 && Array.isArray(held.images)) {
      for (const im of held.images) im.nearest = pixelated;
    }
    if (nodeGraphGlLinesEnd(held, held._blend || "alpha") === false) ok = false;
  }
  if (layers !== "dots") {
    mesh.cam = { x: frameCamera.x, y: frameCamera.y, zoom };
    if (typeof nodeGraphPositionGridHtml === "function") nodeGraphPositionGridHtml();
  }
  return ok;
}

// Live scopes painted their face textures. Replay the dots layer, which holds
// the face quads. A full present would rebuild every cable and re-read CSS.
function nodeGraphGlGraphPresentDisplaysOnly() {
  if (nodeGraphGlGraphState.view) return false;
  return nodeGraphGlGraphReplayMesh("dots");
}

function nodeGraphGlGraphPresent(options = {}) {
  // Scope frames must not rebuild cables. A failed stamp leaves the last
  // picture; falling through read the whole workspace and pinned Play at a few fps.
  if (options?.displaysOnly) {
    // No cached mesh yet (first frame, or the patch changed): one full present.
    if (nodeGraphGlGraphPresentDisplaysOnly()) return true;
  }
  const view = nodeGraphGlGraphState.view;
  const host = view ? view.host : document.getElementById("nodeGraphWorkspace");
  if (!host || typeof nodeGraphGlLinesBegin !== "function") return false;
  if (!view) {
    nodeGraphGlGraphPresentTiles();
    // Perform mode hides the workspace: nothing of it is on screen (its modules live in tiles).
    if (!host.clientWidth && document.body?.classList.contains("node-perform-mode")) return true;
    host.classList.add("gl-graph-on");
  }
  if (!view && typeof nodeGraphEnsureTextWireLayers === "function") nodeGraphEnsureTextWireLayers(host);
  const canvas = nodeGraphGlGraphEnsureCanvas(
    host, "canvas", view ? "" : "nodeGlGraphCanvas", "node-gl-graph-canvas",
    view ? ":scope > .dsp-node" : ".node-graph-zoom-surface",
  );
  const wireCanvas = nodeGraphGlGraphEnsureCanvas(
    host, "wireCanvas", view ? "" : "nodeGlGraphWires", "node-gl-graph-wires",
    view ? null : ".node-graph-text-front",
  );
  const dotsCanvas = nodeGraphGlGraphEnsureCanvas(
    host, "dotsCanvas", view ? "" : "nodeGlGraphDots", "node-gl-graph-dots", null,
  );
  // Snake trail is its own overlay so it paints above the mini view (z 8).
  // Pencil PE-4 In-front takes z 7, between mini (6) and this canvas.
  const snakeCanvas = view ? null : nodeGraphGlGraphEnsureCanvas(
    host, "snakeCanvas", "nodeGlGraphSnake", "node-gl-graph-snake", null,
  );
  const cssW = Math.max(1, host.clientWidth || 1);
  const cssH = Math.max(1, host.clientHeight || 1);
  const scale = nodeGraphGlGraphFit(canvas, cssW, cssH);
  nodeGraphGlGraphFit(wireCanvas, cssW, cssH);
  nodeGraphGlGraphFit(dotsCanvas, cssW, cssH);
  if (snakeCanvas) nodeGraphGlGraphFit(snakeCanvas, cssW, cssH);
  const zoom = nodeGraphGlGraphZoom();
  let cam = { x: 0, y: 0 };
  if (view) cam = view.cam;
  else if (typeof nodeGraphWireCameraViewBox === "function") cam = nodeGraphWireCameraViewBox(host);
  const frameCamera = view ? null : { x: cam.x, y: cam.y, zoom };
  nodeGraphGlGraphState.frameCamera = frameCamera;
  const gesturingEarly = typeof nodeGraphViewportGestureActive === "function" && nodeGraphViewportGestureActive();
  // Gesture: camera uniform only. The cached mesh replays and its face quads
  // sample the live face textures, so displays keep running while zooming
  // without a rebuild (display hold stays off).
  if (!view && frameCamera && gesturingEarly && nodeGraphGlGraphReplayMesh("all")) return true;
  const beginOpts = { scale, transparent: true, camera: frameCamera, keepMesh: !view };
  const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], beginOpts);
  const wireBatch = nodeGraphGlLinesBegin(wireCanvas, [0, 0, 0, 0], beginOpts);
  // Contact dots first, as straight coverage, then displays over them.
  const contactBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], beginOpts);
  const dotBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { ...beginOpts, keep: true });
  const veilBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { ...beginOpts, keep: true });
  // Snake select trail on its own canvas. Do not keep: this is the only batch,
  // so the previous stroke must be cleared or each drag sticks forever.
  const trailBatch = view ? null : nodeGraphGlLinesBegin(snakeCanvas, [0, 0, 0, 0], beginOpts);
  if (!batch || !wireBatch || !contactBatch || !dotBatch || !veilBatch || (!view && !trailBatch)) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "GL graph begin");
    return false;
  }
  const gesturing = typeof nodeGraphViewportHoldsDisplays === "function"
    && nodeGraphViewportHoldsDisplays();
  if (!gesturing) nodeGraphGlGraphSettleTextBake();
  let thick = nodeGraphGlGraphState.thick;
  let dotSize = nodeGraphGlGraphState.dotSize;
  if (nodeGraphGlGraphState.thickGen !== nodeGraphGlGraphState.gen || !(thick > 0)) {
    nodeGraphGlGraphState.thickGen = nodeGraphGlGraphState.gen;
    const style = getComputedStyle(host);
    thick = Number.parseFloat(style.getPropertyValue("--node-wire-thickness")) || 2;
    dotSize = Number.parseFloat(style.getPropertyValue("--node-wire-patch-point-size")) || 8;
    nodeGraphGlGraphState.thick = thick;
    nodeGraphGlGraphState.dotSize = dotSize;
    nodeGraphGlGraphState.traceThick = Number.parseFloat(style.getPropertyValue("--node-trace-wire-thickness")) || 1;
    nodeGraphGlGraphState.paramThick = Number.parseFloat(style.getPropertyValue("--node-param-wire-thickness")) || 0.5;
    const paramDot = Number.parseFloat(style.getPropertyValue("--node-param-wire-dot-size"));
    nodeGraphGlGraphState.paramDot = Number.isFinite(paramDot) ? paramDot : 2.012454;
    const gradSpan = Number.parseFloat(style.getPropertyValue("--node-wire-gradient-span"));
    nodeGraphGlGraphState.gradSpan = Number.isFinite(gradSpan) ? Math.min(1, Math.max(0, gradSpan)) : 1;
    const wireDip = Number.parseFloat(style.getPropertyValue("--node-wire-dip"));
    nodeGraphGlGraphState.wireDip = Number.isFinite(wireDip) ? Math.min(1, Math.max(0, wireDip)) : 0.35;
    const wireDipWidth = Number.parseFloat(style.getPropertyValue("--node-wire-dip-width"));
    nodeGraphGlGraphState.wireDipWidth = Number.isFinite(wireDipWidth) ? Math.min(1, Math.max(0, wireDipWidth)) : 0.5;
  }
  // Widths are zoom-1 px. The line shader scales them by the live camera,
  // and the cable fade stays 2 screen px. Traces are a 2px stroke that scales.
  const halfWorld = Math.max(0, thick * 0.5);
  const traceHalf = 1;
  const dotWorld = Math.max(0, dotSize * 0.5);
  const paramHalf = Math.max(0, (nodeGraphGlGraphState.paramThick || 0.5) * 0.5);
  const paramDotWorld = Math.max(0, (nodeGraphGlGraphState.paramDot ?? 0.267) * 0.5);
  const wireFeather = 2;
  const screenX = (x) => (x - cam.x) * zoom;
  const screenY = (y) => (y - cam.y) * zoom;
  // Camera uniform: geometry stays in zoom-1 px. Tiles still project on the CPU.
  const toX = frameCamera ? (x) => x : screenX;
  const toY = frameCamera ? (y) => y : screenY;
  const layoutZoom = frameCamera ? 1 : zoom;

  // Param wires on an open rail end on the drawn IO box's outer edge (same
  // boxes the rail painter draws), snapped here so the two never disagree.
  const railEnds = typeof nodeGraphModuleRailWireEnds === "function"
    ? nodeGraphModuleRailWireEnds(batch, nodeGraphGlGraphState.plates, toX, toY, layoutZoom) : [];
  const railTol = 3 * layoutZoom;
  const railEnd = (x, y) => railEnds.find((e) => Math.abs(e.x - x) <= railTol && Math.abs(e.y - y) <= railTol) || null;
  const pad = 120;
  for (let i = 0; i < nodeGraphGlGraphState.wires.length; i += 1) {
    const wire = nodeGraphGlGraphState.wires[i];
    const src = wire.xy;
    if (!src || src.length < 4) continue;
    let screen = nodeGraphGlGraphState.screen;
    if (screen.length < src.length) {
      screen = new Float32Array(src.length);
      nodeGraphGlGraphState.screen = screen;
    }
    for (let p = 0; p < src.length; p += 2) {
      screen[p] = screenX(src[p]);
      screen[p + 1] = screenY(src[p + 1]);
    }
    // Keep a wire when any segment crosses the view. Endpoint-only culling
    // dropped curves whose ends were offscreen and whose middle was not.
    const left = -pad;
    const top = -pad;
    const right = cssW + pad;
    const bottom = cssH + pad;
    let visible = false;
    for (let p = 2; p < src.length; p += 2) {
      const ax = screen[p - 2];
      const ay = screen[p - 1];
      const bx = screen[p];
      const by = screen[p + 1];
      const minX = ax < bx ? ax : bx;
      const maxX = ax < bx ? bx : ax;
      const minY = ay < by ? ay : by;
      const maxY = ay < by ? by : ay;
      if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) {
        visible = true;
        break;
      }
    }
    if (!visible) continue;
    const style = wire.style === "trace" ? "trace" : "ribbon";
    const strokeWorld = style === "trace" ? traceHalf : (wire.param ? paramHalf : halfWorld);
    const feather = style === "trace" ? 0 : wireFeather;
    let rgba = wire.rgba;
    let picked = false;
    if (wire.kind && wire.index >= 0 && typeof nodeGraphSelectedWireEntries === "function") {
      picked = nodeGraphSelectedWireEntries().some((entry) =>
        (entry.kind || "signal") === wire.kind && Number(entry.index) === wire.index,
      );
      if (picked) {
        rgba = [0.95, 0.86, 0.45, 1];
      }
    }
    const stroke = frameCamera ? strokeWorld : strokeWorld * zoom;
    let pts = frameCamera ? src : screen.subarray(0, src.length);
    if (wire.param && railEnds.length) {
      pts = Float32Array.from(pts);
      for (const ix of [0, pts.length - 2]) {
        const e = railEnd(pts[ix], pts[ix + 1]);
        if (e) { pts[ix] = e.x; pts[ix + 1] = e.y; }
      }
    }
    if (style === "trace") {
      nodeGraphGlLinesPolyline(wireBatch, pts, stroke, feather, rgba, "ortho");
    } else if (typeof nodeGraphGlLinesRibbon !== "function") {
      nodeGraphGlLinesPolyline(wireBatch, pts, stroke, feather, rgba, "butt");
    } else {
      nodeGraphGlLinesRibbon(wireBatch, pts, stroke, feather, rgba, picked ? null : wire.rgbaEnd, nodeGraphGlGraphState.gradSpan ?? 1, nodeGraphGlGraphState.wireDip ?? 0.35, nodeGraphGlGraphState.wireDipWidth ?? 0.5);
    }
    const dots = wire.dots || [];
    const selectedRgba = [0.95, 0.86, 0.45, 1];
    for (let d = 0; d < dots.length; d += 1) {
      const dot = dots[d];
      const dx = screenX(dot.x);
      const dy = screenY(dot.y);
      let dotX = frameCamera ? dot.x : dx;
      let dotY = frameCamera ? dot.y : dy;
      const snapEnd = dot.param && railEnds.length ? railEnd(dotX, dotY) : null;
      if (snapEnd) { dotX = snapEnd.x; dotY = snapEnd.y; }
      const dotHalf = dot.param ? paramDotWorld : dotWorld;
      if (!(dotHalf > 0)) continue;
      const dotReach = frameCamera ? dotHalf : dotHalf * zoom;
      if (dx < -dotReach || dy < -dotReach || dx > cssW + dotReach || dy > cssH + dotReach) continue;
      const dotColor = picked ? selectedRgba : dot.rgba;
      if (dot.square) {
        nodeGraphGlLinesRect(contactBatch, dotX - dotReach, dotY - dotReach, dotReach * 2, dotReach * 2, dotColor);
      } else {
        nodeGraphGlLinesDot(contactBatch, dotX, dotY, dotReach, wireFeather, dotColor);
      }
    }
  }
  // Plate stroke vars: read once per rebuild generation, not per present.
  if (nodeGraphGlGraphState.plateStyleGen !== nodeGraphGlGraphState.gen || !nodeGraphGlGraphState.plateStyle) {
    const cs = getComputedStyle(host);
    const props = {};
    for (const name of ["--node-module-idle-stroke", "--node-module-selected-stroke", "--node-module-idle-stroke-width"]) {
      props[name] = cs.getPropertyValue(name);
    }
    nodeGraphGlGraphState.plateStyle = { getPropertyValue: (name) => props[name] ?? "" };
    nodeGraphGlGraphState.plateStyleGen = nodeGraphGlGraphState.gen;
  }
  const plateStyle = nodeGraphGlGraphState.plateStyle;
  const borderIdle = nodeGraphGlGraphParseCssColor(
    plateStyle.getPropertyValue("--node-module-idle-stroke"),
    [0.631, 0.608, 0.608, 0.9],
  );
  const borderOn = nodeGraphGlGraphParseCssColor(
    plateStyle.getPropertyValue("--node-module-selected-stroke"),
    [0.95, 0.86, 0.45, 1],
  );
  for (let i = 0; i < nodeGraphGlGraphState.plates.length; i += 1) {
    const plate = nodeGraphGlGraphState.plates[i];
    if (plate.onTop) continue;
    nodeGraphGlGraphDrawPlate(batch, plate, toX, toY, layoutZoom, cssW, cssH, plateStyle, borderOn, borderIdle);
  }
  batch.textPixelated = zoom > 2.5;
  nodeGraphGlGraphDrawChrome(batch, toX, toY, layoutZoom, cssW, cssH);
  if (typeof nodeGraphModuleFaceDrawAllGl === "function") {
    nodeGraphModuleFaceDrawAllGl(batch, nodeGraphGlGraphState.plates, toX, toY, layoutZoom, cssW, cssH);
  }
  if (typeof nodeGraphModuleRailsDrawGl === "function") {
    nodeGraphModuleRailsDrawGl(batch, nodeGraphGlGraphState.plates, toX, toY, layoutZoom, cssW, cssH);
  }
  const pixelated = zoom > 2.5;
  for (let i = 0; i < nodeGraphGlGraphState.displays.length; i += 1) {
    const face = nodeGraphGlGraphState.displays[i];
    if (!face.canvas || !(face.w > 0) || !(face.h > 0)) continue;
    const rect = nodeGraphGlGraphDisplayScreenRect(face, toX, toY, layoutZoom);
    const x = rect.x;
    const y = rect.y;
    const w = rect.w;
    const h = rect.h;
    if (!(w > 1) || !(h > 1)) continue;
    if (!frameCamera && (x + w < 0 || y + h < 0 || x > cssW || y > cssH)) continue;
    nodeGraphGlLinesImage(dotBatch, face.canvas, x, y, w, h, {
      nearest: pixelated,
      // Pan/zoom already froze the face pixels. Re-upload only when displays paint.
      cache: gesturing,
      alpha: 1,
    });
  }
  dotBatch.textPixelated = pixelated;
  nodeGraphGlGraphDrawButtonCaptions(dotBatch, toX, toY, layoutZoom, cssW, cssH);
  nodeGraphGlGraphDrawRoundShapes(dotBatch, toX, toY, zoom, Boolean(frameCamera));
  for (let i = 0; i < nodeGraphGlGraphState.plates.length; i += 1) {
    const plate = nodeGraphGlGraphState.plates[i];
    if (!plate.onTop) continue;
    nodeGraphGlGraphDrawPlate(veilBatch, plate, toX, toY, layoutZoom, cssW, cssH, plateStyle, borderOn, borderIdle);
  }
  nodeGraphGlGraphDrawVeils(veilBatch, toX, toY, layoutZoom);
  nodeGraphGlGraphDrawConstraintBadges(veilBatch, toX, toY, layoutZoom, cssW, cssH);
  const outputPaused = typeof nodeGraphLiveEngineIsPaused === "function" && nodeGraphLiveEngineIsPaused();
  if (outputPaused) {
    const white = [1, 1, 1, 1];
    for (let i = 0; i < nodeGraphGlGraphState.displays.length; i += 1) {
      const face = nodeGraphGlGraphState.displays[i];
      if (!face.output || !(face.w > 0) || !(face.h > 0)) continue;
      const rect = nodeGraphGlGraphDisplayScreenRect(face, toX, toY, layoutZoom);
      const x = rect.x;
      const y = rect.y;
      const w = rect.w;
      const h = rect.h;
      if (!frameCamera && (x + w < 0 || y + h < 0 || x > cssW || y > cssH)) continue;
      if (typeof paintNodeGraphOutputPauseBars === "function") {
        paintNodeGraphOutputPauseBars(dotBatch, w, h, { x, y });
      } else {
        const side = Math.min(w, h);
        const fit = Math.max(8, side - Math.max(2, Math.round(side * 0.08)) * 2);
        const barH = Math.max(8, Math.round(fit * 0.52));
        const barW = Math.max(3, Math.round(fit * 0.2));
        const gap = Math.max(2, Math.round(fit * 0.14));
        const x0 = x + Math.round((w - (barW * 2 + gap)) * 0.5);
        const y0 = y + Math.round((h - barH) * 0.5);
        nodeGraphGlLinesRect(dotBatch, x0, y0, barW, barH, white);
        nodeGraphGlLinesRect(dotBatch, x0 + barW + gap, y0, barW, barH, white);
      }
    }
  }
  if (trailBatch) nodeGraphGlGraphDrawTrail(trailBatch, zoom);
  batch._blend = "alpha";
  wireBatch._blend = "alpha";
  contactBatch._blend = "max";
  dotBatch._blend = "alpha";
  veilBatch._blend = "alpha";
  const platesOk = nodeGraphGlLinesEnd(batch, "alpha") !== false;
  const wiresOk = nodeGraphGlLinesEnd(wireBatch, "alpha") !== false;
  const contactOk = nodeGraphGlLinesEnd(contactBatch, "max") !== false;
  const dotsOk = nodeGraphGlLinesEnd(dotBatch, "alpha") !== false;
  const veilOk = nodeGraphGlLinesEnd(veilBatch, "alpha") !== false;
  // "max" stores straight coverage. SRC_ALPHA on this premultipliedAlpha:false
  // blit is multiplied again and leaves a dark edge on a bright picture.
  if (trailBatch) trailBatch._blend = "max";
  const trailOk = !trailBatch || nodeGraphGlLinesEnd(trailBatch, "max") !== false;
  if (!view) {
    nodeGraphGlGraphState.mesh = {
      gen: nodeGraphGlGraphState.gen,
      displayGen: nodeGraphGlGraphState.displayGen || 0,
      w: canvas.width,
      h: canvas.height,
      cam: frameCamera ? { x: frameCamera.x, y: frameCamera.y, zoom: frameCamera.zoom } : null,
      batches: [batch, wireBatch, contactBatch, dotBatch, veilBatch, trailBatch],
    };
  }
  if (typeof nodeGraphPositionGridHtml === "function") nodeGraphPositionGridHtml();
  // The guide HUD changes with the constraint toggles/metrics (they call it
  // directly) and with the layout: once per rebuild here, not per present.
  if (!view && (nodeGraphGlGraphState.guideGen !== nodeGraphGlGraphState.gen || nodeGraphGlGraphState.guideDirty)) {
    nodeGraphGlGraphState.guideGen = nodeGraphGlGraphState.gen;
    nodeGraphGlConstraintGuidePresent();
  }
  return platesOk && wiresOk && contactOk && dotsOk && veilOk && trailOk;
}

/**
 * Perform / layout canvas whole-module tiles: the module was moved out of the (hidden) workspace,
 * so run this same rebuild + present once per tile, mapped onto it (zoom = the tile's fit scale,
 * camera = the module's offset in the tile, that module only, no cables).
 */
function nodeGraphGlGraphPresentTiles() {
  const faces = document.querySelectorAll(".node-layout-canvas-tile > .dsp-node.node-whole-module-face");
  for (let i = 0; i < faces.length; i += 1) nodeGraphGlGraphPresentTile(faces[i]);
}

function nodeGraphGlGraphPresentTile(face) {
  const tile = face?.parentElement;
  const nat = face?._wholeModuleNatural;
  const id = String(face?.dataset?.node || "");
  if (!tile || !id || !(nat?.w > 0) || !(tile.clientWidth > 0) || !(tile.clientHeight > 0)) return;
  const faceRect = face.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  if (!(faceRect.width > 1) || !(tileRect.width > 1)) return;
  const k = faceRect.width / nat.w; // client px per zoom-1 px
  const state = nodeGraphGlGraphState;
  const saved = {
    canvas: state.canvas, dotsCanvas: state.dotsCanvas, wires: state.wires, plates: state.plates,
    displays: state.displays, chrome: state.chrome, thick: state.thick, dotSize: state.dotSize,
  };
  state.view = {
    host: tile,
    ids: new Set([id]),
    zoom: k * (tile.clientWidth / tileRect.width),
    cam: { x: -(faceRect.left - tileRect.left) / k, y: -(faceRect.top - tileRect.top) / k },
    toWorld: (clientX, clientY) => ({ x: (clientX - faceRect.left) / k, y: (clientY - faceRect.top) / k }),
  };
  state.canvas = tile._glGraphCanvas || null;
  state.dotsCanvas = tile._glGraphDots || null;
  state.wires = [];
  try {
    nodeGraphGlGraphRebuildPlates();
    nodeGraphGlGraphPresent();
    tile._glGraphCanvas = state.canvas;
    tile._glGraphDots = state.dotsCanvas;
  } finally {
    state.view = null;
    Object.assign(state, saved);
  }
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

function nodeGraphGlGraphPresentSoon() {
  if (nodeGraphGlGraphPresentSoon._frame) return;
  nodeGraphGlGraphPresentSoon._frame = window.requestAnimationFrame(() => {
    nodeGraphGlGraphPresentSoon._frame = 0;
    nodeGraphGlGraphPresent();
  });
}

/** One displays-only stamp next frame (face textures repainted, nothing else changed). */
function nodeGraphGlGraphPresentDisplaysSoon() {
  if (nodeGraphGlGraphPresentDisplaysSoon._frame) return;
  nodeGraphGlGraphPresentDisplaysSoon._frame = window.requestAnimationFrame(() => {
    nodeGraphGlGraphPresentDisplaysSoon._frame = 0;
    nodeGraphGlGraphPresent({ displaysOnly: true });
  });
}

// Unit-orbit step longer than this is a jump, not a side. It is not stroked.
const NODE_GRAPH_ROUND_ORBIT_JUMP = 0.45;

function nodeGraphGlGraphRoundOrbitRuns(unitPts) {
  const n = unitPts.length;
  if (n < 2) return [];
  const brk = new Array(n);
  let any = false;
  for (let i = 0; i < n; i += 1) {
    const a = unitPts[i];
    const b = unitPts[(i + 1) % n];
    brk[i] = Math.hypot(b.x - a.x, b.y - a.y) > NODE_GRAPH_ROUND_ORBIT_JUMP;
    if (brk[i]) any = true;
  }
  const compact = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const prev = out[out.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.02) continue;
      out.push(p);
    }
    return out;
  };
  if (!any) return [{ closed: true, pts: compact(unitPts) }];
  let start = 0;
  for (let i = 0; i < n; i += 1) {
    if (brk[i]) {
      start = (i + 1) % n;
      break;
    }
  }
  const runs = [];
  let cur = [unitPts[start]];
  for (let k = 0; k < n; k += 1) {
    const i = (start + k) % n;
    const j = (i + 1) % n;
    if (brk[i]) {
      const packed = compact(cur);
      if (packed.length) runs.push({ closed: false, pts: packed });
      cur = [];
    }
    if (k < n - 1) cur.push(unitPts[j]);
  }
  const tail = compact(cur);
  if (tail.length) runs.push({ closed: false, pts: tail });
  return runs;
}

/**
 * RoundShape orbit. Continuous runs are one ribbon. A jump is not stroked:
 * a run that collapses to a point is a dot, so a full square is four dots.
 */
function nodeGraphGlGraphDrawRoundShapes(batch, toX, toY, zoom, cameraOn) {
  if (!batch || typeof nodeGraphGlLinesPolyline !== "function") return;
  const faces = document.querySelectorAll(".node-round-shape-display");
  const samples = 256;
  for (let i = 0; i < faces.length; i += 1) {
    const section = faces[i];
    if (section.offsetWidth < 8 || section.offsetHeight < 8) continue;
    const nodeEl = section.closest(".dsp-node");
    if (!nodeEl || nodeEl.classList.contains("oscilloscope-hidden") || nodeEl.classList.contains("face-track-omitted")) continue;
    const box = typeof nodeGraphGlGraphWorldBox === "function" ? nodeGraphGlGraphWorldBox(section) : null;
    if (!box || !(box.w > 4) || !(box.h > 4)) continue;
    const id = String(nodeEl.dataset.node || "");
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
    if (!node) continue;
    const isOsc = node.type === "ellipsoidOsc";
    let shape = typeof nodeGraphRoundShapeLiveParam === "function"
      ? Number(nodeGraphRoundShapeLiveParam(node, "morph", 0))
      : Number(node.params?.morph);
    if (!Number.isFinite(shape)) shape = 0;
    shape = Math.max(0, Math.min(1, shape));
    const look = typeof nodeGraphRoundShapeFaceLook === "function"
      ? nodeGraphRoundShapeFaceLook(node)
      : {};
    const strokeW = Math.max(0.25, Number(look.lineThickness) || 2);
    const dotW = Math.max(0.25, Number(look.dotThickness) || 5);
    const bg = nodeGraphGlGraphParseCssColor(look.backgroundPaint || look.background || "#020609", [0.008, 0.024, 0.035, 1]);
    const stroke = nodeGraphGlGraphParseCssColor(look.strokePaint || look.strokeColor || "#7fc7d9", [0.5, 0.86, 0.78, 1]);
    const dotColor = nodeGraphGlGraphParseCssColor(look.dotPaint || look.dotColor || "#ffffff", [1, 1, 1, 1]);
    const scale = cameraOn ? 1 : zoom;
    const x = toX(box.x);
    const y = toY(box.y);
    const w = box.w * scale;
    const h = box.h * scale;
    nodeGraphGlLinesRect(batch, x, y, w, h, bg);
    const pad = Math.max(6, Math.min(box.w, box.h) * 0.08) + strokeW * 0.5 + 1;
    const half = Math.max(4, Math.min(box.w, box.h) * 0.5 - pad);
    const cx = box.w * 0.5;
    const cy = box.h * 0.5;
    const unit = new Array(samples);
    const eps = 0.5 / samples;
    let px = cx;
    let py = cy;
    for (let s = 0; s < samples; s += 1) {
      let phase = s / samples + eps;
      phase -= Math.floor(phase);
      let pt;
      if (isOsc && typeof nodeGraphRoundShapeEllipsoidOscPoint === "function") {
        pt = nodeGraphRoundShapeEllipsoidOscPoint(phase, node);
      } else if (typeof nodeGraphRoundShapeEllipsoidPoint === "function") {
        pt = nodeGraphRoundShapeEllipsoidPoint(phase, shape);
      } else {
        const a = phase * Math.PI * 2;
        pt = { x: Math.cos(a), y: Math.sin(a) };
      }
      unit[s] = {
        x: Number.isFinite(pt.x) ? pt.x : 0,
        y: Number.isFinite(pt.y) ? pt.y : 0,
      };
      if (s === 0) {
        px = cx + unit[s].x * half;
        py = cy - unit[s].y * half;
      }
    }
    const halfStroke = strokeW * 0.5 * (cameraOn ? 1 : scale);
    const feather = cameraOn ? 1.25 : scale;
    const place = (p) => [toX(box.x + cx + p.x * half), toY(box.y + cy - p.y * half)];
    const runs = nodeGraphGlGraphRoundOrbitRuns(unit);
    const cornerDots = [];
    for (let r = 0; r < runs.length; r += 1) {
      const run = runs[r];
      if (run.pts.length < 2) {
        if (run.pts[0]) cornerDots.push(run.pts[0]);
        continue;
      }
      const seq = run.closed ? run.pts.concat([run.pts[0]]) : run.pts;
      const flat = new Float32Array(seq.length * 2);
      for (let p = 0; p < seq.length; p += 1) {
        const at = place(seq[p]);
        flat[p * 2] = at[0];
        flat[p * 2 + 1] = at[1];
      }
      if (typeof nodeGraphGlLinesRibbon === "function") {
        nodeGraphGlLinesRibbon(batch, flat, halfStroke, feather, stroke);
      }
    }
    if (typeof nodeGraphGlLinesDot === "function") {
      const cornerR = halfStroke;
      for (let d = 0; d < cornerDots.length; d += 1) {
        const at = place(cornerDots[d]);
        nodeGraphGlLinesDot(batch, at[0], at[1], cornerR, feather, stroke);
      }
    }
    if (typeof nodeGraphRoundShapeLiveCursor === "function" && !isOsc) {
      const cursor = nodeGraphRoundShapeLiveCursor(id, node, section);
      if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
        px = cx + cursor.x * half;
        py = cy - cursor.y * half;
      }
    } else if (isOsc) {
      const liveX = typeof nodeGraphRoundShapeReadScopePort === "function"
        ? nodeGraphRoundShapeReadScopePort(id, "Left")
        : Number.NaN;
      const liveY = typeof nodeGraphRoundShapeReadScopePort === "function"
        ? nodeGraphRoundShapeReadScopePort(id, "Right")
        : Number.NaN;
      if (Number.isFinite(liveX) && Number.isFinite(liveY)) {
        const amp = Math.max(1e-9, Math.abs(Number(node.params?.amplitude)) || 1);
        px = cx + (liveX / amp) * half;
        py = cy - (liveY / amp) * half;
      } else {
        let phase = typeof nodeGraphRoundShapeReadScopePort === "function"
          ? nodeGraphRoundShapeReadScopePort(id, "__Phase")
          : Number.NaN;
        if (!Number.isFinite(phase) && typeof nodeGraphRoundShapeLiveCursor === "function") {
          const cursor = nodeGraphRoundShapeLiveCursor(id, node, section);
          if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
            px = cx + cursor.x * half;
            py = cy - cursor.y * half;
            phase = Number.NaN;
          }
        }
        if (Number.isFinite(phase) && typeof nodeGraphRoundShapeEllipsoidOscPoint === "function") {
          const pt = nodeGraphRoundShapeEllipsoidOscPoint(phase, node);
          px = cx + pt.x * half;
          py = cy - pt.y * half;
        }
      }
    }
    if (typeof nodeGraphGlLinesDot === "function") {
      nodeGraphGlLinesDot(batch, toX(box.x + px), toY(box.y + py), Math.max(0.5, dotW * 0.5) * scale, Math.max(0.75, scale), dotColor);
    }
  }
}

/**
 * Snake select trail. The centerline is uploaded once. Dash phase, round caps,
 * and the fringe are one fragment shader, in zoom-1 px, so zoom only moves uCam.
 */
function nodeGraphGlGraphDrawTrail(trailBatch) {
  if (!trailBatch || typeof nodeGraphHitTrailAllStrokes !== "function") return;
  if (typeof nodeGraphStrokeSmoothPoints !== "function" || typeof nodeGraphGlLinesDash !== "function") return;
  const strokes = nodeGraphHitTrailAllStrokes();
  if (!strokes.length) return;
  const host = document.getElementById("nodeGraphWorkspace");
  const style = host ? getComputedStyle(host) : null;
  const rgba = nodeGraphGlGraphParseCssColor(
    style?.getPropertyValue("--node-selection-hit-trail-color") || "",
    [0, 208 / 255, 1, 1],
  ).slice();
  const alpha = Number.parseFloat(style?.getPropertyValue("--node-selection-hit-trail-alpha") || "");
  rgba[3] = (rgba[3] ?? 1) * (Number.isFinite(alpha) ? alpha : 0.95);
  for (let i = 0; i < strokes.length; i += 1) {
    const stroke = strokes[i];
    const half = Math.max(0.5, (Number(stroke.width) || 6) * 0.5);
    const dash = Array.isArray(stroke.dash) ? stroke.dash : [14, 11];
    const flat = nodeGraphStrokeSmoothPoints(stroke.points, 4);
    if (flat.length < 4) continue;
    nodeGraphGlLinesDash(trailBatch, flat, half, Math.max(0.5, dash[0]), Math.max(0, dash[1]), rgba);
  }
}

/**
 * Redraw only the trail. Reuses the held mesh for everything else (same path
 * the pan/zoom gesture takes), so a drag does not rebuild plates and wires.
 */
function nodeGraphGlGraphPresentTrail() {
  const state = nodeGraphGlGraphState;
  const mesh = state.mesh;
  const held = mesh?.batches?.[5];
  const camera = held?.camera;
  if (state.view || !mesh || !held || !camera || mesh.gen !== state.gen
    || mesh.w !== held.canvas.width || mesh.h !== held.canvas.height) {
    nodeGraphGlGraphPresentSoon();
    return;
  }
  const trailBatch = nodeGraphGlLinesBegin(held.canvas, [0, 0, 0, 0], {
    scale: held.scale, transparent: true, camera, keepMesh: true,
  });
  if (!trailBatch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(held.canvas);
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(held.canvas, "GL snake trail begin");
    return;
  }
  nodeGraphGlGraphDrawTrail(trailBatch);
  trailBatch._blend = "max";
  mesh.batches[5] = trailBatch;
  for (let i = 0; i < mesh.batches.length; i += 1) {
    const b = mesh.batches[i];
    if (b) nodeGraphGlLinesEnd(b, b._blend || "alpha");
  }
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
    ".node-face, .node-module-graph-face, .node-module-graph-display, .node-keypad-face, .node-knob-face, .node-xy-pad-canvas, .node-sequencer-roll, .acid-seq-face, .node-arp-keys-face, .node-plugin-toggle-button, .node-plugin-momentary-button, .node-sample-waveform-display, .node-midi-keyboard-surface, .node-midi-keyboard-module, .node-grid-keyboard-surface, .node-grid-keyboard-pad, .node-seed-control, [data-key-index]",
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
  let jackHit = null;
  let jackDist = Infinity;
  const jackRadius = typeof nodeGraphJackHitRadiusPx === "function"
    ? nodeGraphJackHitRadiusPx()
    : 8;
  for (let i = 0; i < jacks.length; i += 1) {
    const jack = jacks[i];
    const reach = Math.max(jack.r || 0, jackRadius);
    const dx = jack.x - x;
    const dy = jack.y - y;
    // B-099: square hit box over every jack (nearest center still wins).
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > reach || dist >= jackDist) continue;
    jackDist = dist;
    jackHit = jack;
  }
  if (jackHit) return { kind: "jack", x: jackHit.x, y: jackHit.y, jack: jackHit };
  const labels = chrome.labels || [];
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const label = labels[i];
    if (nodeGraphGlHitInside(x, y, label.box)) {
      return { kind: "label", el: label.el };
    }
  }
  const sliders = chrome.sliders || [];
  for (let i = sliders.length - 1; i >= 0; i -= 1) {
    const slider = sliders[i];
    const sx = slider.hitX ?? slider.x;
    const sy = slider.hitY ?? slider.y;
    const sw = slider.hitW ?? slider.w;
    const sh = slider.hitH ?? slider.h;
    if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) {
      let readout = slider.readout;
      if (readout && !readout.isConnected && typeof nodeSliderResolveLiveReadout === "function") {
        readout = nodeSliderResolveLiveReadout(readout);
      }
      if (!readout?.isConnected && slider.input) {
        readout = slider.input.closest?.("label")?.querySelector?.(".node-slider-readout") || null;
      }
      if (!readout?.isConnected) continue;
      return { kind: "slider", readout };
    }
  }
  const titles = chrome.titles || [];
  for (let i = titles.length - 1; i >= 0; i -= 1) {
    const title = titles[i];
    const box = title.box;
    if (!box) continue;
    const inset = 6;
    if (x >= box.x + inset && x <= box.x + box.w - inset && y >= box.y && y <= box.y + box.h) {
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

function nodeGraphGlHitJackElement(jack) {
  const moduleEl = jack && typeof nodeGraphNodeElement === "function"
    ? nodeGraphNodeElement(jack.id)
    : null;
  if (!moduleEl) return null;
  const name = String(jack.port || "");
  if (!name || typeof CSS === "undefined" || !CSS.escape) {
    return nodeGraphGlHitPortElement(moduleEl, jack.x, jack.y);
  }
  const esc = CSS.escape(name);
  if (jack.kind === "modulation" || jack.io === "modulation") {
    return moduleEl.querySelector(`.node-param-port.modulation-input[data-param="${esc}"]`);
  }
  if (jack.kind === "graph" || jack.io === "graph") {
    return moduleEl.querySelector(`.node-param-port.graph-input[data-graph-input="${esc}"]`);
  }
  if (!jack.signal && jack.kind === "output") {
    return moduleEl.querySelector(`.node-param-port.parameter-output[data-param="${esc}"], .node-param-port.parameter-output[data-port="${esc}"]`)
      || moduleEl.querySelector(`.node-port.output[data-port="${esc}"]`);
  }
  const io = jack.io === "output" ? "output" : "input";
  return moduleEl.querySelector(`.node-port.${io}[data-port="${esc}"]`)
    || nodeGraphGlHitPortElement(moduleEl, jack.x, jack.y);
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

const nodeGraphGlHitState = { lastTitleDown: null, lastMetaDown: null };

function nodeGraphGlHitLabelPort(label) {
  const row = label?.closest?.(".node-io-row, .node-io-column, .node-parameter-row");
  return row?.querySelector?.(".node-port, .node-param-port") || null;
}

/** Parameter row under a client point, using the same world box that scrubs the slider. */
function nodeGraphGlParamRowAtClient(clientX, clientY) {
  if (typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  const point = nodeGraphClientToZoomSurfacePoint(clientX, clientY);
  if (!point) return null;
  const sliders = nodeGraphGlGraphState.chrome?.sliders || [];
  for (let i = sliders.length - 1; i >= 0; i -= 1) {
    const slider = sliders[i];
    const sx = slider.hitX ?? slider.x;
    const sy = slider.hitY ?? slider.y;
    const sw = slider.hitW ?? slider.w;
    const sh = slider.hitH ?? slider.h;
    if (point.x < sx || point.x > sx + sw || point.y < sy || point.y > sy + sh) continue;
    let readout = slider.readout;
    if (readout && !readout.isConnected && typeof nodeSliderResolveLiveReadout === "function") {
      readout = nodeSliderResolveLiveReadout(readout);
    }
    const row = readout?.closest?.(".node-parameter-row")
      || slider.input?.closest?.(".node-parameter-row")
      || null;
    if (row) return row;
  }
  return null;
}

/**
 * An armed wire lands on the parameter control (mod inlet, or the thru when
 * the pending end is an input). The mod jack itself has no box until the
 * rail opens, so the jack hit test cannot take this click.
 * Returns true when the gesture was a wire completion.
 */
function nodeGraphFinishArmedWireOnParamRow(row, event) {
  const mode = nodeGraphMvp?.portConnectionMode;
  if (!row || !mode || mode.movingWires) return false;
  if (event?.ctrlKey || event?.metaKey || (event?.button !== undefined && event.button !== 0)) return false;
  const port = row.querySelector(":scope > .node-param-port.modulation-input")
    || row.querySelector(":scope > .node-param-port.parameter-output");
  const handler = nodeGraphWireInteractions?.handlePortClick;
  if (!port || typeof handler !== "function") return false;
  event.glParamDrop = true;
  handler(nodeGraphGlHitRetarget(event, port));
  return true;
}

function nodeGraphGlHitPointerDown(event) {
  if (event.button !== 0 && event.button !== 2) return;
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
  if (hit.kind === "slider" && hit.readout) {
    const row = hit.readout.closest?.(".node-parameter-row")
      || hit.readout.closest?.("label")?.closest?.(".node-parameter-row");
    if (row && nodeGraphFinishArmedWireOnParamRow(row, event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0 && typeof beginNodeSliderDrag === "function") {
      beginNodeSliderDrag(nodeGraphGlHitRetarget(event, hit.readout));
    }
    return;
  }
  if (hit.kind === "label" && hit.el) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const port = nodeGraphGlHitLabelPort(hit.el);
    const handler = nodeGraphWireInteractions?.handlePortPointerDown;
    if (port && typeof handler === "function") {
      handler(nodeGraphGlHitRetarget(event, port));
    }
    return;
  }
  if (hit.kind === "jack") {
    const port = nodeGraphGlHitJackElement(hit.jack);
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
    const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(hit.id) : null;
    // Overlay pointerdown preventDefault kills native dblclick. Same 400ms
    // repeat as title-edit: second plate hit on a Metamodule/Group enters it.
    if (typeof nodeGraphIsContainerShellType === "function" && nodeGraphIsContainerShellType(patchNode?.type)) {
      const now = performance.now();
      const last = nodeGraphGlHitState.lastMetaDown;
      const repeat = last && last.id === hit.id && now - last.time < 400;
      nodeGraphGlHitState.lastMetaDown = { id: hit.id, time: now };
      if (repeat) {
        event.preventDefault();
        event.stopPropagation();
        const drag = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp.nodeDragging : null;
        if (drag) {
          for (const dragged of drag.draggedNodes || []) {
            dragged.element?.classList?.remove("dragging");
          }
          drag.handle?.classList?.remove("dragging");
          nodeGraphMvp.nodeDragging = null;
        }
        if (typeof enterNodeGraphMetamoduleView === "function") {
          enterNodeGraphMetamoduleView(hit.id);
        }
        nodeGraphGlHitState.lastMetaDown = null;
        return;
      }
    }
    const shell = moduleEl?.querySelector(".node-solid-module-shell, .node-module-chrome-layout-b-shell, .node-header-title-row") || moduleEl;
    if (!shell) return;
    event.preventDefault();
    event.stopPropagation();
    beginNodeGraphNodeDrag(nodeGraphGlHitRetarget(event, shell));
  }
}

function nodeGraphGlHitInside(x, y, box) {
  return Boolean(box) && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function nodeGraphGlHitChromeBoxes(point, list, pick) {
  if (!point || !list || !list.length) return null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    const box = item.box || item;
    if (!nodeGraphGlHitInside(point.x, point.y, box)) continue;
    const el = typeof pick === "function" ? pick(item) : (item.el || item.control || null);
    if (el) return el;
  }
  return null;
}

function nodeGraphGlHitHoverElement(event) {
  const point = nodeGraphGlHitPoint(event);
  if (!point) return null;
  const chrome = nodeGraphGlGraphState.chrome || {};
  const header = nodeGraphGlHitChromeBoxes(point, chrome.headerButtons);
  if (header) return header;
  const seed = nodeGraphGlHitChromeBoxes(point, chrome.seeds, (item) => item.control);
  if (seed) return seed;
  const context = nodeGraphGlHitContextElement(point);
  if (context) return context;
  const wire = nodeGraphGlHitWireAt(point.x, point.y);
  if (!wire) return null;
  if (!nodeGraphGlHitState.wireHoverEl) {
    const el = document.createElement("div");
    el.className = "node-wire-path";
    nodeGraphGlHitState.wireHoverEl = el;
  }
  return nodeGraphGlHitState.wireHoverEl;
}

function nodeGraphGlHitContextElement(point) {
  const chrome = nodeGraphGlGraphState.chrome || {};
  const keys = chrome.keys || [];
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const key = keys[i];
    if (nodeGraphGlHitInside(point.x, point.y, key) && key.el) return key.el;
  }
  const graphs = chrome.graphs || [];
  for (let i = graphs.length - 1; i >= 0; i -= 1) {
    const face = graphs[i];
    if (!nodeGraphGlHitInside(point.x, point.y, face)) continue;
    const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(face.id) : null;
    return moduleEl?.querySelector(".node-module-graph-display") || moduleEl;
  }
  const hit = nodeGraphGlHitTest(point.x, point.y);
  if (!hit) return null;
  if (hit.kind === "slider" && hit.readout) return hit.readout;
  if (hit.kind === "label" && hit.el) return nodeGraphGlHitLabelPort(hit.el) || hit.el;
  if (hit.kind === "title" && hit.el) return hit.el;
  if (hit.kind === "jack") {
    return nodeGraphGlHitJackElement(hit.jack);
  }
  if (hit.kind === "plate") {
    const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(hit.id) : null;
    if (!moduleEl) return null;
    const knob = moduleEl.querySelector(".node-knob-face");
    const knobBox = nodeGraphGlGraphWorldBox(knob);
    if (nodeGraphGlHitInside(point.x, point.y, knobBox)) return knob;
    const face = moduleEl.querySelector(".node-display-canvas, .node-module-scope-canvas, .node-xy-pad-canvas");
    const faceBox = nodeGraphGlGraphWorldBox(face);
    if (nodeGraphGlHitInside(point.x, point.y, faceBox)) return face;
    return moduleEl;
  }
  return null;
}

function nodeGraphGlHitContextMenu(event) {
  if (event.glGraphRetarget) return;
  if (nodeGraphGlHitIsLiveHtml(event.target) || nodeGraphGlHitKeepsNativeTarget(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".node-text-box-body, .node-text-box-input")) return;
  const point = nodeGraphGlHitPoint(event);
  if (!point) return;
  const element = nodeGraphGlHitContextElement(point);
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  const readout = element.closest?.(".node-slider-readout") || (element.classList?.contains("node-slider-readout") ? element : null);
  if (readout && typeof openNodeMetadataPopover === "function") {
    openNodeMetadataPopover(event, readout);
    return;
  }
  const forwarded = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: 2,
    view: window,
  });
  forwarded.glGraphRetarget = true;
  element.dispatchEvent(forwarded);
}

function nodeGraphGlHitPointerUp(event) {
  if (event.button !== 0) return;
  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Cmd+click on a jack toggles its module's selection (handlePortClick).
    const point = nodeGraphGlHitPoint(event);
    const hit = point ? nodeGraphGlHitTest(point.x, point.y) : null;
    const port = hit?.kind === "jack" ? nodeGraphGlHitJackElement(hit.jack) : null;
    if (port && typeof nodeGraphWireInteractions?.handlePortClick === "function") {
      nodeGraphWireInteractions.handlePortClick(nodeGraphGlHitRetarget(event, port));
    }
    return;
  }
  const drag = nodeGraphMvp?.wireDragging;
  if (!drag || drag.active) return;
  const hitbox = drag.element;
  const port = hitbox?.querySelector?.(".node-port, .node-param-port") || hitbox;
  if (!(port instanceof Element) || typeof nodeGraphWireInteractions?.handlePortClick !== "function") return;
  // A click that never crossed the drag threshold arms the wire so it can be
  // finished without holding the button.
  event.glArmClick = true;
  nodeGraphWireInteractions.handlePortClick(nodeGraphGlHitRetarget(event, port));
  if (nodeGraphMvp.wireDragging && !nodeGraphMvp.wireDragging.active) {
    nodeGraphMvp.wireDragging = null;
  }
}

function nodeGraphGlHitInstall() {
  if (nodeGraphGlHitState.installed) return;
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return;
  host.addEventListener("pointerdown", nodeGraphGlHitPointerDown, true);
  host.addEventListener("pointerup", nodeGraphGlHitPointerUp, true);
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
