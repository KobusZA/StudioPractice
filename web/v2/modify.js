// Modify operations: toolbar 3 of the customer's requirements sheet.
//
// Every operation here is a single deterministic click with a stated default,
// not an interactive gesture. Rotate is 90 degrees, mirror is about the
// selection's own centre, align is to the primary object's left edge. That is a
// deliberate trade: it makes the whole toolbar usable in a week instead of one
// operation being usable in a week, and the defaults are the ones a rectangle
// plan actually needs.
//
// Pure functions over (doc, refs). They mutate the document and return
// { ok, message }, so ui.js owns undo, persistence and redraw, and the tests
// never touch a DOM.

import {
  attachPreview,
  drawnObjectHeight,
  levelElevation,
  objectLabel,
  resolvedBase,
} from "./compile.js";
import { MIN_TRACE, centerlineFromLocation, locationLineOf, mirroredWallLocation, normalizeWallLocation, realignAboutLocation, rethickenAboutLocation } from "./click-draw.js?v=20261103-bos10";
import { bbox, roundGrid } from "./geom.js";
import {
  ATTACHABLE_KINDS,
  collectionFor,
  effectiveLevel,
  nid,
  objectByRef,
  sameRef,
  finishRegionPolygon,
  hostedFinishRegions,
  hostedFinishRegionsOf,
  polyShape,
  shapePolygon,
  shapeRects,
  uniqueRefs,
} from "./model.js";
import { finishId } from "./finish-data.js";
import { reanchorRun } from "./finish-model.js";
import { CORNER_JOIN_TOL, drawnWallThickness } from "./walls.js";
import { rehostSocketsAfterSplit, transformFloorSockets, translateFloorSockets } from "./socket-host.js";

const SHAPED = new Set(["room", "slab", "roof", "region"]);
// Every endpoint-geometry kind: rotate/mirror/copy/align/split/cut/join all
// work on nothing but x1/y1/x2/y2, so a line (no SKU, no thickness) is as
// eligible as a wall or beam for those. Attach/detach are narrower - a base
// only resolves against something with a template-stated height - so those
// two check `ATTACHABLE_KINDS` (model.js) instead of this set.
const ENDPOINTED = new Set(["segment", "beam", "line", "dimension", "separation"]);

function fail(message) {
  return { ok: false, message };
}

function done(message, refs) {
  return { ok: true, message, refs };
}

function resolve(doc, refs) {
  return uniqueRefs(refs)
    .map((ref) => ({ ref, obj: objectByRef(doc, ref) }))
    .filter((row) => row.obj);
}

/** Bounding box of everything selected, in world units. */
export function selectionBounds(doc, refs) {
  const points = [];
  for (const { ref, obj } of resolve(doc, refs)) {
    if (SHAPED.has(ref.kind)) points.push(...shapePolygon(obj.shape));
    else if (obj.rect && Number.isFinite(obj.rect.minX)) points.push([obj.rect.minX, obj.rect.minY], [obj.rect.maxX, obj.rect.maxY]);
    else if (ENDPOINTED.has(ref.kind)) points.push([obj.x1, obj.y1], [obj.x2, obj.y2]);
    else if (obj.x !== undefined) points.push([obj.x, obj.y]);
  }
  return points.length ? bbox(points) : null;
}

function centreOf(box) {
  return [box.x + box.w / 2, box.y + box.h / 2];
}

// --- rotate ----------------------------------------------------------------

/**
 * Rotate about the selection centre. Restricted to multiples of 90 degrees
 * because an axis-aligned rectangle stays an axis-aligned rectangle under them,
 * which keeps `roomMinDimension` exact. A free angle would silently downgrade
 * every rotated room to the convex-hull approximation.
 */
/** Doors are hosted in a wall, so a selection of only openings has no box to turn. */
function openingOnly(rows) {
  return rows.length > 0 && rows.every(({ ref }) => ref.kind === "opening");
}

function doorsOf(rows) {
  return rows.filter(({ obj }) => obj.hand === 1 || obj.hand === -1);
}

export function rotateSelection(doc, refs, { degrees = 90 } = {}) {
  const turns = Math.round(degrees / 90) % 4;
  if (turns === 0) return fail("Rotation must be a multiple of 90°.");
  const rows = resolve(doc, refs);
  if (!rows.length) return fail("Nothing selected.");
  const box = selectionBounds(doc, refs);
  if (!box) {
    if (!openingOnly(rows)) return fail("Nothing selected can be rotated.");
    const doors = doorsOf(rows);
    if (!doors.length) return fail("A window stays in its wall. Drag it along the wall to move it.");
    for (const { obj } of doors) obj.hand = obj.hand === -1 ? 1 : -1;
    return done(doors.length === 1
      ? "Hinge flipped. Drag the door along the wall to move it."
      : `Flipped the hinge on ${doors.length} doors.`);
  }
  const [cx, cy] = centreOf(box);

  const turn = (x, y) => {
    let px = x - cx;
    let py = y - cy;
    for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) {
      [px, py] = [py, -px]; // clockwise quarter turn
    }
    return [roundGrid(cx + px), roundGrid(cy + py)];
  };

  // A floor's tiles and waterproofing turn with it. Found first, while the
  // floor is still where they sit.
  for (const region of hostedFinishRegionsOf(doc, rows.map((r) => r.ref))) {
    region.shape = rotateShape(region.shape, turn);
  }
  const turnedSockets = transformFloorSockets(doc, rows.map((r) => r.ref), turn, turns);

  for (const { ref, obj } of rows) {
    if (ref.kind === "item" && turnedSockets.has(obj.id)) continue;
    if (SHAPED.has(ref.kind)) {
      obj.shape = rotateShape(obj.shape, turn);
      if (obj.seed) [obj.seed.x, obj.seed.y] = turn(obj.seed.x, obj.seed.y);
    } else if (obj.rect && Number.isFinite(obj.rect.minX)) {
      obj.rect = rectFromCorners(obj.rect, turn);
    } else if (ENDPOINTED.has(ref.kind)) {
      [obj.x1, obj.y1] = turn(obj.x1, obj.y1);
      [obj.x2, obj.y2] = turn(obj.x2, obj.y2);
    } else if (obj.x !== undefined) {
      [obj.x, obj.y] = turn(obj.x, obj.y);
      obj.rotation = ((obj.rotation || 0) + turns * 90) % 360;
    }
  }
  return done(`Rotated ${rows.length} object${rows.length === 1 ? "" : "s"} ${turns * 90}°.`);
}

