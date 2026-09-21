// Sample jobs for Open: drawings a person could have traced with Walls,
// Ceilings and Doors. Room-derived walls are not selectable and do not
// take off as drawn segments; these jobs place those objects themselves.

import { lookDownLevelId, lookUpLevelId } from "./level-view.js";
import { emptyDoc, nid, rectShape, shapePolygon } from "./model.js";

export const SAMPLE_JOBS = [
  {
    id: "sea-point",
    name: "Sea Point duplex",
    summary: "Drawn GF and L1: 220 walls, 9 mm ceilings, doors and windows.",
    build: seaPointDoc,
  },
  {
    id: "observatory",
    name: "Observatory warehouse",
    summary: "Existing masonry shell, planned 110 partitions, fit-out ceilings only.",
    build: observatoryDoc,
  },
  {
    id: "constantia",
    name: "Constantia pavilion",
    summary: "All-planned traced pavilion: walls, ceilings, doors and a roof.",
    build: constantiaDoc,
  },
];

const PREFERRED = {
  wall220: ["TSP_WAL_MASONARY_WALL_220MM_PLASTER", "TSP_MAS009"],
  wall110: ["TSP_WAL_MASONARY_WALL_110MM_PLASTER", "TSP_MAS008"],
  floor: ["TSP_FLR_GENERIC_85MM", "TSP_RB016"],
  slab: ["TSP_FLR_GENERIC_255MM", "TSP_RB017"],
  ceiling: ["TSP_CLG_9MM_PLASTERED_CEILINGS"],
  footing: ["TSP_FND_BEARING_FOOTING_600X200_MM", "TSP_CON052"],
  roof: ["TSP_ROF_GENERIC_125MM", "TSP_RC003"],
  door: ["TSP_DOR_900_X_2100MM", "TSP_DR900"],
  garageDoor: ["TSP_DOR_4800_X_2100MM", "TSP_DR1020"],
  window: ["TSP_WIN_1650X_1650MM", "TSP_WN1212"],
  windowSmall: ["TSP_WIN_900_X_900MM", "TSP_WN0606"],
  sanitary: ["TSP_SAN_CLOSED_COUPLE", "TSP_WC001"],
  basin: ["TSP_SAN_WHB", "TSP_VAN01"],
  electrical: ["TSP_ELE_TSP_DOWNLIGHTER_IN_CEILING"],
};

function skuInPack(pack, id) {
  return pack?.skus?.some((s) => s.id === id) ? id : null;
}

function firstSku(pack, category) {
  return pack?.skus?.find((s) => s.category === category)?.id || null;
}

function resolveSku(pack, key, category) {
  for (const id of PREFERRED[key] || []) {
    const hit = skuInPack(pack, id);
    if (hit) return hit;
  }
  if (category === "wall") return pack?.system?.defaultWallSku || firstSku(pack, "wall");
  if (category === "floor") return pack?.system?.defaultFloorSku || firstSku(pack, "floor");
  if (category === "ceiling") return pack?.system?.defaultCeilingSku || firstSku(pack, "ceiling");
  if (category === "foundation") return pack?.system?.defaultFoundationSku || firstSku(pack, "foundation");
  if (category === "roof") return pack?.system?.defaultRoofSku || firstSku(pack, "roof");
  return firstSku(pack, category);
}

function types(pack) {
  return {
    wall220: resolveSku(pack, "wall220", "wall"),
    wall110: resolveSku(pack, "wall110", "wall") || resolveSku(pack, "wall220", "wall"),
    floor: resolveSku(pack, "floor", "floor"),
    slab: resolveSku(pack, "slab", "floor") || resolveSku(pack, "floor", "floor"),
    ceiling: resolveSku(pack, "ceiling", "ceiling"),
    footing: resolveSku(pack, "footing", "foundation"),
    roof: resolveSku(pack, "roof", "roof"),
    door: resolveSku(pack, "door", "door"),
    garageDoor: resolveSku(pack, "garageDoor", "door") || resolveSku(pack, "door", "door"),
    window: resolveSku(pack, "window", "window"),
    windowSmall: resolveSku(pack, "windowSmall", "window") || resolveSku(pack, "window", "window"),
    sanitary: resolveSku(pack, "sanitary", "sanitary"),
    basin: resolveSku(pack, "basin", "sanitary") || resolveSku(pack, "sanitary", "sanitary"),
    electrical: resolveSku(pack, "electrical", "electrical"),
  };
}

function groundLevel(pack) {
  return pack?.system?.defaultLevel || pack?.levels?.[0]?.id || null;
}

function foundationLevel(pack, ground) {
  return lookDownLevelId(pack.levels, ground) || ground;
}

function baseDoc(pack, name) {
  const doc = emptyDoc();
  doc.name = name;
  doc.packId = pack.id;
  return doc;
}

