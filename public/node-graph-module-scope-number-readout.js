// Number Readout paint helpers extracted from node-graph-module-scopes.js (Phase D).
// Load after phosphor, before scopes.js.

function nodeGraphNumberReadoutCanvasForSlot(slot) {
  const screenElement = slot?.scopeElement;
  if (!screenElement) {
    return null;
  }
  let canvas = screenElement.querySelector(":scope > .node-number-readout-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "node-number-readout-canvas node-display-canvas";
    canvas.setAttribute("aria-hidden", "true");
    screenElement.appendChild(canvas);
  }
  return canvas;
}


function invalidateNodeGraphNumberReadoutPaintCache(canvas) {
  if (!canvas) {
    return;
  }
  canvas._numberReadoutLastValueText = "";
  canvas._numberReadoutLastGoodValueText = "";
  canvas._numberReadoutLastTextChangeAt = 0;
  canvas._numberReadoutLastDigitLayout = null;
  canvas._numberReadoutResidualEnergy = 0;
  canvas._numberReadoutResiduals = null;
  canvas._nodeGraphNumberReadoutText = null;
  canvas._nodeGraphNumberReadoutSettingsSig = null;
  canvas._nodeGraphNumberReadoutFontReady = null;
  canvas._nodeGraphNumberReadoutWidth = -1;
  canvas._nodeGraphNumberReadoutHeight = -1;
  canvas._nodeGraphNumberReadoutZoom = null;
  canvas._nodeGraphNumberReadoutPaintAt = 0;
  canvas._numberReadoutEnergyMask = null;
  canvas._nodeGraphNumberReadoutFrozenHoldSig = null;
  // Pause absorb stamps these; if they survive Stop wipe, Instant Waterfall /
  // burn cursors can believe the new session is already fully drawn.
  canvas._nodeGraphScope2dLastDrawnFrame = undefined;
  canvas._nodeGraphOneDimensionalBurnLastDrawnFrame = undefined;
  canvas._phosphorScope2dLastFrame = undefined;
  nodeGraphNumberReadoutClearBurnPlate(canvas);
  for (const key of ["_phosphorEnergyGl"]) {
    const face = canvas[key];
    if (face && typeof nodeGraphPhosphorEnergyGlDestroy === "function") {
      try {
        nodeGraphPhosphorEnergyGlDestroy(face);
      } catch (_error) {
        // Best-effort.
      }
    }
    canvas[key] = null;
  }
}

/**
 * After a cold engine start (esp. pause→stop→play), drop freeze-hold state so
 * Value LCD/LED paint live samples again instead of early-outing as "still paused".
 */
function nodeGraphNumberReadoutRearmAllFacesAfterLiveStart(options = {}) {
  if (typeof document === "undefined") {
    return;
  }
  // hard=true: cold start after Stop (drop held reading). Soft (default): plain
  // unpause keeps lastGoodValueText so pause residual hold is not wiped.
  const hard = options === true
    || (options && typeof options === "object" && options.hard === true);
  for (const canvas of document.querySelectorAll("canvas.node-number-readout-canvas")) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      continue;
    }
    canvas._nodeGraphNumberReadoutFrozenHoldSig = null;
    canvas._nodeGraphScope2dLastDrawnFrame = undefined;
    canvas._nodeGraphOneDimensionalBurnLastDrawnFrame = undefined;
    canvas._phosphorScope2dLastFrame = undefined;
    // Force next draw to treat text as dirty (null cache).
    canvas._nodeGraphNumberReadoutText = null;
    canvas._nodeGraphNumberReadoutSettingsSig = null;
    canvas._numberReadoutLastValueText = "";
    if (hard) {
      canvas._numberReadoutLastGoodValueText = "";
    }
    // Stop wipe / empty-ring races can leave canvas lightStrength at 0 while the
    // face still expects a room-dimmer hole. Re-open punches even if paint cannot
    // run yet (no slots / stale buffers).
    const face = canvas.parentElement;
    const isLcd = (typeof nodeGraphNumberReadoutIsLcdFaceElement === "function"
      && nodeGraphNumberReadoutIsLcdFaceElement(face))
      || String(face?.dataset?.valueFaceStyle || "").toLowerCase() === "lcd";
    if (isLcd && typeof nodeGraphNumberReadoutApplyLcdLightCutout === "function") {
      nodeGraphNumberReadoutApplyLcdLightCutout(face, canvas);
    } else {
      const s = String(nodeGraphLedDisplayLightStrength);
      for (const el of [face, canvas].filter(Boolean)) {
        el.classList?.add?.("node-light-source");
        if (el.dataset) {
          el.dataset.lightSource = "screen";
          el.dataset.lightStrength = s;
        }
        if (typeof setNodeGraphLightStrength === "function") {
          setNodeGraphLightStrength(el, nodeGraphLedDisplayLightStrength);
        }
      }
    }
  }
  // Pitch Detector outer body is also a light source (not only the LCD plate).
  for (const face of document.querySelectorAll(".node-pitch-detector-face, .node-pitch-detector-lcd")) {
    if (!(face instanceof HTMLElement)) continue;
    if (typeof nodeGraphNumberReadoutApplyLcdLightCutout === "function"
      && (face.classList?.contains("node-pitch-detector-lcd")
        || face.classList?.contains("node-value-lcd-face"))) {
      nodeGraphNumberReadoutApplyLcdLightCutout(face, face.querySelector?.(":scope > .node-number-readout-canvas"));
    } else if (typeof setNodeGraphLightStrength === "function") {
      face.classList?.add?.("node-light-source");
      if (face.dataset) {
        face.dataset.lightSource = "screen";
        face.dataset.lightStrength = "1";
      }
      setNodeGraphLightStrength(face, 1);
    }
  }
  if (typeof scheduleNodeGraphRoomDimmerDraw === "function") {
    try {
      scheduleNodeGraphRoomDimmerDraw();
    } catch (_error) {
      // Best-effort.
    }
  }
}

/**
 * Paint Value LCD / Value LED / Pitch readout / Vector Dot faces NOW without the
 * shared scope canvas gate. After pause→stop the main draw loop often early-outs
 * on empty buffers ("stale-buffers") and never reaches these face painters —
 * so digits stay wiped / lamps stay black until something else forces a pass.
 *
 * @returns {number} how many faces were painted
 */
function paintNodeGraphValueFacesNow(pixelRatio = window.devicePixelRatio || 1) {
  if (typeof nodeGraphVisibleModuleScopeSlots !== "function") {
    return 0;
  }
  const pr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, 1));
  let painted = 0;
  for (const slot of nodeGraphVisibleModuleScopeSlots()) {
    const renderer = typeof nodeGraphModuleDisplayRendererForSlot === "function"
      ? nodeGraphModuleDisplayRendererForSlot(slot)
      : "";
    const type = String(slot?.type || "");
    const isNumberFace =
      renderer === "numberReadout"
      || type === "numberReadout"
      || type === "valueLcd"
      || type === "helmholtzPitch";
    const isVectorDot = renderer === "vectorDot" || renderer === "pulseDot" || renderer === "lcdDot";
    if (!isNumberFace && !isVectorDot) {
      continue;
    }
    const captured = typeof nodeGraphModuleScopeCapturedBufferForSlot === "function"
      ? nodeGraphModuleScopeCapturedBufferForSlot(slot)
      : null;
    const buffer = typeof nodeGraphModuleScopeDisplayBuffer === "function"
      ? nodeGraphModuleScopeDisplayBuffer(slot, captured)
      : captured;
    const face = slot.scopeElement;
    if (!face) {
      continue;
    }
    // Synthetic scope rect from layout box (draw path only needs positive size).
    // Resize-observer cache: no forced layout per face per frame (that cost
    // ~36 ms a frame right after a pan invalidated style).
    const faceMetrics = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(face) : null;
    const w = Math.max(1, faceMetrics?.cssW || face.clientWidth || face.offsetWidth || 1);
    const h = Math.max(1, faceMetrics?.cssH || face.clientHeight || face.offsetHeight || 1);
    const item = {
      buffer,
      nodeId: slot.nodeId,
      screenElement: face,
      scopeRect: { height: h, left: 0, top: 0, width: w },
      slot,
    };
    try {
      if (isVectorDot && typeof drawNodeGraphVectorDotItem === "function") {
        drawNodeGraphVectorDotItem(renderer, item, pr);
        painted += 1;
        continue;
      }
      if (isNumberFace && typeof drawNodeGraphNumberReadoutItem === "function") {
        // Clear freeze-hold so draw cannot early-out as "still paused".
        const canvas = typeof nodeGraphNumberReadoutCanvasForSlot === "function"
          ? nodeGraphNumberReadoutCanvasForSlot(slot)
          : null;
        if (canvas) {
          canvas._nodeGraphNumberReadoutFrozenHoldSig = null;
          canvas._nodeGraphNumberReadoutText = null;
        }
        drawNodeGraphNumberReadoutItem(null, item, pr);
        const isLcd = typeof nodeGraphNumberReadoutFaceStyleForSlot === "function"
          && nodeGraphNumberReadoutFaceStyleForSlot(
            slot,
            typeof nodeGraphModuleScopeNodeForSlot === "function"
              ? nodeGraphModuleScopeNodeForSlot(slot)
              : null,
          ) === "lcd";
        const s = isLcd && typeof nodeGraphLcdDisplayLightStrength === "number"
          ? nodeGraphLcdDisplayLightStrength
          : nodeGraphLedDisplayLightStrength;
        // Always re-open room-dimmer punches (face + canvas).
        if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
          nodeGraphModuleScopeMarkScreenLit(face, s);
        }
        for (const el of [face, canvas].filter(Boolean)) {
          el.classList?.add?.("node-light-source");
          if (el.dataset) {
            el.dataset.lightSource = "screen";
            el.dataset.lightStrength = String(s);
          }
          if (typeof setNodeGraphLightStrength === "function") {
            setNodeGraphLightStrength(el, s);
          }
        }
        painted += 1;
      }
    } catch (_error) {
      // Never let one face kill rearm for the rest.
    }
  }
  return painted;
}

/**
 * True when valueText is a "no signal" placeholder, not a held reading.
 * Placeholders must never replace a frozen/held phosphor face.
 */
