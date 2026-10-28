import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import {
  createCamera,
  frameCamera,
  groundFacesFromBounds,
  massingLayer,
  clipServiceSegment,
  facesFromPayload,
  faceStyle,
  hatchPolygon,
  strokeFaceEdges,
  lookFromClicks,
  lookAxes,
  projectLookPoint,
  projectPoint,
  EYE_HEIGHT_M,
  LOOK_NEAR,
  MASSING_PITCH_MIN,
  MASSING_PITCH_MAX,
} from "../massing.js";
import { normalizeDoc, rectShape } from "../model.js";
import { sectionFromClicks } from "../section.js";
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

test("the top-down 3D view is the plan, not a mirror of it", () => {
  // Plan y points down the page. A flat view must put the plan's top at the
  // top of the screen and its east on the right, or every window and door
  // lands at the wrong end of its wall.
  const flat = { yaw: 0, pitch: Math.PI / 2 - 0.0001 };
  const o = [5, 10, 0];
  const top = projectPoint(5, 0, 0, o, 0, 0, 10, flat);
  const bottom = projectPoint(5, 20, 0, o, 0, 0, 10, flat);
  const west = projectPoint(0, 10, 0, o, 0, 0, 10, flat);
  const east = projectPoint(10, 10, 0, o, 0, 0, 10, flat);
  assert.ok(top[1] < bottom[1], "plan top is higher on screen than plan bottom");
  assert.ok(east[0] > west[0], "plan east is to the right of plan west");
});

test("orbit depth grows away from the camera", () => {
  const cam = createCamera();
  const origin = [0, 0, 0];
  const here = projectPoint(0, 0, 0, origin, 400, 300, 20, cam);
  // Plan north is -y, so the far side of the ground is negative y.
  const farther = projectPoint(0, -4, 0, origin, 400, 300, 20, cam);
  const higher = projectPoint(0, 0, 2, origin, 400, 300, 20, cam);
  assert.ok(farther[1] < here[1], "farther along the ground sits higher on screen");
  assert.ok(farther[2] > here[2], "that same point has the larger depth");
  assert.ok(higher[2] < here[2], "a higher point is closer when the camera looks down");
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

function jambStrokes(faces, ax, ay, bx, by) {
  const near = (p) => Math.min(Math.hypot(p[0] - ax, p[1] - ay), Math.hypot(p[0] - bx, p[1] - by)) < 0.2;
  const spans = [];
  for (const face of faces) {
    if (face.kind !== "wall") continue;
    const pts = face.pts;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-4) continue;
      if (Math.abs(a[2] - b[2]) < 0.05) continue;
      if (!near(a)) continue;
      const bare = (face.bare || []).some(([p, q]) => {
        const same = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 1e-6;
        return (same(a, p) && same(b, q)) || (same(a, q) && same(b, p));
      });
      if (bare) continue;
      spans.push([Math.min(a[2], b[2]), Math.max(a[2], b[2])]);
    }
  }
  return spans;
}

function openingDoc(sku, openings) {
  return normalizeDoc({
    rooms: [{
      id: "r1",
      name: "Room",
      level: pack.system.defaultLevel,
      wallSku: pack.system.defaultWallSku,
      status: "planned",
      shape: rectShape(0, 0, 6, 4),
    }],
    openings,
  });
}

test("a window's jamb line stops at the opening", () => {
  const sku = pack.skus.find((s) => s.id === "TSP_WN0606");
  const doc = openingDoc(sku, [
    { id: "o1", sku: sku.id, roomId: "r1", edgeIndex: 0, t: 0.5, status: "planned" },
  ]);
  const payload = compile(doc, pack);
  const win = payload.sketchForms.find((f) => (f.kind || "").toLowerCase() === "window");
  assert.ok(win, "window compiled");
  const line = win.profileLoops[0].curves[0];
  const z0 = Number(win.elevation) || 0;
  const sill = z0 + Number(win.sill);
  const head = sill + Number(win.depth);
  const spans = jambStrokes(
    facesFromPayload(payload),
    line.start[0], line.start[1], line.end[0], line.end[1],
  );
  assert.ok(spans.length > 0, "the jamb corner is drawn");
  for (const [lo, hi] of spans) {
    assert.ok(lo >= sill - 0.03, `line continues below the sill (${lo} < ${sill})`);
    assert.ok(hi <= head + 0.03, `line continues above the head (${hi} > ${head})`);
  }
  assert.ok(spans.some(([lo, hi]) => hi - lo > (head - sill) * 0.5), "the opening's own edge is kept");
  assert.ok(facesFromPayload(payload).some((f) => f.kind === "window"));
});

test("a door's jamb line stops at the head", () => {
  const sku = pack.skus.find((s) => s.category === "door");
  const doc = openingDoc(sku, [
    { id: "o1", sku: sku.id, roomId: "r1", edgeIndex: 0, t: 0.5, status: "planned" },
  ]);
  const payload = compile(doc, pack);
  const door = payload.sketchForms.find((f) => (f.kind || "").toLowerCase() === "opening");
  assert.ok(door, "door compiled");
  const line = door.profileLoops[0].curves[0];
  const z0 = Number(door.elevation) || 0;
  const sill = z0 + (Number(door.sill) || 0);
  const head = sill + Number(door.depth);
  const spans = jambStrokes(
    facesFromPayload(payload),
    line.start[0], line.start[1], line.end[0], line.end[1],
  );
  assert.ok(spans.length > 0, "the jamb corner is drawn");
  for (const [lo, hi] of spans) {
    assert.ok(lo >= sill - 0.03, `line continues below the sill (${lo} < ${sill})`);
    assert.ok(hi <= head + 0.03, `line continues above the head (${hi} > ${head})`);
  }
});

test("strokeFaceEdges leaves a coplanar joint undrawn", () => {
  const calls = [];
  const ctx = {
    beginPath() {},
    moveTo(x, y) { calls.push(["m", x, y]); },
    lineTo(x, y) { calls.push(["l", x, y]); },
    closePath() { calls.push(["c"]); },
    stroke() { calls.push(["s"]); },
  };
  const face = {
    pts: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]],
    bare: [[[2, 0, 0], [2, 0, 2]]],
  };
  strokeFaceEdges(ctx, [[0, 0], [2, 0], [2, 2], [0, 2]], face);
  const lines = calls.filter((c) => c[0] === "l").map((c) => [c[1], c[2]]);
  assert.ok(lines.some(([x, y]) => x === 0 && y === 2), "the far corner is stroked");
  assert.equal(lines.some(([x, y]) => x === 2 && y === 2), false, "the seam is not stroked");
});

test("a section keeps the service run on the look side and cuts one that crosses", () => {
  const cut = sectionFromClicks([0, 0], [0, 4]);
  const kept = clipServiceSegment([-1, 1, 0.4], [-1, 3, 1.2], cut);
  assert.deepEqual(kept, [[-1, 1, 0.4], [-1, 3, 1.2]]);
  assert.equal(clipServiceSegment([1, 1, 0.4], [1, 3, 1.2], cut), null);
  const crossed = clipServiceSegment([-1, 2, 1], [1, 2, 3], cut);
  assert.ok(Math.abs(crossed[1][0]) < 1e-9);
  assert.ok(Math.abs(crossed[1][1] - 2) < 1e-9);
  assert.ok(Math.abs(crossed[1][2] - 2) < 1e-9);
  assert.equal(clipServiceSegment([-1, 2, 1], [1, 2, 3], { mode: "orbit" })[0][0], -1);
});
