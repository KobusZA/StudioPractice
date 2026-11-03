import { test } from "node:test";
import assert from "node:assert/strict";

import { PlanStore, emptyDoc, rectShape, shapePolygon } from "../model.js";
import { splitWallAt } from "../modify.js";
import {
  floorSocketDraft,
  socketSurface,
  syncHostedSockets,
  wallSocketDraft,
} from "../socket-host.js";
import { deriveWalls } from "../walls.js";

const pack = {
  system: { wallHeight: 2.7 },
  levels: [{ id: "g", elevation: 0 }],
  skus: [
    { id: "W", category: "wall", geometry: { thickness: 0.22, height: 2.7 } },
    { id: "PLUG", name: "TSP Single Plug", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "DOUBLE", name: "TSP Double Plug.0001", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "SHAVER", name: "TSP Shaver Plug", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "CEIL", name: "TSP Single Plug Ceiling", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "SLABPLUG", name: "TSP Single Plug Slab", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "SWITCH", name: "TSP Two-way switching", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "FLOOR", name: "TSP Floor light points", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "RECESS", name: "TSP Recessed Floor Light Point", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "HEAT", name: "TSP Underfloor heating points", category: "electrical", geometry: { width: 0.086, depth: 0.086, height: 0.086 } },
    { id: "SLAB", category: "floor", geometry: { thickness: 0.1 } },
  ],
};

function sku(id) {
  return pack.skus.find((s) => s.id === id);
}

function centre(item) {
  return { x: item.x + 0.043, y: item.y + 0.043 };
}

function wallDoc() {
  const doc = emptyDoc();
  doc.segments.push({
    id: "w1", sku: "W", level: "g", status: "planned",
    x1: 0, y1: 0, x2: 6, y2: 0,
  });
  return doc;
}

test("plugs host on a wall and floor points host on a floor", () => {
  assert.equal(socketSurface(sku("PLUG")), "wall");
  assert.equal(socketSurface(sku("DOUBLE")), "wall");
  assert.equal(socketSurface(sku("SHAVER")), "wall");
  assert.equal(socketSurface(sku("FLOOR")), "floor");
  assert.equal(socketSurface(sku("RECESS")), "floor");
  assert.equal(socketSurface(sku("HEAT")), "floor");
  assert.equal(socketSurface(sku("CEIL")), null);
  assert.equal(socketSurface(sku("SLABPLUG")), null);
  assert.equal(socketSurface(sku("SWITCH")), null);
});

test("a plug click off the wall is refused", () => {
  const doc = wallDoc();
  const walls = deriveWalls(doc, pack);
  assert.equal(wallSocketDraft(walls, sku("PLUG"), 2, 2), null);
});

test("a plug attaches to the wall and moves with it", () => {
  const doc = wallDoc();
  const walls = deriveWalls(doc, pack);
  const draft = wallSocketDraft(walls, sku("PLUG"), 2, 0.05, { preferId: "w1" });
  assert.ok(draft);
  assert.equal(draft.wallId, "w1");
  const at = centre(draft);
  assert.ok(Math.abs(at.x - 2) < 0.05, "along the wall");
  assert.ok(Math.abs(Math.abs(at.y) - 0.11) < 0.02, "on the face");
  doc.items.push({ id: "p1", sku: "PLUG", level: "g", ...draft });
  const seg = doc.segments[0];
  seg.x1 += 3;
  seg.y1 += 1;
  seg.x2 += 3;
  seg.y2 += 1;
  syncHostedSockets(doc, pack);
  const moved = centre(doc.items[0]);
  assert.ok(Math.abs(moved.x - (at.x + 3)) < 0.02);
  assert.ok(Math.abs(moved.y - (at.y + 1)) < 0.02);
  assert.equal(doc.items[0].wallId, "w1");
});

test("splitting a wall keeps the plug on the piece that holds it", () => {
  const doc = wallDoc();
  const walls = deriveWalls(doc, pack);
  const draft = wallSocketDraft(walls, sku("PLUG"), 4.5, 0.02);
  doc.items.push({ id: "p1", sku: "PLUG", level: "g", ...draft });
  const result = splitWallAt(doc, { kind: "segment", id: "w1" }, { x: 3, y: 0 });
  assert.equal(result.ok, true);
  syncHostedSockets(doc, pack);
  const plug = doc.items[0];
  assert.notEqual(plug.wallId, "w1");
  const host = doc.segments.find((s) => s.id === plug.wallId);
  const at = centre(plug);
  const along = (at.x - host.x1) / (host.x2 - host.x1);
  assert.ok(along > 0.05 && along < 0.95);
  assert.ok(Math.abs(at.y) < 0.2);
});

test("a floor point off the floor is refused", () => {
  const doc = emptyDoc();
  doc.slabs.push({ id: "s1", sku: "SLAB", level: "g", shape: rectShape(0, 0, 4, 3) });
  assert.equal(floorSocketDraft(doc, sku("FLOOR"), 8, 8, { level: "g" }), null);
});

test("a floor point stays inside the floor when the floor moves and when an edge cuts it", () => {
  const doc = emptyDoc();
  doc.slabs.push({ id: "s1", sku: "SLAB", level: "g", shape: rectShape(0, 0, 4, 3) });
  const draft = floorSocketDraft(doc, sku("FLOOR"), 3.2, 1.5, { preferId: "s1", level: "g" });
  assert.equal(draft.slabId, "s1");
  doc.items.push({ id: "f1", sku: "FLOOR", level: "g", ...draft });
  const store = new PlanStore(doc);
  const snaps = store.snapshotMoveTargets([{ kind: "slab", id: "s1" }]);
  assert.equal(snaps.some((s) => s.ref.kind === "item" && s.ref.id === "f1"), true);
  store.applyMoveSnapshot(snaps, 5, 2, null);
  syncHostedSockets(store.doc, pack);
  const moved = centre(store.doc.items[0]);
  assert.ok(Math.abs(moved.x - 8.2) < 0.05);
  assert.ok(Math.abs(moved.y - 3.5) < 0.05);
  const poly = shapePolygon(store.doc.slabs[0].shape);
  assert.ok(poly.every(([x]) => x >= 4.9));
  store.doc.slabs[0].shape = { kind: "poly", points: [[5, 2], [6, 2], [6, 5], [5, 5]] };
  syncHostedSockets(store.doc, pack);
  const pulled = centre(store.doc.items[0]);
  assert.ok(pulled.x >= 5 - 1e-6 && pulled.x <= 6 + 1e-6);
  assert.ok(pulled.y >= 2 - 1e-6 && pulled.y <= 5 + 1e-6);
  assert.equal(store.doc.items[0].slabId, "s1");
});
