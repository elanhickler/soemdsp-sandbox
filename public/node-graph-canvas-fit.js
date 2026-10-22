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

/** Tile rect (stage fractions) to stage px. Same numbers F writes into the tile's style. */
function nodeGraphCanvasTileRectPx(rect, stageW, stageH) {
  const r = typeof SoemMath !== "undefined" && typeof SoemMath.normalizeCanvasTileRect === "function"
    ? SoemMath.normalizeCanvasTileRect(rect)
    : rect;
  const sw = Math.max(1, Number(stageW) || 1);
  const sh = Math.max(1, Number(stageH) || 1);
  return { x: r.x * sw, y: r.y * sh, w: r.w * sw, h: r.h * sh, z: Number(r.z) || 0, rect: r };
}

/** User-facing module pin label. Empty-canvas copy uses this same phrase. */
const NODE_GRAPH_SHOW_IN_PERFORMANCE_VIEW_LABEL = "Show in performance view";
const NODE_GRAPH_EMPTY_CANVAS_LINE = "Canvas is empty. Turn on Show in performance view on a module.";

/**
 * Aspect ratios for the mini view. `window` is the live window size.
 * Every other entry is width / height. Height is the window height.
 * `free` is not in this table (0 would collide with window); ReferenceSize
 * treats it as the stored frame size so the GL pass can keep one scale `s`.
 */
const NODE_GRAPH_MINI_PERFORM_ASPECTS = Object.freeze({
  window: 0,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "9:16": 9 / 16,
  phonePortrait: NODE_GRAPH_CANVAS_PHONE_ASPECT,
  phoneLandscape: 19.5 / 9,
});

/**
 * Performance screen size the mini view reads the layout at.
 * "window": the size the F stage has on this window. Other aspects keep the
 * window height and take their ratio from NODE_GRAPH_MINI_PERFORM_ASPECTS.
 * "free": the stored frame {width, height} (zoom-1 world px) is the stage.
 */
function nodeGraphMiniPerformReferenceSize(aspect, winW, winH, size) {
  const w = Math.max(1, Number(winW) || 1);
  const h = Math.max(1, Number(winH) || 1);
  if (String(aspect) === "free") {
    const rw = Math.max(120, Math.min(1600, Number(size?.width ?? size?.w) || 360));
    let rh = Number(size?.height ?? size?.h);
    if (!Number.isFinite(rh)) rh = rw * (h / w);
    rh = Math.max(80, Math.min(1600, rh));
    return { w: rw, h: rh };
  }
  const ratio = NODE_GRAPH_MINI_PERFORM_ASPECTS[aspect];
  if (!(ratio > 0)) return { w, h };
  return { w: h * ratio, h };
}

/**
 * Where the mini view sits, in host CSS px, and its scale s = width / stage width.
 * camera: { originX, originY, zoom } maps zoom-1 world px to host px (Workspace anchor).
 * Screen frames use corner + offsetX / offsetY and stay inside the host.
 */
function nodeGraphMiniPerformFrameRect(settings, ref, hostW, hostH, camera = null) {
  const set = settings || {};
  const refW = Math.max(1, ref?.w || 1);
  const refH = Math.max(1, ref?.h || 1);
  const zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
  const workspace = set.anchor === "workspace";
  const hw = Math.max(1, Number(hostW) || 1);
  const hh = Math.max(1, Number(hostH) || 1);
  const stored = Math.max(120, Math.min(1600, Number(set.width) || 360));
  let width = Math.max(1, stored * (workspace ? zoom : 1));
  let height = width * (refH / refW);
  if (workspace) {
    const x = (Number(camera?.originX) || 0) + (Number(set.worldX) || 0) * zoom;
    const y = (Number(camera?.originY) || 0) + (Number(set.worldY) || 0) * zoom;
    return { x, y, w: width, h: height, s: width / refW };
  }
  if (width > hw) {
    width = hw;
    height = width * (refH / refW);
  }
  if (height > hh) {
    height = hh;
    width = height * (refW / refH);
  }
  const corner = String(set.corner || "bottomRight");
  const offX = Number.isFinite(Number(set.offsetX)) ? Number(set.offsetX) : 16;
  const offY = Number.isFinite(Number(set.offsetY)) ? Number(set.offsetY) : 16;
  const onLeft = corner === "topLeft" || corner === "bottomLeft";
  const onTop = corner === "topLeft" || corner === "topRight";
  let x = onLeft ? offX : hw - offX - width;
  let y = onTop ? offY : hh - offY - height;
  x = Math.max(0, Math.min(hw - width, x));
  y = Math.max(0, Math.min(hh - height, y));
  return { x, y, w: width, h: height, s: width / refW };
}

/** Nearest host corner to the frame centre, and the gaps from that corner. */
function nodeGraphMiniPerformCornerFromRect(x, y, w, h, hostW, hostH) {
  const right = x + w / 2 > hostW / 2;
  const bottom = y + h / 2 > hostH / 2;
  return {
    corner: `${bottom ? "bottom" : "top"}${right ? "Right" : "Left"}`,
    offsetX: right ? hostW - (x + w) : x,
    offsetY: bottom ? hostH - (y + h) : y,
  };
}

/**
 * Width change for a corner drag, in the same units as dx / dy.
 * The further axis wins: max(|dx|, |dy| * refW / refH), signed so an outward
 * drag grows the frame (opposite corner stays put at the call site).
 */
function nodeGraphMiniPerformResizeDelta(dx, dy, corner, refW, refH) {
  const aspect = Math.max(1e-6, Number(refW) || 1) / Math.max(1e-6, Number(refH) || 1);
  const name = String(corner || "bottomRight");
  const signX = name.endsWith("Right") ? 1 : -1;
  const signY = name.startsWith("bottom") ? 1 : -1;
  const ax = Math.abs(Number(dx) || 0);
  const ay = Math.abs(Number(dy) || 0) * aspect;
  return ax >= ay ? signX * (Number(dx) || 0) : signY * (Number(dy) || 0) * aspect;
}