/** A rect under a quarter turn is still a rect, so map its corners and rebuild. */
function rectFromCorners(rect, turn) {
  const corners = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
  ].map(([x, y]) => turn(x, y));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function rotateRect(rect, turn) {
  const [ax, ay] = turn(rect.x, rect.y);
  const [bx, by] = turn(rect.x + rect.w, rect.y + rect.h);
  return {
    ...rect,
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

function rotateShape(shape, turn) {
  if (shape?.kind === "rect") return { ...shape, ...rotateRect(shape, turn) };
  if (shape?.kind === "rects") return { ...shape, rects: (shape.rects || []).map((r) => rotateRect(r, turn)) };
  if (shape?.kind === "poly") return { ...shape, points: (shape.points || []).map(([x, y]) => turn(x, y)) };
  return shape;
}

// --- mirror ----------------------------------------------------------------

/** Mirror about the selection's own vertical ("v") or horizontal ("h") centre line. */
export function mirrorSelection(doc, refs, { axis = "v" } = {}) {
  const rows = resolve(doc, refs);
  if (!rows.length) return fail("Nothing selected.");
  const box = selectionBounds(doc, refs);
  if (!box) {
    if (!openingOnly(rows)) return fail("Nothing selected can be mirrored.");
    const doors = doorsOf(rows);
    if (!doors.length) return fail("A window stays in its wall. Drag it along the wall to move it.");
    for (const { obj } of doors) obj.swing = -(obj.swing || 1);
    return done(doors.length === 1
      ? "Swing flipped to the other side of the wall."
      : `Flipped the swing on ${doors.length} doors.`);
  }
  const [cx, cy] = centreOf(box);
  const flip = (x, y) => (axis === "h"
    ? [roundGrid(x), roundGrid(2 * cy - y)]
    : [roundGrid(2 * cx - x), roundGrid(y)]);

  for (const region of hostedFinishRegionsOf(doc, rows.map((r) => r.ref))) {
    region.shape = rotateShape(region.shape, flip);
  }
  const flippedSockets = transformFloorSockets(doc, rows.map((r) => r.ref), flip, 0);

  for (const { ref, obj } of rows) {
    if (ref.kind === "item" && flippedSockets.has(obj.id)) continue;
    if (SHAPED.has(ref.kind)) {
      obj.shape = rotateShape(obj.shape, flip); // corner mapping is the same job
      if (obj.seed) [obj.seed.x, obj.seed.y] = flip(obj.seed.x, obj.seed.y);
    } else if (obj.rect && Number.isFinite(obj.rect.minX)) {
      obj.rect = rectFromCorners(obj.rect, flip);
    } else if (ENDPOINTED.has(ref.kind)) {
      [obj.x1, obj.y1] = flip(obj.x1, obj.y1);
      [obj.x2, obj.y2] = flip(obj.x2, obj.y2);
    } else if (obj.x !== undefined) {
      [obj.x, obj.y] = flip(obj.x, obj.y);
    }
    // swing is which side of the wall, and mirroring reverses that wall's
    // normal, so it swaps. hand is which end of the same wall; those ends
    // move with the mirror, so the hinge stays on its jamb.
    if (ref.kind === "opening" && obj.swing !== undefined) obj.swing = -obj.swing;
    if (ref.kind === "segment" && obj.location) obj.location = mirroredWallLocation(obj.location);
  }
  return done(`Mirrored ${rows.length} object${rows.length === 1 ? "" : "s"} about the ${axis === "h" ? "horizontal" : "vertical"} centre.`);
}

// --- copy ------------------------------------------------------------------

/**
 * Duplicate, offset by default one object-width to the right so the copy is
 * visible and clear of its original rather than stacked on it.
 */
export function copySelection(doc, refs, { dx = null, dy = 0 } = {}) {
  const rows = resolve(doc, refs);
  if (!rows.length) return fail("Nothing selected.");
  const box = selectionBounds(doc, refs);
  const offsetX = dx === null ? roundGrid((box?.w || 1) + 0.5) : dx;
  const created = [];

  for (const { ref, obj } of rows) {
    const copy = structuredClone(obj);
    copy.id = nid(ref.kind[0]);
    if (SHAPED.has(ref.kind)) {
      copy.shape = translateAny(copy.shape, offsetX, dy);
      if (copy.seed) {
        copy.seed = { x: copy.seed.x + offsetX, y: copy.seed.y + dy };
      }
    } else if (copy.rect && Number.isFinite(copy.rect.minX)) {
      copy.rect = {
        minX: copy.rect.minX + offsetX,
        minY: copy.rect.minY + dy,
        maxX: copy.rect.maxX + offsetX,
        maxY: copy.rect.maxY + dy,
      };
    } else if (ENDPOINTED.has(ref.kind)) {
      copy.x1 = copy.x1 + offsetX;
      copy.y1 = copy.y1 + dy;
      copy.x2 = copy.x2 + offsetX;
      copy.y2 = copy.y2 + dy;
    } else if (copy.x !== undefined) {
      copy.x = copy.x + offsetX;
      copy.y = copy.y + dy;
    } else {
      // An opening is anchored to a host, not to coordinates, so a blind copy
      // would land on the same spot on the same wall.
      continue;
    }
    // The copy of a floor carries its own copy of the tiles on it.
    const hosted = SHAPED.has(ref.kind) ? hostedFinishRegions(doc, ref) : [];
    collectionFor(doc, ref.kind).push(copy);
    created.push({ kind: ref.kind, id: copy.id });
    for (const region of hosted) {
      const twin = structuredClone(region);
      twin.id = finishId("fg");
      twin.shape = translateAny(twin.shape, offsetX, dy);
      if (ref.kind === "slab") twin.slabId = copy.id;
      else if (ref.kind === "room") twin.roomId = copy.id;
      doc.finishRegions.push(twin);
    }
  }

  if (!created.length) return fail("A door or window stays in its wall. Drag it along the wall to move it, or place another.");
  return done(`Copied ${created.length} object${created.length === 1 ? "" : "s"}.`, created);
}

function translateAny(shape, dx, dy) {
  const move = (x, y) => [x + dx, y + dy];
  return rotateShape(shape, move);
}

// --- align -----------------------------------------------------------------

const ALIGN_EDGES = ["left", "right", "top", "bottom"];

/** Align every selected object's bounding box to the anchor's chosen edge. */
export function alignSelection(doc, refs, { edge = "left", anchorRef = null } = {}) {
  if (!ALIGN_EDGES.includes(edge)) return fail(`Unknown edge ${edge}.`);
  const rows = resolve(doc, refs);
  if (rows.length < 2) return fail("Select two or more objects to align.");

  const anchor = anchorRef ? rows.find((r) => r.ref.kind === anchorRef.kind && r.ref.id === anchorRef.id) : rows[0];
  const anchorBox = selectionBounds(doc, [anchor.ref]);
  if (!anchorBox) return fail("The anchor object has no geometry.");

  let moved = 0;
  const movingSlabIds = new Set(rows.filter((r) => r !== anchor && r.ref.kind === "slab").map((r) => r.obj.id));
  for (const row of rows) {
    if (row === anchor) continue;
    if (row.ref.kind === "item" && row.obj.host === "slab" && movingSlabIds.has(row.obj.slabId)) continue;
    const box = selectionBounds(doc, [row.ref]);
    if (!box) continue;
    let dx = 0;
    let dy = 0;
    if (edge === "left") dx = anchorBox.x - box.x;
    else if (edge === "right") dx = (anchorBox.x + anchorBox.w) - (box.x + box.w);
    else if (edge === "bottom") dy = anchorBox.y - box.y;
    else dy = (anchorBox.y + anchorBox.h) - (box.y + box.h);
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
    translateObject(row.ref, row.obj, dx, dy, doc);
    moved += 1;
  }
  return done(`Aligned ${moved} object${moved === 1 ? "" : "s"} to the ${edge} of ${anchor.obj.name || anchor.ref.kind}.`);
}

function translateObject(ref, obj, dx, dy, doc = null) {
  if (SHAPED.has(ref.kind)) {
    // Found before the floor moves, while the tiles still sit on it.
    const hosted = doc ? hostedFinishRegions(doc, ref) : [];
    obj.shape = translateAny(obj.shape, dx, dy);
    for (const region of hosted) region.shape = translateAny(region.shape, dx, dy);
    if (ref.kind === "slab") translateFloorSockets(doc, obj.id, dx, dy);
  }
  else if (ENDPOINTED.has(ref.kind)) {
    obj.x1 = obj.x1 + dx;
    obj.y1 = obj.y1 + dy;
    obj.x2 = obj.x2 + dx;
    obj.y2 = obj.y2 + dy;
  } else if (obj.x !== undefined) {
    obj.x = obj.x + dx;
    obj.y = obj.y + dy;
  }
}

// --- merge -----------------------------------------------------------------

/**
 * Fold several rectangle-based rooms into one. The result is a "rects" shape, so
 * an L or T comes out of merging two rectangles and `roomMinDimension` stays
 * exact. Free polygons are refused rather than approximated.
 */
export function mergeSelection(doc, refs) {
  const rows = resolve(doc, refs);
  if (rows.length < 2) return fail("Select two or more objects to merge.");
  const kind = rows[0].ref.kind;
  if (!SHAPED.has(kind)) return fail("Only rooms, floors and roofs can be merged.");
  if (rows.some((r) => r.ref.kind !== kind)) return fail("Merge one kind at a time.");

  const rects = [];
  for (const { obj } of rows) {
    const own = shapeRects(obj.shape);
    if (!own.length) return fail("A free polygon cannot be merged yet; the rectangle union is what keeps room dimensions exact.");
    rects.push(...own);
  }

  const keeper = rows[0].obj;
  // Tiles on the floors folded into the keeper stay on the merged floor.
  for (const region of hostedFinishRegionsOf(doc, rows.map((r) => r.ref))) {
    if (kind === "slab") {
      // A whole-floor region must keep the outline it had; the merged floor is bigger.
      if (region.whole) region.shape = polyShape(finishRegionPolygon(doc, region));
      delete region.whole;
      region.slabId = keeper.id;
    } else if (kind === "room") region.roomId = keeper.id;
  }
  keeper.shape = { kind: "rects", rects };

  const list = collectionFor(doc, kind);
  for (const { obj } of rows.slice(1)) {
    const idx = list.indexOf(obj);
    if (idx >= 0) list.splice(idx, 1);
  }
  return done(`Merged ${rows.length} ${kind}s into "${keeper.name || keeper.id}".`, [{ kind, id: keeper.id }]);
}

// --- split -----------------------------------------------------------------

/** Halve a rectangle across its long axis, so the two halves stay usable rooms. */
export function splitSelection(doc, refs) {
  const rows = resolve(doc, refs);
  if (rows.length !== 1) return fail("Select exactly one object to split.");
  const { ref, obj } = rows[0];

  if (ENDPOINTED.has(ref.kind)) return cutSelection(doc, refs);
  if (!SHAPED.has(ref.kind)) return fail("Only rooms, floors, roofs, walls and beams can be split.");

  const rects = shapeRects(obj.shape);
  if (rects.length !== 1) return fail("Split works on a single rectangle; merge or reshape first.");
  const [r] = rects;
  const horizontal = r.w >= r.h;
  const half = roundGrid(horizontal ? r.w / 2 : r.h / 2);
  if (half < 0.2) return fail("Too small to split.");

  const a = horizontal ? { ...r, w: half } : { ...r, h: half };
  const b = horizontal
    ? { ...r, x: roundGrid(r.x + half), w: roundGrid(r.w - half) }
    : { ...r, y: roundGrid(r.y + half), h: roundGrid(r.h - half) };

  obj.shape = { kind: "rect", ...a };
  const copy = structuredClone(obj);
  copy.id = nid(ref.kind[0]);
  copy.shape = { kind: "rect", ...b };
  if (copy.name) copy.name = `${copy.name} 2`;
  collectionFor(doc, ref.kind).push(copy);

  return done(`Split into two ${horizontal ? "side by side" : "stacked"}.`, [ref, { kind: ref.kind, id: copy.id }]);
}

// --- cut -------------------------------------------------------------------

/** Break a wall or beam in two at its midpoint, so each half can be retyped. */
export function cutSelection(doc, refs) {
  const rows = resolve(doc, refs);
  if (rows.length !== 1) return fail("Select exactly one wall, beam or line to cut.");
  const { ref, obj } = rows[0];
  if (!ENDPOINTED.has(ref.kind)) return fail("Cut applies to walls, beams and lines; use Split for rooms.");

  const mx = roundGrid((obj.x1 + obj.x2) / 2);
  const my = roundGrid((obj.y1 + obj.y2) / 2);
  const tail = structuredClone(obj);
  tail.id = nid(ref.kind[0]);
  tail.x1 = mx;
  tail.y1 = my;
  obj.x2 = mx;
  obj.y2 = my;
  collectionFor(doc, ref.kind).push(tail);

  return done("Cut in two at the midpoint.", [ref, { kind: ref.kind, id: tail.id }]);
}

export const MIN_WALL_SPLIT_M = 0.05;

/**
 * Break one wall at a chosen point on its centreline. The head keeps its id.
 * An opening stays on the piece that holds its centre, with `t` rewritten for
 * that piece. A finish stays on the piece it covered; one that crosses the cut
 * is divided, and a whole-face finish is a whole face of both pieces.
 */
export function splitWallAt(doc, ref, point, { skuById = () => null } = {}) {
  if (!ref || ref.kind !== "segment") return fail("Select a wall to split.");
  const obj = objectByRef(doc, ref);
  if (!obj) return fail("Select a wall to split.");
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return fail("Click on the wall to split it.");

  const dx = obj.x2 - obj.x1;
  const dy = obj.y2 - obj.y1;
  const len = Math.hypot(dx, dy);
  if (len < MIN_WALL_SPLIT_M * 2) return fail("Too small to split.");
  const along = metresAlong(obj, point.x, point.y);
  const onWall = pointAlong(obj, along);
  if (Math.hypot(onWall.x - point.x, onWall.y - point.y) > MIN_WALL_SPLIT_M) return fail("Click on the wall to split it.");
  const cut = Math.round(along * 1000) / 1000;
  if (cut < MIN_WALL_SPLIT_M || len - cut < MIN_WALL_SPLIT_M) return fail("Too close to an end to split.");

  const cutPt = pointAlong(obj, cut);
  const tail = structuredClone(obj);
  tail.id = nid(ref.kind[0]);
  tail.x1 = cutPt.x;
  tail.y1 = cutPt.y;
  obj.x2 = cutPt.x;
  obj.y2 = cutPt.y;
  if (Number.isFinite(obj.length)) obj.length = cut;
  if (Number.isFinite(tail.length)) tail.length = len - cut;
  collectionFor(doc, ref.kind).push(tail);

  rehostSplitWall(doc, obj, tail, cut, len, skuById);
  rehostSocketsAfterSplit(doc, obj.id, tail.id, cut, len);
  return done("Split into two.", [ref, { kind: ref.kind, id: tail.id }]);
}

function clipOutline(outline, start, end, shift) {
  const pts = (outline || []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  if (pts.length < 3) return null;
  const inside = (s) => s >= start - 1e-6 && s <= end + 1e-6;
  const out = [];
  const push = (s, z) => {
    const ls = s - shift;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - ls) < 1e-4 && Math.abs(last[1] - z) < 1e-4) return;
    out.push([ls, z]);
  };
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[(i + pts.length - 1) % pts.length];
    const cur = pts[i];
    const ps = Number(prev[0]);
    const pz = Number(prev[1]);
    const s = Number(cur[0]);
    const z = Number(cur[1]);
    if (Math.abs(s - ps) > 1e-12) {
      const hits = [];
      for (const bound of [start, end]) {
        const u = (bound - ps) / (s - ps);
        if (u > 1e-6 && u < 1 - 1e-6) hits.push({ u, s: bound, z: pz + (z - pz) * u });
      }
      hits.sort((a, b) => a.u - b.u);
      for (const hit of hits) push(hit.s, hit.z);
    }
    if (inside(s)) push(s, z);
  }
  return out.length >= 3 ? out : null;
}

