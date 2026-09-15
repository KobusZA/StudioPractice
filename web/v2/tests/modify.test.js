import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, nid, rectShape, roomMinDimension, roomArea, shapeRects } from "../model.js";
import {
  alignSelection,
  copySelection,
  cutSelection,
  joinSelection,
  mergeSelection,
  mirrorSelection,
  rotateSelection,
  selectionBounds,
  splitSelection,
} from "../modify.js";

function docWith(overrides = {}) {
  return { ...emptyDoc(), ...overrides };
}

function room(id, x, y, w, h, extra = {}) {
  return { id, name: id, use: "other", status: "planned", shape: rectShape(x, y, w, h), ...extra };
}

function wall(id, x1, y1, x2, y2, sku = "W1") {
  return { id, sku, x1, y1, x2, y2, status: "planned" };
}

const ref = (kind, id) => ({ kind, id });

test("a quarter turn swaps a rectangle's sides and keeps its area", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 2)] });
  const result = rotateSelection(doc, [ref("room", "a")]);
  assert.equal(result.ok, true);
  const [r] = shapeRects(doc.rooms[0].shape);
  assert.equal(r.w, 2);
  assert.equal(r.h, 4);
  assert.equal(roomArea(doc.rooms[0]), 8);
});

// The whole reason rotation is restricted to quarter turns: a free angle would
// turn every rect into a polygon and downgrade the Part C minimum-dimension
// test from exact to advisory.
test("rotation keeps the minimum dimension exact", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 2)] });
  rotateSelection(doc, [ref("room", "a")]);
  assert.equal(doc.rooms[0].shape.kind, "rect");
  assert.equal(roomMinDimension(doc.rooms[0]), 2);
});

test("rotation is refused unless it is a multiple of 90 degrees", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 2)] });
  const result = rotateSelection(doc, [ref("room", "a")], { degrees: 30 });
  assert.equal(result.ok, false);
  assert.deepEqual(shapeRects(doc.rooms[0].shape)[0], { x: 0, y: 0, w: 4, h: 2 });
});

test("two rooms rotate about their shared centre, not their own", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 2, 2), room("b", 2, 0, 2, 2)] });
  rotateSelection(doc, [ref("room", "a"), ref("room", "b")]);
  const boxes = doc.rooms.map((r) => shapeRects(r.shape)[0]);
  // Side by side becomes stacked, and the pair still covers the same extent.
  assert.equal(boxes[0].x, boxes[1].x);
  assert.notEqual(boxes[0].y, boxes[1].y);
});

test("mirroring flips position and hands the door swing over", () => {
  const doc = docWith({
    rooms: [room("a", 0, 0, 4, 2)],
    openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.5, swing: 1, status: "planned" }],
  });
  mirrorSelection(doc, [ref("room", "a"), ref("opening", "o1")]);
  assert.equal(doc.openings[0].swing, -1);
});

test("mirroring twice returns the original", () => {
  const doc = docWith({ rooms: [room("a", 1, 0, 4, 2), room("b", 6, 0, 2, 2)] });
  const before = JSON.stringify(doc.rooms.map((r) => shapeRects(r.shape)));
  mirrorSelection(doc, [ref("room", "a"), ref("room", "b")]);
  mirrorSelection(doc, [ref("room", "a"), ref("room", "b")]);
  assert.equal(JSON.stringify(doc.rooms.map((r) => shapeRects(r.shape))), before);
});

test("copy offsets clear of the original and gives the copy a new id", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 2)] });
  const result = copySelection(doc, [ref("room", "a")]);
  assert.equal(result.ok, true);
  assert.equal(doc.rooms.length, 2);
  assert.notEqual(doc.rooms[1].id, "a");
  const [orig] = shapeRects(doc.rooms[0].shape);
  const [copy] = shapeRects(doc.rooms[1].shape);
  assert.ok(copy.x >= orig.x + orig.w, "the copy clears the original");
});

// An opening's position is a parameter on a host wall, so duplicating it would
// put two doors in the same hole.
test("copying an opening on its own is refused with a reason", () => {
  const doc = docWith({ openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.5, status: "planned" }] });
  const result = copySelection(doc, [ref("opening", "o1")]);
  assert.equal(result.ok, false);
  assert.match(result.message, /anchored to a wall/);
  assert.equal(doc.openings.length, 1);
});

