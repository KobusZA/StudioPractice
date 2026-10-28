// PDF and image underlay, with two-point scale calibration.
//
// Row 6 of the customer's requirements sheet, and the only row they gave a
// priority to. The template corroborates it: the model carries a placed PDF and
// three placed photographs, so their real workflow starts by tracing something
// that already exists.
//
// Scale is established by clicking two points whose real separation the user
// knows, exactly as a surveyor would. Nothing is assumed about the source
// document's DPI, because a scanned or re-plotted drawing rarely honours it.
// A satellite view is the exception: its scale is known, so it arrives
// calibrated (satellite.js).

import {
  SATELLITE_AREA_METRES,
  fetchBestSatelliteImage,
  fetchSatelliteImage,
  resolveLocation,
} from "./satellite.js?v=20261015-geocode";
import { COARSE_DPI, REFERENCE_DPI, isPlanPage, pagesForLevel, referencePixelSize, resolveActivePage, setSheetSetHidden, shownPagesBeside } from "./sheet-set.js";
import { DEFAULT_OPS, buildLinework, snapLinework } from "./pdf-snap.js";

// pdf.js 4.6.82 ships with the app (vendor/), so a site with no signal still opens a PDF.
const PDFJS_URL = new URL("./vendor/pdf.min.mjs", import.meta.url).href;
const PDFJS_WORKER = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

/**
 * The pixels stay out of the document. The file is an asset on the job; this
 * module holds the open PDF and the rendered pages for the session, and a
 * reload fetches the asset rather than asking for the file again.
 */
let bitmap = null;
/** The sheet left on screen while the one just chosen is still rendering, so the plan does not go blank and then jump. */
let heldSheet = null;
/** Each open file's bytes by source id, so the session can store them on the job. */
const sourceBytes = new Map();
/** Bytes of a PDF opened for the import dialog, not yet the session's file. */
let pendingBytes = null;
/** True while a reload is fetching the stored file, so the "choose PDF" bar stays down. */
let pdfRestorePending = false;

/** The satellite placement whose pixels are being re-fetched, and those that already failed to. */
let restoring = null;
const restoreFailed = new WeakSet();

export function underlayBitmap() {
  return bitmap;
}

export function clearUnderlay(doc) {
  bitmap = null;
  restoring = null;
  doc.underlay = null;
  doc.sheetSet = null;
  closePdf();
}

/**
 * Remove, but keep the pieces so Undo can put them back. Dropping the PDF would
 * throw away the rendered pages and the open file along with the placements,
 * so Undo could only bring back a blank sheet. The stash lives until something
 * else replaces the underlay (closePdf) or it is discarded explicitly.
 * Returns what was removed, for the confirmation text.
 */
let stash = null;

export function stashUnderlay(doc) {
  if (!doc.underlay && !doc.sheetSet) return null;
  const set = doc.sheetSet;
  const summary = {
    name: set ? (set.sources?.length > 1 ? `${set.sources.length} plan files` : set.sources?.[0]?.name || set.pdfName) : (doc.underlay?.name || "the underlay"),
    sheets: set ? set.pages.filter((p) => p.placement).length : 0,
    verified: set ? set.pages.filter((p) => p.verified).length : 0,
    marks: set ? set.pages.filter((p) => p.anchor).length : 0,
    isSet: Boolean(set),
  };
  discardStash();
  stash = {
    underlay: doc.underlay, sheetSet: doc.sheetSet, bitmap, pdfs: new Map(pdfs),
    pages: new Map(pageBitmaps), bytes: new Map(sourceBytes), pageMap: new Map(pageMap),
  };
  sourceBytes.clear();
  cancelSharp();
  sharp.canvas = null;
  sharp.key = null;
  pageRendering.clear();
  pageBitmaps.clear();
  clearLinework();
  pdfs.clear();
  pageMap = new Map();
  bitmap = null;
  restoring = null;
  doc.underlay = null;
  doc.sheetSet = null;
  return summary;
}

export function hasStashedUnderlay() {
  return Boolean(stash);
}

/** Put back what stashUnderlay took. False when nothing is kept or the plan has a new underlay since. */
export function restoreStashedUnderlay(doc) {
  if (!stash || doc.underlay || doc.sheetSet || pdfs.size) return false;
  doc.underlay = stash.underlay;
  doc.sheetSet = stash.sheetSet;
  bitmap = stash.bitmap;
  for (const [id, pdf] of stash.pdfs) pdfs.set(id, pdf);
  for (const [id, bytes] of stash.bytes) sourceBytes.set(id, bytes);
  pageMap = stash.pageMap;
  for (const [index, bmp] of stash.pages) pageBitmaps.set(index, bmp);
  stash = null;
  return true;
}

export function discardStash() {
  if (!stash) return;
  for (const bmp of stash.pages.values()) bmp.close?.();
  for (const pdf of stash.pdfs.values()) {
    try {
      pdf?.destroy();
    } catch {
      // Already gone.
    }
  }
  stash = null;
}

/** Keep the sheet where it is: a pinned underlay ignores drags, handles and rotate buttons. */
export function setUnderlayPinned(doc, pinned) {
  if (!doc.underlay) return;
  doc.underlay.pinned = Boolean(pinned);
}

/** Placement defaults: one metre per pixel is wrong, which is the point - it forces calibration. */
function defaultPlacement(name, pixelWidth, pixelHeight) {
  return {
    name,
    pixelWidth,
    pixelHeight,
    x: 0,
    y: 0,
    metresPerPixel: 0.01,
    opacity: 0.55,
    rotation: 0,
    hidden: false,
    calibrated: false,
    pinned: false,
  };
}

export async function loadUnderlayFile(doc, file) {
  if (!file) return { ok: false, message: "No file chosen." };

  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const image = isPdf ? await renderPdfFirstPage(file) : await loadImage(file);
  if (!image.ok) return image;

  closePdf();
  doc.sheetSet = null;
  bitmap = image.bitmap;
  restoring = null;
  doc.underlay = defaultPlacement(file.name, image.bitmap.width, image.bitmap.height);
  return { ok: true, message: `${file.name} loaded. Calibrate the scale before tracing.` };
}

