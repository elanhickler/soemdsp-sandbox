// Init is patches/init.json on disk. The display name "Init" may be hardcoded
// in UI labels; the patch graph itself is never hardcoded as a peer source.
// presets/default.json is not Init.

const nodeGraphInitPatchUrls = Object.freeze([
  "./patches/init.json",
  "/soemdsp-sandbox/patches/init.json",
]);

// Legacy key — still cleared on Clear Startup; no longer read for boot.
const nodeGraphDefaultPresetStorageKey = "soemdsp-sandbox.defaultPatch.live.v6";

function nodeGraphOfflineInitFallbackPatch() {
  if (typeof nodeGraphDefaultPatch !== "undefined" && nodeGraphDefaultPatch) {
    return cloneNodeGraphPatch(nodeGraphDefaultPatch);
  }
  return {
    nodes: [],
    connections: [],
    format: { kind: "soemdsp-sandbox-node-patch", version: 2 },
  };
}

/**
 * Factory / no-working-patch boot: load patches/init.json.
 * Clear Startup uses nodeGraphBlankStartupPatch() (Output only), not this.
 * Never prefers presets/default.json or a localStorage "defaultPatch.live.*" blob.
 */
async function loadNodeGraphDefaultPresetPatch() {
  const urls = [...nodeGraphInitPatchUrls];
  try {
    const override = typeof nodeGraphResolveEmbedOverride === "function"
      ? await nodeGraphResolveEmbedOverride("defaultPresetUrl", "defaultPreset")
      : null;
    if (override && !urls.includes(override)) {
      urls.unshift(override);
    }
  } catch (_error) {
    // ignore override failure
  }
  for (const url of urls) {
    try {
      const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        continue;
      }
      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = null;
      }
      const raw = data?.kind === "sandbox_patch"
        ? (data.patch_data || data)
        : (data || null);
      const fetchedPatch = raw
        ? (typeof loadNodeGraphPatchFromObject === "function"
          ? loadNodeGraphPatchFromObject(raw)
          : (typeof loadNodeGraphPatchFromScript === "function"
            ? loadNodeGraphPatchFromScript(text)
            : raw))
        : (typeof loadNodeGraphPatchFromScript === "function"
          ? loadNodeGraphPatchFromScript(text)
          : null);
      if (nodeGraphDefaultPresetPatchIsUsable(fetchedPatch)) {
        return normalizeNodeGraphDefaultPresetScopeShaders(fetchedPatch);
      }
    } catch (_error) {
      // try next URL
    }
  }
  return normalizeNodeGraphDefaultPresetScopeShaders(nodeGraphOfflineInitFallbackPatch());
}

function normalizeNodeGraphDefaultPresetScopeShaders(patch) {
  const normalized = cloneNodeGraphPatch(patch);
  for (const node of normalized.nodes || []) {
    if (!node || !Object.hasOwn(node, "scopeShader")) {
      continue;
    }
    const defaultSource = typeof nodeGraphScopeShaderDefaultSourceForType === "function"
      ? nodeGraphScopeShaderDefaultSourceForType(node.type)
      : nodeGraphScopeShaderDefaultSource;
    node.scopeShader = normalizeNodeGraphScopeShader({
      enabled: true,
      language: "scope-js",
      source: defaultSource,
    });
  }
  return normalized;
}

function nodeGraphDefaultPresetPatchIsUsable(patch) {
  if (!patch || !Array.isArray(patch.nodes)) {
    return false;
  }
  // Output is deletable (APP_POLICY): a preset without it is still usable.
  const visibleNodeCount = patch.nodes.filter((node) => (
    typeof nodeGraphModuleShouldBeVisible === "function"
      ? nodeGraphModuleShouldBeVisible(node)
      : Boolean(node)
  )).length;
  if (visibleNodeCount < 1) {
    return false;
  }
  if (typeof nodeGraphEfficientProductEnabled === "function"
    && nodeGraphEfficientProductEnabled()
    && typeof nodeGraphEfficientProductForeignTypesFromNodes === "function") {
    const foreign = nodeGraphEfficientProductForeignTypesFromNodes(patch.nodes);
    if (foreign.length) {
      return false;
    }
  }
  return true;
}

/**
 * Working/autosave restores any non-empty graph, with or without Output / Input.
 * Not nodeGraphDefaultPresetPatchIsUsable: that rejects foreign efficient-product
 * types, and session restore must keep the user's graph.
 */
function nodeGraphWorkingPatchShouldRestore(patch) {
  return Boolean(patch && Array.isArray(patch.nodes) && patch.nodes.length > 0);
}

function nodeGraphPluginHostPersistentUiSettings() {
  try {
    if (window.soemdspPluginHost) {
      return true;
    }
  } catch (_error) {
    // window can be missing in odd embeddings
  }
  try {
    return document.documentElement.classList.contains("soemdsp-plugin-host");
  } catch (_error) {
    return false;
  }
}

function nodeGraphLocalDefaultPresetAllowed() {
  // Browser localhost keeps localStorage. The designer-in-plugin WebView is
  // https://juce.backend, so hostname is not local — still persist there:
  // UIDEV / session / catalog go to WebView localStorage, and plugin autosave
  // also POSTs useruisettings to Documents/Sandbox.
  if (nodeGraphPluginHostPersistentUiSettings()) {
    return true;
  }
  try {
    return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  } catch (_error) {
    return false;
  }
}

function loadNodeGraphLocalDefaultPresetPatch() {
  // Boot no longer reads this. Kept for Clear Startup key cleanup / legacy.
  if (!nodeGraphLocalDefaultPresetAllowed()) {
    return null;
  }
  try {
    const text = window.localStorage.getItem(nodeGraphDefaultPresetStorageKey);
    return text ? loadNodeGraphPatchFromScript(text) : null;
  } catch {
    return null;
  }
}

function saveNodeGraphLocalDefaultPreset(text) {
  if (!nodeGraphLocalDefaultPresetAllowed()) {
    return false;
  }
  try {
    window.localStorage.setItem(nodeGraphDefaultPresetStorageKey, text);
    return true;
  } catch {
    return false;
  }
}

function configureNodeGraphDefaultPresetButton() {
  const button = document.getElementById("updateDefaultPresetButton");
  if (!button || !nodeGraphLocalDefaultPresetAllowed()) {
    return;
  }
  button.hidden = false;
}
