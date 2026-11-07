// 3D massing view for the v2 core (Output > Views > 3D).
//
// Deliberately independent of the compliance engine (Week 2) and the sheet /
// PDF system (Week 3): it extrudes what compile() already emits -
// profileLoops, depth and, since this file needed it, per-object elevation.
// Service routes are not part of that extrusion. When the Services checkbox
// is on, they are drawn afterwards from serviceMassingRoutes(): each run is
// a line at its derived height, in the system's colour, so a pipe inside a
// wall stays visible.
// Camera (Output > Views > Camera) is the same extrusion from a standing
// eye, not a second model. Section (Document > Views > Section) is the same
// extrusion on a vertical cut, and Elevation (Output > Views > Elevation) is
// the same extrusion again, viewed orthographically from a fixed compass
// side instead of a user-drawn cut - see elevation.js. No Revit mesh ingestion (that lives in
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

import { archRise, archVoidPolygon } from "./arch-head.js";
import { clipPolygon, pointInPoly } from "./geom.js";
import { roofRidgeAlongX } from "./roof.js";
import {
  SECTION_FAR_M,
  SECTION_U_PAD,
  clipFacesForSection,
  projectSectionPoint,
  sectionDot,
  sectionFrame,
} from "./section.js";

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

/** Higher orbit used as a roof reference. Near the top-down limit already,
 *  and the shot would repeat the camera the customer framed. */
const REFERENCE_ROOF_PITCH = 1.28;
const REFERENCE_ROOF_GAP = 0.2;

/**
 * The two extra orbit cameras Generate sends with the view on screen.
 * Opposite is the same pitch, half a turn away. Roof is a higher look
 * down the same yaw, omitted when the current pitch is already that high.
 * Section, elevation and a standing camera are not orbit, so they get none.
 */
export function orbitReferenceCameras(cam) {
  if (!cam || cam.mode !== "orbit") return [];
  const yaw = Number(cam.yaw);
  const pitch = Number(cam.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return [];
  const shots = [{ role: "opposite", yaw: yaw + Math.PI, pitch }];
  const roofPitch = Math.min(MASSING_PITCH_MAX - 0.06, Math.max(REFERENCE_ROOF_PITCH, pitch + 0.35));
  if (roofPitch - pitch >= REFERENCE_ROOF_GAP) shots.push({ role: "roof", yaw, pitch: roofPitch });
  return shots;
}

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

/** A plate step, not the next storey. Eaves further apart than this are
 *  left unlabeled. */
const PLATE_STEP_MAX_M = 1.2;

/**
 * Roofs whose eaves differ by a step. The lowest plate in a cluster is
 * unlabeled; each higher one reads "Plate +150 mm". A storey apart is not
 * a step, and a difference under 20 mm is not worth a label.
 */
export function plateCallouts(roofs) {
  const byId = new Map();
  for (const roof of roofs || []) {
    if (!roof?.id || !Number.isFinite(roof.eaveZ)) continue;
    if (!byId.has(roof.id)) byId.set(roof.id, roof.eaveZ);
  }
  const list = [...byId.entries()]
    .map(([id, eaveZ]) => ({ id, eaveZ }))
    .sort((a, b) => a.eaveZ - b.eaveZ || String(a.id).localeCompare(String(b.id)));
  const out = [];
  let i = 0;
  while (i < list.length) {
    const base = list[i].eaveZ;
    let k = i + 1;
    while (k < list.length && list[k].eaveZ - base <= PLATE_STEP_MAX_M) k += 1;
    for (let n = i + 1; n < k; n += 1) {
      const mm = Math.round((list[n].eaveZ - base) * 1000);
      if (mm >= 20) out.push({ id: list[n].id, text: `Plate +${mm} mm` });
    }
    i = Math.max(k, i + 1);
  }
  return out;
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
  const arch = form.head === "arch";
  const asked = Number(form.rise);
  return {
    isWindow,
    height,
    sill,
    head: sill + height,
    arch,
    rise: arch && Number.isFinite(asked) && asked > 0 ? asked : 0,
  };
}

/** Points of the circular head, from the left spring to the right spring. */
function archCurve(profile, t0, t1, spring) {
  const left = profile.findIndex((p) => Math.abs(p[0] - t0) < 1e-4 && Math.abs(p[1] - spring) < 1e-3);
  let right = -1;
  for (let i = profile.length - 1; i > left; i -= 1) {
    if (Math.abs(profile[i][0] - t1) < 1e-4 && Math.abs(profile[i][1] - spring) < 1e-3) {
      right = i;
      break;
    }
  }
  if (left < 0 || right <= left) return null;
  return profile.slice(left, right + 1);
}

/**
 * The wall left above an arched opening: a flat top at the head, sides down
 * to the springs, and the arc between them. The rectangular body below the
 * spring is cut by the ordinary opening grid.
 */
function pushArchHead(faces, corner, z0, arch, wallLen, wallTop, id, fill, stroke, status, finish) {
  const curve = archCurve(arch.profile, arch.t0, arch.t1, arch.springLocal);
  if (!curve || curve.length < 3) return;
  const ring = [
    [arch.t0, arch.springLocal],
    [arch.t0, arch.headLocal],
    [arch.t1, arch.headLocal],
    [arch.t1, arch.springLocal],
    ...curve.slice(1, -1).reverse(),
  ];
  const sideFace = (side) => {
    const pts = ring.map(([t, y]) => corner(t, side, z0 + y));
    const bare = [];
    if (arch.t0 > 1e-3) bare.push([pts[0], pts[1]]);
    if (arch.head < wallTop - 1e-3) bare.push([pts[1], pts[2]]);
    if (arch.t1 < wallLen - 1e-3) bare.push([pts[2], pts[3]]);
    return { pts, bare };
  };
  const front = sideFace(1);
  pushQuad(faces, front.pts, front.bare, id, fill, stroke, status, finish);
  const backPts = [...ring].reverse().map(([t, y]) => corner(t, -1, z0 + y));
  const backBare = [];
  const n = backPts.length;
  if (arch.t0 > 1e-3) backBare.push([backPts[n - 2], backPts[n - 1]]);
  if (arch.head < wallTop - 1e-3) backBare.push([backPts[n - 3], backPts[n - 2]]);
  if (arch.t1 < wallLen - 1e-3) backBare.push([backPts[n - 4], backPts[n - 3]]);
  pushQuad(faces, backPts, backBare, id, fill, stroke, status, finish);
  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i];
    const b = curve[i + 1];
    const a1 = corner(a[0], 1, z0 + a[1]);
    const b1 = corner(b[0], 1, z0 + b[1]);
    const b2 = corner(b[0], -1, z0 + b[1]);
    const a2 = corner(a[0], -1, z0 + a[1]);
    const bare = [];
    if (i > 0) bare.push([a1, a2]);
    if (i < curve.length - 2) bare.push([b1, b2]);
    pushQuad(faces, [a1, b1, b2, a2], bare, id, fill, stroke, status, finish);
  }
}

/** An opening solid whose outline is the arched void, not its bounding box. */
function pushProfileSolid(faces, place, profile, id, kind, fill, stroke, status) {
  faces.push({
    pts: profile.map(([t, z]) => place(t, 1, z)),
    id, kind, fill, stroke, status,
  });
  faces.push({
    pts: [...profile].reverse().map(([t, z]) => place(t, -1, z)),
    id, kind, fill, stroke, status,
  });
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    const a1 = place(a[0], 1, a[1]);
    const b1 = place(b[0], 1, b[1]);
    const b2 = place(b[0], -1, b[1]);
    const a2 = place(a[0], -1, a[1]);
    faces.push({
      pts: [a1, b1, b2, a2],
      bare: [[a1, a2], [b1, b2]],
      id, kind, fill, stroke, status,
    });
  }
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

