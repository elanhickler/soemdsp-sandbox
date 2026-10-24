// Scope slot registry / monitors / drawable queries (Phase D).
// Load after scopes.js. Extract-only.

function registerNodeGraphModuleScopeSlot(moduleElement, options = {}) {
  const nodeId = moduleElement?.dataset?.node || options.nodeId || "";
  if (!nodeId) {
    return null;
  }
  const prior = nodeGraphModuleScopeState.slots.get(nodeId);
  if (prior?._faceLayoutObserver) {
    try {
      prior._faceLayoutObserver.disconnect();
    } catch (_error) {
      // Best-effort.
    }
    prior._faceLayoutObserver = null;
  }
  const scopeElement = options.scopeElement
    || moduleElement?.querySelector?.(".node-module-scope-window")
    || null;
  const slot = {
    element: moduleElement,
    nodeId,
    scopeElement,
    type: options.type || moduleElement?.dataset?.nodeType || "",
  };
  if (options.viewDrag !== false) {
    bindNodeGraphModuleScopeWindowEvents(scopeElement);
  }
  if (scopeElement && typeof applyNodeGraphResourceConstraintMarks === "function") {
    applyNodeGraphResourceConstraintMarks(
      scopeElement,
      typeof nodeGraphModuleResourceConstraintsForType === "function"
        ? nodeGraphModuleResourceConstraintsForType(slot.type)
        : "",
    );
  }
  nodeGraphModuleScopeState.slots.set(nodeId, slot);
  if (typeof invalidateNodeGraphModuleScopeFaceLayout === "function") {
    invalidateNodeGraphModuleScopeFaceLayout(slot);
  }
  if (typeof ensureNodeGraphModuleScopeFaceLayoutObserver === "function") {
    ensureNodeGraphModuleScopeFaceLayoutObserver(slot);
  }
  if (slot.type === "rasterRgb" && typeof scheduleNodeGraphRasterRgbPump === "function") {
    scheduleNodeGraphRasterRgbPump();
  }
  // A new module element (spawned or re-rendered) has a blank face canvas.
  const freshFace = !prior || prior.element !== moduleElement;
  // Patch load registers many slots; don't queue a full scope pass while
  // stopped (each schedule used to reflow every face via HasModelDisplay).
  const livePlaying = typeof nodeGraphModuleScopePaused !== "function" || !nodeGraphModuleScopePaused();
  if (livePlaying) {
    scheduleNodeGraphModuleScopeDraw();
  }
  // Spawned while playing: the live pass only paints faces that have a
  // capture frame (and idle-hold / unchanged-trace skips can hold it off), so
  // a face dropped in during Play stayed blank with no plate. Give a fresh
  // face its plate now, exactly like Stop / Pause spawn; the live loop draws
  // over it on its next frame.
  if (
    (!livePlaying || freshFace)
    && typeof scopePaintEnsureColdPlate === "function"
    && typeof scopePaintEngineState === "function"
    && typeof requestAnimationFrame === "function"
  ) {
    // ES-3 / ES-4: spawned while stopped or paused. Param faces paint now
    // (no engine needed); a buffer face spawned while stopped shows its cold
    // plate after the face canvas is sized, never stale pixels.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (nodeGraphModuleScopeState.slots.get(nodeId) !== slot) return;
      if (typeof nodeGraphFacePaintKindFor === "function" && nodeGraphFacePaintKindFor(slot) === "param") {
        // One param pass per frame however many slots a patch load registers.
        if (!nodeGraphModuleScopeState.paramPaintQueued && typeof paintNodeGraphParamFacesNow === "function") {
          nodeGraphModuleScopeState.paramPaintQueued = true;
          requestAnimationFrame(() => {
            nodeGraphModuleScopeState.paramPaintQueued = false;
            paintNodeGraphParamFacesNow();
          });
        }
      } else {
        // Stopped or paused spawn: no frame to hold, so plate it like Stop.
        // Retry for up to ~1.5 s while the face is still laying out.
        let tries = 0;
        const plate = () => {
          if (nodeGraphModuleScopeState.slots.get(nodeId) !== slot) return;
          if (!livePlaying && scopePaintEngineState() === "playing") return;
          const ok = scopePaintEnsureColdPlate(slot, { create: true, force: true, assumeStopped: true });
          if (!ok && tries < 30) {
            tries += 1;
            setTimeout(plate, 50);
          }
        };
        plate();
      }
    }));
  }
  return slot;
}

