// Filled region: ink on the drawing, not a floor slab and not a schedule row.
// The ribbon calls it Fill.
//
// The first three names are the template's own filled regions
// (TEMPLATE-ASKS.md). The template export did not include their RGB, so the
// fill below is only how this screen paints that name. Hatch, Crosshatch and
// Masking are ours: a hatch is lines at `hatch` degrees, `spacingMm` paper
// millimetres apart, and Masking is opaque white that hides what is under it.
// A region saved with no convention is an outline: unknown stays null rather
// than defaulting to one of these.

export const REGION_CONVENTIONS = [
  { id: "BRICK RED", label: "Brick red", fill: "rgba(166, 74, 59, 0.45)", stroke: "#8a3b2e" },
  { id: "CONCRETE", label: "Concrete", fill: "rgba(120, 120, 116, 0.4)", stroke: "#5c5c58" },
  { id: "CONCRETE 2", label: "Concrete 2", fill: "rgba(186, 184, 176, 0.55)", stroke: "#8a877e" },
  { id: "HATCH", label: "Hatch", fill: null, stroke: "#4a4540", hatch: [45], spacingMm: 1.5 },
  { id: "CROSSHATCH", label: "Crosshatch", fill: null, stroke: "#4a4540", hatch: [45, -45], spacingMm: 1.5 },
  { id: "MASKING", label: "Masking", fill: "#ffffff", stroke: null, masking: true },
];

export const DEFAULT_REGION_CONVENTION = "CONCRETE 2";

const IDS = new Set(REGION_CONVENTIONS.map((c) => c.id));

export function regionConvention(id) {
  return REGION_CONVENTIONS.find((c) => c.id === id) || null;
}

/** Drop an unrecognised name rather than painting a colour nobody named. */
export function knownConvention(id) {
  return IDS.has(id) ? id : null;
}

/**
 * Hatch lines across a screen-space bounding box, `spacing` pixels apart at
 * `angleDeg`. The caller clips to the region, so the lines only need to
 * cover the box. Each line is [x1, y1, x2, y2].
 */
export function hatchLines(box, angleDeg, spacing) {
  if (!(spacing > 0)) return [];
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy;
  const ny = dx;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2 + spacing;
  const count = Math.min(2000, Math.ceil(reach / spacing));
  const out = [];
  for (let i = -count; i <= count; i += 1) {
    const ox = cx + nx * i * spacing;
    const oy = cy + ny * i * spacing;
    out.push([ox - dx * reach, oy - dy * reach, ox + dx * reach, oy + dy * reach]);
  }
  return out;
}
