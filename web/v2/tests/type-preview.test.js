import { test } from "node:test";
import assert from "node:assert/strict";

import { mmLabel, planPreviewLayout, sanitaryPreview } from "../type-preview.js";

function sku(name, geometry, category = "sanitary") {
  return { category, name, family: name, geometry };
}

test("a close-coupled WC is a tall cistern with a lower pan", () => {
  const preview = sanitaryPreview(sku("TSP Closed Couple WC — Closed Couple", {
    width: 0.507, depth: 0.793, height: 0.705,
  }));
  assert.equal(preview.kind, "wc");
  assert.equal(preview.againstWall, true);
  assert.equal(preview.height, 0.705);
  assert.equal(preview.solids.length, 2);
  const tops = preview.solids.map((s) => s.z1).sort((a, b) => b - a);
  assert.equal(tops[0], 0.705);
  assert.ok(tops[1] < 0.45);
  assert.ok(tops[1] > 0.3);
  const pan = preview.solids.find((s) => s.z1 === tops[1]);
  const cistern = preview.solids.find((s) => s.z1 === tops[0]);
  assert.equal(pan.smooth, true);
  assert.equal(cistern.smooth, false);
});

test("a free-standing tub is an oval at its own height, with no wall edge", () => {
  const preview = sanitaryPreview(sku("TSP_Tub-Free Standing-3D — 760 x 1525mm", {
    width: 0.76, depth: 1.525, height: 0.46,
  }));
  assert.equal(preview.kind, "bath-free");
  assert.equal(preview.againstWall, false);
  assert.equal(preview.solids.length, 1);
  assert.equal(preview.solids[0].z1, 0.46);
  assert.equal(preview.solids[0].smooth, true);
  assert.ok(preview.solids[0].loop.length > 10);
  assert.ok(preview.marks.some((m) => m.part.op === "ellipse"));
});

test("a shower is a low tray with an enclosure up to the type height", () => {
  const preview = sanitaryPreview(sku("Shower Stall - Rectangular — 915 mmx915 mm", {
    width: 0.915, depth: 0.915, height: 1.524,
  }));
  assert.equal(preview.kind, "shower");
  assert.ok(preview.solids[0].z1 < 0.15);
  assert.equal(preview.frame.z1, 1.524);
  assert.ok(preview.marks.some((m) => m.part.op === "line"));
});

test("a washer carries its door on the front face", () => {
  const preview = sanitaryPreview(sku("TSP Washing Machine — Washing Machine", {
    width: 0.594, depth: 0.639, height: 0.845,
  }));
  assert.equal(preview.kind, "washer");
  assert.equal(preview.frontCircles.length, 2);
  assert.ok(preview.frontCircles.every((c) => c.y === 0.639));
  assert.equal(preview.marks.length, 0);
});

test("only sanitary types with a symbol get a preview", () => {
  assert.equal(sanitaryPreview(sku("Desk", { width: 1, depth: 0.6 }, "furniture")), null);
  assert.equal(sanitaryPreview(sku("TSP_Dishwasher — 600mm", { width: 0.6, depth: 0.6 }, "casework")), null);
  assert.equal(sanitaryPreview(sku("Mystery fitting", { width: 0.5, depth: 0.5 })), null);
});

test("the plan symbol is dimensioned outside its own box", () => {
  const preview = sanitaryPreview(sku("TSP_Tub-Free Standing-3D — 760 x 1525mm", {
    width: 0.76, depth: 1.525, height: 0.46,
  }));
  const layout = planPreviewLayout(preview, 640, 480);
  assert.equal(layout.widthLabel.text, mmLabel(0.76));
  assert.equal(layout.depthLabel.text, "1525 mm");
  assert.ok(Math.abs(layout.symW / layout.symH - 0.76 / 1.525) < 1e-6);
  assert.ok(layout.widthLabel.y1 > layout.y + layout.symH);
  assert.ok(layout.depthLabel.x1 > layout.x + layout.symW);
  assert.equal(layout.wallLabel, null);
});

test("a WC plan marks the wall side", () => {
  const preview = sanitaryPreview(sku("Closed Couple WC", { width: 0.507, depth: 0.793, height: 0.705 }));
  const layout = planPreviewLayout(preview, 500, 400);
  assert.equal(layout.wallLabel.text, "wall");
  assert.ok(layout.wallLabel.y < layout.y);
});
