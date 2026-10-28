// A multi-page plan set (site, floors, elevations, sections) behind one PDF.
//
// Pure functions only: nothing here touches pdf.js, the DOM or the canvas, so
// it runs under node --test. underlay.js owns rendering; this file owns what a
// page means (kind, level, printed scale) and the arithmetic that turns a
// printed scale into metres-per-pixel.
//
// Principles carried over from underlay.js: a scale we guessed is marked
// unverified until the user checks it against a known dimension, and the
// bitmap is never persisted - only the placements are.

/** Placements live in a fixed pixel space, independent of how sharp a render is. */
export const REFERENCE_DPI = 150;
/** The coarse fallback bitmap, drawn stretched into the reference space. */
export const COARSE_DPI = 100;

export const SHEET_KINDS = ["cover", "site", "ground", "first", "elevations", "sections", "other"];

export const KIND_LABELS = {
  cover: "Cover",
  site: "Site plan",
  ground: "Ground floor",
  first: "First floor",
  elevations: "Elevations",
  sections: "Sections",
  other: "Other",
};

/** Kinds that are traced over as an underlay; the rest are looked at in the reference panel. */
export const PLACEABLE_KINDS = ["site", "ground", "first"];
export const REFERENCE_KINDS = ["elevations", "sections"];

/**
 * What a page is used for. `levelId` is the floor of a `plan` page and is the
 * only floor there is; `kind` is just the bookmark classification from import.
 */
export const PAGE_ROLES = ["plan", "elevation", "section", "other", "unused"];

export const PRINTED_SCALES = [50, 100, 200, 500];

/**
 * "Sheet - 200 - GROUND FLOOR PLAN" -> "ground". Order matters: "first floor
 * plan" must not match "floor plan" generally, and "site plan" must beat "plan".
 */
export function parseSheetKind(title) {
  // Revit prefixes the project name ("26_48_ERF 23-214 ... - Sheet - 100 - SITEPLAN"),
  // which must not be searched for keywords.
  const t = cleanSheetTitle(title).toLowerCase();
  if (!t.trim()) return "other";
  if (/\bcover\b|title sheet|\bindex\b/.test(t)) return "cover";
  if (/\bsite/.test(t)) return "site";
  if (/\bsection/.test(t)) return "sections";
  if (/\belevation/.test(t)) return "elevations";
  if (/\b(first|1st|upper)\b.*\bfloor\b|\bfirst floor\b|\blevel 1\b|\bl1\b/.test(t)) return "first";
  if (/\b(ground|gf|gfl)\b|\bground floor\b|\blevel 0\b/.test(t)) return "ground";
  return "other";
}

/** Strip the "Sheet - 200 -" prefix so the list shows "GROUND FLOOR PLAN". */
export function cleanSheetTitle(title) {
  const t = String(title ?? "").trim();
  const stripped = t.replace(/^.*?\bsheet\s*[-–:]\s*[\w.]+\s*[-–:]\s*/i, "").trim();
  return stripped || t;
}

/** The printed scale a kind most likely has. Only a guess, shown pre-filled and editable. */
export function guessPrintedScale(kind) {
  if (kind === "site") return 500;
  if (kind === "elevations" || kind === "sections") return 50;
  return 100;
}

