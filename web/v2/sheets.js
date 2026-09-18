// Sheets: A0-A4 title blocks (Output > Print > Sheets), the Week 3 item
// ribbon.js names outright: "the TSP_SHEET_A1 and A3 title blocks."
//
// Scope, and what is deliberately not here yet:
//  - Placing a chosen view (section, elevation, callout) onto a sheet is
//    `view-section`'s and `callout`'s job ("once sheets exist"); this file
//    only creates the sheet and its title block. Until those land, the
//    Sheets panel (ui.js) draws the current plan into the one viewport a
//    sheet gets, so a sheet is not blank the day it is created.
//  - `project-info` (job number, client) is still its own unbuilt ribbon
//    item. Until it lands, the title block reads what the document already
//    knows (`doc.name`, `pack.locale`, `doc.site.erfNumber`) and leaves
//    drawn-by/checked-by/date as per-sheet fields rather than a shared
//    project record, so the two features do not end up fighting over the
//    same box on the title block when project-info does land.
//  - No vector PDF export - that is `print-boq`/`print-bom`'s job, and a
//    sheet system is the prerequisite for it, not the thing itself.
//  - One fixed viewport per sheet, not a resizable/movable one. Real title
//    block software lets a viewport be dragged and cropped; here the plan
//    always fills the drawable area at the largest standard scale that fits,
//    which is the common case and keeps this file about the title block, not
//    a second copy of the canvas pan/zoom ui.js already has.

import { nid } from "./model.js";

/** ISO paper sizes in mm, landscape (width is always the long edge - every
 * TSP sheet size in the brief prints landscape). */
export const PAPER_SIZES = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
};

export const SHEET_SIZES = Object.keys(PAPER_SIZES);

/** Common SA architectural drawing scales (the N in 1:N), smallest first so
 * `recommendedScale` can walk up until the plan fits. */
export const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000];

const BORDER_MM = 10;
const TITLE_BLOCK_WIDTH_MM = 70; // right-hand strip, shared proportion across every size.

/** Field rows the title block prints, top to bottom. `key` matches
 * `titleBlockFields()`'s output so ui.js can render this list without a
 * second copy of the labels. */
export const FIELD_ROWS = [
  { key: "projectName", label: "Project" },
  { key: "drawingTitle", label: "Drawing" },
  { key: "erf", label: "Erf / municipality" },
  { key: "scale", label: "Scale" },
  { key: "date", label: "Date" },
  { key: "revision", label: "Rev" },
  { key: "sheetNumber", label: "Sheet no." },
  { key: "drawnBy", label: "Drawn" },
  { key: "checkedBy", label: "Checked" },
];

export function ensureSheets(doc) {
  if (!Array.isArray(doc.sheets)) doc.sheets = [];
  return doc.sheets;
}

function nextSheetNumber(sheets) {
  return `A-${100 + sheets.length}`;
}

/** `size` must be one of `SHEET_SIZES`; anything else is refused rather than
 * silently falling back, the same "never a plausible default" rule the SKU
 * pack applies to compliance facts. */
export function createSheet(doc, { size = "A1", name, number } = {}) {
  if (!PAPER_SIZES[size]) return { ok: false, reason: `unknown paper size "${size}"` };
  const sheets = ensureSheets(doc);
  const sheet = {
    id: nid("sh"),
    size,
    name: name || `Sheet ${sheets.length + 1}`,
    number: number || nextSheetNumber(sheets),
    drawingTitle: name || `Sheet ${sheets.length + 1}`,
    date: new Date().toISOString().slice(0, 10),
    drawnBy: "",
    checkedBy: "",
    scaleOverride: null,
    revisions: [],
  };
  sheets.push(sheet);
  return { ok: true, sheet };
}

export function removeSheet(doc, sheetId) {
  const sheets = ensureSheets(doc);
  const idx = sheets.findIndex((s) => s.id === sheetId);
  if (idx < 0) return false;
  sheets.splice(idx, 1);
  return true;
}

export function sheetById(doc, sheetId) {
  return ensureSheets(doc).find((s) => s.id === sheetId) || null;
}

