import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, rectShape } from "../model.js";
import { ALIGN_ORIGIN_MAX_M, GAP_MAX_M, applyNicePoint, bestEndpointSnap, collectSnapEdges, collectSnapTargets, faceCorners, isExactPointSnap, nearestAlignments, probeAlongEdge, probeAlongOccupiedEdge, probeDirection, resolveProbes, snapCoord, snapLengthFrom, snapNiceDelta, snapPoint } from "../snap.js";

function docWithWall(x1, y1, x2, y2, id = "s1") {
  const doc = emptyDoc();
  doc.segments.push({ id, sku: "wall", level: "l1", x1, y1, x2, y2, status: "planned" });
  return doc;
}

test("collectSnapTargets includes wall endpoints and skips excluded segments", () => {
  const doc = docWithWall(0, 0, 3, 0);
  doc.segments.push({ id: "s2", sku: "wall", level: "l1", x1: 3, y1: 0, x2: 3, y2: 3, status: "planned" });
  const all = collectSnapTargets(doc);
  assert.equal(all.length, 4);
  const filtered = collectSnapTargets(doc, { excludeSegmentIds: new Set(["s2"]) });
  assert.equal(filtered.length, 2);
});

test("collectSnapTargets can omit objects hidden by the status filter", () => {
  const doc = emptyDoc();
  doc.segments.push({ id: "s1", sku: "wall", level: "l1", x1: 0, y1: 0, x2: 3, y2: 0, status: "planned" });
  doc.segments.push({ id: "s2", sku: "wall", level: "l1", x1: 0, y1: 1, x2: 3, y2: 1, status: "existing" });
  const include = (obj) => obj.status === "existing";
  const points = collectSnapTargets(doc, { include });
  assert.equal(points.length, 2);
  assert.ok(points.every((p) => p.y === 1));
});

test("collectSnapTargets includes room, slab and roof corners", () => {
  const doc = emptyDoc();
  doc.rooms.push({ id: "r1", shape: rectShape(0, 0, 4, 3) });
  doc.slabs.push({ id: "sl1", shape: rectShape(5, 0, 2, 2) });
  doc.roofs.push({ id: "rf1", shape: rectShape(-0.4, -0.4, 8, 6.8) });
  const points = collectSnapTargets(doc);
  assert.equal(points.length, 12);
  assert.ok(points.some((p) => p.x === -0.4 && p.y === -0.4), "roof eaves are snap targets");
});

test("faceCorners offsets both ends by half the drawn thickness", () => {
  // A 600 mm strip footing running east: its visible corners sit 300 mm either
  // side of the centreline, which is the offset that used to show up as an
  // unexplained "300 mm" gap label with nothing snappable at it.
  const corners = faceCorners({ x1: 0, y1: 0, x2: 5, y2: 0 }, 0.6);
  assert.equal(corners.length, 4);
  assert.ok(corners.every((c) => c.kind === "face"));
  assert.ok(corners.some((c) => c.x === 0 && Math.abs(c.y - 0.3) < 1e-9));
  assert.ok(corners.some((c) => c.x === 0 && Math.abs(c.y + 0.3) < 1e-9));
  assert.ok(corners.some((c) => c.x === 5 && Math.abs(c.y - 0.3) < 1e-9));
  assert.ok(corners.some((c) => c.x === 5 && Math.abs(c.y + 0.3) < 1e-9));
});

test("faceCorners offsets perpendicular to the run, whatever its direction", () => {
  // Running north, so the faces are east/west - the offset follows the normal,
  // not a fixed axis.
  const corners = faceCorners({ x1: 2, y1: 0, x2: 2, y2: 4 }, 0.22);
  assert.ok(corners.some((c) => Math.abs(c.x - 1.89) < 1e-9 && c.y === 0));
  assert.ok(corners.some((c) => Math.abs(c.x - 2.11) < 1e-9 && c.y === 0));
});

test("faceCorners has nothing to offset without a thickness or a length", () => {
  assert.deepEqual(faceCorners({ x1: 0, y1: 0, x2: 5, y2: 0 }, 0), []);
  assert.deepEqual(faceCorners({ x1: 0, y1: 0, x2: 5, y2: 0 }, undefined), []);
  assert.deepEqual(faceCorners({ x1: 1, y1: 1, x2: 1, y2: 1 }, 0.6), []);
});

