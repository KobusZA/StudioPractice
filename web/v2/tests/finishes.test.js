// Phase D: finish categories, products, room rules, runs, floor regions, the
// plaster default, the bill rows and the elevation bands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { PlanStore as Store, carryFinishRegionsToLevel, finishRegionPolygon, hasJobContent, hostedFinishRegions, normalizeDoc, roomPolygon, shapePolygon } from "../model.js";
import { area as polygonArea, pointInPoly } from "../geom.js";
import { copySelection, mirrorSelection, rotateSelection } from "../modify.js";
import { normalizePackUnits } from "../schema.js";
import { deriveWalls } from "../walls.js";
import { boqRows } from "../schedule.js";
import { applyBandEdit, applyOutlinePoints, elevationModel } from "../wall-elevation.js";
import {
  FINISH_CATEGORIES,
  PC_ALLOWANCE_LABEL,
  categoriesForSurface,
  createFinishRegion,
  createFinishRun,
  dependentsOfWalls,
  floorCoverage,
  presetFromRoom,
  planWallFinishMarks,
  regionsOnSlab,
  resolveFinishes,
  rulesFromPreset,
  savePreset,
} from "../finish-model.js";
import { RIBBON, SIMPLE_TABS } from "../ribbon.js";
import { faceFinishHtml, finishCalloutHtml, openingCalloutHtml, productsHtml, roomFinishHtml, slabFinishHtml } from "../finish-panel.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const ROOM = { id: "r1", name: "Bath", use: "bathroom", level: "01 GFL", wallSku: "TSP_MAS009", rect: { x: 0, y: 0, w: 4, h: 3 } };

function build(extra = {}, room = {}) {
  return normalizeDoc({ rooms: [{ ...ROOM, ...room }], ...extra });
}

function finishRows(doc, p = pack) {
  return compile(doc, p).instances.filter((r) => r.finish);
}

const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] || 0), 0);

test("categories say which surfaces they go on, and the unit", () => {
  assert.deepEqual(categoriesForSurface("floor").includes("wallTile"), false);
  assert.ok(categoriesForSurface("wall").includes("wallTile"));
  assert.ok(categoriesForSurface("floor").includes("screed"));
  assert.equal(FINISH_CATEGORIES.skirting.unit, "m");
  assert.equal(FINISH_CATEGORIES.wallTile.needsProduct, true);
});

test("new document fields are additive and normalised", () => {
  const doc = normalizeDoc({
    finishProducts: [
      { id: "p1", category: "wallTile", name: "White 300x600", boxCoverage: 1.44, wasteFactor: 0.1 },
      { id: "bad", category: "not-a-category" },
    ],
    finishSettings: { externalFinish: "nonsense" },
  });
  assert.equal(doc.finishProducts.length, 1);
  assert.equal(doc.finishProducts[0].supplier, null);
  assert.equal(doc.finishSettings.externalFinish, "plaster");
  assert.deepEqual(doc.finishRuns, []);
  assert.deepEqual(normalizeDoc({}).finishRegions, []);
  assert.equal(normalizeDoc({ rooms: [{ id: "r", rect: { x: 0, y: 0, w: 1, h: 1 } }] }).rooms[0].finishes.length, 0);
});

test("a plastered type gets a computed plaster coat on both faces, net of openings", () => {
  const doc = build({ openings: [{ id: "o1", sku: "TSP_WN1212", roomId: "r1", edgeIndex: 0, t: 0.5 }] });
  const rows = finishRows(doc).filter((r) => r.finishCategory === "plaster");
  // 4 walls x two faces, the window's wall losing its opening on both faces.
  assert.equal(rows.length >= 8, true);
  const gross = 2 * (2 * (4 + 3)) * 2.8;
  assert.ok(Math.abs(sum(rows, "area") - (gross - 2 * 1.2 * 1.2)) < 1e-6);
  assert.deepEqual([...new Set(rows.map((r) => r.face))].sort(), ["external", "internal"]);
});

test("the default is not stored, and a job setting changes the external face", () => {
  const doc = build();
  assert.equal(doc.finishRuns.length, 0);
  doc.finishSettings.externalFinish = "facebrick";
  const rows = finishRows(doc);
  assert.ok(rows.some((r) => r.finishCategory === "facebrick" && r.face === "external"));
  assert.ok(rows.every((r) => r.finishCategory !== "plaster" || r.face === "internal"));
  const brick = rows.find((r) => r.finishCategory === "facebrick");
  assert.ok(brick.pcAllowance);
  assert.ok(brick.type.includes(PC_ALLOWANCE_LABEL));
});

test("a room rule tiles the room-side faces to its height, as an allowance without a product", () => {
  const doc = build({}, { finishes: [{ id: "f1", surface: "wall", category: "wallTile", bottom: 0, top: 1.2, faces: "all" }] });
  const rows = finishRows(doc).filter((r) => r.finishCategory === "wallTile");
  assert.ok(Math.abs(sum(rows, "area") - 14 * 1.2) < 1e-6);
  assert.ok(rows.every((r) => r.pcAllowance && r.face === "internal" && r.model === "FINISH:wallTile"));
});

test("a product's waste sits beside the measured area and boxes need a stated coverage", () => {
  const doc = build(
    { finishProducts: [{ id: "p1", category: "wallTile", name: "White", size: "300x600", boxCoverage: 1.5, wasteFactor: 0.1, rateRef: "TILE-W" }] },
    { finishes: [{ id: "f1", surface: "wall", productId: "p1", top: 1, faces: "all" }] },
  );
  const rows = finishRows(doc).filter((r) => r.finishCategory === "wallTile");
  const area = sum(rows, "area");
  assert.ok(Math.abs(area - 14) < 1e-6);
  assert.ok(Math.abs(sum(rows, "orderQuantity") - 15.4) < 1e-6);
  assert.ok(rows.every((r) => !r.pcAllowance && r.model === "TILE-W"));
  const line = boqRows(compile(doc, pack), { rates: [{ model: "TILE-W", rate: 100, unit: "m2" }] }).find((r) => r.model === "TILE-W");
  assert.equal(line.qty, area);
  assert.equal(line.boxes, Math.ceil((area * 1.1) / 1.5));
  assert.equal(line.amount, area * 100);

  const noCoverage = build(
    { finishProducts: [{ id: "p1", category: "wallTile", name: "White" }] },
    { finishes: [{ id: "f1", surface: "wall", productId: "p1", top: 1, faces: "all" }] },
  );
  const row = finishRows(noCoverage).find((r) => r.finishCategory === "wallTile");
  assert.equal("boxes" in row, false);
  assert.equal("orderQuantity" in row, false);
});

