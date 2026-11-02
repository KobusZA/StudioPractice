import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc, roomArea, roomPolygon, roomTagLines } from "../model.js";
import { enclosedFace, spaceAt, syncRoomBounds } from "../room-bound.js";
import { compile } from "../compile.js";
import { deriveWalls, drawnWallThickness } from "../walls.js";
import { normalizePackUnits } from "../schema.js";
import { readFileSync } from "node:fs";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);
const WALL = pack.system.defaultWallSku;
const LEVEL = pack.system.defaultLevel;

function wall(id, x1, y1, x2, y2) {
  return { id, sku: WALL, level: LEVEL, x1, y1, x2, y2, status: "planned" };
}

function squareDoc() {
  const doc = emptyDoc();
  doc.segments = [
    wall("a", 0, 0, 4, 0),
    wall("b", 4, 0, 4, 4),
    wall("c", 4, 4, 0, 4),
    wall("d", 0, 4, 0, 0),
  ];
  return doc;
}

test("a point inside four walls resolves to the inner face", () => {
  const face = enclosedFace(squareDoc(), pack, LEVEL, 2, 2);
  assert.ok(face && face.length >= 4);
  const xs = face.map((p) => p[0]);
  const ys = face.map((p) => p[1]);
  assert.ok(Math.min(...xs) > 0.05, "inset past the left centreline");
  assert.ok(Math.max(...xs) < 3.95, "inset past the right centreline");
  assert.ok(Math.min(...ys) > 0.05);
  assert.ok(Math.max(...ys) < 3.95);
});

test("a point outside the walls is not a room", () => {
  assert.equal(enclosedFace(squareDoc(), pack, LEVEL, 8, 8), null);
});

test("a separation line splits the enclosed face", () => {
  const doc = squareDoc();
  doc.separations = [{ id: "s1", separation: true, level: LEVEL, x1: 2, y1: 0, x2: 2, y2: 4, status: "planned" }];
  const left = enclosedFace(doc, pack, LEVEL, 1, 2);
  const right = enclosedFace(doc, pack, LEVEL, 3, 2);
  assert.ok(left && right);
  assert.ok(Math.max(...left.map((p) => p[0])) <= 2.05);
  assert.ok(Math.min(...right.map((p) => p[0])) >= 1.95);
  assert.ok(roomArea({ shape: { kind: "poly", points: left } }) < 10);
});

test("moving a wall rewrites a bound room and does not price a second wall", () => {
  const doc = squareDoc();
  doc.rooms.push({
    id: "r1", name: "Room", use: "bedroom", level: LEVEL,
    wallSku: WALL, floorSku: pack.system.defaultFloorSku, status: "planned",
    bound: true, seed: { x: 2, y: 2 },
    shape: { kind: "rect", x: 0, y: 0, w: 4, h: 4 },
  });
  syncRoomBounds(doc, pack);
  const before = roomArea(doc.rooms[0]);
  doc.segments[1].x1 = 5;
  doc.segments[1].x2 = 5;
  doc.segments[0].x2 = 5;
  doc.segments[2].x1 = 5;
  syncRoomBounds(doc, pack);
  assert.ok(roomArea(doc.rooms[0]) > before);
  assert.equal(doc.rooms[0].shape.kind, "poly");
  const drawn = deriveWalls(doc, pack).filter((w) => w.drawn);
  const generated = deriveWalls(doc, pack).filter((w) => !w.drawn);
  assert.equal(drawn.length, 4);
  assert.equal(generated.length, 0);
  assert.ok(compile(doc, pack).rooms[0].area > before);
});

test("a room drawn before bounding keeps the polygon it stored", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "r1", name: "Room", use: "living", level: LEVEL, rect: { x: 0, y: 0, w: 3, h: 2 } }],
  });
  assert.equal(doc.rooms[0].bound, false);
  assert.equal(doc.rooms[0].seed, null);
  syncRoomBounds(doc, pack);
  assert.equal(roomPolygon(doc.rooms[0]).length, 4);
  assert.equal(roomArea(doc.rooms[0]), 6);
});

test("a closed square reports the inner area, and a point outside reports nothing", () => {
  const doc = squareDoc();
  const inside = spaceAt(doc, pack, LEVEL, 2, 2);
  assert.equal(inside.kind, "enclosed");
  assert.equal(inside.occupied, false);
  assert.ok(inside.area < 16, "inner face, not the centreline box");
  assert.ok(inside.area > 12);
  const face = enclosedFace(doc, pack, LEVEL, 2, 2);
  assert.equal(inside.area, roomArea({ shape: { kind: "poly", points: face } }));
  assert.equal(spaceAt(doc, pack, LEVEL, 8, 8).kind, "empty");
});

