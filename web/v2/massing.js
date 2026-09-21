// 3D massing view for the v2 core (Output > Views > 3D).
//
// Deliberately independent of the compliance engine (Week 2) and the sheet /
// PDF system (Week 3): it only extrudes what compile() already emits -
// profileLoops, depth and, since this file needed it, per-object elevation.
// Camera (Output > Views > Camera) is the same extrusion from a standing
// eye, not a second model. Section (Document > Views > Section) is the same
// extrusion on a vertical cut. No Revit mesh ingestion (that lives in
// web/extras.js against the old planner). Generate model is a separate step
// that consumes a snapshot of this view rather than replacing the extrusion.
//
// Ported from web/extras.js's massing renderer, trimmed of what v1 needed
// and v2 does not:
//  - No Revit `meshes` path - v2 has no live Revit extract, only compile().
//  - No baseline/diff colouring - that was the before/after compare tab.
//  - No multi-plan grouping - v1 grouped forms by a shared "plan" elevation
//    because a Revit extract came back as separate FloorPlan views. v2's
//    compile() instead stamps each form with its own `elevation` (added
//    alongside this file), so every kind is walked once, keyed by its own z0.

import { roofRidgeAlongX } from "./roof.js";
import { clipFacesForSection, projectSectionPoint, sectionFrame } from "./section.js";

/** Tilt down from horizontal, in radians. The opening view stays a 3/4
 *  look so a typical 30° gable still reads as a roof, not an elevation.
 *  Orbit itself can drop toward an elevation and rise toward plan: the
 *  old min of ~41° was a workaround for a ridge-sliver bug that roof
 *  tessellation already fixed. Stay off 0 and π/2 so faces do not go
 *  fully edge-on or lose yaw at true top-down. */
export const MASSING_PITCH_MIN = 0.12;
export const MASSING_PITCH_MAX = 1.52;
export const MASSING_PITCH_DEFAULT = 0.95;
export const MASSING_YAW_DEFAULT = 0.95;

/** Standing eye height above the active storey datum. A viewing parameter,
 *  not a building fact: the plan already sits on that datum, and 1.6 m is
 *  the height a person looks from, stated rather than inferred from a SKU. */
export const EYE_HEIGHT_M = 1.6;
export const LOOK_FOV_DEFAULT = Math.PI / 3;
export const LOOK_FOV_MIN = (25 * Math.PI) / 180;
export const LOOK_FOV_MAX = (85 * Math.PI) / 180;
export const LOOK_PITCH_MIN = -0.55;
export const LOOK_PITCH_MAX = 0.55;
export const LOOK_NEAR = 0.15;

/** Camera state: yaw/pitch in radians, scale in canvas pixels per plan unit. */
export function createCamera() {
  return { mode: "orbit", yaw: MASSING_YAW_DEFAULT, pitch: MASSING_PITCH_DEFAULT, scale: 18 };
}

/**
 * A 3/4 view of the eaves rectangle, never along a roof slope.
 *
 * Landscape footprints keep the default yaw (looking along +Y). Portrait
 * ones would otherwise present the long wall face-on, which is also looking
 * along a gable's pitch - the "thin blue plank floating beside the box".
 */
export function frameCamera(cam, bounds) {
  const dx = (bounds?.maxX ?? 0) - (bounds?.minX ?? 0);
  const dy = (bounds?.maxY ?? 0) - (bounds?.minY ?? 0);
  cam.mode = "orbit";
  cam.pitch = MASSING_PITCH_DEFAULT;
  cam.scale = 18;
  cam.yaw = dy > dx + 0.05 ? MASSING_YAW_DEFAULT - Math.PI / 2 : MASSING_YAW_DEFAULT;
  return cam;
}

/**
 * Revit Camera: eye on plan, look-at on plan, horizontal gaze at standing
 * height. Returns null when the two clicks are the same point.
 * Yaw 0 looks toward +Y (plan north). Pitch 0 is horizontal.
 */
