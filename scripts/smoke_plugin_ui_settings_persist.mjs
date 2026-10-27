// Plugin WebView UIDEV persistence: juce.backend is not localhost, so the
// designer-in-plugin host must still be allowed to keep localStorage, and
// autosave/reset must POST /api/presets/useruisettings (Documents/Sandbox).
import fs from "node:fs";
import vm from "node:vm";

const fail = (m) => {
  console.error("FAIL", m);
  process.exit(1);
};

const defaultPreset = fs.readFileSync("public/node-graph-default-preset.js", "utf8");
const persist = fs.readFileSync("public/node-graph-ui-settings-persistence.js", "utf8");
const bindings = fs.readFileSync("public/node-graph-uidev-event-bindings.js", "utf8");
const indexHtml = fs.readFileSync("public/index.html", "utf8");
const performHtml = fs.readFileSync("public/perform.html", "utf8");

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) fail(`${name} missing`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  fail(`${name} unclosed`);
}

const allowedSrc = [
  extractFn(defaultPreset, "nodeGraphPluginHostPersistentUiSettings"),
  extractFn(defaultPreset, "nodeGraphLocalDefaultPresetAllowed"),
].join("\n");

function allowed(hostname, hostFlag) {
  const window = {
    soemdspPluginHost: hostFlag || false,
    location: { hostname },
  };
  const document = {
    documentElement: {
      classList: {
        contains: (name) => hostFlag && name === "soemdsp-plugin-host",
      },
    },
  };
  const ctx = { window, document };
  vm.createContext(ctx);
  vm.runInContext(
    `${allowedSrc}\nthis.ok = nodeGraphLocalDefaultPresetAllowed();`,
    ctx,
  );
  return ctx.ok;
}

if (!allowed("localhost", false)) fail("localhost should persist");
if (!allowed("127.0.0.1", false)) fail("127.0.0.1 should persist");
if (!allowed("", false)) fail("empty hostname should persist");
if (allowed("juce.backend", false)) fail("juce.backend without plugin host must not persist");
if (allowed("soundemote.io", false)) fail("public site must not persist local defaults");
if (!allowed("juce.backend", true)) fail("plugin host on juce.backend must persist");
if (!allowed("soundemote.io", true)) fail("plugin host flag must persist on any hostname");

if (!persist.includes("function flushNodeUiDevSettingsAutosave()")) {
  fail("flushNodeUiDevSettingsAutosave missing");
}
if (!persist.includes("function persistNodeUiDevSettingsToPluginHost(text)")) {
  fail("persistNodeUiDevSettingsToPluginHost missing");
}
if (!persist.includes("nodeGraphUiSettingsPersistToPluginHost()")) {
  fail("plugin-host gate missing from persist helper");
}
if (!persist.includes('window.addEventListener("pagehide", flushNodeUiDevSettingsAutosave)')) {
  fail("pagehide flush missing");
}
if (!persist.includes("flushNodeUiDevSettingsAutosave();")) {
  fail("schedule must flush");
}

const flushFn = extractFn(persist, "flushNodeUiDevSettingsAutosave");
if (!flushFn.includes("saveNodeUiDevLocalDefaultSettings(text)")) {
  fail("flush must write localStorage");
}
if (!flushFn.includes("persistNodeUiDevSettingsToPluginHost(text)")) {
  fail("flush must POST in plugin");
}

const persistFn = extractFn(persist, "persistNodeUiDevSettingsToPluginHost");
if (!persistFn.includes("postNodeUiDevSettingsPreset(text)")) {
  fail("plugin persist must POST useruisettings");
}
if (!persistFn.includes("nodeGraphUiSettingsPersistToPluginHost()")) {
  fail("plugin persist must no-op off plugin host");
}

const scheduleFn = extractFn(persist, "scheduleNodeUiDevSettingsAutosave");
if (scheduleFn.includes("postNodeUiDevSettingsPreset")) {
  fail("schedule itself must not POST (localhost slider spam)");
}

if (!bindings.includes("flushNodeUiDevSettingsAutosave()")) {
  fail("Reset Settings must flush immediately");
}

for (const [label, html] of [
  ["index.html", indexHtml],
  ["perform.html", performHtml],
]) {
  if (!html.includes("node-graph-default-preset.js?v=plugin-ui-persist-1")) {
    fail(`${label} missing default-preset cache tag`);
  }
  if (!html.includes("node-graph-ui-settings-persistence.js?v=plugin-ui-persist-1")) {
    fail(`${label} missing persistence cache tag`);
  }
  if (!html.includes("node-graph-uidev-event-bindings.js?v=plugin-ui-persist-1")) {
    fail(`${label} missing uidev-event-bindings cache tag`);
  }
}

console.log("smoke_plugin_ui_settings_persist ok");
