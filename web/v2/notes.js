// Document > Annotate > Text, and the appearance of every word on the drawing.
//
// A note's words are the user's: nothing here derives or checks them. What is
// shared is appearance. Every note, and every placed dimension's label, names
// a text style and may override single properties of it on that one object,
// the way a Revit text type plus an instance override works. Only the
// properties that differ are stored, so changing the style changes every
// object that has not overridden that property.
//
// Sizes are paper millimetres. A 2.5 mm note prints 2.5 mm high on a 1:50
// and on a 1:100 sheet; the plan on screen reads as PLAN_TEXT_SCALE until a
// view carries its own scale.
//
// Pure: no canvas, no DOM, no imports from model.js (model.js imports this).

import { formatLengthMm } from "./geom.js";

export const PLAN_TEXT_SCALE = 100;

export const TEXT_ALIGNS = ["left", "center", "right"];

export const TEXT_FONTS = ["Source Sans 3", "Arial", "Courier New"];

/** The colours offered as swatches. Anything else goes through Custom. */
export const STANDARD_COLOURS = [
  { hex: "#1a1612", name: "Black" },
  { hex: "#5c5c58", name: "Dark grey" },
  { hex: "#9a968e", name: "Light grey" },
  { hex: "#b2451e", name: "Red" },
  { hex: "#2f5d8a", name: "Blue" },
  { hex: "#3f7a4a", name: "Green" },
];

/** The properties a style sets and an object may override. */
export const STYLE_KEYS = ["font", "sizeMm", "bold", "italic", "underline", "colour", "align", "box"];

const MIN_SIZE_MM = 0.5;
const MAX_SIZE_MM = 50;

export const DEFAULT_TEXT_STYLES = [
  { id: "ts-note", name: "Note 2.5", font: "Source Sans 3", sizeMm: 2.5, bold: false, italic: false, underline: false, colour: "#1a1612", align: "left", box: false },
  { id: "ts-note-bold", name: "Note 2.5 bold", font: "Source Sans 3", sizeMm: 2.5, bold: true, italic: false, underline: false, colour: "#1a1612", align: "left", box: false },
  { id: "ts-heading", name: "Heading 3.5", font: "Source Sans 3", sizeMm: 3.5, bold: true, italic: false, underline: false, colour: "#1a1612", align: "left", box: false },
  { id: "ts-dim", name: "Dimension 2.0", font: "Source Sans 3", sizeMm: 2, bold: false, italic: false, underline: false, colour: "#1a1612", align: "center", box: false },
];

export const DEFAULT_NOTE_STYLE = "ts-note";
export const DEFAULT_DIMENSION_STYLE = "ts-dim";

const HEX = /^#[0-9a-f]{6}$/i;

function cleanSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_SIZE_MM, Math.max(MIN_SIZE_MM, Math.round(n * 10) / 10));
}

/** One style property, or undefined when the value is not one it can hold. */
function cleanProp(key, value) {
  switch (key) {
    case "font": return typeof value === "string" && value.trim() ? value.trim() : undefined;
    case "sizeMm": return cleanSize(value) ?? undefined;
    case "bold": case "italic": case "underline": case "box":
      return typeof value === "boolean" ? value : undefined;
    case "colour": return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : undefined;
    case "align": return TEXT_ALIGNS.includes(value) ? value : undefined;
    default: return undefined;
  }
}

