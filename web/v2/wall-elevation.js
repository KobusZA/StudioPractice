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
import { resolvedBase } from "./compile.js";
import {
  openingOnWall,
  openingSize,
  roomEdgeSegment,
  skuById,
  wallForOpening,
  wallT,
} from "./openings.js";
import { deriveWalls, drawnSegmentFromWall, skuDrawnHeight } from "./walls.js";
import { faceFinishBands, reanchorRun } from "./finish-model.js";

/** Drags and typed values snap to this, metres. */
export const ELEVATION_SNAP = 0.05;

const DEFAULT_WINDOW_SILL = 0.9;

export function snapElevation(value, step = ELEVATION_SNAP) {
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
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
 */
export function elevationModel(doc, pack, faceRef, walls = null) {
  if (!doc || !pack || !faceRef?.wallId) return null;
  const all = walls || deriveWalls(doc, pack);
  const wall = all.find((w) => w.id === faceRef.wallId);
  if (!wall) return null;
  const side = normSide(faceRef.side);
  const flip = side === -1;
  const length = wall.length;

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
      offset,
      width,
      sill: openingSill(pack, opening),
      height,
      nonStandard: Boolean(size.nonStandard),
    });
  }
  openings.sort((a, b) => a.offset - b.offset);

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
    base,
    top,
    height: top - base,
    thickness: wall.thickness,
    attachedTo: resolved.attachedTo?.label || null,
    heightConflict: wall.heightConflict || null,
    openings,
    // Finish bands in viewing order, heights above `base`. Room rules and
    // runs are editable; the computed plaster default is not.
    finishBands: faceFinishBands(doc, pack, all, wall, side, {
      wallBases: new Map([[wall.id, { height: resolved.height }]]),
    }),
    levels,
    guide: heightGuide(pack, wall),
    canDragTop: wall.category !== "foundation",
  };
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
    return { height: h, wallId: wall.id };
  }

  const seg = drawnSegmentFromWall(wall, pack);
  if (!seg) return null;
  write(seg);
  for (const run of doc.finishRuns || []) {
    if (run.wallId === wall.id) run.wallId = seg.id;
  }
  (doc.segments || (doc.segments = [])).push(seg);
  return { height: h, wallId: seg.id };
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

  const centre = left + width / 2;
  const fromA = model.flip ? model.length - centre : centre;
  opening.t = anchorT(doc, wall, opening, fromA);

  const g = skuById(pack, opening.sku)?.geometry || {};
  const store = (field, value) => {
    const own = g[field];
    opening[field] = Number.isFinite(own) && Math.abs(own - value) < 0.0005 ? null : value;
  };
  if (Number.isFinite(edit.width) || Number.isFinite(edit.left)) store("width", width);
  if (Number.isFinite(edit.height)) store("height", height);
  if (Number.isFinite(edit.sill)) {
    // A door's floor-level sill is not an override.
    if (skuById(pack, opening.sku)?.category === "window") store("sill", sill);
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
