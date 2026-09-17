import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { openingDraftAt } from "../openings.js";
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
