// Module geometry SSOT — publish once after layout; wires/taps read, they do not
// remeasure every draw. Layout owners invalidate; Play/scopes are not owners.
//
// Attach points are zoom-surface coordinates (same space as wire SVG).

const nodeGraphModuleGeometryById = new Map(); // nodeId → ModuleGeometry
let nodeGraphModuleGeometryEpoch = 0;

/**
 * @typedef {{
 *   nodeId: string,
 *   epoch: number,
 *   box: { x: number, y: number, w: number, h: number },
 *   ports: Array<{ port: string, io: string, x: number, y: number, visible: boolean }>,
 *   paramJacks: Array<{ key: string, kind: string, x: number, y: number, visible: boolean }>,
 * }} ModuleGeometry
 */

function nodeGraphModuleGeometryKey(nodeId, port, io) {
  return `${String(nodeId || "")}\0${String(io || "")}\0${String(port || "")}`;
}

function nodeGraphModuleGeometryInvalidate(nodeId) {
  const id = String(nodeId || "");
  if (!id) {
    nodeGraphModuleGeometryById.clear();
    nodeGraphModuleGeometryEpoch += 1;
    return;
  }
  nodeGraphModuleGeometryById.delete(id);
  nodeGraphModuleGeometryEpoch += 1;
}

function nodeGraphModuleGeometryInvalidateAll() {
  nodeGraphModuleGeometryById.clear();
  nodeGraphModuleGeometryEpoch += 1;
}

// B-100: shift a module's published geometry by a move delta (layout px),
// without re-measuring. Called by positionNodeGraphNode so every GL / wire
// reader sees the new position in the same frame as the DOM chrome.
function nodeGraphModuleGeometryTranslate(nodeId, dx, dy) {
  const geo = nodeGraphModuleGeometryById.get(String(nodeId || ""));
  if (!geo || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  if (geo.box) {
    geo.box = { ...geo.box, x: geo.box.x + dx, y: geo.box.y + dy };
  }
  const shift = (list) => (Array.isArray(list)
    ? list.map((p) => (p && p.visible !== false ? { ...p, x: p.x + dx, y: p.y + dy } : p))
    : list);
  geo.ports = shift(geo.ports);
  geo.paramJacks = shift(geo.paramJacks);
  nodeGraphModuleGeometryEpoch += 1;
  geo.epoch = nodeGraphModuleGeometryEpoch;
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp?._portCenterFrameCache?.clear) {
    nodeGraphMvp._portCenterFrameCache.clear();
  }
}

function nodeGraphModuleGeometryGet(nodeId) {
  return nodeGraphModuleGeometryById.get(String(nodeId || "")) || null;
}

function nodeGraphModuleGeometryAttach(nodeId, port, io) {
  const geo = nodeGraphModuleGeometryGet(nodeId);
  if (!geo) return null;
  const wantPort = String(port || "");
  const wantIo = String(io || "");
  if (wantIo === "modulation" || wantIo === "graph") {
    const hit = geo.paramJacks.find((j) => j.key === wantPort && j.kind === wantIo && j.visible);
    return hit ? { x: hit.x, y: hit.y } : null;
  }
  const hit = geo.ports.find((p) => p.port === wantPort && p.io === wantIo && p.visible)
    // A param thru (rail outlet) is published as a param jack, not a signal port.
    || (wantIo === "output" ? geo.paramJacks.find((j) => j.key === wantPort && j.kind === "output" && j.visible) : null);
  return hit ? { x: hit.x, y: hit.y } : null;
}

/**
 * Publish geometry for one module from current DOM (one-shot after layout).
 * Callers: applyNodeGraphModuleLayout, module move settle — NOT Play/scope loops.
 */