test("collectSnapTargets tags what each point is", () => {
  const doc = docWithWall(0, 0, 3, 0);
  doc.rooms.push({ id: "r1", shape: rectShape(0, 0, 4, 3) });
  doc.beams.push({ id: "b1", sku: "beam", level: "l1", x1: 0, y1: 5, x2: 2, y2: 5 });
  const kinds = new Set(collectSnapTargets(doc).map((p) => p.kind));
  assert.deepEqual([...kinds].sort(), ["corner", "endpoint"]);
});

test("collectSnapTargets adds face corners only when given a thickness resolver", () => {
  const doc = docWithWall(0, 0, 3, 0);
  // Without a resolver the centreline ends are still all there is, so callers
  // that never had pack access keep their old target set exactly.
  assert.equal(collectSnapTargets(doc).length, 2);

  const withFaces = collectSnapTargets(doc, { thicknessOf: () => 0.6 });
  assert.equal(withFaces.length, 6);
  assert.equal(withFaces.filter((p) => p.kind === "endpoint").length, 2);
  assert.equal(withFaces.filter((p) => p.kind === "face").length, 4);
});

test("collectSnapTargets skips faces for a segment whose SKU is unknown", () => {
  // segmentThickness() in ui.js returns 0 for an unresolved SKU, which must
  // read as "no faces" rather than a zero-width pair on the centreline.
  const doc = docWithWall(0, 0, 3, 0);
  const points = collectSnapTargets(doc, { thicknessOf: () => 0 });
  assert.equal(points.length, 2);
  assert.ok(points.every((p) => p.kind === "endpoint"));
});

test("collectSnapTargets tags wall/beam points with category when given a resolver", () => {
  const doc = docWithWall(0, 0, 3, 0, "s1");
  doc.segments.push({ id: "s2", sku: "footing", level: "l1", x1: 0, y1: 5, x2: 3, y2: 5, status: "planned" });
  doc.beams.push({ id: "b1", sku: "beam-a", level: "l1", x1: 0, y1: 10, x2: 2, y2: 10 });
  const categoryOf = (obj) => ({ wall: "wall", footing: "foundation", "beam-a": "beam" }[obj.sku] || null);
  const points = collectSnapTargets(doc, {
    thicknessOf: () => 0.6,
    categoryOf,
  });
  assert.ok(points.filter((p) => p.x === 0 && p.y === 0).every((p) => p.category === "wall"));
  assert.ok(points.some((p) => p.category === "foundation" && p.kind === "face"));
  assert.ok(points.some((p) => p.category === "beam" && p.kind === "endpoint"));
});

test("collectSnapTargets falls back to \"beam\" category without a resolver", () => {
  const doc = emptyDoc();
  doc.beams.push({ id: "b1", sku: "beam-a", level: "l1", x1: 0, y1: 0, x2: 2, y2: 0 });
  const points = collectSnapTargets(doc);
  assert.ok(points.every((p) => p.category === "beam"));
});

test("a face corner is joinable in its own right", () => {
  // The reported symptom: pointing at the visible corner of a 600 mm footing.
  // The centreline end is 300 mm away and far outside a tight tolerance, so
  // before faces were collected this could not snap to anything at all.
  const doc = docWithWall(0, 0, 5, 0);
  const targets = collectSnapTargets(doc, { thicknessOf: () => 0.6 });
  const join = snapPoint(0.002, 0.298, targets, 0.05);
  assert.equal(isExactPointSnap(join), true);
  assert.equal(join.x, 0);
  assert.ok(Math.abs(join.y - 0.3) < 1e-9);
  assert.equal(join.guideXPoint.kind, "face");
});

test("snapPoint joins onto the nearest target within tolerance", () => {
  const targets = [{ x: 3, y: 0 }, { x: 0, y: 3 }];
  const result = snapPoint(3.03, 0.02, targets, 0.1);
  assert.equal(result.snapped, true);
  assert.equal(result.x, 3);
  assert.equal(result.y, 0);
});

