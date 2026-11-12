#!/usr/bin/env node
// Startup zoom race: once the user zooms or pans, boot retries must not pull the view back in.
// Z-centering (pin-aware pan at the current zoom) must stay wired.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const boot = fs.readFileSync(path.join(root, "public/boot-loading.js"), "utf8");
const zoom = fs.readFileSync(path.join(root, "public/node-graph-workspace-zoom.js"), "utf8");
const shortcuts = fs.readFileSync(path.join(root, "public/node-graph-keyboard-shortcuts.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  /function nodeGraphMarkUserAdjustedView\(\)/.test(boot)
  && /function nodeGraphHasUserAdjustedView\(\)/.test(boot),
  "boot-loading must expose the user-view flag",
);

assert(
  /reason === "retry" && nodeGraphHasUserAdjustedView\(\)/.test(boot),
  "boot reframe retries must no-op after the user adjusts the view",
);

assert(
  /for \(const delay of \[120, 450, 1100, 2200\]\)/.test(boot),
  "boot still retries reframe while the user has not touched the view",
);

assert(
  /nodeGraphHasUserAdjustedView\(\)\) \{\s*return false;/.test(zoom),
  "offscreen recover retries must not autoframe after the user adjusts the view",
);

assert(
  /function nodeGraphCenterViewOnModules\(options = \{\}\) \{\s*if \(typeof nodeGraphMarkUserAdjustedView === "function"\) \{\s*nodeGraphMarkUserAdjustedView\(\);/.test(zoom),
  "Z / center-view must record a user view adjustment",
);

assert(
  /event\.key\.toLowerCase\(\) === "z"/.test(shortcuts)
  && /nodeGraphCenterViewOnModules\(\{\s*preferSelection:\s*true\s*\}\)/.test(shortcuts),
  "Z hotkey must still call nodeGraphCenterViewOnModules({ preferSelection: true })",
);

console.log("ok  zoom race: user zoom/pan wins over boot retries; Z-center still wired");