// No-op definitions for debug-only APIs.
// - renderNodeGraphExecutionPlanDebug & co.: the bottom debug panel they drew
//   was removed (Oct 2026); live-runtime / slider / render code still calls
//   them, so these no-ops are now the only definitions in every build.
// - Execution debug API / plan export: sync_soundemote_io.ps1 omits
//   node-graph-execution-debug-api.js and node-graph-debug-copy.js from the
//   live shell; the sandbox loads the real files after this one, which
//   overwrite these globals.
// Keep this file in release (do not add its name to $releaseOmitScriptSubstrings).

function renderNodeGraphExecutionPlanDebug() {}
function renderNodeGraphExecutionSummarySelection() {}
function toggleDebugSections() {}

function installNodeGraphDebugApi() {}
function stopNodeGraphMockInputDebug() {}
function downloadNodeGraphLivePlanJson() {
  return { ok: false, error: "live plan export is not included in this build" };
}
function serializeNodeGraphExecutionPlanDebug() {
  return "{}";
}
function serializeNodeGraphExecutionPlanApiDebug() {
  return {};
}
function nodeGraphLastRenderDebug() {
  return null;
}
function nodeGraphRuntimeBoundaryDebug() {
  return null;
}
function nodeGraphExecutionParameterSnapshot() {
  return [];
}
function nodeGraphSoemdspObjectConcept() {
  return null;
}
function nodeGraphSoemdspRuntimeMapping() {
  return null;
}
function nodeGraphSoemdspRuntimeSketch() {
  return null;
}
function fallbackCopyTextToClipboard() {
  return false;
}
async function copyNodeGraphRuntimeSketch() {}
async function copyNodeGraphExecutionJson() {}
async function startNodeGraphMockInputDebug() {}
