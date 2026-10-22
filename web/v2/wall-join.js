// Corner joins for a wall being drawn against one already on the plan.
//
// Walls render as bands that stop square at their ends, so where two meet
// someone has to own the corner square. Left alone, a wall started on the
// other's centreline leaves a notch on the outside and double-counts half the
// overlap in the take-off. The choice is the user's, and decides the lengths
// the bill of quantities reads:
//
//   "past"    the new wall runs past the old wall's end to its far face; the
//             old wall stops at the new wall's near face.
//   "against" the new wall stops at the old wall's near face; the old wall
//             runs on to the new wall's far face.
//   "center"  nothing moves: the walls meet on the line that was drawn.
//
// Where the new wall meets the side of a wall rather than an end (a tee), the
// old wall carries on, so both "past" and "against" stop the new wall at
// that face.
//
// No DOM, no pack: thicknesses come in as numbers so this can be tested alone.

export const CORNER_MODES = ["past", "against", "center"];

const TOL = 0.01;
// Below roughly 12 degrees between the walls there is no corner to make.
const MIN_SIN = 0.2;

function unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? null : { x: dx / len, y: dy / len };
}

const perp = (v) => ({ x: -v.y, y: v.x });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;

function intersect(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const a = cross({ x: q.x - p.x, y: q.y - p.y }, e) / den;
  return { x: p.x + d.x * a, y: p.y + d.y * a };
}

function shift(p, n, by) {
  return { x: p.x + n.x * by, y: p.y + n.y * by };
}

/**
 * The drawn wall whose footprint `point` sits in, and whether that is at one
 * of its ends (`end` 1 or 2) or along its side (`end` null). `reach` is how
 * far back from an end still counts as the end - the new wall's thickness is
 * a good value, since a corner is never wider than that.
 */
export function findJoinTarget(segments, point, thicknessOf, { reach = 0, exclude = null } = {}) {
  let best = null;
  for (const seg of segments || []) {
    if (exclude && exclude(seg)) continue;
    const t = thicknessOf(seg);
    if (!(t > 0)) continue;
    const u = unit(seg.x2 - seg.x1, seg.y2 - seg.y1);
    if (!u) continue;
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const rel = { x: point.x - seg.x1, y: point.y - seg.y1 };
    const along = dot(rel, u);
    const across = Math.abs(dot(rel, perp(u)));
    if (across > t / 2 + TOL || along < -TOL || along > len + TOL) continue;
    const zone = Math.max(t, reach) + TOL;
    let end = null;
    if (len - along <= zone && len - along <= along) end = 2;
    else if (along <= zone) end = 1;
    if (!best || across < best.across) best = { seg, end, thickness: t, across };
  }
  return best ? { seg: best.seg, end: best.end, thickness: best.thickness } : null;
}

/**
 * Which face to draw on so the new wall sits against the wall it starts on.
 *
 * "Exterior" is the side on your left as you draw (see click-draw.js), so on
 * its own the same click puts the wall on opposite sides of the line depending
 * on which way you drag. Starting on another wall's end, what the user expects
 * is the wall beside the old one, whichever way it runs: the side toward the
 * old wall's body. Null when there is nothing to go by (no end contact, no
 * direction yet, or the new wall runs along the old one), so the caller keeps
 * the setting the user chose.
 */
export function sideTowardTarget({ start, end, target }) {
  if (!target || target.end == null) return null;
  const d = unit(end.x - start.x, end.y - start.y);
  const along = unit(target.seg.x2 - target.seg.x1, target.seg.y2 - target.seg.y1);
  if (!d || !along) return null;
  const inward = target.end === 2 ? { x: -along.x, y: -along.y } : along;
  const s = dot(perp(d), inward);
  if (Math.abs(s) < MIN_SIN) return null;
  return s > 0 ? "exterior" : "interior";
}

/**
 * Where the new wall's centreline should end at a joint, and where the old
 * wall's joined end moves to. `line` is the new wall's centreline, `at` which
 * of its ends is at the joint. Returns null when nothing should move.
 */
export function resolveJoin({ line, thickness, at = "start", target, mode = "past" }) {
  if (!target || mode === "center" || !(thickness > 0)) return null;
  const P = at === "start" ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };
  const d = at === "start" ? unit(line.x2 - line.x1, line.y2 - line.y1) : unit(line.x1 - line.x2, line.y1 - line.y2);
  const seg = target.seg;
  const tW = target.thickness;
  const along = unit(seg.x2 - seg.x1, seg.y2 - seg.y1);
  if (!d || !along || !(tW > 0)) return null;
  const nW = perp(along);
  const side = dot(d, nW);
  if (Math.abs(side) < MIN_SIN) return null;
  // The old wall's face on the new wall's side, and the one behind it.
  const nearFace = shift({ x: seg.x1, y: seg.y1 }, nW, Math.sign(side) * (tW / 2));
  const farFace = shift({ x: seg.x1, y: seg.y1 }, nW, -Math.sign(side) * (tW / 2));

  if (target.end == null || mode === "against") {
    const point = intersect(P, d, nearFace, along);
    if (!point) return null;
    if (target.end == null) return { point, targetEnd: null };
    // The old wall runs on to the new wall's far face.
    const E = target.end === 2 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
    const u = target.end === 2 ? along : { x: -along.x, y: -along.y };
    const nN = perp(d);
    const far = shift(P, nN, Math.sign(dot(u, nN)) * (thickness / 2));
    return { point, targetEnd: intersect(E, u, far, d) };
  }

  // "past": the new wall runs to the old wall's far face, and the old wall
  // stops at the new wall's near face.
  const point = intersect(P, d, farFace, along);
  const E = target.end === 2 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
  const u = target.end === 2 ? along : { x: -along.x, y: -along.y };
  const nN = perp(d);
  const near = shift(P, nN, -Math.sign(dot(u, nN)) * (thickness / 2));
  return point ? { point, targetEnd: intersect(E, u, near, d) } : null;
}
