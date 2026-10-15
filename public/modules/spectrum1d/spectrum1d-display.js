// 1D Spectrum: classic magnitude-vs-frequency analyzer face (line / filled).
// Data comes from the Spectrogram worklet FFT (same analysis gate set):
//   Spectrum      compressed EMA column, log10(1 + mag·100)   (shared with Spectrogram)
//   SpectrumRaw   raw |X[k]| of the last hop (1D Spectrum only, no EMA)
//   SpectrumGain  [window sum] so a full-scale sine reads 0 dBFS
//   FftSize       hop meta (fftLen, halfN, bins, hop, sampleRate, hopSerial, …)
// Display only. No DSP here.

const nodeGraphSpectrumLineStates = new Map();
const NODE_GRAPH_SPECTRUM_LINE_PEAK_HOLD_SECONDS = 0.5;

function nodeGraphSpectrumLineBusGet(nodeId, port) {
  if (typeof nodeGraphDataBus === "undefined" || typeof nodeGraphDataBusKey !== "function") return null;
  return nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, port)) || null;
}

/** Pixel position t (0 left … 1 right) → Hz for the chosen axis. */
function nodeGraphSpectrumLineTToHz(t, axis, lo, hi) {
  const u = Math.max(0, Math.min(1, t));
  if (axis === "log") return lo * Math.pow(hi / lo, u);
  if (axis === "mel" && typeof spectrogramHzToMel === "function") {
    const a = spectrogramHzToMel(lo);
    const b = spectrogramHzToMel(hi);
    return spectrogramMelToHz(a + u * (b - a));
  }
  if (axis === "bark" && typeof spectrogramHzToBark === "function") {
    const a = spectrogramHzToBark(lo);
    const b = spectrogramHzToBark(hi);
    return spectrogramBarkToHz(a + u * (b - a));
  }
  return lo + u * (hi - lo);
}

/**
 * One FFT bin → 0…1 face height for the chosen dB mode.
 *   compressed  spectrogram value c / c(full-scale sine)
 *   db          invert c → EMA magnitude → dBFS → floor…ceiling
 *   exactDb     raw last-hop magnitude → dBFS → floor…ceiling
 *   linear      raw magnitude / full-scale magnitude (0…1)
 */
function nodeGraphSpectrumLineBinTo01(i, ctx) {
  const { mode, compressed, raw, fullMag, compressedRef, floorDb, spanDb } = ctx;
  if (mode === "compressed") {
    const c = compressed ? compressed[i] : 0;
    return c / compressedRef;
  }
  let mag;
  if ((mode === "exactDb" || mode === "linear") && raw) {
    mag = raw[i];
  } else {
    const c = compressed ? compressed[i] : 0;
    mag = (Math.pow(10, c) - 1) / 100;
  }
  const amp = Math.max(0, mag) / fullMag;
  if (mode === "linear") return amp;
  const db = 20 * Math.log10(Math.max(amp, 1e-12));
  return (db - floorDb) / spanDb;
}

/** Bin value at fractional bin x (linear between neighbours). */
function nodeGraphSpectrumLineBinAt01(x, bins, ctx) {
  const a = Math.max(0, Math.min(bins - 1, Math.floor(x)));
  const b = Math.min(bins - 1, a + 1);
  const f = Math.max(0, Math.min(1, x - a));
  return nodeGraphSpectrumLineBinTo01(a, ctx) * (1 - f) + nodeGraphSpectrumLineBinTo01(b, ctx) * f;
}

/**
 * Max of the spectrum over one pixel column's bin span [binA, binB].
 * Only bins inside the span count, plus the interpolated edges. (The old
 * version took floor(lo)..ceil(hi) whenever the span straddled a bin edge
 * and interpolated otherwise, so narrow columns alternated between the two
 * and drew a comb of regular one-bin-period spikes on the log axis.)
 */
