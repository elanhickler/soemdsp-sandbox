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
const NODE_GRAPH_RAIL_WIDTH_PX = 40;
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
  const use = (id, param) => {
    if (!id || !param) return;
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

/** Layout 3 rail ports show the short label; Layout 1 IO band labels are unchanged. */
function nodeGraphRailPortLabel(type, label) {
  return nodeGraphModuleFaceLayout(type) === NodeGraphFaceLayout.railsOnly
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