test("snapPoint falls back to a single-axis alignment guide", () => {
  // Close in X to a target that is far away in Y: no point join, but the X
  // coordinate should still snap to give an alignment guide.
  const targets = [{ x: 5, y: 9 }];
  const result = snapPoint(5.02, 0.5, targets, 0.1);
  assert.equal(result.snapped, true);
  assert.equal(result.x, 5);
  assert.equal(result.y, 0.5);
  assert.equal(result.guideX, 5);
  assert.equal(result.guideY, null);
  // The guide runs off to infinity on screen; guideXPoint is what lets a
  // caller say how far along it the actual target sits (here, 8.5 m away).
  assert.deepEqual(result.guideXPoint, { x: 5, y: 9 });
  assert.equal(result.guideYPoint, null);
});

test("snapPoint's exact point join reports the same point for both guides", () => {
  const targets = [{ x: 3, y: 0 }];
  const result = snapPoint(3.02, 0.02, targets, 0.1);
  assert.deepEqual(result.guideXPoint, { x: 3, y: 0 });
  assert.deepEqual(result.guideYPoint, { x: 3, y: 0 });
});

test("snapPoint reports no snap once nothing is within tolerance", () => {
  const targets = [{ x: 5, y: 5 }];
  const result = snapPoint(0, 0, targets, 0.1);
  assert.equal(result.snapped, false);
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
});

test("bestEndpointSnap picks whichever endpoint needs the smallest correction", () => {
  const targets = [{ x: 10, y: 0 }, { x: 4, y: 4 }];
  const points = [{ x: 10.05, y: 0 }, { x: 1, y: 1.5 }];
  const best = bestEndpointSnap(points, targets, 0.1);
  assert.ok(best);
  // The first point (10.05, 0) is 0.05 from (10, 0); the second point is
  // nowhere near either target in either axis, so the first must win.
  assert.equal(Math.round(best.dx * 100) / 100, -0.05);
  assert.equal(best.dy, 0);
});

test("bestEndpointSnap returns null when neither endpoint is close enough", () => {
  const targets = [{ x: 10, y: 10 }];
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.equal(bestEndpointSnap(points, targets, 0.1), null);
});

test("nearestAlignments measures both axes from the same nearby corner", () => {
  const targets = [{ x: 0, y: 0 }, { x: 4, y: 3 }];
  const result = nearestAlignments(1, 2, targets);
  // (0,0) is closer than (4,3), so both offsets belong to that corner —
  // not X from one point and Y from the other, which would invent a gap
  // in empty space.
  assert.equal(result.nearest.x, 0);
  assert.equal(result.nearest.y, 0);
  assert.equal(result.guideX, 0);
  assert.equal(result.guideY, 0);
  assert.equal(result.dx, 1);
  assert.equal(result.dy, 2);
});

test("nearestAlignments can measure to a wall face, not only a corner", () => {
  const result = nearestAlignments(1, 1.5, [], [{ x1: 0, y1: 0, x2: 0, y2: 3 }]);
  assert.equal(result.nearest.x, 0);
  assert.equal(result.nearest.y, 1.5);
  assert.equal(result.dx, 1);
  assert.equal(result.dy, 0);
});

test("collectSnapEdges includes room sides", () => {
  const doc = emptyDoc();
  doc.rooms.push({ id: "r1", shape: rectShape(0, 0, 4, 3) });
  const edges = collectSnapEdges(doc);
  assert.equal(edges.length, 4);
});

test("probeDirection measures each side of a point independently", () => {
  // A point between two horizontal walls: the nearest-object measurement can
  // only ever report the closer one, while the probes report both.
  const edges = [
    { x1: 0, y1: 0, x2: 4, y2: 0 },
    { x1: 0, y1: 5, x2: 4, y2: 5 },
  ];
  const up = probeDirection(2, 1, "up", edges);
  const down = probeDirection(2, 1, "down", edges);
  assert.equal(up.dist, 1);
  assert.deepEqual(up.hit, { x: 2, y: 0 });
  assert.equal(down.dist, 4);
  assert.deepEqual(down.hit, { x: 2, y: 5 });
});

test("probeDirection hits a wall face part-way along an edge", () => {
  const edges = [{ x1: 6, y1: 0, x2: 6, y2: 4 }];
  const right = probeDirection(1, 2.5, "right", edges);
  assert.deepEqual(right.hit, { x: 6, y: 2.5 });
  assert.equal(right.dist, 5);
});

