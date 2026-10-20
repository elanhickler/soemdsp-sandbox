// Image Ghost — dedicated residual (NOT phosphor Ghost/Trail).
//
// GL residual (image-burn-gl.js) only; GL failure = black + console.error.
//
// Module params: Size, Bright, Blacks, Feedback (−1…+1), Hang, Burn, Blur
// Display: image asset, background, Clear residual
//
// lit = peak(|In|) × Brightness (dry flash).
// Feedback 0 = max-blend lit into hang (no stack). >0 accumulate. <0 dimmer max-blend.

const nodeGraphImageBurnSettingsDefaults = Object.freeze({
  background: "#000000",
  backgroundBrightness: 0,
  backgroundColor: "#000000",
  dataUrl: "",
  fileName: "",
});

/** Soft UV/layout guard only — param metadata owns the dial range. */
const NODE_GRAPH_IMAGE_BURN_SIZE_SAFE_MAX = 64;
// Residual matches face pixels; only shrink uniformly on huge faces.
const NODE_GRAPH_IMAGE_BURN_RESIDUAL_MAX_SIDE = 4096;
const NODE_GRAPH_IMAGE_BURN_COMPRESS = 1.3;
/** Negative Feedback: stamp RGB scale at |feedback| = 1. */
const NODE_GRAPH_IMAGE_BURN_FEEDBACK_DIM_MIN = 0.35;

function normalizeNodeGraphImageBurnDataUrl(value) {
  if (typeof normalizeNodeGraphImageDataUrl === "function") {
    return normalizeNodeGraphImageDataUrl(value);
  }
  const raw = String(value || "").trim();
  return raw.startsWith("data:image/") ? raw : "";
}

function clampNodeGraphImageBurnSize(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fb = Number(fallback);
    return Math.max(0, Number.isFinite(fb) ? fb : 1);
  }
  return Math.max(0, Math.min(NODE_GRAPH_IMAGE_BURN_SIZE_SAFE_MAX, n));
}

function clampNodeGraphImageBurnUnit(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.min(1, nodeGraphFiniteNumber(fallback)));
  }
  return Math.max(0, Math.min(1, n));
}

/** Image blacks 0…2 (0 = unchanged, 2 = max black crush). */
function clampNodeGraphImageBurnContrast(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.min(2, nodeGraphFiniteNumber(fallback)));
  }
  return Math.max(0, Math.min(2, n));
}

function normalizeNodeGraphImageBurnSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const defaults = nodeGraphImageBurnSettingsDefaults;
  const background = typeof normalizeNodeGraphTraceDisplayColor === "function"
    ? normalizeNodeGraphTraceDisplayColor(
      source.background ?? source.backgroundColor,
      defaults.background,
    )
    : String(source.background || source.backgroundColor || defaults.background);
  // dataUrl only — do not treat legacy "image" gain as an asset URL.
  const dataUrl = normalizeNodeGraphImageBurnDataUrl(source.dataUrl || "");
  const fileName = String(source.fileName || source.name || "").trim().slice(0, 160);
  return {
    background,
    backgroundColor: background,
    backgroundBrightness: clampNodeGraphImageBurnUnit(
      source.backgroundBrightness,
      defaults.backgroundBrightness,
    ),
    dataUrl,
    fileName: dataUrl ? (fileName || "image") : "",
  };
}

function nodeGraphImageBurnSettingsForNode(node) {
  if (!node) {
    return normalizeNodeGraphImageBurnSettings();
  }
  const raw = {
    ...(node.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
      ? node.traceDisplaySettings
      : {}),
    ...(node.imageBurn && typeof node.imageBurn === "object" ? node.imageBurn : {}),
  };
  return normalizeNodeGraphImageBurnSettings(raw);
}

function nodeGraphImageBurnToPatch(settings) {
  const n = normalizeNodeGraphImageBurnSettings(settings);
  return {
    background: n.background,
    backgroundBrightness: n.backgroundBrightness,
    backgroundColor: n.backgroundColor,
    dataUrl: n.dataUrl || "",
    fileName: n.fileName || "",
  };
}

