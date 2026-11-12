#!/usr/bin/env node
// Smoke-test failures must print in red in the terminal.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "scripts/smoke.mjs"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(src.includes('SMOKE_RED = "\\x1b[31m"'), "smoke.mjs must define ANSI red");
assert(src.includes('s.includes("PROBLEM") ? `${SMOKE_RED}${s}${SMOKE_RESET}`'), "PROBLEM lines must be printed in red");
assert(src.includes('`${SMOKE_RED}[smoke] ${problems} problem(s), see above${SMOKE_RESET}`'), "the failure summary must be printed in red");
assert(!src.includes('console.log(problems ? `[smoke] ${problems} problem(s), see above`'), "the uncolored failure summary must be gone");

console.log("ok  smoke-test failures print in red");