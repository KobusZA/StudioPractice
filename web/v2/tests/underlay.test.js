import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  calibrate,
  hasStashedUnderlay,
  pageLineworkStatus,
  restoreStashedUnderlay,
  setUnderlayPinned,
  stashUnderlay,
  rotateUnderlayBy,
  scaleUnderlayFromCorner,
  setUnderlayOpacity,
  setUnderlayRotation,
  snapUnderlayWorld,
  toggleUnderlayHidden,
  underlayCorners,
  underlayFrameBounds,
  underlayPixelFromWorld,
  underlayWorldFromPixel,
} from "../underlay.js";
import { RIBBON, ribbonItems } from "../ribbon.js";

function docWithUnderlay(overrides = {}) {
  return {
    underlay: {
      name: "plan.pdf",
      pixelWidth: 2000,
      pixelHeight: 1400,
      x: 0,
      y: 0,
      metresPerPixel: 0.01,
      opacity: 0.55,
      rotation: 0,
      calibrated: false,
      ...overrides,
    },
  };
}

test("two points a known distance apart set the scale", () => {
  const doc = docWithUnderlay();
  // 5 world metres apart at 0.01 m/px is 500 px; calling it 10 m doubles the scale.
  const result = calibrate(doc, { x: 0, y: 0 }, { x: 5, y: 0 }, 10);
  assert.equal(result.ok, true);
  assert.equal(doc.underlay.metresPerPixel, 0.02);
  assert.equal(doc.underlay.calibrated, true);
});

// Rescaling around the origin would throw the drawing across the screen, so the
// first clicked point is the fixed point of the transform.
test("the first calibration point stays over the same pixel", () => {
  const doc = docWithUnderlay({ x: -3, y: 2 });
  const anchor = { x: 4, y: 7 };
  const pixelUnder = (p) => [
    (p.x - doc.underlay.x) / doc.underlay.metresPerPixel,
    (p.y - doc.underlay.y) / doc.underlay.metresPerPixel,
  ];

  const before = pixelUnder(anchor);
  calibrate(doc, anchor, { x: 9, y: 7 }, 10);
  const after = pixelUnder(anchor);

  assert.ok(Math.abs(after[0] - before[0]) < 1e-9, "x pixel moved");
  assert.ok(Math.abs(after[1] - before[1]) < 1e-9, "y pixel moved");
});

test("calibrating twice converges rather than compounding", () => {
  const doc = docWithUnderlay();
  calibrate(doc, { x: 0, y: 0 }, { x: 5, y: 0 }, 10);
  calibrate(doc, { x: 0, y: 0 }, { x: 10, y: 0 }, 10);
  assert.equal(doc.underlay.metresPerPixel, 0.02);
});

test("a degenerate or missing measurement is refused", () => {
  const doc = docWithUnderlay();
  assert.equal(calibrate(doc, { x: 0, y: 0 }, { x: 0.001, y: 0 }, 10).ok, false);
  assert.equal(calibrate(doc, { x: 0, y: 0 }, { x: 5, y: 0 }, 0).ok, false);
  assert.equal(calibrate(doc, { x: 0, y: 0 }, { x: 5, y: 0 }, NaN).ok, false);
  assert.equal(doc.underlay.calibrated, false);
});

test("calibrating without an underlay is refused", () => {
  assert.equal(calibrate({}, { x: 0, y: 0 }, { x: 1, y: 0 }, 5).ok, false);
});

// --- opacity ---------------------------------------------------------------

test("opacity is clamped to [0, 1] and no-ops without an underlay", () => {
  const doc = docWithUnderlay();
  setUnderlayOpacity(doc, 1.4);
  assert.equal(doc.underlay.opacity, 1);
  setUnderlayOpacity(doc, -0.2);
  assert.equal(doc.underlay.opacity, 0);
  setUnderlayOpacity(doc, 0.3);
  assert.equal(doc.underlay.opacity, 0.3);
  assert.doesNotThrow(() => setUnderlayOpacity({}, 0.5));
});

// --- rotation ---------------------------------------------------------------

test("rotation normalises into [0, 360)", () => {
  const doc = docWithUnderlay();
  setUnderlayRotation(doc, -30);
  assert.equal(doc.underlay.rotation, 330);
  setUnderlayRotation(doc, 400);
  assert.equal(doc.underlay.rotation, 40);
  setUnderlayRotation(doc, NaN);
  assert.equal(doc.underlay.rotation, 0);
});