function nodeGraphSpectrumLineColumn01(binA, binB, bins, ctx) {
  const lo = Math.max(0, Math.min(bins - 1, Math.min(binA, binB)));
  const hi = Math.max(0, Math.min(bins - 1, Math.max(binA, binB)));
  if (hi - lo < 1) return nodeGraphSpectrumLineBinAt01((lo + hi) * 0.5, bins, ctx);
  let best = Math.max(nodeGraphSpectrumLineBinAt01(lo, bins, ctx), nodeGraphSpectrumLineBinAt01(hi, bins, ctx));
  for (let i = Math.ceil(lo); i <= Math.floor(hi); i += 1) {
    const v = nodeGraphSpectrumLineBinTo01(i, ctx);
    if (v > best) best = v;
  }
  return best;
}

/**
 * Pure column computation (also used by smoke / headless checks).
 * Returns Float32Array(width) of 0…1 heights (unclamped above 1 is clipped).
 */
function nodeGraphSpectrumLineComputeColumns(width, data, settings) {
  const w = Math.max(1, width | 0);
  const out = new Float32Array(w);
  const compressed = data.compressed instanceof Float32Array ? data.compressed : null;
  const raw = data.raw instanceof Float32Array ? data.raw : null;
  const bins = (compressed || raw)?.length || 0;
  if (bins < 2) return out;
  const sampleRate = Math.max(1, nodeGraphFiniteNumber(data.sampleRate, 44100));
  const nyquist = sampleRate / 2;
  let lo = Math.max(1, Math.min(nyquist - 1, nodeGraphFiniteNumber(settings.minFreq, 20)));
  let hi = Math.max(lo + 1, Math.min(nyquist, nodeGraphFiniteNumber(settings.maxFreq, 20000)));
  const windowSum = Math.max(1e-9, nodeGraphFiniteNumber(data.windowSum, (data.fftSize || bins * 2) / 2));
  const fullMag = windowSum / 2;
  const floorDb = nodeGraphFiniteNumber(settings.spectrumDbFloor, -96);
  const ceilDb = nodeGraphFiniteNumber(settings.spectrumDbCeiling, 0);
  const ctx = {
    mode: settings.spectrumDbMode || "exactDb",
    compressed,
    raw,
    fullMag,
    compressedRef: Math.max(1e-9, Math.log10(1 + fullMag * 100)),
    floorDb,
    spanDb: Math.max(1, ceilDb - floorDb),
  };
  const axis = settings.spectrumAxis || "log";
  const map = nodeGraphSpectrumLineColumnMap(w, bins, axis, lo, hi, nyquist);
  // Each bin converted once per frame (was: per column touch, with the
  // interp helper re-converting neighbours), only over the visible bin range.
  const v01 = nodeGraphSpectrumLineScratch(bins);
  const { mode, compressedRef, floorDb: fl, spanDb } = ctx;
  const useRaw = (mode === "exactDb" || mode === "linear") && raw;
  for (let i = map.firstBin; i <= map.lastBin; i += 1) {
    if (mode === "compressed") {
      v01[i] = (compressed ? compressed[i] : 0) / compressedRef;
      continue;
    }
    const mag = useRaw ? raw[i] : (Math.pow(10, compressed ? compressed[i] : 0) - 1) / 100;
    const amp = Math.max(0, mag) / fullMag;
    v01[i] = mode === "linear" ? amp : (20 * Math.log10(Math.max(amp, 1e-12)) - fl) / spanDb;
  }
  const at = (xb) => {
    const a = Math.max(0, Math.min(bins - 1, Math.floor(xb)));
    const b = Math.min(bins - 1, a + 1);
    const f = Math.max(0, Math.min(1, xb - a));
    return v01[a] * (1 - f) + v01[b] * f;
  };
  // Same rule as nodeGraphSpectrumLineColumn01 (spike fix), on cached spans.
  for (let x = 0; x < w; x += 1) {
    const cl = map.lo[x];
    const ch = map.hi[x];
    let v;
    if (ch - cl < 1) {
      v = at((cl + ch) * 0.5);
    } else {
      v = Math.max(at(cl), at(ch));
      const end = Math.floor(ch);
      for (let i = Math.ceil(cl); i <= end; i += 1) if (v01[i] > v) v = v01[i];
    }
    out[x] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  return out;
}

let nodeGraphSpectrumLineScratchBuf = null;
function nodeGraphSpectrumLineScratch(n) {
  if (!nodeGraphSpectrumLineScratchBuf || nodeGraphSpectrumLineScratchBuf.length < n) {
    nodeGraphSpectrumLineScratchBuf = new Float32Array(n);
  }
  return nodeGraphSpectrumLineScratchBuf;
}

/**
 * Column -> clamped fractional bin span [lo[x], hi[x]], cached per
 * (width, bins, axis, range, nyquist): the Hz mapping (pow / mel / bark) runs
 * once per size or axis change, not every frame.
 */
const nodeGraphSpectrumLineColumnMaps = new Map();
function nodeGraphSpectrumLineColumnMap(w, bins, axis, loHz, hiHz, nyquist) {
  const key = `${w}|${bins}|${axis}|${loHz}|${hiHz}|${nyquist}`;
  let m = nodeGraphSpectrumLineColumnMaps.get(key);
  if (m) return m;
  // Bin k sits at k / (bins - 1) · Nyquist (matches spectrogramHzToLinearBin).
  const hzToBin = (hz) => (Math.max(0, hz) / nyquist) * (bins - 1);
  const lo = new Float64Array(w);
  const hi = new Float64Array(w);
  let firstBin = bins - 1;
  let lastBin = 0;
  for (let x = 0; x < w; x += 1) {
    const ta = w > 1 ? (x - 0.5) / (w - 1) : 0;
    const tb = w > 1 ? (x + 0.5) / (w - 1) : 1;
    const ba = hzToBin(nodeGraphSpectrumLineTToHz(ta, axis, loHz, hiHz));
    const bb = hzToBin(nodeGraphSpectrumLineTToHz(tb, axis, loHz, hiHz));
    lo[x] = Math.max(0, Math.min(bins - 1, Math.min(ba, bb)));
    hi[x] = Math.max(0, Math.min(bins - 1, Math.max(ba, bb)));
    firstBin = Math.min(firstBin, Math.floor(lo[x]));
    lastBin = Math.max(lastBin, Math.min(bins - 1, Math.floor(hi[x]) + 1));
  }
  m = { lo, hi, firstBin: Math.max(0, firstBin), lastBin };
  if (nodeGraphSpectrumLineColumnMaps.size > 16) nodeGraphSpectrumLineColumnMaps.clear();
  nodeGraphSpectrumLineColumnMaps.set(key, m);
  return m;
}

function nodeGraphSpectrumLineSettingsForNode(node) {
  const base = typeof normalizeNodeGraphSpectrumLineSettings === "function"
    ? normalizeNodeGraphSpectrumLineSettings(node?.traceDisplaySettings, node)
    : {};
  const p = node?.params && typeof node.params === "object" ? node.params : {};
  const minFreq = Number(p.minFreq);
  const maxFreq = Number(p.maxFreq);
  return {
    ...base,
    minFreq: Number.isFinite(minFreq) ? minFreq : 20,
    maxFreq: Number.isFinite(maxFreq) ? maxFreq : 20000,
  };
}

function nodeGraphSpectrumLineHexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Column heights (0..1) -> polyline points in device px (y down). */
function nodeGraphSpectrumLinePoints(cols, W, H) {
  const pts = new Array(cols.length * 2);
  for (let x = 0; x < cols.length; x += 1) {
    pts[x * 2] = cols.length > 1 ? (x / (cols.length - 1)) * W : 0;
    pts[x * 2 + 1] = H - cols[x] * H;
  }
  return pts;
}

function drawNodeGraphSpectrumLineItem(renderer, item, pixelRatio) {
  const nodeId = String(item?.slot?.nodeId || "");
  if (!nodeId) return;
  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || !screenElement) return;
  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, 1)) return;
  canvas.style.mixBlendMode = "normal";
  canvas.classList.add("node-spectrum-line-canvas");
  const W = canvas.width | 0;
  const H = canvas.height | 0;
  if (W < 1 || H < 1) return;

  // Offscreen / culled module: no work (wakes and repaints on the next frame).
  if (typeof nodeGraphModuleIsViewportAsleep === "function"
    && nodeGraphModuleIsViewportAsleep(screenElement.closest?.(".dsp-node") || nodeId)) return;
  const node = nodeGraphPatchNode(nodeId);
  const settings = nodeGraphSpectrumLineSettingsForNode(node);
  const bg = settings.backgroundColor || "#05070a";
  const ink = settings.dot1Color || "#4fd1ff";
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, bg);
  }

  const meta = nodeGraphSpectrumLineBusGet(nodeId, "FftSize");
  const gain = nodeGraphSpectrumLineBusGet(nodeId, "SpectrumGain");
  const data = {
    compressed: nodeGraphSpectrumLineBusGet(nodeId, "Spectrum"),
    raw: nodeGraphSpectrumLineBusGet(nodeId, "SpectrumRaw"),
    fftSize: meta instanceof Float32Array ? meta[0] : settings.fftSize,
    sampleRate: meta instanceof Float32Array && meta.length >= 5
      ? meta[4]
      : nodeGraphFiniteNumber(nodeGraphModuleScopeState?.sampleRate, 44100),
    windowSum: gain instanceof Float32Array ? gain[0] : undefined,
  };

  // Nothing new since the last paint (same FFT hop, size, settings): the face
  // canvas keeps its pixels, so skip the GL frame. Peak hold animates -> always.
  const hopSerial = meta instanceof Float32Array && meta.length >= 6 ? meta[5] : -1;
  const sig = `${hopSerial}|${W}x${H}|${bg}|${ink}|${settings.spectrumAxis}|${settings.spectrumDbMode}|${settings.spectrumDbFloor}|${settings.spectrumDbCeiling}|${settings.spectrumDrawStyle}|${settings.minFreq}|${settings.maxFreq}|${pixelRatio}`;
  if (hopSerial >= 0 && settings.spectrumPeakHold !== "hold" && canvas._spectrumLineSig === sig) return;
  canvas._spectrumLineSig = sig;

  // Device px (face canvas backing), WebGL2 only; no GL -> black.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphGlLinesCss(bg))
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const inkRgba = nodeGraphGlLinesCss(ink);
  const inkA = (a) => [inkRgba[0], inkRgba[1], inkRgba[2], a];

  const cols = nodeGraphSpectrumLineComputeColumns(W, data, settings);
  let st = nodeGraphSpectrumLineStates.get(nodeId);
  if (!st || st.peak.length !== W) {
    st = { peak: new Float32Array(W), holdUntil: new Float64Array(W), lastMs: 0 };
    nodeGraphSpectrumLineStates.set(nodeId, st);
  }
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dt = st.lastMs ? Math.max(0, Math.min(0.25, (now - st.lastMs) / 1000)) : 0;
  st.lastMs = now;

  const lineW = Math.max(1, 1.25 * (Number(pixelRatio) || 1));
  const pts = nodeGraphSpectrumLinePoints(cols, W, H);
  if (settings.spectrumDrawStyle !== "line") {
    nodeGraphGlLinesFillUnder(batch, pts, H, inkA(0.35));
  }
  nodeGraphGlLinesPolyline(batch, pts, Math.max(0, lineW * 0.5 - 0.35), 0.7, inkRgba);

  if (settings.spectrumPeakHold === "hold") {
    const dbModes = settings.spectrumDbMode === "db" || settings.spectrumDbMode === "exactDb";
    const span = dbModes
      ? Math.max(1, nodeGraphFiniteNumber(settings.spectrumDbCeiling, 0) - nodeGraphFiniteNumber(settings.spectrumDbFloor, -96))
      : 96;
    const fall = (nodeGraphFiniteNumber(settings.spectrumPeakDecay, 12) / span) * dt;
    for (let x = 0; x < W; x += 1) {
      if (cols[x] >= st.peak[x]) {
        st.peak[x] = cols[x];
        st.holdUntil[x] = now + NODE_GRAPH_SPECTRUM_LINE_PEAK_HOLD_SECONDS * 1000;
      } else if (now > st.holdUntil[x]) {
        st.peak[x] = Math.max(cols[x], st.peak[x] - fall);
      }
    }
    nodeGraphGlLinesPolyline(batch, nodeGraphSpectrumLinePoints(st.peak, W, H), Math.max(0, Math.max(1, lineW * 0.8) * 0.5 - 0.35), 0.7, inkA(0.6));
  } else {
    st.peak.fill(0);
  }
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers !== "undefined") {
  nodeGraphModuleScopeCustomRenderers.spectrumLine = drawNodeGraphSpectrumLineItem;
}
