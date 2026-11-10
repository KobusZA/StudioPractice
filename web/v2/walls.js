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
  distToSeg,
  lineBasis,
  lineKey,
  offsetOf,
  pointFromBasis,
  polyEdges,
  projectOnBasis,
  segLength,
} from "./geom.js";
import { effectiveLevel, nid, roomPolygon } from "./model.js";
import { defaultWallTop, levelAboveRise } from "./level-view.js";
import { arcFromRadius } from "./click-draw.js";
import { foundationStorey, isFoundationLevel } from "./placement-warn.js";
import {
  DPC_MIN_ABOVE_GROUND,
  floorBuildUpStated,
  footingBelongsUnder,
  groundFloorsOf,
  groundWallBase,
  naturalGroundLevel,
  onGroundStorey,
} from "./floor-levels.js";

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

/**
 * How a wall type is named beside its SKU. The plan draws `thickness`, the
 * overall width. When a plastered type also states a thinner core, the
 * difference is plaster and the label says so. A type with no core, or a
 * core that is the whole thickness, stays one millimetre figure.
 * Geometry is metres, as after `normalizePackUnits`.
 */
export function wallThicknessLabel(sku) {
  const g = sku?.geometry || {};
  const overall = g.thickness;
  if (!(overall > 0)) return "";
  const overallMm = Math.round(overall * 1000);
  const core = g.coreThickness;
  if (sku?.compliance?.plastered === true && core > 0 && overall - core > 0.0005) {
    return `${Math.round(core * 1000)} mm masonry + plaster (${overallMm} mm overall)`;
  }
  return `${overallMm} mm`;
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
 *  proposed rooms) stays visible in either slice. */
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
    // A bound room's outline is the inner face of walls the user already drew.
    // Emitting a second wall along that face (or along a separation line) would
    // price a wall nobody drew.
    if (room.bound) continue;
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

      const typeHeight =
        (defaultWallTop(pack.levels, g.level, sku?.geometry?.height) ? levelAboveRise(pack.levels, g.level) : null)
        ?? sku?.geometry?.height
        ?? pack.system.wallHeight;
      // A room that states its own wall height overrides the type's. Where two
      // rooms share the wall at different heights the taller wins, and the
      // disagreement is kept on the wall so Check can say so.
      const roomHeights = rooms.map((r) => ({
        roomId: r.id,
        height: Number.isFinite(r.wallHeight) && r.wallHeight > 0 ? r.wallHeight : typeHeight,
      }));
      const height = Math.max(...roomHeights.map((h) => h.height));
      const conflict = roomHeights.some((h) => Math.abs(h.height - height) > 1e-6);

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
        // A full-storey type tops out at the level above, so a level edit
        // moves it; any other type keeps its own height.
        height,
        heightConflict: conflict ? roomHeights : null,
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
  // Rooms tagged inside drawn walls own no walls of their own, so the link a
  // window needs (wall -> room, for Part O) is found from geometry instead.
  const roomsByLevel = new Map();
  for (const room of doc.rooms || []) {
    const poly = roomPolygon(room);
    if (poly.length < 3) continue;
    const level = effectiveLevel(room, pack);
    if (!roomsByLevel.has(level)) roomsByLevel.set(level, []);
    roomsByLevel.get(level).push({ id: room.id, edges: polyEdges(poly) });
  }
  const adjoining = (wall, probe) => {
    const rooms = roomsByLevel.get(wall.level);
    if (!rooms) return [];
    const mx = probe ? probe.x : (wall.x1 + wall.x2) / 2;
    const my = probe ? probe.y : (wall.y1 + wall.y2) / 2;
    const reach = wall.thickness / 2 + ROOM_WALL_REACH;
    return rooms
      .filter((r) => r.edges.some((e) => e.length > EPS && distToSeg(e.a[0], e.a[1], e.b[0], e.b[1], mx, my) <= reach))
      .map((r) => r.id);
  };
  for (const seg of doc.segments || []) {
    const sku = skuById(pack, seg.sku);
    if (!sku) continue;
    const chord = segLength(seg.x1, seg.y1, seg.x2, seg.y2);
    if (chord < minLength) continue;
    const arc = seg.arc ? arcFromRadius(seg.x1, seg.y1, seg.x2, seg.y2, seg.arc.radius, seg.arc.side, seg.arc.major === true) : null;
    const length = arc ? arc.length : chord;
    const drawnWall = {
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
      height:
        seg.height
        ?? (seg.top === "level-above" ? levelAboveRise(pack.levels, effectiveLevel(seg, pack)) : null)
        ?? skuDrawnHeight(sku)
        ?? pack.system.wallHeight,
      top: seg.top ?? null,
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
      ...(seg.foundation === false ? { foundation: false } : {}),
      ...(arc ? { arc: { radius: arc.radius, side: arc.side, ...(arc.major ? { major: true } : {}) } } : {}),
    };
    drawnWall.roomIds = adjoining(drawnWall, arc ? { x: arc.crownX, y: arc.crownY } : null);
    walls.push(drawnWall);
  }
  return walls;
}

