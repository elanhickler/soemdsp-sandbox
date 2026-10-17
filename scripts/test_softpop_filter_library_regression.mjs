// Byte-for-byte regression for moving Softpop Filter tilt / level / sin(w)/w
// decramp into library/include/soemdsp/filter/softpop_band.h (docs/SOFTPOP2_PLAN.md).
// Colors 0–4 (White / Gaussian / Average / Pink / Brown) must stay identical.
//
// Usage:
//   node scripts/test_softpop_filter_library_regression.mjs
//   node scripts/test_softpop_filter_library_regression.mjs --capture
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = process.argv.includes("--capture");
const force = process.argv.includes("--force");
const clangCandidates = [
  process.env.SOEMDSP_CLANG,
  "C:\\Program Files\\LLVM\\bin\\clang++.exe",
  "/usr/bin/clang++",
].filter(Boolean);
const clang = clangCandidates.find((p) => fs.existsSync(p));
if (!clang) throw new Error(`clang++ not found (tried ${clangCandidates.join(", ")})`);

const wasmPath = path.join(os.tmpdir(), `golden_softpop_filter_probe_${process.pid}.wasm`);
const exportsList = ["probe_buffer_ptr", "probe_capacity", "probe_render_softpop_filter"];
execFileSync(clang, [
  "--target=wasm32", "-O3", "-msimd128", "-nostdlib", "-fno-exceptions", "-fno-rtti",
  `-I${path.join(root, "library", "include")}`,
  "-Wl,--no-entry",
  ...exportsList.map((e) => `-Wl,--export=${e}`),
  "-Wl,--export-memory",
  "-o", wasmPath,
  path.join(root, "scripts", "golden_softpop_filter_probe.cpp"),
  path.join(root, "native_modules", "softpop_filter", "softpop_filter.cpp"),
  path.join(root, "native_modules", "combined", "shim.cpp"),
], { stdio: "inherit" });
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
fs.rmSync(wasmPath, { force: true });
const x = instance.exports;

function render(fn) {
  const n = fn() | 0;
  const cap = x.probe_capacity() | 0;
  if (n > cap) throw new Error(`probe overflow ${n} > ${cap}`);
  const ptr = x.probe_buffer_ptr() >>> 0;
  return Buffer.from(new Uint8Array(x.memory.buffer, ptr, n * 8).slice());
}

const goldenDir = path.join(root, "fixtures", "golden");
const name = "softpop_filter_colors_0_4";
const bytes = render(x.probe_render_softpop_filter);
const sha = crypto.createHash("sha256").update(bytes).digest("hex");
const binPath = path.join(goldenDir, `${name}.bin`);
const shaPath = `${binPath}.sha256`;
const doubles = new Float64Array(bytes.buffer, bytes.byteOffset, bytes.length / 8);
let finite = 0;
for (const v of doubles) if (Number.isFinite(v)) finite += 1;
if (capture) {
  if (fs.existsSync(binPath) && !force) {
    throw new Error(`${binPath} exists; refusing to overwrite (use --capture --force)`);
  }
  fs.mkdirSync(goldenDir, { recursive: true });
  fs.writeFileSync(binPath, bytes);
  fs.writeFileSync(shaPath, `${sha}  ${name}.bin\n`);
  console.log(`captured ${name}: ${doubles.length} doubles (${finite} finite) sha256=${sha}`);
  process.exit(0);
}
if (!fs.existsSync(binPath)) throw new Error(`missing golden ${binPath} (run with --capture first)`);
const golden = fs.readFileSync(binPath);
const goldenSha = fs.readFileSync(shaPath, "utf8").trim().split(/\s+/)[0];
const fileSha = crypto.createHash("sha256").update(golden).digest("hex");
if (fileSha !== goldenSha) throw new Error(`${name}.bin does not match its .sha256 (corrupt fixture)`);
if (golden.length !== bytes.length || Buffer.compare(golden, bytes) !== 0) {
  const g = new Float64Array(golden.buffer, golden.byteOffset, golden.length / 8);
  let first = -1;
  let diffs = 0;
  const n = Math.min(g.length, doubles.length);
  for (let i = 0; i < n; i += 1) {
    if (!Object.is(g[i], doubles[i]) && !(Number.isNaN(g[i]) && Number.isNaN(doubles[i]))) {
      diffs += 1;
      if (first < 0) first = i;
    }
  }
  console.error(`FAIL ${name}: len golden=${g.length} now=${doubles.length}, ${diffs} differing doubles, first at ${first} (golden ${g[first]} now ${doubles[first]})`);
  process.exit(1);
}
console.log(`ok ${name}: ${doubles.length} doubles byte-identical, sha256=${sha}`);
