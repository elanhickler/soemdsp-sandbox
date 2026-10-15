// Harmonic lines face for Additive Out —
// X = log freq (shared Additive axis), color = phase, vertical center = balance:
//   above center = Left amp, below center = Right amp (from pan[]).
// WhiteNoise recipes (*Noise) animate locally each frame (display-only streams).
// Stem width is authored CSS px at the 96 px reference, scaled by face min-edge at paint.

const nodeGraphHarmonicLinesSettingsDefaults = Object.freeze({
  lineWidth: 2,
});

function normalizeNodeGraphHarmonicLinesSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const raw = Number(source.lineWidth);
  const ink = clampAuthoredInkPx(raw, 2);
  return {
    lineWidth: Math.max(0.5, Math.min(8, ink)),
  };
}

function nodeGraphHarmonicLinesSettingsForNode(node) {
  return normalizeNodeGraphHarmonicLinesSettings(node?.harmonicLinesSettings);
}

function buildNodeGraphHarmonicLinesDisplaySettingsBodyHtml() {
  return `
    <div class="node-led-display-settings-panel" data-harmonic-lines-display-settings-panel>
      <label class="node-led-settings-row">
        <span>Line width</span>
        <input type="range" min="0.5" max="8" step="0.25" data-harmonic-lines-field="lineWidth" aria-label="Harmonic line width in pixels">
        <span>px</span>
      </label>
    </div>`;
}

function syncNodeGraphHarmonicLinesDisplaySettingsControls(root, settings) {
  if (!root || !settings) return;
  const el = root.querySelector?.(`[data-harmonic-lines-field="lineWidth"]`);
  if (el && document.activeElement !== el) {
    el.value = String(settings.lineWidth);
  }
}

function bindNodeGraphHarmonicLinesDisplaySettingsBody(host) {
  if (!host || host.dataset.harmonicLinesSettingsBound === "true") {
    return;
  }
  host.dataset.harmonicLinesSettingsBound = "true";
  const apply = (persist) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty(["lineWidth"]);
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record: persist === "immediate" });
    }
  };
  host.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-harmonic-lines-field]")) apply("debounce");
  });
  host.addEventListener("change", (event) => {
    if (event.target?.closest?.("[data-harmonic-lines-field]")) apply("immediate");
  });
  if (typeof bindNodeGraphNativeSliderModifiers === "function") {
    const input = host.querySelector(`[data-harmonic-lines-field="lineWidth"]`);
    if (input) {
      bindNodeGraphNativeSliderModifiers(input, nodeGraphHarmonicLinesSettingsDefaults.lineWidth);
    }
  }
}

function createNodeGraphHarmonicLinesDisplay(nodeId, type = "additiveOut") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-harmonic-lines-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "additiveOut");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.7";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-harmonic-lines-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `harmonicLines:${el.dataset?.node || ""}`,
    paint: drawNodeGraphHarmonicLinesDisplay,
  });
  return section;
}

function nodeGraphHarmonicLinesReadGraph(nodeId) {
  // Own publish is post-slope (Additive Out masks after the inlet).
  // The Graph inlet is the unmasked upstream spectrum.
  if (typeof nodeGraphDataBus !== "undefined") {
    const view = nodeGraphDataBus.get?.(`${nodeId}.GraphView`);
    if (view?.ratio) return view;
    const own = nodeGraphDataBus.get?.(`${nodeId}.Graph`);
    if (own?.ratio) return own;
  }
  if (typeof readNodeGraphDataInput === "function") {
    const g = readNodeGraphDataInput(nodeId, "Graph");
    if (g?.ratio) return g;
  }
  return null;
}

/** Follow Graph inputs upstream (through effects) to the Additive Generator. Null when none. */
function nodeGraphHarmonicLinesUpstreamGenerator(nodeId) {
  const connections = Array.isArray(nodeGraphMvp?.patch?.connections) ? nodeGraphMvp.patch.connections : [];
  const seen = new Set();
  let id = String(nodeId || "");
  while (id && !seen.has(id)) {
    seen.add(id);
    const edge = connections.find((c) => String(c?.destinationNode || "") === id
      && String(c?.destinationPort || "") === "Graph");
    if (!edge) return null;
    id = String(edge.sourceNode || "");
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
    if (!node) return null;
    if (String(node.type || "") === "additiveGenerator") return node;
  }
  return null;
}

