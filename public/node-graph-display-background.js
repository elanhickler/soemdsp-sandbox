// Display background registry (docs/DISPLAY_BACKGROUND_PLAN.md, DB-2).
//
// SSOT for the color of every display's screen square. Every display key
// registers exactly one of:
//   { color }      fixed CSS color or [r,g,b,a] 0..1
//   { resolve }    (patchNode) -> CSS color, from that type's current
//                  Display Settings keys (one resolver, no fallback readers)
//   { transparent} see-through by design (explicit first-class value, D3)
// The GL body pass paints the square from saved geometry whenever the module
// is not culled (TV screen, D2): on, off, paused, asleep face, mid-pan. Never
// dimmed by engine state (D4). Hidden displays / 0 GU have no geometry rect.
//
// Display key: the module's display renderer; layout-owned faces use
// `layoutOwned:<face canvas class>` (or `layoutOwned:none` without a canvas).

const NODE_GRAPH_DISPLAY_BACKGROUND_TRANSPARENT = Object.freeze({ kind: "transparent" });
const nodeGraphDisplayBackgroundRegistry = new Map();
const nodeGraphDisplayBackgroundCache = new WeakMap(); // patch node -> Map(key -> result)
const nodeGraphDisplayBackgroundWarned = new Set();

function nodeGraphDisplayBackgroundRegister(key, spec) {
  const k = String(key || "").trim();
  if (!k || !spec || typeof spec !== "object") {
    throw new Error(`display background: bad registration for "${k}"`);
  }
  const kinds = ["color", "resolve", "transparent"].filter((p) => spec[p] !== undefined && spec[p] !== false);
  if (kinds.length !== 1) {
    throw new Error(`display background "${k}": register exactly one of color / resolve / transparent`);
  }
  nodeGraphDisplayBackgroundRegistry.set(k, Object.freeze({ ...spec }));
}

function nodeGraphDisplayBackgroundRegisteredKeys() {
  return [...nodeGraphDisplayBackgroundRegistry.keys()];
}

function nodeGraphDisplayBackgroundIsRegistered(key) {
  return nodeGraphDisplayBackgroundRegistry.has(String(key || ""));
}

/** Display key for one face element of a module. */
function nodeGraphDisplayBackgroundKeyForFace(patchNode, faceEl) {
  const renderer = typeof nodeGraphModuleDisplayRendererForNode === "function"
    ? String(nodeGraphModuleDisplayRendererForNode(patchNode) || "")
    : "";
  if (renderer && renderer !== "layoutOwned") return renderer;
  const canvas = faceEl?.querySelector?.("canvas");
  const cls = canvas ? String(canvas.classList?.[0] || "") : "";
  return cls ? `layoutOwned:${cls}` : "layoutOwned:none";
}

function nodeGraphDisplayBackgroundCssToRgba(css) {
  if (Array.isArray(css)) return css.slice(0, 4).map((c, i) => (i < 3 ? Number(c) : Number(c ?? 1)));
  if (typeof nodeGraphGlLinesCss === "function") return nodeGraphGlLinesCss(String(css || ""));
  return null;
}

/**
 * Background for one display: { kind: "color", rgba } | TRANSPARENT |
 * { kind: "unregistered" } (logged once; nothing is painted — no silent default).
 */
function nodeGraphDisplayBackgroundFor(patchNode, key) {
  const k = String(key || "");
  let perNode = patchNode && typeof patchNode === "object" ? nodeGraphDisplayBackgroundCache.get(patchNode) : null;
  if (perNode?.has(k)) return perNode.get(k);
  const spec = nodeGraphDisplayBackgroundRegistry.get(k);
  let result;
  if (!spec) {
    if (!nodeGraphDisplayBackgroundWarned.has(k)) {
      nodeGraphDisplayBackgroundWarned.add(k);
      console.error(`display background: "${k}" is not registered (docs/DISPLAY_BACKGROUND_PLAN.md)`);
    }
    result = { kind: "unregistered" };
  } else if (spec.transparent) {
    result = NODE_GRAPH_DISPLAY_BACKGROUND_TRANSPARENT;
  } else {
    let css = spec.color;
    if (spec.resolve) {
      try {
        css = spec.resolve(patchNode);
      } catch (error) {
        console.error(`display background "${k}" resolve failed`, error);
        css = null;
      }
    }
    const rgba = css == null ? null : nodeGraphDisplayBackgroundCssToRgba(css);
    result = rgba ? Object.freeze({ kind: "color", rgba: Object.freeze(rgba) }) : { kind: "unregistered" };
  }
  if (patchNode && typeof patchNode === "object") {
    if (!perNode) {
      perNode = new Map();
      nodeGraphDisplayBackgroundCache.set(patchNode, perNode);
    }
    perNode.set(k, result);
  }
  return result;
}

