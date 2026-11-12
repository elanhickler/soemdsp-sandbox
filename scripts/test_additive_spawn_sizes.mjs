#!/usr/bin/env node
// Additive default spawn sizes: Generator 6x3, Out 8x4 (width x face height, grid units).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const gen = src.match(/additiveGenerator:\s*\{[\s\S]*?displayHeightGu:\s*(\d+)[\s\S]*?defaultWidthGu:\s*(\d+)/);
const out = src.match(/additiveOut:\s*\{[\s\S]*?displayHeightGu:\s*(\d+)[\s\S]*?defaultWidthGu:\s*(\d+)/);
assert(gen && Number(gen[1]) === 3 && Number(gen[2]) === 6, `Additive Generator spawn should be 6x3, got ${gen && gen[2]}x${gen && gen[1]}`);
assert(out && Number(out[1]) === 4 && Number(out[2]) === 8, `Additive Out spawn should be 8x4, got ${out && out[2]}x${out && out[1]}`);

console.log("ok  Additive spawn sizes: Generator 6x3, Out 8x4");