// Plugin host guards: window.soemdspPluginHost stands in for nodeGraphMvp.live.node
// in the paint gate and the scope / meter / visualControls worklet guards.
import fs from "node:fs";
import vm from "node:vm";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const gate = fs.readFileSync("public/node-graph-module-scope-paint-gate.js", "utf8");
function run(live, host) {
  const window = host ? { soemdspPluginHost: host } : {};
  const ctx = {
    window, nodeGraphMvp: { live }, console,
    nodeGraphFiniteNumber: (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f),
    clampNodeSliderValue: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  };
  vm.createContext(ctx);
  vm.runInContext(gate, ctx);
  return { playing: ctx.scopePaintIsEnginePlaying(), frozen: ctx.scopePaintIsFrozen() };
}
const expect = (name, got, want) => {
  if (got.playing !== want[0] || got.frozen !== want[1]) fail(`${name}: ${JSON.stringify(got)} want ${want}`);
};
// Browser (no plugin host): unchanged.
expect("no node", run({}, null), [false, false]);
expect("node playing", run({ node: {}, speedMultiplier: 1 }, null), [true, false]);
expect("node paused", run({ node: {}, speedMultiplier: 0 }, null), [false, true]);
// Plugin host, no worklet node.
expect("host playing", run({ speedMultiplier: 1 }, {}), [true, false]);
expect("host paused", run({ speedMultiplier: 0 }, {}), [false, true]);
const rt = fs.readFileSync("public/node-graph-live-runtime.js", "utf8");
const start = rt.indexOf("function handleNodeGraphLiveWorkletMessage");
if (start < 0) fail("handler missing");
const body = rt.slice(start, rt.indexOf("\nfunction ", start + 10));
for (const type of ["meter", "scope", "visualControls"]) {
  const i = body.indexOf(`message.type === "${type}"`);
  if (i < 0) fail(`no ${type} branch`);
  if (!body.slice(i, i + 200).includes("!(nodeGraphMvp.live.node || nodeGraphLivePluginHost())")) fail(`${type} guard lacks plugin host`);
}
const helper = rt.match(/function nodeGraphLivePluginHost\(\) \{[\s\S]*?\n\}/);
if (!helper) fail("helper missing");
const h = { window: {} };
vm.createContext(h);
vm.runInContext(`${helper[0]}\nthis.a = nodeGraphLivePluginHost(); window = { soemdspPluginHost: 7 }; this.b = nodeGraphLivePluginHost();`, h);
if (h.a !== null || h.b !== 7) fail(`helper ${h.a} ${h.b}`);
console.log("smoke_plugin_host_guards ok");