/** "1:100", "1 : 100", "100" -> 100. Anything not a positive number -> null. */
export function parsePrintedScale(text) {
  const m = String(text ?? "").trim().match(/^(?:1\s*[:/]\s*)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

export function formatPrintedScale(denominator) {
  return Number.isFinite(denominator) && denominator > 0 ? `1:${denominator}` : "";
}

/** Which level a placeable kind lands on by default. null = not placed. */
export function defaultLevelForKind(kind, levels) {
  const ids = (levels || []).map((l) => l.id);
  const find = (re) => (levels || []).find((l) => re.test(`${l.id} ${l.name ?? ""}`))?.id ?? null;
  if (kind === "site" || kind === "ground") return find(/gfl|ground|\b01\b/i) ?? ids[0] ?? null;
  if (kind === "first") return find(/\bl1\b|first|\b02\b/i);
  return null;
}

/** Page size in reference pixels (150 dpi), from PDF points. */
export function referencePixelSize(widthPt, heightPt, dpi = REFERENCE_DPI) {
  return {
    pixelWidth: Math.max(1, Math.ceil((widthPt * dpi) / 72)),
    pixelHeight: Math.max(1, Math.ceil((heightPt * dpi) / 72)),
  };
}

/** Metres per reference pixel for a page printed at 1:denominator. */
export function seedMetresPerPixel(denominator, dpi = REFERENCE_DPI) {
  if (!(denominator > 0)) return null;
  return ((0.0254 / dpi) * denominator);
}

/**
 * How far the real print is from the nominal scale: the ratio of a calibrated
 * metres-per-pixel to what the printed denominator predicts. 1.0 means the
 * plot was exactly at scale; a fit-to-page print gives something else.
 */
export function correctionFactor(denominator, calibratedMetresPerPixel, dpi = REFERENCE_DPI) {
  const seeded = seedMetresPerPixel(denominator, dpi);
  if (!seeded || !(calibratedMetresPerPixel > 0)) return null;
  return calibratedMetresPerPixel / seeded;
}

/** A page's scale given its denominator and the plot correction factor. */
export function scaledMetresPerPixel(denominator, factor = 1, dpi = REFERENCE_DPI) {
  const seeded = seedMetresPerPixel(denominator, dpi);
  if (!seeded) return null;
  return seeded * (Number.isFinite(factor) && factor > 0 ? factor : 1);
}

/** A fresh placement for a page, seeded from its printed scale and marked unverified. */
export function seedPlacement(page, name, factor = 1) {
  const mpp = scaledMetresPerPixel(page.printedScale, factor) ?? 0.01;
  return {
    name: `${name} - ${page.label}`,
    pixelWidth: page.pixelWidth,
    pixelHeight: page.pixelHeight,
    x: 0,
    y: 0,
    metresPerPixel: mpp,
    opacity: 0.55,
    rotation: 0,
    hidden: false,
    calibrated: false,
    sheetPage: page.index,
  };
}

/**
 * Build a sheet set from the import dialog's rows. `rows` items:
 * { index, label, kind, use, levelId, printedScale, pixelWidth, pixelHeight }.
 * Pages that are not used get no placement.
 */
export function createSheetSet(pdfName, rows, { mime = "application/pdf" } = {}) {
  const source = { id: FIRST_SOURCE_ID, name: pdfName, mime };
  const set = { pdfName, sources: [source], scaleCorrection: null, ceilingHeights: {}, activeByLevel: {}, hidden: false, pages: [] };
  for (const page of pagesFromRows(set, source, rows, () => null)) set.pages.push(page);
  return set;
}

/** The first source of a document. Stable, so a legacy single-file set always wraps to the same id. */
export const FIRST_SOURCE_ID = "src1";

/** A source id not yet used in `set`. */
export function nextSourceId(set) {
  const taken = new Set((set?.sources || []).map((s) => s.id));
  let n = taken.size + 1;
  while (taken.has(`src${n}`)) n += 1;
  return `src${n}`;
}

/** The source a page was read from, or null. */
export function sourceOf(set, page) {
  return (set?.sources || []).find((s) => s.id === page?.sourceId) || null;
}

export function pagesOfSource(set, sourceId) {
  return (set?.pages || []).filter((p) => p.sourceId === sourceId);
}

/** The page number inside its own PDF. Pages of a first or legacy file use their index. */
export function pdfPageOf(page) {
  return Number.isInteger(page?.sourcePage) ? page.sourcePage : page?.index;
}

/** The first page index not used by any page of the set. Indexes are unique across every source. */
export function nextPageIndex(set) {
  return (set?.pages || []).reduce((max, p) => Math.max(max, p.index), -1) + 1;
}

/** Every file id the sheet set names, for the server's release rule and for the "does it still need uploading" checks. */
export function sheetSetAssetIds(set) {
  const ids = [];
  for (const s of set?.sources || []) if (s.mime !== "satellite" && s.assetId && !ids.includes(s.assetId)) ids.push(s.assetId);
  return ids;
}

/** Pages built from import rows. `indexFor(row, n)` picks a page index, or returns null to use the row's own. */
function pagesFromRows(set, source, rows, indexFor) {
  const out = [];
  let n = 0;
  for (const row of rows) {
    const index = indexFor(row, n) ?? row.index;
    n += 1;
    const page = {
      index,
      sourceId: source.id,
      sourcePage: row.index,
      label: row.label || `Page ${row.index + 1}`,
      kind: SHEET_KINDS.includes(row.kind) ? row.kind : "other",
      levelId: null,
      role: "unused",
      printedScale: row.printedScale > 0 ? row.printedScale : guessPrintedScale(row.kind),
      pixelWidth: row.pixelWidth,
      pixelHeight: row.pixelHeight,
      verified: false,
      shown: false,
      placement: null,
    };
    // A row says what it is used as (`role`); older callers only said `use` and a kind.
    const wanted = PAGE_ROLES.includes(row.role)
      ? row.role
      : row.use && PLACEABLE_KINDS.includes(row.kind) ? "plan"
        : row.kind === "elevations" ? "elevation"
          : row.kind === "sections" ? "section" : "unused";
    if (wanted === "plan" && row.levelId) {
      page.role = "plan";
      page.levelId = row.levelId;
      page.placement = seedPlacement(page, source.name);
    } else if (wanted === "elevation" || wanted === "section" || wanted === "other") {
      page.role = wanted;
    }
    out.push(page);
  }
  return out;
}

/**
 * Add a file to the set. `rows` are the import dialog's rows (`index` is the
 * page number inside the new file); the pages get fresh set-wide indexes so
 * nothing already placed is renumbered. Placed pages that land on a floor with
 * no sheet showing become that floor's sheet; on any other floor they wait
 * behind the one already there. Returns { source, pages }.
 */
export function addSource(set, { name, mime = "application/pdf", sha256 = null }, rows) {
  const source = { id: nextSourceId(set), name, mime, ...(sha256 ? { sha256 } : {}) };
  let next = nextPageIndex(set);
  const pages = pagesFromRows(set, source, rows, () => next++);
  if (!Array.isArray(set.sources)) set.sources = [];
  set.sources.push(source);
  if (!set.activeByLevel) set.activeByLevel = {};
  // A floor with no sheet takes the first new one; a floor that has one keeps it.
  for (const page of pages) {
    const emptyFloor = isPlanPage(page) && !pagesForLevel(set, page.levelId).length;
    set.pages.push(page);
    if (emptyFloor) set.activeByLevel[page.levelId] = page.index;
  }
  return { source, pages };
}

/** What replacing a file takes with it, in words for the question. */
export function sourceLoss(set, sourceId) {
  const pages = pagesOfSource(set, sourceId);
  const placed = pages.filter((p) => p.placement).length;
  const parts = [];
  if (placed) parts.push(`${placed} placed sheet${placed === 1 ? "" : "s"}`);
  const verified = pages.filter((p) => p.verified).length;
  const marks = pages.filter((p) => p.anchor).length;
  if (verified) parts.push(`${verified} scale check${verified === 1 ? "" : "s"}`);
  if (marks) parts.push(`${marks} alignment mark${marks === 1 ? "" : "s"}`);
  return parts;
}

/**
 * Swap one file's pages for a freshly read file. Other sources, their pages,
 * placements and files stay exactly as they were. The source keeps its id, so
 * anything that names it still resolves; its `assetId` is cleared because the
 * new bytes are not on the job yet. Returns { source, removed, pages }.
 */
export function replaceSource(set, sourceId, { name, mime = "application/pdf", sha256 = null }, rows) {
  const source = (set.sources || []).find((s) => s.id === sourceId);
  if (!source) return { source: null, removed: [], pages: [] };
  const removed = pagesOfSource(set, sourceId);
  const levels = new Set(removed.filter((p) => p.levelId).map((p) => p.levelId));
  set.pages = set.pages.filter((p) => p.sourceId !== sourceId);
  source.name = name;
  source.mime = mime;
  delete source.assetId;
  if (sha256) source.sha256 = sha256;
  else delete source.sha256;
  let next = nextPageIndex(set);
  // Fresh indexes: a bitmap or linework cached under an old index must not be taken for the new page.
  const maxRemoved = removed.reduce((m, p) => Math.max(m, p.index), -1);
  next = Math.max(next, maxRemoved + 1);
  const pages = pagesFromRows(set, source, rows, () => next++);
  mirrorLegacySource(set);
  for (const id of levels) repairActive(set, id);
  if (!set.activeByLevel) set.activeByLevel = {};
  for (const page of pages) {
    const emptyFloor = isPlanPage(page) && !pagesForLevel(set, page.levelId).length;
    set.pages.push(page);
    if (emptyFloor) set.activeByLevel[page.levelId] = page.index;
  }
  return { source, removed, pages };
}

const cleanTitle = (t) => cleanSheetTitle(t || "").toLowerCase().replace(/\s+/g, " ").trim();

function sameSize(a, b) {
  return Math.abs(a.pixelWidth - b.pixelWidth) <= b.pixelWidth * 0.02
    && Math.abs(a.pixelHeight - b.pixelHeight) <= b.pixelHeight * 0.02;
}

/**
 * Match a new revision of a file to the pages it replaces: by cleaned bookmark
 * title first, then by page number. `opened` are openPdf's pages
 * ({ index, title, pixelWidth, pixelHeight }). A match whose page size is
 * within 2% is `auto` (kept without asking); every other old page is a row
 * for the user. Returns { rows: [{ page, newIndex|null, auto }], unmatched: [new page numbers] }.
 */
export function matchRevision(set, sourceId, opened) {
  const olds = pagesOfSource(set, sourceId);
  const taken = new Set();
  const rows = [];
  const byTitle = new Map();
  for (const n of opened) {
    const key = cleanTitle(n.title);
    if (key && !byTitle.has(key)) byTitle.set(key, n);
  }
  for (const old of olds) {
    let found = null;
    const key = cleanTitle(old.label);
    const byName = key ? byTitle.get(key) : null;
    if (byName && !taken.has(byName.index)) found = byName;
    if (!found) {
      const same = opened.find((n) => n.index === pdfPageOf(old));
      if (same && !taken.has(same.index)) found = same;
    }
    if (found) taken.add(found.index);
    rows.push({ page: old, newIndex: found ? found.index : null, auto: Boolean(found) && sameSize(found, old) });
  }
  return { rows, unmatched: opened.filter((n) => !taken.has(n.index)).map((n) => n.index) };
}

/**
 * Carry a new revision's file over the old pages. `decisions` maps an old page
 * index to the new page number it now shows, or null to drop it. A kept page
 * stays the same page (index, placement, floor, role, scale check, alignment
 * mark) and takes the new file's page size; a page the new file has that no
 * old page took arrives as `unused`. `opened` is openPdf's page list and
 * `file` the new file's { name, mime, sha256 }. Returns { kept, dropped, added }.
 */
export function applyRevision(set, sourceId, file, opened, decisions) {
  const source = (set.sources || []).find((s) => s.id === sourceId);
  if (!source) return { kept: [], dropped: [], added: [] };
  const olds = pagesOfSource(set, sourceId);
  const used = new Set();
  const kept = [];
  const dropped = [];
  for (const old of olds) {
    const target = decisions.get(old.index);
    const now = Number.isInteger(target) && !used.has(target) ? opened.find((n) => n.index === target) : null;
    if (!now) {
      dropped.push(old);
      continue;
    }
    used.add(now.index);
    old.sourcePage = now.index;
    old.pixelWidth = now.pixelWidth;
    old.pixelHeight = now.pixelHeight;
    if (old.placement) {
      old.placement.pixelWidth = now.pixelWidth;
      old.placement.pixelHeight = now.pixelHeight;
    }
    kept.push(old);
  }
  const droppedLevels = new Set(dropped.filter((p) => p.levelId).map((p) => p.levelId));
  set.pages = set.pages.filter((p) => !dropped.includes(p));
  for (const id of droppedLevels) repairActive(set, id);
  let next = nextPageIndex(set);
  const added = [];
  for (const n of opened) {
    if (used.has(n.index)) continue;
    const page = {
      index: next++,
      sourceId,
      sourcePage: n.index,
      label: n.title ? cleanSheetTitle(n.title) : `Page ${n.index + 1}`,
      kind: n.title ? parseSheetKind(n.title) : "other",
      levelId: null,
      role: "unused",
      printedScale: guessPrintedScale(n.title ? parseSheetKind(n.title) : "other"),
      pixelWidth: n.pixelWidth,
      pixelHeight: n.pixelHeight,
      verified: false,
      shown: false,
      anchor: null,
      placement: null,
    };
    set.pages.push(page);
    added.push(page);
  }
  // The old asset id stays named by recovery snapshots; this source points at the new upload once it lands.
  source.name = file.name;
  source.mime = file.mime || source.mime;
  delete source.assetId;
  if (file.sha256) source.sha256 = file.sha256;
  else delete source.sha256;
  mirrorLegacySource(set);
  return { kept, dropped, added };
}

/**
 * Take one file and all its pages out of the set. The last source cannot be
 * removed this way (that is Remove on the whole underlay). Returns { ok, removed: [pages] }.
 */
export function removeSource(set, sourceId) {
  if (!set?.sources || set.sources.length < 2) return { ok: false, removed: [] };
  const at = set.sources.findIndex((s) => s.id === sourceId);
  if (at < 0) return { ok: false, removed: [] };
  const removed = pagesOfSource(set, sourceId);
  const levels = new Set(removed.filter((p) => p.levelId).map((p) => p.levelId));
  set.sources.splice(at, 1);
  set.pages = set.pages.filter((p) => p.sourceId !== sourceId);
  for (const id of levels) repairActive(set, id);
  mirrorLegacySource(set);
  return { ok: true, removed };
}

/** `pdfName` and `assetId` on the set are copies of the first source, written for one revision so older readers still work. */
export function mirrorLegacySource(set) {
  const first = set?.sources?.[0];
  if (!first) return;
  set.pdfName = first.name;
  if (first.assetId) set.assetId = first.assetId;
  else delete set.assetId;
}

/** Pages drawn on a level, in page order. */
export function pagesForLevel(set, levelId) {
  return (set?.pages || []).filter((p) => p.placement && p.levelId === levelId);
}

export function isPlanPage(page) {
  return Boolean(page?.placement) && page.role !== "elevation" && page.role !== "section" && page.role !== "other" && page.role !== "unused";
}

/**
 * The pages Align offers: every plan page on any floor, plus the one showing.
 * A page's kind plays no part - its floor is the user's to set.
 */
export function alignablePages(set, showingIndex = null) {
  return (set?.pages || [])
    .filter((p) => isPlanPage(p) || (p.placement && p.index === showingIndex))
    .sort((a, b) => a.index - b.index);
}

function rememberActive(set, levelId) {
  return resolveActivePage(set, levelId)?.index ?? null;
}

/** After a page leaves a floor, point that floor at its next plan page, or forget the choice. */
function repairActive(set, levelId) {
  if (!set.activeByLevel) set.activeByLevel = {};
  const wanted = set.activeByLevel[levelId];
  const remaining = pagesForLevel(set, levelId);
  if (remaining.some((p) => p.index === wanted)) return;
  if (remaining.length) set.activeByLevel[levelId] = remaining[0].index;
  else delete set.activeByLevel[levelId];
}

/**
 * Put a plan page on another floor. The placement (position, scale, rotation,
 * opacity, pinned, calibrated) and the page's anchor and verified flag are
 * untouched: floors are which storey you look at, not a coordinate system.
 * `follow` makes the new floor show this page; otherwise the page waits behind
 * whatever the new floor already shows. `levelIds`, when given, lists the real
 * floors. Returns { ok, changed, from, following, reason }.
 */
export function movePageToLevel(set, pageIndex, levelId, { follow = false, levelIds = null } = {}) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page || !isPlanPage(page)) return { ok: false, changed: false, reason: "Only a page traced on a floor can be moved." };
  if (!levelId || (levelIds && !levelIds.includes(levelId))) return { ok: false, changed: false, reason: "That floor does not exist." };
  if (page.levelId === levelId) return { ok: true, changed: false, from: levelId, following: false };
  const from = page.levelId;
  if (!set.activeByLevel) set.activeByLevel = {};
  const waiting = rememberActive(set, levelId);
  page.levelId = levelId;
  repairActive(set, from);
  if (follow || waiting === null) set.activeByLevel[levelId] = page.index;
  else set.activeByLevel[levelId] = waiting;
  return { ok: true, changed: true, from, following: Boolean(follow) };
}

