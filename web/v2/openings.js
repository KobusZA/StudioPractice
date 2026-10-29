// Opening placement and host validation.
//
// v1 anchored an opening to a room plus a compass letter ("N", "S", "E", "W"),
// which only has meaning for an axis-aligned rectangle. v2 anchors to a polygon
// edge index, so the same logic works for L-shaped and angled rooms. The v1
// compass letters are migrated in model.js.

import {
  EPS,
  distToSeg,
  paramOnSeg,
  pointInPoly,
  polyEdges,
  segNormal,
} from "./geom.js";
import { roomPolygon } from "./model.js";

export function skuById(pack, id) {
  return pack?.skus?.find((s) => s.id === id) || null;
}

/**
 * An opening's size on this job: its own sill, width and height where it has
 * set them, otherwise its type's. `nonStandard` is true when a window has been
 * resized to a width x height that matches no window type in the pack, so the
 * firm must confirm it (made to order, not a catalogue size).
 */
export function openingSize(pack, opening) {
  const sku = skuById(pack, opening?.sku);
  const g = sku?.geometry || {};
  const pick = (own, fromType) => (Number.isFinite(own) && own > 0 ? own : fromType);
  const width = pick(opening?.width, g.width);
  const height = pick(opening?.height, g.height);
  const sill = Number.isFinite(opening?.sill) && opening.sill >= 0 ? opening.sill : (g.sill ?? null);
  let nonStandard = false;
  if (sku?.category === "window" && (Number.isFinite(opening?.width) || Number.isFinite(opening?.height))) {
    nonStandard = !(pack?.skus || []).some((s) => s.category === "window"
      && Math.abs((s.geometry?.width ?? -1) - width) < 0.0005
      && Math.abs((s.geometry?.height ?? -1) - height) < 0.0005);
  }
  return { width, height, sill, nonStandard };
}

export function allowedHosts(pack, skuId) {
  return pack?.recipes?.allowedHosts?.[skuId] || null;
}

export function hostOk(pack, skuId, wall) {
  const hosts = allowedHosts(pack, skuId);
  if (!hosts) return true;
  return hosts.includes(wall.sku);
}

/** The nth boundary edge of a room, as a segment. */
export function roomEdgeSegment(room, edgeIndex) {
  const poly = roomPolygon(room);
  const edges = polyEdges(poly);
  const edge = edges[((edgeIndex % edges.length) + edges.length) % edges.length];
  if (!edge) return null;
  return { x1: edge.a[0], y1: edge.a[1], x2: edge.b[0], y2: edge.b[1] };
}

export function pointOnWall(wall, t) {
  return {
    x: wall.x1 + (wall.x2 - wall.x1) * t,
    y: wall.y1 + (wall.y2 - wall.y1) * t,
  };
}

export function wallT(wall, x, y) {
  return Math.min(1, Math.max(0, paramOnSeg(wall.x1, wall.y1, wall.x2, wall.y2, x, y)));
}

export function distToWall(wall, x, y) {
  const t = wallT(wall, x, y);
  const p = pointOnWall(wall, t);
  return Math.hypot(p.x - x, p.y - y);
}

export function wallNormal(wall, sign = 1) {
  return segNormal(wall.x1, wall.y1, wall.x2, wall.y2, sign);
}

/**
 * Which jamb a door hinges from. 1 is the low-t end (a); -1 is the other end.
 * Missing means 1, so a door saved before this still opens from a.
 */
export function doorHand(opening) {
  return opening?.hand === -1 ? -1 : 1;
}

/**
 * Plan swing of a door: the hinge jamb, the free jamb, and where the leaf
 * tip lands on the swing side of the wall.
 */
export function doorSwing(wall, placed, opening) {
  const atA = doorHand(opening) === 1;
  const hinge = atA ? placed.a : placed.b;
  const free = atA ? placed.b : placed.a;
  const n = wallNormal(wall, opening?.swing || 1);
  const width = placed.width || 0;
  return {
    hinge,
    free,
    leaf: { x: hinge.x + n.x * width, y: hinge.y + n.y * width },
  };
}

