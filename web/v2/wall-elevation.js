// Wall elevation (aansig): one face of one wall, drawn as it is seen standing
// in front of it. Pure model and edit functions; the inspector preview and the
// strip under the plan (ui.js) draw what `elevationModel` returns.
//
// A face reference is `{ wallId, side }` and only lives while something is
// selected, so the instability of room-derived wall ids does not matter here.
// `side` is 1 or -1: the viewer stands on the `wallNormal(wall, side)` side.
// The plan is y-down, so side 1 reads left to right from the wall's first
// end; side -1 is mirrored. Offsets in the model are always in viewing order.

import { defaultWallTop, isReferenceLevel, levelAboveRise } from "./level-view.js";
import { levelElevation, resolvedBase } from "./compile.js";
import { nid } from "./model.js";
import { foundationStorey, isFoundationLevel } from "./placement-warn.js";
import { archRise, fitArchSize } from "./arch-head.js";
import {
  isArchHead,
  openingOnWall,
  openingSize,
  roomEdgeSegment,
  skuById,
  wallForOpening,
  wallNormal,
  wallT,
} from "./openings.js";
import { joinedWallPolygon } from "./drawing-defaults.js";
import { deriveWalls, drawnSegmentFromWall, skuDrawnHeight } from "./walls.js";
import { faceArcScale, faceFinishBands, reanchorRun } from "./finish-model.js";

/** Drags and typed values snap to this, metres. */
export const ELEVATION_SNAP = 0.05;

const DEFAULT_WINDOW_SILL = 0.9;

export function snapElevation(value, step = ELEVATION_SNAP) {
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}

/**
 * Height of a construction line measured down from the top of the wall.
 * `offsetMm` is what the user typed. The result is metres up from the base,
 * so a finish corner can snap to it. Blank, zero, or past the wall is no line.
 */
export function dropGuideZ(heightM, offsetMm) {
  const mm = Number(offsetMm);
  if (!Number.isFinite(heightM) || heightM <= 0) return null;
  if (!Number.isFinite(mm) || mm <= 0) return null;
  const z = heightM - mm / 1000;
  if (z < -1e-6 || z > heightM + 1e-6) return null;
  return Math.max(0, Math.min(heightM, Math.round(z * 1000) / 1000));
}

/** Snap targets for an elevation point, plus the drop guideline when it exists. */
export function includeDropGuide(targets, z) {
  if (!Number.isFinite(z)) return targets;
  return targets.includes(z) ? targets : [...targets, z];
}

function normSide(side) {
  return side === -1 ? -1 : 1;
}

/**
 * The face a selection should show: a selected opening shows its wall, a
 * selected drawn wall shows itself. `side` is kept from `prefer` when it is
 * still the same wall, so flipping the face survives re-selecting.
 */
export function faceRefForSelection(doc, pack, walls, ref, prefer = null) {
  if (!ref) return null;
  let wallId = null;
  if (ref.kind === "segment") {
    wallId = ref.id;
  } else if (ref.kind === "opening") {
    const opening = (doc.openings || []).find((o) => o.id === ref.id);
    const wall = opening ? wallForOpening(doc, pack, walls, opening) : null;
    wallId = wall?.id ?? null;
  }
  if (!wallId || !walls.some((w) => w.id === wallId)) return null;
  const side = prefer?.wallId === wallId ? normSide(prefer.side) : 1;
  return { wallId, side };
}

/** Where an opening's bottom sits above its base, metres: the sill for a
 * window, the floor for a door. */
function openingSill(pack, opening) {
  const sku = skuById(pack, opening.sku);
  const size = openingSize(pack, opening);
  if (Number.isFinite(size.sill)) return size.sill;
  return sku?.category === "window" ? DEFAULT_WINDOW_SILL : 0;
}

/**
 * The line the wall is judged against: the next storey's floor, or the roof
 * eaves when this is the top storey. Absolute elevation. Null when the pack
 * states neither a storey above nor a floor-to-floor height.
 */
function heightGuide(pack, wall) {
  const levels = pack?.levels || [];
  const level = levels.find((l) => l.id === wall.level);
  if (!level || !Number.isFinite(level.elevation)) return null;
  const rise = levelAboveRise(levels, wall.level);
  if (rise !== null) {
    const above = levels
      .filter((l) => Number.isFinite(l.elevation) && l.elevation > level.elevation + 1e-6 && !isReferenceLevel(l) && !l.parentId)
      .sort((a, b) => a.elevation - b.elevation)[0];
    if (!above) return null;
    return { elevation: above.elevation, kind: "floor", id: above.id, name: above.name || above.id };
  }
  if (Number.isFinite(level.floorToFloor) && level.floorToFloor > 0) {
    return { elevation: level.elevation + level.floorToFloor, kind: "roof", id: null, name: "Roof" };
  }
  return null;
}

/**
 * The stretch of one face as the plan paints it. The plan mitres a wall into
 * its neighbours, so an outside face runs past the centreline end and an
 * inside face stops short of it. Stations are measured along the wall from the
 * viewer's left (`side` -1 reads from the second end), like every other offset.
 */
