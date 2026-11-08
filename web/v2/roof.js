// Plan-view construction lines for a pitched roof, and the form/ridge
// helpers the 3D massing already needs so the ridge you see on the canvas
// is the same ridge extruded in Output > 3D.
//
// The footprint is an axis-aligned rect: that is everything the week-1 UI
// can draw, and what massing.js already reduces a free polygon to before
// folding it. Flat roofs have no guides.
//
// A cut is a second polygon on that roof. It does not rewrite the outline.
// `hole` is an opening (the roof around it stays). `remove` is a part of
// the roof to take off. Scheduled area is what remains after both.

import { area as polyArea, clipPolygon, normalizeWinding, offsetPolygonOutward, simplify, unionRectsOuter } from "./geom.js";

export const ROOF_FORMS = ["flat", "gable", "shed", "hip"];
export const DEFAULT_ROOF_PITCH = 30;
/** Millimetres, when the pack does not name one. Ignored on a roof with no base. */
export const DEFAULT_ROOF_OVERHANG_MM = 600;
/** A cut smaller than this is a mis-click, not an opening. Square metres. */
export const ROOF_CUT_MIN_AREA = 0.05;

export function normalizeRoofForm(form) {
  const value = String(form || "flat").toLowerCase();
  return ROOF_FORMS.includes(value) ? value : "flat";
}

export function normalizeRoofRidge(ridge) {
  return ridge === "short" ? "short" : "long";
}

/** True when the ridge (or shed high-edge) runs parallel to the X axis. */
export function roofRidgeAlongX(rect, ridge) {
  const alongLong = normalizeRoofRidge(ridge) !== "short";
  const wide = (rect?.w || 0) >= (rect?.h || 0);
  return alongLong === wide;
}

/** The ridge stays this far, as a share of the span between the walls, from either wall. */
export const MIN_RIDGE_SHARE = 0.05;

function pitchTan(deg) {
  const n = Number(deg);
  const clamped = Number.isFinite(n) ? Math.min(60, Math.max(5, n)) : DEFAULT_ROOF_PITCH;
  return Math.tan((clamped * Math.PI) / 180);
}

