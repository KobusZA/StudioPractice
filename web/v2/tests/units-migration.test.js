import { test } from "node:test";
import assert from "node:assert/strict";

import { migratePack } from "../migrate-pack.js";
import { PACK_SCHEMA, normalizePackUnits, validatePack } from "../schema.js";

// The /2 -> /3 fixture pair UNITS-MIGRATION-PLAN.md calls for: an old-shaped
// (metres) pack in, the mm-native sp.pack/3 pack migratePack() is expected to
// produce, and proof that normalizePackUnits() inverts the conversion back to
// exactly what it started from.

function v1Fixture() {
  return {
    system: {
      id: "fixture",
      name: "Fixture pack",
      defaultWallSku: "WAL1",
      wallHeight: 2.8,
      levels: [
        { id: "01 GFL", name: "01 GFL", elevation: 0 },
        { id: "02 L1", name: "02 L1", elevation: 2.8 },
      ],
    },
    skus: [
      {
        id: "WAL1",
        name: "Masonry wall 220mm (plaster)",
        category: "wall",
        unit: "m3",
        thickness: 0.22,
        height: 2.8,
        draw: "wall",
      },
      {
        id: "WIN1",
        name: "Window 900 x 900mm",
        category: "window",
        unit: "ea",
        width: 0.9,
        height: 0.9,
        sill: 0.9,
        draw: "window",
      },
    ],
  };
}

test("migratePack converts every geometry length key from metres to millimetres", () => {
  const v2 = migratePack(v1Fixture());

  assert.equal(v2.schema, PACK_SCHEMA);
  assert.equal(v2.schema, "sp.pack/3");

  const wall = v2.skus.find((s) => s.id === "WAL1");
  assert.equal(wall.geometry.thickness, 220);
  assert.equal(wall.geometry.height, 2800);

  const win = v2.skus.find((s) => s.id === "WIN1");
  assert.equal(win.geometry.width, 900);
  assert.equal(win.geometry.height, 900);
  assert.equal(win.geometry.sill, 900);

  // system.wallHeight moves to millimetres alongside geometry.height - they
  // are the same fallback pair in walls.js and must share a unit.
  assert.equal(v2.system.wallHeight, 2800);

  // Levels are positions, not named dimensions, and stay metres.
  assert.equal(v2.levels[0].elevation, 0);
  assert.equal(v2.levels[1].elevation, 2.8);
  assert.equal(v2.levels[0].floorToFloor, 2.8);
});

test("a migrated pack still validates", () => {
  const v2 = migratePack(v1Fixture());
  const result = validatePack(v2);
  assert.deepEqual(result.errors, []);
});

test("normalizePackUnits is the exact inverse of migratePack's mm conversion", () => {
  const v2 = migratePack(v1Fixture());
  const runtime = normalizePackUnits(v2);

  const wall = runtime.skus.find((s) => s.id === "WAL1");
  assert.equal(wall.geometry.thickness, 0.22);
  assert.equal(wall.geometry.height, 2.8);
  assert.equal(runtime.system.wallHeight, 2.8);

  // Non-destructive: the pack passed in is untouched.
  assert.equal(v2.skus.find((s) => s.id === "WAL1").geometry.thickness, 220);
  assert.equal(v2.system.wallHeight, 2800);

  // Levels pass through unchanged - normalizePackUnits never touches them.
  assert.equal(runtime.levels[1].elevation, 2.8);
});
