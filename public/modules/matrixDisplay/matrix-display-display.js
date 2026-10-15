// Matrix Display face — XY sample plot into age grid + glyph ramp (asciiscope-style).

const matrixDisplaySimStates = new Map();

/**
 * Density selects columns×rows (one glyph per cell). On resize, ages remap
 * (max age in covered region) — not wiped — so residual burns persist.
 */
function matrixDisplayEnsureSim(nodeId, paramsOrCols, maybeRows) {
  let grid;
  if (paramsOrCols && typeof paramsOrCols === "object" && paramsOrCols.columns) {
    grid = paramsOrCols;
  } else if (typeof matrixResolveDensityGrid === "function") {
    const dens = typeof paramsOrCols === "number" ? paramsOrCols : 0.7;
    grid = matrixResolveDensityGrid(dens);
  } else {
    const columns = Math.max(1, (paramsOrCols | 0) || 64);
    const rows = Math.max(1, (maybeRows | 0) || 36);
    grid = { columns, rows, stamp: 1, bufColumns: columns, bufRows: rows };
  }
  const columns = Math.max(1, (grid.columns || grid.bufColumns) | 0);
  const rows = Math.max(1, (grid.rows || grid.bufRows) | 0);
  const n = columns * rows;
  let state = matrixDisplaySimStates.get(nodeId);
  if (!state) {
    state = {
      columns,
      rows,
      stamp: 1,
      stampX: 1,
      stampY: 1,
      bufColumns: columns,
      bufRows: rows,
      ages: new Uint8Array(n),
      lastMs: 0,
      xRead: 0,
      yRead: 0,
      lastXBuf: null,
      lastYBuf: null,
    };
    matrixDisplaySimStates.set(nodeId, state);
    return state;
  }
  if (state.columns !== columns || state.rows !== rows || state.ages?.length !== n) {
    // Remap ages into new density grid without wipe.
    const oldCols = Math.max(1, state.columns | 0);
    const oldRows = Math.max(1, state.rows | 0);
    const oldAges = state.ages;
    const ages = new Uint8Array(n);
    if (oldAges?.length) {
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < columns; c += 1) {
          const c0 = Math.floor((c * oldCols) / columns);
          const c1 = Math.max(c0 + 1, Math.ceil(((c + 1) * oldCols) / columns));
          const r0 = Math.floor((r * oldRows) / rows);
          const r1 = Math.max(r0 + 1, Math.ceil(((r + 1) * oldRows) / rows));
          let best = 0;
          for (let rr = r0; rr < Math.min(oldRows, r1); rr += 1) {
            for (let cc = c0; cc < Math.min(oldCols, c1); cc += 1) {
              const a = oldAges[rr * oldCols + cc] || 0;
              if (a > best) best = a;
            }
          }
          ages[r * columns + c] = best;
        }
      }
    }
    state.ages = ages;
    state.columns = columns;
    state.rows = rows;
  }
  state.stamp = 1;
  state.stampX = 1;
  state.stampY = 1;
  state.bufColumns = columns;
  state.bufRows = rows;
  return state;
}

/**
 * Phosphor fade for age grid. Trail 0 = pure Ghost path weight; 1 ≈ freeze.
 * Ghost = extreme analog hang.
 * Frame-rate independent.
 */
function matrixDisplayFade(ages, trail, _dtSec = 1 / 60, maxAge = 32, ghost = 0) {
  const Residual = typeof PhosphorResidual !== "undefined" ? PhosphorResidual : null;
  const t = Math.max(0, Math.min(1, nodeGraphFiniteNumber(trail)));
  const ghostAmt = Math.max(0, Math.min(1, nodeGraphFiniteNumber(ghost)));
  const ma = Math.max(1, maxAge);
  const step = Residual?.applyResidual
    ? (e) => Residual.applyResidual(e, t, ghostAmt)
    : (e) => e;
  for (let i = 0; i < ages.length; i += 1) {
    const a = ages[i];
    if (a <= 0) continue;
    const e1 = step(a / ma);
    ages[i] = e1 <= 0 ? 0 : Math.max(1, Math.min(ma, Math.round(e1 * ma)));
  }
}

