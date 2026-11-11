// Which storey a plan cut should ghost. The canvas still edits only the
// active level; this answers "what sits immediately below" so walls on an
// upper floor can be aligned to the footprint they sit on, and "what sits
// immediately above" so a foundation plan can see the walls it carries.

import { unplacePage } from "./sheet-set.js";

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

// What "Show only this level" keeps. The neighbour ghost is never part of
// this cut. The tracing sheet stays: Hide sheet is how it leaves the plan.
// A floor or foundation plan keeps the whole storey. A ceiling plan keeps
// the ceiling and the walls it sits in. A roof plan keeps the roof: the
// walls and floors of that storey are the floor plan, and leaving them up
// is what reads as another level.

const CEILING_CUT_ROLES = new Set(["ceiling", "wall", "opening", "beam", "line"]);
const ROOF_CUT_ROLES = new Set(["roof"]);

/**
 * Whether `role` is drawn while "Show only this level" is on.
 * `stationKind` is the house-rail cut: "floor", "foundation", "ceiling", "roof".
 * Roles: floor, ceiling, roof, room, wall, beam, line, opening, item,
 * ghost, underlay, site.
 */
export function isolateShows(stationKind, role) {
  if (role === "ghost") return false;
  if (role === "site" || role === "underlay") return true;
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
  const revealed = floorsShown(levels, floorsRevealed);
  const shown = new Set(storeys.slice(0, 1 + revealed).map((l) => l.id));
  return all.filter((l) => l.elevation < 0 || l.userSupplied || shown.has(l.id));
}

/** How many template storeys above the ground floor are actually on screen.
 * A counter past the cap, or past what the template defines, still only
 * shows the storeys `visibleLevels` would. */
export function floorsShown(levels, floorsRevealed) {
  return Math.max(0, Math.min(floorsRevealed || 0, MAX_FLOORS_TO_ADD, floorsAvailableToAdd(levels)));
}

/** The template storey "+ Add floor" most recently put on screen, or null
 * when the switcher is still ground floor and foundation only. */
export function topRevealedStorey(levels, floorsRevealed) {
  const n = floorsShown(levels, floorsRevealed);
  if (n < 1) return null;
  return templateStoreyLevels(levels)[n] || null;
}

/** True while Remove floor has a template storey it can hide. The ground
 * floor and the foundation are never one of those. */
export function canRemoveFloor(levels, floorsRevealed) {
  return topRevealedStorey(levels, floorsRevealed) != null;
}

/** `floorsRevealed` after one Remove floor. A counter stuck above the cap
 * drops to the storey actually on screen, then hides that one. */
export function floorsRevealedAfterRemove(levels, floorsRevealed) {
  return Math.max(0, floorsShown(levels, floorsRevealed) - 1);
}

/** The storey Remove floor would take, plus any split level hanging off it.
 * An inserted level you are standing on wins: that is the one you can see.
 * Otherwise it is the top storey "+ Add floor" revealed. Null when neither
 * exists — the ground floor and the foundation are not removable. */
export function floorRemovalTarget(levels, floorsRevealed, { activeLevelId } = {}) {
  const active = (levels || []).find((l) => l.id === activeLevelId);
  if (active?.userSupplied) {
    return {
      kind: "inserted",
      level: active,
      levelIds: levelAndSplits(levels, active.id),
      nextRevealed: floorsRevealed || 0,
    };
  }
  const level = topRevealedStorey(levels, floorsRevealed);
  if (!level) return null;
  return {
    kind: "revealed",
    level,
    levelIds: levelAndSplits(levels, level.id),
    nextRevealed: floorsRevealedAfterRemove(levels, floorsRevealed),
  };
}

function levelAndSplits(levels, id) {
  const ids = [id];
  for (const level of levels || []) {
    if (level.parentId === id && level.id !== id) ids.push(level.id);
  }
  return ids;
}

