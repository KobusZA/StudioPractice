// Sanitary type window. There is no supplier photo for these families, so
// the Photo tab draws the same SANS 10143 plan symbol the plan uses, at the
// type's real width and depth. The 3D tab extrudes that footprint to the
// type's own height: a size model, not a product render.

import { projectPoint } from "./massing.js";
import {
  fixturePrimitives,
  fixtureSize,
  fixtureSymbolKind,
  paintFixture,
} from "./plan-symbols.js";

const FALLBACK_HEIGHT = {
  wc: 0.7, "wc-wall": 0.4, bidet: 0.4, urinal: 0.65,
  basin: 0.85, vanity: 0.85, "basin-round": 0.4,
  bath: 0.55, "bath-free": 0.5, shower: 1.9,
  washer: 0.85, dishwasher: 0.85, sink: 0.2, "sink-double": 0.2,
  geyser: 1.5,
};

const FREESTANDING = new Set(["bath-free", "basin-round", "geyser"]);

function overallHeight(sku, kind) {
  const h = Number(sku?.geometry?.height);
  if (h > 0.05 && h < 5) return h;
  return FALLBACK_HEIGHT[kind] || 0.5;
}

/** Pan sits lower than the cistern on a close-coupled WC. */
function panHeight(height) {
  return Math.min(0.42, height * 0.58);
}