test("rotateUnderlayBy nudges from the current angle rather than replacing it", () => {
  const doc = docWithUnderlay({ rotation: 45 });
  rotateUnderlayBy(doc, 90);
  assert.equal(doc.underlay.rotation, 135);
  rotateUnderlayBy(doc, -180);
  assert.equal(doc.underlay.rotation, 315);
});

// --- corners and centre-anchored scaling ------------------------------

test("underlayFrameBounds is the plan sheets of the open floor", () => {
  const doc = {
    sheetSet: {
      pages: [
        {
          index: 0,
          role: "plan",
          levelId: "g",
          placement: { x: 10, y: 20, pixelWidth: 100, pixelHeight: 50, metresPerPixel: 0.1, rotation: 0 },
        },
        { index: 1, role: "unused", levelId: null, placement: null },
        {
          index: 2,
          role: "plan",
          levelId: "f",
          placement: { x: 500, y: 500, pixelWidth: 100, pixelHeight: 50, metresPerPixel: 1, rotation: 0 },
        },
      ],
    },
  };
  const b = underlayFrameBounds(doc, "g");
  assert.deepEqual(b, { minX: 10, minY: 20, maxX: 20, maxY: 25 });
  assert.equal(underlayFrameBounds(doc, "other"), null);
});

test("underlayFrameBounds uses a lone image underlay", () => {
  const b = underlayFrameBounds(docWithUnderlay(), "g");
  assert.ok(b.maxX > b.minX && b.maxY > b.minY);
});

test("underlayCorners returns an axis-aligned box when rotation is zero", () => {
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 200, pixelHeight: 100, metresPerPixel: 0.1 });
  const [tl, tr, br, bl] = underlayCorners(doc);
  assert.deepEqual([tl.x, tl.y], [0, 0]);
  assert.deepEqual([tr.x, tr.y], [20, 0]);
  assert.deepEqual([br.x, br.y], [20, 10]);
  assert.deepEqual([bl.x, bl.y], [0, 10]);
});

test("underlayCorners rotates the box about its own centre", () => {
  // A square rotated 90 degrees maps to the same footprint, corners relabelled.
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 100, pixelHeight: 100, metresPerPixel: 0.1, rotation: 90 });
  const [tl, , br] = underlayCorners(doc);
  assert.ok(Math.abs(tl.x - 10) < 1e-9 && Math.abs(tl.y - 0) < 1e-9);
  assert.ok(Math.abs(br.x - 0) < 1e-9 && Math.abs(br.y - 10) < 1e-9);
});

// Setting up a corner-drag exactly as ui.js does at pointerdown: the anchor is
// the opposite corner, diagUnit points from that anchor towards the corner
// being dragged, and grabOffset is zero when the click landed exactly on the
// handle (the case these tests exercise; ui.js computes a non-zero value when
// it did not).
function cornerDrag(doc, draggedIndex) {
  const corners = underlayCorners(doc);
  const anchorWorld = corners[(draggedIndex + 2) % 4];
  const corner = corners[draggedIndex];
  const dx = corner.x - anchorWorld.x;
  const dy = corner.y - anchorWorld.y;
  const len = Math.hypot(dx, dy) || 1;
  return { anchorWorld, diagUnit: { x: dx / len, y: dy / len } };
}

test("scaleUnderlayFromCorner keeps the OPPOSITE corner fixed while resizing", () => {
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 200, pixelHeight: 100, metresPerPixel: 0.1 });
  // Corners at (0,0) (20,0) (20,10) (0,10); drag the bottom-right (index 2),
  // anchored on the top-left (index 0), which must not move.
  const { anchorWorld, diagUnit } = cornerDrag(doc, 2);
  assert.deepEqual([anchorWorld.x, anchorWorld.y], [0, 0]);

  // Doubling the footprint: drag the corner out to (40, 20).
  scaleUnderlayFromCorner(doc, 2, anchorWorld, diagUnit, 0, { x: 40, y: 20 });

  assert.ok(Math.abs(doc.underlay.metresPerPixel - 0.2) < 1e-9);
  const corners = underlayCorners(doc);
  assert.ok(Math.abs(corners[0].x - 0) < 1e-9 && Math.abs(corners[0].y - 0) < 1e-9, "anchor corner moved");
  assert.ok(Math.abs(corners[2].x - 40) < 1e-9 && Math.abs(corners[2].y - 20) < 1e-9, "dragged corner did not track the pointer");
});

