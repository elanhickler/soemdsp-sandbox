// Module rails smoke (docs/MODULE_RAILS_PLAN.md): Layout 1 "spawn" param band
// [mod rail | params | thru rail] and Layout 3 "railsOnly" (Comparator).
//   - Each rail opens only when needed: mod rail (left) on a cable into a
//     param, thru rail (right) on a cable out of a thru; "Mod rail" always-on
//     keeps the mod rail; module width never changes.
//   - A cable dropped on a param control lands on that param's mod inlet.
//   - Comparator: title bar + input rail | output rail, short labels, no face.
//   - No title (hover text) on modules, rails or ports.
//   - Chip pin: IO boxes have no outward stroke; the module border is cut
//     over each box and the box runs through it (pixel-sampled at 3 zooms); the wire ends on the
//     border's outer edge, centred on the box.
// Usage: node scripts/smoke_module_rails.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE (playwright-core path), SHOT_DIR optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const SHOT = process.env.SHOT_DIR || "";
const RAIL = 26;

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

const launch = { headless: true, channel: "chrome" }; // system Chrome: the bundled Chromium never boots the GL app here
if (process.env.CHROME_PATH) { delete launch.channel; launch.executablePath = process.env.CHROME_PATH; }
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.route("**/rails-smoke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchJson() }));
await page.goto(`${BASE}?pagePatch=rails-smoke`, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => document.querySelector('article[data-node="pp-1"]')
  && document.querySelector('article[data-node="cmp-1"]'), null, { timeout: 400000 });
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
    thruOpen: pp.classList.contains("thru-rail-open"),
    width: r(pp).width,
    displayW: r(display)?.width ?? null,
    displayBottom: r(display)?.bottom ?? null,
    ioRect: io ? [r(io).left - r(pp).left, r(io).top - r(pp).top, r(io).width, r(io).height].map((v) => Math.round(v * 10) / 10) : null,
    // Face modules inset the widgets of rows beside a rail (the face element keeps its width).
    ctlW: (() => {
      const face = pp.querySelector(".node-face");
      if (!face) return r(ctl).width;
      const spec = nodeGraphModuleFaceSpecForElement(pp);
      const ws = nodeGraphModuleFaceWidgets(spec, face.offsetWidth, pp).filter((w) => nodeGraphModuleFaceRowParams(w.row).includes("feedback"));
      return (Math.max(...ws.map((w) => w.x + w.w)) - Math.min(...ws.map((w) => w.x))) * z;
    })(),
    modW: r(mod).width,
    thruW: r(thru).width,
    rowTop: r(ctl).top,
    modPatched: mod.classList.contains("rail-patched"),
    thruLabel: thru.dataset.railLabel,
    thruTags: [...pp.querySelectorAll(".node-param-port.parameter-output")]
      .filter((el) => !el.closest(".node-parameter-row")?.hidden).every((el) => el.getBoundingClientRect().width > 0),
    // Params the GL rail painter tags, per rail (open rail + rail-patched jack).
    tagged: ["modulation-input", "parameter-output"].map((cls) => [...pp.querySelectorAll(`.node-param-port.${cls}`)]
      .filter((el) => pp.classList.contains(cls === "modulation-input" ? "mod-rail-open" : "thru-rail-open") && el.classList.contains("rail-patched"))
      .map((el) => el.dataset.param).sort().join(",")),
    // Rails are GPU-only: no CSS paint on rail jacks.
    railCss: [...pp.querySelectorAll(".node-param-port")].some((el) => {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, "::after").content;
      return (after && after !== "none" && after !== "normal") || cs.backgroundColor === "rgb(8, 10, 14)";
    }),
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
check("rails painted by GL only (no CSS tag/strip)", !one.railCss);
check("first cable: thru rail stays hidden (not needed)", !one.thruOpen && one.thruW < 1, one.thruW);
check("first cable: one inlet tag, no thru tag", one.tagged.join("|") === "feedback|", JSON.stringify(one.tagged));
check("module width unchanged", Math.abs(one.width - rest.width) < 0.5, `${rest.width} -> ${one.width}`);
check("display width unchanged", rest.displayW === null || Math.abs(one.displayW - rest.displayW) < 0.5, `${rest.displayW} -> ${one.displayW}`);
check("IO band unchanged", JSON.stringify(one.ioRect) === JSON.stringify(rest.ioRect), `${rest.ioRect} -> ${one.ioRect}`);
check("params shrink by the mod rail only", Math.abs((rest.ctlW - one.ctlW) - RAIL * z) < 1.5, `${rest.ctlW} -> ${one.ctlW}`);
check("rails sit under the display", rest.displayBottom === null || one.rowTop >= rest.displayBottom - 0.5, `${one.rowTop} vs ${rest.displayBottom}`);
await shot("pingpong-patched", 'article[data-node="pp-1"]');

