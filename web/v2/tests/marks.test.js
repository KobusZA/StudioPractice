// Window and door marks: openings are identified by W1 / D1, never by size.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { compile } from "../compile.js";
import { normalizePackUnits } from "../schema.js";
import { bomRows, boqRows, familyHeadingAt } from "../schedule.js";
import {
  ensureOpeningMarks,
  formatMarks,
  markForNewOpening,
  remarkRetypedWindows,
  renameMark,
  shareWindowSize,
  captionBesideName,
  sizedTypeName,
  splitWindowType,
  windowsOfMark,
} from "../marks.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

const WIN = "TSP_WN1212";
const WIN_WIDE = "TSP_WN1812";
const DOOR = "TSP_DR900";

function jobDoc(openings) {
  return normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 20, y2: 0 }],
    openings: openings.map((o, i) => ({ wallId: "w1", t: (i + 1) / (openings.length + 1), ...o })),
  });
}

const byId = (doc, id) => doc.openings.find((o) => o.id === id);

test("windows of the same product and size share a type mark; every door gets its own number", () => {
  const doc = jobDoc([
    { id: "a", sku: WIN },
    { id: "b", sku: WIN },
    { id: "c", sku: WIN_WIDE },
    { id: "d", sku: DOOR },
    { id: "e", sku: DOOR },
  ]);
  assert.equal(ensureOpeningMarks(doc, pack), true);
  assert.deepEqual(doc.openings.map((o) => o.mark), ["W1", "W1", "W2", "D1", "D2"]);
  assert.equal(ensureOpeningMarks(doc, pack), false, "a second pass changes nothing");
});

test("a window resized off its catalogue size keeps its mark, and the type is the same size everywhere", () => {
  const doc = jobDoc([{ id: "a", sku: WIN }, { id: "b", sku: WIN }]);
  ensureOpeningMarks(doc, pack);
  byId(doc, "a").width = 1.5;
  assert.equal(shareWindowSize(doc, pack, "a"), 1);
  assert.equal(byId(doc, "b").width, 1.5);
  assert.deepEqual(doc.openings.map((o) => o.mark), ["W1", "W1"]);
  assert.equal(ensureOpeningMarks(doc, pack), false);
});

test("the BOQ line for a resized window type is its mark and its real size, not the catalogue size", () => {
  const doc = jobDoc([{ id: "a", sku: WIN }, { id: "b", sku: WIN }, { id: "c", sku: WIN }]);
  ensureOpeningMarks(doc, pack);
  splitWindowType(doc, pack, byId(doc, "c"));
  byId(doc, "a").width = 1.5;
  shareWindowSize(doc, pack, "a");

  const lines = bomRows(compile(doc, pack)).filter((r) => r.model === WIN);
  assert.equal(lines.length, 2);
  const [w1, w2] = lines;
  assert.equal(w1.code, "W1");
  assert.equal(w1.model, WIN, "the rate is still looked up on the catalogue product");
  assert.equal(w1.qty, 2);
  assert.match(w1.description, /1500 x 1200mm/);
  assert.match(w1.description, /based on TSP_WN1212/);
  assert.doesNotMatch(w1.description, /^W1/);
  assert.equal(w2.code, "W2");
  assert.equal(w2.qty, 1);
  assert.match(w2.description, /1200 x 1200mm/);
  assert.doesNotMatch(w2.description, /non-standard/);
  assert.equal(familyHeadingAt(lines, 0), "Fixed");
  assert.equal(familyHeadingAt(lines, 1), null);
});

test("a priced line states the drawn size even when the rate book names the catalogue size", () => {
  const rateBook = JSON.parse(readFileSync(new URL("../../samples/tsp-rates.json", import.meta.url)));
  assert.ok(rateBook.rates.some((r) => r.model === WIN && /1200 × 1200mm/.test(r.description)));
  const doc = jobDoc([{ id: "a", sku: WIN, width: 0.6, height: 0.9 }]);
  ensureOpeningMarks(doc, pack);
  const line = boqRows(compile(doc, pack), rateBook).find((r) => r.model === WIN);
  assert.equal(line.priced, true);
  assert.equal(line.code, "W1");
  assert.equal(line.model, WIN);
  assert.equal(line.rate, 4900);
  assert.match(line.description, /^Window 600 x 900mm/);
  assert.match(line.description, /based on TSP_WN1212/);
  assert.doesNotMatch(line.description, /1200/);
});

