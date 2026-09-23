// Geometry primitives for the v2 core.
//
// Everything is metres in a right-handed 2D plan space (x east, y north).
// Polygons are arrays of [x, y] with no repeated closing point, wound
// counter-clockwise. Winding is normalised on entry so downstream code can rely
// on it for offsets and for which side of a wall faces a room.

export const EPS = 1e-6;
export const GRID = 0.1;
const KEY_DP = 4; // 0.1 mm keying tolerance

export function roundGrid(n, grid = GRID) {
  return Math.round(n / grid) * grid;
}

// --- display units ----------------------------------------------------
//
// Internally everything stays in metres (see header comment). The UI always
// shows lengths in millimetres, whole numbers, so these two functions are the
// single seam between "metres in memory" and "mm on screen / in inputs".

/** Metres -> a whole-mm display string, e.g. 3.005 -> "3005". No unit suffix. */
export function formatLengthMm(metres) {
  if (!Number.isFinite(metres)) return "";
  return String(Math.round(metres * 1000));
}

/**
 * A user-typed mm string -> metres, or `fallback` (metres) if it doesn't
 * parse to a usable positive number. Accepts a comma decimal separator and
 * ignores an accidental "mm" suffix so pasted values still work.
 */
export function parseLengthMm(raw, fallback) {
  const cleaned = String(raw ?? "").trim().replace(",", ".").replace(/mm$/i, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.001, n / 1000);
}

export function keyOf(n) {
  return Number(n.toFixed(KEY_DP));
}

export function almost(a, b, eps = EPS) {
  return Math.abs(a - b) <= eps;
}

// --- polygons -------------------------------------------------------------

export function signedArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function area(poly) {
  return Math.abs(signedArea(poly));
}

export function isCCW(poly) {
  return signedArea(poly) > 0;
}

export function normalizeWinding(poly) {
  return isCCW(poly) ? poly.slice() : poly.slice().reverse();
}

export function perimeter(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += Math.hypot(x2 - x1, y2 - y1);
  }
  return sum;
}

export function centroid(poly) {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    // Degenerate: fall back to the vertex mean so the UI still has a label point.
    const n = poly.length || 1;
    return [
      poly.reduce((s, p) => s + p[0], 0) / n,
      poly.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y)) {
      const xCross = xi + ((y - yi) / (yj - yi)) * (xj - xi);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Drop repeated and collinear vertices so wall derivation sees clean edges. */
export function simplify(poly, eps = 1e-9) {
  const pts = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPS) pts.push(p);
  }
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPS) pts.pop();
  }
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const cross = (cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0]);
    if (Math.abs(cross) > eps) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

export function rectPoly(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function polyEdges(poly) {
  const edges = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    edges.push({ a, b, index: i, length: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }
  return edges;
}

// --- segments -------------------------------------------------------------

export function segLength(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Heading of a directed segment, degrees from +X, in [0, 360). */
export function headingDeg(x1, y1, x2, y2) {
  let deg = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Liang–Barsky clip of a segment to an axis-aligned rectangle. Returns the
 * clipped endpoints, or null if the segment is entirely outside. Used to keep
 * an on-canvas length label on the visible part of a wall when zoomed in.
 */
export function clipSegToRect(x1, y1, x2, y2, xmin, ymin, xmax, ymax) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < EPS) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, x1 - xmin) || !clip(dx, xmax - x1)
    || !clip(-dy, y1 - ymin) || !clip(dy, ymax - y1)) {
    return null;
  }
  return {
    x1: x1 + t0 * dx,
    y1: y1 + t0 * dy,
    x2: x1 + t1 * dx,
    y2: y1 + t1 * dy,
  };
}

export function paramOnSeg(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  return ((px - x1) * dx + (py - y1) * dy) / len2;
}

export function distToSeg(x1, y1, x2, y2, px, py) {
  const t = Math.min(1, Math.max(0, paramOnSeg(x1, y1, x2, y2, px, py)));
  return Math.hypot(x1 + (x2 - x1) * t - px, y1 + (y2 - y1) * t - py);
}

export function segNormal(x1, y1, x2, y2, sign = 1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (-dy / len) * sign, y: (dx / len) * sign };
}

/**
 * Identity of the infinite line through a segment, direction-insensitive.
 * Two collinear segments pointing opposite ways get the same key, which is what
 * shared-wall detection needs. This is the generalisation of the old
 * splitAxis() coordinate key to arbitrary angles.
 */
