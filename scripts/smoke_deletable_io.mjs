// Deletable Output and Input (docs/DELETABLE_OUTPUT_PLAN.md section 5, DO-8).
// Usage: node scripts/smoke_deletable_io.mjs  (server on :8090 or SANDBOX_URL).
// Optional: SHOTS=dir writes screenshots there.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const SHOTS = process.env.SHOTS || "";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const b = await chromium.launch({
  headless: true,
  args: ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.grantPermissions(["microphone"]);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};
const boot = async () => {
  await page.goto(`${BASE}?pagePatch=input-gain-output`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof deleteSelectedNodeGraphItem === "function"
    && nodeGraphMvp?.patch?.nodes?.some((n) => n.type === "output")
    && document.querySelector('article[data-node="output"]'), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    globalThis.__w = (ms = 450) => new Promise((r) => setTimeout(r, ms));
    globalThis.__io = (type) => nodeGraphMvp.patch.nodes.filter((n) => n.type === type);
    globalThis.__wires = (id) => [...nodeGraphMvp.patch.connections, ...nodeGraphMvp.patch.modulations]
      .filter((c) => c.sourceNode === id || c.destinationNode === id).length;
    globalThis.__snap = (id) => { const n = nodeGraphPatchNode(id); return n ? JSON.stringify({ gx: n.gx, gy: n.gy, params: n.params, wires: __wires(id) }) : null; };
  });
};
await boot();
await shot("01-before");