test("scaleUnderlayFromCorner tracks the pointer 1:1 along the diagonal", () => {
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 200, pixelHeight: 100, metresPerPixel: 0.1 });
  const { anchorWorld, diagUnit } = cornerDrag(doc, 2);

  // Move the pointer 1 world unit further out along the diagonal than the
  // original corner sat: the new corner position must also be exactly 1 unit
  // further out, not some multiple of it (that would be the centre-anchor bug).
  const original = { x: anchorWorld.x + diagUnit.x * Math.hypot(20, 10), y: anchorWorld.y + diagUnit.y * Math.hypot(20, 10) };
  const nudged = { x: original.x + diagUnit.x, y: original.y + diagUnit.y };
  scaleUnderlayFromCorner(doc, 2, anchorWorld, diagUnit, 0, nudged);

  const corners = underlayCorners(doc);
  const movedBy = Math.hypot(corners[2].x - original.x, corners[2].y - original.y);
  assert.ok(Math.abs(movedBy - 1) < 1e-6, `dragged corner moved ${movedBy}, expected 1`);
});

test("grabOffset corrects for the click not landing exactly on the handle", () => {
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 200, pixelHeight: 100, metresPerPixel: 0.1 });
  const { anchorWorld, diagUnit } = cornerDrag(doc, 2);

  // Click 0.5 units short of the real corner, then release without moving the
  // pointer: with the correct grabOffset, nothing should change.
  const clickPoint = { x: 20 - diagUnit.x * 0.5, y: 10 - diagUnit.y * 0.5 };
  const clickProjected = (clickPoint.x - anchorWorld.x) * diagUnit.x + (clickPoint.y - anchorWorld.y) * diagUnit.y;
  const cornerProjected = Math.hypot(20, 10);
  const grabOffset = cornerProjected - clickProjected;

  scaleUnderlayFromCorner(doc, 2, anchorWorld, diagUnit, grabOffset, clickPoint);
  assert.ok(Math.abs(doc.underlay.metresPerPixel - 0.1) < 1e-9);
});

test("world and pixel mappings round-trip, including rotation", () => {
  const doc = docWithUnderlay({ x: -3, y: 2, metresPerPixel: 0.02, rotation: 35 });
  const world = { x: 4.5, y: -1.25 };
  const pixel = underlayPixelFromWorld(doc.underlay, world.x, world.y);
  const back = underlayWorldFromPixel(doc.underlay, pixel.x, pixel.y);
  assert.ok(Math.abs(back.x - world.x) < 1e-9);
  assert.ok(Math.abs(back.y - world.y) < 1e-9);
});

test("resizing keeps a calibration pick on the same pixel and stretches its world length", () => {
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 200, pixelHeight: 100, metresPerPixel: 0.1 });
  const a = { x: 2, y: 2 };
  const b = { x: 12, y: 2 };
  const aPx = underlayPixelFromWorld(doc.underlay, a.x, a.y);
  const bPx = underlayPixelFromWorld(doc.underlay, b.x, b.y);
  const before = Math.hypot(b.x - a.x, b.y - a.y);

  const { anchorWorld, diagUnit } = cornerDrag(doc, 2);
  scaleUnderlayFromCorner(doc, 2, anchorWorld, diagUnit, 0, { x: 40, y: 20 });

  const a2 = underlayWorldFromPixel(doc.underlay, aPx.x, aPx.y);
  const b2 = underlayWorldFromPixel(doc.underlay, bPx.x, bPx.y);
  const after = Math.hypot(b2.x - a2.x, b2.y - a2.y);
  const aPxAfter = underlayPixelFromWorld(doc.underlay, a2.x, a2.y);

  assert.ok(Math.abs(aPxAfter.x - aPx.x) < 1e-9);
  assert.ok(Math.abs(aPxAfter.y - aPx.y) < 1e-9);
  assert.ok(Math.abs(after - before * 2) < 1e-6, `world length ${after}, expected ${before * 2}`);
});

test("scaleUnderlayFromCorner never produces a negative or zero scale", () => {
  const doc = docWithUnderlay({ x: 0, y: 0, pixelWidth: 200, pixelHeight: 100, metresPerPixel: 0.1 });
  const { anchorWorld, diagUnit } = cornerDrag(doc, 2);
  // Drag the corner back past the anchor.
  scaleUnderlayFromCorner(doc, 2, anchorWorld, diagUnit, 0, { x: -50, y: -25 });
  assert.ok(doc.underlay.metresPerPixel > 0);
});

// --- hide / show -------------------------------------------------------

