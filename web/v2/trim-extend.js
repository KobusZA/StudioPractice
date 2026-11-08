// Trim/Extend to Corner.
//
// Two walls, each clicked on the side to keep. Both near ends move to where
// the centrelines cross: a wall that overshoots is cut back, a wall that falls
// short is stretched, and the two are the same rule. The ends land on the
// centreline crossing. The corner square is then the one joinWallCorners
// already welds, rather than a fresh past/against choice.
//
// Trim single is the other Revit mode: the first wall is a boundary that does
// not move, and only the second wall is cut or stretched to its centreline.
//
// Walls and foundations only. No DOM.

import { MIN_TRACE } from "./click-draw.js";
import { objectByRef } from "./model.js";
import { moveWallEnd } from "./modify.js";

const TRIM_CATEGORIES = new Set(["wall", "boundarywall", "fence", "foundation"]);
// A meeting further out than this is a graze, not a corner someone meant.
const MEET_LIMIT = 80;
// A click this close to the crossing, along the wall, does not say which half.
const PICK_FLOOR = 0.05;

function fail(message) {
  return { ok: false, message };
}

function done(message, refs) {
  return { ok: true, message, refs };
}

function signed(seg, x, y) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  return ((x - seg.x1) * dx + (y - seg.y1) * dy) / len;
}

function lineCross(a, b) {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b.x1 - a.x1) * by - (b.y1 - a.y1) * bx) / den;
  return { x: a.x1 + t * ax, y: a.y1 + t * ay };
}

/** Walls, boundary walls and foundations. A segment with no type still trims. */
export function wallCanTrim(sku) {
  if (!sku) return true;
  return TRIM_CATEGORIES.has(sku.category);
}

function endPoint(seg, end) {
  return end === 1 ? { x: seg.x1, y: seg.y1 } : { x: seg.x2, y: seg.y2 };
}

function crossReachable(seg, cross) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const s = signed(seg, cross.x, cross.y);
  if (s >= -0.05 && s <= len + 0.05) return true;
  const gap = s < 0 ? -s : s - len;
  return gap <= MEET_LIMIT;
}

/**
 * The end on the far side of the crossing from the click. When the crossing
 * is outside the wall, both ends are on the click's side and the nearer one
 * travels, which is the extend.
 */
function travellingEnd(seg, pick, cross) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  if (len < 1e-9) return { reason: "empty" };
  const sp = signed(seg, pick.x, pick.y);
  const sc = signed(seg, cross.x, cross.y);
  if (Math.abs(sp - sc) < PICK_FLOOR) return { reason: "ambiguous" };
  const side = Math.sign(sp - sc);
  const opposite = (s) => Math.sign(s - sc) === -side;
  let end;
  if (opposite(0) && !opposite(len)) end = 1;
  else if (opposite(len) && !opposite(0)) end = 2;
  else end = Math.abs(sc) <= Math.abs(len - sc) ? 1 : 2;
  const keep = end === 1 ? 2 : 1;
  const keepS = keep === 1 ? 0 : len;
  if (Math.abs(keepS - sc) < MIN_TRACE) return { reason: "too-short" };
  return {
    end,
    point: { x: cross.x, y: cross.y },
    from: endPoint(seg, end),
    keep: endPoint(seg, keep),
  };
}

/**
 * Where two walls meet if each keeps the side that was clicked. Does not
 * change the document. The walls are stored centrelines.
 */
export function planTrimCorner(wallA, wallB, pickA, pickB) {
  if (!wallA || !wallB || !pickA || !pickB) return fail("Click each wall on the part you want to keep.");
  if (wallA.id != null && wallA.id === wallB.id) return fail("Click a different wall for the second side.");
  const cross = lineCross(wallA, wallB);
  if (!cross) return fail("These two walls run parallel, so there is no corner to make.");
  if (!crossReachable(wallA, cross) || !crossReachable(wallB, cross)) {
    return fail("These walls meet too far away to trim.");
  }
  const a = travellingEnd(wallA, pickA, cross);
  const b = travellingEnd(wallB, pickB, cross);
  if (a.reason === "ambiguous" || b.reason === "ambiguous") {
    return fail("Click further along the wall, on the part you want to keep.");
  }
  if (a.reason || b.reason) return fail("That would leave the wall too short.");
  return {
    ok: true,
    cross,
    moves: [
      { id: wallA.id, ...a },
      { id: wallB.id, ...b },
    ],
  };
}

/**
 * Trim/Extend Single Element: the boundary wall stays as it is, and only the
 * wall clicked second moves, to where it meets the boundary's centreline. The
 * boundary's line is read as running on past its ends, so a boundary shorter
 * than the meeting point still counts. Does not change the document.
 */
