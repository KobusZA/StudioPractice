// Wall derivation from polygon rooms.
//
// v1 kept two maps keyed by a single coordinate (one for vertical walls, one for
// horizontal) which meant only axis-aligned rooms could ever share a wall. Here
// segments are grouped by the identity of their infinite line, so a shared wall
// between two rooms is found at any angle. Axis-aligned input produces the same
// walls v1 produced, which the parity test pins down.

import {
  EPS,
  GRID,
  lineBasis,
  lineKey,
  offsetOf,
  pointFromBasis,
  polyEdges,
  projectOnBasis,
  segLength,
} from "./geom.js";
import { effectiveLevel, roomPolygon } from "./model.js";

function skuById(pack, id) {
  return pack?.skus?.find((s) => s.id === id) || null;
}

/**
 * A strip footing is named width-by-depth ("600X200"): `width` is the pad in
 * plan, `depth` is how tall it is, and `thickness` is copied from depth so the
 * SKU still has a wall-like thickness field. A masonry foundation wall either
 * states a height, or is no wider than its wall thickness.
 */
export function isStripFooting(sku) {
  if (sku?.category !== "foundation") return false;
  const g = sku.geometry || {};
  if (Number.isFinite(g.height) && g.height > 0) return false;
  const t = g.thickness;
  const w = g.width;
  const d = g.depth;
  if (!(w > 0) || !(t > 0) || !(d > 0)) return false;
  return w > t + 1e-6 && Math.abs(t - d) < 1e-4;
}

/** Plan thickness of a drawn wall/foundation segment. */
export function drawnWallThickness(sku) {
  const g = sku?.geometry || {};
  if (isStripFooting(sku)) return g.width;
  return g.thickness ?? g.width ?? 0.22;
}

/** Height the SKU itself states, or the strip's depth. Null if unknown. */
export function skuDrawnHeight(sku) {
  const g = sku?.geometry || {};
  if (Number.isFinite(g.height) && g.height > 0) return g.height;
  if (isStripFooting(sku) && Number.isFinite(g.depth) && g.depth > 0) return g.depth;
  return null;
}

function skuIdOrDefault(pack, id) {
  return skuById(pack, id) ? id : pack?.system?.defaultWallSku;
}

/** Thickest wall SKU wins where rooms disagree, matching v1 pickWallSku. */
function pickWallSku(pack, rooms) {
  let best = rooms[0]?.wallSku || pack.system.defaultWallSku;
  let thick = skuById(pack, best)?.geometry?.thickness || 0;
  for (const room of rooms) {
    const sku = skuById(pack, room.wallSku);
    const t = sku?.geometry?.thickness || 0;
    if (t > thick) {
      best = room.wallSku;
      thick = t;
    }
  }
  return skuIdOrDefault(pack, best);
}

export function objectStatus(obj) {
  return obj?.status === "existing" ? "existing" : "planned";
}

/** Plan and 3D filters share this: mixed (a wall shared by existing and
 *  planned rooms) stays visible in either slice. */
export function statusVisible(status, filter) {
  if (!filter || filter === "both") return true;
  if (status === "mixed") return true;
  const s = status === "existing" ? "existing" : "planned";
  return s === filter;
}

function combineStatus(objs) {
  const set = new Set((objs || []).map(objectStatus));
  if (set.size === 1) return [...set][0];
  if (set.has("existing") && set.has("planned")) return "mixed";
  return "planned";
}

/**
 * Derive shared walls from room polygons.
 * Returns walls with stable ids, endpoints, length, sku, thickness, height,
 * the rooms they bound, and which polygon edge of each room they came from.
 */
