// How a service run sits against the walls of its storey: alongside one, clear
// of it by so many millimetres, or inside it.
//
// Revit answers this with a justification and offset on the tool, editable
// temporary dimensions, and a clash warning for anything left in a wall. The
// same three things live here as pure functions over plain wall rows
// ({ id, x1, y1, x2, y2, thickness }, as walls.js derives them), so the plan,
// the inspector and the tests all read one answer.
//
// Clearance is measured from the pipe's outer edge to the wall face, because
// that is the gap a plumber has to fit. The edge is the pipe's stated diameter
// (plus any stated insulation thickness) - and where the type states no
// diameter the run is measured as a line and says so (`radius: null`), rather
// than guessing a size ("unknown is null").
//
// Nothing here is stored except an edge's `chase` flag (service-model.js): a run
// the user has said sits in a chase or cavity, which is what turns "pipe inside
// a wall" from an obstruction into a decision.

import { edgeMeasure, nodeMap } from "./services.js";
import { riserColumn } from "./service-model.js";

/** A run counts as alongside a wall when it is within this of parallel (cosine). */
export const ALONG_COS = 0.8;
/** A run has to overlap a wall for at least this, metres, to be more than a crossing. */
export const INSIDE_MIN_LEN = 0.3;
/** Walls further than this from a run's pipe edge are not "alongside" it. */
export const ALONGSIDE_REACH = 1.5;
/** Plan sampling step along a run, metres. */
const STEP = 0.05;
const EPS = 1e-9;

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** Outer radius, metres, of the pipe a run is typed as; null when no size is stated. */
export function pipeRadius(pack, edge) {
  const sku = (pack?.skus || []).find((s) => s.id === edge?.sku);
  const d = sku?.geometry?.diameter;
  if (!isNum(d) || d <= 0) return null;
  const ins = sku.geometry.insulation;
  return d / 2 + (isNum(ins) && ins > 0 ? ins : 0);
}

function closestOnWall(wall, px, py) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  const tRaw = len2 < EPS ? 0 : ((px - wall.x1) * dx + (py - wall.y1) * dy) / len2;
  const t = Math.min(1, Math.max(0, tRaw));
  const cx = wall.x1 + dx * t;
  const cy = wall.y1 + dy * t;
  return { x: cx, y: cy, t, tRaw, d: Math.hypot(px - cx, py - cy) };
}

/**
 * The wall a run sits alongside, and how:
 *   clearance  pipe edge to the nearest wall face, metres (negative: overlapping)
 *   centre     pipe centreline to that face
 *   state      "clear", "inside" (the whole pipe within the wall) or "partial"
 * Null when no wall runs roughly parallel within reach, or the run is a point.
 * `radius` null measures the run as a line.
 */
export function runWallRelation(walls, a, b, radius = null) {
  const r = isNum(radius) && radius > 0 ? radius : 0;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < EPS) return null;
  const rx = (b.x - a.x) / length;
  const ry = (b.y - a.y) / length;
  const n = Math.max(2, Math.ceil(length / STEP));
  let best = null;
  for (const wall of walls || []) {
    const wl = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    if (wl < EPS || !isNum(wall.thickness) || wall.thickness <= 0) continue;
    const along = Math.abs(((wall.x2 - wall.x1) / wl) * rx + ((wall.y2 - wall.y1) / wl) * ry) >= ALONG_COS;
    if (!along) continue;
    const half = wall.thickness / 2;
    let minD = Infinity;
    let at = null;
    let overlap = 0;
    let full = 0;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const c = closestOnWall(wall, px, py);
      if (c.d < minD) {
        minD = c.d;
        at = { px, py, cx: c.x, cy: c.y };
      }
      if (c.d - half - r < -1e-9) overlap += 1;
      if (c.d + r <= half + 1e-9) full += 1;
    }
    const clearance = minD - half - r;
    if (clearance > ALONGSIDE_REACH) continue;
    if (!best || minD < best.minD) {
      const overlapLen = (overlap / (n + 1)) * length;
      let state = "clear";
      if (overlapLen >= INSIDE_MIN_LEN) state = full === overlap ? "inside" : "partial";
      best = {
        wallId: wall.id,
        wall,
        minD,
        clearance,
        centre: minD - half,
        overlapLen,
        state,
        radius: isNum(radius) && radius > 0 ? radius : null,
        at,
      };
    }
  }
  if (best) delete best.minD;
  return best;
}

/**
 * Per-run findings for one storey: the wall alongside, the clearance and
 * whether the run is an obstruction, an accepted chase, or a chase that does not
 * hold. `level` is "obstruction" | "chase" | "warn" | null.
 * Only plan runs wholly on `levelId` are judged; a riser has no plan run.
 */
