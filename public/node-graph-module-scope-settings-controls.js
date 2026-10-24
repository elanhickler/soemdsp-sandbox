// Display Settings control mapping + value clamps.
// Extracted from node-graph-module-scope-settings-ui.js (graphify community peel).
// Load after scope-settings-form.js, before scope-settings-ui.js.

/**
 * App-wide −/+ magnitude quantum from current value + step direction.
 *
 * Base (by |value|):
 *   <1 → 0.1 · 1…<10 → 1 · 10…<100 → 10 · 100…<1000 → 100 · ≥1000 → 1000
 *
 * When stepping DOWN from an exact decade boundary, use the next finer step
 * so 1→0.9 (not 1→0), 10→9, 100→90, 1000→900.
 *
 * @param {number} currentValue
 * @param {number} [direction]  -1 = minus, +1 = plus, 0 = base only
 */
function nodeGraphMagnitudeStepperQuantum(currentValue, direction = 0) {
  const abs = Math.abs(Number(currentValue));
  let q;
  if (!Number.isFinite(abs) || abs < 1 - 1e-12) {
    q = 0.1;
  } else if (abs < 10) {
    q = 1;
  } else if (abs < 100) {
    q = 10;
  } else if (abs < 1000) {
    q = 100;
  } else {
    q = 1000;
  }
  // At exactly 1 / 10 / 100 / 1000, base quantum equals |value|, so − would
  // jump a full decade (1→0). Use one decade finer when decreasing.
  if (direction < 0 && Number.isFinite(abs) && abs > 0) {
    const atDecade = Math.abs(abs - q) <= Math.max(1e-9, q * 1e-9);
    if (atDecade) {
      if (q <= 0.1) {
        q = 0.1;
      } else if (q === 1) {
        q = 0.1;
      } else if (q === 10) {
        q = 1;
      } else if (q === 100) {
        q = 10;
      } else {
        q = 100;
      }
    }
  }
  return q;
}

function nodeGraphTraceDisplaySizeControlField(key) {
  // imageSize: Image Burn zoom (domain 0…4) — same exp feel as stamp Size.
  return ["dot1Size", "secondarySize", "capSize", "imageSize"].includes(key);
}

/** Instant Waterfall Blur (not phosphor stamp blur). */
function nodeGraphWaterfallBlurField(key, formType = null) {
  if (key !== "lineThickness" && key !== "secondaryLineThickness") {
    return false;
  }
  const type = formType ?? (typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "");
  return typeof nodeGraphDisplaySettingsIsVectorTraceFormType === "function"
    && nodeGraphDisplaySettingsIsVectorTraceFormType(type);
}

/** Image Burn Blur — exp control-space (fine near 0 for anti-pixelation). */
function nodeGraphTraceDisplayImageBurnBlurField(key, formType = null) {
  if (key !== "blur") {
    return false;
  }
  const type = formType ?? (typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "");
  return type === "imageBurnFace";
}

/**
 * 0…1 unit sliders (Bright, Ghost Bright, Residual, …).
 * Linear drag — same pixel→value gain for all (no exp curve mismatch).
 */
function nodeGraphPluginButtonInkPxField(key, formType = null) {
  if (key !== "fontSize" && key !== "labelSize") {
    return false;
  }
  const type = formType ?? (typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "");
  return type === "toggleButtonFace" || type === "momentaryButtonFace";
}

function nodeGraphTraceDisplayUnitDragField(key, formType = null) {
  // Image Burn Blur uses exp control-space (not linear unit drag).
  if (nodeGraphTraceDisplayImageBurnBlurField(key, formType)) {
    return false;
  }
  if (nodeGraphPluginButtonInkPxField(key, formType)) {
    return false;
  }
  if (String(key).endsWith("Saturation")) {
    return true;
  }
  return [
    "dot1Brightness",
    "secondaryBrightness",
    "brightness",
    "ghostBrightness",
    "residual",
    "ghost",
    "ghostBlend",
    "trail",
    "burnAmount",
    "unlitSegments",
    "centsBand",
    "facePadding",
    "edgeSpacing",
    "cornerRadius",
    "innerShadowDistance",
    "innerShadowSharpness",
    "innerShadowOffsetX",
    "innerShadowOffsetY",
    "dialSize",
    "dialOffsetY",
    "labelSize",
    "valueSize",
    "valueOffsetY",
    "innerRadius",
    "sliderLength",
    "sliderHeight",
    "sliderLabelPadding",
    "sliderLabelScale",
    "sliderNumberPadding",
    "sliderNumberScale",
    "sliderUnitPadding",
    "sliderUnitScale",
    "sliderRounding",
    "strokeScale",
    "buttonPadLeft",
    "buttonPadRight",
    "buttonPadTop",
    "buttonPadBottom",
    "labelPadding",
    "barThickness",
    "curveThickness",
    "buttonWidth",
    "buttonHeight",
    "textSize",
    // Value Line: must be unit-drag (not magnitude quantum×/8 — that felt ~3× too hot).
    "lineLength",
    "capLength",
    "capPadding",
    "capSize",
    "lineBrightness",
    "dotBrightness",
    "backgroundBrightness",
    "backgroundSaturation",
    "dot1Saturation",
    "textBrightness",
    "buttonBrightness",
    "buttonStrokeBrightness",
    "hoverBrightness",
    "onBrightness",
    "stampDensity",
    "pixelDensity",
    // Image Burn residual (standalone -- not phosphor Ghost/Trail).
    "image",
    "send",
    "ink",
    "hang",
    "blur",
    "burn",
    "contrast",
  ].includes(key) || /Brightness$/i.test(String(key || ""));
}

