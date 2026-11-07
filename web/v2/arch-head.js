// The curve of an arched opening. Kept apart from openings.js so the wall
// elevation, which is loaded on its own address, cannot keep drawing a
// semicircle from an older copy of that file.

/**
 * Rise of the head, metres: the crown above the springing line. A missing or
 * non-positive rise is a semicircle (half the width). A circular head that
 * springs from both jambs cannot rise past that.
 */
export function archRise(width, rise) {
  const cap = Math.max(0, Number(width) || 0) / 2;
  if (!(cap > 0)) return 0;
  const asked = Number(rise);
  if (!Number.isFinite(asked) || asked <= 0) return cap;
  return Math.min(asked, cap);
}

/** Radius of the circular head, metres. */
export function archRadius(width, rise) {
  const w = Math.max(0, Number(width) || 0);
  const h = archRise(w, rise);
  if (!(h > 0) || !(w > 0)) return 0;
  return ((w / 2) ** 2 + h * h) / (2 * h);
}

/** The height stays at least the rise, so the crown still fits in the opening. */
export function fitArchSize(width, height, rise) {
  const w = Math.max(0, Number(width) || 0);
  const r = archRise(w, rise);
  return { width: w, height: Math.max(Number(height) || 0, r), rise: r };
}

/** Area of a circular segment of this span and rise. A semicircle is π r² / 2. */
export function archSegmentArea(width, rise) {
  const h = archRise(width, rise);
  const radius = archRadius(width, h);
  if (!(h > 0) || !(radius > 0)) return 0;
  const drop = radius - h;
  const root = Math.sqrt(Math.max(0, 2 * radius * h - h * h));
  const cos = Math.min(1, Math.max(-1, drop / radius));
  return radius * radius * Math.acos(cos) - drop * root;
}

/**
 * The void of an arched opening. `rect` is `{ from, to, bottom, top }` in
 * wall coordinates, and an optional `rise`. The head is a circular arc
 * spanning `to - from`. With no rise, the arc is a semicircle.
 */
export function archVoidPolygon(rect, steps = 8) {
  const from = rect.from;
  const to = rect.to;
  const bottom = rect.bottom;
  const top = rect.top;
  const width = Math.max(0, to - from);
  const rise = Math.min(archRise(width, rect.rise), Math.max(0, top - bottom));
  const spring = top - rise;
  const cx = (from + to) / 2;
  const radius = archRadius(width, rise);
  const cy = spring - (radius - rise);
  const pts = [];
  if (spring - bottom > 1e-6) pts.push([from, bottom]);
  pts.push([from, spring]);
  const n = Math.max(2, steps);
  let a0 = Math.atan2(spring - cy, from - cx);
  let a1 = Math.atan2(spring - cy, to - cx);
  if (a0 < 0) a0 += Math.PI * 2;
  if (a1 < 0) a1 += Math.PI * 2;
  if (a1 > a0) a1 -= Math.PI * 2;
  for (let i = 1; i < n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  pts.push([to, spring]);
  if (spring - bottom > 1e-6) pts.push([to, bottom]);
  return pts;
}
