// Scope2d / line-burn / hypersaw burn paint from scopes.js (Phase D).
// Load before scopes.js.

function nodeGraphScope2dBurnLayers(settings, dotSpace) {
  const layers = [];
  if (settings?.dot1Enabled !== false) {
    // Size is a share of the face min side (0…1); the drawers take authored
    // px at the 96px reference.
    const side = Math.max(1, nodeGraphFiniteNumber(dotSpace, 1));
    const sizePx = (typeof dotUnitInkPx === "function" ? dotUnitInkPx(settings.dot1Size) : Math.max(0, Math.min(1, Number(settings.dot1Size) || 0)) * 96);
    const radius = typeof nodeGraphScopeSize01ToRadiusPx === "function"
      ? nodeGraphScopeSize01ToRadiusPx(side, sizePx)
      : (typeof PhosphorDrawer !== "undefined" && PhosphorDrawer.size01ToRadiusPx
        ? PhosphorDrawer.size01ToRadiusPx(side, sizePx)
        : Math.max(0, (typeof faceInkPx === "function" ? faceInkPx(sizePx, side) : 0) * 0.5));
    layers.push({
      // Blur 0 hard disc … 1 full soft gaussian.
      blur: nodeGraphTraceDisplayClampStampBlur(settings.lineThickness),
      brightness: Math.max(0, nodeGraphFiniteNumber(settings.dot1Brightness)),
      color: nodeGraphScopeHexColorToRgb(settings.dot1Color),
      radius,
    });
  }
  // Size 0 is valid (1px floor) — only brightness gates the layer.
  return layers.filter((layer) => layer.brightness > 0 && layer.radius > 0);
}


function nodeGraphPhosphorLiveScratchCanvas(canvas, width, height) {
  if (!canvas || !(width > 0) || !(height > 0)) {
    return null;
  }
  let scratch = canvas._phosphorLiveScratch;
  if (!scratch) {
    scratch = document.createElement("canvas");
    canvas._phosphorLiveScratch = scratch;
  }
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
    canvas._phosphorLiveScratchInk = false;
  }
  return scratch;
}

/** Idle beam: all samples at origin (0 amp) or no motion (0 Hz). */
function nodeGraphScope2dPointsAreIdleBeam(points, square) {
  const cx = (nodeGraphFiniteNumber(square?.left)) + (nodeGraphFiniteNumber(square?.width)) * 0.5;
  const cy = (nodeGraphFiniteNumber(square?.top)) + (nodeGraphFiniteNumber(square?.height)) * 0.5;
  let n = 0;
  let maxFromCenter = 0;
  let maxStep = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < (points?.length || 0); i += 1) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      continue;
    }
    maxFromCenter = Math.max(maxFromCenter, Math.hypot(p.x - cx, p.y - cy));
    if (n > 0) {
      maxStep = Math.max(maxStep, Math.hypot(p.x - px, p.y - py));
    }
    px = p.x;
    py = p.y;
    n += 1;
  }
  return {
    silent: n === 0 || maxFromCenter < 0.75,
    parked: n > 0 && maxStep < 0.5,
  };
}

