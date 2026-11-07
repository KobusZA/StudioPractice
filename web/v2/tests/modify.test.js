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
  moveWallEnd,
  realignWallFaces,
  shiftJoinedEnds,
  retypeSelection,
  rotateSelection,
  selectionBounds,
  collinearWallJoints,
  splitSelection,
  splitWallAt,
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

test("rotating a door on its own flips the hinge and leaves it in the wall", () => {
  const doc = docWith({
    openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.4, swing: 1, hand: 1, status: "planned" }],
  });
  const result = rotateSelection(doc, [ref("opening", "o1")]);
  assert.equal(result.ok, true);
  assert.equal(doc.openings[0].hand, -1);
  assert.equal(doc.openings[0].swing, 1);
  assert.equal(doc.openings[0].t, 0.4);
});

test("mirroring a door on its own flips the swing and leaves it in the wall", () => {
  const doc = docWith({
    openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.4, swing: 1, hand: -1, status: "planned" }],
  });
  const result = mirrorSelection(doc, [ref("opening", "o1")]);
  assert.equal(result.ok, true);
  assert.equal(doc.openings[0].swing, -1);
  assert.equal(doc.openings[0].hand, -1);
  assert.equal(doc.openings[0].t, 0.4);
});

test("rotating a window on its own is refused", () => {
  const doc = docWith({
    openings: [{ id: "o1", sku: "W1", wallId: "w1", t: 0.4, swing: 1, status: "planned" }],
  });
  const result = rotateSelection(doc, [ref("opening", "o1")]);
  assert.equal(result.ok, false);
  assert.equal(doc.openings[0].t, 0.4);
});

test("mirroring flips position and hands the door swing over", () => {
  const doc = docWith({
    rooms: [room("a", 0, 0, 4, 2)],
    openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.5, swing: 1, hand: -1, status: "planned" }],
  });
  mirrorSelection(doc, [ref("room", "a"), ref("opening", "o1")]);
  assert.equal(doc.openings[0].swing, -1);
  assert.equal(doc.openings[0].hand, -1);
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
  assert.match(result.message, /stays in its wall/);
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

test("a chosen point splits the wall and keeps hosts on their piece", () => {
  const doc = docWith({
    segments: [wall("w1", 0, 0, 6, 0)],
    openings: [
      { id: "near", sku: "D1", wallId: "w1", t: 0.25, status: "planned" },
      { id: "far", sku: "D1", wallId: "w1", t: 0.75, status: "planned" },
    ],
    finishRuns: [
      { id: "head-only", wallId: "w1", side: 1, a: 0.5, b: 1.5 },
      { id: "tail-only", wallId: "w1", side: 1, a: 4, b: 5 },
      { id: "across", wallId: "w1", side: -1, a: 1, b: 4, outline: [[0.5, 0], [3.5, 0], [3.5, 1], [0.5, 1]] },
      { id: "whole", wallId: "w1", side: 1, a: null, b: null },
    ],
  });
  const result = splitWallAt(doc, ref("segment", "w1"), { x: 2, y: 0 }, {
    skuById: () => ({ category: "wall", geometry: { thickness: 0.22 } }),
  });
  assert.equal(result.ok, true);
  assert.equal(doc.segments.length, 2);
  const head = doc.segments[0];
  const tail = doc.segments[1];
  assert.equal(head.id, "w1");
  assert.equal(head.x2, 2);
  assert.equal(tail.x1, 2);
  assert.equal(tail.x2, 6);
  assert.equal(tail.sku, "W1");

  const near = doc.openings.find((o) => o.id === "near");
  const far = doc.openings.find((o) => o.id === "far");
  assert.equal(near.wallId, head.id);
  assert.equal(near.t, 1.5 / 2);
  assert.equal(far.wallId, tail.id);
  assert.equal(far.t, (4.5 - 2) / 4);

  const headOnly = doc.finishRuns.find((r) => r.id === "head-only");
  const tailOnly = doc.finishRuns.find((r) => r.id === "tail-only");
  assert.equal(headOnly.wallId, head.id);
  assert.equal(headOnly.a, 0.5);
  assert.equal(headOnly.b, 1.5);
  assert.equal(tailOnly.wallId, tail.id);
  assert.equal(tailOnly.a, 2);
  assert.equal(tailOnly.b, 3);

  const acrossHead = doc.finishRuns.find((r) => r.side === -1 && r.wallId === head.id);
  const acrossTail = doc.finishRuns.find((r) => r.side === -1 && r.wallId === tail.id);
  assert.ok(acrossHead);
  assert.ok(acrossTail);
  assert.equal(acrossHead.a, 1);
  assert.equal(acrossHead.b, 2);
  assert.equal(acrossTail.a, 0);
  assert.equal(acrossTail.b, 2);
  assert.ok(acrossHead.outline.every(([s]) => s >= 0.5 - 1e-6 && s <= 2 + 1e-6));
  assert.ok(acrossTail.outline.every(([s]) => s >= -1e-6 && s <= 1.5 + 1e-6));

  const wholes = doc.finishRuns.filter((r) => r.a == null && r.b == null);
  assert.equal(wholes.length, 2);
  assert.deepEqual(wholes.map((r) => r.wallId).sort(), [head.id, tail.id].sort());
});