export function faceExtent(wall, all, side) {
  const length = wall.length;
  const whole = { from: 0, to: length };
  // Stations stay on the centreline. The developed face is longer on the
  // outside of a curve and shorter on the inside; that scale is applied when
  // the face is measured. The straight mitre outline is only the chord, and
  // reading it in these stations would shorten the face.
  if (wall?.arc) return whole;
  if (!(wall.thickness > 0) || !(length > 1e-6)) return whole;
  const sameLevel = (all || []).filter((w) => w.level === wall.level);
  const poly = joinedWallPolygon(wall, sameLevel);
  if (!poly) return whole;
  const ux = (wall.x2 - wall.x1) / length;
  const uy = (wall.y2 - wall.y1) / length;
  const station = (p) => (p.x - wall.x1) * ux + (p.y - wall.y1) * uy;
  // Polygon order: start left, end left, end right, start right.
  const [a, b] = side === -1 ? [poly[3], poly[2]] : [poly[0], poly[1]];
  const sa = station(a);
  const sb = station(b);
  if (!Number.isFinite(sa) || !Number.isFinite(sb) || sb - sa < 1e-3) return whole;
  return side === -1 ? { from: length - sb, to: length - sa } : { from: sa, to: sb };
}

/** Height a wall keeps when its own override is cleared: up to the level above, else the type. */
function naturalWallHeight(pack, wall) {
  const typeH = skuDrawnHeight(skuById(pack, wall.sku));
  const rise = levelAboveRise(pack.levels, wall.level);
  return (defaultWallTop(pack.levels, wall.level, typeH) ? rise : null) ?? typeH ?? pack.system?.wallHeight ?? null;
}

/**
 * Everything the elevation needs for one wall face, or `null` when the wall
 * no longer exists.
 *
 * Heights are absolute (level datum plus offset), `base` and `top` bound the
 * wall, and each opening's `sill` is measured up from `base`. `guide` is the
 * next floor or the roof, kept even when the wall stops short of it.
 * `foundationSku` previews that footing under a bare wall; omitted, the job's
 * default foundation is used.
 */
export function elevationModel(doc, pack, faceRef, walls = null, foundationSku = null) {
  if (!doc || !pack || !faceRef?.wallId) return null;
  const all = walls || deriveWalls(doc, pack);
  const wall = all.find((w) => w.id === faceRef.wallId);
  if (!wall) return null;
  const side = normSide(faceRef.side);
  const flip = side === -1;
  const length = wall.length;
  const extent = faceExtent(wall, all, side);
  const faceScale = faceArcScale(wall, side);

  const sku = skuById(pack, wall.sku);
  const resolved = resolvedBase(doc, pack, wall, wall.height || sku?.geometry?.height || pack.system?.wallHeight || 0);
  const base = resolved.elevation;
  const top = base + resolved.height;

  const openings = [];
  for (const opening of doc.openings || []) {
    const host = wallForOpening(doc, pack, all, opening);
    if (!host || host.id !== wall.id) continue;
    const placed = openingOnWall(doc, pack, opening, host);
    const size = openingSize(pack, opening);
    const width = placed.width;
    const fromA = placed.t * length - width / 2;
    const offset = flip ? length - (fromA + width) : fromA;
    const height = Number.isFinite(size.height) ? size.height : 0;
    const category = placed.sku?.category || "window";
    openings.push({
      id: opening.id,
      sku: opening.sku,
      name: placed.sku?.name || opening.sku,
      category,
      head: isArchHead(placed.sku) ? "arch" : null,
      rise: isArchHead(placed.sku) ? archRise(width, opening.rise) : null,
      offset,
      width,
      sill: openingSill(pack, opening),
      height,
      nonStandard: Boolean(size.nonStandard),
    });
  }
  openings.sort((a, b) => a.offset - b.offset);

  const foundations = foundationsUnder(doc, pack, wall, all, base, flip);
  // Nothing under this wall yet, and it starts on the ground storey: the
  // elevation can place the job's default footing. A wall that starts at the
  // next floor already sits on that floor.
  const foundationOffer = wall.category === "foundation" || foundations.length
    ? null
    : foundationOfferFor(pack, base, foundationSku);

  const levels = (pack.levels || [])
    .filter((l) => Number.isFinite(l.elevation))
    .map((l) => ({
      id: l.id,
      name: l.name || l.id,
      elevation: l.elevation,
      kind: isReferenceLevel(l) ? "reference" : "level",
    }))
    .sort((a, b) => a.elevation - b.elevation);

  return {
    wallId: wall.id,
    side,
    flip,
    drawn: Boolean(wall.drawn),
    sku: wall.sku,
    name: sku?.name || wall.sku,
    level: wall.level,
    length,
    // Where this side's face begins and ends, in the same stations as `length`
    // (viewing order). Corner joins push it past 0 / length or pull it short.
    // `length` stays the centreline, which openings and finish stations use.
    // `faceScale` turns those stations into the developed length of this face.
    faceFrom: extent.from,
    faceTo: extent.to,
    faceScale,
    faceLength: (extent.to - extent.from) * faceScale,
    base,
    top,
    height: top - base,
    thickness: wall.thickness,
    attachedTo: resolved.attachedTo?.label || null,
    heightConflict: wall.heightConflict || null,
    openings,
    // Foundations on this line, in viewing order. `from`/`to` run along the
    // face; `base` and `top` are absolute, and `top` never rises above this wall.
    foundations,
    // Null once a footing is already under this wall, or the wall starts higher
    // than the ground storey. `base`/`top` are absolute; `top` is this wall's base.
    foundationOffer,
    // Finish bands in viewing order, heights above `base`. Room rules and
    // runs are editable; the computed plaster default is not.
    finishBands: faceFinishBands(doc, pack, all, wall, side, {
      wallBases: new Map([[wall.id, { height: resolved.height }]]),
    }),
    // Ends of walls that come out of this face, in viewing order. Each strip
    // is as wide as that wall is where it meets the face. The run stays one
    // wall; the strip is the other wall, covering this face.
    projections: protrudingWalls(doc, pack, wall, all, side, extent, base, top),
    levels,
    guide: heightGuide(pack, wall),
    canDragTop: wall.category !== "foundation",
  };
}

