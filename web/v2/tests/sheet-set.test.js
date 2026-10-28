import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyCeilingHeights,
  applyCorrectionToOthers,
  cleanSheetTitle,
  correctionFactor,
  createSheetSet,
  defaultLevelForKind,
  guessPrintedScale,
  normalizeSheetSet,
  parsePrintedScale,
  parseSheetKind,
  recordCalibration,
  referencePixelSize,
  resolveActivePage,
  scaledMetresPerPixel,
  seedMetresPerPixel,
  setCeilingHeight,
  setPageRole,
  setPageScale,
} from "../sheet-set.js";
import { normalizeDoc } from "../model.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("bookmark titles parse into sheet kinds", () => {
  assert.equal(parseSheetKind("Sheet - 100 - COVER"), "cover");
  assert.equal(parseSheetKind("Sheet - 150 - SITE PLAN"), "site");
  assert.equal(parseSheetKind("Sheet - 200 - GROUND FLOOR PLAN"), "ground");
  assert.equal(parseSheetKind("Sheet - 201 - FIRST FLOOR PLAN"), "first");
  assert.equal(parseSheetKind("Sheet - 300 - ELEVATIONS"), "elevations");
  assert.equal(parseSheetKind("Sheet - 400 - SECTIONS"), "sections");
  // The real Riverglen bookmarks: project-name prefix, and "SITEPLAN" as one word.
  const p = "26_48_ERF 23-214 RIVERGLEN (CONCEPT)_2026-10-23 - Sheet -";
  assert.equal(parseSheetKind(`${p} 000 - COVER PAGE`), "cover");
  assert.equal(parseSheetKind(`${p} 100 - SITEPLAN`), "site");
  assert.equal(parseSheetKind(`${p} 250 - FIRST FLOOR PLAN`), "first");
  assert.equal(cleanSheetTitle(`${p} 200 - GROUND FLOOR PLAN`), "GROUND FLOOR PLAN");
  assert.equal(parseSheetKind("Detail A"), "other");
  assert.equal(parseSheetKind(null), "other");
});

test("the Sheet - nnn - prefix is stripped for display", () => {
  assert.equal(cleanSheetTitle("Sheet - 200 - GROUND FLOOR PLAN"), "GROUND FLOOR PLAN");
  assert.equal(cleanSheetTitle("Roof"), "Roof");
});

test("printed scales parse from 1:n, n and spaced forms only", () => {
  assert.equal(parsePrintedScale("1:100"), 100);
  assert.equal(parsePrintedScale(" 1 : 50 "), 50);
  assert.equal(parsePrintedScale("500"), 500);
  assert.equal(parsePrintedScale("abc"), null);
  assert.equal(parsePrintedScale("1:0"), null);
  assert.equal(parsePrintedScale(""), null);
});

test("an A1 page at 150 dpi is the expected size in reference pixels", () => {
  // A1 landscape: 2384 x 1684 pt.
  const size = referencePixelSize(2384, 1684);
  assert.equal(size.pixelWidth, Math.ceil((2384 * 150) / 72));
  assert.equal(size.pixelHeight, Math.ceil((1684 * 150) / 72));
});

test("seeded scale: one reference pixel is 0.1693 mm of paper times the denominator", () => {
  close(seedMetresPerPixel(1), 0.0254 / 150);
  close(seedMetresPerPixel(100), 0.0254 / 150 * 100);
  // An A1 sheet (841 mm wide) at 1:100 covers 84.1 m.
  const { pixelWidth } = referencePixelSize(841 / 25.4 * 72, 594 / 25.4 * 72);
  assert.ok(Math.abs(pixelWidth * seedMetresPerPixel(100) - 84.1) < 0.05);
  assert.equal(seedMetresPerPixel(0), null);
});

test("correction factor is calibrated over nominal, and 1 for an exact plot", () => {
  const nominal = seedMetresPerPixel(100);
  close(correctionFactor(100, nominal), 1);
  close(correctionFactor(100, nominal * 0.96), 0.96);
  assert.equal(correctionFactor(100, 0), null);
  assert.equal(correctionFactor(0, 0.02), null);
});

