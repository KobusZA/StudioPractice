// The room inside drawn walls and separation lines.
//
// A room that carries `bound` and a `seed` takes its outline from the walls
// (and Build > Rooms > Separate lines) that enclose that point, and takes
// it again whenever those walls move. The outline is the inner face: each
// wall edge steps in by half that wall's thickness, and a separation line
// stays where it was drawn because it has no thickness.
//
// This reads `doc.segments` directly. It does not call deriveWalls(), which
// itself reads room polygons — doing both would be a circle. A room with no
// enclosing loop keeps the polygon the user drew.

import {
  EPS,
  area,
  fitPolygonToHost,
  normalizeWinding,
  pointInPoly,
  segNormal,
  signedArea,
  simplify,
} from "./geom.js";
import { effectiveLevel, roomPolygon, shapePolygon } from "./model.js";
import { CORNER_JOIN_TOL, drawnWallThickness } from "./walls.js";

const WELD = 0.001;
// Against and Past stop a centreline on the other wall's face, half a
// thickness short of its centreline. The same slack wall-join.js uses when
// it decides a point is still on that footprint.
const FACE_SLACK = 0.01;
// A hover just outside one room's own walls still belongs to that room.
// Farther out, including the space between two rooms, there is nothing to report.
const CLUSTER_PAD = 0.3;

function skuById(pack, id) {
  return pack?.skus?.find((s) => s.id === id) || null;
}

function weldKey(x, y) {
  return `${Math.round(x / WELD)}:${Math.round(y / WELD)}`;
}

function intersectLines(p1, d1, p2, d2) {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

/** Parameter of (px, py) along segment s, or null when it is not on the segment. */
function paramOn(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return null;
  const t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  if (t < -1e-6 || t > 1 + 1e-6) return null;
  const qx = s.x1 + t * dx;
  const qy = s.y1 + t * dy;
  if (Math.hypot(px - qx, py - qy) > 0.002) return null;
  return Math.min(1, Math.max(0, t));
}

function properHit(a, b) {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1;
  const sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const rpx = b.x1 - a.x1;
  const rpy = b.y1 - a.y1;
  const t = (rpx * sy - rpy * sx) / den;
  const u = (rpx * ry - rpy * rx) / den;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return { t, u };
}

function boundarySegments(doc, pack, level) {
  const out = [];
  for (const seg of doc?.segments || []) {
    if (effectiveLevel(seg, pack) !== level) continue;
    const sku = skuById(pack, seg.sku);
    if (!sku) continue;
    if (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) < EPS) continue;
    out.push({
      x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
      thickness: drawnWallThickness(sku),
    });
  }
  for (const seg of doc?.separations || []) {
    if (effectiveLevel(seg, pack) !== level) continue;
    if (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) < EPS) continue;
    out.push({ x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, thickness: 0 });
  }
  // Endpoints a few millimetres apart are one corner. A face join, where the
  // centreline stops on the other wall's face, is extended to that centreline
  // so the room closes on the same corner the walls already draw.
  return extendFaceJoins(closeCorners(out));
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/** Where the ray from (px, py) along (ux, uy) meets `seg`, or null. */
function outwardHit(px, py, ux, uy, seg) {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const den = cross(ux, uy, sx, sy);
  if (Math.abs(den) < 1e-9) return null;
  const apx = seg.x1 - px;
  const apy = seg.y1 - py;
  const dist = cross(apx, apy, sx, sy) / den;
  const u = cross(apx, apy, ux, uy) / den;
  if (u < -1e-4 || u > 1 + 1e-4) return null;
  return { dist, x: px + ux * dist, y: py + uy * dist };
}

/**
 * Carry a centreline that stops on another wall's face out to that wall's
 * centreline. The painted corner already meets; the room measures the inner
 * face of the loop this makes. A real gap, wider than half the wall, stays open.
 */