/** How far a wall may stop short of this face and still read as joining it, metres. */
const PROTRUSION_REACH = 0.05;

/**
 * Walls whose body comes toward the viewer through this face. A cross shows
 * on both faces. A tee shows only on the side it enters the room. A return
 * that only bounds the end of the face leaves no strip. Offsets are centreline
 * stations, then flipped into viewing order like every other offset.
 */
function protrudingWalls(doc, pack, wall, all, side, extent, wallBase, wallTop) {
  if (wall.arc || !(wall.thickness > 0) || !(wall.length > 1e-6)) return [];
  const length = wall.length;
  const ux = (wall.x2 - wall.x1) / length;
  const uy = (wall.y2 - wall.y1) / length;
  const n = wallNormal(wall, side);
  const half = wall.thickness / 2;
  const flip = side === -1;
  const face = flip
    ? { from: length - extent.to, to: length - extent.from }
    : extent;
  const origin = { x: wall.x1, y: wall.y1 };
  const out = [];
  for (const other of all) {
    if (!other || other.id === wall.id || other.arc) continue;
    if (other.level !== wall.level || other.category === "foundation") continue;
    const olen = other.length || Math.hypot(other.x2 - other.x1, other.y2 - other.y1);
    if (!(olen > 1e-6) || !(other.thickness > 0)) continue;
    const oux = (other.x2 - other.x1) / olen;
    const ouy = (other.y2 - other.y1) / olen;
    if (Math.abs(oux * ux + ouy * uy) >= 0.996) continue;
    const poly = wallRect(other, olen);
    const signed = poly.map((p) => (p.x - origin.x) * n.x + (p.y - origin.y) * n.y - half);
    const minS = Math.min(...signed);
    const maxS = Math.max(...signed);
    if (!(maxS > 0.01) || minS > PROTRUSION_REACH) continue;
    // Across the face when the body passes through it. Otherwise the nearest
    // line of a wall that stops just short, which is its end.
    const at = minS < -0.005 ? 0 : minS;
    const hits = stationsOnOffset(poly, origin, { x: ux, y: uy }, n, half + at);
    if (hits.length < 2) continue;
    let from = Math.max(face.from, Math.min(...hits));
    let to = Math.min(face.to, Math.max(...hits));
    if (to - from < 0.02) continue;
    const sku = skuById(pack, other.sku);
    const height = other.height || skuDrawnHeight(sku) || 0;
    if (!(height > 0)) continue;
    const resolved = resolvedBase(doc, pack, other, height);
    const base = Math.max(wallBase, resolved.elevation);
    const top = Math.min(wallTop, resolved.elevation + resolved.height);
    if (top - base < 0.02) continue;
    if (flip) {
      const mirroredFrom = length - to;
      to = length - from;
      from = mirroredFrom;
    }
    out.push({
      id: other.id,
      name: sku?.name || other.sku,
      from,
      to,
      base,
      top,
    });
  }
  out.sort((a, b) => a.from - b.from || a.base - b.base);
  return out;
}

function wallRect(wall, length) {
  const ux = (wall.x2 - wall.x1) / length;
  const uy = (wall.y2 - wall.y1) / length;
  const hx = -uy * wall.thickness / 2;
  const hy = ux * wall.thickness / 2;
  return [
    { x: wall.x1 + hx, y: wall.y1 + hy },
    { x: wall.x2 + hx, y: wall.y2 + hy },
    { x: wall.x2 - hx, y: wall.y2 - hy },
    { x: wall.x1 - hx, y: wall.y1 - hy },
  ];
}

/** Stations where `poly` crosses the line `origin + n*offset`, measured along `u`. */
function stationsOnOffset(poly, origin, u, n, offset) {
  const fx = origin.x + n.x * offset;
  const fy = origin.y + n.y * offset;
  const dist = (p) => (p.x - fx) * n.x + (p.y - fy) * n.y;
  const station = (p) => (p.x - origin.x) * u.x + (p.y - origin.y) * u.y;
  const hits = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = dist(p);
    const dq = dist(q);
    if (Math.abs(dp) <= 0.003 && Math.abs(dq) <= 0.003) {
      hits.push(station(p), station(q));
      continue;
    }
    if (dp * dq > 0) continue;
    const denom = dp - dq;
    if (Math.abs(denom) < 1e-12) continue;
    const t = dp / denom;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    hits.push(station({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }));
  }
  return hits;
}

/**
 * Foundations that belong under this wall: parallel, close enough in plan to
 * be the footing of this line, and overlapping it. Only the part below the
 * wall's base is returned, so a foundation that rises into the storey is not
 * painted over the wall. Offsets are in viewing order.
 */
function foundationsUnder(doc, pack, wall, all, wallBase, flip) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const along = (x, y) => (x - wall.x1) * ux + (y - wall.y1) * uy;
  const perp = (x, y) => (x - wall.x1) * uy - (y - wall.y1) * ux;
  const out = [];
  for (const found of all) {
    if (found.id === wall.id || found.category !== "foundation") continue;
    const fdx = found.x2 - found.x1;
    const fdy = found.y2 - found.y1;
    const fl = Math.hypot(fdx, fdy) || 1;
    if (Math.abs((fdx / fl) * ux + (fdy / fl) * uy) < 0.996) continue;
    const reach = (wall.thickness + found.thickness) / 2 + 0.05;
    if (Math.abs(perp((found.x1 + found.x2) / 2, (found.y1 + found.y2) / 2)) > reach) continue;
    let a = along(found.x1, found.y1);
    let b = along(found.x2, found.y2);
    if (a > b) [a, b] = [b, a];
    let from = Math.max(0, a);
    let to = Math.min(wall.length, b);
    if (to - from < 0.02) continue;
    const sku = skuById(pack, found.sku);
    const height = found.height || skuDrawnHeight(sku) || 0;
    if (!(height > 0)) continue;
    const resolved = resolvedBase(doc, pack, found, height);
    const footBase = resolved.elevation;
    const footTop = Math.min(footBase + resolved.height, wallBase);
    if (footTop - footBase < 0.02) continue;
    if (flip) {
      const mirroredFrom = wall.length - to;
      to = wall.length - from;
      from = mirroredFrom;
    }
    out.push({
      id: found.id,
      name: sku?.name || found.sku,
      from,
      to,
      base: footBase,
      top: footTop,
      depth: footTop - footBase,
    });
  }
  out.sort((a, b) => a.from - b.from || a.base - b.base);
  return out;
}