/**
 * The straight plan strokes a click should land on: the opening in the wall,
 * and for a door the open leaf. The swing itself is the quarter-circle, tested
 * in `pointOnDoorArc`. The hinge of a normal door sits further from the
 * opening's midpoint than a small circle around it.
 */
export function openingSymbolSegments(wall, placed, opening) {
  if (!placed?.a || !placed?.b) return [];
  const segs = [[placed.a, placed.b]];
  if (placed.sku?.category === "door") {
    const swing = doorSwing(wall, placed, opening);
    segs.push([swing.hinge, swing.leaf]);
  }
  return segs;
}

/** Shortest signed turn from `from` to `to`, in (-π, π]. */
function directedSweep(from, to) {
  let sweep = to - from;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  return sweep;
}

/**
 * True when (x, y) lies within `tol` metres of the door's quarter-circle
 * swing: centre at the hinge, from the free jamb to the open leaf.
 */
/** The door's quarter-circle: distance from the hinge, the leaf radius, and
 * whether the bearing from the hinge falls inside the sweep. */
function swingSector(wall, placed, opening, x, y) {
  if (placed?.sku?.category !== "door") return null;
  const swing = doorSwing(wall, placed, opening);
  const radius = Math.hypot(swing.free.x - swing.hinge.x, swing.free.y - swing.hinge.y);
  if (!(radius > EPS)) return null;
  const dx = x - swing.hinge.x;
  const dy = y - swing.hinge.y;
  const from = Math.atan2(swing.free.y - swing.hinge.y, swing.free.x - swing.hinge.x);
  const sweep = directedSweep(from, Math.atan2(swing.leaf.y - swing.hinge.y, swing.leaf.x - swing.hinge.x));
  let rel = Math.atan2(dy, dx) - from;
  let inside = false;
  if (sweep >= 0) {
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    inside = rel <= sweep + 1e-6;
  } else {
    while (rel > 0) rel -= Math.PI * 2;
    while (rel <= -Math.PI * 2) rel += Math.PI * 2;
    inside = rel >= sweep - 1e-6;
  }
  return { dist: Math.hypot(dx, dy), radius, inside };
}

export function pointOnDoorArc(wall, placed, opening, x, y, tol = 0.15) {
  const sector = swingSector(wall, placed, opening, x, y);
  if (!sector?.inside) return false;
  const reach = Number.isFinite(tol) ? tol : 0.15;
  return Math.abs(sector.dist - sector.radius) <= reach;
}

/** True when (x, y) sits inside the door's swing, not only on its stroke.
 * The leaf and the quarter-circle are the door a person grabs. */
export function pointInDoorSwing(wall, placed, opening, x, y, tol = 0) {
  const sector = swingSector(wall, placed, opening, x, y);
  if (!sector?.inside) return false;
  const reach = Number.isFinite(tol) ? tol : 0;
  return sector.dist <= sector.radius + reach;
}

/** True when (x, y) is within `tol` metres of any stroke of the opening symbol. */
export function pointOnOpeningSymbol(wall, placed, opening, x, y, tol = 0.15) {
  const reach = Number.isFinite(tol) ? tol : 0.15;
  for (const [a, b] of openingSymbolSegments(wall, placed, opening)) {
    if (distToSeg(a.x, a.y, b.x, b.y, x, y) <= reach) return true;
  }
  return pointOnDoorArc(wall, placed, opening, x, y, reach);
}

/**
 * True when (x, y) is in the opening's cut through the wall: between the
 * jambs, and no further from the wall line than `tol`. `tol` is the wall's
 * own pick reach, which is wider than the thin swing stroke, so a click on
 * the wall where the door is does not fall through to the wall.
 */
export function pointInOpeningCut(placed, x, y, tol) {
  if (!placed?.a || !placed?.b || !(tol > 0)) return false;
  return distToSeg(placed.a.x, placed.a.y, placed.b.x, placed.b.y, x, y) <= tol;
}