const FLOOR_OWNED = [
  ["segments", "wall", "walls"],
  ["rooms", "room", "rooms"],
  ["slabs", "floor slab", "floor slabs"],
  ["roofs", "roof", "roofs"],
  ["openings", "opening", "openings"],
  ["beams", "beam", "beams"],
  ["stairs", "staircase", "staircases"],
  ["lines", "line", "lines"],
  ["separations", "room separation", "room separations"],
  ["regions", "region", "regions"],
  ["finishRegions", "floor finish", "floor finishes"],
  ["finishRuns", "wall finish", "wall finishes"],
  ["items", "placed item", "placed items"],
  ["dimensions", "dimension", "dimensions"],
  ["revisionClouds", "revision cloud", "revision clouds"],
  ["serviceNodes", "service point", "service points"],
];

function tally(n, one, many) {
  if (!n) return null;
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function belongsTo(ids, obj) {
  return ids.has(obj?.level);
}

/**
 * Work that would disappear with these levels. Openings, finishes and
 * fittings count with the wall or slab they sit on, even when their own
 * level says something else. A sheet is counted apart from `gone`: it
 * leaves the plan and stays in the sheet list.
 */
export function floorWork(doc, levels, levelIds) {
  const ids = new Set(levelIds || []);
  const primary = levelIds?.[0];
  const walls = new Set((doc?.segments || []).filter((row) => belongsTo(ids, row)).map((row) => row.id));
  const slabs = new Set((doc?.slabs || []).filter((row) => belongsTo(ids, row)).map((row) => row.id));
  const gone = [];
  const countOf = (key) => {
    const rows = doc?.[key] || [];
    if (key === "openings") return rows.filter((row) => walls.has(row.wallId) || belongsTo(ids, row)).length;
    if (key === "finishRuns") return rows.filter((row) => walls.has(row.wallId) || belongsTo(ids, row)).length;
    if (key === "items") return rows.filter((row) => walls.has(row.wallId) || slabs.has(row.slabId) || belongsTo(ids, row)).length;
    if (key === "finishRegions") return rows.filter((row) => slabs.has(row.slabId) || belongsTo(ids, row)).length;
    if (key === "serviceNodes") return rows.filter((row) => belongsTo(ids, row)).length;
    return rows.filter((row) => belongsTo(ids, row)).length;
  };
  for (const [key, one, many] of FLOOR_OWNED) {
    const phrase = tally(countOf(key), one, many);
    if (phrase) gone.push(phrase);
  }
  const sheets = (doc?.sheetSet?.pages || []).filter((page) => ids.has(page.levelId)).length;
  const splits = (levels || [])
    .filter((level) => ids.has(level.id) && level.id !== primary)
    .map((level) => level.name || level.id);
  const ceiling = (levelIds || []).some((id) => Number.isFinite(doc?.sheetSet?.ceilingHeights?.[id]));
  const elevation = (levelIds || []).some((id) => Number.isFinite(doc?.levelElevations?.[id]));
  return {
    empty: gone.length === 0 && sheets === 0 && splits.length === 0 && !ceiling && !elevation,
    gone,
    sheets,
    splits,
    ceiling,
    elevation,
  };
}

function removalJoin(parts) {
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The question Remove floor asks when the storey is not empty. */
export function floorRemovalMessage(name, work) {
  const sentences = [];
  if (work?.gone?.length) sentences.push(`${removalJoin(work.gone)} on it will be deleted.`);
  if (work?.sheets) {
    sentences.push(work.sheets === 1
      ? "1 sheet comes off this floor and stays in the sheet list."
      : `${work.sheets} sheets come off this floor and stay in the sheet list.`);
  }
  if (work?.splits?.length) {
    sentences.push(work.splits.length === 1
      ? `${work.splits[0]} is a split of this floor and is removed with it.`
      : `${removalJoin(work.splits)} are splits of this floor and are removed with it.`);
  }
  if (work?.ceiling) sentences.push("The ceiling height you typed for it is cleared.");
  if (work?.elevation) sentences.push("The elevation you typed for it is cleared.");
  sentences.push("The ground floor stays.");
  return sentences.join(" ");
}

/**
 * Hide the top added floor, or delete an inserted level, and take the work
 * on it with it. Mutates `doc`. A revealed template storey is not deleted
 * from the pack — `floorsRevealed` drops so the switcher stops offering it.
 * An inserted level is removed from `doc.levels`. Sheets are unplaced, not
 * thrown out of the file.
 */
export function applyFloorRemoval(doc, target) {
  if (!doc || !target?.levelIds?.length) return doc;
  const ids = new Set(target.levelIds);
  const walls = new Set((doc.segments || []).filter((row) => belongsTo(ids, row)).map((row) => row.id));
  const slabs = new Set((doc.slabs || []).filter((row) => belongsTo(ids, row)).map((row) => row.id));
  const removedIds = new Set([...walls, ...slabs]);
  const take = (key, extra = () => false) => {
    if (!Array.isArray(doc[key])) return;
    const stay = [];
    for (const row of doc[key]) {
      if (!belongsTo(ids, row) && !extra(row)) stay.push(row);
      else if (row?.id) removedIds.add(row.id);
    }
    doc[key] = stay;
  };
  for (const key of ["rooms", "segments", "slabs", "roofs", "beams", "stairs", "lines", "separations", "regions", "dimensions", "revisionClouds"]) {
    take(key);
  }
  take("openings", (row) => walls.has(row.wallId));
  take("finishRuns", (row) => walls.has(row.wallId));
  take("finishRegions", (row) => slabs.has(row.slabId));
  take("items", (row) => walls.has(row.wallId) || slabs.has(row.slabId));
  const nodeIds = new Set((doc.serviceNodes || []).filter((row) => belongsTo(ids, row)).map((row) => row.id));
  for (const id of nodeIds) removedIds.add(id);
  if (nodeIds.size) {
    doc.serviceEdges = (doc.serviceEdges || []).filter((edge) => !nodeIds.has(edge.fromNode) && !nodeIds.has(edge.toNode));
    doc.serviceNodes = doc.serviceNodes.filter((row) => !nodeIds.has(row.id));
    const live = new Set(doc.serviceNodes.map((row) => row.networkId));
    doc.serviceNetworks = (doc.serviceNetworks || []).filter((row) => live.has(row.id));
  }
  if (Array.isArray(doc.groups)) {
    doc.groups = doc.groups
      .map((group) => ({ ...group, members: (group.members || []).filter((member) => !removedIds.has(member.id)) }))
      .filter((group) => group.members.length >= 2);
  }
  if (Array.isArray(doc.levels)) doc.levels = doc.levels.filter((level) => !ids.has(level.id));
  if (doc.levelElevations) {
    for (const id of ids) delete doc.levelElevations[id];
  }
  const set = doc.sheetSet;
  if (set) {
    for (const page of set.pages || []) {
      if (!ids.has(page.levelId)) continue;
      if (page.placement) unplacePage(set, page.index);
      else page.levelId = null;
    }
    if (set.ceilingHeights) {
      for (const id of ids) delete set.ceilingHeights[id];
    }
    if (set.activeByLevel) {
      for (const id of ids) delete set.activeByLevel[id];
    }
  }
  if (target.kind === "revealed") doc.floorsRevealed = target.nextRevealed;
  return doc;
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
 * a wall never tops out against them. A split level looks above its parent
 * storey: a wall on a -170 step still runs up to the next floor.
 */
export function levelAboveRise(levels, levelId) {
  const ordered = orderedLevels(levels);
  const self = ordered.find((l) => l.id === levelId);
  if (!self || !Number.isFinite(self.elevation)) return null;
  const parent = self.parentId ? ordered.find((l) => l.id === self.parentId) : null;
  const floor = Number.isFinite(parent?.elevation) ? Math.max(parent.elevation, self.elevation) : self.elevation;
  const above = ordered.find(
    (l) => l.elevation > floor + 1e-6 && !isReferenceLevel(l) && !l.parentId
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
      elevation: roofEavesElevation(top),
      label: "Roof · eaves",
    });
  }
  return out;
}

/** How far the roof-eaves cut sits above the top of the top storey, so the
 * tick is not on the same line as that storey's floor-to-floor. A floor the
 * user places on this cut uses the same height. */
export const ROOF_EAVES_LIFT_M = 0.12;

/** Absolute elevation of the "Roof · eaves" cut for `level`, in metres.
 * A storey with no floor-to-floor still gets the lift, so the cut stays a
 * selectable height instead of disappearing. */
export function roofEavesElevation(level) {
  if (!Number.isFinite(level?.elevation)) return null;
  const rise = Number.isFinite(level.floorToFloor) ? level.floorToFloor : 0;
  return level.elevation + rise + ROOF_EAVES_LIFT_M;
}

// --- Active cut panel: names, heights and rail labels ---------------------

const ORDINAL_FLOORS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];