test("a correction applies per sheet: own denominator times the factor", () => {
  close(scaledMetresPerPixel(500, 0.96), seedMetresPerPixel(500) * 0.96);
  close(scaledMetresPerPixel(100, null), seedMetresPerPixel(100));
});

function demoSet() {
  return createSheetSet("plans.pdf", [
    { index: 0, label: "COVER", kind: "cover", use: false, levelId: null, printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 1, label: "SITE", kind: "site", use: true, levelId: "01 GFL", printedScale: 500, pixelWidth: 100, pixelHeight: 80 },
    { index: 2, label: "GROUND", kind: "ground", use: true, levelId: "01 GFL", printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 3, label: "FIRST", kind: "first", use: true, levelId: "02 L1", printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 4, label: "ELEV", kind: "elevations", use: false, levelId: null, printedScale: 50, pixelWidth: 100, pixelHeight: 80 },
  ]);
}

test("only ticked plan pages get a placement, seeded and unverified", () => {
  const set = demoSet();
  assert.equal(set.pages[0].placement, null);
  assert.equal(set.pages[4].placement, null);
  const ground = set.pages[2].placement;
  close(ground.metresPerPixel, seedMetresPerPixel(100));
  assert.equal(ground.calibrated, false);
  assert.equal(set.pages[2].verified, false);
  assert.equal(ground.sheetPage, 2);
});

test("the active sheet for a level is the chosen one, else the first assigned", () => {
  const set = demoSet();
  assert.equal(resolveActivePage(set, "01 GFL").index, 1);
  set.activeByLevel["01 GFL"] = 2;
  assert.equal(resolveActivePage(set, "01 GFL").index, 2);
  assert.equal(resolveActivePage(set, "02 L1").index, 3);
  assert.equal(resolveActivePage(set, "03 L2"), null);
});

test("calibrating one sheet records the factor and can be applied to the others", () => {
  const set = demoSet();
  const ground = set.pages[2];
  const calibrated = seedMetresPerPixel(100) * 0.9;
  const factor = recordCalibration(set, 2, calibrated);
  close(factor, 0.9);
  assert.equal(ground.verified, true);
  const changed = applyCorrectionToOthers(set, factor, 2);
  assert.deepEqual(changed.sort(), [1, 3]);
  close(set.pages[3].placement.metresPerPixel, seedMetresPerPixel(100) * 0.9);
  close(set.pages[1].placement.metresPerPixel, seedMetresPerPixel(500) * 0.9);
  // The verified sheet is untouched.
  close(ground.placement.metresPerPixel, seedMetresPerPixel(100));
});

test("applying a correction keeps each sheet's centre where it was", () => {
  const set = demoSet();
  const p = set.pages[3].placement;
  p.x = 10;
  p.y = 20;
  const cx = p.x + (p.pixelWidth * p.metresPerPixel) / 2;
  const cy = p.y + (p.pixelHeight * p.metresPerPixel) / 2;
  applyCorrectionToOthers(set, 0.8, 2);
  close(p.x + (p.pixelWidth * p.metresPerPixel) / 2, cx);
  close(p.y + (p.pixelHeight * p.metresPerPixel) / 2, cy);
});

test("changing the printed scale re-seeds an unverified sheet but not a verified one", () => {
  const set = demoSet();
  assert.equal(setPageScale(set, 2, 50), true);
  close(set.pages[2].placement.metresPerPixel, seedMetresPerPixel(50));
  set.pages[2].placement.metresPerPixel = 0.5; // what calibrate() would have written
  recordCalibration(set, 2, 0.5);
  setPageScale(set, 2, 200);
  assert.equal(set.pages[2].printedScale, 200);
  close(set.pages[2].placement.metresPerPixel, 0.5);
  assert.equal(setPageScale(set, 2, -1), false);
});

test("typed ceiling heights override the level list without touching the input", () => {
  const set = demoSet();
  assert.equal(setCeilingHeight(set, "01 GFL", 2.7), true);
  assert.equal(setCeilingHeight(set, "01 GFL", 0), false);
  assert.equal(setCeilingHeight(set, "01 GFL", 50), false);
  const levels = [{ id: "01 GFL", floorToCeiling: 2.9 }, { id: "02 L1", floorToCeiling: 2.9 }];
  const out = applyCeilingHeights(levels, set);
  assert.equal(out[0].floorToCeiling, 2.7);
  assert.equal(out[1].floorToCeiling, 2.9);
  assert.equal(levels[0].floorToCeiling, 2.9);
  setCeilingHeight(set, "01 GFL", null);
  assert.equal(applyCeilingHeights(levels, set), levels);
});

