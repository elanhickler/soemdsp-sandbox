// Seed type-in: text codes like "fuckmoth" parse, face/row double-click
// (and phone long-hold) open the shared editor with a text keyboard.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ctx = { console, module: { exports: {} } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "public", "node-graph-seed-code.js"), "utf8"),
  ctx,
  { filename: "node-graph-seed-code.js" },
);
const api = ctx.module.exports;
const parse = api.parseNodeGraphSeedInput;
const format = api.formatNodeGraphSeedCode;

assert(typeof parse === "function" && typeof format === "function", "seed code API");

const word = parse("fuckmoth");
assert(Number.isFinite(word), "fuckmoth is a valid text seed");
assert(word !== parse("fuckmoti"), "different text seeds hash differently");
assert(word === parse("  fuckmoth  "), "leading/trailing spaces are ignored");
assert(Number.isFinite(parse("baby")) && parse("baby") !== parse("babys"),
  "short codes pad; longer codes wrap and stay distinct");
assert(Number.isFinite(parse("P6nC")), "4-character code parses");
assert(format(parse(format(1000))) === format(1000), "4-character codes round-trip");
assert(Number.isFinite(parse("#3FA9C2")), "hex color still parses");
assert(!Number.isFinite(parse("fuck moth!")), "characters outside the seed alphabet are rejected");
assert(!Number.isFinite(parse("")), "empty input is rejected");

const faceSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-face.js"), "utf8");
assert(
  /function nodeGraphModuleFaceTypesValue\([^)]*\)\s*\{[\s\S]*?seedNumber[\s\S]*?\}/.test(faceSrc),
  "face type-in allow-list includes seedNumber",
);
assert(
  faceSrc.includes("wd.type === \"seedNumber\"")
  && faceSrc.includes("beginNodeGraphModuleFaceValueEdit(article, face, wd, p)"),
  "face seed number opens the shared type-in editor",
);
assert(
  faceSrc.includes("double-tap") || faceSrc.includes("doubleTap"),
  "face seed type-in is armed on touch double-tap",
);
assert(
  faceSrc.includes("nodeGraphTouchGestureArmHold"),
  "face seed type-in is armed on phone long-hold",
);

const editSrc = fs.readFileSync(path.join(root, "public", "node-graph-slider-readout-controls.js"), "utf8");
assert(
  editSrc.includes('slider.dataset?.kind === "seed" ? "text" : "decimal"'),
  "face seed editor uses a text keyboard, not a decimal keypad",
);
assert(
  /function beginNodeSliderReadoutEdit[\s\S]*input\.inputMode = "text"/.test(editSrc),
  "parameter-row type-in already uses a text field",
);

const dragSrc = fs.readFileSync(path.join(root, "public", "node-graph-slider-dragging.js"), "utf8");
assert(
  /dataset\?\.kind === "seed"[\s\S]*parseNodeGraphSeedInput/.test(dragSrc),
  "typed seed values go through parseNodeGraphSeedInput",
);

const rowSrc = fs.readFileSync(path.join(root, "public", "node-graph-seed-control.js"), "utf8");
assert(
  rowSrc.includes("beginNodeSliderReadoutEdit"),
  "parameter-row seed double-click / double-tap still opens type-in",
);
assert(
  rowSrc.includes("nodeGraphTouchGestureArmHold"),
  "parameter-row seed long-hold also opens type-in",
);

console.log("test_seed_typein: ok");