function pieceSpan(a, b, start, end) {
  const lo = Math.max(Math.min(a, b), start);
  const hi = Math.min(Math.max(a, b), end);
  return hi - lo > 1e-4 ? [lo, hi] : null;
}

function assignFinishPiece(run, seg, start, span, skuById) {
  const [lo, hi] = span;
  run.wallId = seg.id;
  run.a = lo - start;
  run.b = hi - start;
  if (Array.isArray(run.outline)) {
    const clipped = clipOutline(run.outline, lo, hi, start);
    if (clipped) run.outline = clipped;
    else delete run.outline;
  }
  reanchorRun(run, hostedWall(seg, skuById));
}

function rehostSplitWall(doc, head, tail, cut, len, skuById) {
  for (const opening of doc.openings || []) {
    if (opening.wallId !== head.id || !Number.isFinite(Number(opening.t))) continue;
    const station = Math.min(1, Math.max(0, Number(opening.t))) * len;
    if (station <= cut) opening.t = station / cut;
    else {
      opening.wallId = tail.id;
      opening.t = (station - cut) / (len - cut);
    }
  }

  const extra = [];
  for (const run of [...(doc.finishRuns || [])]) {
    if (run.wallId !== head.id) continue;
    const whole = run.a == null || run.b == null;
    if (whole) {
      const copy = structuredClone(run);
      copy.id = finishId("fx");
      copy.wallId = tail.id;
      if (Array.isArray(copy.outline)) {
        const clipped = clipOutline(copy.outline, cut, len, cut);
        if (clipped) copy.outline = clipped;
        else delete copy.outline;
      }
      if (Array.isArray(run.outline)) {
        const clipped = clipOutline(run.outline, 0, cut, 0);
        if (clipped) run.outline = clipped;
        else delete run.outline;
      }
      reanchorRun(run, hostedWall(head, skuById));
      reanchorRun(copy, hostedWall(tail, skuById));
      extra.push(copy);
      continue;
    }
    const headSpan = pieceSpan(run.a, run.b, 0, cut);
    const tailSpan = pieceSpan(run.a, run.b, cut, len);
    if (headSpan && tailSpan) {
      const copy = structuredClone(run);
      copy.id = finishId("fx");
      assignFinishPiece(copy, tail, cut, tailSpan, skuById);
      assignFinishPiece(run, head, 0, headSpan, skuById);
      extra.push(copy);
    } else if (tailSpan) assignFinishPiece(run, tail, cut, tailSpan, skuById);
    else if (headSpan) assignFinishPiece(run, head, 0, headSpan, skuById);
  }
  if (extra.length) {
    if (!Array.isArray(doc.finishRuns)) doc.finishRuns = [];
    doc.finishRuns.push(...extra);
  }
}