/** Drag/clamp range for unit-style fields (most are 0…1; shadow offset bipolar). */
function nodeGraphTraceDisplayUnitDragRange(key) {
  if (key === "innerShadowOffsetX" || key === "innerShadowOffsetY" || key === "dialOffsetY" || key === "valueOffsetY") {
    return { min: -1, max: 1 };
  }
  // Image Burn Contrast: 0 = unchanged, 2 = max black crush (only this form uses it).
  if (key === "contrast") {
    return { min: 0, max: 2 };
  }
  // Value LED/LCD padding: negative grows digits toward plate walls.
  if (key === "facePadding") {
    return { min: -0.5, max: 1 };
  }
  if (key === "burnAmount") {
    const formType = typeof nodeGraphTraceDisplaySettingsFormType === "function"
      ? nodeGraphTraceDisplaySettingsFormType()
      : "";
    if (formType === "numberReadout") {
      return { min: 0, max: 1 };
    }
    const max = (typeof PhosphorResidual !== "undefined" && PhosphorResidual.BURN_AMOUNT_MAX) || 4;
    return { min: 0, max };
  }
  if (key === "buttonWidth" || key === "buttonHeight" || key === "textSize") {
    return { min: 0, max: 1 };
  }
  // SinCos4 sizes: ray / ring width in % of the face square, hub x tip radius.
  if (key === "sinCos4RayThickness" || key === "sinCos4RingThickness") {
    return { min: 0, max: 100 };
  }
  if (key === "sinCos4OuterDotSize" || key === "sinCos4HubDotSize") {
    return { min: 0, max: 20 };
  }
  return { min: 0, max: 1 };
}

function nodeGraphTraceDisplayClampBipolarUnit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? clampNodeSliderValue(n, -1, 1) : 0;
}

/** Exp curve for stamp size — higher = more of the travel near small sizes. */
const nodeGraphTraceDisplaySensitiveControlExponent = 3;
/** History fallback when the field has no parameter skew. Higher = more travel near 0. */
const nodeGraphTraceDisplayHistoryControlExponent = 3.5;

/**
 * History control-space exponent.
 * Field meta sliderCurve/curveAmount uses the parameter skew law (same as
 * long-range knobs). Still the existing t^exp seconds map — not a second mapper.
 * Exponent > 1 keeps 0 at pause and slows the approach to max.
 */
function nodeGraphTraceDisplayHistoryCurveExponent(key) {
  const meta = (typeof nodeGraphDisplaySettingsFieldMeta !== "undefined" && nodeGraphDisplaySettingsFieldMeta)
    ? nodeGraphDisplaySettingsFieldMeta[key]
    : null;
  const curve = String(meta?.sliderCurve || "").trim().toLowerCase();
  // custom skew: curveAmount -1..+1 -> power via the shared sensitivity law.
  // -1 = exponent 4 (fine near 0, slow at max). Do not use the skew-from-mid
  // fallback: History has no mid, and that path returns exponent 1 (linear).
  if (curve === "custom" || curve === "sens" || curve === "sensitivity") {
    const amount = typeof normalizeNodeSliderCurveAmount === "function"
      ? normalizeNodeSliderCurveAmount(meta.curveAmount)
      : Math.max(-1, Math.min(1, Number(meta.curveAmount) || 0));
    if (typeof nodeSliderSkewExponentFromSensitivity === "function") {
      const exp = Number(nodeSliderSkewExponentFromSensitivity(amount));
      if (Number.isFinite(exp) && exp > 0) {
        return exp;
      }
    }
  }
  if (meta && (meta.sliderCurve || meta.nonlinearSlider === true)
    && typeof nodeGraphParamSkewExponent === "function") {
    const exp = Number(nodeGraphParamSkewExponent(meta));
    if (Number.isFinite(exp) && exp > 1) {
      return exp;
    }
  }
  return nodeGraphTraceDisplayHistoryControlExponent;
}


function nodeGraphTraceDisplaySensitiveControlMax(key) {
  if (key === "pixelDensity") {
    return 1;
  }
  // Image Burn zoom: 0 = off, 1 = fit face, up to 4 = zoom past face.
  if (key === "imageSize") {
    return 4;
  }
  // Stroke size is authored ink px (0…32 at a 96px face), not a 0…1 fraction.
  if (key === "dot1Size" || key === "secondarySize") {
    return 32;
  }
  // Bright is 0…1 energy app-wide (1 = full tip / full deposit).
  return 1;
}

