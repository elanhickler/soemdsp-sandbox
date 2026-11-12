// Circular Spectrogram: the classic mirrored polar spectrogram (display only).
//
// Shares everything with Spectrogram except the lookup:
//   • Analysis: the Spectrogram worklet FFT (SPECTROGRAM_ANALYSIS_TYPES), so
//     FFT size / window / overlap / pad / freq scale / gradient / pause on
//     silence are the same Display Settings.
//   • Ink: the same GPU ring of raw spectrum columns with per-column settings
//     (spectrogram-gl.js), so a knob change only affects new ink.
//   • Shader: spectrogramGlRingPresentPolar maps each face pixel to
//     angle → column age and radius → frequency (bass at the inner radius).
//
// Time runs around the ring. The newest column sits at the head (top for
// Down, bottom for Up, turned by Rotate); older columns travel away from it.
// Mirror on: both halves show the same history, so a kick throws a matching
// pair of arms that travel down (or up) the circle. Mirror off: one sweep all
// the way round (clockwise from the top for Down, anticlockwise from the
// bottom for Up). History (s) is one trip from head to tail.
//
// Radius Map Log (default) gives every octave the same ring width so the kick
// body has room; Freq Scale uses the Display Settings Linear / Mel / Bark.
//
// State lives in spectrogramHistory so engine stop, wipe and delete clear it
// the same way as Spectrogram (and screen solo keeps the module buffer size
// through spectrogramBufferSizeForFace).

const CIRCULAR_SPECTROGRAM_MIN_COLUMNS = 128;
const CIRCULAR_SPECTROGRAM_MAX_COLUMNS = 2048;
// Freq scale index the polar shader reads as log Hz (Spectrogram uses 0…2).
const CIRCULAR_SPECTROGRAM_LOG_SCALE = 3;

function circularSpectrogramNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** About one column per face pixel along the rim of the visible sweep. */
function circularSpectrogramColumnsFor(bufW, bufH, mirror) {
  const radius = 0.5 * Math.max(1, Math.min(bufW | 0, bufH | 0));
  const arc = Math.PI * radius * (mirror ? 1 : 2);
  return Math.max(
    CIRCULAR_SPECTROGRAM_MIN_COLUMNS,
    Math.min(CIRCULAR_SPECTROGRAM_MAX_COLUMNS, Math.round(arc)),
  );
}

function circularSpectrogramEnsureState(nodeId, bufW, bufH, mirror, historySeconds) {
  const key = String(nodeId || "");
  const w = Math.max(1, bufW | 0);
  const h = Math.max(1, bufH | 0);
  let st = spectrogramHistory.get(key);
  if (!st || st.circular !== true) {
    if (st?.ring && typeof spectrogramGlRingRelease === "function") {
      spectrogramGlRingRelease(st.ring);
    }
    st = {
      circular: true,
      faceW: w,
      faceH: h,
      scrollDebtSec: 0,
      lastHop: -1,
      lastAbs: Number.NaN,
      ring: null,
      historySeconds,
    };
    spectrogramHistory.set(key, st);
  } else if (
    Math.abs((st.faceW | 0) - w) >= SPECTROGRAM_REBUFFER_DELTA_PX
    || Math.abs((st.faceH | 0) - h) >= SPECTROGRAM_REBUFFER_DELTA_PX
  ) {
    st.faceW = w;
    st.faceH = h;
  }
  st.columns = circularSpectrogramColumnsFor(st.faceW, st.faceH, mirror);
  if (st.ring && st.ring.w !== st.columns) {
    st.ring = spectrogramGlRingResize(st.ring, st.columns);
  }
  st.historySeconds = historySeconds;
  return st;
}

/** Face raster that fits the shared device, same aspect (the circle stays round). */
function circularSpectrogramRaster(faceW, faceH) {
  const dev = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  const maxW = Math.max(1, dev?.canvas?.width | 0);
  const maxH = Math.max(1, dev?.canvas?.height | 0);
  const k = Math.min(1, maxW / faceW, maxH / faceH);
  return {
    w: Math.max(1, Math.floor(faceW * k)),
    h: Math.max(1, Math.floor(faceH * k)),
  };
}

