// Real-browser smoke for the circuit view on the 📺 pipeline:
// spawn View Out / Screen Out / Screen Space Shader, View Out -> Aberration -> Screen Out changes the screen,
// feedback accumulates, removing Screen Out restores the normal view, shaders chain (📺 in -> 📺 out), compile errors label.
// Run: node scripts/smoke_screen_fx_browser.mjs   (env: SANDBOX_URL, OUT=dir, HEADED=1)
// Fixture: scripts/fixtures/screen_fx_aberration_feedback.json
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.SANDBOX_URL || "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const OUT = process.env.OUT || "scripts/out/screen-fx";
fs.mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/screen_fx_aberration_feedback.json", import.meta.url), "utf8"));
const fail = [];
const b = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist"] });

async function open(patch, waitNode, waitFrames = true) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
  await page.route("**/screenfx.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(patch) }));
  await page.goto(`${BASE}?pagePatch=screenfx`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction((id) => document.querySelector(`article[data-node="${id}"]`) && !document.body.classList.contains("node-boot-loading"), waitNode, { timeout: 180000 });
  await page.waitForFunction((waitFrames) => typeof nodeGraphScreenFxState !== "undefined" && (waitFrames === false || nodeGraphScreenFxState.frames > 10), waitFrames, { timeout: 30000 });
  // Picture effects (Aberration) step only while the circuit plays.
  if (waitFrames) await page.locator('button[aria-label="Play"]:visible').first().click();
  await page.waitForTimeout(1200);
  return page;
}

const sample = (page) => page.evaluate(() => {
  const st = nodeGraphScreenFxState;
  const sources = [...document.querySelectorAll("#nodeGraphWorkspace > canvas.node-gl-graph-canvas, #nodeGraphWorkspace > canvas.node-gl-graph-dots")];
  const out = { active: st.active, frames: st.frames, visible: sources.map((x) => getComputedStyle(x).visibility) };
  const c = document.getElementById("nodeScreenFxCanvas");
  if (!c || !st.active) return out;
  const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  let sum = 0; let lit = 0; let hash = 0; let chroma = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    const l = data[i] + data[i + 1] + data[i + 2];
    sum += l; if (l > 120) lit += 1;
    chroma += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    hash = (hash * 31 + (l >> 3)) >>> 0;
  }
  const n = data.length / 28;
  const luma = [];
  for (let i = 0; i < data.length; i += 4 * 53) luma.push(data[i] + data[i + 1] + data[i + 2]);
  return { ...out, mean: sum / n, lit, chroma: chroma / n, hash, luma };
});

const lumaDiff = (a, b) => { let d = 0; const n = Math.min(a.luma?.length || 0, b.luma?.length || 0); for (let i = 0; i < n; i += 1) d += Math.abs(a.luma[i] - b.luma[i]); return n ? d / n : 0; };
const brief = (x) => { const { luma, ...rest } = x; return rest; };
const edit = (page, fn) => page.evaluate(`(() => { const patch = cloneNodeGraphPatch(nodeGraphMvp.patch); (${fn})(patch); commitNodeGraphPatch(patch, { status: "smoke" }); })()`);

