// Shared SDF glyph atlas baker (Felzenszwalb EDT). The 2D canvas here is a
// one-time bake source for a GL texture, never a display surface.
// Shared SDF glyph bake (DSEG / mono LCD digits) for GL text.

(function initGlyphSdfAtlas(global) {
  /** 1D squared EDT on a row/col (Felzenszwalb & Huttenlocher). */
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -1e20;
    z[1] = 1e20;
    for (let q = 1; q < n; q += 1) {
      let s;
      for (;;) {
        const r = v[k];
        s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
        if (s > z[k]) break;
        k -= 1;
        if (k < 0) {
          k = 0;
          break;
        }
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
      while (z[k + 1] < q) k += 1;
      const r = v[k];
      const dist = q - r;
      d[q] = dist * dist + f[r];
    }
  }

  function edt2d(bin, w, h) {
    // bin: 0 = inside (ink), 1 = outside. Returns float distance field (outside positive).
    const n = Math.max(w, h);
    const f = new Float32Array(n);
    const d = new Float32Array(n);
    const v = new Int32Array(n);
    const z = new Float32Array(n + 1);
    const grid = new Float32Array(w * h);
    const INF = 1e12;
    for (let i = 0; i < w * h; i += 1) {
      grid[i] = bin[i] ? INF : 0;
    }
    // Columns
    for (let x = 0; x < w; x += 1) {
      for (let y = 0; y < h; y += 1) f[y] = grid[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y += 1) grid[y * w + x] = d[y];
    }
    // Rows
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) f[x] = grid[y * w + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x += 1) grid[y * w + x] = d[x];
    }
    for (let i = 0; i < grid.length; i += 1) {
      grid[i] = Math.sqrt(grid[i]);
    }
    return grid;
  }

  function bake(glyphs, fontStack, opts) {
    const o = opts || {};
    const ATLAS_COLS = o.cols || 8, ATLAS_CELL_W = o.cellW || 64, ATLAS_CELL_H = o.cellH || 96, SDF_SPREAD = o.spread || 10;
    const count = glyphs.length;
    const cols = ATLAS_COLS;
    const rows = Math.max(1, Math.ceil(count / cols));
    const cw = ATLAS_CELL_W;
    const ch = ATLAS_CELL_H;
    const canvas = document.createElement("canvas");
    canvas.width = cols * cw;
    canvas.height = rows * ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontPx = Math.max(6, Math.floor(ch * 0.72));
    ctx.font = `700 ${fontPx}px ${fontStack}`;

    // Temp mask per cell
    const cellCanvas = document.createElement("canvas");
    cellCanvas.width = cw;
    cellCanvas.height = ch;
    const cctx = cellCanvas.getContext("2d", { willReadFrequently: true });
    if (!cctx) return null;

    const out = ctx.createImageData(canvas.width, canvas.height);
    const outData = out.data;
    const indexOf = Object.create(null);

    for (let i = 0; i < count; i += 1) {
      const g = glyphs[i];
      indexOf[g] = i;
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      cctx.clearRect(0, 0, cw, ch);
      cctx.fillStyle = "#fff";
      cctx.textAlign = "center";
      cctx.textBaseline = "middle";
      cctx.font = `700 ${fontPx}px ${fontStack}`;
      if (g && g !== " ") {
        cctx.fillText(g, cw * 0.5, ch * 0.54);
      }
      const img = cctx.getImageData(0, 0, cw, ch);
      const binOut = new Uint8Array(cw * ch);
      const binIn = new Uint8Array(cw * ch);
      for (let p = 0; p < cw * ch; p += 1) {
        const a = img.data[p * 4 + 3] > 128 || img.data[p * 4] > 128 ? 1 : 0;
        binOut[p] = a ? 0 : 1; // 0 distance seed at ink for outside-field
        binIn[p] = a ? 1 : 0;  // seed at empty for inside-field
      }
      const outside = edt2d(binOut, cw, ch);
      const inside = edt2d(binIn, cw, ch);
      const ox = gx * cw;
      const oy = gy * ch;
      for (let y = 0; y < ch; y += 1) {
        for (let x = 0; x < cw; x += 1) {
          const p = y * cw + x;
          const ink = binOut[p] === 0;
          const dist = ink ? -inside[p] : outside[p];
          const enc = Math.max(0, Math.min(255,
            Math.round((dist / SDF_SPREAD) * 127.5 + 127.5)));
          const o = ((oy + y) * canvas.width + (ox + x)) * 4;
          outData[o] = enc;
          outData[o + 1] = enc;
          outData[o + 2] = enc;
          outData[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(out, 0, 0);
    return {
      canvas,
      cols,
      rows,
      count,
      cellW: cw,
      cellH: ch,
      glyphs,
      indexOf,
      spread: SDF_SPREAD,
    };
  }

  global.nodeGraphGlyphSdfAtlasBake = bake;
})(typeof window !== "undefined" ? window : globalThis);