function pushWallPrism(faces, start, end, z0, z1, thick, id, kind, fill, stroke, status, opts = {}) {
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
  const front = opts.fillFront || fill;
  const back = opts.fillBack || fill;
  const edge = opts.fillFront || opts.fillBack || fill;
  const finish = !!(opts.fillFront || opts.fillBack);
  const put = (pts, faceFill, bare) => {
    const face = { pts, id, fill: faceFill, stroke, kind, status };
    if (bare && bare.length) face.bare = bare;
    if (finish && kind === "wall") face.finish = true;
    faces.push(face);
  };
  // A shallow turn (a curve's next facet) is the same surface, so the joint
  // cap is left out and the two vertical edges are not stroked.
  const topBare = [];
  if (opts.softEnd) topBare.push([q[1], q[2]]);
  if (opts.softStart) topBare.push([q[3], q[0]]);
  put([q[0], q[1], q[2], q[3]], edge, topBare);
  const frontBare = [];
  if (opts.softEnd) frontBare.push([p[1], q[1]]);
  if (opts.softStart) frontBare.push([q[0], p[0]]);
  put([p[0], p[1], q[1], q[0]], front, frontBare);
  if (!opts.softEnd) put([p[1], p[2], q[2], q[1]], edge);
  const backBare = [];
  if (opts.softEnd) backBare.push([p[2], q[2]]);
  if (opts.softStart) backBare.push([q[3], p[3]]);
  put([p[2], p[3], q[3], q[2]], back, backBare);
  if (!opts.softStart) put([p[3], p[0], q[0], q[3]], edge);
}

function pushQuad(faces, pts, bare, id, fill, stroke, status, finish) {
  const face = { pts, id, fill, stroke, kind: "wall", status };
  if (bare && bare.length) face.bare = bare;
  if (finish) face.finish = true;
  faces.push(face);
}

function stationsOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > 1e-4) out.push(value);
  }
  return out;
}

/** Inclusive start index, exclusive end index, over cells where `pred` holds. */
function indexRuns(count, pred) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= count; i += 1) {
    const on = i < count && pred(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

/**
 * One wall surface with holes, not a stack of boxes. A seam between two solid
 * cells is the same plaster, so that edge is marked bare and the outline
 * skips it. The only stroked lines are real corners: wall ends, the opening,
 * and the glass.
 */
function pushOpenedWall(faces, start, end, z0, height, thick, id, hits, fill, stroke, status, opts = {}) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = (-dy / len) * (thick / 2);
  const ny = (dx / len) * (thick / 2);
  const along = (t) => [start[0] + ux * t, start[1] + uy * t];
  const corner = (t, side, z) => {
    const p = along(t);
    return [p[0] + nx * side, p[1] + ny * side, z];
  };
  const cuts = [];
  const arches = [];
  for (const hit of hits) {
    const t0 = Math.max(0, hit.t0);
    const t1 = Math.min(len, hit.t1);
    const sill = Math.min(height, Math.max(0, hit.sill));
    const head = Math.min(height, Math.max(0, hit.head));
    if (t1 - t0 <= 0.02 || head - sill <= 0.02) continue;
    if (hit.arch) {
      const rise = Math.min(archRise(t1 - t0, hit.rise), head - sill);
      if (rise > 0.02) {
        const spring = head - rise;
        arches.push({
          t0,
          t1,
          spring: z0 + spring,
          head: z0 + head,
          springLocal: spring,
          headLocal: head,
          profile: archVoidPolygon({ from: t0, to: t1, bottom: sill, top: head, rise }, 16),
        });
        if (spring - sill > 0.02) cuts.push({ t0, t1, sill, head: spring });
        continue;
      }
    }
    cuts.push({ t0, t1, sill, head });
  }
  if (!cuts.length && !arches.length) {
    pushWallPrism(faces, start, end, z0, z0 + height, thick, id, "wall", fill, stroke, status);
    return;
  }
  const ts = stationsOf([
    0,
    len,
    ...cuts.flatMap((cut) => [cut.t0, cut.t1]),
    ...arches.flatMap((arch) => [arch.t0, arch.t1]),
  ]);
  const zs = stationsOf([
    z0,
    z0 + height,
    ...cuts.flatMap((cut) => [z0 + cut.sill, z0 + cut.head]),
    ...arches.flatMap((arch) => [arch.spring, arch.head]),
  ]);
  const nT = ts.length - 1;
  const nZ = zs.length - 1;
  const solid = Array.from({ length: nT }, () => Array(nZ).fill(false));
  for (let i = 0; i < nT; i += 1) {
    for (let j = 0; j < nZ; j += 1) {
      const tm = (ts[i] + ts[i + 1]) / 2;
      const zm = (zs[j] + zs[j + 1]) / 2;
      const hole = cuts.some((cut) => tm > cut.t0 && tm < cut.t1 && zm > z0 + cut.sill && zm < z0 + cut.head);
      solid[i][j] = !hole;
    }
  }
  const finished = !!(opts.fillFront || opts.fillBack);
  const frontFill = opts.fillFront || fill;
  const backFill = opts.fillBack || fill;
  const quad = (pts, bare, faceFill) => pushQuad(faces, pts, bare, id, faceFill || frontFill, stroke, status, finished);
  const inArchBand = (i, j) => {
    const tm = (ts[i] + ts[i + 1]) / 2;
    const zm = (zs[j] + zs[j + 1]) / 2;
    return arches.some((arch) => tm > arch.t0 && tm < arch.t1 && zm > arch.spring && zm < arch.head);
  };
  const closesArch = (i0, i1, z) => {
    const tm = (ts[i0] + ts[i1]) / 2;
    return arches.some((arch) => Math.abs(z - arch.spring) < 1e-3 && tm > arch.t0 && tm < arch.t1);
  };

  for (let i = 0; i < nT; i += 1) {
    for (let j = 0; j < nZ; j += 1) {
      if (!solid[i][j] || inArchBand(i, j)) continue;
      const seamL = i > 0 && solid[i - 1][j];
      const seamR = i + 1 < nT && solid[i + 1][j];
      const seamB = j > 0 && solid[i][j - 1];
      const seamT = j + 1 < nZ && solid[i][j + 1];
      const tA = ts[i];
      const tB = ts[i + 1];
      const zA = zs[j];
      const zB = zs[j + 1];
      const flb = corner(tA, 1, zA);
      const frb = corner(tB, 1, zA);
      const frt = corner(tB, 1, zB);
      const flt = corner(tA, 1, zB);
      const frontBare = [];
      if (seamB) frontBare.push([flb, frb]);
      if (seamR) frontBare.push([frb, frt]);
      if (seamT) frontBare.push([frt, flt]);
      if (seamL) frontBare.push([flt, flb]);
      if (opts.softEnd && Math.abs(tB - len) < 1e-4) frontBare.push([frb, frt]);
      if (opts.softStart && tA < 1e-4) frontBare.push([flt, flb]);
      quad([flb, frb, frt, flt], frontBare, frontFill);
      const blb = corner(tB, -1, zA);
      const brb = corner(tA, -1, zA);
      const brt = corner(tA, -1, zB);
      const blt = corner(tB, -1, zB);
      const backBare = [];
      if (seamB) backBare.push([blb, brb]);
      if (seamL) backBare.push([brb, brt]);
      if (seamT) backBare.push([brt, blt]);
      if (seamR) backBare.push([blt, blb]);
      if (opts.softEnd && Math.abs(tB - len) < 1e-4) backBare.push([blb, blt]);
      if (opts.softStart && tA < 1e-4) backBare.push([brb, brt]);
      quad([blb, brb, brt, blt], backBare, backFill);
    }
  }
  for (const arch of arches) {
    pushArchHead(faces, corner, z0, arch, len, z0 + height, id, frontFill, stroke, status, finished);
  }

  for (const [i0, i1] of indexRuns(nT, (i) => solid[i][nZ - 1])) {
    const z = zs[nZ];
    const bare = [];
    if (opts.softStart && ts[i0] < 1e-4) bare.push([corner(ts[i0], 1, z), corner(ts[i0], -1, z)]);
    if (opts.softEnd && Math.abs(ts[i1] - len) < 1e-4) bare.push([corner(ts[i1], 1, z), corner(ts[i1], -1, z)]);
    quad([
      corner(ts[i0], 1, z),
      corner(ts[i1], 1, z),
      corner(ts[i1], -1, z),
      corner(ts[i0], -1, z),
    ], bare);
  }
  if (!opts.softStart) {
    for (const [j0, j1] of indexRuns(nZ, (j) => solid[0][j])) {
      quad([
        corner(0, -1, zs[j0]),
        corner(0, 1, zs[j0]),
        corner(0, 1, zs[j1]),
        corner(0, -1, zs[j1]),
      ]);
    }
  }
  if (!opts.softEnd) {
    for (const [j0, j1] of indexRuns(nZ, (j) => solid[nT - 1][j])) {
      quad([
        corner(len, 1, zs[j0]),
        corner(len, -1, zs[j0]),
        corner(len, -1, zs[j1]),
        corner(len, 1, zs[j1]),
      ]);
    }
  }
  for (let k = 1; k < ts.length - 1; k += 1) {
    const t = ts[k];
    for (const [j0, j1] of indexRuns(nZ, (j) => solid[k - 1][j] && !solid[k][j])) {
      quad([
        corner(t, 1, zs[j0]),
        corner(t, -1, zs[j0]),
        corner(t, -1, zs[j1]),
        corner(t, 1, zs[j1]),
      ]);
    }
    for (const [j0, j1] of indexRuns(nZ, (j) => !solid[k - 1][j] && solid[k][j])) {
      quad([
        corner(t, -1, zs[j0]),
        corner(t, 1, zs[j0]),
        corner(t, 1, zs[j1]),
        corner(t, -1, zs[j1]),
      ]);
    }
  }
  for (let m = 1; m < zs.length - 1; m += 1) {
    const z = zs[m];
    for (const [i0, i1] of indexRuns(nT, (i) => solid[i][m - 1] && !solid[i][m])) {
      quad([
        corner(ts[i0], 1, z),
        corner(ts[i1], 1, z),
        corner(ts[i1], -1, z),
        corner(ts[i0], -1, z),
      ]);
    }
    for (const [i0, i1] of indexRuns(nT, (i) => !solid[i][m - 1] && solid[i][m])) {
      if (closesArch(i0, i1, z)) continue;
      quad([
        corner(ts[i0], 1, z),
        corner(ts[i0], -1, z),
        corner(ts[i1], -1, z),
        corner(ts[i1], 1, z),
      ]);
    }
  }
}

function pushWallBox(faces, start, end, z0, height, thick, id, openings, status, opts = {}) {
  const hits = openingsOnWall(start, end, openings);
  const wallFill = "rgba(26,22,18,0.45)";
  const wallStroke = opts.fillFront || opts.fillBack ? "#4a433c" : "#1a1612";
  if (!hits.length) {
    pushWallPrism(faces, start, end, z0, z0 + height, thick, id, "wall", wallFill, wallStroke, status, opts);
    return;
  }
  pushOpenedWall(faces, start, end, z0, height, thick, id, hits, wallFill, wallStroke, status, opts);
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
  if (metrics.arch) {
    const dx = line.end[0] - line.start[0];
    const dy = line.end[1] - line.start[1];
    const span = Math.hypot(dx, dy) || 1;
    const ux = dx / span;
    const uy = dy / span;
    const nx = (-dy / span) * (thick / 2);
    const ny = (dx / span) * (thick / 2);
    const profile = archVoidPolygon({
      from: 0,
      to: span,
      bottom: metrics.sill,
      top: metrics.head,
      rise: metrics.rise,
    }, 16);
    const place = (t, side, z) => [
      line.start[0] + ux * t + nx * side,
      line.start[1] + uy * t + ny * side,
      z0 + z,
    ];
    pushProfileSolid(faces, place, profile, id, kind, fill, stroke, status);
    return;
  }
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

function planRingArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function baryZ(tri, x, y) {
  const [a, b, c] = tri;
  const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-12) return a[2];
  const w0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
  const w1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
  const w2 = 1 - w0 - w1;
  return w0 * a[2] + w1 * b[2] + w2 * c[2];
}

function dedupeRing(pts) {
  const out = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev[0] - p[0], prev[1] - p[1], prev[2] - p[2]) < 1e-6) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) out.pop();
  }
  return out;
}