/**
 * Move every plan page on one floor to another. The view follows only the page
 * that was showing. Returns { ok, moved: [page indexes], showing: index|null }.
 */
export function movePlansOnLevel(set, fromLevelId, toLevelId, { levelIds = null, sourceId = null } = {}) {
  if (!toLevelId || fromLevelId === toLevelId || (levelIds && !levelIds.includes(toLevelId))) return { ok: false, moved: [], showing: null };
  const showing = rememberActive(set, fromLevelId);
  const moved = [];
  for (const page of pagesForLevel(set, fromLevelId).filter((p) => isPlanPage(p) && (!sourceId || p.sourceId === sourceId))) {
    const result = movePageToLevel(set, page.index, toLevelId, { follow: page.index === showing, levelIds });
    if (result.changed) moved.push(page.index);
  }
  return { ok: true, moved, showing: moved.includes(showing) ? showing : null };
}

/** Make an unused, elevation or section page a plan on `levelId`, seeded at its printed scale and unverified. */
export function placePage(set, pageIndex, levelId, { levelIds = null, follow = true } = {}) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page || !levelId || (levelIds && !levelIds.includes(levelId))) return { ok: false };
  if (isPlanPage(page)) return movePageToLevel(set, pageIndex, levelId, { follow, levelIds });
  const waiting = rememberActive(set, levelId);
  page.role = "plan";
  page.levelId = levelId;
  page.shown = false;
  page.verified = false;
  page.anchor = null;
  page.placement = seedPlacement(page, sourceOf(set, page)?.name ?? set.pdfName, set.scaleCorrection ?? 1);
  if (!set.activeByLevel) set.activeByLevel = {};
  set.activeByLevel[levelId] = follow || waiting === null ? page.index : waiting;
  return { ok: true, changed: true, following: Boolean(follow) };
}

