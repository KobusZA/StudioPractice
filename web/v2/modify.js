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
import { bbox, roundGrid } from "./geom.js";
import {
  ATTACHABLE_KINDS,
  collectionFor,
  effectiveLevel,
  nid,
  objectByRef,
  sameRef,
  shapePolygon,
  shapeRects,
  uniqueRefs,
} from "./model.js";

const SHAPED = new Set(["room", "slab", "roof"]);
// Every endpoint-geometry kind: rotate/mirror/copy/align/split/cut/join all
// work on nothing but x1/y1/x2/y2, so a line (no SKU, no thickness) is as
// eligible as a wall or beam for those. Attach/detach are narrower - a base
// only resolves against something with a template-stated height - so those
// two check `ATTACHABLE_KINDS` (model.js) instead of this set.
const ENDPOINTED = new Set(["segment", "beam", "line"]);

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
export function rotateSelection(doc, refs, { degrees = 90 } = {}) {
  const turns = Math.round(degrees / 90) % 4;
  if (turns === 0) return fail("Rotation must be a multiple of 90°.");
  const rows = resolve(doc, refs);
  if (!rows.length) return fail("Nothing selected.");
  const box = selectionBounds(doc, refs);
  const [cx, cy] = centreOf(box);

  const turn = (x, y) => {
    let px = x - cx;
    let py = y - cy;
    for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) {
      [px, py] = [py, -px]; // clockwise quarter turn
    }
    return [roundGrid(cx + px), roundGrid(cy + py)];
  };

  for (const { ref, obj } of rows) {
    if (SHAPED.has(ref.kind)) {
      obj.shape = rotateShape(obj.shape, turn);
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
  const [cx, cy] = centreOf(box);
  const flip = (x, y) => (axis === "h"
    ? [roundGrid(x), roundGrid(2 * cy - y)]
    : [roundGrid(2 * cx - x), roundGrid(y)]);

  for (const { ref, obj } of rows) {
    if (SHAPED.has(ref.kind)) {
      obj.shape = rotateShape(obj.shape, flip); // corner mapping is the same job
    } else if (ENDPOINTED.has(ref.kind)) {
      [obj.x1, obj.y1] = flip(obj.x1, obj.y1);
      [obj.x2, obj.y2] = flip(obj.x2, obj.y2);
    } else if (obj.x !== undefined) {
      [obj.x, obj.y] = flip(obj.x, obj.y);
    }
    // A door's swing is handed, so mirroring the plan must swap it.
    if (ref.kind === "opening" && obj.swing !== undefined) obj.swing = -obj.swing;
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
    } else if (ENDPOINTED.has(ref.kind)) {
      copy.x1 = roundGrid(copy.x1 + offsetX);
      copy.y1 = roundGrid(copy.y1 + dy);
      copy.x2 = roundGrid(copy.x2 + offsetX);
      copy.y2 = roundGrid(copy.y2 + dy);
    } else if (copy.x !== undefined) {
      copy.x = roundGrid(copy.x + offsetX);
      copy.y = roundGrid(copy.y + dy);
    } else {
      // An opening is anchored to a host, not to coordinates, so a blind copy
      // would land on the same spot on the same wall.
      continue;
    }
    collectionFor(doc, ref.kind).push(copy);
    created.push({ kind: ref.kind, id: copy.id });
  }

  if (!created.length) return fail("Openings are anchored to a wall; copy the wall or place another.");
  return done(`Copied ${created.length} object${created.length === 1 ? "" : "s"}.`, created);
}

function translateAny(shape, dx, dy) {
  const move = (x, y) => [roundGrid(x + dx), roundGrid(y + dy)];
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
  for (const row of rows) {
    if (row === anchor) continue;
    const box = selectionBounds(doc, [row.ref]);
    if (!box) continue;
    let dx = 0;
    let dy = 0;
    if (edge === "left") dx = anchorBox.x - box.x;
    else if (edge === "right") dx = (anchorBox.x + anchorBox.w) - (box.x + box.w);
    else if (edge === "bottom") dy = anchorBox.y - box.y;
    else dy = (anchorBox.y + anchorBox.h) - (box.y + box.h);
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
    translateObject(row.ref, row.obj, dx, dy);
    moved += 1;
  }
  return done(`Aligned ${moved} object${moved === 1 ? "" : "s"} to the ${edge} of ${anchor.obj.name || anchor.ref.kind}.`);
}

function translateObject(ref, obj, dx, dy) {
  if (SHAPED.has(ref.kind)) obj.shape = translateAny(obj.shape, dx, dy);
  else if (ENDPOINTED.has(ref.kind)) {
    obj.x1 = roundGrid(obj.x1 + dx);
    obj.y1 = roundGrid(obj.y1 + dy);
    obj.x2 = roundGrid(obj.x2 + dx);
    obj.y2 = roundGrid(obj.y2 + dy);
  } else if (obj.x !== undefined) {
    obj.x = roundGrid(obj.x + dx);
    obj.y = roundGrid(obj.y + dy);
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

// --- join ------------------------------------------------------------------

const JOIN_TOL = 0.05;
const COLLINEAR_TOL = 1e-3;

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