function segHit(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return { t, u, x: a[0] + t * rx, y: a[1] + t * ry };
}

function holeCrossings(a, b, hole) {
  const hits = [];
  for (let i = 0; i < hole.length; i += 1) {
    const c = hole[i];
    const d = hole[(i + 1) % hole.length];
    const hit = segHit(a, b, c, d);
    if (!hit) continue;
    if (hits.some((other) => Math.abs(other.t - hit.t) < 1e-6)) continue;
    hits.push({ ...hit, edge: i });
  }
  hits.sort((p, q) => p.t - q.t);
  return hits;
}

/** Hole vertices that lie inside the face, from where the face entered to where it left. */
function holeChain(hole, plane, entry, exit, face) {
  const m = hole.length;
  const inside = (v) => pointInPoly(v[0], v[1], face);
  const walk = (step) => {
    const pts = [];
    let e = entry.edge;
    for (let k = 0; k < m + 1; k += 1) {
      if (e === exit.edge) break;
      const v = hole[step === 1 ? (e + 1) % m : e];
      if (inside(v)) pts.push([v[0], v[1], baryZ(plane, v[0], v[1])]);
      e = (e + step + m) % m;
    }
    return pts;
  };
  const forward = walk(1);
  const back = walk(-1);
  if (!forward.length) return back;
  if (!back.length) return forward;
  return forward.length <= back.length ? forward : back;
}

/**
 * Face minus hole, as one ring. A hole that covers a corner (the pyramid
 * point over a court) drops that corner. A hole fully inside the face is
 * a seam around the opening.
 */
function outsideRing(face, hole, plane) {
  const n = face.length;
  const inHole = (p) => pointInPoly(p[0], p[1], hole);
  const flat = face.map((p) => [p[0], p[1]]);
  const out = [];
  let entered = null;
  for (let i = 0; i < n; i += 1) {
    const a = face[i];
    const b = face[(i + 1) % n];
    const hits = holeCrossings(a, b, hole);
    let cursorIn = inHole(a);
    if (!cursorIn) out.push(a);
    for (const hit of hits) {
      const p = [hit.x, hit.y, baryZ(plane, hit.x, hit.y)];
      if (!cursorIn) {
        out.push(p);
        entered = hit;
        cursorIn = true;
      } else if (entered) {
        out.push(...holeChain(hole, plane, entered, hit, flat));
        out.push(p);
        entered = null;
        cursorIn = false;
      }
    }
  }
  if (entered) {
    // Left through a vertex the walk did not pair. Close along the hole.
    const exit = { edge: entered.edge, x: entered.x, y: entered.y };
    out.push(...holeChain(hole, plane, entered, exit, flat));
  }
  return dedupeRing(out);
}

/** One simple ring: the face boundary, out along a seam, around the hole, back. */
function bridgeHole(outer, hole) {
  const n = outer.length;
  const m = hole.length;
  let bi = 0;
  let bj = 0;
  let best = Infinity;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const d = (outer[i][0] - hole[j][0]) ** 2 + (outer[i][1] - hole[j][1]) ** 2;
      if (d < best) {
        best = d;
        bi = i;
        bj = j;
      }
    }
  }
  const sameWay = Math.sign(planRingArea(hole)) === Math.sign(planRingArea(outer) || 1);
  const step = sameWay ? -1 : 1;
  const out = [];
  for (let k = 0; k <= n; k += 1) out.push(outer[(bi + k) % n]);
  for (let k = 0; k <= m; k += 1) {
    const j = bj + step * k;
    out.push(hole[((j % m) + m) % m]);
  }
  return dedupeRing(out);
}

