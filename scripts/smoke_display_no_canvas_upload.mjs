// All-GPU display rule, runtime side (static side: smoke_display_gl_renderers.mjs).
//  1. While a patch plays, no canvas is uploaded as a texture over and over
//     (texImage2D / texSubImage2D from an HTMLCanvasElement). A face canvas
//     inside a module may be uploaded at most twice (the one face-texture
//     seed, a resize); a detached canvas (glyph atlas) at most 3 times.
//     Approved 2D faces: Audio Player playlist, Sequencer, Transport.
//  2. No overlay canvas is stacked on a face (.node-waterfall-ink-overlay or
//     any *overlay* canvas inside a module).
//  3. Waterfall ink is drawn into the face by GL: pause bars show up in the
//     Output face's GPU picture while paused, and are gone from the ink layer
//     after Play; no display GL failures.
// Usage: node scripts/smoke_display_no_canvas_upload.mjs [patch ...]  (server.py on :8765)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const PATCHES = process.argv.slice(2).length ? process.argv.slice(2) : ["softpop", "rgb", "demo_patches/triangle_comparison", "_smoke_rms_ink"];
// _smoke_rms_ink: softpop plus an RMS meter fed by the filter (served from
// memory, no patch file), for the RMS dB guide ink.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function rmsInkPatch() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes.push({ gx: 9, gy: 16, id: "rms-ink", type: "rmsStereo" });
  d.connections.push({ destinationNode: "rms-ink", destinationPort: "Left", sourceNode: "passiveFilter-1", sourcePort: "Left", tracePoints: [] });
  return JSON.stringify(d);
}
const APPROVED = /^(audioPlayer|sequencer|transport)/i;
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });

async function run(patch) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    const up = { on: false, counts: new Map() };
    window.__up = up;
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!P) continue;
      for (const name of ["texImage2D", "texSubImage2D"]) {
        const f = P.prototype[name];
        P.prototype[name] = function (...a) {
          const src = a[a.length - 1];
          if (up.on && src instanceof HTMLCanvasElement) up.counts.set(src, (up.counts.get(src) || 0) + 1);
          return f.apply(this, a);
        };
      }
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  await page.route("**/_smoke_rms_ink.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: rmsInkPatch() }));
  await page.goto(`${BASE}?pagePatch=${patch}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof setNodeGraphLiveSpeed === "function"
    && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.locator("[data-transport-play]:visible").first().click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__up.on = true; });
  await page.waitForTimeout(3000);
  const uploads = await page.evaluate((approvedSrc) => {
    const approved = new RegExp(approvedSrc, "i");
    const up = window.__up; up.on = false;
    const bad = [];
    let total = 0;
    for (const [c, n] of up.counts) {
      total += n;
      const art = c.closest?.("article[data-node-type]");
      const type = art?.dataset.nodeType || "";
      if (type && approved.test(type)) continue;
      const limit = c.isConnected ? 2 : 3;
      if (n > limit) bad.push(`${type || (c.isConnected ? "page" : "detached")} ${String(c.className).slice(0, 60)} ${c.width}x${c.height} x${n}`);
    }
    const overlays = [...document.querySelectorAll("article[data-node-type] canvas")]
      .filter((c) => /overlay/i.test(c.className)).map((c) => `${c.closest("article").dataset.nodeType} ${c.className}`);
    return { bad, total, overlays };
  }, APPROVED.source);
  check(uploads.bad.length === 0, `${patch}: no repeated canvas texture uploads while playing`, uploads.bad.join(" | ") || `(${uploads.total} canvas uploads in 3 s)`);
  check(uploads.overlays.length === 0, `${patch}: no overlay canvas stacked on a face`, uploads.overlays.join(" | "));

  // Waterfall ink, in the face's GPU picture.
  // Only an on-screen Output face paints (culled faces wait for their wake).
  const hasOutput = await page.evaluate(() => (typeof nodeGraphVisibleModuleScopeSlots === "function"
    ? nodeGraphVisibleModuleScopeSlots() : []).some((s) => s.type === "output"));
  if (!hasOutput) console.log(`skip ${patch}: no on-screen Output face`);
  if (hasOutput) {
    const probe = () => page.evaluate(() => {
      const art = document.querySelector('article[data-node-type="output"]');
      const face = [...art.querySelectorAll("canvas")].find((c) => c._wfGlSession);
      if (!face) return { err: "no waterfall face" };
      const p = nodeGraphSharedGlFacePixels(face);
      if (!p) return { err: "no GPU face picture" };
      const { width: w, height: h, data } = p;
      // Same geometry as paintNodeGraphOutputPauseBars.
      const side = Math.min(w, h);
      const fit = Math.max(8, side - Math.max(2, Math.round(side * 0.08)) * 2);
      const barH = Math.max(8, Math.round(fit * 0.52));
      const barW = Math.max(3, Math.round(fit * 0.2));
      const gap = Math.max(2, Math.round(fit * 0.14));
      const x0 = Math.round((w - (barW * 2 + gap)) * 0.5);
      const y0 = Math.round((h - barH) * 0.5);
      const white = (x, y) => {
        const i = (Math.floor(y) * w + Math.floor(x)) * 4;
        return data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
      };
      let barWhite = 0; let barN = 0;
      for (const bx of [x0, x0 + barW + gap]) {
        for (let y = y0 + barH * 0.2; y < y0 + barH * 0.8; y += Math.max(1, barH / 10)) {
          barN += 1;
          if (white(bx + barW * 0.5, y)) barWhite += 1;
        }
      }
      return { w, h, barWhite, barN, dirty: face._faceInkDirty === true, armed: Boolean(face._faceInk) };
    });
    await page.evaluate(() => setNodeGraphLiveSpeed(0));
    await page.waitForTimeout(700);
    const paused = await probe();
    check(!paused.err && paused.barWhite === paused.barN, `${patch}: Output face shows the pause bars while paused (GPU picture)`, JSON.stringify(paused));
    await page.evaluate(() => setNodeGraphLiveSpeed(1));
    await page.waitForTimeout(2500);
    const playing = await probe();
    check(!playing.err && !playing.dirty, `${patch}: pause ink cleared after Play`, JSON.stringify(playing));
  }
  // RMS meters: dB guides armed on the face.
  const rms = await page.evaluate(() => [...document.querySelectorAll('article[data-node-type^="rms"]')].map((a) => {
    const face = [...a.querySelectorAll("canvas")].find((c) => c._wfGlSession);
    return { type: a.dataset.nodeType, guides: Boolean(face?._faceInk?.guides), dirty: face?._faceInkDirty === true };
  }));
  for (const r of rms) check(r.guides && r.dirty, `${patch}: ${r.type} RMS dB guides drawn into the face`, JSON.stringify(r));
  if (patch === "_smoke_rms_ink") check(rms.length > 0, `${patch}: the RMS meter loaded`);
  const failed = await page.evaluate(() => (typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : []));
  check(failed.length === 0, `${patch}: no display GL failures`, failed.join(" | "));
  const errs = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e));
  check(errs.length === 0, `${patch}: no page errors`, [...new Set(errs)].slice(0, 4).join(" | "));
  await ctx.close();
}

for (const patch of PATCHES) await run(patch);
await browser.close();
console.log(failures ? `smoke_display_no_canvas_upload: ${failures} failure(s)` : "smoke_display_no_canvas_upload: ok");
process.exit(failures ? 1 : 0);