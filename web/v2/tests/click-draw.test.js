import { test } from "node:test";
import assert from "node:assert/strict";

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
  rethickenAboutLocation,
  setLineHeading,
  setLineLength,
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

test("Escape aborts a live click-click draft before leaving the tool", () => {
  assert.equal(hasClickDraft({}), false);
  assert.equal(hasClickDraft({ wallDraft: { x1: 0, y1: 0, x2: 1, y2: 0 } }), true);
  assert.equal(hasClickDraft({ beamStart: { x: 0, y: 0 } }), true);
  assert.equal(hasClickDraft({ shapeDraft: { kind: "roof-new" } }), true);
  assert.equal(hasClickDraft({ measureDraft: { a: null } }), false);
  assert.equal(hasClickDraft({ measureDraft: { a: { x: 1, y: 1 } } }), true);
  assert.equal(hasClickDraft({ calibration: { a: { x: 0, y: 0 }, b: null } }), true);
  assert.equal(hasClickDraft({ calibration: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } }), false);
});