/**
 * The drawn segment that replaces a room-derived wall: same line, type, level
 * and height. `coveredByDrawn` then drops the generated piece, so the wall
 * stops following its rooms and can be selected and edited on its own.
 * A wall that tops out at the level above keeps following it; any other
 * height is frozen into `seg.height`.
 */
export function drawnSegmentFromWall(wall, pack) {
  if (!wall || wall.drawn) return null;
  const follows = wall.height != null
    && levelAboveRise(pack.levels, wall.level) !== null
    && Math.abs(levelAboveRise(pack.levels, wall.level) - wall.height) < 1e-6;
  return {
    id: nid("s"),
    sku: wall.sku,
    level: wall.level,
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
    status: wall.status === "existing" ? "existing" : "planned",
    top: follows ? "level-above" : null,
    height: follows ? null : wall.height,
    ...(wall.arc ? { arc: { ...wall.arc } } : {}),
  };
}

/** How far past a drawn wall's own face a room outline may sit and still count as bounded by it, metres. */
export const ROOM_WALL_REACH = 0.15;

/**
 * True when a room-derived wall piece lies along a drawn wall on the same
 * level. The room outline was traced on top of walls the user had already
 * drawn, so the generated piece would be a second copy of the same wall.
 */
function coveredByDrawn(piece, drawn) {
  const mx = (piece.x1 + piece.x2) / 2;
  const my = (piece.y1 + piece.y2) / 2;
  const px = piece.x2 - piece.x1;
  const py = piece.y2 - piece.y1;
  const plen = Math.hypot(px, py) || 1;
  return drawn.some((d) => {
    if (d.level !== piece.level || d.category === "foundation") return false;
    const dx = d.x2 - d.x1;
    const dy = d.y2 - d.y1;
    const dlen = Math.hypot(dx, dy) || 1;
    if (Math.abs(px * dy - py * dx) / (plen * dlen) > 0.02) return false;
    return distToSeg(d.x1, d.y1, d.x2, d.y2, mx, my) <= d.thickness / 2 + ROOM_WALL_REACH;
  });
}

/**
 * How close two drawn endpoints must be, in metres, to be treated as "the
 * same corner" by `joinWallCorners`. Wide enough to absorb the snap slop a
 * single-axis alignment guide can leave (see snap.js's `applyNicePoint`),
 * narrow enough to never merge two corners a person actually drew apart -
 * the narrowest wall/footing this app draws is well over 100 mm thick.
 */
export const CORNER_JOIN_TOL = 0.006;

/**
 * Which walls meet `wall` at one of its ends, as a corner.
 *
 * Two walls form a corner when their centrelines cross close to an end of
 * each. That holds however the corner was drawn: on the centreline, or with
 * "past" / "against", which leave the two ends about a wall-thickness apart.
 * Walls that continue the same line count only when their ends coincide.
 *
 * `others` are plain segments or derived walls; `thicknessOf` gives metres.
 * Each hit carries the other wall, which of its ends is at the corner, and
 * the point where the two centrelines cross (null for a continuing line).
 */
export function wallCornerNeighbors(wall, end, others, {
  thicknessOf = (w) => Number(w?.thickness) || 0,
  tol = CORNER_JOIN_TOL,
} = {}) {
  const px = end === 1 ? wall.x1 : wall.x2;
  const py = end === 1 ? wall.y1 : wall.y2;
  const ax = wall.x2 - wall.x1;
  const ay = wall.y2 - wall.y1;
  const la = Math.hypot(ax, ay);
  if (la < 1e-9) return [];
  const ta = thicknessOf(wall);
  const hits = [];
  for (const other of others || []) {
    if (!other || other === wall || (other.id != null && other.id === wall.id)) continue;
    const bx = other.x2 - other.x1;
    const by = other.y2 - other.y1;
    const lb = Math.hypot(bx, by);
    if (lb < 1e-9) continue;
    const cross = ax * by - ay * bx;
    const sin = Math.abs(cross) / (la * lb);
    if (sin < 0.05) {
      for (const qEnd of [1, 2]) {
        const qx = qEnd === 1 ? other.x1 : other.x2;
        const qy = qEnd === 1 ? other.y1 : other.y2;
        if (Math.hypot(qx - px, qy - py) <= tol) hits.push({ wall: other, end: qEnd, x: null, y: null });
      }
      continue;
    }
    const t = ((other.x1 - wall.x1) * by - (other.y1 - wall.y1) * bx) / cross;
    const x = wall.x1 + t * ax;
    const y = wall.y1 + t * ay;
    const q1 = Math.hypot(other.x1 - x, other.y1 - y);
    const q2 = Math.hypot(other.x2 - x, other.y2 - y);
    const qEnd = q1 <= q2 ? 1 : 2;
    const reach = (ta + thicknessOf(other)) / (2 * Math.max(sin, 0.25)) + 0.03;
    if (Math.hypot(px - x, py - y) <= reach && Math.min(q1, q2) <= reach) {
      hits.push({ wall: other, end: qEnd, x, y });
    }
  }
  return hits;
}

/**
 * Where a selected wall's angle is measured from, once drawing is over.
 * One corner neighbour at the start wins; otherwise one at the end. A
 * continuing straight wall is not a corner, and two neighbours at the same
 * end are ambiguous, so both leave this null and the angle stays the one
 * from the horizontal. `prev` leaves the joint along the neighbour, so the
 * wedge sits in the corner the two walls make.
 */