// 1. Spawn from the browser: none of the three is under construction, even with a stale persisted UC list.
{
  const base = JSON.parse(JSON.stringify(fixture));
  base.nodes = base.nodes.filter((n) => !["viewOut", "screenOut", "aberration"].includes(n.type));
  base.connections = base.connections.filter((c) => !/^(viewOut|screenOut|aberration)-/.test(c.sourceNode));
  const page = await open(base, base.nodes[0].id, false);
  const r = await page.evaluate(() => {
    const types = ["viewOut", "screenOut", "screenSpaceShader", "aberration"];
    const uc = Object.fromEntries(types.map((t) => [t, nodeGraphModuleTypeIsUnderConstruction(t)]));
    return { uc, ids: {} };
  });
  for (const t of ["viewOut", "screenOut", "screenSpaceShader", "aberration"]) {
    r.ids[t] = await page.evaluate((type) => showNodeGraphModule(type) || "", t);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(800);
  r.nodes = await page.evaluate(() => nodeGraphMvp.patch.nodes.map((n) => n.type));
  console.log("spawn", JSON.stringify(r));
  for (const [t, v] of Object.entries(r.uc)) if (v) fail.push(`spawn: ${t} is under construction`);
  for (const t of ["viewOut", "screenOut", "screenSpaceShader"]) if (!r.nodes.includes(t)) fail.push(`spawn: ${t} did not spawn`);
  await page.context().close();
}

// 2. View Out -> Aberration -> Screen Out.
{
  const page = await open(fixture, "screenOut-1");
  const a = await sample(page);
  await page.waitForTimeout(2500);
  const c = await sample(page);
  console.log("chain t0", JSON.stringify(brief(a)));
  console.log("chain t2.5", JSON.stringify(brief(c)));
  await page.screenshot({ path: `${OUT}/aberration-feedback.png` });
  if (!c.active) fail.push("chain: host not active");
  if (c.visible.some((v) => v !== "hidden")) fail.push("chain: source layers still visible");
  if (a.hash === c.hash) fail.push("chain: feedback did not move (same picture 2.5 s apart)");
  // Remove Screen Out: the plain circuit view again, steady frame to frame.
  await edit(page, (p) => { p.nodes = p.nodes.filter((n) => n.id !== "screenOut-1"); p.connections = p.connections.filter((x) => x.destinationNode !== "screenOut-1"); });
  await page.waitForTimeout(700);
  const n0 = await sample(page);
  await page.waitForTimeout(400);
  const n1 = await sample(page);
  console.log("no screen out", JSON.stringify({ n0: brief(n0), n1: brief(n1), chainVsNormal: lumaDiff(c, n1), steady: lumaDiff(n0, n1) }));
  await page.screenshot({ path: `${OUT}/normal-view.png` });
  if (lumaDiff(n0, n1) > 1) fail.push(`normal: picture still moving without Screen Out (${lumaDiff(n0, n1)})`);
  if (!(lumaDiff(c, n1) > 3 * Math.max(0.5, lumaDiff(n0, n1)))) fail.push(`chain: aberration did not change pixels (${lumaDiff(c, n1)})`);
  // Remove View Out too: host off, GL layers visible again.
  await edit(page, (p) => { p.nodes = p.nodes.filter((n) => n.id !== "viewOut-1"); p.connections = p.connections.filter((x) => x.sourceNode !== "viewOut-1"); });
  await page.waitForTimeout(500);
  const off = await sample(page);
  console.log("off", JSON.stringify(off));
  if (off.active || off.visible.some((v) => v === "hidden")) fail.push("off: host still owns the screen");
  await page.context().close();
}

// 3. Screen Space Shader is a picture effect: View Out -> red -> invert -> Screen Out = cyan. Compile error = label.
{
  const p = JSON.parse(JSON.stringify(fixture));
  p.nodes = p.nodes.filter((n) => n.type !== "aberration");
  p.connections = p.connections.filter((c) => c.sourceNode !== "aberration-1" && c.destinationNode !== "aberration-1");
  p.nodes.push({ id: "screenSpaceShader-1", type: "screenSpaceShader", gx: 20, gy: -60, screenSpaceShader: { source: "vec4 effect(vec2 uv) { vec4 c = scene(uv); return vec4(1.0, 0.0, 0.0, 1.0); }" } });
  p.nodes.push({ id: "screenSpaceShader-2", type: "screenSpaceShader", gx: 30, gy: -60, screenSpaceShader: { source: "vec4 effect(vec2 uv) { vec4 c = scene(uv); return vec4(1.0 - c.rgb, 1.0); }" } });
  p.connections.push(
    { sourceNode: "screenSpaceShader-2", sourcePort: "rgba", destinationNode: "screenOut-1", destinationPort: "rgba", tracePoints: [] },
    { sourceNode: "screenSpaceShader-1", sourcePort: "rgba", destinationNode: "screenSpaceShader-2", destinationPort: "rgba", tracePoints: [] },
    { sourceNode: "viewOut-1", sourcePort: "rgba", destinationNode: "screenSpaceShader-1", destinationPort: "rgba", tracePoints: [] },
  );
  const page = await open(p, "screenSpaceShader-2");
  const px = await page.evaluate(() => { const c = document.getElementById("nodeScreenFxCanvas"); return [...c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data]; });
  console.log("shader chain", JSON.stringify(px));
  await page.screenshot({ path: `${OUT}/shader-chain.png` });
  if (!(px[0] < 30 && px[1] > 220 && px[2] > 220)) fail.push(`shader chain: expected cyan, got ${px}`);
  await edit(page, (q) => { q.nodes.find((n) => n.id === "screenSpaceShader-1").screenSpaceShader = { source: "vec4 effect(vec2 uv) { return nope(uv); }" }; });
  await page.waitForTimeout(400);
  const status = await page.evaluate(() => nodeGraphScreenFxState.status.get("screenSpaceShader-1"));
  console.log("error", status);
  if (!/^line \d+:/.test(status || "")) fail.push(`error label: ${status}`);
  await page.context().close();
}

await b.close();
if (fail.length) {
  console.log("FAIL\n" + fail.join("\n"));
  process.exit(1);
}
console.log("screen fx smoke ok");
