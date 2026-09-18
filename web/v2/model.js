// Document model for the v2 core.
//
// The important change from v1: a room's shape is an abstraction, not a rect.
// v1 stored `room.rect` and every consumer read `.rect.w * .rect.h`, so
// supporting an L-shaped room meant touching every consumer. Here consumers call
// roomPolygon(room) and the shape kind is free to evolve from "rect" to "rects"
// to "poly" without another rewrite. The week-1 UI only emits "rect" and
// "rects"; the rest of the stack already handles "poly".

import {
  EPS,
  GRID,
  area as polyArea,
  centroid as polyCentroid,
  normalizeWinding,
  perimeter as polyPerimeter,
  rectPoly,
  roundGrid,
  simplify,
  unionRectsOuter,
} from "./geom.js";

export const DOC_SCHEMA = "sp.doc/2";
export const DOC_STORE_KEY = "sp-planner-document-v2";

export const ENTITY_KINDS = [
  "room",
  "segment",
  "slab",
  "roof",
  "opening",
  "item",
  "beam",
  "stair",
];

/**
 * Room use vocabulary. `sansClass` is the regulation's own category, which is
 * what the rule pack keys its thresholds off. Deliberately no areas or heights
 * here: those are regulation values and belong in the rule pack, not the model.
 */
export const ROOM_USES = [
  { id: "bedroom", label: "Bedroom", sansClass: "bedroom" },
  { id: "living", label: "Living room", sansClass: "habitable" },
  { id: "dining", label: "Dining room", sansClass: "habitable" },
  { id: "kitchen", label: "Kitchen", sansClass: "kitchen" },
  { id: "study", label: "Study", sansClass: "habitable" },
  { id: "family", label: "Family room", sansClass: "habitable" },
  { id: "bathroom", label: "Bathroom", sansClass: "bathroom" },
  { id: "shower", label: "Shower room", sansClass: "bathroom" },
  { id: "wc", label: "Toilet", sansClass: "toilet" },
  { id: "laundry", label: "Laundry", sansClass: "laundry" },
  { id: "scullery", label: "Scullery", sansClass: "scullery" },
  { id: "passage", label: "Passage", sansClass: "passage" },
  { id: "entrance", label: "Entrance hall", sansClass: "passage" },
  { id: "garage", label: "Garage", sansClass: "garage" },
  { id: "store", label: "Store", sansClass: "store" },
  { id: "patio", label: "Patio", sansClass: "outdoor" },
  { id: "other", label: "Other", sansClass: "other" },
];

export function roomUse(id) {
  return ROOM_USES.find((u) => u.id === id) || ROOM_USES[ROOM_USES.length - 1];
}

/**
 * The level an object belongs to, falling back to the pack's default. Every
 * shaped and drawn object carries `level` once placed by the current UI, but
 * migrated v1 documents and anything created before levels existed do not, and
 * `null` must resolve to something rather than vanish from every view.
 */
export function effectiveLevel(obj, pack) {
  return obj?.level || pack?.system?.defaultLevel || null;
}

export function emptyDoc() {
  return {
    schema: DOC_SCHEMA,
    // Stable drawing id, generated here rather than by the server, so a
    // document has an identity before it has ever been written anywhere.
    id: nid("doc"),
    // The job name the builder typed. `null`, never "Untitled Project": an
    // unnamed job prints an em-dash on the title block rather than a guess.
    name: null,
    packId: null,
    site: null,
    rooms: [],
    segments: [],
    slabs: [],
    roofs: [],
    openings: [],
    items: [],
    beams: [],
    stairs: [],
    groups: [],
    sheets: [],
    // How many storeys above the ground floor the level switcher currently
    // offers, beyond the pack's own lowest non-foundation level - see
    // ui.js's "+ Add floor" ribbon command. 0 is "waiting, like a new Revit
    // project": just the ground floor and its foundation, never every
    // storey the template happens to define, even on a four-level pack.
    floorsRevealed: 0,
    // Storeys this document added beyond the ones the template names - see
    // level-view.js's insertLevel(). Kept on the document, never merged into
    // the pack, because the pack is regenerated from the template.
    levels: [],
  };
}