export function selectionAngleJoint(wall, others, thicknessOf = (w) => Number(w?.thickness) || 0) {
  const crossing = (end) => wallCornerNeighbors(wall, end, others, { thicknessOf }).filter((hit) => hit.x != null);
  let end = 1;
  let hits = crossing(1);
  if (hits.length !== 1) {
    end = 2;
    hits = crossing(2);
    if (hits.length !== 1) return null;
  }
  const hit = hits[0];
  const other = hit.wall;
  const prev = hit.end === 2
    ? { x: other.x1 - other.x2, y: other.y1 - other.y2 }
    : { x: other.x2 - other.x1, y: other.y2 - other.y1 };
  const joint = end === 1 ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
  const far = end === 1 ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
  return { joint, far, prev };
}

/** A selected wall shows a gap this far, and no further. */
export const SELECT_GAP_MAX_M = 12;
const SELECT_GAP_MIN_M = 0.05;
const SELECT_TOUCH_M = 0.35;

function gapDistToSegment(seg, x, y) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Infinity;
  let t = ((x - seg.x1) * dx + (y - seg.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (seg.x1 + dx * t), y - (seg.y1 + dy * t));
}

/**
 * The nearest wall on each side of `wall`, measured square off its line.
 * A wall that corners into this one is measured to its far end, so the join
 * itself is not reported as a tiny gap. A separate wall is the perpendicular
 * distance when it runs alongside, otherwise the nearest end whose foot
 * lands on this wall.
 *
 * With `thicknessOf` the gap is what a tape reads: from this wall's face to
 * the face of the wall alongside (or to the bare end of a wall that ends
 * there), not from centreline to centreline. Without it the gap is centre to
 * centre, as before.
 */
export function selectionSideGaps(wall, others, { max = SELECT_GAP_MAX_M, thicknessOf = null } = {}) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const half = thicknessOf ? (Number(thicknessOf(wall)) || 0) / 2 : 0;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const gaps = [];
  for (const sign of [1, -1]) {
    const sideNx = nx * sign;
    const sideNy = ny * sign;
    let best = null;
    for (const other of others || []) {
      if (!other || other === wall || (other.id != null && other.id === wall.id)) continue;
      const odx = other.x2 - other.x1;
      const ody = other.y2 - other.y1;
      const olen = Math.hypot(odx, ody);
      if (olen < 1e-9) continue;
      const ends = [[other.x1, other.y1], [other.x2, other.y2]];
      const connected = ends.some(([x, y]) => gapDistToSegment(wall, x, y) <= SELECT_TOUCH_M);
      const parallel = Math.abs(ux * ody - uy * odx) / olen < 0.08;
      const consider = (hit) => {
        if (!hit || hit.dist < SELECT_GAP_MIN_M || hit.dist > max) return;
        if (!best || hit.dist < best.dist) best = hit;
      };
      if (!connected && parallel) {
        const dist = (other.x1 - wall.x1) * sideNx + (other.y1 - wall.y1) * sideNy;
        const a1 = (other.x1 - wall.x1) * ux + (other.y1 - wall.y1) * uy;
        const a2 = (other.x2 - wall.x1) * ux + (other.y2 - wall.y1) * uy;
        const lo = Math.max(0, Math.min(a1, a2));
        const hi = Math.min(len, Math.max(a1, a2));
        if (hi - lo >= SELECT_GAP_MIN_M && dist >= SELECT_GAP_MIN_M) {
          const at = (lo + hi) / 2;
          const x1 = wall.x1 + ux * at;
          const y1 = wall.y1 + uy * at;
          consider({
            x1, y1, x2: x1 + sideNx * dist, y2: y1 + sideNy * dist, dist,
            across: thicknessOf ? (Number(thicknessOf(other)) || 0) / 2 : 0,
          });
        }
        continue;
      }
      for (const [px, py] of ends) {
        if (connected && gapDistToSegment(wall, px, py) <= SELECT_TOUCH_M) continue;
        const vx = px - wall.x1;
        const vy = py - wall.y1;
        const along = vx * ux + vy * uy;
        const dist = vx * sideNx + vy * sideNy;
        if (along < -0.02 || along > len + 0.02) continue;
        const x1 = wall.x1 + ux * Math.min(len, Math.max(0, along));
        const y1 = wall.y1 + uy * Math.min(len, Math.max(0, along));
        consider({ x1, y1, x2: px, y2: py, dist, across: 0 });
      }
    }
    if (!best) continue;
    // From the face, not the centreline: start half a wall out, and stop half
    // of the other wall short when it runs alongside. A wall that ends here
    // has a bare end, so there is nothing to take off at that side.
    const dist = best.dist - half - best.across;
    if (dist < 0.005) continue;
    gaps.push({
      x1: best.x1 + sideNx * half,
      y1: best.y1 + sideNy * half,
      x2: best.x2 - sideNx * best.across,
      y2: best.y2 - sideNy * best.across,
      dist,
    });
  }
  return gaps;
}

