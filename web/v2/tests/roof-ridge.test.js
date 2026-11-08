import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { facesFromPayload } from "../massing.js";
import { emptyDoc, normalizeDoc, rectShape } from "../model.js";
import { copySelection, mirrorSelection, rotateSelection } from "../modify.js";
import { gableProfile, roofGuideLines } from "../roof.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);
const TAN30 = Math.tan((30 * Math.PI) / 180);

function near(actual, expected, tol = 1e-6, note = "") {
  assert.ok(Math.abs(actual - expected) <= tol, `${note} expected ${expected}, got ${actual}`);
}

test("a centred gable profile is the plain gable: surface = eave + distance in x tan", () => {
  const prof = gableProfile({ span: 8, pitchDeg: 30 });
  near(prof.ridgeT, 4);
  near(prof.rise, 4 * TAN30);
  for (const t of [0, 1, 3, 4, 5, 7, 8]) near(prof.z(t), (4 - Math.abs(t - 4)) * TAN30, 1e-9, `t=${t}`);
  near(prof.lowWallRise, 0);
  near(prof.highWallRise, 0);
  near(prof.lowDeg, 30, 1e-9);
  near(prof.highDeg, 30, 1e-9);
});

test("a centred gable with an overhang drops the eave by overhang x tan, the walls stay at the plate", () => {
  const prof = gableProfile({ span: 9.2, overhangM: 0.6, pitchDeg: 30 });
  near(prof.z(0), -0.6 * TAN30);
  near(prof.z(0.6), 0, 1e-9);
  near(prof.z(8.6), 0, 1e-9);
  near(prof.rise, 4 * TAN30);
});

test("an off-centre ridge with one pitch raises the wall on the shorter side", () => {
  const prof = gableProfile({ span: 8, pitchDeg: 30, ridgeOffsetMm: 2000 });
  near(prof.ridgeT, 2);
  // The long side keeps the pitch and its wall at the plate.
  near(prof.highWallRise, 0, 1e-9);
  near(prof.rise, 6 * TAN30);
  // The short side has the same pitch, so its wall meets the roof higher up.
  near(prof.lowWallRise, 6 * TAN30 - 2 * TAN30, 1e-9);
  near(prof.lowDeg, 30, 1e-9);
  near(prof.highDeg, 30, 1e-9);
});

test("a second slope sets the other side, and the raise follows it", () => {
  const prof = gableProfile({ span: 8, pitchDeg: 30, pitch2Deg: 45, ridgeOffsetMm: 2000 });
  near(prof.lowDeg, 45, 1e-9);
  near(prof.highDeg, 30, 1e-9);
  near(prof.lowWallRise, 6 * TAN30 - 2 * Math.tan(Math.PI / 4), 1e-9);
  near(prof.highWallRise, 0, 1e-9);
});

test("the ridge cannot leave the span: it is held between 5% and 95%", () => {
  near(gableProfile({ span: 8, pitchDeg: 30, ridgeOffsetMm: 50 }).lowRun, 0.4);
  near(gableProfile({ span: 8, pitchDeg: 30, ridgeOffsetMm: 99000 }).lowRun, 7.6);
  near(gableProfile({ span: 8, pitchDeg: 30, ridgeOffsetMm: -10 }).ridgeT, 4, 1e-9, "a bad value is the middle");
});

test("the ridge is measured from the wall, not from the edge of the overhang", () => {
  const prof = gableProfile({ span: 9.2, overhangM: 0.6, pitchDeg: 30, ridgeOffsetMm: 2000 });
  near(prof.ridgeT, 2.6);
  near(prof.lowRun, 2);
  near(prof.highRun, 6);
});

test("the plan guide line sits where the profile puts the ridge", () => {
  const rect = { x: 0, y: 0, w: 10, h: 8 };
  const centred = roofGuideLines(rect, "gable", "long");
  near(centred[0].y1, 4);
  const moved = roofGuideLines(rect, "gable", "long", { ridgeOffsetMm: 2000 });
  assert.equal(moved.length, 1);
  near(moved[0].y1, 2);
  near(moved[0].x1, 0);
  near(moved[0].x2, 10);
  const across = roofGuideLines({ x: 0, y: 0, w: 10, h: 8 }, "gable", "short", { ridgeOffsetMm: 3000 });
  near(across[0].x1, 3);
  near(across[0].y1, 0);
  near(across[0].y2, 8);
  const withOverhang = roofGuideLines({ x: -0.6, y: -0.6, w: 11.2, h: 9.2 }, "gable", "long", { overhangMm: 600, ridgeOffsetMm: 2000 });
  near(withOverhang[0].y1, 2);
});

function ridgedDoc(extra = {}) {
  return normalizeDoc({
    segments: [
      { id: "n", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 10, y2: 0, status: "planned" },
      { id: "s", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 8, x2: 10, y2: 8, status: "planned" },
    ],
    roofs: [{
      id: "rf1",
      sku: pack.system.defaultRoofSku,
      form: "gable",
      pitch: 30,
      shape: rectShape(0, 0, 10, 8),
      ...extra,
    }],
  });
}

