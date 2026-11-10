import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc } from "../model.js";
import { applyFillet, filletRadiusForPoint, planFillet, planTrimCorner, planTrimSingle, trimToBoundary, trimToCorner } from "../trim-extend.js";

function near(actual, expected, msg = "") {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg} ${actual} vs ${expected}`);
}

function wall(id, x1, y1, x2, y2, extra = {}) {
  return { id, sku: "T220", x1, y1, x2, y2, status: "planned", ...extra };
}

function docWith(segments, extra = {}) {
  return { ...emptyDoc(), segments, ...extra };
}

function skuById(id) {
  if (id === "D1") return { id, category: "door", name: "Door" };
  if (id === "BEAM") return { id, category: "beam", name: "Beam", geometry: { width: 0.2 } };
  if (id === "FOUND") return { id, category: "foundation", name: "Strip", geometry: { width: 0.45, thickness: 0.2, depth: 0.45 } };
  if (id === "T220") return { id, category: "wall", name: "220", geometry: { thickness: 0.22 } };
  return null;
}

const pick = (refId, x, y) => ({ ref: { kind: "segment", id: refId }, pick: { x, y } });

test("a crossing trims both walls back to the corner, on the clicked sides", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 2, 1)], { skuById });
  assert.equal(result.ok, true);
  const a = doc.segments[0];
  const b = doc.segments[1];
  near(a.x1, 0);
  near(a.x2, 2);
  near(a.y1, 0);
  near(b.y1, 0);
  near(b.y2, 2);
  near(b.x1, 2);
});

test("the other click keeps the other half", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)]);
  const result = trimToCorner(doc, [pick("a", 3, 0), pick("b", 2, -1)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[0].x1, 2);
  near(doc.segments[0].x2, 4);
  near(doc.segments[1].y1, -2);
  near(doc.segments[1].y2, 0);
});

test("walls that stop short of the corner are extended to it", () => {
  const doc = docWith([wall("a", 0, 0, 1, 0), wall("b", 2, 1, 2, 3)]);
  const result = trimToCorner(doc, [pick("a", 0.5, 0), pick("b", 2, 2)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[0].x2, 2);
  near(doc.segments[0].y2, 0);
  near(doc.segments[1].y1, 0);
  near(doc.segments[1].x1, 2);
  near(doc.segments[1].y2, 3);
});

test("one wall is cut and the other is extended", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 2, 1, 2, 3)]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 2, 2)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[0].x2, 2);
  near(doc.segments[1].y1, 0);
  near(doc.segments[1].y2, 3);
});

test("a splayed wall meets the corner on the centreline", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 0, 2, 2, 1)]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 1, 1.5)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[0].x2, 4);
  near(doc.segments[1].x2, 4);
  near(doc.segments[1].y2, 0);
  near(doc.segments[1].x1, 0);
  near(doc.segments[1].y1, 2);
});

test("a face-drawn wall's centreline lands on the crossing", () => {
  const doc = docWith([
    { ...wall("a", 0, 0.11, 4, 0.11), location: "exterior" },
    wall("b", 2, 1, 2, 3),
  ]);
  const result = trimToCorner(doc, [pick("a", 1, 0.11), pick("b", 2, 2)], { skuById });
  assert.equal(result.ok, true);
  const a = doc.segments[0];
  near(a.x2, 2, "centreline end");
  near(a.y1, 0.11, "offset kept");
  near(a.y2, 0.11);
  assert.equal(a.location, "exterior");
  near(doc.segments[1].y1, 0.11);
});

test("a foundation trims the same way", () => {
  const doc = docWith([
    wall("a", 0, 0, 4, 0, { sku: "FOUND" }),
    wall("b", 2, -2, 2, 2, { sku: "FOUND" }),
  ]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 2, 1)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[0].x2, 2);
  near(doc.segments[1].y1, 0);
});

test("parallel walls are refused and left alone", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 0, 1, 4, 1)]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 1, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /parallel/);
  assert.equal(doc.segments[0].x2, 4);
  assert.equal(doc.segments[1].y1, 1);
});

test("the same wall twice is refused", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("a", 3, 0)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /different wall/);
  assert.equal(doc.segments[0].x2, 4);
});

test("a click on the crossing does not choose a side", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)]);
  const result = trimToCorner(doc, [pick("a", 2.02, 0), pick("b", 2, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /further along/);
  assert.equal(doc.segments[0].x2, 4);
});

test("a corner that would leave a stub under 300 mm is refused", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 3.8, -2, 3.8, 2)]);
  const result = trimToCorner(doc, [pick("a", 3.95, 0), pick("b", 3.8, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /too short/);
  assert.equal(doc.segments[0].x1, 0);
  assert.equal(doc.segments[0].x2, 4);
});

test("a door that would fall off stops the corner, and the other wall stays", () => {
  const doc = docWith(
    [wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)],
    {
      openings: [{ id: "d1", sku: "D1", wallId: "b", t: 0.25, status: "planned" }],
      finishRuns: [{ id: "run", wallId: "a", side: 1, a: 3, b: 3.5 }],
    },
  );
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 2, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /door/);
  assert.equal(doc.segments[0].x2, 4);
  assert.equal(doc.segments[1].y1, -2);
  assert.equal(doc.openings[0].t, 0.25);
  assert.equal(doc.finishRuns.length, 1);
  assert.equal(doc.finishRuns[0].a, 3);
});

test("walls on different floors are refused", () => {
  const doc = docWith([
    wall("a", 0, 0, 4, 0, { level: "ground" }),
    wall("b", 2, -2, 2, 2, { level: "first" }),
  ]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 2, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /different floors/);
});

test("a beam is not a wall", () => {
  const doc = docWith([
    wall("a", 0, 0, 4, 0, { sku: "BEAM" }),
    wall("b", 2, -2, 2, 2),
  ]);
  const result = trimToCorner(doc, [pick("a", 1, 0), pick("b", 2, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /walls and foundations/);
  assert.equal(doc.segments[0].x2, 4);
});

test("the preview names the same ends the commit will move", () => {
  const a = wall("a", 0, 0, 1, 0);
  const b = wall("b", 2, 1, 2, 3);
  const plan = planTrimCorner(a, b, { x: 0.5, y: 0 }, { x: 2, y: 2 });
  assert.equal(plan.ok, true);
  near(plan.cross.x, 2);
  near(plan.cross.y, 0);
  assert.equal(plan.moves[0].end, 2);
  assert.equal(plan.moves[1].end, 1);
});

// Trim single: the first wall is the boundary and never moves.
const boundaryPick = (refId) => ({ ref: { kind: "segment", id: refId } });

test("single: a partition stretches to the through wall and the through wall stays", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0), wall("part", 3, 2, 3, 4)]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 3)], { skuById });
  assert.equal(result.ok, true);
  assert.deepEqual(result.refs, [{ kind: "segment", id: "part" }]);
  near(doc.segments[1].y1, 0);
  near(doc.segments[1].x1, 3);
  near(doc.segments[1].y2, 4);
  assert.equal(doc.segments[0].x1, 0);
  assert.equal(doc.segments[0].x2, 6);
});

test("single: an overshooting wall is cut back on the clicked side", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0), wall("part", 3, -2, 3, 3)]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 2)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[1].y1, 0);
  near(doc.segments[1].y2, 3);
  assert.equal(doc.segments[0].x2, 6);
});

test("single: the other click keeps the other half", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0), wall("part", 3, -2, 3, 3)]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, -1)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[1].y1, -2);
  near(doc.segments[1].y2, 0);
});

test("single: a boundary shorter than the meeting point still counts", () => {
  const doc = docWith([wall("short", 0, 0, 1, 0), wall("part", 3, 2, 3, 4)]);
  const result = trimToBoundary(doc, [boundaryPick("short"), pick("part", 3, 3)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[1].y1, 0);
  assert.equal(doc.segments[0].x2, 1);
});

test("single: a face-drawn target keeps its offset and meets the centreline", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0), wall("part", 3, 2, 3, 4, { side: 1 })]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 3)], { skuById });
  assert.equal(result.ok, true);
  near(doc.segments[1].y1, 0);
});

test("single: parallel walls are refused and left alone", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 0, 1, 4, 1)]);
  const result = trimToBoundary(doc, [boundaryPick("a"), pick("b", 1, 1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /parallel/);
  assert.equal(doc.segments[1].x1, 0);
});

test("single: the same wall twice is refused", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0)]);
  const result = trimToBoundary(doc, [boundaryPick("a"), pick("a", 1, 0)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /different wall/);
});

test("single: a click on the crossing does not choose a side", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0), wall("part", 3, -2, 3, 3)]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 0.01)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /further along/);
  assert.equal(doc.segments[1].y1, -2);
});

test("single: a stub under 300 mm is refused", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0), wall("part", 3, -2, 3, 0.2)]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 0.15)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /too short/);
  assert.equal(doc.segments[1].y2, 0.2);
});

test("single: a door that would fall off stops the trim and nothing changes", () => {
  const doc = docWith(
    [wall("through", 0, 0, 6, 0), wall("part", 3, -2, 3, 3)],
    {
      openings: [{ id: "d1", sku: "D1", wallId: "part", t: 0.9, status: "planned" }],
      finishRuns: [{ id: "run", wallId: "through", side: 1, a: 3, b: 3.5 }],
    },
  );
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, -1)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /door/);
  assert.equal(doc.segments[0].x2, 6);
  assert.equal(doc.segments[1].y2, 3);
  assert.equal(doc.openings[0].t, 0.9);
  assert.equal(doc.finishRuns[0].a, 3);
});

test("single: walls on different floors are refused", () => {
  const doc = docWith([
    wall("through", 0, 0, 6, 0, { level: "ground" }),
    wall("part", 3, 2, 3, 4, { level: "first" }),
  ]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 3)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /different floors/);
});

test("single: a beam is not a wall", () => {
  const doc = docWith([wall("through", 0, 0, 6, 0, { sku: "BEAM" }), wall("part", 3, 2, 3, 4)]);
  const result = trimToBoundary(doc, [boundaryPick("through"), pick("part", 3, 3)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /walls and foundations/);
});

test("single: a meeting more than 80 m out is refused", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 200, 2, 200, 4)]);
  const result = trimToBoundary(doc, [boundaryPick("a"), pick("b", 200, 3)], { skuById });
  assert.equal(result.ok, false);
  assert.match(result.message, /too far/);
});

test("single: the preview names the same end the commit will move", () => {
  const through = wall("through", 0, 0, 6, 0);
  const part = wall("part", 3, 2, 3, 4);
  const plan = planTrimSingle(through, part, { x: 3, y: 3 });
  assert.equal(plan.ok, true);
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].id, "part");
  assert.equal(plan.moves[0].end, 1);
  near(plan.cross.x, 3);
  near(plan.cross.y, 0);
});

test("the cursor sets the fillet radius, and the arc passes through that point", () => {
  const a = wall("a", 0, 0, 4, 0);
  const b = wall("b", 0, 0, 0, 4);
  const mid = 0.6 * (Math.SQRT2 - 1);
  const onArc = filletRadiusForPoint(a, b, { x: 2, y: 0 }, { x: 0, y: 2 }, {
    x: mid / Math.SQRT2,
    y: mid / Math.SQRT2,
  });
  assert.equal(onArc.ok, true);
  near(onArc.radius, 0.6);
  const onWall = filletRadiusForPoint(a, b, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 1, y: 0 });
  assert.equal(onWall.ok, true);
  near(onWall.radius, 1);
  const acute = 0.5 * (Math.sqrt(3) / 2);
  const sixty = filletRadiusForPoint(
    wall("c", 0, 0, 4, 0),
    wall("d", 0, 0, 2, 2 * Math.sqrt(3)),
    { x: 2, y: 0 },
    { x: 1, y: Math.sqrt(3) },
    { x: acute, y: 0.25 },
  );
  assert.equal(sixty.ok, true);
  near(sixty.radius, 0.5);
  const plan = planFillet(a, b, { x: 2, y: 0 }, { x: 0, y: 2 }, onArc.radius);
  assert.equal(plan.ok, true);
  near(Math.hypot(plan.arc.cx - mid / Math.SQRT2, plan.arc.cy - mid / Math.SQRT2), plan.arc.radius);
  const outside = filletRadiusForPoint(a, b, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: -1, y: -1 });
  assert.equal(outside.ok, false);
});

test("fillet of a right angle sets both walls back by the radius and bows a quarter circle", () => {
  const a = wall("a", 0, 0, 4, 0);
  const b = wall("b", 0, 0, 0, 4);
  const plan = planFillet(a, b, { x: 2, y: 0 }, { x: 0, y: 2 }, 1);
  assert.equal(plan.ok, true);
  near(plan.moves[0].point.x, 1);
  near(plan.moves[0].point.y, 0);
  near(plan.moves[1].point.x, 0);
  near(plan.moves[1].point.y, 1);
  near(plan.arc.cx, 1);
  near(plan.arc.cy, 1);
  near(plan.arc.radius, 1);
  near(plan.arc.sweepDeg, 90);
  // The radius meets each wall at a right angle.
  near((plan.arc.cx - 1) * 1 + (plan.arc.cy - 0) * 0, 0);
  near((plan.arc.cx - 0) * 0 + (plan.arc.cy - 1) * 1, 0);
});

test("fillet extends walls that stop short of the corner", () => {
  const a = wall("a", 1.5, 0, 4, 0);
  const b = wall("b", 0, 2, 0, 4);
  const plan = planFillet(a, b, { x: 3, y: 0 }, { x: 0, y: 3 }, 1);
  assert.equal(plan.ok, true);
  near(plan.moves[0].point.x, 1);
  near(plan.moves[0].point.y, 0);
  near(plan.moves[1].point.x, 0);
  near(plan.moves[1].point.y, 1);
});

test("fillet refuses a radius that would eat the wall", () => {
  const a = wall("a", 0, 0, 1, 0);
  const b = wall("b", 0, 0, 0, 4);
  const plan = planFillet(a, b, { x: 0.6, y: 0 }, { x: 0, y: 2 }, 1);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /too large/);
});

test("fillet refuses a curved wall and a parallel pair", () => {
  const curved = planFillet(
    wall("a", 0, 0, 4, 0, { arc: { radius: 3, side: 1 } }),
    wall("b", 0, 0, 0, 4),
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    1,
  );
  assert.equal(curved.ok, false);
  assert.match(curved.message, /straight/);
  const parallel = planFillet(wall("a", 0, 0, 4, 0), wall("b", 0, 1, 4, 1), { x: 1, y: 0 }, { x: 1, y: 1 }, 1);
  assert.equal(parallel.ok, false);
  assert.match(parallel.message, /parallel/);
});

test("fillet trims the kept sides of a crossing and adds the arc wall", () => {
  const doc = docWith([wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)]);
  const plan = planFillet(doc.segments[0], doc.segments[1], { x: 1, y: 0 }, { x: 2, y: 1 }, 1);
  assert.equal(plan.ok, true);
  const segment = {
    id: "arc",
    sku: "T220",
    x1: plan.chord.x1,
    y1: plan.chord.y1,
    x2: plan.chord.x2,
    y2: plan.chord.y2,
    arc: plan.record,
  };
  const result = applyFillet(doc, plan, segment, { skuById });
  assert.equal(result.ok, true);
  const a = doc.segments[0];
  const b = doc.segments[1];
  near(a.x1, 0);
  near(a.x2, 1);
  near(a.y1, 0);
  near(b.x1, 2);
  near(b.y1, 1);
  near(b.y2, 2);
  assert.equal(doc.segments[2].id, "arc");
  assert.equal(doc.segments[2].arc.radius, 1);
});
