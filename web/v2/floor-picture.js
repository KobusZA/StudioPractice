// The floor picture drawn in the wall elevation's strip. Zoom, pan and the
// shared-patch mark are the wall's: this only supplies the floor's polygons
// in the same fitted frame (plan x, and z = −plan y, so the elevation's
// upward axis shows the plan the same way up).

import { pointInPoly } from "./geom.js";
import { finishSwatch } from "./finish-data.js";
import { ELEVATION_SNAP, snapElevation } from "./wall-elevation.js";
import { appendAlignLines, appendCoatMarks, appendFinishLocate, appendMeasureLabel, edgeResizeCursor, elevationPlacement } from "./wall-elevation-render.js";

const PAD = 28;
const HANDLE = 5;

/** Screed is the base. The others go on top of it, in this order. */
export const FLOOR_TYPE_GROUPS = [
  { label: "Base — what the floor is made of", ids: ["screed"] },
  { label: "Applied finish — goes on top of the screed", ids: ["floorTile", "timberFloor", "vinyl", "carpet", "waterproofing"] },
];

/** One selected room or slab opens the picture. Anything else asks for one. */
export function resolveFloorFinishOpen(selected) {
  if (!Array.isArray(selected) || selected.length !== 1) return { open: false };
  const ref = selected[0];
  if (!ref || (ref.kind !== "room" && ref.kind !== "slab")) return { open: false };
  return { open: true, host: { kind: ref.kind, id: ref.id } };
}

/** Screed under everything else. Equal ranks keep the order they were drawn. */
export function floorStackRank(category) {
  return category === "screed" ? 1 : 2;
}

/**
 * The floor as a face: plan x runs along, and z runs up the picture.
 * z is 0 at the bottom of the floor's box and `height` at the top, so the
 * wall's clearance (`finishLocate`, typed gaps) measures this box.
 */
export function floorFaceOf(host) {
  const ring = (host || []).filter((p) => p?.length >= 2);
  if (ring.length < 3) return { minX: 0, maxX: 1, minY: 0, maxY: 1, length: 1, height: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    length: Math.max(maxX - minX, 0.01),
    height: Math.max(maxY - minY, 0.01),
  };
}

/** Plan point, in the floor face. `s` is across, `z` is up the picture. */
export function planToFace(x, y, face) {
  return { s: x - face.minX, z: face.maxY - y };
}

/** Face point back on the plan. */
export function faceToPlan(s, z, face) {
  return { x: face.minX + s, y: face.maxY - z };
}

/**
 * Snap a plan point to the floor's box and to other corners, the way a wall
 * corner snaps to the face. `targets` are plan points. `guideS` and `guideZ`
 * are face coordinates, and null when that axis did not land on a target.
 */
