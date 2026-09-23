// A drawing, small enough to recognise and too small to work on.
//
// This is not the planner's renderer. `ui.js` draws from compile()'s output,
// which cannot give a wall a thickness until the SKU pack has been resolved;
// here the document's own shapes are enough, because at a hundred pixels
// across the difference between a 110mm wall and a 230mm one is nothing. What
// a preview owes the reader is the plan's outline and its proportions - which
// job this is, and roughly how much of it has been drawn.
//
// Every storey is drawn over every other. A thumbnail is not a floor plan and
// choosing one level would mean choosing which storey counts as the job.

import { shapePolygon } from "../v2/model.js";

const COLOUR = {
  room: "rgba(178, 69, 30, 0.10)",
  roomEdge: "rgba(178, 69, 30, 0.45)",
  slab: "rgba(26, 22, 18, 0.06)",
  slabEdge: "rgba(26, 22, 18, 0.28)",
  roof: "rgba(36, 48, 68, 0.10)",
  roofEdge: "rgba(36, 48, 68, 0.30)",
  wall: "#1a1612",
};

/**
 * The outlines, from either shape a drawing arrives in: the compact rows
 * `/api/practice/drawing-previews` returns, or a whole `doc` from the planner
 * endpoint. Both name their arrays the same, which is why one reader serves.
 */
export function planOutlines(source) {
  const polys = (list) => (Array.isArray(list) ? list : [])
    .map((entry) => shapePolygon(entry?.shape))
    .filter((poly) => poly.length >= 3);
  const walls = (Array.isArray(source?.segments) ? source.segments : [])
    .filter((seg) => [seg?.x1, seg?.y1, seg?.x2, seg?.y2].every(Number.isFinite));
  return { rooms: polys(source?.rooms), slabs: polys(source?.slabs), roofs: polys(source?.roofs), walls };
}

/** Null for a document with nothing on it, so the caller says so in words. */
export function planBounds(outlines) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const see = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const poly of [...outlines.rooms, ...outlines.slabs, ...outlines.roofs]) {
    for (const [x, y] of poly) see(x, y);
  }
  for (const wall of outlines.walls) { see(wall.x1, wall.y1); see(wall.x2, wall.y2); }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Draw `source` into `canvas`, fitted to whatever size CSS has given it.
 *
 * Returns what was drawn - the counts and the extent in metres - so the
 * caption underneath can be facts rather than adjectives. Returns null when
 * there is nothing to draw, which is not a failure: a document is created the
 * moment somebody presses "Start a drawing", and an empty one is a true and
 * useful thing to report.
 */
export function drawPreview(canvas, source, { padding = 7 } = {}) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const outlines = planOutlines(source);
  const bounds = planBounds(outlines);
  if (!bounds) return null;

  // A single wall has no width, and a plan far taller than the box would
  // divide by an extent of zero on one axis. Both fall back to the other.
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const fitX = bounds.w > 1e-6 ? usableW / bounds.w : Infinity;
  const fitY = bounds.h > 1e-6 ? usableH / bounds.h : Infinity;
  const pxPerM = Math.min(fitX, fitY);
  if (!Number.isFinite(pxPerM) || pxPerM <= 0) return null;

  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const at = (x, y) => [width / 2 + (x - midX) * pxPerM, height / 2 + (y - midY) * pxPerM];

  const fill = (poly, colour, edge) => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => {
      const [px, py] = at(x, y);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    if (!edge) return;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // Ground up, the way the planner stacks them: slab, roof, room, wall. Each
  // gets an edge, because a site layout is mostly slabs and five erven that
  // touch would otherwise read as one grey field.
  for (const poly of outlines.slabs) fill(poly, COLOUR.slab, COLOUR.slabEdge);
  for (const poly of outlines.roofs) fill(poly, COLOUR.roof, COLOUR.roofEdge);
  for (const poly of outlines.rooms) fill(poly, COLOUR.room, COLOUR.roomEdge);

  ctx.strokeStyle = COLOUR.wall;
  ctx.lineCap = "round";
  // Real thickness needs the pack. A hairline that stays visible when the
  // whole plan is a hundred pixels wide is the honest substitute: it says
  // "a wall runs here", which is all this size can carry.
  ctx.lineWidth = Math.max(1, Math.min(3, 0.22 * pxPerM));
  for (const wall of outlines.walls) {
    const [ax, ay] = at(wall.x1, wall.y1);
    const [bx, by] = at(wall.x2, wall.y2);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  return {
    rooms: outlines.rooms.length,
    walls: outlines.walls.length,
    slabs: outlines.slabs.length,
    roofs: outlines.roofs.length,
    width: bounds.w,
    height: bounds.h,
  };
}
