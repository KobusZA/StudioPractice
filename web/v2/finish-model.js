// Finishes: what is on each wall face and floor, and what it adds to the bill.
//
// Four sources, all measured the same way:
//   * room rules      `room.finishes`, applied to every wall that room bounds
//                     (never anchored to room-derived wall ids, which change)
//   * finish runs     `doc.finishRuns`, drawn on one face and matched to it by
//                     position (the way `wallForOpening` matches an opening)
//   * floor regions   `doc.finishRegions`, polygons on a floor (a room
//                     and/or the slab the user actually clicked)
//   * the default     a computed plaster coat on both faces of a plastered type,
//                     never stored; any coat-layer finish replaces it where it
//                     lands, and "No finish" removes it
//
// Quantities are measured net of openings. A product's waste factor is kept
// beside the measured quantity and never added into it. A row whose category
// needs a product but has none is an allowance, labelled as one.
//
// Heights are metres above the wall's base; offsets are metres from the
// wall's first end (the elevation view converts to viewing order).

import { area as polyArea, clipPolygon, distToSeg, pointInPoly } from "./geom.js";
import { effectiveLevel, finishRegionPolygon, finishRegionSlab, roomArea, roomPolygon, shapeAsPoly } from "./model.js";
import { openingOnWall, openingSize, pointOnWall, skuById, wallForOpening, wallNormal } from "./openings.js";
import { deriveWalls, isExternalWall } from "./walls.js";
import {
  FINISH_CATEGORIES,
  FINISH_CATEGORY_IDS,
  categoriesForSurface,
  finishId,
  normalizeFinishPresets,
} from "./finish-data.js";

export { FINISH_CATEGORIES, FINISH_CATEGORY_IDS, categoriesForSurface };

const EPS = 1e-6;
const DEFAULT_WINDOW_SILL = 0.9;

export function finishProductById(doc, id) {
  return id ? (doc?.finishProducts || []).find((p) => p.id === id) || null : null;
}

/** "PC allowance, product not chosen" is how an allowance row is labelled. */
export const PC_ALLOWANCE_LABEL = "PC allowance, product not chosen";

/** Rate-book model a finish row prices against: the product's own, else the category allowance. */
export function finishRateModel(product, category) {
  if (product) return product.rateRef || `FINISH-P:${product.id}`;
  return `FINISH:${category}`;
}

// --- rectangles ------------------------------------------------------------

function overlap(lo1, hi1, lo2, hi2) {
  return Math.max(0, Math.min(hi1, hi2) - Math.max(lo1, lo2));
}

/** `rect` minus `cut`, as up to four rectangles. Both are { from, to, bottom, top }. */
function subtractRect(rect, cut) {
  const ox = overlap(rect.from, rect.to, cut.from, cut.to);
  const oy = overlap(rect.bottom, rect.top, cut.bottom, cut.top);
  if (ox < EPS || oy < EPS) return [rect];
  const out = [];
  const x0 = Math.max(rect.from, cut.from);
  const x1 = Math.min(rect.to, cut.to);
  if (x0 - rect.from > EPS) out.push({ ...rect, to: x0 });
  if (rect.to - x1 > EPS) out.push({ ...rect, from: x1 });
  const y0 = Math.max(rect.bottom, cut.bottom);
  const y1 = Math.min(rect.top, cut.top);
  if (y0 - rect.bottom > EPS) out.push({ ...rect, from: x0, to: x1, top: y0 });
  if (rect.top - y1 > EPS) out.push({ ...rect, from: x0, to: x1, bottom: y1 });
  return out;
}

// --- faces -----------------------------------------------------------------

/** The rooms that sit on each side of a wall: { 1: Set, -1: Set } of room ids. */
export function roomsBySide(doc, wall) {
  const out = { 1: new Set(), "-1": new Set() };
  const reach = (wall.thickness || 0.22) / 2 + 0.05;
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  for (const roomId of wall.roomIds || []) {
    const room = (doc.rooms || []).find((r) => r.id === roomId);
    const poly = room ? roomPolygon(room) : [];
    if (poly.length < 3) continue;
    for (const side of [1, -1]) {
      const n = wallNormal(wall, side);
      for (const f of [0.25, 0.5, 0.75]) {
        if (pointInPoly(wall.x1 + dx * f + n.x * reach, wall.y1 + dy * f + n.y * reach, poly)) {
          out[side].add(roomId);
          break;
        }
      }
    }
  }
  return out;
}

/** "internal" when a room is on that side of the wall, else "external". */
export function faceKind(doc, wall, side) {
  return roomsBySide(doc, wall)[side].size ? "internal" : "external";
}

