// What a service route runs into, for the route profile: the walls it passes
// through or beside, the windows and doors within reach of the run, and the
// underside of any roof above it, each at its real height and its real distance
// along the route.
//
// A wall is reported two ways, because the two mean different things to whoever
// is routing. `through` is the stretch where the route is inside the wall, so it
// is a penetration and the band is drawn solid. `beside` is the stretch the
// route merely runs alongside. `head` is the part of `beside` with no roof over
// it, which is where the top of the wall is the only ceiling there is.
//
// Pure functions over (doc, pack, profile); nothing here is stored. The geometry
// is read from compile()'s sketch forms, so it is the same walls, openings and
// roofs the plan and the 3D view show.
//
// "Unknown is null": an opening whose SKU does not state its height (or, for a
// window, its sill) is returned with `known: false` and no invented Z range. The
// profile draws it hatched and says so. compile() has its own drawing defaults;
// they are deliberately not used here, because a clash check built on a guessed
// sill would mislead.
//
// This file imports compile.js, so services.js must never import it back.

import { compile } from "./compile.js";
import { skuById } from "./openings.js";

/** Plan distance, metres, from the route within which an opening is reported. */
export const OBSTRUCTION_NEAR = 1;
/** An opening crossed by the route is still drawn at least this wide along it. */
export const MIN_DRAW_WIDTH = 0.2;
/** Spacing, metres, of the roof underside samples along the route. */
export const ROOF_STEP = 0.1;

const EPS = 1e-9;

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// --- plan geometry ----------------------------------------------------------

/** Route as straight plan segments with their chainage range; risers (zero plan length) are dropped. */
function routeSegments(doc, profile) {
  const nodes = new Map((doc.serviceNodes || []).map((n) => [n.id, n]));
  const segs = [];
  const pts = profile?.points || [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = nodes.get(pts[i].nodeId);
    const b = nodes.get(pts[i + 1].nodeId);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < EPS) continue;
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, s0: pts[i].s, s1: pts[i].s + len, len });
  }
  return segs;
}

/** Closest point on a route segment to (px, py): its chainage and distance. */
function closestOnSegment(seg, px, py) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const t = Math.min(1, Math.max(0, ((px - seg.x1) * dx + (py - seg.y1) * dy) / (dx * dx + dy * dy)));
  const cx = seg.x1 + dx * t;
  const cy = seg.y1 + dy * t;
  return { s: seg.s0 + t * seg.len, d: Math.hypot(px - cx, py - cy) };
}

/** Interval of u where `lo <= v0 + v1 * u <= hi`, or null when never. */
function linearRange(v0, v1, lo, hi) {
  if (Math.abs(v1) < EPS) return v0 >= lo - EPS && v0 <= hi + EPS ? [-Infinity, Infinity] : null;
  const a = (lo - v0) / v1;
  const b = (hi - v0) / v1;
  return a <= b ? [a, b] : [b, a];
}

function intersectRange(p, q) {
  if (!p || !q) return null;
  const lo = Math.max(p[0], q[0]);
  const hi = Math.min(p[1], q[1]);
  return hi - lo > EPS ? [lo, hi] : null;
}

/** Chainage ranges merged into the fewest non-overlapping ones, in order. */
function mergeRanges(ranges) {
  const out = [];
  for (const r of ranges.slice().sort((p, q) => p.s0 - q.s0)) {
    const last = out[out.length - 1];
    if (last && r.s0 <= last.s1 + EPS) last.s1 = Math.max(last.s1, r.s1);
    else out.push({ s0: r.s0, s1: r.s1 });
  }
  return out;
}

/** `ranges` with every part of `cuts` taken out of them. */
function subtractRanges(ranges, cuts) {
  let out = ranges.map((r) => ({ ...r }));
  for (const cut of mergeRanges(cuts)) {
    const next = [];
    for (const r of out) {
      if (cut.s1 <= r.s0 + EPS || cut.s0 >= r.s1 - EPS) { next.push(r); continue; }
      if (cut.s0 - r.s0 > EPS) next.push({ ...r, s0: r.s0, s1: cut.s0 });
      if (r.s1 - cut.s1 > EPS) next.push({ ...r, s0: cut.s1, s1: r.s1 });
    }
    out = next;
  }
  return out;
}