/** True when `wallBase` is still on the ground storey, below the next floor. */
function footingBelongsUnder(pack, wallBase) {
  if (!Number.isFinite(wallBase)) return false;
  const storeys = (pack?.levels || [])
    .filter((l) => Number.isFinite(l.elevation) && !l.parentId && !isReferenceLevel(l) && !isFoundationLevel(l))
    .sort((a, b) => a.elevation - b.elevation);
  const above = storeys[1];
  if (!storeys[0] || !above) return Boolean(storeys[0]);
  return wallBase < above.elevation - 0.05;
}

/** Foundation types the elevation can place, in catalogue order. */
export function foundationTypes(pack) {
  const out = [];
  for (const sku of pack?.skus || []) {
    if (sku.category !== "foundation") continue;
    const depth = skuDrawnHeight(sku);
    if (!(depth > 0)) continue;
    out.push({ id: sku.id, name: sku.name || sku.id, depth });
  }
  return out;
}

/**
 * The footing the elevation would add under a bare ground-storey wall.
 * `skuId` picks one of `foundationTypes`; anything else falls back to the
 * job's default, then the first type that has a depth. The top meets the
 * wall's base. Null when this wall does not take a footing.
 */
function foundationOfferFor(pack, wallBase, skuId) {
  if (!footingBelongsUnder(pack, wallBase)) return null;
  const types = foundationTypes(pack);
  if (!types.length) return null;
  const chosen = types.find((t) => t.id === skuId)
    || types.find((t) => t.id === pack?.system?.defaultFoundationSku)
    || types[0];
  return {
    skuId: chosen.id,
    name: chosen.name,
    depth: chosen.depth,
    base: wallBase - chosen.depth,
    top: wallBase,
  };
}

/**
 * Draw a foundation along this wall, top flush with the wall base. `skuId`
 * chooses the type; omitted, the job's default is used. Filed on the
 * foundation storey when the pack has one, otherwise on the wall's own level
 * with the offset that puts it in the ground. Mutates `doc` (the caller owns
 * undo and persist). Returns the new segment, or null when this wall already
 * has a footing or should not gain one.
 */
export function addFoundationUnderWall(doc, pack, faceRef, walls = null, skuId = null) {
  const all = walls || deriveWalls(doc, pack);
  const wall = all.find((w) => w.id === faceRef?.wallId);
  if (!wall || wall.category === "foundation") return null;
  const offer = elevationModel(doc, pack, faceRef, all, skuId)?.foundationOffer;
  if (!offer) return null;
  const home = foundationStorey(pack.levels || []);
  const levelId = home?.id || wall.level;
  const seg = {
    id: nid("s"),
    sku: offer.skuId,
    level: levelId,
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
    status: wall.status === "existing" ? "existing" : "planned",
    baseOffset: Math.round((offer.base - levelElevation(pack, levelId)) * 1000) / 1000,
  };
  (doc.segments || (doc.segments = [])).push(seg);
  return { id: seg.id, name: offer.name };
}

/**
 * Set one wall's height from the elevation, in metres above its base.
 * Snaps to `ELEVATION_SNAP`, stays tall enough for the openings already in
 * it, and will not go above the next floor or roof (or above the height it
 * already had, when that is taller). Landing on the wall's natural height
 * clears the override, the same as blanking the inspector field.
 *
 * A room-derived wall has no height of its own. A drag that actually changes
 * it becomes one drawn wall at that height, so the rest of the room stays
 * as it was. Releasing where the drag started leaves the room wall alone.
 *
 * Mutates `doc` (the caller owns undo and persist). Returns the stored
 * height and the wall id the face should follow, or `null`.
 */
export function applyWallTopEdit(doc, pack, faceRef, height, walls = null) {
  const all = walls || deriveWalls(doc, pack);
  const wall = all.find((w) => w.id === faceRef?.wallId);
  if (!wall || wall.category === "foundation") return null;
  const model = elevationModel(doc, pack, faceRef, all);
  if (!model || !Number.isFinite(height)) return null;

  const heads = model.openings.reduce((m, o) => Math.max(m, (o.sill || 0) + (o.height || 0)), 0);
  const minH = Math.max(ELEVATION_SNAP, heads);
  let h = Math.max(minH, snapElevation(height));
  const guideH = model.guide && model.guide.elevation > model.base + 1e-6
    ? model.guide.elevation - model.base
    : null;
  if (guideH != null && Math.abs(h - guideH) <= ELEVATION_SNAP / 2 + 1e-9) {
    h = Math.round(guideH * 1000) / 1000;
  }
  const cap = Math.max(model.height, guideH && guideH > 0 ? guideH : 0);
  h = Math.min(Math.max(h, minH), Math.max(cap, minH));

  const natural = naturalWallHeight(pack, wall);
  const restored = natural != null && Math.abs(h - natural) < 1e-3;
  if (!wall.drawn && Math.abs(h - model.height) < 1e-3) {
    return { height: model.height, wallId: wall.id };
  }

  const write = (seg) => {
    if (restored) {
      seg.height = null;
      seg.top = defaultWallTop(pack.levels, wall.level, skuDrawnHeight(skuById(pack, wall.sku)));
    } else {
      seg.height = h;
      seg.top = null;
    }
  };

  if (wall.drawn) {
    const seg = (doc.segments || []).find((s) => s.id === wall.id);
    if (!seg) return null;
    write(seg);
    followWallTop(doc, wall.id, model.height, h);
    return { height: h, wallId: wall.id };
  }

  const seg = drawnSegmentFromWall(wall, pack);
  if (!seg) return null;
  write(seg);
  for (const run of doc.finishRuns || []) {
    if (run.wallId === wall.id) run.wallId = seg.id;
  }
  (doc.segments || (doc.segments = [])).push(seg);
  followWallTop(doc, seg.id, model.height, h);
  return { height: h, wallId: seg.id };
}

