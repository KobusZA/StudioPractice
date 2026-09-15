import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { area, offsetPolygonInward } from "../geom.js";
import { emptyDoc } from "../model.js";
import { deriveBuildingLine, ensureSite, setBuildingLine, setPropertyLine, setSgReference } from "../site.js";
import { RULE_PACK } from "../rules.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

// --- offsetPolygonInward -----------------------------------------------------

test("offsetPolygonInward shrinks a square by exactly the offset on every side", () => {
  const square = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const inner = offsetPolygonInward(square, 3);
  assert.ok(inner);
  const xs = inner.map((p) => p[0]).sort((a, b) => a - b);
  const ys = inner.map((p) => p[1]).sort((a, b) => a - b);
  assert.deepEqual(xs.map((n) => Math.round(n * 1e6) / 1e6), [3, 3, 17, 17]);
  assert.deepEqual(ys.map((n) => Math.round(n * 1e6) / 1e6), [3, 3, 17, 17]);
  assert.equal(Math.round(area(inner) * 1e6) / 1e6, 14 * 14);
});

test("offsetPolygonInward returns the polygon unchanged for a zero distance", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const same = offsetPolygonInward(square, 0);
  assert.equal(Math.round(area(same) * 1e6) / 1e6, 100);
});

test("offsetPolygonInward refuses an offset that collapses the shape, rather than returning garbage", () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(offsetPolygonInward(square, 3), null); // 6 m of total shrink on a 4 m side
});

test("offsetPolygonInward works on an L-shaped erf, not just a rectangle", () => {
  const l = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 10], [0, 10]];
  const inner = offsetPolygonInward(l, 1);
  assert.ok(inner);
  assert.ok(area(inner) < area(l));
});

// --- site.js -----------------------------------------------------------------

test("ensureSite lazily creates the site record, once, without clobbering it", () => {
  const doc = emptyDoc();
  assert.equal(doc.site, null);
  const first = ensureSite(doc);
  first.erfNumber = "1234";
  const second = ensureSite(doc);
  assert.equal(second, first);
  assert.equal(doc.site.erfNumber, "1234");
});

test("setPropertyLine stores a poly shape and clears an auto-derived building line", () => {
  const doc = emptyDoc();
  setBuildingLine(doc, [[1, 1], [5, 1], [5, 5], [1, 5]], { derived: true });
  setPropertyLine(doc, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.equal(doc.site.propertyLine.kind, "poly");
  assert.equal(doc.site.buildingLine, null, "a derived building line no longer matches the new boundary");
});

test("setPropertyLine leaves a hand-drawn building line alone", () => {
  const doc = emptyDoc();
  setBuildingLine(doc, [[1, 1], [5, 1], [5, 5], [1, 5]], { derived: false });
  setPropertyLine(doc, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.ok(doc.site.buildingLine, "a hand-drawn override was placed on purpose");
});

test("setPropertyLine with fewer than 3 points clears it", () => {
  const doc = emptyDoc();
  setPropertyLine(doc, [[0, 0], [1, 1]]);
  assert.equal(doc.site.propertyLine, null);
});

test("setSgReference records the erf number and the plan-to-real control point", () => {
  const doc = emptyDoc();
  setSgReference(doc, { erfNumber: "1234", real: [45123.5, 6789.2], plan: [3, 4] });
  assert.equal(doc.site.erfNumber, "1234");
  assert.deepEqual(doc.site.sgReference.real, [45123.5, 6789.2]);
  assert.deepEqual(doc.site.sgReference.plan, [3, 4]);
});

test("setSgReference without a real coordinate clears the reference", () => {
  const doc = emptyDoc();
  setSgReference(doc, { erfNumber: "1234" });
  assert.equal(doc.site.sgReference, null);
  assert.equal(doc.site.erfNumber, "1234", "the erf number is kept even without a coordinate");
});

test("deriveBuildingLine explains exactly why it cannot run, at every missing input", () => {
  const doc = emptyDoc();
  assert.match(deriveBuildingLine(doc, pack, RULE_PACK).reason, /no property line/);

  setPropertyLine(doc, [[0, 0], [20, 0], [20, 20], [0, 20]]);
  const noMunicipality = structuredClone(pack);
  assert.match(deriveBuildingLine(doc, noMunicipality, RULE_PACK).reason, /municipality/);

  const unknownMunicipality = structuredClone(pack);
  unknownMunicipality.locale.municipality = "Nowhere Municipality";
  assert.match(deriveBuildingLine(doc, unknownMunicipality, RULE_PACK).reason, /no setback distance/);
});

test("deriveBuildingLine succeeds once a property line and a known municipality are both set", () => {
  const doc = emptyDoc();
  setPropertyLine(doc, [[0, 0], [20, 0], [20, 20], [0, 20]]);
  const capeTown = structuredClone(pack);
  capeTown.locale.municipality = "City of Cape Town";
  const result = deriveBuildingLine(doc, capeTown, RULE_PACK);
  assert.equal(result.ok, true);
  assert.equal(result.setback, RULE_PACK.zoning.setbackByMunicipality["City of Cape Town"]);
  assert.equal(result.points.length, 4);
});