test("default level for a kind follows the level list, and is null when the floor is missing", () => {
  const ground = [{ id: "01 GFL", name: "01 GFL" }];
  assert.equal(defaultLevelForKind("ground", ground), "01 GFL");
  assert.equal(defaultLevelForKind("site", ground), "01 GFL");
  assert.equal(defaultLevelForKind("first", ground), null);
  assert.equal(defaultLevelForKind("first", [...ground, { id: "02 L1", name: "02 L1" }]), "02 L1");
  assert.equal(defaultLevelForKind("elevations", ground), null);
  assert.equal(guessPrintedScale("site"), 500);
});

test("a sheet set survives a JSON round trip through normalizeDoc", () => {
  const set = demoSet();
  set.pages[2].placement.x = 4;
  setCeilingHeight(set, "02 L1", 2.6);
  const doc = normalizeDoc(JSON.parse(JSON.stringify({ schema: "sp.doc/2", sheetSet: set })));
  assert.equal(doc.sheetSet.pages.length, 5);
  assert.equal(doc.sheetSet.pages[2].placement.x, 4);
  assert.equal(doc.sheetSet.pages[2].placement.sheetPage, 2);
  assert.equal(doc.sheetSet.ceilingHeights["02 L1"], 2.6);
  assert.equal(doc.sheetSet.pages[4].placement, null);
});

test("documents without a sheet set, or with junk, still normalise", () => {
  assert.equal(normalizeDoc({ schema: "sp.doc/2" }).sheetSet, undefined);
  assert.equal(normalizeDoc({ schema: "sp.doc/2", sheetSet: { pages: "x" } }).sheetSet, undefined);
  assert.equal(normalizeSheetSet({ pages: [{ index: -1 }, null] }), null);
  const odd = normalizeSheetSet({ pages: [{ index: 0, kind: "bogus", pixelWidth: 10, pixelHeight: 10, placement: { x: "a" } }] });
  assert.equal(odd.pages[0].kind, "other");
  assert.equal(odd.pages[0].placement, null);
});

test("an old document with a single underlay and no stored file is left as it was", () => {
  const doc = normalizeDoc({ schema: "sp.doc/2", underlay: { name: "scan.png", x: 0, y: 0, metresPerPixel: 0.01, pixelWidth: 10, pixelHeight: 10 } });
  // No asset id means the pixels were never stored, so the placement is not brought back as a blank sheet.
  assert.equal(doc.underlay, undefined);
  assert.equal(doc.sheetSet, undefined);
});

test("a placed image with a stored file id survives a reload", () => {
  const doc = normalizeDoc({
    schema: "sp.doc/2",
    underlay: {
      name: "scan.png", assetId: "ast_1", x: 1, y: 2, metresPerPixel: 0.01,
      pixelWidth: 10, pixelHeight: 20, calibrated: true,
    },
  });
  assert.equal(doc.underlay.assetId, "ast_1");
  assert.equal(doc.underlay.name, "scan.png");
  assert.equal(doc.underlay.pixelWidth, 10);
  assert.equal(doc.underlay.calibrated, true);
});

test("a sheet set keeps the id of its stored PDF", () => {
  const set = normalizeSheetSet({
    pdfName: "plans.pdf",
    assetId: "ast_9",
    pages: [{ index: 0, kind: "ground", pixelWidth: 100, pixelHeight: 80, placement: { x: 0, y: 0, metresPerPixel: 0.02 } }],
  });
  assert.equal(set.assetId, "ast_9");
  assert.equal(set.pdfName, "plans.pdf");
  const older = normalizeSheetSet({
    pdfName: "plans.pdf",
    pages: [{ index: 0, kind: "ground", pixelWidth: 100, pixelHeight: 80 }],
  });
  assert.equal(older.assetId, undefined);
});

import { referenceDistanceMetres, sameSheetGeometry, suggestPrintedScale } from "../sheet-set.js";

