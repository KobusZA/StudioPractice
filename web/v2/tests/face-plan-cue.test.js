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
