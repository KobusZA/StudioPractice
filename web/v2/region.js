// Filled region: ink on the drawing, not a floor slab and not a schedule row.
//
// The three names are the template's own filled regions (TEMPLATE-ASKS.md).
// The template export did not include their RGB, so the fill below is only
// how this screen paints that name. A region with no convention yet is an
// outline: unknown stays null rather than defaulting to one of the three.

export const REGION_CONVENTIONS = [
  { id: "BRICK RED", fill: "rgba(166, 74, 59, 0.45)", stroke: "#8a3b2e" },
  { id: "CONCRETE", fill: "rgba(120, 120, 116, 0.4)", stroke: "#5c5c58" },
  { id: "CONCRETE 2", fill: "rgba(186, 184, 176, 0.55)", stroke: "#8a877e" },
];

const IDS = new Set(REGION_CONVENTIONS.map((c) => c.id));

export function regionConvention(id) {
  return REGION_CONVENTIONS.find((c) => c.id === id) || null;
}

/** Drop an unrecognised name rather than painting a colour nobody named. */
export function knownConvention(id) {
  return IDS.has(id) ? id : null;
}
