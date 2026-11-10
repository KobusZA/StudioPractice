import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile, resolvedBase } from "../compile.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import {
  defaultSegmentTop,
  deriveDrawnWalls,
  deriveWalls,
  drawnSegmentFromWall,
  foundationChecks,
} from "../walls.js";
import { ceilingElevation, fflText, floorLevel, roomCeilingHeight, spotLevelLabel } from "../floor-levels.js";
import { levelAboveRise } from "../level-view.js";
import { sectionSpotLevels } from "../section.js";
import { addFoundationUnderWall, elevationModel } from "../wall-elevation.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);
const plannerPack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const WALL = "TSP_WAL_MASONARY_WALL_220MM_PLASTER";
const PARTITION = "TSP_WAL_MASONARY_WALL_110MM_PLASTER";
const POOL = "TSP_WAL_POOL_MASONRY_WALL_220MM_PLAS";
const FND_WALL = "TSP_FND_MASONARY_WALL_220MM_FOUNDATI";
const FOOTING = "TSP_FND_BEARING_FOOTING_600X200_MM";
const CEILING = "TSP_CLG_9MM_PLASTERED_CEILINGS";
const FLOOR = "TSP_FLR_GENERIC_85MM";
const GFL = "01 GFL";
const FND = "00 FOUNDATION";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ""} expected ${b}, got ${a}`);

function room(id, x, y, w, h, extra = {}) {
  return { id, name: id, use: "living", level: GFL, wallSku: WALL, rect: { x, y, w, h }, ...extra };
}

function seg(id, x1, y1, x2, y2, extra = {}) {
  return { id, sku: WALL, level: GFL, x1, y1, x2, y2, status: "planned", ...extra };
}

function roomDoc(extra = {}) {
  return normalizeDoc({ rooms: [room("r1", 0, 0, 5, 4)], ...extra });
}

const derived = (walls) => walls.filter((w) => w.derived);
const wallBase = (doc, p, wall) => resolvedBase(doc, p, wall, wall.height);

// --- 1. A plain room ---------------------------------------------------------

test("a 5 x 4 room gets four 220 foundation walls on its wall lines, from the foundation level to the floor", () => {
  const doc = roomDoc();
  const walls = deriveWalls(doc, pack);
  const above = walls.filter((w) => w.category === "wall");
  const found = derived(walls);
  assert.equal(found.length, 4);
  for (const f of found) {
    assert.equal(f.category, "foundation");
    assert.equal(f.sku, FND_WALL);
    assert.equal(f.level, FND);
    assert.equal(f.drawn, false);
    near(f.thickness, 0.22);
    near(f.height, 0.6);
    const host = above.find((w) => w.id === f.hostWallId);
    assert.ok(host, "each foundation wall names the wall it carries");
    near(Math.min(f.x1, f.x2), Math.min(host.x1, host.x2));
    near(Math.max(f.y1, f.y2), Math.max(host.y1, host.y2));
    assert.ok(f.id.startsWith(`f:${host.id}:`));
    const base = wallBase(doc, pack, f);
    near(base.elevation, -0.6);
    near(base.elevation + base.height, 0);
  }
  const out = compile(doc, pack);
  const rows = out.instances.filter((r) => r.derived);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.category === "Walls" && r.kind === null));
  assert.ok(out.instances.some((r) => r.implied && r.model === FOOTING), "the implied footing is still priced");
});

// --- 2. Floor build-up -------------------------------------------------------

test("a 30 mm build-up drops the foundation tops and lengthens the walls without moving their tops", () => {
  const doc = roomDoc({ floorBuildUp: 30 });
  const walls = deriveWalls(doc, pack);
  for (const f of derived(walls)) near(f.height, 0.57);
  const out = compile(doc, pack);
  for (const w of out.walls.filter((row) => row.level === GFL)) {
    near(w.baseElevation, -0.03);
    near(w.height, 3.03);
    near(w.baseElevation + w.height, 3);
  }
});

// --- 3. A step in the floor --------------------------------------------------

test("a room sunk 170 mm drops its walls and the one foundation wall under the shared wall", () => {
  const doc = normalizeDoc({
    rooms: [room("r1", 0, 0, 4, 4), room("r2", 4, 0, 4, 4, { offset: -170 })],
  });
  const walls = deriveWalls(doc, pack);
  const shared = walls.find((w) => w.shared);
  near(wallBase(doc, pack, shared).elevation, -0.17);
  const under = derived(walls).filter((f) => Math.abs(f.x1 - 4) < 1e-6 && Math.abs(f.x2 - 4) < 1e-6);
  assert.equal(under.length, 1, "one foundation wall on the shared line");
  near(under[0].height, 0.43);
  const sunkOuter = walls.filter((w) => w.category === "wall" && !w.shared && w.roomIds.includes("r2"));
  assert.equal(sunkOuter.length, 3);
  for (const w of sunkOuter) near(wallBase(doc, pack, w).elevation, -0.17);
  const keptOuter = walls.filter((w) => w.category === "wall" && !w.shared && w.roomIds.includes("r1"));
  for (const w of keptOuter) near(wallBase(doc, pack, w).elevation, 0);
  assert.equal(spotLevelLabel(pack, doc.rooms[1]), "FFL \u22120.170");
  assert.equal(spotLevelLabel(pack, doc.rooms[0]), null);
});

test("nothing is drawn twice: each foundation top meets its wall's base", () => {
  const doc = normalizeDoc({
    rooms: [room("r1", 0, 0, 4, 4), room("r2", 4, 0, 4, 4, { offset: -170 })],
    floorBuildUp: 30,
  });
  const walls = deriveWalls(doc, pack);
  for (const f of derived(walls)) {
    const host = walls.find((w) => w.id === f.hostWallId);
    const top = wallBase(doc, pack, f);
    near(top.elevation + top.height, wallBase(doc, pack, host).elevation);
  }
});

// --- 4. A 110 partition ------------------------------------------------------

test("a 110 partition gets a 220 foundation wall centred on its line", () => {
  const doc = roomDoc({ segments: [seg("p1", 2.5, 0, 2.5, 4, { sku: PARTITION })] });
  const f = derived(deriveWalls(doc, pack)).find((w) => w.hostWallId === "p1");
  assert.ok(f);
  near(f.thickness, 0.22);
  near(f.x1, 2.5);
  near(f.x2, 2.5);
});

// --- 5. Opt out --------------------------------------------------------------

test("a wall marked foundation: false gets no foundation wall, and the flag survives a reload", () => {
  const doc = roomDoc({ segments: [seg("p1", 2.5, 0, 2.5, 4, { foundation: false })] });
  assert.equal(doc.segments[0].foundation, false);
  assert.ok(!derived(deriveWalls(doc, pack)).some((f) => f.hostWallId === "p1"));
  delete doc.segments[0].foundation;
  assert.ok(derived(deriveWalls(doc, pack)).some((f) => f.hostWallId === "p1"));
});

// --- 6. Hand-drawn wins ------------------------------------------------------

test("a foundation wall drawn by hand along a wall replaces the derived one, and defaults to 600 mm", () => {
  const sku = pack.skus.find((s) => s.id === FND_WALL);
  const top = defaultSegmentTop(pack.levels, FND, sku);
  assert.equal(top, "level-above");
  const doc = normalizeDoc({
    segments: [seg("w1", 0, 0, 6, 0), { id: "h1", sku: FND_WALL, level: FND, x1: 0, y1: 0, x2: 6, y2: 0, top }],
  });
  const walls = deriveWalls(doc, pack);
  assert.ok(!derived(walls).some((f) => f.hostWallId === "w1"));
  near(walls.find((w) => w.id === "h1").height, 0.6);
});

test("a strip footing drawn along a wall does not replace its foundation wall", () => {
  const doc = normalizeDoc({
    segments: [seg("w1", 0, 0, 6, 0), { id: "h1", sku: FOOTING, level: FND, x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  assert.ok(derived(deriveWalls(doc, pack)).some((f) => f.hostWallId === "w1"));
});

test("a strip footing and a wall keep their own default tops", () => {
  assert.equal(defaultSegmentTop(pack.levels, FND, pack.skus.find((s) => s.id === FOOTING)), null);
  assert.equal(defaultSegmentTop(pack.levels, GFL, pack.skus.find((s) => s.id === WALL)), "level-above");
});

// --- 7. Draw as its own wall -------------------------------------------------

test("drawing a derived foundation wall as its own wall leaves one stored segment at the same height", () => {
  const doc = normalizeDoc({ rooms: [room("r1", 0, 0, 4, 4), room("r2", 4, 0, 4, 4, { offset: -170 })] });
  const before = derived(deriveWalls(doc, pack)).find((f) => Math.abs(f.x1 - 4) < 1e-6 && Math.abs(f.x2 - 4) < 1e-6);
  const stored = drawnSegmentFromWall(before, pack);
  assert.equal(stored.level, FND);
  assert.equal(stored.sku, FND_WALL);
  near(stored.height, 0.43);
  doc.segments.push(stored);
  const walls = deriveWalls(doc, pack);
  const onLine = walls.filter((w) => w.category === "foundation" && Math.abs(w.x1 - 4) < 1e-6 && Math.abs(w.x2 - 4) < 1e-6);
  assert.equal(onLine.length, 1);
  assert.equal(onLine[0].id, stored.id);
  near(onLine[0].height, 0.43);
});

// --- 8. Follows its wall -----------------------------------------------------

test("a foundation wall moves with its wall and goes when the wall is deleted", () => {
  const doc = normalizeDoc({ segments: [seg("w1", 0, 0, 6, 0)] });
  doc.segments[0].y1 = 1;
  doc.segments[0].y2 = 1;
  const f = derived(deriveWalls(doc, pack)).find((w) => w.hostWallId === "w1");
  near(f.y1, 1);
  near(f.y2, 1);
  doc.segments = [];
  assert.equal(derived(deriveWalls(doc, pack)).length, 0);
});

// --- 9. Upper storeys --------------------------------------------------------

test("a balcony slab 85 mm below 02 L1 sits at 2.915, and no upper storey gets a foundation wall", () => {
  const doc = normalizeDoc({
    slabs: [{ id: "b1", sku: FLOOR, level: "02 L1", offset: -85, rect: { x: 0, y: 0, w: 3, h: 2 } }],
    rooms: [{ ...room("u1", 0, 0, 4, 4), level: "02 L1" }],
  });
  const out = compile(doc, pack);
  near(out.sketchForms.find((f) => f.elementId === "b1").elevation, 2.915);
  assert.equal(derived(deriveWalls(doc, pack)).length, 0);
  for (const w of out.walls) near(w.baseElevation, 3);
});

// --- 10. Part C --------------------------------------------------------------

test("a sunk room keeps its ceiling, so Part C reads taller; a ceiling offset lowers it", () => {
  const doc = normalizeDoc({
    rooms: [room("r1", 0, 0, 4, 4, { offset: -170 })],
    slabs: [{ id: "c1", sku: CEILING, level: GFL, rect: { x: 0, y: 0, w: 4, h: 4 } }],
  });
  let out = compile(doc, pack);
  near(out.sketchForms.find((f) => f.elementId === "c1").elevation, 2.902);
  near(out.rooms[0].ceilingHeight, 3.072);
  doc.slabs[0].offset = -170;
  out = compile(doc, pack);
  near(out.sketchForms.find((f) => f.elementId === "c1").elevation, 2.732);
  near(out.rooms[0].ceilingHeight, 2.902);
});

test("with no ceiling slab, Part C is the level's floor-to-ceiling less the room's offset", () => {
  const doc = normalizeDoc({ rooms: [room("r1", 0, 0, 4, 4, { offset: -170 })] });
  near(roomCeilingHeight(doc, pack, doc.rooms[0], GFL, [2, 2]), 3.072);
  doc.rooms[0].ceilingHeight = 2.6;
  near(roomCeilingHeight(doc, pack, doc.rooms[0], GFL, [2, 2]), 2.6);
});

// --- 11. Split levels --------------------------------------------------------

test("a wall on a -170 split level set to up to level above is 3.170 tall", () => {
  const levels = [...pack.levels, { id: "Step", name: "Step", elevation: -0.17, parentId: GFL }];
  const split = { ...pack, levels };
  near(levelAboveRise(levels, "Step"), 3.17);
  const balcony = [...pack.levels, { id: "Balcony", name: "Balcony", elevation: 2.915, parentId: "02 L1" }];
  near(levelAboveRise(balcony, "Balcony"), 3.085);
  const doc = normalizeDoc({ segments: [seg("w1", 0, 0, 4, 0, { level: "Step", top: "level-above" })] });
  near(deriveDrawnWalls(doc, split)[0].height, 3.17);
});

// --- 12. Footing under the foundation wall -----------------------------------

test("a footing added under a ground floor wall hangs under its foundation wall, -0.800 to -0.600", () => {
  const doc = normalizeDoc({ segments: [seg("w1", 0, 0, 6, 0)] });
  const offer = elevationModel(doc, pack, { wallId: "w1" }).foundationOffer;
  assert.ok(offer, "the derived foundation wall does not take the footing offer away");
  near(offer.base, -0.8);
  near(offer.top, -0.6);
  const added = addFoundationUnderWall(doc, pack, { wallId: "w1" });
  const footing = doc.segments.find((s) => s.id === added.id);
  assert.equal(footing.sku, FOOTING);
  assert.equal(footing.level, FND);
  near(footing.baseOffset, -0.2);
  const base = resolvedBase(doc, pack, footing, 0.2);
  near(base.elevation, -0.8);
  near(base.elevation + base.height, -0.6);
});

// --- 13. Older documents -----------------------------------------------------

test("a document with no offsets and no build-up keeps every wall, floor and roof where it was", () => {
  const doc = normalizeDoc({
    rooms: [room("r1", 0, 0, 5, 4, { wallSku: "TSP_MAS009" })],
    slabs: [{ id: "s1", sku: "TSP_RB016", level: GFL, rect: { x: 6, y: 0, w: 2, h: 2 } }],
  });
  const out = compile(doc, plannerPack);
  for (const w of out.walls) {
    near(w.baseElevation, 0);
    near(w.height, 2.8);
  }
  near(out.sketchForms.find((f) => f.elementId === "s1").elevation, 0);
  near(out.sketchForms.find((f) => f.kind === "Room").elevation, 0);
  assert.equal(derived(deriveWalls(doc, plannerPack)).length, 0, "no foundation storey, no derived walls");
});

// --- 14. Spot levels ---------------------------------------------------------

test("an offset room or slab carries its spot level; a room on its level carries none", () => {
  const doc = normalizeDoc({
    rooms: [room("r1", 0, 0, 4, 4, { offset: -170 }), room("r2", 4, 0, 4, 4)],
    slabs: [{ id: "b1", sku: FLOOR, level: "02 L1", offset: -85, rect: { x: 0, y: 0, w: 3, h: 2 } }],
  });
  const forms = compile(doc, pack).sketchForms;
  assert.equal(forms.find((f) => f.elementId === "r1").spotLevel, "FFL \u22120.170");
  assert.equal(forms.find((f) => f.elementId === "r2").spotLevel, undefined);
  assert.equal(forms.find((f) => f.elementId === "b1").spotLevel, "FFL \u22120.085");
  assert.equal(fflText(0.3), "FFL +0.300");
  near(floorLevel(pack, doc.rooms[0]), -0.17);
});

test("a section through a sunk room prints its spot level at the floor; one through a level room prints none", () => {
  const doc = normalizeDoc({ rooms: [room("r1", 0, 0, 4, 4, { offset: -170 }), room("r2", 4, 0, 4, 4)] });
  const payload = compile(doc, pack);
  const cut = (y) => ({ mode: "section", origin: [-1, y], along: [1, 0], length: 10 });
  const across = sectionSpotLevels(payload, cut(2));
  assert.equal(across.length, 1);
  assert.equal(across[0].id, "r1");
  assert.equal(across[0].text, "FFL \u22120.170");
  near(across[0].v, -0.17);
  near(across[0].u, 3);
  assert.deepEqual(sectionSpotLevels(payload, cut(6)), []);
  const levelOnly = compile(normalizeDoc({ rooms: [room("r2", 4, 0, 4, 4)] }), pack);
  assert.deepEqual(sectionSpotLevels(levelOnly, cut(2)), []);
});

// --- 14a. DPC above natural ground -------------------------------------------

test("Check lists a DPC under 150 mm above NGL, and says nothing without an NGL", () => {
  const doc = roomDoc({ floorBuildUp: 0 });
  const withNgl = (elevation) => ({
    ...pack,
    levels: [...pack.levels, { id: "NGL", name: "NGL", elevation, kind: "reference" }],
  });
  assert.ok(foundationChecks(doc, withNgl(-0.1)).some((c) => c.kind === "dpc"));
  assert.ok(!foundationChecks(doc, withNgl(-0.2)).some((c) => c.kind === "dpc"));
  assert.ok(!foundationChecks(doc, pack).some((c) => c.kind === "dpc"));
});

// --- 15. Slab edges ----------------------------------------------------------

test("a patio slab with no wall on it gets no foundation wall", () => {
  const doc = normalizeDoc({ slabs: [{ id: "p1", sku: FLOOR, level: GFL, rect: { x: 0, y: 0, w: 3, h: 2 } }] });
  assert.equal(derived(deriveWalls(doc, pack)).length, 0);
});

// --- one per line, conflicts, exclusions, Check ------------------------------

test("two walls meeting end to end on one line give two foundation walls", () => {
  const doc = normalizeDoc({ segments: [seg("a", 0, 0, 3, 0), seg("b", 3, 0, 6, 0)] });
  const found = derived(deriveWalls(doc, pack));
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.hostWallId).sort(), ["a", "b"]);
});

test("where two walls overlap at different bases, the higher top wins and Check lists the conflict", () => {
  const doc = normalizeDoc({
    rooms: [room("sunk", 4.5, 0, 1.5, 3, { offset: -170 })],
    segments: [seg("a", 0, 0, 4, 0), seg("b", 2, 0, 6, 0)],
  });
  const walls = deriveWalls(doc, pack);
  const overlap = derived(walls).find((f) => f.conflict);
  assert.ok(overlap, "the overlapping piece carries a conflict");
  near(overlap.length, 2);
  near(overlap.height, 0.6);
  assert.equal(overlap.hostWallId, "a");
  assert.ok(foundationChecks(doc, pack, walls).some((c) => c.kind === "conflict"));
});

test("boundary walls, pool walls and upper-storey walls get no foundation wall", () => {
  const doc = normalizeDoc({
    segments: [
      seg("pool", 0, 0, 4, 0, { sku: POOL }),
      seg("erf", 0, 5, 4, 5, { sku: "TSP_BND_FACE_220_1800" }),
      seg("up", 0, 8, 4, 8, { level: "02 L1" }),
    ],
  });
  assert.equal(derived(deriveWalls(doc, pack)).length, 0);
});

test("an attached wall keeps the base it resolves today", () => {
  const doc = normalizeDoc({
    segments: [
      { id: "h1", sku: FND_WALL, level: FND, x1: 0, y1: 0, x2: 6, y2: 0, height: 0.6 },
      seg("w1", 0, 0, 6, 0, { baseAttach: { kind: "segment", id: "h1" } }),
    ],
    rooms: [room("r1", 0, 0, 6, 4, { offset: -170 })],
  });
  const wall = doc.segments[1];
  const base = resolvedBase(doc, pack, wall, 3);
  near(base.elevation, 0);
});

test("Check says when the build-up is not stated, once, and only when the ground storey has walls", () => {
  const plain = foundationChecks(roomDoc(), pack);
  assert.equal(plain.filter((c) => c.kind === "build-up").length, 1);
  assert.ok(!foundationChecks(roomDoc({ floorBuildUp: 30 }), pack).some((c) => c.kind === "build-up"));
  assert.equal(foundationChecks(normalizeDoc({}), pack).length, 0);
});

test("a template with no foundation storey draws no foundation walls and says so", () => {
  const doc = normalizeDoc({ rooms: [room("r1", 0, 0, 5, 4, { wallSku: "TSP_MAS009" })] });
  assert.equal(derived(deriveWalls(doc, plannerPack)).length, 0);
  assert.ok(foundationChecks(doc, plannerPack).some((c) => c.kind === "no-storey"));
});

test("the ceiling elevation reads its own offset only", () => {
  const slab = { id: "c1", sku: CEILING, level: GFL, offset: -100 };
  near(ceilingElevation(pack, slab), 2.802);
});

test("floor offsets and the build-up survive a save and reload", () => {
  const doc = normalizeDoc({
    rooms: [room("r1", 0, 0, 4, 4, { offset: -170 }), room("r2", 4, 0, 4, 4, { offset: 0 })],
    slabs: [{ id: "s1", sku: FLOOR, level: GFL, offset: -85, rect: { x: 0, y: 0, w: 1, h: 1 } }],
    floorBuildUp: 30,
  });
  const again = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(again.rooms[0].offset, -170);
  assert.ok(!("offset" in again.rooms[1]), "a zero offset is left off the record");
  assert.equal(again.slabs[0].offset, -85);
  assert.equal(again.floorBuildUp, 30);
  assert.equal(normalizeDoc({}).floorBuildUp, null);
});