/** Millimetres, or null when the roof has no ridge offset (the ridge is in the middle). */
export function roofRidgeOffsetMm(roof) {
  const n = Number(roof?.ridgeOffset);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Degrees, or null when the second slope is not set (both slopes use the pitch). */
export function roofPitch2Deg(roof) {
  const n = Number(roof?.pitch2);
  return Number.isFinite(n) && n > 0 ? Math.min(60, Math.max(5, n)) : null;
}

/**
 * The one description of a gable's profile, across its span. Plan guide
 * lines, the 3D shell, and the wall tops all read this, so they cannot
 * disagree about where the ridge is.
 *
 * `span` is the width of the roof edge across the ridge, in metres. The walls
 * (the bearing lines) sit `overhangM` inside each edge. The ridge is measured
 * from the low bearing line: `ridgeOffsetMm`, or half the span between the
 * walls when it is not set. It is held between 5% and 95% of that span.
 *
 * The pitch is the pitch of the longer side, whose wall sits at the plate and
 * whose run sets the ridge height. The shorter side takes `pitch2Deg`, or the
 * same pitch when that is not set. So an off-centre ridge with one pitch lifts
 * the shorter side: its wall rises to meet the roof, with no other input.
 *
 * Heights are metres above the plate. `z(t)` is the roof surface at distance
 * `t` from the low edge (which is `overhangM` outside the low wall).
 */
export function gableProfile({ span, overhangM = 0, pitchDeg, pitch2Deg, ridgeOffsetMm } = {}) {
  const total = Math.max(0.01, Number(span) || 0);
  const ov = Math.min(Math.max(0, Number(overhangM) || 0), Math.max(0, total / 2 - 0.05));
  const wallSpan = total - 2 * ov;
  const offset = Number(ridgeOffsetMm);
  const wanted = Number.isFinite(offset) && offset > 0 ? offset / 1000 : wallSpan / 2;
  const lowRun = Math.min(wallSpan * (1 - MIN_RIDGE_SHARE), Math.max(wallSpan * MIN_RIDGE_SHARE, wanted));
  const highRun = wallSpan - lowRun;
  const tanMain = pitchTan(pitchDeg);
  const tanOther = Number.isFinite(Number(pitch2Deg)) && Number(pitch2Deg) > 0 ? pitchTan(pitch2Deg) : tanMain;
  const lowIsMain = lowRun >= highRun;
  const rise = (lowIsMain ? lowRun : highRun) * tanMain;
  const slopeLow = lowIsMain ? tanMain : tanOther;
  const slopeHigh = lowIsMain ? tanOther : tanMain;
  const ridgeT = ov + lowRun;
  const z = (t) => (t <= ridgeT ? rise - (ridgeT - t) * slopeLow : rise - (t - ridgeT) * slopeHigh);
  return {
    span: total,
    overhang: ov,
    wallSpan,
    lowRun,
    highRun,
    ridgeT,
    rise,
    slopeLow,
    slopeHigh,
    z,
    /** Where the wall on each side meets the roof, above the plate. */
    lowWallRise: z(ov),
    highWallRise: z(total - ov),
    lowDeg: (Math.atan(slopeLow) * 180) / Math.PI,
    highDeg: (Math.atan(slopeHigh) * 180) / Math.PI,
  };
}

/**
 * The gable profile for a compiled roof form, with the plate it hangs from.
 * The form carries the plate and eave. A form with no `roofOverhang` (a
 * roof with no anchors) gets the overhang the plate and eave imply, which is 0
 * when they are the same.
 */
export function gableForForm(form, span) {
  const eave = Number(form?.elevation) || 0;
  const plate = Number.isFinite(Number(form?.plate)) ? Number(form.plate) : eave;
  const given = Number(form?.roofOverhang);
  const overhangM = Number.isFinite(given) && given >= 0
    ? given
    : Math.max(0, (plate - eave) / pitchTan(form?.roofPitch));
  return {
    plate,
    profile: gableProfile({
      span,
      overhangM,
      pitchDeg: form?.roofPitch,
      pitch2Deg: form?.roofPitch2,
      ridgeOffsetMm: form?.roofRidgeOffset,
    }),
  };
}

/**
 * Construction lines for a roof sitting on `rect`.
 *
 * Each line is `{ x1, y1, x2, y2, kind }` with kind one of:
 *  - `ridge`  — gable/hip spine
 *  - `hip`    — hip from a corner to a ridge end
 *  - `high`   — shed high edge (solid in the UI)
 *  - `fall`   — shed slope, high edge to eave
 *
 * Flat roofs, missing rects, and degenerate (zero-length) segments are
 * omitted so the canvas can stroke the array as-is.
 */
export function roofGuideLines(rect, form, ridge, opts = {}) {
  if (!rect || !(rect.w > 0.05) || !(rect.h > 0.05)) return [];
  const kind = normalizeRoofForm(form);
  if (kind === "flat") return [];

  const { x, y, w, h } = rect;
  const alongX = roofRidgeAlongX(rect, ridge);
  const line = (x1, y1, x2, y2, lineKind) => ({ x1, y1, x2, y2, kind: lineKind });

  let lines;
  if (kind === "shed") {
    lines = alongX
      ? [
        line(x, y, x + w, y, "high"),
        line(x + w / 2, y, x + w / 2, y + h, "fall"),
      ]
      : [
        line(x, y, x, y + h, "high"),
        line(x, y + h / 2, x + w, y + h / 2, "fall"),
      ];
  } else if (kind === "hip") {
    const inset = Math.min(w / 2, h / 2);
    if (alongX) {
      const mid = y + h / 2;
      lines = [
        line(x + inset, mid, x + w - inset, mid, "ridge"),
        line(x, y, x + inset, mid, "hip"),
        line(x + w, y, x + w - inset, mid, "hip"),
        line(x, y + h, x + inset, mid, "hip"),
        line(x + w, y + h, x + w - inset, mid, "hip"),
      ];
    } else {
      const mid = x + w / 2;
      lines = [
        line(mid, y + inset, mid, y + h - inset, "ridge"),
        line(x, y, mid, y + inset, "hip"),
        line(x + w, y, mid, y + inset, "hip"),
        line(x, y + h, mid, y + h - inset, "hip"),
        line(x + w, y + h, mid, y + h - inset, "hip"),
      ];
    }
  } else {
    // gable. The ridge sits where the profile puts it: the middle unless the
    // roof has a ridge offset. massing.js reads the same profile.
    const prof = gableProfile({
      span: alongX ? h : w,
      overhangM: (opts.overhangMm || 0) / 1000,
      ridgeOffsetMm: opts.ridgeOffsetMm,
    });
    lines = alongX
      ? [line(x, y + prof.ridgeT, x + w, y + prof.ridgeT, "ridge")]
      : [line(x + prof.ridgeT, y, x + prof.ridgeT, y + h, "ridge")];
  }

  return lines.filter((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 1e-6);
}

/** The anchor outline. Absent on a roof drawn before overhangs, and on a sketch. */
export function roofHasBase(roof) {
  return roof?.base?.kind === "poly" && Array.isArray(roof.base.points) && roof.base.points.length >= 3;
}

/** Millimetres. A roof with no base is an edge already, so its overhang is 0. */
export function roofOverhangMm(roof) {
  if (!roofHasBase(roof)) return 0;
  const n = Number(roof.overhang);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Plate height, millimetres above the level. Missing means the plate is on the level. */
export function roofOffsetMm(roof) {
  const n = Number(roof?.offset);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The roof edge: `base` pushed out by `overhangMm`. Zero overhang returns the
 * anchors. A fold returns null — the caller keeps the previous edge.
 */
export function roofEdgeFromBase(base, overhangMm) {
  const poly = Array.isArray(base) ? base : base?.points;
  if (!poly || poly.length < 3) return null;
  const distance = Math.max(0, Number(overhangMm) || 0) / 1000;
  if (distance <= 1e-9) {
    const ring = normalizeWinding(simplify(poly));
    return ring.length >= 3 ? ring : null;
  }
  return offsetPolygonOutward(poly, distance);
}

/** Metres the eave sits below the plate. A flat roof sits on the plate. */
export function roofEaveDropM(roof) {
  if (normalizeRoofForm(roof?.form) === "flat") return 0;
  const overhang = roofOverhangMm(roof) / 1000;
  if (overhang <= 0) return 0;
  const pitch = Number.isFinite(Number(roof?.pitch)) ? Number(roof.pitch) : DEFAULT_ROOF_PITCH;
  const deg = Math.min(60, Math.max(5, pitch));
  return overhang * Math.tan((deg * Math.PI) / 180);
}

/**
 * Store `overhangMm` and rebuild the edge from the anchors. A roof with no
 * base takes its current outline as the anchors, then pushes that out.
 * Returns false when the offset folds; the roof is left as it was.
 */
function outlineOf(shape) {
  if (!shape) return null;
  if (shape.kind === "poly" && shape.points?.length >= 3) return shape.points;
  if (shape.kind === "rect" && shape.w > 0 && shape.h > 0) {
    return [
      [shape.x, shape.y],
      [shape.x + shape.w, shape.y],
      [shape.x + shape.w, shape.y + shape.h],
      [shape.x, shape.y + shape.h],
    ];
  }
  if (shape.kind === "rects") {
    const ring = unionRectsOuter(shape.rects || []);
    return ring.length >= 3 ? ring : null;
  }
  return null;
}

export function applyRoofOverhang(roof, overhangMm) {
  if (!roof) return false;
  const mm = Math.max(0, Number(overhangMm) || 0);
  const anchors = roofHasBase(roof) ? roof.base.points : null;
  if (!anchors) {
    if (mm <= 0) return true;
    const fromShape = outlineOf(roof.shape);
    if (!fromShape) return false;
    const edge = roofEdgeFromBase(fromShape, mm);
    if (!edge) return false;
    roof.base = { kind: "poly", points: fromShape.map(([x, y]) => [x, y]) };
    roof.overhang = mm;
    roof.shape = { kind: "poly", points: edge };
    return true;
  }
  const edge = roofEdgeFromBase(anchors, mm);
  if (!edge) return false;
  roof.overhang = mm;
  roof.shape = { kind: "poly", points: edge };
  return true;
}

/** Move the anchors and rebuild the edge. Returns false when the offset folds. */
export function commitRoofAnchors(roof, points) {
  if (!roof || !points || points.length < 3) return false;
  const edge = roofEdgeFromBase(points, roofOverhangMm(roof));
  if (!edge) return false;
  roof.base = { kind: "poly", points: points.map(([x, y]) => [x, y]) };
  roof.shape = { kind: "poly", points: edge };
  return true;
}

/** A cut is a hole unless it is explicitly a part to remove. */
export function normalizeRoofCutKind(kind) {
  return kind === "remove" ? "remove" : "hole";
}

function pieceArea(pieces) {
  return (pieces || []).reduce((sum, poly) => sum + Math.abs(polyArea(poly)), 0);
}

function intersectLists(a, b) {
  const out = [];
  for (const pa of a || []) {
    for (const pb of b || []) out.push(...clipPolygon(pa, pb));
  }
  return out;
}

/** Area of the union. Each list is one cut, already clipped so its pieces do not overlap. */
function unionArea(lists) {
  const n = lists.length;
  if (!n) return 0;
  if (n === 1) return pieceArea(lists[0]);
  if (n > 8) {
    let sum = lists.reduce((total, list) => total + pieceArea(list), 0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) sum -= pieceArea(intersectLists(lists[i], lists[j]));
    }
    return Math.max(0, sum);
  }
  let total = 0;
  for (let mask = 1; mask < (1 << n); mask += 1) {
    let acc = null;
    let bits = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      bits += 1;
      acc = acc ? intersectLists(acc, lists[i]) : lists[i];
      if (!acc.length) break;
    }
    if (!acc?.length) continue;
    total += (bits % 2 ? 1 : -1) * pieceArea(acc);
  }
  return Math.max(0, total);
}

/**
 * Plan area of a roof after its cuts. `cuts` is `{ kind, poly }[]`.
 * Overlapping cuts are counted once. Anything outside the outline counts
 * as nothing. `retained` is the area to schedule.
 */
export function roofPlanAreas(hostPoly, cuts) {
  const gross = hostPoly?.length >= 3 ? Math.abs(polyArea(hostPoly)) : 0;
  const lists = [];
  for (const cut of cuts || []) {
    const poly = cut?.poly;
    if (!poly || poly.length < 3 || gross <= 0) continue;
    const pieces = clipPolygon(poly, hostPoly).filter((part) => Math.abs(polyArea(part)) > 1e-8);
    if (pieces.length) lists.push(pieces);
  }
  const cut = Math.min(gross, unionArea(lists));
  return { gross, cut, retained: Math.max(0, gross - cut) };
}
