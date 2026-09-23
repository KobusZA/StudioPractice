import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc } from "../model.js";
import { RIBBON, ribbonItems } from "../ribbon.js";
import {
  calloutFromClicks,
  createCallout,
  ensureCallouts,
  calloutById,
  calloutExtent,
  removeCallout,
  CALLOUT_MIN_SIZE_M,
} from "../callout.js";
import { createSheet, sheetView, setSheetView, sheetScale, titleBlockFields } from "../sheets.js";

// --- calloutFromClicks -------------------------------------------------------

test("calloutFromClicks refuses two clicks too close together to be a real crop", () => {
  assert.equal(calloutFromClicks([0, 0], [0.1, 0.1]), null);
});

test("calloutFromClicks refuses non-finite input", () => {
  assert.equal(calloutFromClicks([0, 0], [NaN, 1]), null);
});

test("calloutFromClicks normalises either click order into a min/max rectangle", () => {
  const a = calloutFromClicks([5, 5], [1, 2]);
  const b = calloutFromClicks([1, 2], [5, 5]);
  assert.deepEqual(a, { minX: 1, minY: 2, maxX: 5, maxY: 5 });
  assert.deepEqual(b, a);
});

test("a box exactly at the minimum size is accepted, not refused", () => {
  const rect = calloutFromClicks([0, 0], [CALLOUT_MIN_SIZE_M, CALLOUT_MIN_SIZE_M]);
  assert.ok(rect);
  assert.equal(rect.maxX - rect.minX, CALLOUT_MIN_SIZE_M);
});

// --- doc shape ---------------------------------------------------------

test("emptyDoc starts with no callouts", () => {
  assert.deepEqual(emptyDoc().callouts, []);
});

// --- createCallout / removeCallout / calloutById ----------------------------

test("createCallout refuses a malformed rectangle", () => {
  const doc = emptyDoc();
  const result = createCallout(doc, { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 });
  assert.equal(result.ok, false);
  assert.equal(doc.callouts.length, 0);
});

test("createCallout refuses a missing rectangle entirely", () => {
  const doc = emptyDoc();
  const result = createCallout(doc, null);
  assert.equal(result.ok, false);
});

test("createCallout saves the crop and names callouts in order, like Revit's callout head numbering", () => {
  const doc = emptyDoc();
  const first = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  const second = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  assert.equal(first.ok, true);
  assert.equal(first.callout.name, "Callout 1");
  assert.equal(second.callout.name, "Callout 2");
  assert.equal(doc.callouts.length, 2);
});

test("createCallout accepts an explicit name", () => {
  const doc = emptyDoc();
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]), { name: "Kitchen detail" });
  assert.equal(callout.name, "Kitchen detail");
});

test("createCallout's scale (the blow-up factor) is null unless explicitly supplied - unknown is never a plausible default", () => {
  const doc = emptyDoc();
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  assert.equal(callout.scale, null);
});

test("createCallout accepts an explicit blow-up scale", () => {
  const doc = emptyDoc();
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]), { scale: 20 });
  assert.equal(callout.scale, 20);
});

test("createCallout rejects a non-positive scale rather than saving a nonsense magnification", () => {
  const doc = emptyDoc();
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]), { scale: -5 });
  assert.equal(callout.scale, null);
});

test("calloutById finds a callout or returns null", () => {
  const doc = emptyDoc();
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  assert.equal(calloutById(doc, callout.id), callout);
  assert.equal(calloutById(doc, "nope"), null);
});

test("removeCallout drops the callout and reports whether one was found", () => {
  const doc = emptyDoc();
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  assert.equal(removeCallout(doc, callout.id), true);
  assert.equal(doc.callouts.length, 0);
  assert.equal(removeCallout(doc, callout.id), false);
});

test("ensureCallouts lazily creates the array, once, without clobbering it", () => {
  const doc = emptyDoc();
  const first = ensureCallouts(doc);
  first.push({ id: "x" });
  const second = ensureCallouts(doc);
  assert.equal(second, first);
  assert.equal(doc.callouts.length, 1);
});

