// Measured plan beside a camera look. The 3D view is composition; this pane
// is the metre stick: rooms, openings, stand/look, range to the hit face.
// Pure geometry is exported for tests; drawLookPlan paints a canvas.

import { planDimensionLines } from "./dimensions.js";
import { EYE_HEIGHT_M, LOOK_FOV_DEFAULT, lookAxes } from "./massing.js";

const STOREY_TOL = 0.35;
const RANGE_OFFSET = 0.32;
const OPENING_OFFSET = 0.22;

function fmt(v) {
  return `${Number(v).toFixed(2)} m`;
}

function loopPoints(loop) {
  const pts = [];
  for (const curve of loop.curves || []) {
    if (curve.start) pts.push([curve.start[0], curve.start[1]]);
  }
  return pts;
}

function firstLine(form) {
  for (const loop of form.profileLoops || []) {
    for (const curve of loop.curves || []) {
      if (!curve.start || !curve.end) continue;
      if ((curve.kind || "Line").toLowerCase() === "arc") continue;
      return { start: curve.start, end: curve.end };
    }
  }
  return null;
}

function storeyZ(cam) {
  const z = Number(cam?.eye?.[2]);
  return (Number.isFinite(z) ? z : EYE_HEIGHT_M) - EYE_HEIGHT_M;
}

function onStorey(form, z0) {
  const z = Number(form.elevation);
  if (!Number.isFinite(z)) return true;
  return Math.abs(z - z0) < STOREY_TOL;
}

function kindOf(form) {
  return String(form.kind || "").toLowerCase();
}

function boxOfPts(pts) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function raySegHit(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  if (t < 0.08 || u < -0.02 || u > 1.02) return null;
  return { t, u, x: ox + dx * t, y: oy + dy * t };
}

function offsetDimension(a, b, toward, offset, label) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if ((toward[0] - mx) * nx + (toward[1] - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    x1: a[0] + nx * offset,
    y1: a[1] + ny * offset,
    x2: b[0] + nx * offset,
    y2: b[1] + ny * offset,
    extFrom: [[a[0], a[1]], [b[0], b[1]]],
    label,
    look: true,
  };
}

export function lookPlanStrokes(payload, cam) {
  const z0 = storeyZ(cam);
  const rooms = [];
  const walls = [];
  const openings = [];
  for (const form of payload?.sketchForms || []) {
    if (!onStorey(form, z0)) continue;
    const kind = kindOf(form);
    if (kind === "room") {
      const pts = loopPoints(form.profileLoops?.[0] || {});
      const box = boxOfPts(pts);
      if (box && box.w > 0 && box.h > 0) rooms.push({ id: form.elementId, name: form.name, pts, box });
      continue;
    }
    const line = firstLine(form);
    if (!line) continue;
    if (kind === "wall") {
      walls.push({
        id: form.elementId,
        start: line.start,
        end: line.end,
        thickness: Number(form.thickness) > 0 ? Number(form.thickness) : 0.22,
      });
    } else if (kind === "window" || kind === "opening") {
      const width = Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1]);
      const isWindow = kind === "window";
      const height = Number(form.depth) > 0 ? Number(form.depth) : (isWindow ? 1.2 : 2.1);
      const sill = Number.isFinite(Number(form.sill)) ? Number(form.sill) : (isWindow ? 0.9 : 0);
      openings.push({
        id: form.elementId,
        name: form.name,
        kind: isWindow ? "window" : "door",
        start: line.start,
        end: line.end,
        width,
        height,
        sill,
        head: sill + height,
      });
    }
  }
  return { rooms, walls, openings };
}

/**
 * First wall or opening the look ray meets on plan. Openings win when they
 * sit on the same hit as a wall (you are looking at the window, not the
 * plaster beside it).
 */
export function lookTarget(payload, cam) {
  if (!cam?.eye) return null;
  const { forward } = lookAxes(cam);
  const dx = forward[0];
  const dy = forward[1];
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const ox = cam.eye[0];
  const oy = cam.eye[1];
  const { walls, openings } = lookPlanStrokes(payload, cam);
  let best = null;
  const consider = (item, kind) => {
    const hit = raySegHit(ox, oy, dx, dy, item.start[0], item.start[1], item.end[0], item.end[1]);
    if (!hit) return;
    const preferOpening = kind !== "wall" && best?.kind === "wall" && Math.abs(hit.t - best.range) < 0.25;
    if (!best || hit.t < best.range - 0.02 || preferOpening) {
      best = {
        kind,
        range: hit.t,
        point: [hit.x, hit.y],
        start: item.start,
        end: item.end,
        width: item.width,
        height: item.height,
        sill: item.sill,
        name: item.name,
        id: item.id,
        label: kind === "window" ? "window" : kind === "door" ? "door" : "wall",
      };
    }
  };
  for (const wall of walls) consider(wall, "wall");
  for (const opening of openings) consider(opening, opening.kind);
  return best;
}

