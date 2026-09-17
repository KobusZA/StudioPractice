// Which storey a plan cut should ghost. The canvas still edits only the
// active level; this answers "what sits immediately below" so walls on an
// upper floor can be aligned to the footprint they sit on, and "what sits
// immediately above" so a foundation plan can see the walls it carries.

function orderedLevels(levels) {
  const list = Array.isArray(levels) ? levels : [];
  if (!list.every((l) => Number.isFinite(l.elevation))) return list;
  return [...list].sort((a, b) => a.elevation - b.elevation);
}

/** The storey immediately below `activeId`, or null at the bottom of the stack. */
export function lookDownLevelId(levels, activeId) {
  const ordered = orderedLevels(levels);
  const i = ordered.findIndex((l) => l.id === activeId);
  if (i <= 0) return null;
  return ordered[i - 1].id;
}

/** The storey immediately above `activeId`, or null at the top of the stack. */
export function lookUpLevelId(levels, activeId) {
  const ordered = orderedLevels(levels);
  const i = ordered.findIndex((l) => l.id === activeId);
  if (i < 0 || i >= ordered.length - 1) return null;
  return ordered[i + 1].id;
}

/**
 * Which neighbouring storey the plan should ghost, and which way we are
 * looking. Look-down wins: that is the Revit default and the usual case
 * (align this floor to the one it sits on). Look-up is only the fallback
 * when nothing sits below — a foundation cut, whose walls live on the
 * ground floor above it.
 */
export function ghostContext(levels, activeId) {
  const down = lookDownLevelId(levels, activeId);
  if (down) return { levelId: down, look: "down" };
  const up = lookUpLevelId(levels, activeId);
  if (up) return { levelId: up, look: "up" };
  return null;
}

// --- "+ Add floor": how many template storeys the level switcher shows ----
//
// A new document (or one that has never touched this) shows only the
// ground floor and its foundation - "waiting, like a new Revit project" -
// even against a four-level TSP pack that also defines 02 L1 and 03 L2.
// ui.js's "+ Add floor" ribbon command reveals one more already-defined
// template storey at a time, up to MAX_FLOORS_TO_ADD. It never creates a
// level; "Insert level" (below) is the command for a storey the template
// does not define.

/** A product decision, not something derived from the template: at most two
 * storeys above the ground floor may ever be revealed, even against a pack
 * that defines more than two. */
export const MAX_FLOORS_TO_ADD = 2;

/** Non-foundation storeys, bottom to top - the ones "+ Add floor" reveals
 * one at a time. A foundation (elevation < 0) is never counted as a
 * "floor" here; it is always part of the level switcher regardless of how
 * many storeys are revealed. */
export function storeyLevels(levels) {
  return orderedLevels(levels).filter((l) => l.elevation >= 0);
}

/** The subset of `storeyLevels` that "+ Add floor" is about: storeys the
 * template itself defines. A level the user inserted is never something to
 * reveal - it exists because they asked for it - so it neither consumes a
 * reveal slot nor raises the count of storeys still on offer. */
function templateStoreyLevels(levels) {
  return storeyLevels(levels).filter((l) => !l.userSupplied);
}

/** How many storeys the template actually offers beyond the ground floor -
 * the real ceiling on "+ Add floor" once it is lower than MAX_FLOORS_TO_ADD. */
export function floorsAvailableToAdd(levels) {
  return Math.max(0, templateStoreyLevels(levels).length - 1);
}

/** True while "+ Add floor" still has a template storey left to reveal and
 * has not hit its own cap. */
export function canAddFloor(levels, floorsRevealed) {
  return (floorsRevealed || 0) < Math.min(MAX_FLOORS_TO_ADD, floorsAvailableToAdd(levels));
}

