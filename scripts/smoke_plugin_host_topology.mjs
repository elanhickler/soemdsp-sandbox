// Plugin host topology (e6d43b4c): add, delete and wiring are all allowed in the
// plugin designer. Every commit passes through to the app and then syncs the
// plugin's native graph (patch event on topology change, params otherwise).
// Guards against the old locks (BLOCKED list, lock hint, wireEdit gate) coming back.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, "../public/plugin-host.js");
const src = fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");

let failures = 0;
function fail(msg) {
  console.error("FAIL:", msg);
  failures += 1;
}

if (/soundemote\.io/i.test(src)) fail("plugin-host.js must not mention soundemote.io");
if (/\bBLOCKED\b/.test(src)) fail("no BLOCKED list: add / delete / wiring are all allowed");
if (/LOCK_HINT|plugin-lock-hint/.test(src)) fail("no lock hint: nothing is locked");
if (/opts\.(wireEdit|topologyEdit)/.test(src)) fail("commit wrapper must not gate wireEdit / topologyEdit");
if (!src.includes("Add, delete, and wiring commit the patch and rebuild the native graph.")) {
  fail("header documents that add / delete / wiring rebuild the native graph");
}

// The commit wrapper runs the original commit first, then syncs the native graph.
const wrapStart = src.indexOf('wrapOnce("commitNodeGraphPatch"');
const wrapBody = wrapStart < 0 ? "" : src.slice(wrapStart, src.indexOf("\n    });", wrapStart));
if (!wrapBody) {
  fail("commitNodeGraphPatch wrapper missing");
} else {
  const call = wrapBody.indexOf("original.apply(this, arguments)");
  const sync = wrapBody.indexOf("afterCommit(options)");
  if (call < 0 || sync < 0 || sync < call) fail("wrapper must call the original commit, then afterCommit");
  if (/return\s+(false|null|"blocked")/.test(wrapBody)) fail("wrapper must never block a commit");
}

// afterCommit: topology change -> full patch to native, otherwise dirty params.
const afterStart = src.indexOf("function afterCommit(options) {");
const afterBody = afterStart < 0 ? "" : src.slice(afterStart, src.indexOf("\n  }\n", afterStart));
if (!afterBody) {
  fail("afterCommit missing");
} else if (!/topologySignature\(patch\) !== lastSentSignature[\s\S]*sendPatchToNative[\s\S]*emitDirtyParams/.test(afterBody)) {
  fail("afterCommit sends the patch on a topology change and dirty params otherwise");
}

if (failures) process.exit(1);
console.log("smoke_plugin_host_topology ok: add / delete / wiring commit and rebuild the native graph");
