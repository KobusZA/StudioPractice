import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { normalizeDoc, rectShape } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { routeProfile } from "../services.js";
import { profileObstructions, roofUndersideAt } from "../service-obstructions.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// A 4 m square room on the ground floor with a window (sill 0.9, head 2.1) in
// the south wall at x = 2.
function house(extra = {}) {
  return {
    rooms: [{
      id: "r1", name: "Bedroom", use: "bedroom",
      wallSku: pack.system.defaultWallSku, floorSku: pack.system.defaultFloorSku,
      status: "planned", shape: rectShape(0, 0, 4, 4),
    }],
    openings: [{ id: "w1", sku: "TSP_WN1812", roomId: "r1", edgeIndex: 0, t: 0.5, status: "planned" }],
    ...extra,
  };
}

function routeDoc(from, to, offset, extra = {}) {
  return normalizeDoc({
    serviceNetworks: [{ id: "n1", name: "WS-01", system: "drainage", status: "planned" }],
    serviceNodes: [
      { id: "a", networkId: "n1", x: from[0], y: from[1], level: "01 GFL", offset },
      { id: "b", networkId: "n1", x: to[0], y: to[1], level: "01 GFL", offset },
    ],
    serviceEdges: [{ id: "e", networkId: "n1", fromNode: "a", toNode: "b", sku: "DRAIN110", mode: "measured" }],
    ...house(extra),
  });
}

function obstructions(doc, p = pack) {
  return profileObstructions(doc, p, routeProfile(doc, p, "e"));
}

test("a route through a window reports it at the window's real heights and chainage", () => {
  const doc = routeDoc([2, -1], [2, 3], 1.0);
  const { openings } = obstructions(doc);
  assert.equal(openings.length, 1);
  const [win] = openings;
  assert.equal(win.kind, "window");
  assert.equal(win.known, true);
  close(win.z0, 0.9);
  close(win.z1, 2.1);
  close(win.distance, 0);
  // The wall is 1 m along the route; the drawn width is at least the minimum.
  assert.ok(win.s0 < 1 && win.s1 > 1, `${win.s0}..${win.s1} should straddle 1 m`);
});

test("only openings within 1 m of the route are reported", () => {
  const near = obstructions(routeDoc([-1, -0.6], [5, -0.6], 1.0)).openings;
  assert.equal(near.length, 1);
  assert.ok(near[0].distance > 0.5 && near[0].distance < 0.7, `distance ${near[0].distance}`);
  // Running alongside, the window faces the stretch of route opposite it.
  assert.ok(near[0].s1 - near[0].s0 > 1.5, "the whole window width faces the run");

  const far = obstructions(routeDoc([-1, -3], [5, -3], 1.0)).openings;
  assert.equal(far.length, 0);
});

test("a window whose SKU states no height is reported unknown, with no invented range", () => {
  const open = structuredClone(pack);
  delete open.skus.find((s) => s.id === "TSP_WN1812").geometry.height;
  const [win] = obstructions(routeDoc([2, -1], [2, 3], 1.0), open).openings;
  assert.equal(win.known, false);
  assert.equal(win.z0, null);
  assert.equal(win.z1, null);
  assert.equal(obstructions(routeDoc([2, -1], [2, 3], 1.0), open).unknownCount, 1);

  const noSill = structuredClone(pack);
  delete noSill.skus.find((s) => s.id === "TSP_WN1812").geometry.sill;
  assert.equal(obstructions(routeDoc([2, -1], [2, 3], 1.0), noSill).openings[0].known, false);
});

test("a door is reported from the floor to its head", () => {
  const doc = routeDoc([2, -1], [2, 3], 1.0, {
    openings: [{ id: "d1", sku: "TSP_DR900", roomId: "r1", edgeIndex: 0, t: 0.5, status: "planned" }],
  });
  const [door] = obstructions(doc).openings;
  assert.equal(door.kind, "door");
  assert.equal(door.known, true);
  close(door.z0, 0);
  close(door.z1, 2.1);
});

test("a route crossing a wall reports the penetration at the wall's thickness and height", () => {
  const doc = routeDoc([2, -1], [2, 3], 1.0);
  const { walls } = obstructions(doc);
  const south = walls.find((v) => v.through.length);
  assert.ok(south, "the wall the route passes through is reported");
  assert.equal(south.known, true);
  close(south.z0, 0);
  close(south.z1, pack.system.wallHeight);
  // Crossing square on, the cut is the wall's own thickness, no wider.
  const cut = south.through[0];
  close(cut.s1 - cut.s0, south.thickness, 1e-6);
  assert.ok(cut.s0 < 1 && cut.s1 > 1, `${cut.s0}..${cut.s1} should straddle the wall at 1 m`);
  // The window in it is a gap, not part of the obstruction.
  assert.equal(south.holes.length, 1);
  close(south.holes[0].z0, 0.9);
  close(south.holes[0].z1, 2.1);
});