/**
 * A finish whose top was the top of the wall stays there. A blank top already
 * means "the top of the wall". A drawn corner that sat on the old top moves
 * with it, and so does a stored top that was that same height.
 */
function followWallTop(doc, wallId, oldH, newH) {
  if (!(oldH > 0) || !(newH > 0) || Math.abs(oldH - newH) < 1e-6) return;
  const onTop = (z) => Number.isFinite(z) && Math.abs(z - oldH) <= ELEVATION_SNAP / 2 + 1e-9;
  for (const run of doc.finishRuns || []) {
    if (run.wallId !== wallId) continue;
    if (Array.isArray(run.outline) && run.outline.length >= 3) {
      run.outline = run.outline.map(([s, z]) => {
        if (onTop(z)) return [s, newH];
        return [s, z > newH ? newH : z];
      });
      const zs = run.outline.map((p) => p[1]);
      run.bottom = Math.max(0, Math.min(...zs));
      run.top = Math.max(...zs);
      continue;
    }
    // A blank top is already "the top of the wall". A number that was that
    // height becomes blank, so the next change follows too.
    if (run.top == null) continue;
    if (onTop(run.top)) run.top = null;
  }
}

/** The opening's anchor `t` that puts its centre `fromA` metres from the wall's first end. */
function anchorT(doc, wall, opening, fromA) {
  const length = wall.length || 1;
  const wt = Math.min(1, Math.max(0, fromA / length));
  if (opening.wallId) return wt;
  const room = (doc.rooms || []).find((r) => r.id === opening.roomId);
  const edge = room ? roomEdgeSegment(room, opening.edgeIndex ?? 0) : null;
  if (!edge) return wt;
  const x = wall.x1 + (wall.x2 - wall.x1) * wt;
  const y = wall.y1 + (wall.y2 - wall.y1) * wt;
  return wallT(edge, x, y);
}

/**
 * Move or resize one opening from the elevation. `edit` is in viewing
 * coordinates: `left` (from the left end of the face), `width`, `sill`
 * and `height`; any field left out stays as it is. Values snap to
 * `ELEVATION_SNAP` and are clamped to the wall face. A size equal to the
 * type's own is stored as no override, like the inspector fields.
 *
 * Mutates `doc` (the caller owns undo and persist). Returns the values it
 * stored, or `null` when the opening or wall cannot be found.
 */
export function applyOpeningEdit(doc, pack, faceRef, openingId, edit, walls = null) {
  const model = elevationModel(doc, pack, faceRef, walls);
  const opening = (doc.openings || []).find((o) => o.id === openingId);
  const row = model?.openings.find((o) => o.id === openingId);
  if (!model || !opening || !row) return null;
  const all = walls || deriveWalls(doc, pack);
  const wall = all.find((w) => w.id === model.wallId);

  const pick = (v, fallback) => (Number.isFinite(v) ? snapElevation(v) : fallback);
  let width = Math.max(ELEVATION_SNAP, pick(edit.width, row.width));
  let height = Math.max(ELEVATION_SNAP, pick(edit.height, row.height));
  let sill = Math.max(0, pick(edit.sill, row.sill));
  let left = pick(edit.left, row.offset);

  width = Math.min(width, model.length);
  left = Math.min(Math.max(0, left), Math.max(0, model.length - width));
  if (sill + height > model.height) {
    if (Number.isFinite(edit.height) && !Number.isFinite(edit.sill)) height = Math.max(ELEVATION_SNAP, model.height - sill);
    else sill = Math.max(0, model.height - height);
  }

  const sku = skuById(pack, opening.sku);
  const arch = isArchHead(sku);
  if (arch) {
    // A typed rise at or above half the width is a semicircle, and follows
    // later width changes. A rise already stored stays put when the width
    // shrinks past it: the head is drawn at the cap, and widening restores it.
    if (Number.isFinite(edit.rise)) {
      const snapped = snapElevation(Math.max(ELEVATION_SNAP, edit.rise));
      opening.rise = snapped < width / 2 - 0.0005 ? snapped : null;
    }
    let rise = fitArchSize(width, height, opening.rise).rise;
    height = Math.max(height, rise);
    if (sill + height > model.height) {
      sill = Math.max(0, model.height - height);
      if (sill + height > model.height) {
        height = Math.max(ELEVATION_SNAP, model.height);
        sill = 0;
        if (height + 1e-9 < rise) {
          if (opening.rise == null) {
            width = Math.min(model.length, height * 2);
            left = Math.min(left, Math.max(0, model.length - width));
          } else {
            opening.rise = height < width / 2 - 0.0005 ? height : null;
          }
          rise = fitArchSize(width, height, opening.rise).rise;
          height = Math.max(height, rise);
        }
      }
    }
  }

  const centre = left + width / 2;
  const fromA = model.flip ? model.length - centre : centre;
  opening.t = anchorT(doc, wall, opening, fromA);

  const g = sku?.geometry || {};
  const store = (field, value) => {
    const own = g[field];
    opening[field] = Number.isFinite(own) && Math.abs(own - value) < 0.0005 ? null : value;
  };
  if (Number.isFinite(edit.width) || Number.isFinite(edit.left)) store("width", width);
  if (Number.isFinite(edit.height) || arch) store("height", height);
  if (Number.isFinite(edit.sill)) {
    // A door's floor-level sill is not an override. A plain opening can be raised.
    if (sku?.category === "window" || sku?.category === "opening") store("sill", sill);
  }
  return { left, width, sill, height };
}

