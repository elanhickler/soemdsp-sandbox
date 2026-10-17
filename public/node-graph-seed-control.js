// Seed control: [NUMBER][die][+][−] for every kind:"seed" parameter row.
// Ported from soundemote.dev preset-browser prototype / Sabrina Reverb face.
// DOM control like the other parameter readouts; sizes come from the
// existing readout CSS vars, so it scales with workspace zoom.
//  +/−   : click 1, Ctrl 10, Ctrl+Shift 100, Ctrl+Alt+Shift 1000, Alt alone = random.
//          Wraps modularly over min..max.
//  🎲    : random.
//  number: drag 4px/step (right/up = up), step = 10^(digits-2) (min 1),
//          each held Shift/Ctrl/Alt halves it, clamped. Wheel does nothing to Seed.
//          Alt/Ctrl click do nothing. Double-click types a value.
(function () {
  const PX_PER_STEP = 4;

  function rowSlider(row) {
    return row?.querySelector?.('input[type="range"]') || null;
  }
  function bounds(slider) {
    const min = Number.isFinite(Number(slider.min)) ? Math.round(Number(slider.min)) : 0;
    const max = Number.isFinite(Number(slider.max)) ? Math.round(Number(slider.max)) : 16777215;
    return { min, max };
  }
  function current(slider) {
    const d = Number(slider.dataset.domainValue);
    const v = Number.isFinite(d) ? d : Number(slider.value);
    return Number.isFinite(v) ? Math.round(v) : 0;
  }
  function locked() {
    return typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked();
  }
  function write(slider, value, drag) {
    if (typeof setNodeSliderValue !== "function") return;
    setNodeSliderValue(slider, value, drag ? { interaction: "drag" } : {});
    if (!drag && typeof commitNodeSliderDragValue === "function") {
      commitNodeSliderDragValue(slider, "seed changed");
    }
  }
  function randomIn(slider) {
    const { min, max } = bounds(slider);
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  function buttonStep(e) {
    if (e.ctrlKey && e.shiftKey && e.altKey) return 1000;
    if (e.ctrlKey && e.shiftKey) return 100;
    if (e.ctrlKey) return 10;
    return 1;
  }
  function dragStep(value, e) {
    const digits = String(Math.abs(Math.round(value))).length;
    let step = Math.pow(10, Math.max(0, digits - 2));
    const mods = (e.shiftKey ? 1 : 0) + (e.ctrlKey ? 1 : 0) + (e.altKey ? 1 : 0);
    step = Math.floor(step / Math.pow(2, mods));
    return Math.max(1, step);
  }
  function wrap(v, min, max) {
    const span = max - min + 1;
    return min + ((((v - min) % span) + span) % span);
  }
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }


  // Fit the number to its box per value (short values big, 8 digits shrink).
  function fitSeedNumber(label) {
    const readout = label?.querySelector?.(".node-slider-readout");
    const span = readout?.querySelector?.(".node-slider-readout-value");
    if (!span) return;
    const w = readout.clientWidth, h = readout.clientHeight;
    if (!w || !h) return;
    const chars = Math.max(1, String(span.textContent || "").trim().length);
    const pad = Math.max(2, h * 0.12);
    const px = Math.max(6, Math.min((h - pad * 2) / 0.78, (w - pad * 2) / (chars * 0.58)));
    const v = `${px.toFixed(2)}px`;
    if (span.style.fontSize !== v) span.style.fontSize = v;
  }
  window.fitNodeGraphSeedNumber = fitSeedNumber;

  function makeButton(kind, text, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `node-seed-btn node-seed-btn-${kind}`;
    b.dataset.seedAction = kind;
    if (kind === "dice") {
      // Drawn die (five pips), matching the Sabrina plugin face.
      const die = document.createElement("span");
      die.className = "node-seed-die";
      for (let i = 0; i < 5; i += 1) {
        const pip = document.createElement("span");
        pip.className = "node-seed-die-pip";
        die.append(pip);
      }
      b.append(die);
    }
    b.setAttribute("aria-label", kind === "dice" ? "Random seed" : kind === "plus" ? "Increase seed" : "Decrease seed");
    b.title = title;
    b.tabIndex = -1;
    return b;
  }

  function decorateSeedRow(row) {
    if (!row || row.dataset.seedDecorated === "true") return row;
    const label = row.querySelector(".node-parameter-control");
    if (!label) return row;
    row.dataset.seedDecorated = "true";
    label.classList.add("node-seed-control");
    label.append(
      makeButton("dice", "\u{1F3B2}", "Random seed"),
      makeButton("plus", "+", "+1 (Ctrl 10, Ctrl+Shift 100, Ctrl+Alt+Shift 1000, Alt random). Wraps."),
      makeButton("minus", "\u2212", "\u22121 (Ctrl 10, Ctrl+Shift 100, Ctrl+Alt+Shift 1000, Alt random). Wraps."),
    );
    let queued = false;
    const refit = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fitSeedNumber(label); });
    };
    new MutationObserver(refit).observe(label, { subtree: true, childList: true, characterData: true });
    if (typeof ResizeObserver === "function") new ResizeObserver(refit).observe(label);
    refit();
    return row;
  }
  window.decorateNodeGraphSeedRow = decorateSeedRow;

  // Wrap the row factory so every new seed row gets the control.
  if (typeof createNodeGraphParameter === "function" && !createNodeGraphParameter.__seedWrapped) {
    const orig = createNodeGraphParameter;
    const wrapped = function (...args) {
      const row = orig.apply(this, args);
      if (row?.dataset?.paramKind === "seed") decorateSeedRow(row);
      return row;
    };
    wrapped.__seedWrapped = true;
    // eslint-disable-next-line no-global-assign
    createNodeGraphParameter = wrapped;
  }
  function scan() {
    document.querySelectorAll(".node-parameter-row-seed").forEach(decorateSeedRow);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  let drag = null;
  let lastDown = null;

  function onPointerDown(e) {
    const row = e.target?.closest?.(".node-parameter-row-seed");
    if (!row || e.target.closest(".node-port, .node-param-port")) return;
    if (e.button > 0) return;
    const btn = e.target.closest(".node-seed-btn");
    const readout = e.target.closest(".node-slider-readout");
    if (!btn && !readout) return;
    if (e.target.closest(".node-slider-readout-input")) return;
    // Own the gesture: keep generic slider/module drag out of it.
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
    const slider = rowSlider(row);
    if (!slider || locked()) return;
    const { min, max } = bounds(slider);
    if (btn) {
      const action = btn.dataset.seedAction;
      if (action === "dice" || (e.altKey && !e.ctrlKey && !e.shiftKey)) {
        write(slider, randomIn(slider), false);
        return;
      }
      const s = buttonStep(e) * (action === "minus" ? -1 : 1);
      write(slider, wrap(current(slider) + s, min, max), false);
      return;
    }
    const now = performance.now();
    const dbl = !e.altKey && !e.ctrlKey && lastDown && lastDown.readout === readout
      && now - lastDown.time < 400
      && Math.abs(e.clientX - lastDown.x) < 6 && Math.abs(e.clientY - lastDown.y) < 6;
    lastDown = { readout, time: now, x: e.clientX, y: e.clientY };
    if (dbl) {
      lastDown = null;
      if (typeof beginNodeSliderReadoutEdit === "function") beginNodeSliderReadoutEdit(readout);
      return;
    }
    drag = { slider, readout, x: e.clientX, y: e.clientY, acc: 0, moved: false, pointerId: e.pointerId };
    try { readout.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    readout.classList.add("value-dragging");
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopImmediatePropagation();
    drag.acc += (e.clientX - drag.x) - (e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
    const { min, max } = bounds(drag.slider);
    let v = current(drag.slider);
    let changed = false;
    while (Math.abs(drag.acc) >= PX_PER_STEP) {
      const dir = drag.acc > 0 ? 1 : -1;
      drag.acc -= dir * PX_PER_STEP;
      const nv = clamp(v + dir * dragStep(v, e), min, max);
      if (nv !== v) { v = nv; changed = true; }
    }
    if (changed) {
      drag.moved = true;
      write(drag.slider, v, true);
      if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    }
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopImmediatePropagation();
    const d = drag;
    drag = null;
    d.readout.classList.remove("value-dragging");
    try { d.readout.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (d.moved && typeof commitNodeSliderDragValue === "function") {
      commitNodeSliderDragValue(d.slider, "seed changed");
    }
  }
  function swallow(e) {
    if (e.target?.closest?.(".node-parameter-row-seed .node-seed-btn")) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("click", swallow, true);
  window.addEventListener("dblclick", swallow, true);
  window.addEventListener("pointerover", (e) => {
    if (e.target?.closest?.(".node-seed-control") && typeof nodeGraphGlGraphPresentSoon === "function") {
      nodeGraphGlGraphPresentSoon();
    }
  }, true);
  window.addEventListener("pointerout", (e) => {
    if (e.target?.closest?.(".node-seed-control") && typeof nodeGraphGlGraphPresentSoon === "function") {
      nodeGraphGlGraphPresentSoon();
    }
  }, true);
  window.addEventListener("mousedown", (e) => {
    if (e.target?.closest?.(".node-parameter-row-seed .node-seed-btn, .node-parameter-row-seed .node-slider-readout")
      && !e.target.closest(".node-slider-readout-input")) {
      e.stopImmediatePropagation();
    }
  }, true);
})();