test("faces filter the walls: external only, and internal only", () => {
  const rule = (faces) => build({}, { finishes: [{ id: "f", surface: "wall", category: "paint", faces }] });
  assert.equal(finishRows(rule("internal")).filter((r) => r.finishCategory === "paint").length, 0);
  assert.ok(finishRows(rule("external")).filter((r) => r.finishCategory === "paint").length > 0);
});

test("a coat finish replaces the plaster default where it lands, and No finish removes it", () => {
  const plaster = (doc) => sum(finishRows(doc).filter((r) => r.finishCategory === "plaster" && r.face === "internal"), "area");
  const base = plaster(build());
  assert.ok(Math.abs(base - 14 * 2.8) < 1e-6);
  const none = build({}, { finishes: [{ id: "n", surface: "wall", category: "none", bottom: 0, top: 1.2, faces: "all" }] });
  assert.ok(Math.abs(plaster(none) - 14 * (2.8 - 1.2)) < 1e-6);
  assert.equal(finishRows(none).some((r) => r.finishCategory === "none"), false);
  const rhino = build({}, { finishes: [{ id: "r", surface: "wall", category: "rhinolite", faces: "all" }] });
  assert.ok(Math.abs(plaster(rhino) - base) < 1e-6, "Rhinolite goes over plaster, it does not replace it");
});

test("a finish run on a drawn wall face is measured, and survives the wall's id changing by position", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const run = createFinishRun(doc, walls[0], 1, { category: "wallTile", from: 1, to: 3, bottom: 0.5, top: 1.5 });
  let rows = finishRows(doc).filter((r) => r.finishCategory === "wallTile");
  assert.ok(Math.abs(sum(rows, "area") - 2) < 1e-6);

  doc.segments[0].id = "w2"; // same wall, new id
  rows = finishRows(doc).filter((r) => r.finishCategory === "wallTile");
  assert.ok(Math.abs(sum(rows, "area") - 2) < 1e-6);
  assert.equal(compile(doc, pack).warnings.some((w) => w.includes("finish run")), false);

  doc.segments[0].x1 = 40; doc.segments[0].x2 = 46; // the wall left
  const c = compile(doc, pack);
  assert.equal(c.instances.filter((r) => r.finishCategory === "wallTile").length, 0);
  assert.ok(c.warnings.some((w) => w.includes("finish run")));
  assert.equal(doc.finishRuns.length, 1, "an orphaned run is kept");
  assert.equal(doc.finishRuns[0].id, run.id);
});

test("deleting a wall takes its face finishes and its windows and doors", () => {
  const doc = normalizeDoc({
    segments: [
      { id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 },
      { id: "w2", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 4, x2: 6, y2: 4 },
    ],
    openings: [
      { id: "d1", sku: "TSP_DR900", wallId: "w1", t: 0.5 },
      { id: "d2", sku: "TSP_DR900", wallId: "w2", t: 0.5 },
    ],
    rooms: [{ ...ROOM, finishes: [{ id: "paint", surface: "wall", category: "paint", faces: "all" }] }],
  });
  const walls = deriveWalls(doc, pack);
  const tile = createFinishRun(doc, walls.find((w) => w.id === "w1"), 1, { category: "wallTile" });
  const other = createFinishRun(doc, walls.find((w) => w.id === "w2"), 1, { category: "paint" });

  const gone = dependentsOfWalls(doc, pack, ["w1"]);
  assert.deepEqual(gone.finishRunIds, [tile.id]);
  assert.equal(gone.finishRunIds.includes(other.id), false);
  assert.deepEqual(gone.openingIds, ["d1"]);

  doc.finishRuns = doc.finishRuns.filter((r) => !gone.finishRunIds.includes(r.id));
  doc.openings = doc.openings.filter((o) => !gone.openingIds.includes(o.id));
  doc.segments = doc.segments.filter((s) => s.id !== "w1");
  assert.equal(doc.rooms[0].finishes.length, 1, "a room finish rule stays with the room");
  assert.equal(finishRows(doc).some((r) => r.finishCategory === "wallTile"), false);
  assert.equal(doc.openings.some((o) => o.id === "d2"), true);

  doc.segments.push({ id: "w3", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 });
  assert.equal(finishRows(doc).some((r) => r.finishCategory === "wallTile"), false, "a new wall on the same line does not inherit the finish");
  assert.equal((doc.openings || []).some((o) => o.wallId === "w1"), false);
});

test("a finish on the deleted wall does not hop onto the wall beside it", () => {
  const doc = normalizeDoc({
    segments: [
      { id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 },
      { id: "w2", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0.1, x2: 6, y2: 0.1 },
    ],
  });
  const walls = deriveWalls(doc, pack);
  const run = createFinishRun(doc, walls.find((w) => w.id === "w1"), 1, { category: "wallTile", from: 1, to: 3 });
  assert.deepEqual(dependentsOfWalls(doc, pack, ["w1"]).finishRunIds, [run.id]);
});