/**
 * How far to move a wall so one of its `selectionSideGaps` reads `dist`
 * metres. The gap runs square off the wall towards the other one, so the wall
 * moves along it: towards the other wall to close the gap, away to open it.
 * Null when the gap has no length or `dist` is not a positive number.
 */
export function gapMoveDelta(gap, dist) {
  const cur = Math.hypot((gap?.x2 ?? 0) - (gap?.x1 ?? 0), (gap?.y2 ?? 0) - (gap?.y1 ?? 0));
  if (!(cur > 1e-9) || !(Number(dist) > 0)) return null;
  const by = cur - Number(dist);
  return { dx: ((gap.x2 - gap.x1) / cur) * by, dy: ((gap.y2 - gap.y1) / cur) * by };
}

/** Two face lengths closer than this, in metres, are the same length. */
const FACE_TIE_M = 0.0005;

/** How far off a face, in metres, the room side is tested. */
const FACE_PROBE_M = 0.05;
const ENCLOSE_RAYS = 16;

/**
 * Whether walls close a point in on every side: a ray in each of
 * ENCLOSE_RAYS directions meets a wall. Outside a building, or in a notch
 * open to the outside, some ray gets away.
 */
function enclosedByWalls(px, py, walls) {
  for (let k = 0; k < ENCLOSE_RAYS; k += 1) {
    const a = ((k + 0.5) / ENCLOSE_RAYS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let hit = false;
    for (const w of walls) {
      if (!w) continue;
      const ex = w.x2 - w.x1;
      const ey = w.y2 - w.y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const qx = w.x1 - px;
      const qy = w.y1 - py;
      const s = (qx * ey - qy * ex) / den;
      const u = (qx * dy - qy * dx) / den;
      if (s > 0 && u >= 0 && u <= 1) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

/**
 * Where one end of a wall's two faces stop, as distances along the wall from
 * its first end. A wall is stored on its centreline, but nobody can measure a
 * centreline: what exists is the two faces, and a corner trims one and
 * stretches the other.
 *
 * - A wall that ends in the corner of another wall: the face on the side the
 *   other wall goes (the inside of the corner) stops at that wall's near
 *   face, and the other face runs on to its far face.
 * - A wall that ends against the side of another wall (a T): both faces stop
 *   at the near face.
 * - Anything else, including two or more walls crowding the end, is a bare
 *   end. Both faces stop where the wall stops.
 *
 * `along` is where that end sits (0 or the wall's length).
 */
function faceEndsAt(wall, end, others, thicknessOf, frame) {
  const { ux, uy, nx, ny, len, t } = frame;
  const along = end === 1 ? 0 : len;
  const bare = { plus: along, minus: along };
  const ax = wall.x2 - wall.x1;
  const ay = wall.y2 - wall.y1;
  const farX = end === 1 ? wall.x2 : wall.x1;
  const farY = end === 1 ? wall.y2 : wall.y1;
  const hits = [];
  for (const other of others || []) {
    if (!other || other === wall || (other.id != null && other.id === wall.id)) continue;
    const bx = other.x2 - other.x1;
    const by = other.y2 - other.y1;
    const lb = Math.hypot(bx, by);
    if (lb < 1e-9) continue;
    const cross = ax * by - ay * bx;
    const sin = Math.abs(cross) / (len * lb);
    if (sin < 0.05) continue;
    const tw = ((other.x1 - wall.x1) * by - (other.y1 - wall.y1) * bx) / cross;
    const cx = wall.x1 + tw * ax;
    const cy = wall.y1 + tw * ay;
    const t2 = Number(thicknessOf(other)) || 0;
    const reach = (t + t2) / (2 * Math.max(sin, 0.25)) + 0.03;
    if (Math.abs(tw * len - along) > reach) continue;
    const q1 = Math.hypot(other.x1 - cx, other.y1 - cy);
    const q2 = Math.hypot(other.x2 - cx, other.y2 - cy);
    const onOther = ((cx - other.x1) * bx + (cy - other.y1) * by) / (lb * lb);
    let kind = null;
    if (Math.min(q1, q2) <= reach) kind = "corner";
    else if (onOther > 0 && onOther < 1) kind = "side";
    if (!kind) continue;
    // Which way the other wall leaves the crossing: towards its far end.
    const gone = q1 >= q2 ? { x: other.x1, y: other.y1 } : { x: other.x2, y: other.y2 };
    hits.push({ other, kind, t2, sin, cx, cy, gone, tw });
  }
  let hit = hits.length === 1 ? hits[0] : null;
  if (hits.length === 2) {
    // One long wall drawn as two pieces that meet here is a single wall that
    // this one ends against.
    const [a, b] = hits;
    const parallel = Math.abs((a.other.x2 - a.other.x1) * (b.other.y2 - b.other.y1)
      - (a.other.y2 - a.other.y1) * (b.other.x2 - b.other.x1)) < 0.05 * Math.hypot(a.other.x2 - a.other.x1, a.other.y2 - a.other.y1)
      * Math.hypot(b.other.x2 - b.other.x1, b.other.y2 - b.other.y1);
    const opposite = (a.gone.x - a.cx) * (b.gone.x - b.cx) + (a.gone.y - a.cy) * (b.gone.y - b.cy) < 0;
    if (parallel && opposite) hit = { ...a, kind: "side", t2: Math.max(a.t2, b.t2) };
  }
  if (!hit || !(hit.t2 > 0)) return bare;

  const { other, kind, t2 } = hit;
  const bx = other.x2 - other.x1;
  const by = other.y2 - other.y1;
  const lb = Math.hypot(bx, by);
  const mx = -by / lb;
  const my = bx / lb;
  const um = ux * mx + uy * my;
  if (Math.abs(um) < 1e-6) return bare;
  const bodySide = Math.sign((farX - other.x1) * mx + (farY - other.y1) * my);
  if (!bodySide) return bare;
  // The other wall's face on this wall's side, and the one behind it.
  const near = bodySide * (t2 / 2);
  const behind = -near;
  const goneSide = Math.sign((hit.gone.x - hit.cx) * nx + (hit.gone.y - hit.cy) * ny);
  const base = (other.x1 - wall.x1) * mx + (other.y1 - wall.y1) * my;
  const stop = (s, k) => {
    // The face runs at s * t/2 off the centreline. Where it meets the line
    // k off the other wall's centreline:
    const at = (k + base - s * (t / 2) * (nx * mx + ny * my)) / um;
    // A very shallow corner throws the stop a long way out. Keep the bare end.
    return Math.abs(at - along) > (t + t2) / Math.max(hit.sin, 0.25) + 0.1 ? along : at;
  };
  const keepNear = (s) => kind === "side" || s === goneSide;
  return {
    plus: stop(1, keepNear(1) ? near : behind),
    minus: stop(-1, keepNear(-1) ? near : behind),
  };
}

/**
 * The two faces of a straight wall, and how long each is. This is what a
 * person measures with a tape: the face of the wall on the inside of the
 * building and the face on the outside are different lengths, and neither is
 * the centreline length the wall is stored with.
 *
 * `others` are the other walls on the level and `thicknessOf` gives each
 * thickness in metres. Returns null for a wall with no length. Otherwise:
 *
 * - `faces`: both faces, each `{ side, x1, y1, x2, y2, length }`. `side` is
 *   1 for the face on the wall's left-hand normal (-uy, ux), -1 for the other.
 * - `inside` / `outside`: the face towards the room and the face away from
 *   it. The room side is the side `inRoom(x, y)` says is in a room, else the
 *   side the walls close in. When both sides or neither side reads as room
 *   (a partition, or walls that do not close), the shorter face is taken as
 *   the inside, as it is in a plain corner. Both are null when that leaves
 *   no answer and the faces are the same length (a free wall, or a wall that
 *   turns one way at one end and the other way at the other); `single` is
 *   then the one face to show.
 * - `centre`: the stored centreline, `{ side: 0, x1, y1, x2, y2, length }`.
 *   It is not a length anyone can measure on site, but it is what quantities
 *   are worked from and what an engineer's drawing dimensions.
 * - `normal`: `{ x, y }`, the unit left-hand normal, so a caller can place
 *   a string on the side of a face.
 */
export function wallFaceLengths(wall, others, thicknessOf = (w) => Number(w?.thickness) || 0, { inRoom } = {}) {
  if (!wall) return null;
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const t = Number(thicknessOf(wall)) || 0;
  const frame = { ux, uy, nx, ny, len, t };
  const first = faceEndsAt(wall, 1, others, thicknessOf, frame);
  const last = faceEndsAt(wall, 2, others, thicknessOf, frame);
  const face = (side, from, to) => {
    const off = side * (t / 2);
    const length = to - from;
    if (!(length > 1e-6)) return null;
    return {
      side,
      x1: wall.x1 + ux * from + nx * off,
      y1: wall.y1 + uy * from + ny * off,
      x2: wall.x1 + ux * to + nx * off,
      y2: wall.y1 + uy * to + ny * off,
      length,
    };
  };
  const plus = face(1, first.plus, last.plus);
  const minus = face(-1, first.minus, last.minus);
  const faces = [plus, minus].filter(Boolean);
  if (!faces.length) return null;
  const centre = { side: 0, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, length: len };
  const result = { faces, centre, inside: null, outside: null, single: null, normal: { x: nx, y: ny } };
  if (faces.length !== 2) {
    result.single = plus || minus;
    return result;
  }
  const probe = (f) => {
    const off = f.side * (t / 2 + FACE_PROBE_M);
    const at = (f === plus ? first.plus + last.plus : first.minus + last.minus) / 2;
    return { x: wall.x1 + ux * at + nx * off, y: wall.y1 + uy * at + ny * off };
  };
  const pPlus = probe(plus);
  const pMinus = probe(minus);
  const pick = (test) => {
    const a = !!test(pPlus.x, pPlus.y);
    const b = !!test(pMinus.x, pMinus.y);
    return a === b ? null : a ? [plus, minus] : [minus, plus];
  };
  const walls = [wall, ...(others || [])];
  let sided = typeof inRoom === "function" ? pick(inRoom) : null;
  if (!sided) sided = pick((x, y) => enclosedByWalls(x, y, walls));
  if (!sided && Math.abs(plus.length - minus.length) > FACE_TIE_M) {
    sided = plus.length < minus.length ? [plus, minus] : [minus, plus];
  }
  if (sided) [result.inside, result.outside] = sided;
  else result.single = plus;
  return result;
}

/**
 * Pull every wall/foundation endpoint within `tol` of another one on the
 * same level onto a single shared point, before any renderer turns a wall
 * into a solid.
 *
 * Every renderer (massing.js's `pushWallPrism`, dxf.js's `wallFootprint`,
 * ui.js's `drawWall`) offsets a wall's thickness symmetrically off its own
 * exact endpoints and stops there - there is no Revit-style "Edit Wall
 * Joins" cleanup afterwards. Two segments whose endpoints are geometrically
 * meant to be the same corner render as a clean mitred join *only if* those
 * endpoints are bit-identical; drawing/snapping can leave them a millimetre
 * or two apart (an axis-alignment guide only locks one axis - see
 * `applyNicePoint`), which shows up as a small overhanging tab or gap at
 * the corner instead of the flush corner a user drawing a foundation in
 * Revit would expect. This closes that gap at the geometry level, so the
 * fix holds regardless of how the endpoint got placed.
 *
 * Endpoints already exactly equal (the common case: room-derived walls
 * share literal polygon vertices) are left untouched - a group's shared
 * point is the average of its members, so an already-exact pair snaps to
 * itself.
 */
export function joinWallCorners(walls, tol = CORNER_JOIN_TOL) {
  const pts = [];
  for (let i = 0; i < walls.length; i += 1) {
    pts.push({ wall: i, x: walls[i].x1, y: walls[i].y1 });
    pts.push({ wall: i, x: walls[i].x2, y: walls[i].y2 });
  }

  // Grid-bucketed neighbour search: with cells the size of the tolerance, any
  // point within `tol` of another falls in the same or an adjacent cell, so
  // each point only needs to check its 3x3 neighbourhood instead of every
  // other point - O(n) instead of O(n^2) for the wall counts a real plan has.
  const cellOf = (v) => Math.floor(v / tol);
  const buckets = new Map();
  const bucketKey = (cx, cy) => `${cx}|${cy}`;
  for (let i = 0; i < pts.length; i += 1) {
    const key = bucketKey(cellOf(pts[i].x), cellOf(pts[i].y));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }

  const parent = pts.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < pts.length; i += 1) {
    const cx = cellOf(pts[i].x);
    const cy = cellOf(pts[i].y);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = buckets.get(bucketKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          if (pts[i].wall === pts[j].wall) continue; // a wall's own two ends
          if (walls[pts[i].wall].level !== walls[pts[j].wall].level) continue;
          if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= tol) union(i, j);
        }
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < pts.length; i += 1) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  const snappedX = pts.map((p) => p.x);
  const snappedY = pts.map((p) => p.y);
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    let sx = 0;
    let sy = 0;
    for (const idx of idxs) {
      sx += pts[idx].x;
      sy += pts[idx].y;
    }
    const cx = sx / idxs.length;
    const cy = sy / idxs.length;
    for (const idx of idxs) {
      snappedX[idx] = cx;
      snappedY[idx] = cy;
    }
  }

  return walls.map((wall, i) => {
    const x1 = snappedX[i * 2];
    const y1 = snappedY[i * 2];
    const x2 = snappedX[i * 2 + 1];
    const y2 = snappedY[i * 2 + 1];
    if (x1 === wall.x1 && y1 === wall.y1 && x2 === wall.x2 && y2 === wall.y2) return wall;
    return { ...wall, x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) };
  });
}

