// The room inside drawn walls and separation lines.
//
// A room that carries `bound` and a `seed` takes its outline from the walls
// (and Document > Rooms > Separate lines) that enclose that point, and takes
// it again whenever those walls move. The outline is the inner face: each
// wall edge steps in by half that wall's thickness, and a separation line
// stays where it was drawn because it has no thickness.
//
// This reads `doc.segments` directly. It does not call deriveWalls(), which
// itself reads room polygons — doing both would be a circle. A room with no
// enclosing loop keeps the polygon the user drew.

import {
  EPS,
  normalizeWinding,
  pointInPoly,
  segNormal,
  signedArea,
  simplify,
} from "./geom.js";
import { effectiveLevel } from "./model.js";
import { drawnWallThickness } from "./walls.js";

const WELD = 0.001;

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
  return out;
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
 * The inner face of the smallest loop of walls and separation lines that
 * contains (x, y) on `level`. Null when the point is not enclosed.
 */
export function enclosedFace(doc, pack, level, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pieces = splitAll(boundarySegments(doc, pack, level));
  if (pieces.length < 3) return null;

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
  let best = null;
  let bestArea = Infinity;
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
    const area = signedArea(poly);
    if (area <= EPS) continue;
    if (!pointInPoly(x, y, poly)) continue;
    if (area < bestArea) {
      bestArea = area;
      best = { poly, distances };
    }
  }
  if (!best) return null;
  return insetFace(best.poly, best.distances);
}

/** Rewrite each bound room's polygon from the walls around its seed. */
export function syncRoomBounds(doc, pack) {
  if (!doc || !pack) return;
  for (const room of doc.rooms || []) {
    if (!room.bound || !room.seed) continue;
    const level = effectiveLevel(room, pack);
    const face = enclosedFace(doc, pack, level, room.seed.x, room.seed.y);
    if (!face || face.length < 3) continue;
    const prev = room.shape?.kind === "poly" ? room.shape.points : null;
    const same = prev && prev.length === face.length
      && face.every((p, i) => Math.abs(p[0] - prev[i][0]) < 1e-4 && Math.abs(p[1] - prev[i][1]) < 1e-4);
    if (!same) room.shape = { kind: "poly", points: face };
  }
}