test("a reopened PDF matches on page size, and a different sheet does not", () => {
  const saved = [{ index: 0, pixelWidth: 1000, pixelHeight: 700 }];
  assert.equal(sameSheetGeometry(saved, [{ index: 0, pixelWidth: 1004, pixelHeight: 698 }]), true);
  assert.equal(sameSheetGeometry(saved, [{ index: 0, pixelWidth: 500, pixelHeight: 700 }]), false);
  assert.equal(sameSheetGeometry(saved, []), false);
});

test("a calibration far from the printed scale suggests the scale actually meant", () => {
  assert.equal(suggestPrintedScale(500, 0.201), 100);
  assert.equal(suggestPrintedScale(100, 0.52), 50);
  assert.equal(suggestPrintedScale(100, 0.7), null);
});

test("reference measurements use the printed scale", () => {
  // 1000 reference px at 1:50 = 1000 * 0.0254/150 * 50 m
  close(referenceDistanceMetres(1000, 50), 1000 * (0.0254 / 150) * 50);
  assert.equal(referenceDistanceMetres(10, 0), null);
});

import { alignablePages, movePageToLevel, movePlansOnLevel, placePage, unplacePage } from "../sheet-set.js";

function threePageSet() {
  return createSheetSet("p.pdf", [
    { index: 0, label: "Ground", kind: "ground", use: true, levelId: "L0", printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 1, label: "Ground 2", kind: "ground", use: true, levelId: "L0", printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 2, label: "First", kind: "first", use: true, levelId: "L1", printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 3, label: "Cover", kind: "cover", use: false, printedScale: 100, pixelWidth: 100, pixelHeight: 80 },
    { index: 4, label: "Sections", kind: "sections", use: false, printedScale: 50, pixelWidth: 100, pixelHeight: 80 },
  ]);
}

test("movePageToLevel changes the floor, keeps placement and anchor, retargets the old floor, follows only when asked", () => {
  const set = threePageSet();
  set.pages[0].anchor = { x: 3, y: 4 };
  set.pages[0].verified = true;
  set.pages[0].placement.x = 12;
  set.activeByLevel = { L0: 0, L1: 2 };
  const result = movePageToLevel(set, 0, "L1", { levelIds: ["L0", "L1"] });
  assert.equal(result.changed, true);
  assert.equal(set.pages[0].levelId, "L1");
  assert.equal(set.pages[0].placement.x, 12);
  assert.deepEqual(set.pages[0].anchor, { x: 3, y: 4 });
  assert.equal(set.pages[0].verified, true);
  assert.equal(set.activeByLevel.L0, 1);
  assert.equal(set.activeByLevel.L1, 2, "not following leaves the new floor's page alone");
  movePageToLevel(set, 1, "L1", { follow: true, levelIds: ["L0", "L1"] });
  assert.equal(set.activeByLevel.L1, 1);
  assert.equal("L0" in set.activeByLevel, false, "an emptied floor drops its choice");
});

test("movePageToLevel refuses a non-plan page or an unknown floor, and the same floor is a no-op", () => {
  const set = threePageSet();
  assert.equal(movePageToLevel(set, 3, "L1").ok, false);
  assert.equal(movePageToLevel(set, 0, "L9", { levelIds: ["L0", "L1"] }).ok, false);
  assert.equal(movePageToLevel(set, 0, "L0", { levelIds: ["L0", "L1"] }).changed, false);
});

test("movePlansOnLevel moves every plan and follows only the one showing", () => {
  const set = threePageSet();
  set.activeByLevel = { L0: 1, L1: 2 };
  const result = movePlansOnLevel(set, "L0", "L1", { levelIds: ["L0", "L1"] });
  assert.deepEqual(result.moved.sort(), [0, 1]);
  assert.equal(result.showing, 1);
  assert.equal(set.activeByLevel.L1, 1);
  assert.equal(set.pages.filter((p) => p.levelId === "L1").length, 3);
});

