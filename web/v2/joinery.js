// Joinery the Revit template does not contain. Same pattern as a plain
// opening and a boundary wall: stated here, millimetre geometry, copied into
// the pack. A run sits on a wall face (BIC, kitchen units). An island and
// loose furniture is a free plan symbol.
//
// SANS 10143: simplified outline, wall side on the wall, floor-standing solid,
// wall-hung dashed. SANS 10400-A: timber colour class. BIC is not a finish —
// finishes occupy the remaining face (the mosaic above the cupboards).

import { pointInPoly } from "./geom.js";
import { pointOnWall, wallNormal, wallT, distToWall, wallSnapDist, swingToward } from "./openings.js";
import { deriveWalls } from "./walls.js";
import { snapNiceDelta } from "./snap.js";

const MIN_RUN_M = 0.3;

function joinery(id, name, family, category, geometry, drawing, extra = {}) {
  return {
    id,
    name,
    family,
    category,
    unit: extra.unit || "ea",
    draw: "box",
    revit: { category: category === "furniture" ? "Furniture" : "Casework", family, type: name, placedCount: 0 },
    geometry,
    cost: { rateRef: null, wasteFactor: null },
    compliance: {},
    drawing: {
      colourClass: category === "furniture" ? "other" : "timber",
      hatch: null,
      symbol: drawing.symbol,
      plan: drawing.plan || null,
      mount: drawing.mount,
      fullHeight: drawing.fullHeight || false,
    },
    schedule: { report: extra.report || (drawing.mount === "free" ? ["count"] : ["count", "length"]), scheduleName: null },
  };
}

