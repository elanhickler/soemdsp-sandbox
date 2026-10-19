// ZP-7 (docs/ZOOM_PERF_PLAN.md): slow wheel zoom 1x -> 40x -> 1x on a playing
// patch, on a real GPU. Reports frame fps / p50 / p90 / max from rAF intervals
// and counts forbidden reads during the gesture: gl.readPixels,
// getComputedStyle, getBoundingClientRect, offsetWidth/offsetHeight/
// offsetLeft/offsetTop, plus GL program links (should be 0 once warm).
// Usage: node scripts/probe_zoom_perf.mjs [patch]   (server.py on :8765)
//   GATE=1  exit 1 when fps < MIN_FPS (default 50) or a forbidden read happens.
// Headed by default (faces are WebGL only); HEADLESS=1 only with GPU headless.
import { chromium } from "playwright";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const PATCH = process.argv[2] || "softpop";
const MIN_FPS = Number(process.env.MIN_FPS || 50);

const browser = await chromium.launch({
  headless: Boolean(process.env.HEADLESS),
  args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
if (process.env.STACKS) await ctx.addInitScript(() => { window.__zpStacks = true; });
await ctx.addInitScript(() => {
  const c = { on: false, readPixels: 0, gcs: 0, gbcr: 0, offset: 0, link: 0, linkFail: 0, linkLogs: [], who: {} };
  window.__zp = c;
  // STACKS=1: tally the calling function of each forbidden read.
  const stacks = Boolean(window.__zpStacks);
  const note = (key) => {
    c[key] += 1;
    if (!stacks) return;
    const line = (new Error().stack || "").split("\n")[3] || "?";
    const k = key + " " + line.trim().replace(/\(?https?:\/\/[^/]+\/public\//, "").replace(/\?v=[^:]+/, "");
    c.who[k] = (c.who[k] || 0) + 1;
  };
  const wrap = (proto, name, key) => {
    const f = proto[name];
    proto[name] = function (...a) { if (c.on) note(key); return f.apply(this, a); };
  };
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!P) continue;
    wrap(P.prototype, "readPixels", "readPixels");
    const link = P.prototype.linkProgram;
    P.prototype.linkProgram = function (prog) {
      const r = link.call(this, prog);
      if (c.on) c.link += 1;
      if (!this.getProgramParameter(prog, this.LINK_STATUS)) {
        c.linkFail += 1;
        if (c.linkLogs.length < 8) c.linkLogs.push(String(this.getProgramInfoLog(prog) || "no log").slice(0, 200));
      }
      return r;
    };
  }
  const gcs = window.getComputedStyle;
  window.getComputedStyle = function (...a) { if (c.on) note("gcs"); return gcs.apply(this, a); };
  wrap(Element.prototype, "getBoundingClientRect", "gbcr");
  for (const k of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get() { if (c.on) note("offset"); return d.get.call(this); },
    });
  }
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
await page.goto(`${BASE}?pagePatch=${PATCH}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphZoom === "function"
  && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForTimeout(2500);
await page.evaluate(() => { if (typeof resetNodeGraphZoomToOne === "function") resetNodeGraphZoomToOne(); });
await page.waitForTimeout(800);

const vp = page.viewportSize();
await page.mouse.move(vp.width * 0.5, vp.height * 0.55);
await page.evaluate(() => {
  const z = window.__zp;
  z.frames = [];
  let last = performance.now();
  const tick = (t) => { if (!z.stop) { z.frames.push(t - last); last = t; requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
  z.on = true;
});
const t0 = Date.now();
// In-page, time-based: each animation frame dispatches one wheel event sized so
// zoom moves 1x -> 40x in LEG_MS and back, whatever the frame rate.
const LEG_MS = Number(process.env.LEG_MS || 4000);
const [zIn, zOut] = await page.evaluate(({ legMs, x, y }) => new Promise((done) => {
  const target = document.elementFromPoint(x, y);
  const lnRatio = Math.log(nodeGraphZoomLimits.wheelRatio || 1.12);
  const rate = Math.log(40) / legMs; // ln(zoom) per ms
  let phase = 1; let peak = 0; let last = performance.now();
  const step = (t) => {
    const dt = Math.min(100, t - last); last = t;
    const z = nodeGraphZoom();
    if (phase === 1 && z >= 40) { phase = -1; peak = z; }
    if (phase === -1 && z <= 1) { done([peak, z]); return; }
    const steps = phase * rate * dt / lnRatio;
    target.dispatchEvent(new WheelEvent("wheel", { deltaY: -steps * 100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), { legMs: LEG_MS, x: vp.width * 0.5, y: vp.height * 0.55 });
await page.waitForTimeout(300);
const res = await page.evaluate(() => {
  const z = window.__zp; z.on = false; z.stop = true;
  const f = z.frames.slice(1).filter((d) => d > 0).sort((a, b) => a - b);
  const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))] || 0;
  const total = f.reduce((s, d) => s + d, 0);
  return {
    frames: f.length, fps: f.length ? (1000 * f.length) / total : 0,
    p50: q(0.5), p90: q(0.9), p99: q(0.99), max: f[f.length - 1] || 0,
    readPixels: z.readPixels, getComputedStyle: z.gcs, getBoundingClientRect: z.gbcr,
    offsetReads: z.offset, links: z.link, linkFail: z.linkFail, linkLogs: z.linkLogs,
    who: Object.entries(z.who).sort((a, b) => b[1] - a[1]).slice(0, 25),
    glFailures: typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : [],
  };
});
const secs = (Date.now() - t0) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
console.log(`patch=${PATCH} gesture=${r1(secs)}s zoomIn=${r1(zIn)} zoomOut=${r1(zOut)}`);
console.log(`frames=${res.frames} fps=${r1(res.fps)} p50=${r1(res.p50)}ms p90=${r1(res.p90)}ms p99=${r1(res.p99)}ms max=${r1(res.max)}ms`);
console.log(`during gesture: readPixels=${res.readPixels} getComputedStyle=${res.getComputedStyle} getBoundingClientRect=${res.getBoundingClientRect} offset*=${res.offsetReads} links=${res.links} linkFail(total)=${res.linkFail}`);
if (res.who.length) for (const [k, n] of res.who) console.log(String(n).padStart(7), k);
if (res.linkLogs.length) console.log("link logs:", res.linkLogs);
if (res.glFailures.length) console.log("display GL failures:", res.glFailures);
if (errors.length) console.log("console errors:", [...new Set(errors)].slice(0, 8));
await browser.close();
if (process.env.GATE) {
  const bad = res.fps < MIN_FPS || res.readPixels || res.getComputedStyle || res.offsetReads || res.linkFail;
  console.log(bad ? "FAIL zoom perf gate" : "ok   zoom perf gate");
  process.exit(bad ? 1 : 0);
}