export function lookFromClicks(eye, target, eyeZ = EYE_HEIGHT_M) {
  const ex = Number(eye?.[0] ?? eye?.x);
  const ey = Number(eye?.[1] ?? eye?.y);
  const tx = Number(target?.[0] ?? target?.x);
  const ty = Number(target?.[1] ?? target?.y);
  if (![ex, ey, tx, ty, eyeZ].every(Number.isFinite)) return null;
  const dist = Math.hypot(tx - ex, ty - ey);
  if (dist < 0.2) return null;
  return {
    mode: "look",
    eye: [ex, ey, eyeZ],
    lookDist: dist,
    yaw: Math.atan2(tx - ex, ty - ey),
    pitch: 0,
    fov: LOOK_FOV_DEFAULT,
  };
}

export function lookAxes(cam) {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  const forward = [sy * cp, cy * cp, sp];
  const rlen = Math.hypot(forward[1], forward[0]) || 1;
  const right = [forward[1] / rlen, -forward[0] / rlen, 0];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up };
}

export function projectLookPoint(x, y, z, cam, cx, cy, height) {
  const { forward, right, up } = lookAxes(cam);
  const px = x - cam.eye[0];
  const py = y - cam.eye[1];
  const pz = z - cam.eye[2];
  const camX = px * right[0] + py * right[1] + pz * right[2];
  const camY = px * up[0] + py * up[1] + pz * up[2];
  const camZ = px * forward[0] + py * forward[1] + pz * forward[2];
  const fov = Number(cam.fov) > 0 ? cam.fov : LOOK_FOV_DEFAULT;
  const focal = (height / 2) / Math.tan(fov / 2);
  const depth = camZ > LOOK_NEAR ? camZ : LOOK_NEAR;
  return [cx + (camX * focal) / depth, cy - (camY * focal) / depth, camZ];
}

function loopPoints(loop) {
  const pts = [];
  for (const curve of loop.curves || []) {
    if (curve.start) pts.push([curve.start[0], curve.start[1]]);
  }
  return pts;
}

function isOpeningForm(form) {
  const kind = (form.kind || "").toLowerCase();
  return kind.includes("window") || kind.includes("opening") || kind.includes("door");
}

function openingLine(form) {
  for (const loop of form.profileLoops || []) {
    for (const curve of loop.curves || []) {
      if (!curve.start || !curve.end) continue;
      if ((curve.kind || "Line").toLowerCase() === "arc") continue;
      return { start: curve.start, end: curve.end };
    }
  }
  return null;
}

function openingMetrics(form) {
  const kind = (form.kind || "").toLowerCase();
  const isWindow = kind.includes("window");
  const height = Number(form.depth) > 0 ? Number(form.depth) : (isWindow ? 1.2 : 2.1);
  const sill = Number.isFinite(Number(form.sill)) ? Number(form.sill) : (isWindow ? 0.9 : 0);
  return { isWindow, height, sill, head: sill + height };
}

function resolvedStatus(status) {
  if (status === "existing" || status === "planned" || status === "mixed") return status;
  return "existing";
}

function statusVisible(status, filter) {
  const s = resolvedStatus(status);
  if (filter === "both") return true;
  if (s === "mixed") return true;
  return s === filter;
}

function openingsOnWall(start, end, openings) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hits = [];
  for (const form of openings) {
    const line = openingLine(form);
    if (!line) continue;
    const t0 = (line.start[0] - start[0]) * ux + (line.start[1] - start[1]) * uy;
    const t1 = (line.end[0] - start[0]) * ux + (line.end[1] - start[1]) * uy;
    const d0 = Math.abs((line.start[0] - start[0]) * -uy + (line.start[1] - start[1]) * ux);
    const d1 = Math.abs((line.end[0] - start[0]) * -uy + (line.end[1] - start[1]) * ux);
    if (d0 > 0.4 || d1 > 0.4) continue;
    const a = Math.min(t0, t1);
    const b = Math.max(t0, t1);
    if (b < 0.02 || a > len - 0.02 || b - a < 0.2) continue;
    hits.push({ t0: Math.max(0, a), t1: Math.min(len, b), form, ...openingMetrics(form) });
  }
  hits.sort((left, right) => left.t0 - right.t0);
  return hits;
}

