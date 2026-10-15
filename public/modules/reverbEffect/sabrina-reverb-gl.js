// Sabrina Reverb face: port of the Sabrina Reverb CLAP plugin's display
// (sabrina-reverb-clap/src/ui/sabrina-face.cpp, SabrinaWaterfall).
//   - black plate, 14 full-height vertical lines at x = delay / 0.45 s
//   - lines 0..11 alternate L (255,130,110) / R (110,130,255); 12..13 recycle (86,206,118)
//   - kLineFrag: a = 1 - smoothstep(halfPx, halfPx + 2, |dist|), additive blend
//     (GL_SRC_ALPHA, GL_ONE), halfPx = stemWidth / 2, stemWidth = max(1, displayW / 222)
//   - a line outside 0..1 (past the 0.45 s axis) is not drawn
// GL via the shared line renderer (public/lib/visual/gl-line-renderer.js);
// WebGL2 only; if GL can't run the face is a plain black square.
// Positions come from soemdsp_sabrina_reverb_voice_delay (data bus "Phases").

const NODE_GRAPH_SABRINA_DISPLAY_BASE_W = 222; // 234 spawn width - 2 * kInset
const NODE_GRAPH_SABRINA_FEATHER_PX = 2;

const NODE_GRAPH_SABRINA_STEM_RGB = [
  [1, 130 / 255, 110 / 255],
  [110 / 255, 130 / 255, 1],
];
const NODE_GRAPH_SABRINA_RECYCLE_RGB = [86 / 255, 206 / 255, 118 / 255];

function nodeGraphSabrinaStemWidthPx(displayW) {
  const w = Math.max(1, Number(displayW) || 1);
  return Math.max(1, w / NODE_GRAPH_SABRINA_DISPLAY_BASE_W);
}

function nodeGraphSabrinaLineRgb(i) {
  return i >= 12 ? NODE_GRAPH_SABRINA_RECYCLE_RGB : NODE_GRAPH_SABRINA_STEM_RGB[i & 1];
}

// auto-zoom lines: two groups on their own scales.
//   - diffusion lines (0..11): x = delay / max(diffusion delays), so the
//     longest diffusion line sits on the right edge at any Diffusion Size.
//   - green tap-delay lines (12, 13): centered; x moves only by the time
//     modulation offset (delay minus its slow running mean), scaled by a
//     decaying peak of that offset so the swing fills ~80% of the width.
// Off: absolute 0..0.45 s axis (plugin look).
const NODE_GRAPH_SABRINA_ZOOM_EDGE = 0.98;
const nodeGraphSabrinaZoomState = new WeakMap();

function nodeGraphSabrinaDisplayX01(canvas, phases, autoZoom) {
  const count = Math.min(14, phases.length);
  const out = new Array(count).fill(NaN);
  if (!autoZoom) {
    for (let i = 0; i < count; i += 1) out[i] = Number(phases[i]);
    return out;
  }
  let diffMax = 0;
  for (let i = 0; i < Math.min(12, count); i += 1) {
    const p = Number(phases[i]);
    if (Number.isFinite(p) && p > diffMax) diffMax = p;
  }
  for (let i = 0; i < Math.min(12, count); i += 1) {
    const p = Number(phases[i]);
    if (Number.isFinite(p) && diffMax > 0) out[i] = (p / diffMax) * NODE_GRAPH_SABRINA_ZOOM_EDGE;
  }
  let st = canvas ? nodeGraphSabrinaZoomState.get(canvas) : null;
  if (!st) {
    st = { mean: [NaN, NaN], peak: 0 };
    if (canvas) nodeGraphSabrinaZoomState.set(canvas, st);
  }
  let peak = st.peak * 0.995;
  const offs = [];
  for (let k = 0; k < 2; k += 1) {
    const i = 12 + k;
    const p = i < count ? Number(phases[i]) : NaN;
    if (!Number.isFinite(p)) { offs.push(NaN); continue; }
    st.mean[k] = Number.isFinite(st.mean[k]) ? st.mean[k] + (p - st.mean[k]) * 0.02 : p;
    const d = p - st.mean[k];
    offs.push(d);
    if (Math.abs(d) > peak) peak = Math.abs(d);
  }
  st.peak = peak;
  for (let k = 0; k < 2; k += 1) {
    if (!Number.isFinite(offs[k])) continue;
    out[12 + k] = 0.5 + (peak > 1e-9 ? (offs[k] / peak) * 0.4 : 0);
  }
  return out;
}

function nodeGraphSabrinaReverbGlPresent(canvas, phases, cssWidth, settings = null) {
  if (!canvas || !Array.isArray(phases) || !phases.length) return false;
  const w = Math.max(1, canvas.width | 0);
  const h = Math.max(1, canvas.height | 0);
  const cssW = Math.max(1, Number(cssWidth) || canvas.clientWidth || w);
  // Plugin works in component px with a device-scaled viewport: scale halfPx
  // and feather by backing/css so the look matches at any dpr (not zoom).
  const scale = w / cssW;
  // Line thickness (Display Settings, screen px) sets the stem core width.
  // 0 = lines gone. Missing setting = plugin width (displayW / 222).
  const thickCss = Number(settings?.lineThickness);
  if (Number.isFinite(thickCss) && !(thickCss > 0)) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return true;
  }
  const stemCss = Number.isFinite(thickCss) ? thickCss : nodeGraphSabrinaStemWidthPx(cssW);
  const halfPx = stemCss * 0.5 * scale;
  const xs = nodeGraphSabrinaDisplayX01(canvas, phases, settings?.autoZoomLines === true);
  const feather = NODE_GRAPH_SABRINA_FEATHER_PX * scale;
  const batch = typeof nodeGraphGlLinesBegin === "function" ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 1]) : null;
  if (batch) {
    const count = Math.min(14, phases.length);
    for (let i = 0; i < count; i += 1) {
      const x01 = xs[i];
      if (!(x01 >= 0 && x01 <= 1)) continue; // past the 0..0.45 s axis: not drawn
      const x = x01 * w;
      // Horizontal-only distance like the plugin quad (segment spans past the edges).
      nodeGraphGlLinesSegment(batch, x, -halfPx - feather, x, h + halfPx + feather, halfPx, feather, nodeGraphSabrinaLineRgb(i));
    }
    if (nodeGraphGlLinesEnd(batch, "add")) return true;
  }
  // WebGL2-only: no GL -> plain black square. Return true so the caller
  // does not draw anything else over it.
  if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  return true;
}
