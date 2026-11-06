import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { emptyDoc, rectShape, shapePolygon, PlanStore } from "../model.js";
import { copySelection, rotateSelection, splitSelection } from "../modify.js";
import {
  normalizeRoofForm,
  normalizeRoofRidge,
  roofGuideLines,
  roofPlanAreas,
  roofRidgeAlongX,
} from "../roof.js";
import { normalizePackUnits } from "../schema.js";

test("normalizeRoofForm falls back to flat for unknown values", () => {
  assert.equal(normalizeRoofForm("gable"), "gable");
  assert.equal(normalizeRoofForm("HIP"), "hip");
  assert.equal(normalizeRoofForm("pyramid"), "flat");
  assert.equal(normalizeRoofForm(null), "flat");
});

test("normalizeRoofRidge is long unless explicitly short", () => {
  assert.equal(normalizeRoofRidge("short"), "short");
  assert.equal(normalizeRoofRidge("long"), "long");
  assert.equal(normalizeRoofRidge(undefined), "long");
});

test("roofRidgeAlongX follows the long side by default", () => {
  // Wider than tall: long side is X.
  assert.equal(roofRidgeAlongX({ w: 8, h: 4 }, "long"), true);
  assert.equal(roofRidgeAlongX({ w: 8, h: 4 }, "short"), false);
  // Taller than wide: long side is Y.
  assert.equal(roofRidgeAlongX({ w: 4, h: 8 }, "long"), false);
  assert.equal(roofRidgeAlongX({ w: 4, h: 8 }, "short"), true);
});

test("a flat roof has no construction lines", () => {
  assert.deepEqual(roofGuideLines({ x: 0, y: 0, w: 8, h: 4 }, "flat", "long"), []);
});

test("a gable draws one ridge along the long side", () => {
  const lines = roofGuideLines({ x: 0, y: 0, w: 8, h: 4 }, "gable", "long");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "ridge");
  assert.equal(lines[0].x1, 0);
  assert.equal(lines[0].y1, 2);
  assert.equal(lines[0].x2, 8);
  assert.equal(lines[0].y2, 2);
});

test("a gable on the short side runs the ridge across the span", () => {
  const lines = roofGuideLines({ x: 0, y: 0, w: 8, h: 4 }, "gable", "short");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "ridge");
  assert.equal(lines[0].x1, 4);
  assert.equal(lines[0].y1, 0);
  assert.equal(lines[0].x2, 4);
  assert.equal(lines[0].y2, 4);
});

test("a shed marks the high edge and the fall direction", () => {
  const lines = roofGuideLines({ x: 1, y: 2, w: 6, h: 3 }, "shed", "long");
  assert.equal(lines.map((l) => l.kind).join(","), "high,fall");
  const high = lines[0];
  assert.equal(high.y1, 2);
  assert.equal(high.y2, 2);
  const fall = lines[1];
  assert.equal(fall.x1, fall.x2);
  assert.equal(fall.x1, 4);
});

test("a hip draws a ridge and four hips from the corners", () => {
  const lines = roofGuideLines({ x: 0, y: 0, w: 8, h: 4 }, "hip", "long");
  const kinds = lines.map((l) => l.kind);
  assert.equal(kinds.filter((k) => k === "ridge").length, 1);
  assert.equal(kinds.filter((k) => k === "hip").length, 4);
  const ridge = lines.find((l) => l.kind === "ridge");
  // Inset is min(w,h)/2 = 2, so the ridge runs from x=2 to x=6 at mid-Y.
  assert.equal(ridge.x1, 2);
  assert.equal(ridge.x2, 6);
  assert.equal(ridge.y1, 2);
});

test("a square hip collapses the ridge to a point and keeps the four hips", () => {
  const lines = roofGuideLines({ x: 0, y: 0, w: 4, h: 4 }, "hip", "long");
  assert.equal(lines.every((l) => l.kind === "hip"), true);
  assert.equal(lines.length, 4);
});

