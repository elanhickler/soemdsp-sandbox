// Mini Performance View, GL pass (docs/MINI_PERFORM_VIEW_PLAN.md MP-3).
// WebGL2 through gl-line-renderer on the shared context. No 2D drawing, no
// DOM copies of faces: display tiles draw the module's display canvases as
// textured quads; whole-module, Text Box and not-yet-GPU tiles run the GL
// graph's own module pass (its `view` path) aimed at a host over the tile.
// Everything is laid out at the reference screen size and scaled by one
// factor s (zoom-1 / no reflow).

const NODE_GRAPH_MINI_PERFORM_BACKDROP = [0, 0, 0, 1];
const NODE_GRAPH_MINI_PERFORM_FRAME = [1, 1, 1, 0.28];
const NODE_GRAPH_MINI_PERFORM_TEXT = [0.8, 0.82, 0.86, 1];

function nodeGraphGlMiniPerformView() {
  let view = document.getElementById("nodeMiniPerformView");
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return null;
  if (!view || view.parentElement !== host) {
    view?.remove();
    view = document.createElement("div");
    view.id = "nodeMiniPerformView";
    view.className = "node-mini-perform-view";
    view.setAttribute("aria-hidden", "true");
    const canvas = document.createElement("canvas");
    canvas.id = "nodeGlGraphMiniPerform";
    canvas.className = "node-mini-perform-canvas";
    view.append(canvas);
    view._moduleHosts = new Map();
    const refreshMarks = () => {
      if (typeof nodeGraphGlMiniPerformPresent === "function") nodeGraphGlMiniPerformPresent();
    };
    view.addEventListener("pointerenter", () => { view._miniHover = true; refreshMarks(); });
    view.addEventListener("pointerleave", () => { view._miniHover = false; refreshMarks(); });
    // Window capture: runs before the document-level capture handlers
    // (selection / value drags) that would otherwise swallow the press.
    if (!nodeGraphGlMiniPerformView._bound) {
      nodeGraphGlMiniPerformView._bound = true;
      window.addEventListener("pointerdown", (event) => {
        const v = document.getElementById("nodeMiniPerformView");
        if (!v || v.hidden || !v.contains(event.target)) return;
        if (typeof beginNodeGraphMiniPerformPointer === "function") beginNodeGraphMiniPerformPointer(event);
      }, true);
    }
    host.append(view);
  }
  return view;
}

function nodeGraphGlMiniPerformTextOpts(opts) {
  return typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts(opts) : opts;
}

function nodeGraphGlMiniPerformHide() {
  const view = document.getElementById("nodeMiniPerformView");
  if (view) view.hidden = true;
}

/** Display canvases of a module in zoom-1 layout px relative to the module. */
function nodeGraphGlMiniPerformDisplays(el) {
  const out = [];
  if (!el || typeof nodeGraphModuleLayoutBox !== "function") return out;
  const canvases = el.querySelectorAll(".node-display-canvas");
  for (let i = 0; i < canvases.length; i += 1) {
    const c = canvases[i];
    if (!(c.width > 1) || !(c.height > 1) || c.closest("[hidden]")) continue;
    const box = nodeGraphModuleLayoutBox(c, el);
    if (box && box.w > 1 && box.h > 1) out.push({ canvas: c, ...box });
  }
  return out;
}

/** Vertical bands of a whole module to show: the In/Out band is cropped out (F hides it). */
function nodeGraphGlMiniPerformBands(el, nat) {
  const io = el.classList.contains("io-hidden") ? null : el.querySelector(":scope > .dsp-node-io-section");
  const ioBox = io && typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(io, el) : null;
  if (!ioBox || !(ioBox.h > 1)) return [{ y0: 0, y1: nat.h }];
  const bands = [];
  if (ioBox.y > 0.5) bands.push({ y0: 0, y1: ioBox.y });
  if (ioBox.y + ioBox.h < nat.h - 0.5) bands.push({ y0: ioBox.y + ioBox.h, y1: nat.h });
  return bands.length ? bands : [{ y0: 0, y1: nat.h }];
}

/**
 * Run the GL graph module pass for one module into `host`. Same mechanism as
 * nodeGraphGlGraphPresentTile: the workspace state is saved and restored, so
 * the workspace picture and its held mesh are untouched.
 */