// 1 + 2: each delete path, then Undo / Redo.
const viaContext = async (id) => {
  const r = await page.evaluate((id) => { const b = document.querySelector(`article[data-node="${id}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 8 }; }, id);
  await page.mouse.click(r.x, r.y, { button: "right" });
  await page.waitForTimeout(300);
  await page.click("#nodeSceneDeleteModule");
};
const viaKey = async (id) => {
  await page.evaluate((id) => { setNodeGraphSelection({ type: "node", id }); document.activeElement?.blur?.(); }, id);
  await page.keyboard.press("Delete");
};
const viaToolbar = async (id) => {
  // Debug-only toolbar button (hidden in the normal chrome): same handler.
  const enabled = await page.evaluate((id) => {
    setNodeGraphSelection({ type: "node", id });
    const button = document.getElementById("nodeDeleteButton");
    if (typeof syncNodeGraphActionButtons === "function") syncNodeGraphActionButtons();
    const ok = !button.disabled;
    button.click();
    return ok;
  }, id);
  gate(enabled, `toolbar Delete enabled for ${id}`);
};
for (const [label, fn] of [["context menu", viaContext], ["Delete key", viaKey], ["toolbar Delete", viaToolbar]]) {
  for (const id of ["output", "audioInput"]) {
    const before = await page.evaluate((id) => __snap(id), id);
    await fn(id);
    await page.waitForTimeout(500);
    const after = await page.evaluate((id) => ({ has: !!nodeGraphPatchNode(id), wires: __wires(id) }), id);
    gate(!after.has && after.wires === 0, `${label}: ${id} and its cables deleted`);
    await page.evaluate(() => { undoNodeGraphPatch(); return __w(); });
    const undone = await page.evaluate((id) => __snap(id), id);
    gate(undone === before, `${label}: Undo restores ${id} (id, position, settings, cables)`);
    await page.evaluate(() => { redoNodeGraphPatch(); return __w(); });
    gate(await page.evaluate((id) => !nodeGraphPatchNode(id), id), `${label}: Redo removes ${id} again`);
    await page.evaluate(() => { undoNodeGraphPatch(); return __w(); });
  }
}
// Marquee: drag a selection box over the whole graph, then Delete.
{
  const box = await page.evaluate(() => {
    const rs = ["output", "audioInput", "gain-1"].map((id) => document.querySelector(`article[data-node="${id}"]`).getBoundingClientRect());
    return { x0: Math.min(...rs.map((r) => r.left)) - 30, y0: Math.min(...rs.map((r) => r.top)) - 30,
      x1: Math.max(...rs.map((r) => r.right)) + 30, y1: Math.max(...rs.map((r) => r.bottom)) + 30 };
  });
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 5 });
  await page.mouse.move(box.x1, box.y1, { steps: 5 });
  await page.mouse.up();
  const sel = await page.evaluate(() => [...nodeGraphSelectedNodeIds()].sort());
  gate(sel.includes("output") && sel.includes("audioInput"), `marquee selects Output and Input (${sel.join(",")})`);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ out: __io("output").length, inp: __io("audioInput").length }));
  gate(r.out === 0 && r.inp === 0, "marquee delete removes Output and Input");
  await page.evaluate(() => { undoNodeGraphPatch(); return __w(); });
  gate(await page.evaluate(() => __io("output").length === 1 && __io("audioInput").length === 1), "marquee: Undo restores both");
}

// 4 + 3: -12 dB, delete, reload, Output button: saved volume and position.
const orig = await page.evaluate(async () => {
  const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
  p.nodes.find((n) => n.id === "output").params.volume = -12;
  commitNodeGraphPatch(p, { status: "smoke volume" });
  await __w();
  const o = nodeGraphPatchNode("output");
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem();
  await __w();
  return { gx: o.gx, gy: o.gy };
});
await shot("02-output-deleted");
const saved = await page.evaluate(() => serializeNodeGraphPatch(nodeGraphMvp.patch));
gate(JSON.parse(saved).ioModuleSettings?.output?.params?.volume === -12, "deleted Output's settings are saved in the patch (ioModuleSettings.output)");
await page.evaluate((text) => { localStorage.setItem("__smokeDeletableIo", text); }, saved);
await boot();
await page.evaluate(async () => {
  commitNodeGraphPatch(loadNodeGraphPatchFromScript(localStorage.getItem("__smokeDeletableIo")), { status: "smoke reload", record: false });
  localStorage.removeItem("__smokeDeletableIo");
  await __w(1000);
});
const reloaded = await page.evaluate(() => ({ out: __io("output").length, inp: __io("audioInput").length, saved: nodeGraphMvp.patch.ioModuleSettings?.output?.params?.volume }));
gate(reloaded.out === 0 && reloaded.inp === 1 && reloaded.saved === -12, "patch without Output reloads as-is (no spawn, settings kept)");
// 5: toolbar volume with no Output.
const slider = await page.evaluate(async () => {
  const s = document.getElementById("nodeLiveOutputVolume");
  let threw = null;
  try { setNodeGraphLiveOutputVolume(0.5); } catch (e) { threw = String(e); }
  const vol = nodeGraphMvp.patch.ioModuleSettings?.output?.params?.volume;
  setNodeGraphOutputModuleVolumeDb(-12);
  return { threw, vol, hasSlider: !!s };
});
gate(!slider.threw && Math.abs(slider.vol - -6.0206) < 0.01, `toolbar volume with no Output writes the saved value (${slider.vol?.toFixed?.(2)} dB)`);
await page.click("#nodeLiveOutputButton");
await page.waitForTimeout(3000);
const spawned = await page.evaluate(() => ({
  outs: __io("output").map((n) => ({ id: n.id, gx: n.gx, gy: n.gy, vol: n.params.volume })),
  enabled: nodeGraphMvp.live.outputEnabled, engine: !!nodeGraphMvp.live.node,
  pressed: document.getElementById("nodeLiveOutputButton").getAttribute("aria-pressed"),
}));
await shot("03-output-respawned");
gate(spawned.outs.length === 1 && spawned.outs[0].id === "output", "Output button spawns one Output");
gate(spawned.outs[0]?.gx === orig.gx && spawned.outs[0]?.gy === orig.gy, `respawned at its saved position (${orig.gx},${orig.gy})`);
gate(spawned.outs[0]?.vol === -12, "respawned Output has the saved -12 dB");
gate(spawned.enabled && spawned.engine, `audio started (aria-pressed ${spawned.pressed})`);
// 7: off/on with Output present: no second Output.
await page.click("#nodeLiveOutputButton"); await page.waitForTimeout(800);
await page.click("#nodeLiveOutputButton"); await page.waitForTimeout(2000);
gate(await page.evaluate(() => __io("output").length === 1), "Output button off/on with Output present: still one Output");
// 6: audio on, delete Output.
const onDelete = await page.evaluate(async () => {
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem();
  await __w(1500);
  return { outs: __io("output").length, enabled: nodeGraphMvp.live.outputEnabled, engine: !!nodeGraphMvp.live.node,
    speaker: compileNodeGraphExecutionPlan(nodeGraphMvp.patch).speakerOutputActive };
});
gate(onDelete.outs === 0 && onDelete.enabled && onDelete.engine, "audio on, delete Output: audio stays on, no throw");
gate(onDelete.speaker !== true, `speaker silent (speakerOutputActive ${onDelete.speaker})`);
// 8: Undo right after a spawn removes it; audio unchanged.
await page.click("#nodeLiveOutputButton"); await page.waitForTimeout(800); // off
await page.click("#nodeLiveOutputButton"); await page.waitForTimeout(2500); // on: spawn
const undoSpawn = await page.evaluate(async () => {
  const had = __io("output").length;
  undoNodeGraphPatch();
  await __w(800);
  return { had, now: __io("output").length, enabled: nodeGraphMvp.live.outputEnabled, engine: !!nodeGraphMvp.live.node };
});
gate(undoSpawn.had === 1 && undoSpawn.now === 0 && undoSpawn.enabled && undoSpawn.engine, "Undo after spawn removes the spawned Output; audio stays on");
// Occupied saved spot: respawn at the nearest free spot.
const occupied = await page.evaluate(async () => {
  document.getElementById("nodeLiveOutputButton").click(); // off
  await __w(800);
  const s = nodeGraphMvp.patch.ioModuleSettings.output;
  const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
  p.nodes.find((n) => n.id === "gain-1").gx = s.gx;
  p.nodes.find((n) => n.id === "gain-1").gy = s.gy;
  commitNodeGraphPatch(p, { status: "smoke occupy" });
  await __w();
  document.getElementById("nodeLiveOutputButton").click(); // on
  await __w(2500);
  const o = nodeGraphPatchNode("output");
  const g = nodeGraphPatchNode("gain-1");
  const overlap = nodeGraphGridRectsOverlap(nodeGraphPatchNodeGridRect(o), nodeGraphPatchNodeGridRect(g));
  return { saved: [s.gx, s.gy], at: [o.gx, o.gy], overlap, outs: __io("output").length };
});
gate(occupied.outs === 1 && !occupied.overlap && (occupied.at[0] !== occupied.saved[0] || occupied.at[1] !== occupied.saved[1]),
  `saved spot occupied: respawn at nearest free spot (${occupied.saved} -> ${occupied.at})`);

// 10 + 9 + 11 + 14: Input.
const input = await page.evaluate(async () => {
  const out = {};
  const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
  p.nodes.find((n) => n.id === "audioInput").params.amplitude = 0.4;
  commitNodeGraphPatch(p, { status: "smoke amplitude" });
  await __w();
  document.getElementById("nodeLiveOutputButton").click(); // output off
  await __w(1500);
  await startNodeGraphMockInput({ frequency: 330 });
  await __w(1500);
  out.inputOn = nodeGraphMvp.live.inputActive && !!nodeGraphMvp.live.node;
  setNodeGraphSelection({ type: "node", id: "audioInput" });
  try { deleteSelectedNodeGraphItem(); } catch (e) { out.threw = String(e); }
  await __w(1500);
  out.afterDelete = { inputs: __io("audioInput").length, armed: nodeGraphMvp.live.inputActive, engine: !!nodeGraphMvp.live.node };
  out.savedAmp = nodeGraphMvp.patch.ioModuleSettings?.audioInput?.params?.amplitude;
  out.levelWhileGone = getNodeGraphAudioInputModuleLevel();
  // 11: mock harness spawns exactly one via the shared function.
  await startNodeGraphMockInput({ frequency: 330 });
  await __w(1500);
  out.mock = __io("audioInput").map((n) => ({ id: n.id, amp: n.params.amplitude }));
  // 9: Input button off -> delete -> on spawns one with saved settings.
  document.getElementById("nodeLiveInputButton").click(); // off
  await __w(1500);
  setNodeGraphSelection({ type: "node", id: "audioInput" });
  deleteSelectedNodeGraphItem();
  await __w();
  document.getElementById("nodeLiveInputButton").click(); // on: spawn
  await __w(2500);
  out.button = { inputs: __io("audioInput").map((n) => ({ id: n.id, amp: n.params.amplitude })), armed: nodeGraphMvp.live.inputActive, engine: !!nodeGraphMvp.live.node };
  // 14: Input-only engine, no Output: Output on spawns, then unmutes.
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem();
  await __w();
  const engineBefore = nodeGraphMvp.live.node;
  out.inputOnly = { engine: !!engineBefore, outputEnabled: nodeGraphMvp.live.outputEnabled };
  document.getElementById("nodeLiveOutputButton").click();
  await __w(2000);
  out.afterOutputOn = { outs: __io("output").length, enabled: nodeGraphMvp.live.outputEnabled, sameEngine: nodeGraphMvp.live.node === engineBefore };
  return out;
});
gate(input.inputOn, "mock Input running");
gate(!input.threw && input.afterDelete.inputs === 0 && input.afterDelete.armed && input.afterDelete.engine, "Input on, delete Input: no throw, button stays armed, engine up");
gate(input.savedAmp === 0.4 && Math.abs(input.levelWhileGone - 0.4) < 1e-6, "deleted Input's Amplitude saved and still the live input level");
gate(input.mock.length === 1 && input.mock[0].id === "audioInput" && input.mock[0].amp === 0.4, "startNodeGraphMockInput spawns exactly one Input with saved settings");
gate(input.button.inputs.length === 1 && input.button.inputs[0].amp === 0.4 && input.button.armed && input.button.engine, "Input button spawns one Input with saved Amplitude; engine running");
gate(input.inputOnly.engine && !input.inputOnly.outputEnabled, "Input-only engine running with no Output");
gate(input.afterOutputOn.outs === 1 && input.afterOutputOn.enabled && input.afterOutputOn.sameEngine, "Output on from Input-only: spawns Output, unmutes the same engine");

// 12: patches without Output / Input load unchanged; boot restore keeps one module.
const loads = await page.evaluate(async () => {
  const p = JSON.parse(serializeNodeGraphPatch(nodeGraphMvp.patch));
  p.nodes = p.nodes.filter((n) => n.type !== "output" && n.type !== "audioInput");
  p.connections = p.connections.filter((c) => !["output", "audioInput"].includes(c.sourceNode) && !["output", "audioInput"].includes(c.destinationNode));
  delete p.ioModuleSettings;
  const loaded = loadNodeGraphPatchFromObject(p);
  commitNodeGraphPatch(loaded, { status: "smoke no io" });
  await __w(1500);
  const one = { ...p, nodes: [p.nodes.find((n) => n.id === "gain-1")], connections: [], modulations: [] };
  return { out: __io("output").length, inp: __io("audioInput").length, nodes: nodeGraphMvp.patch.nodes.length,
    usable: nodeGraphDefaultPresetPatchIsUsable(loadNodeGraphPatchFromObject(one)),
    restore: nodeGraphWorkingPatchShouldRestore(loadNodeGraphPatchFromObject(one)) };
});
gate(loads.out === 0 && loads.inp === 0 && loads.nodes === 2, "patch without Output/Input loads unchanged (no spawn)");
gate(loads.usable && loads.restore, "one-module patch: usable preset and boot restore keeps it");
// Fallback spawn spot (nothing saved): right of the rightmost module, camera unchanged.
const fallback = await page.evaluate(async () => {
  const pan = { ...nodeGraphMvp.pan };
  const right = Math.max(...nodeGraphMvp.patch.nodes.map((n) => nodeGraphPatchNodeGridRect(n).right));
  document.getElementById("nodeLiveOutputButton").click();
  await __w(1500);
  if (!nodeGraphMvp.live.outputEnabled) { document.getElementById("nodeLiveOutputButton").click(); await __w(2000); }
  const o = nodeGraphPatchNode("output");
  return { right, gx: o?.gx, panSame: nodeGraphMvp.pan.x === pan.x && nodeGraphMvp.pan.y === pan.y };
});
gate(fallback.gx === fallback.right + 1 && fallback.panSame, `nothing saved: Output spawns right of the rightmost module (gx ${fallback.gx}), camera unchanged`);
await shot("04-fallback-spawn");

// 13: uniqueness rules unchanged.
const unique = await page.evaluate(() => {
  const base = JSON.parse(serializeNodeGraphPatch(nodeGraphMvp.patch));
  const rejects = (mut) => { const p = JSON.parse(JSON.stringify(base)); mut(p); try { validateNodeGraphPatch(p); return false; } catch { return true; } };
  const wrongOut = rejects((p) => { p.nodes.find((n) => n.type === "output").id = "output-2"; });
  const wrongIn = rejects((p) => { p.nodes.push({ ...createNodeGraphPatchNode("audioInput", { id: "audioInput-2", gx: 60, gy: 60 }) }); });
  const two = JSON.parse(JSON.stringify(base));
  two.nodes.push({ ...two.nodes.find((n) => n.type === "output"), id: "output", gx: 80 });
  let twoOutputs;
  try { twoOutputs = validateNodeGraphPatch(two).nodes.filter((n) => n.type === "output").length; } catch { twoOutputs = "rejected"; }
  const before = __io("output").length;
  showNodeGraphModule("output", null, { status: "smoke shop" });
  const shopPresent = __io("output").length;
  setNodeGraphSelection({ type: "node", id: "output" });
  const copied = copySelectedNodeGraphModule();
  return { wrongOut, wrongIn, twoOutputs, before, shopPresent, copied, outs: __io("output").length };
});
gate(unique.wrongOut && unique.wrongIn, "wrong Output id and wrong Input id are rejected");
gate(unique.twoOutputs === 1 || unique.twoOutputs === "rejected", `two Outputs not loaded as two (${unique.twoOutputs})`);
gate(unique.shopPresent === 1 && !unique.copied && unique.outs === 1, "shop with Output present adds none; copy of Output blocked");
const shopAbsent = await page.evaluate(async () => {
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem();
  await __w();
  const id = showNodeGraphModule("output", null, { status: "smoke shop" });
  await __w();
  return { id, outs: __io("output").map((n) => n.id) };
});
gate(shopAbsent.outs.length === 1 && shopAbsent.outs[0] === "output", `shop with no Output adds one with id output (${shopAbsent.id})`);

// 15: performance view tiles: none stale after delete; back on Undo / spawn.
const tiles = await page.evaluate(async () => {
  const out = {};
  const pinned = cloneNodeGraphPatch(nodeGraphMvp.patch);
  nodeGraphLayoutCanvasSetPinned("output", true, { patch: pinned, persist: false, refresh: false });
  commitNodeGraphPatch(pinned, { status: "smoke pin" });
  await __w();
  const ids = () => nodeGraphLayoutCanvasPinnedNodeIds();
  const mini = () => (typeof nodeGraphMiniPerformElements === "function" ? nodeGraphMiniPerformElements().map((e) => e.nodeId) : []);
  out.pinned = ids().includes("output") && mini().includes("output");
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem();
  await __w();
  out.afterDelete = { layout: ids().includes("output"), mini: mini().includes("output") };
  toggleNodeGraphPerformanceView(); await __w(1200);
  out.stageTiles = [...document.querySelectorAll("[data-node-id], [data-tile-node]")].filter((e) => e.closest(".node-layout-canvas-stage, #nodeLayoutCanvasStage")).map((e) => e.dataset.nodeId || e.dataset.tileNode);
  toggleNodeGraphPerformanceView(); await __w(800);
  undoNodeGraphPatch(); await __w(800);
  out.afterUndo = { layout: ids().includes("output"), mini: mini().includes("output") };
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem(); await __w();
  if (nodeGraphMvp.live.outputEnabled) { document.getElementById("nodeLiveOutputButton").click(); await __w(1200); }
  document.getElementById("nodeLiveOutputButton").click(); await __w(2000);
  out.afterSpawn = { layout: ids().includes("output"), mini: mini().includes("output") };
  // Save/reload with Output deleted keeps the pin for the respawn.
  setNodeGraphSelection({ type: "node", id: "output" });
  deleteSelectedNodeGraphItem(); await __w();
  const text = serializeNodeGraphPatch(nodeGraphMvp.patch);
  out.pinSaved = JSON.parse(text).view?.canvases?.root?.elements?.some((e) => e.nodeId === "output");
  return out;
});
gate(tiles.pinned, "Output pinned to the performance canvas");
gate(!tiles.afterDelete.layout && !tiles.afterDelete.mini, "no stale Output tile after delete (performance + mini perform)");
gate(!tiles.stageTiles.includes("output"), "performance view opens without an Output tile");
gate(tiles.afterUndo.layout && tiles.afterUndo.mini, "tile returns on Undo");
gate(tiles.afterSpawn.layout && tiles.afterSpawn.mini, "tile returns on respawn");
gate(tiles.pinSaved, "saved patch keeps the deleted Output's tile for its respawn");
await shot("05-end");

gate(errs.length === 0, `no page / console errors${errs.length ? `: ${errs.slice(0, 4).join(" | ")}` : ""}`);
await b.close();
console.log(failures ? `smoke_deletable_io: ${failures} FAILED` : "smoke_deletable_io ok");
process.exit(failures ? 1 : 0);