/** Openings on a wall as rectangles in wall coordinates (from the first end, up from the base). */
export function wallOpeningRects(doc, pack, walls, wall) {
  const out = [];
  for (const opening of doc.openings || []) {
    const host = wallForOpening(doc, pack, walls, opening);
    if (!host || host.id !== wall.id) continue;
    const placed = openingOnWall(doc, pack, opening, host);
    const size = openingSize(pack, opening);
    const sku = skuById(pack, opening.sku);
    const sill = Number.isFinite(size.sill) ? size.sill : (sku?.category === "window" ? DEFAULT_WINDOW_SILL : 0);
    const height = Number.isFinite(size.height) ? size.height : 0;
    const from = placed.t * wall.length - placed.width / 2;
    out.push({
      id: opening.id,
      door: sku?.category === "door",
      from,
      to: from + placed.width,
      bottom: sill,
      top: sill + height,
    });
  }
  return out;
}

// --- floor regions ---------------------------------------------------------

function centroidOf(poly) {
  const n = poly.length || 1;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

/** The room a floor region belongs to: the one it names, else the one holding its centre. */
function regionRoom(doc, pack, region) {
  const named = region.roomId ? (doc.rooms || []).find((r) => r.id === region.roomId) : null;
  if (named) return named;
  const poly = finishRegionPolygon(doc, region);
  if (poly.length < 3) return null;
  const [cx, cy] = centroidOf(poly);
  return (doc.rooms || []).find((room) => {
    if (region.level && effectiveLevel(room, pack) !== region.level) return false;
    const rp = roomPolygon(room);
    return rp.length >= 3 && pointInPoly(cx, cy, rp);
  }) || null;
}

/** Floor finish regions that belong on this slab (named, or their centre is on it). */
export function regionsOnSlab(doc, slab) {
  if (!slab) return [];
  return (doc.finishRegions || []).filter((region) => finishRegionSlab(doc, region)?.id === slab.id);
}

function pieceArea(pieces) {
  return pieces.reduce((sum, poly) => sum + polyArea(poly), 0);
}

/** Intersection of two sets of polygons. Pieces within a set do not overlap. */
function intersectPieceLists(a, b) {
  const out = [];
  for (const pa of a) {
    for (const pb of b) out.push(...clipPolygon(pa, pb));
  }
  return out;
}

/**
 * Area of the union of polygon sets. Each list is one shape, already cut into
 * pieces that do not overlap each other. Beyond eight shapes the triple-and-
 * higher overlaps are left in the total, which only makes a warning conservative.
 */
function unionAreaOfLists(lists) {
  const n = lists.length;
  if (!n) return 0;
  if (n === 1) return pieceArea(lists[0]);
  if (n > 8) {
    let sum = lists.reduce((total, list) => total + pieceArea(list), 0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) sum -= pieceArea(intersectPieceLists(lists[i], lists[j]));
    }
    return Math.max(0, sum);
  }
  let total = 0;
  for (let mask = 1; mask < (1 << n); mask += 1) {
    let acc = null;
    let bits = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      bits += 1;
      acc = acc ? intersectPieceLists(acc, lists[i]) : lists[i];
      if (!acc.length) break;
    }
    if (!acc?.length) continue;
    total += (bits % 2 ? 1 : -1) * pieceArea(acc);
  }
  return Math.max(0, total);
}

/**
 * How a set of floor-finish polygons covers a host outline. Areas are square
 * metres. `excess` is the part counted more than once; the bill is unchanged
 * by it — the panel only warns.
 */
export function floorCoverage(host, polygons) {
  const hostPoly = host?.length >= 3 ? host : [];
  const hostArea = hostPoly.length ? polyArea(hostPoly) : 0;
  const lists = (polygons || []).map((poly) => (
    hostPoly.length && poly?.length >= 3 ? clipPolygon(poly, hostPoly) : []
  ));
  const clipped = lists.map((pieces) => pieceArea(pieces));
  const finished = hostPoly.length ? Math.min(hostArea, unionAreaOfLists(lists)) : 0;
  const drawn = clipped.reduce((sum, area) => sum + area, 0);
  const involved = new Array(lists.length).fill(false);
  for (let i = 0; i < lists.length; i += 1) {
    for (let j = i + 1; j < lists.length; j += 1) {
      if (pieceArea(intersectPieceLists(lists[i], lists[j])) <= 0.02) continue;
      involved[i] = true;
      involved[j] = true;
    }
  }
  return {
    hostArea,
    clipped,
    finished,
    bare: Math.max(0, hostArea - finished),
    excess: Math.max(0, drawn - finished),
    overlapCount: involved.filter(Boolean).length,
  };
}

/**
 * A new floor finish region. `spec` is category and/or productId, a shape,
 * and optionally the room and slab it was drawn from.
 */
