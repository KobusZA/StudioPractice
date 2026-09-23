// Sheets: A0-A4 title blocks (Output > Print > Sheets), the Week 3 item
// ribbon.js names outright: "the TSP_SHEET_A1 and A3 title blocks."
//
// Scope, and what is deliberately not here yet:
//  - A sheet's one viewport can now show the plan (default), a named section
//    (`sheetView()`/`setSheetView()`, fed by section.js's `doc.sections`), a
//    named elevation (fed by elevation.js's `doc.elevations`) or a named
//    callout (fed by callout.js's `doc.callouts`) - `view-section`'s job,
//    "placing a section view on a sheet, once sheets exist," extended to
//    the elevation and callout view kinds that landed alongside it.
//  - `project-info` (ui.js's Project information panel, `doc.projectInfo`)
//    now feeds the job number and client name rows below. Drawn-by/checked-by
//    /date stay per-sheet fields rather than folding into that same record:
//    they vary sheet to sheet (who drew *this* one, when), where a job number
//    and client name do not, so the two kinds of fact never fight over the
//    same box on the title block.
//  - No vector PDF export - that is `print-boq`/`print-bom`'s job, and a
//    sheet system is the prerequisite for it, not the thing itself.
//  - One fixed viewport per sheet, not a resizable/movable one. Real title
//    block software lets a viewport be dragged and cropped; here the chosen
//    view always fills the drawable area at the largest standard scale that
//    fits, which is the common case and keeps this file about the title
//    block, not a second copy of the canvas pan/zoom ui.js already has.

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
  // Job number and client name come from `project-info` (model.js's
  // `doc.projectInfo`), the ribbon item this file's own header comment named
  // as still unbuilt. They sit right after the project name because that is
  // where a title block reads them; an unset one prints the same em-dash
  // every other unknown fact on this list does.
  { key: "jobNumber", label: "Job no." },
  { key: "clientName", label: "Client" },
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
    // The one viewport this sheet gets. Plan is the default every existing
    // sheet already drew; `view-section` (Output > Views) is what lets it
    // point at a named section (section.js's `doc.sections`), a named
    // elevation (elevation.js's `doc.elevations`) or a named callout
    // (callout.js's `doc.callouts`) instead.
    view: { kind: "plan" },
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

/**
 * The sheet's chosen viewport content: the plan (default), a named section
 * from `doc.sections`, a named elevation from `doc.elevations`, or a named
 * callout from `doc.callouts`. Falls back to plan if the referenced view no
 * longer exists, rather than drafting a blank viewport for a deleted view -
 * the same "unknown is never a plausible default" rule applied to a
 * viewport instead of a SKU.
 */
export function sheetView(doc, sheet) {
  const view = sheet?.view;
  if (view?.kind === "section" && view.sectionId && (doc?.sections || []).some((s) => s.id === view.sectionId)) {
    return view;
  }
  if (view?.kind === "elevation" && view.elevationId && (doc?.elevations || []).some((e) => e.id === view.elevationId)) {
    return view;
  }
  if (view?.kind === "callout" && view.calloutId && (doc?.callouts || []).some((c) => c.id === view.calloutId)) {
    return view;
  }
  return { kind: "plan" };
}

export function setSheetView(sheet, view) {
  if (!sheet) return;
  if (view?.kind === "section" && view.sectionId) {
    sheet.view = { kind: "section", sectionId: view.sectionId };
  } else if (view?.kind === "elevation" && view.elevationId) {
    sheet.view = { kind: "elevation", elevationId: view.elevationId };
  } else if (view?.kind === "callout" && view.calloutId) {
    sheet.view = { kind: "callout", calloutId: view.calloutId };
  } else {
    sheet.view = { kind: "plan" };
  }
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

/** A sheet's scale is whatever the firm set explicitly on the sheet itself,
 * otherwise `preferredScale` if the view being drawn names one - currently
 * only a callout does, via its own `scale` (the detail's blow-up factor,
 * which exists precisely to beat what "fits" would otherwise compute) -
 * otherwise the auto-fit recommendation for what is actually drawn. */
export function sheetScale(sheet, planExtentMeters, preferredScale) {
  return sheet?.scaleOverride || preferredScale || recommendedScale(sheet, planExtentMeters);
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
export function titleBlockFields(doc, pack, sheet, planExtentMeters, preferredScale) {
  const site = doc?.site || {};
  const scale = sheetScale(sheet, planExtentMeters, preferredScale);
  return {
    // The job's own name, never the pack's: the pack is the firm's template,
    // and printing "TSP standard pack" where the client's name belongs is a
    // plausible default rather than a fact.
    projectName: doc?.name || "—",
    jobNumber: doc?.projectInfo?.jobNumber || "—",
    clientName: doc?.projectInfo?.clientName || "—",
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