function extendFaceJoins(segments) {
  if (segments.length < 2) return segments;
  const moves = [];
  segments.forEach((seg, i) => {
    for (const end of [1, 2]) {
      const px = end === 1 ? seg.x1 : seg.x2;
      const py = end === 1 ? seg.y1 : seg.y2;
      const ox = end === 1 ? seg.x2 : seg.x1;
      const oy = end === 1 ? seg.y2 : seg.y1;
      const len = Math.hypot(px - ox, py - oy);
      if (len < 1e-9) continue;
      const ux = (px - ox) / len;
      const uy = (py - oy) / len;
      let best = null;
      for (let j = 0; j < segments.length; j += 1) {
        if (j === i) continue;
        const hit = outwardHit(px, py, ux, uy, segments[j]);
        if (!hit) continue;
        const limit = (segments[j].thickness || 0) / 2 + FACE_SLACK;
        if (hit.dist <= 0.002 || hit.dist > limit) continue;
        if (!best || hit.dist < best.dist) best = hit;
      }
      if (best) moves.push({ i, end, x: best.x, y: best.y });
    }
  });
  if (!moves.length) return segments;
  const out = segments.map((seg) => ({ ...seg }));
  for (const move of moves) {
    const seg = out[move.i];
    if (move.end === 1) {
      seg.x1 = move.x;
      seg.y1 = move.y;
    } else {
      seg.x2 = move.x;
      seg.y2 = move.y;
    }
  }
  return out.filter((seg) => Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) >= EPS);
}

/** Pull endpoints within the wall-join tolerance onto one shared point. */
function closeCorners(segments) {
  const n = segments.length;
  if (n < 2) return segments;
  const xs = new Array(n * 2);
  const ys = new Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    xs[i * 2] = segments[i].x1;
    ys[i * 2] = segments[i].y1;
    xs[i * 2 + 1] = segments[i].x2;
    ys[i * 2 + 1] = segments[i].y2;
  }
  const parent = xs.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const tol2 = CORNER_JOIN_TOL * CORNER_JOIN_TOL;
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const dx = xs[i] - xs[j];
      const dy = ys[i] - ys[j];
      if (dx * dx + dy * dy <= tol2) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < xs.length; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const ax = xs.slice();
  const ay = ys.slice();
  let changed = false;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let sx = 0;
    let sy = 0;
    for (const i of members) {
      sx += xs[i];
      sy += ys[i];
    }
    const x = sx / members.length;
    const y = sy / members.length;
    for (const i of members) {
      if (ax[i] !== x || ay[i] !== y) changed = true;
      ax[i] = x;
      ay[i] = y;
    }
  }
  if (!changed) return segments;
  return segments.map((seg, i) => ({
    ...seg,
    x1: ax[i * 2],
    y1: ay[i * 2],
    x2: ax[i * 2 + 1],
    y2: ay[i * 2 + 1],
  }));
}

/** Split every segment where another crosses it or ends on it. */
function splitAll(segments) {
  const cuts = segments.map(() => [0, 1]);
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const hit = properHit(segments[i], segments[j]);
      if (hit) {
        cuts[i].push(hit.t);
        cuts[j].push(hit.u);
        continue;
      }
      for (const [px, py] of [[segments[j].x1, segments[j].y1], [segments[j].x2, segments[j].y2]]) {
        const t = paramOn(px, py, segments[i]);
        if (t != null) cuts[i].push(t);
      }
      for (const [px, py] of [[segments[i].x1, segments[i].y1], [segments[i].x2, segments[i].y2]]) {
        const t = paramOn(px, py, segments[j]);
        if (t != null) cuts[j].push(t);
      }
    }
  }
  const pieces = [];
  segments.forEach((seg, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(Math.min(1, Math.max(0, t)) * 1e6) / 1e6))]
      .sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k += 1) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 < 1e-6) continue;
      const at = (t) => [seg.x1 + (seg.x2 - seg.x1) * t, seg.y1 + (seg.y2 - seg.y1) * t];
      const a = at(t0);
      const b = at(t1);
      pieces.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], thickness: seg.thickness });
    }
  });
  return pieces;
}