export function planTrimSingle(boundary, target, pickTarget) {
  if (!boundary || !target || !pickTarget) return fail("Click the wall that stays, then the wall to trim.");
  if (boundary.id != null && boundary.id === target.id) return fail("Pick a different wall to trim.");
  const cross = lineCross(boundary, target);
  if (!cross) return fail("These two walls run parallel, so there is no corner to make.");
  if (!crossReachable(boundary, cross) || !crossReachable(target, cross)) {
    return fail("These walls meet too far away to trim.");
  }
  const moved = travellingEnd(target, pickTarget, cross);
  if (moved.reason === "ambiguous") return fail("Click further along the wall, on the part you want to keep.");
  if (moved.reason) return fail("That would leave the wall too short.");
  return {
    ok: true,
    cross,
    moves: [{ id: target.id, ...moved }],
  };
}

function snapshot(doc, ids) {
  return {
    segments: (doc.segments || []).filter((seg) => ids.has(seg.id)).map((seg) => ({
      id: seg.id, x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, length: seg.length,
    })),
    openings: (doc.openings || []).filter((opening) => ids.has(opening.wallId)).map((opening) => ({
      id: opening.id, t: opening.t,
    })),
    finishRuns: structuredClone((doc.finishRuns || []).filter((run) => ids.has(run.wallId))),
  };
}

function restore(doc, snap) {
  for (const saved of snap.segments) {
    const seg = (doc.segments || []).find((item) => item.id === saved.id);
    if (!seg) continue;
    seg.x1 = saved.x1;
    seg.y1 = saved.y1;
    seg.x2 = saved.x2;
    seg.y2 = saved.y2;
    if (Number.isFinite(saved.length)) seg.length = saved.length;
  }
  for (const saved of snap.openings) {
    const opening = (doc.openings || []).find((item) => item.id === saved.id);
    if (opening) opening.t = saved.t;
  }
  if (doc.finishRuns || snap.finishRuns.length) {
    const wallIds = new Set(snap.segments.map((seg) => seg.id));
    doc.finishRuns = [
      ...(doc.finishRuns || []).filter((run) => !wallIds.has(run.wallId)),
      ...structuredClone(snap.finishRuns),
    ];
  }
}

/**
 * Move both walls onto the corner. One undo step for the caller: if the
 * second wall cannot move, the first is put back and nothing is written.
 * `picks` is `[{ ref, pick }, { ref, pick }]`, and each pick is the point
 * clicked on the part to keep.
 */
export function trimToCorner(doc, picks, { skuById = () => null } = {}) {
  return runTrim(doc, picks, { skuById, mode: "corner" });
}

/**
 * Trim or extend the second wall to the first, which does not move. `picks`
 * is `[{ ref }, { ref, pick }]`: the boundary needs no point, the wall to
 * trim needs the point clicked on the part to keep.
 */
export function trimToBoundary(doc, picks, { skuById = () => null } = {}) {
  return runTrim(doc, picks, { skuById, mode: "single" });
}

function runTrim(doc, picks, { skuById, mode }) {
  const single = mode === "single";
  const missing = single
    ? "Click the wall that stays, then the wall to trim."
    : "Click each wall on the part you want to keep.";
  if (!Array.isArray(picks) || picks.length !== 2 || !picks[0]?.ref || !picks[1]?.ref) return fail(missing);
  const [first, second] = picks;
  const worksOn = single
    ? "Trim single works on walls and foundations."
    : "Trim to corner works on walls and foundations.";
  if (first.ref.kind !== "segment" || second.ref.kind !== "segment") return fail(worksOn);
  if (first.ref.id === second.ref.id) {
    return fail(single ? "Pick a different wall to trim." : "Click a different wall for the second side.");
  }
  const wallA = objectByRef(doc, first.ref);
  const wallB = objectByRef(doc, second.ref);
  if (!wallA || !wallB) return fail("That wall is no longer on the plan.");
  if (!wallCanTrim(skuById(wallA.sku)) || !wallCanTrim(skuById(wallB.sku))) return fail(worksOn);
  if ((wallA.level ?? null) !== (wallB.level ?? null)) return fail("These walls are on different floors.");

  const plan = single
    ? planTrimSingle(wallA, wallB, second.pick)
    : planTrimCorner(wallA, wallB, first.pick, second.pick);
  if (!plan.ok) return plan;

  const snap = snapshot(doc, new Set(single ? [wallB.id] : [wallA.id, wallB.id]));
  for (const move of plan.moves) {
    const seg = (doc.segments || []).find((item) => item.id === move.id);
    const at = endPoint(seg, move.end);
    if (Math.hypot(at.x - move.point.x, at.y - move.point.y) < 1e-9) continue;
    const result = moveWallEnd(doc, { kind: "segment", id: move.id }, move.end, move.point, {
      skuById,
      space: "centre",
    });
    if (!result.ok) {
      restore(doc, snap);
      return result;
    }
  }
  if (single) return done("Wall trimmed to boundary.", [{ kind: "segment", id: wallB.id }]);
  return done("Corner made.", [
    { kind: "segment", id: wallA.id },
    { kind: "segment", id: wallB.id },
  ]);
}
