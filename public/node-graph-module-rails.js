// Module rails (docs/MODULE_RAILS_PLAN.md).
//
// Layout 1 "spawn" (default): IO band above the display as before; the param
// band under the display is  [mod rail | params | thru rail].
//   - Each side opens only when needed: the mod rail (left) with a cable on a
//     param's mod inlet (or ui.modRailAlwaysOn, saved with the patch), the
//     thru rail (right) with a cable leaving a param's thru.
//   - Module width never changes; only rows beside an open rail shrink, on
//     that side only.
// Layout 3 "railsOnly": modules with ports and neither params nor a display
//   (Comparator ...): title bar plus rails (inputs left, outputs right).
// Layout 2 "sideRails" is reserved and not built (§10b).
//
// Each tunable is one constant here.

/** Rail column width at workspace zoom 1.0 (Q25). */
const NODE_GRAPH_RAIL_WIDTH_PX = 26;
/** Shared short-label rule: first N characters, keeping a trailing " L" / " R" (Q5). */
const NODE_GRAPH_RAIL_SHORT_LABEL_CHARS = 4;

const NodeGraphFaceLayout = Object.freeze({
  spawn: "spawn",
  sideRails: "sideRails",
  railsOnly: "railsOnly",
});

function nodeGraphRailShortLabel(text, shortName = "") {
  const explicit = String(shortName || "").trim();
  if (explicit) {
    return explicit;
  }
  const raw = String(text || "").trim();
  const side = raw.match(/^(.*\S)\s+([LR])$/);
  if (side) {
    return `${side[1].slice(0, NODE_GRAPH_RAIL_SHORT_LABEL_CHARS).trim()} ${side[2]}`;
  }
  return raw.slice(0, NODE_GRAPH_RAIL_SHORT_LABEL_CHARS).trim();
}

function nodeGraphDefinitionHasDisplay(definition) {
  return Boolean(
    definition?.displayType
    || (Array.isArray(definition?.displayModes) && definition.displayModes.length)
    || definition?.layout
    || definition?.customDisplayArea,
  );
}

/** Q28: explicit definition.faceLayout, else railsOnly for ports-only modules, else spawn. */
function nodeGraphResolveFaceLayout(definition) {
  const explicit = String(definition?.faceLayout || "");
  if (explicit === NodeGraphFaceLayout.spawn || explicit === NodeGraphFaceLayout.railsOnly) {
    return explicit;
  }
  const hasPorts = (Array.isArray(definition?.inputs) && definition.inputs.length > 0)
    || (Array.isArray(definition?.outputs) && definition.outputs.length > 0);
  const hasParams = Array.isArray(definition?.parameters)
    && definition.parameters.some((parameter) => parameter && parameter.hidden !== true);
  if (hasPorts && !hasParams && !nodeGraphDefinitionHasDisplay(definition)) {
    return NodeGraphFaceLayout.railsOnly;
  }
  return NodeGraphFaceLayout.spawn;
}

function nodeGraphModuleFaceLayout(type) {
  const definition = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions[type]
    : null;
  return definition?.faceLayout || nodeGraphResolveFaceLayout(definition);
}

let nodeGraphModuleRailsSignature = "";

/**
 * Open / close each module's mod rail from the patch's param cables and
 * ui.modRailAlwaysOn. Returns true when any rail changed (jacks moved).
 */
