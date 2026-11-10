import { test } from "node:test";
import assert from "node:assert/strict";

import { gapMoveDelta, joinWallCorners, selectionAngleJoint, selectionSideGaps } from "../walls.js";

function wall(id, x1, y1, x2, y2, level = "l1") {
  return { id, x1, y1, x2, y2, level, length: Math.hypot(x2 - x1, y2 - y1) };
}

test("joinWallCorners pulls a near-miss corner onto one shared point", () => {
  // Two foundation legs drawn to meet at (6.5, 0), but the vertical leg's
  // top actually landed 4 mm off - the single-axis alignment guide slop
  // this fix exists for.
  const walls = [
    wall("top", 0, 0, 6.5, 0),
    wall("side", 6.504, 0, 6.5, -3),
  ];
  const joined = joinWallCorners(walls, 0.006);
  assert.equal(joined[0].x2, joined[1].x1);
  assert.equal(joined[0].y2, joined[1].y1);
  // The shared point is the average of the two near-miss corners, not one
  // side winning outright.
  assert.ok(Math.abs(joined[0].x2 - 6.502) < 1e-9);
});

test("joinWallCorners leaves already-exact corners untouched", () => {
  const walls = [
    wall("a", 0, 0, 6, 0),
    wall("b", 6, 0, 6, 6),
  ];
  const joined = joinWallCorners(walls, 0.006);
  assert.deepEqual(joined[0], walls[0]);
  assert.deepEqual(joined[1], walls[1]);
});

test("joinWallCorners never merges corners farther apart than the tolerance", () => {
  const walls = [
    wall("a", 0, 0, 5, 0),
    wall("b", 5.05, 0, 5.05, 5),
  ];
  const joined = joinWallCorners(walls, 0.006);
  assert.equal(joined[0].x2, 5);
  assert.equal(joined[1].x1, 5.05);
});

test("joinWallCorners keeps walls on different levels from joining", () => {
  const walls = [
    wall("a", 0, 0, 6.003, 0, "l1"),
    wall("b", 6, 0, 6, 6, "l2"),
  ];
  const joined = joinWallCorners(walls, 0.006);
  assert.equal(joined[0].x2, 6.003);
  assert.equal(joined[1].x1, 6);
});

test("joinWallCorners recomputes length after moving an endpoint", () => {
  const walls = [
    wall("a", 0, 0, 5.003, 0),
    wall("b", 5, 0, 5, 5),
  ];
  const joined = joinWallCorners(walls, 0.006);
  assert.ok(Math.abs(joined[0].length - Math.hypot(joined[0].x2 - joined[0].x1, joined[0].y2 - joined[0].y1)) < 1e-12);
});

test("joinWallCorners closes a rectangle drawn with a slightly-off last corner", () => {
  // Mirrors the reported symptom: a drawn foundation loop where the closing
  // corner is a couple of millimetres proud of the other three walls'
  // corners, producing an overhanging tab once each wall is drawn as an
  // independent thickened box.
  const walls = [
    wall("top", 0, 0, 6.5, 0),
    wall("right", 6.5, 0, 6.5, 6.5),
    wall("bottom", 6.504, 6.5, 0, 6.5),
    wall("left", 0, 6.5, 0, 0),
  ];
  const joined = joinWallCorners(walls, 0.006);
  const [top, right, bottom, left] = joined;
  assert.equal(top.x2, right.x1);
  assert.equal(top.y2, right.y1);
  assert.equal(right.x2, bottom.x1);
  assert.equal(right.y2, bottom.y1);
  assert.equal(bottom.x2, left.x1);
  assert.equal(bottom.y2, left.y1);
  assert.equal(left.x2, top.x1);
  assert.equal(left.y2, top.y1);
});

test("selectionAngleJoint measures from the corner at the start", () => {
  const run = wall("run", 0, 0, 4, 0);
  const leg = wall("leg", 0, 0, 0, 3);
  const joint = selectionAngleJoint(run, [leg], () => 0.22);
  assert.deepEqual(joint.joint, { x: 0, y: 0 });
  assert.deepEqual(joint.far, { x: 4, y: 0 });
  assert.ok(joint.prev.y > 0, "the reference leaves the joint along the other wall");
  assert.equal(joint.prev.x, 0);
});

