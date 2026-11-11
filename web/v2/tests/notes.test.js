import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TEXT_STYLES,
  cleanOverride,
  createNote,
  cssFont,
  dimensionGeometry,
  dimensionLabel,
  leaderStart,
  normalizeNote,
  offsetThrough,
  overriddenKeys,
  readableAngle,
  resolveTextLook,
  setOverride,
  styleFromObject,
  textHeightM,
  textStyleList,
  toggleOverride,
  wrapNoteLines,
} from "../notes.js";
import { PlanStore, emptyDoc, hasJobContent, hasPlanDrawing, normalizeDoc } from "../model.js";
import { copySelection, rotateSelection } from "../modify.js";

const styles = DEFAULT_TEXT_STYLES;

test("a note takes its style's look until a property is overridden", () => {
  const note = { styleId: "ts-note" };
  assert.equal(resolveTextLook(styles, note).bold, false);
  assert.equal(resolveTextLook(styles, note).sizeMm, 2.5);
  note.override = { bold: true };
  assert.equal(resolveTextLook(styles, note).bold, true);
  assert.equal(resolveTextLook(styles, note).sizeMm, 2.5);
});

test("an unknown style falls back rather than drawing nothing", () => {
  assert.equal(resolveTextLook(styles, { styleId: "gone" }).id, "ts-note");
  assert.equal(resolveTextLook(styles, { styleId: "gone" }, "ts-dim").id, "ts-dim");
});

test("setting a property back to the style's value drops the override", () => {
  const note = { styleId: "ts-note" };
  setOverride(styles, note, "sizeMm", 5);
  assert.deepEqual(note.override, { sizeMm: 5 });
  setOverride(styles, note, "sizeMm", 2.5);
  assert.equal(note.override, undefined);
  assert.deepEqual(overriddenKeys(note), []);
});

test("bold, italic and underline toggle against what is shown", () => {
  const note = { styleId: "ts-note-bold" };
  toggleOverride(styles, note, "bold");
  assert.deepEqual(note.override, { bold: false });
  toggleOverride(styles, note, "bold");
  assert.equal(note.override, undefined);
  assert.equal(toggleOverride(styles, note, "sizeMm"), false);
});

test("overrides keep only known properties with sensible values", () => {
  assert.deepEqual(cleanOverride({ bold: "yes", colour: "red", sizeMm: 900, align: "middle", junk: 1 }), { sizeMm: 50 });
  assert.deepEqual(cleanOverride({ colour: "#AA0000", align: "right" }), { colour: "#aa0000", align: "right" });
});

test("a style can be saved from a note, and the note then uses it plainly", () => {
  const doc = emptyDoc();
  const note = { styleId: "ts-note", override: { bold: true, colour: "#b2451e" } };
  const style = styleFromObject(doc, textStyleList(doc), note, "Warning note");
  assert.equal(style.id, "ts-warning-note");
  assert.equal(style.bold, true);
  assert.equal(note.styleId, style.id);
  assert.equal(note.override, undefined);
  const again = styleFromObject(doc, textStyleList(doc), { styleId: "ts-note" }, "Warning note");
  assert.equal(again.id, "ts-warning-note-2");
  assert.equal(textStyleList(doc).filter((s) => s.id.startsWith("ts-warning")).length, 2);
});

test("text height is paper millimetres at the drawing scale", () => {
  const look = resolveTextLook(styles, { styleId: "ts-note" });
  assert.equal(textHeightM(look, 100), 0.25);
  assert.equal(textHeightM(look, 50), 0.125);
  assert.match(cssFont({ ...look, bold: true, italic: true }, 12), /^italic 700 12px/);
});

test("a note keeps its words exactly and drops an empty one", () => {
  assert.equal(normalizeNote({ id: "n", x: 0, y: 0, text: "   " }), null);
  assert.equal(normalizeNote({ id: "n", x: 0, text: "A" }), null);
  const note = normalizeNote({ id: "n", x: 1, y: 2, text: "HIDDEN SAFE ACCESS\r\nsee detail", rotation: 450, printable: false, override: { bold: true, nope: 1 } });
  assert.equal(note.text, "HIDDEN SAFE ACCESS\nsee detail");
  assert.equal(note.rotation, 90);
  assert.equal(note.printable, false);
  assert.equal(note.status, "mixed");
  assert.deepEqual(note.override, { bold: true });
  assert.equal(note.leader, null);
});

test("notes and text styles survive a save", () => {
  const doc = emptyDoc();
  createNote(doc, { id: "n1", x: 1, y: 1, level: "GF", text: "1,2m HIGH GLASS BALUSTRADE" });
  doc.notes[0].leader = { x: 2, y: 3 };
  doc.textStyles.push({ id: "ts-red", name: "Red", colour: "#b2451e" });
  const back = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(back.notes.length, 1);
  assert.deepEqual(back.notes[0].leader, { x: 2, y: 3 });
  assert.equal(back.notes[0].level, "GF");
  assert.equal(back.textStyles[0].colour, "#b2451e");
  assert.equal(back.textStyles[0].sizeMm, 2.5, "a missing property takes the base note's");
});