test("a door and a finish on the room wall stay when a drawn wall covering that line is deleted", () => {
  const doc = build({
    openings: [{ id: "d1", sku: "TSP_DR900", roomId: "r1", edgeIndex: 0, t: 0.5 }],
  });
  const roomWall = deriveWalls(doc, pack).find((w) => Math.abs(w.y1) < 1e-6 && Math.abs(w.y2) < 1e-6);
  const run = createFinishRun(doc, roomWall, 1, { category: "wallTile" });
  doc.segments.push({ id: "drawn", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 4, y2: 0 });
  const gone = dependentsOfWalls(doc, pack, ["drawn"]);
  assert.deepEqual(gone.openingIds, []);
  assert.equal(gone.finishRunIds.includes(run.id), false);
});

test("a run on the other face carries to the mirrored side after the wall is re-keyed", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  createFinishRun(doc, walls[0], -1, { category: "paint" });
  doc.segments[0].id = "w9";
  const { bands } = resolveFinishes(doc, pack, deriveWalls(doc, pack));
  const paint = bands.find((b) => b.category === "paint");
  assert.equal(paint.side, -1);
});

test("floor finish regions come out of the room's floor and get their own rows", () => {
  const doc = build({
    finishProducts: [{ id: "t", category: "floorTile", name: "Porcelain" }],
    finishRegions: [{ id: "g1", level: "01 GFL", productId: "t", shape: { kind: "rect", x: 0.5, y: 0.5, w: 2, h: 1 } }],
  });
  const c = compile(doc, pack);
  const floor = c.instances.find((r) => r.kind === "room");
  assert.ok(Math.abs(floor.area - 10) < 1e-6);
  assert.ok(Math.abs(floor.areaGross - 12) < 1e-6);
  const region = c.instances.find((r) => r.finishCategory === "floorTile");
  assert.ok(Math.abs(region.area - 2) < 1e-6);
  assert.equal(region.surface, "floor");

  const ruled = build(
    { finishRegions: doc.finishRegions, finishProducts: doc.finishProducts },
    { finishes: [{ id: "s", surface: "floor", category: "screed" }] },
  );
  const screed = finishRows(ruled).find((r) => r.finishCategory === "screed");
  assert.ok(Math.abs(screed.area - 10) < 1e-6, "a room floor rule is net of the regions in it");
});

test("a floor region drawn on a slab is counted even with no room", () => {
  const doc = normalizeDoc({
    slabs: [{ id: "sl1", sku: "TSP_FLR255", level: "01 GFL", shape: { kind: "rect", x: 0, y: 0, w: 4, h: 3 } }],
  });
  const region = createFinishRegion(doc, {
    level: "01 GFL",
    slabId: "sl1",
    category: "floorTile",
    shape: { kind: "rect", x: 0, y: 0, w: 2, h: 3 },
  });
  assert.equal(region.slabId, "sl1");
  assert.equal(normalizeDoc(JSON.parse(JSON.stringify(doc))).finishRegions[0].slabId, "sl1");
  assert.equal(regionsOnSlab(doc, doc.slabs[0]).length, 1);
  const rows = finishRows(doc);
  const tile = rows.find((r) => r.finishCategory === "floorTile");
  assert.ok(tile);
  assert.ok(Math.abs(tile.area - 6) < 1e-6);
});

function slabWithTiles() {
  const doc = normalizeDoc({
    slabs: [{ id: "sl1", sku: "TSP_FLR255", level: "01 GFL", shape: { kind: "rect", x: 0, y: 0, w: 4, h: 3 } }],
  });
  createFinishRegion(doc, { level: "01 GFL", slabId: "sl1", category: "floorTile", shape: { kind: "rect", x: 0, y: 0, w: 2, h: 1 } });
  return doc;
}

test("moving a floor to another level takes its finishes with it", () => {
  const doc = slabWithTiles();
  const loose = createFinishRegion(doc, {
    level: "01 GFL",
    category: "waterproofing",
    shape: { kind: "rect", x: 2, y: 0, w: 2, h: 3 },
  });
  assert.equal(loose.slabId, null);
  const carried = carryFinishRegionsToLevel(doc, { kind: "slab", id: "sl1" }, "02 L1");
  assert.equal(carried.length, 2, "the named region and the one found by sitting on the floor");
  doc.slabs[0].level = "02 L1";
  assert.equal(doc.finishRegions[0].level, "02 L1");
  assert.equal(loose.level, "02 L1");
  assert.equal(regionsOnSlab(doc, doc.slabs[0]).length, 2);
});

test("moving a floor carries the tiles on it", () => {
  const doc = slabWithTiles();
  const store = new Store(doc);
  const snaps = store.snapshotMoveTargets([{ kind: "slab", id: "sl1" }]);
  assert.equal(snaps.length, 2, "the floor and its region");
  store.applyMoveSnapshot(snaps, 5, 2, null);
  assert.deepEqual(shapePolygon(store.doc.slabs[0].shape)[0], [5, 2]);
  const region = store.doc.finishRegions[0];
  assert.deepEqual(shapePolygon(region.shape)[0], [5, 2]);
  assert.equal(regionsOnSlab(store.doc, store.doc.slabs[0]).length, 1, "still on the floor");
});

test("a whole-floor region is the floor's outline, so reshaping the floor reshapes it", () => {
  const doc = slabWithTiles();
  createFinishRegion(doc, { level: "01 GFL", slabId: "sl1", category: "screed", whole: true, shape: structuredClone(doc.slabs[0].shape) });
  doc.slabs[0].shape = { kind: "rect", x: 0, y: 0, w: 6, h: 3 };
  const whole = doc.finishRegions.find((r) => r.whole);
  assert.ok(Math.abs(Math.abs(polygonArea(finishRegionPolygon(doc, whole))) - 18) < 1e-6);
  const screed = finishRows(doc).find((r) => r.finishCategory === "screed");
  assert.ok(Math.abs(screed.area - 18) < 1e-6);
  assert.equal(normalizeDoc(JSON.parse(JSON.stringify(doc))).finishRegions.find((r) => r.whole)?.whole, true);
});