export const JOINERY_SKUS = [
  joinery("TSP_CAS_BIC", "Built-in cupboard", "Joinery", "casework", { width: 900, depth: 600, height: 2400 }, { symbol: "BIC", mount: "floor", fullHeight: true }),
  joinery("TSP_CAS_LINEN", "Linen cupboard", "Joinery", "casework", { width: 600, depth: 600, height: 2400 }, { symbol: "LINEN", mount: "floor", fullHeight: true }),
  joinery("TSP_CAS_PANTRY", "Pantry", "Joinery", "casework", { width: 600, depth: 600, height: 2400 }, { symbol: "PANTRY", mount: "floor", fullHeight: true }),
  joinery("TSP_CAS_KU_BASE", "Kitchen base unit", "Joinery", "casework", { width: 600, depth: 600, height: 900 }, { symbol: "KU", mount: "floor" }),
  joinery("TSP_CAS_KU_WALL", "Kitchen wall unit", "Joinery", "casework", { width: 600, depth: 330, height: 720, sill: 1500 }, { symbol: "KU", mount: "wall" }),
  joinery("TSP_CAS_KU_ISLAND", "Kitchen island", "Joinery", "casework", { width: 1200, depth: 600, height: 900 }, { symbol: "ISLAND", mount: "free" }),
  joinery("TSP_CAS_VANITY", "Vanity", "Joinery", "casework", { width: 900, depth: 450, height: 850 }, { symbol: "VANITY", mount: "floor" }),
  joinery("TSP_CAS_DESK", "Built-in desk", "Joinery", "casework", { width: 1200, depth: 600, height: 750 }, { symbol: "DESK", mount: "floor" }),
  joinery("TSP_FUR_BED_SINGLE", "Bed, single", "Furniture", "furniture", { width: 920, depth: 1900, height: 500 }, { symbol: "BED", plan: "bed", mount: "free" }),
  joinery("TSP_FUR_BED_DOUBLE", "Bed, double", "Furniture", "furniture", { width: 1370, depth: 1900, height: 500 }, { symbol: "BED", plan: "bed", mount: "free" }),
  joinery("TSP_FUR_BED_QUEEN", "Bed, queen", "Furniture", "furniture", { width: 1600, depth: 2000, height: 500 }, { symbol: "BED", plan: "bed", mount: "free" }),
  joinery("TSP_FUR_BED_KING", "Bed, king", "Furniture", "furniture", { width: 1830, depth: 2000, height: 500 }, { symbol: "BED", plan: "bed", mount: "free" }),
  joinery("TSP_FUR_BEDSIDE", "Bedside table", "Furniture", "furniture", { width: 450, depth: 400, height: 550 }, { symbol: "BEDSIDE", plan: "bedside", mount: "free" }),
  joinery("TSP_FUR_SOFA_2", "Sofa, 2-seat", "Furniture", "furniture", { width: 1600, depth: 900, height: 850 }, { symbol: "SOFA", plan: "sofa-2", mount: "free" }),
  joinery("TSP_FUR_SOFA", "Sofa, 3-seat", "Furniture", "furniture", { width: 2000, depth: 900, height: 850 }, { symbol: "SOFA", plan: "sofa-3", mount: "free" }),
  joinery("TSP_FUR_ARMCHAIR", "Armchair", "Furniture", "furniture", { width: 850, depth: 900, height: 850 }, { symbol: "CHAIR", plan: "armchair", mount: "free" }),
  joinery("TSP_FUR_COFFEE", "Coffee table", "Furniture", "furniture", { width: 1200, depth: 600, height: 420 }, { symbol: "TABLE", plan: "coffee", mount: "free" }),
  joinery("TSP_FUR_TV", "TV unit", "Furniture", "furniture", { width: 1800, depth: 450, height: 500 }, { symbol: "TV", plan: "tv", mount: "free" }),
  joinery("TSP_FUR_TABLE_4", "Dining table, 4-seat", "Furniture", "furniture", { width: 2200, depth: 1800, height: 750 }, { symbol: "TABLE", plan: "dining-4", mount: "free" }),
  joinery("TSP_FUR_TABLE", "Dining table, 6-seat", "Furniture", "furniture", { width: 2600, depth: 1900, height: 750 }, { symbol: "TABLE", plan: "dining-6", mount: "free" }),
  joinery("TSP_FUR_TABLE_8", "Dining table, 8-seat", "Furniture", "furniture", { width: 3100, depth: 1900, height: 750 }, { symbol: "TABLE", plan: "dining-8", mount: "free" }),
  joinery("TSP_FUR_DESK", "Desk", "Furniture", "furniture", { width: 1400, depth: 1200, height: 750 }, { symbol: "DESK", plan: "desk", mount: "free" }),
  joinery("TSP_FUR_CHAIR", "Chair", "Furniture", "furniture", { width: 500, depth: 560, height: 850 }, { symbol: "CHAIR", plan: "chair", mount: "free" }),
  joinery("TSP_FUR_FRIDGE", "Fridge", "Furniture", "furniture", { width: 700, depth: 700, height: 1800 }, { symbol: "FRIDGE", plan: "fridge", mount: "free" }),
  joinery("TSP_FUR_STOVE", "Stove", "Furniture", "furniture", { width: 600, depth: 600, height: 900 }, { symbol: "STOVE", plan: "stove", mount: "free" }),
  joinery("TSP_FUR_RUG_SQ_15", "Rug, square, 1.5 m", "Furniture", "furniture", { width: 1500, depth: 1500, height: 15 }, { symbol: "RUG", plan: "carpet-square", mount: "free" }),
  joinery("TSP_FUR_RUG_SQ_24", "Rug, square, 2.4 m", "Furniture", "furniture", { width: 2400, depth: 2400, height: 15 }, { symbol: "RUG", plan: "carpet-square", mount: "free" }),
  joinery("TSP_FUR_RUG_SQ_30", "Rug, square, 3 m", "Furniture", "furniture", { width: 3000, depth: 3000, height: 15 }, { symbol: "RUG", plan: "carpet-square", mount: "free" }),
  joinery("TSP_FUR_RUG_RD_12", "Rug, round, 1.2 m", "Furniture", "furniture", { width: 1200, depth: 1200, height: 15 }, { symbol: "RUG", plan: "carpet-round", mount: "free" }),
  joinery("TSP_FUR_RUG_RD_18", "Rug, round, 1.8 m", "Furniture", "furniture", { width: 1800, depth: 1800, height: 15 }, { symbol: "RUG", plan: "carpet-round", mount: "free" }),
  joinery("TSP_FUR_RUG_RD_24", "Rug, round, 2.4 m", "Furniture", "furniture", { width: 2400, depth: 2400, height: 15 }, { symbol: "RUG", plan: "carpet-round", mount: "free" }),
];

/** Copy missing joinery types onto a pack. Geometry stays millimetres. */
export function mergeJoinerySkus(pack) {
  if (!pack || !Array.isArray(pack.skus)) return pack;
  const have = new Set(pack.skus.map((s) => s.id));
  const extra = JOINERY_SKUS.filter((sku) => !have.has(sku.id)).map((sku) => structuredClone(sku));
  if (!extra.length) return pack;
  return { ...pack, skus: [...pack.skus, ...extra] };
}