test("align moves everything to the primary's edge", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 2, 2), room("b", 5, 3, 2, 2)] });
  const result = alignSelection(doc, [ref("room", "a"), ref("room", "b")], { edge: "left" });
  assert.equal(result.ok, true);
  assert.equal(shapeRects(doc.rooms[1].shape)[0].x, 0);
  assert.equal(shapeRects(doc.rooms[1].shape)[0].y, 3, "left align must not move anything vertically");
});

test("merging two rectangles makes one L-shaped room", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 3), room("b", 4, 0, 3, 3)] });
  const result = mergeSelection(doc, [ref("room", "a"), ref("room", "b")]);
  assert.equal(result.ok, true);
  assert.equal(doc.rooms.length, 1);
  assert.equal(doc.rooms[0].shape.kind, "rects");
  assert.equal(roomArea(doc.rooms[0]), 21);
});

test("merging keeps the minimum dimension exact", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 3), room("b", 4, 0, 3, 2)] });
  mergeSelection(doc, [ref("room", "a"), ref("room", "b")]);
  assert.equal(roomMinDimension(doc.rooms[0]), 2);
});

test("split halves across the long axis and names the second half", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 6, 2)] });
  const result = splitSelection(doc, [ref("room", "a")]);
  assert.equal(result.ok, true);
  assert.equal(doc.rooms.length, 2);
  assert.deepEqual(shapeRects(doc.rooms[0].shape)[0], { x: 0, y: 0, w: 3, h: 2 });
  assert.deepEqual(shapeRects(doc.rooms[1].shape)[0], { x: 3, y: 0, w: 3, h: 2 });
  assert.equal(doc.rooms[1].name, "a 2");
});

test("splitting a wall cuts it instead", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 6, 0)] });
  const result = splitSelection(doc, [ref("segment", "w1")]);
  assert.equal(result.ok, true);
  assert.equal(doc.segments.length, 2);
  assert.equal(doc.segments[0].x2, 3);
  assert.equal(doc.segments[1].x1, 3);
});

test("join welds two collinear walls that meet", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 3, 0), wall("w2", 3, 0, 6, 0)] });
  const result = joinSelection(doc, [ref("segment", "w1"), ref("segment", "w2")]);
  assert.equal(result.ok, true);
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0].x1, 0);
  assert.equal(doc.segments[0].x2, 6);
});

test("join refuses walls that are not collinear", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 3, 0), wall("w2", 3, 0, 3, 4)] });
  const result = joinSelection(doc, [ref("segment", "w1"), ref("segment", "w2")]);
  assert.equal(result.ok, false);
  assert.match(result.message, /not collinear/);
  assert.equal(doc.segments.length, 2);
});

test("join refuses walls of different types rather than picking one", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 3, 0, "W1"), wall("w2", 3, 0, 6, 0, "W2")] });
  const result = joinSelection(doc, [ref("segment", "w1"), ref("segment", "w2")]);
  assert.equal(result.ok, false);
  assert.match(result.message, /different types/);
});

test("cut and join round-trip a wall", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 6, 0)] });
  const cut = cutSelection(doc, [ref("segment", "w1")]);
  const joined = joinSelection(doc, cut.refs);
  assert.equal(joined.ok, true);
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0].x1, 0);
  assert.equal(doc.segments[0].x2, 6);
});

test("selection bounds span every kind of object", () => {
  const doc = docWith({
    rooms: [room("a", 0, 0, 4, 2)],
    segments: [wall("w1", 0, 0, 8, 0)],
    items: [{ id: "i1", sku: "E1", x: 9, y: 5, status: "planned" }],
  });
  const box = selectionBounds(doc, [ref("room", "a"), ref("segment", "w1"), ref("item", "i1")]);
  assert.deepEqual(box, { x: 0, y: 0, w: 9, h: 5 });
});

test("every operation refuses an empty selection without throwing", () => {
  const doc = docWith();
  for (const op of [rotateSelection, mirrorSelection, copySelection, alignSelection,
    mergeSelection, splitSelection, cutSelection, joinSelection]) {
    const result = op(doc, []);
    assert.equal(result.ok, false, `${op.name} should refuse`);
    assert.ok(result.message.length > 0);
  }
});
