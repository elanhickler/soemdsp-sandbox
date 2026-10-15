// Face for Additive Linear / Analog Filter —
// response on the same log-Hz X axis as Additive Out harmonicLines.

function createNodeGraphAdditiveFilterCurveDisplay(nodeId, type = "additiveLinearFilter") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-additive-filter-curve-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "additiveLinearFilter");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.5";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-additive-filter-curve-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `additiveFilterCurve:${el.dataset?.node || ""}`,
    paint: drawNodeGraphAdditiveFilterCurveDisplay,
  });
  return section;
}

function nodeGraphAdditiveFilterCurveEffective(node, key, fallback) {
  const num = typeof nodeGraphFiniteNumber === "function"
    ? nodeGraphFiniteNumber
    : (v, fb) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : (fb || 0);
    };
  const p = node?.params || node?.parameters || {};
  const base = num(p[key], fallback);
  const nodeId = node?.id;
  const meta = (typeof nodeGraphReadPatchParameterMetadata === "function" && nodeId
    ? nodeGraphReadPatchParameterMetadata(nodeId, key)
    : node?.paramMeta?.[key]) || {};
  const ghost = typeof nodeGraphParameterGhostSignal === "function" && nodeId
    ? nodeGraphParameterGhostSignal(nodeId, key)
    : null;
  const ghostN = Number(ghost?.effectiveDomain);
  if (Number.isFinite(ghostN)) return ghostN;
  if (typeof nodeGraphParamFoldOrBase === "function") {
    const folded = Number(nodeGraphParamFoldOrBase(base, [], meta));
    if (Number.isFinite(folded)) return folded;
  }
  return base;
}

function nodeGraphAdditiveFilterCurveReadParams(nodeId, type) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const num = typeof nodeGraphFiniteNumber === "function"
    ? nodeGraphFiniteNumber
    : (v, fb) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fb;
    };
  const p = node?.params || node?.parameters || {};
  const isLinear = type === "additiveLinearFilter";
  const filter = num(p.filter, 0);
  const cutoffHz = nodeGraphAdditiveFilterCurveEffective(node, "cutoff", 2000);
  const slope = nodeGraphAdditiveFilterCurveEffective(node, "slope", isLinear ? 0.25 : 12);
  const skew = nodeGraphAdditiveFilterCurveEffective(node, "skew", 0);
  const resonance = type === "additiveLadderFilter"
    ? nodeGraphAdditiveFilterCurveEffective(node, "resonance", 0)
    : 0;
  const curveMode = isLinear ? Math.round(num(p.curve, 0)) : 0;
  const sr = Math.max(
    1,
    nodeGraphFiniteNumber(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.sampleRate : 0, nodeGraphFiniteNumber(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live?.sampleRate : 0, 44100)),
  );
  let curveKind = "butterworth";
  if (isLinear) curveKind = curveMode === 1 ? "bipolarRational" : "rational";
  else if (type === "additiveLadderFilter") curveKind = "ladder";
  return {
    mode: filter,
    cutoffHz,
    slope,
    skew,
    resonance,
    sampleRate: sr,
    curveKind,
    curveMode,
  };
}

function drawNodeGraphAdditiveFilterCurveDisplay(section) {
  if (!section) return;
  const canvas = section.querySelector("canvas");
  if (!canvas) return;

  // Shared sizing (css x dpr, never zoom); drawing is WebGL2 via gl-line-renderer.
  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas) : null;
  if (!m || m.cssWidth < 8 || m.cssHeight < 8) return;
  const w = m.cssWidth;
  const h = m.cssHeight;

  const nodeId = section.dataset.node;
  const type = section.dataset.nodeType;
  const params = nodeGraphAdditiveFilterCurveReadParams(nodeId, type);
  const samples = Math.max(32, Math.min(256, Math.round(w)));
  const curve = params.curveKind === "ladder"
    && typeof additiveGraphLadderResponseCurveLogHz === "function"
    ? additiveGraphLadderResponseCurveLogHz(
      params.mode,
      params.cutoffHz,
      params.slope,
      params.resonance,
      params.sampleRate,
      samples,
    )
    : (typeof additiveGraphFilterResponseCurveLogHz === "function"
      ? additiveGraphFilterResponseCurveLogHz(
        params.mode,
        params.cutoffHz,
        params.slope,
        params.curveKind,
        params.skew,
        params.sampleRate,
        samples,
        params.curveMode,
      )
      : null);
  const ys = curve?.ys || null;
  const cutoffT = Number.isFinite(curve?.cutoffT) ? curve.cutoffT : 0;

  const sig = [
    type,
    params.mode,
    params.cutoffHz.toFixed(2),
    params.slope.toFixed(4),
    params.skew.toFixed(4),
    Number(params.curveMode || 0),
    Number(params.resonance || 0).toFixed(4),
    params.sampleRate,
    w,
    h,
  ].join("|");
  if (section._curveSig === sig && !section._forceDraw) return;
  section._curveSig = sig;
  section._forceDraw = false;

  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [10 / 255, 10 / 255, 18 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }

  // Same framing as Additive Out: pad + log-X cutoff marker.
  const minSide = faceMinSide(w, h);
  const pad = Math.max(2, faceFracPx(0.02, minSide));
  const span = Math.max(1, w - pad * 2);
  const strokeGrid = faceInkPx(1, minSide);
  const strokeCurve = faceInkPx(1.5, minSide);

  const grid = [1, 230 / 255, 0, 0.12];
  const gHalf = Math.max(0, strokeGrid * 0.5 - 0.35);
  nodeGraphGlLinesSegment(batch, pad, h * 0.5, pad + span, h * 0.5, gHalf, 0.7, grid);
  const cutX = pad + Math.max(0, Math.min(1, cutoffT)) * span;
  nodeGraphGlLinesSegment(batch, cutX, 0, cutX, h, gHalf, 0.7, grid);

  if (!ys || !ys.length) {
    if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }

  const padY = Math.max(2, faceFracPx(0.022, minSide));
  const pts = new Array(ys.length * 2);
  for (let i = 0; i < ys.length; i += 1) {
    const u = i / Math.max(1, ys.length - 1);
    pts[i * 2] = pad + u * span;
    pts[i * 2 + 1] = padY + (1 - nodeGraphFiniteNumber(ys[i])) * (h - padY * 2);
  }
  nodeGraphGlLinesPolyline(batch, pts, Math.max(0, strokeCurve * 0.5 - 0.35), 0.7, [1, 230 / 255, 0, 1]);
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.additiveFilterCurve = () => {};
}
