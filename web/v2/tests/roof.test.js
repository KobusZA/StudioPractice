import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { area, bbox, offsetPolygonOutward } from "../geom.js";
import { emptyDoc, normalizeDoc, rectShape, shapePolygon, PlanStore } from "../model.js";
import { copySelection, mirrorSelection, rotateSelection, splitSelection } from "../modify.js";
import { footprintFace, footprintOuterFace, syncRoomBounds } from "../room-bound.js";
import {
  applyRoofOverhang,
  normalizeRoofForm,
  normalizeRoofRidge,
  roofEdgeFromBase,
  roofGuideLines,
  roofHasBase,
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

function roundMm(poly) {
  return poly.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

/** Same ring, starting at the lowest corner, so winding order can be compared. */
function canon(poly) {
  const rounded = roundMm(poly);
  let best = 0;
  for (let i = 1; i < rounded.length; i += 1) {
    const p = rounded[i];
    const q = rounded[best];
    if (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) best = i;
  }
  return rounded.slice(best).concat(rounded.slice(0, best));
}

test("offsetPolygonOutward grows a box by the overhang on every side", () => {
  const box = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const edge = offsetPolygonOutward(box, 0.6);
  assert.ok(edge);
  const span = bbox(edge);
  assert.ok(Math.abs(span.w - 11.2) < 1e-6);
  assert.ok(Math.abs(span.h - 9.2) < 1e-6);
  assert.ok(Math.abs(area(edge) - 11.2 * 9.2) < 1e-6);
});

test("offsetPolygonOutward grows an L and refuses a notch the overhang closes", () => {
  const l = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 10], [0, 10]];
  const grown = offsetPolygonOutward(l, 0.6);
  assert.ok(grown);
  assert.ok(area(grown) > area(l));
  // A slot 1 m wide. 600 mm each side crosses in the slot.
  const notched = [[0, 0], [8, 0], [8, 6], [0, 6], [0, 3.5], [5, 3.5], [5, 2.5], [0, 2.5]];
  assert.equal(offsetPolygonOutward(notched, 0.6), null);
  assert.ok(offsetPolygonOutward(notched, 0.2));
});

test("offsetPolygonOutward does not care about click order", () => {
  const ccw = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const cw = [[0, 0], [0, 8], [10, 8], [10, 0]];
  assert.deepEqual(canon(offsetPolygonOutward(ccw, 0.6)), canon(offsetPolygonOutward(cw, 0.6)));
});

test("a roof edge is the anchors pushed out, and the plan area is that edge", () => {
  const base = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const edge = roofEdgeFromBase(base, 600);
  const span = bbox(edge);
  assert.ok(Math.abs(span.w - 11.2) < 1e-6);
  assert.ok(Math.abs(span.h - 9.2) < 1e-6);
  const areas = roofPlanAreas(edge, []);
  assert.ok(Math.abs(areas.gross - 11.2 * 9.2) < 1e-6);
  assert.ok(Math.abs(areas.retained - areas.gross) < 1e-9);
});

test("raising the overhang keeps the anchors, and undo puts the edge back", () => {
  const pack = normalizePackUnits(JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))));
  const base = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const doc = emptyDoc();
  doc.roofs.push({
    id: "rf",
    sku: pack.system.defaultRoofSku,
    level: pack.levels[0].id,
    form: "gable",
    pitch: 30,
    base: { kind: "poly", points: base },
    overhang: 600,
    shape: { kind: "poly", points: roofEdgeFromBase(base, 600) },
  });
  const store = new PlanStore(doc);
  const before = JSON.stringify(doc.roofs[0].base);
  store.pushUndo("Set the overhang");
  assert.equal(applyRoofOverhang(doc.roofs[0], 900), true);
  assert.equal(JSON.stringify(doc.roofs[0].base), before);
  assert.ok(Math.abs(bbox(shapePolygon(doc.roofs[0].shape)).w - 11.8) < 1e-6);
  assert.equal(store.undo(), true);
  const restored = store.doc.roofs[0];
  assert.equal(restored.overhang, 600);
  assert.ok(Math.abs(bbox(shapePolygon(restored.shape)).w - 11.2) < 1e-6);
});

test("an overhang that folds is refused and the old edge stays", () => {
  const notched = [[0, 0], [8, 0], [8, 6], [0, 6], [0, 3.5], [5, 3.5], [5, 2.5], [0, 2.5]];
  const roof = {
    base: { kind: "poly", points: notched.map(([x, y]) => [x, y]) },
    overhang: 200,
    shape: { kind: "poly", points: roofEdgeFromBase(notched, 200) },
  };
  const before = JSON.stringify(roof);
  assert.equal(applyRoofOverhang(roof, 600), false);
  assert.equal(JSON.stringify(roof), before);
});

