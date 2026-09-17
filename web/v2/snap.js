// Snapping helpers for the v2 canvas UI.
//
// Three things live here:
//  - Point/alignment snapping: while drawing or moving a wall, beam, room,
//    slab or roof, a corner/endpoint is pulled onto nearby wall/beam
//    endpoints and room/slab/roof corners (an exact join), or onto the same
//    X or Y as one of those points (an alignment guide, e.g. a roof eave
//    lining up with a wall without touching it).
//  - Nice-length snapping: a free endpoint is attracted to round millimetre
//    offsets (3500 mm before 3507 mm) from the wall's start, a nearby object,
//    or the origin. The pull is a magnet, not a lock: zoom in and the same
//    1 mm values remain reachable.
//  - The join/magnet tolerance is expressed in screen pixels by the caller
//    and converted to world units with the current zoom, so snapping gets
//    easier to trigger - and more precise - the further in you zoom.
//
// This module has no canvas/DOM dependency so it can be unit tested directly.

import { paramOnSeg, roundGrid } from "./geom.js";
import { roomPolygon, shapePolygon } from "./model.js";

/** Default screen-pixel radius a point must be within to snap. */
export const SNAP_PIXEL_TOL = 10;

/**
 * Length increments the cursor is attracted to, coarsest first, in metres.
 * 3500 mm sits on 0.5 m and 0.1 m; 3507 mm only on 0.001 m. Coarser steps
 * get a larger magnet (capped by the pixel tolerance), so round numbers
 * stick until the user zooms in far enough to pick a 1 mm value.
 */
export const NICE_STEPS_M = [1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001];

/** Finest length the magnet will settle on, 1 mm. */
export const NICE_MIN_STEP_M = 0.001;

/** Pull radius for one increment: 40% of the step, never more than `tolWorld`. */
export function niceMagnet(step, tolWorld) {
  return Math.min(tolWorld, step * 0.4);
}

/**
 * Snap `value` to a round offset from one of `origins`. Coarser increments
 * win when they fall inside their magnet, so 3.500 m from a wall at 1.007 m
 * is preferred over the world-grid neighbours 3.498 / 3.507. Outside every
 * magnet, the result is still 1 mm from the nearest origin - not from 0 -
 * so a wall that started off the world grid can still land on 3500 mm.
 */
export function snapCoord(value, origins, tolWorld, minStep = NICE_MIN_STEP_M) {
  const refs = origins.length ? origins : [0];
  // Origins are tried in caller order (run start, then a nearby object, then
  // the world origin) so a 0.5 m world grid cannot steal a 3500 mm length
  // from a wall that started 7 mm off that grid.
  for (const origin of refs) {
    for (const step of NICE_STEPS_M) {
      if (step < minStep - 1e-12) continue;
      const snapped = origin + roundGrid(value - origin, step);
      if (Math.abs(snapped - value) <= niceMagnet(step, tolWorld)) return snapped;
    }
  }
  let nearest = refs[0];
  let nearestD = Math.abs(value - nearest);
  for (const origin of refs) {
    const d = Math.abs(value - origin);
    if (d < nearestD) {
      nearest = origin;
      nearestD = d;
    }
  }
  return nearest + roundGrid(value - nearest, minStep);
}

/** Snap a signed length (metres) toward the nicest increment within `tolWorld`. */
export function snapNiceDelta(delta, tolWorld, minStep = NICE_MIN_STEP_M) {
  return snapCoord(delta, [0], tolWorld, minStep);
}

/** Pull `to` along the ray from `from` so the length is a round millimetre. */
export function snapLengthFrom(from, to, tolWorld, minStep = NICE_MIN_STEP_M) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: to.x, y: to.y };
  const nice = snapNiceDelta(len, tolWorld, minStep);
  const s = nice / len;
  return { x: from.x + dx * s, y: from.y + dy * s };
}

function isExactPointSnap(join) {
  return Boolean(
    join?.snapped
    && join.guideX != null
    && join.guideY != null
    && join.guideXPoint
    && join.guideYPoint
    && join.guideXPoint.x === join.guideYPoint.x
    && join.guideXPoint.y === join.guideYPoint.y,
  );
}

