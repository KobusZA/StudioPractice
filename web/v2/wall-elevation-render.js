// SVG drawing of a wall elevation model. One function serves the small
// inspector preview and the strip under the plan; `interactive` adds the drag
// handles. Returns markup plus the scales the pointer code needs to turn pixels
// back into metres.
//
// The preview fits the wall to the graph: the face spans the level lines, and
// the height is fitted on its own. The open strip passes `frame`. The face is
// then as long on screen as the wall, and exactly as tall for its height, so
// the ratio follows the plan's scale. The strip holds that face: panning the
// plan leaves it, moving the wall carries it, and Align is what lines the two
// centres up. Level lines still cross the whole strip. The floor sits on the
// bottom; anything above the strip is clipped.
//
// `view.zoom` magnifies either drawing, and `view.panX` / `view.panY` slide it.
// Zoom 1 with no pan is the fit, or the plan match when a frame is set.
// The open strip can zoom further in or further out from that match. The
// preview never passes a view, so it stays fitted.

import { FINISH_CATEGORIES, finishSwatch } from "./finish-data.js";
import { area as polyArea, clipPolygon, offsetPolygonInward, pointInPoly } from "./geom.js";
import { archVoidPolygon } from "./arch-head.js";

const PAD = 14;
const HANDLE = 5;

/** Far enough out to see a long face with the storeys around it. */
export const ELEV_ZOOM_MIN = 1 / 16;
/** Enough to work a window on a long face without the handles leaving the strip. */
export const ELEV_ZOOM_MAX = 16;

function clampZoom(zoom) {
  const n = Number(zoom);
  if (!Number.isFinite(n)) return 1;
  return Math.min(ELEV_ZOOM_MAX, Math.max(ELEV_ZOOM_MIN, n));
}

/**
 * Screen placement of a fitted elevation under a zoom/pan view.
 * `fit.top` is the screen y of the top of the frame (the high level). The
 * floor (`fit.originY`) moves down as the zoom grows; pan is extra pixels.
 * `fit.scaleX` stays positive. `fit.dir` is -1 when station 0 is the right end.
 */
export function elevationPlacement(fit, view) {
  const zoom = clampZoom(view?.zoom);
  const panX = Number(view?.panX) || 0;
  const panY = Number(view?.panY) || 0;
  const scaleX = fit.scaleX * zoom;
  const scaleY = fit.scaleY * zoom;
  const originX = fit.originX + panX;
  const originY = fit.top + (fit.originY - fit.top) * zoom + panY;
  return { zoom, scaleX, scaleY, originX, originY, dir: fit.dir < 0 ? -1 : 1 };
}

/**
 * Next view after a wheel step about a screen point, so that point stays put.
 * Zoom can grow past the strip or shrink below the plan match. Zoom 1 with
 * no pan is the only view that still matches that drawing exactly.
 */
export function zoomElevationView(fit, view, px, py, factor) {
  const prev = clampZoom(view?.zoom);
  const zoom = clampZoom(prev * factor);
  const placed = elevationPlacement(fit, { zoom: prev, panX: view?.panX, panY: view?.panY });
  const dir = placed.dir < 0 ? -1 : 1;
  const s = (px - placed.originX) / (placed.scaleX * dir);
  const above = (placed.originY - py) / placed.scaleY;
  const originX = px - s * fit.scaleX * zoom * dir;
  const originY = py + above * fit.scaleY * zoom;
  return {
    zoom,
    panX: originX - fit.originX,
    panY: originY - fit.top - (fit.originY - fit.top) * zoom,
  };
}

/**
 * Keep some of the framed wall inside the strip. A zoom about the padding
 * beside the wall would otherwise slide the drawing off the graph.
 */
export function clampElevationView(fit, view, width, height) {
  const zoom = clampZoom(view?.zoom);
  const margin = Math.min(48, Math.max(16, Math.min(width, height) / 4));
  const clamp = (origin0, span, pan, viewSize) => {
    let origin = origin0 + pan;
    if (origin + span < margin) origin += margin - (origin + span);
    if (origin > viewSize - margin) origin -= origin - (viewSize - margin);
    return origin - origin0;
  };
  const left0 = fit.dir < 0 ? fit.originX - fit.spanX : fit.originX;
  return {
    zoom,
    panX: clamp(left0, fit.spanX * zoom, Number(view?.panX) || 0, width),
    panY: clamp(fit.top, fit.spanY * zoom, Number(view?.panY) || 0, height),
  };
}

/**
 * Where one wall face sits in the strip so it matches the plan.
 * `wall` is `{ x1, y1, x2, y2, side }`. `cam` is `{ scale, ox, oy }` in canvas
 * pixels (y down). `shiftX` is the canvas's left minus the strip's left, so a
 * horizontal wall shares the plan's screen x.
 * Side -1 reads the wall from its second end. The face is `length * scale`
 * pixels wide, which is the wall's length on screen at any angle. A wall that
 * runs more up-down uses the plan's y as the strip's x, so moving it up moves
 * the face sideways. `dir` is -1 when that axis runs backwards: station 0 stays
 * on the viewing start, which is then the right end.
 */
