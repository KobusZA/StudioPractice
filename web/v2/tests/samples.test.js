// Sample jobs are traced drawings: wall segments, ceiling slabs, hosted openings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizePackUnits } from "../schema.js";
import { compile } from "../compile.js";
import { deriveWalls } from "../walls.js";
import { skuById, wallForOpening } from "../openings.js";
import { SAMPLE_JOBS, constantiaDoc, observatoryDoc, seaPointDoc } from "../samples.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);

function compiled(doc) {
  const result = compile(doc, pack);
  assert.ok(result, "sample jobs compile against the TSP pack");
  return result;
}

function byCategory(instances, category) {
  return instances.filter((row) => row.category === category);
}

function wallSegments(doc) {
  return (doc.segments || []).filter((s) => skuById(pack, s.sku)?.category === "wall");
}

function ceilingSlabs(doc) {
  return (doc.slabs || []).filter((s) => skuById(pack, s.sku)?.category === "ceiling");
}

test("Open lists three named sample jobs", () => {
  assert.deepEqual(SAMPLE_JOBS.map((j) => j.name), [
    "Sea Point duplex",
    "Observatory warehouse",
    "Constantia pavilion",
  ]);
});

test("Sea Point is a traced drawing: selectable walls, ceilings, hosted doors", () => {
  const doc = seaPointDoc(pack);
  assert.equal(doc.name, "Sea Point duplex");
  assert.equal(doc.rooms.length, 0);
  assert.ok(wallSegments(doc).length >= 12);
  assert.ok(wallSegments(doc).some((s) => s.level === "02 L1"));
  assert.equal(doc.floorsRevealed, 1);
  assert.ok(ceilingSlabs(doc).length >= 6);
  assert.ok(doc.openings.every((o) => o.wallId && doc.segments.some((s) => s.id === o.wallId)));

  const walls = deriveWalls(doc, pack);
  assert.ok(walls.some((w) => w.drawn && w.category === "wall" && w.level === "01 GFL"));
  assert.ok(walls.some((w) => w.drawn && w.level === "02 L1"));
  assert.ok(doc.openings.every((o) => wallForOpening(doc, pack, walls, o)));

  const { instances } = compiled(doc);
  assert.ok(byCategory(instances, "Ceilings").length >= 6);
  assert.ok(byCategory(instances, "Walls").length >= 12);
  assert.ok(byCategory(instances, "Doors").length >= 3);
  assert.ok(byCategory(instances, "Windows").length >= 3);
});

test("Observatory traces the shell and only ceilings the fit-out", () => {
  const doc = observatoryDoc(pack);
  assert.ok(wallSegments(doc).some((s) => s.status === "existing"));
  assert.ok(wallSegments(doc).some((s) => s.status === "planned"));
  assert.equal(ceilingSlabs(doc).length, 4);
  assert.ok(ceilingSlabs(doc).every((s) => s.status === "planned"));
  const walls = deriveWalls(doc, pack);
  assert.ok(doc.openings.every((o) => wallForOpening(doc, pack, walls, o)));
  const { instances } = compiled(doc);
  assert.equal(byCategory(instances, "Ceilings").length, 4);
  assert.ok(byCategory(instances, "Doors").length >= 2);
});

test("Constantia is an all-planned traced pavilion", () => {
  const doc = constantiaDoc(pack);
  assert.ok(wallSegments(doc).every((s) => s.status === "planned"));
  assert.equal(ceilingSlabs(doc).length, 3);
  const walls = deriveWalls(doc, pack);
  assert.ok(doc.openings.every((o) => wallForOpening(doc, pack, walls, o)));
  const { instances } = compiled(doc);
  assert.equal(byCategory(instances, "Ceilings").length, 3);
  assert.ok(byCategory(instances, "Walls").length >= 6);
  assert.ok(byCategory(instances, "Roofs").length >= 1);
  assert.ok(byCategory(instances, "Doors").length >= 2);
});
