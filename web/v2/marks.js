// Window and door marks: how an opening is identified on the drawings and in
// the schedules. Never by its size.
//
// A window carries a type mark (W1, W2, ...). Every window with the same mark
// is the same product at the same width and height, so a size change applies
// to the whole type; to change one window on its own it is first split off as
// a new type. Sill height is per window, not part of the type.
//
// A door carries its own number (D1, D2, ...), unique on the job, because each
// door is scheduled on its own (hand, ironmongery, fire rating).
//
// The mark lives on the opening row (`opening.mark`) and stays put when the
// opening is moved or resized, so a mark issued on a drawing keeps meaning the
// same opening.

import { pointInPoly } from "./geom.js";
import { roomPolygon } from "./model.js";
import { openingSize, skuById, wallNormal } from "./openings.js";

export const MARK_PREFIX = { window: "W", door: "D" };

const MAX_MARK_LENGTH = 12;

/** "window" or "door" for an opening that carries a mark, otherwise null. */
export function markKind(pack, opening) {
  const category = skuById(pack, opening?.sku)?.category;
  return category === "window" || category === "door" ? category : null;
}

const mm = (metres) => Math.round((Number(metres) || 0) * 1000);
const markKey = (mark) => String(mark || "").trim().toUpperCase();

/** What makes two windows the same type: the product and its width and height. */
export function windowSignature(pack, opening) {
  const size = openingSize(pack, opening);
  return `${opening.sku}|${mm(size.width)}|${mm(size.height)}`;
}

function markNumber(mark, prefix) {
  const match = new RegExp(`^${prefix}(\\d+)$`, "i").exec(String(mark || "").trim());
  return match ? Number(match[1]) : null;
}

function marked(doc, pack) {
  return (doc.openings || [])
    .map((opening) => ({ opening, kind: markKind(pack, opening) }))
    .filter((row) => row.kind);
}

/** The next unused number for a window or door mark: one past the highest in use. */
export function nextMark(doc, pack, kind) {
  const prefix = MARK_PREFIX[kind];
  let top = 0;
  for (const { opening } of marked(doc, pack)) {
    const n = markNumber(opening.mark, prefix);
    if (n && n > top) top = n;
  }
  return `${prefix}${top + 1}`;
}

/** Every window carrying this mark. */
export function windowsOfMark(doc, pack, mark) {
  const key = markKey(mark);
  if (!key) return [];
  return marked(doc, pack)
    .filter((row) => row.kind === "window" && markKey(row.opening.mark) === key)
    .map((row) => row.opening);
}

/**
 * The mark a newly placed opening should carry: an existing window type of the
 * same product and size, or the next free number.
 */
export function markForNewOpening(doc, pack, opening) {
  const kind = markKind(pack, opening);
  if (!kind) return null;
  if (kind === "window") {
    const signature = windowSignature(pack, opening);
    const twin = marked(doc, pack).find((row) => row.kind === "window"
      && row.opening !== opening
      && row.opening.mark
      && windowSignature(pack, row.opening) === signature);
    if (twin) return twin.opening.mark;
  }
  return nextMark(doc, pack, kind);
}

/**
 * Give every window and door a mark, and repair what breaks the rules: a door
 * number used twice, or a window mark shared by windows of different products
 * or sizes. Openings that already carry a valid mark keep it. Returns true when
 * anything changed.
 */