export function joineryMount(sku) {
  const mount = sku?.drawing?.mount;
  if (mount === "wall" || mount === "floor" || mount === "free") return mount;
  return null;
}

export function joineryIsRun(sku) {
  const mount = joineryMount(sku);
  return sku?.category === "casework" && (mount === "floor" || mount === "wall");
}

export function joineryLabel(sku) {
  return sku?.drawing?.symbol || sku?.name || "JOINERY";
}

export function joineryDashed(sku) {
  return joineryMount(sku) === "wall";
}

function clamp01(t) {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

function stations(item) {
  const a = clamp01(item?.t0);
  const b = clamp01(item?.t1);
  return a <= b ? { t0: a, t1: b } : { t0: b, t1: a };
}

export function joineryAlong(item, wall) {
  const { t0, t1 } = stations(item);
  const len = wall?.length || Math.hypot((wall?.x2 ?? 0) - (wall?.x1 ?? 0), (wall?.y2 ?? 0) - (wall?.y1 ?? 0));
  return Math.max(0, (t1 - t0) * len);
}

export function joineryHeights(item, sku, wallHeight) {
  const g = sku?.geometry || {};
  const bottom = Number.isFinite(item?.bottom) ? Math.max(0, item.bottom) : (Number.isFinite(g.sill) ? g.sill : 0);
  const typedTop = Number.isFinite(item?.top) ? item.top : null;
  const cap = Number.isFinite(wallHeight) && wallHeight > 0 ? wallHeight : null;
  let top = typedTop;
  if (top == null) {
    if (sku?.drawing?.fullHeight && cap != null) top = cap;
    else top = bottom + (g.height || 0.9);
  }
  if (cap != null) top = Math.min(top, cap);
  if (top < bottom + 0.05) top = bottom + 0.05;
  return { bottom, top };
}

function depthOf(sku, item = null) {
  if (Number.isFinite(item?.depth) && item.depth >= 0.15) return item.depth;
  const g = sku?.geometry || {};
  return g.depth || g.width || 0.6;
}

export function joineryDepth(item, sku) {
  return depthOf(sku, item);
}

/** Plan quad, wall face then out into the room. Empty when the host is missing. */
export function joineryPolygon(item, sku, wall) {
  if (!item || !sku || !wall) return [];
  const { t0, t1 } = stations(item);
  if (t1 - t0 < 1e-4) return [];
  const p0 = pointOnWall(wall, t0);
  const p1 = pointOnWall(wall, t1);
  const side = item.side === -1 ? -1 : 1;
  const n = wallNormal(wall, side);
  if (!n) return [];
  const inset = (wall.thickness || 0) / 2;
  const depth = depthOf(sku, item);
  const ax = n.x * inset;
  const ay = n.y * inset;
  const bx = n.x * (inset + depth);
  const by = n.y * (inset + depth);
  return [
    [p0.x + ax, p0.y + ay],
    [p1.x + ax, p1.y + ay],
    [p1.x + bx, p1.y + by],
    [p0.x + bx, p0.y + by],
  ];
}

export function joineryBounds(item, sku, wall) {
  const poly = joineryPolygon(item, sku, wall);
  if (poly.length < 4) {
    const g = sku?.geometry || {};
    const w = g.width || 0.4;
    const d = g.depth || w;
    const rot = Math.abs(((item?.rotation || 0) / 90) % 2);
    return rot
      ? { x: item.x, y: item.y, w: d, h: w }
      : { x: item.x, y: item.y, w, h: d };
  }
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(0.02, Math.max(...xs) - minX), h: Math.max(0.02, Math.max(...ys) - minY) };
}

function poseOnWall(item, sku, wall) {
  const box = joineryBounds(item, sku, wall);
  const ang = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1) * 180 / Math.PI;
  const a = ((ang % 180) + 180) % 180;
  return { x: box.x, y: box.y, rotation: a > 45 && a < 135 ? 90 : 0 };
}

export function joineryDraftAt(walls, sku, x, y, { preferId = null } = {}) {
  if (!joineryIsRun(sku)) return null;
  const list = (walls || []).filter((w) => w.drawn && (w.length || 0) >= MIN_RUN_M);
  let wall = null;
  if (preferId) {
    const pref = list.find((w) => w.id === preferId);
    if (pref && distToWall(pref, x, y) <= wallSnapDist(pref) * 1.4) wall = pref;
  }
  if (!wall) {
    let best = Infinity;
    for (const candidate of list) {
      const d = distToWall(candidate, x, y);
      if (d <= wallSnapDist(candidate) * 1.4 && d < best) {
        wall = candidate;
        best = d;
      }
    }
  }
  if (!wall) return null;
  return {
    host: "joinery",
    wallId: wall.id,
    t: clamp01(wallT(wall, x, y)),
    side: swingToward(wall, x, y),
    wall,
  };
}