/** Bright knob plus normal parameter modulation, clamped to the knob range. */
function nodeGraphImageBurnEffectiveBrightness(nodeId) {
  const base = nodeGraphImageBurnReadParam(nodeId, "brightness", 1);
  const metadata = typeof nodeGraphReadPatchParameterMetadata === "function"
    ? (nodeGraphReadPatchParameterMetadata(nodeId, "brightness") || { min: 0, max: 1 })
    : { min: 0, max: 1 };
  const id = String(nodeId || "");
  const list = nodeGraphMvp?.patch?.modulations || [];
  let mod = 0;
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (String(entry?.destinationNode || "") !== id) {
      continue;
    }
    if (String(entry?.destinationParam || "") !== "brightness") {
      continue;
    }
    const sample = typeof nodeGraphModuleScopeLatestOutputValue === "function"
      ? Number(nodeGraphModuleScopeLatestOutputValue(entry.sourceNode, entry.sourcePort, 0))
      : 0;
    if (Number.isFinite(sample)) {
      mod += sample;
    }
  }
  const mixed = typeof nodeGraphApplyParameterModulation === "function"
    ? nodeGraphApplyParameterModulation(base, mod, metadata)
    : base + mod;
  const n = Number(mixed);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return n < 0 ? 0 : (n > 1 ? 1 : n);
}

function nodeGraphImageBurnReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

/** One-shot: seed module params from legacy display bag keys. */
function nodeGraphImageBurnMigrateParamsFromDisplay(node) {
  if (!node || node.type !== "imageBurn") {
    return;
  }
  if (!node.params || typeof node.params !== "object") {
    node.params = {};
  }
  // Patch normalize fills new param defaults before draw — stamp versions:
  // 1 = Size/Bright/Feedback/Burn/Blur from display; 2 = +Blacks/Hang.
  const mig = nodeGraphFiniteNumber(node.params._imageBurnParamMig);
  if (mig >= 2) {
    return;
  }
  const bag = {
    ...(node.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
      ? node.traceDisplaySettings
      : {}),
    ...(node.imageBurn && typeof node.imageBurn === "object" ? node.imageBurn : {}),
  };
  if (mig < 1) {
    const sizeRaw = Number(bag.imageSize);
    if (Number.isFinite(sizeRaw)) {
      node.params.size = sizeRaw;
    }
    const brightRaw = Number(bag.image ?? bag.dry ?? bag.imageBright);
    if (Number.isFinite(brightRaw)) {
      node.params.brightness = brightRaw;
    }
    const sendRaw = Number(bag.send ?? bag.ink ?? bag.dot1Brightness);
    if (Number.isFinite(sendRaw)) {
      // Legacy send was 0…1 unipolar → positive Feedback.
      node.params.feedback = Math.max(0, Math.min(1, sendRaw));
    }
    const burnRaw = Number(bag.burn ?? bag.ghost);
    if (Number.isFinite(burnRaw)) {
      node.params.burn = burnRaw;
    }
    const blurRaw = Number(bag.blur ?? bag.bleed);
    if (Number.isFinite(blurRaw)) {
      node.params.blur = blurRaw;
    }
  }
  // Blacks / Hang: from display bag, or prior defaults already on the bag.
  const blacksRaw = Number(bag.contrast ?? bag.split ?? bag.threshold ?? node.params.blacks);
  if (Number.isFinite(blacksRaw) && (bag.contrast != null || bag.split != null || bag.threshold != null)) {
    node.params.blacks = blacksRaw;
  }
  const hangRaw = Number(bag.hang ?? bag.trail ?? bag.persist);
  if (Number.isFinite(hangRaw)) {
    node.params.hang = hangRaw;
  }
  node.params._imageBurnParamMig = 2;
}

/**
 * Feedback → deposit gain + blend mode.
 * Hang always receives the lit image; Feedback only chooses how.
 *   0  = max-blend at full lit (grab pixels, no stack / no brighten)
 *  >0  = additive accumulate (brighter over time)
 *  <0  = max-blend a dimmer stamp (dimmer hang fill, still no stack)
 */
