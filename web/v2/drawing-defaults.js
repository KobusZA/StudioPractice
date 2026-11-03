// Session defaults for drawing tools. Nothing here is written to the job.
// A reload drops the lot; that is the storage the review asked not to add.

import { normalizeWallLocation } from "./click-draw.js";

/**
 * The SKU a ribbon function should arm. A type the user already picked for
 * this function wins. Otherwise keep the current SKU when it still belongs
 * to the function. The pack's first match is only the starting point.
 */
export function skuForArmedFunction(skus, { categories = [], functionId, memory = {}, currentId } = {}) {
  const cats = categories || [];
  const fits = (id) => Boolean(id) && (skus || []).some((sku) => sku.id === id && cats.includes(sku.category));
  if (functionId && fits(memory[functionId])) return memory[functionId];
  if (fits(currentId)) return currentId;
  return (skus || []).find((sku) => cats.includes(sku.category))?.id ?? null;
}

/** Remember a deliberate pick. An empty function id leaves the memory as it was. */
export function rememberFunctionSku(memory, functionId, skuId) {
  const next = { ...(memory || {}) };
  if (!functionId || !skuId) return next;
  next[functionId] = skuId;
  return next;
}

/**
 * Re-arming a tool keeps the location line. Changing thickness is a SKU
 * change and does not appear here, so it cannot clear the line either.
 */
export function armPlacement(state, item, skus) {
  return {
    placeSkuId: skuForArmedFunction(skus, {
      categories: item?.categories || [],
      functionId: item?.id,
      memory: state?.memory || {},
      currentId: state?.placeSkuId,
    }),
    wallLocation: normalizeWallLocation(state?.wallLocation),
    memory: state?.memory || {},
  };
}

/** A placed door stays armed. A window still returns to Select. */
export function openingStaysArmed(category) {
  return category === "door";
}

/** Most recent first, duplicates collapsed, capped. Session list only. */
export function noteRecentDoor(list, skuId, limit = 8) {
  if (!skuId) return [...(list || [])];
  return [skuId, ...(list || []).filter((id) => id !== skuId)].slice(0, limit);
}

/** Door SKUs for the recent row, in list order, skipping anything not a door. */
export function recentDoorSkus(skus, ids) {
  const doors = new Map((skus || []).filter((sku) => sku.category === "door").map((sku) => [sku.id, sku]));
  const out = [];
  for (const id of ids || []) {
    const sku = doors.get(id);
    if (sku) out.push(sku);
  }
  return out;
}

/** New work is red. Existing work is white, with a dark edge so it reads on the paper. */
export const WALL_NEW = "#d0121a";
export const WALL_EXISTING = "#ffffff";
export const WALL_EXISTING_EDGE = "#1a1612";

export function wallPlanColour(status) {
  if (status === "existing") return { stroke: WALL_EXISTING, edge: WALL_EXISTING_EDGE };
  if (!status || status === "planned") return { stroke: WALL_NEW, edge: null };
  return null;
}

/** One control: model (walls on top) and sheet (the PDF on top) swap. */
export function nextTraceView(view) {
  return view === "sheet" ? "model" : "sheet";
}

/**
 * The wall body on plan, as a quad around the centreline. Used to let the
 * sheet show through a selected wall without moving the wall.
 */
export function wallFootprint(wall) {
  const t = (Number(wall?.thickness) || 0) / 2;
  const x1 = wall?.x1 || 0;
  const y1 = wall?.y1 || 0;
  const x2 = wall?.x2 ?? x1;
  const y2 = wall?.y2 ?? y1;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * t;
  const ny = ((x2 - x1) / len) * t;
  return [
    { x: x1 + nx, y: y1 + ny },
    { x: x2 + nx, y: y2 + ny },
    { x: x2 - nx, y: y2 - ny },
    { x: x1 - nx, y: y1 - ny },
  ];
}