function drawNodeGraphScope2dEnergyBurnPath(item, pixelRatio, pathPoints, settings, options = {}) {
  if (typeof nodeGraphPhosphorEnergyGlEnsure !== "function"
    || typeof nodeGraphPhosphorEnergyGlStepBeams !== "function"
    || typeof nodeGraphPhosphorEnergyGlPresent !== "function") {
    return false;
  }
  const canvas = nodeGraphScope2dBurnCanvasForSlot(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  const sync = syncNodeGraphScope2dBurnCanvas(
    canvas,
    screenElement,
    pixelRatio,
    nodeGraphFacePlateDensity(settings),
  );
  if (!sync.synced || !canvas) {
    return false;
  }
  // Opaque plate — never CSS screen (that was the green/teal bleed).
  canvas.style.mixBlendMode = "normal";
  const context = nodeGraphSharedGlPresentTarget(canvas);
  if (!context) {
    return false;
  }

  const width = canvas.width;
  const height = canvas.height;
  const points = Array.isArray(pathPoints) ? pathPoints : [];
  const endFrame = Number(options.endFrame);
  const startFrame = Number(options.startFrame);
  // Freeze absorbs the whole cursor so resume does not dump a backlog.
  // A live frame absorbs only what this budget actually stamped.
  if (nodeGraphModuleScopePhosphorFrozen() && Number.isFinite(endFrame)) {
    absorbNodeGraphPhosphorDrawCursorOnCanvas(canvas, endFrame);
  }

  const energyGl = nodeGraphPhosphorEnergyGlEnsure(canvas, width, height, "_phosphorEnergyGl");
  if (!energyGl) {
    return false;
  }
  const liveGl = nodeGraphBurnFaceLiveLayer(canvas, energyGl, width, height);

  const trail = typeof PhosphorResidual !== "undefined" && PhosphorResidual.migrateTrail
    ? PhosphorResidual.migrateTrail(settings || {}, PhosphorResidual.DEFAULT_TRAIL ?? 0.3)
    : clampNodeSliderValue(Number.isFinite(Number(settings?.trail)) ? Number(settings.trail) : 0.3, 0, 1);
  const ghost = typeof PhosphorResidual !== "undefined" && PhosphorResidual.migrateGhost
    ? PhosphorResidual.migrateGhost(settings || {}, PhosphorResidual.DEFAULT_GHOST ?? 0.25)
    : clampNodeSliderValue(nodeGraphFiniteNumber(settings?.ghost), 0, 1);
  const dotSpace = nodeGraphScope2dStrokeSpace(canvas);
  const layers = nodeGraphScope2dBurnLayers(settings, dotSpace);
  const layer = layers[0] || null;
  // Empty area is gradient(backgroundBrightness), not a hue plate.
  const plateRaw = Number(settings?.backgroundBrightness);
  const plate01 = Number.isFinite(plateRaw) ? Math.max(0, Math.min(1, plateRaw)) : 0;
  const plateStops = typeof nodeGraphPhosphorGradientStopsForDraw === "function"
    ? nodeGraphPhosphorGradientStopsForDraw(settings, "#75ebff")
    : (typeof nodeGraphPhosphorGradientStopsFromSettings === "function"
      ? nodeGraphPhosphorGradientStopsFromSettings(settings, "#75ebff")
      : settings?.gradientStops);
  let plateCss = "#000000";
  if (typeof nodeGraphSampleGradientStopsRgb === "function") {
    const rgb = nodeGraphSampleGradientStopsRgb(plateStops, plate01, "#000000");
    const r = Number(rgb?.[0]);
    const g = Number(rgb?.[1]);
    const b = Number(rgb?.[2]);
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      plateCss = "rgb(" + (r & 255) + "," + (g & 255) + "," + (b & 255) + ")";
    }
  }
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, plateCss);
  }
  nodeGraphPhosphorApplyGradientLut(energyGl, settings, "#75ebff");
  if (liveGl) {
    nodeGraphPhosphorApplyGradientLut(liveGl, settings, "#75ebff");
  }

  // Engine speed 0 (and other pause paths): never step energy — hold FBO as-is.
  const frozen = nodeGraphModuleScopePhosphorFrozen();
  // Audio posts and vsync are two free-running clocks, so some display frames
  // get zero new samples. Stepping decay on those frames dims the live trace
  // for one frame (rhythmic blink). Hold a short run of empty frames; after
  // that keep stepping so a silenced / unplugged trace still fades out.
  const emptyStreak = points.length > 0 ? 0 : (canvas._nodeGraphBurnEmptyStreak || 0) + 1;
  canvas._nodeGraphBurnEmptyStreak = emptyStreak;
  const holdEmptyFrame = emptyStreak > 0 && emptyStreak <= 3;
  if (frozen || holdEmptyFrame) {
    // Present only (below). No residual step, no bleed, no deposit.
  } else if (layer) {
    // Continuous CRT trail only: always pack stamps along chords between
    // samples (c1091b4 / 8bc05d90). Dots Only / Full Dot Economy are retired —
    // they produced beads or over-fat solid mush; ignore sticky patch flags.
    const sizeForGain = Math.max(0, Math.min(1, (typeof dotUnitInkPx === "function" ? dotUnitInkPx(settings?.dot1Size) : Math.max(0, Math.min(1, Number(settings?.dot1Size) || 0)) * 96) / 32));
    // Live trace = Bright (independent of Burn), Trail decay only.
    // Burn layer deposit = Bright x Burn (new strokes only; stored energy is
    // never rescaled). Ghost/Trail only set the decay in the step.
    const burnAmount = typeof PhosphorResidual !== "undefined" && PhosphorResidual.clampBurnAmount
      ? PhosphorResidual.clampBurnAmount(settings?.burnAmount)
      : 1;
    const liveBrightness = nodeGraphScope2dEnergyBurnDepositGain(layer.brightness, sizeForGain);
    const beamBrightness = nodeGraphScope2dEnergyBurnDepositGain(
      layer.brightness * burnAmount,
      sizeForGain,
    );
    const beamOptions = {
      trail,
      ghost,
      pathPoints: points,
      radius: Math.max(0.35, layer.radius),
      brightness: beamBrightness,
      blur: nodeGraphTraceDisplayClampStampBlur(layer.blur),
      mode: String(settings?.drawMode || "") === "lines" ? "segments" : "dots",
      maxDots: Math.max(
        64,
        Math.min(
          8192,
          Math.round(
            Number(settings?.dotBudget)
            || nodeGraphScope2dMaxSamplesPerFrame(canvas)
            || 2048,
          ),
        ),
      ),
      fullEconomy: false,
      fullDotEconomy: false,
      dotsOnly: false,
      samplesOnly: String(settings?.drawMode || "") === "dots",
      verticesOnly: false,
      coverLength: String(settings?.drawMode || "budget") === "length",
    };
    const stepped = nodeGraphPhosphorEnergyGlStepBeams(energyGl, beamOptions);
    void stepped;
    if (liveGl) {
      nodeGraphPhosphorEnergyGlStepBeams(liveGl, { ...beamOptions, ghost: 0, brightness: liveBrightness });
    }
    if (!frozen && Number.isFinite(endFrame)) {
      const stats = energyGl.lastPathStats;
      let cursor = endFrame;
      const total = Math.max(0, Math.floor(nodeGraphFiniteNumber(stats?.totalPoints)));
      const consumed = Math.max(0, Math.floor(nodeGraphFiniteNumber(stats?.consumedPoints)));
      if (stats?.truncated && total > 0 && Number.isFinite(startFrame) && endFrame > startFrame) {
        const frac = Math.max(0, Math.min(1, consumed / total));
        cursor = startFrame + (endFrame - startFrame) * frac;
        if (cursor >= endFrame) {
          cursor = endFrame;
        }
      }
      absorbNodeGraphPhosphorDrawCursorOnCanvas(canvas, cursor);
    }
    const stamps = Math.max(
      0,
      Math.floor(nodeGraphFiniteNumber(energyGl.lastDepositCount)),
    );
    if (typeof recordNodeGraphModuleScopeRenderMetrics === "function" && stamps > 0) {
      recordNodeGraphModuleScopeRenderMetrics(stamps, stamps);
    }
  } else if (typeof nodeGraphPhosphorEnergyGlStep === "function") {
    // Fade + bleed when no drawable layer (trail still softens outward).
    nodeGraphPhosphorEnergyGlStep(energyGl, { trail, ghost, depositGain: 0, bleed: 0.1 });
    if (liveGl) {
      nodeGraphPhosphorEnergyGlStep(liveGl, { trail, ghost: 0, depositGain: 0, bleed: 0.1 });
    }
  }

  if (!frozen) {
    const lastPoint = lastNodeGraphScope2dPathPoint(points);
    if (lastPoint) {
      canvas._nodeGraphScope2dLastDrawnPoint = lastPoint;
    }
  }

  // Opaque brightness then LUT. No hue fill, no lighter, no alpha fade.
  // 2D Phosphor keeps scope2dOpaque. 1D line burn uses its own program.
  context.setTransform(1, 0, 0, 1, 0, 0);
  // Present max(live, burn); burn layer alone only if the live layer is unavailable.
  const presentGl = (liveGl && nodeGraphBurnFaceMaxComposite(liveGl, energyGl)) || energyGl;
  const presented = options.lineBurnOpaque === true
    ? nodeGraphPhosphorEnergyGlPresent(presentGl, 1, { lineBurnOpaque: true, plate: plate01 })
    : nodeGraphPhosphorEnergyGlPresent(presentGl, 1, { scope2dOpaque: true, plate: plate01 });
  // Same-size copy from the shared device into the face (no 2D fallback).
  if (presented) {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    if (!nodeGraphSharedGlPresent(context, width, height)) {
      nodeGraphDisplayGlFailed(canvas, "2D phosphor burn: GL present failed");
    }
  }
  return true;
}