export function planFaceFrame(wall, cam, shiftX = 0) {
  const scale = Number(cam?.scale);
  if (!wall || !(scale > 0)) return null;
  const x1 = Number(wall.x1);
  const y1 = Number(wall.y1);
  const x2 = Number(wall.x2);
  const y2 = Number(wall.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const flipped = wall.side === -1;
  const ax = flipped ? x2 : x1;
  const ay = flipped ? y2 : y1;
  const bx = flipped ? x1 : x2;
  const by = flipped ? y1 : y2;
  const sx0 = (Number(cam.ox) || 0) + ax * scale;
  const sy0 = (Number(cam.oy) || 0) + ay * scale;
  const sx1 = (Number(cam.ox) || 0) + bx * scale;
  const sy1 = (Number(cam.oy) || 0) + by * scale;
  const useY = Math.abs(sy1 - sy0) > Math.abs(sx1 - sx0);
  const shift = useY ? 0 : (Number(shiftX) || 0);
  const start = (useY ? sy0 : sx0) + shift;
  const end = (useY ? sy1 : sx1) + shift;
  return { scale, originX: start, dir: end - start >= 0 ? 1 : -1, vertical: useY };
}

/**
 * The axis the strip tracks, and the wall's midpoint on it. A wall that runs
 * more up-down is tracked by its y. The midpoint is the same on either face.
 */
export function faceTrack(wall) {
  if (!wall) return null;
  const x1 = Number(wall.x1);
  const y1 = Number(wall.y1);
  const x2 = Number(wall.x2);
  const y2 = Number(wall.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const flipped = wall.side === -1;
  const ax = flipped ? x2 : x1;
  const ay = flipped ? y2 : y1;
  const bx = flipped ? x1 : x2;
  const by = flipped ? y1 : y2;
  const vertical = Math.abs(by - ay) > Math.abs(bx - ax);
  return { axis: vertical ? "y" : "x", mid: vertical ? (ay + by) / 2 : (ax + bx) / 2, vertical };
}

/**
 * Where the face centre sits in the strip. A new face (`hold` null) starts at
 * `centerX`. Panning the plan never comes through here. Moving the wall adds
 * that movement, in pixels, along the axis being tracked. Turning the wall
 * onto the other axis keeps the centre and starts tracking the new midpoint.
 */
export function trackFaceCenter(hold, track, scale, centerX) {
  if (!track || !(scale > 0)) return hold;
  if (!hold || hold.axis !== track.axis) {
    return { axis: track.axis, mid: track.mid, centerX: hold ? hold.centerX : centerX };
  }
  return {
    axis: track.axis,
    mid: track.mid,
    centerX: hold.centerX + (track.mid - hold.mid) * scale,
  };
}

/**
 * Camera shift that puts the wall's centre on `centerX` in the strip.
 * `projected` is where the centre sits now. A horizontal wall moves with `ox`;
 * a wall that runs up the plan moves with `oy`.
 */
export function alignCameraShift(vertical, projected, centerX) {
  const delta = centerX - projected;
  return vertical ? { ox: 0, oy: delta } : { ox: delta, oy: 0 };
}

/**
 * How far to slide the span `[a, b]` so it lies inside `[lo, hi]`.
 * A span longer than the view is centred. A span already inside does not move.
 */
export function nudgeIntoView(a, b, lo, hi) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (!(hi > lo)) return 0;
  if (max - min > hi - lo) return (lo + hi) / 2 - (min + max) / 2;
  if (min < lo) return lo - min;
  if (max > hi) return hi - max;
  return 0;
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function mm(metres) {
  return `${Math.round(metres * 1000)}`;
}

/** The resize arrow for pushing an edge sideways, the same cursors as a wall top.
 *  Screen pixels: "ns", "ew", "nwse", or "nesw" (append "-resize" for a CSS cursor). */
export function edgeResizeCursor(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const px = -dy;
  const py = dx;
  if (Math.abs(py) >= Math.abs(px) * 2) return "ns";
  if (Math.abs(px) >= Math.abs(py) * 2) return "ew";
  return px * py >= 0 ? "nwse" : "nesw";
}

const LOCATE_GAP = 5e-4;

function polygonWinding(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.s * q.z - q.s * p.z;
  }
  return area >= 0 ? 1 : -1;
}

/** Drop a clearance that is flush with the wall. A gap an arrow has pinned stays, even at 0. */
function packLocate(spec) {
  if (!spec) return null;
  const out = {};
  if (spec.side && (spec.side.pinned || spec.side.s1 - spec.side.s0 > LOCATE_GAP)) out.side = spec.side;
  if (spec.vert && (spec.vert.pinned || spec.vert.z1 - spec.vert.z0 > LOCATE_GAP)) out.vert = spec.vert;
  return out.side || out.vert ? out : null;
}

function mergeLocate(a, b) {
  const spec = {};
  if (a?.side || b?.side) spec.side = (a?.side && b?.side)
    ? ((a.side.s1 - a.side.s0) >= (b.side.s1 - b.side.s0) ? a.side : b.side)
    : (a?.side || b?.side);
  if (a?.vert || b?.vert) spec.vert = (a?.vert && b?.vert)
    ? ((a.vert.z1 - a.vert.z0) >= (b.vert.z1 - b.vert.z0) ? a.vert : b.vert)
    : (a?.vert || b?.vert);
  return spec;
}

/** One edge's outward clearance. A vertical edge opens a gap to the side of
 *  the wall; a horizontal edge opens a gap to the top or the floor. A diagonal
 *  edge opens both. */
function edgeSpec(points, index, length, height) {
  const n = points.length;
  if (!n) return {};
  const i = ((index % n) + n) % n;
  const a = points[i];
  const b = points[(i + 1) % n];
  const wind = polygonWinding(points);
  const ds = b.s - a.s;
  const dz = b.z - a.z;
  // Right of the direction of travel is outside a counter-clockwise ring.
  const nx = wind * dz;
  const nz = wind * -ds;
  const ax = Math.abs(nx);
  const az = Math.abs(nz);
  const across = ax >= az * 2;
  const along = az >= ax * 2;
  const either = !across && !along;
  const spec = {};
  // The tick lands on the end that the measurement belongs to, so a sloping
  // edge is not dimensioned from its middle.
  if ((across || either) && ax > 1e-9) {
    const s = nx < 0 ? Math.min(a.s, b.s) : Math.max(a.s, b.s);
    const at = Math.abs(a.s - s) <= Math.abs(b.s - s) ? a : b;
    spec.side = nx < 0 ? { s0: 0, s1: s, z: at.z } : { s0: s, s1: length, z: at.z };
  }
  if ((along || either) && az > 1e-9) {
    const z = nz > 0 ? Math.max(a.z, b.z) : Math.min(a.z, b.z);
    const at = Math.abs(a.z - z) <= Math.abs(b.z - z) ? a : b;
    spec.vert = nz > 0
      ? { z0: z, z1: height, s: at.s, toward: "top" }
      : { z0: 0, z1: z, s: at.s, toward: "base" };
  }
  return spec;
}

/** Where a free point sits: the nearer end of the wall, and the nearer of the
 *  floor and the top. A first corner has no edge yet, so both are shown. */
function pointSpec(s, z, length, height) {
  const spec = {};
  const left = s;
  const right = length - s;
  if (left > LOCATE_GAP && left < length - LOCATE_GAP && left <= right) spec.side = { s0: 0, s1: s, z };
  else if (right > LOCATE_GAP && right < length - LOCATE_GAP) spec.side = { s0: s, s1: length, z };
  const down = z;
  const up = height - z;
  if (up > LOCATE_GAP && (up <= down || down <= LOCATE_GAP)) spec.vert = { z0: z, z1: height, s, toward: "top" };
  else if (down > LOCATE_GAP) spec.vert = { z0: 0, z1: z, s, toward: "base" };
  return spec;
}

/** The point a gap is measured from: the outer end of an edge, else the first vertex. */
function locateAnchor(spec, points, index) {
  if (spec?.side) {
    const s = spec.side.s0 === 0 ? spec.side.s1 : spec.side.s0;
    return { s, z: spec.side.z };
  }
  if (spec?.vert) {
    const z = spec.vert.toward === "base" ? spec.vert.z1 : spec.vert.z0;
    return { s: spec.vert.s, z };
  }
  const n = points?.length || 0;
  const p = n ? points[((index % n) + n) % n] : { s: 0, z: 0 };
  return { s: p.s, z: p.z };
}

/**
 * Force one axis to a wall side. `pin.h` is `left` or `right`, `pin.v` is
 * `up` or `down`. A pinned gap is drawn even when it is 0. Anything left
 * unpinned keeps the side the edge already faces.
 */
function withPin(spec, s, z, length, height, pin) {
  if (!pin || (pin.h == null && pin.v == null)) return spec;
  const out = { ...(spec || {}) };
  const ss = Math.min(length, Math.max(0, s));
  const zz = Math.min(height, Math.max(0, z));
  if (pin.h === "left") out.side = { s0: 0, s1: ss, z: zz, pinned: true };
  else if (pin.h === "right") out.side = { s0: ss, s1: length, z: zz, pinned: true };
  if (pin.v === "up") out.vert = { z0: zz, z1: height, s: ss, toward: "top", pinned: true };
  else if (pin.v === "down") out.vert = { z0: 0, z1: zz, s: ss, toward: "base", pinned: true };
  return out;
}

/**
 * The dimension lines for a finish that is being drawn or dragged.
 * `mode` is `point` (the corner under the cursor), `edge` (a line, one axis),
 * `corner` (both axes, from the corner itself) or `move` (the whole shape).
 * `pin` forces an axis to the left, right, base or top. Lengths are metres.
 * @returns {{side?:{s0:number,s1:number,z:number,pinned?:boolean}, vert?:{z0:number,z1:number,s:number,toward:string,pinned?:boolean}}|null}
 */
export function finishLocate(points, { mode, index = 0, length, height, point = null, pin = null } = {}) {
  if (!(length > 0) || !(height > 0)) return null;
  if (mode === "point") {
    if (!point) return null;
    return packLocate(withPin(pointSpec(point.s, point.z, length, height), point.s, point.z, length, height, pin));
  }
  if (!points?.length) return null;
  if (mode === "move") {
    const left = points.reduce((best, p) => (p.s < best.s ? p : best));
    const right = points.reduce((best, p) => (p.s > best.s ? p : best));
    const top = points.reduce((best, p) => (p.z > best.z ? p : best));
    const bottom = points.reduce((best, p) => (p.z < best.z ? p : best));
    return packLocate({
      side: left.s > LOCATE_GAP ? { s0: 0, s1: left.s, z: left.z } : { s0: right.s, s1: length, z: right.z },
      vert: height - top.z > LOCATE_GAP
        ? { z0: top.z, z1: height, s: top.s, toward: "top" }
        : { z0: 0, z1: bottom.z, s: bottom.s, toward: "base" },
    });
  }
  if (mode === "edge") {
    const raw = edgeSpec(points, index, length, height);
    const anchor = locateAnchor(raw, points, index);
    return packLocate(withPin(raw, anchor.s, anchor.z, length, height, pin));
  }
  if (mode === "corner") {
    const n = points.length;
    const i = ((index % n) + n) % n;
    const p = points[i];
    const merged = mergeLocate(
      edgeSpec(points, (i - 1 + n) % n, length, height),
      edgeSpec(points, i, length, height),
    );
    // Both lines meet this corner. A sloping neighbour must not borrow the
    // other end's height or station. An arrow then replaces either axis.
    const spec = {};
    if (merged?.side) {
      spec.side = merged.side.s0 === 0
        ? { s0: 0, s1: p.s, z: p.z }
        : { s0: p.s, s1: length, z: p.z };
    }
    if (merged?.vert) {
      spec.vert = merged.vert.toward === "base"
        ? { z0: 0, z1: p.z, s: p.s, toward: "base" }
        : { z0: p.z, z1: height, s: p.s, toward: "top" };
    }
    return packLocate(withPin(spec, p.s, p.z, length, height, pin));
  }
  return null;
}

/** Caption on a clearance dimension. Clamped so a short gap still keeps its text inside the drawing.
 *  `editing` draws the copper type-in box; `op` is the pointer target (`locate-h` or `locate-v`). */
function locateCaption(parts, x, y, anchor, text, kind, W, H, { editing = false, unit = "", op = "" } = {}) {
  const unitWidth = unit ? unit.length * 6.2 + 6 : 0;
  const width = Math.max(text.length * 6.4 + 8, editing ? 34 : 0);
  const height = 14;
  let left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  let top = y - 11;
  left = Math.max(2, Math.min(left, W - width - unitWidth - 2));
  top = Math.max(2, Math.min(top, H - height - 2));
  const tx = anchor === "start" ? left + 4 : anchor === "end" ? left + width - 4 : left + width / 2;
  const edit = editing ? " is-editing" : "";
  const gap = op ? " elev-gap" : "";
  const attrs = op ? ` data-elev-op="${op}"` : "";
  parts.push(`<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="2" class="elev-measure-bg${edit}${gap}"${attrs}/>`);
  parts.push(`<text x="${tx}" y="${top + 11}" text-anchor="${anchor}" class="elev-dim${edit}${gap}" data-elev-dim="${kind}"${attrs}>${esc(text)}</text>`);
  if (unit) {
    parts.push(`<text x="${left + width + 4}" y="${top + 11}" text-anchor="start" class="elev-dim">${esc(unit)}</text>`);
  }
}

/** The words in a gap caption: the measured millimetres, or the digits being typed plus a caret. */
function gapLabel(metres, axis, typing, typeable) {
  const op = typeable ? (axis === "h" ? "locate-h" : "locate-v") : "";
  const editing = Boolean(typeable && typing && typing.axis === axis);
  if (!editing) return { text: `${mm(metres)} mm`, editing: false, unit: "", op };
  const raw = typing.text || "";
  return { text: raw ? `${raw}\u2502` : "\u2502", editing: true, unit: "mm", op };
}

function locateTick(parts, x, y) {
  parts.push(`<line x1="${x - 3.2}" y1="${y + 3.2}" x2="${x + 3.2}" y2="${y - 3.2}" class="elev-dim-tick"/>`);
}

/** Horizontal clearance, in the gap beside the finish. */
function locateSide(parts, model, side, xOf, yOf, W, H, typing, typeable) {
  const metres = side.s1 - side.s0;
  if (!(side.pinned || metres > LOCATE_GAP)) return;
  const x1 = xOf(side.s0);
  const x2 = xOf(side.s1);
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const y = yOf(model.base + side.z);
  if (right - left >= 2) {
    parts.push(`<line x1="${left}" y1="${y - 6}" x2="${left}" y2="${y + 6}" class="elev-dim-ext"/>`);
    parts.push(`<line x1="${right}" y1="${y - 6}" x2="${right}" y2="${y + 6}" class="elev-dim-ext"/>`);
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="elev-dim-line"/>`);
    locateTick(parts, left, y);
    locateTick(parts, right, y);
  }
  const label = gapLabel(metres, "h", typing, typeable);
  locateCaption(parts, (left + right) / 2, y - 2, "middle", label.text, "side", W, H, label);
}

/** Vertical clearance, up to the top of the wall or down to the floor. */
function locateVert(parts, model, vert, xOf, yOf, W, H, typing, typeable) {
  const metres = vert.z1 - vert.z0;
  if (!(vert.pinned || metres > LOCATE_GAP)) return;
  const y1 = yOf(model.base + vert.z0);
  const y2 = yOf(model.base + vert.z1);
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  const x = xOf(vert.s);
  if (bot - top >= 2) {
    parts.push(`<line x1="${x - 6}" y1="${top}" x2="${x + 6}" y2="${top}" class="elev-dim-ext"/>`);
    parts.push(`<line x1="${x - 6}" y1="${bot}" x2="${x + 6}" y2="${bot}" class="elev-dim-ext"/>`);
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bot}" class="elev-dim-line"/>`);
    locateTick(parts, x, top);
    locateTick(parts, x, bot);
  }
  const kind = vert.toward === "base" ? "base" : "top";
  const label = gapLabel(metres, "v", typing, typeable);
  locateCaption(parts, x + 6, (top + bot) / 2 + 4, "start", label.text, kind, W, H, label);
}