/** Take a page off the plan but keep it in the list: role `unused`, no placement, no anchor. */
export function unplacePage(set, pageIndex) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page || !page.placement) return { ok: false };
  const from = page.levelId;
  page.role = "unused";
  page.placement = null;
  page.anchor = null;
  page.levelId = null;
  page.shown = false;
  page.suppressed = false;
  page.verified = false;
  if (from) repairActive(set, from);
  return { ok: true, from };
}

/**
 * Show a page beside the plan, or take it back out. `elevation`, `section` and
 * `other` are looked at in the reference panel, and each can hold many pages.
 * `unused` keeps the page in the list and out of that panel. A page that was
 * being traced comes off its floor: the placement, alignment mark and scale
 * check go.
 */
export function setPageRole(set, pageIndex, role) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page || (role !== "elevation" && role !== "section" && role !== "other" && role !== "unused")) return { ok: false, changed: false };
  if (page.role === role && !isPlanPage(page)) return { ok: true, changed: false };
  const from = page.levelId;
  if (isPlanPage(page)) {
    page.placement = null;
    page.anchor = null;
    page.shown = false;
    page.suppressed = false;
    page.verified = false;
  }
  page.role = role;
  page.levelId = null;
  if (from) repairActive(set, from);
  return { ok: true, changed: true };
}

