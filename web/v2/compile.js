// Compile a v2 document into the extract payload the rest of the app consumes.
//
// The payload shape is the contract with web/app.js and with the TSP schedules in
// calculators/, so it is additive-only: v2 adds fields (rateRef, colourClass,
// use, measures) but never renames or removes one. The seven columns the QS
// workbook reads - Model, Family, Type, Length, Area, Volume, Count - all still
// come off these rows unchanged.

import { area as polyArea, perimeter as polyPerimeter } from "./geom.js";
import { lookDownLevelId } from "./level-view.js";
import {
  ATTACHABLE_KINDS,
  attachChainReaches,
  collectionFor,
  effectiveLevel,
  objectByRef,
  resolveBaseAttach,
  roomArea,
  roomCentroid,
  roomMinDimension,
  roomMinDimensionIsExact,
  roomPerimeter,
  roomPolygon,
  roomUse,
  shapePolygon,
} from "./model.js";
import {
  beamHostsOk,
  hostOk,
  openingOnWall,
  skuById,
  wallForOpening,
  wallNormal,
} from "./openings.js";
import { deriveDrawnWalls, deriveWalls, isExternalWall } from "./walls.js";

const CATEGORY_TO_SCHEDULE = {
  wall: "Walls",
  foundation: "Walls",
  floor: "Floors",
  ceiling: "Ceilings",
  roof: "Roofs",
  door: "Doors",
  window: "Windows",
  beam: "Beams",
  column: "Columns",
  stair: "Stairs",
  sanitary: "Plumbing",
  waterheater: "Plumbing",
  drainage: "Drainage",
  electrical: "Electrical",
  furniture: "Furniture",
  casework: "Casework",
  boundarywall: "Walls",
  pool: "Floors",
  carport: "Roofs",
};

export function instanceCategory(category) {
  return CATEGORY_TO_SCHEDULE[category] || category;
}

function skuFamily(sku) {
  if (!sku) return "";
  if (sku.family) return sku.family;
  if (sku.category === "door") return "Single-Flush";
  if (sku.category === "window") return "Fixed";
  return "";
}

function objectStatus(obj) {
  return obj?.status === "existing" ? "existing" : "planned";
}

export function levelElevation(pack, levelId) {
  const hit = (pack.levels || []).find((l) => l.id === levelId || l.name === levelId);
  return hit?.elevation ?? 0;
}

function levelName(pack, levelId) {
  return (pack?.levels || []).find((l) => l.id === levelId)?.name || levelId;
}

// --- base attach: elevation and height resolution -------------------------
//
// Without attach, every level-bound object's base is exactly its level's flat
// datum. With it, a wall that sits on a foundation resolves its base from that
// foundation's top instead, so the wall keeps a correct base elevation when the
// thing under it changes height. This is the numeric relationship only - it
// says nothing about how anything is drawn or how solids join.

// A degenerate attach (the target's top already at or above this object's own
// top) is a gap, not a number to emit anyway, so anything at or under this is
// warned about rather than scheduled.
const MIN_ATTACH_HEIGHT = 1e-6;

const BEAM_CATEGORIES = new Set(["beam", "column"]);
const BEAM_DEPTH = 0.22;

/** The label the Check panel, the inspector and the attach picker all print. */
export function objectLabel(pack, obj) {
  return skuById(pack, obj?.sku)?.name || obj?.id || "object";
}

/**
 * The height the document actually states for an object: the per-object
 * override Detach writes, else the SKU's. `null` where neither exists - which
 * is the real case for a template whose foundation types carry a thickness and
 * a depth but no height.
 */
export function statedHeight(pack, obj) {
  if (Number.isFinite(obj?.height)) return obj.height;
  const height = skuById(pack, obj?.sku)?.geometry?.height;
  return Number.isFinite(height) ? height : null;
}

/**
 * A drawn object's own height, before any attach eats into it. Falls back to
 * the document default the way `walls.js` and the beam extrusion already do, so
 * attach computes an object's height exactly as the rest of the app does.
 */