test("probeDirection reports nothing for an empty side", () => {
  const edges = [{ x1: 6, y1: 0, x2: 6, y2: 4 }];
  assert.equal(probeDirection(1, 2.5, "left", edges), null);
  // Parallel to the ray, so it is not something the probe can cross.
  assert.equal(probeDirection(1, 2.5, "up", [{ x1: 0, y1: 1, x2: 4, y2: 1 }]).dist, 1.5);
  assert.equal(probeDirection(1, 2.5, "right", [{ x1: 0, y1: 2.5, x2: 4, y2: 2.5 }]), null);
});

test("probeDirection ignores edges behind the ray and the one it stands on", () => {
  const edges = [{ x1: 0, y1: 0, x2: 0, y2: 4 }];
  assert.equal(probeDirection(0, 2, "left", edges), null);
  assert.equal(probeDirection(0, 2, "right", edges), null);
});

test("probeAlongEdge measures to where the reference wall ends", () => {
  // The wall found by a "left" probe: measuring up/down off it should report
  // how far along it the point sits, not cast a fresh ray into empty site.
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  const up = probeAlongEdge(2, 4, "up", wall);
  const down = probeAlongEdge(2, 4, "down", wall);
  assert.equal(up.dist, 3);
  assert.deepEqual(up.hit, { x: 2, y: 1 });
  assert.equal(down.dist, 2);
  assert.deepEqual(down.hit, { x: 2, y: 6 });
  assert.equal(up.alongEdge, true);
});

test("probeAlongEdge picks the nearer end when both lie the same way", () => {
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  const up = probeAlongEdge(2, 9, "up", wall);
  assert.equal(up.dist, 3);
  assert.deepEqual(up.hit, { x: 2, y: 6 });
});

test("probeAlongEdge reports nothing when the wall only ends the other way", () => {
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  assert.equal(probeAlongEdge(2, 0, "up", wall), null);
  assert.equal(probeAlongEdge(2, 4, "up", null), null);
});

test("probeAlongOccupiedEdge measures along the wall the point sits on", () => {
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  const down = probeAlongOccupiedEdge(2, 3, "down", [wall]);
  const up = probeAlongOccupiedEdge(2, 3, "up", [wall]);
  assert.equal(down.dist, 3);
  assert.deepEqual(down.hit, { x: 2, y: 6 });
  assert.equal(up.dist, 2);
  assert.deepEqual(up.hit, { x: 2, y: 1 });
  assert.equal(probeAlongOccupiedEdge(5, 3, "down", [wall]), null);
});

test("resolveProbes on a wall reports up/down along that wall", () => {
  // Foundation-under-a-wall: the cursor is on the wall, so a down/up ray
  // cannot cross it. The measurement still has to be the remaining run.
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  const down = resolveProbes(2, 3, ["down"], [wall]);
  assert.equal(down.length, 1);
  assert.equal(down[0].dist, 3);
  assert.deepEqual(down[0].to, { x: 2, y: 6 });
  const up = resolveProbes(2, 3, ["up"], [wall]);
  assert.equal(up[0].dist, 2);
  assert.deepEqual(up[0].to, { x: 2, y: 1 });
});

test("resolveProbes prefers the occupied wall over an opposite wall's end", () => {
  const here = { x1: 0, y1: 0, x2: 0, y2: 5 };
  const opposite = { x1: 4, y1: 1, x2: 4, y2: 2 };
  const probes = resolveProbes(0, 2, ["down", "right"], [here, opposite]);
  const down = probes.find((p) => p.side === "down");
  const right = probes.find((p) => p.side === "right");
  assert.equal(right.dist, 4);
  // Down must be the remaining 3 m of *this* wall, not the 0 m leftover
  // of the short wall on the right.
  assert.equal(down.dist, 3);
  assert.deepEqual(down.to, { x: 0, y: 5 });
});

test("resolveProbes still measures along a wall found only by the other axis", () => {
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  const probes = resolveProbes(5, 4, ["left", "up"], [wall]);
  const left = probes.find((p) => p.side === "left");
  const up = probes.find((p) => p.side === "up");
  assert.equal(left.dist, 3);
  assert.equal(up.dist, 3);
  assert.deepEqual(up.from, { x: 2, y: 4 });
  assert.deepEqual(up.to, { x: 2, y: 1 });
});

