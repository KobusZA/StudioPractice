import test from "node:test";
import assert from "node:assert/strict";

import {
  armPlacement,
  nextTraceView,
  noteRecentDoor,
  openingStaysArmed,
  recentDoorSkus,
  rememberFunctionSku,
  skuForArmedFunction,
  joinedWallPolygon,
  wallFootprint,
  wallPlanColour,
  WALL_EXISTING,
  WALL_EXISTING_EDGE,
  WALL_NEW,
} from "../drawing-defaults.js";

const skus = [
  { id: "w110", category: "wall", name: "110" },
  { id: "w220", category: "wall", name: "220" },
  { id: "d1", category: "door", name: "Door A" },
  { id: "d2", category: "door", name: "Door B" },
];

test("re-arming walls keeps the type the user picked, and the pack order stays the fallback", () => {
  assert.equal(skuForArmedFunction(skus, { categories: ["wall"], functionId: "walls", memory: {}, currentId: null }), "w110");
  const memory = rememberFunctionSku({}, "walls", "w220");
  assert.equal(skuForArmedFunction(skus, { categories: ["wall"], functionId: "walls", memory, currentId: "d1" }), "w220");
  const back = rememberFunctionSku(memory, "walls", "w110");
  assert.equal(skuForArmedFunction(skus, { categories: ["wall"], functionId: "walls", memory: back, currentId: "w220" }), "w110");
});

test("leaving the wall tool and changing thickness keeps the location line", () => {
  const picked = armPlacement({ placeSkuId: "w220", wallLocation: "exterior", memory: { walls: "w220" } }, { id: "walls", categories: ["wall"] }, skus);
  assert.equal(picked.placeSkuId, "w220");
  assert.equal(picked.wallLocation, "exterior");
  const thicker = armPlacement({ ...picked, placeSkuId: "w110", memory: rememberFunctionSku(picked.memory, "walls", "w110") }, { id: "walls", categories: ["wall"] }, skus);
  assert.equal(thicker.placeSkuId, "w110");
  assert.equal(thicker.wallLocation, "exterior");
  const doors = armPlacement(thicker, { id: "doors", categories: ["door"] }, skus);
  assert.equal(doors.placeSkuId, "d1");
  assert.equal(doors.wallLocation, "exterior");
  const wallsAgain = armPlacement({ ...doors, memory: { walls: "w110" } }, { id: "walls", categories: ["wall"] }, skus);
  assert.equal(wallsAgain.wallLocation, "exterior");
});

test("a door stays armed and recent doors sit beside the library, newest first", () => {
  assert.equal(openingStaysArmed("door"), true);
  assert.equal(openingStaysArmed("window"), false);
  assert.equal(openingStaysArmed("opening"), false);
  const once = noteRecentDoor([], "d1");
  const twice = noteRecentDoor(noteRecentDoor(once, "d2"), "d1");
  assert.deepEqual(twice, ["d1", "d2"]);
  assert.deepEqual(recentDoorSkus(skus, twice).map((sku) => sku.id), ["d1", "d2"]);
  assert.deepEqual(recentDoorSkus(skus, ["missing", "d2"]).map((sku) => sku.id), ["d2"]);
});

test("new walls are red and existing walls are white; both have the dark edge", () => {
  assert.equal(wallPlanColour("planned").stroke, WALL_NEW);
  assert.equal(wallPlanColour("planned").edge, WALL_EXISTING_EDGE);
  assert.equal(wallPlanColour("existing").stroke, WALL_EXISTING);
  assert.equal(wallPlanColour("existing").edge, WALL_EXISTING_EDGE);
  assert.equal(wallPlanColour("mixed"), null);
});

test("sheet and model swap, and a wall footprint is the thickness around the centreline", () => {
  assert.equal(nextTraceView("model"), "sheet");
  assert.equal(nextTraceView("sheet"), "model");
  const poly = wallFootprint({ x1: 0, y1: 0, x2: 4, y2: 0, thickness: 0.22 });
  assert.equal(poly.length, 4);
  const ys = poly.map((p) => p.y);
  assert.ok(ys.some((y) => Math.abs(y - 0.11) < 1e-9));
  assert.ok(ys.some((y) => Math.abs(y + 0.11) < 1e-9));
});

function near(p, x, y) {
  return Math.hypot(p.x - x, p.y - y) < 1e-6;
}

test("two walls that meet mitre into one corner, and a straight join stays square", () => {
  const a = { id: "a", x1: 0, y1: 0, x2: 4, y2: 0, thickness: 0.2 };
  const b = { id: "b", x1: 4, y1: 0, x2: 4, y2: 3, thickness: 0.2 };
  const poly = joinedWallPolygon(a, [a, b]);
  assert.ok(poly.some((p) => near(p, 3.9, 0.1)), "inner corner");
  assert.ok(poly.some((p) => near(p, 4.1, -0.1)), "outer corner");
  // Drawn "against": the ends sit a thickness apart but the corner is still one.
  const a2 = { id: "a", x1: 0, y1: 0, x2: 3.9, y2: 0, thickness: 0.2 };
  const b2 = { id: "b", x1: 4, y1: -0.1, x2: 4, y2: 3, thickness: 0.2 };
  const apart = joinedWallPolygon(a2, [a2, b2]);
  assert.ok(apart.some((p) => near(p, 3.9, 0.1)), "inner corner");
  assert.ok(apart.some((p) => near(p, 4.1, -0.1)), "outer corner");
  // An obtuse corner: faces still pair inside-to-inside.
  const c1 = { id: "c1", x1: 0, y1: 0, x2: 4, y2: 0, thickness: 0.2 };
  const c2 = { id: "c2", x1: 4, y1: 0, x2: 6, y2: 2, thickness: 0.2 };
  const obtuse = joinedWallPolygon(c1, [c1, c2]);
  const inner = obtuse.find((p) => p.y > 0 && p.x > 3);
  const outer = obtuse.find((p) => p.y < 0 && p.x > 3);
  assert.ok(inner.x < 4 && inner.x > 3.6, `inner at ${inner.x}`);
  assert.ok(outer.x > 4 && outer.x < 4.3, `outer at ${outer.x}`);
  const straight = { id: "c", x1: 4, y1: 0, x2: 8, y2: 0, thickness: 0.2 };
  const butt = joinedWallPolygon(a, [a, straight]);
  assert.ok(butt.some((p) => near(p, 4, 0.1)));
  assert.ok(butt.some((p) => near(p, 4, -0.1)));
});