/**
 * Show or hide a plan page. Other pages are drawn under the current one when
 * `shown`. The current page is drawn unless `suppressed`, which is how its own
 * eye hides it without leaving the sheet. Hiding the current page also clears
 * `shown`, so it stays hidden after you switch away. Returns { ok, reason }.
 */
export function setPageShown(set, pageIndex, shown, currentIndex = null) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page || !isPlanPage(page)) return { ok: false, reason: "Only a page traced on a floor can be shown." };
  const on = Boolean(shown);
  if (page.index === currentIndex) {
    page.suppressed = !on;
    if (!on) page.shown = false;
    return { ok: true };
  }
  page.shown = on;
  if (on) page.suppressed = false;
  return { ok: true };
}

/** The other plan pages drawn under the current one: same floor as it, marked shown, in page order. */
export function shownPagesBeside(set, currentIndex) {
  const current = set?.pages.find((p) => p.index === currentIndex);
  if (!current || !current.levelId) return [];
  return pagesForLevel(set, current.levelId).filter((p) => p.index !== currentIndex && p.shown && isPlanPage(p));
}

/** Whole-underlay hide: one flag on the set, so a page's eye is not confused with it. */
export function setSheetSetHidden(set, hidden) {
  if (set) set.hidden = Boolean(hidden);
}

