// Basic scope/trace/value draw helpers from scopes.js (Phase D paint peel).
// Load before scopes.js.

function drawNodeGraphModuleScopeBufferWebGl(renderer, rect, buffer, pixelRatio, slot, options = {}) {
  const { canvas, gl } = renderer;
  const visibleRect = nodeGraphModuleScopeVisibleMetricRect(rect, options);
  const clipRect = nodeGraphModuleScopeClippedPixelRect(canvas, visibleRect, pixelRatio);
  if (!clipRect) {
    return;
  }
  if (buffer?.nodeGraphScopeSpectrum) {
    drawNodeGraphModuleScopeSpectrumBarsWebGl(renderer, rect, buffer, pixelRatio, options);
    return;
  }
  const traceThicknessPx = Math.max(1, nodeGraphFiniteNumber(options.thicknessPx, 1));
  const fixedDotSizeRatio = Number(buffer?.nodeGraphScopeFixedDotSizeRatio);
  const fixedDotSizePx = Number.isFinite(fixedDotSizeRatio) && fixedDotSizeRatio > 0
    ? Math.max(1, Math.min(visibleRect.width, visibleRect.height) * clampNodeSliderValue(fixedDotSizeRatio, 0.01, 1))
    : 0;
  const requestedDotSizeScale = Number(options.dotSizeScale);
  const dotSizeScale = Number.isFinite(requestedDotSizeScale) && requestedDotSizeScale > 0
    ? requestedDotSizeScale
    : nodeGraphModuleScopeDotSizeScale();
  const dotThicknessPx = Math.max(
    1,
    fixedDotSizePx || (traceThicknessPx * dotSizeScale),
  );
  const safeDotThicknessPx = Math.min(512, dotThicknessPx * pixelRatio);
  if (nodeGraphModuleDisplayRendererForSlot(slot) === "waterfall" && !buffer?.nodeGraphScopeXy && !buffer?.nodeGraphScopeSpectrum) {
    const traceGeometry = buildNodeGraphTraceDisplayVertices(buffer, rect, canvas, pixelRatio, slot, options);
    if (!traceGeometry) {
      return;
    }
    recordNodeGraphModuleScopeRenderMetrics(traceGeometry.pointCount, traceGeometry.vertexCount);
    if (options.traceTiming) {
      options.traceTiming.passes += 1;
      options.traceTiming.points += traceGeometry.pointCount;
      options.traceTiming.vertices += traceGeometry.vertexCount;
    }
    gl.scissor(clipRect.left, canvas.height - clipRect.bottom, clipRect.width, clipRect.height);
    gl.useProgram(renderer.beamProgram);
    gl.uniform2f(renderer.beamCanvasSizeLocation, canvas.width, canvas.height);
    gl.uniform1f(renderer.beamBlurLocation, clampNodeSliderValue(nodeGraphFiniteNumber(options.blur), 0, 1));
    gl.uniform1f(renderer.beamSizeLocation, safeDotThicknessPx);
    const intensity = Number(options.intensity);
    gl.uniform1f(renderer.beamIntensityLocation, Number.isFinite(intensity) ? Math.max(0, intensity) : 0.1);
    const color = Array.isArray(options.color) ? options.color : [0.7, 1, 0.9];
    gl.uniform3f(renderer.beamColorLocation, color[0], color[1], color[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.beamBuffer);
    const glBufferDataStartMs = options.traceTiming ? nodeGraphModuleScopeNowMs() : 0;
    gl.bufferData(
      gl.ARRAY_BUFFER,
      traceGeometry.vertices.subarray(0, traceGeometry.vertexFloatCount),
      gl.STREAM_DRAW,
    );
    if (options.traceTiming) {
      options.traceTiming.glBufferDataMs += Math.max(0, nodeGraphModuleScopeNowMs() - glBufferDataStartMs);
    }
    gl.vertexAttribPointer(renderer.beamStartLocation, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(renderer.beamStartLocation);
    gl.vertexAttribPointer(renderer.beamEndLocation, 2, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(renderer.beamEndLocation);
    gl.vertexAttribPointer(renderer.beamCornerLocation, 1, gl.FLOAT, false, 24, 16);
    gl.enableVertexAttribArray(renderer.beamCornerLocation);
    gl.vertexAttribPointer(renderer.beamPointAgeLocation, 1, gl.FLOAT, false, 24, 20);
    gl.enableVertexAttribArray(renderer.beamPointAgeLocation);
    const drawArraysStartMs = options.traceTiming ? nodeGraphModuleScopeNowMs() : 0;
    gl.drawArrays(gl.TRIANGLES, 0, traceGeometry.vertexCount);
    if (options.traceTiming) {
      options.traceTiming.drawArraysMs += Math.max(0, nodeGraphModuleScopeNowMs() - drawArraysStartMs);
    }
    return;
  }
  const vertices = [];
  let pointCount = 0;
  const xyPoints = nodeGraphModuleScopeXyPoints(buffer, rect, canvas, pixelRatio, slot);
  if (xyPoints.length >= 4) {
    pointCount += xyPoints.length / 2;
    const vertexStartMs = options.traceTiming ? nodeGraphModuleScopeNowMs() : 0;
    appendNodeGraphModuleScopeVertices(vertices, nodeGraphModuleScopeBeamVertices(xyPoints, canvas));
    if (options.traceTiming) {
      options.traceTiming.vertexGenerationMs += Math.max(0, nodeGraphModuleScopeNowMs() - vertexStartMs);
    }
  } else {
    for (const [start, end] of nodeGraphModuleScopeBufferProgressRanges(buffer)) {
      const points = nodeGraphModuleScopeBufferSegmentPoints(
        buffer,
        rect,
        canvas,
        pixelRatio,
        slot,
        start,
        end,
        options,
      );
      if (points.length >= 4) {
        pointCount += points.length / 2;
        const vertexStartMs = options.traceTiming ? nodeGraphModuleScopeNowMs() : 0;
        appendNodeGraphModuleScopeVertices(vertices, nodeGraphModuleScopeBeamVertices(points, canvas));
        if (options.traceTiming) {
          options.traceTiming.vertexGenerationMs += Math.max(0, nodeGraphModuleScopeNowMs() - vertexStartMs);
        }
      }
    }
  }
  if (vertices.length < 36) {
    return;
  }
  if (options.traceTiming) {
    options.traceTiming.passes += 1;
    options.traceTiming.points += pointCount;
    options.traceTiming.vertices += vertices.length / 6;
  }
  recordNodeGraphModuleScopeRenderMetrics(pointCount, vertices.length / 6);
  gl.scissor(clipRect.left, canvas.height - clipRect.bottom, clipRect.width, clipRect.height);
  gl.useProgram(renderer.beamProgram);
  gl.uniform2f(renderer.beamCanvasSizeLocation, canvas.width, canvas.height);
  gl.uniform1f(renderer.beamBlurLocation, 1);
  gl.uniform1f(renderer.beamSizeLocation, safeDotThicknessPx);
  const intensity = Number(options.intensity);
  gl.uniform1f(renderer.beamIntensityLocation, Number.isFinite(intensity) ? Math.max(0, intensity) : 0.1);
  const color = Array.isArray(options.color) ? options.color : [0.7, 1, 0.9];
  gl.uniform3f(renderer.beamColorLocation, color[0], color[1], color[2]);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.beamBuffer);
  const glBufferDataStartMs = options.traceTiming ? nodeGraphModuleScopeNowMs() : 0;
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
  if (options.traceTiming) {
    options.traceTiming.glBufferDataMs += Math.max(0, nodeGraphModuleScopeNowMs() - glBufferDataStartMs);
  }
  gl.vertexAttribPointer(renderer.beamStartLocation, 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(renderer.beamStartLocation);
  gl.vertexAttribPointer(renderer.beamEndLocation, 2, gl.FLOAT, false, 24, 8);
  gl.enableVertexAttribArray(renderer.beamEndLocation);
  gl.vertexAttribPointer(renderer.beamCornerLocation, 1, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(renderer.beamCornerLocation);
  gl.vertexAttribPointer(renderer.beamPointAgeLocation, 1, gl.FLOAT, false, 24, 20);
  gl.enableVertexAttribArray(renderer.beamPointAgeLocation);
  const drawArraysStartMs = options.traceTiming ? nodeGraphModuleScopeNowMs() : 0;
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
  if (options.traceTiming) {
    options.traceTiming.drawArraysMs += Math.max(0, nodeGraphModuleScopeNowMs() - drawArraysStartMs);
  }
}


function drawNodeGraphModuleScopeSpectrumBarsWebGl(renderer, rect, buffer, pixelRatio, options = {}) {
  const { canvas, gl } = renderer;
  const visibleRect = nodeGraphModuleScopeVisibleMetricRect(rect, options);
  const clipRect = nodeGraphModuleScopeClippedPixelRect(canvas, visibleRect, pixelRatio);
  if (!clipRect) {
    return;
  }
  const vertices = nodeGraphModuleScopeSpectrumBarVertices(buffer, {
    height: rect.height * pixelRatio,
    left: rect.left * pixelRatio,
    top: rect.top * pixelRatio,
    width: rect.width * pixelRatio,
  }, canvas, options);
  if (vertices.length < 6) {
    return;
  }
  recordNodeGraphModuleScopeRenderMetrics(vertices.length / 12, vertices.length / 2);
  gl.scissor(clipRect.left, canvas.height - clipRect.bottom, clipRect.width, clipRect.height);
  gl.useProgram(renderer.colorProgram);
  const color = Array.isArray(options.color) ? options.color : [0.7, 1, 0.9];
  const intensity = clampNodeSliderValue(nodeGraphFiniteNumber(options.intensity, 0.1), 0, 4);
  gl.uniform4f(
    renderer.colorLocation,
    color[0] * intensity,
    color[1] * intensity,
    color[2] * intensity,
    intensity,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.colorPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
  gl.vertexAttribPointer(renderer.colorPositionLocation, 2, gl.FLOAT, false, 8, 0);
  gl.enableVertexAttribArray(renderer.colorPositionLocation);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}


function drawNodeGraphModuleScopeLightDisplay(batch, rect, buffer, pixelRatio, slot) {
  if (!batch || !buffer?.nodeGraphScopeLightDisplay) {
    return false;
  }
  const nodeId = String(slot?.nodeId || "");
  const settings = nodeGraphModuleScopeSetting(nodeId);
  const dt = clampNodeSliderValue(nodeGraphFiniteNumber(nodeGraphModuleScopeState.animationDeltaSeconds, (1 / 60)), 1 / 240, 1 / 15);
  const target = clampNodeSliderValue(nodeGraphFiniteNumber(buffer.nodeGraphScopeLightTarget), 0, 1);
  const releaseSeconds = Number(buffer.nodeGraphScopeLightReleaseSeconds);
  const hasRelease = Number.isFinite(releaseSeconds) && releaseSeconds > 0;
  let brightness = target;
  if (hasRelease) {
    const state = nodeGraphModuleScopeState.lightDisplayStates.get(nodeId) || { brightness: 0 };
    if (target >= state.brightness) {
      state.brightness = target;
    } else {
      const coefficient = 1 - Math.exp(-dt / Math.max(0.001, releaseSeconds));
      state.brightness = clampNodeSliderValue(state.brightness + (target - state.brightness) * coefficient, 0, 1);
    }
    nodeGraphModuleScopeState.lightDisplayStates.set(nodeId, state);
    brightness = state.brightness;
  } else if (!buffer.nodeGraphScopeLightInstant) {
    const state = nodeGraphModuleScopeState.lightDisplayStates.get(nodeId) || { brightness: 0 };
    const tau = target > state.brightness ? 0.008 : 0.018;
    const coefficient = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    state.brightness = clampNodeSliderValue(state.brightness + (target - state.brightness) * coefficient, 0, 1);
    nodeGraphModuleScopeState.lightDisplayStates.set(nodeId, state);
    brightness = state.brightness;
  } else {
    nodeGraphModuleScopeState.lightDisplayStates.delete(nodeId);
  }
  if (brightness <= 0.002) {
    return false;
  }

  const lightStyle = nodeGraphModuleScopeLightShaderStyle(slot, buffer);
  const centerColor = lightStyle.centerColor;
  const centerRgb = nodeGraphScopeHexColorToRgb(centerColor)
    .map((component) => Math.round(clampNodeSliderValue(component, 0, 1) * 255));
  const core1Size = lightStyle.centerSize;
  const core1Brightness = lightStyle.centerBrightness;
  const core1Blur = lightStyle.centerBlur;
  const availableSize = Math.max(1, Math.min(rect.width, rect.height));
  const centerSizeRatio = clampNodeSliderValue(core1Size, 0, 1);
  const size = Math.max(1, availableSize * centerSizeRatio);
  const centerX = (rect.left + rect.width * 0.5) * pixelRatio;
  const centerY = (rect.top + rect.height * 0.5) * pixelRatio;
  const radius = size * pixelRatio * 0.5;
  const masterBrightness = nodeGraphModuleScopeTraceBrightness(slot, settings);
  const alpha = clampNodeSliderValue(brightness * masterBrightness, 0, 1);
  const frameBrightnessMode = buffer.nodeGraphScopeFrameBrightness === true;
  const shape = ["circle", "square", "diamond"].includes(buffer.nodeGraphScopeLightShape)
    ? buffer.nodeGraphScopeLightShape
    : "circle";
  const centerAlphaScale = Number.isFinite(Number(buffer.nodeGraphScopeLightCenterAlphaScale))
    ? clampNodeSliderValue(Number(buffer.nodeGraphScopeLightCenterAlphaScale), 0, 4)
    : lightStyle.usesShader ? 1 : 0.5;
  const sharedFrameAlphaFactor = frameBrightnessMode ? 1 : null;
  const centerAlphaFactor = sharedFrameAlphaFactor ?? clampNodeSliderValue(core1Brightness * centerAlphaScale, 0, 1);
  const visibleCenterRgb = lightStyle.usesShader
    ? nodeGraphModuleScopeEmissiveShaderRgb(centerRgb, core1Brightness)
    : centerRgb;
  const sprite = nodeGraphModuleScopeLightSpriteTexture({
    centerAlphaFactor,
    centerBlur: core1Blur,
    centerRgb: visibleCenterRgb,
    radius,
    shape,
    usesShader: lightStyle.usesShader,
  });
  if (!sprite) {
    return false;
  }
  // Transparent light layer: over and additive only differ where two lights
  // overlap, so every sprite composites "over" in the one GL batch.
  nodeGraphGlLinesImage(
    batch, sprite.canvas,
    centerX - sprite.size * 0.5, centerY - sprite.size * 0.5, sprite.size, sprite.size,
    { alpha, nearest: false, cache: true },
  );
  return true;
}


function drawNodeGraphModuleScopeLightDisplays(items, pixelRatio) {
  const canvas = nodeGraphModuleScopeLightCanvas();
  if (!canvas) {
    return;
  }
  const lights = [];
  for (const item of items || []) {
    const renderer = typeof nodeGraphModuleDisplayRendererForSlot === "function"
      ? nodeGraphModuleDisplayRendererForSlot(item?.slot)
      : "";
    if (renderer === "vectorDot" || renderer === "pulseDot" || renderer === "lcdDot" || renderer === "dot") {
      continue;
    }
    if (item?.buffer?.nodeGraphScopeLightDisplay) {
      lights.push(item);
    }
  }
  // Nothing lit and already clear: skip the full-layer pass.
  if (!lights.length && !canvas._lightLayerDirty) {
    return;
  }
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { transparent: true, publishNodeId: "" })
    : null;
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "light layer: no shared GL device");
    return;
  }
  let drew = false;
  for (const item of lights) {
    if (drawNodeGraphModuleScopeLightDisplay(batch, item.scopeRect, item.buffer, pixelRatio, item.slot)) {
      drew = true;
    }
  }
  if (!nodeGraphGlLinesEnd(batch)) {
    nodeGraphDisplayGlFailed(canvas, "light layer: GL present failed");
  }
  canvas._lightLayerDirty = drew;
}


function drawNodeGraphTraceDisplayItem(renderer, item, pixelRatio) {
  const slot = item?.slot;
  const buffer = item?.buffer;
  if (!slot) {
    return;
  }
  if (!buffer?.length) {
    if (typeof paintNodeGraphTraceDisplayColdPlate === "function") {
      paintNodeGraphTraceDisplayColdPlate(slot, pixelRatio);
    }
    return;
  }
  renderNodeGraphModuleScopeAnalyzer(slot, buffer);
  const painted = drawNodeGraphTraceDisplayCanvasItem(item, pixelRatio);
  if (painted === false && typeof paintNodeGraphTraceDisplayColdPlate === "function") {
    paintNodeGraphTraceDisplayColdPlate(slot, pixelRatio);
  }
}


function drawNodeGraphOscilloscopeBeam(renderer, item, pixelRatio, x1, y1, x2, y2, options = {}) {
  const { canvas, gl } = renderer;
  const clipRect = nodeGraphModuleScopeClippedPixelRect(
    canvas,
    item.visibleScopeRect || item.scopeRect,
    pixelRatio,
  );
  if (!clipRect) {
    return;
  }
  const vertices = new Float32Array(36);
  appendNodeGraphTraceDisplayBeamSegment(
    vertices,
    0,
    x1 * pixelRatio,
    y1 * pixelRatio,
    x2 * pixelRatio,
    y2 * pixelRatio,
    1,
  );
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(clipRect.left, canvas.height - clipRect.bottom, clipRect.width, clipRect.height);
  gl.useProgram(renderer.beamProgram);
  gl.uniform2f(renderer.beamCanvasSizeLocation, canvas.width, canvas.height);
  gl.uniform1f(renderer.beamBlurLocation, clampNodeSliderValue(nodeGraphFiniteNumber(options.blur), 0, 1));
  gl.uniform1f(renderer.beamSizeLocation, Math.max(1, (nodeGraphFiniteNumber(options.thicknessPx, 1)) * pixelRatio));
  gl.uniform1f(renderer.beamIntensityLocation, Math.max(0, nodeGraphFiniteNumber(options.intensity)));
  const color = Array.isArray(options.color) ? options.color : [0.45, 0.92, 1];
  gl.uniform3f(renderer.beamColorLocation, color[0], color[1], color[2]);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.beamBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
  gl.vertexAttribPointer(renderer.beamStartLocation, 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(renderer.beamStartLocation);
  gl.vertexAttribPointer(renderer.beamEndLocation, 2, gl.FLOAT, false, 24, 8);
  gl.enableVertexAttribArray(renderer.beamEndLocation);
  gl.vertexAttribPointer(renderer.beamCornerLocation, 1, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(renderer.beamCornerLocation);
  gl.vertexAttribPointer(renderer.beamPointAgeLocation, 1, gl.FLOAT, false, 24, 20);
  gl.enableVertexAttribArray(renderer.beamPointAgeLocation);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  recordNodeGraphModuleScopeRenderMetrics(1, 6);
}


function nodeGraphPhosphorDotLutCss(settings, amount01) {
  const t = Math.max(0, Math.min(0.999, nodeGraphFiniteNumber(amount01)));
  const stops = Array.isArray(settings?.gradientStops) ? settings.gradientStops : null;
  if (stops?.length >= 2) {
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i += 1) {
      if (t <= Number(stops[i].t)) {
        a = stops[i - 1];
        b = stops[i];
        break;
      }
    }
    const span = Math.max(1e-6, Number(b.t) - Number(a.t));
    const u = (t - Number(a.t)) / span;
    const mixHex = (ha, hb) => {
      const pa = /^#?([0-9a-f]{6})$/i.exec(String(ha || ""));
      const pb = /^#?([0-9a-f]{6})$/i.exec(String(hb || ""));
      if (!pa || !pb) {
        return hb || ha || "#75ebff";
      }
      const na = Number.parseInt(pa[1], 16);
      const nb = Number.parseInt(pb[1], 16);
      const ch = (shift) => {
        const ca = (na >> shift) & 255;
        const cb = (nb >> shift) & 255;
        return Math.round(ca + (cb - ca) * u);
      };
      return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
    };
    return mixHex(a.color, b.color);
  }
  return settings?.dot1Color || "#75ebff";
}

function drawNodeGraphDotOscilloscopeItem(renderer, item, pixelRatio) {
  // Phosphor Dot: GPU residual plate + stamp on the shared GL device
  // (node-graph-module-scope-residual-face-gl.js). No 2D path.
  return drawNodeGraphPhosphorDotGlItem(renderer, item, pixelRatio);
}


/**
 * Value Line — TraceStroke on a face-local canvas (same space as the module
 * face). Must NOT use the shared viewport WebGL beam: that path tracks pan/zoom
 * while paused and the line drifts off the scope.
 */
function drawNodeGraphValueOscilloscopeItem(renderer, item, pixelRatio) {
  const slot = item?.slot;
  if (!slot) {
    return;
  }
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : null;
  const settings = typeof nodeGraphTraceDisplaySettingsForNode === "function"
    ? nodeGraphTraceDisplaySettingsForNode(node)
    : null;
  const safeSettings = settings && typeof settings === "object"
    ? settings
    : (typeof normalizeNodeGraphValueOscilloscopeSettings === "function"
      ? normalizeNodeGraphValueOscilloscopeSettings()
      : {});

  const canvas = typeof nodeGraphModuleScopeLocalFallbackCanvas === "function"
    ? nodeGraphModuleScopeLocalFallbackCanvas(slot)
    : null;
  const screenElement = item?.screenElement || slot?.scopeElement;
  if (!canvas || typeof syncNodeGraphModuleScopeLocalFallbackCanvas !== "function") {
    return;
  }
  {
    const densityRaw = Number(safeSettings.pixelDensity);
    const density = Number.isFinite(densityRaw) ? densityRaw : 1;
    if (!syncNodeGraphModuleScopeLocalFallbackCanvas(
      canvas,
      screenElement,
      pixelRatio,
      density,
    )) {
      return;
    }
  }
  if (typeof renderNodeGraphModuleScopeAnalyzer === "function") {
    renderNodeGraphModuleScopeAnalyzer(slot, item.buffer);
  }

  const bg = typeof nodeGraphFacePlateBackground === "function"
    ? nodeGraphFacePlateBackground(safeSettings)
    : "#000004";
  if (typeof nodeGraphFacePlateApplyCss === "function" && screenElement) {
    nodeGraphFacePlateApplyCss(screenElement, bg);
  }
  canvas.style.mixBlendMode = "normal";

  const width = canvas.width;
  const height = canvas.height;
  const faceMinSide = Math.max(1, Math.min(width, height));
  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();

  // Frozen: redraw the last frame's strokes over the plate.
  let strokes = canvas._valueLineStrokes || [];
  if (!frozen) {
    strokes = nodeGraphValueOscilloscopeStrokes(item, safeSettings, width, height, faceMinSide);
    canvas._valueLineStrokes = strokes;
  }
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphGlLinesCss(bg))
    : null;
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "value oscilloscope: no shared GL device");
    return;
  }
  for (const st of strokes) {
    // TraceStroke look: soft halo (blur) under the Size core, round caps.
    if (st.blur >= 0.04) {
      const expand = st.lineWidth * st.blur * 2;
      nodeGraphGlLinesSegment(batch, st.x1, st.y1, st.x2, st.y2, (st.lineWidth + expand) * 0.5, 1, [...st.rgb, 0.28]);
    }
    nodeGraphGlLinesSegment(batch, st.x1, st.y1, st.x2, st.y2, st.lineWidth * 0.5, 1, [...st.rgb, 1]);
  }
  if (!nodeGraphGlLinesEnd(batch)) {
    nodeGraphDisplayGlFailed(canvas, "value oscilloscope: GL present failed");
  }
  if (typeof recordNodeGraphModuleScopeRenderMetrics === "function") {
    recordNodeGraphModuleScopeRenderMetrics(1, strokes.length ? 1 : 0);
  }
}

