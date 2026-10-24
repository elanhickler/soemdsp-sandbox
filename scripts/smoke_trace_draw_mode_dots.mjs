// Isolated-sample packing for Trace Draw=Dots (TraceWoscope collectSegments).
function collectSegments(points, options) {
  const segs = [];
  const samplesOnly = options?.samplesOnly === true;
  let realTotal = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) realTotal += 1;
  }
  let prev = null;
  let prevT = 0;
  let prevConnected = false;
  let realIndex = 0;
  const flushIsolated = () => {
    if (prev && !prevConnected) {
      segs.push(prev.x, prev.y, prev.x, prev.y, prevT, prevT);
    }
  };
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      flushIsolated();
      prev = null;
      prevConnected = false;
      continue;
    }
    const t = realTotal > 1 ? realIndex / (realTotal - 1) : 1;
    if (samplesOnly) {
      segs.push(p.x, p.y, p.x, p.y, t, t);
      prev = null;
      prevConnected = false;
    } else if (prev) {
      segs.push(prev.x, prev.y, p.x, p.y, prevT, t);
      prev = p;
      prevT = t;
      prevConnected = true;
    } else {
      prev = p;
      prevT = t;
      prevConnected = false;
    }
    realIndex += 1;
  }
  flushIsolated();
  return segs;
}

function isolate(points) {
  const out = [];
  for (const p of points) {
    if (out.length) out.push(null);
    out.push(p);
  }
  return out;
}

const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }];
const connected = collectSegments(line, {});
if (connected.length !== 12) {
  throw new Error(`connected segs expected 2*6 floats, got ${connected.length}`);
}
if (connected[0] !== 0 || connected[2] !== 10) {
  throw new Error("connected first segment should span 0→10");
}

const dotted = collectSegments(line, { samplesOnly: true });
if (dotted.length !== 18) {
  throw new Error(`dots samplesOnly expected 3 degenerate segs, got ${dotted.length / 6}`);
}
for (let i = 0; i < 3; i += 1) {
  const o = i * 6;
  if (dotted[o] !== dotted[o + 2] || dotted[o + 1] !== dotted[o + 3]) {
    throw new Error(`dot ${i} is a chord, not a stamp`);
  }
}

const isolated = collectSegments(isolate(line), {});
if (isolated.length !== 18) {
  throw new Error(`isolated path expected 3 stamps, got ${isolated.length / 6}`);
}
for (let i = 0; i < 3; i += 1) {
  const o = i * 6;
  if (isolated[o] !== isolated[o + 2] || isolated[o + 1] !== isolated[o + 3]) {
    throw new Error(`isolated ${i} connected to the next sample`);
  }
}

console.log("smoke_trace_draw_mode_dots: ok");
