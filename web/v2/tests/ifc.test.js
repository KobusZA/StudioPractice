import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { exportIfc, ifcGuid } from "../ifc.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";

// The real template pack, normalized to metres exactly as ui.js does on load.
const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);

const WALL = "TSP_WAL_MASONARY_WALL_220MM_PLASTER";
const DOOR = "TSP_DOR_1800_X_2100MM";
const WINDOW = "TSP_WIN_2150_X_1500MM";
const LEVEL = "01 GFL";

/** One 6 x 4 m room on the ground floor, the smallest thing worth exporting. */
function roomDoc(extra = {}) {
  return normalizeDoc({
    packId: pack.id,
    rooms: [{
      id: "r1", name: "Lounge", use: "living", level: LEVEL,
      wallSku: WALL, floorSku: pack.system.defaultFloorSku,
      rect: { x: 0, y: 0, w: 6, h: 4 },
    }],
    ...extra,
  });
}

function entitiesOf(text, type) {
  return text.split("\n").filter((line) => line.includes(`= ${type}(`));
}

// --- the file is a file -----------------------------------------------------

test("the export is a well-formed IFC 2x3 STEP file", () => {
  const { text, fileName } = exportIfc(roomDoc(), pack);
  assert.ok(text.startsWith("ISO-10303-21;\nHEADER;"));
  assert.match(text, /FILE_SCHEMA\(\('IFC2X3'\)\);/);
  assert.ok(text.trimEnd().endsWith("END-ISO-10303-21;"));
  assert.ok(fileName.endsWith(".ifc"));
});

