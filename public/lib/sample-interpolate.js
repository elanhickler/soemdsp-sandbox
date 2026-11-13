// Fractional sample reads. Linear is cheap. Hermite is 4-point cubic
// (smoother varispeed / scratch). Neither is band-limited sinc.

function nodeGraphSampleReadLinear(channel, frameIndex) {
  if (!channel?.length) {
    return 0;
  }
  const maxIndex = channel.length - 1;
  let index = nodeGraphFiniteNumber(frameIndex);
  if (index < 0) {
    index = 0;
  } else if (index > maxIndex) {
    index = maxIndex;
  }
  const low = Math.floor(index);
  const high = low < maxIndex ? low + 1 : maxIndex;
  const t = index - low;
  const a = nodeGraphFiniteNumber(channel[low]);
  const b = nodeGraphFiniteNumber(channel[high]);
  return a + (b - a) * t;
}

function nodeGraphSampleReadHermite(channel, frameIndex) {
  if (!channel?.length) {
    return 0;
  }
  const maxIndex = channel.length - 1;
  let index = nodeGraphFiniteNumber(frameIndex);
  if (index < 0) {
    index = 0;
  } else if (index > maxIndex) {
    index = maxIndex;
  }
  const i1 = Math.floor(index);
  const t = index - i1;
  const i0 = i1 > 0 ? i1 - 1 : 0;
  const i2 = i1 < maxIndex ? i1 + 1 : maxIndex;
  const i3 = i2 < maxIndex ? i2 + 1 : maxIndex;
  const y0 = nodeGraphFiniteNumber(channel[i0]);
  const y1 = nodeGraphFiniteNumber(channel[i1]);
  const y2 = nodeGraphFiniteNumber(channel[i2]);
  const y3 = nodeGraphFiniteNumber(channel[i3]);
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

// Playback interpolation shared with Music Player native (audio_player.cpp)
// and 1D Plot reconstructed draw: Square (ZOH), Linear, Sinc
// (windowed sinc, Blackman, K=16; stored value 2, formerly labeled
// Reconstructed), PolyBLEP (stored value 3) — ZOH plus 2-sample polyBLEP
// residuals at each sample-boundary step), Tape (stored 7) — sinc then
// shared knee-style tilt. Retired 4/5/6 (Jitter/Dither/Both) read as Sinc.
const NODE_GRAPH_SAMPLE_SINC_K = 16;
const NODE_GRAPH_SAMPLE_POLYBLEP_MAX_DT = 16;

function nodeGraphSampleMapIndex(i, length, options = {}) {
  const frames = length | 0;
  if (frames <= 0) return 0;
  let lo = 0;
  let hi = frames - 1;
  const startI = Number(options.startI);
  const endI = Number(options.endI);
  if (Number.isFinite(startI)) lo = Math.max(0, Math.min(frames - 1, Math.floor(startI)));
  if (Number.isFinite(endI)) hi = Math.max(0, Math.min(frames - 1, Math.floor(endI)));
  if (hi < lo) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }
  i = i | 0;
  if (options.loop) {
    const n = hi - lo + 1;
    if (n <= 1) return lo;
    let rel = i - lo;
    rel %= n;
    if (rel < 0) rel += n;
    return lo + rel;
  }
  return Math.max(lo, Math.min(hi, i));
}

function nodeGraphSampleSincBlackman(x) {
  const ax = Math.abs(x);
  if (ax < 1e-9) return 1;
  if (ax >= NODE_GRAPH_SAMPLE_SINC_K) return 0;
  const u = x / NODE_GRAPH_SAMPLE_SINC_K;
  const win = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
  return (Math.sin(Math.PI * x) / (Math.PI * x)) * win;
}

function nodeGraphSampleReadHold(channel, frameIndex, options = {}) {
  if (!channel?.length) return 0;
  const index = nodeGraphFiniteNumber(frameIndex);
  if (!Number.isFinite(index)) return 0;
  const i = nodeGraphSampleMapIndex(Math.floor(index), channel.length, options);
  return nodeGraphFiniteNumber(channel[i]);
}

function nodeGraphSampleReadReconstructed(channel, frameIndex, options = {}) {
  if (!channel?.length) return 0;
  const index = nodeGraphFiniteNumber(frameIndex);
  if (!Number.isFinite(index)) return 0;
  const i0 = Math.floor(index);
  const t = index - i0;
  const K = NODE_GRAPH_SAMPLE_SINC_K;
  let acc = 0;
  for (let m = -K + 1; m <= K; m += 1) {
    const h = nodeGraphSampleSincBlackman(t - m);
    if (h === 0) continue;
    const i = nodeGraphSampleMapIndex(i0 + m, channel.length, options);
    acc += nodeGraphFiniteNumber(channel[i]) * h;
  }
  return acc;
}

function nodeGraphSamplePolyblepAfter(t, dt) {
  if (!(dt > 1e-12) || t < 0 || t >= dt) return 0;
  const u = t / dt;
  return u + u - u * u - 1;
}

