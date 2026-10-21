// Patch migrations are one-shot (APP_POLICY §1).
// Convert every stored patch, then delete the migrator in the same change.
// migrateNodeGraphPatchToCurrent stays as an empty hook so the load path
// does not grow a second copy. A future migrator must be run over all patches
// and removed before the next commit that keeps it.

// Retired type alias: RMS Mono ("rms") loads as RMS Meter ("rmsMeter").
// No stored patch used "rms" when it was removed; this keeps old shared
// patches / URLs loading. In stays In (RMS Meter's L jack id).
const nodeGraphRetiredRmsOutputPorts = Object.freeze({
  "RMS A": "RMS", Out: "RMS", Mono: "RMS", A: "RMS", Ana: "RMS", rms: "RMS",
  "RMS D": "dB", D: "dB", Dig: "dB",
});

function migrateNodeGraphRetiredRmsMono(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : null;
  if (!nodes) return patch;
  const ids = new Set();
  for (const node of nodes) {
    if (!node || node.type !== "rms") continue;
    ids.add(String(node.id));
    node.type = "rmsMeter";
    const p = node.params && typeof node.params === "object" ? node.params : {};
    const secToMs = (v, fallback) => {
      const n = Number(v);
      const ms = Number.isFinite(n) && n > 0 ? n * 1000 : fallback;
      return String(Math.min(2000, Math.max(1, ms)));
    };
    // Old Window (s) is the averaging time; Attack/Release (s) 0 = off.
    const windowMs = secToMs(p.window, 300);
    node.params = {
      attack: Number(p.attack) > 0 ? secToMs(p.attack, 300) : windowMs,
      release: Number(p.release) > 0 ? secToMs(p.release, 300) : windowMs,
      amplitude: "1",
    };
  }
  if (!ids.size) return patch;
  const keep = [];
  for (const c of Array.isArray(patch.connections) ? patch.connections : []) {
    if (c && ids.has(String(c.sourceNode))) {
      const mapped = nodeGraphRetiredRmsOutputPorts[c.sourcePort];
      if (!mapped) continue;  // Gate had no RMS Meter equivalent
      c.sourcePort = mapped;
    }
    keep.push(c);
  }
  if (Array.isArray(patch.connections)) patch.connections = keep;
  return patch;
}

function migrateNodeGraphPatchToCurrent(patch) {
  return migrateNodeGraphRetiredRmsMono(patch);
}