export function deriveWalls(doc, pack) {
  const drawn = deriveDrawnWalls(doc, pack);
  const generated = deriveRoomWalls(doc, pack).filter((w) => !coveredByDrawn(w, drawn));
  const joined = joinWallCorners([...generated, ...drawn]);
  return [...joined, ...deriveFoundationWalls(doc, pack, joined)];
}

// --- Foundation walls drawn for you ---------------------------------------
//
// Every masonry wall on the ground storey stands on a foundation wall, centred
// on the same line, from the foundation level up to where that wall starts.
// The top follows the wall it carries, not a level, so a floor step that drops
// the wall drops the foundation top with it and the two never overlap. They are
// worked out on every compile and never stored: a foundation wall moves,
// shortens and disappears with its wall. A foundation wall drawn by hand along
// a wall always wins.

/** Customer-stated: every foundation wall is 220 mm. Metres. */
export const FOUNDATION_WALL_THICKNESS = 0.22;

export function foundationWallThickness(pack) {
  const t = pack?.system?.foundationWallThickness;
  return Number.isFinite(t) && t > 0 ? t : FOUNDATION_WALL_THICKNESS;
}

/** The pack's foundation wall type, else the first that is not a strip footing, unplastered first. */
export function foundationWallSkuId(pack) {
  const stated = pack?.system?.defaultFoundationWallSku;
  if (skuById(pack, stated)) return stated;
  const types = (pack?.skus || []).filter((s) => s.category === "foundation" && !isStripFooting(s));
  return (types.find((s) => /no[-\s]?plaster/i.test(s.name || "")) || types[0])?.id ?? null;
}

