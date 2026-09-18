import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { openingDraftAt, openingOnWall, openingSideGaps } from "../openings.js";
import { normalizeDoc } from "../model.js";
import { deriveWalls } from "../walls.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const DOOR = pack.skus.find((s) => s.category === "door")?.id;
const WINDOW = pack.skus.find((s) => s.category === "window")?.id;

function twoRoomDoc() {
  return normalizeDoc({
    rooms: [
      {
        id: "a",
        name: "Bathroom",
        use: "bathroom",
        rect: { x: 0, y: 0, w: 4, h: 3 },
        wallSku: "TSP_MAS009",
        floorSku: "TSP_RB016",
        status: "existing",
      },
      {
        id: "b",
        name: "Bedroom",
        use: "bedroom",
        rect: { x: 4, y: 0, w: 4, h: 4 },
        wallSku: "TSP_MAS009",
        floorSku: "TSP_RB016",
        status: "planned",
      },
    ],
  });
}

test("a pointer on a room wall drafts an opening on that edge", () => {
  const doc = twoRoomDoc();
  const walls = deriveWalls(doc, pack);
  // South edge of the bathroom, midpoint, slightly inside the room.
  const draft = openingDraftAt(doc, pack, walls, WINDOW, 2, 0.05);
  assert.ok(draft);
  assert.equal(draft.roomId, "a");
  assert.equal(draft.wallId, undefined);
  assert.ok(Math.abs(draft.t - 0.5) < 0.05);
});

test("a pointer far from every wall drafts nothing", () => {
  const doc = twoRoomDoc();
  const walls = deriveWalls(doc, pack);
  assert.equal(openingDraftAt(doc, pack, walls, DOOR, 20, 20), null);
});

test("a drawn wall drafts by wallId, not by a room edge", () => {
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const draft = openingDraftAt(doc, pack, walls, DOOR, 3, 0.05);
  assert.ok(draft);
  assert.equal(draft.wallId, "s1");
  assert.equal(draft.roomId, undefined);
  assert.ok(Math.abs(draft.t - 0.5) < 0.05);
});

test("swing follows which side of the wall the pointer is on", () => {
  const doc = twoRoomDoc();
  const walls = deriveWalls(doc, pack);
  const inside = openingDraftAt(doc, pack, walls, DOOR, 2, 0.05);
  const outside = openingDraftAt(doc, pack, walls, DOOR, 2, -0.05);
  assert.ok(inside && outside);
  assert.equal(inside.swing, -outside.swing);
});

test("a shared wall drafts onto the room the pointer is in", () => {
  const doc = twoRoomDoc();
  const walls = deriveWalls(doc, pack);
  const fromBath = openingDraftAt(doc, pack, walls, DOOR, 3.95, 1.5);
  const fromBed = openingDraftAt(doc, pack, walls, DOOR, 4.05, 1.5);
  assert.equal(fromBath.roomId, "a");
  assert.equal(fromBed.roomId, "b");
});

test("placing an opening reports the clear gap to both wall ends", () => {
  const wall = { x1: 0, y1: 0, x2: 6, y2: 0, length: 6 };
  const placed = { t: 0.5, width: 1, a: { x: 2.5, y: 0 }, b: { x: 3.5, y: 0 } };
  const gaps = openingSideGaps(wall, placed);
  assert.equal(gaps.length, 2);
  assert.ok(Math.abs(gaps[0].dist - 2.5) < 1e-9);
  assert.ok(Math.abs(gaps[1].dist - 2.5) < 1e-9);
});

test("a neighbouring opening is the stop on that side, not the far wall end", () => {
  const wall = { x1: 0, y1: 0, x2: 8, y2: 0, length: 8 };
  const placed = { t: 0.25, width: 1, a: { x: 1.5, y: 0 }, b: { x: 2.5, y: 0 } };
  const neighbor = { t: 0.75, width: 1 };
  const gaps = openingSideGaps(wall, placed, [neighbor]);
  assert.equal(gaps.length, 2);
  assert.ok(Math.abs(gaps[0].dist - 1.5) < 1e-9);
  // 2.5 m (this jamb) to 5.5 m (neighbour jamb) = 3 m, not the 5.5 m to the end.
  assert.ok(Math.abs(gaps[1].dist - 3) < 1e-9);
});

test("an angled wall still measures along the wall, not in X/Y", () => {
  const wall = { x1: 0, y1: 0, x2: 3, y2: 4, length: 5 };
  const placed = { t: 0.5, width: 1 };
  const gaps = openingSideGaps(wall, placed);
  assert.equal(gaps.length, 2);
  assert.ok(Math.abs(gaps[0].dist - 2) < 1e-9);
  assert.ok(Math.abs(gaps[1].dist - 2) < 1e-9);
});

test("a drafted opening on a drawn wall has both side gaps", () => {
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const draft = openingDraftAt(doc, pack, walls, DOOR, 2, 0.05);
  const wall = walls.find((w) => w.id === "s1");
  const placed = openingOnWall(doc, pack, draft, wall);
  const gaps = openingSideGaps(wall, placed);
  assert.equal(gaps.length, 2);
  assert.ok(gaps.every((g) => g.dist > 0));
  assert.ok(Math.abs(gaps[0].dist + placed.width + gaps[1].dist - wall.length) < 1e-6);
});
