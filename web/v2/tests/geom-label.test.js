import { test } from "node:test";
import assert from "node:assert/strict";

import { clipSegToRect, headingDeg } from "../geom.js";

test("heading of axis-aligned segments", () => {
  assert.equal(headingDeg(0, 0, 4, 0), 0);
  assert.equal(headingDeg(0, 0, 0, 3), 90);
  assert.equal(headingDeg(4, 0, 0, 0), 180);
  assert.equal(headingDeg(0, 3, 0, 0), 270);
});

test("a fully visible segment is unchanged by clipping", () => {
  const clipped = clipSegToRect(10, 10, 90, 10, 0, 0, 100, 100);
  assert.deepEqual(clipped, { x1: 10, y1: 10, x2: 90, y2: 10 });
});

test("a segment that runs off-screen keeps its visible midpoint on screen", () => {
  // Midpoint of the full wall is at x=150, outside a 100-wide view.
  const clipped = clipSegToRect(0, 50, 300, 50, 0, 0, 100, 100);
  assert.ok(clipped);
  const mx = (clipped.x1 + clipped.x2) / 2;
  assert.ok(mx >= 0 && mx <= 100);
  assert.equal(clipped.x1, 0);
  assert.equal(clipped.x2, 100);
});

test("a segment entirely off-screen clips to nothing", () => {
  assert.equal(clipSegToRect(200, 200, 240, 240, 0, 0, 100, 100), null);
});