test("a roof saved with no base keeps its outline, its area and an overhang of 0", () => {
  const pack = normalizePackUnits(JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))));
  const raw = {
    schema: "sp.doc/2",
    roofs: [{
      id: "rf1",
      sku: pack.system.defaultRoofSku,
      level: pack.levels[0].id,
      form: "gable",
      pitch: 30,
      shape: rectShape(0, 0, 10, 8),
    }],
  };
  const doc = normalizeDoc(raw);
  assert.equal(roofHasBase(doc.roofs[0]), false);
  assert.equal(doc.roofs[0].shape.kind, "rect");
  assert.equal(doc.roofs[0].shape.w, 10);
  const payload = compile(doc, pack);
  const form = payload.sketchForms.find((item) => item.elementId === "rf1");
  assert.equal(form.elevation, pack.system.wallHeight);
  assert.equal(form.plate, pack.system.wallHeight);
  const areas = roofPlanAreas(shapePolygon(doc.roofs[0].shape), []);
  assert.equal(areas.gross, 80);
  assert.equal(applyRoofOverhang(doc.roofs[0], 600), true);
  assert.equal(roofHasBase(doc.roofs[0]), true);
  assert.ok(Math.abs(bbox(shapePolygon(doc.roofs[0].shape)).w - 11.2) < 1e-6);
});

test("clicking inside the external walls bears on the same outside corners", () => {
  const pack = normalizePackUnits(JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))));
  const half = 0.11;
  const doc = emptyDoc();
  doc.segments = [
    { id: "s", sku: pack.system.defaultWallSku, level: pack.levels[0].id, x1: half, y1: half, x2: 10 - half, y2: half },
    { id: "e", sku: pack.system.defaultWallSku, level: pack.levels[0].id, x1: 10 - half, y1: half, x2: 10 - half, y2: 8 - half },
    { id: "n", sku: pack.system.defaultWallSku, level: pack.levels[0].id, x1: 10 - half, y1: 8 - half, x2: half, y2: 8 - half },
    { id: "w", sku: pack.system.defaultWallSku, level: pack.levels[0].id, x1: half, y1: 8 - half, x2: half, y2: half },
  ];
  const outer = footprintOuterFace(doc, pack, pack.levels[0].id, 5, 4);
  const inner = footprintFace(doc, pack, pack.levels[0].id, 5, 4);
  assert.ok(outer && inner);
  const outerBox = bbox(outer);
  const innerBox = bbox(inner);
  assert.ok(Math.abs(outerBox.w - 10) < 0.02, "outside face is the 10 m box");
  assert.ok(Math.abs(outerBox.h - 8) < 0.02);
  assert.ok(innerBox.w < outerBox.w - 0.2);
  const edge = roofEdgeFromBase(outer, 600);
  const span = bbox(edge);
  assert.ok(Math.abs(span.w - 11.2) < 0.03);
  assert.ok(Math.abs(span.h - 9.2) < 0.03);
  doc.roofs.push({
    id: "rf",
    sku: pack.system.defaultRoofSku,
    level: pack.levels[0].id,
    form: "gable",
    pitch: 30,
    bound: true,
    link: "footprint",
    seed: { x: 5, y: 4 },
    overhang: 600,
    shape: rectShape(0, 0, 1, 1),
  });
  syncRoomBounds(doc, pack);
  const followed = bbox(shapePolygon(doc.roofs[0].shape));
  assert.ok(Math.abs(followed.w - span.w) < 0.03);
  assert.ok(roofHasBase(doc.roofs[0]));
});

test("copy and mirror keep the anchors, the overhang and the plate height", () => {
  const base = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const doc = emptyDoc();
  doc.roofs.push({
    id: "rf",
    form: "gable",
    pitch: 30,
    overhang: 600,
    offset: 150,
    base: { kind: "poly", points: base },
    shape: { kind: "poly", points: roofEdgeFromBase(base, 600) },
  });
  const copied = copySelection(doc, [{ kind: "roof", id: "rf" }]);
  assert.equal(copied.ok, true);
  const twin = doc.roofs.find((roof) => roof.id !== "rf");
  assert.equal(twin.overhang, 600);
  assert.equal(twin.offset, 150);
  assert.ok(twin.base.points[0][0] !== base[0][0]);
  assert.ok(Math.abs(bbox(shapePolygon(twin.shape)).w - 11.2) < 1e-6);
  const dx = twin.base.points[0][0] - doc.roofs.find((roof) => roof.id === "rf").base.points[0][0];
  assert.ok(Math.abs((twin.shape.points[0][0] - doc.roofs[0].shape.points[0][0]) - dx) < 1e-6);

  mirrorSelection(doc, [{ kind: "roof", id: "rf" }]);
  const mirrored = doc.roofs.find((roof) => roof.id === "rf");
  assert.equal(mirrored.overhang, 600);
  assert.equal(mirrored.offset, 150);
  assert.equal(mirrored.base.kind, "poly");
  assert.ok(mirrored.base.points.length === 4);
  assert.ok(Math.abs(bbox(shapePolygon(mirrored.shape)).w - 11.2) < 1e-6);
});