function nodeGraphGlMiniPerformPresentModule(host, el, id, scale, camY, camX = 0) {
  if (typeof nodeGraphGlGraphPresent !== "function" || typeof nodeGraphGlGraphRebuildPlates !== "function") return false;
  const mr = el.getBoundingClientRect();
  const wz = el.offsetWidth > 0 ? mr.width / el.offsetWidth : 0;
  if (!(wz > 0)) return false;
  const state = nodeGraphGlGraphState;
  const keys = ["canvas", "wireCanvas", "dotsCanvas", "wires", "plates", "displays", "chrome", "thick", "dotSize", "frameCamera", "view"];
  const saved = {};
  for (const key of keys) saved[key] = state[key];
  state.view = {
    host,
    ids: new Set([id]),
    zoom: scale,
    cam: { x: camX, y: camY },
    toWorld: (clientX, clientY) => ({ x: (clientX - mr.left) / wz, y: (clientY - mr.top) / wz }),
  };
  state.canvas = host._miniCanvas || null;
  state.wireCanvas = host._miniWires || null;
  state.dotsCanvas = host._miniDots || null;
  state.wires = [];
  let ok = false;
  try {
    nodeGraphGlGraphRebuildPlates();
    ok = nodeGraphGlGraphPresent() !== false;
    host._miniCanvas = state.canvas;
    host._miniWires = state.wireCanvas;
    host._miniDots = state.dotsCanvas;
  } finally {
    for (const key of keys) state[key] = saved[key];
  }
  return ok;
}

function nodeGraphGlMiniPerformModuleHost(view, key) {
  let host = view._moduleHosts.get(key);
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.className = "node-mini-perform-module";
    view.append(host);
    view._moduleHosts.set(key, host);
  }
  host._miniUsed = true;
  return host;
}

function nodeGraphGlMiniPerformPlaceHost(host, x, y, w, h, z) {
  const st = host.style;
  st.left = `${x}px`;
  st.top = `${y}px`;
  st.width = `${Math.max(1, w)}px`;
  st.height = `${Math.max(1, h)}px`;
  st.zIndex = String(2 + z);
}

/** Whole module (or Text Box / plate-only) tile through the module pass. */
function nodeGraphGlMiniPerformModuleTile(view, tile, el, frame, order) {
  const nat = typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(el) : null;
  if (!nat || !(nat.w > 1) || !(nat.h > 1)) return;
  const bands = nodeGraphGlMiniPerformBands(el, nat);
  const shownH = bands.reduce((sum, b) => sum + (b.y1 - b.y0), 0);
  // F's fit, computed at reference size, then scaled by s.
  const fit = nodeGraphWholeModuleFitBox(tile.refW, tile.refH, nat.w, shownH);
  if (!fit) return;
  const scale = fit.s * frame.s;
  let y = tile.y + fit.oy * frame.s;
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    const h = (band.y1 - band.y0) * scale;
    const host = nodeGraphGlMiniPerformModuleHost(view, `${tile.nodeId}:${i}`);
    const hx = tile.x + fit.ox * frame.s;
    nodeGraphGlMiniPerformPlaceHost(host, hx, y, nat.w * scale, h, order);
    nodeGraphGlMiniPerformPresentModule(host, el, tile.nodeId, scale, band.y0);
    view._miniMaps?.push({
      nodeId: tile.nodeId,
      x: hx,
      y,
      w: nat.w * scale,
      h,
      scale,
      layoutX: 0,
      layoutY: band.y0,
    });
    y += h;
  }
}

const NODE_GRAPH_MINI_PERFORM_EMPTY_FAMILY = "Cascadia Mono, Consolas, monospace";

function nodeGraphEmptyCanvasDvdBox(cssW, cssH, now) {
  const size = Math.max(8, 0.28 * Math.min(cssW, cssH));
  const prev = nodeGraphEmptyCanvasDvdBox._box;
  const t0 = nodeGraphEmptyCanvasDvdBox._t || now;
  const dt = Math.min(0.05, Math.max(0, (now - t0) / 1000));
  nodeGraphEmptyCanvasDvdBox._t = now;
  if (!prev) {
    const speed = 80;
    const vx = 56;
    const vy = Math.sqrt(Math.max(0, speed * speed - vx * vx));
    nodeGraphEmptyCanvasDvdBox._box = nodeGraphEmptyCanvasDvdStep({
      x: (cssW - size) / 2,
      y: (cssH - size) / 2,
      vx,
      vy,
      size,
    }, 0, cssW, cssH);
    return nodeGraphEmptyCanvasDvdBox._box;
  }
  prev.size = size;
  nodeGraphEmptyCanvasDvdBox._box = nodeGraphEmptyCanvasDvdStep(prev, dt, cssW, cssH);
  return nodeGraphEmptyCanvasDvdBox._box;
}