function cloneHit(hit) {
  if (!hit) return null;
  return {
    ...hit,
    point: hit.point ? [hit.point[0], hit.point[1]] : hit.point,
    start: hit.start ? [...hit.start] : hit.start,
    end: hit.end ? [...hit.end] : hit.end,
  };
}

/**
 * The object measured when the look was placed. Live re-hit while dragging
 * made the window-width string appear and vanish as the ray grazed the glass.
 */
export function measuredLookHit(payload, cam) {
  if (cam?.lookHit) return cam.lookHit;
  const hit = cloneHit(lookTarget(payload, cam));
  if (cam && hit) cam.lookHit = hit;
  return hit;
}

export function lookPlanModel(payload, cam) {
  const strokes = lookPlanStrokes(payload, cam);
  const hit = measuredLookHit(payload, cam);
  const dims = planDimensionLines(strokes.rooms.map((r) => r.box));
  const eye = cam?.eye ? [cam.eye[0], cam.eye[1]] : null;
  const { forward } = lookAxes(cam || { yaw: 0, pitch: 0 });
  if (eye && hit) {
    dims.push(offsetDimension(eye, hit.point, hit.point, RANGE_OFFSET, fmt(hit.range)));
    if (hit.kind === "window" || hit.kind === "door") {
      dims.push(offsetDimension(hit.start, hit.end, eye, OPENING_OFFSET, fmt(hit.width)));
    }
  } else if (eye && Number(cam?.lookDist) > 0.2) {
    const lookAt = [eye[0] + forward[0] * cam.lookDist, eye[1] + forward[1] * cam.lookDist];
    dims.push(offsetDimension(eye, lookAt, lookAt, RANGE_OFFSET, fmt(cam.lookDist)));
  }
  const fov = Number(cam?.fov) > 0 ? cam.fov : LOOK_FOV_DEFAULT;
  const wedgeLen = Math.max(hit?.range || 0, Number(cam?.lookDist) || 0, 2) * 1.2;
  return {
    ...strokes,
    hit,
    dims,
    eye,
    yaw: cam?.yaw ?? 0,
    fov,
    wedgeLen,
    note: hitNote(hit),
  };
}

function hitNote(hit) {
  if (!hit) return null;
  if (hit.kind === "window") {
    return `${hit.name || "Window"} ${fmt(hit.width)} wide × ${fmt(hit.height)} high, sill ${fmt(hit.sill)}`;
  }
  if (hit.kind === "door") {
    return `${hit.name || "Door"} ${fmt(hit.width)} wide × ${fmt(hit.height)} high`;
  }
  return `${hit.label} ${fmt(hit.range)} ahead`;
}

export function lookPlanCaption(payload, cam) {
  const hit = measuredLookHit(payload, cam);
  const fov = Number(cam?.fov) > 0 ? cam.fov : LOOK_FOV_DEFAULT;
  const fovDeg = Math.round((fov * 180) / Math.PI);
  const stand = `Standing ${EYE_HEIGHT_M} m`;
  const fovBit = `FOV ${fovDeg}°`;
  if (hit) return `${stand} · ${fmt(hit.range)} to ${hit.label} · ${fovBit}`;
  if (Number(cam?.lookDist) > 0) return `${stand} · ${fmt(cam.lookDist)} look · ${fovBit}`;
  return `${stand} · ${fovBit}`;
}

function modelBounds(model) {
  const xs = [];
  const ys = [];
  const add = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  };
  for (const room of model.rooms) for (const p of room.pts) add(p[0], p[1]);
  for (const wall of model.walls) {
    add(wall.start[0], wall.start[1]);
    add(wall.end[0], wall.end[1]);
  }
  for (const op of model.openings) {
    add(op.start[0], op.start[1]);
    add(op.end[0], op.end[1]);
  }
  if (model.eye) add(model.eye[0], model.eye[1]);
  if (model.hit) add(model.hit.point[0], model.hit.point[1]);
  for (const d of model.dims) {
    add(d.x1, d.y1);
    add(d.x2, d.y2);
  }
  if (!xs.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function worldToScreenFn(bounds, width, height, pad = 28) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 2);
  const scale = Math.min(width - pad * 2, height - pad * 2) / span;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return (x, y) => [width / 2 + (x - cx) * scale, height / 2 - (y - cy) * scale];
}

function strokePoly(ctx, pts, toScreen, close) {
  if (!pts.length) return;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [sx, sy] = toScreen(p[0], p[1]);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (close) ctx.closePath();
}

