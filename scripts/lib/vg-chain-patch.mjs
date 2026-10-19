// The `vg-chain` test patch (docs/VIDEO_GRAPH_PLAN.md), built in memory from
// softpop's output node. Shared by probe_video_graph.mjs and probe_zoom_perf.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const VG_CHAIN_EDGES = [
  ["fbm-1", "vd-1"], ["vd-1", "ib-1"], ["vf-1", "ib-2"], ["vd-3", "ib-3"], ["ib-3", "vd-3"], ["fbm-far", "vd-far"], ["vd-x", "ib-x"],
];
export function vgChainPatch() {
  const d = JSON.parse(fs.readFileSync(path.join(root, "patches/livedemos/softpop.json"), "utf8"));
  d.nodes = d.nodes.filter((n) => n.id === "output").map((n) => ({ ...n, gx: 26, gy: 1 }));
  d.connections = [];
  d.graphConnections = [];
  d.modulations = [];
  const at = (id, type, gx, gy) => d.nodes.push({ gx, gy, id, type });
  at("fbm-1", "fbmField", 1, 1);
  at("vd-1", "videoDelay", 7, 1);
  at("ib-1", "imageBurn", 13, 1);
  at("vd-far", "videoDelay", 19, 1);
  at("vf-1", "videoFeedback", 1, 17);
  at("ib-2", "imageBurn", 7, 17);
  at("vd-3", "videoDelay", 13, 17);
  at("ib-3", "imageBurn", 19, 17);
  at("fbm-far", "fbmField", 400, 1);
  // No cable out: VG-2 says these publish nothing.
  at("fbm-solo", "fbmField", 38, 1);
  at("rf-solo", "rgbFractal", 44, 1);
  at("vf-solo", "videoFeedback", 26, 17);
  at("vd-solo", "videoDelay", 32, 17);
  at("ib-solo", "imageBurn", 38, 17);
  // VG-6 audio handoff: a 1 Hz sine drives Video Delay X on a delay parked
  // far off screen (asleep) whose picture feeds a visible Image Burn.
  d.nodes.push({ gx: 44, gy: 17, id: "sw-1", type: "sineWavetable", params: { frequency: 1, mode: 0, amplitude: 0.7 } });
  at("vd-x", "videoDelay", 400, 17);
  at("ib-x", "imageBurn", 44, 1);
  for (const [a, b] of VG_CHAIN_EDGES) {
    d.connections.push({ sourceNode: a, sourcePort: "rgba", destinationNode: b, destinationPort: "rgba", tracePoints: [] });
  }
  d.connections.push({ sourceNode: "sw-1", sourcePort: "A", destinationNode: "vd-x", destinationPort: "X", tracePoints: [] });
  return JSON.stringify(d);
}