// --- calloutExtent -----------------------------------------------------

test("calloutExtent reports the crop's own box in metres", () => {
  const { callout } = createCallout(emptyDoc(), calloutFromClicks([2, 3], [8, 5]));
  assert.deepEqual(calloutExtent(callout), { minX: 2, minY: 3, maxX: 8, maxY: 5, w: 6, h: 2 });
});

// --- normalizeDoc round-trip -------------------------------------------

test("normalizeDoc reads a saved callout back", () => {
  const saved = createCallout(emptyDoc(), calloutFromClicks([0, 0], [4, 4]), { name: "Bathroom detail", scale: 20 });
  const doc = normalizeDoc({ callouts: [saved.callout] });
  assert.equal(doc.callouts.length, 1);
  assert.equal(doc.callouts[0].name, "Bathroom detail");
  assert.equal(doc.callouts[0].scale, 20);
  assert.deepEqual(doc.callouts[0].rect, { minX: 0, minY: 0, maxX: 4, maxY: 4 });
});

test("normalizeDoc drops a callout with a missing corner or too small a rectangle", () => {
  const doc = normalizeDoc({
    callouts: [
      { id: "c1", name: "No rect" },
      { id: "c2", rect: { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 } },
    ],
  });
  assert.equal(doc.callouts.length, 0);
});

test("normalizeDoc tolerates a document written before callouts existed", () => {
  const doc = normalizeDoc({ name: "Old Job" });
  assert.deepEqual(doc.callouts, []);
});

// --- sheets: view chooser now knows callouts too ----------------------------

test("sheetView reads a callout the doc still has", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  setSheetView(sheet, { kind: "callout", calloutId: callout.id });
  assert.deepEqual(sheetView(doc, sheet), { kind: "callout", calloutId: callout.id });
});

test("sheetView falls back to plan once the referenced callout is deleted", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { callout } = createCallout(doc, calloutFromClicks([0, 0], [3, 3]));
  setSheetView(sheet, { kind: "callout", calloutId: callout.id });
  removeCallout(doc, callout.id);
  assert.deepEqual(sheetView(doc, sheet), { kind: "plan" });
});

test("setSheetView refuses a callout view with no calloutId, falling back to plan", () => {
  const sheet = { view: { kind: "plan" } };
  setSheetView(sheet, { kind: "callout" });
  assert.deepEqual(sheet.view, { kind: "plan" });
});

// --- sheets: a callout's own scale is its blow-up factor --------------------

test("sheetScale prefers a callout's own scale over the auto-fit recommendation", () => {
  const sheet = { size: "A3", scaleOverride: null };
  // A tiny 3x3m extent would auto-fit at a very small N; the callout's own
  // scale (a deliberate blow-up) should win instead.
  assert.equal(sheetScale(sheet, { w: 3, h: 3 }, 20), 20);
});

test("sheetScale still lets the sheet's own override win over a callout's scale", () => {
  const sheet = { size: "A3", scaleOverride: 50 };
  assert.equal(sheetScale(sheet, { w: 3, h: 3 }, 20), 50);
});

test("titleBlockFields' scale row honours a preferred (callout) scale", () => {
  const doc = emptyDoc();
  const sheet = { size: "A3", scaleOverride: null, revisions: [] };
  const fields = titleBlockFields(doc, { skus: [] }, sheet, { w: 3, h: 3 }, 20);
  assert.equal(fields.scale, "1:20");
});

// --- ribbon wiring ----------------------------------------------------

test("callout is a live command, not a Week 3 todo", () => {
  const items = ribbonItems();
  const callout = items.get("callout");
  assert.equal(callout.command, "callout");
  assert.equal(callout.todo, undefined);
});

test("nothing in the customer's ribbon still calls callout unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "callout") assert.equal(item.todo, undefined);
      }
    }
  }
});
