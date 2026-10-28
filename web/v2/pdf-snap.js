// Snap targets from a PDF page's vector linework.
//
// Pure functions only: given an operator list (pdf.js `fnArray`/`argsArray`,
// or the same ops by name for tests), this walks path construction, records
// stroked/filled segments in a coordinate space the caller chooses, then
// builds a grid index of endpoints and crossings. underlay.js supplies the
// live pdf.js OPS table and the page viewport transform so the points land
// in the same reference-pixel space as a sheet placement.
//
// Clip-only paths are ignored (they are masks, not ink). Text operators are
// skipped. Images are counted so a flattened page can say why it has nothing
// to snap to.

/** pdf.js 4.6 OPS numbers, used when the caller does not pass the live table. */
export const DEFAULT_OPS = {
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  paintXObject: 66,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
  constructPath: 91,
};

const IMAGE_OPS = new Set([
  66, 83, 84, 85, 86, 87, 88, 89, 90,
]);

const PAINT_OPS = new Set([20, 21, 22, 23, 24, 25, 26, 27]);
const CLIP_OPS = new Set([28, 29, 30]);
const CLOSE_THEN_PAINT = new Set([21, 26, 27]);

export const IDENTITY_CTM = [1, 0, 0, 1, 0, 0];

/** Default cell size in reference pixels (~5 mm on the paper at 150 dpi). */
export const SNAP_CELL_PX = 32;

/** Drop near-zero segments; keep everything a person could point at. */
export const MIN_SEG_LEN = 1e-4;

/** Crossings are only computed between segments longer than this (skips hatch ticks). */
export const MIN_INTERSECT_LEN = 2;

/** Dense Revit sheets (the Riverglen sections page) exceed 80k; keep walking. */
export const MAX_SEGMENTS = 120_000;
/** Crossing search is O(nearby pairs). Past this, endpoints still snap. */
export const MAX_INTERSECT_SEGS = 40_000;

/** Coalesce points that sit on the same quarter-pixel. */
export const POINT_QUANTUM = 0.25;