/** Keep only the known properties with values they can hold. Empty means "no override". */
export function cleanOverride(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of STYLE_KEYS) {
    const v = cleanProp(key, raw[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Saved styles the document added. A style missing a property takes the base note's. */
export function normalizeTextStyles(raw) {
  const base = DEFAULT_TEXT_STYLES[0];
  const builtIn = new Set(DEFAULT_TEXT_STYLES.map((s) => s.id));
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map((s) => {
      if (!s?.id || typeof s.id !== "string" || builtIn.has(s.id) || seen.has(s.id)) return null;
      seen.add(s.id);
      const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : s.id;
      return { ...base, ...cleanOverride(s), id: s.id, name };
    })
    .filter(Boolean);
}

/** Every style the user can pick: the built-in ones, the pack's, then the job's own. */
export function textStyleList(doc, pack = null) {
  const out = [...DEFAULT_TEXT_STYLES];
  const ids = new Set(out.map((s) => s.id));
  for (const s of [...normalizeTextStyles(pack?.textStyles), ...normalizeTextStyles(doc?.textStyles)]) {
    if (ids.has(s.id)) continue;
    ids.add(s.id);
    out.push(s);
  }
  return out;
}

/** The style an object asked for, or the fallback when that style no longer exists. */
export function textStyleById(styles, id, fallbackId = DEFAULT_NOTE_STYLE) {
  return styles.find((s) => s.id === id)
    || styles.find((s) => s.id === fallbackId)
    || DEFAULT_TEXT_STYLES[0];
}

/** What an object actually looks like: its style with its own overrides on top. */
export function resolveTextLook(styles, obj, fallbackId = DEFAULT_NOTE_STYLE) {
  const style = textStyleById(styles, obj?.styleId, fallbackId);
  return { ...style, ...cleanOverride(obj?.override) };
}

/** The keys this object overrides, so the inspector can mark them. */
export function overriddenKeys(obj) {
  return Object.keys(cleanOverride(obj?.override));
}

/**
 * Set one property on an object. A value equal to the style's drops the
 * override instead of storing a copy, so the object follows the style again.
 */
export function setOverride(styles, obj, key, value, fallbackId = DEFAULT_NOTE_STYLE) {
  if (!STYLE_KEYS.includes(key)) return false;
  const clean = cleanProp(key, value);
  if (clean === undefined) return false;
  const style = textStyleById(styles, obj.styleId, fallbackId);
  const next = cleanOverride(obj.override);
  if (style[key] === clean) delete next[key];
  else next[key] = clean;
  if (Object.keys(next).length) obj.override = next;
  else delete obj.override;
  return true;
}

/** Bold, italic, underline and box flip against what the object shows now. */
export function toggleOverride(styles, obj, key, fallbackId = DEFAULT_NOTE_STYLE) {
  if (!["bold", "italic", "underline", "box"].includes(key)) return false;
  const now = resolveTextLook(styles, obj, fallbackId)[key];
  return setOverride(styles, obj, key, !now, fallbackId);
}

/**
 * A new style from what an object shows now. The object then uses it with
 * no overrides of its own.
 */
export function styleFromObject(doc, styles, obj, name, fallbackId = DEFAULT_NOTE_STYLE) {
  const look = resolveTextLook(styles, obj, fallbackId);
  const label = String(name || "").trim();
  if (!label) return null;
  if (!Array.isArray(doc.textStyles)) doc.textStyles = [];
  const base = `ts-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "style"}`;
  const taken = new Set(styles.map((s) => s.id));
  let id = base;
  for (let i = 2; taken.has(id); i += 1) id = `${base}-${i}`;
  const style = { id, name: label };
  for (const key of STYLE_KEYS) style[key] = look[key];
  doc.textStyles.push(style);
  obj.styleId = id;
  delete obj.override;
  return style;
}

/** A canvas font string. `px` is the height on screen or on the sheet. */
export function cssFont(look, px) {
  const size = Math.max(0.5, Number(px) || 0);
  return `${look.italic ? "italic " : ""}${look.bold ? "700 " : ""}${size}px "${look.font}", sans-serif`;
}

/** Paper millimetres to world metres at a drawing scale (100 for 1:100). */
export function textHeightM(look, scale = PLAN_TEXT_SCALE) {
  return (look.sizeMm / 1000) * scale;
}

// --- notes -----------------------------------------------------------------

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function cleanPoint(p) {
  const x = num(p?.x);
  const y = num(p?.y);
  return x === null || y === null ? null : { x, y };
}

function cleanRotation(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** A note as saved. Words are kept exactly; an empty note is not kept at all. */
export function normalizeNote(raw) {
  const x = num(raw?.x);
  const y = num(raw?.y);
  const text = typeof raw?.text === "string" ? raw.text.replace(/\r\n?/g, "\n") : "";
  if (!raw?.id || x === null || y === null || !text.trim()) return null;
  const note = {
    id: raw.id,
    level: raw.level || null,
    x, y,
    text,
    styleId: typeof raw.styleId === "string" && raw.styleId ? raw.styleId : DEFAULT_NOTE_STYLE,
    rotation: cleanRotation(raw.rotation),
    leader: cleanPoint(raw.leader),
    widthMm: num(raw.widthMm) && raw.widthMm > 0 ? Math.round(raw.widthMm * 10) / 10 : null,
    printable: raw.printable !== false,
    // A note is ink on the drawing, not existing or proposed work, so both
    // plan filters keep it (the same reason a scale figure is "mixed").
    status: "mixed",
  };
  const override = cleanOverride(raw.override);
  if (Object.keys(override).length) note.override = override;
  return note;
}

export function normalizeNotes(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeNote).filter(Boolean);
}

/** A new note at a point. Returns null for an empty text, so the UI can drop it. */
export function createNote(doc, { id, x, y, level = null, text, styleId = DEFAULT_NOTE_STYLE, override = null, printable = true, widthMm = null }) {
  const note = normalizeNote({ id, x, y, level, text, styleId, override, printable, widthMm });
  if (!note) return null;
  if (!Array.isArray(doc.notes)) doc.notes = [];
  doc.notes.push(note);
  return note;
}

/**
 * The note's lines as drawn. Typed line breaks always break; with a width,
 * words also wrap to it. `measure(text)` returns a width in the same unit as
 * `maxWidth`, so the same rule serves the plan and the sheet.
 */
export function wrapNoteLines(text, maxWidth, measure) {
  const paragraphs = String(text ?? "").split("\n");
  if (!(maxWidth > 0) || typeof measure !== "function") return paragraphs;
  const out = [];
  for (const para of paragraphs) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = "";
    for (const word of words) {
      const next = line + word;
      if (line && !/^\s+$/.test(word) && measure(next.trimEnd()) > maxWidth) {
        out.push(line.trimEnd());
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * Where a leader leaves the note: the middle of the side of the text box
 * nearest the arrow tip, so the line never crosses the words. `box` is
 * { x, y, w, h } with y down.
 */
export function leaderStart(box, tip) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tip.x - cx;
  const dy = tip.y - cy;
  if (Math.abs(dx) * box.h >= Math.abs(dy) * box.w) {
    return { x: dx >= 0 ? box.x + box.w : box.x, y: cy };
  }
  return { x: cx, y: dy >= 0 ? box.y + box.h : box.y };
}

// --- dimensions ------------------------------------------------------------

/**
 * The words on a placed dimension. The length is always measured. A typed
 * replacement ("EQ") is the one case where the number is not shown, so it is
 * flagged and drawn in a warning colour; a prefix or suffix sits beside the
 * real number.
 */
export function dimensionLabel(dim) {
  const measured = formatLengthMm(dimFrame({ x1: 0, y1: 0, x2: 0, y2: 0, ...dim }).len);
  const replaced = typeof dim?.textOverride === "string" && dim.textOverride.trim() !== "";
  const core = replaced ? dim.textOverride.trim() : measured;
  const prefix = typeof dim?.prefix === "string" ? dim.prefix.trim() : "";
  const suffix = typeof dim?.suffix === "string" ? dim.suffix.trim() : "";
  return {
    text: [prefix, core, suffix].filter(Boolean).join(" "),
    measured,
    replaced,
  };
}

/** How a dimension measures: along the line between its points, or only across x or only up y. */
export const DIMENSION_DIRS = ["aligned", "horizontal", "vertical"];

/**
 * The direction a dimension measures in, and its left-hand normal. Aligned
 * follows the two picked points; horizontal and vertical measure only the
 * x or the y distance between them, whatever the slope.
 */
function dimFrame(dim) {
  const dx = dim.x2 - dim.x1;
  const dy = dim.y2 - dim.y1;
  let ux;
  let uy;
  if (dim.dir === "horizontal") [ux, uy] = [Math.sign(dx) || 1, 0];
  else if (dim.dir === "vertical") [ux, uy] = [0, Math.sign(dy) || 1];
  else {
    const d = Math.hypot(dx, dy) || 1;
    [ux, uy] = [dx / d, dy / d];
  }
  const len = Math.abs(dx * ux + dy * uy);
  return { ux, uy, nx: -uy, ny: ux, len };
}

/**
 * The dimension line, moved `offset` metres off the first measured point
 * along the normal. The points themselves never move: dragging the line
 * changes only the offset, the way a Revit dimension is pulled off a wall.
 * `label` is where the number sits: the middle of the line unless it was
 * dragged, then `leaderTo` is the point on the line its short leader meets.
 */
export function dimensionGeometry(dim) {
  const { ux, uy, nx, ny, len } = dimFrame(dim);
  const off = num(dim.offset) ?? 0;
  const a = { x: dim.x1 + nx * off, y: dim.y1 + ny * off };
  const b = { x: a.x + ux * len, y: a.y + uy * len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const along = num(dim.textShift?.along) ?? 0;
  const across = num(dim.textShift?.off) ?? 0;
  const label = { x: mid.x + ux * along + nx * across, y: mid.y + uy * along + ny * across };
  let leaderTo = null;
  if (across !== 0 || Math.abs(along) > len / 2) {
    const s = Math.max(-len / 2, Math.min(len / 2, along));
    leaderTo = { x: mid.x + ux * s, y: mid.y + uy * s };
  }
  return {
    a, b,
    from: [{ x: dim.x1, y: dim.y1 }, { x: dim.x2, y: dim.y2 }],
    offset: off,
    length: len,
    dir: { x: ux, y: uy },
    normal: { x: nx, y: ny },
    mid,
    label,
    leaderTo,
  };
}

/** The offset that puts the dimension line through a point (a drag target). */
export function offsetThrough(dim, p) {
  const { nx, ny } = dimFrame(dim);
  return (p.x - dim.x1) * nx + (p.y - dim.y1) * ny;
}

/**
 * The number's shift from the middle of the line that puts it at `p`.
 * Within `snap` metres of the line it drops back onto it, with no leader.
 */
export function textShiftThrough(dim, p, snap = 0) {
  const g = dimensionGeometry({ ...dim, textShift: null });
  const dx = p.x - g.mid.x;
  const dy = p.y - g.mid.y;
  const along = dx * g.dir.x + dy * g.dir.y;
  let off = dx * g.normal.x + dy * g.normal.y;
  if (Math.abs(off) <= snap) off = 0;
  if (off === 0 && Math.abs(along) <= snap) return null;
  return { along: Math.round(along * 1000) / 1000, off: Math.round(off * 1000) / 1000 };
}

/** Aligned, horizontal or vertical, from where the pointer has been pulled to. */
export function dimensionDirFor(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return "aligned";
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const outX = p.x < minX || p.x > maxX;
  const outY = p.y < minY || p.y > maxY;
  if (outY && !outX) return "horizontal";
  if (outX && !outY) return "vertical";
  return "aligned";
}

/**
 * Reading angle for a label along a line, in radians on a y-down screen:
 * never upside down, so a line drawn right-to-left still reads left-to-right
 * and a vertical one reads from the bottom up.
 */
export function readableAngle(dx, dy) {
  let a = Math.atan2(dy, dx);
  if (a > Math.PI / 2 - 1e-9) a -= Math.PI;
  else if (a < -Math.PI / 2 - 1e-9) a += Math.PI;
  return a;
}

/** The dimension text fields as saved: kept only when they hold something. */
export function cleanDimensionText(raw) {
  const out = {};
  const offset = num(raw?.offset);
  if (offset !== null && offset !== 0) out.offset = offset;
  if (raw?.dir === "horizontal" || raw?.dir === "vertical") out.dir = raw.dir;
  const along = num(raw?.textShift?.along) ?? 0;
  const off = num(raw?.textShift?.off) ?? 0;
  if (along || off) out.textShift = { along, off };
  for (const key of ["prefix", "suffix", "textOverride"]) {
    if (typeof raw?.[key] === "string" && raw[key].trim()) out[key] = raw[key].trim();
  }
  if (typeof raw?.styleId === "string" && raw.styleId && raw.styleId !== DEFAULT_DIMENSION_STYLE) out.styleId = raw.styleId;
  const override = cleanOverride(raw?.override);
  if (Object.keys(override).length) out.override = override;
  return out;
}
