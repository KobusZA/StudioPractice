import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc, roomArea, roomPolygon } from "../model.js";
import { enclosedFace, syncRoomBounds } from "../room-bound.js";
import { compile } from "../compile.js";
import { deriveWalls } from "../walls.js";
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
