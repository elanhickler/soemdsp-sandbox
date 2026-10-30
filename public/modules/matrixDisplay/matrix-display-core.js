// Asciiscope — XY character-grid phosphor (GPU; see matrix-display-display.js).
//
// New X/Y samples deposit Bright x Burn into a per-cell energy grid; energy
// decays on the shared PhosphorResidual curve (Ghost / Trail = decay only).
// Each cell shows a glyph from the ramp string picked by its level: early
// characters for the dim tail, late characters for the hot tip.

const MATRIX_DISPLAY_DEFAULT_GLYPH_RAMP = " .:-=+*#%@";

function normalizeNodeGraphMatrixDisplay(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  let ramp = typeof source.glyphRamp === "string" ? source.glyphRamp : MATRIX_DISPLAY_DEFAULT_GLYPH_RAMP;
  // Collapse newlines so a multiline display-settings field still works as a ramp.
  ramp = ramp.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "");
  if (!ramp.length) {
    ramp = MATRIX_DISPLAY_DEFAULT_GLYPH_RAMP;
  }
  if (ramp.length > 256) {
    ramp = ramp.slice(0, 256);
  }
  return {
    glyphRamp: ramp,
  };
}

/** Live (modulated) params, clamped to the slider ranges in the defs. */
function matrixDisplayParamsFromNode(node) {
  const Residual = typeof PhosphorResidual !== "undefined" ? PhosphorResidual : null;
  return {
    density: matrixLiveParam(node, "density", 0.7, 0, 1),
    trail: matrixLiveParam(node, "trail", 0.78, 0, 1),
    ghost: matrixLiveParam(node, "ghost", 0.35, 0, 1),
    backgroundBrightness: matrixLiveParam(node, "backgroundBrightness", 0, 0, 1),
    brightness: matrixLiveParam(node, "brightness", 1, 0, 1),
    burnAmount: matrixLiveParam(node, "burnAmount", Residual?.DEFAULT_BURN_AMOUNT ?? 0.3, 0, Residual?.BURN_AMOUNT_MAX ?? 4),
    freeze: matrixLiveParam(node, "freeze", 0, 0, 1) >= 0.5,
  };
}

/** Asciiscope neon palette (cyan / violet), u 0..1 -> [r, g, b] 0..255. */
function matrixDisplayPaletteRgb(u) {
  const t = Math.max(0, Math.min(1, u));
  if (t < 0.25) {
    const k = t / 0.25;
    return [18 * k, 0, 34 * k];
  }
  if (t < 0.55) {
    const k = (t - 0.25) / 0.3;
    return [18 + (110 - 18) * k, 18 * k, 34 + (152 - 34) * k];
  }
  if (t < 0.82) {
    const k = (t - 0.55) / 0.27;
    return [110 + (42 - 110) * k, 18 + (220 - 18) * k, 152 + (235 - 152) * k];
  }
  const k = (t - 0.82) / 0.18;
  return [42 + (255 - 42) * k, 220 + (255 - 220) * k, 235 + (255 - 235) * k];
}

/** 256-entry RGBA LUT of the palette (level -> colour). */
function matrixDisplayPaletteLutRgba() {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const rgb = matrixDisplayPaletteRgb(Math.pow(i / 255, 1.05));
    data[i * 4] = Math.round(rgb[0]);
    data[i * 4 + 1] = Math.round(rgb[1]);
    data[i * 4 + 2] = Math.round(rgb[2]);
    data[i * 4 + 3] = 255;
  }
  return data;
}