test("a type name that already starts with its family is not repeated in the description", () => {
  const tsp = normalizePackUnits(JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))));
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: tsp.skus.find((s) => s.category === "wall").id, level: tsp.levels[0]?.id, x1: 0, y1: 0, x2: 10, y2: 0 }],
    openings: [{ id: "a", sku: "TSP_WIN_600_X_900MM", wallId: "w1", t: 0.5, width: 1.2 }],
  });
  ensureOpeningMarks(doc, tsp);
  const line = bomRows(compile(doc, tsp)).find((r) => r.model === "TSP_WIN_600_X_900MM");
  assert.equal(line.code, "W1");
  assert.match(line.description, /^Window-Fixed — 1200 x 900mm/);
  assert.doesNotMatch(line.description, /Window-Fixed Window-Fixed/);
});

test("doors of the same type and size are one BOQ line listing their numbers", () => {
  const doc = jobDoc([{ id: "d1", sku: DOOR }, { id: "d2", sku: DOOR }, { id: "d3", sku: DOOR }]);
  ensureOpeningMarks(doc, pack);
  byId(doc, "d3").width = 1.0;
  const lines = bomRows(compile(doc, pack)).filter((r) => r.model === DOOR);
  assert.equal(lines.length, 2);
  const standard = lines.find((l) => l.marks.length === 2);
  assert.equal(standard.qty, 2);
  assert.equal(standard.code, "D1–D2");
  assert.doesNotMatch(standard.description, /^D1/);
  const wide = lines.find((l) => l.marks.length === 1);
  assert.deepEqual(wide.marks, ["D3"]);
  assert.match(wide.description, /1000 x 2100mm/);
  assert.deepEqual(standard.elements.map((e) => e.mark), ["D1", "D2"]);
});

test("a new window joins the type it matches; a new door takes the next number", () => {
  const doc = jobDoc([{ id: "a", sku: WIN }, { id: "d", sku: DOOR }]);
  ensureOpeningMarks(doc, pack);
  assert.equal(markForNewOpening(doc, pack, { id: "n1", sku: WIN }), "W1");
  assert.equal(markForNewOpening(doc, pack, { id: "n2", sku: WIN_WIDE }), "W2");
  assert.equal(markForNewOpening(doc, pack, { id: "n3", sku: DOOR }), "D2");
  assert.equal(markForNewOpening(doc, pack, { id: "n4", sku: "TSP_NOT_A_SKU" }), null);
});

test("a repeated door number or a window mark on two different sizes is repaired on load", () => {
  const doc = jobDoc([
    { id: "d1", sku: DOOR, mark: "D1" },
    { id: "d2", sku: DOOR, mark: "D1" },
    { id: "a", sku: WIN, mark: "W1" },
    { id: "b", sku: WIN_WIDE, mark: "W1" },
  ]);
  ensureOpeningMarks(doc, pack);
  assert.deepEqual(doc.openings.map((o) => o.mark), ["D1", "D2", "W1", "W2"]);
});

test("a split-off window becomes a new type whose size no longer follows the old one", () => {
  const doc = jobDoc([{ id: "a", sku: WIN }, { id: "b", sku: WIN }]);
  ensureOpeningMarks(doc, pack);
  assert.equal(splitWindowType(doc, pack, byId(doc, "b")), "W2");
  byId(doc, "b").height = 0.9;
  assert.equal(shareWindowSize(doc, pack, "b"), 0);
  assert.equal(byId(doc, "a").height, null);
});