test("plan, 3D and walls agree on where an off-centre ridge is", () => {
  const payload = compile(ridgedDoc({ ridgeOffset: 2000 }), pack);
  const roof = payload.sketchForms.find((f) => f.elementId === "rf1");
  assert.equal(roof.roofRidgeOffset, 2000);
  const plate = roof.plate;
  const ridgeZ = plate + 6 * TAN30;

  const faces = facesFromPayload(payload);
  // 3D: the roof's top edge sits at y = 2.
  const roofTop = faces.filter((f) => f.id === "rf1").flatMap((f) => f.pts).filter((p) => Math.abs(p[2] - ridgeZ) < 1e-6);
  assert.ok(roofTop.length > 0, "the ridge is drawn at the ridge height");
  assert.ok(roofTop.every((p) => Math.abs(p[1] - 2) < 1e-6), "and at 2 m from the top wall");

  // Plan: the guide is where the 3D ridge is.
  const guide = roofGuideLines({ x: 0, y: 0, w: 10, h: 8 }, "gable", "long", { ridgeOffsetMm: 2000 });
  near(guide[0].y1, roofTop[0][1]);

  // Walls: the near wall rises to the roof, the far wall stays at the plate.
  const topOf = (id) => Math.max(...faces.filter((f) => f.id === id).flatMap((f) => f.pts).map((p) => p[2]));
  near(topOf("n"), plate + 6 * TAN30 - 2 * TAN30, 0.12, "the wall by the ridge rises");
  assert.ok(topOf("n") > plate + 1, "it rises well above the plate");
  assert.ok(topOf("s") < plate + 0.12, "the far wall stays at the plate");
});

test("a roof with no ridge offset is built exactly as before", () => {
  const plain = compile(ridgedDoc(), pack).sketchForms.find((f) => f.elementId === "rf1");
  assert.equal(plain.roofRidgeOffset, undefined);
  assert.equal(plain.roofPitch2, undefined);
  const faces = facesFromPayload(compile(ridgedDoc(), pack)).filter((f) => f.id === "rf1").flatMap((f) => f.pts);
  const top = Math.max(...faces.map((p) => p[2]));
  near(top, plain.elevation + 4 * TAN30, 1e-6);
  const ridge = faces.filter((p) => Math.abs(p[2] - top) < 1e-6);
  assert.ok(ridge.every((p) => Math.abs(p[1] - 4) < 1e-6), "the ridge is in the middle");
});

test("a bad ridge offset or second slope is dropped when the job opens", () => {
  const bad = ridgedDoc({ ridgeOffset: -5, pitch2: "steep" });
  assert.equal(bad.roofs[0].ridgeOffset, undefined);
  assert.equal(bad.roofs[0].pitch2, undefined);
  const kept = ridgedDoc({ ridgeOffset: 2500, pitch2: 80 });
  assert.equal(kept.roofs[0].ridgeOffset, 2500);
  assert.equal(kept.roofs[0].pitch2, 60);
});

function bareRoofDoc(extra) {
  const doc = emptyDoc();
  doc.roofs.push({
    id: "rf",
    form: "gable",
    pitch: 30,
    ridge: "long",
    shape: rectShape(0, 0, 10, 8),
    ...extra,
  });
  return doc;
}

test("mirroring across the span moves the ridge to the other side; along the span it stays", () => {
  const across = bareRoofDoc({ ridgeOffset: 2000 });
  mirrorSelection(across, [{ kind: "roof", id: "rf" }], { axis: "h" });
  assert.equal(across.roofs[0].ridgeOffset, 6000);

  const along = bareRoofDoc({ ridgeOffset: 2000 });
  mirrorSelection(along, [{ kind: "roof", id: "rf" }], { axis: "v" });
  assert.equal(along.roofs[0].ridgeOffset, 2000);

  const centred = bareRoofDoc({});
  mirrorSelection(centred, [{ kind: "roof", id: "rf" }], { axis: "h" });
  assert.equal(centred.roofs[0].ridgeOffset, undefined);
});

test("mirroring a roof with an overhang flips the ridge about the walls, not the edge", () => {
  const base = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const doc = bareRoofDoc({
    overhang: 600,
    ridgeOffset: 2000,
    base: { kind: "poly", points: base },
    shape: { kind: "poly", points: [[-0.6, -0.6], [10.6, -0.6], [10.6, 8.6], [-0.6, 8.6]] },
  });
  mirrorSelection(doc, [{ kind: "roof", id: "rf" }], { axis: "h" });
  assert.equal(doc.roofs[0].ridgeOffset, 6000);
});

test("a quarter turn keeps the ridge by the same wall; a half turn puts it on the other side", () => {
  // Ridge along x, so the span is in y and the low wall has the smaller y. A
  // clockwise quarter turn sends small y to small x. The roof is then tall,
  // its ridge runs along y, and the low wall is the one with the smaller x:
  // the same wall as before.
  const quarter = bareRoofDoc({ ridgeOffset: 2000 });
  rotateSelection(quarter, [{ kind: "roof", id: "rf" }], { degrees: 90 });
  assert.equal(quarter.roofs[0].ridgeOffset, 2000);

  // A half turn keeps the ridge along x but swaps top and bottom.
  const half = bareRoofDoc({ ridgeOffset: 2000 });
  rotateSelection(half, [{ kind: "roof", id: "rf" }], { degrees: 180 });
  assert.equal(half.roofs[0].ridgeOffset, 6000);
});

test("a ridge offset copies with the roof", () => {
  const doc = bareRoofDoc({ ridgeOffset: 2000, pitch2: 40 });
  copySelection(doc, [{ kind: "roof", id: "rf" }]);
  const twin = doc.roofs.find((r) => r.id !== "rf");
  assert.equal(twin.ridgeOffset, 2000);
  assert.equal(twin.pitch2, 40);
});
