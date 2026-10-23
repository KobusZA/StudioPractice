import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeServices } from "../service-model.js";
import { addRoutePoint, createNetwork, setEdgeChase, splitServiceEdge } from "../services.js";
import {
  justifyPoint,
  pipeRadius,
  runWallRelation,
  serviceWallFlags,
  setRunClearance,
} from "../service-walls.js";
import { serviceInspectorModel, servicePanelHtml } from "../service-panel.js";

const pack = {
  system: { defaultLevel: "L0" },
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  skus: [
    { id: "P110", name: "Pipe 110", unit: "m", draw: "pipe", geometry: { diameter: 0.11 }, schedule: { report: ["length"] } },
    { id: "P110I", name: "Pipe 110 insulated", unit: "m", draw: "pipe", geometry: { diameter: 0.11, insulation: 0.02 }, schedule: { report: ["length"] } },
    { id: "NOSIZE", name: "Unsized", unit: "m", draw: "pipe", schedule: { report: ["length"] } },
  ],
};

// A 200 mm wall along y = 0 from x = 0 to 10.
const wall = { id: "w1", x1: 0, y1: 0, x2: 10, y2: 0, thickness: 0.2 };

function docWithRun(y, sku = "P110I", y2 = y) {
  const doc = { serviceNetworks: [], serviceNodes: [], serviceEdges: [], segments: [], items: [] };
  const net = createNetwork(doc, { system: "coldWater" });
  const route = { networkId: net.id, level: "L0", offset: 0, sku, mode: "measured" };
  const a = addRoutePoint(doc, pack, route, { x: 2, y });
  const b = addRoutePoint(doc, pack, { ...route, fromNodeId: a.nodeId }, { x: 8, y: y2 });
  return { doc, edgeId: b.edgeId };
}

test("pipe radius is the stated diameter plus insulation, and null when unstated", () => {
  assert.equal(pipeRadius(pack, { sku: "P110" }), 0.055);
  assert.ok(Math.abs(pipeRadius(pack, { sku: "P110I" }) - 0.075) < 1e-12);
  assert.equal(pipeRadius(pack, { sku: "NOSIZE" }), null);
  assert.equal(pipeRadius(pack, { sku: null }), null);
});

test("clearance is measured from the pipe edge to the wall face", () => {
  // Centreline 0.325 m out: face at 0.1, insulation edge at 0.325 - 0.075 = 0.25 -> 150 mm.
  const rel = runWallRelation([wall], { x: 2, y: 0.325 }, { x: 8, y: 0.325 }, 0.075);
  assert.equal(rel.state, "clear");
  assert.ok(Math.abs(rel.clearance - 0.15) < 1e-9);
  assert.ok(Math.abs(rel.centre - 0.225) < 1e-9);
});

test("a run with no stated size is measured as a line", () => {
  const rel = runWallRelation([wall], { x: 2, y: 0.3 }, { x: 8, y: 0.3 }, null);
  assert.equal(rel.radius, null);
  assert.ok(Math.abs(rel.clearance - 0.2) < 1e-9);
});

test("a run across a wall is a crossing, not alongside it", () => {
  assert.equal(runWallRelation([wall], { x: 5, y: -2 }, { x: 5, y: 2 }, 0.075), null);
});

test("inside, partial and clear are told apart", () => {
  assert.equal(runWallRelation([wall], { x: 2, y: 0 }, { x: 8, y: 0 }, 0.055).state, "inside");
  assert.equal(runWallRelation([wall], { x: 2, y: 0.08 }, { x: 8, y: 0.08 }, 0.075).state, "partial");
  assert.equal(runWallRelation([wall], { x: 2, y: 0.4 }, { x: 8, y: 0.4 }, 0.075).state, "clear");
  // A 150 mm pipe does not fit a 200 mm wall with room to spare: it is "inside" only if it does fit.
  assert.equal(runWallRelation([wall], { x: 2, y: 0 }, { x: 8, y: 0 }, 0.075).state, "inside");
  assert.equal(runWallRelation([wall], { x: 2, y: 0 }, { x: 8, y: 0 }, 0.12).state, "partial");
});

test("a run inside a wall is an obstruction until it is marked as a chase", () => {
  const { doc, edgeId } = docWithRun(0, "P110");
  let flags = serviceWallFlags(doc, pack, [wall], "L0");
  assert.equal(flags.get(edgeId).level, "obstruction");
  setEdgeChase(doc, [edgeId], true);
  flags = serviceWallFlags(doc, pack, [wall], "L0");
  assert.equal(flags.get(edgeId).level, "chase");
  setEdgeChase(doc, [edgeId], false);
  assert.equal(doc.serviceEdges[0].chase, undefined);
});

test("a chase must hold the whole pipe, and a chase outside a wall is flagged", () => {
  const partial = docWithRun(0.08, "P110I");
  setEdgeChase(partial.doc, [partial.edgeId], true);
  assert.equal(serviceWallFlags(partial.doc, pack, [wall], "L0").get(partial.edgeId).level, "warn");
  const clear = docWithRun(0.5, "P110");
  setEdgeChase(clear.doc, [clear.edgeId], true);
  assert.equal(serviceWallFlags(clear.doc, pack, [wall], "L0").get(clear.edgeId).level, "warn");
});

