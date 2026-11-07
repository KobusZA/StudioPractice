import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { migrateOpening, normalizeDoc } from "../model.js";
import { normalizePackUnits, validatePack } from "../schema.js";
import { elevationModel, applyOpeningEdit, resizeArchRise } from "../wall-elevation.js";
import { elevationSvg } from "../wall-elevation-render.js";
import { archVoidPolygon, fitArchSize, isArchHead, openingVoidArea } from "../openings.js";

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

test("an arch will not be shorter than its head", () => {
  assert.deepEqual(fitArchSize(0.9, 0.3), { width: 0.9, height: 0.45, rise: 0.45 });
  assert.deepEqual(fitArchSize(2, 2.1), { width: 2, height: 2.1, rise: 1 });
  assert.deepEqual(fitArchSize(0.9, 2.1, 0.15), { width: 0.9, height: 2.1, rise: 0.15 });
  assert.deepEqual(fitArchSize(0.9, 0.1, 0.15), { width: 0.9, height: 0.15, rise: 0.15 });
  assert.deepEqual(fitArchSize(0.9, 2.1, 2), { width: 0.9, height: 2.1, rise: 0.45 });
});

test("a shallower rise removes less of the opening than a semicircle", () => {
  const arch = pack.skus.find((s) => s.id === "TSP_ARCH");
  const box = 0.9 * 2.1;
  const semi = openingVoidArea(0.9, 2.1, arch);
  const segmental = openingVoidArea(0.9, 2.1, arch, 0.15);
  assert.ok(semi < segmental && segmental < box);
});

test("a segmental head springs at the rise and crowns in the middle", () => {
  const pts = archVoidPolygon({ from: 0, to: 0.9, bottom: 0, top: 2.1, rise: 0.15 });
  const crown = pts.reduce((best, p) => (p[1] > best[1] ? p : best));
  assert.ok(Math.abs(crown[0] - 0.45) < 1e-6, `crown x ${crown[0]}`);
  assert.ok(Math.abs(crown[1] - 2.1) < 1e-6, `crown y ${crown[1]}`);
  const spring = pts.find((p) => Math.abs(p[0]) < 1e-9 && p[1] > 0.01);
  assert.ok(spring && Math.abs(spring[1] - 1.95) < 1e-6, `spring ${spring && spring[1]}`);
});

test("a stored arch rise is kept, and a blank one stays a semicircle", () => {
  assert.equal(migrateOpening({ id: "a", rise: 0.2 }).rise, 0.2);
  assert.equal(migrateOpening({ id: "b", rise: 0 }).rise, null);
  assert.equal(migrateOpening({ id: "c" }).rise, null);
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
  assert.match(drawn.svg, /data-elev-op="spring"/);

  const flat = holeDoc("TSP_ARCH");
  flat.openings[0].rise = 0.15;
  const flatDrawn = elevationSvg(elevationModel(flat, pack, { wallId: "w1" }), {
    width: 600, height: 200, interactive: true, selectedId: "h1",
  });
  const archPath = (svg) => svg.match(/<path d="([^"]+)" class="[^"]*elev-arch/)?.[1];
  assert.notEqual(archPath(drawn.svg), archPath(flatDrawn.svg));
  assert.deepEqual(resizeArchRise({ sill: 0, height: 2.1, width: 0.9 }, 1.95), { rise: 0.15 });

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { height: 0.4 });
  let row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.ok(row.height + 1e-9 >= row.width / 2, `height ${row.height} rise ${row.width / 2}`);

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { width: 1.6, left: 2.2 });
  row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.ok(Math.abs(row.width - 1.6) < 0.02);
  assert.ok(row.height + 1e-9 >= row.width / 2);
  assert.equal(doc.openings[0].rise, null);
});

test("a set rise stays when the arch is widened, and is capped at half the width", () => {
  const doc = holeDoc("TSP_ARCH");
  doc.openings[0].rise = 0.2;
  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { width: 1.6, left: 2.2 });
  let row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.equal(doc.openings[0].rise, 0.2);
  assert.ok(Math.abs(row.rise - 0.2) < 1e-6);
  assert.ok(row.height + 1e-9 >= 0.2);
  assert.ok(row.rise + 1e-6 < row.width / 2, "widening a segmental arch does not force a semicircle");

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { width: 0.3, left: 2.85 });
  row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.equal(doc.openings[0].rise, 0.2);
  assert.ok(Math.abs(row.rise - row.width / 2) < 1e-6);

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { width: 1.6, left: 2.2 });
  row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.ok(Math.abs(row.rise - 0.2) < 1e-6);

  applyOpeningEdit(doc, pack, { wallId: "w1" }, "h1", { height: 0.1 });
  row = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.ok(row.height + 1e-9 >= 0.2);
});
