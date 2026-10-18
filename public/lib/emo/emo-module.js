// Script module: compile emo script on the main thread and hand WASM to the worklet.
// A failed compile keeps the last good build. There is no JS evaluator.
(function initNodeGraphEmoModule(root) {
  const nodeGraphEmoDefaultSource = [
    "param float decay = 0.5;",
    "in float gate;",
    "out float y;",
    "float t;",
    "show float env;",
    "void process() {",
    "  t = gate > 0.5 ? 0.0 : t + dt;",
    "  y = exp(-t / decay);",
    "  env = y;",
    "}",
    "display {",
    "  vec3 old = texture(prev, uv).rgb * (0.82 + decay * 0.16);",
    "  vec4 live = rgbaLive > 0.5 ? texture(rgbaIn, uv) : vec4(0.0);",
    "  vec3 rgb = live.a > 0.001 ? live.rgb / live.a : vec3(0.0);",
    "  vec3 held = delayFrame(3.0).rgb;",
    "  float line = 1.0 - smoothstep(0.0, 0.02, abs(uv.y - env));",
    "  out_color = vec4(max(old, max(rgb, held * 0.35)) + vec3(line), 1.0);",
    "}",
  ].join("\n");

  const wasmById = new Map();

  function parameterDefinition(item) {
    if (item.kind === "choice" && Array.isArray(item.choiceNames) && item.choiceNames.length) {
      const names = item.choiceNames.slice();
      const named = String(item.defaultValue ?? "");
      const defIndex = names.includes(named) ? names.indexOf(named) : 0;
      return {
        key: item.key,
        label: item.label || item.key,
        choices: names,
        choiceKeys: names,
        defaultValue: String(defIndex),
        min: "0",
        max: String(Math.max(0, names.length - 1)),
        mid: "0",
        step: "1",
        displayChoices: true,
        divideChoicesVisibly: true,
        linearSmoothing: false,
        nonlinearSlider: false,
        tooltip: "Saved by name. Reordering the list does not change a patch.",
      };
    }
    const min = Number(item.min);
    const max = Number(item.max);
    const def = Number(item.defaultValue);
    return {
      key: item.key,
      label: item.label || item.key,
      kind: item.kind === "int" ? "integer" : "decimal",
      defaultValue: String(Number.isFinite(def) ? def : 0),
      min: String(Number.isFinite(min) ? min : 0),
      max: String(Number.isFinite(max) ? max : 1),
      mid: "0",
      step: item.kind === "int" ? "1" : "any",
      nonlinearSlider: false,
      tooltip: item.key,
    };
  }

  function compileSource(source) {
    if (typeof root.emoCompile !== "function") {
      return {
        ok: false,
        errors: [{ line: 1, col: 1, message: "emo compiler missing" }],
        wasm: null,
        inputs: [],
        outputs: [],
        params: [],
        shows: [],
        display: "",
      };
    }
    return root.emoCompile(String(source ?? ""));
  }

  function statusMessage(built) {
    if (built?.ok) return { ok: true, message: "code ok", built };
    const errors = built?.errors || [{ line: 1, col: 1, message: "compile failed" }];
    const message = errors.slice(0, 6).map((e) => `${e.line}:${e.col} ${e.message}`).join(" | ");
    return { ok: false, message, built };
  }

  function choiceName(names, raw, fallbackIndex) {
    if (typeof raw === "string" && names.includes(raw)) return raw;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const idx = Math.max(0, Math.min(names.length - 1, Math.round(n)));
      return names[idx] || names[0];
    }
    return names[Math.max(0, Math.min(names.length - 1, fallbackIndex || 0))] || names[0];
  }

  function install(node, built, keepParams) {
    node.emoCompileErrors = [];
    node.emoInputs = built.inputs.slice();
    node.emoOutputs = built.outputs.slice();
    node.emoParamOrder = built.params.map((item) => item.key);
    node.emoParamDefs = built.params.map(parameterDefinition);
    node.emoChoices = {};
    for (const item of built.params) {
      if (item.choiceNames) node.emoChoices[item.key] = item.choiceNames.slice();
    }
    node.emoShows = Array.isArray(built.shows) ? built.shows : [];
    node.emoDisplay = String(built.display || "");
    const prev = node.params && typeof node.params === "object" ? node.params : {};
    const next = {};
    for (const def of node.emoParamDefs) {
      const names = node.emoChoices[def.key];
      if (names) {
        next[def.key] = choiceName(names, prev[def.key], Number(def.defaultValue) || 0);
      } else if (keepParams && Number.isFinite(Number(prev[def.key]))) {
        next[def.key] = Number(prev[def.key]);
      } else {
        next[def.key] = Number(def.defaultValue) || 0;
      }
    }
    node.params = next;
    if (!node.paramMeta || typeof node.paramMeta !== "object") node.paramMeta = {};
    if (built.wasm) wasmById.set(String(node.id), built.wasm);
  }

  function ensure(node) {
    if (!node || node.type !== "script") return node;
    if (typeof node.scriptSource !== "string" || !node.scriptSource.trim()) {
      node.scriptSource = nodeGraphEmoDefaultSource;
    }
    if (!Array.isArray(node.emoInputs)) {
      const built = compileSource(node.scriptSource);
      node.emoCompileErrors = built.errors || [];
      if (built.ok) install(node, built, true);
    }
    return node;
  }

  function write(node, code, patch) {
    const source = String(code ?? "");
    node.scriptSource = source;
    const built = compileSource(source);
    const status = statusMessage(built);
    node.emoCompileErrors = built.errors || [];
    if (!built.ok) return status;
    const prevIn = (node.emoInputs || []).join("\0");
    const prevOut = (node.emoOutputs || []).join("\0");
    const prevParams = (node.emoParamOrder || []).join("\0");
    install(node, built, true);
    if (patch && typeof root.nodeGraphPruneConnectionsForPortChange === "function") {
      if (prevIn !== node.emoInputs.join("\0") || prevOut !== node.emoOutputs.join("\0")) {
        const keepIn = node.emoInputs.concat(node.emoInputs.includes("rgba") ? [] : ["rgba"]);
        const keepOut = node.emoOutputs.concat(node.emoOutputs.includes("rgba") ? [] : ["rgba"]);
        root.nodeGraphPruneConnectionsForPortChange(patch, node.id, keepIn, keepOut);
      }
    }
    if (patch && prevParams !== (node.emoParamOrder || []).join("\0") && Array.isArray(patch.modulations)) {
      const keep = new Set(node.emoParamOrder || []);
      patch.modulations = patch.modulations.filter((mod) => (
        mod.destinationNode !== node.id || keep.has(mod.destinationParam)
      ));
    }
    return status;
  }

  function copyRuntime(node, runtimeNode) {
    ensure(node);
    runtimeNode.params = { ...(node.params || {}) };
    runtimeNode.emoInputs = (node.emoInputs || []).slice();
    runtimeNode.emoOutputs = (node.emoOutputs || []).slice();
    runtimeNode.emoParamOrder = (node.emoParamOrder || []).slice();
    runtimeNode.emoChoices = node.emoChoices || {};
    runtimeNode.emoShows = node.emoShows || [];
    runtimeNode.scriptWasm = wasmById.get(String(node.id)) || null;
  }

  function defineModule() {
    const built = compileSource(nodeGraphEmoDefaultSource);
    const defs = typeof root.nodeGraphModuleDefinitions === "object" ? root.nodeGraphModuleDefinitions : null;
    if (!defs) return;
    defs.script = {
      planRole: "processor",
      displayType: "emoScript",
      displayHeightGu: 8,
      spectrumCompanion: false,
      inputLabels: { rgba: "📺" },
      outputLabels: { rgba: "📺" },
      inputs: built.ok ? built.inputs.slice() : ["gate"],
      outputs: built.ok ? built.outputs.slice() : ["y"],
      parameters: built.ok ? built.params.map(parameterDefinition) : [],
    };
  }

  root.nodeGraphEmoDefaultSource = nodeGraphEmoDefaultSource;
  root.nodeGraphEmoEnsure = ensure;
  root.nodeGraphEmoWrite = write;
  root.nodeGraphEmoStatus = (source) => statusMessage(compileSource(source));
  root.nodeGraphEmoCopyRuntime = copyRuntime;
  root.nodeGraphEmoStampNewNode = function nodeGraphEmoStampNewNode(node) {
    if (!node || node.type !== "script") return node;
    if (typeof node.scriptSource !== "string" || !node.scriptSource.trim()) {
      node.scriptSource = nodeGraphEmoDefaultSource;
    }
    const built = compileSource(node.scriptSource);
    node.emoCompileErrors = built.errors || [];
    if (built.ok) install(node, built, true);
    return node;
  };
  root.nodeGraphEmoChoiceIndex = function nodeGraphEmoChoiceIndex(node, key, raw) {
    const names = node?.emoChoices?.[key];
    if (!Array.isArray(names) || !names.length) return null;
    if (typeof raw === "string" && names.includes(raw)) return names.indexOf(raw);
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(names.length - 1, Math.round(n)));
    return 0;
  };
  root.nodeGraphEmoChoiceNameForValue = function nodeGraphEmoChoiceNameForValue(node, key, raw) {
    const names = node?.emoChoices?.[key];
    if (!Array.isArray(names) || !names.length) return null;
    return choiceName(names, raw, 0);
  };
  defineModule();
})(typeof globalThis !== "undefined" ? globalThis : this);
