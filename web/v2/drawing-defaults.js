// Session defaults for drawing tools. Nothing here is written to the job.
// A reload drops the lot; that is the storage the review asked not to add.

import { normalizeWallLocation } from "./click-draw.js";
import { CORNER_JOIN_TOL, wallCornerNeighbors } from "./walls.js";

/**
 * The SKU a ribbon function should arm. A type the user already picked for
 * this function wins. Otherwise keep the current SKU when it still belongs
 * to the function. The pack's first match is only the starting point.
 */
export function skuForArmedFunction(skus, { categories = [], functionId, memory = {}, currentId } = {}) {
  const cats = categories || [];
  const fits = (id) => Boolean(id) && (skus || []).some((sku) => sku.id === id && cats.includes(sku.category));
  if (functionId && fits(memory[functionId])) return memory[functionId];
  if (fits(currentId)) return currentId;
  return (skus || []).find((sku) => cats.includes(sku.category))?.id ?? null;
}

/** Remember a deliberate pick. An empty function id leaves the memory as it was. */
export function rememberFunctionSku(memory, functionId, skuId) {
  const next = { ...(memory || {}) };
  if (!functionId || !skuId) return next;
  next[functionId] = skuId;
  return next;
}

/**
 * Re-arming a tool keeps the location line. Changing thickness is a SKU
 * change and does not appear here, so it cannot clear the line either.
 */
export function armPlacement(state, item, skus) {
  return {
    placeSkuId: skuForArmedFunction(skus, {
      categories: item?.categories || [],
      functionId: item?.id,
      memory: state?.memory || {},
      currentId: state?.placeSkuId,
    }),
    wallLocation: normalizeWallLocation(state?.wallLocation),
    memory: state?.memory || {},
  };
}

/**
 * The top a wall is placed with, from the Top setting on the options bar.
 * `choice` is `{ mode: "level-above" | "fixed", height }` with the height in
 * metres, or null to keep the type's own default (`defaultTop`). A fixed
 * height left blank is the type's height. "Up to level above" needs a level
 * above (`rise` not null); without one the wall stands at a fixed height.
 * Returns the `top` and `height` to write on the segment.
 */
export function placedWallTop(choice, { defaultTop = null, rise = null } = {}) {
  const mode = choice?.mode;
  if (mode === "level-above" && rise != null) return { top: "level-above", height: null };
  if (mode === "fixed" || mode === "level-above") {
    const height = Number(choice.height);
    return { top: null, height: height > 0 ? height : null };
  }
  return { top: defaultTop === "level-above" && rise != null ? "level-above" : null, height: null };
}

/**
 * What the Top setting shows for the armed type: the mode, and the height in
 * metres the next wall would get. `typeHeight` is the type's own height, which
 * a fixed choice with no height of its own falls back to.
 */
export function placementTopShown(choice, { defaultTop = null, rise = null, typeHeight = null } = {}) {
  const placed = placedWallTop(choice, { defaultTop, rise });
  const mode = placed.top === "level-above" ? "level-above" : "fixed";
  const height = mode === "level-above" ? rise : (placed.height ?? typeHeight);
  return { mode, height: Number.isFinite(height) ? height : null };
}

/** A placed door stays armed. A window still returns to Select. */
export function openingStaysArmed(category) {
  return category === "door";
}

/** Most recent first, duplicates collapsed, capped. Session list only. */
export function noteRecentDoor(list, skuId, limit = 8) {
  if (!skuId) return [...(list || [])];
  return [skuId, ...(list || []).filter((id) => id !== skuId)].slice(0, limit);
}

/** Door SKUs for the recent row, in list order, skipping anything not a door. */
export function recentDoorSkus(skus, ids) {
  const doors = new Map((skus || []).filter((sku) => sku.category === "door").map((sku) => [sku.id, sku]));
  const out = [];
  for (const id of ids || []) {
    const sku = doors.get(id);
    if (sku) out.push(sku);
  }
  return out;
}

/** New work is red. Existing work is white. Both take the same dark edge. */
export const WALL_NEW = "#d0121a";
export const WALL_EXISTING = "#ffffff";
export const WALL_EXISTING_EDGE = "#1a1612";

export function wallPlanColour(status) {
  if (status === "existing") return { stroke: WALL_EXISTING, edge: WALL_EXISTING_EDGE };
  if (!status || status === "planned") return { stroke: WALL_NEW, edge: WALL_EXISTING_EDGE };
  return null;
}

/** One control: model (walls on top) and sheet (the PDF on top) swap. */
export function nextTraceView(view) {
  return view === "sheet" ? "model" : "sheet";
}

/**
 * The wall body on plan, as a quad around the centreline. Used to let the
 * sheet show through a selected wall without moving the wall.
 */
export function wallFootprint(wall) {
  const t = (Number(wall?.thickness) || 0) / 2;
  const x1 = wall?.x1 || 0;
  const y1 = wall?.y1 || 0;
  const x2 = wall?.x2 ?? x1;
  const y2 = wall?.y2 ?? y1;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * t;
  const ny = ((x2 - x1) / len) * t;
  return [
    { x: x1 + nx, y: y1 + ny },
    { x: x2 + nx, y: y2 + ny },
    { x: x2 - nx, y: y2 - ny },
    { x: x1 - nx, y: y1 - ny },
  ];
}

function wallUnit(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return { x: dx / len, y: dy / len };
}

