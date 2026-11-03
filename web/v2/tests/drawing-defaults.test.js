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
  wallFootprint,
  wallPlanColour,
  WALL_EXISTING,
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
  const once = noteRecentDoor([], "d1");
  const twice = noteRecentDoor(noteRecentDoor(once, "d2"), "d1");
  assert.deepEqual(twice, ["d1", "d2"]);
  assert.deepEqual(recentDoorSkus(skus, twice).map((sku) => sku.id), ["d1", "d2"]);
  assert.deepEqual(recentDoorSkus(skus, ["missing", "d2"]).map((sku) => sku.id), ["d2"]);
});

test("new walls are red and existing walls are white; other statuses are left alone", () => {
  assert.equal(wallPlanColour("planned").stroke, WALL_NEW);
  assert.equal(wallPlanColour("planned").edge, null);
  assert.equal(wallPlanColour("existing").stroke, WALL_EXISTING);
  assert.ok(wallPlanColour("existing").edge);
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
