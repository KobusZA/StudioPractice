// Floor heights: where a floor, a slab top, a ceiling and a ground-storey wall
// base sit. compile.js, walls.js and the views all read these, so nothing works
// out an elevation on its own.
//
// A floor step is an offset from its storey's level (`offset`, mm, on a room or
// a slab), not a level of its own. On the ground storey the slab top sits below
// finished floor level (FFL) by the floor build-up (`doc.floorBuildUp`, mm).
// The DPC is at the slab top (SANS 10400-K 4.5.3.3), and so is the base of the
// ground-storey brickwork that carries on from it.

import { pointInPoly } from "./geom.js";
import { effectiveLevel, roomPolygon, shapePolygon } from "./model.js";
import { isReferenceLevel } from "./level-view.js";
import { isFoundationLevel } from "./placement-warn.js";
import { arcFromRadius } from "./click-draw.js";
import { floorOffsetMm } from "./roof.js";

/** How far past a wall's face the floor beside it is read, metres. */
const FLOOR_PROBE_M = 0.05;

/** SANS 10400-K 4.5.3.7: no horizontal DPC less than this above adjacent finished ground, metres. */
export const DPC_MIN_ABOVE_GROUND = 0.15;

function skuById(pack, id) {
  return pack?.skus?.find((s) => s.id === id) || null;
}

function levelById(pack, levelId) {
  return (pack?.levels || []).find((l) => l.id === levelId || l.name === levelId) || null;
}

function datum(pack, levelId) {
  return levelById(pack, levelId)?.elevation ?? 0;
}

/** The lowest full storey at or above datum: not a split, a reference or a foundation level. */
export function groundStorey(levels) {
  return (levels || [])
    .filter((l) => Number.isFinite(l.elevation) && !l.parentId && !isReferenceLevel(l) && !isFoundationLevel(l))
    .sort((a, b) => a.elevation - b.elevation)[0] || null;
}

/** The storey a level belongs to: its parent for a split level, else itself. */
export function storeyOf(levels, levelId) {
  const level = (levels || []).find((l) => l.id === levelId);
  return level?.parentId || levelId;
}

/** True for the ground storey and any split level under it. */
export function onGroundStorey(pack, levelId) {
  const ground = groundStorey(pack?.levels);
  return Boolean(ground && levelId && storeyOf(pack.levels, levelId) === ground.id);
}

/** Floor build-up in metres. Not stated reads as 0. */
export function floorBuildUpM(doc) {
  return floorBuildUpStated(doc) ? doc.floorBuildUp / 1000 : 0;
}

export function floorBuildUpStated(doc) {
  return Number.isFinite(doc?.floorBuildUp) && doc.floorBuildUp >= 0;
}

/** Finished floor level of a room or floor slab: its level plus its offset. */
export function floorLevel(pack, obj, levelId = effectiveLevel(obj, pack)) {
  return datum(pack, levelId) + floorOffsetMm(obj) / 1000;
}

/** Top of the structural slab: FFL less the build-up on the ground storey, FFL elsewhere. */
export function slabTop(doc, pack, obj, levelId = effectiveLevel(obj, pack)) {
  const ffl = floorLevel(pack, obj, levelId);
  return onGroundStorey(pack, levelId) ? ffl - floorBuildUpM(doc) : ffl;
}

/** The level's floor-to-ceiling, else the document's wall height. Null when neither is stated. */
export function levelFloorToCeiling(pack, levelId) {
  const level = levelById(pack, levelId);
  if (Number.isFinite(level?.floorToCeiling)) return level.floorToCeiling;
  return pack?.system?.wallHeight ?? null;
}

/**
 * A ceiling slab hangs from the structure above, so a step in the floor under
 * it does not move it. Only its own offset does.
 */
export function ceilingElevation(pack, slab, levelId = effectiveLevel(slab, pack)) {
  return datum(pack, levelId) + (levelFloorToCeiling(pack, levelId) || 0) + floorOffsetMm(slab) / 1000;
}

function slabSku(pack, slab) {
  return skuById(pack, slab?.sku) || skuById(pack, pack?.system?.defaultFloorSku);
}

export function isFloorSlab(pack, slab) {
  return slabSku(pack, slab)?.category === "floor" && slab?.atEaves !== true;
}

export function isCeilingSlab(pack, slab) {
  return slabSku(pack, slab)?.category === "ceiling";
}

/** Rooms and floor slabs on the ground storey, with their slab tops. */
export function groundFloorsOf(doc, pack) {
  const out = [];
  for (const room of doc?.rooms || []) {
    const levelId = effectiveLevel(room, pack);
    if (!onGroundStorey(pack, levelId)) continue;
    const poly = roomPolygon(room);
    if (poly.length >= 3) out.push({ poly, top: slabTop(doc, pack, room, levelId) });
  }
  for (const slab of doc?.slabs || []) {
    const levelId = effectiveLevel(slab, pack);
    if (!onGroundStorey(pack, levelId) || !isFloorSlab(pack, slab)) continue;
    const poly = shapePolygon(slab.shape);
    if (poly.length >= 3) out.push({ poly, top: slabTop(doc, pack, slab, levelId) });
  }
  return out;
}

function wallThickness(pack, wall) {
  if (Number.isFinite(wall?.thickness) && wall.thickness > 0) return wall.thickness;
  const g = skuById(pack, wall?.sku)?.geometry || {};
  return g.thickness ?? g.width ?? 0.22;
}

/**
 * Points either side of a wall, `reach` off its centreline, near its start,
 * at its middle and near its end. The end points are pulled in along the wall
 * so a probe at a corner does not land on the far side of the wall it meets.
 */