/**
 * Levels the switcher actually offers for a given `floorsRevealed`: every
 * foundation-kind level (always shown), the ground floor, and one more
 * storey per `floorsRevealed` on top of that, capped at MAX_FLOORS_TO_ADD.
 * A fresh document or a single-storey template therefore shows exactly
 * "roof, ground floor, foundation" - never every storey a shared
 * multi-storey template happens to define.
 */
export function visibleLevels(levels, floorsRevealed) {
  const all = orderedLevels(levels);
  const storeys = templateStoreyLevels(all);
  if (!storeys.length) return all;
  const revealed = Math.max(0, Math.min(floorsRevealed || 0, MAX_FLOORS_TO_ADD));
  const shown = new Set(storeys.slice(0, 1 + revealed).map((l) => l.id));
  return all.filter((l) => l.elevation < 0 || l.userSupplied || shown.has(l.id));
}

// --- "Insert level": storeys the user supplies ---------------------------
//
// PHILOSOPHY.md's second principle: the template defines the defaults, not
// the limits. The TSP template names four storeys, and "+ Add floor" reveals
// the ones it already defines; a builder doing a third storey, a split level
// or a different floor-to-floor supplies their own instead. An elevation the
// user types is a supplied fact, not a guess, so nothing here conflicts with
// "unknown is null" - and `floorToFloor`/`floorToCeiling` stay null on an
// inserted level precisely because the user was not asked for them.
//
// A user level lives on the document (`doc.levels`), never on the pack: the
// pack is regenerated from the template by build-pack.js, so writing into it
// would be overwritten on the next export and would also mean one firm's job
// could edit the shared catalog. The two stacks are merged for reading only.

/** The full level stack a document sees: the template's levels plus the ones
 * this document inserted, bottom to top. */
export function mergedLevels(packLevels, docLevels) {
  return orderedLevels([...(packLevels || []), ...(docLevels || [])]);
}

/**
 * Whether `spec` may be inserted into `levels`, with one distinct message per
 * cause (this codebase's convention - see modify.js). Deliberately absent: any
 * cap on how many levels a document may have. The template's count is a
 * default, and a storey limit would be exactly the kind of invented constraint
 * PHILOSOPHY.md exists to prevent.
 */
export function validateLevelInsert(levels, spec) {
  const name = String(spec?.name ?? "").trim();
  if (!name) return { ok: false, message: "Name the level, e.g. 03 L2." };

  const key = name.toLowerCase();
  const clash = (levels || []).find(
    (l) => String(l.id).toLowerCase() === key || String(l.name ?? "").toLowerCase() === key
  );
  if (clash) return { ok: false, message: `A level called "${clash.name || clash.id}" already exists.` };

  // `Number("")` is 0, so a blank field would otherwise read as ground level.
  const elevation = String(spec?.elevation ?? "").trim() === "" ? NaN : Number(spec.elevation);
  if (!Number.isFinite(elevation)) {
    return { ok: false, message: "Enter the level's elevation in metres above the ground floor, e.g. 6." };
  }

  // Two levels at one elevation is the same problem compile.js's floor/ceiling
  // split already solves by offsetting a ceiling: two elements on one level
  // cannot share an elevation, so two levels cannot either.
  const sameHeight = (levels || []).find((l) => Number.isFinite(l.elevation) && Math.abs(l.elevation - elevation) < 1e-6);
  if (sameHeight) {
    return {
      ok: false,
      message: `"${sameHeight.name || sameHeight.id}" is already at ${elevation} m; two levels cannot share an elevation.`,
    };
  }

  return { ok: true, message: `${name} at ${elevation} m.` };
}

/**
 * Append a user-supplied level to `docLevels` and return the new array. Pure -
 * the caller pushes undo and persists. `floorToFloor` and `floorToCeiling` are
 * null, not derived from the neighbouring storeys: a level's spacing is not the
 * same fact as its ceiling build-up, and guessing it would put an optimistic
 * number into the Part C height check (SCHEMA.md's open decision 1).
 */
