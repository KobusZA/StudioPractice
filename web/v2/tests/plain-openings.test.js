import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { normalizePackUnits, validatePack } from "../schema.js";
import { elevationModel, applyOpeningEdit } from "../wall-elevation.js";
import { elevationSvg } from "../wall-elevation-render.js";
import { fitArchSize, isArchHead, openingVoidArea } from "../openings.js";

const raw = JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url)));
const pack = normalizePackUnits(raw);

test("the door list carries a plain opening and an arch", () => {
  const result = validatePack(raw);
  assert.deepEqual(result.errors, []);
  const opening = pack.skus.find((s) => s.id === "TSP_OPENING");
  const arch = pack.skus.find((s) => s.id === "TSP_ARCH");
  assert.equal(opening.category, "opening");
  assert.equal(arch.category, "opening");
  assert.equal(isArchHead(opening), false);
  assert.equal(isArchHead(arch), true);
  assert.equal(opening.geometry.width, 0.9);
  assert.equal(opening.geometry.height, 2.1);
  const box = 0.9 * 2.1;
  assert.ok(openingVoidArea(0.9, 2.1, arch) < box);
  assert.equal(openingVoidArea(0.9, 2.1, opening), box);
});

test("an arch will not be shorter than its semicircular head", () => {
  assert.deepEqual(fitArchSize(0.9, 0.3), { width: 0.9, height: 0.45 });
  assert.deepEqual(fitArchSize(2, 2.1), { width: 2, height: 2.1 });
});

function holeDoc(sku) {
  return normalizeDoc({
    segments: [{ id: "w1", sku: pack.system.defaultWallSku, level: pack.system.defaultLevel, x1: 0, y1: 0, x2: 6, y2: 0 }],
    openings: [{ id: "h1", sku, wallId: "w1", t: 0.5 }],
  });
}

test("a plain opening can be resized from its corners, and a door still cannot", async () => {
  const opening = elevationSvg(elevationModel(holeDoc("TSP_OPENING"), pack, { wallId: "w1" }), {
    width: 600, height: 200, interactive: true, selectedId: "h1",
  });
  assert.match(opening.svg, /data-elev-op="tl"/);
  assert.match(opening.svg, /data-elev-op="br"/);
  assert.doesNotMatch(opening.svg, /data-elev-op="t"/);

  const doorId = pack.skus.find((s) => s.category === "door").id;
  const door = elevationSvg(elevationModel(holeDoc(doorId), pack, { wallId: "w1" }), {
    width: 600, height: 200, interactive: true, selectedId: "h1",
  });
  assert.match(door.svg, /data-elev-op="t"/);
  assert.doesNotMatch(door.svg, /data-elev-op="tl"/);
});

test("an arch draws a curved head and grows tall enough when it is widened", () => {
  const doc = holeDoc("TSP_ARCH");
  const drawn = elevationSvg(elevationModel(doc, pack, { wallId: "w1" }), {
    width: 600, height: 200, interactive: true, selectedId: "h1",
  });
  assert.match(drawn.svg, /<path /);
  assert.match(drawn.svg, /elev-arch/);
  assert.match(drawn.svg, /data-elev-op="tl"/);

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { height: 0.4 });
  let row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.ok(row.height + 1e-9 >= row.width / 2, `height ${row.height} rise ${row.width / 2}`);

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { width: 1.6, left: 2.2 });
  row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.ok(Math.abs(row.width - 1.6) < 0.02);
  assert.ok(row.height + 1e-9 >= row.width / 2);
});