export function drawnObjectHeight(pack, obj) {
  const stated = statedHeight(pack, obj);
  if (stated !== null) return stated;
  if (BEAM_CATEGORIES.has(skuById(pack, obj?.sku)?.category)) return BEAM_DEPTH;
  return pack?.system?.wallHeight ?? 0;
}

/**
 * The top surface something attaches to, or `null` when the pack does not state
 * the target's height.
 *
 * Deliberately stricter than `drawnObjectHeight`: falling back to
 * `system.wallHeight` here would put an invented elevation under a real wall,
 * which is the "unknown is null, never a plausible default" rule the pack
 * schema already applies to a missing compliance fact. Reads the target's own
 * datum and offset rather than its attach, since Phase 1 refuses a target that
 * is itself attached.
 */
function topElevation(pack, obj) {
  const height = statedHeight(pack, obj);
  if (height === null) return null;
  return levelElevation(pack, effectiveLevel(obj, pack)) + (obj.baseOffset || 0) + height;
}

/**
 * Levels a Phase-1 attach target may sit on: the object's own, or the storey
 * immediately below it. You attach to what is under you or beside you, never
 * to something two storeys down and never upwards - there is no Top attach to
 * make "upwards" mean anything yet.
 */
export function attachTargetLevels(pack, obj) {
  const own = effectiveLevel(obj, pack);
  const below = lookDownLevelId(pack?.levels, own);
  return below ? [own, below] : [own];
}

/**
 * What attaching `obj` to `targetRef` would do, changing nothing. The picker's
 * hover preview, `attachSelection`'s validity pass and the Check panel's
 * warning text all read this one function, so what the UI promises before a
 * click and what compile() reports after it cannot disagree.
 *
 * `reason` on a refusal is the cause, one per distinct thing that can be
 * wrong, so every caller can say which it was instead of "cannot attach".
 */
export function attachPreview(doc, pack, obj, targetRef) {
  if (!obj || !targetRef?.kind || targetRef.id == null) {
    return { ok: false, reason: "missing-target", target: null };
  }
  if (!ATTACHABLE_KINDS.has(targetRef.kind)) return { ok: false, reason: "not-attachable", target: null };
  const target = objectByRef(doc, targetRef);
  if (!target) return { ok: false, reason: "missing-target", target: null };
  if (target.id === obj.id) return { ok: false, reason: "self", target };
  if (target.baseAttach) {
    return { ok: false, reason: attachChainReaches(doc, target, obj) ? "cycle" : "target-attached", target };
  }
  if (!attachTargetLevels(pack, obj).includes(effectiveLevel(target, pack))) {
    return { ok: false, reason: "level-too-far", target };
  }
  const base = levelElevation(pack, effectiveLevel(obj, pack)) + (obj.baseOffset || 0);
  const elevation = topElevation(pack, target);
  if (elevation === null) return { ok: false, reason: "target-height-unknown", target };
  const height = (base + drawnObjectHeight(pack, obj)) - elevation;
  if (height <= MIN_ATTACH_HEIGHT) return { ok: false, reason: "no-height", target, elevation };
  return { ok: true, reason: null, target, elevation, height, rise: elevation - base };
}

/**
 * Where a drawn wall's or beam's base sits, and how tall it is once its attach
 * is resolved. `height` in is the object's pre-attach height, which is what
 * keeps its **top** elevation fixed: attach raises the base and eats into the
 * height from the bottom, so the takeoff row shrinks with the wall instead of
 * the wall silently growing taller than it was drawn.
 *
 * A gap - dead target, cycle, second hop, or a chain with no height left in it
 * - falls back to the level datum and returns a warning. It never guesses a
 * number, the same rule the pack schema follows for a missing compliance fact.
 */
