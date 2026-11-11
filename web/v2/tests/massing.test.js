import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { PLAIN_OPENING_SKUS } from "../openings.js";
import { pointInPoly } from "../geom.js";
import { courtyardHouseDoc } from "../picture-plan.js";
import {
  createCamera,
  frameCamera,
  orbitReferenceCameras,
  plateCallouts,
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
  orbitRay,
  rayPlanePoint,
  pickProjected,
  pickServiceHits,
  cycleStackedHits,
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

test("orbit references are the opposite side and a higher roof, and only from orbit", () => {
  const cam = createCamera();
  const shots = orbitReferenceCameras(cam);
  assert.deepEqual(shots.map((shot) => shot.role), ["opposite", "roof"]);
  assert.equal(shots[0].pitch, cam.pitch);
  assert.ok(Math.abs(shots[0].yaw - (cam.yaw + Math.PI)) < 1e-9);
  assert.equal(shots[1].yaw, cam.yaw);
  assert.ok(shots[1].pitch > cam.pitch);
  assert.deepEqual(orbitReferenceCameras({ mode: "look", yaw: 0, pitch: 0.4 }), []);
  assert.deepEqual(orbitReferenceCameras({ mode: "section", yaw: 1, pitch: 1 }), []);
  assert.deepEqual(orbitReferenceCameras({ mode: "elevation", yaw: 0.2, pitch: 0.9 }), []);
  const high = orbitReferenceCameras({ mode: "orbit", yaw: 0.4, pitch: 1.4 });
  assert.deepEqual(high.map((shot) => shot.role), ["opposite"]);
});

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

function covers(faces, x, y) {
  return faces.some((face) => pointInPoly(x, y, face.pts.map((p) => [p[0], p[1]])));
}

test("a square hip with no hole still meets at a point", () => {
  const doc = normalizeDoc({
    roofs: [{
      id: "rf1",
      sku: pack.system.defaultRoofSku,
      form: "hip",
      pitch: 30,
      shape: rectShape(0, 0, 10, 10),
    }],
  });
  const faces = facesFromPayload(compile(doc, pack)).filter((f) => f.kind === "roof");
  assert.ok(covers(faces, 5, 5), "the apex is still roof");
});

test("a courtyard hip stops at the hole instead of closing into a pyramid", () => {
  const doc = normalizeDoc(courtyardHouseDoc());
  assert.equal(doc.segments.length, 8);
  assert.equal(doc.roofs[0].form, "hip");
  assert.equal(doc.roofs[0].cuts.length, 1);
  assert.equal(doc.roofs[0].cuts[0].kind, "hole");
  assert.equal(doc.openings.length, 2);

  const payload = compile(doc, pack);
  const roof = (payload.sketchForms || []).find((f) => String(f.kind).toLowerCase() === "roof");
  assert.ok(roof.roofCuts.length === 1 && roof.roofCuts[0].length >= 4);
  const openings = (payload.sketchForms || []).filter((f) => String(f.kind).toLowerCase() === "opening");
  assert.equal(openings.length, 2);

  const faces = facesFromPayload(payload).filter((f) => f.kind === "roof");
  assert.ok(covers(faces, 5, 1.2), "the eave slope is still there");
  assert.equal(covers(faces, 5, 5), false, "the court is open");
  const apex = faces.some((f) => f.pts.some((p) => Math.hypot(p[0] - 5, p[1] - 5) < 0.3));
  assert.equal(apex, false, "the slopes do not meet over the court");
  const zs = faces.flatMap((f) => f.pts).filter((p) => Math.hypot(p[0] - 3.11, p[1] - 3.11) < 0.05);
  assert.ok(zs.length > 0, "the slope reaches the court corner");
  assert.ok(zs.every((p) => p[2] > 2.8), "the inner edge is above the plate");
});

test("default 3D camera looks down over a typical pitched roof", () => {
  const cam = createCamera();
  // 30° is DEFAULT_ROOF_PITCH. Opening above that keeps eaves readable;
  // drag can still drop to an elevation or rise toward plan.
  assert.ok(cam.pitch > (40 * Math.PI) / 180);
  assert.ok(MASSING_PITCH_MIN < (20 * Math.PI) / 180, "orbit can drop toward an elevation");
  assert.ok(MASSING_PITCH_MAX > (80 * Math.PI) / 180, "orbit can rise toward plan");
});

test("an orbit ray through a pixel hits that model point", () => {
  const cam = { yaw: 0.8, pitch: 0.7 };
  const frame = { origin: [1, 2, 0.5], cx: 400, cy: 300, scale: 36, yaw: cam.yaw, pitch: cam.pitch };
  const world = [4, -1, 2.2];
  const [sx, sy] = projectPoint(world[0], world[1], world[2], frame.origin, frame.cx, frame.cy, frame.scale, cam);
  const ray = orbitRay(sx, sy, frame);
  const flat = rayPlanePoint(ray, world, [0, 0, 1]);
  const wall = rayPlanePoint(ray, world, [1, 0, 0]);
  for (const hit of [flat, wall]) {
    assert.ok(Math.abs(hit[0] - world[0]) < 1e-6);
    assert.ok(Math.abs(hit[1] - world[1]) < 1e-6);
    assert.ok(Math.abs(hit[2] - world[2]) < 1e-6);
  }
});

test("a click hits the front element, then the one behind it", () => {
  const back = { id: "wall", kind: "wall", selectKind: "segment", pts: [[0, 0], [100, 0], [100, 100], [0, 100]] };
  const front = { id: "win", kind: "window", selectKind: "opening", pts: [[20, 20], [60, 20], [60, 70], [20, 70]] };
  const over = pickProjected(40, 40, [back, front]);
  assert.deepEqual(over.map((h) => h.id), ["win", "wall"]);
  assert.equal(over[0].selectKind, "opening");
  assert.equal(pickProjected(80, 80, [back, front])[0].id, "wall");
  assert.equal(pickProjected(200, 200, [back, front]).length, 0);
});

test("repeated clicks on the same stack walk back through it", () => {
  const hits = [
    { id: "win", selectKind: "opening" },
    { id: "wall", selectKind: "segment" },
  ];
  const first = cycleStackedHits(null, hits);
  assert.equal(first.index, 0);
  const second = cycleStackedHits(first, hits);
  assert.equal(second.index, 1);
  assert.equal(second.key, first.key);
  const third = cycleStackedHits(second, hits);
  assert.equal(third.index, 0);
  const moved = cycleStackedHits(second, [hits[1]]);
  assert.equal(moved.index, 0);
  assert.notEqual(moved.key, second.key);
  assert.equal(cycleStackedHits(first, []).index, -1);
});

test("a click on a pipe or a bend is that service, in front of the face behind it", () => {
  const frame = {
    nodes: [{ id: "bend", selectKind: "serviceNode", kind: "service", p: [10, 10] }],
    services: [{ id: "run", selectKind: "serviceEdge", kind: "service", a: [0, 20], b: [40, 20], tol: 6 }],
  };
  const bend = pickServiceHits(10, 12, frame);
  assert.equal(bend[0].id, "bend");
  assert.equal(bend[0].selectKind, "serviceNode");
  const run = pickServiceHits(20, 22, frame);
  assert.equal(run[0].id, "run");
  assert.equal(run[0].selectKind, "serviceEdge");
  assert.equal(pickServiceHits(80, 80, frame).length, 0);
});

test("3D faces remember which document object a click selects", () => {
  const windowSku = pack.skus.find((s) => s.category === "window")?.id;
  const doc = normalizeDoc({
    segments: [{ id: "s1", sku: "TSP_MAS009", x1: 0, y1: 0, x2: 4, y2: 0 }],
    openings: [{ id: "o1", sku: windowSku, wallId: "s1", t: 0.5, status: "planned" }],
    roofs: [{ id: "rf1", sku: pack.system.defaultRoofSku, form: "gable", pitch: 30, shape: rectShape(0, 0, 4, 4) }],
  });
  const faces = facesFromPayload(compile(doc, pack));
  assert.ok(faces.some((f) => f.id === "o1" && f.selectKind === "opening"));
  assert.ok(faces.some((f) => f.id === "s1" && f.selectKind === "segment"));
  assert.ok(faces.some((f) => f.id === "rf1" && f.selectKind === "roof"));
  assert.ok(faces.filter((f) => f.kind === "ground").every((f) => !f.selectKind));
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

test("an arch is a curved head in the 3D model, not its bounding rectangle", () => {
  const src = PLAIN_OPENING_SKUS.find((s) => s.id === "TSP_ARCH");
  const archPack = {
    ...pack,
    skus: [...pack.skus.filter((s) => s.id !== "TSP_ARCH"), {
      ...src,
      geometry: {
        ...src.geometry,
        width: src.geometry.width / 1000,
        height: src.geometry.height / 1000,
        sill: (src.geometry.sill || 0) / 1000,
      },
    }],
  };
  const doc = openingDoc(null, [
    { id: "o1", sku: "TSP_ARCH", roomId: "r1", edgeIndex: 0, t: 0.5, rise: 0.3, status: "planned" },
  ]);
  const payload = compile(doc, archPack);
  const form = payload.sketchForms.find((f) => f.elementId === "o1");
  assert.equal(form?.head, "arch");
  assert.ok(Math.abs(form.rise - 0.3) < 1e-9);
  const line = form.profileLoops[0].curves[0];
  const z0 = Number(form.elevation) || 0;
  const head = z0 + (Number(form.sill) || 0) + Number(form.depth);
  const spring = head - 0.3;
  const faces = facesFromPayload(payload);
  const near = (p, x, y, r) => Math.hypot(p[0] - x, p[1] - y) < r;
  const mid = [(line.start[0] + line.end[0]) / 2, (line.start[1] + line.end[1]) / 2];
  const wallPts = faces.filter((f) => f.kind === "wall").flatMap((f) => f.pts);
  assert.ok(
    wallPts.some((p) => near(p, mid[0], mid[1], 0.25) && Math.abs(p[2] - head) < 0.04),
    "the wall rises to a crown at mid-opening",
  );
  const panel = faces.filter((f) => f.id === "o1").flatMap((f) => f.pts);
  assert.ok(panel.length > 4, "the arch is a solid in the model");
  assert.ok(
    panel.some((p) => near(p, mid[0], mid[1], 0.2) && Math.abs(p[2] - head) < 0.04),
    "the arch panel reaches the crown",
  );
  assert.equal(
    panel.some((p) => near(p, line.start[0], line.start[1], 0.06) && p[2] > spring + 0.08),
    false,
    "the jamb of the arch stops at the spring",
  );
  const spans = jambStrokes(faces, line.start[0], line.start[1], line.end[0], line.end[1]);
  assert.ok(spans.length > 0, "the straight jamb below the spring is drawn");
  for (const [lo, hi] of spans) {
    assert.ok(hi <= spring + 0.05, `a flat head is still drawn above the spring (${hi} > ${spring})`);
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

test("a roof face remembers its eave, so a plate step can be named", () => {
  const doc = normalizeDoc({
    roofs: [{
      id: "rf1",
      sku: pack.system.defaultRoofSku,
      form: "gable",
      pitch: 30,
      ridge: "long",
      status: "existing",
      shape: rectShape(0, 0, 6, 4),
    }],
  });
  const payload = compile(doc, pack);
  const form = (payload.sketchForms || []).find((f) => String(f.kind).toLowerCase() === "roof");
  const faces = facesFromPayload(payload).filter((f) => f.id === "rf1");
  assert.ok(faces.length > 0);
  assert.ok(faces.every((f) => f.eaveZ === form.elevation));
});

test("a wall face takes its colour from the finish on it", () => {
  const doc = normalizeDoc({
    finishSettings: { externalFinish: "facebrick" },
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 4, y2: 0 }],
  });
  const faces = facesFromPayload(compile(doc, pack)).filter((f) => f.kind === "wall" && f.finish);
  assert.ok(faces.length > 0, "the finish colours the wall");
  assert.ok(faces.some((f) => f.fill.includes("164,71,47")), "face brick, not the default terracotta");
  const styled = faceStyle(faces[0]);
  assert.equal(styled.fill, faces[0].fill, "a finish colour is not replaced by the planned-wall tint");
});

test("a curved wall leaves the facet joints undrawn", () => {
  const curved = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 4, y2: 0, arc: { radius: 2.5, side: -1 } }],
  });
  const straight = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 4, y2: 0 }],
  });
  const bare = (doc) => facesFromPayload(compile(doc, pack)).filter((f) => f.kind === "wall" && f.bare?.length);
  assert.ok(bare(curved).length > 0, "the joints between facets are bare");
  assert.equal(bare(straight).length, 0, "a straight wall still strokes its corners");
});