/** One traced job: walls, fills, openings and fittings the Walls / Ceilings / Doors tools would write. */
function drawing(pack, name) {
  const t = types(pack);
  const gf = groundLevel(pack);
  const doc = baseDoc(pack, name);

  const wall = (x1, y1, x2, y2, opts = {}) => {
    const id = nid("s");
    doc.segments.push({
      id,
      sku: opts.sku || t.wall220,
      level: opts.level || gf,
      status: opts.status || "planned",
      x1,
      y1,
      x2,
      y2,
    });
    return id;
  };

  const fill = (sku, x, y, w, h, opts = {}) => {
    if (!sku) return null;
    const id = nid("sl");
    doc.slabs.push({
      id,
      sku,
      level: opts.level || gf,
      status: opts.status || "planned",
      shape: rectShape(x, y, w, h),
    });
    return id;
  };

  const space = (x, y, w, h, opts = {}) => {
    fill(t.floor, x, y, w, h, opts);
    if (opts.ceiling !== false) fill(t.ceiling, x, y, w, h, opts);
  };

  const opening = (wallId, sku, status, tAlong, swing = 1) => {
    if (!wallId || !sku) return null;
    const id = nid("o");
    doc.openings.push({
      id,
      sku,
      wallId,
      roomId: null,
      t: tAlong,
      swing,
      status,
    });
    return id;
  };

  const item = (sku, x, y, opts = {}) => {
    if (!sku) return null;
    doc.items.push({
      id: nid("i"),
      sku,
      level: opts.level || gf,
      x,
      y,
      rotation: opts.rotation || 0,
      status: opts.status || "planned",
    });
  };

  const ring = (x1, y1, x2, y2, opts = {}) => {
    if (!opts.sku) return;
    wall(x1, y1, x2, y1, opts);
    wall(x2, y1, x2, y2, opts);
    wall(x2, y2, x1, y2, opts);
    wall(x1, y2, x1, y1, opts);
  };

  return { doc, t, gf, wall, space, fill, opening, item, ring };
}

/** Occupied duplex, traced wall-by-wall on GF and L1. */
export function seaPointDoc(pack) {
  const { doc, t, gf, wall, space, fill, opening, item, ring } = drawing(pack, "Sea Point duplex");
  const l1 = lookUpLevelId(pack.levels, gf);
  const found = foundationLevel(pack, gf);
  const ex = { level: gf, status: "existing", sku: t.wall220 };
  const pl = { level: gf, status: "planned", sku: t.wall220 };

  const garageS = wall(0, 0, 5.6, 0, ex);
  const hallS = wall(5.6, 0, 8, 0, ex);
  wall(8, 0, 8, 9.6, ex);
  wall(0, 0, 0, 6, ex);
  const kitchenW = wall(0, 6, 0, 9.6, ex);
  wall(0, 9.6, 0, 14.4, ex);
  const loungeN = wall(0, 14.4, 8, 14.4, ex);
  wall(5.6, 0, 5.6, 9.6, ex);
  const hallDining = wall(0, 6, 8, 6, ex);
  wall(0, 9.6, 8, 9.6, ex);

  const ensS = wall(8, 9.6, 11.4, 9.6, pl);
  const ensE = wall(11.4, 9.6, 11.4, 14.4, pl);
  wall(8, 14.4, 11.4, 14.4, pl);
  const ensW = wall(8, 9.6, 8, 14.4, pl);

  space(0, 0, 5.6, 6, ex);
  space(5.6, 0, 2.4, 6, ex);
  space(0, 6, 5.6, 3.6, ex);
  space(5.6, 6, 2.4, 3.6, ex);
  space(0, 9.6, 8, 4.8, ex);
  space(8, 9.6, 3.4, 4.8, pl);

  opening(garageS, t.garageDoor, "existing", 0.5);
  opening(hallS, t.door, "existing", 0.5);
  opening(hallDining, t.door, "existing", 0.82);
  opening(ensW, t.door, "planned", 0.35);
  opening(kitchenW, t.window, "existing", 0.5);
  opening(loungeN, t.window, "existing", 0.4);
  opening(ensE, t.windowSmall, "planned", 0.45);
  opening(ensS, t.windowSmall, "planned", 0.7);

  item(t.electrical, 2.8, 7.8, ex);
  item(t.electrical, 4, 12, ex);
  item(t.sanitary, 9.2, 12.4, pl);
  item(t.basin, 10.4, 12.4, pl);

  if (l1) {
    doc.floorsRevealed = 1;
    const up = { level: l1, status: "existing", sku: t.wall220 };
    const bedS = wall(0, 0, 5.6, 0, up);
    wall(5.6, 0, 8, 0, up);
    wall(8, 0, 8, 6, up);
    wall(0, 6, 8, 6, up);
    wall(0, 0, 0, 6, up);
    const split = wall(5.6, 0, 5.6, 6, up);
    space(0, 0, 5.6, 6, up);
    space(5.6, 0, 2.4, 6, up);
    if (t.slab) fill(t.slab, 0, 0, 8, 6, up);
    opening(split, t.door, "existing", 0.45);
    opening(bedS, t.window, "existing", 0.5);
    item(t.sanitary, 6.4, 2.2, up);
    item(t.basin, 7.2, 4.2, up);
    item(t.electrical, 2.8, 3, up);
  }

  ring(-0.4, -0.4, 8.4, 14.8, { sku: t.footing, level: found, status: "existing" });
  if (t.roof) {
    doc.roofs.push({
      id: nid("rf"),
      sku: t.roof,
      level: gf,
      form: "gable",
      pitch: 30,
      ridge: "long",
      status: "planned",
      shape: rectShape(-0.4, -0.4, 12.2, 15.2),
    });
  }
  return doc;
}

