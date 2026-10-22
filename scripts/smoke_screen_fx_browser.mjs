// Real-browser Screen Space Shader smoke: compile, draw over the whole circuit area, chain order, View Feedback.
// Run: node scripts/smoke_screen_fx_browser.mjs   (env: OUT=dir HEADED=1)
// Fixture: scripts/fixtures/screen_fx_view_feedback.json (View Feedback -> Screen Space Shader that zooms and fades).
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.SANDBOX_URL || "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const OUT = process.env.OUT || "scripts/out/screen-fx";
fs.mkdirSync(OUT, { recursive: true });
const feedbackPatch = JSON.parse(fs.readFileSync(new URL("./fixtures/screen_fx_view_feedback.json", import.meta.url), "utf8"));
const fail = [];

function shakePatch() {
  const d = JSON.parse(JSON.stringify(feedbackPatch));
  d.nodes = d.nodes.filter((n) => n.type !== "viewFeedback" && n.type !== "screenSpaceShader");
  d.connections = d.connections.filter((c) => !/^(viewFeedback|screenSpaceShader)-/.test(c.sourceNode) && !/^(viewFeedback|screenSpaceShader)-/.test(c.destinationNode));
  // Default source = the built-in shake example.
  d.nodes.push({ id: "screenSpaceShader-1", type: "screenSpaceShader", gx: 30, gy: -60 });
  return d;
}

const b = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED, args: ["--ignore-gpu-blocklist"] });

async function open(patch) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
  page.on("console", (m) => { if (/error|fail/i.test(m.text())) console.log("console:", m.text().slice(0, 200)); });
  await page.route("**/screenfx.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(patch) }));
  await page.goto(`${BASE}?pagePatch=screenfx`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => document.querySelector('article[data-node="screenSpaceShader-1"]') && !document.body.classList.contains("node-boot-loading"), null, { timeout: 180000 });
  await page.waitForFunction(() => typeof nodeGraphScreenFxState !== "undefined" && nodeGraphScreenFxState.frames > 10, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  return page;
}

// Overlay pixels: mean luma and a coarse hash, read from the 2D overlay canvas.
const sample = (page) => page.evaluate(() => {
  const c = document.getElementById("nodeScreenFxCanvas");
  if (!c) return null;
  const ctx = c.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0; let lit = 0; let hash = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    const l = data[i] + data[i + 1] + data[i + 2];
    sum += l; if (l > 120) lit += 1;
    hash = (hash * 31 + (l >> 3)) >>> 0;
  }
  const st = nodeGraphScreenFxState;
  const hidden = [...document.querySelectorAll("#nodeGraphWorkspace > canvas[data-screen-fx-source]")].map((x) => getComputedStyle(x).visibility);
  return { width, height, mean: sum / (data.length / 28), lit, hash, active: st.active, frames: st.frames, status: [...st.status.entries()], hidden };
});

// 1. Shake: compiles, draws the whole circuit area, moves over time.
{
  const page = await open(shakePatch());
  const a = await sample(page);
  await page.waitForTimeout(37);
  const c = await sample(page);
  console.log("shake", JSON.stringify({ a, c }));
  if (!a?.active) fail.push("shake: host not active");
  if (!(a?.width > 100 && a?.height > 100)) fail.push("shake: overlay not sized to the workspace");
  if (!(a?.lit > 50)) fail.push("shake: overlay shows no circuit");
  if (!a?.hidden.length || a.hidden.some((v) => v !== "hidden")) fail.push("shake: source canvases still visible");
  if (!String(a?.status?.[0]?.[1] || "").startsWith("ok")) fail.push(`shake: status ${JSON.stringify(a?.status)}`);
  if (a?.hash === c?.hash) fail.push("shake: picture did not move between frames");
  await page.screenshot({ path: `${OUT}/shake.png` });
  // 2. Compile error: plain label, no throw, previous picture keeps drawing.
  await page.evaluate(() => {
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes.find((n) => n.id === "screenSpaceShader-1").screenSpaceShader = { source: "vec4 effect(vec2 uv) { return nope(uv); }" };
    commitNodeGraphPatch(patch, { status: "smoke" });
  });
  await page.waitForTimeout(400);
  const e = await page.evaluate(() => ({
    status: nodeGraphScreenFxState.status.get("screenSpaceShader-1"),
    label: document.querySelector('.node-screen-space-shader-body[data-node="screenSpaceShader-1"] [data-screen-space-shader-status]')?.textContent || "",
    frames: nodeGraphScreenFxState.frames,
    popups: document.querySelectorAll("dialog[open], .node-toast:not([hidden])").length,
  }));
  console.log("error", JSON.stringify(e));
  if (!/^line \d+:/.test(e.status || "")) fail.push(`error: status ${e.status}`);
  if (e.label && e.label !== e.status) fail.push(`error: face label ${e.label}`);
  // 3. Chain: two shaders run in patch order (red-only, then invert -> cyan-ish).
  await page.evaluate(() => {
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes.find((n) => n.id === "screenSpaceShader-1").screenSpaceShader = { source: "vec4 effect(vec2 uv) { vec4 c = scene(uv); return vec4(1.0, 0.0, 0.0, 1.0); }" };
    patch.nodes.push({ id: "screenSpaceShader-2", type: "screenSpaceShader", gx: 30, gy: -40, screenSpaceShader: { source: "vec4 effect(vec2 uv) { vec4 c = scene(uv); return vec4(1.0 - c.rgb, 1.0); }" } });
    commitNodeGraphPatch(patch, { status: "smoke" });
  });
  await page.waitForTimeout(500);
  const ch = await page.evaluate(() => {
    const c = document.getElementById("nodeScreenFxCanvas");
    const p = c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return { px: [...p], programs: [...nodeGraphScreenFxState.programs.keys()] };
  });
  console.log("chain", JSON.stringify(ch));
  if (!(ch.px[0] < 30 && ch.px[1] > 220 && ch.px[2] > 220)) fail.push(`chain: expected cyan (red then invert), got ${ch.px}`);
  await page.context().close();
}

// 4. View Feedback: previous frame on the 📺 out, shader zooms and fades it.
{
  const page = await open(feedbackPatch);
  const info = await page.evaluate(() => ({
    read: Boolean(nodeGraphPictureRead("screenSpaceShader-1", "Feedback")),
    views: nodeGraphScreenFxState.views.filter(Boolean).length,
    status: nodeGraphScreenFxState.status.get("screenSpaceShader-1"),
  }));
  const f = await sample(page);
  console.log("feedback", JSON.stringify({ info, f }));
  if (!info.read) fail.push("feedback: no picture on the Feedback inlet");
  if (info.views !== 2) fail.push("feedback: ping-pong views missing");
  if (!String(info.status || "").startsWith("ok")) fail.push(`feedback: status ${info.status}`);
  await page.screenshot({ path: `${OUT}/feedback.png` });
  // Feedback on vs the same frame without it: the trails add light.
  const off = await page.evaluate(async () => {
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.connections = patch.connections.filter((c) => c.sourceNode !== "viewFeedback-1");
    commitNodeGraphPatch(patch, { status: "smoke" });
    await new Promise((r) => setTimeout(r, 600));
    return true;
  });
  const g = await sample(page);
  console.log("feedback off", JSON.stringify(g));
  if (off && !(f.mean > g.mean)) fail.push(`feedback: trails add no light (${f.mean} vs ${g.mean})`);
  await page.context().close();
}

await b.close();
if (fail.length) {
  console.log("FAIL\n" + fail.join("\n"));
  process.exit(1);
}
console.log("screen fx smoke ok");
