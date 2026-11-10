import { test } from "node:test";
import assert from "node:assert/strict";

import { centerlineFromLocation } from "../click-draw.js";
import {
  closePickedCorner,
  distanceToLine,
  heldWallSide,
  nearestPickLine,
  pickedWallPlacement,
  sharedEndpoint,
} from "../pick-lines.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// A boundary along y = 0, from x = 0 to x = 10. On this Y-down plan the
// cursor at y = +2 is below it, and "left" of a rightward line is up (y < 0).
const boundary = { x1: 0, y1: 0, x2: 10, y2: 0 };
const below = { x: 5, y: 2 };
const above = { x: 5, y: -2 };

test("the nearest line within the tolerance is picked", () => {
  const far = { x1: 0, y1: 5, x2: 10, y2: 5 };
  const hit = nearestPickLine([far, boundary], { x: 3, y: 0.1 }, 0.2);
  assert.equal(hit.line, boundary);
  near(hit.dist, 0.1);
  assert.equal(nearestPickLine([far, boundary], { x: 3, y: 1 }, 0.2), null);
});

test("short lines are skipped, and the distance stops at the ends", () => {
  const tick = { x1: 0, y1: 0, x2: 0.1, y2: 0 };
  assert.equal(nearestPickLine([tick], { x: 0.05, y: 0 }, 0.2, 0.3), null);
  near(distanceToLine(boundary, { x: 13, y: 4 }).dist, 5);
});

test("the wall lands on the cursor's side, at the offset, whatever its sign", () => {
  for (const offset of [1, -1]) {
    const placed = pickedWallPlacement(boundary, below, { offset, location: "exterior" });
    near(placed.line.y1, 1);
    near(placed.line.y2, 1);
  }
  const up = pickedWallPlacement(boundary, above, { offset: 1, location: "exterior" });
  near(up.line.y1, -1);
});

test("an exterior face on the line puts the body on the cursor side", () => {
  const placed = pickedWallPlacement(boundary, below, { offset: 1, location: "exterior" });
  const center = centerlineFromLocation(
    { x: placed.line.x1, y: placed.line.y1 },
    { x: placed.line.x2, y: placed.line.y2 },
    0.22,
    "exterior",
  );
  near(center.y1, 1.11);
});

test("an interior face on the line also puts the body on the cursor side", () => {
  const placed = pickedWallPlacement(boundary, below, { offset: 0, location: "interior" });
  const center = centerlineFromLocation(
    { x: placed.line.x1, y: placed.line.y1 },
    { x: placed.line.x2, y: placed.line.y2 },
    0.22,
    "interior",
  );
  near(placed.line.y1, 0);
  near(center.y1, 0.11);
});

test("a centreline pick runs with the cursor on the interior side", () => {
  const placed = pickedWallPlacement(boundary, below, { offset: 0.5 });
  near(placed.line.y1, 0.5);
  // Interior is the right of start->end: below a rightward run is its right.
  assert.ok(placed.line.x1 < placed.line.x2);
  const flipped = pickedWallPlacement(boundary, above, { offset: 0.5 });
  near(flipped.line.y1, -0.5);
  assert.ok(flipped.line.x1 > flipped.line.x2);
});

test("a wall keeps its side until the cursor passes the far face", () => {
  const half = 0.11;
  assert.equal(heldWallSide(0.3, half, null), "left");
  // Over the wall, and just past the centre: still the side it started on.
  assert.equal(heldWallSide(0.02, half, "left"), "left");
  assert.equal(heldWallSide(-0.05, half, "left"), "left");
  // Clear of the far face: now the other side, and it holds there too.
  assert.equal(heldWallSide(-0.12, half, "left"), "right");
  assert.equal(heldWallSide(-0.02, half, "right"), "right");
  assert.equal(heldWallSide(0.12, half, "right"), "left");
});

test("a held side places the wall there even when the cursor is over the wall", () => {
  const face = { x1: 0, y1: -0.11, x2: 10, y2: -0.11 };
  const overTheWall = { x: 5, y: 0 };
  const placed = pickedWallPlacement(face, overTheWall, { offset: 1, location: "exterior", side: "left" });
  near(placed.line.y1, -1.11);
});

test("a cursor exactly on the line has no side", () => {
  assert.equal(pickedWallPlacement(boundary, { x: 5, y: 0 }, { offset: 1 }), null);
});

test("two picked lines that met close the corner between their walls", () => {
  const side = { x1: 10, y1: 0, x2: 10, y2: 8 };
  const corner = sharedEndpoint(boundary, side);
  near(corner.x, 10);
  near(corner.y, 0);
  // 1 m inside a rectangle whose corner is at (10, 0): the walls meet at (9, 1).
  const prev = { x1: 0, y1: 1, x2: 10, y2: 1 };
  const next = { x1: 9, y1: 0, x2: 9, y2: 8 };
  const closed = closePickedCorner(prev, next, corner, { reach: 5 });
  near(closed.point.x, 9);
  near(closed.point.y, 1);
  assert.equal(closed.prevEnd, 2);
  assert.equal(closed.nextEnd, 1);
  near(closed.prev.x2, 9);
  near(closed.next.y1, 1);
});

test("parallel picks, and a crossing out of reach, leave the walls alone", () => {
  const a = { x1: 0, y1: 1, x2: 10, y2: 1 };
  const b = { x1: 10, y1: 1.5, x2: 20, y2: 1.5 };
  assert.equal(closePickedCorner(a, b, { x: 10, y: 0 }, { reach: 5 }), null);
  const c = { x1: 9, y1: 0, x2: 9, y2: 8 };
  assert.equal(closePickedCorner(a, c, { x: 10, y: 0 }, { reach: 0.5 }), null);
});

test("lines with no common end share nothing", () => {
  assert.equal(sharedEndpoint(boundary, { x1: 0, y1: 5, x2: 10, y2: 5 }), null);
});