/** A, B, ... Z, AA, AB, ... - a revision letter is issued once and never
 * reused, so the sequence is purely a function of how many exist already. */
export function revisionLetter(index) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function addRevision(sheet, { description = "", by = "" } = {}) {
  if (!sheet) return null;
  if (!Array.isArray(sheet.revisions)) sheet.revisions = [];
  const rev = {
    rev: revisionLetter(sheet.revisions.length),
    date: new Date().toISOString().slice(0, 10),
    description,
    by,
  };
  sheet.revisions.push(rev);
  return rev;
}

export function latestRevision(sheet) {
  const revs = sheet?.revisions || [];
  return revs.length ? revs[revs.length - 1].rev : "-";
}

export function paperSizeMm(size) {
  return PAPER_SIZES[size] || PAPER_SIZES.A1;
}

/** The area left for the drawing once the border and title block strip are
 * removed, in mm. */
export function drawableAreaMm(sheet) {
  const { w, h } = paperSizeMm(sheet?.size);
  return {
    w: Math.max(0, w - BORDER_MM * 2 - TITLE_BLOCK_WIDTH_MM),
    h: Math.max(0, h - BORDER_MM * 2),
  };
}

/**
 * The largest standard scale (smallest N in 1:N) whose drawn plan extent
 * fits inside the sheet's drawable area, so a 30 x 18 m plan lands on an A3
 * sheet at 1:100 rather than the drawer having to guess and re-guess. Falls
 * back to the most zoomed-out standard scale if even that does not fit,
 * rather than refusing to produce a sheet - an oversized plan still prints,
 * just at a scale that needs saying out loud in review.
 */
export function recommendedScale(sheet, planExtentMeters) {
  const { w: pw, h: ph } = drawableAreaMm(sheet);
  const ew = planExtentMeters?.w;
  const eh = planExtentMeters?.h;
  if (!(ew > 0) || !(eh > 0) || !(pw > 0) || !(ph > 0)) return STANDARD_SCALES[STANDARD_SCALES.length - 1];
  for (const n of STANDARD_SCALES) {
    const drawnW = (ew * 1000) / n;
    const drawnH = (eh * 1000) / n;
    if (drawnW <= pw && drawnH <= ph) return n;
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1];
}

/** A sheet's scale is whatever the firm set explicitly, otherwise the
 * recommendation for what is actually drawn. */
export function sheetScale(sheet, planExtentMeters) {
  return sheet?.scaleOverride || recommendedScale(sheet, planExtentMeters);
}

export function formatScale(n) {
  return Number.isFinite(n) ? `1:${n}` : "—";
}

/**
 * Compile everything the title block prints, from what the document and pack
 * already know. An unavailable fact (job number, drawn by) prints as an
 * em-dash rather than a guess - SCHEMA.md's "unknown is never a plausible
 * default" rule, applied to the title block instead of a SKU.
 */
export function titleBlockFields(doc, pack, sheet, planExtentMeters) {
  const site = doc?.site || {};
  const scale = sheetScale(sheet, planExtentMeters);
  return {
    // The job's own name, never the pack's: the pack is the firm's template,
    // and printing "TSP standard pack" where the client's name belongs is a
    // plausible default rather than a fact.
    projectName: doc?.name || "—",
    drawingTitle: sheet.drawingTitle || sheet.name || "—",
    erf: [site.erfNumber ? `Erf ${site.erfNumber}` : null, pack?.locale?.municipality]
      .filter(Boolean).join(", ") || "—",
    scale: formatScale(scale),
    date: sheet.date || "—",
    revision: latestRevision(sheet),
    sheetNumber: sheet.number || "—",
    drawnBy: sheet.drawnBy || "—",
    checkedBy: sheet.checkedBy || "—",
  };
}

/** Geometry only (mm), so ui.js's canvas draw and any future export can share
 * one layout without re-deriving it. */
export function titleBlockLayout(size) {
  const { w, h } = paperSizeMm(size);
  return {
    paper: { w, h },
    border: BORDER_MM,
    titleBlockWidth: TITLE_BLOCK_WIDTH_MM,
    rows: FIELD_ROWS,
  };
}