function insetFace(poly, distances) {
  const ccw = normalizeWinding(simplify(poly));
  if (ccw.length < 3) return null;
  if (distances.every((d) => !(d > 0))) return ccw;
  const lines = [];
  for (let i = 0; i < ccw.length; i += 1) {
    const a = ccw[i];
    const b = ccw[(i + 1) % ccw.length];
    const n = segNormal(a[0], a[1], b[0], b[1], 1);
    const d = distances[i] > 0 ? distances[i] : 0;
    lines.push({
      p: [a[0] + n.x * d, a[1] + n.y * d],
      dir: [b[0] - a[0], b[1] - a[1]],
    });
  }
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cur = lines[i];
    const pt = intersectLines(prev.p, prev.dir, cur.p, cur.dir);
    if (!pt) return ccw;
    out.push(pt);
  }
  const clean = simplify(out);
  if (clean.length < 3 || signedArea(clean) <= EPS) return ccw;
  return normalizeWinding(clean);
}

/**
 * Every closed walk of the wall graph on `level`. A left turn keeps the
 * interior on the left, so a room is counter-clockwise (positive area) and
 * the outside of the building is clockwise (negative area).
 */
function closedFaces(doc, pack, level) {
  const pieces = splitAll(boundarySegments(doc, pack, level));
  if (pieces.length < 3) return [];

  const weld = new Map();
  const at = (px, py) => {
    const k = weldKey(px, py);
    if (!weld.has(k)) weld.set(k, [px, py]);
    return { k, p: weld.get(k) };
  };

  const outgoing = new Map();
  const directed = [];
  let seq = 0;
  const seen = new Set();
  for (const piece of pieces) {
    const a = at(piece.x1, piece.y1);
    const b = at(piece.x2, piece.y2);
    if (a.k === b.k) continue;
    const undirected = a.k < b.k ? `${a.k}|${b.k}` : `${b.k}|${a.k}`;
    if (seen.has(undirected)) continue;
    seen.add(undirected);
    for (const [from, to] of [[a, b], [b, a]]) {
      const edge = {
        id: seq,
        from: from.k,
        to: to.k,
        x1: from.p[0],
        y1: from.p[1],
        x2: to.p[0],
        y2: to.p[1],
        ang: Math.atan2(to.p[1] - from.p[1], to.p[0] - from.p[0]),
        thickness: piece.thickness,
      };
      seq += 1;
      directed.push(edge);
      if (!outgoing.has(from.k)) outgoing.set(from.k, []);
      outgoing.get(from.k).push(edge);
    }
  }

  const nextAfter = (arrival) => {
    const outs = outgoing.get(arrival.to);
    if (!outs?.length) return null;
    // The next edge clockwise from the way we came is the sharpest left turn,
    // which walks the interior with the room on the left.
    const back = Math.atan2(arrival.y1 - arrival.y2, arrival.x1 - arrival.x2);
    let best = null;
    let bestDelta = Infinity;
    for (const edge of outs) {
      let delta = back - edge.ang;
      while (delta <= 1e-9) delta += Math.PI * 2;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = edge;
      }
    }
    return best;
  };

  const used = new Set();
  const faces = [];
  for (const start of directed) {
    if (used.has(start.id)) continue;
    const poly = [];
    const distances = [];
    let cur = start;
    let guard = 0;
    let closed = false;
    do {
      if (used.has(cur.id) && cur !== start) break;
      used.add(cur.id);
      poly.push([cur.x1, cur.y1]);
      distances.push((cur.thickness || 0) / 2);
      const nxt = nextAfter(cur);
      if (!nxt) break;
      if (nxt.id === start.id) {
        closed = true;
        break;
      }
      cur = nxt;
      guard += 1;
    } while (guard < directed.length + 1);
    if (!closed || poly.length < 3) continue;
    const signed = signedArea(poly);
    if (Math.abs(signed) <= EPS) continue;
    faces.push({ poly, distances, signed });
  }
  return faces;
}