/** Value line + end caps for this frame: [{ x1, y1, x2, y2, lineWidth, blur, rgb01 }]. */
function nodeGraphValueOscilloscopeStrokes(item, safeSettings, width, height, faceMinSide) {
  const amp = typeof nodeGraphDisplaySettingsAmplitudeScale === "function"
    ? nodeGraphDisplaySettingsAmplitudeScale(safeSettings)
    : 1;
  const value = clampNodeSliderValue(
    (typeof nodeGraphOscilloscopeLatestSample === "function"
      ? nodeGraphOscilloscopeLatestSample(item?.buffer, 0)
      : 0) * amp,
    -1,
    1,
  );
  // 0 is a real setting - never use `x || default` (that snaps 0 back to default).
  const finiteUnit = (raw, fallback) => {
    const n = Number(raw);
    return clampNodeSliderValue(Number.isFinite(n) ? n : fallback, 0, 1);
  };
  const lineLength = finiteUnit(safeSettings.lineLength, 1);
  const brightness = finiteUnit(safeSettings.brightness ?? safeSettings.dot1Brightness, 0.72);
  if (!(brightness > 0.001) || safeSettings.dot1Enabled === false) {
    return [];
  }
  const halfLine = width * 0.5 * lineLength;
  const x1 = width * 0.5 - halfLine;
  const x2 = width * 0.5 + halfLine;
  const y = height * 0.5 - value * height * 0.44;
  let rgb = [115, 235, 255];
  const colorHex = safeSettings.color || safeSettings.dot1Color || "";
  if (colorHex && typeof nodeGraphScopeHexColorToRgb === "function") {
    const parsed = nodeGraphScopeHexColorToRgb(colorHex);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      rgb = parsed[0] <= 1.01 ? parsed.map((v) => Math.round(v * 255)) : parsed.map((v) => Math.round(v));
    }
  }
  const size01 = typeof nodeGraphTraceDisplayNormalizeInkPx === "function"
    ? nodeGraphTraceDisplayNormalizeInkPx(safeSettings.dot1Size, 2)
    : Math.max(0, nodeGraphFiniteNumber(safeSettings.dot1Size, 2));
  if (!(size01 > 0)) {
    return [];
  }
  const blur = Math.max(0.12, finiteUnit(safeSettings.lineThickness, 0));
  const rgb01 = [0, 1, 2].map((i) => Math.round(rgb[i] * brightness) / 255);
  const diameter = (s01) => faceInkPx(clampAuthoredInkPx(s01, 0), faceMinSide);
  const lineWidth = diameter(size01);
  if (!(lineWidth > 0)) {
    return [];
  }
  const out = [{ x1, y1: y, x2, y2: y, lineWidth, blur, rgb: rgb01 }];
  if (safeSettings.capEnabled !== false) {
    const capLen01 = finiteUnit(safeSettings.capLength, 0.16);
    if (capLen01 > 0.001) {
      const capHalf = height * capLen01 * 0.5;
      const capSize01 = finiteUnit(safeSettings.capSize ?? safeSettings.dot1Size, size01);
      const capWidth = diameter(capSize01);
      const edgeAlign = (capWidth - lineWidth) * 0.5;
      const padPx = halfLine * finiteUnit(safeSettings.capPadding, 0);
      const midX = (x1 + x2) * 0.5;
      const leftCapX = Math.min(midX, x1 + edgeAlign + padPx);
      const rightCapX = Math.max(midX, x2 - edgeAlign - padPx);
      if (capWidth > 0) {
        out.push({ x1: leftCapX, y1: y - capHalf, x2: leftCapX, y2: y + capHalf, lineWidth: capWidth, blur, rgb: rgb01 });
        out.push({ x1: rightCapX, y1: y - capHalf, x2: rightCapX, y2: y + capHalf, lineWidth: capWidth, blur, rgb: rgb01 });
      }
    }
  }
  return out;
}