test("rotate, mirror, copy and merge of a floor treat its tiles as part of it", () => {
  const rotated = slabWithTiles();
  assert.ok(rotateSelection(rotated, [{ kind: "slab", id: "sl1" }], { degrees: 90 }).ok);
  assert.equal(regionsOnSlab(rotated, rotated.slabs[0]).length, 1, "tiles still on the turned floor");

  const mirrored = slabWithTiles();
  mirrorSelection(mirrored, [{ kind: "slab", id: "sl1" }], { axis: "v" });
  assert.equal(regionsOnSlab(mirrored, mirrored.slabs[0]).length, 1);

  const copied = slabWithTiles();
  const result = copySelection(copied, [{ kind: "slab", id: "sl1" }]);
  assert.equal(copied.finishRegions.length, 2);
  const twin = copied.slabs.find((s) => s.id === result.refs[0].id);
  assert.equal(regionsOnSlab(copied, twin).length, 1, "the copy has its own tiles");
  assert.equal(regionsOnSlab(copied, copied.slabs[0]).length, 1, "the original keeps its own");
});

test("a floor's tiles are job content, and removing the floor's regions leaves none behind", () => {
  const doc = slabWithTiles();
  assert.equal(hasJobContent({ finishRegions: doc.finishRegions }), true);
  assert.equal(hostedFinishRegions(doc, { kind: "slab", id: "sl1" }).length, 1);
  assert.equal(hostedFinishRegions(doc, { kind: "slab", id: "none" }).length, 0);
});

test("a wall-only category on a floor rule is refused with a warning", () => {
  const doc = build({}, { finishes: [{ id: "x", surface: "floor", category: "wallTile" }] });
  const c = compile(doc, pack);
  assert.equal(c.instances.some((r) => r.finishCategory === "wallTile"), false);
  assert.ok(c.warnings.some((w) => w.includes("cannot go on a floor")));
});

test("skirting is a length, net of door widths", () => {
  const doc = build(
    { openings: [{ id: "d1", sku: "TSP_DR900", roomId: "r1", edgeIndex: 0, t: 0.5 }] },
    { finishes: [{ id: "k", surface: "wall", category: "skirting", faces: "all" }] },
  );
  const rows = finishRows(doc).filter((r) => r.finishCategory === "skirting");
  assert.ok(rows.every((r) => r.unit === "m" && r.length > 0));
  const total = sum(rows, "length");
  assert.ok(total < 14 && Math.abs(total - (14 - 0.9)) < 1e-6);
});

test("presets are stored on the job and applied as fresh rules", () => {
  const room = build({}, { finishes: [{ id: "f1", surface: "wall", category: "wallTile", top: 1.2 }] }).rooms[0];
  const doc = build();
  const saved = savePreset(doc, presetFromRoom(room, "Bathroom standard"));
  assert.equal(saved.use, "bathroom");
  assert.equal("id" in saved.rules[0], false);
  const rules = rulesFromPreset(saved);
  assert.notEqual(rules[0].id, "f1");
  assert.equal(rules[0].top, 1.2);
  const again = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(again.finishPresets.length, 1);
});

test("volume stays on the overall thickness unless the job chooses core", () => {
  const cored = structuredClone(pack);
  cored.skus.find((s) => s.id === "TSP_MAS009").geometry.coreThickness = 0.22;
  cored.skus.find((s) => s.id === "TSP_MAS009").geometry.thickness = 0.24;
  const doc = build();
  const vol = (d) => compile(d, cored).instances.filter((r) => r.model === "TSP_MAS009").reduce((s, r) => s + (r.volume || 0), 0);
  const overall = vol(doc);
  doc.finishSettings.volumeBasis = "core";
  assert.ok(Math.abs(vol(doc) / overall - 0.22 / 0.24) < 1e-6);
});

test("the elevation shows the bands, and dragging a run or a rule edits the stored value", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const run = createFinishRun(doc, walls[0], 1, { category: "wallTile", from: 1, to: 3, bottom: 0.5, top: 1.5 });
  const face = { wallId: "w1", side: 1 };
  let m = elevationModel(doc, pack, face, walls);
  const tile = m.finishBands.find((b) => b.sourceId === run.id);
  assert.equal(tile.from, 1);
  assert.equal(tile.to, 3);
  assert.ok(m.finishBands.some((b) => b.source === "default"), "the computed plaster shows, and is not editable");
  assert.equal(m.finishBands.find((b) => b.source === "default").editable, false);

  applyBandEdit(doc, pack, face, tile.id, { top: 1.62, from: 0.97 }, walls);
  assert.equal(run.top, 1.6);
  assert.equal(run.a, 0.95);

  const back = { wallId: "w1", side: -1 };
  m = elevationModel(doc, pack, back, walls);
  assert.equal(m.finishBands.some((b) => b.source === "run"), false, "a run is on its own face");

  const roomDoc = build({}, { finishes: [{ id: "f1", surface: "wall", category: "wallTile", bottom: 0, top: 1.2 }] });
  const rw = deriveWalls(roomDoc, pack);
  const wall = rw.find((w) => Math.abs(w.y1) < 1e-9 && Math.abs(w.y2) < 1e-9);
  const rf = { wallId: wall.id, side: 1 };
  const bands = elevationModel(roomDoc, pack, rf, rw).finishBands;
  const side = bands.find((b) => b.source === "rule") ? 1 : -1;
  const f = { wallId: wall.id, side };
  const rule = elevationModel(roomDoc, pack, f, rw).finishBands.find((b) => b.source === "rule");
  applyBandEdit(roomDoc, pack, f, rule.id, { top: 1.5 }, rw);
  assert.equal(roomDoc.rooms[0].finishes[0].top, 1.5);
});