/** Settings-backed resolver: that type's settings getter + the one plate resolver. */
function nodeGraphDisplayBackgroundFromSettings(getterName, fallbackHex) {
  return (node) => {
    const getter = globalThis[getterName];
    if (typeof getter !== "function") {
      throw new Error(`display background: ${getterName} not loaded`);
    }
    return nodeGraphFacePlateBackground(getter(node) || {}, fallbackHex);
  };
}

(function nodeGraphDisplayBackgroundRegisterBuiltins() {
  const R = nodeGraphDisplayBackgroundRegister;
  const S = nodeGraphDisplayBackgroundFromSettings;
  const T = (reason) => ({ transparent: true, reason });
  // Scope / trace family (Display Settings background is user-editable).
  const waterfall = { resolve: (n) => nodeGraphWaterfallPlateCss(nodeGraphTraceDisplaySettingsForNode(n), "#000000") };
  R("waterfall", waterfall);
  R("waterfallRgb", waterfall);
  R("waterfallXyz", waterfall);
  R("value", { resolve: S("nodeGraphTraceDisplaySettingsForNode", "#000004") });
  R("lineBurn", { resolve: S("nodeGraphLineBurnSettingsForNode", "#000000") });
  R("dot", { resolve: S("nodeGraphZeroDBurnSettingsForNode", "#000000") });
  R("vectorDot", { resolve: S("nodeGraphVectorDotSettingsForNode", "#000000") });
  R("lcdDot", { resolve: S("nodeGraphVectorDotSettingsForNode", "#000000") });
  // Same rule as the readout face: LCD style uses the LCD plate.
  R("numberReadout", {
    resolve: (n) => {
      const s = nodeGraphNumberReadoutSettingsForNode(n);
      return nodeGraphNumberReadoutFaceStyleForNode(n) === "lcd"
        ? nodeGraphNumberReadoutLcdBgCss(s)
        : nodeGraphFacePlateBackground(s);
    },
  });
  R("scope2d", { resolve: S("nodeGraphScope2dSettingsForNode", "#000000") });
  R("scope2dTrace", { resolve: S("nodeGraphScope2dTraceSettingsForNode", "#000000") });
  // Same rule as the 1D trace face: the lowest gradient stop is the plate.
  R("scope1dTrace", {
    resolve: (n) => {
      const s = nodeGraphScope1dTraceSettingsForNode(n) || {};
      const floor = Array.isArray(s.gradientStops) && s.gradientStops.length ? s.gradientStops[0]?.color : "";
      return floor || nodeGraphFacePlateBackground(s, nodeGraphScope1dTraceSettingsDefaults.background);
    },
  });
  R("hypersawBurn", { resolve: S("nodeGraphHypersawBurnSettingsForNode", "#000000") });
  R("spectrumLine", { resolve: S("nodeGraphSpectrumLineSettingsForNode", "#000000") });
  R("spectrogramBurn", { resolve: S("spectrogramSettingsForNode", "#000000") });
  R("xyPad", { resolve: S("nodeGraphXyPadDisplaySettingsForNode", "#000000") });
  R("sampleWaveform", { resolve: (n) => nodeGraphSampleWaveformBackgroundColor(nodeGraphSampleWaveformSettingsForNode(n?.id)) });
  // Controller / module faces with a settings bag.
  R("knobFace", { resolve: S("nodeGraphControllerFaceSettingsForNode", "#000000") });
  R("momentaryButtonFace", { resolve: S("nodeGraphControllerFaceSettingsForNode", "#000000") });
  R("toggleButtonFace", { resolve: S("nodeGraphControllerFaceSettingsForNode", "#000000") });
  R("pluginSliderFace", { resolve: S("nodeGraphControllerFaceSettingsForNode", "#000000") });
  R("gradientVectorscopeFace", { resolve: S("nodeGraphGradientVectorscopeSettingsForNode", "#000000") });
  R("evolveFieldFace", { resolve: S("nodeGraphEvolveFieldSettingsForNode", "#0a0a10") });
  R("sinCosFace", { resolve: S("nodeGraphSinCosFaceSettingsForNode", "#020609") });
  R("rgbPictureFace", { resolve: S("nodeGraphRgbPictureSettingsForNode", "#000000") });
  R("rgbShapeFace", { resolve: S("nodeGraphRgbShapeSettingsForNode", "#000000") });
  R("vectorRgbFace", { resolve: S("nodeGraphVectorRgbSettingsForNode", "#000000") });
  R("rgbFractalFace", { resolve: S("nodeGraphRgbFractalSettingsForNode", "#000000") });
  R("imageBurnFace", { resolve: S("nodeGraphImageBurnSettingsForNode", "#000000") });
  R("videoscopeBurn", { resolve: S("nodeGraphTraceDisplaySettingsForNode", "#000004") });
  R("softpopFace", {
    resolve: (n) => {
      const s = nodeGraphSoftpopFaceSettingsForNode(n) || {};
      const plate = Math.max(0, Math.min(1, Number(s.backgroundBrightness) || 0));
      const lut = nodeGraphSoftpopFaceLut(s);
      return nodeGraphSoftpopFaceRgb01(lut, nodeGraphSoftpopFaceLutIndex(0, plate));
    },
  });
  // Fixed plates (the face's own clear color; no background setting, D1).
  R("rasterRgbFace", { color: "#000000" });
  R("aberrationFace", { color: "#000000" });
  R("fbmFieldFace", { color: "#000000" });
  R("placeFace", { color: "#000000" });
  R("screenBendFace", { color: "#000000" });
  R("videoDelayFace", { color: "#000000" });
  R("videoFeedbackFace", { color: "#000000" });
  R("ensembleCloud", { color: "#000000" });
  R("arpKeysFace", { color: "#000000" });
  R("tSeriesFace", { color: "#000000" });
  R("torchFace", { color: "#000000" });
  R("speedColorInertiaFace", { color: "#000000" });
  R("transportBpm", { color: "#020a06" });
  R("harmonicSeriesFace", { color: "#000004" });
  R("phoneToneFace", { color: "#000004" });
  R("sinCos4Face", { color: "#05060a" });
  R("slewShapeFace", { color: [2 / 255, 6 / 255, 9 / 255, 1] });
  R("basicShapeFace", { color: "#020609" });
  R("matrixDisplayFace", { color: "#000000" });
  R("matrixWaterfallFace", { color: "#000000" });
  R("selfPaintFace", { color: "#000000" });
  R("layoutOwned:node-filter-curve-canvas", { color: [2 / 255, 6 / 255, 9 / 255, 0.88] });
  R("layoutOwned:node-wall-room-canvas", { color: [2 / 255, 6 / 255, 9 / 255, 0.88] });
  R("layoutOwned:node-additive-filter-curve-canvas", { color: [10 / 255, 10 / 255, 18 / 255, 1] });
  R("layoutOwned:node-harmonic-count-canvas", { color: [10 / 255, 10 / 255, 18 / 255, 1] });
  R("layoutOwned:node-additive-blaster-canvas", { color: [10 / 255, 10 / 255, 18 / 255, 1] });
  R("layoutOwned:node-harmonic-lines-canvas", { color: [5 / 255, 5 / 255, 8 / 255, 1] });
  R("layoutOwned:node-additive-bubble-canvas", { color: [5 / 255, 5 / 255, 8 / 255, 1] });
  R("layoutOwned:node-additive-waveform-canvas", { color: [5 / 255, 5 / 255, 8 / 255, 1] });
  R("layoutOwned:node-sequencer-roll", { color: "#1a1a20" });
  // See-through by design (D3): explicit transparent.
  R("roundShapeFace", T("shape draws over the module plate"));
  R("keypadFace", T("user background image / keys over the plate"));
  R("keyboardControllerFace", T("keys are GL chrome, no screen"));
  R("textBoxFace", T("Text Box is HTML, not a display (APP_POLICY)"));
  R("graphFace", T("graph is GL chrome, no screen canvas"));
  R("patchFace", T("patch control face, no screen canvas"));
  R("layoutOwned:none", T("layout-owned control face without a screen canvas"));
})();
