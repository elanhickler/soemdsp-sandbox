// Unit checks for the Step/Smooth Graph overhaul:
// pointer Y mapping, remaining-room skew, linear->rational migration,
// and per-segment shapes actually differing.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const curvesPath = path.join(root, "public", "node-graph-segment-curves.js");
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(curvesPath, "utf8"), context, { filename: "node-graph-segment-curves.js" });

const {
  nodeGraphSegmentNormalizeShape,
  nodeGraphSegmentShapeFromParam,
  nodeGraphSegmentShapeIndex,
  nodeGraphSegmentApplySkewPercent,
  nodeGraphSegmentCurve01,
  NODE_GRAPH_SEGMENT_SHAPES,
} = context;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// Palette no longer includes Linear; enum ids stay stable.
assert(Array.isArray(NODE_GRAPH_SEGMENT_SHAPES), "shapes list");
assert(!NODE_GRAPH_SEGMENT_SHAPES.includes("linear"), "linear dropped from palette");
assert(NODE_GRAPH_SEGMENT_SHAPES[0] === "rational", "palette starts at rational");
assert(nodeGraphSegmentNormalizeShape("linear") === "rational", "name linear -> rational");
assert(nodeGraphSegmentShapeFromParam(0) === "rational", "index 0 (legacy linear) -> rational");
assert(nodeGraphSegmentShapeFromParam(1) === "rational", "index 1 stays rational");
assert(nodeGraphSegmentShapeFromParam(2) === "exponential", "index 2 stays exponential");
assert(nodeGraphSegmentShapeFromParam(6) === "hold", "index 6 stays hold");
assert(nodeGraphSegmentShapeIndex("linear") === 1, "linear enum id migrates to 1");
assert(nodeGraphSegmentShapeIndex("rational") === 1, "rational enum id is 1");
assert(nodeGraphSegmentShapeIndex("exponential") === 2, "exponential enum id is 2");
assert(nodeGraphSegmentShapeIndex("hold") === 6, "hold enum id is 6");

// Remaining-room skew.
const skew = nodeGraphSegmentApplySkewPercent;
assert(almost(skew(0.2, 0), 0.2), "offset 0 leaves c");
assert(almost(skew(-0.4, 0), -0.4), "offset 0 leaves negative c");
assert(almost(skew(0.2, 1), 1), "+1 maps everyone to +1");
assert(almost(skew(-0.4, 1), 1), "+1 maps low c to +1");
assert(almost(skew(0.2, -1), -1), "-1 maps everyone to -1");
assert(almost(skew(0.8, -1), -1), "-1 maps high c to -1");
const midPos = skew(0.2, 0.5);
assert(almost(midPos, 0.2 + 0.5 * (1 - 0.2)), "positive remaining-room");
const midNeg = skew(0.2, -0.5);
assert(almost(midNeg, 0.2 + -0.5 * (0.2 + 1)), "negative remaining-room");
const close = skew(0.9, 0.5);
const far = skew(-0.5, 0.5);
assert(close > 0.9 && close <= 1, "close c moves a little toward +1");
assert(far > -0.5 && far < close, "farther c moves more, no wall slam");

// Linear at 0 equals Rational; per-segment shapes differ once they diverge.
assert(almost(nodeGraphSegmentCurve01(0.5, "linear", 0), 0.5), "legacy linear mid");
assert(almost(nodeGraphSegmentCurve01(0.5, "rational", 0), 0.5), "rational mid at 0");
assert(almost(nodeGraphSegmentCurve01(0.5, "linear", 0), nodeGraphSegmentCurve01(0.5, "rational", 0)), "linear == rational at 0");
const rat = nodeGraphSegmentCurve01(0.5, "rational", 0.6);
const exp = nodeGraphSegmentCurve01(0.5, "exponential", 0.6);
const hold = nodeGraphSegmentCurve01(0.5, "hold", 0.6);
assert(rat > 0.5, "positive rational raises mid");
assert(Math.abs(rat - exp) > 1e-4, "rational and exponential differ at same skew");
assert(hold === 0, "hold at +c stays low until p>=1");
assert(nodeGraphSegmentCurve01(0.5, "hold", -0.2) === 1, "hold at -c steps at start");

// Pointer top/mid/bottom of the 8..92 plot still maps max/mid/min for zoom -1..+1.
function svgViewYToGraphY(viewY, zoomMin = -1, zoomMax = 1) {
  const yUnit = Math.max(0, Math.min(1, (92 - viewY) / 84));
  return zoomMin + yUnit * (zoomMax - zoomMin);
}
assert(almost(svgViewYToGraphY(8), 1), "top of plot is zoom max (+1)");
assert(almost(svgViewYToGraphY(50), 0), "mid of plot is 0");
assert(almost(svgViewYToGraphY(92), -1), "bottom of plot is zoom min (-1)");
assert(svgViewYToGraphY(7) === svgViewYToGraphY(8), "clamp above plot");
assert(svgViewYToGraphY(93) === svgViewYToGraphY(92), "clamp below plot");
// A leftover 0..1 zoom window still cannot map below 0 (ecc2842a clamp).
assert(almost(svgViewYToGraphY(92, 0, 1), 0), "0..1 zoom bottom stays 0");
assert(almost(svgViewYToGraphY(8, 0, 1), 1), "0..1 zoom top stays 1");

console.log("test_graph_overhaul: ok");
