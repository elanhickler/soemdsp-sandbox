// Keyboard face, drawn by WebGL (docs/APP_POLICY.md section 3).
//
// No key elements exist. Each .node-midi-keyboard-surface carries a key model
// (surface._midiKeyModel): one plain object per key with its MIDI note, its
// window index, white / black, its label text and its state set (active,
// held, ghost-play, chord-memory, ...). The layout pass
// (keyboard-layout-settings.js) turns the Display Settings numbers into one
// rect per key (model.geom, surface-local layout px). Both the GL draw and the
// pointer hit test read those same rects, so what is drawn is what is hit.
//
// Where it is drawn:
//   workspace + whole-module tiles: node-graph-gl-graph.js chrome pass
//   Mini Performance View: node-graph-gl-mini-perform.js keyboard tile
//   face-only tiles (layout canvas face, solo stage, metamodule stage): a face
//     canvas inside the surface, presented through the shared GL present path.

/** classList-shaped key state; any change schedules one repaint. */
class NodeGraphMidiKeyState {
  constructor() {
    this._on = new Set();
  }

  contains(name) {
    return this._on.has(name);
  }

  add(name) {
    if (this._on.has(name)) return;
    this._on.add(name);
    nodeGraphMidiKeyboardRequestPaint();
  }

  remove(name) {
    if (!this._on.has(name)) return;
    this._on.delete(name);
    nodeGraphMidiKeyboardRequestPaint();
  }