export function lineKey(x1, y1, x2, y2) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  // Canonical direction: positive x, or positive y when vertical.
  if (dx < -EPS || (Math.abs(dx) <= EPS && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  // Perpendicular offset from the origin.
  const offset = x1 * dy - y1 * dx;
  return `${keyOf(dx)}|${keyOf(dy)}|${keyOf(offset)}`;
}

export function lineBasis(x1, y1, x2, y2) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  if (dx < -EPS || (Math.abs(dx) <= EPS && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  return { dx, dy };
}

/** Project a point onto a line basis, giving a 1D coordinate along the line. */
export function projectOnBasis(basis, x, y) {
  return x * basis.dx + y * basis.dy;
}

export function pointFromBasis(basis, s, offset) {
  // Inverse of projectOnBasis combined with the perpendicular offset used in
  // lineKey: p = s * dir + offset * perp, where perp = (dy, -dx).
  return [s * basis.dx + offset * basis.dy, s * basis.dy - offset * basis.dx];
}

export function offsetOf(basis, x, y) {
  return x * basis.dy - y * basis.dx;
}

// --- axis-aligned rectangle union ----------------------------------------

/**
 * Union a set of axis-aligned rects into one or more polygon rings.
 *
 * Uses a coordinate-grid decomposition: build the sorted set of distinct x and
 * y values, mark every cell covered by any rect, then trace the boundary by
 * cancelling shared cell edges. Robust for the L and T shapes the week-1 UI
 * produces, and it does not need a general polygon clipper.
 *
 * Returns an array of rings, each wound counter-clockwise.
 */
export function unionRects(rects) {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap((r) => [keyOf(r.x), keyOf(r.x + r.w)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [keyOf(r.y), keyOf(r.y + r.h)]))].sort((a, b) => a - b);

  const inside = (cx, cy) => rects.some((r) => cx > r.x - EPS && cx < r.x + r.w + EPS
    && cy > r.y - EPS && cy < r.y + r.h + EPS);

  // Collect boundary edges, directed so the filled cell is on the left (CCW).
  const edges = new Map();
  const addEdge = (ax, ay, bx, by) => {
    edges.set(`${keyOf(ax)},${keyOf(ay)}->${keyOf(bx)},${keyOf(by)}`, [[ax, ay], [bx, by]]);
  };

  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      if (!inside(cx, cy)) continue;
      // South neighbour
      if (j === 0 || !inside(cx, (ys[j - 1] + y0) / 2)) addEdge(x0, y0, x1, y0);
      // East neighbour
      if (i === xs.length - 2 || !inside((x1 + xs[i + 2]) / 2, cy)) addEdge(x1, y0, x1, y1);
      // North neighbour
      if (j === ys.length - 2 || !inside(cx, (y1 + ys[j + 2]) / 2)) addEdge(x1, y1, x0, y1);
      // West neighbour
      if (i === 0 || !inside((xs[i - 1] + x0) / 2, cy)) addEdge(x0, y1, x0, y0);
    }
  }

  // Stitch directed edges into rings.
  const byStart = new Map();
  for (const [a, b] of edges.values()) {
    const k = `${keyOf(a[0])},${keyOf(a[1])}`;
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(b);
  }

  const rings = [];
  const used = new Set();
  for (const [a, b] of edges.values()) {
    const startKey = `${keyOf(a[0])},${keyOf(a[1])}->${keyOf(b[0])},${keyOf(b[1])}`;
    if (used.has(startKey)) continue;
    const ring = [a];
    let cur = a;
    let next = b;
    let guard = 0;
    while (guard < 100000) {
      guard += 1;
      used.add(`${keyOf(cur[0])},${keyOf(cur[1])}->${keyOf(next[0])},${keyOf(next[1])}`);
      if (Math.hypot(next[0] - a[0], next[1] - a[1]) <= EPS) break;
      ring.push(next);
      const outs = byStart.get(`${keyOf(next[0])},${keyOf(next[1])}`) || [];
      const pick = outs.find((cand) => !used.has(
        `${keyOf(next[0])},${keyOf(next[1])}->${keyOf(cand[0])},${keyOf(cand[1])}`,
      ));
      if (!pick) break;
      cur = next;
      next = pick;
    }
    const clean = simplify(ring);
    if (clean.length >= 3 && area(clean) > EPS) rings.push(normalizeWinding(clean));
  }
  return rings;
}

/** Convenience: union rects and return only the largest ring. */
export function unionRectsOuter(rects) {
  const rings = unionRects(rects);
  if (!rings.length) return [];
  return rings.reduce((best, r) => (area(r) > area(best) ? r : best), rings[0]);
}

/** Intersection of two infinite lines, each given as a point plus a direction. Returns null if parallel. */
function intersectLines(p1, d1, p2, d2) {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

/**
 * Uniform inward offset of a simple polygon, for deriving a building line a
 * fixed setback inside a property line.
 *
 * Each edge is pushed inward along its normal by `distance`, then each new
 * vertex is the intersection of the two offset lines either side of it -
 * exact for a convex polygon, and for the mild concavity an erf boundary
 * ordinarily has. It is not a general polygon offset (self-intersecting
 * "bowtie" results from a sharp concave notch or an oversized distance are
 * not detected beyond the checks below), so a null return - the offset
 * degenerates the shape - must fall back to a manually drawn building line,
 * never a silently wrong one.
 */
export function offsetPolygonInward(poly, distance) {
  const ccw = normalizeWinding(simplify(poly));
  if (ccw.length < 3) return null;
  if (distance <= 0) return ccw;

  // A neighbour-line-intersection offset cannot detect a shape folding all
  // the way through its own centre (a symmetric square offset past half its
  // side still comes out CCW with a positive area - just the wrong, mirrored
  // square). A distance at or past half the shape's narrower bounding-box
  // extent is refused here, before that can happen, rather than trusting the
  // winding/area check below to catch every failure mode.
  const box = bbox(ccw);
  if (2 * distance >= Math.min(box.w, box.h)) return null;

  const lines = polyEdges(ccw).map(({ a, b }) => {
    const n = segNormal(a[0], a[1], b[0], b[1], 1);
    return { p: [a[0] + n.x * distance, a[1] + n.y * distance], d: [b[0] - a[0], b[1] - a[1]] };
  });

  const n = lines.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const pt = intersectLines(prev.p, prev.d, cur.p, cur.d);
    if (!pt) return null; // adjacent edges parallel: offset lines never meet
    out.push(pt);
  }

  const clean = simplify(out);
  // A collapsed or inverted result means `distance` ate through the shape.
  if (clean.length < 3 || !isCCW(clean) || area(clean) < EPS) return null;
  return clean;
}