/** Display-only walks for WhiteNoise face animation (does not touch audio state). */
function nodeGraphHarmonicLinesDisplayWalks(section, key, H, salt, seed) {
  if (!section._noiseVis) section._noiseVis = Object.create(null);
  const slot = section._noiseVis;
  const s0 = (Math.floor(Number(seed)) || 0) >>> 0;
  const family = (Math.floor(Number(salt)) || 0) >>> 0;
  let pack = slot[key];
  if (
    !pack
    || pack.seed !== s0
    || pack.salt !== family
    || !Array.isArray(pack.walks)
    || pack.walks.length !== H
  ) {
    const walks = typeof additiveGraphEnsureWalks === "function"
      ? additiveGraphEnsureWalks(null, H, family, s0)
      : [];
    pack = { seed: s0, salt: family, walks };
    slot[key] = pack;
  }
  return pack.walks;
}

function drawNodeGraphHarmonicLinesDisplay(section) {
  if (!section) return;
  const canvas = section.querySelector("canvas");
  if (!canvas) return;

  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas) : null;
  if (!m || m.cssWidth < 8 || m.cssHeight < 8) return;
  const w = m.cssWidth;
  const h = m.cssHeight;

  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [5 / 255, 5 / 255, 8 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    section._forceDraw = false;
    return;
  }

  const nodeId = section.dataset.node;
  // No Graph edge / no Additive Generator upstream → placeholder only (no bars, no curve).
  const maskGen = nodeGraphHarmonicLinesUpstreamGenerator(nodeId);
  if (!maskGen) {
    nodeGraphGlLinesText(batch, "connect Additive Generator", w * 0.5, h * 0.5, { px: 12, weight: 400, family: "ui-monospace, monospace", rgba: [0.4, 0.4, 0.4, 1], maxWidth: w - 4 });
    nodeGraphGlLinesEnd(batch);
    section._forceDraw = false;
    return;
  }
  const graph = nodeGraphHarmonicLinesReadGraph(nodeId);
  if (!graph || !graph.ratio || !graph.ratio.length) {
    nodeGraphGlLinesText(batch, "no Graph", w * 0.5, h * 0.5, { px: 12, weight: 400, family: "ui-monospace, monospace", rgba: [0.4, 0.4, 0.4, 1] });
    nodeGraphGlLinesEnd(batch);
    section._forceDraw = false;
    return;
  }

  const H = Math.max(1, graph.ratio.length | 0);
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  let freqHz = Number(graph.frequencyHz ?? node?.params?.frequency ?? node?.parameters?.frequency);
  if (!Number.isFinite(freqHz)) freqHz = 100;
  const sr = nodeGraphFiniteNumber(nodeGraphMvp?.sampleRate, nodeGraphFiniteNumber(nodeGraphMvp?.live?.sampleRate, 44100));

  const axis = typeof additiveGraphDisplayFreqAxis === "function"
    ? additiveGraphDisplayFreqAxis(sr)
    : null;
  const xMinHz = axis?.xMinHz ?? 20;
  const xMaxHz = axis?.xMaxHz ?? 20000;
  const logXMin = axis?.logXMin ?? Math.log(xMinHz);
  const logXSpan = axis?.logXSpan ?? Math.log(xMaxHz) - logXMin;

  const ratioNoise = graph.ratioNoise && Number(graph.ratioNoise.mode) === 2
    ? graph.ratioNoise
    : null;
  const phaseNoise = graph.phaseNoise && Number(graph.phaseNoise.mode) === 2
    ? graph.phaseNoise
    : null;
  const panNoise = graph.panNoise && Number(graph.panNoise.mode) === 2
    ? graph.panNoise
    : null;
  const ampNoise = graph.ampNoise && Number(graph.ampNoise.mode) === 2
    ? graph.ampNoise
    : null;

  const ratioWalks = ratioNoise
    ? nodeGraphHarmonicLinesDisplayWalks(section, "ratio", H, 13, ratioNoise.seed)
    : null;
  const phaseWalks = phaseNoise
    ? nodeGraphHarmonicLinesDisplayWalks(section, "phase", H, 29, phaseNoise.seed)
    : null;
  const panWalks = panNoise
    ? nodeGraphHarmonicLinesDisplayWalks(section, "pan", H, 47, panNoise.seed)
    : null;
  const ampWalks = ampNoise
    ? nodeGraphHarmonicLinesDisplayWalks(section, "amp", H, 61, ampNoise.seed)
    : null;

  const ampFloorDb = -60;
  let maxAmp = 1e-6;
  // Slope
  const maskParams = (typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(nodeId)?.params
    : null) || {};
  const maskSlopeRaw = Number(maskParams.slope);
  const maskSlope = Number.isFinite(maskSlopeRaw) ? maskSlopeRaw : 1;
  const maskSkewRaw = Number(maskParams.skew);
  const maskSkew = Number.isFinite(maskSkewRaw) ? maskSkewRaw : 1;
  const maskCurve = typeof nodeGraphChoiceIdForKey === "function"
    ? Number(nodeGraphChoiceIdForKey("additiveOut", "curve", maskParams.curve)) || 0
    : 0;
  const trackFilter = maskSlope > 0
    && freqHz > 0
    && typeof additiveGraphSlopeGain === "function"
    && typeof additiveGraphResolveSlopeRange === "function";
  const maskRange = trackFilter
    ? additiveGraphResolveSlopeRange(maskParams.harmonics, maskParams.slopeStart, maskParams.slopeEnd)
    : null;
  const filterGainAt = (hz) => additiveGraphSlopeGain(
    hz / freqHz, maskSlope, maskRange.start, maskRange.end, maskSkew, maskCurve,
  );
  const effectiveAmp = new Float32Array(H);
  const leftAmp = new Float32Array(H);
  const rightAmp = new Float32Array(H);
  const hzAt = new Float32Array(H);
  const phaseAt = new Float32Array(H);
  const hasPan = (graph.pan && graph.pan.length >= H) || Boolean(panNoise);

  for (let i = 0; i < H; i += 1) {
    let ratio = nodeGraphFiniteNumber(graph.ratio[i]);
    if (ratioWalks && typeof cheapWhiteNoiseStep === "function") {
      const w = cheapWhiteNoiseStep(ratioWalks[i]);
      const add = nodeGraphFiniteNumber(ratioNoise.amount);
      ratio = Math.max(0, ratio + w * add);
    }
    const hz = ratio * freqHz;
    hzAt[i] = hz;

    let amp = Math.abs(graph.amplitude[i] || 0);
    if (ampWalks && typeof cheapWhiteNoiseStep === "function") {
      const w = cheapWhiteNoiseStep(ampWalks[i]);
      const add = nodeGraphFiniteNumber(ampNoise.amount);
      amp = Math.max(0, Math.min(1, amp + w * add));
    }
    const nyqGain = typeof additiveGraphNyquistAmpGain === "function"
      ? additiveGraphNyquistAmpGain(hz, sr)
      : 1;
    const a = amp * nyqGain;
    effectiveAmp[i] = a;

    // Color = Graph phase offsets (+ NoisyPhase WhiteNoise preview), not free-running phaseAcc.
    let phase = typeof additiveGraphEffectivePhase === "function"
      ? additiveGraphEffectivePhase(graph, i, 0, 1)
      : (nodeGraphFiniteNumber(graph.phase[i]));
    if (phaseWalks && typeof cheapWhiteNoiseStep === "function") {
      const w = cheapWhiteNoiseStep(phaseWalks[i]);
      const add = nodeGraphFiniteNumber(phaseNoise.amount);
      phase = typeof additiveGraphWrap01 === "function"
        ? additiveGraphWrap01(phase + w * add)
        : phase + w * add;
    }
    phaseAt[i] = typeof additiveGraphWrap01 === "function"
      ? additiveGraphWrap01(phase)
      : phase;

    let pan = hasPan
      ? (typeof additiveGraphEffectivePan === "function"
        ? additiveGraphEffectivePan(graph, i, 0, 1)
        : (nodeGraphFiniteNumber(graph.pan?.[i])))
      : 0;
    if (panWalks && typeof cheapWhiteNoiseStep === "function") {
      const w = cheapWhiteNoiseStep(panWalks[i]);
      const add = nodeGraphFiniteNumber(panNoise.amount);
      pan = pan + w * add;
    }
    pan = pan;
    const gains = typeof additiveGraphPanGains === "function"
      ? additiveGraphPanGains(pan)
      : { left: 0.5 * (1 - pan), right: 0.5 * (1 + pan) };
    leftAmp[i] = a * gains.left * 2;
    rightAmp[i] = a * gains.right * 2;
    if (leftAmp[i] > maxAmp) maxAmp = leftAmp[i];
    if (rightAmp[i] > maxAmp) maxAmp = rightAmp[i];
  }

  const midY = h * 0.5;
  const maxH = h * 0.46;
  const pad = Math.max(2, w * 0.02);
  const span = Math.max(1, w - pad * 2);
  const faceMin = faceMinSide(w, h);
  const lineW = faceInkPx(
    typeof nodeGraphHarmonicLinesSettingsForNode === "function"
      ? nodeGraphHarmonicLinesSettingsForNode(node).lineWidth
      : 2,
    faceMin,
  );

  // Dim mid line — Left above, Right below.
  // Capsule half-width for a CSS stroke width: core = w/2 - 0.35, 0.7 px feather.
  const half = (lw) => Math.max(0, lw * 0.5 - 0.35);
  nodeGraphGlLinesSegment(batch, pad, midY, pad + span, midY, half(faceInkPx(1, faceMin)), 0.7, [1, 1, 1, 0.18]);

  const ampRef = maxAmp;
  const ampToHeight = (amp) => {
    if (!(amp > 0) || !(ampRef > 0)) return 0;
    const db = 20 * Math.log10(Math.max(1e-12, amp / ampRef));
    const ampT = Math.max(0, Math.min(1, (db - ampFloorDb) / -ampFloorDb));
    return ampT * maxH;
  };

  for (let i = 0; i < H; i += 1) {
    const hz = hzAt[i];
    if (!(hz > 0) || !(effectiveAmp[i] > 0)) continue;
    const clampedHz = Math.max(xMinHz, Math.min(xMaxHz, hz));
    const t = (Math.log(clampedHz) - logXMin) / logXSpan;
    const x = pad + Math.max(0, Math.min(1, t)) * span;
    const leftH = ampToHeight(leftAmp[i]);
    const rightH = ampToHeight(rightAmp[i]);
    if (!(leftH > 0.5) && !(rightH > 0.5)) continue;

    const phase01 = phaseAt[i];
    const col = typeof additiveGraphPhaseColor === "function"
      ? additiveGraphPhaseColor(phase01)
      : { r: 224, g: 64, b: 251 };
    const rgba = [col.r / 255, col.g / 255, col.b / 255, 1];
    // Butt ends like the 2D stroke: square-ended rect, not a capsule.
    if (leftH > 0.5) nodeGraphGlLinesRect(batch, x - lineW * 0.5, midY - leftH, lineW, leftH, rgba);
    if (rightH > 0.5) nodeGraphGlLinesRect(batch, x - lineW * 0.5, midY, lineW, rightH, rgba);
  }

  if (trackFilter) {
    const pts = [];
    const steps = Math.max(32, Math.min(160, Math.round(span / 3)));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const hz = Math.exp(logXMin + t * logXSpan);
      const g = Math.max(0, Math.min(1, filterGainAt(hz)));
      const y = midY - g * maxH;
      const x = pad + t * span;
      pts.push(x, y);
    }
    nodeGraphGlLinesPolyline(batch, pts, half(faceInkPx(1.5, faceMin)), 0.7, [1, 1, 1, 0.85]);
  }
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  section._forceDraw = false;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.harmonicLines = () => {};
}
