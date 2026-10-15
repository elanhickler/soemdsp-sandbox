// Regression: a pure sine through the Spectrogram worklet FFT and the 1D Spectrum
// column resampler must give ONE peak (no comb of regularly spaced spikes).
// Bug 2026-10-15: narrow log-axis columns alternated between interpolation and
// max over floor(lo)..ceil(hi), drawing a one-bin-period spike comb.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Math, Float32Array, Float64Array, Map, Set, Number, Array, Object, String };
ctx.nodeGraphFiniteNumber = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
ctx.NodeLiveAudioProcessor = function NodeLiveAudioProcessor() {};
ctx.sampleRate = 48000;
vm.createContext(ctx);
for (const f of ["public/modules/spectrogram/spectrogram-worklet-evaluator.js", "public/modules/spectrum1d/spectrum1d-display.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}

function analyse(freq, params) {
  const P = ctx.NodeLiveAudioProcessor;
  const p = new P();
  p.engineSampleRate = 48000;
  const cap = 262144;
  const buf = { buffer: new Float32Array(cap), capacity: cap, writeIndex: 0, absoluteFrame: 0, sampleStride: 1, sourceSampleRate: 48000, writeSampleRate: 48000 };
  p.visualInputBuffers = new Map([["n:In", buf]]);
  p.nodes = new Map([["n", { type: "spectrum1d", params }]]);
  const st = p.createSpectrogramState();
  let ports = [];
  let t = 0;
  for (let c = 0; c < 60; c += 1) {
    for (let i = 0; i < 800; i += 1) {
      buf.buffer[buf.writeIndex] = Math.sin((2 * Math.PI * freq * t) / 48000);
      t += 1;
      buf.writeIndex = (buf.writeIndex + 1) % cap;
      buf.absoluteFrame += 1;
    }
    const dp = [];
    p.spectrogramCollectDisplayData("n", st, dp);
    if (dp.length) ports = dp;
  }
  const g = (k) => ports.find((x) => x[1] === k)?.[2];
  if (!g("SpectrumRaw")) throw new Error("no SpectrumRaw from worklet FFT");
  return { compressed: g("Spectrum"), raw: g("SpectrumRaw"), fftSize: g("FftSize")[0], sampleRate: g("FftSize")[4], windowSum: g("SpectrumGain")[0] };
}

let failures = 0;
for (const freq of [220, 1000, 3333]) {
  for (const fftSize of [1024, 4096]) {
    const data = analyse(freq, { fftSize, window: 1, overlap: 2, freqOverlap: 0 });
    for (const mode of ["exactDb", "db", "compressed", "linear"]) {
      for (const axis of ["log", "linear", "mel"]) {
        for (const w of [300, 600, 1200]) {
          const cols = ctx.nodeGraphSpectrumLineComputeColumns(w, data, { spectrumDbMode: mode, spectrumAxis: axis, minFreq: 20, maxFreq: 20000 });
          let peaks = 0;
          for (let i = 1; i < w - 1; i += 1) {
            if (!Number.isFinite(cols[i])) { failures += 1; break; }
            if (cols[i] > 0.15 && cols[i] > cols[i - 1] && cols[i] >= cols[i + 1]) peaks += 1;
          }
          if (peaks !== 1) {
            failures += 1;
            console.error(`FAIL ${freq} Hz fft${fftSize} ${mode} ${axis} w${w}: ${peaks} local maxima above floor (want 1)`);
          }
        }
      }
    }
  }
}
if (failures) {
  console.error(`smoke_spectrum1d_sine FAILED (${failures})`);
  process.exit(1);
}
console.log("smoke_spectrum1d_sine ok");