function syncNodeGraphModuleRails() {
  if (typeof document === "undefined" || typeof nodeGraphMvp !== "object") {
    return false;
  }
  const patch = nodeGraphMvp.patch || {};
  // A param is "in use" on the mod rail when a cable lands on its mod inlet,
  // on the thru rail when a cable leaves its thru. Each side tags only its own.
  const modUsed = new Map();
  const thruUsed = new Map();
  // A hidden param has no row, so it gets no rail tag and never opens the rails.
  const hidden = (id, param) => {
    const node = (patch.nodes || []).find((n) => n?.id === id);
    const def = node && typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions[node.type] : null;
    const parameter = def?.parameters?.find((p) => p.key === param);
    return Boolean(parameter) && typeof nodeGraphParameterEffectiveVisible === "function"
      && !nodeGraphParameterEffectiveVisible(parameter, node.paramMeta?.[param]);
  };
  const use = (used, id, param) => {
    if (!id || !param || hidden(id, param)) return;
    if (!used.has(id)) used.set(id, new Set());
    used.get(id).add(param);
  };
  for (const wire of patch.modulations || []) use(modUsed, wire?.destinationNode, wire?.destinationParam);
  const paramKeys = new Map();
  const keysOf = (id) => {
    if (!paramKeys.has(id)) {
      const node = (patch.nodes || []).find((n) => n?.id === id);
      const def = node && typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions[node.type] : null;
      paramKeys.set(id, new Set((def?.parameters || []).map((p) => p.key)));
    }
    return paramKeys.get(id);
  };
  for (const wire of [...(patch.modulations || []), ...(patch.connections || [])]) {
    if (wire?.sourceNode && keysOf(wire.sourceNode).has(wire.sourcePort)) use(thruUsed, wire.sourceNode, wire.sourcePort);
  }
  const alwaysOn = new Set(
    (patch.nodes || []).filter((node) => node?.ui?.modRailAlwaysOn).map((node) => node.id),
  );
  const parts = [];
  for (const [tag, used] of [["m", modUsed], ["t", thruUsed]]) {
    for (const [id, params] of used) parts.push(`${tag}${id}:${[...params].sort().join(",")}`);
  }
  const signature = `${parts.sort().join("|")}#${[...alwaysOn].sort().join(",")}`;
  if (signature === nodeGraphModuleRailsSignature) {
    return false;
  }
  nodeGraphModuleRailsSignature = signature;
  for (const article of document.querySelectorAll(".dsp-node[data-node]")) {
    const id = article.dataset.node;
    const mod = modUsed.get(id);
    const thru = thruUsed.get(id);
    article.classList.toggle("mod-rail-open", Boolean(mod?.size) || alwaysOn.has(id));
    article.classList.toggle("thru-rail-open", Boolean(thru?.size));
    for (const jack of article.querySelectorAll(".node-param-port.modulation-input")) {
      jack.classList.toggle("rail-patched", Boolean(mod?.has(jack.dataset.param)));
    }
    for (const jack of article.querySelectorAll(".node-param-port.parameter-output")) {
      jack.classList.toggle("rail-patched", Boolean(thru?.has(jack.dataset.param)));
    }
    // Only rows beside a gutter (a patched param) are inset, on that side only.
    for (const row of article.querySelectorAll(".node-parameter-row")) {
      row.classList.toggle("rail-inset-mod", Boolean(row.querySelector(".node-param-port.modulation-input.rail-patched")));
      row.classList.toggle("rail-inset-thru", Boolean(row.querySelector(".node-param-port.parameter-output.rail-patched")));
    }
  }
  return true;
}

/** Re-run the rail sync on the next wire draw (module DOM was rebuilt). */
function invalidateNodeGraphModuleRails() {
  nodeGraphModuleRailsSignature = "";
}

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.style.setProperty("--node-rail-width", `${NODE_GRAPH_RAIL_WIDTH_PX}px`);
}

/** Layout 3 rail ports show the short label unless the module names that port
 * (inputLabels / outputLabels); Layout 1 IO band labels are unchanged. */
function nodeGraphRailPortLabel(type, label, port = "", io = "") {
  const def = typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions[type] : null;
  const named = (io === "output" ? def?.outputLabels : def?.inputLabels)?.[port];
  return nodeGraphModuleFaceLayout(type) === NodeGraphFaceLayout.railsOnly && !named
    ? nodeGraphRailShortLabel(label)
    : label;
}

/** Canvas display sizing (PP-10): a display's declared aspect (w/h), or 0 = fill its tile. */
function nodeGraphDisplayAspect(type) {
  const definition = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions[type]
    : null;
  const aspect = Number(definition?.displayAspect);
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 0;
}

