function nodeInteractionHelpText(target) {
  if (!(target instanceof Element)) {
    return "";
  }
  const helpTarget = target.closest(
    "[data-interaction-help], [data-tooltip-key], [data-native-title-disabled], button, input, textarea, select, .node-slider-readout, .node-knob-face, .node-plugin-slider-face, .node-transport-bpm-face, .node-port, .node-io-row, .node-param-port, .node-wire-hit-path, .node-wire-path, .node-execution-order-badge, .node-execution-order li[data-node], .dsp-node, #nodeGraphZoomSurface, #nodeGraphWorldLayer, #nodeGraphWorkspace",
  );
  if (!helpTarget) {
    return "";
  }
  return nodeInteractionMouseHint(helpTarget);
}

function nodeGraphInteractionHelpEventTarget(event) {
  const native = event?.target;
  if (!(native instanceof Element)) {
    return native;
  }
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace || !workspace.classList.contains("gl-graph-on") || !workspace.contains(native)) {
    return native;
  }
  if (typeof nodeGraphGlHitIsLiveHtml === "function" && nodeGraphGlHitIsLiveHtml(native)) {
    return native;
  }
  // Face widgets keep native pointer events, so GPU chrome never sees them.
  // Map the widget under the cursor to the hidden param control (dataset.tooltip).
  if (typeof nodeGraphModuleFaceHoverControl === "function") {
    const faceControl = nodeGraphModuleFaceHoverControl(event);
    if (faceControl) {
      return faceControl;
    }
  }
  if (typeof nodeGraphGlHitKeepsNativeTarget === "function" && nodeGraphGlHitKeepsNativeTarget(native)) {
    return native;
  }
  if (typeof nodeGraphGlHitHoverElement === "function") {
    const hit = nodeGraphGlHitHoverElement(event);
    if (hit) {
      return hit;
    }
  }
  return native;
}

function nodeGraphSelectionHelpText() {
  return "";
}

function composeNodeInteractionHelpText(text = "") {
  const selectionText = nodeGraphSelectionHelpText();
  if (!selectionText) {
    return text;
  }
  return text ? `${text}\n${selectionText}` : selectionText;
}

