// Music Player (audioPlayer) face: one WebGL picture for the module's own UI.
//
// The waveform (node-graph-sample-waveform.js) and the Stereo scope already
// draw into their own face textures. Everything else on the face (the page
// tabs, the playlist rows and transport, the Waveplay now-playing row and the
// Playinfo table) is drawn here with the gl-line-renderer shaders into one
// face box under those two faces, covering the whole display cell. The GL
// graph, Canvas tiles, screen solo and the Mini Canvas composite it like every
// other display face, the waveform / Stereo faces on top.
//
// The DOM rows and buttons stay as the hit layer only (opacity 0, styles.css):
// they keep the clicks, wheel, double-tap and scroll, and their classes /
// data-* are the state. This face reads their zoom-1 layout boxes, so the
// picture and the hit targets share one grid at every size. JS lays out; the
// GPU draws every pixel.
//
// Size: the circuit builder face is the source of truth. In Canvas and screen
// solo the display's size comes from its tile; the face scales its whole UI by
// one factor, the builder layout contain-fitted into the tile. That factor
// goes to the hit layer as --node-music-player-ui-scale (styles.css: every
// row, the tabs and the transport are one row-height variable), so the boxes
// this face reads, and with them the picture and the hit targets, scale
// together. Playlist slots still share the list height, but their text is
// never bigger than a nominal row's (styles.css), so a tall tile spaces rows
// out instead of growing their text.

const NODE_GRAPH_AUDIO_PLAYER_FACE_PLATE = [0, 0, 0, 1];
const NODE_GRAPH_AUDIO_PLAYER_FACE_PANEL = "#050805";
const NODE_GRAPH_AUDIO_PLAYER_FACE_FAMILY = "system-ui, sans-serif";
const NODE_GRAPH_AUDIO_PLAYER_FACE_HIT = [
  ".node-music-player-page-btn",
  ".node-music-player-pl-transport-btn",
  ".node-music-player-pl-row",
  ".node-music-player-waveplay-song",
].join(", ");
// Page tabs: one size at builder scale (times the UI scale); a label too wide
// for its tab shrinks to fit.
const NODE_GRAPH_AUDIO_PLAYER_FACE_PAGE_PX = 11.5;
const NODE_GRAPH_AUDIO_PLAYER_FACE_PAGE_FILL = 0.94;
// Transport glyphs fill their button with a ~9% margin on each side.
const NODE_GRAPH_AUDIO_PLAYER_FACE_GLYPH_FILL = 0.82;
// Playlist / Playinfo / now-playing text is 0.7 of its row (CSS 70cqh).
const NODE_GRAPH_AUDIO_PLAYER_FACE_ROW_TEXT = 0.7;
// Loading row blink: CSS node-music-player-pl-load-blink (0.7 s, down to 0.22).
const NODE_GRAPH_AUDIO_PLAYER_FACE_BLINK_MS = 700;

/**
 * The face box, made once per display and kept as the display's first child
 * (drawn first, so the waveform / Stereo faces composite over it). Repaints
 * on hit-layer changes (rows, transport state, tabs, table rebuild), resize,
 * scroll and hover. Idempotent: called from the layout pass on every face switch.
 */