export function wallSnapDist(wall) {
  return Math.max(0.55, (wall.thickness || 0.22) * 2.5);
}

export function nearestPlaceWall(walls, pack, x, y, skuId) {
  const sku = skuById(pack, skuId);
  const need = (sku?.geometry?.width || 0.9) + 0.05;
  let best = null;
  let bestD = Infinity;
  for (const wall of walls) {
    if (!hostOk(pack, skuId, wall)) continue;
    const d = distToWall(wall, x, y);
    if (d < bestD && d < wallSnapDist(wall) && wall.length >= need) {
      best = wall;
      bestD = d;
    }
  }
  return best;
}

function roomById(doc, id) {
  return doc.rooms.find((r) => r.id === id) || null;
}

/** Resolve which derived wall an opening actually sits in. */
export function wallForOpening(doc, pack, walls, opening) {
  if (opening.wallId) {
    return walls.find((w) => w.id === opening.wallId) || null;
  }
  const room = roomById(doc, opening.roomId);
  if (!room) return null;
  const edge = roomEdgeSegment(room, opening.edgeIndex ?? 0);
  if (!edge) return null;

  // Walls are keyed by geometry, not by room edge, so match on proximity to the
  // anchor point. Prefer a wall that both hosts this SKU and is long enough.
  const t = Math.min(1, Math.max(0, Number(opening.t) || 0.5));
  const px = edge.x1 + (edge.x2 - edge.x1) * t;
  const py = edge.y1 + (edge.y2 - edge.y1) * t;
  const width = openingSize(pack, opening).width || 0.9;

  let best = null;
  let bestD = 0.2;
  for (const wall of walls) {
    if (!hostOk(pack, opening.sku, wall)) continue;
    if (wall.length < width - 0.05) continue;
    const d = distToWall(wall, px, py);
    if (d < bestD) {
      best = wall;
      bestD = d;
    }
  }
  return best;
}

function clampT(t, wall, width) {
  const half = (width / 2) / (wall.length || 1);
  if (Number.isFinite(t) && t >= 0 && t <= 1) {
    return Math.min(1 - half, Math.max(half, t));
  }
  return Math.min(1 - half, Math.max(half, 0.5));
}

/** Where an opening physically lands on its wall, plus its two jamb points. */
export function openingOnWall(doc, pack, opening, wall) {
  const sku = skuById(pack, opening.sku);
  const width = openingSize(pack, opening).width || 0.9;
  const room = !opening.wallId ? roomById(doc, opening.roomId) : null;
  const anchor = room ? roomEdgeSegment(room, opening.edgeIndex ?? 0) : wall;
  const tAnchor = Math.min(1, Math.max(0, Number(opening.t) || 0.5));
  const px = anchor.x1 + (anchor.x2 - anchor.x1) * tAnchor;
  const py = anchor.y1 + (anchor.y2 - anchor.y1) * tAnchor;

  const t = clampT(wallT(wall, px, py), wall, width);
  const half = (width / 2) / (wall.length || 1);
  return {
    wall,
    sku,
    width,
    t,
    a: pointOnWall(wall, t - half),
    b: pointOnWall(wall, t + half),
  };
}

/**
 * Live strings along a host wall while an opening is being placed: from each
 * jamb to the next thing on that side (a neighbouring opening, or the wall
 * end). Same idea as the object-placement probes, except both sides of the
 * host are always known so they draw without waiting for an arrow key.
 */