/** The Revit-style abbreviation spelled out; anything else stays as typed. */
function spelledLevelName(text) {
  if (/^(GFL|GF|GROUND(\s+FLOOR)?)$/i.test(text)) return "Ground floor";
  if (/^(FOUNDATIONS?|FDN|FND)$/i.test(text)) return "Foundation";
  const storey = /^L(\d+)$/i.exec(text);
  if (storey && ORDINAL_FLOORS[Number(storey[1]) - 1]) return `${ORDINAL_FLOORS[Number(storey[1]) - 1]} floor`;
  return text;
}

/**
 * A level's name for the Active cut panel: the leading number as a muted
 * code, and the rest spelled out ("01 GFL" -> { code: "01", name: "Ground floor" }).
 * Display only: ids and the names used elsewhere are untouched.
 */
export function levelDisplayName(level) {
  const raw = String(level?.name || level?.id || "").trim();
  const m = /^(\d{1,3})\s+(.+)$/.exec(raw);
  return m ? { code: m[1], name: spelledLevelName(m[2]) } : { code: "", name: spelledLevelName(raw) };
}

/** `{ code, name }` for a station from `buildHouseStations`. */
export function stationDisplay(station, levels) {
  if (station?.kind === "roof") return { code: "", name: "Roof · eaves" };
  const level = (levels || []).find((l) => l.id === station?.levelId) || { id: station?.levelId };
  const { code, name } = levelDisplayName(level);
  if (station?.kind === "ceiling") return { code, name: `${name} · ceiling` };
  if (station?.kind === "floor") return { code, name: `${name} · floor` };
  return { code, name };
}