/**
 * After a join/alignment test, pull any still-free axis onto a round
 * millimetre. Exact endpoint joins win outright. A single-axis alignment
 * keeps that axis locked so a tracking line is not broken to chase 3500 mm.
 */
export function applyNicePoint(wx, wy, opts = {}) {
  const join = opts.join || { snapped: false, x: wx, y: wy, guideX: null, guideY: null };
  const tolWorld = opts.tolWorld ?? 0;
  const minStep = opts.minStep ?? NICE_MIN_STEP_M;
  const from = opts.from || null;
  const originsX = opts.originsX || [0];
  const originsY = opts.originsY || [0];
  if (isExactPointSnap(join)) return { x: join.x, y: join.y };
  const lockX = join.snapped && join.guideX != null;
  const lockY = join.snapped && join.guideY != null;
  let x = lockX ? join.x : snapCoord(wx, originsX, tolWorld, minStep);
  let y = lockY ? join.y : snapCoord(wy, originsY, tolWorld, minStep);
  if (from) {
    if (!lockX && !lockY) {
      const p = snapLengthFrom(from, { x, y }, tolWorld, minStep);
      x = p.x;
      y = p.y;
    } else if (lockX && !lockY) {
      y = from.y + snapNiceDelta(y - from.y, tolWorld, minStep);
    } else if (lockY && !lockX) {
      x = from.x + snapNiceDelta(x - from.x, tolWorld, minStep);
    }
  }
  return { x, y };
}

/** Past this, a gap label would be measuring across empty site, not an eave. */
export const GAP_MAX_M = 4;

/**
 * Every point another wall, beam, room, slab or roof corner could be joined
 * to, minus whatever the caller is currently dragging (so an object never
 * "snaps" to its own other endpoint or its own corners).
 */
function snapIncluded(obj, opts) {
  return !opts.include || opts.include(obj);
}

export function collectSnapTargets(doc, opts = {}) {
  const excludeSegmentIds = opts.excludeSegmentIds || new Set();
  const excludeBeamIds = opts.excludeBeamIds || new Set();
  const points = [];
  for (const seg of doc.segments || []) {
    if (excludeSegmentIds.has(seg.id) || !snapIncluded(seg, opts)) continue;
    points.push({ x: seg.x1, y: seg.y1 });
    points.push({ x: seg.x2, y: seg.y2 });
  }
  for (const beam of doc.beams || []) {
    if (excludeBeamIds.has(beam.id) || !snapIncluded(beam, opts)) continue;
    points.push({ x: beam.x1, y: beam.y1 });
    points.push({ x: beam.x2, y: beam.y2 });
  }
  for (const room of doc.rooms || []) {
    if (!snapIncluded(room, opts)) continue;
    for (const [x, y] of roomPolygon(room)) points.push({ x, y });
  }
  for (const slab of doc.slabs || []) {
    if (!snapIncluded(slab, opts)) continue;
    for (const [x, y] of shapePolygon(slab.shape)) points.push({ x, y });
  }
  for (const roof of doc.roofs || []) {
    if (!snapIncluded(roof, opts)) continue;
    for (const [x, y] of shapePolygon(roof.shape)) points.push({ x, y });
  }
  return points;
}

function pushPolyEdges(edges, poly) {
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    edges.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  }
}

/**
 * Wall/beam/room/slab/roof edges, so a gap label can measure to the face of
 * a wall rather than only to a corner that happens to share an X or Y.
 */
