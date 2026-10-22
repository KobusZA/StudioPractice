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

/** Space swaps the two faces. From the centreline, the first press picks the exterior. */
export function flipWallLocation(location) {
  const loc = normalizeWallLocation(location);
  return loc === "exterior" ? "interior" : "exterior";
}

/** Mirroring reverses handedness, so the face a wall was drawn on swaps names. */
export function mirroredWallLocation(location) {
  const loc = normalizeWallLocation(location);
  if (loc === "center") return location;
  return loc === "exterior" ? "interior" : "exterior";
}

export function setLineLength(start, toward, length, round = (n) => n) {
  const next = Math.max(MIN_TRACE, Number(length) || MIN_TRACE);
  const cur = lineLength(start, toward);
  if (cur < 1e-6) {
    return { x: round(start.x + next), y: start.y };
  }
  const s = next / cur;
  return {
    x: round(start.x + (toward.x - start.x) * s),
    y: round(start.y + (toward.y - start.y) * s),
  };
}

export function setLineHeading(start, length, deg, round = (n) => n) {
  const rad = (Number(deg) * Math.PI) / 180;
  const len = length || MIN_TRACE;
  return {
    x: round(start.x + Math.cos(rad) * len),
    y: round(start.y + Math.sin(rad) * len),
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
 * the tool.
 */
export function hasClickDraft(state) {
  return Boolean(
    state.wallDraft
    || state.shapeDraft
    || state.beamStart
    || state.lineStart
    || state.siteDraft?.length
    || state.cameraDraft?.a
    || state.sectionDraft?.a
    || state.calloutDraft?.a
    || state.revisionCloudDraft?.a
    || state.measureDraft?.a
    || state.serviceRoute?.fromNodeId
    || state.serviceConnect?.nodeId
    || (state.calibration?.a && !state.calibration?.b)
  );
}
