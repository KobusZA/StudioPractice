import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc } from "../model.js";
import { bestEndpointSnap, collectSnapTargets, snapPoint } from "../snap.js";

function docWithWall(x1, y1, x2, y2, id = "s1") {
  const doc = emptyDoc();
  doc.segments.push({ id, sku: "wall", level: "l1", x1, y1, x2, y2, status: "planned" });
  return doc;
}

test("collectSnapTargets includes wall endpoints and skips excluded segments", () => {
  const doc = docWithWall(0, 0, 3, 0);
  doc.segments.push({ id: "s2", sku: "wall", level: "l1", x1: 3, y1: 0, x2: 3, y2: 3, status: "planned" });
  const all = collectSnapTargets(doc);
  assert.equal(all.length, 4);
  const filtered = collectSnapTargets(doc, { excludeSegmentIds: new Set(["s2"]) });
  assert.equal(filtered.length, 2);
});

test("snapPoint joins onto the nearest target within tolerance", () => {
  const targets = [{ x: 3, y: 0 }, { x: 0, y: 3 }];
  const result = snapPoint(3.03, 0.02, targets, 0.1);
  assert.equal(result.snapped, true);
  assert.equal(result.x, 3);
  assert.equal(result.y, 0);
});

test("snapPoint falls back to a single-axis alignment guide", () => {
  // Close in X to a target that is far away in Y: no point join, but the X
  // coordinate should still snap to give an alignment guide.
  const targets = [{ x: 5, y: 9 }];
  const result = snapPoint(5.02, 0.5, targets, 0.1);
  assert.equal(result.snapped, true);
  assert.equal(result.x, 5);
  assert.equal(result.y, 0.5);
  assert.equal(result.guideX, 5);
  assert.equal(result.guideY, null);
});

test("snapPoint reports no snap once nothing is within tolerance", () => {
  const targets = [{ x: 5, y: 5 }];
  const result = snapPoint(0, 0, targets, 0.1);
  assert.equal(result.snapped, false);
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
});

test("bestEndpointSnap picks whichever endpoint needs the smallest correction", () => {
  const targets = [{ x: 10, y: 0 }, { x: 4, y: 4 }];
  const points = [{ x: 10.05, y: 0 }, { x: 1, y: 1.5 }];
  const best = bestEndpointSnap(points, targets, 0.1);
  assert.ok(best);
  // The first point (10.05, 0) is 0.05 from (10, 0); the second point is
  // nowhere near either target in either axis, so the first must win.
  assert.equal(Math.round(best.dx * 100) / 100, -0.05);
  assert.equal(best.dy, 0);
});

test("bestEndpointSnap returns null when neither endpoint is close enough", () => {
  const targets = [{ x: 10, y: 10 }];
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.equal(bestEndpointSnap(points, targets, 0.1), null);
});
