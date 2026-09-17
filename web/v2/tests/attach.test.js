// Base-attach resolution: what an attached wall's base elevation and height
// come out as, and what happens when the attach cannot be resolved at all.
//
// The rule under test everywhere below is the one from LEVEL-ATTACH-PLAN.md:
// an unresolvable attach falls back to the level datum *and warns*. It never
// guesses a number, because a wrong elevation in a schedule gets built and a
// flagged one gets queried.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc, resolveBaseAttach } from "../model.js";
import { attachPreview, attachReport, compile, resolvedBase } from "../compile.js";
import { normalizePackUnits } from "../schema.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

// 01 GFL sits at 0 and 02 L1 at 2.8; a wall is 2.8 m high and a foundation
// 0.6 m, so "wall on foundation" resolves to a base of 0.6 and a height of 2.2.
const WALL_SKU = "TSP_MAS009";
const WALL_NAME = "Masonry wall 220mm (plaster)";
const FOUNDATION_SKU = "TSP_CON052";
const FOUNDATION_NAME = "Masonry 220mm foundation perimeter (plaster)";

function seg(id, sku, level, extra = {}) {
  return { id, sku, level, x1: 0, y1: 0, x2: 6, y2: 0, status: "planned", ...extra };
}

function docWith(segments, beams = []) {
  return normalizeDoc({ segments, beams });
}

function wallRow(out, id) {
  return out.walls.find((w) => w.id === id);
}

/** Metres carry float noise once heights are subtracted; compare as the rest of the suite does. */
function m(n) {
  return Math.round(n * 1e6) / 1e6;
}

test("an unattached wall resolves exactly as it did before attach existed", () => {
  const doc = docWith([seg("w1", WALL_SKU, "01 GFL")]);
  const base = resolvedBase(doc, pack, doc.segments[0], 2.8);
  assert.equal(base.elevation, 0);
  assert.equal(base.height, 2.8);
  assert.equal(base.attachedTo, null);
  assert.equal(base.warning, null);
});

test("an attached wall's base rises to the target's top and its height shrinks to match", () => {
  const doc = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
  ]);
  const out = compile(doc, pack);
  const wall = wallRow(out, "w1");
  assert.equal(wall.baseElevation, 0.6);
  assert.equal(m(wall.height), 2.2, "the wall's pre-attach top stays at 2.8, so the attach eats into its height");
  assert.equal(wall.attachedTo, FOUNDATION_NAME);
  assert.equal(out.warnings.length, 0);
});

// The point of shrinking the height rather than only moving the base: the
// schedule has to shrink with the wall, or the QS prices 0.6 m of wall that is
// not there.
test("attach changes the takeoff quantities, not just the drawn elevation", () => {
  const attached = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
  ]);
  const loose = docWith([seg("f1", FOUNDATION_SKU, "01 GFL"), seg("w1", WALL_SKU, "01 GFL")]);
  const rowFor = (doc) => compile(doc, pack).instances.find((r) => r.elementId === "w1");
  assert.equal(m(rowFor(loose).area), m(6 * 2.8));
  assert.equal(m(rowFor(attached).area), m(6 * 2.2));
  assert.ok(rowFor(attached).volume < rowFor(loose).volume);
});

test("a baseOffset lifts an unattached wall without any attach at all", () => {
  const doc = docWith([seg("w1", WALL_SKU, "01 GFL", { baseOffset: 0.45 })]);
  assert.equal(wallRow(compile(doc, pack), "w1").baseElevation, 0.45);
});

test("a wall can attach to the storey below it", () => {
  const doc = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL", { baseOffset: 2 }),
    seg("w1", WALL_SKU, "02 L1", { baseAttach: { kind: "segment", id: "f1" } }),
  ]);
  const wall = wallRow(compile(doc, pack), "w1");
  assert.equal(wall.baseElevation, 2.6, "the foundation's own offset carries into the wall above it");
  assert.equal(m(wall.height), 3, "02 L1's datum is 2.8, so the pre-attach top was 5.6");
});

test("an opening follows its host wall's attached base rather than the level datum", () => {
  const doc = normalizeDoc({
    segments: [
      seg("f1", FOUNDATION_SKU, "01 GFL"),
      seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
    ],
    openings: [{ id: "o1", sku: "TSP_DR900", wallId: "w1", t: 0.5, status: "planned" }],
  });
  const form = compile(doc, pack).sketchForms.find((f) => f.elementId === "o1");
  assert.equal(form.elevation, 0.6);
});

test("a dead attach reference warns and falls back to the level datum", () => {
  const doc = docWith([seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "gone" } })]);
  const out = compile(doc, pack);
  assert.equal(wallRow(out, "w1").baseElevation, 0, "the datum, not a guess at where the missing target's top was");
  assert.equal(wallRow(out, "w1").height, 2.8);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /no longer exists/);
});

test("a cycle warns rather than looping forever", () => {
  const doc = docWith([
    seg("a", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "b" } }),
    seg("b", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "a" } }),
  ]);
  assert.equal(resolveBaseAttach(doc, doc.segments[0]).reason, "cycle");
  const out = compile(doc, pack);
  assert.equal(out.warnings.length, 2);
  assert.ok(out.warnings.every((w) => /attached to each other/.test(w)));
  assert.equal(wallRow(out, "a").baseElevation, 0);
});

test("a second hop warns instead of resolving a chain one level deeper", () => {
  const doc = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
    seg("w2", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "w1" } }),
  ]);
  const out = compile(doc, pack);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /one level deep/);
  assert.equal(wallRow(out, "w2").baseElevation, 0, "the second hop falls back rather than compounding the chain");
  assert.equal(wallRow(out, "w1").baseElevation, 0.6, "the first hop is unaffected");
});

