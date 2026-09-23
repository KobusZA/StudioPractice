// Section view: a vertical cut through compile()'s massing faces.
//
// Same extrusion Camera and 3D already use - not a second model. Every cut
// is also saved as a named view (below), so `sheets.js` can draft it onto a
// sheet's viewport later (Output > view-section) without re-deriving it. The
// cut itself is a viewing plane the user placed; look is to the left of the
// stroke, so drawing the line the other way flips the view the way Revit does.

import { nid } from "./model.js";

export const SECTION_FAR_M = 20;
export const SECTION_U_PAD = 0.4;

function xy(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  return [Number(p?.x), Number(p?.y)];
}

/**
 * Two plan clicks become a vertical cut. Look is 90° CCW from A→B.
 * Returns null when the clicks are the same point.
 */
export function sectionFromClicks(a, b, far = SECTION_FAR_M) {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 0.2) return null;
  const tx = dx / length;
  const ty = dy / length;
  return {
    mode: "section",
    origin: [ax, ay],
    along: [tx, ty],
    look: [-ty, tx],
    length,
    far: Number(far) > 0 ? Number(far) : SECTION_FAR_M,
  };
}

export function sectionDot(p, origin, n) {
  return (p[0] - origin[0]) * n[0] + (p[1] - origin[1]) * n[1];
}

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Keep vertices with n · (p − origin) ≥ keepMin. One plane per call. */
export function clipPolyHalfspace(pts, origin, n, keepMin = 0) {
  if (!pts?.length) return [];
  const out = [];
  const count = pts.length;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % count];
    const da = sectionDot(a, origin, n);
    const db = sectionDot(b, origin, n);
    const ain = da >= keepMin - 1e-6;
    const bin = db >= keepMin - 1e-6;
    if (ain && bin) out.push(b);
    else if (ain && !bin) {
      out.push(lerp3(a, b, (keepMin - da) / (db - da)));
    } else if (!ain && bin) {
      out.push(lerp3(a, b, (keepMin - da) / (db - da)));
      out.push(b);
    }
  }
  return out;
}

function clipBetween(pts, origin, n, min, max) {
  let next = clipPolyHalfspace(pts, origin, n, min);
  next = clipPolyHalfspace(next, origin, [-n[0], -n[1]], -max);
  return next;
}

// A poche hatch is the solid the plane slices, not every face that merely
// touches the plane on its way into the look volume. Receding wall sides and
// roof slopes do touch the cut, then run metres beyond it; flattening them
// (dropping depth) makes a sliver, and hatching that sliver sprays 45° lines
// across the elevation.
const CUT_BAND_M = 0.45;

function faceOnCut(pts, origin, look) {
  let minD = Infinity;
  let maxD = -Infinity;
  for (const p of pts) {
    const d = sectionDot(p, origin, look);
    minD = Math.min(minD, d);
    maxD = Math.max(maxD, d);
  }
  return minD < 0.02 && maxD > -0.02 && (maxD - minD) < CUT_BAND_M;
}

/**
 * Clip massing faces to the finite section volume: on the look side of the
 * cut, within the drawn length, and no deeper than `far`.
 */
export function clipFacesForSection(faces, cut) {
  if (!cut || cut.mode !== "section") return [];
  const origin = cut.origin;
  const along = cut.along;
  const look = cut.look;
  const length = cut.length;
  const far = cut.far ?? SECTION_FAR_M;
  const out = [];
  for (const face of faces || []) {
    const src = face.pts || [];
    if (src.length < 3) continue;
    const cutHit = faceOnCut(src, origin, look);
    let pts = clipBetween(src, origin, look, 0, far);
    pts = clipBetween(pts, origin, along, -SECTION_U_PAD, length + SECTION_U_PAD);
    if (pts.length < 3) continue;
    out.push({ ...face, pts, cut: cutHit });
  }
  return out;
}

export function sectionUV(p, cut) {
  const u = sectionDot(p, cut.origin, cut.along);
  const v = p[2];
  const depth = sectionDot(p, cut.origin, cut.look);
  return [u, v, depth];
}

export function projectSectionPoint(x, y, z, cut, originU, originV, scale, cx, cy) {
  const [u, v, depth] = sectionUV([x, y, z], cut);
  return [cx + (u - originU) * scale, cy - (v - originV) * scale, depth];
}

// --- persisted sections (Document > Views > Section) -----------------------
//
// The Section tool always makes a new one, the same as Revit: a cut is its
// own view from the moment it is drawn, not a scratch value the quick look
// discards on close. That permanence is what `view-section` (Output > Views,
// "placing a section view on a sheet, once sheets exist") needed - sheets.js
// can now point a sheet's one viewport at a named section instead of only
// ever the plan.

export function ensureSections(doc) {
  if (!Array.isArray(doc.sections)) doc.sections = [];
  return doc.sections;
}

function nextSectionName(sections) {
  return `Section ${sections.length + 1}`;
}

/** `cut` must be a `sectionFromClicks()` result; a malformed one is refused
 * rather than saved half-formed, the same rule `createSheet` applies to an
 * unknown paper size. */
export function createSection(doc, cut, { name } = {}) {
  if (!cut || cut.mode !== "section") return { ok: false, reason: "not a section cut" };
  const sections = ensureSections(doc);
  const section = { id: nid("sec"), name: name || nextSectionName(sections), cut };
  sections.push(section);
  return { ok: true, section };
}

export function removeSection(doc, sectionId) {
  const sections = ensureSections(doc);
  const idx = sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) return false;
  sections.splice(idx, 1);
  return true;
}

export function sectionById(doc, sectionId) {
  return ensureSections(doc).find((s) => s.id === sectionId) || null;
}

export function sectionFrame(faces, cut) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const face of faces) {
    for (const p of face.pts) {
      const [u, v] = sectionUV(p, cut);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  if (!Number.isFinite(minU)) {
    return { originU: cut.length / 2, originV: 1.4, span: Math.max(cut.length, 3) };
  }
  const span = Math.max(maxU - minU, maxV - minV, 1);
  return {
    originU: (minU + maxU) / 2,
    originV: (minV + maxV) / 2,
    span,
  };
}
