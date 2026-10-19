// ZP-2 (docs/ZOOM_PERF_PLAN.md): every face present path lands upright.
// Paints the top half red and the bottom half blue, sends it through each
// present path (nodeGraphSharedGlBlitTo2D, nodeGraphDisplayCanvasBlit,
// nodeGraphPicturePresent, a gl-line-renderer batch) at 64 px and 600 px
// (both sides of the old 512 px readPixels split), into a GL-composited face
// (texture only) and into an on-screen 2D canvas. Checks the face's own
// pixels and what a GL consumer (nodeGraphGlLinesImage, as the GL graph,
// mini view and magnifier draw it) sees. Also checks no readPixels happen.
// Usage: node scripts/smoke_display_face_orientation.mjs   (server.py on :8765)
// Needs a real GPU: headed by default; HEADLESS=1 only with GPU headless.
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphPictureDevice === "function"
  && typeof nodeGraphGlLinesBegin === "function"
  && document.querySelector("#nodeGraphWorkspace.gl-graph-on"), null, { timeout: 120000 });
await page.waitForTimeout(2000);

const results = await page.evaluate(() => {
  const dev = nodeGraphPictureDevice();
  const gl = dev.gl;
  let readPixels = 0;
  const rp = gl.readPixels;
  const out = [];
  const paintHalves = (fbo, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    // GL rows are bottom-up: the lower half is the picture's bottom (blue).
    gl.scissor(0, 0, w, h >> 1); gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.scissor(0, h >> 1, w, h - (h >> 1)); gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const paths = {
    blitTo2D(canvas, w, h) {
      paintHalves(null, w, h);
      return nodeGraphSharedGlBlitTo2D(canvas.getContext("2d"), w, h);
    },
    displayCanvasBlit(canvas, w, h) {
      paintHalves(null, w, h);
      return nodeGraphDisplayCanvasBlit(canvas.getContext("2d"), dev.canvas, 0, dev.canvas.height - h, w, h, 0, 0, w, h, false);
    },
    picturePresent(canvas, w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      // Pictures are FBO-style: row 0 = bottom.
      paintHalves(fbo, w, h);
      const ok = nodeGraphPicturePresent(tex, w, h, canvas, w, h);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return ok;
    },
    glLinesBatch(canvas, w, h) {
      const b = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 1], { scale: 1 });
      if (!b) return false;
      nodeGraphGlLinesRect(b, 0, 0, w, h / 2, [1, 0, 0, 1]);
      nodeGraphGlLinesRect(b, 0, h / 2, w, h / 2, [0, 0, 1, 1]);
      return nodeGraphGlLinesEnd(b) !== false;
    },
  };
  const ws = document.getElementById("nodeGraphWorkspace");
  const sample = (px, w, h) => {
    const at = (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    return { top: at(w >> 1, Math.floor(h * 0.15)), bottom: at(w >> 1, Math.floor(h * 0.85)) };
  };
  for (const size of [64, 600]) {
    for (const where of ["face", "dom"]) {
      for (const [name, run] of Object.entries(paths)) {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        canvas.className = "node-display-canvas zp2-orientation-probe";
        canvas.style.cssText = "position:absolute;left:0;top:0;width:10px;height:10px;";
        (where === "face" ? ws : document.body).appendChild(canvas);
        gl.readPixels = function (...a) { readPixels += 1; return rp.apply(this, a); };
        const ok = run(canvas, size, size);
        gl.readPixels = rp;
        const counted = readPixels; readPixels = 0;
        // The face's own pixels.
        let own = null;
        if (where === "face") {
          const p = nodeGraphSharedGlFacePixels(canvas);
          own = p ? sample(p.data, p.width, p.height) : null;
        } else {
          own = sample(canvas.getContext("2d").getImageData(0, 0, size, size).data, size, size);
        }
        // What a GL consumer sees (the GL graph's face quad path).
        const view = document.createElement("canvas");
        view.width = size; view.height = size;
        document.body.appendChild(view);
        const vb = nodeGraphGlLinesBegin(view, [0, 0, 0, 1], { scale: 1 });
        nodeGraphGlLinesImage(vb, canvas, 0, 0, size, size, { nearest: true });
        nodeGraphGlLinesEnd(vb);
        const seen = sample(view.getContext("2d").getImageData(0, 0, size, size).data, size, size);
        out.push({ size, where, name, ok, readPixels: counted, own, seen,
          textureOnly: nodeGraphSharedGlFaceTextureOnly(canvas) });
        view.remove();
        canvas.remove();
      }
    }
  }
  return out;
});
const red = (c) => c && c[0] > 200 && c[2] < 60;
const blue = (c) => c && c[2] > 200 && c[0] < 60;
for (const r of results) {
  const tag = `${r.name} ${r.size}px ${r.where}${r.textureOnly ? " (texture only)" : ""}`;
  gate(r.ok, `${tag}: present ok`);
  gate(r.readPixels === 0, `${tag}: no readPixels (${r.readPixels})`);
  gate(red(r.own?.top) && blue(r.own?.bottom), `${tag}: face upright (top ${r.own?.top}, bottom ${r.own?.bottom})`);
  gate(red(r.seen.top) && blue(r.seen.bottom), `${tag}: GL consumer sees it upright (top ${r.seen.top}, bottom ${r.seen.bottom})`);
}
gate(results.some((r) => r.textureOnly), "texture-only faces were exercised");
await browser.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
