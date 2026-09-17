import { test } from "node:test";
import assert from "node:assert/strict";

import { boxDimensionLines, pickedDimension, planDimensionLines, unionBox } from "../dimensions.js";

test("a box gets one horizontal and one vertical dimension line", () => {
  const lines = boxDimensionLines({ x: 0, y: 0, w: 4, h: 3 }, 0.25);
  assert.equal(lines.length, 2);
  const h = lines.find((l) => l.kind === "h");
  const v = lines.find((l) => l.kind === "v");
  assert.equal(h.label, "4.00 m");
  assert.equal(v.label, "3.00 m");
  // Offset outward: above and to the left of the box, not through it.
  assert.equal(h.y1, -0.25);
  assert.equal(v.x1, -0.25);
});

test("a degenerate box produces no dimension lines", () => {
  assert.deepEqual(boxDimensionLines({ x: 0, y: 0, w: 0, h: 3 }, 0.25), []);
  assert.deepEqual(boxDimensionLines(null, 0.25), []);
});

test("union box spans every room", () => {
  const box = unionBox([
    { x: 0, y: 0, w: 4, h: 3 },
    { x: 4, y: 1, w: 3, h: 6 },
  ]);
  assert.deepEqual(box, { x: 0, y: 0, w: 7, h: 7 });
});

test("plan dimensions are one pair per room plus one overall pair", () => {
  const boxes = [
    { x: 0, y: 0, w: 4, h: 3 },
    { x: 4, y: 0, w: 3, h: 3 },
  ];
  const lines = planDimensionLines(boxes);
  assert.equal(lines.length, 6); // 2 rooms x 2 + 1 overall x 2
  const overall = lines.filter((l) => l.overall);
  assert.equal(overall.length, 2);
  const overallH = overall.find((l) => l.kind === "h");
  assert.equal(overallH.label, "7.00 m"); // full width of both rooms together
});

test("an empty plan produces no dimension lines", () => {
  assert.deepEqual(planDimensionLines([]), []);
});

test("two picked points become a labelled distance", () => {
  const dim = pickedDimension({ x: 0, y: 0 }, { x: 3, y: 4 });
  assert.equal(dim.length, 5);
  assert.equal(dim.label, "5.00 m");
});

test("a zero-length pick is refused", () => {
  assert.equal(pickedDimension({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
  assert.equal(pickedDimension(null, { x: 1, y: 1 }), null);
});
