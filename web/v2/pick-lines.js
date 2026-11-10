// Pick Lines: a wall placed along a line that is already there, at the
// offset, on the side the cursor is on. No DOM here, so the side rule and the
// corner between two picks can be tested without the planner page.
//
// Lines are { x1, y1, x2, y2 } in plan metres, Y down like the screen. "Left"
// of start->end is the exterior side, the same convention as `click-draw.js`.

import { normalizeWallLocation } from "./click-draw.js";

function lengthOf(line) {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

function reversed(line) {
  return { x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 };
}

/** Unit normal to the left of start->end. */
function leftNormal(line) {
  const len = lengthOf(line) || 1;
  return { x: (line.y2 - line.y1) / len, y: -(line.x2 - line.x1) / len };
}

function shifted(line, distance) {
  const n = leftNormal(line);
  return {
    x1: line.x1 + n.x * distance,
    y1: line.y1 + n.y * distance,
    x2: line.x2 + n.x * distance,
    y2: line.y2 + n.y * distance,
  };
}

/** Signed distance to the left of a line. Positive is the exterior side of a wall stored on this line. */
export function signedSide(line, point) {
  const len = lengthOf(line) || 1;
  const nx = (line.y2 - line.y1) / len;
  const ny = -(line.x2 - line.x1) / len;
  return (point.x - line.x1) * nx + (point.y - line.y1) * ny;
}

/**
 * Which side of a wall the preview stays on. `signed` is the cursor's distance
 * to the left of the centreline, `half` is half the wall's thickness, and
 * `held` is the side already showing. The side changes only once the cursor
 * has gone past the far face, so travelling across the wall does not flip it.
 */
export function heldWallSide(signed, half, held = null) {
  const h = Math.max(0, Number(half) || 0);
  if (held === "left" && signed > -h) return "left";
  if (held === "right" && signed < h) return "right";
  if (signed > 1e-6) return "left";
  if (signed < -1e-6) return "right";
  return held;
}

/** Distance from a point to a finite line, and where along it (0..1) the nearest point is. */
export function distanceToLine(line, point) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { dist: Math.hypot(point.x - line.x1, point.y - line.y1), t: 0 };
  let t = ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(point.x - (line.x1 + t * dx), point.y - (line.y1 + t * dy)), t };
}

/** The closest line within `tol` of the point, or null. Lines shorter than `minLength` are skipped. */
export function nearestPickLine(lines, point, tol, minLength = 0) {
  let best = null;
  for (const line of lines || []) {
    if (!line || lengthOf(line) < minLength) continue;
    const { dist } = distanceToLine(line, point);
    if (dist > tol) continue;
    if (!best || dist < best.dist) best = { line, dist };
  }
  return best;
}

/**
 * Where a picked wall goes. The wall body always lands on the cursor's side
 * of the picked line, `offset` metres away from it (the sign is ignored: the
 * cursor already says which side). The location line decides which part of
 * the wall sits on that offset line:
 *
 * - exterior face: the outside face is on the line, so the wall runs with the
 *   cursor on its right (the interior side).
 * - interior face: the inside face is on the line, so the cursor is on its left.
 * - centreline: the cursor is on the interior side, so the exterior faces the
 *   line that was picked.
 *
 * Returns the oriented picked line (`ref`), the location line to store
 * (`line`), and the signed shift between them (`distance`, positive left), or
 * null when the cursor sits on the line and has no side.
 */
export function pickedWallPlacement(source, cursor, { offset = 0, location = "center", side = null } = {}) {
  if (!source || lengthOf(source) < 1e-9) return null;
  // `side` holds the wall's side while the cursor travels across it. Without
  // it, the side is read from the cursor, and a cursor sitting on the line
  // has none.
  let cursorLeft;
  if (side === "left" || side === "right") cursorLeft = side === "left";
  else {
    if (!cursor) return null;
    const across = signedSide(source, cursor);
    if (Math.abs(across) < 1e-9) return null;
    cursorLeft = across > 0;
  }
  const loc = normalizeWallLocation(location);
  const wantLeft = loc === "interior";
  const ref = cursorLeft === wantLeft ? { ...source } : reversed(source);
  const gap = Math.abs(Number(offset) || 0);
  const distance = wantLeft ? gap : -gap;
  return { ref, line: shifted(ref, distance), distance, location: loc };
}

/** An end the two lines share, within `tol`, or null. */
export function sharedEndpoint(a, b, tol = 0.001) {
  if (!a || !b) return null;
  for (const p of [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }]) {
    for (const q of [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }]) {
      if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
  }
  return null;
}

function crossing(a, b) {
  const dax = a.x2 - a.x1;
  const day = a.y2 - a.y1;
  const dbx = b.x2 - b.x1;
  const dby = b.y2 - b.y1;
  const den = dax * dby - day * dbx;
  const scale = Math.hypot(dax, day) * Math.hypot(dbx, dby);
  if (!(scale > 0) || Math.abs(den) < 1e-6 * scale) return null;
  const t = ((b.x1 - a.x1) * dby - (b.y1 - a.y1) * dbx) / den;
  return { x: a.x1 + t * dax, y: a.y1 + t * day };
}

function nearerEnd(line, point) {
  const d1 = Math.hypot(line.x1 - point.x, line.y1 - point.y);
  const d2 = Math.hypot(line.x2 - point.x, line.y2 - point.y);
  return d1 <= d2 ? 1 : 2;
}

function withEnd(line, end, point) {
  return end === 1
    ? { ...line, x1: point.x, y1: point.y }
    : { ...line, x2: point.x, y2: point.y };
}

/**
 * Two picked walls whose picked lines met at `corner`: each is moved on its
 * own line to where the two cross, so the walls meet instead of leaving a gap
 * or an overlap at the corner. Null when they are parallel, the crossing is
 * further than `reach` from the corner, or either wall would be shorter than
 * `minLength`. `prevEnd` and `nextEnd` say which end (1 or 2) moved.
 */
export function closePickedCorner(prev, next, corner, { reach = 0.5, minLength = 0 } = {}) {
  if (!prev || !next || !corner) return null;
  const hit = crossing(prev, next);
  if (!hit) return null;
  if (Math.hypot(hit.x - corner.x, hit.y - corner.y) > reach) return null;
  const prevEnd = nearerEnd(prev, corner);
  const nextEnd = nearerEnd(next, corner);
  const prevLine = withEnd(prev, prevEnd, hit);
  const nextLine = withEnd(next, nextEnd, hit);
  if (lengthOf(prevLine) < minLength || lengthOf(nextLine) < minLength) return null;
  return { point: hit, prev: prevLine, next: nextLine, prevEnd, nextEnd };
}