export function commitJoineryRun({ sku, start, endT, wall, status, level, id }) {
  if (!sku || !start || !wall) return null;
  let t0 = clamp01(start.t);
  let t1 = clamp01(endT);
  const len = wall.length || 0;
  if (len <= 0) return null;
  if (Math.abs(t1 - t0) * len < MIN_RUN_M) {
    const dir = t1 >= t0 ? 1 : -1;
    const span = Math.min(Math.max(MIN_RUN_M, sku.geometry?.width || 0.6), len) / len;
    t1 = clamp01(t0 + dir * span);
    if (Math.abs(t1 - t0) * len < MIN_RUN_M) {
      t0 = clamp01(t0 - dir * span);
    }
  }
  const item = {
    id,
    sku: sku.id,
    level,
    status: status === "existing" ? "existing" : "planned",
    host: "joinery",
    wallId: wall.id,
    t0: Math.min(t0, t1),
    t1: Math.max(t0, t1),
    side: start.side === -1 ? -1 : 1,
  };
  const heights = joineryHeights(item, sku, wall.height);
  item.bottom = heights.bottom;
  item.top = sku.drawing?.fullHeight ? null : heights.top;
  Object.assign(item, poseOnWall(item, sku, wall));
  return item;
}

export function slideJoineryRun(item, wall, sku, x, y) {
  if (!item || !wall || item.host !== "joinery") return false;
  const { t0, t1 } = stations(item);
  const span = t1 - t0;
  const mid = (t0 + t1) / 2;
  const nextMid = clamp01(wallT(wall, x, y));
  let next0 = nextMid - span / 2;
  let next1 = nextMid + span / 2;
  if (next0 < 0) {
    next1 -= next0;
    next0 = 0;
  }
  if (next1 > 1) {
    next0 -= (next1 - 1);
    next1 = 1;
  }
  item.t0 = clamp01(next0);
  item.t1 = clamp01(next1);
  item.side = swingToward(wall, x, y);
  Object.assign(item, poseOnWall(item, sku, wall));
  return true;
}

/**
 * Move one station of the run. `end` is "start" (t0) or "end" (t1).
 *
 * `tolWorld` (metres, 0 by default) is a screen-pixel tolerance already
 * converted to world units by the caller. When given, the run's *length* -
 * not the raw pointer position - is pulled onto a round millimetre, the
 * same magnet a wall gets while it is drawn (`snap.js`'s `snapNiceDelta`).
 * The fixed end stays exactly put; only the dragged end feels the pull.
 * Without it (the default, and every existing caller/test) the end tracks
 * the pointer 1:1, unchanged from before.
 */
export function stretchJoineryRun(item, wall, sku, end, x, y, tolWorld = 0) {
  if (!item || !wall || item.host !== "joinery") return false;
  const len = wall.length || 0;
  if (!(len > 0)) return false;
  const { t0, t1 } = stations(item);
  const minSpan = Math.min(MIN_RUN_M, len) / len;
  let t = clamp01(wallT(wall, x, y));
  const along = t * len;
  if (along < 0.02) t = 0;
  else if (len - along < 0.02) t = 1;
  else if (tolWorld > 0) {
    const fixed = end === "start" ? t1 * len : t0 * len;
    const dir = along >= fixed ? 1 : -1;
    const span = snapNiceDelta(Math.abs(along - fixed), tolWorld);
    t = clamp01((fixed + dir * span) / len);
  }
  if (end === "start") {
    item.t0 = Math.min(t, t1 - minSpan);
    item.t1 = t1;
  } else {
    item.t0 = t0;
    item.t1 = Math.max(t, t0 + minSpan);
  }
  if (item.t0 > item.t1) {
    const swap = item.t0;
    item.t0 = item.t1;
    item.t1 = swap;
  }
  Object.assign(item, poseOnWall(item, sku, wall));
  return true;
}

/**
 * How far the cupboard stands into the room, from a drag on its outer face.
 *
 * Same `tolWorld` magnet as `stretchJoineryRun`: 0 (the default) tracks the
 * pointer exactly, as every existing caller/test expects; a screen-pixel
 * tolerance pulls the depth onto a round millimetre.
 */