function nodeGraphAudioPlayerFaceGlInstall(section) {
  if (!section || typeof nodeGraphDisplayCanvasCreate !== "function") return null;
  let face = section._musicPlayerFace;
  if (!face) {
    face = nodeGraphDisplayCanvasCreate("node-music-player-face-canvas");
    face.dataset.faceSlot = "musicPlayerFace";
    section._musicPlayerFace = face;
    const request = () => nodeGraphAudioPlayerFaceGlRequestPaint(section);
    section._musicPlayerFaceObserver = new MutationObserver(request);
    if (typeof ResizeObserver === "function") new ResizeObserver(request).observe(section);
    // The Playinfo table scrolls in its hit layer; scroll does not bubble.
    section.addEventListener("scroll", request, true);
    const hover = (event) => {
      const target = event.type === "pointerover" && event.pointerType !== "touch"
        ? event.target?.closest?.(NODE_GRAPH_AUDIO_PLAYER_FACE_HIT) || null
        : null;
      if (section._musicPlayerFaceHover === target) return;
      section._musicPlayerFaceHover = target;
      request();
    };
    section.addEventListener("pointerover", hover);
    section.addEventListener("pointerleave", hover);
  }
  // First in the display, so every pass draws it under the waveform / Stereo faces.
  if (face.parentElement !== section) section.prepend(face);
  const observer = section._musicPlayerFaceObserver;
  observer.observe(section, { attributes: true, attributeFilter: ["data-music-player-face"] });
  // The tabs, the playlist and Playinfo pages, and the now-playing row. The
  // Waveplay page itself only for its hidden flag: the waveform lives in it.
  for (const part of section.querySelectorAll(
    ":scope > .node-music-player-page-bar, :scope > [data-music-player-page='pl'], "
    + ":scope > [data-music-player-page='playinfo'], [data-music-player-now-song]",
  )) {
    observer.observe(part, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  const waveplay = section.querySelector(":scope > [data-music-player-page='waveplay']");
  if (waveplay) observer.observe(waveplay, { attributes: true, attributeFilter: ["hidden"] });
  nodeGraphAudioPlayerFaceGlRequestPaint(section);
  return face;
}

function nodeGraphAudioPlayerFaceGlRequestPaint(section) {
  if (!section || section._musicPlayerFaceFrame) return;
  section._musicPlayerFaceFrame = requestAnimationFrame(() => {
    section._musicPlayerFaceFrame = 0;
    if (drawNodeGraphAudioPlayerFace(section) && typeof nodeGraphGlGraphPresentDisplaysSoon === "function") {
      nodeGraphGlGraphPresentDisplaysSoon();
    }
    // A loading row blinks: keep painting while one is on screen.
    if (section._musicPlayerFaceBlinking) nodeGraphAudioPlayerFaceGlRequestPaint(section);
  });
}

/**
 * UI scale of the face: 1 in the circuit builder (where its size is recorded);
 * in Canvas / screen solo the builder size contain-fitted into the tile, so
 * the tabs and rows keep their builder proportions and never overflow.
 */
function nodeGraphAudioPlayerFaceGlUiScale(section, face, cssW, cssH) {
  if (!face.closest(".node-screen-solo-face")) {
    section._musicPlayerFaceBuilderSize = { w: cssW, h: cssH };
    return 1;
  }
  const builder = section._musicPlayerFaceBuilderSize;
  const k = builder
    ? Math.min(cssW / builder.w, cssH / builder.h)
    : (typeof nodeGraphGlLinesInkScale === "function" ? Number(nodeGraphGlLinesInkScale(face)) : 1);
  return Number.isFinite(k) && k > 0 ? Math.max(0.25, Math.round(k * 1000) / 1000) : 1;
}

/**
 * Hand the UI scale to the hit layer (one CSS variable on the display). A
 * change re-fits the playlist slot count to the new row height before the
 * boxes are read. Returns true when it changed.
 */
function nodeGraphAudioPlayerFaceGlApplyUiScale(section, k) {
  const value = k === 1 ? "" : String(k);
  if (section.style.getPropertyValue("--node-music-player-ui-scale") === value) return false;
  if (value) section.style.setProperty("--node-music-player-ui-scale", value);
  else section.style.removeProperty("--node-music-player-ui-scale");
  const list = section.querySelector("[data-music-player-list]");
  if (list && typeof nodeGraphAudioPlayerPlaylistPaintSlots === "function") {
    nodeGraphAudioPlayerPlaylistPaintSlots(section.dataset.node || "", list, { followPlaying: false });
  }
  return true;
}

/** Zoom-1 layout box of `el` in face px (scrolled containers applied). */
function nodeGraphAudioPlayerFaceGlBox(el, section, origin) {
  if (!el) return null;
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== section) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  if (node !== section || !(el.offsetWidth > 0) || !(el.offsetHeight > 0)) return null;
  for (let parent = el.parentElement; parent && parent !== section; parent = parent.parentElement) {
    x -= parent.scrollLeft;
    y -= parent.scrollTop;
  }
  return { x: x - origin.x, y: y - origin.y, w: el.offsetWidth, h: el.offsetHeight };
}

function nodeGraphAudioPlayerFaceGlRgba(css, fallback) {
  return typeof css === "string" && css.trim() && typeof nodeGraphGlLinesCss === "function"
    ? nodeGraphGlLinesCss(css)
    : fallback;
}

function nodeGraphAudioPlayerFaceGlAlpha(rgba, scale) {
  return [rgba[0], rgba[1], rgba[2], Math.max(0, Math.min(1, (rgba[3] ?? 1) * scale))];
}

function nodeGraphAudioPlayerFaceGlMeasure(text, px, family = NODE_GRAPH_AUDIO_PLAYER_FACE_FAMILY) {
  return typeof nodeGraphGlLinesMeasureText === "function"
    ? nodeGraphGlLinesMeasureText(text, px, family, 600)
    : String(text).length * px * 0.6;
}

/** `text` cut with an ellipsis to fit maxW at px (CSS text-overflow: ellipsis). */
function nodeGraphAudioPlayerFaceGlEllipsis(text, px, maxW, family) {
  const str = String(text ?? "");
  if (!str || !(maxW > 0)) return "";
  if (nodeGraphAudioPlayerFaceGlMeasure(str, px, family) <= maxW) return str;
  const chars = Array.from(str);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nodeGraphAudioPlayerFaceGlMeasure(`${chars.slice(0, mid).join("")}…`, px, family) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${chars.slice(0, lo).join("").trimEnd()}…` : "";
}

/** Colours of the face: the HUD line family (same as the DOM it replaces). */
function nodeGraphAudioPlayerFaceGlLook(nodeId) {
  const settings = typeof nodeGraphSampleWaveformSettingsForNode === "function"
    ? nodeGraphSampleWaveformSettingsForNode(nodeId)
    : null;
  const line = (lightness, alpha, fallback) => nodeGraphAudioPlayerFaceGlRgba(
    typeof nodeGraphSampleWaveformLineColor === "function"
      ? nodeGraphSampleWaveformLineColor(settings, lightness, alpha)
      : "",
    fallback,
  );
  const muted = line(57, 0.55, [0.2, 0.95, 0.45, 0.55]);
  const hot = line(85, 0.7, [0.7, 1, 0.8, 0.7]);
  const dim = line(57, 0.28, [0.2, 0.95, 0.45, 0.28]);
  // Playinfo restyle from the embed API (audio-player-api.js applyInfoStyle).
  const rootStyle = document.documentElement.style;
  return {
    muted,
    hot,
    dim,
    hoverBg: nodeGraphAudioPlayerFaceGlAlpha(hot, 0.26),
    selectedBg: nodeGraphAudioPlayerFaceGlAlpha(hot, 0.55),
    playNextBg: [0.2, 0.95, 0.45, 0.14],
    panel: nodeGraphAudioPlayerFaceGlRgba(NODE_GRAPH_AUDIO_PLAYER_FACE_PANEL, [0.02, 0.03, 0.02, 1]),
    infoColor: nodeGraphAudioPlayerFaceGlRgba(rootStyle.getPropertyValue("--music-info-color"), muted),
    infoBg: nodeGraphAudioPlayerFaceGlRgba(rootStyle.getPropertyValue("--music-info-bg"), null),
  };
}

/**
 * The face as plain draw ops (rects, then text) from the hit layer's boxes
 * and state. Ops double as the repaint signature.
 */
function nodeGraphAudioPlayerFaceGlLayout(section, origin, look, uiScale) {
  const rects = [];
  const texts = [];
  const rect = (b, rgba) => {
    if (b && rgba && b.w > 0 && b.h > 0 && rgba[3] > 0) rects.push([b.x, b.y, b.w, b.h, rgba]);
  };
  const text = (str, x, y, px, rgba, align = "left", maxWidth = 0, family = NODE_GRAPH_AUDIO_PLAYER_FACE_FAMILY) => {
    if (str && px > 0 && rgba[3] > 0) texts.push([str, x, y, px, rgba, align, maxWidth, family]);
  };
  const box = (el) => nodeGraphAudioPlayerFaceGlBox(el, section, origin);
  const hover = section._musicPlayerFaceHover || null;
  const face = section.dataset.musicPlayerFace || "wave";
  let blinking = false;

  // Bordered button row (page tabs / transport): fill, hot or hover tint,
  // 1px dim top border and dividers, centred label.
  const buttonRow = (bar, selector, label) => {
    const barBox = box(bar);
    if (!barBox) return;
    rect(barBox, look.panel);
    rect({ x: barBox.x, y: barBox.y, w: barBox.w, h: 1 }, look.dim);
    const buttons = bar.querySelectorAll(selector);
    for (let i = 0; i < buttons.length; i += 1) {
      const btn = buttons[i];
      const b = box(btn);
      if (!b) continue;
      const active = btn.classList.contains("is-active");
      const hot = active || hover === btn;
      const last = i === buttons.length - 1;
      const inner = { x: b.x, y: b.y, w: last ? b.w : b.w - 1, h: b.h };
      if (active) rect(inner, look.selectedBg);
      else if (hot) rect(inner, look.hoverBg);
      if (!last) rect({ x: b.x + b.w - 1, y: b.y, w: 1, h: b.h }, look.dim);
      label(btn, inner, hot ? look.hot : look.muted);
    }
  };

  const pageBar = section.querySelector(":scope > .node-music-player-page-bar");
  const pageLabel = (btn, b, rgba) => {
    text(String(btn.textContent || ""), b.x + b.w / 2, b.y + b.h / 2, NODE_GRAPH_AUDIO_PLAYER_FACE_PAGE_PX * uiScale, rgba,
      "center", b.w * NODE_GRAPH_AUDIO_PLAYER_FACE_PAGE_FILL);
  };
  const glyphLabel = (btn, b, rgba) => {
    const glyph = String(btn.textContent || "");
    const unit = nodeGraphAudioPlayerFaceGlMeasure(glyph, 100) / 100;
    const px = Math.max(4, Math.min(
      b.h * NODE_GRAPH_AUDIO_PLAYER_FACE_GLYPH_FILL,
      unit > 0 ? (b.w * NODE_GRAPH_AUDIO_PLAYER_FACE_GLYPH_FILL) / unit : b.h,
    ));
    text(glyph, b.x + b.w / 2, b.y + b.h / 2, px, rgba, "center");
  };

  const page = section.querySelector(`:scope > [data-music-player-page="${face}"]`);
  if (page && !page.hidden && face === "pl") {
    rect(box(page), look.panel);
    const list = page.querySelector("[data-music-player-list]");
    const rows = list ? list.querySelectorAll(":scope > .node-music-player-pl-row") : [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const b = box(row);
      if (!b) continue;
      // Empty slots have no text and no fill (CSS .is-empty).
      if (row.classList.contains("is-empty")) continue;
      const fadeRaw = Number.parseFloat(row.style.getPropertyValue("--node-music-player-pl-fade"));
      let opacity = Number.isFinite(fadeRaw) ? Math.max(0, Math.min(1, fadeRaw)) : 1;
      const loading = row.dataset.loading === "true";
      if (loading) {
        blinking = true;
        const t = (performance.now() % NODE_GRAPH_AUDIO_PLAYER_FACE_BLINK_MS) / NODE_GRAPH_AUDIO_PLAYER_FACE_BLINK_MS;
        const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
        const eased = tri * tri * (3 - 2 * tri);
        opacity *= Math.round((1 - 0.78 * eased) * 24) / 24;
      }
      const playing = row.dataset.playing === "true";
      const playNext = row.dataset.queue === "next";
      const active = row.dataset.active === "true";
      const hovered = hover === row;
      // CSS order: hover tint, then active (no fill), playing (dim), play next.
      let fill = hovered ? look.hoverBg : null;
      if (active) fill = null;
      if (playing) fill = look.dim;
      if (playNext) fill = look.playNextBg;
      if (fill) rect(b, nodeGraphAudioPlayerFaceGlAlpha(fill, opacity));
      if (loading && row.dataset.loadFill === "true") {
        const frac = Number.parseFloat(row.style.getPropertyValue("--node-music-player-pl-load")) / 100;
        if (frac > 0) rect({ x: b.x, y: b.y, w: b.w * Math.min(1, frac), h: b.h }, nodeGraphAudioPlayerFaceGlAlpha(look.dim, opacity));
      }
      const ink = nodeGraphAudioPlayerFaceGlAlpha(hovered || active || playNext || loading ? look.hot : look.muted, opacity);
      const numEl = row.querySelector(".node-music-player-pl-num");
      const nameEl = row.querySelector(".node-music-player-pl-name");
      const numBox = box(numEl);
      const nameBox = box(nameEl);
      // The hit layer's own type size: 0.7 of the slot, at most of a nominal
      // row (styles.css), so the columns it lays out fit the drawn text.
      if (numBox) {
        const px = parseFloat(getComputedStyle(numEl).fontSize) || numBox.h * NODE_GRAPH_AUDIO_PLAYER_FACE_ROW_TEXT;
        text(String(numEl.textContent || ""), numBox.x, numBox.y + numBox.h / 2, px, nodeGraphAudioPlayerFaceGlAlpha(ink, 0.7));
      }
      if (nameBox) {
        const px = parseFloat(getComputedStyle(nameEl).fontSize) || nameBox.h * NODE_GRAPH_AUDIO_PLAYER_FACE_ROW_TEXT;
        const played = row.dataset.queue === "played";
        const nameInk = played ? nodeGraphAudioPlayerFaceGlAlpha(ink, 0.62) : ink;
        const name = nodeGraphAudioPlayerFaceGlEllipsis(nameEl.textContent, px, nameBox.w);
        const cy = nameBox.y + nameBox.h / 2;
        text(name, nameBox.x, cy, px, nameInk);
        if (played && name) {
          // text-decoration: line-through, through the x-height middle.
          const strikeH = Math.max(1, px * 0.07);
          rect({ x: nameBox.x, y: cy - px * 0.08 - strikeH / 2, w: nodeGraphAudioPlayerFaceGlMeasure(name, px), h: strikeH }, nameInk);
        }
      }
    }
    const transport = page.querySelector("[data-music-player-transport]");
    if (transport) buttonRow(transport, ".node-music-player-pl-transport-btn", glyphLabel);
  } else if (page && !page.hidden && face === "waveplay") {
    const song = page.querySelector("[data-music-player-now-song]");
    const songBox = box(song);
    if (songBox) {
      rect(songBox, look.panel);
      rect({ x: songBox.x, y: songBox.y, w: songBox.w, h: 1 }, look.dim);
      const nameEl = song.querySelector("[data-music-player-now-song-name]");
      const nameBox = box(nameEl);
      if (nameBox) {
        // The name button pads 8px (x UI scale) each side (styles.css .node-music-player-waveplay-song).
        const pad = 8 * uiScale;
        const px = nameBox.h * NODE_GRAPH_AUDIO_PLAYER_FACE_ROW_TEXT;
        const name = nodeGraphAudioPlayerFaceGlEllipsis(nameEl.textContent, px, nameBox.w - 2 * pad);
        text(name, nameBox.x + pad, nameBox.y + nameBox.h / 2, px, hover === song ? look.hot : look.muted);
      }
    }
  } else if (page && !page.hidden && face === "playinfo") {
    const pageBox = box(page);
    rect(pageBox, look.infoBg);
    const body = page.querySelector("[data-music-player-ram-body]");
    const bodyBox = box(body);
    if (bodyBox) {
      // The body scrolls: fills are cut to it, text only on lines fully inside.
      const top = bodyBox.y;
      const bottom = bodyBox.y + bodyBox.h;
      const clip = (b) => {
        const y0 = Math.max(top, b.y);
        const y1 = Math.min(bottom, b.y + b.h);
        return y1 > y0 ? { x: b.x, y: y0, w: b.w, h: y1 - y0 } : null;
      };
      const inside = (b) => b && b.y >= top - 0.5 && b.y + b.h <= bottom + 0.5;
      // Summary and table text: the panel's own font (0.7 of the row height
      // variable in styles.css, not of the row box, which also holds the 1px rule).
      const bodyStyle = getComputedStyle(body);
      const px = parseFloat(bodyStyle.fontSize) || 0;
      const family = bodyStyle.fontFamily || NODE_GRAPH_AUDIO_PLAYER_FACE_FAMILY;
      const summary = body.querySelector(".node-music-player-pl-ram-summary");
      const summaryBox = box(summary);
      if (inside(summaryBox)) {
        text(nodeGraphAudioPlayerFaceGlEllipsis(summary.textContent, px, summaryBox.w, family), summaryBox.x,
          summaryBox.y + summaryBox.h / 2, px, look.infoColor, "left", 0, family);
      }
      const table = body.querySelector(".node-music-player-pl-ram-table");
      const tableBox = box(table);
      const rows = table ? table.querySelectorAll("tr") : [];
      for (let i = 0; i < rows.length; i += 1) {
        const tr = rows[i];
        const b = box(tr);
        const shown = b && clip(b);
        if (!shown) continue;
        if (tr.dataset.playing === "true") rect(shown, look.dim);
        const hotRow = tr.dataset.active === "true" || tr.classList.contains("is-heavy");
        const ink = hotRow ? look.hot : look.infoColor;
        const line = b.y + b.h - 1;
        if (line >= top && line < bottom) {
          rect({ x: tableBox ? tableBox.x : b.x, y: line, w: tableBox ? tableBox.w : b.w, h: 1 }, look.dim);
        }
        if (!inside(b)) continue;
        for (const cell of tr.children) {
          const c = box(cell);
          if (!c) continue;
          // Cells pad 8px (x UI scale) each side; header 0.7, empty-list note 0.6 and centred.
          // Only the name column cuts with an ellipsis (the others size to fit).
          const empty = cell.classList.contains("node-music-player-pl-ram-empty");
          const cellInk = cell.tagName === "TH"
            ? nodeGraphAudioPlayerFaceGlAlpha(ink, 0.7)
            : (empty ? nodeGraphAudioPlayerFaceGlAlpha(ink, 0.6) : ink);
          const str = cell.classList.contains("node-music-player-pl-ram-name")
            ? nodeGraphAudioPlayerFaceGlEllipsis(cell.textContent, px, c.w - 16 * uiScale, family)
            : cell.textContent;
          if (empty) text(str, c.x + c.w / 2, c.y + c.h / 2, px, cellInk, "center", 0, family);
          else text(str, c.x + 8 * uiScale, c.y + c.h / 2, px, cellInk, "left", 0, family);
        }
      }
      if (body.scrollHeight > body.clientHeight + 1) {
        const track = body.clientHeight;
        const thumbH = Math.max(8, (track * track) / body.scrollHeight);
        const thumbY = (body.scrollTop / Math.max(1, body.scrollHeight - track)) * (track - thumbH);
        rect({ x: bodyBox.x + body.clientWidth, y: bodyBox.y + thumbY, w: Math.max(0, bodyBox.w - body.clientWidth), h: thumbH }, look.dim);
      }
    }
  }
  if (pageBar) buttonRow(pageBar, ".node-music-player-page-btn", pageLabel);
  section._musicPlayerFaceBlinking = blinking;
  return { rects, texts };
}

/** Paint the face texture. Returns true when it drew. */
function drawNodeGraphAudioPlayerFace(section) {
  const face = section?._musicPlayerFace;
  if (!face || !face.isConnected || face.parentElement !== section) return false;
  const cssW = face.offsetWidth;
  const cssH = face.offsetHeight;
  if (!(cssW >= 4) || !(cssH >= 4)) return false;
  const dpr = typeof nodeGraphDisplayCanvasPixelRatio === "function"
    ? nodeGraphDisplayCanvasPixelRatio(2)
    : Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
  const resized = typeof nodeGraphDisplayCanvasSetBacking === "function"
    && nodeGraphDisplayCanvasSetBacking(face, cssW * dpr, cssH * dpr);
  // Tile size first: the hit layer re-lays out at the face's UI scale.
  const uiScale = nodeGraphAudioPlayerFaceGlUiScale(section, face, cssW, cssH);
  nodeGraphAudioPlayerFaceGlApplyUiScale(section, uiScale);
  // Hit boxes are measured from the display's padding edge; the face fills it.
  const origin = { x: face.offsetLeft, y: face.offsetTop };
  const look = nodeGraphAudioPlayerFaceGlLook(section.dataset.node || "");
  const ops = nodeGraphAudioPlayerFaceGlLayout(section, origin, look, uiScale);
  const signature = JSON.stringify([face.width, face.height, ops]);
  if (!resized && section._musicPlayerFaceSignature === signature) return false;
  const scale = face.width / cssW;
  // Text sizes come from the hit layer's own boxes: no extra ink scale.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(face, NODE_GRAPH_AUDIO_PLAYER_FACE_PLATE, { scale, textInk: false })
    : null;
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(face, "music player face: no shared GL device");
    return false;
  }
  // Whole device px, so 1px borders and dividers stay crisp.
  const snap = (v) => Math.round(v * scale) / scale;
  for (const [x, y, w, h, rgba] of ops.rects) {
    const x0 = snap(x);
    const y0 = snap(y);
    nodeGraphGlLinesRect(batch, x0, y0, Math.max(1 / scale, snap(x + w) - x0), Math.max(1 / scale, snap(y + h) - y0), rgba);
  }
  for (const [str, x, y, px, rgba, align, maxWidth, family] of ops.texts) {
    nodeGraphGlLinesText(batch, str, x, y, {
      px, rgba, align, baseline: "middle", maxWidth: maxWidth || undefined,
      family, weight: 600,
    });
  }
  if (nodeGraphGlLinesEnd(batch) === false) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(face, "music player face: draw failed");
    return false;
  }
  section._musicPlayerFaceSignature = signature;
  // A new backing size changes the face's display rect: rebuild the stacks.
  if (resized && typeof nodeGraphGlGraphNoteFaceCanvasSized === "function") nodeGraphGlGraphNoteFaceCanvasSized();
  return true;
}