test("a window along the wall does not open up a cut the route makes elsewhere in it", () => {
  // The window is at x = 2; the route crosses the same wall at x = 3.5, where
  // there is solid masonry. Both land at nearly the same chainage.
  const { walls } = obstructions(routeDoc([3.5, -1], [3.5, 3], 1.0));
  const south = walls.find((v) => v.through.length);
  assert.equal(south.holes.length, 0);
});

test("a wall crossed at an angle gives a wider cut than one crossed square on", () => {
  const square = obstructions(routeDoc([2, -1], [2, 3], 1.0)).walls.find((v) => v.through.length);
  const angled = obstructions(routeDoc([0, -2], [4, 2], 1.0)).walls.find((v) => v.through.length);
  const width = (v) => v.through[0].s1 - v.through[0].s0;
  assert.ok(width(angled) > width(square) * 1.3, `${width(angled)} should exceed ${width(square)}`);
});

test("a wall the route only runs beside is reported as beside, with no penetration", () => {
  const { walls } = obstructions(routeDoc([1, 1], [3, 1], 1.0));
  assert.ok(walls.length >= 1);
  for (const wall of walls) assert.equal(wall.through.length, 0);
  const beside = walls.find((v) => v.beside.length);
  assert.ok(beside, "a wall within 1 m of the run is still reported");
});

test("the wall head is only reported where no roof covers the route", () => {
  const roofs = [{
    id: "rf1", sku: pack.system.defaultRoofSku, form: "flat", pitch: 0, ridge: "long",
    status: "planned", shape: rectShape(0, 0, 4, 4),
  }];
  const bare = obstructions(routeDoc([2, -1], [2, 3], 1.0));
  const bareWall = bare.walls.find((v) => v.through.length);
  assert.ok(bareWall.head.length > 0, "with no roof, the wall head is stated");

  const roofed = obstructions(routeDoc([2, -1], [2, 3], 1.0, { roofs }));
  assert.equal(roofed.roofs.length, 1);
  const run = roofed.roofs[0].runs[0];
  const from = run[0].s;
  const to = run[run.length - 1].s;
  assert.ok(to - from > 2.5, "the roof covers most of the route");
  for (const wall of roofed.walls) {
    for (const r of wall.head) {
      assert.ok(r.s1 <= from + 1e-6 || r.s0 >= to - 1e-6, `head ${r.s0}..${r.s1} sits under the roof ${from}..${to}`);
    }
  }
});

test("a gable roof's underside follows the pitch along the route and matches the 3D form", () => {
  const roofs = [{
    id: "rf1", sku: pack.system.defaultRoofSku, form: "gable", pitch: 30, ridge: "long",
    status: "planned", shape: rectShape(0, 0, 4, 10),
  }];
  const doc = routeDoc([-1, 5], [5, 5], 2.0, { roofs, openings: [] });
  const form = compile(doc, pack).sketchForms.find((f) => String(f.kind).toLowerCase() === "roof");
  const { roofs: found } = obstructions(doc);
  assert.equal(found.length, 1);
  const run = found[0].runs[0];
  // Outside the footprint there is no roof: the run covers only x in [0, 4].
  close(run[0].s, 1, 0.11);
  close(run[run.length - 1].s, 5, 0.11);
  const mid = run.reduce((m, p) => (Math.abs(p.s - 3) < Math.abs(m.s - 3) ? p : m), run[0]);
  const ridge = form.elevation + 2 * Math.tan((30 * Math.PI) / 180) - form.depth;
  close(mid.z, ridge, 0.02);
  close(run[0].z, form.elevation - form.depth, 0.1);
});

test("roofUndersideAt covers flat, shed and hip forms and is null outside the footprint", () => {
  const loop = (x0, y0, x1, y1) => ({
    curves: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ kind: "Line", start: [x, y, 0] })),
  });
  const base = { elevation: 3, depth: 0.125, roofPitch: 45, roofRidge: "long", profileLoops: [loop(0, 0, 8, 4)] };
  close(roofUndersideAt({ ...base, roofForm: "flat" }, 4, 2), 3);
  assert.equal(roofUndersideAt({ ...base, roofForm: "flat" }, 9, 2), null);
  // Shed, ridge along X: high edge at y = 0, falling to the eave at y = 4.
  close(roofUndersideAt({ ...base, roofForm: "shed" }, 4, 4), 3 - 0.125);
  close(roofUndersideAt({ ...base, roofForm: "shed" }, 4, 0), 3 + 4 - 0.125);
  // Hip: height is the distance to the nearest edge times the slope.
  close(roofUndersideAt({ ...base, roofForm: "hip" }, 4, 2), 3 + 2 - 0.125);
  close(roofUndersideAt({ ...base, roofForm: "hip" }, 1, 2), 3 + 1 - 0.125);
});