function nodeGraphNumberReadoutIsEmptyPlaceholder(text) {
  const s = String(text || "").trim();
  if (!s) {
    return true;
  }
  // DSEG all-off, dashes, em-dash, or pure ! / . skeletons.
  if (/^[!.\s—–-]+$/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Prefer live sample; if missing (pause / bypass / wire re-arm glitch), hold the
 * last good reading so Ghost/Trail never get wiped to empty "!" plates.
 */
function nodeGraphNumberReadoutResolveHeldValueText(canvas, liveText, { frozen = false } = {}) {
  const live = String(liveText || "");
  if (!nodeGraphNumberReadoutIsEmptyPlaceholder(live)) {
    return live;
  }
  const held = String(canvas?._numberReadoutLastGoodValueText || "");
  if (held && !nodeGraphNumberReadoutIsEmptyPlaceholder(held)) {
    return held;
  }
  // Never invent empty "!" while frozen — caller should leave the face alone.
  if (frozen) {
    return "";
  }
  return live;
}

function nodeGraphNumberReadoutRememberGoodValue(canvas, valueText) {
  if (!canvas || nodeGraphNumberReadoutIsEmptyPlaceholder(valueText)) {
    return;
  }
  canvas._numberReadoutLastGoodValueText = String(valueText);
}

/**
 * Offscreen burn plate for residual digits (pixel burn, not tracked history).
 * Stamps only on value change; fades each frame with super-exponential Residual hang.
 * On resize: scale-preserve previous ink — never blank the residual (zoom/layout
 * flicker used to wipe Ghost/Trail every time the host canvas dim hopped 1px).
 */
function nodeGraphNumberReadoutEnsureBurnPlate(canvas) {
  if (!canvas) {
    return null;
  }
  // Size holder only: deposits live in the GPU plate (nodeGraphNumberReadoutGlPlateEnsure),
  // which scale-preserves itself on resize. No 2D scratch.
  let layer = canvas._numberReadoutBurnPlate;
  if (!layer) {
    layer = { width: 0, height: 0 };
    canvas._numberReadoutBurnPlate = layer;
  }
  const w = Math.max(0, canvas.width | 0);
  const h = Math.max(0, canvas.height | 0);
  if (w >= 1 && h >= 1) {
    layer.width = w;
    layer.height = h;
  }
  return layer;
}

function nodeGraphNumberReadoutClearBurnPlate(canvas) {
  if (!canvas) {
    return;
  }
  if (canvas._numberReadoutGlPlate) {
    nodeGraphNumberReadoutGlPlateClear(canvas._numberReadoutGlPlate);
  }
  canvas._numberReadoutResidualEnergy = 0;
}



/** LED (phosphor light) vs LCD (reflective ink) face style for a slot/node. */
function nodeGraphNumberReadoutFaceStyleForSlot(slot, node = null) {
  const type = String(slot?.type || node?.type || "");
  if (type === "helmholtzPitch") {
    return "lcd";
  }
  if (type === "valueLcd") {
    return "lcd";
  }
  if (typeof nodeGraphNumberReadoutFaceStyleForNode === "function") {
    return nodeGraphNumberReadoutFaceStyleForNode(node || { type, traceDisplaySettings: null });
  }
  return "led";
}

/**
 * Room-dimmer cutout for reflective LCD plates: partial hole (same 2/3
 * “less dim” as crossover curve faces), not full-bright phosphor (1) and not
 * fully under the veil (0).
 */
/** Room-dimmer light-source cutout per display type (0 = veiled, 1 = full hole). */
// LCD shares the crossover faces' cutout (node-graph-cookbook-filter.js).
const NODE_GRAPH_LCD_LIGHT_CUTOUT =
  typeof nodeGraphCrossoverDisplayLightStrength === "number"
    ? nodeGraphCrossoverDisplayLightStrength
    : 2 / 3;
const NODE_GRAPH_LED_LIGHT_CUTOUT = 0.75;
const nodeGraphLcdDisplayLightStrength = NODE_GRAPH_LCD_LIGHT_CUTOUT;
const nodeGraphLedDisplayLightStrength = NODE_GRAPH_LED_LIGHT_CUTOUT;

function nodeGraphNumberReadoutIsLcdFaceElement(el) {
  if (!el) {
    return false;
  }
  if (el.classList?.contains("node-pitch-detector-lcd")
    || el.closest?.(".node-pitch-detector-face")) {
    return true;
  }
  if (el.classList?.contains("node-value-lcd-face")) {
    return true;
  }
  if (String(el.dataset?.valueFaceStyle || "").toLowerCase() === "lcd") {
    return true;
  }
  return false;
}

/** Apply LCD less-dim punch to face (+ optional canvas). */
function nodeGraphNumberReadoutApplyLcdLightCutout(face, canvas = null) {
  const s = nodeGraphLcdDisplayLightStrength;
  const strength = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : NODE_GRAPH_LCD_LIGHT_CUTOUT;
  const text = strength.toFixed(6);
  const targets = [face, canvas].filter(Boolean);
  for (const el of targets) {
    el.classList?.add?.("node-light-source");
    if (el.dataset) {
      el.dataset.lightSource = "screen";
      el.dataset.lightStrength = text;
    }
    if (typeof setNodeGraphLightStrength === "function") {
      setNodeGraphLightStrength(el, strength);
    }
  }
  return strength;
}

/**
 * LCD foreground (digit ink) RGB — solid color widget only (no Bright ramp).
 */
function nodeGraphNumberReadoutLcdHueDeg(settings, fallbackHex, fallbackHue) {
  const hex = settings?.dot1Color || settings?.color || settings?.background || fallbackHex;
  if (typeof nodeGraphHueDegFromHex === "function") {
    const h = nodeGraphHueDegFromHex(hex);
    if (Number.isFinite(h)) {
      return h;
    }
  }
  return fallbackHue;
}

function nodeGraphNumberReadoutLcdInkRgb(settings) {
  const hue = nodeGraphNumberReadoutLcdHueDeg(
    { dot1Color: settings?.dot1Color ?? settings?.color },
    settings?.dot1Color ?? settings?.color,
    typeof nodeGraphValueLcdDefaultHueDeg === "number" ? nodeGraphValueLcdDefaultHueDeg : 82,
  );
  const amount = clampNodeSliderValue(
    Number(settings?.brightness ?? settings?.dot1Brightness),
    0,
    1,
  );
  const satN = Number(settings?.dot1Saturation ?? settings?.colorSaturation);
  const sat = Number.isFinite(satN) ? clampNodeSliderValue(satN, 0, 1) : 1;
  if (typeof nodeGraphHueBrightnessRgb01 === "function") {
    const [r, g, b] = nodeGraphHueBrightnessRgb01(hue, amount, sat);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  return [26, 34, 22];
}

/**
 * LCD ghost 8s — same ink hue, parked between plate and ink (not a grey policy).
 */
function nodeGraphNumberReadoutLcdGhostRgb(inkRgb, settings = null) {
  if (settings && typeof nodeGraphHueBrightnessRgb01 === "function") {
    const hue = nodeGraphNumberReadoutLcdHueDeg(
      { dot1Color: settings.dot1Color ?? settings.color },
      settings.dot1Color ?? settings.color,
      typeof nodeGraphValueLcdDefaultHueDeg === "number" ? nodeGraphValueLcdDefaultHueDeg : 82,
    );
    const inkAmt = clampNodeSliderValue(Number(settings.brightness ?? settings.dot1Brightness), 0, 1);
    const plateAmt = clampNodeSliderValue(Number(settings.backgroundBrightness), 0, 1);
    const ghostAmt = plateAmt + (inkAmt - plateAmt) * 0.42;
    const satN = Number(settings.dot1Saturation ?? settings.colorSaturation);
    const sat = Number.isFinite(satN) ? clampNodeSliderValue(satN, 0, 1) : 1;
    const [r, g, b] = nodeGraphHueBrightnessRgb01(hue, ghostAmt, sat);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  const r = nodeGraphFiniteNumber(inkRgb?.[0]);
  const g = nodeGraphFiniteNumber(inkRgb?.[1]);
  const b = nodeGraphFiniteNumber(inkRgb?.[2]);
  const y = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
  return [y, y, y];
}

/**
 * LCD background plate RGB from hue + physically-plausible brightness.
 */
function nodeGraphNumberReadoutLcdBgRgb(settings) {
  const hue = nodeGraphNumberReadoutLcdHueDeg(
    { color: settings?.backgroundColor ?? settings?.background },
    settings?.backgroundColor ?? settings?.background,
    typeof nodeGraphValueLcdDefaultHueDeg === "number" ? nodeGraphValueLcdDefaultHueDeg : 82,
  );
  const amount = clampNodeSliderValue(Number(settings?.backgroundBrightness), 0, 1);
  const satN = Number(settings?.backgroundSaturation);
  const sat = Number.isFinite(satN) ? clampNodeSliderValue(satN, 0, 1) : 1;
  if (typeof nodeGraphHueBrightnessRgb01 === "function") {
    const [r, g, b] = nodeGraphHueBrightnessRgb01(hue, amount, sat);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  return [176, 181, 166];
}

function nodeGraphNumberReadoutLcdBgCss(settings) {
  const [r, g, b] = nodeGraphNumberReadoutLcdBgRgb(settings);
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Hermite smoothstep 0…1 → 0…1 (S-curve). Used to map hardness → blur
 * so soft mid-range stays usable and hardness 1 collapses to a hard rim.
 */
function nodeGraphNumberReadoutSmoothstep01(t) {
  const x = clampNodeSliderValue(nodeGraphFiniteNumber(t), 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Live digit light (top layer only). Same physically-based cone as LCD:
 *   Bright 0   → black
 *   Bright 0.5 → full hue
 *   Bright 1   → white
 * Sat 0 = grey at that brightness; sat 1 = the hue×brightness color.
 * Ghost/Trail residual still uses the Ghost Gradient LUT, not this RGB.
 */
function nodeGraphNumberReadoutLightRgb(settings) {
  const hex = settings?.color
    || nodeGraphNumberReadoutSettingsDefaults?.color
    || "#fcfdbf";
  const hue = typeof nodeGraphHueDegFromHex === "function"
    ? nodeGraphHueDegFromHex(hex)
    : 50;
  const bright = Number.isFinite(Number(settings?.brightness))
    ? clampNodeSliderValue(Number(settings.brightness), 0, 1)
    : 0.5;
  const satN = Number(settings?.dot1Saturation ?? settings?.colorSaturation);
  const sat = Number.isFinite(satN) ? clampNodeSliderValue(satN, 0, 1) : 1;
  if (typeof nodeGraphHueBrightnessRgb01 === "function") {
    const [r, g, b] = nodeGraphHueBrightnessRgb01(hue, bright, sat);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  return [252, 253, 191];
}

/**
 * Energy → gradient color (present-time sample).
 * energy is the brightness amount itself (0…1 stop): 0.2 energy → color at t=0.2.
 * Never bake color into the burn plate.
 */
function nodeGraphNumberReadoutGhostRgbFromEnergy(energy, gradientStops, peakHex) {
  const e = clampNodeSliderValue(nodeGraphFiniteNumber(energy), 0, 1);
  if (typeof nodeGraphSampleGradientStopsRgb === "function") {
    const rgb = nodeGraphSampleGradientStopsRgb(gradientStops, e, peakHex || "#fcfdbf");
    if (Array.isArray(rgb) && rgb.length >= 3) {
      return rgb;
    }
  }
  return [252, 253, 191];
}

/**
 * Present the LED energy plate: each pixel's alpha is its own residual energy
 * and maps through Ghost Gradient independently (same LUT idea as phosphor
 * burn). Do not tint the whole plate from one shared energy — that made every
 * ghost digit shift hue together.
 */
function nodeGraphNumberReadoutGhostLut256(stops, peakHex) {
  const lut = new Uint8ClampedArray(256 * 3);
  const sample = typeof nodeGraphSampleGradientStopsRgb === "function"
    ? nodeGraphSampleGradientStopsRgb
    : null;
  const peak = peakHex || "#fcfdbf";
  for (let i = 0; i < 256; i += 1) {
    const rgb = sample
      ? sample(stops, i / 255, peak)
      : [252, 253, 191];
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  return lut;
}

// Burn-plate tint into the face target: plate alpha (float energy) indexes
// the 256-entry ghost LUT per pixel (texel centres, linear between entries);
// output premultiplied (texel row = canvas row). Any energy > 0 tints.
const NODE_GRAPH_NUMBER_READOUT_TINT_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 vUv;
  uniform sampler2D uPlate;
  uniform sampler2D uLut;
  uniform vec2 uSize;
  void main() {
    vec4 p = texture2D(uPlate, gl_FragCoord.xy / uSize);
    float a = clamp(p.a, 0.0, 1.0);
    if (a <= 0.0) {
      discard;
    }
    vec3 c = texture2D(uLut, vec2((a * 255.0 + 0.5) / 256.0, 0.5)).rgb;
    gl_FragColor = vec4(c * a, a);
  }
`;
const nodeGraphNumberReadoutTintGl = { gl: null, lut: null, lutKey: "" };

// Tint the GPU burn plate into the face target (premultiplied source-over),
// same result as the old present + drawImage onto the face.
function nodeGraphNumberReadoutPresentBurnPlateGl(pen, lut, lutKey, plateGl) {
  const gl = pen?.gl;
  if (!gl || !plateGl?.read?.tex || plateGl.gl !== gl || plateGl.w !== pen.w || plateGl.h !== pen.h) {
    return false;
  }
  const program = SoemGl.program(gl, "number-readout-burn-tint-face", SoemGl.GLSL_FULLSCREEN_VS, NODE_GRAPH_NUMBER_READOUT_TINT_FS);
  if (!program) {
    return false;
  }
  nodeGraphNumberReadoutGlPenFlush(pen);
  const st = nodeGraphNumberReadoutTintGl;
  if (st.gl !== gl) {
    st.gl = gl;
    st.lut = null;
    st.lutKey = "";
  }
  if (!st.lut) {
    st.lut = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, st.lut);
    nodeGraphNumberReadoutGlPlateTexParams(gl, gl.LINEAR);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, st.lut);
  if (st.lutKey !== lutKey) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(Uint8ClampedArray.from(lut).buffer));
    st.lutKey = lutKey;
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, plateGl.read.tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, pen.target.fbo);
  gl.viewport(0, 0, pen.w, pen.h);
  gl.disable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uPlate"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uLut"), 1);
  gl.uniform2f(gl.getUniformLocation(program, "uSize"), pen.w, pen.h);
  SoemGl.drawQuad(gl, gl.getAttribLocation(program, "aPos"));
  gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  nodeGraphNumberReadoutGlStats.tints += 1;
  return true;
}

/*
 * GPU burn plate. The residual energy plate lives in two float energy targets
 * (SoemGl.energyTarget: RGBA32F, then RGBA16F, rgba8 last resort) on the
 * shared GL device (ping-pong). The per-frame fade is one full-plate draw of
 * the shared time-based residual model (PhosphorResidual.applyResidual per
 * texel: bright energy keeps at Trail's rate, dim energy at Ghost's slow
 * tail, over the 60 fps frames elapsed), read -> write, swap.
 * Deposits are GL glyph quads drawn straight into the plate (premultiplied
 * source-over), so nothing is uploaded per frame. Texel row y = canvas row y
 * in every pass; the tint pass samples the plate at gl_FragCoord.
 * No shared device: nodeGraphDisplayGlFailed (black + one console.error);
 * there is no 2D plate path.
 */
// uResidual > 0.5: k = pow(mix(keepSlow, keepFast, e^12), frames) per texel.
// Otherwise plain src * uKeep (resize copy). uFloor8: rgba8 last resort,
// round toward 0 so dim texels never stall into a floor.
const NODE_GRAPH_NUMBER_READOUT_PLATE_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform sampler2D uSrc;
  uniform vec2 uSize;
  uniform float uKeep;
  uniform float uResidual;
  uniform float uKeepFast;
  uniform float uKeepSlow;
  uniform float uFrames;
  uniform float uFloor8;
  void main() {
    vec4 t = texture2D(uSrc, gl_FragCoord.xy / uSize);
    float k = uKeep;
    if (uResidual > 0.5) {
      k = pow(mix(uKeepSlow, uKeepFast, pow(clamp(t.a, 0.0, 1.0), 12.0)), uFrames);
    }
    if (uFloor8 > 0.5) {
      gl_FragColor = floor(floor(t * 255.0 + 0.5) * k) / 255.0;
    } else {
      gl_FragColor = t * k;
    }
  }
`;
const nodeGraphNumberReadoutPlateGlStats = { fades: 0, stamps: 0 };


function nodeGraphNumberReadoutGlPlateTexParams(gl, filter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// Float energy target (blendable: deposits and face draws are source-over).
// A Burn 0.0001 deposit stores as 0.0001 instead of rounding to 0.
function nodeGraphNumberReadoutGlPlateTarget(gl, w, h) {
  const t = SoemGl.energyTarget(gl, w, h, { blend: true, filter: gl.NEAREST });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t || null;
}

function nodeGraphNumberReadoutGlPlateDrop(gl, st) {
  if (!gl || !st) return;
  for (const t of [st.read, st.write]) {
    if (t?.fbo) gl.deleteFramebuffer(t.fbo);
    if (t?.tex) gl.deleteTexture(t.tex);
  }
}

// One full-plate pass: dst = src(scaled to the plate) * keep, or the
// residual model when residual = { keepFast, keepSlow, frames }.
function nodeGraphNumberReadoutGlPlatePass(st, dst, src, keep, linear, residual = null) {
  const gl = st.gl;
  const prog = SoemGl.program(gl, "number-readout-burn-plate", SoemGl.GLSL_FULLSCREEN_VS, NODE_GRAPH_NUMBER_READOUT_PLATE_FS);
  if (!prog) return false;
  // 32F without OES_texture_float_linear cannot filter: copy nearest.
  linear = Boolean(linear && src.linear);
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, st.w, st.h);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  if (linear) nodeGraphNumberReadoutGlPlateTexParams(gl, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), st.w, st.h);
  gl.uniform1f(gl.getUniformLocation(prog, "uKeep"), keep);
  gl.uniform1f(gl.getUniformLocation(prog, "uResidual"), residual ? 1 : 0);
  gl.uniform1f(gl.getUniformLocation(prog, "uKeepFast"), residual ? residual.keepFast : 1);
  gl.uniform1f(gl.getUniformLocation(prog, "uKeepSlow"), residual ? residual.keepSlow : 1);
  gl.uniform1f(gl.getUniformLocation(prog, "uFrames"), residual ? residual.frames : 0);
  gl.uniform1f(gl.getUniformLocation(prog, "uFloor8"), dst.quantizeBits === 8 ? 1 : 0);
  SoemGl.drawQuad(gl, gl.getAttribLocation(prog, "aPos"));
  if (linear) nodeGraphNumberReadoutGlPlateTexParams(gl, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return true;
}

function nodeGraphNumberReadoutGlPlateEnsure(canvas, burnPlate) {
  if (!canvas || !burnPlate || typeof nodeGraphSharedGlDevice !== "function" || typeof SoemGl === "undefined") {
    return null;
  }
  const dev = nodeGraphSharedGlDevice();
  const gl = dev?.gl;
  const w = burnPlate.width | 0;
  const h = burnPlate.height | 0;
  if (!gl || gl.isContextLost() || w < 1 || h < 1 || w > dev.canvas.width || h > dev.canvas.height) {
    return null;
  }
  let prev = canvas._numberReadoutGlPlate || null;
  if (prev && prev.gl !== gl) {
    // Context replaced: old objects are gone with it.
    prev = null;
    canvas._numberReadoutGlPlate = null;
  }
  if (prev && prev.w === w && prev.h === h) {
    return prev;
  }
  const read = nodeGraphNumberReadoutGlPlateTarget(gl, w, h);
  const write = read ? nodeGraphNumberReadoutGlPlateTarget(gl, w, h) : null;
  if (!read || !write) {
    nodeGraphNumberReadoutGlPlateDrop(gl, { read, write });
    return null;
  }
  const st = { gl, w, h, read, write };
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  if (prev) {
    // Resize: scale-preserve deposits (the 2D path's smoothed drawImage).
    nodeGraphNumberReadoutGlPlatePass(st, st.read, prev.read, 1, true);
    nodeGraphNumberReadoutGlPlateDrop(gl, prev);
  }
  canvas._numberReadoutGlPlate = st;
  return st;
}

// keeps: PhosphorResidual.residualKeeps(trail, ghost); frames: 60 fps frames
// elapsed (PhosphorResidual.stepFrames).
function nodeGraphNumberReadoutGlPlateFade(st, keeps, frames) {
  const gl = st.gl;
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  const residual = { keepFast: keeps.keepFast, keepSlow: Math.max(keeps.keepFast, keeps.keepSlow), frames };
  if (!nodeGraphNumberReadoutGlPlatePass(st, st.write, st.read, 1, false, residual)) return;
  const tmp = st.read;
  st.read = st.write;
  st.write = tmp;
  nodeGraphNumberReadoutPlateGlStats.fades += 1;
}

function nodeGraphNumberReadoutGlPlateClear(st) {
  if (!st?.gl || st.gl.isContextLost()) return;
  const gl = st.gl;
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  for (const t of [st.read, st.write]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


function nodeGraphNumberReadoutPresentBurnPlate(
  pen,
  host,
  burnPlate,
  gradientStops,
  peakHex,
) {
  if (!pen || !host || !burnPlate?.width || !burnPlate?.height) {
    return;
  }
  const stopsSig = Array.isArray(gradientStops)
    ? gradientStops.map((s) => `${s.t}:${s.color}`).join(",")
    : "";
  const lutKey = `${stopsSig}|${peakHex || ""}`;
  if (!host._numberReadoutGhostLut || host._numberReadoutGhostLutKey !== lutKey) {
    host._numberReadoutGhostLut = nodeGraphNumberReadoutGhostLut256(gradientStops, peakHex);
    host._numberReadoutGhostLutKey = lutKey;
  }
  // GPU plate only (shared picture device). No GL: black + logged once.
  if (nodeGraphNumberReadoutPresentBurnPlateGl(pen, host._numberReadoutGhostLut, lutKey, host._numberReadoutGlPlate || null)) {
    return;
  }
  if (typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(host, "Number readout burn tint GL unavailable");
  }
}


/**
 * Idle plate for Value LCD / Value LED / Pitch Detector.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} screenElement
 * @param {object|null} node
 * @param {boolean|{force?: boolean}} [options] force=true: intentional Stop wipe
 *   always paints (ignores residual-hold freeze).
 */
function paintNodeGraphNumberReadoutColdBoot(canvas, screenElement, node = null, options = null) {
  if (!canvas || !screenElement) {
    return false;
  }
  const force = options === true
    || (options && typeof options === "object" && options.force === true);
  // Never cold-boot while simulation is transport-paused (engine still up) —
  // that wiped Pitch Detector / Value LED residual on deselect + no-buffer.
  // Full Stop (no live node) is not freeze — Stop wipe must repaint idle plates.
  if (!force
    && typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen()) {
    return false;
  }
  // Drop residual energy + force next live draw to repaint fully.
  invalidateNodeGraphNumberReadoutPaintCache(canvas);
  const pixelRatio = Number(nodeGraphModuleScopeState?.backingPixelRatio)
    || Math.max(1, window.devicePixelRatio || 1);
  const isLcd = typeof nodeGraphNumberReadoutFaceStyleForNode === "function"
    && nodeGraphNumberReadoutFaceStyleForNode(node) === "lcd";
  if (!syncNodeGraphNumberReadoutCanvas(canvas, screenElement, pixelRatio, {
    screenSharp: false,
  })) {
    return false;
  }
  if (!(canvas.width > 0) || !(canvas.height > 0)) {
    return false;
  }
  const settings = nodeGraphNumberReadoutSettingsForNode(node);
  const bg = isLcd && typeof nodeGraphNumberReadoutLcdBgCss === "function"
    ? nodeGraphNumberReadoutLcdBgCss(settings)
    : nodeGraphFacePlateBackground(settings);
  if (isLcd) {
    nodeGraphNumberReadoutApplyLcdLightCutout(screenElement, canvas);
  } else {
    // Value LED: partial hole on face AND canvas (canvas is the dimmer punch target).
    for (const el of [screenElement, canvas].filter(Boolean)) {
      el.classList?.add?.("node-light-source");
      if (el.dataset) {
        el.dataset.lightSource = "screen";
        el.dataset.lightStrength = String(nodeGraphLedDisplayLightStrength);
      }
      if (typeof setNodeGraphLightStrength === "function") {
        setNodeGraphLightStrength(el, nodeGraphLedDisplayLightStrength);
      }
    }
  }
  nodeGraphFacePlateApplyCss(screenElement, bg);
  const pen = nodeGraphNumberReadoutGlBeginFace(canvas);
  if (!pen) {
    return false;
  }
  nodeGraphNumberReadoutGlPenRect(pen, 0, 0, canvas.width, canvas.height, nodeGraphNumberReadoutCssRgb(bg), 1);
  nodeGraphNumberReadoutGlEndFace(canvas, pen);
  // No unlit 88.88 grid — idle face is empty plate only.
  // Keep cache dirty (invalidate already did) so live samples always redraw.
  canvas._nodeGraphNumberReadoutText = null;
  return true;
}


function wipeNodeGraphNumberReadoutScreensToColdBoot() {
  if (typeof document === "undefined") {
    return;
  }
  for (const face of document.querySelectorAll(
    ".node-number-readout-face, .dsp-node.number-readout-layout .node-module-scope-window, .dsp-node.value-lcd-layout .node-module-scope-window, .node-value-lcd-face, .node-value-led-face, .node-pitch-detector-lcd",
  )) {
    let canvas = face.querySelector?.(":scope > .node-number-readout-canvas")
      || face.querySelector?.(".node-number-readout-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "node-number-readout-canvas node-display-canvas";
      canvas.setAttribute("aria-hidden", "true");
      face.appendChild(canvas);
    }
    const nodeId = face.dataset?.node || face.closest?.(".dsp-node")?.dataset?.node || "";
    const node = nodeId && typeof nodeGraphPatchNode === "function"
      ? nodeGraphPatchNode(nodeId)
      : null;
    // Intentional Stop / full wipe — always repaint idle plate.
    paintNodeGraphNumberReadoutColdBoot(canvas, face, node, { force: true });
  }
}


/**
 * Sync number-readout face canvas size.
 * @param {{ screenSharp?: boolean }} [options]
 *   screenSharp (Value LCD): buffer matches on-screen pixels so workspace
 *   zoom stays sharp (cheap vector text — not a phosphor energy FBO).
 *   Default false keeps layout×dpr fixed grid (Value LED residual path).
 */
function syncNodeGraphNumberReadoutCanvas(canvas, screenElement, pixelRatio, options = {}) {
  if (!canvas || !screenElement) {
    return false;
  }
  const screenSharp = Boolean(options?.screenSharp);
  let width;
  let height;
  if (screenSharp) {
    // On-screen size × devicePixelRatio — grows with workspace zoom so
    // DSEG stays sharp (same idea as 0D redraw, face-local text).
    const rect = typeof screenElement.getBoundingClientRect === "function"
      ? screenElement.getBoundingClientRect()
      : { width: 0, height: 0 };
    const dpr = Math.max(
      1,
      nodeGraphFiniteNumber(window.devicePixelRatio, nodeGraphFiniteNumber(pixelRatio, 1)),
    );
    let w = Math.max(1, Math.round((nodeGraphFiniteNumber(rect.width, 1)) * dpr));
    let h = Math.max(1, Math.round((nodeGraphFiniteNumber(rect.height, 1)) * dpr));
    const maxDim = 4096;
    if (w > maxDim || h > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    width = w;
    height = h;
    // Same 1px hysteresis as Value LED — drag/subpixel hops must not
    // assign canvas.width (browser wipe) while the LCD is paused.
    if (canvas.width >= 2 && canvas.height >= 2) {
      const dw = Math.abs(width - canvas.width);
      const dh = Math.abs(height - canvas.height);
      if (dw <= 1 && dh <= 1) {
        width = canvas.width;
        height = canvas.height;
      }
    }
    canvas.classList.add("node-number-readout-canvas-vector");
    canvas.style.imageRendering = "auto";
  } else {
    // Fixed layout×dpr grid for Value LED residual (no zoom balloon on energy).
    const size = nodeGraphModuleScopeFaceBackingSize(screenElement, pixelRatio);
    if (!size) {
      return false;
    }
    width = size.width;
    height = size.height;
    // Transient 0×0 / 1×1 layout (reflow, zoom frame) must not shrink the
    // residual buffer — keep the last good size so Ghost/Trail ink survives.
    if (
      (width < 2 || height < 2)
      && canvas.width >= 2
      && canvas.height >= 2
    ) {
      width = canvas.width;
      height = canvas.height;
    } else if (canvas.width >= 2 && canvas.height >= 2) {
      // 1px hysteresis: subpixel clientWidth round-trips were wiping residual.
      const dw = Math.abs(width - canvas.width);
      const dh = Math.abs(height - canvas.height);
      if (dw <= 1 && dh <= 1) {
        width = canvas.width;
        height = canvas.height;
      }
    }
    canvas.classList.remove("node-number-readout-canvas-vector");
    canvas.style.imageRendering = "";
  }
  if (canvas.width !== width || canvas.height !== height) {
    // Resizing the host canvas clears its pixels (browser). The face lives in
    // a GL target: scale it to the new size on the GPU and re-present, so
    // pause+move/resize does not blank the LCD.
    canvas.width = width;
    canvas.height = height;
    canvas._numberReadoutEnergyMask = null;
    if (canvas._numberReadoutGlFace) {
      const face = nodeGraphNumberReadoutGlFaceTarget(canvas);
      if (face) {
        nodeGraphNumberReadoutGlPresentFace(canvas, face);
      }
    }
  }
  if (canvas.style.width || canvas.style.height) {
    canvas.style.width = "";
    canvas.style.height = "";
  }
  return true;
}


function nodeGraphNumberReadoutEnergyMaskCanvas(canvas) {
  return nodeGraphPhosphorEnergyEnsureCanvas(
    canvas,
    "_numberReadoutEnergyMask",
    canvas?.width || 0,
    canvas?.height || 0,
  );
}


function nodeGraphNumberReadoutEnergyGl(canvas) {
  if (!canvas?.width || !canvas?.height) {
    return null;
  }
  if (typeof nodeGraphPhosphorEnergyGlEnsure !== "function") {
    return null;
  }
  return nodeGraphPhosphorEnergyGlEnsure(canvas, canvas.width, canvas.height, "_phosphorEnergyGl");
}


function nodeGraphNumberReadoutSafeDecimals(decimals) {
  // toFixed(NaN) throws RangeError and can take down the rAF draw loop.
  const n = Math.round(Number(decimals));
  if (!Number.isFinite(n)) {
    return 2;
  }
  return Math.max(0, Math.min(8, n));
}

/**
 * Total digit budget (whole + fractional) for limit_decimals / fixed bins.
 * Matches normalize / form clamp: 1…12.
 */
function nodeGraphNumberReadoutSafeDigits(digits) {
  const n = Math.round(Number(digits));
  if (!Number.isFinite(n)) {
    return 8;
  }
  return Math.max(1, Math.min(12, n));
}


/**
 * Plain decimal string for limit_decimals (never scientific notation).
 * limit_decimals only parses whole.fraction — "1e-7" would become "1".
 */
function nodeGraphNumberReadoutPlainDecimalSource(value) {
  // Prefer shared helper from slider-metadata (same B-061 expansion).
  if (typeof nodeSliderPlainDecimalSource === "function") {
    return nodeSliderPlainDecimalSource(value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "0";
  }
  if (n === 0) {
    return "0";
  }
  const raw = String(n);
  if (!/[eE]/.test(raw)) {
    return raw;
  }
  try {
    return n.toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: 20,
    });
  } catch {
    // Last resort: enough fractional places for a 12-digit budget.
    try {
      return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "") || "0";
    } catch {
      return "0";
    }
  }
}

/**
 * Resolve showMinus / showPlus (+ reserve) from Value LED/LCD settings.
 * Migrates legacy polarity: bipolar => showMinus only (old minus gutter, no plus).
 */
function nodeGraphNumberReadoutSignOptions(settings = null) {
  const src = settings && typeof settings === "object" ? settings : {};
  let showMinus;
  let showPlus;
  if (Object.hasOwn(src, "showMinus") || Object.hasOwn(src, "showPlus")) {
    showMinus = Boolean(src.showMinus);
    showPlus = Boolean(src.showPlus);
  } else {
    const raw = String(src.polarity || src.signMode || "").trim().toLowerCase();
    if (raw === "unipolar" || raw === "uni" || raw === "unsigned"
      || raw === "absolute" || raw === "abs") {
      showMinus = false;
      showPlus = false;
    } else {
      // Missing / bipolar / unknown: Show - on (fresh default + old bipolar).
      showMinus = true;
      showPlus = false;
    }
  }
  return {
    showMinus,
    showPlus,
    reserveSignSpace: showMinus || showPlus,
  };
}

/**
 * Format a sample for Value LED / Value LCD digits.
 * Uses limit_decimals for digit/decimal economy (max digits, min/max places).
 *
 * @param {number} sample
 * @param {number} decimals max (and min when fixed) fractional places
 * @param {{
 *   guardExtraPlace?: boolean,
 *   digits?: number,
 *   maxDigits?: number,
 *   minDecimals?: number,
 *   maxDecimals?: number,
 *   removeTrailingZeros?: boolean,
 *   reserveSignSpace?: boolean,
 * }} [options]
 *   guardExtraPlace (LCD): round with one offscreen place (decimals+1) first so
 *   the displayed value (and sign) is not wildly flipped by sub-display noise.
 *   Also collapses signed zero ("-0.00") to unsigned zero after that round.
 *   digits / maxDigits: total digit budget for limit_decimals (default 8).
 */
function nodeGraphNumberReadoutFormatValue(sample, decimals, options = null) {
  const rawValue = Number(sample);
  if (!Number.isFinite(rawValue)) {
    return "--";
  }
  // Resolve sign flags early so we can abs before any decimal string is built.
  const hasShowFlags = Boolean(
    options
    && (Object.hasOwn(options, "showMinus") || Object.hasOwn(options, "showPlus")),
  );
  const showMinusEarly = hasShowFlags ? options.showMinus === true : true;
  // When Show - is off, format |sample| so a minus never appears in the digit string.
  const value = showMinusEarly ? rawValue : Math.abs(rawValue);
  const places = nodeGraphNumberReadoutSafeDecimals(decimals);
  const maxDigits = nodeGraphNumberReadoutSafeDigits(
    options?.digits ?? options?.maxDigits ?? 8,
  );
  const minDecimals = options?.minDecimals != null
    ? nodeGraphNumberReadoutSafeDecimals(options.minDecimals)
    : places;
  const maxDecimals = options?.maxDecimals != null
    ? nodeGraphNumberReadoutSafeDecimals(options.maxDecimals)
    : places;
  const removeTrailingZeros = Boolean(options?.removeTrailingZeros);
  // LCD: one extra place of rounding before the visible budget (offscreen).
  const guardExtra = Boolean(options && options.guardExtraPlace);
  const guardPlaces = guardExtra
    ? Math.min(8, Math.max(places, maxDecimals) + 1)
    : places;
  let valueForFormat = value;
  if (guardPlaces > places) {
    const scale = 10 ** guardPlaces;
    // Math.round keeps sign of half-away-from-zero; fine for display settle.
    valueForFormat = Math.round(value * scale) / scale;
  }
  let fixed;
  if (typeof limit_decimals === "function") {
    // Specialized economy: maxDigits total, min/max decimal places in one pass.
    const source = nodeGraphNumberReadoutPlainDecimalSource(valueForFormat);
    try {
      fixed = limit_decimals(
        source,
        maxDigits,
        minDecimals,
        maxDecimals,
        removeTrailingZeros,
        false,
      );
    } catch {
      fixed = null;
    }
  }
  if (fixed == null || fixed === "") {
    try {
      fixed = valueForFormat.toFixed(places);
    } catch {
      fixed = valueForFormat.toFixed(2);
    }
  }
  // After guard + format, tiny negatives can still print as "-0.00".
  // Treat exact display-zero as unsigned so the sign column stays calm.
  if (fixed.startsWith("-") && Number(fixed) === 0) {
    if (typeof limit_decimals === "function") {
      fixed = limit_decimals("0", maxDigits, minDecimals, maxDecimals, removeTrailingZeros, false)
        || (0).toFixed(places);
    } else {
      fixed = (0).toFixed(places);
    }
  }
  // Sign column: showMinus / showPlus (DSEG space = colon advance).
  // Neither => no gutter (centered digits). Either => reserve so digits do not jump.
  // hasShowFlags / showMinusEarly already resolved above (abs path).
  const showMinus = showMinusEarly;
  const showPlus = hasShowFlags ? options.showPlus === true : false;
  let reserve;
  if (options == null) {
    reserve = true;
  } else if (hasShowFlags) {
    reserve = showMinus || showPlus;
  } else if (options.reserveSignSpace === false) {
    reserve = false;
  } else {
    reserve = true;
  }
  const neg = fixed.startsWith("-");
  const body = neg ? fixed.slice(1) : fixed;
  if (neg && showMinus) {
    return `-${body}`;
  }
  if (!neg && showPlus) {
    return `+${body}`;
  }
  if (reserve) {
    return ` ${body}`;
  }
  return body;
}


function nodeGraphNumberReadoutDsegWidthChars(text) {
  return Math.max(1, String(text || "").replace(/\./g, "").length);
}

/**
 * Fixed DSEG fit template when GROW is off (decimalBudget true).
 * Font size locks to Digits+Decimals bins — live value still drawn centered
 * at that cell size. (DSEG period is zero-width; "8"/"!" measure full cells.)
 *
 * @param {number} decimals fractional places
 * @param {number} digits total digit budget (whole + fractional)
 */
function nodeGraphNumberReadoutBudgetFitText(decimals, digits = 8, options = null) {
  const total = nodeGraphNumberReadoutSafeDigits(digits);
  const d = Math.min(nodeGraphNumberReadoutSafeDecimals(decimals), Math.max(0, total - 1));
  const ints = Math.max(1, total - d);
  const frac = d > 0 ? `.${"!".repeat(d)}` : "";
  let reserve;
  if (options == null) {
    reserve = true; // legacy callers: keep sign cell in the fit template
  } else if (options.reserveSignSpace === false) {
    reserve = false;
  } else if (options.reserveSignSpace === true
    || options.showMinus === true
    || options.showPlus === true) {
    reserve = true;
  } else {
    reserve = false;
  }
  return `${reserve ? " " : ""}${"8".repeat(ints)}${frac}`;
}

/**
 * Face padding −0.5…1 from settings (finite-safe; 0 is valid).
 * 0 = no inset (content box = plate). Positive = inset toward pin.
 * Negative = enlarge digit fit box (numbers grow toward / past walls; plate clips).
 * Prefer facePadding; accept legacy readout/digit padding aliases.
 */
function nodeGraphNumberReadoutFacePadding01(settings = null) {
  const raw = settings == null
    ? NaN
    : Number(
      settings.facePadding
      ?? settings.readoutPadding
      ?? settings.digitPadding
      ?? settings.padding,
    );
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return clampNodeSliderValue(raw, -0.5, 1);
}

/**
 * Width-fit string for layout.
 * UI GROW maps to !decimalBudget (see form I/O):
 * - GROW on  (decimalBudget false) → live valueText (resize as digits change)
 * - GROW off (decimalBudget true)  → fixed Digits+Decimals bin template
 *
 * Never bypass budget when GROW is off — even at facePadding 0 (old pad≈0
 * shortcut always returned live text and ignored GROW off).
 */
function nodeGraphNumberReadoutUsesDigitBins(settings = null) {
  if (!settings) {
    return true;
  }
  if (Object.hasOwn(settings, "digitBins")) {
    return Boolean(settings.digitBins);
  }
  return settings.digitBins !== false;
}

function nodeGraphNumberReadoutUsesFixedBudget(settings = null) {
  if (!settings) {
    return true;
  }
  return Boolean(settings.decimalBudget) || nodeGraphNumberReadoutUsesDigitBins(settings);
}

/**
 * Right-align a formatted reading into fixed Digits+Decimals bins.
 * Unused integer bins are spaces (ghost 8s), not zeros — like a real meter.
 */
function nodeGraphNumberReadoutPadValueToBins(valueText, digits, decimals, options = null) {
  const total = nodeGraphNumberReadoutSafeDigits(digits);
  const d = Math.min(nodeGraphNumberReadoutSafeDecimals(decimals), Math.max(0, total - 1));
  const ints = Math.max(1, total - d);
  const showMinus = options?.showMinus === true;
  const showPlus = options?.showPlus === true;
  let reserveSign;
  if (options == null) {
    reserveSign = true;
  } else if (Object.hasOwn(options, "showMinus") || Object.hasOwn(options, "showPlus")) {
    reserveSign = showMinus || showPlus;
  } else if (options.reserveSignSpace === false) {
    reserveSign = false;
  } else {
    reserveSign = options.reserveSignSpace !== false;
  }
  let raw = String(valueText ?? "");
  if (/^[!.\s—–-]+$/.test(raw.trim())) {
    const frac = d > 0 ? `.${"!".repeat(d)}` : "";
    return `${reserveSign ? " " : ""}${"!".repeat(ints)}${frac}`;
  }
  let inSign = "";
  if (raw.startsWith("-") || raw.startsWith("+") || raw.startsWith(" ")) {
    inSign = raw[0];
    raw = raw.slice(1);
  }
  const dot = raw.indexOf(".");
  let intPart = dot >= 0 ? raw.slice(0, dot) : raw;
  let fracPart = dot >= 0 ? raw.slice(dot + 1) : "";
  intPart = String(intPart || "0").replace(/\D/g, "") || "0";
  if (intPart.length > ints) {
    intPart = intPart.slice(-ints);
  } else {
    intPart = intPart.padStart(ints, " ");
  }
  if (d > 0) {
    const padZeros = options?.removeTrailingZeros !== true;
    fracPart = String(fracPart || "").replace(/\D/g, "");
    fracPart = padZeros ? fracPart.padEnd(d, "0").slice(0, d) : fracPart.slice(0, d).padEnd(d, " ");
  } else {
    fracPart = "";
  }
  const body = d > 0 ? `${intPart}.${fracPart}` : intPart;
  // Preserve FormatValue's already-chosen sign glyph when present.
  let outSign = "";
  if (inSign === "-" || inSign === "+" || inSign === " ") {
    outSign = reserveSign || inSign === "-" || inSign === "+" ? inSign : "";
    if (!reserveSign && (inSign === " ")) outSign = "";
  } else if (reserveSign) {
    outSign = " ";
  }
  return `${outSign}${body}`;
}


function nodeGraphNumberReadoutLayoutFitText(slot, valueText, decimals, settings = null) {
  const budgetOn = nodeGraphNumberReadoutUsesFixedBudget(settings);
  // GROW on and Digit bins off: fill plate to the live reading.
  if (!budgetOn) {
    return valueText;
  }
  // GROW off: lock font size to Digits + Decimals bins (limit_decimals economy).
  const digits = nodeGraphNumberReadoutSafeDigits(
    settings?.digits
    ?? settings?.maxDigits
    ?? (slot?.type === "helmholtzPitch" ? 6 : 8),
  );
  const signOpts = typeof nodeGraphNumberReadoutSignOptions === "function"
    ? nodeGraphNumberReadoutSignOptions(settings)
    : { reserveSignSpace: true };
  return nodeGraphNumberReadoutBudgetFitText(decimals, digits, signOpts);
}


function nodeGraphNumberReadoutGhostPlateText(valueText) {
  // Digits and unused bins ghost as a full 8. Sign cell is the minus bar
  // (space / plus reserve the same DSEG middle-bar ghost).
  let s = String(valueText || "");
  const sign = (s.startsWith("-") || s.startsWith(" ") || s.startsWith("+")) ? s[0] : "";
  const rest = sign ? s.slice(1) : s;
  const ghostRest = rest.replace(/[0-9! ]/g, "8");
  if (sign === " " || sign === "+") {
    return `-${ghostRest}`;
  }
  return `${sign}${ghostRest}`;
}


function nodeGraphNumberReadoutUnitForSlot(slot) {
  // Pitch Detector: "Hz" is a fixed DOM decoration on the Fid row (not LCD unit band).
  if (slot?.type === "helmholtzPitch") {
    return "";
  }
  const connection = nodeGraphModuleScopeConnectionsTo(slot?.nodeId, "In")
    .find((candidate) => candidate?.sourceNode && candidate?.sourcePort);
  if (!connection) {
    return "";
  }
  // Standalone Value LED/LCD reading Pitch Frequency may still show Hz under digits.
  const sourceNode = nodeGraphPatchNode(connection.sourceNode);
  return sourceNode?.type === "helmholtzPitch" && connection.sourcePort === "Frequency"
    ? "Hz"
    : "";
}


function nodeGraphNumberReadoutSettingsSignature(settings) {
  const stopsSig = Array.isArray(settings.gradientStops)
    ? settings.gradientStops.map((s) => `${s.t}:${s.color}`).join(",")
    : "";
  return [
    settings.faceStyle || "led",
    settings.background,
    settings.brightness,
    settings.ghost ?? settings.ghostBrightness,
    settings.color,
    settings.trail ?? settings.residual,
    settings.burnAmount,
    settings.digits,
    settings.decimals,
    settings.decimalBudget ? 1 : 0,
    settings.digitBins === false ? 0 : 1,
    settings.lightBlend,
    settings.ghostBlend,
    settings.facePadding,
    settings.showMinus ? 1 : 0,
    settings.showPlus ? 1 : 0,
    settings.backgroundBrightness,
    settings.backgroundSaturation,
    settings.dot1Saturation ?? settings.colorSaturation,
    settings.unlitSegments,
    settings.innerShadowDistance,
    settings.innerShadowSharpness,
    settings.innerShadowOffsetX,
    settings.innerShadowOffsetY,
    settings.centsBand,
    stopsSig,
  ].join("|");
}

/** 8ve-page cents stripes: red…blue…red. Index 4 = in tune (0–10¢). */
const NODE_GRAPH_PITCH_CENTS_BAND_RGB = Object.freeze([
  Object.freeze([220, 48, 40]),
  Object.freeze([240, 140, 20]),
  Object.freeze([236, 210, 36]),
  Object.freeze([56, 176, 72]),
  Object.freeze([36, 120, 230]),
  Object.freeze([56, 176, 72]),
  Object.freeze([236, 210, 36]),
  Object.freeze([240, 140, 20]),
  Object.freeze([220, 48, 40]),
]);

function nodeGraphPitchCentsBandIndex(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) {
    return -1;
  }
  const abs = Math.abs(n);
  if (abs <= 10) return 4;
  if (abs <= 20) return n < 0 ? 3 : 5;
  if (abs <= 30) return n < 0 ? 2 : 6;
  if (abs <= 40) return n < 0 ? 1 : 7;
  return n < 0 ? 0 : 8;
}

function nodeGraphPitchDetectorDrawCentsBands(pen, left, top, width, height, cents, brightness) {
  const b = clampNodeSliderValue(nodeGraphFiniteNumber(brightness), 0, 1);
  if (!pen || !(width > 0) || !(height > 0) || b <= 0.0005) {
    return;
  }
  const n = NODE_GRAPH_PITCH_CENTS_BAND_RGB.length;
  const bandW = width / n;
  const hi = nodeGraphPitchCentsBandIndex(cents);
  for (let i = 0; i < n; i += 1) {
    const alpha = i === hi ? b : b * 0.2;
    nodeGraphNumberReadoutGlPenRect(pen, left + i * bandW, top, bandW + 0.75, height, NODE_GRAPH_PITCH_CENTS_BAND_RGB[i], alpha);
  }
}


/** Workspace zoom used by Value LED/LCD pin sizing (1.00 = identity). */
function nodeGraphNumberReadoutWorkspaceZoom() {
  return Math.max(
    0.01,
    nodeGraphFiniteNumber(
      typeof nodeGraphZoom === "function"
        ? nodeGraphZoom()
        : (typeof nodeGraphMvp !== "undefined" && nodeGraphMvp && nodeGraphMvp.zoom),
      1,
    ),
  );
}

/**
 * Single “display pixel” size in face/canvas units when padding = 1.
 * LCD (screen-sharp buffer, 1 canvas px ≈ 1 device px):
 *   size = round(zoom) → 1 monitor pixel at zoom 1.00; scales with zoom.
 * LED (layout×dpr buffer, CSS-scaled under zoom):
 *   ~1 CSS px of phosphor at zoom 1 (round dpr canvas px).
 */
function nodeGraphNumberReadoutPinSizePx(faceStyle, pixelRatio, zoom = 1) {
  const style = String(faceStyle || "led").toLowerCase();
  const z = Math.max(0.01, nodeGraphFiniteNumber(zoom, 1));
  if (style === "lcd") {
    // Hard square on the device pixel grid; grows with workspace zoom.
    return Math.max(1, Math.round(z));
  }
  const dpr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, 1));
  return Math.max(1, Math.round(dpr));
}

/**
 * @param {boolean|object} [hasUnitOrOpts] true, or
 *   { hasUnit, largeUnit, padding01, faceStyle, pixelRatio, zoom, fitText }
 *   largeUnit: taller unit band (legacy unit strip).
 *   fitText: optional fixed template for width fit (e.g. pitch: sign+5+decimals).
 *     When set, font size does not change with the live value digit count —
 *     actual valueText is still centered with that fixed cell size.
 *   monoProbe: when true, cell width is measured from "M" (true monospace pitch names).
 *   padding01: linear −0.5…1 vs half of each axis.
 *     0 = no inset (content box = full plate);
 *     +1 = one pin pixel remains;
 *     negative = enlarge fit box (digits grow toward walls; plate clips).
 */
// Layout is a pure function of its inputs + font load state. Setting
// context.font on a canvas in the document resolves style each time, so the
// per-frame readout paint re-used to force a style recalc; memoise it.
const nodeGraphNumberReadoutLayoutCache = new Map();

function nodeGraphNumberReadoutComputeLayout(context, valueText, fontFamily, faceW, faceH, hasUnitOrOpts) {
  const o = hasUnitOrOpts && typeof hasUnitOrOpts === "object" ? hasUnitOrOpts : { hasUnit: Boolean(hasUnitOrOpts) };
  const fonts = typeof document !== "undefined" ? document.fonts : null;
  const key = [
    fontFamily, faceW, faceH, o.hasUnit ? 1 : 0, o.largeUnit ? 1 : 0, o.monoProbe ? 1 : 0,
    o.padding01, o.faceStyle, o.pixelRatio, o.zoom,
    nodeGraphNumberReadoutDsegWidthChars(o.fitText != null ? String(o.fitText) : String(valueText || "")),
    nodeGraphNumberReadoutDsegWidthChars(valueText),
    fonts ? `${fonts.status}:${fonts.size}` : "",
  ].join("|");
  const hit = nodeGraphNumberReadoutLayoutCache.get(key);
  if (hit) {
    return { ...hit };
  }
  const layout = nodeGraphNumberReadoutComputeLayoutUncached(context, valueText, fontFamily, faceW, faceH, hasUnitOrOpts);
  if (nodeGraphNumberReadoutLayoutCache.size > 512) {
    nodeGraphNumberReadoutLayoutCache.clear();
  }
  nodeGraphNumberReadoutLayoutCache.set(key, { ...layout });
  return layout;
}

function nodeGraphNumberReadoutComputeLayoutUncached(context, valueText, fontFamily, faceW, faceH, hasUnitOrOpts) {
  const opts = hasUnitOrOpts && typeof hasUnitOrOpts === "object"
    ? hasUnitOrOpts
    : { hasUnit: Boolean(hasUnitOrOpts) };
  const hasUnit = Boolean(opts.hasUnit);
  const largeUnit = Boolean(opts.largeUnit);
  const monoProbe = Boolean(opts.monoProbe);
  const padRaw = Number(opts.padding01);
  const pad01 = Number.isFinite(padRaw)
    ? clampNodeSliderValue(padRaw, -0.5, 1)
    : 0;
  const fitText = opts.fitText != null ? String(opts.fitText) : String(valueText || "");
  // Pitch note names: always measure cells from a full mono advance (not DSEG "8").
  const cellProbeGlyph = monoProbe ? "M" : "8";
  const minSide = Math.max(0, Math.min(faceW, faceH));
  const pin = Math.min(
    minSide,
    nodeGraphNumberReadoutPinSizePx(opts.faceStyle, opts.pixelRatio, opts.zoom),
  );
  // Linear pad only: inset = pad01 × half-axis. Negative enlarges content for fit.
  const maxPadX = Math.max(0, (faceW - pin) * 0.5);
  const maxPadY = Math.max(0, (faceH - pin) * 0.5);
  const padPx = pad01 * maxPadX;
  const padPxY = pad01 * maxPadY;
  const contentW = Math.max(pin, faceW - padPx * 2);
  const contentH = Math.max(pin, faceH - padPxY * 2);
  // Near-max *positive* padding only: single pin pixel mode (no DSEG fit).
  const pixelPin = pad01 >= 0.999
    || (pad01 > 0 && contentW <= pin * 1.01 && contentH <= pin * 1.01);
  if (pixelPin) {
    const side = Math.max(1, pin);
    return {
      cellW: side,
      cells: 1,
      contentH: side,
      contentW: side,
      digitAreaH: side,
      fontSize: 0,
      labelH: 0,
      largeUnit,
      padPx: Math.max(0, (faceW - side) * 0.5),
      padPxY: Math.max(0, (faceH - side) * 0.5),
      pinPx: side,
      pixelPin: true,
      totalW: side,
    };
  }
  // Default unit strip ~18% of content; Pitch Hz needs more room to read.
  const labelH = hasUnit ? Math.max(0, contentH * (largeUnit ? 0.30 : 0.18)) : 0;
  const digitAreaH = Math.max(0, contentH - labelH);
  // Contain-fit only (no cover/explode). Padding is a pure linear inset/outset
  // of the content box; digits/decimals/GROW only choose fitText width.
  // Mild DSEG ink-of-em oversize (~80%) — not a special pad=0 path.
  const DSEG_INK_OF_EM = 0.80;
  const fitCells = nodeGraphNumberReadoutDsegWidthChars(fitText);
  const cells = nodeGraphNumberReadoutDsegWidthChars(valueText);
  if (!(contentW > 0.25) || !(digitAreaH > 0.25) || fitCells < 1) {
    // Fall through to pin rather than blank.
    const side = Math.max(1, pin);
    return {
      cellW: side,
      cells: 1,
      contentH: side,
      contentW: side,
      digitAreaH: side,
      fontSize: 0,
      labelH: 0,
      largeUnit,
      padPx: Math.max(0, (faceW - side) * 0.5),
      padPxY: Math.max(0, (faceH - side) * 0.5),
      pinPx: side,
      pixelPin: true,
      totalW: side,
    };
  }

  // Contain-fit: max font that fits BOTH height and width of the fit string.
  const REF = 100;
  // Atlas-baked glyph metrics (no 2D context in the face path).
  const probe0 = nodeGraphNumberReadoutGlyphMetrics(fontFamily, REF, cellProbeGlyph);
  const ascent0 = Number(probe0.actualBoundingBoxAscent);
  const descent0 = Number(probe0.actualBoundingBoxDescent);
  const glyphH0 = Number.isFinite(ascent0) && Number.isFinite(descent0) && (ascent0 + descent0) > 0.25
    ? (ascent0 + descent0)
    : REF * DSEG_INK_OF_EM;
  const cellW0 = Math.max(0.01, Number(probe0.width) || REF * 0.55);
  // Prefer ink-of-em when browser reports a loose em box (common for DSEG).
  const inkH0 = Math.min(glyphH0, REF * DSEG_INK_OF_EM);
  const fontFromH = digitAreaH / Math.max(1e-6, inkH0 / REF);
  const fontFromW = contentW / Math.max(1e-6, (fitCells * cellW0) / REF);
  let fontSize = Math.max(0, Math.min(fontFromH, fontFromW));
  if (!(fontSize > 0.25)) {
    const side = Math.max(1, pin);
    return {
      cellW: side,
      cells: 1,
      contentH: side,
      contentW: side,
      digitAreaH: side,
      fontSize: 0,
      labelH: 0,
      largeUnit,
      padPx: Math.max(0, (faceW - side) * 0.5),
      padPxY: Math.max(0, (faceH - side) * 0.5),
      pinPx: side,
      pixelPin: true,
      totalW: side,
    };
  }
  const probe = nodeGraphNumberReadoutGlyphMetrics(fontFamily, fontSize, cellProbeGlyph);
  const ascent = Number(probe.actualBoundingBoxAscent);
  const descent = Number(probe.actualBoundingBoxDescent);
  const glyphH = Number.isFinite(ascent) && Number.isFinite(descent) && (ascent + descent) > 0.25
    ? (ascent + descent)
    : 0;
  // Only shrink when ink truly overflows the content box.
  if (glyphH > digitAreaH + 0.5) {
    fontSize = Math.max(0, fontSize * (digitAreaH / glyphH));
  }
  let cellW = Math.max(0, nodeGraphNumberReadoutGlyphMetrics(fontFamily, fontSize, cellProbeGlyph).width);
  let fitW = fitCells * cellW;
  const maxW = contentW;
  if (fitW > maxW + 0.5 && fitW > 0) {
    const scale = maxW / fitW;
    fontSize = Math.max(0, fontSize * scale);
    if (fontSize > 0.25) {
      cellW = Math.max(0, nodeGraphNumberReadoutGlyphMetrics(fontFamily, fontSize, cellProbeGlyph).width);
      fitW = fitCells * cellW;
    } else {
      const side = Math.max(1, pin);
      return {
        cellW: side,
        cells: 1,
        contentH: side,
        contentW: side,
        digitAreaH: side,
        fontSize: 0,
        labelH: 0,
        largeUnit,
        padPx: Math.max(0, (faceW - side) * 0.5),
        padPxY: Math.max(0, (faceH - side) * 0.5),
        pinPx: side,
        pixelPin: true,
        totalW: side,
      };
    }
  }
  const totalW = cells * cellW;
  return {
    cellW,
    cells,
    contentH,
    contentW,
    digitAreaH,
    fontSize,
    labelH,
    largeUnit,
    padPx,
    padPxY,
    pinPx: pin,
    pixelPin: false,
    totalW,
  };
}

/**
 * Draw the max-padding “one pixel of display” pin (LED light or LCD ink).
 * Integer canvas rect → hard edge on the monitor pixel grid (scales with pinPx).
 */
function nodeGraphNumberReadoutDrawPixelPin(pen, layout, faceLeft, faceTop, faceW, faceH, rgb, alpha = 1) {
  if (!pen || !layout?.pixelPin) {
    return;
  }
  const side = Math.max(1, nodeGraphFiniteNumber(layout.pinPx, 1));
  const x = faceLeft + Math.max(0, (faceW - side) * 0.5);
  const y = faceTop + Math.max(0, (faceH - side) * 0.5);
  const a = clampNodeSliderValue(nodeGraphFiniteNumber(alpha), 0, 1);
  // Snap to integer canvas pixels so the pin is a crisp device-pixel square.
  const is = Math.max(1, Math.round(side));
  nodeGraphNumberReadoutGlPenRect(pen, Math.round(x), Math.round(y), is, is, [
    nodeGraphFiniteNumber(rgb?.[0]),
    nodeGraphFiniteNumber(rgb?.[1]),
    nodeGraphFiniteNumber(rgb?.[2]),
  ], a);
}

/** Unit label font size for the number plate (boosted for Pitch Detector Hz). */
function nodeGraphNumberReadoutUnitFontSize(labelHeight, width, digitFontSize, largeUnit = false) {
  if (largeUnit) {
    return Math.max(
      1,
      Math.min(labelHeight * 0.88, width * 0.32, digitFontSize * 0.72),
    );
  }
  return Math.max(1, Math.min(labelHeight * 0.7, width * 0.14, digitFontSize * 0.35));
}


function nodeGraphNumberReadoutGhostDepositText(previousText, currentText) {
  const prev = String(previousText || "");
  const curr = String(currentText || "");
  if (!prev) {
    return "";
  }
  if (!curr) {
    return prev;
  }
  const prevCells = nodeGraphNumberReadoutDsegWidthChars(prev);
  const currCells = nodeGraphNumberReadoutDsegWidthChars(curr);
  if (prevCells !== currCells) {
    // Width/layout changed — whole previous reading is the ghost.
    return prev;
  }
  // Walk both strings; periods are zero-width and stay only when they left.
  let i = 0;
  let j = 0;
  let out = "";
  let deposited = false;
  while (i < prev.length || j < curr.length) {
    const pc = i < prev.length ? prev[i] : "";
    const cc = j < curr.length ? curr[j] : "";
    if (pc === "." && cc === ".") {
      // Period still present — no deposit, no alignment token needed (zero advance).
      i += 1;
      j += 1;
      continue;
    }
    if (pc === ".") {
      // Period left this frame.
      out += ".";
      deposited = true;
      i += 1;
      continue;
    }
    if (cc === ".") {
      // Period appeared — skip on ghost string (no previous ink there).
      j += 1;
      continue;
    }
    if (!pc) {
      break;
    }
    if (!cc) {
      out += pc;
      deposited = true;
      i += 1;
      continue;
    }
    if (pc === cc) {
      // Unchanged cell: keep spacing, draw nothing.
      out += pc === " " ? " " : "!";
    } else {
      out += pc;
      deposited = true;
    }
    i += 1;
    j += 1;
  }
  return deposited ? out : "";
}


function nodeGraphNumberReadoutDrawDigits(pen, {
  text,
  centerX,
  centerY,
  fontFamily,
  fontSize,
  cellW: cellWIn,
  rgb,
  alpha,
  plate = false,
  // energy: force white ink (luma) for the 0-1 energy buffer
  energy = false,
}) {
  // GL glyphs from the shared atlas (textAlign center / textBaseline middle cells).
  const raw = String(text || "");
  if (!pen || !(fontSize > 0.25) || !raw) {
    return;
  }
  const ink = energy ? [255, 255, 255] : rgb;
  const atlas = nodeGraphNumberReadoutGlyphAtlas(pen.gl, fontFamily, fontSize, plate ? `${raw}8-` : raw);
  if (!atlas) {
    return;
  }
  const cellW = Math.max(1, Number(cellWIn) || nodeGraphNumberReadoutGlyphMetrics(fontFamily, fontSize, "8").width);
  let cellCount = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== ".") {
      cellCount += 1;
    }
  }
  cellCount = Math.max(1, cellCount);
  let penX = centerX - (cellCount * cellW) * 0.5 + cellW * 0.5;
  const a = Number(alpha);
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === ".") {
      // Zero advance: sit at the boundary between the previous and next cell.
      nodeGraphNumberReadoutGlPenGlyph(pen, atlas, ".", penX - cellW * 0.5, centerY, ink, a);
      continue;
    }
    let glyph = ch;
    if (plate) {
      // Unlit LCD grid: digits are all-on "8". Sign column is only the minus bar.
      glyph = (ch === "-" || ch === " ") ? "-" : "8";
    } else if (ch === " " || ch === "!") {
      // Empty sign column / all-off placeholder: keep spacing, draw nothing.
      penX += cellW;
      continue;
    }
    nodeGraphNumberReadoutGlPenGlyph(pen, atlas, glyph, penX, centerY, ink, a);
    penX += cellW;
  }
}





/**
 * Value LCD — vector DSEG redraw every frame.
 * Background + unlit “8” ghost + solid FG digits + glass. No phosphor hang.
 */
function drawNodeGraphValueLcdFace(canvas, pen, screenElement, settings, valueText, unit, slot = null, options = null) {
  if (!canvas || !pen) {
    return;
  }
  const now = performance.now?.() || Date.now();
  const left = 0;
  const top = 0;
  const width = canvas.width;
  const height = canvas.height;
  const bg = typeof nodeGraphNumberReadoutLcdBgCss === "function"
    ? nodeGraphNumberReadoutLcdBgCss(settings)
    : (settings?.background || "#b0b5a6");
  if (typeof nodeGraphFacePlateApplyCss === "function" && screenElement) {
    nodeGraphFacePlateApplyCss(screenElement, bg);
  }
  if (canvas?.parentElement?.dataset) {
    canvas.parentElement.dataset.valueFaceStyle = "lcd";
  }
  // Reflective LCD: less-dim room punch (2/3), not full phosphor hole / not 0.
  nodeGraphNumberReadoutApplyLcdLightCutout(
    screenElement || canvas?.parentElement,
    canvas,
  );
  const inkRgb = nodeGraphNumberReadoutLcdInkRgb(settings);
  const ghostRgb = nodeGraphNumberReadoutLcdGhostRgb(inkRgb, settings);
  const hasUnit = Boolean(unit);
  // Pitch Detector “Hz” (and any unit labeled Hz) gets a larger unit band.
  const largeUnit = hasUnit && String(unit).trim().toLowerCase() === "hz";
  const pad01 = nodeGraphNumberReadoutFacePadding01(settings);
  // Note names (C3 / C#3) need letter glyphs — DSEG digits only for Hz / MIDI #.
  const useNameFont = /[A-Ga-g#♭]/.test(String(valueText || ""));
  const digitFontFamily = useNameFont
    ? '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'
    : (nodeGraphNumberReadoutDsegReady
      ? '"DSEG7 Classic", "Consolas", monospace'
      : '"Consolas", "Courier New", monospace');
  const lcdPixelRatio = Number(nodeGraphModuleScopeState?.backingPixelRatio)
    || Math.max(1, window.devicePixelRatio || 1);
  const decimals = nodeGraphNumberReadoutSafeDecimals(settings?.decimals);
  const lcdFitText = nodeGraphNumberReadoutLayoutFitText(slot, valueText, decimals, settings);
  const layout = nodeGraphNumberReadoutComputeLayout(
    null,
    valueText,
    digitFontFamily,
    width,
    height,
    {
      hasUnit,
      largeUnit,
      padding01: pad01,
      faceStyle: "lcd",
      pixelRatio: lcdPixelRatio,
      zoom: 1,
      fitText: lcdFitText,
    },
  );
  const digitFontSize = layout.fontSize;
  const cellW = layout.cellW;
  const labelHeight = layout.labelH;
  const digitAreaHeight = layout.digitAreaH;
  const padPx = layout.padPx || 0;
  const padPxY = layout.padPxY != null ? layout.padPxY : padPx;
  const digitX = left + padPx + layout.contentW * 0.5;
  const digitY = top + padPxY + digitAreaHeight * 0.5;
  const unlitAmount = clampNodeSliderValue(nodeGraphFiniteNumber(settings?.unlitSegments), 0, 1);
  // Ghost plate alpha: continuous from 0 (no 0.12 pedestal — that made the
  // first slider tick a hard on/off pop). pow < 1 = more sensitivity near 0
  // so ~0.06 is a faint wash that eases in, not a binary flash.
  const ghostPlateAlpha = unlitAmount <= 0
    ? 0
    : Math.min(0.92, Math.pow(unlitAmount, 0.58));
  const shadowDist = clampNodeSliderValue(nodeGraphFiniteNumber(settings?.innerShadowDistance), 0, 1);
  const shadowSharp = clampNodeSliderValue(nodeGraphFiniteNumber(settings?.innerShadowSharpness), 0, 1);
  const shadowOffX = clampNodeSliderValue(nodeGraphFiniteNumber(settings?.innerShadowOffsetX), -1, 1);
  const shadowOffY = clampNodeSliderValue(nodeGraphFiniteNumber(settings?.innerShadowOffsetY), -1, 1);
  const text = unit ? `${valueText} ${unit}` : valueText;

  // Full repaint each frame (opaque plate) — no residual burn plate.
  nodeGraphNumberReadoutGlPenRect(pen, left, top, width, height, nodeGraphNumberReadoutLcdBgRgb(settings), 1);

  // 8ve page: cents-accuracy stripes behind the note-name text.
  const pitchMode = options && options.pitchMode;
  const centsOff = options && options.cents;
  const centsBand = clampNodeSliderValue(nodeGraphFiniteNumber(settings?.centsBand), 0, 1);
  if (slot?.type === "helmholtzPitch" && pitchMode === "name" && centsBand > 0.0005) {
    nodeGraphPitchDetectorDrawCentsBands(pen, left, top, width, height, centsOff, centsBand);
  }

  // Max padding: one screen pixel of LCD “on” (no DSEG at pin size).
  if (layout.pixelPin) {
    if (!String(valueText || "").includes("!")) {
      nodeGraphNumberReadoutDrawPixelPin(
        pen,
        layout,
        left,
        top,
        width,
        height,
        inkRgb,
        1,
      );
    }
  } else {
    if (digitFontSize > 0.25 && ghostPlateAlpha > 0.0005 && !String(valueText || "").includes("!")) {
      const plateText = typeof nodeGraphNumberReadoutGhostPlateText === "function"
        ? nodeGraphNumberReadoutGhostPlateText(valueText)
        : String(valueText || "").replace(/[0-9!]/g, "8");
      nodeGraphNumberReadoutDrawDigits(pen, {
        text: plateText,
        centerX: digitX,
        centerY: digitY,
        fontFamily: digitFontFamily,
        fontSize: digitFontSize,
        cellW,
        rgb: ghostRgb,
        alpha: ghostPlateAlpha,
        plate: true,
      });
    }
    if (digitFontSize > 0.25 && !String(valueText || "").includes("!")) {
      nodeGraphNumberReadoutDrawDigits(pen, {
        text: valueText,
        centerX: digitX,
        centerY: digitY,
        fontFamily: digitFontFamily,
        fontSize: digitFontSize,
        cellW,
        rgb: inkRgb,
        alpha: 1,
        plate: false,
      });
    }

    if (hasUnit && labelHeight > 0.25 && digitFontSize > 0.25) {
      const labelFontSize = nodeGraphNumberReadoutUnitFontSize(
        labelHeight,
        layout.contentW || width,
        digitFontSize,
        largeUnit,
      );
      nodeGraphNumberReadoutGlPenText(
        pen,
        unit,
        left + padPx + layout.contentW * 0.5,
        top + padPxY + digitAreaHeight + labelHeight * 0.5,
        NODE_GRAPH_NUMBER_READOUT_UNIT_FONT,
        labelFontSize,
        inkRgb,
        largeUnit ? 0.78 : 0.55,
      );
    }
  }

  if (shadowDist > 0.001) {
    nodeGraphNumberReadoutGlPenLcdInnerShadow(
      pen,
      left,
      top,
      width,
      height,
      shadowDist,
      shadowSharp,
      shadowOffX,
      shadowOffY,
    );
  }

  canvas._numberReadoutLastValueText = valueText;
  canvas._nodeGraphNumberReadoutText = text;
  canvas._nodeGraphNumberReadoutSettingsSig = nodeGraphNumberReadoutSettingsSignature(settings);
  canvas._nodeGraphNumberReadoutFontReady = nodeGraphNumberReadoutDsegReady;
  canvas._nodeGraphNumberReadoutWidth = width;
  canvas._nodeGraphNumberReadoutHeight = height;
  canvas._nodeGraphNumberReadoutZoom = 1;
  canvas._nodeGraphNumberReadoutPaintAt = now;
  canvas._numberReadoutResidualEnergy = 0;
  nodeGraphNumberReadoutClearBurnPlate(canvas);
}


function drawNodeGraphNumberReadoutItem(renderer, item, pixelRatio) {
  const rect = item?.scopeRect;
  const slot = item?.slot;
  if (!rect || !slot) {
    return;
  }
  // Display-hide SSOT: skip paint when face is hidden (local or global Displays off).
  if (typeof nodeGraphModuleDisplayVisibleForUi === "function"
    && typeof nodeGraphPatchNode === "function"
    && slot.nodeId) {
    const hostNode = nodeGraphPatchNode(slot.nodeId);
    if (hostNode && !nodeGraphModuleDisplayVisibleForUi(hostNode.type, hostNode.ui)) {
      return;
    }
  }
  renderNodeGraphModuleScopeAnalyzer(slot, item.buffer);
  const screenElement = item?.screenElement || slot?.scopeElement;
  const canvas = nodeGraphNumberReadoutCanvasForSlot(slot);
  const node = nodeGraphModuleScopeNodeForSlot(slot);
  const settings = nodeGraphNumberReadoutSettingsForNode(node);
  const faceStyle = nodeGraphNumberReadoutFaceStyleForSlot(slot, node);
  const isLcd = faceStyle === "lcd";
  // Value LCD: screen-sharp buffer (tracks zoom). Value LED: fixed layout grid.
  if (!canvas || !syncNodeGraphNumberReadoutCanvas(canvas, screenElement, pixelRatio, {
    screenSharp: false,
  })) {
    return;
  }
  const hasSample = item?.buffer?.length > 0 && !item.buffer?.nodeGraphScopeXy;
  const unit = nodeGraphNumberReadoutUnitForSlot(slot);
  // Honor Display Settings → Digits + Decimals (Pitch Detector Frequency LED too).
  const decimals = nodeGraphNumberReadoutSafeDecimals(settings.decimals);
  const digits = nodeGraphNumberReadoutSafeDigits(settings.digits);
  const signOpts = nodeGraphNumberReadoutSignOptions(settings);
  const formatOptions = {
    digits,
    removeTrailingZeros: Boolean(settings.removeTrailingZeros),
    showMinus: signOpts.showMinus,
    showPlus: signOpts.showPlus,
    reserveSignSpace: signOpts.reserveSignSpace,
    // Value LCD: settle on decimals+1 before visible budget (sign stability).
    ...(isLcd ? { guardExtraPlace: true } : null),
  };
  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();
  // Pitch Detector: unit toggle Hz → 8ve (MIDI #) → M (note name).
  const pitchFace = slot?.type === "helmholtzPitch"
    ? (screenElement?.closest?.(".node-pitch-detector-face")
      || document.querySelector?.(
        `.node-pitch-detector-face[data-node="${CSS.escape(String(slot.nodeId || ""))}"]`,
      ))
    : null;
  const pitchMode = pitchFace && typeof nodeGraphPitchDetectorFaceMode === "function"
    ? nodeGraphPitchDetectorFaceMode(pitchFace)
    : "hz";
  // Live format (may be empty/placeholder when paused, bypassed, or capture re-armed).
  // https://github.com/keshikan/DSEG#usage
  let liveValueText;
  if (slot?.type === "helmholtzPitch" && typeof nodeGraphPitchDetectorFormatDisplay === "function") {
    // Live: single DSEG "-" when no pitch / below threshold (not zeros / not em dash).
    // Frozen (speed 0): hold last good — never invent a wipe over a locked reading.
    if (frozen && !hasSample) {
      liveValueText = " !"; // placeholder → ResolveHeld keeps last good / no paint
    } else if (hasSample) {
      liveValueText = nodeGraphPitchDetectorFormatDisplay(
        nodeGraphOscilloscopeLatestSample(item.buffer, 0),
        pitchMode,
        decimals,
        { digits },
      );
      // While frozen, dash = no detection this sample; do not paint over held Hz.
      if (frozen && typeof nodeGraphPitchDetectorZeroDisplay === "function") {
        const zeroText = nodeGraphPitchDetectorZeroDisplay(pitchMode, decimals);
        if (String(liveValueText) === String(zeroText)) {
          liveValueText = " !";
        }
      }
    } else {
      liveValueText = typeof nodeGraphPitchDetectorZeroDisplay === "function"
        ? nodeGraphPitchDetectorZeroDisplay(pitchMode, decimals)
        : "-";
    }
  } else {
    liveValueText = hasSample
      ? nodeGraphNumberReadoutFormatValue(
        nodeGraphOscilloscopeLatestSample(item.buffer, 0),
        decimals,
        formatOptions,
      )
      : (decimals > 0
        ? `${formatOptions.reserveSignSpace ? " " : ""}!.${"!".repeat(decimals)}`
        : `${formatOptions.reserveSignSpace ? " " : ""}!`);
    if (nodeGraphNumberReadoutUsesDigitBins(settings)) {
      liveValueText = nodeGraphNumberReadoutPadValueToBins(
        liveValueText,
        digits,
        decimals,
        formatOptions,
      );
    }
  }
  // Hold last good reading — never paint empty "!" over a held phosphor face
  // (pause + wire connect / deselect was clearing Pitch Detector ghosts).
  // Pitch Detector live DSEG "-" is a real "no lock" glyph: paint it, don't hold.
  let valueText;
  if (
    slot?.type === "helmholtzPitch"
    && !frozen
    && typeof nodeGraphPitchDetectorZeroDisplay === "function"
    && String(liveValueText) === String(nodeGraphPitchDetectorZeroDisplay(pitchMode, decimals))
  ) {
    valueText = liveValueText;
  } else {
    valueText = nodeGraphNumberReadoutResolveHeldValueText(canvas, liveValueText, { frozen });
  }
  if (!valueText) {
    // Frozen with no held reading: leave pixels as-is (no kill).
    return;
  }
  // Frozen: if we would only re-present the same held digits, skip clearRect
  // so residual ink is not destroyed by a full plate wipe.
  if (frozen) {
    const heldSig = `${valueText}|${unit}|${pitchMode}`;
    if (canvas._nodeGraphNumberReadoutFrozenHoldSig === heldSig
      && canvas._nodeGraphNumberReadoutWidth === canvas.width
      && canvas._nodeGraphNumberReadoutHeight === canvas.height) {
      return;
    }
    canvas._nodeGraphNumberReadoutFrozenHoldSig = heldSig;
  } else {
    canvas._nodeGraphNumberReadoutFrozenHoldSig = null;
  }
  // Note names need letter glyphs (not DSEG-only).
  const pitchNameMode = slot?.type === "helmholtzPitch" && pitchMode === "name";
  const pitchHz = slot?.type === "helmholtzPitch" && hasSample
    ? nodeGraphOscilloscopeLatestSample(item.buffer, 0)
    : Number.NaN;
  const pitchCents = pitchNameMode && typeof nodeGraphFrequencyToCentsOff === "function"
    ? nodeGraphFrequencyToCentsOff(pitchHz)
    : Number.NaN;
  const text = `${valueText}${unit ? ` ${unit}` : ""}${pitchMode !== "hz" ? `|${pitchMode}` : ""}|¢${
    Number.isFinite(pitchCents) ? pitchCents.toFixed(1) : ""
  }`;
  // Value LCD: vector DSEG. Ghost/Trail still need a hang tick every frame
  // (previous digits fade). Skipping when text is unchanged froze ghosts.
  if (isLcd) {
    const settingsSig = nodeGraphNumberReadoutSettingsSignature(settings);
    const styleChanged =
      canvas._nodeGraphNumberReadoutSettingsSig !== settingsSig ||
      canvas._nodeGraphNumberReadoutFontReady !== nodeGraphNumberReadoutDsegReady ||
      canvas._nodeGraphNumberReadoutWidth !== canvas.width ||
      canvas._nodeGraphNumberReadoutHeight !== canvas.height;
    const textChanged = canvas._nodeGraphNumberReadoutText == null
      || canvas._nodeGraphNumberReadoutText !== text;
    if (!textChanged && !styleChanged) {
      // Still refresh the room-dimmer punch — pause→stop→play can leave the
      // canvas at strength 0 while the digit cache already matches.
      if (typeof nodeGraphNumberReadoutApplyLcdLightCutout === "function") {
        nodeGraphNumberReadoutApplyLcdLightCutout(screenElement, canvas);
      }
      return;
    }
    const lcdPen = nodeGraphNumberReadoutGlBeginFace(canvas);
    if (!lcdPen) {
      return;
    }
    drawNodeGraphValueLcdFace(canvas, lcdPen, screenElement, settings, valueText, unit, slot, {
      pitchMode,
      cents: pitchCents,
      frozen,
    });
    nodeGraphNumberReadoutGlEndFace(canvas, lcdPen);
    nodeGraphNumberReadoutRememberGoodValue(canvas, valueText);
    return;
  }

  // ── Value LED / phosphor residual path ──
  //  • Bright B → live digit light only (HBS). Independent of burn deposit.
  //  • Burn ⨯ 0…1 → energy stamped on digit change (Ghost Gradient stop t).
  //    0 = no print; 1 = energy 1 = stop t=1.0.
  //  • Ghost G → extreme analog (super-exp) hang (not brightness).
  //  • Trail T → linear residual blend (not brightness).
  //  • Freeze (pause / engine off): hold burn plate + last digits — no wipe.
  const trailHang = clampNodeSliderValue(
    nodeGraphFiniteNumber(settings.trail ?? settings.residual),
    0,
    1,
  );
  const ghostHang = clampNodeSliderValue(
    nodeGraphFiniteNumber(settings.ghost ?? settings.ghostBrightness),
    0,
    1,
  );
  const burnAmountHang = clampNodeSliderValue(
    nodeGraphFiniteNumber(settings.burnAmount, 1),
    0,
    1,
  );
  const settingsSig = nodeGraphNumberReadoutSettingsSignature(settings);
  const styleChanged =
    canvas._nodeGraphNumberReadoutSettingsSig !== settingsSig ||
    canvas._nodeGraphNumberReadoutFontReady !== nodeGraphNumberReadoutDsegReady ||
    canvas._nodeGraphNumberReadoutWidth !== canvas.width ||
    canvas._nodeGraphNumberReadoutHeight !== canvas.height;
  // null cache (engine-stop wipe) always forces a full present.
  const textChanged = canvas._nodeGraphNumberReadoutText == null
    || canvas._nodeGraphNumberReadoutText !== text;
  const now = performance.now?.() || Date.now();
  const previousValueText = String(canvas._numberReadoutLastValueText || "");

  // Bright B = live intensity only. Residual deposit energy is Burn ⨯ 0…1.
  const bright = Number.isFinite(Number(settings.brightness))
    ? clampNodeSliderValue(Number(settings.brightness), 0, 1)
    : 1;
  // Hang when Ghost/Trail on.
  const hangOn = trailHang > 0 || ghostHang > 0;

  const left = 0;
  const top = 0;
  const width = canvas.width;
  const height = canvas.height;
  // LED residual uses Ghost Gradient for deposit color.
  let gradientStops = Array.isArray(settings.gradientStops) && settings.gradientStops.length >= 2
    ? settings.gradientStops
    : null;
  if (!gradientStops && typeof nodeGraphPhosphorGradientStopsFromSettings === "function") {
    gradientStops = nodeGraphPhosphorGradientStopsFromSettings(
      settings,
      settings.color || nodeGraphNumberReadoutSettingsDefaults?.color || "#fcfdbf",
    );
  }
  if (gradientStops && typeof nodeGraphApplyGradientHueRotation === "function") {
    gradientStops = nodeGraphApplyGradientHueRotation(gradientStops, settings);
  }
  if (!gradientStops && typeof nodeGraphPhosphorDefaultGradientStops === "function") {
    gradientStops = nodeGraphPhosphorDefaultGradientStops(
      settings.color || "#fcfdbf",
      settings.background || "#000004",
    );
  }
  const peakHex = Array.isArray(gradientStops) && gradientStops.length
    ? (gradientStops[gradientStops.length - 1]?.color || "#fcfdbf")
    : (settings.color || "#fcfdbf");
  // Note names: monospace (compact C3 / C#3). Hz / MIDI # / no-lock "-" use DSEG.
  const digitFontFamily = pitchNameMode
    ? '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'
    : (nodeGraphNumberReadoutDsegReady
      ? '"DSEG7 Classic", "Consolas", monospace'
      : '"Consolas", "Courier New", monospace');
  const hasUnit = Boolean(unit);

  // Hang off → no residual. Size/font changes must NOT wipe the burn plate:
  // zoom/layout used to flip canvas dims by 1px and clear Ghost/Trail ink.
  // EnsureBurnPlate scale-preserves deposits across real resizes.
  if (!hangOn) {
    nodeGraphNumberReadoutClearBurnPlate(canvas);
  }

  const burnPlate = hangOn ? nodeGraphNumberReadoutEnsureBurnPlate(canvas) : null;
  // The plate lives on the GPU only. The 2D canvas is a stamp scratch for the
  // digit draw; no shared GL device = black + one console.error (no 2D plate).
  const plateGl = burnPlate && burnPlate.width > 0
    ? nodeGraphNumberReadoutGlPlateEnsure(canvas, burnPlate)
    : null;
  if (burnPlate && burnPlate.width > 0 && !plateGl && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "Number readout burn plate GL unavailable");
  }
  const burnOn = Boolean(plateGl);

  // 1) Fade deposit plate: shared time-based residual model (Trail = fast
  //    keep for bright energy, Ghost = slow tail for dim energy).
  if (burnOn && hangOn && !frozen && burnPlate.width > 0) {
    const keeps = PhosphorResidual.residualKeeps(trailHang, ghostHang);
    const frames = PhosphorResidual.stepFrames(plateGl);
    if (keeps.keepFast < 1 && frames > 0) {
      nodeGraphNumberReadoutGlPlateFade(plateGl, keeps, frames);
      // Upper bound of every plate texel: no texel keeps more than keepSlow.
      const keepMax = Math.max(keeps.keepFast, keeps.keepSlow);
      canvas._numberReadoutResidualEnergy = nodeGraphFiniteNumber(canvas._numberReadoutResidualEnergy) * Math.pow(keepMax, frames);
    }
    // Once no texel can move an 8-bit output pixel any more (below the
    // dither's reach, so not a visible floor), clear the plate and sleep.
    if (canvas._numberReadoutResidualEnergy * 255 < SoemGl.DITHER_INVISIBLE_LSB
      && canvas._numberReadoutResidualEnergy > 0) {
      nodeGraphNumberReadoutGlPlateClear(plateGl);
      canvas._numberReadoutResidualEnergy = 0;
    }
  } else if (plateGl) {
    // Paused: resume without fading the paused time.
    plateGl.residualStepMs = 0;
  }

  // 2) On change: stamp ONLY digits that changed (per-cell deposit).
  //    Deposit energy = Burn ⨯ (0 = skip print, 1 = Ghost Gradient stop t=1.0).
  //    Live LED still uses Bright. Ghost/Trail only set hang.
  //    MUST deposit when the reading is fully removed (empty / no-lock dash /
  //    threshold drop) — not only digit-to-digit edits. Without that, Pitch
  //    in/out of lock blinks live ink with no residual stamp.
  //    Geometry: prefer the last live layout snapshot so ghost matches the
  //    LED pixels 1:1 (recomputing pad/fit can be 1px larger).
  // Plate alpha is energy 0…1 → present LUT t (1.0 = last Ghost Gradient stop).
  const depositBright = burnAmountHang;
  if (
    burnOn
    && hangOn
    && !frozen
    && textChanged
    && previousValueText
    && previousValueText !== valueText
    && !nodeGraphNumberReadoutIsEmptyPlaceholder(previousValueText)
    && burnPlate.width > 0
    && depositBright > 0
  ) {
    // Empty / dash / skeleton current → deposit the whole previous reading.
    // GhostDepositText already returns prev when curr is empty or width shifts.
    const depositText = nodeGraphNumberReadoutGhostDepositText(
      previousValueText,
      // Treat no-lock / empty targets as full removal for deposit purposes.
      nodeGraphNumberReadoutIsEmptyPlaceholder(valueText) ? "" : valueText,
    );
    if (depositText) {
      const snap = canvas._numberReadoutLastDigitLayout;
      const snapOk = snap
        && snap.width === width
        && snap.height === height
        && Number(snap.fontSize) > 0.25
        && Number(snap.cellW) > 0;
      // Glyphs go straight into the GPU plate (premultiplied source-over).
      const depositPen = nodeGraphNumberReadoutGlPen(plateGl.gl, plateGl.read, plateGl.w, plateGl.h);
      // White energy at alpha = Burn ⨯ (0…1). Present maps that to Ghost Gradient t.
      if (snapOk && snap.pixelPin) {
        nodeGraphNumberReadoutDrawPixelPin(
          depositPen,
          {
            pixelPin: true,
            pinPx: snap.pinPx || snap.cellW,
          },
          left,
          top,
          width,
          height,
          [255, 255, 255],
          depositBright,
        );
      } else if (snapOk) {
        // Pixel-match the previous live LED draw (same font/cell/center).
        nodeGraphNumberReadoutDrawDigits(depositPen, {
          text: depositText,
          centerX: snap.digitX,
          centerY: snap.digitY,
          fontFamily: snap.fontFamily || digitFontFamily,
          fontSize: snap.fontSize,
          cellW: snap.cellW,
          rgb: [255, 255, 255],
          alpha: depositBright,
          plate: false,
          energy: true,
        });
      } else {
        // Cold first change: recompute with the same pad policy as live (no forced inset).
        const residualLargeUnit = hasUnit && String(unit || "").trim().toLowerCase() === "hz";
        const residualPad01 = nodeGraphNumberReadoutFacePadding01(settings);
        const residualFitText = nodeGraphNumberReadoutLayoutFitText(
          slot,
          previousValueText,
          decimals,
          settings,
        );
        const residualLayout = nodeGraphNumberReadoutComputeLayout(
          null,
          previousValueText,
          digitFontFamily,
          width,
          height,
          {
            hasUnit,
            largeUnit: residualLargeUnit,
            padding01: residualPad01,
            faceStyle: "led",
            pixelRatio,
            zoom: 1,
            fitText: residualFitText,
            monoProbe: pitchNameMode,
          },
        );
        const residualPad = residualLayout.padPx || 0;
        const residualPadY = residualLayout.padPxY != null ? residualLayout.padPxY : residualPad;
        if (residualLayout.pixelPin) {
          nodeGraphNumberReadoutDrawPixelPin(
            depositPen,
            residualLayout,
            left,
            top,
            width,
            height,
            [255, 255, 255],
            depositBright,
          );
        } else {
          nodeGraphNumberReadoutDrawDigits(depositPen, {
            text: depositText,
            centerX: left + residualPad + residualLayout.contentW * 0.5,
            centerY: top + residualPadY + residualLayout.digitAreaH * 0.5,
            fontFamily: digitFontFamily,
            fontSize: residualLayout.fontSize,
            cellW: residualLayout.cellW,
            rgb: [255, 255, 255],
            alpha: depositBright,
            plate: false,
            energy: true,
          });
        }
      }
      nodeGraphNumberReadoutGlPenFlush(depositPen);
      nodeGraphNumberReadoutPlateGlStats.stamps += 1;
      // Source-over stacking bound: a' = d + a (1 - d).
      const prevEnergy = nodeGraphFiniteNumber(canvas._numberReadoutResidualEnergy);
      canvas._numberReadoutResidualEnergy = depositBright + prevEnergy * (1 - depositBright);
      canvas._numberReadoutLastTextChangeAt = now;
    }
  }

  const depositEnergy = nodeGraphFiniteNumber(canvas._numberReadoutResidualEnergy);
  const depositActive = hangOn && depositEnergy > 0;
  // Hanging deposits need continuous present (no static Ghost floor).
  const needsContinuous = !frozen && depositActive;
  // Room dimmer punches the canvas (not only the face). Set BOTH + notify the
  // dimmer before any early-out — pause→stop→play can leave canvas at strength 0
  // while the digit cache already matches; dataset-only writes never schedule a
  // veil redraw, so faces stayed dark under the room dimmer.
  const punchN = Math.max(0.001, nodeGraphFiniteNumber(bright) * nodeGraphLedDisplayLightStrength);
  const punch = punchN.toFixed(3);
  const punchTargets = [canvas, canvas?.parentElement, screenElement].filter(Boolean);
  for (const el of punchTargets) {
    el.classList?.add?.("node-light-source");
    if (el.dataset) {
      el.dataset.lightSource = "screen";
      el.dataset.lightStrength = punch;
    }
    if (el === canvas?.parentElement || el === screenElement) {
      if (el.dataset) el.dataset.valueFaceStyle = "led";
    }
    if (typeof setNodeGraphLightStrength === "function") {
      setNodeGraphLightStrength(el, punchN);
    }
  }
  if (!textChanged && !styleChanged && !needsContinuous) {
    return;
  }

  // Live LED light RGB (black→hue→white from Bright). Residual stays gradient.
  const rgb = nodeGraphNumberReadoutLightRgb(settings);
  const bg = nodeGraphFacePlateBackground(settings);
  const alpha = 1;
  const pen = nodeGraphNumberReadoutGlBeginFace(canvas);
  if (!pen) {
    return;
  }

  const largeUnit = hasUnit && String(unit || "").trim().toLowerCase() === "hz";
  // User Padding 0 = flush to plate walls (no forced pitch/LCD inset).
  const pad01 = nodeGraphNumberReadoutFacePadding01(settings);
  // GROW off → LayoutFitText returns fixed Digits+Decimals bins; GROW on → live width.
  // Pitch name (M): always fit live compact name (no DSEG digit budget for letters).
  let liveFitText = nodeGraphNumberReadoutLayoutFitText(slot, valueText, decimals, settings);
  if (pitchNameMode) {
    liveFitText = String(valueText || "C#3");
  }
  const layout = nodeGraphNumberReadoutComputeLayout(
    null,
    valueText,
    digitFontFamily,
    width,
    height,
    {
      hasUnit,
      largeUnit,
      padding01: pad01,
      faceStyle: "led",
      pixelRatio,
      zoom: 1,
      fitText: liveFitText,
      monoProbe: pitchNameMode,
    },
  );
  const digitFontSize = layout.fontSize;
  const cellW = layout.cellW;
  const labelHeight = layout.labelH;
  const digitAreaHeight = layout.digitAreaH;
  const padPx = layout.padPx || 0;
  const padPxY = layout.padPxY != null ? layout.padPxY : padPx;
  // Center the live digit string in the content box (fixed cell size).
  const digitX = left + padPx + layout.contentW * 0.5;
  const digitY = top + padPxY + digitAreaHeight * 0.5;
  // Snapshot for next-frame residual deposit (must match these live pixels).
  canvas._numberReadoutLastDigitLayout = {
    width,
    height,
    digitX,
    digitY,
    fontSize: digitFontSize,
    cellW,
    fontFamily: digitFontFamily,
    padPx,
    padPxY,
    contentW: layout.contentW,
    digitAreaH: digitAreaHeight,
    pixelPin: Boolean(layout.pixelPin),
    pinPx: layout.pinPx || cellW,
  };

  // ── Present (Value LED) ──
  // Burn plate = previous digits, stamped only on change (step 2).
  // Live digits draw on the face, never onto the burn plate.
  const pitchNoLockGlyph = slot?.type === "helmholtzPitch"
    && typeof nodeGraphPitchDetectorZeroDisplay === "function"
    && String(valueText) === String(nodeGraphPitchDetectorZeroDisplay(pitchMode, decimals));
  const drawLiveDigits = alpha > 0
    && (pitchNoLockGlyph || !nodeGraphNumberReadoutIsEmptyPlaceholder(valueText));
  nodeGraphNumberReadoutGlPenRect(pen, left, top, width, height, nodeGraphNumberReadoutCssRgb(bg), 1);
  const ghostBlendAmt = clampNodeSliderValue(Number(settings.ghostBlend), 0, 1);
  if (ghostBlendAmt > 0.0005 && digitFontSize > 0.25 && !layout.pixelPin) {
    let stop0 = [0, 0, 4];
    if (typeof nodeGraphSampleGradientStopsRgb === "function") {
      const sampled = nodeGraphSampleGradientStopsRgb(gradientStops, 0, peakHex);
      if (Array.isArray(sampled) && sampled.length >= 3) {
        stop0 = sampled;
      }
    }
    const eight = typeof nodeGraphNumberReadoutGhostPlateText === "function"
      ? nodeGraphNumberReadoutGhostPlateText(valueText)
      : String(valueText || "").replace(/[0-9!]/g, "8");
    nodeGraphNumberReadoutDrawDigits(pen, {
      text: eight,
      centerX: digitX,
      centerY: digitY,
      fontFamily: digitFontFamily,
      fontSize: digitFontSize,
      cellW,
      rgb: stop0,
      alpha: ghostBlendAmt,
      plate: true,
    });
  }
  if (plateGl) {
    nodeGraphNumberReadoutPresentBurnPlate(
      pen,
      canvas,
      burnPlate,
      gradientStops,
      peakHex,
    );
  }
  if (drawLiveDigits) {
    if (layout.pixelPin) {
      nodeGraphNumberReadoutDrawPixelPin(
        pen,
        layout,
        left,
        top,
        width,
        height,
        rgb,
        alpha,
      );
    } else if (digitFontSize > 0.25) {
      nodeGraphNumberReadoutDrawDigits(pen, {
        text: valueText,
        centerX: digitX,
        centerY: digitY,
        fontFamily: digitFontFamily,
        fontSize: digitFontSize,
        cellW,
        rgb,
        alpha,
        plate: false,
      });
    }
  }

  if (hasUnit && labelHeight > 0.25 && digitFontSize > 0.25) {
    const labelFontSize = nodeGraphNumberReadoutUnitFontSize(
      labelHeight,
      layout.contentW || width,
      digitFontSize,
      largeUnit,
    );
    nodeGraphNumberReadoutGlPenText(
      pen,
      unit,
      left + padPx + layout.contentW * 0.5,
      top + padPxY + digitAreaHeight + labelHeight * 0.5,
      NODE_GRAPH_NUMBER_READOUT_UNIT_FONT,
      labelFontSize,
      rgb,
      alpha * (largeUnit ? 0.85 : 0.55),
    );
  }

  nodeGraphNumberReadoutGlEndFace(canvas, pen);
  canvas._numberReadoutLastValueText = valueText;
  nodeGraphNumberReadoutRememberGoodValue(canvas, valueText);
  canvas._nodeGraphNumberReadoutText = text;
  canvas._nodeGraphNumberReadoutSettingsSig = settingsSig;
  canvas._nodeGraphNumberReadoutFontReady = nodeGraphNumberReadoutDsegReady;
  canvas._nodeGraphNumberReadoutWidth = canvas.width;
  canvas._nodeGraphNumberReadoutHeight = canvas.height;
  canvas._nodeGraphNumberReadoutPaintAt = now;
}



/*
 * Number readout GL face pipeline (Value LED / Value LCD / Pitch Detector).
 * Each face canvas owns one RGBA8 target on the shared GL device; a frame is
 * batched quads (solid rects + glyphs sampled from a baked atlas, premultiplied
 * source-over), optional full-target passes (burn-plate tint, LCD inner
 * shadow), then one present + blit into the face canvas. Texel row y = canvas
 * row y in the target. No shared device: nodeGraphDisplayGlFailed (black +
 * one console.error); there is no 2D face path.
 */
const NODE_GRAPH_NUMBER_READOUT_UNIT_FONT = '"Consolas", "Courier New", monospace';
const nodeGraphNumberReadoutGlStats = { faces: 0, presents: 0, glyphs: 0, rects: 0, shadows: 0, tints: 0, atlasBakes: 0 };

const NODE_GRAPH_NUMBER_READOUT_QUAD_VS = `
  attribute vec2 aPos;
  attribute vec2 aUv;
  attribute vec4 aColor;
  attribute float aMode;
  uniform vec2 uSize;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vMode;
  void main() {
    vUv = aUv;
    vColor = aColor;
    vMode = aMode;
    gl_Position = vec4(aPos / uSize * 2.0 - 1.0, 0.0, 1.0);
  }
`;
const NODE_GRAPH_NUMBER_READOUT_QUAD_FS = `
  precision mediump float;
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vMode;
  void main() {
    float cover = vMode > 0.5 ? texture2D(uAtlas, vUv).a : 1.0;
    float a = vColor.a * cover;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;
// Value LCD inset glass shadow, analytic: black frame with an offset hole,
// Gaussian-blurred (separable erf of the box hole) or hard (pixel-box
// coverage), clipped to the plate. Same maths as the old blurred 2D mask.
const NODE_GRAPH_NUMBER_READOUT_SHADOW_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform vec4 uClip;
  uniform vec4 uHole;
  uniform float uSigma;
  uniform float uAlpha;
  float erfApprox(float x) {
    float s = sign(x);
    float a = abs(x);
    float t = 1.0 / (1.0 + 0.3275911 * a);
    float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
    return s * y;
  }
  float cover1(float p, float a, float b) {
    if (uSigma < 0.01) {
      return clamp(min(p + 0.5, b) - max(p - 0.5, a), 0.0, 1.0);
    }
    float k = 0.70710678 / uSigma;
    return 0.5 * (erfApprox((p - a) * k) - erfApprox((p - b) * k));
  }
  void main() {
    vec2 p = gl_FragCoord.xy;
    if (p.x < uClip.x || p.y < uClip.y || p.x > uClip.z || p.y > uClip.w) {
      discard;
    }
    float hole = cover1(p.x, uHole.x, uHole.z) * cover1(p.y, uHole.y, uHole.w);
    float a = uAlpha * clamp(1.0 - hole, 0.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;
// Float face -> 8-bit canvas with ordered dither (sub-LSB burn still shows).
const NODE_GRAPH_NUMBER_READOUT_PRESENT_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 vUv;
  uniform sampler2D uSrc;
  ${SoemGl.GLSL_DITHER}
  void main() {
    vec4 c = texture2D(uSrc, vec2(vUv.x, 1.0 - vUv.y));
    gl_FragColor = vec4(soemDitherRgb(c.rgb, gl_FragCoord.xy), c.a);
  }
`;

function nodeGraphNumberReadoutCssRgb(css) {
  const t = String(css || "").trim();
  let m = t.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    return [...m[1]].map((c) => parseInt(c + c, 16));
  }
  m = t.match(/^#([0-9a-f]{6})/i);
  if (m) {
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  }
  m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return [0, 0, 0];
}

function nodeGraphNumberReadoutGlDevice() {
  if (typeof nodeGraphSharedGlDevice !== "function" || typeof SoemGl === "undefined") {
    return null;
  }
  const dev = nodeGraphSharedGlDevice();
  const gl = dev?.gl;
  if (!gl || gl.isContextLost()) {
    return null;
  }
  return dev;
}

function nodeGraphNumberReadoutFontsSig() {
  const fonts = typeof document !== "undefined" ? document.fonts : null;
  return fonts ? `${fonts.status}:${fonts.size}` : "";
}

// Per-glyph metrics at REF px (bounding box + advance), from the atlas bake.
const nodeGraphNumberReadoutGlyphMetricCache = new Map();
const NODE_GRAPH_NUMBER_READOUT_METRIC_REF = 100;

function nodeGraphNumberReadoutGlyphMetrics(fontFamily, fontPx, glyph) {
  const ref = NODE_GRAPH_NUMBER_READOUT_METRIC_REF;
  const key = `${fontFamily}|${nodeGraphNumberReadoutFontsSig()}`;
  let map = nodeGraphNumberReadoutGlyphMetricCache.get(key);
  if (!map) {
    if (nodeGraphNumberReadoutGlyphMetricCache.size > 32) {
      nodeGraphNumberReadoutGlyphMetricCache.clear();
    }
    map = new Map();
    nodeGraphNumberReadoutGlyphMetricCache.set(key, map);
  }
  const g = String(glyph || " ");
  let m = map.get(g);
  if (!m) {
    const baked = typeof nodeGraphDisplayCanvasBakeGlyphAtlas === "function"
      ? nodeGraphDisplayCanvasBakeGlyphAtlas({
        glyphs: [g], cols: 1, cellW: 1, cellH: 1, fontPx: ref, family: fontFamily, weight: 700,
        transparent: true, metrics: true, skipDraw: true,
      })
      : null;
    m = baked?.glyphMetrics?.[0] || { width: ref * 0.6, ascent: ref * 0.4, descent: ref * 0.4 };
    map.set(g, m);
  }
  const k = Math.max(0, Number(fontPx) || 0) / ref;
  return {
    width: m.width * k,
    actualBoundingBoxAscent: m.ascent * k,
    actualBoundingBoxDescent: m.descent * k,
  };
}

// Glyph atlases per (family, px, font state), LRU. Glyphs are drawn
// textAlign center / textBaseline middle at the cell centre; white with
// coverage in alpha. Missing characters rebake the atlas with the union.
const nodeGraphNumberReadoutGlyphAtlasCache = new Map();
const NODE_GRAPH_NUMBER_READOUT_ATLAS_BASE = "0123456789.-+8";
const NODE_GRAPH_NUMBER_READOUT_ATLAS_MAX_PX = 384;

function nodeGraphNumberReadoutGlyphAtlasDrop(entry) {
  if (entry?.tex && entry.gl && !entry.gl.isContextLost()) {
    entry.gl.deleteTexture(entry.tex);
  }
}

function nodeGraphNumberReadoutGlyphAtlas(gl, fontFamily, fontPx, text) {
  if (!gl || typeof nodeGraphDisplayCanvasBakeGlyphAtlas !== "function") {
    return null;
  }
  const want = Math.max(1, Number(fontPx) || 1);
  // Bake at the exact face font size so glyph quads land 1:1 on canvas pixels
  // (a resampled atlas reads soft/bold); only oversize faces scale.
  const bakePx = Math.min(NODE_GRAPH_NUMBER_READOUT_ATLAS_MAX_PX, want);
  const key = `${fontFamily}|${bakePx}|${nodeGraphNumberReadoutFontsSig()}`;
  const cache = nodeGraphNumberReadoutGlyphAtlasCache;
  let entry = cache.get(key);
  if (entry && entry.gl !== gl) {
    cache.delete(key);
    entry = null;
  }
  let missing = "";
  for (const ch of String(text || "")) {
    if (ch !== " " && ch !== "!" && !(entry ? entry.index.has(ch) : NODE_GRAPH_NUMBER_READOUT_ATLAS_BASE.includes(ch)) && !missing.includes(ch)) {
      missing += ch;
    }
  }
  if (!entry || (entry && missing)) {
    const chars = [...new Set([...(entry ? entry.chars : NODE_GRAPH_NUMBER_READOUT_ATLAS_BASE), ...missing])];
    const cw = Math.ceil(bakePx * 1.4) + 4;
    const chh = Math.ceil(bakePx * 1.6) + 4;
    const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    const cols = Math.max(1, Math.min(chars.length, Math.floor(maxTex / cw)));
    const rows = Math.ceil(chars.length / cols);
    if (rows * chh > maxTex) {
      return null;
    }
    const baked = nodeGraphDisplayCanvasBakeGlyphAtlas({
      glyphs: chars, cols, cellW: cw, cellH: chh, fontPx: bakePx, family: fontFamily, weight: 700, transparent: true,
    });
    if (!baked) {
      return null;
    }
    const tex = entry?.tex || gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    nodeGraphNumberReadoutGlPlateTexParams(gl, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, baked);
    gl.bindTexture(gl.TEXTURE_2D, null);
    entry = {
      gl, tex, chars, cols, cw, ch: chh, aw: baked.width, ah: baked.height, bakePx,
      index: new Map(chars.map((c, i) => [c, i])),
    };
    nodeGraphNumberReadoutGlStats.atlasBakes += 1;
  }
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > 24) {
    const oldest = cache.keys().next().value;
    nodeGraphNumberReadoutGlyphAtlasDrop(cache.get(oldest));
    cache.delete(oldest);
  }
  return { ...entry, scale: want / entry.bakePx };
}

function nodeGraphNumberReadoutGlFaceTarget(canvas) {
  const dev = nodeGraphNumberReadoutGlDevice();
  if (!dev || !canvas) {
    return null;
  }
  const gl = dev.gl;
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  if (w < 1 || h < 1 || w > dev.canvas.width || h > dev.canvas.height) {
    return null;
  }
  let prev = canvas._numberReadoutGlFace || null;
  if (prev && prev.gl !== gl) {
    prev = null;
    canvas._numberReadoutGlFace = null;
  }
  if (prev && prev.w === w && prev.h === h) {
    return prev;
  }
  const target = nodeGraphNumberReadoutGlPlateTarget(gl, w, h);
  if (!target) {
    return null;
  }
  const face = { gl, w, h, target };
  if (prev) {
    // Resize: scale the last face so a paused readout keeps its pixels.
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    nodeGraphNumberReadoutGlPlatePass(face, target, prev.target, 1, true);
    gl.deleteFramebuffer(prev.target.fbo);
    gl.deleteTexture(prev.target.tex);
  }
  canvas._numberReadoutGlFace = face;
  return face;
}

function nodeGraphNumberReadoutGlPen(gl, target, w, h) {
  return { gl, target, w, h, verts: [], tex: null };
}

function nodeGraphNumberReadoutGlBeginFace(canvas) {
  const face = nodeGraphNumberReadoutGlFaceTarget(canvas);
  if (!face) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "Number readout face GL unavailable");
    }
    return null;
  }
  const pen = nodeGraphNumberReadoutGlPen(face.gl, face.target, face.w, face.h);
  pen.face = face;
  nodeGraphNumberReadoutGlStats.faces += 1;
  return pen;
}