test("renaming a window mark renames the type; a door number must stay unique", () => {
  const doc = jobDoc([
    { id: "a", sku: WIN }, { id: "b", sku: WIN }, { id: "c", sku: WIN_WIDE },
    { id: "d1", sku: DOOR }, { id: "d2", sku: DOOR },
  ]);
  ensureOpeningMarks(doc, pack);

  const renamed = renameMark(doc, pack, byId(doc, "a"), "W10");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.count, 2);
  assert.deepEqual(windowsOfMark(doc, pack, "W10").map((o) => o.id), ["a", "b"]);

  assert.equal(renameMark(doc, pack, byId(doc, "c"), "W10").ok, false, "a different size cannot share W10");
  assert.equal(renameMark(doc, pack, byId(doc, "d2"), "D1").ok, false);
  assert.equal(renameMark(doc, pack, byId(doc, "d2"), "W2").ok, false, "a door cannot take a window's mark");
  assert.equal(renameMark(doc, pack, byId(doc, "d2"), "").ok, false);
  assert.equal(renameMark(doc, pack, byId(doc, "d2"), "D1.03").ok, true);
  assert.equal(byId(doc, "d2").mark, "D1.03");
});

test("retyping part of a window type re-marks it; retyping the whole type keeps the mark", () => {
  const doc = jobDoc([{ id: "a", sku: WIN }, { id: "b", sku: WIN }, { id: "c", sku: WIN }]);
  ensureOpeningMarks(doc, pack);

  byId(doc, "c").sku = WIN_WIDE;
  remarkRetypedWindows(doc, pack, ["c"]);
  assert.equal(byId(doc, "c").mark, "W2");

  byId(doc, "a").sku = WIN_WIDE;
  byId(doc, "b").sku = WIN_WIDE;
  remarkRetypedWindows(doc, pack, ["a", "b"]);
  assert.deepEqual(doc.openings.map((o) => o.mark), ["W1", "W1", "W2"]);
});

test("formatMarks sorts and closes up runs", () => {
  assert.equal(formatMarks(["D3", "D1", "D2", "D5", "D10"]), "D1–D3, D5, D10");
  assert.equal(formatMarks(["W2"]), "W2");
  assert.equal(formatMarks(["D1.03", "D1"]), "D1, D1.03");
  assert.equal(formatMarks([]), "");
});

test("sizedTypeName swaps the catalogue size in the name for the actual one", () => {
  assert.equal(sizedTypeName({ name: "Window-Fixed — 600 x 900mm" }, { width: 1.2, height: 0.9 }), "Window-Fixed — 1200 x 900mm");
  assert.equal(sizedTypeName({ name: "Window 1200 × 1200mm" }, { width: 1.5, height: 1.2 }), "Window 1500 x 1200mm");
  assert.equal(sizedTypeName({ name: "Arch" }, { width: 0.9, height: 2.1 }), "Arch 900 x 2100mm");
});

test("a type caption is not repeated beside a name that already states it", () => {
  assert.equal(captionBesideName("Window-Fixed — 950 x 1400mm", "950 × 1400 mm"), "");
  assert.equal(captionBesideName("Masonry wall 110mm (plaster)", "110 mm masonry + plaster (130 mm overall)"), "");
  assert.equal(captionBesideName("Meranti door", "813 × 2032 mm"), "813 × 2032 mm");
  assert.equal(captionBesideName("Window-Fixed — 950 x 1400mm", "950 × 1400 mm, arched head"), "arched head");
  assert.equal(captionBesideName("Window-Fixed — 950 x 1400mm", "Multiple sizes"), "Multiple sizes");
  assert.equal(captionBesideName("Wall 1100mm", "110 mm"), "110 mm");
});

test("marks survive a save and reload, and the plan form carries the tag", () => {
  const doc = jobDoc([{ id: "a", sku: WIN }, { id: "d", sku: DOOR }]);
  ensureOpeningMarks(doc, pack);
  const again = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(again.openings.map((o) => o.mark), ["W1", "D1"]);
  const forms = compile(again, pack).sketchForms.filter((f) => f.selectKind === "opening");
  assert.deepEqual(forms.map((f) => f.mark), ["W1", "D1"]);
  for (const form of forms) assert.ok(Math.abs(Math.hypot(form.markSide.x, form.markSide.y) - 1) < 1e-9);
});