function drawFinishLocate(parts, model, locate, xOf, yOf, W, H) {
  if (!locate || !model) return;
  const typing = locate.typing || null;
  const typeable = Boolean(locate.typeable);
  if (locate.side) locateSide(parts, model, locate.side, xOf, yOf, W, H, typing, typeable);
  if (locate.vert) locateVert(parts, model, locate.vert, xOf, yOf, W, H, typing, typeable);
}

/** The wall's dashed alignment, drawn by a floor picture in its own frame. */
export function appendAlignLines(parts, guides, xOf, yOf, width, height) {
  alignLines(parts, { base: 0 }, guides, xOf, yOf, width, height);
}

/** The wall's clearance dimensions, drawn by a floor picture in its own frame. */
export function appendFinishLocate(parts, locate, xOf, yOf, width, height) {
  drawFinishLocate(parts, { base: 0 }, locate, xOf, yOf, width, height);
}

/** The same edge length the plan shows while a polygon is drawn or edited. */
export function appendMeasureLabel(parts, x1, y1, x2, y2, metres) {
  measureLabel(parts, x1, y1, x2, y2, metres);
}

function measureLabel(parts, x1, y1, x2, y2, metres) {
  if (!(metres > 0.02)) return;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const label = `${Math.round(metres * 1000)} mm`;
  const width = label.length * 6.6;
  parts.push(`<rect x="${mx - width / 2}" y="${my - 16}" width="${width}" height="14" rx="2" class="elev-measure-bg"/>`);
  parts.push(`<text x="${mx}" y="${my - 5}" text-anchor="middle" class="elev-measure">${label}</text>`);
}