// Layout pixels, before the camera transform. ancestor omitted: the element's
// own box in zoom-surface space. ancestor set: the box inside that element.
function nodeGraphModuleLayoutBox(el, ancestor) {
  if (!(el instanceof Element)) return null;
  if (ancestor instanceof Element && el !== ancestor) {
    let x = 0;
    let y = 0;
    let node = el;
    while (node && node !== ancestor) {
      x += node.offsetLeft;
      y += node.offsetTop;
      const next = node.offsetParent;
      if (!next || (next !== ancestor && !ancestor.contains(next))) return null;
      node = next;
    }
    if (node !== ancestor) return null;
    if (!(el.offsetWidth > 0) || !(el.offsetHeight > 0)) return null;
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  const surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null;
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== surface) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const next = node.offsetParent;
    if (!next || (surface && next !== surface && !surface.contains(next))) break;
    node = next;
  }
  if (!(el.offsetWidth > 0) || !(el.offsetHeight > 0)) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function nodeGraphModuleLayoutPatchPoint(el, moduleEl, origin, io) {
  const laid = nodeGraphModuleLayoutBox(el, moduleEl);
  if (!laid || !origin) return null;
  let localX = laid.x;
  if (el.classList.contains("node-param-port")) {
    const side = typeof nodeGraphParameterPatchPointSide === "function"
      ? nodeGraphParameterPatchPointSide(el, io)
      : null;
    localX = side === "right" ? laid.x + laid.w
      : side === "left" ? laid.x
        : laid.x + laid.w * 0.5;
  } else {
    const cssX = getComputedStyle(el).getPropertyValue("--node-patch-point-x").trim();
    const percentMatch = cssX.match(/^(-?\d+(?:\.\d+)?)%$/);
    const pixelMatch = cssX.match(/^(-?\d+(?:\.\d+)?)px$/);
    const fallback = io === "output" ? 1 : 0;
    const ratio = percentMatch ? Number(percentMatch[1]) / 100 : fallback;
    localX = pixelMatch
      ? laid.x + Number(pixelMatch[1])
      : laid.x + laid.w * Math.max(0, Math.min(1, ratio));
  }
  return {
    x: origin.x + localX,
    y: origin.y + laid.y + laid.h * 0.5,
  };
}

