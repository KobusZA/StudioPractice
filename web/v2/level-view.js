// Which storey a plan cut should ghost. The canvas still edits only the
// active level; this answers "what sits immediately below" so walls on an
// upper floor can be aligned to the footprint they sit on.

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