function subtractHole(poly, hole, plane) {
  const flat = poly.map((p) => [p[0], p[1]]);
  const parts = clipPolygon(flat, hole).filter((part) => Math.abs(planRingArea(part)) > 1e-8);
  if (!parts.length) return [poly];
  const whole = Math.abs(planRingArea(flat));
  const covered = parts.reduce((sum, part) => sum + Math.abs(planRingArea(part)), 0);
  if (whole <= 1e-8 || covered >= whole - 1e-6) return [];
  const vertexInside = poly.some((p) => pointInPoly(p[0], p[1], hole));
  if (!vertexInside) {
    let pieces = [poly];
    for (const part of parts) {
      const lifted = part.map((p) => [p[0], p[1], baryZ(plane, p[0], p[1])]);
      const next = [];
      for (const piece of pieces) next.push(bridgeHole(piece, lifted));
      pieces = next;
    }
    return pieces.filter((pts) => pts.length >= 3 && Math.abs(planRingArea(pts)) > 1e-6);
  }
  const ring = outsideRing(poly, hole, plane);
  return ring.length >= 3 && Math.abs(planRingArea(ring)) > 1e-6 ? [ring] : [];
}

function faceTriangles(face) {
  const pts = face.pts || [];
  if (pts.length < 3) return [];
  if (pts.length === 3) return [pts];
  const tris = [];
  for (let i = 1; i < pts.length - 1; i += 1) tris.push([pts[0], pts[i], pts[i + 1]]);
  return tris;
}

/**
 * A roof cut is a vertical hole through the slopes. The plan rectangle is
 * the opening; points on its edge take the height of the slope they cut.
 * Faces that are edge-on in plan (fascia, soffit edge) are left alone.
 */
function openRoofHoles(faces, start, cuts) {
  const holes = (cuts || []).filter((poly) => poly && poly.length >= 3);
  if (!holes.length) return;
  const added = faces.splice(start);
  for (const face of added) {
    const tris = faceTriangles(face);
    const kept = [];
    for (const tri of tris) {
      if (Math.abs(planRingArea(tri)) < 1e-4) {
        kept.push(tri);
        continue;
      }
      let pieces = [tri];
      for (const hole of holes) {
        const next = [];
        for (const poly of pieces) next.push(...subtractHole(poly, hole, tri));
        pieces = next;
      }
      kept.push(...pieces);
    }
    for (const pts of kept) {
      if (pts.length >= 3) faces.push({ ...face, pts });
    }
  }
}

function pushRoofFaces(faces, form, z0, id, status) {
  const start = faces.length;
  pushRoofShell(faces, form, z0, id, status);
  openRoofHoles(faces, start, form.roofCuts);
  for (let i = start; i < faces.length; i += 1) faces[i].eaveZ = z0;
}

function pushRoofShell(faces, form, z0, id, status) {
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
  const tri = (a, b, c, color, k = "roof") => faces.push({ pts: [a, b, c], id, fill: color, stroke, kind: k, status });

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
      // No gable-end board here. The walls under the plate run up to the
      // ridge, and a board on the roof outline sits out on the overhang,
      // in the wall colour, clear of those walls.
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
    // Fascia: the roof has a visible edge at the eave, as the gable does.
    const down = ([x, y, z]) => pt(x, y, z - thick);
    quad(a, b, down(b), down(a), side);
    quad(b, c, down(c), down(b), side);
    quad(c, d, down(d), down(c), side);
    quad(d, a, down(a), down(d), side);
  }
}

/** A curve facet joins the next one when they meet and the turn is shallow. */
const SOFT_TURN = Math.cos((22 * Math.PI) / 180);

function curvesMeet(a, b) {
  if (!a?.end || !b?.start) return false;
  return Math.hypot(a.end[0] - b.start[0], a.end[1] - b.start[1]) < 0.02;
}

function softTurn(a, b) {
  const ax = a.end[0] - a.start[0];
  const ay = a.end[1] - a.start[1];
  const bx = b.end[0] - b.start[0];
  const by = b.end[1] - b.start[1];
  const al = Math.hypot(ax, ay) || 1;
  const bl = Math.hypot(bx, by) || 1;
  return (ax / al) * (bx / bl) + (ay / al) * (by / bl) > SOFT_TURN;
}