export function applyCtm(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function multiplyCtm(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * pdf.js PageViewport transform for an unrotated page: origin top-left,
 * +y down, `dpi` pixels per inch. Rotated pages should pass the live
 * `viewport.transform` instead.
 */
export function defaultPageTransform(widthPt, heightPt, dpi = 150) {
  const s = dpi / 72;
  return [s, 0, 0, -s, 0, heightPt * s];
}

function opCode(fn, ops) {
  if (typeof fn === "number") return fn;
  if (typeof fn === "string") return ops[fn] ?? -1;
  return -1;
}

function addSegment(segments, x1, y1, x2, y2) {
  if (segments.length >= MAX_SEGMENTS) return;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < MIN_SEG_LEN) return;
  segments.push({ x1, y1, x2, y2 });
}

function walkPathOps(opsList, args, start, apply, segments, ctm) {
  let i = start;
  const n = opsList.length;
  for (let k = 0; k < n; k++) {
    const op = opCode(opsList[k], DEFAULT_OPS);
    if (op === 13) { // moveTo
      const x = args[i];
      const y = args[i + 1];
      i += 2;
      apply.move(x, y, ctm);
    } else if (op === 14) { // lineTo
      const x = args[i];
      const y = args[i + 1];
      i += 2;
      apply.line(x, y, ctm, segments);
    } else if (op === 15) { // curveTo
      const x = args[i + 4];
      const y = args[i + 5];
      i += 6;
      apply.curveEnd(x, y, ctm);
    } else if (op === 16 || op === 17) { // curveTo2 / curveTo3
      const x = args[i + 2];
      const y = args[i + 3];
      i += 4;
      apply.curveEnd(x, y, ctm);
    } else if (op === 18) { // closePath
      apply.close(segments);
    } else if (op === 19) { // rectangle
      const x = args[i];
      const y = args[i + 1];
      const w = args[i + 2];
      const h = args[i + 3];
      i += 4;
      apply.rect(x, y, w, h, ctm, segments);
    }
  }
}

function makePathState() {
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let open = false;
  const pending = [];

  const pt = (x, y, ctm) => applyCtm(ctm, x, y);

  return {
    move(x, y, ctm) {
      const p = pt(x, y, ctm);
      cx = sx = p.x;
      cy = sy = p.y;
      open = true;
    },
    line(x, y, ctm, _segments) {
      const p = pt(x, y, ctm);
      if (open) pending.push({ x1: cx, y1: cy, x2: p.x, y2: p.y });
      else {
        sx = p.x;
        sy = p.y;
        open = true;
      }
      cx = p.x;
      cy = p.y;
    },
    curveEnd(x, y, ctm) {
      const p = pt(x, y, ctm);
      if (!open) {
        sx = p.x;
        sy = p.y;
        open = true;
      }
      cx = p.x;
      cy = p.y;
    },
    close(_segments) {
      if (!open) return;
      pending.push({ x1: cx, y1: cy, x2: sx, y2: sy });
      cx = sx;
      cy = sy;
    },
    rect(x, y, w, h, ctm, _segments) {
      const a = pt(x, y, ctm);
      const b = pt(x + w, y, ctm);
      const c = pt(x + w, y + h, ctm);
      const d = pt(x, y + h, ctm);
      pending.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      pending.push({ x1: b.x, y1: b.y, x2: c.x, y2: c.y });
      pending.push({ x1: c.x, y1: c.y, x2: d.x, y2: d.y });
      pending.push({ x1: d.x, y1: d.y, x2: a.x, y2: a.y });
      cx = sx = a.x;
      cy = sy = a.y;
      open = true;
    },
    commit(segments) {
      for (const s of pending) addSegment(segments, s.x1, s.y1, s.x2, s.y2);
      pending.length = 0;
      open = false;
    },
    discard() {
      pending.length = 0;
      open = false;
    },
  };
}

/**
 * Walk an operator list and return straight segments plus how many image
 * paints were seen. `options.ops` is a pdf.js OPS table; `options.baseCtm`
 * is the viewport transform (identity if omitted).
 */
export function extractPathSegments(fnArray, argsArray, options = {}) {
  const ops = options.ops || DEFAULT_OPS;
  const segments = [];
  let images = 0;
  let inText = false;
  const stack = [];
  let ctm = options.baseCtm ? options.baseCtm.slice() : IDENTITY_CTM.slice();
  const path = makePathState();

  const paint = (fn) => {
    if (CLOSE_THEN_PAINT.has(fn)) path.close(segments);
    path.commit(segments);
  };

  for (let i = 0; i < fnArray.length; i++) {
    if (segments.length >= MAX_SEGMENTS) break;
    const fn = opCode(fnArray[i], ops);
    const args = argsArray[i] || [];

    if (fn === ops.beginText || fn === 31) {
      inText = true;
      continue;
    }
    if (fn === ops.endText || fn === 32) {
      inText = false;
      continue;
    }
    if (inText) continue;

    if (IMAGE_OPS.has(fn)) {
      images += 1;
      continue;
    }

    if (fn === ops.save || fn === 10) {
      stack.push(ctm.slice());
      continue;
    }
    if (fn === ops.restore || fn === 11) {
      ctm = stack.pop() || (options.baseCtm ? options.baseCtm.slice() : IDENTITY_CTM.slice());
      continue;
    }
    if (fn === ops.transform || fn === 12) {
      if (args.length >= 6) ctm = multiplyCtm(ctm, args);
      continue;
    }
    if (fn === ops.paintFormXObjectBegin || fn === 74) {
      stack.push(ctm.slice());
      const matrix = Array.isArray(args[0]) && args[0].length === 6 ? args[0] : null;
      if (matrix) ctm = multiplyCtm(ctm, matrix);
      continue;
    }
    if (fn === ops.paintFormXObjectEnd || fn === 75) {
      ctm = stack.pop() || (options.baseCtm ? options.baseCtm.slice() : IDENTITY_CTM.slice());
      continue;
    }

    if (fn === ops.constructPath || fn === 91) {
      const subOps = args[0] || [];
      const subArgs = args[1] || [];
      walkPathOps(subOps, subArgs, 0, path, segments, ctm);
      continue;
    }

    if (fn === 13) path.move(args[0], args[1], ctm);
    else if (fn === 14) path.line(args[0], args[1], ctm, segments);
    else if (fn === 15) path.curveEnd(args[4], args[5], ctm);
    else if (fn === 16 || fn === 17) path.curveEnd(args[2], args[3], ctm);
    else if (fn === 18) path.close(segments);
    else if (fn === 19) path.rect(args[0], args[1], args[2], args[3], ctm, segments);
    else if (PAINT_OPS.has(fn)) paint(fn);
    else if (CLIP_OPS.has(fn)) path.discard();
  }

  return { segments, images };
}

/**
 * Crossing or T-junction of two finite segments. Endpoint-on-endpoint is
 * omitted (already an endpoint). Parallel / overlapping runs are omitted.
 */
export function segmentIntersection(a, b) {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-12) return null;
  const dx = b.x1 - a.x1;
  const dy = b.y1 - a.y1;
  const t = (dx * by - dy * bx) / denom;
  const u = (dx * ay - dy * ax) / denom;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  const tIn = t > eps && t < 1 - eps;
  const uIn = u > eps && u < 1 - eps;
  if (!tIn && !uIn) return null;
  return { x: a.x1 + t * ax, y: a.y1 + t * ay };
}