/**
 * Corner drag with the opposite corner fixed and width/height independent.
 * Units match dx / dy (host px or zoom-1 world px). Used when aspect is Free.
 */
function nodeGraphMiniPerformResizeFreeRect(x, y, w, h, dx, dy, corner, minW, minH, maxW, maxH) {
  const name = String(corner || "bottomRight");
  const right = (Number(x) || 0) + (Number(w) || 0);
  const bottom = (Number(y) || 0) + (Number(h) || 0);
  const loW = Number.isFinite(Number(minW)) ? Number(minW) : 120;
  const loH = Number.isFinite(Number(minH)) ? Number(minH) : 80;
  const hiW = Number.isFinite(Number(maxW)) ? Number(maxW) : 1600;
  const hiH = Number.isFinite(Number(maxH)) ? Number(maxH) : 1600;
  let nw = (Number(w) || 0) + (name.endsWith("Right") ? Number(dx) || 0 : -(Number(dx) || 0));
  let nh = (Number(h) || 0) + (name.startsWith("bottom") ? Number(dy) || 0 : -(Number(dy) || 0));
  nw = Math.max(loW, Math.min(hiW, nw));
  nh = Math.max(loH, Math.min(hiH, nh));
  return {
    x: name.endsWith("Left") ? right - nw : Number(x) || 0,
    y: name.startsWith("top") ? bottom - nh : Number(y) || 0,
    w: nw,
    h: nh,
  };
}

/**
 * Stage-fraction delta for a pointer drag.
 * Denominator is stage width × scale × cameraZoom. Pass scale as the zoom-1
 * scale (stored width / stage width) and the live zoom, or pass the displayed
 * scale (frame.s, which already includes zoom) and cameraZoom 1.
 * At scale 1 and zoom 1 this matches F arrange (dx / stage width).
 */
function nodeGraphMiniPerformDragFraction(dxPx, dyPx, refW, refH, scale, cameraZoom = 1) {
  const z = cameraZoom > 0 ? cameraZoom : 1;
  const s = scale > 0 ? scale : 1;
  const sx = Math.max(1e-9, (Number(refW) || 1) * s * z);
  const sy = Math.max(1e-9, (Number(refH) || 1) * s * z);
  return { x: (Number(dxPx) || 0) / sx, y: (Number(dyPx) || 0) / sy };
}

/** Large centred frame for Enlarged. Same aspect as the stage. Session only. */
function nodeGraphMiniPerformEnlargedRect(hostW, hostH, refW, refH) {
  const hw = Math.max(1, Number(hostW) || 1);
  const hh = Math.max(1, Number(hostH) || 1);
  const rw = Math.max(1e-6, Number(refW) || 1);
  const rh = Math.max(1e-6, Number(refH) || 1);
  const aspect = rw / rh;
  let w = hw * 0.86;
  let h = w / aspect;
  if (h > hh * 0.86) {
    h = hh * 0.86;
    w = h * aspect;
  }
  return { x: (hw - w) / 2, y: (hh - h) / 2, w, h, s: w / rw };
}

/** Phone-guide rect inside a frame. orientation: "vertical" | "horizontal". */
function nodeGraphMiniPerformPhoneGuideRect(frameW, frameH, orientation) {
  const fw = Math.max(1, Number(frameW) || 1);
  const fh = Math.max(1, Number(frameH) || 1);
  const aspect = orientation === "horizontal"
    ? (1 / NODE_GRAPH_CANVAS_PHONE_ASPECT)
    : NODE_GRAPH_CANVAS_PHONE_ASPECT;
  let w;
  let h;
  if (fw / fh > aspect) {
    h = fh;
    w = h * aspect;
  } else {
    w = fw;
    h = w / aspect;
  }
  return { x: (fw - w) / 2, y: (fh - h) / 2, w, h };
}

/**
 * Font size so `text` is one line spanning nearly the full width.
 * measure(px) returns the advance width. Total side pad is 5% of cssW.
 */
function nodeGraphEmptyCanvasLinePx(cssW, text, measure) {
  const width = Math.max(1, Number(cssW) || 1);
  const target = width * 0.95;
  const sample = typeof measure === "function"
    ? measure
    : (px) => String(text || "").length * px * 0.6;
  let lo = 1;
  let hi = Math.max(8, width);
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (sample(mid) > target) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * One DVD step. box is { x, y, vx, vy, size } in CSS px; vx/vy are px per second.
 * Hitting an edge reverses that axis and keeps the sprite inside the frame.
 */
function nodeGraphEmptyCanvasDvdStep(box, dt, cssW, cssH) {
  const src = box || {};
  const w = Math.max(1, Number(cssW) || 1);
  const h = Math.max(1, Number(cssH) || 1);
  const size = Math.max(1, Math.min(Number(src.size) || 1, Math.min(w, h)));
  let x = (Number(src.x) || 0) + (Number(src.vx) || 0) * (Number(dt) || 0);
  let y = (Number(src.y) || 0) + (Number(src.vy) || 0) * (Number(dt) || 0);
  let vx = Number(src.vx) || 0;
  let vy = Number(src.vy) || 0;
  if (x < 0) {
    x = 0;
    vx = Math.abs(vx);
  } else if (x + size > w) {
    x = w - size;
    vx = -Math.abs(vx);
  }
  if (y < 0) {
    y = 0;
    vy = Math.abs(vy);
  } else if (y + size > h) {
    y = h - size;
    vy = -Math.abs(vy);
  }
  return { x, y, vx, vy, size };
}