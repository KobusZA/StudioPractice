// Placement-vs-cut warnings. The ribbon hint names a mismatch the pack already
// states. It does not invent a storey for an ordinary wall or room. A
// foundation is the exception: the pack's below-datum level is where one
// belongs, so the hint names that storey, and the UI moves the cut there when
// Foundations is armed. Switching back is still allowed; Check then lists any
// foundation left on another storey.

/** True if `level` is a below-datum (foundation-kind) storey. */
export function isFoundationLevel(level) {
  return Number.isFinite(level?.elevation) && level.elevation < 0 && !level.parentId;
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
 * The storey a foundation belongs on: the below-datum level closest to the
 * datum, which is the one directly under the ground floor. Null when the
 * pack has no foundation storey - a foundation then stays on the cut that
 * is active, because there is nowhere else to put it.
 */
export function foundationStorey(levels) {
  let best = null;
  for (const level of levels || []) {
    if (!isFoundationLevel(level)) continue;
    if (!best || level.elevation > best.elevation) best = level;
  }
  return best;
}

/**
 * Drawn foundations sitting on a storey that is not below datum, when a
 * foundation storey exists to put them on. `items` are `{ id, label, levelId }`.
 */
export function foundationsOffStorey(items, levels) {
  const home = foundationStorey(levels);
  if (!home) return [];
  const homeName = home.name || home.id;
  const rows = [];
  for (const item of items || []) {
    const level = (levels || []).find((l) => l.id === item.levelId);
    if (isFoundationLevel(level)) continue;
    const where = level?.name || level?.id || item.levelId || "another storey";
    rows.push({
      id: item.id,
      levelId: item.levelId,
      message: `${item.label} is on "${where}". It belongs on "${homeName}".`,
    });
  }
  return rows;
}

/**
 * Warning copy for an armed placement tool against the current cut, or null
 * when the tool/cut pair is not something the app can rule out.
 *
 * @param {{ tool: string, stationKind: string | null | undefined, level: { id?: string, name?: string, elevation?: number } | null | undefined, levels?: { id?: string, name?: string, elevation?: number }[] | null | undefined, categories: string[] | null | undefined }} args
 */
export function placementHintOverride({ tool, stationKind, level, levels, categories }) {
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

  // A foundation on an ordinary floor plan. Only when the pack actually has
  // a foundation storey - otherwise there is no other plan to send them to.
  if (categories.every((c) => c === "foundation") && !isFoundationLevel(level)) {
    const home = foundationStorey(levels);
    if (home) {
      const name = home.name || home.id;
      return `A foundation belongs on "${name}". Switch to that plan before placing it here.`;
    }
  }

  return null;
}