test("a collinear meeting is one joint, and a corner is not", () => {
  const segments = [
    wall("a", 0, 0, 2, 0),
    wall("b", 2, 0, 5, 0),
    wall("c", 2, 0, 2, 3),
  ];
  const one = collinearWallJoints(segments, ["a"]);
  assert.equal(one.length, 1);
  assert.equal(one[0].x, 2);
  assert.equal(one[0].y, 0);
  const both = collinearWallJoints(segments, ["a", "b"]);
  assert.equal(both.length, 1);
  const corner = collinearWallJoints(segments, ["c"]);
  assert.equal(corner.length, 0);
});

function snapSku(id) {
  if (id === "D1") return { id, category: "door", name: "Door" };
  return thickSkuById(id);
}

test("moving an end lands the location line, keeps the door, and leaves the other wall", () => {
  // Exterior face on y = 0, drawn to the right. The 220 mm centreline sits 110 mm below it.
  const doc = docWith({
    segments: [
      { ...wall("w1", 0, 0.11, 4, 0.11, "T220"), location: "exterior" },
      wall("w2", 4, 0.11, 4, 3.11, "T220"),
    ],
    openings: [{ id: "d1", sku: "D1", wallId: "w1", t: 0.5, status: "planned" }],
    finishRuns: [
      { id: "part", wallId: "w1", side: 1, a: 0.5, b: 1.5 },
      { id: "whole", wallId: "w1", side: 1, a: null, b: null },
    ],
  });
  const result = moveWallEnd(doc, ref("segment", "w1"), 2, { x: 6, y: 0 }, { skuById: snapSku });
  assert.equal(result.ok, true);
  const wall1 = doc.segments[0];
  const wall2 = doc.segments[1];
  assert.ok(Math.abs(wall1.y1 - 0.11) < 1e-9 && Math.abs(wall1.y2 - 0.11) < 1e-9, `centreline at ${wall1.y1}`);
  assert.equal(wall1.x2, 6);
  assert.equal(wall1.location, "exterior");
  assert.equal(wall2.x1, 4);
  assert.equal(wall2.y1, 0.11);
  assert.equal(wall2.x2, 4);
  assert.equal(wall2.y2, 3.11);
  assert.ok(Math.abs(doc.openings[0].t - (2 / 6)) < 1e-9, `door station ${doc.openings[0].t}`);
  assert.equal(doc.finishRuns.find((run) => run.id === "part").a, 0.5);
  assert.equal(doc.finishRuns.find((run) => run.id === "whole").a, null);
});

test("shortening a wall past its door does nothing", () => {
  const doc = docWith({
    segments: [{ ...wall("w1", 0, 0.11, 4, 0.11, "T220"), location: "exterior" }],
    openings: [{ id: "d1", sku: "D1", wallId: "w1", t: 0.5, status: "planned" }],
  });
  const result = moveWallEnd(doc, ref("segment", "w1"), 2, { x: 1, y: 0 }, { skuById: snapSku });
  assert.equal(result.ok, false);
  assert.match(result.message, /door/);
  assert.equal(doc.segments[0].x2, 4);
  assert.equal(doc.openings[0].t, 0.5);
});

