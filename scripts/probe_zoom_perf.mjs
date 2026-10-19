// ZP-7 (docs/ZOOM_PERF_PLAN.md): slow wheel zoom 1x -> 40x -> 1x on a playing
// patch, on a real GPU. Reports frame fps / p50 / p90 / max from rAF intervals
// and counts forbidden reads during the gesture: gl.readPixels,
// getComputedStyle, getBoundingClientRect, offsetWidth/offsetHeight/
// offsetLeft/offsetTop, plus GL program links (should be 0 once warm).
// Usage: node scripts/probe_zoom_perf.mjs [patch]   (server.py on :8765)
//   patch "vg-chain" = the in-memory video graph test patch (VG-9).
//   GATE=1  exit 1 when fps < MIN_FPS (default 50) or a forbidden read happens.
// Headed by default (faces are WebGL only); HEADLESS=1 only with GPU headless.
import { chromium } from "playwright";
import { vgChainPatch } from "./lib/vg-chain-patch.mjs";

const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
const PATCH = process.argv[2] || "softpop";
const MIN_FPS = Number(process.env.MIN_FPS || 50);

const browser = await chromium.launch({
  headless: Boolean(process.env.HEADLESS),
  args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
if (process.env.STACKS) await ctx.addInitScript((d) => { window.__zpStacks = d; }, Number(process.env.STACKS) || 1);
await ctx.addInitScript(() => {
  const c = { on: false, readPixels: 0, gcs: 0, gbcr: 0, offset: 0, link: 0, linkFail: 0, linkLogs: [], who: {} };
  window.__zp = c;
  // STACKS=1: tally the calling function of each forbidden read.
  const stacks = Boolean(window.__zpStacks);
  const note = (key) => {
    c[key] += 1;
    if (!stacks) return;
    const depth = Number(window.__zpStacks) || 1;
    const lines = (new Error().stack || "").split("\n").slice(3, 3 + depth);
    const k = key + " " + lines.map((l) => l.trim().replace(/^at /, "").replace(/\(?https?:\/\/[^/]+\/public\//, "").replace(/\?v=[^:]+/, "").replace(/:\d+\)?$/, "")).join(" < ");
    c.who[k] = (c.who[k] || 0) + 1;
  };
  const wrap = (proto, name, key) => {
    const f = proto[name];
    proto[name] = function (...a) { if (c.on) note(key); return f.apply(this, a); };
  };
  // Time spent in the expensive copies (ms), split by kind.
  c.ms = {};
  const timed = (proto, name, kindOf) => {
    const f = proto[name];
    proto[name] = function (...a) {
      if (!c.on) return f.apply(this, a);
      const t = performance.now();
      try { return f.apply(this, a); } finally {
        const k = kindOf ? kindOf.call(this, a) : name;
        c.ms[k] = (c.ms[k] || 0) + performance.now() - t;
      }
    };
  };
  const isGlCanvas = (src) => src instanceof HTMLCanvasElement && src.width >= 2048 && src.height >= 2048;
  timed(CanvasRenderingContext2D.prototype, "drawImage", (a) => (isGlCanvas(a[0]) ? "drawImage(4096 GL canvas)" : "drawImage(other)"));
  timed(CanvasRenderingContext2D.prototype, "putImageData");
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!P) continue;
    timed(P.prototype, "texImage2D", (a) => (a[a.length - 1] instanceof HTMLCanvasElement ? "texImage2D(canvas)" : "texImage2D(other)"));
    timed(P.prototype, "blitFramebuffer");
    wrap(P.prototype, "readPixels", "readPixels");
    timed(P.prototype, "readPixels", () => "readPixels ms");
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
if (PATCH === "vg-chain") await page.route("**/vg-chain.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: vgChainPatch() }));
await page.goto(`${BASE}?pagePatch=${PATCH}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => typeof nodeGraphZoom === "function"
  && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.locator("[data-transport-play]:visible").first().click();
await page.waitForTimeout(2500);
await page.evaluate(() => { if (typeof resetNodeGraphZoomToOne === "function") resetNodeGraphZoomToOne(); });
// HOOK=<file.js>: debug snippet evaluated in the page before the phases.
if (process.env.HOOK) {
  const fs = await import("node:fs");
  await page.evaluate(fs.readFileSync(process.env.HOOK, "utf8"));
}
// COUNT=fnA,fnB: count calls of page functions while the probe is on.
if (process.env.COUNT) {
  await page.evaluate((names) => {
    window.__zpCalls = {};
    for (const name of names) {
      const f = window[name];
      if (typeof f !== "function") continue;
      window[name] = function (...a) {
        if (window.__zp.on) window.__zpCalls[name] = (window.__zpCalls[name] || 0) + 1;
        return f.apply(this, a);
      };
    }
  }, process.env.COUNT.split(","));
}
await page.waitForTimeout(800);

const PLAY_MS = Number(process.env.PLAY_MS || 3000);
const frameStats = () => {
  const z = window.__zp; z.on = false; z.stop = true;
  const f = z.frames.slice(1).filter((d) => d > 0).sort((a, b) => a - b);
  const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))] || 0;
  const total = f.reduce((sum, d) => sum + d, 0);
  const ms = Object.entries(z.ms).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0);
  const out = { frames: f.length, fps: f.length ? (1000 * f.length) / total : 0, p50: q(0.5), p90: q(0.9), max: f[f.length - 1] || 0, readPixels: z.readPixels, gcs: z.gcs, gbcr: z.gbcr, offset: z.offset, ms, who: Object.entries(z.who).sort((x, y) => y[1] - x[1]).slice(0, 12) };
  z.ms = {}; z.readPixels = 0; z.gcs = 0; z.gbcr = 0; z.offset = 0; z.link = 0; z.who = {};
  return out;
};
await page.evaluate(() => {
  const z = window.__zp;
  z.frames = []; z.stop = false;
  let last = performance.now();
  const tick = (t) => { if (!z.stop) { z.frames.push(t - last); last = t; requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
  z.on = true;
});
await page.waitForTimeout(PLAY_MS);
const play = await page.evaluate(frameStats);
{
  const r1 = (v) => Math.round(v * 10) / 10;
  console.log(`play only ${PLAY_MS / 1000}s: fps=${r1(play.fps)} p50=${r1(play.p50)}ms p90=${r1(play.p90)}ms max=${r1(play.max)}ms readPixels=${play.readPixels} time: ${play.ms.map(([k, v]) => `${k}=${v}ms`).join(" ")}`);
  console.log(`play reads: getComputedStyle=${play.gcs} getBoundingClientRect=${play.gbcr} offset*=${play.offset}`);
  if (process.env.STACKS) for (const [k, n] of play.who) console.log(String(n).padStart(7), "play", k);
}

const vp = page.viewportSize();
await page.mouse.move(vp.width * 0.5, vp.height * 0.55);
await page.evaluate(() => {
  const z = window.__zp;
  z.frames = []; z.stop = false;
  let last = performance.now();
  const tick = (t) => { if (!z.stop) { z.frames.push(t - last); last = t; requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
  z.on = false; // counting starts with the first wheel event (below)
});
// PROFILE=1: CPU profile of the gesture, top self time by function.
let cdp = null;
if (process.env.PROFILE) {
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
}
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
    window.__zp.on = true;
    const steps = phase * rate * dt / lnRatio;
    target.dispatchEvent(new WheelEvent("wheel", { deltaY: -steps * 100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), { legMs: LEG_MS, x: vp.width * 0.5, y: vp.height * 0.55 });
// Reads while the wheel was still turning (settle not yet fired), then the
// settle that follows. The settle may read the DOM once; the gesture may not.
const mid = await page.evaluate(() => {
  const z = window.__zp;
  const out = { calls: { ...(window.__zpCalls || {}) }, gcs: z.gcs, gbcr: z.gbcr, offset: z.offset, readPixels: z.readPixels, who: Object.entries(z.who).sort((x, y) => y[1] - x[1]).slice(0, 25) };
  z.gcs = 0; z.gbcr = 0; z.offset = 0; z.who = {};
  if (window.__zpCalls) window.__zpCalls = {};
  return out;
});
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
    ms: Object.entries(z.ms).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0),
    who: Object.entries(z.who).sort((a, b) => b[1] - a[1]).slice(0, 25),
    glFailures: typeof nodeGraphDisplayGlFailures === "function" ? [...nodeGraphDisplayGlFailures().keys()] : [],
  };
});
const secs = (Date.now() - t0) / 1000;
if (cdp) {
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas || [];
  for (let i = 0; i < profile.samples.length; i += 1) {
    const n = byId.get(profile.samples[i]);
    const cf = n.callFrame;
    const k = `${cf.functionName || "(anon)"} ${String(cf.url).replace(/.*\/public\//, "").replace(/\?v=.*/, "")}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000);
  }
  const total = [...self.values()].reduce((x, y) => x + y, 0);
  console.log(`profile: ${Math.round(total)} ms sampled`);
  for (const [k, v] of [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, Number(process.env.PROFILE) > 1 ? Number(process.env.PROFILE) : 30)) {
    console.log(String(Math.round(v)).padStart(7), "ms", k);
  }
}
const r1 = (v) => Math.round(v * 10) / 10;
console.log(`patch=${PATCH} gesture=${r1(secs)}s zoomIn=${r1(zIn)} zoomOut=${r1(zOut)}`);
console.log(`frames=${res.frames} fps=${r1(res.fps)} p50=${r1(res.p50)}ms p90=${r1(res.p90)}ms p99=${r1(res.p99)}ms max=${r1(res.max)}ms`);
console.log(`settle: readPixels=${res.readPixels} getComputedStyle=${res.getComputedStyle} getBoundingClientRect=${res.getBoundingClientRect} offset*=${res.offsetReads} links=${res.links} linkFail(total)=${res.linkFail}`);
console.log(`time: ${res.ms.map(([k, v]) => `${k}=${v}ms`).join(" ")}`);
console.log(`mid-gesture only: readPixels=${mid.readPixels} getComputedStyle=${mid.gcs} getBoundingClientRect=${mid.gbcr} offset*=${mid.offset}`);
if (process.env.HOOK) console.log("hook:", JSON.stringify(await page.evaluate(() => window.__zpHook || null)));
if (Object.keys(mid.calls).length) console.log("mid-gesture calls:", JSON.stringify(mid.calls));
if (mid.who.length) for (const [k, n] of mid.who) console.log(String(n).padStart(7), "mid", k);
console.log("settle reads (after the last wheel):");
if (res.who.length) for (const [k, n] of res.who) console.log(String(n).padStart(7), k);
if (res.linkLogs.length) console.log("link logs:", res.linkLogs);
if (res.glFailures.length) console.log("display GL failures:", res.glFailures);
if (errors.length) console.log("console errors:", [...new Set(errors)].slice(0, 8));
await browser.close();
if (process.env.GATE) {
  // The settle after the last wheel may read once; the gesture itself may not.
  const bad = res.fps < MIN_FPS || res.readPixels || mid.readPixels || mid.gcs || mid.gbcr || mid.offset || res.linkFail;
  console.log(bad ? "FAIL zoom perf gate" : "ok   zoom perf gate");
  process.exit(bad ? 1 : 0);
}
