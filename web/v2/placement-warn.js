// Placement-vs-cut warnings. The ribbon hint names the one thing the app can
// rule out; it never guesses which storey the object belongs on, and it never
// moves the level switcher.

/** True if `level` is a below-datum (foundation-kind) storey. */
export function isFoundationLevel(level) {
  return Number.isFinite(level?.elevation) && level.elevation < 0;
}

/** Categories that belong on a foundation storey: the foundation itself and
 * a boundary wall (a property-line fact, not tied to a storey). Everything
 * else - rooms, floors, ceilings, roofs, openings, services - is the
 * "ordinary walls, rooms and ceilings underground" mistake. */
export const FOUNDATION_OK_CATEGORIES = new Set(["foundation", "boundarywall"]);

/** A ceiling or roof cut is a view of the owning storey, not a place to draw
 * something that sits on the floor or in the ground. Walls stay allowed
 * (same storey, different view, which is how Revit works). Foundations and
 * floor slabs on that cut are never the right place to work. */
const WRONG_ON_CEILING_OR_ROOF = new Set(["foundation", "floor", "pool"]);

function cutPhrase(stationKind) {
  if (stationKind === "ceiling") return "ceiling plan";
  if (stationKind === "roof") return "roof plan";
  if (stationKind === "foundation") return "foundation plan";
  return "floor plan";
}

/**
 * Warning copy for an armed placement tool against the current cut, or null
 * when the tool/cut pair is not something the app can rule out.
 *
 * @param {{ tool: string, stationKind: string | null | undefined, level: { id?: string, name?: string, elevation?: number } | null | undefined, categories: string[] | null | undefined }} args
 */
export function placementHintOverride({ tool, stationKind, level, categories }) {
  if (tool === "select" || !categories?.length) return null;

  if (isFoundationLevel(level) && categories.some((c) => !FOUNDATION_OK_CATEGORIES.has(c))) {
    const name = level?.name || level?.id || "this level";
    return `The level switcher is on "${name}", a foundation storey. Switch levels before placing this here.`;
  }

  if (
    (stationKind === "ceiling" || stationKind === "roof")
    && categories.some((c) => WRONG_ON_CEILING_OR_ROOF.has(c))
  ) {
    const what = categories.includes("foundation") ? "a foundation" : "this";
    return `The cut is a ${cutPhrase(stationKind)}. Switch to a floor or foundation plan before placing ${what} here.`;
  }

  return null;
}