function nodeGraphImageBurnFeedbackDeposit(lit, feedback) {
  const fb = Number.isFinite(Number(feedback)) ? Number(feedback) : 0;
  const light = Math.max(0, nodeGraphFiniteNumber(lit));
  if (light <= 0) {
    return { deposit: 0, dim: 1, accumulate: false };
  }
  if (fb > 0) {
    return { deposit: light * Math.min(1, fb), dim: 1, accumulate: true };
  }
  if (fb < 0) {
    const mag = Math.min(1, Math.abs(fb));
    const dim = 1 - mag * (1 - NODE_GRAPH_IMAGE_BURN_FEEDBACK_DIM_MIN);
    return { deposit: light * dim, dim, accumulate: false };
  }
  // fb === 0: hang grabs full lit via max-blend — Feedback is not a gate.
  return { deposit: light, dim: 1, accumulate: false };
}

function nodeGraphImageBurnCanvasForSlot(slot) {
  const face = slot?.scopeElement;
  if (!face) {
    return null;
  }
  let canvas = face.querySelector?.(":scope > .node-image-burn-canvas")
    || face.querySelector?.(".node-image-burn-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-image-burn-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.append(canvas);
  }
  canvas.hidden = false;
  canvas.style.display = "";
  for (const overlay of face.querySelectorAll?.(
    ":scope > .node-module-scope-local-fallback-canvas",
  ) || []) {
    overlay.remove();
  }
  return canvas;
}

function syncNodeGraphImageBurnCanvas(canvas, face, pixelRatio) {
  if (!canvas || !face) {
    return false;
  }
  const dpr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, nodeGraphDisplayCanvasPixelRatio()));
  const faceMetrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(face, { observe: true })
    : null;
  const cssW = faceMetrics ? faceMetrics.cssW : Math.max(1, face.clientWidth || 1);
  const cssH = faceMetrics ? faceMetrics.cssH : Math.max(1, face.clientHeight || 1);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  nodeGraphDisplayCanvasSetBacking(canvas, w, h);
  if (face.style && (!face.style.position || face.style.position === "static")) {
    face.style.position = "relative";
  }
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  return w > 0 && h > 0;
}

function nodeGraphImageBurnEnsureImage(face, dataUrl, onReady) {
  const url = String(dataUrl || "").trim();
  if (!url) {
    if (face) face._imageBurnSeenReady = false;
    return null;
  }
  if (typeof nodeGraphImageElementForDataUrl === "function") {
    const shared = nodeGraphImageElementForDataUrl(url);
    if (shared) {
      if (!shared.complete || !(shared.naturalWidth > 0)) {
        const prevLoad = shared.onload;
        const prevErr = shared.onerror;
        shared.onload = (ev) => {
          try { prevLoad?.(ev); } catch (_e) { /* ignore */ }
          if (typeof onReady === "function") onReady();
        };
        shared.onerror = (ev) => {
          shared._imageBurnFailed = true;
          try { prevErr?.(ev); } catch (_e) { /* ignore */ }
          if (typeof onReady === "function") onReady();
        };
      } else if (typeof onReady === "function" && face && !face._imageBurnSeenReady) {
        queueMicrotask(() => onReady());
      }
      return shared;
    }
  }
  if (!face) return null;
  let img = face._imageBurnImage;
  if (!img) {
    img = new Image();
    face._imageBurnImage = img;
  }
  if (img._imageBurnUrl !== url) {
    img._imageBurnUrl = url;
    img._imageBurnFailed = false;
    img.onload = () => {
      img._imageBurnFailed = false;
      if (typeof onReady === "function") onReady();
    };
    img.onerror = () => {
      img._imageBurnFailed = true;
      if (typeof onReady === "function") onReady();
    };
    try { img.src = url; } catch (_e) { img._imageBurnFailed = true; }
  }
  return img;
}

