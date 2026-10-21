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
// param gets one inlet box the full rail width (no padding) and 16 px tall (the
// label height), centred on its row: #111 fill, 1px #889 stroke, #dde label. Wires end at the rail's outer
// edge with no end dot; there are no jack half circles on rail params.
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

/** Draw open rails (gutters + patched-param inlet boxes + labels) in one pass. */
function nodeGraphModuleRailsDrawGl(batch, plates, toX, toY, zoom, cssW, cssH) {
  if (typeof nodeGraphGlLinesRect !== "function" || typeof nodeGraphModuleLayoutBox !== "function") return;
  const rect = (x, y, w, h, css) => nodeGraphGlLinesRect(batch, x, y, w, h, nodeGraphRailRgba(css));
  const frame = (x, y, w, h, t, css, sides) => {
    if (sides.top) rect(x, y, w, t, css);
    if (sides.bottom) rect(x, y + h - t, w, t, css);
    if (sides.left) rect(x, y, t, h, css);
    if (sides.right) rect(x + w - t, y, t, h, css);
  };
  const all = { top: true, bottom: true, left: true, right: true };
  for (let i = 0; i < plates.length; i += 1) {
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plates[i].id) : null;
    if (!el?.classList.contains("mod-rail-open") || el.dataset.faceLayout !== NodeGraphFaceLayout.spawn) continue;
    const body = el.querySelector(":scope > .dsp-node-body");
    const laid = body ? nodeGraphModuleLayoutBox(body, el) : null;
    if (!laid) continue;
    const x0 = toX(plates[i].x + laid.x);
    const y0 = toY(plates[i].y + laid.y);
    const w = laid.w * zoom;
    const h = laid.h * zoom;
    if (!batch.camera && (x0 > cssW || y0 > cssH || x0 + w < 0 || y0 + h < 0)) continue;
    const rw = NODE_GRAPH_RAIL_WIDTH_PX * zoom;
    const t = Math.max(1, zoom);
    const tags = [];
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
    const ports = [...body.querySelectorAll(".node-param-port.rail-patched")].filter((port) => port.offsetParent);
    const runs = ports.map(section).filter(Boolean).sort((a, b) => a[0] - b[0]).reduce((out, r) => {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]);
      else out.push([...r]);
      return out;
    }, []);
    batch._over = true;
    for (const [a, b] of runs) {
      const sy = toY(plates[i].y + a);
      const sh = (b - a) * zoom;
      rect(x0, sy, rw, sh, NodeGraphRailInk.gutter);
      rect(x0 + rw - t, sy, t, sh, NodeGraphRailInk.gutterEdge);
      rect(x0 + w - rw, sy, rw, sh, NodeGraphRailInk.gutter);
      rect(x0 + w - rw, sy, t, sh, NodeGraphRailInk.gutterEdge);
    }
    for (const port of ports) {
      const box = nodeGraphModuleLayoutBox(port, el);
      if (!box || !(box.w > 1)) continue;
      const bx = toX(plates[i].x + box.x);
      const bw = box.w * zoom;
      const bh = Math.min(box.h, NODE_GRAPH_RAIL_INLET_H_PX) * zoom;
      const by = toY(plates[i].y + box.y) + (box.h * zoom - bh) / 2;
      rect(bx, by, bw, bh, NodeGraphRailInk.inletFill);
      frame(bx, by, bw, bh, t, NodeGraphRailInk.inletStroke, all);
      tags.push({ text: port.dataset.railLabel || "", x: bx + bw / 2, y: by + bh / 2, w: bw - 2 * t });
    }
    batch._over = false;
    if (typeof nodeGraphGlLinesText !== "function") continue;
    for (const tag of tags) {
      const o = {
        px: Math.max(4, NODE_GRAPH_RAIL_FONT_PX * zoom), rgba: nodeGraphRailRgba(NodeGraphRailInk.text),
        align: "center", baseline: "middle", weight: 650, maxWidth: tag.w,
      };
      nodeGraphGlLinesText(batch, tag.text, tag.x, tag.y, typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts(o) : o);
    }
  }
}
