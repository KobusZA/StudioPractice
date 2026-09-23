import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc } from "../model.js";
import { RIBBON, ribbonItems, HINTS } from "../ribbon.js";
import { createSheet, addRevision } from "../sheets.js";
import {
  revisionCloudFromClicks,
  createRevisionCloud,
  ensureRevisionClouds,
  revisionCloudById,
  removeRevisionCloud,
  linkRevisionCloud,
  revisionCloudsForSheet,
  cloudArcs,
  revisionCloudExtent,
  REVISION_CLOUD_MIN_SIZE_M,
} from "../revision.js";

// --- revisionCloudFromClicks -------------------------------------------

test("revisionCloudFromClicks refuses two clicks too close together to be a real cloud", () => {
  assert.equal(revisionCloudFromClicks([0, 0], [0.1, 0.1]), null);
});

test("revisionCloudFromClicks refuses non-finite input", () => {
  assert.equal(revisionCloudFromClicks([0, 0], [NaN, 1]), null);
});

test("revisionCloudFromClicks normalises either click order into a min/max rectangle", () => {
  const a = revisionCloudFromClicks([5, 5], [1, 2]);
  const b = revisionCloudFromClicks([1, 2], [5, 5]);
  assert.deepEqual(a, { minX: 1, minY: 2, maxX: 5, maxY: 5 });
  assert.deepEqual(b, a);
});

test("a box exactly at the minimum size is accepted, not refused", () => {
  const rect = revisionCloudFromClicks([0, 0], [REVISION_CLOUD_MIN_SIZE_M, REVISION_CLOUD_MIN_SIZE_M]);
  assert.ok(rect);
  assert.equal(rect.maxX - rect.minX, REVISION_CLOUD_MIN_SIZE_M);
});

// --- doc shape ----------------------------------------------------------

test("emptyDoc starts with no revision clouds", () => {
  assert.deepEqual(emptyDoc().revisionClouds, []);
});

// --- createRevisionCloud / removeRevisionCloud / revisionCloudById ------

test("createRevisionCloud refuses a malformed rectangle", () => {
  const doc = emptyDoc();
  const result = createRevisionCloud(doc, { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 });
  assert.equal(result.ok, false);
  assert.equal(doc.revisionClouds.length, 0);
});

test("createRevisionCloud refuses a missing rectangle entirely", () => {
  const doc = emptyDoc();
  assert.equal(createRevisionCloud(doc, null).ok, false);
});

test("createRevisionCloud always saves unlinked - linking is a separate, later step", () => {
  const doc = emptyDoc();
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  assert.equal(cloud.sheetId, null);
  assert.equal(cloud.rev, null);
  assert.equal(doc.revisionClouds.length, 1);
});

test("createRevisionCloud stamps the level it was drawn on", () => {
  const doc = emptyDoc();
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]), { level: "lvl-1" });
  assert.equal(cloud.level, "lvl-1");
});

test("revisionCloudById finds a cloud or returns null", () => {
  const doc = emptyDoc();
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  assert.equal(revisionCloudById(doc, cloud.id), cloud);
  assert.equal(revisionCloudById(doc, "nope"), null);
});

test("removeRevisionCloud drops the cloud and reports whether one was found", () => {
  const doc = emptyDoc();
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  assert.equal(removeRevisionCloud(doc, cloud.id), true);
  assert.equal(doc.revisionClouds.length, 0);
  assert.equal(removeRevisionCloud(doc, cloud.id), false);
});

test("ensureRevisionClouds lazily creates the array, once, without clobbering it", () => {
  const doc = emptyDoc();
  const first = ensureRevisionClouds(doc);
  first.push({ id: "x" });
  const second = ensureRevisionClouds(doc);
  assert.equal(second, first);
  assert.equal(doc.revisionClouds.length, 1);
});

// --- linkRevisionCloud: the one integrity block this file enforces ------

test("linkRevisionCloud refuses a sheet that has issued no revisions yet - never guesses one", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  const result = linkRevisionCloud(doc, cloud.id, sheet.id, "A");
  assert.equal(result.ok, false);
  assert.equal(cloud.sheetId, null);
  assert.equal(cloud.rev, null);
});

test("linkRevisionCloud refuses a sheet that does not exist", () => {
  const doc = emptyDoc();
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  const result = linkRevisionCloud(doc, cloud.id, "nope", "A");
  assert.equal(result.ok, false);
});

test("linkRevisionCloud refuses an unknown cloud id", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  addRevision(sheet, { description: "First issue" });
  assert.equal(linkRevisionCloud(doc, "nope", sheet.id, "A").ok, false);
});

test("linkRevisionCloud accepts a revision letter the sheet has actually issued", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  addRevision(sheet, { description: "First issue" });
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  const result = linkRevisionCloud(doc, cloud.id, sheet.id, "A");
  assert.equal(result.ok, true);
  assert.equal(cloud.sheetId, sheet.id);
  assert.equal(cloud.rev, "A");
});

test("linkRevisionCloud with a null rev unlinks the cloud", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  addRevision(sheet, { description: "First issue" });
  const { cloud } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  linkRevisionCloud(doc, cloud.id, sheet.id, "A");
  linkRevisionCloud(doc, cloud.id, sheet.id, null);
  assert.equal(cloud.sheetId, null);
  assert.equal(cloud.rev, null);
});

// --- revisionCloudsForSheet ----------------------------------------------