export function createFinishRegion(doc, spec) {
  const shape = spec.shape?.kind === "poly" || spec.shape?.kind === "rect" || spec.shape?.kind === "rects"
    ? spec.shape
    : shapeAsPoly(spec.shape);
  if (!shape) return null;
  const region = {
    id: finishId("fg"),
    level: spec.level ?? null,
    roomId: spec.roomId || null,
    slabId: spec.slabId || null,
    category: spec.category || null,
    productId: spec.productId || null,
    shape,
  };
  if (spec.whole && region.slabId) region.whole = true;
  if (!Array.isArray(doc.finishRegions)) doc.finishRegions = [];
  doc.finishRegions.push(region);
  return region;
}

/**
 * Area of floor finish regions per room, so a room's floor can be measured
 * net of them. A region counts at most the room's own area.
 */
export function finishRegionAreas(doc, pack) {
  const byRoom = new Map();
  const regions = [];
  for (const region of doc.finishRegions || []) {
    const poly = finishRegionPolygon(doc, region);
    const a = poly.length >= 3 ? Math.abs(polyArea(poly)) : 0;
    const room = regionRoom(doc, pack, region);
    regions.push({ region, area: a, room });
    if (room) byRoom.set(room.id, Math.min(roomArea(room), (byRoom.get(room.id) || 0) + a));
  }
  return { byRoom, regions };
}

// --- runs ------------------------------------------------------------------

/** Where a run lands now: the wall, side and span, or null when it fits no face. */
export function placeRun(run, walls) {
  const direct = walls.find((w) => w.id === run.wallId);
  if (direct) {
    const whole = run.a === null || run.b === null;
    return {
      wall: direct,
      side: run.side,
      a: whole ? 0 : Math.max(0, Math.min(run.a, direct.length)),
      b: whole ? direct.length : Math.max(0, Math.min(run.b, direct.length)),
    };
  }
  if (![run.x1, run.y1, run.x2, run.y2].every(Number.isFinite)) return null;
  let best = null;
  let bestD = Infinity;
  for (const wall of walls) {
    if (run.level && wall.level !== run.level) continue;
    const reach = (wall.thickness || 0.22) / 2 + 0.08;
    const d1 = distToSeg(wall.x1, wall.y1, wall.x2, wall.y2, run.x1, run.y1);
    const d2 = distToSeg(wall.x1, wall.y1, wall.x2, wall.y2, run.x2, run.y2);
    if (d1 > reach || d2 > reach) continue;
    if (d1 + d2 < bestD) { best = wall; bestD = d1 + d2; }
  }
  if (!best) return null;
  const len = best.length || 1;
  const along = (x, y) => {
    const t = ((x - best.x1) * (best.x2 - best.x1) + (y - best.y1) * (best.y2 - best.y1)) / (len * len);
    return Math.min(1, Math.max(0, t)) * len;
  };
  const whole = run.a === null || run.b === null;
  const s1 = along(run.x1, run.y1);
  const s2 = along(run.x2, run.y2);
  let side = run.side;
  if (Number.isFinite(run.vx) && Number.isFinite(run.vy)) {
    const n = wallNormal(best, 1);
    const mx = (best.x1 + best.x2) / 2;
    const my = (best.y1 + best.y2) / 2;
    side = (run.vx - mx) * n.x + (run.vy - my) * n.y >= 0 ? 1 : -1;
  }
  return { wall: best, side, a: whole ? 0 : Math.min(s1, s2), b: whole ? len : Math.max(s1, s2) };
}

/**
 * A new finish run on one wall face. `spec`: category and/or productId, and
 * optionally from, to (metres along the wall from its first end; both left
 * out is the whole face), bottom and top (above the base).
 */
