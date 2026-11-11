// Click–click drawing: first click anchors, the pointer moves with the button
// up, second click commits. `drag` in the canvas UI stays for true press-and-
// hold (pan, marquee, move, underlay, stretching a wall end).
//
// No DOM here so the commit rules, chain, and Escape layering can be tested
// without the planner page.

export const MIN_TRACE = 0.3;
export const MIN_ROOM = 1;

export function lineLength(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function canCommitLine(a, b, min = MIN_TRACE) {
  return lineLength(a, b) >= min;
}

/** After a committed wall, the next segment starts at that endpoint.
 * The endpoint is the location line the user drew, not the stored centreline,
 * so a face-justified wall chains along the face. */
export function chainStart(end) {
  return { x1: end.x, y1: end.y, x2: end.x, y2: end.y };
}

/**
 * What follows a placed wall. With chain on, the next segment starts at the
 * end that was clicked, so the run continues. With chain off, the tool waits
 * for a new start and the next wall does not begin at this end.
 */
export function nextWallDraft(end, { chain = true, prev = null, prevId = null } = {}) {
  if (!chain || !end) return null;
  return {
    ...chainStart(end),
    chained: true,
    ...(prev ? { prev } : {}),
    ...(prevId ? { prevId } : {}),
  };
}

/**
 * The line a wall is placed on, shifted sideways from the line the cursor
 * tracked. Positive `distance` (metres) is to the left of start→end, the
 * exterior side: the side a positive offset uses. Zero leaves the line
 * where it was drawn.
 */
export function offsetPlacementLine(a, b, distance) {
  return offsetRun(a?.x ?? 0, a?.y ?? 0, b?.x ?? a?.x ?? 0, b?.y ?? a?.y ?? 0, Number(distance) || 0);
}

function lineParam(line, point) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return null;
  return ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / len2;
}

function lineIntersect(a, b) {
  const dax = a.x2 - a.x1;
  const day = a.y2 - a.y1;
  const dbx = b.x2 - b.x1;
  const dby = b.y2 - b.y1;
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b.x1 - a.x1) * dby - (b.y1 - a.y1) * dbx) / den;
  return { x: a.x1 + t * dax, y: a.y1 + t * day };
}

/**
 * The corner where two chained walls meet once each has been shifted by the
 * same offset. The shifted lines do not share the clicked corner, so both
 * are extended or shortened to their crossing. A turn away from the offset
 * lengthens them; a turn toward it shortens them. Null when the lines are
 * parallel, or the crossing would swallow a wall or land far past the turn.
 */
export function offsetChainCorner(prev, next) {
  if (!prev || !next) return null;
  const hit = lineIntersect(prev, next);
  if (!hit) return null;
  const tPrev = lineParam(prev, hit);
  const tNext = lineParam(next, hit);
  if (tPrev == null || tNext == null) return null;
  if (tPrev <= 0.05 || tNext >= 0.95) return null;
  const end = { x: prev.x2, y: prev.y2 };
  const start = { x: next.x1, y: next.y1 };
  const gap = Math.hypot(end.x - start.x, end.y - start.y);
  const reach = Math.max(gap * 4, 0.5);
  if (Math.hypot(hit.x - end.x, hit.y - end.y) > reach) return null;
  if (Math.hypot(hit.x - start.x, hit.y - start.y) > reach) return null;
  return hit;
}

/**
 * Revit's location line, reduced to what a single-thickness wall has: the
 * centreline and its two faces. Exterior is the face on your left as you walk
 * from the start to the end, so a run drawn clockwise round a building puts
 * the exterior outside, as Revit does. "left"/"right" are older names for the
 * same two faces.
 */
export const WALL_LOCATIONS = ["center", "exterior", "interior"];

export function normalizeWallLocation(location) {
  if (location === "exterior" || location === "left") return "exterior";
  if (location === "interior" || location === "right") return "interior";
  return "center";
}

export function isFaceLocation(location) {
  return normalizeWallLocation(location) !== "center";
}

function offsetRun(x1, y1, x2, y2, distance) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1e-9 || !distance) return { x1, y1, x2, y2 };
  // Positive is toward the exterior: the visual left on a Y-down plan.
  const nx = ((y2 - y1) / len) * distance;
  const ny = (-(x2 - x1) / len) * distance;
  return { x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny };
}

/**
 * The line the user draws is the location line. The wall is stored on its
 * centreline, so a face choice shifts both ends by half the thickness, away
 * from that face. Plan Y grows downward like the screen, so the exterior of a
 * run drawn to the right is the upper face.
 *
 * A zero-length run has no side, and an unknown location is the centreline.
 */
