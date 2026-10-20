// Module rails smoke (docs/MODULE_RAILS_PLAN.md): Layout 1 "spawn" param band
// [mod rail | params | thru rail] and Layout 3 "railsOnly" (Comparator).
//   - Thru rail always shows; mod rail opens on the first param cable, closes
//     on the last; "Mod rail" always-on keeps it; module width never changes.
//   - A cable dropped on a param control lands on that param's mod inlet.
//   - Comparator: title bar + input rail | output rail, short labels, no face.
//   - No title (hover text) on modules, rails or ports.
// Usage: node scripts/smoke_module_rails.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE (playwright-core path), SHOT_DIR optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const RAIL = 40;

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(label);
};

function patchJson() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 40, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  d.nodes.push({ gx: 1, gy: 1, id: "sw-1", type: "sineWavetable", params: { freq: 1, mode: 0, amp: 0.5 } });
  d.nodes.push({ gx: 12, gy: 1, id: "pp-1", type: "pingPongDelay", params: {} });
  d.nodes.push({ gx: 1, gy: 16, id: "cmp-1", type: "comparator", params: {} });
  return JSON.stringify(d);
}

const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/rails-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=rails-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pp-1"]')
  && document.querySelector('article[data-node="cmp-1"]'), null, { timeout: 120000 });
await page.waitForTimeout(2500);

const snap = () => page.evaluate(() => {
  const pp = document.querySelector('article[data-node="pp-1"]');
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const row = pp.querySelector('.node-parameter-row[data-param="feedback"]');
  // Ping Pong has a hand-written face (PP-5): the face is the param area.
  const ctl = pp.querySelector(".node-face") || row?.querySelector(".node-parameter-control");
  const mod = row?.querySelector(".node-param-port.modulation-input");
  const thru = row?.querySelector(".node-param-port.parameter-output");
  const display = pp.querySelector("canvas");
  const io = pp.querySelector(".dsp-node-io-section");
  const z = typeof nodeGraphMvp === "object" ? (nodeGraphMvp.zoom || nodeGraphMvp.viewport?.zoom || 1) : 1;
  return {
    zoom: z,
    layout: pp.dataset.faceLayout,
    open: pp.classList.contains("mod-rail-open"),
    width: r(pp).width,
    displayW: r(display)?.width ?? null,
    displayBottom: r(display)?.bottom ?? null,
    ioRect: io ? [r(io).left - r(pp).left, r(io).top - r(pp).top, r(io).width, r(io).height].map((v) => Math.round(v * 10) / 10) : null,
    ctlW: r(ctl).width,
    modW: r(mod).width,
    thruW: r(thru).width,
    rowTop: r(ctl).top,
    modPatched: mod.classList.contains("rail-patched"),
    thruLabel: thru.dataset.railLabel,
    thruTags: [...pp.querySelectorAll(".node-param-port.parameter-output")]
      .filter((el) => !el.closest(".node-parameter-row")?.hidden).every((el) => el.getBoundingClientRect().width > 0),
    // Params with a drawn tag, per rail (tag = ::after with the short label).
    tagged: ["modulation-input", "parameter-output"].map((cls) => [...pp.querySelectorAll(`.node-param-port.${cls}`)]
      .filter((el) => { const c = getComputedStyle(el, "::after").content; return c && c !== "none" && c !== "normal"; })
      .map((el) => el.dataset.param).sort().join(",")),
    inletCount: pp.querySelectorAll('.node-param-port.modulation-input[data-param="feedback"]').length,
  };
});
const commit = (mods) => page.evaluate((list) => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  patch.modulations = list.map((m) => ({ ...m, tracePoints: [] }));
  commitNodeGraphPatch(patch, { wireEdit: true });
  drawNodeGraphWires();
}, mods);
const shot = async (name, selector) => {
  if (!SHOT) return;
  const el = page.locator(selector);
  await el.screenshot({ path: path.join(SHOT, `rails-${name}.png`) });
};

// Layout 1 at rest.
const rest = await snap();
const z = rest.zoom;
check("pingPong resolves to spawn", rest.layout === "spawn", rest.layout);
check("rest: mod rail closed", !rest.open && rest.modW < 1, JSON.stringify(rest));
check("rest: thru rail hidden (no width)", rest.thruW < 1, rest.thruW);
check("rest: no param tags when nothing is patched", rest.tagged.join("|") === "|", JSON.stringify(rest.tagged));
check("thru tag short label", rest.thruLabel && rest.thruLabel.length <= 6, rest.thruLabel);
await shot("pingpong-rest", 'article[data-node="pp-1"]');
if (SHOT) await page.locator('article[data-node="pp-1"]').screenshot({ path: path.join(SHOT, "rails3-empty.png") });