/**
 * Move or resize one finish band from the elevation. `edit` is in viewing
 * coordinates (`from`, `to` along the face; `bottom`, `top` above the wall's
 * base); anything left out stays. A run keeps all four. A room rule is one
 * rule for every face of that room, so only its heights can change here.
 * The computed plaster default is not editable. Snaps like openings do.
 *
 * Mutates `doc` (the caller owns undo and persist). Returns the stored span
 * or `null`.
 */
export function applyBandEdit(doc, pack, faceRef, bandId, edit, walls = null) {
  const model = elevationModel(doc, pack, faceRef, walls);
  const band = model?.finishBands.find((b) => b.id === bandId);
  if (!model || !band || !band.editable) return null;
  const all = walls || deriveWalls(doc, pack);
  const wall = all.find((w) => w.id === model.wallId);

  const pick = (v, fallback) => (Number.isFinite(v) ? snapElevation(v) : fallback);
  let bottom = Math.max(0, pick(edit.bottom, band.bottom));
  let top = Math.min(model.height, pick(edit.top, band.top));
  if (top - bottom < ELEVATION_SNAP) {
    if (Number.isFinite(edit.top) && !Number.isFinite(edit.bottom)) top = Math.min(model.height, bottom + ELEVATION_SNAP);
    else bottom = Math.max(0, top - ELEVATION_SNAP);
  }
  const storedTop = top >= model.height - 1e-6 ? null : top;

  if (band.source === "rule") {
    const room = (doc.rooms || []).find((r) => (r.finishes || []).some((x) => x.id === band.sourceId));
    const rule = room?.finishes.find((x) => x.id === band.sourceId);
    if (!rule) return null;
    rule.bottom = bottom;
    rule.top = storedTop;
    return { bottom, top };
  }

  const run = (doc.finishRuns || []).find((r) => r.id === band.sourceId);
  if (!run) return null;
  let from = Math.max(0, pick(edit.from, band.from));
  let to = Math.min(model.length, pick(edit.to, band.to));
  if (to - from < ELEVATION_SNAP) {
    if (Number.isFinite(edit.to) && !Number.isFinite(edit.from)) to = Math.min(model.length, from + ELEVATION_SNAP);
    else from = Math.max(0, to - ELEVATION_SNAP);
  }
  const whole = from <= 1e-6 && to >= model.length - 1e-6;
  run.wallId = model.wallId;
  run.side = model.side;
  run.a = whole ? null : (model.flip ? model.length - to : from);
  run.b = whole ? null : (model.flip ? model.length - from : to);
  run.bottom = bottom;
  run.top = storedTop;
  reanchorRun(run, wall);
  return { from, to, bottom, top };
}

/**
 * Replace a drawn finish's corners. `points` are in viewing coordinates
 * ({ s, z }: along the face from the left, up from the base). Stored from the
 * wall's first end. Mutates `doc`; the caller owns undo.
 */
export function applyOutlinePoints(doc, pack, faceRef, bandId, points, walls = null) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const all = walls || deriveWalls(doc, pack);
  const model = elevationModel(doc, pack, faceRef, all);
  const band = model?.finishBands.find((b) => b.id === bandId);
  const run = band?.source === "run" ? (doc.finishRuns || []).find((r) => r.id === band.sourceId) : null;
  const wall = all.find((w) => w.id === model?.wallId);
  if (!model || !run || !wall) return null;
  const outline = points.map((p) => [model.flip ? model.length - p.s : p.s, p.z]);
  const ss = outline.map((p) => p[0]);
  const zs = outline.map((p) => p[1]);
  run.outline = outline;
  run.a = Math.min(...ss);
  run.b = Math.max(...ss);
  run.bottom = Math.max(0, Math.min(...zs));
  run.top = Math.max(...zs);
  reanchorRun(run, wall);
  return run;
}

/**
 * Nudge a rigid move so a corner of `origin` lands on a target. `ds` and `dz`
 * are the pointer's move, in metres. A guide is the target that won that axis,
 * and is null when nothing was within `reach`. The caller drops a guide again
 * if clamping the move onto the wall pulls the corner off it.
 */
export function alignOutlineShift(origin, ds, dz, sTargets, zTargets, reach) {
  let dsHit = 0;
  let dzHit = 0;
  let bestS = reach + 1;
  let bestZ = reach + 1;
  let guideS = null;
  let guideZ = null;
  for (const p of origin) {
    const s = p.s + ds;
    const z = p.z + dz;
    for (const t of sTargets) {
      const ad = Math.abs(t - s);
      if (ad <= reach && ad < bestS) { bestS = ad; dsHit = t - s; guideS = t; }
    }
    for (const t of zTargets) {
      const ad = Math.abs(t - z);
      if (ad <= reach && ad < bestZ) { bestZ = ad; dzHit = t - z; guideZ = t; }
    }
  }
  return {
    ds: ds + (guideS == null ? 0 : dsHit),
    dz: dz + (guideZ == null ? 0 : dzHit),
    guideS,
    guideZ,
  };
}