// Live trace layer (Bright only) for burn faces. The main energy renderer
// (canvas._phosphorEnergyGl) is the burn / ghost layer: new strokes deposit
// Bright x Burn and decay with Trail + Ghost. The live layer gets the same
// strokes at Bright, decays with Trail only (no Ghost hang), and is presented
// as max(live, burn) so Burn 0 still shows the trace at Bright and the two
// layers never add (no double-brightening). Owner-tracked: when the burn
// renderer is replaced (wipe / context loss) the live layer is rebuilt too.
function nodeGraphBurnFaceLiveLayer(canvas, energyGl, width, height) {
  if (!canvas || !energyGl || typeof nodeGraphPhosphorEnergyGlEnsure !== "function") {
    return null;
  }
  if (canvas._phosphorLiveEnergyGlOwner !== energyGl && canvas._phosphorLiveEnergyGl) {
    if (typeof nodeGraphPhosphorEnergyGlDestroy === "function") {
      try {
        nodeGraphPhosphorEnergyGlDestroy(canvas._phosphorLiveEnergyGl);
      } catch (_error) { /* ignore */ }
    }
    canvas._phosphorLiveEnergyGl = null;
  }
  canvas._phosphorLiveEnergyGlOwner = energyGl;
  return nodeGraphPhosphorEnergyGlEnsure(canvas, width, height, "_phosphorLiveEnergyGl");
}

// max(live, burn) into live.write (scratch: every live step fully rewrites
// write before swapping), returned as a present view whose read = that scratch.
function nodeGraphBurnFaceMaxComposite(live, burn) {
  const gl = live?.gl;
  if (!gl || gl !== burn?.gl || !live.read || !live.write || !burn.read
    || live.width !== burn.width || live.height !== burn.height) {
    return null;
  }
  let prog = gl._nodeGraphBurnFaceMaxProgram;
  if (!prog) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, "#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}");
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, "#version 300 es\nprecision highp float;uniform sampler2D uSrc;out vec4 o;void main(){o=texelFetch(uSrc,ivec2(gl_FragCoord.xy),0);}");
    gl.compileShader(fs);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    prog = { program, uSrc: gl.getUniformLocation(program, "uSrc") };
    gl._nodeGraphBurnFaceMaxProgram = prog;
  }
  const w = live.width;
  const h = live.height;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, live.read.framebuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, live.write.framebuffer);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, live.write.framebuffer);
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, burn.read.texture);
  gl.uniform1i(prog.uSrc, 0);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MAX);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.blendEquation(gl.FUNC_ADD);
  gl.disable(gl.BLEND);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const view = Object.create(live);
  view.read = live.write;
  return view;
}