function rectPoly(x, y, w, h) {
  return shapePolygon(rectShape(x, y, w, h));
}

test("a hole reduces retained roof area and a cut outside the outline does not", () => {
  const host = rectPoly(0, 0, 10, 4);
  const open = roofPlanAreas(host, [{ kind: "hole", poly: rectPoly(1, 1, 2, 2) }]);
  assert.equal(open.gross, 40);
  assert.equal(open.cut, 4);
  assert.equal(open.retained, 36);
  const missed = roofPlanAreas(host, [{ kind: "remove", poly: rectPoly(20, 20, 2, 2) }]);
  assert.equal(missed.retained, 40);
});

test("overlapping cuts are subtracted once", () => {
  const host = rectPoly(0, 0, 10, 4);
  const areas = roofPlanAreas(host, [
    { kind: "hole", poly: rectPoly(0, 0, 4, 4) },
    { kind: "remove", poly: rectPoly(2, 0, 4, 4) },
  ]);
  assert.equal(areas.cut, 24);
  assert.equal(areas.retained, 16);
});

test("scheduled roof area is what remains after the cut", () => {
  const pack = normalizePackUnits(JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))));
  const doc = emptyDoc();
  doc.roofs.push({
    id: "rf1",
    sku: "TSP_RC003",
    level: pack.levels[0].id,
    form: "flat",
    status: "existing",
    shape: rectShape(0, 0, 10, 4),
    cuts: [{ id: "c1", kind: "remove", shape: rectShape(0, 0, 2, 4) }],
  });
  const row = compile(doc, pack).instances.find((item) => item.elementId === "rf1");
  assert.equal(row.area, 32);
});

test("moving, copying and splitting a roof keeps the cut with the roof", () => {
  const doc = emptyDoc();
  doc.roofs.push({
    id: "rf",
    form: "gable",
    shape: rectShape(0, 0, 8, 4),
    cuts: [{ id: "c1", kind: "hole", shape: rectShape(1, 1, 1, 1) }],
  });
  const store = new PlanStore(doc);
  store.selectOne({ kind: "roof", id: "rf" });
  store.applyMoveSnapshot(store.snapshotMoveTargets(store.selected), 3, 0, null);
  assert.equal(doc.roofs[0].shape.x, 3);
  assert.equal(doc.roofs[0].cuts[0].shape.x, 4);

  doc.roofs[0].shape = rectShape(0, 0, 8, 4);
  doc.roofs[0].cuts[0].shape = rectShape(1, 1, 1, 1);
  const copied = copySelection(doc, [{ kind: "roof", id: "rf" }]);
  assert.equal(copied.ok, true);
  const twin = doc.roofs.find((roof) => roof.id !== "rf");
  assert.notEqual(twin.cuts[0].id, "c1");
  assert.ok(twin.cuts[0].shape.x > 1);

  rotateSelection(doc, [{ kind: "roof", id: "rf" }]);
  assert.notEqual(doc.roofs.find((roof) => roof.id === "rf").cuts[0].shape.x, 1);

  doc.roofs[0].shape = rectShape(0, 0, 8, 4);
  doc.roofs[0].cuts = [
    { id: "left", kind: "hole", shape: rectShape(1, 1, 1, 1) },
    { id: "right", kind: "remove", shape: rectShape(6, 1, 1, 1) },
  ];
  const split = splitSelection(doc, [{ kind: "roof", id: "rf" }]);
  assert.equal(split.ok, true);
  const halves = doc.roofs.filter((roof) => roof.id === "rf" || roof.id === split.refs[1].id);
  assert.equal(halves.length, 2);
  assert.ok(halves.every((roof) => roof.cuts.length === 1));
  const kinds = halves.map((roof) => roof.cuts[0].kind).sort();
  assert.deepEqual(kinds, ["hole", "remove"]);
});
