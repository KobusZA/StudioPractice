import { test } from "node:test";
import assert from "node:assert/strict";

import { collectionFor, emptyDoc, hasJobContent, LINE_KINDS, normalizeDoc } from "../model.js";
import { RIBBON, ribbonItems } from "../ribbon.js";
import {
  alignSelection,
  attachSelection,
  copySelection,
  cutSelection,
  detachSelection,
  joinSelection,
  mirrorSelection,
  rotateSelection,
} from "../modify.js";

function docWith(overrides = {}) {
  return { ...emptyDoc(), ...overrides };
}

function line(id, x1, y1, x2, y2, kind = "model", extra = {}) {
  return { id, kind, level: null, x1, y1, x2, y2, status: "planned", ...extra };
}

const ref = (kind, id) => ({ kind, id });

// --- doc shape --------------------------------------------------------

test("emptyDoc starts with no lines", () => {
  assert.deepEqual(emptyDoc().lines, []);
});

test("LINE_KINDS names exactly the two ribbon buttons", () => {
  assert.deepEqual(LINE_KINDS, ["model", "annotation"]);
});

test("collectionFor resolves the line kind to doc.lines", () => {
  const doc = emptyDoc();
  assert.equal(collectionFor(doc, "line"), doc.lines);
});

// --- normalizeDoc round-trip -------------------------------------------

test("normalizeDoc reads a saved model line and a saved annotation line back", () => {
  const doc = normalizeDoc({
    lines: [
      line("l1", 0, 0, 4, 0, "model"),
      line("l2", 1, 1, 1, 5, "annotation"),
    ],
  });
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].kind, "model");
  assert.equal(doc.lines[1].kind, "annotation");
});

test("normalizeDoc drops a line missing an endpoint", () => {
  const doc = normalizeDoc({ lines: [{ id: "l1", kind: "model", x1: 0, y1: 0, x2: 4 }] });
  assert.equal(doc.lines.length, 0);
});

test("normalizeDoc drops a line with an unrecognised kind rather than guessing which ribbon button drew it", () => {
  const doc = normalizeDoc({ lines: [{ id: "l1", kind: "detail", x1: 0, y1: 0, x2: 4, y2: 0 }] });
  assert.equal(doc.lines.length, 0);
});

test("normalizeDoc defaults a missing status to planned, like every other drawn object", () => {
  const doc = normalizeDoc({ lines: [{ id: "l1", kind: "model", x1: 0, y1: 0, x2: 4, y2: 0 }] });
  assert.equal(doc.lines[0].status, "planned");
});

test("normalizeDoc keeps an existing line's status", () => {
  const doc = normalizeDoc({ lines: [{ id: "l1", kind: "model", x1: 0, y1: 0, x2: 4, y2: 0, status: "existing" }] });
  assert.equal(doc.lines[0].status, "existing");
});

test("normalizeDoc tolerates a document written before lines existed", () => {
  const doc = normalizeDoc({ name: "Old Job" });
  assert.deepEqual(doc.lines, []);
});

test("hasJobContent counts a lines-only job as real work", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 4, 0)] });
  assert.equal(hasJobContent(doc), true);
});

// --- modify.js: a line is endpoint geometry, like a wall or beam -----------

test("rotating a line about the selection centre turns it a quarter turn", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 4, 0)] });
  const result = rotateSelection(doc, [ref("line", "l1")]);
  assert.equal(result.ok, true);
  const l = doc.lines[0];
  // A horizontal line's own centre is (2, 0); a quarter turn about it
  // leaves the line vertical, still 4 m long, straddling that same centre.
  assert.equal(l.x1, l.x2);
  assert.equal(Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 4);
});

test("mirroring a line flips it about the selection's own centre", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 4, 0)] });
  mirrorSelection(doc, [ref("line", "l1")]);
  assert.equal(doc.lines[0].x1, 4);
  assert.equal(doc.lines[0].x2, 0);
});

test("copying a line duplicates it offset to the right", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 4, 0)] });
  const result = copySelection(doc, [ref("line", "l1")]);
  assert.equal(result.ok, true);
  assert.equal(doc.lines.length, 2);
  assert.notEqual(doc.lines[1].id, doc.lines[0].id);
  assert.ok(doc.lines[1].x1 > doc.lines[0].x1);
});

test("aligning lines moves one to the anchor's edge", () => {
  const doc = docWith({ lines: [line("a", 0, 0, 2, 0), line("b", 5, 3, 7, 3)] });
  const result = alignSelection(doc, [ref("line", "a"), ref("line", "b")], { edge: "left", anchorRef: ref("line", "a") });
  assert.equal(result.ok, true);
  assert.equal(doc.lines[1].x1, 0);
});

test("cutting a line breaks it in two at its midpoint", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 6, 0)] });
  const result = cutSelection(doc, [ref("line", "l1")]);
  assert.equal(result.ok, true);
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].x2, 3);
  assert.equal(doc.lines[1].x1, 3);
});

test("join welds two collinear lines that meet end to end", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 3, 0), line("l2", 3, 0, 6, 0)] });
  const result = joinSelection(doc, [ref("line", "l1"), ref("line", "l2")]);
  assert.equal(result.ok, true);
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0].x1, 0);
  assert.equal(doc.lines[0].x2, 6);
});

test("join refuses a line joined to a wall - one kind at a time", () => {
  const doc = docWith({
    lines: [line("l1", 0, 0, 3, 0)],
    segments: [{ id: "w1", sku: "W1", x1: 3, y1: 0, x2: 6, y2: 0, status: "planned" }],
  });
  const result = joinSelection(doc, [ref("line", "l1"), ref("segment", "w1")]);
  assert.equal(result.ok, false);
});

// --- attach/detach stay wall/beam only, unlike the other modify ops --------

test("attach refuses a line - a line has no top to attach to and no base to resolve", () => {
  const doc = docWith({
    lines: [line("l1", 0, 0, 4, 0)],
    segments: [{ id: "w1", sku: "W1", x1: 0, y1: 0, x2: 4, y2: 0, status: "planned" }],
  });
  const result = attachSelection(doc, [ref("line", "l1")], { pack: { levels: [] }, targetRef: ref("segment", "w1") });
  assert.equal(result.ok, false);
  assert.match(result.message, /walls and beams/);
});

test("attach refuses a line as the target too", () => {
  const doc = docWith({
    lines: [line("l1", 0, 0, 4, 0)],
    segments: [{ id: "w1", sku: "W1", x1: 0, y1: 4, x2: 4, y2: 4, status: "planned" }],
  });
  const result = attachSelection(doc, [ref("segment", "w1")], { pack: { levels: [] }, targetRef: ref("line", "l1") });
  assert.equal(result.ok, false);
});

test("detach finds nothing to do on a line selection", () => {
  const doc = docWith({ lines: [line("l1", 0, 0, 4, 0)] });
  const result = detachSelection(doc, [ref("line", "l1")], { pack: { levels: [] } });
  assert.equal(result.ok, false);
  assert.match(result.message, /walls and beams/);
});

// --- ribbon wiring ----------------------------------------------------

test("model-lines and annot-lines are live commands, not Week 3 todos", () => {
  const items = ribbonItems();
  assert.equal(items.get("model-lines").command, "model-lines");
  assert.equal(items.get("model-lines").todo, undefined);
  assert.equal(items.get("annot-lines").command, "annot-lines");
  assert.equal(items.get("annot-lines").todo, undefined);
});

test("nothing in the customer's ribbon still calls the two line buttons unfinished", () => {
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.id === "model-lines" || item.id === "annot-lines") assert.equal(item.todo, undefined);
      }
    }
  }
});