function matrixDisplayPlot(state, x, y, intensity, maxAge) {
  // intensity = brightness deposit 0..1 (single light axis).
  const cols = state.columns | 0;
  const rows = state.rows | 0;
  const px = Math.round((x * 0.5 + 0.5) * (cols - 1));
  const py = Math.round((0.5 - y * 0.5) * (rows - 1));
  if (px < 0 || px >= cols || py < 0 || py >= rows) {
    return;
  }
  const dep = Math.max(0, Math.min(1, nodeGraphFiniteNumber(intensity)));
  if (dep <= 0) return;
  const age = Math.max(1, Math.min(maxAge, Math.round(maxAge * dep)));
  const idx = py * cols + px;
  if (age > state.ages[idx]) {
    state.ages[idx] = age;
  }
}

function matrixDisplayReadPortBuffer(nodeId, port) {
  try {
    const buffers = typeof nodeGraphModuleScopeState !== "undefined"
      ? nodeGraphModuleScopeState?.buffers
      : null;
    if (buffers?.get) {
      const keyed = buffers.get(`${nodeId}:${port}`);
      if (keyed?.length) return keyed;
    }
    // Same path as scope2d: follow wire to source node's output buffer.
    if (typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
      const connected = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
      if (connected?.length) return connected;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Plot new samples from X/Y ring buffers. If only one buffer exists, treat as
 * mono and use a phase saw for the other axis so something still moves.
 */
function matrixDisplayIngestBuffers(state, maxAge, brightness) {
  const xBuf = matrixDisplayReadPortBuffer(state.nodeId || "", "X")
    || matrixDisplayReadPortBuffer(state.nodeId || "", "In");
  const yBuf = matrixDisplayReadPortBuffer(state.nodeId || "", "Y");

  // Store nodeId on state from caller
  const xb = xBuf;
  const yb = yBuf;

  if (!xb?.length && !yb?.length) {
    return 0;
  }

  // Prefer paired capture: walk the shorter new-tail window.
  const xArr = xb || null;
  const yArr = yb || null;
  const len = Math.min(xArr?.length || 0, yArr?.length || Infinity);
  const mono = xArr && !yArr ? xArr : (!xArr && yArr ? yArr : null);

  let plotted = 0;
  // Burn = deposit gain only. 0 is valid (no write). Brightness is display-only.
  const intensity = Math.max(0, Math.min(1, nodeGraphFiniteNumber(burn)));

  if (xArr && yArr && Number.isFinite(len) && len > 0) {
    // Plot up to last N samples for frame budget
    const budget = Math.min(len, 2048);
    const start = len - budget;
    for (let i = start; i < len; i += 1) {
      const x = nodeGraphFiniteNumber(xArr[i]);
      const y = nodeGraphFiniteNumber(yArr[i]);
      matrixDisplayPlot(state, x, y, intensity, maxAge);
      plotted += 1;
    }
    return plotted;
  }

  if (mono?.length) {
    const budget = Math.min(mono.length, 2048);
    const start = mono.length - budget;
    for (let i = start; i < mono.length; i += 1) {
      const v = nodeGraphFiniteNumber(mono[i]);
      // Lissajous-ish fallback: v vs delayed self
      const d = nodeGraphFiniteNumber(mono[Math.max(start, i - 32)]);
      matrixDisplayPlot(state, v, d, intensity, maxAge);
      plotted += 1;
    }
  }
  return plotted;
}

const MATRIX_DISPLAY_GL_FONT = '"Cascadia Mono", Consolas, "Courier New", monospace';
const MATRIX_DISPLAY_GL_PLATE = [1 / 255, 1 / 255, 4 / 255, 1];
// css colour -> rgba01, shared across faces (the age palette has few distinct
// strings), so per-frame drawing does not reparse or allocate.
const matrixDisplayGlColourCache = new Map();
const matrixDisplayGlTextOpts = {
  px: 12, weight: 600, family: MATRIX_DISPLAY_GL_FONT, align: "center", baseline: "middle", rgba: null,
};

function matrixDisplayGlColour(css) {
  let c = matrixDisplayGlColourCache.get(css);
  if (!c) {
    if (matrixDisplayGlColourCache.size > 4096) matrixDisplayGlColourCache.clear();
    c = nodeGraphGlLinesCss(css);
    matrixDisplayGlColourCache.set(css, c);
  }
  return c;
}

function matrixDisplayDrawFace(canvas, state, glyphRamp, params) {
  const host = canvas?.parentElement || canvas;
  // Shared sizing (css x dpr capped, never zoom); drawing is WebGL2 via gl-line-renderer.
  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(host, canvas) : null;
  if (!m) return;
  const pw = Math.max(1, m.width);
  const ph = Math.max(1, m.height);
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, MATRIX_DISPLAY_GL_PLATE)
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }

  const cols = state.columns;
  const rows = state.rows;
  const cellW = pw / cols;
  const cellH = ph / rows;
  const fontPx = Math.max(4, Math.min(cellW, cellH) * 0.92);

  // Brightness 0: plate only, no glyphs.
  const bRaw = Number(params?.brightness);
  const bright = Number.isFinite(bRaw) ? bRaw : 1;
  if (bright > 0) {
    const maxAge = MATRIX_DISPLAY_MAX_AGE;
    const floor = params.blackFloor || 0;
    const ages = state.ages;
    const opts = matrixDisplayGlTextOpts;
    opts.px = fontPx;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const age = ages[r * cols + c];
        if (age <= floor) continue;
        const glyph = matrixDisplayGlyphForAge(glyphRamp, age, maxAge);
        if (glyph === " ") continue;
        opts.rgba = matrixDisplayGlColour(matrixDisplayColorForAge(age, maxAge, params.brightness));
        // No ad-hoc shadow glow — brightness/decay only.
        nodeGraphGlLinesText(batch, glyph, (c + 0.5) * cellW, (r + 0.5) * cellH, opts);
      }
    }
  }
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