test("each placed floor finish is its own section, and shows its product", () => {
  const doc = normalizeDoc({
    slabs: [{ id: "sl1", level: "01 GFL", shape: { kind: "rect", x: 0, y: 0, w: 6, h: 4 } }],
    finishProducts: [
      { id: "p1", category: "floorTile", name: "Porcelain", size: "600x600" },
      { id: "p3", category: "floorTile", name: "Slate" },
      { id: "p2", category: "waterproofing", name: "Torch-on" },
    ],
    finishRegions: [
      { id: "r1", level: "01 GFL", slabId: "sl1", productId: "p1", shape: { kind: "rect", x: 0, y: 0, w: 1, h: 1 } },
      { id: "r2", level: "01 GFL", slabId: "sl1", category: "waterproofing", productId: "p2", whole: true, shape: { kind: "rect", x: 0, y: 0, w: 6, h: 4 } },
    ],
  });
  const html = slabFinishHtml(doc, doc.slabs[0]);
  const r1 = html.indexOf('data-fin-region="r1"');
  const r2 = html.indexOf('data-fin-region="r2"');
  assert.ok(r1 >= 0 && r2 > r1, "each placed finish is its own section");
  assert.equal((html.match(/data-fin-region=/g) || []).length, 2);
  assert.equal((html.match(/data-fin="region-draw"/g) || []).length, 1, "drawing is one form, not one per product");
  const tile = html.slice(r1, r2);
  const water = html.slice(r2);
  assert.ok(tile.includes("Floor tile") && tile.includes('value="Porcelain · 600x600"') && !tile.includes("Torch-on"));
  assert.ok(water.includes("Waterproofing") && water.includes('value="Torch-on"') && !water.includes("Porcelain"));
  assert.ok(tile.includes('value="Slate"'), "other products of that finish are suggested");
  assert.ok(!water.includes("Slate"));
  assert.ok(tile.includes('data-fin="region-product-name"'));
  assert.ok(tile.includes('data-fin="region-type"') && tile.includes('value="floorTile" selected'), "a placed finish's type can be changed");
  assert.ok(tile.includes("Drawn area") && tile.includes("1.00 m²"));
  assert.ok(water.includes("Covers the whole floor and follows its outline."));
  assert.ok(html.includes("Add a finish") && html.includes("On this floor (2)"));
  assert.ok(html.includes('data-fin="add-open"') && html.includes("data-fin-new hidden"), "the add form stays behind the button");
  assert.ok(html.includes(">Slab<") && html.includes("24.0 m²"));
  assert.ok(html.includes("2 areas overlap") && html.includes("covered more than once"));
  assert.ok(html.includes('data-fin="show-bare"') === false, "a fully covered floor has no bare area to show");
  const products = productsHtml(doc, { open: true });
  assert.ok(!products.includes('class="fin-kind"'), "a product is not a section");
  assert.ok(products.indexOf("Waterproofing") < products.indexOf("Torch-on"));
  assert.ok(products.indexOf("Floor tile") < products.indexOf("Porcelain"));
  const finish = products.indexOf('data-fin="p-category"');
  const name = products.indexOf('data-fin="p-name"');
  assert.ok(finish >= 0 && finish < name, "the finish type comes before the product name");
  assert.ok(products.includes(">Plaster<") && products.includes(">Render<"));
});

test("floor coverage reports bare floor and overlap, including a concave outline", () => {
  const host = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const a = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const b = [[1, 1], [3, 1], [3, 3], [1, 3]];
  const cover = floorCoverage(host, [a, b]);
  assert.ok(Math.abs(cover.hostArea - 16) < 1e-6);
  assert.ok(Math.abs(cover.clipped[0] - 4) < 1e-4);
  assert.ok(Math.abs(cover.clipped[1] - 4) < 1e-4);
  assert.ok(Math.abs(cover.finished - 7) < 1e-3, `finished ${cover.finished}`);
  assert.ok(Math.abs(cover.bare - 9) < 1e-3, `bare ${cover.bare}`);
  assert.ok(Math.abs(cover.excess - 1) < 1e-3, `excess ${cover.excess}`);
  assert.equal(cover.overlapCount, 2);

  const ell = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const inside = floorCoverage(square, [ell]);
  assert.ok(Math.abs(inside.finished - 3) < 1e-3, `L inside square ${inside.finished}`);
  assert.ok(Math.abs(inside.bare - 1) < 1e-3);
  const clip = floorCoverage(ell, [square]);
  assert.ok(Math.abs(clip.finished - 3) < 1e-3, `square clipped to L ${clip.finished}`);
  assert.ok(clip.bare < 1e-3);

  const side = floorCoverage(
    [[0, 0], [2, 0], [2, 1], [0, 1]],
    [[[0, 0], [1, 0], [1, 1], [0, 1]], [[1, 0], [2, 0], [2, 1], [1, 1]]],
  );
  assert.ok(Math.abs(side.finished - 2) < 1e-3, `side by side ${side.finished}`);
  assert.ok(side.excess < 0.02);
  assert.equal(side.overlapCount, 0);
});

test("finishes sit on the Build ribbon after Walls, in Full and Simple", () => {
  const build = RIBBON.find((t) => t.id === "build");
  const names = build.groups.map((g) => g.label);
  assert.equal(names[names.indexOf("Walls") + 1], "Finishes");
  const fin = build.groups.find((g) => g.label === "Finishes");
  assert.deepEqual(fin.items.map((i) => i.id), ["wall-finishes", "finishes"]);
  const project = RIBBON.find((t) => t.id === "document").groups.find((g) => g.label === "Project");
  assert.deepEqual(project.items.map((i) => i.id), ["project-info"]);
  const draw = SIMPLE_TABS.find((t) => t.id === "draw");
  const simpleNames = draw.groups.map((g) => g.label);
  assert.equal(simpleNames[simpleNames.indexOf("Walls") + 1], "Finishes");
  assert.deepEqual(draw.groups.find((g) => g.label === "Finishes").items, ["wall-finishes", "finishes"]);
  const views = RIBBON.find((t) => t.id === "document").groups.find((g) => g.label === "Views");
  assert.equal(views.items.find((i) => i.id === "elevation")?.label, "Elevation");
});