function nodeGraphVectorDotFrameEnergy01(buffer, canvas) {
  if (!buffer || !buffer.length) {
    return 0;
  }
  const abs = Math.max(
    0,
    Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeTotalSampleCount || buffer.nodeGraphScopeAbsoluteFrame)),
  );
  const prevAbs = Number(canvas?._vectorDotEnergyAbs || 0);
  let n = 0;
  if (prevAbs > 0 && abs > prevAbs) {
    n = Math.min(buffer.length, abs - prevAbs);
  } else if (typeof nodeGraphScopeBufferRecentSampleCount === "function") {
    const recent = nodeGraphScopeBufferRecentSampleCount(buffer);
    if (recent != null && recent > 0) {
      n = Math.min(buffer.length, recent);
    }
  }
  if (!(n > 0)) {
    const sr = typeof nodeGraphScopeSampleRate === "function"
      ? nodeGraphScopeSampleRate(buffer)
      : 44100;
    n = Math.min(buffer.length, Math.max(1, Math.ceil(Math.max(1, sr) / 60)));
  }
  if (canvas) {
    canvas._vectorDotEnergyAbs = abs || prevAbs;
  }
  let sum = 0;
  let count = 0;
  const start = Math.max(0, buffer.length - n);
  for (let i = start; i < buffer.length; i += 1) {
    const sample = Number(buffer[i]);
    if (!Number.isFinite(sample)) {
      continue;
    }
    sum += Math.max(0, Math.min(1, Math.abs(sample)));
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function nodeGraphVectorDotStampExtents(width, height, size01, pill01) {
  const w = Math.max(1, nodeGraphFiniteNumber(width, 1));
  const h = Math.max(1, nodeGraphFiniteNumber(height, 1));
  const size = Math.max(0, Math.min(1, nodeGraphFiniteNumber(size01)));
  const pill = Math.max(0, Math.min(1, nodeGraphFiniteNumber(pill01)));
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  const r = minSide * 0.5 * size;
  const rLong = r + (maxSide * 0.5 * size - r) * pill;
  if (w >= h) {
    return { rx: rLong, ry: r, radius: r };
  }
  return { rx: r, ry: rLong, radius: r };
}

/**
 * Vector Dot — companion to Phosphor Dot. Cheap 2D disc, smoothstep edge blur,
 * hue+brightness, one energy gather per frame. No residual FBO, no gradients.
 */
function drawNodeGraphVectorDotItem(renderer, item, pixelRatio) {
  const buffer = item?.buffer;
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  const canvas = typeof nodeGraphModuleScopeLocalFallbackCanvas === "function"
    ? nodeGraphModuleScopeLocalFallbackCanvas(item?.slot)
    : null;
  if (!canvas || !syncNodeGraphModuleScopeLocalFallbackCanvas(
    canvas,
    screenElement,
    pixelRatio,
    1,
  )) {
    return;
  }
  if (buffer) {
    if (typeof renderNodeGraphModuleScopeAnalyzer === "function") {
      renderNodeGraphModuleScopeAnalyzer(item.slot, buffer);
    }
  }
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(item?.slot)
    : null;
  const settings = typeof nodeGraphVectorDotSettingsForNode === "function"
    ? nodeGraphVectorDotSettingsForNode(node)
    : {};
  const energy = nodeGraphVectorDotFrameEnergy01(buffer, canvas);
  const lcd = node?.type === "lcdDot"
    || settings.faceStyle === "lcd"
    || renderer === "lcdDot";
  const lampBright = clampNodeSliderValue(
    nodeGraphFiniteNumber(settings.dot1Brightness ?? settings.brightness),
    0,
    1,
  );
  const hue = typeof nodeGraphHueDegFromHex === "function"
    ? nodeGraphHueDegFromHex(settings.dot1Color || settings.color || "")
    : (Number.isFinite(Number(settings.hue)) ? Number(settings.hue) : 25);
  let bg;
  if (lcd && typeof nodeGraphNumberReadoutLcdBgCss === "function") {
    bg = nodeGraphNumberReadoutLcdBgCss(settings);
  } else {
    const bgHue = typeof nodeGraphHueDegFromHex === "function"
      ? nodeGraphHueDegFromHex(settings.backgroundColor || settings.background)
      : 220;
    const bgAmt = clampNodeSliderValue(nodeGraphFiniteNumber(settings.backgroundBrightness), 0, 1);
    const bgSat = Number(settings.backgroundSaturation);
    bg = typeof nodeGraphHueBrightnessCss === "function"
      ? nodeGraphHueBrightnessCss(bgHue, bgAmt, 1, Number.isFinite(bgSat) ? bgSat : 1)
      : "#000000";
  }
  if (typeof nodeGraphFacePlateApplyCss === "function" && screenElement) {
    nodeGraphFacePlateApplyCss(screenElement, bg);
  }
  // Native GL face (number-readout pen: plate rects, SDF stamps, inset shadow).
  const pen = nodeGraphNumberReadoutGlBeginFace(canvas);
  if (!pen) {
    return;
  }
  const bgRgba = nodeGraphGlLinesCss(bg);
  nodeGraphNumberReadoutGlPenRect(pen, 0, 0, canvas.width, canvas.height, [bgRgba[0] * 255, bgRgba[1] * 255, bgRgba[2] * 255], 1);
  nodeGraphNumberReadoutGlPenFlush(pen);
  let stampFailed = false;
  const stamp = (style, alpha, additive) => {
    const r = TraceDotSprite.drawTarget(pen, cx, cy, radius, blur, style, alpha, additive);
    if (r === "failed") stampFailed = true;
  };
  const width = canvas.width;
  const height = canvas.height;
  const lcdModule = node?.type === "lcdDot";
  const params = node?.params && typeof node.params === "object" ? node.params : {};
  const size01 = clampNodeSliderValue(
    nodeGraphFiniteNumber(
      lcdModule ? (params.size ?? settings.dot1Size) : settings.dot1Size,
    ),
    0,
    1,
  );
  const posX = lcdModule
    ? clampNodeSliderValue(nodeGraphFiniteNumber(params.posX), -1, 1)
    : 0;
  const posY = lcdModule
    ? clampNodeSliderValue(nodeGraphFiniteNumber(params.posY), -1, 1)
    : 0;
  const stampShape = typeof normalizeTraceStampShape === "function"
    ? normalizeTraceStampShape(settings.shape)
    : String(settings.shape || "circle");
  const shapeParam = clampNodeSliderValue(
    nodeGraphFiniteNumber(settings.shapeParam ?? (stampShape === "oval" ? settings.pill : settings.squircle)),
    0,
    1,
  );
  const stretch = stampShape === "oval" ? shapeParam : 0;
  const extents = nodeGraphVectorDotStampExtents(width, height, size01, stretch);
  const radius = extents.radius;
  const blur = clampNodeSliderValue(
    nodeGraphFiniteNumber(settings.lineThickness ?? settings.blur),
    0,
    1,
  );
  const blend = typeof nodeGraphScopeStereoBlendMode === "function"
    ? nodeGraphScopeStereoBlendMode(settings.stereoBlend)
    : (settings.stereoBlend || (lcd ? "source-over" : "combine"));
  const composite = lcd
    ? "source-over"
    : (typeof nodeGraphScopeStereoBlendComposite === "function"
      ? nodeGraphScopeStereoBlendComposite(blend)
      : (blend === "combine" ? "lighter" : blend));
  const e = Math.max(0, Math.min(1, energy));
  const amount = Math.max(0, Math.min(1, e * lampBright));
  const shape = {
    rx: extents.rx,
    ry: extents.ry,
    shape: stampShape,
    shapeParam,
  };
  const maxX = Math.max(0, width * 0.5 - extents.rx);
  const maxY = Math.max(0, height * 0.5 - extents.ry);
  const cx = width * 0.5 + posX * maxX;
  const cy = height * 0.5 - posY * maxY;
  if (lcd) {
    const ghostAmt = clampNodeSliderValue(nodeGraphFiniteNumber(settings.unlitSegments), 0, 1);
    let inkCss = settings.dot1Color || settings.color || "#1a2216";
    let ghostCss = inkCss;
    if (typeof nodeGraphNumberReadoutLcdInkRgb === "function") {
      const rgb = nodeGraphNumberReadoutLcdInkRgb(settings);
      inkCss = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
    }
    // Unlit ghost is parked vs the plate, not vs live Foreground — changing
    // ink brightness must not recolor the skeleton.
    if (typeof nodeGraphHueBrightnessRgb01 === "function"
      && typeof nodeGraphNumberReadoutLcdHueDeg === "function") {
      const hueDeg = nodeGraphNumberReadoutLcdHueDeg(
        { dot1Color: settings.dot1Color ?? settings.color },
        settings.dot1Color ?? settings.color,
        210,
      );
      const plateAmt = clampNodeSliderValue(
        nodeGraphFiniteNumber(settings.backgroundBrightness),
        0,
        1,
      );
      const satN = Number(settings.dot1Saturation ?? settings.colorSaturation);
      const sat = Number.isFinite(satN) ? clampNodeSliderValue(satN, 0, 1) : 0.9;
      const ghostBright = plateAmt + (0.2 - plateAmt) * 0.45;
      const [gr, gg, gb] = nodeGraphHueBrightnessRgb01(hueDeg, ghostBright, sat);
      ghostCss = `rgb(${Math.round(gr * 255)} ${Math.round(gg * 255)} ${Math.round(gb * 255)})`;
    }
    if (ghostAmt > 0.001 && radius > 0.05) {
      stamp({ ...shape, color: ghostCss, amount: 1 }, ghostAmt, false);
    }
    // Digital In: on = opaque live ink. Do not fade live with energy (that
    // made the "on" stamp look like a second ghost).
    const last = Number(buffer && buffer.length ? buffer[buffer.length - 1] : 0);
    const lit = Number.isFinite(last) && Math.abs(last) >= 0.5;
    if (lit && radius > 0.05) {
      stamp({ ...shape, color: inkCss, amount: 1 }, 1, false);
    }
    nodeGraphNumberReadoutGlPenLcdInnerShadow(
      pen,
      0,
      0,
      width,
      height,
      settings.innerShadowDistance,
      settings.innerShadowSharpness,
      settings.innerShadowOffsetX,
      settings.innerShadowOffsetY,
    );
    if (typeof nodeGraphNumberReadoutApplyLcdLightCutout === "function") {
      nodeGraphNumberReadoutApplyLcdLightCutout(screenElement, canvas);
    }
  } else if (amount > 0 && radius > 0.05) {
    // Additive for Combine / Add; other blend modes composite "over".
    const inkSat = Number(settings.dot1Saturation ?? settings.colorSaturation);
    stamp({
      ...shape,
      hue,
      amount,
      saturation: Number.isFinite(inkSat) ? inkSat : 1,
    }, 1, composite === "lighter");
  }
  if (stampFailed) {
    nodeGraphDisplayGlFailed(canvas, "vector dot: SDF stamp shader unavailable");
    return;
  }
  nodeGraphNumberReadoutGlEndFace(canvas, pen);
  const punch = lcd
    ? (typeof nodeGraphLcdDisplayLightStrength === "number" ? nodeGraphLcdDisplayLightStrength : 2 / 3)
    : amount;
  if (screenElement?.dataset) {
    screenElement.dataset.lightSource = "screen";
    screenElement.dataset.lightStrength = String(punch);
  }
  if (typeof setNodeGraphLightStrength === "function" && screenElement) {
    setNodeGraphLightStrength(screenElement, punch);
  }
  if (typeof recordNodeGraphModuleScopeRenderMetrics === "function") {
    recordNodeGraphModuleScopeRenderMetrics(1, 1);
  }
}