// --- join ------------------------------------------------------------------

const JOIN_TOL = 0.05;
const COLLINEAR_TOL = 1e-3;

/**
 * Where a selected wall meets another end to end on the same line.
 * A corner is not one: the two runs have to be collinear. One point per pair,
 * so selecting both pieces still marks the joint once.
 */
export function collinearWallJoints(segments, selectedIds, tol = JOIN_TOL) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const list = (segments || []).filter((seg) => seg && Number.isFinite(seg.x1));
  const out = [];
  const seen = new Set();
  for (const a of list) {
    if (!ids.has(a.id)) continue;
    for (const b of list) {
      if (!b || b === a || b.id === a.id) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(key)) continue;
      if (!sameLevel(a, b) || !runsCollinear(a, b)) continue;
      const point = sharedEndpoint(a, b, tol);
      if (!point) continue;
      seen.add(key);
      out.push({ ...point, id: a.id });
    }
  }
  return out;
}

function sharedEndpoint(a, b, tol) {
  const ends = [[a.x1, a.y1], [a.x2, a.y2]];
  const other = [[b.x1, b.y1], [b.x2, b.y2]];
  for (const [ax, ay] of ends) {
    for (const [bx, by] of other) {
      if (endsMeet(ax, ay, bx, by, tol)) return { x: (ax + bx) / 2, y: (ay + by) / 2 };
    }
  }
  return null;
}

