import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc } from "../model.js";
import { RIBBON, ribbonItems } from "../ribbon.js";
import {
  addRevision,
  createSheet,
  drawableAreaMm,
  ensureSheets,
  formatScale,
  latestRevision,
  paperSizeMm,
  recommendedScale,
  removeSheet,
  revisionLetter,
  sheetById,
  sheetScale,
  titleBlockFields,
  titleBlockLayout,
} from "../sheets.js";

// --- create / remove ---------------------------------------------------

test("ensureSheets lazily creates the array, once, without clobbering it", () => {
  const doc = emptyDoc();
  assert.deepEqual(doc.sheets, []);
  const first = ensureSheets(doc);
  first.push({ id: "x" });
  const second = ensureSheets(doc);
  assert.equal(second, first);
  assert.equal(doc.sheets.length, 1);
});

test("createSheet refuses an unknown paper size rather than guessing one", () => {
  const doc = emptyDoc();
  const result = createSheet(doc, { size: "A6" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unknown paper size/);
  assert.equal(doc.sheets.length, 0);
});

test("createSheet defaults to A1, a fresh name and an incrementing sheet number", () => {
  const doc = emptyDoc();
  const first = createSheet(doc, {});
  const second = createSheet(doc, {});
  assert.equal(first.sheet.size, "A1");
  assert.notEqual(first.sheet.number, second.sheet.number);
  assert.equal(doc.sheets.length, 2);
});

test("createSheet accepts an explicit name and number", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, { size: "A3", name: "Ground Floor Plan", number: "A-101" });
  assert.equal(sheet.size, "A3");
  assert.equal(sheet.name, "Ground Floor Plan");
  assert.equal(sheet.number, "A-101");
  assert.equal(sheet.drawingTitle, "Ground Floor Plan");
});

test("removeSheet drops the sheet and reports whether one was found", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  assert.equal(removeSheet(doc, sheet.id), true);
  assert.equal(doc.sheets.length, 0);
  assert.equal(removeSheet(doc, sheet.id), false);
});

test("sheetById finds a sheet or returns null", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  assert.equal(sheetById(doc, sheet.id), sheet);
  assert.equal(sheetById(doc, "nope"), null);
});

// --- revisions ----------------------------------------------------------

test("revisionLetter runs A..Z then AA, AB, ...", () => {
  assert.equal(revisionLetter(0), "A");
  assert.equal(revisionLetter(25), "Z");
  assert.equal(revisionLetter(26), "AA");
  assert.equal(revisionLetter(27), "AB");
  assert.equal(revisionLetter(51), "AZ");
  assert.equal(revisionLetter(52), "BA");
});

test("addRevision issues the next letter and never reuses one", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  assert.equal(latestRevision(sheet), "-");
  const a = addRevision(sheet, { description: "Issued for comment", by: "TS" });
  assert.equal(a.rev, "A");
  assert.equal(latestRevision(sheet), "A");
  const b = addRevision(sheet, { description: "Client comments" });
  assert.equal(b.rev, "B");
  assert.equal(sheet.revisions.length, 2);
});

test("addRevision on a missing sheet is a no-op, not a throw", () => {
  assert.equal(addRevision(null, { description: "x" }), null);
});

// --- paper sizes and scale -----------------------------------------------

test("paperSizeMm is landscape for every size and falls back to A1", () => {
  for (const size of ["A0", "A1", "A2", "A3", "A4"]) {
    const { w, h } = paperSizeMm(size);
    assert.ok(w > h, `${size} should be landscape`);
  }
  assert.deepEqual(paperSizeMm("bogus"), paperSizeMm("A1"));
});

test("drawableAreaMm removes the border and title block strip from the paper", () => {
  const { w, h } = drawableAreaMm({ size: "A3" });
  const paper = paperSizeMm("A3");
  assert.ok(w < paper.w);
  assert.ok(h < paper.h);
  assert.ok(w > 0 && h > 0);
});

test("recommendedScale picks the smallest N that fits the plan on the sheet", () => {
  const sheet = { size: "A3" };
  // A3 drawable area is roughly 340 x 277 mm; a 30 x 18 m plan at 1:100
  // draws at 300 x 180 mm, which fits, and 1:75 (400 x 240) does not.
  const n = recommendedScale(sheet, { w: 30, h: 18 });
  assert.equal(n, 100);
});

test("recommendedScale falls back to the most zoomed-out scale for an oversized plan", () => {
  const sheet = { size: "A4" };
  const n = recommendedScale(sheet, { w: 5000, h: 5000 });
  assert.equal(n, 1000);
});

test("recommendedScale never throws on a missing or zero extent", () => {
  const sheet = { size: "A1" };
  assert.doesNotThrow(() => recommendedScale(sheet, null));
  assert.doesNotThrow(() => recommendedScale(sheet, { w: 0, h: 0 }));
});

test("sheetScale prefers an explicit override over the recommendation", () => {
  const sheet = { size: "A3", scaleOverride: 50 };
  assert.equal(sheetScale(sheet, { w: 30, h: 18 }), 50);
});

test("formatScale renders 1:N or an em-dash for a non-finite scale", () => {
  assert.equal(formatScale(100), "1:100");
  assert.equal(formatScale(NaN), "—");
});

// --- title block fields ---------------------------------------------------

test("titleBlockFields prints an em-dash for every fact the document does not have", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const fields = titleBlockFields(doc, null, sheet, { w: 10, h: 10 });
  assert.equal(fields.projectName, "—");
  assert.equal(fields.erf, "—");
  assert.equal(fields.drawnBy, "—");
  assert.equal(fields.checkedBy, "—");
  assert.equal(fields.revision, "-");
});

test("titleBlockFields prints the job name, never the pack's", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const pack = { name: "TSP standard pack" };
  assert.equal(titleBlockFields(doc, pack, sheet, { w: 10, h: 10 }).projectName, "—");
  doc.name = "Smith Residence";
  assert.equal(titleBlockFields(doc, pack, sheet, { w: 10, h: 10 }).projectName, "Smith Residence");
});

test("titleBlockFields reads the project name, locale and erf once they exist", () => {
  const doc = emptyDoc();
  doc.name = "Smith Residence";
  doc.site = { erfNumber: "1234" };
  const { sheet } = createSheet(doc, { size: "A3", name: "Ground Floor Plan" });
  addRevision(sheet, { description: "Issued for comment" });
  const pack = { name: "TSP standard pack", locale: { municipality: "City of Cape Town" } };
  const fields = titleBlockFields(doc, pack, sheet, { w: 30, h: 18 });
  assert.equal(fields.projectName, "Smith Residence");
  assert.equal(fields.erf, "Erf 1234, City of Cape Town");
  assert.equal(fields.drawingTitle, "Ground Floor Plan");
  assert.equal(fields.revision, "A");
  assert.equal(fields.scale, "1:100");
});

test("titleBlockLayout exposes the same paper size and rows the field table uses", () => {
  const layout = titleBlockLayout("A3");
  assert.deepEqual(layout.paper, paperSizeMm("A3"));
  assert.equal(layout.rows[0].key, "projectName");
});

// --- ribbon wiring ----------------------------------------------------

test("Sheets is a live command, not a Week 3 todo, once this file exists", () => {
  const items = ribbonItems();
  const sheets = items.get("sheets");
  assert.equal(sheets.command, "sheets");
  assert.equal(sheets.todo, undefined);
});

test("nothing in the customer's ribbon still calls Sheets unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "sheets") assert.equal(item.todo, undefined);
      }
    }
  }
});
