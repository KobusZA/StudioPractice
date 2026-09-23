import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc } from "../model.js";
import { RIBBON, ribbonItems } from "../ribbon.js";
import {
  createElevation,
  ensureElevations,
  elevationById,
  elevationCut,
  elevationDirectionLabel,
  removeElevation,
  ELEVATION_DIRECTIONS,
} from "../elevation.js";
import { createSheet, sheetView, setSheetView } from "../sheets.js";

// --- elevationCut -----------------------------------------------------------

test("elevationCut refuses anything that is not a compass direction", () => {
  assert.equal(elevationCut("NE"), null);
  assert.equal(elevationCut(""), null);
});

test("elevationCut's look/along agree with Revit's compass convention: facing north, east is on your right", () => {
  const cut = elevationCut("N");
  assert.deepEqual(cut.look, [0, 1]);
  assert.deepEqual(cut.along, [1, 0]);
});

test("every elevation direction has a label", () => {
  for (const dir of ELEVATION_DIRECTIONS) {
    assert.ok(elevationDirectionLabel(dir), `${dir} has a label`);
  }
  assert.equal(elevationDirectionLabel("NE"), null);
});

// --- doc shape ---------------------------------------------------------

test("emptyDoc starts with no elevations", () => {
  assert.deepEqual(emptyDoc().elevations, []);
});

// --- createElevation / removeElevation / elevationById ---------------------

test("createElevation refuses an unknown direction", () => {
  const doc = emptyDoc();
  const result = createElevation(doc, "NE");
  assert.equal(result.ok, false);
  assert.equal(doc.elevations.length, 0);
});

test("createElevation saves the cut and names elevations after their compass side, like Revit's Elevation tool", () => {
  const doc = emptyDoc();
  const north = createElevation(doc, "N");
  const east = createElevation(doc, "E");
  assert.equal(north.ok, true);
  assert.equal(north.elevation.name, "North elevation");
  assert.equal(east.elevation.name, "East elevation");
  assert.equal(doc.elevations.length, 2);
});

test("a second elevation on the same side gets its own name instead of colliding", () => {
  const doc = emptyDoc();
  createElevation(doc, "N");
  const second = createElevation(doc, "N");
  assert.equal(second.elevation.name, "North elevation 2");
});

test("createElevation accepts an explicit name", () => {
  const doc = emptyDoc();
  const { elevation } = createElevation(doc, "S", { name: "Rear elevation" });
  assert.equal(elevation.name, "Rear elevation");
});

test("elevationById finds an elevation or returns null", () => {
  const doc = emptyDoc();
  const { elevation } = createElevation(doc, "W");
  assert.equal(elevationById(doc, elevation.id), elevation);
  assert.equal(elevationById(doc, "nope"), null);
});

test("removeElevation drops the elevation and reports whether one was found", () => {
  const doc = emptyDoc();
  const { elevation } = createElevation(doc, "N");
  assert.equal(removeElevation(doc, elevation.id), true);
  assert.equal(doc.elevations.length, 0);
  assert.equal(removeElevation(doc, elevation.id), false);
});

test("ensureElevations lazily creates the array, once, without clobbering it", () => {
  const doc = emptyDoc();
  const first = ensureElevations(doc);
  first.push({ id: "x" });
  const second = ensureElevations(doc);
  assert.equal(second, first);
  assert.equal(doc.elevations.length, 1);
});

// --- normalizeDoc round-trip -------------------------------------------

test("normalizeDoc reads a saved elevation back", () => {
  const saved = createElevation(emptyDoc(), "E", { name: "East elevation" });
  const doc = normalizeDoc({ elevations: [saved.elevation] });
  assert.equal(doc.elevations.length, 1);
  assert.equal(doc.elevations[0].name, "East elevation");
  assert.equal(doc.elevations[0].cut.direction, "E");
  assert.deepEqual(doc.elevations[0].cut.look, [1, 0]);
});

test("normalizeDoc drops an elevation with a missing or unrecognised direction", () => {
  const doc = normalizeDoc({
    elevations: [
      { id: "e1", name: "Bad" },
      { id: "e2", cut: { direction: "NE", origin: [0, 0], along: [1, 0], look: [0, 1] } },
    ],
  });
  assert.equal(doc.elevations.length, 0);
});

test("normalizeDoc tolerates a document written before elevations existed", () => {
  const doc = normalizeDoc({ name: "Old Job" });
  assert.deepEqual(doc.elevations, []);
});

// --- sheets: view chooser now knows elevations too --------------------------

test("sheetView reads an elevation the doc still has", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { elevation } = createElevation(doc, "N");
  setSheetView(sheet, { kind: "elevation", elevationId: elevation.id });
  assert.deepEqual(sheetView(doc, sheet), { kind: "elevation", elevationId: elevation.id });
});

test("sheetView falls back to plan once the referenced elevation is deleted", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { elevation } = createElevation(doc, "N");
  setSheetView(sheet, { kind: "elevation", elevationId: elevation.id });
  removeElevation(doc, elevation.id);
  assert.deepEqual(sheetView(doc, sheet), { kind: "plan" });
});

test("setSheetView refuses an elevation view with no elevationId, falling back to plan", () => {
  const sheet = { view: { kind: "plan" } };
  setSheetView(sheet, { kind: "elevation" });
  assert.deepEqual(sheet.view, { kind: "plan" });
});

// --- ribbon wiring ----------------------------------------------------

test("elevation is a live command, not a Week 3 todo", () => {
  const items = ribbonItems();
  const elevation = items.get("elevation");
  assert.equal(elevation.command, "elevation");
  assert.equal(elevation.todo, undefined);
});

test("nothing in the customer's ribbon still calls elevation unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "elevation") assert.equal(item.todo, undefined);
      }
    }
  }
});