/** Display box inside a canvas tile: fill it, or contain-fit a declared aspect. */
function nodeGraphCanvasDisplayBox(tileW, tileH, aspect = 0) {
  const w = Math.max(1, tileW);
  const h = Math.max(1, tileH);
  if (!(aspect > 0)) {
    return { x: 0, y: 0, w, h };
  }
  const fw = Math.min(w, h * aspect);
  const fh = fw / aspect;
  return { x: (w - fw) * 0.5, y: (h - fh) * 0.5, w: fw, h: fh };
}

// ---- Rail drawing (WebGL only; the rail DOM is hit/geometry, never painted) ----
// soundemote-dev Spawn IO (experiments/wiring): each rail is a #080a0e gutter
// with one full-height #3d4555 1px separator on its slider side. Each patched
// param gets one IO box the full rail width (no padding) and 16 px tall (the
// label height), centred on its row: #111 fill, #889 label. Chip pin: the box
// has three strokes (top, bottom, slider side, all outside the box like the
// plate stroke) and no outward edge, and runs
// through the module border (drawn over it, same quads, so its rows are exact),
// and the plate border is cut over exactly the box's span (nodeGraphModuleRailBorderCuts). Param wires end on
// the border's outer edge, centred on the box, with a tiny end dot (UIDev).
const NodeGraphRailInk = Object.freeze({
  gutter: "#080a0e",
  gutterEdge: "#3d4555",
  inletFill: "#111",
  inletStroke: "#889",
  text: "#dde",
});
const NODE_GRAPH_RAIL_FONT_PX = 9;
const NODE_GRAPH_RAIL_INLET_H_PX = 16;

