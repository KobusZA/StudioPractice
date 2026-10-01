import { test } from "node:test";
import assert from "node:assert/strict";

import { joinWallCorners } from "../walls.js";

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