/**
 * Move one edge of a ring by the same amount at both ends, so the line keeps
 * its length and direction. The delta is reduced until both ends stay on the
 * face. `points` are `{ s, z }` in viewing coordinates.
 */
export function translateOutlineEdge(points, edgeIndex, ds, dz, length, height) {
  const n = points.length;
  if (!n) return [];
  const i = ((edgeIndex % n) + n) % n;
  const j = (i + 1) % n;
  const a = points[i];
  const b = points[j];
  const minS = Math.min(a.s, b.s);
  const maxS = Math.max(a.s, b.s);
  const minZ = Math.min(a.z, b.z);
  const maxZ = Math.max(a.z, b.z);
  const s = Math.min(length - maxS, Math.max(-minS, ds));
  const z = Math.min(height - maxZ, Math.max(-minZ, dz));
  return points.map((p, k) => (k === i || k === j ? { s: p.s + s, z: p.z + z } : { s: p.s, z: p.z }));
}

/**
 * A ring that is still an axis-aligned rectangle, as viewing `from`/`to`/`bottom`/`top`.
 * Null when a corner has been pulled off the box.
 */
export function axisAlignedOutline(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const ss = points.map((p) => p.s);
  const zs = points.map((p) => p.z);
  const from = Math.min(...ss);
  const to = Math.max(...ss);
  const bottom = Math.min(...zs);
  const top = Math.max(...zs);
  if (to - from < 1e-4 || top - bottom < 1e-4) return null;
  const onBox = points.every((p) => (
    (Math.abs(p.s - from) < 1e-4 || Math.abs(p.s - to) < 1e-4)
    && (Math.abs(p.z - bottom) < 1e-4 || Math.abs(p.z - top) < 1e-4)
  ));
  return onBox ? { from, to, bottom, top } : null;
}

/** Smallest finish a typed gap may leave, metres. The same step a drag snaps to. */
export const FINISH_MIN_M = ELEVATION_SNAP;
/** Smallest window or door a typed gap may leave, metres. */
export const OPENING_MIN_M = 0.2;

