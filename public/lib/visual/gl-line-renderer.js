// Shared WebGL line / fill / image / text renderer for module faces (the one
// drawing interface; docs/WEBGL_DISPLAY_PLAN.md).
//
// Draws on the shared picture device (public/lib/visual/picture-device.js,
// one hidden WebGL2 context) and blits the result into the face's own 2D
// canvas. The face canvas keeps the shared sizing path (backing = layout css
// x devicePixelRatio, never x workspace zoom) and the node-display-canvas
// marker class (display-canvas.js), so the one styles.css
// .pixelated-canvas-zoom .node-display-canvas rule pixelates it above 2.5x zoom.
//
// Coordinates are device px unless begin() got { scale }: then x/y, halfPx,
// feather and text px are CSS px and multiplied by scale (pass the face
// pixelRatio).
//
// Lines are shader-expanded quads (capsules): each vertex carries its local
// position along/across the segment, the fragment shader takes the distance
// to the segment and fades it over `feather` px past `halfPx`, exactly like
// the Sabrina Reverb CLAP plugin's kLineFrag:
//   a = 1 - smoothstep(halfPx, halfPx + feather, dist)
// so thickness never depends on fractional pixel position. Fills are the
// same quads with an infinite halfPx (solid). A zero-length segment is a
// round dot of radius halfPx.
//
// Draw order per frame: images (under), quads, text (over).
//
// Text: nodeGraphGlLinesText draws from one shared glyph atlas per font
// (white coverage baked once at 64 px with a 2D canvas inside this shared lib,
// uploaded as an RGBA texture with mipmaps; tinted in the shader). Cells are
// separated by a TEXT_GUTTER so mip levels never sample a neighbour glyph.
//
// Color emoji: a text run that contains emoji grapheme clusters
// (Extended_Pictographic, ZWJ sequences, flags, keycaps, VS16) draws each
// emoji from a shared colour atlas, inline with the coverage glyphs, with the
// browser's advance and the same baseline. Each emoji is rasterized ONCE at
// its base size: the drawn size in face-backing device px (font px x
// pixelRatio; the backing is never x workspace zoom), cached by
// emoji + base px, uploaded premultiplied with NEAREST filtering. Zoom never
// re-bakes: zooming scales those pixels and the display pixelation rule
// applies (no sharpening). Steady state allocates nothing and bakes nothing.
//
// RGBA picture out: when the face's module has a cable on its `rgba` / TV out
// (picture-device nodeGraphPictureHasConsumer), end() renders the batch into
// that node's picture texture (transparent clear, premultiplied alpha), then
// shows the face from that texture over the plate colour. Picture textures on
// the wire are premultiplied RGBA (opaque sources are unchanged by this).
//
// No WebGL2 (no device, context lost, shader failure): begin() returns null and
// the caller shows a plain black square (nodeGraphGlLinesFillBlack). No 2D drawing.
// Context loss: picture-device drops the device; the next begin() sees a new
// gl and rebuilds the programs and atlases.

