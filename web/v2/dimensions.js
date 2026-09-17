// Overall and per-room dimension strings, plus a two-point pick used by
// Document -> Annotate -> Dimensions. Bounding-box based for the automatic
// overlay; the pick is just the distance between the two clicks.
//
// Bounding-box based, matching the marquee selection's existing simplification
// (see ui.js's refsInMarquee comment): exact for the rectangles and rectangle
// unions the week-1 UI can draw, an honest over-estimate for a free polygon's
// overall extent rather than a wrong exact-looking number. Pure geometry, no
// canvas or DOM, so it is testable on its own.

const ROOM_OFFSET = 0.25; // metres, how far a per-room dimension line sits off the room
const OVERALL_OFFSET = 0.7; // metres, further out so it never overlaps a room string

function fmt(v) {
  return `${v.toFixed(2)} m`;
}

/** One horizontal + one vertical dimension line for a box, offset outward (below and left of it). */
export function boxDimensionLines(box, offset) {
  if (!box || box.w <= 0 || box.h <= 0) return [];
  return [
    {
      kind: "h",
      x1: box.x, y1: box.y - offset,
      x2: box.x + box.w, y2: box.y - offset,
      extFrom: [[box.x, box.y], [box.x + box.w, box.y]],
      label: fmt(box.w),
    },
    {
      kind: "v",
      x1: box.x - offset, y1: box.y,
      x2: box.x - offset, y2: box.y + box.h,
      extFrom: [[box.x, box.y], [box.x, box.y + box.h]],
      label: fmt(box.h),
    },
  ];
}

export function unionBox(boxes) {
  const real = boxes.filter((b) => b && b.w > 0 && b.h > 0);
  if (!real.length) return null;
  const x0 = Math.min(...real.map((b) => b.x));
  const y0 = Math.min(...real.map((b) => b.y));
  const x1 = Math.max(...real.map((b) => b.x + b.w));
  const y1 = Math.max(...real.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * One dimension pair per room bounding box, plus one overall pair around the
 * union of all of them. `boxes` is the active level's rooms only - slabs and
 * roofs commonly overhang the room layout, which would make "overall" mean
 * the roof rather than the building the customer actually dimensions.
 */
export function planDimensionLines(boxes) {
  const lines = [];
  for (const box of boxes) lines.push(...boxDimensionLines(box, ROOM_OFFSET));
  const overall = unionBox(boxes);
  if (overall) {
    for (const line of boxDimensionLines(overall, OVERALL_OFFSET)) lines.push({ ...line, overall: true });
  }
  return lines;
}

/**
 * A string between two picked points. Null when the clicks are the same
 * place, so the UI can ask for the other end instead of drawing 0.00 m.
 */
export function pickedDimension(a, b) {
  if (!a || !b) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return null;
  return {
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    length,
    label: fmt(length),
  };
}