/** Metres as whole mm with a thin-space thousands separator and a true minus; `signed` adds "+". */
export function sectionMm(metres, signed = false) {
  if (!Number.isFinite(metres)) return "—";
  const mm = Math.round(metres * 1000);
  const abs = String(Math.abs(mm)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  if (mm < 0) return `\u2212${abs}`;
  if (signed && mm > 0) return `+${abs}`;
  return abs;
}

/**
 * Where each rail label sits. A label stays level with its tick unless that
 * would put it closer than `gap` to its neighbour; then the labels spread
 * out and a leader joins each one back to its tick. `ideal` is in drawing
 * order (any order); the result is in the same order.
 */
export function railLabelYs(ideal, gap, top, bottom) {
  const order = ideal.map((_, i) => i).sort((a, b) => ideal[a] - ideal[b]);
  const ys = new Array(ideal.length);
  order.forEach((i, k) => {
    ys[i] = k === 0 ? Math.max(top, ideal[i]) : Math.max(ideal[i], ys[order[k - 1]] + gap);
  });
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const limit = k === order.length - 1 ? bottom : ys[order[k + 1]] - gap;
    ys[i] = Math.min(ys[i], limit);
  }
  return ys;
}

/**
 * Whether a slice of the panel's section stays at full strength while "Show
 * only this cut" is on. Mirrors `isolateShows`: a roof cut keeps the roof, a
 * ceiling cut keeps that storey's ceiling and walls, a floor or foundation
 * cut keeps its storey but not the roof. `part` is `{ level, role }`, with
 * `level` the storey the slice belongs to and `planLevelId` the plan on screen.
 */
export function sectionPartShown(stationKind, planLevelId, part) {
  const role = part?.role;
  if (stationKind === "roof") return role === "roof";
  if (part?.level !== planLevelId) return false;
  if (stationKind === "ceiling") return role === "ceiling" || role === "wall";
  return role !== "roof";
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