function nodeGraphImageBurnClearResidual(face) {
  if (!face) return;
  if (typeof nodeGraphImageBurnGlClear === "function") {
    nodeGraphImageBurnGlClear(face);
  }
}

/** Try dedicated GL burn; returns true if presented. */
function nodeGraphImageBurnDrawGl(face, ctx, w, h, opts) {
  if (typeof nodeGraphImageBurnGlEnsure !== "function"
    || typeof nodeGraphImageBurnGlStep !== "function"
    || typeof nodeGraphImageBurnGlPresentTo !== "function") {
    return false;
  }
  const renderer = nodeGraphImageBurnGlEnsure(face, w, h);
  if (!renderer) {
    return false;
  }
  nodeGraphImageBurnGlStep(face, {
    hang: opts.hang,
    burn: opts.burn,
    contrast: opts.contrast,
    blur: opts.blur,
    deposit: opts.deposit,
    accumulate: opts.accumulate,
    image: opts.img,
    textureIn: opts.textureIn,
    imageSize: opts.imageSize,
    dataUrl: opts.dataUrl,
    nodeId: opts.nodeId,
    paused: opts.paused,
  });
  // Dry flash + contrast in present shader (no getImageData on hot path).
  const dryOpts = opts.drawDry
    ? {
      image: opts.img,
      texture: opts.textureIn?.texture || null,
      width: opts.textureIn?.width,
      height: opts.textureIn?.height,
      dataUrl: opts.dataUrl,
      imageSize: opts.imageSize,
      gain: opts.lit,
      contrast: opts.contrast,
    }
    : null;
  return nodeGraphImageBurnGlPresentTo(face, ctx, w, h, dryOpts);
}

function nodeGraphImageBurnScheduleRepaint(slotOrNodeId) {
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw();
  }
  if (typeof requestNodeGraphModuleScopeRepaint === "function" && slotOrNodeId) {
    requestNodeGraphModuleScopeRepaint(slotOrNodeId);
  }
}