export function ensureOpeningMarks(doc, pack) {
  const taken = new Map();
  const pending = [];
  for (const { opening, kind } of marked(doc, pack)) {
    const key = markKey(opening.mark);
    const held = taken.get(key);
    if (!key) { pending.push({ opening, kind }); continue; }
    if (kind === "door") {
      if (held) { pending.push({ opening, kind }); continue; }
      taken.set(key, { kind });
      continue;
    }
    const signature = windowSignature(pack, opening);
    if (held && (held.kind !== "window" || held.signature !== signature)) {
      pending.push({ opening, kind });
      continue;
    }
    taken.set(key, { kind, signature, mark: opening.mark });
  }
  if (!pending.length) return false;

  const top = { window: 0, door: 0 };
  for (const key of taken.keys()) {
    for (const kind of ["window", "door"]) {
      const n = markNumber(key, MARK_PREFIX[kind]);
      if (n && n > top[kind]) top[kind] = n;
    }
  }
  for (const { opening, kind } of pending) {
    if (kind === "window") {
      const signature = windowSignature(pack, opening);
      const twin = [...taken.values()].find((row) => row.kind === "window" && row.signature === signature);
      if (twin) {
        opening.mark = twin.mark;
        continue;
      }
    }
    top[kind] += 1;
    opening.mark = `${MARK_PREFIX[kind]}${top[kind]}`;
    taken.set(markKey(opening.mark), kind === "window"
      ? { kind, signature: windowSignature(pack, opening), mark: opening.mark }
      : { kind });
  }
  return true;
}

/**
 * Carry one window's width and height to every other window of its type.
 * Returns how many other windows changed.
 */
export function shareWindowSize(doc, pack, openingId) {
  const opening = (doc.openings || []).find((o) => o.id === openingId);
  if (!opening || markKind(pack, opening) !== "window" || !opening.mark) return 0;
  let count = 0;
  for (const other of windowsOfMark(doc, pack, opening.mark)) {
    if (other === opening) continue;
    if (other.width === opening.width && other.height === opening.height) continue;
    other.width = opening.width;
    other.height = opening.height;
    count += 1;
  }
  return count;
}

/** Split one window off its type as a new type of its own. Returns the new mark. */
export function splitWindowType(doc, pack, opening) {
  if (markKind(pack, opening) !== "window") return null;
  opening.mark = nextMark(doc, pack, "window");
  return opening.mark;
}

/**
 * Windows whose product just changed. A whole type changed together keeps its
 * mark; part of a type, or a type that now matches another, is re-marked.
 */
export function remarkRetypedWindows(doc, pack, ids) {
  const changed = new Set(ids);
  const groups = new Map();
  for (const { opening, kind } of marked(doc, pack)) {
    if (kind !== "window" || !changed.has(opening.id) || !opening.mark) continue;
    const key = markKey(opening.mark);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(opening);
  }
  for (const [key, group] of groups) {
    const stay = windowsOfMark(doc, pack, key).filter((o) => !changed.has(o.id));
    const signatures = new Set(group.map((o) => windowSignature(pack, o)));
    const keep = stay.length
      ? signatures.size === 1 && signatures.has(windowSignature(pack, stay[0]))
      : signatures.size === 1;
    if (!keep) for (const opening of group) delete opening.mark;
  }
  ensureOpeningMarks(doc, pack);
}

/**
 * Rename the mark on a window type (all its windows) or on one door.
 * A door number must be unique. A window may take another type's mark only
 * when the two are the same product and size, which joins them.
 */
export function renameMark(doc, pack, opening, raw) {
  const kind = markKind(pack, opening);
  if (!kind) return { ok: false, message: "Only windows and doors carry a mark." };
  const next = String(raw ?? "").trim();
  const noun = kind === "window" ? "window" : "door";
  if (!next) return { ok: false, message: `A ${noun} needs a mark.` };
  if (next.length > MAX_MARK_LENGTH) return { ok: false, message: `Keep the mark to ${MAX_MARK_LENGTH} characters.` };
  if (markKey(next) === markKey(opening.mark)) {
    opening.mark = next;
    return { ok: true, message: "", count: 1 };
  }
  const members = kind === "window" ? windowsOfMark(doc, pack, opening.mark) : [opening];
  const clash = marked(doc, pack).filter((row) => markKey(row.opening.mark) === markKey(next) && !members.includes(row.opening));
  if (clash.length) {
    const other = clash[0];
    if (kind === "door" || other.kind === "door") {
      return { ok: false, message: `${next} is already used by another ${other.kind}.` };
    }
    if (windowSignature(pack, other.opening) !== windowSignature(pack, opening)) {
      return { ok: false, message: `${next} is a different window type. Only a window of the same product and size can share its mark.` };
    }
  }
  for (const member of members) member.mark = next;
  return { ok: true, message: "", count: members.length };
}