// A cable out of the thru alone opens only the thru rail (right).
const T = { sourceNode: "pp-1", sourcePort: "feedback", destinationNode: "sw-1", destinationParam: "amp" };
await commit([T]);
await page.waitForTimeout(300);
const thruOnly = await snap();
check("thru cable: thru rail open, mod rail closed", thruOnly.thruOpen && !thruOnly.open && thruOnly.modW < 1 && Math.abs(thruOnly.thruW - RAIL * z) < 1.5, JSON.stringify(thruOnly));
check("thru cable: one thru tag, no inlet tag", thruOnly.tagged.join("|") === "|feedback", JSON.stringify(thruOnly.tagged));
await shot("pingpong-thru-only", 'article[data-node="pp-1"]');
await commit([A, T]);
await page.waitForTimeout(300);
const both = await snap();
check("in + thru cables: both rails open", both.open && both.thruOpen && both.tagged.join("|") === "feedback|feedback", JSON.stringify(both.tagged));
check("in + thru cables: params shrink by both rails", Math.abs((rest.ctlW - both.ctlW) - 2 * RAIL * z) < 1.5, `${rest.ctlW} -> ${both.ctlW}`);
await shot("pingpong-both", 'article[data-node="pp-1"]');

// Chip pin: each IO box has no outward stroke and the module border is cut
// over the box's span; the box fill and its top / bottom strokes run through
// the border band. Checked on real pixels at several zooms: in a crop around
// each wall, the wall column (border ink above the box) holds only box fill
// and box stroke over the box, and its stroke rows are the box's own rows.
const crop = async (x, y, w, h) => {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height).getContext("2d");
    c.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: [...c.getImageData(0, 0, img.width, img.height).data] };
  }, buf.toString("base64"));
};
const at = (im, x, y) => im.d.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 3);
const near = (p, hex, tol = 12) => [1, 3, 5].every((k, i) => Math.abs(p[i] - parseInt(hex.slice(k, k + 2), 16)) <= tol);
const FILL = "#111111";
const INK = "#888899";
const wallCheck = (im, side, label, boxPx) => {
  // The crop is centred on the box's outward edge. Read the box's top /
  // bottom stroke rows off a column inside it, then find the wall: the first
  // border-ink column outward from the box edge, on the row just above it.
  const isBorder = (p) => p[0] > 90 && Math.abs(p[0] - p[2]) < 20 && !near(p, INK, 8);
  const mid = Math.floor(im.w / 2);
  const inner = mid - side * 2;
  const ink = [...Array(im.h).keys()].filter((y) => near(at(im, inner, y), INK));
  const top = ink[0];
  // Label glyphs can sit in the inner column: the bottom stroke is the last ink row within one box height
  // plus the two stroke rows outside the box (strokes sit outside, like the plate stroke).
  const bot = Math.max(...ink.filter((y) => y - top <= boxPx + 1 + 2 * Math.ceil(boxPx / 16)));
  if (!(bot - top > 4)) return check(`${label}: box found`, false, JSON.stringify(ink));
  const cols = [...Array(im.w).keys()].filter((x) => (side < 0 ? x <= mid : x >= mid - 1)).sort((p, q) => side * (p - q));
  const wall = cols.find((x) => isBorder(at(im, x, top - 1)));
  if (wall === undefined) return check(`${label}: wall found`, false);
  check(`${label}: border intact just outside the box`, isBorder(at(im, wall, top - 1)) && isBorder(at(im, wall, bot + 1)));
  // Every border-band column (the wall's full width, read just above the
  // box): zero border pixels over the box rows, and the box's top / bottom
  // strokes run through the band.
  const band = [];
  for (let x = wall; x >= 0 && x < im.w && isBorder(at(im, x, top - 1)); x += side) band.push(x);
  const bad = [];
  for (const x of band) {
    for (let y = top; y <= bot; y += 1) if (isBorder(at(im, x, y))) bad.push([x, y, at(im, x, y)]);
    if (!near(at(im, x, top), INK) || !near(at(im, x, bot), INK)) bad.push([x, "stroke", at(im, x, top), at(im, x, bot)]);
  }
  check(`${label}: zero border pixels in the gap (${band.length} px wall), box strokes run through it`, band.length > 0 && bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  const wallOut = band[band.length - 1] ?? wall;
  // The wire meets the box's outer edge with no dark seam: on the wire rows
  // the outermost band column carries wire / dot ink, not box fill.
  if (side < 0) {
    const mid = (top + bot) / 2;
    const rows = [Math.floor(mid), Math.ceil(mid)];
    const lit = rows.map((y) => at(im, wallOut, y)).filter((p) => Math.max(...p) > 60 && p[2] > p[1] + 20);
    check(`${label}: wire runs into the box's outer edge (no dark bar)`, lit.length > 0, JSON.stringify(rows.map((y) => at(im, wallOut, y))));
  }
  // Past the wall is the workspace or the wire, never more box.
  const outside = at(im, wallOut + side, top - 1);
  check(`${label}: box stops at the wall's outer edge`, !near(outside, FILL, 4) && !near(outside, INK), JSON.stringify(outside));
};
for (const zoom of [0.75, 1, 1.5]) {
  await page.evaluate((zz) => { setNodeGraphZoom(zz); drawNodeGraphWires(); }, zoom);
  await page.waitForTimeout(500);
  const geo = await page.evaluate(() => {
    const pp = document.querySelector('article[data-node="pp-1"]');
    const plate = nodeGraphGlGraphState.plates.find((p) => p.id === "pp-1");
    const z = nodeGraphMvp.viewport?.zoom || nodeGraphMvp.zoom || 1;
    const row = pp.querySelector('.node-parameter-row[data-param="feedback"]');
    const r = (sel) => { const b = row.querySelector(sel).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    const pins = nodeGraphModuleRailBoxes(null, plate, (x) => x, (y) => y, 1)?.boxes;
    const end = nodeGraphModulationPortCenter("pp-1", "feedback");
    const pw = nodeGraphGlGraphState.wires.find((w) => w.kind === "modulation");
    const param = pw ? { param: pw.param, dot: pw.dots[1]?.param === true, thick: nodeGraphGlGraphState.paramThick, dotSize: nodeGraphGlGraphState.paramDot, jack: nodeGraphGlGraphState.thick, from: [...pw.rgba].map((v) => Math.round(v * 255)), to: pw.rgbaEnd && [...pw.rgbaEnd].map((v) => Math.round(v * 255)) } : null;
    const lb = nodeGraphModuleLayoutBox(row.querySelector(".modulation-input"), pp);
    return { z, pins: pins ? pins.map((p) => p.side) : [], inL: r(".modulation-input"), outR: r(".parameter-output"), param,
      wire: end ? [end.x - plate.x, end.y - (plate.y + lb.y + lb.h / 2)] : null };
  });
  check(`zoom ${zoom}: wire ends on the box's open side, on the border's outer edge, centred`, geo.wire && Math.abs(geo.wire[0] + 1) < 0.01 && Math.abs(geo.wire[1]) < 0.01, JSON.stringify(geo.wire));
  check(`zoom ${zoom}: param wire is thin with the default end dot (--node-param-wire-dot-size) on the box, jack wires keep their width`, geo.param?.param && geo.param.dot && geo.param.thick === 0.5 && Math.abs(geo.param.dotSize - 2.012454) < 0.01 && geo.param.jack === 2, JSON.stringify(geo.param));
  // Solid-colour wires (9516bb94): a param wire is the mod inlet's colour end to end, no crossfade.
  check(`zoom ${zoom}: param wire is solid in the mod inlet colour (purple)`, geo.param && !geo.param.to && geo.param.from.slice(0, 3).join() === "177,132,255", JSON.stringify(geo.param));
  check(`zoom ${zoom}: one IO box per rail, left and right`, geo.pins.length === 2 && geo.pins.includes(-1) && geo.pins.includes(1), JSON.stringify(geo.pins));
  const bh = Math.min(geo.inL[3] - geo.inL[1], 16 * geo.z);
  const cy = (geo.inL[1] + geo.inL[3]) / 2;
  const y0 = Math.floor(cy - bh / 2 - 4 * geo.z);
  const h = Math.ceil(bh + 8 * geo.z);
  wallCheck(await crop(Math.floor(geo.inL[0]) - 8, y0 - 40, 16, h + 80), -1, `zoom ${zoom} left`, Math.ceil(bh));
  wallCheck(await crop(Math.floor(geo.outR[2]) - 8, y0 - 40, 16, h + 80), 1, `zoom ${zoom} right`, Math.ceil(bh));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, `rails-pin-zoom-${zoom}.png`), clip: { x: Math.max(0, Math.floor(geo.inL[0]) - 12), y: Math.max(0, y0 - 40 * geo.z), width: Math.ceil(geo.outR[2] - geo.inL[0]) + 24, height: Math.ceil(h + 80 * geo.z) } });
}
await page.evaluate(() => { setNodeGraphZoom(1); drawNodeGraphWires(); });
await page.waitForTimeout(300);

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
check("last unplug: thru rail hides too", !gone.thruOpen && gone.thruW < 1, gone.thruW);
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
  // Widest overflow of any IO label past its own box (0 = every label fits).
  const maxLabelW = Math.max(...[...el.querySelectorAll(".node-io-label")].map((l) => l.scrollWidth - l.clientWidth));
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
check("comparator: labels fit their column (no overflow)", cmp.maxLabelW <= 0.5, cmp.maxLabelW);
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
