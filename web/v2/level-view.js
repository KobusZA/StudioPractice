// Which storey a plan cut should ghost. The canvas still edits only the
// active level; this answers "what sits immediately below" so walls on an
// upper floor can be aligned to the footprint they sit on, and "what sits
// immediately above" so a foundation plan can see the walls it carries.

function orderedLevels(levels) {
  const list = Array.isArray(levels) ? levels : [];
  if (!list.every((l) => Number.isFinite(l.elevation))) return list;
  return [...list].sort((a, b) => a.elevation - b.elevation);
}

/** A reference level (e.g. NGL) is drawn in elevations and checks, but it is
 * not a storey and not a cut, so it never counts as a neighbour. */
export function isReferenceLevel(level) {
  return level?.kind === "reference";
}

function cutLevels(levels) {
  return orderedLevels(levels).filter((l) => !isReferenceLevel(l));
}

/** The storey immediately below `activeId`, or null at the bottom of the stack. */
export function lookDownLevelId(levels, activeId) {
  const ordered = cutLevels(levels);
  const i = ordered.findIndex((l) => l.id === activeId);
  if (i <= 0) return null;
  return ordered[i - 1].id;
}

/** The storey immediately above `activeId`, or null at the top of the stack. */
export function lookUpLevelId(levels, activeId) {
  const ordered = cutLevels(levels);
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

// What "Show only this level" keeps. The neighbour ghost and the tracing
// sheet are never part of this cut. A floor or foundation plan keeps the
// whole storey. A ceiling plan keeps the ceiling and the walls it sits in.
// A roof plan keeps the roof: the walls and floors of that storey are the
// floor plan, and leaving them up is what reads as another level.

const CEILING_CUT_ROLES = new Set(["ceiling", "wall", "opening", "beam", "line"]);
const ROOF_CUT_ROLES = new Set(["roof"]);

/**
 * Whether `role` is drawn while "Show only this level" is on.
 * `stationKind` is the house-rail cut: "floor", "foundation", "ceiling", "roof".
 * Roles: floor, ceiling, roof, room, wall, beam, line, opening, item,
 * ghost, underlay, site.
 */
export function isolateShows(stationKind, role) {
  if (role === "ghost" || role === "underlay") return false;
  if (role === "site") return true;
  if (stationKind === "roof") return ROOF_CUT_ROLES.has(role);
  if (stationKind === "ceiling") return CEILING_CUT_ROLES.has(role);
  return true;
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
  return cutLevels(levels).filter((l) => l.elevation >= 0 && !l.parentId);
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
      message: `"${sameHeight.name || sameHeight.id}" is already at ${Math.round(elevation * 1000)} mm; two levels cannot share an elevation.`,
    };
  }

  const parentId = spec?.parentId || null;
  if (parentId) {
    if (spec?.kind === "reference") return { ok: false, message: "A reference level is not a storey, so it has no parent storey." };
    const parent = (levels || []).find((l) => l.id === parentId);
    if (!parent) return { ok: false, message: `The parent storey "${parentId}" does not exist.` };
    if (parent.parentId || isReferenceLevel(parent)) {
      return { ok: false, message: `"${parent.name || parent.id}" is itself a split or reference level; pick a full storey as the parent.` };
    }
  }

  return { ok: true, message: `${name} at ${Math.round(elevation * 1000)} mm.` };
}

// --- Split levels ---------------------------------------------------------

/** The level whose plan draws `levelId`'s objects: its parent storey if it
 * has one, else itself. */
export function planLevelOf(levels, levelId) {
  const level = (levels || []).find((l) => l.id === levelId);
  return level?.parentId || levelId;
}

/** True if an object on `objLevelId` appears on the plan of `planLevelId`
 * (its own level, or a split level that names it as parent). */
export function onPlanOf(levels, objLevelId, planLevelId) {
  return objLevelId === planLevelId || planLevelOf(levels, objLevelId) === planLevelId;
}

/** "FFL -0.150" for a split level, relative to its parent storey's floor; null otherwise. */
export function fflLabel(levels, levelId) {
  const level = (levels || []).find((l) => l.id === levelId);
  const parent = level?.parentId && (levels || []).find((l) => l.id === level.parentId);
  if (!parent || !Number.isFinite(level.elevation) || !Number.isFinite(parent.elevation)) return null;
  const rel = level.elevation - parent.elevation;
  const sign = rel < 0 ? "\u2212" : rel > 0 ? "+" : "";
  return `FFL ${sign}${Math.abs(rel).toFixed(3)}`;
}