/** Seconds range for History (s) by form type. */
function nodeGraphTraceDisplayHistoryControlRange(key, type = null) {
  const formType = type ?? (typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "");
  // Waterfall Detail shares History's control-space skew (field meta), not a private mapper.
  if (key === "detail") {
    const lo = typeof NODE_GRAPH_WATERFALL_DETAIL_MIN === "number" ? NODE_GRAPH_WATERFALL_DETAIL_MIN : 0;
    const hi = typeof NODE_GRAPH_WATERFALL_DETAIL_MAX === "number" ? NODE_GRAPH_WATERFALL_DETAIL_MAX : 1;
    return { min: lo, max: hi };
  }
  // Hz dials: Hz domain (0 allowed = freeze). Never reuse the seconds 0…10 range.
  if (key === "historyHz" || key === "sweepHz") {
    return { min: 0, max: 100 };
  }
  // Cycles dials.
  if (key === "historyCycles" || key === "sweepCycles") {
    return { min: 0.05, max: 100 };
  }
  if (key === "historySeconds" && formType === "spectrogramBurn") {
    return { min: 0.1, max: 30 };
  }
  if (
    key === "historySeconds"
    && (formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz")
  ) {
    const maxW = Number(typeof nodeGraphWaterfallMaxHistorySeconds !== "undefined"
      ? nodeGraphWaterfallMaxHistorySeconds
      : 3600);
    return { min: 0, max: Number.isFinite(maxW) ? maxW : 3600 };
  }
  const maxZ = Number(typeof nodeGraphTraceDisplayMaxZoomSeconds !== "undefined"
    ? nodeGraphTraceDisplayMaxZoomSeconds
    : 10);
  return { min: 0, max: Number.isFinite(maxZ) ? maxZ : 10 };
}

// ---------------------------------------------------------------------------
// Display Settings number field spec (single source for range / taper / step).
//
//   min, max   control range ends (drag/stepper travel; typed values still use
//              the key's clamp in normalizeNodeGraphTraceDisplaySettingValueForKey)
//   taper      "linear" | "log" | "power" (with exponent)
//   logMin     log taper only: value at the bottom of the log span when min is a
//              detent below it (Hz fields: 0 = pause, then 0.01…100)
//   zeroDetent log taper only: control fraction at the bottom that stays at min
//   step       −/+ step: control units for log/power, value units for linear
//   integer    round after mapping (steps stay whole)
//   wrap       control wraps 1→0 (hue)
// ---------------------------------------------------------------------------

/** Screen px of unmodified drag for a full min→max control sweep (every field). */
const NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX = 220;

/** Hz pause detent: the first ~4 px of travel stay at 0 Hz. */
const NODE_GRAPH_DISPLAY_SETTINGS_ZERO_DETENT = 4 / NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX;

/** Keys whose spec does not follow from a classifier or a finite clamp. */
const nodeGraphDisplaySettingsFieldSpecOverrides = Object.freeze({
  sweepHz: { min: 0, max: 100, taper: "log", logMin: 0.01, zeroDetent: NODE_GRAPH_DISPLAY_SETTINGS_ZERO_DETENT, step: 0.025 },
  historyHz: { min: 0, max: 100, taper: "log", logMin: 0.01, zeroDetent: NODE_GRAPH_DISPLAY_SETTINGS_ZERO_DETENT, step: 0.025 },
  sweepCycles: { min: 0.05, max: 100, taper: "log", step: 0.025 },
  historyCycles: { min: 0.05, max: 100, taper: "log", step: 0.025 },
  cycles: { min: 1, max: 64, taper: "linear", step: 1, integer: true },
  decimals: { min: 0, max: 8, taper: "linear", step: 1, integer: true },
  digits: { min: 1, max: 12, taper: "linear", step: 1, integer: true },
  maxDigits: { min: 1, max: 12, taper: "linear", step: 1, integer: true },
  dotBudget: { min: 1, max: 8192, taper: "log", step: 1, integer: true },
  textWeight: { min: 100, max: 900, taper: "linear", step: 100, integer: true },
  fftSize: { min: 128, max: 16384, taper: "log", step: 1, integer: true, table: true },
  hue: { min: 0, max: 360, taper: "linear", step: 1, wrap: true },
  backgroundHue: { min: 0, max: 360, taper: "linear", step: 1, wrap: true },
  rotationDegrees: { min: 0, max: 1440, taper: "linear", step: 1 },
  scale: { min: 0.1, max: 100, taper: "log", step: 0.025 },
  minFreq: { min: 1, max: 24000, taper: "log", step: 0.025 },
  maxFreq: { min: 1, max: 24000, taper: "log", step: 0.025 },
});

/** Linear stepper size for a value span: 1/10 of a decade below span/10 (0…1 → 0.1). */
function nodeGraphDisplaySettingsLinearStep(span) {
  const s = Math.abs(Number(span));
  if (!Number.isFinite(s) || s <= 0) {
    return 0.1;
  }
  return Math.pow(10, Math.floor(Math.log10(s)) - 1);
}

function nodeGraphDisplaySettingsFieldSpec(key, formType = null) {
  const type = formType ?? (typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "");
  const override = nodeGraphDisplaySettingsFieldSpecOverrides[key];
  if (override) {
    return { key, ...override };
  }
  if (key === "historySeconds" || key === "zoomSeconds" || key === "detail") {
    const { min, max } = nodeGraphTraceDisplayHistoryControlRange(key, type);
    return min > 0
      ? { key, min, max, taper: "log", step: 0.025 }
      : { key, min, max, taper: "power", exponent: nodeGraphTraceDisplayHistoryCurveExponent(key), step: 0.025 };
  }
  if (nodeGraphTraceDisplaySizeControlField(key) && key !== "capSize") {
    return { key, min: 0, max: nodeGraphTraceDisplaySensitiveControlMax(key), taper: "power", exponent: nodeGraphTraceDisplaySensitiveControlExponent, step: 0.04 };
  }
  if (nodeGraphWaterfallBlurField(key, type)) {
    return { key, min: 0, max: 1, taper: "power", exponent: nodeGraphTraceDisplaySensitiveControlExponent, step: 0.03 };
  }
  if (nodeGraphTraceDisplayImageBurnBlurField(key, type)) {
    return { key, min: 0, max: 1, taper: "power", exponent: nodeGraphTraceDisplaySensitiveControlExponent, step: 0.025 };
  }
  if (key === "pixelDensity") {
    return { key, min: 0, max: 1, taper: "power", exponent: nodeGraphTraceDisplaySensitiveControlExponent, step: 0.05 };
  }
  if (key === "stampDensity") {
    return { key, min: 0, max: 1, taper: "linear", step: 0.05 };
  }
  if (nodeGraphTraceDisplayUnitDragField(key, type)) {
    const { min, max } = nodeGraphTraceDisplayUnitDragRange(key);
    return { key, min, max, taper: "linear", step: 0.1 };
  }
  // Everything else: the key's own clamp gives the range.
  const clamp = nodeGraphTraceDisplayFormTypeValueClampOverrides[type]?.[key]
    || nodeGraphTraceDisplaySharedValueClamps[key];
  const finite = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) < 1e8;
  let min = clamp ? Number(clamp(-1e9)) : NaN;
  let max = clamp ? Number(clamp(1e9)) : NaN;
  if (!finite(min)) {
    min = 0;
  }
  if (!finite(max) || max <= min) {
    // Unbounded clamp (e.g. non-negative line width): a 0…1 control span.
    max = min + 1;
  }
  return { key, min, max, taper: "linear", step: nodeGraphDisplaySettingsLinearStep(max - min) };
}