test("a job with only a note is a drawing worth keeping", () => {
  const doc = emptyDoc();
  createNote(doc, { id: "n1", x: 0, y: 0, text: "check with client" });
  assert.equal(hasPlanDrawing(doc), true);
  assert.equal(hasJobContent(doc), true);
});

test("a note keeps the bold and size set on the tab while it was typed", () => {
  const doc = emptyDoc();
  const note = createNote(doc, { id: "n1", x: 0, y: 0, text: "FIRE DOOR", override: { bold: true, sizeMm: 3.5, nonsense: 1 } });
  assert.deepEqual(note.override, { sizeMm: 3.5, bold: true });
  const plain = createNote(doc, { id: "n2", x: 0, y: 0, text: "STEP UP", override: {} });
  assert.equal(plain.override, undefined);
});

test("lines break where typed and wrap at a width", () => {
  const measure = (s) => s.length;
  assert.deepEqual(wrapNoteLines("A\nB", null, measure), ["A", "B"]);
  assert.deepEqual(wrapNoteLines("10 x 600mm DOORS to match", 10, measure), ["10 x 600mm", "DOORS to", "match"]);
  assert.deepEqual(wrapNoteLines("SUPERCALIFRAGILISTIC", 5, measure), ["SUPERCALIFRAGILISTIC"], "a long word is never split");
});

test("a leader leaves from the side of the box facing its tip", () => {
  const box = { x: 0, y: 0, w: 4, h: 1 };
  assert.deepEqual(leaderStart(box, { x: 10, y: 0.5 }), { x: 4, y: 0.5 });
  assert.deepEqual(leaderStart(box, { x: -3, y: 1 }), { x: 0, y: 0.5 });
  assert.deepEqual(leaderStart(box, { x: 2, y: 9 }), { x: 2, y: 1 });
});

test("moving, copying and turning a note carries its leader", () => {
  const doc = emptyDoc();
  createNote(doc, { id: "n1", x: 0, y: 0, text: "A/C DUCT" });
  doc.notes[0].leader = { x: 1, y: 0 };
  const store = new PlanStore(doc);
  const snaps = store.snapshotMoveTargets([{ kind: "note", id: "n1" }]);
  store.applyMoveSnapshot(snaps, 2, 1, null);
  assert.deepEqual(doc.notes[0].leader, { x: 3, y: 1 });
  assert.equal(doc.notes[0].x, 2);

  const copied = copySelection(doc, [{ kind: "note", id: "n1" }], { dx: 5, dy: 0 });
  assert.equal(copied.ok, true);
  assert.deepEqual(doc.notes[1].leader, { x: 8, y: 1 });

  rotateSelection(doc, [{ kind: "note", id: "n1" }], { degrees: 180 });
  assert.equal(doc.notes[0].rotation, 0, "a half turn never leaves the words upside down");
});

test("a dimension label is the measured length unless the user replaced it", () => {
  const dim = { x1: 0, y1: 0, x2: 1.46, y2: 0 };
  assert.deepEqual(dimensionLabel(dim), { text: "1460", measured: "1460", replaced: false });
  assert.equal(dimensionLabel({ ...dim, prefix: "±", suffix: "(verify on site)" }).text, "± 1460 (verify on site)");
  const eq = dimensionLabel({ ...dim, textOverride: "EQ" });
  assert.equal(eq.text, "EQ");
  assert.equal(eq.replaced, true);
  assert.equal(eq.measured, "1460");
});

test("dragging a dimension moves the line off its points, not the points", () => {
  const dim = { x1: 0, y1: 0, x2: 4, y2: 0 };
  const off = offsetThrough(dim, { x: 1, y: 0.6 });
  assert.ok(Math.abs(off - 0.6) < 1e-9);
  const g = dimensionGeometry({ ...dim, offset: off });
  assert.deepEqual(g.from, [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  assert.ok(Math.abs(g.a.y - 0.6) < 1e-9 && Math.abs(g.b.y - 0.6) < 1e-9);
  assert.equal(g.length, 4);
});

test("dimension text and offset survive a save; empty ones are not stored", () => {
  const doc = normalizeDoc({
    dimensions: [
      { id: "d1", x1: 0, y1: 0, x2: 4, y2: 0, offset: 0.5, textOverride: " EQ ", prefix: "", override: { bold: true } },
      { id: "d2", x1: 0, y1: 0, x2: 4, y2: 0, offset: 0 },
    ],
  });
  assert.deepEqual(doc.dimensions[0], { id: "d1", level: null, x1: 0, y1: 0, x2: 4, y2: 0, offset: 0.5, textOverride: "EQ", override: { bold: true } });
  assert.deepEqual(doc.dimensions[1], { id: "d2", level: null, x1: 0, y1: 0, x2: 4, y2: 0 });
});

test("a label along a line never reads upside down", () => {
  assert.equal(readableAngle(1, 0), 0);
  assert.equal(readableAngle(-1, 0), 0);
  assert.ok(Math.abs(readableAngle(0, -1) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(readableAngle(0, 1) + Math.PI / 2) < 1e-9);
});