test("a wall type list splits a base coat from an applied finish", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const model = elevationModel(doc, pack, { wallId: "w1", side: 1 }, walls);
  const html = faceFinishHtml(doc, model, { adding: true });
  const select = html.slice(html.indexOf('data-fin="band-category"'), html.indexOf("</select>", html.indexOf('data-fin="band-category"')));
  const coat = "Base coat — what the wall is made of";
  const applied = "Applied finish — goes on top of a coat";
  assert.ok(select.includes(coat) && select.includes(applied));
  assert.ok(select.indexOf(coat) < select.indexOf(applied));
  assert.ok(select.indexOf(">Plaster<") < select.indexOf(applied));
  assert.ok(select.indexOf(applied) < select.indexOf(">Paint<"));
  assert.ok(select.indexOf(applied) < select.indexOf(">Rhinolite<"));
  assert.ok(select.includes(">Bare<"));
  assert.ok(html.includes("Up the wall") && html.includes("Along the wall"));
  assert.ok(html.includes('data-fin="run-bottom"') && html.includes('data-fin="run-from"'));
  assert.ok(html.includes("data-fin-live") && html.includes("fin-mini"));
  assert.ok(html.includes('data-fin="band-height"') && html.includes("Skirting (to 100 mm)"));
  assert.ok(html.includes('data-fin-custom hidden') && html.includes('data-fin-span hidden'));
  assert.ok(html.includes("Wall tile on the whole face."));
  assert.ok(html.includes("needs a product name"));
  assert.ok(html.includes("free shape on the elevation"));
  assert.ok(html.indexOf('data-fin="band-part"') < html.indexOf('data-fin="run-add"'), "part of the face is chosen before the commit buttons");
  assert.ok(!html.includes("Updates as you type"));
});

test("a wall face panel reads like the floor panel: summary, one add form, a card per finish", () => {
  const doc = normalizeDoc({
    finishProducts: [{ id: "p1", category: "wallTile", name: "White", size: "300x600" }],
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const run = createFinishRun(doc, walls[0], 1, { category: "wallTile", productId: "p1", bottom: 0, top: 1.2 });
  createFinishRun(doc, walls[0], 1, { category: "paint", bottom: 1.2 });
  const model = elevationModel(doc, pack, { wallId: "w1", side: 1 }, walls);
  const id = model.finishBands.find((b) => b.sourceId === run.id).id;
  const html = faceFinishHtml(doc, model, { selectedId: id, savedId: id });
  assert.ok(html.includes("data-fin-summary") && html.includes('data-fin="add-open"') && html.includes("Add a finish"));
  assert.ok(html.includes("data-fin-newband hidden"), "the add form stays behind the button");
  const open = faceFinishHtml(doc, model, { selectedId: id, savedId: id, adding: true });
  assert.ok(open.includes("data-fin-newband") && !open.includes("data-fin-newband hidden"), "opening the sheet shows the form");
  assert.ok(open.includes("fin-rest") && open.includes("fin-rest\" hidden"), "the list steps aside while adding");
  assert.equal((html.match(/data-fin="run-add"/g) || []).length, 1, "adding is one form");
  const card = html.slice(html.indexOf(`data-fin-band="${id}"`));
  assert.ok(card.includes('data-fin="band-type"') && card.includes('value="White · 300x600"'));
  assert.ok(html.includes(`fin-editing" data-fin-band="${id}"`) && card.includes("Saved"), "the picked card is marked, and a save is acknowledged");
  assert.ok(html.includes('data-fin="band-height"') && html.includes("Skirting"));
  assert.ok(html.includes("from the wall type"), "the computed plaster stays in the summary, as the wall type");
  assert.ok(!html.includes("fin-kind-title") && !html.includes("1 area"), "a single finish is one row, without a group heading");
  assert.ok(card.includes("fin-mini"), "the card shows the shape on the face");
  const paintId = model.finishBands.find((b) => b.category === "paint").id;
  const paintStart = html.indexOf(`data-fin-band="${paintId}"`);
  const paintCard = html.slice(paintStart, html.indexOf('class="fin-on"', paintStart));
  assert.ok(paintCard.includes('class="fin-kind-name">Paint<') && paintCard.includes("1.2 m"), "a resting card names the finish and where it sits");
  assert.ok(!paintCard.includes('data-fin="band-type"') && !paintCard.includes("No product named") && !paintCard.includes('data-fin="band-remove"'), "type, product, and Remove wait until the row is selected");
  const resting = faceFinishHtml(doc, model);
  const restingTile = resting.slice(resting.indexOf(`data-fin-band="${id}"`), resting.indexOf(`data-fin-band="${paintId}"`));
  assert.ok(restingTile.includes("fin-product-line") && restingTile.includes("White · 300x600"), "a named product is a line on the resting row");
  assert.ok(!restingTile.includes('data-fin="band-type"'));
  assert.ok(html.includes("Wall tile on the plaster") && html.includes("Paint on the plaster"), "a finish on the coat is named");
  assert.ok(html.includes('data-fin="default-ask"') && html.includes("Leave bare"), "leaving the wall type bare asks first");
  assert.ok(!html.includes('data-fin="default-remove"'), "the coat stays until the question is answered");
  const asked = faceFinishHtml(doc, model, { bareAsk: true });
  assert.ok(asked.includes('data-fin="default-remove"') && asked.includes("Paint and tile stay") && asked.includes('data-fin="default-keep"'));
  assert.ok(!html.includes("data-fin-band=\"default:"), "the default is not a card");
  assert.ok(html.includes(">Whole face<") && html.includes('data-fin-custom hidden'), "millimetre boxes stay hidden until asked for");
  assert.ok(!html.includes("along ·"), "cards do not print coordinates");
  assert.ok(!card.includes('data-fin="band-from"'), "a card does not edit the shape as four edges");
  const callout = finishCalloutHtml(doc, model.finishBands.find((b) => b.id === id), model);
  assert.ok(callout.includes(`data-fin-band="${id}"`));
  assert.ok(callout.includes("Wall tile") && callout.includes("White · 300x600") && callout.includes("Up to 1.2 m"));
  assert.ok(callout.includes('data-fin="callout-close"') && callout.includes(">×<") && callout.includes('aria-label="Close"'));
  assert.ok(!callout.includes(">Close<"), "the callout closes with an X");
  assert.ok(callout.includes('data-fin="band-edit"'));
  assert.ok(!callout.includes('data-fin="band-remove"'), "the callout does not remove the finish");
  assert.ok(!callout.includes('data-fin="band-from"'), "the callout does not edit the shape as four edges");
});

test("a window on the inspector graph is a callout, not a move handle", () => {
  const html = openingCalloutHtml({
    id: "o1",
    name: "Window 1300",
    category: "window",
    width: 1.3,
    height: 1.3,
    sill: 0.75,
    offset: 0.75,
    nonStandard: true,
  });
  assert.ok(html.includes("Window 1300") && html.includes("1300 × 1300"));
  assert.ok(html.includes("Sill 750 mm") && html.includes("750 mm from the left"));
  assert.ok(html.includes("Non-standard size"));
  assert.ok(html.includes('data-fin="opening-edit"') && html.includes('data-fin="callout-close"') && html.includes(">×<"));
  const door = openingCalloutHtml({ id: "d1", name: "Door", category: "door", width: 0.9, height: 2.1, sill: 0, offset: 0.2, nonStandard: false });
  assert.ok(!door.includes("Sill"), "a door has no sill line");
  assert.ok(!door.includes("Non-standard"));
});

test("taking the default off leaves a listed No finish piece that can be removed again", () => {
  const doc = normalizeDoc({ segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }] });
  const walls = deriveWalls(doc, pack);
  const face = { wallId: "w1", side: 1 };
  const before = elevationModel(doc, pack, face, walls).finishBands;
  const run = createFinishRun(doc, walls[0], 1, { category: "none", bottom: 0, top: 1.2 });
  const after = elevationModel(doc, pack, face, walls).finishBands;
  assert.ok(after.some((b) => b.category === "none" && b.sourceId === run.id), "No finish is listed");
  const plaster = (bands) => bands.filter((b) => b.source === "default").reduce((s, b) => s + b.quantity, 0);
  assert.ok(plaster(after) < plaster(before));
  const listed = elevationModel(doc, pack, face, walls);
  const bareId = listed.finishBands.find((b) => b.category === "none").id;
  const html = faceFinishHtml(doc, listed, { selectedId: bareId });
  const closed = faceFinishHtml(doc, listed);
  assert.ok(html.includes("The finish from the wall type is off"));
  assert.ok(closed.includes("The finish from the wall type is off"));
  assert.ok(html.includes("Put it back"), "the open bare row can put the wall type back");
  assert.ok(!closed.includes("Put it back"), "a resting row does not carry the button");
  assert.ok(!html.includes("Remove this to put it back"));
  assert.ok(!html.includes("data-fin-band=\"default:"), "taking plaster off does not leave a plaster card");
  const bare = elevationModel(doc, pack, face, walls).finishBands.find((b) => b.category === "none");
  const callout = finishCalloutHtml(doc, bare, elevationModel(doc, pack, face, walls));
  assert.ok(callout.includes(">Bare<") && callout.includes('data-fin="bare-restore"'));
  assert.ok(!callout.includes("fin-swatch"), "a bare face is not drawn as an empty checkbox");
});

