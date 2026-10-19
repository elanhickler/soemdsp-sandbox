// ZP-1 (docs/ZOOM_PERF_PLAN.md): every display renderer's WebGL programs link
// on the shared context, and a failed link is not retried per frame.
// Loads patches with play on, records every linkProgram on the page, and fails
// on any link failure, any nodeGraphDisplayGlFailed entry, or links that keep
// happening once the patch is warm (a per-frame recompile). Also: a broken
// Script display {} shader is compiled once per source, not per frame.
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
  if (patch === PATCHES[0]) {
    // Script display {} user shader: a broken source compiles once, logs once,
    // and keeps its error text; a new source compiles again.
    const u = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 32;
      const errors = [];
      const log = console.error;
      console.error = (...a) => { errors.push(String(a[0])); };
      const before = nodeGraphGlLinesUserShaderStats().compiles;
      const texts = [];
      try {
        for (let i = 0; i < 30; i += 1) {
          texts.push(nodeGraphGlLinesUserShader({ key: "__smoke_bad_shader", canvas, userBody: "out_color = vec4(nope);", floatNames: [], floats: {}, time: i }).error);
        }
        const afterBad = nodeGraphGlLinesUserShaderStats().compiles;
        const good = nodeGraphGlLinesUserShader({ key: "__smoke_bad_shader", canvas, userBody: "out_color = vec4(uv, 0.0, 1.0);", floatNames: [], floats: {}, time: 0 });
        return { bad: afterBad - before, total: nodeGraphGlLinesUserShaderStats().compiles - before, logs: errors.filter((e) => /emo shader/.test(e)).length, withText: texts.filter((s) => /nope|undeclared|ERROR/i.test(String(s))).length, good: good.ok };
      } finally {
        console.error = log;
      }
    });
    gate(u.bad === 1 && u.logs === 1 && u.withText === 30, `${patch}: broken Script shader compiles once, logs once, keeps its error text (${JSON.stringify(u)})`);
    gate(u.total === 2 && u.good, `${patch}: a changed Script shader source compiles again`);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