test("selectionAngleJoint uses the end when the start meets nothing", () => {
  const run = wall("run", 0, 0, 4, 0);
  const leg = wall("leg", 4, 0, 4, 3);
  const joint = selectionAngleJoint(run, [leg], () => 0.22);
  assert.deepEqual(joint.joint, { x: 4, y: 0 });
  assert.deepEqual(joint.far, { x: 0, y: 0 });
});

test("selectionAngleJoint prefers the start when both ends meet a wall", () => {
  const run = wall("run", 0, 0, 4, 0);
  const start = wall("start", 0, 0, 0, 3);
  const end = wall("end", 4, 0, 4, -3);
  const joint = selectionAngleJoint(run, [start, end], () => 0.22);
  assert.deepEqual(joint.joint, { x: 0, y: 0 });
});

test("selectionAngleJoint leaves a free wall, a straight run, and a crowded corner", () => {
  const run = wall("run", 0, 0, 4, 0);
  assert.equal(selectionAngleJoint(run, [], () => 0.22), null);
  const straight = wall("on", 4, 0, 8, 0);
  assert.equal(selectionAngleJoint(run, [straight], () => 0.22), null);
  const a = wall("a", 0, 0, 0, 3);
  const b = wall("b", 0, 0, -2, 2);
  assert.equal(selectionAngleJoint(run, [a, b], () => 0.22), null);
});

test("selectionSideGaps measures a return to its far end, not the join", () => {
  const run = wall("run", 0, 0, 0, 4);
  const leg = wall("leg", 0, 0, 3, 0);
  const gaps = selectionSideGaps(run, [leg]);
  assert.equal(gaps.length, 1);
  assert.ok(Math.abs(gaps[0].dist - 3) < 1e-9);
  assert.deepEqual({ x: gaps[0].x2, y: gaps[0].y2 }, { x: 3, y: 0 });
});

test("selectionSideGaps measures a wall running alongside", () => {
  const run = wall("run", 0, 0, 4, 0);
  const beside = wall("beside", 0, 2, 4, 2);
  const gaps = selectionSideGaps(run, [beside]);
  assert.equal(gaps.length, 1);
  assert.ok(Math.abs(gaps[0].dist - 2) < 1e-9);
  assert.ok(Math.abs(gaps[0].x1 - 2) < 1e-9);
});

test("selectionSideGaps keeps the nearer wall on a side", () => {
  const run = wall("run", 0, 0, 4, 0);
  const near = wall("near", 0, 1.5, 4, 1.5);
  const far = wall("far", 0, 5, 4, 5);
  const gaps = selectionSideGaps(run, [far, near]);
  assert.equal(gaps.length, 1);
  assert.ok(Math.abs(gaps[0].dist - 1.5) < 1e-9);
});

test("selectionSideGaps ignores a wall beyond the limit and a bare wall", () => {
  const run = wall("run", 0, 0, 4, 0);
  const away = wall("away", 0, 20, 4, 20);
  assert.equal(selectionSideGaps(run, []).length, 0);
  assert.equal(selectionSideGaps(run, [away]).length, 0);
});

test("typing a gap moves the wall square off its line, towards or away from the other wall", () => {
  const run = wall("run", 0, 0, 4, 0);
  const beside = wall("beside", 0, 2, 4, 2);
  const [gap] = selectionSideGaps(run, [beside]);
  const closer = gapMoveDelta(gap, 1.5);
  assert.ok(Math.abs(closer.dx) < 1e-9 && Math.abs(closer.dy - 0.5) < 1e-9);
  const further = gapMoveDelta(gap, 2.6);
  assert.ok(Math.abs(further.dx) < 1e-9 && Math.abs(further.dy + 0.6) < 1e-9);
  assert.equal(gapMoveDelta(gap, 0), null);
  assert.equal(gapMoveDelta(gap, Number.NaN), null);
  assert.equal(gapMoveDelta({ x1: 1, y1: 1, x2: 1, y2: 1 }, 2), null);
});