test("a finish under a window is described by the window", () => {
  const doc = build({ openings: [{ id: "o1", sku: "TSP_WN1212", roomId: "r1", edgeIndex: 0, t: 0.5 }] });
  const walls = deriveWalls(doc, pack).filter((w) => w.category === "wall");
  let host = null;
  let side = 1;
  let model = null;
  for (const wall of walls) {
    for (const s of [1, -1]) {
      const candidate = elevationModel(doc, pack, { wallId: wall.id, side: s }, walls);
      if (candidate.openings.some((o) => o.category !== "door")) {
        host = wall;
        side = s;
        model = candidate;
        break;
      }
    }
    if (host) break;
  }
  assert.ok(host && model, "the window is on a wall");
  const opening = model.openings.find((o) => o.category !== "door");
  const x0 = model.flip ? host.length - (opening.offset + opening.width) : opening.offset;
  const x1 = model.flip ? host.length - opening.offset : opening.offset + opening.width;
  createFinishRun(doc, host, side, {
    category: "wallTile",
    outline: [[x0, 0], [x1, 0], [x1, opening.sill], [x0, opening.sill]],
  });
  const html = faceFinishHtml(doc, elevationModel(doc, pack, { wallId: host.id, side }, walls));
  assert.ok(html.includes("Under the window, up to 900 mm"), "the patch is named from the opening above it");
});

test("finishes of one type stay in wall order, and an overlap is named", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const face = { wallId: "w1", side: 1 };
  const right = createFinishRun(doc, walls[0], 1, { category: "paint", outline: [[4, 0], [6, 0], [6, 1], [4, 1]] });
  const left = createFinishRun(doc, walls[0], 1, { category: "paint", outline: [[0, 0], [2, 0], [2, 1], [0, 1]] });
  const model = elevationModel(doc, pack, face, walls);
  const html = faceFinishHtml(doc, model);
  const leftId = model.finishBands.find((b) => b.sourceId === left.id).id;
  const rightId = model.finishBands.find((b) => b.sourceId === right.id).id;
  assert.ok(html.indexOf(`data-fin-band="${leftId}"`) < html.indexOf(`data-fin-band="${rightId}"`), "the left patch is listed first");
  assert.ok(html.includes("Paint 1 of 2") && html.includes("Left side, up to 1 m"));
  assert.ok(html.includes("Paint 2 of 2") && html.includes("Right side, up to 1 m"));
  assert.ok(html.includes("2 areas"));
  assert.ok(html.includes("Paint on the plaster"));
  assert.ok(!html.includes("Paint areas overlap"), "patches that miss each other are not an overlap");
  createFinishRun(doc, walls[0], 1, { category: "paint", outline: [[1, 0], [3, 0], [3, 1], [1, 1]] });
  const overlap = faceFinishHtml(doc, elevationModel(doc, pack, face, walls));
  assert.ok(overlap.includes("Paint areas overlap"), "two paints on the same patch are named");
});