function nodeGraphEmptyCanvasLogoImage() {
  if (nodeGraphEmptyCanvasLogoImage._img) return nodeGraphEmptyCanvasLogoImage._img;
  if (typeof Image === "undefined") return null;
  const img = new Image();
  img.src = "./public/soundemote-logo.svg";
  nodeGraphEmptyCanvasLogoImage._img = img;
  return img;
}

function nodeGraphEmptyCanvasToggleEgg() {
  if (!nodeGraphMvp || typeof nodeGraphMvp !== "object") return false;
  nodeGraphMvp.emptyCanvasDvdEgg = nodeGraphMvp.emptyCanvasDvdEgg !== true;
  if (!nodeGraphMvp.emptyCanvasDvdEgg) nodeGraphEmptyCanvasDvdBox._box = null;
  if (typeof nodeGraphMiniPerformShown === "function" && nodeGraphMiniPerformShown()) nodeGraphGlMiniPerformPresent();
  if (nodeGraphMvp.layoutCanvasEmptyEgg) nodeGraphEmptyCanvasEnsureLoop();
  return nodeGraphMvp.emptyCanvasDvdEgg === true;
}

function nodeGraphGlMiniPerformDrawEmpty(batch, cssW, cssH) {
  const text = typeof NODE_GRAPH_EMPTY_CANVAS_LINE === "string"
    ? NODE_GRAPH_EMPTY_CANVAS_LINE
    : "Canvas is empty. Turn on Show in performance view on a module.";
  const egg = nodeGraphMvp?.emptyCanvasDvdEgg === true;
  if (egg && typeof nodeGraphGlLinesImage === "function") {
    const img = nodeGraphEmptyCanvasLogoImage();
    if (img && img.complete && img.naturalWidth > 0) {
      const box = nodeGraphEmptyCanvasDvdBox(cssW, cssH, typeof performance !== "undefined" ? performance.now() : Date.now());
      nodeGraphGlLinesImage(batch, img, box.x, box.y, box.size, box.size, {
        nearest: true,
        alpha: 0.35,
        cache: true,
      });
    } else {
      nodeGraphEmptyCanvasDvdBox(cssW, cssH, typeof performance !== "undefined" ? performance.now() : Date.now());
    }
  }
  const px = nodeGraphEmptyCanvasLinePx(cssW, text, (size) => (
    typeof nodeGraphGlLinesMeasureText === "function"
      ? nodeGraphGlLinesMeasureText(text, size, NODE_GRAPH_MINI_PERFORM_EMPTY_FAMILY, 400)
      : text.length * size * 0.6
  ));
  nodeGraphGlLinesText(batch, text, cssW / 2, cssH / 2, nodeGraphGlMiniPerformTextOpts({
    px,
    rgba: NODE_GRAPH_MINI_PERFORM_TEXT,
    align: "center",
    baseline: "middle",
    weight: 400,
    family: NODE_GRAPH_MINI_PERFORM_EMPTY_FAMILY,
  }));
}

function nodeGraphGlMiniPerformCornerMarks(batch, cssW, cssH) {
  const arm = 16;
  const t = 2;
  const c = [1, 1, 1, 0.85];
  nodeGraphGlLinesRect(batch, 1, 1, arm, t, c);
  nodeGraphGlLinesRect(batch, 1, 1, t, arm, c);
  nodeGraphGlLinesRect(batch, cssW - arm - 1, 1, arm, t, c);
  nodeGraphGlLinesRect(batch, cssW - t - 1, 1, t, arm, c);
  nodeGraphGlLinesRect(batch, 1, cssH - t - 1, arm, t, c);
  nodeGraphGlLinesRect(batch, 1, cssH - arm - 1, t, arm, c);
  nodeGraphGlLinesRect(batch, cssW - arm - 1, cssH - t - 1, arm, t, c);
  nodeGraphGlLinesRect(batch, cssW - t - 1, cssH - arm - 1, t, arm, c);
}