export function openingSideGaps(wall, placed, neighbors = []) {
  const len = wall?.length || (wall ? Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) : 0);
  if (!(len > EPS) || !placed) return [];
  const half = (Number(placed.width) || 0) / 2;
  const tLo = placed.t - half / len;
  const tHi = placed.t + half / len;
  let leftT = 0;
  let rightT = 1;
  for (const n of neighbors) {
    const nh = (Number(n.width) || 0) / 2;
    const nLo = n.t - nh / len;
    const nHi = n.t + nh / len;
    if (nHi <= tLo + EPS && nHi > leftT) leftT = nHi;
    if (nLo >= tHi - EPS && nLo < rightT) rightT = nLo;
  }
  const a = placed.a || pointOnWall(wall, tLo);
  const b = placed.b || pointOnWall(wall, tHi);
  const gaps = [];
  const leftDist = (tLo - leftT) * len;
  const rightDist = (rightT - tHi) * len;
  if (leftDist > EPS) {
    const from = pointOnWall(wall, leftT);
    gaps.push({ x1: from.x, y1: from.y, x2: a.x, y2: a.y, dist: leftDist });
  }
  if (rightDist > EPS) {
    const to = pointOnWall(wall, rightT);
    gaps.push({ x1: b.x, y1: b.y, x2: to.x, y2: to.y, dist: rightDist });
  }
  return gaps;
}

export function swingToward(wall, x, y) {
  const t = wallT(wall, x, y);
  const p = pointOnWall(wall, t);
  const n = wallNormal(wall, 1);
  return (x - p.x) * n.x + (y - p.y) * n.y >= 0 ? 1 : -1;
}

/**
 * The opening a click at (x, y) would commit: same host, t and swing the
 * canvas preview uses. Drawn walls store a wallId; room-derived walls store
 * the room edge under the pointer (or the first edge if the pointer is
 * outside every room). A door also stores `hand` (which jamb it hinges from).
 * The click is the centre of the opening, so both jambs are the same distance
 * from the pointer; `handSign` is the choice made while placing (Space).
 */
function sameOpeningHost(opening, draft) {
  if (draft.wallId) return opening.wallId === draft.wallId;
  return !opening.wallId && opening.roomId === draft.roomId && (opening.edgeIndex ?? 0) === (draft.edgeIndex ?? 0);
}

/**
 * Where this opening would sit if the pointer landed on `wall`. A drawn wall
 * stores a wallId. A room wall keeps the opening's own edge when that wall
 * still carries it, so a drag does not hop to another edge of a shared wall.
 */
function draftAlongWall(doc, pack, wall, opening, x, y) {
  const sku = skuById(pack, opening.sku);
  if (!sku || !wall) return null;
  const swing = swingToward(wall, x, y);
  const hand = sku.category === "door" ? (opening.hand === -1 ? -1 : 1) : undefined;
  const handFields = hand === undefined ? {} : { hand };
  if (wall.drawn) {
    return { sku: opening.sku, wallId: wall.id, t: wallT(wall, x, y), swing, ...handFields };
  }
  const own = (wall.edges || []).find((e) => e.roomId === opening.roomId && (e.edgeIndex ?? 0) === (opening.edgeIndex ?? 0));
  const roomHit = (doc.rooms || []).find((r) => {
    const poly = roomPolygon(r);
    return poly.length >= 3 && pointInPoly(x, y, poly);
  });
  const edge = own || (wall.edges || []).find((e) => e.roomId === roomHit?.id) || wall.edges?.[0];
  const room = edge ? (doc.rooms || []).find((r) => r.id === edge.roomId) : null;
  if (!room) return null;
  const edgeSeg = roomEdgeSegment(room, edge.edgeIndex);
  if (!edgeSeg) return null;
  return {
    sku: opening.sku,
    roomId: edge.roomId,
    edgeIndex: edge.edgeIndex,
    t: wallT(edgeSeg, x, y),
    swing,
    ...handFields,
  };
}

/**
 * Slide an opening with the pointer. It stays on its own wall and `t` follows
 * the pointer along that wall, including when the pointer is out on a door's
 * swing rather than on the wall line. The swing stays put while the pointer
 * is still on the opening's own side, and flips only once the pointer is
 * clearly on the other side — or on a different wall, once that wall is the
 * closer one under the pointer. The hinge (`hand`) is left alone.
 * Returns false when no wall will take this opening.
 */