// First cable opens the mod rail; the params shrink, nothing else moves.
const A = { sourceNode: "sw-1", sourcePort: "A", destinationNode: "pp-1", destinationParam: "feedback" };
await commit([A]);
await page.waitForTimeout(300);
const one = await snap();
check("first cable: mod rail open", one.open && Math.abs(one.modW - RAIL * z) < 1.5, JSON.stringify(one));
check("first cable: inlet tag on the patched param", one.modPatched);
check("first cable: thru rail appears with the mod rail", Math.abs(one.thruW - RAIL * z) < 1.5, one.thruW);
check("first cable: exactly one tag pair (inlet + thru) for the used param", one.tagged.join("|") === "feedback|feedback", JSON.stringify(one.tagged));
check("module width unchanged", Math.abs(one.width - rest.width) < 0.5, `${rest.width} -> ${one.width}`);
check("display width unchanged", rest.displayW === null || Math.abs(one.displayW - rest.displayW) < 0.5, `${rest.displayW} -> ${one.displayW}`);
check("IO band unchanged", JSON.stringify(one.ioRect) === JSON.stringify(rest.ioRect), `${rest.ioRect} -> ${one.ioRect}`);
check("params shrink by both rails", Math.abs((rest.ctlW - one.ctlW) - 2 * RAIL * z) < 1.5, `${rest.ctlW} -> ${one.ctlW}`);
check("rails sit under the display", rest.displayBottom === null || one.rowTop >= rest.displayBottom - 0.5, `${one.rowTop} vs ${rest.displayBottom}`);
await shot("pingpong-patched", 'article[data-node="pp-1"]');
if (SHOT) await page.locator('article[data-node="pp-1"]').screenshot({ path: path.join(SHOT, "rails3-used-only.png") });
if (SHOT) await page.locator('article[data-node="pp-1"]').screenshot({ path: path.join(SHOT, "rails3-one-patched.png") });
if (SHOT) await page.screenshot({ path: path.join(SHOT, "rails-workspace-patched.png") });

// Second cable to the same param shares the one inlet.
await commit([A, { ...A, sourcePort: "B" }]);
const two = await snap();
check("second cable shares the inlet", two.inletCount === 1 && two.open);

// Last unplug closes the mod rail; thru stays.
await commit([]);
await page.waitForTimeout(300);
const gone = await snap();
check("last unplug: mod rail closed", !gone.open && gone.modW < 1);
check("last unplug: thru rail hides too", gone.thruW < 1, gone.thruW);
check("last unplug: no param tags", gone.tagged.join("|") === "|", JSON.stringify(gone.tagged));

// "Mod rail" always on: open with no cables, saved with the patch.
await page.evaluate(() => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const node = patch.nodes.find((n) => n.id === "pp-1");
  node.ui = { ...(node.ui || {}), modRailAlwaysOn: true };
  commitNodeGraphPatch(patch, {});
  drawNodeGraphWires();
});
await page.waitForTimeout(300);
const always = await snap();
check("mod rail always on: open with no cables", always.open);
const saved = await page.evaluate(() => {
  const node = cloneNodeGraphPatch(nodeGraphMvp.patch).nodes.find((n) => n.id === "pp-1");
  return Boolean(normalizeNodeGraphPatchNodeUi(node.ui, node.type).modRailAlwaysOn);
});
check("mod rail always on survives clone/normalize", saved);
const defaultOff = await page.evaluate(() => normalizeNodeGraphPatchNodeUi({}, "pingPongDelay").modRailAlwaysOn === false);
check("mod rail always on is off by default", defaultOff);
await page.evaluate(() => {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const node = patch.nodes.find((n) => n.id === "pp-1");
  node.ui = { ...(node.ui || {}), modRailAlwaysOn: false };
  commitNodeGraphPatch(patch, {});
  drawNodeGraphWires();
});