/** Dashed lines through a point that lines up with another corner or an edge. */
function alignLines(parts, model, guides, xOf, yOf, W, H) {
  if (!guides) return;
  if (guides.s != null) {
    const x = xOf(guides.s);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="elev-align"/>`);
  }
  if (guides.z != null) {
    const y = yOf(model.base + guides.z);
    parts.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="elev-align"/>`);
  }
}

/** Vertical dimension string beside a selected opening. `kind` is `sill`
 * (floor to sill, drawn below the frame) or `ceiling` (head to the top of
 * the wall). Ticks are the oblique marks used on an architectural elevation. */
function dimensionRun(parts, { y1, y2, dx, side, jamb, label, kind, H }) {
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  if (bot - top < 1 || !label) return;
  const dir = dx >= jamb ? 1 : -1;
  const witness = (yy) => {
    parts.push(`<line x1="${jamb + dir * 2}" y1="${yy}" x2="${dx + dir * 3}" y2="${yy}" class="elev-dim-ext"/>`);
    parts.push(`<line x1="${dx - 3.2}" y1="${yy + 3.2}" x2="${dx + 3.2}" y2="${yy - 3.2}" class="elev-dim-tick"/>`);
  };
  witness(top);
  witness(bot);
  parts.push(`<line x1="${dx}" y1="${top}" x2="${dx}" y2="${bot}" class="elev-dim-line"/>`);
  const ty = Math.min(H - 3, Math.max(9, (top + bot) / 2 + 3));
  const anchor = side > 0 ? "start" : "end";
  parts.push(`<text x="${dx + side * 5}" y="${ty}" text-anchor="${anchor}" class="elev-dim" data-elev-dim="${kind}">${label}</text>`);
}

const CUT_EPS = 1e-4;

/** Openings this finish is measured net of. A length (skirting) loses doors only. */
function cutsFor(band, openings) {
  const linear = FINISH_CATEGORIES[band.category]?.unit === "m";
  const cutsFloor = (o) => o.category === "door" || (o.category === "opening" && (o.sill || 0) <= 0.02);
  return (openings || []).filter((o) => o.width > CUT_EPS && o.height > CUT_EPS && (!linear || cutsFloor(o)));
}