/** A pool wall sits on its own foundation; it is a wall type only because the template files it there. */
function isPoolWall(sku) {
  return /\bpool\b/i.test(`${sku?.name || ""} ${sku?.id || ""}`.replace(/_/g, " "));
}

function levelElevationOf(pack, levelId) {
  return (pack?.levels || []).find((l) => l.id === levelId || l.name === levelId)?.elevation ?? 0;
}

/** Where a wall starts, without attach: the floor beside it on the ground storey, else its datum. */
function unattachedBase(doc, pack, wall, floors) {
  return groundWallBase(doc, pack, wall, floors)
    ?? levelElevationOf(pack, wall.level) + (wall.baseOffset || 0);
}

/** A drawn foundation wall (not a strip footing) lies along `wall`, on any level. */
function drawnFoundationAlong(wall, drawnFoundations) {
  const mx = (wall.x1 + wall.x2) / 2;
  const my = (wall.y1 + wall.y2) / 2;
  const px = wall.x2 - wall.x1;
  const py = wall.y2 - wall.y1;
  const plen = Math.hypot(px, py) || 1;
  return drawnFoundations.some((d) => {
    const dx = d.x2 - d.x1;
    const dy = d.y2 - d.y1;
    const dlen = Math.hypot(dx, dy) || 1;
    if (Math.abs(px * dy - py * dx) / (plen * dlen) > 0.02) return false;
    return distToSeg(d.x1, d.y1, d.x2, d.y2, mx, my) <= d.thickness / 2 + ROOM_WALL_REACH;
  });
}