function finishRgba(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.92)`;
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
    const sides = form.faceFills || {};
    const fillFront = finishRgba(sides[1] ?? sides["1"]);
    const fillBack = finishRgba(sides[-1] ?? sides["-1"]);
    for (const loop of form.profileLoops || []) {
      const curves = (loop.curves || []).filter((curve) => curve.start && curve.end);
      for (let i = 0; i < curves.length; i += 1) {
        const curve = curves[i];
        pushWallBox(faces, curve.start, curve.end, z0, height, thick, form.elementId, nearby, status, {
          fillFront,
          fillBack,
          softStart: curvesMeet(curves[i - 1], curve) && softTurn(curves[i - 1], curve),
          softEnd: curvesMeet(curve, curves[i + 1]) && softTurn(curve, curves[i + 1]),
        });
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

/** A wall whose top is within this of a roof's plate follows that roof. */
const ROOF_ATTACH_TOL = 0.25;
/**
 * A wall is drawn on its centreline, so one face sits just outside the roof
 * outline. Sample the roof that far past the plate, and past a hole, or the
 * outside face stays a flat rectangle and the gable triangle floats in front
 * of it. Wide enough for a thick masonry wall, short of the next wall over.
 */
const ROOF_EDGE_MARGIN = 0.35;

/** Where a roof's slope changes, so a wall top can bend there. */
function roofModel(form) {
  const rect = roofRectFromForm(form);
  if (!rect || rect.w < 0.2 || rect.h < 0.2) return null;
  const shape = String(form.roofForm || "flat").toLowerCase();
  const pitch = Number(form.roofPitch);
  const deg = shape === "flat" ? 0 : (Number.isFinite(pitch) ? Math.min(60, Math.max(5, pitch)) : 30);
  const tan = Math.tan((deg * Math.PI) / 180);
  const alongX = roofRidgeAlongX(rect, form.roofRidge);
  const eave = Number(form.elevation) || 0;
  const holes = (form.roofCuts || []).filter((ring) => ring.length >= 3);
  const { x, y, w, h } = rect;
  const kinks = [
    [[x, y], [x + w, y]],
    [[x + w, y], [x + w, y + h]],
    [[x + w, y + h], [x, y + h]],
    [[x, y + h], [x, y]],
  ];
  for (const hole of holes) {
    for (let i = 0; i < hole.length; i += 1) kinks.push([hole[i], hole[(i + 1) % hole.length]]);
  }
  const inset = Math.min(w, h) / 2;
  if (shape === "gable") {
    if (alongX) kinks.push([[x, y + h / 2], [x + w, y + h / 2]]);
    else kinks.push([[x + w / 2, y], [x + w / 2, y + h]]);
  } else if (shape === "hip") {
    const pyramid = Math.min(w, h) - inset * 2 < 0.08;
    if (pyramid) {
      const apex = [x + w / 2, y + h / 2];
      kinks.push([[x, y], apex], [[x + w, y], apex], [[x + w, y + h], apex], [[x, y + h], apex]);
    } else if (alongX) {
      const mid = y + h / 2;
      const e = [x + inset, mid];
      const f = [x + w - inset, mid];
      kinks.push([e, f], [[x, y], e], [[x + w, y], f], [[x, y + h], e], [[x + w, y + h], f]);
    } else {
      const mid = x + w / 2;
      const e = [mid, y + inset];
      const f = [mid, y + h - inset];
      kinks.push([e, f], [[x, y], e], [[x, y + h], f], [[x + w, y], e], [[x + w, y + h], f]);
    }
  }
  // The break has to cross the face that sits just outside the outline.
  return { rect, shape, tan, alongX, eave, holes, kinks: kinks.map((seg) => extendKink(seg[0], seg[1], ROOF_EDGE_MARGIN)) };
}

function extendKink(a, b, extra) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [
    [a[0] - (dx / len) * extra, a[1] - (dy / len) * extra],
    [b[0] + (dx / len) * extra, b[1] + (dy / len) * extra],
  ];
}

function closestOnRing(ring, x, y) {
  let bestX = x;
  let bestY = y;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const ab2 = abx * abx + aby * aby;
    const t = ab2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / ab2));
    const px = a[0] + abx * t;
    const py = a[1] + aby * t;
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) {
      bestD = d;
      bestX = px;
      bestY = py;
    }
  }
  return { x: bestX, y: bestY, d: bestD };
}

/** Roof height at a plan point already known to lie on the roof. */
function roofHeightAt(model, x, y) {
  const { rect, shape, tan, eave } = model;
  if (shape === "shed") {
    if (model.alongX) return eave + (rect.y + rect.h - y) * tan;
    return eave + (rect.x + rect.w - x) * tan;
  }
  if (shape === "gable") {
    if (model.alongX) return eave + (rect.h / 2 - Math.abs(y - (rect.y + rect.h / 2))) * tan;
    return eave + (rect.w / 2 - Math.abs(x - (rect.x + rect.w / 2))) * tan;
  }
  if (shape === "hip") {
    const inset = Math.min(rect.w, rect.h) / 2;
    const dx = Math.min(x - rect.x, rect.x + rect.w - x);
    const dy = Math.min(y - rect.y, rect.y + rect.h - y);
    return eave + tan * Math.min(dx, dy, inset);
  }
  return eave;
}

/** Top of the roof surface at a plan point, or null off the roof.
 *  A point just outside the outline, or just inside a hole, takes the
 *  height on the nearest plate so a wall face there follows the slope. */
function roofSurfaceZ(model, x, y) {
  const { rect, holes } = model;
  const outline = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  let sx = x;
  let sy = y;
  if (x < rect.x - 1e-4 || y < rect.y - 1e-4 || x > rect.x + rect.w + 1e-4 || y > rect.y + rect.h + 1e-4) {
    const near = closestOnRing(outline, x, y);
    if (near.d > ROOF_EDGE_MARGIN) return null;
    sx = near.x;
    sy = near.y;
  }
  for (const hole of holes) {
    if (!pointInPoly(sx, sy, hole)) continue;
    const near = closestOnRing(hole, sx, sy);
    if (near.d > ROOF_EDGE_MARGIN) return null;
    sx = near.x;
    sy = near.y;
  }
  return roofHeightAt(model, sx, sy);
}

function segmentCrossT(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t <= 0.02 || t >= 0.98 || u < -0.001 || u > 1.001) return null;
  return t;
}

function splitFaceAtKinks(face, kinks) {
  if (!kinks.length) return;
  const src = face.pts;
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    const a = src[i];
    const b = src[(i + 1) % src.length];
    out.push(a);
    const ts = [];
    for (const [c, d] of kinks) {
      const t = segmentCrossT(a, b, c, d);
      if (t != null) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    let last = 0;
    for (const t of ts) {
      if (t - last < 0.02) continue;
      last = t;
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
  }
  face.pts = out;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;
}

function moveFacePoint(face, index, z) {
  const old = face.pts[index];
  const next = [old[0], old[1], z];
  for (const seg of face.bare || []) {
    for (let k = 0; k < 2; k += 1) if (samePoint(seg[k], old)) seg[k] = next;
  }
  face.pts[index] = next;
}

/**
 * Walls that reach a roof's plate follow its surface, up into a gable and
 * down where they would otherwise stick through. A low wall is only cut,
 * never stretched up to the roof. Both faces follow, including the one that
 * sits just outside the roof outline.
 */
function conformWallsToRoofs(faces, forms) {
  const roofs = (forms || []).filter((form) => (form.kind || "").toLowerCase() === "roof").map(roofModel).filter(Boolean);
  if (!roofs.length) return;
  const kinks = roofs.flatMap((roof) => roof.kinks);
  const wallIds = new Set(
    (forms || []).filter((form) => (form.kind || "").toLowerCase() === "wall").map((form) => form.elementId),
  );
  const groups = new Map();
  for (const face of faces) {
    if (face.kind !== "wall" || !wallIds.has(face.id) || !face.pts?.length) continue;
    if (!groups.has(face.id)) groups.set(face.id, []);
    groups.get(face.id).push(face);
  }
  for (const group of groups.values()) {
    let zTop = -Infinity;
    let zBase = Infinity;
    for (const face of group) {
      for (const p of face.pts) {
        if (p[2] > zTop) zTop = p[2];
        if (p[2] < zBase) zBase = p[2];
      }
    }
    if (!(zTop > zBase + 0.05)) continue;
    for (const face of group) splitFaceAtKinks(face, kinks);
    for (const face of group) {
      for (let i = 0; i < face.pts.length; i += 1) {
        const p = face.pts[i];
        const onTop = p[2] >= zTop - 0.04;
        let result = p[2];
        let set = false;
        for (const roof of roofs) {
          const s = roofSurfaceZ(roof, p[0], p[1]);
          if (s == null) continue;
          const attaches = zTop >= roof.eave - ROOF_ATTACH_TOL;
          if (attaches && onTop) {
            result = set ? Math.min(result, s) : s;
            set = true;
          } else if ((set ? result : p[2]) > s + 0.005) {
            result = Math.min(set ? result : p[2], s);
            set = true;
          }
        }
        if (!set) continue;
        const z = Math.max(zBase + 0.02, result);
        if (Math.abs(z - p[2]) > 1e-3) moveFacePoint(face, i, z);
      }
    }
  }
}

/** Build the extruded face list for one compiled payload, filtered by status. */
export function facesFromPayload(payload, statusFilter = "both") {
  const forms = (payload?.sketchForms || []).filter((form) => statusVisible(form.status, statusFilter));
  const openings = forms.filter(isOpeningForm);
  const faces = [];
  for (const form of forms) pushFormFaces(faces, form, openings);
  conformWallsToRoofs(faces, forms);
  return faces;
}

/** Orbit projection. The third component is depth, and it grows away from
 *  the camera: a point higher on the screen (farther along the ground) or
 *  lower in the building has a larger depth. Painter's sort is far-first,
 *  the same rule look and section already use.
 *
 *  Plan y points DOWN the page (canvas convention, north is -y), while this
 *  maths is right-handed with y away from the viewer. Without negating y the
 *  whole model is a mirror image of the plan: top and bottom swap, so a
 *  window at the south end of a wall appears at the north end. */
export function projectPoint(x, y, z, origin, cx, cy, scale, cam) {
  const px = x - origin[0];
  const py = -(y - origin[1]);
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

function finiteBounds(bounds) {
  return !!bounds && [bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ].every(Number.isFinite);
}

function boundsOfPoints(points) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (![x, y, z].every(Number.isFinite)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function unionBounds(a, b) {
  if (!finiteBounds(a)) return finiteBounds(b) ? b : null;
  if (!finiteBounds(b)) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function clipSegmentHalf(a, b, origin, n, keepMin) {
  const da = sectionDot(a, origin, n);
  const db = sectionDot(b, origin, n);
  const ain = da >= keepMin - 1e-6;
  const bin = db >= keepMin - 1e-6;
  if (ain && bin) return [a, b];
  if (!ain && !bin) return null;
  const denom = db - da;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return ain ? [a, b] : null;
  const t = (keepMin - da) / denom;
  const hit = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  return ain ? [a, hit] : [hit, b];
}

/**
 * Keep the part of a service run that a section cut can see: on the look
 * side, within the drawn length, and no deeper than `far`. An orbit,
 * elevation or camera view returns the run unchanged.
 */
export function clipServiceSegment(a, b, cut) {
  if (!a || !b || !cut || cut.mode !== "section") return [a, b];
  const far = Number(cut.far) > 0 ? cut.far : SECTION_FAR_M;
  const length = Number(cut.length) > 0 ? cut.length : 0;
  const planes = [
    [cut.look, 0],
    [[-cut.look[0], -cut.look[1]], -far],
    [cut.along, -SECTION_U_PAD],
    [[-cut.along[0], -cut.along[1]], -(length + SECTION_U_PAD)],
  ];
  let seg = [a, b];
  for (const [n, min] of planes) {
    if (!n || !Number.isFinite(n[0]) || !Number.isFinite(n[1])) return null;
    const next = clipSegmentHalf(seg[0], seg[1], cut.origin, n, min);
    if (!next) return null;
    seg = next;
  }
  return seg;
}

function serviceRoutesInView(routes, statusFilter, cut) {
  const filtered = statusFilter === "existing" || statusFilter === "planned"
    ? routes.filter((route) => route.status === statusFilter)
    : routes;
  if (!cut || cut.mode !== "section") return filtered;
  const kept = [];
  for (const route of filtered) {
    const seg = clipServiceSegment(route.a, route.b, cut);
    if (!seg) continue;
    kept.push({ ...route, a: seg[0], b: seg[1] });
  }
  return kept;
}

function routeStrokeWidth(diameter, pxPerMetre) {
  const fromSize = diameter ? diameter * pxPerMetre : 0;
  return Math.min(9, Math.max(2.4, fromSize));
}

/** 0 = below grade, 1 = ground plane, 2 = at or above grade. */
export function massingLayer(face) {
  if (face?.kind === "ground") return 1;
  const pts = face?.pts || [];
  if (!pts.length) return 2;
  const z = pts.reduce((sum, p) => sum + p[2], 0) / pts.length;
  return z < -0.02 ? 0 : 2;
}

function pointOnSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-12) return Math.hypot(apx, apy, apz) <= 1e-4;
  const t = (apx * abx + apy * aby + apz * abz) / ab2;
  if (t < -0.002 || t > 1.002) return false;
  const cx = a[0] + abx * t - p[0];
  const cy = a[1] + aby * t - p[1];
  const cz = a[2] + abz * t - p[2];
  return cx * cx + cy * cy + cz * cz <= 1e-8;
}

function edgeIsBare(a, b, bare) {
  if (!bare) return false;
  for (const [p, q] of bare) {
    if (pointOnSegment(a, p, q) && pointOnSegment(b, p, q)) return true;
  }
  return false;
}

/** Stroke a face outline, leaving out edges marked bare (coplanar joints).
 *  A clipped face keeps those joints bare: a new vertex on a seam still lies
 *  on the original segment. */
export function strokeFaceEdges(ctx, projected, face) {
  const src = face?.pts || [];
  const n = projected.length;
  const bare = face?.bare;
  if (!bare || !bare.length || src.length !== n) {
    ctx.beginPath();
    projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    return;
  }
  const skip = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    skip[i] = !!(src[i] && src[j] && edgeIsBare(src[i], src[j], bare));
  }
  // A clip can leave a face whose remaining edges are all real corners.
  if (!skip.some(Boolean)) {
    ctx.beginPath();
    projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  for (let s = 0; s < n; s += 1) {
    if (skip[s]) continue;
    const prev = (s + n - 1) % n;
    if (!skip[prev]) continue;
    ctx.moveTo(projected[s][0], projected[s][1]);
    let k = s;
    do {
      const j = (k + 1) % n;
      ctx.lineTo(projected[j][0], projected[j][1]);
      k = j;
    } while (k !== s && !skip[k]);
  }
  ctx.stroke();
}

/** Fill/stroke for one face, by status and kind. Exported so a static
 * drafted view (sheets.js's section viewport, drawn straight into the sheet
 * canvas rather than this file's interactive one) can paint the same faces
 * `facesFromPayload()`/`clipFacesForSection()` produce without a second copy
 * of these rules. */
export function faceStyle(face) {
  if (face.kind === "ground" || face.finish) return { fill: face.fill, stroke: face.stroke };
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

const PAPER_RGB = [248, 241, 229];
/** Sun from the upper left, a little behind the viewer, in plan x/y/z. */
const SUN = (() => {
  const v = [-0.45, -0.55, 0.7];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

/** Unit normal of a face in model space, or null for a sliver. */
export function faceNormal(pts) {
  if (!pts || pts.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  return len < 1e-9 ? null : [nx / len, ny / len, nz / len];
}

/**
 * An opaque, lit version of a face's fill. The translucent fills in
 * faceStyle() are right for a cut section but turn an orbit view into a
 * stack of ghosts: the far wall, the roof underside and the ground all show
 * through. Here the colour is flattened onto the paper, so whatever is
 * behind a face is hidden, and shaded by the face's angle to the sun so a
 * wall and a roof slope read as different planes. Faces are single-sided
 * with no reliable winding, so the normal is taken as facing the sun.
 */
export function opaqueFill(face, fill) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(fill || "");
  if (!m) return fill;
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  // Lift faint fills so a thin extrusion or glass pane still reads.
  const a = Math.min(1, Math.max(alpha, face?.kind === "ground" ? 0.5 : 0.55) * (face?.kind === "ground" ? 1 : 1.15));
  const n = faceNormal(face?.pts);
  let light = 1;
  if (n && face?.kind !== "ground") {
    const d = Math.abs(n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
    light = 0.78 + 0.3 * d;
  }
  const ch = [1, 2, 3].map((i, k) => {
    const mixed = Number(m[i]) * a + PAPER_RGB[k] * (1 - a);
    return Math.max(0, Math.min(255, Math.round(mixed * light)));
  });
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

/**
 * Diagonal 45° poché hatch clipped to a projected polygon, in pixel space.
 * Skips a near-zero-area polygon rather than spraying hatch lines across its
 * bounding box - see the section poché note above `faceOnCut` in section.js.
 * Exported so sheets.js's static section viewport can draw the same poché
 * this file's interactive Section view does.
 */
export function hatchPolygon(ctx, pts, stroke) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
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

function paintPlateCallouts(ctx, projected, width, height) {
  const seen = new Map();
  for (const item of projected) {
    const z = item.face?.eaveZ;
    const id = item.face?.id;
    if (!id || !Number.isFinite(z)) continue;
    let rec = seen.get(id);
    if (!rec) {
      rec = { id, eaveZ: z, sx: 0, sy: 0, n: 0 };
      seen.set(id, rec);
    }
    for (const p of item.pts) {
      rec.sx += p[0];
      rec.sy += p[1];
      rec.n += 1;
    }
  }
  const labels = plateCallouts([...seen.values()]);
  if (!labels.length) return;
  ctx.save();
  ctx.font = "600 12px 'Source Sans 3', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of labels) {
    const rec = seen.get(label.id);
    if (!rec?.n) continue;
    const x = Math.min(width - 8 - ctx.measureText(label.text).width / 2, Math.max(8 + ctx.measureText(label.text).width / 2, rec.sx / rec.n));
    const y = Math.min(height - 20, Math.max(16, rec.sy / rec.n - 18));
    const w = ctx.measureText(label.text).width + 12;
    const h = 18;
    ctx.fillStyle = "rgba(244, 237, 225, 0.94)";
    ctx.strokeStyle = "#243044";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#243044";
    ctx.fillText(label.text, x, y);
  }
  ctx.restore();
}

/**
 * Wire an orbiting canvas view. Call `setPayload` whenever the document
 * changes, `resize` when the wrap is shown or resized, and `draw` to
 * re-render without changing anything (e.g. after a status filter click).
 */
export function createMassingView({ canvas, emptyEl, hintEl, titleEl, onDraw }) {
  const ctx = canvas.getContext("2d");
  const cam = createCamera();
  let statusFilter = "both";
  let payload = null;
  let serviceRoutes = [];
  let showServices = false;
  let hintDismissed = false;
  let drag = null;
  let reframe = true;
  // Element ids to pick out (BOQ "Show in 3D"). Empty = draw normally; set =
  // everything else is faded and these are painted in the accent colour.
  let highlight = new Set();
  let highlightHits = 0;
  const NODE_FLASH_MS = 1400;
  let serviceNodes = [];
  let flashStart = 0;
  let flashRaf = 0;

  function setServiceNodes(nodes) {
    serviceNodes = Array.isArray(nodes) ? nodes : [];
    draw();
  }

  // Flat = a fixed top-down plan of the same model: no orbit, roofs left out
  // (they would hide everything under them), ground grid drawn as usual.
  let flat = false;

  function setFlat(on) {
    flat = Boolean(on);
    if (cam.mode === "orbit") reframe = true;
    draw();
  }

  /** Returns how many faces/runs in the current view matched, so a caller can
   *  say "not visible in 3D" for an element with no solid of its own. */
  function setHighlight(ids) {
    highlight = new Set((ids || []).filter(Boolean));
    flashStart = performance.now();
    draw();
    return highlightHits;
  }

  function setPayload(nextPayload) {
    payload = nextPayload;
    if (cam.mode !== "look") reframe = true;
    draw();
  }

  function setStatusFilter(filter) {
    statusFilter = filter;
    draw();
  }

  function setServices(routes) {
    serviceRoutes = Array.isArray(routes) ? routes : [];
    draw();
  }

  function setShowServices(on) {
    showServices = Boolean(on);
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

  // An elevation shares a section's u/v projection (same `sectionUV`/
  // `projectSectionPoint` maths, just an unclipped, compass-fixed cut - see
  // elevation.js's header) but is never a poché face, so it gets its own
  // camera mode rather than reusing "section" outright: that keeps the
  // "draw a hatch on the cut face" branch below correctly section-only.
  function setElevation(cut) {
    if (!cut || cut.mode !== "elevation") return;
    delete cam.lookHit;
    Object.assign(cam, cut);
    cam.mode = "elevation";
    reframe = true;
    draw();
  }

  function setOrbit() {
    delete cam.lookHit;
    cam.mode = "orbit";
    reframe = true;
    draw();
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
    paintScene(ctx, width, height, cam, true);
  }

  // `live` updates the overlay (title, empty state, the framed camera).
  // A reference shot passes a copy of the camera and leaves the view alone.
  function paintScene(viewCtx, width, height, viewCam, live) {
    const isLook = viewCam.mode === "look";
    const isSection = viewCam.mode === "section";
    const isElevation = viewCam.mode === "elevation";
    // A section and an elevation share every projection/orthographic detail
    // below except clipping and the poché hatch, which stay section-only.
    const isCutView = isSection || isElevation;
    if (live && titleEl) {
      titleEl.textContent = isLook ? "Look" : isSection ? "Section" : isElevation ? `${viewCam.label || "Elevation"} elevation` : "3D";
    }

    const allFaces = facesFromPayload(payload, statusFilter);
    const faces = flat && viewCam.mode === "orbit"
      ? allFaces.filter((face) => face.kind !== "roof" || highlight.has(face.id))
      : allFaces;
    const routes = showServices ? serviceRoutesInView(serviceRoutes, statusFilter, viewCam) : [];
    if (!faces.length && !routes.length) {
      if (live) {
        if (emptyEl) emptyEl.hidden = false;
        if (hintEl) hintEl.hidden = true;
        if (typeof onDraw === "function") onDraw(viewCam, payload);
      }
      return false;
    }
    if (live && emptyEl) emptyEl.hidden = true;
    if (live && hintEl) {
      if (hintDismissed || flat) hintEl.hidden = true;
      else {
        hintEl.hidden = false;
        hintEl.textContent = isLook
          ? "Drag to look around · scroll to zoom"
          : isCutView
            ? "Drag to pan · scroll to zoom"
            : "Drag to turn · scroll to zoom";
      }
    }

    const bounds = unionBounds(
      boundsOfFaces(faces),
      boundsOfPoints(routes.flatMap((route) => [route.a, route.b])),
    );
    if (live && reframe && !isLook && !isCutView && bounds) {
      frameCamera(viewCam, bounds);
      reframe = false;
    }
    if (live && flat && viewCam.mode === "orbit") {
      viewCam.pitch = Math.PI / 2 - 0.0001;
      viewCam.yaw = 0;
    }
    const withGround = [...faces, ...groundFacesFromBounds(bounds)];
    // Only a section clips: an elevation is viewed from outside the whole
    // model, so nothing needs to be cut away for it to make sense.
    const cutFaces = isSection ? clipFacesForSection(withGround, viewCam) : withGround;
    if (isSection && !cutFaces.length && !routes.length) {
      if (live) {
        if (emptyEl) emptyEl.hidden = false;
        if (hintEl) hintEl.hidden = true;
        if (typeof onDraw === "function") onDraw(viewCam, payload, { note: "That cut does not hit the building. Draw the line through the plan." });
      }
      return false;
    }
    if (live && isCutView && reframe) {
      const frameFaces = routes.length
        ? [...cutFaces, { pts: routes.flatMap((route) => [route.a, route.b]) }]
        : cutFaces;
      const framed = sectionFrame(frameFaces, viewCam);
      viewCam.sectionOu = framed.originU;
      viewCam.sectionOv = framed.originV;
      viewCam.sectionScale = Math.min(width, height) / (framed.span * 1.35);
      reframe = false;
    }

    // Frame the building. The ground tiles extend past it and would shrink
    // the house into the corner of its own site.
    const framed = finiteBounds(bounds) ? bounds : boundsOfFaces(withGround);
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
    // 18 here matches the camera's default scale, so the long side of the
    // building fills the shorter side of the canvas. Wheel zoom still
    // multiplies cam.scale on top of this.
    const scale = viewCam.scale * Math.min(width, height) / (span * 18);
    const cx = width / 2;
    const cy = height / 2 - (isLook || isCutView ? 0 : 16);
    const sectionScale = Number(viewCam.sectionScale) > 0 ? viewCam.sectionScale : scale;

    const projected = [];
    for (const face of cutFaces) {
      const pts = face.pts.map((p) => (isLook
        ? projectLookPoint(p[0], p[1], p[2], viewCam, cx, cy, height)
        : isCutView
          ? projectSectionPoint(p[0], p[1], p[2], viewCam, viewCam.sectionOu, viewCam.sectionOv, sectionScale, cx, cy)
          : projectPoint(p[0], p[1], p[2], origin, cx, cy, scale, viewCam)));
      const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      if (isLook && depth < LOOK_NEAR) continue;
      projected.push({ face, pts, depth });
    }
    // Every mode stores depth as "larger = farther" (orbit: projectPoint;
    // look: distance along the gaze; section/elevation: along the look
    // vector). Draw far faces first so a window's near leaf stays in front.
    // In orbit and look, the roof is one big plane whose average depth loses
    // to a wall under it, so the wall is painted over the slope. Draw the
    // roof after the walls and it covers them. A section keeps depth order,
    // because the cut face has to stay in front of what is behind it.
    const cover = (face) => (face?.kind === "roof" ? 1 : 0);
    projected.sort((a, b) => {
      const layer = massingLayer(a.face) - massingLayer(b.face);
      if (layer) return layer;
      if (!isCutView) {
        const over = cover(a.face) - cover(b.face);
        if (over) return over;
      }
      return b.depth - a.depth;
    });

    const picking = highlight.size > 0;
    highlightHits = 0;
    const drawFace = (item, picked) => {
      const style = faceStyle(item.face);
      viewCtx.beginPath();
      item.pts.forEach((p, i) => (i === 0 ? viewCtx.moveTo(p[0], p[1]) : viewCtx.lineTo(p[0], p[1])));
      viewCtx.closePath();
      if (picked) {
        viewCtx.fillStyle = "rgba(255,170,0,0.78)";
        viewCtx.strokeStyle = "#c2410c";
        viewCtx.lineWidth = 1.4;
        viewCtx.fill();
        strokeFaceEdges(viewCtx, item.pts, item.face);
        return;
      }
      viewCtx.fillStyle = item.face.cut
        ? (item.face.kind === "wall" ? "rgba(90,84,76,0.72)" : style.fill)
        : (isCutView ? style.fill : opaqueFill(item.face, style.fill));
      viewCtx.strokeStyle = style.stroke;
      viewCtx.lineWidth = projected.length > 8000 ? 0.2 : (item.face.cut ? 0.9 : (isCutView ? 0.45 : 0.8));
      viewCtx.fill();
      if (item.face.cut) hatchPolygon(viewCtx, item.pts, style.stroke);
      if (projected.length < 25000) strokeFaceEdges(viewCtx, item.pts, item.face);
    };
    const pickedItems = [];
    for (const item of projected) {
      const picked = picking && item.face.kind !== "ground" && highlight.has(item.face.id);
      if (picked) {
        pickedItems.push(item);
        highlightHits += 1;
        continue;
      }
      if (picking) viewCtx.globalAlpha = 0.2;
      drawFace(item, false);
      viewCtx.globalAlpha = 1;
    }
    // Picked faces go on top of the faded building, so a hit is never hidden
    // behind a wall that merely happens to be nearer the camera.
    for (const item of pickedItems) drawFace(item, true);
    const projectRoute = (point) => (isLook
      ? projectLookPoint(point[0], point[1], point[2], viewCam, cx, cy, height)
      : isCutView
        ? projectSectionPoint(point[0], point[1], point[2], viewCam, viewCam.sectionOu, viewCam.sectionOv, sectionScale, cx, cy)
        : projectPoint(point[0], point[1], point[2], origin, cx, cy, scale, viewCam));
    const routePx = (pa, pb) => {
      if (isLook) {
        const depth = Math.max(LOOK_NEAR, ((pa[2] + pb[2]) / 2));
        const fov = Number(viewCam.fov) > 0 ? viewCam.fov : LOOK_FOV_DEFAULT;
        return ((height / 2) / Math.tan(fov / 2)) / depth;
      }
      return isCutView ? sectionScale : scale;
    };
    // Fittings (bends) are service nodes: too small to read as faces, so a
    // picked one gets a solid marker plus a short pulsing ring.
    const pickedNodes = picking && showServices
      ? serviceNodes.filter((n) => highlight.has(n.id))
      : [];
    const paintPickedNodes = () => {
      if (!pickedNodes.length) return;
      const t = (performance.now() - flashStart) / NODE_FLASH_MS;
      viewCtx.save();
      for (const n of pickedNodes) {
        const p = projectRoute(n.p);
        if (isLook && p[2] < LOOK_NEAR) continue;
        viewCtx.beginPath();
        viewCtx.arc(p[0], p[1], 5, 0, Math.PI * 2);
        viewCtx.fillStyle = "#ea580c";
        viewCtx.strokeStyle = "#fffdf8";
        viewCtx.lineWidth = 2;
        viewCtx.fill();
        viewCtx.stroke();
        if (t < 1) {
          const pulse = Math.abs(Math.sin(t * Math.PI * 3));
          viewCtx.beginPath();
          viewCtx.arc(p[0], p[1], 9 + 18 * pulse, 0, Math.PI * 2);
          viewCtx.strokeStyle = "#ea580c";
          viewCtx.globalAlpha = (1 - t) * (0.4 + 0.6 * pulse);
          viewCtx.lineWidth = 2.4;
          viewCtx.stroke();
          viewCtx.globalAlpha = 1;
        }
      }
      viewCtx.restore();
      if (live && t < 1 && !flashRaf) {
        flashRaf = requestAnimationFrame(() => { flashRaf = 0; draw(); });
      }
    };
    highlightHits += pickedNodes.length;
    if (picking) {
      const pickedRoutes = routes.filter((route) => highlight.has(route.id));
      highlightHits += pickedRoutes.length;
      viewCtx.globalAlpha = 0.2;
      paintServiceRoutes(viewCtx, routes.filter((route) => !highlight.has(route.id)), projectRoute, routePx, isLook);
      viewCtx.globalAlpha = 1;
      paintServiceRoutes(viewCtx, pickedRoutes.map((route) => ({ ...route, colour: "#ea580c", dash: null, diameter: 0.08 })), projectRoute, routePx, isLook);
    } else {
      paintServiceRoutes(viewCtx, routes, projectRoute, routePx, isLook);
    }
    paintPickedNodes();
    if (!isLook && !flat) paintPlateCallouts(viewCtx, projected, width, height);
    if (live && typeof onDraw === "function") onDraw(viewCam, payload);
    return true;
  }

  // Opposite side and a higher roof view, for Generate. Same pixels as the
  // canvas on screen, without moving it. Empty outside an orbit view.
  function referenceCanvases() {
    if (cam.mode !== "orbit" || flat) return [];
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || !canvas.width || !canvas.height) return [];
    const dpr = window.devicePixelRatio || 1;
    const shots = [];
    for (const shot of orbitReferenceCameras(cam)) {
      const off = document.createElement("canvas");
      off.width = canvas.width;
      off.height = canvas.height;
      const offCtx = off.getContext("2d");
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      offCtx.clearRect(0, 0, width, height);
      const viewCam = { ...cam, mode: "orbit", yaw: shot.yaw, pitch: shot.pitch };
      if (!paintScene(offCtx, width, height, viewCam, false)) continue;
      shots.push({ role: shot.role, canvas: off });
    }
    return shots;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (flat && cam.mode === "orbit") return;
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
    if (!hintDismissed && (Math.abs(event.clientX - drag.x) > 4 || Math.abs(event.clientY - drag.y) > 4)) {
      hintDismissed = true;
    }
    if (cam.mode === "look") {
      cam.yaw = drag.yaw + (event.clientX - drag.x) * 0.008;
      cam.pitch = Math.min(LOOK_PITCH_MAX, Math.max(LOOK_PITCH_MIN, drag.pitch - (event.clientY - drag.y) * 0.008));
    } else if (cam.mode === "section" || cam.mode === "elevation") {
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
    } else if (cam.mode === "section" || cam.mode === "elevation") {
      const s = Number(cam.sectionScale) > 0 ? cam.sectionScale : 40;
      cam.sectionScale = Math.min(180, Math.max(12, s * (event.deltaY > 0 ? 0.92 : 1.08)));
    } else {
      cam.scale = Math.min(48, Math.max(8, cam.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
    }
    draw();
  }, { passive: false });

  return {
    setPayload,
    setHighlight,
    setFlat,
    setStatusFilter,
    setServices,
    setServiceNodes,
    setShowServices,
    setLook,
    setSection,
    setElevation,
    setOrbit,
    draw,
    resize: draw,
    mode: () => cam.mode,
    referenceCanvases,
  };
}

/**
 * Routes paint after the building so a pipe inside a wall stays readable.
 * A vertical rise often projects to a point; the joint disc is what shows it.
 * In the camera view a run entirely behind the eye is left out.
 */
function paintServiceRoutes(ctx, routes, project, pxPerMetre, isLook) {
  if (!routes.length) return;
  ctx.save();
  ctx.lineCap = "round";
  const joints = [];
  for (const route of routes) {
    const pa = project(route.a);
    const pb = project(route.b);
    if (isLook && pa[2] < LOOK_NEAR && pb[2] < LOOK_NEAR) continue;
    const width = routeStrokeWidth(route.diameter, pxPerMetre(pa, pb));
    const dash = route.dash === "schematic" ? [2, 5] : route.dash === "existing" ? [10, 4] : [];
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.strokeStyle = "rgba(255, 253, 248, 0.92)";
    ctx.lineWidth = width + 2.2;
    ctx.stroke();
    ctx.strokeStyle = route.colour;
    ctx.lineWidth = width;
    ctx.stroke();
    joints.push([pa, route.colour, width], [pb, route.colour, width]);
  }
  ctx.setLineDash([]);
  for (const [point, colour, width] of joints) {
    if (isLook && point[2] < LOOK_NEAR) continue;
    ctx.beginPath();
    ctx.arc(point[0], point[1], Math.max(2.2, width * 0.55), 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.restore();
}