export function stretchJoineryDepth(item, wall, sku, x, y, tolWorld = 0) {
  if (!item || !wall || item.host !== "joinery") return false;
  const side = item.side === -1 ? -1 : 1;
  const n = wallNormal(wall, side);
  if (!n) return false;
  const { t0, t1 } = stations(item);
  const mid = pointOnWall(wall, (t0 + t1) / 2);
  const inset = (wall.thickness || 0) / 2;
  const along = (x - mid.x) * n.x + (y - mid.y) * n.y;
  let depth = along - inset;
  if (tolWorld > 0 && depth > 0) depth = snapNiceDelta(depth, tolWorld);
  item.depth = Math.max(0.15, Math.min(2.4, depth));
  Object.assign(item, poseOnWall(item, sku, wall));
  return true;
}

/** Plan handles: the two along-wall ends, and the outer face for depth. */
export function joineryHandlePoints(item, sku, wall) {
  const poly = joineryPolygon(item, sku, wall);
  if (poly.length < 4) return [];
  const mid = (a, b) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 });
  return [
    { ...mid(poly[0], poly[3]), end: "start" },
    { ...mid(poly[1], poly[2]), end: "end" },
    { ...mid(poly[2], poly[3]), end: "depth" },
  ];
}

/**
 * Gap strings along the host wall: each end of the run to the nearest
 * neighbour (another cupboard, an opening) or the wall end, plus the run's
 * own length. Same shape as openingSideGaps.
 */
export function joinerySideGaps(wall, item, neighbors = []) {
  const len = wall?.length || (wall ? Math.hypot((wall.x2 ?? 0) - (wall.x1 ?? 0), (wall.y2 ?? 0) - (wall.y1 ?? 0)) : 0);
  if (!(len > 1e-6) || !item) return [];
  const { t0, t1 } = stations(item);
  let leftT = 0;
  let rightT = 1;
  for (const n of neighbors) {
    const n0 = Math.min(n.t0, n.t1);
    const n1 = Math.max(n.t0, n.t1);
    if (n1 <= t0 + 1e-6 && n1 > leftT) leftT = n1;
    if (n0 >= t1 - 1e-6 && n0 < rightT) rightT = n0;
  }
  const a = pointOnWall(wall, t0);
  const b = pointOnWall(wall, t1);
  const gaps = [];
  if ((t0 - leftT) * len > 1e-6) {
    const from = pointOnWall(wall, leftT);
    gaps.push({ x1: from.x, y1: from.y, x2: a.x, y2: a.y });
  }
  if ((t1 - t0) * len > 1e-6) {
    gaps.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, own: true });
  }
  if ((rightT - t1) * len > 1e-6) {
    const to = pointOnWall(wall, rightT);
    gaps.push({ x1: b.x, y1: b.y, x2: to.x, y2: to.y });
  }
  return gaps;
}

/** The two short edges: wall face out to the room. The plan picks the one
 *  that sits higher on the sheet so the depth string stays off the box. */
export function joineryDepthGaps(item, sku, wall) {
  const poly = joineryPolygon(item, sku, wall);
  if (poly.length < 4) return [];
  const edge = (a, b) => {
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (span < 1e-6) return null;
    return { x1: a[0], y1: a[1], x2: b[0], y2: b[1], depth: true };
  };
  return [edge(poly[0], poly[3]), edge(poly[1], poly[2])].filter(Boolean);
}

export function applyJoineryEdit(item, sku, wall, edit, wallHeight) {
  if (!item || item.host !== "joinery" || !wall) return null;
  const len = wall.length || 0;
  if (!(len > 0)) return null;
  const { t0, t1 } = stations(item);
  const pick = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  let from = pick(edit.from, t0 * len);
  let to = pick(edit.to, t1 * len);
  if (to < from) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (to - from < MIN_RUN_M) to = from + MIN_RUN_M;
  from = Math.max(0, Math.min(from, len - MIN_RUN_M));
  to = Math.min(len, Math.max(to, from + MIN_RUN_M));
  item.t0 = from / len;
  item.t1 = to / len;
  if (edit.side === -1 || edit.side === 1) item.side = edit.side;
  if (Number.isFinite(edit.depth)) item.depth = Math.max(0.15, Math.min(2.4, edit.depth));
  const heights = joineryHeights({
    ...item,
    bottom: pick(edit.bottom, item.bottom),
    top: edit.top === null ? null : pick(edit.top, item.top),
  }, sku, wallHeight);
  item.bottom = heights.bottom;
  item.top = sku?.drawing?.fullHeight && wallHeight != null && Math.abs(heights.top - wallHeight) < 0.02
    ? null
    : heights.top;
  Object.assign(item, poseOnWall(item, sku, wall));
  return item;
}

