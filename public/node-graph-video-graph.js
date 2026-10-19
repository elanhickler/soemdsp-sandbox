// Video graph scheduler (docs/VIDEO_GRAPH_PLAN.md, VG-3).
//
// One requestAnimationFrame drives every video node (modules with a 📺
// picture in or out). Each frame the nodes that asked for a frame run in
// topological order of the 📺 edges, so a consumer always reads the picture
// its source made this same frame (0-frame hops). Edges inside a cycle
// (strongly connected component) cannot all be forward: within a cycle nodes
// run in patch order and the edge back to an earlier node reads the previous
// frame (exactly 1 frame).
//
// Clock: one Simulation FPS decision per frame for the whole graph
// (nodeGraphVideoGraphFrameReady), instead of one clock per module type.
//
// Pull-based culling (VG-4): a node runs when it is needed: its own face is
// on screen (a visible sink), or a visible sink reads its picture through
// any chain of picture cables. Needed nodes run even when their own face is
// viewport-asleep or hidden; nodes nothing visible needs run 0 passes.
// Modules ask nodeGraphVideoGraphShouldSleep(nodeId) instead of checking
// viewport-asleep themselves, and register a wake so a stopped loop restarts
// when a visible sink starts needing it.
//
// Adapter (VG-3): modules not yet migrated keep their own step/paint code;
// they only swap requestAnimationFrame / cancelAnimationFrame for
// nodeGraphVideoGraphRequestFrame / nodeGraphVideoGraphCancelFrame, and their
// Simulation FPS check for nodeGraphVideoGraphFrameReady.