test("a gap reports no area, and only while the pointer is inside that room", () => {
  const doc = squareDoc();
  doc.segments[3] = wall("d", 0, 4, 0, 0.2);
  const inside = spaceAt(doc, pack, LEVEL, 2, 2);
  assert.equal(inside.kind, "open");
  assert.equal(inside.area, undefined);
  assert.equal(spaceAt(doc, pack, LEVEL, 8, 8).kind, "empty");
});

test("corners a few millimetres apart still enclose, the way the wall join does", () => {
  const doc = emptyDoc();
  doc.segments = [
    wall("a", 0, 0, 4, 0),
    wall("b", 4.004, 0, 4.004, 4),
    wall("c", 4, 4.004, 0, 4.004),
    wall("d", 0.004, 4, 0.004, 0),
  ];
  const inside = spaceAt(doc, pack, LEVEL, 2, 2);
  assert.equal(inside.kind, "enclosed");
  assert.ok(inside.area > 12 && inside.area < 16);
});

test("a face join encloses the room the same way the walls already draw it", () => {
  const doc = emptyDoc();
  const T = drawnWallThickness(pack.skus.find((s) => s.id === WALL));
  const half = T / 2;
  // Against: each return wall stops on the face, and the wall it meets runs
  // on to the far face. The bands close. The centrelines do not touch.
  doc.segments = [
    wall("bottom", -half, 0, 4 + half, 0),
    wall("right", 4, half, 4, 3 - half),
    wall("top", 4 + half, 3, -half, 3),
    wall("left", 0, 3 - half, 0, half),
  ];
  const inside = spaceAt(doc, pack, LEVEL, 2, 1.5);
  assert.equal(inside.kind, "enclosed");
  assert.ok(inside.area > 8 && inside.area < 12);
  const face = enclosedFace(doc, pack, LEVEL, 2, 1.5);
  const xs = face.map((p) => p[0]);
  const ys = face.map((p) => p[1]);
  assert.ok(Math.min(...xs) > 0.05, "inner face, past the left centreline");
  assert.ok(Math.max(...xs) < 3.95);
  assert.ok(Math.min(...ys) > 0.05);
  assert.ok(Math.max(...ys) < 2.95);
});

test("a gap in one room does not speak for the other, or for the space between them", () => {
  const doc = squareDoc();
  doc.segments.push(
    wall("e", 10, 0, 14, 0),
    wall("f", 14, 0, 14, 4),
    wall("g", 14, 4, 10, 4),
    wall("h", 10, 4, 10, 0.2),
  );
  assert.equal(spaceAt(doc, pack, LEVEL, 2, 2).kind, "enclosed");
  assert.equal(spaceAt(doc, pack, LEVEL, 12, 2).kind, "open");
  assert.equal(spaceAt(doc, pack, LEVEL, 7, 2).kind, "empty");
});

test("a separation line reports two areas", () => {
  const doc = squareDoc();
  doc.separations = [{ id: "s1", separation: true, level: LEVEL, x1: 2, y1: 0, x2: 2, y2: 4, status: "planned" }];
  const left = spaceAt(doc, pack, LEVEL, 1, 2);
  const right = spaceAt(doc, pack, LEVEL, 3, 2);
  assert.equal(left.kind, "enclosed");
  assert.equal(right.kind, "enclosed");
  assert.ok(left.area < 10 && right.area < 10);
  assert.ok(Math.abs(left.area - right.area) < 0.05);
});

test("a point inside an existing room is marked occupied", () => {
  const doc = squareDoc();
  const face = enclosedFace(doc, pack, LEVEL, 2, 2);
  doc.rooms.push({
    id: "r1", name: "Room", use: "other", level: LEVEL,
    shape: { kind: "poly", points: face },
  });
  const inside = spaceAt(doc, pack, LEVEL, 2, 2);
  assert.equal(inside.kind, "enclosed");
  assert.equal(inside.occupied, true);
});

test("an annotation line across a room does not split the area", () => {
  const doc = squareDoc();
  doc.lines = [{ id: "a1", kind: "annotation", level: LEVEL, x1: 0, y1: 2, x2: 4, y2: 2, status: "planned" }];
  const south = spaceAt(doc, pack, LEVEL, 2, 1);
  const north = spaceAt(doc, pack, LEVEL, 2, 3);
  assert.equal(south.kind, "enclosed");
  assert.equal(north.kind, "enclosed");
  assert.ok(Math.abs(south.area - north.area) < 1e-6);
  assert.ok(south.area > 12);
});

test("a known use replaces the placeholder room name on the plan", () => {
  assert.deepEqual(roomTagLines({ name: "Room", use: "study" }), { title: "Study", subtitle: "" });
  assert.deepEqual(roomTagLines({ name: "Room", use: "other" }), { title: "Room", subtitle: "" });
  assert.deepEqual(roomTagLines({ name: "North", use: "study" }), { title: "North", subtitle: "Study" });
});