/** Offset line of one face. `side` +1 is left of the stored direction. */
function wallSideLine(wall, side) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy) || 1;
  const h = (Number(wall.thickness) || 0) / 2;
  const nx = (-dy / len) * side * h;
  const ny = (dx / len) * side * h;
  return {
    x1: wall.x1 + nx,
    y1: wall.y1 + ny,
    x2: wall.x2 + nx,
    y2: wall.y2 + ny,
  };
}

function wallFacePoint(wall, end, side) {
  const line = wallSideLine(wall, side);
  return end === 1 ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };
}

function lineMeet(a, b) {
  const dax = a.x2 - a.x1;
  const day = a.y2 - a.y1;
  const dbx = b.x2 - b.x1;
  const dby = b.y2 - b.y1;
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b.x1 - a.x1) * dby - (b.y1 - a.y1) * dbx) / den;
  return { x: a.x1 + t * dax, y: a.y1 + t * day };
}

function intoJoint(wall, end) {
  return end === 2
    ? wallUnit(wall.x1, wall.y1, wall.x2, wall.y2)
    : wallUnit(wall.x2, wall.y2, wall.x1, wall.y1);
}

function awayFromJoint(wall, end) {
  return end === 2
    ? wallUnit(wall.x2, wall.y2, wall.x1, wall.y1)
    : wallUnit(wall.x1, wall.y1, wall.x2, wall.y2);
}

/**
 * The two face corners at one end. A wall that meets another at this point
 * mitres with it, so the pair fills a clean corner instead of stopping square
 * and leaving a notch. A neighbour that continues the same line keeps the
 * square end; the shared line then disappears when the outlines are drawn
 * together. With several neighbours, each face meets the wall beside it.
 */
function wallEndCorners(wall, end, neighbors) {
  const square = [wallFacePoint(wall, end, 1), wallFacePoint(wall, end, -1)];
  const into = intoJoint(wall, end);
  if (!into || !neighbors.length) return square;
  const joint = end === 1 ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
  const leftIs = end === 2 ? 1 : -1;
  const angled = [];
  for (const nb of neighbors) {
    const away = awayFromJoint(nb.wall, nb.end);
    if (!away) continue;
    const cross = into.x * away.y - into.y * away.x;
    const dot = into.x * away.x + into.y * away.y;
    if (Math.abs(cross) <= 0.02 && dot >= -0.02) continue;
    const ang = Math.atan2(cross, dot);
    angled.push({ nb, cross, ang });
  }
  if (!angled.length) return square;

  const nearest = (sign) => {
    let best = null;
    let bestAng = Infinity;
    for (const row of angled) {
      const ang = sign > 0 ? row.ang : -row.ang;
      if (ang <= 0.02 || ang >= Math.PI - 0.02) continue;
      if (ang < bestAng) {
        bestAng = ang;
        best = row.nb;
      }
    }
    return best;
  };

  let leftNb = nearest(1);
  let rightNb = nearest(-1);
  if (angled.length === 1 && neighbors.length === 1) {
    leftNb = rightNb = angled[0].nb;
  }

  void leftIs;
  // The faces that look into the angle between the two walls meet each other,
  // and so do the two faces on the outside. That pairing holds at any angle.
  const corner = (side, nb) => {
    if (!nb) return wallFacePoint(wall, end, side);
    const away = awayFromJoint(nb.wall, nb.end);
    const ax = wall.x2 - wall.x1;
    const ay = wall.y2 - wall.y1;
    const bx = nb.wall.x2 - nb.wall.x1;
    const by = nb.wall.y2 - nb.wall.y1;
    // Left normals of each wall's stored direction.
    const innerA = (-ay * away.x + ax * away.y) >= 0 ? 1 : -1;
    const innerB = (-by * -into.x + bx * -into.y) >= 0 ? 1 : -1;
    const otherSide = side === innerA ? innerB : -innerB;
    const hit = lineMeet(wallSideLine(wall, side), wallSideLine(nb.wall, otherSide));
    if (!hit) return wallFacePoint(wall, end, side);
    const limit = ((Number(wall.thickness) || 0) + (Number(nb.wall.thickness) || 0)) * 4;
    if (Math.hypot(hit.x - joint.x, hit.y - joint.y) > limit) return wallFacePoint(wall, end, side);
    return hit;
  };

  return [corner(1, leftNb), corner(-1, rightNb)];
}

/**
 * Plan outline of one wall, mitred where an end meets another wall's end.
 * `walls` is every wall that may join this one (the same storey). Four points,
 * starting at the first end's left face and going along the left face.
 * Null when the wall has no thickness.
 */
export function joinedWallPolygon(wall, walls, tol = CORNER_JOIN_TOL) {
  const thickness = Number(wall?.thickness) || 0;
  if (!(thickness > 0)) return null;
  if (Math.hypot((wall.x2 || 0) - (wall.x1 || 0), (wall.y2 || 0) - (wall.y1 || 0)) < 1e-6) return null;
  // A curved wall meets a straight one tangentially (a fillet), so both ends
  // stay square. Mitring to the arc's chord would cut a notch into the join.
  const others = (walls || []).filter((other) => other && other !== wall && other.id !== wall.id && !other.arc && (Number(other.thickness) || 0) > 0);
  const start = wallEndCorners(wall, 1, wallCornerNeighbors(wall, 1, others, { tol }));
  const end = wallEndCorners(wall, 2, wallCornerNeighbors(wall, 2, others, { tol }));
  return [start[0], end[0], end[1], start[1]];
}
