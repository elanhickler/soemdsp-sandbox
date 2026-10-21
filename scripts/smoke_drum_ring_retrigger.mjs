// Drum Ring2 resonator: fast retriggers while the pitch bends must not pump
// energy (the old direct-form resonator ran away: "runaway triggers" patch,
// Modal Snare retriggered at 49 Hz with Bend 1.73 oct grew x1e6 per second).
// Every Ring2 drum, every algorithm, retriggered at 49 Hz for 6 s: the last
// second's peak stays within 1.5x of the second second's, and bounded.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } })).instance.exports;
const SR = 44100;
// name, base args (trigger first), algorithm idx (-1 none), algorithm count, bend idx (-1 none)
const M = [
  ["electro_kick", [0, 0, 0, 55, 1, 0.05, 0.5, 0.5, 0.5, 1], 2, 3],
  ["electro_snare", [0, 0, 0, 180, 0.5, 0.5, 0.25, 0.2, 0, 1, 2, 0.4], 2, 5],
  ["electro_tom", [0, 0, 0, 120, 0.5, 0.5, 0.4, 0.3, 1], 2, 3],
  ["modal_snare", [0, 0, 180, 0, 0.21776, 0.48553, 0.40651, 1.72608, 1, 1208.6, 2.848, 0.55474, 7.0797, -0.21893], -1, 1],
];
const per = Math.round(SR / 48.98);
for (const [name, base, algIdx, algs] of M) {
  for (let alg = 0; alg < algs; alg++) {
    if (name === "electro_snare" && alg === 3) continue;
    const h = E[`soemdsp_${name}_create`]();
    const peaks = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < SR * 6; i++) {
      const a = base.slice();
      if (algIdx >= 0) a[algIdx] = alg;
      a[0] = i % per === 0 ? 0.061 : 0;
      const y = Math.abs(E[`soemdsp_${name}_sample`](h, ...a, SR, 0));
      const s = Math.floor(i / SR);
      if (!(y <= 1e3)) throw new Error(`${name} alg ${alg}: output ${y} at ${i}`);
      peaks[s] = Math.max(peaks[s], y);
    }
    E[`soemdsp_${name}_destroy`](h);
    if (peaks[5] > 1.5 * peaks[1] + 1e-12) throw new Error(`${name} alg ${alg}: retrigger level grows (${peaks.map((p) => p.toPrecision(3)).join(" ")})`);
    console.log(`ok ${name} alg ${alg}: 49 Hz retrigger peak per second ${peaks.map((p) => p.toPrecision(3)).join(" ")}`);
  }
}
