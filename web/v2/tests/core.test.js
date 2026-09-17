import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  area,
  lineKey,
  perimeter,
  pointFromBasis,
  lineBasis,
  offsetOf,
  projectOnBasis,
  unionRectsOuter,
  simplify,
  rectPoly,
} from "../geom.js";
import {
  PlanStore,
  emptyDoc,
  normalizeDoc,
  rectShape,
  rectsShape,
  polyShape,
  roomArea,
  roomMinDimension,
  roomPerimeter,
  roomPolygon,
  shapePolygon,
} from "../model.js";
import { deriveWalls, deriveRoomWalls, isExternalWall, statusVisible } from "../walls.js";
import { compile } from "../compile.js";
import { roomEdgeSegment, roomOpeningAreas } from "../openings.js";
import { validatePack, complianceGaps, normalizePackUnits } from "../schema.js";

// The file on disk states geometry in millimetres (sp.pack/3); every consumer
// under test here (walls.js, compile.js, ...) still works in metres, so this
// normalizes at load exactly like ui.js does at runtime.
const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

// Two rooms sharing part of one edge - the same arrangement v1's demoDoc used.
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

// --- schema ---------------------------------------------------------------

test("migrated pack validates", () => {
  const result = validatePack(pack);
  assert.equal(result.errors.length, 0, result.errors.join("\n"));
  assert.equal(result.ok, true);
});

test("validator rejects an unknown compliance fact", () => {
  const bad = structuredClone(pack);
  bad.skus[0].compliance.notAThing = 1;
  const result = validatePack(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /notAThing/);
});

test("validator requires every compliance fact to be present", () => {
  const bad = structuredClone(pack);
  delete bad.skus[0].compliance.rValue;
  const result = validatePack(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /rValue: must be present/);
});

test("validator catches dangling SKU references", () => {
  const bad = structuredClone(pack);
  bad.recipes.allowedHosts.TSP_DR900 = ["TSP_NOPE"];
  const result = validatePack(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unknown host SKU TSP_NOPE/);
});

test("validator enforces the TSP schedule measures per category", () => {
  const bad = structuredClone(pack);
  const wall = bad.skus.find((s) => s.category === "wall");
  wall.schedule.report = ["count"];
  const result = validatePack(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /must report volume/);
});

test("null compliance facts surface as gaps, not silent zeros", () => {
  const gaps = complianceGaps(pack);
  const wall = gaps.find((g) => g.id === "TSP_MAS009");
  assert.ok(wall, "220mm masonry wall should have gaps");
  assert.ok(wall.missing.includes("rValue"));
  assert.ok(wall.missing.includes("surfaceDensity"));
});

// --- geometry -------------------------------------------------------------

test("polygon area and perimeter", () => {
  const poly = rectPoly(0, 0, 4, 3);
  assert.equal(area(poly), 12);
  assert.equal(perimeter(poly), 14);
});

test("simplify drops collinear vertices", () => {
  const poly = [[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]];
  assert.equal(simplify(poly).length, 4);
});

test("union of two rects makes an L with the right area and perimeter", () => {
  const ring = unionRectsOuter([
    { x: 0, y: 0, w: 4, h: 3 },
    { x: 4, y: 0, w: 4, h: 4 },
  ]);
  assert.equal(ring.length, 6);
  assert.equal(Math.round(area(ring) * 1e6) / 1e6, 28);
  assert.equal(Math.round(perimeter(ring) * 1e6) / 1e6, 24);
});

test("union of disjoint rects yields no single outer ring covering both", () => {
  const ring = unionRectsOuter([
    { x: 0, y: 0, w: 2, h: 2 },
    { x: 10, y: 10, w: 2, h: 2 },
  ]);
  assert.equal(area(ring), 4);
});

test("lineKey is direction insensitive so opposing edges share a wall", () => {
  assert.equal(lineKey(0, 0, 4, 0), lineKey(4, 0, 0, 0));
  assert.notEqual(lineKey(0, 0, 4, 0), lineKey(0, 1, 4, 1));
});