test("a finish past the shortened end is removed and the door stays put", () => {
  const doc = docWith({
    segments: [wall("w1", 0, 0, 6, 0, "T220")],
    openings: [{ id: "d1", sku: "D1", wallId: "w1", t: 0.1, status: "planned" }],
    finishRuns: [
      { id: "keep", wallId: "w1", side: 1, a: 0.2, b: 1 },
      { id: "drop", wallId: "w1", side: 1, a: 4, b: 5 },
    ],
  });
  const result = moveWallEnd(doc, ref("segment", "w1"), 2, { x: 2.5, y: 0 }, { skuById: snapSku });
  assert.equal(result.ok, true);
  assert.equal(doc.segments[0].x2, 2.5);
  assert.ok(Math.abs(doc.openings[0].t - (0.6 / 2.5)) < 1e-9);
  assert.equal(doc.finishRuns.length, 1);
  assert.equal(doc.finishRuns[0].id, "keep");
  assert.equal(doc.finishRuns[0].b, 1);
});

test("moving a wall carries the wall joined to its end", () => {
  const doc = docWith({
    segments: [wall("w1", 0, 0, 4, 0, "T220"), wall("w2", 4, 0, 4, 3, "T220")],
    openings: [{ id: "d1", sku: "D1", wallId: "w2", t: 0.5, status: "planned" }],
  });
  doc.segments[0].y1 = 1;
  doc.segments[0].y2 = 1;
  shiftJoinedEnds(doc, [{
    id: "w1",
    level: null,
    old: { x1: 0, y1: 0, x2: 4, y2: 0 },
    next: { x1: 0, y1: 1, x2: 4, y2: 1 },
  }], { skuById: snapSku });
  const wall2 = doc.segments[1];
  assert.equal(wall2.x1, 4);
  assert.equal(wall2.y1, 1);
  assert.equal(wall2.x2, 4);
  assert.equal(wall2.y2, 3);
  assert.ok(Math.abs(doc.openings[0].t - 0.25) < 1e-9, `door stays on the plan, station ${doc.openings[0].t}`);
});

test("a corner drawn 'against' (ends a thickness apart) still moves with its wall", () => {
  // Horizontal wall stops at the vertical wall's near face; the vertical runs on past it.
  const doc = docWith({
    segments: [wall("w1", 0, 0, 3.89, 0, "T220"), wall("w2", 4, -0.11, 4, 3, "T220")],
  });
  doc.segments[0].y1 = 1;
  doc.segments[0].y2 = 1;
  const changed = shiftJoinedEnds(doc, [{
    id: "w1",
    level: null,
    old: { x1: 0, y1: 0, x2: 3.89, y2: 0 },
    next: { x1: 0, y1: 1, x2: 3.89, y2: 1 },
  }], { skuById: snapSku });
  assert.deepEqual(changed, ["w2"]);
  const wall2 = doc.segments[1];
  assert.ok(Math.abs(wall2.x1 - 4) < 1e-9 && Math.abs(wall2.x2 - 4) < 1e-9, "keeps its direction");
  assert.ok(Math.abs(wall2.y1 - 0.89) < 1e-9, `corner follows, end at ${wall2.y1}`);
  assert.equal(wall2.y2, 3);
});

test("a wall that only touches nearby is not carried", () => {
  const doc = docWith({
    segments: [wall("w1", 0, 0, 4, 0, "T220"), wall("w2", 4, 2, 4, 5, "T220")],
  });
  const changed = shiftJoinedEnds(doc, [{
    id: "w1",
    level: null,
    old: { x1: 0, y1: 0, x2: 4, y2: 0 },
    next: { x1: 0, y1: 1, x2: 4, y2: 1 },
  }], { skuById: snapSku });
  assert.deepEqual(changed, []);
  assert.equal(doc.segments[1].y1, 2);
});

test("moving the shared end of a split leaves the other piece", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 6, 0, "T220")] });
  splitWallAt(doc, ref("segment", "w1"), { x: 2, y: 0 }, { skuById: snapSku });
  const tail = doc.segments[1];
  const result = moveWallEnd(doc, ref("segment", "w1"), 2, { x: 2, y: 1 }, { skuById: snapSku });
  assert.equal(result.ok, true);
  assert.equal(doc.segments[0].x2, 2);
  assert.equal(doc.segments[0].y2, 1);
  assert.equal(tail.x1, 2);
  assert.equal(tail.y1, 0);
  assert.equal(tail.x2, 6);
  assert.equal(tail.y2, 0);
});