function drawNodeGraphImageBurnFaceItem(renderer, item, pixelRatio) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) {
    return;
  }
  // The face clock is the stepper. Scope paints would advance Hang twice.
  if (face._imageBurnOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) {
    return;
  }
  const canvas = nodeGraphImageBurnCanvasForSlot(slot);
  if (!canvas || !syncNodeGraphImageBurnCanvas(canvas, face, pixelRatio)) {
    return;
  }
  const ctx = nodeGraphDisplayCanvasPresentContext(canvas);
  if (!ctx) {
    return;
  }

  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(slot.nodeId) : null);
  if (node) {
    nodeGraphImageBurnMigrateParamsFromDisplay(node);
  }
  const settings = nodeGraphImageBurnSettingsForNode(node);
  const nodeId = slot.nodeId;
  const size = clampNodeGraphImageBurnSize(
    nodeGraphImageBurnReadParam(nodeId, "size", 1),
    1,
  );

  const blacks = clampNodeGraphImageBurnContrast(
    nodeGraphImageBurnReadParam(nodeId, "blacks", 0),
    0,
  );
  const feedback = nodeGraphImageBurnReadParam(nodeId, "feedback", 0);
  const hang = Math.max(0, Math.min(1, nodeGraphImageBurnReadParam(nodeId, "hang", 0.55)));
  const burn = Math.max(0, nodeGraphImageBurnReadParam(nodeId, "burn", 0.75));
  const blur = Math.max(0, nodeGraphImageBurnReadParam(nodeId, "blur", 0.45));
  const contrast = blacks;
  const w = canvas.width;
  const h = canvas.height;

  const bgAmt = clampNodeGraphImageBurnUnit(settings.backgroundBrightness, 0);
  let bg = settings.background || "#000000";
  if (typeof nodeGraphHueBrightnessCss === "function") {
    const bgHue = typeof nodeGraphHueDegFromHex === "function"
      ? nodeGraphHueDegFromHex(settings.backgroundColor || settings.background)
      : 220;
    bg = nodeGraphHueBrightnessCss(bgHue, bgAmt);
  }
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(face, bg);
  }
  if (typeof nodeGraphFacePlateFillCanvas === "function") {
    nodeGraphFacePlateFillCanvas(ctx, canvas, bg);
  } else if (typeof nodeGraphGlLinesBegin === "function") {
    const plateBatch = nodeGraphGlLinesBegin(canvas, nodeGraphGlLinesCss(bg), { publishNodeId: "" });
    if (plateBatch) nodeGraphGlLinesEnd(plateBatch);
  }

  const img = nodeGraphImageBurnEnsureImage(
    face,
    settings.dataUrl,
    () => nodeGraphImageBurnScheduleRepaint(slot),
  );

  const imageFailed = Boolean(img?._imageBurnFailed);
  const imageReady = Boolean(
    settings.dataUrl
    && size > 0
    && img
    && !imageFailed
    && img.complete
    && img.naturalWidth > 0,
  );
  const imagePending = Boolean(
    settings.dataUrl
    && size > 0
    && img
    && !imageFailed
    && !imageReady,
  );

  const textureIn = (slot?.nodeId && typeof nodeGraphPictureRead === "function")
    ? nodeGraphPictureRead(slot.nodeId, "rgba")
    : null;

  if (!settings.dataUrl && !textureIn?.texture) {
    face._imageBurnSeenReady = false;
    face._imageBurnEnergyAbs = 0;
    nodeGraphImageBurnClearResidual(face);
  }

  if (imageReady || textureIn?.texture) {
    face._imageBurnSeenReady = true;
  }
  const lit = nodeGraphImageBurnEffectiveBrightness(slot?.nodeId);
  const fbInfo = nodeGraphImageBurnFeedbackDeposit(lit, feedback);
  const deposit = fbInfo.deposit;
  const accumulate = Boolean(fbInfo.accumulate);

  // Transport pause only. A quiet patch must still fade Hang / Burn / Blur.
  const speed = Number(nodeGraphMvp?.live?.speedMultiplier);
  const paused = (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused())
    || (Number.isFinite(speed) && speed <= 0);

  // Residual + dry flash both in the GL present (Brightness never hides burn).
  const stampReady = imageReady || Boolean(textureIn?.texture);
  // Always draw dry for current In energy so the face tracks the wire / Output
  // in time. Hang residual is the trailing ghost underneath (Feedback path).
  const drawDry = imageReady && lit > 1e-4;

  const usedGl = nodeGraphImageBurnDrawGl(face, ctx, w, h, {
    hang,
    burn,
    contrast,
    blur,
    deposit: stampReady ? deposit : 0,
    accumulate,
    lit: imageReady ? lit : 0,
    img: textureIn?.texture ? null : (imageReady ? img : null),
    textureIn: textureIn?.texture ? textureIn : null,
    imageSize: size,
    dataUrl: settings.dataUrl,
    nodeId: slot.nodeId,
    paused,
    drawDry,
  });

  // GL only: a failed GL frame is black + logged (no Canvas2D residual).
  if (!usedGl) {
    nodeGraphDisplayGlFailed(canvas, "Image Ghost GL unavailable");
  }

  // Status label: GL text over the frame (transparent clear, source-over copy).
  const label = !usedGl ? null : !settings.dataUrl
    ? { text: "Load image", rgba: [127 / 255, 199 / 255, 217 / 255, 0.4], k: 0.05 }
    : (imageFailed
      ? { text: "Load failed", rgba: [220 / 255, 120 / 255, 120 / 255, 0.5], k: 0.045 }
      : (imagePending ? { text: "…", rgba: [127 / 255, 199 / 255, 217 / 255, 0.35], k: 0.045 } : null));
  if (label && typeof nodeGraphGlLinesBegin === "function") {
    const tb = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { publishNodeId: "" });
    if (tb) {
      // Pre-blend the translucent label over the plate (opaque ink, AA only):
      // same look as the old 2D fillText on the plate, no alpha-on-alpha copy.
      const plateRgb = nodeGraphGlLinesCss(bg);
      const a = label.rgba[3];
      const ink = [0, 1, 2].map((i) => plateRgb[i] * (1 - a) + label.rgba[i] * a).concat(1);
      nodeGraphGlLinesText(tb, label.text, w * 0.5, h * 0.5, {
        px: Math.max(10, Math.round(Math.min(w, h) * label.k)),
        rgba: ink,
        align: "center",
        baseline: "middle",
        family: "Consolas, monospace",
        weight: 400,
      });
      nodeGraphGlLinesEnd(tb);
    }
  }

  if (face.dataset) {
    face.dataset.lightStrength = (lit > 0.02 || imageReady) ? "1" : "0.15";
    face.classList.toggle("has-image", imageReady);
  }
}