(function (global) {
  "use strict";

  // Module types that run on this scheduler (VG-3 adapters).
  const VIDEO_TYPES = new Set(["fbmField", "rgbFractal", "videoDelay", "videoFeedback", "imageBurn"]);
  // Tokens live far above real rAF ids so a stray cancelAnimationFrame never
  // hits one and nodeGraphVideoGraphCancelFrame can tell them apart.
  const TOKEN_BASE = 2 ** 40;
  let nextToken = TOKEN_BASE;
  const pending = new Map(); // token -> { nodeId, cb }
  let raf = 0;
  let frame = 0;
  let ready = { frame: -1, value: false };
  const order = { rebuilds: -1, nodes: null, rank: new Map(), backEdges: 0 };
  const stats = { frames: 0, runs: 0, wakes: 0 };
  const need = { frame: -1, set: new Set() };
  const wakes = new Map(); // nodeId -> Set of wake callbacks

  function nodeGraphVideoGraphIsVideoType(type) {
    return VIDEO_TYPES.has(String(type || ""));
  }

  /** Rank every node: topological over 📺 edges, cycles in patch order. */
  function rebuildOrder() {
    const table = typeof global.nodeGraphPictureEdges === "function" ? global.nodeGraphPictureEdges() : null;
    const nodes = global.nodeGraphMvp?.patch?.nodes || [];
    if (table && order.rebuilds === table.rebuilds && order.nodes === nodes) return;
    order.rebuilds = table ? table.rebuilds : -1;
    order.nodes = nodes;
    const ids = nodes.map((n) => String(n?.id || "")).filter(Boolean);
    const patchIndex = new Map(ids.map((id, i) => [id, i]));
    // dest -> sources (📺 only)
    const ins = new Map(ids.map((id) => [id, []]));
    if (table) {
      for (const [key, feeds] of table.inlets) {
        const dest = key.slice(0, key.indexOf("\u0000"));
        if (!ins.has(dest)) continue;
        for (const src of feeds) if (patchIndex.has(src)) ins.get(dest).push(src);
      }
    }
    const outs = new Map(ids.map((id) => [id, []]));
    for (const [dest, srcs] of ins) for (const src of srcs) outs.get(src).push(dest);
    // Tarjan SCC (iterative); components come out in reverse topological order.
    const index = new Map(); const low = new Map(); const onStack = new Set();
    const stack = []; const comps = []; let counter = 0;
    for (const root of ids) {
      if (index.has(root)) continue;
      const work = [[root, 0]];
      index.set(root, counter); low.set(root, counter); counter += 1;
      stack.push(root); onStack.add(root);
      while (work.length) {
        const top = work[work.length - 1];
        const [v, i] = top;
        const next = outs.get(v);
        if (i < next.length) {
          top[1] += 1;
          const w = next[i];
          if (!index.has(w)) {
            index.set(w, counter); low.set(w, counter); counter += 1;
            stack.push(w); onStack.add(w);
            work.push([w, 0]);
          } else if (onStack.has(w)) {
            low.set(v, Math.min(low.get(v), index.get(w)));
          }
          continue;
        }
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low.set(u, Math.min(low.get(u), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
          comps.push(comp);
        }
      }
    }
    comps.reverse();
    // Components in topological order (Tarjan, reversed); inside a component,
    // patch order. Edges to an earlier rank are back edges (previous frame).
    const rank = new Map();
    let r = 0;
    let back = 0;
    for (const comp of comps) {
      comp.sort((a, b) => patchIndex.get(a) - patchIndex.get(b));
      for (const id of comp) rank.set(id, r++);
    }
    for (const [dest, srcs] of ins) {
      for (const src of srcs) if (rank.get(src) >= rank.get(dest)) back += 1;
    }
    order.rank = rank;
    order.backEdges = back;
  }

  /** Face on screen: not viewport-asleep, not hidden, allowed by screen solo. */
  function sinkVisible(id) {
    const el = typeof global.nodeGraphCachedNodeElement === "function"
      ? global.nodeGraphCachedNodeElement(".dsp-node", id)
      : global.document?.querySelector?.(`.dsp-node[data-node="${id}"]`);
    if (!el || el.hidden) return false;
    if (typeof global.nodeGraphModuleIsViewportAsleep === "function" && global.nodeGraphModuleIsViewportAsleep(el)) return false;
    if (typeof global.nodeGraphScreenSoloIsActive === "function" && global.nodeGraphScreenSoloIsActive()
      && typeof global.nodeGraphScreenSoloAllowsNode === "function" && !global.nodeGraphScreenSoloAllowsNode(id)) return false;
    return true;
  }

  /** Needed nodes this frame: visible sinks plus everything upstream of them. */
  function neededSet() {
    if (need.frame === frame) return need.set;
    const table = typeof global.nodeGraphPictureEdges === "function" ? global.nodeGraphPictureEdges() : null;
    const upstream = table?.upstream || new Map();
    const nodes = global.nodeGraphMvp?.patch?.nodes || [];
    const set = new Set();
    const walk = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const id = String(nodes[i]?.id || "");
      if (!id) continue;
      // Sinks: video nodes (own face) and any node a picture cable feeds.
      if (!VIDEO_TYPES.has(String(nodes[i]?.type || "")) && !upstream.has(id)) continue;
      if (sinkVisible(id)) { set.add(id); walk.push(id); }
    }
    while (walk.length) {
      const srcs = upstream.get(walk.pop());
      if (!srcs) continue;
      for (const src of srcs) if (!set.has(src)) { set.add(src); walk.push(src); }
    }
    const before = need.set;
    need.frame = frame;
    need.set = set;
    // Newly needed nodes may have stopped their loop while unneeded: wake them.
    for (const id of set) {
      if (before.has(id)) continue;
      const fns = wakes.get(id);
      if (!fns) continue;
      for (const fn of fns) {
        stats.wakes += 1;
        try { fn(); } catch (error) { setTimeout(() => { throw error; }); }
      }
    }
    return set;
  }

  /** True when no visible sink needs this node's picture or face. */
  function nodeGraphVideoGraphShouldSleep(nodeId) {
    return !neededSet().has(String(nodeId || ""));
  }

  /** Restart callback for a node whose loop stopped (returns an unregister). */
  function nodeGraphVideoGraphRegisterWake(nodeId, fn) {
    const id = String(nodeId || "");
    if (!id || typeof fn !== "function") return () => {};
    let fns = wakes.get(id);
    if (!fns) wakes.set(id, (fns = new Set()));
    fns.add(fn);
    return () => fns.delete(fn);
  }

  function runFrame() {
    raf = 0;
    frame += 1;
    stats.frames += 1;
    if (!pending.size) return;
    neededSet();
    rebuildOrder();
    const batch = [...pending.values()];
    pending.clear();
    const rank = order.rank;
    const big = Number.MAX_SAFE_INTEGER;
    batch.sort((a, b) => (rank.has(a.nodeId) ? rank.get(a.nodeId) : big) - (rank.has(b.nodeId) ? rank.get(b.nodeId) : big));
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    for (let i = 0; i < batch.length; i += 1) {
      stats.runs += 1;
      try {
        batch[i].cb(now);
      } catch (error) {
        // A node's step threw: report it, keep the rest of the graph running.
        if (typeof global.reportError === "function") global.reportError(error);
        else setTimeout(() => { throw error; });
      }
    }
  }

  /** requestAnimationFrame for a video node. Returns a token. */
  function nodeGraphVideoGraphRequestFrame(nodeId, cb) {
    const token = nextToken++;
    pending.set(token, { nodeId: String(nodeId || ""), cb });
    if (!raf) raf = requestAnimationFrame(runFrame);
    return token;
  }

  /** cancelAnimationFrame for a token (real rAF ids are passed through). */
  function nodeGraphVideoGraphCancelFrame(token) {
    if (!token) return;
    if (token >= TOKEN_BASE) pending.delete(token);
    else cancelAnimationFrame(token);
  }

  /**
   * One Simulation FPS decision per frame for the whole video graph. A
   * forced paint (param edit, wake) passes through.
   */
  function nodeGraphVideoGraphFrameReady(force = false) {
    if (force === true) return true;
    if (ready.frame !== frame) {
      ready.frame = frame;
      ready.value = typeof global.nodeGraphSimFpsShouldPaint === "function"
        ? global.nodeGraphSimFpsShouldPaint("videoGraph", false)
        : true;
    }
    return ready.value;
  }

  function nodeGraphVideoGraphStats() {
    rebuildOrder();
    return { ...stats, frame, pending: pending.size, needed: [...neededSet()], backEdges: order.backEdges, order: [...order.rank.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id) };
  }

  global.nodeGraphVideoGraphIsVideoType = nodeGraphVideoGraphIsVideoType;
  global.nodeGraphVideoGraphRequestFrame = nodeGraphVideoGraphRequestFrame;
  global.nodeGraphVideoGraphCancelFrame = nodeGraphVideoGraphCancelFrame;
  global.nodeGraphVideoGraphFrameReady = nodeGraphVideoGraphFrameReady;
  global.nodeGraphVideoGraphStats = nodeGraphVideoGraphStats;
  global.nodeGraphVideoGraphShouldSleep = nodeGraphVideoGraphShouldSleep;
  global.nodeGraphVideoGraphRegisterWake = nodeGraphVideoGraphRegisterWake;
})(typeof window !== "undefined" ? window : globalThis);