test("a wall under a gable follows the slope, and a low wall stays low", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 5, y1: 0, x2: 5, y2: 8 }],
    roofs: [{ id: "rf1", sku: pack.system.defaultRoofSku, form: "gable", pitch: 30, shape: rectShape(0, 0, 10, 8) }],
  });
  const payload = compile(doc, pack);
  const roof = payload.sketchForms.find((f) => f.elementId === "rf1");
  const rise = 4 * Math.tan((30 * Math.PI) / 180);
  const pts = facesFromPayload(payload).filter((f) => f.id === "w1").flatMap((f) => f.pts);
  const ridge = pts.filter((p) => Math.hypot(p[0] - 5, p[1] - 4) < 0.2);
  assert.ok(ridge.some((p) => Math.abs(p[2] - (roof.elevation + rise)) < 0.15), "the wall rises to the ridge");
  const above = pts.filter((p) => {
    const allowed = roof.elevation + (4 - Math.abs(p[1] - 4)) * Math.tan((30 * Math.PI) / 180) + 0.05;
    return p[2] > allowed;
  });
  assert.equal(above.length, 0, "nothing sticks through the slope");

  const low = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 5, y1: 0, x2: 5, y2: 8, height: 1.1 }],
    roofs: [{ id: "rf1", sku: pack.system.defaultRoofSku, form: "gable", pitch: 30, shape: rectShape(0, 0, 10, 8) }],
  });
  const lowPts = facesFromPayload(compile(low, pack)).filter((f) => f.id === "w1").flatMap((f) => f.pts);
  assert.ok(Math.max(...lowPts.map((p) => p[2])) < 1.3, "a low wall is not stretched up to the roof");
});