// Drop a real cable on the param control: it lands on the mod inlet.
const out = await page.evaluate(() => {
  const row = document.querySelector('article[data-node="sw-1"] .node-io-row.output');
  const jack = row.querySelector(".node-port") || row;
  const a = jack.getBoundingClientRect();
  const box = nodeGraphModuleFaceHitBoxes(document.querySelector('article[data-node="pp-1"]'))
    .find((b) => b.row.dataset.param === "feedback");
  return { port: row.dataset.port, ax: a.left + a.width / 2, ay: a.top + a.height / 2, bx: box.left + (box.right - box.left) * 0.75, by: (box.top + box.bottom) / 2 };
});
await page.mouse.move(out.ax, out.ay);
await page.mouse.down();
await page.mouse.move((out.ax + out.bx) / 2, (out.ay + out.by) / 2, { steps: 6 });
await page.mouse.move(out.bx, out.by, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(400);
if (process.env.DEBUG) console.log("drag", JSON.stringify(out), JSON.stringify(await page.evaluate(() => ({ mods: nodeGraphMvp.patch.modulations, conns: nodeGraphMvp.patch.connections, at: document.elementFromPoint(0, 0) && null }))));
const dropped = await page.evaluate(() => (nodeGraphMvp.patch.modulations || [])
  .filter((m) => m.destinationNode === "pp-1").map((m) => `${m.sourcePort}->${m.destinationParam}`));
check("drop on the Feedback face cell lands on the mod inlet", dropped.length === 1 && /->feedback$/.test(dropped[0]), JSON.stringify(dropped));
const afterDrop = await snap();
check("drop opens the mod rail", afterDrop.open);
await shot("pingpong-dropped", 'article[data-node="pp-1"]');

// Layout 3: Comparator.
const cmp = await page.evaluate(() => {
  const el = document.querySelector('article[data-node="cmp-1"]');
  const ins = [...el.querySelectorAll(".node-io-row.input")];
  const outs = [...el.querySelectorAll(".node-io-row.output")];
  const labels = [...el.querySelectorAll(".node-io-label")].map((l) => l.textContent);
  const maxLabelW = Math.max(...[...el.querySelectorAll(".node-io-label")].map((l) => l.scrollWidth));
  return {
    layout: el.dataset.faceLayout,
    inletOutlet: el.classList.contains("chrome-layout-inlet-outlet"),
    header: Boolean(el.querySelector(".dsp-node-header, .node-header-title-row")),
    params: el.querySelectorAll(".node-parameter-row:not([hidden])").length,
    canvases: el.querySelectorAll("canvas").length,
    inLeft: ins.length > 0 && outs.length > 0
      && Math.max(...ins.map((r) => r.getBoundingClientRect().left)) < Math.min(...outs.map((r) => r.getBoundingClientRect().left)),
    outOrder: outs.map((r) => r.dataset.port),
    labels,
    maxLabelW,
  };
});
check("comparator resolves to railsOnly", cmp.layout === "railsOnly", cmp.layout);
check("comparator: title bar + IO only", cmp.inletOutlet && cmp.header && cmp.params === 0 && cmp.canvases === 0, JSON.stringify(cmp));
check("comparator: inputs left, outputs right", cmp.inLeft);
check("comparator: short labels", cmp.labels.every((l) => l.length <= 6), cmp.labels.join(","));
check("comparator: labels fit the rail width", cmp.maxLabelW <= RAIL * z + 0.5, cmp.maxLabelW);
await shot("comparator", 'article[data-node="cmp-1"]');

// No hover text on modules, rails or ports.
const titles = await page.evaluate(() => [...document.querySelectorAll(
  ".dsp-node[data-node], .dsp-node .node-param-port, .dsp-node .node-io-row, .dsp-node .node-port",
)].filter((el) => el.hasAttribute("title")).map((el) => el.className).slice(0, 5));
check("no title attributes on modules / rails / ports", titles.length === 0, JSON.stringify(titles));

// Inventory contract: every definition resolves to spawn or railsOnly.
const inv = await page.evaluate(() => {
  const counts = {};
  for (const [type, def] of Object.entries(nodeGraphModuleDefinitions)) {
    counts[def.faceLayout] = (counts[def.faceLayout] || 0) + 1;
  }
  return counts;
});
check("every definition has spawn or railsOnly", Object.keys(inv).every((k) => k === "spawn" || k === "railsOnly"), JSON.stringify(inv));
console.log("face layouts:", JSON.stringify(inv));

await browser.close();
if (errors.length) console.log("page errors:", errors.slice(0, 5));
console.log(failures.length ? `${failures.length} failure(s)` : "all module rail checks passed");
process.exitCode = failures.length ? 1 : 0;
