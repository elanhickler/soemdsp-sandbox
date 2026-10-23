// IO stroke: param and signal jacks are stroked outside the cut-out, on the
// same band as the plate stroke, and the two strokes meet with no gap and no
// doubled pixel. Checked at several zooms and DPR 1 / 2 by reading the
// rendered picture. No fill or soft fade inside the mouth. Param IO is the
// rail box of a patched param (strokes outside the box, meeting the wall
// square); its pixel checks are in smoke_module_rails, this writes its crops. Server on :8090 or
// SANDBOX_URL. SHOT_DIR writes io-<kind>-dpr<d>-z<zoom>.png crops.
import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8090/";
const SHOT_DIR = process.env.SHOT_DIR || "";
let failures = 0;
const check = (ok, label, extra = "") => { if (!ok) failures++; console.log(ok ? "ok  " : "FAIL", label, extra); };
const P = { nodes: [
  { id: "pb", type: "polyBlep", gx: 40, gy: 4 },
  { id: "sw", type: "sineWavetable", gx: 4, gy: 4, params: { freq: 1, mode: 0, amp: 0.5 } },
  { id: "pp", type: "pingPongDelay", gx: 70, gy: 4 }],
  connections: [], modulations: [{ sourceNode: "sw", sourcePort: "A", destinationNode: "pp", destinationParam: "feedback" }] };
const ZOOMS = [1, 2, 4, 8];
// Rail box (param IO): corner where its top stroke meets the left wall.
async function railCase(page, pick, zoom, dpr) {
  const geo = await page.evaluate(async ({ id, zoom }) => {
    const plate = () => (nodeGraphGlGraphState.plates || []).find((p) => p.id === id);
    const box = () => nodeGraphModuleRailBoxes(null, plate(), (x) => x, (y) => y, 1)?.boxes.find((b) => b.side < 0);
    const w0 = nodeGraphGlGraphToWorld(0, 0); const w1 = nodeGraphGlGraphToWorld(100, 100);
    let b0 = null;
    for (let i = 0; i < 40 && !b0; i += 1) { await new Promise((r) => setTimeout(r, 150)); b0 = box(); }
    if (!b0) return null; const toC0 = (x, y) => [(x - w0.x) * 100 / (w1.x - w0.x), (y - w0.y) * 100 / (w1.y - w0.y)];
    const a0 = toC0(b0.x, b0.y);
    setNodeGraphZoom(zoom, { x: a0[0], y: a0[1] });
    let b = null;
    for (let i = 0; i < 40 && !b; i += 1) { await new Promise((r) => setTimeout(r, 150)); b = i > 5 ? box() : null; }
    if (!b) return null;
    const v0 = nodeGraphGlGraphToWorld(0, 0); const v1 = nodeGraphGlGraphToWorld(100, 100);
    const s = 100 / (v1.x - v0.x); const at = (x, y) => [(x - v0.x) * s, (y - v0.y) * s];
    const c = at(b.x, b.y);
    return { x: c[0], y: c[1], w: b.w * s, h: b.h * s, zoomNow: nodeGraphZoom() };
  }, { id: pick.rail, zoom });
  if (!geo) return check(false, `param dpr ${dpr} zoom ${zoom}: rail box found after zoom`);
  const half = Math.ceil(Math.max(geo.w, geo.h) * 1.4 + 10);
  const png = await page.screenshot({ clip: { x: geo.x - half, y: geo.y - half, width: half * 2, height: half * 2 } });
  const tag = `param dpr ${dpr} zoom ${geo.zoomNow.toFixed(2)}`;
  if (SHOT_DIR) fs.writeFileSync(`${SHOT_DIR}/io-param-dpr${dpr}-z${zoom}.png`, png);
  // Pixel checks for the rail box joins live in smoke_module_rails (box strokes
  // run through the border band, no border pixels in the gap). Here: the crop.
  check(png.length > 0, `${tag}: crop taken`);
}

