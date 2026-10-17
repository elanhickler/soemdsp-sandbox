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
    if (el.querySelector(":scope > .node-text-box-body")) continue;
    const fill = nodeGraphGlGraphParseCssColor(
      getComputedStyle(el).getPropertyValue("--node-module-fill"),
      [0.09, 0.1, 0.12, 1],
    );
    plates.push({
      id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill,
      selected: el.classList.contains("selected"),
    });
    const canvases = el.querySelectorAll(".node-display-canvas");
    for (let c = 0; c < canvases.length; c += 1) {
      const face = canvases[c];
      if (!(face.width > 1) || !(face.height > 1)) continue;
      const page = face.closest("[data-music-player-page]");
      if (page?.hidden || face.closest("[hidden]")) continue;
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
    if (el.querySelector(":scope > .node-text-box-body")) continue;
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
      jacks.push({
        key,
        id,
        x: px,
        y: py,
        r: radius,
        // Invisible hit box: one port-diameter out from the pin on each side.
        hit: diameter,
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
      const valueBox = nodeGraphGlGraphWorldBox(valueEl);
      const labelBox = nodeGraphGlGraphWorldBox(labelEl);
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
  }
  nodeGraphGlGraphState.chrome = { titles, labels, jacks, sliders, seeds, keys, graphs };
}

function nodeGraphGlGraphTextOpts(opts) {
  const emojiPx = nodeGraphGlGraphState.emojiPx;
  if (emojiPx > 0) opts.emojiPx = emojiPx;
  return opts;
}

function nodeGraphGlGraphSettleTextBake() {
  const zoom = nodeGraphGlGraphZoom();
  const chrome = nodeGraphGlGraphState.chrome || {};
  let maxPx = 16;
  for (const title of chrome.titles || []) {
    const chars = Math.max(1, String(title.el?.textContent || "").trim().length);
    const fit = Math.min((title.h || 16) * 0.62, (title.box?.w || 16) / chars / 0.62);
    maxPx = Math.max(maxPx, fit * zoom);
  }
  const buttonNodes = (nodeGraphGlGraphState.view?.host || document)
    .querySelectorAll(".node-plugin-momentary-button, .node-plugin-toggle-button");
  for (let i = 0; i < buttonNodes.length; i += 1) {
    const box = nodeGraphGlGraphWorldBox(buttonNodes[i]);
    if (!box) continue;
    maxPx = Math.max(maxPx, Math.min(box.h * 0.42, box.w * 0.5) * zoom);
  }
  for (const label of chrome.labels || []) maxPx = Math.max(maxPx, (label.fontPx || 13) * zoom);
  for (const slider of chrome.sliders || []) {
    const labelPx = Number.parseFloat(slider.labelEl ? getComputedStyle(slider.labelEl).fontSize : "");
    const valuePx = Number.parseFloat(slider.valueEl ? getComputedStyle(slider.valueEl).fontSize : "");
    if (labelPx > 0) maxPx = Math.max(maxPx, labelPx * zoom);
    if (valuePx > 0) maxPx = Math.max(maxPx, valuePx * zoom);
  }
  let px = Math.max(16, Math.min(384, Math.round(maxPx)));
  // Tiles only raise the shared bake, so several tiles never rebake against each other.
  if (nodeGraphGlGraphState.view) px = Math.max(px, nodeGraphGlGraphState.emojiPx || 0);
  nodeGraphGlGraphState.emojiPx = px;
  if (typeof nodeGraphGlLinesSetGlyphBakePx === "function") nodeGraphGlLinesSetGlyphBakePx(px);
}

function nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH, pad = 48) {
  return x + w < -pad || y + h < -pad || x > cssW + pad || y > cssH + pad;
}

function nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill) {
  if (hideGhost || !readout?.classList.contains("has-ghost-slider")) return;
  const start = nodeGraphGlGraphCssPx(readout, "--ghost-start");
  const end = nodeGraphGlGraphCssPx(readout, "--ghost-end");
  if (!(end > start)) return;
  nodeGraphGlLinesRect(batch, x + start * zoom, y, (end - start) * zoom, h, ghostFill);
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
  const ink = [0.98, 0.992, 1, 0.92];
  const well = [0.031, 0.043, 0.051, 1];
  const line = typeof nodeGraphGlLinesCss === "function"
    ? nodeGraphGlLinesCss(getComputedStyle(document.documentElement).getPropertyValue("--line") || "#3a4248")
    : [0.23, 0.26, 0.28, 1];
  const hover = [1, 1, 1, 0.08];
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    const host = nodeGraphGlGraphSeedCell(seed.control, toX, toY, zoom);
    if (!host || nodeGraphGlGraphOutside(host.x, host.y, host.w, host.h, cssW, cssH)) continue;
    const valueEl = seed.control?.querySelector?.(".node-slider-readout-value");
    const readout = seed.control?.querySelector?.(".node-slider-readout");
    const dice = seed.control?.querySelector?.(".node-seed-btn-dice");
    const plus = seed.control?.querySelector?.(".node-seed-btn-plus");
    const minus = seed.control?.querySelector?.(".node-seed-btn-minus");
    const valueCell = nodeGraphGlGraphSeedCell(readout, toX, toY, zoom);
    const diceCell = nodeGraphGlGraphSeedCell(dice, toX, toY, zoom);
    const plusCell = nodeGraphGlGraphSeedCell(plus, toX, toY, zoom);
    const minusCell = nodeGraphGlGraphSeedCell(minus, toX, toY, zoom);
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
      const hoverCell = (dice?.matches?.(":hover") && diceCell)
        || (plus?.matches?.(":hover") && plusCell)
        || (minus?.matches?.(":hover") && minusCell)
        || null;
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
    const text = String(valueEl?.textContent || "").replace(/\s+/g, " ").trim();
    if (text && valueCell && typeof nodeGraphGlLinesText === "function") {
      const cssPx = Number.parseFloat(valueEl ? getComputedStyle(valueEl).fontSize : "") || 0;
      const fillPx = Math.max(
        6,
        Math.min(valueCell.h * 0.78, valueCell.w / Math.max(1, text.length) / 0.58),
      );
      nodeGraphGlLinesText(batch, text, valueCell.x + valueCell.w * 0.5, valueCell.y + valueCell.h * 0.5, nodeGraphGlGraphTextOpts({
        px: Math.max(6, (cssPx > 4 ? cssPx * zoom : fillPx)),
        rgba: ink,
        align: "center",
        baseline: "middle",
        weight: 600,
        family: "Consolas, \"Courier New\", monospace",
      }));
    }
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
  const ghostFill = typeof nodeGraphGlLinesCss === "function"
    ? nodeGraphGlLinesCss(getComputedStyle(ghostHost || document.documentElement).getPropertyValue("--node-slider-ghost-color") || "hsl(262 100% 76% / 0.38)")
    : [0.78, 0.55, 1, 0.38];
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
      // No amount fill (track start -> position): sliders show only the position handle.
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
            px: Math.max(8, (Number.parseFloat(getComputedStyle(slider.labelEl).fontSize) || 12.6) * zoom),
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
            px: Math.max(8, (Number.parseFloat(getComputedStyle(slider.valueEl).fontSize) || 13.8) * zoom),
            rgba: ink,
            align: slider.valueAnchor.align,
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
    trace: Array.isArray(wire?.tracePoints) && wire.tracePoints.length > 0,
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
    const endpointColor = (endpoint) => {
      if (!endpoint) return "#ffffff";
      const port = endpoint.port || endpoint.param || endpoint.graphInput || "";
      return colorOf(endpoint.node, port, endpoint.io) || "#ffffff";
    };
    const drag = nodeGraphMvp.wireDragging;
    if (drag?.active && drag.from && drag.cursorPoint) {
      const dragColor = endpointColor(drag.endpoint);
      nodeGraphGlGraphPushWire(wires, drag.from, drag.cursorPoint, dragColor, dragColor, zoom, null, false, false);
    }
    const mode = nodeGraphMvp.portConnectionMode;
    if (mode?.cursorPoint && mode.selected && typeof mode.selected.values === "function") {
      for (const entry of mode.selected.values()) {
        if (entry?.from) {
          const modeColor = mode.interactColor || endpointColor(entry.endpoint);
          nodeGraphGlGraphPushWire(wires, entry.from, mode.cursorPoint, modeColor, modeColor, zoom, null, false, false);
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
  const view = nodeGraphGlGraphState.view;
  const host = view ? view.host : document.getElementById("nodeGraphWorkspace");
  if (!host || typeof nodeGraphGlLinesBegin !== "function") return false;
  if (!view) {
    nodeGraphGlGraphPresentTiles();
    // Perform mode hides the workspace: nothing of it is on screen (its modules live in tiles).
    if (!host.clientWidth && document.body?.classList.contains("node-perform-mode")) return true;
    host.classList.add("gl-graph-on");
  }
  const canvas = nodeGraphGlGraphEnsureCanvas(
    host, "canvas", view ? "" : "nodeGlGraphCanvas", "node-gl-graph-canvas",
    view ? ":scope > .dsp-node" : ".node-graph-zoom-surface",
  );
  const dotsCanvas = nodeGraphGlGraphEnsureCanvas(
    host, "dotsCanvas", view ? "" : "nodeGlGraphDots", "node-gl-graph-dots", null,
  );
  const cssW = Math.max(1, host.clientWidth || 1);
  const cssH = Math.max(1, host.clientHeight || 1);
  const scale = nodeGraphGlGraphFit(canvas, cssW, cssH);
  nodeGraphGlGraphFit(dotsCanvas, cssW, cssH);
  const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale, transparent: true });
  // Contact dots first, as straight coverage, then displays over them.
  const contactBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { scale, transparent: true });
  const dotBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { scale, transparent: true, keep: true });
  const veilBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { scale, transparent: true, keep: true });
  if (!batch || !contactBatch || !dotBatch || !veilBatch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return false;
  }
  const zoom = nodeGraphGlGraphZoom();
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
    nodeGraphGlGraphState.traceThick = Number.parseFloat(style.getPropertyValue("--node-trace-wire-thickness")) || 1;
  }
  // Zoom-1 sizes. Core and the 2px fade both scale with the camera.
  const halfPx = Math.max(0, thick * 0.5) * zoom;
  const traceHalf = Math.max(0, (nodeGraphGlGraphState.traceThick || 1) * 0.5) * zoom;
  const dotR = Math.max(0, dotSize * 0.5) * zoom;
  const wireFeather = 2 * zoom;
  let cam = { x: 0, y: 0 };
  if (view) cam = view.cam;
  else if (typeof nodeGraphWireCameraViewBox === "function") cam = nodeGraphWireCameraViewBox(host);
  const toX = (x) => (x - cam.x) * zoom;
  const toY = (y) => (y - cam.y) * zoom;

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
      screen[p] = toX(src[p]);
      screen[p + 1] = toY(src[p + 1]);
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
    let stroke = wire.trace ? traceHalf : halfPx;
    let rgba = wire.rgba;
    if (wire.kind && wire.index >= 0 && typeof nodeGraphSelectedWireEntries === "function") {
      const picked = nodeGraphSelectedWireEntries().some((entry) =>
        (entry.kind || "signal") === wire.kind && Number(entry.index) === wire.index,
      );
      if (picked) {
        rgba = [0.95, 0.86, 0.45, 1];
        stroke = halfPx + 0.8 * zoom;
      }
    }
    nodeGraphGlLinesPolyline(batch, screen.subarray(0, src.length), stroke, wireFeather, rgba);
    const dots = wire.dots || [];
    for (let d = 0; d < dots.length; d += 1) {
      const dot = dots[d];
      const dx = toX(dot.x);
      const dy = toY(dot.y);
      if (dx < -dotR || dy < -dotR || dx > cssW + dotR || dy > cssH + dotR) continue;
      if (dot.square) {
        nodeGraphGlLinesRect(contactBatch, dx - dotR, dy - dotR, dotR * 2, dotR * 2, dot.rgba);
      } else {
        nodeGraphGlLinesDot(contactBatch, dx, dy, dotR, wireFeather, dot.rgba);
      }
    }
  }
  const plateStyle = getComputedStyle(host);
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
    const x = toX(plate.x);
    const y = toY(plate.y);
    const w = plate.w * zoom;
    const h = plate.h * zoom;
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;
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
      if (jack.id !== plate.id) continue;
      plateJacks.push({
        x: toX(jack.x),
        y: toY(jack.y),
        r: jack.r * zoom,
        rgba: jack.rgba,
        inlet: jack.inlet === true,
      });
    }
    if (typeof nodeGraphGlLinesModuleOutline === "function") {
      nodeGraphGlLinesModuleOutline(batch, x0, y0, w0, h0, edge, color, plateJacks, plate.fill, 0);
    }
  }
  batch.textPixelated = zoom > 2.5;
  nodeGraphGlGraphDrawChrome(batch, toX, toY, zoom, cssW, cssH);
  const pixelated = zoom > 2.5;
  for (let i = 0; i < nodeGraphGlGraphState.displays.length; i += 1) {
    const face = nodeGraphGlGraphState.displays[i];
    if (!face.canvas || !(face.w > 0) || !(face.h > 0)) continue;
    const rect = nodeGraphGlGraphDisplayScreenRect(face, toX, toY, zoom);
    const x = rect.x;
    const y = rect.y;
    const w = rect.w;
    const h = rect.h;
    if (!(w > 1) || !(h > 1)) continue;
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;
    nodeGraphGlLinesImage(dotBatch, face.canvas, x, y, w, h, {
      nearest: pixelated,
      // Pan/zoom already froze the face pixels. Re-upload only when displays paint.
      cache: gesturing,
      alpha: 1,
    });
  }
  dotBatch.textPixelated = pixelated;
  nodeGraphGlGraphDrawButtonCaptions(dotBatch, toX, toY, zoom, cssW, cssH);
  nodeGraphGlGraphDrawVeils(veilBatch, toX, toY, zoom);
  const outputPaused = typeof nodeGraphLiveEngineIsPaused === "function" && nodeGraphLiveEngineIsPaused();
  if (outputPaused) {
    const white = [1, 1, 1, 1];
    for (let i = 0; i < nodeGraphGlGraphState.displays.length; i += 1) {
      const face = nodeGraphGlGraphState.displays[i];
      if (!face.output || !(face.w > 0) || !(face.h > 0)) continue;
      const rect = nodeGraphGlGraphDisplayScreenRect(face, toX, toY, zoom);
      const x = rect.x;
      const y = rect.y;
      const w = rect.w;
      const h = rect.h;
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
  const contactOk = nodeGraphGlLinesEnd(contactBatch, "max") !== false;
  const dotsOk = nodeGraphGlLinesEnd(dotBatch, "alpha") !== false;
  const veilOk = nodeGraphGlLinesEnd(veilBatch, "alpha") !== false;
  return cablesOk && contactOk && dotsOk && veilOk;
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
    ".node-module-graph-face, .node-module-graph-display, .node-keypad-face, .node-knob-face, .node-xy-pad-canvas, .node-sequencer-roll, .acid-seq-face, .node-arp-keys-face, .node-plugin-toggle-button, .node-plugin-momentary-button, .node-sample-waveform-display",
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
  for (let i = 0; i < jacks.length; i += 1) {
    const jack = jacks[i];
    const reach = Math.max(jack.hit || 0, jack.r * 2, 8);
    const dx = jack.x - x;
    const dy = jack.y - y;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
    const dist = dx * dx + dy * dy;
    if (dist < jackDist) {
      jackDist = dist;
      jackHit = jack;
    }
  }
  if (jackHit) return { kind: "jack", x: jackHit.x, y: jackHit.y };
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
      return { kind: "slider", readout: slider.readout };
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

function nodeGraphGlHitLabelPort(label) {
  const row = label?.closest?.(".node-io-row, .node-io-column, .node-parameter-row");
  return row?.querySelector?.(".node-port, .node-param-port") || null;
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

function nodeGraphGlHitInside(x, y, box) {
  return Boolean(box) && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
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
    const plates = nodeGraphGlGraphState.plates || [];
    for (let i = plates.length - 1; i >= 0; i -= 1) {
      const plate = plates[i];
      const pad = 14;
      if (point.x < plate.x - pad || point.x > plate.x + plate.w + pad
        || point.y < plate.y - pad || point.y > plate.y + plate.h + pad) continue;
      const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
      return nodeGraphGlHitPortElement(moduleEl, hit.x, hit.y) || moduleEl;
    }
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
