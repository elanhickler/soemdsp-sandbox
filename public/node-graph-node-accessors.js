function nodeGraphLabel(node, port) {
  return `${nodeGraphNodeDisplayName(node)}.${port}`;
}

function nodeGraphNodeSelector(node) {
  return `.dsp-node[data-node="${CSS.escape(node)}"]`;
}

function nodeGraphNodeElement(node) {
  return document.querySelector(nodeGraphNodeSelector(node));
}


/** Text Box (and under-construction plates) mount under #nodeWireSvg (B-055). */
function nodeGraphModuleIsAnnotationType(type) {
  const layout = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions?.[type]?.layout
    : null;
  return layout === "textBox";
}

function nodeGraphModuleMountContainer(type) {
  if (nodeGraphModuleIsAnnotationType(type)) {
    return document.getElementById("nodeGraphAnnotationNodes")
      || document.getElementById("nodeGraphNodes");
  }
  return document.getElementById("nodeGraphNodes");
}

function nodeGraphModuleMountContainers() {
  const primary = document.getElementById("nodeGraphNodes");
  const annotation = document.getElementById("nodeGraphAnnotationNodes");
  const list = [];
  if (primary) list.push(primary);
  if (annotation && annotation !== primary) list.push(annotation);
  return list;
}


function nodeGraphNodeType(node) {
  return nodeGraphNodeElement(node)?.dataset.nodeType || nodeGraphPatchNodeType(node);
}

function nodeGraphNodeDisplayName(node) {
  return typeof nodeGraphPatchNodeEffectiveDisplay === "function"
    ? nodeGraphPatchNodeEffectiveDisplay(node)
    : nodeGraphPatchNodeTitle(node);
}

function nodeGraphReadNodeNumber(node, key) {
  // Prefer patch domain (may exceed HTML range min/max).
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(node) : null;
  if (patchNode?.params && Object.hasOwn(patchNode.params, key)) {
    const fromPatch = Number(patchNode.params[key]);
    if (Number.isFinite(fromPatch)) {
      return fromPatch;
    }
  }
  const input = nodeGraphNodeElement(node)?.querySelector(
    `input[data-param="${CSS.escape(key)}"]`,
  );
  const fromDomain = Number(input?.dataset?.domainValue);
  if (Number.isFinite(fromDomain)) {
    return fromDomain;
  }
  const value = Number(input?.value);
  return Number.isFinite(value)
    ? value
    : nodeGraphParameterFallback(nodeGraphNodeType(node), key);
}

function nodeGraphReadPatchParameterValue(node, key) {
  const patchNode = typeof node === "string" ? nodeGraphPatchNode(node) : node;
  if (!patchNode) {
    return nodeGraphParameterFallback(nodeGraphPatchNodeType(node), key);
  }
  const value = Number(patchNode.params?.[key]);
  return Number.isFinite(value)
    ? value
    : nodeGraphParameterFallback(patchNode.type, key);
}

function nodeGraphParameterFallback(type, key) {
  const parameter = nodeGraphModuleDefinitions[type]?.parameters?.find(
    (candidate) => candidate.key === key,
  );
  const value = Number(parameter?.defaultValue);
  return Number.isFinite(value) ? value : 0;
}

// Normalized parameter metadata, stored per patch node. An entry is reused
// while the patch object (replaced on every commit / load / undo), the node's
// type, and the raw paramMeta[key] object are all the same; anything else
// re-normalizes. nodeGraphClearParameterMetadataCache() drops everything.
let nodeGraphParameterMetadataCache = new WeakMap();
let nodeGraphParameterMetadataCachePatch = null;

function nodeGraphClearParameterMetadataCache() {
  nodeGraphParameterMetadataCache = new WeakMap();
  nodeGraphParameterMetadataCachePatch = null;
}

function nodeGraphReadPatchParameterMetadataUncached(patchNode, node, key) {
  const type = patchNode?.type || nodeGraphPatchNodeType(node);
  return normalizeNodeGraphPatchParameterMetadata(
    type,
    key,
    patchNode?.paramMeta?.[key],
  ) || nodeGraphParameterDefinitionMetadata(
    nodeGraphModuleDefinitions[type]?.parameters?.find((parameter) => parameter.key === key),
  );
}

function nodeGraphReadPatchParameterMetadata(node, key) {
  const patchNode = typeof node === "string" ? nodeGraphPatchNode(node) : node;
  if (!patchNode || typeof patchNode !== "object") {
    return nodeGraphReadPatchParameterMetadataUncached(patchNode, node, key);
  }
  const patch = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.patch : null;
  if (nodeGraphParameterMetadataCachePatch !== patch) {
    nodeGraphParameterMetadataCache = new WeakMap();
    nodeGraphParameterMetadataCachePatch = patch;
  }
  const raw = patchNode.paramMeta?.[key];
  let byKey = nodeGraphParameterMetadataCache.get(patchNode);
  const hit = byKey?.get(key);
  if (hit && hit.raw === raw && hit.paramMeta === patchNode.paramMeta && hit.type === patchNode.type) {
    // Shallow copy: callers may tweak top-level fields on what they get.
    return hit.result && typeof hit.result === "object" ? { ...hit.result } : hit.result;
  }
  const result = nodeGraphReadPatchParameterMetadataUncached(patchNode, node, key);
  if (!byKey) {
    byKey = new Map();
    nodeGraphParameterMetadataCache.set(patchNode, byKey);
  }
  byKey.set(key, {
    paramMeta: patchNode.paramMeta,
    raw,
    result: result && typeof result === "object" ? { ...result } : result,
    type: patchNode.type,
  });
  return result;
}

function nodeGraphReadNodeParameterMetadata(node, key) {
  const input = nodeGraphNodeElement(node)?.querySelector(
    `input[data-param="${CSS.escape(key)}"]`,
  );
  if (!input) {
    const patchMetadata = nodeGraphPatchNode(node)?.paramMeta?.[key];
    if (patchMetadata) {
      return {
        linearSmoothing: patchMetadata.linearSmoothing !== false,
        max: Number(patchMetadata.max ?? 1),
        min: Number(patchMetadata.min ?? 0),
        smoothingSeconds: normalizeNodeGraphMetadataSmoothingSeconds(patchMetadata.smoothingSeconds),
        wraparound: Boolean(patchMetadata.wraparound),
      };
    }
    const definition = nodeGraphModuleDefinitions[nodeGraphPatchNodeType(node)];
    const parameter = definition?.parameters?.find((candidate) => candidate.key === key);
    return {
      linearSmoothing: parameter?.linearSmoothing !== false,
      max: Number(parameter?.max ?? 1),
      min: Number(parameter?.min ?? 0),
      smoothingSeconds: normalizeNodeGraphMetadataSmoothingSeconds(parameter?.smoothingSeconds),
      wraparound: Boolean(parameter?.wraparound),
    };
  }
  return {
    linearSmoothing: nodeSliderShouldUseLinearSmoothing(input),
    max: Number(input.max),
    min: Number(input.min),
    smoothingSeconds: nodeSliderSmoothingSeconds(input),
    wraparound: nodeSliderShouldWraparound(input),
  };
}

function nodeGraphParameterKey(node, parameter) {
  return `${node}.${parameter}`;
}
