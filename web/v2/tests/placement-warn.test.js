import { test } from "node:test";
import assert from "node:assert/strict";

import { foundationStorey, foundationsOffStorey, placementHintOverride } from "../placement-warn.js";

const foundation = { id: "00 FOUNDATION", name: "00 FOUNDATION", elevation: -0.6 };
const gfl = { id: "01 GFL", name: "01 GFL", elevation: 0 };

test("a ceiling or roof or opening on the foundation storey is flagged", () => {
  const text = placementHintOverride({
    tool: "slab",
    stationKind: "foundation",
    level: foundation,
    categories: ["ceiling"],
  });
  assert.match(text, /foundation storey/);
  assert.match(text, /00 FOUNDATION/);
});

test("a foundation on the foundation storey is not flagged", () => {
  assert.equal(placementHintOverride({
    tool: "wall",
    stationKind: "foundation",
    level: foundation,
    categories: ["foundation"],
  }), null);
});

test("Foundations on a ceiling cut of an ordinary storey is flagged", () => {
  const text = placementHintOverride({
    tool: "wall",
    stationKind: "ceiling",
    level: gfl,
    categories: ["foundation"],
  });
  assert.match(text, /ceiling plan/);
  assert.match(text, /foundation/);
});

test("Foundations on a roof cut is flagged", () => {
  const text = placementHintOverride({
    tool: "wall",
    stationKind: "roof",
    level: gfl,
    categories: ["foundation"],
  });
  assert.match(text, /roof plan/);
});

test("Foundations on a floor plan are not flagged when no foundation storey is known", () => {
  assert.equal(placementHintOverride({
    tool: "wall",
    stationKind: "floor",
    level: gfl,
    categories: ["foundation"],
  }), null);
});

test("Foundations on a floor plan are flagged when a foundation storey exists", () => {
  const text = placementHintOverride({
    tool: "wall",
    stationKind: "floor",
    level: gfl,
    levels: [foundation, gfl],
    categories: ["foundation"],
  });
  assert.match(text, /00 FOUNDATION/);
  assert.match(text, /belongs on/);
});

test("the foundation storey closest to datum is the one a footing belongs on", () => {
  const lower = { id: "B2", name: "B2", elevation: -3 };
  assert.equal(foundationStorey([lower, foundation, gfl]).id, "00 FOUNDATION");
  assert.equal(foundationStorey([gfl]), null);
});

test("a foundation drawn on the ground floor is reported once a foundation storey exists", () => {
  const levels = [foundation, gfl];
  const rows = foundationsOffStorey([
    { id: "f1", label: "Strip footing", levelId: "01 GFL" },
    { id: "f2", label: "Strip footing", levelId: "00 FOUNDATION" },
  ], levels);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "f1");
  assert.match(rows[0].message, /01 GFL/);
  assert.match(rows[0].message, /00 FOUNDATION/);
  assert.equal(foundationsOffStorey([
    { id: "f1", label: "Strip footing", levelId: "01 GFL" },
  ], [gfl]).length, 0);
});

test("walls on a ceiling cut of the same storey are not flagged", () => {
  assert.equal(placementHintOverride({
    tool: "wall",
    stationKind: "ceiling",
    level: gfl,
    categories: ["wall"],
  }), null);
});

test("a ceiling tool on a ceiling cut is not flagged", () => {
  assert.equal(placementHintOverride({
    tool: "slab",
    stationKind: "ceiling",
    level: gfl,
    categories: ["ceiling"],
  }), null);
});

test("Floors on a ceiling cut is flagged", () => {
  assert.match(placementHintOverride({
    tool: "slab",
    stationKind: "ceiling",
    level: gfl,
    categories: ["floor", "pool"],
  }), /ceiling plan/);
});

test("select never warns", () => {
  assert.equal(placementHintOverride({
    tool: "select",
    stationKind: "ceiling",
    level: gfl,
    categories: ["foundation"],
  }), null);
});
