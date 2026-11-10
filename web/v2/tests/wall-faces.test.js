import { test } from "node:test";
import assert from "node:assert/strict";

import { gapMoveDelta, selectionSideGaps, wallFaceLengths } from "../walls.js";

const T = 0.22;
const thick = (w) => w.thickness ?? T;

function wall(id, x1, y1, x2, y2, extra = {}) {
  return { id, x1, y1, x2, y2, level: "l1", ...extra };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} expected ${b}, got ${a}`);

/** A closed rectangle on its centrelines, 4 m by 3 m. */
function box() {
  return [
    wall("bottom", 0, 0, 4, 0),
    wall("right", 4, 0, 4, 3),
    wall("top", 4, 3, 0, 3),
    wall("left", 0, 3, 0, 0),
  ];
}

test("a wall in a closed room has a shorter inside face and a longer outside face", () => {
  const [bottom, ...rest] = box();
  const faces = wallFaceLengths(bottom, rest, thick);
  near(faces.inside.length, 4 - T, "inside");
  near(faces.outside.length, 4 + T, "outside");
  assert.equal(faces.single, null);
});

test("the inside face is the one that faces the room", () => {
  const [bottom, ...rest] = box();
  const faces = wallFaceLengths(bottom, rest, thick);
  // The room is below the bottom wall's line on a Y-down plan, so +y.
  near(faces.inside.y1, T / 2, "inside sits on the room side");
  near(faces.inside.x1, T / 2, "inside starts at the corner's inner face");
  near(faces.inside.x2, 4 - T / 2);
  near(faces.outside.y1, -T / 2, "outside sits away from the room");
  near(faces.outside.x1, -T / 2);
  near(faces.outside.x2, 4 + T / 2);
});

test("it holds whichever way the wall was drawn", () => {
  const [bottom, ...rest] = box();
  const reversed = wall("bottom", 4, 0, 0, 0);
  const faces = wallFaceLengths(reversed, rest, thick);
  near(faces.inside.length, 4 - T);
  near(faces.outside.length, 4 + T);
  // The room is on the other side of a reversed wall, and the inside face follows it.
  near(faces.inside.y1, T / 2);
  assert.equal(bottom.id, reversed.id);
});

test("the room and the building read as the 3 m wall inside and outside", () => {
  const [, right, , left] = box();
  const faces = wallFaceLengths(right, [box()[0], box()[2], left], thick);
  near(faces.inside.length, 3 - T);
  near(faces.outside.length, 3 + T);
});

test("a wall with nothing at its ends has one length, the one it was drawn with", () => {
  const faces = wallFaceLengths(wall("free", 0, 0, 4, 0), [], thick);
  assert.equal(faces.inside, null);
  assert.equal(faces.outside, null);
  near(faces.single.length, 4);
});

test("a wall with a corner at one end is trimmed at that end only", () => {
  const run = wall("run", 0, 0, 4, 0);
  const leg = wall("leg", 0, 0, 0, 3);
  const faces = wallFaceLengths(run, [leg], thick);
  near(faces.inside.length, 4 - T / 2);
  near(faces.outside.length, 4 + T / 2);
});

test("a wall that ends against the side of another is trimmed on both faces", () => {
  const run = wall("run", 0, 0, 4, 0);
  const through = wall("through", 4, -3, 4, 3);
  const faces = wallFaceLengths(run, [through], thick);
  assert.equal(faces.inside, null);
  near(faces.single.length, 4 - T / 2);
});

test("a long wall drawn as two pieces still counts as one wall to end against", () => {
  const run = wall("run", 0, 0, 4, 0);
  const upper = wall("upper", 4, -3, 4, 0);
  const lower = wall("lower", 4, 0, 4, 3);
  const faces = wallFaceLengths(run, [upper, lower], thick);
  assert.equal(faces.inside, null);
  near(faces.single.length, 4 - T / 2);
});

test("a thicker wall at the corner takes more off the inside and adds more to the outside", () => {
  const run = wall("run", 0, 0, 4, 0);
  const leg = wall("leg", 0, 0, 0, 3, { thickness: 0.34 });
  const faces = wallFaceLengths(run, [leg], thick);
  near(faces.inside.length, 4 - 0.17);
  near(faces.outside.length, 4 + 0.17);
});

test("an angled corner is trimmed along the angle, not by half a thickness", () => {
  const run = wall("run", 0, 0, 4, 0);
  const a = Math.PI / 3;
  const leg = wall("leg", 0, 0, 3 * Math.cos(a), 3 * Math.sin(a));
  const faces = wallFaceLengths(run, [leg], thick);
  const cut = (T / 2 + (T / 2) * Math.cos(a)) / Math.sin(a);
  near(faces.inside.length, 4 - cut);
  near(faces.outside.length, 4 + cut);
});

test("two walls crowding one end leave a bare end rather than a guess", () => {
  const run = wall("run", 0, 0, 4, 0);
  const up = wall("up", 0, 0, 0, 3);
  const down = wall("down", 0, 0, 0, -3);
  const other = wall("other", 0, 0, -2, 2);
  const faces = wallFaceLengths(run, [up, down, other], thick);
  assert.equal(faces.inside, null);
  near(faces.single.length, 4);
});

test("a wall that turns one way at one end and the other way at the far end has equal faces", () => {
  const run = wall("run", 0, 0, 4, 0);
  const up = wall("up", 0, 0, 0, 3);
  const down = wall("down", 4, 0, 4, -3);
  const faces = wallFaceLengths(run, [up, down], thick);
  assert.equal(faces.inside, null);
  near(faces.single.length, 4);
});

/** A U-shaped plan on its centrelines: 6 m wide, with a 2 m notch cut into the top. */
function uPlan() {
  return [
    wall("bottom", 0, 0, 6, 0),
    wall("right", 6, 0, 6, 4),
    wall("top-right", 6, 4, 4, 4),
    wall("notch-right", 4, 4, 4, 2),
    wall("notch-back", 4, 2, 2, 2),
    wall("notch-left", 2, 2, 2, 4),
    wall("top-left", 2, 4, 0, 4),
    wall("left", 0, 4, 0, 0),
  ];
}

test("the back of a notch faces the room on its longer face", () => {
  const plan = uPlan();
  const back = plan.find((w) => w.id === "notch-back");
  const faces = wallFaceLengths(back, plan.filter((w) => w !== back), thick);
  near(faces.inside.length, 2 + T, "both corners are re-entrant, so the room side is longer");
  near(faces.outside.length, 2 - T);
  near(faces.inside.y1, 2 - T / 2, "the room is below the notch");
});

test("a notch side with equal faces still tells inside from outside", () => {
  const plan = uPlan();
  const side = plan.find((w) => w.id === "notch-left");
  const faces = wallFaceLengths(side, plan.filter((w) => w !== side), thick);
  assert.equal(faces.single, null);
  near(faces.inside.length, faces.outside.length, "one corner trims, the other stretches");
  near(faces.inside.x1, 2 - T / 2, "the room is to the left of the notch");
});

test("a room drawn on one side decides the inside", () => {
  const run = wall("run", 0, 0, 4, 0);
  const faces = wallFaceLengths(run, [], thick, { inRoom: (x, y) => y < 0 });
  assert.equal(faces.single, null);
  near(faces.inside.y1, -T / 2, "the room's side");
  near(faces.outside.y1, T / 2);
});

test("the centreline is offered too, at the length the wall is stored with", () => {
  const [bottom, ...rest] = box();
  const faces = wallFaceLengths(bottom, rest, thick);
  near(faces.centre.length, 4);
  near(faces.centre.y1, 0);
  assert.equal(faces.centre.side, 0);
  near(wallFaceLengths(wall("free", 0, 0, 4, 0), [], thick).centre.length, 4);
});

test("a wall with no length has no faces", () => {
  assert.equal(wallFaceLengths(wall("dot", 1, 1, 1, 1), [], thick), null);
  assert.equal(wallFaceLengths(null, [], thick), null);
});

test("a gap between two walls alongside is face to face when thicknesses are given", () => {
  const run = wall("run", 0, 0, 4, 0);
  const beside = wall("beside", 0, 2, 4, 2);
  const [gap] = selectionSideGaps(run, [beside], { thicknessOf: thick });
  near(gap.dist, 2 - T, "dist");
  near(gap.y1, T / 2, "starts on this wall's face");
  near(gap.y2, 2 - T / 2, "ends on the other wall's face");
});

test("a gap to a wall that ends there stops at its bare end", () => {
  const run = wall("run", 0, 0, 0, 4);
  const leg = wall("leg", 0, 0, 3, 0);
  const [gap] = selectionSideGaps(run, [leg], { thicknessOf: thick });
  near(gap.dist, 3 - T / 2);
  near(gap.x2, 3, "the far end of the leg is where it ends");
});

test("without thicknesses a gap is still centre to centre", () => {
  const run = wall("run", 0, 0, 4, 0);
  const beside = wall("beside", 0, 2, 4, 2);
  const [gap] = selectionSideGaps(run, [beside]);
  near(gap.dist, 2);
});

test("typing a face-to-face gap moves the wall by the difference", () => {
  const run = wall("run", 0, 0, 4, 0);
  const beside = wall("beside", 0, 2, 4, 2);
  const [gap] = selectionSideGaps(run, [beside], { thicknessOf: thick });
  const closer = gapMoveDelta(gap, 1.5);
  near(closer.dy, 1.78 - 1.5, "moves towards it by what it must close");
  near(closer.dx, 0);
});

test("walls that touch face to face have no gap to show", () => {
  const run = wall("run", 0, 0, 4, 0);
  const beside = wall("beside", 0, 0.2, 4, 0.2);
  assert.equal(selectionSideGaps(run, [beside], { thicknessOf: thick }).length, 0);
});