test("a gable-end wall follows the ridge on the face outside the plate", () => {
  const doc = normalizeDoc({
    segments: [
      { id: "w", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 0, y2: 6, status: "planned" },
      { id: "s", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 8, y2: 0, status: "existing" },
    ],
    roofs: [{ id: "rf1", sku: pack.system.defaultRoofSku, form: "gable", pitch: 30, shape: rectShape(0, 0, 8, 6) }],
  });
  const payload = compile(doc, pack);
  const roof = payload.sketchForms.find((f) => f.elementId === "rf1");
  const rise = 3 * Math.tan((30 * Math.PI) / 180);
  const ridgeZ = roof.elevation + rise;
  const pts = facesFromPayload(payload).filter((f) => f.id === "w").flatMap((f) => f.pts);
  const outerRidge = pts.filter((p) => p[0] < -0.05 && Math.abs(p[1] - 3) < 0.15 && p[2] > roof.elevation);
  assert.ok(outerRidge.length > 0, "the outside face is split at the ridge");
  assert.ok(outerRidge.every((p) => Math.abs(p[2] - ridgeZ) < 0.15), "the outside face rises to the ridge");
  const above = pts.filter((p) => {
    const y = Math.min(6, Math.max(0, p[1]));
    const allowed = roof.elevation + (3 - Math.abs(y - 3)) * Math.tan((30 * Math.PI) / 180) + 0.05;
    return p[2] > allowed;
  });
  assert.equal(above.length, 0, "nothing on the gable end sticks through the slope");

  const side = facesFromPayload(payload).filter((f) => f.id === "s").flatMap((f) => f.pts);
  const stuck = side.filter((p) => p[2] > roof.elevation + 0.2);
  assert.equal(stuck.length, 0, "the eave wall stays at the plate");
});