export function rehostJoineryAfterSplit(doc, headId, tailId, cut, len) {
  if (!headId || !tailId || !(len > 0)) return;
  for (const item of doc?.items || []) {
    if (item.host !== "joinery" || item.wallId !== headId) continue;
    const { t0, t1 } = stations(item);
    const a = t0 * len;
    const b = t1 * len;
    if (b <= cut + 1e-6) {
      item.t0 = cut > 0 ? a / cut : 0;
      item.t1 = cut > 0 ? b / cut : 0;
    } else if (a >= cut - 1e-6) {
      item.wallId = tailId;
      const rest = len - cut;
      item.t0 = rest > 0 ? (a - cut) / rest : 0;
      item.t1 = rest > 0 ? (b - cut) / rest : 0;
    } else {
      item.t0 = cut > 0 ? a / cut : 0;
      item.t1 = 1;
    }
  }
}

export function syncHostedJoinery(doc, pack, walls = null) {
  if (!doc || !pack) return;
  const derived = walls || deriveWalls(doc, pack);
  const skuOf = (id) => (pack.skus || []).find((s) => s.id === id) || null;
  for (const item of doc.items || []) {
    if (item.host !== "joinery") continue;
    const wall = derived.find((w) => w.drawn && w.id === item.wallId);
    if (!wall) continue;
    const sku = skuOf(item.sku);
    const { t0, t1 } = stations(item);
    item.t0 = t0;
    item.t1 = t1;
    item.side = item.side === -1 ? -1 : 1;
    Object.assign(item, poseOnWall(item, sku, wall));
    if (wall.level) item.level = wall.level;
  }
}

/**
 * Joinery on this face, in viewing order. `from`/`to` along the wall,
 * `bottom`/`top` up from the wall base, same coordinates as a finish band.
 */
export function elevationJoinery(doc, pack, wall, side, flip) {
  if (!doc || !pack || !wall) return [];
  const skuOf = (id) => (pack.skus || []).find((s) => s.id === id) || null;
  const out = [];
  const faceSide = side === -1 ? -1 : 1;
  for (const item of doc.items || []) {
    if (item.host !== "joinery" || item.wallId !== wall.id) continue;
    const itemSide = item.side === -1 ? -1 : 1;
    if (itemSide !== faceSide) continue;
    const sku = skuOf(item.sku);
    if (!joineryIsRun(sku)) continue;
    const { t0, t1 } = stations(item);
    const len = wall.length || 0;
    let from = t0 * len;
    let to = t1 * len;
    if (flip) {
      const mirroredFrom = len - to;
      to = len - from;
      from = mirroredFrom;
    }
    const heights = joineryHeights(item, sku, wall.height);
    out.push({
      id: item.id,
      sku: item.sku,
      name: sku?.name || item.sku,
      label: joineryLabel(sku),
      dashed: joineryDashed(sku),
      from,
      to,
      bottom: heights.bottom,
      top: heights.top,
      mount: joineryMount(sku),
    });
  }
  out.sort((a, b) => a.from - b.from || a.bottom - b.bottom);
  return out;
}

function segmentsCross(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  const eps = 1e-8;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

function footprintsOverlap(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  for (const [x, y] of a) if (pointInPoly(x, y, b)) return true;
  for (const [x, y] of b) if (pointInPoly(x, y, a)) return true;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function rectPoly(rect) {
  return [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
}

/** A rug lies on the floor. It may cover other furniture without a clash. */
export function furnitureIsRug(sku) {
  const plan = sku?.drawing?.plan;
  return plan === "carpet-square" || plan === "carpet-round";
}

/** True when a loose piece's footprint cuts a wall body. Flush with the face does not count. */
export function furnitureCrossesWall(rect, wallPolys) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
  const box = rectPoly(rect);
  for (const poly of wallPolys || []) {
    if (footprintsOverlap(box, poly)) return true;
  }
  return false;
}

/** True when two footprints cut each other. Sharing an edge does not count. */
export function furnitureOverlapsRect(a, b) {
  if (!a || !b || !(a.w > 0) || !(a.h > 0) || !(b.w > 0) || !(b.h > 0)) return false;
  return footprintsOverlap(rectPoly(a), rectPoly(b));
}