function nodeGraphModuleGeometryPublishFromDom(nodeId, options = {}) {
  const id = String(nodeId || "");
  if (!id || typeof nodeGraphNodeElement !== "function") {
    return null;
  }
  const el = nodeGraphNodeElement(id);
  if (!el || !el.isConnected) {
    nodeGraphModuleGeometryById.delete(id);
    return null;
  }
  // display:none (zoomed offscreen) has no rect. Keep the last real attaches
  // so a cable still has both ends when one module is outside the view.
  const kept = options.store === false ? null : nodeGraphModuleGeometryById.get(id);
  const asleep = el.hidden || el.classList.contains("viewport-asleep");
  if (asleep && kept?.box?.w > 1 && kept?.box?.h > 1) {
    return kept;
  }
  const surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null;
  if (!surface) return null;

  // options.toSurface / store:false: measure against another surface (a perform tile) without publishing.
  const toSurface = options.toSurface || ((clientX, clientY) => {
    if (typeof nodeGraphClientToZoomSurfacePoint === "function") {
      return nodeGraphClientToZoomSurfacePoint(clientX, clientY);
    }
    const sr = surface.getBoundingClientRect();
    return { x: clientX - sr.left, y: clientY - sr.top };
  });

  const useLayout = !options.toSurface;
  let box = null;
  if (useLayout) {
    const origin = nodeGraphModuleLayoutBox(el);
    if ((!origin || !(origin.w > 1) || !(origin.h > 1)) && kept?.box?.w > 1 && kept?.box?.h > 1) {
      return kept;
    }
    if (origin && origin.w > 1 && origin.h > 1) {
      box = { x: origin.x, y: origin.y, w: origin.w, h: origin.h };
    }
  }
  if (!box) {
    const boxRect = el.getBoundingClientRect();
    if ((!(boxRect.width > 1) || !(boxRect.height > 1)) && kept?.box?.w > 1 && kept?.box?.h > 1) {
      return kept;
    }
    const boxTl = toSurface(boxRect.left, boxRect.top);
    const boxBr = toSurface(boxRect.right, boxRect.bottom);
    box = {
      x: boxTl.x,
      y: boxTl.y,
      w: Math.max(0, boxBr.x - boxTl.x),
      h: Math.max(0, boxBr.y - boxTl.y),
    };
  }

  const ports = [];
  for (const portEl of el.querySelectorAll(":scope .node-port:not(.node-param-port)")) {
    const port = String(portEl.dataset?.port || "").trim();
    const io = String(portEl.dataset?.io || "").trim();
    if (!port || (io !== "input" && io !== "output")) continue;
    const laidPoint = useLayout ? nodeGraphModuleLayoutPatchPoint(portEl, el, box, io) : null;
    const visible = laidPoint
      ? true
      : (typeof nodeGraphPortElementIsLayoutVisible === "function"
        ? nodeGraphPortElementIsLayoutVisible(portEl)
        : (portEl.getBoundingClientRect().width > 0.5));
    if (!visible) {
      ports.push({ port, io, x: 0, y: 0, visible: false });
      continue;
    }
    const center = laidPoint || (typeof nodeGraphElementPatchPointClientCenter === "function"
      ? nodeGraphElementPatchPointClientCenter(portEl, io)
      : (() => {
        const r = portEl.getBoundingClientRect();
        return { x: r.left + r.width * (io === "output" ? 1 : 0), y: r.top + r.height * 0.5 };
      })());
    const pt = laidPoint || toSurface(center.x, center.y);
    ports.push({ port, io, x: pt.x, y: pt.y, visible: true });
  }

  const paramJacks = [];
  for (const jack of el.querySelectorAll(":scope .node-param-port")) {
    const key = String(jack.dataset?.param || jack.dataset?.graphInput || jack.dataset?.port || "").trim();
    if (!key) continue;
    let kind = "modulation";
    if (jack.classList.contains("graph-input")) kind = "graph";
    else if (jack.classList.contains("parameter-output") || jack.dataset?.io === "output") kind = "output";
    else if (jack.dataset?.io === "modulation") kind = "modulation";
    const jackIo = kind === "output" ? "output" : kind;
    const laidPoint = useLayout ? nodeGraphModuleLayoutPatchPoint(jack, el, box, jackIo) : null;
    const visible = laidPoint
      ? true
      : (typeof nodeGraphPortElementIsLayoutVisible === "function"
        ? nodeGraphPortElementIsLayoutVisible(jack)
        : (jack.getBoundingClientRect().width > 0.5));
    if (!visible) {
      paramJacks.push({ key, kind, x: 0, y: 0, visible: false });
      continue;
    }
    const center = laidPoint || (typeof nodeGraphElementPatchPointClientCenter === "function"
      ? nodeGraphElementPatchPointClientCenter(jack, jackIo)
      : (() => {
        const r = jack.getBoundingClientRect();
        return { x: kind === "output" ? r.right : r.left, y: r.top + r.height * 0.5 };
      })());
    const pt = laidPoint || toSurface(center.x, center.y);
    paramJacks.push({ key, kind, x: pt.x, y: pt.y, visible: true });
  }

  /** @type {ModuleGeometry} */
  const geo = {
    nodeId: id,
    epoch: nodeGraphModuleGeometryEpoch,
    box,
    ports,
    paramJacks,
  };
  if (options.store !== false) nodeGraphModuleGeometryById.set(id, geo);
  return geo;
}

/** Publish every connected module currently in the workspace. */
function nodeGraphModuleGeometryPublishVisible() {
  const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
  for (const node of nodes) {
    const id = String(node?.id || "");
    if (!id) continue;
    if (typeof nodeGraphPatchNodeIsVisible === "function" && !nodeGraphPatchNodeIsVisible(id)) {
      // Still publish if metamodule proxy targets need shell geometry on Root.
      const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
      if (!el?.isConnected) continue;
    }
    nodeGraphModuleGeometryPublishFromDom(id);
  }
}

/**
 * After article band layout settles — publish this module's attaches once.
 * Wired from applyNodeGraphModuleLayout.
 */
function nodeGraphModuleGeometryPublishAfterLayout(article, patchNode) {
  const id = String(patchNode?.id || article?.dataset?.node || "");
  if (!id) return;
  // Double-rAF was the old “wait for DOM” culture. One rAF after layout apply
  // is enough to publish; Play must not keep re-publishing.
  if (article?._geometryPublishRaf) {
    cancelAnimationFrame(article._geometryPublishRaf);
  }
  article._geometryPublishRaf = requestAnimationFrame(() => {
    article._geometryPublishRaf = 0;
    nodeGraphModuleGeometryPublishFromDom(id);
  });
}
