// A wall plug is stored on a drawn wall (station and face), and a floor point
// is stored on a slab. Plan x/y are derived from that host, so moving the
// wall or the floor cannot leave the fitting behind. Anything else electrical
// — a switch, a ceiling point, a board — stays a free point.

import { area as polyArea, clampToPoly, pointInPoly } from "./geom.js";
import { shapePolygon } from "./model.js";
import {
  distToWall,
  pointOnWall,
  swingToward,
  wallNormal,
  wallSnapDist,
  wallT,
} from "./openings.js";
import { deriveWalls } from "./walls.js";

const FLOOR_SOCKET = /floor light|recessed floor|underfloor/i;
const WALL_PLUG = /plug/i;
const NOT_WALL = /ceiling|slab/i;
const SYMBOL_M = 0.086;

/** "wall", "floor", or null when this fitting is not hosted. */
export function socketSurface(sku) {
  if (!sku || sku.category !== "electrical") return null;
  const name = sku.name || "";
  if (FLOOR_SOCKET.test(name)) return "floor";
  if (WALL_PLUG.test(name) && !NOT_WALL.test(name)) return "wall";
  return null;
}

function symbolBox(sku, rotation) {
  const g = sku?.geometry || {};
  const w = Number(g.width) > 0 ? g.width : SYMBOL_M;
  const d = Number(g.depth) > 0 ? g.depth : w;
  const swapped = Math.abs((((rotation || 0) / 90) % 2)) >= 1;
  return swapped ? { w: d, h: w } : { w, h: d };
}

function centreOf(item, sku) {
  const box = symbolBox(sku, item?.rotation);
  return {
    x: (Number(item?.x) || 0) + box.w / 2,
    y: (Number(item?.y) || 0) + box.h / 2,
    ...box,
  };
}

function placeCorner(cx, cy, sku, rotation) {
  const box = symbolBox(sku, rotation);
  const turns = ((rotation || 0) % 360 + 360) % 360;
  return { x: cx - box.w / 2, y: cy - box.h / 2, rotation: turns };
}

function wallRotation(wall) {
  const ang = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1) * 180 / Math.PI;
  const a = ((ang % 180) + 180) % 180;
  return a > 45 && a < 135 ? 90 : 0;
}

function clampStation(wall, sku, t) {
  const len = wall.length || Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
  const along = symbolBox(sku, wallRotation(wall)).w;
  const margin = len > 0 ? Math.min(0.49, (along / 2) / len) : 0;
  const raw = Number.isFinite(t) ? t : 0.5;
  return Math.min(1 - margin, Math.max(margin, raw));
}

function poseOnWall(sku, wall, t, side) {
  const p = pointOnWall(wall, t);
  const n = wallNormal(wall, side === -1 ? -1 : 1);
  const half = (wall.thickness || 0) / 2;
  const rotation = wallRotation(wall);
  return placeCorner(p.x + n.x * half, p.y + n.y * half, sku, rotation);
}

function drawnWalls(walls) {
  return (walls || []).filter((w) => w.drawn && (w.length || 0) >= 0.05);
}

/**
 * The plug a click would commit, or null when no drawn wall is close enough.
 * `preferId` is the wall already selected: it wins while the click is in its reach.
 */
export function wallSocketDraft(walls, sku, x, y, { preferId = null } = {}) {
  if (!sku) return null;
  const list = drawnWalls(walls);
  let wall = null;
  if (preferId) {
    const pref = list.find((w) => w.id === preferId);
    if (pref && distToWall(pref, x, y) <= wallSnapDist(pref)) wall = pref;
  }
  if (!wall) {
    let best = Infinity;
    for (const candidate of list) {
      const d = distToWall(candidate, x, y);
      if (d <= wallSnapDist(candidate) && d < best) {
        wall = candidate;
        best = d;
      }
    }
  }
  if (!wall) return null;
  const t = clampStation(wall, sku, wallT(wall, x, y));
  const side = swingToward(wall, x, y);
  return { host: "wall", wallId: wall.id, t, side, ...poseOnWall(sku, wall, t, side) };
}

/** Slide a plug along its own wall. It does not jump to another wall. */
export function slideWallSocket(item, wall, sku, x, y) {
  if (!item || !wall || !sku) return false;
  item.t = clampStation(wall, sku, wallT(wall, x, y));
  item.side = swingToward(wall, x, y);
  Object.assign(item, poseOnWall(sku, wall, item.t, item.side));
  return true;
}