/** Stored value → 0…1 control through the spec taper. */
function nodeGraphDisplaySettingsValueToControl(spec, value) {
  const { min, max } = spec;
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return 0;
  }
  if (spec.taper === "log") {
    const detent = Number(spec.zeroDetent) || 0;
    const lo = spec.logMin ?? min;
    if (detent > 0 && v <= min) {
      return 0;
    }
    const t = Math.log(Math.max(lo, Math.min(max, v)) / lo) / Math.log(max / lo);
    return detent + (1 - detent) * t;
  }
  const u = (Math.max(min, Math.min(max, v)) - min) / (max - min);
  if (spec.taper === "power") {
    return Math.pow(u, 1 / (spec.exponent || 1));
  }
  return u;
}

/** 0…1 control → stored value (inverse of ValueToControl). */
function nodeGraphDisplaySettingsControlToValue(spec, control) {
  const { min, max } = spec;
  let t = Number(control);
  if (!Number.isFinite(t)) {
    t = 0;
  }
  t = spec.wrap ? ((t % 1) + 1) % 1 : Math.max(0, Math.min(1, t));
  let value;
  if (spec.taper === "log") {
    const detent = Number(spec.zeroDetent) || 0;
    const lo = spec.logMin ?? min;
    if (detent > 0 && t <= detent) {
      return min;
    }
    value = lo * Math.pow(max / lo, (t - detent) / (1 - detent));
  } else if (spec.taper === "power") {
    value = min + Math.pow(t, spec.exponent || 1) * (max - min);
  } else {
    value = min + t * (max - min);
  }
  return spec.integer ? Math.round(value) : value;
}

function nodeGraphTraceDisplayClampUnit(value) {
  const n = nodeGraphFiniteNumber(value);
  if (typeof clampNodeSliderValue === "function") {
    return clampNodeSliderValue(n, 0, 1);
  }
  return Math.max(0, Math.min(1, n));
}

function nodeGraphTraceDisplayClampInkPx(value) {
  const n = nodeGraphFiniteNumber(value);
  if (typeof clampNodeSliderValue === "function") {
    return clampNodeSliderValue(n, 0, 32);
  }
  return Math.max(0, Math.min(32, n));
}

function nodeGraphTraceDisplayClampNonNegative(value) {
  return Math.max(0, nodeGraphFiniteNumber(value));
}

