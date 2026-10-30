// Smoke: colour emoji in the shared GL text path (lib/visual/gl-line-renderer.js).
// Gates: grapheme segmentation (pictographs, ZWJ families, flags, keycaps,
// VS16; default-text symbols stay coverage glyphs); each emoji bakes ONCE at
// its exact base size (drawn px in face-backing device px, rounded) keyed by
// emoji + base px; reuse across frames and faces; nothing re-bakes on
// workspace zoom (the backing never scales by zoom, and the renderer has no
// zoom input); steady state allocates no segments and bakes nothing; emoji
// quads are drawn 1:1 from a premultiplied NEAREST colour page inline with the
// coverage glyphs; atlas cells keep a mip-safe gutter (no neighbour bleed).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
const REL = "public/lib/visual/gl-line-renderer.js";
const src = fs.readFileSync(path.join(root, REL), "utf8");

// ---- fakes -----------------------------------------------------------------
const glLog = { texSub: [], texImage: 0, params: [], draws: [], premult: [] };
const gl = new Proxy({
  TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, NEAREST: 4, LINEAR: 5, LINEAR_MIPMAP_LINEAR: 6, TEXTURE_MIN_FILTER: 7,
  TEXTURE_MAG_FILTER: 8, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 9, UNPACK_FLIP_Y_WEBGL: 10, ONE: 11, ONE_MINUS_SRC_ALPHA: 12,
  SRC_ALPHA: 13, TRIANGLES: 14, ARRAY_BUFFER: 15, FRAMEBUFFER: 16, COLOR_BUFFER_BIT: 17, BLEND: 18, FLOAT: 19,
  VERTEX_SHADER: 20, FRAGMENT_SHADER: 21, COMPILE_STATUS: 22, LINK_STATUS: 23, ZERO: 24,
  createShader: () => ({}), createProgram: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true,
  createTexture: () => ({ id: Math.random() }), createBuffer: () => ({}), getAttribLocation: () => 0, getUniformLocation: () => ({}),
  isContextLost: () => false,
  texImage2D: () => { glLog.texImage += 1; },
  texSubImage2D: (t, l, x, y, w, h) => { glLog.texSub.push({ x, y, w, h }); },
  texParameteri: (t, k, v) => glLog.params.push([k, v]),
  pixelStorei: (k, v) => { if (k === 9) glLog.premult.push(v); },
  uniform1f: (loc, v) => { glLog.mode = v; },
  drawArrays: (m, f, n) => glLog.draws.push({ mode: glLog.mode, n }),
}, { get: (t, k) => (k in t ? t[k] : () => {}) });
const fontPx = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 10);
const isEmojiFont = (font) => /Emoji/.test(font);
const makeCtx = (cv) => ({
  font: "10px x",
  measureText(t) { const px = fontPx(this.font); return { width: isEmojiFont(this.font) ? px * 1.0 : [...t].length * px * 0.6 }; },
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  setTransform() {}, clearRect() {}, fillText() {}, drawImage() {},
});
const document = { createElement: () => { const cv = { width: 300, height: 150 }; cv.getContext = () => makeCtx(cv); return cv; } };
const devCanvas = { width: 2048, height: 2048 };
const sandbox = { document, Intl, console, nodeGraphPictureDevice: () => ({ gl, canvas: devCanvas }), Float32Array, Map, Math };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: REL });
const R = sandbox;
const face = () => ({ width: 200, height: 100, getContext: () => ({ setTransform() {}, drawImage() {} }), closest: () => null });

// ---- segmentation ----------------------------------------------------------
const seg = (t) => R.nodeGraphGlLinesTextSegments(t).map((x) => `${x.emoji ? "E" : "T"}:${x.text}`);
const CASES = [
  ["🎸", ["E:🎸"]],
  ["Go 🎸!", ["T:Go ", "E:🎸", "T:!"]],
  ["👨‍👩‍👧", ["E:👨‍👩‍👧"]],
  ["🇯🇵🇫🇷", ["E:🇯🇵", "E:🇫🇷"]],
  ["1️⃣", ["E:1️⃣"]],
  ["❤️ vs ❤", ["E:❤️", "T: vs ❤"]],
  ["👍🏽", ["E:👍🏽"]],
  ["© 2026 ™ ↔ 0.91 dB", ["T:© 2026 ™ ↔ 0.91 dB"]],
];
for (const [t, want] of CASES) {
  const got = seg(t);
  gate(JSON.stringify(got) === JSON.stringify(want), `segments ${JSON.stringify(t)} -> ${got.join(" | ")}`);
}