function normalizeNodeInteractionButtonLabel(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeInteractionButtonLabel(button) {
  if (!button) {
    return "";
  }
  return normalizeNodeInteractionButtonLabel(
    button.getAttribute("aria-label") ||
      button.getAttribute("title") ||
      button.title ||
      button.textContent ||
      "",
  );
}

function nodeGraphControlAuthoredTooltip(element) {
  if (!element) {
    return "";
  }
  const own = String(element.dataset?.tooltip || "").trim();
  if (own) {
    return own;
  }
  const sliderId = element.dataset?.sliderTarget;
  if (sliderId) {
    const slider = document.getElementById(sliderId);
    const fromTarget = String(slider?.dataset?.tooltip || "").trim();
    if (fromTarget) {
      return fromTarget;
    }
  }
  const row = element.classList?.contains("node-parameter-row")
    ? element
    : element.closest?.(".node-parameter-row");
  const range = row?.querySelector?.("input[type='range']");
  return String(range?.dataset?.tooltip || "").trim();
}

function nodeGraphControlGestureHelp(element, slider) {
  if (element.classList.contains("node-knob-face") && !element.classList.contains("is-slider-look")) {
    return nodeGraphTooltipText("slider.knob");
  }
  if (slider && typeof nodeSliderShouldDisplayChoices === "function"
    && nodeSliderShouldDisplayChoices(slider)
    && typeof nodeSliderShouldDivideChoicesVisibly === "function"
    && nodeSliderShouldDivideChoicesVisibly(slider)) {
    return nodeGraphTooltipText("slider.choices");
  }
  return nodeGraphTooltipText("slider.numeric");
}

function nodeInteractionMouseHint(element) {
  if (element.dataset.interactionHelp) {
    return element.dataset.interactionHelp;
  }
  const isParamControl = element.classList.contains("node-slider-readout")
    || element.classList.contains("node-knob-face")
    || element.classList.contains("node-plugin-slider-face")
    || element.classList.contains("node-transport-bpm-face")
    || element.classList.contains("node-parameter-row")
    || element.matches?.("input[type='range']");
  if (!isParamControl) {
    const tooltipText = nodeGraphElementTooltipText(element);
    if (tooltipText) {
      return tooltipText;
    }
  }
  const alias = element.dataset.alias || "";
  if (element.id === "nodeGraphWorkspace" || element.id === "nodeGraphZoomSurface" || element.id === "nodeGraphWorldLayer") {
    return nodeGraphTooltipText("workspace.pan");
  }
  if (element.classList.contains("node-drag-handle")) {
    return nodeGraphTooltipText("module.drag");
  }
  if (element.classList.contains("dsp-node")) {
    return nodeGraphTooltipText("module.drag");
  }
  if (element.classList.contains("node-action-button")) {
    return nodeGraphTooltipText("module.actions");
  }
  if (element.classList.contains("node-display-settings-button")) {
    return nodeGraphTooltipText("module.displaySettings");
  }
  if (element.classList.contains("node-metaparameter-button")) {
    return nodeGraphTooltipText("module.metaparameters");
  }
  if (element.classList.contains("node-bypass-button")) {
    return nodeGraphTooltipText("module.bypass");
  }
  if (element.classList.contains("node-execution-order-badge")) {
    const state = element.dataset.executionState || "inactive";
    if (state === "active") {
      return nodeGraphTooltipText("module.executionActive", { order: element.textContent });
    }
    if (state === "bypassed") {
      return nodeGraphTooltipText("module.executionBypassed");
    }
    return nodeGraphTooltipText("module.executionInactive");
  }
  if (element.matches(".node-execution-order li[data-node]")) {
    const order = element.dataset.executionOrder || "?";
    const nodeName = nodeGraphNodeDisplayName(element.dataset.node);
    return nodeGraphTooltipText("module.executionListItem", { order, nodeName });
  }
  if (isParamControl) {
    const slider = document.getElementById(element.dataset.sliderTarget)
      || (element.matches?.("input[type='range']") ? element : null)
      || element.querySelector?.("input[type='range']")
      || element.closest?.(".node-parameter-row")?.querySelector?.("input[type='range']");
    const authored = nodeGraphControlAuthoredTooltip(element);
    const gesture = nodeGraphControlGestureHelp(element, slider);
    if (authored && gesture) {
      return `${authored} | ${gesture}`;
    }
    return authored || gesture;
  }
  if (element.classList.contains("node-port")) {
    const action = element.classList.contains("parameter-output")
      ? nodeGraphTooltipText("wire.parameterOutput")
      : element.classList.contains("output")
      ? nodeGraphTooltipText("wire.output")
      : nodeGraphTooltipText("wire.input");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-io-row")) {
    const action = element.dataset.io === "output"
      ? nodeGraphTooltipText("wire.output")
      : nodeGraphTooltipText("wire.input");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-param-port")) {
    const action = nodeGraphTooltipText("wire.modulationInput");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-wire-hit-path") || element.classList.contains("node-wire-path")) {
    const action = nodeGraphTooltipText("wire.selected");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-text-box-input")) {
    return nodeGraphTooltipText("module.textBoxEdit");
  }
  if (element.matches("input, textarea, select")) {
    return nodeGraphTooltipText("common.editText");
  }
  if (element.id === "nodeGraphResizeHandle") {
    return nodeGraphTooltipText("workspace.resize");
  }
  if (element.id === "nodeZoomOutButton" || element.id === "nodeZoomResetButton" || element.id === "nodeZoomInButton") {
    return nodeGraphTooltipText("view.zoomHelp");
  }
  if (element.id === "nodeSnapGridViewButton") {
    return nodeGraphTooltipText("view.snapGrid");
  }
  if (element.id === "nodeSettingsViewButton") {
    return nodeGraphTooltipText("view.patchSettings") || "Script page";
  }
  if (element.id === "nodeModularInfiniteViewButton") {
    return nodeGraphTooltipText("view.infiniteModular")
      || "Computer view — infinite canvas, no crop.";
  }
  if (element.id === "nodeModularWindowedViewButton"
    || element.id === "nodeSceneToggleModularWindowedView") {
    return "Performance view — shows displays with “Show in performance view” enabled (same as F).";
  }
  if (element.id === "nodeUndoButton" || element.id === "nodeRedoButton") {
    return nodeGraphTooltipText("history.help");
  }
  if (element.id === "nodeUserUiSettingsButton") {
    return nodeGraphTooltipText("settings.uiSettingsOpen");
  }
  if (element.id === "nodeGridToggleButton") {
    return nodeGraphTooltipText("view.gridHelp");
  }
  if (element.id === "nodeTooltipToggleButton") {
    return nodeGraphTooltipsShown()
      ? (nodeGraphTooltipText("view.tipsCycleOff") || "Hide docked tips (T).")
      : (nodeGraphTooltipText("view.tipsCycleEmbed") || "Show docked tips (T).");
  }
  if (element.id === "nodeAppChromeBarsToggleButton") {
    const mode = typeof nodeGraphAppChromeBarsMode === "function"
      ? nodeGraphAppChromeBarsMode()
      : (nodeGraphMvp.appChromeBarsVisible === false ? "none" : "all");
    if (mode === "all") {
      return nodeGraphTooltipText("view.appBarsHide") || "Hide top bar (V). Press again to hide the bottom bar too.";
    }
    if (mode === "topHidden") {
      return "Hide bottom bar too (V).";
    }
    return nodeGraphTooltipText("view.appBarsShow") || "Show top and bottom bars (V).";
  }
  if (element.id === "nodeSliderAmountToggleButton") {
    return nodeGraphTooltipText(nodeGraphMvp.sliderAmountVisible ? "view.sliderAmountHide" : "view.sliderAmountShow");
  }
  if (element.id === "nodeSliderPositionToggleButton") {
    return nodeGraphTooltipText(nodeGraphMvp.sliderPositionVisible ? "view.sliderPositionHide" : "view.sliderPositionShow");
  }
  if (element.dataset.paletteNode) {
    return nodeGraphTooltipText("actions.addModule");
  }
  if (element.id === "nodeRenderButton") {
    return nodeGraphTooltipText("audio.render");
  }
  if (element.id === "nodeDeleteButton" || element.id === "nodeSceneHistoryDeleteButton") {
    return nodeGraphTooltipText("actions.deleteSelection");
  }
  if (element.matches("button")) {
    return nodeInteractionButtonLabel(element) || nodeGraphTooltipText("common.activate");
  }
  return nodeGraphTooltipText("common.interact");
}

// Fit the tip to its box without live layout probes on hover.
// The old binary search wrote font-size ~10 times per change and read
// scrollHeight each time; that was the performance hit. This path:
//   1. returns immediately when the composed text is unchanged (setNodeInteractionHelp)
//   2. caches by text + box WxH + UIDEV minimum, so the same tip is free
//   3. binary-searches with canvas measureText (no layout) on a cache miss
//   4. applies one inline font-size; if CSS wrapping still overflows, one
//      short live shrink from that size down to the minimum, then clip
// UIDEV --node-tooltip-text-size is the floor. Short tips grow to fill the
// box. Phone auto-height + scroll skips the search (overflow-y is auto).
const nodeInteractionHelpAbsoluteMaxFontPx = 120;
const nodeInteractionHelpLineHeight = 1.25;
const nodeInteractionHelpFitCache = { key: "", sizePx: 0 };
let nodeInteractionHelpMeasureCtx = null;
let nodeInteractionHelpResizeObserver = null;
let nodeInteractionHelpFitRaf = 0;

function nodeInteractionHelpMeasureContext() {
  if (!nodeInteractionHelpMeasureCtx) {
    nodeInteractionHelpMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  return nodeInteractionHelpMeasureCtx;
}

function nodeInteractionHelpMinFontPx(cs) {
  const raw = Number.parseFloat(cs.getPropertyValue("--node-tooltip-text-size"));
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(8, Math.min(96, raw));
  }
  return 12;
}

function nodeInteractionHelpWrapHeightPx(ctx, text, contentW) {
  const fontPx = Number.parseFloat(ctx.font);
  const lineH = fontPx * nodeInteractionHelpLineHeight;
  let lines = 0;
  const paragraphs = String(text).split("\n");
  for (let p = 0; p < paragraphs.length; p += 1) {
    const para = paragraphs[p];
    if (!para) {
      lines += 1;
      continue;
    }
    const words = para.split(" ");
    let current = "";
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      const trial = current ? `${current} ${word}` : word;
      if (ctx.measureText(trial).width <= contentW) {
        current = trial;
        continue;
      }
      if (current) {
        lines += 1;
        current = "";
      }
      if (ctx.measureText(word).width <= contentW) {
        current = word;
        continue;
      }
      let rest = word;
      while (rest) {
        if (ctx.measureText(rest).width <= contentW) {
          current = rest;
          rest = "";
          break;
        }
        let lo = 1;
        let hi = rest.length;
        while (lo < hi) {
          const mid = Math.floor((lo + hi + 1) / 2);
          if (ctx.measureText(rest.slice(0, mid)).width <= contentW) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        if (lo < 1) {
          return Number.POSITIVE_INFINITY;
        }
        lines += 1;
        rest = rest.slice(lo);
      }
    }
    if (current) {
      lines += 1;
    }
  }
  return lines * lineH;
}

function nodeInteractionHelpCanvasFits(ctx, text, fontPx, fontFamily, contentW, contentH) {
  ctx.font = `${fontPx}px ${fontFamily}`;
  return nodeInteractionHelpWrapHeightPx(ctx, text, contentW) <= contentH + 0.5;
}

function nodeInteractionHelpLiveOverflows(help) {
  return help.scrollHeight > help.clientHeight + 0.5
    || help.scrollWidth > help.clientWidth + 0.5;
}

function ensureNodeInteractionHelpResizeObserver(help) {
  if (typeof ResizeObserver !== "function") {
    return;
  }
  if (!nodeInteractionHelpResizeObserver) {
    nodeInteractionHelpResizeObserver = new ResizeObserver(() => {
      if (nodeInteractionHelpFitRaf) {
        return;
      }
      nodeInteractionHelpFitRaf = requestAnimationFrame(() => {
        nodeInteractionHelpFitRaf = 0;
        const el = document.getElementById("nodeInteractionHelp");
        if (el) {
          fitNodeInteractionHelpText(el);
        }
      });
    });
  }
  if (help.dataset.fitResizeObserved === "true") {
    return;
  }
  nodeInteractionHelpResizeObserver.observe(help);
  help.dataset.fitResizeObserved = "true";
}

function fitNodeInteractionHelpText(help = document.getElementById("nodeInteractionHelp")) {
  if (!help) {
    return;
  }
  ensureNodeInteractionHelpResizeObserver(help);
  const text = help.textContent || "";
  if (!text) {
    help.style.removeProperty("font-size");
    help.style.removeProperty("align-items");
    nodeInteractionHelpFitCache.key = "";
    return;
  }
  const boxW = help.clientWidth;
  const boxH = help.clientHeight;
  if (boxW <= 0 || boxH <= 0) {
    return;
  }
  const cs = window.getComputedStyle(help);
  const minFont = nodeInteractionHelpMinFontPx(cs);
  if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
    help.style.fontSize = `${minFont.toFixed(2)}px`;
    help.style.removeProperty("align-items");
    nodeInteractionHelpFitCache.key = "";
    return;
  }
  const cacheKey = `${minFont}|${Math.round(boxW)}|${Math.round(boxH)}|${text}`;
  if (nodeInteractionHelpFitCache.key === cacheKey) {
    const cached = `${nodeInteractionHelpFitCache.sizePx.toFixed(2)}px`;
    if (help.style.fontSize !== cached) {
      help.style.fontSize = cached;
    }
    return;
  }
  const padX = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
  const padY = (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
  const contentW = Math.max(1, boxW - padX);
  const contentH = Math.max(1, boxH - padY);
  const fontFamily = cs.fontFamily || "Consolas, monospace";
  const maxFont = Math.max(
    minFont,
    Math.min(contentH / nodeInteractionHelpLineHeight, nodeInteractionHelpAbsoluteMaxFontPx),
  );
  const ctx = nodeInteractionHelpMeasureContext();
  let low = minFont;
  let high = maxFont;
  let chosen = minFont;
  if (nodeInteractionHelpCanvasFits(ctx, text, high, fontFamily, contentW, contentH)) {
    chosen = high;
  } else if (!nodeInteractionHelpCanvasFits(ctx, text, low, fontFamily, contentW, contentH)) {
    chosen = minFont;
  } else {
    for (let i = 0; i < 10; i += 1) {
      const mid = (low + high) * 0.5;
      if (nodeInteractionHelpCanvasFits(ctx, text, mid, fontFamily, contentW, contentH)) {
        low = mid;
      } else {
        high = mid;
      }
    }
    chosen = low;
  }
  help.style.fontSize = `${chosen.toFixed(2)}px`;
  if (chosen > minFont) {
    const previousAlign = help.style.alignItems;
    help.style.alignItems = "flex-start";
    if (nodeInteractionHelpLiveOverflows(help)) {
      low = minFont;
      high = chosen;
      for (let i = 0; i < 8; i += 1) {
        const mid = (low + high) * 0.5;
        help.style.fontSize = `${mid.toFixed(2)}px`;
        if (nodeInteractionHelpLiveOverflows(help)) {
          high = mid;
        } else {
          low = mid;
        }
      }
      chosen = low;
      help.style.fontSize = `${chosen.toFixed(2)}px`;
    }
    if (previousAlign) {
      help.style.alignItems = previousAlign;
    } else {
      help.style.removeProperty("align-items");
    }
  }
  nodeInteractionHelpFitCache.key = cacheKey;
  nodeInteractionHelpFitCache.sizePx = chosen;
}

function setNodeInteractionHelp(text = "") {
  const help = document.getElementById("nodeInteractionHelp");
  if (help) {
    const composedText = composeNodeInteractionHelpText(text);
    if (help.textContent === composedText) {
      return;
    }
    help.textContent = composedText;
    fitNodeInteractionHelpText(help);
  }
}

function handleNodeInteractionHelp(event) {
  setNodeInteractionHelp(nodeInteractionHelpText(nodeGraphInteractionHelpEventTarget(event)));
}

function attachNodeInteractionHelpTarget(element) {
  element.dataset.interactionHelpReady = "true";
  const showHelp = () => setNodeInteractionHelp(nodeInteractionHelpText(element));
  element.addEventListener("pointerover", showHelp);
  element.addEventListener("mouseover", showHelp);
  element.addEventListener("pointerdown", showHelp);
  element.addEventListener("click", showHelp);
  element.addEventListener("focus", showHelp);
}
