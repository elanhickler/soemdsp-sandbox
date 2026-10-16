// Restore Factory (module settings row): resets a module to a fresh factory
// spawn -- definition defaults, user Save-to-Default ignored -- while keeping
// id, position, Seed params and every cable. Loads the app JS (index.html
// order) in a vm, like scripts/migrate_patch_seeds.mjs.
//
//   node scripts/smoke_restore_factory.mjs
import fs from "fs";
import path from "path";
import vm from "vm";
import assert from "assert/strict";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadApp() {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)(?:\?[^"]*)?"/g)].map((m) => m[1]);
  const stub = () => new Proxy(function stubFn() {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "length" ? 0 : stub()),
    apply: () => stub(),
    construct: () => stub(),
  });
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {}, group() {}, groupEnd() {}, groupCollapsed() {}, table() {}, time() {}, timeEnd() {} };
  const ctx = {
    console: quiet, crypto: globalThis.crypto, Math, Date, JSON, setTimeout() { return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {}, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    document: stub(), navigator: { userAgent: "node" }, screen: { width: 1, height: 1 }, CSS: { escape: (s) => String(s) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: "", href: "", pathname: "/", hostname: "localhost" },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, CustomEvent: class CustomEvent {}, Event: class Event {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: () => Promise.reject(new Error("no fetch in smoke")),
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const src of srcs) {
    const file = path.join(root, src.replace(/^\.\//, ""));
    if (!fs.existsSync(file)) continue;
    try {
      vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
    } catch {
      // DOM-only boot code; the functions under test are checked below.
    }
  }
  return ctx;
}

const ctx = loadApp();
const run = (code) => vm.runInContext(code, ctx);
for (const name of ["createNodeGraphPatchNode", "nodeGraphFactoryResetPatchNode", "nodeGraphDefaultParamsForType",
  "nodeGraphModuleSettingsSnapshot", "nodeGraphSeedParamKeysForType", "nodeGraphModuleDefinitions", "nodeGraphMvp"]) {
  assert.notEqual(run(`typeof ${name}`), "undefined", `${name} missing after load`);
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const api = run(`({ create: createNodeGraphPatchNode, reset: nodeGraphFactoryResetPatchNode,
  defaults: nodeGraphDefaultParamsForType, snapshot: nodeGraphModuleSettingsSnapshot,
  seedKeys: nodeGraphSeedParamKeysForType, defs: nodeGraphModuleDefinitions, mvp: nodeGraphMvp })`);

// --- 1) Main case: tweak params, Save to Default, Restore Factory ----------------
const type = "polyBlep";
const paramKeys = Object.keys(api.defaults(type));
assert.ok(paramKeys.length >= 2, "polyBlep should have params");
const live = api.create(type, { id: "polyBlep-1", gx: 7, gy: -3 });
const tweaked = {};
for (const key of paramKeys) {
  const v = live.params[key];
  if (typeof v === "number") { live.params[key] = v + 1; tweaked[key] = v + 1; }
}
live.alias = "Tweaked";
live.ui = { ...(live.ui || {}), titleHidden: true };
// Save to Default (what setNodeGraphModuleSettingsAsDefaultFromButton stores).
api.mvp.moduleDefaultOverrides = { [type]: api.snapshot(live) };
const userSpawn = api.create(type, { id: "probe", gx: 0, gy: 0 });
for (const [k, v] of Object.entries(tweaked)) {
  assert.equal(userSpawn.params[k], v, `user default not applied to new spawn (${k})`);
}

const connections = [
  { sourceNode: "polyBlep-1", sourcePort: "Wave", destinationNode: "output", destinationPort: "Mono" },
  { sourceNode: "lfo-x", sourcePort: "Out", destinationNode: "polyBlep-1", destinationPort: "f" },
];
const patch = {
  nodes: [live, api.create("output", { id: "output", gx: 20, gy: 0 })],
  connections: plain(connections),
  graphConnections: [],
  modulations: [{ sourceNode: "lfo-x", destinationNode: "polyBlep-1", param: paramKeys[0], amount: 0.5 }],
};
const modsBefore = plain(patch.modulations);
const restored = api.reset(patch, "polyBlep-1");
assert.ok(restored, "reset returned null");
assert.equal(patch.nodes[0], restored, "node replaced in place (same index)");
assert.equal(restored.id, "polyBlep-1");
assert.equal(restored.gx, 7);
assert.equal(restored.gy, -3);
assert.deepEqual(plain(restored.params), plain(api.defaults(type)), "params == definition defaults");
assert.equal(Object.hasOwn(restored, "alias") && restored.alias === "Tweaked", false, "alias reset");
assert.notEqual(restored.ui?.titleHidden, true, "ui reset");
assert.deepEqual(plain(patch.connections), connections, "cables intact");
assert.deepEqual(plain(patch.modulations), modsBefore, "modulations intact");
assert.deepEqual(plain(api.mvp.moduleDefaultOverrides[type].params), plain(api.snapshot(live).params),
  "Restore Factory must not clear the user's saved default");
console.log("restore factory: polyBlep params/ui/alias reset, user default ignored, cables kept");

// --- 2) Seeds kept, no master seed consumed --------------------------------------
const seedType = Object.keys(api.defs).find((t) => api.seedKeys(t).length);
if (seedType) {
  const key = api.seedKeys(seedType)[0];
  const n = api.create(seedType, { id: "s-1", gx: 1, gy: 2 });
  n.params[key] = 12345;
  const p = { nodes: [n], connections: [], masterSeed: 77 };
  const r = api.reset(p, "s-1");
  assert.equal(r.params[key], 12345, "seed kept");
  assert.equal(p.masterSeed, 77, "master seed untouched");
  console.log(`restore factory: ${seedType}.${key} seed kept, master seed untouched`);
}

// --- 3) Every module type: reset == factory spawn (+ seeds), kept fields kept ----
api.mvp.moduleDefaultOverrides = {};
let checked = 0;
const failures = [];
for (const t of Object.keys(api.defs)) {
  let n;
  try { n = api.create(t, { id: `${t}-9`, gx: 4, gy: 5 }); } catch { continue; }
  n.ownerMetamoduleId = "metamodule-1";
  const factory = plain(api.create(t, { id: `${t}-9`, gx: 4, gy: 5 }, { factory: true }));
  factory.ownerMetamoduleId = "metamodule-1";
  for (const key of api.seedKeys(t)) if (factory.params && Object.hasOwn(n.params || {}, key)) factory.params[key] = n.params[key];
  api.mvp.moduleDefaultOverrides = { [t]: { params: Object.fromEntries(Object.keys(n.params || {}).map((k) => [k, 0.123])) } };
  try {
    const p = { nodes: [n], connections: [] };
    const r = api.reset(p, n.id);
    assert.deepEqual(plain(r), factory);
    checked += 1;
  } catch (err) {
    failures.push(`${t}: ${String(err.message).split("\n")[0]}`);
  }
  api.mvp.moduleDefaultOverrides = {};
}
assert.deepEqual(failures, [], `types where reset != factory spawn:\n${failures.join("\n")}`);
assert.ok(checked > 50, `only ${checked} types checked`);
console.log(`restore factory: ${checked} module types reset == factory spawn`);
console.log("smoke_restore_factory ok");