function nodeGraphGlMiniPerformArrangeChrome(batch, tiles, cssW, cssH, frame) {
  const guide = nodeGraphMiniPerformPhoneGuideRect(
    cssW,
    cssH,
    typeof nodeGraphLayoutCanvasPhoneGuideOrientation === "function"
      ? nodeGraphLayoutCanvasPhoneGuideOrientation()
      : "vertical",
  );
  const guideColor = [1, 1, 1, 0.35];
  nodeGraphGlLinesRect(batch, guide.x, guide.y, guide.w, 1, guideColor);
  nodeGraphGlLinesRect(batch, guide.x, guide.y + guide.h - 1, guide.w, 1, guideColor);
  nodeGraphGlLinesRect(batch, guide.x, guide.y, 1, guide.h, guideColor);
  nodeGraphGlLinesRect(batch, guide.x + guide.w - 1, guide.y, 1, guide.h, guideColor);
  const outline = [1, 1, 1, 0.55];
  const grip = Math.max(8, 12 * frame.s);
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    nodeGraphGlLinesRect(batch, tile.x, tile.y, tile.w, 1, outline);
    nodeGraphGlLinesRect(batch, tile.x, tile.y + tile.h - 1, tile.w, 1, outline);
    nodeGraphGlLinesRect(batch, tile.x, tile.y, 1, tile.h, outline);
    nodeGraphGlLinesRect(batch, tile.x + tile.w - 1, tile.y, 1, tile.h, outline);
    nodeGraphGlLinesRect(batch, tile.x, tile.y, grip, grip, [0, 0.82, 1, 0.9]);
    nodeGraphGlLinesRect(batch, tile.x + tile.w - grip, tile.y, grip, grip, [0, 0.82, 1, 0.9]);
    nodeGraphGlLinesRect(batch, tile.x, tile.y + tile.h - grip, grip, grip, [0, 0.82, 1, 0.9]);
    nodeGraphGlLinesRect(batch, tile.x + tile.w - grip, tile.y + tile.h - grip, grip, grip, [0, 0.82, 1, 0.9]);
  }
  nodeGraphGlLinesText(batch, "Arrange", 8, 6, nodeGraphGlMiniPerformTextOpts({
    px: 12,
    rgba: NODE_GRAPH_MINI_PERFORM_TEXT,
    align: "left",
    baseline: "top",
    weight: 600,
  }));
}

function nodeGraphEmptyCanvasPresentStage() {
  const canvas = document.getElementById("nodeLayoutCanvasEmptyEgg");
  const stage = canvas?.parentElement;
  if (!canvas || !stage || typeof nodeGraphGlLinesBegin !== "function") return false;
  const cssW = Math.max(1, stage.clientWidth || window.innerWidth || 1);
  const cssH = Math.max(1, stage.clientHeight || window.innerHeight || 1);
  if (canvas.width !== cssW) canvas.width = cssW;
  if (canvas.height !== cssH) canvas.height = cssH;
  const batch = nodeGraphGlLinesBegin(canvas, NODE_GRAPH_MINI_PERFORM_BACKDROP, { scale: 1 });
  if (!batch) return false;
  nodeGraphGlMiniPerformDrawEmpty(batch, cssW, cssH);
  return nodeGraphGlLinesEnd(batch, "alpha") !== false;
}

function nodeGraphEmptyCanvasEnsureLoop() {
  if (nodeGraphEmptyCanvasEnsureLoop._raf) return;
  const tick = () => {
    const egg = nodeGraphMvp?.layoutCanvasEmptyEgg === true && document.getElementById("nodeLayoutCanvasEmptyEgg");
    if (!egg) {
      nodeGraphEmptyCanvasEnsureLoop._raf = 0;
      return;
    }
    nodeGraphEmptyCanvasPresentStage();
    nodeGraphEmptyCanvasEnsureLoop._raf = window.requestAnimationFrame(tick);
  };
  nodeGraphEmptyCanvasEnsureLoop._raf = window.requestAnimationFrame(tick);
}