function drawDim(ctx, line, toScreen) {
  const [x1, y1] = toScreen(line.x1, line.y1);
  const [x2, y2] = toScreen(line.x2, line.y2);
  const colour = line.look ? "#b2451e" : line.overall ? "#1a1612" : "#5c5347";
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = line.look || line.overall ? 1.2 : 1;
  const ends = [[x1, y1], [x2, y2]];
  (line.extFrom || []).forEach((pt, i) => {
    const [sx, sy] = toScreen(pt[0], pt[1]);
    const [ex, ey] = ends[i] || ends[0];
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  for (const [tx, ty] of ends) {
    ctx.beginPath();
    ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.font = line.look || line.overall ? "bold 11px 'Source Sans 3', sans-serif" : "11px 'Source Sans 3', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const pad = 3;
  const tw = ctx.measureText(line.label).width + pad * 2;
  ctx.fillStyle = "rgba(244,237,225,0.92)";
  ctx.fillRect(mx - tw / 2, my - 8, tw, 16);
  ctx.fillStyle = colour;
  ctx.fillText(line.label, mx, my);
  ctx.restore();
}

/**
 * Draw the measured plan onto `canvas`. No-op when the canvas has no layout
 * size yet (overlay just opened).
 */
export function drawLookPlan(canvas, payload, cam) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
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
  ctx.fillStyle = "#f4ede1";
  ctx.fillRect(0, 0, width, height);

  const model = lookPlanModel(payload, cam);
  if (!model.rooms.length && !model.walls.length) {
    ctx.fillStyle = "#5c5348";
    ctx.font = "13px 'Source Sans 3', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Draw a room, then place the camera.", width / 2, height / 2);
    return;
  }

  const toScreen = worldToScreenFn(modelBounds(model), width, height);

  for (const room of model.rooms) {
    strokePoly(ctx, room.pts, toScreen, true);
    ctx.fillStyle = "rgba(92,83,72,0.12)";
    ctx.strokeStyle = "#8a8074";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
  ctx.lineCap = "round";
  for (const wall of model.walls) {
    const [ax, ay] = toScreen(wall.start[0], wall.start[1]);
    const [bx, by] = toScreen(wall.end[0], wall.end[1]);
    ctx.strokeStyle = "#1a1612";
    ctx.lineWidth = Math.max(3, wall.thickness * 18);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  for (const op of model.openings) {
    const [ax, ay] = toScreen(op.start[0], op.start[1]);
    const [bx, by] = toScreen(op.end[0], op.end[1]);
    const active = model.hit && model.hit.id === op.id;
    ctx.strokeStyle = op.kind === "window" ? "#3a5f7a" : "#8b5a2b";
    ctx.lineWidth = active ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  if (model.eye) {
    const { right, forward } = lookAxes(cam);
    const half = model.fov / 2;
    const c = Math.cos(half);
    const s = Math.sin(half);
    const fxy = [forward[0], forward[1]];
    const rxy = [right[0], right[1]];
    const leftDir = [fxy[0] * c - rxy[0] * s, fxy[1] * c - rxy[1] * s];
    const rightDir = [fxy[0] * c + rxy[0] * s, fxy[1] * c + rxy[1] * s];
    const [ex, ey] = toScreen(model.eye[0], model.eye[1]);
    const leftEnd = toScreen(
      model.eye[0] + leftDir[0] * model.wedgeLen,
      model.eye[1] + leftDir[1] * model.wedgeLen,
    );
    const rightEnd = toScreen(
      model.eye[0] + rightDir[0] * model.wedgeLen,
      model.eye[1] + rightDir[1] * model.wedgeLen,
    );
    ctx.beginPath();
    ctx.moveTo(leftEnd[0], leftEnd[1]);
    ctx.lineTo(ex, ey);
    ctx.lineTo(rightEnd[0], rightEnd[1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(178,69,30,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(178,69,30,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    const lookEnd = model.hit
      ? toScreen(model.hit.point[0], model.hit.point[1])
      : toScreen(model.eye[0] + fxy[0] * model.wedgeLen, model.eye[1] + fxy[1] * model.wedgeLen);
    ctx.strokeStyle = "#b2451e";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(lookEnd[0], lookEnd[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#b2451e";
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, Math.PI * 2);
    ctx.fill();
    if (model.hit) {
      ctx.beginPath();
      ctx.arc(lookEnd[0], lookEnd[1], 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const line of model.dims) drawDim(ctx, line, toScreen);

  if (model.note) {
    ctx.font = "12px 'Source Sans 3', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const pad = 10;
    const tw = ctx.measureText(model.note).width + 16;
    ctx.fillStyle = "rgba(244,237,225,0.94)";
    ctx.strokeStyle = "rgba(26,22,18,0.18)";
    ctx.lineWidth = 1;
    ctx.fillRect(pad, height - 32, tw, 22);
    ctx.strokeRect(pad, height - 32, tw, 22);
    ctx.fillStyle = "#1a1612";
    ctx.fillText(model.note, pad + 8, height - 16);
  }
}