export function resolvedBase(doc, pack, obj, height) {
  const datum = levelElevation(pack, effectiveLevel(obj, pack));
  const flat = { elevation: datum + (obj?.baseOffset || 0), height, attachedTo: null, warning: null };
  const link = resolveBaseAttach(doc, obj);
  if (link.reason === "none") return flat;

  const preview = attachPreview(doc, pack, obj, obj.baseAttach);
  if (!preview.ok) return { ...flat, warning: attachWarning(pack, obj, preview) };

  // Re-checked against the caller's height rather than trusting the preview's:
  // the derived wall row is what the schedule is built from, so it is the
  // number that has to come out positive.
  const resolvedHeight = (flat.elevation + height) - preview.elevation;
  if (resolvedHeight <= MIN_ATTACH_HEIGHT) {
    return { ...flat, warning: attachWarning(pack, obj, { ...preview, ok: false, reason: "no-height" }) };
  }
  return {
    elevation: preview.elevation,
    height: resolvedHeight,
    attachedTo: { ref: obj.baseAttach, label: objectLabel(pack, preview.target) },
    warning: null,
  };
}

function attachWarning(pack, obj, preview) {
  const name = objectLabel(pack, obj);
  const where = levelName(pack, effectiveLevel(obj, pack));
  const target = preview.target ? `"${objectLabel(pack, preview.target)}"` : null;
  switch (preview.reason) {
    case "cycle":
      return `"${name}" and ${target || "its target"} are attached to each other, so neither base can be resolved. "${name}" falls back to ${where}.`;
    case "target-attached":
      return `"${name}" is attached to ${target}, which is itself attached to something else. Attach chains are one level deep for now, so "${name}" falls back to ${where}.`;
    case "level-too-far":
      return `"${name}" is attached to ${target}, which is more than one level below it, so "${name}" falls back to ${where}.`;
    case "no-height":
      return `"${name}" is attached to ${target}, whose top is already at or above "${name}"'s own top, so the attach would leave no height. "${name}" falls back to ${where}.`;
    case "target-height-unknown":
      return `"${name}" is attached to ${target}, and the template does not state a height for it, so where its top is is unknown. "${name}" falls back to ${where} rather than a guessed elevation.`;
    default:
      return `"${name}" is attached to an object that no longer exists, so its base falls back to ${where}. Re-attach it or detach it.`;
  }
}

/**
 * Every base attach in the document, resolved. The Check panel and the
 * selection inspector read this so attach state is visible without running a
 * compile - attach that is only discoverable by opening a schedule is the
 * thing Revit users complain about most after the failure messages.
 */
export function attachReport(doc, pack) {
  const rows = [];
  for (const kind of ATTACHABLE_KINDS) {
    for (const obj of collectionFor(doc, kind) || []) {
      if (!obj.baseAttach) continue;
      const base = resolvedBase(doc, pack, obj, drawnObjectHeight(pack, obj));
      rows.push({
        ref: { kind, id: obj.id },
        label: objectLabel(pack, obj),
        level: effectiveLevel(obj, pack),
        attachedTo: base.attachedTo,
        elevation: base.elevation,
        height: base.height,
        warning: base.warning,
      });
    }
  }
  return rows;
}

function defaultLevelFor(pack, sku) {
  return sku?.defaultLevel || pack?.system?.defaultLevel || pack?.levels?.[0]?.id || "01 GFL";
}

function polyLoop(poly) {
  const curves = [];
  let length = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    length += segLen;
    curves.push({ kind: "Line", length: segLen, start: [a[0], a[1], 0], end: [b[0], b[1], 0] });
  }
  return { length, curves };
}

function segLoop(x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return polyLoop([
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ]);
}

function itemRect(item, sku) {
  const g = sku.geometry || {};
  const w = g.width || 0.4;
  const d = g.depth || g.width || 0.4;
  const rot = Math.abs(((item.rotation || 0) / 90) % 2);
  return rot ? { x: item.x, y: item.y, w: d, h: w } : { x: item.x, y: item.y, w, h: d };
}

/** Attach only the measures this SKU's schedule block declares. */
function applyMeasures(row, sku, measures) {
  const report = sku.schedule?.report || [];
  for (const key of report) {
    if (measures[key] !== undefined) row[key] = measures[key];
  }
  return row;
}