/** Counter-clockwise ring, with each edge still carrying its own inset. */
function ccwFace(face) {
  if (face.signed >= 0) return { poly: face.poly, distances: face.distances };
  const n = face.poly.length;
  const poly = face.poly.slice().reverse();
  const distances = poly.map((_, k) => face.distances[(n - 2 - k + n) % n]);
  return { poly, distances };
}

/**
 * The inner face of one closed walk. `which` is "room" (smallest room around
 * the point) or "footprint" (the external walls around the point).
 */
function faceAround(faces, x, y, which) {
  let best = null;
  let bestArea = Infinity;
  for (const face of faces) {
    const ring = which === "footprint"
      ? (face.signed < -EPS ? ccwFace(face) : null)
      : (face.signed > EPS ? face : null);
    if (!ring || !pointInPoly(x, y, ring.poly)) continue;
    const span = Math.abs(face.signed);
    if (span < bestArea) {
      bestArea = span;
      best = ring;
    }
  }
  if (!best) return null;
  return insetFace(best.poly, best.distances);
}

/**
 * The inner face of the smallest loop of walls and separation lines that
 * contains (x, y) on `level`. Null when the point is not enclosed.
 */
export function enclosedFace(doc, pack, level, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return faceAround(closedFaces(doc, pack, level), x, y, "room");
}

/**
 * The inner face of the external walls around (x, y). An internal wall is
 * not part of this outline. Null when the point is not inside a closed building.
 */
export function footprintFace(doc, pack, level, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return faceAround(closedFaces(doc, pack, level), x, y, "footprint");
}

/**
 * True when (x, y) sits inside one run of walls that does not close.
 * A second, separate room is its own run: a gap there does not speak for this one.
 */
function pointInOpenCluster(segments, x, y) {
  const pieces = splitAll(segments);
  if (!pieces.length) return false;
  const weld = new Map();
  const at = (px, py) => {
    const k = weldKey(px, py);
    if (!weld.has(k)) weld.set(k, [px, py]);
    return k;
  };
  const degree = new Map();
  const vertexPieces = new Map();
  const seen = new Set();
  const parent = pieces.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  pieces.forEach((piece, i) => {
    const a = at(piece.x1, piece.y1);
    const b = at(piece.x2, piece.y2);
    if (a === b) return;
    const undirected = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(undirected)) return;
    seen.add(undirected);
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
    for (const key of [a, b]) {
      if (!vertexPieces.has(key)) vertexPieces.set(key, []);
      vertexPieces.get(key).push(i);
    }
  });
  for (const ids of vertexPieces.values()) {
    for (let k = 1; k < ids.length; k += 1) union(ids[0], ids[k]);
  }
  const clusters = new Map();
  pieces.forEach((piece, i) => {
    const a = at(piece.x1, piece.y1);
    const b = at(piece.x2, piece.y2);
    if (a === b) return;
    const root = find(i);
    if (!clusters.has(root)) {
      clusters.set(root, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, open: false });
    }
    const cluster = clusters.get(root);
    cluster.minX = Math.min(cluster.minX, piece.x1, piece.x2);
    cluster.minY = Math.min(cluster.minY, piece.y1, piece.y2);
    cluster.maxX = Math.max(cluster.maxX, piece.x1, piece.x2);
    cluster.maxY = Math.max(cluster.maxY, piece.y1, piece.y2);
    if (degree.get(a) === 1 || degree.get(b) === 1) cluster.open = true;
  });
  let bestArea = Infinity;
  let hit = false;
  for (const cluster of clusters.values()) {
    if (!cluster.open) continue;
    if (x < cluster.minX - CLUSTER_PAD || x > cluster.maxX + CLUSTER_PAD
      || y < cluster.minY - CLUSTER_PAD || y > cluster.maxY + CLUSTER_PAD) continue;
    const span = (cluster.maxX - cluster.minX) * (cluster.maxY - cluster.minY);
    if (span < bestArea) {
      bestArea = span;
      hit = true;
    }
  }
  return hit;
}