function nodeGraphNumberReadoutGlEndFace(canvas, pen) {
  if (!pen?.face) {
    return false;
  }
  nodeGraphNumberReadoutGlPenFlush(pen);
  return nodeGraphNumberReadoutGlPresentFace(canvas, pen.face);
}

const nodeGraphNumberReadoutGlQuadBuf = { gl: null, buf: null };

function nodeGraphNumberReadoutGlPenFlush(pen) {
  if (!pen || !pen.verts.length) {
    return true;
  }
  const gl = pen.gl;
  const verts = pen.verts;
  pen.verts = [];
  const prog = SoemGl.program(gl, "number-readout-face-quad", NODE_GRAPH_NUMBER_READOUT_QUAD_VS, NODE_GRAPH_NUMBER_READOUT_QUAD_FS);
  if (!prog) {
    return false;
  }
  const qb = nodeGraphNumberReadoutGlQuadBuf;
  if (qb.gl !== gl || !qb.buf) {
    qb.gl = gl;
    qb.buf = gl.createBuffer();
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, pen.target.fbo);
  gl.viewport(0, 0, pen.w, pen.h);
  gl.disable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), pen.w, pen.h);
  gl.uniform1i(gl.getUniformLocation(prog, "uAtlas"), 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pen.tex);
  gl.bindBuffer(gl.ARRAY_BUFFER, qb.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
  const stride = 9 * 4;
  const attrs = [["aPos", 2, 0], ["aUv", 2, 2], ["aColor", 4, 4], ["aMode", 1, 8]];
  const locs = [];
  for (const [name, size, off] of attrs) {
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    locs.push(loc);
  }
  gl.drawArrays(gl.TRIANGLES, 0, verts.length / 9);
  for (const loc of locs) {
    gl.disableVertexAttribArray(loc);
  }
  gl.disable(gl.BLEND);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return true;
}