function runsCollinear(a, b) {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA < 1e-9 || lenB < 1e-9) return false;
  return Math.abs(ax * by - ay * bx) / (lenA * lenB) <= COLLINEAR_TOL;
}

/** Weld two collinear walls or beams that meet end to end back into one. */
export function joinSelection(doc, refs) {
  const rows = resolve(doc, refs);
  if (rows.length !== 2) return fail("Select exactly two walls, beams or lines to join.");
  if (rows.some((r) => !ENDPOINTED.has(r.ref.kind))) return fail("Join applies to walls, beams and lines.");
  const [first, second] = rows;
  if (first.ref.kind !== second.ref.kind) return fail("Join one kind at a time.");
  if (first.obj.sku !== second.obj.sku) return fail("These have different types; retype one first.");

  const a = first.obj;
  const b = second.obj;
  const ends = [
    [[a.x1, a.y1], [a.x2, a.y2], [b.x1, b.y1], [b.x2, b.y2]],
    [[a.x2, a.y2], [a.x1, a.y1], [b.x1, b.y1], [b.x2, b.y2]],
    [[a.x1, a.y1], [a.x2, a.y2], [b.x2, b.y2], [b.x1, b.y1]],
    [[a.x2, a.y2], [a.x1, a.y1], [b.x2, b.y2], [b.x1, b.y1]],
  ];

  const match = ends.find(([, aTouch, bTouch]) => Math.hypot(aTouch[0] - bTouch[0], aTouch[1] - bTouch[1]) <= JOIN_TOL);
  if (!match) return fail("These do not meet end to end.");

  const [keepA, , , keepB] = match;
  const cross = (a.x2 - a.x1) * (b.y2 - b.y1) - (a.y2 - a.y1) * (b.x2 - b.x1);
  const lenA = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
  const lenB = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1;
  if (Math.abs(cross) / (lenA * lenB) > COLLINEAR_TOL) return fail("These are not collinear.");

  a.x1 = keepA[0];
  a.y1 = keepA[1];
  a.x2 = keepB[0];
  a.y2 = keepB[1];

  const list = collectionFor(doc, second.ref.kind);
  const idx = list.indexOf(b);
  if (idx >= 0) list.splice(idx, 1);

  return done("Joined into one.", [first.ref]);
}

// --- retype ------------------------------------------------------------

/**
 * Which field a SKU would land in on this object, or null if the SKU's
 * category cannot retype this kind at all. Mirrors the per-kind rules v1's
 * `applySkuToSelection` (ui.js) checked one object at a time - kept here so a
 * one-object click and a whole-selection retype apply exactly the same rule.
 */
function retypeField(ref, obj, sku, skuById) {
  if (ref.kind === "room") {
    if (sku.category === "wall" || sku.category === "boundarywall") return "wallSku";
    if (sku.category === "floor") return "floorSku";
    return null;
  }
  if (ref.kind === "slab") return (sku.category === "floor" || sku.category === "pool") ? "sku" : null;
  if (ref.kind === "roof") return (sku.category === "roof" || sku.category === "carport") ? "sku" : null;
  if (ref.kind === "segment") {
    return (sku.category === "wall" || sku.category === "foundation" || sku.category === "boundarywall") ? "sku" : null;
  }
  if (ref.kind === "opening" || ref.kind === "item") {
    return skuById(obj.sku)?.category === sku.category ? "sku" : null;
  }
  if (ref.kind === "beam") return (sku.category === "beam" || sku.category === "column") ? "sku" : null;
  return null;
}

/**
 * Retype a whole selection to one SKU in one action - Revit's Type Selector
 * applied to a multi-object selection, rather than the one-object-at-a-time
 * limit the palette click used to have. Compatibility is judged per object,
 * so a mixed selection (say, a run of foundations plus one interior wall)
 * retypes only the members that accept the clicked SKU's category and
 * reports the rest as skipped instead of silently leaving the whole
 * selection untouched.
 */
export function retypeSelection(doc, refs, sku, { skuById = () => null } = {}) {
  const rows = resolve(doc, refs);
  if (!rows.length) return fail("Nothing selected.");

  const retyped = [];
  const skipped = [];
  for (const row of rows) {
    const field = retypeField(row.ref, row.obj, sku, skuById);
    if (!field) { skipped.push(row); continue; }
    if (row.ref.kind === "segment") {
      rethickenAboutLocation(row.obj, drawnWallThickness(skuById(row.obj.sku)), drawnWallThickness(sku));
    }
    row.obj[field] = sku.id;
    retyped.push(row);
  }

  if (!retyped.length) return fail("Nothing selected can be that type.");

  const plural = retyped.length === 1 ? "" : "s";
  const skipText = skipped.length
    ? `; left ${skipped.length} unchanged (different kind)`
    : "";
  return {
    ok: true,
    message: `Retyped ${retyped.length} object${plural} to "${sku.name}"${skipText}.`,
    refs: retyped.map((row) => row.ref),
    skipped: skipped.map((row) => row.ref),
  };
}