test("a geometrically impossible attach warns instead of emitting a zero-height row", () => {
  const doc = docWith([
    seg("w1", WALL_SKU, "01 GFL"),
    seg("w2", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "w1" } }),
  ]);
  const out = compile(doc, pack);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /no height/);
  assert.equal(wallRow(out, "w2").height, 2.8, "the as-drawn height, not zero and not negative");
});

// A beam only compiles when both its ends land on a wall type allowed to host
// it, so these two fixtures carry the pair of walls that makes it real.
function beamDoc(beamLevel, targetId, extraSegs = []) {
  return docWith(
    [
      { ...seg("w1", WALL_SKU, "01 GFL"), x1: 0, y1: 0, x2: 0, y2: 4 },
      { ...seg("w2", WALL_SKU, "01 GFL"), x1: 3, y1: 0, x2: 3, y2: 4 },
      ...extraSegs,
    ],
    [{
      id: "b1",
      sku: "TSP_BM220",
      level: beamLevel,
      x1: 0,
      y1: 2,
      x2: 3,
      y2: 2,
      status: "planned",
      baseAttach: { kind: "segment", id: targetId },
    }],
  );
}

// The firm's own template (samples/tsp-pack.json) states thickness and depth for
// its foundation types but no height, so this is the real first-run case, not a
// hypothetical: an invented top elevation is worse than a flagged unknown.
test("a target whose height the pack does not state is a gap, not a guess", () => {
  const heightless = {
    ...pack,
    skus: pack.skus.map((s) => (s.id === FOUNDATION_SKU
      ? { ...s, geometry: { ...s.geometry, height: null } }
      : s)),
  };
  const doc = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
  ]);
  const preview = attachPreview(doc, heightless, doc.segments[1], { kind: "segment", id: "f1" });
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, "target-height-unknown");

  const out = compile(doc, heightless);
  assert.equal(wallRow(out, "w1").baseElevation, 0, "not system.wallHeight standing in for the missing number");
  assert.match(out.warnings[0], /does not state a height/);
});

// The object's *own* missing height still falls back the way walls.js has always
// done - attach does not get to change what an unattached wall measures.
test("an attaching object with no stated height still uses the document default", () => {
  const heightless = {
    ...pack,
    skus: pack.skus.map((s) => (s.id === WALL_SKU ? { ...s, geometry: { ...s.geometry, height: null } } : s)),
  };
  const doc = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
  ]);
  const wall = wallRow(compile(doc, heightless), "w1");
  assert.equal(wall.baseElevation, 0.6);
  assert.equal(m(wall.height), 2.2, "2.8 m of wallHeight less the 0.6 m foundation under it");
});

test("a beam attaches the same way a wall does", () => {
  // A 0.22 m beam on 02 L1 (datum 2.8) sitting on a wall that tops out at 2.8:
  // its base lands on the wall's top and it keeps its full depth.
  const out = compile(beamDoc("02 L1", "w1"), pack);
  const form = out.sketchForms.find((f) => f.elementId === "b1");
  assert.equal(out.warnings.length, 0);
  assert.equal(form.elevation, 2.8);
  assert.equal(m(form.depth), 0.22);
});

test("a beam with no height left above its target warns like a wall does", () => {
  const out = compile(beamDoc("01 GFL", "f1", [seg("f1", FOUNDATION_SKU, "01 GFL")]), pack);
  assert.match(out.warnings[0], /no height/);
  assert.equal(out.sketchForms.find((f) => f.elementId === "b1").elevation, 0);
});

test("a wall attached to a 600X200 strip footing sits on the 200 mm pad", () => {
  const strip = {
    id: "TSP_FND_STRIP",
    name: "Bearing Footing - 600X200 mm",
    category: "foundation",
    geometry: { thickness: 0.2, width: 0.6, depth: 0.2 },
  };
  const stripPack = { ...pack, skus: [...pack.skus, strip] };
  const doc = docWith([
    seg("f1", strip.id, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
  ]);
  const out = compile(doc, stripPack);
  assert.equal(wallRow(out, "f1").thickness, 0.6);
  assert.equal(wallRow(out, "f1").height, 0.2);
  assert.equal(wallRow(out, "w1").baseElevation, 0.2);
  assert.equal(m(wallRow(out, "w1").height), 2.6);
  assert.equal(out.warnings.length, 0);
});

test("attachPreview says what an attach would do without touching the document", () => {
  const doc = docWith([seg("f1", FOUNDATION_SKU, "01 GFL"), seg("w1", WALL_SKU, "01 GFL")]);
  const preview = attachPreview(doc, pack, doc.segments[1], { kind: "segment", id: "f1" });
  assert.equal(preview.ok, true);
  assert.equal(preview.elevation, 0.6);
  assert.equal(m(preview.height), 2.2);
  assert.equal(preview.rise, 0.6);
  assert.equal(doc.segments[1].baseAttach, null);
});

test("attachReport lists every attach with its resolved state for the Check panel", () => {
  const doc = docWith([
    seg("f1", FOUNDATION_SKU, "01 GFL"),
    seg("w1", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "f1" } }),
    seg("w2", WALL_SKU, "01 GFL", { baseAttach: { kind: "segment", id: "gone" } }),
    seg("w3", WALL_SKU, "01 GFL"),
  ]);
  const rows = attachReport(doc, pack);
  assert.equal(rows.length, 2, "only objects that carry an attach appear");
  const ok = rows.find((r) => r.ref.id === "w1");
  assert.equal(ok.attachedTo.label, FOUNDATION_NAME);
  assert.equal(ok.warning, null);
  const broken = rows.find((r) => r.ref.id === "w2");
  assert.equal(broken.attachedTo, null);
  assert.match(broken.warning, /no longer exists/);
});
