// Phase B: wall height from rooms, converting room walls to drawn walls, and
// per-opening sill / width / height overrides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { compile } from "../compile.js";
import { normalizePackUnits } from "../schema.js";
import { deriveWalls, drawnSegmentFromWall } from "../walls.js";
import { openingSize } from "../openings.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const room = (id, x, extra = {}) => ({ id, name: id, level: "01 GFL", rect: { x, y: 0, w: 4, h: 3 }, ...extra });

test("a room's wallHeight overrides the type height; blank follows the type", () => {
  const plain = deriveWalls(normalizeDoc({ rooms: [room("a", 0)] }), pack);
  const low = deriveWalls(normalizeDoc({ rooms: [room("a", 0, { wallHeight: 2.4 })] }), pack);
  assert.ok(plain.every((w) => w.height === 2.8));
  assert.ok(low.every((w) => w.height === 2.4));
});

test("a shared wall takes the taller room height and is flagged", () => {
  const doc = normalizeDoc({ rooms: [room("a", 0, { wallHeight: 2.4 }), room("b", 4)] });
  const walls = deriveWalls(doc, pack);
  const shared = walls.find((w) => w.shared);
  assert.equal(shared.height, 2.8);
  assert.ok(shared.heightConflict);
  assert.match(compile(doc, pack).warnings.join("\n"), /different wall heights/);
  const quiet = normalizeDoc({ rooms: [room("a", 0, { wallHeight: 2.8 }), room("b", 4)] });
  assert.doesNotMatch(compile(quiet, pack).warnings.join("\n"), /different wall heights/);
});

test("Convert to drawn wall keeps height and replaces the generated piece", () => {
  const doc = normalizeDoc({ rooms: [room("a", 0, { wallHeight: 2.4 })] });
  const before = deriveWalls(doc, pack);
  const piece = before.find((w) => !w.drawn);
  const seg = drawnSegmentFromWall(piece, pack);
  assert.equal(seg.height, 2.4);
  assert.equal(seg.top, null);
  doc.segments.push(seg);
  const after = deriveWalls(normalizeDoc(doc), pack);
  const drawn = after.find((w) => w.id === seg.id);
  assert.equal(drawn.height, 2.4);
  assert.equal(after.filter((w) => !w.drawn).length, before.filter((w) => !w.drawn).length - 1);
});

test("opening size overrides: type values by default, own values when set", () => {
  const base = { id: "o", sku: "TSP_WN1212" };
  assert.deepEqual(openingSize(pack, base), { width: 1.2, height: 1.2, sill: 0.9, nonStandard: false });
  const sized = openingSize(pack, { ...base, width: 1.5, sill: 1.1 });
  assert.equal(sized.width, 1.5);
  assert.equal(sized.height, 1.2);
  assert.equal(sized.sill, 1.1);
  assert.equal(sized.nonStandard, true);
  // 900 x 1200 is a catalogue window, so resizing onto it is not an exception.
  assert.equal(openingSize(pack, { ...base, width: 0.9 }).nonStandard, false);
});

test("opening overrides survive normalizeDoc and drop when unusable", () => {
  const doc = normalizeDoc({ openings: [{ id: "o", sku: "TSP_WN1212", sill: 1, width: "x", height: -1 }] });
  assert.equal(doc.openings[0].sill, 1);
  assert.equal(doc.openings[0].width, null);
  assert.equal(doc.openings[0].height, null);
});

test("a resized window changes the sketch form, flags the row and raises a firm-to-confirm warning", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
    openings: [{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5, width: 1.5, sill: 1.0 }],
  });
  const out = compile(doc, pack);
  const row = out.instances.find((r) => r.elementId === "o1");
  assert.equal(row.nonStandardSize, true);
  const form = out.sketchForms.find((f) => f.elementId === "o1");
  assert.equal(form.sill, 1.0);
  assert.equal(form.profileLoops[0].length, 1.5);
  assert.match(out.warnings.join("\n"), /firm to confirm/);
});
