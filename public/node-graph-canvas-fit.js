// Canvas fit math shared by the F layout canvas and the Mini Performance View.
// Pure functions. Inputs and outputs are plain numbers, so both callers get
// the same rects for the same reference size (MINI_PERFORM_VIEW_PLAN MP-2).

/** Portrait phone aspect (width / height), same as the arrange-mode guides. */
const NODE_GRAPH_CANVAS_PHONE_ASPECT = 9 / 19.5;

/** Whole-module fit margin: 4% of the smaller tile side, at least 12 px, never more than a quarter of it. */
const NODE_GRAPH_WHOLE_MODULE_PAD_FRACTION = 0.04;
const NODE_GRAPH_WHOLE_MODULE_PAD_MIN_PX = 12;

function nodeGraphWholeModulePadPx(tw, th) {
  const side = Math.min(tw, th);
  return Math.min(side / 4, Math.max(NODE_GRAPH_WHOLE_MODULE_PAD_MIN_PX, side * NODE_GRAPH_WHOLE_MODULE_PAD_FRACTION));
}

/**
 * Whole-module tile: the module keeps its zoom-1 size and gets ONE uniform
 * scale (contain, centered) inside the tile, with the shared padding.
 * @returns {{ s: number, ox: number, oy: number, pad: number } | null}
 */
function nodeGraphWholeModuleFitBox(tw, th, natW, natH) {
  if (!(tw > 0 && th > 0 && natW > 0 && natH > 0)) return null;
  const pad = nodeGraphWholeModulePadPx(tw, th);
  const s = Math.max(0.01, Math.min((tw - 2 * pad) / natW, (th - 2 * pad) / natH));
  return { s, ox: (tw - natW * s) / 2, oy: (th - natH * s) / 2, pad };
}

/** Contain fit with no padding (display faces in the mini view). */
function nodeGraphContainFitBox(tw, th, w, h) {
  if (!(tw > 0 && th > 0 && w > 0 && h > 0)) return null;
  const s = Math.min(tw / w, th / h);
  return { s, ox: (tw - w * s) / 2, oy: (th - h * s) / 2 };
}

/** Tile rect (stage fractions) to stage px. Same numbers F writes into the tile's style. */
function nodeGraphCanvasTileRectPx(rect, stageW, stageH) {
  const r = typeof SoemMath !== "undefined" && typeof SoemMath.normalizeCanvasTileRect === "function"
    ? SoemMath.normalizeCanvasTileRect(rect)
    : rect;
  const sw = Math.max(1, Number(stageW) || 1);
  const sh = Math.max(1, Number(stageH) || 1);
  return { x: r.x * sw, y: r.y * sh, w: r.w * sw, h: r.h * sh, z: Number(r.z) || 0, rect: r };
}

/**
 * Reference performance screen size for the mini view.
 * "window": the size the F stage has on this window. Phone presets keep the
 * window height and take the phone aspect.
 */
function nodeGraphMiniPerformReferenceSize(reference, winW, winH) {
  const w = Math.max(1, Number(winW) || 1);
  const h = Math.max(1, Number(winH) || 1);
  if (reference === "phonePortrait") return { w: h * NODE_GRAPH_CANVAS_PHONE_ASPECT, h };
  if (reference === "phoneLandscape") return { w: h / NODE_GRAPH_CANVAS_PHONE_ASPECT, h };
  return { w, h };
}

/**
 * Where the mini view sits, in host CSS px, and its scale s = width / reference width.
 * camera: { originX, originY, zoom } maps zoom-1 world px to host px (Workspace anchor).
 */
function nodeGraphMiniPerformFrameRect(settings, ref, hostW, hostH, camera = null) {
  const set = settings || {};
  const refW = Math.max(1, ref?.w || 1);
  const refH = Math.max(1, ref?.h || 1);
  const zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
  const workspace = set.anchor === "workspace";
  const width = Math.max(1, (Number(set.width) || 360) * (workspace ? zoom : 1));
  const height = width * (refH / refW);
  let x;
  let y;
  if (workspace) {
    x = (Number(camera?.originX) || 0) + (Number(set.worldX) || 0) * zoom;
    y = (Number(camera?.originY) || 0) + (Number(set.worldY) || 0) * zoom;
  } else {
    const m = Math.max(0, Number(set.margin) || 0);
    const corner = String(set.corner || "bottomRight");
    x = corner.endsWith("Left") || corner === "topLeft" ? m : hostW - m - width;
    y = corner.startsWith("top") ? m : hostH - m - height;
  }
  return { x, y, w: width, h: height, s: width / refW };
}