import { test } from "node:test";
import assert from "node:assert/strict";

import { facesFromPayload } from "../massing.js";
import { compile } from "../compile.js";
import { normalizeDoc, rectShape } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { readFileSync } from "node:fs";
import {
  sectionFromClicks,
  clipFacesForSection,
  clipPolyHalfspace,
  sectionUV,
  SECTION_FAR_M,
} from "../section.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

test("a section looks left of the stroke, not along it", () => {
  const cut = sectionFromClicks([0, 0], [4, 0]);
  assert.ok(cut);
  assert.equal(cut.mode, "section");
  assert.ok(Math.abs(cut.along[0] - 1) < 1e-9);
  assert.ok(Math.abs(cut.look[0]) < 1e-9);
  assert.ok(cut.look[1] > 0.99, "left of +X is +Y");
  assert.equal(cut.far, SECTION_FAR_M);
});

test("drawing the cut the other way flips the look", () => {
  const a = sectionFromClicks([0, 0], [4, 0]);
  const b = sectionFromClicks([4, 0], [0, 0]);
  assert.ok(a.look[1] > 0);
  assert.ok(b.look[1] < 0);
});

test("a zero-length cut is refused rather than invented", () => {
  assert.equal(sectionFromClicks([2, 2], [2, 2]), null);
});

test("geometry behind the cut is clipped off, the cut face is kept", () => {
  const cut = sectionFromClicks([0, 0], [4, 0]);
  const behind = {
    kind: "wall",
    pts: [[0, -1, 0], [4, -1, 0], [4, -1, 2], [0, -1, 2]],
  };
  const onCut = {
    kind: "wall",
    pts: [[0, 0, 0], [4, 0, 0], [4, 0, 2.8], [0, 0, 2.8]],
  };
  const ahead = {
    kind: "wall",
    pts: [[0, 1, 0], [4, 1, 0], [4, 1, 2], [0, 1, 2]],
  };
  const kept = clipFacesForSection([behind, onCut, ahead], cut);
  assert.equal(kept.some((f) => f.pts.every((p) => p[1] < -0.2)), false);
  assert.ok(kept.some((f) => f.cut), "the wall the plane slices is marked as a cut");
  assert.ok(kept.some((f) => f.pts.every((p) => p[1] > 0.5)), "beyond the cut still shows");
});

test("a storey-high wall reads as a rectangle on the section", () => {
  const doc = normalizeDoc({
    rooms: [{
      id: "r1",
      name: "Room",
      level: pack.system.defaultLevel,
      wallSku: pack.system.defaultWallSku,
      status: "planned",
      shape: rectShape(0, 0, 6, 4),
    }],
  });
  const faces = facesFromPayload(compile(doc, pack));
  const cut = sectionFromClicks([1, -1], [1, 5]);
  const kept = clipFacesForSection(faces, cut);
  assert.ok(kept.length > 0, "the cut hits the room");
  const zs = kept.flatMap((f) => f.pts.map((p) => p[2]));
  assert.ok(Math.max(...zs) > 2, "section shows storey height, not a plan sliver");
  const [u0, v0] = sectionUV(kept[0].pts[0], cut);
  assert.ok(Number.isFinite(u0) && Number.isFinite(v0));
});

test("half-space clip inserts the plane hit", () => {
  const pts = [[0, -1, 0], [0, 1, 0], [0, 1, 2], [0, -1, 2]];
  const clipped = clipPolyHalfspace(pts, [0, 0], [0, 1], 0);
  assert.ok(clipped.every((p) => p[1] >= -1e-6));
  assert.ok(clipped.length >= 3);
});