test("a clear run raises no flag", () => {
  const { doc, edgeId } = docWithRun(0.5, "P110");
  assert.equal(serviceWallFlags(doc, pack, [wall], "L0").get(edgeId).level, null);
});

test("typing a clearance slides the run to that gap, on the side it is on", () => {
  const { doc, edgeId } = docWithRun(0.5, "P110I");
  const res = setRunClearance(doc, pack, [wall], edgeId, 150, "L0");
  assert.equal(res.ok, true);
  const [a, b] = doc.serviceNodes;
  // face 0.1 + clearance 0.15 + radius 0.075
  assert.ok(Math.abs(a.y - 0.325) < 1e-9);
  assert.ok(Math.abs(b.y - 0.325) < 1e-9);
  assert.equal(a.x, 2);
  // The other side of the wall stays the other side.
  const below = docWithRun(-0.5, "P110I");
  setRunClearance(below.doc, pack, [wall], below.edgeId, 150, "L0");
  assert.ok(Math.abs(below.doc.serviceNodes[0].y + 0.325) < 1e-9);
});

test("clearance edits refuse nonsense and runs with no wall alongside", () => {
  const { doc, edgeId } = docWithRun(0.5);
  assert.equal(setRunClearance(doc, pack, [wall], edgeId, -5, "L0").ok, false);
  assert.equal(setRunClearance(doc, pack, [wall], edgeId, NaN, "L0").ok, false);
  assert.equal(setRunClearance(doc, pack, [], edgeId, 100, "L0").ok, false);
  const onLine = docWithRun(0, "P110");
  assert.equal(setRunClearance(onLine.doc, pack, [wall], onLine.edgeId, 100, "L0").ok, false);
});

test("justification puts the pipe edge the chosen distance off the face, on the pointer's side", () => {
  const up = justifyPoint([wall], 5, 0.3, { mode: "clear", offset: 0.15, radius: 0.075 });
  assert.ok(Math.abs(up.y - 0.325) < 1e-9);
  assert.equal(up.x, 5);
  const down = justifyPoint([wall], 5, -0.3, { mode: "clear", offset: 0.15, radius: 0.075 });
  assert.ok(Math.abs(down.y + 0.325) < 1e-9);
});

test("justification leaves a far point alone, and a point past the wall's end", () => {
  assert.equal(justifyPoint([wall], 5, 3, { mode: "clear", offset: 0.15, radius: 0.075 }), null);
  assert.equal(justifyPoint([wall], 12, 0.3, { mode: "clear", offset: 0.15, radius: 0.075 }), null);
  assert.equal(justifyPoint([wall], 5, 0.3, { mode: "off" }), null);
});

test("the in-wall mode lands on the centreline, and nowhere else", () => {
  const p = justifyPoint([wall], 5, 0.12, { mode: "centre" });
  assert.equal(p.y, 0);
  assert.equal(p.x, 5);
  assert.equal(justifyPoint([wall], 5, 3, { mode: "centre" }), null);
});

test("the chase flag is stored only when true, and survives a split and a reload", () => {
  const { doc, edgeId } = docWithRun(0, "P110");
  setEdgeChase(doc, [edgeId], true);
  assert.equal(splitServiceEdge(doc, pack, edgeId, { x: 5, y: 0 }).ok, true);
  assert.deepEqual(doc.serviceEdges.map((e) => e.chase), [true, true]);
  const again = normalizeServices(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(again.serviceEdges.map((e) => e.chase), [true, true]);
  setEdgeChase(doc, doc.serviceEdges.map((e) => e.id), false);
  assert.ok(doc.serviceEdges.every((e) => !("chase" in e)));
});

test("the inspector reports the wall alongside and offers the clearance field", () => {
  const { doc, edgeId } = docWithRun(0.325, "P110I");
  const ctx = { walls: [wall], levelId: "L0" };
  const model = serviceInspectorModel(doc, pack, [{ kind: "serviceEdge", id: edgeId }], ctx);
  assert.equal(model.single.wall.clearanceMm, 150);
  const html = servicePanelHtml({ doc, pack, ui: { system: "coldWater" }, model, showRoute: false, connectHint: "" });
  assert.match(html, /data-svc="edge-clearance"[^>]*value="150"/);
  assert.match(html, /data-svc="edge-chase"/);
  // No walls: no wall block at all.
  const bare = serviceInspectorModel(doc, pack, [{ kind: "serviceEdge", id: edgeId }]);
  assert.equal(bare.single.wall, null);
});

test("an inside run's panel shows an obstruction until it is a chase", () => {
  const { doc, edgeId } = docWithRun(0, "P110");
  const ctx = { walls: [wall], levelId: "L0" };
  const refs = [{ kind: "serviceEdge", id: edgeId }];
  assert.equal(serviceInspectorModel(doc, pack, refs, ctx).single.wall.tone, "warn");
  setEdgeChase(doc, [edgeId], true);
  const model = serviceInspectorModel(doc, pack, refs, ctx);
  assert.equal(model.chase, true);
  assert.equal(model.single.wall.tone, "ok");
});
