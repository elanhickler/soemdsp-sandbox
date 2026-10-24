# B-114 — Flower Child Rev3 1D Trace OOM: Array buffer allocation failed

Report ID: B-114  
Status: open  
Severity: see  
Source: user 2026-10-24 (Argi), Desktop `ingest.txt`

## User symptom

Flower Child Filter Rev3 1D Trace dies. Console spams every ~120 ms:

`RangeError: Array buffer allocation failed` at `nodeGraphTraceDisplayMonoSyncBuffer` (`node-graph-module-scope-sync.js` line 684).

Live parameter sync still works. The tab is out of ArrayBuffer heap.

## Cause

Rev3 (and original Flower Child) use `syncTraceFromInputs: { mono: "In", left: "Left", right: "Right" }` with Sync on. When both Left and Right have source buffers, the draw path averages them into a mono trigger:

```
new Float32Array(n)  // n = ring length, ~10 s ≈ 441k floats ≈ 1.7 MB
```

Scratch is stored in `monoSyncScratch` keyed by `nodeGraphScopeBufferObjectId(left)|id(right)`. Live rings are `Float32Array.subarray` views. `nodeGraphScopeRingAdvance` **replaces** the Map entry with a new view on every scope post, so the object id is new every frame. The Map keeps every old 1.7 MB array.

Native live capture does not fill `${nodeId}:__inSync`, so this L+R average path is the one that runs.

## Fix shape

Stamp rings with a stable `nodeGraphScopeBufferKey` (the `node:port` map id) and key `monoSyncScratch` on that, or key by destination node id. Reuse one Float32Array. Drop the per-frame Proxy if a view of the scratch is enough.
