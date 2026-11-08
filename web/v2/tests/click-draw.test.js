import { test } from "node:test";
import assert from "node:assert/strict";

import { headingDeg, roundGrid } from "../geom.js";
import {
  MIN_ROOM,
  MIN_TRACE,
  canCommitLine,
  canCommitRect,
  centerlineFromLocation,
  chainStart,
  cycleWallLocation,
  flipWallLocation,
  hasClickDraft,
  isFaceLocation,
  lineLength,
  locationLineOf,
  mirroredWallLocation,
  normalizeWallLocation,
  rectFromCorners,
  realignAboutLocation,
  rethickenAboutLocation,
  setLineHeading,
  setLineLength,
  arcBySagitta,
  arcFromCursor,
  arcFromRadius,
  arcPoints,
  distToArc,
  normalizeWallArc,
  radiusFromSweep,
  wallDraftAngle,
  wallJointAngle,
} from "../click-draw.js";

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
}

test("a line shorter than MIN_TRACE does not commit", () => {
  const a = { x: 0, y: 0 };
  assert.equal(canCommitLine(a, { x: 0.1, y: 0 }), false);
  assert.equal(canCommitLine(a, { x: MIN_TRACE, y: 0 }), true);
  assert.equal(canCommitLine(a, a), false);
});

test("a committed wall chains from its endpoint", () => {
  const end = { x: 4, y: 1 };
  assert.deepEqual(chainStart(end), { x1: 4, y1: 1, x2: 4, y2: 1 });
});

test("centre location stores the line that was drawn", () => {
  assert.deepEqual(
    centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.6, "center"),
    { x1: 0, y1: 0, x2: 4, y2: 0 },
  );
});

test("a left-face location puts the centreline half a thickness to the right of travel", () => {
  // Walking toward +X on a Y-down plan, the left face is the upper one.
  // The centreline sits below that line.
  const line = centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.6, "left");
  near(line.x1, 0);
  near(line.x2, 4);
  near(line.y1, 0.3);
  near(line.y2, 0.3);
});

test("a right-face location puts the centreline half a thickness to the left of travel", () => {
  const line = centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.6, "right");
  near(line.y1, -0.3);
  near(line.y2, -0.3);
});

test("the face offset follows the run, not the sheet axes", () => {
  // Walking down the plan, the left face is the east face, so the centreline sits west of it.
  const line = centerlineFromLocation({ x: 1, y: 2 }, { x: 1, y: 6 }, 0.22, "left");
  near(line.x1, 1 - 0.11);
  near(line.x2, 1 - 0.11);
  near(line.y1, 2);
  near(line.y2, 6);
});

test("a zero-length run has no side to offset", () => {
  assert.deepEqual(
    centerlineFromLocation({ x: 1, y: 1 }, { x: 1, y: 1 }, 0.6, "left"),
    { x1: 1, y1: 1, x2: 1, y2: 1 },
  );
});

test("exterior and interior are the left and right faces as you draw", () => {
  const ext = centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.6, "exterior");
  const int = centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.6, "interior");
  near(ext.y1, 0.3);
  near(int.y1, -0.3);
});

test("drawing clockwise on the exterior face keeps the wall inside the line", () => {
  // Top edge of a box, drawn left to right on a Y-down plan: inside is below.
  const top = centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.22, "exterior");
  assert.ok(top.y1 > 0);
  // Right edge, drawn downward: inside is to the west.
  const right = centerlineFromLocation({ x: 4, y: 0 }, { x: 4, y: 3 }, 0.22, "exterior");
  assert.ok(right.x1 < 4);
});

test("the location line of a stored wall is the line that was drawn", () => {
  for (const loc of ["center", "exterior", "interior"]) {
    const center = centerlineFromLocation({ x: 1, y: 2 }, { x: 5, y: 4 }, 0.22, loc);
    const line = locationLineOf(center, 0.22, loc);
    near(line.x1, 1);
    near(line.y1, 2);
    near(line.x2, 5);
    near(line.y2, 4);
  }
});

