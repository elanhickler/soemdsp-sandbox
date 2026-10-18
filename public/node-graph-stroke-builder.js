// Stroke builder for GL trails. Turns a raw point list into dashed pieces the
// gl-line-renderer can draw. Coordinates stay in whatever space the caller
// uses (the snake trail passes zoom-1 world px). Lengths use those units too.

/**
 * Catmull-Rom resample of an open curve. Same handles the old SVG snake used
 * (p1 + (p2 - p0) / 6, p2 - (p3 - p1) / 6), so the shape does not change.
 * Returns a flat [x0, y0, x1, y1, ...] array spaced about `step` apart.
 */
function nodeGraphStrokeSmoothPoints(points, step = 2) {
  const out = [];
  if (!points?.length) return out;
  const n = points.length;
  const px = (i) => Number(points[i].x) || 0;
  const py = (i) => Number(points[i].y) || 0;
  out.push(px(0), py(0));
  if (n === 1) return out;
  if (n === 2) {
    out.push(px(1), py(1));
    return out;
  }
  const s = Math.max(1e-4, step);
  for (let i = 0; i < n - 1; i += 1) {
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(n - 1, i + 2);
    const x1 = px(i);
    const y1 = py(i);
    const x2 = px(i + 1);
    const y2 = py(i + 1);
    const c1x = x1 + (x2 - px(i0)) / 6;
    const c1y = y1 + (y2 - py(i0)) / 6;
    const c2x = x2 - (px(i3) - x1) / 6;
    const c2y = y2 - (py(i3) - y1) / 6;
    const hull = Math.hypot(c1x - x1, c1y - y1) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x2 - c2x, y2 - c2y);
    const count = Math.max(1, Math.min(64, Math.ceil(hull / s)));
    for (let k = 1; k <= count; k += 1) {
      const t = k / count;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push(a * x1 + b * c1x + c * c2x + d * x2, a * y1 + b * c1y + c * c2y + d * y2);
    }
  }
  return out;
}

/**
 * Split a flat polyline into dashes. `on` and `off` are lengths in the same
 * units as the points. Returns an array of flat point arrays, one per dash.
 * A zero-length input returns one single-point dash (the caller draws a dot).
 */
function nodeGraphStrokeDashes(flat, on, off) {
  const dashes = [];
  if (!flat || flat.length < 2) return dashes;
  if (flat.length < 4) {
    dashes.push([flat[0], flat[1]]);
    return dashes;
  }
  const onLen = Math.max(1e-4, on);
  const offLen = Math.max(0, off);
  let drawing = true;
  let left = onLen;
  let cur = [flat[0], flat[1]];
  for (let i = 2; i < flat.length; i += 2) {
    let x0 = flat[i - 2];
    let y0 = flat[i - 1];
    const x1 = flat[i];
    const y1 = flat[i + 1];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (seg > 0) {
      if (seg < left) {
        left -= seg;
        if (drawing) cur.push(x1, y1);
        break;
      }
      const t = left / seg;
      const mx = x0 + (x1 - x0) * t;
      const my = y0 + (y1 - y0) * t;
      if (drawing) {
        cur.push(mx, my);
        dashes.push(cur);
        cur = null;
      } else {
        cur = [mx, my];
      }
      seg -= left;
      x0 = mx;
      y0 = my;
      drawing = !drawing;
      left = drawing ? onLen : (offLen || 1e-4);
    }
  }
  if (drawing && cur && cur.length >= 2) dashes.push(cur);
  if (!dashes.length) dashes.push([flat[0], flat[1]]);
  return dashes;
}