/**
 * Init / full patch load during Play: reused Output (same id, same element)
 * never hits the freshFace plate above, and live draw waits on capture rings,
 * so the GPU workspace had no display quad — not even a black square.
 * Wipe leftover tapes, plate every visible buffer face, then rebuild GL.
 */
function nodeGraphPlateFacesAfterPatchLoad() {
  const plate = () => {
    const liveIds = new Set(
      (nodeGraphMvp?.patch?.nodes || []).map((node) => String(node?.id || "")).filter(Boolean),
    );
    if (typeof nodeGraphModuleScopePersistentCanvases !== "undefined" && nodeGraphModuleScopePersistentCanvases?.forEach) {
      for (const [id, canvas] of [...nodeGraphModuleScopePersistentCanvases.entries()]) {
        if (typeof nodeGraphWaterfallWipeHistory === "function") {
          nodeGraphWaterfallWipeHistory(canvas);
        }
        if (!liveIds.has(String(id))) {
          nodeGraphModuleScopePersistentCanvases.delete(id);
        }
      }
    }
    if (typeof scopePaintEnsureColdPlates === "function") {
      scopePaintEnsureColdPlates({ create: true, force: true, assumeStopped: true, replaceTape: true });
    }
    if (typeof nodeGraphVisibleModuleScopeSlots === "function") {
      const ratio = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
      for (const slot of nodeGraphVisibleModuleScopeSlots()) {
        const face = slot?.scopeElement;
        const canvas = face?.querySelector?.("canvas");
        if (!canvas) continue;
        if ((!(canvas.width > 1) || !(canvas.height > 1))
          && typeof syncNodeGraphModuleScopeLocalFallbackCanvas === "function") {
          syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, face, ratio);
        }
        if (canvas.width > 1 && canvas.height > 1) continue;
        if (typeof nodeGraphGlLinesFillBlack === "function") {
          nodeGraphGlLinesFillBlack(canvas);
        }
      }
    }
    if (typeof nodeGraphViewportCullFlushNow === "function") {
      nodeGraphViewportCullFlushNow();
    }
    if (typeof nodeGraphModuleGeometryPublishVisible === "function") {
      nodeGraphModuleGeometryPublishVisible();
    }
    if (typeof nodeGraphGlGraphRebuildPlates === "function") {
      nodeGraphGlGraphRebuildPlates();
    }
    if (typeof nodeGraphGlGraphPresent === "function") {
      nodeGraphGlGraphPresent();
    }
    if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
      scheduleNodeGraphModuleScopeDraw();
    }
    if (typeof scopePaintNotifyFaceLoops === "function") {
      scopePaintNotifyFaceLoops({ force: true });
    }
  };
  plate();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      plate();
      requestAnimationFrame(plate);
    });
  }
}

