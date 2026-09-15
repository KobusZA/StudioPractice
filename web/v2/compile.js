// Compile a v2 document into the extract payload the rest of the app consumes.
//
// The payload shape is the contract with web/app.js and with the TSP schedules in
// calculators/, so it is additive-only: v2 adds fields (rateRef, colourClass,
// use, measures) but never renames or removes one. The seven columns the QS
// workbook reads - Model, Family, Type, Length, Area, Volume, Count - all still
// come off these rows unchanged.

import { area as polyArea, perimeter as polyPerimeter } from "./geom.js";
import {
  effectiveLevel,
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

function levelElevation(pack, levelId) {
  const hit = (pack.levels || []).find((l) => l.id === levelId || l.name === levelId);
  return hit?.elevation ?? 0;
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
  for (const wall of walls) {
    const sku = skuById(pack, wall.sku);
    if (!sku) continue;
    const height = wall.height || sku.geometry?.height || wallHeight;
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
      elevation: levelElevation(pack, wall.level),
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
      elevation: levelElevation(pack, wall.level),
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

    sketchForms.push({
      kind: "Extrusion",
      elementId: beam.id,
      name: sku.name,
      depth: sku.geometry?.height || 0.22,
      elevation: levelElevation(pack, effectiveLevel(beam, pack)),
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
      height: w.height,
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
