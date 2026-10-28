import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_OPS,
  MAX_INTERSECT_SEGS,
  applyCtm,
  buildLinework,
  buildPointIndex,
  collectIntersections,
  defaultPageTransform,
  dedupePoints,
  extractPathSegments,
  multiplyCtm,
  segmentIntersection,
  snapLinework,
} from "../pdf-snap.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function ops(names, args) {
  return {
    fnArray: names.map((n) => (typeof n === "number" ? n : DEFAULT_OPS[n])),
    argsArray: args,
  };
}

test("a stroked line becomes one segment with two endpoints", () => {
  const { fnArray, argsArray } = ops(
    ["moveTo", "lineTo", "stroke"],
    [[0, 0], [10, 0], []],
  );
  const work = buildLinework(fnArray, argsArray);
  assert.equal(work.stats.segments, 1);
  assert.equal(work.stats.endpoints, 2);
  assert.deepEqual(work.segments[0], { x1: 0, y1: 0, x2: 10, y2: 0 });
});

test("a rectangle is four sides and four corners after dedupe", () => {
  const { fnArray, argsArray } = ops(["rectangle", "stroke"], [[2, 3, 8, 6], []]);
  const work = buildLinework(fnArray, argsArray);
  assert.equal(work.stats.segments, 4);
  assert.equal(work.stats.endpoints, 4);
});

test("closePath joins back to the subpath start", () => {
  const { fnArray, argsArray } = ops(
    ["moveTo", "lineTo", "lineTo", "closePath", "stroke"],
    [[0, 0], [4, 0], [4, 3], [], []],
  );
  const segs = extractPathSegments(fnArray, argsArray).segments;
  assert.equal(segs.length, 3);
  const last = segs[2];
  close(last.x1, 4);
  close(last.y1, 3);
  close(last.x2, 0);
  close(last.y2, 0);
});

test("clip-only paths are discarded; painted paths are kept", () => {
  const { fnArray, argsArray } = ops(
    ["rectangle", "clip", "endPath", "moveTo", "lineTo", "stroke"],
    [[0, 0, 100, 100], [], [], [1, 1], [9, 1], []],
  );
  const segs = extractPathSegments(fnArray, argsArray).segments;
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { x1: 1, y1: 1, x2: 9, y2: 1 });
});

test("text operators do not contribute path segments", () => {
  const { fnArray, argsArray } = ops(
    ["beginText", "moveTo", "lineTo", "stroke", "endText", "moveTo", "lineTo", "stroke"],
    [[], [0, 0], [5, 0], [], [], [0, 10], [5, 10], []],
  );
  const segs = extractPathSegments(fnArray, argsArray).segments;
  assert.equal(segs.length, 1);
  assert.equal(segs[0].y1, 10);
});

test("images are counted and add no segments", () => {
  const { fnArray, argsArray } = ops(["paintImageXObject"], [["Im0"]]);
  const extracted = extractPathSegments(fnArray, argsArray);
  assert.equal(extracted.segments.length, 0);
  assert.equal(extracted.images, 1);
});

test("transform then save/restore keep later geometry untransformed", () => {
  const { fnArray, argsArray } = ops(
    ["save", "transform", "moveTo", "lineTo", "stroke", "restore", "moveTo", "lineTo", "stroke"],
    [[], [2, 0, 0, 2, 5, 0], [0, 0], [3, 0], [], [], [0, 1], [3, 1], []],
  );
  const segs = extractPathSegments(fnArray, argsArray).segments;
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { x1: 5, y1: 0, x2: 11, y2: 0 });
  assert.deepEqual(segs[1], { x1: 0, y1: 1, x2: 3, y2: 1 });
});

test("constructPath batches the same move/line/rect ops", () => {
  const { fnArray, argsArray } = ops(
    ["constructPath", "stroke"],
    [[[DEFAULT_OPS.moveTo, DEFAULT_OPS.lineTo], [0, 0, 12, 4], [0, 0, 12, 4]], []],
  );
  const segs = extractPathSegments(fnArray, argsArray).segments;
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { x1: 0, y1: 0, x2: 12, y2: 4 });
});

test("operator names work as well as numbers, for tests", () => {
  const segs = extractPathSegments(
    ["moveTo", "lineTo", "stroke"],
    [[0, 2], [6, 2], []],
  ).segments;
  assert.deepEqual(segs[0], { x1: 0, y1: 2, x2: 6, y2: 2 });
});

test("a form XObject multiplies its matrix and restores after", () => {
  const { fnArray, argsArray } = ops(
    ["paintFormXObjectBegin", "moveTo", "lineTo", "stroke", "paintFormXObjectEnd", "moveTo", "lineTo", "stroke"],
    [[[1, 0, 0, 1, 10, 20], [0, 0, 1, 1]], [0, 0], [2, 0], [], [], [0, 0], [2, 0], []],
  );
  const segs = extractPathSegments(fnArray, argsArray).segments;
  assert.deepEqual(segs[0], { x1: 10, y1: 20, x2: 12, y2: 20 });
  assert.deepEqual(segs[1], { x1: 0, y1: 0, x2: 2, y2: 0 });
});