export function nid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

// --- shapes ---------------------------------------------------------------

export function rectShape(x, y, w, h) {
  return { kind: "rect", x, y, w, h };
}

export function rectsShape(rects) {
  return { kind: "rects", rects };
}

export function polyShape(points) {
  return { kind: "poly", points };
}

/** Resolve any shape kind to a simplified, CCW-wound polygon. */
export function shapePolygon(shape) {
  if (!shape) return [];
  if (shape.kind === "rect") {
    return rectPoly(shape.x, shape.y, shape.w, shape.h);
  }
  if (shape.kind === "rects") {
    const ring = unionRectsOuter(shape.rects || []);
    return ring.length >= 3 ? ring : [];
  }
  if (shape.kind === "poly") {
    const clean = simplify(shape.points || []);
    return clean.length >= 3 ? normalizeWinding(clean) : [];
  }
  return [];
}

export function roomPolygon(room) {
  return shapePolygon(room?.shape);
}

export function shapeRects(shape) {
  if (!shape) return [];
  if (shape.kind === "rect") return [{ x: shape.x, y: shape.y, w: shape.w, h: shape.h }];
  if (shape.kind === "rects") return shape.rects || [];
  return [];
}

/**
 * Translate a shape by (dx, dy). `grid` is the rounding step; pass a falsy
 * value (e.g. when a caller has already resolved an exact snapped position)
 * to translate without re-rounding.
 */
export function translateShape(shape, dx, dy, grid = GRID) {
  if (!shape) return shape;
  const snap = (n) => (grid ? roundGrid(n, grid) : n);
  if (shape.kind === "rect") {
    return { ...shape, x: snap(shape.x + dx), y: snap(shape.y + dy) };
  }
  if (shape.kind === "rects") {
    return {
      ...shape,
      rects: (shape.rects || []).map((r) => ({
        ...r,
        x: snap(r.x + dx),
        y: snap(r.y + dy),
      })),
    };
  }
  if (shape.kind === "poly") {
    return {
      ...shape,
      points: (shape.points || []).map(([x, y]) => [snap(x + dx), snap(y + dy)]),
    };
  }
  return shape;
}

// --- room measures --------------------------------------------------------

export function roomArea(room) {
  return polyArea(roomPolygon(room));
}

export function roomPerimeter(room) {
  return polyPerimeter(roomPolygon(room));
}

export function roomCentroid(room) {
  return polyCentroid(roomPolygon(room));
}

/**
 * Minimum plan dimension, for the SANS 10400-C "no dimension less than 2 m" test.
 *
 * Where the shape is built from rects (which is everything the week-1 UI can
 * draw) this is the narrowest leg, which is exactly what the regulation means.
 * For a free polygon it falls back to the minimum width of the convex hull,
 * which is an upper bound on concave shapes: the rule pack must treat that case
 * as advisory until the inscribed-width algorithm lands.
 */
export function roomMinDimension(room) {
  const rects = shapeRects(room?.shape);
  if (rects.length) {
    return Math.min(...rects.map((r) => Math.min(r.w, r.h)));
  }
  const poly = roomPolygon(room);
  if (poly.length < 3) return 0;
  return hullMinWidth(poly);
}

export function roomMinDimensionIsExact(room) {
  return shapeRects(room?.shape).length > 0;
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function hullMinWidth(poly) {
  const hull = convexHull(poly);
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    let maxD = 0;
    for (const p of hull) {
      maxD = Math.max(maxD, Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny));
    }
    best = Math.min(best, maxD);
  }
  return best === Infinity ? 0 : best;
}

// --- refs and selection ---------------------------------------------------

const KIND_TO_ARRAY = {
  room: "rooms",
  segment: "segments",
  slab: "slabs",
  roof: "roofs",
  opening: "openings",
  item: "items",
  beam: "beams",
  stair: "stairs",
};

export function collectionFor(doc, kind) {
  const key = KIND_TO_ARRAY[kind];
  if (!key) return null;
  if (!Array.isArray(doc[key])) doc[key] = [];
  return doc[key];
}

export function selKey(ref) {
  return `${ref.kind}:${ref.id}`;
}

