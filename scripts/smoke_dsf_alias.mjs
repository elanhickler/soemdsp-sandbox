import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sampleRate = 48000;
const count = 32768;

function fft(real, imaginary) {
  for (let i = 1, j = 0; i < count; i++) {
    let bit = count >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= count; length <<= 1) {
    for (let start = 0; start < count; start += length) {
      for (let offset = 0; offset < length / 2; offset++) {
        const angle = -2 * Math.PI * offset / length;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const a = start + offset;
        const b = a + length / 2;
        const nextReal = real[b] * cosine - imaginary[b] * sine;
        const nextImaginary = real[b] * sine + imaginary[b] * cosine;
        real[b] = real[a] - nextReal;
        imaginary[b] = imaginary[a] - nextImaginary;
        real[a] += nextReal;
        imaginary[a] += nextImaginary;
      }
    }
  }
}

function outsideHarmonicsDb(exports, frequency, waveform) {
  const handle = exports.soemdsp_dsf_oscillator_create();
  assert.ok(handle, "DSF oscillator handle unavailable");
  const real = new Float64Array(count);
  const imaginary = new Float64Array(count);
  for (let i = 0; i < sampleRate + count; i++) {
    exports.soemdsp_dsf_oscillator_sample(handle, frequency, sampleRate, waveform, 1, 0.5, 0, 0, 1, 64);
    if (i >= sampleRate) {
      const index = i - sampleRate;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (count - 1));
      real[index] = exports.soemdsp_dsf_oscillator_out(handle) * window;
    }
  }
  exports.soemdsp_dsf_oscillator_destroy(handle);
  fft(real, imaginary);
  let total = 0;
  let harmonic = 0;
  for (let bin = 1; bin < count / 2; bin++) {
    const power = real[bin] ** 2 + imaginary[bin] ** 2;
    total += power;
    for (let multiple = 1; multiple * frequency < sampleRate / 2; multiple++) {
      const center = multiple * frequency * 0.9999 * count / sampleRate;
      if (Math.abs(bin - center) < 4) {
        harmonic += power;
        break;
      }
    }
  }
  assert.ok(total > 0, "DSF oscillator produced silence");
  return 10 * Math.log10(Math.max(0, total - harmonic) / total);
}

for (const relativePath of [
  "native_modules/dsf_oscillator/dsf_oscillator.wasm",
  "native_modules/combined/soemdsp_combined.wasm",
]) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  const exports = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { emo_process_block: () => 0 },
  }).exports;
  for (const [frequency, waveform, ceiling] of [
    [440, 1, -40],
    [2000, 1, -40],
    [5000, 1, -60],
    [10000, 1, -60],
    [5000, 3, -60],
  ]) {
    const measured = outsideHarmonicsDb(exports, frequency, waveform);
    console.log(`${relativePath}: ${frequency} Hz waveform ${waveform}: ${measured.toFixed(1)} dB`);
    assert.ok(measured < ceiling, `DSF alias regression at ${frequency} Hz: ${measured.toFixed(1)} dB`);
  }
}
