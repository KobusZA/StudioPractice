import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc } from "../model.js";
import { RIBBON, ribbonItems } from "../ribbon.js";
import {
  createSection,
  ensureSections,
  removeSection,
  sectionById,
  sectionFromClicks,
} from "../section.js";
import { createSheet, sheetView, setSheetView } from "../sheets.js";

function cut() {
  return sectionFromClicks([0, 0], [10, 0]);
}

// --- doc shape ------------------------------------------------------------

test("emptyDoc starts with no sections", () => {
  assert.deepEqual(emptyDoc().sections, []);
});

// --- createSection / removeSection / sectionById --------------------------

test("createSection refuses anything that is not a section cut", () => {
  const doc = emptyDoc();
  const result = createSection(doc, { mode: "look" });
  assert.equal(result.ok, false);
  assert.equal(doc.sections.length, 0);
});

test("createSection saves the cut and names sections in order, like Revit's Section tool", () => {
  const doc = emptyDoc();
  const first = createSection(doc, cut());
  const second = createSection(doc, cut());
  assert.equal(first.ok, true);
  assert.equal(first.section.name, "Section 1");
  assert.equal(second.section.name, "Section 2");
  assert.equal(doc.sections.length, 2);
});

test("createSection accepts an explicit name", () => {
  const doc = emptyDoc();
  const { section } = createSection(doc, cut(), { name: "Long section A-A" });
  assert.equal(section.name, "Long section A-A");
});

test("sectionById finds a section or returns null", () => {
  const doc = emptyDoc();
  const { section } = createSection(doc, cut());
  assert.equal(sectionById(doc, section.id), section);
  assert.equal(sectionById(doc, "nope"), null);
});

test("removeSection drops the section and reports whether one was found", () => {
  const doc = emptyDoc();
  const { section } = createSection(doc, cut());
  assert.equal(removeSection(doc, section.id), true);
  assert.equal(doc.sections.length, 0);
  assert.equal(removeSection(doc, section.id), false);
});

test("ensureSections lazily creates the array, once, without clobbering it", () => {
  const doc = emptyDoc();
  const first = ensureSections(doc);
  first.push({ id: "x" });
  const second = ensureSections(doc);
  assert.equal(second, first);
  assert.equal(doc.sections.length, 1);
});

// --- normalizeDoc round-trip -----------------------------------------------

test("normalizeDoc reads a saved section back", () => {
  const saved = createSection(emptyDoc(), cut(), { name: "Section A-A" });
  const doc = normalizeDoc({ sections: [saved.section] });
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].name, "Section A-A");
  assert.deepEqual(doc.sections[0].cut.origin, [0, 0]);
  assert.deepEqual(doc.sections[0].cut.along, [1, 0]);
});

test("normalizeDoc drops a section with a missing or malformed cut", () => {
  const doc = normalizeDoc({ sections: [{ id: "s1", name: "Bad" }, { id: "s2", cut: { origin: [0, 0] } }] });
  assert.equal(doc.sections.length, 0);
});

test("normalizeDoc tolerates a document written before sections existed", () => {
  const doc = normalizeDoc({ name: "Old Job" });
  assert.deepEqual(doc.sections, []);
});

// --- sheets: view chooser ---------------------------------------------------

test("createSheet defaults every sheet's viewport to the plan", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  assert.deepEqual(sheet.view, { kind: "plan" });
});

test("sheetView reads a section the doc still has", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { section } = createSection(doc, cut());
  setSheetView(sheet, { kind: "section", sectionId: section.id });
  assert.deepEqual(sheetView(doc, sheet), { kind: "section", sectionId: section.id });
});

test("sheetView falls back to plan once the referenced section is deleted", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { section } = createSection(doc, cut());
  setSheetView(sheet, { kind: "section", sectionId: section.id });
  removeSection(doc, section.id);
  assert.deepEqual(sheetView(doc, sheet), { kind: "plan" });
});

test("setSheetView refuses a section view with no sectionId, falling back to plan", () => {
  const sheet = { view: { kind: "plan" } };
  setSheetView(sheet, { kind: "section" });
  assert.deepEqual(sheet.view, { kind: "plan" });
});

// --- ribbon wiring ----------------------------------------------------

test("view-section is a live command, not a Week 3 todo, once sheets can hold a view", () => {
  const items = ribbonItems();
  const viewSection = items.get("view-section");
  assert.equal(viewSection.command, "view-section");
  assert.equal(viewSection.todo, undefined);
});

test("nothing in the customer's ribbon still calls view-section unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "view-section") assert.equal(item.todo, undefined);
      }
    }
  }
});