function unregisterNodeGraphModuleScopeSlot(nodeId) {
  const slot = nodeGraphModuleScopeState.slots.get(nodeId);
  const burnCanvas = slot?.scopeElement?.querySelector?.(
    ":scope > .node-module-scope-local-fallback-canvas",
  );
  if (burnCanvas && typeof disposeNodeGraphScope2dBurnRendererForCanvas === "function") {
    disposeNodeGraphScope2dBurnRendererForCanvas(burnCanvas);
  }
  if (slot?._faceLayoutObserver) {
    try {
      slot._faceLayoutObserver.disconnect();
    } catch (_error) {
      // Best-effort.
    }
    slot._faceLayoutObserver = null;
  }
  slot && (slot._faceLayoutInHost = null);
  nodeGraphModuleScopeState.slots.delete(nodeId);
  nodeGraphModuleScopeState.lightDisplayStates.delete(nodeId);
  nodeGraphModuleScopeState.modelFrameTimes.delete(nodeId);
  nodeGraphModuleScopeState.clockPhasors.delete(nodeId);
  nodeGraphModuleScopeState.oscillatorPhasors.delete(nodeId);
  if (typeof nodeGraphSampleWaveformClearViewKeys === "function") {
    nodeGraphSampleWaveformClearViewKeys(nodeId);
  } else if (typeof nodeGraphSampleWaveformViewStates !== "undefined") {
    nodeGraphSampleWaveformViewStates.delete(nodeId);
  }
}

function nodeGraphModuleScopeSlotIsMirrorSubscribed(slot) {
  const id = String(slot?.nodeId || "");
  if (!id) return false;
  return typeof nodeGraphMetamoduleChildIsMirrorSubscribed === "function"
    && nodeGraphMetamoduleChildIsMirrorSubscribed(id);
}

function nodeGraphModuleScopeSlots() {
  return [...nodeGraphModuleScopeState.slots.values()]
    .filter((slot) => {
      if (!slot.element?.isConnected || !slot.scopeElement) return false;
      // Hidden owned children still paint when mirrored onto a Metamodule shell.
      if (slot.element.hidden && !nodeGraphModuleScopeSlotIsMirrorSubscribed(slot)) {
        return false;
      }
      return true;
    });
}

function nodeGraphModuleScopeSlotDisplayVisible(slot) {
  if (!slot?.element?.isConnected || !slot.scopeElement) {
    return false;
  }
  if (slot.element.hidden && !nodeGraphModuleScopeSlotIsMirrorSubscribed(slot)) {
    return false;
  }
  const patchNode = typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(slot.nodeId)
    : null;
  if (
    slot.nodeId &&
    typeof nodeGraphNodeIsBypassed === "function" &&
    nodeGraphNodeIsBypassed(slot.nodeId)
  ) {
    return false;
  }
  // Use DisplayVisibleForUi so custom faces (Number Readout, Knob, LED, …)
  // stay live when the global "Show displays" toggle is off. That flag only
  // hides analyzer scopes — not always-on module plates.
  const type = patchNode?.type || slot.type || "";
  if (typeof nodeGraphModuleDisplayVisibleForUi === "function") {
    return nodeGraphModuleDisplayVisibleForUi(type, patchNode?.ui || {});
  }
  if (nodeGraphMvp?.moduleOscilloscopesVisible === false) {
    return false;
  }
  const normalizedUi = patchNode?.ui && typeof nodeGraphEffectivePatchNodeUi === "function"
    ? nodeGraphEffectivePatchNodeUi(patchNode.ui, type)
    : (patchNode?.ui || {});
  return normalizedUi?.oscilloscopeHidden !== true;
}

function nodeGraphModuleScopeSlotIsDrawable(slot) {
  return nodeGraphModuleScopeSlotDisplayVisible(slot);
}

function nodeGraphVisibleModuleScopeSlotsUncached() {
  const slots = nodeGraphModuleScopeSlots().filter(nodeGraphModuleScopeSlotIsDrawable);
  if (typeof nodeGraphScreenSoloAllowsNode !== "function" || !nodeGraphScreenSoloIsActive?.()) {
    return slots;
  }
  return slots.filter((slot) => nodeGraphScreenSoloAllowsNode(slot?.nodeId));
}

