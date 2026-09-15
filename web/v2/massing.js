// 3D massing view for the v2 core (Output > Views > 3D).
//
// Deliberately independent of the compliance engine (Week 2) and the sheet /
// PDF system (Week 3): it only extrudes what compile() already emits -
// profileLoops, depth and, since this file needed it, per-object elevation.
// No Revit mesh ingestion (that lives in web/extras.js against the old
// planner) and no AI render (Week 4, and a separate step that would consume
// this view's output rather than replace it).
//
// Ported from web/extras.js's massing renderer, trimmed of what v1 needed
// and v2 does not:
//  - No Revit `meshes` path - v2 has no live Revit extract, only compile().
//  - No baseline/diff colouring - that was the before/after compare tab.
//  - No multi-plan grouping - v1 grouped forms by a shared "plan" elevation
//    because a Revit extract came back as separate FloorPlan views. v2's
//    compile() instead stamps each form with its own `elevation` (added
//    alongside this file), so every kind is walked once, keyed by its own z0.

/** Camera state: yaw/pitch in radians, scale in canvas pixels per plan unit. */
export function createCamera() {
  return { yaw: 0.85, pitch: 0.55, scale: 18 };
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
  const alongX = form.roofRidge === "short" ? rect.w < rect.h : rect.w >= rect.h;
  const fill = "rgba(36,48,68,0.42)";
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
      quad(a, b, c, d, fill);
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
      quad(a, b, c, d, fill);
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
    if (alongX) {
      const mid = y0 + rect.h / 2;
      const r0 = pt(x0, mid, ridgeZ);
      const r1 = pt(x1, mid, ridgeZ);
      quad(pt(x0, y0, eave), pt(x1, y0, eave), r1, r0, fill);
      quad(r0, r1, pt(x1, y1, eave), pt(x0, y1, eave), fill);
      tri(pt(x0, y0, eave), pt(x0, y1, eave), r0, side);
      tri(pt(x1, y0, eave), r1, pt(x1, y1, eave), side);
    } else {
      const mid = x0 + rect.w / 2;
      const r0 = pt(mid, y0, ridgeZ);
      const r1 = pt(mid, y1, ridgeZ);
      quad(pt(x0, y0, eave), r0, r1, pt(x0, y1, eave), fill);
      quad(r0, pt(x1, y0, eave), pt(x1, y1, eave), r1, fill);
      tri(pt(x0, y0, eave), pt(x1, y0, eave), r0, side);
      tri(pt(x0, y1, eave), r1, pt(x1, y1, eave), side);
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
      tri(a, b, apex, fill);
      tri(b, c, apex, fill);
      tri(c, d, apex, fill);
      tri(d, a, apex, fill);
      return;
    }
    if (alongX) {
      const mid = y0 + rect.h / 2;
      const e = pt(x0 + inset, mid, ridgeZ);
      const f = pt(x1 - inset, mid, ridgeZ);
      quad(a, b, f, e, fill);
      quad(d, e, f, c, fill);
      tri(a, e, d, fill);
      tri(b, c, f, fill);
    } else {
      const mid = x0 + rect.w / 2;
      const e = pt(mid, y0 + inset, ridgeZ);
      const f = pt(mid, y1 - inset, ridgeZ);
      quad(a, e, f, d, fill);
      quad(b, c, f, e, fill);
      tri(a, b, e, fill);
      tri(d, f, c, fill);
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

function faceStyle(face) {
  const status = resolvedStatus(face.status);
  if (status === "planned" && (face.kind === "wall" || face.kind === "room")) {
    return { fill: face.kind === "wall" ? "rgba(178,69,30,0.38)" : "rgba(178,69,30,0.32)", stroke: "#b2451e" };
  }
  if (status === "planned" && face.kind === "roof") {
    return { fill: "rgba(58,95,122,0.5)", stroke: "#3a5f7a" };
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
export function createMassingView({ canvas, emptyEl, captionEl }) {
  const ctx = canvas.getContext("2d");
  const cam = createCamera();
  let statusFilter = "both";
  let payload = null;
  let drag = null;

  function setPayload(nextPayload) {
    payload = nextPayload;
    draw();
  }

  function setStatusFilter(filter) {
    statusFilter = filter;
    draw();
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const faces = facesFromPayload(payload, statusFilter);
    if (!faces.length) {
      if (emptyEl) emptyEl.hidden = false;
      if (captionEl) captionEl.textContent = "Draw a room, wall, roof, floor, door or window, then open 3D again.";
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    if (captionEl) captionEl.textContent = "Drag to orbit · scroll to zoom";

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const face of faces) {
      for (const [x, y, z] of face.pts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    const origin = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const scale = cam.scale * Math.min(width, height) / (span * 28);

    const projected = faces.map((face) => {
      const pts = face.pts.map((p) => projectPoint(p[0], p[1], p[2], origin, width / 2, height / 2 + 20, scale, cam));
      const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      return { face, pts, depth };
    });
    projected.sort((a, b) => a.depth - b.depth);

    for (const item of projected) {
      const style = faceStyle(item.face);
      ctx.beginPath();
      item.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = projected.length > 8000 ? 0.2 : 0.45;
      ctx.fill();
      if (projected.length < 25000) ctx.stroke();
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, yaw: cam.yaw, pitch: cam.pitch };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    cam.yaw = drag.yaw + (event.clientX - drag.x) * 0.01;
    cam.pitch = Math.min(1.2, Math.max(0.15, drag.pitch + (event.clientY - drag.y) * 0.01));
    draw();
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    cam.scale = Math.min(48, Math.max(8, cam.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
    draw();
  }, { passive: false });

  return { setPayload, setStatusFilter, draw, resize: draw };
}
