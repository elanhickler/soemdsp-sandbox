// PP-L layout regression probe (docs/MODULE_RAILS_PLAN.md "Layout breakage").
// Loads every stored patch (patches/**, saved-patches/**) in one boot, records
// each module's workspace box at zoom 1.0 plus a thumbnail, and, given a
// baseline run, writes a per-patch report: pass / moved / broken.
// Usage:
//   node scripts/probe_layout_regression.mjs --out scripts/out/layout-before   (old build)
//   node scripts/probe_layout_regression.mjs --out scripts/out/layout-after --baseline scripts/out/layout-before
//   add --compare-only to rebuild report.md from two existing layout.json files
// SANDBOX_URL, CHROME_PATH, PW_MODULE, LIMIT (first N patches), THUMBS=1 (jpeg per patch) optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ""; };
const outDir = path.resolve(arg("--out") || "scripts/out/layout");
const baseline = arg("--baseline") ? path.resolve(arg("--baseline")) : "";
const limit = Number(process.env.LIMIT) || Infinity;
fs.mkdirSync(path.join(outDir, "thumbs"), { recursive: true });

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : (e.name.endsWith(".json") && e.name !== "index.json" ? [p] : []);
}) : []);
const compareOnly = process.argv.includes("--compare-only");
const files = compareOnly ? [] : [...walk(path.join(root, "patches")), ...walk(path.join(root, "saved-patches"))].slice(0, limit);

let results = {};
if (compareOnly) {
  results = JSON.parse(fs.readFileSync(path.join(outDir, "layout.json"), "utf8"));
} else {
const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
let errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && document.querySelector(".dsp-node"), null, { timeout: 300000 });
await page.waitForTimeout(2000);

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  errors = [];
  let json = null;
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch { results[rel] = { error: "unreadable json" }; continue; }
  if (!Array.isArray(json?.nodes)) { results[rel] = { skipped: "not a patch" }; continue; }
  const boxes = await page.evaluate(async (patch) => {
    try { commitNodeGraphPatch(loadNodeGraphPatchFromObject(patch), { status: "layout probe" }); } catch (e) { return { error: String(e?.message || e) }; }
    await new Promise((r) => setTimeout(r, 600));
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    const out = {};
    for (const el of document.querySelectorAll(".dsp-node[data-node]")) {
      out[el.dataset.node] = { w: el.offsetWidth, h: el.offsetHeight, x: el.offsetLeft, y: el.offsetTop };
    }
    return { modules: out };
  }, json);
  let thumb = "";
  if (process.env.THUMBS) {
    thumb = `thumbs/${rel.replace(/[\/]/g, "__").replace(/\.json$/, ".jpg")}`;
    await page.screenshot({ path: path.join(outDir, thumb), type: "jpeg", quality: 50 }).catch(() => {});
  }
  results[rel] = { ...boxes, thumb, errors: errors.slice(0, 3) };
  fs.writeFileSync(path.join(outDir, "layout.json"), `${JSON.stringify(results, null, 1)}\n`);
}
await browser.close();
fs.writeFileSync(path.join(outDir, "layout.json"), `${JSON.stringify(results, null, 1)}\n`);
}

if (baseline) {
  const before = JSON.parse(fs.readFileSync(path.join(baseline, "layout.json"), "utf8"));
  const lines = ["# Layout regression report", "", `before: ${baseline}`, `after: ${outDir}`, "", "| patch | status | detail |", "|---|---|---|"];
  const tally = { pass: 0, moved: 0, broken: 0, skipped: 0 };
  for (const [rel, a] of Object.entries(results)) {
    const b = before[rel];
    let status = "pass";
    let detail = "";
    if (a.skipped) { status = "skipped"; detail = a.skipped; }
    else if (a.error || !a.modules || (a.errors || []).length) { status = "broken"; detail = a.error || (a.errors || []).join("; ").slice(0, 160); }
    else if (!b?.modules) { status = "pass"; detail = "no baseline"; }
    else {
      const changed = [];
      for (const [id, box] of Object.entries(a.modules)) {
        const old = b.modules[id];
        if (!old) { changed.push(`${id} new`); continue; }
        const d = ["w", "h", "x", "y"].filter((k) => Math.abs(box[k] - old[k]) > 1).map((k) => `${k} ${old[k]}->${box[k]}`);
        if (d.length) changed.push(`${id} ${d.join(" ")}`);
      }
      for (const id of Object.keys(b.modules)) if (!a.modules[id]) changed.push(`${id} missing`);
      if (changed.some((c) => c.endsWith("missing"))) status = "broken";
      else if (changed.length) status = "moved";
      detail = changed.slice(0, 4).join("; ") + (changed.length > 4 ? ` (+${changed.length - 4})` : "");
    }
    tally[status] += 1;
    lines.push(`| ${rel} | ${status} | ${detail.replace(/\|/g, "/")} |`);
  }
  lines.splice(5, 0, `pass ${tally.pass}, moved ${tally.moved}, broken ${tally.broken}, skipped ${tally.skipped}`, "");
  fs.writeFileSync(path.join(outDir, "report.md"), `${lines.join("\n")}\n`);
  console.log(`pass ${tally.pass}, moved ${tally.moved}, broken ${tally.broken}, skipped ${tally.skipped} -> ${path.join(outDir, "report.md")}`);
} else {
  console.log(`captured ${Object.keys(results).length} patches -> ${outDir}`);
}