export function sameRef(a, b) {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id);
}

export function uniqueRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs || []) {
    if (!ref?.kind || ref.id == null) continue;
    const key = selKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: ref.kind, id: ref.id });
  }
  return out;
}

export function objectByRef(doc, ref) {
  const list = ref ? collectionFor(doc, ref.kind) : null;
  return list?.find((row) => row.id === ref.id) || null;
}

export function allRefs(doc) {
  return ENTITY_KINDS.flatMap((kind) => (collectionFor(doc, kind) || [])
    .map((row) => ({ kind, id: row.id })));
}

// --- base attach ----------------------------------------------------------

/**
 * Kinds that can attach, and be attached to. Drawn linear objects only: a
 * person placed them directly and they have one top surface to sit on. Rooms'
 * derived shared walls are not doc entities at all, and the shaped kinds have
 * no equivalent of the x1/y1/x2/y2 shape the resolution arithmetic assumes.
 */
export const ATTACHABLE_KINDS = new Set(["segment", "beam"]);

/**
 * Resolve `obj.baseAttach` to the object whose top it sits on.
 *
 * `reason` says why there is no live target, and each caller words it for
 * itself rather than sharing one generic message:
 *   "none"    - not attached; the level datum is the answer, exactly as before
 *   "missing" - the target was deleted, or was never an attachable kind
 *   "cycle"   - the chain leads back to `obj`
 *   "chained" - the target is itself attached; one hop only, for now
 */
export function resolveBaseAttach(doc, obj) {
  const ref = obj?.baseAttach;
  if (!ref?.kind || ref.id == null) return { ok: false, reason: "none", ref: null, target: null };
  if (!ATTACHABLE_KINDS.has(ref.kind)) return { ok: false, reason: "missing", ref, target: null };
  const target = objectByRef(doc, ref);
  if (!target) return { ok: false, reason: "missing", ref, target: null };
  if (target.id === obj.id) return { ok: false, reason: "cycle", ref, target };
  if (target.baseAttach) {
    return { ok: false, reason: attachChainReaches(doc, target, obj) ? "cycle" : "chained", ref, target };
  }
  return { ok: true, reason: null, ref, target };
}

/**
 * Does the attach chain starting at `from` arrive at `obj`? Walks with a seen
 * set, so a chain that loops among other objects terminates as well - the
 * one-hop cap is a rule about what may be written, not something the resolver
 * is allowed to assume it will find.
 *
 * Matched on `id`, not object identity: compile.js resolves attach against
 * *derived* wall rows, which carry the drawn segment's id but are not the same
 * object as the segment in the document.
 */
export function attachChainReaches(doc, from, obj) {
  const seen = new Set();
  let cur = from;
  while (cur) {
    if (cur.id === obj?.id) return true;
    const ref = cur.baseAttach;
    if (!ref?.kind || ref.id == null) return false;
    const key = selKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    cur = objectByRef(doc, ref);
  }
  return false;
}

// --- store ----------------------------------------------------------------

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Holds the document plus editing state. v1 kept all of this in module globals,
 * which made it impossible to test compile without a DOM. Here it is a plain
 * object so tests construct one directly.
 */
export class PlanStore {
  /**
   * `sink` is where the document is written and read - a `DocSync` in the app,
   * anything with `save(doc)` and `load()` in a test. It replaced a raw
   * `storage` because a save can fail and the failure has to be reported, which
   * is sync.js's job, not this class's.
   */
  constructor(doc = emptyDoc(), { sink = null, undoLimit = 60 } = {}) {
    this.doc = doc;
    this.sink = sink;
    this.undoLimit = undoLimit;
    this.undoStack = [];
    this.selected = [];
    this.primary = null;
  }

  pushUndo() {
    this.undoStack.push(clone(this.doc));
    if (this.undoStack.length > this.undoLimit) this.undoStack.shift();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.doc = prev;
    this.clearSelection();
    this.persist();
    return true;
  }

  persist() {
    this.sink?.save(this.doc);
  }