/** One STFT hop of audio time: pool, then emit whole columns (History / columns each). */
function circularSpectrogramIngestHop(st, spectrum, bins, hopSize, sampleRate, ink) {
  spectrogramGlRingPool(st.ring, spectrum, bins);
  const cols = Math.max(1, st.ring.w | 0);
  const secPerCol = st.historySeconds / cols;
  st.scrollDebtSec = Math.max(0, circularSpectrogramNumber(st.scrollDebtSec, 0))
    + Math.max(1, hopSize) / Math.max(1, sampleRate);
  const whole = Math.floor(st.scrollDebtSec / Math.max(1e-12, secPerCol));
  if (whole < 1) return;
  spectrogramGlRingWrite(st.ring, Math.min(cols, whole), ink);
  st.scrollDebtSec = whole >= cols ? 0 : Math.max(0, st.scrollDebtSec - whole * secPerCol);
}

/** Leftover hop-time as a fraction of one column [0, 1). */
function circularSpectrogramSubColumn(st) {
  const cols = Math.max(1, st?.ring?.w | 0);
  const sub = circularSpectrogramNumber(st?.scrollDebtSec, 0) / Math.max(1e-12, st.historySeconds / cols);
  if (!Number.isFinite(sub) || sub <= 0) return 0;
  return sub < 1 ? sub : 0.999;
}