test("placePage seeds a plan unverified; unplacePage drops the placement and keeps the page", () => {
  const set = threePageSet();
  assert.equal(set.pages[3].role, "unused");
  assert.equal(placePage(set, 3, "L0").ok, true);
  const cover = set.pages[3];
  assert.equal(cover.role, "plan");
  assert.equal(cover.levelId, "L0");
  assert.ok(cover.placement && cover.verified === false);
  assert.equal(placePage(set, 4, "L1").ok, true);
  assert.equal(set.pages[4].role, "plan");
  cover.anchor = { x: 1, y: 1 };
  assert.equal(unplacePage(set, 3).ok, true);
  assert.equal(set.pages.length, 5);
  assert.equal(cover.role, "unused");
  assert.equal(cover.placement, null);
  assert.equal(cover.anchor, null);
  assert.equal(cover.levelId, null);
});

test("setPageRole adds a page to elevations or sections and takes one back out", () => {
  const set = threePageSet();
  const cover = set.pages[3];
  const section = set.pages[4];
  assert.equal(cover.role, "unused");
  assert.equal(setPageRole(set, 3, "elevation").changed, true);
  assert.equal(cover.role, "elevation");
  assert.equal(cover.placement, null);
  assert.equal(setPageRole(set, 3, "elevation").changed, false);
  assert.equal(setPageRole(set, 4, "unused").changed, true);
  assert.equal(section.role, "unused");
  assert.equal(setPageRole(set, 4, "section").ok, true);
  assert.equal(section.role, "section");
  assert.equal(setPageRole(set, 3, "other").changed, true);
  assert.equal(cover.role, "other");
  setPageRole(set, 3, "elevation");
  setPageRole(set, 4, "elevation");
  assert.equal(set.pages.filter((p) => p.role === "elevation").length, 2);
  setPageRole(set, 4, "section");
  assert.equal(setPageRole(set, 3, "plan").ok, false);

  set.activeByLevel = { L0: 0, L1: 2 };
  set.pages[0].verified = true;
  set.pages[0].anchor = { x: 1, y: 2 };
  assert.equal(setPageRole(set, 0, "section").changed, true);
  assert.equal(set.pages[0].role, "section");
  assert.equal(set.pages[0].placement, null);
  assert.equal(set.pages[0].anchor, null);
  assert.equal(set.pages[0].verified, false);
  assert.equal(set.pages[0].levelId, null);
  assert.equal(set.activeByLevel.L0, 1, "the floor keeps its other plan page");
});

test("normalizeSheetSet derives role when absent and round-trips one that is present", () => {
  const raw = {
    pdfName: "p.pdf",
    pages: [
      { index: 0, kind: "ground", pixelWidth: 10, pixelHeight: 10, levelId: "L0", placement: { x: 0, y: 0, metresPerPixel: 0.01 } },
      { index: 1, kind: "elevations", pixelWidth: 10, pixelHeight: 10 },
      { index: 2, kind: "sections", pixelWidth: 10, pixelHeight: 10 },
      { index: 3, kind: "other", pixelWidth: 10, pixelHeight: 10 },
    ],
  };
  const set = normalizeSheetSet(raw);
  assert.deepEqual(set.pages.map((p) => p.role), ["plan", "elevation", "section", "unused"]);
  const again = normalizeSheetSet(JSON.parse(JSON.stringify(set)));
  assert.deepEqual(again.pages.map((p) => p.role), ["plan", "elevation", "section", "unused"]);
  raw.pages[1].role = "unused";
  assert.equal(normalizeSheetSet(raw).pages[1].role, "unused");
});

test("Align offers every plan page on any floor, whatever its kind", () => {
  const set = normalizeSheetSet({
    pdfName: "p.pdf",
    pages: [
      { index: 0, kind: "other", pixelWidth: 10, pixelHeight: 10, levelId: "L2", placement: { x: 0, y: 0, metresPerPixel: 0.01 } },
      { index: 1, kind: "ground", pixelWidth: 10, pixelHeight: 10 },
    ],
  });
  assert.deepEqual(alignablePages(set).map((p) => p.index), [0]);
});

import { reorderPage, setPageShown, setSheetSetHidden, shownPagesBeside } from "../sheet-set.js";

test("shown pages sit beside the current one on its floor only, in page order", () => {
  const set = threePageSet();
  assert.deepEqual(shownPagesBeside(set, 0), []);
  assert.equal(setPageShown(set, 1, true, 0).ok, true);
  assert.deepEqual(shownPagesBeside(set, 0).map((p) => p.index), [1]);
  // Another floor's shown page is not drawn here.
  movePageToLevel(set, 1, "L1");
  assert.deepEqual(shownPagesBeside(set, 0).map((p) => p.index), []);
});

