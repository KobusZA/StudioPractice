// SVG drawing of a wall elevation model. One function serves the small
// inspector preview and the strip under the plan; `interactive` adds the drag
// handles. Returns markup plus the scales the pointer code needs to turn pixels
// back into metres. The wall always spans the width of the level lines. Height
// is fitted on its own, so a short wall is stretched across the graph and a
// long one is squeezed, and the next floor stays above the wall.
//
// The open strip can zoom in on that fitted view (`view.zoom`) and slide it
// (`view.panX`, `view.panY`, screen pixels). Zoom 1 with no pan is the fit.
// The preview never passes a view, so it stays fitted.

import { FINISH_CATEGORIES, finishSwatch } from "./finish-data.js";
import { clipPolygon } from "./geom.js";

const PAD = 14;
const HANDLE = 5;

/** Zoom out stops at the fitted wall. Further out would letterbox it. */
export const ELEV_ZOOM_MIN = 1;
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
 */
export function elevationPlacement(fit, view) {
  const zoom = clampZoom(view?.zoom);
  const panX = Number(view?.panX) || 0;
  const panY = Number(view?.panY) || 0;
  const scaleX = fit.scaleX * zoom;
  const scaleY = fit.scaleY * zoom;
  const originX = fit.originX + panX;
  const originY = fit.top + (fit.originY - fit.top) * zoom + panY;
  return { zoom, scaleX, scaleY, originX, originY };
}

/**
 * Next view after a wheel step about a screen point, so that point stays put.
 * Zooming back to the fitted wall clears the pan: that view is exactly the
 * unzoomed drawing.
 */