test("a shape drawn on a wall is measured as that shape, and a coat takes it off the default", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  const face = { wallId: "w1", side: 1 };
  const plaster = (m) => m.finishBands.filter((b) => b.source === "default").reduce((s, b) => s + b.quantity, 0);
  const before = plaster(elevationModel(doc, pack, face, walls));
  const outline = [[0, 0], [2, 0], [0, 1.5]];
  const run = createFinishRun(doc, walls[0], 1, { category: "render", outline });
  assert.equal(run.outline.length, 3);
  assert.equal(run.a, 0);
  assert.equal(run.b, 2);
  const after = elevationModel(doc, pack, face, walls);
  const band = after.finishBands.find((b) => b.sourceId === run.id);
  assert.ok(Math.abs(band.quantity - 1.5) < 1e-3, `drawn area ${band.quantity}`);
  assert.equal(band.outline.length, 3);
  assert.ok(Math.abs(before - plaster(after) - 1.5) < 1e-2, "the coat comes out of the default");
  const html = faceFinishHtml(doc, after);
  assert.ok(html.includes("Left side, up to 1.5 m"), "a drawn shape is described by where it sits");
  assert.ok(!html.includes("Drawn area"), "a drawn shape is not described by its corner count");
  assert.ok(!html.includes("on the plaster"), "a coat that replaces the plaster is not reported as sitting on it");
  assert.ok(!html.includes('data-fin="band-from"'), "a drawn shape is not edited as a rectangle");
  assert.ok(html.includes('data-fin="band-draw"'));
  const kept = normalizeDoc({ finishRuns: [run] });
  assert.equal(kept.finishRuns[0].outline.length, 3);

  const back = { wallId: "w1", side: -1 };
  createFinishRun(doc, walls[0], -1, { category: "render", outline: [[1, 0], [3, 0], [1, 1]] });
  const flipped = elevationModel(doc, pack, back, walls).finishBands.find((b) => b.outline && Math.abs(b.outline[0][1]) < 1e-6 && b.outline[0][0] > 1);
  assert.ok(flipped, "the other face has its own drawn shape");
  assert.ok(Math.abs(flipped.outline[0][0] - (6 - 1)) < 1e-6, "a mirrored face shows the shape from the left");

  const edited = applyOutlinePoints(doc, pack, face, band.id, [
    { s: 0, z: 0 }, { s: 4, z: 0 }, { s: 0, z: 1.5 },
  ], walls);
  assert.ok(edited);
  const widened = elevationModel(doc, pack, face, walls).finishBands.find((b) => b.sourceId === run.id);
  assert.ok(Math.abs(widened.quantity - 3) < 1e-3, `edited area ${widened.quantity}`);
});

test("the plan marks an explicit wall finish on the room side, and not the plaster default", () => {
  const plain = build();
  assert.equal(planWallFinishMarks(plain, pack, deriveWalls(plain, pack)).length, 0);

  const none = build({}, { finishes: [{ id: "n", surface: "wall", category: "none", bottom: 0, top: 1.2, faces: "all" }] });
  assert.equal(planWallFinishMarks(none, pack, deriveWalls(none, pack)).length, 0);

  const doc = build({}, { finishes: [{ id: "f1", surface: "wall", category: "wallTile", bottom: 0, top: 1.2, faces: "all" }] });
  const walls = deriveWalls(doc, pack).filter((w) => w.category === "wall");
  const marks = planWallFinishMarks(doc, pack, walls);
  assert.equal(marks.length, walls.length);
  assert.ok(marks.every((m) => m.category === "wallTile" && m.label === "Wall tile" && !m.skirting));
  const poly = roomPolygon(doc.rooms[0]);
  for (const mark of marks) {
    const inside = pointInPoly((mark.x1 + mark.x2) / 2 + mark.nx * 0.15, (mark.y1 + mark.y2) / 2 + mark.ny * 0.15, poly);
    assert.equal(inside, true, "the stripe points into the room");
    assert.ok(mark.roomIds.includes("r1"));
  }
});

test("a taller finish wins a shared stretch, and a skirting sits beside it", () => {
  const doc = build({}, {
    finishes: [
      { id: "tile", surface: "wall", category: "wallTile", bottom: 0, top: 1.2, faces: "all" },
      { id: "paint", surface: "wall", category: "paint", bottom: 0, top: 2.4, faces: "all" },
      { id: "skirt", surface: "wall", category: "skirting", bottom: 0, top: 0.12, faces: "all" },
    ],
  });
  const marks = planWallFinishMarks(doc, pack, deriveWalls(doc, pack));
  const faces = marks.filter((m) => !m.skirting);
  const skirts = marks.filter((m) => m.skirting);
  assert.ok(faces.length > 0 && faces.every((m) => m.category === "paint"));
  assert.ok(skirts.length === faces.length && skirts.every((m) => m.beside && m.label === "Skirting"));
});

test("a finish run marks only the stretch it covers", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const walls = deriveWalls(doc, pack);
  createFinishRun(doc, walls[0], 1, { category: "wallTile", from: 1, to: 3, bottom: 0.5, top: 1.5 });
  const marks = planWallFinishMarks(doc, pack, walls);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].side, 1);
  assert.ok(Math.abs(marks[0].from - 1) < 1e-6);
  assert.ok(Math.abs(marks[0].to - 3) < 1e-6);
  assert.ok(Math.abs(marks[0].x2 - marks[0].x1 - 2) < 1e-6);
});

test("room rules take a typed product and no longer offer floor rules", () => {
  const doc = build({}, { finishes: [{ id: "f1", surface: "wall", category: "wallTile", top: 1.2 }] });
  const html = roomFinishHtml(doc, doc.rooms[0]);
  assert.ok(html.includes('data-fin="rule-type"') && html.includes('data-fin="rule-product-name"'));
  assert.ok(html.includes('data-fin="new-rule-category"') && !html.includes('data-fin="new-surface"'));
});