/**
 * Centre a north-up satellite view of `text` (an address or a coordinate) on
 * `centre`, a world point - the middle of whatever the user is looking at.
 */
export async function loadSatelliteUnderlay(doc, text, centre, areaMetres = SATELLITE_AREA_METRES, place = null) {
  const known = place && Number.isFinite(place.lat) && Number.isFinite(place.lng) ? place : null;
  const where = known
    ? { ok: true, lat: known.lat, lng: known.lng, label: known.label || text }
    : await resolveLocation(text);
  if (!where.ok) return where;

  const image = await fetchBestSatelliteImage(where.lat, where.lng, areaMetres);
  if (!image.ok) return image;

  const { width, height } = image.bitmap;
  const mpp = image.metresPerPixel;
  closePdf();
  doc.sheetSet = null;
  bitmap = image.bitmap;
  restoring = null;
  doc.underlay = {
    ...defaultPlacement(`Satellite: ${where.label}`, width, height),
    x: centre.x - (width * mpp) / 2,
    y: centre.y - (height * mpp) / 2,
    metresPerPixel: mpp,
    opacity: 0.7,
    calibrated: true,
    source: { type: "satellite", lat: where.lat, lng: where.lng, zoom: image.zoom, areaMetres, label: where.label },
  };
  const resolution = mpp < 1 ? `${Math.round(mpp * 100)} cm` : `${mpp.toFixed(1)} m`;
  return {
    ok: true,
    message: `Satellite view of ${where.label} loaded at true scale (${resolution} per pixel). Trace over it, or Set scale against a measured distance to fine-tune.`,
  };
}

/**
 * A saved satellite underlay has its placement but not its pixels. Fetch them
 * again from the stored coordinate. Returns null when there is nothing to do,
 * otherwise a promise of "shown", "failed", or "stale" (the document moved on
 * while it downloaded). Each placement is tried once, so an offline session
 * does not retry on every redraw.
 */
export function restoreSatelliteUnderlay(doc) {
  const placement = doc.underlay;
  if (placement?.source?.type !== "satellite" || bitmap) return null;
  if (restoring === placement || restoreFailed.has(placement)) return null;
  restoring = placement;
  return fetchSatelliteImage(placement.source).then((image) => {
    if (restoring === placement) restoring = null;
    if (doc.underlay !== placement || bitmap) return "stale";
    if (!image.ok) {
      restoreFailed.add(placement);
      return "failed";
    }
    bitmap = image.bitmap;
    return "shown";
  });
}

export function isSatelliteUnderlay(doc) {
  return doc?.underlay?.source?.type === "satellite";
}

async function loadImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    return { ok: true, bitmap: bmp };
  } catch (err) {
    return { ok: false, message: `Could not read that image: ${err.message}` };
  }
}

/**
 * Only the first page. A submission set is many pages, but tracing happens one
 * plan at a time, and page selection is a UI question we have not been asked.
 */
async function renderPdfFirstPage(file) {
  let pdfjs;
  try {
    pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
  } catch {
    return { ok: false, message: "The PDF renderer could not be fetched. Export the page as PNG and import that instead." };
  }
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const page = await pdf.getPage(1);

    // Render at roughly 150 dpi. Enough to trace against, small enough to keep
    // the canvas responsive on a large sheet.
    const viewport = page.getViewport({ scale: 150 / 72 });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return { ok: true, bitmap: canvas.transferToImageBitmap() };
  } catch (err) {
    return { ok: false, message: `Could not render that PDF: ${err.message}` };
  }
}

/**
 * Set the scale from two points on the underlay and the real distance between
 * them. Returns the resulting metres-per-pixel so the caller can report it.
 */
export function calibrate(doc, a, b, realMetres) {
  const placement = doc.underlay;
  if (!placement) return { ok: false, message: "Load an underlay first." };

  const pixelDistance = Math.hypot(b.x - a.x, b.y - a.y) / placement.metresPerPixel;
  if (pixelDistance < 1) return { ok: false, message: "Those two points are too close together to measure." };
  if (!(realMetres > 0)) return { ok: false, message: "Enter the real distance in millimetres." };

  // Keep the first calibration point anchored so the drawing does not jump.
  const scale = realMetres / pixelDistance;
  const ratio = scale / placement.metresPerPixel;
  placement.x = a.x - (a.x - placement.x) * ratio;
  placement.y = a.y - (a.y - placement.y) * ratio;
  placement.metresPerPixel = scale;
  placement.calibrated = true;

  return { ok: true, message: `Scale set: ${Math.round(realMetres * 1000)} mm across ${Math.round(pixelDistance)} px.`, metresPerPixel: scale };
}

/** Centre of the placed sheet in world coordinates - the pivot for rotation and drag-scale alike. */
function underlayCentre(placement) {
  const w = placement.pixelWidth * placement.metresPerPixel;
  const h = placement.pixelHeight * placement.metresPerPixel;
  return { x: placement.x + w / 2, y: placement.y + h / 2, w, h };
}

/**
 * Map a world point onto the sheet's pixel space (origin top-left, unrotated).
 * Used so a calibration pick stays glued to the same PDF pixel while the
 * sheet is resized, moved or rotated.
 */