function nodeGraphVisibleModuleScopeSlots() {
  // Inside a draw frame the list is computed once (see
  // runNodeGraphModuleScopeDrawFrame); callers get their own array copy.
  const memo = typeof nodeGraphModuleScopeState === "object"
    ? nodeGraphModuleScopeState?.visibleSlotsFrameMemo
    : null;
  if (!memo) {
    return nodeGraphVisibleModuleScopeSlotsUncached();
  }
  if (!memo.slots) {
    memo.slots = nodeGraphVisibleModuleScopeSlotsUncached();
  }
  return memo.slots.slice();
}

function nodeGraphVisibleModuleScopeNodeIds() {
  return new Set(nodeGraphVisibleModuleScopeSlots()
    .map((slot) => String(slot?.nodeId || ""))
    .filter(Boolean));
}

function nodeGraphModuleScopeHasDrawableSlots() {
  return nodeGraphVisibleModuleScopeSlots().length > 0;
}

function nodeGraphModuleScopeMonitorFingerprint(monitors = []) {
  return normalizeNodeGraphPatchMonitors(monitors)
    .map(nodeGraphMonitorEndpointKey)
    .sort()
    .join("|");
}

function nodeGraphModuleScopeIsOscillatorType(type) {
  return nodeGraphModuleIsRealtimeOscillatorType(type);
}

function nodeGraphModuleScopeIsAdditiveType(type) {
  return type === "additiveOut" || type === "additiveGenerator";
}

function nodeGraphDefaultModuleScopeMonitors(patch = nodeGraphMvp?.patch) {
  return (Array.isArray(patch?.nodes) ? patch.nodes : [])
    .flatMap((node) => {
      const modeSource = typeof nodeGraphModuleSelectedDisplayMode === "function"
        ? nodeGraphModuleSelectedDisplayMode(node)?.source
        : null;
      const xPort = String(modeSource?.x || "").trim();
      const yPort = String(modeSource?.y || "").trim();
      if (xPort && yPort) {
        const pair = [{ io: "output", node: node.id, port: xPort }];
        if (yPort !== xPort) {
          pair.push({ io: "output", node: node.id, port: yPort });
        }
        return pair;
      }
      if (nodeGraphModuleScopeIsOscillatorType(node?.type)) {
        return [{
          io: "output",
          node: node.id,
          port: nodeGraphOscillatorSelectedOutputPort(node),
        }];
      }
      const inputs = nodeGraphPatchNodeInputPorts(node);
      if (inputs.length) {
        return [{
          io: "input",
          node: node.id,
          port: inputs[0],
        }];
      }
      const outputs = nodeGraphPatchNodeOutputPorts(node);
      if (!outputs.length) {
        return [];
      }
      const port = outputs.includes("Out") ? "Out" : outputs[0];
      return [{
        io: "output",
        node: node.id,
        port,
      }];
    });
}

/** Outgoing jack names from this node (patch cables only). */
function nodeGraphModuleOutgoingOutputPorts(nodeId) {
  const id = String(nodeId || "");
  const connected = new Set();
  if (!id) {
    return connected;
  }
  const connections = Array.isArray(nodeGraphMvp?.patch?.connections)
    ? nodeGraphMvp.patch.connections
    : [];
  for (let i = 0; i < connections.length; i += 1) {
    const connection = connections[i];
    if (String(connection?.sourceNode || "") !== id) {
      continue;
    }
    const port = String(connection?.sourcePort || "").trim();
    if (port) {
      connected.add(port);
    }
  }
  return connected;
}

/**
 * Oscillator face source port: prefer Wave when that outlet is cabled (or when
 * nothing is cabled — native tap mask defaults to Wave). Otherwise the first
 * connected shape tap (Saw/Ramp/Square/Tri/Sine) so unused taps stay unevaluated.
 */
