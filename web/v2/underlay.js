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

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs";

/**
 * The bitmap is deliberately kept out of the document. A data URL for a
 * scanned A1 sheet is several megabytes and localStorage holds about five, so
 * persisting it would silently evict the drawing itself. The document stores
 * the placement, this module holds the pixels for the session.
 */
let bitmap = null;

export function underlayBitmap() {
  return bitmap;
}

export function clearUnderlay(doc) {
  bitmap = null;
  doc.underlay = null;
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
  };
}

export async function loadUnderlayFile(doc, file) {
  if (!file) return { ok: false, message: "No file chosen." };

  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const image = isPdf ? await renderPdfFirstPage(file) : await loadImage(file);
  if (!image.ok) return image;

  bitmap = image.bitmap;
  doc.underlay = defaultPlacement(file.name, image.bitmap.width, image.bitmap.height);
  return { ok: true, message: `${file.name} loaded. Calibrate the scale before tracing.` };
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
  if (!(realMetres > 0)) return { ok: false, message: "Enter the real distance in metres." };

  // Keep the first calibration point anchored so the drawing does not jump.
  const scale = realMetres / pixelDistance;
  const ratio = scale / placement.metresPerPixel;
  placement.x = a.x - (a.x - placement.x) * ratio;
  placement.y = a.y - (a.y - placement.y) * ratio;
  placement.metresPerPixel = scale;
  placement.calibrated = true;

  return { ok: true, message: `Scale set: ${realMetres} m across ${Math.round(pixelDistance)} px.`, metresPerPixel: scale };
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
export function underlayCorners(doc) {
  const placement = doc.underlay;
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
  doc.underlay.hidden = Boolean(hidden);
}

export function toggleUnderlayHidden(doc) {
  if (!doc.underlay) return;
  doc.underlay.hidden = !doc.underlay.hidden;
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

/** Draw beneath everything else. Returns false when there is nothing to draw (including hidden). */
export function drawUnderlay(ctx, doc, worldToScreen, camScale) {
  const placement = doc.underlay;
  if (!placement || !bitmap || placement.hidden) return false;

  const { x: cx, y: cy, w, h } = underlayCentre(placement);
  const [scx, scy] = worldToScreen(cx, cy);
  const sw = w * camScale;
  const sh = h * camScale;

  ctx.save();
  ctx.translate(scx, scy);
  ctx.rotate(((placement.rotation || 0) * Math.PI) / 180);
  ctx.globalAlpha = placement.opacity;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();

  if (!placement.calibrated) {
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate(((placement.rotation || 0) * Math.PI) / 180);
    ctx.strokeStyle = "#9a6b1f";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
  return true;
}