function commitNodeGraphImageBurn(nodeId, nextSettings, options = {}) {
  const id = String(nodeId || "").trim();
  const patch = typeof cloneNodeGraphPatch === "function"
    ? cloneNodeGraphPatch(nodeGraphMvp.patch)
    : null;
  const node = patch?.nodes?.find((n) => n.id === id);
  if (!node || node.type !== "imageBurn") {
    return false;
  }
  const normalized = normalizeNodeGraphImageBurnSettings(nextSettings);
  const bag = nodeGraphImageBurnToPatch(normalized);
  node.imageBurn = bag;
  node.traceDisplaySettings = {
    ...(node.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
      ? node.traceDisplaySettings
      : {}),
    ...bag,
  };
  if (typeof commitNodeGraphPatch === "function") {
    commitNodeGraphPatch(patch, {
      record: options.record !== false,
      status: options.status || (normalized.dataUrl ? "image ghost loaded" : "image ghost cleared"),
    });
  }
  nodeGraphImageBurnScheduleRepaint(id);
  const slot = typeof nodeGraphModuleScopeState !== "undefined"
    ? nodeGraphModuleScopeState?.slots?.get?.(id)
    : null;
  const face = slot?.scopeElement
    || (typeof nodeGraphNodeElement === "function"
      ? nodeGraphNodeElement(id)?.querySelector?.(".node-image-burn-face")
      : null);
  if (face && typeof drawNodeGraphImageBurnFaceItem === "function") {
    drawNodeGraphImageBurnFaceItem(null, {
      buffer: null,
      screenElement: face,
      slot: slot || { nodeId: id, scopeElement: face, type: "imageBurn" },
    }, nodeGraphDisplayCanvasPixelRatio());
  }
  return true;
}

function clearNodeGraphImageBurnImage(nodeId) {
  const id = String(nodeId || "").trim()
    || (typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
      ? nodeGraphTraceDisplaySettingsTargetNodeId()
      : "");
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  if (!patchNode || patchNode.type !== "imageBurn") {
    return;
  }
  const prev = nodeGraphImageBurnSettingsForNode(patchNode);
  commitNodeGraphImageBurn(id, {
    ...prev,
    dataUrl: "",
    fileName: "",
  }, { status: "image ghost cleared" });
  if (typeof syncNodeGraphImageBurnDisplaySettingsControls === "function") {
    syncNodeGraphImageBurnDisplaySettingsControls();
  }
}

function pickNodeGraphImageBurnImage() {
  if (typeof nodeGraphPickImageFile !== "function") {
    return;
  }
  const nodeId = typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
    ? nodeGraphTraceDisplaySettingsTargetNodeId()
    : "";
  nodeGraphPickImageFile((asset) => {
    const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    if (!patchNode || patchNode.type !== "imageBurn") {
      return;
    }
    const prev = nodeGraphImageBurnSettingsForNode(patchNode);
    commitNodeGraphImageBurn(nodeId, {
      ...prev,
      dataUrl: asset.dataUrl,
      fileName: asset.fileName || "image",
    }, { status: `${asset.fileName || "image"} loaded` });
    if (typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp(`Image Ghost: loaded ${asset.fileName || "image"}.`);
    }
    if (typeof syncNodeGraphImageBurnDisplaySettingsControls === "function") {
      syncNodeGraphImageBurnDisplaySettingsControls();
    }
  });
}