function nodeGraphNumberReadoutGlPenQuad(pen, x0, y0, x1, y1, u0, v0, u1, v1, rgb, alpha, tex) {
  if (tex && pen.tex !== tex) {
    if (pen.verts.length && pen.tex) {
      nodeGraphNumberReadoutGlPenFlush(pen);
    }
    pen.tex = tex;
  }
  const r = nodeGraphFiniteNumber(rgb?.[0]) / 255;
  const g = nodeGraphFiniteNumber(rgb?.[1]) / 255;
  const b = nodeGraphFiniteNumber(rgb?.[2]) / 255;
  const a = Math.max(0, Math.min(1, nodeGraphFiniteNumber(alpha)));
  const m = tex ? 1 : 0;
  pen.verts.push(
    x0, y0, u0, v0, r, g, b, a, m,
    x1, y0, u1, v0, r, g, b, a, m,
    x0, y1, u0, v1, r, g, b, a, m,
    x1, y0, u1, v0, r, g, b, a, m,
    x1, y1, u1, v1, r, g, b, a, m,
    x0, y1, u0, v1, r, g, b, a, m,
  );
}

function nodeGraphNumberReadoutGlPenRect(pen, x, y, w, h, rgb, alpha = 1) {
  if (!pen || !(w > 0) || !(h > 0) || !(alpha > 0)) {
    return;
  }
  nodeGraphNumberReadoutGlPenQuad(pen, x, y, x + w, y + h, 0, 0, 0, 0, rgb, alpha, null);
  nodeGraphNumberReadoutGlStats.rects += 1;
}