export function alignFloorPoint(x, y, face, targets = []) {
  const sTargets = [0, face.length];
  const zTargets = [0, face.height];
  for (const point of targets) {
    if (!point || point.length < 2) continue;
    const local = planToFace(point[0], point[1], face);
    sTargets.push(local.s);
    zTargets.push(local.z);
  }
  const raw = planToFace(x, y, face);
  const axis = (value, hi, list) => {
    let next = snapElevation(value);
    let guide = null;
    let best = ELEVATION_SNAP * 2;
    for (const target of list) {
      const d = Math.abs(next - target);
      if (d <= best) { next = target; best = d; guide = target; }
    }
    next = Math.min(hi, Math.max(0, next));
    if (guide != null && Math.abs(guide - next) > 1e-6) guide = null;
    return { value: next, guide };
  };
  const s = axis(raw.s, face.length, sTargets);
  const z = axis(raw.z, face.height, zTargets);
  const plan = faceToPlan(s.value, z.value, face);
  return { x: plan.x, y: plan.y, guideS: s.guide, guideZ: z.guide };
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

function toView(poly) {
  return poly.map(([x, y]) => [x, -y]);
}

function centroid(poly) {
  const n = poly.length || 1;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

/** A point on the finish that is not buried under a finish drawn above it. */
function labelAt(poly, above) {
  const c = centroid(poly);
  const clear = (x, y) => pointInPoly(x, y, poly) && !above.some((other) => pointInPoly(x, y, other));
  if (clear(c[0], c[1])) return c;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const p = [(a[0] + b[0]) / 2 * 0.65 + c[0] * 0.35, (a[1] + b[1]) / 2 * 0.65 + c[1] * 0.35];
    if (clear(p[0], p[1])) return p;
  }
  return c;
}

function rgba(hex, alpha) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return `rgba(196, 165, 116, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * @param {object} spec
 * @param {number[][]} spec.host plan polygon
 * @param {{id:string,category:string,label:string,fill:string,poly:number[][],areaText:string,coversHost?:boolean}[]} spec.regions
 *  bottom to top: screed first
 * @param {boolean} [spec.preview] inspector card: finish colours only. Names, areas
 *  and the stack pile stay on the open picture. The finish polygons stay clickable.
 * @param {{s:?number,z:?number}} [spec.guides] face-space alignment, the wall's dashed lines
 * @param {object} [spec.locate] a `finishLocate` result, plus `typeable` and `typing`
 * @returns {{svg:string, fit:object, scaleX:number, scaleY:number, originX:number, originY:number, minX:number}}
 */
export function floorPictureSvg({
  width,
  height,
  host,
  regions = [],
  selectedId = null,
  view = null,
  draft = null,
  edgeMode = "line",
  name = "This floor",
  preview = false,
  guides = null,
  locate = null,
} = {}) {
  const W = Math.max(80, Math.round(width || 0));
  const H = Math.max(60, Math.round(height || 0));
  const ring = Array.isArray(host) ? host.filter((p) => p?.length >= 2) : [];
  const emptyFit = { scaleX: 1, scaleY: 1, originX: 0, originY: 0, top: 0, spanX: 1, spanY: 1 };
  if (ring.length < 3) {
    return { svg: "", fit: emptyFit, scaleX: 1, scaleY: 1, originX: 0, originY: 0, minX: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const consider = (poly) => {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  consider(ring);
  for (const region of regions) if (region.poly?.length >= 3) consider(region.poly);
  const spanX = Math.max(maxX - minX, 0.1);
  const spanY = Math.max(maxY - minY, 0.1);
  const fitScaleX = Math.max(1e-3, (W - PAD * 2) / spanX);
  const fitScaleY = Math.max(1e-3, (H - PAD * 2) / spanY);
  // The frame is the floor, the same way a wall's frame is the face.
  // originX is the left of that floor, not the plan's zero. A room that
  // sits away from the origin would otherwise be clamped off the picture.
  const fit = {
    scaleX: fitScaleX,
    scaleY: fitScaleY,
    originX: PAD,
    originY: PAD - minY * fitScaleY,
    top: PAD,
    spanX: spanX * fitScaleX,
    spanY: spanY * fitScaleY,
  };
  const placed = elevationPlacement(fit, view);
  const scaleX = placed.scaleX;
  const scaleY = placed.scaleY;
  const originX = placed.originX;
  const originY = placed.originY;
  const xOf = (s) => originX + (s - minX) * scaleX;
  const yOf = (z) => originY - z * scaleY;
  const face = floorFaceOf(ring);
  // Face s runs across the floor's box, face z up the picture. The box is the
  // host only, so a finish that sticks out does not move the clearances.
  const xFace = (s) => originX + (face.minX + s - minX) * scaleX;
  const yFace = (z) => originY + (face.maxY - z) * scaleY;
  const screen = (poly) => poly.map(([x, y]) => [xOf(x), yOf(-y)]);
  const ptsAttr = (poly) => screen(poly).map(([x, y]) => `${x},${y}`).join(" ");

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="elev-bg"/>`);
  parts.push(`<polygon points="${ptsAttr(ring)}" class="elev-floor-host"/>`);

  const drawn = regions.filter((region) => region.poly?.length >= 3);
  for (const region of drawn) {
    const colour = region.fill || finishSwatch(region.category);
    parts.push(`<polygon points="${ptsAttr(region.poly)}" fill="${rgba(colour, 0.72)}" class="elev-band" data-floor-fill="${esc(region.id)}"/>`);
  }
  parts.push(`<polygon points="${ptsAttr(ring)}" fill="none" class="elev-floor-outline"/>`);

  const coatModel = {
    base: 0,
    finishBands: drawn.map((region) => ({
      source: "run",
      category: region.category,
      unit: "m2",
      outline: toView(region.poly),
      fill: region.fill || finishSwatch(region.category),
      label: region.label,
      stackRank: floorStackRank(region.category),
    })),
  };
  if (!preview) appendCoatMarks(parts, coatModel, xOf, yOf);

  if (!preview) drawn.forEach((region, index) => {
    const above = drawn.slice(index + 1).map((other) => other.poly);
    const [lx, ly] = labelAt(region.poly, above);
    const [sx, sy] = screen([[lx, ly]])[0];
    const on = region.id === selectedId ? " is-selected" : "";
    parts.push(`<text x="${sx}" y="${sy}" text-anchor="middle" class="elev-floor-name${on}">${esc(region.label)}</text>`);
    if (region.areaText) {
      parts.push(`<text x="${sx}" y="${sy + 16}" text-anchor="middle" class="elev-floor-area${on}">${esc(region.areaText)}</text>`);
    }
  });

  const selected = drawn.find((region) => region.id === selectedId);
  if (selected && !draft) {
    parts.push(`<polygon points="${ptsAttr(selected.poly)}" class="elev-floor-select"/>`);
    const poly = selected.poly;
    const adding = edgeMode !== "line";
    let longest = null;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const [x1, y1] = screen([a])[0];
      const [x2, y2] = screen([b])[0];
      const cursor = edgeResizeCursor(x1, y1, x2, y2);
      const edgeClass = `elev-outline-edge is-${cursor}${adding ? " is-add" : ""}`;
      const title = adding ? "Add a corner" : "Resize this edge";
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${edgeClass}" data-floor-edge="${i}"><title>${title}</title></line>`);
      const metres = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!longest || metres > longest.metres) longest = { x1, y1, x2, y2, metres };
    }
    if (longest) appendMeasureLabel(parts, longest.x1, longest.y1, longest.x2, longest.y2, longest.metres);
    poly.forEach(([x, y], i) => {
      const [sx, sy] = screen([[x, y]])[0];
      parts.push(`<rect x="${sx - HANDLE}" y="${sy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle" data-floor-vertex="${i}"/>`);
    });
  }

  if (draft?.points?.length) {
    const draftPts = draft.points.map((p) => [p.x, p.y]);
    if (draft.hover) draftPts.push([draft.hover.x, draft.hover.y]);
    const attr = draftPts.map(([x, y]) => `${xOf(x)},${yOf(-y)}`).join(" ");
    parts.push(`<polyline points="${attr}" class="elev-draft"/>`);
    for (const p of draft.points) {
      parts.push(`<circle cx="${xOf(p.x)}" cy="${yOf(-p.y)}" r="3.5" class="elev-draft-pt"/>`);
    }
  }

  if (!preview) {
    appendAlignLines(parts, guides, xFace, yFace, W, H);
    appendFinishLocate(parts, locate, xFace, yFace, W, H);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}" class="elev-svg">${parts.join("")}</svg>`;
  return { svg, fit, scaleX, scaleY, originX, originY, minX };
}