function cellKey(i, j) {
  return `${i},${j}`;
}

function insertSegCells(cells, seg, id, cellSize) {
  const minX = Math.min(seg.x1, seg.x2);
  const maxX = Math.max(seg.x1, seg.x2);
  const minY = Math.min(seg.y1, seg.y2);
  const maxY = Math.max(seg.y1, seg.y2);
  const i0 = Math.floor(minX / cellSize);
  const i1 = Math.floor(maxX / cellSize);
  const j0 = Math.floor(minY / cellSize);
  const j1 = Math.floor(maxY / cellSize);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = cellKey(i, j);
      let list = cells.get(k);
      if (!list) {
        list = [];
        cells.set(k, list);
      }
      list.push(id);
    }
  }
}

/** Intersections between segments that share a grid cell. */
export function collectIntersections(segments, cellSize = SNAP_CELL_PX) {
  if (segments.length > MAX_INTERSECT_SEGS) return [];
  const long = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= MIN_INTERSECT_LEN) long.push(s);
  }
  const cells = new Map();
  for (let i = 0; i < long.length; i++) insertSegCells(cells, long[i], i, cellSize);
  const seen = new Set();
  const points = [];
  for (const ids of cells.values()) {
    const uniq = ids.length > 1 ? [...new Set(ids)] : ids;
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) {
        const lo = uniq[a] < uniq[b] ? uniq[a] : uniq[b];
        const hi = uniq[a] < uniq[b] ? uniq[b] : uniq[a];
        const pair = `${lo}:${hi}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const hit = segmentIntersection(long[lo], long[hi]);
        if (hit) points.push({ x: hit.x, y: hit.y, kind: "intersection" });
      }
    }
  }
  return points;
}

export function dedupePoints(points, quantum = POINT_QUANTUM) {
  const seen = new Map();
  for (const p of points) {
    const k = `${Math.round(p.x / quantum)}:${Math.round(p.y / quantum)}`;
    if (!seen.has(k)) seen.set(k, p);
  }
  return [...seen.values()];
}

/** Uniform grid of snap points. `query` returns the nearest point inside `radius`, or null. */
export function buildPointIndex(points, cellSize = SNAP_CELL_PX) {
  const cells = new Map();
  for (const p of points) {
    const k = cellKey(Math.floor(p.x / cellSize), Math.floor(p.y / cellSize));
    let list = cells.get(k);
    if (!list) {
      list = [];
      cells.set(k, list);
    }
    list.push(p);
  }
  return {
    cellSize,
    size: points.length,
    query(x, y, radius) {
      if (!(radius > 0)) return null;
      const i0 = Math.floor((x - radius) / cellSize);
      const i1 = Math.floor((x + radius) / cellSize);
      const j0 = Math.floor((y - radius) / cellSize);
      const j1 = Math.floor((y + radius) / cellSize);
      let best = null;
      let bestD = radius;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = cells.get(cellKey(i, j));
          if (!list) continue;
          for (const p of list) {
            const d = Math.hypot(p.x - x, p.y - y);
            if (d <= bestD) {
              bestD = d;
              best = p;
            }
          }
        }
      }
      return best ? { x: best.x, y: best.y, kind: best.kind, dist: bestD } : null;
    },
  };
}

/**
 * Extract segments, gather endpoints and crossings, return a queryable index.
 * Coordinates are whatever the operator list used after `baseCtm`.
 */
export function buildLinework(fnArray, argsArray, options = {}) {
  const extracted = extractPathSegments(fnArray, argsArray, options);
  const endpoints = [];
  for (const s of extracted.segments) {
    endpoints.push({ x: s.x1, y: s.y1, kind: "endpoint" });
    endpoints.push({ x: s.x2, y: s.y2, kind: "endpoint" });
  }
  const crossings = collectIntersections(extracted.segments, options.cellSize ?? SNAP_CELL_PX);
  const points = dedupePoints([...endpoints, ...crossings], options.quantum ?? POINT_QUANTUM);
  return {
    segments: extracted.segments,
    points,
    images: extracted.images,
    index: buildPointIndex(points, options.cellSize ?? SNAP_CELL_PX),
    stats: {
      segments: extracted.segments.length,
      endpoints: points.filter((p) => p.kind === "endpoint").length,
      intersections: points.filter((p) => p.kind === "intersection").length,
      images: extracted.images,
    },
  };
}

export function snapLinework(linework, x, y, radius) {
  return linework?.index?.query(x, y, radius) ?? null;
}
