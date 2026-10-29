import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { doorSwing, openingDraftAt, openingOnWall, openingSideGaps, pointInDoorSwing, pointInOpeningCut, pointOnOpeningSymbol, slideOpening } from "../openings.js";
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

test("a door hinges at the low-t jamb unless hand says otherwise", () => {
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const wall = walls.find((w) => w.id === "s1");
  const usual = openingDraftAt(doc, pack, walls, DOOR, 3, 0.05);
  const flipped = openingDraftAt(doc, pack, walls, DOOR, 3, 0.05, -1);
  assert.equal(usual.hand, 1);
  assert.equal(flipped.hand, -1);
  const placed = openingOnWall(doc, pack, usual, wall);
  const fromA = doorSwing(wall, placed, usual);
  const fromB = doorSwing(wall, placed, flipped);
  assert.ok(Math.abs(fromA.hinge.x - placed.a.x) < 1e-9);
  assert.ok(Math.abs(fromB.hinge.x - placed.b.x) < 1e-9);
  assert.ok(fromA.leaf.y > 0 && fromB.leaf.y > 0);

  doc.openings = [{ id: "o1", sku: DOOR, wallId: "s1", t: usual.t, swing: usual.swing, status: "planned" }];
  const leafOf = (hand) => {
    doc.openings[0].hand = hand;
    const form = compile(doc, pack).sketchForms.find((f) => f.elementId === "o1");
    const line = form.profileLoops[0].curves[0];
    const arc = form.profileLoops[0].curves.find((c) => c.kind === "Arc");
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    return dist(arc.end, line.start) < dist(arc.end, line.end) ? "a" : "b";
  };
  assert.equal(leafOf(undefined), "a");
  assert.equal(leafOf(-1), "b");
});

test("a click on the swing leaf hits the door; a click in the room does not", () => {
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const wall = walls.find((w) => w.id === "s1");
  const opening = { sku: DOOR, wallId: "s1", t: 0.5, swing: 1, hand: 1 };
  const placed = openingOnWall(doc, pack, opening, wall);
  const swing = doorSwing(wall, placed, opening);
  const midLeaf = {
    x: (swing.hinge.x + swing.leaf.x) / 2,
    y: (swing.hinge.y + swing.leaf.y) / 2,
  };
  assert.equal(pointOnOpeningSymbol(wall, placed, opening, midLeaf.x, midLeaf.y, 0.15), true);
  assert.equal(pointOnOpeningSymbol(wall, placed, opening, swing.hinge.x, swing.hinge.y, 0.15), true);
  assert.equal(pointOnOpeningSymbol(wall, placed, opening, midLeaf.x, midLeaf.y + 2, 0.15), false);
  const from = Math.atan2(swing.free.y - swing.hinge.y, swing.free.x - swing.hinge.x);
  const to = Math.atan2(swing.leaf.y - swing.hinge.y, swing.leaf.x - swing.hinge.x);
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const radius = Math.hypot(swing.free.x - swing.hinge.x, swing.free.y - swing.hinge.y);
  const ang = from + sweep / 2;
  const onArc = {
    x: swing.hinge.x + Math.cos(ang) * radius,
    y: swing.hinge.y + Math.sin(ang) * radius,
  };
  assert.equal(pointOnOpeningSymbol(wall, placed, opening, onArc.x, onArc.y, 0.15), true);
  const chord = {
    x: (swing.leaf.x + swing.free.x) / 2,
    y: (swing.leaf.y + swing.free.y) / 2,
  };
  assert.equal(pointOnOpeningSymbol(wall, placed, opening, chord.x, chord.y, 0.15), false);
  const centreX = (placed.a.x + placed.b.x) / 2;
  assert.ok(Math.abs(swing.hinge.x - centreX) > 0.3, "the hinge sits outside a circle around the midpoint");
  // On the wall face, beside the opening, further out than the swing stroke
  // but still on the wall's own thickness. That click is the door, not the wall.
  const face = { x: centreX, y: 0.2 };
  assert.equal(pointOnOpeningSymbol(wall, placed, opening, face.x, face.y, 0.15), false);
  assert.equal(pointInOpeningCut(placed, face.x, face.y, 0.25), true);
  assert.equal(pointInOpeningCut(placed, centreX - 2, face.y, 0.25), false);
});