function nodeGraphSamplePolyblepBefore(t, dt) {
  if (!(dt > 1e-12) || t <= 0 || t >= dt) return 0;
  const u = -t / dt;
  return u * u + u + u + 1;
}

function nodeGraphSampleReadLinearMapped(channel, frameIndex, options = {}) {
  if (!channel?.length) return 0;
  const index = nodeGraphFiniteNumber(frameIndex);
  if (!Number.isFinite(index)) return 0;
  if (options && (options.loop || Number.isFinite(options.startI) || Number.isFinite(options.endI))) {
    const i0 = Math.floor(index);
    const t = index - i0;
    const a = nodeGraphFiniteNumber(channel[nodeGraphSampleMapIndex(i0, channel.length, options)]);
    const b = nodeGraphFiniteNumber(channel[nodeGraphSampleMapIndex(i0 + 1, channel.length, options)]);
    return a + (b - a) * t;
  }
  return nodeGraphSampleReadLinear(channel, index);
}

// ZOH staircase with a 2-sample polyBLEP residual at every integer-index
// crossing. options.increment is input-frames advanced per output sample
// (signed; reverse supported). |increment| > 16 falls back to linear.
function nodeGraphSampleReadPolyblep(channel, frameIndex, options = {}) {
  if (!channel?.length) return 0;
  const index = nodeGraphFiniteNumber(frameIndex);
  if (!Number.isFinite(index)) return 0;
  const rate = nodeGraphFiniteNumber(options.increment, 0);
  const dt = Math.abs(rate);
  if (!(dt > 1e-12)) {
    return nodeGraphSampleReadHold(channel, index, options);
  }
  if (dt > NODE_GRAPH_SAMPLE_POLYBLEP_MAX_DT) {
    return nodeGraphSampleReadLinearMapped(channel, index, options);
  }
  const n = Math.floor(index);
  const sampleAt = (i) => nodeGraphFiniteNumber(channel[nodeGraphSampleMapIndex(i, channel.length, options)]);
  let y = sampleAt(n);
  let span = Math.floor(dt) + 1;
  if (span < 1) span = 1;
  if (span > NODE_GRAPH_SAMPLE_POLYBLEP_MAX_DT) span = NODE_GRAPH_SAMPLE_POLYBLEP_MAX_DT;
  if (rate >= 0) {
    for (let k = n; k >= n - span; k -= 1) {
      const dist = index - k;
      if (dist < 0 || dist >= dt) continue;
      y += 0.5 * (sampleAt(k) - sampleAt(k - 1)) * nodeGraphSamplePolyblepAfter(dist, dt);
    }
    for (let k = n + 1; k <= n + 1 + span; k += 1) {
      const dist = k - index;
      if (dist <= 0 || dist >= dt) continue;
      y += 0.5 * (sampleAt(k) - sampleAt(k - 1)) * nodeGraphSamplePolyblepBefore(dist, dt);
    }
  } else {
    for (let k = n + 1; k <= n + 1 + span; k += 1) {
      const dist = k - index;
      if (dist < 0 || dist >= dt) continue;
      y += 0.5 * (sampleAt(k - 1) - sampleAt(k)) * nodeGraphSamplePolyblepAfter(dist, dt);
    }
    for (let k = n; k >= n - span; k -= 1) {
      const dist = index - k;
      if (dist <= 0 || dist >= dt) continue;
      y += 0.5 * (sampleAt(k - 1) - sampleAt(k)) * nodeGraphSamplePolyblepBefore(dist, dt);
    }
  }
  return Number.isFinite(y) ? y : 0;
}

function nodeGraphSampleTapeClampTilt(tilt) {
  let n = nodeGraphFiniteNumber(tilt, -6);
  if (n > 0) n = 0;
  if (n < -24) n = -24;
  return n;
}

function nodeGraphSampleTapeClampTone(tone) {
  let n = nodeGraphFiniteNumber(tone, -6);
  if (n > 1) n = 1;
  if (n < -6) n = -6;
  return n;
}

function nodeGraphSampleTapeClampRange(range) {
  let n = nodeGraphFiniteNumber(range, 1);
  if (n < 0.25) n = 0.25;
  if (n > 6) n = 6;
  return n;
}

// Depth d = clamp(log2(1/|speed|) / Range, 0, 1).
// |speed| >= 1 -> 0 (no fade, full fidelity). Near-zero speed -> 1 (full effect).
// Default Range 1 oct: full effect at 0.5x. Saved patches without range keep 2.
// Applied as slope_eff = Tilt * d and tone_eff = Tone * d so the knee slides
// from the cutoff down to cutoff*2^Tone as speed drops.
function nodeGraphSampleTapeDepth(speed, range) {
  const r = nodeGraphSampleTapeClampRange(range);
  const s = Math.abs(nodeGraphFiniteNumber(speed, 1));
  if (!Number.isFinite(s) || s < 1e-12) return 1;
  if (s >= 1) return 0;
  let d = Math.log2(1 / s) / r;
  if (d < 0) d = 0;
  if (d > 1) d = 1;
  return d;
}