test("an unnamed author is an empty list, not a list holding the unset marker", () => {
  const { text } = exportIfc(roomDoc(), pack);
  assert.match(text, /FILE_NAME\([^\n]*,\(\),\('Studio Practice'\)/);
  const named = exportIfc(roomDoc(), pack, { author: "T. Draughtsman" }).text;
  assert.match(named, /FILE_NAME\([^\n]*,\('T\. Draughtsman'\),/);
});

test("every entity reference resolves to an entity in the file", () => {
  const { text } = exportIfc(roomDoc(), pack);
  const data = text.slice(text.indexOf("DATA;"));
  const defined = new Set([...data.matchAll(/^#(\d+)= /gm)].map((m) => m[1]));
  const used = new Set([...data.matchAll(/#(\d+)/g)].map((m) => m[1]));
  const dangling = [...used].filter((id) => !defined.has(id));
  assert.deepEqual(dangling, [], "a dangling reference makes the whole file unreadable to Revit");
});

test("every real carries a decimal point, as STEP requires", () => {
  const { text } = exportIfc(roomDoc(), pack);
  for (const line of entitiesOf(text, "IFCCARTESIANPOINT")) {
    const coords = line.slice(line.indexOf("((") + 2, line.indexOf("))")).split(",");
    for (const coord of coords) {
      assert.match(coord, /\./, `"${coord}" in ${line} is an integer where STEP wants a real`);
    }
  }
});

// --- the spatial structure Revit reads --------------------------------------

test("every level in the pack becomes a building storey at its own elevation", () => {
  const { text, report } = exportIfc(roomDoc(), pack);
  const storeys = entitiesOf(text, "IFCBUILDINGSTOREY");
  assert.equal(storeys.length, pack.levels.length);
  assert.equal(report.counts.levels, pack.levels.length);
  assert.ok(storeys.some((l) => l.includes("'00 FOUNDATION'") && l.includes("-0.6")));
  assert.ok(storeys.some((l) => l.includes("'02 L1'") && l.includes(",3.)")));
});

test("a room exports as four walls and one space", () => {
  const { text, report } = exportIfc(roomDoc(), pack);
  assert.equal(entitiesOf(text, "IFCWALLSTANDARDCASE").length, 4);
  assert.equal(entitiesOf(text, "IFCSPACE").length, 1);
  assert.equal(report.counts.walls, 4);
  assert.equal(report.counts.rooms, 1);
  assert.deepEqual(report.skipped, []);
});

test("the plan's handedness survives: canvas y-down becomes IFC y-north", () => {
  const { text } = exportIfc(roomDoc(), pack);
  // The room spans y 0..4 on the canvas, which is y 0..-4 in Revit. If the
  // negation were dropped the house would import mirrored about its own
  // east-west axis, which reads as a plausible plan and is not one.
  const points = entitiesOf(text, "IFCCARTESIANPOINT");
  assert.ok(points.some((p) => p.includes("(6.,-4.)") || p.includes("(6.,-4.,")));
  assert.ok(!points.some((p) => p.includes("(6.,4.)")));
});

test("walls land on the storey they were drawn on, not the default one", () => {
  const doc = roomDoc();
  doc.rooms[0].level = "02 L1";
  const { text } = exportIfc(doc, pack);
  const storeyRef = entitiesOf(text, "IFCBUILDINGSTOREY").find((l) => l.includes("'02 L1'")).split("=")[0];
  const containment = entitiesOf(text, "IFCRELCONTAINEDINSPATIALSTRUCTURE");
  assert.equal(containment.length, 1);
  assert.ok(containment[0].endsWith(`${storeyRef});`));
});

// --- walls ------------------------------------------------------------------

test("each wall type carries a material layer set, which Revit needs to treat it as a wall", () => {
  const { text } = exportIfc(roomDoc(), pack);
  assert.equal(entitiesOf(text, "IFCMATERIALLAYERSETUSAGE").length, 1);
  assert.equal(entitiesOf(text, "IFCRELASSOCIATESMATERIAL").length, 1);
});

test("a wall carries both an axis and a body, so Revit imports it as a wall", () => {
  const { text } = exportIfc(roomDoc(), pack);
  assert.ok(entitiesOf(text, "IFCSHAPEREPRESENTATION").some((l) => l.includes("'Axis'")));
  assert.ok(entitiesOf(text, "IFCSHAPEREPRESENTATION").some((l) => l.includes("'Body'")));
});

test("the wall's IFC type is named after the template's family and type", () => {
  const { text, report } = exportIfc(roomDoc(), pack);
  assert.ok(entitiesOf(text, "IFCWALLSTANDARDCASE")
    .every((l) => l.includes("'Basic Wall : Masonary wall 220mm (plaster)'")));
  assert.equal(entitiesOf(text, "IFCWALLTYPE").length, 1);
  assert.deepEqual(report.unmappedTypes, []);
});

test("a SKU with no recorded template type is reported, never given a lookalike", () => {
  const nameless = structuredClone(pack);
  nameless.skus.find((s) => s.id === WALL).revit = { category: "Walls", family: null, type: null };
  const { text, report } = exportIfc(roomDoc(), nameless);
  assert.equal(report.unmappedTypes.length, 1);
  assert.match(report.unmappedTypes[0], /Masonary wall 220mm \(plaster\)/);
  // Falls back to the SKU's own name - never to another wall type in the pack.
  assert.ok(entitiesOf(text, "IFCWALLSTANDARDCASE").every((l) => l.includes("'Masonary wall 220mm (plaster)'")));
});

test("a wall with no thickness is skipped and reported rather than guessed", () => {
  const thin = structuredClone(pack);
  thin.skus.find((s) => s.id === WALL).geometry.thickness = 0;
  const { text, report } = exportIfc(roomDoc(), thin);
  assert.equal(entitiesOf(text, "IFCWALLSTANDARDCASE").length, 0);
  assert.equal(report.skipped.length, 4);
  assert.match(report.skipped[0], /states no thickness/);
});

test("a 600X200 bearing footing exports as a 600 mm wide, 200 mm tall strip", () => {
  const footing = "TSP_FND_BEARING_FOOTING_600X200_MM";
  const doc = normalizeDoc({
    packId: pack.id,
    segments: [{
      id: "f1", sku: footing, level: LEVEL,
      x1: 0, y1: 0, x2: 6, y2: 0, status: "planned",
    }],
  });
  const { text, report } = exportIfc(doc, pack);
  assert.equal(report.skipped.length, 0);
  assert.ok(entitiesOf(text, "IFCRECTANGLEPROFILEDEF").some((l) => l.includes(",6.,0.6)")));
  assert.ok(entitiesOf(text, "IFCEXTRUDEDAREASOLID").some((l) => l.endsWith(",0.2);") || l.includes(",0.2);")));
});

// --- doors and windows ------------------------------------------------------

function docWithOpening(sku) {
  const doc = roomDoc();
  doc.openings = [{ id: "o1", sku, roomId: "r1", wallId: null, t: 0.5, swing: 1, status: "planned" }];
  return doc;
}

test("a door cuts a real void in its host wall and fills it", () => {
  const { text, report } = exportIfc(docWithOpening(DOOR), pack);
  assert.equal(entitiesOf(text, "IFCDOOR").length, 1);
  assert.equal(entitiesOf(text, "IFCOPENINGELEMENT").length, 1);
  assert.equal(entitiesOf(text, "IFCRELVOIDSELEMENT").length, 1);
  assert.equal(entitiesOf(text, "IFCRELFILLSELEMENT").length, 1);
  assert.equal(report.counts.doors, 1);

  // OverallHeight and OverallWidth, in metres, off the template's own type.
  assert.match(entitiesOf(text, "IFCDOOR")[0], /,2\.1,1\.8\);$/);
});

test("the void is cut deeper than the wall, so the opening actually shows", () => {
  const { text } = exportIfc(docWithOpening(DOOR), pack);
  const profiles = entitiesOf(text, "IFCRECTANGLEPROFILEDEF");
  assert.ok(profiles.some((l) => l.endsWith("1.8,0.26);")), "void is wall thickness + 20 mm");
  assert.ok(profiles.some((l) => l.endsWith("1.8,0.24);")), "leaf is the wall thickness");
});

test("a window is an IfcWindow at its sill height, not an IfcDoor on the floor", () => {
  const { text, report } = exportIfc(docWithOpening(WINDOW), pack);
  assert.equal(entitiesOf(text, "IFCWINDOW").length, 1);
  assert.equal(entitiesOf(text, "IFCDOOR").length, 0);
  assert.equal(report.counts.windows, 1);
  // 900 mm up, and 3 m along a 6 m wall: the window sits in wall coordinates,
  // so it travels with the wall instead of being pinned to the world.
  assert.ok(entitiesOf(text, "IFCCARTESIANPOINT").some((l) => l.includes("(3.,0.,0.9)")));
});

test("an opening whose host wall was skipped is reported, not orphaned", () => {
  const thin = structuredClone(pack);
  thin.skus.find((s) => s.id === WALL).geometry.thickness = 0;
  const { text, report } = exportIfc(docWithOpening(DOOR), thin);
  assert.equal(entitiesOf(text, "IFCDOOR").length, 0);
  assert.ok(report.skipped.some((m) => /has no exported host wall/.test(m)));
});

// --- rooms ------------------------------------------------------------------

test("a room becomes a space aggregated into its storey, with its area attached", () => {
  const { text } = exportIfc(roomDoc(), pack);
  const space = entitiesOf(text, "IFCSPACE")[0];
  assert.ok(space.includes("'Lounge'"));
  assert.ok(space.includes(".INTERNAL."));
  assert.ok(text.includes("IFCAREAMEASURE(24.)"), "6 x 4 m room reports 24 m²");
});

test("a room with no known ceiling height gets no volume, and says so", () => {
  const flat = structuredClone(pack);
  flat.system.wallHeight = null;
  for (const level of flat.levels) level.floorToCeiling = null;
  const { text, report } = exportIfc(roomDoc(), flat);
  const space = entitiesOf(text, "IFCSPACE")[0];
  assert.match(space, /,\$,'Lounge',\.ELEMENT\./, "no representation, rather than a plausible one");
  assert.ok(report.skipped.some((m) => /no ceiling height/.test(m)));
});

// --- the properties that keep the model priceable ---------------------------

test("each element carries its SKU id and its schedule measures", () => {
  const { text } = exportIfc(roomDoc(), pack);
  assert.ok(text.includes("'SP_SKU'") && text.includes(`IFCTEXT('${WALL}')`));
  const props = entitiesOf(text, "IFCPROPERTYSINGLEVALUE");
  assert.ok(props.some((l) => l.includes("'Length'") && l.includes("IFCLENGTHMEASURE(6.)")));
  assert.ok(props.some((l) => l.includes("'Volume'") && l.includes("IFCVOLUMEMEASURE")));
});

test("a rate reference rides along when the pack has one, and is absent when it does not", () => {
  const props = (p) => entitiesOf(exportIfc(roomDoc(), p).text, "IFCPROPERTYSINGLEVALUE");
  // The template pack states no rates yet, and a missing rate stays missing -
  // a property written as "null" or "0" is the guessed fact this app refuses.
  assert.equal(pack.skus.find((s) => s.id === WALL).cost.rateRef, null);
  assert.ok(!props(pack).some((l) => l.includes("'RateRef'")));

  const rated = structuredClone(pack);
  rated.skus.find((s) => s.id === WALL).cost.rateRef = "TSP-WALL-220";
  assert.ok(props(rated).some((l) => l.includes("'RateRef'") && l.includes("'TSP-WALL-220'")));
});

test("a concave room states that its minimum dimension is an upper bound", () => {
  const doc = normalizeDoc({
    rooms: [{
      id: "r1", name: "L lounge", use: "living", level: LEVEL, wallSku: WALL,
      shape: { kind: "poly", points: [[0, 0], [6, 0], [6, 4], [3, 4], [3, 2], [0, 2]] },
    }],
  });
  const { text } = exportIfc(doc, pack);
  assert.ok(text.includes("'MinDimensionExact'") && text.includes("IFCTEXT('False')"));
});

test("what the export leaves behind is named, not silently dropped", () => {
  const doc = roomDoc({
    slabs: [{ id: "sl1", sku: pack.system.defaultFloorSku, level: LEVEL, rect: { x: 8, y: 0, w: 2, h: 2 } }],
    roofs: [{ id: "rf1", sku: pack.system.defaultRoofSku, level: LEVEL, form: "gable", rect: { x: 0, y: 0, w: 6, h: 4 } }],
  });
  const { report } = exportIfc(doc, pack);
  assert.deepEqual(report.notExported, ["1 floors and slabs", "1 roofs"]);
  // Not a warning and not a skip: the drawing is fine, this version of the
  // exporter is what is incomplete.
  assert.deepEqual(report.skipped, []);
});

// --- ids --------------------------------------------------------------------

test("GlobalIds are 22 IFC base64 characters", () => {
  const guid = ifcGuid("wall:abc");
  assert.equal(guid.length, 22);
  assert.match(guid, /^[0-9A-Za-z_$]{22}$/);
});

test("re-exporting an unchanged drawing produces the same ids", () => {
  const doc = roomDoc();
  const first = exportIfc(doc, pack, { now: new Date("2026-01-01T00:00:00Z") });
  const second = exportIfc(doc, pack, { now: new Date("2026-06-01T00:00:00Z") });
  const ids = (text) => [...text.matchAll(/IFCWALLSTANDARDCASE\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids(first.text), ids(second.text));
});

test("distinct elements get distinct ids", () => {
  const { text } = exportIfc(docWithOpening(DOOR), pack);
  const guids = [...text.matchAll(/IFC[A-Z]+\('([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  assert.equal(new Set(guids).size, guids.length);
});

// --- nothing to export ------------------------------------------------------

test("an empty document still produces a valid file with the storey stack", () => {
  const { text, report } = exportIfc(normalizeDoc({}), pack);
  assert.ok(text.includes("IFCPROJECT"));
  assert.equal(entitiesOf(text, "IFCBUILDINGSTOREY").length, pack.levels.length);
  assert.equal(report.counts.walls, 0);
});

test("a pack with no levels refuses rather than inventing a storey to hold the plan", () => {
  const levelless = structuredClone(pack);
  levelless.levels = [];
  const { text, report } = exportIfc(roomDoc(), levelless);
  assert.equal(text, null);
  assert.match(report.skipped[0], /states no levels/);
});