function baseRow(pack, sku, elementId, status) {
  return {
    category: instanceCategory(sku.category),
    model: sku.id,
    family: skuFamily(sku),
    type: sku.name,
    elementId,
    count: 1,
    unit: sku.unit,
    rateRef: sku.cost?.rateRef ?? null,
    colourClass: sku.drawing?.colourClass ?? "other",
    status,
  };
}

export function compile(doc, pack, { phase = "Day 1" } = {}) {
  if (!pack) return null;

  const walls = deriveWalls(doc, pack);
  const wallHeight = pack.system.wallHeight;
  const instances = [];
  const sketchForms = [];
  const rooms = [];
  // Document-structure nudges: things that are not wrong enough to refuse
  // (the pack's "warn, don't guess" rule applies to compliance facts, not to
  // drawing mistakes), but are worth a flag before they reach the QS or a
  // compliance check. Kept separate from compliance's complianceGaps(), which
  // is about the pack's SKUs, not what the firm actually drew.
  const warnings = [];
  let floorSeq = 1;

  // --- rooms: floor finish plus the room record the compliance engine reads --
  for (const room of doc.rooms || []) {
    const poly = roomPolygon(room);
    if (poly.length < 3) continue;
    const a = roomArea(room);
    const p = roomPerimeter(room);
    const floor = skuById(pack, room.floorSku) || skuById(pack, pack.system.defaultFloorSku);
    const level = room.level || defaultLevelFor(pack, floor);
    const use = roomUse(room.use);

    sketchForms.push({
      kind: "Room",
      elementId: room.id,
      name: room.name,
      isSolid: false,
      depth: 0.18,
      elevation: levelElevation(pack, level),
      profileLoops: [polyLoop(poly)],
      status: objectStatus(room),
    });

    rooms.push({
      id: room.id,
      name: room.name,
      use: use.id,
      sansClass: use.sansClass,
      level,
      area: a,
      perimeter: p,
      minDimension: roomMinDimension(room),
      minDimensionExact: roomMinDimensionIsExact(room),
      centroid: roomCentroid(room),
      ceilingHeight: ceilingHeightFor(pack, level, room),
      status: objectStatus(room),
    });

    if (floor) {
      const row = baseRow(pack, floor, `F${floorSeq}`, objectStatus(room));
      applyMeasures(row, floor, {
        area: a,
        perimeter: p,
        volume: a * (floor.geometry?.thickness || 0.085),
        count: 1,
      });
      row.level = level;
      row.phaseCreated = phase;
      instances.push(row);
      floorSeq += 1;
    }
  }

  // --- slabs ---------------------------------------------------------------
  // Levels that have a drawn room, so a ceiling can be flagged when it lands
  // on a level with nothing underneath it - almost always because the level
  // switcher was left on the wrong storey before drawing (see the Ceilings
  // ribbon group's hint).
  const levelsWithRooms = new Set(rooms.map((r) => r.level));
  for (const slab of doc.slabs || []) {
    const sku = skuById(pack, slab.sku) || skuById(pack, pack.system.defaultFloorSku);
    if (!sku) continue;
    const poly = shapePolygon(slab.shape);
    if (poly.length < 3) continue;
    const a = polyArea(poly);
    const p = polyPerimeter(poly);
    const level = slab.level || defaultLevelFor(pack, sku);
    // A ceiling is not a floor: it sits at floor-to-ceiling height above its
    // level's datum, not flush with it. Without this offset a ceiling and a
    // floor on the same level land at the identical elevation - the exact
    // "ceiling drawn at floor height" bug this fixes. Falls back the same
    // way ceilingHeightFor already does for the compliance-facing number, so
    // this never introduces a second, inconsistent guess.
    const isCeiling = sku.category === "ceiling";
    const elevation = isCeiling
      ? levelElevation(pack, level) + (ceilingHeightFor(pack, level, null) || 0)
      : levelElevation(pack, level);
    if (isCeiling && !levelsWithRooms.has(level)) {
      const levelName = (pack.levels || []).find((l) => l.id === level)?.name || level;
      warnings.push(`Ceiling "${sku.name}" is on ${levelName}, which has no rooms drawn yet - check the level switcher before drawing ceilings.`);
    }

    sketchForms.push({
      kind: "Floor",
      elementId: slab.id,
      name: sku.name,
      isSolid: true,
      depth: sku.geometry?.thickness || 0.085,
      elevation,
      profileLoops: [polyLoop(poly)],
      status: objectStatus(slab),
    });

    const row = baseRow(pack, sku, slab.id, objectStatus(slab));
    applyMeasures(row, sku, {
      area: a,
      perimeter: p,
      volume: a * (sku.geometry?.thickness || 0.085),
      count: 1,
    });
    row.level = level;
    row.phaseCreated = phase;
    instances.push(row);
  }

  // --- roofs ---------------------------------------------------------------
  for (const roof of doc.roofs || []) {
    const sku = skuById(pack, roof.sku) || skuById(pack, pack.system.defaultRoofSku);
    if (!sku) continue;
    const poly = shapePolygon(roof.shape);
    if (poly.length < 3) continue;
    const a = polyArea(poly);
    const form = roof.form || "flat";
    const levelZ = levelElevation(pack, roof.level);
    const elevation = levelZ < 0.05 ? (pack.system.wallHeight || 2.8) : levelZ;

    sketchForms.push({
      kind: "Roof",
      elementId: roof.id,
      name: sku.name,
      isSolid: true,
      depth: sku.geometry?.thickness || 0.125,
      elevation,
      roofForm: form,
      roofPitch: form === "flat" ? 0 : Math.min(60, Math.max(5, roof.pitch ?? 30)),
      roofRidge: roof.ridge === "short" ? "short" : "long",
      profileLoops: [polyLoop(poly)],
      status: objectStatus(roof),
    });

    const row = baseRow(pack, sku, roof.id, objectStatus(roof));
    row.family = form === "flat"
      ? "Basic Roof"
      : `${form.charAt(0).toUpperCase()}${form.slice(1)} Roof`;
    applyMeasures(row, sku, { area: a, count: 1 });
    row.phaseCreated = phase;
    row.phaseDemolished = "None";
    instances.push(row);
  }

  // --- walls ---------------------------------------------------------------
  // Resolved base per wall id, so an opening in an attached wall reads the
  // same elevation the wall itself got rather than resolving it a second time
  // (and warning about the same broken attach twice).
  const wallBases = new Map();
  for (const wall of walls) {
    const sku = skuById(pack, wall.sku);
    if (!sku) continue;
    // A base attach raises this wall's base and takes the difference out of its
    // height, so `area`/`volume` below are the attached wall's, not the
    // as-drawn wall's. Room-derived walls carry no attach and resolve to the
    // level datum exactly as they always did.
    const base = resolvedBase(doc, pack, wall, wall.height || sku.geometry?.height || wallHeight);
    if (base.warning) warnings.push(base.warning);
    wallBases.set(wall.id, base);
    const height = base.height;
    const a = wall.length * height;

    const row = baseRow(pack, sku, wall.id, wall.status || "planned");
    applyMeasures(row, sku, {
      length: wall.length,
      area: a,
      volume: a * wall.thickness,
      count: 1,
    });
    row.external = isExternalWall(wall);
    instances.push(row);

    sketchForms.push({
      kind: "Wall",
      elementId: wall.id,
      name: sku.name,
      thickness: wall.thickness,
      depth: height,
      elevation: base.elevation,
      status: wall.status || "planned",
      profileLoops: [{
        length: wall.length,
        curves: [{
          kind: "Line",
          length: wall.length,
          start: [wall.x1, wall.y1, 0],
          end: [wall.x2, wall.y2, 0],
        }],
      }],
    });
  }

  // --- openings ------------------------------------------------------------
  for (const opening of doc.openings || []) {
    const wall = wallForOpening(doc, pack, walls, opening);
    if (!wall || !hostOk(pack, opening.sku, wall)) continue;
    const placed = openingOnWall(doc, pack, opening, wall);
    const sku = placed.sku;
    if (!sku) continue;
    const g = sku.geometry || {};

    const row = baseRow(pack, sku, opening.id, objectStatus(opening));
    applyMeasures(row, sku, { count: 1, area: (g.width || 0) * (g.height || 0) });
    row.hostWallId = wall.id;
    row.external = isExternalWall(wall);
    instances.push(row);

    const tick = {
      kind: sku.category === "window" ? "Window" : "Opening",
      elementId: opening.id,
      name: sku.name,
      depth: g.height || (sku.category === "window" ? 1.2 : 2.1),
      sill: sku.category === "window" ? (g.sill ?? 0.9) : 0,
      // Follows its host wall's base, so a door in a wall attached to a
      // foundation is not left sitting at the level datum below it.
      elevation: wallBases.get(wall.id)?.elevation ?? levelElevation(pack, wall.level),
      status: objectStatus(opening),
      profileLoops: [{
        length: placed.width,
        curves: [{
          kind: "Line",
          length: placed.width,
          start: [placed.a.x, placed.a.y, 0],
          end: [placed.b.x, placed.b.y, 0],
        }],
      }],
    };
    if (sku.category === "door") {
      const n = wallNormal(wall, opening.swing || 1);
      tick.profileLoops[0].curves.push({
        kind: "Arc",
        length: placed.width * 1.57,
        start: [placed.b.x, placed.b.y, 0],
        end: [placed.a.x + n.x * placed.width, placed.a.y + n.y * placed.width, 0],
      });
    }
    sketchForms.push(tick);
  }

  // --- items ---------------------------------------------------------------
  for (const item of doc.items || []) {
    const sku = skuById(pack, item.sku);
    if (!sku) continue;
    const row = baseRow(pack, sku, item.id, objectStatus(item));
    applyMeasures(row, sku, { count: 1 });
    instances.push(row);

    const box = itemRect(item, sku);
    sketchForms.push({
      kind: "Extrusion",
      elementId: item.id,
      name: sku.name,
      isSolid: true,
      depth: sku.geometry?.height || 0.4,
      elevation: levelElevation(pack, effectiveLevel(item, pack)),
      profileLoops: [polyLoop([
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h],
        [box.x, box.y + box.h],
      ])],
      status: objectStatus(item),
    });
  }

  // --- beams ---------------------------------------------------------------
  for (const beam of doc.beams || []) {
    const sku = skuById(pack, beam.sku);
    if (!sku) continue;
    const len = Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
    const maxSpan = pack.recipes?.maxSpan?.[sku.id];
    const minLen = pack.recipes?.minLength?.[sku.id] || 0;
    if (len > (maxSpan ?? Infinity) + 1e-6 || len < minLen) continue;
    if (!beamHostsOk(walls, pack, beam, sku.id)) continue;

    const row = baseRow(pack, sku, beam.id, objectStatus(beam));
    applyMeasures(row, sku, { length: len, count: 1 });
    instances.push(row);

    const base = resolvedBase(doc, pack, beam, drawnObjectHeight(pack, beam));
    if (base.warning) warnings.push(base.warning);

    sketchForms.push({
      kind: "Extrusion",
      elementId: beam.id,
      name: sku.name,
      depth: base.height,
      elevation: base.elevation,
      profileLoops: [segLoop(beam.x1, beam.y1, beam.x2, beam.y2, sku.geometry?.width || 0.11)],
      status: objectStatus(beam),
    });
  }

  // --- stairs --------------------------------------------------------------
  for (const stair of doc.stairs || []) {
    const sku = skuById(pack, stair.sku);
    if (!sku) continue;
    const row = baseRow(pack, sku, stair.id, objectStatus(stair));
    applyMeasures(row, sku, { count: 1 });
    row.level = stair.level || defaultLevelFor(pack, sku);
    instances.push(row);
  }

  explodeRecipes(doc, pack, instances, walls.filter((w) => !w.drawn));

  return {
    documentKind: "Planner",
    schema: "sp.extract/2",
    title: pack.name,
    path: "planner",
    activeView: "Planner",
    viewType: "FloorPlan",
    extractedAt: new Date().toISOString(),
    units: "meters / square meters / cubic meters",
    instances,
    sketchForms,
    rooms,
    warnings,
    walls: walls.map((w) => ({
      id: w.id,
      sku: w.sku,
      length: w.length,
      thickness: w.thickness,
      // The attached height and base, not the as-drawn ones, so a consumer of
      // this row and the schedule row above never disagree about a wall.
      height: wallBases.get(w.id)?.height ?? w.height,
      baseElevation: wallBases.get(w.id)?.elevation ?? levelElevation(pack, w.level),
      attachedTo: wallBases.get(w.id)?.attachedTo?.label ?? null,
      external: isExternalWall(w),
      roomIds: w.roomIds,
      status: w.status,
    })),
    plans: [{
      id: "planner",
      name: "Planner",
      viewType: "FloorPlan",
      discipline: "Floor Plans",
      level: pack.system.defaultLevel || pack.levels?.[0]?.id || "Level 1",
      elevation: 0,
      isActive: true,
      sketchForms,
    }],
  };
}