function nodeGraphGlMiniPerformPresent() {
  const view = nodeGraphGlMiniPerformView();
  if (!view || typeof nodeGraphGlLinesBegin !== "function") return false;
  const settings = nodeGraphMiniPerformSettings();
  const frame = nodeGraphMiniPerformFrame();
  view.hidden = false;
  view.style.left = `${frame.x}px`;
  view.style.top = `${frame.y}px`;
  view.style.width = `${frame.w}px`;
  view.style.height = `${frame.h}px`;
  view.style.opacity = String(settings.opacity);
  view.style.pointerEvents = settings.mode === "background" ? "none" : "auto";
  const canvas = view.querySelector("#nodeGlGraphMiniPerform");
  const cssW = Math.max(1, Math.round(frame.w));
  const cssH = Math.max(1, Math.round(frame.h));
  if (canvas.width !== cssW) canvas.width = cssW;
  if (canvas.height !== cssH) canvas.height = cssH;
  const tiles = nodeGraphMiniPerformTiles(frame);
  view._miniTiles = tiles;
  view._miniMaps = [];
  const batch = nodeGraphGlLinesBegin(
    canvas,
    // Backdrop as the clear colour: the renderer draws images under its rect quads.
    settings.frame ? NODE_GRAPH_MINI_PERFORM_BACKDROP : [0, 0, 0, 0],
    { scale: 1, transparent: !settings.frame },
  );
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "GL mini perform begin");
    return false;
  }
  for (const host of view._moduleHosts.values()) host._miniUsed = false;
  if (!tiles.length) nodeGraphGlMiniPerformDrawEmpty(batch, cssW, cssH);
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(tile.nodeId) : null;
    if (!el || !el.isConnected || el.hidden) continue;
    const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(tile.nodeId) : null;
    const whole = Boolean(patchNode?.ui?.canvasWholeModule) || Boolean(el.querySelector(":scope > .node-text-box-body"));
    const displays = whole ? [] : nodeGraphGlMiniPerformDisplays(el);
    if (whole || !displays.length) {
      nodeGraphGlMiniPerformModuleTile(view, tile, el, frame, i);
      continue;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const d of displays) {
      x0 = Math.min(x0, d.x);
      y0 = Math.min(y0, d.y);
      x1 = Math.max(x1, d.x + d.w);
      y1 = Math.max(y1, d.y + d.h);
    }
    const fit = nodeGraphContainFitBox(tile.w, tile.h, x1 - x0, y1 - y0);
    if (!fit) continue;
    view._miniMaps.push({
      nodeId: tile.nodeId,
      x: tile.x + fit.ox,
      y: tile.y + fit.oy,
      w: (x1 - x0) * fit.s,
      h: (y1 - y0) * fit.s,
      scale: fit.s,
      layoutX: x0,
      layoutY: y0,
    });
    for (const d of displays) {
      const w = d.w * fit.s;
      const h = d.h * fit.s;
      nodeGraphGlLinesImage(batch, d.canvas, tile.x + fit.ox + (d.x - x0) * fit.s, tile.y + fit.oy + (d.y - y0) * fit.s, w, h, {
        // Nearest neighbour once a face pixel covers more than 2.5 screen pixels.
        nearest: w / d.canvas.width > 2.5,
        alpha: 1,
      });
    }
  }
  if (settings.mode === "arrange") nodeGraphGlMiniPerformArrangeChrome(batch, tiles, cssW, cssH, frame);
  if (settings.frame) {
    const c = NODE_GRAPH_MINI_PERFORM_FRAME;
    nodeGraphGlLinesRect(batch, 0, 0, cssW, 1, c);
    nodeGraphGlLinesRect(batch, 0, cssH - 1, cssW, 1, c);
    nodeGraphGlLinesRect(batch, 0, 1, 1, cssH - 2, c);
    nodeGraphGlLinesRect(batch, cssW - 1, 1, 1, cssH - 2, c);
  }
  if (settings.mode === "position" && (view._miniHover || view._miniDragging)) {
    nodeGraphGlMiniPerformCornerMarks(batch, cssW, cssH);
  }
  const ok = nodeGraphGlLinesEnd(batch, "alpha") !== false;
  for (const [key, host] of view._moduleHosts) {
    if (!host._miniUsed) {
      host.remove();
      view._moduleHosts.delete(key);
    }
  }
  return ok;
}