function nodeGraphOscillatorSelectedOutputPort(node) {
  const outputs = nodeGraphPatchNodeOutputPorts(node);
  const connected = nodeGraphModuleOutgoingOutputPorts(node?.id);
  const wavePort = outputs.includes("Wave")
    ? "Wave"
    : (outputs.includes("Wave Out") ? "Wave Out" : "");
  if (wavePort) {
    if (connected.size === 0 || connected.has(wavePort) || connected.has("Out")) {
      return wavePort;
    }
  }
  // Stereo osc (Filter Morph): live cable, Left first, then Right.
  if (outputs.includes("Wave L") || outputs.includes("Wave R")) {
    const leftLive = connected.has("Wave L")
      || connected.has("Left")
      || connected.has("Out")
      || connected.has("Wave")
      || connected.has("Mono");
    const rightLive = connected.has("Wave R") || connected.has("Right");
    if (connected.size === 0 || leftLive || (!rightLive && outputs.includes("Wave L"))) {
      return outputs.includes("Wave L") ? "Wave L" : "Wave R";
    }
    if (rightLive) {
      return "Wave R";
    }
  }
  for (let i = 0; i < outputs.length; i += 1) {
    const port = outputs[i];
    if (connected.has(port)) {
      return port;
    }
  }
  return wavePort || outputs[0] || "Out";
}

// nodeGraphModuleScopeCaptureMonitors → node-graph-module-scope-capture.js
function nodeGraphModuleScopeHasModelDisplay() {
  return nodeGraphVisibleModuleScopeSlots().some((slot) => {
    const renderer = nodeGraphModuleDisplayRendererForSlot(slot);
    const outputs = nodeGraphPatchNodeOutputPorts(nodeGraphModuleScopeNodeForSlot(slot));
    return slot.type === "clock" ||
      slot.type === "transport" ||
      // Hypersaw face paints from data-bus Phases (no sample buffer).
      renderer === "hypersawBurn" ||
      renderer === "softpopFace" ||
      renderer === "tSeriesFace" ||
      renderer === "videoFeedbackFace" ||
      renderer === "videoDelayFace" ||
      renderer === "aberrationFace" ||
      renderer === "screenBendFace" ||
      renderer === "placeFace" ||
      nodeGraphModuleScopeIsOscillatorType(slot.type) ||
      (["waterfall", "dotOscilloscope", "valueOscilloscope", "lineBurnOscilloscope", "scope1dTrace", "led"].includes(slot.type) &&
        nodeGraphModuleScopeConnectionsTo(slot.nodeId, "In").length > 0) ||
      (slot.type === "scope1dTraceStereo" && (
        nodeGraphModuleScopeConnectionsTo(slot.nodeId, "Left").length > 0
        || nodeGraphModuleScopeConnectionsTo(slot.nodeId, "Right").length > 0
      )) ||
      (["scope2d", "scope2dTrace", "phosphorLight"].includes(renderer) && (
        // Prefer live X/Y wires. Do NOT treat dry Thru ports alone as a model:
        // pure 2D Phosphor faces now always declare outputs ["X","Y"] for thrus,
        // which used to make hasModelDisplay true with empty capture buffers.
        (
          nodeGraphModuleScopeConnectionsTo(slot.nodeId, "X").length > 0 &&
          nodeGraphModuleScopeConnectionsTo(slot.nodeId, "Y").length > 0
        ) || (
          // Generators (Lorenz, Chua, Filter Morph, …): declared XY outs, not dry thrus.
          outputs.includes("X")
          && outputs.includes("Y")
          && nodeGraphModuleDefinitions[slot.type]?.visualSink !== true
        ) || (
          outputs.includes("Wave L")
          && outputs.includes("Wave R")
          && nodeGraphModuleDefinitions[slot.type]?.visualSink !== true
        )
      )) ||
      (slot.type === "gain" && nodeGraphModuleScopeConnectionsTo(slot.nodeId, "In").length > 0) ||
      (slot.type === "output" && nodeGraphModuleScopeOutputConnectionList(
        nodeGraphModuleScopeOutputInputConnections(slot.nodeId),
      ).length > 0);
  });
}

function nodeGraphModuleScopeHasRenderableSlots() {
  return nodeGraphVisibleModuleScopeSlots().some((slot) => slot?.scopeElement);
}