const b = await chromium.launch({ channel: "chrome", headless: true });
// A fresh page per IO kind: a module zoomed far off screen sleeps and drops its jacks.
for (const dpr of [1, 2]) for (const want of ["param", "signal"]) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr })).newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/io-stroke.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(P) }));
  await page.goto(`${BASE}?pagePatch=io-stroke`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton"); if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => document.querySelector('article[data-node="pp"]') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { for (const id of ["nodeInteractionHelp"]) { const h = document.getElementById(id); if (h) h.style.display = "none"; } });
  // One signal jack and one plate (non-rail) param jack.
  const picks = await page.evaluate(() => {
    const all = nodeGraphGlGraphState.chrome?.jacks || [];
    // The jack with the most wall to one side (far from its neighbours).
    const room = (j) => Math.max(...all.filter((o) => o !== j && o.id === j.id && Math.abs(o.x - j.x) < 1).map((o) => Math.abs(o.y - j.y)), 0);
    const best = (list) => list.sort((a, b) => room(b) - room(a))[0];
    const sig = best(all.filter((j) => j.signal && !j.rail && j.r > 0));
    const par = best(all.filter((j) => !j.signal && !j.rail && j.r > 0));
    const out = [sig && { kind: "signal", key: sig.key }, par && { kind: "param", key: par.key }];
    // Spawn modules carry their param IO on the rails, not as plate jacks.
    const plate = (nodeGraphGlGraphState.plates || []).find((p) => p.id === "pp");
    if (!par && plate && nodeGraphModuleRailBoxes(null, plate, (x) => x, (y) => y, 1)?.boxes.some((b) => b.side < 0)) out.push({ kind: "param", rail: "pp" });
    return out.filter(Boolean);
  });
  const pick = picks.find((p) => p.kind === want);
  check(Boolean(pick), `dpr ${dpr}: a ${want} IO is drawn`, JSON.stringify(picks));
  if (pick) {
    for (const zoom of ZOOMS) {
      if (pick.rail) { await railCase(page, pick, zoom, dpr); continue; }
      const geo = await page.evaluate(async ({ key, zoom }) => {
        const find = () => (nodeGraphGlGraphState.chrome?.jacks || []).find((j) => j.key === key);
        const w0 = nodeGraphGlGraphToWorld(0, 0); const w1 = nodeGraphGlGraphToWorld(100, 100);
        const toC = (x, y) => [(x - w0.x) * 100 / (w1.x - w0.x), (y - w0.y) * 100 / (w1.y - w0.y)];
        const j0 = find(); const c0 = toC(j0.x, j0.y);
        setNodeGraphZoom(zoom, { x: c0[0], y: c0[1] });
        await new Promise((r) => setTimeout(r, 900));
        const v0 = nodeGraphGlGraphToWorld(0, 0); const v1 = nodeGraphGlGraphToWorld(100, 100);
        const s = 100 / (v1.x - v0.x);
        const at = (x, y) => [(x - v0.x) * s, (y - v0.y) * s];
        const j = find(); const c = at(j.x, j.y);
        const plate = (nodeGraphGlGraphState.plates || []).find((p) => p.id === j.id);
        const pc = at(plate.x + plate.w / 2, 0)[0];
        const stroke = Number.parseFloat(getComputedStyle(document.querySelector(`article[data-node="${j.id}"]`)).getPropertyValue("--node-module-idle-stroke-width")) || 1;
        // Sample the wall on the side away from the nearest neighbour jack.
        const near = (nodeGraphGlGraphState.chrome?.jacks || []).filter((o) => o !== j && o.id === j.id && Math.abs(o.x - j.x) < 1)
          .sort((a, b) => Math.abs(a.y - j.y) - Math.abs(b.y - j.y))[0];
        const vdir = near && near.y > j.y ? -1 : 1;
        return { vdir, x: c[0], y: c[1], r: j.r * s, square: j.square === true, inward: c[0] < pc ? 1 : -1, scale: s, stroke, zoomNow: nodeGraphZoom() };
      }, { key: pick.key, zoom });
      const half = Math.ceil(geo.r * 2.6 + 8);
      const clip = { x: geo.x - half, y: geo.y - half, width: half * 2, height: half * 2 };
      const png = await page.screenshot({ clip });
      const tag = `${pick.kind} dpr ${dpr} zoom ${geo.zoomNow.toFixed(2)}`;
      if (SHOT_DIR) fs.writeFileSync(`${SHOT_DIR}/io-${pick.kind}-dpr${dpr}-z${zoom}.png`, png);
      const res = await page.evaluate(async ({ b64, geo, half, dpr }) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
        const data = cx.getImageData(0, 0, cv.width, cv.height).data;
        const k = img.width / (half * 2);
        const L = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= cv.width || yi >= cv.height) return 0; const i = (yi * cv.width + xi) * 4; return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; };
        // Device-pixel frame centred on the jack; +u points into the plate.
        const jx = half * k - 0.5, jy = half * k - 0.5, r = geo.r * k, inv = geo.inward;
        const vd = geo.vdir; const P = (u, v) => [jx + inv * u, jy + vd * v];
        const bg = L(...P(-r * 0.5 - 6, r * 1.4));
        const fill = L(...P(r * 0.5 + 6, r * 1.4));
        const base = Math.max(bg, fill);
        // Ink (in device px) across a line: sum of coverage, scaled by the line's peak.
        const ink = (pts) => { let peak = 0; const ls = pts.map((p) => L(...p)); for (const l of ls) peak = Math.max(peak, l); const span = Math.max(1, peak - base); return { ink: ls.reduce((a, l) => a + Math.max(0, Math.min(1, (l - base) / span)), 0), peak }; };
        const line = (f, n) => Array.from({ length: n }, (_, i) => f(i));
        // Wall stroke across the wall, well away from the jack.
        const E = Math.max(1, Math.round(geo.stroke * geo.zoomNow * dpr));
        const wall = ink(line((i) => P(-E - 6 + i, r * 1.4), E + 12));
        // Ring across the cut-out at several angles from the inward axis.
        const arcs = [0, 30, 60, 80].map((deg) => {
          const a = deg * Math.PI / 180;
          if (geo.square) {
            // Square jack: lines across the inner face and the two side faces.
            const pts = deg === 0 ? line((i) => P(r - 8 + i, 0), 16) : line((i) => P(r * Math.sin(a) * 0.9, r - 8 + i), 16);
            return { deg, ...ink(pts) };
          }
          // Only across the ring (labels sit just inside the plate at low zoom).
          const sd0 = Math.max(1, Math.round(wall.ink));
          const got = ink(line((i) => { const t = r - sd0 - 2 + i * 0.5; return P(Math.cos(a) * t, Math.sin(a) * t); }, (sd0 + 4) * 2));
          return { deg, ink: got.ink * 0.5, peak: got.peak };
        });
        // Just outside the wall, walk from far toward the mouth: no dip before the corner.
        const strokeDev = Math.max(1, Math.round(wall.ink));
        let minRun = 1;
        for (let v = r * 1.4; v >= r + 1; v -= 0.5) {
          const l = L(...P(-strokeDev * 0.5, v));
          minRun = Math.min(minRun, (l - base) / Math.max(1, wall.peak - base));
        }
        // Corner: where the ring meets the wall no pixel is brighter than the
        // wall stroke (an overlap would add up).
        let cornerPeak = 0;
        for (let u = -strokeDev - 2; u <= strokeDev + 3; u += 1) for (let v = r - strokeDev - 3; v <= r + 3; v += 1) cornerPeak = Math.max(cornerPeak, L(...P(u, v)));
        // Mouth: inside the cut-out, away from the ring, is the workspace (no fill / fade).
        const mouthIn = L(...P(Math.max(0, r - strokeDev - 3) * 0.5, 0));
        // Outer half of the jack beyond the plate stroke: workspace, no ring.
        const outer = L(...P(-(strokeDev + 2 + Math.min(r * 0.5, 4)), 0));
        return { wall, arcs, minRun, cornerPeak, mouthIn, outer, bg, strokeDev };
      }, { b64: png.toString("base64"), geo, half, dpr });
      const w = res.wall.ink;
      check(w > 0.6, `${tag}: wall stroke found`, w.toFixed(2));
      for (const a of res.arcs) check(Math.abs(a.ink - w) <= 0.75, `${tag}: ring ${a.deg}° width matches the wall`, `${a.ink.toFixed(2)} vs ${w.toFixed(2)}`);
      check(res.minRun >= 0.8, `${tag}: wall stroke runs unbroken into the jack`, res.minRun.toFixed(2));
      check(res.cornerPeak <= Math.max(res.wall.peak, ...res.arcs.map((a) => a.peak)) * 1.25 + 4, `${tag}: no doubled stroke at the corner`, `${res.cornerPeak.toFixed(1)} vs ${res.wall.peak.toFixed(1)}`);
      check(Math.abs(res.mouthIn - res.bg) <= 6, `${tag}: no fill or fade in the mouth`, `${res.mouthIn.toFixed(1)} vs bg ${res.bg.toFixed(1)}`);
      check(Math.abs(res.outer - res.bg) <= 6, `${tag}: no ring outside the plate`, `${res.outer.toFixed(1)} vs bg ${res.bg.toFixed(1)}`);
    }
  }
  check(errs.length === 0, `dpr ${dpr} ${want}: no page errors`, errs.slice(0, 3).join(" | "));
  await page.close();
}
await b.close();
console.log(failures ? `${failures} failure(s)` : "all io stroke checks passed");
process.exit(failures ? 1 : 0);