export function deriveRoomWalls(doc, pack) {
  // Keyed by level as well as line identity: two rooms that align in plan but
  // sit on different storeys (the common case - upper floors usually repeat
  // the footprint) must never be merged into one shared wall.
  const groups = new Map();

  for (const room of doc.rooms || []) {
    const poly = roomPolygon(room);
    if (poly.length < 3) continue;
    const level = effectiveLevel(room, pack);
    for (const edge of polyEdges(poly)) {
      if (edge.length < EPS) continue;
      const [x1, y1] = edge.a;
      const [x2, y2] = edge.b;
      const key = `${level}|${lineKey(x1, y1, x2, y2)}`;
      if (!groups.has(key)) {
        const basis = lineBasis(x1, y1, x2, y2);
        groups.set(key, {
          basis,
          offset: offsetOf(basis, x1, y1),
          level,
          segs: [],
        });
      }
      const g = groups.get(key);
      const s1 = projectOnBasis(g.basis, x1, y1);
      const s2 = projectOnBasis(g.basis, x2, y2);
      g.segs.push({
        lo: Math.min(s1, s2),
        hi: Math.max(s1, s2),
        room,
        edgeIndex: edge.index,
      });
    }
  }

  const walls = [];
  for (const [key, g] of groups) {
    const marks = new Set();
    for (const seg of g.segs) {
      marks.add(Number(seg.lo.toFixed(4)));
      marks.add(Number(seg.hi.toFixed(4)));
    }
    const pts = [...marks].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i += 1) {
      const lo = pts[i];
      const hi = pts[i + 1];
      if (hi - lo < GRID / 2) continue;
      const mid = (lo + hi) / 2;
      const hits = g.segs.filter((seg) => seg.lo <= mid + EPS && seg.hi >= mid - EPS);
      if (!hits.length) continue;

      const seen = new Map();
      for (const hit of hits) seen.set(hit.room.id, hit.room);
      const rooms = [...seen.values()];

      const skuId = pickWallSku(pack, rooms);
      const sku = skuById(pack, skuId);
      const [x1, y1] = pointFromBasis(g.basis, lo, g.offset);
      const [x2, y2] = pointFromBasis(g.basis, hi, g.offset);

      walls.push({
        id: `w:${key}:${lo.toFixed(3)}:${hi.toFixed(3)}`,
        x1,
        y1,
        x2,
        y2,
        length: hi - lo,
        sku: skuId,
        category: sku?.category || "wall",
        thickness: sku?.geometry?.thickness ?? 0.22,
        height: sku?.geometry?.height ?? pack.system.wallHeight,
        level: g.level,
        // Room-derived walls are level-datum-only: attach belongs to linear
        // objects a person placed directly, and a shared wall has no single
        // owner to have attached it. See LEVEL-ATTACH-PLAN.md's Phase 2.
        baseAttach: null,
        baseOffset: 0,
        roomIds: rooms.map((r) => r.id),
        shared: rooms.length > 1,
        edges: hits.map((h) => ({ roomId: h.room.id, edgeIndex: h.edgeIndex })),
        drawn: false,
        status: combineStatus(rooms),
      });
    }
  }
  return walls;
}

/** Walls the user drew directly: foundations, boundary walls, free-standing walls. */
export function deriveDrawnWalls(doc, pack, minLength = 0.3) {
  const walls = [];
  for (const seg of doc.segments || []) {
    const sku = skuById(pack, seg.sku);
    if (!sku) continue;
    const length = segLength(seg.x1, seg.y1, seg.x2, seg.y2);
    if (length < minLength) continue;
    walls.push({
      id: seg.id,
      x1: seg.x1,
      y1: seg.y1,
      x2: seg.x2,
      y2: seg.y2,
      length,
      sku: sku.id,
      category: sku.category,
      thickness: drawnWallThickness(sku),
      // `seg.height` is the per-object override Detach writes when it freezes a
      // wall at the height its attach had resolved to; everything else falls
      // through to the SKU and the document default as before. A strip footing
      // uses its depth here so it is not extruded to `system.wallHeight`.
      height: seg.height ?? skuDrawnHeight(sku) ?? pack.system.wallHeight,
      level: effectiveLevel(seg, pack),
      // Passed through untouched - compile.js resolves it, because that is
      // where the level datums and the target's height already are.
      baseAttach: seg.baseAttach ?? null,
      baseOffset: seg.baseOffset || 0,
      roomIds: [],
      shared: false,
      edges: [],
      drawn: true,
      status: objectStatus(seg),
    });
  }
  return walls;
}

export function deriveWalls(doc, pack) {
  return [...deriveRoomWalls(doc, pack), ...deriveDrawnWalls(doc, pack)];
}

/** External walls are bounded by exactly one room. Needed by Part XA and Part O. */
export function isExternalWall(wall) {
  return !wall.shared && wall.roomIds.length <= 1;
}