/** History / zoom window: 0 … nodeGraphTraceDisplayMaxZoomSeconds (10 s). */
function nodeGraphTraceDisplayClampHistorySeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return clampNodeSliderValue(n, 0, nodeGraphTraceDisplayMaxZoomSeconds);
}

/**
 * Display Bright / Ghost Bright 0…1.
 * Interactive path: hard clamp only. Do NOT legacy-half here — that made values
 * jump (e.g. overshoot 1.2 → 0.6) and NaN used to fall back to 1 (felt like wrap).
 * Legacy 0…2 migration lives in normalizeNodeGraphTraceDisplayBrightness on load.
 */
function nodeGraphTraceDisplayClampBrightness(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  // One-shot legacy: only when clearly still on the old 0…2 scale.
  if (n > 1 && n <= 2.0001) {
    return clampNodeSliderValue(n * 0.5, 0, 1);
  }
  return clampNodeSliderValue(n, 0, 1);
}

function nodeGraphTraceDisplayClampPixelDensity(value) {
  return clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1);
}

// Stamp blur 0–1 (hard→soft). Migrates legacy signed -1..1 patch values.
function nodeGraphTraceDisplayClampStampBlur(value) {
  if (typeof PhosphorDrawer !== "undefined" && PhosphorDrawer?.normalizeBlur) {
    return PhosphorDrawer.normalizeBlur(value, 0.35);
  }
  let v = Number(value);
  if (!Number.isFinite(v)) return 0.35;
  if (v < 0) v = (Math.max(-1, v) + 1) * 0.5;
  return clampNodeSliderValue(v, 0, 1);
}

function nodeGraphTraceDisplayClampDotBudget(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return 1024;
  }
  return Math.max(1, Math.min(8192, n));
}