function roomCoversPoint(doc, pack, level, x, y) {
  for (const room of doc?.rooms || []) {
    if (effectiveLevel(room, pack) !== level) continue;
    const poly = roomPolygon(room);
    if (poly.length >= 3 && pointInPoly(x, y, poly)) return true;
  }
  return false;
}

/**
 * What the plan can say about the space under a point, before any room is placed.
 * `enclosed` is the inner face and its area. `occupied` means a room already
 * covers the point, so the room tag is the label. `open` means the pointer is
 * inside one run of walls that does not close. `empty` means there is nothing to report.
 */
export function spaceAt(doc, pack, level, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: "empty" };
  const face = enclosedFace(doc, pack, level, x, y);
  if (face && face.length >= 3) {
    return {
      kind: "enclosed",
      poly: face,
      area: area(face),
      occupied: roomCoversPoint(doc, pack, level, x, y),
    };
  }
  const segments = boundarySegments(doc, pack, level);
  if (pointInOpenCluster(segments, x, y)) return { kind: "open" };
  return { kind: "empty" };
}

/** Drop the wall link so the stored outline is the one the user edits. */
export function clearShapeLink(obj) {
  if (!obj) return;
  obj.bound = false;
  obj.link = null;
  obj.seed = null;
}

function writeFace(obj, face) {
  if (!face || face.length < 3) return false;
  const prev = obj.shape?.kind === "poly" ? obj.shape.points : null;
  const same = prev && prev.length === face.length
    && face.every((p, i) => Math.abs(p[0] - prev[i][0]) < 1e-4 && Math.abs(p[1] - prev[i][1]) < 1e-4);
  if (same) return false;
  obj.shape = { kind: "poly", points: face };
  return true;
}

/** A finish drawn on part of a slab stays inside the slab after the walls move it. */
function trimSlabFinishes(doc, slab) {
  const host = shapePolygon(slab.shape);
  if (host.length < 3) return;
  for (const region of doc.finishRegions || []) {
    if (region.whole || region.slabId !== slab.id) continue;
    const poly = shapePolygon(region.shape);
    const fitted = fitPolygonToHost(poly, host);
    if (!fitted || fitted.length < 3 || fitted === poly) continue;
    region.shape = { kind: "poly", points: fitted.map((p) => [p[0], p[1]]) };
  }
}

/**
 * Rewrite each linked outline from the walls around its seed.
 * A room, and a floor linked to a room, uses the smallest enclosing face.
 * A floor or roof linked to the footprint uses the external walls.
 * Returns true when an outline changed.
 */
export function syncRoomBounds(doc, pack) {
  if (!doc || !pack) return false;
  const cache = new Map();
  const facesOf = (obj) => {
    const level = effectiveLevel(obj, pack);
    if (!cache.has(level)) cache.set(level, closedFaces(doc, pack, level));
    return cache.get(level);
  };
  let changed = false;
  for (const room of doc.rooms || []) {
    if (!room.bound || !room.seed) continue;
    if (writeFace(room, faceAround(facesOf(room), room.seed.x, room.seed.y, "room"))) changed = true;
  }
  for (const row of [...(doc.slabs || []), ...(doc.roofs || [])]) {
    if (!row.bound || !row.seed) continue;
    if (row.link !== "room" && row.link !== "footprint") continue;
    const which = row.link === "footprint" ? "footprint" : "room";
    if (!writeFace(row, faceAround(facesOf(row), row.seed.x, row.seed.y, which))) continue;
    changed = true;
    if (row.link && doc.slabs?.includes(row)) trimSlabFinishes(doc, row);
  }
  return changed;
}