test("toggleUnderlayHidden flips visibility without touching the placement", () => {
  const doc = docWithUnderlay();
  toggleUnderlayHidden(doc);
  assert.equal(doc.underlay.hidden, true);
  assert.equal(doc.underlay.metresPerPixel, 0.01);
  toggleUnderlayHidden(doc);
  assert.equal(doc.underlay.hidden, false);
  assert.doesNotThrow(() => toggleUnderlayHidden({}));
});

test("hide, scale and adjust are ribbon commands, not canvas-only tools", () => {
  const items = ribbonItems();
  assert.equal(items.get("underlay-toggle")?.command, "underlay-toggle");
  assert.equal(items.get("calibrate")?.command, "calibrate");
  assert.equal(items.get("underlay-adjust")?.command, "underlay-adjust");
});

// --- ribbon ---------------------------------------------------------------

test("the ribbon reproduces the customer's four toolbars plus Check", () => {
  assert.deepEqual(RIBBON.map((t) => t.id), ["build", "document", "modify", "output", "check"]);
});

test("every function is exactly one of categories, command or todo", () => {
  for (const [id, item] of ribbonItems()) {
    const kinds = ["categories", "command", "todo"].filter((k) => item[k]);
    assert.equal(kinds.length, 1, `${id} declares ${kinds.length} kinds: ${kinds}`);
  }
});

test("every unbuilt function explains itself rather than going quiet", () => {
  for (const [id, item] of ribbonItems()) {
    if (!item.todo) continue;
    assert.ok(item.todo.length > 20, `${id} needs a real reason, got "${item.todo}"`);
  }
});

// A function pointing at a category the pack does not contain would open an
// empty palette, which reads as a bug rather than as missing content.
test("every catalog-backed function maps to a category the pack defines", () => {
  const pack = JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url)));
  const known = new Set(pack.skus.map((s) => s.category));
  const unbacked = [];
  for (const [id, item] of ribbonItems()) {
    if (!item.categories) continue;
    if (!item.categories.some((c) => known.has(c))) unbacked.push(id);
  }
  // Boundary walls, beams and furniture are genuinely absent from the template;
  // the ribbon disables them and says so.
  assert.deepEqual(unbacked.sort(), ["beams", "boundary", "furniture"]);
});

import { alignSheets, markAlignmentPoint } from "../underlay.js";
import { createSheetSet } from "../sheet-set.js";

function twoFloorDoc() {
  const rows = [
    { index: 0, label: "GROUND", kind: "ground", use: true, levelId: "01 GFL", printedScale: 100, pixelWidth: 1000, pixelHeight: 800 },
    { index: 1, label: "FIRST", kind: "first", use: true, levelId: "02 L1", printedScale: 100, pixelWidth: 1000, pixelHeight: 800 },
  ];
  const sheetSet = createSheetSet("plans.pdf", rows);
  // Same house, drawn at different places on each page.
  sheetSet.pages[1].placement.x = 7;
  sheetSet.pages[1].placement.y = -3;
  return { sheetSet, underlay: null };
}

test("two drawings of the same floor: the later sheet moves onto the earlier one", () => {
  const rows = [
    { index: 0, label: "WALLS", kind: "ground", use: true, levelId: "01 GFL", printedScale: 100, pixelWidth: 1000, pixelHeight: 800 },
    { index: 1, label: "SERVICES", kind: "ground", use: true, levelId: "01 GFL", printedScale: 100, pixelWidth: 1000, pixelHeight: 800 },
  ];
  const doc = { sheetSet: createSheetSet("ground.pdf", rows), underlay: null };
  const [walls, services] = doc.sheetSet.pages;
  services.placement.x = 4;
  services.placement.y = 2;
  const order = ["01 GFL"];

  doc.underlay = walls.placement;
  const w = underlayWorldFromPixel(walls.placement, 200, 150);
  markAlignmentPoint(doc, w.x, w.y, order);
  doc.underlay = services.placement;
  const s = underlayWorldFromPixel(services.placement, 480, 320);
  const before = { x: walls.placement.x, y: walls.placement.y };
  const result = markAlignmentPoint(doc, s.x, s.y, order);

  assert.deepEqual(result.moved, [1]);
  assert.equal(result.datum.label, "WALLS");
  assert.equal(walls.placement.x, before.x);
  const landed = underlayWorldFromPixel(services.placement, 480, 320);
  assert.ok(Math.abs(landed.x - w.x) < 1e-9 && Math.abs(landed.y - w.y) < 1e-9);
});