test("pointFromBasis inverts the line projection", () => {
  const basis = lineBasis(4, 0, 4, 3);
  const offset = offsetOf(basis, 4, 0);
  const [x, y] = pointFromBasis(basis, 0, offset);
  assert.equal(Math.round(x * 1e6) / 1e6, 4);
  assert.equal(Math.round(y * 1e6) / 1e6, 0);
});

test("angled line round-trips through the basis", () => {
  const basis = lineBasis(1, 1, 4, 5);
  const offset = offsetOf(basis, 1, 1);
  for (const [px, py] of [[1, 1], [4, 5], [2.5, 3]]) {
    const [x, y] = pointFromBasis(basis, projectOnBasis(basis, px, py), offset);
    assert.ok(Math.hypot(x - px, y - py) < 1e-9, `round-trip failed for ${px},${py}`);
  }
});

// --- shapes ---------------------------------------------------------------

test("rect, rects and poly shapes all resolve to polygons", () => {
  assert.equal(shapePolygon(rectShape(0, 0, 2, 2)).length, 4);
  assert.equal(shapePolygon(rectsShape([{ x: 0, y: 0, w: 2, h: 2 }])).length, 4);
  assert.equal(shapePolygon(polyShape([[0, 0], [3, 0], [3, 3]])).length, 3);
});

test("room measures work for an L-shaped room", () => {
  const room = {
    id: "l",
    shape: rectsShape([
      { x: 0, y: 0, w: 4, h: 3 },
      { x: 4, y: 0, w: 4, h: 4 },
    ]),
  };
  assert.equal(Math.round(roomArea(room) * 1e6) / 1e6, 28);
  assert.equal(Math.round(roomPerimeter(room) * 1e6) / 1e6, 24);
  // Narrowest leg, which is what SANS 10400-C means by "no dimension less than 2 m".
  assert.equal(roomMinDimension(room), 3);
});

test("min dimension of a rectangle is its short side", () => {
  assert.equal(roomMinDimension({ shape: rectShape(0, 0, 6, 1.8) }), 1.8);
});

// --- wall derivation ------------------------------------------------------

test("shared wall between two rooms splits at the step", () => {
  const doc = twoRoomDoc();
  const walls = deriveRoomWalls(doc, pack);

  assert.equal(walls.length, 8);
  const total = walls.reduce((s, w) => s + w.length, 0);
  assert.equal(Math.round(total * 1e6) / 1e6, 27);

  const shared = walls.filter((w) => w.shared);
  assert.equal(shared.length, 1);
  assert.equal(Math.round(shared[0].length * 1e6) / 1e6, 3);
  assert.deepEqual([...shared[0].roomIds].sort(), ["a", "b"]);

  // The 1 m stub above the shared portion belongs to room b alone.
  const stub = walls.find((w) => Math.abs(w.length - 1) < 1e-6);
  assert.ok(stub);
  assert.deepEqual(stub.roomIds, ["b"]);
  assert.equal(isExternalWall(stub), true);
});

test("shared wall is found between rooms at an angle", () => {
  // Two triangles meeting on a 45 degree edge - impossible in v1.
  const doc = normalizeDoc({
    rooms: [
      { id: "a", shape: polyShape([[0, 0], [4, 0], [4, 4]]), wallSku: "TSP_MAS009" },
      { id: "b", shape: polyShape([[0, 0], [4, 4], [0, 4]]), wallSku: "TSP_MAS009" },
    ],
  });
  const walls = deriveRoomWalls(doc, pack);
  const shared = walls.filter((w) => w.shared);
  assert.equal(shared.length, 1);
  assert.equal(Math.round(shared[0].length * 1e4) / 1e4, Math.round(Math.hypot(4, 4) * 1e4) / 1e4);
});

test("shared wall of existing and planned rooms is mixed", () => {
  const shared = deriveRoomWalls(twoRoomDoc(), pack).find((w) => w.shared);
  assert.equal(shared.status, "mixed");
});