test("a thicker type grows away from the face the wall was drawn on", () => {
  const seg = { ...centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.11, "interior"), location: "interior" };
  rethickenAboutLocation(seg, 0.11, 0.22);
  near(seg.y1, -0.11);
  const face = locationLineOf(seg, 0.22);
  near(face.y1, 0);
  near(face.y2, 0);
});

test("switching a face-drawn wall to centreline lands the middle on the drawn line", () => {
  const seg = { ...centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.22, "exterior"), location: "exterior" };
  assert.equal(realignAboutLocation(seg, 0.22, "center"), true);
  near(seg.y1, 0);
  near(seg.y2, 0);
  assert.equal(seg.location, undefined);
  const face = locationLineOf(seg, 0.22, "center");
  near(face.y1, 0);
});

test("switching exterior to interior shifts a wall by its full thickness", () => {
  const seg = { ...centerlineFromLocation({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.22, "exterior"), location: "exterior" };
  const before = seg.y1;
  realignAboutLocation(seg, 0.22, "interior");
  near(seg.y1 - before, -0.22);
  near(locationLineOf(seg, 0.22).y1, 0);
  assert.equal(seg.location, "interior");
});

test("a centreline wall can move onto a face, and repeating the choice does nothing", () => {
  const seg = { x1: 0, y1: 1, x2: 4, y2: 1 };
  assert.equal(realignAboutLocation(seg, 0.22, "center"), false);
  assert.equal(realignAboutLocation(seg, 0.22, "exterior"), true);
  near(locationLineOf(seg, 0.22).y1, 1);
  assert.equal(seg.location, "exterior");
  const y = seg.y1;
  assert.equal(realignAboutLocation(seg, 0.22, "exterior"), false);
  near(seg.y1, y);
});

test("a centreline wall is not moved by a thickness change", () => {
  const seg = { x1: 0, y1: 1, x2: 4, y2: 1 };
  rethickenAboutLocation(seg, 0.11, 0.22);
  assert.deepEqual(seg, { x1: 0, y1: 1, x2: 4, y2: 1 });
});

test("older left/right names read as exterior/interior", () => {
  assert.equal(normalizeWallLocation("left"), "exterior");
  assert.equal(normalizeWallLocation("right"), "interior");
  assert.equal(normalizeWallLocation(undefined), "center");
  assert.equal(isFaceLocation("center"), false);
  assert.equal(isFaceLocation("interior"), true);
});

test("mirroring swaps the face name and leaves the centreline alone", () => {
  assert.equal(mirroredWallLocation("exterior"), "interior");
  assert.equal(mirroredWallLocation("interior"), "exterior");
  assert.equal(mirroredWallLocation("center"), "center");
});

test("space swaps the two faces, and the first press leaves the centreline for the exterior", () => {
  assert.equal(flipWallLocation("center"), "exterior");
  assert.equal(flipWallLocation("exterior"), "interior");
  assert.equal(flipWallLocation("interior"), "exterior");
  assert.equal(flipWallLocation("nope"), "exterior");
});

test("space cycles centreline, exterior, interior", () => {
  assert.equal(cycleWallLocation("center"), "exterior");
  assert.equal(cycleWallLocation("exterior"), "interior");
  assert.equal(cycleWallLocation("interior"), "center");
});

test("typed length scales along the current heading", () => {
  const start = { x: 0, y: 0 };
  const toward = { x: 3, y: 4 };
  const end = setLineLength(start, toward, 10);
  assert.equal(lineLength(start, end), 10);
  assert.equal(end.x, 6);
  assert.equal(end.y, 8);
});

test("heading keeps the current length", () => {
  const start = { x: 1, y: 1 };
  const end = setLineHeading(start, 2, 0);
  assert.deepEqual(end, { x: 3, y: 1 });
});

test("a typed heading stays on the axis when the start is off the grid", () => {
  const start = { x: 0, y: 2.006 };
  const end = setLineHeading(start, 4, 0, (n) => roundGrid(n, 0.01));
  assert.equal(end.y, start.y);
  assert.equal(headingDeg(start.x, start.y, end.x, end.y), 0);
});

test("a typed length does not rotate a horizontal wall off the grid", () => {
  const start = { x: 0, y: 2.006 };
  const end = setLineLength(start, { x: 4, y: 2.006 }, 4, (n) => roundGrid(n, 0.01));
  assert.equal(end.y, start.y);
  assert.equal(headingDeg(start.x, start.y, end.x, end.y), 0);
  assert.ok(Math.abs(end.x - 4) < 1e-9);
});

test("a room rectangle needs MIN_ROOM on both sides", () => {
  const small = { x: 0, y: 0, w: 0.8, h: 2 };
  assert.equal(canCommitRect(small, "room-new"), false);
  assert.equal(canCommitRect({ x: 0, y: 0, w: MIN_ROOM, h: MIN_ROOM }, "room-new"), true);
  assert.equal(canCommitRect({ x: 0, y: 0, w: MIN_TRACE, h: MIN_TRACE }, "slab-new"), true);
  assert.equal(canCommitRect({ x: 0, y: 0, w: 0.2, h: 2 }, "roof-new"), false);
});

test("locked width keeps the typed metres while the free corner moves", () => {
  const r = rectFromCorners(0, 0, 5, 3, { lockW: true, w: 4, lockH: false });
  assert.equal(r.w, 4);
  assert.equal(r.h, 3);
});

test("the wall angle is the wedge off the horizontal", () => {
  const rad = (36 * Math.PI) / 180;
  const upRight = wallDraftAngle({ x: 0, y: 0 }, { x: Math.cos(rad), y: -Math.sin(rad) });
  assert.ok(Math.abs(upRight.degrees - 36) < 1e-6, upRight.degrees);
  const downRight = wallDraftAngle({ x: 0, y: 0 }, { x: Math.cos(rad), y: Math.sin(rad) });
  assert.ok(Math.abs(downRight.degrees - 36) < 1e-6, downRight.degrees);
  const upLeft = wallDraftAngle({ x: 1, y: 1 }, { x: 1 - Math.cos(rad), y: 1 - Math.sin(rad) });
  assert.ok(Math.abs(upLeft.degrees - 144) < 1e-6, upLeft.degrees);
});

test("a vertical wall reads as a right angle", () => {
  const ang = wallDraftAngle({ x: 2, y: 2 }, { x: 2, y: -2 });
  assert.ok(Math.abs(ang.degrees - 90) < 1e-6);
});

test("a chained wall reads 180 straight on and 90 at a corner", () => {
  const straight = wallJointAngle({ x: 4, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 });
  assert.ok(Math.abs(straight.interior - 180) < 1e-6);
  const corner = wallJointAngle({ x: 4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 3 });
  assert.ok(Math.abs(corner.interior - 90) < 1e-6);
  const two = (2 * Math.PI) / 180;
  const kink = wallJointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: Math.cos(two), y: Math.sin(two) });
  assert.ok(Math.abs(kink.interior - 178) < 1e-6, kink.interior);
});