// One glyph centred on (x, y) (textAlign center, textBaseline middle).
function nodeGraphNumberReadoutGlPenGlyph(pen, atlas, glyph, x, y, rgb, alpha) {
  const i = atlas?.index.get(glyph);
  if (i == null || !(alpha > 0)) {
    return;
  }
  const s = atlas.scale;
  const dw = atlas.cw * s;
  const dh = atlas.ch * s;
  let x0 = x - dw * 0.5;
  let y0 = y - dh * 0.5;
  if (Math.abs(s - 1) < 1e-6) {
    // 1:1 bake: land atlas texels on canvas pixels (no resample blur).
    x0 = Math.round(x0);
    y0 = Math.round(y0);
  }
  const col = i % atlas.cols;
  const row = Math.floor(i / atlas.cols);
  const u0 = (col * atlas.cw) / atlas.aw;
  const v0 = (row * atlas.ch) / atlas.ah;
  const u1 = ((col + 1) * atlas.cw) / atlas.aw;
  const v1 = ((row + 1) * atlas.ch) / atlas.ah;
  nodeGraphNumberReadoutGlPenQuad(pen, x0, y0, x0 + dw, y0 + dh, u0, v0, u1, v1, rgb, alpha, atlas.tex);
  nodeGraphNumberReadoutGlStats.glyphs += 1;
}

