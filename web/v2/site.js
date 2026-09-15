// Site boundary objects: the last piece of Week 2, per SCHEMA.md's zoning
// open decision. Zoning & setbacks could not be checked because there was
// nothing in the document model to measure a setback against - this module
// is that something.
//
// Three facts, kept separate because they come from different places and
// change on different cycles, the same reasoning SCHEMA.md gives for the SKU
// pack's five blocks:
//   - propertyLine: the erf boundary, from the deeds/SG diagram, drawn once.
//   - sgReference: one control point tying the plan's local origin to the
//     real-world SG diagram coordinate system, plus the erf number. A single
//     point (not a full transform) is a deliberate simplification - it
//     assumes the plan is drawn true-north and true-scale, which the
//     underlay's calibration already requires for anything traced from a
//     real survey.
//   - buildingLine: the setback boundary. Auto-derived from the property
//     line and the rule pack's municipality setback (deriveBuildingLine), or
//     drawn by hand when the municipality has an irregular building line the
//     uniform-offset approximation cannot express.

import { offsetPolygonInward } from "./geom.js?v=20260915-offset";
import { polyShape } from "./model.js";

export function ensureSite(doc) {
  if (!doc.site) {
    doc.site = { erfNumber: null, sgReference: null, propertyLine: null, buildingLine: null };
  }
  return doc.site;
}

/** `points` is an array of [x, y] pairs in plan-local metres. */
export function setPropertyLine(doc, points) {
  const site = ensureSite(doc);
  site.propertyLine = points && points.length >= 3 ? polyShape(points) : null;
  // A previously auto-derived building line was measured off the old
  // boundary and is now meaningless; a hand-drawn one was placed on purpose
  // and is left alone.
  if (site.buildingLine?.derived) site.buildingLine = null;
  return site;
}

export function setBuildingLine(doc, points, { derived = false } = {}) {
  const site = ensureSite(doc);
  site.buildingLine = points && points.length >= 3 ? { ...polyShape(points), derived } : null;
  return site;
}

export function setSgReference(doc, { erfNumber = null, real = null, plan = null } = {}) {
  const site = ensureSite(doc);
  site.erfNumber = erfNumber || null;
  site.sgReference = real && plan ? { real, plan } : null;
  return site;
}

/**
 * Auto-derive the building line as a uniform inward offset of the property
 * line, using the rule pack's setback for the pack's municipality. Returns
 * `{ ok: true, points, setback }` or `{ ok: false, reason }` - the same shape
 * `rules.js`'s zoning check reasons about, so a miss here and a "cannot
 * check" finding there always agree on why.
 */
export function deriveBuildingLine(doc, pack, rulePack) {
  const propertyLine = doc.site?.propertyLine?.points;
  if (!propertyLine || propertyLine.length < 3) {
    return { ok: false, reason: "no property line has been drawn yet" };
  }
  const municipality = pack?.locale?.municipality;
  if (!municipality) {
    return { ok: false, reason: "pack.locale.municipality is not set" };
  }
  const setback = rulePack?.zoning?.setbackByMunicipality?.[municipality];
  if (setback === undefined) {
    return { ok: false, reason: `no setback distance is on file for "${municipality}"` };
  }
  const points = offsetPolygonInward(propertyLine, setback);
  if (!points) {
    return { ok: false, reason: `a uniform ${setback.toFixed(1)} m inward offset collapses this property line's shape` };
  }
  return { ok: true, points, setback };
}