/**
 * Move a page to sit where `targetIndex` is, inside one floor. Draw order is
 * page order in the list. Pages on different floors are refused: the floor
 * is not changed by this.
 */
export function reorderPage(set, pageIndex, targetIndex) {
  if (!set || pageIndex === targetIndex) return { ok: false };
  const from = set.pages.findIndex((p) => p.index === pageIndex);
  const to = set.pages.findIndex((p) => p.index === targetIndex);
  if (from < 0 || to < 0) return { ok: false };
  const a = set.pages[from];
  const b = set.pages[to];
  if (!isPlanPage(a) || !isPlanPage(b) || a.levelId !== b.levelId) return { ok: false };
  set.pages.splice(from, 1);
  set.pages.splice(to, 0, a);
  return { ok: true };
}

/** What taking a page off the plan would throw away, for the question. */
export function unplaceLoss(page) {
  const parts = [];
  if (page?.verified) parts.push("its scale check");
  if (page?.anchor) parts.push("its alignment mark");
  return parts;
}

/**
 * The page whose placement should be `doc.underlay` while `levelId` is active:
 * the one the user last picked for that level, else the first assigned.
 */
export function resolveActivePage(set, levelId) {
  const pages = pagesForLevel(set, levelId);
  if (!pages.length) return null;
  const wanted = set.activeByLevel?.[levelId];
  return pages.find((p) => p.index === wanted) || pages[0];
}

export function referencePages(set) {
  return (set?.pages || []).filter((p) => p.role === "elevation" || p.role === "section");
}

/** Record a verified calibration on a page and return the plot correction factor it implies. */
export function recordCalibration(set, pageIndex, metresPerPixel) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page) return null;
  const factor = correctionFactor(page.printedScale, metresPerPixel);
  if (!factor) return null;
  page.verified = true;
  set.scaleCorrection = factor;
  return factor;
}