export function centerlineFromLocation(a, b, thickness, location = "center") {
  const x1 = a?.x ?? 0;
  const y1 = a?.y ?? 0;
  const x2 = b?.x ?? x1;
  const y2 = b?.y ?? y1;
  const loc = normalizeWallLocation(location);
  if (loc === "center" || !(thickness > 0)) return { x1, y1, x2, y2 };
  return offsetRun(x1, y1, x2, y2, (loc === "exterior" ? -1 : 1) * (thickness / 2));
}

/** The location line of a stored centreline: the inverse of `centerlineFromLocation`. */
export function locationLineOf(seg, thickness, location = seg?.location) {
  const loc = normalizeWallLocation(location);
  if (loc === "center" || !(thickness > 0)) return { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 };
  return offsetRun(seg.x1, seg.y1, seg.x2, seg.y2, (loc === "exterior" ? 1 : -1) * (thickness / 2));
}

/**
 * A face-drawn wall keeps its location line when its thickness changes, so a
 * thicker type grows away from the face that was aligned instead of both ways.
 * Mutates and returns `seg`.
 */
export function rethickenAboutLocation(seg, oldThickness, newThickness) {
  if (!isFaceLocation(seg?.location) || !(oldThickness > 0) || !(newThickness > 0)) return seg;
  const line = locationLineOf(seg, oldThickness);
  const next = centerlineFromLocation({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, newThickness, seg.location);
  Object.assign(seg, next);
  return seg;
}

/**
 * Move an existing wall onto a different location line. The line it was drawn
 * on stays where it is; the centreline shifts so the chosen face or middle
 * lands on that line. A centreline wall stores no `location`. Returns false
 * when the wall is already on that line, or has no length or thickness to
 * shift about. Mutates `seg`.
 */
export function realignAboutLocation(seg, thickness, newLocation) {
  const nextLoc = normalizeWallLocation(newLocation);
  if (!seg || nextLoc === normalizeWallLocation(seg.location)) return false;
  const len = Math.hypot((seg.x2 ?? 0) - (seg.x1 ?? 0), (seg.y2 ?? 0) - (seg.y1 ?? 0));
  if (!(thickness > 0) || len < 1e-9) return false;
  const line = locationLineOf(seg, thickness);
  const next = centerlineFromLocation({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, thickness, nextLoc);
  seg.x1 = next.x1;
  seg.y1 = next.y1;
  seg.x2 = next.x2;
  seg.y2 = next.y2;
  if (Number.isFinite(seg.length)) seg.length = Math.hypot(next.x2 - next.x1, next.y2 - next.y1);
  if (nextLoc === "center") delete seg.location;
  else seg.location = nextLoc;
  return true;
}

/** Space swaps the two faces. From the centreline, the first press picks the exterior. */
export function flipWallLocation(location) {
  const loc = normalizeWallLocation(location);
  return loc === "exterior" ? "interior" : "exterior";
}

/** Space steps through centreline -> exterior -> interior -> centreline. */
export function cycleWallLocation(location) {
  const loc = normalizeWallLocation(location);
  if (loc === "center") return "exterior";
  return loc === "exterior" ? "interior" : "center";
}

/** Mirroring reverses handedness, so the face a wall was drawn on swaps names. */
export function mirroredWallLocation(location) {
  const loc = normalizeWallLocation(location);
  if (loc === "center") return location;
  return loc === "exterior" ? "interior" : "exterior";
}

/**
 * `round` snaps the length. It is not applied to each coordinate: rounding
 * X and Y separately rotates the run off the line it was on.
 */
export function setLineLength(start, toward, length, round = (n) => n) {
  const next = Math.max(MIN_TRACE, round(Number(length) || MIN_TRACE));
  const cur = lineLength(start, toward);
  if (cur < 1e-6) return { x: start.x + next, y: start.y };
  const s = next / cur;
  return {
    x: start.x + (toward.x - start.x) * s,
    y: start.y + (toward.y - start.y) * s,
  };
}

/**
 * The angle shown beside a wall while it is being placed. It is the smaller
 * angle between the run and the horizontal, the wedge you can see, so a run
 * that climbs at 36° reads 36 either side of the horizontal. Null when the
 * run has no length, or it lies along the horizontal and there is no wedge.
 * Plan Y grows downward, the same way the screen does.
 */
export function wallDraftAngle(start, end) {
  const dx = (end?.x ?? 0) - (start?.x ?? 0);
  const dy = (end?.y ?? 0) - (start?.y ?? 0);
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  let heading = Math.atan2(dy, dx) * (180 / Math.PI);
  if (heading < 0) heading += 360;
  const degrees = heading > 180 ? 360 - heading : heading;
  if (degrees < 0.5 || degrees > 179.5) return null;
  return { degrees, heading, wallX: dx / len, wallY: dy / len, refX: 1, refY: 0 };
}

/**
 * The angle between the wall just drawn (`prev`, any non-zero direction) and
 * the one being placed. `interior` is 180 going straight on and 90 at a
 * corner. `turn` is the signed sweep from `prev` to the new wall, radians.
 * Null when either has no length.
 */
export function wallJointAngle(prev, start, end) {
  const dx = (end?.x ?? 0) - (start?.x ?? 0);
  const dy = (end?.y ?? 0) - (start?.y ?? 0);
  const len = Math.hypot(dx, dy);
  const plen = Math.hypot(prev?.x || 0, prev?.y || 0);
  if (len < 1e-9 || plen < 1e-9) return null;
  const refX = prev.x / plen;
  const refY = prev.y / plen;
  const wallX = dx / len;
  const wallY = dy / len;
  const turn = Math.atan2(refX * wallY - refY * wallX, refX * wallX + refY * wallY);
  const deflection = Math.abs(turn * 180 / Math.PI);
  return { interior: 180 - deflection, deflection, turn, wallX, wallY, refX, refY };
}

/** `round` snaps the length. The end stays on the heading, including 0°. */
export function setLineHeading(start, length, deg, round = (n) => n) {
  const rad = (Number(deg) * Math.PI) / 180;
  const len = Math.max(MIN_TRACE, round(Number(length) || MIN_TRACE));
  return {
    x: start.x + Math.cos(rad) * len,
    y: start.y + Math.sin(rad) * len,
  };
}

export function rectFromCorners(x0, y0, wx, wy, locks = {}) {
  const x = Math.min(x0, wx);
  const y = Math.min(y0, wy);
  return {
    x,
    y,
    w: locks.lockW ? locks.w : Math.abs(wx - x0),
    h: locks.lockH ? locks.h : Math.abs(wy - y0),
  };
}

export function minSizeForShape(kind) {
  if (kind === "room-new") return { w: MIN_ROOM, h: MIN_ROOM };
  return { w: MIN_TRACE, h: MIN_TRACE };
}

export function canCommitRect(rect, kind) {
  const min = minSizeForShape(kind);
  return Boolean(rect && rect.w >= min.w && rect.h >= min.h);
}

/**
 * In-progress click–click geometry, as opposed to an armed tool with no
 * first click yet. First Escape should drop this; a second Escape leaves
 * the tool. A polygon outline is the exception: the first Escape asks for
 * Finish and the second discards the whole outline (`nextPolygonEscape`).
 * Backspace removes the last corner.
 */

/** A click this close to the first corner, in metres, closes the outline. */
export const POLY_CLOSE_M = 0.3;

export function polyCanClose(points, cursor, tol = POLY_CLOSE_M) {
  if (!cursor || !points || points.length < 3) return false;
  const first = points[0];
  if (!first) return false;
  return Math.hypot(cursor.x - first.x, cursor.y - first.y) < tol;
}

/** First Escape on a polygon outline asks for Finish. The next discards it. */
export function nextPolygonEscape(nudged) {
  return nudged ? "discard" : "nudge";
}

/** A bulge smaller than this, in metres, is still a straight wall. */
export const ARC_MIN_SAGITTA = 0.02;

function chordFrame(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return null;
  return {
    chord,
    mx: (x1 + x2) / 2,
    my: (y1 + y2) / 2,
    nx: dy / chord,
    ny: -dx / chord,
  };
}

/**
 * Arc through a fixed chord. `side` +1 puts the centre on the left of
 * start→end (the same left a face uses). A minor arc bows the other way.
 * `major` takes the long way round, so the bow and the centre are on the
 * same side and the sweep is more than 180°. A radius shorter than half the
 * chord cannot reach both ends.
 */
export function arcFromRadius(x1, y1, x2, y2, radius, side, major = false) {
  const frame = chordFrame(x1, y1, x2, y2);
  if (!frame || !(radius > 0) || (side !== 1 && side !== -1)) return null;
  if (radius < frame.chord / 2 - 1e-6) return null;
  const r = Math.max(radius, frame.chord / 2);
  const h = Math.sqrt(Math.max(0, r * r - (frame.chord / 2) ** 2));
  const sign = side > 0 ? 1 : -1;
  const long = major === true && h >= 1e-8;
  const cx = frame.mx + sign * h * frame.nx;
  const cy = frame.my + sign * h * frame.ny;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  let sweep;
  if (h < 1e-8) {
    const bulge = Math.atan2(-sign * frame.ny, -sign * frame.nx);
    let toBulge = bulge - a0;
    while (toBulge <= -Math.PI) toBulge += Math.PI * 2;
    while (toBulge > Math.PI) toBulge -= Math.PI * 2;
    sweep = toBulge >= 0 ? Math.PI : -Math.PI;
  } else {
    const a1 = Math.atan2(y2 - cy, x2 - cx);
    sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    if (long) sweep += sweep > 0 ? -Math.PI * 2 : Math.PI * 2;
  }
  const mid = a0 + sweep / 2;
  return {
    cx,
    cy,
    radius: r,
    a0,
    sweep,
    sweepDeg: Math.abs(sweep) * (180 / Math.PI),
    length: r * Math.abs(sweep),
    sagitta: long ? r + h : r - h,
    side: sign,
    major: long,
    crownX: cx + Math.cos(mid) * r,
    crownY: cy + Math.sin(mid) * r,
  };
}

/** Signed distance of a point from the chord, along the chord's left normal. */
export function chordOffset(x1, y1, x2, y2, px, py) {
  const frame = chordFrame(x1, y1, x2, y2);
  if (!frame) return null;
  return (px - frame.mx) * frame.nx + (py - frame.my) * frame.ny;
}

/**
 * Circle through the two ends and the cursor. The centre lies on the
 * perpendicular bisector. Past a semicircle the cursor is on the long arc,
 * and moving it further out makes the radius larger. A pull smaller than
 * `minSagitta` stays a straight wall.
 */
export function arcThroughPoint(x1, y1, x2, y2, px, py, minSagitta = ARC_MIN_SAGITTA) {
  const frame = chordFrame(x1, y1, x2, y2);
  if (!frame) return null;
  const off = (px - frame.mx) * frame.nx + (py - frame.my) * frame.ny;
  if (Math.abs(off) < minSagitta) return null;
  const along = (px - frame.mx) * (-frame.ny) + (py - frame.my) * frame.nx;
  const half = frame.chord / 2;
  const h = (off * off + along * along - half * half) / (2 * off);
  const radius = Math.hypot(h, half);
  const side = Math.abs(h) < 1e-8 ? (off > 0 ? -1 : 1) : (h > 0 ? 1 : -1);
  return arcFromRadius(x1, y1, x2, y2, radius, side, h * off > 1e-9);
}

export function arcFromCursor(x1, y1, x2, y2, px, py, minSagitta = ARC_MIN_SAGITTA) {
  return arcThroughPoint(x1, y1, x2, y2, px, py, minSagitta);
}

/**
 * Bulge `sagitta` off the chord. `side` is the centre side of the short arc
 * (opposite the bulge). Past a semicircle the centre stays with the bulge and
 * the sweep takes the long way, so pulling further out keeps the radius growing
 * instead of folding the curve back onto the short arc.
 */
export function arcBySagitta(x1, y1, x2, y2, sagitta, side) {
  const frame = chordFrame(x1, y1, x2, y2);
  const s = Math.abs(sagitta);
  if (!frame || !(s > 0) || (side !== 1 && side !== -1)) return null;
  const radius = (frame.chord * frame.chord / 4 + s * s) / (2 * s);
  const major = s > frame.chord / 2 + 1e-9;
  const centerSide = major ? (side === 1 ? -1 : 1) : side;
  return arcFromRadius(x1, y1, x2, y2, radius, centerSide, major);
}

/** Included angle back to the radius that subtends this chord. Null outside (0, 180]. */
export function radiusFromSweep(chord, sweepDeg) {
  const theta = Math.abs(Number(sweepDeg)) * (Math.PI / 180);
  if (!(chord > 0) || !(theta > 0.01) || theta > Math.PI + 1e-6) return null;
  return (chord / 2) / Math.sin(Math.min(theta, Math.PI) / 2);
}

/** Drop an arc that cannot span the chord. Returns the stored `{ radius, side }`. */
export function normalizeWallArc(raw, x1, y1, x2, y2) {
  const radius = Number(raw?.radius);
  const side = raw?.side > 0 ? 1 : raw?.side < 0 ? -1 : null;
  if (!Number.isFinite(radius) || side == null) return null;
  const arc = arcFromRadius(x1, y1, x2, y2, radius, side, raw.major === true);
  if (!arc) return null;
  return arc.major
    ? { radius: arc.radius, side: arc.side, major: true }
    : { radius: arc.radius, side: arc.side };
}

/** Keep a stored arc that still reaches both ends; otherwise remove it. */
export function fitWallArc(seg) {
  if (!seg?.arc) return;
  const arc = normalizeWallArc(seg.arc, seg.x1, seg.y1, seg.x2, seg.y2);
  if (!arc) delete seg.arc;
  else seg.arc = arc;
}

/**
 * After an end moves, keep the arc's included angle and let the radius scale
 * with the new chord, so the curve neither deepens into a hook nor runs out
 * of radius and goes straight. `old` is the chord before the move.
 */
export function keepArcSweep(seg, old) {
  if (!seg?.arc || !old) return;
  const before = arcFromRadius(old.x1, old.y1, old.x2, old.y2, seg.arc.radius, seg.arc.side, seg.arc.major === true);
  const chord = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const half = before ? Math.sin(Math.abs(before.sweep) / 2) : 0;
  if (!before || chord < 1e-9 || half < 1e-9) {
    fitWallArc(seg);
    return;
  }
  const radius = (chord / 2) / half;
  seg.arc = before.major
    ? { radius, side: before.side, major: true }
    : { radius, side: before.side };
  fitWallArc(seg);
}

/** Points along the centreline, including both ends. */
export function arcPoints(x1, y1, x2, y2, radius, side, step = Math.PI / 18, major = false) {
  const arc = arcFromRadius(x1, y1, x2, y2, radius, side, major);
  if (!arc) return null;
  const n = Math.max(2, Math.ceil(Math.abs(arc.sweep) / step));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = arc.a0 + arc.sweep * (i / n);
    pts.push([arc.cx + Math.cos(a) * arc.radius, arc.cy + Math.sin(a) * arc.radius]);
  }
  return pts;
}

/** Distance from a point to the arc centreline, or to the nearer end past the sweep. */
export function distToArc(arc, px, py) {
  if (!arc) return Infinity;
  const ang = Math.atan2(py - arc.cy, px - arc.cx);
  let d = ang - arc.a0;
  let on = false;
  if (arc.sweep >= 0) {
    while (d < 0) d += Math.PI * 2;
    while (d >= Math.PI * 2) d -= Math.PI * 2;
    on = d <= arc.sweep + 1e-6;
  } else {
    while (d > 0) d -= Math.PI * 2;
    while (d <= -Math.PI * 2) d += Math.PI * 2;
    on = d >= arc.sweep - 1e-6;
  }
  if (on) return Math.abs(Math.hypot(px - arc.cx, py - arc.cy) - arc.radius);
  const sx = arc.cx + Math.cos(arc.a0) * arc.radius;
  const sy = arc.cy + Math.sin(arc.a0) * arc.radius;
  const ex = arc.cx + Math.cos(arc.a0 + arc.sweep) * arc.radius;
  const ey = arc.cy + Math.sin(arc.a0 + arc.sweep) * arc.radius;
  return Math.min(Math.hypot(px - sx, py - sy), Math.hypot(px - ex, py - ey));
}

/** Annular footprint of a wall following the arc. Outer edge first, then the inner edge back. */
export function arcWallPolygon(arc, thickness, step = Math.PI / 24) {
  if (!arc || !(thickness > 0)) return null;
  const outer = arc.radius + thickness / 2;
  const inner = Math.max(arc.radius - thickness / 2, 0.002);
  const n = Math.max(8, Math.ceil(Math.abs(arc.sweep) / step));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = arc.a0 + arc.sweep * (i / n);
    pts.push({ x: arc.cx + Math.cos(a) * outer, y: arc.cy + Math.sin(a) * outer });
  }
  for (let i = n; i >= 0; i -= 1) {
    const a = arc.a0 + arc.sweep * (i / n);
    pts.push({ x: arc.cx + Math.cos(a) * inner, y: arc.cy + Math.sin(a) * inner });
  }
  return pts;
}

export function hasClickDraft(state) {
  return Boolean(
    state.wallDraft
    || state.shapeDraft
    || state.beamStart
    || state.lineStart
    || state.siteDraft?.length
    || state.roomDraft?.length
    || state.boundaryDraft?.length
    || state.roofCutDraft?.points?.length
    || state.regionDraft?.length
    || state.cameraDraft?.a
    || state.sectionDraft?.a
    || state.calloutDraft?.a
    || state.revisionCloudDraft?.a
    || state.measureDraft?.a
    || state.serviceRoute?.fromNodeId
    || state.serviceConnect?.nodeId
    || (state.calibration?.a && !state.calibration?.b)
    || state.joineryDraft
  );
}