function drawNodeGraphScope2dRetainedBurn(item, pixelRatio, square, buffer, settings) {
  const canvas = nodeGraphScope2dBurnCanvasForSlot(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  const sync = syncNodeGraphScope2dBurnCanvas(
    canvas,
    screenElement,
    pixelRatio,
    nodeGraphFacePlateDensity(settings),
  );
  if (!sync.synced) {
    return;
  }
  const canvasSquare = nodeGraphScope2dBurnCanvasSquare(canvas);
  if (!canvasSquare) {
    return;
  }
  if (nodeGraphModuleScopePhosphorFrozen()) {
    // Freeze: re-present held energy, absorb sample cursor, no new stamps/decay.
    drawNodeGraphRetainedBurnPath(item, pixelRatio, [], settings, {
      endFrame: Number(buffer?.nodeGraphScopeAbsoluteFrame),
    });
    return;
  }
  // Deposit only samples since last draw (+ bridge). Phosphor residual is the
  // lagging trail — do not re-stamp the full history every frame.
  // c1091b4 / 8bc05d90: keep the newest consecutive window (clamp), do NOT
  // even-subsample across a long undrawn gap — that made high-speed Lorenz
  // look like a downsampled polyline of sparse chords.
  const count = Math.min(buffer?.x?.length || 0, buffer?.y?.length || 0);
  const budget = Math.max(
    64,
    Math.min(8192, Math.round(Number(settings?.dotBudget) || nodeGraphScope2dMaxSamplesPerFrame(canvas) || 2048)),
  );
  const rawStart = nodeGraphScope2dDrawStartIndex(canvas, buffer, count);
  // Do not skip the middle of a long gap. Draw a fuse-spaced prefix and
  // leave the rest undrawn for the next frame.
  const buildCount = Math.min(Math.max(0, count - rawStart), budget * 2);
  const indices = [];
  for (let i = 0; i < buildCount; i += 1) {
    indices.push(rawStart + i);
  }
  let pathPoints = indices.length
    ? buildNodeGraphScope2dPathPoints(canvasSquare, buffer, 0, {
      indices,
      interpolate: false,
      settings,
    })
    : [];
  const bufStart = Number(buffer?.nodeGraphScopeStartFrame);
  const bufEnd = Number(buffer?.nodeGraphScopeAbsoluteFrame);
  const frameAt = (index) => {
    if (!Number.isFinite(bufStart) || !Number.isFinite(bufEnd) || count <= 1) {
      return bufEnd;
    }
    return bufStart + (Math.max(0, index) / count) * (bufEnd - bufStart);
  };
  // Adjacent-frame bridge (soundemote.io): short residual gap only; one vertex.
  pathPoints = bridgeNodeGraphScope2dAdjacentFramePath(
    canvas,
    pathPoints,
    12,
    0,
  );
  drawNodeGraphRetainedBurnPath(item, pixelRatio, pathPoints, settings, {
    startFrame: frameAt(rawStart),
    endFrame: frameAt(rawStart + buildCount),
    parkedBeamHold: true,
    samplesOnly: true,
  });
}


function drawNodeGraphRetainedBurnPath(item, pixelRatio, pathPoints, settings, options = {}) {
  // The one burn path: mono energy + LUT phosphor drawer on the shared device.
  drawNodeGraphScope2dEnergyBurnPath(item, pixelRatio, pathPoints, settings, options);
}


function drawNodeGraphLineBurnOscilloscopeItem(renderer, item, pixelRatio) {
  const buffer = item?.buffer;
  if (!buffer?.length) {
    return;
  }
  renderNodeGraphModuleScopeAnalyzer(item.slot, buffer);
  const settings = nodeGraphLineBurnSettingsForNode(nodeGraphModuleScopeNodeForSlot(item.slot));
  const canvas = nodeGraphScope2dBurnCanvasForSlot(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  // Size face buffer once (layout×dpr × density) — same as 2D phosphor.
  const sync = syncNodeGraphScope2dBurnCanvas(
    canvas,
    screenElement,
    pixelRatio,
    nodeGraphFacePlateDensity(settings),
  );
  if (!sync.synced || !canvas) {
    return;
  }
  const endFrame = Number(buffer.nodeGraphScopeAbsoluteFrame);
  if (nodeGraphModuleScopePhosphorFrozen()) {
    // Freeze held phosphor; absorb cursor so resume does not flood the face.
    drawNodeGraphRetainedBurnPath(item, pixelRatio, [], settings, { endFrame, lineBurnOpaque: true });
    return;
  }
  const nodeId = String(item?.slot?.nodeId || "");
  // Prefer the sink's own Reset capture (full-rate visual input buffer).
  // Only when *fresh* samples arrived this post — stale Reset rings after
  // disconnect used to false-trigger rising edges and snap the pen (Y tears).
  let resetBuffer = null;
  if (nodeId) {
    const own = nodeGraphModuleScopeState.buffers.get(`${nodeId}:Reset`);
    const ownRecent = Math.floor(nodeGraphFiniteNumber(own?.nodeGraphScopeRecentSampleCount));
    if (own && ownRecent > 0) {
      resetBuffer = own;
    } else if (typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
      const wired = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, "Reset");
      const wiredRecent = Math.floor(nodeGraphFiniteNumber(wired?.nodeGraphScopeRecentSampleCount));
      if (wired && wiredRecent > 0) {
        resetBuffer = wired;
      }
    }
  }
  // Points already in canvas pixel space (not workspace screen rect).
  // Undrawn-window path draws every sample since lastDrawn (not just the
  // latest post) so skipped RAF / multi-post gaps no longer Y-jump the pen.
  // Match online: no spatial bridge (that glued stale lastPoint across gaps).
  // Do NOT thin then chord-pack: that is the low-freq faceted stroke with
  // brightness dips at joints (Full Dot Economy cannot fix it — it only packs
  // denser along the same straight chords). Pass every undrawn sample.
  const pathPoints = nodeGraphOneDimensionalBurnFramePoints(
    canvas,
    buffer,
    settings,
    resetBuffer,
  );
  // Prefer buffer absolute frame; fall back to undrawn-window end so the
  // cursor still advances when metadata is partial.
  let cursorEnd = endFrame;
  if (!Number.isFinite(cursorEnd) && typeof nodeGraphOneDimensionalBurnUndrawnWindow === "function") {
    const w = nodeGraphOneDimensionalBurnUndrawnWindow(canvas, buffer);
    if (Number.isFinite(Number(w?.endFrame))) {
      cursorEnd = Number(w.endFrame);
    }
  }
  drawNodeGraphRetainedBurnPath(item, pixelRatio, pathPoints, settings, {
    endFrame: cursorEnd,
    lineBurnOpaque: true,
    // Continuity from chord packing between samples (c1091b4 / 8bc05d90).
    // Do not force samplesOnly — that left sparse beads / stacked discs.
  });
}


function nodeGraphModuleFaceLayoutCssSize(canvas) {
  const id = String(
    canvas?.dataset?.node
    || canvas?.closest?.("[data-node]")?.dataset?.node
    || "",
  ).trim();
  const escaped = id && typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  const moduleEl = id && typeof nodeGraphCachedNodeElement === "function"
    ? nodeGraphCachedNodeElement(".dsp-node", id)
    : (escaped ? document.querySelector(`.dsp-node[data-node="${escaped}"]`) : null);
  const node = id && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  let widthGu = Number(node?.widthGu);
  let heightGu = Number(node?.displayHeightGu);
  let cell = 28;
  // getComputedStyle per paint forced a style recalc every frame. The grid
  // tokens only change with inline styles (settings / resize), so cache the
  // parsed values per module keyed on those style attributes.
  const styleHost = moduleEl || document.documentElement;
  const styleKey = `${styleHost.getAttribute?.("style") || ""}\u0000${document.documentElement.getAttribute("style") || ""}`;
  const cachedTokens = nodeGraphModuleFaceGridTokenCache.get(styleHost);
  if (cachedTokens && cachedTokens.key === styleKey) {
    if (!(widthGu > 0) && cachedTokens.widthGu > 0) widthGu = cachedTokens.widthGu;
    if (!(heightGu > 0) && cachedTokens.heightGu > 0) heightGu = cachedTokens.heightGu;
    if (cachedTokens.cell > 0) cell = cachedTokens.cell;
    return {
      w: widthGu > 0 ? Math.max(1, widthGu * cell) : Math.max(1, canvas?.clientWidth || canvas?.width || 1),
      h: heightGu > 0 ? Math.max(1, heightGu * cell) : Math.max(1, canvas?.clientHeight || canvas?.height || 1),
    };
  }
  try {
    const style = getComputedStyle(styleHost);
    nodeGraphModuleFaceGridTokenCache.set(styleHost, {
      key: styleKey,
      widthGu: Number.parseFloat(style.getPropertyValue("--node-grid-width-units") || ""),
      heightGu: Number.parseFloat(style.getPropertyValue("--node-module-display-height-units") || ""),
      cell: Number.parseFloat(
        style.getPropertyValue("--node-grid-width")
        || style.getPropertyValue("--node-grid-size")
        || "",
      ),
    });
    if (!(widthGu > 0)) {
      const fromCss = Number.parseFloat(style.getPropertyValue("--node-grid-width-units") || "");
      if (fromCss > 0) widthGu = fromCss;
    }
    if (!(heightGu > 0)) {
      const fromCss = Number.parseFloat(style.getPropertyValue("--node-module-display-height-units") || "");
      if (fromCss > 0) heightGu = fromCss;
    }
    const grid = Number.parseFloat(
      style.getPropertyValue("--node-grid-width")
      || style.getPropertyValue("--node-grid-size")
      || "",
    );
    if (grid > 0) cell = grid;
  } catch (_error) {
    // Layout size falls back to the canvas itself.
  }
  return {
    w: widthGu > 0 ? Math.max(1, widthGu * cell) : Math.max(1, canvas?.clientWidth || canvas?.width || 1),
    h: heightGu > 0 ? Math.max(1, heightGu * cell) : Math.max(1, canvas?.clientHeight || canvas?.height || 1),
  };
}

var nodeGraphModuleFaceGridTokenCache = new WeakMap();

function nodeGraphModuleFacePixelScale(canvas) {
  const layout = nodeGraphModuleFaceLayoutCssSize(canvas);
  const sx = Math.max(1, canvas?.width || layout.w) / layout.w;
  const sy = Math.max(1, canvas?.height || layout.h) / layout.h;
  return Math.max(0.25, Math.min(sx, sy));
}

function nodeGraphModuleFaceLayoutCssWidth(canvas) {
  const id = String(
    canvas?.dataset?.node
    || canvas?.closest?.("[data-node]")?.dataset?.node
    || "",
  ).trim();
  const escaped = id && typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  const moduleEl = escaped
    ? document.querySelector(`.dsp-node[data-node="${escaped}"]`)
    : null;
  const node = id && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  let widthGu = Number(node?.widthGu);
  let cell = 28;
  try {
    const style = getComputedStyle(moduleEl || document.documentElement);
    if (!(widthGu > 0)) {
      const fromCss = Number.parseFloat(style.getPropertyValue("--node-grid-width-units") || "");
      if (fromCss > 0) widthGu = fromCss;
    }
    const grid = Number.parseFloat(
      style.getPropertyValue("--node-grid-width")
      || style.getPropertyValue("--node-grid-size")
      || "",
    );
    if (grid > 0) cell = grid;
  } catch (_error) {
    // Layout width falls back to the canvas itself.
  }
  if (widthGu > 0) return Math.max(1, widthGu * cell);
  return Math.max(1, canvas?.clientWidth || canvas?.width || 1);
}

function drawNodeGraphHypersawBurnItem(renderer, item, pixelRatio) {
  // Hypersaw stems: batched quads on a GPU residual plate on the shared GL
  // device (node-graph-module-scope-residual-face-gl.js). No 2D path.
  return drawNodeGraphHypersawBurnGlItem(renderer, item, pixelRatio);
}


function nodeGraphScope2dBurnCanvasSquare(canvas) {
  const width = Math.max(1, nodeGraphFiniteNumber(canvas?.width, 1));
  const height = Math.max(1, nodeGraphFiniteNumber(canvas?.height, 1));
  // Square large enough to cover the rectangle. `fit` zooms ±1 back inside
  // the visible cell. Both axes share that zoom, so the plot stays square.
  const size = Math.max(width, height);
  return {
    fit: Math.min(width, height) / size,
    height: size,
    left: (width - size) * 0.5,
    top: (height - size) * 0.5,
    width: size,
  };
}


function nodeGraphScope2dTraceSeverFarJoins(points) {
  // A 2D stroke is one open run of neighbors. The chord is the extra
  // segment that ties this chunk's first sample to its last: a prepended
  // chunk end, a duplicated start, or a phase reset between blocks.
  // That join is many sample-steps long. A 30 degree arc at one frame
  // (20 Hz @ 240 fps) is still that close — not a half-circle threshold.
  // Consecutive steps along the arc stay connected. 1D is not this path.
  const src = Array.isArray(points) ? points : [];
  const out = [];
  let run = [];
  const pushRun = (pts) => {
    for (let i = 0; i < pts.length; i += 1) {
      out.push(pts[i]);
    }
  };
  const flush = () => {
    const n = run.length;
    if (!n) {
      return;
    }
    if (n < 3) {
      pushRun(run);
      run = [];
      return;
    }
    const dist = [];
    const steps = [];
    for (let i = 1; i < n; i += 1) {
      const d = Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
      dist.push(d);
      if (d > 0.02) {
        steps.push(d);
      }
    }
    if (steps.length < 2) {
      pushRun(run);
      run = [];
      return;
    }
    steps.sort((a, b) => a - b);
    const step = steps[Math.floor((steps.length - 1) * 0.5)];
    const limit = Math.max(step * 4, step + 1.25);
    out.push(run[0]);
    for (let i = 1; i < n; i += 1) {
      const d = dist[i - 1];
      let neighbor = Infinity;
      if (i >= 2) {
        neighbor = Math.min(neighbor, dist[i - 2]);
      }
      if (i < n - 1) {
        neighbor = Math.min(neighbor, dist[i]);
      }
      // Outlier vs the local step: closing chord or phase jump.
      if (d > limit && neighbor < Infinity && d > neighbor * 4) {
        out.push(null);
      }
      out.push(run[i]);
    }
    run = [];
  };
  for (let i = 0; i < src.length; i += 1) {
    const p = src[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      flush();
      if (out.length && out[out.length - 1] !== null) {
        out.push(null);
      }
      continue;
    }
    run.push(p);
  }
  flush();
  return out;
}


function drawNodeGraphScope2dTraceLayer(context, points, dotSpace, settings) {
  if (!context || !Array.isArray(points) || !points.length) {
    return;
  }
  if (settings.dot1Enabled === false) {
    return;
  }
  points = nodeGraphScope2dTraceSeverFarJoins(points);
  if (!points.length) {
    return;
  }
  // XY beam: same woscope quads as 1D Trace. Gaussian coverage indexes the
  // Coverage is brightness. Present shader samples the shared gradient.
  if (settings.channelInk === "flat" && typeof TraceWoscope !== "undefined" && typeof TraceWoscope.draw === "function") {
    const parse = (hex, fallback) => {
      const text = String(hex || fallback).replace("#", "");
      const n = Number.parseInt(text.length === 3
        ? text.split("").map((c) => c + c).join("")
        : text, 16);
      return [
        ((n >> 16) & 255) / 255,
        ((n >> 8) & 255) / 255,
        (n & 255) / 255,
        1,
      ];
    };
    const inks = [settings.dot1Color || "#ff8080", settings.secondaryColor || "#8080ff"];
    let count = 0;
    for (let i = 0; i < inks.length; i += 1) {
      count += TraceWoscope.draw(context, points, {
        size: (typeof dotUnitInkPx === "function" ? dotUnitInkPx(settings.dot1Size) : Math.max(0, Math.min(1, Number(settings.dot1Size) || 0)) * 96),
        color: parse(inks[i], inks[i]),
        faceMinSide: Math.max(1, nodeGraphFiniteNumber(dotSpace, 1)),
        brightness: 1,
        intensity: 1,
        brightAlong: false,
        samplesOnly: String(settings?.drawMode || "") === "dots",
        presentComposite: i === 0 ? "copy" : (settings.stereoBlend || "lighter"),
      }) || 0;
    }
    if (count > 0) {
      recordNodeGraphModuleScopeRenderMetrics(count, count);
      return;
    }
  }
  if (typeof TraceWoscope !== "undefined" && typeof TraceWoscope.draw === "function") {
    const brightRaw = Number(settings.dot1Brightness ?? settings.brightness);
    const intensity = Number.isFinite(brightRaw) ? Math.max(0, brightRaw) : 1;
    const plateN = Number(settings.backgroundBrightness);
    const stops = typeof nodeGraphPhosphorGradientStopsForDraw === "function"
      ? nodeGraphPhosphorGradientStopsForDraw(settings, "#ffffff")
      : (typeof nodeGraphPhosphorGradientStopsFromSettings === "function"
        ? nodeGraphPhosphorGradientStopsFromSettings(settings, "#ffffff")
        : settings.gradientStops);
    const count = TraceWoscope.draw(context, points, {
      size: (typeof dotUnitInkPx === "function" ? dotUnitInkPx(settings.dot1Size) : Math.max(0, Math.min(1, Number(settings.dot1Size) || 0)) * 96),
      color: [1, 1, 1],
      faceMinSide: Math.max(1, nodeGraphFiniteNumber(dotSpace, 1)),
      brightness: intensity,
      intensity,
      brightAlong: true,
      samplesOnly: String(settings?.drawMode || "") === "dots",
      gradientStops: stops,
      plateBrightness: Number.isFinite(plateN) ? Math.max(0, Math.min(1, plateN)) : 0,
      trail: settings.trail,
      ghost: settings.ghost,
      burnAmount: settings.burnAmount,
      tracePresent: true,
    });
    if (count > 0) {
      recordNodeGraphModuleScopeRenderMetrics(count, count);
      return;
    }
  }
  // Native GL only (TraceWoscope); no 2D stroke / dot fallback.
  if (typeof TraceWoscope === "undefined" || typeof TraceWoscope.draw !== "function") {
    nodeGraphDisplayGlFailed(context.canvas, "2D trace: TraceWoscope unavailable");
  }
}


const nodeGraphScope2dTraceHoldByNodeId = new Map();

function nodeGraphScope2dTraceIsSlot(slot) {
  const renderer = typeof nodeGraphModuleDisplayRendererForSlot === "function"
    ? nodeGraphModuleDisplayRendererForSlot(slot)
    : "";
  return renderer === "scope2dTrace" || slot?.type === "scope2dTrace";
}

function nodeGraphScope2dTraceFaceCanvas(slot) {
  const screen = slot?.scopeElement;
  const fromDom = screen?.querySelector?.(
    ":scope > .node-module-scope-vector-trace, :scope > .node-module-scope-local-fallback-canvas, .node-module-scope-vector-trace",
  );
  if (fromDom) {
    return fromDom;
  }
  const nodeId = slot?.nodeId;
  if (nodeId && typeof nodeGraphModuleScopePersistentCanvases !== "undefined") {
    return nodeGraphModuleScopePersistentCanvases.get?.(nodeId) || null;
  }
  return null;
}

function snapshotNodeGraphScope2dTraceHold(canvas, nodeId = "") {
  if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) {
    return null;
  }
  // Held picture lives in a GL texture (kept until the next snapshot / wipe).
  const id = String(nodeId || "");
  const previous = canvas._scope2dTraceHold;
  const hold = nodeGraphGlLinesSnapshot(canvas, { keep: true });
  if (!hold) {
    return null;
  }
  if (previous && previous !== hold) {
    nodeGraphGlLinesReleaseSnapshot(previous);
  }
  canvas._scope2dTraceHold = hold;
  if (id) {
    nodeGraphScope2dTraceHoldByNodeId.set(id, hold);
  }
  return hold;
}

