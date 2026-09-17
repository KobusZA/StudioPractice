// Plan-view construction lines for a pitched roof, and the form/ridge
// helpers the 3D massing already needs so the ridge you see on the canvas
// is the same ridge extruded in Output > 3D.
//
// The footprint is an axis-aligned rect: that is everything the week-1 UI
// can draw, and what massing.js already reduces a free polygon to before
// folding it. Flat roofs have no guides.

export const ROOF_FORMS = ["flat", "gable", "shed", "hip"];
export const DEFAULT_ROOF_PITCH = 30;

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
export function roofGuideLines(rect, form, ridge) {
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
    // gable
    lines = alongX
      ? [line(x, y + h / 2, x + w, y + h / 2, "ridge")]
      : [line(x + w / 2, y, x + w / 2, y + h, "ridge")];
  }

  return lines.filter((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 1e-6);
}
