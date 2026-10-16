// Native WebGL faces for the controller modules: Knob, Slider, Toggle and
// Momentary. One shared kit, drawn on the shared WebGL2 context through
// gl-line-renderer.js (smoothstep capsules, glyph-atlas text) on a canvas from
// display-canvas.js. No 2D drawing: a GL failure shows black and logs once
// (nodeGraphDisplayGlFailed).
//
// Geometry is a pure function of the face's CSS box (the zoom-1 layout), so a
// canvas tile that resizes the face scales every part uniformly. Input stays
// in DOM: each face keeps transparent hit elements (dial / bar / button /
// label) that nodeGraphControllerFacePlace() lays over the drawn parts.

(function initNodeGraphControllerFaceGl(global) {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const css = (value, alpha = 1) => (typeof global.nodeGraphGlLinesCss === "function"
    ? global.nodeGraphGlLinesCss(value, alpha)
    : [0, 0, 0, alpha]);
  const mix = (a, b, t) => {
    const k = clamp01(t);
    return [0, 1, 2, 3].map((i) => (a[i] ?? 1) + ((b[i] ?? 1) - (a[i] ?? 1)) * k);
  };
  const DEG = Math.PI / 180;

  // ---- shapes ------------------------------------------------------------
  /** Convex rounded-rect outline (clockwise, y down). */
  function roundRectPoints(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    const pts = [];
    const corner = (cx, cy, a0) => {
      const steps = rr > 0.01 ? 10 : 1;
      for (let i = 0; i <= steps; i += 1) {
        const a = (a0 + (90 * i) / steps) * DEG;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
    };
    corner(x + w - rr, y + rr, -90);
    corner(x + w - rr, y + h - rr, 0);
    corner(x + rr, y + h - rr, 90);
    corner(x + rr, y + rr, 180);
    return pts;
  }

  /** Clip a convex polygon to xMin <= x <= xMax. */
  function clipPointsX(pts, xMin, xMax) {
    const clip = (input, keep, edgeX) => {
      const out = [];
      for (let i = 0; i < input.length; i += 1) {
        const a = input[i];
        const b = input[(i + 1) % input.length];
        const ina = keep(a[0]);
        const inb = keep(b[0]);
        if (ina) out.push(a);
        if (ina !== inb) {
          const t = (edgeX - a[0]) / ((b[0] - a[0]) || 1e-9);
          out.push([edgeX, a[1] + (b[1] - a[1]) * t]);
        }
      }
      return out;
    };
    let out = clip(pts, (x) => x >= xMin, xMin);
    if (out.length) out = clip(out, (x) => x <= xMax, xMax);
    return out;
  }

  /**
   * Filled convex polygon: triangle fan plus a smoothstep edge (capsules along
   * the outline) so the boundary is anti-aliased at any scale.
   */
  function fillPoints(batch, pts, rgba, aa) {
    if (!batch || !pts || pts.length < 3) return;
    const [x0, y0] = pts[0];
    for (let i = 1; i < pts.length - 1; i += 1) {
      global.nodeGraphGlLinesTriangle(batch, x0, y0, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rgba);
    }
    const flat = [];
    for (const p of pts) flat.push(p[0], p[1]);
    flat.push(pts[0][0], pts[0][1]);
    global.nodeGraphGlLinesPolyline(batch, flat, aa * 0.25, aa, rgba);
  }

  function arcPoints(cx, cy, r, a0Deg, a1Deg) {
    const span = a1Deg - a0Deg;
    const steps = Math.max(1, Math.ceil(Math.abs(span) / 3));
    const flat = [];
    for (let i = 0; i <= steps; i += 1) {
      const a = (a0Deg + (span * i) / steps) * DEG;
      flat.push(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    }
    return flat;
  }

  function text(batch, str, x, y, o) {
    if (!str) return;
    global.nodeGraphGlLinesText(batch, str, x, y, {
      px: o.px, rgba: o.rgba, align: o.align || "center", baseline: "middle",
      maxWidth: o.maxWidth, weight: o.weight || 700,
    });
  }

  // ---- layouts (CSS px of the face box; pure, scale-exact) ----------------
  function nodeGraphControllerKnobLayout(w, h, s = {}) {
    const m = Math.min(w, h);
    const pad = m * 0.06;
    const label = s.labelPosition === "off" ? "off" : (s.labelPosition === "bottom" ? "bottom" : "top");
    const value = s.valuePosition === "off" ? "off" : (s.valuePosition === "bottom" ? "bottom" : "mid");
    const band = h * 0.2;
    let top = pad;
    let bottom = h - pad;
    const rects = {};
    if (label === "top") { rects.label = { x: pad, y: top, w: w - pad * 2, h: band }; top += band; }
    if (label === "bottom") { rects.label = { x: pad, y: bottom - band, w: w - pad * 2, h: band }; bottom -= band; }
    if (value === "bottom") { rects.value = { x: pad, y: bottom - band, w: w - pad * 2, h: band }; bottom -= band; }
    const areaH = Math.max(1, bottom - top);
    const r = Math.max(1, Math.min(w - pad * 2, areaH) * 0.5);
    const cx = w * 0.5;
    const cy = top + areaH * 0.5;
    const inner = Math.max(0.3, Math.min(0.92, Number(s.innerRadius ?? 0.72)));
    const thickness = r * (1 - inner);
    if (value === "mid") {
      const vh = r * inner;
      rects.value = { x: cx - r * inner * 0.86, y: cy - vh * 0.5, w: r * inner * 1.72, h: vh };
    }
    rects.dial = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    return { kind: "knob", w, h, cx, cy, r, inner, thickness, ringR: r - thickness * 0.5, label, value, rects };
  }

  function nodeGraphControllerSliderLayout(w, h, s = {}) {
    const m = Math.min(w, h);
    const pad = m * 0.08;
    const head = (s.sliderShowLabel !== false || s.sliderShowUnit !== false) ? h * 0.3 : 0;
    const bar = { x: pad, y: pad + head, w: w - pad * 2, h: Math.max(1, h - pad * 2 - head) };
    const rounding = Math.max(0, Math.min(1, Number(s.sliderRounding ?? 0.47)));
    const rects = { bar, dial: bar };
    if (head > 0) {
      rects.label = { x: pad, y: pad * 0.5, w: (w - pad * 2) * 0.66, h: head };
      rects.unit = { x: pad + (w - pad * 2) * 0.66, y: pad * 0.5, w: (w - pad * 2) * 0.34, h: head };
    }
    rects.value = { x: bar.x, y: bar.y, w: bar.w, h: bar.h };
    return { kind: "slider", w, h, pad, head, radius: rounding * Math.min(bar.w, bar.h) * 0.5, rects };
  }

  function nodeGraphControllerButtonLayout(w, h, s = {}) {
    const m = Math.min(w, h);
    const pad = m * 0.08;
    const hasLabel = s.showLabel === true;
    const band = hasLabel ? h * 0.26 : 0;
    const button = { x: pad, y: pad + band, w: w - pad * 2, h: Math.max(1, h - pad * 2 - band) };
    const bm = Math.min(button.w, button.h);
    const rects = { button };
    if (hasLabel) rects.label = { x: pad, y: pad * 0.5, w: w - pad * 2, h: band };
    return {
      kind: "button", w, h, rects,
      radius: Math.max(0, Math.min(1, Number(s.rounding ?? 0.18))) * bm * 0.5,
      stroke: Math.max(0, Math.min(1, Number(s.strokeScale ?? 0.06))) * bm * 0.5,
    };
  }

  // ---- draw --------------------------------------------------------------
  function drawKnob(batch, L, m, aa) {
    const fill = css(m.fill);
    const track = css(m.track);
    const ink = css(m.text);
    const bg = css(m.background);
    const span = Math.max(30, Math.min(360, Number(m.span) || 270));
    const a0 = -span * 0.5;
    const angle = (u) => a0 + clamp01(u) * span;
    const half = L.thickness * 0.5;
    global.nodeGraphGlLinesPolyline(batch, arcPoints(L.cx, L.cy, L.ringR, a0, a0 + span), half, aa, track);
    const from = angle(m.zero);
    const to = angle(m.unit);
    if (Math.abs(to - from) > 0.05) {
      global.nodeGraphGlLinesPolyline(batch, arcPoints(L.cx, L.cy, L.ringR, Math.min(from, to), Math.max(from, to)), half, aa, fill);
    }
    // Modulation ghost: target position on the ring, clamped to the range.
    if (Number.isFinite(m.ghost)) {
      const g = angle(m.ghost) * DEG;
      global.nodeGraphGlLinesDot(batch, L.cx + Math.sin(g) * L.ringR, L.cy - Math.cos(g) * L.ringR,
        half * 0.55, aa, mix(fill, ink, 0.55));
    }
    // Cap; pointer only when the number is not inside the cap.
    const capR = L.r * L.inner * 0.8;
    global.nodeGraphGlLinesDot(batch, L.cx, L.cy, capR, aa, mix(bg, track, 0.45));
    const p = to * DEG;
    if (m.value !== "mid") {
      global.nodeGraphGlLinesSegment(batch,
        L.cx + Math.sin(p) * capR * 0.3, L.cy - Math.cos(p) * capR * 0.3,
        L.cx + Math.sin(p) * capR * 0.92, L.cy - Math.cos(p) * capR * 0.92,
        Math.max(aa * 0.6, L.r * 0.04), aa, fill);
    }
    // Thumb at the value end of the ring.
    global.nodeGraphGlLinesDot(batch, L.cx + Math.sin(p) * L.ringR, L.cy - Math.cos(p) * L.ringR,
      half * 1.05, aa, mix(fill, ink, 0.35));
    if (L.rects.label && m.labelText && !m.labelEditing) {
      const r = L.rects.label;
      text(batch, m.labelText, r.x + r.w * 0.5, r.y + r.h * 0.5, { px: r.h * 0.68, maxWidth: r.w, rgba: ink });
    }
    if (L.rects.value && m.valueText && !m.valueEditing) {
      const r = L.rects.value;
      text(batch, m.valueText, r.x + r.w * 0.5, r.y + r.h * 0.5, { px: r.h * 0.62, maxWidth: r.w, rgba: ink });
    }
  }

  function drawSlider(batch, L, m, aa) {
    const bar = L.rects.bar;
    const shape = roundRectPoints(bar.x, bar.y, bar.w, bar.h, L.radius);
    fillPoints(batch, shape, css(m.track), aa);
    const xAt = (u) => bar.x + clamp01(u) * bar.w;
    const a = Math.min(xAt(m.zero), xAt(m.unit));
    const b = Math.max(xAt(m.zero), xAt(m.unit));
    if (b - a > 0.01) fillPoints(batch, clipPointsX(shape, a, b), css(m.fill), aa);
    const number = css(m.numberColor);
    if (Number.isFinite(m.ghost)) {
      const gx = Math.max(bar.x + aa, Math.min(bar.x + bar.w - aa, xAt(m.ghost)));
      global.nodeGraphGlLinesSegment(batch, gx, bar.y + bar.h * 0.18, gx, bar.y + bar.h * 0.82,
        Math.max(aa * 0.6, bar.h * 0.035), aa, mix(css(m.fill), number, 0.6));
    }
    const ink = css(m.text);
    if (L.rects.label && m.labelText && !m.labelEditing) {
      const r = L.rects.label;
      text(batch, m.labelText, r.x, r.y + r.h * 0.5, { px: r.h * 0.66, maxWidth: r.w, rgba: ink, align: "left" });
    }
    if (L.rects.unit && m.unitText) {
      const r = L.rects.unit;
      text(batch, m.unitText, r.x + r.w, r.y + r.h * 0.5, { px: r.h * 0.6, maxWidth: r.w, rgba: ink, align: "right" });
    }
    if (m.valueText && !m.valueEditing) {
      text(batch, m.valueText, bar.x + bar.w * 0.5, bar.y + bar.h * 0.5,
        { px: bar.h * 0.5, maxWidth: bar.w * 0.9, rgba: number });
    }
  }

  function drawButton(batch, L, m, aa) {
    const b = L.rects.button;
    const outer = roundRectPoints(b.x, b.y, b.w, b.h, L.radius);
    const stroke = m.hover ? css(m.hoverColor) : css(m.strokeColor);
    let face = mix(css(m.inactiveColor), css(m.activeColor), m.mix);
    if (m.held) face = mix(face, css(m.activeColor), 0.35);
    const sw = L.stroke;
    if (sw > aa * 0.25) {
      fillPoints(batch, outer, stroke, aa);
      fillPoints(batch, roundRectPoints(b.x + sw, b.y + sw, b.w - sw * 2, b.h - sw * 2, Math.max(0, L.radius - sw)), face, aa);
    } else {
      fillPoints(batch, outer, face, aa);
    }
    const ink = css(m.textColor);
    if (m.caption) {
      text(batch, m.caption, b.x + b.w * 0.5, b.y + b.h * 0.5,
        { px: Math.min(b.h * 0.42, b.w * 0.5), maxWidth: (b.w - sw * 2) * 0.86, rgba: ink });
    }
    if (L.rects.label && m.labelText && !m.labelEditing) {
      const r = L.rects.label;
      text(batch, m.labelText, r.x, r.y + r.h * 0.5, { px: r.h * 0.66, maxWidth: r.w, rgba: ink, align: "left" });
    }
  }

  const LAYOUTS = { knob: nodeGraphControllerKnobLayout, slider: nodeGraphControllerSliderLayout, button: nodeGraphControllerButtonLayout };
  const DRAWS = { knob: drawKnob, slider: drawSlider, button: drawButton };

  // ---- face host -----------------------------------------------------------
  function nodeGraphControllerFaceCanvas(face) {
    let canvas = face?.querySelector?.(":scope > canvas.node-controller-face-canvas") || null;
    if (!canvas && face && typeof global.nodeGraphDisplayCanvasCreate === "function") {
      canvas = global.nodeGraphDisplayCanvasCreate("node-controller-face-canvas");
      canvas.setAttribute("aria-hidden", "true");
      face.prepend(canvas);
    }
    return canvas;
  }

  /** Lay a DOM hit element over a layout rect (percent of the face box). */
  function nodeGraphControllerFacePlace(el, rect, w, h) {
    if (!el?.style) return;
    if (!rect) { el.hidden = true; return; }
    el.hidden = false;
    const pct = (v, d) => `${((v / d) * 100).toFixed(4)}%`;
    const next = `${pct(rect.x, w)}|${pct(rect.y, h)}|${pct(rect.w, w)}|${pct(rect.h, h)}`;
    if (el.dataset.ctrlBox === next) return;
    el.dataset.ctrlBox = next;
    const [l, t, ww, hh] = next.split("|");
    el.style.left = l;
    el.style.top = t;
    el.style.width = ww;
    el.style.height = hh;
    // Editing font follows the drawn text (face is a size container).
    el.style.fontSize = `${((rect.h * 0.66) / h * 100).toFixed(4)}cqh`;
  }

  /** Repaint when the face box changes (module, canvas tile, solo stage). */
  function nodeGraphControllerFaceObserve(face, repaint) {
    if (!face || face._ctrlRo || typeof global.ResizeObserver !== "function") return;
    face._ctrlRepaint = repaint;
    face._ctrlRo = new global.ResizeObserver(() => {
      if (face._ctrlRoRaf) global.cancelAnimationFrame(face._ctrlRoRaf);
      face._ctrlRoRaf = global.requestAnimationFrame(() => {
        face._ctrlRoRaf = 0;
        face._ctrlRepaint?.();
      });
    });
    face._ctrlRo.observe(face);
  }

  /**
   * Draw one controller face. kind: knob | slider | button. model carries
   * settings, colors, unit/zero/ghost (0..1), texts and states. place(L) lays
   * the DOM hit elements. Returns the layout, or null (no box / GL failed).
   */
  function nodeGraphControllerFacePaint(face, kind, model, place = null) {
    const canvas = nodeGraphControllerFaceCanvas(face);
    if (!canvas || typeof global.nodeGraphDisplayCanvasSize !== "function") return null;
    const metrics = global.nodeGraphDisplayCanvasSize(face, canvas);
    if (!metrics || !(metrics.cssWidth > 0) || !(metrics.cssHeight > 0)) return null;
    const layout = LAYOUTS[kind](metrics.cssWidth, metrics.cssHeight, model.settings || {});
    if (typeof place === "function") place(layout);
    const key = JSON.stringify([kind, metrics.width, metrics.height, model]);
    const now = global.performance?.now?.() ?? Date.now();
    // Same picture: skip, but refresh at least once a second (scope wipes).
    if (canvas._ctrlKey === key && now - (canvas._ctrlAt || 0) < 1000) return layout;
    const batch = typeof global.nodeGraphGlLinesBegin === "function"
      ? global.nodeGraphGlLinesBegin(canvas, css(model.background || "#000000"), { scale: metrics.pixelRatio })
      : null;
    if (!batch) {
      canvas._ctrlKey = "";
      global.nodeGraphDisplayGlFailed?.(canvas, `${kind} face: WebGL2 unavailable`);
      return null;
    }
    DRAWS[kind](batch, layout, model, 1 / Math.max(1e-6, metrics.pixelRatio));
    if (!global.nodeGraphGlLinesEnd(batch)) {
      canvas._ctrlKey = "";
      global.nodeGraphDisplayGlFailed?.(canvas, `${kind} face: GL present failed`);
      return null;
    }
    canvas._ctrlKey = key;
    canvas._ctrlAt = now;
    return layout;
  }

  const api = {
    nodeGraphControllerKnobLayout,
    nodeGraphControllerSliderLayout,
    nodeGraphControllerButtonLayout,
    nodeGraphControllerFaceCanvas,
    nodeGraphControllerFacePlace,
    nodeGraphControllerFaceObserve,
    nodeGraphControllerFacePaint,
    nodeGraphControllerFaceShapes: Object.freeze({ roundRectPoints, clipPointsX, arcPoints }),
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