// Centred single-line text (unit labels), advancing by measured glyph widths.
function nodeGraphNumberReadoutGlPenText(pen, text, cx, cy, fontFamily, fontPx, rgb, alpha) {
  const str = String(text || "");
  if (!pen || !str || !(fontPx > 0.25)) {
    return;
  }
  const atlas = nodeGraphNumberReadoutGlyphAtlas(pen.gl, fontFamily, fontPx, str);
  if (!atlas) {
    return;
  }
  const chars = [...str];
  const widths = chars.map((c) => nodeGraphNumberReadoutGlyphMetrics(fontFamily, fontPx, c).width);
  let x = cx - widths.reduce((a, b) => a + b, 0) * 0.5;
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== " ") {
      nodeGraphNumberReadoutGlPenGlyph(pen, atlas, chars[i], x + widths[i] * 0.5, cy, rgb, alpha);
    }
    x += widths[i];
  }
}

function nodeGraphNumberReadoutGlPenLcdInnerShadow(
  pen,
  left,
  top,
  width,
  height,
  distance01,
  sharpness01,
  offsetX01 = 0,
  offsetY01 = 0,
) {
  if (!pen || !(width > 2) || !(height > 2)) {
    return;
  }
  const dist = clampNodeSliderValue(nodeGraphFiniteNumber(distance01), 0, 1);
  if (dist <= 0.001) {
    return;
  }
  const sharp = clampNodeSliderValue(nodeGraphFiniteNumber(sharpness01), 0, 1);
  const ox01 = clampNodeSliderValue(nodeGraphFiniteNumber(offsetX01), -1, 1);
  const oy01 = clampNodeSliderValue(nodeGraphFiniteNumber(offsetY01), -1, 1);
  const minSide = Math.min(width, height);
  // Inset-shadow parameter maths (former 2D Gaussian inset).
  const reach = Math.max(1, dist * minSide * 0.42);
  const hardEase = nodeGraphNumberReadoutSmoothstep01(sharp);
  const softFrac = (1 - hardEase) * (1 - hardEase);
  const blurPx = reach * 1.35 * softFrac;
  const softBase = Math.min(0.55, 0.18 + dist * 0.28);
  const alpha = softBase + (1 - softBase) * hardEase;
  const maxOff = reach * 0.9;
  const offX = ox01 * maxOff;
  const offY = oy01 * maxOff;
  const gl = pen.gl;
  const prog = SoemGl.program(gl, "number-readout-lcd-shadow", SoemGl.GLSL_FULLSCREEN_VS, NODE_GRAPH_NUMBER_READOUT_SHADOW_FS);
  if (!prog) {
    return;
  }
  nodeGraphNumberReadoutGlPenFlush(pen);
  gl.bindFramebuffer(gl.FRAMEBUFFER, pen.target.fbo);
  gl.viewport(0, 0, pen.w, pen.h);
  gl.disable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(prog);
  gl.uniform4f(gl.getUniformLocation(prog, "uClip"), left, top, left + width, top + height);
  const hx = left + offX;
  const hy = top + offY;
  gl.uniform4f(gl.getUniformLocation(prog, "uHole"), hx, hy, hx + Math.ceil(width), hy + Math.ceil(height));
  gl.uniform1f(gl.getUniformLocation(prog, "uSigma"), blurPx > 0.35 ? blurPx : 0);
  gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), alpha);
  SoemGl.drawQuad(gl, gl.getAttribLocation(prog, "aPos"));
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  nodeGraphNumberReadoutGlStats.shadows += 1;
}