test("a split refuses a point off the wall or against an end", () => {
  const doc = docWith({ segments: [wall("w1", 0, 0, 6, 0)] });
  const off = splitWallAt(doc, ref("segment", "w1"), { x: 2, y: 1 });
  assert.equal(off.ok, false);
  assert.equal(doc.segments.length, 1);
  const end = splitWallAt(doc, ref("segment", "w1"), { x: 0.01, y: 0 });
  assert.equal(end.ok, false);
  assert.equal(doc.segments[0].x2, 6);
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

// --- retype (multi-select) ---------------------------------------------

const RETYPE_CATS = { W1: "wall", W2: "wall", F2: "foundation", D1: "door", D2: "door", WIN1: "window" };
function retypeSkuById(id) {
  return RETYPE_CATS[id] ? { id, category: RETYPE_CATS[id], name: id } : null;
}

test("retype changes every compatible object in a mixed selection and skips the rest", () => {
  const doc = docWith({
    segments: [wall("w1", 0, 0, 3, 0, "W1"), wall("f1", 3, 0, 6, 0, "F1")],
    beams: [{ id: "b1", sku: "BEAM1", x1: 0, y1: 1, x2: 3, y2: 1, status: "planned" }],
  });
  const newFoundation = { id: "F2", category: "foundation", name: "F2" };
  const result = retypeSelection(
    doc,
    [ref("segment", "w1"), ref("segment", "f1"), ref("beam", "b1")],
    newFoundation,
    { skuById: retypeSkuById },
  );
  assert.equal(result.ok, true);
  assert.equal(doc.segments[0].sku, "F2");
  assert.equal(doc.segments[1].sku, "F2");
  assert.equal(doc.beams[0].sku, "BEAM1", "a beam cannot take a foundation sku");
  assert.deepEqual(result.refs, [ref("segment", "w1"), ref("segment", "f1")]);
  assert.deepEqual(result.skipped, [ref("beam", "b1")]);
  assert.match(result.message, /Retyped 2 objects.*left 1 unchanged/);
});

test("retype refuses when nothing selected can take the type", () => {
  const doc = docWith({ beams: [{ id: "b1", sku: "BEAM1", x1: 0, y1: 0, x2: 1, y2: 0, status: "planned" }] });
  const result = retypeSelection(doc, [ref("beam", "b1")], { id: "D1", category: "door", name: "D1" }, { skuById: retypeSkuById });
  assert.equal(result.ok, false);
  assert.equal(doc.beams[0].sku, "BEAM1");
});

test("retype on a room picks the wall or floor field by the new type's category", () => {
  const doc = docWith({ rooms: [room("a", 0, 0, 4, 2, { wallSku: "W1", floorSku: "FLR1" })] });
  const result = retypeSelection(doc, [ref("room", "a")], { id: "W2", category: "wall", name: "W2" }, { skuById: retypeSkuById });
  assert.equal(result.ok, true);
  assert.equal(doc.rooms[0].wallSku, "W2");
  assert.equal(doc.rooms[0].floorSku, "FLR1", "the floor type is untouched by a wall retype");
});

test("retype on an opening only accepts a SKU of the same category as its own", () => {
  const doc = docWith({ openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.5, status: "planned" }] });
  const toWindow = retypeSelection(doc, [ref("opening", "o1")], { id: "WIN1", category: "window", name: "WIN1" }, { skuById: retypeSkuById });
  assert.equal(toWindow.ok, false);
  const toDoor = retypeSelection(doc, [ref("opening", "o1")], { id: "D2", category: "door", name: "D2" }, { skuById: retypeSkuById });
  assert.equal(toDoor.ok, true);
  assert.equal(doc.openings[0].sku, "D2");
});

const THICK = { T110: 0.11, T220: 0.22 };
function thickSkuById(id) {
  return THICK[id] ? { id, category: "wall", name: id, geometry: { thickness: THICK[id] } } : null;
}

test("retype keeps a face-drawn wall's face where it was drawn", () => {
  // Drawn left to right on the exterior face at y = 0: the 110 mm wall's
  // centreline sits 55 mm below that face.
  const doc = docWith({ segments: [{ ...wall("w1", 0, 0.055, 4, 0.055, "T110"), location: "exterior" }] });
  retypeSelection(doc, [ref("segment", "w1")], thickSkuById("T220"), { skuById: thickSkuById });
  const seg = doc.segments[0];
  assert.equal(seg.sku, "T220");
  assert.ok(Math.abs(seg.y1 - 0.11) < 1e-9 && Math.abs(seg.y2 - 0.11) < 1e-9, `centreline at ${seg.y1}`);
  assert.equal(seg.x1, 0);
  assert.equal(seg.x2, 4);
});

