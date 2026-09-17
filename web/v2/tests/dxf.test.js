import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { exportDxf } from "../dxf.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);

const WALL = "TSP_WAL_MASONARY_WALL_220MM_PLASTER";
const DOOR = "TSP_DOR_1800_X_2100MM";
const WINDOW = "TSP_WIN_2150_X_1500MM";
const LEVEL = "01 GFL";

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

function codes(text, type) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i] === "0" && lines[i + 1] === type) out.push(i);
  }
  return out;
}

test("the export is a DXF with millimetre insertion units", () => {
  const { text, fileName } = exportDxf(roomDoc(), pack);
  assert.ok(fileName.endsWith(".dxf"));
  assert.match(text, /\$ACADVER\n1\nAC1015/);
  assert.match(text, /\$INSUNITS\n70\n4/);
  assert.ok(text.trimEnd().endsWith("EOF"));
});

test("a 6 m room writes wall outlines in millimetres, not metres", () => {
  const { text, report } = exportDxf(roomDoc(), pack);
  assert.equal(report.counts.walls, 4);
  assert.equal(codes(text, "LWPOLYLINE").length >= 4, true);
  // 6 m along X, y flipped: the far corner is 6000 mm, -4000 mm.
  assert.match(text, /\n10\n6000\.000\n20\n-4000\.000/);
  assert.doesNotMatch(text, /\n10\n6\.000\n20\n-4\.000/);
});

test("layers are split by storey so a Revit user can freeze the floor they are not tracing", () => {
  const doc = roomDoc();
  doc.rooms[0].level = "02 L1";
  const { text } = exportDxf(doc, pack);
  assert.match(text, /A-WALL-02_L1/);
  assert.match(text, /A-ROOM-02_L1/);
  assert.doesNotMatch(text, /A-WALL-01_GFL/);
});

test("a door and a window land on their own layers, with a swing on the door", () => {
  const doc = roomDoc();
  doc.openings = [
    { id: "o1", sku: DOOR, roomId: "r1", wallId: null, t: 0.5, swing: 1, status: "planned" },
    { id: "o2", sku: WINDOW, roomId: "r1", wallId: null, t: 0.4, swing: 1, status: "planned" },
  ];
  const { text, report } = exportDxf(doc, pack);
  assert.equal(report.counts.doors, 1);
  assert.equal(report.counts.windows, 1);
  assert.match(text, /A-DOOR-01_GFL/);
  assert.match(text, /A-WIND-01_GFL/);
  assert.equal(codes(text, "ARC").length, 1);
});

test("the report says this is linework to trace, not a Revit model", () => {
  const { report } = exportDxf(roomDoc(), pack);
  assert.ok(report.warnings.some((w) => /2D CAD drawing/.test(w)));
});

test("floors and roofs stay behind and are named", () => {
  const doc = roomDoc({
    slabs: [{ id: "sl1", sku: pack.system.defaultFloorSku, level: LEVEL, rect: { x: 8, y: 0, w: 2, h: 2 } }],
    roofs: [{ id: "rf1", sku: pack.system.defaultRoofSku, level: LEVEL, form: "gable", rect: { x: 0, y: 0, w: 6, h: 4 } }],
  });
  const { report } = exportDxf(doc, pack);
  assert.deepEqual(report.notExported, ["1 floors and slabs", "1 roofs"]);
});

test("an empty document is still a valid DXF", () => {
  const { text, report } = exportDxf(normalizeDoc({}), pack);
  assert.ok(text.trimEnd().endsWith("EOF"));
  assert.equal(report.counts.walls, 0);
});