export function collectSnapEdges(doc, opts = {}) {
  const excludeSegmentIds = opts.excludeSegmentIds || new Set();
  const excludeBeamIds = opts.excludeBeamIds || new Set();
  const edges = [];
  for (const seg of doc.segments || []) {
    if (excludeSegmentIds.has(seg.id) || !snapIncluded(seg, opts)) continue;
    edges.push({ x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
  }
  for (const beam of doc.beams || []) {
    if (excludeBeamIds.has(beam.id) || !snapIncluded(beam, opts)) continue;
    edges.push({ x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2 });
  }
  for (const room of doc.rooms || []) {
    if (snapIncluded(room, opts)) pushPolyEdges(edges, roomPolygon(room));
  }
  for (const slab of doc.slabs || []) {
    if (snapIncluded(slab, opts)) pushPolyEdges(edges, shapePolygon(slab.shape));
  }
  for (const roof of doc.roofs || []) {
    if (snapIncluded(roof, opts)) pushPolyEdges(edges, shapePolygon(roof.shape));
  }
  return edges;
}

function closestOnSeg(edge, x, y) {
  const t = Math.min(1, Math.max(0, paramOnSeg(edge.x1, edge.y1, edge.x2, edge.y2, x, y)));
  return {
    x: edge.x1 + (edge.x2 - edge.x1) * t,
    y: edge.y1 + (edge.y2 - edge.y1) * t,
  };
}

/**
 * Snap a candidate point against a list of targets.
 *
 * Priority is an exact point join (both axes within tolerance of the same
 * target) over a single-axis alignment guide (only X or only Y matches, the
 * other axis is left untouched). Returns `snapped: false` and the original
 * coordinates when nothing is close enough.
 *
 * Alongside `guideX`/`guideY` (the coordinate the guide line runs along),
 * `guideXPoint`/`guideYPoint` carry the full target point that produced
 * each guide, so a caller can measure *how far along that line* the target
 * actually sits (the guide itself is drawn edge-to-edge and says nothing
 * about distance on its own).
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
    return {
      x: best.x,
      y: best.y,
      guideX: best.x,
      guideY: best.y,
      guideXPoint: best,
      guideYPoint: best,
      snapped: true,
    };
  }

  let guideX = null;
  let guideXPoint = null;
  let bestDx = tolWorld;
  let guideY = null;
  let guideYPoint = null;
  let bestDy = tolWorld;
  for (const p of targets) {
    const dx = Math.abs(p.x - x);
    if (dx < bestDx) {
      bestDx = dx;
      guideX = p.x;
      guideXPoint = p;
    }
    const dy = Math.abs(p.y - y);
    if (dy < bestDy) {
      bestDy = dy;
      guideY = p.y;
      guideYPoint = p;
    }
  }
  if (guideX !== null || guideY !== null) {
    return {
      x: guideX !== null ? guideX : x,
      y: guideY !== null ? guideY : y,
      guideX,
      guideY,
      guideXPoint,
      guideYPoint,
      snapped: true,
    };
  }
  return { x, y, guideX: null, guideY: null, guideXPoint: null, guideYPoint: null, snapped: false };
}

/**
 * The single nearest corner or edge point, and the signed offset from it.
 *
 * Both axes come from that one origin so the L-shaped gap cannot meet in
 * empty space (which happens if nearest-X and nearest-Y are different
 * objects). Empty `targets`/`edges` yields null guides.
 */
export function nearestAlignments(x, y, targets, edges = []) {
  let nearest = null;
  let bestD = Infinity;
  for (const p of targets) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      nearest = p;
    }
  }
  for (const edge of edges) {
    const p = closestOnSeg(edge, x, y);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      nearest = p;
    }
  }
  if (!nearest) {
    return {
      nearest: null,
      dist: Infinity,
      guideX: null,
      guideY: null,
      dx: null,
      dy: null,
    };
  }
  return {
    nearest,
    dist: bestD,
    guideX: nearest.x,
    guideY: nearest.y,
    dx: x - nearest.x,
    dy: y - nearest.y,
  };
}

/**
 * The four directions a live measurement can be pinned to. `up` is -Y
 * because the canvas draws +Y down the screen, so "up" means what the user
 * sees, not what the axis sign says.
 */
export const PROBE_VECTORS = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
};

/**
 * Cast an axis-aligned ray from (x, y) towards `dir` and return the first
 * edge it crosses as `{ dist, hit, dir }`.
 *
 * This is what makes a measurement answer "how far to the object on *that*
 * side" rather than nearestAlignments' "how far to the closest object in any
 * direction": the nearest object can only ever be on one side of each axis,
 * so a gap below a point is invisible whenever something above it is closer.
 * Null means that side is empty - the caller draws a faded string for it
 * instead of silently dropping the dimension.
 */
