import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_ROOM,
  MIN_TRACE,
  canCommitLine,
  canCommitRect,
  chainStart,
  hasClickDraft,
  lineLength,
  rectFromCorners,
  setLineHeading,
  setLineLength,
} from "../click-draw.js";

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
