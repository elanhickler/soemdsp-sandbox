// ES-5 (docs/ENGINE_STATE_DISPLAY_PLAN.md): with the engine STOPPED, every
// param face paints, every Music Player page switches, and dragging a module
// keeps faces painted. Read-only: non-GET requests are aborted.
// Usage: node scripts/smoke_engine_state_stopped_faces.mjs   (server.py on :8765)
// Needs a real GPU (faces are WebGL only): runs headed by default; HEADLESS=1
// only for a machine with GPU headless support.
import { chromium } from "playwright";
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8765/";
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const browser = await chromium.launch({ headless: Boolean(process.env.HEADLESS), args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const errors = [];
async function open(patch) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => errors.push(`${patch}: ${e.message || e}`));
  await page.route("**/*", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  await page.goto(`${BASE}?pagePatch=${patch}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof scopePaintEngineState === "function"
    && typeof nodeGraphFacePaintKindFor === "function"
    && document.querySelectorAll("article[data-node-type]").length > 1, null, { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}
const paramFaces = () => {
  // GL-composited faces keep their picture in a GPU texture (ZP-2), not the
  // hidden 2D bitmap: read that when it exists. 16x16 RGBA grid.
  const px16 = (c) => {
    const gpu = typeof nodeGraphSharedGlFacePixels === "function" ? nodeGraphSharedGlFacePixels(c) : null;
    if (gpu) {
      const d = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
        const sx = Math.min(gpu.width - 1, Math.floor((x + 0.5) * gpu.width / 16));
        const sy = Math.min(gpu.height - 1, Math.floor((y + 0.5) * gpu.height / 16));
        const si = (sy * gpu.width + sx) * 4; const di = (y * 16 + x) * 4;
        d[di] = gpu.data[si]; d[di + 1] = gpu.data[si + 1]; d[di + 2] = gpu.data[si + 2]; d[di + 3] = gpu.data[si + 3];
      }
      return d;
    }
    const o = document.createElement("canvas"); o.width = 16; o.height = 16;
    const g = o.getContext("2d"); g.drawImage(c, 0, 0, 16, 16);
    return g.getImageData(0, 0, 16, 16).data;
  };
  const lit = (c) => {
    const d = px16(c); let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n += 1;
    return n;
  };
  const out = [];
  for (const a of document.querySelectorAll("article[data-node-type]")) {
    const slot = nodeGraphModuleScopeState?.slots?.get(a.dataset.node);
    const kind = slot ? nodeGraphFacePaintKindFor(slot) : nodeGraphFacePaintKindFor(a);
    if (kind !== "param") continue;
    const cs = [...a.querySelectorAll("canvas")].filter((c) => c.width > 1 && c.height > 1 && !c.closest("[hidden]"));
    if (!cs.length) continue;
    let best = 0;
    for (const c of cs) { try { best = Math.max(best, lit(c)); } catch (_e) { /* tainted */ } }
    out.push({ id: a.dataset.node, lit: best });
  }
  return { state: scopePaintEngineState(), faces: out };
};

// 1. Param faces paint on a stopped patch load.
{
  const page = await open("softpop");
  const r = await page.evaluate(paramFaces);
  gate(r.state === "stopped", `softpop loads stopped (${r.state})`);
  gate(r.faces.length >= 3, `softpop has param faces (${r.faces.length})`);
  for (const f of r.faces) gate(f.lit > 0, `param face painted while stopped: ${f.id} (${f.lit})`);

  // 3. Drag a module while stopped: it moves and faces stay painted.
  // Grab the module by its title strip (top 8 px of the article).
  const box = await page.locator("article[data-node-type='slewLimiter']").first().boundingBox();
  const before = box?.x;
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + 28, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const after = await page.evaluate(() => document.querySelector("article[data-node-type='slewLimiter']")?.getBoundingClientRect().x);
  gate(box && Math.abs(after - before) > 20, `module drags while stopped (${before} -> ${after})`);
  const r2 = await page.evaluate(paramFaces);
  for (const f of r2.faces) gate(f.lit > 0, `param face still painted after drag: ${f.id} (${f.lit})`);

  // 4. Buffer modules added while stopped (and one while paused) get a face
  // canvas and a painted (opaque) plate at once, like after Stop.
  const addAndProbe = (types) => page.evaluate(async (list) => {
    // GL-composited faces keep their picture in a GPU texture (ZP-2), not the
    // hidden 2D bitmap: read that when it exists. 16x16 RGBA grid.
    const px16 = (c) => {
      const gpu = typeof nodeGraphSharedGlFacePixels === "function" ? nodeGraphSharedGlFacePixels(c) : null;
      if (gpu) {
        const d = new Uint8Array(16 * 16 * 4);
        for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
          const sx = Math.min(gpu.width - 1, Math.floor((x + 0.5) * gpu.width / 16));
          const sy = Math.min(gpu.height - 1, Math.floor((y + 0.5) * gpu.height / 16));
          const si = (sy * gpu.width + sx) * 4; const di = (y * 16 + x) * 4;
          d[di] = gpu.data[si]; d[di + 1] = gpu.data[si + 1]; d[di + 2] = gpu.data[si + 2]; d[di + 3] = gpu.data[si + 3];
        }
        return d;
      }
      const o = document.createElement("canvas"); o.width = 16; o.height = 16;
      const g = o.getContext("2d"); g.drawImage(c, 0, 0, 16, 16);
      return g.getImageData(0, 0, 16, 16).data;
    };
    const before = new Set([...document.querySelectorAll("article[data-node-type]")].map((a) => a.dataset.node));
    // Keep every new module on screen (off-screen faces are culled).
    let x = 40;
    for (const t of list) {
      showNodeGraphModule(t, { x, y: 620 }, {});
      x += 190;
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 1200));
    const out = [];
    for (const a of document.querySelectorAll("article[data-node-type]")) {
      if (before.has(a.dataset.node)) continue;
      const slot = nodeGraphModuleScopeState?.slots?.get(a.dataset.node);
      const kind = slot ? nodeGraphFacePaintKindFor(slot) : nodeGraphFacePaintKindFor(a);
      const cs = [...a.querySelectorAll("canvas")].filter((c) => c.width > 1 && c.height > 1 && !c.closest("[hidden]"));
      let opaque = 0;
      for (const c of cs) {
        try {
          const d = px16(c); let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n += 1;
          opaque = Math.max(opaque, n);
        } catch (_e) { /* ignore */ }
      }
      out.push({ type: a.dataset.nodeType, kind, slot: Boolean(slot), canvases: cs.length, opaque, state: scopePaintEngineState() });
    }
    return out;
  }, types);
  const added = await addAndProbe(["lineBurnOscilloscope", "numberReadout", "softpopOscillator", "timeQuantizer"]);
  gate(added.length >= 4, `buffer modules added while stopped (${added.length})`);
  for (const a of added) {
    if (!a.slot || a.kind === "param") continue;
    gate(a.state === "stopped" && a.canvases > 0 && a.opaque >= 200, `stopped spawn has a painted plate: ${a.type} [${a.kind}] canvases=${a.canvases} opaque=${a.opaque}/256`);
  }
  await page.click("#nodeTransportPlay");
  await page.waitForTimeout(2500);
  await page.click("#nodeTransportPause");
  await page.waitForTimeout(800);
  const pausedAdd = await addAndProbe(["lineBurnOscilloscope", "numberReadout"]);
  for (const a of pausedAdd) {
    if (!a.slot || a.kind === "param") continue;
    gate(a.state === "paused" && a.canvases > 0 && a.opaque >= 200, `paused spawn has a painted plate: ${a.type} [${a.kind}] canvases=${a.canvases} opaque=${a.opaque}/256`);
  }
  await page.close();
}

// 2. Every Music Player page switches while stopped, and a real click on the
// wave face's playlist label opens the playlist.
{
  const page = await open("musicplayer");
  const faces = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-music-player-face]")]
    .filter((b) => b.tagName === "BUTTON").map((b) => b.dataset.musicPlayerFace))]);
  gate(faces.length >= 3, `music player page buttons found (${faces.join(",")})`);
  for (const face of faces) {
    await page.click(`button[data-music-player-face='${face}']`);
    await page.waitForTimeout(400);
    const r = await page.evaluate((want) => {
      const pages = [...document.querySelectorAll("[data-music-player-page]")];
      const shown = pages.filter((p) => !p.hidden).map((p) => p.dataset.musicPlayerPage);
      const el = pages.find((p) => p.dataset.musicPlayerPage === want);
      return { shown, h: el ? el.getBoundingClientRect().height : 0, state: scopePaintEngineState() };
    }, face);
    gate(r.state === "stopped" && r.shown.length === 1 && r.shown[0] === face && r.h > 10,
      `page '${face}' shows alone while stopped (shown=${r.shown.join(",")}, h=${Math.round(r.h)})`);
  }
  // Real mouse click on the GL-drawn "playlist" label (top-left of the wave
  // face). The canvas is visibility:hidden under the GPU graph, so this only
  // works when the face (section) handles the press.
  await page.click("button[data-music-player-face='wave']");
  await page.waitForTimeout(500);
  const lbl = await page.evaluate(() => {
    const s = document.querySelector("article[data-node-type='audioPlayer'] .node-sample-waveform-display");
    const c = s?.querySelector(".node-sample-waveform-canvas");
    if (s && !s._sampleWaveHudHits && typeof drawNodeGraphSampleWaveformDisplay === "function") drawNodeGraphSampleWaveformDisplay(s);
    const h = s?._sampleWaveHudHits?.playlist;
    if (!c || !h) return null;
    const r = c.getBoundingClientRect();
    const k = r.width / (c.clientWidth || r.width);
    const x = r.left + ((h.l + h.r) / 2) * k;
    const y = r.top + ((h.t + h.b) / 2) * k;
    const top = document.elementFromPoint(x, y);
    return { x, y, top: top ? top.tagName + "." + String(top.className).split(" ")[0] : "" };
  });
  gate(Boolean(lbl), `playlist HUD label found on the wave face${lbl ? ` (top element ${lbl.top})` : ""}`);
  if (lbl) {
    await page.mouse.click(lbl.x, lbl.y);
    await page.waitForTimeout(500);
    const face = await page.evaluate(() => {
      const pages = [...document.querySelectorAll("[data-music-player-page]")];
      return pages.filter((p) => !p.hidden).map((p) => p.dataset.musicPlayerPage).join(",");
    });
    gate(face === "pl", `real click on the playlist label opens the playlist page (shown=${face})`);
  }  await page.close();
}

gate(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("smoke_engine_state_stopped_faces ok");