// --- location line ---------------------------------------------------------

const FACE_CATEGORIES = new Set(["wall", "boundarywall"]);
const FACE_WORD = { center: "centreline", exterior: "exterior face", interior: "interior face" };

function faceThickness(obj, skuById) {
  const sku = skuById(obj?.sku);
  if (!sku || !FACE_CATEGORIES.has(sku.category)) return 0;
  return drawnWallThickness(sku);
}

function endsOf(seg) {
  return { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 };
}

function sameLevel(a, b) {
  return (a?.level ?? null) === (b?.level ?? null);
}

function endsMeet(ax, ay, bx, by, tol) {
  return Math.hypot(ax - bx, ay - by) <= tol;
}

function pointAlong(seg, metres) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1;
  return {
    x: seg.x1 + ((seg.x2 - seg.x1) / len) * metres,
    y: seg.y1 + ((seg.y2 - seg.y1) / len) * metres,
  };
}

function metresAlong(seg, x, y) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  if (len < 1e-9) return 0;
  const t = ((x - seg.x1) * (seg.x2 - seg.x1) + (y - seg.y1) * (seg.y2 - seg.y1)) / (len * len);
  return Math.min(len, Math.max(0, t)) * len;
}

function fractionAlong(seg, x, y) {
  const len2 = (seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2;
  if (len2 < 1e-18) return 0;
  const t = ((x - seg.x1) * (seg.x2 - seg.x1) + (y - seg.y1) * (seg.y2 - seg.y1)) / len2;
  return Math.min(1, Math.max(0, t));
}

function hostedWall(seg, skuById) {
  return {
    ...seg,
    length: Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1),
    thickness: drawnWallThickness(skuById(seg.sku)),
  };
}

/** A finish measured in metres from the wall's first end keeps that point in the plan. */
function keepFinishPoint(run, oldSeg, seg) {
  if (run.a == null || run.b == null) return;
  const p1 = pointAlong(oldSeg, run.a);
  const p2 = pointAlong(oldSeg, run.b);
  run.a = metresAlong(seg, p1.x, p1.y);
  run.b = metresAlong(seg, p2.x, p2.y);
  if (run.a > run.b) [run.a, run.b] = [run.b, run.a];
  if (Array.isArray(run.outline)) {
    run.outline = run.outline.map(([s, z]) => [metresAlong(seg, pointAlong(oldSeg, s).x, pointAlong(oldSeg, s).y), z]);
  }
}

/**
 * Switch selected walls onto a location line. Each wall keeps the line it was
 * drawn on and the body shifts onto the chosen face or centreline. Another
 * segment that shared an endpoint moves that endpoint with it, so the corner
 * stays closed. Openings and finishes on the moved wall keep their station.
 * On a neighbour whose end moved, they keep their point in the plan.
 */
export function realignWallFaces(doc, refs, newLocation, { skuById = () => null, tol = CORNER_JOIN_TOL } = {}) {
  const loc = normalizeWallLocation(newLocation);
  const rows = resolve(doc, refs).filter((row) => row.ref.kind === "segment" && faceThickness(row.obj, skuById) > 0);
  if (!rows.length) return fail("Select a wall to change its face.");

  const moves = [];
  for (const row of rows) {
    if (normalizeWallLocation(row.obj.location) === loc) continue;
    const thickness = faceThickness(row.obj, skuById);
    const old = endsOf(row.obj);
    const shifted = realignAboutLocation(row.obj, thickness, loc);
    if (!shifted) continue;
    moves.push({ obj: row.obj, ref: row.ref, old, thickness });
  }
  if (!moves.length) return { ok: true, changed: false, message: "Already on that line.", refs: [] };

  const movedIds = new Set(moves.map((move) => move.obj.id));
  const joined = new Map();
  const claimed = new Set();
  for (const move of moves) {
    const next = endsOf(move.obj);
    for (const other of doc.segments || []) {
      if (!other || movedIds.has(other.id) || !sameLevel(other, move.obj)) continue;
      for (const end of [1, 2]) {
        const ox = end === 1 ? other.x1 : other.x2;
        const oy = end === 1 ? other.y1 : other.y2;
        let nx = null;
        let ny = null;
        if (endsMeet(ox, oy, move.old.x1, move.old.y1, tol)) { nx = next.x1; ny = next.y1; }
        else if (endsMeet(ox, oy, move.old.x2, move.old.y2, tol)) { nx = next.x2; ny = next.y2; }
        if (nx === null) continue;
        const key = `${other.id}:${end}`;
        if (claimed.has(key)) continue;
        claimed.add(key);
        if (!joined.has(other.id)) joined.set(other.id, { seg: other, old: endsOf(other), ends: [] });
        joined.get(other.id).ends.push({ end, x: nx, y: ny });
      }
    }
  }
  for (const { seg, ends } of joined.values()) {
    for (const end of ends) {
      if (end.end === 1) { seg.x1 = end.x; seg.y1 = end.y; }
      else { seg.x2 = end.x; seg.y2 = end.y; }
    }
    if (Number.isFinite(seg.length)) seg.length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  }

  for (const move of moves) {
    for (const run of doc.finishRuns || []) {
      if (run.wallId === move.obj.id) reanchorRun(run, hostedWall(move.obj, skuById));
    }
  }
  for (const { seg, old } of joined.values()) {
    for (const run of doc.finishRuns || []) {
      if (run.wallId !== seg.id) continue;
      keepFinishPoint(run, old, seg);
      reanchorRun(run, hostedWall(seg, skuById));
    }
    for (const opening of doc.openings || []) {
      if (opening.wallId !== seg.id || !Number.isFinite(Number(opening.t))) continue;
      const px = old.x1 + (old.x2 - old.x1) * Number(opening.t);
      const py = old.y1 + (old.y2 - old.y1) * Number(opening.t);
      opening.t = fractionAlong(seg, px, py);
    }
  }

  const word = FACE_WORD[loc];
  const message = moves.length === 1
    ? `Wall moved onto the ${word}.`
    : `Moved ${moves.length} walls onto the ${word}.`;
  return { ok: true, changed: true, message, refs: moves.map((move) => move.ref) };
}