test("statusVisible matches the plan/3D filter; mixed stays in both slices", () => {
  assert.equal(statusVisible("planned", "both"), true);
  assert.equal(statusVisible("existing", "both"), true);
  assert.equal(statusVisible("existing", "planned"), false);
  assert.equal(statusVisible("planned", "planned"), true);
  assert.equal(statusVisible("existing", "existing"), true);
  assert.equal(statusVisible("mixed", "existing"), true);
  assert.equal(statusVisible("mixed", "planned"), true);
});

test("thickest wall SKU wins where two rooms disagree", () => {
  const doc = normalizeDoc({
    rooms: [
      { id: "a", rect: { x: 0, y: 0, w: 4, h: 3 }, wallSku: "TSP_MAS008" },
      { id: "b", rect: { x: 4, y: 0, w: 4, h: 3 }, wallSku: "TSP_MAS009" },
    ],
  });
  const shared = deriveRoomWalls(doc, pack).find((w) => w.shared);
  assert.equal(shared.sku, "TSP_MAS009");
  assert.equal(shared.thickness, 0.22);
});

// Upper floors usually repeat the footprint below them, so two rooms on
// different levels commonly align in plan. Before levels were tracked this
// would have merged into one "shared" wall spanning two storeys.
test("rooms that align in plan on different levels never share a wall", () => {
  const doc = normalizeDoc({
    rooms: [
      { id: "a", level: "01 GFL", rect: { x: 0, y: 0, w: 4, h: 3 }, wallSku: "TSP_MAS009" },
      { id: "b", level: "02 L1", rect: { x: 4, y: 0, w: 4, h: 3 }, wallSku: "TSP_MAS009" },
    ],
  });
  const walls = deriveRoomWalls(doc, pack);
  assert.equal(walls.some((w) => w.shared), false);
  assert.deepEqual(new Set(walls.map((w) => w.level)), new Set(["01 GFL", "02 L1"]));
});

test("a room with no level falls back to the pack default rather than vanishing", () => {
  const doc = normalizeDoc({ rooms: [{ id: "a", rect: { x: 0, y: 0, w: 4, h: 3 }, wallSku: "TSP_MAS009" }] });
  const walls = deriveRoomWalls(doc, pack);
  assert.ok(walls.length > 0);
  assert.ok(walls.every((w) => w.level === pack.system.defaultLevel));
});

