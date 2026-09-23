// Elevation view: an orthographic look at the whole massing from a fixed
// compass direction - Revit's Elevation tool, minus the marker-and-arrow
// ceremony (Output > Views > `elevation`, "one elevation extruded from the
// plan").
//
// A section needed two plan clicks because a cut line has a position the
// user chooses; a whole-building elevation does not - a facade has no start
// point and no end point, so the only fact the user supplies is which side
// they want to look at. This file therefore reuses section.js's u/v
// projection maths (`sectionUV`, `projectSectionPoint`, `sectionFrame`)
// against a locked origin and a compass-fixed look/along pair, rather than
// inventing a second projection. The one real difference from a section: an
// elevation never cuts through a solid, so nothing here is a poché face -
// the whole model always draws, unclipped, the same as the interactive 3D
// view but from a fixed orthographic direction instead of an orbit.

import { nid } from "./model.js";

/**
 * Compass direction -> { look, along, label }, both plan-XY unit vectors.
 * `look` is the direction the viewer looks, using the same sign convention
 * section.js's cuts use: a point's projection along `look` grows the deeper
 * it sits into the model, away from the viewer, so painter's-algorithm
 * sorting ("draw the far thing first") works unchanged for both.
 * `along` is the screen's rightward axis, chosen so each elevation reads the
 * way Revit's compass elevations do: standing south and facing north, east
 * is on your right, and the same rule turns with you around the compass.
 */
const DIRECTIONS = {
  N: { label: "North", look: [0, 1], along: [1, 0] },
  S: { label: "South", look: [0, -1], along: [-1, 0] },
  E: { label: "East", look: [1, 0], along: [0, -1] },
  W: { label: "West", look: [-1, 0], along: [0, 1] },
};

export const ELEVATION_DIRECTIONS = Object.keys(DIRECTIONS);

export function elevationDirectionLabel(direction) {
  return DIRECTIONS[direction]?.label || null;
}

/**
 * A compass elevation has no click to derive a position from, so the origin
 * is always the plan's own [0, 0] - `sectionFrame()` recentres the view on
 * whatever the model's actual extent turns out to be, the same as a section
 * does. `length`/`far` are 0: nothing here ever gets clipped to a band, so
 * neither section.js field applies, and leaving them at 0 rather than
 * omitting them keeps this shape close enough to a section's cut that the
 * shared projection helpers need no special-casing.
 */
export function elevationCut(direction) {
  const dir = DIRECTIONS[direction];
  if (!dir) return null;
  return {
    mode: "elevation",
    direction,
    label: dir.label,
    origin: [0, 0],
    along: dir.along,
    look: dir.look,
    length: 0,
    far: 0,
  };
}

// --- persisted elevations (Document > Views > Elevation) -------------------
//
// Same permanence rule `createSection` follows: placing one always creates a
// named, saved view, never a scratch value the quick look throws away, so
// `sheets.js` can point a sheet's viewport at a named elevation later
// exactly as it already can at a named section.

export function ensureElevations(doc) {
  if (!Array.isArray(doc.elevations)) doc.elevations = [];
  return doc.elevations;
}

function nextElevationName(elevations, direction) {
  const label = elevationDirectionLabel(direction) || direction;
  const existing = elevations.filter((e) => e.cut?.direction === direction).length;
  return existing ? `${label} elevation ${existing + 1}` : `${label} elevation`;
}

/** `direction` must be one of `ELEVATION_DIRECTIONS`; anything else is
 * refused rather than silently falling back to North, the same "never a
 * plausible default" rule `createSection` applies to a malformed cut. */
export function createElevation(doc, direction, { name } = {}) {
  const cut = elevationCut(direction);
  if (!cut) return { ok: false, reason: `unknown direction "${direction}"` };
  const elevations = ensureElevations(doc);
  const elevation = { id: nid("elev"), name: name || nextElevationName(elevations, direction), cut };
  elevations.push(elevation);
  return { ok: true, elevation };
}

export function removeElevation(doc, elevationId) {
  const elevations = ensureElevations(doc);
  const idx = elevations.findIndex((e) => e.id === elevationId);
  if (idx < 0) return false;
  elevations.splice(idx, 1);
  return true;
}

export function elevationById(doc, elevationId) {
  return ensureElevations(doc).find((e) => e.id === elevationId) || null;
}