function nodeGraphSampleTapeKneeHz(options = {}) {
  const sr = nodeGraphFiniteNumber(options.sampleRate, 48000);
  const pcmRate = nodeGraphFiniteNumber(options.pcmRate, sr);
  const speed = Math.abs(nodeGraphFiniteNumber(options.speed, 1));
  const srcNyq = 0.5 * (pcmRate > 1 ? pcmRate : 44100);
  const outNyq = 0.5 * (sr > 1 ? sr : 44100);
  let cutoff = srcNyq * speed;
  if (cutoff > outNyq) cutoff = outNyq;
  const oct = nodeGraphSampleTapeClampTone(options.tone);
  let knee = cutoff * Math.pow(2, oct);
  if (knee < 1) knee = 1;
  const maxKnee = 0.45 * (sr > 1 ? sr : 44100);
  if (knee > maxKnee) knee = maxKnee;
  return { knee, cutoff, oct };
}

function nodeGraphSampleTapeEnsureState(state) {
  const st = state && typeof state === "object" ? state : {};
  if (!st.filter) st.filter = soemdspTiltCreateState();
  if (!st.channel) st.channel = soemdspTiltCreateChannel();
  if (!Number.isFinite(st.wetMix)) st.wetMix = -1;
  return st;
}

function nodeGraphSampleTapeClear(state) {
  const st = nodeGraphSampleTapeEnsureState(state);
  soemdspTiltClear(st.filter);
  soemdspTiltClearChannel(st.channel);
  st.wetMix = -1;
  return st;
}

function nodeGraphSampleTapeUpdate(state, options = {}) {
  const st = nodeGraphSampleTapeEnsureState(state);
  const sr = nodeGraphFiniteNumber(options.sampleRate, 48000);
  const engineRate = sr > 1 ? sr : 44100;
  const depth = nodeGraphSampleTapeDepth(options.speed, options.range);
  const slope = nodeGraphSampleTapeClampTilt(options.tilt) * depth;
  const tone = nodeGraphSampleTapeClampTone(options.tone) * depth;
  const tapeKnee = nodeGraphSampleTapeKneeHz({ ...options, tone, sampleRate: engineRate });
  // K-weighted (BS.1770) equal-power makeup over 1 Hz..cutoff (the band
  // that still exists at this speed). Pink-weighted match left Tape quieter
  // than Sinc at low speed: bass octaves at gain 1 diluted the makeup while
  // the tilt carved out the mid/high band that carries loudness.
  soemdspTiltUpdate(
    st.filter,
    tapeKnee.knee,
    slope,
    engineRate,
    SOEMDSP_TILT_STYLE_KNEE,
    SOEMDSP_TILT_LEVEL_LOUDNESS,
    1,
    tapeKnee.cutoff
  );
  st.depth = depth;
  return st;
}

function nodeGraphSampleTapeProcess(x, state, options = {}) {
  const st = nodeGraphSampleTapeUpdate(state, options);
  const sr = nodeGraphFiniteNumber(options.sampleRate, 48000);
  const engineRate = sr > 1 ? sr : 44100;
  const wetTarget = st.depth > 0 ? 1 : 0;
  const a = 1 - Math.exp(-1 / (SOEMDSP_TILT_SMOOTH_S * engineRate));
  if (!(st.wetMix >= 0)) st.wetMix = wetTarget;
  else st.wetMix += a * (wetTarget - st.wetMix);
  if (st.wetMix < 1e-12) {
    st.wetMix = 0;
    return x;
  }
  const y = soemdspTiltProcess(st.filter, st.channel, x);
  if (st.wetMix > 1 - 1e-12) return y;
  return x + st.wetMix * (y - x);
}

function nodeGraphSampleReadTape(channel, frameIndex, options = {}) {
  const y = nodeGraphSampleReadReconstructed(channel, frameIndex, options);
  const state = nodeGraphSampleTapeEnsureState(options.tapeState);
  options.tapeState = state;
  return nodeGraphSampleTapeProcess(y, state, options);
}

function nodeGraphSampleReadAt(channel, frameIndex, mode, options = {}) {
  const key = String(mode ?? "").trim().toLowerCase();
  if (key === "square" || key === "hold" || key === "discrete" || key === "0") {
    return nodeGraphSampleReadHold(channel, frameIndex, options);
  }
  if (key === "linear" || key === "1") {
    return nodeGraphSampleReadLinearMapped(channel, frameIndex, options);
  }
  if (key === "polyblep" || key === "poly-blep" || key === "3") {
    return nodeGraphSampleReadPolyblep(channel, frameIndex, options);
  }
  if (key === "tape" || key === "7") {
    return nodeGraphSampleReadTape(channel, frameIndex, options);
  }
  return nodeGraphSampleReadReconstructed(channel, frameIndex, options);
}
