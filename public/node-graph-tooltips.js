const nodeGraphTooltipSourceUrl = "./public/tooltips.json?v=wf-no-sync-1";
const sandboxNativeTitleStorageAttribute = "data-native-title-disabled";

function sandboxStoreAndRemoveNativeTitle(element) {
  if (!(element instanceof Element) || !element.hasAttribute("title")) {
    return;
  }
  const value = element.getAttribute("title") || "";
  if (value) {
    element.setAttribute(sandboxNativeTitleStorageAttribute, value);
  } else {
    element.removeAttribute(sandboxNativeTitleStorageAttribute);
  }
  element.removeAttribute("title");
}

function sandboxStripNativeTitleAttributes(root = document) {
  const scope = root instanceof Document || root instanceof DocumentFragment || root instanceof Element
    ? root
    : null;
  if (!scope) {
    return;
  }
  if (scope instanceof Element) {
    sandboxStoreAndRemoveNativeTitle(scope);
  }
  for (const element of scope.querySelectorAll?.("[title]") || []) {
    sandboxStoreAndRemoveNativeTitle(element);
  }
}

function sandboxInstallNativeTitlePropertyGuard(proto) {
  if (!proto || proto.__sandboxNativeTitleGuardInstalled) {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(proto, "title");
  Object.defineProperty(proto, "title", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get() {
      return this.getAttribute?.(sandboxNativeTitleStorageAttribute) || "";
    },
    set(value) {
      const text = String(value || "");
      if (text) {
        this.setAttribute?.(sandboxNativeTitleStorageAttribute, text);
      } else {
        this.removeAttribute?.(sandboxNativeTitleStorageAttribute);
      }
      this.removeAttribute?.("title");
    },
  });
  Object.defineProperty(proto, "__sandboxNativeTitleGuardInstalled", {
    configurable: true,
    value: true,
  });
}

function installSandboxNativeTooltipHooks() {
  if (window.__sandboxNativeTooltipHooksInstalled) {
    return;
  }
  window.__sandboxNativeTooltipHooksInstalled = true;
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function setAttributeWithoutNativeTitle(name, value) {
    if (String(name).toLowerCase() === "title") {
      const text = String(value || "");
      if (text) {
        nativeSetAttribute.call(this, sandboxNativeTitleStorageAttribute, text);
      } else {
        this.removeAttribute(sandboxNativeTitleStorageAttribute);
      }
      this.removeAttribute("title");
      return;
    }
    nativeSetAttribute.call(this, name, value);
  };
  sandboxInstallNativeTitlePropertyGuard(HTMLElement.prototype);
  sandboxInstallNativeTitlePropertyGuard(SVGElement.prototype);
}

// The subtree observer walks every node the patch build inserts. That walk
// ran while the loading bar still said "loading tooltips". Hooks cover titles
// set from script. The observer starts after the boot screen drops.
function installSandboxNativeTooltipObserver() {
  if (window.__sandboxNativeTooltipObserverInstalled) {
    return;
  }
  window.__sandboxNativeTooltipObserverInstalled = true;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.attributeName === "title") {
        sandboxStoreAndRemoveNativeTitle(mutation.target);
      }
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element || node instanceof DocumentFragment) {
          sandboxStripNativeTitleAttributes(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["title"],
    childList: true,
    subtree: true,
  });
}

function installSandboxNativeTooltipBan() {
  installSandboxNativeTooltipHooks();
  sandboxStripNativeTitleAttributes();
  if (document.documentElement.dataset.nodeSandboxInterfaceReady === "true") {
    installSandboxNativeTooltipObserver();
    return;
  }
  if (window.__sandboxNativeTooltipObserverArmed) {
    return;
  }
  window.__sandboxNativeTooltipObserverArmed = true;
  window.addEventListener("nodeSandboxInterfaceReady", () => {
    sandboxStripNativeTitleAttributes();
    installSandboxNativeTooltipObserver();
  }, { once: true });
}

function nodeGraphTooltipTemplate(key) {
  if (!key) {
    return "";
  }
  const parts = String(key).split(".");
  let value = nodeGraphMvp?.tooltips;
  for (const part of parts) {
    value = value?.[part];
  }
  return typeof value === "string" ? value : "";
}

function nodeGraphIsApplePlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function nodeGraphAltModifierLabel() {
  return nodeGraphIsApplePlatform() ? "Option" : "Alt";
}

function nodeGraphTooltipText(key, context = {}) {
  const template = nodeGraphTooltipTemplate(key);
  if (!template) {
    return "";
  }
  const values = {
    alt: nodeGraphAltModifierLabel(),
    ...context,
  };
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

function nodeGraphApplyTooltip(element, key, context = {}, options = {}) {
  if (!element || !key) {
    return "";
  }
  const text = nodeGraphTooltipText(key, context);
  if (!text) {
    return "";
  }
  if (options.interaction !== false) {
    element.dataset.interactionHelp = text;
  }
  element.dataset.tooltipKey = key;
  element.setAttribute(sandboxNativeTitleStorageAttribute, text);
  element.removeAttribute("title");
  return text;
}

function nodeGraphElementTooltipText(element) {
  if (!element) {
    return "";
  }
  const key = element.dataset.tooltipKey;
  return key ? nodeGraphTooltipText(key) : "";
}

function applyNodeGraphStaticTooltips(root = document) {
  for (const element of root.querySelectorAll("[data-tooltip-key]")) {
    const text = nodeGraphTooltipText(element.dataset.tooltipKey);
    if (!text) {
      continue;
    }
    if (element.dataset.tooltipInteraction !== "false") {
      element.dataset.interactionHelp = text;
    }
    element.setAttribute(sandboxNativeTitleStorageAttribute, text);
    element.removeAttribute("title");
  }
}

async function loadNodeGraphTooltips() {
  try {
    const response = await fetch(nodeGraphTooltipSourceUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`tooltip document HTTP ${response.status}`);
    }
    if (nodeGraphMvp) nodeGraphMvp.tooltips = await response.json();
  } catch (error) {
    console.warn("Unable to load tooltip document", error);
    if (nodeGraphMvp) nodeGraphMvp.tooltips = {};
  }
  applyNodeGraphStaticTooltips();
  installSandboxNativeTooltipBan();
}

installSandboxNativeTooltipBan();