test("a start-end-radius arc bows toward the cursor and reports the radius and the sweep", () => {
  // Chord along +x. Plan Y grows down, so a cursor at y = -1 is above the line.
  const arc = arcFromCursor(0, 0, 4, 0, 2, -1);
  assert.ok(arc);
  assert.ok(Math.abs(arc.radius - 2.5) < 1e-9, arc.radius);
  assert.ok(Math.abs(arc.cx - 2) < 1e-9 && Math.abs(arc.cy - 1.5) < 1e-9, `${arc.cx},${arc.cy}`);
  assert.ok(Math.abs(arc.crownY - -1) < 1e-9, arc.crownY);
  assert.ok(Math.abs(arc.sweepDeg - (2 * Math.asin(0.8) * 180 / Math.PI)) < 1e-6, arc.sweepDeg);
  assert.ok(Math.abs(arc.length - arc.radius * Math.abs(arc.sweep)) < 1e-9);
  assert.ok(distToArc(arc, arc.crownX, arc.crownY) < 1e-9);
  assert.ok(distToArc(arc, 0, 0) < 1e-9);
});

test("a pull along the chord stays a straight wall", () => {
  assert.equal(arcFromCursor(0, 0, 4, 0, 2, 0), null);
  assert.equal(arcFromRadius(0, 0, 4, 0, 1.5, 1), null);
});