/**
 * Ground-storey masonry walls that take a derived foundation wall, each with
 * the base it resolves to. Boundary walls, fences and pool walls have their own
 * foundations. A wall marked `foundation: false`, an attached wall, or one with
 * a foundation wall drawn along it is skipped.
 */
function foundationHosts(doc, pack, walls) {
  const drawnFoundations = walls.filter((w) => w.drawn && w.category === "foundation"
    && !isStripFooting(skuById(pack, w.sku)));
  const floors = groundFloorsOf(doc, pack);
  const out = [];
  for (const wall of walls) {
    if (wall.category !== "wall" || wall.derived || wall.foundation === false || wall.baseAttach) continue;
    if (!onGroundStorey(pack, wall.level)) continue;
    if (isPoolWall(skuById(pack, wall.sku))) continue;
    const base = unattachedBase(doc, pack, wall, floors);
    if (!footingBelongsUnder(pack, base)) continue;
    if (drawnFoundationAlong(wall, drawnFoundations)) continue;
    out.push({ wall, base });
  }
  return out;
}

/** Pieces closer than this in height are the same top, metres. */
const TOP_TOL = 0.0005;
/** A foundation wall shorter than this is not drawn, metres. */
const MIN_FOUNDATION_HEIGHT = 0.02;

/**
 * Foundation walls under every ground-storey masonry wall. `walls` is the
 * derived wall list they stand under. One per line: hosts on the same line are
 * split into intervals, so two walls meeting end to end give two foundation
 * walls, and where two overlap the higher top wins and the piece carries a
 * `conflict` Check lists. Empty when the pack has no foundation storey or no
 * foundation wall type.
 */
export function deriveFoundationWalls(doc, pack, walls) {
  const home = foundationStorey(pack?.levels);
  const skuId = foundationWallSkuId(pack);
  if (!home || !skuId) return [];
  const thickness = foundationWallThickness(pack);
  const bottom = home.elevation;
  const make = (host, top, x1, y1, x2, y2, lo, hi, extra = {}) => ({
    id: `f:${host.id}:${lo.toFixed(3)}:${hi.toFixed(3)}`,
    x1,
    y1,
    x2,
    y2,
    length: hi - lo,
    sku: skuId,
    category: "foundation",
    thickness,
    height: top - bottom,
    top: null,
    level: home.id,
    baseAttach: null,
    baseOffset: 0,
    roomIds: [],
    shared: false,
    edges: [],
    drawn: false,
    derived: true,
    hostWallId: host.id,
    status: host.status === "existing" ? "existing" : (host.status === "mixed" ? "mixed" : "planned"),
    ...extra,
  });

  const out = [];
  const groups = new Map();
  for (const { wall, base } of foundationHosts(doc, pack, walls)) {
    if (base - bottom < MIN_FOUNDATION_HEIGHT) continue;
    if (wall.arc) {
      out.push(make(wall, base, wall.x1, wall.y1, wall.x2, wall.y2, 0, wall.length, { arc: { ...wall.arc } }));
      continue;
    }
    if (segLength(wall.x1, wall.y1, wall.x2, wall.y2) < EPS) continue;
    const key = lineKey(wall.x1, wall.y1, wall.x2, wall.y2);
    if (!groups.has(key)) {
      const basis = lineBasis(wall.x1, wall.y1, wall.x2, wall.y2);
      groups.set(key, { basis, offset: offsetOf(basis, wall.x1, wall.y1), pieces: [] });
    }
    const g = groups.get(key);
    const s1 = projectOnBasis(g.basis, wall.x1, wall.y1);
    const s2 = projectOnBasis(g.basis, wall.x2, wall.y2);
    g.pieces.push({ lo: Math.min(s1, s2), hi: Math.max(s1, s2), top: base, wall });
  }

  for (const g of groups.values()) {
    const marks = [...new Set(g.pieces.flatMap((p) => [Number(p.lo.toFixed(4)), Number(p.hi.toFixed(4))]))]
      .sort((a, b) => a - b);
    for (let i = 0; i < marks.length - 1; i += 1) {
      const lo = marks[i];
      const hi = marks[i + 1];
      if (hi - lo < GRID / 2) continue;
      const mid = (lo + hi) / 2;
      const hits = g.pieces.filter((p) => p.lo <= mid + EPS && p.hi >= mid - EPS);
      if (!hits.length) continue;
      const winner = hits.reduce((best, p) => (p.top > best.top + TOP_TOL ? p : best));
      const clash = hits.some((p) => Math.abs(p.top - winner.top) > TOP_TOL);
      const [x1, y1] = pointFromBasis(g.basis, lo, g.offset);
      const [x2, y2] = pointFromBasis(g.basis, hi, g.offset);
      out.push(make(winner.wall, winner.top, x1, y1, x2, y2, lo, hi, clash
        ? { conflict: hits.map((p) => ({ hostWallId: p.wall.id, top: p.top })) }
        : {}));
    }
  }
  return out;
}

