// Revision cloud: a drawn marker tying a change on the plan to a sheet's
// issued revision (Document > Annotate, `revision`, "the title block
// revision history").
//
// `sheets.js` already carries the whole revision *ledger* - `addRevision()`/
// `revisionLetter()` issue a letter once, never reused, the moment the firm
// records a change. What was still missing is the drawing half: marking
// *where* on the plan a given revision applies, the same way Revit's
// revision cloud tool draws a scalloped outline around the changed area and
// tags it with a revision. So this file is small on purpose - the hard part
// (the revision ledger itself) already shipped with sheets.js.
//
// Shape, and why it is not a fifth doc.sections-style "named view":
//  - A cloud is a rectangle in the plan's own x/y, exactly like a callout's
//    crop box - calloutFromClicks()'s two-click shape is reused wholesale
//    (see revisionCloudFromClicks below), because a cloud needs two
//    opposite corners for the same reason a crop does.
//  - Unlike a callout, a cloud is not itself a sheet viewport - it is an
//    annotation drawn on top of whichever viewport a sheet already shows,
//    so it lives in its own doc.revisionClouds array rather than folding
//    into sheets.js's sheetView() union.
//  - A cloud is level-scoped like a line (doc.lines) - it marks a change on
//    one storey's plan - but it does not ghost to a neighbouring level and it
//    is not a modelled fact: it is a drafting mark about the drawing itself,
//    the closest analogue being an annotation line, not a model line.
//
// Linking is deliberately its own step, not a constructor argument, and this
// is the one integrity block this file enforces: a cloud may only be linked
// to a revision a sheet has already issued. Guessing which future revision
// a freshly drawn cloud belongs to would be inventing a fact nobody supplied
// (PHILOSOPHY.md's "unknown is null"), so createRevisionCloud always saves
// an unlinked cloud first - the same permanence rule createCallout follows,
// dropping the box always saves something rather than a scratch value a
// panel could throw away - and linkRevisionCloud is the separate, later
// step that points it at a sheet + revision letter that already exists.

import { nid } from "./model.js";

/** Below this, in metres, a click-click box reads as a mis-click rather than
 * an intentional cloud - the same purpose callout.js's own minimum serves.
 * Smaller than a callout's: a cloud circles one changed detail, not a whole
 * blown-up area. */
export const REVISION_CLOUD_MIN_SIZE_M = 0.3;

/** The scallop radius, in metres, cloudArcs() below draws bumps at. Fixed
 * rather than proportional to the box, so a cloud always reads as "a cloud"
 * at any size, the way Revit's own revision cloud arcs do not rescale with
 * the sketch. */
export const CLOUD_ARC_RADIUS_M = 0.25;

function xy(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  return [Number(p?.x), Number(p?.y)];
}

/** Two plan clicks become a cloud's bounding rectangle - the same shape
 * calloutFromClicks() uses, kept as its own function (rather than a shared
 * import) because the two callers refuse at different minimum sizes. */
export function revisionCloudFromClicks(a, b) {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  if (maxX - minX < REVISION_CLOUD_MIN_SIZE_M || maxY - minY < REVISION_CLOUD_MIN_SIZE_M) return null;
  return { minX, minY, maxX, maxY };
}

export function ensureRevisionClouds(doc) {
  if (!Array.isArray(doc.revisionClouds)) doc.revisionClouds = [];
  return doc.revisionClouds;
}

/**
 * rect must be a revisionCloudFromClicks() result. Always saved unlinked
 * (sheetId/rev both null) - see the header comment for why linking is a
 * separate, later step rather than a constructor argument.
 */
export function createRevisionCloud(doc, rect, { level = null, note = "" } = {}) {
  if (!rect
    || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY)
    || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)
    || rect.maxX - rect.minX < REVISION_CLOUD_MIN_SIZE_M
    || rect.maxY - rect.minY < REVISION_CLOUD_MIN_SIZE_M) {
    return { ok: false, reason: "not a revision cloud rectangle" };
  }
  const clouds = ensureRevisionClouds(doc);
  const cloud = {
    id: nid("rev"),
    level: level || null,
    rect: { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY },
    note: typeof note === "string" ? note : "",
    sheetId: null,
    rev: null,
  };
  clouds.push(cloud);
  return { ok: true, cloud };
}

