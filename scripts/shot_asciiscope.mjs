// Screenshot: Asciiscope GPU face (matrix-display-display.js) on the shared
// WebGL2 device, fed a moving Lissajous for 90 frames, saved to
// scripts/out/asciiscope.png. Usage: node scripts/shot_asciiscope.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "asciiscope.png");
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(`${BASE}?pagePatch=softpop`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof matrixDisplayDrawFace === "function" && typeof nodeGraphSharedGlDevice === "function", null, { timeout: 120000 });
await page.waitForTimeout(800);
const res = await page.evaluate(() => {
  const id = "shot-ascii";
  const N = 800;
  const xs = new Float32Array(N), ys = new Float32Array(N);
  const bufs = nodeGraphModuleScopeState.buffers;
  bufs.set(`${id}:X`, xs); bufs.set(`${id}:Y`, ys);
  const host = document.createElement("div");
  host.id = "ascii-shot";
  host.style.cssText = "position:fixed;left:20px;top:20px;width:480px;height:320px;z-index:99999;background:#000";
  const cv = document.createElement("canvas");
  cv.style.cssText = "display:block;width:100%;height:100%";
  host.appendChild(cv); document.body.appendChild(host);
  // 60 fps clock so decay runs at its real rate (a tight loop is ~0 ms/frame).
  const realNow = performance.now.bind(performance); let fake = realNow(); performance.now = () => fake;
  let abs = 0; let phase = 0; let ok = true;
  const params = { density: 0.75, trail: 0.35, ghost: 0.3, brightness: 1, burnAmount: 1, backgroundBrightness: 0.04, freeze: false };
  for (let f = 0; f < 90; f += 1) {
    for (let i = 0; i < N; i += 1) {
      const t = (phase + i) / 48000 * Math.PI * 2;
      xs[i] = 0.85 * Math.sin(t * 110);
      ys[i] = 0.85 * Math.sin(t * 165 + f * 0.03);
    }
    phase += N; abs += N;
    xs.nodeGraphScopeAbsoluteFrame = abs; ys.nodeGraphScopeAbsoluteFrame = abs;
    fake += 1000 / 60;
    ok = matrixDisplayDrawFace(cv, id, " .:-=+*#%@", params) && ok;
  }
  performance.now = realNow;
  bufs.delete(`${id}:X`); bufs.delete(`${id}:Y`);
  const st = matrixDisplayGpuStates.get(id);
  return { ok, cols: st?.cols, rows: st?.rows, label: st?.read?.label, w: cv.width, h: cv.height };
});
await page.locator("#ascii-shot").screenshot({ path: out });
console.log(JSON.stringify(res), errors.slice(0, 3));
console.log(`saved ${out}`);
await browser.close();
process.exit(res.ok && !errors.length ? 0 : 1);