const nodeGraphRailRgbaCache = new Map();
function nodeGraphRailRgba(css) {
  let rgba = nodeGraphRailRgbaCache.get(css);
  if (!rgba) {
    let hex = css;
    if (/^#[0-9a-f]{3}$/i.test(hex)) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
    rgba = typeof nodeGraphGlGraphParseCssColor === "function" ? nodeGraphGlGraphParseCssColor(hex, [1, 1, 1, 1]) : [1, 1, 1, 1];
    nodeGraphRailRgbaCache.set(css, rgba);
  }
  return rgba;
}

/** True when a param's wire end sits on a rail (spawn face): no jack, no end dot. */
function nodeGraphModuleRailOwnsParam(nodeId, param) {
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(nodeId) : null;
  if (el?.dataset.faceLayout !== NodeGraphFaceLayout.spawn) return false;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const def = node && typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions[node.type] : null;
  return Boolean(def?.parameters?.some((p) => p.key === param));
}

/**
 * Device-pixel grid of a GL batch. Rail edges land on whole device pixels, and
 * the module wall and border width are placed the way the outline shader
 * places them, so the box meets the wall and covers the border band exactly.
 */
function nodeGraphRailGrid(batch) {
  const cam = batch?.camera;
  const s = cam ? (cam.zoom > 0 ? cam.zoom : 1) * (batch.scale > 0 ? batch.scale : 1) : (batch?.scale > 0 ? batch.scale : 1);
  const ox = cam ? cam.x || 0 : 0;
  const oy = cam ? cam.y || 0 : 0;
  return {
    x: (v) => Math.ceil((v - ox) * s - 0.5) / s + ox,
    y: (v) => Math.ceil((v - oy) * s - 0.5) / s + oy,
    t: (v) => Math.max(1, Math.floor(v * s + 0.5)) / s,
    // Plate walls and border band as nodeGraphGlGraphDrawPlate / the outline shader place them.
    wall: (v) => (cam ? Math.ceil((v - ox) * s - 0.5) / s + ox : Math.round(v)),
    border: (css, zoom) => Math.max(1, Math.floor(css * zoom * s + 0.5)) / s,
  };
}

/** Module border width (css px), the value the plate outline is drawn with. */
function nodeGraphRailBorderCss() {
  const style = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState.plateStyle : null;
  return Number.parseFloat(style?.getPropertyValue("--node-module-idle-stroke-width")) || 1;
}

/** True when either side's rail of a module element is open. */
function nodeGraphModuleRailOpen(el) {
  return Boolean(el?.classList.contains("mod-rail-open") || el?.classList.contains("thru-rail-open"));
}

/** Patched-param IO boxes of an open spawn rail, snapped to the batch's pixel grid. */
function nodeGraphModuleRailBoxes(batch, plate, toX, toY, zoom) {
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
  if (!nodeGraphModuleRailOpen(el) || el.dataset.faceLayout !== NodeGraphFaceLayout.spawn) return null;
  const body = el.querySelector(":scope > .dsp-node-body");
  const laid = body && typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(body, el) : null;
  if (!laid) return null;
  const grid = nodeGraphRailGrid(batch);
  const t = grid.t(Math.max(1, zoom));
  const left = grid.wall(toX(plate.x));
  const right = grid.wall(toX(plate.x)) + Math.max(1, Math.round(plate.w * zoom));
  const wallR = batch?.camera ? grid.wall(toX(plate.x + plate.w)) : right;
  const border = grid.border(nodeGraphRailBorderCss(), zoom);
  const ports = [...body.querySelectorAll(".node-param-port.rail-patched")].filter((port) => port.offsetParent);
  const boxes = [];
  for (const port of ports) {
    const box = nodeGraphModuleLayoutBox(port, el);
    if (!box || !(box.w > 1)) continue;
    const side = box.x + box.w / 2 < laid.x + laid.w / 2 ? -1 : 1;
    const bh = Math.min(box.h, NODE_GRAPH_RAIL_INLET_H_PX) * zoom;
    const y = grid.y(toY(plate.y + box.y) + (box.h * zoom - bh) / 2);
    const y1 = Math.max(y + 3 * t, grid.y(toY(plate.y + box.y) + (box.h * zoom + bh) / 2));
    // The outward edge sits on the module wall, the inward edge on the grid.
    const x = side < 0 ? left : grid.x(toX(plate.x + box.x));
    const x1 = side < 0 ? grid.x(toX(plate.x + box.x + box.w)) : wallR;
    // ox: the outer edge (through the border band), where the wire ends.
    boxes.push({ port, x, y, w: x1 - x, h: y1 - y, t, side, border, ox: side < 0 ? x - border : x1 + border });
  }
  return { el, body, laid, boxes, t, grid, left, right: wallR };
}

/**
 * Param wire ends on open rails, in the coords the boxes are drawn in: the
 * box's outer edge, vertically centred. The wire renderer snaps rail param
 * wire ends to these, so wire end == drawn box edge at every zoom / DPR.
 */
function nodeGraphModuleRailWireEnds(batch, plates, toX, toY, zoom) {
  const out = [];
  for (const plate of plates || []) {
    const rail = nodeGraphModuleRailBoxes(batch, plate, toX, toY, zoom);
    for (const b of rail?.boxes || []) out.push({ x: b.ox, y: b.y + b.h / 2 });
  }
  return out;
}

/** Module-border gaps for the outline shader: one per IO box, on the wall it faces. */
function nodeGraphModuleRailBorderCuts(batch, plate, toX, toY, zoom) {
  const rail = nodeGraphModuleRailBoxes(batch, plate, toX, toY, zoom);
  return rail?.boxes.length ? rail.boxes.map((b) => ({ y0: b.y, y1: b.y + b.h, side: b.side })) : null;
}

/** Draw open rails (gutters + patched-param IO boxes + labels) in one pass. */
function nodeGraphModuleRailsDrawGl(batch, plates, toX, toY, zoom, cssW, cssH) {
  if (typeof nodeGraphGlLinesRect !== "function" || typeof nodeGraphModuleLayoutBox !== "function") return;
  const rect = (x, y, w, h, css) => nodeGraphGlLinesRect(batch, x, y, w, h, nodeGraphRailRgba(css));
  for (let i = 0; i < plates.length; i += 1) {
    const rail = nodeGraphModuleRailBoxes(batch, plates[i], toX, toY, zoom);
    if (!rail) continue;
    const { el, body, laid, boxes, t, grid, left, right } = rail;
    const x0 = toX(plates[i].x + laid.x);
    const y0 = toY(plates[i].y + laid.y);
    const w = laid.w * zoom;
    const h = laid.h * zoom;
    if (!batch.camera && (x0 > cssW || y0 > cssH || x0 + w < 0 || y0 + h < 0)) continue;
    // Gutters run only beside the sections (face rows / param rows) that hold a
    // patched param: one short segment per merged run of sections.
    const face = el.classList.contains("has-module-face") ? body.querySelector(":scope > .node-face") : null;
    const faceBox = face ? nodeGraphModuleLayoutBox(face, el) : null;
    const spec = faceBox && typeof nodeGraphModuleFaceSpecForElement === "function" ? nodeGraphModuleFaceSpecForElement(el) : null;
    const widgets = spec && typeof nodeGraphModuleFaceWidgets === "function" ? nodeGraphModuleFaceWidgets(spec, face.offsetWidth, el) : [];
    const section = (port) => {
      const key = port.dataset.param;
      const wd = widgets.find((x) => x.param === key || x.hpf === key || x.lpf === key);
      if (wd) return [faceBox.y + wd.y, faceBox.y + wd.y + wd.h];
      const row = nodeGraphModuleLayoutBox(port.closest(".node-parameter-row") || port, el);
      return row ? [row.y, row.y + row.h] : null;
    };
    const runsOf = (side) => boxes.filter((b) => b.side === side).map((b) => section(b.port)).filter(Boolean)
      .sort((a, b) => a[0] - b[0]).reduce((out, r) => {
        const last = out[out.length - 1];
        if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]);
        else out.push([...r]);
        return out;
      }, []);
    batch._over = true;
    // Gutters span wall to separator; the separator is the rail's inner edge.
    const inL = grid.x(x0 + NODE_GRAPH_RAIL_WIDTH_PX * zoom);
    const inR = grid.x(x0 + w - NODE_GRAPH_RAIL_WIDTH_PX * zoom);
    const gutter = (gx, gy, gw, gh, side) => {
      let at = gy;
      for (const b of boxes.filter((q) => q.side === side && q.y >= gy && q.y + q.h <= gy + gh).sort((p, q) => p.y - q.y)) {
        rect(gx, at, gw, b.y - at, NodeGraphRailInk.gutter);
        at = b.y + b.h;
      }
      rect(gx, at, gw, gy + gh - at, NodeGraphRailInk.gutter);
    };
    // Each side's gutter runs only beside its own patched params.
    for (const side of [-1, 1]) {
      for (const [a, b] of runsOf(side)) {
        const sy = grid.y(toY(plates[i].y + a));
        const sh = grid.y(toY(plates[i].y + b)) - sy;
        if (side < 0) {
          gutter(left, sy, inL - left, sh, -1);
          rect(inL - t, sy, t, sh, NodeGraphRailInk.gutterEdge);
        } else {
          gutter(inR, sy, right - inR, sh, 1);
          rect(inR, sy, t, sh, NodeGraphRailInk.gutterEdge);
        }
      }
    }
    for (const b of boxes) {
      const border = b.border;
      const fx = Math.min(b.x, b.ox);
      const fw = b.w + border;
      rect(fx, b.y, fw, b.h, NodeGraphRailInk.inletFill);
      // Strokes sit outside the box, as the plate stroke sits outside the
      // plate: top / bottom rows run from the inner stroke to the border's
      // outer edge, so they meet the wall stroke square with no gap or overlap.
      const sx = b.side < 0 ? b.ox : b.x - t;
      const sw = (b.side < 0 ? b.x + b.w + t : b.ox) - sx;
      rect(sx, b.y - t, sw, t, NodeGraphRailInk.inletStroke);
      rect(sx, b.y + b.h, sw, t, NodeGraphRailInk.inletStroke);
      rect(b.side < 0 ? b.x + b.w : b.x - t, b.y, t, b.h, NodeGraphRailInk.inletStroke);
    }
    batch._over = false;
    if (typeof nodeGraphGlLinesText !== "function") continue;
    for (const b of boxes) {
      const o = {
        px: Math.max(4, NODE_GRAPH_RAIL_FONT_PX * zoom), rgba: nodeGraphRailRgba(NodeGraphRailInk.text),
        align: "center", baseline: "middle", weight: 650, maxWidth: b.w - 2 * t,
      };
      nodeGraphGlLinesText(batch, b.port.dataset.railLabel || "", b.x + b.w / 2, b.y + b.h / 2, typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts(o) : o);
    }
  }
}
