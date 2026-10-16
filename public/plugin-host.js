/**
 * Plugin host mode (soemdsp-sandbox-audioplugin).
 *
 * On when the page runs inside the plugin WebView (?host=plugin, or a JUCE
 * backend on index.html). Off in every browser; then this file returns early
 * and changes nothing.
 *
 * In plugin mode:
 *   No AudioWorklet / graph wasm audio. The plugin's native engine plays.
 *   fetch("/api/...") goes to the plugin (JUCE native function soemdspApi).
 *   Param edits go to the native engine as "param" events.
 *   Patch loads send the patch JSON as a "patch" event (native graph rebuild).
 *   Wiring and deleting modules stay locked; adding modules is allowed
 *   (native graph rebuild/click is acceptable until surgical sync lands).
 *   Scopes / meters: the plugin sends frame batches (receiveFrameBatch) built
 *   from the watch list this file sends as "displayWatch" events.
 */
(function soemdspPluginHostBoot(global) {
  "use strict";

  var PROTOCOL_TYPE = "soemdsp-perform";
  var PROTOCOL_V = 1;
  var API_FUNCTION = "soemdspApi";
  var BODY_CLASS = "soemdsp-plugin-host";
  var PARAM_POLL_MS = 33;
  var LOCK_HINT = "Plugin: wiring and deleting modules are locked.";

  function hostFlag() {
    try {
      return String(new URLSearchParams(global.location.search).get("host") || "").trim().toLowerCase() === "plugin";
    } catch (_e) {
      return false;
    }
  }

  function isPerformPath() {
    try {
      return String(global.location.pathname || "").toLowerCase().endsWith("/perform.html");
    } catch (_e) {
      return false;
    }
  }

  function juceBackend() {
    var juce = global.__JUCE__;
    return juce && juce.backend && typeof juce.backend.emitEvent === "function" ? juce.backend : null;
  }

  var enabled = !isPerformPath() && (hostFlag() || Boolean(juceBackend()));
  global.soemdspPluginHost = enabled;
  if (!enabled) return;

  document.documentElement.classList.add(BODY_CLASS);

  // Host bridge

  function postToHost(payload) {
    var backend = juceBackend();
    if (!backend) return;
    try {
      backend.emitEvent(PROTOCOL_TYPE, Object.assign({ type: PROTOCOL_TYPE, v: PROTOCOL_V }, payload));
    } catch (_e) { /* host gone */ }
  }

  var pendingCalls = new Map();
  var nextCallId = 1;
  var completeBound = false;

  function bindComplete(backend) {
    if (completeBound) return;
    completeBound = true;
    backend.addEventListener("__juce__complete", function (msg) {
      var id = msg && msg.promiseId;
      var entry = pendingCalls.get(id);
      if (!entry) return;
      pendingCalls.delete(id);
      entry.resolve(msg.result);
    });
  }

  function callNative(name, params) {
    var backend = juceBackend();
    if (!backend) return Promise.reject(new Error("plugin host bridge unavailable"));
    bindComplete(backend);
    var id = 1000000 + nextCallId++;
    return new Promise(function (resolve, reject) {
      pendingCalls.set(id, { resolve: resolve, reject: reject });
      backend.emitEvent("__juce__invoke", { name: name, params: params, resultId: id });
    });
  }

  // fetch shim: /api/* goes to the plugin

  var originalFetch = typeof global.fetch === "function" ? global.fetch.bind(global) : null;

  function bodyText(body) {
    if (body == null) return Promise.resolve("");
    if (typeof body === "string") return Promise.resolve(body);
    try {
      return new Response(body).text();
    } catch (_e) {
      return Promise.resolve(String(body));
    }
  }

  global.fetch = function soemdspPluginFetch(input, init) {
    var raw = typeof input === "string" || input instanceof URL ? String(input) : (input && input.url) || "";
    var url;
    try {
      url = new URL(raw, global.location.href);
    } catch (_e) {
      url = null;
    }
    if (!url || url.origin !== global.location.origin || url.pathname.indexOf("/api/") !== 0) {
      return originalFetch(input, init);
    }
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var bodyPromise = init && init.body != null
      ? bodyText(init.body)
      : (input && typeof input.text === "function" && method !== "GET" ? input.text() : Promise.resolve(""));
    return bodyPromise
      .then(function (text) {
        return callNative(API_FUNCTION, [method, url.pathname, url.search.replace(/^\?/, ""), text]);
      })
      .then(function (result) {
        var status = Number(result && result.status) || 500;
        var type = String((result && result.contentType) || "application/json; charset=utf-8");
        return new Response(String((result && result.body) || ""), {
          status: status,
          headers: { "Content-Type": type },
        });
      });
  };

  // Lock hint

  var hintEl = null;
  var hintTimer = 0;

  function ensureHintStyle() {
    if (document.getElementById("soemdspPluginHostStyle")) return;
    var style = document.createElement("style");
    style.id = "soemdspPluginHostStyle";
    style.textContent =
      ".soemdsp-plugin-lock-hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);"
      + "z-index:2147483000;padding:6px 12px;border-radius:6px;background:rgba(20,20,24,0.92);"
      + "color:#f2e9c8;font:12px/1.3 system-ui,sans-serif;pointer-events:none;opacity:0;"
      + "transition:opacity 160ms}"
      + ".soemdsp-plugin-lock-hint.is-visible{opacity:1}";
    (document.head || document.documentElement).appendChild(style);
  }

  function showLockHint() {
    if (!document.body) return;
    ensureHintStyle();
    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.className = "soemdsp-plugin-lock-hint";
      hintEl.setAttribute("role", "status");
      hintEl.textContent = LOCK_HINT;
      document.body.appendChild(hintEl);
    }
    hintEl.classList.add("is-visible");
    global.clearTimeout(hintTimer);
    hintTimer = global.setTimeout(function () {
      if (hintEl) hintEl.classList.remove("is-visible");
    }, 2600);
  }

  // Topology signature: which modules exist and how they connect.

  function topologySignature(patch) {
    if (!patch || typeof patch !== "object") return "";
    var parts = [];
    var nodes = Array.isArray(patch.nodes) ? patch.nodes : [];
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      if (n) parts.push("n:" + n.id + ":" + n.type);
    }
    var lists = [patch.connections, patch.modulations, patch.graphConnections];
    for (var l = 0; l < lists.length; l += 1) {
      var list = Array.isArray(lists[l]) ? lists[l] : [];
      for (var j = 0; j < list.length; j += 1) {
        var c = list[j] || {};
        parts.push(
          "c" + l + ":" + c.sourceNode + "." + (c.sourcePort || "") + ">" + c.destinationNode + "." + (c.destinationPort || c.destinationParam || c.destinationGraphInput || "")
        );
      }
    }
    parts.sort();
    return parts.join("|");
  }

  // Native param sync (same diff as perform-boot)

  var lastParams = new Map();
  var lastSentSignature = null;

  function patchNodes() {
    var nodes = global.nodeGraphMvp && global.nodeGraphMvp.patch && global.nodeGraphMvp.patch.nodes;
    return Array.isArray(nodes) ? nodes : [];
  }

  function copyParams(params) {
    var out = {};
    if (!params) return out;
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i += 1) {
      var v = params[keys[i]];
      if (typeof v === "number" && Number.isFinite(v)) out[keys[i]] = v;
    }
    return out;
  }

  function snapshotParams() {
    lastParams.clear();
    var nodes = patchNodes();
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i] && nodes[i].id) lastParams.set(String(nodes[i].id), copyParams(nodes[i].params));
    }
  }

  function emitDirtyParams() {
    var nodes = patchNodes();
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      if (!n || !n.id) continue;
      var id = String(n.id);
      var now = copyParams(n.params);
      var prev = lastParams.get(id);
      if (prev) {
        var keys = Object.keys(now);
        for (var k = 0; k < keys.length; k += 1) {
          if (prev[keys[k]] !== now[keys[k]]) {
            postToHost({ event: "param", nodeId: id, key: keys[k], value: now[keys[k]] });
          }
        }
      }
      lastParams.set(id, now);
    }
  }

  function serializedPatchJson(patch) {
    try {
      var payload = typeof global.serializeNodeGraphPatch === "function"
        ? global.serializeNodeGraphPatch(patch)
        : patch;
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    } catch (error) {
      console.warn("soemdspPluginHost: patch serialize failed", error);
      return "";
    }
  }

  function sendPatchToNative(patch) {
    var json = serializedPatchJson(patch);
    if (!json) return;
    var name = "";
    try {
      name = String((patch.info && patch.info.name) || global.nodeGraphMvp.currentSavedPatchFilename || "");
    } catch (_e) { /* unnamed */ }
    lastSentSignature = topologySignature(patch);
    postToHost({ event: "patch", json: json, name: name });
    snapshotParams();
  }

  function afterCommit() {
    var patch = global.nodeGraphMvp && global.nodeGraphMvp.patch;
    if (!patch) return;
    if (topologySignature(patch) !== lastSentSignature) {
      sendPatchToNative(patch);
    } else {
      emitDirtyParams();
    }
    try {
      syncDisplayWatch();
    } catch (error) {
      console.warn("soemdspPluginHost: display watch failed", error);
    }
  }

  // Native display feed (docs/FRAME_BATCH_FORMAT.md in soemdsp-sandbox).
  // The plugin's engine captures the same outputs the AudioWorklet would
  // (scopeCaptureNodeIds / scopeCaptureRates / visualSinks from the live
  // plan) and calls receiveFrameBatch() at display rate. The page's scope,
  // meter and paint gates expect a live worklet node; with no worklet in the
  // plugin, a host node stands in once the first batch arrives. Its port only
  // forwards scopeAck (flow control) to the plugin.

  var WATCH_POLL_MS = 750;
  var lastWatchJson = "";

  function nodeTypeMap() {
    var map = Object.create(null);
    var nodes = patchNodes();
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i] && nodes[i].id) map[String(nodes[i].id)] = String(nodes[i].type || "");
    }
    return map;
  }

  function buildDisplayWatch() {
    if (typeof global.nodeGraphBuildLivePlan !== "function") return null;
    var plan;
    try {
      plan = global.nodeGraphBuildLivePlan();
    } catch (_e) {
      return null;
    }
    if (!plan) return null;
    var types = nodeTypeMap();
    var rates = plan.scopeCaptureRates || {};
    var ids = Array.isArray(plan.scopeCaptureNodeIds) && plan.scopeCaptureNodeIds.length
      ? plan.scopeCaptureNodeIds
      : (plan.order || []);
    var nodes = [];
    for (var i = 0; i < ids.length; i += 1) {
      var id = String(ids[i]);
      nodes.push({ id: id, type: types[id] || "", writeHz: Number(rates[id]) || 0 });
    }
    var sinks = [];
    var rawSinks = Array.isArray(plan.visualSinks) ? plan.visualSinks : [];
    for (var s = 0; s < rawSinks.length; s += 1) {
      var sink = rawSinks[s];
      if (!sink || !sink.nodeId) continue;
      var sinkType = String(sink.type || types[sink.nodeId] || "");
      var inputs = [];
      var rawInputs = sink.inputs || [];
      for (var k = 0; k < rawInputs.length; k += 1) {
        var input = rawInputs[k];
        if (!input || !input.connected) continue;
        var conns = [];
        var rawConns = input.connections || [];
        for (var c = 0; c < rawConns.length; c += 1) {
          var src = String(rawConns[c].sourceNode || "");
          conns.push({ sourceNode: src, sourceType: types[src] || "", sourcePort: String(rawConns[c].sourcePort || "Out") });
        }
        inputs.push({ port: String(input.port || "").trim(), buffered: Boolean(input.buffered), connections: conns });
      }
      sinks.push({
        nodeId: String(sink.nodeId),
        type: sinkType,
        writeHz: Number(sink.visualWriteHz) || 0,
        skipAggregate: (sink.bufferedInputs || []).length > 1 || sinkType === "output",
        inputs: inputs,
      });
    }
    var fps = typeof global.nodeGraphSimulationDisplayFps === "function" ? Number(global.nodeGraphSimulationDisplayFps()) : 60;
    return {
      fingerprint: String(plan.patchFingerprint || ""),
      displayFps: fps > 0 ? fps : 60,
      nodes: nodes,
      sinks: sinks,
    };
  }

  function syncDisplayWatch() {
    var watch = buildDisplayWatch();
    if (!watch) return;
    var json = JSON.stringify(watch);
    if (json === lastWatchJson) return;
    lastWatchJson = json;
    postToHost({ event: "displayWatch", json: json });
  }

  function ensureHostLiveNode() {
    var live = global.nodeGraphMvp && global.nodeGraphMvp.live;
    if (!live) return false;
    if (live.node) return true;
    live.node = {
      soemdspPluginHostNode: true,
      // Nothing to upload: the engine already runs native code.
      nodeGraphSentNativeModules: { has: function () { return true; }, add: function () {}, delete: function () {}, size: 0 },
      port: {
        onmessage: null,
        start: function () {},
        close: function () {},
        postMessage: function (message) {
          if (message && message.type === "scopeAck") postToHost({ event: "frameAck" });
        },
      },
      parameters: new Map(),
      connect: function () {},
      disconnect: function () {},
    };
    return true;
  }

  function base64ToFloat32(text) {
    var bin = global.atob(String(text || ""));
    var n = bin.length >> 2;
    var bytes = new Uint8Array(n << 2);
    for (var i = 0; i < bytes.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer, 0, n);
  }

  function receiveFrameBatch(batch) {
    if (!batch || typeof batch !== "object" || typeof global.nodeGraphReceiveFrameBatch !== "function") {
      if (batch && batch.scope) postToHost({ event: "frameAck" });
      return false;
    }
    if (!ensureHostLiveNode()) {
      if (batch.scope) postToHost({ event: "frameAck" });
      return false;
    }
    batch.sessionId = global.nodeGraphMvp.live.sessionId;
    var values = batch.scope && Array.isArray(batch.scope.values) ? batch.scope.values : [];
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] && typeof values[i][1] === "string") values[i][1] = base64ToFloat32(values[i][1]);
    }
    var ok = false;
    try {
      ok = global.nodeGraphReceiveFrameBatch(batch);
    } catch (error) {
      console.warn("soemdspPluginHost: frame batch failed", error);
    }
    // The page only acks batches it ingests with a scope part; the plugin
    // re-arms after 250 ms if an ack never comes.
    return ok;
  }

  // Wrappers. Globals are wrapped as their scripts load (boot-loading
  // injects most of them after this file).

  function wrapOnce(name, makeWrapper) {
    var original = global[name];
    if (typeof original !== "function" || original._soemdspPluginWrapped) return;
    var wrapped = makeWrapper(original);
    wrapped._soemdspPluginWrapped = true;
    global[name] = wrapped;
  }

  // Wiring + delete stay locked. Adding (shop / context / placement / duplicate)
  // is allowed and reaches the native engine via the topology-change patch event.
  var BLOCKED = [
    "connectNodeGraphPorts",
    "connectNodeGraphModulation",
    "connectNodeGraphGraphInput",
    "disconnectNodeGraphConnection",
    "disconnectNodeGraphConnections",
    "deleteNodeGraphSelectionFromContext",
    "deleteNodeGraphModuleFromContext",
  ];

  function installWrappers() {
    wrapOnce("setNodeGraphLiveOutputEnabled", function (original) {
      return function (on) {
        if (on) return Promise.resolve();
        return original.apply(this, arguments);
      };
    });
    wrapOnce("commitNodeGraphPatch", function (original) {
      return function (patch, options) {
        var opts = options || {};
        // Wire edits stay locked. Topology edits (add module / duplicate) go through
        // so the native engine gets the updated patch (click on rebuild is OK for now).
        if (opts.wireEdit) {
          showLockHint();
          return undefined;
        }
        var result = original.apply(this, arguments);
        try {
          afterCommit();
        } catch (error) {
          console.warn("soemdspPluginHost: native sync failed", error);
        }
        return result;
      };
    });
    for (var i = 0; i < BLOCKED.length; i += 1) {
      wrapOnce(BLOCKED[i], function () {
        return function () {
          showLockHint();
          return null;
        };
      });
    }
  }

  installWrappers();
  document.addEventListener("load", function (event) {
    if (event.target && event.target.tagName === "SCRIPT") installWrappers();
  }, true);

  // Wire drags start on jacks; stop them before the editor sees the press.
  function blockJackPress(event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (!target.closest(".node-port")) return;
    event.stopPropagation();
    event.preventDefault();
    showLockHint();
  }
  document.addEventListener("pointerdown", blockJackPress, true);
  document.addEventListener("mousedown", blockJackPress, true);

  // Delete / Backspace on a selection removes modules or wires.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    var t = event.target;
    var tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || (t && t.isContentEditable)) return;
    event.stopPropagation();
    event.preventDefault();
    showLockHint();
  }, true);

  // Host commands (C++ evaluateJavascript)

  function loadPatch(patch) {
    if (typeof patch === "string") patch = JSON.parse(patch);
    if (!patch || typeof patch !== "object") return false;
    if (typeof global.loadNodeGraphPatchFromObject !== "function" || typeof global.commitNodeGraphPatch !== "function") {
      return false;
    }
    var loaded = global.loadNodeGraphPatchFromObject(patch);
    global.commitNodeGraphPatch(loaded, { status: "plugin loadPatch" });
    return true;
  }

  if (!global.soemdspPerform) {
    global.soemdspPerform = {
      loadPatch: loadPatch,
      setSlot: function () { return false; },
      isActive: function () { return true; },
    };
  }
  global.soemdspPluginHostApi = { loadPatch: loadPatch, receiveFrameBatch: receiveFrameBatch, resendPatch: function () { lastSentSignature = null; afterCommit(); } };

  function autoStartBoot() {
    if (document.body && document.body.dataset.nodeBootStarted === "1") return;
    if (typeof global.beginNodeBootLoadSequence === "function") {
      global.beginNodeBootLoadSequence();
      return;
    }
    var btn = document.getElementById("nodeBootStartButton");
    if (btn) btn.click();
  }

  function afterInterfaceReady() {
    installWrappers();
    document.body.classList.add(BODY_CLASS);
    afterCommit();
    global.setInterval(emitDirtyParams, PARAM_POLL_MS);
    // Face show/hide changes the watch list without a commit.
    global.setInterval(function () {
      try { syncDisplayWatch(); } catch (_e) { /* next poll */ }
    }, WATCH_POLL_MS);
    postToHost({ event: "ready" });
  }

  if (document.documentElement.dataset.nodeSandboxInterfaceReady === "true" || global.nodeSandboxInterfaceReady === true) {
    afterInterfaceReady();
  } else {
    global.addEventListener("nodeSandboxInterfaceReady", afterInterfaceReady, { once: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoStartBoot, { once: true });
  } else {
    autoStartBoot();
  }
})(window);
