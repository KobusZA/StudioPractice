import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizePackUnits } from "../schema.js";
import { compile } from "../compile.js";
import { deriveWalls } from "../walls.js";
import { evaluateCompliance } from "../rules.js";
import { ROOM_USES, emptyDoc, rectShape } from "../model.js";
import { lookUpLevelId } from "../level-view.js";
import { seaPointDoc } from "../samples.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);
const gf = pack.system.defaultLevel;

function room(id, use, shape, level = gf) {
  return {
    id, name: id, use, level,
    wallSku: pack.system.defaultWallSku, floorSku: pack.system.defaultFloorSku,
    status: "planned", shape,
  };
}

test("every room use that maps to a regulated SANS class gets checked", () => {
  const regulated = new Set(["bedroom", "habitable", "kitchen", "bathroom", "toilet", "laundry", "scullery", "passage"]);
  for (const use of ROOM_USES.filter((u) => regulated.has(u.sansClass))) {
    const doc = emptyDoc();
    doc.rooms.push(room("r1", use.id, rectShape(0, 0, 1.5, 3)));
    const found = evaluateCompliance(doc, pack).filter((f) => f.roomId === "r1");
    assert.ok(found.length > 0, `${use.id} (${use.sansClass}) produced no findings`);
  }
});

test("a narrow living room fails the 2 m minimum like a bedroom does", () => {
  const doc = emptyDoc();
  doc.rooms.push(room("r1", "living", rectShape(0, 0, 1.5, 3)));
  const f = evaluateCompliance(doc, pack).find((x) => x.code === "part-c-min-dimension");
  assert.equal(f?.severity, "fail");
});

test("a room whose use was never set reports unknown, not a silent pass", () => {
  const doc = emptyDoc();
  doc.rooms.push(room("r1", "other", rectShape(0, 0, 4, 4)));
  const f = evaluateCompliance(doc, pack).filter((x) => x.roomId === "r1");
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "room-use-unset");
  assert.equal(f[0].severity, "unknown");
});

test("a room traced over drawn walls does not duplicate those walls or the floor slab", () => {
  const doc = seaPointDoc(pack);
  const before = deriveWalls(doc, pack).filter((w) => w.level === gf).length;
  const floorsBefore = compile(doc, pack).instances.filter((r) => r.kind === "room").length;
  doc.rooms.push(room("rA", "bedroom", rectShape(0, 0, 5.6, 6)));
  doc.rooms.push(room("rB", "living", rectShape(0, 9.6, 8, 4.8)));
  const after = deriveWalls(doc, pack).filter((w) => w.level === gf).length;
  assert.equal(after, before);
  const floorsAfter = compile(doc, pack).instances.filter((r) => r.kind === "room").length;
  assert.equal(floorsAfter, floorsBefore);
});

test("a window in a drawn wall counts toward the room it bounds", () => {
  const doc = seaPointDoc(pack);
  const l1 = lookUpLevelId(pack.levels, gf);
  if (!l1) return;
  doc.rooms.push(room("rBed", "bedroom", rectShape(0, 0, 5.6, 6), l1));
  const light = evaluateCompliance(doc, pack).find((x) => x.roomId === "rBed" && x.code === "part-o-light");
  assert.ok(light, "light check ran");
  assert.ok(!/0\.00 m² glazed/.test(light.message), light.message);
});