export function createFinishRun(doc, wall, side, spec) {
  const outline = (Array.isArray(spec.outline) ? spec.outline : [])
    .map((p) => [Number(p[0]), Number(p[1])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const drawn = outline.length >= 3;
  const span = drawn
    ? { from: Math.min(...outline.map((p) => p[0])), to: Math.max(...outline.map((p) => p[0])), bottom: Math.min(...outline.map((p) => p[1])), top: Math.max(...outline.map((p) => p[1])) }
    : spec;
  const whole = !drawn && !(Number.isFinite(span.from) && Number.isFinite(span.to));
  const a = whole ? 0 : Math.max(0, Math.min(span.from, span.to));
  const b = whole ? wall.length : Math.min(wall.length, Math.max(span.from, span.to));
  const dx = (wall.x2 - wall.x1) / (wall.length || 1);
  const dy = (wall.y2 - wall.y1) / (wall.length || 1);
  const n = wallNormal(wall, side);
  const mid = (a + b) / 2;
  const reach = (wall.thickness || 0.22) / 2 + 0.3;
  const run = {
    id: finishId("fx"),
    level: wall.level ?? null,
    roomId: null,
    wallId: wall.id,
    side: side === -1 ? -1 : 1,
    a: whole ? null : a,
    b: whole ? null : b,
    bottom: Number.isFinite(span.bottom) && span.bottom >= 0 ? span.bottom : 0,
    top: Number.isFinite(span.top) && span.top > 0 ? span.top : null,
    category: spec.category || null,
    productId: spec.productId || null,
    x1: wall.x1 + dx * a,
    y1: wall.y1 + dy * a,
    x2: wall.x1 + dx * b,
    y2: wall.y1 + dy * b,
    vx: wall.x1 + dx * mid + n.x * reach,
    vy: wall.y1 + dy * mid + n.y * reach,
  };
  if (drawn) run.outline = outline;
  if (!Array.isArray(doc.finishRuns)) doc.finishRuns = [];
  doc.finishRuns.push(run);
  return run;
}

/** Re-anchor a run to where it is now, after its span was edited. */
export function reanchorRun(run, wall) {
  const dx = (wall.x2 - wall.x1) / (wall.length || 1);
  const dy = (wall.y2 - wall.y1) / (wall.length || 1);
  const whole = run.a === null || run.b === null;
  const a = whole ? 0 : run.a;
  const b = whole ? wall.length : run.b;
  const n = wallNormal(wall, run.side);
  const mid = (a + b) / 2;
  const reach = (wall.thickness || 0.22) / 2 + 0.3;
  run.wallId = wall.id;
  run.level = wall.level ?? run.level;
  run.x1 = wall.x1 + dx * a;
  run.y1 = wall.y1 + dy * a;
  run.x2 = wall.x1 + dx * b;
  run.y2 = wall.y1 + dy * b;
  run.vx = wall.x1 + dx * mid + n.x * reach;
  run.vy = wall.y1 + dy * mid + n.y * reach;
}

/**
 * Finishes and openings to drop when these drawn walls are deleted.
 * A run or opening that was placed on one of them goes with it, so the next
 * wall drawn on that line does not inherit it. A room finish rule is left
 * alone (it belongs to the room), as is the computed plaster coat. A door
 * or finish that still has a wall afterwards — a room wall this drawn wall
 * was covering — stays too.
 */
export function dependentsOfWalls(doc, pack, segmentIds) {
  const ids = new Set((segmentIds || []).filter(Boolean));
  const finishRunIds = [];
  const openingIds = [];
  if (!ids.size) return { finishRunIds, openingIds };
  if (!pack) {
    for (const run of doc.finishRuns || []) if (ids.has(run.wallId)) finishRunIds.push(run.id);
    for (const opening of doc.openings || []) if (ids.has(opening.wallId)) openingIds.push(opening.id);
    return { finishRunIds, openingIds };
  }
  const before = deriveWalls(doc, pack);
  const removed = new Set(before.filter((w) => ids.has(w.id)).map((w) => w.id));
  const draft = { ...doc, segments: (doc.segments || []).filter((s) => !ids.has(s.id)) };
  const after = deriveWalls(draft, pack);
  for (const run of doc.finishRuns || []) {
    if (ids.has(run.wallId)) {
      finishRunIds.push(run.id);
      continue;
    }
    const was = placeRun(run, before);
    if (!was || !removed.has(was.wall.id)) continue;
    if (!placeRun(run, after)) finishRunIds.push(run.id);
  }
  for (const opening of doc.openings || []) {
    if (ids.has(opening.wallId)) {
      openingIds.push(opening.id);
      continue;
    }
    const was = wallForOpening(doc, pack, before, opening);
    if (!was || !removed.has(was.id)) continue;
    if (!wallForOpening(draft, pack, after, opening)) openingIds.push(opening.id);
  }
  return { finishRunIds, openingIds };
}

// --- resolve ---------------------------------------------------------------

function externalCategory(doc) {
  const choice = doc.finishSettings?.externalFinish;
  return choice === "render" || choice === "facebrick" ? choice : "plaster";
}

function rectPoly(rect) {
  return [[rect.from, rect.bottom], [rect.to, rect.bottom], [rect.to, rect.top], [rect.from, rect.top]];
}

/** Area of a drawn wall shape, cut to the face and net of openings. */
function outlineQuantity(outline, wall, openings, height) {
  const face = [[0, 0], [wall.length, 0], [wall.length, height], [0, height]];
  const pieces = clipPolygon(outline, face);
  let qty = pieceArea(pieces);
  for (const opening of openings) qty -= pieceArea(intersectPieceLists(pieces, [rectPoly(opening)]));
  return Math.max(0, qty);
}

/**
 * A default plaster rectangle minus openings and minus drawn coat shapes.
 * The rectangle stays for drawing; the polygon is painted over it. The overlap
 * of an opening and a coat is counted once.
 */
function defaultNetOfOutlines(piece, openings, outlines) {
  const rect = rectPoly(piece);
  const openPieces = openings.map((o) => clipPolygon(rectPoly(o), rect)).filter((p) => p.length);
  const coatPieces = outlines.map((o) => clipPolygon(o, rect)).filter((p) => p.length);
  let qty = Math.abs(polyArea(rect)) - unionAreaOfLists(openPieces) - unionAreaOfLists(coatPieces);
  const both = [];
  for (const opening of openPieces) {
    for (const coat of coatPieces) {
      const hit = intersectPieceLists(opening, coat);
      if (hit.length) both.push(hit);
    }
  }
  qty += unionAreaOfLists(both);
  return Math.max(0, qty);
}

function bandMeta(doc, item, warnings, label) {
  const product = finishProductById(doc, item.productId);
  if (item.productId && !product) {
    warnings.push(`${label} names a finish product that is no longer on this job; it is priced as the ${FINISH_CATEGORIES[item.category]?.label?.toLowerCase() || "category"} allowance.`);
  }
  const category = product?.category || item.category || null;
  if (!category) return null;
  return { category, product };
}

/**
 * Everything finished on this document's walls and floors.
 *
 * @param {object} [opts]
 * @param {Map} [opts.wallBases] wall id -> { height } after base attach
 * @param {string} [opts.onlyWallId] limit wall faces to one wall (elevation view)
 * @returns {{bands:object[], rows:object[], warnings:string[], regionAreas:Map}}
 */
export function resolveFinishes(doc, pack, walls, { wallBases = null, onlyWallId = null } = {}) {
  const warnings = [];
  const bands = [];
  const rows = [];
  const heightOf = (wall) => wallBases?.get(wall.id)?.height ?? wall.height ?? pack?.system?.wallHeight ?? 0;
  const sides = new Map();
  const sidesOf = (wall) => {
    if (!sides.has(wall.id)) sides.set(wall.id, roomsBySide(doc, wall));
    return sides.get(wall.id);
  };
  const targetWalls = onlyWallId ? walls.filter((w) => w.id === onlyWallId) : walls;
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const explicit = []; // room rules and runs, before the default is laid under them
  const pushBand = (wall, side, item, source, sourceId, from, to, bottom, top, label) => {
    const meta = bandMeta(doc, item, warnings, label);
    if (!meta) return;
    const spec = FINISH_CATEGORIES[meta.category];
    if (!spec.surfaces.includes("wall")) {
      warnings.push(`${label}: ${spec.label} cannot go on a wall, so it is skipped.`);
      return;
    }
    const h = heightOf(wall);
    let outline = null;
    if (Array.isArray(item.outline) && item.outline.length >= 3) {
      outline = item.outline.map(([s, z]) => [
        Math.min(wall.length, Math.max(0, s)),
        Math.min(h, Math.max(0, z)),
      ]);
      from = Math.min(...outline.map((p) => p[0]));
      to = Math.max(...outline.map((p) => p[0]));
      bottom = Math.min(...outline.map((p) => p[1]));
      top = Math.max(...outline.map((p) => p[1]));
    }
    const t = Math.min(top ?? h, h);
    const b = Math.max(0, bottom);
    if (to - from < EPS || t - b < EPS) return;
    explicit.push({
      id: `${source}:${sourceId}:${wall.id}:${side}`,
      source,
      sourceId,
      wallId: wall.id,
      side,
      level: wall.level,
      category: meta.category,
      productId: meta.product?.id || null,
      from,
      to,
      bottom: b,
      top: t,
      outline,
      roomId: item.roomId || null,
    });
  };

  // Room rules: the room-side face of each wall the room bounds.
  for (const room of doc.rooms || []) {
    for (const rule of room.finishes || []) {
      if (rule.surface !== "wall") continue;
      const label = `Finish rule in "${room.name}"`;
      for (const wall of targetWalls) {
        if (!(wall.roomIds || []).includes(room.id)) continue;
        if (rule.faces === "external" && !isExternalWall(wall)) continue;
        if (rule.faces === "internal" && isExternalWall(wall)) continue;
        for (const side of [1, -1]) {
          if (!sidesOf(wall)[side].has(room.id)) continue;
          pushBand(wall, side, { ...rule, roomId: room.id }, "rule", rule.id, 0, wall.length, rule.bottom, rule.top, label);
        }
      }
    }
  }

  // Runs: matched to their face by position; one that fits nothing is warned about, never dropped.
  const orphans = [];
  for (const run of doc.finishRuns || []) {
    const placed = placeRun(run, walls);
    if (!placed) {
      orphans.push(run);
      continue;
    }
    if (onlyWallId && placed.wall.id !== onlyWallId) continue;
    pushBand(placed.wall, placed.side, run, "run", run.id, placed.a, placed.b, run.bottom, run.top, "A finish run");
  }
  if (orphans.length) {
    warnings.push(`${orphans.length} finish run${orphans.length === 1 ? "" : "s"} no longer land${orphans.length === 1 ? "s" : ""} on any wall face (the wall moved or was removed). They are kept and not counted: ${orphans.slice(0, 5).map((r) => r.id).join(", ")}${orphans.length > 5 ? ", ..." : ""}.`);
  }

  // The computed plaster default, under everything above.
  const defaults = [];
  const coat = (b) => FINISH_CATEGORIES[b.category]?.layer === "coat";
  for (const wall of targetWalls) {
    const sku = skuById(pack, wall.sku);
    if (wall.category !== "wall" || sku?.compliance?.plastered !== true) continue;
    for (const side of [1, -1]) {
      const kind = sidesOf(wall)[side].size ? "internal" : "external";
      const category = kind === "internal" ? "plaster" : externalCategory(doc);
      let pieces = [{ from: 0, to: wall.length, bottom: 0, top: heightOf(wall) }];
      for (const b of explicit) {
        if (b.wallId !== wall.id || b.side !== side || !coat(b) || b.outline) continue;
        pieces = pieces.flatMap((piece) => subtractRect(piece, b));
      }
      pieces.forEach((piece, i) => {
        defaults.push({
          id: `default:${wall.id}:${side}:${i}`,
          source: "default",
          sourceId: null,
          wallId: wall.id,
          side,
          level: wall.level,
          category,
          productId: null,
          kind,
          ...piece,
        });
      });
    }
  }

  const all = [...defaults, ...explicit.filter((b) => b.category !== "none")];
  const openingCache = new Map();
  const openingsOf = (wall) => {
    if (!openingCache.has(wall.id)) openingCache.set(wall.id, wallOpeningRects(doc, pack, walls, wall));
    return openingCache.get(wall.id);
  };

  for (const band of all) {
    const wall = wallById.get(band.wallId);
    const spec = FINISH_CATEGORIES[band.category];
    const product = finishProductById(doc, band.productId);
    band.kind = band.kind || faceKind(doc, wall, band.side);
    let quantity;
    const coats = explicit.filter((b) => b.outline && b.wallId === band.wallId && b.side === band.side && FINISH_CATEGORIES[b.category]?.layer === "coat");
    if (band.outline && spec.unit !== "m") {
      quantity = outlineQuantity(band.outline, wall, openingsOf(wall), heightOf(wall));
    } else if (band.source === "default" && coats.length && spec.unit !== "m") {
      quantity = defaultNetOfOutlines(band, openingsOf(wall), coats.map((b) => b.outline));
    } else if (spec.unit === "m") {
      quantity = band.to - band.from;
      for (const o of openingsOf(wall)) {
        if (o.door) quantity -= overlap(band.from, band.to, o.from, o.to);
      }
    } else {
      quantity = (band.to - band.from) * (band.top - band.bottom);
      for (const o of openingsOf(wall)) {
        quantity -= overlap(band.from, band.to, o.from, o.to) * overlap(band.bottom, band.top, o.bottom, o.top);
      }
    }
    quantity = Math.max(0, quantity);
    band.quantity = quantity;
    band.unit = spec.unit;
    bands.push(band);
    if (quantity < EPS) continue;
    rows.push(finishRow({
      pack, doc, spec, product, category: band.category, quantity, elementId: band.id, level: wall.level,
      status: wall.status || "planned", surface: "wall", face: band.kind, source: band.source,
    }));
  }

  // Floors: room rules net of regions, then each region as its own row.
  const regionAreas = finishRegionAreas(doc, pack);
  if (!onlyWallId) {
    for (const room of doc.rooms || []) {
      for (const rule of room.finishes || []) {
        if (rule.surface !== "floor") continue;
        const meta = bandMeta(doc, rule, warnings, `Finish rule in "${room.name}"`);
        if (!meta) continue;
        const spec = FINISH_CATEGORIES[meta.category];
        if (!spec.surfaces.includes("floor")) {
          warnings.push(`Finish rule in "${room.name}": ${spec.label} cannot go on a floor, so it is skipped.`);
          continue;
        }
        const quantity = Math.max(0, roomArea(room) - (regionAreas.byRoom.get(room.id) || 0));
        if (quantity < EPS) continue;
        rows.push(finishRow({
          pack, doc, spec, product: meta.product, category: meta.category, quantity,
          elementId: `rule:${rule.id}:floor`, level: effectiveLevel(room, pack),
          status: room.status === "existing" ? "existing" : "planned", surface: "floor", face: null, source: "rule",
        }));
      }
    }
    for (const { region, area, room } of regionAreas.regions) {
      const meta = bandMeta(doc, region, warnings, "A floor finish region");
      if (!meta || area < EPS) continue;
      const spec = FINISH_CATEGORIES[meta.category];
      if (!spec.surfaces.includes("floor")) {
        warnings.push(`A floor finish region is ${spec.label}, which cannot go on a floor, so it is skipped.`);
        continue;
      }
      if (!room) warnings.push("A floor finish region is not inside any room; it is counted, but check it is where you meant.");
      rows.push(finishRow({
        pack, doc, spec, product: meta.product, category: meta.category, quantity: area,
        elementId: region.id, level: region.level || (room ? effectiveLevel(room, pack) : null),
        status: room?.status === "existing" ? "existing" : "planned", surface: "floor", face: null, source: "region",
      }));
    }
  }

  // "No finish" pieces are not bands (they measure nothing), but the panel lists
  // them so a taken-off default can be put back.
  const removed = explicit.filter((b) => b.category === "none").map((b) => ({ ...b, quantity: 0, unit: "m2" }));
  return { bands, rows, warnings, regionAreas: regionAreas.byRoom, removed };
}

function finishRow({ doc, spec, product, category, quantity, elementId, level, status, surface, face, source }) {
  const pc = spec.needsProduct && !product;
  const row = {
    category: "Finishes",
    model: finishRateModel(product, category),
    family: spec.label,
    type: product
      ? [product.name || product.code || spec.label, product.size].filter(Boolean).join(", ")
      : (pc ? `${spec.label}, ${PC_ALLOWANCE_LABEL}` : spec.label),
    elementId,
    count: 1,
    unit: spec.unit,
    rateRef: product?.rateRef ?? null,
    colourClass: "other",
    status,
    level,
    kind: null,
    finish: true,
    finishCategory: category,
    surface,
    source,
  };
  if (face) row.face = face;
  if (spec.unit === "m") row.length = quantity;
  else row.area = quantity;
  if (pc) row.pcAllowance = true;
  if (product) row.productId = product.id;
  // Waste stays beside the measured quantity; boxes only where coverage is stated.
  if (product && product.wasteFactor !== null) {
    row.wasteFactor = product.wasteFactor;
    row.orderQuantity = quantity * (1 + product.wasteFactor);
  }
  if (product && product.boxCoverage !== null && spec.unit === "m2") {
    row.boxes = quantity * (1 + (product.wasteFactor || 0)) / product.boxCoverage;
  }
  void doc;
  return row;
}

/**
 * The bands to draw on one wall face, in viewing order. A mirrored face
 * (side -1) reads right to left from the wall's first end.
 */
export function faceFinishBands(doc, pack, walls, wall, side, { wallBases = null } = {}) {
  const { bands, removed } = resolveFinishes(doc, pack, walls, { wallBases, onlyWallId: wall.id });
  const flip = side === -1;
  return [...bands, ...removed]
    .filter((b) => b.wallId === wall.id && b.side === (flip ? -1 : 1))
    .map((b) => ({
      id: b.id,
      source: b.source,
      sourceId: b.sourceId,
      category: b.category,
      productId: b.productId,
      label: FINISH_CATEGORIES[b.category]?.label || b.category,
      from: flip ? wall.length - b.to : b.from,
      to: flip ? wall.length - b.from : b.to,
      bottom: b.bottom,
      top: b.top,
      quantity: b.quantity,
      unit: b.unit,
      outline: b.outline ? b.outline.map(([s, z]) => [flip ? wall.length - s : s, z]) : null,
      editable: b.source === "run" || b.source === "rule",
    }));
}

/**
 * Stripes for the plan: one per stretch of wall face that has a finish someone
 * set (a room rule or a run). The computed plaster default is left out, since
 * it covers every plastered face, and so is "no finish".
 *
 * A skirting is its own mark (`skirting`), drawn dashed. `beside` means a face
 * finish shares that stretch, so the skirting sits just outside it.
 * Where two face finishes cover the same stretch, the one that runs further
 * up the wall is the one shown.
 *
 * Each mark carries the centreline of its stretch and a unit normal pointing
 * to the finished side, which is the side the stripe is drawn on.
 */
export function planWallFinishMarks(doc, pack, walls) {
  if (!doc || !pack || !walls?.length) return [];
  const { bands } = resolveFinishes(doc, pack, walls);
  const explicit = bands.filter((b) => b.source !== "default" && b.category !== "none");
  const byWall = new Map();
  for (const band of explicit) {
    if (!byWall.has(band.wallId)) byWall.set(band.wallId, []);
    byWall.get(band.wallId).push(band);
  }
  const marks = [];
  for (const wall of walls) {
    const list = byWall.get(wall.id);
    const len = wall.length || Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    if (!list?.length || len < 1e-4) continue;
    for (const side of [1, -1]) {
      const onSide = list.filter((b) => b.side === side);
      if (!onSide.length) continue;
      const roomIds = [...roomsBySide(doc, wall)[side]];
      const skirt = onSide.filter((b) => FINISH_CATEGORIES[b.category]?.unit === "m");
      const face = onSide.filter((b) => FINISH_CATEGORIES[b.category]?.unit !== "m");
      const faceMarks = sweepFinishSpans(face);
      const skirtMarks = sweepFinishSpans(skirt);
      const overlaps = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from) > 1e-3;
      for (const span of faceMarks) marks.push(finishMark(wall, side, len, span, roomIds, false, false));
      for (const span of skirtMarks) {
        marks.push(finishMark(wall, side, len, span, roomIds, true, faceMarks.some((f) => overlaps(f, span))));
      }
    }
  }
  return marks;
}

/** Merge overlapping bands on one face into spans, keeping the taller finish. */
function sweepFinishSpans(bands) {
  if (!bands.length) return [];
  const cuts = [];
  for (const band of bands) cuts.push(band.from, band.to);
  cuts.sort((a, b) => a - b);
  const xs = [];
  for (const x of cuts) {
    if (!xs.length || x - xs[xs.length - 1] > 1e-4) xs.push(x);
  }
  const out = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const from = xs[i];
    const to = xs[i + 1];
    const mid = (from + to) / 2;
    const covering = bands.filter((b) => b.from - 1e-4 <= mid && b.to + 1e-4 >= mid);
    if (!covering.length) continue;
    covering.sort((p, q) => {
      const taller = (q.top - q.bottom) - (p.top - p.bottom);
      if (Math.abs(taller) > 1e-6) return taller;
      const product = (b) => (FINISH_CATEGORIES[b.category]?.needsProduct ? 1 : 0);
      const ranked = product(q) - product(p);
      if (ranked) return ranked;
      return String(p.category).localeCompare(String(q.category));
    });
    const winner = covering[0];
    const prev = out[out.length - 1];
    if (prev && prev.category === winner.category && Math.abs(prev.to - from) < 1e-3) {
      prev.to = to;
    } else {
      out.push({
        from,
        to,
        category: winner.category,
        label: FINISH_CATEGORIES[winner.category]?.label || winner.category,
      });
    }
  }
  return out;
}