function clampGap(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Largest gap, in metres, that still leaves the shape on the wall and at
 * least its minimum size. A bigger typed number is refused. `target` is the
 * same shape `applyTypedGap` takes. `spec` is a `finishLocate` result.
 */
export function maxTypedGap(target, axis, spec, face) {
  const length = face?.length || 0;
  const height = face?.height || 0;
  if (!target || !spec) return 0;
  if (target.kind === "vertex") {
    if (axis === "h" && spec.side) return length;
    if (axis === "v" && spec.vert) return height;
    return 0;
  }
  if (target.kind === "rect-edge") {
    if (target.rule && axis === "h") return 0;
    if (axis === "h" && spec.side) {
      return spec.side.s0 === 0
        ? Math.max(0, target.to - FINISH_MIN_M)
        : Math.max(0, length - target.from - FINISH_MIN_M);
    }
    if (axis === "v" && spec.vert) {
      return spec.vert.toward === "base"
        ? Math.max(0, target.top - FINISH_MIN_M)
        : Math.max(0, height - target.bottom - FINISH_MIN_M);
    }
    return 0;
  }
  if (target.kind === "opening") {
    const corner = String(target.corner || "");
    if (target.door && (axis === "h" || !corner.includes("t"))) return 0;
    const right = target.offset + target.width;
    const head = target.sill + target.height;
    if (axis === "h" && spec.side) {
      if (spec.side.s0 === 0) return corner.includes("l") ? Math.max(0, right - OPENING_MIN_M) : length;
      return corner.includes("r") ? Math.max(0, length - target.offset - OPENING_MIN_M) : length;
    }
    if (axis === "v" && spec.vert) {
      if (spec.vert.toward === "base") return corner.includes("b") ? Math.max(0, head - OPENING_MIN_M) : height;
      return corner.includes("t") ? Math.max(0, height - target.sill - OPENING_MIN_M) : height;
    }
    return 0;
  }
  if (target.kind === "edge") {
    const pts = target.points;
    if (!pts?.length) return 0;
    const j = (target.index + 1) % pts.length;
    const a = pts[target.index];
    const b = pts[j];
    if (!a || !b) return 0;
    if (axis === "h" && spec.side) return Math.max(0, length - Math.abs(a.s - b.s));
    if (axis === "v" && spec.vert) return Math.max(0, height - Math.abs(a.z - b.z));
  }
  return 0;
}

/**
 * Move a corner or an edge so one gap equals `gapM` metres. The same
 * geometry a drag uses: a corner keeps the opposite edge, an outline edge
 * keeps its length, a rectangle edge stays a rectangle.
 *
 * `target.kind` is `vertex`, `edge` (a drawn outline), `rect-edge`, or
 * `opening`. `corner` on an opening is `l`/`r`/`t`/`b` or `tl`/`tr`/`bl`/`br`.
 * `spec` is the clearance being typed (`side` across, `vert` up or down).
 * `face` is `{ length, height }` in metres. Returns the new coordinates, or
 * null when that axis has no gap to set.
 */
export function applyTypedGap(target, axis, gapM, spec, face) {
  if (!target || !spec || !face) return null;
  if (axis === "h" && !spec.side) return null;
  if (axis === "v" && !spec.vert) return null;
  const value = Math.max(0, gapM);
  const length = face.length;
  const height = face.height;

  if (target.kind === "vertex") {
    if (!target.points || target.points[target.index] == null) return null;
    const points = target.points.map((p) => ({ s: p.s, z: p.z }));
    const p = points[target.index];
    if (axis === "h") p.s = clampGap(spec.side.s0 === 0 ? value : length - value, 0, length);
    if (axis === "v") p.z = clampGap(spec.vert.toward === "base" ? value : height - value, 0, height);
    return { points };
  }

  if (target.kind === "edge") {
    if (!target.points?.length) return null;
    const points = target.points.map((p) => ({ s: p.s, z: p.z }));
    const i = ((target.index % points.length) + points.length) % points.length;
    const j = (i + 1) % points.length;
    const a = points[i];
    const b = points[j];
    let ds = 0;
    let dz = 0;
    if (axis === "h") {
      const at = spec.side.s0 === 0 ? value : length - value;
      const outer = spec.side.s0 === 0 ? Math.min(a.s, b.s) : Math.max(a.s, b.s);
      ds = at - outer;
    }
    if (axis === "v") {
      const at = spec.vert.toward === "base" ? value : height - value;
      const outer = spec.vert.toward === "base" ? Math.min(a.z, b.z) : Math.max(a.z, b.z);
      dz = at - outer;
    }
    return { points: translateOutlineEdge(points, i, ds, dz, length, height) };
  }

  if (target.kind === "rect-edge") {
    if (target.rule && axis === "h") return null;
    let { from, to, bottom, top } = target;
    if (axis === "h") {
      if (spec.side.s0 === 0) from = clampGap(value, 0, to - FINISH_MIN_M);
      else to = clampGap(length - value, from + FINISH_MIN_M, length);
    }
    if (axis === "v") {
      if (spec.vert.toward === "base") bottom = clampGap(value, 0, top - FINISH_MIN_M);
      else top = clampGap(height - value, bottom + FINISH_MIN_M, height);
    }
    return { from, to, bottom, top };
  }

  if (target.kind === "opening") {
    const corner = String(target.corner || "");
    let { offset, width, sill } = target;
    let openingH = target.height;
    if (target.door) {
      if (axis !== "v" || !corner.includes("t")) return null;
      const z = spec.vert.toward === "base" ? value : height - value;
      openingH = clampGap(z - sill, OPENING_MIN_M, Math.max(OPENING_MIN_M, height - sill));
      return { offset, width, sill, height: openingH };
    }
    const head = sill + openingH;
    const right = offset + width;
    if (axis === "h") {
      const s = spec.side.s0 === 0 ? value : length - value;
      if (corner.includes("l")) {
        offset = clampGap(Math.min(s, right - OPENING_MIN_M), 0, length);
        width = right - offset;
      }
      if (corner.includes("r")) width = clampGap(s - offset, OPENING_MIN_M, Math.max(OPENING_MIN_M, length - offset));
    }
    if (axis === "v") {
      const z = spec.vert.toward === "base" ? value : height - value;
      if (corner.includes("b")) {
        sill = clampGap(Math.min(z, head - OPENING_MIN_M), 0, height);
        openingH = head - sill;
      }
      if (corner.includes("t")) openingH = clampGap(z - sill, OPENING_MIN_M, Math.max(OPENING_MIN_M, height - sill));
    }
    return { offset, width, sill, height: openingH };
  }

  return null;
}

/**
 * Resize an opening from one corner, in viewing metres. `corner` is
 * `tl`, `tr`, `bl`, `br`, or `t` (a door head). Left corners move the
 * offset and keep the right edge. Bottom corners move the sill and keep
 * the head. The opening stays at least `OPENING_MIN_M` on each side.
 * Returns the edit `applyOpeningEdit` expects (`left`, `width`, `sill`, `height`).
 */
export function resizeOpeningCorner(orig, corner, s, z, face) {
  const min = OPENING_MIN_M;
  const length = face?.length ?? 0;
  const wallH = face?.height ?? 0;
  const right = orig.offset + orig.width;
  const head = orig.sill + orig.height;
  let offset = orig.offset;
  let width = orig.width;
  let sill = orig.sill;
  let height = orig.height;
  const name = String(corner || "");
  if (name.includes("l")) {
    offset = clampGap(Math.min(s, right - min), 0, Math.max(0, length));
    width = right - offset;
  }
  if (name.includes("r")) {
    const at = clampGap(s, offset + min, Math.max(offset + min, length));
    width = at - offset;
  }
  if (name.includes("b")) {
    sill = clampGap(Math.min(z, head - min), 0, Math.max(0, wallH));
    height = head - sill;
  }
  if (name.includes("t")) {
    const at = clampGap(z, sill + min, Math.max(sill + min, wallH));
    height = at - sill;
  }
  return { left: offset, width, sill, height };
}

/**
 * Rise from a drag of the spring line. `z` is where the curve leaves the
 * jambs. The crown stays put. The rise cannot pass half the width.
 */
export function resizeArchRise(orig, z) {
  const head = orig.sill + orig.height;
  const cap = Math.max(ELEVATION_SNAP, orig.width / 2);
  const rise = Math.round((head - z) * 1000) / 1000;
  return { rise: Math.min(cap, Math.max(ELEVATION_SNAP, rise)) };
}

/**
 * Edges of an opening a dragged corner may snap to. The corner's own
 * station and its own height are left out, so it cannot snap to the
 * adjacent corner that shares that axis. The opposite edge is still a target.
 */
export function openingSnapEdges(opening, at) {
  const ss = [opening.offset, opening.offset + opening.width];
  const zs = [opening.sill, opening.sill + opening.height];
  const keep = (v, atV) => !(Number.isFinite(atV) && Math.abs(v - atV) <= 1e-6);
  return {
    s: ss.filter((v) => keep(v, at?.s)),
    z: zs.filter((v) => keep(v, at?.z)),
  };
}