// Clamp rules shared by every display-settings form type, keyed by field name.
// Each entry owns exactly one field's rule — adding/changing a rule for one
// display type cannot silently change behavior for another.
const nodeGraphTraceDisplaySharedValueClamps = Object.freeze({
  // Image Burn face scale (0 = off, 1 = fit face, up to 4 = zoom).
  imageSize: (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 1;
    }
    return clampNodeSliderValue(n, 0, 4);
  },
  image: nodeGraphTraceDisplayClampBrightness,
  send: nodeGraphTraceDisplayClampBrightness,
  ink: nodeGraphTraceDisplayClampBrightness,
  hang: nodeGraphTraceDisplayClampUnit,
  blur: nodeGraphTraceDisplayClampUnit,
  // Image Burn: 0 = unchanged, 2 = crush lows (must not inherit 0…1 unit clamp).
  contrast: (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return clampNodeSliderValue(n, 0, 2);
  },
  ghost: nodeGraphTraceDisplayClampUnit,
  ghostBlend: nodeGraphTraceDisplayClampUnit,
  capLength: nodeGraphTraceDisplayClampUnit,
  capPadding: nodeGraphTraceDisplayClampUnit,
  capSize: nodeGraphTraceDisplayClampUnit,
  cycles: (value) => Math.max(1, Math.min(64, Math.round(nodeGraphFiniteNumber(value)))),
  trail: nodeGraphTraceDisplayClampUnit,
  // Deposit gain vs Bright (0...4, default 1). Value LED overrides to 0…1 energy.
  burnAmount: (value) => {
    const max = (typeof PhosphorResidual !== "undefined" && PhosphorResidual.BURN_AMOUNT_MAX) || 4;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 1;
    }
    return clampNodeSliderValue(n, 0, max);
  },
  // Number Readout residual hang + Ghost Bright (min gradient stop).
  residual: nodeGraphTraceDisplayClampUnit,
  ghostBrightness: nodeGraphTraceDisplayClampBrightness,
  unlitSegments: nodeGraphTraceDisplayClampUnit,
  centsBand: nodeGraphTraceDisplayClampUnit,
  facePadding: (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? clampNodeSliderValue(n, -0.5, 1) : 0;
  },
  edgeSpacing: nodeGraphTraceDisplayClampUnit,
  cornerRadius: nodeGraphTraceDisplayClampUnit,
  innerShadowDistance: nodeGraphTraceDisplayClampUnit,
  innerShadowSharpness: nodeGraphTraceDisplayClampUnit,
  innerShadowOffsetX: nodeGraphTraceDisplayClampBipolarUnit,
  innerShadowOffsetY: nodeGraphTraceDisplayClampBipolarUnit,
  // Knob dial / label / value size 0…1; Y offset is bipolar face-height units.
  dialSize: nodeGraphTraceDisplayClampUnit,
  dialOffsetY: nodeGraphTraceDisplayClampBipolarUnit,
  labelSize: nodeGraphTraceDisplayClampUnit,
  valueSize: nodeGraphTraceDisplayClampUnit,
  valueOffsetY: nodeGraphTraceDisplayClampBipolarUnit,
  dotBudget: nodeGraphTraceDisplayClampDotBudget,
  digits: (value) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) {
      return 8;
    }
    return Math.max(1, Math.min(12, n));
  },
  decimals: (value) => Math.max(0, Math.min(8, Math.round(nodeGraphFiniteNumber(value)))),
  maxDigits: (value) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) {
      return 2;
    }
    return Math.max(0, Math.min(12, n));
  },
  dot1Brightness: nodeGraphTraceDisplayClampBrightness,
  dot1Size: nodeGraphTraceDisplayClampInkPx,
  ghost: nodeGraphTraceDisplayClampUnit,
  historySeconds: (value) => (typeof nodeGraphWaterfallClampHistorySeconds === "function"
    ? nodeGraphWaterfallClampHistorySeconds(value, 0.25)
    : nodeGraphTraceDisplayClampHistorySeconds(value)),
  lineLength: nodeGraphTraceDisplayClampUnit,
  lineThickness: nodeGraphTraceDisplayClampNonNegative,
  faceBlur: nodeGraphTraceDisplayClampUnit,
  lineBlur: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 8),
  lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
  stampDensity: nodeGraphTraceDisplayClampUnit,
  shapeParam: nodeGraphTraceDisplayClampUnit,
  pixelDensity: nodeGraphTraceDisplayClampPixelDensity,
  puckSize: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0.005, 0.25),
  scale: nodeGraphTraceDisplayClampNonNegative,
  secondaryBrightness: nodeGraphTraceDisplayClampBrightness,
  secondaryLineThickness: nodeGraphTraceDisplayClampNonNegative,
  secondarySize: nodeGraphTraceDisplayClampInkPx,
  sweepHz: (value) => (typeof nodeGraphTraceDisplayClampSweepHz === "function"
    ? nodeGraphTraceDisplayClampSweepHz(value, 4)
    : clampNodeSliderValue(nodeGraphFiniteNumber(value, 4), 0, 100)),
  sweepCycles: (value) => (typeof nodeGraphTraceDisplayClampSweepCycles === "function"
    ? nodeGraphTraceDisplayClampSweepCycles(value, 4)
    : clampNodeSliderValue(nodeGraphFiniteNumber(value, 4), 0.05, 100)),
  historyHz: (value) => {
    // Non-waterfall faces only. Instant Waterfall uses historySeconds.
    const n = Number(value);
    if (!Number.isFinite(n)) return 4;
    if (!(n > 0)) return 0;
    return Math.min(100, n);
  },
  historyCycles: (value) => (typeof nodeGraphTraceDisplayClampHistoryCycles === "function"
    ? nodeGraphTraceDisplayClampHistoryCycles(value, 4)
    : clampNodeSliderValue(nodeGraphFiniteNumber(value, 4), 0.05, 100)),
  fftSize: (value) => (typeof nodeGraphSpectrogramSnapFftSize === "function"
    ? nodeGraphSpectrogramSnapFftSize(value)
    : 1024),
  minFreq: (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 20;
    return clampNodeSliderValue(n, 1, 24000);
  },
  maxFreq: (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 20000;
    return clampNodeSliderValue(n, 1, 24000);
  },
  zoomSeconds: nodeGraphTraceDisplayClampHistorySeconds,
  detail: (value) => {
    const n = Number(value);
    const lo = typeof NODE_GRAPH_WATERFALL_DETAIL_MIN === "number" ? NODE_GRAPH_WATERFALL_DETAIL_MIN : 0;
    const hi = typeof NODE_GRAPH_WATERFALL_DETAIL_MAX === "number" ? NODE_GRAPH_WATERFALL_DETAIL_MAX : 1;
    if (!Number.isFinite(n)) return 1;
    return clampNodeSliderValue(n, lo, hi);
  },
  zoomMin: (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? clampNodeSliderValue(n, -1, 2) : 0;
  },
  zoomMax: (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? clampNodeSliderValue(n, -1, 2) : 1;
  },
  zoomMin: (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? clampNodeSliderValue(n, -1, 2) : 0;
  },
  zoomMax: (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? clampNodeSliderValue(n, -1, 2) : 1;
  },
  backgroundBrightness: nodeGraphTraceDisplayClampUnit,
  backgroundSaturation: nodeGraphTraceDisplayClampUnit,
  dot1Saturation: nodeGraphTraceDisplayClampUnit,
  textBrightness: nodeGraphTraceDisplayClampUnit,
  buttonBrightness: nodeGraphTraceDisplayClampUnit,
  buttonStrokeBrightness: nodeGraphTraceDisplayClampUnit,
  hoverBrightness: nodeGraphTraceDisplayClampUnit,
  onBrightness: nodeGraphTraceDisplayClampUnit,
  hoverAlpha: nodeGraphTraceDisplayClampUnit,
  onAlpha: nodeGraphTraceDisplayClampUnit,
  backgroundHue: (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return clampNodeSliderValue(n, 0, 360);
  },
  textSize: (value) => (typeof nodeGraphKeypadClampTextSize === "function"
    ? nodeGraphKeypadClampTextSize(value)
    : Math.max(0, Math.min(1, nodeGraphFiniteNumber(value, 0.55)))),
  textSizePx: (value) => (typeof nodeGraphKeypadClampTextSize === "function"
    ? nodeGraphKeypadClampTextSize(value)
    : Math.max(0, Math.min(1, nodeGraphFiniteNumber(value, 0.55)))),
  textWeight: (value) => (typeof nodeGraphKeypadClampWeight === "function"
    ? nodeGraphKeypadClampWeight(value)
    : Math.max(100, Math.min(900, Math.round((nodeGraphFiniteNumber(value, 400)) / 100) * 100))),
  buttonWidth: (value) => (typeof nodeGraphKeypadClampWidth === "function"
    ? nodeGraphKeypadClampWidth(value)
    : Math.max(0, Math.min(1, nodeGraphFiniteNumber(value, 0.94)))),
  buttonHeight: (value) => (typeof nodeGraphKeypadClampHeight === "function"
    ? nodeGraphKeypadClampHeight(value)
    : Math.max(0, Math.min(1, nodeGraphFiniteNumber(value, 0.94)))),
});

