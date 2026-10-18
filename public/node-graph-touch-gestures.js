// Shared touch gestures for every module (PH-1).
// Pointer events only. Mouse clicks stay on the existing click / dblclick paths.
// Double-tap window and long-hold (500 ms) live here so callers do not keep their own timers.
// Pinch and two-finger pan are recognized here; workspace wiring is PH-6, after the GPU camera.

const NODE_GRAPH_TOUCH_DOUBLE_TAP_MS = 350;
const NODE_GRAPH_TOUCH_LONG_HOLD_MS = 500;
const NODE_GRAPH_TOUCH_SLOP_PX = 10;

const nodeGraphTouchGestureSessions = new Map();

function nodeGraphTouchGestureIsTouch(event) {
  const type = String(event?.pointerType || "");
  return type === "touch" || type === "pen";
}

function nodeGraphTouchGestureClearHold(session) {
  if (session?.holdTimer) {
    window.clearTimeout(session.holdTimer);
    session.holdTimer = 0;
  }
}

/**
 * Record a touch/pen pointerdown. The second down on the same key, inside the
 * double-tap window and the slop, returns doubleTap. Mouse returns touch:false.
 */
function nodeGraphTouchGestureDown(key, event) {
  if (!nodeGraphTouchGestureIsTouch(event)) {
    return { touch: false, doubleTap: false };
  }
  const id = String(key || "");
  const now = performance.now();
  const prev = nodeGraphTouchGestureSessions.get(id);
  const doubleTap = Boolean(
    prev
    && !prev.consumed
    && now - prev.time <= NODE_GRAPH_TOUCH_DOUBLE_TAP_MS
    && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) <= NODE_GRAPH_TOUCH_SLOP_PX,
  );
  nodeGraphTouchGestureClearHold(prev);
  nodeGraphTouchGestureSessions.set(id, {
    time: now,
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
    consumed: doubleTap,
    holdTimer: 0,
    holdFired: false,
    moved: false,
  });
  return { touch: true, doubleTap };
}

/** Fire onHold after 500 ms if the finger has not moved past the slop. */
function nodeGraphTouchGestureArmHold(key, event, onHold) {
  const session = nodeGraphTouchGestureSessions.get(String(key || ""));
  if (!session || session.pointerId !== event?.pointerId || typeof onHold !== "function") {
    return;
  }
  nodeGraphTouchGestureClearHold(session);
  session.holdTimer = window.setTimeout(() => {
    session.holdTimer = 0;
    if (session.moved) {
      return;
    }
    session.holdFired = true;
    onHold(event);
  }, NODE_GRAPH_TOUCH_LONG_HOLD_MS);
}

/** Cancel the long-hold once the finger leaves the slop. Returns true when it has. */
function nodeGraphTouchGestureMove(key, event) {
  const session = nodeGraphTouchGestureSessions.get(String(key || ""));
  if (!session || (event?.pointerId !== undefined && session.pointerId !== event.pointerId)) {
    return false;
  }
  if (Math.hypot(event.clientX - session.x, event.clientY - session.y) <= NODE_GRAPH_TOUCH_SLOP_PX) {
    return false;
  }
  session.moved = true;
  nodeGraphTouchGestureClearHold(session);
  return true;
}

function nodeGraphTouchGestureUp(key, event) {
  const session = nodeGraphTouchGestureSessions.get(String(key || ""));
  if (!session) {
    return { holdFired: false, moved: false, doubleTap: false };
  }
  if (event?.pointerId !== undefined && session.pointerId !== event.pointerId) {
    return { holdFired: false, moved: false, doubleTap: false };
  }
  nodeGraphTouchGestureClearHold(session);
  return {
    holdFired: session.holdFired === true,
    moved: session.moved === true,
    doubleTap: session.consumed === true,
  };
}

function nodeGraphTouchGesturePair(points) {
  const list = [...points.values()];
  if (list.length < 2) {
    return null;
  }
  const a = list[0];
  const b = list[1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    cx: (a.x + b.x) * 0.5,
    cy: (a.y + b.y) * 0.5,
    distance: Math.hypot(dx, dy),
  };
}

/**
 * Pinch (finger distance changes) and two-finger pan (both fingers translate
 * together) on one element. One-finger pointers are ignored here.
 */
function nodeGraphBindMultiTouchGestures(element, handlers = {}) {
  if (!(element instanceof Element) || element.dataset.touchMultiBound === "1") {
    return;
  }
  element.dataset.touchMultiBound = "1";
  const active = new Map();
  let baseline = null;

  const forget = (event) => {
    active.delete(event.pointerId);
    if (active.size < 2) {
      baseline = null;
    }
  };

  element.addEventListener("pointerdown", (event) => {
    if (!nodeGraphTouchGestureIsTouch(event)) {
      return;
    }
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (active.size === 2) {
      baseline = nodeGraphTouchGesturePair(active);
    }
  });
  element.addEventListener("pointermove", (event) => {
    if (!active.has(event.pointerId)) {
      return;
    }
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = nodeGraphTouchGesturePair(active);
    if (!now || !baseline) {
      return;
    }
    const spread = Math.abs(now.distance - baseline.distance);
    const travel = Math.hypot(now.cx - baseline.cx, now.cy - baseline.cy);
    if (spread >= travel && spread > 2) {
      const scale = baseline.distance > 0 ? now.distance / baseline.distance : 1;
      handlers.onPinch?.({
        scale,
        centerX: now.cx,
        centerY: now.cy,
        distance: now.distance,
      });
    } else if (travel > spread && travel > 2) {
      handlers.onTwoFingerPan?.({
        dx: now.cx - baseline.cx,
        dy: now.cy - baseline.cy,
        centerX: now.cx,
        centerY: now.cy,
      });
    }
    baseline = now;
  });
  element.addEventListener("pointerup", forget);
  element.addEventListener("pointercancel", forget);
}

// PH-2: the first touch resumes the AudioContext on the gesture stack.
// One call site. Start/stop paths keep their own resume when they already own the context.
function nodeGraphTouchGestureUnlockAudio() {
  if (typeof nodeGraphLiveEnsureContextFromGesture === "function") {
    return nodeGraphLiveEnsureContextFromGesture();
  }
  return null;
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (event) => {
    if (!nodeGraphTouchGestureIsTouch(event)) {
      return;
    }
    nodeGraphTouchGestureUnlockAudio();
  }, true);
}