function snapshotAllNodeGraphScope2dTraceFaces() {
  const slots = typeof nodeGraphModuleScopeSlots === "function"
    ? nodeGraphModuleScopeSlots()
    : [];
  for (const slot of slots || []) {
    if (!nodeGraphScope2dTraceIsSlot(slot)) {
      continue;
    }
    snapshotNodeGraphScope2dTraceHold(nodeGraphScope2dTraceFaceCanvas(slot), slot?.nodeId);
  }
}

function blitNodeGraphScope2dTraceHold(slot) {
  const screenElement = slot?.scopeElement;
  const canvas = nodeGraphScope2dTraceFaceCanvas(slot);
  if (!canvas || !screenElement) {
    return false;
  }
  const hold = canvas._scope2dTraceHold
    || nodeGraphScope2dTraceHoldByNodeId.get(String(slot?.nodeId || ""));
  if (hold?.texture && hold.width > 0 && hold.height > 0) {
    if (canvas.width !== hold.width) {
      canvas.width = hold.width;
    }
    if (canvas.height !== hold.height) {
      canvas.height = hold.height;
    }
    const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { transparent: true });
    if (!batch) {
      nodeGraphDisplayGlFailed(canvas, "2D trace hold: shared GL unavailable");
      return false;
    }
    nodeGraphGlLinesImage(batch, hold, 0, 0, hold.width, hold.height, { nearest: true });
    if (!nodeGraphGlLinesEnd(batch)) {
      nodeGraphDisplayGlFailed(canvas, "2D trace hold: GL present failed");
      return false;
    }
  } else {
    const context = nodeGraphSharedGlPresentTarget(canvas);
    if (!context) {
      return false;
    }
    const last = canvas._scope2dTraceLastPoints;
    if (!(Array.isArray(last) && last.length >= 2)) {
      return false;
    }
    const settings = typeof nodeGraphScope2dTraceSettingsForNode === "function"
      ? nodeGraphScope2dTraceSettingsForNode(nodeGraphModuleScopeNodeForSlot(slot))
      : {};
    drawNodeGraphScope2dTraceLayer(context, last, Math.min(canvas.width, canvas.height), settings);
  }
  canvas.classList.add("node-module-scope-vector-trace");
  canvas.style.visibility = "visible";
  canvas.style.opacity = "1";
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(screenElement, 1);
    nodeGraphModuleScopeMarkScreenLit(canvas, 1);
  }
  return true;
}