function openingPoly(o) {
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const z0 = o.sill;
  const z1 = o.sill + o.height;
  if (o.head === "arch") return archVoidPolygon({ from: x0, to: x1, bottom: z0, top: z1, rise: o.rise });
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/** The part of each opening that sits inside this finish, in wall coordinates. */
function holesInBand(band, openings) {
  const holes = [];
  for (const o of cutsFor(band, openings)) {
    if (band.outline?.length >= 3) {
      for (const piece of clipPolygon(openingPoly(o), band.outline)) holes.push(piece);
      continue;
    }
    const from = Math.max(band.from ?? 0, o.offset);
    const to = Math.min(band.to ?? Infinity, o.offset + o.width);
    const bottom = Math.max(band.bottom ?? 0, o.sill);
    const top = Math.min(band.top ?? Infinity, o.sill + o.height);
    if (to - from < CUT_EPS || top - bottom < CUT_EPS) continue;
    holes.push([[from, bottom], [to, bottom], [to, top], [from, top]]);
  }
  return holes;
}

/** Screen path of a finish with the openings cut out, so the wall shows through. */
function cutFill(outer, holes, xOf, yOf, base) {
  const ring = (poly) => `${poly.map(([s, z], i) => `${i ? "L" : "M"}${xOf(s)},${yOf(base + z)}`).join("")}Z`;
  return `<path d="${[outer, ...holes].map(ring).join("")}" fill-rule="evenodd"`;
}

function dimensionOpening(parts, { x, y, w, h, opening, model, yOf, W, H }) {
  const floorY = yOf(model.base);
  const ceilY = yOf(model.top);
  const sillY = y + h;
  const toCeiling = model.height - opening.sill - opening.height;
  const showSill = opening.category !== "door" && opening.sill > 0.005;
  const showCeiling = toCeiling > 0.005;
  if (!showSill && !showCeiling) return;

  const gap = 20;
  const right = x + w + gap;
  const side = right + 32 <= W - 4 ? 1 : -1;
  const dx = side > 0 ? right : x - gap;
  const jamb = side > 0 ? x + w : x;
  if (showSill) {
    dimensionRun(parts, { y1: floorY, y2: sillY, dx, side, jamb, label: mm(opening.sill), kind: "sill", H });
  }
  if (showCeiling) {
    dimensionRun(parts, { y1: y, y2: ceilY, dx, side, jamb, label: mm(toCeiling), kind: "ceiling", H });
  }
}

function bandPolygon(b) {
  if (b.outline?.length >= 3) return b.outline;
  if (!(b.to > b.from) || !(b.top > b.bottom)) return null;
  return [[b.from, b.bottom], [b.to, b.bottom], [b.to, b.top], [b.from, b.top]];
}

/** Coats at the bottom of the pile, then applied finishes, then a room rule.
 *  A floor picture sets `stackRank` so screed stays under the finishes on top.
 *  Wall bands leave it unset, and keep the order they have always had. */
function coatRank(band) {
  if (Number.isFinite(band.stackRank)) return band.stackRank;
  if (band.source === "rule") return 3;
  if (FINISH_CATEGORIES[band.category]?.layer === "coat") return 1;
  return 2;
}

function pieceArea(pieces) {
  return pieces.reduce((sum, poly) => sum + Math.abs(polyArea(poly)), 0);
}

/** Placed finishes that can stack. The wall-type plaster is not one of them. */
function coatBands(model) {
  return (model.finishBands || []).filter((b) => (
    b.source !== "default" && b.category !== "none" && b.unit !== "m" && bandPolygon(b)
  ));
}

/**
 * Patches where two or more placed finishes share area, including a partial
 * overlap and a drawn outline. A deeper stack that covers the same patch
 * stands in for the shallower one.
 */
function coatStacks(model) {
  const bands = coatBands(model).map((band) => ({ band, poly: bandPolygon(band) }));
  const queue = [];
  const seen = new Set();
  const regions = [];
  const enqueue = (idx, pieces) => {
    const key = idx.join(",");
    if (seen.has(key) || pieceArea(pieces) < 0.02) return;
    seen.add(key);
    queue.push({ idx, pieces });
  };
  for (let i = 0; i < bands.length; i += 1) {
    for (let j = i + 1; j < bands.length; j += 1) {
      const pieces = clipPolygon(bands[i].poly, bands[j].poly).filter((piece) => Math.abs(polyArea(piece)) > 1e-6);
      enqueue([i, j], pieces);
    }
  }
  while (queue.length) {
    const region = queue.shift();
    regions.push(region);
    for (let k = 0; k < bands.length; k += 1) {
      if (region.idx.includes(k)) continue;
      const pieces = [];
      for (const piece of region.pieces) {
        for (const cut of clipPolygon(piece, bands[k].poly)) {
          if (Math.abs(polyArea(cut)) > 1e-6) pieces.push(cut);
        }
      }
      enqueue([...region.idx, k].sort((a, b) => a - b), pieces);
    }
  }
  return regions.filter((region) => {
    const area = pieceArea(region.pieces);
    return !regions.some((other) => (
      other.idx.length > region.idx.length
      && region.idx.every((i) => other.idx.includes(i))
      && area - pieceArea(other.pieces) < 0.02
    ));
  }).map((region) => ({
    bands: region.idx.map((i) => bands[i].band).sort((a, b) => coatRank(a) - coatRank(b)),
    pieces: region.pieces,
  }));
}

/** The wall's shared-patch mark. A floor picture uses the same lines and the same pile. */
export function appendCoatMarks(parts, model, xOf, yOf) {
  drawCoatMarks(parts, model, xOf, yOf);
}

/**
 * Each shared patch carries a buried finish drawn just inside, in its own
 * colour, and a pile labelled "n finishes". The finishes are not coats:
 * tile over paint is two different finishes, not two coats of one material.
 * The wall-type plaster is left out, so paint on plaster is not a second finish.
 * The inspector preview leaves this mark off. The swatches and the count
 * crowd that small picture; the finish colours still show.
 * A rectangular patch keeps the pile in its top-left corner. Any other shape
 * puts it on the patch: the corner of the box around a diamond is empty margin.
 */

/** Where the swatch pile sits, in screen pixels. The top-left of a rectangle's box is on the patch. */
function pileAnchor(screen) {
  const minX = Math.min(...screen.map((p) => p[0]));
  const minY = Math.min(...screen.map((p) => p[1]));
  if (pointInPoly(minX + 10, minY + 10, screen)) return [minX + 10, minY + 10];
  const inset = offsetPolygonInward(screen, 16) || offsetPolygonInward(screen, 8);
  if (inset?.length >= 3) {
    let best = inset[0];
    let bestScore = Infinity;
    for (const p of inset) {
      const score = (p[0] - minX) + (p[1] - minY);
      if (score < bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return [best[0], best[1]];
  }
  const n = screen.length || 1;
  return [
    screen.reduce((sum, p) => sum + p[0], 0) / n,
    screen.reduce((sum, p) => sum + p[1], 0) / n,
  ];
}

function drawCoatMarks(parts, model, xOf, yOf) {
  const anchors = [];
  for (const stack of coatStacks(model)) {
    const buried = stack.bands.slice(0, -1);
    for (const piece of stack.pieces) {
      const screen = piece.map(([s, z]) => [xOf(s), yOf(model.base + z)]);
      buried.forEach((band, i) => {
        const inset = offsetPolygonInward(screen, 8 + i * 7);
        if (!inset) return;
        const pts = inset.map(([x, y]) => `${x},${y}`).join(" ");
        const colour = esc(band.fill || finishSwatch(band.category));
        const name = esc(band.label || FINISH_CATEGORIES[band.category]?.label || "Finish");
        parts.push(`<polygon points="${pts}" fill="none" stroke="#fffdf8" stroke-width="3.5" class="elev-coat-halo" pointer-events="none"/>`);
        parts.push(`<polygon points="${pts}" fill="none" stroke="${colour}" stroke-width="1.25" class="elev-coat-line" pointer-events="none"><title>${name} is under the finish on top</title></polygon>`);
      });
    }
    const host = stack.pieces.reduce((best, poly) => (Math.abs(polyArea(poly)) > Math.abs(polyArea(best)) ? poly : best));
    const screen = host.map(([s, z]) => [xOf(s), yOf(model.base + z)]);
    let [x, y] = pileAnchor(screen);
    while (anchors.some((p) => Math.hypot(p.x - x, p.y - y) < 18)) {
      if (!pointInPoly(x + 6, y + 22, screen)) break;
      y += 16;
    }
    anchors.push({ x, y });
    const size = 11;
    const peek = 4;
    stack.bands.forEach((band, i) => {
      const k = stack.bands.length - 1 - i;
      const colour = esc(band.fill || finishSwatch(band.category));
      parts.push(`<rect x="${x + k * peek}" y="${y + k * peek}" width="${size}" height="${size}" fill="${colour}" stroke="#1a1612" stroke-width="0.6" class="elev-coat-swatch" pointer-events="none"/>`);
    });
    parts.push(`<text x="${x + 6 + size + peek}" y="${y + 11}" class="elev-dim-strong">${stack.bands.length} finishes</text>`);
  }
}

/**
 * @param {object} model elevationModel() result
 * @param {{width:number,height:number,interactive?:boolean,selectedId?:string|null,view?:{zoom?:number,panX?:number,panY?:number}|null}} opts
 * @returns {{svg:string, scale:number, scaleX:number, scaleY:number, originX:number, originY:number, fit:object}}
 */
export function elevationSvg(model, { width, height, interactive = false, selectedId = null, selectedBandId = null, selectedVertex = null, draft = null, guides = null, edgeMode = "corner", view = null, locate = null, wallSelected = false, foundationPicking = false, dropGuide = null, frame = null } = {}) {
  const W = Math.max(80, Math.round(width));
  const H = Math.max(60, Math.round(height));
  if (!model) {
    const fit = { scaleX: 1, scaleY: 1, originX: 0, originY: 0, top: 0, spanX: 1, spanY: 1 };
    return { svg: "", scale: 1, scaleX: 1, scaleY: 1, originX: 0, originY: 0, fit };
  }

  // The next floor or the roof stays in frame even when the wall stops short
  // of it, so a shorter wall is still read against that line.
  const guide = model.guide && Number.isFinite(model.guide.elevation) ? model.guide : null;
  const spanTop = Math.max(model.top, guide?.elevation ?? model.top);
  const near = model.levels.filter((l) => l.elevation >= model.base - 0.6 && l.elevation <= spanTop + 0.6);
  const offer = interactive && model.foundationOffer ? model.foundationOffer : null;
  const footBases = (model.foundations || []).map((f) => f.base);
  if (offer) footBases.push(offer.base);
  const zLo = Math.min(model.base, ...footBases, ...near.map((l) => l.elevation)) - 0.1;
  const zHi = Math.max(spanTop, ...near.map((l) => l.elevation)) + 0.2;
  // Span the same width as the level lines. The open elevation keeps a strip
  // on the left for the height figure; the preview uses the whole graph.
  const x0 = interactive ? Math.max(PAD / 2, 32) : PAD / 2;
  const x1 = W - PAD / 2;
  const planScale = Number(frame?.scale);
  const locked = planScale > 0 && Number.isFinite(Number(frame?.originX));
  let fit;
  if (locked) {
    // The floor is the anchor. A footing under it keeps its own height, and
    // is clipped once it no longer fits beneath that floor.
    const footing = Math.max(
      0,
      ...((model.foundations || []).map((f) => model.base - f.base)),
      offer ? Number(offer.depth) || 0 : 0,
    );
    let originY = H - PAD - footing * planScale;
    if (originY < PAD) originY = H - PAD;
    fit = {
      scaleX: planScale,
      scaleY: planScale,
      originX: Number(frame.originX),
      originY,
      top: originY - (zHi - model.base) * planScale,
      spanX: model.length * planScale,
      spanY: Math.max(model.height, zHi - zLo) * planScale,
      dir: frame.dir < 0 ? -1 : 1,
    };
  } else {
    const fitScaleY = Math.max(1e-3, (H - PAD * 2) / Math.max(zHi - zLo, 0.1));
    const fitScaleX = Math.max(1e-3, (x1 - x0) / Math.max(model.length, 0.1));
    fit = {
      scaleX: fitScaleX,
      scaleY: fitScaleY,
      originX: x0,
      originY: PAD + (zHi - model.base) * fitScaleY,
      top: PAD,
      spanX: model.length * fitScaleX,
      spanY: (zHi - zLo) * fitScaleY,
      dir: 1,
    };
  }
  // Zoom 1, no pan: the fitted wall, or the plan-matched face when a frame is set.
  const placed = elevationPlacement(fit, view);
  const dir = placed.dir < 0 ? -1 : 1;
  const scaleY = placed.scaleY;
  const scaleX = placed.scaleX * dir;
  const scale = scaleY;
  const originX = placed.originX;
  const yOf = (z) => placed.originY - (z - model.base) * scaleY;
  const xOf = (offset) => originX + offset * scaleX;
  const xSpan = (s0, s1) => {
    const a = xOf(s0);
    const b = xOf(s1);
    return [Math.min(a, b), Math.abs(b - a)];
  };
  const originY = yOf(model.base);

  const parts = [];
  const labels = [];
  const hatch = interactive ? "a" : "b";
  parts.push(`<defs>
    <pattern id="elev-rule-${hatch}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 L8 0" stroke="#5c5348" stroke-width="1"/></pattern>
  </defs>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="elev-bg"/>`);

  const levelLabel = (name, elevation) => {
    const sign = elevation >= 0 ? "+" : "-";
    return `${esc(name)} ${sign}${Math.abs(elevation).toFixed(3)}`;
  };

  // Levels first, so the wall sits over them. The guide (next floor, or the
  // roof on the top storey) is labelled even in the small preview.
  for (const l of model.levels) {
    if (l.elevation < zLo - 1e-6 || l.elevation > zHi + 1e-6) continue;
    const y = yOf(l.elevation);
    const isGuide = Boolean(guide && guide.kind === "floor" && l.id === guide.id);
    parts.push(`<line x1="${PAD / 2}" x2="${W - PAD / 2}" y1="${y}" y2="${y}" class="elev-level elev-level-${l.kind}${isGuide ? " elev-guide" : ""}"/>`);
    if (interactive || isGuide) {
      labels.push(`<text x="${W - PAD / 2}" y="${y - 3}" text-anchor="end" class="elev-level-label">${levelLabel(l.name, l.elevation)}</text>`);
    }
  }
  const roofDrawn = guide?.kind === "roof" && !model.levels.some((l) => Math.abs(l.elevation - guide.elevation) < 1e-3);
  if (roofDrawn && guide.elevation >= zLo - 1e-6 && guide.elevation <= zHi + 1e-6) {
    const y = yOf(guide.elevation);
    parts.push(`<line x1="${PAD / 2}" x2="${W - PAD / 2}" y1="${y}" y2="${y}" class="elev-level elev-level-roof elev-guide"/>`);
    labels.push(`<text x="${W - PAD / 2}" y="${y - 3}" text-anchor="end" class="elev-level-label">${levelLabel(guide.name, guide.elevation)}</text>`);
  }

  // Plan-matched, the body is the face the plan paints (mitred at corners).
  // The fitted preview keeps the centreline so it stays inside its graph.
  const faceFrom = locked && Number.isFinite(model.faceFrom) ? model.faceFrom : 0;
  const faceTo = locked && Number.isFinite(model.faceTo) ? model.faceTo : model.length;
  const [wx, ww] = xSpan(faceFrom, faceTo);
  const wy = yOf(model.top);
  const wh = model.height * scaleY;
  if (guide && guide.elevation > model.top + 0.02) {
    const gy = yOf(guide.elevation);
    parts.push(`<rect x="${wx}" y="${gy}" width="${ww}" height="${Math.max(0, wy - gy)}" class="elev-wall-ghost"/>`);
  }
  const host = selectedId ? " elev-wall-host" : "";
  parts.push(`<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" class="elev-wall${host}" data-elev-wall="1"/>`);
  for (const f of model.foundations || []) {
    const [fx, fw] = xSpan(f.from, f.to);
    const fy = yOf(f.top);
    const fh = (f.top - f.base) * scaleY;
    if (fw < 1 || fh < 1) continue;
    parts.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" class="elev-foundation" data-elev-foundation="${esc(f.id)}"><title>${esc(f.name)}</title></rect>`);
    if (fh >= 14 && fw >= 36) {
      parts.push(`<text x="${fx + fw / 2}" y="${fy + fh / 2 + 4}" text-anchor="middle" class="elev-dim" pointer-events="none">${mm(f.depth)}</text>`);
    }
  }
  if (offer) {
    const [fx, fw] = xSpan(faceFrom, faceTo);
    const fy = yOf(offer.top);
    const fh = offer.depth * scaleY;
    if (fw >= 1 && fh >= 1) {
      const label = foundationPicking ? mm(offer.depth) : "+ Foundation";
      parts.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" class="elev-foundation elev-foundation-add" data-elev-add-foundation="1"><title>${esc(offer.name)}</title></rect>`);
      if (fh >= 16 && fw >= 88) {
        parts.push(`<text x="${fx + fw / 2}" y="${fy + fh / 2 + 4}" text-anchor="middle" class="elev-foundation-add-label" pointer-events="none">${label}</text>`);
      }
    }
  }

  for (const b of model.finishBands) {
    // A finish is the colour it has in the panel. The computed default stays grey,
    // and "no finish" is the wall colour, so it reads as a hole in that default.
    // Openings are cut out of the fill: the quantity is already net of them, and
    // the wall colour showing through is how that reads. The frame is drawn after.
    const none = b.category === "none";
    const colour = b.fill || (b.source === "default" || none ? "" : finishSwatch(b.category));
    // A paint's own colour can be near white, so it keeps an outline to stay visible on the wall.
    const edge = b.fill ? ";stroke:rgba(26,22,18,0.45);stroke-width:1" : "";
    const tint = colour ? ` style="fill:${colour};fill-opacity:0.55${edge}"` : "";
    const picked = b.id === selectedBandId ? " is-selected" : "";
    const cls = `elev-band elev-band-${esc(b.source || "run")}${none ? " elev-band-none" : ""}${b.source === "rule" ? " elev-band-rule" : ""}${picked}`;
    const title = `<title>${esc(b.label || "Finish")}</title>`;
    const holes = holesInBand(b, model.openings);
    if (holes.length) {
      const outer = b.outline?.length >= 3
        ? b.outline
        : [[b.from ?? 0, b.bottom], [b.to ?? model.length, b.bottom], [b.to ?? model.length, b.top], [b.from ?? 0, b.top]];
      parts.push(`${cutFill(outer, holes, xOf, yOf, model.base)} class="${cls}"${tint} data-elev-fill="${esc(b.id)}">${title}</path>`);
    } else if (b.outline?.length >= 3) {
      const pts = b.outline.map(([s, z]) => `${xOf(s)},${yOf(model.base + z)}`).join(" ");
      parts.push(`<polygon points="${pts}" class="${cls}"${tint} data-elev-fill="${esc(b.id)}">${title}</polygon>`);
    } else {
      const [bx, bw] = xSpan(b.from ?? 0, b.to ?? model.length);
      parts.push(`<rect x="${bx}" y="${yOf(model.base + b.top)}" width="${bw}" height="${(b.top - b.bottom) * scaleY}" class="${cls}"${tint} data-elev-fill="${esc(b.id)}">${title}</rect>`);
    }
    if (b.source === "rule") {
      const [rx, rw] = xSpan(b.from ?? 0, b.to ?? model.length);
      const ry = yOf(model.base + b.top);
      const rh = (b.top - b.bottom) * scaleY;
      parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="url(#elev-rule-${hatch})" pointer-events="none"/>`);
    }
  }
  if (interactive) drawCoatMarks(parts, model, xOf, yOf);

  for (const o of model.openings) {
    const [x, w] = xSpan(o.offset, o.offset + o.width);
    const y = yOf(model.base + o.sill + o.height);
    const h = o.height * scaleY;
    const sel = o.id === selectedId;
    const cls = `elev-opening elev-${o.category === "door" ? "door" : o.head === "arch" ? "arch" : o.category === "opening" ? "opening" : "window"}${sel ? " is-selected" : ""}${o.nonStandard ? " is-nonstandard" : ""}`;
    // The inspector graph is a picture: the opening can be picked, not dragged.
    // Move handles exist only on the open elevation.
    const move = interactive ? ` data-elev-op="move"` : "";
    if (o.head === "arch") {
      const d = openingPoly(o).map(([s, z], i) => `${i ? "L" : "M"}${xOf(s)},${yOf(model.base + z)}`).join("") + "Z";
      parts.push(`<path d="${d}" class="${cls}"${move} data-elev-id="${esc(o.id)}"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"${move} data-elev-id="${esc(o.id)}"/>`);
    }
    if (sel) {
      // Setting-out, the way an elevation is dimensioned: the opening size
      // stays on the frame, the sill height is the run below it, and the
      // run above it is the height from the head up to the ceiling (the
      // top of this wall).
      const headRoom = y - yOf(model.top);
      const labelY = headRoom >= 32 ? Math.max(10, y - 16) : Math.min(y + h - 4, y + 16);
      const riseNote = o.head === "arch" && o.rise > 0 ? `  rise ${mm(o.rise)}` : "";
      parts.push(`<text x="${x + w / 2}" y="${labelY}" text-anchor="middle" class="elev-dim">${mm(o.width)} × ${mm(o.height)}${riseNote}</text>`);
      dimensionOpening(parts, { x, y, w, h, opening: o, model, yOf, W, H });
    }
    if (interactive && sel) {
      // A window, a plain opening, and an arch are resized from four corners.
      // The left ones move the offset and keep the right edge; the bottom
      // ones move the sill and keep the head. A door keeps its type width
      // and has no sill, so only the head handle is drawn.
      const hs = o.category === "door"
        ? [["t", x + w / 2, y]]
        : [["tl", x, y], ["tr", x + w, y], ["br", x + w, y + h], ["bl", x, y + h]];
      for (const [part, hx, hy] of hs) {
        parts.push(`<rect x="${hx - HANDLE}" y="${hy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-${part}" data-elev-op="${part}" data-elev-id="${esc(o.id)}"/>`);
      }
      // The spring is where the curve leaves the jambs. Dragging it changes
      // the rise and leaves the crown where it is.
      if (o.head === "arch" && o.rise > 0) {
        const sy = yOf(model.base + o.sill + o.height - o.rise);
        const hx = x + w / 2;
        parts.push(`<line x1="${x + 6}" y1="${sy}" x2="${x + w - 6}" y2="${sy}" class="elev-spring"/>`);
        parts.push(`<rect x="${hx - HANDLE}" y="${sy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-spring" data-elev-op="spring" data-elev-id="${esc(o.id)}"><title>Rise</title></rect>`);
      }
    }
  }

  // A wall that comes out of this face covers a strip as wide as its end.
  // Drawn over finishes and openings, because that part of the face is hidden.
  // It is the other wall, so it carries no finish and no drag handles.
  for (const p of model.projections || []) {
    const [px, pw] = xSpan(p.from, p.to);
    const py = yOf(p.top);
    const ph = (p.top - p.base) * scaleY;
    if (pw < 0.5 || ph < 0.5) continue;
    parts.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" class="elev-protrusion" data-elev-protrusion="${esc(p.id)}"><title>${esc(p.name)}</title></rect>`);
  }

  if (Number.isFinite(dropGuide)) {
    const gy = yOf(model.base + dropGuide);
    const down = Math.round((model.height - dropGuide) * 1000);
    parts.push(`<line x1="${wx}" x2="${wx + ww}" y1="${gy}" y2="${gy}" class="elev-drop-guide" pointer-events="none"/>`);
    labels.push(`<text x="${wx + 4}" y="${gy - 3}" class="elev-drop-label" pointer-events="none">${down} mm down</text>`);
  }

  // Finish band edges: the top and bottom of a room rule or a run, and the
  // ends of a run. The computed default has none. Drawn after the openings so
  // an edge is still reachable where an opening overlaps the band.
  // A selected run is edited as a polygon instead: corners drag, and a click
  // on an edge adds a node. A rectangle has not stored an outline yet; its
  // four corners are the ring until that click.
  // A selected window or door is the one edit: its handles stay, and the
  // finish corners and edges do not, so the two shapes are not changed together.
  if (interactive && !selectedId) {
    const EDGE = 4;
    const editRing = (b) => {
      if (b.id !== selectedBandId || b.source !== "run") return null;
      if (b.outline?.length >= 3) return b.outline;
      if (!b.editable || !(b.to > b.from) || !(b.top > b.bottom)) return null;
      return [[b.from, b.bottom], [b.to, b.bottom], [b.to, b.top], [b.from, b.top]];
    };
    for (const b of model.finishBands) {
      if (!b.editable || b.outline || editRing(b)) continue;
      const [bx, bw] = xSpan(b.from, b.to);
      const byTop = yOf(model.base + b.top);
      const byBottom = yOf(model.base + b.bottom);
      const edge = (part, x, y, w, h) => parts.push(`<rect x="${x}" y="${y}" width="${Math.max(2, w)}" height="${Math.max(2, h)}" class="elev-band-edge elev-band-edge-${part}" data-elev-op="band-${part}" data-elev-band="${esc(b.id)}"/>`);
      edge("top", bx, byTop - EDGE / 2, bw, EDGE);
      edge("bottom", bx, byBottom - EDGE / 2, bw, EDGE);
      if (b.source === "run") {
        edge("left", bx - EDGE / 2, byTop, EDGE, byBottom - byTop);
        edge("right", bx + bw - EDGE / 2, byTop, EDGE, byBottom - byTop);
      }
    }
    for (const b of model.finishBands) {
      const ring = editRing(b);
      if (!ring) continue;
      const pts = ring.map(([s, z]) => [xOf(s), yOf(model.base + z)]);
      for (let i = 0; i < ring.length; i += 1) {
        const [s1, z1] = ring[i];
        const [s2, z2] = ring[(i + 1) % ring.length];
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        // The resize cursor stays on the line. Shift swaps every edge to the
        // other job by a class on the drawing, without rebuilding this SVG.
        const adding = edgeMode !== "line";
        const edgeClass = `elev-outline-edge is-${edgeResizeCursor(x1, y1, x2, y2)}${adding ? " is-add" : ""}`;
        const edgeTitle = adding ? "Add a corner" : "Resize this edge";
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${edgeClass}" pointer-events="stroke" data-elev-op="outline-edge" data-elev-band="${esc(b.id)}" data-elev-index="${i}"><title>${edgeTitle}</title></line>`);
        // A rectangle that is still a box labels its width and its height.
        // A drawn outline keeps a length on every edge.
        const labelEdge = b.outline?.length >= 3 || i === 0 || i === 3;
        if (labelEdge) measureLabel(parts, x1, y1, x2, y2, Math.hypot(s2 - s1, z2 - z1));
      }
      ring.forEach(([s, z], i) => {
        const x = xOf(s);
        const y = yOf(model.base + z);
        const picked = selectedVertex === i ? " is-selected" : "";
        parts.push(`<rect x="${x - HANDLE}" y="${y - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle${picked}" data-elev-op="outline-vertex" data-elev-band="${esc(b.id)}" data-elev-index="${i}"/>`);
      });
    }
  }

  // Wall height is set on the open elevation, not the inspector preview.
  // The handle is only there after the wall itself is clicked. A finish, a
  // window, or a door keeps the click, so dragging that shape cannot change
  // the wall.
  if (interactive && wallSelected && model.canDragTop !== false && !draft) {
    const EDGE = 8;
    const grip = Math.min(ww, 36);
    const gx = wx + (ww - grip) / 2;
    parts.push(`<rect x="${gx}" y="${wy - EDGE / 2}" width="${grip}" height="${EDGE}" class="elev-wall-top" data-elev-op="wall-top"/>`);
    const picked = wallSelected ? " is-wall-selected" : "";
    parts.push(`<rect x="${wx + ww / 2 - HANDLE}" y="${wy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-t elev-wall-top-handle${picked}" data-elev-op="wall-top"/>`);
  }

  alignLines(parts, model, guides, xOf, yOf, W, H);

  if (draft?.points?.length) {
    const xy = (p) => `${xOf(p.s)},${yOf(model.base + p.z)}`;
    const placed = draft.points.map(xy).join(" ");
    const hover = draft.hover ? ` ${xy(draft.hover)}` : "";
    if (draft.points.length >= 3) {
      const outer = draft.points.map((p) => [p.s, p.z]);
      const holes = holesInBand({ category: draft.category, outline: outer }, model.openings);
      const tint = ` style="fill:${finishSwatch(draft.category)};fill-opacity:0.35"`;
      if (holes.length) {
        parts.push(`${cutFill(outer, holes, xOf, yOf, model.base)} class="elev-draft-fill"${tint}/>`);
      } else {
        parts.push(`<polygon points="${placed}" class="elev-draft-fill"${tint}/>`);
      }
    }
    parts.push(`<polyline points="${placed}${hover}" class="elev-draft"/>`);
    // The edge back to the start is drawn while the pointer moves, so the
    // shape reads as closed before the last click. Finishing does not require
    // clicking that first corner.
    if (draft.hover && draft.points.length >= 2) {
      const first = draft.points[0];
      parts.push(`<line x1="${xOf(draft.hover.s)}" y1="${yOf(model.base + draft.hover.z)}" x2="${xOf(first.s)}" y2="${yOf(model.base + first.z)}" class="elev-draft-close"/>`);
    }
    for (let i = 1; i < draft.points.length; i += 1) {
      const a = draft.points[i - 1];
      const b = draft.points[i];
      measureLabel(parts, xOf(a.s), yOf(model.base + a.z), xOf(b.s), yOf(model.base + b.z), Math.hypot(b.s - a.s, b.z - a.z));
    }
    if (draft.hover) {
      const last = draft.points[draft.points.length - 1];
      measureLabel(
        parts,
        xOf(last.s), yOf(model.base + last.z),
        xOf(draft.hover.s), yOf(model.base + draft.hover.z),
        Math.hypot(draft.hover.s - last.s, draft.hover.z - last.z),
      );
    }
    for (const p of draft.points) parts.push(`<circle cx="${xOf(p.s)}" cy="${yOf(model.base + p.z)}" r="3.5" class="elev-draft-pt"/>`);
  }

  // Clearance back to the wall: while a corner is placed, and while a corner
  // or edge is dragged or left held. A pinned gap is drawn even at 0. A
  // label with a caret is the one being typed into.
  drawFinishLocate(parts, model, locate, xOf, yOf, W, H);

  if (interactive) {
    let below = yOf(offer ? offer.base : model.base);
    for (const f of model.foundations || []) below = Math.max(below, yOf(f.base));
    parts.push(`<text x="${wx + ww / 2}" y="${Math.min(H - 3, below + 12)}" text-anchor="middle" class="elev-dim">${mm(model.length)}</text>`);
  }
  if (interactive) {
    parts.push(`<text x="${wx - 4}" y="${wy + wh / 2}" text-anchor="end" class="elev-dim">${mm(model.height)}</text>`);
  }

  // Level names are drawn last so a wall that reaches the label column cannot
  // paint over the next-floor line's caption. The drawing dot sits above them.
  parts.push(...labels);
  if (draft?.hover) {
    parts.push(`<circle cx="${xOf(draft.hover.s)}" cy="${yOf(model.base + draft.hover.z)}" r="6.5" class="elev-draft-cursor"/>`);
  }

  const footing = model.foundations?.length
    ? `, ${model.foundations.length} foundation${model.foundations.length === 1 ? "" : "s"} below`
    : "";
  const label = `Wall elevation, ${mm(model.length)} long, ${mm(model.height)} high, ${model.openings.length} opening${model.openings.length === 1 ? "" : "s"}${footing}`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" class="elev-svg${selectedId ? " elev-host" : ""}">${parts.join("")}</svg>`,
    scale,
    scaleX,
    scaleY,
    originX,
    originY,
    fit,
  };
}