test("revisionCloudsForSheet returns only clouds linked to that sheet", () => {
  const doc = emptyDoc();
  const { sheet: sheetA } = createSheet(doc, {});
  const { sheet: sheetB } = createSheet(doc, {});
  addRevision(sheetA, { description: "A rev" });
  const { cloud: c1 } = createRevisionCloud(doc, revisionCloudFromClicks([0, 0], [2, 2]));
  const { cloud: c2 } = createRevisionCloud(doc, revisionCloudFromClicks([3, 3], [5, 5]));
  linkRevisionCloud(doc, c1.id, sheetA.id, "A");
  assert.deepEqual(revisionCloudsForSheet(doc, sheetA.id), [c1]);
  assert.deepEqual(revisionCloudsForSheet(doc, sheetB.id), []);
  void c2;
});

test("revisionCloudsForSheet returns nothing for a falsy sheet id", () => {
  const doc = emptyDoc();
  assert.deepEqual(revisionCloudsForSheet(doc, null), []);
});

// --- cloudArcs: the scalloped outline ------------------------------------

test("cloudArcs returns at least one bump per edge of a real rectangle", () => {
  const arcs = cloudArcs({ minX: 0, minY: 0, maxX: 4, maxY: 2 });
  assert.ok(arcs.length >= 4);
  for (const arc of arcs) {
    assert.ok(arc.r > 0);
    assert.ok(Number.isFinite(arc.cx) && Number.isFinite(arc.cy));
  }
});

test("cloudArcs returns nothing for a degenerate rectangle", () => {
  assert.deepEqual(cloudArcs({ minX: 0, minY: 0, maxX: 0, maxY: 5 }), []);
});

// --- revisionCloudExtent --------------------------------------------------

test("revisionCloudExtent reports the cloud's own box in metres", () => {
  const { cloud } = createRevisionCloud(emptyDoc(), revisionCloudFromClicks([2, 3], [5, 6]));
  assert.deepEqual(revisionCloudExtent(cloud), { minX: 2, minY: 3, maxX: 5, maxY: 6, w: 3, h: 3 });
});

// --- normalizeDoc round-trip ----------------------------------------------

test("normalizeDoc reads a saved, unlinked revision cloud back", () => {
  const saved = createRevisionCloud(emptyDoc(), revisionCloudFromClicks([0, 0], [3, 3]), { level: "lvl-1", note: "Kitchen window" });
  const doc = normalizeDoc({ revisionClouds: [saved.cloud] });
  assert.equal(doc.revisionClouds.length, 1);
  assert.equal(doc.revisionClouds[0].level, "lvl-1");
  assert.equal(doc.revisionClouds[0].note, "Kitchen window");
  assert.equal(doc.revisionClouds[0].sheetId, null);
});

test("normalizeDoc keeps a link whose sheet and revision both still exist", () => {
  const doc0 = emptyDoc();
  const { sheet } = createSheet(doc0, {});
  addRevision(sheet, { description: "First issue" });
  const { cloud } = createRevisionCloud(doc0, revisionCloudFromClicks([0, 0], [3, 3]));
  linkRevisionCloud(doc0, cloud.id, sheet.id, "A");
  const doc = normalizeDoc(doc0);
  assert.equal(doc.revisionClouds[0].sheetId, sheet.id);
  assert.equal(doc.revisionClouds[0].rev, "A");
});

test("normalizeDoc drops a link to a sheet that no longer exists, keeping the cloud unlinked", () => {
  const doc = normalizeDoc({
    revisionClouds: [
      { id: "rc1", rect: { minX: 0, minY: 0, maxX: 3, maxY: 3 }, sheetId: "gone", rev: "A" },
    ],
  });
  assert.equal(doc.revisionClouds.length, 1);
  assert.equal(doc.revisionClouds[0].sheetId, null);
  assert.equal(doc.revisionClouds[0].rev, null);
});

test("normalizeDoc drops a link to a revision the sheet never issued, keeping the cloud unlinked", () => {
  const raw = emptyDoc();
  raw.sheets = [{ id: "sh1", revisions: [{ rev: "A", description: "", date: "", by: "" }] }];
  raw.revisionClouds = [
    { id: "rc1", rect: { minX: 0, minY: 0, maxX: 3, maxY: 3 }, sheetId: "sh1", rev: "B" },
  ];
  const doc = normalizeDoc(raw);
  assert.equal(doc.revisionClouds[0].sheetId, null);
  assert.equal(doc.revisionClouds[0].rev, null);
});

test("normalizeDoc drops a revision cloud with a missing corner or too small a rectangle", () => {
  const doc = normalizeDoc({
    revisionClouds: [
      { id: "rc1" },
      { id: "rc2", rect: { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 } },
    ],
  });
  assert.equal(doc.revisionClouds.length, 0);
});

test("normalizeDoc tolerates a document written before revision clouds existed", () => {
  const doc = normalizeDoc({ name: "Old Job" });
  assert.deepEqual(doc.revisionClouds, []);
});

// --- ribbon wiring ----------------------------------------------------

test("revision cloud is a live command, not a Week 3 todo", () => {
  const items = ribbonItems();
  const revision = items.get("revision");
  assert.equal(revision.command, "revision");
  assert.equal(revision.todo, undefined);
});

test("nothing in the customer's ribbon still calls revision cloud unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "revision") assert.equal(item.todo, undefined);
      }
    }
  }
});

test("HINTS names a next-step hint for the revision cloud tool", () => {
  assert.equal(typeof HINTS.revision, "string");
});