  load() {
    if (!this.sink) return false;
    try {
      const raw = this.sink.load();
      if (!raw) return false;
      this.doc = normalizeDoc(raw);
      this.pruneGroups();
      return true;
    } catch {
      this.doc = emptyDoc();
      return false;
    }
  }

  // selection ------------------------------------------------------------
  exists(ref) {
    return Boolean(objectByRef(this.doc, ref));
  }

  isSelected(kind, id) {
    return this.selected.some((row) => row.kind === kind && row.id === id);
  }

  setSelection(refs, primary = null) {
    this.selected = uniqueRefs(refs).filter((ref) => this.exists(ref));
    if (primary && this.selected.some((row) => sameRef(row, primary))) {
      this.primary = { kind: primary.kind, id: primary.id };
    } else {
      this.primary = this.selected[0] || null;
    }
  }

  clearSelection() {
    this.selected = [];
    this.primary = null;
  }

  selectOne(ref, expandGroup = true) {
    if (!ref) {
      this.clearSelection();
      return;
    }
    this.setSelection(expandGroup ? this.expandWithGroups([ref]) : [ref], ref);
  }

  toggleRefs(refs, primary) {
    const batch = uniqueRefs(refs).filter((ref) => this.exists(ref));
    if (!batch.length) return;
    const allOn = batch.every((row) => this.isSelected(row.kind, row.id));
    if (allOn) {
      const drop = new Set(batch.map(selKey));
      const next = this.selected.filter((row) => !drop.has(selKey(row)));
      const keep = primary && next.some((row) => sameRef(row, primary)) ? primary : null;
      this.setSelection(next, keep);
      return;
    }
    this.setSelection([...this.selected, ...batch], primary || batch[0]);
  }

  selectAll() {
    this.setSelection(allRefs(this.doc));
  }

  // groups ---------------------------------------------------------------
  groups() {
    if (!Array.isArray(this.doc.groups)) this.doc.groups = [];
    return this.doc.groups;
  }

  groupForRef(ref) {
    return this.groups().find((g) => (g.members || []).some((m) => sameRef(m, ref))) || null;
  }

  expandWithGroups(refs) {
    const out = [];
    for (const ref of refs || []) {
      const group = this.groupForRef(ref);
      if (group) out.push(...(group.members || []));
      else out.push(ref);
    }
    return uniqueRefs(out).filter((ref) => this.exists(ref));
  }

  pruneGroups() {
    this.doc.groups = this.groups()
      .map((g) => ({ ...g, members: uniqueRefs(g.members || []).filter((ref) => this.exists(ref)) }))
      .filter((g) => g.members.length >= 2);
  }

  ungroupRefs(refs) {
    const drop = new Set(uniqueRefs(refs).map(selKey));
    this.doc.groups = this.groups()
      .map((g) => ({ ...g, members: (g.members || []).filter((m) => !drop.has(selKey(m))) }))
      .filter((g) => g.members.length >= 2);
  }

  groupSelection() {
    const members = uniqueRefs(this.selected).filter((ref) => this.exists(ref));
    if (members.length < 2) return false;
    this.pushUndo();
    this.ungroupRefs(members);
    this.groups().push({
      id: nid("g"),
      name: `Group ${this.groups().length + 1}`,
      members,
    });
    this.setSelection(members, this.primary);
    this.persist();
    return true;
  }

  ungroupSelection() {
    const refs = this.selected.length ? this.selected : (this.primary ? [this.primary] : []);
    if (!refs.some((ref) => this.groupForRef(ref))) return false;
    this.pushUndo();
    this.ungroupRefs(refs);
    this.persist();
    return true;
  }

  // moving ---------------------------------------------------------------
  snapshotMoveTargets(refs) {
    const snaps = [];
    for (const ref of uniqueRefs(refs)) {
      const obj = objectByRef(this.doc, ref);
      if (!obj) continue;
      if (obj.shape) snaps.push({ ref, shape: clone(obj.shape) });
      else if (obj.x1 !== undefined) {
        snaps.push({ ref, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 });
      } else if (obj.x !== undefined) {
        snaps.push({ ref, x: obj.x, y: obj.y });
      }
    }
    return snaps;
  }

