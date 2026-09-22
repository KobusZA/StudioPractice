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

/** After a committed wall, the next segment starts at that endpoint. */
export function chainStart(end) {
  return { x1: end.x, y1: end.y, x2: end.x, y2: end.y };
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
    || state.siteDraft?.length
    || state.cameraDraft?.a
    || state.sectionDraft?.a
    || state.measureDraft?.a
    || (state.calibration?.a && !state.calibration?.b)
  );
}