test("a window draft has no hinge", () => {
  const doc = twoRoomDoc();
  const walls = deriveWalls(doc, pack);
  const draft = openingDraftAt(doc, pack, walls, WINDOW, 2, 0.05, -1);
  assert.equal(draft.hand, undefined);
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

test("dragging a door slides it along the wall, flips the swing on the other side, and can change walls", () => {
  const doc = normalizeDoc({
    segments: [
      { id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 6, y2: 0 },
      { id: "s2", sku: "TSP_MAS009", x1: 0, y1: 4, x2: 6, y2: 4 },
    ],
    openings: [{ id: "o1", sku: DOOR, wallId: "s1", t: 0.5, swing: 1, hand: 1, status: "planned" }],
  });
  const walls = deriveWalls(doc, pack);
  const opening = doc.openings[0];
  assert.equal(slideOpening(doc, pack, walls, opening, 1.5, 0.02), true);
  assert.equal(opening.wallId, "s1");
  assert.ok(Math.abs(opening.t - 0.25) < 0.05);
  assert.equal(opening.swing, 1, "a drag along the wall does not flip the swing");
  assert.equal(opening.hand, 1);

  assert.equal(slideOpening(doc, pack, walls, opening, 1.5, -0.5), true);
  assert.equal(opening.swing, -1);
  assert.equal(opening.hand, 1);
  assert.equal(opening.wallId, "s1");

  assert.equal(slideOpening(doc, pack, walls, opening, 4, 4.05), true);
  assert.equal(opening.wallId, "s2");
  assert.equal(opening.hand, 1);
});

test("dragging a door by its swing still slides it along the wall", () => {
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 6, y2: 0 }],
    openings: [{ id: "o1", sku: DOOR, wallId: "s1", t: 0.5, swing: 1, hand: 1, status: "planned" }],
  });
  const walls = deriveWalls(doc, pack);
  const wall = walls.find((w) => w.id === "s1");
  const opening = doc.openings[0];
  const placed = openingOnWall(doc, pack, opening, wall);
  const swing = doorSwing(wall, placed, opening);
  assert.ok(pointInDoorSwing(wall, placed, opening, (swing.hinge.x + swing.leaf.x) / 2, (swing.hinge.y + swing.leaf.y) / 2));
  assert.equal(pointInDoorSwing(wall, placed, opening, swing.leaf.x, swing.leaf.y + 0.4), false);
  const before = opening.t;
  assert.equal(slideOpening(doc, pack, walls, opening, swing.leaf.x - 1.2, swing.leaf.y), true);
  assert.ok(opening.t < before - 0.05, "the leaf is the door, so a drag from it has to move the opening");
  assert.equal(opening.swing, 1, "the swing side under the leaf is the side it already opens to");
  assert.equal(opening.wallId, "s1");
  assert.equal(opening.hand, 1);
});

test("dragging a window moves it along its wall even when the pointer leaves the wall line", () => {
  const doc = twoRoomDoc();
  const walls = deriveWalls(doc, pack);
  const draft = openingDraftAt(doc, pack, walls, WINDOW, 2, 0.05);
  doc.openings = [{ id: "o1", status: "planned", ...draft }];
  const opening = doc.openings[0];
  const before = opening.t;
  assert.equal(slideOpening(doc, pack, walls, opening, 1, 0.8), true);
  assert.ok(opening.t < before - 0.05);
  assert.equal(opening.roomId, "a");
  assert.equal(opening.edgeIndex, draft.edgeIndex);
});