test("the default page transform puts the PDF origin at the bottom-left of the sheet", () => {
  const m = defaultPageTransform(72, 144, 150);
  // 72 pt = 1 inch = 150 px; 144 pt tall flips y.
  const origin = applyCtm(m, 0, 0);
  close(origin.x, 0);
  close(origin.y, 300);
  const top = applyCtm(m, 0, 144);
  close(top.x, 0);
  close(top.y, 0);
});

test("multiplyCtm is the usual canvas concatenation", () => {
  const scaled = multiplyCtm([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 3, 4]);
  const p = applyCtm(scaled, 1, 1);
  close(p.x, 8);
  close(p.y, 10);
});

test("crossing segments produce an intersection; parallels do not", () => {
  const cross = segmentIntersection(
    { x1: 0, y1: 0, x2: 10, y2: 10 },
    { x1: 0, y1: 10, x2: 10, y2: 0 },
  );
  close(cross.x, 5);
  close(cross.y, 5);
  assert.equal(
    segmentIntersection({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 0, y1: 1, x2: 10, y2: 1 }),
    null,
  );
});

test("a T-junction is an intersection; endpoint-on-endpoint is not", () => {
  const tee = segmentIntersection(
    { x1: 0, y1: 0, x2: 10, y2: 0 },
    { x1: 5, y1: 0, x2: 5, y2: 4 },
  );
  close(tee.x, 5);
  close(tee.y, 0);
  assert.equal(
    segmentIntersection({ x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 4, y1: 0, x2: 8, y2: 0 }),
    null,
  );
  assert.equal(
    segmentIntersection({ x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 4, y1: 0, x2: 4, y2: 3 }),
    null,
  );
});

test("collectIntersections finds the crossing of two long segments", () => {
  const points = collectIntersections([
    { x1: 0, y1: 0, x2: 20, y2: 0 },
    { x1: 10, y1: -8, x2: 10, y2: 8 },
  ]);
  assert.equal(points.length, 1);
  close(points[0].x, 10);
  close(points[0].y, 0);
  assert.equal(points[0].kind, "intersection");
});

test("dedupePoints keeps the first kind at a quantized location", () => {
  const points = dedupePoints([
    { x: 1.01, y: 2.02, kind: "endpoint" },
    { x: 1.05, y: 2.0, kind: "intersection" },
    { x: 8, y: 8, kind: "endpoint" },
  ]);
  assert.equal(points.length, 2);
  assert.equal(points[0].kind, "endpoint");
});

test("the spatial index returns the nearest point inside the radius", () => {
  const index = buildPointIndex([
    { x: 0, y: 0, kind: "endpoint" },
    { x: 40, y: 0, kind: "endpoint" },
    { x: 10, y: 10, kind: "intersection" },
  ]);
  const hit = index.query(11, 9, 5);
  assert.equal(hit.kind, "intersection");
  close(hit.x, 10);
  close(hit.y, 10);
  assert.equal(index.query(11, 9, 0.5), null);
  assert.equal(index.query(200, 200, 10), null);
});

test("buildLinework indexes a plus-sign so a click near the crossing lands on it", () => {
  const { fnArray, argsArray } = ops(
    ["moveTo", "lineTo", "stroke", "moveTo", "lineTo", "stroke"],
    [[0, 10], [20, 10], [], [10, 0], [10, 20], []],
  );
  const work = buildLinework(fnArray, argsArray);
  assert.equal(work.stats.intersections, 1);
  const hit = snapLinework(work, 10.4, 9.7, 1);
  assert.equal(hit.kind, "intersection");
  close(hit.x, 10);
  close(hit.y, 10);
  const corner = snapLinework(work, 0.2, 10.1, 1);
  assert.equal(corner.kind, "endpoint");
  close(corner.x, 0);
  close(corner.y, 10);
});

test("intersection search is skipped on a sheet denser than the cap", () => {
  const segs = [];
  for (let i = 0; i <= MAX_INTERSECT_SEGS; i++) segs.push({ x1: i, y1: 0, x2: i, y2: 10 });
  assert.deepEqual(collectIntersections(segs), []);
});

test("a page of only images reports empty linework", () => {
  const { fnArray, argsArray } = ops(
    ["paintImageXObject", "paintImageXObject"],
    [["Im0"], ["Im1"]],
  );
  const work = buildLinework(fnArray, argsArray);
  assert.equal(work.stats.segments, 0);
  assert.equal(work.stats.images, 2);
  assert.equal(snapLinework(work, 0, 0, 10), null);
});
