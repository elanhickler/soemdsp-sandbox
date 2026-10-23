// Native test for the shared oscillator Reset-trigger partial reset
// (library/include/soemdsp/trigger/trigger.h). Compiles
// scripts/test_partial_reset_phase.cpp to wasm and checks
// h = 1 / 0.5 / 0 / -0.5 / -1 plus wrap, clamp and trigger height.
// Run: node scripts/test_partial_reset_phase.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clang = process.platform === "win32" ? "C:\\Program Files\\LLVM\\bin\\clang++.exe" : "clang++";
const out = join(mkdtempSync(join(tmpdir(), "prp-")), "prp.wasm");
execFileSync(clang, [
  "--target=wasm32", "-O2", "-std=c++17", "-nostdlib", "-fno-exceptions",
  "-Wl,--no-entry", "-Wl,--export=prp", "-Wl,--export=hit_height",
  `-I${join(root, "library", "include")}`,
  join(root, "scripts", "test_partial_reset_phase.cpp"), "-o", out,
], { stdio: "inherit" });
const { instance } = await WebAssembly.instantiate(readFileSync(out), {});
const { prp, hit_height } = instance.exports;

let fails = 0;
function check(what, got, want) {
  const ok = Math.abs(got - want) < 1e-12;
  console.log(`${ok ? "ok  " : "FAIL"} ${what.padEnd(32)} got ${got} want ${want}`);
  if (!ok) fails++;
}
// Phase 0.25 cycles, reset point 0: short way is -0.25, long way +0.75.
check("h=1 hard reset", prp(0.25, 0, 1, 1), 0);
check("h=0.5 halfway (short way)", prp(0.25, 0, 0.5, 1), 0.125);
check("h=0 no change", prp(0.25, 0, 0, 1), 0.25);
check("h=-0.5 halfway (long way)", prp(0.25, 0, -0.5, 1), 0.625);
check("h=-1 lands on reset point", prp(0.25, 0, -1, 1), 0);
check("h=2 clamps to 1", prp(0.25, 0, 2, 1), 0);
check("h=-2 clamps to -1", prp(0.25, 0, -2, 1), 0);
check("wrap 0.9->0.1 h=0.5", prp(0.9, 0.1, 0.5, 1), 0);
check("wrap 0.9->0.1 h=-0.5", prp(0.9, 0.1, -0.5, 1), 0.5);
const tp = 2 * Math.PI;
check("radians h=0.5", prp(tp * 0.25, 0, 0.5, tp), tp * 0.125);
check("radians h=-0.5", prp(tp * 0.25, 0, -0.5, tp), tp * 0.625);
check("height 0->1", hit_height(0, 1), 1);
check("height 0->0.5", hit_height(0, 0.5), 0.5);
check("height 0->-0.5", hit_height(0, -0.5), -0.5);
check("height 0->-1", hit_height(0, -1), -1);
check("height 0->3 clamps", hit_height(0, 3), 1);
console.log(fails ? `FAILED ${fails}` : "all passed");
process.exit(fails ? 1 : 0);