export function underlayPixelFromWorld(placement, wx, wy) {
  if (!placement) return null;
  const { x: cx, y: cy, w, h } = underlayCentre(placement);
  const rad = ((placement.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const mpp = placement.metresPerPixel || 1;
  return { x: (lx + w / 2) / mpp, y: (ly + h / 2) / mpp };
}

/** Inverse of underlayPixelFromWorld: a sheet pixel back into world coordinates. */
export function underlayWorldFromPixel(placement, px, py) {
  if (!placement) return null;
  const { x: cx, y: cy, w, h } = underlayCentre(placement);
  const mpp = placement.metresPerPixel || 1;
  const lx = px * mpp - w / 2;
  const ly = py * mpp - h / 2;
  const rad = ((placement.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  };
}

/**
 * The sheet's four corners in world space, rotated about its centre. Order is
 * top-left, top-right, bottom-right, bottom-left (pre-rotation), which is what
 * both the hit test and the on-canvas handles key off.
 */
export function placementCorners(placement) {
  if (!placement) return null;
  const { x: cx, y: cy, w, h } = underlayCentre(placement);
  const rad = ((placement.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return local.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

export function underlayCorners(doc) {
  return placementCorners(doc?.underlay);
}

function boundsOfCorners(corners) {
  if (!corners?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * World box to frame when a job opens. Plan sheets of `levelId` only ? another
 * floor's sheet is not on screen ? or, with no sheet set, the image underlay.
 */
export function underlayFrameBounds(doc, levelId) {
  if (doc?.sheetSet) {
    let box = null;
    for (const page of pagesForLevel(doc.sheetSet, levelId)) {
      if (!isPlanPage(page)) continue;
      const next = boundsOfCorners(placementCorners(page.placement));
      if (!next) continue;
      box = box
        ? {
          minX: Math.min(box.minX, next.minX),
          minY: Math.min(box.minY, next.minY),
          maxX: Math.max(box.maxX, next.maxX),
          maxY: Math.max(box.maxY, next.maxY),
        }
        : next;
    }
    return box;
  }
  return boundsOfCorners(placementCorners(doc?.underlay));
}

/** Clamp and store opacity. Silently no-ops without an underlay - the slider hides itself in that case anyway. */
export function setUnderlayOpacity(doc, value) {
  if (!doc.underlay) return;
  doc.underlay.opacity = Math.min(1, Math.max(0, Number(value)));
}

/** Normalise to [0, 360) so the field never shows a negative or huge angle. */
export function setUnderlayRotation(doc, degrees) {
  if (!doc.underlay) return;
  let d = Number(degrees) % 360;
  if (!Number.isFinite(d)) d = 0;
  if (d < 0) d += 360;
  doc.underlay.rotation = d;
}

/** Nudge rotation by a delta - the 90° buttons and the free-rotate handle both go through this. */
export function rotateUnderlayBy(doc, deltaDegrees) {
  if (!doc.underlay) return;
  setUnderlayRotation(doc, (doc.underlay.rotation || 0) + deltaDegrees);
}

/** Show/hide without discarding the placement or the bitmap - a quick toggle while drawing over it. */
export function setUnderlayHidden(doc, hidden) {
  if (!doc.underlay) return;
  if (doc.sheetSet && Number.isInteger(doc.underlay.sheetPage)) setSheetSetHidden(doc.sheetSet, hidden);
  else doc.underlay.hidden = Boolean(hidden);
}

export function toggleUnderlayHidden(doc) {
  if (!doc.underlay) return;
  setUnderlayHidden(doc, !isUnderlayHidden(doc));
}

/** True when the underlay is hidden. For a plan set the flag is one on the set, not on a page. */
export function isUnderlayHidden(doc) {
  if (!doc?.underlay) return false;
  if (doc.sheetSet && Number.isInteger(doc.underlay.sheetPage)) return Boolean(doc.sheetSet.hidden);
  return Boolean(doc.underlay.hidden);
}

// Local-space corner signs matching underlayCorners()'s TL, TR, BR, BL order.
const CORNER_SIGN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * Corner-drag scaling, proportions locked, anchored on the corner OPPOSITE
 * the one being dragged - matching Revit's own corner handles. That corner
 * stays exactly where it was for the whole drag, so a 1 m pull on the handle
 * reads as a 1 m change; a centre anchor would move both sides at once and
 * read as double that.
 *
 * `anchorWorld` and `diagUnit` (the unit vector from the anchor towards the
 * corner being dragged) are fixed for the drag's duration and computed once
 * by the caller from the pre-drag corners; `grabOffset` corrects for the
 * handle having been grabbed a little off the exact corner pixel, so the
 * sheet does not jump the instant the drag starts.
 */
export function scaleUnderlayFromCorner(doc, draggedCornerIndex, anchorWorld, diagUnit, grabOffset, pointer) {
  const placement = doc.underlay;
  if (!placement) return;

  const projected = (pointer.x - anchorWorld.x) * diagUnit.x + (pointer.y - anchorWorld.y) * diagUnit.y + grabOffset;
  const diag = Math.hypot(placement.pixelWidth, placement.pixelHeight) || 1;
  const scale = Math.max(1e-6, projected / diag);

  const w = placement.pixelWidth * scale;
  const h = placement.pixelHeight * scale;
  const anchorIndex = (draggedCornerIndex + 2) % 4;
  const [sx, sy] = CORNER_SIGN[anchorIndex];
  const rad = ((placement.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = (sx * w) / 2;
  const ly = (sy * h) / 2;
  const centreX = anchorWorld.x - (lx * cos - ly * sin);
  const centreY = anchorWorld.y - (lx * sin + ly * cos);

  placement.metresPerPixel = scale;
  placement.x = centreX - w / 2;
  placement.y = centreY - h / 2;
}

/** Plain translate - dragging the sheet itself in the select tool. */
export function moveUnderlayTo(doc, x, y) {
  if (!doc.underlay) return;
  doc.underlay.x = x;
  doc.underlay.y = y;
}


// --- multi-page PDF ---------------------------------------------------------
//
// The PDF stays open for the session: the coarse bitmaps, the sharp zoom
// render and the reference panel all draw from it. Placements and the asset
// id are what the document saves. A job with no asset id still asks for the
// file; choosing it stores the bytes so the next open does not.

let pdfjsLib = null;
/** Open files by source id. A drawing can hold several. */
const pdfs = new Map();
/**
 * Which file and which page of it each set page comes from. Set page indexes
 * are unique across sources; only the first file's pages are guaranteed to
 * equal their page number, so every read goes through here.
 */
let pageMap = new Map();
/** A freshly opened PDF that is only the source for the import dialog until the user commits it. */
let pendingPdf = null;
/** Coarse (100 dpi) bitmap per page index, drawn stretched into the 150 dpi reference space. */
const pageBitmaps = new Map();
const pageRendering = new Map();

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(/* @vite-ignore */ PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}

/** Tell the renderer where each page of the set lives. Cheap; called whenever the set's pages may have changed. */
export function registerSheetSet(set) {
  const next = new Map();
  for (const p of set?.pages || []) {
    next.set(p.index, { sourceId: p.sourceId ?? null, pdfPage: Number.isInteger(p.sourcePage) ? p.sourcePage : p.index });
  }
  pageMap = next;
}

/** The open file and page number behind a set page, or null when that file is not open. */
function locate(index) {
  const entry = pageMap.get(index);
  if (entry) {
    const pdf = pdfs.get(entry.sourceId) || (entry.sourceId == null ? pdfs.values().next().value : null);
    return pdf ? { pdf, sourceId: entry.sourceId, pdfPage: entry.pdfPage } : null;
  }
  // A page the map has not heard of: the old single-file reading.
  const only = pdfs.size === 1 ? [...pdfs.entries()][0] : null;
  return only ? { pdf: only[1], sourceId: only[0], pdfPage: index } : null;
}

function isCurrent(located) {
  return pdfs.get(located.sourceId) === located.pdf;
}

/** Drop everything cached for these set pages: bitmaps, linework and a sharp render that may be of them. */
function forgetPages(indexes) {
  const set = new Set(indexes);
  cancelSharp();
  sharp.canvas = null;
  sharp.key = null;
  for (const index of set) {
    pageBitmaps.get(index)?.close?.();
    pageBitmaps.delete(index);
    pageRendering.delete(index);
    lineworkByPage.delete(index);
  }
}

function closeSource(sourceId) {
  const indexes = [...pageMap].filter(([, v]) => v.sourceId === sourceId).map(([i]) => i);
  forgetPages(indexes);
  try {
    pdfs.get(sourceId)?.destroy();
  } catch {
    // Already gone.
  }
  pdfs.delete(sourceId);
  sourceBytes.delete(sourceId);
}

/**
 * Make the PDF opened by openPdf the open file of `sourceId`. By default
 * everything else is closed first (a new plan set replaces the old); with
 * `keepOthers` only that source's previous file is closed, which is how a
 * file is added, replaced, or reopened on its own.
 */
export function commitPendingPdf(sourceId = "src1", { keepOthers = false } = {}) {
  if (!pendingPdf) return false;
  const next = pendingPdf;
  const bytes = pendingBytes;
  pendingPdf = null;
  pendingBytes = null;
  if (keepOthers) closeSource(sourceId);
  else closePdf();
  pdfs.set(sourceId, next);
  sourceBytes.set(sourceId, bytes);
  return true;
}

/** A copy of one open file, for storing on the job. Null when it is not open. */
export function sessionPdfBytes(sourceId = "src1") {
  return sourceBytes.get(sourceId)?.slice() ?? null;
}

/** True when the file of this source is open in the session. */
export function isSourceOpen(sourceId) {
  return pdfs.has(sourceId);
}

/** Sources of the set whose file is not open, in order. */
export function sourcesNeedingFile(doc) {
  return (doc?.sheetSet?.sources || []).filter((s) => s.mime !== "satellite" && !pdfs.has(s.id));
}

export function setPdfRestorePending(pending) {
  pdfRestorePending = Boolean(pending);
}

export function isPdfRestorePending() {
  return pdfRestorePending;
}

/** Drop a PDF opened for the dialog that the user then cancelled; the session's PDF is untouched. */
export function discardPendingPdf() {
  try {
    pendingPdf?.destroy();
  } catch {
    // Already gone.
  }
  pendingPdf = null;
  pendingBytes = null;
}

export function hasOpenPdf() {
  return pdfs.size > 0;
}

export function closePdf() {
  cancelSharp();
  sharp.canvas = null;
  sharp.key = null;
  pageRendering.clear();
  for (const bmp of pageBitmaps.values()) bmp.close?.();
  pageBitmaps.clear();
  clearLinework();
  for (const pdf of pdfs.values()) {
    try {
      pdf.destroy();
    } catch {
      // Nothing useful to do if the worker is already gone.
    }
  }
  pdfs.clear();
  sourceBytes.clear();
  pageMap = new Map();
  // Anything that closes the session's PDF is replacing the underlay, so a
  // removed one can no longer be brought back.
  discardStash();
}

/** Top-level bookmark titles keyed by the page index they point at. */
async function readBookmarkTitles(pdf) {
  const titles = new Map();
  let outline = null;
  try {
    outline = await pdf.getOutline();
  } catch {
    return titles;
  }
  const visit = async (items, depth) => {
    for (const item of items || []) {
      let found = false;
      try {
        let dest = item.dest;
        if (typeof dest === "string") dest = await pdf.getDestination(dest);
        if (Array.isArray(dest)) {
          const ref = dest[0];
          const index = ref && typeof ref === "object" ? await pdf.getPageIndex(ref) : ref;
          if (Number.isInteger(index) && !titles.has(index)) {
            titles.set(index, item.title);
            found = true;
          }
        }
      } catch {
        // A broken destination just leaves that page as "Page n".
      }
      if (!found && depth < 2) await visit(item.items, depth + 1);
    }
  };
  await visit(outline, 0);
  return titles;
}

/**
 * Open a PDF and describe every page: size in reference pixels (rotation
 * applied) and its bookmark title if it has one. Keeps the document open.
 */
export async function openPdf(file) {
  let lib;
  try {
    lib = await loadPdfjs();
  } catch {
    return { ok: false, message: "The PDF renderer could not be loaded. Export the page as PNG and import that instead." };
  }
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    // pdf.js transfers the buffer to its worker, which would leave us nothing
    // to store. Keep a copy before handing it over.
    const kept = data.slice();
    const pdf = await lib.getDocument({ data }).promise;
    const titles = await readBookmarkTitles(pdf);
    const pages = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const size = referencePixelSize(viewport.width, viewport.height);
      pages.push({
        index: i,
        widthPt: viewport.width,
        heightPt: viewport.height,
        rotation: page.rotate || 0,
        title: titles.get(i) ?? null,
        ...size,
      });
    }
    pendingPdf?.destroy?.();
    pendingPdf = pdf;
    pendingBytes = kept;
    return { ok: true, name: file.name, pages };
  } catch (err) {
    return { ok: false, message: `Could not read that PDF: ${err.message}` };
  }
}

/** A small data-URL thumbnail for the import dialog. */
export async function renderThumbnail(index, maxEdge = 160) {
  const source = pendingPdf || pdfs.values().next().value;
  if (!source) return null;
  try {
    const page = await source.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxEdge / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Render a page into a visible canvas at `scale` pixels per PDF point (reference panel). */
export function renderReferencePage(index, canvas, scale) {
  let task = null;
  let cancelled = false;
  const promise = (async () => {
    const located = locate(index);
    if (!located) return false;
    const page = await located.pdf.getPage(located.pdfPage + 1);
    if (cancelled) return false;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    task = page.render({ canvasContext: context, viewport });
    try {
      await task.promise;
      return true;
    } catch {
      return false;
    }
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** True once this page's coarse bitmap exists, which is when the sheet can appear. */
export function isPageBitmapReady(index) {
  return pageBitmaps.has(index);
}

function ensurePageBitmap(index) {
  if (pageBitmaps.has(index)) return Promise.resolve(pageBitmaps.get(index));
  if (pageRendering.has(index)) return pageRendering.get(index);
  const located = locate(index);
  if (!located) return Promise.resolve(null);
  const job = (async () => {
    try {
      const page = await located.pdf.getPage(located.pdfPage + 1);
      const viewport = page.getViewport({ scale: COARSE_DPI / 72 });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const bmp = canvas.transferToImageBitmap();
      if (isCurrent(located)) pageBitmaps.set(index, bmp);
      return bmp;
    } catch {
      return null;
    } finally {
      pageRendering.delete(index);
    }
  })();
  pageRendering.set(index, job);
  return job;
}

/**
 * Make `doc.underlay` the placement of the sheet assigned to `levelId`, so every
 * existing `store.doc.underlay` use keeps working unchanged. Returns true when
 * the underlay changed (the caller should refresh its panels). A level with no
 * sheet gets no underlay, but a plain image or satellite underlay is left alone.
 */
export function activateSheetForLevel(doc, levelId) {
  const set = doc.sheetSet;
  if (!set) return false;
  registerSheetSet(set);
  const page = resolveActivePage(set, levelId);
  if (!page) {
    if (doc.underlay && Number.isInteger(doc.underlay.sheetPage)) {
      doc.underlay = null;
      bitmap = null;
      heldSheet = null;
      return true;
    }
    return false;
  }
  if (doc.underlay === page.placement && bitmap) return false;
  const previous = bitmap && doc.underlay ? { placement: doc.underlay, bitmap } : heldSheet;
  doc.underlay = page.placement;
  bitmap = pageBitmaps.get(page.index) || null;
  // Keep the previous sheet where it was until this page's pixels exist.
  // Drawing nothing, or drawing both, is what makes the plan jump.
  heldSheet = bitmap || !previous || previous.placement === page.placement ? null : previous;
  cancelSharp();
  restoring = null;
  return true;
}

/** Install a freshly imported sheet set, replacing any current underlay, and show the sheet for levelId. */
export function adoptSheetSet(doc, set, levelId) {
  commitPendingPdf(set.sources?.[0]?.id ?? "src1");
  doc.sheetSet = set;
  doc.underlay = null;
  bitmap = null;
  restoring = null;
  return activateSheetForLevel(doc, levelId);
}

/**
 * Open the file just read by openPdf as `sourceId` of the current set, beside
 * the files already open. The set's pages must already include that source's
 * pages (addSource / replaceSource / applyRevision). Everything cached for the
 * source's old pages is dropped, and the sheet for `levelId` is shown again.
 * Returns true when the underlay changed.
 */
export function attachSourceFile(doc, sourceId, levelId) {
  commitPendingPdf(sourceId, { keepOthers: true });
  registerSheetSet(doc.sheetSet);
  // A retained page of a replaced file keeps its placement but not its pixels.
  const own = new Set((doc.sheetSet?.pages || []).filter((p) => p.sourceId === sourceId).map((p) => p.index));
  forgetPages([...own]);
  if (Number.isInteger(doc.underlay?.sheetPage) && own.has(doc.underlay.sheetPage)) bitmap = null;
  const before = doc.underlay;
  const changed = activateSheetForLevel(doc, levelId);
  return changed || doc.underlay !== before;
}

/** Close one file and forget everything cached for its pages (it was removed from the set). Call before the set's pages change. */
export function dropSourceFile(sourceId) {
  closeSource(sourceId);
}

/**
 * The active sheet's coarse bitmap, rendered on demand. Returns null when
 * nothing is needed, else a promise of whether it is now showing.
 */
export function ensureSheetBitmap(doc) {
  const placement = doc.underlay;
  if (!pdfs.size || !placement || !Number.isInteger(placement.sheetPage) || bitmap) return null;
  const index = placement.sheetPage;
  return ensurePageBitmap(index).then((bmp) => {
    if (bmp && doc.underlay === placement && !bitmap) {
      bitmap = bmp;
      heldSheet = null;
      return true;
    }
    return false;
  });
}

/** True when the document has a file this session has not opened (and none is being fetched). */
export function sheetSetNeedsPdf(doc) {
  return Boolean(doc.sheetSet && !pdfRestorePending && sourcesNeedingFile(doc).length);
}

/**
 * Put a stored image (or a single-page PDF) back under the placement the
 * document already has. Does not move or replace that placement.
 */
export async function showStoredUnderlay(doc, file) {
  const placement = doc.underlay;
  if (!placement || placement.source?.type === "satellite") {
    return { ok: false, message: "No stored underlay." };
  }
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  const image = isPdf ? await renderPdfFirstPage(file) : await loadImage(file);
  if (!image.ok) return image;
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const closeEnough = (got, expected) => Math.abs(got - expected) <= expected * 0.02;
  if (!closeEnough(width, placement.pixelWidth) || !closeEnough(height, placement.pixelHeight)) {
    image.bitmap.close?.();
    return { ok: false, message: "The stored file does not match the sheet on this drawing." };
  }
  bitmap = image.bitmap;
  restoring = null;
  return { ok: true };
}

/** Make the placement of `page` (already in doc.sheetSet) the visible underlay and note it as the level's choice. */
export function chooseSheet(doc, pageIndex) {
  const set = doc.sheetSet;
  const page = set?.pages.find((p) => p.index === pageIndex);
  if (!page?.placement) return false;
  set.activeByLevel[page.levelId] = page.index;
  return activateSheetForLevel(doc, page.levelId);
}

// --- sharp render ---------------------------------------------------------
//
// The coarse bitmap is what pans smoothly. When the view settles, the page is
// rendered by pdf.js straight into a screen-sized canvas through one transform
// (placement scale, offset and rotation), so linework stays crisp at any zoom
// and the cost follows the screen, not the sheet.

const SHARP_DELAY_MS = 150;
const sharp = { canvas: null, key: null, pending: null, timer: 0, task: null, token: 0, busy: false, failedKey: null, listener: null };

/** Called with `true` when a sharp render starts or is waiting, `false` when idle, so the UI can show "sharpening". */
export function setSharpListener(listener) {
  sharp.listener = listener;
}

export function isSharpening() {
  return sharp.busy || Boolean(sharp.timer);
}

function notifySharp() {
  sharp.listener?.(isSharpening());
}

function cancelSharp() {
  clearTimeout(sharp.timer);
  sharp.timer = 0;
  sharp.pending = null;
  sharp.token++;
  try {
    sharp.task?.cancel();
  } catch {
    // The task may already have finished.
  }
  sharp.task = null;
  sharp.busy = false;
}

/** Canvas matrix taking reference pixels (origin top-left, unrotated) to device pixels. */
export function sheetToDeviceMatrix(placement, centreScreen, camScale, dpr) {
  const s = placement.metresPerPixel * camScale * dpr;
  const rad = ((placement.rotation || 0) * Math.PI) / 180;
  const a = s * Math.cos(rad);
  const b = s * Math.sin(rad);
  const c = -b;
  const d = a;
  const hw = placement.pixelWidth / 2;
  const hh = placement.pixelHeight / 2;
  return [a, b, c, d, centreScreen[0] * dpr - a * hw - c * hh, centreScreen[1] * dpr - b * hw - d * hh];
}

function scheduleSharp(pending) {
  if (sharp.pending?.key === pending.key || sharp.failedKey === pending.key) return;
  cancelSharp();
  sharp.pending = pending;
  sharp.timer = setTimeout(() => runSharp(pending), SHARP_DELAY_MS);
  notifySharp();
}

async function runSharp(pending) {
  sharp.timer = 0;
  const located = locate(pending.pageIndex);
  if (!located) return;
  const token = ++sharp.token;
  sharp.busy = true;
  notifySharp();
  try {
    const page = await located.pdf.getPage(located.pdfPage + 1);
    if (token !== sharp.token) return;
    const viewport = page.getViewport({ scale: REFERENCE_DPI / 72 });
    const canvas = new OffscreenCanvas(pending.width, pending.height);
    const context = canvas.getContext("2d");
    // White paper only where the sheet is, so the rest of the canvas stays clear.
    context.setTransform(...pending.matrix);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, viewport.width, viewport.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const task = page.render({ canvasContext: context, viewport, transform: pending.matrix, background: "rgba(0,0,0,0)" });
    sharp.task = task;
    await task.promise;
    if (token !== sharp.token) return;
    sharp.canvas = canvas;
    sharp.key = pending.key;
  } catch (err) {
    if (err?.name !== "RenderingCancelledException" && token === sharp.token) sharp.failedKey = pending.key;
  } finally {
    if (token === sharp.token) {
      sharp.busy = false;
      sharp.task = null;
      sharp.pending = null;
      notifySharp();
      sharp.onReady?.();
    }
  }
}

/** Ask to be redrawn when a sharp render lands. */
export function setSharpReady(fn) {
  sharp.onReady = fn;
}

/**
 * Draw beneath everything else. Returns false when there is nothing to draw
 * (including hidden). Draws the sharp render when it matches the current view,
 * else the coarse bitmap, and (re)schedules a sharp render for when the view
 * settles.
 */
function paintSheet(ctx, placement, image, worldToScreen, camScale) {
  const { x: cx, y: cy, w, h } = underlayCentre(placement);
  const [scx, scy] = worldToScreen(cx, cy);
  ctx.save();
  ctx.translate(scx, scy);
  ctx.rotate(((placement.rotation || 0) * Math.PI) / 180);
  ctx.globalAlpha = placement.opacity ?? 0.55;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, (-w * camScale) / 2, (-h * camScale) / 2, w * camScale, h * camScale);
  ctx.restore();
}

export function drawUnderlay(ctx, doc, worldToScreen, camScale) {
  const placement = doc.underlay;
  if (!placement || isUnderlayHidden(doc)) return false;
  const currentPage = doc.sheetSet?.pages.find((p) => p.index === placement.sheetPage);
  // The eye hid the sheet you are on. Other sheets of this floor still draw.
  if (currentPage?.suppressed) {
    drawShownSheets(ctx, doc, worldToScreen, camScale);
    drawGhost(ctx, doc, worldToScreen, camScale);
    return false;
  }
  // The chosen page is not ready: leave the previous sheet exactly where it
  // was. A second sheet is not drawn on top of it while this one loads.
  if (!bitmap && heldSheet?.bitmap) {
    paintSheet(ctx, heldSheet.placement, heldSheet.bitmap, worldToScreen, camScale);
    return true;
  }
  if (!bitmap) return false;
  heldSheet = null;

  drawShownSheets(ctx, doc, worldToScreen, camScale);

  const { x: cx, y: cy, w, h } = underlayCentre(placement);
  const [scx, scy] = worldToScreen(cx, cy);
  const sw = w * camScale;
  const sh = h * camScale;
  const rotation = ((placement.rotation || 0) * Math.PI) / 180;

  // Sharp layer: only for a PDF page whose coarse bitmap would be stretched past 1:1.
  let drewSharp = false;
  if (pdfs.size && Number.isInteger(placement.sheetPage)) {
    const dpr = ctx.getTransform().a || 1;
    const stretch = placement.metresPerPixel * camScale * dpr;
    const matrix = sheetToDeviceMatrix(placement, [scx, scy], camScale, dpr);
    const key = `${placement.sheetPage}|${matrix.map((n) => n.toFixed(3)).join(",")}|${ctx.canvas.width}x${ctx.canvas.height}`;
    if (stretch > COARSE_DPI / REFERENCE_DPI) {
      if (sharp.canvas && sharp.key === key) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = placement.opacity;
        ctx.drawImage(sharp.canvas, 0, 0);
        ctx.restore();
        drewSharp = true;
      } else {
        scheduleSharp({ key, matrix, pageIndex: placement.sheetPage, width: ctx.canvas.width, height: ctx.canvas.height });
      }
    } else if (sharp.pending || sharp.timer) {
      cancelSharp();
      notifySharp();
    }
  }

  ctx.save();
  ctx.translate(scx, scy);
  ctx.rotate(rotation);
  if (!drewSharp) {
    ctx.globalAlpha = placement.opacity;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, -sw / 2, -sh / 2, sw, sh);
  }
  if (!placement.calibrated) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#9a6b1f";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
  }
  ctx.restore();
  // After the sheet, so its paper does not hide the reference, and drawn so
  // only the reference's ink shows (see drawGhost).
  drawGhost(ctx, doc, worldToScreen, camScale);
  return true;
}

// --- aligning sheets --------------------------------------------------------
//
// Sheets rarely line up by their page corners: the drawing sits at a different
// place on each page. That is true of two floors, and of two drawings of one
// floor (walls on one sheet, services or furniture on another). The user marks
// the same fixed feature (a building corner) on each sheet; the mark is stored
// as a pixel on the sheet, so it survives moving, scaling and rotating. The
// datum stays put: the lowest floor, or, when the sheets share a level, the
// earliest page. Every other marked sheet is translated so its mark lands on
// the datum's mark. Translation only: the sheets are assumed to share scale
// and orientation once calibrated.

/** Page indexes drawn faintly beneath the active sheet so an alignment can be checked by eye. */
let ghostIndexes = [];
let ghostNotify = null;

/** Replace the faint sheets. Loads any bitmap not yet rendered and calls `onReady` when one arrives. */
export function setGhostSheets(indexes, onReady) {
  ghostNotify = onReady || null;
  const next = [...new Set((indexes || []).filter(Number.isInteger))].sort((a, b) => a - b);
  if (next.join() === ghostIndexes.join()) return;
  ghostIndexes = next;
  for (const index of ghostIndexes) {
    if (!pageBitmaps.has(index)) {
      ensurePageBitmap(index).then((bmp) => {
        if (bmp) ghostNotify?.();
      });
    }
  }
}

export function ghostSheetIndexes() {
  return ghostIndexes.slice();
}

const KIND_RANK = { ground: 0, first: 1, site: 2 };

function datumPage(set, levelOrder) {
  const order = (id) => {
    const i = levelOrder.indexOf(id);
    return i === -1 ? levelOrder.length : i;
  };
  return set.pages
    .filter((p) => p.placement && p.anchor)
    .sort((a, b) => order(a.levelId) - order(b.levelId) || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.index - b.index)[0] || null;
}

/** Mark world point (wx, wy) as the alignment point of the sheet now showing, then align. */
export function markAlignmentPoint(doc, wx, wy, levelOrder = []) {
  const placement = doc.underlay;
  const set = doc.sheetSet;
  const page = set?.pages.find((p) => p.index === placement.sheetPage);
  if (!page) return { ok: false, message: "Show a sheet from an imported plan set first." };
  page.anchor = underlayPixelFromWorld(placement, wx, wy);
  return { ok: true, ...alignSheets(doc, levelOrder), page };
}

/** Translate every marked sheet onto the datum's mark. Returns { moved: [page indexes], datum: page|null }. */
export function alignSheets(doc, levelOrder = []) {
  const set = doc.sheetSet;
  const datum = set ? datumPage(set, levelOrder) : null;
  if (!datum) return { moved: [], datum: null };
  const target = underlayWorldFromPixel(datum.placement, datum.anchor.x, datum.anchor.y);
  const moved = [];
  for (const page of set.pages) {
    if (!page.placement || !page.anchor || page === datum) continue;
    const here = underlayWorldFromPixel(page.placement, page.anchor.x, page.anchor.y);
    const dx = target.x - here.x;
    const dy = target.y - here.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
    page.placement.x += dx;
    page.placement.y += dy;
    moved.push(page.index);
  }
  return { moved, datum };
}

/** World position of a sheet's alignment mark, or null. */
export function alignmentPointWorld(page) {
  return page?.anchor && page.placement ? underlayWorldFromPixel(page.placement, page.anchor.x, page.anchor.y) : null;
}

let shownNotify = null;

/** Ask to be redrawn when the coarse bitmap of a shown sheet lands. */
export function setShownSheetsReady(fn) {
  shownNotify = fn;
}

/**
 * Other sheets of the current floor marked shown, painted beneath the current
 * one. Multiply knocks out the paper; each uses its own opacity. They are
 * never hit-tested. Sheets also in the align ghost list are skipped there.
 */
function drawShownSheets(ctx, doc, worldToScreen, camScale) {
  const set = doc.sheetSet;
  if (!set || !Number.isInteger(doc.underlay?.sheetPage)) return;
  for (const page of shownPagesBeside(set, doc.underlay.sheetPage)) {
    if (ghostIndexes.includes(page.index)) continue;
    const bmp = pageBitmaps.get(page.index);
    if (!bmp) {
      ensurePageBitmap(page.index).then((b) => {
        if (b) shownNotify?.();
      });
      continue;
    }
    const p = page.placement;
    const { x: cx, y: cy, w, h } = underlayCentre(p);
    const [scx, scy] = worldToScreen(cx, cy);
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate(((p.rotation || 0) * Math.PI) / 180);
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = p.opacity ?? 0.55;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (-w * camScale) / 2, (-h * camScale) / 2, w * camScale, h * camScale);
    ctx.restore();
  }
}

/**
 * The other sheet, over the one being aligned. Multiply drops the white
 * paper, so only its ink darkens the sheet underneath, and only slightly -
 * enough to see where the two drawings meet, not a second copy of the detail.
 */
function drawGhost(ctx, doc, worldToScreen, camScale) {
  if (!ghostIndexes.length || !doc.sheetSet) return;
  for (const index of ghostIndexes) {
    const page = doc.sheetSet.pages.find((p) => p.index === index);
    const bmp = pageBitmaps.get(index);
    const p = page?.placement;
    if (!p || !bmp || p === doc.underlay) continue;
    const { x: cx, y: cy, w, h } = underlayCentre(p);
    const [scx, scy] = worldToScreen(cx, cy);
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate(((p.rotation || 0) * Math.PI) / 180);
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.18;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, (-w * camScale) / 2, (-h * camScale) / 2, w * camScale, h * camScale);
    ctx.restore();
  }
}

// --- snap to PDF linework -------------------------------------------------
//
// Operator lists are walked once per page, then cached as a grid of endpoints
// and crossings in the same reference-pixel space as the placement. Extraction
// starts the first time a snap is asked for, so opening a sheet is not delayed
// by a dense hatch.

const lineworkByPage = new Map();
let lineworkListener = null;

function clearLinework() {
  lineworkByPage.clear();
}

/** idle | loading | ready | empty | failed */
export function pageLineworkStatus(index) {
  return lineworkByPage.get(index)?.status ?? "idle";
}

export function pageLinework(index) {
  const entry = lineworkByPage.get(index);
  return entry?.status === "ready" || entry?.status === "empty" ? entry.work : null;
}

export function setLineworkListener(listener) {
  lineworkListener = listener;
}

function notifyLinework(index, status) {
  lineworkListener?.(index, status);
}

/**
 * Extract (or return cached) linework for a page. Resolves to the work object
 * or null if the PDF is gone / the page failed. Safe to call on every hover.
 */
export function ensurePageLinework(index) {
  if (!Number.isInteger(index) || index < 0) return Promise.resolve(null);
  const located = locate(index);
  if (!located) return Promise.resolve(null);
  const existing = lineworkByPage.get(index);
  if (existing?.promise) return existing.promise;
  const entry = { status: "loading", work: null, promise: null };
  lineworkByPage.set(index, entry);
  notifyLinework(index, "loading");
  entry.promise = (async () => {
    try {
      const page = await located.pdf.getPage(located.pdfPage + 1);
      if (!isCurrent(located)) return null;
      const opList = await page.getOperatorList();
      if (!isCurrent(located)) return null;
      const viewport = page.getViewport({ scale: REFERENCE_DPI / 72 });
      const work = buildLinework(opList.fnArray, opList.argsArray, {
        ops: pdfjsLib?.OPS || DEFAULT_OPS,
        baseCtm: viewport.transform,
      });
      if (!isCurrent(located)) return null;
      entry.work = work;
      entry.status = work.stats.segments ? "ready" : "empty";
      notifyLinework(index, entry.status);
      return work;
    } catch {
      if (isCurrent(located)) {
        entry.status = "failed";
        notifyLinework(index, "failed");
      }
      return null;
    }
  })();
  return entry.promise;
}

/**
 * Snap a world point onto the active sheet's PDF linework. `tolWorld` is the
 * same screen-pixel tolerance the wall snap uses, in metres. Null when the
 * page has not been extracted yet, has no vectors, or nothing is close enough.
 */
export function snapUnderlayWorld(placement, wx, wy, tolWorld) {
  if (!placement || !Number.isInteger(placement.sheetPage) || !(tolWorld > 0)) return null;
  const work = pageLinework(placement.sheetPage);
  if (!work?.stats.segments) return null;
  const pixel = underlayPixelFromWorld(placement, wx, wy);
  if (!pixel) return null;
  const radiusPx = tolWorld / (placement.metresPerPixel || 1);
  const hit = snapLinework(work, pixel.x, pixel.y, radiusPx);
  if (!hit) return null;
  const world = underlayWorldFromPixel(placement, hit.x, hit.y);
  if (!world) return null;
  return {
    x: world.x,
    y: world.y,
    kind: hit.kind === "intersection" ? "pdf-cross" : "pdf-end",
    pixel: { x: hit.x, y: hit.y },
  };
}

/** Snap a point already in reference pixels (the reference-panel measure). */
export function snapReferencePixel(pageIndex, x, y, radiusPx) {
  const work = pageLinework(pageIndex);
  if (!work?.stats.segments) return null;
  const hit = snapLinework(work, x, y, radiusPx);
  return hit ? { x: hit.x, y: hit.y, kind: hit.kind === "intersection" ? "pdf-cross" : "pdf-end" } : null;
}