test("the current page can be hidden, and a non-plan page cannot be shown", () => {
  const set = threePageSet();
  assert.equal(setPageShown(set, 0, false, 0).ok, true);
  assert.equal(set.pages[0].suppressed, true);
  assert.equal(set.pages[0].shown, false);
  assert.equal(setPageShown(set, 0, true, 0).ok, true);
  assert.equal(set.pages[0].suppressed, false);
  assert.equal(setPageShown(set, 3, true, 0).ok, false);
  assert.equal(set.pages[3].shown, false);
  const again = normalizeSheetSet(JSON.parse(JSON.stringify(set)));
  setPageShown(set, 0, false, 0);
  const hidden = normalizeSheetSet(JSON.parse(JSON.stringify(set)));
  assert.equal(again.pages[0].suppressed, false);
  assert.equal(hidden.pages[0].suppressed, true);
});

test("unplacing a page clears shown; shown and the set-wide hide survive a round trip", () => {
  const set = threePageSet();
  setPageShown(set, 1, true, 0);
  setSheetSetHidden(set, true);
  const again = normalizeSheetSet(JSON.parse(JSON.stringify(set)));
  assert.equal(again.pages[1].shown, true);
  assert.equal(again.hidden, true);
  unplacePage(set, 1);
  assert.equal(set.pages[1].shown, false);
});

test("a hide saved on a page placement becomes the set's hide", () => {
  const set = threePageSet();
  const raw = JSON.parse(JSON.stringify(set));
  raw.pages[0].placement.hidden = true;
  const again = normalizeSheetSet(raw);
  assert.equal(again.hidden, true);
  assert.equal(again.pages[0].placement.hidden, false);
});

test("reorderPage moves a page inside its floor and refuses another floor", () => {
  const set = threePageSet();
  assert.equal(set.pages[0].levelId, set.pages[1].levelId);
  assert.equal(reorderPage(set, 0, 1).ok, true);
  assert.deepEqual(set.pages.map((p) => p.index), [1, 0, 2, 3, 4]);
  assert.equal(reorderPage(set, 0, 2).ok, false);
  assert.equal(set.pages.find((p) => p.index === 0).levelId, "L0");
});

// --- phase 4: more than one file ------------------------------------------

import {
  FIRST_SOURCE_ID,
  addSource,
  applyRevision,
  matchRevision,
  mirrorLegacySource,
  pagesOfSource,
  pdfPageOf,
  removeSource,
  replaceSource,
  sheetSetAssetIds,
  sourceLoss,
} from "../sheet-set.js";

const row = (index, label, kind, levelId, extra = {}) => ({
  index, label, kind, use: Boolean(levelId), levelId, printedScale: 100, pixelWidth: 100, pixelHeight: 80, ...extra,
});

test("a set saved with one file is wrapped as a single source and every page points at it", () => {
  const legacy = {
    pdfName: "old.pdf",
    assetId: "ast_old",
    pages: [
      { index: 0, label: "Ground", kind: "ground", pixelWidth: 100, pixelHeight: 80, placement: { x: 0, y: 0, metresPerPixel: 0.02 }, levelId: "L0" },
      { index: 1, label: "Cover", kind: "cover", pixelWidth: 100, pixelHeight: 80 },
    ],
  };
  const set = normalizeSheetSet(legacy);
  assert.deepEqual(set.sources, [{ id: FIRST_SOURCE_ID, name: "old.pdf", mime: "application/pdf", assetId: "ast_old" }]);
  assert.ok(set.pages.every((p) => p.sourceId === FIRST_SOURCE_ID));
  assert.deepEqual(set.pages.map(pdfPageOf), [0, 1]);
  // Still written for one revision as copies of the single source.
  assert.equal(set.pdfName, "old.pdf");
  assert.equal(set.assetId, "ast_old");
  assert.deepEqual(sheetSetAssetIds(set), ["ast_old"]);
  // And a round trip keeps everything.
  assert.deepEqual(normalizeSheetSet(JSON.parse(JSON.stringify(set))), set);
});