export function slideOpening(doc, pack, walls, opening, x, y) {
  const host = wallForOpening(doc, pack, walls, opening);
  const other = nearestPlaceWall(walls, pack, x, y, opening.sku);
  const hostDist = host ? distToWall(host, x, y) : Infinity;
  const otherDist = other ? distToWall(other, x, y) : Infinity;
  const switchHost = Boolean(other && (!host || other.id !== host.id) && otherDist + 0.02 < hostDist);
  const wall = (switchHost ? other : host) || other;
  if (!wall) return false;
  const draft = draftAlongWall(doc, pack, wall, opening, x, y);
  if (!draft) return false;
  const clear = Math.max(0.06, (wall.thickness || 0.11) * 0.55);
  if (!sameOpeningHost(opening, draft) || distToWall(wall, x, y) > clear) {
    opening.swing = swingToward(wall, x, y);
  }
  if (draft.wallId) {
    opening.wallId = draft.wallId;
    delete opening.roomId;
    delete opening.edgeIndex;
  } else {
    delete opening.wallId;
    opening.roomId = draft.roomId;
    opening.edgeIndex = draft.edgeIndex;
  }
  opening.t = draft.t;
  return true;
}

export function openingDraftAt(doc, pack, walls, skuId, x, y, handSign = 1) {
  const sku = skuById(pack, skuId);
  if (!sku) return null;
  const wall = nearestPlaceWall(walls, pack, x, y, skuId);
  if (!wall) return null;
  const swing = swingToward(wall, x, y);
  const hand = sku.category === "door" ? (handSign === -1 ? -1 : 1) : undefined;
  if (wall.drawn) {
    return { sku: skuId, wallId: wall.id, t: wallT(wall, x, y), swing, ...(hand === undefined ? {} : { hand }) };
  }
  const roomHit = (doc.rooms || []).find((r) => {
    const poly = roomPolygon(r);
    return poly.length >= 3 && pointInPoly(x, y, poly);
  });
  const edge = (wall.edges || []).find((e) => e.roomId === roomHit?.id) || wall.edges?.[0];
  const room = edge ? (doc.rooms || []).find((r) => r.id === edge.roomId) : null;
  if (!room) return null;
  const edgeSeg = roomEdgeSegment(room, edge.edgeIndex);
  if (!edgeSeg) return null;
  return {
    sku: skuId,
    roomId: edge.roomId,
    edgeIndex: edge.edgeIndex,
    t: wallT(edgeSeg, x, y),
    swing,
    ...(hand === undefined ? {} : { hand }),
  };
}

export function beamHostsOk(walls, pack, beam, skuId) {
  const a = nearestPlaceWall(walls, pack, beam.x1, beam.y1, skuId);
  const b = nearestPlaceWall(walls, pack, beam.x2, beam.y2, skuId);
  return Boolean(a && b && a.id !== b.id);
}

/**
 * Total openable and glazed area per room, which Part O needs.
 * Returned separately because light and ventilation have different thresholds
 * and a fixed pane counts for one and not the other.
 */
export function roomOpeningAreas(doc, pack, walls) {
  const byRoom = new Map();
  const bump = (roomId, key, value) => {
    if (!roomId) return;
    if (!byRoom.has(roomId)) byRoom.set(roomId, { glazedArea: 0, openableArea: 0, count: 0 });
    const row = byRoom.get(roomId);
    row[key] += value;
  };

  for (const opening of doc.openings || []) {
    const wall = wallForOpening(doc, pack, walls, opening);
    if (!wall) continue;
    const sku = skuById(pack, opening.sku);
    if (!sku) continue;
    const g = sku.geometry || {};
    const c = sku.compliance || {};
    const size = openingSize(pack, opening);
    const openingArea = (size.width || 0) * (size.height || 0);
    if (openingArea < EPS) continue;

    const roomIds = opening.roomId ? [opening.roomId] : wall.roomIds;
    for (const roomId of roomIds) {
      bump(roomId, "count", 1);
      if (c.providesLight) bump(roomId, "glazedArea", openingArea);
      if (c.providesVentilation) {
        const frac = Number.isFinite(c.openableAreaFraction) ? c.openableAreaFraction : 0;
        bump(roomId, "openableArea", openingArea * frac);
      }
    }
  }
  return byRoom;
}
