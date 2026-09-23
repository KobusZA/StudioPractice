import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyDoc, normalizeDoc } from "../model.js";
import { RIBBON, ribbonItems } from "../ribbon.js";
import { addRevision, createSheet, titleBlockFields } from "../sheets.js";

// --- doc shape --------------------------------------------------------

test("emptyDoc starts with an unset, not absent, projectInfo record", () => {
  const doc = emptyDoc();
  assert.deepEqual(doc.projectInfo, { jobNumber: null, clientName: null });
});

test("normalizeDoc reads a stored job number and client name", () => {
  const doc = normalizeDoc({ projectInfo: { jobNumber: "2026-014", clientName: "Smith Family Trust" } });
  assert.equal(doc.projectInfo.jobNumber, "2026-014");
  assert.equal(doc.projectInfo.clientName, "Smith Family Trust");
});

test("normalizeDoc trims blank strings to null, the same rule doc.name follows", () => {
  const doc = normalizeDoc({ projectInfo: { jobNumber: "   ", clientName: "" } });
  assert.equal(doc.projectInfo.jobNumber, null);
  assert.equal(doc.projectInfo.clientName, null);
});

test("normalizeDoc tolerates a document written before projectInfo existed", () => {
  const doc = normalizeDoc({ name: "Old Job" });
  assert.deepEqual(doc.projectInfo, { jobNumber: null, clientName: null });
});

// --- title block --------------------------------------------------------

test("titleBlockFields prints an em-dash for job number and client name until set", () => {
  const doc = emptyDoc();
  const { sheet } = createSheet(doc, {});
  const fields = titleBlockFields(doc, null, sheet, { w: 10, h: 10 });
  assert.equal(fields.jobNumber, "—");
  assert.equal(fields.clientName, "—");
});

test("titleBlockFields reads the job number and client name once project-info sets them", () => {
  const doc = emptyDoc();
  doc.projectInfo = { jobNumber: "2026-014", clientName: "Smith Family Trust" };
  const { sheet } = createSheet(doc, {});
  addRevision(sheet, { description: "Issued for comment" });
  const fields = titleBlockFields(doc, null, sheet, { w: 10, h: 10 });
  assert.equal(fields.jobNumber, "2026-014");
  assert.equal(fields.clientName, "Smith Family Trust");
});

// --- ribbon wiring ----------------------------------------------------

test("Project information is a live command, not a Week 3 todo, once this file exists", () => {
  const items = ribbonItems();
  const info = items.get("project-info");
  assert.equal(info.command, "project-info");
  assert.equal(info.todo, undefined);
});

test("nothing in the customer's ribbon still calls Project information unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "project-info") assert.equal(item.todo, undefined);
      }
    }
  }
});