  /**
   * `grid` is the rounding step applied to the new positions. Pass a falsy
   * value to skip rounding entirely - used when the caller (the UI's
   * endpoint-snap logic) has already resolved dx/dy to land exactly on
   * another object's point, where rounding to the grid would undo the snap.
   */
  applyMoveSnapshot(snaps, dx, dy, grid = GRID) {
    const snapVal = (n) => (grid ? roundGrid(n, grid) : n);
    for (const snap of snaps) {
      const obj = objectByRef(this.doc, snap.ref);
      if (!obj) continue;
      if (snap.shape) {
        obj.shape = translateShape(snap.shape, dx, dy, grid);
      } else if (snap.x1 !== undefined) {
        obj.x1 = snapVal(snap.x1 + dx);
        obj.y1 = snapVal(snap.y1 + dy);
        obj.x2 = snapVal(snap.x2 + dx);
        obj.y2 = snapVal(snap.y2 + dy);
      } else {
        obj.x = snapVal(snap.x + dx);
        obj.y = snapVal(snap.y + dy);
      }
    }
  }

  /** Drawn plan geometry only - what the canvas legend and the empty-canvas
   * hint care about. For "is this job worth keeping" use hasJobContent(). */
  hasContent() {
    return Boolean(this.doc.rooms.length || this.doc.segments.length
      || this.doc.slabs.length || this.doc.roofs.length);
  }
}

/** Every array whose contents are work someone did. */
const JOB_CONTENT_ARRAYS = [
  "rooms",
  "segments",
  "slabs",
  "roofs",
  "openings",
  "items",
  "beams",
  "stairs",
  "sheets",
  "levels",
];

/**
 * Whether a document holds work worth listing and worth importing. Broader
 * than hasContent() on purpose: a job that is so far only a site boundary, or
 * only openings cut into a scanned underlay, is a real job, and treating it as
 * empty is how it gets thrown away.
 *
 * `packId` is deliberately not content - it is set for every document the
 * moment a pack loads, so counting it would make every empty document look used.
 */
export function hasJobContent(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (JOB_CONTENT_ARRAYS.some((key) => Array.isArray(doc[key]) && doc[key].length > 0)) return true;
  if (doc.site) return true;
  if (doc.underlay) return true;
  if (Number.isInteger(doc.floorsRevealed) && doc.floorsRevealed > 0) return true;
  return false;
}

// --- normalisation and v1 migration --------------------------------------