function sidePoints(wall, reach) {
  const out = [];
  const arc = wall.arc
    ? arcFromRadius(wall.x1, wall.y1, wall.x2, wall.y2, wall.arc.radius, wall.arc.side, wall.arc.major === true)
    : null;
  if (arc) {
    const inset = Math.min(0.5, reach / Math.max(arc.radius, 1e-6) / Math.max(Math.abs(arc.sweep), 1e-6));
    for (const f of [inset, 0.5, 1 - inset]) {
      const a = arc.a0 + arc.sweep * f;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      for (const r of [arc.radius - reach, arc.radius + reach]) out.push({ x: arc.cx + ux * r, y: arc.cy + uy * r });
    }
    return out;
  }
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return out;
  const tx = dx / len;
  const ty = dy / len;
  const along = len > 2 * reach ? [reach, len / 2, len - reach] : [len / 2];
  for (const s of along) {
    const px = wall.x1 + tx * s;
    const py = wall.y1 + ty * s;
    for (const side of [1, -1]) out.push({ x: px - ty * reach * side, y: py + tx * reach * side });
  }
  return out;
}

function categoryOf(pack, wall) {
  return wall?.category ?? skuById(pack, wall?.sku)?.category ?? null;
}

/**
 * Where a ground-storey wall starts: the lowest slab top beside it. A wall at a
 * step starts at the lower floor and the higher slab butts against it. With no
 * floor beside it, the level datum less the build-up. Null when the rule does
 * not apply: not a wall, not on the ground storey, attached, or carrying the
 * `baseOffset` Detach writes. Those keep the base they had. `floors` is
 * `groundFloorsOf(doc, pack)`, passed in when many walls are read at once.
 */
export function groundWallBase(doc, pack, wall, floors = null) {
  if (!wall || wall.baseAttach || wall.baseOffset) return null;
  if (categoryOf(pack, wall) !== "wall") return null;
  const levelId = effectiveLevel(wall, pack);
  if (!onGroundStorey(pack, levelId)) return null;
  floors = floors || groundFloorsOf(doc, pack);
  let lowest = Infinity;
  if (floors.length) {
    for (const p of sidePoints(wall, wallThickness(pack, wall) / 2 + FLOOR_PROBE_M)) {
      for (const floor of floors) {
        if (floor.top < lowest && pointInPoly(p.x, p.y, floor.poly)) lowest = floor.top;
      }
    }
  }
  return Number.isFinite(lowest) ? lowest : datum(pack, levelId) - floorBuildUpM(doc);
}

/** True when `wallBase` is still on the ground storey, below the next floor. */
export function footingBelongsUnder(pack, wallBase) {
  if (!Number.isFinite(wallBase)) return false;
  const storeys = (pack?.levels || [])
    .filter((l) => Number.isFinite(l.elevation) && !l.parentId && !isReferenceLevel(l) && !isFoundationLevel(l))
    .sort((a, b) => a.elevation - b.elevation);
  const above = storeys[1];
  if (!storeys[0] || !above) return Boolean(storeys[0]);
  return wallBase < above.elevation - 0.05;
}

/**
 * Part C: floor to ceiling of a room. A typed `room.ceilingHeight` wins. Then
 * the lowest ceiling slab over the room's centre on its storey, less the room's
 * FFL. With no ceiling slab, the level's floor-to-ceiling less the room's offset.
 */
export function roomCeilingHeight(doc, pack, room, levelId = effectiveLevel(room, pack), centre = null) {
  if (Number.isFinite(room?.ceilingHeight)) return room.ceilingHeight;
  const ffl = floorLevel(pack, room, levelId);
  if (centre && Number.isFinite(centre[0]) && Number.isFinite(centre[1])) {
    const storey = storeyOf(pack?.levels, levelId);
    let lowest = Infinity;
    for (const slab of doc?.slabs || []) {
      if (!isCeilingSlab(pack, slab)) continue;
      const slabLevel = effectiveLevel(slab, pack);
      if (storeyOf(pack?.levels, slabLevel) !== storey) continue;
      const poly = shapePolygon(slab.shape);
      if (poly.length < 3 || !pointInPoly(centre[0], centre[1], poly)) continue;
      lowest = Math.min(lowest, ceilingElevation(pack, slab, slabLevel));
    }
    if (Number.isFinite(lowest)) return lowest - ffl;
  }
  const ftc = levelFloorToCeiling(pack, levelId);
  if (ftc === null) return null;
  return ftc - floorOffsetMm(room) / 1000;
}

/** "FFL −0.170": the same format as a split level's label. */
export function fflText(relativeM) {
  const rounded = Math.round(relativeM * 1000) / 1000;
  const sign = rounded < 0 ? "\u2212" : rounded > 0 ? "+" : "";
  return `FFL ${sign}${Math.abs(rounded).toFixed(3)}`;
}

/**
 * The spot level a room or floor slab prints: its FFL relative to its storey's
 * floor. Null when that is 0, so a drawing is not cluttered.
 */
export function spotLevelLabel(pack, obj, levelId = effectiveLevel(obj, pack)) {
  const storeyId = storeyOf(pack?.levels, levelId);
  const rel = floorLevel(pack, obj, levelId) - datum(pack, storeyId);
  if (Math.abs(rel) < 0.0005) return null;
  return fflText(rel);
}

/** The job's natural ground level: a reference level named NGL or natural ground. The highest wins. */
export function naturalGroundLevel(levels) {
  return (levels || [])
    .filter((l) => isReferenceLevel(l) && Number.isFinite(l.elevation) && /\bNGL\b|natural\s+ground/i.test(`${l.name || ""} ${l.id || ""}`))
    .sort((a, b) => b.elevation - a.elevation)[0] || null;
}