function restrokeNodeGraphScope2dTraceHold(slot, _pixelRatio) {
  return blitNodeGraphScope2dTraceHold(slot);
}

function holdNodeGraphScope2dTraceFaces() {
  const slots = typeof nodeGraphModuleScopeSlots === "function"
    ? nodeGraphModuleScopeSlots()
    : [];
  let any = false;
  for (const slot of slots || []) {
    if (!nodeGraphScope2dTraceIsSlot(slot)) {
      continue;
    }
    if (blitNodeGraphScope2dTraceHold(slot)) {
      any = true;
    }
  }
  return any;
}

function nodeGraphScope2dTraceBridgeContinues(prev, points) {
  // Prepend only a neighbor of this chunk's first sample. The previous
  // chunk end often still IS this window's last sample; prepending it
  // draws the chord from that end back to the start. Compare to the
  // sample step, not to which end is closer — a short arc's chord is
  // not a half-circle, but it is many steps long.
  if (!prev || !Number.isFinite(prev.x) || !Number.isFinite(prev.y)) {
    return false;
  }
  let first = null;
  let second = null;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      if (first) {
        break;
      }
      continue;
    }
    if (!first) {
      first = p;
      continue;
    }
    second = p;
    break;
  }
  if (!first) {
    return false;
  }
  const toFirst = Math.hypot(first.x - prev.x, first.y - prev.y);
  if (!second) {
    return toFirst <= 1.5;
  }
  const step = Math.hypot(second.x - first.x, second.y - first.y);
  return toFirst <= Math.max(step * 4, 1.5);
}