export function removeRevisionCloud(doc, cloudId) {
  const clouds = ensureRevisionClouds(doc);
  const idx = clouds.findIndex((c) => c.id === cloudId);
  if (idx < 0) return false;
  clouds.splice(idx, 1);
  return true;
}

export function revisionCloudById(doc, cloudId) {
  return ensureRevisionClouds(doc).find((c) => c.id === cloudId) || null;
}

/**
 * Point a cloud at a sheet's already-issued revision letter. Refused (the
 * cloud is left exactly as it was) when the sheet does not exist or has not
 * issued that letter yet - sheets.js's addRevision() is the only thing
 * allowed to mint one, so this never invents a revision to satisfy a link.
 * rev: null (with any sheetId) unlinks the cloud instead of assigning it,
 * the same "explicit un-set" every other link in this codebase supports.
 */
export function linkRevisionCloud(doc, cloudId, sheetId, rev) {
  const cloud = revisionCloudById(doc, cloudId);
  if (!cloud) return { ok: false, reason: "no such revision cloud" };
  if (rev == null) {
    cloud.sheetId = null;
    cloud.rev = null;
    return { ok: true, cloud };
  }
  const sheet = (doc.sheets || []).find((s) => s.id === sheetId);
  if (!sheet) return { ok: false, reason: "no such sheet" };
  const issued = (sheet.revisions || []).some((r) => r.rev === rev);
  if (!issued) return { ok: false, reason: `sheet has not issued revision ${rev} yet` };
  cloud.sheetId = sheetId;
  cloud.rev = rev;
  return { ok: true, cloud };
}

/** Every cloud currently linked to sheetId, in creation order - what the
 * Sheets panel overlays on a sheet's plan/callout viewport (see sheets.js's
 * header: one fixed viewport, no per-level split, the same limitation
 * doc.lines already lives with on that same viewport). */
export function revisionCloudsForSheet(doc, sheetId) {
  if (!sheetId) return [];
  return ensureRevisionClouds(doc).filter((c) => c.sheetId === sheetId);
}

/**
 * The scalloped outline ui.js strokes instead of a plain rectangle - the
 * one visual feature that reads as "revision cloud" rather than "box".
 * Walks the rectangle's four edges and places semicircular bumps, each
 * exactly as wide as its own share of that edge, bulging outward (away from
 * the rectangle's centre) the way a hand-drawn revision cloud's arcs do.
 * Returns world-space circle definitions; ui.js decides how to stroke them
 * (screen projection, camera scale) rather than this file assuming a canvas.
 */
export function cloudArcs(rect, arcRadius = CLOUD_ARC_RADIUS_M) {
  const { minX, minY, maxX, maxY } = rect;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return [];
  const edges = [
    { x1: minX, y1: minY, x2: maxX, y2: minY, nx: 0, ny: -1 }, // "top" in y-down screen space
    { x1: maxX, y1: minY, x2: maxX, y2: maxY, nx: 1, ny: 0 },
    { x1: maxX, y1: maxY, x2: minX, y2: maxY, nx: 0, ny: 1 },
    { x1: minX, y1: maxY, x2: minX, y2: minY, nx: -1, ny: 0 },
  ];
  const arcs = [];
  for (const edge of edges) {
    const len = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
    if (len <= 0) continue;
    const count = Math.max(1, Math.round(len / (arcRadius * 2)));
    const step = len / count;
    const r = step / 2;
    const ux = (edge.x2 - edge.x1) / len;
    const uy = (edge.y2 - edge.y1) / len;
    const normalAngle = Math.atan2(edge.ny, edge.nx);
    for (let i = 0; i < count; i += 1) {
      const t = step * (i + 0.5);
      arcs.push({
        cx: edge.x1 + ux * t,
        cy: edge.y1 + uy * t,
        r,
        startAngle: normalAngle - Math.PI / 2,
        endAngle: normalAngle + Math.PI / 2,
      });
    }
  }
  return arcs;
}

/** Bounding box in metres, shaped like calloutExtent()'s output, for a
 * caller that just wants the rectangle back without re-destructuring rect. */
export function revisionCloudExtent(cloud) {
  const { minX, minY, maxX, maxY } = cloud.rect;
  return { minX, minY, maxX, maxY, w: Math.max(maxX - minX, 0.1), h: Math.max(maxY - minY, 0.1) };
}