export function serviceWallFlags(doc, pack, walls, levelId) {
  const out = new Map();
  if (!walls?.length) return out;
  const nodes = nodeMap(doc);
  for (const edge of doc.serviceEdges || []) {
    const m = edgeMeasure(doc, pack, edge, nodes);
    if (!m || m.vertical) continue;
    if (m.levelFrom !== levelId || m.levelTo !== levelId) continue;
    const rel = runWallRelation(walls, m.from, m.to, pipeRadius(pack, edge));
    if (!rel) continue;
    const chase = edge.chase === true;
    let level = null;
    let message = "";
    if (rel.state === "clear") {
      if (chase) {
        level = "warn";
        message = "Marked as a chase, but the run is not in a wall.";
      }
    } else if (rel.state === "inside") {
      level = chase ? "chase" : "obstruction";
      message = chase
        ? "In a chase: the run is flagged as in the wall."
        : "Inside a wall with no chase: an obstruction. Mark it as a chase if that is intended.";
    } else {
      level = chase ? "warn" : "obstruction";
      message = chase
        ? "Marked as a chase, but only part of the pipe is in the wall. A chase must hold the whole pipe."
        : "Cuts across a wall face: an obstruction.";
    }
    out.set(edge.id, { ...rel, edgeId: edge.id, chase, level, message });
  }
  return out;
}

/** "150 mm" style clearance text for a relation, or "" when there is no wall alongside. */
export function clearanceText(rel) {
  if (!rel) return "";
  if (rel.state !== "clear") return rel.state === "inside" ? "in wall" : "cuts wall";
  const mm = Math.round(rel.clearance * 1000);
  return `${mm} mm to wall${rel.radius === null ? " (centreline)" : ""}`;
}

/**
 * Slide a run, both ends rigidly, so its pipe edge sits `mm` from the wall face
 * it is alongside, on the side it is already on. Riser columns at either end go
 * with it so a riser is never left standing in two places. Returns
 * { ok, message } like the other document edits.
 */
export function setRunClearance(doc, pack, walls, edgeId, mm, levelId) {
  const fail = (message) => ({ ok: false, message });
  if (!isNum(mm) || mm < 0) return fail("Clearance must be a number of millimetres, zero or more.");
  const edge = (doc.serviceEdges || []).find((e) => e.id === edgeId);
  const nodes = nodeMap(doc);
  const m = edge && edgeMeasure(doc, pack, edge, nodes);
  if (!m || m.vertical) return fail("Select a run on the plan first.");
  if (m.levelFrom !== levelId || m.levelTo !== levelId) return fail("That run is not on this storey.");
  const rel = runWallRelation(walls, m.from, m.to, pipeRadius(pack, edge));
  if (!rel) return fail("No wall alongside this run.");
  const dx = rel.at.px - rel.at.cx;
  const dy = rel.at.py - rel.at.cy;
  const d = Math.hypot(dx, dy);
  // A run sitting exactly on the wall's centreline has no side to move to.
  if (d < 1e-6) return fail("The run is on the wall's centreline: move it to one side first.");
  const half = rel.wall.thickness / 2;
  const r = rel.radius ?? 0;
  const target = half + r + mm / 1000;
  const shift = target - d;
  const sx = (dx / d) * shift;
  const sy = (dy / d) * shift;
  const ids = new Set();
  for (const id of [edge.fromNode, edge.toNode]) for (const member of riserColumn(doc, id)) ids.add(member);
  for (const id of ids) {
    const node = nodes.get(id);
    if (!node) continue;
    node.x += sx;
    node.y += sy;
  }
  return {
    ok: true,
    message: `Run moved to ${Math.round(mm)} mm from the wall${rel.radius === null ? " (centreline: no pipe size stated)" : ""}.`,
  };
}

/**
 * Where a route point should land to keep a justification to the nearest wall.
 *   mode "clear":  the pipe edge `offset` metres from the face, on the pointer's side
 *   mode "centre": on the wall's centreline, for a run in a chase
 * Only applies along a wall (not past its end) and when the pointer is within
 * about a third of a metre of that position, so a point far from any wall is left
 * alone. Null when nothing applies.
 */
export function justifyPoint(walls, x, y, { mode, offset = 0, radius = 0 } = {}) {
  if (mode !== "clear" && mode !== "centre") return null;
  const r = isNum(radius) && radius > 0 ? radius : 0;
  let best = null;
  for (const wall of walls || []) {
    if (!isNum(wall.thickness) || wall.thickness <= 0) continue;
    const c = closestOnWall(wall, x, y);
    if (c.tRaw <= 0 || c.tRaw >= 1) continue;
    if (!best || c.d < best.c.d) best = { wall, c };
  }
  if (!best) return null;
  const { wall, c } = best;
  const half = wall.thickness / 2;
  if (mode === "centre") {
    return c.d <= half + 0.35 ? { x: c.x, y: c.y, wallId: wall.id } : null;
  }
  const target = half + r + Math.max(0, offset);
  if (c.d > target + 0.35) return null;
  // The side comes from the pointer; dead on the centreline there is none.
  let nx = x - c.x;
  let ny = y - c.y;
  let nl = Math.hypot(nx, ny);
  if (nl < 1e-6) {
    const wl = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    nx = -(wall.y2 - wall.y1) / wl;
    ny = (wall.x2 - wall.x1) / wl;
    nl = 1;
  }
  return { x: c.x + (nx / nl) * target, y: c.y + (ny / nl) * target, wallId: wall.id };
}
