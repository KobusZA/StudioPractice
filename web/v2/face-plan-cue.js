// Plan mark for the wall face open in the elevation strip.
// Screen-pixel corners, so they stay readable when a metre offset has
// collapsed into the wall stroke. The strip draws them; this file only
// decides their shape and when a short face needs a closer zoom.

/** Below this on-screen length the face is too small for the corners. */
export const FACE_CUE_MIN_PX = 80;
/** Zoom a short face up to about this, and no further. */
export const FACE_CUE_TARGET_PX = 120;
/** Leg along the face, toward the other end. */
export const FACE_CORNER_ALONG = 14;
/** Leg perpendicular to the face, on the viewed side. */
export const FACE_CORNER_OUT = 10;
/** How far outside each end a corner starts before it settles. */
export const FACE_CORNER_TRAVEL = 18;
/** Corners draw themselves in, then the face line pulses. */
export const FACE_CUE_INTRO_MS = 280;
export const FACE_CUE_PULSE_MS = 1000;
/** Hairline and corners left on the plan while the elevation stays open. */
export const FACE_CUE_REST_ALPHA = 0.4;
/** The pan that brings a face into the clear plan lasts about this long. */
export const FACE_PAN_MS = 200;
/** Breathing room kept around the face, as a share of the clear area (each side), capped in px. */
export const FACE_FRAME_MARGIN = 0.12;
export const FACE_FRAME_MARGIN_MAX_PX = 80;

/**
 * Scale so a face shorter than {@link FACE_CUE_MIN_PX} becomes about
 * {@link FACE_CUE_TARGET_PX}. A face already long enough, or a zero length,
 * keeps `scale`. Never exceeds `maxScale`.
 */
export function faceCueZoom(screenLen, scale, maxScale) {
  if (!(screenLen >= 1) || screenLen >= FACE_CUE_MIN_PX) return scale;
  return Math.min(maxScale, scale * (FACE_CUE_TARGET_PX / screenLen));
}

/**
 * How far to slide the plan, in screen pixels, so a face is in the part of the
 * plan that nothing covers.
 *
 * `bounds` is the face and its marks, `{ minX, maxX, minY, maxY }`, in canvas
 * pixels. `view` is the clear plan area, `{ w, h }`, from the canvas's top left
 * (the elevation strip, once open, covers what lies below `h`).
 *
 * `mode`:
 * - `"fit"` (opening a face): an axis moves only when the face does not sit
 *   wholly inside the area with its margin. When it moves, the face is
 *   centred on that axis. A face wider than the area is centred on its middle;
 *   the zoom is never changed.
 * - `"rescue"` (the strip was resized): an axis moves only when the face has no
 *   part left in the area at all.
 *
 * Returns `{ dx, dy }`, both 0 when nothing needs to move.
 */
export function faceFrameShift(bounds, view, mode = "fit") {
  if (!bounds || !view || !(view.w > 0) || !(view.h > 0)) return { dx: 0, dy: 0 };
  const axis = (near, far, size) => {
    const margin = Math.min(size * FACE_FRAME_MARGIN, FACE_FRAME_MARGIN_MAX_PX);
    const centre = size / 2 - (near + far) / 2;
    if (mode === "rescue") return far < 0 || near > size ? centre : 0;
    if (near >= margin && far <= size - margin) return 0;
    // Close enough to fitting that centring would not help: a face that
    // already spans the area stays put once it covers it.
    if (near <= 0 && far >= size) return 0;
    return centre;
  };
  return {
    dx: axis(bounds.minX, bounds.maxX, view.w),
    dy: axis(bounds.minY, bounds.maxY, view.h),
  };
}

/**
 * Two L corners for one face, in screen pixels.
 * `settle` 0 sits each vertex {@link FACE_CORNER_TRAVEL} px outside its end;
 * `settle` 1 puts the vertex on the end. The long leg runs inward along the
 * face. The short leg runs along `(nx, ny)`, the viewed side, so the L opens
 * toward that side. Returns `[]` when the face is shorter than a pixel.
 * Each mark is `[along, vertex, side]`.
 */
export function faceCornerMarks(ax, ay, bx, by, nx, ny, settle) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len;
  const uy = dy / len;
  const nlen = Math.hypot(nx, ny) || 1;
  const snx = nx / nlen;
  const sny = ny / nlen;
  const along = Math.min(FACE_CORNER_ALONG, len * 0.3);
  const t = Math.min(1, Math.max(0, Number(settle) || 0));
  const travel = (1 - t) * Math.min(FACE_CORNER_TRAVEL, len * 0.35);
  const corner = (px, py, ix, iy) => {
    const vx = px - ix * travel;
    const vy = py - iy * travel;
    return [
      [vx + ix * along, vy + iy * along],
      [vx, vy],
      [vx + snx * FACE_CORNER_OUT, vy + sny * FACE_CORNER_OUT],
    ];
  };
  return [
    corner(ax, ay, ux, uy),
    corner(bx, by, -ux, -uy),
  ];
}
