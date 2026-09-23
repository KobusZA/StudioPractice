// Callout view: a boxed detail crop of the plan (Output > Views, `callout`,
// "the TSP callout head").
//
// Not a section and not an elevation: those two extrude a new orthographic
// direction out of the plan - a vertical cut, or a compass-side facade - so
// section.js and elevation.js share one u/v projection between them. A
// callout does neither. It boxes a rectangle of the plan the model already
// draws in and prints it again at a larger scale, the way Revit's callout
// bubble reads "the same drawing, blown up" rather than a new view direction.
// So this file has no projection maths at all: a callout's geometry is the
// plan's own x/y, windowed to a rectangle - the same x/y `sheets.js`'s plan
// viewport already draws (walls as centrelines, rooms as outline), just
// cropped to a sub-area and magnified rather than shown whole.
//
// The two clicks that define the box are the same "two clicks supply a fact
// a click alone can't" shape section.js's cut line and camera.js's look use:
// a crop needs two opposite corners exactly as a cut needs two endpoints, so
// this reuses that interaction shape rather than inventing a drag-rectangle
// gesture the rest of the canvas does not otherwise have (room/slab/roof
// drawing is click-click too, for the same reason).

import { nid } from "./model.js";

/** Below this, in metres, a click-click box is treated as a mis-click rather
 * than an intentional (if small) detail crop - the same purpose
 * `sectionFromClicks`'s 0.2 m minimum length serves for a cut line. */
export const CALLOUT_MIN_SIZE_M = 0.5;

function xy(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  return [Number(p?.x), Number(p?.y)];
}

/**
 * Two plan clicks become a crop rectangle. Returns null when the two corners
 * do not describe a box at least `CALLOUT_MIN_SIZE_M` on each side.
 */
export function calloutFromClicks(a, b) {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  if (maxX - minX < CALLOUT_MIN_SIZE_M || maxY - minY < CALLOUT_MIN_SIZE_M) return null;
  return { minX, minY, maxX, maxY };
}

// --- persisted callouts (Output > Views > Call out) -------------------------
//
// Same permanence rule `createSection`/`createElevation` follow: dropping the
// box always creates a named, saved view immediately, never a scratch crop a
// panel throws away on close - a callout head refers to one specific,
// numbered detail, not a preview.

export function ensureCallouts(doc) {
  if (!Array.isArray(doc.callouts)) doc.callouts = [];
  return doc.callouts;
}

function nextCalloutName(callouts) {
  return `Callout ${callouts.length + 1}`;
}

/**
 * `rect` must be a `calloutFromClicks()` result; a malformed one is refused
 * rather than saved half-formed, the same rule `createSection`/`createSheet`
 * apply to their own inputs.
 *
 * `scale` is the callout's own blow-up factor - the "N" in 1:N it should
 * print at on a sheet, regardless of what would otherwise fit, since the
 * whole reason to draw a callout rather than rely on the parent view is to
 * read bigger than that view does. It stays `null` until the firm sets one:
 * "unknown is null, never a plausible default" applies to a magnification
 * exactly as it does to a compliance fact, so an unset callout falls back to
 * whatever scale the sheet would otherwise compute (`sheetScale()`'s own
 * fit-to-page recommendation) rather than inventing an enlargement nobody
 * asked for.
 */
export function createCallout(doc, rect, { name, scale } = {}) {
  if (!rect
    || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY)
    || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)
    || rect.maxX - rect.minX < CALLOUT_MIN_SIZE_M
    || rect.maxY - rect.minY < CALLOUT_MIN_SIZE_M) {
    return { ok: false, reason: "not a callout rectangle" };
  }
  const callouts = ensureCallouts(doc);
  const n = Number(scale);
  const callout = {
    id: nid("call"),
    name: name || nextCalloutName(callouts),
    rect: { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY },
    scale: Number.isFinite(n) && n > 0 ? n : null,
  };
  callouts.push(callout);
  return { ok: true, callout };
}

export function removeCallout(doc, calloutId) {
  const callouts = ensureCallouts(doc);
  const idx = callouts.findIndex((c) => c.id === calloutId);
  if (idx < 0) return false;
  callouts.splice(idx, 1);
  return true;
}

export function calloutById(doc, calloutId) {
  return ensureCallouts(doc).find((c) => c.id === calloutId) || null;
}

/**
 * The crop's own extent in metres, shaped like `sectionFrame()`'s box (and
 * like `planExtentFromPayload()`'s) so `ui.js`'s `drawActiveSheet()` can
 * treat plan, section, elevation and callout viewports uniformly when it
 * works out what fills the frame and what scale fits it.
 */
export function calloutExtent(callout) {
  const { minX, minY, maxX, maxY } = callout.rect;
  return { minX, minY, maxX, maxY, w: Math.max(maxX - minX, 0.1), h: Math.max(maxY - minY, 0.1) };
}