// Per-formType overrides, only for the (formType, field) pairs that diverge
// from the shared table above. Isolated per formType so a new override can't
// leak into unrelated display types.
/** Pulse Explosion / Pulse Train face: stem + dot size (Pulse Train adds Ghost opacity). */
const nodeGraphPulseFaceValueClamps = Object.freeze({
  lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1.5), 0.25, 16),
  lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
  dotThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 5), 0.25, 32),
});
const nodeGraphTraceDisplayFormTypeValueClampOverrides = Object.freeze({
  // Spectrogram: History (s) 0…30 (waterfall scroll rate; longer = slower).
  spectrogramBurn: Object.freeze({
    historySeconds: (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 2;
      // 0 is not meaningful (was silently treated as ~0.05 s).
      if (n <= 0) return 0.1;
      return clampNodeSliderValue(n, 0.1, 30);
    },
    minFreq: (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 20;
      return clampNodeSliderValue(n, 1, 24000);
    },
    maxFreq: (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 20000;
      return clampNodeSliderValue(n, 1, 24000);
    },
  }),
  // Phosphor Dot: same blur continuum as 2D Phosphor stamps.
  dot: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  vectorDot: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampUnit,
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    shapeParam: nodeGraphTraceDisplayClampUnit,
    dot1Brightness: nodeGraphTraceDisplayClampBrightness,
    backgroundBrightness: nodeGraphTraceDisplayClampUnit,
  }),
  imageBurnFace: Object.freeze({
    backgroundBrightness: nodeGraphTraceDisplayClampUnit,
  }),
  pulseDot: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampUnit,
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    shapeParam: nodeGraphTraceDisplayClampUnit,
    dot1Brightness: nodeGraphTraceDisplayClampBrightness,
    backgroundBrightness: nodeGraphTraceDisplayClampUnit,
  }),
  lcdDot: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampUnit,
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    shapeParam: nodeGraphTraceDisplayClampUnit,
    dot1Brightness: nodeGraphTraceDisplayClampBrightness,
    backgroundBrightness: nodeGraphTraceDisplayClampUnit,
    backgroundSaturation: nodeGraphTraceDisplayClampUnit,
    dot1Saturation: nodeGraphTraceDisplayClampUnit,
    unlitSegments: nodeGraphTraceDisplayClampUnit,
    innerShadowDistance: nodeGraphTraceDisplayClampUnit,
    innerShadowSharpness: nodeGraphTraceDisplayClampUnit,
    innerShadowOffsetX: nodeGraphTraceDisplayClampBipolarUnit,
    innerShadowOffsetY: nodeGraphTraceDisplayClampBipolarUnit,
  }),
  // 1D Phosphor: stamp blur + sweep rate.
  lineBurn: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  // Soft phosphor stamps: blur 0 hard … 1 full soft.
  scope2d: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  phosphorLight: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  videoscopeBurn: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  vectorRgbFace: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
    dotBudget: nodeGraphTraceDisplayClampDotBudget,
  }),
  toggleButtonFace: Object.freeze({
    strokeScale: nodeGraphTraceDisplayClampUnit,
    rounding: nodeGraphTraceDisplayClampUnit,
  }),

  momentaryButtonFace: Object.freeze({
    strokeScale: nodeGraphTraceDisplayClampUnit,
    rounding: nodeGraphTraceDisplayClampUnit,
  }),

  pluginSliderFace: Object.freeze({
    sliderRounding: nodeGraphTraceDisplayClampUnit,
  }),
  knobFace: Object.freeze({
    innerRadius: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0.3, 0.92),
  }),
  ensembleCloud: Object.freeze({
    cloudSpeed: (value) => {
      const n = Number(value);
      return clampNodeSliderValue(Number.isFinite(n) ? n : 1, 0, 4);
    },
  }),
  hypersawBurn: Object.freeze({
    // Stem width in screen pixels. 0 = gone.
    lineThickness: (value) => {
      const n = Number(value);
      return clampNodeSliderValue(Number.isFinite(n) ? n : 2, 0, 64);
    },
  }),
  xyPad: Object.freeze({
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  roundShapeFace: Object.freeze({
    lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 2), 0.25, 16),
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
    lineBlur: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 8),
    lineBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    dotThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 5), 0.25, 32),
    dotBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    backgroundBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    pixelDensity: nodeGraphTraceDisplayClampPixelDensity,
  }),
  basicShapeFace: Object.freeze({
    lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 2), 0.25, 16),
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
    lineBlur: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 8),
    lineBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    dotThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 5), 0.25, 32),
    dotBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    backgroundBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    pixelDensity: nodeGraphTraceDisplayClampPixelDensity,
  }),
  softwaveOscFace: Object.freeze({
    lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 3), 0.25, 16),
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
    lineBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    dotThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 5), 0.25, 32),
    backgroundBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
  }),
  sinCosFace: Object.freeze({
    lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 2), 0.25, 16),
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
    lineBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    dotThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 5), 0.25, 32),
    dotBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    backgroundBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    padExtra: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0), 0, 64),
  }),
  clockFace: Object.freeze({
    lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 2), 0.25, 16),
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
    startThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1.5), 0, 16),
    blinkTime: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0), 0, 1),
    gateHeight: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 68), 0, 100),
  }),
  clockDividerFace: Object.freeze({
    lineThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1.5), 0.25, 16),
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
  }),
  pulseExplosionFace: nodeGraphPulseFaceValueClamps,
  pulseTrainFace: Object.freeze({
    ...nodeGraphPulseFaceValueClamps,
    fadeTime: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0), 0, 60),
  }),
  robinSinepulseFace: Object.freeze({
    lineSmoothing: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 8),
    dotThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0), 0, 32),
    pixelDensity: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0, 1),
  }),
  sinCos4Face: Object.freeze({
    backgroundBrightness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
    sinCos4RayThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1.2), 0, 100),
    sinCos4OuterDotSize: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0.08), 0, 20),
    sinCos4HubDotSize: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0.08), 0, 20),
    sinCos4RingThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1.2), 0, 100),
  }),
  torchFace: Object.freeze({
    torchHue: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value), 0, 1),
  }),
  // Instant Waterfall: Bright/Blur (filled bars); Size legacy only.
  // Column Detail is the shared `detail` clamp (not the removed phosphor Detail).
  waterfall: Object.freeze({
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    secondarySize: nodeGraphTraceDisplayClampInkPx,
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
    faceBlur: nodeGraphTraceDisplayClampUnit,
    secondaryLineThickness: nodeGraphTraceDisplayClampStampBlur,
    brightness: nodeGraphTraceDisplayClampBrightness,
    dot1Brightness: nodeGraphTraceDisplayClampBrightness,
    secondaryBrightness: nodeGraphTraceDisplayClampBrightness,
    barThickness: nodeGraphTraceDisplayClampUnit,
    strokeThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0.25, 16),
    scale: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0.01, 100),
  }),
  waterfallRgb: Object.freeze({
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
    faceBlur: nodeGraphTraceDisplayClampUnit,
    brightness: nodeGraphTraceDisplayClampBrightness,
    dot1Brightness: nodeGraphTraceDisplayClampBrightness,
    barThickness: nodeGraphTraceDisplayClampUnit,
    strokeThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0.25, 16),
    scale: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0.01, 100),
  }),
  waterfallXyz: Object.freeze({
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
    faceBlur: nodeGraphTraceDisplayClampUnit,
    brightness: nodeGraphTraceDisplayClampBrightness,
    dot1Brightness: nodeGraphTraceDisplayClampBrightness,
    barThickness: nodeGraphTraceDisplayClampUnit,
    strokeThickness: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0.25, 16),
    scale: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 1), 0.01, 100),
  }),
  value: Object.freeze({
    dot1Size: nodeGraphTraceDisplayClampInkPx,
  }),
  // Value LED: Burn ⨯ is deposit energy 0…1 (stop t), independent of Bright.
  numberReadout: Object.freeze({
    burnAmount: nodeGraphTraceDisplayClampUnit,
  }),
  scope2dTrace: Object.freeze({
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    lineThickness: nodeGraphTraceDisplayClampStampBlur,
  }),
  scope1dTrace: Object.freeze({
    dot1Size: nodeGraphTraceDisplayClampInkPx,
    secondarySize: nodeGraphTraceDisplayClampInkPx,
  }),
});

function normalizeNodeGraphTraceDisplaySettingValueForKey(key, value) {
  const formType = nodeGraphTraceDisplaySettingsFormType();
  const clamp = nodeGraphTraceDisplayFormTypeValueClampOverrides[formType]?.[key] ||
    nodeGraphTraceDisplaySharedValueClamps[key];
  if (clamp) {
    return clamp(value);
  }
  if (/Brightness$/i.test(String(key || "")) || /Saturation$/i.test(String(key || "")) || /Alpha$/i.test(String(key || ""))) {
    return nodeGraphTraceDisplayClampUnit(value);
  }
  return value;
}
