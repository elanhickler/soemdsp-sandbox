function nodeSandboxInterfaceLayoutSignature() {
  const shell = document.querySelector(".shell");
  const workspace = document.getElementById("nodeGraphWorkspace");
  const nodes = document.getElementById("nodeGraphNodes");
  const shellRect = shell?.getBoundingClientRect();
  const workspaceRect = workspace?.getBoundingClientRect();
  return [
    document.documentElement.scrollWidth,
    document.documentElement.scrollHeight,
    Math.round(shellRect?.width || 0),
    Math.round(shellRect?.height || 0),
    Math.round(workspaceRect?.width || 0),
    Math.round(workspaceRect?.height || 0),
    nodes?.childElementCount || 0,
  ].join(":");
}

async function waitForNodeSandboxStableLayout(stableFrames = 4, maxFrames = 24) {
  let previous = "";
  let stable = 0;
  for (let frame = 0; frame < maxFrames && stable < stableFrames; frame += 1) {
    await Promise.race([
      new Promise((resolve) => window.requestAnimationFrame(resolve)),
      new Promise((resolve) => window.setTimeout(resolve, 100)),
    ]);
    const current = nodeSandboxInterfaceLayoutSignature();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
  }
}

async function waitForNodeSandboxFontsReady(timeoutMs = 1500) {
  if (!document.fonts?.ready) {
    return;
  }
  await Promise.race([
    document.fonts.ready,
    new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

function setNodeSandboxStartupProgress(progress, label) {
  window.dispatchEvent(new CustomEvent("nodeSandboxStartupProgress", {
    detail: {
      label,
      progress,
    },
  }));
}

async function markNodeSandboxInterfaceReady() {
  setNodeSandboxStartupProgress(88, "settling layout");
  await waitForNodeSandboxFontsReady();
  setNodeSandboxStartupProgress(94, "stabilizing");
  await waitForNodeSandboxStableLayout();
  if (typeof applyNodeGraphWorkspaceWindowStates === "function") {
    applyNodeGraphWorkspaceWindowStates();
  }
  setNodeSandboxStartupProgress(100, "ready");
  document.documentElement.dataset.nodeSandboxInterfaceReady = "true";
  globalThis.nodeSandboxInterfaceReady = true;
  window.dispatchEvent(new CustomEvent("nodeSandboxInterfaceReady", {
    detail: { reason: "stable-layout" },
  }));
}

async function nodeSandboxStartupTask(label, task, timeoutMs = 8000) {
  let settled = false;
  const timeout = new Promise((resolve) => {
    window.setTimeout(() => {
      if (!settled) {
        console.warn(`Startup step timed out: ${label}`);
        window.dispatchEvent(new CustomEvent("nodeSandboxStartupProgress", {
          detail: { label: `${label} is taking longer than expected…` },
        }));
      }
      resolve();
    }, timeoutMs);
  });
  await Promise.race([
    Promise.resolve()
      .then(task)
      .catch((error) => console.error(`Startup step failed: ${label}`, error))
      .finally(() => { settled = true; }),
    timeout,
  ]);
}

async function initSandboxApp() {
  setNodeSandboxStartupProgress(4, "starting up");
  await nodeSandboxStartupTask("node graph", initNodeGraphMvp);
  await markNodeSandboxInterfaceReady();
}

initSandboxApp().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Sandbox startup failed", error);
  document.documentElement.dataset.nodeSandboxInterfaceError = message;
  document.documentElement.dataset.nodeSandboxInterfaceReady = "error";
  globalThis.nodeSandboxInterfaceReady = true;
  window.dispatchEvent(new CustomEvent("nodeSandboxInterfaceReady", {
    detail: { error: message },
  }));
});
