import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRoofForm,
  normalizeRoofRidge,
  roofGuideLines,
  roofRidgeAlongX,
} from "../roof.js";

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