// ---- exact-size bake, reuse, no re-bake ------------------------------------
const draw = (text, px, scale) => {
  const b = R.nodeGraphGlLinesBegin(face(), [0, 0, 0, 1], { scale });
  R.nodeGraphGlLinesText(b, text, 50, 50, { px });
  const quads = [];
  for (let i = 0; i < b.tn; i += 48) quads.push({ x0: b.tdata[i], y0: b.tdata[i + 1], x1: b.tdata[i + 8], y1: b.tdata[i + 17] });
  const runs = b.texts.map((r) => ({ color: r.color, n: (r.end - r.start) / 48 }));
  R.nodeGraphGlLinesEnd(b);
  return { quads, runs };
};
const s0 = R.nodeGraphGlLinesEmojiStats();
const first = draw("Go 🎸", 14.3, 1.5);   // 14.3 css px x DPR 1.5 = 21.45 -> 21 device px
const s1 = R.nodeGraphGlLinesEmojiStats();
gate(s1.bakes - s0.bakes === 1 && s1.keys.includes("🎸|21"), `first draw bakes once at the exact base size (keys ${s1.keys.join(",")})`);
const up = glLog.texSub[glLog.texSub.length - 1];
// Cell = advance + pad x 2, by 1.25 em + pad x 2 + 0.45 em headroom (colour emoji draw above the em box).
gate(up && up.w === 21 + 4 && up.h === Math.ceil(21 * 1.25) + 4 + Math.ceil(21 * 0.45), `upload is the exact-size cell (${up?.w}x${up?.h}), not a larger bake`);
const emojiRun = first.runs.find((r) => r.color);
gate(first.runs.length === 2 && emojiRun?.n === 1 && first.runs[0].color === false, "emoji draws inline after the coverage glyphs (2 runs)");
const eq = first.quads[first.quads.length - 1];
gate(eq.x1 - eq.x0 === up.w && eq.y1 - eq.y0 === up.h && Number.isInteger(eq.x0) && Number.isInteger(eq.y0), "emoji quad is 1:1 device px on whole pixels");
gate(glLog.premult.includes(true), "emoji upload is premultiplied");
gate(glLog.params.some(([k, v]) => k === 7 && v === 4) && glLog.params.some(([k, v]) => k === 8 && v === 4), "colour page samples NEAREST (zoom pixelates, no smoothing)");

const segMiss0 = R.nodeGraphGlLinesEmojiStats().segmentMisses;
const texSub0 = glLog.texSub.length;
for (let f = 0; f < 200; f += 1) draw("Go 🎸", 14.3, 1.5);
const s2 = R.nodeGraphGlLinesEmojiStats();
gate(s2.bakes === s1.bakes && glLog.texSub.length === texSub0, "200 steady frames: no re-bake, no upload");
gate(s2.segmentMisses === segMiss0, "200 steady frames: segmentation served from cache (no per-frame segment allocation)");
// Another face / string with the same emoji at the same base size reuses the entry.
draw("🎸 On", 14, 1.5);  // 21 device px again
gate(R.nodeGraphGlLinesEmojiStats().bakes === s1.bakes, "same emoji + base px on another face reuses the bake");
// Workspace zoom: the face backing stays layout css x DPR (never x zoom), so a
// zoomed face issues the identical draw. The camera hands zoom to the GPU as a
// transform only; the emoji bake path (the emoji* functions) never sees it.
const emojiBakeCode = [...src.matchAll(/\n  function (emoji\w*)\([^)]*\) \{[\s\S]*?\n  \}/g)].map((m) => m[0]).join("\n");
gate(emojiBakeCode.includes("function emojiEntry") && !/zoom/i.test(emojiBakeCode.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")), "emoji bake code has no zoom input (zoom can not drive a bake)");
for (const z of [0.5, 1, 2, 4, 8]) draw("Go 🎸", 14.3, 1.5);
gate(R.nodeGraphGlLinesEmojiStats().bakes === s1.bakes, "zoom sweep 0.5x..8x: nothing re-bakes");
// A different base size (e.g. a 2x canvas tile layout) is its own one-time bake.
draw("Go 🎸", 28.6, 1.5);
const s3 = R.nodeGraphGlLinesEmojiStats();
gate(s3.bakes === s1.bakes + 1 && s3.keys.includes("🎸|43"), "different base size bakes its own entry once");
draw("Go 🎸", 28.6, 1.5);
gate(R.nodeGraphGlLinesEmojiStats().bakes === s3.bakes, "...and is reused after");
gate(!/LRU|evict/i.test(src), "no size-keyed eviction / LRU");
// A not-yet-laid-out face (sub-4 px) never rasterizes.
const t0 = R.nodeGraphGlLinesEmojiStats().bakes;
draw("🎸", 1, 1);
gate(R.nodeGraphGlLinesEmojiStats().bakes === t0, "sub-4 px (unlaid-out box) does not bake");
// Plain text never touches the emoji path.
const m0 = R.nodeGraphGlLinesEmojiStats();
draw("Cutoff 0.91", 14, 1.5);
const m1 = R.nodeGraphGlLinesEmojiStats();
gate(m1.bakes === m0.bakes && m1.segmentMisses === m0.segmentMisses, "plain text skips segmentation and the colour atlas");
// measureText includes the emoji advance.
const w = R.nodeGraphGlLinesMeasureText("ab🎸", 20);
gate(Math.abs(w - (2 * 20 * 0.6 + 20)) < 1e-6, `measureText adds the emoji advance (${w})`);
// Coverage atlas gutter (mip-safe; fixes neighbour-glyph specks at small px).
gate(/const TEXT_GUTTER = (\d+)/.test(src) && Number(/const TEXT_GUTTER = (\d+)/.exec(src)[1]) >= 32, "coverage atlas cells keep a >= 32 px gutter");

console.log(failures ? `\n${failures} failure(s)` : "\nall GL text emoji gates passed");
process.exit(failures ? 1 : 0);