/**
 * Apply a correction factor to every other unverified placed page: each keeps
 * its own denominator, multiplied by the factor. The sheet's centre stays put
 * so a page already positioned does not jump. Returns the pages changed.
 */
export function applyCorrectionToOthers(set, factor, exceptIndex) {
  const changed = [];
  for (const page of set?.pages || []) {
    const p = page.placement;
    if (!p || page.index === exceptIndex || page.verified) continue;
    const next = scaledMetresPerPixel(page.printedScale, factor);
    if (!next) continue;
    const cx = p.x + (p.pixelWidth * p.metresPerPixel) / 2;
    const cy = p.y + (p.pixelHeight * p.metresPerPixel) / 2;
    p.metresPerPixel = next;
    p.x = cx - (p.pixelWidth * next) / 2;
    p.y = cy - (p.pixelHeight * next) / 2;
    changed.push(page.index);
  }
  return changed;
}

/** Change a page's printed scale and re-seed it, unless the user already verified it. */
export function setPageScale(set, pageIndex, denominator) {
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page || !(denominator > 0)) return false;
  page.printedScale = denominator;
  if (page.placement && !page.verified) {
    const p = page.placement;
    const next = scaledMetresPerPixel(denominator, set.scaleCorrection ?? 1);
    const cx = p.x + (p.pixelWidth * p.metresPerPixel) / 2;
    const cy = p.y + (p.pixelHeight * p.metresPerPixel) / 2;
    p.metresPerPixel = next;
    p.x = cx - (p.pixelWidth * next) / 2;
    p.y = cy - (p.pixelHeight * next) / 2;
  }
  return true;
}

/** floorToCeiling typed from a section, in metres. Blank clears it. */
export function setCeilingHeight(set, levelId, metres) {
  if (!set || !levelId) return false;
  if (metres === null || metres === "" || metres === undefined) {
    delete set.ceilingHeights[levelId];
    return true;
  }
  const n = Number(metres);
  if (!(n > 0 && n < 20)) return false;
  set.ceilingHeights[levelId] = n;
  return true;
}

/** Apply typed ceiling heights over a merged level list (new objects, input untouched). */
export function applyCeilingHeights(levels, set) {
  const heights = set?.ceilingHeights;
  if (!heights || !Object.keys(heights).length) return levels;
  return levels.map((l) => (Number.isFinite(heights[l.id]) ? { ...l, floorToCeiling: heights[l.id] } : l));
}

/**
 * Read a saved sheet set back, tolerating absence and junk. Documents written
 * before multi-page import have none and keep working with a single underlay.
 */