function pushWallPrism(faces, start, end, z0, z1, thick, id, kind, fill, stroke, status) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thick / 2);
  const ny = (dx / len) * (thick / 2);
  const p = [
    [start[0] + nx, start[1] + ny, z0],
    [end[0] + nx, end[1] + ny, z0],
    [end[0] - nx, end[1] - ny, z0],
    [start[0] - nx, start[1] - ny, z0],
  ];
  const q = p.map(([x, y]) => [x, y, z1]);
  const quads = [
    [q[0], q[1], q[2], q[3]],
    [p[0], p[1], q[1], q[0]],
    [p[1], p[2], q[2], q[1]],
    [p[2], p[3], q[3], q[2]],
    [p[3], p[0], q[0], q[3]],
  ];
  for (const quad of quads) faces.push({ pts: quad, id, fill, stroke, kind, status });
}

function pushWallBox(faces, start, end, z0, height, thick, id, openings, status) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const along = (t) => [start[0] + ux * t, start[1] + uy * t];
  const hits = openingsOnWall(start, end, openings);
  const wallFill = "rgba(26,22,18,0.45)";
  const wallStroke = "#1a1612";
  if (!hits.length) {
    pushWallPrism(faces, start, end, z0, z0 + height, thick, id, "wall", wallFill, wallStroke, status);
    return;
  }
  let cursor = 0;
  for (const hit of hits) {
    if (hit.t0 - cursor > 0.02) {
      pushWallPrism(faces, along(cursor), along(hit.t0), z0, z0 + height, thick, id, "wall", wallFill, wallStroke, status);
    }
    if (hit.sill > 0.02) {
      pushWallPrism(faces, along(hit.t0), along(hit.t1), z0, z0 + hit.sill, thick, id, "wall", wallFill, wallStroke, status);
    }
    if (hit.head < height - 0.02) {
      pushWallPrism(faces, along(hit.t0), along(hit.t1), z0 + hit.head, z0 + height, thick, id, "wall", wallFill, wallStroke, status);
    }
    cursor = Math.max(cursor, hit.t1);
  }
  if (len - cursor > 0.02) {
    pushWallPrism(faces, along(cursor), along(len), z0, z0 + height, thick, id, "wall", wallFill, wallStroke, status);
  }
}

function pushOpeningFaces(faces, form, z0, id, status) {
  const line = openingLine(form);
  if (!line) return;
  const metrics = openingMetrics(form);
  let thick = 0.08;
  const loops = (form.profileLoops || []).filter((loop) =>
    (loop.curves || []).some((c) => c.start && c.end && (c.kind || "Line").toLowerCase() !== "arc"));
  if (loops.length >= 2) {
    const a = loops[0].curves[0];
    const b = loops[1].curves[0];
    if (a?.start && b?.start) {
      thick = Math.max(0.06, Math.hypot(b.start[0] - a.start[0], b.start[1] - a.start[1]));
    }
  }
  const fill = metrics.isWindow ? "rgba(90,150,180,0.45)" : "rgba(139,90,43,0.92)";
  const stroke = metrics.isWindow ? "#3a5f7a" : "#5c3b1a";
  const kind = metrics.isWindow ? "window" : "door";
  pushWallPrism(faces, line.start, line.end, z0 + metrics.sill, z0 + metrics.head, thick, id, kind, fill, stroke, status);
}

function pushExtrusionFaces(faces, form, z0, id, status) {
  const depth = form.depth || 0.4;
  for (const loop of form.profileLoops || []) {
    const pts = loopPoints(loop);
    if (pts.length < 3) continue;
    faces.push({
      pts: pts.map(([x, y]) => [x, y, z0 + depth]),
      id,
      fill: form.isSolid === false ? "rgba(58,95,122,0.2)" : "rgba(36,48,68,0.35)",
      stroke: "#243044",
      kind: "extrusion",
      status,
    });
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      faces.push({
        pts: [
          [a[0], a[1], z0],
          [b[0], b[1], z0],
          [b[0], b[1], z0 + depth],
          [a[0], a[1], z0 + depth],
        ],
        id,
        fill: "rgba(36,48,68,0.2)",
        stroke: "#243044",
        kind: "extrusion",
        status,
      });
    }
  }
}