function drawNodeGraphScope2dTraceItem(renderer, item, pixelRatio) {
  // Pause: restroke the last polyline / blit the hold bitmap. Returning
  // without paint left a blank face when pause had already wiped or covered
  // the live canvas.
  if (typeof scopePaintIsFrozen === "function"
    ? scopePaintIsFrozen()
    : (typeof nodeGraphModuleScopePhosphorFrozen === "function"
      && nodeGraphModuleScopePhosphorFrozen())) {
    restrokeNodeGraphScope2dTraceHold(item?.slot, pixelRatio);
    return;
  }
  const buffer = item?.buffer;
  if (!buffer?.nodeGraphScopeXy || !buffer.x?.length || !buffer.y?.length) {
    return;
  }
  renderNodeGraphModuleScopeAnalyzer(item.slot, buffer);
  const canvas = typeof ensureNodeGraphModuleScopeFaceCanvas === "function"
    ? ensureNodeGraphModuleScopeFaceCanvas(item?.slot, { mode: "tape" })
    : nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  if (typeof nodeGraphWaterfallAbandonTape === "function") {
    nodeGraphWaterfallAbandonTape(canvas);
  }
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  const traceNode = nodeGraphModuleScopeNodeForSlot(item.slot);
  let settings = nodeGraphScope2dTraceSettingsForNode(traceNode);
  if (nodeGraphModuleDefinitions?.[traceNode?.type]?.displayIgnoresAmplitude === true) {
    const amp = Number(traceNode?.params?.amplitude);
    if (Number.isFinite(amp) && Math.abs(amp) > 1e-4) {
      settings = { ...settings, amplitudeDivisor: amp };
    }
  }
  // VECTOR polyline; density scales face buffer for lo-fi (default 1).
  const density = nodeGraphFacePlateDensity(settings, 1);
  const syncOk = typeof syncNodeGraphModuleScopeFaceCanvas === "function"
    ? Boolean(syncNodeGraphModuleScopeFaceCanvas(
      canvas, screenElement, pixelRatio, density, { policy: "tape" },
    )?.synced)
    : syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, density);
  if (!canvas || !syncOk) {
    return;
  }
  if (typeof tagNodeGraphModuleScopeFaceCanvas === "function") {
    tagNodeGraphModuleScopeFaceCanvas(canvas, "tape");
  }
  // Vector class: normal blend. Density < 1 stays pixelated (sync); density ≥ 1
  // clears inline image-rendering so workspace.pixelated-canvas-zoom can crisp
  // zoom-in without mushy bilinear scale.
  canvas.classList.add("node-module-scope-vector-trace");
  if (density < 0.999) {
    canvas.style.imageRendering = "pixelated";
  } else {
    canvas.style.imageRendering = "";
  }
  // Present context handed to TraceWoscope (its GL output is copied in there).
  const context = nodeGraphSharedGlPresentTarget(canvas);
  if (!context) {
    nodeGraphDisplayGlFailed(canvas, "2D trace: no present context");
    return;
  }
  context.imageSmoothingEnabled = density >= 0.999;
  if ("imageSmoothingQuality" in context && density >= 0.999) {
    context.imageSmoothingQuality = "high";
  }
  canvas.dataset.scope2dRenderer = "sample-history-trace-1";
  // Buffer-local square (layout×dpr). Never use item.scopeRect/screenRect —
  // those are workspace screen coords and grow with zoom, so the stroke would
  // walk out of the face and clip into the module chrome.
  const canvasSquare = nodeGraphScope2dTraceCanvasSquare(canvas);
  const bg = nodeGraphFacePlateBackground(settings, nodeGraphScope2dTraceSettingsDefaults.background);
  nodeGraphFacePlateApplyCss(screenElement, bg);
  const sizeKey = `${canvas.width}x${canvas.height}`;
  if (canvas._s2dSizeKey !== sizeKey) {
    canvas._s2dSizeKey = sizeKey;
    canvas._s2dPrimed = false;
    canvas._s2dAbs = 0;
    canvas._s2dLastPoint = null;
  }
  canvas._s2dPrimed = true;
  try {
    const count = Math.min(buffer?.x?.length || 0, buffer?.y?.length || 0);
    const sampleRate = typeof nodeGraphScopeSampleRate === "function"
      ? nodeGraphScopeSampleRate(buffer)
      : (nodeGraphFiniteNumber(buffer?.nodeGraphScopeSampleRate, 44100));
    const abs = Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer?.nodeGraphScopeTotalSampleCount)));
    const prevAbs = Number(canvas._s2dAbs || 0);
    let newCount;
    if (prevAbs > 0 && abs > prevAbs) {
      newCount = Math.min(count, Math.max(1, abs - prevAbs));
    } else {
      newCount = Math.min(count, Math.max(1, Math.ceil(0.05 * Math.max(1, sampleRate))));
    }
    const startIndex = Math.max(0, count - newCount);
    if (abs) {
      canvas._s2dAbs = abs;
    }
    const points = buildNodeGraphScope2dTraceCanvasPoints(canvasSquare, buffer, settings, startIndex);
    if (canvas._s2dLastPoint && points.length
      && nodeGraphScope2dTraceBridgeContinues(canvas._s2dLastPoint, points)) {
      points.unshift(canvas._s2dLastPoint);
    }
    let lastPoint = canvas._s2dLastPoint || null;
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const p = points[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        lastPoint = p;
        break;
      }
    }
    canvas._s2dLastPoint = lastPoint;
    // Need two consecutive finite verts or the stroke is invisible.
    let strokeable = false;
    let run = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        run += 1;
        if (run >= 2) {
          strokeable = true;
          break;
        }
      } else {
        run = 0;
      }
    }
    const lastPoints = canvas._scope2dTraceLastPoints;
    const inkPoints = strokeable
      ? points
      : (Array.isArray(lastPoints) && lastPoints.length >= 2 ? lastPoints : null);
    const dotSpace = Math.min(canvas.width, canvas.height);
    if (!inkPoints) {
      let single = lastPoint;
      if (!single) {
        snapshotNodeGraphScope2dTraceHold(canvas, item?.slot?.nodeId);
        return;
      }
      drawNodeGraphScope2dTraceLayer(context, [single, { x: single.x, y: single.y }], dotSpace, settings);
      canvas._scope2dTraceLastPoints = [single, { x: single.x, y: single.y }];
      snapshotNodeGraphScope2dTraceHold(canvas, item?.slot?.nodeId);
      return;
    }
    const shaped = typeof nodeGraphTraceApplyDrawMode === "function"
      ? nodeGraphTraceApplyDrawMode(inkPoints, settings)
      : inkPoints;
    drawNodeGraphScope2dTraceLayer(context, shaped, dotSpace, settings);
    if (strokeable) {
      canvas._scope2dTraceLastPoints = inkPoints;
    }
    snapshotNodeGraphScope2dTraceHold(canvas, item?.slot?.nodeId);
  } finally {
  }
}


function drawNodeGraphScope2dItem(renderer, item, pixelRatio) {
  const rect = item?.scopeRect;
  const buffer = item?.buffer;
  if (!rect || !buffer?.nodeGraphScopeXy || !buffer.x?.length || !buffer.y?.length) {
    return;
  }
  renderNodeGraphModuleScopeAnalyzer(item.slot, buffer);
  const square = nodeGraphModuleScopeCenteredSquareRect(rect);
  const settings = nodeGraphScope2dSettingsForNode(nodeGraphModuleScopeNodeForSlot(item.slot));
  drawNodeGraphScope2dRetainedBurn(item, pixelRatio, square, buffer, settings);
}