function wallBox(pack) {
  const level = pack.levels[0].id;
  const sku = pack.system.defaultWallSku;
  const half = 0.11;
  const seg = (id, x1, y1, x2, y2) => ({ id, sku, level, x1, y1, x2, y2, status: "planned" });
  return [
    seg("south", half, half, 10 - half, half),
    seg("east", 10 - half, half, 10 - half, 8 - half),
    seg("north", 10 - half, 8 - half, half, 8 - half),
    seg("west", half, 8 - half, half, half),
  ];
}

test("the eave drops by the overhang and the long walls stay at the plate", () => {
  const base = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const tan = Math.tan((30 * Math.PI) / 180);
  const plate = pack.system.wallHeight;
  const eave = plate - 0.6 * tan;
  const doc = normalizeDoc({
    segments: wallBox(pack),
    roofs: [{
      id: "rf1",
      sku: pack.system.defaultRoofSku,
      level: "01 GFL",
      form: "gable",
      pitch: 30,
      overhang: 600,
      base: { kind: "poly", points: base },
      shape: { kind: "poly", points: base.map(([x, y]) => [x + (x === 0 ? -0.6 : 0.6), y + (y === 0 ? -0.6 : 0.6)]) },
    }],
  });
  const payload = compile(doc, pack);
  const roof = payload.sketchForms.find((f) => f.elementId === "rf1");
  assert.ok(Math.abs(roof.plate - plate) < 1e-6);
  assert.ok(Math.abs(roof.elevation - eave) < 1e-6, "the shell is handed the eave");
  const faces = facesFromPayload(payload);
  const roofPts = faces.filter((f) => f.id === "rf1").flatMap((f) => f.pts);
  assert.ok(roofPts.some((p) => Math.abs(p[2] - eave) < 0.02), "the eave is drawn at the edge");
  const south = faces.filter((f) => f.id === "south").flatMap((f) => f.pts).filter((p) => p[2] > 1);
  assert.ok(south.length > 0);
  assert.ok(south.every((p) => p[2] > plate - 0.05 && p[2] < plate + 0.2), "the long wall stays at the plate");
  const north = faces.filter((f) => f.id === "north").flatMap((f) => f.pts).filter((p) => p[2] > 1);
  assert.ok(north.every((p) => p[2] > plate - 0.05 && p[2] < plate + 0.2));
  const east = faces.filter((f) => f.id === "east").flatMap((f) => f.pts);
  const ridge = plate + 4 * tan;
  assert.ok(east.some((p) => Math.abs(p[1] - 4) < 0.4 && Math.abs(p[2] - ridge) < 0.2), "the gable wall runs up to the ridge");

  doc.roofs[0].overhang = 900;
  doc.roofs[0].shape = {
    kind: "poly",
    points: base.map(([x, y]) => [x + (x === 0 ? -0.9 : 0.9), y + (y === 0 ? -0.9 : 0.9)]),
  };
  const wider = compile(doc, pack);
  const dropped = wider.sketchForms.find((f) => f.elementId === "rf1");
  assert.ok(Math.abs(dropped.elevation - (plate - 0.9 * tan)) < 1e-6);
  const southAgain = facesFromPayload(wider).filter((f) => f.id === "south").flatMap((f) => f.pts).filter((p) => p[2] > 1);
  assert.ok(southAgain.every((p) => p[2] > plate - 0.05 && p[2] < plate + 0.2), "a bigger overhang does not change the wall");

  doc.roofs[0].offset = 150;
  const stepped = compile(doc, pack).sketchForms.find((f) => f.elementId === "rf1");
  assert.ok(Math.abs(stepped.plate - (plate + 0.15)) < 1e-6);
  assert.ok(Math.abs(stepped.elevation - (plate + 0.15 - 0.9 * tan)) < 1e-6);
});