function buildNodeGraphImageBurnDisplaySettingsBodyHtml() {
  const hueRow = typeof nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml === "function"
    ? nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml
    : null;
  return `
    <div class="node-image-burn-display-settings-panel" data-image-burn-display-settings-panel>
      <div class="metadata-field-section">
        <div class="metadata-section-title">IMAGE</div>
        ${(typeof nodeGraphBuildImageAssetRowHtml === "function"
          ? nodeGraphBuildImageAssetRowHtml({ key: "burn", label: "Image" })
          : "")}
      </div>
      <div class="metadata-field-section">
        <div class="metadata-section-title">PLATE</div>
        <div class="metadata-field-section node-trace-display-xy-pad-actions">
          <button type="button" data-image-burn-clear-residual class="node-xy-pad-reset-canvas-button">
            Clear
          </button>
        </div>
        ${hueRow && typeof nodeGraphDisplaySettingsHbsRow === "function"
          ? nodeGraphDisplaySettingsHbsRow([hueRow({
            title: "Background",
            stepField: "backgroundBrightness",
            colorField: "backgroundColor",
            formType: "imageBurnFace",
            defaultHueHex: "#000000",
            titleAttr: "Plate brightness 0…1.",
          })])
          : (hueRow
            ? hueRow({
              title: "Background",
              stepField: "backgroundBrightness",
              colorField: "backgroundColor",
              formType: "imageBurnFace",
              defaultHueHex: "#000000",
              titleAttr: "Plate brightness 0…1.",
            })
            : "")}
      </div>
    </div>
  `;
}

function bindNodeGraphImageBurnDisplaySettingsEvents(root) {
  const panel = root?.querySelector?.("[data-image-burn-display-settings-panel]") || root;
  if (!panel || panel.dataset.imageBurnBound === "true") {
    return;
  }
  panel.dataset.imageBurnBound = "true";
  if (typeof nodeGraphBindImageAssetClicks === "function") {
    nodeGraphBindImageAssetClicks(panel, (_key, action) => {
      if (action === "load") {
        pickNodeGraphImageBurnImage();
      } else if (action === "clear") {
        clearNodeGraphImageBurnImage();
      } else if (action === "save") {
        const nodeId = typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
          ? nodeGraphTraceDisplaySettingsTargetNodeId()
          : "";
        const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
        const settings = nodeGraphImageBurnSettingsForNode(node);
        if (typeof nodeGraphSaveImageAsset === "function") {
          nodeGraphSaveImageAsset(settings, "image-burn");
        }
      }
    });
  }
  panel.addEventListener("click", (event) => {
    const btn = event.target?.closest?.("[data-image-burn-clear-residual]");
    if (!btn || !panel.contains(btn)) {
      return;
    }
    event.preventDefault();
    const nodeId = typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
      ? nodeGraphTraceDisplaySettingsTargetNodeId()
      : "";
    const slot = typeof nodeGraphModuleScopeState !== "undefined"
      ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
      : null;
    const face = slot?.scopeElement
      || document.querySelector?.(`.node-image-burn-face[data-node="${CSS.escape(String(nodeId))}"]`);
    nodeGraphImageBurnClearResidual(face);
    nodeGraphImageBurnScheduleRepaint(slot || nodeId);
  });
}

function syncNodeGraphImageBurnDisplaySettingsControls(root) {
  const panel = root?.querySelector?.("[data-image-burn-display-settings-panel]")
    || document.querySelector("#nodeTraceDisplaySettingsPopover [data-image-burn-display-settings-panel]");
  if (!panel) {
    return;
  }
  const nodeId = typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
    ? nodeGraphTraceDisplaySettingsTargetNodeId()
    : "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const settings = nodeGraphImageBurnSettingsForNode(node);
  if (typeof nodeGraphSyncImageAssetRow === "function") {
    nodeGraphSyncImageAssetRow(panel, "burn", settings, "no image");
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.imageBurnFace = drawNodeGraphImageBurnFaceItem;
}
