import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { bomRows, boqRows, findRate, qtyForUnit, scheduleTotal } from "../schedule.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);
const rateBook = JSON.parse(
  readFileSync(new URL("../../samples/tsp-rates.json", import.meta.url)),
);

// Two rooms sharing part of one edge - the same fixture core.test.js uses.
function twoRoomDoc() {
  return normalizeDoc({
    rooms: [
      {
        id: "a", name: "Bathroom", use: "bathroom",
        rect: { x: 0, y: 0, w: 4, h: 3 },
        wallSku: "TSP_MAS009", floorSku: "TSP_RB016", status: "existing",
      },
      {
        id: "b", name: "Bedroom", use: "bedroom",
        rect: { x: 4, y: 0, w: 4, h: 4 },
        wallSku: "TSP_MAS009", floorSku: "TSP_RB016", status: "existing",
      },
    ],
  });
}

test("qtyForUnit reads the measure that matches the unit, never a different one", () => {
  const row = { length: 10, area: 20, volume: 3, count: 4 };
  assert.equal(qtyForUnit(row, "m"), 10);
  assert.equal(qtyForUnit(row, "m2"), 20);
  assert.equal(qtyForUnit(row, "m3"), 3);
  assert.equal(qtyForUnit(row, "ea"), 4);
});

test("findRate matches by SKU id before falling back to a category rate", () => {
  const hit = findRate(rateBook, { rateRef: "TSP_MAS009", category: "Walls" });
  assert.equal(hit.model, "TSP_MAS009");

  const fallback = findRate(rateBook, { rateRef: "NOT_A_REAL_SKU", category: "Doors" });
  assert.equal(fallback.category, "Doors");

  assert.equal(findRate(rateBook, { rateRef: "NOT_A_REAL_SKU", category: "Nothing" }), null);
});

test("bomRows rolls per-element instances up into one line per SKU, unpriced", () => {
  const out = compile(twoRoomDoc(), pack);
  const rows = bomRows(out);

  // Every drawn wall segment shares one SKU, so it is one BOM line, not one
  // per element - that is the entire point of a rollup.
  const wallLines = rows.filter((r) => r.model === "TSP_MAS009");
  assert.equal(wallLines.length, 1);
  assert.equal(wallLines[0].unit, "m3");
  assert.ok(wallLines[0].qty > 0);
  assert.equal(wallLines[0].elements.length, out.instances.filter((r) => r.model === "TSP_MAS009").length);

  // No money anywhere in a BOM row.
  for (const row of rows) {
    assert.equal("rate" in row, false);
    assert.equal("amount" in row, false);
  }
});

test("each element in a rollup carries a selection kind for locating it on the plan", () => {
  const out = compile(twoRoomDoc(), pack);
  const rows = bomRows(out);

  // Room-derived shared walls have no doc entity of their own to select -
  // only a directly drawn segment does (see compile.js's wall.drawn note).
  const wallLine = rows.find((r) => r.model === "TSP_MAS009");
  assert.ok(wallLine.elements.every((e) => e.kind === null));

  const floorLine = rows.find((r) => r.model === "TSP_RB016");
  assert.ok(floorLine.elements.every((e) => e.kind === "room"));
  assert.ok(floorLine.elements.every((e) => e.level));

  // The implied foundation is a recipe row: nobody drew it, nothing to select.
  const foundationLine = rows.find((r) => r.model === "TSP_CON052");
  assert.ok(foundationLine.elements.every((e) => e.kind === null));
});

test("a directly-drawn wall segment is selectable, unlike a room-derived one", () => {
  const doc = twoRoomDoc();
  doc.segments.push({
    id: "drawn1", sku: "TSP_MAS009", x1: 0, y1: -0.4, x2: 4, y2: -0.4, status: "planned",
  });
  const out = compile(doc, pack);
  const drawnRow = out.instances.find((r) => r.elementId === "drawn1");
  assert.equal(drawnRow.kind, "segment");

  const roomDerivedRow = out.instances.find((r) => r.model === "TSP_MAS009" && r.elementId !== "drawn1");
  assert.equal(roomDerivedRow.kind, null);
});

test("boqRows prices what the rate book states, and leaves the rest as null, never 0", () => {
  const out = compile(twoRoomDoc(), pack);
  const rows = boqRows(out, rateBook);

  const wallLine = rows.find((r) => r.model === "TSP_MAS009");
  assert.equal(wallLine.priced, true);
  assert.equal(wallLine.rate, 4250);
  assert.equal(Math.round(wallLine.amount), Math.round(wallLine.qty * 4250));

  // The implied foundation (TSP_CON052) is also in the rate book.
  const foundationLine = rows.find((r) => r.model === "TSP_CON052");
  assert.ok(foundationLine, "expected an implied foundation line");
  assert.equal(foundationLine.priced, true);
});

test("boqRows never invents a rate for an unpriced SKU", () => {
  const out = compile(twoRoomDoc(), pack);
  const emptyRateBook = { currency: "ZAR", symbol: "R", rates: [] };
  const rows = boqRows(out, emptyRateBook);
  for (const row of rows) {
    assert.equal(row.priced, false);
    assert.equal(row.rate, null);
    assert.equal(row.amount, null);
  }
});

test("boqRows works with no rate book at all", () => {
  const out = compile(twoRoomDoc(), pack);
  const rows = boqRows(out, null);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.priced, false);
});

test("scheduleTotal sums only priced lines", () => {
  const out = compile(twoRoomDoc(), pack);
  const rows = boqRows(out, rateBook);
  const expected = rows.reduce((sum, row) => sum + (row.amount || 0), 0);
  assert.equal(scheduleTotal(rows), expected);
  assert.ok(scheduleTotal(rows) > 0);
});
