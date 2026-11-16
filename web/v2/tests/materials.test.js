import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { boqRows } from "../schedule.js";
import { openingSize, openingVoidArea, skuById } from "../openings.js";
import { concreteTypesUsed, leavesFor, materialSummary, materialTakeoff, normalizeMaterialSettings } from "../materials.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))),
);

const WALL = "TSP_WAL_MASONARY_WALL_220MM_PLASTER";
const PARTITION = "TSP_WAL_MASONARY_WALL_110MM_PLASTER";
const FND_WALL = "TSP_FND_MASONARY_WALL_220MM_FOUNDATI";
const FOOTING = "TSP_FND_BEARING_FOOTING_600X200_MM";
const DOOR = pack.skus.find((s) => s.category === "door")?.id;
const GFL = "01 GFL";
const FND = "00 FOUNDATION";
const BRICK = "222x106x73";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ""} expected ${b}, got ${a}`);

function seg(id, x1, y1, x2, y2, extra = {}) {
  return { id, sku: WALL, level: GFL, x1, y1, x2, y2, status: "planned", top: "level-above", ...extra };
}

/** A 5 x 4 m box of drawn 220 walls on the ground floor. */
function boxDoc(extra = {}) {
  return normalizeDoc({
    segments: [
      seg("s1", 0, 0, 5, 0),
      seg("s2", 5, 0, 5, 4),
      seg("s3", 5, 4, 0, 4),
      seg("s4", 0, 4, 0, 0),
    ],
    ...extra,
  });
}

/** The same box as a room. Only room walls carry the implied footing today. */
function roomDoc(extra = {}) {
  return normalizeDoc({
    rooms: [{ id: "r1", name: "r1", use: "living", level: GFL, wallSku: WALL, rect: { x: 0, y: 0, w: 5, h: 4 } }],
    ...extra,
  });
}

const masonryFace = (out) => out.instances
  .filter((r) => r.model === WALL || r.model === FND_WALL)
  .reduce((sum, r) => sum + r.faceArea, 0);
const footingVolume = (out) => out.instances
  .filter((r) => r.model === FOOTING)
  .reduce((sum, r) => sum + r.volume, 0);
const lineFor = (rows, model) => rows.find((r) => r.model === model);

const chosen = (extra = {}) => ({
  masonrySource: "cba",
  concreteSource: "cssa-1a",
  brick: BRICK,
  concreteStrength: { [FOOTING]: "low" },
  ...extra,
});

test("settings normalize to null until stated, and drop anything unknown", () => {
  assert.deepEqual(normalizeDoc({}).materialSettings, {
    masonrySource: null,
    concreteSource: null,
    brick: null,
    concreteStrength: {},
    waste: { bricks: null, mortar: null, concrete: null },
  });
  const s = normalizeMaterialSettings({
    masonrySource: "nope",
    concreteSource: "cssa-1c",
    brick: BRICK,
    concreteStrength: { A: "low", B: "fierce" },
    waste: { bricks: 0.05, mortar: -1, concrete: "10" },
  });
  assert.equal(s.masonrySource, null);
  assert.equal(s.concreteSource, "cssa-1c");
  assert.deepEqual(s.concreteStrength, { A: "low" });
  assert.deepEqual(s.waste, { bricks: 0.05, mortar: null, concrete: null });
});

test("the BOM summary names every job-wide choice, and says which are not made", () => {
  assert.equal(
    materialSummary(null),
    "Bricks and mortar source not chosen · Brick not chosen · Concrete source not chosen · Waste: bricks not stated, mortar not stated, concrete not stated",
  );
  assert.equal(
    materialSummary(chosen({ waste: { bricks: 0.05, mortar: 0.125, concrete: null } })),
    "Bricks and mortar per Clay Brick Association · Imperial 222 × 106 × 73 mm · Concrete per Concrete Society of Southern Africa, Table 1a (32,5 cement, 19 mm stone) · Waste: bricks 5%, mortar 12.5%, concrete not stated",
  );
});

test("leaves come from the core and the brick, and only when they are whole", () => {
  assert.equal(leavesFor(0.22, BRICK), 2);
  assert.equal(leavesFor(0.11, BRICK), 1);
  assert.equal(leavesFor(0.24, BRICK), null);
  assert.equal(leavesFor(0.22, "290x140x90"), null);
});

test("compile adds a net face area and a core thickness to wall and foundation wall rows", () => {
  const out = compile(boxDoc(), pack);
  const walls = out.instances.filter((r) => r.model === WALL);
  const fnd = out.instances.filter((r) => r.model === FND_WALL);
  assert.equal(walls.length, 4);
  assert.equal(fnd.length, 4);
  for (const r of walls) {
    near(r.faceArea, r.area, "no openings, so net equals gross");
    near(r.coreThickness, 0.22);
  }
  for (const r of fnd) {
    near(r.coreThickness, 0.22);
    near(r.faceArea, r.length * 0.6);
  }
});

test("a new job counts nothing and asks for every choice", () => {
  const out = compile(roomDoc(), pack);
  const { rows, gaps } = materialTakeoff(out, pack, roomDoc().materialSettings);
  assert.equal(rows.length, 0);
  assert.ok(gaps.some((g) => /source for bricks/.test(g)));
  assert.ok(gaps.some((g) => /brick the walls/.test(g)));
  assert.ok(gaps.some((g) => /source for concrete/.test(g)));
  assert.ok(gaps.some((g) => /concrete strength for Bearing Footing/.test(g)));
});

test("Clay Brick Association: 110 bricks per m² of 220 wall, 3 bags and 0.6 m³ per 1 000", () => {
  const out = compile(boxDoc(), pack);
  const { rows } = materialTakeoff(out, pack, chosen());
  const face = masonryFace(out);
  const bricks = lineFor(rows, `MAT-BRICK-${BRICK}`);
  near(bricks.qty, 110 * face);
  near(lineFor(rows, "MAT-MORTAR-CEMENT").qty, (110 * face / 1000) * 3);
  near(lineFor(rows, "MAT-MORTAR-SAND").qty, (110 * face / 1000) * 0.6);
  assert.ok(bricks.elements.some((e) => e.id === "s1"));
  assert.ok(bricks.elements.some((e) => e.id.startsWith("f:")), "foundation walls are counted too");
  assert.match(bricks.description, /Clay Brick Association/);
});

test("Concrete Society: 52 per leaf and 0.34 m³ of Class II mortar per 1 000", () => {
  const out = compile(boxDoc(), pack);
  const { rows } = materialTakeoff(out, pack, chosen({ masonrySource: "cssa" }));
  const face = masonryFace(out);
  const n = 104 * face;
  near(lineFor(rows, `MAT-BRICK-${BRICK}`).qty, n);
  near(lineFor(rows, "MAT-MORTAR-CEMENT").qty, (n / 1000) * 0.34 * 7);
  near(lineFor(rows, "MAT-MORTAR-SAND").qty, (n / 1000) * 0.34 * 1.35);
});

test("a door takes its own area off the brick face", () => {
  const plain = compile(boxDoc(), pack);
  const withDoor = boxDoc({ openings: [{ id: "d1", sku: DOOR, wallId: "s1", t: 0.5, status: "planned" }] });
  const out = compile(withDoor, pack);
  const size = openingSize(pack, withDoor.openings[0]);
  const hole = openingVoidArea(size.width, size.height, skuById(pack, DOOR));
  assert.ok(hole > 0);
  near(masonryFace(plain) - masonryFace(out), hole);
  const wall = out.instances.find((r) => r.elementId === "s1");
  near(wall.area - wall.faceArea, hole, "gross area is untouched");
});

test("footing concrete follows the strength and the source, and a source with no figure leaves a gap", () => {
  const out = compile(roomDoc(), pack);
  const vol = footingVolume(out);
  assert.ok(vol > 0);
  assert.deepEqual(concreteTypesUsed(out, pack).map((t) => t.id), [FOOTING]);

  const low = materialTakeoff(out, pack, chosen()).rows;
  near(lineFor(low, "MAT-CONCRETE-CEMENT").qty, 5.8 * vol);
  near(lineFor(low, "MAT-CONCRETE-STONE").qty, 0.65 * vol);
  assert.match(lineFor(low, "MAT-CONCRETE-STONE").description, /19 mm/);

  const cbaHigh = materialTakeoff(out, pack, chosen({ concreteSource: "cba", concreteStrength: { [FOOTING]: "high" } }));
  assert.equal(lineFor(cbaHigh.rows, "MAT-CONCRETE-CEMENT").qty, null);
  assert.ok(lineFor(cbaHigh.rows, "MAT-CONCRETE-CEMENT").incomplete);
  assert.ok(cbaHigh.gaps.some((g) => /states no high strength mix/.test(g)));
});

test("order quantities add the job's waste and round up to whole bricks and bags", () => {
  const out = compile(roomDoc(), pack);
  const none = materialTakeoff(out, pack, chosen());
  assert.equal(lineFor(none.rows, `MAT-BRICK-${BRICK}`).orderQty, null);
  assert.ok(none.gaps.some((g) => /No waste allowance for bricks, mortar, concrete/.test(g)));

  const { rows } = materialTakeoff(out, pack, chosen({ waste: { bricks: 0.05, mortar: 0.2, concrete: 0.1 } }));
  const bricks = lineFor(rows, `MAT-BRICK-${BRICK}`);
  assert.equal(bricks.orderQty, Math.ceil(bricks.qty * 1.05));
  const cement = lineFor(rows, "MAT-MORTAR-CEMENT");
  assert.equal(cement.orderQty, Math.ceil(cement.qty * 1.2));
  const sand = lineFor(rows, "MAT-CONCRETE-SAND");
  assert.ok(sand.orderQty >= sand.qty * 1.1 && sand.orderQty - sand.qty * 1.1 < 0.01);
});

test("a drawn 240 foundation wall adds no bricks and is listed", () => {
  const doc = boxDoc();
  doc.segments.push({ id: "fw", sku: FND_WALL, level: FND, x1: 0, y1: -2, x2: 5, y2: -2, status: "planned" });
  const out = compile(doc, pack);
  const { rows, gaps } = materialTakeoff(out, pack, chosen());
  const bricks = lineFor(rows, `MAT-BRICK-${BRICK}`);
  assert.ok(!bricks.elements.some((e) => e.id === "fw"));
  assert.ok(bricks.incomplete);
  assert.ok(gaps.some((g) => /240 mm core/.test(g)), gaps.join("\n"));
});

test("a 110 partition on the Clay Brick Association source is a gap, not a guess", () => {
  const doc = boxDoc();
  doc.segments.push(seg("p1", 2.5, 0, 2.5, 4, { sku: PARTITION }));
  const out = compile(doc, pack);
  const cba = materialTakeoff(out, pack, chosen());
  assert.ok(cba.gaps.some((g) => /52–56/.test(g)));
  const cssa = materialTakeoff(out, pack, chosen({ masonrySource: "cssa" }));
  assert.ok(!cssa.gaps.some((g) => /not counted/.test(g)));
});

test("the BOQ is untouched by material settings", () => {
  const plain = boxDoc();
  const set = boxDoc({ materialSettings: chosen({ waste: { bricks: 0.05, mortar: 0.2, concrete: 0.1 } }) });
  const a = boqRows(compile(plain, pack), null);
  const b = boqRows(compile(set, pack), null);
  assert.deepEqual(a.map((r) => [r.model, r.qty]), b.map((r) => [r.model, r.qty]));
  assert.ok(!b.some((r) => r.category === "Materials"));
});
