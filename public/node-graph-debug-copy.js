// Plan export / copy helpers. The on-page Runtime Sketch / Execution JSON
// panels were removed; these compute their text on demand instead.
// Callable via window.soemdspSandboxDebug (alias window.soemdspDebug).
function fallbackCopyTextToClipboard(text) {
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.focus();
  fallback.select();
  fallback.setSelectionRange(0, fallback.value.length);
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) {
    throw new Error("clipboard fallback failed");
  }
}

async function copyTextToClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    fallbackCopyTextToClipboard(text);
  }
}

/** Full compiled execution plan as pretty JSON text (was the Execution JSON panel). */
function nodeGraphExecutionPlanJsonText(plan = compileNodeGraphExecutionPlan()) {
  return serializeNodeGraphExecutionPlanDebug(plan);
}

/** Caller-owned C++ runtime mapping sketch text (was the Runtime Sketch panel). */
function nodeGraphRuntimeSketchText(plan = compileNodeGraphExecutionPlan()) {
  return plan.valid
    ? nodeGraphSoemdspRuntimeSketch(plan)
    : `runtime sketch blocked: ${plan.issues.join(", ")}`;
}

async function copyNodeGraphRuntimeSketch() {
  const text = nodeGraphRuntimeSketchText();
  await copyTextToClipboard(text);
  return text;
}

async function copyNodeGraphExecutionJson() {
  const text = nodeGraphExecutionPlanJsonText();
  await copyTextToClipboard(text);
  return text;
}

// nodeGraphBuildLivePlan() (node-graph-live-plan-runtime.js) is the exact
// flattened, closure-free JSON shape already sent to the browser's
// AudioWorklet (see setPlan in node-live-audio-worklet-core.js) -- the
// same shape a native C++ graph interpreter (soemdsp-sandbox-native's
// native graph-engine) is meant to consume, so it can be tested
// against a real exported patch instead of only synthetic fixtures.
// Returns { ok, filename, nodes, order } or { ok: false, error }.
function downloadNodeGraphLivePlanJson() {
  let plan;
  try {
    plan = nodeGraphBuildLivePlan();
  } catch (error) {
    const message = String(error?.issues?.join(", ") || error?.message || error);
    console.warn("[live plan] export blocked:", message);
    return { ok: false, error: message };
  }
  const json = JSON.stringify(plan, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const rawStem = (typeof nodeGraphPatchFileStem === "function"
    ? nodeGraphPatchFileStem(nodeGraphMvp?.currentSavedPatchFilename || nodeGraphMvp?.loadedPatchSlug || "")
    : "") || "patch";
  const patchName = String(rawStem)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "patch";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${patchName}.live-plan.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { ok: true, filename: anchor.download, nodes: plan.nodes.length, order: plan.order.length };
}
