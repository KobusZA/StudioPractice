import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeDoc } from "../model.js";
import { compile } from "../compile.js";
import { viewFaceStyle } from "../massing.js";
import {
  FIGURE_SIZE,
  billboardRight,
  figureFaces,
  figureFootprint,
  figureNose,
  scaleFigurePair,
} from "../scale-figures.js";
import { normalizePackUnits } from "../schema.js";
import { readFileSync } from "node:fs";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

test("a person stands 1.8 m and faces the orbit camera", () => {
  assert.deepEqual(billboardRight({ mode: "orbit", yaw: 0 }), [1, 0]);
  const faces = figureFaces({ id: "p", kind: "person", x: 2, y: 3, z: 1 }, { mode: "orbit", yaw: 0 });
  assert.equal(faces.length, 1);
  const zs = faces[0].pts.map((p) => p[2]);
  assert.ok(Math.abs(Math.min(...zs) - 1) < 1e-6);
  assert.ok(Math.abs(Math.max(...zs) - (1 + FIGURE_SIZE.person.height)) < 1e-6);
  assert.ok(faces[0].pts.every((p) => Math.abs(p[1] - 3) < 1e-6), "the silhouette is flat toward the camera");
});

test("a car is a 4.7 by 1.8 m outline with a nose", () => {
  const fig = { id: "c", kind: "car", x: 0, y: 0, rotation: 0, z: 0 };
  const foot = figureFootprint(fig);
  const xs = foot.map((p) => p[0]);
  const ys = foot.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - FIGURE_SIZE.car.width) < 1e-6);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - FIGURE_SIZE.car.length) < 1e-6);
  const nose = figureNose(fig);
  assert.ok(nose[1][1] > nose[0][1]);
  const faces = figureFaces(fig, { mode: "orbit", yaw: 0.4 });
  assert.ok(faces.length > 2);
  assert.ok(faces.every((f) => f.selectKind === "figure" && f.id === "c"));
  const top = Math.max(...faces.flatMap((f) => f.pts.map((p) => p[2])));
  assert.ok(Math.abs(top - FIGURE_SIZE.car.height) < 0.05);
});

test("people and cars are kept on the document and left out of quantities", () => {
  const doc = normalizeDoc({
    figures: [
      { id: "p1", kind: "person", x: 1, y: 2, rotation: 90 },
      { kind: "tree", x: 0, y: 0 },
      { kind: "car", x: "no", y: 1 },
    ],
  });
  assert.equal(doc.figures.length, 1);
  assert.equal(doc.figures[0].kind, "person");
  assert.equal(doc.figures[0].status, "mixed");
  assert.equal(doc.figures[0].rotation, 90);
  const out = compile(doc, pack);
  const rows = out.instances || out.rows || [];
  assert.equal(rows.some((row) => row.id === "p1" || row.elementId === "p1"), false);
});

test("lines and existing/new restyle a wall without touching a scale figure", () => {
  const wall = { kind: "wall", status: "existing", pts: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] };
  const lines = viewFaceStyle(wall, "lines");
  assert.equal(lines.flat, true);
  assert.equal(lines.fill, "rgb(252, 249, 244)");
  const phased = viewFaceStyle({ ...wall, status: "planned" }, "status");
  assert.match(phased.fill, /196,\s*112,\s*58/);
  const kept = viewFaceStyle({ ...wall, status: "existing" }, "status");
  assert.match(kept.fill, /138,\s*132,\s*124/);
  const figure = viewFaceStyle({ kind: "figure", fill: "rgba(90,84,76,0.1)", stroke: "#4a453f" }, "status");
  assert.equal(figure.flat, true);
  assert.equal(figure.fill, "rgba(90,84,76,0.1)");
  const colour = viewFaceStyle(wall, "colour");
  assert.equal(colour.flat, undefined);
});

test("turning people and cars on stands them just outside the building", () => {
  const pair = scaleFigurePair({ x: 0, y: 0, w: 10, h: 8 }, "G");
  assert.deepEqual(pair.map((fig) => fig.kind), ["person", "car"]);
  assert.ok(pair.every((fig) => fig.x > 10), "both stand clear of the building");
  assert.equal(pair[0].level, "G");
  const car = figureFootprint({ ...pair[1], id: "c" });
  assert.ok(Math.min(...car.map((p) => p[0])) > 10);
});

test("a person footprint is a small mark around the point", () => {
  const foot = figureFootprint({ kind: "person", x: 5, y: 6 });
  assert.ok(foot.length >= 8);
  assert.ok(foot.every(([x, y]) => Math.hypot(x - 5, y - 6) < 0.25));
});
