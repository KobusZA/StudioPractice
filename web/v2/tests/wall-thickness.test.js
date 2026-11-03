// BOS-03: a plastered wall's plan width is the overall thickness. The core is
// named separately, and the difference is plaster on the type label.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { drawnWallThickness, wallThicknessLabel } from "../walls.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);

const sku = (id) => pack.skus.find((s) => s.id === id);

test("the live 220 mm plastered wall draws at 240 mm and states a 220 mm core", () => {
  const wall = sku("TSP_WAL_MASONARY_WALL_220MM_PLASTER");
  assert.equal(wall.geometry.thickness, 0.24);
  assert.equal(wall.geometry.coreThickness, 0.22);
  assert.equal(drawnWallThickness(wall), 0.24);
  assert.match(wallThicknessLabel(wall), /220/);
  assert.match(wallThicknessLabel(wall), /plaster/);
  assert.match(wallThicknessLabel(wall), /240/);
});

test("the 110 mm plastered wall names its core and its 130 mm overall", () => {
  const wall = sku("TSP_WAL_MASONARY_WALL_110MM_PLASTER");
  assert.equal(wall.geometry.thickness, 0.13);
  assert.equal(wall.geometry.coreThickness, 0.11);
  const label = wallThicknessLabel(wall);
  assert.match(label, /110/);
  assert.match(label, /plaster/);
  assert.match(label, /130/);
});

test("the no-plaster 220 foundation is not labelled as plaster", () => {
  const wall = sku("TSP_FND_MASONARY_WALL_220MM_FOUNDATI");
  assert.equal(wall.geometry.thickness, 0.24);
  assert.equal(wall.geometry.coreThickness, undefined);
  assert.equal(wallThicknessLabel(wall).includes("plaster"), false);
});

test("masonry volume stays on the overall width, and the coat is still billed", () => {
  const doc = normalizeDoc({
    segments: [{
      id: "w1",
      sku: "TSP_WAL_MASONARY_WALL_220MM_PLASTER",
      level: "01 GFL",
      x1: 0, y1: 0, x2: 4, y2: 0,
    }],
  });
  const compiled = compile(doc, pack);
  const wall = compiled.instances.find((r) => r.model === "TSP_WAL_MASONARY_WALL_220MM_PLASTER");
  assert.ok(Math.abs(wall.volume - 4 * 3 * 0.24) < 1e-6);
  assert.ok(compiled.instances.some((r) => r.finishCategory === "plaster"));
});