// --- Wall tops follow the level above -------------------------------------

/**
 * Height from `levelId`'s floor to the next storey above it, or null when
 * there is none (top storey). Reference and split levels are not storeys, so
 * a wall never tops out against them.
 */
export function levelAboveRise(levels, levelId) {
  const ordered = orderedLevels(levels);
  const self = ordered.find((l) => l.id === levelId);
  if (!self || !Number.isFinite(self.elevation)) return null;
  const above = ordered.find(
    (l) => l.elevation > self.elevation + 1e-6 && !isReferenceLevel(l) && !l.parentId
  );
  return above ? above.elevation - self.elevation : null;
}

/** "level-above" when a wall type of `height` is a full storey on `levelId`
 * (its height equals the level's floor-to-floor); otherwise null, meaning the
 * type's own height stands. */
export function defaultWallTop(levels, levelId, height) {
  const level = (levels || []).find((l) => l.id === levelId);
  if (!Number.isFinite(height) || !Number.isFinite(level?.floorToFloor)) return null;
  if (Math.abs(level.floorToFloor - height) > 1e-6) return null;
  return levelAboveRise(levels, levelId) === null ? null : "level-above";
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
      ...(spec.kind === "reference" ? { kind: "reference" } : {}),
      ...(spec.parentId && spec.kind !== "reference" ? { parentId: spec.parentId } : {}),
    },
  ];
}

// --- Edit a level's elevation per job -----------------------------------
//
// `doc.levelElevations[levelId] = metres` lays over the template (or
// inserted) level, like `sheetSet.ceilingHeights`. The pack is never mutated.

/** Overlay per-job elevations on a level list (new objects, input untouched). */
export function applyLevelElevations(levels, overrides) {
  if (!overrides || !Object.keys(overrides).length) return levels;
  return levels.map((l) => (Number.isFinite(overrides[l.id]) ? { ...l, elevation: overrides[l.id] } : l));
}

/**
 * Whether `levelId` may move to `metres`, one message per cause. `levels` is
 * the stack as currently seen (overrides already applied).
 */
export function validateLevelEdit(levels, levelId, metres) {
  const ordered = orderedLevels(levels);
  const i = ordered.findIndex((l) => l.id === levelId);
  if (i < 0) return { ok: false, message: "That level no longer exists." };
  const raw = metres === null || metres === undefined || String(metres).trim() === "" ? NaN : Number(metres);
  if (!Number.isFinite(raw)) return { ok: false, message: "Enter the elevation in millimetres, e.g. 3000." };
  const label = (l) => l.name || l.id;
  const mm = Math.round(raw * 1000);
  const same = ordered.find((l) => l.id !== levelId && Math.abs(l.elevation - raw) < 1e-6);
  if (same) return { ok: false, message: `"${label(same)}" is already at ${mm} mm; two levels cannot share an elevation.` };
  const below = ordered[i - 1];
  if (below && raw < below.elevation) {
    return { ok: false, message: `${mm} mm is below "${label(below)}" (${Math.round(below.elevation * 1000)} mm); a level cannot pass the one under it.` };
  }
  const above = ordered[i + 1];
  if (above && raw > above.elevation) {
    return { ok: false, message: `${mm} mm is above "${label(above)}" (${Math.round(above.elevation * 1000)} mm); a level cannot pass the one over it.` };
  }
  return { ok: true, message: `${label(ordered[i])} at ${mm} mm.` };
}

/** Return the new `levelElevations` map with `levelId` set (or cleared on null). Pure. */
export function setLevelElevation(overrides, levelId, metres) {
  const next = { ...(overrides || {}) };
  if (metres === null) delete next[levelId];
  else next[levelId] = Number(metres);
  return next;
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
  const list = (Array.isArray(levels) ? levels : []).filter((l) => !isReferenceLevel(l));
  const out = [];
  list.forEach((level, i) => {
    const isFoundation = Number.isFinite(level.elevation) && level.elevation < 0 && !level.parentId;
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
