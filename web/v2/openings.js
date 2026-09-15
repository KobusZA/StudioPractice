// Opening placement and host validation.
//
// v1 anchored an opening to a room plus a compass letter ("N", "S", "E", "W"),
// which only has meaning for an axis-aligned rectangle. v2 anchors to a polygon
// edge index, so the same logic works for L-shaped and angled rooms. The v1
// compass letters are migrated in model.js.

import {
  EPS,
  paramOnSeg,
  polyEdges,
  segNormal,
} from "./geom.js";
import { roomPolygon } from "./model.js";

export function skuById(pack, id) {
  return pack?.skus?.find((s) => s.id === id) || null;
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
  const width = skuById(pack, opening.sku)?.geometry?.width || 0.9;

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
  const width = sku?.geometry?.width || 0.9;
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

export function swingToward(wall, x, y) {
  const t = wallT(wall, x, y);
  const p = pointOnWall(wall, t);
  const n = wallNormal(wall, 1);
  return (x - p.x) * n.x + (y - p.y) * n.y >= 0 ? 1 : -1;
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
    const openingArea = (g.width || 0) * (g.height || 0);
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
