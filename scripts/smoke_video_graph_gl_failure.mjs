// VG-8 (docs/VIDEO_GRAPH_PLAN.md): video graph GL failure policy.
// For each video node type, force (a) a program link failure and (b) a
// framebuffer failure inside that module's GL file only, with one healthy
// consumer cabled downstream. Expected per case:
//   - the failing node's face is black,
//   - exactly one nodeGraphDisplayGlFailed report (one key),
//   - nothing downstream: the consumer reads no picture from it,
//   - no retry loop: no further link / FBO attempts after the first second.
// Failures are injected by wrapping getProgramParameter(LINK_STATUS) and
// checkFramebufferStatus on WebGL2 and failing only calls whose stack is in
// the module's own GL file.
// Usage: node scripts/smoke_video_graph_gl_failure.mjs   (server.py on :8765)
//   ONLY=fbmField:link  run one case.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  fbmField: "fbm-field-gl.js",
  rgbFractal: "rgb-fractal-gl.js",
  videoFeedback: "video-feedback-gl.js",
  videoDelay: "video-delay-gl.js",
  imageBurn: "image-burn-gl.js",
};
const MODES = process.env.NOFAIL ? ["none"] : ["link", "fbo"];

function patchFor(type) {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 30, gy: 1 }));
  d.graphConnections = [];
  d.modulations = [];
  const consumer = type === "videoDelay" ? "imageBurn" : "videoDelay";
  d.nodes.push({ gx: 1, gy: 1, id: "bad", type });
  d.nodes.push({ gx: 7, gy: 1, id: "down", type: consumer });
  d.connections = [{ sourceNode: "bad", sourcePort: "rgba", destinationNode: "down", destinationPort: "rgba", tracePoints: [] }];
  return JSON.stringify(d);
}

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
let failures = 0;
const cases = [];
for (const type of Object.keys(TYPES)) for (const mode of MODES) cases.push([type, mode]);
const only = process.env.ONLY;
for (const [type, mode] of cases.filter(([t, m]) => !only || only === `${t}:${m}` || only === t)) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(({ file, mode }) => {
    const f = { file, mode, attempts: 0, failed: 0 };
    window.__vgFail = f;
    const P = WebGL2RenderingContext.prototype;
    const inFile = () => String(new Error().stack || "").includes(file);
    const gpp = P.getProgramParameter;
    P.getProgramParameter = function (prog, pname) {
      if (mode === "link" && pname === this.LINK_STATUS && inFile()) { f.attempts += 1; f.failed += 1; return false; }
      return gpp.call(this, prog, pname);
    };
    const cfs = P.checkFramebufferStatus;
    P.checkFramebufferStatus = function (target) {
      if (mode === "fbo" && inFile()) { f.attempts += 1; f.failed += 1; return this.FRAMEBUFFER_UNSUPPORTED; }
      return cfs.call(this, target);
    };
  }, { file: TYPES[type], mode });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  if (process.env.DEBUG) page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`  [${m.type()}] ${m.text().slice(0, 240)}`); });
  await page.route("**/vg-fail.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: patchFor(type) }));
  await page.goto(`${BASE}?pagePatch=vg-fail`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('article[data-node="bad"]') && document.querySelector('article[data-node="down"]'), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const play = page.locator("[data-transport-play]:visible").first();
  if (await play.count()) await play.click();
  await page.waitForTimeout(2500);
  const a0 = await page.evaluate(() => window.__vgFail.attempts);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const keys = typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : [];
    const pic = typeof nodeGraphPictureRead === "function" ? nodeGraphPictureRead("down", "rgba") : null;
    const rect = (id) => {
      const el = document.querySelector(`article[data-node="${id}"] [data-node-graph-display], article[data-node="${id}"] canvas`)
        || document.querySelector(`article[data-node="${id}"]`);
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    // Test-only readback of the picture the consumer gets (black = max 0).
    let picMax = -1;
    const gl = pic?.texture && nodeGraphPictureDevice?.()?.gl;
    if (gl) {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pic.texture, 0);
      const px = new Uint8Array(pic.width * pic.height * 4);
      gl.readPixels(0, 0, pic.width, pic.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      picMax = 0;
      for (let i = 0; i < px.length; i += 4) picMax = Math.max(picMax, px[i], px[i + 1], px[i + 2]);
    }
    return { attempts: window.__vgFail.attempts, keys, downPicture: Boolean(pic?.texture), picMax, badRect: rect("bad"), downRect: rect("down") };
  });
  const lum = async (b) => {
    if (!(b.w > 4 && b.h > 4)) return -1;
    const png = await page.screenshot({ clip: { x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h - 4 } });
    return page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
      return max;
    }, png.toString("base64"));
  };
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${type}-${mode}.png` });
  if (process.env.DEBUG) console.log("  rects", JSON.stringify([r.badRect, r.downRect]));
  const badMax = await lum(r.badRect);
  const downMax = await lum(r.downRect);
  const retries = r.attempts - a0;
  const checks = [
    [r.attempts > 0, `failure injected (${r.attempts} attempts)`],
    [badMax >= 0 && badMax <= 8, `face black (max channel ${badMax})`],
    [r.keys.length === 1, `one nodeGraphDisplayGlFailed report (${r.keys.length}: ${r.keys.join(" ; ") || "none"})`],
    [!r.downPicture || (r.picMax >= 0 && r.picMax <= 8), `black downstream (${r.downPicture ? `picture max ${r.picMax}` : "no picture"})`],
    [retries === 0, `no retry loop (${retries} attempts in the last 3 s)`],
  ];
  const bad = checks.filter(([ok]) => !ok);
  failures += bad.length;
  console.log(`${bad.length ? "FAIL" : "ok  "} ${type}:${mode}  ${checks.map(([ok, m]) => `${ok ? "+" : "-"} ${m}`).join(" | ")}  [down face max ${downMax}]${errors.length ? ` pageerrors: ${errors.slice(0, 2).join(" / ")}` : ""}`);
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} failure(s)` : "all ok");
process.exit(failures ? 1 : 0);