export function normalizeSheetSet(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages)) return null;
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const pages = [];
  for (const p of raw.pages) {
    if (!p || !Number.isInteger(p.index) || p.index < 0) continue;
    if (!(p.pixelWidth > 0) || !(p.pixelHeight > 0)) continue;
    const kind = SHEET_KINDS.includes(p.kind) ? p.kind : "other";
    const pl = p.placement;
    let placement = null;
    if (pl && [pl.x, pl.y, pl.metresPerPixel].every(finite) && pl.metresPerPixel > 0) {
      placement = {
        name: typeof pl.name === "string" ? pl.name : `Page ${p.index + 1}`,
        pixelWidth: p.pixelWidth,
        pixelHeight: p.pixelHeight,
        x: pl.x,
        y: pl.y,
        metresPerPixel: pl.metresPerPixel,
        opacity: finite(pl.opacity) ? Math.min(1, Math.max(0, pl.opacity)) : 0.55,
        rotation: finite(pl.rotation) ? pl.rotation : 0,
        hidden: false,
        calibrated: Boolean(pl.calibrated),
        pinned: Boolean(pl.pinned),
        sheetPage: p.index,
      };
    }
    // A placement means plan; otherwise take the saved role, else guess from the kind.
    const role = placement ? "plan"
      : PAGE_ROLES.includes(p.role) && p.role !== "plan" ? p.role
        : kind === "elevations" ? "elevation" : kind === "sections" ? "section" : "unused";
    const levelId = placement && typeof p.levelId === "string" ? p.levelId : null;
    pages.push({
      index: p.index,
      label: typeof p.label === "string" && p.label ? p.label : `Page ${p.index + 1}`,
      kind,
      role,
      levelId: placement ? levelId : null,
      printedScale: p.printedScale > 0 ? p.printedScale : guessPrintedScale(kind),
      pixelWidth: p.pixelWidth,
      pixelHeight: p.pixelHeight,
      verified: Boolean(p.verified),
      shown: Boolean(placement) && Boolean(p.shown),
      // The current page is drawn unless this is set. Other pages use `shown`.
      suppressed: Boolean(p.suppressed),
      anchor: placement && finite(p.anchor?.x) && finite(p.anchor?.y) ? { x: p.anchor.x, y: p.anchor.y } : null,
      placement,
    });
  }
  if (!pages.length) return null;

  // Sources: the files the pages were read from. A set saved before there were
  // several is wrapped as one source, with the id every such document gets.
  const SOURCE_MIMES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "satellite"];
  const sources = [];
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    if (!s || typeof s.id !== "string" || !s.id || sources.some((q) => q.id === s.id)) continue;
    const mime = SOURCE_MIMES.includes(s.mime) ? s.mime : "application/pdf";
    sources.push({
      id: s.id,
      name: typeof s.name === "string" && s.name ? s.name : "plans.pdf",
      mime,
      ...(mime !== "satellite" && typeof s.assetId === "string" && s.assetId ? { assetId: s.assetId } : {}),
      ...(typeof s.sha256 === "string" && /^[0-9a-f]{64}$/.test(s.sha256) ? { sha256: s.sha256 } : {}),
    });
  }
  if (!sources.length) {
    sources.push({
      id: FIRST_SOURCE_ID,
      name: typeof raw.pdfName === "string" && raw.pdfName ? raw.pdfName : "plans.pdf",
      mime: "application/pdf",
      ...(typeof raw.assetId === "string" && raw.assetId ? { assetId: raw.assetId } : {}),
    });
  }
  const seenIndex = new Set();
  const uniquePages = [];
  for (const page of pages) {
    if (seenIndex.has(page.index)) continue;
    seenIndex.add(page.index);
    const own = raw.pages.find((q) => q?.index === page.index);
    page.sourceId = sources.some((s) => s.id === own?.sourceId) ? own.sourceId : sources[0].id;
    page.sourcePage = Number.isInteger(own?.sourcePage) && own.sourcePage >= 0 ? own.sourcePage : page.index;
    uniquePages.push(page);
  }
  pages.length = 0;
  pages.push(...uniquePages);
  const heights = {};
  for (const [id, v] of Object.entries(raw.ceilingHeights || {})) if (finite(v) && v > 0) heights[id] = v;
  const active = {};
  for (const [id, v] of Object.entries(raw.activeByLevel || {})) if (Number.isInteger(v)) active[id] = v;
  // Hide used to live on each page's placement; one hidden page hides the set.
  const wasHidden = Boolean(raw.hidden) || raw.pages.some((q) => q?.placement?.hidden);
  return {
    hidden: wasHidden,
    // Each file is an asset row, named on its source. Absent on drawings saved
    // before files were stored, which still ask for the PDF once and then store it.
    sources,
    // Copies of the first source, written for one revision so a tab still on
    // the old code reads the same file. Nothing here reads them.
    pdfName: sources[0].name,
    ...(sources[0].assetId ? { assetId: sources[0].assetId } : {}),
    scaleCorrection: finite(raw.scaleCorrection) && raw.scaleCorrection > 0 ? raw.scaleCorrection : null,
    ceilingHeights: heights,
    activeByLevel: active,
    pages,
  };
}

/**
 * True when a reopened PDF has the same pages, in reference pixels, as the
 * one this drawing was set up with. A 2% slack covers a renderer rounding
 * the page box without accepting a different sheet.
 */
export function sameSheetGeometry(savedPages, openedPages) {
  return (savedPages || []).every((page) => {
    const now = openedPages?.[pdfPageOf(page)];
    if (!now || !(page.pixelWidth > 0) || !(page.pixelHeight > 0)) return false;
    return Math.abs(now.pixelWidth - page.pixelWidth) <= page.pixelWidth * 0.02
      && Math.abs(now.pixelHeight - page.pixelHeight) <= page.pixelHeight * 0.02;
  });
}

/**
 * When a calibration lands far from the printed scale, the likelier cause is a
 * wrong printed scale rather than an odd plot. If printed x factor is within
 * `tolerance` of a standard scale, return it (e.g. 1:500 at 20.1% -> 100).
 */
export function suggestPrintedScale(denominator, factor, tolerance = 0.05) {
  if (!(denominator > 0) || !(factor > 0)) return null;
  const implied = denominator * factor;
  return PRINTED_SCALES.find((s) => Math.abs(s / implied - 1) <= tolerance) ?? null;
}

/** Real metres between two points picked on a reference page, given in reference pixels. */
export function referenceDistanceMetres(pixelDistance, denominator) {
  const mpp = seedMetresPerPixel(denominator);
  return mpp ? pixelDistance * mpp : null;
}