function nodeGraphNumberReadoutGlPresentFace(canvas, face) {
  const dev = nodeGraphNumberReadoutGlDevice();
  if (!dev || dev.gl !== face?.gl) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "Number readout face GL unavailable");
    }
    return false;
  }
  const gl = face.gl;
  const prog = SoemGl.program(gl, "number-readout-face-present", SoemGl.GLSL_FULLSCREEN_VS, NODE_GRAPH_NUMBER_READOUT_PRESENT_FS);
  const ctx = typeof nodeGraphDisplayCanvasPresentContext === "function"
    ? nodeGraphDisplayCanvasPresentContext(canvas)
    : null;
  if (!prog || !ctx) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "Number readout face present unavailable");
    }
    return false;
  }
  const w = face.w;
  const h = face.h;
  nodeGraphSharedGlBindPresent(gl, w, h);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, face.target.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  SoemGl.drawQuad(gl, gl.getAttribLocation(prog, "aPos"));
  gl.bindTexture(gl.TEXTURE_2D, null);
  nodeGraphSharedGlEndPresent(gl);
  nodeGraphDisplayCanvasBlit(ctx, dev.canvas, 0, dev.canvas.height - h, w, h, 0, 0, w, h, false);
  nodeGraphNumberReadoutGlStats.presents += 1;
  return true;
}