test("a satellite source contributes no file id", () => {
  const raw = {
    sources: [
      { id: "a", name: "a.pdf", mime: "application/pdf", assetId: "ast_a" },
      { id: "s", name: "Satellite", mime: "satellite", assetId: "ast_should_not_count" },
    ],
    pages: [{ index: 0, label: "P", kind: "other", pixelWidth: 10, pixelHeight: 10, sourceId: "a" }],
  };
  const set = normalizeSheetSet(raw);
  assert.deepEqual(sheetSetAssetIds(set), ["ast_a"]);
  assert.equal(set.sources[1].assetId, undefined);
});

test("adding a file keeps the first file's pages and gives the new pages set-wide indexes", () => {
  const set = threePageSet();
  const before = JSON.stringify(set.pages);
  const { source, pages } = addSource(set, { name: "services.pdf" }, [
    row(0, "Services", "ground", "L0"),
    row(1, "Notes", "other", null),
  ]);
  assert.equal(set.sources.length, 2);
  assert.equal(source.id, "src2");
  assert.equal(JSON.stringify(set.pages.slice(0, 5)), before);
  assert.deepEqual(pages.map((p) => p.index), [5, 6]);
  assert.deepEqual(pages.map(pdfPageOf), [0, 1]);
  assert.equal(pages[0].placement.sheetPage, 5);
  assert.equal(pages[0].placement.name, "services.pdf - Services");
  // L0 already had a sheet showing: the new one waits behind it.
  assert.equal(resolveActivePage(set, "L0").index, 0);
  assert.deepEqual(pagesOfSource(set, "src2").map((p) => p.label), ["Services", "Notes"]);
  const again = normalizeSheetSet(JSON.parse(JSON.stringify(set)));
  assert.deepEqual(again.pages.map((p) => [p.index, p.sourceId, pdfPageOf(p)]), set.pages.map((p) => [p.index, p.sourceId, pdfPageOf(p)]));
});

test("a placed page on an empty floor of an added file becomes that floor's sheet", () => {
  const set = threePageSet();
  addSource(set, { name: "b.pdf" }, [row(0, "Second floor", "other", "L2", { role: "plan" })]);
  assert.equal(resolveActivePage(set, "L2").label, "Second floor");
});

test("replacing a file swaps only its pages; other sources, placements and files stay", () => {
  const set = threePageSet();
  set.sources[0].assetId = "ast_1";
  addSource(set, { name: "b.pdf" }, [row(0, "B ground", "ground", "L0"), row(1, "B first", "first", "L1")]);
  set.sources[1].assetId = "ast_2";
  const firstFilePages = JSON.stringify(pagesOfSource(set, "src1"));
  const loss = sourceLoss(set, "src2");
  assert.deepEqual(loss, ["2 placed sheets"]);

  const out = replaceSource(set, "src2", { name: "b2.pdf" }, [row(0, "B2 ground", "ground", "L0")]);
  assert.equal(out.removed.length, 2);
  assert.equal(JSON.stringify(pagesOfSource(set, "src1")), firstFilePages);
  assert.equal(set.sources[0].assetId, "ast_1");
  assert.equal(set.sources[1].name, "b2.pdf");
  assert.equal(set.sources[1].assetId, undefined);
  assert.deepEqual(pagesOfSource(set, "src2").map((p) => p.label), ["B2 ground"]);
  // Fresh indexes: nothing cached under a removed page's index can be mistaken for the new page.
  assert.ok(out.pages[0].index > Math.max(...out.removed.map((p) => p.index)));
  // The floor that had only a removed sheet forgets it.
  assert.ok(![...Object.values(set.activeByLevel)].some((i) => out.removed.some((p) => p.index === i)));
});

test("removing a source needs another one and takes its pages with it", () => {
  const set = threePageSet();
  assert.equal(removeSource(set, "src1").ok, false);
  addSource(set, { name: "b.pdf" }, [row(0, "B", "ground", "L0")]);
  assert.equal(removeSource(set, "src2").ok, true);
  assert.equal(set.sources.length, 1);
  assert.equal(pagesOfSource(set, "src2").length, 0);
});

function opened(...specs) {
  return specs.map(([index, title, w = 100, h = 80]) => ({ index, title, pixelWidth: w, pixelHeight: h }));
}