/** Where two segments cross, as the parameter on the first, or null. */
function crossing(seg, ax, ay, bx, by) {
  const rx = seg.x2 - seg.x1;
  const ry = seg.y2 - seg.y1;
  const sx = bx - ax;
  const sy = by - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const t = ((ax - seg.x1) * sy - (ay - seg.y1) * sx) / den;
  const u = ((ax - seg.x1) * ry - (ay - seg.y1) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Closest the whole route comes to a plan segment, with the chainage range it spans. */
function reachOfOpening(segs, a, b) {
  let best = null;
  const consider = (s, d) => {
    if (!best || d < best.d) best = { d, s };
  };
  let sLo = Infinity;
  let sHi = -Infinity;
  for (const seg of segs) {
    const t = crossing(seg, a.x, a.y, b.x, b.y);
    if (t !== null) {
      const s = seg.s0 + t * seg.len;
      consider(s, 0);
      sLo = Math.min(sLo, s);
      sHi = Math.max(sHi, s);
    }
    for (const p of [a, b]) {
      const c = closestOnSegment(seg, p.x, p.y);
      consider(c.s, c.d);
    }
  }
  if (!best) return null;
  // The stretch of route the opening faces: where its two jambs land on the run.
  for (const p of [a, b]) {
    let nearest = null;
    for (const seg of segs) {
      const c = closestOnSegment(seg, p.x, p.y);
      if (!nearest || c.d < nearest.d) nearest = c;
    }
    if (nearest) {
      sLo = Math.min(sLo, nearest.s);
      sHi = Math.max(sHi, nearest.s);
    }
  }
  if (sHi - sLo < MIN_DRAW_WIDTH) {
    const mid = (sLo + sHi) / 2;
    sLo = mid - MIN_DRAW_WIDTH / 2;
    sHi = mid + MIN_DRAW_WIDTH / 2;
  }
  return { distance: best.d, s0: sLo, s1: sHi };
}

// --- openings ---------------------------------------------------------------

function openingEnds(form) {
  const curve = form.profileLoops?.[0]?.curves?.[0];
  if (!curve?.start || !curve?.end) return null;
  return { a: { x: curve.start[0], y: curve.start[1] }, b: { x: curve.end[0], y: curve.end[1] } };
}

function openingObstruction(doc, pack, form, segs, near) {
  const ends = openingEnds(form);
  if (!ends) return null;
  const reach = reachOfOpening(segs, ends.a, ends.b);
  if (!reach || reach.distance > near) return null;

  const isWindow = String(form.kind).toLowerCase() === "window";
  const opening = (doc.openings || []).find((o) => o.id === form.elementId);
  const g = skuById(pack, opening?.sku)?.geometry || {};
  const base = isNum(form.elevation) ? form.elevation : null;
  const known = base !== null && isNum(g.height) && (isWindow ? isNum(g.sill) : true);
  const sill = isWindow ? g.sill : 0;
  return {
    kind: isWindow ? "window" : "door",
    id: form.elementId,
    name: form.name || (isWindow ? "Window" : "Door"),
    hostWallId: form.hostWallId ?? null,
    status: form.status || "planned",
    distance: reach.distance,
    s0: reach.s0,
    s1: reach.s1,
    known,
    // No range when unknown; the drawing hatches the whole storey instead.
    z0: known ? base + sill : null,
    z1: known ? base + sill + g.height : null,
    base,
  };
}

// --- walls ------------------------------------------------------------------

/**
 * Chainage ranges where the route lies within the wall's plan rectangle grown
 * sideways and endwise by `grow`. At `grow` 0 that is the penetration itself,
 * so a run crossing a 220 mm wall at an angle gets the true, wider cut.
 */
function wallRanges(segs, a, b, half, grow) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < EPS) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const side = half + grow;
  const out = [];
  for (const seg of segs) {
    const ox = seg.x1 - a.x;
    const oy = seg.y1 - a.y;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    let r = intersectRange([0, 1], linearRange(ox * ux + oy * uy, dx * ux + dy * uy, -grow, len + grow));
    r = intersectRange(r, linearRange(oy * ux - ox * uy, dy * ux - dx * uy, -side, side));
    if (!r) continue;
    out.push({ s0: seg.s0 + r[0] * seg.len, s1: seg.s0 + r[1] * seg.len });
  }
  return mergeRanges(out);
}

function wallObstruction(form, segs, openings, near) {
  const ends = openingEnds(form);
  if (!ends) return null;
  const half = Math.max(0.01, (Number(form.thickness) || 0) / 2);
  const beside = wallRanges(segs, ends.a, ends.b, half, near);
  if (!beside.length) return null;

  const base = isNum(form.elevation) ? form.elevation : null;
  const height = Number(form.depth);
  const known = base !== null && isNum(height) && height > 0;
  return {
    kind: "wall",
    id: form.elementId,
    name: form.name || "Wall",
    status: form.status || "planned",
    thickness: half * 2,
    known,
    z0: base,
    z1: known ? base + height : null,
    through: wallRanges(segs, ends.a, ends.b, half, 0),
    beside,
    // An opening the route goes through is a gap in the wall, not part of what
    // blocks it. Only a crossing counts (distance 0): a window 2 m along the
    // same wall lands at a similar chainage, and must not open the cut here.
    holes: openings
      .filter((o) => o.hostWallId === form.elementId && o.known && o.distance <= EPS)
      .map((o) => ({ s0: o.s0, s1: o.s1, z0: o.z0, z1: o.z1 })),
    head: [],
  };
}