test("drawn segments become walls and are tagged as drawn", () => {
  const doc = normalizeDoc({
    traces: [{ id: "t1", sku: "TSP_CON052", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  assert.equal(walls.length, 1);
  assert.equal(walls[0].drawn, true);
  assert.equal(walls[0].category, "foundation");
  assert.equal(walls[0].level, pack.system.defaultLevel);
});

test("a drawn segment's own level carries onto its derived wall", () => {
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_CON052", level: "02 L1", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  assert.equal(walls[0].level, "02 L1");
});

// A 600X200 bearing footing is a strip: 600 mm in plan, 200 mm tall. Drawing it
// as a storey-high 200 mm wall is what the 3D view used to do.
const STRIP_SKU = {
  id: "TSP_FND_STRIP",
  name: "Bearing Footing - 600X200 mm",
  category: "foundation",
  geometry: { thickness: 0.2, width: 0.6, depth: 0.2 },
};
const stripPack = { ...pack, skus: [...pack.skus, STRIP_SKU] };

test("a strip footing is 600 mm wide and 200 mm tall, not a storey-high wall", () => {
  const doc = normalizeDoc({
    segments: [{ id: "f1", sku: STRIP_SKU.id, level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, stripPack);
  assert.equal(walls[0].thickness, 0.6);
  assert.equal(walls[0].height, 0.2);

  const form = compile(doc, stripPack).sketchForms.find((f) => f.elementId === "f1");
  assert.equal(form.thickness, 0.6);
  assert.equal(form.depth, 0.2);
  assert.equal(form.elevation, 0);
});

test("a masonry foundation wall keeps its wall thickness and stated height", () => {
  const doc = normalizeDoc({
    segments: [{ id: "f1", sku: "TSP_CON052", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  assert.equal(walls[0].thickness, 0.22);
  assert.equal(walls[0].height, 0.6);
});

// --- opening migration ----------------------------------------------------

test("v1 compass edges migrate to edge indices at the same physical point", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", rect: { x: 4, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
    openings: [
      { id: "o1", sku: "TSP_WN1812", roomId: "b", edge: "N", t: 0.25 },
      { id: "o2", sku: "TSP_WN1812", roomId: "b", edge: "S", t: 0.25 },
    ],
  });
  const room = doc.rooms[0];

  // v1: north edge ran (4,4) -> (8,4), so t=0.25 meant x=5.
  const o1 = doc.openings[0];
  assert.equal(o1.edgeIndex, 2);
  assert.equal(o1.t, 0.75);
  const nEdge = roomEdgeSegment(room, o1.edgeIndex);
  const nx = nEdge.x1 + (nEdge.x2 - nEdge.x1) * o1.t;
  assert.equal(Math.round(nx * 1e6) / 1e6, 5);

  // South ran in the same direction in v1, so t is untouched.
  const o2 = doc.openings[1];
  assert.equal(o2.edgeIndex, 0);
  assert.equal(o2.t, 0.25);
  const sEdge = roomEdgeSegment(room, o2.edgeIndex);
  const sx = sEdge.x1 + (sEdge.x2 - sEdge.x1) * o2.t;
  assert.equal(Math.round(sx * 1e6) / 1e6, 5);
});

// --- compile --------------------------------------------------------------

test("compile emits the v1 payload contract", () => {
  const out = compile(twoRoomDoc(), pack);
  assert.equal(out.documentKind, "Planner");
  assert.ok(Array.isArray(out.instances));
  assert.ok(Array.isArray(out.sketchForms));
  assert.ok(Array.isArray(out.plans));
  assert.equal(out.plans[0].isActive, true);

  for (const row of out.instances) {
    for (const key of ["category", "model", "family", "type", "elementId", "count", "unit", "status"]) {
      assert.ok(key in row, `instance missing ${key}: ${JSON.stringify(row)}`);
    }
  }
});

test("wall quantities match hand-computed values", () => {
  const out = compile(twoRoomDoc(), pack);
  const walls = out.instances.filter((r) => r.category === "Walls" && !r.implied);
  const length = walls.reduce((s, r) => s + r.length, 0);
  assert.equal(Math.round(length * 1e6) / 1e6, 27);

  // 27 m of 220 mm wall at 2.8 m high.
  const volume = walls.reduce((s, r) => s + r.volume, 0);
  assert.equal(Math.round(volume * 1e4) / 1e4, Math.round(27 * 2.8 * 0.22 * 1e4) / 1e4);
});

test("floor areas come from the room polygons", () => {
  const out = compile(twoRoomDoc(), pack);
  const floors = out.instances.filter((r) => r.category === "Floors");
  assert.equal(floors.length, 2);
  assert.equal(Math.round(floors.reduce((s, r) => s + r.area, 0) * 1e6) / 1e6, 12 + 16);
});

test("masonry walls imply a foundation by wall length", () => {
  const out = compile(twoRoomDoc(), pack);
  const implied = out.instances.find((r) => r.implied && r.model === "TSP_CON052");
  assert.ok(implied, "expected an implied foundation");
  assert.equal(Math.round(implied.length * 1e6) / 1e6, 27);
});

test("a drawn foundation suppresses the implied one", () => {
  const doc = twoRoomDoc();
  doc.segments.push({
    id: "t1", sku: "TSP_CON052", x1: 0, y1: -0.4, x2: 8, y2: -0.4, status: "planned",
  });
  const out = compile(doc, pack);
  assert.equal(out.instances.filter((r) => r.implied && r.model === "TSP_CON052").length, 0);
});

test("compile reports rooms with the data the compliance engine needs", () => {
  const out = compile(twoRoomDoc(), pack);
  assert.equal(out.rooms.length, 2);
  const bed = out.rooms.find((r) => r.use === "bedroom");
  assert.equal(bed.sansClass, "bedroom");
  assert.equal(bed.area, 16);
  assert.equal(bed.minDimension, 4);
  assert.equal(bed.minDimensionExact, true);
  assert.equal(bed.ceilingHeight, 2.8);
});

test("a ceiling slab renders at floor-to-ceiling height, not flush with the floor", () => {
  // No ceiling SKU in the sample pack yet, so append a minimal one rather than
  // hand-editing the fixture. floorToCeiling is null on every level in this
  // pack (the real gap - the firm has not supplied it), so this also proves
  // the fallback to system.wallHeight is what a drawn ceiling actually uses.
  const ceilingPack = {
    ...pack,
    skus: [
      ...pack.skus,
      {
        id: "TSP_TEST_CEIL",
        name: "Test ceiling",
        category: "ceiling",
        unit: "m2",
        draw: "fill",
        geometry: { thickness: 0.012 },
        cost: { rateRef: "TSP_TEST_CEIL", wasteFactor: null },
        compliance: { rValue: null },
        drawing: { colourClass: "other", hatch: null, symbol: null },
        schedule: { report: ["area", "count"], scheduleName: null },
      },
    ],
  };
  const doc = normalizeDoc({
    slabs: [{ id: "c1", sku: "TSP_TEST_CEIL", level: "01 GFL", rect: { x: 0, y: 0, w: 4, h: 3 } }],
  });
  const out = compile(doc, ceilingPack);
  const ceilingForm = out.sketchForms.find((f) => f.elementId === "c1");
  const floorForm = compile(
    normalizeDoc({ slabs: [{ id: "f1", sku: pack.system.defaultFloorSku, level: "01 GFL", rect: { x: 0, y: 0, w: 4, h: 3 } }] }),
    ceilingPack,
  ).sketchForms.find((f) => f.elementId === "f1");
  assert.equal(floorForm.elevation, 0, "a floor on 01 GFL sits at that level's datum");
  assert.equal(ceilingForm.elevation, 2.8, "a ceiling on 01 GFL sits at floor-to-ceiling height above it, using the wallHeight fallback since floorToCeiling is null");
  assert.notEqual(ceilingForm.elevation, floorForm.elevation, "a ceiling must never land flush with the floor");

  const noRoomOut = compile(doc, ceilingPack);
  assert.equal(noRoomOut.warnings.length, 1, "a ceiling on a level with no rooms is flagged, not silently accepted");
  assert.match(noRoomOut.warnings[0], /01 GFL/);

  const withRoomDoc = normalizeDoc({
    rooms: [{ id: "r1", name: "Lounge", use: "living", rect: { x: 0, y: 0, w: 4, h: 3 }, level: "01 GFL" }],
    slabs: [{ id: "c1", sku: "TSP_TEST_CEIL", level: "01 GFL", rect: { x: 0, y: 0, w: 4, h: 3 } }],
  });
  const withRoomOut = compile(withRoomDoc, ceilingPack);
  assert.equal(withRoomOut.warnings.length, 0, "a ceiling over an actual room raises no warning");
});

test("external walls are distinguished from shared ones", () => {
  const out = compile(twoRoomDoc(), pack);
  const shared = out.walls.filter((w) => !w.external);
  assert.equal(shared.length, 1);
});

test("only declared measures are attached to a row", () => {
  const out = compile(twoRoomDoc(), pack);
  const door = pack.skus.find((s) => s.category === "door");
  assert.deepEqual(door.schedule.report, ["count"]);
  const wallRow = out.instances.find((r) => r.category === "Walls" && !r.implied);
  assert.ok("volume" in wallRow);
  assert.ok(!("perimeter" in wallRow), "walls do not report perimeter");
});

// --- Part O input ---------------------------------------------------------

test("fixed windows contribute light but no ventilation", () => {
  const doc = normalizeDoc({
    rooms: [{
      id: "b", name: "Bedroom", use: "bedroom",
      rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009", floorSku: "TSP_RB016",
    }],
    openings: [{ id: "o1", sku: "TSP_WN1812", roomId: "b", edge: "S", t: 0.5 }],
  });
  const walls = deriveWalls(doc, pack);
  const areas = roomOpeningAreas(doc, pack, walls);
  const row = areas.get("b");
  assert.ok(row, "expected opening areas for the room");
  // 1.8 x 1.2 glazed
  assert.equal(Math.round(row.glazedArea * 1e6) / 1e6, 2.16);
  // Every window in the pack is family "Fixed", so nothing opens.
  assert.equal(row.openableArea, 0);
});

// --- store ----------------------------------------------------------------

test("undo restores the previous document", () => {
  const store = new PlanStore(twoRoomDoc());
  store.pushUndo();
  store.doc.rooms.pop();
  assert.equal(store.doc.rooms.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(store.doc.rooms.length, 2);
});

test("grouping and ungrouping survives selection expansion", () => {
  const store = new PlanStore(twoRoomDoc());
  store.setSelection([{ kind: "room", id: "a" }, { kind: "room", id: "b" }]);
  assert.equal(store.groupSelection(), true);
  store.selectOne({ kind: "room", id: "a" });
  assert.equal(store.selected.length, 2, "selecting one member selects the group");
  assert.equal(store.ungroupSelection(), true);
  store.selectOne({ kind: "room", id: "a" });
  assert.equal(store.selected.length, 1);
});

test("groups drop members that no longer exist", () => {
  const store = new PlanStore(twoRoomDoc());
  store.setSelection([{ kind: "room", id: "a" }, { kind: "room", id: "b" }]);
  store.groupSelection();
  store.doc.rooms = store.doc.rooms.filter((r) => r.id !== "b");
  store.pruneGroups();
  assert.equal(store.groups().length, 0);
});

test("moving a room translates its shape on the grid", () => {
  const store = new PlanStore(twoRoomDoc());
  const refs = [{ kind: "room", id: "a" }];
  const snaps = store.snapshotMoveTargets(refs);
  store.applyMoveSnapshot(snaps, 1.03, -0.07);
  const poly = roomPolygon(store.doc.rooms[0]);
  assert.equal(Math.round(poly[0][0] * 1e6) / 1e6, 1);
  assert.equal(Math.round(poly[0][1] * 1e6) / 1e6, -0.1);
});

test("persist and load round-trip through a storage stub", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
  };
  const store = new PlanStore(twoRoomDoc(), { storage });
  store.persist();
  const reloaded = new PlanStore(emptyDoc(), { storage });
  assert.equal(reloaded.load(), true);
  assert.equal(reloaded.doc.rooms.length, 2);
  assert.equal(reloaded.doc.schema, "sp.doc/2");
});

test("a v1 document migrates without loss", () => {
  const v1 = {
    rooms: [{ id: "r1", name: "Bathroom", rect: { x: 0, y: 0, w: 4, h: 3 }, wallSku: "TSP_MAS009" }],
    traces: [{ id: "t1", sku: "TSP_CON052", x1: 0, y1: 0, x2: 4, y2: 0 }],
    openings: [{ id: "o1", sku: "TSP_DR900", roomId: "r1", edge: "E", t: 0.45 }],
    items: [{ id: "i1", sku: "TSP_WC001", x: 0.45, y: 2.35 }],
    slabs: [{ id: "s1", sku: "TSP_RB017", rect: { x: 8, y: 0, w: 2.2, h: 2.4 }, level: "02 L1" }],
    roofs: [{ id: "rf1", sku: "TSP_RC003", rect: { x: 0, y: 0, w: 8, h: 4 }, form: "gable", pitch: 30 }],
  };
  const doc = normalizeDoc(v1);
  assert.equal(doc.schema, "sp.doc/2");
  assert.equal(doc.migratedFrom, "sp.doc/1");
  assert.equal(doc.rooms[0].shape.kind, "rect");
  assert.equal(doc.rooms[0].use, "bathroom", "use inferred from the v1 room name");
  assert.equal(doc.segments.length, 1, "traces became segments");
  assert.equal(doc.openings[0].edgeIndex, 1);
  assert.equal(doc.slabs[0].shape.kind, "rect");
  assert.equal(doc.roofs[0].pitch, 30);

  const out = compile(doc, pack);
  assert.ok(out.instances.length > 0);
});