function matrixDisplayTickFace(face) {
  const nodeId = face?.dataset?.node;
  if (!nodeId || !face.isConnected) return;
  if (
    typeof nodeGraphElementInSkippedContentVisibility === "function"
    && nodeGraphElementInSkippedContentVisibility(face)
  ) {
    return;
  }
  // Scope system must not leave a Trace local-fallback canvas over this face.
  for (const overlay of face.querySelectorAll?.(
    ":scope > .node-module-scope-local-fallback-canvas",
  ) || []) {
    overlay.remove();
  }
  if (typeof nodeGraphModuleScopePersistentCanvases !== "undefined") {
    nodeGraphModuleScopePersistentCanvases.delete?.(nodeId);
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const params = matrixDisplayParamsFromNode(node);
  const canvas = face.querySelector(".node-matrix-display-canvas");
  if (!canvas) return;

  const rawStore = node?.asciiscope?.glyphRamp != null
    ? node.asciiscope
    : (node?.matrixDisplay?.glyphRamp != null ? node.matrixDisplay : node?.asciiscope);
  const store = typeof normalizeNodeGraphMatrixDisplay === "function"
    ? normalizeNodeGraphMatrixDisplay(rawStore)
    : { glyphRamp: MATRIX_DISPLAY_DEFAULT_GLYPH_RAMP };
  const state = matrixDisplayEnsureSim(nodeId, params);
  state.nodeId = nodeId;

  const now = performance.now?.() || Date.now();
  const dt = state.lastMs > 0 ? Math.min(0.05, (now - state.lastMs) / 1000) : 1 / 60;
  state.lastMs = now;

  if (!params.freeze) {
    // One exponential step per frame (dt-aware) — not N discrete age chops.
    matrixDisplayFade(state.ages, params.trail, dt, MATRIX_DISPLAY_MAX_AGE, params.ghost);
    // Deposit from brightness; ghost only affects residual hang in fade.
    matrixDisplayIngestBuffers(state, MATRIX_DISPLAY_MAX_AGE, params.brightness);
  }

  matrixDisplayDrawFace(canvas, state, store.glyphRamp, params);
}

let matrixDisplayRaf = 0;
function matrixDisplaySchedulePump() {
  if (matrixDisplayRaf) return;
  matrixDisplayRaf = window.requestAnimationFrame(() => {
    matrixDisplayRaf = 0;
    const faces = document.querySelectorAll(".node-matrix-display-face");
    if (!faces.length) return;
    // Respect Simulation FPS (same clock as scopes / phosphor / LCD / LED).
    const frameReady = typeof nodeGraphDisplayFrameReady === "function"
      ? nodeGraphDisplayFrameReady("matrixDisplay")
      : true;
    if (frameReady && !(typeof nodeGraphDisplaysFrozen === "function" && nodeGraphDisplaysFrozen())) {
      for (const face of faces) {
        if (typeof nodeGraphScreenSoloAllowsNode === "function"
          && !nodeGraphScreenSoloAllowsNode(
            typeof nodeGraphDisplayNodeIdFromElement === "function"
              ? nodeGraphDisplayNodeIdFromElement(face)
              : face.closest?.(".dsp-node")?.dataset?.node,
          )) {
          continue;
        }
        matrixDisplayTickFace(face);
      }
    }
    matrixDisplaySchedulePump();
  });
}

function matrixDisplayStartPump() {
  matrixDisplaySchedulePump();
}

if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    matrixDisplayStartPump();
  });
}
