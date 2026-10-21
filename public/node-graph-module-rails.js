// Module rails (docs/MODULE_RAILS_PLAN.md).
//
// Layout 1 "spawn" (default): IO band above the display as before; the param
// band under the display is  [mod rail | params | thru rail].
//   - Thru rail: always shown when the module has params (no option).
//   - Mod rail: appears with the module's first param cable and goes away with
//     the last one, unless ui.modRailAlwaysOn (saved with the patch).
//   - Module width never changes; the params shrink between the rails.
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
  // A param is "in use" when a cable lands on its mod inlet or leaves its thru.
  // Each used param shows one tag pair (mod rail + thru rail); nothing else.
  const patched = new Map();
  // A hidden param has no row, so it gets no rail tag and never opens the rails.
  const hidden = (id, param) => {
    const node = (patch.nodes || []).find((n) => n?.id === id);
    const def = node && typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions[node.type] : null;
    const parameter = def?.parameters?.find((p) => p.key === param);
    return Boolean(parameter) && typeof nodeGraphParameterEffectiveVisible === "function"
      && !nodeGraphParameterEffectiveVisible(parameter, node.paramMeta?.[param]);
  };
  const use = (id, param) => {
    if (!id || !param || hidden(id, param)) return;
    if (!patched.has(id)) patched.set(id, new Set());
    patched.get(id).add(param);
  };
  for (const wire of patch.modulations || []) use(wire?.destinationNode, wire?.destinationParam);
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
    if (wire?.sourceNode && keysOf(wire.sourceNode).has(wire.sourcePort)) use(wire.sourceNode, wire.sourcePort);
  }
  const alwaysOn = new Set(
    (patch.nodes || []).filter((node) => node?.ui?.modRailAlwaysOn).map((node) => node.id),
  );
  const parts = [];
  for (const [id, params] of patched) parts.push(`${id}:${[...params].sort().join(",")}`);
  const signature = `${parts.sort().join("|")}#${[...alwaysOn].sort().join(",")}`;
  if (signature === nodeGraphModuleRailsSignature) {
    return false;
  }
  nodeGraphModuleRailsSignature = signature;
  for (const article of document.querySelectorAll(".dsp-node[data-node]")) {
    const id = article.dataset.node;
    const params = patched.get(id);
    article.classList.toggle("mod-rail-open", Boolean(params?.size) || alwaysOn.has(id));
    for (const jack of article.querySelectorAll(".node-param-port.modulation-input, .node-param-port.parameter-output")) {
      jack.classList.toggle("rail-patched", Boolean(params?.has(jack.dataset.param)));
    }
    // Only rows beside a gutter (a patched param) are inset; the rest keep the full width.
    for (const row of article.querySelectorAll(".node-parameter-row")) {
      row.classList.toggle("rail-inset", Boolean(row.querySelector(".node-param-port.rail-patched")));
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
// has three strokes (top, bottom, slider side) and no outward edge, and runs
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

/** Inlet notch (UIDev): radius in css px and opacity 0..1, read once per GL rebuild. */
function nodeGraphRailNotch() {
  const state = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState : null;
  if (state && state.railNotchGen === state.gen && state.railNotch) return state.railNotch;
  const host = document.getElementById("nodeGraphWorkspace") || document.documentElement;
  const cs = getComputedStyle(host);
  const radius = Number.parseFloat(cs.getPropertyValue("--node-rail-notch-radius"));
  const opacity = Number.parseFloat(cs.getPropertyValue("--node-rail-notch-opacity"));
  const notch = { radius: Number.isFinite(radius) ? radius : 5, opacity: Number.isFinite(opacity) ? opacity : 0.5 };
  if (state) { state.railNotch = notch; state.railNotchGen = state.gen; }
  return notch;
}

/** Module border width (css px), the value the plate outline is drawn with. */
function nodeGraphRailBorderCss() {
  const style = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState.plateStyle : null;
  return Number.parseFloat(style?.getPropertyValue("--node-module-idle-stroke-width")) || 1;
}

/** Patched-param IO boxes of an open spawn rail, snapped to the batch's pixel grid. */
function nodeGraphModuleRailBoxes(batch, plate, toX, toY, zoom) {
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
  if (!el?.classList.contains("mod-rail-open") || el.dataset.faceLayout !== NodeGraphFaceLayout.spawn) return null;
  const body = el.querySelector(":scope > .dsp-node-body");
  const laid = body && typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(body, el) : null;
  if (!laid) return null;
  const grid = nodeGraphRailGrid(batch);
  const t = grid.t(Math.max(1, zoom));
  const left = grid.wall(toX(plate.x));
  const right = grid.wall(toX(plate.x)) + Math.max(1, Math.round(plate.w * zoom));
  const wallR = batch?.camera ? grid.wall(toX(plate.x + plate.w)) : right;
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
    boxes.push({ port, x, y, w: x1 - x, h: y1 - y, t, side });
  }
  return { el, body, laid, boxes, t, grid, left, right: wallR };
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
    const section = ({ port }) => {
      const key = port.dataset.param;
      const wd = widgets.find((x) => x.param === key || x.hpf === key || x.lpf === key);
      if (wd) return [faceBox.y + wd.y, faceBox.y + wd.y + wd.h];
      const row = nodeGraphModuleLayoutBox(port.closest(".node-parameter-row") || port, el);
      return row ? [row.y, row.y + row.h] : null;
    };
    const runs = boxes.map(section).filter(Boolean).sort((a, b) => a[0] - b[0]).reduce((out, r) => {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]);
      else out.push([...r]);
      return out;
    }, []);
    batch._over = true;
    // Gutters span wall to separator; the separator is the rail's inner edge.
    const inL = grid.x(x0 + NODE_GRAPH_RAIL_WIDTH_PX * zoom);
    const inR = grid.x(x0 + w - NODE_GRAPH_RAIL_WIDTH_PX * zoom);
    for (const [a, b] of runs) {
      const sy = grid.y(toY(plates[i].y + a));
      const sh = grid.y(toY(plates[i].y + b)) - sy;
      rect(left, sy, inL - left, sh, NodeGraphRailInk.gutter);
      rect(inL - t, sy, t, sh, NodeGraphRailInk.gutterEdge);
      rect(inR, sy, right - inR, sh, NodeGraphRailInk.gutter);
      rect(inR, sy, t, sh, NodeGraphRailInk.gutterEdge);
    }
    const border = grid.border(nodeGraphRailBorderCss(), zoom);
    const notch = nodeGraphRailNotch();
    for (const b of boxes) {
      // Through the border band: fill plus the top / bottom strokes.
      const bx = b.side < 0 ? b.x - border : b.x + b.w;
      rect(bx, b.y, border, b.h, NodeGraphRailInk.inletFill);
      rect(b.x, b.y, b.w, b.h, NodeGraphRailInk.inletFill);
      // Inlet notch: a half disc on the open edge in the inlet's jack colour
      // (nodeGraphPortWireColor: mod inlet purple, Additive cyan, ...), full
      // at the edge fading to clear inward; under the strokes and the label.
      const r = Math.min(notch.radius * zoom, b.h / 2);
      if (r > 0 && notch.opacity > 0 && typeof nodeGraphGlLinesHalfDiscFade === "function") {
        const io = b.port.classList.contains("parameter-output") ? "output" : "modulation";
        const css = typeof nodeGraphPortWireColor === "function" ? nodeGraphPortWireColor(plates[i].id, b.port.dataset.param, io) : "";
        const ink = nodeGraphRailRgba(css || "#b184ff");
        nodeGraphGlLinesHalfDiscFade(batch, b.side < 0 ? b.x : b.x + b.w, b.y + b.h / 2, r, -b.side, [ink[0], ink[1], ink[2], notch.opacity], [ink[0], ink[1], ink[2], 0]);
      }
      rect(bx, b.y, border, t, NodeGraphRailInk.inletStroke);
      rect(bx, b.y + b.h - t, border, t, NodeGraphRailInk.inletStroke);
      rect(b.x, b.y, b.w, t, NodeGraphRailInk.inletStroke);
      rect(b.x, b.y + b.h - t, b.w, t, NodeGraphRailInk.inletStroke);
      rect(b.side < 0 ? b.x + b.w - t : b.x, b.y, t, b.h, NodeGraphRailInk.inletStroke);
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