export function probeDirection(x, y, dir, edges = []) {
  const v = PROBE_VECTORS[dir];
  if (!v) return null;
  const horizontal = v.dy === 0;
  let best = null;
  for (const edge of edges) {
    // Param along the edge where it crosses the ray's own line. An edge
    // parallel to the ray has no single crossing, so it is skipped.
    const from = horizontal ? edge.y1 : edge.x1;
    const to = horizontal ? edge.y2 : edge.x2;
    const span = to - from;
    if (Math.abs(span) < 1e-9) continue;
    const t = ((horizontal ? y : x) - from) / span;
    if (t < 0 || t > 1) continue;
    const hit = {
      x: edge.x1 + (edge.x2 - edge.x1) * t,
      y: edge.y1 + (edge.y2 - edge.y1) * t,
    };
    const dist = horizontal ? (hit.x - x) * v.dx : (hit.y - y) * v.dy;
    if (dist <= 1e-6) continue; // behind the ray, or the point is on the edge
    if (!best || dist < best.dist) best = { dist, hit, dir, edge };
  }
  return best;
}

/**
 * How far it is from (x, y) to where `edge` ends in direction `dir`.
 *
 * This is the other half of a pinned measurement: once the user has asked
 * for the wall on their left, "up" means how far up *that wall* they are,
 * the way you would dimension off it on paper. A plain ray upwards would
 * instead report whatever unrelated object happens to be overhead, or
 * nothing at all when the wall is the only thing on the sheet.
 *
 * Null when the edge only ends the other way (so the caller can fade).
 */
export function probeAlongEdge(x, y, dir, edge) {
  const v = PROBE_VECTORS[dir];
  if (!v || !edge) return null;
  const horizontal = v.dy === 0;
  const ends = horizontal
    ? [{ x: edge.x1, y }, { x: edge.x2, y }]
    : [{ x, y: edge.y1 }, { x, y: edge.y2 }];
  let best = null;
  for (const hit of ends) {
    const dist = horizontal ? (hit.x - x) * v.dx : (hit.y - y) * v.dy;
    if (dist <= 1e-6) continue;
    if (!best || dist < best.dist) best = { dist, hit, dir, edge, alongEdge: true };
  }
  return best;
}

const ON_EDGE_TOL = 1e-4;

/**
 * Measure along an edge the point is already sitting on - the wall a
 * foundation is being drawn under, for example. A ray in `dir` cannot
 * cross that edge (it is parallel, and the point is on it), so without
 * this a pinned up/down next to a vertical wall reports empty even though
 * the thing being dimensioned is under the cursor.
 */
export function probeAlongOccupiedEdge(x, y, dir, edges = []) {
  let best = null;
  for (const edge of edges) {
    const on = closestOnSeg(edge, x, y);
    if (Math.hypot(on.x - x, on.y - y) > ON_EDGE_TOL) continue;
    const along = probeAlongEdge(x, y, dir, edge);
    if (!along) continue;
    if (!best || along.dist < best.dist) best = along;
  }
  return best;
}

/**
 * Resolve pinned live measurements from (x, y). Direct rays first; a miss
 * then measures along the edge under the cursor; a miss after that uses
 * an edge another pinned axis already hit ("the wall on my left, and how
 * far up it I am"). `to: null` means that side is empty.
 */
export function resolveProbes(x, y, sides, edges = []) {
  if (!sides.length) return [];
  const direct = sides.map((side) => ({ side, found: probeDirection(x, y, side, edges) }));
  const reference = direct.find((d) => d.found)?.found ?? null;
  return direct.map(({ side, found }) => {
    if (found) return { side, from: { x, y }, to: found.hit, dist: found.dist };
    const alongHere = probeAlongOccupiedEdge(x, y, side, edges);
    if (alongHere) return { side, from: { x, y }, to: alongHere.hit, dist: alongHere.dist };
    const along = reference ? probeAlongEdge(reference.hit.x, reference.hit.y, side, reference.edge) : null;
    if (along) return { side, from: reference.hit, to: along.hit, dist: along.dist };
    return { side, from: { x, y }, to: null, dist: null };
  });
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