test("marking the same feature on two floors moves the upper sheet onto the lower, not the reverse", () => {
  const doc = twoFloorDoc();
  const [ground, first] = doc.sheetSet.pages;
  const order = ["01 GFL", "02 L1"];

  doc.underlay = ground.placement;
  const g = underlayWorldFromPixel(ground.placement, 300, 200);
  markAlignmentPoint(doc, g.x, g.y, order);

  // The corner sits at pixel (600, 450) on the first-floor page.
  doc.underlay = first.placement;
  const f = underlayWorldFromPixel(first.placement, 600, 450);
  const before = { x: ground.placement.x, y: ground.placement.y };
  const result = markAlignmentPoint(doc, f.x, f.y, order);

  assert.deepEqual(result.moved, [1]);
  assert.equal(result.datum.index, 0);
  assert.equal(ground.placement.x, before.x);
  const after = underlayWorldFromPixel(first.placement, 600, 450);
  assert.ok(Math.abs(after.x - g.x) < 1e-9 && Math.abs(after.y - g.y) < 1e-9);
});

test("re-marking the lower floor drags the upper sheet along with it", () => {
  const doc = twoFloorDoc();
  const [ground, first] = doc.sheetSet.pages;
  const order = ["01 GFL", "02 L1"];
  doc.underlay = first.placement;
  const f = underlayWorldFromPixel(first.placement, 100, 100);
  markAlignmentPoint(doc, f.x, f.y, order);
  doc.underlay = ground.placement;
  const g = underlayWorldFromPixel(ground.placement, 500, 500);
  markAlignmentPoint(doc, g.x, g.y, order);
  const landed = underlayWorldFromPixel(first.placement, 100, 100);
  assert.ok(Math.abs(landed.x - g.x) < 1e-9 && Math.abs(landed.y - g.y) < 1e-9);
  assert.deepEqual(alignSheets(doc, order).moved, []);
});

test("PDF snap is inert without an extracted page", () => {
  const doc = docWithUnderlay({ sheetPage: 0 });
  assert.equal(pageLineworkStatus(0), "idle");
  assert.equal(snapUnderlayWorld(doc.underlay, 1, 1, 0.1), null);
});

test("a mark survives a JSON round trip", async () => {
  const { normalizeSheetSet } = await import("../sheet-set.js");
  const doc = twoFloorDoc();
  doc.underlay = doc.sheetSet.pages[0].placement;
  markAlignmentPoint(doc, 1, 1, ["01 GFL"]);
  const back = normalizeSheetSet(JSON.parse(JSON.stringify(doc.sheetSet)));
  assert.ok(back.pages[0].anchor && Number.isFinite(back.pages[0].anchor.x));
  assert.equal(back.pages[1].anchor, null);
});

test("removing an underlay keeps it for Undo, and Undo puts back the same placement", () => {
  const doc = docWithUnderlay();
  const placement = doc.underlay;
  const removed = stashUnderlay(doc);
  assert.equal(removed.name, "plan.pdf");
  assert.equal(removed.isSet, false);
  assert.equal(doc.underlay, null);
  assert.equal(hasStashedUnderlay(), true);

  assert.equal(restoreStashedUnderlay(doc), true);
  assert.equal(doc.underlay, placement);
  assert.equal(hasStashedUnderlay(), false);
  assert.equal(restoreStashedUnderlay(doc), false);
});

test("Undo is refused once something else has been put on the plan", () => {
  const doc = docWithUnderlay();
  stashUnderlay(doc);
  doc.underlay = { name: "other.png" };
  assert.equal(restoreStashedUnderlay(doc), false);
  doc.underlay = null;
  assert.equal(restoreStashedUnderlay(doc), true);
});

test("stashing a plan set counts what would be lost", () => {
  const doc = {
    underlay: null,
    sheetSet: { pdfName: "set.pdf", pages: [
      { index: 0, placement: { x: 0 }, verified: true, anchor: { x: 1, y: 1 } },
      { index: 1, placement: { x: 0 }, verified: false, anchor: null },
      { index: 2, placement: null, verified: false, anchor: null },
    ] },
  };
  const removed = stashUnderlay(doc);
  assert.deepEqual({ ...removed }, { name: "set.pdf", sheets: 2, verified: 1, marks: 1, isSet: true });
  assert.equal(doc.sheetSet, null);
  assert.equal(restoreStashedUnderlay(doc), true);
  assert.equal(doc.sheetSet.pdfName, "set.pdf");
});

test("pinning is a flag on the placement, and nothing without an underlay", () => {
  const doc = docWithUnderlay();
  setUnderlayPinned(doc, true);
  assert.equal(doc.underlay.pinned, true);
  setUnderlayPinned({ underlay: null }, true);
});