test("probeDirection reports the edge it hit, so the other axis can use it", () => {
  const wall = { x1: 2, y1: 1, x2: 2, y2: 6 };
  const left = probeDirection(5, 4, "left", [wall]);
  assert.deepEqual(left.edge, wall);
});

test("nearestAlignments is empty when there is nothing to track", () => {
  const result = nearestAlignments(1, 1, []);
  assert.equal(result.guideX, null);
  assert.equal(result.guideY, null);
  assert.equal(result.dx, null);
  assert.equal(result.dy, null);
  assert.equal(result.nearest, null);
});

test("snapCoord prefers a round millimetre offset from an off-grid origin", () => {
  // A wall that started at 1.007 m: 3503 mm along it is closer to 3500 than
  // to a world-grid neighbour, so the magnet should land on 3500 mm.
  const origin = 1.007;
  const value = origin + 3.503;
  const snapped = snapCoord(value, [origin, 0], 0.05);
  assert.ok(Math.abs((snapped - origin) - 3.5) < 1e-9);
});

test("snapCoord still allows a 1 mm value once the magnet is tight", () => {
  // Zoomed in, 3507 mm is more than 40% of a 10 mm step from 3510, so it
  // must remain selectable rather than being forced onto 3500 / 3510.
  const snapped = snapNiceDelta(3.507, 0.0005);
  assert.ok(Math.abs(snapped - 3.507) < 1e-9);
});

test("snapLengthFrom pulls a diagonal run onto a round length", () => {
  const from = { x: 1.007, y: 2 };
  const to = { x: 1.007 + 3.503, y: 2 + 0.004 };
  const snapped = snapLengthFrom(from, to, 0.05);
  const len = Math.hypot(snapped.x - from.x, snapped.y - from.y);
  assert.ok(Math.abs(len - 3.5) < 1e-9);
});

test("applyNicePoint does not break an exact endpoint join", () => {
  const join = snapPoint(3.02, 0.02, [{ x: 3, y: 0 }], 0.1);
  const point = applyNicePoint(3.02, 0.02, {
    join,
    from: { x: 0, y: 0 },
    originsX: [0],
    originsY: [0],
    tolWorld: 0.1,
  });
  assert.equal(point.x, 3);
  assert.equal(point.y, 0);
});

test("isExactPointSnap is true only for a same-point join on both axes", () => {
  const join = snapPoint(3.02, 0.02, [{ x: 3, y: 0 }], 0.1);
  assert.equal(isExactPointSnap(join), true);

  const alignment = snapPoint(5.02, 0.5, [{ x: 5, y: 9 }], 0.1);
  assert.equal(isExactPointSnap(alignment), false);

  const nothing = snapPoint(0, 0, [{ x: 5, y: 5 }], 0.1);
  assert.equal(isExactPointSnap(nothing), false);
});

test("ALIGN_ORIGIN_MAX_M is tighter than GAP_MAX_M", () => {
  // The gap-dimension label is fine to draw from well across the site, but
  // an edge-alignment point that far away must not be trusted as the
  // anchor for round-length snapping - see applySnap() in ui.js, which
  // gates the two at these two different radii.
  assert.ok(ALIGN_ORIGIN_MAX_M < GAP_MAX_M);
});

test("nearestAlignments beyond ALIGN_ORIGIN_MAX_M is still reported, for the caller to filter", () => {
  // nearestAlignments itself has no opinion on the radius - it just reports
  // the closest point/edge and lets the caller (applySnap) decide which of
  // its two thresholds applies.
  const edges = [{ x1: 0, y1: 0, x2: 0, y2: 10 }];
  const result = nearestAlignments(2.5, 5, [], edges);
  assert.ok(result.dist > ALIGN_ORIGIN_MAX_M);
  assert.ok(result.dist <= GAP_MAX_M);
  assert.deepEqual(result.nearest, { x: 0, y: 5 });
});

test("applyNicePoint keeps an X alignment and rounds the free length", () => {
  const join = snapPoint(5.02, 3.503, [{ x: 5, y: 9 }], 0.1);
  const from = { x: 5, y: 0 };
  const point = applyNicePoint(5.02, 3.503, {
    join,
    from,
    originsX: [0, from.x],
    originsY: [0, from.y],
    tolWorld: 0.05,
  });
  assert.equal(point.x, 5);
  assert.ok(Math.abs(point.y - 3.5) < 1e-9);
});