const ON_WALL_M = 0.02;

/** Metres along the infinite line through `seg`, negative before the start. */
function signedMetres(seg, x, y) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  return ((x - seg.x1) * dx + (y - seg.y1) * dy) / len;
}

function openingCentre(seg, opening) {
  const t = Math.min(1, Math.max(0, Number(opening.t)));
  return {
    x: seg.x1 + (seg.x2 - seg.x1) * t,
    y: seg.y1 + (seg.y2 - seg.y1) * t,
  };
}

function openingName(opening, skuById) {
  const cat = skuById(opening?.sku)?.category;
  if (cat === "window") return "window";
  if (cat === "door") return "door";
  return "opening";
}

/** True when the opening's centre would fall off the new centreline. */
function openingLeaves(oldSeg, nextSeg, opening) {
  if (opening.wallId !== oldSeg.id || !Number.isFinite(Number(opening.t))) return false;
  const at = openingCentre(oldSeg, opening);
  const len = Math.hypot(nextSeg.x2 - nextSeg.x1, nextSeg.y2 - nextSeg.y1);
  const along = signedMetres(nextSeg, at.x, at.y);
  return along < -ON_WALL_M || along > len + ON_WALL_M;
}

/**
 * Keep a finish's plan footprint on the new wall. A whole-face finish still
 * covers the face. A partial finish is cut back to the wall, and dropped
 * when nothing of it remains. Returns false when the run should be removed.
 */
function retargetFinish(run, oldSeg, seg, skuById) {
  if (run.a == null || run.b == null) {
    reanchorRun(run, hostedWall(seg, skuById));
    return true;
  }
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const p1 = pointAlong(oldSeg, Number(run.a));
  const p2 = pointAlong(oldSeg, Number(run.b));
  let a = signedMetres(seg, p1.x, p1.y);
  let b = signedMetres(seg, p2.x, p2.y);
  if (a > b) [a, b] = [b, a];
  const lo = Math.max(0, a);
  const hi = Math.min(len, b);
  if (hi - lo < ON_WALL_M) return false;
  run.a = lo;
  run.b = hi;
  if (Array.isArray(run.outline)) {
    const mapped = run.outline.map(([s, z]) => {
      const p = pointAlong(oldSeg, Number(s));
      return [signedMetres(seg, p.x, p.y), z];
    });
    const clipped = clipOutline(mapped, 0, len, 0);
    if (clipped) run.outline = clipped;
    else delete run.outline;
  }
  reanchorRun(run, hostedWall(seg, skuById));
  return true;
}

function retargetOpening(opening, oldSeg, seg) {
  const at = openingCentre(oldSeg, opening);
  opening.t = fractionAlong(seg, at.x, at.y);
}

/**
 * Move one end of a wall's location line onto a point, and store the
 * centreline that location line implies. A neighbour whose centreline end
 * met the old end moves to the new centreline end. Doors and windows keep
 * their place on the plan. The edit is refused, and nothing is written,
 * when one of them would no longer lie on its wall.
 */
export function moveWallEnd(doc, ref, end, point, { skuById = () => null, tol = CORNER_JOIN_TOL } = {}) {
  if (!ref || ref.kind !== "segment") return fail("Select a wall to move an end.");
  const obj = objectByRef(doc, ref);
  if (!obj) return fail("Select a wall to move an end.");
  if (end !== 1 && end !== 2) return fail("Click an end of this wall.");
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return fail("Click where this end should meet.");

  const thickness = faceThickness(obj, skuById);
  const line = locationLineOf(obj, thickness);
  const start = end === 1 ? { x: point.x, y: point.y } : { x: line.x1, y: line.y1 };
  const finish = end === 2 ? { x: point.x, y: point.y } : { x: line.x2, y: line.y2 };
  if (Math.hypot(finish.x - start.x, finish.y - start.y) < MIN_TRACE) return fail("That would make the wall too short.");

  const center = centerlineFromLocation(start, finish, thickness, obj.location);
  const old = endsOf(obj);
  const oldEnd = end === 1 ? { x: old.x1, y: old.y1 } : { x: old.x2, y: old.y2 };
  const newEnd = end === 1 ? { x: center.x1, y: center.y1 } : { x: center.x2, y: center.y2 };
  const plans = [{ seg: obj, old, next: center }];

  for (const other of doc.segments || []) {
    if (!other || other.id === obj.id || !sameLevel(other, obj)) continue;
    let x1 = other.x1;
    let y1 = other.y1;
    let x2 = other.x2;
    let y2 = other.y2;
    let touched = false;
    if (endsMeet(other.x1, other.y1, oldEnd.x, oldEnd.y, tol)) {
      x1 = newEnd.x;
      y1 = newEnd.y;
      touched = true;
    }
    if (endsMeet(other.x2, other.y2, oldEnd.x, oldEnd.y, tol)) {
      x2 = newEnd.x;
      y2 = newEnd.y;
      touched = true;
    }
    if (!touched) continue;
    if (Math.hypot(x2 - x1, y2 - y1) < MIN_TRACE) return fail("That would make the wall too short.");
    plans.push({ seg: other, old: endsOf(other), next: { x1, y1, x2, y2 } });
  }

  for (const plan of plans) {
    const host = { id: plan.seg.id, ...plan.old };
    for (const opening of doc.openings || []) {
      if (!openingLeaves(host, { id: plan.seg.id, ...plan.next }, opening)) continue;
      return fail(`That would leave the ${openingName(opening, skuById)} off the wall.`);
    }
  }

  for (const plan of plans) {
    plan.seg.x1 = plan.next.x1;
    plan.seg.y1 = plan.next.y1;
    plan.seg.x2 = plan.next.x2;
    plan.seg.y2 = plan.next.y2;
    if (Number.isFinite(plan.seg.length)) {
      plan.seg.length = Math.hypot(plan.next.x2 - plan.next.x1, plan.next.y2 - plan.next.y1);
    }
  }

  const drop = new Set();
  for (const plan of plans) {
    const host = { id: plan.seg.id, ...plan.old };
    for (const opening of doc.openings || []) {
      if (opening.wallId !== plan.seg.id || !Number.isFinite(Number(opening.t))) continue;
      retargetOpening(opening, host, plan.seg);
    }
    for (const run of doc.finishRuns || []) {
      if (run.wallId !== plan.seg.id) continue;
      if (!retargetFinish(run, host, plan.seg, skuById)) drop.add(run.id);
    }
  }
  if (drop.size) doc.finishRuns = (doc.finishRuns || []).filter((run) => !drop.has(run.id));

  return done("End moved.", [ref]);
}

