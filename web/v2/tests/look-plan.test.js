import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { lookFromClicks } from "../massing.js";
import { lookPlanCaption, lookPlanModel, lookTarget } from "../look-plan.js";
import { normalizeDoc, rectShape } from "../model.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const WINDOW = pack.skus.find((s) => s.category === "window")?.id;

function roomWithSouthWindow() {
  return normalizeDoc({
    rooms: [{
      id: "r1",
      name: "Bedroom",
      use: "bedroom",
      wallSku: pack.system.defaultWallSku,
      floorSku: pack.system.defaultFloorSku,
      status: "planned",
      shape: rectShape(0, 0, 4, 4),
    }],
    openings: [{
      id: "w1",
      sku: WINDOW,
      roomId: "r1",
      edgeIndex: 0,
      t: 0.5,
      swing: 1,
      status: "planned",
    }],
  });
}

test("a look toward a window reports range to the glass, not the click", () => {
  const payload = compile(roomWithSouthWindow(), pack);
  const look = lookFromClicks([2, 2], [2, -1]);
  const hit = lookTarget(payload, look);
  assert.ok(hit);
  assert.equal(hit.kind, "window");
  assert.ok(Math.abs(hit.range - 2) < 0.08, `range ${hit.range}`);
  assert.ok(hit.width > 0.4);
  assert.ok(hit.height > 0.4);
});

test("the measured plan has room strings plus range and opening width", () => {
  const payload = compile(roomWithSouthWindow(), pack);
  const look = lookFromClicks([2, 2], [2, 0]);
  const model = lookPlanModel(payload, look);
  assert.equal(model.rooms.length, 1);
  assert.ok(model.openings.some((o) => o.kind === "window"));
  const lookDims = model.dims.filter((d) => d.look);
  assert.equal(lookDims.length, 2);
  assert.ok(lookDims.some((d) => d.label.includes("2.00")));
  assert.ok(model.note.toLowerCase().includes("window"));
  assert.ok(lookPlanCaption(payload, look).includes("to window"));
});

test("a look that misses every wall still has room dimensions", () => {
  const payload = compile(roomWithSouthWindow(), pack);
  const look = lookFromClicks([2, -2], [2, -10]);
  const model = lookPlanModel(payload, look);
  assert.equal(model.hit, null);
  assert.ok(model.dims.length >= 2);
});

test("looking around keeps the window that was measured, not the plaster beside it", () => {
  const payload = compile(roomWithSouthWindow(), pack);
  const look = lookFromClicks([2, 2], [2, 0]);
  const first = lookPlanModel(payload, look);
  assert.equal(first.hit.kind, "window");
  look.yaw += 0.45;
  const again = lookPlanModel(payload, look);
  assert.equal(again.hit.kind, "window");
  assert.equal(again.dims.filter((d) => d.look).length, 2);
});
