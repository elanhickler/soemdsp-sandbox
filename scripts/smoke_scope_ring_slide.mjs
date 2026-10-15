// Scope ring push: the sliding-window backing (perf fix for 10 s rings) must
// give exactly the same ring contents as the old "copyWithin + append" shift,
// keep per-buffer props across the view swap, and survive compaction.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../public/node-graph-module-scope-buffer-io.js", import.meta.url), "utf8");
const CAP = 5000;
const ctx = {
  console, Math, Number, Float32Array, ArrayBuffer, DataView, Array, String, Map, Object,
  nodeGraphFiniteNumber: (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d),
  nodeGraphLiveModuleScopeFrameCapacity: () => CAP,
  nodeGraphModuleScopeScalarValue: (v) => (typeof v === "number" && Number.isFinite(v) ? v : (v && typeof v === "object" && Number.isFinite(v.Out) ? v.Out : 0)),
  nodeGraphModuleScopeState: { buffers: new Map(), versionSerial: 0, waterfallDrawCache: new Map() },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fails++; };

const ref = new Float32Array(CAP);
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let total = 0;
let counted = 0; // ring counts at most CAP per post (unchanged behaviour)
let mismatch = -1;
for (let post = 0; post < 400; post++) {
  const n = post === 200 ? CAP + 7 : 1 + Math.floor(rnd() * 900);
  const chunk = new Float32Array(n);
  for (let i = 0; i < n; i++) chunk[i] = total + i;
  if (post === 50) chunk[3] = NaN;
  ctx.pushNodeGraphLiveModuleScopeSamples("a", chunk);
  // reference: old behaviour
  const c = Math.min(CAP, n);
  if (c < CAP) ref.copyWithin(0, c);
  for (let i = 0; i < c; i++) { const v = chunk[n - c + i]; ref[CAP - c + i] = Number.isFinite(v) ? v : 0; }
  total += n;
  counted += c;
  if (post === 10) ctx.nodeGraphModuleScopeState.buffers.get("a").nodeGraphScopeBurnArmed = "kept";
  const buf = ctx.nodeGraphModuleScopeState.buffers.get("a");
  if (mismatch < 0) { for (let i = 0; i < CAP; i++) if (buf[i] !== ref[i]) { mismatch = post; break; } }
}
const buf = ctx.nodeGraphModuleScopeState.buffers.get("a");
check(mismatch < 0, `ring contents match the old shift over 400 posts incl. compaction and overfill (first mismatch: ${mismatch})`);
check(buf.length === CAP, `ring length stays ${CAP} (got ${buf.length})`);
check(buf.nodeGraphScopeBurnArmed === "kept", "reader-set props survive the view swap");
check(buf.nodeGraphScopeTotalSampleCount === counted, `total sample count tracked (${buf.nodeGraphScopeTotalSampleCount} vs ${counted})`);
ctx.pushNodeGraphLiveModuleScopeSamples("b", [{ Out: 2 }, 3, NaN]);
const b = ctx.nodeGraphModuleScopeState.buffers.get("b");
check(b[CAP - 3] === 2 && b[CAP - 2] === 3 && b[CAP - 1] === 0, "plain arrays still go through the scalar reader");
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("smoke_scope_ring_slide passed");