function drawNodeGraphCircularSpectrogramItem(_renderer, item, pixelRatio) {
  const nodeId = String(item?.slot?.nodeId || "");
  if (!nodeId) return;

  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || !screenElement) return;

  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, 1)) return;
  canvas.style.mixBlendMode = "normal";
  canvas.classList.add("node-spectrogram-canvas");
  nodeGraphDisplayCanvasPixelated(canvas, false);

  const ctx = nodeGraphSharedGlPresentTarget(canvas);
  if (!ctx) return;

  const faceW = canvas.width | 0;
  const faceH = canvas.height | 0;
  if (faceW < 1 || faceH < 1) return;

  const node = nodeGraphPatchNode(nodeId);
  const p = node?.params && typeof node.params === "object" ? node.params : {};
  const settings = spectrogramSettingsForNode(node);
  const brightness = circularSpectrogramNumber(p.brightness, 1);
  const contrast = circularSpectrogramNumber(p.contrast, 1);
  const mirror = Math.round(circularSpectrogramNumber(p.mirror, 1)) !== 0;
  const up = Math.round(circularSpectrogramNumber(p.direction, 0)) === 1;
  // Rotate is in turns (0…1 wraps), like the other phase knobs.
  const rotate = circularSpectrogramNumber(p.rotate, 0) * 2 * Math.PI;
  const inner = Math.max(0, Math.min(0.9, circularSpectrogramNumber(p.innerRadius, 0.12)));
  const freqScaleIdx = Math.round(circularSpectrogramNumber(p.radialScale, 0)) === 0
    ? CIRCULAR_SPECTROGRAM_LOG_SCALE
    : Math.max(0, Math.min(2, Math.round(nodeGraphFiniteNumber(settings.freqScale))));
  const lutStops = typeof nodeGraphApplyGradientHueRotation === "function"
    ? nodeGraphApplyGradientHueRotation(settings.gradientStops, settings)
    : settings.gradientStops;
  const lutRgb = spectrogramLutRgbForStops(lutStops);
  const historySeconds = Math.max(
    SPECTROGRAM_MIN_HISTORY_SECONDS,
    Math.min(SPECTROGRAM_MAX_HISTORY_SECONDS, nodeGraphFiniteNumber(settings.historySeconds, 2)),
  );

  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, spectrogramCssAtBrightness(lutRgb, 0));
  }

  const spectrum = nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, "Spectrum"));
  const spectrumBatch = nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, "SpectrumBatch"));
  const spectrumBins = (spectrum instanceof Float32Array) ? spectrum.length : 0;

  const { hopSize, sampleRate, hopSerial, batchColumns, windowSum, fftSize } = spectrogramHopMeta(settings, node);
  const winSum = windowSum > 0 ? windowSum : Math.max(1, fftSize) / 2;
  const fullMag = Math.max(1e-9, winSum / 2);
  const buf = spectrogramBufferSizeForFace(nodeId, faceW, faceH, screenElement);
  const st = circularSpectrogramEnsureState(nodeId, buf.w, buf.h, mirror, historySeconds);
  if (!st.ring) st.ring = spectrogramGlRingCreate(st.columns, lutRgb);

  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();

  // Pause on silence (Display Settings, default off): same rule as Spectrogram.
  const liveIn = nodeGraphModuleScopeState?.buffers?.get?.(`${nodeId}:In`) || null;
  if (!Number.isFinite(st.lastAbs) && typeof nodeGraphWaterfallUndrawn === "function") {
    const seed = nodeGraphWaterfallUndrawn(liveIn, st.lastAbs);
    if (Number.isFinite(seed.absEnd) && seed.count > 0) {
      st.lastAbs = Math.max(0, seed.absEnd - seed.count);
    }
  }
  const undrawn = typeof nodeGraphWaterfallUndrawn === "function"
    ? nodeGraphWaterfallUndrawn(liveIn, st.lastAbs)
    : { count: 0, absEnd: Number.NaN };
  const pauseOnSilence = typeof nodeGraphWaterfallPauseOnSilence === "function"
    ? nodeGraphWaterfallPauseOnSilence(settings)
    : settings?.pauseOnSilence === true;
  const silentHold = pauseOnSilence
    && typeof nodeGraphWaterfallIncomingIsSilent === "function"
    && nodeGraphWaterfallIncomingIsSilent(
      { buffer: liveIn, slot: item?.slot },
      settings,
      undrawn,
      liveIn,
    );

  if (!frozen && hopSerial > 0 && hopSerial !== st.lastHop) {
    let ingested = silentHold;
    if (!silentHold) {
      const band = spectrogramResolveViewBand(settings.minFreq, settings.maxFreq, sampleRate);
      const ink = {
        contrast,
        brightness,
        freqScale: freqScaleIdx,
        minFreq: band.minFreq,
        maxFreq: band.maxFreq,
        nyquist: band.nyquist,
        lutRgb,
      };
      const bins = spectrumBins > 0
        ? spectrumBins
        : (spectrumBatch instanceof Float32Array && batchColumns > 0
          ? Math.floor(spectrumBatch.length / batchColumns)
          : 0);
      if (
        spectrumBatch instanceof Float32Array
        && batchColumns > 0
        && bins > 0
        && spectrumBatch.length >= batchColumns * bins
      ) {
        for (let c = 0; c < batchColumns; c += 1) {
          circularSpectrogramIngestHop(st, spectrumBatch.subarray(c * bins, (c + 1) * bins), bins, hopSize, sampleRate, ink);
        }
        ingested = true;
      } else if (spectrumBins > 0) {
        circularSpectrogramIngestHop(st, spectrum, spectrumBins, hopSize, sampleRate, ink);
        ingested = true;
      }
    }
    if (ingested) {
      st.lastHop = hopSerial;
      if (Number.isFinite(undrawn.absEnd) && undrawn.count > 0) {
        st.lastAbs = undrawn.absEnd;
      }
    }
  }

  const raster = circularSpectrogramRaster(faceW, faceH);
  if (spectrogramGlRingPresentPolar(
      st.ring,
      raster.w,
      raster.h,
      ctx,
      faceW,
      faceH,
      circularSpectrogramSubColumn(st),
      spectrogramLutRgb01(lutRgb, 0),
      fullMag,
      { mirror, up, rotate, inner },
    )) {
    st.hasFrame = true;
    return;
  }
  st.hasFrame = false;
  nodeGraphDisplayGlFailed(canvas, "Circular Spectrogram GL present failed");
}