function roofRectFromForm(form) {
  const loop = (form.profileLoops || [])[0];
  const pts = loop ? loopPoints(loop) : [];
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function pushRoofFaces(faces, form, z0, id, status) {
  const shape = String(form.roofForm || "flat").toLowerCase();
  if (shape === "flat" || !shape) {
    pushExtrusionFaces(faces, form, z0, id, status);
    return;
  }
  const rect = roofRectFromForm(form);
  if (!rect || rect.w < 0.2 || rect.h < 0.2) {
    pushExtrusionFaces(faces, form, z0, id, status);
    return;
  }
  const pitch = Number(form.roofPitch);
  const deg = Number.isFinite(pitch) ? Math.min(60, Math.max(5, pitch)) : 30;
  const tan = Math.tan((deg * Math.PI) / 180);
  const alongX = roofRidgeAlongX(rect, form.roofRidge);
  const fillA = "rgba(36,48,68,0.50)";
  const fillB = "rgba(70,112,140,0.48)";
  const side = "rgba(36,48,68,0.22)";
  const stroke = "#243044";
  const thick = Math.max(0.08, Number(form.depth) || 0.125);
  const pt = (x, y, z) => [x, y, z];
  const quad = (a, b, c, d, color) => faces.push({ pts: [a, b, c, d], id, fill: color, stroke, kind: "roof", status });
  const tri = (a, b, c, color) => faces.push({ pts: [a, b, c], id, fill: color, stroke, kind: "roof", status });

  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  const eave = z0;

  if (shape === "shed") {
    const span = alongX ? rect.h : rect.w;
    const rise = span * tan;
    const hi = eave + rise;
    if (alongX) {
      const a = pt(x0, y0, hi);
      const b = pt(x1, y0, hi);
      const c = pt(x1, y1, eave);
      const d = pt(x0, y1, eave);
      quad(a, b, c, d, fillA);
      quad(pt(x0, y0, hi - thick), pt(x1, y0, hi - thick), pt(x1, y1, eave - thick), pt(x0, y1, eave - thick), side);
      quad(a, b, pt(x1, y0, hi - thick), pt(x0, y0, hi - thick), side);
      quad(d, c, pt(x1, y1, eave - thick), pt(x0, y1, eave - thick), side);
      quad(a, d, pt(x0, y1, eave - thick), pt(x0, y0, hi - thick), side);
      quad(b, c, pt(x1, y1, eave - thick), pt(x1, y0, hi - thick), side);
    } else {
      const a = pt(x0, y0, hi);
      const b = pt(x0, y1, hi);
      const c = pt(x1, y1, eave);
      const d = pt(x1, y0, eave);
      quad(a, b, c, d, fillA);
      quad(pt(x0, y0, hi - thick), pt(x0, y1, hi - thick), pt(x1, y1, eave - thick), pt(x1, y0, eave - thick), side);
      quad(a, b, pt(x0, y1, hi - thick), pt(x0, y0, hi - thick), side);
      quad(d, c, pt(x1, y1, eave - thick), pt(x1, y0, eave - thick), side);
      quad(a, d, pt(x1, y0, eave - thick), pt(x0, y0, hi - thick), side);
      quad(b, c, pt(x1, y1, eave - thick), pt(x0, y1, hi - thick), side);
    }
    return;
  }

  if (shape === "gable") {
    const span = alongX ? rect.h : rect.w;
    const rise = (span / 2) * tan;
    const ridgeZ = eave + rise;
    const drop = ([x, y, z]) => pt(x, y, z - thick);
    if (alongX) {
      const mid = y0 + rect.h / 2;
      const r0 = pt(x0, mid, ridgeZ);
      const r1 = pt(x1, mid, ridgeZ);
      const a = pt(x0, y0, eave);
      const b = pt(x1, y0, eave);
      const c = pt(x1, y1, eave);
      const d = pt(x0, y1, eave);
      quad(a, b, r1, r0, fillA);
      quad(r0, r1, c, d, fillB);
      quad(drop(a), drop(r0), drop(r1), drop(b), side);
      quad(drop(d), drop(c), drop(r1), drop(r0), side);
      tri(a, d, r0, side);
      tri(drop(a), drop(r0), drop(d), side);
      tri(b, r1, c, side);
      tri(drop(b), drop(c), drop(r1), side);
      quad(a, b, drop(b), drop(a), side);
      quad(d, drop(d), drop(c), c, side);
    } else {
      const mid = x0 + rect.w / 2;
      const r0 = pt(mid, y0, ridgeZ);
      const r1 = pt(mid, y1, ridgeZ);
      const a = pt(x0, y0, eave);
      const b = pt(x1, y0, eave);
      const c = pt(x1, y1, eave);
      const d = pt(x0, y1, eave);
      quad(a, r0, r1, d, fillA);
      quad(r0, b, c, r1, fillB);
      quad(drop(a), drop(d), drop(r1), drop(r0), side);
      quad(drop(r0), drop(r1), drop(c), drop(b), side);
      tri(a, b, r0, side);
      tri(drop(a), drop(r0), drop(b), side);
      tri(d, r1, c, side);
      tri(drop(d), drop(c), drop(r1), side);
      quad(a, d, drop(d), drop(a), side);
      quad(b, drop(b), drop(c), c, side);
    }
    return;
  }

  if (shape === "hip") {
    const span = alongX ? rect.h : rect.w;
    const run = alongX ? rect.w : rect.h;
    const inset = Math.min(span / 2, run / 2);
    const rise = inset * tan;
    const ridgeZ = eave + rise;
    const a = pt(x0, y0, eave);
    const b = pt(x1, y0, eave);
    const c = pt(x1, y1, eave);
    const d = pt(x0, y1, eave);
    if (run - inset * 2 < 0.08) {
      const apex = pt(x0 + rect.w / 2, y0 + rect.h / 2, ridgeZ);
      tri(a, b, apex, fillA);
      tri(b, c, apex, fillB);
      tri(c, d, apex, fillA);
      tri(d, a, apex, fillB);
      return;
    }
    if (alongX) {
      const mid = y0 + rect.h / 2;
      const e = pt(x0 + inset, mid, ridgeZ);
      const f = pt(x1 - inset, mid, ridgeZ);
      quad(a, b, f, e, fillA);
      quad(d, e, f, c, fillB);
      tri(a, e, d, fillA);
      tri(b, c, f, fillB);
    } else {
      const mid = x0 + rect.w / 2;
      const e = pt(mid, y0 + inset, ridgeZ);
      const f = pt(mid, y1 - inset, ridgeZ);
      quad(a, e, f, d, fillA);
      quad(b, c, f, e, fillB);
      tri(a, b, e, fillA);
      tri(d, f, c, fillB);
    }
  }
}

function pushFormFaces(faces, form, openings) {
  const kind = (form.kind || "").toLowerCase();
  const status = form.status || "existing";
  const z0 = Number(form.elevation) || 0;

  if (kind === "room") {
    const height = form.depth && form.depth < 1 ? form.depth : 0.18;
    for (const loop of form.profileLoops || []) {
      const pts = loopPoints(loop);
      if (pts.length >= 3) {
        faces.push({
          pts: pts.map(([x, y]) => [x, y, z0 + height]),
          id: form.elementId,
          fill: "rgba(178,69,30,0.28)",
          stroke: "rgba(178,69,30,0.7)",
          kind: "room",
          status,
        });
      }
    }
    return;
  }

  if (kind === "wall") {
    const height = form.depth || 2.8;
    const thick = Number(form.thickness) > 0 ? Number(form.thickness) : 0.22;
    const nearby = openings.filter((o) => Math.abs((Number(o.elevation) || 0) - z0) < 0.05);
    for (const loop of form.profileLoops || []) {
      for (const curve of loop.curves || []) {
        if (!curve.start || !curve.end) continue;
        pushWallBox(faces, curve.start, curve.end, z0, height, thick, form.elementId, nearby, status);
      }
    }
    return;
  }

  if (isOpeningForm(form)) {
    pushOpeningFaces(faces, form, z0, form.elementId, status);
    return;
  }

  if (kind === "roof") {
    pushRoofFaces(faces, form, z0, form.elementId, status);
    return;
  }

  // Floor (slabs) and Extrusion (items, beams).
  pushExtrusionFaces(faces, form, z0, form.elementId, status);
}

/** Build the extruded face list for one compiled payload, filtered by status. */
export function facesFromPayload(payload, statusFilter = "both") {
  const forms = (payload?.sketchForms || []).filter((form) => statusVisible(form.status, statusFilter));
  const openings = forms.filter(isOpeningForm);
  const faces = [];
  for (const form of forms) pushFormFaces(faces, form, openings);
  return faces;
}

function projectPoint(x, y, z, origin, cx, cy, scale, cam) {
  const px = x - origin[0];
  const py = y - origin[1];
  const pz = z - origin[2];
  const cyaw = Math.cos(cam.yaw);
  const syaw = Math.sin(cam.yaw);
  const x1 = px * cyaw - py * syaw;
  const y1 = px * syaw + py * cyaw;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const y2 = y1 * cp - pz * sp;
  const z2 = y1 * sp + pz * cp;
  return [cx + x1 * scale, cy - z2 * scale, y2];
}

function boundsOfFaces(faces) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const face of faces) {
    for (const [x, y, z] of face.pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

const GROUND_PAD = 1.5;
const GROUND_TILE = 1;

/**
 * Grade at z = 0 (the ground-floor datum the house cutaway already uses).
 * Tiled so painter's-algorithm sorting does not treat one huge plane as a
 * single depth. Drawn after anything below grade and before walls, so a
 * footing on a foundation storey reads as sitting under the ground plane.
 */
export function groundFacesFromBounds(bounds) {
  if (!Number.isFinite(bounds?.minX) || !Number.isFinite(bounds?.minY)) return [];
  const x0 = Math.floor(bounds.minX - GROUND_PAD);
  const y0 = Math.floor(bounds.minY - GROUND_PAD);
  const x1 = Math.ceil(bounds.maxX + GROUND_PAD);
  const y1 = Math.ceil(bounds.maxY + GROUND_PAD);
  if (!(x1 > x0) || !(y1 > y0)) return [];
  const faces = [];
  for (let x = x0; x < x1; x += GROUND_TILE) {
    for (let y = y0; y < y1; y += GROUND_TILE) {
      const x2 = Math.min(x + GROUND_TILE, x1);
      const y2 = Math.min(y + GROUND_TILE, y1);
      faces.push({
        pts: [[x, y, 0], [x2, y, 0], [x2, y2, 0], [x, y2, 0]],
        id: "ground",
        kind: "ground",
        fill: "rgba(210,198,176,0.38)",
        stroke: "rgba(176,162,142,0.7)",
        status: "existing",
      });
    }
  }
  return faces;
}

/** 0 = below grade, 1 = ground plane, 2 = at or above grade. */
export function massingLayer(face) {
  if (face?.kind === "ground") return 1;
  const pts = face?.pts || [];
  if (!pts.length) return 2;
  const z = pts.reduce((sum, p) => sum + p[2], 0) / pts.length;
  return z < -0.02 ? 0 : 2;
}

function faceStyle(face) {
  if (face.kind === "ground") return { fill: face.fill, stroke: face.stroke };
  const status = resolvedStatus(face.status);
  if (status === "planned" && (face.kind === "wall" || face.kind === "room")) {
    return { fill: face.kind === "wall" ? "rgba(178,69,30,0.38)" : "rgba(178,69,30,0.32)", stroke: "#b2451e" };
  }
  if (status === "planned" && face.kind === "roof") {
    return { fill: face.fill || "rgba(58,95,122,0.5)", stroke: "#3a5f7a" };
  }
  if (status === "existing" && (face.kind === "wall" || face.kind === "room")) {
    return { fill: face.kind === "wall" ? "rgba(90,84,76,0.42)" : "rgba(92,83,72,0.28)", stroke: "#5c5348" };
  }
  return { fill: face.fill, stroke: face.stroke };
}

/**
 * Wire an orbiting canvas view. Call `setPayload` whenever the document
 * changes, `resize` when the wrap is shown or resized, and `draw` to
 * re-render without changing anything (e.g. after a status filter click).
 */
export function createMassingView({ canvas, emptyEl, captionEl, titleEl, onDraw }) {
  const ctx = canvas.getContext("2d");
  const cam = createCamera();
  let statusFilter = "both";
  let payload = null;
  let drag = null;
  let reframe = true;

  function setPayload(nextPayload) {
    payload = nextPayload;
    if (cam.mode !== "look") reframe = true;
    draw();
  }

  function setStatusFilter(filter) {
    statusFilter = filter;
    draw();
  }

  function setLook(look) {
    if (!look || look.mode !== "look") return;
    delete cam.lookHit;
    Object.assign(cam, look);
    cam.mode = "look";
    reframe = false;
    draw();
  }

  function setSection(cut) {
    if (!cut || cut.mode !== "section") return;
    delete cam.lookHit;
    Object.assign(cam, cut);
    cam.mode = "section";
    reframe = true;
    draw();
  }

  function setOrbit() {
    delete cam.lookHit;
    cam.mode = "orbit";
    reframe = true;
    draw();
  }

  function hatchCut(pts, stroke) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    // A flattened receding face is a line. Clipping to that path does not
    // contain the hatch, so the 45° strokes run across the bounding box.
    if (Math.abs(area) / 2 < 12) return;
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = 0.45;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = (maxX - minX) + (maxY - minY);
    for (let d = minX - (maxY - minY); d < maxX + (maxY - minY); d += Math.max(6, span / 24)) {
      ctx.beginPath();
      ctx.moveTo(d, minY);
      ctx.lineTo(d + (maxY - minY), maxY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    const bufW = Math.max(1, Math.floor(width * dpr));
    const bufH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLook = cam.mode === "look";
    const isSection = cam.mode === "section";
    if (titleEl) {
      titleEl.textContent = isLook ? "Look" : isSection ? "Section" : "3D massing";
    }

    const faces = facesFromPayload(payload, statusFilter);
    if (!faces.length) {
      if (emptyEl) emptyEl.hidden = false;
      if (captionEl) captionEl.textContent = "Draw a room, wall, roof, floor, door or window, then open 3D again.";
      if (typeof onDraw === "function") onDraw(cam, payload);
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    if (captionEl) {
      captionEl.textContent = isLook
        ? `Standing ${EYE_HEIGHT_M} m · drag to look around · scroll to zoom`
        : isSection
          ? "Cut looking left of the line · drag to pan · scroll to zoom"
          : "Drag to orbit · scroll to zoom · hatched plane is ground floor (0 m)";
    }

    const bounds = boundsOfFaces(faces);
    if (reframe && !isLook && !isSection) {
      frameCamera(cam, bounds);
      reframe = false;
    }
    const withGround = [...faces, ...groundFacesFromBounds(bounds)];
    const cutFaces = isSection ? clipFacesForSection(withGround, cam) : withGround;
    if (isSection && !cutFaces.length) {
      if (emptyEl) emptyEl.hidden = false;
      if (captionEl) captionEl.textContent = "That cut does not hit the building. Draw the line through the plan.";
      if (typeof onDraw === "function") onDraw(cam, payload);
      return;
    }
    if (isSection && reframe) {
      const framed = sectionFrame(cutFaces, cam);
      cam.sectionOu = framed.originU;
      cam.sectionOv = framed.originV;
      cam.sectionScale = Math.min(width, height) / (framed.span * 1.35);
      reframe = false;
    }

    const framed = boundsOfFaces(withGround);
    const origin = [
      (framed.minX + framed.maxX) / 2,
      (framed.minY + framed.maxY) / 2,
      (framed.minZ + framed.maxZ) / 2,
    ];
    const span = Math.max(
      framed.maxX - framed.minX,
      framed.maxY - framed.minY,
      framed.maxZ - framed.minZ,
      1,
    );
    const scale = cam.scale * Math.min(width, height) / (span * 28);
    const cx = width / 2;
    const cy = height / 2 + (isLook || isSection ? 0 : 20);
    const sectionScale = Number(cam.sectionScale) > 0 ? cam.sectionScale : scale;

    const projected = [];
    for (const face of cutFaces) {
      const pts = face.pts.map((p) => (isLook
        ? projectLookPoint(p[0], p[1], p[2], cam, cx, cy, height)
        : isSection
          ? projectSectionPoint(p[0], p[1], p[2], cam, cam.sectionOu, cam.sectionOv, sectionScale, cx, cy)
          : projectPoint(p[0], p[1], p[2], origin, cx, cy, scale, cam)));
      const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      if (isLook && depth < LOOK_NEAR) continue;
      projected.push({ face, pts, depth });
    }
    projected.sort((a, b) => massingLayer(a.face) - massingLayer(b.face)
      || ((isLook || isSection) ? b.depth - a.depth : a.depth - b.depth));

    for (const item of projected) {
      const style = faceStyle(item.face);
      ctx.beginPath();
      item.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = item.face.cut
        ? (item.face.kind === "wall" ? "rgba(90,84,76,0.72)" : style.fill)
        : style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = projected.length > 8000 ? 0.2 : (item.face.cut ? 0.9 : 0.45);
      ctx.fill();
      if (item.face.cut) hatchCut(item.pts, style.stroke);
      if (projected.length < 25000) ctx.stroke();
    }
    if (typeof onDraw === "function") onDraw(cam, payload);
  }

  canvas.addEventListener("pointerdown", (event) => {
    drag = {
      x: event.clientX,
      y: event.clientY,
      yaw: cam.yaw,
      pitch: cam.pitch,
      ou: cam.sectionOu,
      ov: cam.sectionOv,
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (cam.mode === "look") {
      cam.yaw = drag.yaw + (event.clientX - drag.x) * 0.008;
      cam.pitch = Math.min(LOOK_PITCH_MAX, Math.max(LOOK_PITCH_MIN, drag.pitch - (event.clientY - drag.y) * 0.008));
    } else if (cam.mode === "section") {
      const s = Number(cam.sectionScale) > 0 ? cam.sectionScale : 40;
      cam.sectionOu = drag.ou - (event.clientX - drag.x) / s;
      cam.sectionOv = drag.ov + (event.clientY - drag.y) / s;
    } else {
      cam.yaw = drag.yaw + (event.clientX - drag.x) * 0.01;
      cam.pitch = Math.min(MASSING_PITCH_MAX, Math.max(MASSING_PITCH_MIN, drag.pitch + (event.clientY - drag.y) * 0.01));
    }
    draw();
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (cam.mode === "look") {
      const fov = Number(cam.fov) > 0 ? cam.fov : LOOK_FOV_DEFAULT;
      cam.fov = Math.min(LOOK_FOV_MAX, Math.max(LOOK_FOV_MIN, fov * (event.deltaY > 0 ? 1.08 : 0.92)));
    } else if (cam.mode === "section") {
      const s = Number(cam.sectionScale) > 0 ? cam.sectionScale : 40;
      cam.sectionScale = Math.min(180, Math.max(12, s * (event.deltaY > 0 ? 0.92 : 1.08)));
    } else {
      cam.scale = Math.min(48, Math.max(8, cam.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
    }
    draw();
  }, { passive: false });

  return { setPayload, setStatusFilter, setLook, setSection, setOrbit, draw, resize: draw };
}