export function zoomElevationView(fit, view, px, py, factor) {
  const prev = clampZoom(view?.zoom);
  const zoom = clampZoom(prev * factor);
  if (zoom === ELEV_ZOOM_MIN) return { zoom: 1, panX: 0, panY: 0 };
  const placed = elevationPlacement(fit, { zoom: prev, panX: view?.panX, panY: view?.panY });
  const s = (px - placed.originX) / placed.scaleX;
  const above = (placed.originY - py) / placed.scaleY;
  const originX = px - s * fit.scaleX * zoom;
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
  if (zoom === ELEV_ZOOM_MIN) return { zoom: 1, panX: 0, panY: 0 };
  const margin = Math.min(48, Math.max(16, Math.min(width, height) / 4));
  const clamp = (origin0, span, pan, viewSize) => {
    let origin = origin0 + pan;
    if (origin + span < margin) origin += margin - (origin + span);
    if (origin > viewSize - margin) origin -= origin - (viewSize - margin);
    return origin - origin0;
  };
  return {
    zoom,
    panX: clamp(fit.originX, fit.spanX * zoom, Number(view?.panX) || 0, width),
    panY: clamp(fit.top, fit.spanY * zoom, Number(view?.panY) || 0, height),
  };
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

/** Drop a clearance that is flush with the wall. `null` when neither axis remains. */
function packLocate(spec) {
  if (!spec) return null;
  const out = {};
  if (spec.side && spec.side.s1 - spec.side.s0 > LOCATE_GAP) out.side = spec.side;
  if (spec.vert && spec.vert.z1 - spec.vert.z0 > LOCATE_GAP) out.vert = spec.vert;
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

/**
 * The dimension lines for a finish that is being drawn or dragged.
 * `mode` is `point` (the corner under the cursor), `edge` (a line, one axis),
 * `corner` (both axes) or `move` (the whole shape). Lengths are metres.
 * @returns {{side?:{s0:number,s1:number,z:number}, vert?:{z0:number,z1:number,s:number,toward:string}}|null}
 */
export function finishLocate(points, { mode, index = 0, length, height, point = null } = {}) {
  if (!(length > 0) || !(height > 0)) return null;
  if (mode === "point") return point ? packLocate(pointSpec(point.s, point.z, length, height)) : null;
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
  if (mode === "edge") return packLocate(edgeSpec(points, index, length, height));
  if (mode === "corner") {
    const n = points.length;
    const i = ((index % n) + n) % n;
    const p = points[i];
    const merged = mergeLocate(
      edgeSpec(points, (i - 1 + n) % n, length, height),
      edgeSpec(points, i, length, height),
    );
    if (!merged) return null;
    // Both lines meet this corner. A sloping neighbour must not borrow the
    // other end's height or station.
    const spec = {};
    if (merged.side) {
      spec.side = merged.side.s0 === 0
        ? { s0: 0, s1: p.s, z: p.z }
        : { s0: p.s, s1: length, z: p.z };
    }
    if (merged.vert) {
      spec.vert = merged.vert.toward === "base"
        ? { z0: 0, z1: p.z, s: p.s, toward: "base" }
        : { z0: p.z, z1: height, s: p.s, toward: "top" };
    }
    return packLocate(spec);
  }
  return null;
}

/** Caption on a clearance dimension. Clamped so a short gap still keeps its text inside the drawing. */
function locateCaption(parts, x, y, anchor, text, kind, W, H) {
  const width = text.length * 6.4 + 8;
  const height = 14;
  let left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  let top = y - 11;
  left = Math.max(2, Math.min(left, W - width - 2));
  top = Math.max(2, Math.min(top, H - height - 2));
  const tx = anchor === "start" ? left + 4 : anchor === "end" ? left + width - 4 : left + width / 2;
  parts.push(`<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="2" class="elev-measure-bg"/>`);
  parts.push(`<text x="${tx}" y="${top + 11}" text-anchor="${anchor}" class="elev-dim" data-elev-dim="${kind}">${text}</text>`);
}

function locateTick(parts, x, y) {
  parts.push(`<line x1="${x - 3.2}" y1="${y + 3.2}" x2="${x + 3.2}" y2="${y - 3.2}" class="elev-dim-tick"/>`);
}

/** Horizontal clearance, in the gap beside the finish. */
function locateSide(parts, model, side, xOf, yOf, W, H) {
  const metres = side.s1 - side.s0;
  if (!(metres > LOCATE_GAP)) return;
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
  locateCaption(parts, (left + right) / 2, y - 2, "middle", `${mm(metres)} mm`, "side", W, H);
}

/** Vertical clearance, up to the top of the wall or down to the floor. */
function locateVert(parts, model, vert, xOf, yOf, W, H) {
  const metres = vert.z1 - vert.z0;
  if (!(metres > LOCATE_GAP)) return;
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
  locateCaption(parts, x + 6, (top + bot) / 2 + 4, "start", `${mm(metres)} mm`, kind, W, H);
}

function drawFinishLocate(parts, model, locate, xOf, yOf, W, H) {
  if (!locate || !model) return;
  if (locate.side) locateSide(parts, model, locate.side, xOf, yOf, W, H);
  if (locate.vert) locateVert(parts, model, locate.vert, xOf, yOf, W, H);
}

/** The same edge length the plan shows while a polygon is drawn or edited. */
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
  return (openings || []).filter((o) => o.width > CUT_EPS && o.height > CUT_EPS && (!linear || o.category === "door"));
}

function openingPoly(o) {
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const z0 = o.sill;
  const z1 = o.sill + o.height;
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

/**
 * @param {object} model elevationModel() result
 * @param {{width:number,height:number,interactive?:boolean,selectedId?:string|null,view?:{zoom?:number,panX?:number,panY?:number}|null}} opts
 * @returns {{svg:string, scale:number, scaleX:number, scaleY:number, originX:number, originY:number, fit:object}}
 */
export function elevationSvg(model, { width, height, interactive = false, selectedId = null, selectedBandId = null, selectedVertex = null, draft = null, guides = null, edgeMode = "corner", view = null, locate = null } = {}) {
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
  const zLo = Math.min(model.base, ...near.map((l) => l.elevation)) - 0.1;
  const zHi = Math.max(spanTop, ...near.map((l) => l.elevation)) + 0.2;
  // Span the same width as the level lines. The open elevation keeps a strip
  // on the left for the height figure; the preview uses the whole graph.
  const x0 = interactive ? Math.max(PAD / 2, 32) : PAD / 2;
  const x1 = W - PAD / 2;
  const fitScaleY = Math.max(1e-3, (H - PAD * 2) / Math.max(zHi - zLo, 0.1));
  const fitScaleX = Math.max(1e-3, (x1 - x0) / Math.max(model.length, 0.1));
  const fit = {
    scaleX: fitScaleX,
    scaleY: fitScaleY,
    originX: x0,
    originY: PAD + (zHi - model.base) * fitScaleY,
    top: PAD,
    spanX: model.length * fitScaleX,
    spanY: (zHi - zLo) * fitScaleY,
  };
  // Zoom 1, no pan: the floor and the left of the wall sit where they always have.
  const placed = elevationPlacement(fit, view);
  const scaleY = placed.scaleY;
  const scaleX = placed.scaleX;
  const scale = scaleY;
  const originX = placed.originX;
  const yOf = (z) => placed.originY - (z - model.base) * scaleY;
  const xOf = (offset) => originX + offset * scaleX;
  const originY = yOf(model.base);

  const parts = [];
  const labels = [];
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

  const wx = xOf(0);
  const wy = yOf(model.top);
  const ww = model.length * scaleX;
  const wh = model.height * scaleY;
  if (guide && guide.elevation > model.top + 0.02) {
    const gy = yOf(guide.elevation);
    parts.push(`<rect x="${wx}" y="${gy}" width="${ww}" height="${Math.max(0, wy - gy)}" class="elev-wall-ghost"/>`);
  }
  const host = selectedId ? " elev-wall-host" : "";
  parts.push(`<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" class="elev-wall${host}" data-elev-wall="1"/>`);

  for (const b of model.finishBands) {
    // A finish is the colour it has in the panel. The computed default stays grey,
    // and "no finish" is the wall colour, so it reads as a hole in that default.
    // Openings are cut out of the fill: the quantity is already net of them, and
    // the wall colour showing through is how that reads. The frame is drawn after.
    const none = b.category === "none";
    const tint = b.source === "default" || none ? "" : ` style="fill:${finishSwatch(b.category)};fill-opacity:0.55"`;
    const picked = b.id === selectedBandId ? " is-selected" : "";
    const cls = `elev-band elev-band-${esc(b.source || "run")}${none ? " elev-band-none" : ""}${picked}`;
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
      parts.push(`<rect x="${xOf(b.from ?? 0)}" y="${yOf(model.base + b.top)}" width="${((b.to ?? model.length) - (b.from ?? 0)) * scaleX}" height="${(b.top - b.bottom) * scaleY}" class="${cls}"${tint} data-elev-fill="${esc(b.id)}">${title}</rect>`);
    }
  }

  for (const o of model.openings) {
    const x = xOf(o.offset);
    const y = yOf(model.base + o.sill + o.height);
    const w = o.width * scaleX;
    const h = o.height * scaleY;
    const sel = o.id === selectedId;
    const cls = `elev-opening elev-${o.category === "door" ? "door" : "window"}${sel ? " is-selected" : ""}${o.nonStandard ? " is-nonstandard" : ""}`;
    // The inspector graph is a picture: the opening can be picked, not dragged.
    // Move handles exist only on the open elevation.
    const move = interactive ? ` data-elev-op="move"` : "";
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"${move} data-elev-id="${esc(o.id)}"/>`);
    if (sel) {
      // Setting-out, the way an elevation is dimensioned: the opening size
      // stays on the frame, the sill height is the run below it, and the
      // run above it is the height from the head up to the ceiling (the
      // top of this wall).
      const headRoom = y - yOf(model.top);
      const labelY = headRoom >= 32 ? Math.max(10, y - 16) : Math.min(y + h - 4, y + 16);
      parts.push(`<text x="${x + w / 2}" y="${labelY}" text-anchor="middle" class="elev-dim">${mm(o.width)} × ${mm(o.height)}</text>`);
      dimensionOpening(parts, { x, y, w, h, opening: o, model, yOf, W, H });
    }
    if (interactive && sel) {
      // A door keeps its type width. The body is the move target; the side
      // handles that stretch a window are not drawn. The head still sets height,
      // and a door has no sill, so there is no bottom handle either.
      const hs = [["t", x + w / 2, y]];
      if (o.category !== "door") {
        hs.push(["l", x, y + h / 2], ["r", x + w, y + h / 2], ["b", x + w / 2, y + h]);
      }
      for (const [part, hx, hy] of hs) {
        parts.push(`<rect x="${hx - HANDLE}" y="${hy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-${part}" data-elev-op="${part}" data-elev-id="${esc(o.id)}"/>`);
      }
    }
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
      const bx = xOf(b.from);
      const bw = (b.to - b.from) * scaleX;
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
        const adding = edgeMode !== "line";
        const edgeClass = adding ? "elev-outline-edge is-add" : `elev-outline-edge is-${edgeResizeCursor(x1, y1, x2, y2)}`;
        const edgeTitle = adding ? "Add a corner" : "Resize this edge";
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${edgeClass}" pointer-events="stroke" data-elev-op="outline-edge" data-elev-band="${esc(b.id)}" data-elev-index="${i}"><title>${edgeTitle}</title></line>`);
        measureLabel(parts, x1, y1, x2, y2, Math.hypot(s2 - s1, z2 - z1));
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
  // The top handle stays off only while a finish outline is still being drawn.
  // Once that shape is finished, or a window, door, or finish is merely selected,
  // the handle is back so the wall height can be changed again.
  if (interactive && model.canDragTop !== false && !draft) {
    const EDGE = 8;
    const grip = Math.min(ww, 36);
    const gx = wx + (ww - grip) / 2;
    parts.push(`<rect x="${gx}" y="${wy - EDGE / 2}" width="${grip}" height="${EDGE}" class="elev-wall-top" data-elev-op="wall-top"/>`);
    parts.push(`<rect x="${wx + ww / 2 - HANDLE}" y="${wy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-t elev-wall-top-handle" data-elev-op="wall-top"/>`);
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

  // Clearance back to the wall, only while a corner is being placed or an
  // edge is being dragged. A side move is the horizontal gap; a top or bottom
  // move is the vertical gap; a corner draws both.
  drawFinishLocate(parts, model, locate, xOf, yOf, W, H);

  if (interactive) {
    parts.push(`<text x="${wx + ww / 2}" y="${Math.min(H - 3, yOf(model.base) + 12)}" text-anchor="middle" class="elev-dim">${mm(model.length)}</text>`);
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

  const label = `Wall elevation, ${mm(model.length)} long, ${mm(model.height)} high, ${model.openings.length} opening${model.openings.length === 1 ? "" : "s"}`;
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