/** Existing warehouse traced as 220 walls; offices as 110 partitions. */
export function observatoryDoc(pack) {
  const { doc, t, gf, wall, space, opening, item, ring } = drawing(pack, "Observatory warehouse");
  const found = foundationLevel(pack, gf);
  const shell = { level: gf, status: "existing", sku: t.wall220 };
  const fit = { level: gf, status: "planned", sku: t.wall110 };

  const yard = wall(0, 16, 24, 16, shell);
  const west = wall(0, 5, 0, 16, shell);
  wall(24, 5, 24, 16, shell);
  const officeLine = wall(0, 5, 24, 5, shell);

  const street = wall(0, 0, 24, 0, fit);
  wall(0, 0, 0, 5, fit);
  wall(24, 0, 24, 5, fit);
  wall(6, 0, 6, 5, fit);
  wall(14, 0, 14, 5, fit);
  wall(20, 0, 20, 5, fit);

  space(0, 5, 24, 11, { ...shell, ceiling: false });
  space(0, 0, 6, 5, fit);
  space(6, 0, 8, 5, fit);
  space(14, 0, 6, 5, fit);
  space(20, 0, 4, 5, fit);

  opening(yard, t.garageDoor, "existing", 0.55);
  opening(west, t.door, "existing", 0.35);
  opening(street, t.door, "planned", 0.12);
  opening(officeLine, t.door, "planned", 0.12);
  opening(officeLine, t.door, "planned", 0.42);
  opening(officeLine, t.door, "planned", 0.72);
  opening(street, t.window, "planned", 0.4);
  opening(street, t.window, "planned", 0.68);

  item(t.electrical, 3, 2.4, fit);
  item(t.electrical, 10, 2.4, fit);
  item(t.electrical, 17, 2.4, fit);

  ring(-0.4, -0.4, 24.4, 16.4, { sku: t.footing, level: found, status: "existing" });
  if (t.roof) {
    doc.roofs.push({
      id: nid("rf"),
      sku: t.roof,
      level: gf,
      form: "flat",
      pitch: 0,
      ridge: "long",
      status: "existing",
      shape: rectShape(-0.3, -0.3, 24.6, 16.6),
    });
  }
  return doc;
}

/** Concept pavilion, every wall and ceiling planned. */
export function constantiaDoc(pack) {
  const { doc, t, gf, wall, space, opening, item, ring } = drawing(pack, "Constantia pavilion");
  const found = foundationLevel(pack, gf);
  const pl = { level: gf, status: "planned", sku: t.wall220 };

  const gardenS = wall(0, 0, 8, 0, pl);
  const gardenE = wall(8, 0, 8, 5.2, pl);
  wall(8, 5.2, 8, 8.8, pl);
  const wetN = wall(0, 8.8, 8, 8.8, pl);
  wall(0, 0, 0, 8.8, pl);
  const wetLine = wall(0, 5.2, 8, 5.2, pl);
  const wcSplit = wall(4.4, 5.2, 4.4, 8.8, pl);

  space(0, 0, 8, 5.2, pl);
  space(0, 5.2, 4.4, 3.6, pl);
  space(4.4, 5.2, 3.6, 3.6, pl);

  opening(gardenS, t.door, "planned", 0.55);
  opening(gardenS, t.window, "planned", 0.22);
  opening(gardenE, t.window, "planned", 0.5);
  opening(wetLine, t.door, "planned", 0.28);
  opening(wcSplit, t.door, "planned", 0.45);
  opening(wetN, t.windowSmall, "planned", 0.78);

  item(t.electrical, 4, 2.4, pl);
  item(t.sanitary, 5.4, 7.2, pl);
  item(t.basin, 6.8, 6.2, pl);

  ring(-0.4, -0.4, 8.4, 9.2, { sku: t.footing, level: found, status: "planned" });
  if (t.roof) {
    doc.roofs.push({
      id: nid("rf"),
      sku: t.roof,
      level: gf,
      form: "gable",
      pitch: 30,
      ridge: "long",
      status: "planned",
      shape: rectShape(-0.4, -0.4, 8.8, 9.6),
    });
  }
  return doc;
}

export function sampleJobById(id) {
  return SAMPLE_JOBS.find((job) => job.id === id) || null;
}

/** Plan extents so Open can frame the drawing instead of leaving the camera on an empty origin. */
export function drawingBounds(doc) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const touch = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const seg of doc.segments || []) {
    touch(seg.x1, seg.y1);
    touch(seg.x2, seg.y2);
  }
  for (const row of [...(doc.slabs || []), ...(doc.roofs || [])]) {
    for (const [x, y] of shapePolygon(row.shape)) touch(x, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}