function onHost(x, y, poly) {
  if (!poly || poly.length < 3) return false;
  if (pointInPoly(x, y, poly)) return true;
  const c = clampToPoly(x, y, poly);
  return Math.hypot(c.x - x, c.y - y) <= 1e-3;
}

/**
 * A floor point whose click is inside a slab, or null. The selected slab wins
 * when the click is inside it; otherwise the smallest slab under the click.
 */
export function floorSocketDraft(doc, sku, x, y, { preferId = null, level = null } = {}) {
  if (!sku) return null;
  const slabs = (doc?.slabs || []).filter((s) => level == null || s.level == null || s.level === level);
  const hits = [];
  for (const slab of slabs) {
    const poly = shapePolygon(slab.shape);
    if (onHost(x, y, poly)) hits.push({ slab, area: Math.abs(polyArea(poly)) });
  }
  if (!hits.length) return null;
  const preferred = preferId ? hits.find((h) => h.slab.id === preferId) : null;
  const hit = preferred || hits.sort((a, b) => a.area - b.area)[0];
  return { host: "slab", slabId: hit.slab.id, ...placeCorner(x, y, sku, 0) };
}

/** Floor points hosted by any of these slabs. */
export function floorHostedItems(doc, refs) {
  const ids = new Set((refs || []).filter((r) => r?.kind === "slab").map((r) => r.id));
  if (!ids.size) return [];
  return (doc?.items || []).filter((item) => item.host === "slab" && ids.has(item.slabId));
}

/** Move floor points with a slab that is being translated as a whole. */
export function translateFloorSockets(doc, slabId, dx, dy) {
  if (!slabId || !doc) return;
  for (const item of doc.items || []) {
    if (item.host !== "slab" || item.slabId !== slabId) continue;
    item.x += dx;
    item.y += dy;
  }
}

/**
 * Turn or mirror the centre of each floor point on these slabs.
 * Returns the item ids that moved, so a later pass does not move them again.
 */
export function transformFloorSockets(doc, refs, mapPoint, turnSteps = 0) {
  const ids = new Set();
  const steps = ((turnSteps % 4) + 4) % 4;
  for (const item of floorHostedItems(doc, refs)) {
    const c = centreOf(item, null);
    const [x, y] = mapPoint(c.x, c.y);
    const rotation = ((item.rotation || 0) + steps * 90) % 360;
    Object.assign(item, placeCorner(x, y, null, rotation));
    ids.add(item.id);
  }
  return ids;
}

/**
 * After a wall is split, a plug past the cut belongs to the tail.
 * `cut` and `len` are metres along the wall before it was broken.
 */
export function rehostSocketsAfterSplit(doc, headId, tailId, cut, len) {
  if (!headId || !tailId || !(len > 0)) return;
  for (const item of doc?.items || []) {
    if (item.host !== "wall" || item.wallId !== headId) continue;
    const station = Math.min(1, Math.max(0, Number(item.t) || 0)) * len;
    if (station <= cut) item.t = cut > 0 ? station / cut : 0;
    else {
      item.wallId = tailId;
      item.t = (len - cut) > 0 ? (station - cut) / (len - cut) : 0;
    }
  }
}

/**
 * Write plan coordinates from each host. A missing host is left as stored,
 * so a fitting placed before hosting still sits where it was.
 * A floor point that an edge edit pushed outside is pulled back inside.
 */
export function syncHostedSockets(doc, pack, walls = null) {
  if (!doc || !pack) return;
  const derived = walls || deriveWalls(doc, pack);
  const skuOf = (id) => (pack.skus || []).find((s) => s.id === id) || null;
  for (const item of doc.items || []) {
    if (item.host === "wall") {
      const wall = derived.find((w) => w.drawn && w.id === item.wallId);
      if (!wall) continue;
      const sku = skuOf(item.sku);
      item.t = clampStation(wall, sku, Number(item.t));
      item.side = item.side === -1 ? -1 : 1;
      Object.assign(item, poseOnWall(sku, wall, item.t, item.side));
      if (wall.level) item.level = wall.level;
    } else if (item.host === "slab") {
      const slab = (doc.slabs || []).find((s) => s.id === item.slabId);
      if (!slab) continue;
      const poly = shapePolygon(slab.shape);
      if (poly.length < 3) continue;
      const sku = skuOf(item.sku);
      const c = centreOf(item, sku);
      const next = clampToPoly(c.x, c.y, poly);
      Object.assign(item, placeCorner(next.x, next.y, sku, item.rotation || 0));
      if (slab.level) item.level = slab.level;
    }
  }
}