  toggle(name, force) {
    const on = force === undefined ? !this._on.has(name) : Boolean(force);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

/** The surface's key model, or null before its first render. */
function nodeGraphMidiKeyboardKeyModel(surface) {
  return surface?._midiKeyModel || null;
}

/** Every key of every rendered piano Keyboard face (optionally one face / surface). */
function nodeGraphMidiKeyboardAllKeys(root = null) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  const surfaces = scope.matches?.(".node-midi-keyboard-surface")
    ? [scope]
    : [...scope.querySelectorAll(".node-midi-keyboard-module .node-midi-keyboard-surface")];
  const out = [];
  for (const surface of surfaces) {
    const model = nodeGraphMidiKeyboardKeyModel(surface);
    if (model) out.push(...model.keys);
  }
  return out;
}

/**
 * (Re)build one surface's key model from its window. Returns true when the
 * model changed. States start empty (the held / active / chord passes refill
 * them right after, as they did for the old spans).
 */
function nodeGraphMidiKeyboardBuildKeyModel(surface, start, count, labels) {
  const sig = `${start}:${count}`;
  const prev = nodeGraphMidiKeyboardKeyModel(surface);
  if (prev && prev.sig === sig) {
    nodeGraphMidiKeyboardSetKeyLabels(surface, labels);
    return false;
  }
  const generated = nodeGraphMidiKeyboardGenerateKeys(start, count);
  const keys = [];
  const add = (src, black) => {
    keys.push({
      surface,
      midi: src.midi,
      index: src.index,
      black,
      leftWhiteIndex: black ? src.leftWhiteIndex : -1,
      label: "",
      aria: "",
      state: new NodeGraphMidiKeyState(),
    });
  };
  for (const key of generated.whiteKeys) add(key, false);
  for (const key of generated.blackKeys) add(key, true);
  surface._midiKeyModel = {
    sig,
    start,
    count,
    keys,
    whites: keys.filter((k) => !k.black),
    blacks: keys.filter((k) => k.black),
    byMidi: new Map(keys.map((k) => [k.midi, k])),
    totalWhite: generated.totalWhite,
    leadPad: generated.leadPad || 0,
    trailPad: generated.trailPad || 0,
    totalUnits: generated.totalUnits || generated.totalWhite || 1,
    labels: "",
    geom: null,
  };
  nodeGraphMidiKeyboardSetKeyLabels(surface, labels);
  nodeGraphMidiKeyboardRequestPaint();
  return true;
}

/** Label text per key from the Labels setting (off / name / number). */
function nodeGraphMidiKeyboardSetKeyLabels(surface, labels) {
  const model = nodeGraphMidiKeyboardKeyModel(surface);
  if (!model) return;
  let changed = model.labels !== labels;
  model.labels = labels;
  for (const key of model.keys) {
    const text = typeof nodeGraphMidiKeyboardKeyCapText === "function"
      ? nodeGraphMidiKeyboardKeyCapText(key.midi, labels)
      : "";
    if (key.label !== text) {
      key.label = text;
      changed = true;
    }
    key.aria = typeof nodeGraphMidiKeyboardPitchLabel === "function"
      ? `${nodeGraphMidiKeyboardPitchLabel(key.midi)} / MIDI ${key.midi}`
      : `MIDI ${key.midi}`;
  }
  if (changed) nodeGraphMidiKeyboardRequestPaint();
}

/**
 * Key rects from the layout numbers (the one source for draw and hit).
 * layout: { width, height, inModuleFace, whiteW, blackW, blackH, blackKeyHeight }
 * Rects are surface-local layout px (zoom 1). Returns true when they changed.
 */
function nodeGraphMidiKeyboardLayoutKeyRects(surface, layout) {
  const model = nodeGraphMidiKeyboardKeyModel(surface);
  if (!model) return false;
  const W = Math.max(0, Number(layout.width) || 0);
  const H = Math.max(0, Number(layout.height) || 0);
  // The key bed sits inside the 0.101627cqi ring (1px at the 984px reference).
  const inset = W * 0.00101627;
  const iw = Math.max(0, W - inset * 2);
  const ih = Math.max(0, H - inset * 2);
  const units = Math.max(1, model.totalUnits);
  const unitW = iw / units;
  const lead = model.leadPad;
  const rects = new Map();
  model.whites.forEach((key, i) => {
    rects.set(key, { x: inset + (lead + i) * unitW, y: inset, w: unitW, h: ih, last: i === model.whites.length - 1 });
  });
  const whiteW = Math.max(1, Number(layout.whiteW) || 1);
  const blackW = Math.max(1, Number(layout.blackW) || 1);
  const widthFrac = Math.min(0.9 / units, (blackW / whiteW) / units);
  const bw = widthFrac * iw;
  const pct = Math.max(28, Math.min(82, Number(layout.blackKeyHeight) || 62));
  const blackH = Number(layout.blackH) || 0;
  const bh = Math.max(0, (layout.inModuleFace || !(blackH > 0))
    ? Math.min(ih * (pct / 100), ih - 12)
    : Math.min(blackH, ih));
  for (const key of model.blacks) {
    const leftIdx = key.leftWhiteIndex;
    // A black key needs a white on its left (or the half-white lead bed).
    if (!(leftIdx >= 0 || (leftIdx === -1 && lead > 0))) continue;
    let centre = ((leftIdx + 1 + lead) / units) * iw;
    centre = Math.max(bw * 0.5, Math.min(iw - bw * 0.5, centre));
    rects.set(key, { x: inset + centre - bw * 0.5, y: inset, w: bw, h: bh });
  }
  const sig = [W, H, model.sig, ...[...rects.values()].map((r) => `${r.x.toFixed(2)},${r.w.toFixed(2)},${r.h.toFixed(2)}`)].join("|");
  const changed = model.geom?.sig !== sig;
  model.geom = {
    sig,
    w: W,
    h: H,
    inset,
    inModuleFace: Boolean(layout.inModuleFace),
    rects,
  };
  if (changed) {
    nodeGraphMidiKeyboardRequestGlRebuild();
  }
  return changed;
}

/** Client-px mapping of one surface (post-transform: workspace zoom, tile scale). */
function nodeGraphMidiKeyboardClientFrame(surface) {
  const model = nodeGraphMidiKeyboardKeyModel(surface);
  const geom = model?.geom;
  if (!geom || !(geom.w > 0) || !(geom.h > 0)) return null;
  const rect = surface.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { model, geom, rect, kx: rect.width / geom.w, ky: rect.height / geom.h };
}

/**
 * Key under client coordinates. A black key wins inside its rect; below it
 * the white at that X answers (front lip). Null on the empty lead / trail bed.
 */
function nodeGraphMidiKeyboardKeyAtClient(surface, clientX, clientY) {
  const frame = nodeGraphMidiKeyboardClientFrame(surface);
  if (!frame) return null;
  const x = (clientX - frame.rect.left) / frame.kx;
  const y = (clientY - frame.rect.top) / frame.ky;
  for (const key of frame.model.blacks) {
    const r = frame.geom.rects.get(key);
    if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return key;
  }
  for (const key of frame.model.whites) {
    const r = frame.geom.rects.get(key);
    if (r && x >= r.x && x < r.x + r.w) return key;
  }
  return null;
}

/** One key's rect in client px (DOMRect-shaped), or null. */
function nodeGraphMidiKeyboardKeyClientRect(key) {
  const frame = key?.surface ? nodeGraphMidiKeyboardClientFrame(key.surface) : null;
  const r = frame?.geom.rects.get(key);
  if (!r) return null;
  const left = frame.rect.left + r.x * frame.kx;
  const top = frame.rect.top + r.y * frame.ky;
  const width = r.w * frame.kx;
  const height = r.h * frame.ky;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// ---------------------------------------------------------------- repaint

let nodeGraphMidiKeyboardPaintFrame = 0;

/** Key state / labels changed: repaint every place that draws a keyboard, once per frame. */
function nodeGraphMidiKeyboardRequestPaint() {
  if (nodeGraphMidiKeyboardPaintFrame || typeof requestAnimationFrame !== "function") return;
  nodeGraphMidiKeyboardPaintFrame = requestAnimationFrame(() => {
    nodeGraphMidiKeyboardPaintFrame = 0;
    if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    if (typeof nodeGraphMiniPerformShown === "function" && nodeGraphMiniPerformShown()
      && typeof nodeGraphGlMiniPerformPresent === "function") {
      nodeGraphGlMiniPerformPresent();
    }
    nodeGraphMidiKeyboardPresentFaceCanvases();
  });
}

let nodeGraphMidiKeyboardChromeFrame = 0;

/** Key rects moved / resized: the GL chrome cache holds the surface boxes, rebuild it. */
function nodeGraphMidiKeyboardRequestGlRebuild() {
  if (nodeGraphMidiKeyboardChromeFrame || typeof requestAnimationFrame !== "function") return;
  nodeGraphMidiKeyboardChromeFrame = requestAnimationFrame(() => {
    nodeGraphMidiKeyboardChromeFrame = 0;
    if (typeof nodeGraphGlGraphRebuildChrome === "function") nodeGraphGlGraphRebuildChrome();
    nodeGraphMidiKeyboardRequestPaint();
  });
}

// ---------------------------------------------------------------- look

function nodeGraphMidiKeyboardHex(hex, alpha = 1) {
  const h = String(hex).replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
    alpha,
  ];
}

function nodeGraphMidiKeyboardRgba(r, g, b, a = 1) {
  return [r / 255, g / 255, b / 255, a];
}

/** `top` composited over an opaque `under` (straight alpha). */
function nodeGraphMidiKeyboardOver(top, under) {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function nodeGraphMidiKeyboardMix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

// The old styles.css key gradients (top stop, bottom stop) and label colours.
const NODE_GRAPH_MIDI_KEY_LOOK = (() => {
  const hex = nodeGraphMidiKeyboardHex;
  const rgba = nodeGraphMidiKeyboardRgba;
  return Object.freeze({
    bed: hex("050607"),
    bedGlow: rgba(241, 184, 75, 0.06),
    ring: rgba(243, 241, 236, 0.16),
    whiteSeam: rgba(5, 6, 7, 0.72),
    white: {
      base: { top: hex("f7f2e8"), bottom: hex("a79f93"), text: rgba(5, 6, 7, 0.92) },
      blue: { top: hex("7edcff"), bottom: hex("0a3f9a"), text: hex("eaf8ff"), inset: rgba(207, 246, 255, 0.82) },
      gold: { top: hex("ffcf6b"), bottom: hex("7a3f06"), text: hex("1a1200"), inset: rgba(255, 226, 173, 0.82) },
      green: { top: hex("7dffb0"), bottom: hex("0a4a28"), text: hex("041a0c"), inset: rgba(180, 255, 210, 0.82) },
      slot: { top: hex("c8ffd8"), bottom: hex("0d6b38"), text: hex("041a0c"), inset: rgba(230, 255, 240, 0.95) },
      red: { top: hex("ff8a8a"), bottom: hex("7a1010"), text: hex("2a0606"), inset: rgba(255, 210, 210, 0.85) },
    },
    black: {
      base: { top: hex("20252a"), bottom: hex("090b0e"), text: rgba(243, 241, 236, 0.82), border: rgba(127, 199, 217, 0.25) },
      ghostBase: { top: hex("2a2a2c"), bottom: hex("111113") },
      blue: { top: hex("236ec9"), bottom: hex("081a43"), text: hex("eaf8ff"), border: rgba(118, 215, 255, 0.96) },
      gold: { top: hex("c9760f"), bottom: hex("4a2604"), text: hex("1a1200"), border: rgba(255, 200, 110, 0.96) },
      green: { top: hex("1f9a55"), bottom: hex("062818"), text: hex("041a0c"), border: rgba(120, 255, 180, 0.96) },
      slot: { top: hex("3dff8a"), bottom: hex("0a4a28"), text: hex("041a0c"), border: rgba(230, 255, 240, 0.98) },
      red: { top: hex("c62828"), bottom: hex("4a0a0a"), text: hex("ffffff"), border: rgba(255, 170, 170, 0.96) },
    },
    ghost: {
      play: rgba(74, 163, 255, 0.45),
      chord: { top: rgba(61, 220, 132, 0.28), bottom: rgba(31, 154, 85, 0.16), ring: rgba(61, 220, 132, 0.38) },
      patch: { top: rgba(255, 120, 120, 0.28), bottom: rgba(220, 90, 90, 0.16), ring: rgba(255, 120, 120, 0.38) },
      patchSet: { top: rgba(255, 170, 170, 0.72), bottom: rgba(220, 90, 90, 0.34) },
      blackChord: { top: rgba(61, 220, 132, 0.32), bottom: rgba(31, 154, 85, 0.18), border: rgba(125, 255, 176, 0.45) },
      blackPatch: { top: rgba(255, 120, 120, 0.32), bottom: rgba(220, 90, 90, 0.18), border: rgba(255, 170, 170, 0.45) },
      blackPatchSet: { top: rgba(255, 140, 140, 0.55), bottom: rgba(90, 18, 18, 0.92), border: rgba(255, 160, 160, 0.7) },
    },
    // Outer marks the old box-shadow rings carried (2px), drawn inside the key.
    goldRing: rgba(241, 184, 75, 0.55),
    greenRing: rgba(61, 220, 132, 0.9),
    slotEditRing: hex("f4fff4"),
  });
})();

/**
 * Fill / stroke / text for one key from its state, in the old CSS precedence.
 * Returns { top, bottom, stroke, strokeRgba, text } (stroke in layout px).
 */
function nodeGraphMidiKeyboardKeyPaint(key, wideLabels) {
  const L = NODE_GRAPH_MIDI_KEY_LOOK;
  const s = key.state;
  const has = (name) => s.contains(name);
  const cm = has("chord-memory");
  const held = has("held");
  const active = has("active");
  const slotOn = has("slot-on");
  const slotEdit = has("slot-edit");
  if (!key.black) {
    const W = L.white;
    let look = W.base;
    let ring = null;
    let ringPx = 1;
    let top = null;
    let bottom = null;
    if (has("chord-edit-note")) look = W.red;
    else if (slotEdit) { look = W.slot; ring = L.slotEditRing; ringPx = 2; }
    else if (cm && slotOn) look = W.slot;
    else if (cm && active) { look = W.blue; ring = L.greenRing; ringPx = 2; }
    else if (cm && held) { look = W.gold; ring = L.greenRing; ringPx = 2; }
    else if (cm) look = W.green;
    else if (held && active) { look = W.blue; ring = L.goldRing; ringPx = 2; }
    else if (held) look = W.gold;
    else if (active) look = W.blue;
    else if (has("ghost-chord") && !slotOn) {
      top = nodeGraphMidiKeyboardOver(L.ghost.chord.top, W.base.top);
      bottom = nodeGraphMidiKeyboardOver(L.ghost.chord.bottom, W.base.bottom);
      ring = L.ghost.chord.ring;
      ringPx = 2;
    } else if (has("ghost-patch")) {
      top = nodeGraphMidiKeyboardOver(L.ghost.patch.top, W.base.top);
      bottom = nodeGraphMidiKeyboardOver(L.ghost.patch.bottom, W.base.bottom);
      ring = L.ghost.patch.ring;
      ringPx = 2;
    } else if (has("patch-set")) {
      top = nodeGraphMidiKeyboardOver(L.ghost.patchSet.top, W.base.top);
      bottom = nodeGraphMidiKeyboardOver(L.ghost.patchSet.bottom, W.base.bottom);
    }
    if (!ring && look.inset) ring = look.inset;
    // MIDI / chord Play Keys ghost: the sequencer.css inset ring (not on gold / chord slots).
    if (has("ghost-play") && !held && !cm) { ring = L.ghost.play; ringPx = 2; }
    top = top || look.top;
    bottom = bottom || look.bottom;
    const mid = nodeGraphMidiKeyboardMix(top, bottom, 0.5);
    return {
      top,
      bottom,
      stroke: ring ? ringPx : 0,
      strokeRgba: ring ? nodeGraphMidiKeyboardOver(ring, mid) : mid,
      text: look.text,
    };
  }
  const B = L.black;
  let look = B.base;
  let top = null;
  let bottom = null;
  let border = null;
  let ringPx = 1;
  if (has("chord-edit-note")) look = B.red;
  else if (slotEdit) { look = B.slot; border = L.slotEditRing; ringPx = 2; }
  else if (cm && slotOn) look = B.slot;
  else if (cm && active) { look = B.blue; border = L.greenRing; ringPx = 2; }
  else if (cm && held) { look = B.gold; border = L.greenRing; ringPx = 2; }
  else if (cm) look = B.green;
  else if (held && active) { look = B.blue; border = L.goldRing; ringPx = 2; }
  else if (held) look = B.gold;
  else if (active) look = B.blue;
  else if (has("ghost-chord") && !slotOn) {
    top = nodeGraphMidiKeyboardOver(L.ghost.blackChord.top, B.ghostBase.top);
    bottom = nodeGraphMidiKeyboardOver(L.ghost.blackChord.bottom, B.ghostBase.bottom);
    border = L.ghost.blackChord.border;
    ringPx = 2;
  } else if (has("ghost-patch")) {
    top = nodeGraphMidiKeyboardOver(L.ghost.blackPatch.top, B.ghostBase.top);
    bottom = nodeGraphMidiKeyboardOver(L.ghost.blackPatch.bottom, B.ghostBase.bottom);
    border = L.ghost.blackPatch.border;
    ringPx = 2;
  } else if (has("patch-set")) {
    top = nodeGraphMidiKeyboardOver(L.ghost.blackPatchSet.top, B.base.top);
    bottom = nodeGraphMidiKeyboardOver(L.ghost.blackPatchSet.bottom, B.base.bottom);
    border = L.ghost.blackPatchSet.border;
  }
  if (has("ghost-play") && !held && !cm) { border = L.ghost.play; ringPx = 2; }
  top = top || look.top;
  bottom = bottom || look.bottom;
  border = border || look.border;
  const mid = nodeGraphMidiKeyboardMix(top, bottom, 0.5);
  return {
    top,
    bottom,
    stroke: ringPx,
    strokeRgba: nodeGraphMidiKeyboardOver(border, mid),
    // Black labels only take the state colour on wide keyboards (old @container 520px).
    text: wideLabels ? look.text : B.base.text,
  };
}

const NODE_GRAPH_MIDI_KEY_LABEL_FONT = "\"Cascadia Mono\", Consolas, monospace";

/**
 * Draw one keyboard surface into a gl-line-renderer batch at (x, y, w, h)
 * in batch units (the caller's screen / tile / canvas px).
 */
function nodeGraphMidiKeyboardGlDraw(batch, surface, x, y, w, h) {
  const model = nodeGraphMidiKeyboardKeyModel(surface);
  const geom = model?.geom;
  if (!batch || !geom || !(geom.w > 0) || !(geom.h > 0) || !(w > 0) || !(h > 0)) return false;
  if (typeof nodeGraphGlLinesRoundRect !== "function") return false;
  const L = NODE_GRAPH_MIDI_KEY_LOOK;
  const sx = w / geom.w;
  const sy = h / geom.h;
  const rr = (rx, ry, rw, rh, spec) => nodeGraphGlLinesRoundRect(batch, x + rx * sx, y + ry * sy, rw * sx, rh * sy, spec);
  const outerRadius = 6 * Math.min(sx, sy);
  // Bed: module faces are square-cornered (styles.css), loose keyboards keep 6px.
  rr(0, 0, geom.w, geom.h, { radius: geom.inModuleFace ? 0 : outerRadius, fill: L.bed, feather: 1 });
  rr(0, 0, geom.w, geom.h * 0.34, {
    radius: 0, fill: L.bedGlow, fillBottom: [L.bedGlow[0], L.bedGlow[1], L.bedGlow[2], 0], feather: 0,
  });
  for (const key of model.whites) {
    const r = geom.rects.get(key);
    if (!r) continue;
    const paint = nodeGraphMidiKeyboardKeyPaint(key, geom.w >= 520);
    rr(r.x, r.y, r.w, r.h, {
      radius: 0,
      fill: paint.top,
      fillBottom: paint.bottom,
      stroke: paint.stroke * Math.min(sx, sy),
      strokeRgba: paint.strokeRgba,
      feather: 0.75,
    });
    if (!r.last) {
      rr(r.x + r.w - 1, r.y, 1, r.h, { radius: 0, fill: L.whiteSeam, feather: 0.5 });
    }
  }
  for (const key of model.blacks) {
    const r = geom.rects.get(key);
    if (!r) continue;
    const paint = nodeGraphMidiKeyboardKeyPaint(key, geom.w >= 520);
    rr(r.x, r.y, r.w, r.h, {
      radius: 4 * Math.min(sx, sy),
      radiusTop: 0,
      fill: paint.top,
      fillBottom: paint.bottom,
      stroke: paint.stroke * Math.min(sx, sy),
      strokeRgba: paint.strokeRgba,
      feather: 1,
    });
  }
  rr(0, 0, geom.w, geom.h, {
    radius: outerRadius,
    stroke: Math.max(0.75, geom.inset * Math.min(sx, sy)),
    fill: [0, 0, 0, 0],
    strokeRgba: L.ring,
    feather: 1,
  });
  if (model.labels !== "off" && typeof nodeGraphGlLinesText === "function") {
    const units = Math.max(1, model.totalUnits);
    // Old per-key label sizes: 17.560976cqi / units (white), 14.146342cqi / units (black).
    // Label size setting (percent); the maxWidth below still shrinks a label to its key.
    const sizeK = Math.max(0.5, Math.min(4, (Number(model.keys[0]?.surface?.dataset?.keyLabelSize) || 100) / 100));
    const whitePx = (0.17560976 * geom.w / units) * sx * sizeK;
    const blackPx = (0.14146342 * geom.w / units) * sx * sizeK;
    const textOpts = typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts : (o) => o;
    for (const key of model.keys) {
      const r = geom.rects.get(key);
      if (!r || !key.label) continue;
      const px = key.black ? blackPx : whitePx;
      if (px < 1) continue;
      const paint = nodeGraphMidiKeyboardKeyPaint(key, geom.w >= 520);
      nodeGraphGlLinesText(batch, key.label, x + (r.x + r.w * 0.5) * sx, y + (r.y + r.h - (key.black ? 2 : 1)) * sy, textOpts({
        px,
        rgba: paint.text,
        align: "center",
        baseline: "bottom",
        weight: 700,
        family: NODE_GRAPH_MIDI_KEY_LABEL_FONT,
        maxWidth: Math.max(1, (r.w - 2) * sx),
      }));
    }
  }
  return true;
}

// ---------------------------------------------------------------- face canvases

/** Faces shown outside the GL graph pass (no plate pass draws them there). */
function nodeGraphMidiKeyboardNeedsFaceCanvas(surface) {
  if (!surface?.isConnected) return false;
  if (surface.closest(".node-whole-module-face")) return false;
  return Boolean(surface.closest(".node-layout-canvas-face, .node-screen-solo-stage, .node-metamodule-canvas-stage"));
}

/** Present every face-canvas keyboard (WebGL batch -> the shared present into its canvas). */
function nodeGraphMidiKeyboardPresentFaceCanvases() {
  if (typeof document === "undefined" || typeof nodeGraphGlLinesBegin !== "function") return;
  document.querySelectorAll(".node-midi-keyboard-module .node-midi-keyboard-surface").forEach((surface) => {
    let canvas = surface.querySelector(":scope > canvas.node-midi-keyboard-face-canvas");
    if (!nodeGraphMidiKeyboardNeedsFaceCanvas(surface)) {
      if (canvas) canvas.hidden = true;
      return;
    }
    const geom = nodeGraphMidiKeyboardKeyModel(surface)?.geom;
    const cssW = surface.clientWidth;
    const cssH = surface.clientHeight;
    if (!geom || !(cssW > 0) || !(cssH > 0)) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "node-midi-keyboard-face-canvas";
      canvas.setAttribute("aria-hidden", "true");
      surface.append(canvas);
    }
    canvas.hidden = false;
    // Device px from the on-screen size (tiles scale the face).
    const rect = surface.getBoundingClientRect();
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const scale = Math.max(0.25, (rect.width / cssW) * dpr);
    const pw = Math.max(1, Math.round(cssW * scale));
    const ph = Math.max(1, Math.round(cssH * scale));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale, transparent: true, publishNodeId: "" });
    if (!batch) return;
    nodeGraphMidiKeyboardGlDraw(batch, surface, 0, 0, cssW, cssH);
    nodeGraphGlLinesEnd(batch, "alpha");
  });
}