function finishMark(wall, side, len, span, roomIds, skirting, beside) {
  const n = wallNormal(wall, side);
  const a = pointOnWall(wall, span.from / len);
  const b = pointOnWall(wall, span.to / len);
  return {
    wallId: wall.id,
    side,
    from: span.from,
    to: span.to,
    category: span.category,
    label: span.label,
    skirting,
    beside,
    roomIds,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    nx: n.x,
    ny: n.y,
  };
}

// --- presets ---------------------------------------------------------------

export function presetFromRoom(room, name) {
  const rules = (room.finishes || []).map(({ id, ...rest }) => rest);
  return rules.length && name ? { id: finishId("fp"), name, use: room.use || null, rules } : null;
}

export function presetsForUse(doc, use) {
  const all = doc.finishPresets || [];
  return use ? [...all.filter((p) => p.use === use), ...all.filter((p) => p.use !== use)] : all;
}

/** A preset's rules as fresh rules for a room (new ids, so editing one never edits the preset). */
export function rulesFromPreset(preset) {
  return (preset?.rules || []).map((r) => ({ ...r, id: finishId("fr") }));
}

export function savePreset(doc, preset) {
  if (!preset) return null;
  const next = normalizeFinishPresets([preset]);
  if (!next.length) return null;
  doc.finishPresets = [...(doc.finishPresets || []).filter((p) => p.name !== preset.name), next[0]];
  return next[0];
}

/**
 * The firm rate-book line for a product ("Save to firm library"). The rate is
 * left blank: the firm prices it, we never guess. Returns the line and the
 * model code it is filed under, which the caller stores as the product's rateRef.
 */
export function libraryLine(product) {
  const spec = FINISH_CATEGORIES[product.category];
  const model = product.rateRef || product.code || product.id;
  return {
    model,
    category: "Finishes",
    description: [spec.label, product.name, product.size].filter(Boolean).join(", "),
    unit: spec.unit,
    rate: null,
  };
}