test("retype grows a centreline wall both ways, as before", () => {
  const doc = docWith({ segments: [wall("w1", 0, 1, 4, 1, "T110")] });
  retypeSelection(doc, [ref("segment", "w1")], thickSkuById("T220"), { skuById: thickSkuById });
  assert.equal(doc.segments[0].y1, 1);
  assert.equal(doc.segments[0].y2, 1);
});

test("realign keeps the drawn line and closes a corner that shared an endpoint", () => {
  // Exterior face along y = 0. The 220 mm centreline sits 110 mm below it.
  // The return wall meets that centreline at x = 4.
  const doc = docWith({
    segments: [
      { ...wall("w1", 0, 0.11, 4, 0.11, "T220"), location: "exterior" },
      wall("w2", 4, 0.11, 4, 3, "T220"),
    ],
    openings: [{ id: "o1", sku: "D1", wallId: "w1", t: 0.25, status: "planned" }, { id: "o2", sku: "D1", wallId: "w2", t: 0.5, status: "planned" }],
    finishRuns: [
      { id: "f1", wallId: "w1", side: 1, a: 1, b: 2, x1: 1, y1: 0.11, x2: 2, y2: 0.11, vx: 1.5, vy: 0.3 },
      { id: "f2", wallId: "w2", side: 1, a: 1, b: 1.5, x1: 4, y1: 1.11, x2: 4, y2: 1.61 },
    ],
  });
  const result = realignWallFaces(doc, [ref("segment", "w1")], "center", { skuById: thickSkuById });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  const moved = doc.segments[0];
  const neighbour = doc.segments[1];
  assert.ok(Math.abs(moved.y1) < 1e-9 && Math.abs(moved.y2) < 1e-9, `centreline at ${moved.y1}`);
  assert.equal(moved.location, undefined);
  assert.equal(moved.x1, 0);
  assert.equal(moved.x2, 4);
  assert.ok(Math.abs(neighbour.y1) < 1e-9, `join moved to ${neighbour.y1}`);
  assert.equal(neighbour.x1, 4);
  assert.equal(neighbour.x2, 4);
  assert.equal(neighbour.y2, 3);
  assert.equal(doc.openings[0].t, 0.25);
  assert.ok(Math.abs(doc.finishRuns[0].a - 1) < 1e-9 && Math.abs(doc.finishRuns[0].y1) < 1e-9);
  // The return wall grew at its start. The opening keeps its point in the plan.
  const oldT = 0.5;
  const oldY = 0.11 + oldT * (3 - 0.11);
  assert.ok(Math.abs(neighbour.y1 + doc.openings[1].t * (neighbour.y2 - neighbour.y1) - oldY) < 1e-9);
  assert.ok(Math.abs(doc.finishRuns[1].a - 1.11) < 1e-9, `finish station ${doc.finishRuns[1].a}`);
});

test("realign leaves a wall that is already on the chosen line", () => {
  const doc = docWith({ segments: [wall("w1", 0, 1, 4, 1, "T220")] });
  const result = realignWallFaces(doc, [ref("segment", "w1")], "center", { skuById: thickSkuById });
  assert.equal(result.changed, false);
  assert.equal(doc.segments[0].y1, 1);
});

test("realign does not move a foundation", () => {
  const footing = { id: "FND", category: "foundation", name: "FND", geometry: { thickness: 0.22 } };
  const skuById = (id) => (id === "FND" ? footing : thickSkuById(id));
  const doc = docWith({ segments: [{ ...wall("f1", 0, 0, 4, 0, "FND"), location: "exterior" }] });
  const result = realignWallFaces(doc, [ref("segment", "f1")], "center", { skuById });
  assert.equal(result.ok, false);
  assert.equal(doc.segments[0].y1, 0);
});

test("mirroring swaps the name of the face a wall was drawn on", () => {
  const doc = docWith({ segments: [{ ...wall("w1", 0, 0, 4, 0), location: "exterior" }, wall("w2", 0, 2, 4, 2)] });
  mirrorSelection(doc, [ref("segment", "w1"), ref("segment", "w2")], { axis: "h" });
  assert.equal(doc.segments[0].location, "interior");
  assert.equal(doc.segments[1].location, undefined);
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