function dedupe(loop) {
  const out = [];
  for (const p of loop) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

function rectLoop(p) {
  return [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
}

function ellipseLoop(cx, cy, rx, ry, n = 36) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function roundRectLoop(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-4) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [];
  const arc = (cx, cy, a0, a1) => {
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  };
  arc(x + rr, y + rr, Math.PI, Math.PI * 1.5);
  arc(x + w - rr, y + rr, Math.PI * 1.5, Math.PI * 2);
  arc(x + w - rr, y + h - rr, 0, Math.PI * 0.5);
  arc(x + rr, y + h - rr, Math.PI * 0.5, Math.PI);
  return dedupe(pts);
}

function loopOf(part) {
  if (!part) return null;
  if (part.op === "rect") return rectLoop(part);
  if (part.op === "roundRect") return roundRectLoop(part.x, part.y, part.w, part.h, part.r);
  if (part.op === "ellipse") return ellipseLoop(part.cx, part.cy, part.rx, part.ry);
  if (part.op === "circle") return ellipseLoop(part.cx, part.cy, part.r, part.r, 28);
  if (part.op === "polyline") return part.pts.map((p) => [p[0], p[1]]);
  return null;
}

function solid(part, z0, z1) {
  const loop = dedupe(loopOf(part) || []);
  if (loop.length < 3) return null;
  // A sampled curve (pan, oval tub, round basin) is one surface. Stroking
  // every slice reads as a barrel, so those sides are filled only.
  return { loop, z0, z1, smooth: loop.length > 8 };
}

function mark(part, z) {
  return part ? { part, z } : null;
}

/**
 * Footprint solids, plan marks drawn on a face, and an optional open frame
 * (the shower enclosure above its tray).
 */
function bodiesAndMarks(kind, parts, depth, height) {
  const top = height;
  const empty = { solids: [], marks: [], frontCircles: [], frame: null };
  switch (kind) {
    case "wc": {
      const rect = parts.find((p) => p.op === "rect");
      const pan = parts.find((p) => p.op === "polyline");
      return {
        solids: [solid(rect, 0, height), solid(pan, 0, panHeight(height))].filter(Boolean),
        marks: [],
        frontCircles: [],
        frame: null,
      };
    }
    case "wc-wall":
    case "bidet":
    case "urinal": {
      const pan = parts.find((p) => p.op === "polyline");
      const z = kind === "wc-wall" ? Math.min(height, 0.42) : height;
      return {
        solids: [solid(pan, 0, z)].filter(Boolean),
        marks: parts.filter((p) => p !== pan).map((p) => mark(p, z)).filter(Boolean),
        frontCircles: [],
        frame: null,
      };
    }
    case "basin-round":
    case "geyser": {
      const circles = parts.filter((p) => p.op === "circle").sort((a, b) => b.r - a.r);
      const body = circles[0];
      return {
        solids: [solid(body, 0, height)].filter(Boolean),
        marks: circles.slice(1).map((p) => mark(p, top)).filter(Boolean),
        frontCircles: [],
        frame: null,
      };
    }
    case "bath-free": {
      const ellipses = parts.filter((p) => p.op === "ellipse").sort((a, b) => (b.rx * b.ry) - (a.rx * a.ry));
      const body = ellipses[0];
      return {
        solids: [solid(body, 0, height)].filter(Boolean),
        marks: parts.filter((p) => p !== body).map((p) => mark(p, top)).filter(Boolean),
        frontCircles: [],
        frame: null,
      };
    }
    case "shower": {
      const rect = parts.find((p) => p.op === "rect");
      const trayH = Math.min(0.08, height * 0.5);
      const frame = rect && height - trayH > 0.05
        ? { loop: rectLoop(rect), z0: trayH, z1: height }
        : null;
      return {
        solids: [solid(rect, 0, trayH)].filter(Boolean),
        marks: parts.filter((p) => p !== rect).map((p) => mark(p, trayH)).filter(Boolean),
        frontCircles: [],
        frame,
      };
    }
    case "washer": {
      const rect = parts.find((p) => p.op === "rect");
      const circles = parts.filter((p) => p.op === "circle");
      return {
        solids: [solid(rect, 0, height)].filter(Boolean),
        marks: [],
        frontCircles: circles.map((c) => ({ cx: c.cx, y: depth, cz: height * 0.5, r: c.r })),
        frame: null,
      };
    }
    case "carpet-round": {
      const ellipses = parts.filter((p) => p.op === "ellipse").sort((a, b) => (b.rx * b.ry) - (a.rx * a.ry));
      const body = ellipses[0];
      return {
        solids: [solid(body, 0, height)].filter(Boolean),
        marks: ellipses.slice(1).map((p) => mark(p, top)).filter(Boolean),
        frontCircles: [],
        frame: null,
      };
    }
    case "bed":
    case "bedside":
    case "sofa-2":
    case "sofa-3":
    case "armchair":
    case "coffee":
    case "tv":
    case "dining-4":
    case "dining-6":
    case "dining-8":
    case "desk":
    case "chair":
    case "fridge":
    case "stove":
    case "carpet-square":
    case "basin":
    case "vanity":
    case "bath":
    case "sink":
    case "sink-double":
    case "dishwasher": {
      const rects = parts.filter((p) => p.op === "rect" || p.op === "roundRect");
      rects.sort((a, b) => (b.w * b.h) - (a.w * a.h));
      const body = rects[0];
      return {
        solids: [solid(body, 0, height)].filter(Boolean),
        marks: parts.filter((p) => p !== body).map((p) => mark(p, top)).filter(Boolean),
        frontCircles: [],
        frame: null,
      };
    }
    default:
      return empty;
  }
}

/** Null unless this sanitary or furniture type has a plan symbol to draw. */
export function sanitaryPreview(sku) {
  if (sku?.category !== "sanitary" && sku?.category !== "furniture") return null;
  const kind = fixtureSymbolKind(sku);
  if (!kind) return null;
  const { width, depth } = fixtureSize(sku);
  const height = overallHeight(sku, kind);
  const parts = fixturePrimitives(kind, width, depth);
  const built = bodiesAndMarks(kind, parts, depth, height);
  if (!built.solids.length) return null;
  return {
    kind,
    width,
    depth,
    height,
    againstWall: sku.category === "furniture" ? false : !FREESTANDING.has(kind),
    ...built,
  };
}

export function mmLabel(metres) {
  return `${Math.round(metres * 1000)} mm`;
}

/** Where the plan symbol and its two dimension strings sit in the frame. */
export function planPreviewLayout(preview, viewW, viewH) {
  const top = 22;
  const bottom = 32;
  const right = 78;
  const left = 16;
  const availW = Math.max(1, viewW - left - right);
  const availH = Math.max(1, viewH - top - bottom);
  const scale = Math.min(availW / preview.width, availH / preview.depth);
  const symW = preview.width * scale;
  const symH = preview.depth * scale;
  const x = left + (availW - symW) / 2;
  const y = top + (availH - symH) / 2;
  return {
    scale,
    x,
    y,
    symW,
    symH,
    widthLabel: {
      text: mmLabel(preview.width),
      x1: x, y1: y + symH + 12, x2: x + symW, y2: y + symH + 12,
      tx: x + symW / 2, ty: y + symH + 24,
    },
    depthLabel: {
      text: mmLabel(preview.depth),
      x1: x + symW + 12, y1: y, x2: x + symW + 12, y2: y + symH,
      tx: x + symW + 36, ty: y + symH / 2,
    },
    wallLabel: preview.againstWall ? { text: "wall", x: x + symW / 2, y: y - 6 } : null,
  };
}

function drawDim(ctx, label) {
  ctx.save();
  ctx.strokeStyle = "#5c5348";
  ctx.fillStyle = "#5c5348";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(label.x1, label.y1);
  ctx.lineTo(label.x2, label.y2);
  ctx.stroke();
  const dx = label.x2 - label.x1;
  const dy = label.y2 - label.y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 4;
  const py = (dx / len) * 4;
  for (const [x, y] of [[label.x1, label.y1], [label.x2, label.y2]]) {
    ctx.beginPath();
    ctx.moveTo(x - px, y - py);
    ctx.lineTo(x + px, y + py);
    ctx.stroke();
  }
  ctx.font = '12px "Source Sans 3", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.text, label.tx, label.ty);
  ctx.restore();
}

function paintPlan(ctx, sku, preview, viewW, viewH) {
  const layout = planPreviewLayout(preview, viewW, viewH);
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.strokeStyle = "#1a1612";
  ctx.lineWidth = 1.75;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  paintFixture(
    ctx,
    { x: 0, y: 0, rotation: 0 },
    sku,
    (mx, my) => [layout.x + mx * layout.scale, layout.y + my * layout.scale],
    layout.scale,
  );
  ctx.restore();
  drawDim(ctx, layout.widthLabel);
  drawDim(ctx, layout.depthLabel);
  if (layout.wallLabel) {
    ctx.save();
    ctx.fillStyle = "#5c5348";
    ctx.font = '11px "Source Sans 3", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(layout.wallLabel.text, layout.wallLabel.x, Math.max(12, layout.wallLabel.y));
    ctx.restore();
  }
}

function faceNormal(pts) {
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
  if (len < 1e-8) return null;
  return [nx / len, ny / len, nz / len];
}

function shade(pts) {
  const n = faceNormal(pts);
  const light = [0.35, -0.45, 0.82];
  const ll = Math.hypot(light[0], light[1], light[2]);
  const nd = n ? Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / ll) : 0.55;
  const t = 0.35 + 0.65 * nd;
  const shadow = [201, 186, 166];
  const lit = [247, 243, 235];
  const c = shadow.map((v, i) => Math.round(v + (lit[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function facesOf(preview) {
  const faces = [];
  for (const body of preview.solids) {
    const { loop, z0, z1 } = body;
    faces.push({ pts: loop.map(([x, y]) => [x, y, z1]) });
    faces.push({ pts: loop.map(([x, y]) => [x, y, z0]) });
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const front = preview.frontCircles.length
        && Math.abs(a[1] - preview.depth) < 1e-4
        && Math.abs(b[1] - preview.depth) < 1e-4;
      faces.push({
        pts: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
        decal: front ? preview.frontCircles : null,
        smooth: body.smooth,
      });
    }
  }
  return faces;
}

function projectionFit(preview, cam, viewW, viewH) {
  const origin = [preview.width / 2, preview.depth / 2, preview.height / 2];
  const samples = [];
  const add = (x, y, z) => samples.push(projectPoint(x, y, z, origin, 0, 0, 1, cam));
  for (const body of preview.solids) {
    for (const [x, y] of body.loop) {
      add(x, y, body.z0);
      add(x, y, body.z1);
    }
  }
  if (preview.frame) {
    for (const [x, y] of preview.frame.loop) {
      add(x, y, preview.frame.z0);
      add(x, y, preview.frame.z1);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of samples) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const zoom = Math.min(4, Math.max(0.4, cam.zoom || 1));
  const scale = Math.min((viewW * 0.78) / Math.max(1e-6, maxX - minX), (viewH * 0.78) / Math.max(1e-6, maxY - minY)) * zoom;
  return {
    origin,
    scale,
    cx: viewW / 2 - ((minX + maxX) / 2) * scale,
    cy: viewH / 2 - ((minY + maxY) / 2) * scale,
  };
}

function project(fit, cam, x, y, z) {
  return projectPoint(x, y, z, fit.origin, fit.cx, fit.cy, fit.scale, cam);
}

function depthOf(pts, fit, cam) {
  let z = 0;
  for (const p of pts) z += projectPoint(p[0], p[1], p[2], fit.origin, 0, 0, 1, cam)[2];
  return z / pts.length;
}

function strokeLoop2d(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  });
  ctx.closePath();
}

function strokeCircle3d(ctx, circle, fit, cam) {
  ctx.beginPath();
  const n = 28;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const p = project(fit, cam, circle.cx + circle.r * Math.cos(a), circle.y, circle.cz + circle.r * Math.sin(a));
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
}

function strokeMark(ctx, part, z, fit, cam) {
  const at = (x, y) => project(fit, cam, x, y, z);
  ctx.beginPath();
  if (part.op === "line") {
    const a = at(part.x1, part.y1);
    const b = at(part.x2, part.y2);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  } else if (part.op === "polyline") {
    part.pts.forEach((p, i) => {
      const s = at(p[0], p[1]);
      if (i === 0) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    });
  } else if (part.op === "circle" || part.op === "ellipse") {
    const rx = part.rx ?? part.r;
    const ry = part.ry ?? part.r;
    const n = 28;
    for (let i = 0; i <= n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const s = at(part.cx + rx * Math.cos(a), part.cy + ry * Math.sin(a));
      if (i === 0) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    }
  } else {
    const loop = loopOf(part);
    if (!loop) return;
    loop.forEach((p, i) => {
      const s = at(p[0], p[1]);
      if (i === 0) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    });
    ctx.closePath();
  }
  ctx.stroke();
}

function strokeFrame(ctx, frame, fit, cam) {
  const top = frame.loop.map(([x, y]) => project(fit, cam, x, y, frame.z1));
  ctx.beginPath();
  top.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  });
  ctx.closePath();
  ctx.stroke();
  for (const [x, y] of frame.loop) {
    const a = project(fit, cam, x, y, frame.z0);
    const b = project(fit, cam, x, y, frame.z1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}

function paintModel(ctx, preview, viewW, viewH, cam) {
  ctx.clearRect(0, 0, viewW, viewH);
  const fit = projectionFit(preview, cam, viewW, viewH);
  const faces = facesOf(preview).map((face) => ({ ...face, depth: depthOf(face.pts, fit, cam) }));
  faces.sort((a, b) => b.depth - a.depth);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(26, 22, 18, 0.55)";
  for (const face of faces) {
    const flat = face.pts.map((p) => project(fit, cam, p[0], p[1], p[2]));
    strokeLoop2d(ctx, flat);
    ctx.fillStyle = shade(face.pts);
    ctx.fill();
    if (!face.smooth) ctx.stroke();
    if (face.decal) {
      ctx.save();
      ctx.strokeStyle = "#1a1612";
      ctx.lineWidth = 1.5;
      for (const circle of face.decal) strokeCircle3d(ctx, circle, fit, cam);
      ctx.restore();
    }
  }
  ctx.save();
  ctx.strokeStyle = "#1a1612";
  ctx.lineWidth = 1.4;
  for (const item of preview.marks) strokeMark(ctx, item.part, item.z, fit, cam);
  if (preview.frame) strokeFrame(ctx, preview.frame, fit, cam);
  ctx.restore();
}

/**
 * Draw into a 2D context sized in CSS pixels. `view` is "photo" (plan symbol)
 * or "3d" (size model). Returns false when this type has nothing to show.
 */
export function paintSanitaryPreview(ctx, sku, { view, viewW, viewH, yaw, pitch, zoom } = {}) {
  const preview = sanitaryPreview(sku);
  if (!preview || !(viewW > 1) || !(viewH > 1)) return false;
  if (view === "3d") {
    paintModel(ctx, preview, viewW, viewH, { yaw: yaw ?? 0.75, pitch: pitch ?? 1.02, zoom: zoom ?? 1 });
  } else {
    paintPlan(ctx, sku, preview, viewW, viewH);
  }
  return true;
}
