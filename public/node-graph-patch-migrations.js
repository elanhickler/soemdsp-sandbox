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

// Pulse Train Antialiasing (pulse_train v41): choices are 0 Quant / 1 Rand /
// 2 Dither / 3 AA. A saved patch with no value gets 0 Quant (the definition
// default is now AA, which would change how old patches sound). Earlier (v34):
// choices are 0 Quant / 1 Rand /
// 2 Dither. Every saved value keeps its meaning: 0 (old Off) -> 0 Quant,
// 1 Random -> 1 Rand, 2 Dither -> 2, v32/v33 3 None and 4 PolyBLEP -> 0 Quant
// (None is Quant now; anything outside 0..2 -> 0). Idempotent without a
// version marker: the new range 0..2 is left alone, only 3+ is rewritten.
function migrateNodeGraphPulseTrainAntialiasing(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : null;
  if (!nodes) return patch;
  for (const node of nodes) {
    if (!node || node.type !== "pulseTrain" || !node.params || typeof node.params !== "object") continue;
    if (!Object.hasOwn(node.params, "antialiasing")) {
      node.params.antialiasing = 0;
      continue;
    }
    const v = Math.round(Number(node.params.antialiasing));
    // The saved range copy (paramMeta.antialiasing) still lists three choices
    // and max 2: drop those keys so the definition's four apply (no-op on a
    // second pass, the copy is gone).
    const meta = node.paramMeta && typeof node.paramMeta === "object" ? node.paramMeta.antialiasing : null;
    if (meta && typeof meta === "object" && Number(meta.max) === 2) {
      for (const k of ["choices", "max", "mid", "def", "choiceOriginMin"]) delete meta[k];
    }
    if (v === 0 || v === 1 || v === 2 || v === 3) continue;
    node.params.antialiasing = typeof node.params.antialiasing === "number" ? 0 : "0";
  }
  return patch;
}

// Pulse Train Stretch (graph 296): was the span multiplier v itself (slider
// 1..8 skew, typed values < 1 allowed); now s in -1..+1 with m = (1+s)^2 below
// 0 and Count^s above. Old v converts to the s that gives the same m:
// v >= 1 -> min(1, ln v / ln max(Count, 2)) (v = 1 -> 0), 0 < v < 1 ->
// sqrt(v) - 1, v <= 0 -> 0. Count is the saved Count param.
// Old-format marker: the saved range copy (paramMeta.stretch) still says
// skew / min 1 / default 1 (every saved patch carries it). Without that copy
// only v > 1 is unmistakably old; v <= 1 then reads as the new scale (an old
// copy-less patch at exactly 1 would play m = Count). The old range keys are
// dropped so the new definition range applies, which also makes a second pass
// a no-op.
function nodeGraphPulseTrainStretchMetaIsOld(meta) {
  if (!meta || typeof meta !== "object") return false;
  return meta.sliderCurve === "skew" || Number(meta.min) >= 1 || Number(meta.def) === 1;
}

function migrateNodeGraphPulseTrainStretch(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : null;
  if (!nodes) return patch;
  for (const node of nodes) {
    if (!node || node.type !== "pulseTrain" || !node.params || typeof node.params !== "object") continue;
    const meta = node.paramMeta && typeof node.paramMeta === "object" ? node.paramMeta.stretch : null;
    const metaOld = nodeGraphPulseTrainStretchMetaIsOld(meta);
    const has = Object.hasOwn(node.params, "stretch");
    const raw = has ? node.params.stretch : undefined;
    const v = Number(raw);
    if (has && (metaOld || v > 1)) {
      const count = Number(node.params.count);
      const base = count > 2 ? count : 2;
      let sNew = 0;
      if (v >= 1) sNew = Math.min(1, Math.log(v) / Math.log(base));
      else if (v > 0) sNew = Math.sqrt(v) - 1;
      node.params.stretch = typeof raw === "number" ? sNew : String(sNew);
    }
    if (metaOld) {
      for (const k of ["min", "max", "mid", "def", "sliderCurve", "nonlinearSlider", "curveAmount", "tooltip"]) delete meta[k];
    }
  }
  return patch;
}

// Pulse Train Count is continuous (pulse_train v37). Every saved patch carries
// a range copy of Count (paramMeta.count) with the old step 1, which would keep
// the slider on integers. Old-copy marker: step 1 and not the new maxDigits 4.
// Its step and maxDigits keys are dropped so the definition (step any,
// maxDigits 4) applies; a second pass is a no-op, and a step the user sets
// later is kept. Count values are untouched (integers play bit-identically).
function migrateNodeGraphPulseTrainCountStep(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : null;
  if (!nodes) return patch;
  for (const node of nodes) {
    if (!node || node.type !== "pulseTrain") continue;
    const meta = node.paramMeta && typeof node.paramMeta === "object" ? node.paramMeta.count : null;
    if (!meta || typeof meta !== "object") continue;
    if (Number(meta.step) !== 1 || Number(meta.maxDigits) === 4) continue;
    delete meta.step;
    delete meta.maxDigits;
  }
  return patch;
}

// ƒ replaces BPM on jacks (graph 302). Transport "BPM" in becomes "f" (beat
// rate in Hz, BPM = ƒ x 60). Old patches keep their tempo: every cable into the
// old BPM jack (Host BPM included, which still outputs raw BPM) gets an
// Attenuverter x 1/60 between, so the same number lands as the same tempo.
// Idempotent: a converted patch has no "BPM" Transport input.
function migrateNodeGraphFInsteadOfBpm(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : null;
  const connections = Array.isArray(patch?.connections) ? patch.connections : null;
  if (!nodes || !connections) return patch;
  const byId = new Map(nodes.map((node) => [String(node?.id), node]));
  const usedIds = new Set(byId.keys());
  const added = [];
  for (const c of connections) {
    if (!c) continue;
    const dst = byId.get(String(c.destinationNode));
    if (dst?.type !== "transport" || !/^bpm( in)?$/i.test(String(c.destinationPort || "").trim())) continue;
    let k = 1;
    while (usedIds.has(`attenuverter-${k}`)) k += 1;
    const id = `attenuverter-${k}`;
    usedIds.add(id);
    nodes.push({
      id,
      type: "attenuverter",
      gx: Number(dst.gx || 0) - 6,
      gy: Number(dst.gy || 0),
      params: { amplitude: 1 / 60, offset: 0 },
    });
    added.push({ sourceNode: c.sourceNode, sourcePort: c.sourcePort, destinationNode: id, destinationPort: "In", tracePoints: [] });
    c.sourceNode = id;
    c.sourcePort = "Out";
    c.destinationPort = "f";
    c.tracePoints = [];
  }
  connections.push(...added);
  return patch;
}

function migrateNodeGraphPatchToCurrent(patch) {
  return migrateNodeGraphFInsteadOfBpm(migrateNodeGraphPulseTrainCountStep(migrateNodeGraphPulseTrainStretch(
    migrateNodeGraphPulseTrainAntialiasing(migrateNodeGraphRetiredRmsMono(patch)),
  )));
}
