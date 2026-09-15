// Snapping helpers for the v2 canvas UI.
//
// Two things live here:
//  - Point/alignment snapping: while drawing or moving a wall or beam, its
//    endpoint is pulled onto nearby wall/beam endpoints and room corners
//    (an exact join), or onto the same X or Y as one of those points (an
//    alignment guide, e.g. two wall ends lining up without touching).
//  - The tolerance is expressed in screen pixels by the caller and converted
//    to world units with the current zoom, so snapping gets easier to trigger
//    - and more precise - the further in you zoom, matching the grid-step
//    behaviour in ui.js.
//
// This module has no canvas/DOM dependency so it can be unit tested directly.

import { roomPolygon } from "./model.js";

/** Default screen-pixel radius a point must be within to snap. */
export const SNAP_PIXEL_TOL = 10;

/**
 * Every point another wall, beam or room corner could be joined to, minus
 * whatever the caller is currently dragging (so an object never "snaps" to
 * its own other endpoint or its own corners).
 */
export function collectSnapTargets(doc, opts = {}) {
  const excludeSegmentIds = opts.excludeSegmentIds || new Set();
  const excludeBeamIds = opts.excludeBeamIds || new Set();
  const points = [];
  for (const seg of doc.segments || []) {
    if (excludeSegmentIds.has(seg.id)) continue;
    points.push({ x: seg.x1, y: seg.y1 });
    points.push({ x: seg.x2, y: seg.y2 });
  }
  for (const beam of doc.beams || []) {
    if (excludeBeamIds.has(beam.id)) continue;
    points.push({ x: beam.x1, y: beam.y1 });
    points.push({ x: beam.x2, y: beam.y2 });
  }
  for (const room of doc.rooms || []) {
    for (const [x, y] of roomPolygon(room)) points.push({ x, y });
  }
  return points;
}

/**
 * Snap a candidate point against a list of targets.
 *
 * Priority is an exact point join (both axes within tolerance of the same
 * target) over a single-axis alignment guide (only X or only Y matches, the
 * other axis is left untouched). Returns `snapped: false` and the original
 * coordinates when nothing is close enough.
 */
export function snapPoint(x, y, targets, tolWorld) {
  let best = null;
  let bestD = tolWorld;
  for (const p of targets) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) {
    return { x: best.x, y: best.y, guideX: best.x, guideY: best.y, snapped: true };
  }

  let guideX = null;
  let bestDx = tolWorld;
  let guideY = null;
  let bestDy = tolWorld;
  for (const p of targets) {
    const dx = Math.abs(p.x - x);
    if (dx < bestDx) {
      bestDx = dx;
      guideX = p.x;
    }
    const dy = Math.abs(p.y - y);
    if (dy < bestDy) {
      bestDy = dy;
      guideY = p.y;
    }
  }
  if (guideX !== null || guideY !== null) {
    return {
      x: guideX !== null ? guideX : x,
      y: guideY !== null ? guideY : y,
      guideX,
      guideY,
      snapped: true,
    };
  }
  return { x, y, guideX: null, guideY: null, snapped: false };
}

/**
 * Given the set of a linear object's own endpoints (already offset by a
 * candidate drag delta), find whichever one snaps with the smallest
 * correction, so a wall can be nudged onto a neighbour without the drag
 * feeling like it fights the mouse.
 */
export function bestEndpointSnap(points, targets, tolWorld) {
  let best = null;
  for (const p of points) {
    const s = snapPoint(p.x, p.y, targets, tolWorld);
    if (!s.snapped) continue;
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    const mag = Math.hypot(dx, dy);
    if (!best || mag < best.mag) best = { dx, dy, mag, guide: s };
  }
  return best;
}