/** "f:<host wall id>:<lo>:<hi>" is a derived foundation wall's id. */
export function isDerivedFoundationId(id) {
  return typeof id === "string" && id.startsWith("f:");
}

/**
 * The default top for a newly drawn segment. A foundation wall on the
 * foundation storey runs up to the ground floor: the type states no height,
 * and `system.wallHeight` would make it a storey tall. Strip footings keep
 * their depth; everything else follows `defaultWallTop`.
 */
export function defaultSegmentTop(levels, levelId, sku) {
  if (sku?.category === "foundation" && !isStripFooting(sku) && skuDrawnHeight(sku) === null) {
    const level = (levels || []).find((l) => l.id === levelId);
    if (isFoundationLevel(level) && levelAboveRise(levels, levelId) !== null) return "level-above";
  }
  return defaultWallTop(levels, levelId, skuDrawnHeight(sku));
}

/**
 * Foundation findings for the Check panel, each `{ kind, message }`:
 * build-up not stated, overlapping foundation walls, a DPC under 150 mm above
 * natural ground, and no foundation storey or type to draw them on.
 */
export function foundationChecks(doc, pack, walls = null) {
  const all = walls || deriveWalls(doc, pack);
  const out = [];
  const levelName = (id) => (pack?.levels || []).find((l) => l.id === id)?.name || id;
  const groundWalls = all.filter((w) => w.category === "wall" && !w.derived && onGroundStorey(pack, w.level));
  if (!groundWalls.length) return out;

  if (!floorBuildUpStated(doc)) {
    out.push({ kind: "build-up", message: "Floor build-up not stated; the DPC is taken at finished floor level." });
  }
  if (!foundationStorey(pack?.levels)) {
    out.push({ kind: "no-storey", message: "This template has no foundation storey, so no foundation walls were drawn." });
  } else if (!foundationWallSkuId(pack)) {
    out.push({ kind: "no-type", message: "This template has no foundation wall type, so no foundation walls were drawn." });
  }

  const label = (id) => {
    const wall = all.find((w) => w.id === id);
    return skuById(pack, wall?.sku)?.name || id;
  };
  for (const piece of all.filter((w) => w.derived && w.conflict)) {
    const tops = piece.conflict
      .map((c) => `${label(c.hostWallId)} at ${(c.top).toFixed(3)}`)
      .join(", ");
    out.push({
      kind: "conflict",
      id: piece.id,
      message: `Two walls on one line start at different heights (${tops}). The foundation wall under them, ${Math.round(piece.length * 1000)} mm long, stops at the higher one.`,
    });
  }

  const ngl = naturalGroundLevel(pack?.levels);
  if (ngl) {
    const floors = groundFloorsOf(doc, pack);
    const low = groundWalls
      .filter((w) => !w.baseAttach)
      .map((w) => ({ wall: w, dpc: unattachedBase(doc, pack, w, floors) }))
      .filter((row) => row.dpc - ngl.elevation < DPC_MIN_ABOVE_GROUND - 1e-6);
    if (low.length) {
      const lowest = Math.min(...low.map((row) => row.dpc));
      const where = [...new Set(low.map((row) => levelName(row.wall.level)))].join(", ");
      out.push({
        kind: "dpc",
        message: `DPC is less than 150 mm above the natural ground level. ${low.length} wall${low.length === 1 ? "" : "s"} on ${where}: lowest DPC ${lowest.toFixed(3)}, ${ngl.name || ngl.id} ${ngl.elevation.toFixed(3)}. Advisory only; the walls are not moved.`,
      });
    }
  }
  return out;
}

/** External walls are bounded by exactly one room. Needed by Part XA and Part O. */
export function isExternalWall(wall) {
  return !wall.shared && wall.roomIds.length <= 1;
}