test("a plate step is named from the plate, not from a lower eave", () => {
  assert.deepEqual(plateCallouts([
    { id: "low", plateZ: 2.8, eaveZ: 2.45 },
    { id: "same", plateZ: 2.8, eaveZ: 2.2 },
  ]), []);
  assert.deepEqual(plateCallouts([
    { id: "low", plateZ: 2.8, eaveZ: 2.45 },
    { id: "step", plateZ: 2.95, eaveZ: 2.6 },
  ]), [{ id: "step", text: "Plate +150 mm" }]);
});

test("a plate step is named on the higher roof, and a storey is not", () => {
  assert.deepEqual(plateCallouts([
    { id: "low", eaveZ: 2.8 },
    { id: "step", eaveZ: 2.95 },
  ]), [{ id: "step", text: "Plate +150 mm" }]);
  assert.deepEqual(plateCallouts([
    { id: "low", eaveZ: 2.8 },
    { id: "step", eaveZ: 2.95 },
    { id: "up", eaveZ: 5.6 },
  ]), [{ id: "step", text: "Plate +150 mm" }]);
  assert.deepEqual(plateCallouts([
    { id: "a", eaveZ: 2.8 },
    { id: "b", eaveZ: 2.8 },
  ]), []);
  assert.deepEqual(plateCallouts([
    { id: "ground", eaveZ: 2.8 },
    { id: "storey", eaveZ: 5.6 },
  ]), []);
  assert.deepEqual(plateCallouts([{ id: "only", eaveZ: 2.8 }]), []);
});