test("sweeping the cursor further from the wall keeps the radius growing", () => {
  const near = arcFromCursor(0, 0, 4, 0, 3, -1);
  const far = arcFromCursor(0, 0, 4, 0, 8, -3);
  assert.ok(far.radius > near.radius + 1, `${far.radius} vs ${near.radius}`);
});

test("pulling past a semicircle keeps the crown on the cursor and the radius growing", () => {
  const half = arcFromCursor(0, 0, 4, 0, 2, -2);
  const past = arcFromCursor(0, 0, 4, 0, 2, -4);
  const further = arcFromCursor(0, 0, 4, 0, 2, -6);
  assert.ok(half.sweepDeg > 179 && half.sweepDeg < 181, half.sweepDeg);
  assert.ok(past.major && past.sweepDeg > 180, past.sweepDeg);
  assert.ok(further.radius > past.radius, `${further.radius} vs ${past.radius}`);
  assert.ok(past.radius > half.radius, `${past.radius} vs ${half.radius}`);
  assert.ok(Math.abs(past.crownY - -4) < 1e-6, past.crownY);
  assert.ok(Math.abs(further.crownY - -6) < 1e-6, further.crownY);
});

test("a semicircle bows to the side opposite its centre", () => {
  const up = arcFromRadius(0, 0, 4, 0, 2, -1);
  const down = arcFromRadius(0, 0, 4, 0, 2, 1);
  assert.ok(Math.abs(up.sweepDeg - 180) < 1e-6);
  assert.ok(up.crownY < 0, up.crownY);
  assert.ok(down.crownY > 0, down.crownY);
  assert.ok(Math.abs(radiusFromSweep(4, 180) - 2) < 1e-9);
  assert.equal(radiusFromSweep(4, 0), null);
});

test("a stored arc is kept only when the radius still reaches both ends", () => {
  assert.deepEqual(normalizeWallArc({ radius: 2.5, side: -1 }, 0, 0, 4, 0), { radius: 2.5, side: -1 });
  assert.equal(normalizeWallArc({ radius: 1, side: 1 }, 0, 0, 4, 0), null);
  assert.equal(normalizeWallArc(null, 0, 0, 4, 0), null);
  const pts = arcPoints(0, 0, 4, 0, 2.5, -1);
  assert.ok(pts.length > 2);
  assert.ok(Math.hypot(pts[0][0] - 0, pts[0][1] - 0) < 1e-9);
  assert.ok(Math.hypot(pts[pts.length - 1][0] - 4, pts[pts.length - 1][1] - 0) < 1e-9);
  const moved = arcBySagitta(0, 0, 6, 0, 1, -1);
  assert.ok(moved.radius > 3);
  assert.equal(moved.side, -1);
});

test("a wall along the horizontal draws no angle", () => {
  assert.equal(wallDraftAngle({ x: 0, y: 0 }, { x: 5, y: 0 }), null);
  assert.equal(wallDraftAngle({ x: 0, y: 0 }, { x: -4, y: 0 }), null);
  assert.equal(wallDraftAngle({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});

test("Escape aborts a live click-click draft before leaving the tool", () => {
  assert.equal(hasClickDraft({}), false);
  assert.equal(hasClickDraft({ wallDraft: { x1: 0, y1: 0, x2: 1, y2: 0 } }), true);
  assert.equal(hasClickDraft({ beamStart: { x: 0, y: 0 } }), true);
  assert.equal(hasClickDraft({ shapeDraft: { kind: "roof-new" } }), true);
  assert.equal(hasClickDraft({ measureDraft: { a: null } }), false);
  assert.equal(hasClickDraft({ measureDraft: { a: { x: 1, y: 1 } } }), true);
  assert.equal(hasClickDraft({ calibration: { a: { x: 0, y: 0 }, b: null } }), true);
  assert.equal(hasClickDraft({ calibration: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } }), false);
  assert.equal(hasClickDraft({ joineryDraft: { wallId: "w1", t: 0.2 } }), true);
});
