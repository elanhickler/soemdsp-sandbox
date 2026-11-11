// Browser: synthetic Web MIDI still works as 7-bit (onmidimessage / handler).
//   node scripts/smoke_midi_webmidi.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch (_e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not answer at ${url}`);
}

const port = process.env.SANDBOX_URL ? null : await freePort();
const base = process.env.SANDBOX_URL || `http://127.0.0.1:${port}/`;
let server;
if (!process.env.SANDBOX_URL) {
  server = spawn("python", ["server.py", "--port", String(port)], { cwd: ROOT, stdio: "inherit" });
  await waitForServer(base, 20000);
}

const browser = await chromium.launch({
  headless: true,
  channel: process.env.CHROME_CHANNEL || "chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.setDefaultTimeout(120000);
await page.goto(`${base}?boot=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof handleNodeGraphMidiKeyboardMessage === "function"
  && typeof createNodeGraphPatchNode === "function"
  && typeof routeNodeGraphMidiCcBytes === "function" && typeof SoemdspMidiCc !== "undefined", null, { timeout: 180000 });

await page.waitForFunction(() => Array.isArray(window.nodeGraphMvp?.patch?.nodes), null, { timeout: 60000 });
const result = await page.evaluate(() => {
  const midiCreated = typeof createNodeGraphPatchNode === "function"
    ? createNodeGraphPatchNode("keyboardController")
    : null;
  const ccCreated = createNodeGraphPatchNode("midiCc");
  if (typeof commitNodeGraphPatch === "function") {
    try { commitNodeGraphPatch(); } catch (e) { /* keep going; nodes may already be on the patch */ }
  }
  const nodes = window.nodeGraphMvp?.patch?.nodes;
  let ccNode = Array.isArray(nodes)
    ? nodes.find((n) => n && (n.type === "midiCc" || n.type === "midiLag"))
    : (ccCreated && typeof ccCreated === "object" ? ccCreated : null);
  if (!ccNode && Array.isArray(nodes)) {
    ccNode = { id: "midi-cc-test", type: "midiCc", params: {} };
    nodes.push(ccNode);
  }
  if (ccNode) {
    ccNode.params = Object.assign({}, ccNode.params, { channel: 0, cc: 1, amplitude: 1, learn: 0, offset: 0 });
  }

  window.nodeGraphMvp.midiInputEnabled = true;
  window.nodeGraphMvp.midiKeyboardInputId = "synth-test";
  handleNodeGraphMidiKeyboardMessage({
    currentTarget: { id: "synth-test" },
    data: new Uint8Array([0x90, 60, 100]),
  });
  const vel = Number(window.nodeGraphMvp.midiKeyboardSignal?.velocity);
  const held = window.nodeGraphMvp.midiKeyboardHeldNotes?.get?.(60);

  routeNodeGraphMidiCcBytes(0xB0, 1, 64);
  const offset = Number(ccNode?.params?.offset);

  // high-res ingest path (plugin/host), should keep a non-7-bit value
  if (typeof ingestNodeGraphHostMidiBytes === "function") {
    ingestNodeGraphHostMidiBytes(0x90, 72, 64, 2, 32768 / 65535, true);
  }
  const hrVel = Number(window.nodeGraphMvp.midiKeyboardSignal?.velocity);
  if (typeof routeNodeGraphMidiCcHighRes === "function") {
    routeNodeGraphMidiCcHighRes(0xB0, 1, 0x80000000 / 0xFFFFFFFF);
  }
  const hrOffset = Number(ccNode?.params?.offset);

  return {
    vel,
    held,
    offset,
    hrVel,
    hrOffset,
    hasApi: typeof SoemdspMidiCc !== "undefined",
    ccType: ccNode && ccNode.type,
    ccParams: ccNode && ccNode.params,
    expectedVel: 100 / 127,
    expectedOffset: 64 / 128,
    expectedHrVel: 32768 / 65535,
    expectedHrOffset: 0x80000000 / 0xFFFFFFFF,
    midiNode: !!(midiCreated || (Array.isArray(nodes) && nodes.some((n) => n && n.type === "keyboardController"))),
    ccNode: !!ccNode,
  };
});

await browser.close();
if (server) server.kill();

function close(a, b, label, eps = 1e-9) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${label}: got ${a}, expected ${b}`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.midiNode || !result.ccNode) throw new Error("failed to add MIDI / MIDI CC modules: " + JSON.stringify(result));
close(result.vel, result.expectedVel, "web midi velocity 100/127");
close(result.held, result.expectedVel, "held note 0-1");
close(result.offset, result.expectedOffset, "web midi CC 64/128");
close(result.hrVel, result.expectedHrVel, "host high-res velocity");
close(result.hrOffset, result.expectedHrOffset, "host high-res CC");
console.log("ok browser Web MIDI 7-bit and high-res ingest", result);