export function insertLevel(docLevels, spec) {
  const name = String(spec.name).trim();
  return [
    ...(docLevels || []),
    {
      id: name,
      name,
      elevation: Number(spec.elevation),
      floorToFloor: null,
      floorToCeiling: null,
      userSupplied: true,
    },
  ];
}

// --- Active-cut stations (floor / ceiling / roof) ------------------------
//
// The house widget, keyboard paging and the inspector all have to name the
// same cuts. Building them here keeps the inspector from falling back to
// `pack.levels` (every template storey, no ceiling/roof) while the rail
// shows only the revealed stack.

/**
 * One floor station per level (foundation-kind below datum), plus a ceiling
 * station where the level states one, plus a synthetic roof station above
 * the top level. Each carries the id of the real level it belongs to:
 * editing is still per-level; ceiling/roof cuts are a richer read of where
 * that level's rail position falls physically.
 */
export function buildHouseStations(levels) {
  const list = Array.isArray(levels) ? levels : [];
  const out = [];
  list.forEach((level, i) => {
    const isFoundation = Number.isFinite(level.elevation) && level.elevation < 0;
    const name = level.name || level.id;
    out.push({
      id: `${level.id}::floor`,
      levelId: level.id,
      levelIndex: i,
      kind: isFoundation ? "foundation" : "floor",
      elevation: level.elevation,
      label: isFoundation ? name : `${name} · floor`,
    });
    // A foundation storey's floorToCeiling is never a measurement of that
    // storey itself (see build-pack.js's ceilingOffsetsByLevel) - it is
    // either null or the offset borrowed from whichever storey actually has
    // ceilings placed, which reads back as a fabricated "foundation
    // ceiling" rather than a real station. Suppress it here instead of
    // teaching build-pack.js to lie about the fact being unmeasured.
    if (!isFoundation && Number.isFinite(level.floorToCeiling)) {
      out.push({
        id: `${level.id}::ceiling`,
        levelId: level.id,
        levelIndex: i,
        kind: "ceiling",
        elevation: level.elevation + level.floorToCeiling,
        label: `${name} · ceiling`,
      });
    }
  });
  const top = list[list.length - 1];
  if (top) {
    out.push({
      id: "roof",
      levelId: top.id,
      levelIndex: list.length - 1,
      kind: "roof",
      elevation: top.elevation + top.floorToFloor + 0.12,
      label: "Roof · eaves",
    });
  }
  return out;
}

/**
 * Stations the inspector lists for an object: the same cuts the switcher
 * offers, plus a floor station for the object's current storey if that
 * storey is not yet revealed. Without the extra row, an object on 02 L1
 * before "+ Add floor" would have nowhere in the dropdown that matches
 * where it actually sits.
 */
export function inspectorStations(stations, levels, objectLevelId) {
  const list = Array.isArray(stations) ? stations : [];
  if (!objectLevelId || list.some((s) => s.levelId === objectLevelId)) return list;
  const extra = orderedLevels(levels).find((l) => l.id === objectLevelId);
  if (!extra) return list;
  const extraFloor = buildHouseStations([extra]).filter((s) => s.kind !== "roof");
  return [...list, ...extraFloor].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
}

/**
 * Which inspector option is selected. Prefer the active cut when it belongs
 * to the object's storey (so a ceiling plan does not read as "01 GFL · floor"
 * while the rail is on the ceiling); otherwise the storey's floor/foundation
 * station.
 */
export function selectedInspectorStationId(stations, objectLevelId, activeStationId) {
  const list = Array.isArray(stations) ? stations : [];
  const active = list.find((s) => s.id === activeStationId);
  if (active && active.levelId === objectLevelId) return active.id;
  const host = list.find((s) => s.levelId === objectLevelId && (s.kind === "floor" || s.kind === "foundation"));
  return host?.id || list.find((s) => s.levelId === objectLevelId)?.id || "";
}