// --- attach base -----------------------------------------------------------
//
// Revit's Attach Base, scoped to the numeric relationship: an object's base is
// resolved from another object's top instead of its level's flat datum. The
// arithmetic and every rule about what may attach to what live in compile.js
// (`attachPreview`), so the hover preview, this validity pass and the compiled
// schedule are one implementation, not three.

/** One message per cause, never a single "cannot attach" for all of them. */
const ATTACH_SKIP_MESSAGE = {
  "missing-target": "the target no longer exists",
  "not-attachable": "only a wall or beam has a top to attach to",
  self: "it is the target",
  "target-attached": "the target is itself attached to something",
  cycle: "it would create an attach cycle",
  "level-too-far": "the target is more than one level below",
  "no-height": "it would have no height left above the target",
  "target-height-unknown": "the template states no height for the target, so its top is unknown",
};

function labelOf(pack, ref, obj) {
  return `${objectLabel(pack, obj)} (${ref.id})`;
}

function skipClause(pack, skipped) {
  return skipped
    .map((row) => `${labelOf(pack, row.ref, row.obj)} will be skipped - ${ATTACH_SKIP_MESSAGE[row.reason] || "it cannot attach"}`)
    .join("; ");
}

/**
 * Attach every selected wall/beam's base to one target's top.
 *
 * Batch by design, the same anchor-plus-refs shape `alignSelection` uses: one
 * call attaches a whole run of walls to one foundation.
 *
 * Reports before it commits. Called without `commit` it mutates nothing and
 * returns the summary of what would happen, including which objects would be
 * skipped and why; the caller shows that, then calls again with `commit: true`.
 * Discovering a skipped wall later in the Check panel is the failure mode this
 * exists to avoid.
 */
export function attachSelection(doc, refs, { targetRef = null, pack = null, commit = false } = {}) {
  if (!pack) return fail("Attach needs the pack's level elevations; none is loaded.");
  const target = targetRef ? objectByRef(doc, targetRef) : null;
  const selected = resolve(doc, refs);
  const rows = selected.filter((row) => !sameRef(row.ref, targetRef));
  if (!targetRef || (!rows.length && !selected.length)) {
    return fail("Select at least one object and exactly one target.");
  }
  if (!rows.length) return fail("Pick a target that is not part of the selection.");
  if (rows.some((row) => !ATTACHABLE_KINDS.has(row.ref.kind))) return fail("Attach applies to walls and beams.");
  if (!target || !ATTACHABLE_KINDS.has(targetRef.kind)) return fail("Target has no resolvable elevation.");

  const attach = [];
  const skipped = [];
  for (const row of rows) {
    const preview = attachPreview(doc, pack, row.obj, targetRef);
    if (preview.ok) attach.push({ ...row, preview });
    else skipped.push({ ...row, reason: preview.reason });
  }

  // Nothing can attach: say which single thing is wrong rather than listing the
  // same cause once per selected object.
  if (!attach.length) {
    const causes = new Set(skipped.map((row) => row.reason));
    if (causes.size === 1) {
      const [only] = causes;
      if (only === "cycle") return fail("That would create an attach cycle.");
      if (only === "target-attached") return fail("Target is itself attached to something; attach chains are one level deep.");
      if (only === "level-too-far") return fail("Target is more than one level below.");
      if (only === "target-height-unknown") return fail(`The template states no height for ${labelOf(pack, targetRef, target)}, so there is nothing to sit on top of. Add a height to that type first.`);
      if (only === "no-height") return fail(`Target's top is already at or above ${rows.length === 1 ? "this object's" : "every selected object's"} own top.`);
    }
    return fail(`Nothing can attach to ${labelOf(pack, targetRef, target)}: ${skipClause(pack, skipped)}.`);
  }

  const plural = attach.length === 1 ? "" : "s";
  const skipText = skipped.length ? `; ${skipClause(pack, skipped)}` : "";
  if (!commit) {
    return {
      ok: true,
      pending: true,
      message: `${attach.length} object${plural} will attach to ${labelOf(pack, targetRef, target)}${skipText}.`,
      attach: attach.map((row) => row.ref),
      skipped: skipped.map((row) => ({ ref: row.ref, reason: row.reason })),
    };
  }

  for (const row of attach) {
    row.obj.baseAttach = { kind: targetRef.kind, id: targetRef.id };
  }
  return done(
    `Attached ${attach.length} object${plural} to ${labelOf(pack, targetRef, target)}${skipText}.`,
    attach.map((row) => row.ref),
  );
}

/**
 * Clear the attach, leaving the object exactly where it was.
 *
 * Detach freezes the position it resolved to - into `baseOffset` and `height` -
 * rather than resetting it. Revit's own Detach does the same: it stops the live
 * link and leaves the wall where it sits. Writing `baseAttach = null` on its own
 * would drop the object back to its flat level datum and grow it back to full
 * height, which is a visible, unasked-for change to a drawing and a schedule.
 */
export function detachSelection(doc, refs, { pack = null } = {}) {
  if (!pack) return fail("Detach needs the pack's level elevations; none is loaded.");
  const rows = resolve(doc, refs).filter((row) => ATTACHABLE_KINDS.has(row.ref.kind));
  if (!rows.length) return fail("Detach applies to walls and beams.");
  const attached = rows.filter((row) => row.obj.baseAttach);
  if (!attached.length) return fail("Nothing selected is attached to anything.");

  for (const { obj } of attached) {
    const base = resolvedBase(doc, pack, obj, drawnObjectHeight(pack, obj));
    obj.baseOffset = round4(base.elevation - levelElevation(pack, effectiveLevel(obj, pack)));
    obj.height = round4(base.height);
    obj.baseAttach = null;
  }
  return done(`Detached ${attached.length} object${attached.length === 1 ? "" : "s"}, each at the elevation and height it already had.`);
}

/** Elevations are metres, so trim the float noise an attach chain accumulates. */
function round4(n) {
  return Number(n.toFixed(4));
}