function compareMarks(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** "D1–D3, D5" from ["D2", "D1", "D3", "D5"]: sorted, with runs closed up. */
export function formatMarks(marks) {
  const unique = [...new Set((marks || []).filter(Boolean))].sort(compareMarks);
  const parts = [];
  let run = null;
  const close = () => {
    if (!run) return;
    parts.push(run.from === run.to ? run.fromMark : `${run.fromMark}–${run.toMark}`);
    run = null;
  };
  for (const mark of unique) {
    const match = /^([A-Za-z]+)(\d+)$/.exec(mark);
    if (!match) {
      close();
      parts.push(mark);
      continue;
    }
    const prefix = match[1];
    const n = Number(match[2]);
    if (run && run.prefix === prefix && n === run.to + 1) {
      run.to = n;
      run.toMark = mark;
      continue;
    }
    close();
    run = { prefix, from: n, to: n, fromMark: mark, toMark: mark };
  }
  close();
  return parts.join(", ");
}

export { compareMarks };

const SIZE_IN_NAME = /\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*mm/i;

/**
 * The type name with the opening's actual size in it. Catalogue names carry
 * the catalogue size ("Window-Fixed — 600 x 900mm"), which a resized opening
 * no longer has.
 */
export function sizedTypeName(sku, size) {
  const name = String(sku?.name || "").trim();
  if (!Number.isFinite(size?.width) || !Number.isFinite(size?.height)) return name;
  const text = `${mm(size.width)} x ${mm(size.height)}mm`;
  if (SIZE_IN_NAME.test(name)) return name.replace(SIZE_IN_NAME, text);
  return name ? `${name} ${text}` : text;
}

/**
 * Side caption for a type whose name is already on screen. A size or makeup
 * the name already states is dropped, so the inspector does not print
 * "950 x 1400mm" and "950 × 1400 mm" on the same row. A size the name does
 * not carry stays. "Multiple sizes" stays. An arched head the name omits
 * stays as those two words.
 */
export function captionBesideName(name, meta) {
  const caption = String(meta || "").trim();
  if (!caption) return "";
  if (/^multiple sizes$/i.test(caption)) return caption;
  const title = String(name || "").toLowerCase().replace(/×/g, "x");
  const folded = caption.toLowerCase().replace(/×/g, "x");
  if (title.includes(folded)) return "";
  const figures = caption.match(/\d+(?:\.\d+)?/g) || [];
  const sharesFigure = figures.some((n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(title));
  if (!sharesFigure) return caption;
  if (/arched head/i.test(caption) && !title.includes("arched")) return "arched head";
  return "";
}

/**
 * Which side of the wall an opening's mark is drawn on, as a unit normal. A
 * door's tag sits away from its swing; a window's on the side outside every
 * room on its storey, so it reads on the elevation side of the plan.
 */
export function markSide(doc, wall, placed, opening, kind) {
  if (kind === "door") return wallNormal(wall, -(opening?.swing || 1));
  const mid = { x: (placed.a.x + placed.b.x) / 2, y: (placed.a.y + placed.b.y) / 2 };
  const reach = (wall.thickness || 0.22) / 2 + 0.25;
  const rooms = (doc?.rooms || []).filter((room) => (room.level ?? null) === (wall.level ?? null) || !room.level || !wall.level);
  for (const sign of [1, -1]) {
    const n = wallNormal(wall, sign);
    const px = mid.x + n.x * reach;
    const py = mid.y + n.y * reach;
    if (!rooms.some((room) => pointInPoly(px, py, roomPolygon(room)))) return n;
  }
  return wallNormal(wall, 1);
}
