import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FACE_CORNER_ALONG,
  FACE_CORNER_OUT,
  FACE_CORNER_TRAVEL,
  FACE_CUE_MIN_PX,
  FACE_CUE_TARGET_PX,
  faceCornerMarks,
  faceCueZoom,
  faceFrameShift,
} from "../face-plan-cue.js";

test("a face already long enough is not zoomed", () => {
  assert.equal(faceCueZoom(FACE_CUE_MIN_PX, 12, 3000), 12);
  assert.equal(faceCueZoom(400, 12, 3000), 12);
  assert.equal(faceCueZoom(0, 12, 3000), 12);
});

test("a short face zooms toward the target and stops at the maximum", () => {
  const next = faceCueZoom(40, 10, 3000);
  assert.equal(next, 10 * (FACE_CUE_TARGET_PX / 40));
  assert.equal(faceCueZoom(10, 100, 150), 150);
});

test("settled corners sit on the ends and open toward the viewed side", () => {
  const marks = faceCornerMarks(0, 0, 200, 0, 0, -1, 1);
  assert.equal(marks.length, 2);
  const [a, b] = marks;
  assert.deepEqual(a[1], [0, 0]);
  assert.deepEqual(b[1], [200, 0]);
  // Along the face, inward.
  assert.ok(a[0][0] > a[1][0]);
  assert.ok(b[0][0] < b[1][0]);
  assert.equal(a[0][0], FACE_CORNER_ALONG);
  // Viewed side is -y.
  assert.equal(a[2][1], -FACE_CORNER_OUT);
  assert.equal(b[2][1], -FACE_CORNER_OUT);
  assert.equal(a[2][0], 0);
});

test("corners start outside the face and the legs stay clear of each other", () => {
  const marks = faceCornerMarks(0, 0, 200, 0, 0, -1, 0);
  const [a, b] = marks;
  assert.equal(a[1][0], -FACE_CORNER_TRAVEL);
  assert.equal(b[1][0], 200 + FACE_CORNER_TRAVEL);
  assert.ok(a[0][0] < b[0][0]);
});

test("a short face clamps the travel so the corners do not cross", () => {
  const marks = faceCornerMarks(0, 0, 20, 0, 0, -1, 0);
  const [a, b] = marks;
  assert.ok(a[1][0] < b[1][0]);
  assert.ok(a[0][0] < b[0][0]);
  assert.ok(Math.abs(a[1][0]) < FACE_CORNER_TRAVEL);
});

test("a face shorter than a pixel has no corners", () => {
  assert.deepEqual(faceCornerMarks(5, 5, 5.2, 5, 1, 0, 1), []);
});

test("a face already inside the clear plan is not moved", () => {
  const view = { w: 800, h: 300 };
  assert.deepEqual(faceFrameShift({ minX: 200, maxX: 500, minY: 100, maxY: 140 }, view), { dx: 0, dy: 0 });
});

test("a face under the strip is centred in the clear area, and only on that axis", () => {
  const view = { w: 800, h: 300 };
  const { dx, dy } = faceFrameShift({ minX: 200, maxX: 500, minY: 400, maxY: 440 }, view);
  assert.equal(dx, 0);
  assert.equal(dy, 150 - 420);
});

test("a face half under the strip is not treated as visible", () => {
  const view = { w: 800, h: 300 };
  const { dy } = faceFrameShift({ minX: 200, maxX: 500, minY: 280, maxY: 330 }, view);
  assert.equal(dy, 150 - 305);
});

test("a face wider than the area is centred on its middle, not zoomed", () => {
  const view = { w: 400, h: 300 };
  const { dx } = faceFrameShift({ minX: 500, maxX: 1700, minY: 100, maxY: 140 }, view);
  assert.equal(dx, 200 - 1100);
  assert.equal(faceFrameShift({ minX: -300, maxX: 900, minY: 100, maxY: 140 }, view).dx, 0);
});

test("rescue moves only a face with nothing left in the area", () => {
  const view = { w: 800, h: 300 };
  assert.deepEqual(faceFrameShift({ minX: 200, maxX: 500, minY: 280, maxY: 330 }, view, "rescue"), { dx: 0, dy: 0 });
  assert.equal(faceFrameShift({ minX: 200, maxX: 500, minY: 320, maxY: 360 }, view, "rescue").dy, 150 - 340);
});

test("an empty area or no bounds moves nothing", () => {
  assert.deepEqual(faceFrameShift(null, { w: 10, h: 10 }), { dx: 0, dy: 0 });
  assert.deepEqual(faceFrameShift({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, { w: 0, h: 10 }), { dx: 0, dy: 0 });
});