function ceilingHeightFor(pack, levelId, room) {
  if (Number.isFinite(room?.ceilingHeight)) return room.ceilingHeight;
  const level = (pack.levels || []).find((l) => l.id === levelId);
  if (Number.isFinite(level?.floorToCeiling)) return level.floorToCeiling;
  return pack.system.wallHeight ?? null;
}

/**
 * Implied quantities: things the contractor never draws but the QS must price.
 * A masonry wall implies a foundation under it; a room implies a floor.
 */
function explodeRecipes(doc, pack, instances, roomWalls) {
  const hasFloor = instances.some((row) => row.category === "Floors");
  const drawnFoundation = deriveDrawnWalls(doc, pack)
    .some((w) => skuById(pack, w.sku)?.category === "foundation");

  const lengthBySku = new Map();
  for (const wall of roomWalls) {
    lengthBySku.set(wall.sku, (lengthBySku.get(wall.sku) || 0) + wall.length);
  }
  const areaByWallSku = new Map();
  const perimeterByWallSku = new Map();
  for (const room of doc.rooms || []) {
    areaByWallSku.set(room.wallSku, (areaByWallSku.get(room.wallSku) || 0) + roomArea(room));
    perimeterByWallSku.set(
      room.wallSku,
      (perimeterByWallSku.get(room.wallSku) || 0) + roomPerimeter(room),
    );
  }

  const implied = new Map();
  for (const rule of pack.recipes?.requires || []) {
    const add = skuById(pack, rule.addSku);
    if (!add) continue;
    const prev = implied.get(add.id) || { sku: add, length: 0, area: 0 };

    if (rule.per === "wallLength") {
      if (add.category === "foundation" && drawnFoundation) continue;
      const len = lengthBySku.get(rule.whenSku) || 0;
      if (len <= 0) continue;
      prev.length += len;
    } else if (rule.per === "roomPerimeter") {
      const len = perimeterByWallSku.get(rule.whenSku) || 0;
      if (len <= 0) continue;
      prev.length += len;
    } else if (rule.per === "roomArea") {
      if (hasFloor && add.category === "floor") continue;
      const a = areaByWallSku.get(rule.whenSku) || 0;
      if (a <= 0) continue;
      prev.area += a;
    } else {
      continue;
    }
    implied.set(add.id, prev);
  }

  let n = 1;
  for (const { sku, length, area } of implied.values()) {
    if (instances.some((row) => row.model === sku.id)) continue;
    const g = sku.geometry || {};
    const row = baseRow(pack, sku, `impl${n}`, "planned");
    row.family = sku.family || sku.name;
    row.implied = true;
    const measures = { count: 1 };
    if (length) {
      measures.length = length;
      measures.volume = length * (g.width || 0.4) * (g.depth || g.thickness || 0.45);
    }
    if (area) {
      measures.area = area;
      measures.volume = area * (g.thickness || 0.085);
    }
    applyMeasures(row, sku, measures);
    instances.push(row);
    n += 1;
  }
}
