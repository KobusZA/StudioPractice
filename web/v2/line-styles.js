// Document > Annotate > Line: how a drawn line looks.
//
// On the plan a weight is screen pixels, so a heavy line stays heavy at any
// zoom, the way Revit's thin-lines-off view reads. On a sheet the weight and
// the dashes are paper millimetres, so a line prints the same at 1:50 and
// 1:100.
//
// Whether a line is exported to the DXF and IFC is its `kind` (model.js
// LINE_KINDS), not its style: a dashed line can be a modelled edge too.

export const LINE_STYLES = [
  { id: "thin", label: "Thin", planWidth: 1, planDash: [], weightMm: 0.18, dashMm: [] },
  { id: "medium", label: "Medium", planWidth: 1.8, planDash: [], weightMm: 0.35, dashMm: [] },
  { id: "heavy", label: "Heavy", planWidth: 2.8, planDash: [], weightMm: 0.5, dashMm: [] },
  { id: "dashed", label: "Dashed", planWidth: 1, planDash: [6, 4], weightMm: 0.25, dashMm: [3, 1.5] },
  { id: "hidden", label: "Hidden", planWidth: 1, planDash: [3, 3], weightMm: 0.18, dashMm: [1.2, 0.8] },
  { id: "centre", label: "Centre", planWidth: 1, planDash: [12, 3, 2, 3], weightMm: 0.18, dashMm: [6, 1.2, 1, 1.2] },
];

export const DEFAULT_LINE_STYLE = "thin";

const BY_ID = new Map(LINE_STYLES.map((s) => [s.id, s]));

/** The saved name, or null when it is not one of ours. */
export function knownLineStyle(id) {
  return BY_ID.has(id) ? id : null;
}

/**
 * How a line draws. A line saved before there were styles keeps the look it
 * had: an annotation line was dashed, a model line thin and solid.
 */
export function lineStyleOf(line) {
  return BY_ID.get(line?.style) || BY_ID.get(line?.kind === "annotation" ? "dashed" : DEFAULT_LINE_STYLE);
}

/** Width and dashes on a sheet, in pixels, given the sheet's pixels per paper millimetre. */
export function sheetLineStroke(style, pxPerMm) {
  return {
    width: Math.max(0.6, style.weightMm * pxPerMm),
    dash: style.dashMm.map((d) => d * pxPerMm),
  };
}

/** What one Place Line pick makes: a line (or a run of them), a rectangle, or an arc. */
export const LINE_SHAPES = ["line", "rect", "arc"];

/** Which ends carry an arrowhead. */
export const LINE_ARROWS = ["none", "start", "end", "both"];

/** The saved arrow setting, or null for none. */
export function knownLineArrow(value) {
  return value === "start" || value === "end" || value === "both" ? value : null;
}

/** A line's arc as saved, kept only when its radius is a usable number. */
export function cleanLineArc(raw) {
  if (!raw || !(raw.radius > 0) || !Number.isFinite(raw.radius)) return null;
  if (raw.side !== 1 && raw.side !== -1) return null;
  return { radius: raw.radius, side: raw.side, ...(raw.major === true ? { major: true } : {}) };
}

/** The four sides of a rectangle between two opposite corners, in drawing order. */
export function rectangleSides(a, b) {
  const c = [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]];
  return c.map((p, i) => {
    const q = c[(i + 1) % 4];
    return { x1: p[0], y1: p[1], x2: q[0], y2: q[1] };
  });
}

/**
 * Where to draw arrowheads: each is a tip and the unit direction it points
 * in. An arc's head follows the tangent at its end.
 */
export function lineArrowHeads(line, arc = null) {
  const arrow = knownLineArrow(line?.arrow);
  if (!arrow) return [];
  const heads = [];
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return heads;
  let startDir = { x: -dx / len, y: -dy / len };
  let endDir = { x: dx / len, y: dy / len };
  if (arc) {
    const turn = arc.sweep >= 0 ? 1 : -1;
    const a1 = arc.a0 + arc.sweep;
    startDir = { x: Math.sin(arc.a0) * turn, y: -Math.cos(arc.a0) * turn };
    endDir = { x: -Math.sin(a1) * turn, y: Math.cos(a1) * turn };
  }
  if (arrow === "start" || arrow === "both") heads.push({ x: line.x1, y: line.y1, dir: startDir });
  if (arrow === "end" || arrow === "both") heads.push({ x: line.x2, y: line.y2, dir: endDir });
  return heads;
}