/** Accept a v1 or v2 document and return a valid v2 document. */
export function normalizeDoc(raw) {
  const doc = emptyDoc();
  if (!raw || typeof raw !== "object") return doc;

  const isV1 = raw.schema !== DOC_SCHEMA;
  // Both identity keys are optional: every document written before they
  // existed still loads, and keeps the id this call invents for it from then on.
  if (typeof raw.id === "string" && raw.id) doc.id = raw.id;
  doc.name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  doc.packId = raw.packId ?? null;
  doc.site = raw.site ?? null;

  doc.rooms = (raw.rooms || []).map((room) => ({
    id: room.id || nid("r"),
    name: room.name || "Room",
    use: room.use || inferUseFromName(room.name),
    level: room.level || null,
    wallSku: room.wallSku || null,
    floorSku: room.floorSku || null,
    ceilingSku: room.ceilingSku || null,
    status: room.status === "existing" ? "existing" : "planned",
    shape: room.shape
      ? room.shape
      : rectShape(room.rect?.x ?? 0, room.rect?.y ?? 0, room.rect?.w ?? 1, room.rect?.h ?? 1),
  }));

  // v1 called drawn walls "traces".
  doc.segments = (raw.segments || raw.traces || []).map((seg) => ({
    id: seg.id || nid("s"),
    sku: seg.sku,
    level: seg.level ?? null,
    x1: seg.x1,
    y1: seg.y1,
    x2: seg.x2,
    y2: seg.y2,
    status: seg.status === "existing" ? "existing" : "planned",
    ...baseAttachFields(seg),
  }));

  const mapShaped = (rows, prefix) => (rows || []).map((row) => ({
    ...row,
    id: row.id || nid(prefix),
    status: row.status === "existing" ? "existing" : "planned",
    shape: row.shape
      ? row.shape
      : rectShape(row.rect?.x ?? 0, row.rect?.y ?? 0, row.rect?.w ?? 1, row.rect?.h ?? 1),
  }));

  doc.slabs = mapShaped(raw.slabs, "sl");
  doc.roofs = mapShaped(raw.roofs, "rf").map((roof) => ({
    ...roof,
    form: roof.form || "flat",
    pitch: Number.isFinite(roof.pitch) ? roof.pitch : 30,
    ridge: roof.ridge === "short" ? "short" : "long",
  }));

  doc.openings = (raw.openings || []).map((o) => migrateOpening(o));
  doc.items = (raw.items || []).map((i) => ({ ...i, id: i.id || nid("i") }));
  doc.beams = (raw.beams || []).map((b) => ({ ...b, id: b.id || nid("b"), ...baseAttachFields(b) }));
  doc.stairs = (raw.stairs || []).map((s) => ({ ...s, id: s.id || nid("st") }));
  doc.groups = Array.isArray(raw.groups) ? raw.groups : [];
  doc.sheets = Array.isArray(raw.sheets) ? raw.sheets : [];
  doc.floorsRevealed = Number.isInteger(raw.floorsRevealed) && raw.floorsRevealed >= 0 ? raw.floorsRevealed : 0;
  // `num` rather than `Number(x)`: null and "" both coerce to 0, which would
  // silently turn an unstated floor-to-ceiling into a floor-to-ceiling of zero.
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  doc.levels = (Array.isArray(raw.levels) ? raw.levels : [])
    .filter((l) => l && l.id && num(l.elevation) !== null)
    .map((l) => ({
      id: l.id,
      name: l.name || l.id,
      elevation: num(l.elevation),
      floorToFloor: num(l.floorToFloor),
      floorToCeiling: num(l.floorToCeiling),
      userSupplied: true,
    }));

  if (isV1) doc.migratedFrom = raw.schema || "sp.doc/1";
  return doc;
}

/**
 * The three attach-related keys every drawn wall and beam carries, made
 * explicit rather than absent so a document written before attach existed
 * states "not attached" instead of leaving the reader to infer it.
 *
 * `baseOffset` is how far above its level datum an unattached object sits, and
 * `height` is a per-object override of the SKU's height. Both exist for
 * Detach: Revit's Detach leaves a wall exactly where it is and only stops the
 * live link, so detach writes the currently resolved elevation and height into
 * these two rather than snapping the object back to the flat level datum.
 * `height: null` means "use the SKU's height", which is every object that has
 * never been attached.
 */
function baseAttachFields(row) {
  return {
    baseAttach: row?.baseAttach ?? null,
    baseOffset: Number.isFinite(row?.baseOffset) ? row.baseOffset : 0,
    height: Number.isFinite(row?.height) ? row.height : null,
  };
}

/**
 * v1 anchored openings to a compass edge of a rectangle. rectPoly() winds
 * counter-clockwise from the south-west corner, so the south and east edges run
 * in the same direction v1 used but north and west run backwards, and their `t`
 * has to be mirrored to keep an opening in the same physical place.
 */
const COMPASS_EDGES = {
  S: { edgeIndex: 0, flip: false },
  E: { edgeIndex: 1, flip: false },
  N: { edgeIndex: 2, flip: true },
  W: { edgeIndex: 3, flip: true },
};

export function migrateOpening(o) {
  const row = { ...o, id: o.id || nid("o") };
  if (row.edgeIndex === undefined && typeof row.edge === "string") {
    const map = COMPASS_EDGES[row.edge.toUpperCase()];
    if (map) {
      row.edgeIndex = map.edgeIndex;
      const t = Number(row.t);
      row.t = map.flip && Number.isFinite(t) ? 1 - t : t;
    }
    delete row.edge;
  }
  return row;
}

function inferUseFromName(name) {
  const n = String(name || "").toLowerCase();
  const hit = ROOM_USES.find((u) => n.includes(u.id) || n.includes(u.label.toLowerCase()));
  return hit ? hit.id : "other";
}

export { polyArea, EPS };
