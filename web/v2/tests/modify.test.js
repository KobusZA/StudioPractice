import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { emptyDoc, nid, rectShape, roomMinDimension, roomArea, shapeRects } from "../model.js";
import {
  alignSelection,
  attachSelection,
  copySelection,
  cutSelection,
  detachSelection,
  joinSelection,
  mergeSelection,
  mirrorSelection,
  rotateSelection,
  selectionBounds,
  splitSelection,
} from "../modify.js";
import { normalizePackUnits } from "../schema.js";

// Attach resolves against real level datums and SKU heights, so it needs the
// pack the same way ui.js has it: mm on disk, metres in memory.
const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);
const WALL_SKU = "TSP_MAS009"; // 2.8 m high
const FOUNDATION_SKU = "TSP_CON052"; // 0.6 m high

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
  for (const op of [attachSelection, detachSelection]) {
    const result = op(doc, [], { pack, targetRef: ref("segment", "nope") });
    assert.equal(result.ok, false, `${op.name} should refuse`);
    assert.ok(result.message.length > 0);
  }
});

// --- attach base -----------------------------------------------------------

/** A foundation and two walls on it, all on the ground level. */
function attachDoc() {
  return docWith({
    segments: [
      { id: "f1", sku: FOUNDATION_SKU, x1: 0, y1: 0, x2: 6, y2: 0, level: "01 GFL", status: "planned", baseAttach: null, baseOffset: 0, height: null },
      { id: "w1", sku: WALL_SKU, x1: 0, y1: 0, x2: 3, y2: 0, level: "01 GFL", status: "planned", baseAttach: null, baseOffset: 0, height: null },
      { id: "w2", sku: WALL_SKU, x1: 3, y1: 0, x2: 6, y2: 0, level: "01 GFL", status: "planned", baseAttach: null, baseOffset: 0, height: null },
    ],
  });
}

test("attach reports what it will do and changes nothing until it is committed", () => {
  const doc = attachDoc();
  const dry = attachSelection(doc, [ref("segment", "w1"), ref("segment", "w2")], {
    pack,
    targetRef: ref("segment", "f1"),
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.pending, true);
  assert.match(dry.message, /2 objects will attach/);
  assert.equal(doc.segments[1].baseAttach, null, "the dry run must not mutate");

  const done = attachSelection(doc, [ref("segment", "w1"), ref("segment", "w2")], {
    pack,
    targetRef: ref("segment", "f1"),
    commit: true,
  });
  assert.equal(done.ok, true);
  assert.deepEqual(doc.segments[1].baseAttach, { kind: "segment", id: "f1" });
  assert.deepEqual(doc.segments[2].baseAttach, { kind: "segment", id: "f1" });
});

// The whole reason the validity pass runs before the commit: a partly-valid
// batch has to say which object it is dropping, not quietly attach the rest.
test("a batch names the object it will skip, and still attaches the others", () => {
  const doc = attachDoc();
  // A 0.6 m foundation cannot sit on another 0.6 m foundation's top: there is
  // no height left above it.
  doc.segments.push({ id: "f2", sku: FOUNDATION_SKU, x1: 0, y1: 2, x2: 6, y2: 2, level: "01 GFL", status: "planned", baseAttach: null, baseOffset: 0, height: null });
  const result = attachSelection(doc, [ref("segment", "w1"), ref("segment", "f2")], {
    pack,
    targetRef: ref("segment", "f1"),
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /1 object will attach/);
  assert.match(result.message, /f2\) will be skipped - it would have no height left above the target/);
  assert.deepEqual(result.attach, [ref("segment", "w1")]);
});

test("attach refuses each cause with its own message", () => {
  const doc = attachDoc();
  assert.match(
    attachSelection(doc, [], { pack, targetRef: ref("segment", "f1") }).message,
    /at least one object and exactly one target/,
  );
  assert.match(
    attachSelection(doc, [ref("segment", "f1")], { pack, targetRef: ref("segment", "f1") }).message,
    /not part of the selection/,
  );
  assert.match(
    attachSelection(doc, [ref("segment", "w1")], { pack, targetRef: ref("room", "a") }).message,
    /Target has no resolvable elevation/,
  );
  doc.rooms.push(room("a", 0, 0, 4, 3));
  assert.match(
    attachSelection(doc, [ref("room", "a")], { pack, targetRef: ref("segment", "f1") }).message,
    /Attach applies to walls and beams/,
  );
  assert.match(
    attachSelection(doc, [ref("segment", "w2")], { pack, targetRef: ref("segment", "w1") }).message,
    /already at or above/,
  );
});

test("attach refuses a cycle rather than writing one into the document", () => {
  const doc = attachDoc();
  attachSelection(doc, [ref("segment", "w1")], { pack, targetRef: ref("segment", "f1"), commit: true });
  const result = attachSelection(doc, [ref("segment", "f1")], {
    pack,
    targetRef: ref("segment", "w1"),
    commit: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /attach cycle/);
  assert.equal(doc.segments[0].baseAttach, null);
});

test("attach refuses a second hop while chains are one level deep", () => {
  const doc = attachDoc();
  attachSelection(doc, [ref("segment", "w1")], { pack, targetRef: ref("segment", "f1"), commit: true });
  const result = attachSelection(doc, [ref("segment", "w2")], {
    pack,
    targetRef: ref("segment", "w1"),
    commit: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /one level deep/);
  assert.equal(doc.segments[2].baseAttach, null);
});

test("attach refuses a target more than one level below", () => {
  const doc = attachDoc();
  doc.segments.push({ id: "w3", sku: WALL_SKU, x1: 0, y1: 4, x2: 3, y2: 4, level: "02 L1", status: "planned", baseAttach: null, baseOffset: 0, height: null });
  // 01 GFL is the level immediately below 02 L1, so this one is allowed...
  assert.equal(attachSelection(doc, [ref("segment", "w3")], { pack, targetRef: ref("segment", "f1") }).ok, true);
  // ...but with the ground level removed from the pack it is two storeys away.
  const gapPack = { ...pack, levels: [pack.levels[0], { id: "01 MEZZ", name: "01 MEZZ", elevation: 1.4 }, pack.levels[1]] };
  const result = attachSelection(doc, [ref("segment", "w3")], { pack: gapPack, targetRef: ref("segment", "f1") });
  assert.equal(result.ok, false);
  assert.match(result.message, /more than one level below/);
});

// Revit's Detach leaves the wall where it is; so does this. Anything else is a
// wall that silently jumps and grows the moment the link is cut.
test("detach freezes the elevation and height the attach had resolved to", () => {
  const doc = attachDoc();
  attachSelection(doc, [ref("segment", "w1")], { pack, targetRef: ref("segment", "f1"), commit: true });
  const result = detachSelection(doc, [ref("segment", "w1")], { pack });
  assert.equal(result.ok, true);
  const wall = doc.segments[1];
  assert.equal(wall.baseAttach, null);
  assert.equal(wall.baseOffset, 0.6, "it stays on top of the 0.6 m foundation it was attached to");
  assert.equal(wall.height, 2.2, "and keeps the height the attach had left it");
});

test("detach says so when nothing selected is attached", () => {
  const doc = attachDoc();
  const result = detachSelection(doc, [ref("segment", "w1")], { pack });
  assert.equal(result.ok, false);
  assert.match(result.message, /not attached|Nothing selected is attached/);
});