// --- roofs ------------------------------------------------------------------

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function loopPolygon(form) {
  const loop = form.profileLoops?.[0];
  return (loop?.curves || []).filter((c) => c.start).map((c) => [c.start[0], c.start[1]]);
}

/**
 * Z of the roof's underside at a plan point, or null when the point is outside
 * it. The pitched forms mirror massing.js (a pitched roof is its bounding rect,
 * eaves at the form's elevation, thickness dropped below the surface), so the
 * profile agrees with the 3D view.
 */
export function roofUndersideAt(form, x, y) {
  const poly = loopPolygon(form);
  if (poly.length < 3) return null;
  const eave = form.elevation;
  if (!isNum(eave)) return null;
  const thick = Math.max(0.08, Number(form.depth) || 0.125);
  const shape = String(form.roofForm || "flat").toLowerCase();

  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const w = x1 - x0;
  const h = y1 - y0;

  if (shape === "flat" || w < 0.2 || h < 0.2) {
    return pointInPolygon(x, y, poly) ? eave : null;
  }
  if (x < x0 || x > x1 || y < y0 || y > y1) return null;

  const pitch = Number(form.roofPitch);
  const tan = Math.tan(((Number.isFinite(pitch) ? Math.min(60, Math.max(5, pitch)) : 30) * Math.PI) / 180);
  const wide = w >= h;
  const alongX = (form.roofRidge === "short" ? "short" : "long") === "long" ? wide : !wide;

  let surface;
  if (shape === "shed") {
    surface = alongX ? eave + (y1 - y) * tan : eave + (x1 - x) * tan;
  } else if (shape === "gable") {
    surface = alongX
      ? eave + (h / 2 - Math.abs(y - (y0 + h / 2))) * tan
      : eave + (w / 2 - Math.abs(x - (x0 + w / 2))) * tan;
  } else {
    surface = eave + Math.min(x - x0, x1 - x, y - y0, y1 - y) * tan;
  }
  return surface - thick;
}

/** Samples along the route (including every bend) as `{ s, x, y }`. */
function routeSamples(segs, step) {
  const out = [];
  for (const seg of segs) {
    const n = Math.max(1, Math.ceil(seg.len / step));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      out.push({ s: seg.s0 + t * seg.len, x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t });
    }
  }
  return out;
}

function roofObstruction(form, samples) {
  const runs = [];
  let run = null;
  for (const p of samples) {
    const z = roofUndersideAt(form, p.x, p.y);
    if (z === null) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push({ s: p.s, z });
  }
  const kept = runs.filter((r) => r.length > 1);
  if (!kept.length) return null;
  return {
    kind: "roof",
    id: form.elementId,
    name: form.name || "Roof",
    status: form.status || "planned",
    distance: 0,
    runs: kept,
  };
}

// --- entry point ------------------------------------------------------------

/**
 * Everything the route profile should show besides the route itself.
 * `payload` is an already-compiled document, to save a second compile when the
 * caller has one. Returns `{ openings, walls, roofs, unknownCount }`; openings
 * are sorted nearest first so the drawing can paint the distant ones underneath.
 */
export function profileObstructions(doc, pack, profile, { near = OBSTRUCTION_NEAR, payload = null } = {}) {
  const empty = { openings: [], walls: [], roofs: [], unknownCount: 0 };
  const segs = routeSegments(doc, profile);
  if (!segs.length || !pack) return empty;
  const compiled = payload || compile(doc, pack);
  const forms = compiled?.sketchForms || [];

  const openings = [];
  for (const form of forms) {
    const kind = String(form.kind || "").toLowerCase();
    if (kind !== "window" && kind !== "opening") continue;
    const hit = openingObstruction(doc, pack, form, segs, near);
    if (hit) openings.push(hit);
  }
  openings.sort((p, q) => q.distance - p.distance);

  const samples = routeSamples(segs, ROOF_STEP);
  const roofs = [];
  for (const form of forms) {
    if (String(form.kind || "").toLowerCase() !== "roof") continue;
    const hit = roofObstruction(form, samples);
    if (hit) roofs.push(hit);
  }

  const walls = [];
  for (const form of forms) {
    if (String(form.kind || "").toLowerCase() !== "wall") continue;
    const hit = wallObstruction(form, segs, openings, near);
    if (hit) walls.push(hit);
  }
  // Where a roof covers the route it is the ceiling, so the top of the wall is
  // only worth stating on the stretches with nothing over them.
  const roofed = roofs.flatMap((r) => r.runs.map((run) => ({ s0: run[0].s, s1: run[run.length - 1].s })));
  for (const wall of walls) {
    wall.head = wall.known ? subtractRanges(wall.beside, roofed) : [];
  }

  return { openings, walls, roofs, unknownCount: openings.filter((o) => !o.known).length };
}