test("a new revision matches by cleaned title, then by page number, and keeps what was set up", () => {
  const set = createSheetSet("v1.pdf", [
    row(0, "GROUND FLOOR PLAN", "ground", "L0"),
    row(1, "FIRST FLOOR PLAN", "first", "L1"),
    row(2, "ELEVATIONS", "elevations", null, { role: "elevation" }),
  ]);
  set.pages[0].verified = true;
  set.pages[0].anchor = { x: 5, y: 6 };
  set.pages[0].placement.x = 42;
  // The new file reordered its pages and inserted a new one at the front.
  const pages = opened([0, "Sheet - 001 - LEGEND"], [1, "Sheet - 200 - FIRST FLOOR PLAN"], [2, "Sheet - 100 - GROUND FLOOR PLAN"], [3, "Sheet - 300 - ELEVATIONS"]);
  const match = matchRevision(set, "src1", pages);
  assert.deepEqual(match.rows.map((r) => [r.page.label, r.newIndex, r.auto]), [
    ["GROUND FLOOR PLAN", 2, true],
    ["FIRST FLOOR PLAN", 1, true],
    ["ELEVATIONS", 3, true],
  ]);
  assert.deepEqual(match.unmatched, [0]);

  const decisions = new Map(match.rows.map((r) => [r.page.index, r.newIndex]));
  const out = applyRevision(set, "src1", { name: "v2.pdf", sha256: "a".repeat(64) }, pages, decisions);
  assert.equal(out.kept.length, 3);
  assert.equal(out.dropped.length, 0);
  const ground = set.pages.find((p) => p.label === "GROUND FLOOR PLAN");
  assert.equal(ground.index, 0);
  assert.equal(ground.sourcePage, 2);
  assert.equal(ground.verified, true);
  assert.deepEqual(ground.anchor, { x: 5, y: 6 });
  assert.equal(ground.placement.x, 42);
  assert.equal(ground.levelId, "L0");
  // The page nobody took arrives unused, with a fresh index.
  const added = out.added[0];
  assert.equal(added.role, "unused");
  assert.equal(added.placement, null);
  assert.equal(added.label, "LEGEND");
  assert.ok(added.index > 2);
  // The source now names the new file; the old file's id is gone until the new upload lands.
  assert.equal(set.sources[0].name, "v2.pdf");
  assert.equal(set.sources[0].assetId, undefined);
  assert.equal(set.sources[0].sha256, "a".repeat(64));
  assert.equal(set.pdfName, "v2.pdf");
});

test("a revision page of another size is a question, and Drop removes the sheet", () => {
  const set = createSheetSet("v1.pdf", [
    row(0, "GROUND FLOOR PLAN", "ground", "L0"),
    row(1, "FIRST FLOOR PLAN", "first", "L1"),
  ]);
  const pages = opened([0, "GROUND FLOOR PLAN", 200, 160], [1, "Something else"]);
  const match = matchRevision(set, "src1", pages);
  assert.equal(match.rows[0].newIndex, 0);
  assert.equal(match.rows[0].auto, false);
  // Matched by page number only, and the size agrees: kept without asking.
  assert.equal(match.rows[1].newIndex, 1);
  assert.equal(match.rows[1].auto, true);

  const out = applyRevision(set, "src1", { name: "v2.pdf" }, pages, new Map([[0, null], [1, 1]]));
  assert.equal(out.dropped.length, 1);
  assert.equal(set.pages.some((p) => p.placement && p.label === "GROUND FLOOR PLAN"), false);
  assert.equal(set.activeByLevel.L0, undefined);
  assert.equal(set.pages.find((p) => p.label === "FIRST FLOOR PLAN").sourcePage, 1);
});

test("mirrorLegacySource copies the first source and drops a stale asset id", () => {
  const set = threePageSet();
  set.assetId = "ast_stale";
  set.sources[0].name = "renamed.pdf";
  mirrorLegacySource(set);
  assert.equal(set.pdfName, "renamed.pdf");
  assert.equal(set.assetId, undefined);
  set.sources[0].assetId = "ast_new";
  mirrorLegacySource(set);
  assert.equal(set.assetId, "ast_new");
});
