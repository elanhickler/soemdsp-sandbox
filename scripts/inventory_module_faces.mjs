// PP-1 inventory (docs/MODULE_RAILS_PLAN.md): every module definition's face
// layout (Q28 rule), visible params, ports, whole-face `layout` kind and custom
// folder, read from the live app. Writes docs/module_faces_inventory.json and
// prints a markdown summary.
// Usage: node scripts/inventory_module_faces.mjs   (server.py on :8765)
//   SANDBOX_URL, CHROME_PATH, PW_MODULE (playwright-core path) optional.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const launch = { headless: true };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof nodeGraphModuleDefinitions === "object"
  && typeof nodeGraphResolveFaceLayout === "function", null, { timeout: 200000 });
const folders = new Set(fs.readdirSync(path.join(root, "public/modules")));
const rows = (await page.evaluate(() => Object.entries(nodeGraphModuleDefinitions).map(([type, def]) => ({
  type,
  faceLayout: def.faceLayout,
  chrome: def.chrome || "",
  layout: def.layout || "",
  display: nodeGraphDefinitionHasDisplay(def),
  visibleParams: (def.parameters || []).filter((p) => p && p.hidden !== true).length,
  inputs: (def.inputs || []).length,
  outputs: (def.outputs || []).length,
})))).map((r) => ({ ...r, customFolder: folders.has(r.type) ? `public/modules/${r.type}` : "" }));
await browser.close();
rows.sort((a, b) => a.type.localeCompare(b.type));
fs.writeFileSync(path.join(root, "docs/module_faces_inventory.json"), `${JSON.stringify(rows, null, 1)}\n`);
const count = (k, v) => rows.filter((r) => r[k] === v).length;
console.log("| definitions | spawn | railsOnly | with layout kind | with custom folder |");
console.log("|---|---|---|---|---|");
console.log(`| ${rows.length} | ${count("faceLayout", "spawn")} | ${count("faceLayout", "railsOnly")} | ${rows.filter((r) => r.layout).length} | ${rows.filter((r) => r.customFolder).length} |`);
console.log(`\nrailsOnly: ${rows.filter((r) => r.faceLayout === "railsOnly").map((r) => r.type).join(", ")}`);
