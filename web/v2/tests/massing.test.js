import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import {
  createCamera,
  frameCamera,
  groundFacesFromBounds,
  massingLayer,
  facesFromPayload,
  faceStyle,
  hatchPolygon,
  lookFromClicks,
  lookAxes,
  projectLookPoint,
  EYE_HEIGHT_M,
  LOOK_NEAR,
  MASSING_PITCH_MIN,
  MASSING_PITCH_MAX,
} from "../massing.js";
import { normalizeDoc, rectShape } from "../model.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

test("grade is a tiled plane at z = 0 around the building bounds", () => {
  const faces = groundFacesFromBounds({ minX: 0, minY: 0, maxX: 2, maxY: 1 });
  assert.ok(faces.length > 1, "tiled, not one huge quad");
  assert.ok(faces.every((f) => f.kind === "ground"));
  assert.ok(faces.every((f) => f.pts.every((p) => p[2] === 0)));
  const xs = faces.flatMap((f) => f.pts.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.pts.map((p) => p[1]));
  assert.ok(Math.min(...xs) <= -1, "pads beyond the building");
  assert.ok(Math.max(...xs) >= 3);
  assert.ok(Math.min(...ys) <= -1);
  assert.ok(Math.max(...ys) >= 2);
});

test("below-grade solids paint before grade, walls after it", () => {
  const footing = { kind: "wall", pts: [[0, 0, -0.6], [1, 0, -0.6], [1, 0, -0.4], [0, 0, -0.4]] };
  const ground = { kind: "ground", pts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] };
  const wall = { kind: "wall", pts: [[0, 0, 0], [1, 0, 0], [1, 0, 2.8], [0, 0, 2.8]] };
  assert.equal(massingLayer(footing), 0);
  assert.equal(massingLayer(ground), 1);
  assert.equal(massingLayer(wall), 2);
});

test("a portrait gable covers the eaves rectangle, not a ridge sliver", () => {
  const doc = normalizeDoc({
    roofs: [{
      id: "rf1",
      sku: pack.system.defaultRoofSku,
      form: "gable",
      pitch: 30,
      ridge: "long",
      status: "planned",
      shape: rectShape(0, 0, 4, 10),
    }],
  });
  const payload = compile(doc, pack);
  const roofForm = (payload.sketchForms || []).find((f) => String(f.kind).toLowerCase() === "roof");
  assert.ok(roofForm, "compile emits a roof form");
  const faces = facesFromPayload(payload).filter((f) => f.kind === "roof");
  assert.ok(faces.length >= 2, "gable has two slopes");
  const xs = faces.flatMap((f) => f.pts.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.pts.map((p) => p[1]));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 3.5, `span in X should be the eaves width, got ${Math.max(...xs) - Math.min(...xs)}`);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 9.5, `run in Y should be the eaves length, got ${Math.max(...ys) - Math.min(...ys)}`);
});

test("default 3D camera looks down over a typical pitched roof", () => {
  const cam = createCamera();
  // 30° is DEFAULT_ROOF_PITCH. Opening above that keeps eaves readable;
  // drag can still drop to an elevation or rise toward plan.
  assert.ok(cam.pitch > (40 * Math.PI) / 180);
  assert.ok(MASSING_PITCH_MIN < (20 * Math.PI) / 180, "orbit can drop toward an elevation");
  assert.ok(MASSING_PITCH_MAX > (80 * Math.PI) / 180, "orbit can rise toward plan");
});

test("a portrait footprint is framed off the long wall, not along the ridge", () => {
  const landscape = frameCamera(createCamera(), { minX: 0, minY: 0, maxX: 8, maxY: 4 });
  const portrait = frameCamera(createCamera(), { minX: 0, minY: 0, maxX: 4, maxY: 8 });
  assert.notEqual(portrait.yaw, landscape.yaw);
  assert.ok(Math.abs((landscape.yaw - portrait.yaw) - Math.PI / 2) < 1e-9);
});

test("a camera look is standing height, toward the second click", () => {
  const look = lookFromClicks([0, 0], [0, 8]);
  assert.ok(look);
  assert.equal(look.mode, "look");
  assert.equal(look.eye[2], EYE_HEIGHT_M);
  assert.ok(Math.abs(look.yaw) < 1e-9, "looking +Y");
  assert.equal(look.pitch, 0);
  const { forward, right } = lookAxes(look);
  assert.ok(Math.abs(forward[0]) < 1e-9);
  assert.ok(forward[1] > 0.99);
  assert.ok(Math.abs(forward[2]) < 1e-9);
  assert.ok(right[0] > 0.99);
});

test("look-from-here puts east to the right and west behind the camera", () => {
  const look = lookFromClicks([0, 0], [0, 10], 1.6);
  const ahead = projectLookPoint(0, 5, 1.6, look, 400, 300, 600);
  const east = projectLookPoint(1, 5, 1.6, look, 400, 300, 600);
  const up = projectLookPoint(0, 5, 2.6, look, 400, 300, 600);
  const behind = projectLookPoint(0, -5, 1.6, look, 400, 300, 600);
  assert.ok(ahead[2] > LOOK_NEAR);
  assert.ok(east[0] > ahead[0], "east is screen-right when looking north");
  assert.ok(up[1] < ahead[1], "above eye is screen-up");
  assert.ok(behind[2] < 0, "behind the eye is not in front");
});

test("a zero-length look is refused rather than invented", () => {
  assert.equal(lookFromClicks([2, 2], [2, 2]), null);
});

// --- faceStyle / hatchPolygon: shared with sheets.js's static section view -

test("faceStyle colours a planned wall copper and an existing one grey", () => {
  const planned = faceStyle({ kind: "wall", status: "planned" });
  const existing = faceStyle({ kind: "wall", status: "existing" });
  assert.equal(planned.stroke, "#b2451e");
  assert.equal(existing.stroke, "#5c5348");
});

test("faceStyle passes a ground face's own fill/stroke through unchanged", () => {
  const ground = { kind: "ground", fill: "rgba(1,2,3,1)", stroke: "#000" };
  assert.deepEqual(faceStyle(ground), { fill: ground.fill, stroke: ground.stroke });
});

function mockCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push("save"); },
    restore() { calls.push("restore"); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() { calls.push("clip"); },
    stroke() { calls.push("stroke"); },
  };
}

test("hatchPolygon clips and strokes a real polygon", () => {
  const ctx = mockCtx();
  hatchPolygon(ctx, [[0, 0], [40, 0], [40, 40], [0, 40]], "#111");
  assert.ok(ctx.calls.includes("clip"));
  assert.ok(ctx.calls.includes("stroke"));
});

test("hatchPolygon skips a near-zero-area (flattened) polygon rather than spraying hatch across its box", () => {
  const ctx = mockCtx();
  hatchPolygon(ctx, [[0, 0], [1, 0], [1, 0.001], [0, 0.001]], "#111");
  assert.equal(ctx.calls.length, 0);
});
