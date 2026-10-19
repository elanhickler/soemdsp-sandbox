// ZP-1 (docs/ZOOM_PERF_PLAN.md): every display renderer's WebGL programs link
// on the shared context, and a failed link is not retried per frame.
// Loads patches with play on, records every linkProgram on the page, and fails
// on any link failure, any nodeGraphDisplayGlFailed entry, or links that keep
// happening once the patch is warm (a per-frame recompile).
// Usage: node scripts/smoke_display_gl_programs_link.mjs [patch ...]  (server.py on :8765)
// Needs a real GPU: headed by default; HEADLESS=1 only with GPU headless.
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const PATCHES = process.argv.slice(2).length ? process.argv.slice(2) : ["softpop", "musicplayer"];
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
for (const patch of PATCHES) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    const c = { links: 0, fails: [] };
    window.__links = c;
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!P) continue;
      const link = P.prototype.linkProgram;
      P.prototype.linkProgram = function (prog) {
        const r = link.call(this, prog);
        c.links += 1;
        if (!this.getProgramParameter(prog, this.LINK_STATUS)) {
          c.fails.push(String(this.getProgramInfoLog(prog) || "no info log").slice(0, 240));
        }
        return r;
      };
    }
  });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  await page.goto(`${BASE}?pagePatch=${patch}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const play = page.locator("[data-transport-play]:visible").first();
  if (await play.count()) await play.click();
  await page.waitForTimeout(3000);
  const warm = await page.evaluate(() => window.__links.links);
  // Exercise a zoom so zoom-path programs are built too.
  await page.mouse.move(800, 550);
  for (let i = 0; i < 20; i += 1) { await page.mouse.wheel(0, -60); await page.waitForTimeout(30); }
  for (let i = 0; i < 20; i += 1) { await page.mouse.wheel(0, 60); await page.waitForTimeout(30); }
  await page.waitForTimeout(1500);
  const mid = await page.evaluate(() => window.__links.links);
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => ({
    links: window.__links.links,
    fails: window.__links.fails,
    gl: typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : [],
  }));
  gate(r.links > 0, `${patch}: GL programs were linked (${r.links})`);
  gate(r.fails.length === 0, `${patch}: every GL program links${r.fails.length ? " - " + r.fails.slice(0, 3).join(" | ") : ""}`);
  gate(r.gl.length === 0, `${patch}: no nodeGraphDisplayGlFailed entries${r.gl.length ? " - " + r.gl.slice(0, 4).join(" | ") : ""}`);
  gate(r.links - mid <= 2, `${patch}: no per-frame relink once warm (warm ${warm}, after zoom ${mid}, 2 s later ${r.links})`);
  await ctx.close();
}
await browser.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