(function initNodeGraphGlLineRenderer(global) {
  const MAX_DIM = 4096;
  const FLOATS = 11; // pos2, local2, len1, half1, feather1, rgba4
  const VS = `
attribute vec2 position;
attribute vec2 local;
attribute float segLen;
attribute float halfPx;
attribute float feather;
attribute vec4 colour;
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying vec4 vColour;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  vLocal = local;
  vLen = segLen;
  vHalf = halfPx;
  vFeather = feather;
  vColour = colour;
}
`;
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying vec4 vColour;
void main() {
  float u = vLocal.x;
  float d = u < 0.0 ? length(vLocal) : (u > vLen ? length(vec2(u - vLen, vLocal.y)) : abs(vLocal.y));
  float a = 1.0 - smoothstep(vHalf, vHalf + max(vFeather, 1e-4), d);
  gl_FragColor = vec4(vColour.rgb, vColour.a * a);
}
`;
  // Textured quads: images (mode 0), tinted glyph coverage (mode 1),
  // premultiplied picture present (mode 2).
  const IMG_VS = `
attribute vec2 position;
attribute vec2 uv;
attribute vec4 vtint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  vUv = uv;
  vTint = vtint;
}
`;
  const IMG_FS = `
precision mediump float;
uniform sampler2D tex;
uniform float alpha;
uniform vec4 tint;
uniform float mode;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 c = texture2D(tex, vUv);
  if (mode > 2.5) {
    // Premultiplied colour emoji x tint alpha.
    gl_FragColor = c * vTint.a;
  } else if (mode > 1.5) {
    gl_FragColor = c;
  } else if (mode > 0.5) {
    // Per-vertex tint (batched glyphs / tinted sprites) x coverage.
    gl_FragColor = vec4(vTint.rgb, vTint.a * c.a);
  } else {
    gl_FragColor = vec4(c.rgb, c.a * alpha);
  }
}
`;
  const TEXT_BAKE_PX = 64;
  const TEXT_WHITE = Object.freeze([1, 1, 1, 1]);
  const TEXT_PAD = 6;
  // Empty texels between atlas cells: 64 px bake at 1/8 draw (mip 3) still
  // keeps 4 empty texels between glyphs, so no neighbour bleed.
  const TEXT_GUTTER = 32;
  // Colour emoji atlas.
  const EMOJI_SHEET = 1024;
  const EMOJI_PAD = 2;
  const EMOJI_MAX_PAGES = 4;
  const EMOJI_FAMILY = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
  // Cheap gate (no allocation): only text that may hold an emoji is segmented.
  const EMOJI_HINT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{200D}\u{FE0F}\u{20E3}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}-\u{23FF}\u{24C2}\u{25AA}-\u{25FE}]/u;
  const EMOJI_CLUSTER = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}|\u{200D}/u;
  const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|\u{FE0F}|\u{20E3}|\u{200D}|\p{Regional_Indicator}/u;
  const SEGMENT_CACHE_MAX = 512;
  const segmentCache = new Map();
  const emojiStats = { bakes: 0, uploads: 0, segmentMisses: 0, pages: 0, entries: 0, dropped: 0 };
  const TEXT_ASCENT = 0.8;   // of px, baseline from em top
  const TEXT_DEFAULT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
  const TEXT_BASE_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~—–°·×±µƒ♯♭";
  let state = null;
  let failedGl = null;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "compile failed";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  function link(gl, vs, fs) {
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    const program = gl.createProgram();
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "link failed");
    }
    return program;
  }

  function ensure() {
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl || null;
    if (!gl || typeof gl.createShader !== "function" || gl.isContextLost?.()) return null;
    if (state && state.gl === gl) return state;
    if (failedGl === gl) return null;
    try {
      const program = link(gl, VS, FS);
      const imgProgram = link(gl, IMG_VS, IMG_FS);
      state = {
        gl,
        dev,
        program,
        buf: gl.createBuffer(),
        attribs: ["position", "local", "segLen", "halfPx", "feather", "colour"].map((n) => gl.getAttribLocation(program, n)),
        imgProgram,
        imgBuf: gl.createBuffer(),
        imgTex: gl.createTexture(),
        imgAttribs: ["position", "uv", "vtint"].map((n) => gl.getAttribLocation(imgProgram, n)),
        // Cached textures for static image sources ({ cache: true }), keyed by source.
        texCache: new WeakMap(),
        tpool: [],
        imgTexLoc: gl.getUniformLocation(imgProgram, "tex"),
        imgAlphaLoc: gl.getUniformLocation(imgProgram, "alpha"),
        imgTintLoc: gl.getUniformLocation(imgProgram, "tint"),
        imgModeLoc: gl.getUniformLocation(imgProgram, "mode"),
        atlases: new Map(),
        // Colour emoji: pages [{ texture, x, y, rowH }], entries "emoji|px".
        emoji: { pages: [], entries: new Map(), canvas: null, ctx: null },
        pool: [],
      };
      return state;
    } catch (error) {
      failedGl = gl;
      state = null;
      console.error("[gl-line-renderer] shader failed; faces show black", error);
      return null;
    }
  }

  /**
   * Start a frame for a face canvas (device px, y down).
   * options: { scale } -> coordinates in CSS px; { publishNodeId } -> force the
   * node id used for the rgba picture out (default: the canvas's .dsp-node).
   * @returns {object|null} batch, or null -> caller fills black.
   */
  function nodeGraphGlLinesBegin(canvas, clearRgba = [0, 0, 0, 1], options = {}) {
    if (!canvas) return null;
    const w = Math.max(1, canvas.width | 0);
    const h = Math.max(1, canvas.height | 0);
    if (w > MAX_DIM || h > MAX_DIM) return null;
    const s = ensure();
    if (!s) return null;
    const scale = Number(options?.scale) > 0 ? Number(options.scale) : 1;
    return {
      s, canvas, w, h, clear: clearRgba, data: s.pool.pop() || new Float32Array(16384), n: 0, images: [], texts: [], blend: "alpha", scale,
      // Glyph quads for every text call: pos2 uv2 rgba4 per vertex, one draw per atlas run.
      tdata: s.tpool.pop() || new Float32Array(4096), tn: 0,
      publishNodeId: options?.publishNodeId,
      // transparent: overlay faces; the 2D blit target is cleared first.
      transparent: options?.transparent === true,
    };
  }

  function push(batch, x, y, lu, lv, len, half, feather, c) {
    // Vertices go straight into a pooled Float32Array (no per-frame JS arrays).
    let d = batch.data;
    let i = batch.n;
    if (i + FLOATS > d.length) {
      const grown = new Float32Array(d.length * 2);
      grown.set(d);
      batch.data = d = grown;
    }
    d[i] = (x / batch.w) * 2 - 1; d[i + 1] = 1 - (y / batch.h) * 2;
    d[i + 2] = lu; d[i + 3] = lv; d[i + 4] = len; d[i + 5] = half; d[i + 6] = feather;
    d[i + 7] = c[0]; d[i + 8] = c[1]; d[i + 9] = c[2]; d[i + 10] = c.length > 3 ? c[3] : 1;
    batch.n = i + FLOATS;
  }

  /** Solid axis-aligned rect. */
  function nodeGraphGlLinesRect(batch, x, y, w, h, rgba) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.scale || 1;
    if (k !== 1) { x *= k; y *= k; w *= k; h *= k; }
    const big = 1e6;
    const q = [[x, y], [x + w, y], [x, y + h], [x + w, y], [x + w, y + h], [x, y + h]];
    for (const [px, py] of q) push(batch, px, py, 0, 0, 0, big, 0, rgba);
  }

  /** Solid triangle (fills, areas). */
  function nodeGraphGlLinesTriangle(batch, x0, y0, x1, y1, x2, y2, rgba) {
    if (!batch) return;
    const k = batch.scale || 1;
    const big = 1e6;
    push(batch, x0 * k, y0 * k, 0, 0, 0, big, 0, rgba);
    push(batch, x1 * k, y1 * k, 0, 0, 0, big, 0, rgba);
    push(batch, x2 * k, y2 * k, 0, 0, 0, big, 0, rgba);
  }

  /** Solid area between a polyline [x0,y0,x1,y1,...] and the horizontal line y = baseY. */
  function nodeGraphGlLinesFillUnder(batch, points, baseY, rgba) {
    if (!batch || !points || points.length < 4) return;
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2]; const y0 = points[i - 1];
      const x1 = points[i]; const y1 = points[i + 1];
      nodeGraphGlLinesTriangle(batch, x0, y0, x1, y1, x0, baseY, rgba);
      nodeGraphGlLinesTriangle(batch, x1, y1, x1, baseY, x0, baseY, rgba);
    }
  }

  /**
   * Capsule segment (x0,y0)-(x1,y1): solid core halfPx, then `feather` px of
   * smoothstep fade (Sabrina kLineFrag). Round ends/joins.
   */
  function nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba) {
    if (!batch) return;
    const k = batch.scale || 1;
    if (k !== 1) { x0 *= k; y0 *= k; x1 *= k; y1 *= k; halfPx *= k; feather *= k; }
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-6 ? dx / len : 0;
    const uy = len > 1e-6 ? dy / len : 1;
    const nx = -uy;
    const ny = ux;
    const r = Math.max(0, halfPx) + Math.max(0, feather);
    const corner = (along, across) => [
      x0 + ux * along + nx * across,
      y0 + uy * along + ny * across,
      along,
      across,
    ];
    const a = corner(-r, -r);
    const b = corner(len + r, -r);
    const c = corner(-r, r);
    const d = corner(len + r, r);
    for (const v of [a, b, c, b, d, c]) push(batch, v[0], v[1], v[2], v[3], len, halfPx, feather, rgba);
  }

  /** Round dot (zero-length capsule) of radius r. */
  function nodeGraphGlLinesDot(batch, x, y, r, feather, rgba) {
    nodeGraphGlLinesSegment(batch, x, y, x, y, r, feather, rgba);
  }

  /** Polyline as capsules (one continuous outline; joins are round). */
  function nodeGraphGlLinesPolyline(batch, points, halfPx, feather, rgba) {
    if (!batch || !points || points.length < 4) return;
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2]; const y0 = points[i - 1];
      const x1 = points[i]; const y1 = points[i + 1];
      if (x0 === x1 && y0 === y1 && i > 2) continue;
      nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba);
    }
  }

  /**
   * Textured quad (image blit). source: { data: Uint8Array RGBA, width, height }
   * or any TexImageSource. options: { nearest = true, alpha = 1, additive = false }. Drawn under
   * the line/rect quads, in call order.
   */
  function nodeGraphGlLinesImage(batch, source, x, y, w, h, options = {}) {
    if (!batch || !source || !(w > 0) || !(h > 0)) return;
    const k = batch.scale || 1;
    batch.images.push({
      source,
      x: x * k, y: y * k, w: w * k, h: h * k,
      nearest: options.nearest !== false,
      alpha: Number.isFinite(options.alpha) ? options.alpha : 1,
      // tint [r,g,b,a]: draw the source's alpha as coverage of this colour
      // (white masks, e.g. TraceDotSprite shape sprites).
      tint: Array.isArray(options.tint) ? options.tint : null,
      // cache: upload once per source object (static pictures / baked sprites).
      cache: options.cache === true,
      additive: options.additive === true,
    });
  }

  /**
   * Upload a source (e.g. a face canvas about to be resized) to a GL texture
   * NOW, so a later batch can draw the old pixels. Pass the result to
   * nodeGraphGlLinesImage; the texture is deleted after that batch draws it,
   * unless { keep: true } (then free it with nodeGraphGlLinesReleaseSnapshot).
   */
  function nodeGraphGlLinesSnapshot(source, options = {}) {
    const s = ensure();
    if (!s || !source) return null;
    const sw = source.naturalWidth || source.width || 0;
    const sh = source.naturalHeight || source.height || 0;
    if (!(sw > 0) || !(sh > 0)) return null;
    const gl = s.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (_error) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(texture);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { glSnapshot: true, keep: options?.keep === true, texture, width: sw, height: sh };
  }

  function nodeGraphGlLinesReleaseSnapshot(snapshot) {
    if (!snapshot?.glSnapshot || !snapshot.texture) return;
    const s = ensure();
    if (s) s.gl.deleteTexture(snapshot.texture);
    snapshot.texture = null;
  }

  // ---- text atlas ---------------------------------------------------------
  function atlasKey(family, weight) {
    return `${weight}|${family}`;
  }

  function bakeAtlas(s, family, weight, chars) {
    const doc = global.document;
    if (!doc?.createElement) return null;
    const cv = doc.createElement("canvas");
    const cx = cv.getContext?.("2d");
    if (!cx || typeof cx.measureText !== "function") return null;
    const font = `${weight} ${TEXT_BAKE_PX}px ${family}`;
    cx.font = font;
    const list = [...new Set([...chars])];
    const cellH = Math.ceil(TEXT_BAKE_PX * 1.25) + TEXT_PAD * 2;
    const sheetW = 1024;
    const glyphs = new Map();
    let x = 0;
    let y = 0;
    for (const ch of list) {
      const adv = Math.max(1, cx.measureText(ch).width || TEXT_BAKE_PX * 0.6);
      const gw = Math.ceil(adv) + TEXT_PAD * 2;
      if (x + gw > sheetW) { x = 0; y += cellH + TEXT_GUTTER; }
      glyphs.set(ch, { x, y, w: gw, h: cellH, adv });
      x += gw + TEXT_GUTTER;
    }
    const sheetH = y + cellH;
    cv.width = sheetW;
    cv.height = sheetH;
    cx.font = font;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.fillStyle = "#fff";
    cx.clearRect(0, 0, sheetW, sheetH);
    for (const [ch, g] of glyphs) {
      cx.fillText(ch, g.x + TEXT_PAD, g.y + TEXT_PAD + TEXT_BAKE_PX * TEXT_ASCENT);
    }
    const gl = s.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, glyphs, sheetW, sheetH, chars: list.join("") };
  }

  /** Shared glyph atlas for a font (grows when new characters show up). */
  function nodeGraphGlLinesTextAtlas(family = TEXT_DEFAULT_FAMILY, weight = 600, text = "") {
    const s = ensure();
    if (!s) return null;
    const key = atlasKey(family, weight);
    let atlas = s.atlases.get(key);
    const missing = [...String(text)].filter((ch) => !atlas?.glyphs.has(ch));
    if (!atlas || missing.length) {
      const next = bakeAtlas(s, family, weight, (atlas?.chars || TEXT_BASE_CHARS) + missing.join(""));
      if (!next) return null;
      if (atlas?.texture) s.gl.deleteTexture(atlas.texture);
      atlas = next;
      s.atlases.set(key, atlas);
    }
    return atlas;
  }

  // ---- colour emoji ---------------------------------------------------------
  /**
   * Grapheme segments of `text`: frozen [{ text, emoji }]. Cached per string,
   * so a steady face re-uses the same array (no per-frame allocation).
   */
  function nodeGraphGlLinesTextSegments(text) {
    const str = String(text ?? "");
    let segs = segmentCache.get(str);
    if (segs) return segs;
    emojiStats.segmentMisses += 1;
    const out = [];
    const Seg = global.Intl?.Segmenter;
    const clusters = Seg
      ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(str), (x) => x.segment)
      : (str.match(/\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|[#*0-9])(?:\u{FE0F}|\u{20E3}|\p{Emoji_Modifier})*(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})*)*|[\s\S]/gu) || []);
    let plain = "";
    for (const c of clusters) {
      // Emoji presentation only: default-text symbols (©, ™, ↔, bare ❤, digits)
      // stay coverage glyphs unless a VS16 / keycap / ZWJ / flag asks for colour.
      const isEmoji = EMOJI_CLUSTER.test(c) && EMOJI_PRESENTATION.test(c);
      if (isEmoji) {
        if (plain) { out.push(Object.freeze({ text: plain, emoji: false })); plain = ""; }
        out.push(Object.freeze({ text: c, emoji: true }));
      } else {
        plain += c;
      }
    }
    if (plain) out.push(Object.freeze({ text: plain, emoji: false }));
    segs = Object.freeze(out);
    if (segmentCache.size >= SEGMENT_CACHE_MAX) segmentCache.clear();
    segmentCache.set(str, segs);
    return segs;
  }

  function emojiRaster(s) {
    const e = s.emoji;
    if (e.ctx) return e.ctx;
    const doc = global.document;
    const cv = doc?.createElement?.("canvas");
    const cx = cv?.getContext?.("2d", { willReadFrequently: false });
    if (!cx) return null;
    e.canvas = cv;
    e.ctx = cx;
    return cx;
  }

  function emojiPage(s, w, h) {
    const e = s.emoji;
    const gl = s.gl;
    let page = e.pages[e.pages.length - 1];
    if (page) {
      if (page.x + w > EMOJI_SHEET) { page.x = 0; page.y += page.rowH; page.rowH = 0; }
      if (page.y + h <= EMOJI_SHEET) return page;
    }
    if (e.pages.length >= EMOJI_MAX_PAGES || w > EMOJI_SHEET || h > EMOJI_SHEET) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, EMOJI_SHEET, EMOJI_SHEET, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Exact-size bake drawn 1:1; zoom pixelates (display policy), never smooths.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    page = { texture, x: 0, y: 0, rowH: 0 };
    e.pages.push(page);
    emojiStats.pages = e.pages.length;
    return page;
  }

  /**
   * Colour atlas entry for one emoji at base size `px` (integer device px).
   * Baked once; the same key is never rasterized again.
   */
  function emojiEntry(s, emoji, px) {
    const e = s.emoji;
    // Two-level lookup (emoji -> base px) so a cache hit builds no key string.
    let bySize = e.entries.get(emoji);
    let entry = bySize?.get(px);
    if (entry !== undefined) return entry;
    if (!bySize) { bySize = new Map(); e.entries.set(emoji, bySize); }
    if (px < 4) {
      // Unlaid-out / sub-legible box: advance only, never a texture bake.
      entry = Object.freeze({ page: null, adv: px, px, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
      bySize.set(px, entry);
      return entry;
    }
    const cx = emojiRaster(s);
    if (!cx) return null;
    cx.font = `${px}px ${EMOJI_FAMILY}`;
    const adv = Math.max(1, cx.measureText(emoji).width || px);
    const w = Math.ceil(adv) + EMOJI_PAD * 2;
    const h = Math.ceil(px * 1.25) + EMOJI_PAD * 2;
    const page = emojiPage(s, w, h);
    if (!page) {
      // Atlas full: keep the advance, draw nothing (cached, so no retry loop).
      emojiStats.dropped += 1;
      entry = Object.freeze({ page: null, adv, px, w, h, u0: 0, v0: 0, u1: 0, v1: 0 });
      bySize.set(px, entry);
      return entry;
    }
    const cv = e.canvas;
    if (cv.width < w || cv.height < h) {
      cv.width = Math.max(cv.width, w);
      cv.height = Math.max(cv.height, h);
    }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.font = `${px}px ${EMOJI_FAMILY}`;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.fillStyle = "#000";
    cx.fillText(emoji, EMOJI_PAD, EMOJI_PAD + px * TEXT_ASCENT);
    const gl = s.gl;
    const pixels = cx.getImageData(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, page.x, page.y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    emojiStats.bakes += 1;
    emojiStats.uploads += 1;
    entry = Object.freeze({
      page, adv, px, w, h,
      u0: page.x / EMOJI_SHEET, v0: page.y / EMOJI_SHEET,
      u1: (page.x + w) / EMOJI_SHEET, v1: (page.y + h) / EMOJI_SHEET,
    });
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    bySize.set(px, entry);
    emojiStats.entries += 1;
    return entry;
  }

  /** Base bake size: drawn px in face-backing device px, rounded. */
  function emojiBasePx(devicePx) {
    return Math.max(1, Math.round(devicePx));
  }

  /** Counters for smokes / GPU checks (bakes never move at steady state or on zoom). */
  function nodeGraphGlLinesEmojiStats() {
    const keys = [];
    if (state) for (const [emoji, bySize] of state.emoji.entries) for (const px of bySize.keys()) keys.push(`${emoji}|${px}`);
    return { ...emojiStats, keys };
  }

  /** Width of `text` at `px` (same units as the batch coordinates). */
  function nodeGraphGlLinesMeasureText(text, px, family = TEXT_DEFAULT_FAMILY, weight = 600) {
    const str = String(text ?? "");
    const atlas = nodeGraphGlLinesTextAtlas(family, weight, str);
    if (!atlas) return str.length * px * 0.6;
    const g = px / TEXT_BAKE_PX;
    if (!EMOJI_HINT.test(str)) {
      let adv = 0;
      for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
      return adv * g;
    }
    let width = 0;
    for (const seg of nodeGraphGlLinesTextSegments(str)) {
      if (seg.emoji) {
        const entry = emojiEntry(state, seg.text, emojiBasePx(px));
        width += entry ? entry.adv * (px / entry.px) : px;
      } else {
        for (const ch of seg.text) width += (atlas.glyphs.get(ch)?.adv || 0) * g;
      }
    }
    return width;
  }

  /**
   * Text at (x, y). options: { px = 12, rgba = white, align = "center"
   * (left|center|right), baseline = "middle" (top|middle|alphabetic|bottom),
   * maxWidth (squeeze horizontally like canvas fillText), family, weight }.
   * Drawn over the quads.
   */
  function nodeGraphGlLinesText(batch, text, x, y, options = {}) {
    const str = String(text ?? "");
    if (!batch || !str) return;
    const family = options.family || TEXT_DEFAULT_FAMILY;
    const weight = options.weight || 600;
    const atlas = nodeGraphGlLinesTextAtlas(family, weight, str);
    if (!atlas) return;
    const k = batch.scale || 1;
    const px = Math.max(1, Number(options.px) || 12) * k;
    const g = px / TEXT_BAKE_PX;
    const segs = EMOJI_HINT.test(str) ? nodeGraphGlLinesTextSegments(str) : null;
    let hasEmoji = false;
    if (segs) for (let i = 0; i < segs.length; i += 1) if (segs[i].emoji) { hasEmoji = true; break; }
    const emojiPx = emojiBasePx(px);
    let width = 0;
    if (hasEmoji) {
      for (const seg of segs) {
        if (seg.emoji) width += emojiEntry(batch.s, seg.text, emojiPx)?.adv || 0;
        else for (const ch of seg.text) width += (atlas.glyphs.get(ch)?.adv || 0) * g;
      }
    } else {
      let adv = 0;
      for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
      width = adv * g;
    }
    let squeeze = 1;
    const maxW = Number(options.maxWidth) * k;
    if (maxW > 0 && width > maxW) { squeeze = maxW / width; width = maxW; }
    const align = options.align || "center";
    const base = options.baseline || "middle";
    let pen = x * k - (align === "center" ? width * 0.5 : (align === "right" ? width : 0));
    let baseline = y * k;
    if (base === "middle") baseline += px * (TEXT_ASCENT - 0.5);
    else if (base === "top") baseline += px * TEXT_ASCENT;
    else if (base === "bottom") baseline -= px * (1 - TEXT_ASCENT);
    const sx = g * squeeze;
    const c = options.rgba || TEXT_WHITE;
    const cr = c[0]; const cg = c[1]; const cb = c[2]; const ca = c.length > 3 ? c[3] : 1;
    if (!hasEmoji) {
      pen = pushGlyphs(batch, atlas, str, pen, baseline, g, sx, cr, cg, cb, ca);
      return;
    }
    for (const seg of segs) {
      if (!seg.emoji) {
        pen = pushGlyphs(batch, atlas, seg.text, pen, baseline, g, sx, cr, cg, cb, ca);
        continue;
      }
      const entry = emojiEntry(batch.s, seg.text, emojiPx);
      if (!entry) continue;
      if (entry.page) {
        // 1:1 device px (squeezed only by maxWidth); colour is the bake, tint alpha only.
        const run = textRun(batch, entry.page.texture, true);
        // Whole device px so NEAREST samples the bake texel-for-pixel.
        const x0 = Math.round(pen - EMOJI_PAD * squeeze);
        const y0 = Math.round(baseline - (EMOJI_PAD + entry.px * TEXT_ASCENT));
        pushTextQuad(batch, x0, y0, x0 + entry.w * squeeze, y0 + entry.h,
          entry.u0, entry.v0, entry.u1, entry.v1, 1, 1, 1, ca);
        run.end = batch.tn;
      }
      pen += entry.adv * squeeze;
    }
  }

  /** Current run for a texture (consecutive same-texture quads share one draw). */
  function textRun(batch, texture, color) {
    let run = batch.texts.length ? batch.texts[batch.texts.length - 1] : null;
    if (!run || run.texture !== texture) {
      run = { texture, color, start: batch.tn, end: batch.tn };
      batch.texts.push(run);
    }
    return run;
  }

  function pushGlyphs(batch, atlas, str, pen, baseline, g, sx, cr, cg, cb, ca) {
    const run = textRun(batch, atlas.texture, false);
    for (const ch of str) {
      const gl = atlas.glyphs.get(ch);
      if (!gl) continue;
      const x0 = pen - TEXT_PAD * sx;
      const y0 = baseline - (TEXT_PAD + TEXT_BAKE_PX * TEXT_ASCENT) * g;
      const x1 = x0 + gl.w * sx;
      const y1 = y0 + gl.h * g;
      const u0 = gl.x / atlas.sheetW; const u1 = (gl.x + gl.w) / atlas.sheetW;
      const v0 = gl.y / atlas.sheetH; const v1 = (gl.y + gl.h) / atlas.sheetH;
      pushTextQuad(batch, x0, y0, x1, y1, u0, v0, u1, v1, cr, cg, cb, ca);
      pen += gl.adv * sx;
    }
    run.end = batch.tn;
    return pen;
  }

  function pushTextVertex(d, i, x, y, u, v, r, g, b, a) {
    d[i] = x; d[i + 1] = y; d[i + 2] = u; d[i + 3] = v;
    d[i + 4] = r; d[i + 5] = g; d[i + 6] = b; d[i + 7] = a;
  }

  function pushTextQuad(batch, x0, y0, x1, y1, u0, v0, u1, v1, r, g, b, a) {
    let d = batch.tdata;
    const i = batch.tn;
    if (i + 48 > d.length) {
      const grown = new Float32Array(d.length * 2);
      grown.set(d);
      batch.tdata = d = grown;
    }
    pushTextVertex(d, i, x0, y0, u0, v0, r, g, b, a);
    pushTextVertex(d, i + 8, x1, y0, u1, v0, r, g, b, a);
    pushTextVertex(d, i + 16, x0, y1, u0, v1, r, g, b, a);
    pushTextVertex(d, i + 24, x1, y0, u1, v0, r, g, b, a);
    pushTextVertex(d, i + 32, x1, y1, u1, v1, r, g, b, a);
    pushTextVertex(d, i + 40, x0, y1, u0, v1, r, g, b, a);
    batch.tn = i + 48;
  }

  // ---- textured quad drawing ---------------------------------------------
  /** Growable per-state Float32Array (power-of-two growth; never shrinks). */
  function scratch(s, key, n) {
    let a = s[key];
    if (!a || a.length < n) {
      let cap = 1024;
      while (cap < n) cap *= 2;
      a = new Float32Array(cap);
      s[key] = a;
    }
    return a;
  }

  function drawTextured(s, w, h, verts, mode) {
    const gl = s.gl;
    const n = verts.length / 4;
    const out = scratch(s, "imgScratch", verts.length);
    for (let i = 0; i < n; i += 1) {
      out[i * 4] = (verts[i * 4] / w) * 2 - 1;
      out[i * 4 + 1] = 1 - (verts[i * 4 + 1] / h) * 2;
      out[i * 4 + 2] = verts[i * 4 + 2];
      out[i * 4 + 3] = verts[i * 4 + 3];
    }
    gl.uniform1f(s.imgModeLoc, mode);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.imgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, verts.length), gl.STREAM_DRAW);
    const [pl, ul, tl] = s.imgAttribs;
    if (pl >= 0) { gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 16, 0); }
    if (ul >= 0) { gl.enableVertexAttribArray(ul); gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 16, 8); }
    if (tl >= 0) gl.vertexAttrib4f(tl, 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    if (pl >= 0) gl.disableVertexAttribArray(pl);
    if (ul >= 0) gl.disableVertexAttribArray(ul);
  }

  /** Tinted textured triangles: data = pos2 uv2 rgba4 per vertex (device px). */
  function drawTexturedTinted(s, w, h, data, start, end, mode = 1) {
    const gl = s.gl;
    const len = end - start;
    if (len <= 0) return;
    const out = scratch(s, "tintScratch", len);
    for (let i = 0; i < len; i += 8) {
      const j = start + i;
      out[i] = (data[j] / w) * 2 - 1;
      out[i + 1] = 1 - (data[j + 1] / h) * 2;
      out[i + 2] = data[j + 2]; out[i + 3] = data[j + 3];
      out[i + 4] = data[j + 4]; out[i + 5] = data[j + 5]; out[i + 6] = data[j + 6]; out[i + 7] = data[j + 7];
    }
    gl.uniform1f(s.imgModeLoc, mode);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.imgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, len), gl.STREAM_DRAW);
    const [pl, ul, tl] = s.imgAttribs;
    if (pl >= 0) { gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 32, 0); }
    if (ul >= 0) { gl.enableVertexAttribArray(ul); gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 32, 8); }
    if (tl >= 0) { gl.enableVertexAttribArray(tl); gl.vertexAttribPointer(tl, 4, gl.FLOAT, false, 32, 16); }
    gl.drawArrays(gl.TRIANGLES, 0, len / 8);
    if (pl >= 0) gl.disableVertexAttribArray(pl);
    if (ul >= 0) gl.disableVertexAttribArray(ul);
    if (tl >= 0) gl.disableVertexAttribArray(tl);
  }

  function useTexturedProgram(s) {
    const gl = s.gl;
    gl.useProgram(s.imgProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(s.imgTexLoc, 0);
  }

  function drawImages(batch, alphaDst) {
    const { s, w, h } = batch;
    const gl = s.gl;
    useTexturedProgram(s);
    gl.bindTexture(gl.TEXTURE_2D, s.imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const im of batch.images) {
      const src = im.source;
      if (src.glSnapshot) {
        gl.bindTexture(gl.TEXTURE_2D, src.texture);
      } else {
        let cached = im.cache ? s.texCache.get(src) : null;
        const sw = src.naturalWidth || src.width || 0;
        const sh = src.naturalHeight || src.height || 0;
        if (cached && (cached.w !== sw || cached.h !== sh || cached.src !== (src.currentSrc || src.src || ""))) {
          gl.deleteTexture(cached.texture);
          s.texCache.delete(src);
          cached = null;
        }
        if (im.cache && !cached) {
          cached = { texture: gl.createTexture(), w: sw, h: sh, src: src.currentSrc || src.src || "", fresh: true };
          s.texCache.set(src, cached);
        }
        gl.bindTexture(gl.TEXTURE_2D, cached ? cached.texture : s.imgTex);
        if (!cached || cached.fresh) {
          if (src.data && src.width > 0 && src.height > 0) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          }
          if (cached) cached.fresh = false;
        }
      }
      // Per-image blend: normal over, or additive ({ additive: true }).
      gl.blendFuncSeparate(gl.SRC_ALPHA, im.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      const f = im.nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1f(s.imgAlphaLoc, im.alpha);
      const x0 = im.x; const x1 = im.x + im.w; const y0 = im.y; const y1 = im.y + im.h;
      if (im.tint) {
        const t = im.tint;
        const q = scratch(s, "quadScratch", 48);
        const a = (t.length > 3 ? t[3] : 1) * im.alpha;
        pushTextVertex(q, 0, x0, y0, 0, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 8, x1, y0, 1, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 16, x0, y1, 0, 1, t[0], t[1], t[2], a);
        pushTextVertex(q, 24, x1, y0, 1, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 32, x1, y1, 1, 1, t[0], t[1], t[2], a);
        pushTextVertex(q, 40, x0, y1, 0, 1, t[0], t[1], t[2], a);
        drawTexturedTinted(s, w, h, q, 0, 48);
      } else {
        drawTextured(s, w, h, [x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y0, 1, 0, x1, y1, 1, 1, x0, y1, 0, 1], 0);
      }
      if (src.glSnapshot && src.texture && !src.keep) {
        gl.deleteTexture(src.texture);
        src.texture = null;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function drawTexts(batch, alphaDst) {
    const { s, w, h } = batch;
    const gl = s.gl;
    useTexturedProgram(s);
    // One draw call per texture run (glyph atlas or colour emoji page).
    for (const t of batch.texts) {
      if (t.end <= t.start) continue;
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      if (t.color) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      drawTexturedTinted(s, w, h, batch.tdata, t.start, t.end, t.color ? 3 : 1);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Draw images, quads, text into the bound framebuffer with the given blend funcs. */
  function drawContent(batch, blend, alphaDst) {
    const { s } = batch;
    const gl = s.gl;
    const colourDst = blend === "add" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA;
    gl.enable(gl.BLEND);
    if (batch.images.length) {
      drawImages(batch, alphaDst);
    }
    const count = batch.n / FLOATS;
    if (count > 0) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
      gl.useProgram(s.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.n), gl.STREAM_DRAW);
      const sizes = [2, 2, 1, 1, 1, 4];
      let off = 0;
      for (let i = 0; i < sizes.length; i += 1) {
        const loc = s.attribs[i];
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, FLOATS * 4, off * 4);
        }
        off += sizes[i];
      }
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const loc of s.attribs) if (loc >= 0) gl.disableVertexAttribArray(loc);
    }
    if (batch.texts.length) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      drawTexts(batch, alphaDst);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function publishNodeIdFor(batch) {
    if (batch.publishNodeId !== undefined) return String(batch.publishNodeId || "");
    const host = batch.canvas?.closest?.(".dsp-node, [data-node]");
    return String(host?.dataset?.node || "");
  }

  /**
   * Draw the batch and blit it into the face's 2D canvas.
   * blend "add" = GL_SRC_ALPHA, GL_ONE (Sabrina plugin); "alpha" = normal over.
   * @returns {boolean} false -> caller fills black.
   */
  function nodeGraphGlLinesEnd(batch, blend = "alpha") {
    if (!batch) return false;
    try {
      return endBatch(batch, blend);
    } finally {
      // Hand the vertex array back for the next face (pool stays tiny).
      if (batch.data && batch.s.pool.length < 8) batch.s.pool.push(batch.data);
      if (batch.tdata && batch.s.tpool.length < 8) batch.s.tpool.push(batch.tdata);
      batch.data = null;
      batch.tdata = null;
      batch.n = 0;
      batch.tn = 0;
    }
  }

  function endBatch(batch, blend) {
    const { s, w, h } = batch;
    const gl = s.gl;
    if (gl.isContextLost()) return false;
    const ctx = batch.canvas.getContext("2d");
    if (!ctx) return false;
    if (gl.bindVertexArray) gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const cl = batch.clear || [0, 0, 0, 1];

    // RGBA picture out: only when something is cabled to this node's TV out.
    const nodeId = publishNodeIdFor(batch);
    const target = nodeId
      && typeof global.nodeGraphPictureHasConsumer === "function"
      && global.nodeGraphPictureHasConsumer(nodeId)
      && typeof global.nodeGraphPictureExportTarget === "function"
      ? global.nodeGraphPictureExportTarget(nodeId, w, h)
      : null;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Premultiplied result: rgb = sum(c * a), alpha = over-composited coverage.
      drawContent(batch, blend, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (typeof global.nodeGraphSharedGlBindPresent === "function") {
      global.nodeGraphSharedGlBindPresent(gl, w, h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }
    gl.clearColor(cl[0], cl[1], cl[2], cl.length > 3 ? cl[3] : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (target) {
      // Face = plate + the published picture (premultiplied over).
      useTexturedProgram(s);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      // FBO row 0 is the bottom: flip v.
      drawTextured(s, w, h, [0, 0, 0, 1, w, 0, 1, 1, 0, h, 0, 0, w, 0, 1, 1, w, h, 1, 0, 0, h, 0, 0], 2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // Colour additive / over; alpha always accumulates to opaque.
      drawContent(batch, blend, gl.ONE);
    }
    if (typeof global.nodeGraphSharedGlEndPresent === "function") global.nodeGraphSharedGlEndPresent(gl);
    if (gl.isContextLost()) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (batch.transparent) ctx.clearRect(0, 0, w, h);
    if (typeof global.nodeGraphSharedGlBlitTo2D === "function") {
      return global.nodeGraphSharedGlBlitTo2D(ctx, w, h) !== false;
    }
    ctx.drawImage(s.dev.canvas, 0, Math.max(0, s.dev.canvas.height - h), w, h, 0, 0, w, h);
    return true;
  }

  /** GL unavailable: plain black square (no 2D drawing fallback). */
  function nodeGraphGlLinesFillBlack(canvas) {
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /** "#rgb" / "#rrggbb" / "rgb(a)(...)" / "hsl(a)(...)" -> [r,g,b,a] 0..1. */
  function nodeGraphGlLinesCss(css, alpha = 1) {
    const s = String(css || "").trim().toLowerCase();
    let m = /^#([0-9a-f]{3})$/.exec(s);
    if (m) return [...m[1]].map((c) => parseInt(c + c, 16) / 255).concat(alpha);
    m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
    }
    m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
    if (m) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      const num = (v) => parseFloat(v);
      const a = parts.length > 3 ? (parts[3].endsWith("%") ? num(parts[3]) / 100 : num(parts[3])) : 1;
      if (m[1].startsWith("rgb")) {
        const ch = (v) => (v.endsWith("%") ? num(v) / 100 : num(v) / 255);
        return [ch(parts[0]), ch(parts[1]), ch(parts[2]), a * alpha];
      }
      return nodeGraphGlLinesHsl(num(parts[0]), num(parts[1]) / 100, num(parts[2]) / 100, a * alpha);
    }
    return [0, 0, 0, alpha];
  }

  /** HSL (hue degrees, s/l 0..1) -> [r,g,b,a] 0..1. */
  function nodeGraphGlLinesHsl(hDeg, s, l, alpha = 1) {
    const h = ((((Number(hDeg) || 0) % 360) + 360) % 360) / 360;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4), alpha];
  }

  const api = {
    nodeGraphGlLinesFillBlack,
    nodeGraphGlLinesBegin,
    nodeGraphGlLinesRect,
    nodeGraphGlLinesTriangle,
    nodeGraphGlLinesFillUnder,
    nodeGraphGlLinesSegment,
    nodeGraphGlLinesDot,
    nodeGraphGlLinesPolyline,
    nodeGraphGlLinesImage,
    nodeGraphGlLinesSnapshot,
    nodeGraphGlLinesReleaseSnapshot,
    nodeGraphGlLinesText,
    nodeGraphGlLinesMeasureText,
    nodeGraphGlLinesTextAtlas,
    nodeGraphGlLinesTextSegments,
    nodeGraphGlLinesEmojiStats,
    nodeGraphGlLinesCss,
    nodeGraphGlLinesHsl,
    nodeGraphGlLinesEnd,
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
