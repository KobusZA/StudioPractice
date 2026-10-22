import { test } from "node:test";
import assert from "node:assert/strict";

import { centerlineFromLocation } from "../click-draw.js";
import { findJoinTarget, resolveJoin, sideTowardTarget } from "../wall-join.js";

function near(actual, expected, msg = "") {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg} ${actual} vs ${expected}`);
}

const T = 0.22;
const thick = () => T;
// An old wall coming down the plan to (0, 4).
const old = { id: "w1", x1: 0, y1: 0, x2: 0, y2: 4 };

function joinFrom(start, end, location, mode) {
  const line = centerlineFromLocation(start, end, T, location);
  const target = findJoinTarget([old], start, thick, { reach: T });
  return { line, target, res: resolveJoin({ line, thickness: T, at: "start", target, mode }) };
}

test("a start on the old wall's end is found as that end", () => {
  const target = findJoinTarget([old], { x: 0, y: 4 }, thick, { reach: T });
  assert.equal(target.seg, old);
  assert.equal(target.end, 2);
});

test("a start along the old wall's side is a tee, not an end", () => {
  const target = findJoinTarget([old], { x: 0.11, y: 2 }, thick, { reach: T });
  assert.equal(target.end, null);
});

test("a start clear of every wall finds nothing", () => {
  assert.equal(findJoinTarget([old], { x: 1, y: 2 }, thick, { reach: T }), null);
});

test("past: the new wall runs under the old wall's end to its outer face", () => {
  // Drawn to the right on the exterior face from the old wall's end: the new
  // wall sits below the line, and should fill the corner the old wall leaves.
  const { res } = joinFrom({ x: 0, y: 4 }, { x: 3, y: 4 }, "exterior", "past");
  near(res.point.x, -0.11, "new wall starts at the old wall's far face");
  near(res.point.y, 4.11);
  near(res.targetEnd.x, 0);
  near(res.targetEnd.y, 4, "old wall already stops on the new wall's top face");
});

test("against: the new wall starts at the old wall's side, and the old wall runs down past it", () => {
  const { res } = joinFrom({ x: 0, y: 4 }, { x: 3, y: 4 }, "exterior", "against");
  near(res.point.x, 0.11, "new wall starts at the old wall's near face");
  near(res.targetEnd.y, 4.22, "old wall reaches the new wall's bottom face");
});

test("centre: nothing moves", () => {
  const { res } = joinFrom({ x: 0, y: 4 }, { x: 3, y: 4 }, "exterior", "center");
  assert.equal(res, null);
});

test("on the centreline, past trims the old wall to the new wall's near face", () => {
  const { res } = joinFrom({ x: 0, y: 4 }, { x: 3, y: 4 }, "center", "past");
  near(res.point.x, -0.11);
  near(res.point.y, 4);
  near(res.targetEnd.y, 3.89);
});

test("drawn the other way, the corner still lands on the outside", () => {
  const { res } = joinFrom({ x: 0, y: 4 }, { x: -3, y: 4 }, "center", "past");
  near(res.point.x, 0.11);
  near(res.targetEnd.y, 3.89);
});

test("past and against leave no overlap: the two lengths add up to the outside run", () => {
  for (const mode of ["past", "against"]) {
    const { line, res } = joinFrom({ x: 0, y: 4 }, { x: 3, y: 4 }, "exterior", mode);
    const newLen = 3 - res.point.x;
    const oldLen = res.targetEnd.y;
    // Outside dimensions: 0.11 + 3 wide, 4 + 0.22 tall, wall 0.22 thick.
    near(newLen * T + oldLen * T, (3 + 0.11) * T + (4 + 0.22) * T - T * T, mode);
    assert.ok(line);
  }
});

test("a tee stops the new wall at the face it meets, whatever the corner choice", () => {
  const line = centerlineFromLocation({ x: 0, y: 2 }, { x: 3, y: 2 }, T, "center");
  const target = findJoinTarget([old], { x: 0, y: 2 }, thick, { reach: T });
  for (const mode of ["past", "against"]) {
    const res = resolveJoin({ line, thickness: T, at: "start", target, mode });
    near(res.point.x, 0.11);
    assert.equal(res.targetEnd, null);
  }
});

test("a wall carrying straight on from the old one makes no corner", () => {
  const line = { x1: 0, y1: 4, x2: 0, y2: 6 };
  const target = findJoinTarget([old], { x: 0, y: 4 }, thick, { reach: T });
  assert.equal(resolveJoin({ line, thickness: T, at: "start", target, mode: "past" }), null);
});

test("starting on an old wall's end, the side is toward the old wall, whichever way you drag", () => {
  const target = findJoinTarget([old], { x: 0, y: 4 }, thick, { reach: T });
  const start = { x: 0, y: 4 };
  const right = sideTowardTarget({ start, end: { x: 3, y: 4 }, target });
  const left = sideTowardTarget({ start, end: { x: -3, y: 4 }, target });
  assert.notEqual(right, left, "the two drag directions use opposite faces");
  // Either way the wall's body ends up above the line, beside the old wall.
  for (const [end, side] of [[{ x: 3, y: 4 }, right], [{ x: -3, y: 4 }, left]]) {
    const line = centerlineFromLocation(start, end, T, side);
    assert.ok(line.y1 < 4, `${side} puts the wall above the line (${line.y1})`);
  }
});

test("a wall starting at the old wall's top end sits below the line, toward the old wall", () => {
  const target = findJoinTarget([old], { x: 0, y: 0 }, thick, { reach: T });
  for (const end of [{ x: 3, y: 0 }, { x: -3, y: 0 }]) {
    const side = sideTowardTarget({ start: { x: 0, y: 0 }, end, target });
    const line = centerlineFromLocation({ x: 0, y: 0 }, end, T, side);
    assert.ok(line.y1 > 0, `centreline below the line (${line.y1})`);
  }
});

test("there is no automatic side for a tee, a continuation, or no direction yet", () => {
  const tee = findJoinTarget([old], { x: 0, y: 2 }, thick, { reach: T });
  assert.equal(sideTowardTarget({ start: { x: 0, y: 2 }, end: { x: 3, y: 2 }, target: tee }), null);
  const endTarget = findJoinTarget([old], { x: 0, y: 4 }, thick, { reach: T });
  assert.equal(sideTowardTarget({ start: { x: 0, y: 4 }, end: { x: 0, y: 7 }, target: endTarget }), null);
  assert.equal(sideTowardTarget({ start: { x: 0, y: 4 }, end: { x: 0, y: 4 }, target: endTarget }), null);
  assert.equal(sideTowardTarget({ start: { x: 0, y: 4 }, end: { x: 3, y: 4 }, target: null }), null);
});

test("the end of a new wall joins the same way as its start", () => {
  const line = centerlineFromLocation({ x: 3, y: 4 }, { x: 0, y: 4 }, T, "interior");
  const target = findJoinTarget([old], { x: 0, y: 4 }, thick, { reach: T });
  const res = resolveJoin({ line, thickness: T, at: "end", target, mode: "past" });
  near(res.point.x, -0.11);
  near(res.targetEnd.y, 4);
});
